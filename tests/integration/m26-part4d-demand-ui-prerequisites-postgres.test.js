'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
jest.mock('../../src/retell/client', () => ({ listInboundCallsPage: jest.fn(async () => ({
  items: [], has_more: false,
})) }));
const { listInboundCallsPage } = require('../../src/retell/client');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const research = require('../../public/js/command-center-demand-research');
const { openPaidResearchBrowser } = require('../helpers/m26-part4d-paid-browser');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const ROOT = '/api/v1/forecast/demand-to-schedule';
const PROFILE = '/api/v1/forecast/reporting-windows/effective-anchors';
const key = prefix => `${prefix}-${crypto.randomUUID()}`;

realPostgres('Mission 26 Part 4D paid prerequisite projection', () => {
  let fixture; let anchorId; let ui;
  beforeAll(async () => { fixture = await createDatabaseFixture({ operationalSchedule: true }); }, 120000);
  afterAll(async () => {
    if (ui) await ui.close();
    if (fixture) await fixture.cleanup();
  }, 120000);
  const owner = () => fixture.actors.owner;
  const admin = () => fixture.actors.admin;

  test('fresh migration exposes no private source and no write occurs on read', async () => {
    const before = await fixture.ownerPool.query(
      'SELECT count(*)::integer count FROM canonical_forecast_demand_schedule_method_reviews_v1');
    const result = await request(fixture.app).get(`${ROOT}/prerequisites/current`)
      .set(owner().session.headers);
    expect(result.status).toBe(200);
    expect(research.validatePrerequisites(result.body.data)).not.toBeNull();
    expect(result.body.data.profile).toEqual({ state: 'unavailable', anchorId: null });
    expect(result.body.data.seasonal.method).toEqual({ expectedRevision: 0,
      expectedDigest: 'none', action: null, approved: false });
    expect(result.body.data.pipeline.epoch).toEqual({ state: 'missing', id: null,
      revision: null, installedAt: null });
    expect(JSON.stringify(result.body)).not.toMatch(/reason|member|consent|integration|probability|outputDigest|private/i);
    const after = await fixture.ownerPool.query(
      'SELECT count(*)::integer count FROM canonical_forecast_demand_schedule_method_reviews_v1');
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });

  test('projects a server-selected current profile and exact current human review token', async () => {
    const anchored = await request(fixture.app).post(PROFILE).set(owner().session.headers)
      .set('Idempotency-Key', key('part4d-profile')).send({
        reason: 'Pin the current profile for the explicit Part 4D research setup.', confirmed: true });
    expect(anchored.status).toBe(201); anchorId = anchored.body.data.anchorId;
    expect((await request(fixture.app).post(`${PROFILE}/${anchorId}/activate`)
      .set(owner().session.headers).send({})).status).toBe(200);

    const reviewed = await request(fixture.app).post(`${ROOT}/method-reviews`)
      .set(admin().session.headers).set('Idempotency-Key', key('part4d-method')).send({
        purpose: 'pipeline_first_booking', action: 'approve', expectedRevision: 0,
        expectedDigest: 'none', reason: 'Approve the exact fixed first-booking research method.',
        confirmed: true, confirmationVersion: 'm26-demand-schedule-method-review-v1' });
    expect(reviewed.status).toBe(201);

    const result = await request(fixture.app).get(`${ROOT}/prerequisites/current`)
      .set(owner().session.headers);
    expect(result.status).toBe(200);
    expect(result.body.data.profile).toEqual({ state: 'current', anchorId });
    expect(result.body.data.pipeline.method).toEqual({ expectedRevision: 1,
      expectedDigest: reviewed.body.data.digest, action: 'approve', approved: true });
    expect(research.validatePrerequisites(result.body.data)).not.toBeNull();
  });

  test('real paid DOM reaches profile, permission, call review and completed-month certification authorities',
    async () => {
      // Exercise the complete setup from an otherwise unconfigured tenant. The
      // suite's primary tenant already consumed its bounded source-capture
      // allowance while proving the prerequisite projection above.
      const tenant = fixture.otherOrg;
      const profile = fixture.profiles[tenant];
      const selectedMonth = (await fixture.ownerPool.query(
        `SELECT (date_trunc('month',clock_timestamp())-INTERVAL '2 months')::date::text month_value`))
        .rows[0].month_value;
      const selectedOccurredAt = `${selectedMonth}T17:00:00.000Z`;
      const integrationExternalId = `part4d-${crypto.randomUUID()}`;
      const integration = (await fixture.ownerPool.query(
        `INSERT INTO canonical_integration_ownership(
          organization_id,provider,external_integration_id)
         VALUES($1,'retell',$2) RETURNING id`, [tenant, integrationExternalId]))
        .rows[0].id;
      // More than 1,000 genuine older calls make the legacy all-history
      // snapshot unavailable. The UI must still use the bounded selected
      // month receipt for review and certification without truncation.
      const oldOccurredAt = (await fixture.ownerPool.query(
        `SELECT ($1::date-INTERVAL '4 months'+INTERVAL '15 days 12 hours')::timestamptz::text value`,
      [selectedMonth])).rows[0].value;
      await fixture.ownerPool.query(`DO $block$
        DECLARE i integer; operation_id uuid; graph_id uuid; customer_id uuid;
         transcript_id uuid; external_id text; fingerprint text;
        BEGIN
         FOR i IN 1..1001 LOOP
          operation_id:=gen_random_uuid(); graph_id:=gen_random_uuid();
          customer_id:=gen_random_uuid(); transcript_id:=gen_random_uuid();
          external_id:='part4d-old-'||gen_random_uuid()::text;
          fingerprint:=encode(sha256(convert_to(external_id,'UTF8')),'hex');
          INSERT INTO canonical_operations(id,organization_id,graph_id,idempotency_key_hash,
           payload_fingerprint,state,lease_owner,lease_expires_at,result_status,result_body,completed_at)
          VALUES(operation_id,'${tenant}',graph_id,fingerprint,fingerprint,'completed',operation_id,
           NOW()+INTERVAL '1 hour',200,'{}',NOW());
          INSERT INTO canonical_customers(id,organization_id,operation_id,graph_id,name)
          VALUES(customer_id,'${tenant}',operation_id,graph_id,'Older bounded source caller');
          INSERT INTO canonical_transcripts(id,organization_id,operation_id,graph_id,customer_id,
           source,source_version,external_call_id,external_transcript_id,transcript_text,
           normalized_fingerprint,occurred_at)
          VALUES(transcript_id,'${tenant}',operation_id,graph_id,customer_id,'retell','part4d-v1',
           external_id,external_id||':transcript','Older bounded source call',fingerprint,
           '${oldOccurredAt}');
          INSERT INTO canonical_communications(id,organization_id,operation_id,graph_id,
           customer_id,transcript_id,channel,direction,body,occurred_at)
          VALUES(gen_random_uuid(),'${tenant}',operation_id,graph_id,customer_id,transcript_id,
           'voice_call','inbound','Older bounded source call','${oldOccurredAt}');
          INSERT INTO canonical_opportunities(id,organization_id,operation_id,graph_id,
           customer_id,status,service_type,job_scope)
          VALUES(gen_random_uuid(),'${tenant}',operation_id,graph_id,customer_id,
           'lead','general','{}');
          INSERT INTO canonical_voice_sessions(organization_id,external_session_id,provider,
           provider_session_id,integration_ownership_id,business_profile_id,business_profile_version,
           business_profile_hash,status,direction,metadata,canonical_operation_id,completed_at)
          VALUES('${tenant}',external_id,'retell',external_id,'${integration}',
           '${profile.businessProfileId}','org-profile-v1','${profile.hash}','completed','inbound',
           '{"retellPayloadDirection":"inbound"}'::jsonb,operation_id,NOW());
         END LOOP;
        END $block$`);
      const operation = crypto.randomUUID(), graph = crypto.randomUUID();
      const customer = crypto.randomUUID(), transcript = crypto.randomUUID();
      const external = `part4d-call-${crypto.randomUUID()}`;
      const digest = crypto.createHash('sha256').update(external).digest('hex');
      await fixture.ownerPool.query(
        `INSERT INTO canonical_operations(id,organization_id,graph_id,idempotency_key_hash,
          payload_fingerprint,state,lease_owner,lease_expires_at,result_status,result_body,completed_at)
         VALUES($1,$2,$3,$4,$4,'completed',$1,NOW()+INTERVAL '1 hour',200,'{}',NOW())`,
      [operation, tenant, graph, digest]);
      await fixture.ownerPool.query(
        `INSERT INTO canonical_customers(id,organization_id,operation_id,graph_id,name)
         VALUES($1,$2,$3,$4,'Part 4D setup caller')`, [customer, tenant, operation, graph]);
      await fixture.ownerPool.query(
        `INSERT INTO canonical_transcripts(id,organization_id,operation_id,graph_id,customer_id,
          source,source_version,external_call_id,external_transcript_id,transcript_text,
          normalized_fingerprint,occurred_at)
         VALUES($1,$2,$3,$4,$5,'retell','part4d-v1',$6,$7,'Part 4D setup call',$8,$9)`,
      [transcript, tenant, operation, graph, customer, external,
        `${external}:transcript`, digest, selectedOccurredAt]);
      await fixture.ownerPool.query(
        `INSERT INTO canonical_communications(id,organization_id,operation_id,graph_id,
          customer_id,transcript_id,channel,direction,body,occurred_at)
         VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,'voice_call','inbound','Part 4D setup call',$6)`,
      [tenant, operation, graph, customer, transcript, selectedOccurredAt]);
      await fixture.ownerPool.query(
        `INSERT INTO canonical_opportunities(id,organization_id,operation_id,graph_id,
          customer_id,status,service_type,job_scope)
         VALUES(gen_random_uuid(),$1,$2,$3,$4,'lead','general','{}')`,
      [tenant, operation, graph, customer]);
      await fixture.ownerPool.query(
        `INSERT INTO canonical_voice_sessions(organization_id,external_session_id,provider,
          provider_session_id,integration_ownership_id,business_profile_id,business_profile_version,
          business_profile_hash,status,direction,metadata,canonical_operation_id,completed_at)
         VALUES($1,$2,'retell',$2,$3,$4,'org-profile-v1',$5,'completed','inbound',
          '{"retellPayloadDirection":"inbound"}'::jsonb,$6,NOW())`,
      [tenant, external, integration, profile.businessProfileId, profile.hash, operation]);

      ui = await openPaidResearchBrowser(fixture, 'otherOwner');
      await ui.page.locator('#commandCenterResearchCertificationMonth').fill(selectedMonth);
      await ui.page.locator('#commandCenterResearchDecisionReason')
        .fill('Owner explicitly confirms this bounded Part 4D research prerequisite.');
      await ui.action('profile-window-load', 'Current decision loaded', 'Setup');
      await ui.action('profile-anchor-capture', 'Decision recorded', 'Setup');
      expect(await ui.page.locator('#commandCenterResearchProfileAnchorId').inputValue())
        .toMatch(/^[0-9a-f-]{36}$/);
      await ui.action('profile-anchor-activate', 'Decision recorded', 'Setup');
      await ui.action('month-attestation-load', 'Current decision loaded', 'Setup');
      await ui.action('month-attestation-confirm', 'Current decision loaded', 'Setup');
      await ui.action('consent-load', 'Retell research permission inactive', 'Setup');
      await ui.action('consent-grant', 'Current decision loaded', 'Setup');
      expect((await fixture.ownerPool.query(
        `SELECT jsonb_array_length(canonical_forecast_retell_call_pins($1,clock_timestamp())) count`,
      [tenant])).rows[0].count).toBe(1001);
      await ui.action('period-snapshot', 'Current decision loaded', 'Setup');
      expect(await ui.page.locator('#commandCenterResearchPeriodSnapshotId').inputValue())
        .toMatch(/^[0-9a-f-]{36}$/);
      expect(await ui.page.locator('#commandCenterResearchRetellSnapshotId').inputValue())
        .toBe(await ui.page.locator('#commandCenterResearchPeriodSnapshotId').inputValue());
      expect(await ui.page.locator('#commandCenterResearchRetellCallSourceId').inputValue())
        .toBe(transcript);
      await ui.action('retell-review-save', 'Decision recorded', 'Setup');
      await ui.action('certification-load', 'Current decision loaded', 'Setup');
      listInboundCallsPage.mockImplementation(async ({ agentId }) => ({
        items: [{ agent_id: agentId, call_type: 'phone_call', direction: 'inbound',
          call_id: external, start_timestamp: Date.parse(selectedOccurredAt),
          call_status: 'ended' }], has_more: false,
      }));
      await ui.action('certification-certify', 'Current decision loaded', 'Setup');
      const periodCapture = ui.responses.find(response => response.method === 'POST' &&
        response.url.endsWith('/api/v1/forecast/demand-sources/retell/period-snapshots'));
      expect(periodCapture.body.data).toMatchObject({ sourceCount: 1,
        localMonthStart: selectedMonth });
      expect(periodCapture.body.data.sources).toHaveLength(1);
      const certification = await request(fixture.app)
        .get(`/api/v1/forecast/demand-sources/retell/period-certifications/${selectedMonth}`)
        .set(fixture.actors.otherOwner.session.headers);
      expect(certification.status).toBe(200);
      expect(certification.body.data).toMatchObject({ state: 'retell_period_certified',
        localMonthStart: selectedMonth, callerConsentAttested: true,
        providerCoverageAttested: true, forecastIssued: false, paidNumericServing: false });
      expect(JSON.stringify(certification.body)).not.toMatch(/external|transcriptText|probability|outputDigest/i);

      // The certification preflight is a guarded, side-effect-free scan. Its
      // source/profile SHARE locks require a writable transaction declaration,
      // but provider disagreement must still stop before the mutation entry and
      // preserve the exact existing receipt count/current token.
      const beforeRefusal = (await fixture.ownerPool.query(
        `SELECT count(*)::integer count FROM canonical_forecast_retell_period_certifications_v2
         WHERE organization_id=$1 AND local_month_start=$2::date`,
      [tenant, selectedMonth])).rows[0].count;
      listInboundCallsPage.mockImplementationOnce(async ({ agentId, startsAtMs }) => ({
        items: [{ agent_id: agentId, call_type: 'phone_call', direction: 'inbound',
          call_id: `unexpected-${crypto.randomUUID()}`, start_timestamp: startsAtMs + 1000,
          call_status: 'ended' }], has_more: false,
      }));
      const refusedCertification = await request(fixture.app)
        .post('/api/v1/forecast/demand-sources/retell/period-certifications')
        .set(fixture.actors.otherOwner.session.headers)
        .set('Idempotency-Key', key('part4d-cert-preflight-refusal')).send({
          action: 'certify', snapshotId: certification.body.data.snapshotId,
          localMonthStart: selectedMonth,
          expectedRevision: certification.body.data.expectedRevision,
          expectedDigest: certification.body.data.expectedDigest,
          callerConsentAttested: true, providerCoverageAttested: true,
          retentionAttested: true,
          reason: 'Refuse this certification when the bounded provider scan disagrees.',
          confirmed: true, confirmationVersion: 'm26-retell-period-certification-v2',
        });
      expect(refusedCertification.status).toBe(409);
      expect(refusedCertification.body.error.category)
        .toBe('FORECAST_DEMAND_SOURCE_COVERAGE_UNAVAILABLE');
      const afterRefusal = (await fixture.ownerPool.query(
        `SELECT count(*)::integer count FROM canonical_forecast_retell_period_certifications_v2
         WHERE organization_id=$1 AND local_month_start=$2::date`,
      [tenant, selectedMonth])).rows[0].count;
      expect(afterRefusal).toBe(beforeRefusal);
      const currentAfterRefusal = await request(fixture.app)
        .get(`/api/v1/forecast/demand-sources/retell/period-certifications/${selectedMonth}`)
        .set(fixture.actors.otherOwner.session.headers);
      expect(currentAfterRefusal.status).toBe(200);
      expect(currentAfterRefusal.body.data).toMatchObject({
        id: certification.body.data.id, revision: certification.body.data.revision,
        digest: certification.body.data.digest, state: 'retell_period_certified',
      });
      // The same unconfigured paid workspace can explicitly establish both
      // purpose-fixed epochs and both human method approvals. These four
      // bounded writes remain within the production source-capture allowance;
      // no test-only throttle bypass is used.
      await ui.action('prerequisites-load', 'Prerequisites loaded', 'Setup');
      await ui.action('epoch-seasonal', 'Decision recorded', 'Setup');
      await ui.action('prerequisites-load', 'Prerequisites loaded', 'Setup');
      await ui.action('epoch-pipeline', 'Decision recorded', 'Setup');
      await ui.action('prerequisites-load', 'Prerequisites loaded', 'Setup');
      await ui.action('method-seasonal-approve', 'Decision recorded', 'Setup');
      await ui.action('prerequisites-load', 'Prerequisites loaded', 'Setup');
      await ui.action('method-pipeline-approve', 'Decision recorded', 'Setup');
      await ui.action('prerequisites-load', 'Prerequisites loaded', 'Setup');
      const current = await request(fixture.app).get(`${ROOT}/prerequisites/current`)
        .set(fixture.actors.otherOwner.session.headers);
      expect(current.status).toBe(200);
      expect(current.body.data).toMatchObject({
        profile: { state: 'current' },
        seasonal: { epoch: { state: 'current' }, method: { approved: true } },
        pipeline: { epoch: { state: 'current' }, method: { approved: true } },
      });
    }, 120000);

  test('owner and admin may read while member and PUBLIC remain denied', async () => {
    expect((await request(fixture.app).get(`${ROOT}/prerequisites/current`)
      .set(admin().session.headers)).status).toBe(200);
    expect((await request(fixture.app).get(`${ROOT}/prerequisites/current`)
      .set(fixture.actors.member.session.headers)).status).toBe(403);
    const privilege = await fixture.ownerPool.query(
      `SELECT has_function_privilege('public',
       'public.canonical_forecast_demand_ui_prerequisites_v1_read(uuid,uuid,text,uuid)',
       'EXECUTE') public_execute,
       has_function_privilege($1,
       'public.canonical_forecast_demand_ui_prerequisites_v1_read(uuid,uuid,text,uuid)',
       'EXECUTE') runtime_execute`, [fixture.roles.runtime]);
    expect(privilege.rows[0]).toEqual({ public_execute: false, runtime_execute: true });
  });

  test('rechecks paid authority after its source fences and does not disclose another tenant', async () => {
    const other = await request(fixture.app).get(`${ROOT}/prerequisites/current`)
      .set(fixture.actors.otherOwner.session.headers);
    expect(other.status).toBe(200);
    expect(other.body.data.profile).toEqual({ state: 'current',
      anchorId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(JSON.stringify(other.body)).not.toContain(anchorId);

    const blocker = await fixture.ownerPool.connect();
    const pendingClient = await fixture.runtimePool.connect();
    let settled = false;
    try {
      await blocker.query('BEGIN');
      await blocker.query(`SELECT pg_advisory_xact_lock(hashtextextended(
        'm26:profile-effective-source:'||$1,0))`, [fixture.org]);
      await pendingClient.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      const pending = pendingClient.query(`SELECT
        canonical_forecast_demand_ui_prerequisites_v1_read($1,$2,$3,$4) value`,
      [fixture.org, owner().actorUserId, owner().actorAccessRole, owner().authSessionId])
        .then(result => { settled = true; return result.rows[0].value; }, error => {
          settled = true; throw error;
        });
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(settled).toBe(false);
      await fixture.ownerPool.query(
        `UPDATE subscriptions SET status='past_due' WHERE organization_id=$1`, [fixture.org]);
      await blocker.query('COMMIT');
      await expect(pending).rejects.toMatchObject({ code: '42501' });
      await pendingClient.query('ROLLBACK');
    } catch (error) {
      await blocker.query('ROLLBACK').catch(() => {});
      await pendingClient.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      blocker.release(); pendingClient.release();
      await fixture.ownerPool.query(
        `UPDATE subscriptions SET status='active' WHERE organization_id=$1`, [fixture.org]);
    }
  }, 120000);

  test('runtime startup fails closed when the read entry is missing or is not security definer',
    async () => {
      const checkFailure = async sql => {
        const client = await fixture.ownerPool.connect();
        try {
          await client.query('BEGIN');
          await client.query(sql);
          await expect(fixture.db.grantAndVerifyRuntimeAuthorityForTests(client, {
            migrationRole: fixture.roles.owner, runtimeRole: fixture.roles.runtime,
          })).rejects.toThrow('Required demand UI prerequisite authority is missing');
        } finally {
          await client.query('ROLLBACK').catch(() => {}); client.release();
        }
      };
      await checkFailure(`ALTER FUNCTION
        canonical_forecast_demand_ui_prerequisites_v1_read(uuid,uuid,text,uuid)
        RENAME TO canonical_forecast_demand_ui_prerequisites_v1_read_missing`);
      await checkFailure(`ALTER FUNCTION
        canonical_forecast_demand_ui_prerequisites_v1_read(uuid,uuid,text,uuid)
        SECURITY INVOKER`);
    }, 120000);
});
