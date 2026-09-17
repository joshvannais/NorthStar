'use strict';

const crypto = require('node:crypto');
const request = require('supertest');

const digest = value => crypto.createHash('sha256').update(value).digest('hex');

async function createWorker(fixture, name, location) {
  const id = crypto.randomUUID();
  await fixture.ownerPool.query(
    "INSERT INTO users(id,organization_id,name,email,password_hash,role,status) VALUES($1,$2,$3,$4,'unused','member','active')",
    [id, fixture.org, name, `${id}@example.test`]
  );
  await fixture.ownerPool.query(
    "INSERT INTO organization_memberships(id,organization_id,user_id,role,status) VALUES($1,$2,$1,'member','active')",
    [id, fixture.org]
  );
  await fixture.ownerPool.query(
    "UPDATE workforce_profiles SET operational_role='technician',home_location_id=$2 WHERE organization_id=$1 AND id=$3",
    [fixture.org, location, id]
  );
  return id;
}

async function createJob(fixture, customerName, serviceType, jobTitle, createdAt) {
  const operation = crypto.randomUUID(), graph = crypto.randomUUID(), customer = crypto.randomUUID();
  const opportunity = crypto.randomUUID(), estimate = crypto.randomUUID(), fingerprint = digest(`${customerName}:${jobTitle}`);
  await fixture.ownerPool.query(
    "INSERT INTO canonical_operations(id,organization_id,graph_id,idempotency_key_hash,payload_fingerprint,state,lease_owner,lease_expires_at,result_status,result_body,completed_at) VALUES($1,$2,$3,$4,$4,'completed',$1,NOW()+INTERVAL '1 hour',200,'{}',NOW())",
    [operation, fixture.org, graph, fingerprint]
  );
  await fixture.ownerPool.query(
    'INSERT INTO canonical_customers(id,organization_id,operation_id,graph_id,name) VALUES($1,$2,$3,$4,$5)',
    [customer, fixture.org, operation, graph, customerName]
  );
  await fixture.ownerPool.query(
    "INSERT INTO canonical_opportunities(id,organization_id,operation_id,graph_id,customer_id,status,service_type,job_scope) VALUES($1,$2,$3,$4,$5,'qualified',$6,$7)",
    [opportunity, fixture.org, operation, graph, customer, serviceType, { jobTitle }]
  );
  await fixture.ownerPool.query(
    "INSERT INTO canonical_estimates(id,organization_id,operation_id,graph_id,opportunity_id,calculation_version,normalized_input_fingerprint,business_profile_version,business_profile_hash,currency,customer_price,line_items,calculation_output,snapshot_digest,created_at) VALUES($1,$2,$3,$4,$5,'fixture-v1',$6,'org-profile-v1',$6,'USD',100,'[]','{}',$6,$7)",
    [estimate, fixture.org, operation, graph, opportunity, fingerprint, createdAt]
  );
  return estimate;
}

async function createAsset(fixture, category, internalReference) {
  const asset = crypto.randomUUID(), draft = crypto.randomUUID(), owner = fixture.actors.owner;
  const name = category === 'vehicle' ? 'Chip Truck' : 'Tracked Chipper';
  const manufacturer = category === 'vehicle' ? 'Ford' : 'Bandit';
  const model = category === 'vehicle' ? 'F-550' : '21XP';
  const document = { fixture: `${category}:${internalReference}` }, requestDigest = crypto.randomBytes(32).toString('hex');
  await fixture.ownerPool.query(
    "INSERT INTO tenant_assets(id,organization_id,category,name,internal_reference,manufacturer,model,model_year,configuration,created_by_user_id,updated_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,2024,'Reviewed',$8,$8)",
    [asset, fixture.org, category, name, internalReference, manufacturer, model, owner.actorUserId]
  );
  const client = await fixture.ownerPool.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO canonical_equipment_drafts(organization_id,id,actor_user_id,session_id,revision,document,digest) VALUES($1,$2,$3,$4,1,$5,equipment_digest($5::jsonb))',
      [fixture.org, draft, owner.actorUserId, owner.authSessionId, document]);
    await client.query("INSERT INTO canonical_equipment_receipts(organization_id,actor_user_id,session_id,key_hash,request_digest,action,subject_id,response) VALUES($1,$2,$3,$4,$5,'confirm',$6,'{\"data\":{\"revision\":1}}')",
      [fixture.org, owner.actorUserId, owner.authSessionId, crypto.randomBytes(32).toString('hex'), requestDigest, draft]);
    await client.query("INSERT INTO canonical_equipment_draft_history(organization_id,draft_id,revision,document,digest,actor_user_id,session_id,action,request_digest) VALUES($1,$2,1,$5,equipment_digest($5::jsonb),$3,$4,'confirm',$6)",
      [fixture.org, draft, owner.actorUserId, owner.authSessionId, document, requestDigest]);
    await client.query("INSERT INTO canonical_equipment_asset_versions(organization_id,asset_id,asset_version,asset_snapshot,asset_digest,private_configuration,knowledge_version_id,knowledge_digest,category_label,review_state,draft_id,draft_revision,actor_user_id) SELECT organization_id,id,version,to_jsonb(a),equipment_digest(to_jsonb(a)),'{}',NULL,NULL,$5,'reviewed',$2,1,$3 FROM tenant_assets a WHERE organization_id=$1 AND id=$4",
      [fixture.org, draft, owner.actorUserId, asset, category === 'vehicle' ? 'Vehicle' : 'Equipment']);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {}); throw error;
  } finally { client.release(); }
  return asset;
}

