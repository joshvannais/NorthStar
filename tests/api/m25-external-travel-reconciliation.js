'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
process.env.NODE_ENV = 'test';
process.env.AUTH_ACCESS_SECRET = 'm25-external-travel-reconciliation-local-disposable-secret';
for (const key of ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'OPENAI_API_KEY', 'RETELL_API_KEY', 'STRIPE_SECRET_KEY']) delete process.env[key];
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const output = (process.argv.find(value => value.startsWith('--output=')) || '--output=m25-external-travel-reconciliation-result.json').slice(9);
assert.ok(!fs.existsSync(output));
const sourceKey = 'fleet.primary';
const route = (version = 1, distance = '23.4') => ({ externalRecordId: 'route-1', externalVersion: version,
  state: 'active', jobReference: 'job-19', vehicleReference: 'truck-2',
  routeStartedAt: '2026-09-15T12:00:00.000Z', routeEndedAt: '2026-09-15T12:48:00.000Z',
  timeZone: 'America/New_York', distance: { value: distance, unit: 'mi', basis: version === 1 ? 'gps' : 'odometer' },
  fuel: { quantity: '2.8', unit: 'us_gal', costAmount: '10.92', currency: 'USD', basis: 'fuel_card' },
  evidenceClass: 'provider_recorded', sourceUpdatedAt: version === 1 ? '2026-09-15T13:00:00.000Z' : '2026-09-15T14:00:00.000Z' });

