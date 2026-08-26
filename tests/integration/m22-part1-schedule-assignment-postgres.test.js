'use strict';

const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { Client, Pool } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { normalizeScheduleMutation } = require('../../src/scheduling/contract');
const { updateAppointmentSchedule } = require('../../src/scheduling/repository');
const { putBusinessProfile } = require('../../src/services/organizationAuthority');

const ROOT = path.resolve(__dirname, '..', '..');
const MIGRATIONS = path.join(ROOT, 'migrations');
const PART1_MIGRATION = '032_canonical_schedule_assignment_authority.sql';
const TIME_EVIDENCE_MIGRATION = '033_canonical_schedule_time_evidence.sql';
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
  operationTime: 'a3000000-0000-4000-8000-000000000006',
  graphTime: 'a4000000-0000-4000-8000-000000000006',
  customerTime: 'a5000000-0000-4000-8000-000000000006',
  opportunityTime: 'a6000000-0000-4000-8000-000000000006',
  appointmentTime: 'a7000000-0000-4000-8000-000000000006',
  operationPre033: 'a3000000-0000-4000-8000-000000000007',
  graphPre033: 'a4000000-0000-4000-8000-000000000007',
  customerPre033: 'a5000000-0000-4000-8000-000000000007',
  opportunityPre033: 'a6000000-0000-4000-8000-000000000007',
  appointmentPre033: 'a7000000-0000-4000-8000-000000000007',
  operationDirect: 'a3000000-0000-4000-8000-000000000008',
  graphDirect: 'a4000000-0000-4000-8000-000000000008',
  customerDirect: 'a5000000-0000-4000-8000-000000000008',
  opportunityDirect: 'a6000000-0000-4000-8000-000000000008',
  appointmentDirect: 'a7000000-0000-4000-8000-000000000008',
});

