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
const CONTENT = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/architecture/MISSION_28_PART7C_CONTENT_TEMPLATE_PREVIEW_CONTRACT.json'), 'utf8'));
const CHANNELS = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/architecture/MISSION_28_PART7D_CHANNEL_DELIVERY_HANDOFF_CONTRACT.json'), 'utf8'));
const DELIVERY_EVIDENCE = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/architecture/MISSION_28_PART7F_DELIVERY_EVIDENCE_CONTRACT.json'), 'utf8'));
const TENANT = '00000000-0000-4000-8000-000000000028';
const OTHER = '00000000-0000-4000-8000-000000000029';
const OWNER = '00000000-0000-4000-8000-000000000010';
const SESSION = '00000000-0000-4000-8000-000000000011';
const STAFF = '00000000-0000-4000-8000-000000000012';
const STAFF_MEMBERSHIP = '00000000-0000-4000-8000-000000000013';
const PROFILE = '00000000-0000-4000-8000-000000000020';
const POLICY = '00000000-0000-4000-8000-000000000100';
const RLS_ROLE = `m28_part7d_rls_${process.pid}`;
const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const hash = value => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const quoteIdentifier = value => `"${String(value).replace(/"/g, '""')}"`;
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const ACTIONS = Object.fromEntries(CONTENT.approvedTemplateCatalog.map(entry => [entry.actionTemplateId, entry]));