(async () => {
  let fixture; const ledger = { cases: [] };
  try {
    fixture = await createDatabaseFixture({ operationalSchedule: true });
    const owner = fixture.actors.owner; const root = `/api/v1/learning/external-travel-sources/${sourceKey}`;
    const post = (suffix, body, key = crypto.randomUUID(), actor = owner) => request(fixture.app).post(root + suffix)
      .set(actor.session.headers).set('X-CSRF-Token', actor.csrfToken).set('Idempotency-Key', key).send(body);
    let response = await post('/consent', { action: 'grant', expectedRevision: 0, expectedDigest: 'none',
      reason: 'Enable reviewed travel reconciliation.', confirmed: true,
      confirmationVersion: 'm25-external-travel-import-consent-v1' });
    assert.equal(response.status, 201, JSON.stringify(response.body)); const consent = response.body.data.consent;
    const batch = (records, overrides = {}) => ({ schemaVersion: 'm25-external-travel-actual-v1', mode: 'continuous_update',
      expectedConsentRevision: consent.revision, expectedConsentDigest: consent.digest, cursorBefore: null,
      cursorAfter: 'cursor-1', complete: false, records, reason: 'Stage current reviewed route evidence.',
      confirmed: true, confirmationVersion: 'm25-external-travel-import-batch-v1', ...overrides });
    response = await post('/batches', batch([route()])); assert.equal(response.status, 201, JSON.stringify(response.body));

    const operationId = crypto.randomUUID(), graphId = crypto.randomUUID(), customerId = crypto.randomUUID();
    const transcriptId = crypto.randomUUID(), opportunityId = crypto.randomUUID();
    const fingerprint = crypto.createHash('sha256').update('m25-part9-travel-estimate').digest('hex');
    await fixture.ownerPool.query(`INSERT INTO canonical_operations(id,organization_id,graph_id,idempotency_key_hash,
      payload_fingerprint,state,lease_owner,lease_expires_at,result_status,result_body,completed_at)
      VALUES($1,$2,$3,$4,$4,'completed',$1,NOW()+INTERVAL '1 hour',200,'{}',NOW())`,
    [operationId, fixture.org, graphId, fingerprint]);
    await fixture.ownerPool.query("INSERT INTO canonical_customers(id,organization_id,operation_id,graph_id,name) VALUES($1,$2,$3,$4,'Travel customer')",
      [customerId, fixture.org, operationId, graphId]);
    await fixture.ownerPool.query(`INSERT INTO canonical_transcripts(id,organization_id,operation_id,graph_id,customer_id,
      source,source_version,transcript_text,normalized_fingerprint) VALUES($1,$2,$3,$4,$5,'lead','fixture','Reviewed external route',$6)`,
    [transcriptId, fixture.org, operationId, graphId, customerId, fingerprint]);
    await fixture.ownerPool.query(`INSERT INTO canonical_opportunities(id,organization_id,operation_id,graph_id,customer_id,
      status,service_type,job_scope) VALUES($1,$2,$3,$4,$5,'qualified','Tree Service','{}')`,
    [opportunityId, fixture.org, operationId, graphId, customerId]);
    const estimate = crypto.randomUUID(); const hash = 'b'.repeat(64);
    await fixture.ownerPool.query(`INSERT INTO canonical_estimates(id,organization_id,operation_id,graph_id,opportunity_id,
      calculation_version,normalized_input_fingerprint,business_profile_version,business_profile_hash,currency,
      customer_price,line_items,calculation_output,snapshot_digest) VALUES($1,$2,$3,$4,$5,'fixture-v1',$6,'org-profile-v1',$6,'USD',100,'[]','{}',$6)`,
    [estimate, fixture.org, operationId, graphId, opportunityId, hash]);

    const vehicle = crypto.randomUUID(), draft = crypto.randomUUID();
    await fixture.ownerPool.query(`INSERT INTO tenant_assets(id,organization_id,category,name,internal_reference,manufacturer,model,
      model_year,configuration,created_by_user_id,updated_by_user_id) VALUES($1,$2,'vehicle','Tree service truck','TRUCK-2','Ford','F-550',2024,'Chip body',$3,$3)`,
    [vehicle, fixture.org, owner.actorUserId]);
    const draftDocument = { fixture: 'reviewed vehicle' };
    const equipmentClient = await fixture.ownerPool.connect();
    try {
      await equipmentClient.query('BEGIN');
      await equipmentClient.query(`INSERT INTO canonical_equipment_drafts(organization_id,id,actor_user_id,session_id,revision,document,digest)
        VALUES($1,$2,$3,$4,1,$5,equipment_digest($5::jsonb))`, [fixture.org, draft, owner.actorUserId, owner.authSessionId, draftDocument]);
      await equipmentClient.query(`INSERT INTO canonical_equipment_receipts(organization_id,actor_user_id,session_id,key_hash,request_digest,action,subject_id,response)
        VALUES($1,$2,$3,$4,$5,'confirm',$6,'{"data":{"revision":1}}')`,
      [fixture.org, owner.actorUserId, owner.authSessionId, 'd'.repeat(64), 'c'.repeat(64), draft]);
      await equipmentClient.query(`INSERT INTO canonical_equipment_draft_history(organization_id,draft_id,revision,document,digest,actor_user_id,session_id,action,request_digest)
        VALUES($1,$2,1,$5,equipment_digest($5::jsonb),$3,$4,'confirm',$6)`,
      [fixture.org, draft, owner.actorUserId, owner.authSessionId, draftDocument, 'c'.repeat(64)]);
      await equipmentClient.query(`INSERT INTO canonical_equipment_asset_versions(organization_id,asset_id,asset_version,asset_snapshot,asset_digest,
        private_configuration,knowledge_version_id,knowledge_digest,category_label,review_state,draft_id,draft_revision,actor_user_id)
        SELECT organization_id,id,version,to_jsonb(a),equipment_digest(to_jsonb(a)),'{}',NULL,NULL,'Vehicle','reviewed',$2,1,$3
        FROM tenant_assets a WHERE organization_id=$1 AND id=$4`, [fixture.org, draft, owner.actorUserId, vehicle]);
      await equipmentClient.query('COMMIT');
    } catch (error) { await equipmentClient.query('ROLLBACK').catch(() => {}); throw error; } finally { equipmentClient.release(); }

    response = await request(fixture.app).get(root + '/matches').set(owner.session.headers);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const jobRef = response.body.data.references.find(value => value.referenceKind === 'job');
    const vehicleRef = response.body.data.references.find(value => value.referenceKind === 'vehicle');
    const jobTarget = response.body.data.jobTargets.find(value => value.targetId === estimate);
    const vehicleTarget = response.body.data.vehicleTargets.find(value => value.targetId === vehicle);
    assert.ok(jobRef && vehicleRef && jobTarget && vehicleTarget);
    ledger.cases.push('The guarded read lists current opaque job and vehicle references with bounded same-tenant reviewed targets and exact digests.');

    const match = (referenceKind, externalReference, sourceDigest, target, overrides = {}) => ({ referenceKind,
      externalReference, action: 'link', targetId: target.targetId, expectedRevision: 0, expectedDigest: 'none',
      expectedSourceDigest: sourceDigest, expectedTargetDigest: target.digest,
      reason: 'Owner reviewed the current source reference and target.', confirmed: true,
      confirmationVersion: 'm25-external-travel-reference-match-v1', ...overrides });
    const jobBody = match('job', 'job-19', jobRef.sourceDigest, jobTarget); const jobKey = crypto.randomUUID();
    const probe = await fixture.runtimePool.connect();
    try { await probe.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await probe.query('SELECT public.canonical_external_travel_reference_match_mutate($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
        [fixture.org, owner.actorUserId, owner.actorAccessRole, owner.authSessionId, owner.csrfToken, crypto.randomUUID(), sourceKey, JSON.stringify(jobBody)]);
      await probe.query('ROLLBACK');
    } catch (error) { await probe.query('ROLLBACK').catch(() => {}); throw error; } finally { probe.release(); }
    response = await post('/matches', jobBody, jobKey); assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.data.match.status, 'matched'); const jobMatch = response.body.data.match;
    const replay = await post('/matches', jobBody, jobKey); assert.equal(replay.status, 200); assert.equal(replay.headers['idempotency-replayed'], 'true');
    assert.equal((await post('/matches', { ...jobBody, reason: 'Changed key reuse.' }, jobKey)).status, 409);
    const vehicleBody = match('vehicle', 'truck-2', vehicleRef.sourceDigest, vehicleTarget); const vehicleKey = crypto.randomUUID();
    response = await post('/matches', vehicleBody, vehicleKey); assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.data.match.status, 'matched'); const vehicleMatch = response.body.data.match;
    ledger.cases.push('Explicit reviewed job and vehicle links are immutable, replayable and reject changed request-key reuse.');

    await fixture.ownerPool.query("UPDATE tenant_assets SET name='Tree service truck revised',updated_at=transaction_timestamp() WHERE organization_id=$1 AND id=$2",
      [fixture.org, vehicle]);
    response = await request(fixture.app).get(root + '/matches').set(owner.session.headers);
    assert.equal(response.body.data.references.find(value => value.referenceKind === 'vehicle').match.status, 'stale');
    assert.equal(response.body.data.references.find(value => value.referenceKind === 'job').match.status, 'matched');
    ledger.cases.push('A reviewed vehicle identity change stales only its saved link and never silently retargets it.');

    const memberAttempt = await post('/matches', jobBody, crypto.randomUUID(), fixture.actors.member);
    assert.equal(memberAttempt.status, 403); const other = await request(fixture.app).get(root + '/matches').set(fixture.actors.otherOwner.session.headers);
    assert.equal(other.status, 200); assert.deepEqual(other.body.data.references, []);
    ledger.cases.push('A worker cannot reconcile references and another tenant receives no reference or target signal.');

    response = await post('/batches', batch([route(2, '25.1')], { cursorBefore: 'cursor-1', cursorAfter: 'cursor-2' }));
    assert.equal(response.status, 201, JSON.stringify(response.body));
    response = await request(fixture.app).get(root + '/matches').set(owner.session.headers);
    const changedJob = response.body.data.references.find(value => value.referenceKind === 'job');
    const changedVehicle = response.body.data.references.find(value => value.referenceKind === 'vehicle');
    assert.equal(changedJob.match.status, 'stale'); assert.equal(changedVehicle.match.status, 'stale');
    assert.equal((await post('/matches', { ...jobBody, expectedRevision: jobMatch.revision, expectedDigest: jobMatch.digest })).status, 409);
    ledger.cases.push('A higher source version changes both reference manifests, marks prior links stale and rejects stale source pins.');

    const unlink = { referenceKind: 'vehicle', externalReference: 'truck-2', action: 'unlink', targetId: null,
      expectedRevision: vehicleMatch.revision, expectedDigest: vehicleMatch.digest, expectedSourceDigest: changedVehicle.sourceDigest,
      expectedTargetDigest: 'unavailable', reason: 'Remove the reviewed vehicle link.', confirmed: true,
      confirmationVersion: 'm25-external-travel-reference-match-v1' };
    response = await post('/matches', unlink); assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.data.match.status, 'unmatched');
    const before = (await fixture.ownerPool.query('SELECT count(*)::int count FROM canonical_external_travel_reference_matches')).rows[0].count;
    const direct = await fixture.runtimePool.connect(); let directError;
    try { await direct.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await direct.query('SELECT public.canonical_external_travel_reference_match_mutate($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
        [fixture.org, owner.actorUserId, owner.actorAccessRole, owner.authSessionId, owner.csrfToken, crypto.randomUUID(), sourceKey,
          JSON.stringify({ ...unlink, expectedRevision: null, expectedDigest: null })]);
    } catch (error) { directError = error; } finally { await direct.query('ROLLBACK').catch(() => {}); direct.release(); }
    assert.equal(directError && directError.code, '22023');
    assert.equal((await fixture.ownerPool.query('SELECT count(*)::int count FROM canonical_external_travel_reference_matches')).rows[0].count, before);
    ledger.cases.push('Explicit unlink is append-only and the database rejects null concurrency pins without a partial write.');

    const tombstone = { externalRecordId: 'route-1', externalVersion: 3, state: 'tombstone', jobReference: null,
      vehicleReference: null, routeStartedAt: null, routeEndedAt: null, timeZone: null, distance: null, fuel: null,
      evidenceClass: null, sourceUpdatedAt: '2026-09-15T15:00:00.000Z' };
    response = await post('/batches', batch([tombstone], { cursorBefore: 'cursor-2', cursorAfter: 'cursor-3' }));
    assert.equal(response.status, 201, JSON.stringify(response.body));
    response = await request(fixture.app).get(root + '/matches').set(owner.session.headers);
    assert.equal(response.body.data.references.find(value => value.referenceKind === 'job').match.status, 'stale');
    assert.equal(response.body.data.references.find(value => value.referenceKind === 'vehicle').match.status, 'unmatched');
    ledger.cases.push('A source tombstone removes current route details while retaining saved links as stale or unmatched review history.');

    const privileges = (await fixture.ownerPool.query(`SELECT
      has_table_privilege($1,'canonical_external_travel_reference_matches','SELECT') match_table,
      has_function_privilege($1,'canonical_external_travel_reference_source_basis(uuid,text,text,text)','EXECUTE') helper,
      has_function_privilege($1,'canonical_external_travel_reference_matches_read(uuid,uuid,text,uuid,text)','EXECUTE') read_entry,
      has_function_privilege($1,'canonical_external_travel_reference_match_mutate(uuid,uuid,text,uuid,text,text,text,jsonb)','EXECUTE') write_entry`,
    [fixture.roles.runtime])).rows[0];
    assert.deepEqual(privileges, { match_table: false, helper: false, read_entry: true, write_entry: true });
    await assert.rejects(fixture.ownerPool.query('DELETE FROM canonical_external_travel_reference_matches'));
    const bytes = fs.readFileSync(path.join(__dirname, '../../migrations/091_canonical_external_travel_reconciliation.sql'));
    const checksum = crypto.createHash('sha256').update(bytes).digest('hex');
    assert.deepEqual((await fixture.ownerPool.query("SELECT trim(checksum) checksum FROM _migrations WHERE filename='091_canonical_external_travel_reconciliation.sql'")).rows, [{ checksum }]);
    ledger.cases.push('Runtime access is limited to guarded entries, link history is immutable and the exact migration is recorded once.');

    response = await post('/consent', { action: 'revoke', expectedRevision: consent.revision, expectedDigest: consent.digest,
      reason: 'Stop using this source for reconciliation.', confirmed: true,
      confirmationVersion: 'm25-external-travel-import-consent-v1' });
    assert.equal(response.status, 201); const revoked = response.body.data.consent;
    const hidden = await request(fixture.app).get(root + '/matches').set(owner.session.headers);
    assert.equal(hidden.body.data.activeConsent, false); assert.deepEqual(hidden.body.data.references, []);
    assert.deepEqual(hidden.body.data.jobTargets, []); assert.deepEqual(hidden.body.data.vehicleTargets, []);
    const delayedReplay = await post('/matches', jobBody, jobKey); assert.equal(delayedReplay.status, 200);
    assert.equal(delayedReplay.headers['idempotency-replayed'], 'true'); assert.equal(delayedReplay.body.data.match.status, 'stale');
    assert.equal((await post('/matches', { ...jobBody, reason: 'Changed after revocation.' }, jobKey)).status, 409);
    assert.equal((await post('/matches', jobBody)).status, 409);
    ledger.cases.push('Revocation hides reconciliation and blocks new writes while exact delayed retries preserve immutable replay and conflict semantics.');
    response = await post('/consent', { action: 'grant', expectedRevision: revoked.revision, expectedDigest: revoked.digest,
      reason: 'Re-enable the source under a new consent revision.', confirmed: true,
      confirmationVersion: 'm25-external-travel-import-consent-v1' });
    assert.equal(response.status, 201); const regranted = await request(fixture.app).get(root + '/matches').set(owner.session.headers);
    assert.equal(regranted.body.data.references.find(value => value.referenceKind === 'job').match.status, 'stale');
    ledger.cases.push('Re-granting consent does not resurrect a link approved under an earlier consent revision.');
    ledger.pass = true;
  } catch (error) { const source = error.cause || error; ledger.error = error.stack; ledger.cause = { message: source.message, code: source.code,
    constraint: source.constraint, detail: source.detail, where: source.where, position: source.position }; process.exitCode = 1;
  } finally { if (fixture) await fixture.cleanup(); fs.writeFileSync(output, JSON.stringify(ledger, null, 2)); console.log(JSON.stringify(ledger)); }
})();
