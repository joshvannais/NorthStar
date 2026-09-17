'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
process.env.NODE_ENV = 'test';
process.env.AUTH_ACCESS_SECRET = 'm25-reconciliation-target-labels-local-secret';
for (const key of ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'OPENAI_API_KEY', 'RETELL_API_KEY', 'STRIPE_SECRET_KEY']) delete process.env[key];
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const { seedLearningLabels } = require('../helpers/m25-learning-label-fixture');
const output = (process.argv.find(value => value.startsWith('--output=')) || '--output=m25-reconciliation-target-labels-result.json').slice(9);
assert.ok(!fs.existsSync(output));
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

(async () => {
  let fixture; const ledger = { cases: [] };
  try {
    fixture = await createDatabaseFixture({ operationalSchedule: true });
    const seeded = await seedLearningLabels(fixture), owner = fixture.actors.owner;
    const read = source => request(fixture.app).get(source).set(owner.session.headers);
    let response = await read(`/api/v1/learning/external-labor-sources/${seeded.laborSource}/matches`);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const labor = response.body.data;
    for (const label of seeded.labels.workers) assert.ok(labor.workerTargets.some(value => value.displayLabel === label), label);
    assert.deepEqual(labor.jobTargets.map(value => value.displayLabel).sort(), [...seeded.labels.jobs].sort());
    assert.equal(new Set(labor.workerTargets.filter(value => seeded.workers.includes(value.targetId)).map(value => value.displayLabel)).size, 3);
    for (const target of seeded.workers) assert.ok(labor.workerTargets.some(value => value.targetId === target), target);
    for (const target of seeded.ambiguousWorkers) assert.ok(!labor.workerTargets.some(value => value.targetId === target), target);
    for (const target of seeded.forbiddenWorkers) assert.ok(!labor.workerTargets.some(value => value.targetId === target), target);
    for (const target of seeded.longWorkers) assert.ok(labor.workerTargets.some(value => value.targetId === target), target);
    assert.deepEqual(labor.workerTargets.filter(value => seeded.longWorkers.includes(value.targetId)).map(value => value.displayLabel).sort(),
      [...seeded.labels.longWorkers].sort());
    assert.equal(new Set(seeded.labels.longWorkers).size, 2);
    assert.ok(seeded.labels.longWorkers.every(value => value.length <= 240 && /-(?:North|South)$/.test(value)));
    assert.ok(labor.workerUnavailableTotal >= seeded.ambiguousWorkers.length + seeded.forbiddenWorkers.length);
    assert.deepEqual(new Set(labor.jobTargets.map(value => value.targetId)), new Set(seeded.jobs));
    ledger.cases.push('Same-role workers and jobs receive unique recognizable labels; forbidden records and an indistinguishable duplicate pair fail closed, while long duplicates retain their late North or South discriminator.');

    response = await read(`/api/v1/learning/external-asset-sources/${seeded.assetSource}/matches`);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const assets = response.body.data;
    assert.deepEqual(assets.vehicleTargets.map(value => value.displayLabel).sort(), [...seeded.labels.vehicles].sort());
    assert.deepEqual(assets.equipmentTargets.map(value => value.displayLabel).sort(), [...seeded.labels.equipment].sort());
    assert.deepEqual(new Set(assets.vehicleTargets.map(value => value.targetId)), new Set(seeded.vehicles));
    assert.deepEqual(new Set(assets.equipmentTargets.map(value => value.targetId)), new Set(seeded.equipment));
    ledger.cases.push('Duplicate catalogue names use safe company references and model context while retaining the intended opaque vehicle or equipment target.');

    const rendered = [...labor.workerTargets, ...labor.jobTargets, ...assets.vehicleTargets, ...assets.equipmentTargets]
      .map(value => value.displayLabel).join('\n');
    assert.doesNotMatch(rendered, UUID); assert.doesNotMatch(rendered, /@|object[\s_-]*object|860[ .-]555[ .-]1212|[0-9a-f]{64}|\brequest\b|\bdigest\b/i);
    assert.equal((await request(fixture.app).get(`/api/v1/learning/external-labor-sources/${seeded.laborSource}/matches`)
      .set(fixture.actors.member.session.headers)).status, 403);
    const other = await request(fixture.app).get(`/api/v1/learning/external-labor-sources/${seeded.laborSource}/matches`)
      .set(fixture.actors.otherOwner.session.headers);
    assert.equal(other.status, 200); assert.deepEqual(other.body.data.workerTargets, []); assert.deepEqual(other.body.data.jobTargets, []);
    ledger.cases.push('Labels contain no UUID, contact, request or digest text; worker access is denied and another tenant sees no target labels.');

    const sanitizer = (await fixture.ownerPool.query(`SELECT
      canonical_learning_target_label_text('Crew [Object Object] · Technician',240) object_value,
      canonical_learning_target_label_text('Crew 860-555-1212 East · Technician',240) number_value,
      canonical_learning_target_label_text($1,240) digest_value,
      canonical_learning_target_label_text('Hash Tree Service',240) company_value,
      canonical_learning_target_label_text('Chip Truck · Ford F-550',240) model_value`, [`Crew ${'a'.repeat(64)} · Technician`])).rows[0];
    assert.deepEqual(sanitizer, { object_value: null, number_value: null, digest_value: null,
      company_value: 'Hash Tree Service', model_value: 'Chip Truck · Ford F-550' });
    ledger.cases.push('The PostgreSQL component gate rejects embedded serialization, contact-number and digest-shaped values without rejecting ordinary company or model labels.');

    const privileges = (await fixture.ownerPool.query(`SELECT
      has_function_privilege($1,'canonical_learning_reconciliation_target_labels_read(uuid,uuid,text,uuid)','EXECUTE') entry,
      has_function_privilege($1,'canonical_learning_target_label_text(text,integer)','EXECUTE') text_helper,
      has_function_privilege($1,'canonical_learning_target_label_compose(text,text,integer)','EXECUTE') compose_helper`, [fixture.roles.runtime])).rows[0];
    assert.deepEqual(privileges, { entry: true, text_helper: false, compose_helper: false });
    const bytes = fs.readFileSync(path.join(__dirname, '../../migrations/104_canonical_learning_match_labels.sql'));
    const checksum = crypto.createHash('sha256').update(bytes).digest('hex');
    const applied = (await fixture.ownerPool.query("SELECT trim(checksum) checksum FROM _migrations WHERE filename='104_canonical_learning_match_labels.sql'")).rows;
    assert.deepEqual(applied, [{ checksum }]);
    ledger.cases.push('Runtime authority is entry-only and the exact migration bytes match the applied PostgreSQL ledger.');
    ledger.pass = true;
  } catch (error) {
    ledger.error = error.stack; ledger.cause = error.cause && { message: error.cause.message, code: error.cause.code };
    process.exitCode = 1;
  } finally {
    if (fixture) await fixture.cleanup();
    fs.writeFileSync(output, JSON.stringify(ledger, null, 2));
    console.log(JSON.stringify(ledger));
  }
})();
