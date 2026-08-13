'use strict';

const request = require('supertest');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');
const { provisionDurableSession } = require('../helpers/account-session-fixture');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const ORG_A = '51000000-0000-4000-8000-000000000001';
const ORG_B = '51000000-0000-4000-8000-000000000002';
const OWNER_A = '52000000-0000-4000-8000-000000000001';
const ADMIN_A = '52000000-0000-4000-8000-000000000002';
const MEMBER_A = '52000000-0000-4000-8000-000000000003';
const VIEWER_A = '52000000-0000-4000-8000-000000000004';
const OWNER_B = '52000000-0000-4000-8000-000000000005';

function cookieHeader(response) {
  return (response.headers['set-cookie'] || []).map(value => value.split(';')[0]).join('; ');
}

function hex(value) {
  return Buffer.from(value, 'utf8').toString('hex');
}

realPostgres('Mission 20 Part 2E mounted workforce PostgreSQL authority', () => {
  let suiteDatabase;
  let originalDatabaseUrl;
  let db;
  let app;
  let pool;
  let auth;
  let delivery;

  beforeAll(async () => {
    suiteDatabase = await createSuiteDatabase('m20-part2e-workforce');
    originalDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = suiteDatabase.connectionString;
    for (const name of [
      'RETELL_API_KEY', 'RETELL_AGENT_ID', 'RETELL_PHONE_NUMBER', 'RETELL_WEBHOOK_SECRET',
      'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN',
      'TWILIO_PHONE_NUMBER', 'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS',
    ]) delete process.env[name];

    jest.resetModules();
    db = require('../../src/db');
    expect(await db.initDatabase()).toBe(true);
    pool = db.getPool();
    await pool.query(
      `INSERT INTO organizations (id, name, email) VALUES
        ($1, 'Workforce Organization A', 'workforce-a@example.test'),
        ($2, 'Workforce Organization B', 'workforce-b@example.test')`,
      [ORG_A, ORG_B]
    );
    for (const [userId, organizationId, name, email, role] of [
      [OWNER_A, ORG_A, 'Owner A', 'owner-a@example.test', 'owner'],
      [ADMIN_A, ORG_A, 'Admin A', 'admin-a@example.test', 'admin'],
      [MEMBER_A, ORG_A, 'Member A', 'member-a@example.test', 'member'],
      [VIEWER_A, ORG_A, 'Viewer A', 'viewer-a@example.test', 'viewer'],
      [OWNER_B, ORG_B, 'Owner B', 'owner-b@example.test', 'owner'],
    ]) {
      await pool.query(
        `INSERT INTO users (id, organization_id, name, email, password_hash, role, status)
         VALUES ($1,$2,$3,$4,'not-used',$5,'active')`,
        [userId, organizationId, name, email, role]
      );
    }
    const { putBusinessProfile } = require('../../src/services/organizationAuthority');
    const profileA = canonicalFenceProfile({ companyName: 'Workforce A' });
    profileA.services[0].id = 'Fence';
    profileA.headquarters = {
      street: '', city: '', state: '', zip: '', country: 'US', latitude: null, longitude: null,
      additionalOffices: [{
        id: 'Office-North', name: '  North <Office> 🧰  ', street: '', city: '', state: '',
        zip: '', country: 'US', latitude: null, longitude: null,
      }],
    };
    profileA.workforce = { policies: [] };
    const profileB = canonicalFenceProfile({ companyName: 'Workforce B', serviceName: 'Other Tenant Fence' });
    profileB.headquarters = {
      street: '', city: '', state: '', zip: '', country: 'US', latitude: null, longitude: null,
      additionalOffices: [{
        id: 'office-other', name: 'Other office', street: '', city: '', state: '', zip: '', country: 'US',
        latitude: null, longitude: null,
      }],
    };
    profileB.workforce = { policies: [] };
    await putBusinessProfile(pool, { organizationId: ORG_A, userId: OWNER_A, expectedVersion: null, profile: profileA });
    await putBusinessProfile(pool, { organizationId: ORG_B, userId: OWNER_B, expectedVersion: null, profile: profileB });

    auth = new Map();
    for (const [userId, organizationId, role] of [
      [OWNER_A, ORG_A, 'owner'], [ADMIN_A, ORG_A, 'admin'], [MEMBER_A, ORG_A, 'member'],
      [VIEWER_A, ORG_A, 'viewer'], [OWNER_B, ORG_B, 'owner'],
    ]) {
      const session = await provisionDurableSession(pool, { userId, organizationId, role });
      auth.set(userId, session.headers);
    }

    ({ app } = require('../../src/server'));
    const { AccountRepository } = require('../../src/accounts/repository');
    const { TransactionalEmail } = require('../../src/email/transactional');
    const { WorkforceRepository } = require('../../src/workforce/repository');
    const { WorkforceService } = require('../../src/workforce/service');
    const canonicalDelivery = new TransactionalEmail({
      adapter: { async send() { return { accepted: true }; } },
      publicOrigin: 'https://app.example.test',
      from: 'notifications@northstar-os.ai',
      production: true,
    });
    delivery = {
      messages: [],
      async invitation(recipient, rawToken, context, invite) {
        await canonicalDelivery.invitation(recipient, rawToken, context, invite);
        this.messages.push({ recipient, rawToken, context, invite });
        return { delivered: true };
      },
    };
    app.locals.workforceService = new WorkforceService(new WorkforceRepository(pool), {
      accountRepository: new AccountRepository(pool),
      transactionalEmail: delivery,
    });
  }, 60000);

  afterAll(async () => {
    try {
      if (db && db.getPool()) await db.getPool().end();
    } finally {
      if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalDatabaseUrl;
      if (suiteDatabase) await suiteDatabase.cleanup();
    }
  });

  test('mounted role, tenant, invitation, structure, session, audit, and raw-byte contracts hold', async () => {
    for (const userId of [OWNER_A, ADMIN_A, MEMBER_A, VIEWER_A, OWNER_B]) {
      const read = await request(app).get('/api/workforce').set(auth.get(userId));
      expect(read.status).toBe(200);
      expect(read.body.data.members.every(member => member.userId !== (userId === OWNER_B ? OWNER_A : OWNER_B))).toBe(true);
      expect(read.body.data.businessProfile).toMatchObject({ id: expect.any(String), version: expect.any(String), hash: expect.any(String) });
    }

    const unauthenticated = await request(app).get('/api/workforce');
    expect(unauthenticated.status).toBe(401);
    const bearer = await request(app).get('/api/workforce').set('Authorization', 'Bearer forged');
    expect(bearer.status).toBe(401);

    const rawSkillName = '  Emergency <Skill> ☃  ';
    const rawSkillDescription = '\n  Exact é bytes <script>data-only()</script>  \n';
    const skill = await request(app).post('/api/workforce/skills').set(auth.get(ADMIN_A)).send({
      key: 'emergency-fence', name: rawSkillName, description: rawSkillDescription, serviceId: 'fence',
    });
    expect(skill.status).toBe(201);
    const skillId = skill.body.data.id;
    for (const userId of [MEMBER_A, VIEWER_A]) {
      const forbidden = await request(app).post('/api/workforce/skills').set(auth.get(userId)).send({
        key: 'forbidden-' + userId.slice(-1), name: 'Forbidden', description: '', serviceId: null,
      });
      expect(forbidden.status).toBe(403);
    }
    const otherSkill = await request(app).post('/api/workforce/skills').set(auth.get(OWNER_B)).send({
      key: 'other-tenant', name: 'Other tenant skill', description: '', serviceId: 'fence',
    });
    expect(otherSkill.status).toBe(201);

    const invalidCrossTenantService = await request(app).post('/api/workforce/skills').set(auth.get(OWNER_A)).send({
      key: 'cross-tenant', name: 'Cross tenant', description: '', serviceId: 'other-only',
    });
    expect(invalidCrossTenantService.status).toBe(400);

    const rawPersonName = '  Tech <img src=x onerror=never()> Café 🧰  ';
    const rawPhone = ' +1 (555) 010-4040 ';
    const adminInvite = await request(app).post('/api/workforce/invitations').set(auth.get(ADMIN_A)).send({
      name: rawPersonName, email: 'tech@example.test', phone: rawPhone, accessRole: 'member',
      operationalRole: 'technician', homeLocationId: 'office-north', skillIds: [skillId],
    });
    expect(adminInvite.status).toBe(403);
    const invite = await request(app).post('/api/workforce/invitations').set(auth.get(OWNER_A)).send({
      name: rawPersonName, email: 'tech@example.test', phone: rawPhone, accessRole: 'member',
      operationalRole: 'technician', homeLocationId: 'office-north', skillIds: [skillId],
    });
    expect(invite.status).toBe(202);
    expect(invite.body.data).toMatchObject({
      invitationId: expect.any(String),
      name: rawPersonName,
      email: 'tech@example.test',
      status: 'pending',
      delivery: 'accepted',
    });
    expect(delivery.messages).toHaveLength(1);
    const firstToken = delivery.messages[0].rawToken;

    const pendingAuthority = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM users WHERE email_normalized = 'tech@example.test') AS users,
         (SELECT count(*)::int FROM organization_memberships membership
           JOIN users account ON account.id = membership.user_id
          WHERE account.email_normalized = 'tech@example.test') AS memberships,
         (SELECT count(*)::int FROM workforce_profiles profile
           JOIN organization_memberships membership ON membership.id = profile.membership_id
           JOIN users account ON account.id = membership.user_id
          WHERE account.email_normalized = 'tech@example.test') AS profiles,
         (SELECT count(*)::int FROM workforce_invitations
          WHERE organization_id = $1 AND id = $2 AND status = 'pending') AS invitations`,
      [ORG_A, invite.body.data.invitationId]
    );
    expect(pendingAuthority.rows[0]).toEqual({ users: 0, memberships: 0, profiles: 0, invitations: 1 });
    const ownerPendingSnapshot = await request(app).get('/api/workforce').set(auth.get(OWNER_A));
    expect(ownerPendingSnapshot.body.data.invitations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        invitationId: invite.body.data.invitationId,
        name: rawPersonName,
        homeLocationId: 'Office-North',
        skillIds: [skillId],
        status: 'pending',
      }),
    ]));
    for (const userId of [ADMIN_A, MEMBER_A, VIEWER_A]) {
      expect((await request(app).get('/api/workforce').set(auth.get(userId))).body.data.invitations).toEqual([]);
    }

    const beforeAccept = await request(app).post('/api/auth/login').send({
      email: 'tech@example.test', password: 'Private-workforce-password-1!',
    });
    expect(beforeAccept.status).toBe(401);

    const resend = await request(app)
      .post('/api/workforce/invitations/' + invite.body.data.invitationId + '/resend')
      .set(auth.get(OWNER_A)).send({});
    expect(resend.status).toBe(202);
    expect(delivery.messages).toHaveLength(2);
    const activeToken = delivery.messages[1].rawToken;
    expect(activeToken).not.toBe(firstToken);
    expect((await request(app).post('/api/workforce/invitations/accept').send({
      token: firstToken, password: 'Private-workforce-password-1!',
    })).status).toBe(400);
    const accepted = await request(app).post('/api/workforce/invitations/accept').send({
      token: activeToken, password: 'Private-workforce-password-1!',
    });
    expect(accepted.status).toBe(200);
    expect((await request(app).post('/api/workforce/invitations/accept').send({
      token: activeToken, password: 'Private-workforce-password-1!',
    })).status).toBe(400);

    const login = await request(app).post('/api/auth/login').send({
      email: 'tech@example.test', password: 'Private-workforce-password-1!',
    });
    expect(login.status).toBe(200);
    expect(login.body.account).toMatchObject({
      user: { name: rawPersonName, email: 'tech@example.test', status: 'active' },
      membership: { role: 'member', status: 'active' },
    });
    const acceptedCookies = cookieHeader(login);
    expect(acceptedCookies).toContain('northstar_access=');

    const ownerSnapshot = await request(app).get('/api/workforce').set(auth.get(OWNER_A));
    const ownerProfile = ownerSnapshot.body.data.members.find(member => member.userId === OWNER_A);
    const adminProfile = ownerSnapshot.body.data.members.find(member => member.userId === ADMIN_A);
    const invitedProfile = ownerSnapshot.body.data.members.find(member => member.membershipId === accepted.body.data.membershipId);
    expect(invitedProfile).toMatchObject({
      profileId: accepted.body.data.membershipId,
      name: rawPersonName,
      phone: rawPhone,
      operationalRole: 'technician',
      homeLocationId: 'Office-North',
      skillIds: [skillId],
    });
    expect((await pool.query(
      `SELECT profile.created_by_user_id, relation.created_by_user_id AS skill_created_by_user_id
         FROM workforce_profiles profile
         JOIN workforce_profile_skills relation
           ON relation.organization_id = profile.organization_id AND relation.profile_id = profile.id
        WHERE profile.organization_id = $1 AND profile.id = $2 AND relation.skill_id = $3`,
      [ORG_A, invitedProfile.profileId, skillId]
    )).rows).toEqual([{
      created_by_user_id: OWNER_A,
      skill_created_by_user_id: OWNER_A,
    }]);
    expect(ownerSnapshot.body.data.invitations.some(item => item.invitationId === invite.body.data.invitationId)).toBe(false);
    expect(ownerSnapshot.body.data.skills.find(item => item.id === skillId).serviceId).toBe('Fence');

    const crossTenantProfile = await request(app)
      .put('/api/workforce/profiles/' + invitedProfile.profileId)
      .set(auth.get(ADMIN_A)).send({
        operationalRole: 'technician', homeLocationId: 'office-other', skillIds: [skillId],
      });
    expect(crossTenantProfile.status).toBe(400);
    const crossTenantSkill = await request(app)
      .put('/api/workforce/profiles/' + invitedProfile.profileId)
      .set(auth.get(ADMIN_A)).send({
        operationalRole: 'technician', homeLocationId: 'office-north', skillIds: [otherSkill.body.data.id],
      });
    expect(crossTenantSkill.status).toBe(400);

    const rawCrewName = '  North <Crew> é 🧰  ';
    const crew = await request(app).post('/api/workforce/crews').set(auth.get(OWNER_A)).send({
      key: 'crew-north', name: rawCrewName, homeLocationId: 'office-north',
      members: [
        { profileId: adminProfile.profileId, role: 'lead' },
        { profileId: invitedProfile.profileId, role: 'member' },
      ],
    });
    expect(crew.status).toBe(201);
    const canonicalReferenceSnapshot = await request(app).get('/api/workforce').set(auth.get(OWNER_A));
    expect(canonicalReferenceSnapshot.body.data.crews.find(item => item.id === crew.body.data.id).homeLocationId)
      .toBe('Office-North');
    const twoLeads = await request(app).put('/api/workforce/crews/' + crew.body.data.id).set(auth.get(ADMIN_A)).send({
      name: rawCrewName, homeLocationId: 'office-north',
      members: [
        { profileId: ownerProfile.profileId, role: 'lead' },
        { profileId: adminProfile.profileId, role: 'lead' },
      ],
    });
    expect(twoLeads.status).toBe(400);

    const rawPolicyName = '  Safety <Policy> ☃  ';
    const rawPolicyDescription = '\n  Preserve <b>data</b> é exactly.  \n';
    const policy = await request(app).put('/api/v1/business-profile/workforce').set(auth.get(OWNER_A)).send({
      expectedVersion: canonicalReferenceSnapshot.body.data.businessProfile.version,
      value: {
        policies: [{ id: 'safety-v1', name: rawPolicyName, description: rawPolicyDescription, enabled: true }],
      },
    });
    expect(policy.status).toBe(200);
    expect(policy.body.data.workforce.policies[0]).toEqual({
      id: 'safety-v1', name: rawPolicyName, description: rawPolicyDescription, enabled: true,
    });
    expect((await request(app).put('/api/v1/business-profile/workforce').set(auth.get(VIEWER_A)).send({ policies: [] })).status)
      .toBe(403);

    const stored = await pool.query(
      `SELECT
         encode(convert_to(account.name, 'UTF8'), 'hex') AS person_name_hex,
         encode(convert_to(account.phone, 'UTF8'), 'hex') AS phone_hex,
         encode(convert_to(skill.name, 'UTF8'), 'hex') AS skill_name_hex,
         encode(convert_to(skill.description, 'UTF8'), 'hex') AS skill_description_hex,
         skill.service_id,
         encode(convert_to(crew.name, 'UTF8'), 'hex') AS crew_name_hex,
         workforce.home_location_id AS member_home_location_id,
         crew.home_location_id AS crew_home_location_id,
         encode(convert_to(profile.raw_profile #>> '{workforce,policies,0,name}', 'UTF8'), 'hex') AS policy_name_hex,
         encode(convert_to(profile.raw_profile #>> '{workforce,policies,0,description}', 'UTF8'), 'hex') AS policy_description_hex
       FROM users account
       JOIN workforce_profiles workforce ON workforce.organization_id = account.organization_id AND workforce.membership_id = $2
       JOIN workforce_skills skill ON skill.organization_id = account.organization_id AND skill.id = $3
       JOIN workforce_crews crew ON crew.organization_id = account.organization_id AND crew.id = $4
       JOIN canonical_business_profiles profile ON profile.organization_id = account.organization_id AND profile.is_active = TRUE
       WHERE account.id = $1`,
      [invitedProfile.userId, invitedProfile.membershipId, skillId, crew.body.data.id]
    );
    expect(stored.rows).toEqual([{
      person_name_hex: hex(rawPersonName),
      phone_hex: hex(rawPhone),
      skill_name_hex: hex(rawSkillName),
      skill_description_hex: hex(rawSkillDescription),
      service_id: 'Fence',
      crew_name_hex: hex(rawCrewName),
      member_home_location_id: 'Office-North',
      crew_home_location_id: 'Office-North',
      policy_name_hex: hex(rawPolicyName),
      policy_description_hex: hex(rawPolicyDescription),
    }]);

    const sessionBeforeSuspend = await pool.query(
      `SELECT count(*)::int AS sessions,
              (SELECT count(*)::int FROM auth_refresh_tokens token
                JOIN auth_sessions session ON session.id = token.session_id
               WHERE session.user_id = $1 AND token.status = 'active') AS refresh_tokens
         FROM auth_sessions WHERE user_id = $1 AND status = 'active'`,
      [invitedProfile.userId]
    );
    expect(sessionBeforeSuspend.rows[0].sessions).toBeGreaterThan(0);
    expect(sessionBeforeSuspend.rows[0].refresh_tokens).toBeGreaterThan(0);
    const unchangedAccess = await request(app)
      .patch('/api/workforce/members/' + invitedProfile.membershipId + '/access')
      .set(auth.get(OWNER_A)).send({ accessRole: 'member', membershipStatus: 'active' });
    expect(unchangedAccess.status).toBe(200);
    expect(unchangedAccess.body.data.changed).toBe(false);
    expect((await pool.query(
      `SELECT count(*)::int AS sessions FROM auth_sessions WHERE user_id = $1 AND status = 'active'`,
      [invitedProfile.userId]
    )).rows[0].sessions).toBe(sessionBeforeSuspend.rows[0].sessions);
    const suspended = await request(app)
      .patch('/api/workforce/members/' + invitedProfile.membershipId + '/access')
      .set(auth.get(OWNER_A)).send({ accessRole: 'member', membershipStatus: 'suspended' });
    expect(suspended.status).toBe(200);
    expect((await request(app).get('/api/workforce').set('Cookie', acceptedCookies)).status).toBe(401);
    const afterSuspend = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM auth_sessions WHERE user_id = $1 AND status = 'active') AS sessions,
         (SELECT count(*)::int FROM auth_refresh_tokens token
            JOIN auth_sessions session ON session.id = token.session_id
           WHERE session.user_id = $1 AND token.status = 'active') AS refresh_tokens`,
      [invitedProfile.userId]
    );
    expect(afterSuspend.rows[0]).toEqual({ sessions: 0, refresh_tokens: 0 });

    const audit = await pool.query(
      `SELECT action, actor_user_id, subject_id FROM workforce_audit_events
        WHERE organization_id = $1 ORDER BY created_at, id`,
      [ORG_A]
    );
    expect(audit.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'skill_created', actor_user_id: ADMIN_A, subject_id: skillId }),
      expect.objectContaining({ action: 'invitation_created', actor_user_id: OWNER_A, subject_id: invite.body.data.invitationId }),
      expect.objectContaining({ action: 'invitation_resent', actor_user_id: OWNER_A, subject_id: invite.body.data.invitationId }),
      expect.objectContaining({ action: 'invitation_accepted', actor_user_id: invitedProfile.userId, subject_id: invite.body.data.invitationId }),
      expect.objectContaining({ action: 'crew_created', actor_user_id: OWNER_A, subject_id: crew.body.data.id }),
      expect.objectContaining({ action: 'member_access_updated', actor_user_id: OWNER_A, subject_id: invitedProfile.membershipId }),
    ]));

    const otherTenant = await request(app).get('/api/workforce').set(auth.get(OWNER_B));
    expect(otherTenant.body.data.members.some(member => member.userId === invitedProfile.userId)).toBe(false);
    expect(otherTenant.body.data.skills.some(item => item.id === skillId)).toBe(false);
    expect(otherTenant.body.data.crews.some(item => item.id === crew.body.data.id)).toBe(false);
    expect(delivery.messages).toHaveLength(2);
  }, 60000);

  test('canonical invitation envelopes and ambiguous Business Profile references fail closed before durable drift', async () => {
    const startingDeliveryCount = delivery.messages.length;
    const rawBoundaryName = 'Line One\nLine Two ' + '\u{1F9F0}'.repeat(81);
    const boundaryInvite = await request(app).post('/api/workforce/invitations').set(auth.get(OWNER_A)).send({
      name: rawBoundaryName, email: 'boundary@example.test', phone: '', accessRole: 'viewer',
      operationalRole: 'employee', homeLocationId: 'office-north', skillIds: [],
    });
    expect(boundaryInvite.status).toBe(202);
    expect(delivery.messages).toHaveLength(startingDeliveryCount + 1);
    const storedBoundary = await pool.query(
      `SELECT encode(convert_to(invitation.name, 'UTF8'), 'hex') AS name_hex,
              invitation.home_location_id,
              (SELECT count(*)::int FROM users WHERE email_normalized = 'boundary@example.test') AS users,
              (SELECT count(*)::int FROM organization_memberships membership
                JOIN users account ON account.id = membership.user_id
               WHERE account.email_normalized = 'boundary@example.test') AS memberships,
              (SELECT count(*)::int FROM workforce_profiles profile
                JOIN organization_memberships membership ON membership.id = profile.membership_id
                JOIN users account ON account.id = membership.user_id
               WHERE account.email_normalized = 'boundary@example.test') AS profiles
         FROM workforce_invitations invitation
        WHERE invitation.organization_id = $1 AND invitation.id = $2`,
      [ORG_A, boundaryInvite.body.data.invitationId]
    );
    expect(storedBoundary.rows).toEqual([{
      name_hex: hex(rawBoundaryName),
      home_location_id: 'Office-North',
      users: 0,
      memberships: 0,
      profiles: 0,
    }]);
    const boundaryResend = await request(app)
      .post('/api/workforce/invitations/' + boundaryInvite.body.data.invitationId + '/resend')
      .set(auth.get(OWNER_A)).send({});
    expect(boundaryResend.status).toBe(202);
    expect(delivery.messages).toHaveLength(startingDeliveryCount + 2);

    await pool.query('UPDATE organizations SET name = $2 WHERE id = $1', [ORG_A, 'O'.repeat(143)]);
    try {
      const incompatibleOrganization = await request(app).post('/api/workforce/invitations').set(auth.get(OWNER_A)).send({
        name: 'No durable drift', email: 'no-drift@example.test', phone: '', accessRole: 'member',
        operationalRole: 'employee', homeLocationId: null, skillIds: [],
      });
      expect(incompatibleOrganization.status).toBe(409);
      expect(incompatibleOrganization.body.error.code).toBe('invitation_delivery_incompatible');
      expect((await pool.query(
        `SELECT count(*)::int AS count FROM workforce_invitations
          WHERE organization_id = $1 AND email_normalized = 'no-drift@example.test'`,
        [ORG_A]
      )).rows[0].count).toBe(0);
    } finally {
      await pool.query("UPDATE organizations SET name = 'Workforce Organization A' WHERE id = $1", [ORG_A]);
    }

    const beforeInvalid = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM users WHERE organization_id = $1) AS users,
         (SELECT count(*)::int FROM organization_memberships WHERE organization_id = $1) AS memberships,
         (SELECT count(*)::int FROM workforce_invitations WHERE organization_id = $1) AS invitations`,
      [ORG_A]
    );
    const invalidRecipient = await request(app).post('/api/workforce/invitations').set(auth.get(OWNER_A)).send({
      name: 'Unicode recipient', email: 'worker@例子.test', phone: '', accessRole: 'member',
      operationalRole: 'employee', homeLocationId: null, skillIds: [],
    });
    expect(invalidRecipient.status).toBe(400);
    expect(invalidRecipient.body.error.code).toBe('invalid_workforce_invitation');
    const afterInvalid = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM users WHERE organization_id = $1) AS users,
         (SELECT count(*)::int FROM organization_memberships WHERE organization_id = $1) AS memberships,
         (SELECT count(*)::int FROM workforce_invitations WHERE organization_id = $1) AS invitations`,
      [ORG_A]
    );
    expect(afterInvalid.rows).toEqual(beforeInvalid.rows);
    expect(delivery.messages).toHaveLength(startingDeliveryCount + 2);

    const activeProfile = await pool.query(
      `SELECT id, raw_profile FROM canonical_business_profiles
        WHERE organization_id = $1 AND is_active = TRUE`,
      [ORG_A]
    );
    const rawProfile = activeProfile.rows[0].raw_profile;
    const ambiguousProfile = JSON.parse(JSON.stringify(rawProfile));
    ambiguousProfile.headquarters.additionalOffices.push({
      ...ambiguousProfile.headquarters.additionalOffices[0],
      id: 'office-north',
      name: 'Ambiguous case variant',
    });
    await pool.query(
      `UPDATE canonical_business_profiles SET raw_profile = $3::jsonb
        WHERE organization_id = $1 AND id = $2`,
      [ORG_A, activeProfile.rows[0].id, JSON.stringify(ambiguousProfile)]
    );
    try {
      const ambiguousCrew = await request(app).post('/api/workforce/crews').set(auth.get(OWNER_A)).send({
        key: 'ambiguous-office', name: 'Ambiguous office', homeLocationId: 'OFFICE-NORTH', members: [],
      });
      expect(ambiguousCrew.status).toBe(409);
      expect(ambiguousCrew.body.error.code).toBe('ambiguous_workforce_location');
      expect((await pool.query(
        `SELECT count(*)::int AS count FROM workforce_crews
          WHERE organization_id = $1 AND crew_key = 'ambiguous-office'`,
        [ORG_A]
      )).rows[0].count).toBe(0);
    } finally {
      await pool.query(
        `UPDATE canonical_business_profiles SET raw_profile = $3::jsonb
          WHERE organization_id = $1 AND id = $2`,
        [ORG_A, activeProfile.rows[0].id, JSON.stringify(rawProfile)]
      );
    }
  }, 60000);

  test('cross-tenant account existence is hidden behind uniform pending invitation authority', async () => {
    const startingDeliveryCount = delivery.messages.length;
    const crossTenantInvite = await request(app).post('/api/workforce/invitations').set(auth.get(OWNER_A)).send({
      name: 'Cross-tenant recipient', email: 'owner-b@example.test', phone: '', accessRole: 'member',
      operationalRole: 'employee', homeLocationId: null, skillIds: [],
    });
    expect(crossTenantInvite.status).toBe(202);
    expect(crossTenantInvite.body.data).toMatchObject({
      invitationId: expect.any(String), status: 'pending', delivery: 'accepted',
    });
    expect(delivery.messages).toHaveLength(startingDeliveryCount + 1);
    const invitationId = crossTenantInvite.body.data.invitationId;
    const beforeAcceptance = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM users WHERE email_normalized = 'owner-b@example.test') AS global_users,
         (SELECT count(*)::int FROM users
           WHERE organization_id = $1 AND email_normalized = 'owner-b@example.test') AS tenant_users,
         (SELECT count(*)::int FROM organization_memberships membership
           JOIN users account ON account.id = membership.user_id
          WHERE membership.organization_id = $1 AND account.email_normalized = 'owner-b@example.test') AS memberships,
         (SELECT count(*)::int FROM workforce_profiles profile
           JOIN organization_memberships membership ON membership.id = profile.membership_id
           JOIN users account ON account.id = membership.user_id
          WHERE profile.organization_id = $1 AND account.email_normalized = 'owner-b@example.test') AS profiles,
         (SELECT count(*)::int FROM workforce_invitations
          WHERE organization_id = $1 AND id = $2 AND status = 'pending') AS invitations`,
      [ORG_A, invitationId]
    );
    expect(beforeAcceptance.rows[0]).toEqual({
      global_users: 1, tenant_users: 0, memberships: 0, profiles: 0, invitations: 1,
    });
    const ownerView = await request(app).get('/api/workforce').set(auth.get(OWNER_A));
    expect(ownerView.body.data.invitations).toEqual(expect.arrayContaining([
      expect.objectContaining({ invitationId, email: 'owner-b@example.test', status: 'pending' }),
    ]));
    expect((await request(app).get('/api/workforce').set(auth.get(VIEWER_A))).body.data.invitations).toEqual([]);

    const unavailableAcceptance = await request(app).post('/api/workforce/invitations/accept').send({
      token: delivery.messages[startingDeliveryCount].rawToken,
      password: 'Private-cross-tenant-password-1!',
    });
    expect(unavailableAcceptance.status).toBe(400);
    expect(unavailableAcceptance.body.error.code).toBe('invitation_invalid');
    expect((await pool.query(
      `SELECT status, accepted_membership_id FROM workforce_invitations
        WHERE organization_id = $1 AND id = $2`,
      [ORG_A, invitationId]
    )).rows).toEqual([{ status: 'pending', accepted_membership_id: null }]);

    const resend = await request(app)
      .post('/api/workforce/invitations/' + invitationId + '/resend')
      .set(auth.get(OWNER_A)).send({});
    expect(resend.status).toBe(202);
    expect(delivery.messages).toHaveLength(startingDeliveryCount + 2);
    const revoke = await request(app)
      .post('/api/workforce/invitations/' + invitationId + '/revoke')
      .set(auth.get(OWNER_A)).send({});
    expect(revoke.status).toBe(200);
    expect((await request(app).get('/api/workforce').set(auth.get(OWNER_A))).body.data.invitations
      .some(item => item.invitationId === invitationId)).toBe(false);
    expect((await pool.query(
      `SELECT
         (SELECT count(*)::int FROM users
           WHERE organization_id = $1 AND email_normalized = 'owner-b@example.test') AS users,
         (SELECT count(*)::int FROM organization_memberships membership
           JOIN users account ON account.id = membership.user_id
          WHERE membership.organization_id = $1 AND account.email_normalized = 'owner-b@example.test') AS memberships,
         (SELECT count(*)::int FROM workforce_profiles profile
           JOIN organization_memberships membership ON membership.id = profile.membership_id
           JOIN users account ON account.id = membership.user_id
          WHERE profile.organization_id = $1 AND account.email_normalized = 'owner-b@example.test') AS profiles`,
      [ORG_A]
    )).rows[0]).toEqual({ users: 0, memberships: 0, profiles: 0 });
  }, 60000);

  test('future memberships receive stable workforce profiles while unsupported mission state is absent', async () => {
    const futureUser = '52000000-0000-4000-8000-000000000099';
    const futureMembership = '53000000-0000-4000-8000-000000000099';
    await pool.query(
      `INSERT INTO users (id, organization_id, name, email, password_hash, role, status)
       VALUES ($1,$2,'Future Member','future-member@example.test','not-used','member','active')`,
      [futureUser, ORG_A]
    );
    await pool.query(
      `INSERT INTO organization_memberships (id, organization_id, user_id, role, status)
       VALUES ($1,$2,$3,'member','active')`,
      [futureMembership, ORG_A, futureUser]
    );
    const profile = await pool.query(
      `SELECT id, membership_id, operational_role, created_by_user_id, updated_by_user_id
         FROM workforce_profiles WHERE organization_id = $1 AND membership_id = $2`,
      [ORG_A, futureMembership]
    );
    expect(profile.rows).toEqual([{
      id: futureMembership,
      membership_id: futureMembership,
      operational_role: 'employee',
      created_by_user_id: null,
      updated_by_user_id: null,
    }]);
    const unsupported = await pool.query(
      `SELECT to_regclass('public.workforce_assignments') AS assignments,
              to_regclass('public.workforce_schedules') AS schedules,
              to_regclass('public.workforce_time_entries') AS time_entries,
              to_regclass('public.workforce_assets') AS assets`
    );
    expect(unsupported.rows[0]).toEqual({ assignments: null, schedules: null, time_entries: null, assets: null });
  });
});
