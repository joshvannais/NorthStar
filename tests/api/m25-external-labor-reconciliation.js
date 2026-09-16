'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
process.env.NODE_ENV = 'test';
process.env.AUTH_ACCESS_SECRET = 'm25-external-labor-reconciliation-local-disposable-secret';
for (const key of ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'OPENAI_API_KEY', 'RETELL_API_KEY', 'STRIPE_SECRET_KEY']) delete process.env[key];
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const output = (process.argv.find(value => value.startsWith('--output=')) || '--output=m25-external-labor-reconciliation-result.json').slice(9);
assert.ok(!fs.existsSync(output));
const sourceKey = 'payroll.primary';
const record = (version = 1, end = '2026-09-15T17:00:00.000Z') => ({ externalRecordId: 'shift-1', externalVersion: version,
  state: 'active', workerReference: 'worker-7', jobReference: 'job-19', category: 'production',
  observedStart: '2026-09-15T13:00:00.000Z', observedEnd: end, sourceUpdatedAt: end });

(async () => {
  let fixture; const ledger = { cases: [] };
  try {
    fixture = await createDatabaseFixture({ operationalSchedule: true });
    const owner = fixture.actors.owner; const root = `/api/v1/learning/external-labor-sources/${sourceKey}`;
    const post = (suffix, body, key = crypto.randomUUID(), actor = owner) => request(fixture.app).post(root + suffix)
      .set(actor.session.headers).set('X-CSRF-Token', actor.csrfToken).set('Idempotency-Key', key).send(body);
    let response = await post('/consent', { action: 'grant', expectedRevision: 0, expectedDigest: 'none',
      reason: 'Enable reviewed reconciliation.', confirmed: true, confirmationVersion: 'm25-external-labor-import-consent-v1' });
    assert.equal(response.status, 201, JSON.stringify(response.body)); const consent = response.body.data.consent;
    const batch = (records, overrides = {}) => ({ schemaVersion: 'm25-external-labor-time-v1', mode: 'continuous_update',
      expectedConsentRevision: consent.revision, expectedConsentDigest: consent.digest, cursorBefore: null,
      cursorAfter: 'cursor-1', complete: false, records, reason: 'Stage current reviewed source evidence.',
      confirmed: true, confirmationVersion: 'm25-external-labor-import-batch-v1', ...overrides });
    response = await post('/batches', batch([record()])); assert.equal(response.status, 201, JSON.stringify(response.body));

    const operationId = crypto.randomUUID(), graphId = crypto.randomUUID(), customerId = crypto.randomUUID();
    const transcriptId = crypto.randomUUID(), opportunityId = crypto.randomUUID();
    const fingerprint = crypto.createHash('sha256').update('m25-part4-estimate').digest('hex');
    await fixture.ownerPool.query(`INSERT INTO canonical_operations(id,organization_id,graph_id,idempotency_key_hash,
      payload_fingerprint,state,lease_owner,lease_expires_at,result_status,result_body,completed_at)
      VALUES($1,$2,$3,$4,$4,'completed',$1,NOW()+INTERVAL '1 hour',200,'{}',NOW())`,
    [operationId, fixture.org, graphId, fingerprint]);
    await fixture.ownerPool.query("INSERT INTO canonical_customers(id,organization_id,operation_id,graph_id,name) VALUES($1,$2,$3,$4,'Reconciliation customer')",
      [customerId, fixture.org, operationId, graphId]);
    await fixture.ownerPool.query(`INSERT INTO canonical_transcripts(id,organization_id,operation_id,graph_id,customer_id,
      source,source_version,transcript_text,normalized_fingerprint) VALUES($1,$2,$3,$4,$5,'lead','fixture','Reviewed external job',$6)`,
    [transcriptId, fixture.org, operationId, graphId, customerId, fingerprint]);
    await fixture.ownerPool.query(`INSERT INTO canonical_opportunities(id,organization_id,operation_id,graph_id,customer_id,
      status,service_type,job_scope) VALUES($1,$2,$3,$4,$5,'qualified','Tree Service','{}')`,
    [opportunityId, fixture.org, operationId, graphId, customerId]);
    const estimate = crypto.randomUUID(); const hash = 'a'.repeat(64);
    await fixture.ownerPool.query(`INSERT INTO canonical_estimates(id,organization_id,operation_id,graph_id,opportunity_id,
      calculation_version,normalized_input_fingerprint,business_profile_version,business_profile_hash,currency,
      customer_price,line_items,calculation_output,snapshot_digest) VALUES($1,$2,$3,$4,$5,'fixture-v1',$6,'org-profile-v1',$6,'USD',100,'[]','{}',$6)`,
    [estimate, fixture.org, operationId, graphId, opportunityId, hash]);

    response = await request(fixture.app).get(root + '/matches').set(owner.session.headers);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const workerRef = response.body.data.references.find(value => value.referenceKind === 'worker');
    const jobRef = response.body.data.references.find(value => value.referenceKind === 'job');
    const workerTarget = response.body.data.workerTargets.find(value => value.targetId === fixture.actors.member.actorUserId);
    const jobTarget = response.body.data.jobTargets.find(value => value.targetId === estimate);
    assert.ok(workerRef && jobRef && workerTarget && jobTarget);
    ledger.cases.push('The guarded read lists current opaque references and bounded same-tenant targets with exact digests.');

    const match = (referenceKind, externalReference, sourceDigest, target, overrides = {}) => ({ referenceKind,
      externalReference, action: 'link', targetId: target.targetId, expectedRevision: 0, expectedDigest: 'none',
      expectedSourceDigest: sourceDigest, expectedTargetDigest: target.digest,
      reason: 'Owner reviewed the current source reference and target.', confirmed: true,
      confirmationVersion: 'm25-external-labor-reference-match-v1', ...overrides });
    const workerBody = match('worker', 'worker-7', workerRef.sourceDigest, workerTarget); const workerKey = crypto.randomUUID();
    response = await post('/matches', workerBody, workerKey); assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.data.match.status, 'matched'); const workerMatch = response.body.data.match;
    const replay = await post('/matches', workerBody, workerKey); assert.equal(replay.status, 200); assert.equal(replay.headers['idempotency-replayed'], 'true');
    assert.equal((await post('/matches', { ...workerBody, reason: 'Changed reuse.' }, workerKey)).status, 409);
    response = await post('/matches', match('job', 'job-19', jobRef.sourceDigest, jobTarget));
    assert.equal(response.status, 201, JSON.stringify(response.body)); assert.equal(response.body.data.match.status, 'matched');
    ledger.cases.push('Explicit reviewed worker and job links are immutable, replayable and reject changed key reuse.');

    await fixture.ownerPool.query("UPDATE workforce_profiles SET operational_role='crew_lead',updated_at=transaction_timestamp() WHERE organization_id=$1 AND id=$2",
      [fixture.org, fixture.actors.member.actorUserId]);
    response = await request(fixture.app).get(root + '/matches').set(owner.session.headers);
    assert.equal(response.body.data.references.find(value => value.referenceKind === 'worker').match.status, 'stale');
    assert.equal(response.body.data.references.find(value => value.referenceKind === 'job').match.status, 'matched');
    ledger.cases.push('A current workforce-profile change stales only the worker link and never silently retargets it.');

    const memberAttempt = await post('/matches', workerBody, crypto.randomUUID(), fixture.actors.member);
    assert.equal(memberAttempt.status, 403); assert.equal(memberAttempt.body.error.code, 'M25_IMPORT_FORBIDDEN');
    const other = await request(fixture.app).get(root + '/matches').set(fixture.actors.otherOwner.session.headers);
    assert.equal(other.status, 200); assert.deepEqual(other.body.data.references, []);
    ledger.cases.push('A worker cannot reconcile references and another tenant receives no reference or target signal.');

    response = await post('/batches', batch([record(2, '2026-09-15T18:00:00.000Z')], { cursorBefore: 'cursor-1', cursorAfter: 'cursor-2' }));
    assert.equal(response.status, 201, JSON.stringify(response.body));
    response = await request(fixture.app).get(root + '/matches').set(owner.session.headers);
    assert.equal(response.status, 200); const changedWorker = response.body.data.references.find(value => value.referenceKind === 'worker');
    assert.equal(changedWorker.match.status, 'stale');
    assert.equal((await post('/matches', { ...workerBody, expectedRevision: workerMatch.revision,
      expectedDigest: workerMatch.digest })).status, 409);
    ledger.cases.push('A higher source version changes the source manifest, marks prior links stale and rejects stale source pins.');

    const unlink = { referenceKind: 'worker', externalReference: 'worker-7', action: 'unlink', targetId: null,
      expectedRevision: workerMatch.revision, expectedDigest: workerMatch.digest,
      expectedSourceDigest: changedWorker.sourceDigest, expectedTargetDigest: 'unavailable', reason: 'Remove the reviewed link.',
      confirmed: true, confirmationVersion: 'm25-external-labor-reference-match-v1' };
    response = await post('/matches', unlink); assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.data.match.status, 'unmatched');
    const before = (await fixture.ownerPool.query('SELECT count(*)::int count FROM canonical_external_labor_import_reference_matches')).rows[0].count;
    const direct = await fixture.runtimePool.connect(); let directError;
    try { await direct.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await direct.query('SELECT public.canonical_external_labor_reference_match_mutate($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
        [fixture.org, owner.actorUserId, owner.actorAccessRole, owner.authSessionId, owner.csrfToken, crypto.randomUUID(), sourceKey,
          JSON.stringify({ ...unlink, expectedRevision: 2, expectedDigest: response.body.data.match.digest, confirmed: false })]);
    } catch (error) { directError = error; } finally { await direct.query('ROLLBACK').catch(() => {}); direct.release(); }
    assert.equal(directError && directError.code, '22023');
    assert.equal((await fixture.ownerPool.query('SELECT count(*)::int count FROM canonical_external_labor_import_reference_matches')).rows[0].count, before);
    ledger.cases.push('Explicit unlink is append-only and the database rejects an unconfirmed direct runtime mutation without a partial write.');

    const tombstone = { externalRecordId: 'shift-1', externalVersion: 3, state: 'tombstone', workerReference: null,
      jobReference: null, category: null, observedStart: null, observedEnd: null, sourceUpdatedAt: '2026-09-15T19:00:00.000Z' };
    response = await post('/batches', batch([tombstone], { cursorBefore: 'cursor-2', cursorAfter: 'cursor-3' }));
    assert.equal(response.status, 201, JSON.stringify(response.body));
    response = await request(fixture.app).get(root + '/matches').set(owner.session.headers);
    assert.equal(response.body.data.references.find(value => value.referenceKind === 'worker').match.status, 'unmatched');
    assert.equal(response.body.data.references.find(value => value.referenceKind === 'job').match.status, 'stale');
    ledger.cases.push('A source tombstone removes current work details while retaining prior matches as visible stale review history.');

    const privileges = (await fixture.ownerPool.query(`SELECT
      has_table_privilege($1,'canonical_external_labor_import_reference_matches','SELECT') match_table,
      has_function_privilege($1,'canonical_external_labor_reference_source_basis(uuid,text,text,text)','EXECUTE') helper,
      has_function_privilege($1,'canonical_external_labor_reference_matches_read(uuid,uuid,text,uuid,text)','EXECUTE') read_entry,
      has_function_privilege($1,'canonical_external_labor_reference_match_mutate(uuid,uuid,text,uuid,text,text,text,jsonb)','EXECUTE') write_entry`,
    [fixture.roles.runtime])).rows[0];
    assert.deepEqual(privileges, { match_table: false, helper: false, read_entry: true, write_entry: true });
    await assert.rejects(fixture.ownerPool.query('DELETE FROM canonical_external_labor_import_reference_matches'));
    const bytes = fs.readFileSync(path.join(__dirname, '../../migrations/085_canonical_external_labor_reconciliation.sql'));
    const checksum = crypto.createHash('sha256').update(bytes).digest('hex');
    const applied = (await fixture.ownerPool.query("SELECT trim(checksum) checksum FROM _migrations WHERE filename='085_canonical_external_labor_reconciliation.sql'")).rows;
    assert.deepEqual(applied, [{ checksum }]);
    ledger.cases.push('Runtime access is limited to guarded entries, match history is immutable and the exact migration is recorded once.');

    response = await post('/consent', { action: 'revoke', expectedRevision: consent.revision, expectedDigest: consent.digest,
      reason: 'Stop using this source for reconciliation.', confirmed: true,
      confirmationVersion: 'm25-external-labor-import-consent-v1' });
    assert.equal(response.status, 201); const revoked = response.body.data.consent;
    const hidden = await request(fixture.app).get(root + '/matches').set(owner.session.headers);
    assert.equal(hidden.body.data.activeConsent, false); assert.deepEqual(hidden.body.data.references, []);
    assert.deepEqual(hidden.body.data.workerTargets, []); assert.deepEqual(hidden.body.data.jobTargets, []);
    assert.equal((await post('/matches', workerBody)).status, 409);
    ledger.cases.push('Consent revocation hides references and candidate targets and blocks further reconciliation writes.');
    response = await post('/consent', { action: 'grant', expectedRevision: revoked.revision, expectedDigest: revoked.digest,
      reason: 'Re-enable the source under a new consent revision.', confirmed: true,
      confirmationVersion: 'm25-external-labor-import-consent-v1' });
    assert.equal(response.status, 201); const regranted = await request(fixture.app).get(root + '/matches').set(owner.session.headers);
    assert.equal(regranted.body.data.references.find(value => value.referenceKind === 'job').match.status, 'stale');
    ledger.cases.push('Re-granting consent does not resurrect a match approved under an earlier consent revision.');
    ledger.pass = true;
  } catch (error) { ledger.error = error.stack; ledger.cause = error.cause && { message: error.cause.message, code: error.cause.code,
    constraint: error.cause.constraint, detail: error.cause.detail }; process.exitCode = 1;
  } finally { if (fixture) await fixture.cleanup(); fs.writeFileSync(output, JSON.stringify(ledger, null, 2)); console.log(JSON.stringify(ledger)); }
})();
