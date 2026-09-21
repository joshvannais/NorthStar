'use strict';

const crypto = require('node:crypto');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const { graphRequest } = require('../../src/services/canonicalRetellIngestion');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const key = () => crypto.randomUUID();
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

realPostgres('Mission 26 guarded Retell scan inputs', () => {
  let fixture;
  beforeAll(async () => { fixture = await createDatabaseFixture(); }, 120000);
  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  test('only a current tenant, consent, owner session and single active agent reveal hashes', async () => {
    const owner = fixture.actors.owner;
    const external = 'synthetic-' + key();
    const agent = 'synthetic-agent-' + key();
    const ownership = (await fixture.ownerPool.query(
      `INSERT INTO canonical_integration_ownership(organization_id,provider,external_integration_id)
       VALUES($1,'retell',$2) RETURNING id`, [fixture.org, agent])).rows[0].id;
    const client = await fixture.runtimePool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await client.query(
        'SELECT public.canonical_forecast_retell_source_consent_mutate($1,$2,$3,$4,$5,$6,$7::jsonb)',
        [fixture.org, owner.actorUserId, owner.actorAccessRole, owner.authSessionId,
          owner.csrfToken, key(), JSON.stringify({ action: 'grant', expectedRevision: 0,
            expectedDigest: 'none', reason: 'Synthetic consent', confirmed: true,
            confirmationVersion: 'm26-retell-demand-source-consent-v1' })]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }

    const op = key(), graph = key(), customer = key(), transcript = key();
    const occurred = graphRequest({ event: 'call_ended', call: {
      call_id: external, agent_id: agent, start_timestamp: 1789905600000,
    } }, { organizationId: fixture.org }, null, 'synthetic-event').occurredAt;
    expect(occurred).toBe('2026-09-20T12:00:00.000Z');
    await fixture.ownerPool.query(
      `INSERT INTO canonical_operations(id,organization_id,graph_id,idempotency_key_hash,
       payload_fingerprint,state,lease_owner,lease_expires_at,result_status,result_body,completed_at)
       VALUES($1,$2,$3,$4,$4,'completed',$1,NOW()+INTERVAL '1 hour',200,'{}',NOW())`,
      [op, fixture.org, graph, hash(key())]);
    await fixture.ownerPool.query(
      `INSERT INTO canonical_customers(id,organization_id,operation_id,graph_id,name)
       VALUES($1,$2,$3,$4,'Synthetic caller')`, [customer, fixture.org, op, graph]);
    await fixture.ownerPool.query(
      `INSERT INTO canonical_transcripts(id,organization_id,operation_id,graph_id,customer_id,
       source,source_version,external_call_id,transcript_text,normalized_fingerprint,occurred_at)
       VALUES($1,$2,$3,$4,$5,'retell','synthetic-v1',$6,'Synthetic call',$7,$8)`,
      [transcript, fixture.org, op, graph, customer, external, hash(external), occurred]);
    await fixture.ownerPool.query(
      `INSERT INTO canonical_communications(id,organization_id,operation_id,graph_id,
       customer_id,transcript_id,channel,direction,body,occurred_at)
       VALUES($1,$2,$3,$4,$5,$6,'voice_call','inbound','Synthetic call',$7)`,
      [key(), fixture.org, op, graph, customer, transcript, occurred]);
    await fixture.ownerPool.query(
      `INSERT INTO canonical_opportunities(id,organization_id,operation_id,graph_id,
       customer_id,status,service_type,job_scope)
       VALUES($1,$2,$3,$4,$5,'lead','general','{}')`,
      [key(), fixture.org, op, graph, customer]);
    const profile = fixture.profiles[fixture.org];
    await fixture.ownerPool.query(
      `INSERT INTO canonical_voice_sessions(organization_id,external_session_id,provider,
       provider_session_id,integration_ownership_id,business_profile_id,business_profile_version,
       business_profile_hash,status,direction,metadata,canonical_operation_id,completed_at)
       VALUES($1,$2,'retell',$2,$3,$4,'org-profile-v1',$5,'completed','inbound',
       '{"retellPayloadDirection":"inbound"}'::jsonb,$6,NOW())`,
      [fixture.org, external, ownership, profile.businessProfileId, profile.hash, op]);
    const captureClient = await fixture.runtimePool.connect();
    let receipt;
    try {
      await captureClient.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      receipt = (await captureClient.query(
        'SELECT public.canonical_forecast_retell_call_snapshot_capture($1,$2,$3,$4,$5,$6) value',
        [fixture.org, owner.actorUserId, owner.actorAccessRole, owner.authSessionId,
          owner.csrfToken, key()])).rows[0].value.snapshot;
      await captureClient.query('COMMIT');
    } catch (error) { await captureClient.query('ROLLBACK').catch(() => {}); throw error; }
    finally { captureClient.release(); }

    const sql = `SELECT public.canonical_forecast_retell_scan_inputs_read(
      $1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz) value`;
    const params = [fixture.org, owner.actorUserId, owner.actorAccessRole, owner.authSessionId,
      receipt.id, '2026-09-20T00:00:00.000Z', '2026-09-21T00:00:00.000Z'];
    const scan = (await fixture.runtimePool.query(sql, params)).rows[0].value;
    expect(scan).toMatchObject({ state: 'ready_for_diagnostic', agentId: agent,
      canonicalCallDigests: [hash(external)], historicalCoverageCertified: false });
    expect(JSON.stringify(scan)).not.toContain(external);
    await expect(fixture.runtimePool.query(sql,
      [fixture.otherOrg, fixture.actors.otherOwner.actorUserId,
        fixture.actors.otherOwner.actorAccessRole, fixture.actors.otherOwner.authSessionId,
        receipt.id, ...params.slice(5)])).resolves.toMatchObject({ rows: [{ value: null }] });
    await expect(fixture.runtimePool.query(sql, [fixture.org, fixture.actors.member.actorUserId,
      fixture.actors.member.actorAccessRole, fixture.actors.member.authSessionId, ...params.slice(4)]))
      .rejects.toMatchObject({ code: '42501' });
    await fixture.ownerPool.query(
      `UPDATE canonical_integration_ownership SET status='inactive' WHERE id=$1`, [ownership]);
    expect((await fixture.runtimePool.query(sql, params)).rows[0].value)
      .toMatchObject({ state: 'unavailable', reason: 'integration_ownership_unavailable' });
  }, 120000);
});
