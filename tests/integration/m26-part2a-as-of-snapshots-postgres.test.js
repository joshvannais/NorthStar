'use strict';

const crypto = require('node:crypto');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const { normalizeAsOfSourceManifest } = require('../../src/forecasting/asOfSourceManifest');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const key = () => crypto.randomUUID();

realPostgres('Mission 26 Part 2A PostgreSQL as-of snapshots', () => {
  let fixture;

  beforeAll(async () => {
    fixture = await createDatabaseFixture();
  }, 120000);

  afterAll(async () => {
    if (fixture) await fixture.cleanup();
  }, 120000);

  async function capture(actor, idempotencyKey = key()) {
    const client = await fixture.runtimePool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const result = await client.query(
        'SELECT public.canonical_forecast_estimate_decision_snapshot_capture($1,$2,$3,$4,$5,$6) value',
        [actor.organizationId, actor.actorUserId, actor.actorAccessRole,
          actor.authSessionId, actor.csrfToken, idempotencyKey]
      );
      await client.query('COMMIT');
      return result.rows[0].value;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  async function decision(estimateId, action, revision, previousId = null) {
    const actor = fixture.actors.owner;
    const id = crypto.randomUUID();
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
        hash(key()), hash(key()), hash(key())]
    );
    return id;
  }

  async function estimate() {
    const operation = crypto.randomUUID(), graph = crypto.randomUUID();
    const customer = crypto.randomUUID(), opportunity = crypto.randomUUID();
    const estimateId = crypto.randomUUID(), fingerprint = hash(key());
    await fixture.ownerPool.query(
      `INSERT INTO canonical_operations(id,organization_id,graph_id,idempotency_key_hash,
         payload_fingerprint,state,lease_owner,lease_expires_at,result_status,result_body,completed_at)
       VALUES($1,$2,$3,$4,$4,'completed',$1,NOW()+INTERVAL '1 hour',200,'{}',NOW())`,
      [operation, fixture.org, graph, fingerprint]
    );
    await fixture.ownerPool.query(
      'INSERT INTO canonical_customers(id,organization_id,operation_id,graph_id,name) VALUES($1,$2,$3,$4,$5)',
      [customer, fixture.org, operation, graph, 'Synthetic customer']
    );
    await fixture.ownerPool.query(
      `INSERT INTO canonical_opportunities(id,organization_id,operation_id,graph_id,
         customer_id,status,service_type,job_scope)
       VALUES($1,$2,$3,$4,$5,'qualified','Plumbing','{}')`,
      [opportunity, fixture.org, operation, graph, customer]
    );
    await fixture.ownerPool.query(
      `INSERT INTO canonical_estimates(id,organization_id,operation_id,graph_id,
         opportunity_id,calculation_version,normalized_input_fingerprint,
         business_profile_version,business_profile_hash,currency,customer_price,
         line_items,calculation_output,snapshot_digest)
       VALUES($1,$2,$3,$4,$5,'fixture-v1',$6,'org-profile-v1',$6,'USD',500,'[]','{}',$6)`,
      [estimateId, fixture.org, operation, graph, opportunity, fingerprint]
    );
    return estimateId;
  }

  test('captures only visible revisions, freezes history, and replays one exact request', async () => {
    const owner = fixture.actors.owner;
    const requestKey = key();
    const before = await capture(owner, requestKey);
    expect(before.snapshot.sourceCount).toBe(0);
    expect(before.replayed).toBe(false);

    const estimateId = await estimate();
    const approvalId = await decision(estimateId, 'approve', 1);
    const replay = await capture(owner, requestKey);
    expect(replay.replayed).toBe(true);
    expect(replay.snapshot).toEqual(before.snapshot);

    const approved = await capture(owner);
    expect(approved.snapshot.sourceCount).toBe(1);
    expect(normalizeAsOfSourceManifest({
      version: approved.snapshot.version,
      organizationId: approved.snapshot.organizationId,
      asOf: approved.snapshot.asOf,
      capturedAt: approved.snapshot.capturedAt,
      purposeKey: approved.snapshot.purposeKey,
      targetKey: approved.snapshot.targetKey,
      sources: approved.snapshot.sources,
    }).sources).toEqual(approved.snapshot.sources);
    expect(approved.snapshot.sources[0]).toMatchObject({
      sourceKind: 'estimate_decision', sourceId: approvalId,
      revision: 1, state: 'active',
    });
    expect(JSON.stringify(approved.snapshot)).not.toContain('500.00');
    expect(JSON.stringify(approved.snapshot)).not.toContain('Synthetic customer');

    await decision(estimateId, 'withdraw', 2, approvalId);
    const withdrawn = await capture(owner);
    expect(withdrawn.snapshot.sources[0].state).toBe('tombstone');
    expect(withdrawn.snapshot.sources[0].revision).toBe(2);
    expect(approved.snapshot.sources[0].sourceId).toBe(approvalId);
    expect(withdrawn.snapshot.sourceSnapshotDigest).not.toBe(approved.snapshot.sourceSnapshotDigest);

    const persisted = (await fixture.ownerPool.query(
      'SELECT count(*)::int total FROM canonical_forecast_source_snapshots WHERE organization_id=$1',
      [fixture.org]
    )).rows[0].total;
    expect(persisted).toBe(3);
  }, 120000);

  test('denies member and cross-tenant access and prevents history edits', async () => {
    const member = fixture.actors.member;
    await expect(capture(member)).rejects.toMatchObject({ code: '42501' });
    const owner = fixture.actors.owner;
    const saved = await capture(owner);
    const readSql = 'SELECT public.canonical_forecast_source_snapshot_read($1,$2,$3,$4,$5) value';
    const own = await fixture.runtimePool.query(readSql,
      [fixture.org, owner.actorUserId, owner.actorAccessRole,
        owner.authSessionId, saved.snapshot.id]);
    expect(own.rows[0].value.sourceSnapshotDigest).toBe(saved.snapshot.sourceSnapshotDigest);
    await fixture.ownerPool.query("UPDATE subscriptions SET status='past_due' WHERE organization_id=$1", [fixture.org]);
    try {
      await expect(fixture.runtimePool.query(readSql,
        [fixture.org, owner.actorUserId, owner.actorAccessRole,
          owner.authSessionId, saved.snapshot.id])).rejects.toMatchObject({ code: '42501' });
      await expect(capture(owner)).rejects.toMatchObject({ code: '42501' });
    } finally {
      await fixture.ownerPool.query("UPDATE subscriptions SET status='active' WHERE organization_id=$1", [fixture.org]);
    }
    const other = fixture.actors.otherOwner;
    const denied = await fixture.runtimePool.query(readSql,
      [fixture.otherOrg, other.actorUserId, other.actorAccessRole,
        other.authSessionId, saved.snapshot.id]);
    expect(denied.rows[0].value).toBeNull();
    await expect(fixture.runtimePool.query('SELECT * FROM canonical_forecast_source_snapshots'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(fixture.runtimePool.query(
      'SELECT public.canonical_forecast_estimate_decision_pins($1,NOW())', [fixture.org]
    )).rejects.toMatchObject({ code: '42501' });
    await expect(fixture.ownerPool.query(
      'UPDATE canonical_forecast_source_snapshots SET purpose_key=purpose_key WHERE id=$1',
      [saved.snapshot.id]
    )).rejects.toMatchObject({ code: '23514' });
    await expect(fixture.ownerPool.query(
      'DELETE FROM canonical_forecast_source_snapshots WHERE id=$1', [saved.snapshot.id]
    )).rejects.toMatchObject({ code: '23514' });
  }, 120000);
});