function quoteIdentifier(value) {
  return '"' + String(value).replace(/"/g, '""') + '"';
}

function roleConnectionString(connectionString, role) {
  const parsed = new URL(connectionString);
  parsed.username = role;
  parsed.password = '';
  return parsed.toString();
}

async function provisionSeparatedDatabaseRoles(database) {
  const suffix = `${process.pid}_${crypto.randomBytes(5).toString('hex')}`;
  const migrationRole = `northstar-m22-p1-migration-${suffix}`.slice(0, 63);
  const runtimeRole = `northstar-m22-p1-runtime-${suffix}`.slice(0, 63);
  const admin = new Client({ connectionString: process.env.M19_PG_ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(
      `CREATE ROLE ${quoteIdentifier(migrationRole)}
         LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`
    );
    await admin.query(
      `CREATE ROLE ${quoteIdentifier(runtimeRole)}
         LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`
    );
    await admin.query(
      `ALTER DATABASE ${quoteIdentifier(database.databaseName)}
         OWNER TO ${quoteIdentifier(migrationRole)}`
    );
  } finally {
    await admin.end();
  }
  return {
    migrationRole,
    runtimeRole,
    migrationUrl: roleConnectionString(database.connectionString, migrationRole),
    runtimeUrl: roleConnectionString(database.connectionString, runtimeRole),
  };
}

async function dropSeparatedDatabaseRoles(roles) {
  if (!roles) return;
  const admin = new Client({ connectionString: process.env.M19_PG_ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`DROP ROLE ${quoteIdentifier(roles.runtimeRole)}`);
    await admin.query(`DROP ROLE ${quoteIdentifier(roles.migrationRole)}`);
  } finally {
    await admin.end();
  }
}

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

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

async function commitDirectScheduleMutation(pool, input) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'SELECT id FROM public.organizations WHERE id=$1 FOR SHARE',
      [input.organizationId]
    );
    const profile = (await client.query(
      `SELECT profile.id, profile.version_number, profile.normalized_profile_hash,
              profile.raw_profile #>> '{company,timeZone}' AS time_zone
         FROM public.organization_onboarding onboarding
         JOIN public.canonical_business_profiles profile
           ON profile.organization_id=onboarding.organization_id
          AND profile.id=onboarding.active_business_profile_id
        WHERE onboarding.organization_id=$1
        FOR SHARE OF onboarding, profile`,
      [input.organizationId]
    )).rows[0];
    const assignment = (await client.query(
      `SELECT * FROM public.canonical_schedule_assignments
        WHERE organization_id=$1 AND appointment_id=$2
        FOR UPDATE`,
      [input.organizationId, input.appointmentId]
    )).rows[0];
    const approvedStart = hasOwn(input, 'approvedStart')
      ? input.approvedStart : assignment.scheduled_start;
    const approvedEnd = hasOwn(input, 'approvedEnd')
      ? input.approvedEnd : assignment.scheduled_end;
    const appointmentStatus = input.status || assignment.appointment_status;
    const scheduleState = approvedStart === null && approvedEnd === null ? 'unscheduled' : 'scheduled';
    const dispatchState = assignment.dispatch_state === 'dispatched' &&
      (String(assignment.scheduled_start) !== String(approvedStart) ||
       String(assignment.scheduled_end) !== String(approvedEnd))
      ? 'revoked' : assignment.dispatch_state;
    const reviewReasons = ['conflict_evaluation_not_available'];
    const appliedDigest = String((await client.query(
      `SELECT public.canonical_schedule_assignment_digest(
         $1,$2,$3,$4,$5,$6,$7,$8,TRUE,$9::jsonb) AS digest`,
      [assignment.target_state, assignment.workforce_profile_id, assignment.workforce_crew_id,
        scheduleState, dispatchState, approvedStart, approvedEnd, appointmentStatus,
        JSON.stringify(reviewReasons)]
    )).rows[0].digest).trim();
    const appliedRevision = Number(assignment.revision) + 1;
    const requestDigest = sha256(`request:${input.key}`);
    const idempotencyHash = sha256(`idempotency:${input.key}`);
    let evidence = null;

    if (input.beforeApproval) await input.beforeApproval(client, profile);
    if (input.includeTimeEvidence !== false) {
      const submittedSchedule = input.submittedSchedule || {
        startProvided: hasOwn(input, 'rawStart'),
        endProvided: hasOwn(input, 'rawEnd'),
        scheduledStart: hasOwn(input, 'rawStart') ? input.rawStart : null,
        scheduledEnd: hasOwn(input, 'rawEnd') ? input.rawEnd : null,
      };
      const timeZoneAuthority = input.timeZoneAuthority || {
        profileId: String(profile.id),
        profileVersion: Number(profile.version_number),
        profileHash: String(profile.normalized_profile_hash).trim(),
        timeZone: profile.time_zone,
      };
      const version = input.timeEvidenceVersion === undefined ? 2 : input.timeEvidenceVersion;
      const computedDigest = input.skipDigestComputation ? null : String((await client.query(
        `SELECT public.canonical_schedule_time_evidence_digest($1::smallint,$2::jsonb,$3::jsonb) AS digest`,
        [version, JSON.stringify(submittedSchedule), JSON.stringify(timeZoneAuthority)]
      )).rows[0].digest || '').trim();
      evidence = {
        timeEvidenceVersion: version,
        submittedSchedule,
        timeZoneAuthority,
        timeEvidenceDigest: hasOwn(input, 'timeEvidenceDigest')
          ? input.timeEvidenceDigest : computedDigest,
      };
    }

    const approval = (await client.query(
      `INSERT INTO public.canonical_schedule_approvals
         (organization_id,assignment_id,appointment_id,actor_user_id,actor_access_role,
          auth_session_id,expected_revision,expected_digest,applied_revision,applied_digest,
          request_digest,idempotency_key_hash,action_code,reason,approved_scheduled_start,
          approved_scheduled_end,approved_appointment_status,resulting_schedule_state,
          resulting_dispatch_state,resulting_needs_review,resulting_review_reasons
          ${evidence ? ',time_evidence_version,submitted_schedule,time_zone_authority,time_evidence_digest' : ''})
       VALUES ($1,$2,$3,$4,'owner',$5,$6,$7,$8,$9,$10,$11,'calendar_edit',$12,
               $13,$14,$15,$16,$17,TRUE,$18::jsonb
               ${evidence ? ',$19,$20::jsonb,$21::jsonb,$22' : ''})
       RETURNING id`,
      [input.organizationId, assignment.id, input.appointmentId, IDS.owner, IDS.authSession,
        Number(assignment.revision), String(assignment.canonical_digest).trim(),
        appliedRevision, appliedDigest, requestDigest, idempotencyHash,
        input.reason || 'Direct mounted schedule evidence transaction.',
        approvedStart, approvedEnd, appointmentStatus, scheduleState, dispatchState,
        JSON.stringify(reviewReasons),
        ...(evidence ? [evidence.timeEvidenceVersion, JSON.stringify(evidence.submittedSchedule),
          JSON.stringify(evidence.timeZoneAuthority), evidence.timeEvidenceDigest] : [])]
    )).rows[0];
    if (input.afterApproval) await input.afterApproval(client, profile);

    await client.query(
      `UPDATE public.canonical_schedule_assignments
          SET schedule_state=$3,dispatch_state=$4,scheduled_start=$5,scheduled_end=$6,
              appointment_status=$7,needs_review=TRUE,review_reasons=$8::jsonb,
              revision=$9,canonical_digest=$10,last_approval_id=$11,last_actor_user_id=$12,
              last_action_code='calendar_edit',last_reason=$13,updated_at=NOW()
        WHERE organization_id=$1 AND id=$2`,
      [input.organizationId, assignment.id, scheduleState, dispatchState, approvedStart,
        approvedEnd, appointmentStatus, JSON.stringify(reviewReasons), appliedRevision,
        appliedDigest, approval.id, IDS.owner,
        input.reason || 'Direct mounted schedule evidence transaction.']
    );
    const canonicalEvidence = evidence ? {
      timeEvidenceVersion: evidence.timeEvidenceVersion,
      submittedSchedule: evidence.submittedSchedule,
      timeZoneAuthority: evidence.timeZoneAuthority,
      timeEvidenceDigest: evidence.timeEvidenceDigest,
    } : {};
    const sourceSnapshot = hasOwn(input, 'sourceSnapshot')
      ? input.sourceSnapshot : canonicalEvidence;
    const details = hasOwn(input, 'details') ? input.details : canonicalEvidence;
    await client.query(
      `INSERT INTO public.canonical_schedule_assignment_revisions
         (organization_id,assignment_id,revision,workforce_profile_id,workforce_crew_id,
          target_state,schedule_state,dispatch_state,scheduled_start,scheduled_end,
          appointment_status,needs_review,review_reasons,canonical_digest,source_kind,
          approval_id,actor_user_id,action_code,reason,request_digest,source_snapshot)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE,$12::jsonb,$13,
               'human_approved',$14,$15,'calendar_edit',$16,$17,$18::jsonb)`,
      [input.organizationId, assignment.id, appliedRevision, assignment.workforce_profile_id,
        assignment.workforce_crew_id, assignment.target_state, scheduleState, dispatchState,
        approvedStart, approvedEnd, appointmentStatus, JSON.stringify(reviewReasons),
        appliedDigest, approval.id, IDS.owner,
        input.reason || 'Direct mounted schedule evidence transaction.', requestDigest,
        JSON.stringify(sourceSnapshot)]
    );
    await client.query(
      `UPDATE public.canonical_appointments
          SET scheduled_start=$3,scheduled_end=$4,status=$5,updated_at=NOW()
        WHERE organization_id=$1 AND id=$2`,
      [input.organizationId, input.appointmentId, approvedStart, approvedEnd, appointmentStatus]
    );
    await client.query(
      `INSERT INTO public.canonical_schedule_audit_events
         (organization_id,assignment_id,approval_id,actor_user_id,action_code,reason,
          before_revision,after_revision,before_digest,after_digest,details)
       VALUES ($1,$2,$3,$4,'calendar_edit',$5,$6,$7,$8,$9,$10::jsonb)`,
      [input.organizationId, assignment.id, approval.id, IDS.owner,
        input.reason || 'Direct mounted schedule evidence transaction.',
        Number(assignment.revision), appliedRevision, String(assignment.canonical_digest).trim(),
        appliedDigest, JSON.stringify(details)]
    );
    const responseBody = {
      success: true,
      data: {
        id: input.appointmentId,
        scheduleAuthority: { revision: appliedRevision, digest: appliedDigest },
      },
    };
    await client.query(
      `INSERT INTO public.canonical_schedule_idempotency
         (organization_id,actor_user_id,idempotency_key_hash,request_digest,
          assignment_id,approval_id,response_status,response_body)
       VALUES ($1,$2,$3,$4,$5,$6,200,$7::jsonb)`,
      [input.organizationId, IDS.owner, idempotencyHash, requestDigest,
        assignment.id, approval.id, JSON.stringify(responseBody)]
    );
    await client.query('COMMIT');
    return { assignmentId: assignment.id, approvalId: approval.id, appliedRevision, appliedDigest };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* Preserve the authoritative failure. */ }
    throw error;
  } finally {
    client.release();
  }
}

