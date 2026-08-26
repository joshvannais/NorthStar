'use strict';

const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { Pool } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { normalizeScheduleMutation } = require('../../src/scheduling/contract');
const { updateAppointmentSchedule } = require('../../src/scheduling/repository');

const ROOT = path.resolve(__dirname, '..', '..');
const MIGRATIONS = path.join(ROOT, 'migrations');
const PART1_MIGRATION = '032_canonical_schedule_assignment_authority.sql';
const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

const IDS = Object.freeze({
  organization: 'a1000000-0000-4000-8000-000000000001',
  otherOrganization: 'a1000000-0000-4000-8000-000000000002',
  owner: 'a2000000-0000-4000-8000-000000000001',
  otherOwner: 'a2000000-0000-4000-8000-000000000002',
  profile: 'a8000000-0000-4000-8000-000000000001',
  authSession: 'a9000000-0000-4000-8000-000000000001',
  secondaryAuthSession: 'a9000000-0000-4000-8000-000000000002',
  operationValid: 'a3000000-0000-4000-8000-000000000001',
  graphValid: 'a4000000-0000-4000-8000-000000000001',
  customerValid: 'a5000000-0000-4000-8000-000000000001',
  opportunityValid: 'a6000000-0000-4000-8000-000000000001',
  appointmentValid: 'a7000000-0000-4000-8000-000000000001',
  operationInvalid: 'a3000000-0000-4000-8000-000000000002',
  graphInvalid: 'a4000000-0000-4000-8000-000000000002',
  customerInvalid: 'a5000000-0000-4000-8000-000000000002',
  opportunityInvalid: 'a6000000-0000-4000-8000-000000000002',
  appointmentInvalid: 'a7000000-0000-4000-8000-000000000002',
  operationNew: 'a3000000-0000-4000-8000-000000000003',
  graphNew: 'a4000000-0000-4000-8000-000000000003',
  customerNew: 'a5000000-0000-4000-8000-000000000003',
  opportunityNew: 'a6000000-0000-4000-8000-000000000003',
  appointmentNew: 'a7000000-0000-4000-8000-000000000003',
  operationAcceptedSchedule: 'a3000000-0000-4000-8000-000000000005',
  graphAcceptedSchedule: 'a4000000-0000-4000-8000-000000000005',
  customerAcceptedSchedule: 'a5000000-0000-4000-8000-000000000005',
  opportunityAcceptedSchedule: 'a6000000-0000-4000-8000-000000000005',
  appointmentAcceptedSchedule: 'a7000000-0000-4000-8000-000000000005',
  operationMutation: 'a3000000-0000-4000-8000-000000000004',
  graphMutation: 'a4000000-0000-4000-8000-000000000004',
  customerMutation: 'a5000000-0000-4000-8000-000000000004',
  opportunityMutation: 'a6000000-0000-4000-8000-000000000004',
  appointmentMutation: 'a7000000-0000-4000-8000-000000000004',
});

