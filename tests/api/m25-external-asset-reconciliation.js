'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
process.env.NODE_ENV = 'test';
process.env.AUTH_ACCESS_SECRET = 'm25-external-asset-reconciliation-local-disposable-secret';
for (const key of ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'OPENAI_API_KEY', 'RETELL_API_KEY', 'STRIPE_SECRET_KEY']) delete process.env[key];
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const output = (process.argv.find(value => value.startsWith('--output=')) || '--output=m25-external-asset-reconciliation-result.json').slice(9);
assert.ok(!fs.existsSync(output));
const sourceKey = 'fleet.primary';
const providerDigest = crypto.createHash('sha256').update('opaque-asset-evidence').digest('hex');
const record = (category, version = 1, state = 'active') => {
  const value = { externalRecordId: `${category}-record`, externalVersion: version, state, recordType: 'utilization',
    jobReference: 'job-19', assetReference: category === 'vehicle' ? 'truck-2' : 'chipper-2', assetCategory: category,
    periodStartedAt: '2026-09-15T12:00:00.000Z', periodEndedAt: '2026-09-15T16:00:00.000Z', timeZone: 'America/New_York',
    utilization: { value: version === 1 ? '4.0' : '5.0', unit: 'engine_hour', basis: version === 1 ? 'telematics' : 'meter' },
    cost: null, maintenance: null, downtime: null, evidenceClass: 'provider_recorded', providerEvidenceDigest: providerDigest,
    sourceUpdatedAt: version === 1 ? '2026-09-15T17:00:00.000Z' : '2026-09-15T18:00:00.000Z' };
  if (state === 'tombstone') for (const key of Object.keys(value)) if (!['externalRecordId', 'externalVersion', 'state', 'sourceUpdatedAt'].includes(key)) value[key] = null;
  return value;
};