realPostgres('Mission 22 Part 1 canonical schedule migration authority', () => {
  let freshDatabase;
  let upgradeDatabase;
  let freshPool;
  let upgradePool;
  let separatedDatabase;
  let separatedRoles;
  let separatedMigrationPool;
  let separatedRuntimePool;
  let prePart1Directory;
  let through032Directory;
  let throughPart1Directory;
  let db;
  let replayMutation;

  beforeAll(async () => {
    freshDatabase = await createSuiteDatabase('m22-p1-fresh');
    upgradeDatabase = await createSuiteDatabase('m22-p1-upgrade');
    separatedDatabase = await createSuiteDatabase('m22-p1-separated');
    separatedRoles = await provisionSeparatedDatabaseRoles(separatedDatabase);
    freshPool = new Pool({ connectionString: freshDatabase.connectionString, max: 4 });
    upgradePool = new Pool({ connectionString: upgradeDatabase.connectionString, max: 6 });
    separatedMigrationPool = new Pool({ connectionString: separatedRoles.migrationUrl, max: 2 });
    separatedRuntimePool = new Pool({ connectionString: separatedRoles.runtimeUrl, max: 4 });
    prePart1Directory = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m22-p1-pre032-'));
    through032Directory = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m22-p1-through032-'));
    throughPart1Directory = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m22-p1-through033-'));
    for (const filename of migrationFiles(MIGRATIONS).filter(name => name < PART1_MIGRATION)) {
      fs.copyFileSync(path.join(MIGRATIONS, filename), path.join(prePart1Directory, filename));
    }
    for (const filename of migrationFiles(MIGRATIONS).filter(name => name <= PART1_MIGRATION)) {
      fs.copyFileSync(path.join(MIGRATIONS, filename), path.join(through032Directory, filename));
    }
    for (const filename of migrationFiles(MIGRATIONS).filter(name => name <= TIME_EVIDENCE_MIGRATION)) {
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

    expect(await db.runMigrations({ pool: upgradePool, migrationsDirectory: through032Directory })).toBe(true);
    await upgradePool.query(
      `INSERT INTO canonical_business_profiles
         (id,organization_id,version_number,version_label,raw_profile,normalized_profile,
          normalized_profile_hash,is_active,created_by)
       VALUES ($1,$2,1,'org-profile-v1','{"company":{"timeZone":"America/New_York"}}','{}',$3,TRUE,$4)`,
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
    await seedAppointment(upgradePool, {
      organizationId: IDS.organization,
      operationId: IDS.operationTime,
      graphId: IDS.graphTime,
      customerId: IDS.customerTime,
      opportunityId: IDS.opportunityTime,
      appointmentId: IDS.appointmentTime,
      name: 'Tenant time-zone authority mutation',
    });
    await seedAppointment(upgradePool, {
      organizationId: IDS.organization,
      operationId: IDS.operationPre033,
      graphId: IDS.graphPre033,
      customerId: IDS.customerPre033,
      opportunityId: IDS.opportunityPre033,
      appointmentId: IDS.appointmentPre033,
      name: 'Pre-033 approval compatibility',
    });
    await commitDirectScheduleMutation(upgradePool, {
      organizationId: IDS.organization,
      appointmentId: IDS.appointmentPre033,
      key: 'm22-pre033-legacy-approval',
      includeTimeEvidence: false,
      approvedStart: '2027-02-01T14:00:00.000Z',
      approvedEnd: '2027-02-01T15:00:00.000Z',
      status: 'scheduled',
      reason: 'Committed before migration 033 without fabricated evidence.',
    });

    expect(await db.runMigrations({ pool: upgradePool, migrationsDirectory: throughPart1Directory })).toBe(true);
    expect(await db.runMigrations({ pool: freshPool, migrationsDirectory: throughPart1Directory })).toBe(true);
    expect(await db.runMigrations({
      pool: separatedMigrationPool,
      runtimePool: separatedRuntimePool,
      migrationsDirectory: throughPart1Directory,
    })).toBe(true);

    await seedOrganization(separatedRuntimePool, IDS.organization, IDS.owner, 'separated');
    await separatedRuntimePool.query(
      `INSERT INTO canonical_business_profiles
         (id,organization_id,version_number,version_label,raw_profile,normalized_profile,
          normalized_profile_hash,is_active,created_by)
       VALUES ($1,$2,1,'org-profile-v1','{"company":{"timeZone":"America/New_York"}}','{}',$3,TRUE,$4)`,
      [IDS.profile, IDS.organization, '3'.repeat(64), IDS.owner]
    );
    await separatedRuntimePool.query(
      `INSERT INTO subscriptions(organization_id,plan_type,status,trial_ends_at)
       VALUES ($1,'Trial','active',NULL)`,
      [IDS.organization]
    );
    await separatedRuntimePool.query(
      `INSERT INTO organization_onboarding
         (organization_id,status,active_business_profile_id,completed_at)
       VALUES ($1,'complete',$2,NOW())`,
      [IDS.organization, IDS.profile]
    );
    await separatedRuntimePool.query(
      `INSERT INTO auth_sessions
         (id,user_id,organization_id,membership_id,status,access_expires_at,
          refresh_expires_at,csrf_token_hash)
       VALUES ($1,$2,$3,$2,'active',NOW() + INTERVAL '1 hour',
               NOW() + INTERVAL '2 hours',$4)`,
      [IDS.authSession, IDS.owner, IDS.organization, '4'.repeat(64)]
    );
    await seedAppointment(separatedRuntimePool, {
      organizationId: IDS.organization,
      operationId: IDS.operationMutation,
      graphId: IDS.graphMutation,
      customerId: IDS.customerMutation,
      opportunityId: IDS.opportunityMutation,
      appointmentId: IDS.appointmentMutation,
      name: 'Search path invariant schedule',
    });
    await seedAppointment(separatedRuntimePool, {
      organizationId: IDS.organization,
      operationId: IDS.operationDirect,
      graphId: IDS.graphDirect,
      customerId: IDS.customerDirect,
      opportunityId: IDS.opportunityDirect,
      appointmentId: IDS.appointmentDirect,
      name: 'Direct runtime time evidence boundary',
    });
    await separatedRuntimePool.query(
      `UPDATE public.canonical_transcripts
          SET source='simulation', external_call_id='m22-separated-scope:call'
        WHERE organization_id=$1 AND operation_id=$2`,
      [IDS.organization, IDS.operationMutation]
    );
  }, 120000);

  afterAll(async () => {
    try {
      if (freshPool) await freshPool.end();
      if (upgradePool) await upgradePool.end();
      if (separatedRuntimePool) await separatedRuntimePool.end();
      if (separatedMigrationPool) await separatedMigrationPool.end();
    } finally {
      if (prePart1Directory && path.resolve(prePart1Directory).startsWith(path.resolve(os.tmpdir()))) {
        fs.rmSync(prePart1Directory, { recursive: true, force: true });
      }
      if (through032Directory && path.resolve(through032Directory).startsWith(path.resolve(os.tmpdir()))) {
        fs.rmSync(through032Directory, { recursive: true, force: true });
      }
      if (throughPart1Directory && path.resolve(throughPart1Directory).startsWith(path.resolve(os.tmpdir()))) {
        fs.rmSync(throughPart1Directory, { recursive: true, force: true });
      }
      if (freshDatabase) await freshDatabase.cleanup();
      if (upgradeDatabase) await upgradeDatabase.cleanup();
      if (separatedDatabase) await separatedDatabase.cleanup();
      await dropSeparatedDatabaseRoles(separatedRoles);
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
      expect((await pool.query(
        `SELECT column_name, column_default, is_nullable
           FROM information_schema.columns
          WHERE table_schema='public' AND table_name='canonical_schedule_approvals'
            AND column_name IN (
              'time_evidence_version','submitted_schedule','time_zone_authority','time_evidence_digest'
            )
          ORDER BY ordinal_position`
      )).rows).toEqual([
        { column_name: 'time_evidence_version', column_default: '2', is_nullable: 'NO' },
        { column_name: 'submitted_schedule', column_default: null, is_nullable: 'YES' },
        { column_name: 'time_zone_authority', column_default: null, is_nullable: 'YES' },
        { column_name: 'time_evidence_digest', column_default: null, is_nullable: 'YES' },
      ]);
    }
  });

  test('keeps pre-033 approvals readable and immutable without fabricating time evidence', async () => {
    const legacy = await upgradePool.query(
      `SELECT approval.time_evidence_version, approval.submitted_schedule,
              approval.time_zone_authority, approval.time_evidence_digest
         FROM public.canonical_schedule_approvals approval
         JOIN public.canonical_schedule_assignments assignment
           ON assignment.organization_id=approval.organization_id
          AND assignment.id=approval.assignment_id
        WHERE approval.organization_id=$1 AND assignment.appointment_id=$2`,
      [IDS.organization, IDS.appointmentPre033]
    );
    expect(legacy.rows).toEqual([{
      time_evidence_version: 1,
      submitted_schedule: null,
      time_zone_authority: null,
      time_evidence_digest: null,
    }]);
    await expect(upgradePool.query(
      `UPDATE public.canonical_schedule_approvals
          SET time_evidence_version=2
        WHERE organization_id=$1 AND id=(
          SELECT approval.id
            FROM public.canonical_schedule_approvals approval
            JOIN public.canonical_schedule_assignments assignment
              ON assignment.organization_id=approval.organization_id
             AND assignment.id=approval.assignment_id
           WHERE approval.organization_id=$1 AND assignment.appointment_id=$2
        )`,
      [IDS.organization, IDS.appointmentPre033]
    )).rejects.toMatchObject({
      code: '23514', constraint: 'canonical_schedule_evidence_immutable',
    });
  });

  test('pins every Part 1 function and preserves runtime authority under hostile session name resolution', async () => {
    const functions = await separatedRuntimePool.query(
      `SELECT proname, proconfig
         FROM pg_catalog.pg_proc
        WHERE pronamespace = 'public'::pg_catalog.regnamespace
          AND proname = ANY($1::text[])
        ORDER BY proname`,
      [[
        'canonical_schedule_assignment_digest',
        'canonical_schedule_create_for_appointment',
        'canonical_schedule_guard_appointment_write',
        'canonical_schedule_guard_assignment',
        'canonical_schedule_guard_revision',
        'canonical_schedule_immutable_evidence',
        'canonical_schedule_time_evidence_digest',
        'canonical_schedule_validate_approval',
        'canonical_schedule_validate_approval_completion',
        'canonical_schedule_validate_rfc3339_in_zone',
      ]]
    );
    expect(functions.rows).toHaveLength(10);
    expect(functions.rows.every(row =>
      JSON.stringify(row.proconfig) === JSON.stringify(['search_path=pg_catalog, public, pg_temp'])
    )).toBe(true);

    const identity = (await separatedRuntimePool.query(
      `SELECT current_user AS role,
              pg_catalog.current_setting('server_version') AS version,
              pg_catalog.current_setting('TimeZone') AS timezone,
              pg_catalog.has_schema_privilege(current_user, 'public', 'CREATE') AS public_create,
              pg_catalog.has_table_privilege(current_user, 'public._migrations', 'SELECT') AS migration_read`
    )).rows[0];
    expect(identity).toMatchObject({
      role: separatedRoles.runtimeRole,
      version: expect.stringMatching(/^18\./),
      timezone: 'UTC',
      public_create: false,
      migration_read: false,
    });

    const client = await separatedRuntimePool.connect();
    try {
      await client.query('SET search_path = pg_temp, public, pg_catalog');
      for (const relation of [
        'organizations', 'organization_memberships', 'workforce_profiles', 'workforce_crews',
        'auth_sessions', 'subscriptions', 'organization_onboarding',
        'canonical_operations', 'canonical_opportunities', 'canonical_schedule_assignments',
        'canonical_appointments', 'canonical_transcripts', 'canonical_schedule_approvals',
        'canonical_schedule_assignment_revisions', 'canonical_schedule_audit_events',
        'canonical_schedule_idempotency',
      ]) {
        await client.query(`CREATE TEMP TABLE ${quoteIdentifier(relation)} (marker text)`);
      }
      await client.query(
        `CREATE FUNCTION pg_temp.canonical_schedule_time_evidence_digest(smallint,jsonb,jsonb)
         RETURNS text LANGUAGE sql IMMUTABLE AS 'SELECT repeat(''0'',64)'`
      );
      await client.query(
        `CREATE FUNCTION pg_temp.canonical_schedule_validate_rfc3339_in_zone(text,timestamptz,text)
         RETURNS boolean LANGUAGE sql IMMUTABLE AS 'SELECT TRUE'`
      );
      expect((await client.query(
        `SELECT public.canonical_schedule_validate_rfc3339_in_zone(
           '2027-07-01T09:00:00-04:00','2027-07-01T13:00:00Z','america/new_york'
         ) AS valid`
      )).rows).toEqual([{ valid: true }]);
      const authority = (await client.query(
        `SELECT revision, canonical_digest
           FROM public.canonical_schedule_assignments
          WHERE organization_id=$1 AND appointment_id=$2`,
        [IDS.organization, IDS.appointmentMutation]
      )).rows[0];
      const input = normalizeScheduleMutation({
        organizationId: IDS.organization,
        actorUserId: IDS.owner,
        actorAccessRole: 'owner',
        authSessionId: IDS.authSession,
        appointmentId: IDS.appointmentMutation,
        explicitSession: 'm22-separated-scope',
        idempotencyKey: 'm22-search-path-invariant-0001',
        body: {
          expectedRevision: Number(authority.revision),
          expectedDigest: String(authority.canonical_digest).trim(),
          expectedTimeZone: 'America/New_York',
          action: 'calendar_edit',
          reason: 'Approve through the role-separated runtime boundary.',
          scheduledStart: '2026-11-03T10:00:00-05:00',
          scheduledEnd: '2026-11-03T11:00:00-05:00',
        },
      });
      const wrapper = { connect: async () => ({
        query: client.query.bind(client),
        release() {},
      }) };
      const result = await updateAppointmentSchedule(wrapper, input);
      expect(result.status).toBe(200);
      expect(result.body.data.scheduleAuthority).toMatchObject({ revision: 2, lastAction: 'calendar_edit' });
      expect((await client.query('SHOW search_path')).rows[0].search_path)
        .toBe('pg_temp, public, pg_catalog');

      const wrongScope = normalizeScheduleMutation({
        organizationId: IDS.organization,
        actorUserId: IDS.owner,
        actorAccessRole: 'owner',
        authSessionId: IDS.authSession,
        appointmentId: IDS.appointmentMutation,
        explicitSession: 'm22-wrong-scope',
        idempotencyKey: 'm22-search-path-wrong-scope-0002',
        body: {
          expectedRevision: 2,
          expectedDigest: result.body.data.scheduleAuthority.digest,
          expectedTimeZone: 'America/New_York',
          action: 'calendar_edit',
          reason: 'This mismatched simulation scope must remain rejected.',
          scheduledStart: '2026-11-03T11:00:00-05:00',
          scheduledEnd: '2026-11-03T12:00:00-05:00',
        },
      });
      await expect(updateAppointmentSchedule(wrapper, wrongScope)).rejects.toMatchObject({
        status: 404, code: 'NOT_FOUND',
      });

      await expect(client.query(
        `UPDATE public.canonical_appointments
            SET scheduled_end = scheduled_end + INTERVAL '30 minutes'
          WHERE organization_id=$1 AND id=$2`,
        [IDS.organization, IDS.appointmentMutation]
      )).rejects.toMatchObject({ code: '42501', constraint: 'canonical_schedule_approval_required' });
      await expect(client.query('SELECT * FROM public._migrations LIMIT 1'))
        .rejects.toMatchObject({ code: '42501' });
    } finally {
      await client.query('RESET search_path').catch(() => {});
      client.release();
    }
  });

  test('separated runtime SQL cannot forge time evidence and valid folds remain independently provable', async () => {
    async function durableState() {
      return (await separatedRuntimePool.query(
        `SELECT assignment.revision, assignment.scheduled_start, assignment.scheduled_end,
                assignment.schedule_state, assignment.appointment_status,
                (SELECT count(*)::int FROM public.canonical_schedule_approvals approval
                  WHERE approval.organization_id=assignment.organization_id
                    AND approval.assignment_id=assignment.id) AS approvals,
                (SELECT count(*)::int FROM public.canonical_schedule_assignment_revisions revision
                  WHERE revision.organization_id=assignment.organization_id
                    AND revision.assignment_id=assignment.id) AS revisions,
                (SELECT count(*)::int FROM public.canonical_schedule_audit_events audit
                  WHERE audit.organization_id=assignment.organization_id
                    AND audit.assignment_id=assignment.id) AS audits,
                (SELECT count(*)::int FROM public.canonical_schedule_idempotency replay
                  WHERE replay.organization_id=assignment.organization_id
                    AND replay.assignment_id=assignment.id) AS idempotency
           FROM public.canonical_schedule_assignments assignment
          WHERE assignment.organization_id=$1 AND assignment.appointment_id=$2`,
        [IDS.organization, IDS.appointmentDirect]
      )).rows[0];
    }
    async function currentProfile() {
      return (await separatedRuntimePool.query(
        `SELECT profile.id, profile.version_number, profile.version_label,
                rtrim(profile.normalized_profile_hash) AS profile_hash,
                profile.raw_profile #>> '{company,timeZone}' AS time_zone
           FROM public.organization_onboarding onboarding
           JOIN public.canonical_business_profiles profile
             ON profile.organization_id=onboarding.organization_id
            AND profile.id=onboarding.active_business_profile_id
          WHERE onboarding.organization_id=$1`,
        [IDS.organization]
      )).rows[0];
    }
    function authorityEvidence(profile, overrides = {}) {
      return {
        profileId: String(profile.id),
        profileVersion: Number(profile.version_number),
        profileHash: String(profile.profile_hash),
        timeZone: profile.time_zone,
        ...overrides,
      };
    }
    async function expectRejected(input, constraint) {
      const before = await durableState();
      await expect(commitDirectScheduleMutation(separatedRuntimePool, {
        organizationId: IDS.organization,
        appointmentId: IDS.appointmentDirect,
        ...input,
      })).rejects.toMatchObject({ code: expect.stringMatching(/^(23514|40001|42501)$/), constraint });
      const after = await durableState();
      expect(after).toEqual(before);
    }
    async function replaceSeparatedZone(timeZone) {
      const profile = await currentProfile();
      return putBusinessProfile(separatedRuntimePool, {
        organizationId: IDS.organization,
        userId: IDS.owner,
        expectedVersion: profile.version_label,
        profile: { company: timeZone ? { timeZone } : {} },
      });
    }

    const initial = await durableState();
    expect(initial).toMatchObject({
      revision: '1', scheduled_start: null, scheduled_end: null,
      schedule_state: 'unscheduled', approvals: 0, revisions: 1, audits: 0, idempotency: 0,
    });

    // Replay the validated P1 transaction: a runtime role supplies a New York
    // gap instant and attempts the otherwise-complete mutation with empty
    // revision/audit evidence. Migration 033 now rejects its root approval.
    await expectRejected({
      key: 'm22-direct-gap-no-evidence',
      includeTimeEvidence: false,
      approvedStart: '2027-03-14T07:30:00.000Z',
      approvedEnd: '2027-03-14T08:30:00.000Z',
      status: 'scheduled',
      sourceSnapshot: {},
      details: {},
    }, 'canonical_schedule_time_evidence_invalid');

    const profile = await currentProfile();
    const validNewYork = {
      rawStart: '2027-07-01T09:00:00-04:00',
      rawEnd: '2027-07-01T10:00:00-04:00',
      approvedStart: '2027-07-01T13:00:00.000Z',
      approvedEnd: '2027-07-01T14:00:00.000Z',
      status: 'scheduled',
    };
    await expectRejected({
      key: 'm22-direct-explicit-v1', ...validNewYork, timeEvidenceVersion: 1,
    }, 'canonical_schedule_time_evidence_version_required');
    await expectRejected({
      key: 'm22-direct-malformed-shape', ...validNewYork,
      submittedSchedule: {
        startProvided: true, endProvided: true,
        scheduledStart: validNewYork.rawStart,
      },
    }, 'canonical_schedule_time_evidence_invalid');
    await expectRejected({
      key: 'm22-direct-bad-digest', ...validNewYork, timeEvidenceDigest: '0'.repeat(64),
    }, 'canonical_schedule_time_evidence_digest_invalid');
    await expectRejected({
      key: 'm22-direct-stale-profile-id', ...validNewYork,
      timeZoneAuthority: authorityEvidence(profile, {
        profileId: 'b8000000-0000-4000-8000-000000000001',
      }),
    }, 'canonical_schedule_time_zone_authority_stale');
    await expectRejected({
      key: 'm22-direct-stale-profile-version', ...validNewYork,
      timeZoneAuthority: authorityEvidence(profile, { profileVersion: 2 }),
    }, 'canonical_schedule_time_zone_authority_stale');
    await expectRejected({
      key: 'm22-direct-stale-profile-hash', ...validNewYork,
      timeZoneAuthority: authorityEvidence(profile, { profileHash: '9'.repeat(64) }),
    }, 'canonical_schedule_time_zone_authority_stale');
    await expectRejected({
      key: 'm22-direct-raw-instant-mismatch', ...validNewYork,
      approvedStart: '2027-07-01T14:00:00.000Z',
    }, 'canonical_schedule_time_instant_mismatch');

    await separatedRuntimePool.query(
      `UPDATE public.canonical_business_profiles
          SET raw_profile='{"company":{}}'::jsonb
        WHERE organization_id=$1 AND id=$2`,
      [IDS.organization, profile.id]
    );
    await expectRejected({
      key: 'm22-direct-missing-current-zone', ...validNewYork,
      timeZoneAuthority: authorityEvidence(profile),
    }, 'canonical_schedule_time_zone_authority_stale');
    await separatedRuntimePool.query(
      `UPDATE public.canonical_business_profiles
          SET raw_profile='{"company":{"timeZone":"Mars/Olympus"}}'::jsonb
        WHERE organization_id=$1 AND id=$2`,
      [IDS.organization, profile.id]
    );
    await expectRejected({
      key: 'm22-direct-invalid-current-zone', ...validNewYork,
      timeZoneAuthority: authorityEvidence(profile, { timeZone: 'Mars/Olympus' }),
    }, 'canonical_schedule_time_zone_invalid');
    await separatedRuntimePool.query(
      `UPDATE public.canonical_business_profiles
          SET raw_profile='{"company":{"timeZone":"America/New_York"}}'::jsonb
        WHERE organization_id=$1 AND id=$2`,
      [IDS.organization, profile.id]
    );

    const inactiveProfileId = 'a8000000-0000-4000-8000-000000000002';
    await separatedRuntimePool.query(
      `INSERT INTO public.canonical_business_profiles
         (id,organization_id,version_number,version_label,raw_profile,normalized_profile,
          normalized_profile_hash,is_active,created_by,retired_at)
       VALUES ($1,$2,2,'org-profile-inactive-pointer',
               '{"company":{"timeZone":"America/New_York"}}','{}',$3,FALSE,$4,NOW())`,
      [inactiveProfileId, IDS.organization, '5'.repeat(64), IDS.owner]
    );
    await separatedRuntimePool.query(
      `UPDATE public.organization_onboarding SET active_business_profile_id=$2
        WHERE organization_id=$1`,
      [IDS.organization, inactiveProfileId]
    );
    await expectRejected({
      key: 'm22-direct-inactive-pointer', ...validNewYork,
    }, 'canonical_schedule_time_zone_authority_unavailable');
    await separatedRuntimePool.query(
      `UPDATE public.organization_onboarding SET active_business_profile_id=$2
        WHERE organization_id=$1`,
      [IDS.organization, profile.id]
    );
    await separatedRuntimePool.query(
      `DELETE FROM public.canonical_business_profiles WHERE organization_id=$1 AND id=$2`,
      [IDS.organization, inactiveProfileId]
    );

    for (const mismatch of [
      { key: 'm22-direct-empty-revision-evidence', sourceSnapshot: {} },
      { key: 'm22-direct-empty-audit-evidence', details: {} },
    ]) {
      await expectRejected({ ...validNewYork, ...mismatch }, 'canonical_schedule_approval_incomplete');
    }
    await expectRejected({
      key: 'm22-direct-profile-restored-after-approval',
      rawStart: '2027-03-14T07:30:00Z',
      rawEnd: '2027-03-14T08:30:00Z',
      approvedStart: '2027-03-14T07:30:00.000Z',
      approvedEnd: '2027-03-14T08:30:00.000Z',
      status: 'scheduled',
      timeZoneAuthority: authorityEvidence(profile, { timeZone: 'UTC' }),
      beforeApproval: async client => client.query(
        `UPDATE public.canonical_business_profiles
            SET raw_profile='{"company":{"timeZone":"UTC"}}'::jsonb
          WHERE organization_id=$1 AND id=$2`,
        [IDS.organization, profile.id]
      ),
      afterApproval: async client => client.query(
        `UPDATE public.canonical_business_profiles
            SET raw_profile='{"company":{"timeZone":"America/New_York"}}'::jsonb
          WHERE organization_id=$1 AND id=$2`,
        [IDS.organization, profile.id]
      ),
    }, 'canonical_schedule_approval_incomplete');

    for (const malformed of [
      { key: 'm22-direct-rfc3339-space', rawStart: '2027-07-01 09:00:00-04:00' },
      { key: 'm22-direct-rfc3339-fraction', rawStart: '2027-07-01T09:00:00.0000-04:00' },
      { key: 'm22-direct-rfc3339-calendar', rawStart: '2027-02-30T09:00:00-05:00' },
      { key: 'm22-direct-rfc3339-offset', rawStart: '2027-07-01T09:00:00+14:30' },
      { key: 'm22-direct-rfc3339-second-60', rawStart: '2027-01-01T23:59:60-05:00',
        rawEnd: '2027-01-02T01:00:00-05:00', approvedStart: '2027-01-02T05:00:00.000Z',
        approvedEnd: '2027-01-02T06:00:00.000Z' },
      { key: 'm22-direct-rfc3339-second-60-fraction-1', rawStart: '2027-01-01T23:59:60.0-05:00',
        rawEnd: '2027-01-02T01:00:00-05:00', approvedStart: '2027-01-02T05:00:00.000Z',
        approvedEnd: '2027-01-02T06:00:00.000Z' },
      { key: 'm22-direct-rfc3339-second-60-fraction-3', rawStart: '2027-01-01T23:59:60.000-05:00',
        rawEnd: '2027-01-02T01:00:00-05:00', approvedStart: '2027-01-02T05:00:00.000Z',
        approvedEnd: '2027-01-02T06:00:00.000Z' },
      { key: 'm22-direct-rfc3339-hour-24', rawStart: '2027-01-01T24:00:00-05:00',
        rawEnd: '2027-01-02T01:00:00-05:00', approvedStart: '2027-01-02T05:00:00.000Z',
        approvedEnd: '2027-01-02T06:00:00.000Z' },
      { key: 'm22-direct-rfc3339-hour-24-fraction-3', rawStart: '2027-01-01T24:00:00.000-05:00',
        rawEnd: '2027-01-02T01:00:00-05:00', approvedStart: '2027-01-02T05:00:00.000Z',
        approvedEnd: '2027-01-02T06:00:00.000Z' },
    ]) {
      await expectRejected({ ...validNewYork, ...malformed }, 'canonical_schedule_time_rfc3339_invalid');
    }

    await expectRejected({
      key: 'm22-direct-new-york-gap',
      rawStart: '2027-03-14T02:30:00-05:00',
      rawEnd: '2027-03-14T04:30:00-04:00',
      approvedStart: '2027-03-14T07:30:00.000Z',
      approvedEnd: '2027-03-14T08:30:00.000Z',
      status: 'scheduled',
    }, 'canonical_schedule_time_zone_mismatch');
    await commitDirectScheduleMutation(separatedRuntimePool, {
      organizationId: IDS.organization,
      appointmentId: IDS.appointmentDirect,
      key: 'm22-direct-new-york-fold-first',
      rawStart: '2027-11-07T01:30:00-04:00',
      rawEnd: '2027-11-07T02:30:00-05:00',
      approvedStart: '2027-11-07T05:30:00.000Z',
      approvedEnd: '2027-11-07T07:30:00.000Z',
      status: 'scheduled',
    });
    await commitDirectScheduleMutation(separatedRuntimePool, {
      organizationId: IDS.organization,
      appointmentId: IDS.appointmentDirect,
      key: 'm22-direct-new-york-fold-second',
      rawStart: '2027-11-07T01:30:00-05:00',
      rawEnd: '2027-11-07T02:30:00-05:00',
      approvedStart: '2027-11-07T06:30:00.000Z',
      approvedEnd: '2027-11-07T07:30:00.000Z',
      status: 'scheduled',
    });
    expect(await durableState()).toMatchObject({
      revision: '3', schedule_state: 'scheduled', approvals: 2, revisions: 3,
      audits: 2, idempotency: 2,
    });

    await replaceSeparatedZone('Australia/Lord_Howe');
    await expectRejected({
      key: 'm22-direct-lord-howe-gap',
      rawStart: '2027-10-03T02:15:00+10:30',
      rawEnd: '2027-10-03T03:15:00+11:00',
      approvedStart: '2027-10-02T15:45:00.000Z',
      approvedEnd: '2027-10-02T16:15:00.000Z',
      status: 'scheduled',
    }, 'canonical_schedule_time_zone_mismatch');
    await commitDirectScheduleMutation(separatedRuntimePool, {
      organizationId: IDS.organization,
      appointmentId: IDS.appointmentDirect,
      key: 'm22-direct-lord-howe-fold-first',
      rawStart: '2027-04-04T01:45:00+11:00',
      rawEnd: '2027-04-04T02:45:00+10:30',
      approvedStart: '2027-04-03T14:45:00.000Z',
      approvedEnd: '2027-04-03T16:15:00.000Z',
      status: 'scheduled',
    });
    await commitDirectScheduleMutation(separatedRuntimePool, {
      organizationId: IDS.organization,
      appointmentId: IDS.appointmentDirect,
      key: 'm22-direct-lord-howe-fold-second',
      rawStart: '2027-04-04T01:45:00+10:30',
      rawEnd: '2027-04-04T02:45:00+10:30',
      approvedStart: '2027-04-03T15:15:00.000Z',
      approvedEnd: '2027-04-03T16:15:00.000Z',
      status: 'scheduled',
    });
    const afterFolds = await durableState();
    expect(afterFolds).toMatchObject({
      revision: '5', schedule_state: 'scheduled', approvals: 4, revisions: 5,
      audits: 4, idempotency: 4,
    });
    expect(afterFolds.scheduled_start.toISOString()).toBe('2027-04-03T15:15:00.000Z');

    await commitDirectScheduleMutation(separatedRuntimePool, {
      organizationId: IDS.organization,
      appointmentId: IDS.appointmentDirect,
      key: 'm22-direct-omitted-schedule',
      status: 'completed',
    });
    const preserved = await durableState();
    expect(preserved).toMatchObject({ revision: '6', schedule_state: 'scheduled', appointment_status: 'completed' });
    expect(preserved.scheduled_start.toISOString()).toBe('2027-04-03T15:15:00.000Z');
    expect(preserved.scheduled_end.toISOString()).toBe('2027-04-03T16:15:00.000Z');

    await commitDirectScheduleMutation(separatedRuntimePool, {
      organizationId: IDS.organization,
      appointmentId: IDS.appointmentDirect,
      key: 'm22-direct-explicit-unschedule',
      rawStart: null,
      rawEnd: null,
      approvedStart: null,
      approvedEnd: null,
      status: 'completed',
    });
    expect(await durableState()).toMatchObject({
      revision: '7', scheduled_start: null, scheduled_end: null,
      schedule_state: 'unscheduled', appointment_status: 'completed',
      approvals: 6, revisions: 7, audits: 6, idempotency: 6,
    });
    await replaceSeparatedZone('America/New_York');
  }, 60000);

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
        scheduledStart: '2027-03-14T07:30:00-04:00',
        scheduledEnd: '2027-03-14T08:30:00-04:00',
        status: 'scheduled',
        expectedRevision: Number(current.revision),
        expectedDigest: current.canonical_digest.trim(),
        expectedTimeZone: 'America/New_York',
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
        scheduledStart: `2027-03-${15 + index}T09:00:00-04:00`,
        scheduledEnd: `2027-03-${15 + index}T10:00:00-04:00`,
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

  test('current tenant zone rejects gaps and forged offsets, preserves both folds, and serializes zone changes', async () => {
    async function activeProfileVersion() {
      return String((await upgradePool.query(
        `SELECT version_label FROM public.canonical_business_profiles
          WHERE organization_id=$1 AND is_active=TRUE`,
        [IDS.organization]
      )).rows[0].version_label);
    }
    async function replaceZone(timeZone) {
      return putBusinessProfile(upgradePool, {
        organizationId: IDS.organization,
        userId: IDS.owner,
        expectedVersion: await activeProfileVersion(),
        profile: { company: timeZone ? { timeZone } : {} },
      });
    }
    async function authority() {
      return (await upgradePool.query(
        `SELECT revision, canonical_digest FROM public.canonical_schedule_assignments
          WHERE organization_id=$1 AND appointment_id=$2`,
        [IDS.organization, IDS.appointmentTime]
      )).rows[0];
    }
    function mutation(current, key, body) {
      return normalizeScheduleMutation({
        organizationId: IDS.organization,
        actorUserId: IDS.owner,
        actorAccessRole: 'owner',
        authSessionId: IDS.authSession,
        appointmentId: IDS.appointmentTime,
        explicitSession: null,
        idempotencyKey: key,
        body: {
          status: 'scheduled',
          expectedRevision: Number(current.revision),
          expectedDigest: String(current.canonical_digest || current.digest).trim(),
          expectedTimeZone: 'America/New_York',
          action: 'calendar_edit',
          reason: 'Explicit tenant-zone test approval.',
          ...body,
        },
      });
    }
    async function durableCounts() {
      return (await upgradePool.query(
        `SELECT assignment.revision,
                (SELECT count(*)::int FROM public.canonical_schedule_approvals WHERE assignment_id=assignment.id) AS approvals,
                (SELECT count(*)::int FROM public.canonical_schedule_audit_events WHERE assignment_id=assignment.id) AS audits,
                (SELECT count(*)::int FROM public.canonical_schedule_idempotency WHERE assignment_id=assignment.id) AS idempotency
           FROM public.canonical_schedule_assignments assignment
          WHERE assignment.organization_id=$1 AND assignment.appointment_id=$2`,
        [IDS.organization, IDS.appointmentTime]
      )).rows[0];
    }

    const initial = await authority();
    const initialCounts = await durableCounts();
    await expect(updateAppointmentSchedule(upgradePool, mutation(initial, 'm22-time-gap-reject-0001', {
      scheduledStart: '2027-03-14T02:30:00-05:00',
      scheduledEnd: '2027-03-14T04:30:00-04:00',
    }))).rejects.toMatchObject({ status: 400, code: 'INVALID_APPOINTMENT_SCHEDULE' });
    await expect(updateAppointmentSchedule(upgradePool, mutation(initial, 'm22-time-forged-offset-0002', {
      scheduledStart: '2027-07-01T09:00:00Z',
      scheduledEnd: '2027-07-01T10:00:00Z',
    }))).rejects.toMatchObject({ status: 400, code: 'INVALID_APPOINTMENT_SCHEDULE' });
    await expect(updateAppointmentSchedule(upgradePool, normalizeScheduleMutation({
      ...mutation(initial, 'm22-time-stale-zone-0003', {
        scheduledStart: '2027-07-01T09:00:00-04:00',
        scheduledEnd: '2027-07-01T10:00:00-04:00',
      }),
      idempotencyKey: 'm22-time-stale-zone-0003',
      body: {
        scheduledStart: '2027-07-01T09:00:00-04:00',
        scheduledEnd: '2027-07-01T10:00:00-04:00',
        status: 'scheduled', expectedRevision: Number(initial.revision),
        expectedDigest: initial.canonical_digest.trim(), expectedTimeZone: 'America/Chicago',
        action: 'calendar_edit', reason: 'Stale zone must fail.',
      },
    }))).rejects.toMatchObject({ status: 409, code: 'M22_STALE_TIME_ZONE' });
    expect(await durableCounts()).toEqual(initialCounts);

    await replaceZone(null);
    await expect(updateAppointmentSchedule(upgradePool, mutation(initial, 'm22-time-missing-zone-0004', {
      scheduledStart: '2027-07-01T09:00:00-04:00',
      scheduledEnd: '2027-07-01T10:00:00-04:00',
    }))).rejects.toMatchObject({ status: 409, code: 'M22_TIME_ZONE_AUTHORITY_REQUIRED' });
    expect(await durableCounts()).toEqual(initialCounts);
    await replaceZone('America/New_York');

    const firstFoldMutation = mutation(initial, 'm22-time-first-fold-0005', {
      scheduledStart: '2027-11-07T01:30:00-04:00',
      scheduledEnd: '2027-11-07T02:30:00-05:00',
      reason: 'Human selected the first fold occurrence.',
    });
    const firstFold = await updateAppointmentSchedule(upgradePool, firstFoldMutation);
    expect(firstFold.body.data).toMatchObject({
      scheduled_start: '2027-11-07T05:30:00.000Z',
      scheduled_end: '2027-11-07T07:30:00.000Z',
    });
    const afterFirst = firstFold.body.data.scheduleAuthority;
    const secondFoldMutation = mutation(afterFirst, 'm22-time-second-fold-0006', {
      scheduledStart: '2027-11-07T01:30:00-05:00',
      scheduledEnd: '2027-11-07T02:30:00-05:00',
      reason: 'Human selected the second fold occurrence.',
    });
    const secondFold = await updateAppointmentSchedule(upgradePool, secondFoldMutation);
    expect(secondFold.body.data).toMatchObject({
      scheduled_start: '2027-11-07T06:30:00.000Z',
      scheduled_end: '2027-11-07T07:30:00.000Z',
    });
    const evidence = (await upgradePool.query(
      `SELECT revision.source_snapshot, audit.details
         FROM public.canonical_schedule_assignments assignment
         JOIN public.canonical_schedule_assignment_revisions revision
           ON revision.assignment_id=assignment.id AND revision.revision=assignment.revision
         JOIN public.canonical_schedule_audit_events audit
           ON audit.assignment_id=assignment.id AND audit.after_revision=assignment.revision
        WHERE assignment.organization_id=$1 AND assignment.appointment_id=$2`,
      [IDS.organization, IDS.appointmentTime]
    )).rows[0];
    expect(evidence.source_snapshot).toMatchObject({
      submittedSchedule: { scheduledStart: '2027-11-07T01:30:00-05:00' },
      timeZoneAuthority: { timeZone: 'America/New_York' },
    });
    expect(evidence.details).toMatchObject({
      submittedSchedule: { scheduledStart: '2027-11-07T01:30:00-05:00' },
      timeZoneAuthority: { timeZone: 'America/New_York' },
    });

    const beforeConcurrent = secondFold.body.data.scheduleAuthority;
    const concurrentMutation = mutation(beforeConcurrent, 'm22-time-concurrent-zone-0007', {
      scheduledStart: '2027-07-01T09:00:00-04:00',
      scheduledEnd: '2027-07-01T10:00:00-04:00',
      reason: 'Serialize this approval with the current profile zone.',
    });
    let zoneChange;
    const serializingPool = {
      async connect() {
        const client = await upgradePool.connect();
        return {
          async query(...args) {
            const result = await client.query(...args);
            if (!zoneChange && /FROM public\.canonical_business_profiles[\s\S]*FOR SHARE/i.test(String(args[0]))) {
              zoneChange = replaceZone('America/Chicago');
            }
            return result;
          },
          release() { client.release(); },
        };
      },
    };
    const serialized = await updateAppointmentSchedule(serializingPool, concurrentMutation);
    expect(serialized.body.data.scheduleAuthority.revision).toBe(4);
    await zoneChange;
    expect(await updateAppointmentSchedule(upgradePool, concurrentMutation)).toMatchObject({ replayed: true });
    const staleAfterChange = mutation(serialized.body.data.scheduleAuthority, 'm22-time-after-zone-change-0008', {
      scheduledStart: '2027-07-01T10:00:00-04:00',
      scheduledEnd: '2027-07-01T11:00:00-04:00',
    });
    await expect(updateAppointmentSchedule(upgradePool, staleAfterChange))
      .rejects.toMatchObject({ status: 409, code: 'M22_STALE_TIME_ZONE' });
    await replaceZone('America/New_York');
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
        scheduledStart: '2027-04-01T09:00:00-04:00',
        scheduledEnd: '2027-04-01T10:00:00-04:00',
        status: 'scheduled',
        expectedRevision: Number(before.revision),
        expectedDigest: before.canonical_digest.trim(),
        expectedTimeZone: 'America/New_York',
        action: 'calendar_edit',
        reason: 'This transaction must roll back.',
      },
    });
    const failingPool = {
      async connect() {
        const client = await upgradePool.connect();
        return {
          query(...args) {
            if (/^\s*INSERT INTO (?:public\.)?canonical_schedule_audit_events/i.test(String(args[0]))) {
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

    const currentProfile = (await upgradePool.query(
      `SELECT profile.id, profile.version_number, profile.normalized_profile_hash,
              profile.raw_profile #>> '{company,timeZone}' AS time_zone
         FROM public.organization_onboarding onboarding
         JOIN public.canonical_business_profiles profile
           ON profile.organization_id=onboarding.organization_id
          AND profile.id=onboarding.active_business_profile_id
        WHERE onboarding.organization_id=$1`,
      [IDS.organization]
    )).rows[0];
    const submittedSchedule = {
      startProvided: false, endProvided: false, scheduledStart: null, scheduledEnd: null,
    };
    const timeZoneAuthority = {
      profileId: String(currentProfile.id),
      profileVersion: Number(currentProfile.version_number),
      profileHash: String(currentProfile.normalized_profile_hash).trim(),
      timeZone: currentProfile.time_zone,
    };
    const timeEvidenceDigest = String((await upgradePool.query(
      `SELECT public.canonical_schedule_time_evidence_digest(2::smallint,$1::jsonb,$2::jsonb) AS digest`,
      [JSON.stringify(submittedSchedule), JSON.stringify(timeZoneAuthority)]
    )).rows[0].digest).trim();

    const direct = await upgradePool.connect();
    try {
      await direct.query('BEGIN');
      await direct.query(
        `INSERT INTO canonical_schedule_approvals
           (organization_id,assignment_id,appointment_id,actor_user_id,actor_access_role,
            auth_session_id,expected_revision,expected_digest,applied_revision,applied_digest,
            request_digest,idempotency_key_hash,action_code,reason,approved_scheduled_start,
            approved_scheduled_end,approved_appointment_status,resulting_schedule_state,
            resulting_dispatch_state,resulting_needs_review,resulting_review_reasons,
            time_evidence_version,submitted_schedule,time_zone_authority,time_evidence_digest)
         VALUES ($1,$2,$3,$4,'owner',$5,$6,$7,$8,$7,$9,$10,'calendar_edit',$11,
                 $12,$13,$14,$15,'not_dispatched',$16,$17::jsonb,
                 2,$18::jsonb,$19::jsonb,$20)`,
        [IDS.organization, before.id, IDS.appointmentMutation, IDS.owner, IDS.authSession,
          Number(before.revision), before.canonical_digest.trim(), Number(before.revision) + 1,
          '3'.repeat(64), '4'.repeat(64), 'Orphan approval must not commit.',
          before.scheduled_start, before.scheduled_end, before.appointment_status,
          before.schedule_state, before.needs_review, JSON.stringify(before.review_reasons),
          JSON.stringify(submittedSchedule), JSON.stringify(timeZoneAuthority), timeEvidenceDigest]
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
          resulting_dispatch_state,resulting_needs_review,resulting_review_reasons,
          time_evidence_version,submitted_schedule,time_zone_authority,time_evidence_digest)
       VALUES ($1,$2,$3,$4,'owner',$5,$6,$7,$8,$9,$10,$11,'calendar_edit',$12,
               $13,$14,$15,$16,'dispatched',$17,$18::jsonb,
               2,$19::jsonb,$20::jsonb,$21)`,
      [IDS.organization, before.id, IDS.appointmentMutation, IDS.owner, IDS.authSession,
        Number(before.revision), before.canonical_digest.trim(), Number(before.revision) + 1,
        forgedDigest, '5'.repeat(64), '6'.repeat(64), 'Dispatch forgery.',
        before.scheduled_start, before.scheduled_end, before.appointment_status,
        before.schedule_state, before.needs_review, JSON.stringify(before.review_reasons),
        JSON.stringify(submittedSchedule), JSON.stringify(timeZoneAuthority), timeEvidenceDigest]
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
