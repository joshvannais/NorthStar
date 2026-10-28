'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Pool } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const canonical = require('../../src/automation/canonicalJson');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const ROOT = path.resolve(__dirname, '../..');
const TENANT = '00000000-0000-4000-8000-000000000028';
const OTHER = '00000000-0000-4000-8000-000000000029';
const OWNER = '00000000-0000-4000-8000-000000000010';
const SESSION = '00000000-0000-4000-8000-000000000011';
const STAFF = '00000000-0000-4000-8000-000000000012';
const STAFF_MEMBERSHIP = '00000000-0000-4000-8000-000000000013';
const PROFILE = '00000000-0000-4000-8000-000000000020';
const POLICY = '00000000-0000-4000-8000-000000000100';
const CUSTOMER = '00000000-0000-4000-8000-000000000200';
const RLS_ROLE = `m28_part7b_rls_${process.pid}`;
const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const hash = value => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
const copy = value => JSON.parse(JSON.stringify(value));
const quoteIdentifier = value => `"${String(value).replace(/"/g, '""')}"`;
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

realPostgres('Mission 28 Part 7B PostgreSQL communication permission through migration 282', () => {
  let database; let pool; let migrations; let operation; let graph;
  async function enter(client, tenant = TENANT) { await client.query('SELECT public.canonical_automation_enter_tenant_v1($1)', [tenant]); }
  async function tenantQuery(text, values = [], tenant = TENANT) {
    const client = await pool.connect(); try { await client.query('BEGIN'); await enter(client, tenant); const result = await client.query(text, values); await client.query('COMMIT'); return result; }
    finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
  }
  async function now() { return (await pool.query('SELECT public.canonical_automation_utc_v1(clock_timestamp()) value')).rows[0].value; }
  async function sourceItem(kind, index = 0) {
    if (kind === 'customer') {
      const row = (await tenantQuery(`SELECT public.canonical_automation_digest_v1('mission28.recipient-source.v1'||chr(10),jsonb_build_object('recipientClass','customer','customerId',c.id,'operationId',c.operation_id,'graphId',c.graph_id,'updatedAt',public.canonical_automation_utc_v1(c.updated_at),'customerSourceDigest','sha256:'||public.canonical_customer_financial_billing_identity_v1_source_digest(c))) source,
       public.canonical_automation_digest_v1('mission28.recipient-contact.v1'||chr(10),jsonb_build_object('email',c.email,'phone',c.phone)) contact FROM public.canonical_customers c WHERE organization_id=$1 AND id=$2`, [TENANT, CUSTOMER])).rows[0];
      return { recipientIndex: index, recipientClass: 'customer', recipientRecordId: CUSTOMER, parentCustomerId: CUSTOMER, membershipId: null, role: null, sourceDigest: row.source, contactIdentityDigest: row.contact };
    }
    const row = (await tenantQuery(`SELECT public.canonical_automation_digest_v1('mission28.recipient-source.v1'||chr(10),jsonb_build_object('recipientClass','staff_member','userId',u.id,'membershipId',m.id,'role',m.role,'userUpdatedAt',public.canonical_automation_utc_v1(u.updated_at),'membershipUpdatedAt',public.canonical_automation_utc_v1(m.updated_at))) source,
     public.canonical_automation_digest_v1('mission28.recipient-contact.v1'||chr(10),jsonb_build_object('email',u.email_normalized,'phone',u.phone)) contact FROM public.users u JOIN public.organization_memberships m ON m.organization_id=u.organization_id AND m.user_id=u.id WHERE u.organization_id=$1 AND u.id=$2 AND m.id=$3`, [TENANT, STAFF, STAFF_MEMBERSHIP])).rows[0];
    return { recipientIndex: index, recipientClass: 'staff_member', recipientRecordId: STAFF, parentCustomerId: null, membershipId: STAFF_MEMBERSHIP, role: 'member', sourceDigest: row.source, contactIdentityDigest: row.contact };
  }
  async function seedPart7A(suffix, kind) {
    const item = await sourceItem(kind); const transactionId = uuid(10000 + suffix); const runId = uuid(11000 + suffix); const unitId = uuid(12000 + suffix); const senderResolutionId = uuid(13000 + suffix);
    const recipientSetDigest = canonical.digest('mission28.recipient-set.v1\n', [item]);
    const document = { tenantId: TENANT, transactionId, runId, policyBinding: { policyId: POLICY, policyVersion: 1, policyDigest: hash('policy') }, sourceBinding: { sourceSetDigest: hash('source-set'), snapshotIds: [], snapshotDigests: [] }, actionUnits: [{ unitId }], requestDigest: hash(`transaction-${suffix}`) };
    await tenantQuery(`INSERT INTO public.canonical_automation_action_transactions_v1
      (organization_id,transaction_id,run_id,policy_id,policy_version,policy_digest,source_set_digest,decision_digest,authorization_digest,currentness_digest,request_digest,unit_count,canonical_text,document,retention_class,trusted_clock_contract,recorded_time_zone,recorded_at)
      VALUES($1,$2,$3,$4,1,$5,$6,$7,$8,$9,$10,1,$11::text,$11::jsonb,'decision_history','postgresql_statement_timestamp_v1','UTC',statement_timestamp())`, [TENANT, transactionId, runId, POLICY, hash('policy'), hash('source-set'), hash(`decision-${suffix}`), hash(`auth-${suffix}`), hash(`current-${suffix}`), document.requestDigest, canonical.canonicalize(document)]);
    await tenantQuery(`INSERT INTO public.canonical_automation_action_units_v1
      (organization_id,transaction_id,unit_id,run_id,unit_index,action_family_id,action_template_id,action_template_digest,recipient_set_digest,channel_id,provider_mode,effect_class,material_digest,idempotency_key_digest,unit_digest,state,recorded_at)
      VALUES($1,$2,$3,$4,0,'internal_read_digest_task','internal_fact_digest_v1',$5,$6,'in_app_passive','provider_disabled','internal_record_only',$7,$8,$9,'committed_unpublished',statement_timestamp())`, [TENANT, transactionId, unitId, runId, hash(`template-${suffix}`), recipientSetDigest, hash(`material-${suffix}`), hash(`idempotency-${suffix}`), hash(`unit-${suffix}`)]);
    await tenantQuery(`INSERT INTO public.canonical_automation_sender_recipient_resolutions_v1
      (organization_id,resolution_id,transaction_id,unit_id,run_id,sender_class,business_profile_id,business_profile_version,business_profile_digest,recipient_set_digest,recipient_count,actor_user_id,auth_session_id,membership_id,membership_role,request_digest,material_digest,resolution_digest,canonical_text,recorded_at)
      VALUES($1,$2,$3,$4,$5,'tenant_business_profile',$6,1,$7,$8,1,$9,$10,$9,'owner',$11,$12,$13,'{}',statement_timestamp())`, [TENANT, senderResolutionId, transactionId, unitId, runId, PROFILE, hash('profile'), recipientSetDigest, OWNER, SESSION, hash(`part7a-request-${suffix}`), hash(`part7a-material-${suffix}`), hash(`part7a-resolution-${suffix}`)]);
    await tenantQuery(`INSERT INTO public.canonical_automation_recipient_authority_items_v1
      (organization_id,resolution_id,recipient_index,recipient_class,recipient_record_id,parent_customer_id,membership_id,role,source_digest,contact_identity_digest,recorded_at)
      VALUES($1,$2,0,$3,$4,$5,$6,$7,$8,$9,statement_timestamp())`, [TENANT, senderResolutionId, item.recipientClass, item.recipientRecordId, item.parentCustomerId, item.membershipId, item.role, item.sourceDigest, item.contactIdentityDigest]);
    return { item, transactionId, runId, unitId, senderResolutionId, recipientSetDigest };
  }
  function versionTrusted(value) { return Object.fromEntries(['tenantId','permissionId','version','recipientBinding','channelId','preferenceState','permissionState','basisState','basisEvidenceDigest','jurisdictionState','ageRestrictionState','quietHoursState','suppressionState','previousVersionDigest','actorBinding','reviewedAt'].map(key => [key, copy(value[key])])); }
  async function permissionVersion(source, permissionId, version = 1, override = {}) {
    const value = { schemaVersion: 'mission28.communication-permission-version.v1', tenantId: TENANT, permissionId, version,
      recipientBinding: { senderRecipientResolutionId: source.senderResolutionId, ...copy(source.item) }, channelId: source.item.recipientClass === 'staff_member' ? 'in_app_passive' : 'email',
      preferenceState: source.item.recipientClass === 'staff_member' ? 'allowed' : 'unknown', permissionState: source.item.recipientClass === 'staff_member' ? 'internal_membership_current' : 'unknown', basisState: source.item.recipientClass === 'staff_member' ? 'authenticated_tenant_membership' : 'none_unknown', basisEvidenceDigest: hash(`basis-${permissionId}-${version}`), jurisdictionState: source.item.recipientClass === 'staff_member' ? 'not_applicable_internal' : 'unknown', ageRestrictionState: source.item.recipientClass === 'staff_member' ? 'not_applicable_internal' : 'unknown', quietHoursState: source.item.recipientClass === 'staff_member' ? 'not_applicable_internal_passive' : 'unknown', suppressionState: source.item.recipientClass === 'staff_member' ? 'clear_internal_passive' : 'unavailable', previousVersionDigest: null, permissionDigest: '', actorBinding: { actorId: OWNER, sessionId: SESSION, membershipId: OWNER, membershipRole: 'owner' }, reviewedAt: await now(), requestDigest: '', ...override };
    value.permissionDigest = canonical.digest('mission28.communication-permission-version.v1\n', Object.fromEntries(Object.entries(value).filter(([key]) => !['permissionDigest','requestDigest'].includes(key))));
    value.requestDigest = canonical.digest('mission28.communication-permission-request.v1\n', Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'requestDigest')));
    return value;
  }
  async function storeVersion(value, trusted = versionTrusted(value), client = pool) { return (await client.query('SELECT public.canonical_automation_record_communication_permission_version_v1($1,$2::jsonb) result', [canonical.canonicalize(value), JSON.stringify(trusted)])).rows[0].result; }
  function resolutionTrusted(value) { return Object.fromEntries(['tenantId','transactionId','unitId','senderRecipientResolutionId','permissionBindings','actorBinding','evaluatedAt'].map(key => [key, copy(value[key])])); }
  async function permissionResolution(source, stored, suffix) {
    const value = { schemaVersion: 'mission28.communication-permission-resolution.v1', tenantId: TENANT, permissionResolutionId: uuid(800000 + suffix), transactionId: source.transactionId, unitId: source.unitId, senderRecipientResolutionId: source.senderResolutionId, permissionBindings: [{ recipientIndex: 0, permissionId: stored.permissionId, permissionVersion: stored.version, permissionDigest: stored.permissionDigest }], actorBinding: { actorId: OWNER, sessionId: SESSION, membershipId: OWNER, membershipRole: 'owner' }, evaluatedAt: await now(), requestDigest: '' };
    value.requestDigest = canonical.digest('mission28.communication-permission-resolution.v1\n', Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'requestDigest'))); return value;
  }
  async function storeResolution(value, trusted = resolutionTrusted(value)) { return (await pool.query('SELECT public.canonical_automation_record_communication_permission_resolution_v1($1,$2::jsonb) result', [canonical.canonicalize(value), JSON.stringify(trusted)])).rows[0].result; }

  beforeAll(async () => {
    database = await createSuiteDatabase('m28-p7b-permission'); pool = new Pool({ connectionString: database.connectionString, max: 6 }); migrations = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m28-p7b-through282-'));
    for (const name of fs.readdirSync(path.join(ROOT, 'migrations')).filter(name => /^\d+.*\.sql$/.test(name) && Number(name.slice(0, 3)) <= 282)) fs.copyFileSync(path.join(ROOT, 'migrations', name), path.join(migrations, name));
    const db = require('../../src/db'); await db.runMigrations({ pool, migrationsDirectory: migrations });
    await pool.query(`INSERT INTO public.organizations(id,name,email) VALUES($1,'Part 7B tenant','part7b@example.test'),($2,'Part 7B other','part7b-other@example.test')`, [TENANT, OTHER]);
    await pool.query(`INSERT INTO public.users(id,organization_id,name,email,password_hash,role,status,phone) VALUES($1,$3,'Part 7B owner','part7b-owner@example.test','unused','owner','active','+12025550100'),($2,$3,'Part 7B staff','part7b-staff@example.test','unused','member','active','+12025550101')`, [OWNER, STAFF, TENANT]);
    await pool.query(`INSERT INTO public.organization_memberships(id,organization_id,user_id,role,status) VALUES($1,$3,$1,'owner','active'),($2,$3,$4,'member','active')`, [OWNER, STAFF_MEMBERSHIP, TENANT, STAFF]);
    await pool.query(`INSERT INTO public.auth_sessions(id,user_id,organization_id,membership_id,status,access_expires_at,refresh_expires_at,csrf_token_hash) VALUES($1,$2,$3,$2,'active',NOW()+INTERVAL '1 hour',NOW()+INTERVAL '2 hours',$4)`, [SESSION, OWNER, TENANT, '1'.repeat(64)]);
    await pool.query(`INSERT INTO public.canonical_business_profiles(id,organization_id,version_number,version_label,raw_profile,normalized_profile,normalized_profile_hash,is_active,created_by) VALUES($1,$2,1,'part7b','{}','{}',$3,TRUE,$4)`, [PROFILE, TENANT, hash('profile').slice(7), OWNER]);
    operation = uuid(300); graph = uuid(310);
    await pool.query(`INSERT INTO public.canonical_operations(id,organization_id,graph_id,idempotency_key_hash,payload_fingerprint,state,lease_owner,lease_expires_at) VALUES($1,$2,$3,$4,$5,'claimed',$6,NOW()+INTERVAL '1 hour')`, [operation, TENANT, graph, 'a'.repeat(64), 'b'.repeat(64), uuid(320)]);
    await pool.query(`INSERT INTO public.canonical_customers(id,organization_id,operation_id,graph_id,name,email,phone,address) VALUES($1,$2,$3,$4,'Customer','customer@example.test','+12025550102','{}')`, [CUSTOMER, TENANT, operation, graph]);
    await tenantQuery(`INSERT INTO public.canonical_automation_policy_versions_v1 (organization_id,policy_id,version,canonical_digest,canonical_text,document,expires_at,source_origin,retention_class,trusted_clock_contract,recorded_time_zone,recorded_at) VALUES($1,$2,1,$3,$4::text,$4::jsonb,NOW()+INTERVAL '1 year','mission28_native','policy_history','postgresql_statement_timestamp_v1','UTC',statement_timestamp())`, [TENANT, POLICY, hash('policy'), canonical.canonicalize({ tenantId: TENANT, policyId: POLICY, version: 1 })]);
    await pool.query(`CREATE ROLE ${quoteIdentifier(RLS_ROLE)} NOLOGIN`);
    await pool.query(`GRANT SELECT ON public.canonical_automation_communication_permission_subjects_v1,public.canonical_automation_communication_permission_versions_v1,public.canonical_automation_communication_permission_resolutions_v1,public.canonical_automation_permission_resolution_items_v1 TO ${quoteIdentifier(RLS_ROLE)}`);
  }, 300000);

  afterAll(async () => {
    if (pool) { await pool.query(`REVOKE ALL ON public.canonical_automation_communication_permission_subjects_v1,public.canonical_automation_communication_permission_versions_v1,public.canonical_automation_communication_permission_resolutions_v1,public.canonical_automation_permission_resolution_items_v1 FROM ${quoteIdentifier(RLS_ROLE)}`).catch(() => {}); await pool.query(`DROP ROLE IF EXISTS ${quoteIdentifier(RLS_ROLE)}`).catch(() => {}); await pool.end(); }
    if (database) await database.cleanup(); if (migrations && path.dirname(migrations) === os.tmpdir()) fs.rmSync(migrations, { recursive: true, force: true });
  }, 180000);

  test('migration 282 is additive, immutable, forced-RLS and exposes no public runtime function', async () => {
    expect((await pool.query('SELECT max(substring(filename,1,3)::integer) latest,count(*)::integer total FROM public._migrations')).rows[0]).toEqual({ latest: 282, total: 278 });
    const rows = (await pool.query(`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=ANY($1::text[])`, [['canonical_automation_communication_permission_subjects_v1','canonical_automation_communication_permission_versions_v1','canonical_automation_communication_permission_resolutions_v1','canonical_automation_permission_resolution_items_v1']])).rows;
    expect(rows).toHaveLength(4); expect(rows.every(row => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
    for (const signature of ['canonical_automation_record_communication_permission_version_v1(text,jsonb)','canonical_automation_record_communication_permission_resolution_v1(text,jsonb)']) expect((await pool.query(`SELECT has_function_privilege('public',$1,'EXECUTE') allowed`, [signature])).rows[0].allowed).toBe(false);
  });

  test('stores and resolves exact current staff internal permission with immutable no-effect replay', async () => {
    const source = await seedPart7A(1, 'staff'); const value = await permissionVersion(source, uuid(700001)); const stored = await storeVersion(value);
    expect(stored).toMatchObject({ version: 1, suppressionState: 'clear_internal_passive', replayed: false, effectCreated: false });
    expect(await storeVersion(copy(value))).toMatchObject({ permissionDigest: stored.permissionDigest, replayed: true, effectCreated: false });
    const resolution = await permissionResolution(source, stored, 1); const result = await storeResolution(resolution);
    expect(result).toMatchObject({ resultState: 'clear_internal_passive_no_effect', replayed: false, effectCreated: false });
    expect(await storeResolution(copy(resolution))).toMatchObject({ resolutionDigest: result.resolutionDigest, replayed: true, effectCreated: false });
    const serialized = JSON.stringify((await tenantQuery('SELECT * FROM public.canonical_automation_communication_permission_versions_v1 WHERE organization_id=$1 AND permission_id=$2', [TENANT, stored.permissionId])).rows);
    for (const privateValue of ['part7b-staff@example.test', '+12025550101', 'customer@example.test']) expect(serialized).not.toContain(privateValue);
  });

  test('keeps reported opt-in unavailable and gives reducing opt-out precedence without granting external resolution', async () => {
    const firstSource = await seedPart7A(2, 'customer'); const permissionId = uuid(700002);
    const first = await permissionVersion(firstSource, permissionId, 1, { preferenceState: 'preferred', permissionState: 'reported_opt_in_unverified', basisState: 'owner_reviewed_reported_basis_unverified', jurisdictionState: 'unknown', ageRestrictionState: 'unknown', quietHoursState: 'unknown', suppressionState: 'unavailable' });
    const stored = await storeVersion(first); expect(stored.suppressionState).toBe('unavailable');
    const secondSource = await seedPart7A(3, 'customer'); const second = await permissionVersion(secondSource, permissionId, 2, { preferenceState: 'preferred', permissionState: 'opted_out', basisState: 'recipient_opt_out', jurisdictionState: 'unknown', ageRestrictionState: 'unknown', quietHoursState: 'unknown', suppressionState: 'suppressed_opt_out', previousVersionDigest: stored.permissionDigest });
    const stopped = await storeVersion(second); expect(stopped.suppressionState).toBe('suppressed_opt_out');
    const resolution = await permissionResolution(secondSource, stopped, 2); await expect(storeResolution(resolution)).rejects.toThrow(/no-effect action recipient authority|latest exact permission/i);
  });

  test('denies stale source, contradictory suppression and lineage forks with zero residue', async () => {
    await pool.query(`UPDATE public.canonical_customers SET email='customer-4@example.test',updated_at=clock_timestamp() WHERE id=$1`, [CUSTOMER]);
    const source = await seedPart7A(4, 'customer'); const permissionId = uuid(700004); const first = await permissionVersion(source, permissionId);
    await pool.query(`UPDATE public.canonical_customers SET email='corrected@example.test',updated_at=clock_timestamp() WHERE id=$1`, [CUSTOMER]);
    try { await expect(storeVersion(first)).rejects.toThrow(/source unavailable/i); }
    finally { await pool.query(`UPDATE public.canonical_customers SET email='customer-4@example.test',updated_at=clock_timestamp() WHERE id=$1`, [CUSTOMER]); }
    const refreshed = await seedPart7A(5, 'customer'); const bad = await permissionVersion(refreshed, permissionId, 1, { permissionState: 'do_not_contact', basisState: 'recipient_do_not_contact', suppressionState: 'unavailable' });
    await expect(storeVersion(bad)).rejects.toThrow(/coherence invalid/i);
    const internalOnly = await permissionVersion(refreshed, permissionId, 1, { jurisdictionState: 'not_applicable_internal' });
    await expect(storeVersion(internalOnly)).rejects.toThrow(/coherence invalid/i);
    const good = await permissionVersion(refreshed, permissionId, 2, { permissionState: 'opted_out', basisState: 'recipient_opt_out', suppressionState: 'suppressed_opt_out', previousVersionDigest: hash('wrong') });
    await expect(storeVersion(good)).rejects.toThrow(/lineage must begin|previous version mismatch/i);
    expect((await tenantQuery('SELECT count(*)::integer count FROM public.canonical_automation_communication_permission_versions_v1 WHERE organization_id=$1 AND permission_id=$2', [TENANT, permissionId])).rows[0].count).toBe(0);
  });

  test('denies inactive membership, trusted substitution, replay conflicts and cross-tenant RLS', async () => {
    await pool.query(`UPDATE public.users SET email='part7b-staff-6@example.test',email_normalized='part7b-staff-6@example.test',updated_at=clock_timestamp() WHERE id=$1`, [STAFF]);
    const source = await seedPart7A(6, 'staff'); const permissionId = uuid(700006); const value = await permissionVersion(source, permissionId);
    await pool.query(`UPDATE public.users SET status='suspended' WHERE id=$1`, [STAFF]);
    try { await expect(storeVersion(value)).rejects.toThrow(/source unavailable/i); }
    finally { await pool.query(`UPDATE public.users SET status='active' WHERE id=$1`, [STAFF]); }
    const trusted = versionTrusted(value); trusted.channelId = 'email'; await expect(storeVersion(value, trusted)).rejects.toThrow(/trusted resolution invalid/i);
    const stored = await storeVersion(value); const conflict = copy(value); conflict.preferenceState = 'preferred'; conflict.permissionDigest = canonical.digest('mission28.communication-permission-version.v1\n', Object.fromEntries(Object.entries(conflict).filter(([key]) => !['permissionDigest','requestDigest'].includes(key)))); conflict.requestDigest = canonical.digest('mission28.communication-permission-request.v1\n', Object.fromEntries(Object.entries(conflict).filter(([key]) => key !== 'requestDigest')));
    await expect(storeVersion(conflict)).rejects.toThrow(/replay conflict/i); expect(stored.replayed).toBe(false);
    const client = await pool.connect(); try { await client.query('BEGIN'); await client.query(`SET LOCAL ROLE ${quoteIdentifier(RLS_ROLE)}`); await client.query(`SELECT set_config('northstar.automation_tenant_id',$1,TRUE)`, [OTHER]); expect((await client.query('SELECT count(*)::integer count FROM public.canonical_automation_communication_permission_versions_v1')).rows[0].count).toBe(0); await client.query('ROLLBACK'); } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
  });

  test('serializes source correction before version storage and rejects the now-stale Part 7A binding', async () => {
    await pool.query(`UPDATE public.canonical_customers SET email='customer-7@example.test',updated_at=clock_timestamp() WHERE id=$1`, [CUSTOMER]);
    const source = await seedPart7A(7, 'customer'); const permissionId = uuid(700007); const value = await permissionVersion(source, permissionId);
    const blocker = await pool.connect(); let completed = false;
    try {
      await blocker.query('BEGIN');
      await blocker.query(`UPDATE public.canonical_customers SET email='customer-7-corrected@example.test',updated_at=clock_timestamp() WHERE id=$1`, [CUSTOMER]);
      const pending = storeVersion(value).then(result => ({ result }), error => ({ error })).finally(() => { completed = true; });
      await wait(100); expect(completed).toBe(false);
      await blocker.query('COMMIT');
      const outcome = await pending; expect(outcome.error).toBeInstanceOf(Error); expect(outcome.error.message).toMatch(/source unavailable/i);
      expect((await tenantQuery('SELECT count(*)::integer count FROM public.canonical_automation_communication_permission_versions_v1 WHERE organization_id=$1 AND permission_id=$2', [TENANT, permissionId])).rows[0].count).toBe(0);
    } finally { await blocker.query('ROLLBACK').catch(() => {}); blocker.release(); }
  });

  test('serializes permission-lineage append before resolution and rejects a superseded version', async () => {
    await pool.query(`UPDATE public.users SET email='part7b-staff-8@example.test',email_normalized='part7b-staff-8@example.test',updated_at=clock_timestamp() WHERE id=$1`, [STAFF]);
    const source = await seedPart7A(8, 'staff'); const permissionId = uuid(700008);
    const firstValue = await permissionVersion(source, permissionId); const first = await storeVersion(firstValue);
    const secondValue = await permissionVersion(source, permissionId, 2, { previousVersionDigest: first.permissionDigest });
    const oldResolution = await permissionResolution(source, first, 8); const blocker = await pool.connect(); let completed = false;
    try {
      await blocker.query('BEGIN');
      const second = await storeVersion(secondValue, versionTrusted(secondValue), blocker);
      const pending = storeResolution(oldResolution).then(result => ({ result }), error => ({ error })).finally(() => { completed = true; });
      await wait(100); expect(completed).toBe(false);
      await blocker.query('COMMIT');
      const outcome = await pending; expect(outcome.error).toBeInstanceOf(Error); expect(outcome.error.message).toMatch(/latest exact permission unavailable/i);
      const currentResolution = await permissionResolution(source, second, 9);
      await expect(storeResolution(currentResolution)).resolves.toMatchObject({ resultState: 'clear_internal_passive_no_effect', replayed: false, effectCreated: false });
    } finally { await blocker.query('ROLLBACK').catch(() => {}); blocker.release(); }
  });
});
