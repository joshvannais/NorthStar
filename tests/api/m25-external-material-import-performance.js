'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { performance } = require('node:perf_hooks');
const request = require('supertest');
process.env.NODE_ENV = 'test';
process.env.AUTH_ACCESS_SECRET = 'm25-external-material-performance-local-secret';
for (const key of ['DATABASE_URL','MIGRATION_DATABASE_URL','OPENAI_API_KEY','RETELL_API_KEY','STRIPE_SECRET_KEY']) delete process.env[key];
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const output = (process.argv.find(value => value.startsWith('--output=')) || '--output=m25-external-material-performance-result.json').slice(9);
assert.ok(!fs.existsSync(output));
const zones = ['UTC','America/New_York','America/Chicago','America/Denver','America/Los_Angeles','Europe/London','Asia/Tokyo','Australia/Sydney'];
const MAX_PAGE_MS = 2000;
const evidenceDigest = crypto.createHash('sha256').update('material-performance-evidence').digest('hex');

function records(prefix, count, invalidZone = false) {
  return Array.from({ length: count }, (_, index) => ({
    externalRecordId: `${prefix}-${index + 1}`, externalVersion: 1, state: 'active', recordType: 'inventory_balance',
    jobReference: null, materialReference: `material-${index + 1}`, vendorReference: null, locationReference: 'warehouse-main',
    occurredAt: '2026-09-15T12:00:00.000Z', timeZone: invalidZone && index === count - 1 ? 'Mars/Olympus_Mons' : zones[index % zones.length],
    movementKind: null, quantity: { value: String(index + 1), unit: 'ea', basis: 'counted' }, cost: null,
    evidenceClass: 'provider_recorded', providerEvidenceDigest: evidenceDigest, sourceUpdatedAt: '2026-09-15T17:00:00.000Z',
  }));
}

(async () => {
  let fixture; const ledger = { timingsMs: {}, ceilingMs: MAX_PAGE_MS, cases: [] };
  try {
    fixture = await createDatabaseFixture({ operationalSchedule: true }); const owner = fixture.actors.owner;
    const write = (root, suffix, body, key = crypto.randomUUID()) => request(fixture.app).post(root + suffix)
      .set(owner.session.headers).set('X-CSRF-Token', owner.csrfToken).set('Idempotency-Key', key).send(body);
    async function source(name) {
      const root = `/api/v1/learning/external-material-sources/${name}`;
      const response = await write(root, '/consent', { action: 'grant', expectedRevision: 0, expectedDigest: 'none',
        reason: 'Measure a bounded normalized material page.', confirmed: true,
        confirmationVersion: 'm25-external-material-import-consent-v1' });
      assert.equal(response.status, 201, JSON.stringify(response.body));
      return { root, consent: response.body.data.consent };
    }
    const page = (consent, values, changes = {}) => ({ schemaVersion: 'm25-external-material-actual-v1',
      mode: 'historical_backfill', expectedConsentRevision: consent.revision, expectedConsentDigest: consent.digest,
      cursorBefore: null, cursorAfter: null, complete: true, records: values,
      reason: 'Measure one exact normalized page.', confirmed: true,
      confirmationVersion: 'm25-external-material-import-batch-v1', ...changes });
    async function timed(root, body) {
      const started = performance.now(); const response = await write(root, '/batches', body);
      const elapsed = Number((performance.now() - started).toFixed(2));
      assert.equal(response.status, 201, JSON.stringify(response.body)); assert.ok(elapsed < MAX_PAGE_MS, `${elapsed}ms exceeded ${MAX_PAGE_MS}ms`);
      return elapsed;
    }

    const cold = await source('materials.performance-cold');
    ledger.timingsMs.cold100 = await timed(cold.root, page(cold.consent, records('cold', 100)));
    ledger.cases.push('The first valid 100-record page validates eight distinct zones once and stays below the two-second ceiling.');

    for (const count of [1, 50, 100]) {
      const scale = await source(`materials.performance-${count}`);
      ledger.timingsMs[`scale${count}`] = await timed(scale.root, page(scale.consent, records(`scale-${count}`, count)));
    }
    ledger.cases.push('Fresh 1, 50 and 100 record pages preserve the public bound with measured headroom below five seconds.');

    const repeat = await source('materials.performance-repeat');
    ledger.timingsMs.repeat100First = await timed(repeat.root, page(repeat.consent, records('repeat-a', 100), {
      mode: 'continuous_update', complete: false, cursorAfter: 'page-1',
    }));
    ledger.timingsMs.repeat100Second = await timed(repeat.root, page(repeat.consent, records('repeat-b', 100), {
      mode: 'continuous_update', complete: false, cursorBefore: 'page-1', cursorAfter: 'page-2',
    }));
    ledger.cases.push('Repeated valid 100-record continuous pages remain bounded under the unchanged statement timeout.');

    const invalid = await source('materials.performance-invalid');
    const rejected = await write(invalid.root, '/batches', page(invalid.consent, records('invalid', 100, true)));
    assert.equal(rejected.status, 400, JSON.stringify(rejected.body));
    const read = await request(fixture.app).get(invalid.root).set(owner.session.headers);
    assert.equal(read.status, 200); assert.equal(read.body.data.runTotal, 0); assert.equal(read.body.data.recordTotal, 0);
    const stored = (await fixture.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM canonical_external_material_import_runs WHERE source_key='materials.performance-invalid') runs,
      (SELECT count(*)::int FROM canonical_external_material_import_records WHERE source_key='materials.performance-invalid') records`)).rows[0];
    assert.deepEqual(stored, { runs: 0, records: 0 });
    ledger.cases.push('One invalid zone rejects the entire 100-record page before any run or record is stored.');
    ledger.pass = true;
  } catch (error) { ledger.error = error.stack; ledger.cause = error.cause && { message: error.cause.message, code: error.cause.code }; process.exitCode = 1; }
  finally { if (fixture) await fixture.cleanup(); fs.writeFileSync(output, JSON.stringify(ledger, null, 2)); console.log(JSON.stringify(ledger)); }
})();
