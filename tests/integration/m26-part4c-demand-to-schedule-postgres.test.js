'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const { ingestLead } = require('../../src/services/canonicalGraphService');
const { normalizeScheduleMutation } = require('../../src/scheduling/contract');
const { updateAppointmentSchedule } = require('../../src/scheduling/repository');
const research = require('../../public/js/command-center-demand-research');
const { openPaidResearchBrowser } = require('../helpers/m26-part4d-paid-browser');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const key = prefix => `${prefix}-${crypto.randomUUID()}`;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const ZERO = '0'.repeat(64);
const ROOT = '/api/v1/forecast/demand-to-schedule';
const PROFILE = '/api/v1/forecast/reporting-windows/effective-anchors';

realPostgres('Mission 26 Part 4C target-complete demand-to-schedule authority', () => {
  let fixture; let anchorId; let integrationId; let agentId; let profileRaw;
  let seasonalEpoch; let pipelineEpoch; let seasonalOrigin; let seasonalEvaluation;
  let seasonalOriginKey; let pipelineOrigin; let pipelineOriginKey;
  let pipelineSequence = 0;
  let ui; let uiSeasonalOrigin; let uiPipelineOrigin;
  const snapshots = new Map();

  beforeAll(async () => {
    fixture = await createDatabaseFixture({ operationalSchedule: true });
    await clock('2026-10-03T12:00:00Z');
    profileRaw = (await fixture.ownerPool.query(
      `SELECT raw_profile FROM canonical_business_profiles
       WHERE organization_id=$1 AND is_active`, [fixture.org])).rows[0].raw_profile;
    agentId = `part4c-${crypto.randomUUID()}`;
    integrationId = (await fixture.ownerPool.query(
      `INSERT INTO canonical_integration_ownership(
        organization_id,provider,external_integration_id)
       VALUES($1,'retell',$2) RETURNING id`,
    [fixture.org, agentId])).rows[0].id;
    await transaction(async client => client.query(
      `SELECT canonical_forecast_retell_source_consent_mutate(
       $1,$2,$3,$4,$5,$6,$7::jsonb)`, [fixture.org, owner().actorUserId,
        owner().actorAccessRole, owner().authSessionId, owner().csrfToken, key('consent'),
        JSON.stringify({ action: 'grant', expectedRevision: 0, expectedDigest: 'none',
          reason: 'Authorize the narrow Retell research source for Part 4C.', confirmed: true,
          confirmationVersion: 'm26-retell-demand-source-consent-v1' })]), 'SERIALIZABLE');
    const anchored = await request(fixture.app).post(PROFILE).set(owner().session.headers)
      .set('Idempotency-Key', key('profile')).send({
        reason: 'Pin the prospective Part 4C business profile authority.', confirmed: true });
    expect(anchored.status).toBe(201); anchorId = anchored.body.data.anchorId;
    expect((await request(fixture.app).post(`${PROFILE}/${anchorId}/activate`)
      .set(owner().session.headers).send({})).status).toBe(200);
  }, 120000);

  afterAll(async () => {
    if (ui) await ui.close();
    if (fixture) await fixture.cleanup();
  }, 120000);
  const owner = () => fixture.actors.owner;
  const admin = () => fixture.actors.admin;
  async function transaction(operation, isolation = 'READ COMMITTED') {
    const client = await fixture.runtimePool.connect();
    try {
      await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
      const value = await operation(client); await client.query('COMMIT'); return value;
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }
  async function clock(instant) {
    expect(instant).toMatch(/^20[2-9][0-9]-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$/);
    const client = await fixture.ownerPool.connect();
    try {
      await client.query("SET northstar.m26_part4c_disposable_clock='enabled'");
      await client.query(`SELECT canonical_forecast_demand_schedule_test_clock_v1_set($1)`,
        [instant]);
    } finally { client.release(); }
  }
  async function sourceClock(instant) {
    const client = await fixture.ownerPool.connect();
    try {
      await client.query("SET northstar.m26_part4c_disposable_clock='enabled'");
      await client.query(`SELECT canonical_forecast_demand_schedule_source_test_clock_v1_set($1)`,
        [instant]);
    } finally { client.release(); }
  }
  async function mutateMethod(purpose, action, expectedRevision, expectedDigest,
    actor = owner()) {
    return transaction(async client => (await client.query(
      `SELECT canonical_forecast_demand_schedule_method_review_v1_mutate(
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) value`, [fixture.org,
        actor.actorUserId, actor.actorAccessRole, actor.authSessionId, actor.csrfToken,
        key(`method-${purpose}-${action}`), purpose, action, expectedRevision, expectedDigest,
        `${action} the exact deterministic ${purpose} Part 4C research method.`,
        'm26-demand-schedule-method-review-v1']))
      .rows[0].value);
  }
  async function createUnbookedPipeline(label) {
    pipelineSequence += 1;
    const graphKey = key(`pipeline-${label}`);
    const scheduledStart = new Date(Date.UTC(2027, 0, pipelineSequence, 13));
    const result = await ingestLead(fixture.runtimePool, {
      tenantContext: { organizationId: fixture.org, trusted: true },
      idempotencyKey: graphKey, sourceVersion: 'm26-part4c-pipeline-v1',
      external: { customerId: graphKey, callId: graphKey, transcriptId: graphKey,
        communicationId: graphKey, appointmentId: graphKey },
      customer: { name: `Part 4C pipeline ${label}`,
        phone: `+1555666${String(pipelineSequence).padStart(4, '0')}`,
        email: `${graphKey}@example.test`, address: { line1: '1 Test Way', city: 'Boston',
          state: 'MA', postalCode: '02108' } },
      transcript: [{ turnId: 'scope', speaker: 'customer',
        text: 'I need a future service appointment.' }],
      facts: [{ variable: 'serviceRequested', normalizedValue: true,
        evidenceText: 'need a future service appointment', speaker: 'customer',
        evidenceTurnId: 'scope', confidence: 1 }],
      service: { key: 'general', scope: { jobType: 'service' } },
      scheduledAppointment: { start: scheduledStart.toISOString(),
        end: new Date(scheduledStart.getTime() + 3600000).toISOString(),
        status: 'scheduled' },
      businessProfile: profileRaw, businessProfileVersion: profileRaw.version,
    });
    expect(result.status).toBe(201);
    return { appointment: result.body.ids.appointment, opportunity: result.body.ids.opportunity };
  }
  async function createBulkEligiblePipeline(count, label) {
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(600);
    const client = await fixture.ownerPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`CREATE TEMP TABLE part4c_bulk_eligible(
        operation_id UUID PRIMARY KEY,graph_id UUID NOT NULL,customer_id UUID NOT NULL,
        transcript_id UUID NOT NULL,opportunity_id UUID NOT NULL,key_value TEXT NOT NULL)
        ON COMMIT DROP`);
      await client.query(`INSERT INTO part4c_bulk_eligible
        SELECT gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
          gen_random_uuid(),$1||'-'||value::text
        FROM generate_series(1,$2::integer) value`, [label, count]);
      await client.query(`INSERT INTO canonical_operations(
        id,organization_id,graph_id,idempotency_key_hash,payload_fingerprint,state,
        lease_owner,lease_expires_at)
        SELECT operation_id,$1,graph_id,encode(sha256(convert_to(key_value,'UTF8')),'hex'),
          encode(sha256(convert_to(key_value,'UTF8')),'hex'),'claimed',operation_id,
          clock_timestamp()+INTERVAL '1 hour' FROM part4c_bulk_eligible`, [fixture.org]);
      await client.query(`INSERT INTO canonical_customers(
        id,organization_id,operation_id,graph_id,name)
        SELECT customer_id,$1,operation_id,graph_id,'Part 4C aggregate-bound customer'
        FROM part4c_bulk_eligible`, [fixture.org]);
      await client.query(`INSERT INTO canonical_transcripts(
        id,organization_id,operation_id,graph_id,customer_id,source,source_version,
        external_call_id,external_transcript_id,transcript_text,normalized_fingerprint,occurred_at)
        SELECT transcript_id,$1,operation_id,graph_id,customer_id,'lead','part4c-v1',
          key_value,key_value||'-transcript','Part 4C aggregate-bound lead',
          encode(sha256(convert_to(key_value||'-transcript','UTF8')),'hex'),clock_timestamp()
        FROM part4c_bulk_eligible`, [fixture.org]);
      await client.query(`INSERT INTO canonical_opportunities(
        id,organization_id,operation_id,graph_id,customer_id,status,service_type,job_scope)
        SELECT opportunity_id,$1,operation_id,graph_id,customer_id,'lead','general','{}'::jsonb
        FROM part4c_bulk_eligible`, [fixture.org]);
      await client.query(`UPDATE canonical_operations operation SET state='completed',
        result_status=200,result_body='{}'::jsonb,completed_at=clock_timestamp()
        FROM part4c_bulk_eligible source_value WHERE operation.id=source_value.operation_id`);
      const opportunities = (await client.query(`SELECT opportunity_id
        FROM part4c_bulk_eligible ORDER BY opportunity_id`)).rows
        .map(row => row.opportunity_id);
      await client.query('COMMIT');
      return opportunities;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {}); throw error;
    } finally { client.release(); }
  }
  async function mutateAssignment(context, action = 'assign', appointmentStatus = 'scheduled',
    target = null, scheduleShiftHours = 0) {
    const before = (await fixture.ownerPool.query(`SELECT revision,
      rtrim(canonical_digest) digest,appointment_status,scheduled_start,scheduled_end,
      target_state,workforce_profile_id,workforce_crew_id
      FROM canonical_schedule_assignments WHERE organization_id=$1 AND appointment_id=$2`,
    [fixture.org, context.appointment])).rows[0];
    const proposedTarget = target || (before.workforce_profile_id
      ? { kind: 'profile', id: before.workforce_profile_id }
      : before.workforce_crew_id
        ? { kind: 'crew', id: before.workforce_crew_id }
        : { kind: 'profile', id: fixture.actors.member.actorUserId });
    const scheduledStart = new Date(before.scheduled_start.getTime() +
      scheduleShiftHours * 3600000);
    const scheduledEnd = new Date(before.scheduled_end.getTime() +
      scheduleShiftHours * 3600000);
    const reason = 'Approve a genuine Part 4C first-booking source event.';
    const preview = await request(fixture.app)
      .post(`/api/v1/canonical/appointments/${context.appointment}/mutation-previews`)
      .set(owner().session.headers).send({ expectedRevision: Number(before.revision),
        expectedDigest: before.digest, expectedTimeZone: profileRaw.company.timeZone,
        action, target: proposedTarget,
        scheduledStart: scheduledStart.toISOString(),
        scheduledEnd: scheduledEnd.toISOString(),
        appointmentStatus, reason });
    if (preview.status !== 201) throw new Error(`preview failed ${preview.status} ${JSON.stringify(preview.body)}`);
    const approval = await request(fixture.app)
      .post(`/api/v1/canonical/appointments/${context.appointment}/mutation-approvals`)
      .set(owner().session.headers).set('Idempotency-Key', key('pipeline-approval'))
      .send({ previewId: preview.body.data.id, previewDigest: preview.body.data.previewDigest,
        acknowledgedWarningDigests: preview.body.data.warningDigests,
        acknowledgedReviewReasonDigests: preview.body.data.reviewReasonDigests, reason });
    expect(approval.status).toBe(200);
    return approval;
  }
  async function approveAssignment(context) { return mutateAssignment(context); }
  async function recordOperationalStatus(context, status, reason) {
    const current = (await fixture.ownerPool.query(`SELECT revision,
      rtrim(canonical_digest) digest FROM canonical_schedule_assignments
      WHERE organization_id=$1 AND appointment_id=$2`,
    [fixture.org, context.appointment])).rows[0];
    return updateAppointmentSchedule(fixture.ownerPool, normalizeScheduleMutation({
      organizationId: fixture.org,
      actorUserId: owner().actorUserId,
      actorAccessRole: owner().actorAccessRole,
      authSessionId: owner().authSessionId,
      appointmentId: context.appointment,
      explicitSession: null,
      idempotencyKey: key(`pipeline-${status}`),
      body: { status, expectedRevision: Number(current.revision),
        expectedDigest: current.digest, expectedTimeZone: profileRaw.company.timeZone,
        action: 'calendar_edit', reason },
    }));
  }
  async function seedRetellCall(eventAt, suffix) {
    const operation = crypto.randomUUID(), graph = crypto.randomUUID();
    const customer = crypto.randomUUID(), transcript = crypto.randomUUID();
    const external = `part4c-call-${suffix}-${crypto.randomUUID()}`;
    await fixture.ownerPool.query(`INSERT INTO canonical_operations(
      id,organization_id,graph_id,idempotency_key_hash,payload_fingerprint,state,
      lease_owner,lease_expires_at)
      VALUES($1,$2,$3,$4,$4,'claimed',$1,NOW()+INTERVAL '1 hour')`,
    [operation, fixture.org, graph, hash(external)]);
    await fixture.ownerPool.query(`INSERT INTO canonical_customers(
      id,organization_id,operation_id,graph_id,name)
      VALUES($1,$2,$3,$4,'Part 4C caller')`, [customer, fixture.org, operation, graph]);
    await fixture.ownerPool.query(`INSERT INTO canonical_transcripts(
      id,organization_id,operation_id,graph_id,customer_id,source,source_version,
      external_call_id,external_transcript_id,transcript_text,normalized_fingerprint,occurred_at)
      VALUES($1,$2,$3,$4,$5,'retell','part4c-v1',$6,$7,'Part 4C inbound call',$8,$9)`,
    [transcript, fixture.org, operation, graph, customer, external,
      `${external}:transcript`, hash(`${external}:transcript`), eventAt]);
    await fixture.ownerPool.query(`INSERT INTO canonical_communications(
      id,organization_id,operation_id,graph_id,customer_id,transcript_id,
      channel,direction,body,occurred_at)
      VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,'voice_call','inbound','Part 4C inbound call',$6)`,
    [fixture.org, operation, graph, customer, transcript, eventAt]);
    await fixture.ownerPool.query(`INSERT INTO canonical_opportunities(
      id,organization_id,operation_id,graph_id,customer_id,status,service_type,job_scope)
      VALUES(gen_random_uuid(),$1,$2,$3,$4,'lead','general','{}')`,
    [fixture.org, operation, graph, customer]);
    await fixture.ownerPool.query(`INSERT INTO canonical_voice_sessions(
      organization_id,external_session_id,provider,provider_session_id,
      integration_ownership_id,business_profile_id,business_profile_version,
      business_profile_hash,status,direction,metadata,canonical_operation_id,completed_at)
      VALUES($1,$2,'retell',$2,$3,$4,'org-profile-v1',$5,'completed','inbound',
      '{"retellPayloadDirection":"inbound"}'::jsonb,$6,NOW())`,
    [fixture.org, external, integrationId, fixture.profiles[fixture.org].businessProfileId,
      fixture.profiles[fixture.org].hash, operation]);
    await fixture.ownerPool.query(`UPDATE canonical_operations SET state='completed',
      result_status=200,result_body='{}'::jsonb,completed_at=clock_timestamp()
      WHERE organization_id=$1 AND id=$2`, [fixture.org, operation]);
    return { transcript, external };
  }
  async function seedRetellCallsBatch(eventAt, count, suffix) {
    if (count === 0) return [];
    expect(count).toBeGreaterThan(0); expect(count).toBeLessThanOrEqual(1000);
    const client = await fixture.ownerPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`CREATE TEMP TABLE part4c_batch_calls(
        operation_id UUID PRIMARY KEY,graph_id UUID NOT NULL,customer_id UUID NOT NULL,
        transcript_id UUID NOT NULL,external_id TEXT NOT NULL) ON COMMIT DROP`);
      await client.query(`INSERT INTO part4c_batch_calls
        SELECT gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
          $1||'-'||value::text||'-'||gen_random_uuid()::text
        FROM generate_series(1,$2::integer) value`, [suffix, count]);
      await client.query(`INSERT INTO canonical_operations(
        id,organization_id,graph_id,idempotency_key_hash,payload_fingerprint,state,
        lease_owner,lease_expires_at)
        SELECT operation_id,$1,graph_id,encode(sha256(convert_to(external_id,'UTF8')),'hex'),
          encode(sha256(convert_to(external_id,'UTF8')),'hex'),'claimed',operation_id,
          clock_timestamp()+INTERVAL '1 hour'
        FROM part4c_batch_calls`, [fixture.org]);
      await client.query(`INSERT INTO canonical_customers(
        id,organization_id,operation_id,graph_id,name)
        SELECT customer_id,$1,operation_id,graph_id,'Part 4C seasonal batch caller'
        FROM part4c_batch_calls`, [fixture.org]);
      await client.query(`INSERT INTO canonical_transcripts(
        id,organization_id,operation_id,graph_id,customer_id,source,source_version,
        external_call_id,external_transcript_id,transcript_text,normalized_fingerprint,occurred_at)
        SELECT transcript_id,$1,operation_id,graph_id,customer_id,'retell','part4c-v1',
          external_id,external_id||'-transcript','Part 4C inbound call',
          encode(sha256(convert_to(external_id||'-transcript','UTF8')),'hex'),$2::timestamptz
        FROM part4c_batch_calls`, [fixture.org, eventAt]);
      await client.query(`INSERT INTO canonical_communications(
        id,organization_id,operation_id,graph_id,customer_id,transcript_id,
        channel,direction,body,occurred_at)
        SELECT gen_random_uuid(),$1,operation_id,graph_id,customer_id,transcript_id,
          'voice_call','inbound','Part 4C inbound call',$2::timestamptz
        FROM part4c_batch_calls`, [fixture.org, eventAt]);
      await client.query(`INSERT INTO canonical_opportunities(
        id,organization_id,operation_id,graph_id,customer_id,status,service_type,job_scope)
        SELECT gen_random_uuid(),$1,operation_id,graph_id,customer_id,'lead','general','{}'::jsonb
        FROM part4c_batch_calls`, [fixture.org]);
      await client.query(`INSERT INTO canonical_voice_sessions(
        organization_id,external_session_id,provider,provider_session_id,
        integration_ownership_id,business_profile_id,business_profile_version,
        business_profile_hash,status,direction,metadata,canonical_operation_id,completed_at)
        SELECT $1,external_id,'retell',external_id,$2,$3,'org-profile-v1',$4,
          'completed','inbound','{"retellPayloadDirection":"inbound"}'::jsonb,
          operation_id,clock_timestamp() FROM part4c_batch_calls`, [fixture.org,
        integrationId, fixture.profiles[fixture.org].businessProfileId,
        fixture.profiles[fixture.org].hash]);
      await client.query(`UPDATE canonical_operations operation SET state='completed',
        result_status=200,result_body='{}'::jsonb,completed_at=clock_timestamp()
        FROM part4c_batch_calls source_value WHERE operation.id=source_value.operation_id`);
      const rows = (await client.query(`SELECT transcript_id FROM part4c_batch_calls
        ORDER BY transcript_id`)).rows.map(row => row.transcript_id);
      await client.query('COMMIT'); return rows;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {}); throw error;
    } finally { client.release(); }
  }
  async function attest(month) {
    const result = await transaction(async client => (await client.query(
      `SELECT canonical_forecast_profile_month_attestation_capture(
       $1,$2,$3,$4,$5,$6,$7::date,'confirm',$8,$9,0,NULL,$10,TRUE,$11) value`,
      [fixture.org, owner().actorUserId, owner().actorAccessRole, owner().authSessionId,
        owner().csrfToken, key('month-attest'), month,
        fixture.profiles[fixture.org].businessProfileId, fixture.profiles[fixture.org].hash,
        'Confirm the exact historical month for Part 4C research.',
        'forecast-calendar-review-v1'])).rows[0].value);
    expect(result).toMatchObject({ action: 'confirm', revision: 1, replayed: false,
      profilePinVerified: true });
  }
  async function snapshot(month) {
    const value = await transaction(async client => (await client.query(
      `SELECT canonical_forecast_retell_period_snapshot_v2_capture(
       $1,$2,$3,$4,$5,$6,$7::date) value`, [fixture.org, owner().actorUserId,
        owner().actorAccessRole, owner().authSessionId, owner().csrfToken,
        key('snapshot'), month])).rows[0].value.snapshot);
    snapshots.set(month, value); return value;
  }
  async function reviewCall(snapshotValue, transcript) {
    const pin = snapshotValue.sources.find(item => item.sourceId === transcript);
    expect(pin).toBeDefined();
    const current = (await fixture.ownerPool.query(`SELECT revision,
      rtrim(canonical_digest) digest FROM canonical_forecast_retell_call_reviews
      WHERE organization_id=$1 AND transcript_id=$2 ORDER BY revision DESC LIMIT 1`,
    [fixture.org, transcript])).rows[0];
    await transaction(client => client.query(
      `SELECT canonical_forecast_retell_call_review_mutate(
       $1,$2,$3,$4,$5,$6,$7,$8::jsonb)`, [fixture.org, owner().actorUserId,
        owner().actorAccessRole, owner().authSessionId, owner().csrfToken,
        key('call-review'), snapshotValue.id, JSON.stringify({ transcriptId: transcript,
          expectedSourceDigest: pin.digest, expectedRevision: Number(current?.revision || 0),
          expectedDigest: current?.digest || 'none',
          disposition: 'new_lead', anchorTranscriptId: null,
          reason: 'Confirm a distinct inbound lead for Part 4C research.', confirmed: true,
          confirmationVersion: 'm26-retell-call-review-v1' })]), 'SERIALIZABLE');
  }
  async function reviewCalls(snapshotValue, transcripts) {
    if (transcripts.length === 0) return;
    const latestRows = (await fixture.ownerPool.query(`SELECT DISTINCT ON (transcript_id)
      transcript_id,revision,rtrim(canonical_digest) digest
      FROM canonical_forecast_retell_call_reviews WHERE organization_id=$1
      AND transcript_id=ANY($2::uuid[]) ORDER BY transcript_id,revision DESC`,
    [fixture.org, transcripts])).rows;
    const latest = new Map(latestRows.map(row => [row.transcript_id, row]));
    await transaction(async client => {
      for (const transcript of transcripts) {
        const pin = snapshotValue.sources.find(item => item.sourceId === transcript);
        expect(pin).toBeDefined();
        const current = latest.get(transcript);
        await client.query(`SELECT canonical_forecast_retell_call_review_mutate(
         $1,$2,$3,$4,$5,$6,$7,$8::jsonb)`, [fixture.org, owner().actorUserId,
          owner().actorAccessRole, owner().authSessionId, owner().csrfToken,
          key('call-review-batch'), snapshotValue.id, JSON.stringify({
            transcriptId: transcript, expectedSourceDigest: pin.digest,
            expectedRevision: Number(current?.revision || 0),
            expectedDigest: current?.digest || 'none', disposition: 'new_lead',
            anchorTranscriptId: null,
            reason: 'Confirm a distinct inbound lead for Part 4C research.', confirmed: true,
            confirmationVersion: 'm26-retell-call-review-v1' })]);
      }
    }, 'SERIALIZABLE');
  }
  async function evidence(month) {
    return transaction(async client => (await client.query(
      `SELECT canonical_forecast_retell_period_evidence_v2(
       $1,$2,$3,$4,$5,$6::date) value`, [fixture.org, owner().actorUserId,
        owner().actorAccessRole, owner().authSessionId, snapshots.get(month).id, month]))
      .rows[0].value);
  }
  async function certificationRequest(month, periodEvidence, expectedRevision = 0,
    expectedDigest = 'none', action = 'certify', requestKey = key('certify')) {
    const snapshotValue = snapshots.get(month);
    let providerScanEvidence = {};
    let sourceCount = 0;
    let providerScanComplete = false;
    let snapshotComplete = false;
    let reviewComplete = false;
    if (action === 'certify') {
      const scanInputs = await transaction(async client => (await client.query(
        `SELECT canonical_forecast_retell_scan_inputs_read(
         $1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz) value`,
        [fixture.org, owner().actorUserId, owner().actorAccessRole, owner().authSessionId,
          snapshotValue.id, periodEvidence.startsAt, periodEvidence.endsAt])).rows[0].value);
      expect(scanInputs).toMatchObject({ state: 'ready_for_diagnostic', agentId });
      const scannedAt = (await fixture.ownerPool.query(
        `SELECT canonical_forecast_demand_schedule_clock_v1() instant`)).rows[0]
        .instant.toISOString();
      providerScanEvidence = { version: 'm26-retell-provider-scan-v2',
        organizationId: fixture.org, snapshotId: snapshotValue.id, localMonthStart: month,
        startsAt: periodEvidence.startsAt, endsAt: periodEvidence.endsAt,
        integrationOwnershipId: integrationId, agentId,
        canonicalCallDigests: scanInputs.canonicalCallDigests,
        callCount: periodEvidence.sourceCount, sourceSnapshotDigest: periodEvidence.snapshotDigest,
        scannedAt };
      sourceCount = periodEvidence.sourceCount;
      providerScanComplete = true;
      snapshotComplete = true;
      reviewComplete = true;
    }
    return { month, snapshotValue, expectedRevision, expectedDigest, action, requestKey,
      providerScanEvidence, sourceCount, providerScanComplete, snapshotComplete, reviewComplete };
  }
  async function invokeCertification(client, certification) {
    const { month, snapshotValue, expectedRevision, expectedDigest, action, requestKey,
      providerScanEvidence, sourceCount, providerScanComplete, snapshotComplete,
      reviewComplete } = certification;
    return (await client.query(
      `SELECT canonical_forecast_retell_period_certification_v2_mutate(
       $1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10,$11,$12,$13,$14,$15::jsonb,
       $16,$17,$18,$19,$20) value`, [fixture.org, owner().actorUserId,
        owner().actorAccessRole, owner().authSessionId, owner().csrfToken,
        requestKey, action, snapshotValue.id, month, expectedRevision, expectedDigest,
        ZERO, sourceCount, ZERO, JSON.stringify(providerScanEvidence), providerScanComplete,
        snapshotComplete, reviewComplete, 'Certify the complete bounded Part 4C Retell month.',
        'm26-retell-period-certification-v2'])).rows[0].value;
  }
  async function certify(month, periodEvidence, expectedRevision = 0, expectedDigest = 'none',
    action = 'certify', requestKey = key('certify')) {
    const certification = await certificationRequest(month, periodEvidence, expectedRevision,
      expectedDigest, action, requestKey);
    return transaction(client => invokeCertification(client, certification));
  }
  async function waitForTableLock(client) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const waiting = (await fixture.ownerPool.query(`SELECT locktype,mode,granted
        FROM pg_locks WHERE pid=$1 AND granted=false ORDER BY locktype,mode LIMIT 1`,
      [client.processID])).rows[0];
      if (waiting) return waiting;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error(`backend ${client.processID} did not reach a table-lock wait`);
  }
  async function certifyChronologicalMonth(month, callCount = 0, label = 'zero') {
    const monthStart = new Date(`${month}T00:00:00Z`);
    const nextMonth = new Date(Date.UTC(monthStart.getUTCFullYear(),
      monthStart.getUTCMonth() + 1, 1));
    let transcripts = [];
    if (callCount > 0) {
      const callAt = new Date(Date.UTC(monthStart.getUTCFullYear(),
        monthStart.getUTCMonth(), 15, 12)).toISOString();
      await clock(callAt);
      transcripts = await seedRetellCallsBatch(callAt, callCount, `${label}-${month}`);
    }
    await clock(new Date(nextMonth.getTime() + 8 * 86400000 + 12 * 3600000).toISOString());
    await attest(month); const snap = await snapshot(month);
    await reviewCalls(snap, transcripts);
    const period = await evidence(month);
    expect(period).toMatchObject({ state: 'retell_period_ready_for_certification',
      sourceCount: callCount });
    expect(await certify(month, period)).toMatchObject({
      state: 'retell_period_certified', revision: 1 });
  }

  test('requires explicit owner or admin method governance and append-only conflicts', async () => {
    const invalidReview = expectedDigest => transaction(client => client.query(
      `SELECT canonical_forecast_demand_schedule_method_review_v1_mutate(
       $1,$2,$3,$4,$5,$6,'seasonal_inbound','approve',0,$7,$8,
       'm26-demand-schedule-method-review-v1')`, [fixture.org, owner().actorUserId,
        owner().actorAccessRole, owner().authSessionId, owner().csrfToken,
        key('method-invalid-digest'), expectedDigest,
        'Reject malformed expected governance digests at the SQL boundary.']));
    await expect(invalidReview(null)).rejects.toMatchObject({ code: '22023' });
    await expect(invalidReview('not-a-digest')).rejects.toMatchObject({ code: '22023' });
    const seasonalApproved = await mutateMethod('seasonal_inbound', 'approve', 0, 'none');
    expect(seasonalApproved).toMatchObject({ state: 'demand_schedule_method_review_recorded',
      purpose: 'seasonal_inbound', action: 'approve', revision: 1 });
    const current = (await fixture.ownerPool.query(`SELECT revision,rtrim(review_digest) digest
      FROM canonical_forecast_demand_schedule_method_reviews_v1
      WHERE organization_id=$1 AND purpose='seasonal_inbound' ORDER BY revision DESC LIMIT 1`,
    [fixture.org])).rows[0];
    await expect(mutateMethod('seasonal_inbound', 'approve', 0, 'none', admin()))
      .rejects.toMatchObject({ code: '40001' });
    await expect(mutateMethod('seasonal_inbound', 'reject', Number(current.revision), current.digest,
      fixture.actors.member)).rejects.toMatchObject({ code: '22023' });
    const pipelineApproved = await mutateMethod('pipeline_first_booking', 'approve', 0, 'none',
      admin());
    expect(pipelineApproved).toMatchObject({ state: 'demand_schedule_method_review_recorded',
      purpose: 'pipeline_first_booking', action: 'approve', revision: 1 });
    const pipelineCurrent = (await fixture.ownerPool.query(`SELECT revision,
      rtrim(review_digest) digest FROM canonical_forecast_demand_schedule_method_reviews_v1
      WHERE organization_id=$1 AND purpose='pipeline_first_booking'
      ORDER BY revision DESC LIMIT 1`, [fixture.org])).rows[0];
    const mutate = (actor, action, revision, digest) => transaction(async client =>
      (await client.query(`SELECT canonical_forecast_demand_schedule_method_review_v1_mutate(
       $1,$2,$3,$4,$5,$6,'pipeline_first_booking',$7,$8,$9,$10,$11) value`,
      [fixture.org, actor.actorUserId, actor.actorAccessRole, actor.authSessionId,
        actor.csrfToken, key(`pipeline-${action}`), action, revision, digest,
        `${action} the exact deterministic pipeline method after explicit human review.`,
        'm26-demand-schedule-method-review-v1'])).rows[0].value);
    const rejected = await mutate(owner(), 'reject', Number(pipelineCurrent.revision),
      pipelineCurrent.digest);
    expect(rejected).toMatchObject({ state: 'demand_schedule_method_review_recorded',
      purpose: 'pipeline_first_booking', revision: 2, action: 'reject' });
    await expect(mutate(admin(), 'approve', 1, pipelineCurrent.digest))
      .rejects.toMatchObject({ code: '40001' });
    const reapproved = await mutate(admin(), 'approve', 2, rejected.digest);
    expect(reapproved).toMatchObject({ state: 'demand_schedule_method_review_recorded',
      purpose: 'pipeline_first_booking', revision: 3, action: 'approve' });
  }, 120000);

  test('rechecks paid access after a method-review replay waits on its governance fence',
    async () => {
      const current = (await fixture.ownerPool.query(`SELECT revision,rtrim(review_digest) digest
        FROM canonical_forecast_demand_schedule_method_reviews_v1
        WHERE organization_id=$1 AND purpose='pipeline_first_booking'
        ORDER BY revision DESC LIMIT 1`, [fixture.org])).rows[0];
      const replayKey = key('method-replay-race');
      const reason = 'Approve the exact pipeline method for a post-lock access replay test.';
      const invoke = client => client.query(
        `SELECT canonical_forecast_demand_schedule_method_review_v1_mutate(
         $1,$2,$3,$4,$5,$6,'pipeline_first_booking','approve',$7,$8,$9,
         'm26-demand-schedule-method-review-v1') value`,
        [fixture.org, owner().actorUserId, owner().actorAccessRole, owner().authSessionId,
          owner().csrfToken, replayKey, Number(current.revision), current.digest, reason]);
      const recorded = await transaction(async client => (await invoke(client)).rows[0].value);
      expect(recorded).toMatchObject({ state: 'demand_schedule_method_review_recorded',
        action: 'approve', replayed: false });
      expect(await transaction(async client => (await invoke(client)).rows[0].value))
        .toMatchObject({ id: recorded.id, replayed: true });

      const blocker = await fixture.ownerPool.connect();
      let settled = false;
      try {
        await blocker.query('BEGIN');
        await blocker.query(`SELECT pg_advisory_xact_lock(hashtextextended(
          'm26:demand-schedule-method:'||$1||':pipeline_first_booking',0))`, [fixture.org]);
        const pending = transaction(async client => (await invoke(client)).rows[0].value)
          .then(value => { settled = true; return value; }, error => {
            settled = true; throw error;
          });
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(settled).toBe(false);
        await fixture.ownerPool.query(
          `UPDATE subscriptions SET status='past_due' WHERE organization_id=$1`, [fixture.org]);
        await blocker.query('COMMIT');
        await expect(pending).rejects.toMatchObject({ code: '42501' });
      } catch (error) {
        await blocker.query('ROLLBACK').catch(() => {}); throw error;
      } finally {
        blocker.release();
        await fixture.ownerPool.query(
          `UPDATE subscriptions SET status='active' WHERE organization_id=$1`, [fixture.org]);
      }
    }, 120000);

  test('saves and evaluates a genuine prospective 24-month signal without rewriting origin', async () => {
    seasonalEpoch = await transaction(async client => (await client.query(
      `SELECT canonical_forecast_demand_schedule_epoch_v1_capture(
       $1,$2,$3,$4,$5,$6,'seasonal_inbound',$7) value`, [fixture.org,
        owner().actorUserId, owner().actorAccessRole, owner().authSessionId,
        owner().csrfToken, key('epoch-seasonal'), anchorId])).rows[0].value);
    expect(seasonalEpoch).toMatchObject({ state: 'demand_schedule_epoch_recorded',
      purpose: 'seasonal_inbound', replayed: false });

    const trainingMonths = (await fixture.ownerPool.query(`SELECT array_agg(
      (DATE '2028-12-01'-(value||' months')::interval)::date::text ORDER BY value DESC) months
      FROM generate_series(2,25) value`)).rows[0].months;
    const positive = new Map();
    for (const month of trainingMonths) {
      const monthStart = new Date(`${month}T00:00:00Z`);
      const nextMonth = new Date(Date.UTC(monthStart.getUTCFullYear(),
        monthStart.getUTCMonth() + 1, 1));
      let call = null;
      if (month === '2026-12-01' || month === '2027-12-01') {
        const callAt = new Date(Date.UTC(monthStart.getUTCFullYear(),
          monthStart.getUTCMonth(), 15, 12)).toISOString();
        await clock(callAt); call = await seedRetellCall(callAt, `cycle-${month}`);
      }
      await clock(new Date(nextMonth.getTime() + 8 * 86400000 + 12 * 3600000).toISOString());
      await attest(month); const snap = await snapshot(month);
      if (call) await reviewCall(snap, call.transcript);
      const period = await evidence(month);
      expect(period).toMatchObject({ state: 'retell_period_ready_for_certification' });
      const certified = await certify(month, period);
      expect(certified).toMatchObject({ state: 'retell_period_certified', revision: 1 });
    }
    ui = await openPaidResearchBrowser(fixture);
    await ui.action('prerequisites-load', 'Prerequisites loaded', 'Setup');
    await ui.page.locator('#commandCenterResearchHorizon').fill('2028-12-01');
    await ui.action('seasonal-save', 'Research origin saved', 'Seasonal');
    uiSeasonalOrigin = await ui.page.locator('#commandCenterResearchSeasonalId').inputValue();
    expect(uiSeasonalOrigin).toMatch(/^[0-9a-f-]{36}$/);
    await ui.action('seasonal-load', 'Evidence is current', 'Seasonal');

    const uiOriginResponse = [...ui.responses].reverse().find(item => item.method === 'POST' &&
      item.url.endsWith(`${ROOT}/seasonal-origins`));
    expect(uiOriginResponse).toBeDefined();
    const seasonalKey = uiOriginResponse.headers['idempotency-key'];
    seasonalOriginKey = seasonalKey;
    const saved = uiOriginResponse.body.data;
    expect(uiOriginResponse.status).toBe(201);
    expect(saved).toMatchObject({ state: 'seasonal_origin_saved',
      localHorizonStart: '2028-12-01', seasonalSignalState: 'repeated_high',
      amountWithheld: true, outputDigestWithheld: true, forecastIssued: false,
      paidNumericServing: false, forecastServingEnabled: false });
    expect(await transaction(async client => (await client.query(
      `SELECT canonical_forecast_seasonal_origin_v1_capture(
       $1,$2,$3,$4,$5,$6,$7::date) value`, [fixture.org, owner().actorUserId,
        owner().actorAccessRole, owner().authSessionId, owner().csrfToken,
        seasonalKey, '2028-12-01'])).rows[0].value)).toMatchObject({
      state: 'seasonal_origin_saved', id: saved.id, replayed: true });
    seasonalOrigin = saved.id;
    expect(uiSeasonalOrigin).toBe(seasonalOrigin);
    const mountedOrigin = await request(fixture.app)
      .get(`${ROOT}/seasonal-origins/${seasonalOrigin}`).set(owner().session.headers);
    expect(mountedOrigin.status).toBe(200);
    expect(research.validateDemandOrigin(mountedOrigin.body.data,
      'seasonal', seasonalOrigin)).not.toBeNull();
    const immutableBefore = (await fixture.ownerPool.query(`SELECT evidence_digest,
      output_digest,as_of FROM canonical_forecast_seasonal_origins_v1 WHERE id=$1`,
    [seasonalOrigin])).rows[0];

    await clock('2028-12-15T12:00:00Z');
    const outcomeCall = await seedRetellCall('2028-12-15T12:00:00Z', 'outcome');
    await clock('2029-01-09T12:00:00Z');
    await attest('2028-12-01'); const outcomeSnapshot = await snapshot('2028-12-01');
    await reviewCall(outcomeSnapshot, outcomeCall.transcript);
    const outcomeEvidence = await evidence('2028-12-01');
    expect((await certify('2028-12-01', outcomeEvidence))).toMatchObject({
      state: 'retell_period_certified', revision: 1 });
    await ui.page.locator('#commandCenterResearchSeasonalId').fill(seasonalOrigin);
    await ui.action('seasonal-evaluate', 'Evaluation saved', 'Seasonal');
    const uiSeasonalEvaluation = await ui.page
      .locator('#commandCenterResearchSeasonalEvaluationId').inputValue();
    expect(uiSeasonalEvaluation).toMatch(/^[0-9a-f-]{36}$/);
    await ui.action('seasonal-evaluation-load', 'Evidence is current', 'Seasonal');
    const uiEvaluationResponse = [...ui.responses].reverse().find(item => item.method === 'POST' &&
      item.url.endsWith(`${ROOT}/seasonal-origins/${seasonalOrigin}/evaluations`));
    expect(uiEvaluationResponse).toBeDefined();
    const evaluated = uiEvaluationResponse.body.data;
    expect(uiEvaluationResponse.status).toBe(201);
    expect(evaluated).toMatchObject({ state: 'seasonal_evaluation_saved',
      originId: seasonalOrigin, revision: 1, metricsWithheld: true, forecastIssued: false });
    seasonalEvaluation = evaluated.id;
    expect(uiSeasonalEvaluation).toBe(seasonalEvaluation);
    const mountedEvaluation = await request(fixture.app)
      .get(`${ROOT}/seasonal-evaluations/${seasonalEvaluation}`).set(owner().session.headers);
    expect(mountedEvaluation.status).toBe(200);
    expect(research.validateDemandEvaluation(mountedEvaluation.body.data,
      'seasonal', seasonalOrigin, seasonalEvaluation)).not.toBeNull();
    expect((await fixture.ownerPool.query(`SELECT evidence_digest,output_digest,as_of
      FROM canonical_forecast_seasonal_origins_v1 WHERE id=$1`, [seasonalOrigin])).rows[0])
      .toEqual(immutableBefore);
  }, 240000);

  test('later certified outcome revision stales evaluation and requires append-only reevaluation', async () => {
    const prior = (await fixture.ownerPool.query(`SELECT revision,rtrim(canonical_digest) digest,
      evidence FROM canonical_forecast_retell_period_certifications_v2
      WHERE organization_id=$1 AND local_month_start='2028-12-01' ORDER BY revision DESC LIMIT 1`,
    [fixture.org])).rows[0];
    const writer = await fixture.runtimePool.connect();
    let readSettled = false; let revoked;
    try {
      await writer.query('BEGIN');
      revoked = (await writer.query(
        `SELECT canonical_forecast_retell_period_certification_v2_mutate(
         $1,$2,$3,$4,$5,$6,'revoke',$7,$8::date,$9,$10,$11,0,$11,'{}'::jsonb,
         false,false,false,$12,'m26-retell-period-certification-v2') value`,
        [fixture.org, owner().actorUserId, owner().actorAccessRole, owner().authSessionId,
          owner().csrfToken, key('certify-race-revoke'), snapshots.get('2028-12-01').id,
          '2028-12-01', Number(prior.revision), prior.digest, ZERO,
          'Revoke the horizon month while a current evaluation read waits.'])).rows[0].value;
      expect(revoked).toMatchObject({ state: 'retell_period_revoked', revision: 2 });
      const pendingRead = fixture.runtimePool.query(
        `SELECT canonical_forecast_seasonal_evaluation_v1_read($1,$2,$3,$4,$5) value`,
        [fixture.org, owner().actorUserId, owner().actorAccessRole, owner().authSessionId,
          seasonalEvaluation]).then(result => { readSettled = true; return result.rows[0].value; });
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(readSettled).toBe(false);
      await writer.query('COMMIT');
      var stale = await pendingRead;
    } catch (error) {
      await writer.query('ROLLBACK').catch(() => {}); throw error;
    } finally { writer.release(); }
    expect(stale).toMatchObject({ state: 'seasonal_evaluation_stale',
      refreshRequired: true, metricsWithheld: true });
    const before = Number((await fixture.ownerPool.query(`SELECT count(*) count
      FROM canonical_forecast_seasonal_evaluations_v1 WHERE origin_id=$1`,
    [seasonalOrigin])).rows[0].count);
    const refused = await transaction(async client => (await client.query(
      `SELECT canonical_forecast_seasonal_evaluation_v1_capture(
       $1,$2,$3,$4,$5,$6,$7) value`, [fixture.org, owner().actorUserId,
        owner().actorAccessRole, owner().authSessionId, owner().csrfToken,
        key('seasonal-eval-after-revoke'), seasonalOrigin])).rows[0].value);
    expect(refused).toMatchObject({ state: 'seasonal_evaluation_unavailable' });
    expect(Number((await fixture.ownerPool.query(`SELECT count(*) count
      FROM canonical_forecast_seasonal_evaluations_v1 WHERE origin_id=$1`,
    [seasonalOrigin])).rows[0].count)).toBe(before);
    const methodBefore = (await fixture.ownerPool.query(`SELECT revision,
      rtrim(review_digest) digest FROM canonical_forecast_demand_schedule_method_reviews_v1
      WHERE organization_id=$1 AND purpose='seasonal_inbound'
      ORDER BY revision DESC LIMIT 1`, [fixture.org])).rows[0];
    const rejected = await mutateMethod('seasonal_inbound', 'reject',
      Number(methodBefore.revision), methodBefore.digest);
    expect(rejected).toMatchObject({ state: 'demand_schedule_method_review_recorded',
      action: 'reject' });
    expect(await transaction(async client => (await client.query(
      `SELECT canonical_forecast_seasonal_origin_v1_capture(
       $1,$2,$3,$4,$5,$6,$7::date) value`, [fixture.org, owner().actorUserId,
        owner().actorAccessRole, owner().authSessionId, owner().csrfToken,
        seasonalOriginKey, '2028-12-01'])).rows[0].value)).toMatchObject({
      state: 'seasonal_origin_stale', id: seasonalOrigin, refreshRequired: true });
    expect(await mutateMethod('seasonal_inbound', 'approve', Number(rejected.revision),
      rejected.digest)).toMatchObject({ state: 'demand_schedule_method_review_recorded',
      action: 'approve' });
    const currentOutcome = await evidence('2028-12-01');
    expect(await certify('2028-12-01', currentOutcome, Number(revoked.revision),
      revoked.digest)).toMatchObject({ state: 'retell_period_certified', revision: 3 });
  }, 120000);

  test('late genuine Retell visibility stales only the affected certified month generation',
    async () => {
      const before = (await fixture.ownerPool.query(`SELECT
        canonical_forecast_seasonal_call_generation_v1(
          $1,'2028-12-01T05:00:00Z','2029-01-01T05:00:00Z') generation`,
      [fixture.org])).rows[0].generation;
      await seedRetellCall('2025-01-05T12:00:00Z', 'outside-pinned-horizon');
      expect((await fixture.ownerPool.query(`SELECT
        canonical_forecast_seasonal_call_generation_v1(
          $1,'2028-12-01T05:00:00Z','2029-01-01T05:00:00Z') generation`,
      [fixture.org])).rows[0].generation).toEqual(before);

      const lateCall = await seedRetellCall(
        '2028-12-20T12:00:00Z', 'late-inside-pinned-horizon');
      const savedTrainingMonths = (await fixture.ownerPool.query(`SELECT
        jsonb_path_query_array(evidence,'$.periods[*].month') months
        FROM canonical_forecast_seasonal_origins_v1 WHERE id=$1`, [seasonalOrigin]))
        .rows[0].months;
      expect(savedTrainingMonths).not.toContain('2028-12-01');
      expect((await fixture.runtimePool.query(
        `SELECT canonical_forecast_seasonal_evaluation_v1_read($1,$2,$3,$4,$5) value`,
        [fixture.org, owner().actorUserId, owner().actorAccessRole,
          owner().authSessionId, seasonalEvaluation])).rows[0].value)
        .toMatchObject({ state: 'seasonal_evaluation_stale', id: seasonalEvaluation,
          refreshRequired: true, metricsWithheld: true });
      const latest = (await fixture.ownerPool.query(`SELECT revision,rtrim(canonical_digest) digest
        FROM canonical_forecast_retell_period_certifications_v2
        WHERE organization_id=$1 AND local_month_start='2028-12-01'
        ORDER BY revision DESC LIMIT 1`, [fixture.org])).rows[0];
      const refreshed = await snapshot('2028-12-01');
      expect(refreshed.sources.some(source => source.sourceId === lateCall.transcript)).toBe(true);
      await reviewCalls(refreshed, refreshed.sources.map(source => source.sourceId));
      expect(await certify('2028-12-01', await evidence('2028-12-01'),
        Number(latest.revision), latest.digest)).toMatchObject({
        state: 'retell_period_certified', revision: Number(latest.revision) + 1 });
    }, 120000);

  test('mounts low, inconclusive, authenticated-zero and nonzero-neutral seasonal lifecycles',
    async () => {
      const months = (start, count) => {
        const first = new Date(`${start}T00:00:00Z`);
        return Array.from({ length: count }, (_, index) =>
          new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + index, 1))
            .toISOString().slice(0, 10));
      };
      await attest('2028-11-01'); const novemberSnapshot = await snapshot('2028-11-01');
      expect(novemberSnapshot.sourceCount).toBe(0);
      const novemberEvidence = await evidence('2028-11-01');
      expect(await certify('2028-11-01', novemberEvidence)).toMatchObject({
        state: 'retell_period_certified', revision: 1 });
      await clock('2029-01-10T12:00:00Z');
      const low = await transaction(async client => (await client.query(
        `SELECT canonical_forecast_seasonal_origin_v1_capture(
         $1,$2,$3,$4,$5,$6,$7::date) value`, [fixture.org, owner().actorUserId,
          owner().actorAccessRole, owner().authSessionId, owner().csrfToken,
          key('seasonal-low'), '2029-02-01'])).rows[0].value);
      expect(low).toMatchObject({ state: 'seasonal_origin_saved',
        seasonalSignalState: 'repeated_low', amountWithheld: true });

      for (const month of months('2029-01-01', 12)) {
        await certifyChronologicalMonth(month);
      }
      const beforeInconclusive = Number((await fixture.ownerPool.query(`SELECT count(*) count
        FROM canonical_forecast_seasonal_origins_v1 WHERE organization_id=$1`,
      [fixture.org])).rows[0].count);
      await clock('2030-01-10T12:00:00Z');
      const inconclusive = await transaction(async client => (await client.query(
        `SELECT canonical_forecast_seasonal_origin_v1_capture(
         $1,$2,$3,$4,$5,$6,$7::date) value`, [fixture.org, owner().actorUserId,
          owner().actorAccessRole, owner().authSessionId, owner().csrfToken,
          key('seasonal-inconclusive'), '2030-02-01'])).rows[0].value);
      expect(inconclusive).toMatchObject({ state: 'seasonal_origin_unavailable',
        reason: 'seasonal_signal_inconclusive', amountWithheld: true });
      expect(Number((await fixture.ownerPool.query(`SELECT count(*) count
        FROM canonical_forecast_seasonal_origins_v1 WHERE organization_id=$1`,
      [fixture.org])).rows[0].count)).toBe(beforeInconclusive);

      for (const month of months('2030-01-01', 13)) {
        await certifyChronologicalMonth(month);
      }
      await clock('2031-02-10T12:00:00Z');
      const zero = await transaction(async client => (await client.query(
        `SELECT canonical_forecast_seasonal_origin_v1_capture(
         $1,$2,$3,$4,$5,$6,$7::date) value`, [fixture.org, owner().actorUserId,
          owner().actorAccessRole, owner().authSessionId, owner().csrfToken,
          key('seasonal-complete-zero'), '2031-03-01'])).rows[0].value);
      expect(zero).toMatchObject({ state: 'seasonal_origin_saved',
        seasonalSignalState: 'authenticated_complete_zero_no_signal',
        sourceCoverageComplete: true, amountWithheld: true });

      const neutralCounts = new Map([
        ['2031-04-01', 5], ['2031-05-01', 56],
        ['2032-04-01', 6], ['2032-05-01', 67],
      ]);
      for (const month of months('2031-03-01', 24)) {
        await certifyChronologicalMonth(month, neutralCounts.get(month) || 0, 'neutral');
      }
      await clock('2033-03-10T12:00:00Z');
      const neutral = await transaction(async client => (await client.query(
        `SELECT canonical_forecast_seasonal_origin_v1_capture(
         $1,$2,$3,$4,$5,$6,$7::date) value`, [fixture.org, owner().actorUserId,
          owner().actorAccessRole, owner().authSessionId, owner().csrfToken,
          key('seasonal-neutral'), '2033-04-01'])).rows[0].value);
      expect(neutral).toMatchObject({ state: 'seasonal_origin_saved',
        seasonalSignalState: 'repeated_neutral', sourceCoverageComplete: true,
        amountWithheld: true, outputDigestWithheld: true });
    }, 300000);

  test('refuses an epoch replay after a source-context change commits during its fence wait',
    async () => {
      const replayKey = key('seasonal-epoch-context-race');
      const invoke = client => client.query(
        `SELECT canonical_forecast_demand_schedule_epoch_v1_capture(
         $1,$2,$3,$4,$5,$6,'seasonal_inbound',$7) value`,
        [fixture.org, owner().actorUserId, owner().actorAccessRole, owner().authSessionId,
          owner().csrfToken, replayKey, anchorId]);
      const recorded = await transaction(async client => (await invoke(client)).rows[0].value);
      expect(recorded).toMatchObject({ state: 'demand_schedule_epoch_recorded',
        purpose: 'seasonal_inbound', replayed: false });
      expect(await transaction(async client => (await invoke(client)).rows[0].value))
        .toMatchObject({ id: recorded.id, replayed: true });

      const blocker = await fixture.ownerPool.connect();
      let settled = false;
      try {
        await blocker.query('BEGIN');
        await blocker.query(`SELECT pg_advisory_xact_lock(hashtextextended(
          'm26:demand-schedule-epoch:'||$1||':seasonal_inbound',0))`, [fixture.org]);
        const pending = transaction(async client => (await invoke(client)).rows[0].value)
          .then(value => { settled = true; return value; });
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(settled).toBe(false);
        await fixture.ownerPool.query(`UPDATE canonical_integration_ownership
          SET updated_at=updated_at+INTERVAL '1 second' WHERE id=$1`, [integrationId]);
        await blocker.query('COMMIT');
        expect(await pending).toMatchObject({ state: 'demand_schedule_epoch_stale',
          id: recorded.id, refreshRequired: true, replayed: true });
      } catch (error) {
        await blocker.query('ROLLBACK').catch(() => {}); throw error;
      } finally { blocker.release(); }
    }, 120000);

  test('freezes a prospective same-population cohort and evaluates genuine later bookings',
    async () => {
      await clock('2034-02-01T12:00:00Z');
      const epochValue = await transaction(async client => (await client.query(
        `SELECT canonical_forecast_demand_schedule_epoch_v1_capture(
         $1,$2,$3,$4,$5,$6,'pipeline_first_booking',$7) value`,
        [fixture.org, owner().actorUserId, owner().actorAccessRole, owner().authSessionId,
          owner().csrfToken, key('pipeline-epoch'), anchorId])).rows[0].value);
      expect(epochValue).toMatchObject({ state: 'demand_schedule_epoch_recorded',
        purpose: 'pipeline_first_booking', replayed: false });
      pipelineEpoch = epochValue.id;

      await clock('2034-04-03T12:00:00Z');
      const earlyWindow = (await fixture.ownerPool.query(`SELECT installed_at,
        canonical_forecast_demand_schedule_clock_v1() cutoff,
        canonical_forecast_demand_schedule_clock_v1()-INTERVAL '60 days' starts_at,
        (canonical_forecast_demand_schedule_clock_v1()-INTERVAL '30 days')-
          (canonical_forecast_demand_schedule_clock_v1()-INTERVAL '60 days') span
        FROM canonical_forecast_demand_schedule_epochs_v1 WHERE id=$1`, [pipelineEpoch])).rows[0];
      expect(earlyWindow.starts_at.getTime()).toBeGreaterThan(earlyWindow.installed_at.getTime());
      expect(earlyWindow.span).toEqual({ days: 30 });
      const emptyOrigin = await transaction(async client => (await client.query(
        `SELECT canonical_forecast_pipeline_origin_v1_capture(
         $1,$2,$3,$4,$5,$6) value`, [fixture.org, owner().actorUserId,
          owner().actorAccessRole, owner().authSessionId, owner().csrfToken,
          key('pipeline-empty')])).rows[0].value);
      expect(emptyOrigin).toMatchObject({ state: 'pipeline_origin_saved',
        sourceCoverageComplete: true, countWithheld: true });
      expect((await fixture.ownerPool.query(`SELECT private_output
        FROM canonical_forecast_pipeline_origins_v1 WHERE id=$1`, [emptyOrigin.id]))
        .rows[0].private_output).toMatchObject({ expectedCount: 0, currentEligibleCount: 0,
        historicalEligibleCount: 0, historicalFirstBookedCount: 0 });

      const rowsBeforeBound = Number((await fixture.ownerPool.query(`SELECT count(*) count
        FROM canonical_forecast_pipeline_origins_v1 WHERE organization_id=$1`,
      [fixture.org])).rows[0].count);
      await clock('2034-04-04T12:00:00Z');
      await createBulkEligiblePipeline(167, `aggregate-${crypto.randomUUID()}`);
      await clock('2034-06-04T12:00:00Z');
      await expect(transaction(async client => client.query(
        `SELECT canonical_forecast_pipeline_origin_v1_capture(
         $1,$2,$3,$4,$5,$6) value`, [fixture.org, owner().actorUserId,
          owner().actorAccessRole, owner().authSessionId, owner().csrfToken,
          key('pipeline-aggregate-excess')]))).rejects.toMatchObject({ code: '54000' });
      expect(Number((await fixture.ownerPool.query(`SELECT count(*) count
        FROM canonical_forecast_pipeline_origins_v1 WHERE organization_id=$1`,
      [fixture.org])).rows[0].count)).toBe(rowsBeforeBound);

      await clock('2034-06-05T12:00:00Z');
      const replacementEpoch = await transaction(async client => (await client.query(
        `SELECT canonical_forecast_demand_schedule_epoch_v1_capture(
         $1,$2,$3,$4,$5,$6,'pipeline_first_booking',$7) value`,
        [fixture.org, owner().actorUserId, owner().actorAccessRole, owner().authSessionId,
          owner().csrfToken, key('pipeline-epoch-after-bound'), anchorId])).rows[0].value);
      expect(replacementEpoch).toMatchObject({ state: 'demand_schedule_epoch_recorded',
        purpose: 'pipeline_first_booking', replayed: false });
      pipelineEpoch = replacementEpoch.id;

      await clock('2034-08-06T12:00:00Z');
      const noHistory = await createUnbookedPipeline('zero-denominator');
      const refused = await transaction(async client => (await client.query(
        `SELECT canonical_forecast_pipeline_origin_v1_capture(
         $1,$2,$3,$4,$5,$6) value`, [fixture.org, owner().actorUserId,
          owner().actorAccessRole, owner().authSessionId, owner().csrfToken,
          key('pipeline-zero-denominator')])).rows[0].value);
      expect(refused).toMatchObject({ state: 'pipeline_origin_unavailable',
        reason: 'historical_denominator_zero', countWithheld: true });
      await clock('2034-08-07T12:00:00Z'); await approveAssignment(noHistory);

      await clock('2034-08-08T12:00:00Z');
      const historicalBooked = await createUnbookedPipeline('historical-booked');
      await clock('2034-09-16T12:00:00Z'); await approveAssignment(historicalBooked);
      const historicalZero = await createUnbookedPipeline('historical-zero');
      await clock('2034-10-31T12:00:00Z');
      const current = await createUnbookedPipeline('current-risk');
      const currentAfterHorizon = await createUnbookedPipeline('current-after-horizon');
      await clock('2034-11-01T12:00:00Z');

      const epochInstalled = (await fixture.ownerPool.query(`SELECT installed_at FROM
        canonical_forecast_demand_schedule_epochs_v1 WHERE id=$1`, [pipelineEpoch]))
        .rows[0].installed_at;
      const diagnostic = (await fixture.ownerPool.query(`SELECT
        canonical_forecast_pipeline_cohort_v1($1,$2,'2034-09-02T12:00:00Z','2034-10-02T12:00:00Z') first_window,
        canonical_forecast_pipeline_cohort_v1($1,$2,'2034-10-02T12:00:00Z','2034-11-01T12:00:00Z') second_window,
        canonical_forecast_pipeline_risk_v1($1,$2,'2034-11-01T12:00:00Z') current_risk`,
      [fixture.org, epochInstalled])).rows[0];
      expect(diagnostic.first_window).toMatchObject({ state: 'complete', eligibleCount: 1,
        firstBookedCount: 1 });
      expect(diagnostic.second_window).toMatchObject({ state: 'complete', eligibleCount: 1,
        firstBookedCount: 0 });
      expect(diagnostic.current_risk).toMatchObject({ state: 'complete', eligibleCount: 3 });

      await ui.action('prerequisites-load', 'Prerequisites loaded', 'Setup');
      await ui.action('pipeline-save', 'Research origin saved', 'Pipeline');
      uiPipelineOrigin = await ui.page.locator('#commandCenterResearchPipelineId').inputValue();
      expect(uiPipelineOrigin).toMatch(/^[0-9a-f-]{36}$/);
      await ui.action('pipeline-load', 'Evidence is current', 'Pipeline');

      const uiOriginResponse = [...ui.responses].reverse().find(item => item.method === 'POST' &&
        item.url.endsWith(`${ROOT}/pipeline-origins`));
      expect(uiOriginResponse).toBeDefined();
      const originKey = uiOriginResponse.headers['idempotency-key'];
      pipelineOriginKey = originKey;
      const saved = uiOriginResponse.body.data;
      expect(uiOriginResponse.status).toBe(201);
      expect(saved).toMatchObject({ state: 'pipeline_origin_saved',
        countWithheld: true, outputDigestWithheld: true, forecastIssued: false });
      expect(research.validateDemandOrigin(saved, 'pipeline')).not.toBeNull();
      pipelineOrigin = saved.id;
      expect(uiPipelineOrigin).toBe(pipelineOrigin);
      const mountedOrigin = await request(fixture.app)
        .get(`${ROOT}/pipeline-origins/${pipelineOrigin}`).set(owner().session.headers);
      expect(mountedOrigin.status).toBe(200);
      expect(research.validateDemandOrigin(mountedOrigin.body.data,
        'pipeline', pipelineOrigin)).not.toBeNull();
      const origin = (await fixture.ownerPool.query(`SELECT *,evidence#>>'{currentRisk,eligibleCount}'
        current_eligible,private_output->>'expectedCount' expected_count
        FROM canonical_forecast_pipeline_origins_v1 WHERE id=$1`, [saved.id])).rows[0];
      expect(Number(origin.current_eligible)).toBe(3);
      expect(Number(origin.expected_count)).toBeGreaterThan(0);

      const tooEarly = await transaction(async client => (await client.query(
        `SELECT canonical_forecast_pipeline_evaluation_v1_capture(
         $1,$2,$3,$4,$5,$6,$7) value`, [fixture.org, owner().actorUserId,
          owner().actorAccessRole, owner().authSessionId, owner().csrfToken,
          key('pipeline-too-early'), saved.id])).rows[0].value);
      expect(tooEarly).toMatchObject({ state: 'pipeline_evaluation_unavailable',
        reason: 'horizon_not_ended', metricsWithheld: true });

      await clock('2034-11-02T12:00:00Z');
      await createUnbookedPipeline('post-cutoff-entrant');
      expect((await fixture.runtimePool.query(
        `SELECT canonical_forecast_pipeline_origin_v1_read($1,$2,$3,$4,$5) value`,
        [fixture.org, owner().actorUserId, owner().actorAccessRole,
          owner().authSessionId, saved.id])).rows[0].value).toMatchObject({
        state: 'pipeline_origin_current', postCutoffEntrantsExcluded: true });

      await clock('2034-11-10T12:00:00Z'); await approveAssignment(current);
      const sourceEvent = (await fixture.ownerPool.query(`SELECT observation.source_order,
        observation.source_occurred_at,observation.observed_at
        FROM canonical_forecast_pipeline_booking_visibility_v1 observation
        WHERE observation.organization_id=$1 AND observation.opportunity_id=$2
        ORDER BY observation.source_order DESC LIMIT 1`, [fixture.org, current.opportunity])).rows[0];
      expect(sourceEvent.source_occurred_at.toISOString()).toBe('2034-11-10T12:00:00.000Z');
      expect(sourceEvent.observed_at.toISOString()).toBe('2034-11-10T12:00:00.000Z');
      expect(sourceEvent.source_occurred_at.getTime())
        .toBeGreaterThan(origin.prediction_cutoff_at.getTime());
      expect(sourceEvent.source_occurred_at.getTime()).toBeLessThan(origin.horizon_ends_at.getTime());

      await clock('2034-12-02T12:00:00Z');
      await ui.page.locator('#commandCenterResearchPipelineId').fill(pipelineOrigin);
      await ui.action('pipeline-evaluate', 'Evaluation saved', 'Pipeline');
      const uiPipelineEvaluation = await ui.page
        .locator('#commandCenterResearchPipelineEvaluationId').inputValue();
      expect(uiPipelineEvaluation).toMatch(/^[0-9a-f-]{36}$/);
      await ui.action('pipeline-evaluation-load', 'Evidence is current', 'Pipeline');
      const uiEvaluationResponse = [...ui.responses].reverse().find(item => item.method === 'POST' &&
        item.url.endsWith(`${ROOT}/pipeline-origins/${saved.id}/evaluations`));
      expect(uiEvaluationResponse).toBeDefined();
      const evaluated = uiEvaluationResponse.body.data;
      expect(uiEvaluationResponse.status).toBe(201);
      expect(evaluated).toMatchObject({ state: 'pipeline_evaluation_saved', revision: 1,
        metricsWithheld: true, forecastIssued: false });
      expect(research.validateDemandEvaluation(evaluated, 'pipeline', saved.id)).not.toBeNull();
      expect(uiPipelineEvaluation).toBe(evaluated.id);
      const immutableOrigin = (await fixture.ownerPool.query(`SELECT evidence_digest,output_digest,
        as_of FROM canonical_forecast_pipeline_origins_v1 WHERE id=$1`, [saved.id])).rows[0];
      const privateEvaluation = (await fixture.ownerPool.query(`SELECT outcome_evidence,
        private_metrics FROM canonical_forecast_pipeline_evaluations_v1 WHERE id=$1`,
      [evaluated.id])).rows[0];
      expect(privateEvaluation.outcome_evidence).toMatchObject({ actualFirstBookedCount: 1,
        memberCount: 3 });
      const mountedEvaluation = await request(fixture.app)
        .get(`${ROOT}/pipeline-evaluations/${evaluated.id}`).set(owner().session.headers);
      expect(mountedEvaluation.status).toBe(200);
      expect(research.validateDemandEvaluation(mountedEvaluation.body.data,
        'pipeline', pipelineOrigin, evaluated.id)).not.toBeNull();

      await clock('2034-12-03T12:00:00Z');
      await sourceClock('2034-11-20T12:00:00Z');
      try { await approveAssignment(historicalZero); } finally { await sourceClock(null); }
      const lateObserved = (await fixture.ownerPool.query(`SELECT source_occurred_at,observed_at
        FROM canonical_forecast_pipeline_booking_visibility_v1
        WHERE organization_id=$1 AND opportunity_id=$2 ORDER BY source_order DESC LIMIT 1`,
      [fixture.org, historicalZero.opportunity])).rows[0];
      expect(lateObserved.source_occurred_at.toISOString()).toBe('2034-11-20T12:00:00.000Z');
      expect(lateObserved.observed_at.toISOString()).toBe('2034-12-03T12:00:00.000Z');
      const staleEvaluation = (await fixture.runtimePool.query(
        `SELECT canonical_forecast_pipeline_evaluation_v1_read($1,$2,$3,$4,$5) value`,
        [fixture.org, owner().actorUserId, owner().actorAccessRole,
          owner().authSessionId, evaluated.id])).rows[0].value;
      expect(staleEvaluation).toMatchObject({ state: 'pipeline_evaluation_stale',
        refreshRequired: true, metricsWithheld: true });
      const reevaluated = await transaction(async client => (await client.query(
        `SELECT canonical_forecast_pipeline_evaluation_v1_capture(
         $1,$2,$3,$4,$5,$6,$7) value`, [fixture.org, owner().actorUserId,
          owner().actorAccessRole, owner().authSessionId, owner().csrfToken,
          key('pipeline-reevaluation'), saved.id])).rows[0].value);
      expect(reevaluated).toMatchObject({ state: 'pipeline_evaluation_saved', revision: 2 });
      expect((await fixture.ownerPool.query(`SELECT evidence_digest,output_digest,as_of
        FROM canonical_forecast_pipeline_origins_v1 WHERE id=$1`, [saved.id])).rows[0])
        .toEqual(immutableOrigin);

      await clock('2034-12-04T12:00:00Z');
      await sourceClock(origin.horizon_ends_at.toISOString());
      try { await approveAssignment(currentAfterHorizon); } finally { await sourceClock(null); }
      const upperBoundary = (await fixture.ownerPool.query(`SELECT source_occurred_at
        FROM canonical_forecast_pipeline_booking_visibility_v1
        WHERE organization_id=$1 AND opportunity_id=$2 ORDER BY source_order DESC LIMIT 1`,
      [fixture.org, currentAfterHorizon.opportunity])).rows[0];
      expect(upperBoundary.source_occurred_at).toEqual(origin.horizon_ends_at);
      expect((await fixture.runtimePool.query(
        `SELECT canonical_forecast_pipeline_evaluation_v1_read($1,$2,$3,$4,$5) value`,
        [fixture.org, owner().actorUserId, owner().actorAccessRole,
          owner().authSessionId, reevaluated.id])).rows[0].value)
        .toMatchObject({ state: 'pipeline_evaluation_current', id: reevaluated.id });

      const replay = await transaction(async client => (await client.query(
        `SELECT canonical_forecast_pipeline_origin_v1_capture(
         $1,$2,$3,$4,$5,$6) value`, [fixture.org, owner().actorUserId,
          owner().actorAccessRole, owner().authSessionId, owner().csrfToken,
          originKey])).rows[0].value);
      expect(replay).toMatchObject({ state: 'pipeline_origin_saved', id: saved.id,
        replayed: true });
    }, 240000);
  test('pins backlog as a separate current fact and stales it on later schedule evolution',
    async () => {
      const backlogKey = key('backlog-fact');
      const saved = await transaction(async client => (await client.query(
        `SELECT canonical_forecast_demand_schedule_backlog_v1_capture(
         $1,$2,$3,$4,$5,$6) value`, [fixture.org, owner().actorUserId,
          owner().actorAccessRole, owner().authSessionId, owner().csrfToken,
          backlogKey])).rows[0].value, 'SERIALIZABLE');
      expect(saved).toMatchObject({ state: 'backlog_fact_saved', replayed: false,
        knownSubsetOnly: true, wholeBusinessCoverageVerified: false,
        researchOnly: true, forecastIssued: false });
      const privateFact = (await fixture.ownerPool.query(`SELECT fact,fact_digest,
        backlog_snapshot_digest,backlog_source_digest
        FROM canonical_forecast_demand_schedule_backlog_facts_v1 WHERE id=$1`,
      [saved.id])).rows[0];
      expect(privateFact.fact).toMatchObject({ targetKey: 'demand.current_backlog_position.v1',
        knownSubsetOnly: true, wholeBusinessCoverageVerified: false });
      expect(privateFact.fact).not.toHaveProperty('predictedPoint');
      expect(privateFact.fact).not.toHaveProperty('expectedCount');
      const current = (await fixture.runtimePool.query(
        `SELECT canonical_forecast_demand_schedule_backlog_v1_read($1,$2,$3,$4,$5) value`,
        [fixture.org, owner().actorUserId, owner().actorAccessRole,
          owner().authSessionId, saved.id])).rows[0].value;
      expect(current).toMatchObject({ state: 'backlog_fact_current', id: saved.id,
        knownSubsetOnly: true, wholeBusinessCoverageVerified: false });

      const changed = await createUnbookedPipeline('backlog-change');
      await approveAssignment(changed);
      const stale = (await fixture.runtimePool.query(
        `SELECT canonical_forecast_demand_schedule_backlog_v1_read($1,$2,$3,$4,$5) value`,
        [fixture.org, owner().actorUserId, owner().actorAccessRole,
          owner().authSessionId, saved.id])).rows[0].value;
      expect(stale).toMatchObject({ state: 'backlog_fact_stale', id: saved.id,
        refreshRequired: true, knownSubsetOnly: true,
        wholeBusinessCoverageVerified: false });
      expect((await fixture.ownerPool.query(`SELECT fact,fact_digest,backlog_snapshot_digest,
        backlog_source_digest FROM canonical_forecast_demand_schedule_backlog_facts_v1
        WHERE id=$1`, [saved.id])).rows[0]).toEqual(privateFact);
      const replay = await transaction(async client => (await client.query(
        `SELECT canonical_forecast_demand_schedule_backlog_v1_capture(
         $1,$2,$3,$4,$5,$6) value`, [fixture.org, owner().actorUserId,
          owner().actorAccessRole, owner().authSessionId, owner().csrfToken,
          backlogKey])).rows[0].value, 'SERIALIZABLE');
      expect(replay).toMatchObject({ state: 'backlog_fact_stale', id: saved.id,
        refreshRequired: true });
    }, 120000);

  test('drains a genuine in-flight eligibility writer before freezing a new risk set', async () => {
    await clock('2034-12-04T12:00:00Z');
    const writer = await fixture.ownerPool.connect();
    let captureSettled = false; let sourceSettled = false;
    try {
      await writer.query('BEGIN');
      await writer.query(`SELECT pg_advisory_xact_lock(hashtextextended(
        'm26:opportunity-eligibility:'||$1::text,0))`, [fixture.org]);
      const source = createUnbookedPipeline('concurrent-eligibility').then(value => {
        sourceSettled = true; return value;
      });
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(sourceSettled).toBe(false);
      const capture = transaction(async client => (await client.query(
        `SELECT canonical_forecast_pipeline_origin_v1_capture(
         $1,$2,$3,$4,$5,$6) value`, [fixture.org, owner().actorUserId,
          owner().actorAccessRole, owner().authSessionId, owner().csrfToken,
          key('pipeline-concurrent')])).rows[0].value).then(value => {
        captureSettled = true; return value;
      });
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(captureSettled).toBe(false);
      await writer.query('COMMIT');
      const concurrent = await source;
      const saved = await capture;
      expect(saved).toMatchObject({ state: 'pipeline_origin_saved', countWithheld: true });
      const privateOrigin = (await fixture.ownerPool.query(`SELECT evidence
        FROM canonical_forecast_pipeline_origins_v1 WHERE id=$1`, [saved.id])).rows[0];
      expect(privateOrigin.evidence.currentRisk.members.map(item => item.opportunityId))
        .toContain(concurrent.opportunity);
    } catch (error) {
      await writer.query('ROLLBACK').catch(() => {}); throw error;
    } finally { writer.release(); }
  }, 120000);

  test('refuses an exact pipeline idempotency replay after method governance changes', async () => {
    const currentReview = (await fixture.ownerPool.query(`SELECT revision,
      rtrim(review_digest) digest FROM canonical_forecast_demand_schedule_method_reviews_v1
      WHERE organization_id=$1 AND purpose='pipeline_first_booking'
      ORDER BY revision DESC LIMIT 1`, [fixture.org])).rows[0];
    expect(await mutateMethod('pipeline_first_booking', 'reject',
      Number(currentReview.revision), currentReview.digest)).toMatchObject({
      state: 'demand_schedule_method_review_recorded', action: 'reject' });
    const before = Number((await fixture.ownerPool.query(`SELECT count(*) count
      FROM canonical_forecast_pipeline_origins_v1 WHERE organization_id=$1`,
    [fixture.org])).rows[0].count);
    const replay = await transaction(async client => (await client.query(
      `SELECT canonical_forecast_pipeline_origin_v1_capture(
       $1,$2,$3,$4,$5,$6) value`, [fixture.org, owner().actorUserId,
        owner().actorAccessRole, owner().authSessionId, owner().csrfToken,
        pipelineOriginKey])).rows[0].value);
    expect(replay).toMatchObject({ state: 'pipeline_origin_stale', id: pipelineOrigin,
      refreshRequired: true, countWithheld: true, outputDigestWithheld: true });
    expect(Number((await fixture.ownerPool.query(`SELECT count(*) count
      FROM canonical_forecast_pipeline_origins_v1 WHERE organization_id=$1`,
    [fixture.org])).rows[0].count)).toBe(before);
  }, 120000);

  test('uses source occurrence for exclusive cohort edges despite delayed observation and cancellation',
    async () => {
      const installedAt = (await fixture.ownerPool.query(`SELECT installed_at
        FROM canonical_forecast_demand_schedule_epochs_v1 WHERE id=$1`, [pipelineEpoch]))
        .rows[0].installed_at;
      await clock('2035-03-03T12:00:00Z');
      const lower = await createUnbookedPipeline('exclusive-lower-edge');
      const upper = await createUnbookedPipeline('exclusive-upper-edge');
      const delayed = await createUnbookedPipeline('delayed-observation');
      await clock('2035-04-05T12:00:00Z'); await approveAssignment(lower);
      await clock('2035-05-05T12:00:00Z'); await approveAssignment(upper);

      const blocker = await fixture.ownerPool.connect();
      let settled = false;
      try {
        await clock('2035-05-20T12:00:00Z');
        await sourceClock('2035-05-20T12:00:00Z');
        await blocker.query('BEGIN');
        await blocker.query(`SELECT pg_advisory_xact_lock(hashtextextended(
          'm26:schedule-booking-events:'||$1::text,0))`, [fixture.org]);
        const pending = approveAssignment(delayed).then(value => { settled = true; return value; });
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(settled).toBe(false);
        await clock('2035-06-06T12:00:00Z');
        await blocker.query('COMMIT');
        await pending;
      } catch (error) {
        await blocker.query('ROLLBACK').catch(() => {}); throw error;
      } finally {
        blocker.release();
        await sourceClock(null);
      }

      const delayedReceipt = (await fixture.ownerPool.query(`SELECT source_occurred_at,
        observed_at FROM canonical_forecast_pipeline_booking_visibility_v1
        WHERE organization_id=$1 AND opportunity_id=$2 ORDER BY source_order LIMIT 1`,
      [fixture.org, delayed.opportunity])).rows[0];
      expect(delayedReceipt.source_occurred_at.toISOString()).toBe('2035-05-20T12:00:00.000Z');
      expect(delayedReceipt.observed_at.toISOString()).toBe('2035-06-06T12:00:00.000Z');
      const cohorts = (await fixture.ownerPool.query(`SELECT
        canonical_forecast_pipeline_cohort_v1($1,$2,'2035-04-05T12:00:00Z',
          '2035-05-05T12:00:00Z') first_window,
        canonical_forecast_pipeline_cohort_v1($1,$2,'2035-05-05T12:00:00Z',
          '2035-06-04T12:00:00Z') second_window`, [fixture.org, installedAt])).rows[0];
      expect(cohorts.first_window).toMatchObject({ state: 'complete', firstBookedCount: 0 });
      const firstMembers = new Map(cohorts.first_window.members.map(member =>
        [member.opportunityId, member]));
      expect(firstMembers.has(lower.opportunity)).toBe(false);
      expect(firstMembers.get(upper.opportunity)).toMatchObject({ acceptedEventId: null });
      expect(firstMembers.get(delayed.opportunity)).toMatchObject({ acceptedEventId: null });
      expect(cohorts.second_window).toMatchObject({ state: 'complete', firstBookedCount: 1 });
      const secondMembers = new Map(cohorts.second_window.members.map(member =>
        [member.opportunityId, member]));
      expect(secondMembers.has(lower.opportunity)).toBe(false);
      expect(secondMembers.has(upper.opportunity)).toBe(false);
      expect(secondMembers.get(delayed.opportunity).acceptedEventId).toEqual(expect.any(String));
      await clock('2035-06-07T12:00:00Z');
      await recordOperationalStatus(delayed, 'cancelled',
        'Record a genuine cancellation without erasing the first accepted booking.');
      expect((await fixture.ownerPool.query(`SELECT
        canonical_forecast_pipeline_cohort_v1($1,$2,'2035-05-05T12:00:00Z',
          '2035-06-04T12:00:00Z') value`, [fixture.org, installedAt])).rows[0].value)
        .toMatchObject({ state: 'complete', firstBookedCount: 1 });
    }, 120000);

  test('excludes prior bookings before the complete-population bound without truncation',
    async () => {
      await clock('2036-01-01T12:00:00Z');
      const installedAt = (await fixture.ownerPool.query(`SELECT installed_at
        FROM canonical_forecast_demand_schedule_epochs_v1 WHERE id=$1`, [pipelineEpoch]))
        .rows[0].installed_at;
      const prior = (await fixture.ownerPool.query(`SELECT
        canonical_forecast_pipeline_risk_v1($1,$2,'2036-02-01T12:00:00Z') value`,
      [fixture.org, installedAt])).rows[0].value;
      expect(prior).toMatchObject({ state: 'complete' });
      const newCandidateCount = 505 - Number(prior.eligibleCount);
      expect(newCandidateCount).toBeGreaterThan(5);
      expect(newCandidateCount).toBeLessThanOrEqual(600);
      const opportunities = await createBulkEligiblePipeline(
        newCandidateCount, `complete-population-${crypto.randomUUID()}`);
      const booked = opportunities.slice(0, 5);
      await fixture.ownerPool.query(`WITH source AS (
        SELECT opportunity_id,row_number() OVER(ORDER BY opportunity_id) ordinal
        FROM unnest($2::uuid[]) opportunity_id
      ), high_water AS (
        SELECT COALESCE(max(source_order),0) source_order
        FROM canonical_forecast_pipeline_booking_visibility_v1
        WHERE organization_id=$1
      ) INSERT INTO canonical_forecast_pipeline_booking_visibility_v1(
        organization_id,source_event_id,source_order,opportunity_id,assignment_id,
        appointment_id,source_occurred_at,observed_at,source_digest,observation_digest)
      SELECT $1,gen_random_uuid(),high_water.source_order+source.ordinal,
        source.opportunity_id,gen_random_uuid(),gen_random_uuid(),
        '2036-01-02T12:00:00Z','2036-01-02T12:00:00Z',
        encode(sha256(convert_to('booked:'||source.opportunity_id::text,'UTF8')),'hex'),
        encode(sha256(convert_to('observed:'||source.opportunity_id::text,'UTF8')),'hex')
      FROM source CROSS JOIN high_water`, [fixture.org, booked]);
      const complete = (await fixture.ownerPool.query(`SELECT
        canonical_forecast_pipeline_risk_v1($1,$2,'2036-02-01T12:00:00Z') value`,
      [fixture.org, installedAt])).rows[0].value;
      expect(complete).toMatchObject({ state: 'complete', eligibleCount: 500 });
      const members = new Set(complete.members.map(member => member.opportunityId));
      expect(booked.every(id => !members.has(id))).toBe(true);
      expect(members.has(opportunities.at(-1))).toBe(true);
      expect(opportunities.filter(id => members.has(id))).toHaveLength(newCandidateCount - 5);

      await clock('2036-01-03T12:00:00Z');
      await createBulkEligiblePipeline(1, `complete-population-excess-${crypto.randomUUID()}`);
      await expect(fixture.ownerPool.query(`SELECT
        canonical_forecast_pipeline_risk_v1($1,$2,'2036-02-01T12:00:00Z') value`,
      [fixture.org, installedAt])).rejects.toMatchObject({ code: '54000' });
    }, 120000);

  test('rechecks paid certification authority after source-lock waits for replay, certify, and revoke',
    async () => {
      const month = '2026-11-01';
      const period = await evidence(month);
      expect(period).toMatchObject({ state: 'retell_period_ready_for_certification' });
      const prior = (await fixture.ownerPool.query(`SELECT revision,
        rtrim(canonical_digest) digest FROM canonical_forecast_retell_period_certifications_v2
        WHERE organization_id=$1 AND local_month_start=$2::date
        ORDER BY revision DESC LIMIT 1`, [fixture.org, month])).rows[0];
      const replayKey = key('certification-paid-replay-race');
      const replayRequest = await certificationRequest(month, period, Number(prior.revision),
        prior.digest, 'certify', replayKey);
      const recorded = await transaction(client => invokeCertification(client, replayRequest));
      expect(recorded).toMatchObject({ state: 'retell_period_certified', replayed: false });
      expect(await transaction(client => invokeCertification(client, replayRequest)))
        .toMatchObject({ id: recorded.id, replayed: true });

      const freshCertify = await certificationRequest(month, period, Number(recorded.revision),
        recorded.digest, 'certify', key('certification-paid-certify-race'));
      const freshRevoke = await certificationRequest(month, period, Number(recorded.revision),
        recorded.digest, 'revoke', key('certification-paid-revoke-race'));
      const cases = [
        ['exact-key replay', replayRequest],
        ['fresh certify', freshCertify],
        ['fresh revoke', freshRevoke],
      ];
      for (const [label, certification] of cases) {
        const before = Number((await fixture.ownerPool.query(`SELECT count(*) count
          FROM canonical_forecast_retell_period_certifications_v2
          WHERE organization_id=$1 AND local_month_start=$2::date`,
        [fixture.org, month])).rows[0].count);
        const blocker = await fixture.ownerPool.connect();
        const pendingClient = await fixture.runtimePool.connect();
        try {
          await blocker.query('BEGIN');
          await blocker.query('LOCK TABLE canonical_operations IN ROW EXCLUSIVE MODE');
          await pendingClient.query('BEGIN ISOLATION LEVEL READ COMMITTED');
          const pending = invokeCertification(pendingClient, certification);
          const lockWait = await waitForTableLock(pendingClient);
          expect(lockWait).toMatchObject({ locktype: 'relation', mode: 'ShareLock',
            granted: false });
          await fixture.ownerPool.query(
            `UPDATE subscriptions SET status='past_due' WHERE organization_id=$1`, [fixture.org]);
          await blocker.query('COMMIT');
          await expect(pending).rejects.toMatchObject({ code: '42501' });
          await pendingClient.query('ROLLBACK');
          expect(Number((await fixture.ownerPool.query(`SELECT count(*) count
            FROM canonical_forecast_retell_period_certifications_v2
            WHERE organization_id=$1 AND local_month_start=$2::date`,
          [fixture.org, month])).rows[0].count)).toBe(before);
        } catch (error) {
          await blocker.query('ROLLBACK').catch(() => {});
          await pendingClient.query('ROLLBACK').catch(() => {});
          throw new Error(`${label}: ${error.message}`, { cause: error });
        } finally {
          blocker.release(); pendingClient.release();
          await fixture.ownerPool.query(
            `UPDATE subscriptions SET status='active' WHERE organization_id=$1`, [fixture.org]);
        }
      }
    }, 120000);

  test('waits for an in-flight consent revocation and withholds the seasonal origin', async () => {
    const consent = (await fixture.ownerPool.query(`SELECT revision,rtrim(canonical_digest) digest
      FROM canonical_forecast_retell_source_consents WHERE organization_id=$1
      ORDER BY revision DESC LIMIT 1`, [fixture.org])).rows[0];
    const writer = await fixture.runtimePool.connect();
    let settled = false;
    try {
      await writer.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await writer.query(`SELECT canonical_forecast_retell_source_consent_mutate(
       $1,$2,$3,$4,$5,$6,$7::jsonb)`, [fixture.org, owner().actorUserId,
        owner().actorAccessRole, owner().authSessionId, owner().csrfToken,
        key('consent-revoke'), JSON.stringify({ action: 'revoke',
          expectedRevision: Number(consent.revision), expectedDigest: consent.digest,
          reason: 'Revoke the Part 4C seasonal research source after explicit review.',
          confirmed: true, confirmationVersion: 'm26-retell-demand-source-consent-v1' })]);
      const read = fixture.runtimePool.query(
        `SELECT canonical_forecast_seasonal_origin_v1_read($1,$2,$3,$4,$5) value`,
        [fixture.org, owner().actorUserId, owner().actorAccessRole,
          owner().authSessionId, seasonalOrigin]).then(result => {
        settled = true; return result.rows[0].value;
      });
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(settled).toBe(false);
      await writer.query('COMMIT');
      expect(await read).toMatchObject({ state: 'seasonal_origin_stale',
        refreshRequired: true, amountWithheld: true, outputDigestWithheld: true });
    } catch (error) {
      await writer.query('ROLLBACK').catch(() => {}); throw error;
    } finally { writer.release(); }
  }, 120000);

  test('rechecks authorization after a source-lock wait before returning private metadata',
    async () => {
      const blocker = await fixture.ownerPool.connect();
      let settled = false;
      try {
        await blocker.query('BEGIN');
        await blocker.query(`SELECT pg_advisory_xact_lock(hashtextextended(
          'm26:opportunity-eligibility:'||$1::text,0))`, [fixture.org]);
        const pending = fixture.runtimePool.query(
          `SELECT canonical_forecast_pipeline_origin_v1_read($1,$2,$3,$4,$5) value`,
          [fixture.org, admin().actorUserId, admin().actorAccessRole,
            admin().authSessionId, pipelineOrigin]).then(result => {
          settled = true; return result;
        }, error => { settled = true; throw error; });
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(settled).toBe(false);
        await fixture.ownerPool.query(`UPDATE auth_sessions SET status='revoked',
          revoked_at=clock_timestamp(),revoke_reason='part4c_post_wait_access_test'
          WHERE id=$1`, [admin().authSessionId]);
        await blocker.query('COMMIT');
        await expect(pending).rejects.toMatchObject({ code: '42501' });
      } catch (error) {
        await blocker.query('ROLLBACK').catch(() => {}); throw error;
      } finally {
        blocker.release();
        await fixture.ownerPool.query(`UPDATE auth_sessions SET status='active',
          revoked_at=NULL,revoke_reason=NULL WHERE id=$1`, [admin().authSessionId]);
      }
    }, 120000);

});
