'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { Client, Pool } = require('pg');
const request = require('supertest');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { provisionDurableSession } = require('../helpers/account-session-fixture');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');
const { CONTRACT } = require('../../src/enterprise/locationContract');

const actualPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const quote = value => '"' + value.replace(/"/g, '""') + '"';
const roleUrl = (connectionString, role) => { const url = new URL(connectionString); url.username = role; url.password = ''; return url.toString(); };
const EMPTY = Object.freeze({ id: null, revision: 0, digest: null });
const clone = value => JSON.parse(JSON.stringify(value));
const ROOT = path.resolve(__dirname, '../..');
const ENDPOINT = '/api/enterprise/locations';
const TABLE = 'public.canonical_enterprise_location_revisions_v1';

actualPostgres('Mission 29 Part 1D actual lifecycle/history, SQL authority and mounted HTTP', () => {
  let database, roles, owner, db, app, a, b;
  const borrowed = new Map();
  const environment = ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'RETELL_API_KEY', 'STRIPE_SECRET_KEY',
    'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS',
    'OPENAI_API_KEY', 'JOBBER_CLIENT_ID', 'JOBBER_CLIENT_SECRET'];
  const temporary = [];
  const getContext = actor => request(app).get('/api/enterprise/context').set(actor.session.headers);
  const principal = actor => ({ organizationId: actor.organizationId, actorUserId: actor.userId,
    actorAccessRole: actor.role || 'owner', authSessionId: actor.session.sessionId, csrfToken: actor.session.csrfToken });

  async function fixture(label, target = owner) {
    const organizationId = crypto.randomUUID(), userId = crypto.randomUUID();
    await target.query('INSERT INTO public.organizations(id,name,email) VALUES($1,$2,$3)', [organizationId, label, label + '@example.test']);
    await target.query(`INSERT INTO public.users(id,organization_id,name,email,password_hash,role,status)
      VALUES($1,$2,$3,$4,'local-only','owner','active')`, [userId, organizationId, label, label + '@example.test']);
    const profile = canonicalFenceProfile({ companyName: label });
    profile.headquarters = { additionalOffices: [{ id: 'Office.Legacy', name: 'Unadopted legacy office' }] };
    await require('../../src/services/organizationAuthority').putBusinessProfile(target, { organizationId, userId, expectedVersion: null, profile });
    const session = await provisionDurableSession(target, { organizationId, userId, role: 'owner' });
    return { organizationId, userId, session, profile };
  }
  async function draft(actor, action, locationId, expected, change, reason = 'Explicit local administration review') {
    const context = await getContext(actor); expect(context.status).toBe(200);
    return { contract: CONTRACT, action, locationId, expected, change, reason, profilePin: context.body.data.source.profilePin };
  }
  async function prepare(actor, body) {
    const response = await request(app).post(ENDPOINT + '/preview').set(actor.session.headers).send(body);
    expect(response.status).toBe(200);
    expect(response.body.data.review.confirmed).toBe(false);
    return { ...body, review: { ...response.body.data.review, confirmed: true } };
  }
  const commit = (actor, body, key = crypto.randomUUID()) => request(app).post(ENDPOINT + '/commit')
    .set(actor.session.headers).set('Idempotency-Key', key).send(body);
  async function apply(actor, action, locationId, expected, change) {
    const body = await prepare(actor, await draft(actor, action, locationId, expected, change));
    const response = await commit(actor, body); expect(response.status).toBe(201); return response.body.data.receipt;
  }
  const create = (actor, name = 'Explicit new site') => apply(actor, 'create', crypto.randomUUID(), EMPTY, { name, address: null });
  async function rows(actor, target = owner) {
    const client = await target.connect();
    try {
      await client.query('BEGIN'); await client.query("SELECT set_config('northstar.enterprise_company_id',$1,true)", [actor.organizationId]);
      return (await client.query(`SELECT to_jsonb(r) AS document FROM ${TABLE} r WHERE organization_id=$1 ORDER BY location_id,revision`, [actor.organizationId])).rows.map(row => row.document);
    } finally { await client.query('ROLLBACK'); client.release(); }
  }
  async function waitForLock(observer, role, queryPrefix) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const waiting = (await observer.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1 AND usename=$2 AND wait_event_type='Lock' AND query LIKE $3", [database.databaseName, role, queryPrefix + '%'])).rows[0].n;
      if (waiting > 0) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Expected actual blocked transaction was not observed');
  }
  const canonicalSelection = choice => ({ contract: 'northstar.enterprise.canonical-location-context.v1', binding: choice.binding,
    location: { reference: choice.reference, pin: choice.pin } });
  const resolveCanonical = (actor, choice) => request(app).post('/api/enterprise/context/resolve-canonical').set(actor.session.headers).send(canonicalSelection(choice));

  beforeAll(async () => {
    for (const key of environment) borrowed.set(key, { present: Object.hasOwn(process.env, key), value: process.env[key] });
    for (const key of environment.slice(2)) delete process.env[key];
    database = await createSuiteDatabase('m29-part1d-lifecycle');
    const suffix = process.pid + '_' + crypto.randomBytes(3).toString('hex');
    roles = { owner: 'm29p1d_owner_' + suffix, runtime: 'm29p1d_runtime_' + suffix };
    const admin = new Client({ connectionString: process.env.M19_PG_ADMIN_URL }); await admin.connect();
    try {
      for (const role of Object.values(roles)) await admin.query('CREATE ROLE ' + quote(role) + ' LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS');
      await admin.query('ALTER DATABASE ' + quote(database.databaseName) + ' OWNER TO ' + quote(roles.owner));
    } finally { await admin.end(); }
    process.env.DATABASE_URL = roleUrl(database.connectionString, roles.runtime);
    process.env.MIGRATION_DATABASE_URL = roleUrl(database.connectionString, roles.owner);
    db = require('../../src/db'); expect(await db.initDatabase()).toBe(true);
    owner = new Pool({ connectionString: roleUrl(database.connectionString, roles.owner), max: 4 });
    app = express(); app.use(require('../../src/enterprise/locationHttpBoundary').locationBodyBoundary); app.use(express.json());
    app.use(ENDPOINT, require('../../src/routes/enterpriseLocations').createEnterpriseLocationsRouter());
    app.use('/api/enterprise/context', require('../../src/routes/enterpriseContext').createEnterpriseContextRouter());
  }, 240000);
  beforeEach(async () => {
    const suffix = crypto.randomBytes(4).toString('hex');
    a = await fixture('m29p1d-a-' + suffix); b = await fixture('m29p1d-b-' + suffix);
  });
  afterAll(async () => {
    if (db) await db.close(); if (owner) await owner.end(); if (database) await database.cleanup();
    if (roles) {
      const admin = new Client({ connectionString: process.env.M19_PG_ADMIN_URL }); await admin.connect();
      try { for (const role of Object.values(roles)) await admin.query('DROP ROLE IF EXISTS ' + quote(role)); } finally { await admin.end(); }
    }
    for (const directory of temporary) if (path.dirname(directory) === os.tmpdir() && path.basename(directory).startsWith('m29-part1d-')) fs.rmSync(directory, { recursive: true, force: true });
    for (const [key, prior] of borrowed) { if (prior.present) process.env[key] = prior.value; else delete process.env[key]; }
  }, 180000);

  test('fresh startup binds all 286 source names/checksums through 290 and leaves every old office unadopted', async () => {
    const history = (await owner.query('SELECT filename,checksum FROM public._migrations ORDER BY filename')).rows;
    const source = db.loadMigrations(path.join(ROOT, 'migrations'));
    expect(history).toHaveLength(286);
    expect(history.map(row => [row.filename, row.checksum])).toEqual(source.map(row => [row.file, row.digest]));
    expect(history.at(-1).filename).toBe('290_enterprise_location_lifecycle_v1.sql');
    const context = await getContext(a);
    expect(context.body.data.locations.map(choice => choice.reference.locationKey)).toEqual(['headquarters', 'Office.Legacy']);
    expect(context.body.data.canonicalContext.locations).toEqual([]);
    expect(await rows(a)).toEqual([]);
    const role = (await db.getPool().query('SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
    expect(role).toEqual({ name: roles.runtime, rolsuper: false, rolbypassrls: false });
  });

  test('creation is explicitly reviewed, starts inactive and allocates no legacy mapping', async () => {
    const locationId = crypto.randomUUID(), core = await draft(a, 'create', locationId, EMPTY, { name: 'A new site', address: null });
    const preview = await request(app).post(ENDPOINT + '/preview').set(a.session.headers).send(core);
    expect(preview.status).toBe(200); expect(preview.body.data.plan.state).toBe('inactive');
    expect(await rows(a)).toHaveLength(0);
    expect((await commit(a, { ...core, review: preview.body.data.review })).status).toBe(400);
    const confirmed = { ...core, review: { ...preview.body.data.review, confirmed: true } };
    const result = await commit(a, confirmed); expect(result.status).toBe(201);
    expect(result.body.data.receipt).toMatchObject({ locationId, action: 'create', state: 'inactive', name: 'A new site', address: null });
    expect(result.body.data.receipt.pin.revision).toBe(1); expect(await rows(a)).toHaveLength(1);
    const context = (await getContext(a)).body.data;
    expect(context.canonicalContext.locations).toEqual([]);
    expect(context.locations.every(choice => choice.reference.kind === 'legacy_location_reference')).toBe(true);
  });

  test('activation, rename, relocation, correction and deactivation append immutable exact revisions', async () => {
    const first = await create(a), activated = await apply(a, 'activate', first.locationId, first.pin, {});
    const initialRows = await rows(a);
    const context = (await getContext(a)).body.data, choice = context.canonicalContext.locations[0];
    expect(choice.reference.kind).toBe('location_identity'); expect(choice.reference.id).toBe(first.locationId);
    expect((await resolveCanonical(a, choice)).status).toBe(200);
    const renamed = await apply(a, 'rename', first.locationId, activated.pin, { name: 'Reviewed new name' });
    expect((await resolveCanonical(a, choice)).status).toBe(409);
    const moved = await apply(a, 'relocate', first.locationId, renamed.pin, { address: 'Declared new address' });
    const corrected = await apply(a, 'correct', first.locationId, moved.pin, { name: 'Corrected label', address: null, correctedRevision: renamed.pin });
    expect(corrected.correctedRevisionId).toBe(renamed.pin.id);
    const deactivated = await apply(a, 'deactivate', first.locationId, corrected.pin, {});
    expect(deactivated.state).toBe('inactive'); expect((await getContext(a)).body.data.canonicalContext.locations).toEqual([]);
    const records = await rows(a); expect(records).toHaveLength(6); expect(records.slice(0, 2)).toEqual(initialRows);
    const history = await request(app).get(ENDPOINT + '/' + first.locationId + '/history').set(a.session.headers);
    expect(history.status).toBe(200); expect(history.body.data.history.map(row => row.pin.revision)).toEqual([6, 5, 4, 3, 2, 1]);
    expect(history.body.data.history[0].previous.digest).toBe(corrected.pin.digest);
    expect((await getContext(a)).body.data.locations.map(item => item.reference.locationKey)).toEqual(['headquarters', 'Office.Legacy']);
  });

  test('same-key retries/concurrent requests replay one receipt; changed payload or stale CAS never appends twice', async () => {
    const locationId = crypto.randomUUID(), body = await prepare(a, await draft(a, 'create', locationId, EMPTY, { name: 'One identity', address: null }));
    const key = crypto.randomUUID(), results = await Promise.all([commit(a, body, key), commit(a, body, key)]);
    expect(results.map(result => result.status).sort()).toEqual([200, 201]);
    expect(results[0].body.data.receipt.pin.id).toBe(results[1].body.data.receipt.pin.id);
    expect(await rows(a)).toHaveLength(1);
    expect((await commit(a, { ...body, reason: 'A different request' }, key)).status).toBe(409);
    const current = results[0].body.data.receipt;
    const next = await prepare(a, await draft(a, 'rename', locationId, current.pin, { name: 'A single next head' }));
    const raced = await Promise.all([commit(a, next), commit(a, next)]);
    expect(raced.map(result => result.status).sort()).toEqual([201, 409]); expect(await rows(a)).toHaveLength(2);
  });

  test('a reviewed transfer pins an active same-company target, is terminal and preserves old owned records', async () => {
    const source = await create(a, 'Source'), target = await create(a, 'Target');
    const targetActive = await apply(a, 'activate', target.locationId, target.pin, {});
    const customerId = crypto.randomUUID(), invoiceId = crypto.randomUUID(), jobId = crypto.randomUUID();
    await owner.query('INSERT INTO public.crm_contacts(id,organization_id,name,address) VALUES($1,$2,$3,$4)', [customerId, a.organizationId, 'Fictional historical customer', 'Office.Legacy']);
    await owner.query('INSERT INTO public.invoices(id,organization_id,amount,status) VALUES($1,$2,1.23,$3)', [invoiceId, a.organizationId, 'paid']);
    await owner.query('INSERT INTO public.jobs(id,queue,job_type,payload,status) VALUES($1,$2,$3,$4::jsonb,$5)', [jobId, 'stopped-fixture', 'fictional-history', { organizationId: a.organizationId, locationKey: 'Office.Legacy', customerId }, 'completed']);
    await owner.query('UPDATE public.workforce_profiles SET home_location_id=$1 WHERE organization_id=$2', ['Office.Legacy', a.organizationId]);
    async function historical() {
      return {
        customer: (await owner.query('SELECT to_jsonb(r) AS row FROM public.crm_contacts r WHERE id=$1', [customerId])).rows[0].row,
        invoice: (await owner.query('SELECT to_jsonb(r) AS row FROM public.invoices r WHERE id=$1', [invoiceId])).rows[0].row,
        job: (await owner.query('SELECT to_jsonb(r) AS row FROM public.jobs r WHERE id=$1', [jobId])).rows[0].row,
        profile: (await owner.query('SELECT raw_profile,normalized_profile_hash FROM public.canonical_business_profiles WHERE organization_id=$1 AND is_active=TRUE', [a.organizationId])).rows[0],
        home: (await owner.query('SELECT home_location_id FROM public.workforce_profiles WHERE organization_id=$1', [a.organizationId])).rows[0],
      };
    }
    const before = await historical(), oldTarget = (await rows(a)).filter(row => row.location_id === target.locationId);
    const transferred = await apply(a, 'transfer', source.locationId, source.pin, { target: { locationId: target.locationId, pin: targetActive.pin } });
    expect(transferred.state).toBe('transferred'); expect(transferred.transferTarget.id).toBe(targetActive.pin.id);
    expect(await historical()).toEqual(before); expect((await rows(a)).filter(row => row.location_id === target.locationId)).toEqual(oldTarget);
    for (const [action, change] of [['activate', {}], ['deactivate', {}], ['rename', { name: 'Cannot reopen by naming' }],
      ['correct', { name: 'Cannot reopen by correction', address: null, correctedRevision: source.pin }], ['relocate', { address: 'Cannot move' }],
      ['transfer', { target: { locationId: target.locationId, pin: targetActive.pin } }]]) {
      const candidate = await draft(a, action, source.locationId, transferred.pin, change);
      expect((await request(app).post(ENDPOINT + '/preview').set(a.session.headers).send(candidate)).status).toBe(400);
    }
    expect((await rows(a)).filter(row => row.location_id === source.locationId)).toHaveLength(2);
    expect((await request(app).get(ENDPOINT + '/' + source.locationId + '/history').set(a.session.headers)).body.data.history).toHaveLength(2);
  });

  test('target changes, foreign references and same-ID company scopes cannot broaden or silently redirect a transfer', async () => {
    const sharedId = crypto.randomUUID();
    const first = await apply(a, 'create', sharedId, EMPTY, { name: 'Scoped A', address: null });
    const foreign = await apply(b, 'create', sharedId, EMPTY, { name: 'Scoped B', address: null });
    expect(first.locationId).toBe(foreign.locationId); expect(first.pin.id).not.toBe(foreign.pin.id);
    const target = await create(a, 'Local target'), active = await apply(a, 'activate', target.locationId, target.pin, {});
    const prepared = await prepare(a, await draft(a, 'transfer', sharedId, first.pin, { target: { locationId: active.locationId, pin: active.pin } }));
    await apply(a, 'rename', target.locationId, active.pin, { name: 'Target changed after review' });
    expect((await commit(a, prepared)).status).toBe(409);
    const before = await rows(a), beforeOther = await rows(b);
    const wrong = await draft(a, 'rename', sharedId, foreign.pin, { name: 'Wrong-company revision' });
    const denied = await request(app).post(ENDPOINT + '/preview').set(a.session.headers).send(wrong);
    expect(denied.status).toBe(409); expect(JSON.stringify(denied.body)).not.toContain(b.organizationId);
    expect(await rows(a)).toEqual(before); expect(await rows(b)).toEqual(beforeOther);
  });

  test('actor/session, role, subscription, CSRF and source-profile revocation invalidate a reviewed write without losing readable history', async () => {
    const first = await create(a), core = await draft(a, 'rename', first.locationId, first.pin, { name: 'Reviewed name' });
    const prepared = await prepare(a, core), before = await rows(a);
    await owner.query("UPDATE public.subscriptions SET status='past_due' WHERE organization_id=$1", [a.organizationId]);
    expect((await commit(a, prepared)).status).toBe(403);
    expect((await request(app).get(ENDPOINT + '/' + first.locationId + '/history').set(a.session.headers)).status).toBe(200);
    await owner.query("UPDATE public.subscriptions SET status='active' WHERE organization_id=$1", [a.organizationId]);
    await owner.query("UPDATE public.organization_memberships SET updated_at=updated_at+interval '1 microsecond' WHERE user_id=$1", [a.userId]);
    expect((await commit(a, prepared)).status).toBe(409); expect(await rows(a)).toEqual(before);
    const fresh = await prepare(a, core);
    await require('../../src/services/organizationAuthority').putBusinessProfile(owner, { organizationId: a.organizationId, userId: a.userId,
      expectedVersion: core.profilePin.version, profile: { ...a.profile, company: { ...a.profile.company, name: 'New profile source' } } });
    expect((await commit(a, fresh)).status).toBe(409); expect(await rows(a)).toEqual(before);
    const credentials = require('../../src/auth/credentials');
    const mismatched = credentials.signAccess(b.userId, a.session.sessionId);
    expect((await request(app).post(ENDPOINT + '/commit').set('Cookie', credentials.ACCESS_COOKIE + '=' + mismatched).send(prepared)).status).toBe(401);
    expect((await request(app).post(ENDPOINT + '/commit').set('Cookie', a.session.headers.Cookie).set('Idempotency-Key', crypto.randomUUID()).send(prepared)).status).toBe(403);
    await owner.query("UPDATE public.organization_memberships SET role='viewer',updated_at=clock_timestamp() WHERE user_id=$1", [a.userId]);
    expect((await commit(a, prepared)).status).toBe(403);
    expect((await getContext(a)).status).toBe(200);
    expect((await request(app).get(ENDPOINT).set(a.session.headers)).status).toBe(403);
    expect(await rows(a)).toEqual(before);
  });

  test('revocation committed while a real write waits on membership locks denies the write after bounded retry', async () => {
    const body = await prepare(a, await draft(a, 'create', crypto.randomUUID(), EMPTY, { name: 'Revocation race', address: null }));
    const control = await owner.connect(), observer = new Client({ connectionString: process.env.M19_PG_ADMIN_URL }); let pending;
    try {
      await observer.connect();
      await control.query('BEGIN');
      await control.query("UPDATE public.organization_memberships SET status='revoked',revoked_at=clock_timestamp(),updated_at=clock_timestamp() WHERE user_id=$1", [a.userId]);
      pending = commit(a, body).then(result => result);
      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const waiting = (await observer.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1 AND usename=$2 AND wait_event_type='Lock' AND query LIKE 'SELECT public.canonical_enterprise_location_v1_commit(%'", [database.databaseName, roles.runtime])).rows[0].n;
        if (waiting > 0) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true); await control.query('COMMIT');
      expect((await pending).status).toBe(403); expect(await rows(a)).toEqual([]);
    } finally {
      await control.query('ROLLBACK'); control.release();
      if (pending) await pending;
      await observer.end();
    }
  });

  test('a target append committed behind the company fence invalidates the waiting transfer snapshot', async () => {
    const source = await create(a, 'Source'), targetCreated = await create(a, 'Target');
    const target = await apply(a, 'activate', targetCreated.locationId, targetCreated.pin, {});
    const transfer = await prepare(a, await draft(a, 'transfer', source.locationId, source.pin, { target: { locationId: target.locationId, pin: target.pin } }));
    const deactivate = await prepare(a, await draft(a, 'deactivate', target.locationId, target.pin, {}));
    const control = await owner.connect(), observer = new Client({ connectionString: process.env.M19_PG_ADMIN_URL }); let pending;
    try {
      await observer.connect(); await control.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await control.query("SELECT pg_advisory_xact_lock(hashtextextended('northstar.enterprise.location:'||$1::TEXT,0))", [a.organizationId]);
      pending = commit(a, transfer).then(result => result);
      await waitForLock(observer, roles.runtime, 'SELECT public.canonical_enterprise_location_v1_commit(');
      const result = (await control.query('SELECT public.canonical_enterprise_location_v1_commit($1,$2,$3,$4,$5,$6,$7::jsonb) result',
        [a.organizationId, a.userId, 'owner', a.session.sessionId, a.session.csrfToken, crypto.randomUUID(), deactivate])).rows[0].result;
      expect(result.receipt.state).toBe('inactive'); await control.query('COMMIT');
      expect((await pending).status).toBe(409);
      const history = await rows(a);
      expect(history.filter(row => row.location_id === source.locationId)).toHaveLength(1);
      expect(history.filter(row => row.location_id === target.locationId).at(-1).state).toBe('inactive');
      expect(history.map(row => row.organization_revision).sort((x, y) => x - y)).toEqual([1, 2, 3, 4]);
    } finally {
      await control.query('ROLLBACK'); control.release(); if (pending) await pending; await observer.end();
    }
  });

  test('a profile replacement queued before the waiting mutation forces a fresh source review', async () => {
    const body = await prepare(a, await draft(a, 'create', crypto.randomUUID(), EMPTY, { name: 'Profile race', address: null }));
    const control = await owner.connect(), observer = new Client({ connectionString: process.env.M19_PG_ADMIN_URL }); let pending, replacement;
    try {
      await observer.connect(); await control.query('BEGIN');
      await control.query('SELECT id FROM public.organizations WHERE id=$1 FOR UPDATE', [a.organizationId]);
      replacement = require('../../src/services/organizationAuthority').putBusinessProfile(owner, {
        organizationId: a.organizationId, userId: a.userId, expectedVersion: body.profilePin.version,
        profile: { ...a.profile, company: { ...a.profile.company, name: 'Queued replacement profile' } },
      });
      await waitForLock(observer, roles.owner, 'SELECT id FROM organizations WHERE id = $1 FOR UPDATE');
      pending = commit(a, body).then(result => result);
      await waitForLock(observer, roles.runtime, 'SELECT public.canonical_enterprise_location_v1_commit(');
      await control.query('COMMIT'); await replacement;
      expect((await pending).status).toBe(409); expect(await rows(a)).toEqual([]);
      const fresh = await getContext(a); expect(fresh.body.data.source.profilePin).not.toEqual(body.profilePin);
    } finally {
      await control.query('ROLLBACK'); control.release();
      if (replacement) await replacement; if (pending) await pending; await observer.end();
    }
  });

  test('FORCE RLS, private entry points and immutable storage withstand direct runtime SQL and spoofed tenant settings', async () => {
    const first = await create(a), runtime = db.getPool(), client = await runtime.connect();
    try {
      await client.query("SELECT set_config('northstar.enterprise_company_id',$1,false)", [b.organizationId]);
      await expect(client.query('SELECT * FROM ' + TABLE)).rejects.toMatchObject({ code: '42501' });
      await expect(client.query('SELECT public.canonical_enterprise_location_v1_digest($1::jsonb)', [{}])).rejects.toMatchObject({ code: '42501' });
      await expect(client.query('SELECT public.canonical_enterprise_location_v1_authority($1,$2,$3,$4,$5,$6)',
        [a.organizationId, a.userId, 'owner', a.session.sessionId, null, false])).rejects.toMatchObject({ code: '42501' });
      const own = (await client.query('SELECT public.canonical_enterprise_location_v1_read($1,$2,$3,$4,$5,$6,$7) result',
        [a.organizationId, a.userId, 'owner', a.session.sessionId, null, 'catalogue', null])).rows[0].result;
      expect(own.locations.map(row => row.locationId)).toEqual([first.locationId]);
      await expect(client.query('SELECT public.canonical_enterprise_location_v1_read($1,$2,$3,$4,$5,$6,$7)',
        [b.organizationId, a.userId, 'owner', a.session.sessionId, null, 'catalogue', null])).rejects.toMatchObject({ code: '42501' });
      await expect(client.query('SELECT public.canonical_enterprise_location_v1_commit($1,$2,$3,$4,$5,$6,$7::jsonb)',
        [a.organizationId, a.userId, 'owner', a.session.sessionId, a.session.csrfToken, crypto.randomUUID(), {}])).rejects.toMatchObject({ code: '42501' });
    } finally { await client.query("SELECT set_config('northstar.enterprise_company_id','',false)"); client.release(); }
    const before = await rows(a);
    for (const sql of [`UPDATE ${TABLE} SET name='Tampered'`, `DELETE FROM ${TABLE}`, `TRUNCATE ${TABLE}`]) await expect(owner.query(sql)).rejects.toMatchObject({ code: '42501' });
    expect(await rows(a)).toEqual(before);
  });

  test('the bounded raw parser owns all case/trailing-slash write aliases and rejects ambiguous bytes without a write', async () => {
    const core = await draft(a, 'create', crypto.randomUUID(), EMPTY, { name: 'Raw boundary', address: null });
    for (const path of [ENDPOINT + '/preview', '/API/ENTERPRISE/LOCATIONS/PREVIEW/']) {
      const result = await request(app).post(path).set(a.session.headers).set('Content-Type', 'application/json').send(JSON.stringify(core));
      expect(result.status).toBe(200);
    }
    for (const path of [ENDPOINT + '/commit', '/API/ENTERPRISE/LOCATIONS/COMMIT/']) {
      const ambiguous = '{"contract":"one","contract":"two","foreign":"' + b.organizationId + '"}';
      const result = await request(app).post(path).set(a.session.headers).set('Content-Type', 'application/json').send(ambiguous);
      expect(result.status).toBe(400); expect(result.headers['cache-control']).toBe('no-store');
      expect(JSON.stringify(result.body)).not.toContain(b.organizationId);
    }
    expect((await request(app).post(ENDPOINT + '/commit').set(a.session.headers).set('Content-Type', 'text/plain').send('unparsed')).status).toBe(415);
    expect((await request(app).post(ENDPOINT + '/commit').set(a.session.headers).set('Content-Type', 'application/json').send(' '.repeat(32769))).status).toBe(413);
    expect(await rows(a)).toEqual([]);
    const confirmed = await prepare(a, core);
    expect((await request(app).post('/API/ENTERPRISE/LOCATIONS/COMMIT/').set(a.session.headers).set('Idempotency-Key', crypto.randomUUID()).send(confirmed)).status).toBe(201);
  });

  test('a canonical choice is session/current-revision bound and reactivation cannot revive a stale pin', async () => {
    const second = await provisionDurableSession(owner, { organizationId: a.organizationId, userId: a.userId, role: 'owner' });
    const other = { ...a, session: second }, first = await create(a), active = await apply(a, 'activate', first.locationId, first.pin, {});
    const choice = (await getContext(a)).body.data.canonicalContext.locations[0];
    expect((await resolveCanonical(other, choice)).status).toBe(409);
    const ownChoice = (await getContext(other)).body.data.canonicalContext.locations[0];
    expect((await resolveCanonical(other, ownChoice)).status).toBe(200);
    const inactive = await apply(a, 'deactivate', first.locationId, active.pin, {});
    expect((await resolveCanonical(a, choice)).status).toBe(409);
    await apply(a, 'activate', first.locationId, inactive.pin, {});
    expect((await resolveCanonical(a, choice)).status).toBe(409);
    expect((await resolveCanonical(a, (await getContext(a)).body.data.canonicalContext.locations[0])).status).toBe(200);
    const fresh = new Pool({ connectionString: roleUrl(database.connectionString, roles.runtime), max: 1 });
    try {
      const stored = await new (require('../../src/enterprise/locationRepository').EnterpriseLocationRepository)(fresh).read(principal(a), first.locationId, 'history');
      expect(stored.total).toBe(4); expect(stored.history[0].pin.revision).toBe(4);
    } finally { await fresh.end(); }
  });

  test('canonical server write/denial composition preserves allowed-Origin Vary/Cookie and attempts no outbound fetch', async () => {
    const previousFetch = global.fetch; let outbound = 0;
    global.fetch = async () => { outbound++; throw new Error('No external transport in lifecycle fixture'); };
    try {
      const canonical = require('../../src/server').app, origin = 'https://northstarsolutions.app';
      const core = await draft(a, 'create', crypto.randomUUID(), EMPTY, { name: 'Canonical server lifecycle', address: null });
      const preview = await request(canonical).post('/API/ENTERPRISE/LOCATIONS/PREVIEW/').set(a.session.headers).set('Origin', origin).send(core);
      expect(preview.status).toBe(200);
      expect(preview.headers.vary.split(',').map(value => value.trim()).sort()).toEqual(['Cookie', 'Origin']);
      expect(preview.headers['access-control-allow-origin']).toBe(origin); expect(preview.headers['cache-control']).toBe('no-store');
      const response = await request(canonical).post('/API/ENTERPRISE/LOCATIONS/COMMIT/').set(a.session.headers).set('Origin', origin)
        .set('Idempotency-Key', crypto.randomUUID()).send({ ...core, review: { ...preview.body.data.review, confirmed: true } });
      expect(response.status).toBe(201);
      const invalid = await request(canonical).post('/API/ENTERPRISE/LOCATIONS/COMMIT/').set(a.session.headers).set('Origin', origin)
        .set('Content-Type', 'application/json').send('{"contract":"one","contract":"two"}');
      expect(invalid.status).toBe(400); expect(invalid.headers['cache-control']).toBe('no-store');
      expect(invalid.headers.vary.split(',').map(value => value.trim()).sort()).toEqual(['Cookie', 'Origin']);
      expect((await request(canonical).get(ENDPOINT)).status).toBe(401);
      expect(outbound).toBe(0);
    } finally { global.fetch = previousFetch; }
  });

  test('history uses explicit bounded cursors and reports complete counts without losing old rows', async () => {
    const repository = new (require('../../src/enterprise/locationRepository').EnterpriseLocationRepository)(db.getPool());
    let current = await create(a);
    for (let revision = 2; revision <= 102; revision++) {
      const core = { contract: CONTRACT, action: 'rename', locationId: current.locationId, expected: current.pin,
        change: { name: 'Reviewed history revision ' + revision }, reason: 'Bounded history validation', profilePin: current.profilePin };
      const preview = await repository.preview(principal(a), core);
      current = (await repository.commit(principal(a), { ...core, review: { ...preview.review, confirmed: true } }, crypto.randomUUID())).receipt;
    }
    const first = await request(app).get(ENDPOINT + '/' + current.locationId + '/history').set(a.session.headers);
    expect(first.status).toBe(200); expect(first.body.data.total).toBe(102); expect(first.body.data.history).toHaveLength(100);
    const second = await request(app).get(ENDPOINT + '/' + current.locationId + '/history?beforeRevision=' + first.body.data.nextBeforeRevision).set(a.session.headers);
    expect(second.body.data.history.map(item => item.pin.revision)).toEqual([2, 1]); expect(second.body.data.nextBeforeRevision).toBeNull();
    for (const query of ['beforeRevision=0', 'beforeRevision=1&beforeRevision=2', '__proto__[scope]=*', 'organizationId=' + b.organizationId]) {
      expect((await request(app).get(ENDPOINT + '/' + current.locationId + '/history?' + query).set(a.session.headers)).status).toBe(400);
    }
    expect(await rows(a)).toHaveLength(102);
  }, 60000);

  test('direct exposed SQL rejects malformed/unknown/null authority and confirmation rather than relying on JavaScript validation', async () => {
    const client = await db.getPool().connect(), core = await draft(a, 'create', crypto.randomUUID(), EMPTY, { name: 'SQL validation', address: null });
    const args = [a.organizationId, a.userId, 'owner', a.session.sessionId, a.session.csrfToken];
    try {
      for (const body of [{ ...core, action: 'adopt' }, { ...core, change: null }, { ...core, expected: null }, { ...core, organizationId: b.organizationId }]) {
        await expect(client.query('SELECT public.canonical_enterprise_location_v1_preview($1,$2,$3,$4,$5,$6::jsonb)', [...args, body])).rejects.toMatchObject({ code: '22023' });
      }
      await expect(client.query('SELECT public.canonical_enterprise_location_v1_preview($1,$2,$3,$4,$5,$6::jsonb)', [...args.slice(0, 4), null, core])).rejects.toMatchObject({ code: '42501' });
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await expect(client.query('SELECT public.canonical_enterprise_location_v1_commit($1,$2,$3,$4,$5,$6,$7::jsonb)',
        [...args, crypto.randomUUID(), { ...core, review: { contract: 'northstar.enterprise.location-review.v1', digest: 'a'.repeat(64), confirmed: null } }])).rejects.toMatchObject({ code: '22023' });
      await client.query('ROLLBACK');
    } finally { await client.query('ROLLBACK'); client.release(); }
    expect(await rows(a)).toEqual([]);
  });

  test('mounted catalogue reads are scoped and a real disconnected repository fails privately before recovery', async () => {
    const created = await create(a);
    const catalogue = await request(app).get(ENDPOINT).set(a.session.headers);
    expect(catalogue.status).toBe(200); expect(catalogue.headers['cache-control']).toBe('no-store');
    expect(catalogue.body.data.locations.map(row => row.locationId)).toEqual([created.locationId]);
    expect((await request(app).get(ENDPOINT + '?organizationId=' + b.organizationId).set(a.session.headers)).status).toBe(400);
    const closed = new Pool({ connectionString: roleUrl(database.connectionString, roles.runtime) }); await closed.end();
    const unavailable = express(); unavailable.use(ENDPOINT, require('../../src/routes/enterpriseLocations').createEnterpriseLocationsRouter({
      repository: new (require('../../src/enterprise/locationRepository').EnterpriseLocationRepository)(closed),
    }));
    const failed = await request(unavailable).get(ENDPOINT).set(a.session.headers);
    expect(failed.status).toBe(503); expect(JSON.stringify(failed.body)).not.toMatch(/pool|SELECT|postgres|m29p1d_runtime/);
    expect((await request(app).get(ENDPOINT).set(a.session.headers)).status).toBe(200);
    expect(await rows(a)).toHaveLength(1);
  });

  test('a missing raw boundary and absent/ambiguous idempotency keys deny without a durable write', async () => {
    const core = await draft(a, 'create', crypto.randomUUID(), EMPTY, { name: 'No bypass', address: null });
    const confirmed = await prepare(a, core);
    const unguarded = express(); unguarded.use(express.json());
    unguarded.use(ENDPOINT, require('../../src/routes/enterpriseLocations').createEnterpriseLocationsRouter());
    expect((await request(unguarded).post(ENDPOINT + '/commit').set(a.session.headers).set('Idempotency-Key', crypto.randomUUID()).send(confirmed)).status).toBe(503);
    expect((await request(app).post(ENDPOINT + '/commit').set(a.session.headers).send(confirmed)).status).toBe(400);
    expect((await request(app).post(ENDPOINT + '/commit').set(a.session.headers).set('Idempotency-Key', [crypto.randomUUID(), crypto.randomUUID()]).send(confirmed)).status).toBe(400);
    expect((await request(app).post(ENDPOINT + '/commit').set(a.session.headers).set('Idempotency-Key', 'not-a-key').send(confirmed)).status).toBe(400);
    expect(await rows(a)).toEqual([]);
  });

  test.each(['fk', 'check', 'default', 'index', 'rls', 'policy', 'trigger', 'function'])('startup readiness rejects a real %s definition mutation and recovers after rollback', async kind => {
    const client = await owner.connect();
    try {
      await client.query('BEGIN');
      if (kind === 'fk') {
        const name = (await client.query(`SELECT conname FROM pg_constraint WHERE conrelid='${TABLE}'::regclass AND contype='f' AND pg_get_constraintdef(oid) LIKE '%previous_id%'`)).rows[0].conname;
        await client.query(`ALTER TABLE ${TABLE} DROP CONSTRAINT ${quote(name)}`);
        await client.query(`ALTER TABLE ${TABLE} ADD CONSTRAINT ${quote(name)} FOREIGN KEY(organization_id,location_id,previous_id) REFERENCES ${TABLE}(organization_id,location_id,id) ON DELETE CASCADE`);
      } else if (kind === 'check') {
        const name = (await client.query(`SELECT conname FROM pg_constraint WHERE conrelid='${TABLE}'::regclass AND contype='c' AND pg_get_expr(conbin,conrelid)='(revision > 0)'`)).rows[0].conname;
        await client.query(`ALTER TABLE ${TABLE} DROP CONSTRAINT ${quote(name)}`); await client.query(`ALTER TABLE ${TABLE} ADD CONSTRAINT ${quote(name)} CHECK(TRUE)`);
      } else if (kind === 'default') await client.query(`ALTER TABLE ${TABLE} ALTER COLUMN id SET DEFAULT '00000000-0000-0000-0000-000000000000'::UUID`);
      else if (kind === 'index') {
        await client.query('DROP INDEX public.canonical_enterprise_location_revisions_v1_latest');
        await client.query(`CREATE INDEX canonical_enterprise_location_revisions_v1_latest ON ${TABLE}(organization_id,location_id,revision) WHERE revision>1`);
      } else if (kind === 'rls') await client.query(`ALTER TABLE ${TABLE} NO FORCE ROW LEVEL SECURITY`);
      else if (kind === 'policy') {
        await client.query(`DROP POLICY canonical_enterprise_location_revisions_v1_tenant ON ${TABLE}`);
        await client.query(`CREATE POLICY canonical_enterprise_location_revisions_v1_tenant ON ${TABLE} USING(TRUE) WITH CHECK(TRUE)`);
      } else if (kind === 'trigger') await client.query(`ALTER TABLE ${TABLE} DISABLE TRIGGER canonical_enterprise_location_revisions_v1_immutable`);
      else await client.query("CREATE OR REPLACE FUNCTION public.canonical_enterprise_location_v1_uuid(v TEXT) RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS 'SELECT TRUE'");
      await expect(require('../../src/enterprise/locationDatabaseAuthority').grantAndVerify(client, roles.runtime)).rejects.toThrow(/Location/);
    } finally { await client.query('ROLLBACK'); client.release(); }
    const fresh = await owner.connect();
    try { await fresh.query('BEGIN'); await expect(require('../../src/enterprise/locationDatabaseAuthority').grantAndVerify(fresh, roles.runtime)).resolves.toBeUndefined(); await fresh.query('COMMIT'); }
    finally { await fresh.query('ROLLBACK'); fresh.release(); }
    expect((await getContext(a)).status).toBe(200);
  });

  test('upgrade preserves the entire 285-source baseline and old-source rollback fails closed without deleting new history', async () => {
    const allocation = await createSuiteDatabase('m29-part1d-upgrade'); let upgradedOwner, upgradedRuntime;
    const admin = new Client({ connectionString: process.env.M19_PG_ADMIN_URL }); await admin.connect();
    try { await admin.query('ALTER DATABASE ' + quote(allocation.databaseName) + ' OWNER TO ' + quote(roles.owner)); } finally { await admin.end(); }
    const baseline = fs.mkdtempSync(path.join(os.tmpdir(), 'm29-part1d-old-source-')); temporary.push(baseline);
    for (const file of fs.readdirSync(path.join(ROOT, 'migrations')).filter(file => /^\d{3}_.+\.sql$/.test(file) && Number(file.slice(0, 3)) < 290)) fs.copyFileSync(path.join(ROOT, 'migrations', file), path.join(baseline, file));
    try {
      upgradedOwner = new Pool({ connectionString: roleUrl(allocation.connectionString, roles.owner), max: 2 });
      upgradedRuntime = new Pool({ connectionString: roleUrl(allocation.connectionString, roles.runtime), max: 2 });
      await db.runMigrations({ pool: upgradedOwner, runtimePool: upgradedRuntime, migrationsDirectory: baseline });
      const legacy = await fixture('m29-upgrade-' + crypto.randomBytes(4).toString('hex'), upgradedOwner);
      const beforeProfile = (await upgradedOwner.query('SELECT to_jsonb(r) AS document FROM public.canonical_business_profiles r WHERE organization_id=$1', [legacy.organizationId])).rows;
      const oldChecksums = (await upgradedOwner.query('SELECT filename,checksum FROM public._migrations ORDER BY filename')).rows;
      await db.runMigrations({ pool: upgradedOwner, runtimePool: upgradedRuntime });
      expect((await upgradedOwner.query('SELECT filename,checksum FROM public._migrations ORDER BY filename')).rows.slice(0, 285)).toEqual(oldChecksums);
      expect((await upgradedOwner.query('SELECT to_jsonb(r) AS document FROM public.canonical_business_profiles r WHERE organization_id=$1', [legacy.organizationId])).rows).toEqual(beforeProfile);
      expect(await rows(legacy, upgradedOwner)).toEqual([]);
      const source = beforeProfile[0].document, repository = new (require('../../src/enterprise/locationRepository').EnterpriseLocationRepository)(upgradedRuntime);
      const core = { contract: CONTRACT, action: 'create', locationId: crypto.randomUUID(), expected: EMPTY,
        change: { name: 'Upgrade-owned explicit site', address: null }, reason: 'Upgrade validation',
        profilePin: { id: source.id, version: source.version_label, hash: source.normalized_profile_hash } };
      const preview = await repository.preview(principal(legacy), core);
      await repository.commit(principal(legacy), { ...core, review: { ...preview.review, confirmed: true } }, crypto.randomUUID());
      const before = await rows(legacy, upgradedOwner); expect(before).toHaveLength(1);
      await expect(db.runMigrations({ pool: upgradedOwner, runtimePool: upgradedRuntime, migrationsDirectory: baseline }))
        .rejects.toThrow(/Applied migration source is missing: 290_enterprise_location_lifecycle_v1.sql/);
      expect(await rows(legacy, upgradedOwner)).toEqual(before);
      await expect(db.runMigrations({ pool: upgradedOwner, runtimePool: upgradedRuntime })).resolves.toBe(true);
      expect(await rows(legacy, upgradedOwner)).toEqual(before);
    } finally { if (upgradedRuntime) await upgradedRuntime.end(); if (upgradedOwner) await upgradedOwner.end(); await allocation.cleanup(); }
  }, 240000);

  test('the 290 startup lane respects tighter caller timeouts while waiting for an actual migration lock', async () => {
    const control = await owner.connect(), restricted = new Pool({ connectionString: roleUrl(database.connectionString, roles.owner), max: 1 });
    const before = (await owner.query('SELECT filename,checksum FROM public._migrations ORDER BY filename')).rows;
    try {
      await control.query('BEGIN'); await control.query('SELECT pg_advisory_xact_lock($1::BIGINT)', ['5643944089238424905']);
      await restricted.query("SET lock_timeout='100ms'"); await restricted.query("SET statement_timeout='1500ms'");
      await expect(db.runMigrations({ pool: restricted, runtimePool: db.getPool() })).rejects.toThrow(/lock timeout/);
      expect((await restricted.query('SHOW lock_timeout')).rows[0].lock_timeout).toBe('100ms');
      expect((await restricted.query('SHOW statement_timeout')).rows[0].statement_timeout).toBe('1500ms');
    } finally { await control.query('ROLLBACK'); control.release(); await restricted.end(); }
    expect((await owner.query('SELECT filename,checksum FROM public._migrations ORDER BY filename')).rows).toEqual(before);
    expect((await getContext(a)).status).toBe(200);
  });
});