realPostgres('Mission 28 Parts 7D-7F PostgreSQL channel, no-access link and no-evidence truth through migration 286', () => {
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
    await pool.query(`INSERT INTO public.users(id,organization_id,name,email,password_hash,role,status,phone)
      VALUES($1,$2,$3,$4,'unused','member','active',NULL) ON CONFLICT(id) DO NOTHING`, [staffId, TENANT, `Part 7D staff ${suffix}`, `part7d-staff-${suffix}@example.test`]);
    await pool.query(`INSERT INTO public.organization_memberships(id,organization_id,user_id,role,status)
      VALUES($1,$3,$2,'member','active') ON CONFLICT(id) DO NOTHING`, [membershipId, staffId, TENANT]);
    const row = (await tenantQuery(`SELECT public.canonical_automation_digest_v1('mission28.recipient-source.v1'||chr(10),jsonb_build_object(
      'recipientClass','staff_member','userId',u.id,'membershipId',m.id,'role',m.role,'userUpdatedAt',public.canonical_automation_utc_v1(u.updated_at),
      'membershipUpdatedAt',public.canonical_automation_utc_v1(m.updated_at))) source,
      public.canonical_automation_digest_v1('mission28.recipient-contact.v1'||chr(10),jsonb_build_object('email',u.email_normalized,'phone',u.phone)) contact
      FROM public.users u JOIN public.organization_memberships m ON m.organization_id=u.organization_id AND m.user_id=u.id
      WHERE u.organization_id=$1 AND u.id=$2 AND m.id=$3`, [TENANT, staffId, membershipId])).rows[0];
    return { recipientIndex: 0, recipientClass: 'staff_member', recipientRecordId: staffId, parentCustomerId: null, membershipId, role: 'member', sourceDigest: row.source, contactIdentityDigest: row.contact };
  }
  async function seedPart7A(suffix, actionTemplateId) {
    const entry = ACTIONS[actionTemplateId]; const item = await sourceItem(suffix);
    const transactionId = uuid(10000 + suffix); const runId = uuid(11000 + suffix); const unitId = uuid(12000 + suffix); const senderResolutionId = uuid(13000 + suffix);
    const recipientSetDigest = canonical.digest('mission28.recipient-set.v1\n', [item]);
    const document = { tenantId: TENANT, transactionId, runId, policyBinding: { policyId: POLICY, policyVersion: 1, policyDigest: hash('policy') }, sourceBinding: { sourceSetDigest: hash(`source-set-${suffix}`), snapshotIds: [], snapshotDigests: [] }, actionUnits: [{ unitId }], requestDigest: hash(`transaction-${suffix}`) };
    await tenantQuery(`INSERT INTO public.canonical_automation_action_transactions_v1
      (organization_id,transaction_id,run_id,policy_id,policy_version,policy_digest,source_set_digest,decision_digest,authorization_digest,currentness_digest,request_digest,unit_count,canonical_text,document,retention_class,trusted_clock_contract,recorded_time_zone,recorded_at)
      VALUES($1,$2,$3,$4,1,$5,$6,$7,$8,$9,$10,1,$11::text,$11::jsonb,'decision_history','postgresql_statement_timestamp_v1','UTC',statement_timestamp())`,
      [TENANT, transactionId, runId, POLICY, hash('policy'), document.sourceBinding.sourceSetDigest, hash(`decision-${suffix}`), hash(`auth-${suffix}`), hash(`current-${suffix}`), document.requestDigest, canonical.canonicalize(document)]);
    await tenantQuery(`INSERT INTO public.canonical_automation_action_units_v1
      (organization_id,transaction_id,unit_id,run_id,unit_index,action_family_id,action_template_id,action_template_digest,recipient_set_digest,channel_id,provider_mode,effect_class,material_digest,idempotency_key_digest,unit_digest,state,recorded_at)
      VALUES($1,$2,$3,$4,0,$5,$6,$7,$8,'in_app_passive','provider_disabled','internal_record_only',$9,$10,$11,'committed_unpublished',statement_timestamp())`,
      [TENANT, transactionId, unitId, runId, entry.actionFamilyId, entry.actionTemplateId, entry.actionTemplateDigest, recipientSetDigest, hash(`material-${suffix}`), hash(`idempotency-${suffix}`), hash(`unit-${suffix}`)]);
    await tenantQuery(`INSERT INTO public.canonical_automation_sender_recipient_resolutions_v1
      (organization_id,resolution_id,transaction_id,unit_id,run_id,sender_class,business_profile_id,business_profile_version,business_profile_digest,recipient_set_digest,recipient_count,actor_user_id,auth_session_id,membership_id,membership_role,request_digest,material_digest,resolution_digest,canonical_text,recorded_at)
      VALUES($1,$2,$3,$4,$5,'tenant_business_profile',$6,1,$7,$8,1,$9,$10,$9,'owner',$11,$12,$13,'{}',statement_timestamp())`,
      [TENANT, senderResolutionId, transactionId, unitId, runId, PROFILE, hash('profile'), recipientSetDigest, OWNER, SESSION, hash(`part7a-request-${suffix}`), hash(`part7a-material-${suffix}`), hash(`part7a-resolution-${suffix}`)]);
    await tenantQuery(`INSERT INTO public.canonical_automation_recipient_authority_items_v1
      (organization_id,resolution_id,recipient_index,recipient_class,recipient_record_id,parent_customer_id,membership_id,role,source_digest,contact_identity_digest,recorded_at)
      VALUES($1,$2,0,$3,$4,NULL,$5,$6,$7,$8,statement_timestamp())`, [TENANT, senderResolutionId, item.recipientClass, item.recipientRecordId, item.membershipId, item.role, item.sourceDigest, item.contactIdentityDigest]);
    return { entry, item, transactionId, runId, unitId, senderResolutionId };
  }
  function versionTrusted(value) { return Object.fromEntries(['tenantId','permissionId','version','recipientBinding','channelId','preferenceState','permissionState','basisState','basisEvidenceDigest','jurisdictionState','ageRestrictionState','quietHoursState','suppressionState','previousVersionDigest','actorBinding','reviewedAt'].map(key => [key, copy(value[key])])); }
  async function permissionVersion(source, permissionId, version = 1, previousVersionDigest = null) {
    const value = { schemaVersion: 'mission28.communication-permission-version.v1', tenantId: TENANT, permissionId, version,
      recipientBinding: { senderRecipientResolutionId: source.senderResolutionId, ...copy(source.item) }, channelId: 'in_app_passive', preferenceState: 'allowed',
      permissionState: 'internal_membership_current', basisState: 'authenticated_tenant_membership', basisEvidenceDigest: hash(`basis-${permissionId}-${version}`),
      jurisdictionState: 'not_applicable_internal', ageRestrictionState: 'not_applicable_internal', quietHoursState: 'not_applicable_internal_passive',
      suppressionState: 'clear_internal_passive', previousVersionDigest, permissionDigest: '',
      actorBinding: { actorId: OWNER, sessionId: SESSION, membershipId: OWNER, membershipRole: 'owner' }, reviewedAt: await now(), requestDigest: '' };
    value.permissionDigest = canonical.digest('mission28.communication-permission-version.v1\n', Object.fromEntries(Object.entries(value).filter(([key]) => !['permissionDigest','requestDigest'].includes(key))));
    value.requestDigest = canonical.digest('mission28.communication-permission-request.v1\n', Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'requestDigest'))); return value;
  }
  async function storeVersion(value, trusted = versionTrusted(value), client = pool) { return (await client.query('SELECT public.canonical_automation_record_communication_permission_version_v1($1,$2::jsonb) result', [canonical.canonicalize(value), JSON.stringify(trusted)])).rows[0].result; }
  function permissionResolutionTrusted(value) { return Object.fromEntries(['tenantId','transactionId','unitId','senderRecipientResolutionId','permissionBindings','actorBinding','evaluatedAt'].map(key => [key, copy(value[key])])); }
  async function storePermissionResolution(value) { return (await pool.query('SELECT public.canonical_automation_record_communication_permission_resolution_v1($1,$2::jsonb) result', [canonical.canonicalize(value), JSON.stringify(permissionResolutionTrusted(value))])).rows[0].result; }
  function previewTrusted(value) { return Object.fromEntries(['tenantId','transactionId','unitId','senderRecipientResolutionId','permissionResolutionId','templateBinding','variableBindings','localeId','languageId','linkSelections','attachmentSelections','actorBinding','previewedAt'].map(key => [key, copy(value[key])])); }
  async function storePreview(value) { return (await pool.query('SELECT public.canonical_automation_record_content_preview_v1($1,$2::jsonb) result', [canonical.canonicalize(value), JSON.stringify(previewTrusted(value))])).rows[0].result; }
  async function seedContent(suffix, actionTemplateId = 'internal_fact_digest_v1') {
    const source = await seedPart7A(suffix, actionTemplateId); const permissionId = uuid(700000 + suffix);
    const versionValue = await permissionVersion(source, permissionId); const version = await storeVersion(versionValue);
    const permissionValue = { schemaVersion: 'mission28.communication-permission-resolution.v1', tenantId: TENANT,
      permissionResolutionId: uuid(800000 + suffix), transactionId: source.transactionId, unitId: source.unitId,
      senderRecipientResolutionId: source.senderResolutionId, permissionBindings: [{ recipientIndex: 0, permissionId, permissionVersion: 1, permissionDigest: version.permissionDigest }],
      actorBinding: { actorId: OWNER, sessionId: SESSION, membershipId: OWNER, membershipRole: 'owner' }, evaluatedAt: await now(), requestDigest: '' };
    permissionValue.requestDigest = canonical.digest('mission28.communication-permission-resolution.v1\n', Object.fromEntries(Object.entries(permissionValue).filter(([key]) => key !== 'requestDigest')));
    await storePermissionResolution(permissionValue);
    const entry = source.entry; const previewValue = { schemaVersion: 'mission28.content-preview.v1', tenantId: TENANT,
      contentPreviewId: uuid(900000 + suffix), transactionId: source.transactionId, unitId: source.unitId,
      senderRecipientResolutionId: source.senderResolutionId, permissionResolutionId: permissionValue.permissionResolutionId,
      templateBinding: { contentTemplateId: entry.contentTemplateId, contentTemplateVersion: 1, contentTemplateDigest: entry.contentTemplateDigest,
        actionTemplateId: entry.actionTemplateId, actionTemplateDigest: entry.actionTemplateDigest, actionFamilyId: entry.actionFamilyId,
        contentFormat: 'plain_text', wordingOrigin: 'approved_static_catalog', customerSafeRule: 'closed_catalog_no_free_text_internal_no_effect' },
      variableBindings: [{ name: 'actionLabel', valueId: entry.variableSchema[0].allowedValueId, valueDigest: entry.variableValueDigest }],
      localeId: 'en-US', languageId: 'en', linkSelections: [], attachmentSelections: [],
      actorBinding: { actorId: OWNER, sessionId: SESSION, membershipId: OWNER, membershipRole: 'owner' }, previewedAt: await now(), requestDigest: '' };
    previewValue.requestDigest = canonical.digest('mission28.content-preview.v1\n', Object.fromEntries(Object.entries(previewValue).filter(([key]) => key !== 'requestDigest')));
    const preview = await storePreview(previewValue);
    return { ...source, permissionId, version, permissionValue, previewValue, preview };
  }
  function channelTrusted(value) { return Object.fromEntries(['tenantId','transactionId','unitId','contentPreviewId','senderRecipientResolutionId','permissionResolutionId','requestedChannelId','actorBinding','evaluatedAt'].map(key => [key, copy(value[key])])); }
  async function channelValue(source, suffix, requestedChannelId = 'in_app_passive') {
    const value = { schemaVersion: 'mission28.channel-resolution.v1', tenantId: TENANT, channelResolutionId: uuid(910000 + suffix),
      transactionId: source.transactionId, unitId: source.unitId, contentPreviewId: source.previewValue.contentPreviewId,
      senderRecipientResolutionId: source.senderResolutionId, permissionResolutionId: source.permissionValue.permissionResolutionId,
      requestedChannelId, actorBinding: { actorId: OWNER, sessionId: SESSION, membershipId: OWNER, membershipRole: 'owner' },
      evaluatedAt: await now(), requestDigest: '' };
    value.requestDigest = canonical.digest('mission28.channel-resolution.v1\n', Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'requestDigest'))); return value;
  }
  async function storeChannel(value, trusted = channelTrusted(value)) { return (await pool.query('SELECT public.canonical_automation_record_channel_resolution_v1($1,$2::jsonb) result', [canonical.canonicalize(value), JSON.stringify(trusted)])).rows[0].result; }
  function linkTrusted(value) { return Object.fromEntries(['tenantId','transactionId','unitId','contentPreviewId','channelResolutionId','senderRecipientResolutionId','permissionResolutionId','requestedProfileId','actorBinding','evaluatedAt'].map(key => [key, copy(value[key])])); }
  async function linkValue(source, channel, suffix) {
    const value = { schemaVersion: 'mission28.link-attachment-resolution.v1', tenantId: TENANT,
      linkAttachmentResolutionId: uuid(920000 + suffix), transactionId: source.transactionId, unitId: source.unitId,
      contentPreviewId: source.previewValue.contentPreviewId, channelResolutionId: channel.channelResolutionId,
      senderRecipientResolutionId: source.senderResolutionId, permissionResolutionId: source.permissionValue.permissionResolutionId,
      requestedProfileId: 'current_launch_no_external_access',
      actorBinding: { actorId: OWNER, sessionId: SESSION, membershipId: OWNER, membershipRole: 'owner' },
      evaluatedAt: await now(), requestDigest: '' };
    value.requestDigest = canonical.digest('mission28.link-attachment-resolution.v1\n', Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'requestDigest')));
    return value;
  }
  async function storeLink(value, trusted = linkTrusted(value)) { return (await pool.query('SELECT public.canonical_automation_record_link_attachment_resolution_v1($1,$2::jsonb) result', [canonical.canonicalize(value), JSON.stringify(trusted)])).rows[0].result; }
  function deliveryTrusted(value) { return Object.fromEntries(['tenantId','transactionId','unitId','contentPreviewId','channelResolutionId','linkAttachmentResolutionId','senderRecipientResolutionId','permissionResolutionId','requestedProfileId','actorBinding','evaluatedAt'].map(key => [key, copy(value[key])])); }
  async function deliveryValue(source, channel, link, suffix) {
    const value = { schemaVersion: 'mission28.delivery-evidence-resolution.v1', tenantId: TENANT,
      deliveryEvidenceResolutionId: uuid(930000 + suffix), transactionId: source.transactionId, unitId: source.unitId,
      contentPreviewId: source.previewValue.contentPreviewId, channelResolutionId: channel.channelResolutionId,
      linkAttachmentResolutionId: link.linkAttachmentResolutionId, senderRecipientResolutionId: source.senderResolutionId,
      permissionResolutionId: source.permissionValue.permissionResolutionId,
      requestedProfileId: DELIVERY_EVIDENCE.currentLaunchProfile.profileId,
      actorBinding: { actorId: OWNER, sessionId: SESSION, membershipId: OWNER, membershipRole: 'owner' },
      evaluatedAt: await now(), requestDigest: '' };
    value.requestDigest = canonical.digest('mission28.delivery-evidence-resolution.v1\n', Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'requestDigest')));
    return value;
  }
  async function storeDelivery(value, trusted = deliveryTrusted(value)) { return (await pool.query('SELECT public.canonical_automation_record_delivery_evidence_resolution_v1($1,$2::jsonb) result', [canonical.canonicalize(value), JSON.stringify(trusted)])).rows[0].result; }

  beforeAll(async () => {
    database = await createSuiteDatabase('m28-p7d-channel'); pool = new Pool({ connectionString: database.connectionString, max: 6 });
    migrations = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m28-p7df-through286-'));
    for (const name of fs.readdirSync(path.join(ROOT, 'migrations')).filter(name => /^\d+.*\.sql$/.test(name) && Number(name.slice(0, 3)) <= 286)) fs.copyFileSync(path.join(ROOT, 'migrations', name), path.join(migrations, name));
    const db = require('../../src/db'); await db.runMigrations({ pool, migrationsDirectory: migrations });
    await pool.query(`INSERT INTO public.organizations(id,name,email) VALUES($1,'Part 7D tenant','part7d@example.test'),($2,'Part 7D other','part7d-other@example.test')`, [TENANT, OTHER]);
    await pool.query(`INSERT INTO public.users(id,organization_id,name,email,password_hash,role,status,phone)
      VALUES($1,$3,'Part 7D owner','part7d-owner@example.test','unused','owner','active','+12025550100'),
      ($2,$3,'Part 7D staff','part7d-staff@example.test','unused','member','active','+12025550101')`, [OWNER, STAFF, TENANT]);
    await pool.query(`INSERT INTO public.organization_memberships(id,organization_id,user_id,role,status)
      VALUES($1,$3,$1,'owner','active'),($2,$3,$4,'member','active')`, [OWNER, STAFF_MEMBERSHIP, TENANT, STAFF]);
    await pool.query(`INSERT INTO public.auth_sessions(id,user_id,organization_id,membership_id,status,access_expires_at,refresh_expires_at,csrf_token_hash)
      VALUES($1,$2,$3,$2,'active',NOW()+INTERVAL '1 hour',NOW()+INTERVAL '2 hours',$4)`, [SESSION, OWNER, TENANT, '1'.repeat(64)]);
    await pool.query(`INSERT INTO public.canonical_business_profiles(id,organization_id,version_number,version_label,raw_profile,normalized_profile,normalized_profile_hash,is_active,created_by)
      VALUES($1,$2,1,'part7d','{}','{}',$3,TRUE,$4)`, [PROFILE, TENANT, hash('profile').slice(7), OWNER]);
    await tenantQuery(`INSERT INTO public.canonical_automation_policy_versions_v1
      (organization_id,policy_id,version,canonical_digest,canonical_text,document,expires_at,source_origin,retention_class,trusted_clock_contract,recorded_time_zone,recorded_at)
      VALUES($1,$2,1,$3,$4::text,$4::jsonb,NOW()+INTERVAL '1 year','mission28_native','policy_history','postgresql_statement_timestamp_v1','UTC',statement_timestamp())`,
      [TENANT, POLICY, hash('policy'), canonical.canonicalize({ tenantId: TENANT, policyId: POLICY, version: 1 })]);
    await pool.query(`CREATE ROLE ${quoteIdentifier(RLS_ROLE)} NOLOGIN`);
    await pool.query(`GRANT SELECT ON public.canonical_automation_channel_resolutions_v1 TO ${quoteIdentifier(RLS_ROLE)}`);
    await pool.query(`GRANT SELECT ON public.canonical_automation_link_attachment_resolutions_v1 TO ${quoteIdentifier(RLS_ROLE)}`);
    await pool.query(`GRANT SELECT ON public.canonical_automation_delivery_evidence_resolutions_v1 TO ${quoteIdentifier(RLS_ROLE)}`);
  }, 300000);

  afterAll(async () => {
    if (pool) { await pool.query(`REVOKE ALL ON public.canonical_automation_channel_resolutions_v1 FROM ${quoteIdentifier(RLS_ROLE)}`).catch(() => {}); await pool.query(`REVOKE ALL ON public.canonical_automation_link_attachment_resolutions_v1 FROM ${quoteIdentifier(RLS_ROLE)}`).catch(() => {}); await pool.query(`REVOKE ALL ON public.canonical_automation_delivery_evidence_resolutions_v1 FROM ${quoteIdentifier(RLS_ROLE)}`).catch(() => {}); await pool.query(`DROP ROLE IF EXISTS ${quoteIdentifier(RLS_ROLE)}`).catch(() => {}); await pool.end(); }
    if (database) await database.cleanup(); if (migrations && path.dirname(migrations) === os.tmpdir()) fs.rmSync(migrations, { recursive: true, force: true });
  }, 180000);

  test('migrations 284-286 are additive immutable forced-RLS and expose no public authority', async () => {
    expect((await pool.query('SELECT max(substring(filename,1,3)::integer) latest,count(*)::integer total FROM public._migrations')).rows[0]).toEqual({ latest: 286, total: 282 });
    expect((await pool.query(`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='canonical_automation_channel_resolutions_v1'`)).rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    expect((await pool.query(`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='canonical_automation_link_attachment_resolutions_v1'`)).rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    expect((await pool.query(`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='canonical_automation_delivery_evidence_resolutions_v1'`)).rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    expect((await pool.query(`SELECT has_function_privilege('public','canonical_automation_record_channel_resolution_v1(text,jsonb)','EXECUTE') allowed`)).rows[0].allowed).toBe(false);
    expect((await pool.query(`SELECT has_function_privilege('public','canonical_automation_record_link_attachment_resolution_v1(text,jsonb)','EXECUTE') allowed`)).rows[0].allowed).toBe(false);
    expect((await pool.query(`SELECT has_function_privilege('public','canonical_automation_record_delivery_evidence_resolution_v1(text,jsonb)','EXECUTE') allowed`)).rows[0].allowed).toBe(false);
  });

  test('stores all four exact channel dispositions without handoff, provider, attempt, send or delivery', async () => {
    const source = await seedContent(1);
    for (const [index, expected] of CHANNELS.channelCatalog.entries()) {
      const value = await channelValue(source, index + 1, expected.channelId); const result = await storeChannel(value);
      expect(result).toMatchObject({ resultState: expected.resultState, replayed: false, handoffOpened: false,
        providerRequestCreated: false, attemptCreated: false, messageSent: false, delivered: false, effectCreated: false });
      expect(await storeChannel(copy(value))).toMatchObject({ channelResolutionDigest: result.channelResolutionDigest, replayed: true, effectCreated: false });
    }
    const rows = (await tenantQuery('SELECT * FROM public.canonical_automation_channel_resolutions_v1 WHERE organization_id=$1 AND content_preview_id=$2 ORDER BY requested_channel_id', [TENANT, source.previewValue.contentPreviewId])).rows;
    expect(rows).toHaveLength(4); expect(rows.every(row => row.provider_mode === 'provider_disabled' && row.provider_request_identity_state === 'not_created' && row.attempt_state === 'not_created')).toBe(true);
    expect(JSON.stringify(rows)).not.toContain('part7d-staff-1@example.test'); expect(JSON.stringify(rows)).not.toContain(source.preview.titleText);
  });

  test('rejects unknown fields, output claims, unknown channels and trusted substitutions with zero residue', async () => {
    const source = await seedContent(10); const original = await channelValue(source, 10);
    for (const mutate of [
      value => { value.unexpected = 'customer@example.test'; }, value => { value.requestedChannelId = 'whatsapp'; },
      value => { value.handoffOpened = true; }, value => { value.messageSent = true; }, value => { delete value.contentPreviewId; }
    ]) {
      const value = copy(original); mutate(value); value.requestDigest = canonical.digest('mission28.channel-resolution.v1\n', Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'requestDigest')));
      await expect(storeChannel(value, channelTrusted(value))).rejects.toThrow();
    }
    const wrongTrust = channelTrusted(original); wrongTrust.requestedChannelId = 'email'; await expect(storeChannel(original, wrongTrust)).rejects.toThrow(/trusted resolution/i);
    expect((await tenantQuery('SELECT count(*)::integer count FROM public.canonical_automation_channel_resolutions_v1 WHERE organization_id=$1 AND unit_id=$2', [TENANT, source.unitId])).rows[0].count).toBe(0);
  });

  test('rejects stale recipient source and superseded permission before a new channel resolution', async () => {
    const stale = await seedContent(20); const staleValue = await channelValue(stale, 20);
    await pool.query(`UPDATE public.users SET email='part7d-corrected@example.test',email_normalized='part7d-corrected@example.test',updated_at=clock_timestamp() WHERE id=$1`, [stale.item.recipientRecordId]);
    await expect(storeChannel(staleValue)).rejects.toThrow(/channel authority unavailable/i);
    const superseded = await seedContent(21); const oldValue = await channelValue(superseded, 21);
    const second = await permissionVersion(superseded, superseded.permissionId, 2, superseded.version.permissionDigest); await storeVersion(second);
    await expect(storeChannel(oldValue)).rejects.toThrow(/channel authority unavailable/i);
  });

  test('serializes source correction and permission append before authority-increasing ready resolution', async () => {
    const sourceRace = await seedContent(30); const sourceValue = await channelValue(sourceRace, 30); const sourceBlocker = await pool.connect(); let sourceDone = false;
    try {
      await sourceBlocker.query('BEGIN'); await sourceBlocker.query(`UPDATE public.users SET email='part7d-race@example.test',email_normalized='part7d-race@example.test',updated_at=clock_timestamp() WHERE id=$1`, [sourceRace.item.recipientRecordId]);
      const pending = storeChannel(sourceValue).then(result => ({ result }), error => ({ error })).finally(() => { sourceDone = true; }); await wait(100); expect(sourceDone).toBe(false); await sourceBlocker.query('COMMIT');
      expect((await pending).error.message).toMatch(/channel authority unavailable/i);
    } finally { await sourceBlocker.query('ROLLBACK').catch(() => {}); sourceBlocker.release(); }
    const permissionRace = await seedContent(31); const permissionValue = await channelValue(permissionRace, 31); const blocker = await pool.connect(); let permissionDone = false;
    try {
      await blocker.query('BEGIN'); const second = await permissionVersion(permissionRace, permissionRace.permissionId, 2, permissionRace.version.permissionDigest); await storeVersion(second, versionTrusted(second), blocker);
      const pending = storeChannel(permissionValue).then(result => ({ result }), error => ({ error })).finally(() => { permissionDone = true; }); await wait(100); expect(permissionDone).toBe(false); await blocker.query('COMMIT');
      expect((await pending).error.message).toMatch(/channel authority unavailable/i);
    } finally { await blocker.query('ROLLBACK').catch(() => {}); blocker.release(); }
  });

  test('rejects replay conflicts, cloned material and cross-tenant reads', async () => {
    const source = await seedContent(40); const value = await channelValue(source, 40, 'email'); await storeChannel(value);
    const conflict = copy(value); conflict.requestedChannelId = 'sms'; conflict.requestDigest = canonical.digest('mission28.channel-resolution.v1\n', Object.fromEntries(Object.entries(conflict).filter(([key]) => key !== 'requestDigest')));
    await expect(storeChannel(conflict, channelTrusted(conflict))).rejects.toThrow(/replay conflict/i);
    const clone = copy(value); clone.channelResolutionId = uuid(910041); clone.requestDigest = canonical.digest('mission28.channel-resolution.v1\n', Object.fromEntries(Object.entries(clone).filter(([key]) => key !== 'requestDigest')));
    await expect(storeChannel(clone, channelTrusted(clone))).rejects.toThrow(/duplicate key|unique/i);
    const client = await pool.connect();
    try { await client.query('BEGIN'); await client.query(`SET LOCAL ROLE ${quoteIdentifier(RLS_ROLE)}`); await client.query(`SELECT set_config('northstar.automation_tenant_id',$1,TRUE)`, [OTHER]); expect((await client.query('SELECT count(*)::integer count FROM public.canonical_automation_channel_resolutions_v1')).rows[0].count).toBe(0); await client.query('ROLLBACK'); }
    finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
  });

  test('stores and replays only an immutable no-access disposition with no token, URL, attachment or effect', async () => {
    const source = await seedContent(50); const channelValueInput = await channelValue(source, 50); await storeChannel(channelValueInput);
    const value = await linkValue(source, channelValueInput, 50); const first = await storeLink(value);
    expect(first).toMatchObject({ resultState: 'unavailable_no_access_grant', replayed: false, rawTokenGenerated: false,
      tokenDigestPersisted: false, linkCreated: false, attachmentCreated: false, publicResponseCreated: false,
      messageSent: false, delivered: false, effectCreated: false });
    expect(await storeLink(copy(value))).toMatchObject({ linkAttachmentResolutionDigest: first.linkAttachmentResolutionDigest, replayed: true, effectCreated: false });
    const row = (await tenantQuery('SELECT * FROM public.canonical_automation_link_attachment_resolutions_v1 WHERE organization_id=$1 AND link_attachment_resolution_id=$2', [TENANT, value.linkAttachmentResolutionId])).rows[0];
    expect(row).toMatchObject({ requested_profile_id: 'current_launch_no_external_access', document_authority_state: 'unavailable_until_part8',
      link_state: 'unavailable_no_accepted_secure_document_delivery', attachment_state: 'unavailable_no_accepted_customer_safe_document',
      token_state: 'not_generated', token_digest_state: 'not_persisted', result_state: 'unavailable_no_access_grant' });
    const columns = (await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='canonical_automation_link_attachment_resolutions_v1' ORDER BY ordinal_position`)).rows.map(rowValue => rowValue.column_name);
    expect(columns).not.toEqual(expect.arrayContaining(['raw_token','token_digest','public_url','document_bytes','attachment_bytes']));
    expect(JSON.stringify(row)).not.toContain('part7d-staff-50@example.test');
  });

  test('rejects malformed or candidate-supplied access material and trusted substitution with zero residue', async () => {
    const source = await seedContent(60); const channelValueInput = await channelValue(source, 60); await storeChannel(channelValueInput);
    const original = await linkValue(source, channelValueInput, 60);
    for (const mutate of [
      value => { value.unexpected = 'customer@example.test'; }, value => { value.rawToken = 'secret'; },
      value => { value.tokenDigest = hash('secret'); }, value => { value.documentVersionId = uuid(99); },
      value => { value.attachment = { mediaType: 'text/html' }; }, value => { value.linkCreated = true; },
      value => { delete value.permissionResolutionId; }, value => { value.requestedProfileId = 'issue_secure_link'; }
    ]) {
      const value = copy(original); mutate(value); value.requestDigest = canonical.digest('mission28.link-attachment-resolution.v1\n', Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'requestDigest')));
      await expect(storeLink(value, linkTrusted(value))).rejects.toThrow();
    }
    const wrongTrust = linkTrusted(original); wrongTrust.channelResolutionId = uuid(99); await expect(storeLink(original, wrongTrust)).rejects.toThrow(/trusted resolution/i);
    expect((await tenantQuery('SELECT count(*)::integer count FROM public.canonical_automation_link_attachment_resolutions_v1 WHERE organization_id=$1 AND unit_id=$2', [TENANT, source.unitId])).rows[0].count).toBe(0);
  });

  test('rejects stale recipient source and superseded permission before a new no-access disposition', async () => {
    const stale = await seedContent(70); const staleChannel = await channelValue(stale, 70); await storeChannel(staleChannel); const staleLink = await linkValue(stale, staleChannel, 70);
    await pool.query(`UPDATE public.users SET email='part7e-corrected@example.test',email_normalized='part7e-corrected@example.test',updated_at=clock_timestamp() WHERE id=$1`, [stale.item.recipientRecordId]);
    await expect(storeLink(staleLink)).rejects.toThrow(/link attachment authority unavailable/i);
    const superseded = await seedContent(71); const supersededChannel = await channelValue(superseded, 71); await storeChannel(supersededChannel); const oldLink = await linkValue(superseded, supersededChannel, 71);
    const second = await permissionVersion(superseded, superseded.permissionId, 2, superseded.version.permissionDigest); await storeVersion(second);
    await expect(storeLink(oldLink)).rejects.toThrow(/link attachment authority unavailable/i);
  });

  test('serializes source correction and permission append before new no-access evidence', async () => {
    const sourceRace = await seedContent(80); const sourceChannel = await channelValue(sourceRace, 80); await storeChannel(sourceChannel); const sourceLink = await linkValue(sourceRace, sourceChannel, 80);
    const sourceBlocker = await pool.connect(); let sourceDone = false;
    try {
      await sourceBlocker.query('BEGIN'); await sourceBlocker.query(`UPDATE public.users SET email='part7e-race@example.test',email_normalized='part7e-race@example.test',updated_at=clock_timestamp() WHERE id=$1`, [sourceRace.item.recipientRecordId]);
      const pending = storeLink(sourceLink).then(result => ({ result }), error => ({ error })).finally(() => { sourceDone = true; }); await wait(100); expect(sourceDone).toBe(false); await sourceBlocker.query('COMMIT');
      expect((await pending).error.message).toMatch(/link attachment authority unavailable/i);
    } finally { await sourceBlocker.query('ROLLBACK').catch(() => {}); sourceBlocker.release(); }
    const permissionRace = await seedContent(81); const permissionChannel = await channelValue(permissionRace, 81); await storeChannel(permissionChannel); const permissionLink = await linkValue(permissionRace, permissionChannel, 81);
    const blocker = await pool.connect(); let permissionDone = false;
    try {
      await blocker.query('BEGIN'); const second = await permissionVersion(permissionRace, permissionRace.permissionId, 2, permissionRace.version.permissionDigest); await storeVersion(second, versionTrusted(second), blocker);
      const pending = storeLink(permissionLink).then(result => ({ result }), error => ({ error })).finally(() => { permissionDone = true; }); await wait(100); expect(permissionDone).toBe(false); await blocker.query('COMMIT');
      expect((await pending).error.message).toMatch(/link attachment authority unavailable/i);
    } finally { await blocker.query('ROLLBACK').catch(() => {}); blocker.release(); }
  });

  test('rejects replay conflicts, cloned material and cross-tenant reads of no-access evidence', async () => {
    const source = await seedContent(90); const channelValueInput = await channelValue(source, 90); await storeChannel(channelValueInput); const value = await linkValue(source, channelValueInput, 90); await storeLink(value);
    const conflict = copy(value); conflict.requestedProfileId = 'issue_secure_link'; conflict.requestDigest = canonical.digest('mission28.link-attachment-resolution.v1\n', Object.fromEntries(Object.entries(conflict).filter(([key]) => key !== 'requestDigest')));
    await expect(storeLink(conflict, linkTrusted(conflict))).rejects.toThrow(/replay conflict|shape invalid/i);
    const clone = copy(value); clone.linkAttachmentResolutionId = uuid(920091); clone.requestDigest = canonical.digest('mission28.link-attachment-resolution.v1\n', Object.fromEntries(Object.entries(clone).filter(([key]) => key !== 'requestDigest')));
    await expect(storeLink(clone, linkTrusted(clone))).rejects.toThrow(/duplicate key|unique/i);
    const client = await pool.connect();
    try { await client.query('BEGIN'); await client.query(`SET LOCAL ROLE ${quoteIdentifier(RLS_ROLE)}`); await client.query(`SELECT set_config('northstar.automation_tenant_id',$1,TRUE)`, [OTHER]); expect((await client.query('SELECT count(*)::integer count FROM public.canonical_automation_link_attachment_resolutions_v1')).rows[0].count).toBe(0); await client.query('ROLLBACK'); }
    finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
  });

  test('stores and replays only immutable no-evidence truth with no provider, recipient, suppression or effect evidence', async () => {
    const source = await seedContent(100); const channel = await channelValue(source, 100); await storeChannel(channel);
    const link = await linkValue(source, channel, 100); await storeLink(link); const value = await deliveryValue(source, channel, link, 100);
    const first = await storeDelivery(value);
    expect(first).toMatchObject({ resultState: 'unavailable_no_effect_evidence', replayed: false,
      providerEventIngested: false, callbackAccepted: false, receiptPersisted: false, openPersisted: false,
      replyPersisted: false, questionPersisted: false, optOutPersisted: false, complaintPersisted: false,
      correctionPersisted: false, suppressionCreated: false, messageSent: false, delivered: false, effectCreated: false });
    expect(await storeDelivery(copy(value))).toMatchObject({ deliveryEvidenceResolutionDigest: first.deliveryEvidenceResolutionDigest,
      replayed: true, providerEventIngested: false, effectCreated: false });
    const row = (await tenantQuery('SELECT * FROM public.canonical_automation_delivery_evidence_resolutions_v1 WHERE organization_id=$1 AND delivery_evidence_resolution_id=$2', [TENANT, value.deliveryEvidenceResolutionId])).rows[0];
    expect(row).toMatchObject({ requested_profile_id: 'current_launch_no_provider_or_recipient_evidence', provider_attempt_state: 'not_created',
      provider_acknowledgement_state: 'unavailable_no_attempt', callback_state: 'not_received_no_callback_authority',
      delivery_state: 'unavailable_no_message_or_evidence', open_state: 'unavailable_not_supported',
      reply_state: 'unavailable_no_authenticated_inbound', opt_out_state: 'unavailable_no_authenticated_inbound',
      strongest_claim: 'none', result_state: 'unavailable_no_effect_evidence' });
    const columns = (await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='canonical_automation_delivery_evidence_resolutions_v1' ORDER BY ordinal_position`)).rows.map(rowValue => rowValue.column_name);
    expect(columns).not.toEqual(expect.arrayContaining(['raw_payload','provider_metadata','provider_status_text','callback_body','message_body','reply_body','recipient_address','contact_value','secret','token']));
    expect(JSON.stringify(row)).not.toContain('part7d-staff-100@example.test');
  });

  test('rejects malformed or candidate-supplied events, callbacks, outcomes, responses, corrections and suppression with zero residue', async () => {
    const source = await seedContent(110); const channel = await channelValue(source, 110); await storeChannel(channel);
    const link = await linkValue(source, channel, 110); await storeLink(link); const original = await deliveryValue(source, channel, link, 110);
    for (const mutate of [
      value => { value.unexpected = 'customer@example.test'; }, value => { value.providerEvent = { status: 'delivered' }; },
      value => { value.callback = { signature: 'secret' }; }, value => { value.receipt = { delivered: true }; },
      value => { value.openedAt = value.evaluatedAt; }, value => { value.reply = 'customer text'; },
      value => { value.customerQuestion = 'private question'; }, value => { value.optOut = true; },
      value => { value.complaint = true; }, value => { value.correctionOfEventId = uuid(99); },
      value => { value.suppressionCreated = true; }, value => { value.resultState = 'delivered'; },
      value => { delete value.permissionResolutionId; }, value => { value.requestedProfileId = 'provider_delivery'; }
    ]) {
      const value = copy(original); mutate(value);
      value.requestDigest = canonical.digest('mission28.delivery-evidence-resolution.v1\n', Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'requestDigest')));
      await expect(storeDelivery(value, deliveryTrusted(value))).rejects.toThrow();
    }
    const wrongTrust = deliveryTrusted(original); wrongTrust.linkAttachmentResolutionId = uuid(99);
    await expect(storeDelivery(original, wrongTrust)).rejects.toThrow(/trusted resolution/i);
    expect((await tenantQuery('SELECT count(*)::integer count FROM public.canonical_automation_delivery_evidence_resolutions_v1 WHERE organization_id=$1 AND unit_id=$2', [TENANT, source.unitId])).rows[0].count).toBe(0);
  });

  test('rejects stale recipient source and superseded permission before a new no-evidence resolution', async () => {
    const stale = await seedContent(120); const staleChannel = await channelValue(stale, 120); await storeChannel(staleChannel);
    const staleLink = await linkValue(stale, staleChannel, 120); await storeLink(staleLink);
    const staleValue = await deliveryValue(stale, staleChannel, staleLink, 120);
    await pool.query(`UPDATE public.users SET email='part7f-corrected@example.test',email_normalized='part7f-corrected@example.test',updated_at=clock_timestamp() WHERE id=$1`, [stale.item.recipientRecordId]);
    await expect(storeDelivery(staleValue)).rejects.toThrow(/delivery evidence authority unavailable/i);
    const superseded = await seedContent(121); const channel = await channelValue(superseded, 121); await storeChannel(channel);
    const link = await linkValue(superseded, channel, 121); await storeLink(link); const oldValue = await deliveryValue(superseded, channel, link, 121);
    const second = await permissionVersion(superseded, superseded.permissionId, 2, superseded.version.permissionDigest); await storeVersion(second);
    await expect(storeDelivery(oldValue)).rejects.toThrow(/delivery evidence authority unavailable/i);
  });

  test('serializes recipient correction and permission append before new no-evidence truth', async () => {
    const sourceRace = await seedContent(130); const sourceChannel = await channelValue(sourceRace, 130); await storeChannel(sourceChannel);
    const sourceLink = await linkValue(sourceRace, sourceChannel, 130); await storeLink(sourceLink);
    const sourceValue = await deliveryValue(sourceRace, sourceChannel, sourceLink, 130); const sourceBlocker = await pool.connect(); let sourceDone = false;
    try {
      await sourceBlocker.query('BEGIN'); await sourceBlocker.query(`UPDATE public.users SET email='part7f-race@example.test',email_normalized='part7f-race@example.test',updated_at=clock_timestamp() WHERE id=$1`, [sourceRace.item.recipientRecordId]);
      const pending = storeDelivery(sourceValue).then(result => ({ result }), error => ({ error })).finally(() => { sourceDone = true; });
      await wait(100); expect(sourceDone).toBe(false); await sourceBlocker.query('COMMIT');
      expect((await pending).error.message).toMatch(/delivery evidence authority unavailable/i);
    } finally { await sourceBlocker.query('ROLLBACK').catch(() => {}); sourceBlocker.release(); }
    const permissionRace = await seedContent(131); const channel = await channelValue(permissionRace, 131); await storeChannel(channel);
    const link = await linkValue(permissionRace, channel, 131); await storeLink(link);
    const permissionValue = await deliveryValue(permissionRace, channel, link, 131); const blocker = await pool.connect(); let permissionDone = false;
    try {
      await blocker.query('BEGIN'); const second = await permissionVersion(permissionRace, permissionRace.permissionId, 2, permissionRace.version.permissionDigest);
      await storeVersion(second, versionTrusted(second), blocker);
      const pending = storeDelivery(permissionValue).then(result => ({ result }), error => ({ error })).finally(() => { permissionDone = true; });
      await wait(100); expect(permissionDone).toBe(false); await blocker.query('COMMIT');
      expect((await pending).error.message).toMatch(/delivery evidence authority unavailable/i);
    } finally { await blocker.query('ROLLBACK').catch(() => {}); blocker.release(); }
  });

  test('rejects replay conflicts, cloned material and cross-tenant reads of no-evidence truth', async () => {
    const source = await seedContent(140); const channel = await channelValue(source, 140); await storeChannel(channel);
    const link = await linkValue(source, channel, 140); await storeLink(link); const value = await deliveryValue(source, channel, link, 140); await storeDelivery(value);
    const conflict = copy(value); conflict.linkAttachmentResolutionId = uuid(920999);
    conflict.requestDigest = canonical.digest('mission28.delivery-evidence-resolution.v1\n', Object.fromEntries(Object.entries(conflict).filter(([key]) => key !== 'requestDigest')));
    await expect(storeDelivery(conflict, deliveryTrusted(conflict))).rejects.toThrow(/replay conflict/i);
    const clone = copy(value); clone.deliveryEvidenceResolutionId = uuid(930141);
    clone.requestDigest = canonical.digest('mission28.delivery-evidence-resolution.v1\n', Object.fromEntries(Object.entries(clone).filter(([key]) => key !== 'requestDigest')));
    await expect(storeDelivery(clone, deliveryTrusted(clone))).rejects.toThrow(/duplicate key|unique/i);
    const client = await pool.connect();
    try {
      await client.query('BEGIN'); await client.query(`SET LOCAL ROLE ${quoteIdentifier(RLS_ROLE)}`);
      await client.query(`SELECT set_config('northstar.automation_tenant_id',$1,TRUE)`, [OTHER]);
      expect((await client.query('SELECT count(*)::integer count FROM public.canonical_automation_delivery_evidence_resolutions_v1')).rows[0].count).toBe(0);
      await client.query('ROLLBACK');
    } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
  });
});