(async () => {
  let fixture; const ledger = { cases: [] };
  try {
    fixture = await createDatabaseFixture({ operationalSchedule: true });
    const owner = fixture.actors.owner; const root = `/api/v1/learning/external-asset-sources/${sourceKey}`;
    const post = (suffix, body, key = crypto.randomUUID(), actor = owner) => request(fixture.app).post(root + suffix)
      .set(actor.session.headers).set('X-CSRF-Token', actor.csrfToken).set('Idempotency-Key', key).send(body);
    let response = await post('/consent', { action: 'grant', expectedRevision: 0, expectedDigest: 'none',
      reason: 'Enable reviewed vehicle and equipment reconciliation.', confirmed: true,
      confirmationVersion: 'm25-external-asset-import-consent-v1' });
    assert.equal(response.status, 201, JSON.stringify(response.body)); const consent = response.body.data.consent;
    const batch = (records, overrides = {}) => ({ schemaVersion: 'm25-external-asset-actual-v1', mode: 'continuous_update',
      expectedConsentRevision: consent.revision, expectedConsentDigest: consent.digest, cursorBefore: null, cursorAfter: 'asset-1',
      complete: false, records, reason: 'Stage current reviewed vehicle and equipment evidence.', confirmed: true,
      confirmationVersion: 'm25-external-asset-import-batch-v1', ...overrides });
    response = await post('/batches', batch([record('vehicle'), record('equipment')]));
    assert.equal(response.status, 201, JSON.stringify(response.body));

    const createEstimate = async (tenant, label) => {
      const operationId = crypto.randomUUID(), graphId = crypto.randomUUID(), customerId = crypto.randomUUID();
      const transcriptId = crypto.randomUUID(), opportunityId = crypto.randomUUID(), estimateId = crypto.randomUUID();
      const fingerprint = crypto.createHash('sha256').update(label).digest('hex');
      await fixture.ownerPool.query(`INSERT INTO canonical_operations(id,organization_id,graph_id,idempotency_key_hash,payload_fingerprint,state,lease_owner,lease_expires_at,result_status,result_body,completed_at) VALUES($1,$2,$3,$4,$4,'completed',$1,NOW()+INTERVAL '1 hour',200,'{}',NOW())`, [operationId, tenant, graphId, fingerprint]);
      await fixture.ownerPool.query("INSERT INTO canonical_customers(id,organization_id,operation_id,graph_id,name) VALUES($1,$2,$3,$4,'Asset customer')", [customerId, tenant, operationId, graphId]);
      await fixture.ownerPool.query("INSERT INTO canonical_transcripts(id,organization_id,operation_id,graph_id,customer_id,source,source_version,transcript_text,normalized_fingerprint) VALUES($1,$2,$3,$4,$5,'lead','fixture','Reviewed asset evidence',$6)", [transcriptId, tenant, operationId, graphId, customerId, fingerprint]);
      await fixture.ownerPool.query("INSERT INTO canonical_opportunities(id,organization_id,operation_id,graph_id,customer_id,status,service_type,job_scope) VALUES($1,$2,$3,$4,$5,'qualified','Tree Service','{}')", [opportunityId, tenant, operationId, graphId, customerId]);
      await fixture.ownerPool.query(`INSERT INTO canonical_estimates(id,organization_id,operation_id,graph_id,opportunity_id,calculation_version,normalized_input_fingerprint,business_profile_version,business_profile_hash,currency,customer_price,line_items,calculation_output,snapshot_digest) VALUES($1,$2,$3,$4,$5,'fixture-v1',$6,'org-profile-v1',$6,'USD',100,'[]','{}',$6)`, [estimateId, tenant, operationId, graphId, opportunityId, fingerprint]);
      return estimateId;
    };
    const createReviewedAsset = async (tenant, actor, category, name) => {
      const assetId = crypto.randomUUID(), draftId = crypto.randomUUID(); const document = { fixture: `${category} review` };
      const requestDigest = crypto.randomBytes(32).toString('hex');
      await fixture.ownerPool.query(`INSERT INTO tenant_assets(id,organization_id,category,name,internal_reference,manufacturer,model,model_year,configuration,created_by_user_id,updated_by_user_id) VALUES($1,$2,$3,$4,$5,'Fixture','Model',2024,'Reviewed',$6,$6)`, [assetId, tenant, category, name, `${category.toUpperCase()}-2`, actor.actorUserId]);
      const client = await fixture.ownerPool.connect();
      try { await client.query('BEGIN');
        await client.query(`INSERT INTO canonical_equipment_drafts(organization_id,id,actor_user_id,session_id,revision,document,digest) VALUES($1,$2,$3,$4,1,$5,equipment_digest($5::jsonb))`, [tenant, draftId, actor.actorUserId, actor.authSessionId, document]);
        await client.query(`INSERT INTO canonical_equipment_receipts(organization_id,actor_user_id,session_id,key_hash,request_digest,action,subject_id,response) VALUES($1,$2,$3,$4,$5,'confirm',$6,'{"data":{"revision":1}}')`, [tenant, actor.actorUserId, actor.authSessionId, crypto.randomBytes(32).toString('hex'), requestDigest, draftId]);
        await client.query(`INSERT INTO canonical_equipment_draft_history(organization_id,draft_id,revision,document,digest,actor_user_id,session_id,action,request_digest) VALUES($1,$2,1,$5,equipment_digest($5::jsonb),$3,$4,'confirm',$6)`, [tenant, draftId, actor.actorUserId, actor.authSessionId, document, requestDigest]);
        await client.query(`INSERT INTO canonical_equipment_asset_versions(organization_id,asset_id,asset_version,asset_snapshot,asset_digest,private_configuration,knowledge_version_id,knowledge_digest,category_label,review_state,draft_id,draft_revision,actor_user_id) SELECT organization_id,id,version,to_jsonb(a),equipment_digest(to_jsonb(a)),'{}',NULL,NULL,$5,'reviewed',$2,1,$3 FROM tenant_assets a WHERE organization_id=$1 AND id=$4`, [tenant, draftId, actor.actorUserId, assetId, category === 'vehicle' ? 'Vehicle' : 'Equipment']);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
      return assetId;
    };
    const estimate = await createEstimate(fixture.org, 'm25-part10c-estimate');
    const vehicle = await createReviewedAsset(fixture.org, owner, 'vehicle', 'Tree service truck');
    const equipment = await createReviewedAsset(fixture.org, owner, 'equipment', 'Tracked brush chipper');
    const otherEquipment = await createReviewedAsset(fixture.otherOrg, fixture.actors.otherOwner, 'equipment', 'Other tenant chipper');

    response = await request(fixture.app).get(root + '/matches').set(owner.session.headers);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const refs = Object.fromEntries(response.body.data.references.map(value => [value.referenceKind, value]));
    const jobTarget = response.body.data.jobTargets.find(value => value.targetId === estimate);
    const vehicleTarget = response.body.data.vehicleTargets.find(value => value.targetId === vehicle);
    const equipmentTarget = response.body.data.equipmentTargets.find(value => value.targetId === equipment);
    assert.ok(refs.job && refs.vehicle && refs.equipment && jobTarget && vehicleTarget && equipmentTarget);
    assert.equal(response.body.data.referenceTotal, 3);
    ledger.cases.push('Guarded review lists opaque job, vehicle and equipment references with bounded same-tenant eligible targets and exact digests.');

    const match = (kind, externalReference, target, overrides = {}) => ({ action: 'link', referenceKind: kind, externalReference,
      targetId: target.targetId, expectedRevision: 0, expectedDigest: 'none', expectedSourceDigest: refs[kind].sourceDigest,
      expectedTargetDigest: target.digest, reason: 'Owner reviewed this exact source reference and NorthStar record.', confirmed: true,
      confirmationVersion: 'm25-external-asset-reference-match-v1', ...overrides });
    const jobBody = match('job', 'job-19', jobTarget), vehicleBody = match('vehicle', 'truck-2', vehicleTarget);
    const equipmentBody = match('equipment', 'chipper-2', equipmentTarget); const jobKey = crypto.randomUUID();
    response = await post('/matches', jobBody, jobKey); assert.equal(response.status, 201, JSON.stringify(response.body)); const jobMatch = response.body.data.match;
    assert.equal(jobMatch.status, 'matched'); assert.equal(jobMatch.consentId, consent.id); assert.equal(jobMatch.consentRevision, consent.revision);
    assert.equal(jobMatch.sourceManifest.length, 2); assert.equal(jobMatch.sourceDigest, refs.job.sourceDigest); assert.equal(jobMatch.targetDigest, jobTarget.digest);
    response = await post('/matches', jobBody, jobKey); assert.equal(response.status, 200); assert.equal(response.headers['idempotency-replayed'], 'true');
    assert.equal((await post('/matches', { ...jobBody, reason: 'Changed request.' }, jobKey)).status, 409);
    response = await post('/matches', vehicleBody); assert.equal(response.status, 201); const vehicleMatch = response.body.data.match;
    response = await post('/matches', equipmentBody); assert.equal(response.status, 201); const equipmentMatch = response.body.data.match;
    assert.equal(vehicleMatch.sourceManifest.length, 1); assert.equal(equipmentMatch.sourceManifest.length, 1);
    ledger.cases.push('Explicit links for all three kinds append immutable reviewed revisions and exact retries replay one receipt.');

    const wrongCategory = await post('/matches', { ...equipmentBody, targetId: vehicleTarget.targetId, expectedTargetDigest: vehicleTarget.digest,
      externalReference: 'chipper-2', expectedRevision: equipmentMatch.revision, expectedDigest: equipmentMatch.digest });
    assert.equal(wrongCategory.status, 400);
    const crossTenant = await post('/matches', { ...equipmentBody, targetId: otherEquipment, expectedTargetDigest: 'b'.repeat(64),
      expectedRevision: equipmentMatch.revision, expectedDigest: equipmentMatch.digest });
    assert.equal(crossTenant.status, 400);
    assert.equal((await post('/matches', jobBody, crypto.randomUUID(), fixture.actors.member)).status, 403);
    const otherRead = await request(fixture.app).get(root + '/matches').set(fixture.actors.otherOwner.session.headers);
    assert.equal(otherRead.status, 200); assert.deepEqual(otherRead.body.data.references, []);
    ledger.cases.push('Wrong-category, cross-tenant and worker reconciliation attempts fail closed without leaking targets.');

    await fixture.ownerPool.query("UPDATE tenant_assets SET name='Tracked brush chipper revised',updated_at=transaction_timestamp() WHERE organization_id=$1 AND id=$2", [fixture.org, equipment]);
    response = await request(fixture.app).get(root + '/matches').set(owner.session.headers);
    assert.equal(response.body.data.references.find(value => value.referenceKind === 'equipment').match.status, 'stale');
    assert.equal(response.body.data.references.find(value => value.referenceKind === 'vehicle').match.status, 'matched');
    ledger.cases.push('A reviewed equipment identity change stales only its pinned equipment link.');

    response = await post('/batches', batch([record('vehicle', 2)], { cursorBefore: 'asset-1', cursorAfter: 'asset-2' }));
    assert.equal(response.status, 201, JSON.stringify(response.body));
    response = await request(fixture.app).get(root + '/matches').set(owner.session.headers);
    const changedJob = response.body.data.references.find(value => value.referenceKind === 'job');
    const changedVehicle = response.body.data.references.find(value => value.referenceKind === 'vehicle');
    assert.equal(changedJob.match.status, 'stale'); assert.equal(changedVehicle.match.status, 'stale');
    assert.equal((await post('/matches', { ...vehicleBody, expectedRevision: vehicleMatch.revision, expectedDigest: vehicleMatch.digest })).status, 409);
    ledger.cases.push('A source correction changes the affected exact manifests and stale pins cannot be silently reused.');

    const unlink = { action: 'unlink', referenceKind: 'vehicle', externalReference: 'truck-2', targetId: null,
      expectedRevision: vehicleMatch.revision, expectedDigest: vehicleMatch.digest, expectedSourceDigest: changedVehicle.sourceDigest,
      expectedTargetDigest: 'unavailable', reason: 'Remove this reviewed vehicle link.', confirmed: true,
      confirmationVersion: 'm25-external-asset-reference-match-v1' };
    response = await post('/matches', unlink); assert.equal(response.status, 201, JSON.stringify(response.body)); assert.equal(response.body.data.match.status, 'unmatched');
    const before = (await fixture.ownerPool.query('SELECT count(*)::int count FROM canonical_external_asset_reference_matches')).rows[0].count;
    const direct = await fixture.runtimePool.connect(); let directError;
    try { await direct.query('BEGIN ISOLATION LEVEL SERIALIZABLE'); await direct.query('SELECT public.canonical_external_asset_reference_match_mutate($1,$2,$3,$4,$5,$6,$7,$8::jsonb)', [fixture.org, owner.actorUserId, owner.actorAccessRole, owner.authSessionId, owner.csrfToken, crypto.randomUUID(), sourceKey, JSON.stringify({ ...unlink, expectedRevision: null, expectedDigest: null })]); }
    catch (error) { directError = error; } finally { await direct.query('ROLLBACK').catch(() => {}); direct.release(); }
    assert.equal(directError && directError.code, '22023');
    assert.equal((await fixture.ownerPool.query('SELECT count(*)::int count FROM canonical_external_asset_reference_matches')).rows[0].count, before);
    ledger.cases.push('Explicit unlink appends history and invalid database-level pins cannot partially write.');

    response = await post('/batches', batch([record('equipment', 2, 'tombstone')], { cursorBefore: 'asset-2', cursorAfter: 'asset-3' }));
    assert.equal(response.status, 201, JSON.stringify(response.body));
    response = await request(fixture.app).get(root + '/matches').set(owner.session.headers);
    assert.equal(response.body.data.references.find(value => value.referenceKind === 'equipment').match.status, 'stale');
    ledger.cases.push('A tombstone removes current operational detail while retaining stale reviewed lineage.');

    const privileges = (await fixture.ownerPool.query(`SELECT has_table_privilege($1,'canonical_external_asset_reference_matches','SELECT') match_table,has_function_privilege($1,'canonical_external_asset_reference_source_basis(uuid,text,text,text)','EXECUTE') source_helper,has_function_privilege($1,'canonical_external_asset_reference_target_basis(uuid,text,uuid)','EXECUTE') target_helper,has_function_privilege($1,'canonical_external_asset_reference_match_projection(canonical_external_asset_reference_matches,jsonb,jsonb,jsonb)','EXECUTE') projection_helper,has_function_privilege($1,'canonical_external_asset_reference_matches_read(uuid,uuid,text,uuid,text)','EXECUTE') read_entry,has_function_privilege($1,'canonical_external_asset_reference_match_mutate(uuid,uuid,text,uuid,text,text,text,jsonb)','EXECUTE') write_entry`, [fixture.roles.runtime])).rows[0];
    assert.deepEqual(privileges, { match_table: false, source_helper: false, target_helper: false, projection_helper: false, read_entry: true, write_entry: true });
    await assert.rejects(fixture.ownerPool.query('DELETE FROM canonical_external_asset_reference_matches'));
    const bytes = fs.readFileSync(path.join(__dirname, '../../migrations/098_canonical_external_asset_reconciliation.sql'));
    const checksum = crypto.createHash('sha256').update(bytes).digest('hex');
    assert.deepEqual((await fixture.ownerPool.query("SELECT trim(checksum) checksum FROM _migrations WHERE filename='098_canonical_external_asset_reconciliation.sql'")).rows, [{ checksum }]);
    ledger.cases.push('Runtime access is entry-only, history is immutable and migration provenance is exact.');

    response = await post('/consent', { action: 'revoke', expectedRevision: consent.revision, expectedDigest: consent.digest,
      reason: 'Stop using this source for reconciliation.', confirmed: true, confirmationVersion: 'm25-external-asset-import-consent-v1' });
    assert.equal(response.status, 201); const revoked = response.body.data.consent;
    const hidden = await request(fixture.app).get(root + '/matches').set(owner.session.headers);
    assert.equal(hidden.body.data.activeConsent, false); assert.deepEqual(hidden.body.data.references, []);
    assert.deepEqual(hidden.body.data.jobTargets, []); assert.deepEqual(hidden.body.data.vehicleTargets, []); assert.deepEqual(hidden.body.data.equipmentTargets, []);
    response = await post('/matches', jobBody, jobKey); assert.equal(response.status, 200); assert.equal(response.headers['idempotency-replayed'], 'true'); assert.equal(response.body.data.match.status, 'stale');
    assert.equal((await post('/matches', jobBody)).status, 409);
    response = await post('/consent', { action: 'grant', expectedRevision: revoked.revision, expectedDigest: revoked.digest,
      reason: 'Re-enable under a new source-consent revision.', confirmed: true, confirmationVersion: 'm25-external-asset-import-consent-v1' });
    assert.equal(response.status, 201); const regranted = await request(fixture.app).get(root + '/matches').set(owner.session.headers);
    assert.equal(regranted.body.data.references.find(value => value.referenceKind === 'job').match.status, 'stale');
    ledger.cases.push('Revocation hides reconciliation and blocks new writes; exact replay remains immutable and re-grant does not revive old links.');
    ledger.pass = true;
  } catch (error) { const source = error.cause || error; ledger.error = error.stack; ledger.cause = { message: source.message, code: source.code, constraint: source.constraint, detail: source.detail, where: source.where, position: source.position }; process.exitCode = 1; }
  finally { if (fixture) await fixture.cleanup(); fs.writeFileSync(output, JSON.stringify(ledger, null, 2)); console.log(JSON.stringify(ledger)); }
})();
