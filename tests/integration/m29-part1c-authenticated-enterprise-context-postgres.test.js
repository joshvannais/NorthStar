'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const { Client, Pool } = require('pg');
const request = require('supertest');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { provisionDurableSession } = require('../helpers/account-session-fixture');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');

const actualPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const quote = value => '"' + String(value).replace(/"/g, '""') + '"';
function roleUrl(connectionString, role) {
  const url = new URL(connectionString); url.username = role; url.password = ''; return url.toString();
}

actualPostgres('Mission 29 Part 1C actual PostgreSQL and mounted browser-session context', () => {
  let database, ownerPool, db, roles, app, a, b, secondSession;
  const borrowed = new Map();
  const keys = ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'RETELL_API_KEY', 'STRIPE_SECRET_KEY',
    'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS',
    'OPENAI_API_KEY', 'JOBBER_CLIENT_ID', 'JOBBER_CLIENT_SECRET'];
  const endpoint = '/api/enterprise/context';
  const selection = context => ({ contract: context.contract, binding: context.binding, location: context.locations[0].reference });
  const get = actor => request(app).get(endpoint).set(actor.session.headers);
  const resolve = (actor, input) => request(app).post(endpoint + '/resolve').set(actor.session.headers).send(input);
  let putBusinessProfile;

  async function fixture(label, offices) {
    const organizationId = crypto.randomUUID(), userId = crypto.randomUUID();
    const profile = canonicalFenceProfile({ companyName: label });
    if (offices) profile.headquarters = { additionalOffices: offices };
    await ownerPool.query('INSERT INTO public.organizations(id,name,email) VALUES($1,$2,$3)', [organizationId, label, label + '@example.test']);
    await ownerPool.query(`INSERT INTO public.users(id,organization_id,name,email,password_hash,role,status)
      VALUES($1,$2,$3,$4,'local-fixture-only','owner','active')`, [userId, organizationId, label, label + '@example.test']);
    await putBusinessProfile(ownerPool, { organizationId, userId, expectedVersion: null, profile });
    const session = await provisionDurableSession(ownerPool, { organizationId, userId, role: 'owner' });
    return { organizationId, userId, profile, session };
  }

  beforeAll(async () => {
    for (const key of keys) borrowed.set(key, { present: Object.hasOwn(process.env, key), value: process.env[key] });
    for (const key of keys.slice(2)) delete process.env[key];
    database = await createSuiteDatabase('m29-part1c-context');
    const suffix = process.pid + '_' + crypto.randomBytes(3).toString('hex');
    roles = { owner: 'm29p1c_owner_' + suffix, runtime: 'm29p1c_runtime_' + suffix };
    const admin = new Client({ connectionString: process.env.M19_PG_ADMIN_URL }); await admin.connect();
    try {
      for (const role of Object.values(roles)) await admin.query('CREATE ROLE ' + quote(role) + ' LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS');
      await admin.query('ALTER DATABASE ' + quote(database.databaseName) + ' OWNER TO ' + quote(roles.owner));
    } finally { await admin.end(); }
    process.env.DATABASE_URL = roleUrl(database.connectionString, roles.runtime);
    process.env.MIGRATION_DATABASE_URL = roleUrl(database.connectionString, roles.owner);
    db = require('../../src/db');
    expect(await db.initDatabase()).toBe(true);
    ownerPool = new Pool({ connectionString: roleUrl(database.connectionString, roles.owner), max: 3 });
    putBusinessProfile = require('../../src/services/organizationAuthority').putBusinessProfile;
    const { createEnterpriseContextRouter } = require('../../src/routes/enterpriseContext');
    app = express(); app.use(express.json({ limit: '32kb' }));
    app.use(endpoint, createEnterpriseContextRouter());
    app.use('/api/auth', require('../../src/routes/auth').createAuthRouter());
  }, 240000);

  beforeEach(async () => {
    const suffix = crypto.randomBytes(4).toString('hex');
    a = await fixture('m29-context-a-' + suffix, [{ id: 'Office.East', name: 'East office' }]);
    b = await fixture('m29-context-b-' + suffix);
    secondSession = await provisionDurableSession(ownerPool, { organizationId: a.organizationId, userId: a.userId, role: 'owner' });
  });

  afterAll(async () => {
    if (db) await db.close();
    if (ownerPool) await ownerPool.end();
    if (database) await database.cleanup();
    if (roles) {
      const admin = new Client({ connectionString: process.env.M19_PG_ADMIN_URL }); await admin.connect();
      try { for (const role of Object.values(roles)) await admin.query('DROP ROLE IF EXISTS ' + quote(role)); }
      finally { await admin.end(); }
    }
    for (const [key, prior] of borrowed) { if (prior.present) process.env[key] = prior.value; else delete process.env[key]; }
  }, 180000);

  test('uses all 285 exact migrations through 289 with a separate non-owner runtime role', async () => {
    const history = (await ownerPool.query('SELECT filename,checksum FROM public._migrations ORDER BY filename')).rows;
    const source = db.loadMigrations(path.resolve(__dirname, '../../migrations'));
    expect(history).toHaveLength(285);
    expect(history.map(item => item.filename)).toEqual(source.map(item => item.file));
    expect(history.map(item => item.checksum)).toEqual(source.map(item => item.digest));
    expect(history.at(-1).filename).toBe('289_automation_center_runtime_read_authority_v1.sql');
    const identity = (await db.getPool().query(`SELECT current_user AS role, rolsuper, rolbypassrls
      FROM pg_roles WHERE rolname=current_user`)).rows[0];
    expect(identity).toEqual({ role: roles.runtime, rolsuper: false, rolbypassrls: false });
    expect(identity.role).not.toBe(roles.owner);
  });

  test('mounts current cookie-authenticated discovery and explicit selection with no implicit scope', async () => {
    const found = await get(a); expect(found.status).toBe(200);
    expect(found.headers['cache-control']).toBe('no-store');
    expect(found.headers.vary).toContain('Cookie');
    const context = found.body.data;
    expect(context.company.organizationId).toBe(a.organizationId);
    expect(context.actor.id).toBe(a.userId);
    expect(context.selectedLocation).toBeNull();
    expect(context.locations.map(item => item.reference.locationKey)).toEqual(['headquarters', 'Office.East']);
    const selected = await resolve(a, selection(context));
    expect(selected.status).toBe(200);
    expect(selected.body.data.selectedLocation.reference.locationKey).toBe('headquarters');
    expect((await get(a)).body.data.selectedLocation).toBeNull();
    expect(JSON.stringify(found.body)).not.toContain(b.organizationId);
    expect(JSON.stringify(found.body)).not.toContain(a.session.sessionId);
  });

  test('keeps established single-location account and auth/me behavior without a context write', async () => {
    const context = (await get(b)).body.data;
    expect(context.locations).toHaveLength(1);
    expect((await resolve(b, selection(context))).status).toBe(200);
    const me = await request(app).get('/api/auth/me').set(b.session.headers);
    expect(me.status).toBe(200);
    expect((await ownerPool.query('SELECT count(*)::int AS n FROM public.auth_sessions WHERE user_id=$1', [b.userId])).rows[0].n).toBe(1);
  });

  test('rejects absent cookies, user Bearer tokens, forged actor/session pairing and missing CSRF', async () => {
    expect((await request(app).get(endpoint)).status).toBe(401);
    expect((await request(app).get(endpoint).set('Authorization', 'Bearer ' + a.session.accessToken)).status).toBe(401);
    const credentials = require('../../src/auth/credentials');
    const forged = credentials.signAccess(b.userId, a.session.sessionId);
    expect((await request(app).get(endpoint).set('Cookie', credentials.ACCESS_COOKIE + '=' + forged)).status).toBe(401);
    const context = (await get(a)).body.data;
    expect((await request(app).post(endpoint + '/resolve').set('Cookie', a.session.headers.Cookie).send(selection(context))).status).toBe(403);
  });

  test('denies omitted, null, extra, unknown and foreign selection without leaking foreign metadata', async () => {
    const context = (await get(a)).body.data, foreign = (await get(b)).body.data;
    for (const input of [{}, { ...selection(context), location: null }, { ...selection(context), organizationId: b.organizationId }]) {
      const result = await resolve(a, input); expect(result.status).toBeGreaterThanOrEqual(400);
      expect(result.headers['cache-control']).toBe('no-store');
      expect(JSON.stringify(result.body)).not.toContain(b.organizationId);
    }
    for (const ref of [foreign.locations[0].reference, { ...context.locations[0].reference, locationKey: 'unknown' }, { ...context.locations[0].reference, kind: 'location_identity' }]) {
      const result = await resolve(a, { ...selection(context), location: ref });
      expect(result.status).toBe(409);
      expect(JSON.stringify(result.body)).not.toContain(b.organizationId);
    }
    expect((await request(app).get(endpoint + '?organizationId=' + b.organizationId).set(a.session.headers)).status).toBe(400);
    expect((await resolve(a, selection(context))).status).toBe(200);
  });

  test('isolates simultaneous sessions without storing a shared active-location preference', async () => {
    const other = { ...a, session: secondSession };
    const [first, second] = await Promise.all([get(a), get(other)]);
    expect(first.body.data.binding).not.toBe(second.body.data.binding);
    expect((await resolve(other, selection(first.body.data))).status).toBe(409);
    const east = { ...selection(second.body.data), location: second.body.data.locations[1].reference };
    const [one, two] = await Promise.all([resolve(a, selection(first.body.data)), resolve(other, east)]);
    expect(one.body.data.selectedLocation.reference.locationKey).toBe('headquarters');
    expect(two.body.data.selectedLocation.reference.locationKey).toBe('Office.East');
    expect((await get(a)).body.data.selectedLocation).toBeNull();
    expect((await get(other)).body.data.selectedLocation).toBeNull();
  });

  test('rejects stale Business Profile pins and bindings after a real canonical profile version transition', async () => {
    const before = (await get(a)).body.data;
    const next = { ...a.profile, headquarters: { additionalOffices: [{ id: 'Office.West', name: 'West office' }] } };
    await putBusinessProfile(ownerPool, { organizationId: a.organizationId, userId: a.userId, expectedVersion: before.source.profilePin.version, profile: next });
    expect((await resolve(a, selection(before))).status).toBe(409);
    const current = (await get(a)).body.data;
    expect(current.source.profilePin.version).not.toBe(before.source.profilePin.version);
    expect((await resolve(a, { ...selection(current), location: before.locations[1].reference })).status).toBe(409);
    expect((await resolve(a, selection(current))).status).toBe(200);
    a.profile = next;
  });

  test('reloads membership revocation and role changes, including stale-version rejection after reactivation', async () => {
    const before = (await get(b)).body.data;
    await ownerPool.query("UPDATE public.organization_memberships SET status='revoked',revoked_at=clock_timestamp(),updated_at=clock_timestamp() WHERE user_id=$1", [b.userId]);
    expect((await get(b)).status).toBe(403);
    await ownerPool.query("UPDATE public.organization_memberships SET status='active',revoked_at=NULL,updated_at=clock_timestamp(),role='viewer' WHERE user_id=$1", [b.userId]);
    const current = await get(b); expect(current.status).toBe(200); expect(current.body.data.actor.role).toBe('viewer');
    expect((await resolve(b, selection(before))).status).toBe(409);
    expect((await resolve(b, selection(current.body.data))).status).toBe(200);
  });

  test('reloads revocation committed after cookie middleware and before the context repository read', async () => {
    const { requireSession } = require('../../src/auth/middleware');
    const { createEnterpriseContextRouter } = require('../../src/routes/enterpriseContext');
    const race = express(); race.use(express.json());
    race.use(endpoint, requireSession, async (_req, _res, next) => {
      await ownerPool.query("UPDATE public.organization_memberships SET status='suspended',updated_at=clock_timestamp() WHERE user_id=$1", [a.userId]);
      next();
    }, createEnterpriseContextRouter());
    try {
      const result = await request(race).get(endpoint).set(a.session.headers);
      expect(result.status).toBe(403);
      expect(result.body.error.code).toBe('enterprise_membership_required');
    } finally {
      await ownerPool.query("UPDATE public.organization_memberships SET status='active',updated_at=clock_timestamp() WHERE user_id=$1", [a.userId]);
    }
    expect((await get(a)).status).toBe(200);
  });

  test('observes current expiry and session revocation instead of accepting a cached binding', async () => {
    const previous = (await get(a)).body.data;
    await ownerPool.query("UPDATE public.auth_sessions SET access_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [a.session.sessionId]);
    expect((await resolve(a, selection(previous))).status).toBe(401);
    await ownerPool.query("UPDATE public.auth_sessions SET access_expires_at=clock_timestamp()+interval '10 minutes',status='revoked',revoked_at=clock_timestamp(),revoke_reason='fixture' WHERE id=$1", [a.session.sessionId]);
    expect((await get(a)).status).toBe(401);
    expect((await get({ ...a, session: secondSession })).status).toBe(200);
  });

  test('reloads through a new repository/connection and leaves protected tables and old constraints intact', async () => {
    const { EnterpriseContextRepository } = require('../../src/enterprise/contextRepository');
    const fresh = new Pool({ connectionString: roleUrl(database.connectionString, roles.runtime), max: 1 });
    try {
      const repository = new EnterpriseContextRepository(fresh);
      const principal = { actorUserId: a.userId, sessionId: secondSession.sessionId, organizationId: a.organizationId };
      const context = await repository.read(principal);
      expect((await repository.read(principal, selection(context))).company.organizationId).toBe(a.organizationId);
      await expect(repository.read({ ...principal, organizationId: b.organizationId })).rejects.toMatchObject({ code: 'enterprise_membership_required' });
      expect((await repository.read(principal)).binding).toBe(context.binding);
    } finally { await fresh.end(); }
    expect((await ownerPool.query("SELECT count(*)::int AS n FROM pg_constraint WHERE conname='organization_memberships_user_unique'")).rows[0].n).toBe(1);
    expect((await ownerPool.query("SELECT count(*)::int AS n FROM public._migrations WHERE filename LIKE '290_%'")).rows[0].n).toBe(0);
  });

  test('returns a private unavailable response on a real disconnected context pool and recovers on the current pool', async () => {
    const { EnterpriseContextRepository } = require('../../src/enterprise/contextRepository');
    const { createEnterpriseContextRouter } = require('../../src/routes/enterpriseContext');
    const closed = new Pool({ connectionString: roleUrl(database.connectionString, roles.runtime) }); await closed.end();
    const unavailable = express(); unavailable.use(express.json());
    unavailable.use(endpoint, createEnterpriseContextRouter({ repository: new EnterpriseContextRepository(closed) }));
    const actor = { ...a, session: secondSession };
    const result = await request(unavailable).get(endpoint).set(actor.session.headers);
    expect(result.status).toBe(503);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(result.body)).not.toMatch(/SELECT|pool|postgres|m29p1c_runtime/);
    expect((await get(actor)).status).toBe(200);
  });

  test('mounts the same context path through the canonical server composition without outbound effects', async () => {
    const previousFetch = global.fetch; let outbound = 0;
    global.fetch = async () => { outbound++; throw new Error('External transport is not allowed in this local context test'); };
    try {
      const canonical = require('../../src/server').app;
      const result = await request(canonical).get(endpoint).set(secondSession.headers).set('Origin', 'https://northstarsolutions.app');
      expect(result.status).toBe(200);
      expect(result.body.data.company.organizationId).toBe(a.organizationId);
      expect(result.headers['access-control-allow-origin']).toBe('https://northstarsolutions.app');
      expect(result.headers.vary.split(',').map(value => value.trim()).sort()).toEqual(['Cookie', 'Origin']);
      expect(result.headers['cache-control']).toBe('no-store');
      expect((await request(canonical).get(endpoint)).status).toBe(401);
      expect(outbound).toBe(0);
    } finally { global.fetch = previousFetch; }
  });
});
