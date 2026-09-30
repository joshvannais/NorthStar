'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const { normalizeScheduleMutation } = require('../../src/scheduling/contract');
const { updateAppointmentSchedule } = require('../../src/scheduling/repository');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const uuid = () => crypto.randomUUID();
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

realPostgres('Mission 26 Part 4C reviewed person-hour plan source', () => {
  let fixture;
  beforeAll(async () => {
    fixture = await createDatabaseFixture({ operationalSchedule: true });
  }, 120000);
  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  async function seedApprovedPlan(context, { oversized = false, stalePins = false } = {}) {
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
    const fingerprint = hash(`person-plan-estimate:${estimateId}`);
    const decisionDigest = hash(`person-plan-decision:${decisionId}`);
    const planDigest = hash(`person-plan:${planId}`);
    const sourceEvidence = { kind: 'my_estimate', reference: '', note: 'Fictional source',
      effectiveOn: null, endsOn: null, geography: '' };
    const inputs = {
      serviceKey: 'Plumbing',
      lines: [oversized ? {
        lineId: uuid(), task: 'Fictional oversized mounted repair',
        basis: 'quantity_productivity', workerHours: null, people: null,
        elapsedHours: null, quantity: '10000000', unit: 'ea',
        hoursPerUnit: '10000000', rateMode: 'all_in', hourlyCost: null,
        burdenPercent: null, quantitySource: sourceEvidence, rateSource: sourceEvidence,
      } : {
        lineId: uuid(), task: 'Fictional mounted repair', basis: 'worker_hours',
        workerHours: '4', people: null, elapsedHours: null, quantity: null,
        unit: null, hoursPerUnit: null, rateMode: 'all_in', hourlyCost: '50.00',
        burdenPercent: null,
        quantitySource: sourceEvidence, rateSource: sourceEvidence,
      }],
      assessment: { date: '2026-09-30', cautions: [], acknowledged: true,
        explanation: 'Fictional mounted review.' },
    };
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
      [uuid(), fixture.org, source.operation_id, source.graph_id,
        source.customer_id, source.transcript_id, source.opportunity_id,
        estimateId, fingerprint, { service: { key: 'Plumbing' } }]);
    const sourcePins = (await fixture.ownerPool.query(
      `SELECT canonical_estimate_decision_source($1,$2) pins`,
      [fixture.org, estimateId])).rows[0].pins;
    expect(sourcePins).not.toBeNull();
    const storedPins = stalePins ? {} : sourcePins;
    await fixture.ownerPool.query(
      `INSERT INTO canonical_estimate_decisions(
         id,organization_id,estimate_id,revision,previous_id,action,actor_user_id,
         membership_id,auth_session_id,actor_name,source_pins,scope_summary,
         price_before_tax,currency,reason,confirmation_version,request_key_hash,
         request_digest,digest)
       VALUES($1,$2,$3,1,NULL,'approve',$4,$4,$5,'Synthetic owner',$6,
         'Fictional mounted scope','500.00','USD','Fictional mounted approval',
         'estimate-quote-preparation-v1',$7,$8,$9)`,
      [decisionId, fixture.org, estimateId, actor.actorUserId, actor.authSessionId,
        storedPins, hash(uuid()), hash(uuid()), decisionDigest]);
    await fixture.ownerPool.query(
      `INSERT INTO canonical_labor_plans(
         id,organization_id,estimate_id,revision,previous_id,action,actor_user_id,
         membership_id,auth_session_id,actor_name,source_pins,inputs,
         expected_decision_revision,expected_decision_digest,currency,reason,
         confirmation_version,request_key_hash,request_digest,digest)
       VALUES($1,$2,$3,1,NULL,'save',$4,$4,$5,'Synthetic owner',$6,$7,
         1,$8,'USD','Fictional mounted labor review','estimate-labor-plan-v1',
         $9,$10,$11)`,
      [planId, fixture.org, estimateId, actor.actorUserId, actor.authSessionId,
        storedPins, inputs, decisionDigest, hash(uuid()), hash(uuid()), planDigest]);
    return { estimateId, decisionId, decisionDigest, planId, planDigest, sourcePins };
  }

  function approvalBody(context, plan) {
    return {
      action: 'approve', expectedCurrentReviewId: null,
      expectedCurrentReviewDigest: 'none', assignmentId: context.assignment.id,
      expectedAssignmentRevision: Number(context.assignment.revision),
      expectedAssignmentDigest: context.assignment.digest,
      estimateId: plan.estimateId, laborPlanId: plan.planId,
      expectedLaborPlanRevision: 1, expectedLaborPlanDigest: plan.planDigest,
      reason: 'Owner reviewed this exact fictional booking and labor plan.',
      confirmed: true, confirmationVersion: 'm26-current-backlog-person-plan-v1',
    };
  }

  function revisedDecisionBody(plan) {
    return {
      action: 'approve', expectedRevision: 1, expectedDigest: plan.decisionDigest,
      sourcePins: plan.sourcePins, scopeSummary: 'Fictional revised mounted scope',
      priceBeforeTax: '500.00', currency: 'USD',
      reason: 'Fictional concurrent mounted approval.', confirmed: true,
      confirmationVersion: 'estimate-quote-preparation-v1',
    };
  }

  async function waitForNonAdvisoryLock() {
    let waiting = false;
    for (let attempt = 0; attempt < 100 && !waiting; attempt += 1) {
      const observed = await fixture.ownerPool.query(
        `SELECT EXISTS(
           SELECT 1 FROM pg_locks
           WHERE granted=FALSE AND locktype<>'advisory') waiting`);
      waiting = observed.rows[0].waiting;
      if (!waiting) await new Promise(resolve => setTimeout(resolve, 20));
    }
    expect(waiting).toBe(true);
  }

  function post(context, body, requestKey, actor = 'owner') {
    return request(fixture.app)
      .post(`/api/v1/forecast/current-backlog/person-plan-sources/${context.appointment}/reviews`)
      .set(fixture.actors[actor].session.headers)
      .set('Idempotency-Key', requestKey).send(body);
  }

  async function directMutate(context, body, requestKey) {
    const actor = fixture.actors.owner;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const client = await fixture.runtimePool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        const value = (await client.query(
          `SELECT canonical_forecast_backlog_person_plan_mutate(
            $1,$2,$3,$4,$5,$6,$7,$8) value`,
          [fixture.org, actor.actorUserId, actor.actorAccessRole,
            actor.authSessionId, actor.csrfToken, requestKey,
            context.appointment, body])).rows[0].value;
        await client.query('COMMIT');
        return value;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (!['40001', '23505'].includes(error.code) || attempt === 1) throw error;
      } finally { client.release(); }
    }
    throw new Error('Concurrent mutation retry exhausted');
  }

  test('composes an exact scheduled booking with a current reviewed labor plan privately', async () => {
    const context = await fixture.createExecution({ approvedScheduling: true,
      stopAfterScheduling: true });
    const plan = await seedApprovedPlan(context);
    const requestKey = `m26-p4c-person-plan-${uuid()}`;
    const created = await post(context, approvalBody(context, plan), requestKey);
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ replayed: false, review: {
      appointmentId: context.appointment, revision: 1, action: 'approve',
      state: 'approved', plannedPersonMinutes: '240.000000',
      sourceAuthority: 'owner_reviewed_m24_labor_plan_for_authenticated_booking',
      sourceAuthenticated: true, sourceCurrent: true, knownSubsetOnly: true,
      sourceCoverageComplete: false, offPlatformCoverageVerified: false,
      providerCoverageVerified: false, forecastIssued: false, paidNumericServing: false,
    } });
    const serialized = JSON.stringify(created.body);
    expect(serialized).not.toContain(plan.estimateId);
    expect(serialized).not.toContain(plan.planId);
    expect(serialized).not.toContain(plan.planDigest);

    const replay = await post(context, approvalBody(context, plan), requestKey);
    expect(replay.status).toBe(200);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body.data.review.id).toBe(created.body.data.review.id);

    const member = await request(fixture.app)
      .get(`/api/v1/forecast/current-backlog/person-plan-sources/${context.appointment}/reviews`)
      .set(fixture.actors.member.session.headers);
    expect(member.status).toBe(403);
    const otherTenant = await request(fixture.app)
      .get(`/api/v1/forecast/current-backlog/person-plan-sources/${context.appointment}/reviews`)
      .set(fixture.actors.otherOwner.session.headers);
    expect(otherTenant.status).toBe(200);
    expect(otherTenant.body.data).toMatchObject({ current: null, history: [], total: 0 });

    const privileges = (await fixture.ownerPool.query(
      `SELECT has_table_privilege($1,
          'public.canonical_forecast_current_backlog_person_plan_reviews','SELECT') direct_read,
        has_function_privilege($1,
          'public.canonical_forecast_backlog_person_plan_mutate(uuid,uuid,text,uuid,text,text,uuid,jsonb)',
          'EXECUTE') guarded_write`, [fixture.roles.runtime])).rows[0];
    expect(privileges).toEqual({ direct_read: false, guarded_write: true });

    const withdrawal = await directMutate(context, {
      action: 'withdraw', expectedCurrentReviewId: created.body.data.review.id,
      expectedCurrentReviewDigest: created.body.data.review.digest,
      assignmentId: null, expectedAssignmentRevision: null,
      expectedAssignmentDigest: null, estimateId: null, laborPlanId: null,
      expectedLaborPlanRevision: null, expectedLaborPlanDigest: null,
      reason: 'Owner withdrew the still-current fictional person-hour source.',
      confirmed: true, confirmationVersion: 'm26-current-backlog-person-plan-v1',
    }, `m26-p4c-person-plan-supersede-${uuid()}`);
    expect(withdrawal.replayed).toBe(false);
    expect(withdrawal.review).toMatchObject({ revision: 2,
      previousId: created.body.data.review.id, action: 'withdraw', state: 'withdrawn' });

    const supersededReplay = await directMutate(context, approvalBody(context, plan), requestKey);
    expect(supersededReplay.replayed).toBe(true);
    expect(supersededReplay.review).toMatchObject({
      id: created.body.data.review.id, revision: 1, state: 'source_stale',
      plannedPersonMinutes: null, sourceAuthenticated: false, sourceCurrent: false,
    });
    const afterWithdrawal = await request(fixture.app)
      .get(`/api/v1/forecast/current-backlog/person-plan-sources/${context.appointment}/reviews`)
      .set(fixture.actors.owner.session.headers);
    expect(afterWithdrawal.status).toBe(200);
    expect(afterWithdrawal.body.data.current).toMatchObject({ revision: 2,
      action: 'withdraw', state: 'withdrawn', plannedPersonMinutes: null });
    expect(afterWithdrawal.body.data.history).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: created.body.data.review.id, revision: 1,
        state: 'source_stale', plannedPersonMinutes: null,
        sourceAuthenticated: false, sourceCurrent: false }),
    ]));
  }, 120000);

  test('a genuine schedule revision stales the source and an explicit withdrawal preserves history', async () => {
    const context = await fixture.createExecution({ approvedScheduling: true,
      stopAfterScheduling: true });
    const plan = await seedApprovedPlan(context);
    const created = await post(context, approvalBody(context, plan),
      `m26-p4c-person-plan-stale-${uuid()}`);
    expect(created.status).toBe(201);

    const before = (await fixture.ownerPool.query(
      `SELECT revision,rtrim(canonical_digest) digest,scheduled_start,scheduled_end,
        appointment_status FROM canonical_schedule_assignments
       WHERE organization_id=$1 AND appointment_id=$2`,
      [fixture.org, context.appointment])).rows[0];
    await updateAppointmentSchedule(fixture.ownerPool, normalizeScheduleMutation({
      organizationId: fixture.org, actorUserId: fixture.actors.owner.actorUserId,
      actorAccessRole: fixture.actors.owner.actorAccessRole,
      authSessionId: fixture.actors.owner.authSessionId,
      appointmentId: context.appointment, explicitSession: null,
      idempotencyKey: `m26-p4c-person-plan-reschedule-${uuid()}`,
      body: { expectedRevision: Number(before.revision), expectedDigest: before.digest,
        expectedTimeZone: 'UTC', action: 'calendar_edit',
        scheduledStart: new Date(before.scheduled_start.getTime() + 86400000).toISOString(),
        scheduledEnd: new Date(before.scheduled_end.getTime() + 86400000).toISOString(),
        status: before.appointment_status,
        reason: 'Fictional mounted reschedule after person-plan review.' },
    }));
    const stale = await request(fixture.app)
      .get(`/api/v1/forecast/current-backlog/person-plan-sources/${context.appointment}/reviews`)
      .set(fixture.actors.owner.session.headers);
    expect(stale.status).toBe(200);
    expect(stale.body.data.current).toMatchObject({ state: 'source_stale',
      plannedPersonMinutes: null, sourceAuthenticated: false, sourceCurrent: false });

    const withdrawal = await post(context, {
      action: 'withdraw', expectedCurrentReviewId: created.body.data.review.id,
      expectedCurrentReviewDigest: created.body.data.review.digest,
      assignmentId: null, expectedAssignmentRevision: null,
      expectedAssignmentDigest: null, estimateId: null, laborPlanId: null,
      expectedLaborPlanRevision: null, expectedLaborPlanDigest: null,
      reason: 'Owner withdrew the stale fictional person-hour source.',
      confirmed: true, confirmationVersion: 'm26-current-backlog-person-plan-v1',
    }, `m26-p4c-person-plan-withdraw-${uuid()}`);
    expect(withdrawal.status).toBe(201);
    expect(withdrawal.body.data.review).toMatchObject({ revision: 2,
      previousId: created.body.data.review.id, action: 'withdraw', state: 'withdrawn',
      plannedPersonMinutes: null, sourceAuthenticated: true, sourceCurrent: true });
  }, 120000);

  test('serializes simultaneous replay without duplicate review revisions', async () => {
    const context = await fixture.createExecution({ approvedScheduling: true,
      stopAfterScheduling: true, start: '2027-11-15T13:00:00.000Z' });
    const plan = await seedApprovedPlan(context);
    const body = approvalBody(context, plan);
    const requestKey = `m26-p4c-person-plan-concurrent-${uuid()}`;
    const [left, right] = await Promise.all([
      directMutate(context, body, requestKey), directMutate(context, body, requestKey),
    ]);
    expect([left.replayed, right.replayed].sort()).toEqual([false, true]);
    expect(left.review.id).toBe(right.review.id);
    const count = await fixture.ownerPool.query(
      `SELECT count(*)::integer count
       FROM canonical_forecast_current_backlog_person_plan_reviews
       WHERE organization_id=$1 AND appointment_id=$2`,
      [fixture.org, context.appointment]);
    expect(count.rows[0].count).toBe(1);
  }, 120000);

  test('rejects otherwise-valid person-minute totals outside receipt capacity', async () => {
    const context = await fixture.createExecution({ approvedScheduling: true,
      stopAfterScheduling: true, start: '2027-12-01T13:00:00.000Z' });
    const plan = await seedApprovedPlan(context, { oversized: true });
    await expect(directMutate(context, approvalBody(context, plan),
      `m26-p4c-person-plan-overflow-${uuid()}`))
      .rejects.toMatchObject({ code: '22023' });
    const count = await fixture.ownerPool.query(
      `SELECT count(*)::integer count
       FROM canonical_forecast_current_backlog_person_plan_reviews
       WHERE organization_id=$1 AND appointment_id=$2`,
      [fixture.org, context.appointment]);
    expect(count.rows[0].count).toBe(0);
  }, 120000);

  test('refuses an approval whose Mission 24 decision and plan source pins are stale', async () => {
    const context = await fixture.createExecution({ approvedScheduling: true,
      stopAfterScheduling: true, start: '2027-12-08T13:00:00.000Z' });
    const plan = await seedApprovedPlan(context, { stalePins: true });
    await expect(directMutate(context, approvalBody(context, plan),
      `m26-p4c-person-plan-stale-pins-${uuid()}`))
      .rejects.toMatchObject({ code: '40001' });
    const count = await fixture.ownerPool.query(
      `SELECT count(*)::integer count
       FROM canonical_forecast_current_backlog_person_plan_reviews
       WHERE organization_id=$1 AND appointment_id=$2`,
      [fixture.org, context.appointment]);
    expect(count.rows[0].count).toBe(0);
  }, 120000);

  test('a genuine Mission 24 estimate revision stales read and replay output', async () => {
    const context = await fixture.createExecution({ approvedScheduling: true,
      stopAfterScheduling: true, start: '2027-12-09T13:00:00.000Z' });
    const plan = await seedApprovedPlan(context);
    const requestKey = `m26-p4c-person-plan-estimate-revision-${uuid()}`;
    const created = await directMutate(context, approvalBody(context, plan), requestKey);
    expect(created.review).toMatchObject({ state: 'approved',
      plannedPersonMinutes: '240.000000' });
    const actor = fixture.actors.owner;
    const client = await fixture.runtimePool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const material = (await client.query(
        `SELECT canonical_material_plan_mutate($1,$2,$3,$4,$5,$6,$7,$8) value`,
        [fixture.org, actor.actorUserId, actor.actorAccessRole,
          actor.authSessionId, plan.estimateId, actor.csrfToken,
          `m26-p4c-material-${uuid()}`, {
            action: 'save', expectedRevision: 0, expectedDigest: 'none',
            sourcePins: plan.sourcePins, expectedDecisionRevision: 1,
            expectedDecisionDigest: plan.decisionDigest,
            inputs: { material: 'Fictional mounted pipe', quantity: '1', unit: 'ea',
              wastePercent: '0', unitPrice: '10.00', sourceType: 'my_estimate',
              sourceNote: 'Fictional mounted source.', priceDate: null },
            currency: 'USD', reason: 'Fictional mounted material plan.',
            confirmed: true, confirmationVersion: 'estimate-material-plan-v1',
          }])).rows[0].value;
      const revision = (await client.query(
        `SELECT canonical_estimate_revision_mutate($1,$2,$3,$4,$5,$6,$7,$8) value`,
        [fixture.org, actor.actorUserId, actor.actorAccessRole,
          actor.authSessionId, plan.estimateId, actor.csrfToken,
          `m26-p4c-estimate-revision-${uuid()}`, {
            sourcePins: plan.sourcePins, expectedPlanId: material.receipt.id,
            expectedPlanRevision: 1, expectedPlanDigest: material.receipt.digest,
            expectedDecisionRevision: 1, expectedDecisionDigest: plan.decisionDigest,
            reason: 'Fictional mounted estimate source revision.', confirmed: true,
            confirmationVersion: 'estimate-material-adoption-v1',
          }])).rows[0].value;
      expect(revision.replayed).toBe(false);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }

    const read = await request(fixture.app)
      .get(`/api/v1/forecast/current-backlog/person-plan-sources/${context.appointment}/reviews`)
      .set(actor.session.headers);
    expect(read.status).toBe(200);
    expect(read.body.data.current).toMatchObject({ state: 'source_stale',
      plannedPersonMinutes: null, sourceAuthenticated: false, sourceCurrent: false });
    const replay = await directMutate(context, approvalBody(context, plan), requestKey);
    expect(replay).toMatchObject({ replayed: true, review: { state: 'source_stale',
      plannedPersonMinutes: null, sourceAuthenticated: false, sourceCurrent: false } });
  }, 120000);

  test('serializes approval against a genuine Mission 24 decision writer fence', async () => {
    const context = await fixture.createExecution({ approvedScheduling: true,
      stopAfterScheduling: true, start: '2027-12-10T13:00:00.000Z' });
    const plan = await seedApprovedPlan(context);
    const actor = fixture.actors.owner;
    const blocker = await fixture.ownerPool.connect();
    try {
      await blocker.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await blocker.query(
        `SELECT 1 FROM canonical_estimates
         WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
        [fixture.org, plan.estimateId]);
      const mutation = directMutate(context, approvalBody(context, plan),
        `m26-p4c-person-plan-decision-race-${uuid()}`)
        .then(value => ({ value }), error => ({ error }));
      await waitForNonAdvisoryLock();
      await blocker.query(
        `SELECT canonical_estimate_decision_mutate($1,$2,$3,$4,$5,$6,$7,$8)`,
        [fixture.org, actor.actorUserId, actor.actorAccessRole,
          actor.authSessionId, plan.estimateId, actor.csrfToken,
          `m26-p4c-decision-race-${uuid()}`, revisedDecisionBody(plan)]);
      await blocker.query('COMMIT');
      const outcome = await mutation;
      expect(outcome.error).toMatchObject({ code: '40001' });
      expect(outcome.value).toBeUndefined();
      const count = await fixture.ownerPool.query(
        `SELECT count(*)::integer count
         FROM canonical_forecast_current_backlog_person_plan_reviews
         WHERE organization_id=$1 AND appointment_id=$2`,
        [fixture.org, context.appointment]);
      expect(count.rows[0].count).toBe(0);
    } finally {
      await blocker.query('ROLLBACK').catch(() => {});
      blocker.release();
    }
  }, 120000);

  test('fences idempotent replay against a genuine Mission 24 decision writer', async () => {
    const context = await fixture.createExecution({ approvedScheduling: true,
      stopAfterScheduling: true, start: '2027-12-12T13:00:00.000Z' });
    const plan = await seedApprovedPlan(context);
    const actor = fixture.actors.owner;
    const requestKey = `m26-p4c-person-plan-replay-race-${uuid()}`;
    const body = approvalBody(context, plan);
    const created = await directMutate(context, body, requestKey);
    expect(created.replayed).toBe(false);
    const blocker = await fixture.ownerPool.connect();
    try {
      await blocker.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await blocker.query(
        `SELECT 1 FROM canonical_estimates
         WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
        [fixture.org, plan.estimateId]);
      const replay = directMutate(context, body, requestKey)
        .then(value => ({ value }), error => ({ error }));
      await waitForNonAdvisoryLock();
      await blocker.query(
        `SELECT canonical_estimate_decision_mutate($1,$2,$3,$4,$5,$6,$7,$8)`,
        [fixture.org, actor.actorUserId, actor.actorAccessRole,
          actor.authSessionId, plan.estimateId, actor.csrfToken,
          `m26-p4c-decision-replay-race-${uuid()}`, revisedDecisionBody(plan)]);
      await blocker.query('COMMIT');
      const outcome = await replay;
      expect(outcome.error).toBeUndefined();
      expect(outcome.value).toMatchObject({ replayed: true, review: {
        state: 'source_stale', plannedPersonMinutes: null,
        sourceAuthenticated: false, sourceCurrent: false,
      } });
    } finally {
      await blocker.query('ROLLBACK').catch(() => {});
      blocker.release();
    }
  }, 120000);

  test('holds paid authority and rechecks a trial clock immediately before insertion', async () => {
    const context = await fixture.createExecution({ approvedScheduling: true,
      stopAfterScheduling: true, start: '2027-12-15T13:00:00.000Z' });
    const plan = await seedApprovedPlan(context);
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
    const blocker = await fixture.ownerPool.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,
        [`m26:backlog-person-plan:${fixture.org}:${context.appointment}`]);
      const mutation = directMutate(context, approvalBody(context, plan),
        `m26-p4c-person-plan-expiry-${uuid()}`)
        .then(value => ({ value }), error => ({ error }));
      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt += 1) {
        const observed = await fixture.ownerPool.query(
          `SELECT EXISTS(
             SELECT 1 FROM pg_locks
             WHERE locktype='advisory' AND granted=FALSE) waiting`);
        waiting = observed.rows[0].waiting;
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
      await new Promise(resolve => setTimeout(resolve, 3200));
      await blocker.query('COMMIT');
      const outcome = await mutation;
      expect(outcome.error).toMatchObject({ code: '42501' });
      expect(outcome.value).toBeUndefined();
      const count = await fixture.ownerPool.query(
        `SELECT count(*)::integer count
         FROM canonical_forecast_current_backlog_person_plan_reviews
         WHERE organization_id=$1 AND appointment_id=$2`,
        [fixture.org, context.appointment]);
      expect(count.rows[0].count).toBe(0);
    } finally {
      await blocker.query('ROLLBACK').catch(() => {});
      blocker.release();
      await fixture.ownerPool.query(
        `UPDATE subscriptions SET status='active',trial_started_at=NULL,trial_ends_at=NULL
         WHERE organization_id=$1`, [fixture.org]);
    }
  }, 120000);
});
