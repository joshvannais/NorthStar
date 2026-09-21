'use strict';

const crypto = require('node:crypto');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const { normalizeAsOfSourceManifest } = require('../../src/forecasting/asOfSourceManifest');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const key = () => crypto.randomUUID();

realPostgres('Mission 26 Part 4A Retell call source receipts', () => {
  let fixture;
  beforeAll(async () => {
    fixture = await createDatabaseFixture();
    fixture.retellOwnership = {};
    for (const tenant of [fixture.org, fixture.otherOrg]) {
      fixture.retellOwnership[tenant] = (await fixture.ownerPool.query(
        `INSERT INTO canonical_integration_ownership(organization_id,provider,external_integration_id)
         VALUES($1,'retell',$2) RETURNING id`, [tenant, 'synthetic-' + key()])).rows[0].id;
    }
  }, 120000);
  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  async function capture(actor, requestKey = key()) {
    const client = await fixture.runtimePool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const result = await client.query(
        'SELECT public.canonical_forecast_retell_call_snapshot_capture($1,$2,$3,$4,$5,$6) value',
        [actor.organizationId, actor.actorUserId, actor.actorAccessRole,
          actor.authSessionId, actor.csrfToken, requestKey]);
      await client.query('COMMIT');
      return result.rows[0].value;
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }
  async function call({ tenant = fixture.org, source = 'retell',
    eventAt = new Date(Date.now() - 3600000).toISOString(),
    direction = 'inbound', channel = 'voice_call', customerId = null,
    client = fixture.ownerPool } = {}) {
    const operation = key(), graph = key(), customer = customerId || key();
    const transcript = key(), opportunity = key(), fingerprint = hash(key());
    const external = 'synthetic-call-' + key();
    await client.query(
      `INSERT INTO canonical_operations(id,organization_id,graph_id,idempotency_key_hash,
         payload_fingerprint,state,lease_owner,lease_expires_at,result_status,result_body,completed_at)
       VALUES($1,$2,$3,$4,$4,'completed',$1,NOW()+INTERVAL '1 hour',200,'{}',NOW())`,
      [operation, tenant, graph, fingerprint]);
    if (!customerId) await client.query(
      `INSERT INTO canonical_customers(id,organization_id,operation_id,graph_id,name)
       VALUES($1,$2,$3,$4,'Synthetic caller')`, [customer, tenant, operation, graph]);
    await client.query(
      `INSERT INTO canonical_transcripts(id,organization_id,operation_id,graph_id,customer_id,
         source,source_version,external_call_id,external_transcript_id,transcript_text,
         normalized_fingerprint,occurred_at)
       VALUES($1,$2,$3,$4,$5,$6,'synthetic-v1',$7,$8,'Synthetic call',$9,$10)`,
      [transcript, tenant, operation, graph, customer, source, external,
        external + ':transcript', hash(external), eventAt]);
    await client.query(
      `INSERT INTO canonical_communications(id,organization_id,operation_id,graph_id,
         customer_id,transcript_id,channel,direction,body,occurred_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,'inbound','Synthetic call',$8)`,
      [key(), tenant, operation, graph, customer, transcript, channel, eventAt]);
    await client.query(
      `INSERT INTO canonical_opportunities(id,organization_id,operation_id,graph_id,
         customer_id,status,service_type,job_scope)
       VALUES($1,$2,$3,$4,$5,'lead','general','{}')`,
      [opportunity, tenant, operation, graph, customer]);
    const profile = fixture.profiles[tenant];
    await client.query(
      `INSERT INTO canonical_voice_sessions(organization_id,external_session_id,provider,
         provider_session_id,integration_ownership_id,business_profile_id,business_profile_version,
         business_profile_hash,status,direction,canonical_operation_id,completed_at)
       VALUES($1,$2,'retell',$2,$3,$4,$5,$6,'completed',$7,$8,NOW())`,
      [tenant, external, fixture.retellOwnership[tenant], profile.businessProfileId,
        'org-profile-v1', profile.hash, direction, operation]);
    return { transcript, opportunity, external, customer };
  }

  test('pins only completed Retell inbound calls, keeps missing occurrence and never calls them leads', async () => {
    const owner = fixture.actors.owner;
    const emptyKey = key();
    const empty = await capture(owner, emptyKey);
    expect(empty.snapshot.sourceCount).toBe(0);
    const first = await call();
    const second = await call({ customerId: first.customer, eventAt: null });
    await call({ source: 'lead' });
    await call({ direction: 'outbound' });
    await call({ tenant: fixture.otherOrg });
    expect((await capture(owner, emptyKey)).snapshot).toEqual(empty.snapshot);
    const captured = await capture(owner);
    expect(captured.snapshot.sourceCount).toBe(2);
    expect(captured.snapshot.sources.map(row => row.sourceId).sort())
      .toEqual([first.transcript, second.transcript].sort());
    expect(captured.snapshot.sources.find(row => row.sourceId === second.transcript).eventAt).toBeNull();
    expect(captured.snapshot.sources.every(row => row.sourceKind === 'retell_call')).toBe(true);
    expect(normalizeAsOfSourceManifest({ version: captured.snapshot.version,
      organizationId: captured.snapshot.organizationId, asOf: captured.snapshot.asOf,
      capturedAt: captured.snapshot.capturedAt, purposeKey: captured.snapshot.purposeKey,
      targetKey: captured.snapshot.targetKey, sources: captured.snapshot.sources }).sources)
      .toEqual(captured.snapshot.sources);
    expect(JSON.stringify(captured.snapshot)).not.toContain(first.external);
    expect(JSON.stringify(captured.snapshot)).not.toContain('Synthetic caller');
    expect(captured.snapshot.identityBoundary).toMatch(/not distinct reviewed lead identities/);
  }, 120000);

  test('guards current access, tenant isolation, immutable history and stale source correction', async () => {
    const owner = fixture.actors.owner;
    await expect(capture(fixture.actors.member)).rejects.toMatchObject({ code: '42501' });
    await expect(capture({ ...owner, csrfToken: 'invalid-csrf' }))
      .rejects.toMatchObject({ code: '42501' });
    const seeded = await call();
    const requestKey = key();
    const saved = await capture(owner, requestKey);
    const readSql = 'SELECT public.canonical_forecast_retell_call_snapshot_read($1,$2,$3,$4,$5) value';
    const params = [fixture.org, owner.actorUserId, owner.actorAccessRole, owner.authSessionId, saved.snapshot.id];
    const before = await fixture.runtimePool.query(readSql, params);
    expect(before.rows[0].value).toMatchObject({ stale: false, refreshRequired: false });
    await expect(fixture.runtimePool.query(readSql,
      [fixture.org, fixture.actors.member.actorUserId, fixture.actors.member.actorAccessRole,
        fixture.actors.member.authSessionId, saved.snapshot.id]))
      .rejects.toMatchObject({ code: '42501' });
    const other = fixture.actors.otherOwner;
    const cross = await fixture.runtimePool.query(readSql,
      [fixture.otherOrg, other.actorUserId, other.actorAccessRole, other.authSessionId, saved.snapshot.id]);
    expect(cross.rows[0].value).toBeNull();
    await expect(fixture.runtimePool.query('SELECT * FROM canonical_forecast_retell_call_snapshots'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(fixture.runtimePool.query('SELECT canonical_forecast_retell_call_pins($1,NOW())',
      [fixture.org])).rejects.toMatchObject({ code: '42501' });
    await expect(fixture.ownerPool.query(
      'UPDATE canonical_forecast_retell_call_snapshots SET target_key=target_key WHERE id=$1',
      [saved.snapshot.id])).rejects.toMatchObject({ code: '23514' });
    const source = saved.snapshot.sources.find(row => row.sourceId === seeded.transcript);
    expect(source).toBeDefined();
    // The graph communication is always labelled inbound by the current Retell adapter.
    // Only the linked provider voice session proves call direction for this source.
    await fixture.ownerPool.query(
      `UPDATE canonical_voice_sessions SET direction='outbound'
       WHERE organization_id=$1 AND provider_session_id=$2`, [fixture.org, seeded.external]);
    expect((await fixture.runtimePool.query(readSql, params)).rows[0].value)
      .toMatchObject({ stale: true, refreshRequired: true, sources: [] });
    await fixture.ownerPool.query(
      `UPDATE canonical_voice_sessions SET direction='inbound'
       WHERE organization_id=$1 AND provider_session_id=$2`, [fixture.org, seeded.external]);
    await fixture.ownerPool.query('UPDATE canonical_transcripts SET occurred_at=NOW() WHERE id=$1',
      [source.sourceId]);
    const stale = await fixture.runtimePool.query(readSql, params);
    expect(stale.rows[0].value).toMatchObject({ stale: true, refreshRequired: true, sources: [] });
    expect((await capture(owner, requestKey)).snapshot)
      .toMatchObject({ stale: true, refreshRequired: true, sources: [] });
    await fixture.ownerPool.query("UPDATE subscriptions SET status='past_due' WHERE organization_id=$1",
      [fixture.org]);
    try {
      await expect(fixture.runtimePool.query(readSql, params))
        .rejects.toMatchObject({ code: '42501' });
      await expect(capture(owner)).rejects.toMatchObject({ code: '42501' });
    } finally {
      await fixture.ownerPool.query("UPDATE subscriptions SET status='active' WHERE organization_id=$1",
        [fixture.org]);
    }
  }, 120000);

  test('does not date a concurrent call before its commit becomes visible', async () => {
    const ownerTx = await fixture.ownerPool.connect();
    const captureTx = await fixture.runtimePool.connect();
    try {
      await ownerTx.query('BEGIN');
      const inserted = await call({ client: ownerTx });
      await captureTx.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await ownerTx.query('COMMIT');
      const committedAt = (await fixture.ownerPool.query(
        `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') value`)).rows[0].value;
      const owner = fixture.actors.owner;
      const captured = (await captureTx.query(
        'SELECT public.canonical_forecast_retell_call_snapshot_capture($1,$2,$3,$4,$5,$6) value',
        [owner.organizationId, owner.actorUserId, owner.actorAccessRole,
          owner.authSessionId, owner.csrfToken, key()])).rows[0].value;
      await captureTx.query('COMMIT');
      expect(captured.snapshot.sources.some(row => row.sourceId === inserted.transcript)).toBe(true);
      expect(captured.snapshot.asOf >= committedAt).toBe(true);
    } finally {
      await ownerTx.query('ROLLBACK').catch(() => {});
      await captureTx.query('ROLLBACK').catch(() => {});
      ownerTx.release(); captureTx.release();
    }
  }, 120000);

  test('refuses an unbounded call cohort rather than truncating its snapshot', async () => {
    const client = await fixture.ownerPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`CREATE TEMP TABLE m26_bulk_calls ON COMMIT DROP AS
        SELECT n,gen_random_uuid() operation_id,gen_random_uuid() graph_id,
          gen_random_uuid() customer_id,gen_random_uuid() transcript_id,
          gen_random_uuid() communication_id,gen_random_uuid() opportunity_id
        FROM generate_series(1,1001) n`);
      await client.query(`INSERT INTO canonical_operations(id,organization_id,graph_id,
          idempotency_key_hash,payload_fingerprint,state,lease_owner,lease_expires_at,
          result_status,result_body,completed_at)
        SELECT operation_id,$1,graph_id,encode(sha256(convert_to(operation_id::text,'UTF8')),'hex'),
          encode(sha256(convert_to(operation_id::text,'UTF8')),'hex'),'completed',operation_id,
          NOW()+INTERVAL '1 hour',200,'{}',NOW() FROM m26_bulk_calls`, [fixture.org]);
      await client.query(`INSERT INTO canonical_customers(id,organization_id,operation_id,graph_id,name)
        SELECT customer_id,$1,operation_id,graph_id,'Synthetic bulk caller' FROM m26_bulk_calls`, [fixture.org]);
      await client.query(`INSERT INTO canonical_transcripts(id,organization_id,operation_id,graph_id,
          customer_id,source,source_version,external_call_id,transcript_text,normalized_fingerprint,occurred_at)
        SELECT transcript_id,$1,operation_id,graph_id,customer_id,'retell','synthetic-v1',
          'm26-bulk-'||n,'Synthetic call',encode(sha256(convert_to(transcript_id::text,'UTF8')),'hex'),NOW()
        FROM m26_bulk_calls`, [fixture.org]);
      await client.query(`INSERT INTO canonical_communications(id,organization_id,operation_id,
          graph_id,customer_id,transcript_id,channel,direction,body,occurred_at)
        SELECT communication_id,$1,operation_id,graph_id,customer_id,transcript_id,
          'voice_call','inbound','Synthetic call',NOW() FROM m26_bulk_calls`, [fixture.org]);
      await client.query(`INSERT INTO canonical_opportunities(id,organization_id,operation_id,
          graph_id,customer_id,status,service_type,job_scope)
        SELECT opportunity_id,$1,operation_id,graph_id,customer_id,
        'lead','general','{}' FROM m26_bulk_calls`, [fixture.org]);
      const profile = fixture.profiles[fixture.org];
      await client.query(`INSERT INTO canonical_voice_sessions(organization_id,external_session_id,
          provider,provider_session_id,integration_ownership_id,business_profile_id,
          business_profile_version,business_profile_hash,status,direction,canonical_operation_id,completed_at)
        SELECT $1,'m26-bulk-'||n,'retell','m26-bulk-'||n,$2,$3,'org-profile-v1',$4,
          'completed','inbound',operation_id,NOW() FROM m26_bulk_calls`,
      [fixture.org, fixture.retellOwnership[fixture.org], profile.businessProfileId, profile.hash]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
    await expect(capture(fixture.actors.owner)).rejects.toMatchObject({ code: '54000' });
  }, 120000);
});
