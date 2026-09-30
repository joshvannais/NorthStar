'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const key = () => crypto.randomUUID();

realPostgres('Mission 26 Part 4C guarded current backlog position', () => {
  let fixture;
  beforeAll(async () => { fixture = await createDatabaseFixture({ operationalSchedule: true }); }, 120000);
  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  const capture = (actor = 'owner', requestKey = `m26-p4c-backlog-${key()}`) =>
    request(fixture.app).post('/api/v1/forecast/current-backlog/snapshots')
      .set(fixture.actors[actor].session.headers).set('Idempotency-Key', requestKey).send({});

  const directCapture = async (requestKey = `m26-p4c-direct-${key()}`) => {
    const actor = fixture.actors.owner;
    const client = await fixture.runtimePool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const value = (await client.query(
        `SELECT canonical_forecast_current_backlog_snapshot_capture(
          $1,$2,$3,$4,$5,$6) value`,
        [fixture.org, actor.actorUserId, actor.actorAccessRole, actor.authSessionId,
          actor.csrfToken, requestKey])).rows[0].value;
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  };

  const completeThroughCanonicalWriter = async (context, action = 'propose_completion', extra = {}) => {
    const input = require('../../src/completion/contract').normalizeCompletionAction({
      ...context.actor,
      executionId: context.execution.id,
      idempotencyKey: key(),
      body: {
        action,
        expectedExecutionRevision: context.execution.revision,
        expectedExecutionDigest: context.execution.digest,
        expectedAssignmentRevision: Number(context.assignment.revision),
        expectedAssignmentDigest: context.assignment.digest,
        reason: 'Explicit synthetic completion decision',
        ...(action === 'propose_completion'
          ? { expiresAt: new Date(Date.now() + 60000).toISOString(),
            gateRequirements: { checklists: [], inspections: [], files: [] } }
          : {}),
        ...extra,
      },
    });
    const result = await require('../../src/completion/repository').mutateCompletion(fixture.ownerPool, {
      ...input,
      csrfToken: context.actor.csrfToken,
      requestCorrelationId: 'm26-p4c-completion',
    });
    context.execution = result.body.data;
    return result;
  };

  test('composes genuine booking, schedule and execution writers without claiming hours or a forecast', async () => {
    const scheduled = await fixture.createExecution({ approvedScheduling: true, stopAfterScheduling: true });
    const active = await fixture.createExecution({
      approvedScheduling: true,
      useMigrationRoleForUpstreamSeed: true,
    });
    const completed = await fixture.createExecution({
      approvedScheduling: true,
      useMigrationRoleForUpstreamSeed: true,
    });
    await completeThroughCanonicalWriter(completed);
    const proposal = (await fixture.ownerPool.query(
      `SELECT id,revision,rtrim(canonical_digest) digest
       FROM canonical_completion_records
       WHERE organization_id=$1 AND execution_id=$2 AND record_kind='proposal'
       ORDER BY decided_at DESC,id DESC LIMIT 1`, [fixture.org, completed.execution.id])).rows[0];
    proposal.revision = Number(proposal.revision);
    await completeThroughCanonicalWriter(completed, 'approve_completion', { proposal });

    const requestKey = `m26-p4c-backlog-replay-${key()}`;
    const created = await capture('owner', requestKey);
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      targetKey: 'demand.current_backlog_position.v1', state: 'descriptive_subset',
      approvedUnscheduledCount: 0, approvedScheduledCount: 1,
      workInProgressCount: 1, completedCount: 1, unresolvedLinkageCount: 0,
      knownBacklogCount: 2, plannedPersonMinutes: null,
      backlogHoursState: 'unavailable',
      backlogHoursReason: 'approved_person_hour_plan_missing',
      sourceAuthenticated: true, knownSubsetOnly: true, sourceCoverageComplete: false,
      offPlatformCoverageVerified: false, providerCoverageVerified: false,
      probabilityCalibrated: false, forecastIssued: false, paidNumericServing: false,
      replayed: false,
    });
    expect(JSON.stringify(created.body)).not.toMatch(
      new RegExp([scheduled.appointment, active.appointment, completed.appointment].join('|')));
    const replay = await capture('owner', requestKey);
    expect(replay.status).toBe(200);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body.data).toMatchObject({ id: created.body.data.id, replayed: true });

    const repository = require('../../src/operations/repository');
    await repository.initializeFieldExecution(fixture.ownerPool, {
      ...scheduled.actor, appointmentId: scheduled.appointment,
      expectedAssignmentRevision: Number(scheduled.assignment.revision),
      expectedAssignmentDigest: scheduled.assignment.digest,
      idempotencyKey: key(), reason: 'Start synthetic backlog after capture',
      requestCorrelationId: 'm26-p4c-stale',
    });
    const stale = await request(fixture.app)
      .get('/api/v1/forecast/current-backlog/snapshots/' + created.body.data.id)
      .set(fixture.actors.owner.session.headers);
    expect(stale.status).toBe(200);
    expect(stale.body.data).toMatchObject({ state: 'source_stale',
      reason: 'source_changed_after_capture', knownBacklogCount: 0,
      sourceAuthenticated: false, sourceDigest: null, snapshotDigest: null });
  }, 120000);

  test('serializes simultaneous idempotent capture without duplicate receipts', async () => {
    const requestKey = `m26-p4c-backlog-concurrent-${key()}`;
    const [left, right] = await Promise.all([
      capture('owner', requestKey),
      capture('owner', requestKey),
    ]);
    expect([left.status, right.status].sort()).toEqual([200, 201]);
    expect(left.body.data.id).toBe(right.body.data.id);
    expect([left.body.data.replayed, right.body.data.replayed].sort())
      .toEqual([false, true]);
  }, 120000);

  test('an unrelated tenant writer-level lock cannot block capture', async () => {
    const other = await fixture.createExecution({
      actor: 'otherOwner',
      useMigrationRoleForUpstreamSeed: true,
    });
    const blocker = await fixture.ownerPool.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query(
        `SELECT id FROM canonical_field_executions
         WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
      [fixture.otherOrg, other.execution.id]);
      await blocker.query('LOCK TABLE canonical_field_executions IN ROW EXCLUSIVE MODE');
      const value = await directCapture();
      expect(value.replayed).toBe(false);
      expect(value.snapshot.sourceAuthenticated).toBe(true);
    } finally {
      await blocker.query('ROLLBACK').catch(() => {});
      blocker.release();
    }
  }, 120000);

  test('refuses 501 authenticated booking identities before enrichment or persistence', async () => {
    const client = await fixture.ownerPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`CREATE TEMP TABLE m26_current_backlog_overflow(
        sequence_value integer,operation_id uuid,graph_id uuid,appointment_id uuid)
        ON COMMIT DROP`);
      await client.query(`INSERT INTO m26_current_backlog_overflow
        SELECT value,gen_random_uuid(),gen_random_uuid(),gen_random_uuid()
        FROM generate_series(1,501) value`);
      await client.query(`INSERT INTO canonical_operations(
        id,organization_id,graph_id,idempotency_key_hash,payload_fingerprint,
        state,lease_owner,lease_expires_at,result_status,result_body,completed_at)
        SELECT operation_id,$1,graph_id,
          encode(sha256(convert_to('m26-p4c-overflow-key:'||sequence_value,'UTF8')),'hex'),
          encode(sha256(convert_to('m26-p4c-overflow-body:'||sequence_value,'UTF8')),'hex'),
          'completed',operation_id,clock_timestamp()+interval '1 hour',200,'{}',clock_timestamp()
        FROM m26_current_backlog_overflow`, [fixture.org]);
      const opportunity = (await client.query(
        'SELECT id FROM canonical_opportunities WHERE organization_id=$1 ORDER BY id LIMIT 1',
        [fixture.org])).rows[0].id;
      await client.query(`INSERT INTO canonical_appointments(
        id,organization_id,operation_id,graph_id,opportunity_id,
        scheduled_start,scheduled_end,status)
        SELECT appointment_id,$1,operation_id,graph_id,$2,
          timestamptz '2027-10-01 13:00:00Z'+sequence_value*interval '2 hours',
          timestamptz '2027-10-01 14:00:00Z'+sequence_value*interval '2 hours','scheduled'
        FROM m26_current_backlog_overflow`, [fixture.org, opportunity]);
      await client.query(`INSERT INTO canonical_forecast_schedule_booking_events(
        organization_id,assignment_id,appointment_id,source_revision_id,source_revision,
        source_kind,schedule_state,appointment_status,transition_kind,occurred_at,
        source_digest,event_digest)
        SELECT assignment.organization_id,assignment.id,assignment.appointment_id,
          revision_value.id,2,'human_approved','scheduled','scheduled','accepted_booking',
          clock_timestamp(),rtrim(revision_value.canonical_digest),
          canonical_completion_digest(jsonb_build_object(
            'test','m26-current-backlog-overflow','appointmentId',assignment.appointment_id))
        FROM m26_current_backlog_overflow source_value
        JOIN canonical_schedule_assignments assignment
          ON assignment.organization_id=$1
         AND assignment.appointment_id=source_value.appointment_id
        JOIN canonical_schedule_assignment_revisions revision_value
          ON revision_value.organization_id=assignment.organization_id
         AND revision_value.assignment_id=assignment.id AND revision_value.revision=1`,
      [fixture.org]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }

    const before = Number((await fixture.ownerPool.query(
      'SELECT count(*) value FROM canonical_forecast_current_backlog_snapshots WHERE organization_id=$1',
      [fixture.org])).rows[0].value);
    const planner = await fixture.ownerPool.connect();
    try {
      await planner.query('BEGIN');
      await planner.query('SET LOCAL enable_seqscan=off');
      const plan = await planner.query(`EXPLAIN (FORMAT JSON)
        SELECT position_value.appointment_id
        FROM canonical_forecast_current_backlog_booking_positions position_value
        WHERE position_value.organization_id=$1 AND position_value.active
        ORDER BY position_value.appointment_id LIMIT 501`, [fixture.org]);
      expect(JSON.stringify(plan.rows[0])).toContain(
        'canonical_forecast_current_backlog_booking_positions_active');
    } finally {
      await planner.query('ROLLBACK').catch(() => {});
      planner.release();
    }
    const runtime = await fixture.runtimePool.connect();
    try {
      await runtime.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await expect(runtime.query(
        `SELECT canonical_forecast_current_backlog_snapshot_capture(
          $1,$2,$3,$4,$5,$6) value`,
        [fixture.org, fixture.actors.owner.actorUserId, fixture.actors.owner.actorAccessRole,
          fixture.actors.owner.authSessionId, fixture.actors.owner.csrfToken,
          `m26-p4c-overflow-${key()}`])).rejects.toMatchObject({ code: '54000' });
    } finally {
      await runtime.query('ROLLBACK').catch(() => {});
      runtime.release();
    }
    const after = Number((await fixture.ownerPool.query(
      'SELECT count(*) value FROM canonical_forecast_current_backlog_snapshots WHERE organization_id=$1',
      [fixture.org])).rows[0].value);
    expect(after).toBe(before);
  }, 120000);

  test('enforces paid owner/admin tenant access and keeps private receipts entry-only', async () => {
    expect((await capture('member')).status).toBe(403);
    const missing = await request(fixture.app)
      .get('/api/v1/forecast/current-backlog/snapshots/' + key())
      .set(fixture.actors.otherOwner.session.headers);
    expect(missing.status).toBe(503);
    expect(JSON.stringify(missing.body)).not.toMatch(/appointment|assignment|execution|digest/i);
    await expect(fixture.runtimePool.query(
      'SELECT * FROM canonical_forecast_current_backlog_snapshots'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(fixture.runtimePool.query(
      'SELECT * FROM canonical_forecast_current_backlog_booking_positions'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(fixture.ownerPool.query(
      'DELETE FROM canonical_forecast_current_backlog_snapshots'))
      .rejects.toMatchObject({ code: '23514' });
  }, 120000);

  test('requires migration objects and rejects PUBLIC leakage', async () => {
    const missing = await fixture.ownerPool.connect();
    try {
      await missing.query('BEGIN');
      await missing.query('DROP INDEX canonical_forecast_current_backlog_booking_positions_active');
      await expect(fixture.db.grantAndVerifyRuntimeAuthorityForTests(missing,
        { runtimeRole: fixture.roles.runtime }))
        .rejects.toThrow('Required current backlog snapshot authority is missing');
    } finally { await missing.query('ROLLBACK').catch(() => {}); missing.release(); }

    const leaked = await fixture.ownerPool.connect();
    try {
      await leaked.query('BEGIN');
      await leaked.query(`GRANT EXECUTE ON FUNCTION
        canonical_forecast_current_backlog_snapshot_capture(
          uuid,uuid,text,uuid,text,text) TO PUBLIC`);
      await expect(fixture.db.grantAndVerifyRuntimeAuthorityForTests(leaked,
        { runtimeRole: fixture.roles.runtime }))
        .rejects.toThrow('Runtime database role privilege verification failed');
    } finally { await leaked.query('ROLLBACK').catch(() => {}); leaked.release(); }
  }, 120000);
});
