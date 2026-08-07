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
    profileA.headquarters = {
      street: '', city: '', state: '', zip: '', country: 'US', latitude: null, longitude: null,
      additionalOffices: [{
        id: 'office-north', name: '  North <Office> 🧰  ', street: '', city: '', state: '',
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
    await putBusinessProfile(pool, { organizationId: ORG_A, userId: OWNER_A, profile: profileA });
    await putBusinessProfile(pool, { organizationId: ORG_B, userId: OWNER_B, profile: profileB });

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
    const { WorkforceRepository } = require('../../src/workforce/repository');
    const { WorkforceService } = require('../../src/workforce/service');
    delivery = {
      messages: [],
      async invitation(recipient, rawToken, context, invite) {
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
      profileId: invite.body.data.membershipId,
      name: rawPersonName,
      email: 'tech@example.test',
      delivery: 'accepted',
    });
    expect(delivery.messages).toHaveLength(1);
    const firstToken = delivery.messages[0].rawToken;

    const beforeAccept = await request(app).post('/api/auth/login').send({
      email: 'tech@example.test', password: 'Private-workforce-password-1!',
    });
    expect(beforeAccept.status).toBe(401);

    const resend = await request(app)
      .post('/api/workforce/members/' + invite.body.data.membershipId + '/resend-invitation')
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
    const invitedProfile = ownerSnapshot.body.data.members.find(member => member.membershipId === invite.body.data.membershipId);
    expect(invitedProfile).toMatchObject({
      profileId: invite.body.data.membershipId,
      name: rawPersonName,
      phone: rawPhone,
      operationalRole: 'technician',
      homeLocationId: 'office-north',
      skillIds: [skillId],
    });

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
      policies: [{ id: 'safety-v1', name: rawPolicyName, description: rawPolicyDescription, enabled: true }],
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
         encode(convert_to(crew.name, 'UTF8'), 'hex') AS crew_name_hex,
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
      crew_name_hex: hex(rawCrewName),
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
    const invalidInvitationTransition = await request(app)
      .patch('/api/workforce/members/' + invitedProfile.membershipId + '/access')
      .set(auth.get(OWNER_A)).send({ accessRole: 'member', membershipStatus: 'invited' });
    expect(invalidInvitationTransition.status).toBe(409);
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
      expect.objectContaining({ action: 'member_invited', actor_user_id: OWNER_A, subject_id: invitedProfile.membershipId }),
      expect.objectContaining({ action: 'invitation_resent', actor_user_id: OWNER_A, subject_id: invitedProfile.membershipId }),
      expect.objectContaining({ action: 'invitation_accepted', actor_user_id: invitedProfile.userId, subject_id: invitedProfile.membershipId }),
      expect.objectContaining({ action: 'crew_created', actor_user_id: OWNER_A, subject_id: crew.body.data.id }),
      expect.objectContaining({ action: 'member_access_updated', actor_user_id: OWNER_A, subject_id: invitedProfile.membershipId }),
    ]));

    const otherTenant = await request(app).get('/api/workforce').set(auth.get(OWNER_B));
    expect(otherTenant.body.data.members.some(member => member.userId === invitedProfile.userId)).toBe(false);
    expect(otherTenant.body.data.skills.some(item => item.id === skillId)).toBe(false);
    expect(otherTenant.body.data.crews.some(item => item.id === crew.body.data.id)).toBe(false);
    expect(delivery.messages).toHaveLength(2);
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
