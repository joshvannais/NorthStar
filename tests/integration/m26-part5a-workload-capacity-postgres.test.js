'use strict';

const crypto = require('node:crypto');
const express = require('express');
const request = require('supertest');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const { normalizeLaborAction } = require('../../src/operations/contract');
const operations = require('../../src/operations/repository');
const { createForecastWorkloadCapacityRouter } = require('../../src/routes/forecastWorkloadCapacity');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const uuid = () => crypto.randomUUID();
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const pin = value => ({ id: value.id, revision: Number(value.revision), digest: value.digest });
const TARGETS = [
  'workload.accepted_person_hours.v1',
  'workload.end_backlog_hours.v1',
  'capacity.available_role_hours.v1',
];
const LABOR_CATEGORY_VERSION = 'm23-labor-category-v1';
const LABOR_CATEGORY_DIGEST = '298ead37057f362ae32de59f23cfda8e9cae8f78dd0cd1e9c637cc525bc27738';
const ORIGIN_BODY = { reason: 'Authorize exact server-selected training receipts and a future research origin.',
  confirmed: true, confirmationVersion: 'm26-workload-capacity-origin-v1' };

realPostgres('Mission 26 Part 5A workload and base-capacity research lifecycle', () => {
  let fixture;
  let part5aApp;
  let executionContext;
  let backlogContext;
  let unscheduledBacklogContext;
  let boundaryBacklogContext;
  let correctionContext;
  let negativeBacklogContext;
  let boundLaborContext;
  let capacityZeroContext;
  let historicalApproval;
  let epochStart;
  let availabilityReviewRequest;
  let availabilityReviewKey;
  const roleQualificationReviews = {};
  const endpoint = '/api/v1/forecast/workload-capacity';

  const actor = name => fixture.actors[name];
  const post = (path, body, key = `m26-p5a-${uuid()}`, name = 'owner') => request(part5aApp)
    .post(endpoint + path).set('X-Test-Actor', name).set('X-CSRF-Token', actor(name).csrfToken)
    .set('Idempotency-Key', key).send(body);
  const get = (path, name = 'owner') => request(part5aApp).get(endpoint + path)
    .set('X-Test-Actor', name);
  const setClock = async value => {
    await fixture.ownerPool.query("SET northstar.m26_part5a_disposable_clock='enabled'");
    await fixture.ownerPool.query('SELECT canonical_forecast_workload_capacity_v1_test_clock_set($1)', [value]);
  };
  const at = days => new Date(epochStart.getTime() + days * 86400000);
  const availableIntervals = (start, end) => {
    const intervals = [];
    for (let cursor = start.getTime(); cursor < end.getTime();) {
      const next = Math.min(end.getTime(), cursor + 30 * 86400000);
      intervals.push({ kind: 'available', start: new Date(cursor).toISOString(),
        end: new Date(next).toISOString() });
      cursor = next;
    }
    return intervals;
  };
  const waitForBackendLock = async backendPid => {
    for (let attempt = 0; attempt < 150; attempt += 1) {
      const waiting = await fixture.ownerPool.query(
        'SELECT 1 FROM pg_locks WHERE pid=$1 AND NOT granted LIMIT 1', [backendPid]);
      if (waiting.rowCount === 1) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    const state = (await fixture.ownerPool.query(
      'SELECT locktype,mode,granted FROM pg_locks WHERE pid=$1 ORDER BY granted,locktype,mode', [backendPid])).rows;
    throw new Error(`Expected PostgreSQL lock wait for backend ${backendPid}: ${JSON.stringify(state)}`);
  };

  async function approveWorkProfile(name = 'member') {
    const member = actor(name);
    const reviewer = actor(name === 'owner' ? 'admin' : 'owner');
    let current = await request(fixture.app).get('/api/work-profiles/me').set(member.session.headers);
    expect(current.status).toBe(200);
    const submitted = await request(fixture.app).post('/api/work-profiles/me')
      .set(member.session.headers).set('Idempotency-Key', uuid()).send({
        action: 'submit', expectedRevision: current.body.data.profile.revision,
        profile: { title: 'Service technician', summary: 'Residential repair and clear handovers.',
          skills: ['Fixture repair', 'Site preparation'], certifications: [{ id: 'safety', name: 'Safety training',
            issuer: 'Example Training', expiresOn: '2099-09-09', documentReference: 'CERT-014' }] },
      });
    if (submitted.status !== 200) throw new Error(`Profile submit failed from ${JSON.stringify(current.body.data)}: ${JSON.stringify(submitted.body)}`);
    current = await request(fixture.app).get('/api/work-profiles/me').set(member.session.headers);
    const approved = await request(fixture.app).post(`/api/work-profiles/reviews/${member.actorUserId}`)
      .set(reviewer.session.headers).set('Idempotency-Key', uuid()).send({
        action: 'approve', expectedRevision: current.body.data.profile.revision,
        reason: 'Owner checked the exact synthetic trade record.', verifiedCertificationIds: ['safety'],
      });
    expect(approved.status).toBe(200);
  }

  async function submitWorkProfile(name = 'member', certificationId = 'safety') {
    const member = actor(name);
    const current = await request(fixture.app).get('/api/work-profiles/me').set(member.session.headers);
    expect(current.status).toBe(200);
    const submitted = await request(fixture.app).post('/api/work-profiles/me')
      .set(member.session.headers).set('Idempotency-Key', uuid()).send({
        action: 'submit', expectedRevision: current.body.data.profile.revision,
        profile: { title: 'Service technician', summary: 'Residential repair and clear handovers.',
          skills: ['Fixture repair', 'Site preparation'], certifications: [{ id: certificationId,
            name: `Safety training ${certificationId}`, issuer: 'Example Training', expiresOn: '2099-09-09',
            documentReference: `CERT-${certificationId}` }] },
      });
    expect(submitted.status).toBe(200);
    return submitted.body.data;
  }

  async function decideWorkProfile(name, action, verifiedCertificationIds = undefined, client = request(fixture.app)) {
    const member = actor(name); const reviewer = actor(name === 'owner' ? 'admin' : 'owner');
    const current = await request(fixture.app).get('/api/work-profiles/me').set(member.session.headers);
    expect(current.status).toBe(200);
    const body = { action, expectedRevision: current.body.data.profile.revision,
      reason: `Owner records the exact ${action} decision for mounted qualification chronology.` };
    if (action === 'approve') body.verifiedCertificationIds = verifiedCertificationIds;
    const decided = await client.post(`/api/work-profiles/reviews/${member.actorUserId}`)
      .set(reviewer.session.headers).set('Idempotency-Key', uuid()).send(body);
    expect(decided.status).toBe(200);
    return decided.body.data;
  }

  async function declareAvailability(start, end, name = 'member') {
    const intervals = availableIntervals(start, end);
    const response = await request(fixture.app)
      .put(`/api/v1/canonical/availability/profiles/${actor(name).actorUserId}`)
      .set(actor('owner').session.headers).set('Idempotency-Key', `m26-p5a-availability-${uuid()}`)
      .send({ expectedRevision: 0, expectedDigest: null, expectedTimeZone: 'UTC',
        coverageStart: start.toISOString(), coverageEnd: end.toISOString(),
        intervals,
        reason: 'Owner recorded the bounded declared availability used by this research run.' });
    expect(response.status).toBe(200);
  }

  async function replaceAvailability(start, end, intervals) {
    const current = (await fixture.ownerPool.query(
      `SELECT authority.id,revision.revision,rtrim(revision.canonical_digest) digest
         FROM canonical_workforce_availability_authorities authority
         JOIN LATERAL (SELECT value.* FROM canonical_workforce_availability_revisions value
           WHERE value.organization_id=authority.organization_id
            AND value.availability_id=authority.id ORDER BY value.revision DESC LIMIT 1) revision ON TRUE
        WHERE authority.organization_id=$1 AND authority.workforce_profile_id=$2`,
      [fixture.org, actor('member').actorUserId])).rows[0];
    const response = await request(fixture.app)
      .put(`/api/v1/canonical/availability/profiles/${actor('member').actorUserId}`)
      .set(actor('owner').session.headers).set('Idempotency-Key', `m26-p5a-availability-${uuid()}`)
      .send({ expectedRevision: Number(current.revision), expectedDigest: current.digest,
        expectedTimeZone: 'UTC', coverageStart: start.toISOString(), coverageEnd: end.toISOString(),
        intervals, reason: 'Owner revised the bounded declared availability for exact zero-capacity evidence.' });
    expect(response.status).toBe(200);
  }

  async function approvePersonPlan(context) {
    const owner = actor('owner');
    const source = (await fixture.ownerPool.query(
      `SELECT a.operation_id,a.graph_id,a.opportunity_id,o.customer_id,t.id transcript_id
       FROM canonical_appointments a JOIN canonical_opportunities o
        ON o.organization_id=a.organization_id AND o.id=a.opportunity_id
       JOIN canonical_transcripts t ON t.organization_id=a.organization_id AND t.operation_id=a.operation_id
       WHERE a.organization_id=$1 AND a.id=$2`, [fixture.org, context.appointment])).rows[0];
    const estimateId = uuid(), decisionId = uuid(), planId = uuid();
    const fingerprint = hash(`p5a-estimate:${estimateId}`), decisionDigest = hash(`p5a-decision:${decisionId}`);
    const planDigest = hash(`p5a-plan:${planId}`);
    await fixture.ownerPool.query(
      `INSERT INTO canonical_estimates(id,organization_id,operation_id,graph_id,opportunity_id,
       calculation_version,normalized_input_fingerprint,business_profile_version,business_profile_hash,
       currency,customer_price,line_items,calculation_output,snapshot_digest)
       VALUES($1,$2,$3,$4,$5,'m19-part3-canonical-v2',$6,'org-profile-v1',$6,'USD',500,'[]','{}',$6)`,
      [estimateId, fixture.org, source.operation_id, source.graph_id, source.opportunity_id, fingerprint]);
    await fixture.ownerPool.query(
      `INSERT INTO canonical_polaris_snapshots(id,organization_id,operation_id,graph_id,customer_id,
       transcript_id,opportunity_id,estimate_id,calculation_version,normalized_input_fingerprint,
       business_profile_version,business_profile_hash,supporting_fact_ids,snapshot,snapshot_digest)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,'m19-part3-canonical-v2',$9,'org-profile-v1',$9,'{}',$10,$9)`,
      [uuid(), fixture.org, source.operation_id, source.graph_id, source.customer_id,
        source.transcript_id, source.opportunity_id, estimateId, fingerprint,
        { service: { key: 'Plumbing' } }]);
    const sourcePins = (await fixture.ownerPool.query('SELECT canonical_estimate_decision_source($1,$2) pins',
      [fixture.org, estimateId])).rows[0].pins;
    const sourceEvidence = { kind: 'my_estimate', reference: '', note: 'Synthetic reviewed source',
      effectiveOn: null, endsOn: null, geography: '' };
    const inputs = { serviceKey: 'Plumbing', lines: [{ lineId: uuid(), task: 'Bounded workload plan',
      basis: 'worker_hours', workerHours: '4', people: null, elapsedHours: null,
      quantity: null, unit: null, hoursPerUnit: null, rateMode: 'all_in', hourlyCost: '50.00',
      burdenPercent: null, quantitySource: sourceEvidence, rateSource: sourceEvidence }],
      assessment: { date: '2026-10-01', cautions: [], acknowledged: true,
        explanation: 'Synthetic bounded source review.' } };
    await fixture.ownerPool.query(
      `INSERT INTO canonical_estimate_decisions(id,organization_id,estimate_id,revision,previous_id,
       action,actor_user_id,membership_id,auth_session_id,actor_name,source_pins,scope_summary,
       price_before_tax,currency,reason,confirmation_version,request_key_hash,request_digest,digest)
       VALUES($1,$2,$3,1,NULL,'approve',$4,$4,$5,'Synthetic owner',$6,'Bounded Part5A source',
       '500.00','USD','Synthetic mounted approval','estimate-quote-preparation-v1',$7,$8,$9)`,
      [decisionId, fixture.org, estimateId, owner.actorUserId, owner.authSessionId, sourcePins,
        hash(uuid()), hash(uuid()), decisionDigest]);
    await fixture.ownerPool.query(
      `INSERT INTO canonical_labor_plans(id,organization_id,estimate_id,revision,previous_id,action,
       actor_user_id,membership_id,auth_session_id,actor_name,source_pins,inputs,
       expected_decision_revision,expected_decision_digest,currency,reason,confirmation_version,
       request_key_hash,request_digest,digest)
       VALUES($1,$2,$3,1,NULL,'save',$4,$4,$5,'Synthetic owner',$6,$7,1,$8,'USD',
       'Synthetic bounded labor review','estimate-labor-plan-v1',$9,$10,$11)`,
      [planId, fixture.org, estimateId, owner.actorUserId, owner.authSessionId, sourcePins,
        inputs, decisionDigest, hash(uuid()), hash(uuid()), planDigest]);
    const created = await request(fixture.app)
      .post(`/api/v1/forecast/current-backlog/person-plan-sources/${context.appointment}/reviews`)
      .set(owner.session.headers).set('Idempotency-Key', `m26-p5a-person-plan-${uuid()}`).send({
        action: 'approve', expectedCurrentReviewId: null, expectedCurrentReviewDigest: 'none',
        assignmentId: context.assignment.id, expectedAssignmentRevision: Number(context.assignment.revision),
        expectedAssignmentDigest: context.assignment.digest, estimateId, laborPlanId: planId,
        expectedLaborPlanRevision: 1, expectedLaborPlanDigest: planDigest,
        reason: 'Owner reviewed this exact bounded booking and labor plan.', confirmed: true,
        confirmationVersion: 'm26-current-backlog-person-plan-v1' });
    expect(created.status).toBe(201);
    context.plan = { estimateId, decisionId, decisionDigest, planId, planDigest, sourcePins };
  }

  async function explicitlyUnschedule(context) {
    const clock = (await fixture.ownerPool.query(
      'SELECT instant_value FROM canonical_forecast_workload_capacity_test_clock_v1 WHERE singleton')).rows[0];
    const priorApprovals = (await fixture.ownerPool.query(
      `SELECT id,approved_at FROM canonical_schedule_approvals
        WHERE organization_id=$1 AND assignment_id=$2 ORDER BY id`,
      [fixture.org, context.assignment.id])).rows;
    const wallBefore = Date.now();
    const before = (await fixture.ownerPool.query(
      `SELECT revision,rtrim(canonical_digest) digest,workforce_profile_id
         FROM canonical_schedule_assignments WHERE organization_id=$1 AND id=$2`,
      [fixture.org, context.assignment.id])).rows[0];
    if (before.workforce_profile_id) context.originalWorkforceProfileId = before.workforce_profile_id;
    const key = `m26-p5a-unschedule-${uuid()}`;
    const body = {
      expectedRevision: Number(before.revision), expectedDigest: before.digest,
      reason: 'Explicitly return this accepted assignment to the unscheduled workload queue.',
      confirmed: true, confirmationVersion: 'm26-workload-capacity-unschedule-v1',
    };
    const response = await post(`/backlog-items/${context.appointment}/unschedule`, body, key);
    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ appointmentId: context.appointment,
      scheduleState: 'unscheduled', replayed: false, researchOnly: true,
      forecastIssued: false, automaticActionTaken: false });
    const replay = await post(`/backlog-items/${context.appointment}/unschedule`, body, key);
    expect(replay.status).toBe(200);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body.data).toMatchObject({ assignmentId: response.body.data.assignmentId,
      assignmentRevision: response.body.data.assignmentRevision,
      assignmentDigest: response.body.data.assignmentDigest, replayed: true });
    const approval = (await fixture.ownerPool.query(
      `SELECT approved_at FROM canonical_schedule_approvals
        WHERE organization_id=$1 AND assignment_id=$2 AND applied_revision=$3`,
      [fixture.org, response.body.data.assignmentId,
        response.body.data.assignmentRevision])).rows[0];
    if (clock) expect(new Date(approval.approved_at).toISOString()).toBe(new Date(clock.instant_value).toISOString());
    else {
      expect(new Date(approval.approved_at).getTime()).toBeGreaterThanOrEqual(wallBefore);
      expect(new Date(approval.approved_at).getTime()).toBeLessThanOrEqual(Date.now());
    }
    expect((await fixture.ownerPool.query(
      `SELECT id,approved_at FROM canonical_schedule_approvals
        WHERE organization_id=$1 AND assignment_id=$2 AND id=ANY($3::uuid[]) ORDER BY id`,
      [fixture.org, context.assignment.id, priorApprovals.map(value => value.id)])).rows)
      .toEqual(priorApprovals);
    context.assignment = (await fixture.ownerPool.query(
      `SELECT id,revision,rtrim(canonical_digest) digest,schedule_state
         FROM canonical_schedule_assignments WHERE organization_id=$1 AND id=$2`,
      [fixture.org, context.assignment.id])).rows[0];
    expect(context.assignment.schedule_state).toBe('unscheduled');
  }

  async function mutateEstimateDecision(context, client, label, action = 'approve') {
    const owner = actor('owner');
    const current = (await fixture.ownerPool.query(
      `SELECT revision,rtrim(digest) digest FROM canonical_estimate_decisions
        WHERE organization_id=$1 AND estimate_id=$2 ORDER BY revision DESC LIMIT 1`,
      [fixture.org, context.plan.estimateId])).rows[0];
    return (await client.query(
      `SELECT canonical_estimate_decision_mutate($1,$2,$3,$4,$5,$6,$7,$8) value`,
      [fixture.org, owner.actorUserId, owner.actorAccessRole, owner.authSessionId,
        context.plan.estimateId, owner.csrfToken, `m26-p5a-m24-${label}-${uuid()}`,
        { action, expectedRevision: Number(current.revision), expectedDigest: current.digest,
          sourcePins: context.plan.sourcePins,
          scopeSummary: action === 'withdraw' ? null : `Mounted ${label} M24 source correction`,
          priceBeforeTax: action === 'withdraw' ? null : '500.00', currency: 'USD',
          reason: `Mounted ${label} correction to the exact M24 decision source.`, confirmed: true,
          confirmationVersion: 'estimate-quote-preparation-v1' }])).rows[0].value;
  }

  async function approveScheduleAction(context, action, scheduledStart = undefined, scheduledEnd = undefined) {
    const owner = actor('owner');
    const before = (await fixture.ownerPool.query(
      `SELECT revision,rtrim(canonical_digest) digest,appointment_status,
              workforce_profile_id,scheduled_start,scheduled_end
         FROM canonical_schedule_assignments
        WHERE organization_id=$1 AND id=$2`, [fixture.org, context.assignment.id])).rows[0];
    if (before.workforce_profile_id) context.originalWorkforceProfileId = before.workforce_profile_id;
    const body = { expectedRevision: Number(before.revision), expectedDigest: before.digest,
      expectedTimeZone: 'UTC', action,
      target: action === 'unassign' ? { kind: 'unassigned', id: null } :
        { kind: 'profile', id: before.workforce_profile_id || context.originalWorkforceProfileId },
      scheduledStart: scheduledStart === undefined ? before.scheduled_start.toISOString() : scheduledStart,
      scheduledEnd: scheduledEnd === undefined ? before.scheduled_end.toISOString() : scheduledEnd,
      appointmentStatus: before.appointment_status,
      reason: `Explicitly approve the ${action} transition for bounded outcome evidence.` };
    const preview = await request(fixture.app)
      .post(`/api/v1/canonical/appointments/${context.appointment}/mutation-previews`)
      .set(owner.session.headers).send(body);
    if (preview.status !== 201) throw new Error(`${action} preview failed: ${JSON.stringify(preview.body)}`);
    const approval = await request(fixture.app)
      .post(`/api/v1/canonical/appointments/${context.appointment}/mutation-approvals`)
      .set(owner.session.headers).set('Idempotency-Key', `m26-p5a-${action}-${uuid()}`)
      .send({ previewId: preview.body.data.id, previewDigest: preview.body.data.previewDigest,
        acknowledgedWarningDigests: preview.body.data.warningDigests,
        acknowledgedReviewReasonDigests: preview.body.data.reviewReasonDigests,
        reason: body.reason });
    if (approval.status !== 200) throw new Error(`${action} approval failed: ${JSON.stringify(approval.body)}`);
    context.assignment = (await fixture.ownerPool.query(
      `SELECT id,revision,rtrim(canonical_digest) digest,schedule_state
         FROM canonical_schedule_assignments WHERE organization_id=$1 AND id=$2`,
      [fixture.org, context.assignment.id])).rows[0];
  }

  async function startExecution(context) {
    const owner = actor('owner');
    let execution = (await operations.initializeFieldExecution(fixture.runtimePool, {
      ...owner, appointmentId: context.appointment,
      expectedAssignmentRevision: Number(context.assignment.revision),
      expectedAssignmentDigest: context.assignment.digest, idempotencyKey: uuid(),
      reason: 'Initialize the exact bounded backlog outcome work.',
      requestCorrelationId: `p5a-init-${uuid()}` })).body.data;
    execution = (await operations.transitionFieldExecution(fixture.runtimePool, {
      ...owner, executionId: execution.id, expectedRevision: execution.revision,
      expectedDigest: execution.digest,
      expectedAssignmentRevision: Number(context.assignment.revision),
      expectedAssignmentDigest: context.assignment.digest, action: 'start',
      idempotencyKey: uuid(), reason: 'Start the exact bounded backlog outcome work.',
      requestCorrelationId: `p5a-start-${uuid()}` })).body.data;
    context.execution = execution;
    context.actor = owner;
  }

  async function review(body, key = `m26-p5a-review-${uuid()}`) {
    const payload = { subjectId: null, role: null,
      action: 'approve', expectedRevision: 0, expectedDigest: 'none',
      remainingPersonMinutes: null, reason: 'Owner explicitly approved this bounded research definition.',
      confirmed: true, confirmationVersion: 'm26-workload-capacity-review-v1', ...body };
    const response = await post('/reviews', payload, key);
    if (response.status !== 201) {
      let source;
      try { source = (await fixture.ownerPool.query(
        'SELECT canonical_forecast_workload_capacity_v1_review_source($1,$2,$3,$4,$5) source',
        [fixture.org, payload.kind, payload.target, payload.subjectId, payload.role])).rows[0].source; }
      catch (error) { source = { error: JSON.stringify(error, Object.getOwnPropertyNames(error)),
        assignments: (await fixture.ownerPool.query(`SELECT id,appointment_id,revision,needs_review,
          target_state,schedule_state,dispatch_state FROM canonical_schedule_assignments
          WHERE organization_id=$1`, [fixture.org])).rows,
        plans: (await fixture.ownerPool.query(`SELECT appointment_id,assignment_id,action,revision
          FROM canonical_forecast_current_backlog_person_plan_reviews WHERE organization_id=$1`, [fixture.org])).rows }; }
      throw new Error(`Review failed for ${payload.kind}: ${JSON.stringify(response.body)} source=${JSON.stringify(source)}`);
    }
    return { ...response.body.data, request: payload, key };
  }

  async function refreshReview(kind, target, subjectId, role) {
    const token = await get(`/reviews/current?kind=${kind}&target=${encodeURIComponent(target)}` +
      `&subjectId=${subjectId || 'none'}&role=${role || 'none'}`);
    expect(token.status).toBe(200);
    expect(token.body.data.sourceCurrent).toBe(false);
    return review({ kind, target, subjectId, role,
      expectedRevision: token.body.data.expectedRevision,
      expectedDigest: token.body.data.expectedDigest });
  }

  async function recordAcceptedLabor(context, observedStart, observedEnd) {
    const member = actor('member');
    const profile = fixture.profiles[fixture.org];
    const input = normalizeLaborAction({ organizationId: fixture.org,
      actorUserId: member.actorUserId, actorAccessRole: member.actorAccessRole,
      authSessionId: member.authSessionId, executionId: context.execution.id,
      idempotencyKey: `m26-p5a-labor-${uuid()}`, body: {
        action: 'record_manual', performerProfileId: member.actorUserId, category: 'production',
        categoryContractVersion: LABOR_CATEGORY_VERSION, categoryContractDigest: LABOR_CATEGORY_DIGEST,
        expectedExecutionRevision: context.execution.revision,
        expectedExecutionDigest: context.execution.digest,
        expectedAssignmentRevision: Number(context.assignment.revision),
        expectedAssignmentDigest: context.assignment.digest,
        businessProfileId: profile.businessProfileId, businessProfileVersion: profile.version,
        businessProfileHash: profile.hash, timeZone: profile.timeZone,
        observedStart: observedStart.toISOString(), observedEnd: observedEnd.toISOString(),
        reason: 'Record source-authenticated bounded work time for the research window.',
      } });
    const recorded = (await operations.mutateLaborTime(fixture.runtimePool, {
      ...input, csrfToken: member.csrfToken, requestCorrelationId: `p5a-labor-${uuid()}`,
    })).body.data;
    const reviewInput = normalizeLaborAction({ organizationId: fixture.org,
      actorUserId: member.actorUserId, actorAccessRole: member.actorAccessRole,
      authSessionId: member.authSessionId, executionId: context.execution.id,
      idempotencyKey: `m26-p5a-labor-review-${uuid()}`, body: {
        action: 'review', performerProfileId: member.actorUserId,
        categoryContractVersion: LABOR_CATEGORY_VERSION, categoryContractDigest: LABOR_CATEGORY_DIGEST,
        expectedExecutionRevision: context.execution.revision,
        expectedExecutionDigest: context.execution.digest,
        expectedAssignmentRevision: Number(context.assignment.revision),
        expectedAssignmentDigest: context.assignment.digest,
        businessProfileId: profile.businessProfileId, businessProfileVersion: profile.version,
        businessProfileHash: profile.hash, timeZone: profile.timeZone,
        intervalId: recorded.id, expectedIntervalRevision: recorded.revision,
        expectedIntervalDigest: recorded.digest, reviewOutcome: 'accepted',
        reason: 'Accept the exact closed non-overlapping work interval.',
      } });
    const accepted = (await operations.mutateLaborTime(fixture.runtimePool, {
      ...reviewInput, csrfToken: member.csrfToken, requestCorrelationId: `p5a-labor-review-${uuid()}`,
    })).body.data;
    expect(accepted.reviewState).toBe('accepted');
  }

  async function completeExecution(context) {
    const proposed = await fixture.completion(context, 'propose_completion', {
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      gateRequirements: { checklists: [], inspections: [], files: [] },
    });
    expect(proposed.status).toBe(200);
    const approved = await fixture.completion(context, 'approve_completion', {
      proposal: pin(proposed.body.completionRecord),
    });
    expect(approved.status).toBe(200);
    expect(approved.body.completionRecord.recordKind).toBe('approval');
    return approved.body.completionRecord;
  }

  beforeAll(async () => {
    fixture = await createDatabaseFixture({ operationalSchedule: true });
    part5aApp = express(); part5aApp.use(express.json());
    const bypass = (_req, _res, next) => next();
    const auth = (req, _res, next) => {
      const selected = actor(req.get('X-Test-Actor') || 'owner');
      req.user = { id: selected.actorUserId }; req.orgId = selected.organizationId || fixture.org;
      req.tenantContext = { organizationId: selected.organizationId || fixture.org,
        userId: selected.actorUserId };
      req.userRole = selected.actorAccessRole; req.authSession = { id: selected.authSessionId };
      next();
    };
    part5aApp.use(endpoint, createForecastWorkloadCapacityRouter({ auth, throttle: bypass,
      writeThrottle: bypass, poolProvider: () => fixture.runtimePool }));
    epochStart = new Date((await fixture.ownerPool.query("SELECT date_trunc('second',clock_timestamp()) - interval '61 days' value"))
      .rows[0].value);
    await setClock(epochStart);
    executionContext = await fixture.createExecution({ approvedScheduling: true });
    backlogContext = await fixture.createExecution({ approvedScheduling: true, stopAfterScheduling: true });
    unscheduledBacklogContext = await fixture.createExecution({ approvedScheduling: true, stopAfterScheduling: true });
    boundaryBacklogContext = await fixture.createExecution({ approvedScheduling: true });
    correctionContext = await fixture.createExecution({ approvedScheduling: true });
    negativeBacklogContext = await fixture.createExecution({ approvedScheduling: true,
      stopAfterScheduling: true });
    boundLaborContext = await fixture.createExecution({ approvedScheduling: true });
    await approvePersonPlan(executionContext);
    await approvePersonPlan(backlogContext);
    await explicitlyUnschedule(unscheduledBacklogContext);
    await approvePersonPlan(unscheduledBacklogContext);
    await approvePersonPlan(boundaryBacklogContext);
    await approvePersonPlan(correctionContext);
    await approvePersonPlan(boundLaborContext);
    for (const name of ['dispatcher', 'member']) {
      await approveWorkProfile(name);
    }
    await declareAvailability(epochStart, new Date(epochStart.getTime() + 185 * 86400000));
    await declareAvailability(epochStart, new Date(epochStart.getTime() + 185 * 86400000), 'owner');
    const epoch = await post('/epochs', { reason: 'Begin exact prospective installed-source workload coverage.',
      confirmed: true, confirmationVersion: 'm26-workload-capacity-epoch-v1' });
    expect(epoch.status).toBe(201);
    for (const target of TARGETS) await review({ kind: 'method', target });
    await review({ kind: 'capacity_role_scope', target: TARGETS[2], role: 'technician' });
    for (const [name, role] of [['owner', 'owner'], ['admin', 'administrator'],
      ['dispatcher', 'dispatcher'], ['member', 'technician'], ['viewer', 'employee']]) {
      roleQualificationReviews[name] = await review({ kind: 'role_qualification', target: TARGETS[2],
        subjectId: actor(name).actorUserId, role });
    }
    const internalRoleBasis = (await fixture.ownerPool.query(
      `SELECT canonical_forecast_workload_capacity_v1_review_source(
        $1,'role_qualification',$2,$3,'owner') source`,
    [fixture.org, TARGETS[2], actor('owner').actorUserId])).rows[0].source;
    expect(internalRoleBasis).toMatchObject({ m23SelfProfileEligible: false,
      qualificationScope: 'owner_reviewed_internal_operational_role_only',
      independentCredentialVerified: false, providerCertificationVerified: false,
      verifiedCertificationIds: [] });
    expect(Number.isSafeInteger(Number(internalRoleBasis.roleSourceGeneration))).toBe(true);
    expect(Number(internalRoleBasis.roleSourceGeneration)).toBeGreaterThan(0);
    expect(internalRoleBasis.roleSourceDigest).toMatch(/^[0-9a-f]{64}$/);
    const memberRoleBasis = (await fixture.ownerPool.query(
      `SELECT canonical_forecast_workload_capacity_v1_review_source(
        $1,'role_qualification',$2,$3,'technician') source`,
    [fixture.org, TARGETS[2], actor('member').actorUserId])).rows[0].source;
    expect(memberRoleBasis).toMatchObject({ m23SelfProfileEligible: true,
      qualificationScope: 'owner_reviewed_m23_profile_and_operational_role',
      independentCredentialVerified: false, providerCertificationVerified: false });
    expect(memberRoleBasis.verifiedCertificationIds).toEqual(['safety']);
    expect(Number(memberRoleBasis.profileEventSourceOrder)).toBeGreaterThan(0);
    expect(memberRoleBasis.profileEventDigest).toMatch(/^[0-9a-f]{64}$/);
    const viewerGenerationBefore = Number((await fixture.ownerPool.query(
      `SELECT max(generation) generation FROM canonical_forecast_workload_capacity_role_generations_v1
        WHERE organization_id=$1 AND profile_id=$2`,
    [fixture.org, actor('viewer').actorUserId])).rows[0].generation);
    availabilityReviewKey = `m26-p5a-availability-review-${uuid()}`;
    const availabilityReview = await review({ kind: 'availability_basis', target: TARGETS[2],
      subjectId: actor('member').actorUserId }, availabilityReviewKey);
    availabilityReviewRequest = availabilityReview.request;
    await review({ kind: 'availability_basis', target: TARGETS[2],
      subjectId: actor('owner').actorUserId,
      reason: 'Owner approves the exact declared availability for the internally reviewed owner role.' });
    // The applicable workforce census is established before the selected role
    // is enriched. A second active technician without a current reviewed
    // qualification makes the target unavailable rather than disappearing.
    await fixture.ownerPool.query("UPDATE workforce_profiles SET operational_role='technician' WHERE id=$1",
      [actor('admin').actorUserId]);
    await expect(fixture.ownerPool.query(
      'SELECT canonical_forecast_workload_capacity_v1_capacity_evidence($1,$2,$3,$2)',
      [fixture.org, epochStart, new Date(epochStart.getTime() + 86400000)])).
      rejects.toMatchObject({ code: '22023' });
    await fixture.ownerPool.query("UPDATE workforce_profiles SET operational_role='administrator' WHERE id=$1",
      [actor('admin').actorUserId]);
    let staleReplay = await post('/reviews', roleQualificationReviews.admin.request,
      roleQualificationReviews.admin.key);
    expect(staleReplay.status).toBe(409);
    roleQualificationReviews.admin = await refreshReview('role_qualification', TARGETS[2],
      actor('admin').actorUserId, 'administrator');
    // Classification happens across the full Mission 22-assignable active
    // population before target-role filtering. A stale non-target owner role
    // therefore blocks even a technician projection and cannot disappear.
    await fixture.ownerPool.query("UPDATE workforce_profiles SET operational_role='employee' WHERE id=$1",
      [actor('owner').actorUserId]);
    await expect(fixture.ownerPool.query(
      'SELECT canonical_forecast_workload_capacity_v1_capacity_evidence($1,$2,$3,$2)',
      [fixture.org, epochStart, new Date(epochStart.getTime() + 86400000)])).
      rejects.toMatchObject({ code: '22023' });
    await fixture.ownerPool.query("UPDATE workforce_profiles SET operational_role='owner' WHERE id=$1",
      [actor('owner').actorUserId]);
    staleReplay = await post('/reviews', roleQualificationReviews.owner.request,
      roleQualificationReviews.owner.key);
    expect(staleReplay.status).toBe(409);
    roleQualificationReviews.owner = await refreshReview('role_qualification', TARGETS[2],
      actor('owner').actorUserId, 'owner');
    // Membership/access classification is independently source-generated.
    // Moving an M22-assignable internal profile into the M23 member class
    // refuses without an approved self-profile. Restoring the value still
    // cannot revive the old reviewed source generation.
    await fixture.ownerPool.query("UPDATE organization_memberships SET role='member' WHERE id=$1",
      [actor('viewer').actorUserId]);
    await expect(fixture.ownerPool.query(
      `SELECT canonical_forecast_workload_capacity_v1_review_source(
        $1,'role_qualification',$2,$3,'employee')`,
    [fixture.org, TARGETS[2], actor('viewer').actorUserId])).rejects.toMatchObject({ code: '22023' });
    await fixture.ownerPool.query("UPDATE organization_memberships SET role='viewer' WHERE id=$1",
      [actor('viewer').actorUserId]);
    staleReplay = await post('/reviews', roleQualificationReviews.viewer.request,
      roleQualificationReviews.viewer.key);
    expect(staleReplay.status).toBe(409);
    roleQualificationReviews.viewer = await refreshReview('role_qualification', TARGETS[2],
      actor('viewer').actorUserId, 'employee');
    const viewerGenerationAfter = Number((await fixture.ownerPool.query(
      `SELECT max(generation) generation FROM canonical_forecast_workload_capacity_role_generations_v1
        WHERE organization_id=$1 AND profile_id=$2`,
    [fixture.org, actor('viewer').actorUserId])).rows[0].generation);
    expect(viewerGenerationAfter).toBe(viewerGenerationBefore + 2);
    // A role with a complete empty population is an authenticated zero. The
    // scope stream is singular across roles and must then be explicitly moved
    // back; role values are never pooled.
    let scopeToken = await get(`/reviews/current?kind=capacity_role_scope&target=${encodeURIComponent(TARGETS[2])}&subjectId=none&role=none`);
    expect(scopeToken.status).toBe(200);
    expect(scopeToken.body.data.role).toBe('technician');
    await review({ kind: 'capacity_role_scope', target: TARGETS[2], role: 'accounting',
      expectedRevision: scopeToken.body.data.expectedRevision,
      expectedDigest: scopeToken.body.data.expectedDigest });
    const emptyRole = (await fixture.ownerPool.query(
      'SELECT canonical_forecast_workload_capacity_v1_capacity_evidence($1,$2,$3,$2) value',
      [fixture.org, epochStart, new Date(epochStart.getTime() + 86400000)])).rows[0].value;
    expect(emptyRole).toMatchObject({ declaredRole: 'accounting', censusCount: 5, count: 0,
      availablePersonMinutes: 0 });
    scopeToken = await get(`/reviews/current?kind=capacity_role_scope&target=${encodeURIComponent(TARGETS[2])}&subjectId=none&role=none`);
    expect(scopeToken.body.data.role).toBe('accounting');
    await review({ kind: 'capacity_role_scope', target: TARGETS[2], role: 'owner',
      expectedRevision: scopeToken.body.data.expectedRevision,
      expectedDigest: scopeToken.body.data.expectedDigest });
    const internalOwnerRole = (await fixture.ownerPool.query(
      'SELECT canonical_forecast_workload_capacity_v1_capacity_evidence($1,$2,$3,$2) value',
      [fixture.org, epochStart, new Date(epochStart.getTime() + 86400000)])).rows[0].value;
    expect(internalOwnerRole).toMatchObject({ declaredRole: 'owner', censusCount: 5, count: 1,
      declaredAvailabilityOnly: true, realizedAttendanceVerified: false });
    expect(Number(internalOwnerRole.availablePersonMinutes)).toBeGreaterThan(0);
    scopeToken = await get(`/reviews/current?kind=capacity_role_scope&target=${encodeURIComponent(TARGETS[2])}&subjectId=none&role=none`);
    await review({ kind: 'capacity_role_scope', target: TARGETS[2], role: 'technician',
      expectedRevision: scopeToken.body.data.expectedRevision,
      expectedDigest: scopeToken.body.data.expectedDigest });
    await review({ kind: 'remaining_work', target: TARGETS[1],
      subjectId: backlogContext.appointment, remainingPersonMinutes: 180 });
    await review({ kind: 'remaining_work', target: TARGETS[1],
      subjectId: unscheduledBacklogContext.appointment, remainingPersonMinutes: 120 });
    await review({ kind: 'remaining_work', target: TARGETS[1],
      subjectId: boundaryBacklogContext.appointment, remainingPersonMinutes: 60 });
    for (const context of [executionContext, correctionContext, boundLaborContext]) {
      await review({ kind: 'remaining_work', target: TARGETS[1],
        subjectId: context.appointment, remainingPersonMinutes: 0 });
    }
    const beforeMissingPlanRefusal = Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_workload_capacity_windows_v1')).rows[0].count);
    await expect(fixture.ownerPool.query(
      'SELECT canonical_forecast_workload_capacity_v1_backlog_evidence($1,$2)',
      [fixture.org, at(62)])).rejects.toMatchObject({ code: '22023' });
    expect(Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_workload_capacity_windows_v1')).rows[0].count))
      .toBe(beforeMissingPlanRefusal);
    await approvePersonPlan(negativeBacklogContext);
    await review({ kind: 'remaining_work', target: TARGETS[1],
      subjectId: negativeBacklogContext.appointment, remainingPersonMinutes: 0 });
    await setClock(at(45));
    const laborEnd = at(45); const laborStart = new Date(laborEnd.getTime() - 1000);
    await recordAcceptedLabor(executionContext, laborStart, laborEnd);
    historicalApproval = await completeExecution(correctionContext);
  }, 240000);

  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 180000);

  test('issues a production-clock future origin with atomic server-selected training receipts', async () => {
    await setClock(at(60));
    let methodToken = await get(`/reviews/current?kind=method&target=${encodeURIComponent(TARGETS[0])}&subjectId=none&role=none`);
    expect(methodToken.status).toBe(200);
    await review({ kind: 'method', target: TARGETS[0], action: 'reject',
      expectedRevision: methodToken.body.data.expectedRevision,
      expectedDigest: methodToken.body.data.expectedDigest,
      reason: 'Owner rejects this method before authorizing any atomic training receipts.' });
    const refusedWindowCount = Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_workload_capacity_windows_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count);
    expect((await post('/origins', ORIGIN_BODY)).status).toBe(400);
    expect(Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_workload_capacity_windows_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count)).toBe(refusedWindowCount);
    methodToken = await get(`/reviews/current?kind=method&target=${encodeURIComponent(TARGETS[0])}&subjectId=none&role=none`);
    await review({ kind: 'method', target: TARGETS[0], action: 'approve',
      expectedRevision: methodToken.body.data.expectedRevision,
      expectedDigest: methodToken.body.data.expectedDigest,
      reason: 'Owner explicitly reapproves the exact method before atomic origin capture.' });
    await fixture.ownerPool.query("SET northstar.m26_part5a_disposable_clock='enabled'");
    await fixture.ownerPool.query('DELETE FROM canonical_forecast_workload_capacity_test_clock_v1');
    const windowsBefore = Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_workload_capacity_windows_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count);
    const startedAt = Date.now();
    const key = `m26-p5a-wall-origin-${uuid()}`;
    const blocker = await fixture.ownerPool.connect();
    let response;
    let releasedAt;
    try {
      await blocker.query('BEGIN');
      await blocker.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,
        [`m26:workload-capacity-key:${fixture.org}:${actor('owner').actorUserId}:${hash(key)}`]);
      const pending = post('/origins', ORIGIN_BODY, key).then(value => value);
      for (let attempt = 0; attempt < 150; attempt += 1) {
        const waiting = await blocker.query(
          `SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted LIMIT 1`);
        if (waiting.rowCount === 1) break;
        if (attempt === 149) throw new Error('Expected origin request to wait on its exact idempotency lock');
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      releasedAt = Date.now();
      await blocker.query('COMMIT');
      response = await pending;
    } catch (error) {
      await blocker.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { blocker.release(); }
    const finishedAt = Date.now();
    expect(response.status).toBe(201);
    const stored = (await fixture.ownerPool.query(
      `SELECT prediction_cutoff_at,horizon_ends_at,created_at,training_window_ids
         FROM canonical_forecast_workload_capacity_origins_v1
        WHERE organization_id=$1 AND id=$2`, [fixture.org, response.body.data.id])).rows[0];
    expect(new Date(stored.prediction_cutoff_at).getTime()).toBeGreaterThanOrEqual(startedAt);
    expect(new Date(stored.prediction_cutoff_at).getTime()).toBeGreaterThanOrEqual(releasedAt);
    expect(new Date(stored.prediction_cutoff_at).getTime()).toBeLessThanOrEqual(finishedAt);
    expect(new Date(stored.created_at).getTime()).toBeGreaterThanOrEqual(
      new Date(stored.prediction_cutoff_at).getTime());
    expect(new Date(stored.horizon_ends_at).getTime() - new Date(stored.prediction_cutoff_at).getTime())
      .toBe(2592000000);
    expect(new Date(stored.horizon_ends_at).getTime()).toBeGreaterThan(finishedAt);
    const windowIds = stored.training_window_ids.map(value => value.id);
    const windows = (await fixture.ownerPool.query(
      `SELECT id,window_start,window_end,finalized_at FROM canonical_forecast_workload_capacity_windows_v1
        WHERE organization_id=$1 AND id=ANY($2::uuid[]) ORDER BY window_start`,
      [fixture.org, windowIds])).rows;
    expect(windows).toHaveLength(2);
    expect(new Date(windows[0].window_start).getTime())
      .toBe(new Date(stored.prediction_cutoff_at).getTime() - 5184000000);
    expect(new Date(windows[0].window_end).getTime()).toBe(new Date(windows[1].window_start).getTime());
    expect(new Date(windows[1].window_end).getTime()).toBe(new Date(stored.prediction_cutoff_at).getTime());
    expect(windows.every(value => new Date(value.finalized_at).getTime() ===
      new Date(stored.prediction_cutoff_at).getTime())).toBe(true);
    expect(Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_workload_capacity_windows_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count)).toBe(windowsBefore + 2);
    expect((await post(`/origins/${response.body.data.id}/evaluations`, {})).status).toBe(400);
    expect((await post('/origins', ORIGIN_BODY, key)).body.data)
      .toMatchObject({ id: response.body.data.id, replayed: true });
    expect((await post('/origins', { ...ORIGIN_BODY,
      reason: 'A changed human authorization must receive a fresh request identity.' }, key)).status).toBe(409);
    expect(Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_workload_capacity_windows_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count)).toBe(windowsBefore + 2);

    // The real-clock case ends before the future horizon. Eligibility changes
    // inside that horizon are covered by the mounted refusal case below; they
    // must not be mislabeled as harmless post-horizon progress here.
    await setClock(at(60));
  }, 180000);

  test('mounts an exact three-target prospective origin and later append-only evaluation', async () => {
    await setClock(at(60));
    for (const [index, start] of [at(0), at(30)].entries()) {
      const response = await post('/windows/finalize', { windowStart: start.toISOString(),
        windowEnd: at((index + 1) * 30).toISOString(), reason: 'Finalize the complete bounded installed-source training window.' });
      expect(response.status).toBe(201);
    }
    const trainingEvidence = (await fixture.ownerPool.query(
      `SELECT evidence FROM canonical_forecast_workload_capacity_windows_v1
       WHERE organization_id=$1 AND window_start IN($2,$3) ORDER BY window_start`,
      [fixture.org, at(0), at(30)])).rows.map(row => row.evidence);
    expect(trainingEvidence).toHaveLength(2);
    expect(trainingEvidence.some(value => Number(value.labor.personMinutes) === 0)).toBe(true);
    expect(trainingEvidence.some(value => Number(value.labor.personMinutes) > 0)).toBe(true);
    expect(trainingEvidence.every(value => Number(value.capacity.availablePersonMinutes) > 0)).toBe(true);
    expect(trainingEvidence.every(value => Number(value.backlog.scheduledPersonMinutes) === 240)).toBe(true);
    expect(trainingEvidence.every(value => Number(value.backlog.unscheduledPersonMinutes) === 120)).toBe(true);
    expect(trainingEvidence.every(value => Number(value.backlog.scheduledPersonMinutes) +
      Number(value.backlog.unscheduledPersonMinutes) === 360)).toBe(true);
    const originKey = `m26-p5a-origin-${uuid()}`;
    const origin = await post('/origins', ORIGIN_BODY, originKey);
    expect(origin.status).toBe(201);
    expect(origin.body.data).toMatchObject({ targets: TARGETS, resultsWithheld: true,
      outputDigestsWithheld: true, researchOnly: true, forecastIssued: false,
      paidNumericServing: false, forecastServingEnabled: false, automaticActionTaken: false });
    expect(Date.parse(origin.body.data.horizonEndsAt) - Date.parse(origin.body.data.predictionCutoffAt))
      .toBe(2592000000);
    expect((await post(`/origins/${origin.body.data.id}/evaluations`, {})).status).toBe(400);
    await setClock(at(75));
    await completeExecution(executionContext);
    const stillCurrent = await get(`/origins/${origin.body.data.id}`);
    expect(stillCurrent.status).toBe(200);
    expect(stillCurrent.body.data.state).toBe('workload_capacity_origin_current');
    const replay = await post('/origins', ORIGIN_BODY, originKey);
    expect(replay.status).toBe(200);
    expect(replay.body.data).toMatchObject({ id: origin.body.data.id, replayed: true });
    await setClock(at(90));
    const outcome = await post('/windows/finalize', { windowStart: at(60).toISOString(),
      windowEnd: at(90).toISOString(), reason: 'Finalize the complete fixed-horizon installed-source outcome.' });
    expect(outcome.status).toBe(201);
    const outcomeEvidence = (await fixture.ownerPool.query(
      `SELECT evidence FROM canonical_forecast_workload_capacity_windows_v1
        WHERE organization_id=$1 AND id=$2`, [fixture.org, outcome.body.data.id])).rows[0].evidence;
    expect(Number(outcomeEvidence.backlog.scheduledPersonMinutes)).toBe(240);
    expect(Number(outcomeEvidence.backlog.unscheduledPersonMinutes)).toBe(120);
    expect(Number(outcomeEvidence.backlog.scheduledPersonMinutes) +
      Number(outcomeEvidence.backlog.unscheduledPersonMinutes)).toBe(360);
    const evaluated = await post(`/origins/${origin.body.data.id}/evaluations`, {});
    expect(evaluated.status).toBe(201);
    expect(evaluated.body.data).toMatchObject({ originId: origin.body.data.id,
      metricsWithheld: true, researchOnly: true, forecastIssued: false });
    const loaded = await get(`/origins/${origin.body.data.id}/evaluations/${evaluated.body.data.id}`);
    expect(loaded.status).toBe(200);
    expect(loaded.body.data.state).toBe('workload_capacity_evaluation_current');
    const historicalCapacity = {
      availablePersonMinutes: Number(outcomeEvidence.capacity.availablePersonMinutes),
      rows: outcomeEvidence.capacity.rows.map(value => ({ profileId: value.profileId,
        availablePersonMinutes: Number(value.availablePersonMinutes) })),
    };
    await setClock(at(95));
    // Membership, account and role changes after the measured horizon are
    // later progress. They
    // produce append-only source observations and require a new review for a
    // new use, while historical recapture retains the exact old population.
    await fixture.ownerPool.query("UPDATE organization_memberships SET status='suspended' WHERE id=$1",
      [actor('member').actorUserId]);
    await fixture.ownerPool.query("UPDATE organization_memberships SET status='active' WHERE id=$1",
      [actor('member').actorUserId]);
    await fixture.ownerPool.query("UPDATE users SET status='suspended' WHERE id=$1",
      [actor('member').actorUserId]);
    await fixture.ownerPool.query("UPDATE users SET status='active' WHERE id=$1",
      [actor('member').actorUserId]);
    await fixture.ownerPool.query("UPDATE workforce_profiles SET operational_role='employee' WHERE id=$1",
      [actor('member').actorUserId]);
    await fixture.ownerPool.query("UPDATE workforce_profiles SET operational_role='technician' WHERE id=$1",
      [actor('member').actorUserId]);
    roleQualificationReviews.member = await refreshReview('role_qualification', TARGETS[2],
      actor('member').actorUserId, 'technician');
    expect((await get(`/origins/${origin.body.data.id}`)).body.data.state)
      .toBe('workload_capacity_origin_current');
    const recapturedOutcome = await post('/windows/finalize', { windowStart: at(60).toISOString(),
      windowEnd: at(90).toISOString(),
      reason: 'Recapture the exact historical outcome after ordinary later workforce progress.' });
    expect(recapturedOutcome.status).toBe(201);
    const recapturedEvidence = (await fixture.ownerPool.query(
      `SELECT evidence FROM canonical_forecast_workload_capacity_windows_v1
        WHERE organization_id=$1 AND id=$2`, [fixture.org, recapturedOutcome.body.data.id])).rows[0].evidence;
    expect(Number(recapturedEvidence.capacity.availablePersonMinutes))
      .toBe(historicalCapacity.availablePersonMinutes);
    expect(recapturedEvidence.capacity.rows.map(value => ({ profileId: value.profileId,
      availablePersonMinutes: Number(value.availablePersonMinutes) })))
      .toEqual(historicalCapacity.rows);
    expect((await get(`/origins/${origin.body.data.id}/evaluations/${evaluated.body.data.id}`)).body.data.state)
      .toBe('workload_capacity_evaluation_stale');
    const workforceRecoveredEvaluation = await post(`/origins/${origin.body.data.id}/evaluations`, {});
    expect(workforceRecoveredEvaluation.status).toBe(201);
    expect(workforceRecoveredEvaluation.body.data).toMatchObject({ originId: origin.body.data.id,
      revision: 2, metricsWithheld: true });
    const privateRows = await fixture.ownerPool.query(
      'SELECT private_results FROM canonical_forecast_workload_capacity_origins_v1 WHERE id=$1', [origin.body.data.id]);
    expect(Number(privateRows.rows[0].private_results[TARGETS[0]])).toBeGreaterThan(0);
    expect(JSON.stringify(origin.body)).not.toMatch(/private_results|output_digest|personMinutes/i);

    // A completion exactly at the exclusive horizon belongs to the next
    // window. It is legitimate future progress and does not rewrite the stock
    // reconstructed immediately before that boundary.
    await setClock(at(90));
    await completeExecution(boundaryBacklogContext);
    expect((await get(`/origins/${origin.body.data.id}`)).body.data.state)
      .toBe('workload_capacity_origin_current');
    expect((await get(`/origins/${origin.body.data.id}/evaluations/${workforceRecoveredEvaluation.body.data.id}`)).body.data.state)
      .toBe('workload_capacity_evaluation_current');

    await setClock(at(95));
    const corrected = await fixture.completion(correctionContext, 'correct_completion', {
      record: pin(historicalApproval), annotation: {
        note: 'Correct the pre-cutoff accepted completion while preserving immutable history.',
        nextAction: 'Review the corrected bounded source history.',
      },
    });
    expect(corrected.status).toBe(200);
    expect((await get(`/origins/${origin.body.data.id}`)).body.data.state)
      .toBe('workload_capacity_origin_stale');
    expect((await get(`/origins/${origin.body.data.id}/evaluations/${evaluated.body.data.id}`)).body.data.state)
      .toBe('workload_capacity_evaluation_stale');
    expect((await post('/origins', ORIGIN_BODY, originKey)).status).toBe(409);

    await setClock(at(155));
    expect((await post('/windows/finalize', { windowStart: at(60).toISOString(),
      windowEnd: at(90).toISOString(), reason: 'Append corrected installed-source evidence for the changed historical window.' })).status).toBe(201);
    const recoveredOrigin = await post('/origins', ORIGIN_BODY);
    expect(recoveredOrigin.status).toBe(201);
    expect(recoveredOrigin.body.data.id).not.toBe(origin.body.data.id);
    // The saved origin freezes the stock at day 155. Accepted Mission 23 work
    // progresses inside its horizon while the qualified-role, availability and
    // commitment sources stay stable, allowing an exact capacity outcome.
    await setClock(new Date(at(155).getTime() + 1000));
    await startExecution(backlogContext);
    await setClock(at(170));
    await completeExecution(backlogContext);
    await setClock(at(185));
    const recoveredOutcome = await post('/windows/finalize', { windowStart: at(155).toISOString(),
      windowEnd: at(185).toISOString(), reason: 'Finalize the complete stable-capacity recovery outcome window.' });
    expect(recoveredOutcome.status).toBe(201);
    const recoveredOutcomeEvidence = (await fixture.ownerPool.query(
      `SELECT evidence FROM canonical_forecast_workload_capacity_windows_v1
        WHERE organization_id=$1 AND id=$2`, [fixture.org, recoveredOutcome.body.data.id])).rows[0].evidence;
    expect(Number(recoveredOutcomeEvidence.backlog.scheduledPersonMinutes)).toBe(0);
    expect(Number(recoveredOutcomeEvidence.backlog.unscheduledPersonMinutes)).toBeGreaterThan(0);
    const recoveredEvaluation = await post(`/origins/${recoveredOrigin.body.data.id}/evaluations`, {});
    expect(recoveredEvaluation.status).toBe(201);
    expect(recoveredEvaluation.body.data.originId).toBe(recoveredOrigin.body.data.id);
    // Schedule, dispatch, completion and explicit unscheduling after the
    // exclusive outcome boundary are ordinary next-window progress.
    await setClock(new Date(at(185).getTime() + 1000));
    await approveScheduleAction(unscheduledBacklogContext, 'schedule', at(186).toISOString(),
      new Date(at(186).getTime() + 3600000).toISOString());
    await approveScheduleAction(unscheduledBacklogContext, 'dispatch');
    await startExecution(unscheduledBacklogContext);
    await setClock(at(186));
    await completeExecution(unscheduledBacklogContext);
    await explicitlyUnschedule(backlogContext);
    await explicitlyUnschedule(unscheduledBacklogContext);
    expect((await get(`/origins/${recoveredOrigin.body.data.id}/evaluations/${recoveredEvaluation.body.data.id}`)).body.data.state)
      .toBe('workload_capacity_evaluation_current');

    // An exact reviewed declared hour consumed by one exact approved
    // commitment is authenticated zero base role capacity, not missing source
    // evidence. The next window remains half-open and source reconstructed.
    await setClock(at(189));
    await replaceAvailability(at(190), at(300), [{ kind: 'available',
      start: at(191).toISOString(), end: new Date(at(191).getTime() + 3600000).toISOString() }]);
    // An uncertain retry retains its exact key, endpoint and body and now fails
    // stale. The guarded read-only token endpoint makes an explicit append-only
    // recovery reachable without exposing availability intervals or identities.
    expect((await post('/reviews', availabilityReviewRequest, availabilityReviewKey)).status).toBe(409);
    const availabilityToken = await get(`/reviews/current?kind=availability_basis&target=${encodeURIComponent(TARGETS[2])}&subjectId=${actor('member').actorUserId}&role=none`);
    expect(availabilityToken.status).toBe(200);
    expect(availabilityToken.body.data).toMatchObject({ sourceCurrent: false,
      expectedRevision: 1, action: 'approve', researchOnly: true, forecastIssued: false });
    expect(JSON.stringify(availabilityToken.body)).not.toMatch(/intervals|availablePersonMinutes|sourceIdentity/i);
    await review({ kind: 'availability_basis', target: TARGETS[2],
      subjectId: actor('member').actorUserId,
      expectedRevision: availabilityToken.body.data.expectedRevision,
      expectedDigest: availabilityToken.body.data.expectedDigest,
      reason: 'Owner approves the revised exact declared-availability basis for zero evidence.' });
    capacityZeroContext = await fixture.createExecution({ approvedScheduling: true,
      stopAfterScheduling: true, start: at(191) });
    await approvePersonPlan(capacityZeroContext);
    const beforeMissingPlanRefusal = Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_workload_capacity_windows_v1')).rows[0].count);
    await expect(fixture.ownerPool.query(
      'SELECT canonical_forecast_workload_capacity_v1_backlog_evidence($1,$2)',
      [fixture.org, at(220)])).rejects.toMatchObject({ code: '22023' });
    expect(Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_workload_capacity_windows_v1')).rows[0].count))
      .toBe(beforeMissingPlanRefusal);
    await review({ kind: 'remaining_work', target: TARGETS[1],
      subjectId: capacityZeroContext.appointment, remainingPersonMinutes: 60,
      reason: 'Owner reviews the exact remaining work for the zero-capacity commitment.' });
    const approvedBaseCommitment = (await fixture.ownerPool.query(
      `SELECT needs_review,review_reasons FROM canonical_schedule_assignments
        WHERE organization_id=$1 AND id=$2`,
      [fixture.org, capacityZeroContext.assignment.id])).rows[0];
    expect(approvedBaseCommitment.needs_review).toBe(true);
    expect(approvedBaseCommitment.review_reasons.map(value => value.code).sort()).toEqual([
      'location_scope_authority_missing', 'required_skill_authority_missing',
    ]);
    await setClock(at(220));
    const zeroCapacityWindow = await post('/windows/finalize', { windowStart: at(190).toISOString(),
      windowEnd: at(220).toISOString(),
      reason: 'Finalize the exact installed-source authenticated zero base-capacity window.' });
    expect(zeroCapacityWindow.status).toBe(201);
    const zeroCapacityEvidence = (await fixture.ownerPool.query(
      `SELECT evidence FROM canonical_forecast_workload_capacity_windows_v1
        WHERE organization_id=$1 AND id=$2`, [fixture.org, zeroCapacityWindow.body.data.id])).rows[0].evidence;
    expect(Number(zeroCapacityEvidence.capacity.availablePersonMinutes)).toBe(0);
    expect(Number(zeroCapacityEvidence.capacity.count)).toBe(1);
    // A source change exactly at the exclusive end belongs to the next
    // interval and cannot rewrite this just-finalized historical result.
    await fixture.ownerPool.query("UPDATE users SET status='suspended' WHERE id=$1",
      [actor('viewer').actorUserId]);
    await fixture.ownerPool.query("UPDATE users SET status='active' WHERE id=$1",
      [actor('viewer').actorUserId]);
    roleQualificationReviews.viewer = await refreshReview('role_qualification', TARGETS[2],
      actor('viewer').actorUserId, 'employee');
    expect((await fixture.ownerPool.query(
      `SELECT canonical_forecast_workload_capacity_v1_window_current(
        $1,value) current FROM canonical_forecast_workload_capacity_windows_v1 value
       WHERE value.organization_id=$1 AND value.id=$2`,
    [fixture.org, zeroCapacityWindow.body.data.id])).rows[0].current).toBe(true);
    // The same source observation belongs to a following interval whose lower
    // bound is inclusive. Its refreshed classification is available at that
    // exact start rather than being silently omitted from both windows.
    const exactStartCapacity = (await fixture.ownerPool.query(
      `SELECT canonical_forecast_workload_capacity_v1_capacity_evidence(
         $1,$2,$3,$2) evidence,
       canonical_forecast_workload_capacity_v1_capacity_calculation(
         $1,$2,$3,$2,'technician') calculation`,
    [fixture.org, at(220), at(221)])).rows[0];
    expect(exactStartCapacity.evidence).toMatchObject({ declaredRole: 'technician',
      censusCount: 5, count: 0, availablePersonMinutes: 0,
      declaredAvailabilityOnly: true });
    expect(exactStartCapacity.calculation).toMatchObject({ censusCount: 5,
      targetCount: 1, count: 0, minutes: 0 });
  }, 180000);

  test('refuses unsupported workforce eligibility changes inside a measured capacity interval', async () => {
    const before = Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_workload_capacity_windows_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count);
    await expect(fixture.ownerPool.query(
      'SELECT canonical_forecast_workload_capacity_v1_capacity_evidence($1,$2,$3,$2)',
      [fixture.org, at(90), at(120)])).rejects.toMatchObject({ code: '22023' });
    const refused = await post('/windows/finalize', { windowStart: at(90).toISOString(),
      windowEnd: at(120).toISOString(),
      reason: 'Refuse unsupported in-window workforce eligibility changes without partial evidence.' });
    expect(refused.status).toBe(400);
    expect(Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_workload_capacity_windows_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count)).toBe(before);
  }, 120000);

  test('binds M23 qualification generations and the exclusive commitment boundary', async () => {
    await setClock(at(230));
    await replaceAvailability(at(230), at(365), availableIntervals(at(230), at(365)));
    await refreshReview('availability_basis', TARGETS[2], actor('member').actorUserId, null);
    const commitmentBoundaryContext = await fixture.createExecution({ approvedScheduling: true,
      stopAfterScheduling: true });
    await approvePersonPlan(commitmentBoundaryContext);
    await review({ kind: 'remaining_work', target: TARGETS[1],
      subjectId: commitmentBoundaryContext.appointment, remainingPersonMinutes: 0,
      reason: 'Owner reviews the isolated exact-boundary commitment source.' });
    await explicitlyUnschedule(commitmentBoundaryContext);

    const windowsBeforeRefusal = Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_workload_capacity_windows_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count);
    await setClock(at(240));
    await decideWorkProfile('member', 'revoke');
    const staleToken = await get(`/reviews/current?kind=role_qualification&target=${encodeURIComponent(TARGETS[2])}` +
      `&subjectId=${actor('member').actorUserId}&role=technician`);
    expect(staleToken.status).toBe(200);
    expect(staleToken.body.data.sourceCurrent).toBe(false);
    const revokedReplay = await post('/reviews', roleQualificationReviews.member.request,
      roleQualificationReviews.member.key);
    expect(revokedReplay.status).toBe(400);
    expect(revokedReplay.body).toEqual({ success: false, error: 'Invalid request' });
    await expect(fixture.ownerPool.query(
      'SELECT canonical_forecast_workload_capacity_v1_capacity_evidence($1,$2,$3,$2)',
      [fixture.org, at(230), at(260)])).rejects.toMatchObject({ code: '22023' });
    expect((await post('/windows/finalize', { windowStart: at(230).toISOString(),
      windowEnd: at(260).toISOString(),
      reason: 'Refuse the M23 qualification transition inside this exact interval.' })).status).toBe(400);
    expect(Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_workload_capacity_windows_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count)).toBe(windowsBeforeRefusal);

    await setClock(at(260));
    await submitWorkProfile('member', 'safety-v2');
    const approvedV2 = await decideWorkProfile('member', 'approve', ['safety-v2']);
    roleQualificationReviews.member = await refreshReview('role_qualification', TARGETS[2],
      actor('member').actorUserId, 'technician');
    const exactStart = (await fixture.ownerPool.query(
      'SELECT canonical_forecast_workload_capacity_v1_capacity_evidence($1,$2,$3,$2) value',
      [fixture.org, at(260), at(290)])).rows[0].value;
    expect(exactStart.rows.find(value => value.profileId === actor('member').actorUserId))
      .toMatchObject({ profileEventId: approvedV2.id, profileEventRevision: approvedV2.revision });

    await setClock(at(300));
    await submitWorkProfile('member', 'safety-v3');
    const approvedV3 = await decideWorkProfile('member', 'approve', ['safety-v3']);
    roleQualificationReviews.member = await refreshReview('role_qualification', TARGETS[2],
      actor('member').actorUserId, 'technician');
    await approveScheduleAction(commitmentBoundaryContext, 'schedule', at(300).toISOString(), at(301).toISOString());

    const priorWindow = await post('/windows/finalize', { windowStart: at(270).toISOString(),
      windowEnd: at(300).toISOString(),
      reason: 'Finalize the prior interval with exact-end M23 and commitment changes excluded.' });
    expect(priorWindow.status).toBe(201);
    const priorEvidence = (await fixture.ownerPool.query(
      'SELECT evidence FROM canonical_forecast_workload_capacity_windows_v1 WHERE organization_id=$1 AND id=$2',
      [fixture.org, priorWindow.body.data.id])).rows[0].evidence;
    const priorMember = priorEvidence.capacity.rows.find(value => value.profileId === actor('member').actorUserId);
    expect(priorMember).toMatchObject({ profileEventId: approvedV2.id, commitmentMinutes: 0 });

    await setClock(at(330));
    const nextWindow = await post('/windows/finalize', { windowStart: at(300).toISOString(),
      windowEnd: at(330).toISOString(),
      reason: 'Finalize the next interval with exact-start M23 and commitment changes included.' });
    expect(nextWindow.status).toBe(201);
    const nextEvidence = (await fixture.ownerPool.query(
      'SELECT evidence FROM canonical_forecast_workload_capacity_windows_v1 WHERE organization_id=$1 AND id=$2',
      [fixture.org, nextWindow.body.data.id])).rows[0].evidence;
    const nextMember = nextEvidence.capacity.rows.find(value => value.profileId === actor('member').actorUserId);
    expect(nextMember.profileEventId).toBe(approvedV3.id);
    expect(Number(nextMember.commitmentMinutes)).toBeGreaterThan(0);
    expect(Number(nextMember.availableMinutes)).toBeLessThan(Number(priorMember.availableMinutes));

    const origin = await post('/origins', ORIGIN_BODY);
    expect(origin.status).toBe(201);
    await setClock(at(360));
    const outcome = await post('/windows/finalize', { windowStart: at(330).toISOString(),
      windowEnd: at(360).toISOString(), reason: 'Finalize the stable exact M23 qualification outcome.' });
    expect(outcome.status).toBe(201);
    const evaluation = await post(`/origins/${origin.body.data.id}/evaluations`, {});
    expect(evaluation.status).toBe(201);

    await setClock(at(370));
    await submitWorkProfile('member', 'safety-v4');
    const approvedV4 = await decideWorkProfile('member', 'approve', ['safety-v4']);
    roleQualificationReviews.member = await refreshReview('role_qualification', TARGETS[2],
      actor('member').actorUserId, 'technician');
    expect((await get(`/origins/${origin.body.data.id}`)).body.data.state)
      .toBe('workload_capacity_origin_current');
    expect((await get(`/origins/${origin.body.data.id}/evaluations/${evaluation.body.data.id}`)).body.data.state)
      .toBe('workload_capacity_evaluation_current');
    const recaptured = await post('/windows/finalize', { windowStart: at(330).toISOString(),
      windowEnd: at(360).toISOString(),
      reason: 'Recapture the unchanged historical outcome after a later M23 profile generation.' });
    expect(recaptured.status).toBe(201);
    const recapturedEvidence = (await fixture.ownerPool.query(
      'SELECT evidence FROM canonical_forecast_workload_capacity_windows_v1 WHERE organization_id=$1 AND id=$2',
      [fixture.org, recaptured.body.data.id])).rows[0].evidence;
    expect(recapturedEvidence.capacity.rows).toEqual((await fixture.ownerPool.query(
      'SELECT evidence FROM canonical_forecast_workload_capacity_windows_v1 WHERE organization_id=$1 AND id=$2',
      [fixture.org, outcome.body.data.id])).rows[0].evidence.capacity.rows);
    expect((await get(`/origins/${origin.body.data.id}/evaluations/${evaluation.body.data.id}`)).body.data.state)
      .toBe('workload_capacity_evaluation_stale');
    expect((await post(`/origins/${origin.body.data.id}/evaluations`, {})).status).toBe(201);

    const current = await request(fixture.app).get('/api/work-profiles/me').set(actor('member').session.headers);
    await setClock(at(375));
    const sourceWriter = await fixture.runtimePool.connect();
    const sourceReader = await fixture.runtimePool.connect();
    try {
      const generationCount = Number((await fixture.ownerPool.query(
        `SELECT count(*) count FROM canonical_forecast_workload_capacity_profile_events_v1
          WHERE organization_id=$1`, [fixture.org])).rows[0].count);
      await sourceWriter.query('BEGIN');
      await sourceWriter.query(
        `SELECT canonical_work_profile_mutate($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
        [fixture.org, actor('member').actorUserId, actor('member').actorAccessRole,
          actor('member').authSessionId, actor('member').csrfToken, actor('member').actorUserId, uuid(),
          { action: 'submit', expectedRevision: current.body.data.profile.revision,
            profile: { title: 'Service technician', summary: 'Rolled-back qualification update.',
              skills: ['Fixture repair'], certifications: [{ id: 'safety-rollback', name: 'Safety rollback',
                issuer: 'Example Training', expiresOn: '2099-09-09', documentReference: 'CERT-ROLLBACK' }] } }]);
      await sourceWriter.query('ROLLBACK');
      expect(Number((await fixture.ownerPool.query(
        `SELECT count(*) count FROM canonical_forecast_workload_capacity_profile_events_v1
          WHERE organization_id=$1`, [fixture.org])).rows[0].count)).toBe(generationCount);

      await sourceWriter.query('BEGIN');
      await sourceWriter.query(
        `SELECT canonical_work_profile_mutate($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
        [fixture.org, actor('member').actorUserId, actor('member').actorAccessRole,
          actor('member').authSessionId, actor('member').csrfToken, actor('member').actorUserId, uuid(),
          { action: 'submit', expectedRevision: current.body.data.profile.revision,
            profile: { title: 'Service technician', summary: 'Concurrent qualification update.',
              skills: ['Fixture repair'], certifications: [{ id: 'safety-race', name: 'Safety race',
                issuer: 'Example Training', expiresOn: '2099-09-09', documentReference: 'CERT-RACE' }] } }]);
      await sourceReader.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      const readerPid = Number((await sourceReader.query('SELECT pg_backend_pid() pid')).rows[0].pid);
      const waiting = sourceReader.query(
        `SELECT canonical_forecast_workload_capacity_v1_review_current(
          $1,$2,$3,$4,'role_qualification',$5,$6,'technician') value`,
        [fixture.org, actor('owner').actorUserId, actor('owner').actorAccessRole,
          actor('owner').authSessionId, TARGETS[2], actor('member').actorUserId]);
      await waitForBackendLock(readerPid);
      await sourceWriter.query('COMMIT');
      expect((await waiting).rows[0].value.sourceCurrent).toBe(false);
      await sourceReader.query('COMMIT');
    } catch (error) {
      await sourceWriter.query('ROLLBACK').catch(() => {});
      await sourceReader.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      sourceWriter.release(); sourceReader.release();
    }
    await decideWorkProfile('member', 'reject');
    await submitWorkProfile('member', 'safety-v4');
    const restoredV4 = await decideWorkProfile('member', 'approve', ['safety-v4']);
    expect(restoredV4.id).not.toBe(approvedV4.id);
    expect(restoredV4.revision).toBeGreaterThan(approvedV4.revision);
    roleQualificationReviews.member = await refreshReview('role_qualification', TARGETS[2],
      actor('member').actorUserId, 'technician');
  }, 240000);

  test('refuses an over-bound complete labor population without a partial window receipt', async () => {
    // Exercise the genuine M23 record+accept writer 1,001 times. The exact
    // source population is visible; Part 5A must refuse it rather than SELECT
    // a convenient subset or persist a partial evaluation window. Place the
    // over-bound population in the second of the origin's two server-selected
    // windows so the first insert must roll back with the whole atomic action.
    await setClock(at(60));
    const sourceStart = new Date(at(30).getTime() + 10000);
    for (let index = 0; index < 1001; index += 1) {
      const start = new Date(sourceStart.getTime() + index * 2);
      await recordAcceptedLabor(boundLaborContext, start, new Date(start.getTime() + 1));
    }
    const installedCount = Number((await fixture.ownerPool.query(
      `SELECT count(*) count FROM canonical_labor_intervals WHERE organization_id=$1
        AND review_state='accepted' AND observed_start>=$2 AND observed_end<$3`,
      [fixture.org, at(30), at(60)])).rows[0].count);
    expect(installedCount).toBeGreaterThan(1000);
    const before = Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_workload_capacity_windows_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count);
    const beforeOrigins = Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_workload_capacity_origins_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count);
    const refused = await post('/windows/finalize', { windowStart: at(30).toISOString(),
      windowEnd: at(60).toISOString(),
      reason: 'Refuse rather than truncate the complete over-bound installed-source population.' });
    expect(refused.status).toBe(413);
    expect(Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_workload_capacity_windows_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count)).toBe(before);
    const refusedOrigin = await post('/origins', ORIGIN_BODY);
    expect(refusedOrigin.status).toBe(413);
    expect(Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_workload_capacity_windows_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count)).toBe(before);
    expect(Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_workload_capacity_origins_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count)).toBe(beforeOrigins);
  }, 600000);

  test('makes epoch supersession monotonic and requires complete new prospective recovery', async () => {
    const epochBody = reason => ({ reason, confirmed: true,
      confirmationVersion: 'm26-workload-capacity-epoch-v1' });
    const latestScheduledEnd = (await fixture.ownerPool.query(
      `SELECT max(scheduled_end) value
         FROM canonical_schedule_assignments
        WHERE organization_id=$1`, [fixture.org])).rows[0].value;
    const scenarioStart = new Date(Math.max(at(380).getTime(),
      latestScheduledEnd ? new Date(latestScheduledEnd).getTime() + (31 * 86400000) : 0));
    const scenarioAt = day => new Date(scenarioStart.getTime() + (day * 86400000));
    const refreshCompleteRoleReviews = async () => {
      for (const [name, role] of [['owner', 'owner'], ['admin', 'administrator'],
        ['dispatcher', 'dispatcher'], ['member', 'technician'], ['viewer', 'employee']]) {
        roleQualificationReviews[name] = await refreshReview('role_qualification', TARGETS[2],
          actor(name).actorUserId, role);
      }
    };

    // Restore the exact human-reviewed sources changed by earlier negative
    // cases before installing a new prospective boundary.  None of these
    // actions fabricates older coverage.
    await setClock(scenarioAt(-1));
    let token = await get(`/reviews/current?kind=method&target=${encodeURIComponent(TARGETS[0])}&subjectId=none&role=none`);
    await review({ kind: 'method', target: TARGETS[0], action: 'approve',
      expectedRevision: token.body.data.expectedRevision,
      expectedDigest: token.body.data.expectedDigest,
      reason: 'Owner reapproves the exact workload method before a new prospective epoch.' });
    token = await get(`/reviews/current?kind=capacity_role_scope&target=${encodeURIComponent(TARGETS[2])}&subjectId=none&role=none`);
    await review({ kind: 'capacity_role_scope', target: TARGETS[2], role: 'technician',
      expectedRevision: token.body.data.expectedRevision,
      expectedDigest: token.body.data.expectedDigest,
      reason: 'Owner restores the exact technician role scope before prospective recovery.' });
    await replaceAvailability(scenarioAt(-1), scenarioAt(240),
      availableIntervals(scenarioAt(-1), scenarioAt(240)));
    token = await get(`/reviews/current?kind=availability_basis&target=${encodeURIComponent(TARGETS[2])}` +
      `&subjectId=${actor('member').actorUserId}&role=none`);
    await review({ kind: 'availability_basis', target: TARGETS[2],
      subjectId: actor('member').actorUserId,
      expectedRevision: token.body.data.expectedRevision,
      expectedDigest: token.body.data.expectedDigest,
      reason: 'Owner approves the extended exact declared-availability source.' });

    // The guarded epoch entry waits behind its genuine M23 source table and a
    // rolled-back request persists neither the epoch nor its baseline rows.
    const epochCount = Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_workload_capacity_epochs_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count);
    const blocker = await fixture.ownerPool.connect();
    const epochWriter = await fixture.runtimePool.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('LOCK TABLE canonical_work_profile_events IN ROW EXCLUSIVE MODE');
      await epochWriter.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const pid = Number((await epochWriter.query('SELECT pg_backend_pid() pid')).rows[0].pid);
      const pending = epochWriter.query(
        `SELECT canonical_forecast_workload_capacity_v1_epoch_capture(
          $1,$2,$3,$4,$5,$6,$7,$8) value`,
        [fixture.org, actor('owner').actorUserId, actor('owner').actorAccessRole,
          actor('owner').authSessionId, actor('owner').csrfToken,
          `m26-p5a-epoch-rollback-${uuid()}`,
          'Exercise the exact guarded epoch source wait and rollback.',
          'm26-workload-capacity-epoch-v1']);
      await waitForBackendLock(pid);
      await blocker.query('COMMIT');
      expect((await pending).rows[0].value.state).toBe('workload_capacity_epoch_recorded');
      await epochWriter.query('ROLLBACK');
    } catch (error) {
      await blocker.query('ROLLBACK').catch(() => {});
      await epochWriter.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { blocker.release(); epochWriter.release(); }
    expect(Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_workload_capacity_epochs_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count)).toBe(epochCount);

    await setClock(scenarioAt(0));
    const epochTwoKey = `m26-p5a-epoch-two-${uuid()}`;
    const epochTwo = await post('/epochs', epochBody(
      'Begin the second explicit prospective installed-source coverage period.'), epochTwoKey);
    expect(epochTwo.status).toBe(201);
    expect((await post('/epochs', epochBody(
      'Begin the second explicit prospective installed-source coverage period.'), epochTwoKey)).body.data)
      .toMatchObject({ id: epochTwo.body.data.id, replayed: true });
    // Epoch capture records a fresh source baseline but grants no qualification.
    // Every applicable worker therefore receives a new explicit human review
    // against that exact immutable generation before the prospective period.
    await refreshCompleteRoleReviews();

    await setClock(scenarioAt(30));
    const oldWindowKey = `m26-p5a-epoch-two-window-${uuid()}`;
    const oldWindowBody = { windowStart: scenarioAt(0).toISOString(),
      windowEnd: scenarioAt(30).toISOString(),
      reason: 'Finalize one exact receipt under the second prospective epoch.' };
    const oldWindow = await post('/windows/finalize', oldWindowBody, oldWindowKey);
    expect(oldWindow.status).toBe(201);

    // A new epoch with no intervening source mutation still supersedes the old
    // coverage contract. It cannot rewrite or silently repurpose the receipt.
    await setClock(scenarioAt(31));
    const epochThreeKey = `m26-p5a-epoch-three-${uuid()}`;
    const epochThreeBody = epochBody(
      'Begin the third explicit prospective coverage period without source changes.');
    const epochThree = await post('/epochs', epochThreeBody, epochThreeKey);
    expect(epochThree.status).toBe(201);
    expect((await fixture.ownerPool.query(
      `SELECT canonical_forecast_workload_capacity_v1_window_current($1,value) current
         FROM canonical_forecast_workload_capacity_windows_v1 value
        WHERE value.organization_id=$1 AND value.id=$2`,
    [fixture.org, oldWindow.body.data.id])).rows[0].current).toBe(false);
    expect((await post('/windows/finalize', oldWindowBody, oldWindowKey)).status).toBe(409);
    expect((await post('/windows/finalize', oldWindowBody)).status).toBe(400);
    await refreshCompleteRoleReviews();

    await setClock(scenarioAt(91));
    const oldOriginKey = `m26-p5a-epoch-old-origin-${uuid()}`;
    const oldOrigin = await post('/origins', ORIGIN_BODY, oldOriginKey);
    expect(oldOrigin.status).toBe(201);
    expect((await get(`/origins/${oldOrigin.body.data.id}`)).body.data.state)
      .toBe('workload_capacity_origin_current');

    // Commit a genuine owning M23 profile and certification generation inside
    // the future interval, then rereview the exact new source.
    await setClock(scenarioAt(100));
    await submitWorkProfile('member', 'safety-epoch-transition');
    await decideWorkProfile('member', 'approve', ['safety-epoch-transition']);
    roleQualificationReviews.member = await refreshReview('role_qualification', TARGETS[2],
      actor('member').actorUserId, 'technician');
    expect((await get(`/origins/${oldOrigin.body.data.id}`)).body.data.state)
      .toBe('workload_capacity_origin_stale');

    await setClock(scenarioAt(101));
    const epochFourKey = `m26-p5a-epoch-four-${uuid()}`;
    const epochFourBody = epochBody(
      'Begin recovery coverage after the exact in-horizon M23 source transition.');
    const epochFour = await post('/epochs', epochFourBody, epochFourKey);
    expect(epochFour.status).toBe(201);
    await setClock(scenarioAt(102));
    const epochFiveKey = `m26-p5a-epoch-five-${uuid()}`;
    const epochFiveBody = epochBody(
      'Supersede recovery coverage explicitly without another source mutation.');
    const epochFive = await post('/epochs', epochFiveBody, epochFiveKey);
    expect(epochFive.status).toBe(201);
    await refreshCompleteRoleReviews();

    // Neither the absorbed source order nor another no-change epoch can revive
    // the immutable old origin or make its outcome/evaluation reachable.
    expect((await get(`/origins/${oldOrigin.body.data.id}`)).body.data.state)
      .toBe('workload_capacity_origin_stale');
    expect((await post('/origins', ORIGIN_BODY, oldOriginKey)).status).toBe(409);
    expect((await post('/epochs', epochFourBody, epochFourKey)).status).toBe(409);
    expect((await post('/epochs', epochFiveBody, epochFiveKey)).body.data)
      .toMatchObject({ id: epochFive.body.data.id, replayed: true });
    expect((await post('/epochs', { ...epochFiveBody,
      reason: `${epochFiveBody.reason} Changed authorization.` }, epochFiveKey)).status).toBe(409);
    await setClock(scenarioAt(121));
    const oldOutcomeCount = Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_workload_capacity_windows_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count);
    expect((await post('/windows/finalize', { windowStart: scenarioAt(91).toISOString(),
      windowEnd: scenarioAt(121).toISOString(),
      reason: 'An older epoch cannot authorize this outcome after supersession.' })).status).toBe(400);
    expect(Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_workload_capacity_windows_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count)).toBe(oldOutcomeCount);
    expect((await post(`/origins/${oldOrigin.body.data.id}/evaluations`, {})).status).toBe(409);

    // Only a complete prospective period under the current epoch permits a
    // distinct new origin and later outcome/evaluation.
    await setClock(scenarioAt(162));
    const recoveredOriginKey = `m26-p5a-epoch-recovered-origin-${uuid()}`;
    const recoveredOrigin = await post('/origins', ORIGIN_BODY, recoveredOriginKey);
    expect(recoveredOrigin.status).toBe(201);
    expect(recoveredOrigin.body.data.id).not.toBe(oldOrigin.body.data.id);
    await setClock(scenarioAt(192));
    const recoveredOutcomeKey = `m26-p5a-epoch-recovered-outcome-${uuid()}`;
    const recoveredOutcomeBody = {
      windowStart: scenarioAt(162).toISOString(),
      windowEnd: scenarioAt(192).toISOString(),
      reason: 'Finalize the distinct post-recovery workload outcome.' };
    const recoveredOutcome = await post('/windows/finalize', recoveredOutcomeBody, recoveredOutcomeKey);
    expect(recoveredOutcome.status).toBe(201);
    const recoveredEvaluationKey = `m26-p5a-epoch-recovered-evaluation-${uuid()}`;
    const recoveredEvaluation = await post(`/origins/${recoveredOrigin.body.data.id}/evaluations`, {},
      recoveredEvaluationKey);
    expect(recoveredEvaluation.status).toBe(201);
    expect((await get(`/origins/${recoveredOrigin.body.data.id}/evaluations/${recoveredEvaluation.body.data.id}`))
      .body.data.state).toBe('workload_capacity_evaluation_current');

    // A final no-change epoch retires the complete recovered lineage as one
    // coherent unit: training windows, origin, outcome and evaluation.
    await setClock(scenarioAt(200));
    const epochSix = await post('/epochs', epochBody(
      'Explicitly supersede the complete recovered lineage without source changes.'));
    expect(epochSix.status).toBe(201);
    expect((await get(`/origins/${recoveredOrigin.body.data.id}`)).body.data.state)
      .toBe('workload_capacity_origin_stale');
    expect((await get(`/origins/${recoveredOrigin.body.data.id}/evaluations/${recoveredEvaluation.body.data.id}`))
      .body.data.state).toBe('workload_capacity_evaluation_stale');
    expect((await fixture.ownerPool.query(
      `SELECT canonical_forecast_workload_capacity_v1_window_current($1,value) current
         FROM canonical_forecast_workload_capacity_windows_v1 value
        WHERE value.organization_id=$1 AND value.id=$2`,
    [fixture.org, recoveredOutcome.body.data.id])).rows[0].current).toBe(false);
    expect((await post('/origins', ORIGIN_BODY, recoveredOriginKey)).status).toBe(409);
    expect((await post('/windows/finalize', recoveredOutcomeBody, recoveredOutcomeKey)).status).toBe(409);
    expect((await post(`/origins/${recoveredOrigin.body.data.id}/evaluations`, {},
      recoveredEvaluationKey)).status).toBe(409);
  }, 300000);
  test('fences M24 corrections and keeps the declared-role scope a single exact stream', async () => {
    const beforeToken = await get(`/reviews/current?kind=remaining_work&target=${encodeURIComponent(TARGETS[1])}&subjectId=${negativeBacklogContext.appointment}&role=none`);
    expect(beforeToken.status).toBe(200);
    expect(beforeToken.body.data.sourceCurrent).toBe(true);
    const reviewCount = Number((await fixture.ownerPool.query(
      `SELECT count(*) count FROM canonical_forecast_workload_capacity_reviews_v1
        WHERE organization_id=$1 AND review_kind='remaining_work' AND subject_id=$2`,
      [fixture.org, negativeBacklogContext.appointment])).rows[0].count);
    const writer = await fixture.runtimePool.connect();
    const reader = await fixture.runtimePool.connect();
    try {
      await writer.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await mutateEstimateDecision(negativeBacklogContext, writer, 'concurrent');
      await reader.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      const readerPid = Number((await reader.query('SELECT pg_backend_pid() pid')).rows[0].pid);
      const waiting = reader.query(
        `SELECT canonical_forecast_workload_capacity_v1_review_current(
          $1,$2,$3,$4,'remaining_work',$5,$6,NULL) value`,
        [fixture.org, actor('owner').actorUserId, actor('owner').actorAccessRole,
          actor('owner').authSessionId, TARGETS[1], negativeBacklogContext.appointment]);
      await waitForBackendLock(readerPid);
      await writer.query('COMMIT');
      const after = (await waiting).rows[0].value;
      await reader.query('COMMIT');
      expect(after).toMatchObject({ state: 'workload_capacity_review_current',
        sourceCurrent: false, expectedRevision: beforeToken.body.data.expectedRevision,
        expectedDigest: beforeToken.body.data.expectedDigest });
    } catch (error) {
      await writer.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      await reader.query('ROLLBACK').catch(() => {});
      writer.release(); reader.release();
    }
    expect(Number((await fixture.ownerPool.query(
      `SELECT count(*) count FROM canonical_forecast_workload_capacity_reviews_v1
        WHERE organization_id=$1 AND review_kind='remaining_work' AND subject_id=$2`,
      [fixture.org, negativeBacklogContext.appointment])).rows[0].count)).toBe(reviewCount);
    await expect(fixture.ownerPool.query(
      'SELECT canonical_forecast_workload_capacity_v1_backlog_evidence($1,$2)',
      [fixture.org, at(210)])).rejects.toMatchObject({ code: '22023' });
    const withdrawal = await fixture.runtimePool.connect();
    try {
      await withdrawal.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await mutateEstimateDecision(negativeBacklogContext, withdrawal, 'withdrawal', 'withdraw');
      await withdrawal.query('COMMIT');
    } catch (error) {
      await withdrawal.query('ROLLBACK').catch(() => {}); throw error;
    } finally { withdrawal.release(); }
    expect((await get(`/reviews/current?kind=remaining_work&target=${encodeURIComponent(TARGETS[1])}&subjectId=${negativeBacklogContext.appointment}&role=none`)).body.data.sourceCurrent).toBe(false);

    const existingOrigin = (await fixture.ownerPool.query(
      `SELECT id,capacity_role FROM canonical_forecast_workload_capacity_origins_v1
        WHERE organization_id=$1 ORDER BY prediction_cutoff_at DESC LIMIT 1`, [fixture.org])).rows[0];
    expect(existingOrigin.capacity_role).toBe('technician');
    const scopeToken = await get(`/reviews/current?kind=capacity_role_scope&target=${encodeURIComponent(TARGETS[2])}&subjectId=none&role=none`);
    expect(scopeToken.status).toBe(200);
    expect(scopeToken.body.data.role).toBe('technician');
    const changed = await review({ kind: 'capacity_role_scope', target: TARGETS[2], role: 'administrator',
      expectedRevision: scopeToken.body.data.expectedRevision,
      expectedDigest: scopeToken.body.data.expectedDigest,
      reason: 'Owner explicitly changes the one declared-role capacity research scope.' });
    expect(changed.revision).toBe(scopeToken.body.data.expectedRevision + 1);
    const activeScopes = await fixture.ownerPool.query(
      `SELECT id,revision,operational_role,previous_id FROM canonical_forecast_workload_capacity_reviews_v1
        WHERE organization_id=$1 AND review_kind='capacity_role_scope' ORDER BY revision`, [fixture.org]);
    expect(activeScopes.rows.at(-1)).toMatchObject({ operational_role: 'administrator' });
    expect(activeScopes.rows.at(-1).previous_id).toBe(activeScopes.rows.at(-2).id);
    const loaded = await get(`/origins/${existingOrigin.id}`);
    expect(loaded.status).toBe(200);
    expect(loaded.body.data).toMatchObject({ id: existingOrigin.id, capacityRole: 'technician',
      state: 'workload_capacity_origin_stale', refreshRequired: true });
  }, 120000);

  test('enforces paid owner, CSRF and generic tenant isolation without partial rows', async () => {
    expect((await get('/prerequisites/current', 'admin')).status).toBe(200);
    expect((await get('/prerequisites/current', 'member')).status).toBe(403);
    const before = Number((await fixture.ownerPool.query('SELECT count(*) count FROM canonical_forecast_workload_capacity_epochs_v1')).rows[0].count);
    const noCsrf = await request(fixture.app).post(endpoint + '/epochs')
      .set('Cookie', actor('owner').session.headers.Cookie).set('Idempotency-Key', `m26-p5a-no-csrf-${uuid()}`)
      .send({ reason: 'This request intentionally lacks the CSRF proof.', confirmed: true,
        confirmationVersion: 'm26-workload-capacity-epoch-v1' });
    expect(noCsrf.status).toBe(403);
    expect(Number((await fixture.ownerPool.query('SELECT count(*) count FROM canonical_forecast_workload_capacity_epochs_v1')).rows[0].count)).toBe(before);
    const known = (await fixture.ownerPool.query(
      'SELECT id FROM canonical_forecast_workload_capacity_origins_v1 ORDER BY prediction_cutoff_at DESC LIMIT 1')).rows[0].id;
    expect((await get(`/origins/${known}`, 'otherOwner')).status).toBe(200);
    expect((await get(`/origins/${known}`, 'otherOwner')).body.data).toEqual({ state: 'not_found' });

    const unscheduleBefore = (await fixture.ownerPool.query(
      `SELECT revision,rtrim(canonical_digest) digest,id FROM canonical_schedule_assignments
        WHERE organization_id=$1 AND id=$2`, [fixture.org, negativeBacklogContext.assignment.id])).rows[0];
    const unscheduleBody = { expectedRevision: Number(unscheduleBefore.revision),
      expectedDigest: unscheduleBefore.digest,
      reason: 'Explicitly return this bounded negative-test assignment to the unscheduled queue.',
      confirmed: true, confirmationVersion: 'm26-workload-capacity-unschedule-v1' };
    const approvalCountBefore = Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_schedule_approvals WHERE organization_id=$1 AND assignment_id=$2',
      [fixture.org, negativeBacklogContext.assignment.id])).rows[0].count);
    expect((await post(`/backlog-items/${negativeBacklogContext.appointment}/unschedule`,
      unscheduleBody, `m26-p5a-member-unschedule-${uuid()}`, 'member')).status).toBe(403);
    const noUnscheduleCsrf = await request(part5aApp)
      .post(`${endpoint}/backlog-items/${negativeBacklogContext.appointment}/unschedule`)
      .set('X-Test-Actor', 'owner').set('Idempotency-Key', `m26-p5a-no-csrf-unschedule-${uuid()}`)
      .send(unscheduleBody);
    expect(noUnscheduleCsrf.status).toBe(403);
    expect((await post(`/backlog-items/${negativeBacklogContext.appointment}/unschedule`,
      unscheduleBody, `m26-p5a-other-unschedule-${uuid()}`, 'otherOwner')).status).toBe(404);
    expect((await post(`/backlog-items/${negativeBacklogContext.appointment}/unschedule`,
      { ...unscheduleBody, expectedRevision: Number(unscheduleBefore.revision) + 1 },
      `m26-p5a-stale-unschedule-${uuid()}`)).status).toBe(409);
    expect(Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_schedule_approvals WHERE organization_id=$1 AND assignment_id=$2',
      [fixture.org, negativeBacklogContext.assignment.id])).rows[0].count)).toBe(approvalCountBefore);

    // A genuine review writer holds the shared source fence through commit.
    // A concurrent HTTP read waits, then observes the committed rejection and
    // returns stale rather than painting a pre-writer current state.
    const sourceWriter = await fixture.runtimePool.connect();
    const sourceReader = await fixture.runtimePool.connect();
    const methodBefore = (await fixture.ownerPool.query(`SELECT revision,rtrim(digest) digest
      FROM canonical_forecast_workload_capacity_reviews_v1 WHERE organization_id=$1
       AND review_kind='method' AND target_key=$2 ORDER BY revision DESC LIMIT 1`,
    [fixture.org, TARGETS[1]])).rows[0];
    try {
      await sourceWriter.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await sourceWriter.query(`SELECT canonical_forecast_workload_capacity_v1_review_mutate(
        $1,$2,$3,$4,$5,$6,'method',$7,NULL,NULL,'reject',$8,$9,NULL,$10,
        'm26-workload-capacity-review-v1')`, [fixture.org, actor('owner').actorUserId,
        actor('owner').actorAccessRole, actor('owner').authSessionId, actor('owner').csrfToken,
        `m26-p5a-race-review-${uuid()}`, TARGETS[1], Number(methodBefore.revision),
        methodBefore.digest, 'Reject this method while a source-current read is waiting.']);
      await sourceReader.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      const sourceReaderPid = Number((await sourceReader.query('SELECT pg_backend_pid() pid')).rows[0].pid);
      const waitingRead = sourceReader.query(
        'SELECT canonical_forecast_workload_capacity_v1_origin_read($1,$2,$3,$4,$5) value',
        [fixture.org, actor('owner').actorUserId, actor('owner').actorAccessRole,
          actor('owner').authSessionId, known]);
      await waitForBackendLock(sourceReaderPid);
      await sourceWriter.query('COMMIT');
      const afterWriter = (await waitingRead).rows[0].value;
      await sourceReader.query('COMMIT');
      expect(afterWriter.state).toBe('workload_capacity_origin_stale');
    } catch (error) {
      await sourceWriter.query('ROLLBACK').catch(() => {}); throw error;
    } finally {
      await sourceReader.query('ROLLBACK').catch(() => {});
      sourceWriter.release(); sourceReader.release();
    }
    const methodRejected = (await fixture.ownerPool.query(`SELECT revision,rtrim(digest) digest
      FROM canonical_forecast_workload_capacity_reviews_v1 WHERE organization_id=$1
       AND review_kind='method' AND target_key=$2 ORDER BY revision DESC LIMIT 1`,
    [fixture.org, TARGETS[1]])).rows[0];
    await review({ kind: 'method', target: TARGETS[1], expectedRevision: Number(methodRejected.revision),
      expectedDigest: methodRejected.digest, reason: 'Reapprove the exact method after the serialized race proof.' });

    // Access is locked before any source wait. A subscription revocation cannot
    // overtake an authorized request: it waits, the request completes under the
    // locked authority, then every later request fails closed after revocation.
    const sourceBlocker = await fixture.ownerPool.connect();
    const subscriptionWriter = await fixture.ownerPool.connect();
    const accessReader = await fixture.runtimePool.connect();
    try {
      await sourceBlocker.query('BEGIN');
      await sourceBlocker.query('LOCK TABLE canonical_labor_intervals IN ROW EXCLUSIVE MODE');
      await accessReader.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      const accessReaderPid = Number((await accessReader.query('SELECT pg_backend_pid() pid')).rows[0].pid);
      const waitingPrerequisites = accessReader.query(
        'SELECT canonical_forecast_workload_capacity_v1_prerequisites($1,$2,$3,$4) value',
        [fixture.org, actor('owner').actorUserId, actor('owner').actorAccessRole,
          actor('owner').authSessionId]);
      await waitForBackendLock(accessReaderPid);
      await subscriptionWriter.query('BEGIN');
      let subscriptionCommitted = false;
      const revoke = subscriptionWriter.query(
        "UPDATE subscriptions SET status='past_due' WHERE organization_id=$1", [fixture.org])
        .then(() => { subscriptionCommitted = true; });
      await new Promise(resolve => setTimeout(resolve, 80));
      expect(subscriptionCommitted).toBe(false);
      await sourceBlocker.query('COMMIT');
      expect((await waitingPrerequisites).rows[0].value.state).toBe('workload_capacity_prerequisites_current');
      await accessReader.query('COMMIT');
      await revoke;
      await subscriptionWriter.query('COMMIT');
      expect((await get('/prerequisites/current')).status).toBe(403);
    } catch (error) {
      await sourceBlocker.query('ROLLBACK').catch(() => {});
      await subscriptionWriter.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      await accessReader.query('ROLLBACK').catch(() => {});
      sourceBlocker.release(); subscriptionWriter.release(); accessReader.release();
    }
    await fixture.ownerPool.query("UPDATE subscriptions SET status='active' WHERE organization_id=$1", [fixture.org]);

    // The explicit unschedule action locks paid access before waiting on its
    // owning M22 assignment. Subscription revocation therefore cannot
    // overtake the authorized mutation; once that exact mutation commits,
    // later requests fail closed and no hidden second schedule write occurs.
    const scheduleBlocker = await fixture.ownerPool.connect();
    const scheduleAccess = await fixture.runtimePool.connect();
    const scheduleSubscriptionWriter = await fixture.ownerPool.connect();
    const unscheduleKey = `m26-p5a-race-unschedule-${uuid()}`;
    try {
      await scheduleBlocker.query('BEGIN');
      await scheduleBlocker.query(`SELECT 1 FROM canonical_schedule_assignments
        WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
      [fixture.org, negativeBacklogContext.assignment.id]);
      await scheduleAccess.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const scheduleAccessPid = Number((await scheduleAccess.query('SELECT pg_backend_pid() pid')).rows[0].pid);
      const waitingUnschedule = scheduleAccess.query(
        `SELECT canonical_forecast_workload_capacity_v1_backlog_unschedule(
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) value`,
        [fixture.org, actor('owner').actorUserId, actor('owner').actorAccessRole,
          actor('owner').authSessionId, actor('owner').csrfToken, unscheduleKey,
          negativeBacklogContext.appointment, Number(unscheduleBefore.revision),
          unscheduleBefore.digest, unscheduleBody.reason,
          unscheduleBody.confirmationVersion]);
      await waitForBackendLock(scheduleAccessPid);
      await scheduleSubscriptionWriter.query('BEGIN');
      let scheduleRevocationCommitted = false;
      const scheduleRevoke = scheduleSubscriptionWriter.query(
        "UPDATE subscriptions SET status='past_due' WHERE organization_id=$1", [fixture.org])
        .then(() => { scheduleRevocationCommitted = true; });
      await new Promise(resolve => setTimeout(resolve, 80));
      expect(scheduleRevocationCommitted).toBe(false);
      await scheduleBlocker.query('COMMIT');
      const unscheduled = (await waitingUnschedule).rows[0].value;
      expect(unscheduled).toMatchObject({ state: 'workload_capacity_backlog_unscheduled',
        appointmentId: negativeBacklogContext.appointment, replayed: false });
      await scheduleAccess.query('COMMIT');
      await scheduleRevoke;
      await scheduleSubscriptionWriter.query('COMMIT');
      expect((await post(`/backlog-items/${negativeBacklogContext.appointment}/unschedule`,
        unscheduleBody, unscheduleKey)).status).toBe(403);
    } catch (error) {
      await scheduleBlocker.query('ROLLBACK').catch(() => {});
      await scheduleSubscriptionWriter.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      await scheduleAccess.query('ROLLBACK').catch(() => {});
      scheduleBlocker.release(); scheduleAccess.release(); scheduleSubscriptionWriter.release();
    }
    await fixture.ownerPool.query("UPDATE subscriptions SET status='active' WHERE organization_id=$1", [fixture.org]);
    expect(Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_schedule_approvals WHERE organization_id=$1 AND assignment_id=$2',
      [fixture.org, negativeBacklogContext.assignment.id])).rows[0].count)).toBe(approvalCountBefore + 1);
    expect((await post(`/backlog-items/${negativeBacklogContext.appointment}/unschedule`,
      { ...unscheduleBody, reason: `${unscheduleBody.reason} Changed.` }, unscheduleKey)).status).toBe(409);
    expect(Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_schedule_approvals WHERE organization_id=$1 AND assignment_id=$2',
      [fixture.org, negativeBacklogContext.assignment.id])).rows[0].count)).toBe(approvalCountBefore + 1);

    await fixture.ownerPool.query("UPDATE subscriptions SET status='past_due' WHERE organization_id=$1", [fixture.org]);
    expect((await get('/prerequisites/current')).status).toBe(403);
    await fixture.ownerPool.query("UPDATE subscriptions SET status='active' WHERE organization_id=$1", [fixture.org]);
    const method = (await fixture.ownerPool.query(`SELECT revision,rtrim(digest) digest
      FROM canonical_forecast_workload_capacity_reviews_v1 WHERE organization_id=$1
       AND review_kind='method' AND target_key=$2 ORDER BY revision DESC LIMIT 1`,
    [fixture.org, TARGETS[0]])).rows[0];
    await review({ kind: 'method', target: TARGETS[0], action: 'reject',
      expectedRevision: Number(method.revision), expectedDigest: method.digest,
      reason: 'Owner rejects this exact research method until a new explicit review.' });
    const originCount = Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_workload_capacity_origins_v1')).rows[0].count);
    expect((await post('/origins', ORIGIN_BODY)).status).toBe(400);
    expect(Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_workload_capacity_origins_v1')).rows[0].count)).toBe(originCount);
  });
});
