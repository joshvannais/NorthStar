'use strict';

const crypto = require('node:crypto');
const express = require('express');
const { Client } = require('pg');
const request = require('supertest');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const { createForecastLaborCostRouter } = require('../../src/routes/forecastLaborCost');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const uuid = () => crypto.randomUUID();
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const CAPACITY_TARGET = 'capacity.available_role_hours.v1';

realPostgres('Mission 26 original Part 7A mounted labor-cost forecast', () => {
  let fixture;
  let app;
  let cutoff;
  let context;

  const actor = name => fixture.actors[name];

  async function serializable(sql, parameters) {
    const client = await fixture.ownerPool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const value = (await client.query(sql, parameters)).rows[0].value;
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  async function approveMemberProfile() {
    const member = actor('member');
    const owner = actor('owner');
    let current = await request(fixture.app).get('/api/work-profiles/me')
      .set(member.session.headers);
    expect(current.status).toBe(200);
    const submitted = await request(fixture.app).post('/api/work-profiles/me')
      .set(member.session.headers).set('Idempotency-Key', uuid()).send({
        action: 'submit', expectedRevision: current.body.data.profile.revision,
        profile: { title: 'Service technician', summary: 'Bounded fixture profile.',
          skills: ['Fixture repair'], certifications: [{ id: 'safety', name: 'Safety training',
            issuer: 'Fixture issuer', expiresOn: '2099-12-31', documentReference: 'CERT-7A' }] },
      });
    expect(submitted.status).toBe(200);
    current = await request(fixture.app).get('/api/work-profiles/me')
      .set(member.session.headers);
    const approved = await request(fixture.app)
      .post(`/api/work-profiles/reviews/${member.actorUserId}`)
      .set(owner.session.headers).set('Idempotency-Key', uuid()).send({
        action: 'approve', expectedRevision: current.body.data.profile.revision,
        reason: 'Owner verified the exact bounded technician fixture.',
        verifiedCertificationIds: ['safety'],
      });
    expect(approved.status).toBe(200);
  }

  async function declareAvailability() {
    const start = cutoff;
    const end = new Date(cutoff.getTime() + 31 * 86400000);
    const response = await request(fixture.app)
      .put(`/api/v1/canonical/availability/profiles/${actor('member').actorUserId}`)
      .set(actor('owner').session.headers).set('Idempotency-Key', uuid()).send({
        expectedRevision: 0, expectedDigest: null, expectedTimeZone: 'UTC',
        coverageStart: start.toISOString(), coverageEnd: end.toISOString(),
        intervals: [{ kind: 'available', start: start.toISOString(), end: end.toISOString() }],
        reason: 'Owner records bounded declared availability for the Part 7A fixture.',
      });
    expect(response.status).toBe(200);
  }

  async function seedReviewedLaborPlan() {
    const owner = actor('owner');
    const source = (await fixture.ownerPool.query(
      `SELECT a.operation_id,a.graph_id,a.opportunity_id,o.customer_id,t.id transcript_id
       FROM canonical_appointments a
       JOIN canonical_opportunities o ON o.organization_id=a.organization_id
        AND o.id=a.opportunity_id
       JOIN canonical_transcripts t ON t.organization_id=a.organization_id
        AND t.operation_id=a.operation_id
       WHERE a.organization_id=$1 AND a.id=$2`, [fixture.org, context.appointment])).rows[0];
    const estimateId = uuid(), decisionId = uuid(), planId = uuid();
    const fingerprint = hash(`p7a-estimate:${estimateId}`);
    const decisionDigest = hash(`p7a-decision:${decisionId}`);
    const planDigest = hash(`p7a-plan:${planId}`);
    await fixture.ownerPool.query(
      `INSERT INTO canonical_estimates(id,organization_id,operation_id,graph_id,opportunity_id,
       calculation_version,normalized_input_fingerprint,business_profile_version,
       business_profile_hash,currency,customer_price,line_items,calculation_output,snapshot_digest)
       VALUES($1,$2,$3,$4,$5,'m19-part3-canonical-v2',$6,'org-profile-v1',$6,
        'USD',500,'[]','{}',$6)`,
      [estimateId, fixture.org, source.operation_id, source.graph_id,
        source.opportunity_id, fingerprint]);
    await fixture.ownerPool.query(
      `INSERT INTO canonical_polaris_snapshots(id,organization_id,operation_id,graph_id,
       customer_id,transcript_id,opportunity_id,estimate_id,calculation_version,
       normalized_input_fingerprint,business_profile_version,business_profile_hash,
       supporting_fact_ids,snapshot,snapshot_digest)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,'m19-part3-canonical-v2',$9,
        'org-profile-v1',$9,'{}',$10,$9)`,
      [uuid(), fixture.org, source.operation_id, source.graph_id, source.customer_id,
        source.transcript_id, source.opportunity_id, estimateId, fingerprint,
        { service: { key: 'Plumbing' } }]);
    const sourcePins = (await fixture.ownerPool.query(
      'SELECT canonical_estimate_decision_source($1,$2) pins',
      [fixture.org, estimateId])).rows[0].pins;
    const evidence = { kind: 'company_reference', reference: 'rate-card-7a',
      note: 'Owner-reviewed bounded fixture rate.', effectiveOn: '2020-01-01',
      endsOn: '2099-12-31', geography: 'US' };
    const inputs = { serviceKey: 'Plumbing', lines: [{ lineId: uuid(),
      task: 'Bounded scheduled repair', basis: 'worker_hours', workerHours: '1',
      people: null, elapsedHours: null, quantity: null, unit: null, hoursPerUnit: null,
      rateMode: 'all_in', hourlyCost: '50.00', burdenPercent: null,
      quantitySource: evidence, rateSource: evidence }],
    assessment: { date: '2026-10-06', cautions: [], acknowledged: true,
      explanation: 'Owner reviewed the bounded fixture assumptions.' } };
    await fixture.ownerPool.query(
      `INSERT INTO canonical_estimate_decisions(id,organization_id,estimate_id,revision,
       previous_id,action,actor_user_id,membership_id,auth_session_id,actor_name,
       source_pins,scope_summary,price_before_tax,currency,reason,confirmation_version,
       request_key_hash,request_digest,digest)
       VALUES($1,$2,$3,1,NULL,'approve',$4,$4,$5,'Synthetic owner',$6,
        'Bounded Part 7A source','500.00','USD','Synthetic mounted approval',
        'estimate-quote-preparation-v1',$7,$8,$9)`,
      [decisionId, fixture.org, estimateId, owner.actorUserId, owner.authSessionId,
        sourcePins, hash(uuid()), hash(uuid()), decisionDigest]);
    await fixture.ownerPool.query(
      `INSERT INTO canonical_labor_plans(id,organization_id,estimate_id,revision,previous_id,
       action,actor_user_id,membership_id,auth_session_id,actor_name,source_pins,inputs,
       expected_decision_revision,expected_decision_digest,currency,reason,
       confirmation_version,request_key_hash,request_digest,digest)
       VALUES($1,$2,$3,1,NULL,'save',$4,$4,$5,'Synthetic owner',$6,$7,1,$8,'USD',
        'Synthetic bounded labor review','estimate-labor-plan-v1',$9,$10,$11)`,
      [planId, fixture.org, estimateId, owner.actorUserId, owner.authSessionId,
        sourcePins, inputs, decisionDigest, hash(uuid()), hash(uuid()), planDigest]);
    const created = await request(fixture.app)
      .post(`/api/v1/forecast/current-backlog/person-plan-sources/${context.appointment}/reviews`)
      .set(owner.session.headers).set('Idempotency-Key', uuid()).send({
        action: 'approve', expectedCurrentReviewId: null, expectedCurrentReviewDigest: 'none',
        assignmentId: context.assignment.id,
        expectedAssignmentRevision: Number(context.assignment.revision),
        expectedAssignmentDigest: context.assignment.digest, estimateId, laborPlanId: planId,
        expectedLaborPlanRevision: 1, expectedLaborPlanDigest: planDigest,
        reason: 'Owner reviewed this exact bounded booking and labor plan.',
        confirmed: true, confirmationVersion: 'm26-current-backlog-person-plan-v1',
      });
    if (created.status !== 201) {
      throw new Error(`Person-plan review failed: ${created.status} ${JSON.stringify(created.body)}`);
    }
    return { planId };
  }

  async function refreshScheduleAfterAvailability() {
    const owner = actor('owner');
    const before = (await fixture.ownerPool.query(
      `SELECT revision,rtrim(canonical_digest) digest,appointment_status,
       workforce_profile_id,scheduled_start,scheduled_end
       FROM canonical_schedule_assignments WHERE organization_id=$1 AND id=$2`,
      [fixture.org, context.assignment.id])).rows[0];
    const body = { expectedRevision: Number(before.revision), expectedDigest: before.digest,
      expectedTimeZone: 'UTC', action: 'reschedule',
      target: { kind: 'profile', id: before.workforce_profile_id },
      scheduledStart: new Date(before.scheduled_start.getTime() + 60000).toISOString(),
      scheduledEnd: new Date(before.scheduled_end.getTime() + 60000).toISOString(),
      appointmentStatus: before.appointment_status,
      reason: 'Refresh the bounded schedule against the declared availability source.' };
    const preview = await request(fixture.app)
      .post(`/api/v1/canonical/appointments/${context.appointment}/mutation-previews`)
      .set(owner.session.headers).send(body);
    if (preview.status !== 201) {
      throw new Error(`Schedule refresh preview failed: ${preview.status} ${JSON.stringify(preview.body)}`);
    }
    const approval = await request(fixture.app)
      .post(`/api/v1/canonical/appointments/${context.appointment}/mutation-approvals`)
      .set(owner.session.headers).set('Idempotency-Key', uuid()).send({
        previewId: preview.body.data.id, previewDigest: preview.body.data.previewDigest,
        acknowledgedWarningDigests: preview.body.data.warningDigests,
        acknowledgedReviewReasonDigests: preview.body.data.reviewReasonDigests,
        reason: body.reason,
      });
    expect(approval.status).toBe(200);
    context.assignment = (await fixture.ownerPool.query(
      `SELECT id,revision,rtrim(canonical_digest) digest
       FROM canonical_schedule_assignments WHERE organization_id=$1 AND id=$2`,
      [fixture.org, context.assignment.id])).rows[0];
  }

  async function installCapacityAuthority() {
    const owner = actor('owner');
    await serializable(
      `SELECT canonical_forecast_workload_capacity_v1_epoch_capture(
       $1,$2,$3,$4,$5,$6,$7,$8) value`,
      [fixture.org, owner.actorUserId, owner.actorAccessRole, owner.authSessionId,
        owner.csrfToken, `m26-p7a-epoch-${uuid()}`,
        'Begin the exact prospective Part 7A capacity coverage boundary.',
        'm26-workload-capacity-epoch-v1']);
    for (const [kind, subject, role] of [
      ['role_qualification', owner.actorUserId, 'owner'],
      ['role_qualification', actor('member').actorUserId, 'technician'],
      ['availability_basis', actor('member').actorUserId, null],
      ['capacity_role_scope', null, 'technician'],
    ]) {
      await serializable(
        `SELECT canonical_forecast_workload_capacity_v1_review_mutate(
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'approve',0,'none',NULL,$11,$12) value`,
        [fixture.org, owner.actorUserId, owner.actorAccessRole, owner.authSessionId,
          owner.csrfToken, `m26-p7a-review-${uuid()}`, kind, CAPACITY_TARGET,
          subject, role, 'Owner approves the exact bounded Part 7A source authority.',
          'm26-workload-capacity-review-v1']);
    }
  }

  beforeAll(async () => {
    fixture = await createDatabaseFixture({ operationalSchedule: true });
    await fixture.ownerPool.query(
      "SET northstar.m26_part5a_disposable_clock='enabled'");
    cutoff = new Date((await fixture.ownerPool.query(
      "SELECT date_trunc('second',clock_timestamp()) value")).rows[0].value);
    await fixture.ownerPool.query(
      'SELECT canonical_forecast_workload_capacity_v1_test_clock_set($1)', [cutoff]);
    context = await fixture.createExecution({ approvedScheduling: true,
      stopAfterScheduling: true, start: new Date(cutoff.getTime() + 86400000) });
    await approveMemberProfile();
    await declareAvailability();
    await refreshScheduleAfterAvailability();
    await seedReviewedLaborPlan();
    await fixture.ownerPool.query(
      `UPDATE organization_memberships SET status='suspended'
       WHERE organization_id=$1 AND id=ANY($2::uuid[])`,
      [fixture.org, [actor('admin').actorUserId, actor('dispatcher').actorUserId,
        actor('viewer').actorUserId]]);
    await installCapacityAuthority();
    try {
      await fixture.ownerPool.query(
        'SELECT canonical_forecast_workload_capacity_v1_capacity_evidence($1,$2,$3,$2)',
        [fixture.org, cutoff, new Date(cutoff.getTime() + 30 * 86400000)]);
    } catch (error) {
      const revisions = (await fixture.ownerPool.query(
        `SELECT assignment_id,revision,target_state,schedule_state,dispatch_state,
         workforce_profile_id,workforce_crew_id,needs_review,review_reasons,
         scheduled_start,scheduled_end,approval_id,human_approval_id
         FROM canonical_schedule_assignment_revisions WHERE organization_id=$1
         ORDER BY assignment_id,revision`, [fixture.org])).rows;
      throw new Error(`${error.message}: ${JSON.stringify(revisions)}`);
    }
    app = express(); app.use(express.json());
    const bypass = (_req, _res, next) => next();
    const auth = (req, _res, next) => {
      const selected = actor(req.get('X-Test-Actor') || 'owner');
      req.tenantContext = { organizationId: selected.organizationId,
        userId: selected.actorUserId };
      req.userRole = selected.actorAccessRole;
      req.authSession = { id: selected.authSessionId };
      next();
    };
    app.use('/api/v1/forecast/labor-cost', createForecastLaborCostRouter({
      poolProvider: () => fixture.runtimePool, auth,
      permission: bypass, throttle: bypass,
    }));
  }, 120000);

  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  test('issues one bounded current forecast from exact rate, plan, capacity and learned-state sources', async () => {
    const response = await request(app).get('/api/v1/forecast/labor-cost/current')
      .set('X-Test-Actor', 'owner');
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      state: 'current', currency: 'USD', fictional: false,
      work: { state: 'current', scheduledCount: 1, unscheduledCount: 0,
        outsideWindowCount: 0 },
      plannedLabor: { state: 'current', coveredCount: 1,
        personHours: '1.000000', cost: '50.00', reason: null },
      rateAuthority: { state: 'current', payrollVerified: false },
      capacity: { state: 'declared_role_capacity_verified', declaredRole: 'technician',
        realizedAttendanceVerified: false,
        jobSpecificConstraintCompositionAvailable: false },
      learnedOutcomes: { state: 'none_current', applicableServiceCount: 0,
        applied: false },
      forecastIssued: true, calibratedRangeIssued: false,
      probabilityIssued: false, automaticActionAuthorized: false,
    });
  });

  test('fails closed when an applicable learned multiplier cannot be proven compatible', async () => {
    const sourceRegistryId = uuid();
    const databaseUrl = new URL(process.env.DATABASE_URL);
    databaseUrl.username = 'postgres'; databaseUrl.password = '';
    const admin = new Client({ connectionString: databaseUrl.toString() });
    await admin.connect();
    try {
      const effectiveDigest = (await admin.query(
        `SELECT canonical_completion_digest(jsonb_build_object(
         'state','active','multiplier','1.100000','sourceRegistryId',$1::uuid,
         'sourceRegistryDigest',$2::text,'sourcePreviewDigest',$3::text,
         'sourceSelectionDigest',$4::text)) digest`,
        [sourceRegistryId, 'a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)])).rows[0].digest;
      await admin.query("SET session_replication_role='replica'");
      await admin.query(
        `INSERT INTO canonical_job_outcome_planning_value_versions(
         id,organization_id,service_key,planning_area,metric_key,basis,revision,
         previous_id,action,value_state,multiplier,source_registry_id,
         source_registry_digest,source_preview_digest,source_selection_digest,
         rollback_to_id,rollback_to_digest,effective_digest,actor_user_id,membership_id,
         auth_session_id,reason,confirmed,confirmation_version,request_key_hash,
         request_digest,canonical_digest)
         VALUES($1,$2,'plumbing','labor_planning','worker_hours','NorthStar worker hours',
          1,NULL,'adopt','active',1.1,$3,$4,$5,$6,NULL,NULL,$7,$8,$8,$9,
          'Bounded learned fixture value',TRUE,'m25-job-outcome-planning-adoption-v1',
          $10,$11,$12)`,
        [uuid(), fixture.org, sourceRegistryId, 'a'.repeat(64), 'b'.repeat(64),
          'c'.repeat(64), effectiveDigest, actor('owner').actorUserId,
          actor('owner').authSessionId, hash(uuid()), hash(uuid()), hash(uuid())]);
    } finally {
      await admin.query("SET session_replication_role='origin'").catch(() => {});
      await admin.end();
    }
    const response = await request(app).get('/api/v1/forecast/labor-cost/current')
      .set('X-Test-Actor', 'owner');
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ state: 'unavailable',
      reason: 'learned_adjustment_compatibility_unverified',
      forecastIssued: false, probabilityIssued: false });
  });

  test('keeps tenant and access-role boundaries server-side', async () => {
    const forbidden = await request(app).get('/api/v1/forecast/labor-cost/current')
      .set('X-Test-Actor', 'member');
    expect(forbidden.status).toBe(403);
    const otherTenant = await request(app).get('/api/v1/forecast/labor-cost/current')
      .set('X-Test-Actor', 'otherOwner');
    expect(otherTenant.status).toBe(200);
    expect(otherTenant.body.data).toMatchObject({ state: 'unavailable',
      reason: 'declared_capacity_evidence_unavailable', forecastIssued: false });
  });
});
