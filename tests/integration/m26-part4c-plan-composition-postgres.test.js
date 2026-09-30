'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const { normalizeScheduleMutation } = require('../../src/scheduling/contract');
const { updateAppointmentSchedule } = require('../../src/scheduling/repository');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const uuid = () => crypto.randomUUID();
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

realPostgres('Mission 26 Part 4C bounded reviewed-plan backlog composition', () => {
  let fixture;
  beforeAll(async () => {
    fixture = await createDatabaseFixture({ operationalSchedule: true });
  }, 120000);
  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  async function seedPlan(context) {
    const actor = fixture.actors.owner;
    const source = (await fixture.ownerPool.query(
      `SELECT a.operation_id,a.graph_id,a.opportunity_id,o.customer_id,t.id transcript_id
       FROM canonical_appointments a
       JOIN canonical_opportunities o
        ON o.organization_id=a.organization_id AND o.id=a.opportunity_id
       JOIN canonical_transcripts t
        ON t.organization_id=a.organization_id AND t.operation_id=a.operation_id
       WHERE a.organization_id=$1 AND a.id=$2`,
      [fixture.org, context.appointment])).rows[0];
    const estimateId = uuid(), decisionId = uuid(), planId = uuid();
    const fingerprint = hash(`composition-estimate:${estimateId}`);
    const decisionDigest = hash(`composition-decision:${decisionId}`);
    const planDigest = hash(`composition-plan:${planId}`);
    await fixture.ownerPool.query(
      `INSERT INTO canonical_estimates(id,organization_id,operation_id,graph_id,
         opportunity_id,calculation_version,normalized_input_fingerprint,
         business_profile_version,business_profile_hash,currency,customer_price,
         line_items,calculation_output,snapshot_digest)
       VALUES($1,$2,$3,$4,$5,'m19-part3-canonical-v2',$6,'org-profile-v1',$6,
         'USD',500,'[]','{}',$6)`,
      [estimateId, fixture.org, source.operation_id, source.graph_id,
        source.opportunity_id, fingerprint]);
    await fixture.ownerPool.query(
      `INSERT INTO canonical_polaris_snapshots(
         id,organization_id,operation_id,graph_id,customer_id,transcript_id,
         opportunity_id,estimate_id,calculation_version,
         normalized_input_fingerprint,business_profile_version,
         business_profile_hash,supporting_fact_ids,snapshot,snapshot_digest)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,'m19-part3-canonical-v2',$9,
         'org-profile-v1',$9,'{}',$10,$9)`,
      [uuid(), fixture.org, source.operation_id, source.graph_id, source.customer_id,
        source.transcript_id, source.opportunity_id, estimateId, fingerprint,
        { service: { key: 'Plumbing' } }]);
    const sourcePins = (await fixture.ownerPool.query(
      'SELECT canonical_estimate_decision_source($1,$2) pins',
      [fixture.org, estimateId])).rows[0].pins;
    const sourceEvidence = { kind: 'my_estimate', reference: '',
      note: 'Fictional composition source', effectiveOn: null, endsOn: null,
      geography: '' };
    const inputs = { serviceKey: 'Plumbing', lines: [{ lineId: uuid(),
      task: 'Fictional composition work', basis: 'worker_hours', workerHours: '4',
      people: null, elapsedHours: null, quantity: null, unit: null,
      hoursPerUnit: null, rateMode: 'all_in', hourlyCost: '50.00',
      burdenPercent: null, quantitySource: sourceEvidence, rateSource: sourceEvidence }],
    assessment: { date: '2026-09-30', cautions: [], acknowledged: true,
      explanation: 'Fictional mounted composition.' } };
    await fixture.ownerPool.query(
      `INSERT INTO canonical_estimate_decisions(
         id,organization_id,estimate_id,revision,previous_id,action,actor_user_id,
         membership_id,auth_session_id,actor_name,source_pins,scope_summary,
         price_before_tax,currency,reason,confirmation_version,request_key_hash,
         request_digest,digest)
       VALUES($1,$2,$3,1,NULL,'approve',$4,$4,$5,'Synthetic owner',$6,
         'Fictional composition scope','500.00','USD','Fictional approval',
         'estimate-quote-preparation-v1',$7,$8,$9)`,
      [decisionId, fixture.org, estimateId, actor.actorUserId, actor.authSessionId,
        sourcePins, hash(uuid()), hash(uuid()), decisionDigest]);
    await fixture.ownerPool.query(
      `INSERT INTO canonical_labor_plans(
         id,organization_id,estimate_id,revision,previous_id,action,actor_user_id,
         membership_id,auth_session_id,actor_name,source_pins,inputs,
         expected_decision_revision,expected_decision_digest,currency,reason,
         confirmation_version,request_key_hash,request_digest,digest)
       VALUES($1,$2,$3,1,NULL,'save',$4,$4,$5,'Synthetic owner',$6,$7,
         1,$8,'USD','Fictional labor review','estimate-labor-plan-v1',$9,$10,$11)`,
      [planId, fixture.org, estimateId, actor.actorUserId, actor.authSessionId,
        sourcePins, inputs, decisionDigest, hash(uuid()), hash(uuid()), planDigest]);
    return { estimateId, decisionDigest, planId, planDigest, sourcePins };
  }

  function reviewBody(context, plan, current = null) {
    return { action: 'approve', expectedCurrentReviewId: current?.id || null,
      expectedCurrentReviewDigest: current?.digest || 'none',
      assignmentId: context.assignment.id,
      expectedAssignmentRevision: Number(context.assignment.revision),
      expectedAssignmentDigest: context.assignment.digest,
      estimateId: plan.estimateId, laborPlanId: plan.planId,
      expectedLaborPlanRevision: 1, expectedLaborPlanDigest: plan.planDigest,
      reason: 'Owner reviewed exact fictional composition source.', confirmed: true,
      confirmationVersion: 'm26-current-backlog-person-plan-v1' };
  }

  async function postReview(context, plan, current = null) {
    return request(fixture.app)
      .post(`/api/v1/forecast/current-backlog/person-plan-sources/${context.appointment}/reviews`)
      .set(fixture.actors.owner.session.headers)
      .set('Idempotency-Key', `m26-p4c-composition-review-${uuid()}`)
      .send(reviewBody(context, plan, current));
  }

  function capture(requestKey = `m26-p4c-composition-${uuid()}`, actor = 'owner') {
    return request(fixture.app).post('/api/v1/forecast/current-backlog/snapshots')
      .set(fixture.actors[actor].session.headers).set('Idempotency-Key', requestKey)
      .send({});
  }

  async function reschedule(context) {
    const before = (await fixture.ownerPool.query(
      `SELECT revision,rtrim(canonical_digest) digest,scheduled_start,scheduled_end,
        appointment_status FROM canonical_schedule_assignments
       WHERE organization_id=$1 AND appointment_id=$2`,
      [fixture.org, context.appointment])).rows[0];
    const result = await updateAppointmentSchedule(fixture.ownerPool,
      normalizeScheduleMutation({ organizationId: fixture.org,
        actorUserId: fixture.actors.owner.actorUserId,
        actorAccessRole: fixture.actors.owner.actorAccessRole,
        authSessionId: fixture.actors.owner.authSessionId,
        appointmentId: context.appointment, explicitSession: null,
        idempotencyKey: `m26-p4c-composition-schedule-${uuid()}`,
        body: { expectedRevision: Number(before.revision), expectedDigest: before.digest,
          expectedTimeZone: 'UTC', action: 'calendar_edit',
          scheduledStart: new Date(before.scheduled_start.getTime() + 86400000).toISOString(),
          scheduledEnd: new Date(before.scheduled_end.getTime() + 86400000).toISOString(),
          status: before.appointment_status, reason: 'Fictional composition reschedule.' } }));
    context.assignment = result.body.data.scheduleAuthority;
  }

  test('withholds incomplete composition, saves the all-reviewed total, and invalidates genuine writers', async () => {
    const left = await fixture.createExecution({ approvedScheduling: true,
      stopAfterScheduling: true, start: '2027-12-20T13:00:00.000Z' });
    const right = await fixture.createExecution({ approvedScheduling: true,
      stopAfterScheduling: true, start: '2027-12-21T13:00:00.000Z' });
    const leftPlan = await seedPlan(left), rightPlan = await seedPlan(right);
    const leftReview = await postReview(left, leftPlan);
    expect(leftReview.status).toBe(201);

    const missing = await capture();
    expect(missing.status).toBe(201);
    expect(missing.body.data).toMatchObject({ knownBacklogCount: 2,
      plannedPersonMinutes: null, backlogHoursState: 'unavailable',
      backlogHoursReason: 'reviewed_person_hour_plan_missing',
      sourceCoverageComplete: false, probabilityCalibrated: false,
      forecastIssued: false, paidNumericServing: false });

    const rightReview = await postReview(right, rightPlan);
    expect(rightReview.status).toBe(201);
    const allKey = `m26-p4c-composition-all-${uuid()}`;
    const all = await capture(allKey);
    expect(all.status).toBe(201);
    expect(all.body.data).toMatchObject({ knownBacklogCount: 2,
      plannedPersonMinutes: '480.000000', backlogHoursState: 'available',
      backlogHoursReason: null, sourceCoverageComplete: false,
      offPlatformCoverageVerified: false, providerCoverageVerified: false,
      probabilityCalibrated: false, forecastIssued: false, paidNumericServing: false });
    expect(JSON.stringify(all.body)).not.toMatch(new RegExp(
      [left.appointment, right.appointment, leftPlan.estimateId, rightPlan.estimateId].join('|')));

    await reschedule(left);
    const scheduleStale = await request(fixture.app)
      .get(`/api/v1/forecast/current-backlog/snapshots/${all.body.data.id}`)
      .set(fixture.actors.owner.session.headers);
    expect(scheduleStale.status).toBe(200);
    expect(scheduleStale.body.data).toMatchObject({ state: 'source_stale',
      plannedPersonMinutes: null, backlogHoursState: 'unavailable',
      backlogHoursReason: 'source_changed_after_capture', sourceAuthenticated: false });

    const refreshedLeft = await postReview(left, leftPlan, leftReview.body.data.review);
    expect(refreshedLeft.status).toBe(201);
    const currentKey = `m26-p4c-composition-current-${uuid()}`;
    const current = await capture(currentKey);
    expect(current.status).toBe(201);
    expect(current.body.data.plannedPersonMinutes).toBe('480.000000');

    const actor = fixture.actors.owner;
    const changed = await fixture.runtimePool.connect();
    try {
      await changed.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await changed.query(
        `SELECT canonical_estimate_decision_mutate($1,$2,$3,$4,$5,$6,$7,$8)`,
        [fixture.org, actor.actorUserId, actor.actorAccessRole, actor.authSessionId,
          rightPlan.estimateId, actor.csrfToken, `m26-p4c-composition-decision-${uuid()}`,
          { action: 'approve', expectedRevision: 1,
            expectedDigest: rightPlan.decisionDigest, sourcePins: rightPlan.sourcePins,
            scopeSummary: 'Fictional changed composition scope', priceBeforeTax: '500.00',
            currency: 'USD', reason: 'Fictional current-source mutation.', confirmed: true,
            confirmationVersion: 'estimate-quote-preparation-v1' }]);
      await changed.query('COMMIT');
    } catch (error) {
      await changed.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { changed.release(); }
    const sourceStale = await request(fixture.app)
      .get(`/api/v1/forecast/current-backlog/snapshots/${current.body.data.id}`)
      .set(actor.session.headers);
    expect(sourceStale.status).toBe(200);
    expect(sourceStale.body.data).toMatchObject({ state: 'source_stale',
      plannedPersonMinutes: null, backlogHoursReason: 'source_changed_after_capture' });
    const replay = await capture(currentKey);
    expect(replay.status).toBe(200);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body.data).toMatchObject({ replayed: true, state: 'source_stale',
      plannedPersonMinutes: null, backlogHoursReason: 'source_changed_after_capture' });
  }, 120000);

  test('keeps private composition authority entry-only and startup-mandatory', async () => {
    expect((await capture(undefined, 'member')).status).toBe(403);
    await expect(fixture.runtimePool.query(
      `SELECT canonical_forecast_current_backlog_snapshot_source_lock(value)
       FROM canonical_forecast_current_backlog_snapshots value LIMIT 1`))
      .rejects.toMatchObject({ code: '42501' });
    const missing = await fixture.ownerPool.connect();
    try {
      await missing.query('BEGIN');
      await missing.query(`ALTER FUNCTION
        canonical_forecast_current_backlog_snapshot_source_lock(
          canonical_forecast_current_backlog_snapshots)
        RENAME TO canonical_forecast_current_backlog_snapshot_source_lock_missing`);
      await expect(fixture.db.grantAndVerifyRuntimeAuthorityForTests(missing,
        { runtimeRole: fixture.roles.runtime }))
        .rejects.toThrow('Required current backlog snapshot authority is missing');
    } finally { await missing.query('ROLLBACK').catch(() => {}); missing.release(); }
    const leaked = await fixture.ownerPool.connect();
    try {
      await leaked.query('BEGIN');
      await leaked.query(`GRANT EXECUTE ON FUNCTION
        canonical_forecast_current_backlog_snapshot_source_lock(
          canonical_forecast_current_backlog_snapshots) TO PUBLIC`);
      await expect(fixture.db.grantAndVerifyRuntimeAuthorityForTests(leaked,
        { runtimeRole: fixture.roles.runtime }))
        .rejects.toThrow('Runtime database role privilege verification failed');
    } finally { await leaked.query('ROLLBACK').catch(() => {}); leaked.release(); }
  }, 120000);

  test('refuses capture while a person-plan review writer is uncommitted', async () => {
    const context = await fixture.createExecution({ approvedScheduling: true,
      stopAfterScheduling: true, start: '2027-12-22T13:00:00.000Z' });
    const plan = await seedPlan(context), actor = fixture.actors.owner;
    const body = {
      action: 'approve', expectedCurrentReviewId: null,
      expectedCurrentReviewDigest: 'none', assignmentId: context.assignment.id,
      expectedAssignmentRevision: Number(context.assignment.revision),
      expectedAssignmentDigest: context.assignment.digest, estimateId: plan.estimateId,
      laborPlanId: plan.planId, expectedLaborPlanRevision: 1,
      expectedLaborPlanDigest: plan.planDigest,
      reason: 'Fictional uncommitted composition review.', confirmed: true,
      confirmationVersion: 'm26-current-backlog-person-plan-v1' };
    const captureKey = `m26-p4c-composition-busy-${uuid()}`;
    const writer = await fixture.runtimePool.connect();
    const captureClient = await fixture.runtimePool.connect();
    try {
      await writer.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await writer.query(
        `SELECT canonical_forecast_backlog_person_plan_mutate($1,$2,$3,$4,$5,$6,$7,$8)`,
        [fixture.org, actor.actorUserId, actor.actorAccessRole, actor.authSessionId,
          actor.csrfToken, `m26-p4c-composition-held-review-${uuid()}`,
          context.appointment, body]);
      await captureClient.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await expect(captureClient.query(
        `SELECT canonical_forecast_current_backlog_snapshot_capture(
          $1,$2,$3,$4,$5,$6)`,
        [fixture.org, actor.actorUserId, actor.actorAccessRole, actor.authSessionId,
          actor.csrfToken, captureKey]))
        .rejects.toMatchObject({ code: '55P03' });
    } finally {
      await captureClient.query('ROLLBACK').catch(() => {});
      await writer.query('ROLLBACK').catch(() => {});
      captureClient.release(); writer.release();
    }
    expect((await fixture.ownerPool.query(
      `SELECT count(*)::integer count
       FROM canonical_forecast_current_backlog_snapshots
       WHERE organization_id=$1 AND request_key_hash=$2`,
      [fixture.org, hash(captureKey)])).rows[0].count).toBe(0);
  }, 120000);

  test('holds paid authority and rechecks trial expiry immediately before persistence', async () => {
    const context = await fixture.createExecution({ approvedScheduling: true,
      stopAfterScheduling: true, start: '2027-12-23T13:00:00.000Z' });
    const actor = fixture.actors.owner;
    await fixture.ownerPool.query(
      `WITH witness AS MATERIALIZED (
         SELECT clock_timestamp()+interval '3 seconds' trial_end
       )
       UPDATE subscriptions
       SET status='trialing',
           trial_started_at=witness.trial_end-interval '14 days',
           trial_ends_at=witness.trial_end
       FROM witness
       WHERE organization_id=$1`, [fixture.org]);
    const captureKey = `m26-p4c-composition-expiry-${uuid()}`;
    const blocker = await fixture.ownerPool.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,
        [`m26:current-backlog:${fixture.org}:${actor.actorUserId}:${hash(captureKey)}`]);
      const captureClient = await fixture.runtimePool.connect();
      const capturePromise = (async () => {
        try {
          await captureClient.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
          await captureClient.query(
            `SELECT canonical_forecast_current_backlog_snapshot_capture(
              $1,$2,$3,$4,$5,$6)`,
            [fixture.org, actor.actorUserId, actor.actorAccessRole,
              actor.authSessionId, actor.csrfToken, captureKey]);
          await captureClient.query('COMMIT');
          return { value: true };
        } catch (error) {
          await captureClient.query('ROLLBACK').catch(() => {});
          return { error };
        } finally { captureClient.release(); }
      })();
      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt += 1) {
        const observed = await fixture.ownerPool.query(
          `SELECT EXISTS(SELECT 1 FROM pg_locks
            WHERE locktype='advisory' AND granted=FALSE) waiting`);
        waiting = observed.rows[0].waiting;
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
      await new Promise(resolve => setTimeout(resolve, 3200));
      await blocker.query('COMMIT');
      const outcome = await capturePromise;
      expect(outcome.error).toMatchObject({ code: '42501' });
      expect(outcome.value).toBeUndefined();
      expect((await fixture.ownerPool.query(
        `SELECT count(*)::integer count
         FROM canonical_forecast_current_backlog_snapshots
         WHERE organization_id=$1 AND request_key_hash=$2`,
        [fixture.org, hash(captureKey)])).rows[0].count).toBe(0);
    } finally {
      await blocker.query('ROLLBACK').catch(() => {});
      blocker.release();
      await fixture.ownerPool.query(
        `UPDATE subscriptions SET status='active',trial_started_at=NULL,trial_ends_at=NULL
         WHERE organization_id=$1`, [fixture.org]);
    }
  }, 120000);
});
