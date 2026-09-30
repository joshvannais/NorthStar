'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Pool } = require('pg');
const request = require('supertest');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { provisionDurableSession } = require('../helpers/account-session-fixture');
const { adaptBusinessProfile } = require('../../src/services/businessProfileAdapter');
const { normalizeScheduleMutation } = require('../../src/scheduling/contract');
const { updateAppointmentSchedule } = require('../../src/scheduling/repository');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const uuid = () => crypto.randomUUID();
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

function migrationDirectoryThrough(maximum, root, name) {
  const source = path.resolve(__dirname, '../../migrations');
  const target = path.join(root, name);
  fs.mkdirSync(target, { recursive: true });
  for (const file of fs.readdirSync(source)) {
    const match = /^(\d{3})_.+\.sql$/.exec(file);
    if (match && Number(match[1]) <= maximum) {
      fs.copyFileSync(path.join(source, file), path.join(target, file));
    }
  }
  return target;
}

async function captureSnapshot(pool, identity, key) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    const result = await client.query(
      `SELECT canonical_forecast_current_backlog_snapshot_capture(
        $1,$2,'owner',$3,$4,$5) value`,
      [identity.organizationId, identity.userId, identity.sessionId,
        identity.csrfToken, key]);
    await client.query('COMMIT');
    return result.rows[0].value;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

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

  test('pins the current estimate generation for an already-stale review', async () => {
    const context = await fixture.createExecution({ approvedScheduling: true,
      stopAfterScheduling: true, start: '2027-12-24T13:00:00.000Z' });
    const plan = await seedPlan(context), actor = fixture.actors.owner;
    expect((await postReview(context, plan)).status).toBe(201);
    const mutateDecision = async (expectedRevision, expectedDigest, label) => {
      const client = await fixture.runtimePool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        await client.query(
          `SELECT canonical_estimate_decision_mutate($1,$2,$3,$4,$5,$6,$7,$8)`,
          [fixture.org, actor.actorUserId, actor.actorAccessRole, actor.authSessionId,
            plan.estimateId, actor.csrfToken, `m26-p4c-stale-review-${label}-${uuid()}`,
            { action: 'approve', expectedRevision, expectedDigest,
              sourcePins: plan.sourcePins,
              scopeSummary: `Fictional ${label} stale-review source change`,
              priceBeforeTax: '500.00', currency: 'USD',
              reason: `Fictional ${label} stale-review source mutation.`, confirmed: true,
              confirmationVersion: 'estimate-quote-preparation-v1' }]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally { client.release(); }
    };
    await mutateDecision(1, plan.decisionDigest, 'pre-capture');
    const captureKey = `m26-p4c-already-stale-${uuid()}`;
    const identity = { organizationId: fixture.org, userId: actor.actorUserId,
      sessionId: actor.authSessionId, csrfToken: actor.csrfToken };
    const captured = await captureSnapshot(fixture.runtimePool, identity, captureKey);
    expect(captured.replayed).toBe(false);
    expect(captured.snapshot).toMatchObject({
      backlogHoursState: 'unavailable',
      backlogHoursReason: 'reviewed_person_hour_plan_not_current',
      plannedPersonMinutes: null,
    });
    const privateReceipt = (await fixture.ownerPool.query(
      `SELECT receipt
       FROM canonical_forecast_current_backlog_snapshots snapshot,
       LATERAL jsonb_array_elements(snapshot.person_plan_receipts) receipt
       WHERE snapshot.organization_id=$1 AND snapshot.id=$2
        AND receipt->>'appointmentId'=$3`,
      [fixture.org, captured.snapshot.id, context.appointment])).rows[0].receipt;
    const currentFence = (await fixture.ownerPool.query(
      `SELECT generation FROM canonical_forecast_estimate_source_fences
       WHERE organization_id=$1 AND estimate_id=$2`,
      [fixture.org, plan.estimateId])).rows[0];
    expect(privateReceipt.state).toBe('not_current');
    expect(privateReceipt.reviewId).toBeTruthy();
    expect(Number(privateReceipt.sourceGeneration)).toBe(Number(currentFence.generation));

    const latest = (await fixture.ownerPool.query(
      `SELECT revision,rtrim(digest) digest FROM canonical_estimate_decisions
       WHERE organization_id=$1 AND estimate_id=$2
       ORDER BY revision DESC LIMIT 1`, [fixture.org, plan.estimateId])).rows[0];
    await mutateDecision(Number(latest.revision), latest.digest, 'post-capture');
    const stale = await request(fixture.app)
      .get(`/api/v1/forecast/current-backlog/snapshots/${captured.snapshot.id}`)
      .set(actor.session.headers);
    expect(stale.status).toBe(200);
    expect(stale.body.data).toMatchObject({ state: 'source_stale',
      approvedUnscheduledCount: 0, approvedScheduledCount: 0,
      workInProgressCount: 0, completedCount: 0, unresolvedLinkageCount: 0,
      knownBacklogCount: 0, plannedPersonMinutes: null,
      backlogHoursState: 'unavailable',
      backlogHoursReason: 'source_changed_after_capture', sourceDigest: null,
      snapshotDigest: null, sourceAuthenticated: false });
    const replay = await captureSnapshot(fixture.runtimePool, identity, captureKey);
    expect(replay).toMatchObject({ replayed: true,
      snapshot: { state: 'source_stale',
      approvedUnscheduledCount: 0, approvedScheduledCount: 0,
      workInProgressCount: 0, completedCount: 0, unresolvedLinkageCount: 0,
      knownBacklogCount: 0, plannedPersonMinutes: null,
      backlogHoursState: 'unavailable',
      backlogHoursReason: 'source_changed_after_capture',
      sourceDigest: null, snapshotDigest: null } });
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

  test('replays an exact migration 207 receipt after migration 209 without widening request identity', async () => {
    const database = await createSuiteDatabase('m26p4c-legacy-replay');
    const pool = new Pool({ connectionString: database.connectionString, max: 4 });
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m26p4c-replay-'));
    try {
      const through207 = migrationDirectoryThrough(207, temporary, 'through207');
      const through209 = migrationDirectoryThrough(209, temporary, 'through209');
      await fixture.db.runMigrations({ pool, migrationsDirectory: through207 });
      const organizationId = uuid(), userId = uuid();
      await pool.query(
        `INSERT INTO organizations(id,name,email)
         VALUES($1,'Migration 207 replay tenant',$2)`,
        [organizationId, `${organizationId}@example.test`]);
      await pool.query(
        `INSERT INTO users(id,organization_id,name,email,password_hash,role,status)
         VALUES($1,$2,'Migration 207 owner',$3,'unused','owner','active')`,
        [userId, organizationId, `${userId}@example.test`]);
      const rawProfile = { company: { name: 'Migration 207 replay tenant',
        timeZone: 'UTC', currency: 'USD' }, headquarters: {}, services: [] };
      const normalized = adaptBusinessProfile(rawProfile, 'm26-p4c-legacy-replay-v1');
      await pool.query(
        `INSERT INTO canonical_business_profiles(
           organization_id,version_number,version_label,raw_profile,
           normalized_profile,normalized_profile_hash,is_active,created_by)
         VALUES($1,1,'m26-p4c-legacy-replay-v1',$2,$3,$4,TRUE,$5)`,
        [organizationId, rawProfile, normalized, normalized.hash, userId]);
      const session = await provisionDurableSession(pool, {
        organizationId, userId, role: 'owner', onboardingStatus: 'complete',
      });
      const identity = { organizationId, userId, sessionId: session.sessionId,
        csrfToken: session.csrfToken };
      const requestKey = `m26-p4c-legacy-replay-${uuid()}`;
      const created = await captureSnapshot(pool, identity, requestKey);
      expect(created.replayed).toBe(false);
      const legacy = (await pool.query(
        `SELECT id,request_digest FROM canonical_forecast_current_backlog_snapshots
         WHERE organization_id=$1 AND actor_user_id=$2 AND request_key_hash=$3`,
        [organizationId, userId, hash(requestKey)])).rows[0];
      const legacyDigest = (await pool.query(
        `SELECT encode(sha256(convert_to(jsonb_build_object(
          'version','m26-current-backlog-position-v1')::text,'UTF8')),'hex') digest`
      )).rows[0].digest;
      expect(legacy.request_digest).toBe(legacyDigest);

      await fixture.db.runMigrations({ pool, migrationsDirectory: through209 });
      const upgraded = (await pool.query(
        `SELECT person_plan_composition_version
         FROM canonical_forecast_current_backlog_snapshots WHERE id=$1`,
        [legacy.id])).rows[0];
      expect(upgraded.person_plan_composition_version).toBe('none');
      const replayed = await captureSnapshot(pool, identity, requestKey);
      expect(replayed.replayed).toBe(true);
      expect(replayed.snapshot.id).toBe(legacy.id);

      // Disposable owner-only corruption proves the compatibility branch accepts
      // only the exact migration 207 digest rather than any changed request.
      await pool.query('ALTER TABLE canonical_forecast_current_backlog_snapshots DISABLE TRIGGER USER');
      try {
        await pool.query(
          `UPDATE canonical_forecast_current_backlog_snapshots
           SET request_digest=$2 WHERE id=$1`, [legacy.id, 'f'.repeat(64)]);
      } finally {
        await pool.query('ALTER TABLE canonical_forecast_current_backlog_snapshots ENABLE TRIGGER USER');
      }
      await expect(captureSnapshot(pool, identity, requestKey))
        .rejects.toMatchObject({ code: '23505' });
      expect((await pool.query(
        `SELECT count(*)::integer count
         FROM canonical_forecast_current_backlog_snapshots
         WHERE organization_id=$1 AND actor_user_id=$2 AND request_key_hash=$3`,
        [organizationId, userId, hash(requestKey)])).rows[0].count).toBe(1);
    } finally {
      await pool.end().catch(() => {});
      await database.cleanup().catch(() => {});
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }, 180000);
});
