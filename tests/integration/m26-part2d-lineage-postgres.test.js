'use strict';

const crypto = require('node:crypto');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const { sha256 } = require('../../src/services/businessProfileAdapter');
const { VALUE_VERSION } = require('../../src/forecasting/featureContract');
const { registeredFeatureDefinition } = require('../../src/forecasting/featureDefinitions');
const { reconcileFeatureLineage } = require('../../src/forecasting/lineageCurrentness');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const key = () => crypto.randomUUID();
const definition = registeredFeatureDefinition('pipeline.approved_estimate_stock', 'v1');

realPostgres('Mission 26 Part 2D guarded current-source lineage', () => {
  let fixture;
  beforeAll(async () => { fixture = await createDatabaseFixture(); }, 120000);
  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  async function capture(actor = fixture.actors.owner) {
    const client = await fixture.runtimePool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const result = await client.query(
        'SELECT public.canonical_forecast_estimate_decision_snapshot_capture($1,$2,$3,$4,$5,$6) value',
        [actor.organizationId, actor.actorUserId, actor.actorAccessRole,
          actor.authSessionId, actor.csrfToken, key()]);
      await client.query('COMMIT');
      return result.rows[0].value.snapshot;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  async function lineage(snapshot, actor = fixture.actors.owner) {
    const client = await fixture.runtimePool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY');
      const result = await client.query(
        'SELECT public.canonical_forecast_estimate_decision_lineage_read($1,$2,$3,$4,$5) value',
        [actor.organizationId, actor.actorUserId, actor.actorAccessRole,
          actor.authSessionId, snapshot.id]);
      await client.query('COMMIT');
      return result.rows[0].value;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  async function estimate() {
    const operation = key(), graph = key(), customer = key();
    const opportunity = key(), estimateId = key(), fingerprint = hash(key());
    await fixture.ownerPool.query(
      `INSERT INTO canonical_operations(id,organization_id,graph_id,idempotency_key_hash,
         payload_fingerprint,state,lease_owner,lease_expires_at,result_status,result_body,completed_at)
       VALUES($1,$2,$3,$4,$4,'completed',$1,NOW()+INTERVAL '1 hour',200,'{}',NOW())`,
      [operation, fixture.org, graph, fingerprint]);
    await fixture.ownerPool.query(
      'INSERT INTO canonical_customers(id,organization_id,operation_id,graph_id,name) VALUES($1,$2,$3,$4,$5)',
      [customer, fixture.org, operation, graph, 'Synthetic customer']);
    await fixture.ownerPool.query(
      `INSERT INTO canonical_opportunities(id,organization_id,operation_id,graph_id,
         customer_id,status,service_type,job_scope)
       VALUES($1,$2,$3,$4,$5,'qualified','Plumbing','{}')`,
      [opportunity, fixture.org, operation, graph, customer]);
    await fixture.ownerPool.query(
      `INSERT INTO canonical_estimates(id,organization_id,operation_id,graph_id,
         opportunity_id,calculation_version,normalized_input_fingerprint,
         business_profile_version,business_profile_hash,currency,customer_price,
         line_items,calculation_output,snapshot_digest)
       VALUES($1,$2,$3,$4,$5,'fixture-v1',$6,'org-profile-v1',$6,'USD',500,'[]','{}',$6)`,
      [estimateId, fixture.org, operation, graph, opportunity, fingerprint]);
    return estimateId;
  }

  async function decision(estimateId, action, revision, previousId = null) {
    const actor = fixture.actors.owner, id = key();
    await fixture.ownerPool.query(
      `INSERT INTO canonical_estimate_decisions(
         id,organization_id,estimate_id,revision,previous_id,action,actor_user_id,
         membership_id,auth_session_id,actor_name,source_pins,scope_summary,
         price_before_tax,currency,reason,confirmation_version,request_key_hash,
         request_digest,digest)
       VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8,'Synthetic owner','{}',$9,$10,'USD',
         'Explicit synthetic commercial review','estimate-quote-preparation-v1',$11,$12,$13)`,
      [id, fixture.org, estimateId, revision, previousId, action,
        actor.actorUserId, actor.authSessionId,
        action === 'approve' ? 'Synthetic scope' : null,
        action === 'approve' ? '500.00' : null,
        hash(key()), hash(key()), hash(key())]);
    return id;
  }

  function feature(snapshot, amount) {
    return { contractVersion: VALUE_VERSION, organizationId: fixture.org,
      definitionKey: definition.key, definitionVersion: definition.definitionVersion,
      definitionDigest: sha256(definition), asOf: snapshot.asOf,
      reportingWindow: null, sourceSnapshotDigest: snapshot.sourceSnapshotDigest,
      latestSourceRecordedAt: snapshot.sources.length ?
        snapshot.sources.at(-1).recordedAt : null,
      state: 'known', amount, reason: null, unit: definition.unit };
  }

  test('a fresh source read masks old stock after addition, correction and withdrawal', async () => {
    const empty = await capture();
    const emptyFeature = feature(empty, '0');
    expect(reconcileFeatureLineage({ feature: emptyFeature, ...await lineage(empty),
      sourceAccess: 'granted', retention: 'current' }))
      .toMatchObject({ lineageState: 'current', amount: '0' });

    const estimateId = await estimate();
    const approval = await decision(estimateId, 'approve', 1);
    const afterAddition = await lineage(empty);
    expect(reconcileFeatureLineage({ feature: emptyFeature, ...afterAddition,
      sourceAccess: 'granted', retention: 'current' }))
      .toMatchObject({ lineageState: 'stale', amount: null });
    expect(afterAddition.captured.digest).toBe(empty.sourceSnapshotDigest);
    expect(afterAddition.current.manifest.sources[0].sourceId).toBe(approval);

    const approved = await capture();
    const approvedFeature = feature(approved, '1');
    expect(reconcileFeatureLineage({ feature: approvedFeature, ...await lineage(approved),
      sourceAccess: 'granted', retention: 'current' }))
      .toMatchObject({ lineageState: 'current', amount: '1' });
    const correction = await decision(estimateId, 'approve', 2, approval);
    expect(reconcileFeatureLineage({ feature: approvedFeature, ...await lineage(approved),
      sourceAccess: 'granted', retention: 'current' }))
      .toMatchObject({ lineageState: 'stale', amount: null });
    await decision(estimateId, 'withdraw', 3, correction);
    const afterWithdrawal = await lineage(approved);
    expect(afterWithdrawal.current.manifest.sources[0].state).toBe('tombstone');
    expect(reconcileFeatureLineage({ feature: approvedFeature, ...afterWithdrawal,
      sourceAccess: 'granted', retention: 'current' }))
      .toMatchObject({ lineageState: 'stale', amount: null });
    expect((await lineage(approved)).captured).toEqual(afterWithdrawal.captured);
  }, 120000);

  test('requires serializable visibility and current owner access', async () => {
    const saved = await capture();
    const actor = fixture.actors.owner;
    await expect(fixture.runtimePool.query(
      'SELECT public.canonical_forecast_estimate_decision_lineage_read($1,$2,$3,$4,$5)',
      [fixture.org, actor.actorUserId, actor.actorAccessRole,
        actor.authSessionId, saved.id])).rejects.toMatchObject({ code: '25001' });
    await expect(lineage(saved, fixture.actors.member))
      .rejects.toMatchObject({ code: '42501' });
    const wrongTenant = { ...actor, organizationId: key() };
    await expect(lineage(saved, wrongTenant))
      .rejects.toMatchObject({ code: '42501' });
    await fixture.ownerPool.query(
      "UPDATE subscriptions SET status='past_due' WHERE organization_id=$1",
      [fixture.org]);
    try {
      await expect(lineage(saved)).rejects.toMatchObject({ code: '42501' });
    } finally {
      await fixture.ownerPool.query(
        "UPDATE subscriptions SET status='active' WHERE organization_id=$1",
        [fixture.org]);
    }
  }, 120000);
});