function migrationFiles(directory) {
  return fs.readdirSync(directory).filter(name => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort();
}

async function seedOrganization(pool, organizationId, userId, suffix) {
  await pool.query(
    `INSERT INTO organizations(id,name,email) VALUES ($1,$2,$3)`,
    [organizationId, `Mission 22 ${suffix}`, `m22-${suffix}@example.test`]
  );
  await pool.query(
    `INSERT INTO users(id,organization_id,name,email,password_hash,role,status)
     VALUES ($1,$2,$3,$4,'not-used','owner','active')`,
    [userId, organizationId, `Owner ${suffix}`, `owner-${suffix}@example.test`]
  );
  await pool.query(
    `INSERT INTO organization_memberships(id,organization_id,user_id,role,status)
     VALUES ($1,$2,$1,'owner','active')`,
    [userId, organizationId]
  );
}

async function seedAppointment(pool, input) {
  const idempotencyHash = crypto.createHash('sha256').update(`idempotency:${input.operationId}`).digest('hex');
  const payloadHash = crypto.createHash('sha256').update(`payload:${input.operationId}`).digest('hex');
  await pool.query(
    `INSERT INTO canonical_operations(
       id,organization_id,graph_id,idempotency_key_hash,payload_fingerprint,
       state,lease_owner,lease_expires_at,result_status,result_body,completed_at
     ) VALUES ($1,$2,$3,$4,$5,'completed',$6,NOW() + INTERVAL '1 hour',200,'{}',NOW())`,
    [input.operationId, input.organizationId, input.graphId, idempotencyHash, payloadHash, input.operationId]
  );
  await pool.query(
    `INSERT INTO canonical_customers(
       id,organization_id,operation_id,graph_id,name
     ) VALUES ($1,$2,$3,$4,$5)`,
    [input.customerId, input.organizationId, input.operationId, input.graphId, input.name]
  );
  await pool.query(
    `INSERT INTO canonical_transcripts(
       id,organization_id,operation_id,graph_id,customer_id,source,source_version,
       transcript_text,normalized_fingerprint
     ) VALUES ($1,$2,$3,$4,$5,'manual','m22-part1-test','', $6)`,
    [input.customerId.replace(/^a5/, 'b5'), input.organizationId, input.operationId,
      input.graphId, input.customerId,
      crypto.createHash('sha256').update(`transcript:${input.operationId}`).digest('hex')]
  );
  await pool.query(
    `INSERT INTO canonical_opportunities(
       id,organization_id,operation_id,graph_id,customer_id,status
     ) VALUES ($1,$2,$3,$4,$5,'qualified')`,
    [input.opportunityId, input.organizationId, input.operationId, input.graphId, input.customerId]
  );
  await pool.query(
    `INSERT INTO canonical_appointments(
       id,organization_id,operation_id,graph_id,opportunity_id,
       scheduled_start,scheduled_end,status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [input.appointmentId, input.organizationId, input.operationId, input.graphId,
      input.opportunityId, input.start || null, input.end || null, input.status || 'preferred']
  );
}

realPostgres('Mission 22 Part 1 canonical schedule migration authority', () => {
  let freshDatabase;
  let upgradeDatabase;
  let freshPool;
  let upgradePool;
  let prePart1Directory;
  let throughPart1Directory;
  let db;
  let replayMutation;

  beforeAll(async () => {
    freshDatabase = await createSuiteDatabase('m22-p1-fresh');
    upgradeDatabase = await createSuiteDatabase('m22-p1-upgrade');
    freshPool = new Pool({ connectionString: freshDatabase.connectionString, max: 4 });
    upgradePool = new Pool({ connectionString: upgradeDatabase.connectionString, max: 6 });
    prePart1Directory = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m22-p1-pre032-'));
    throughPart1Directory = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m22-p1-through032-'));
    for (const filename of migrationFiles(MIGRATIONS).filter(name => name < PART1_MIGRATION)) {
      fs.copyFileSync(path.join(MIGRATIONS, filename), path.join(prePart1Directory, filename));
    }
    for (const filename of migrationFiles(MIGRATIONS).filter(name => name <= PART1_MIGRATION)) {
      fs.copyFileSync(path.join(MIGRATIONS, filename), path.join(throughPart1Directory, filename));
    }
    jest.resetModules();
    db = require('../../src/db');
    expect(await db.runMigrations({ pool: upgradePool, migrationsDirectory: prePart1Directory })).toBe(true);

    await seedOrganization(upgradePool, IDS.organization, IDS.owner, 'upgrade-a');
    await seedOrganization(upgradePool, IDS.otherOrganization, IDS.otherOwner, 'upgrade-b');
    await seedAppointment(upgradePool, {
      organizationId: IDS.organization,
      operationId: IDS.operationValid,
      graphId: IDS.graphValid,
      customerId: IDS.customerValid,
      opportunityId: IDS.opportunityValid,
      appointmentId: IDS.appointmentValid,
      name: 'Valid legacy schedule',
      start: '2026-11-01T05:30:00.000Z',
      end: '2026-11-01T07:30:00.000Z',
      status: 'scheduled',
    });
    await seedAppointment(upgradePool, {
      organizationId: IDS.organization,
      operationId: IDS.operationInvalid,
      graphId: IDS.graphInvalid,
      customerId: IDS.customerInvalid,
      opportunityId: IDS.opportunityInvalid,
      appointmentId: IDS.appointmentInvalid,
      name: 'Invalid legacy schedule',
      start: '2026-12-05T15:00:00.000Z',
      end: '2026-12-05T15:00:00.000Z',
      status: 'completed',
    });

    expect(await db.runMigrations({ pool: upgradePool, migrationsDirectory: throughPart1Directory })).toBe(true);
    expect(await db.runMigrations({ pool: freshPool, migrationsDirectory: throughPart1Directory })).toBe(true);
    await upgradePool.query(
      `INSERT INTO canonical_business_profiles
         (id,organization_id,version_number,version_label,raw_profile,normalized_profile,
          normalized_profile_hash,is_active,created_by)
       VALUES ($1,$2,1,'m22-part1','{}','{}',$3,TRUE,$4)`,
      [IDS.profile, IDS.organization, '1'.repeat(64), IDS.owner]
    );
    await upgradePool.query(
      `INSERT INTO subscriptions(organization_id,plan_type,status,trial_ends_at)
       VALUES ($1,'Trial','active',NULL)`,
      [IDS.organization]
    );
    await upgradePool.query(
      `INSERT INTO organization_onboarding
         (organization_id,status,active_business_profile_id,completed_at)
       VALUES ($1,'complete',$2,NOW())`,
      [IDS.organization, IDS.profile]
    );
    await upgradePool.query(
      `INSERT INTO auth_sessions
         (id,user_id,organization_id,membership_id,status,access_expires_at,
          refresh_expires_at,csrf_token_hash)
       VALUES ($1,$3,$4,$3,'active',NOW() + INTERVAL '1 hour',
               NOW() + INTERVAL '2 hours',$5),
              ($2,$3,$4,$3,'active',NOW() + INTERVAL '1 hour',
               NOW() + INTERVAL '2 hours',$5)`,
      [IDS.authSession, IDS.secondaryAuthSession, IDS.owner, IDS.organization, '2'.repeat(64)]
    );
    await seedAppointment(upgradePool, {
      organizationId: IDS.organization,
      operationId: IDS.operationMutation,
      graphId: IDS.graphMutation,
      customerId: IDS.customerMutation,
      opportunityId: IDS.opportunityMutation,
      appointmentId: IDS.appointmentMutation,
      name: 'Human approved schedule mutation',
    });
  }, 120000);

  afterAll(async () => {
    try {
      if (freshPool) await freshPool.end();
      if (upgradePool) await upgradePool.end();
    } finally {
      if (prePart1Directory && path.resolve(prePart1Directory).startsWith(path.resolve(os.tmpdir()))) {
        fs.rmSync(prePart1Directory, { recursive: true, force: true });
      }
      if (throughPart1Directory && path.resolve(throughPart1Directory).startsWith(path.resolve(os.tmpdir()))) {
        fs.rmSync(throughPart1Directory, { recursive: true, force: true });
      }
      if (freshDatabase) await freshDatabase.cleanup();
      if (upgradeDatabase) await upgradeDatabase.cleanup();
    }
  }, 90000);

  test('fresh and upgrade catalogs apply exact Part 1 authority with no invalid constraints', async () => {
    for (const pool of [freshPool, upgradePool]) {
      const relations = await pool.query(
        `SELECT to_regclass('public.canonical_schedule_assignments') AS assignments,
                to_regclass('public.canonical_schedule_assignment_revisions') AS revisions,
                to_regclass('public.canonical_schedule_approvals') AS approvals,
                to_regclass('public.canonical_schedule_audit_events') AS audit,
                to_regclass('public.canonical_schedule_idempotency') AS idempotency`
      );
      expect(relations.rows).toEqual([{
        assignments: 'canonical_schedule_assignments',
        revisions: 'canonical_schedule_assignment_revisions',
        approvals: 'canonical_schedule_approvals',
        audit: 'canonical_schedule_audit_events',
        idempotency: 'canonical_schedule_idempotency',
      }]);
      expect((await pool.query(
        `SELECT count(*)::int AS count FROM pg_constraint
          WHERE connamespace = 'public'::regnamespace
            AND conname LIKE 'canonical_schedule_%' AND NOT convalidated`
      )).rows).toEqual([{ count: 0 }]);
    }
  });

  test('deterministically backfills valid and invalid legacy schedules without fabricated approval or actor', async () => {
    const assignments = await upgradePool.query(
      `SELECT appointment_id, schedule_state, scheduled_start, scheduled_end,
              appointment_status, needs_review, review_reasons, revision,
              canonical_digest, last_approval_id, last_actor_user_id, last_action_code
         FROM canonical_schedule_assignments
        WHERE organization_id = $1 AND appointment_id IN ($2,$3)
        ORDER BY appointment_id`,
      [IDS.organization, IDS.appointmentValid, IDS.appointmentInvalid]
    );
    expect(assignments.rows).toHaveLength(2);
    expect(assignments.rows[0]).toMatchObject({
      appointment_id: IDS.appointmentValid,
      schedule_state: 'scheduled',
      appointment_status: 'scheduled',
      needs_review: true,
      revision: '1',
      last_approval_id: null,
      last_actor_user_id: null,
      last_action_code: 'legacy_import',
    });
    expect(assignments.rows[0].scheduled_start.toISOString()).toBe('2026-11-01T05:30:00.000Z');
    expect(assignments.rows[0].scheduled_end.toISOString()).toBe('2026-11-01T07:30:00.000Z');
    expect(assignments.rows[0].review_reasons).toEqual([
      'legacy_import_unreviewed', 'conflict_evaluation_not_available',
    ]);
    expect(assignments.rows[0].canonical_digest).toMatch(/^[0-9a-f]{64}$/);

    expect(assignments.rows[1]).toMatchObject({
      appointment_id: IDS.appointmentInvalid,
      schedule_state: 'unscheduled',
      scheduled_start: null,
      scheduled_end: null,
      appointment_status: 'completed',
      needs_review: true,
      last_approval_id: null,
      last_actor_user_id: null,
      last_action_code: 'legacy_import',
    });
    expect(assignments.rows[1].review_reasons).toEqual([
      'legacy_import_unreviewed', 'legacy_schedule_invalid', 'conflict_evaluation_not_available',
    ]);
    const invalidAppointment = await upgradePool.query(
      'SELECT scheduled_start, scheduled_end, status FROM canonical_appointments WHERE id = $1',
      [IDS.appointmentInvalid]
    );
    expect(invalidAppointment.rows).toEqual([{ scheduled_start: null, scheduled_end: null, status: 'completed' }]);
    const source = await upgradePool.query(
      `SELECT source_kind, actor_user_id, approval_id, source_snapshot
         FROM canonical_schedule_assignment_revisions
        WHERE organization_id = $1 AND assignment_id = (
          SELECT id FROM canonical_schedule_assignments
           WHERE organization_id = $1 AND appointment_id = $2
        )`,
      [IDS.organization, IDS.appointmentInvalid]
    );
    expect(source.rows[0]).toMatchObject({ source_kind: 'legacy_import', actor_user_id: null, approval_id: null });
    expect(new Date(source.rows[0].source_snapshot.scheduledStart).toISOString()).toBe('2026-12-05T15:00:00.000Z');
    expect(new Date(source.rows[0].source_snapshot.scheduledEnd).toISOString()).toBe('2026-12-05T15:00:00.000Z');
  });

  test('new appointments preserve accepted ingress without invented approval and later writes cannot bypass evidence', async () => {
    await seedAppointment(upgradePool, {
      organizationId: IDS.organization,
      operationId: IDS.operationNew,
      graphId: IDS.graphNew,
      customerId: IDS.customerNew,
      opportunityId: IDS.opportunityNew,
      appointmentId: IDS.appointmentNew,
      name: 'New appointment authority',
    });
    const assignment = (await upgradePool.query(
      `SELECT * FROM canonical_schedule_assignments
        WHERE organization_id = $1 AND appointment_id = $2`,
      [IDS.organization, IDS.appointmentNew]
    )).rows[0];
    expect(assignment).toMatchObject({
      target_state: 'unassigned', schedule_state: 'unscheduled',
      dispatch_state: 'not_dispatched', revision: '1',
      last_action_code: 'appointment_created', needs_review: true,
    });
    expect((await upgradePool.query(
      `SELECT count(*)::int AS count FROM canonical_schedule_assignment_revisions
        WHERE organization_id = $1 AND assignment_id = $2`,
      [IDS.organization, assignment.id]
    )).rows).toEqual([{ count: 1 }]);

    await seedAppointment(upgradePool, {
      organizationId: IDS.organization,
      operationId: IDS.operationAcceptedSchedule,
      graphId: IDS.graphAcceptedSchedule,
      customerId: IDS.customerAcceptedSchedule,
      opportunityId: IDS.opportunityAcceptedSchedule,
      appointmentId: IDS.appointmentAcceptedSchedule,
      name: 'Accepted appointment schedule compatibility ingress',
      start: '2027-01-02T13:00:00.000Z',
      end: '2027-01-02T15:00:00.000Z',
      status: 'scheduled',
    });
    const accepted = (await upgradePool.query(
      `SELECT schedule_state, scheduled_start, scheduled_end, needs_review,
              review_reasons, revision, last_approval_id, last_actor_user_id,
              last_action_code
         FROM canonical_schedule_assignments
        WHERE organization_id = $1 AND appointment_id = $2`,
      [IDS.organization, IDS.appointmentAcceptedSchedule]
    )).rows[0];
    expect(accepted).toMatchObject({
      schedule_state: 'scheduled',
      needs_review: true,
      revision: '1',
      last_approval_id: null,
      last_actor_user_id: null,
      last_action_code: 'appointment_created',
      review_reasons: [
        'appointment_creation_schedule_unreviewed',
        'conflict_evaluation_not_available',
      ],
    });
    expect(accepted.scheduled_start.toISOString()).toBe('2027-01-02T13:00:00.000Z');
    expect(accepted.scheduled_end.toISOString()).toBe('2027-01-02T15:00:00.000Z');
    expect((await upgradePool.query(
      `SELECT source_kind, actor_user_id, approval_id
         FROM canonical_schedule_assignment_revisions
        WHERE organization_id = $1 AND assignment_id = (
          SELECT id FROM canonical_schedule_assignments
           WHERE organization_id = $1 AND appointment_id = $2
        )`,
      [IDS.organization, IDS.appointmentAcceptedSchedule]
    )).rows).toEqual([{
      source_kind: 'appointment_created', actor_user_id: null, approval_id: null,
    }]);

    await expect(upgradePool.query(
      `UPDATE canonical_appointments
          SET scheduled_start = '2027-01-01T13:00:00Z',
              scheduled_end = '2027-01-01T14:00:00Z', status = 'scheduled'
        WHERE organization_id = $1 AND id = $2`,
      [IDS.organization, IDS.appointmentNew]
    )).rejects.toMatchObject({ code: '42501', constraint: 'canonical_schedule_approval_required' });
    await expect(upgradePool.query(
      `UPDATE canonical_schedule_assignments SET revision = revision + 1
        WHERE organization_id = $1 AND id = $2`,
      [IDS.organization, assignment.id]
    )).rejects.toMatchObject({
      code: '42501',
      constraint: 'canonical_schedule_approval_required'
    });
    await expect(upgradePool.query(
      `UPDATE canonical_schedule_assignment_revisions SET reason = 'rewritten'
        WHERE organization_id = $1 AND assignment_id = $2`,
      [IDS.organization, assignment.id]
    )).rejects.toMatchObject({ code: '23514', constraint: 'canonical_schedule_evidence_immutable' });
  });

  test('tenant foreign keys and strict positive intervals fail closed', async () => {
    const assignment = (await upgradePool.query(
      `SELECT id FROM canonical_schedule_assignments
        WHERE organization_id = $1 AND appointment_id = $2`,
      [IDS.organization, IDS.appointmentValid]
    )).rows[0];
    await expect(upgradePool.query(
      `UPDATE canonical_schedule_assignments
          SET workforce_profile_id = $3, workforce_crew_id = NULL, target_state = 'assigned'
        WHERE organization_id = $1 AND id = $2`,
      [IDS.organization, assignment.id, IDS.otherOwner]
    )).rejects.toMatchObject({ code: expect.stringMatching(/^(23503|23514)$/) });
    await expect(upgradePool.query(
      `INSERT INTO canonical_appointments(
         id,organization_id,operation_id,graph_id,opportunity_id,
         scheduled_start,scheduled_end,status
       ) VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$5,'scheduled')`,
      [IDS.organization, IDS.operationValid, IDS.graphValid, IDS.opportunityValid, '2027-02-01T12:00:00Z']
    )).rejects.toMatchObject({ code: expect.stringMatching(/^(23505|23514|42501)$/) });
  });

  test('repository atomically persists approval, revision, audit and idempotent compatibility projection', async () => {
    const current = (await upgradePool.query(
      `SELECT revision, canonical_digest FROM canonical_schedule_assignments
        WHERE organization_id = $1 AND appointment_id = $2`,
      [IDS.organization, IDS.appointmentMutation]
    )).rows[0];
    const base = {
      organizationId: IDS.organization,
      actorUserId: IDS.owner,
      actorAccessRole: 'owner',
      authSessionId: IDS.authSession,
      appointmentId: IDS.appointmentMutation,
      explicitSession: null,
      idempotencyKey: 'm22-part1-human-approval-0001',
      body: {
        scheduledStart: '2027-03-14T06:30:00-05:00',
        scheduledEnd: '2027-03-14T08:30:00-04:00',
        status: 'scheduled',
        expectedRevision: Number(current.revision),
        expectedDigest: current.canonical_digest.trim(),
        action: 'calendar_edit',
        reason: 'Owner approved the calendar schedule.',
      },
    };
    const normalized = normalizeScheduleMutation(base);
    replayMutation = normalized;
    const updated = await updateAppointmentSchedule(upgradePool, normalized);
    expect(updated).toMatchObject({ status: 200, replayed: false });
    expect(updated.body.data).toMatchObject({
      id: IDS.appointmentMutation,
      status: 'scheduled',
      scheduled_start: '2027-03-14T11:30:00.000Z',
      scheduled_end: '2027-03-14T12:30:00.000Z',
      scheduleAuthority: {
        revision: 2,
        scheduleState: 'scheduled',
        dispatchState: 'not_dispatched',
        needsReview: true,
        reviewReasons: ['conflict_evaluation_not_available'],
      },
    });
    expect(updated.body.data.scheduleAuthority.digest).toMatch(/^[0-9a-f]{64}$/);

    const replay = await updateAppointmentSchedule(upgradePool, normalized);
    expect(replay).toMatchObject({ status: 200, replayed: true, body: updated.body });
    const changedSessionReplay = normalizeScheduleMutation({
      ...base,
      authSessionId: IDS.secondaryAuthSession,
    });
    await expect(updateAppointmentSchedule(upgradePool, changedSessionReplay)).rejects.toMatchObject({
      status: 409, code: 'M22_IDEMPOTENCY_CONFLICT',
    });
    const collision = normalizeScheduleMutation({
      ...base,
      body: { ...base.body, reason: 'Divergent replay must fail.' },
    });
    await expect(updateAppointmentSchedule(upgradePool, collision)).rejects.toMatchObject({
      status: 409, code: 'M22_IDEMPOTENCY_CONFLICT',
    });
    const stale = normalizeScheduleMutation({
      ...base,
      idempotencyKey: 'm22-part1-human-approval-stale',
    });
    await expect(updateAppointmentSchedule(upgradePool, stale)).rejects.toMatchObject({
      status: 409, code: 'M22_STALE_APPROVAL',
    });

    const next = updated.body.data.scheduleAuthority;
    const concurrentInputs = [0, 1].map(index => normalizeScheduleMutation({
      ...base,
      idempotencyKey: `m22-part1-concurrent-approval-${index}`,
      body: {
        ...base.body,
        scheduledStart: `2027-03-${15 + index}T13:00:00Z`,
        scheduledEnd: `2027-03-${15 + index}T14:00:00Z`,
        expectedRevision: next.revision,
        expectedDigest: next.digest,
        reason: index === 0
          ? '<img src=x onerror=alert(1)> & hostile schedule reason'
          : 'Concurrent human approval 1.',
      },
    }));
    const concurrent = await Promise.allSettled(
      concurrentInputs.map(input => updateAppointmentSchedule(upgradePool, input))
    );
    expect(concurrent.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = concurrent.find(result => result.status === 'rejected');
    expect(rejected.reason).toMatchObject({ status: 409, code: 'M22_STALE_APPROVAL' });
    const winnerIndex = concurrent.findIndex(result => result.status === 'fulfilled');
    expect(concurrent[winnerIndex].value.body.data.scheduleAuthority.lastReason)
      .toBe(concurrentInputs[winnerIndex].reason);

    const evidence = await upgradePool.query(
      `SELECT
         (SELECT count(*)::int FROM canonical_schedule_approvals
           WHERE organization_id = $1 AND assignment_id = assignment.id) AS approvals,
         (SELECT count(*)::int FROM canonical_schedule_assignment_revisions
           WHERE organization_id = $1 AND assignment_id = assignment.id) AS revisions,
         (SELECT count(*)::int FROM canonical_schedule_audit_events
           WHERE organization_id = $1 AND assignment_id = assignment.id) AS audits,
         (SELECT count(*)::int FROM canonical_schedule_idempotency
           WHERE organization_id = $1 AND assignment_id = assignment.id) AS idempotency
       FROM canonical_schedule_assignments assignment
      WHERE organization_id = $1 AND appointment_id = $2`,
      [IDS.organization, IDS.appointmentMutation]
    );
    expect(evidence.rows).toEqual([{ approvals: 2, revisions: 3, audits: 2, idempotency: 2 }]);
  });

  test('audit failure rolls back the entire mutation and orphan or dispatch-forging approvals cannot commit', async () => {
    const before = (await upgradePool.query(
      `SELECT *, id AS assignment_id FROM canonical_schedule_assignments
        WHERE organization_id = $1 AND appointment_id = $2`,
      [IDS.organization, IDS.appointmentMutation]
    )).rows[0];
    const countsBefore = (await upgradePool.query(
      `SELECT
         (SELECT count(*)::int FROM canonical_schedule_approvals WHERE assignment_id = $1) AS approvals,
         (SELECT count(*)::int FROM canonical_schedule_assignment_revisions WHERE assignment_id = $1) AS revisions,
         (SELECT count(*)::int FROM canonical_schedule_audit_events WHERE assignment_id = $1) AS audits,
         (SELECT count(*)::int FROM canonical_schedule_idempotency WHERE assignment_id = $1) AS idempotency`,
      [before.id]
    )).rows[0];
    const mutation = normalizeScheduleMutation({
      organizationId: IDS.organization,
      actorUserId: IDS.owner,
      actorAccessRole: 'owner',
      authSessionId: IDS.authSession,
      appointmentId: IDS.appointmentMutation,
      explicitSession: null,
      idempotencyKey: 'm22-part1-injected-audit-failure',
      body: {
        scheduledStart: '2027-04-01T13:00:00Z',
        scheduledEnd: '2027-04-01T14:00:00Z',
        status: 'scheduled',
        expectedRevision: Number(before.revision),
        expectedDigest: before.canonical_digest.trim(),
        action: 'calendar_edit',
        reason: 'This transaction must roll back.',
      },
    });
    const failingPool = {
      async connect() {
        const client = await upgradePool.connect();
        return {
          query(...args) {
            if (/^\s*INSERT INTO canonical_schedule_audit_events/i.test(String(args[0]))) {
              throw new Error('injected canonical schedule audit failure');
            }
            return client.query(...args);
          },
          release() { client.release(); },
        };
      },
    };
    await expect(updateAppointmentSchedule(failingPool, mutation)).rejects.toMatchObject({
      status: 503, code: 'CANONICAL_PERSISTENCE_UNAVAILABLE',
    });
    const afterFailure = (await upgradePool.query(
      `SELECT revision, canonical_digest, scheduled_start, scheduled_end
         FROM canonical_schedule_assignments WHERE id = $1`,
      [before.id]
    )).rows[0];
    expect(afterFailure).toMatchObject({
      revision: before.revision,
      canonical_digest: before.canonical_digest,
      scheduled_start: before.scheduled_start,
      scheduled_end: before.scheduled_end,
    });
    const countsAfter = (await upgradePool.query(
      `SELECT
         (SELECT count(*)::int FROM canonical_schedule_approvals WHERE assignment_id = $1) AS approvals,
         (SELECT count(*)::int FROM canonical_schedule_assignment_revisions WHERE assignment_id = $1) AS revisions,
         (SELECT count(*)::int FROM canonical_schedule_audit_events WHERE assignment_id = $1) AS audits,
         (SELECT count(*)::int FROM canonical_schedule_idempotency WHERE assignment_id = $1) AS idempotency`,
      [before.id]
    )).rows[0];
    expect(countsAfter).toEqual(countsBefore);

    const direct = await upgradePool.connect();
    try {
      await direct.query('BEGIN');
      await direct.query(
        `INSERT INTO canonical_schedule_approvals
           (organization_id,assignment_id,appointment_id,actor_user_id,actor_access_role,
            auth_session_id,expected_revision,expected_digest,applied_revision,applied_digest,
            request_digest,idempotency_key_hash,action_code,reason,approved_scheduled_start,
            approved_scheduled_end,approved_appointment_status,resulting_schedule_state,
            resulting_dispatch_state,resulting_needs_review,resulting_review_reasons)
         VALUES ($1,$2,$3,$4,'owner',$5,$6,$7,$8,$7,$9,$10,'calendar_edit',$11,
                 $12,$13,$14,$15,'not_dispatched',$16,$17::jsonb)`,
        [IDS.organization, before.id, IDS.appointmentMutation, IDS.owner, IDS.authSession,
          Number(before.revision), before.canonical_digest.trim(), Number(before.revision) + 1,
          '3'.repeat(64), '4'.repeat(64), 'Orphan approval must not commit.',
          before.scheduled_start, before.scheduled_end, before.appointment_status,
          before.schedule_state, before.needs_review, JSON.stringify(before.review_reasons)]
      );
      await expect(direct.query('COMMIT')).rejects.toMatchObject({
        code: '23514', constraint: 'canonical_schedule_approval_incomplete',
      });
    } finally {
      try { await direct.query('ROLLBACK'); } catch (_) { /* Transaction already failed closed. */ }
      direct.release();
    }

    const forgedDigest = (await upgradePool.query(
      `SELECT canonical_schedule_assignment_digest(
         target_state,workforce_profile_id,workforce_crew_id,schedule_state,'dispatched',
         scheduled_start,scheduled_end,appointment_status,needs_review,review_reasons) AS digest
         FROM canonical_schedule_assignments WHERE id = $1`,
      [before.id]
    )).rows[0].digest;
    await expect(upgradePool.query(
      `INSERT INTO canonical_schedule_approvals
         (organization_id,assignment_id,appointment_id,actor_user_id,actor_access_role,
          auth_session_id,expected_revision,expected_digest,applied_revision,applied_digest,
          request_digest,idempotency_key_hash,action_code,reason,approved_scheduled_start,
          approved_scheduled_end,approved_appointment_status,resulting_schedule_state,
          resulting_dispatch_state,resulting_needs_review,resulting_review_reasons)
       VALUES ($1,$2,$3,$4,'owner',$5,$6,$7,$8,$9,$10,$11,'calendar_edit',$12,
               $13,$14,$15,$16,'dispatched',$17,$18::jsonb)`,
      [IDS.organization, before.id, IDS.appointmentMutation, IDS.owner, IDS.authSession,
        Number(before.revision), before.canonical_digest.trim(), Number(before.revision) + 1,
        forgedDigest, '5'.repeat(64), '6'.repeat(64), 'Dispatch forgery.',
        before.scheduled_start, before.scheduled_end, before.appointment_status,
        before.schedule_state, before.needs_review, JSON.stringify(before.review_reasons)]
    )).rejects.toMatchObject({
      code: '23514', constraint: 'canonical_schedule_dispatch_transition_forbidden',
    });

    await upgradePool.query(
      `UPDATE auth_sessions
          SET status = 'revoked', revoked_at = NOW(), revoke_reason = 'm22_part1_test'
        WHERE id = $1`,
      [IDS.authSession]
    );
    await expect(updateAppointmentSchedule(upgradePool, replayMutation)).rejects.toMatchObject({
      status: 403, code: 'M22_APPROVAL_FORBIDDEN',
    });
    await upgradePool.query(
      `UPDATE auth_sessions
          SET status = 'active', revoked_at = NULL, revoke_reason = NULL
        WHERE id = $1`,
      [IDS.authSession]
    );
  });
});
