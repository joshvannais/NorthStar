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
const CONTRACT = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/architecture/MISSION_28_PART7C_CONTENT_TEMPLATE_PREVIEW_CONTRACT.json'), 'utf8'));
const TENANT = '00000000-0000-4000-8000-000000000028';
const OTHER = '00000000-0000-4000-8000-000000000029';
const OWNER = '00000000-0000-4000-8000-000000000010';
const SESSION = '00000000-0000-4000-8000-000000000011';
const STAFF = '00000000-0000-4000-8000-000000000012';
const STAFF_MEMBERSHIP = '00000000-0000-4000-8000-000000000013';
const PROFILE = '00000000-0000-4000-8000-000000000020';
const POLICY = '00000000-0000-4000-8000-000000000100';
const RLS_ROLE = `m28_part7c_rls_${process.pid}`;
const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const hash = value => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
const copy = value => JSON.parse(JSON.stringify(value));
const quoteIdentifier = value => `"${String(value).replace(/"/g, '""')}"`;
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const ACTIONS = Object.fromEntries(CONTRACT.approvedTemplateCatalog.map(entry => [entry.actionTemplateId, entry]));

realPostgres('Mission 28 Part 7C PostgreSQL content template preview through migration 283', () => {
  let database; let pool; let migrations;
  async function enter(client, tenant = TENANT) { await client.query('SELECT public.canonical_automation_enter_tenant_v1($1)', [tenant]); }
  async function tenantQuery(text, values = [], tenant = TENANT) {
    const client = await pool.connect();
    try { await client.query('BEGIN'); await enter(client, tenant); const result = await client.query(text, values); await client.query('COMMIT'); return result; }
    finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
  }
  async function now() { return (await pool.query('SELECT public.canonical_automation_utc_v1(clock_timestamp()) value')).rows[0].value; }
  async function sourceItem(suffix) {
    const staffId = uuid(200000 + suffix); const membershipId = uuid(300000 + suffix);
    await pool.query(`INSERT INTO public.users(id,organization_id,name,email,password_hash,role,status,phone) VALUES($1,$2,$3,$4,'unused','member','active',NULL) ON CONFLICT(id) DO NOTHING`, [staffId, TENANT, `Part 7C staff ${suffix}`, `part7c-staff-${suffix}@example.test`]);
    await pool.query(`INSERT INTO public.organization_memberships(id,organization_id,user_id,role,status) VALUES($1,$3,$2,'member','active') ON CONFLICT(id) DO NOTHING`, [membershipId, staffId, TENANT]);
    const row = (await tenantQuery(`SELECT public.canonical_automation_digest_v1('mission28.recipient-source.v1'||chr(10),jsonb_build_object('recipientClass','staff_member','userId',u.id,'membershipId',m.id,'role',m.role,'userUpdatedAt',public.canonical_automation_utc_v1(u.updated_at),'membershipUpdatedAt',public.canonical_automation_utc_v1(m.updated_at))) source,
     public.canonical_automation_digest_v1('mission28.recipient-contact.v1'||chr(10),jsonb_build_object('email',u.email_normalized,'phone',u.phone)) contact FROM public.users u JOIN public.organization_memberships m ON m.organization_id=u.organization_id AND m.user_id=u.id WHERE u.organization_id=$1 AND u.id=$2 AND m.id=$3`, [TENANT, staffId, membershipId])).rows[0];
    return { recipientIndex: 0, recipientClass: 'staff_member', recipientRecordId: staffId, parentCustomerId: null, membershipId, role: 'member', sourceDigest: row.source, contactIdentityDigest: row.contact };
  }
  async function seedPart7A(suffix, actionTemplateId) {
    const entry = ACTIONS[actionTemplateId]; const item = await sourceItem(suffix);
    const transactionId = uuid(10000 + suffix); const runId = uuid(11000 + suffix); const unitId = uuid(12000 + suffix); const senderResolutionId = uuid(13000 + suffix);
    const recipientSetDigest = canonical.digest('mission28.recipient-set.v1\n', [item]);
    const document = { tenantId: TENANT, transactionId, runId, policyBinding: { policyId: POLICY, policyVersion: 1, policyDigest: hash('policy') }, sourceBinding: { sourceSetDigest: hash(`source-set-${suffix}`), snapshotIds: [], snapshotDigests: [] }, actionUnits: [{ unitId }], requestDigest: hash(`transaction-${suffix}`) };
    await tenantQuery(`INSERT INTO public.canonical_automation_action_transactions_v1
      (organization_id,transaction_id,run_id,policy_id,policy_version,policy_digest,source_set_digest,decision_digest,authorization_digest,currentness_digest,request_digest,unit_count,canonical_text,document,retention_class,trusted_clock_contract,recorded_time_zone,recorded_at)
      VALUES($1,$2,$3,$4,1,$5,$6,$7,$8,$9,$10,1,$11::text,$11::jsonb,'decision_history','postgresql_statement_timestamp_v1','UTC',statement_timestamp())`, [TENANT, transactionId, runId, POLICY, hash('policy'), document.sourceBinding.sourceSetDigest, hash(`decision-${suffix}`), hash(`auth-${suffix}`), hash(`current-${suffix}`), document.requestDigest, canonical.canonicalize(document)]);
    await tenantQuery(`INSERT INTO public.canonical_automation_action_units_v1
      (organization_id,transaction_id,unit_id,run_id,unit_index,action_family_id,action_template_id,action_template_digest,recipient_set_digest,channel_id,provider_mode,effect_class,material_digest,idempotency_key_digest,unit_digest,state,recorded_at)
      VALUES($1,$2,$3,$4,0,$5,$6,$7,$8,'in_app_passive','provider_disabled','internal_record_only',$9,$10,$11,'committed_unpublished',statement_timestamp())`, [TENANT, transactionId, unitId, runId, entry.actionFamilyId, entry.actionTemplateId, entry.actionTemplateDigest, recipientSetDigest, hash(`material-${suffix}`), hash(`idempotency-${suffix}`), hash(`unit-${suffix}`)]);
    await tenantQuery(`INSERT INTO public.canonical_automation_sender_recipient_resolutions_v1
      (organization_id,resolution_id,transaction_id,unit_id,run_id,sender_class,business_profile_id,business_profile_version,business_profile_digest,recipient_set_digest,recipient_count,actor_user_id,auth_session_id,membership_id,membership_role,request_digest,material_digest,resolution_digest,canonical_text,recorded_at)
      VALUES($1,$2,$3,$4,$5,'tenant_business_profile',$6,1,$7,$8,1,$9,$10,$9,'owner',$11,$12,$13,'{}',statement_timestamp())`, [TENANT, senderResolutionId, transactionId, unitId, runId, PROFILE, hash('profile'), recipientSetDigest, OWNER, SESSION, hash(`part7a-request-${suffix}`), hash(`part7a-material-${suffix}`), hash(`part7a-resolution-${suffix}`)]);
    await tenantQuery(`INSERT INTO public.canonical_automation_recipient_authority_items_v1
      (organization_id,resolution_id,recipient_index,recipient_class,recipient_record_id,parent_customer_id,membership_id,role,source_digest,contact_identity_digest,recorded_at)
      VALUES($1,$2,0,$3,$4,NULL,$5,$6,$7,$8,statement_timestamp())`, [TENANT, senderResolutionId, item.recipientClass, item.recipientRecordId, item.membershipId, item.role, item.sourceDigest, item.contactIdentityDigest]);
    return { entry, item, transactionId, runId, unitId, senderResolutionId };
  }
  function versionTrusted(value) { return Object.fromEntries(['tenantId','permissionId','version','recipientBinding','channelId','preferenceState','permissionState','basisState','basisEvidenceDigest','jurisdictionState','ageRestrictionState','quietHoursState','suppressionState','previousVersionDigest','actorBinding','reviewedAt'].map(key => [key, copy(value[key])])); }
  async function permissionVersion(source, permissionId, version = 1, previousVersionDigest = null) {
    const value = { schemaVersion: 'mission28.communication-permission-version.v1', tenantId: TENANT, permissionId, version,
      recipientBinding: { senderRecipientResolutionId: source.senderResolutionId, ...copy(source.item) }, channelId: 'in_app_passive', preferenceState: 'allowed', permissionState: 'internal_membership_current', basisState: 'authenticated_tenant_membership', basisEvidenceDigest: hash(`basis-${permissionId}-${version}`), jurisdictionState: 'not_applicable_internal', ageRestrictionState: 'not_applicable_internal', quietHoursState: 'not_applicable_internal_passive', suppressionState: 'clear_internal_passive', previousVersionDigest, permissionDigest: '', actorBinding: { actorId: OWNER, sessionId: SESSION, membershipId: OWNER, membershipRole: 'owner' }, reviewedAt: await now(), requestDigest: '' };
    value.permissionDigest = canonical.digest('mission28.communication-permission-version.v1\n', Object.fromEntries(Object.entries(value).filter(([key]) => !['permissionDigest','requestDigest'].includes(key))));
    value.requestDigest = canonical.digest('mission28.communication-permission-request.v1\n', Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'requestDigest'))); return value;
  }
  async function storeVersion(value, trusted = versionTrusted(value), client = pool) { return (await client.query('SELECT public.canonical_automation_record_communication_permission_version_v1($1,$2::jsonb) result', [canonical.canonicalize(value), JSON.stringify(trusted)])).rows[0].result; }
  function resolutionTrusted(value) { return Object.fromEntries(['tenantId','transactionId','unitId','senderRecipientResolutionId','permissionBindings','actorBinding','evaluatedAt'].map(key => [key, copy(value[key])])); }
  async function storeResolution(value) { return (await pool.query('SELECT public.canonical_automation_record_communication_permission_resolution_v1($1,$2::jsonb) result', [canonical.canonicalize(value), JSON.stringify(resolutionTrusted(value))])).rows[0].result; }
  async function seedAuthority(suffix, actionTemplateId = 'internal_fact_digest_v1') {
    const source = await seedPart7A(suffix, actionTemplateId); const permissionId = uuid(700000 + suffix);
    const versionValue = await permissionVersion(source, permissionId); const version = await storeVersion(versionValue);
    const resolutionValue = { schemaVersion: 'mission28.communication-permission-resolution.v1', tenantId: TENANT, permissionResolutionId: uuid(800000 + suffix), transactionId: source.transactionId, unitId: source.unitId, senderRecipientResolutionId: source.senderResolutionId, permissionBindings: [{ recipientIndex: 0, permissionId, permissionVersion: 1, permissionDigest: version.permissionDigest }], actorBinding: { actorId: OWNER, sessionId: SESSION, membershipId: OWNER, membershipRole: 'owner' }, evaluatedAt: await now(), requestDigest: '' };
    resolutionValue.requestDigest = canonical.digest('mission28.communication-permission-resolution.v1\n', Object.fromEntries(Object.entries(resolutionValue).filter(([key]) => key !== 'requestDigest')));
    const resolution = await storeResolution(resolutionValue); return { ...source, permissionId, versionValue, version, resolutionValue, resolution };
  }
  function previewTrusted(value) { return Object.fromEntries(['tenantId','transactionId','unitId','senderRecipientResolutionId','permissionResolutionId','templateBinding','variableBindings','localeId','languageId','linkSelections','attachmentSelections','actorBinding','previewedAt'].map(key => [key, copy(value[key])])); }
  async function previewValue(source, suffix) {
    const entry = source.entry; const value = { schemaVersion: 'mission28.content-preview.v1', tenantId: TENANT, contentPreviewId: uuid(900000 + suffix), transactionId: source.transactionId, unitId: source.unitId, senderRecipientResolutionId: source.senderResolutionId, permissionResolutionId: source.resolutionValue.permissionResolutionId,
      templateBinding: { contentTemplateId: entry.contentTemplateId, contentTemplateVersion: 1, contentTemplateDigest: entry.contentTemplateDigest, actionTemplateId: entry.actionTemplateId, actionTemplateDigest: entry.actionTemplateDigest, actionFamilyId: entry.actionFamilyId, contentFormat: 'plain_text', wordingOrigin: 'approved_static_catalog', customerSafeRule: 'closed_catalog_no_free_text_internal_no_effect' },
      variableBindings: [{ name: 'actionLabel', valueId: entry.variableSchema[0].allowedValueId, valueDigest: entry.variableValueDigest }], localeId: 'en-US', languageId: 'en', linkSelections: [], attachmentSelections: [], actorBinding: { actorId: OWNER, sessionId: SESSION, membershipId: OWNER, membershipRole: 'owner' }, previewedAt: await now(), requestDigest: '' };
    value.requestDigest = canonical.digest('mission28.content-preview.v1\n', Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'requestDigest'))); return value;
  }
  async function storePreview(value, trusted = previewTrusted(value)) { return (await pool.query('SELECT public.canonical_automation_record_content_preview_v1($1,$2::jsonb) result', [canonical.canonicalize(value), JSON.stringify(trusted)])).rows[0].result; }

  beforeAll(async () => {
    database = await createSuiteDatabase('m28-p7c-content'); pool = new Pool({ connectionString: database.connectionString, max: 6 }); migrations = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m28-p7c-through283-'));
    for (const name of fs.readdirSync(path.join(ROOT, 'migrations')).filter(name => /^\d+.*\.sql$/.test(name) && Number(name.slice(0, 3)) <= 283)) fs.copyFileSync(path.join(ROOT, 'migrations', name), path.join(migrations, name));
    const db = require('../../src/db'); await db.runMigrations({ pool, migrationsDirectory: migrations });
    await pool.query(`INSERT INTO public.organizations(id,name,email) VALUES($1,'Part 7C tenant','part7c@example.test'),($2,'Part 7C other','part7c-other@example.test')`, [TENANT, OTHER]);
    await pool.query(`INSERT INTO public.users(id,organization_id,name,email,password_hash,role,status,phone) VALUES($1,$3,'Part 7C owner','part7c-owner@example.test','unused','owner','active','+12025550100'),($2,$3,'Part 7C staff','part7c-staff@example.test','unused','member','active','+12025550101')`, [OWNER, STAFF, TENANT]);
    await pool.query(`INSERT INTO public.organization_memberships(id,organization_id,user_id,role,status) VALUES($1,$3,$1,'owner','active'),($2,$3,$4,'member','active')`, [OWNER, STAFF_MEMBERSHIP, TENANT, STAFF]);
    await pool.query(`INSERT INTO public.auth_sessions(id,user_id,organization_id,membership_id,status,access_expires_at,refresh_expires_at,csrf_token_hash) VALUES($1,$2,$3,$2,'active',NOW()+INTERVAL '1 hour',NOW()+INTERVAL '2 hours',$4)`, [SESSION, OWNER, TENANT, '1'.repeat(64)]);
    await pool.query(`INSERT INTO public.canonical_business_profiles(id,organization_id,version_number,version_label,raw_profile,normalized_profile,normalized_profile_hash,is_active,created_by) VALUES($1,$2,1,'part7c','{}','{}',$3,TRUE,$4)`, [PROFILE, TENANT, hash('profile').slice(7), OWNER]);
    await tenantQuery(`INSERT INTO public.canonical_automation_policy_versions_v1 (organization_id,policy_id,version,canonical_digest,canonical_text,document,expires_at,source_origin,retention_class,trusted_clock_contract,recorded_time_zone,recorded_at) VALUES($1,$2,1,$3,$4::text,$4::jsonb,NOW()+INTERVAL '1 year','mission28_native','policy_history','postgresql_statement_timestamp_v1','UTC',statement_timestamp())`, [TENANT, POLICY, hash('policy'), canonical.canonicalize({ tenantId: TENANT, policyId: POLICY, version: 1 })]);
    await pool.query(`CREATE ROLE ${quoteIdentifier(RLS_ROLE)} NOLOGIN`); await pool.query(`GRANT SELECT ON public.canonical_automation_content_previews_v1 TO ${quoteIdentifier(RLS_ROLE)}`);
  }, 300000);

  afterAll(async () => {
    if (pool) { await pool.query(`REVOKE ALL ON public.canonical_automation_content_previews_v1 FROM ${quoteIdentifier(RLS_ROLE)}`).catch(() => {}); await pool.query(`DROP ROLE IF EXISTS ${quoteIdentifier(RLS_ROLE)}`).catch(() => {}); await pool.end(); }
    if (database) await database.cleanup(); if (migrations && path.dirname(migrations) === os.tmpdir()) fs.rmSync(migrations, { recursive: true, force: true });
  }, 180000);

  test('migration 283 is additive immutable forced-RLS and exposes no public content authority', async () => {
    expect((await pool.query('SELECT max(substring(filename,1,3)::integer) latest,count(*)::integer total FROM public._migrations')).rows[0]).toEqual({ latest: 283, total: 279 });
    expect((await pool.query(`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='canonical_automation_content_previews_v1'`)).rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    expect((await pool.query(`SELECT has_function_privilege('public','canonical_automation_record_content_preview_v1(text,jsonb)','EXECUTE') allowed`)).rows[0].allowed).toBe(false);
  });

  test.each(CONTRACT.approvedTemplateCatalog.map((entry, index) => [entry.actionTemplateId, index + 1]))('stores exact %s catalog output with immutable replay and no effect', async (templateId, suffix) => {
    const source = await seedAuthority(suffix, templateId); const value = await previewValue(source, suffix); const result = await storePreview(value);
    expect(result).toMatchObject({ replayed: false, messageCreated: false, effectCreated: false }); expect(result.titleText).toContain(source.entry.variableSchema[0].allowedValueId.replaceAll('_', ' '));
    expect(await storePreview(copy(value))).toMatchObject({ contentPreviewDigest: result.contentPreviewDigest, replayed: true, messageCreated: false, effectCreated: false });
    const stored = (await tenantQuery('SELECT * FROM public.canonical_automation_content_previews_v1 WHERE organization_id=$1 AND content_preview_id=$2', [TENANT, value.contentPreviewId])).rows[0];
    expect(stored).toMatchObject({ link_selection_count: 0, attachment_selection_count: 0, wording_origin: 'approved_static_catalog' });
    expect(JSON.stringify(stored)).not.toContain(`part7c-staff-${suffix}@example.test`);
  });

  test('rejects free text AI locale link attachment catalog and trusted substitutions with zero residue', async () => {
    const source = await seedAuthority(10); const original = await previewValue(source, 10);
    for (const mutate of [
      value => { value.variableBindings[0].valueId = '<script>customer@example.test {{prompt}}</script>'; },
      value => { value.templateBinding.wordingOrigin = 'ai_assisted_draft'; },
      value => { value.templateBinding.contentTemplateVersion = '1'; },
      value => { value.localeId = 'en-us'; }, value => { value.linkSelections = [{ url: 'https://example.test/token' }]; },
      value => { value.attachmentSelections = [{ documentId: uuid(999) }]; }, value => { value.templateBinding.actionTemplateId = 'owner_approval_request_v1'; }
    ]) {
      const value = copy(original); mutate(value); value.requestDigest = canonical.digest('mission28.content-preview.v1\n', Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'requestDigest')));
      await expect(storePreview(value, previewTrusted(value))).rejects.toThrow();
    }
    const wrongTrust = previewTrusted(original); wrongTrust.localeId = 'fr'; await expect(storePreview(original, wrongTrust)).rejects.toThrow(/trusted resolution/i);
    expect((await tenantQuery('SELECT count(*)::integer count FROM public.canonical_automation_content_previews_v1 WHERE organization_id=$1 AND unit_id=$2', [TENANT, source.unitId])).rows[0].count).toBe(0);
  });

  test('rejects stale recipient source and superseded permission before content storage', async () => {
    const staleSource = await seedAuthority(20); const staleValue = await previewValue(staleSource, 20);
    await pool.query(`UPDATE public.users SET email='part7c-staff-corrected@example.test',email_normalized='part7c-staff-corrected@example.test',updated_at=clock_timestamp() WHERE id=$1`, [staleSource.item.recipientRecordId]);
    await expect(storePreview(staleValue)).rejects.toThrow(/content authority unavailable/i);
    const current = await seedAuthority(21); const oldPreview = await previewValue(current, 21); const secondValue = await permissionVersion(current, current.permissionId, 2, current.version.permissionDigest); await storeVersion(secondValue);
    await expect(storePreview(oldPreview)).rejects.toThrow(/content authority unavailable/i);
  });

  test('serializes concurrent source correction and permission append before preview', async () => {
    const sourceRace = await seedAuthority(30); const sourcePreview = await previewValue(sourceRace, 30); const sourceBlocker = await pool.connect(); let sourceDone = false;
    try {
      await sourceBlocker.query('BEGIN'); await sourceBlocker.query(`UPDATE public.users SET email='part7c-race@example.test',email_normalized='part7c-race@example.test',updated_at=clock_timestamp() WHERE id=$1`, [sourceRace.item.recipientRecordId]);
      const pending = storePreview(sourcePreview).then(result => ({ result }), error => ({ error })).finally(() => { sourceDone = true; }); await wait(100); expect(sourceDone).toBe(false); await sourceBlocker.query('COMMIT');
      expect((await pending).error.message).toMatch(/content authority unavailable/i);
    } finally { await sourceBlocker.query('ROLLBACK').catch(() => {}); sourceBlocker.release(); }
    const permissionRace = await seedAuthority(31); const permissionPreview = await previewValue(permissionRace, 31); const permissionBlocker = await pool.connect(); let permissionDone = false;
    try {
      await permissionBlocker.query('BEGIN'); const secondValue = await permissionVersion(permissionRace, permissionRace.permissionId, 2, permissionRace.version.permissionDigest); await storeVersion(secondValue, versionTrusted(secondValue), permissionBlocker);
      const pending = storePreview(permissionPreview).then(result => ({ result }), error => ({ error })).finally(() => { permissionDone = true; }); await wait(100); expect(permissionDone).toBe(false); await permissionBlocker.query('COMMIT');
      expect((await pending).error.message).toMatch(/content authority unavailable/i);
    } finally { await permissionBlocker.query('ROLLBACK').catch(() => {}); permissionBlocker.release(); }
  });

  test('rejects replay conflicts, cloned previews and cross-tenant RLS', async () => {
    const source = await seedAuthority(40); const value = await previewValue(source, 40); await storePreview(value);
    const conflict = copy(value); conflict.variableBindings[0].valueDigest = hash('changed'); conflict.requestDigest = canonical.digest('mission28.content-preview.v1\n', Object.fromEntries(Object.entries(conflict).filter(([key]) => key !== 'requestDigest')));
    await expect(storePreview(conflict, previewTrusted(conflict))).rejects.toThrow(/replay conflict/i);
    const clone = copy(value); clone.contentPreviewId = uuid(900041); clone.requestDigest = canonical.digest('mission28.content-preview.v1\n', Object.fromEntries(Object.entries(clone).filter(([key]) => key !== 'requestDigest')));
    await expect(storePreview(clone, previewTrusted(clone))).rejects.toThrow(/duplicate key|unique/i);
    const client = await pool.connect(); try { await client.query('BEGIN'); await client.query(`SET LOCAL ROLE ${quoteIdentifier(RLS_ROLE)}`); await client.query(`SELECT set_config('northstar.automation_tenant_id',$1,TRUE)`, [OTHER]); expect((await client.query('SELECT count(*)::integer count FROM public.canonical_automation_content_previews_v1')).rows[0].count).toBe(0); await client.query('ROLLBACK'); } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
  });
});
