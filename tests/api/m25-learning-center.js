'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
process.env.NODE_ENV = 'test';
process.env.AUTH_ACCESS_SECRET = 'm25-learning-center-local-disposable-secret';
for (const key of ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'OPENAI_API_KEY', 'RETELL_API_KEY', 'STRIPE_SECRET_KEY']) delete process.env[key];
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const output = (process.argv.find(value => value.startsWith('--output=')) || '--output=m25-learning-center-result.json').slice(9);
assert.ok(!fs.existsSync(output));

(async () => {
  let f; const ledger = { cases: [] };
  try {
    f = await createDatabaseFixture({ operationalSchedule: true });
    const route = '/api/v1/learning/center';
    let response = await request(f.app).get(route).set(f.actors.owner.session.headers);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.data.version, 'm25-learning-center-v3');
    assert.equal(response.body.data.authority, 'tenant_private_postgresql');
    assert.equal(response.body.data.nativeEquipment.active, false);
    assert.deepEqual(response.body.data.sources, []);
    assert.match(response.body.data.learningBoundary, /does not automatically change estimates/);
    ledger.cases.push('An owner reads an empty bounded tenant-private Learning Center projection.');

    assert.equal((await request(f.app).get(route).set(f.actors.member.session.headers)).status, 403);
    response = await request(f.app).get(route).set(f.actors.otherOwner.session.headers);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.deepEqual(response.body.data.sources, []);
    ledger.cases.push('Members are denied and another tenant receives only its own empty source inventory.');

    const source = 'crewclock.primary';
    response = await request(f.app).post(`/api/v1/learning/external-labor-sources/${source}/consent`)
      .set(f.actors.owner.session.headers).set('X-CSRF-Token', f.actors.owner.csrfToken)
      .set('Idempotency-Key', crypto.randomUUID()).send({ action: 'grant', expectedRevision: 0, expectedDigest: 'none',
        reason: 'Enable the owner-reviewed Learning Center source.', confirmed: true,
        confirmationVersion: 'm25-external-labor-import-consent-v1' });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    response = await request(f.app).get(route).set(f.actors.owner.session.headers);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.data.sourceTotal, 1);
    assert.deepEqual(response.body.data.sources, [{ sourceKind: 'labor', sourceKey: source, serviceKeys: [], serviceTotal: 0, servicesTruncated: false }]);
    ledger.cases.push('A consented source appears through the read model without inventing service history.');

    response = await request(f.app).post(`/api/v1/learning/external-travel-sources/${source}/consent`)
      .set(f.actors.owner.session.headers).set('X-CSRF-Token', f.actors.owner.csrfToken)
      .set('Idempotency-Key', crypto.randomUUID()).send({ action: 'grant', expectedRevision: 0, expectedDigest: 'none',
        reason: 'Enable the owner-reviewed travel source.', confirmed: true,
        confirmationVersion: 'm25-external-travel-import-consent-v1' });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    response = await request(f.app).get(route).set(f.actors.owner.session.headers);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.data.sourceTotal, 2);
    assert.deepEqual(response.body.data.sources, [
      { sourceKind: 'labor', sourceKey: source, serviceKeys: [], serviceTotal: 0, servicesTruncated: false },
      { sourceKind: 'travel', sourceKey: source, serviceKeys: [], serviceTotal: 0, servicesTruncated: false },
    ]);
    ledger.cases.push('Labor and travel sources with the same tenant label remain distinct and bounded.');

    response = await request(f.app).post(`/api/v1/learning/external-asset-sources/${source}/consent`)
      .set(f.actors.owner.session.headers).set('X-CSRF-Token', f.actors.owner.csrfToken)
      .set('Idempotency-Key', crypto.randomUUID()).send({ action: 'grant', expectedRevision: 0, expectedDigest: 'none',
        reason: 'Enable the owner-reviewed vehicle and equipment source.', confirmed: true,
        confirmationVersion: 'm25-external-asset-import-consent-v1' });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    response = await request(f.app).get(route).set(f.actors.owner.session.headers);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.data.sourceTotal, 3);
    assert.deepEqual(response.body.data.sources, [
      { sourceKind: 'asset', sourceKey: source, serviceKeys: [], serviceTotal: 0, servicesTruncated: false },
      { sourceKind: 'labor', sourceKey: source, serviceKeys: [], serviceTotal: 0, servicesTruncated: false },
      { sourceKind: 'travel', sourceKey: source, serviceKeys: [], serviceTotal: 0, servicesTruncated: false },
    ]);
    ledger.cases.push('Vehicle and equipment history remains a distinct tenant-private source category.');

    const privileges = (await f.ownerPool.query(`SELECT
      has_function_privilege($1,'canonical_learning_center_read(uuid,uuid,text,uuid)','EXECUTE') entry,
      has_table_privilege($1,'canonical_external_labor_import_consents','SELECT') source_table`, [f.roles.runtime])).rows[0];
    assert.deepEqual(privileges, { entry: true, source_table: false });
    const bytes = fs.readFileSync(path.join(__dirname, '../../migrations/103_canonical_learning_center_assets.sql'));
    const checksum = crypto.createHash('sha256').update(bytes).digest('hex');
    const applied = (await f.ownerPool.query("SELECT trim(checksum) checksum FROM _migrations WHERE filename='103_canonical_learning_center_assets.sql'")).rows;
    assert.deepEqual(applied, [{ checksum }]);
    ledger.cases.push('Runtime access stays entry-only and the applied migration checksum matches exact bytes.');
    ledger.pass = true;
  } catch (error) {
    ledger.error = error.stack;
    ledger.cause = error.cause && { message: error.cause.message, code: error.cause.code, constraint: error.cause.constraint, detail: error.cause.detail };
    process.exitCode = 1;
  } finally {
    if (f) await f.cleanup();
    fs.writeFileSync(output, JSON.stringify(ledger, null, 2));
    console.log(JSON.stringify(ledger));
  }
})();