async function post(fixture, path, body) {
  return request(fixture.app).post(path).set(fixture.actors.owner.session.headers)
    .set('X-CSRF-Token', fixture.actors.owner.csrfToken).set('Idempotency-Key', crypto.randomUUID()).send(body);
}

async function seedLearningLabels(fixture) {
  await fixture.ownerPool.query("UPDATE users SET name='Alex Rivera' WHERE organization_id=$1 AND id=$2", [fixture.org, fixture.actors.member.actorUserId]);
  await fixture.ownerPool.query("UPDATE workforce_profiles SET operational_role='technician',home_location_id='Main-Office' WHERE organization_id=$1 AND id=$2", [fixture.org, fixture.actors.member.actorUserId]);
  const workers = [fixture.actors.member.actorUserId, await createWorker(fixture, 'Jordan Lee', 'North-Yard'),
    await createWorker(fixture, 'Jordan Lee', 'South-Yard')];
  const ambiguousWorkers = [await createWorker(fixture, 'Casey Morgan', 'Shared-Yard'),
    await createWorker(fixture, 'Casey Morgan', 'Shared-Yard')];
  const forbiddenNames = ['Crew [Object Object]', 'Crew 860-555-1212 East', 'Crew (860) 555-1212 West',
    'Crew +1 860.555.1212 Central', `Crew ${'a'.repeat(64)}`, `Crew digest:${'b'.repeat(64)}`];
  const forbiddenWorkers = [];
  for (let index = 0; index < forbiddenNames.length; index += 1) {
    forbiddenWorkers.push(await createWorker(fixture, forbiddenNames[index], `Unsafe-Yard-${index + 1}`));
  }
  const longName = 'Alexandria Residential Canopy Operations Division '.repeat(4).trim();
  const longLocationStem = `Regional-Service-Operations-${'x'.repeat(28)}`;
  const longLocations = [`${longLocationStem}-North`, `${longLocationStem}-South`];
  const longWorkers = [await createWorker(fixture, longName, longLocations[0]), await createWorker(fixture, longName, longLocations[1])];
  const composed = (prefix, discriminator) => prefix.length + 3 + discriminator.length <= 240 ? `${prefix} · ${discriminator}` :
    `${prefix.slice(0, 240 - 3 - discriminator.length).trimEnd()} · ${discriminator}`;
  const longWorkerLabels = longLocations.map(location => composed(`${longName} · Technician`, location));
  const jobs = [await createJob(fixture, 'Avery Sample', 'Tree Removal', 'Backyard oak removal', '2026-09-16T13:00:00Z'),
    await createJob(fixture, 'Morgan Demo', 'Stump Grinding', 'Front yard stump grinding', '2026-09-16T14:00:00Z')];
  const vehicles = [await createAsset(fixture, 'vehicle', 'North Truck'), await createAsset(fixture, 'vehicle', 'South Truck')];
  const equipment = [await createAsset(fixture, 'equipment', 'Chipper A'), await createAsset(fixture, 'equipment', 'Chipper B')];

  const laborSource = 'crewclock.labels', laborRoot = `/api/v1/learning/external-labor-sources/${laborSource}`;
  let response = await post(fixture, laborRoot + '/consent', { action: 'grant', expectedRevision: 0, expectedDigest: 'none',
    reason: 'Enable recognizable paid matching labels.', confirmed: true, confirmationVersion: 'm25-external-labor-import-consent-v1' });
  if (response.status !== 201) throw new Error('Labor label consent failed: ' + JSON.stringify(response.body));
  const laborConsent = response.body.data.consent;
  response = await post(fixture, laborRoot + '/batches', { schemaVersion: 'm25-external-labor-time-v1', mode: 'continuous_update',
    expectedConsentRevision: laborConsent.revision, expectedConsentDigest: laborConsent.digest, cursorBefore: null, cursorAfter: 'labels-1', complete: false,
    records: [{ externalRecordId: 'shift-labels-1', externalVersion: 1, state: 'active', workerReference: 'worker-labels', jobReference: 'job-labels',
      category: 'production', observedStart: '2026-09-16T13:00:00.000Z', observedEnd: '2026-09-16T17:00:00.000Z', sourceUpdatedAt: '2026-09-16T18:00:00.000Z' }],
    reason: 'Stage recognizable paid label evidence.', confirmed: true, confirmationVersion: 'm25-external-labor-import-batch-v1' });
  if (response.status !== 201) throw new Error('Labor label batch failed: ' + JSON.stringify(response.body));

  const assetSource = 'fleet.labels', assetRoot = `/api/v1/learning/external-asset-sources/${assetSource}`;
  response = await post(fixture, assetRoot + '/consent', { action: 'grant', expectedRevision: 0, expectedDigest: 'none',
    reason: 'Enable recognizable paid vehicle and equipment labels.', confirmed: true, confirmationVersion: 'm25-external-asset-import-consent-v1' });
  if (response.status !== 201) throw new Error('Asset label consent failed: ' + JSON.stringify(response.body));
  const assetConsent = response.body.data.consent, providerDigest = digest('label-fixture-provider-evidence');
  const assetRecord = (category, reference, ordinal) => ({ externalRecordId: `asset-label-${ordinal}`, externalVersion: 1, state: 'active', recordType: 'utilization',
    jobReference: 'job-labels', assetReference: reference, assetCategory: category, periodStartedAt: '2026-09-16T13:00:00.000Z',
    periodEndedAt: '2026-09-16T17:00:00.000Z', timeZone: 'America/New_York', utilization: { value: '4.0', unit: 'engine_hour', basis: 'meter' },
    cost: null, maintenance: null, downtime: null, evidenceClass: 'provider_recorded', providerEvidenceDigest: providerDigest,
    sourceUpdatedAt: '2026-09-16T18:00:00.000Z' });
  response = await post(fixture, assetRoot + '/batches', { schemaVersion: 'm25-external-asset-actual-v1', mode: 'continuous_update',
    expectedConsentRevision: assetConsent.revision, expectedConsentDigest: assetConsent.digest, cursorBefore: null, cursorAfter: 'labels-1', complete: false,
    records: [assetRecord('vehicle', 'truck-labels', 1), assetRecord('equipment', 'chipper-labels', 2)],
    reason: 'Stage recognizable paid asset label evidence.', confirmed: true, confirmationVersion: 'm25-external-asset-import-batch-v1' });
  if (response.status !== 201) throw new Error('Asset label batch failed: ' + JSON.stringify(response.body));

  return { workers, ambiguousWorkers, forbiddenWorkers, forbiddenNames, longWorkers, jobs, vehicles, equipment, laborSource, assetSource,
    labels: {
      workers: ['Alex Rivera · Technician', 'Jordan Lee · Technician · North-Yard', 'Jordan Lee · Technician · South-Yard'],
      longWorkers: longWorkerLabels,
      jobs: ['Avery Sample · Tree Removal · Backyard oak removal', 'Morgan Demo · Stump Grinding · Front yard stump grinding'],
      vehicles: ['Chip Truck · Ford F-550 · North Truck · 2024', 'Chip Truck · Ford F-550 · South Truck · 2024'],
      equipment: ['Tracked Chipper · Bandit 21XP · Chipper A · 2024', 'Tracked Chipper · Bandit 21XP · Chipper B · 2024'],
    } };
}

module.exports = { seedLearningLabels };
