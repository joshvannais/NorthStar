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
const ACTOR = '00000000-0000-4000-8000-000000000010';
const SESSION = '00000000-0000-4000-8000-000000000011';
const STAFF = '00000000-0000-4000-8000-000000000012';
const STAFF_MEMBERSHIP = '00000000-0000-4000-8000-000000000013';
const PROFILE = '00000000-0000-4000-8000-000000000020';
const POLICY = '00000000-0000-4000-8000-000000000100';
const CUSTOMER = '00000000-0000-4000-8000-000000000200';
const CUSTOMER_TWO = '00000000-0000-4000-8000-000000000201';
const OPPORTUNITY = '00000000-0000-4000-8000-000000000210';
const BILLING_PARTY = '00000000-0000-4000-8000-000000000220';
const BILLING_ORIGIN = '00000000-0000-4000-8000-000000000221';
const BILLING_REVIEW = '00000000-0000-4000-8000-000000000222';
const BILLING_CONTACT = '00000000-0000-4000-8000-000000000223';
const GRANT = '00000000-0000-4000-8000-000000000224';
const POLICY_DIGEST = `sha256:${'1'.repeat(64)}`;
const PROFILE_DIGEST = `sha256:${'2'.repeat(64)}`;
const RLS_ROLE = `m28_part7a_rls_${process.pid}`;
const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const hash = value => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
const copy = value => JSON.parse(JSON.stringify(value));
const quoteIdentifier = value => `"${String(value).replace(/"/g, '""')}"`;

realPostgres('Mission 28 Part 7A PostgreSQL sender and recipient authority through migration 281', () => {
  let database; let pool; let migrations; let operationOne; let operationTwo;
  async function enter(client, tenant = TENANT) { await client.query('SELECT public.canonical_automation_enter_tenant_v1($1)', [tenant]); }
  async function tenantQuery(text, values = [], tenant = TENANT) {
    const client = await pool.connect(); try { await client.query('BEGIN'); await enter(client, tenant); const result = await client.query(text, values); await client.query('COMMIT'); return result; }
    finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
  }
  async function now() { return (await pool.query('SELECT public.canonical_automation_utc_v1(clock_timestamp()) value')).rows[0].value; }
  function trusted(value) { return { tenantId: value.tenantId, transactionId: value.transactionId, unitId: value.unitId, senderBinding: copy(value.senderBinding), recipients: copy(value.recipients), actorBinding: copy(value.actorBinding) }; }
  function reseal(value) { value.requestDigest = canonical.digest('mission28.sender-recipient-resolution.v1\n', Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'requestDigest'))); return value; }
  async function resolve(value, resolution = null, client = pool) {
    if (value.actorBinding.requestedAt === null) value.actorBinding.requestedAt = await now(); reseal(value);
    return (await client.query('SELECT public.canonical_automation_record_sender_recipient_resolution_v1($1,$2::jsonb) result', [canonical.canonicalize(value), JSON.stringify(resolution || trusted(value))])).rows[0].result;
  }
  async function recipient(recipientClass, index = 0) {
    if (recipientClass === 'customer') {
      const row = (await tenantQuery(`SELECT public.canonical_automation_digest_v1('mission28.recipient-source.v1'||chr(10),jsonb_build_object('recipientClass','customer','customerId',c.id,'operationId',c.operation_id,'graphId',c.graph_id,'updatedAt',public.canonical_automation_utc_v1(c.updated_at),'customerSourceDigest','sha256:'||public.canonical_customer_financial_billing_identity_v1_source_digest(c))) source,
       public.canonical_automation_digest_v1('mission28.recipient-contact.v1'||chr(10),jsonb_build_object('email',c.email,'phone',c.phone)) contact
       FROM public.canonical_customers c WHERE organization_id=$1 AND id=$2`, [TENANT, CUSTOMER])).rows[0];
      return { recipientIndex: index, recipientClass, recipientRecordId: CUSTOMER, parentCustomerId: CUSTOMER, membershipId: null, role: null, sourceDigest: row.source, contactIdentityDigest: row.contact };
    }
    if (recipientClass === 'authorized_billing_contact') {
      const row = (await tenantQuery(`SELECT public.canonical_automation_digest_v1('mission28.recipient-source.v1'||chr(10),jsonb_build_object('recipientClass','authorized_billing_contact','billingContactId',r.billing_contact_id,'customerId',r.customer_id,'billingPartyId',r.billing_party_id,'reviewId',r.id,'reviewSequence',r.sequence,'reviewDigest','sha256:'||rtrim(r.reviewed_snapshot_digest))) source,
       public.canonical_automation_digest_v1('mission28.recipient-contact.v1'||chr(10),jsonb_build_object('email',CASE WHEN r.reviewed_snapshot#>>'{billingContact,email,state}'='reviewed' THEN r.reviewed_snapshot#>'{billingContact,email,value}' ELSE 'null'::jsonb END,'phone',CASE WHEN r.reviewed_snapshot#>>'{billingContact,phone,state}'='reviewed' THEN r.reviewed_snapshot#>'{billingContact,phone,value}' ELSE 'null'::jsonb END)) contact
       FROM public.canonical_customer_financial_billing_identity_reviews_v1 r WHERE organization_id=$1 AND id=$2`, [TENANT, BILLING_REVIEW])).rows[0];
      return { recipientIndex: index, recipientClass, recipientRecordId: BILLING_CONTACT, parentCustomerId: CUSTOMER, membershipId: null, role: null, sourceDigest: row.source, contactIdentityDigest: row.contact };
    }
    if (recipientClass === 'lead_or_prospect') {
      const row = (await tenantQuery(`SELECT public.canonical_automation_digest_v1('mission28.recipient-source.v1'||chr(10),jsonb_build_object('recipientClass','lead_or_prospect','opportunityId',o.id,'customerId',c.id,'operationId',o.operation_id,'graphId',o.graph_id,'status',o.status,'updatedAt',public.canonical_automation_utc_v1(o.updated_at),'customerSourceDigest','sha256:'||public.canonical_customer_financial_billing_identity_v1_source_digest(c))) source,
       public.canonical_automation_digest_v1('mission28.recipient-contact.v1'||chr(10),jsonb_build_object('email',c.email,'phone',c.phone)) contact
       FROM public.canonical_opportunities o JOIN public.canonical_customers c ON c.organization_id=o.organization_id AND c.id=o.customer_id WHERE o.organization_id=$1 AND o.id=$2`, [TENANT, OPPORTUNITY])).rows[0];
      return { recipientIndex: index, recipientClass, recipientRecordId: OPPORTUNITY, parentCustomerId: CUSTOMER_TWO, membershipId: null, role: null, sourceDigest: row.source, contactIdentityDigest: row.contact };
    }
    const row = (await tenantQuery(`SELECT public.canonical_automation_digest_v1('mission28.recipient-source.v1'||chr(10),jsonb_build_object('recipientClass','staff_member','userId',u.id,'membershipId',m.id,'role',m.role,'userUpdatedAt',public.canonical_automation_utc_v1(u.updated_at),'membershipUpdatedAt',public.canonical_automation_utc_v1(m.updated_at))) source,
     public.canonical_automation_digest_v1('mission28.recipient-contact.v1'||chr(10),jsonb_build_object('email',u.email_normalized,'phone',u.phone)) contact
     FROM public.users u JOIN public.organization_memberships m ON m.organization_id=u.organization_id AND m.user_id=u.id WHERE u.organization_id=$1 AND u.id=$2 AND m.id=$3`, [TENANT, STAFF, STAFF_MEMBERSHIP])).rows[0];
    return { recipientIndex: index, recipientClass, recipientRecordId: STAFF, parentCustomerId: null, membershipId: STAFF_MEMBERSHIP, role: 'member', sourceDigest: row.source, contactIdentityDigest: row.contact };
  }
  async function seedUnit(suffix, recipients) {
    const transactionId = uuid(10000 + suffix); const runId = uuid(11000 + suffix); const unitId = uuid(12000 + suffix);
    const recipientSetDigest = canonical.digest('mission28.recipient-set.v1\n', recipients);
    const document = { tenantId: TENANT, transactionId, runId, policyBinding: { policyId: POLICY, policyVersion: 1, policyDigest: POLICY_DIGEST }, sourceBinding: { sourceSetDigest: hash('source-set'), snapshotIds: [], snapshotDigests: [] }, actionUnits: [{ unitId }], requestDigest: hash(`transaction-${suffix}`) };
    await tenantQuery(`INSERT INTO public.canonical_automation_action_transactions_v1
      (organization_id,transaction_id,run_id,policy_id,policy_version,policy_digest,source_set_digest,decision_digest,authorization_digest,currentness_digest,request_digest,unit_count,canonical_text,document,retention_class,trusted_clock_contract,recorded_time_zone,recorded_at)
      VALUES($1,$2,$3,$4,1,$5,$6,$7,$8,$9,$10,1,$11::text,$11::jsonb,'decision_history','postgresql_statement_timestamp_v1','UTC',statement_timestamp())`,
      [TENANT, transactionId, runId, POLICY, POLICY_DIGEST, hash('source-set'), hash(`decision-${suffix}`), hash(`authorization-${suffix}`), hash(`currentness-${suffix}`), document.requestDigest, canonical.canonicalize(document)]);
    await tenantQuery(`INSERT INTO public.canonical_automation_action_units_v1
      (organization_id,transaction_id,unit_id,run_id,unit_index,action_family_id,action_template_id,action_template_digest,recipient_set_digest,channel_id,provider_mode,effect_class,material_digest,idempotency_key_digest,unit_digest,state,recorded_at)
      VALUES($1,$2,$3,$4,0,'internal_read_digest_task','internal_fact_digest_v1',$5,$6,'in_app_passive','provider_disabled','internal_record_only',$7,$8,$9,'committed_unpublished',statement_timestamp())`,
      [TENANT, transactionId, unitId, runId, hash(`template-${suffix}`), recipientSetDigest, hash(`material-${suffix}`), hash(`idempotency-${suffix}`), hash(`unit-${suffix}`)]);
    return { transactionId, runId, unitId, recipientSetDigest };
  }
  async function requestFor(suffix, recipients) {
    const unit = await seedUnit(suffix, recipients);
    return reseal({ schemaVersion: 'mission28.sender-recipient-resolution.v1', tenantId: TENANT, resolutionId: uuid(700000 + suffix), transactionId: unit.transactionId, unitId: unit.unitId,
      senderBinding: { senderClass: 'tenant_business_profile', businessProfileId: PROFILE, businessProfileVersion: 1, businessProfileDigest: PROFILE_DIGEST }, recipients,
      actorBinding: { actorId: ACTOR, sessionId: SESSION, membershipId: ACTOR, membershipRole: 'owner', requestedAt: null }, requestDigest: '' });
  }

  beforeAll(async () => {
    database = await createSuiteDatabase('m28-p7a-recipient'); pool = new Pool({ connectionString: database.connectionString, max: 6 });
    migrations = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m28-p7a-through281-'));
    for (const name of fs.readdirSync(path.join(ROOT, 'migrations')).filter(name => /^\d+.*\.sql$/.test(name) && Number(name.slice(0, 3)) <= 281)) fs.copyFileSync(path.join(ROOT, 'migrations', name), path.join(migrations, name));
    const db = require('../../src/db'); await db.runMigrations({ pool, migrationsDirectory: migrations });
    await pool.query(`INSERT INTO public.organizations(id,name,email) VALUES($1,'Part 7A tenant','part7a@example.test'),($2,'Part 7A other','part7a-other@example.test')`, [TENANT, OTHER]);
    await pool.query(`INSERT INTO public.users(id,organization_id,name,email,password_hash,role,status,phone) VALUES
      ($1,$3,'Part 7A owner','part7a-owner@example.test','unused','owner','active','+12025550100'),
      ($2,$3,'Part 7A staff','part7a-staff@example.test','unused','member','active','+12025550101')`, [ACTOR, STAFF, TENANT]);
    await pool.query(`INSERT INTO public.organization_memberships(id,organization_id,user_id,role,status) VALUES($1,$3,$1,'owner','active'),($2,$3,$4,'member','active')`, [ACTOR, STAFF_MEMBERSHIP, TENANT, STAFF]);
    await pool.query(`INSERT INTO public.auth_sessions(id,user_id,organization_id,membership_id,status,access_expires_at,refresh_expires_at,csrf_token_hash) VALUES($1,$2,$3,$2,'active',NOW()+INTERVAL '1 hour',NOW()+INTERVAL '2 hours',$4)`, [SESSION, ACTOR, TENANT, '1'.repeat(64)]);
    await pool.query(`INSERT INTO public.canonical_business_profiles(id,organization_id,version_number,version_label,raw_profile,normalized_profile,normalized_profile_hash,is_active,created_by) VALUES($1,$2,1,'part7a','{}','{}',$3,TRUE,$4)`, [PROFILE, TENANT, PROFILE_DIGEST.slice(7), ACTOR]);
    await pool.query(`INSERT INTO public.organization_onboarding(organization_id,status,active_business_profile_id,completed_at) VALUES($1,'complete',$2,NOW())`, [TENANT, PROFILE]);
    operationOne = uuid(300); operationTwo = uuid(301); const graphOne = uuid(310); const graphTwo = uuid(311);
    await pool.query(`INSERT INTO public.canonical_operations(id,organization_id,graph_id,idempotency_key_hash,payload_fingerprint,state,lease_owner,lease_expires_at) VALUES
      ($1,$3,$4,$5,$6,'claimed',$7,NOW()+INTERVAL '1 hour'),($2,$3,$8,$9,$10,'claimed',$11,NOW()+INTERVAL '1 hour')`, [operationOne, operationTwo, TENANT, graphOne, 'a'.repeat(64), 'b'.repeat(64), uuid(320), graphTwo, 'c'.repeat(64), 'd'.repeat(64), uuid(321)]);
    await pool.query(`INSERT INTO public.canonical_customers(id,organization_id,operation_id,graph_id,name,email,phone,address) VALUES
      ($1,$3,$4,$5,'Customer One','customer1@example.test','+12025550102','{}'),
      ($2,$3,$6,$7,'Customer Two','customer2@example.test','+12025550103','{}')`, [CUSTOMER, CUSTOMER_TWO, TENANT, operationOne, graphOne, operationTwo, graphTwo]);
    await pool.query(`INSERT INTO public.canonical_opportunities(id,organization_id,operation_id,graph_id,customer_id,status) VALUES($1,$2,$3,$4,$5,'open')`, [OPPORTUNITY, TENANT, operationTwo, graphTwo, CUSTOMER_TWO]);
    await pool.query(`INSERT INTO public.canonical_customer_financial_billing_capability_grants_v1 VALUES($1,$2,1,$3,$3,$4,'customer_financial.billing_identity.review','customer_financial.billing_identity','mission27.launch.v1','m27.owner.v1',TRUE,NOW()-INTERVAL '1 hour',NOW()+INTERVAL '1 hour',NOW())`, [TENANT, GRANT, ACTOR, CUSTOMER]);
    await pool.query(`INSERT INTO public.canonical_customer_financial_billing_parties_v1 VALUES($1,$2,$3,NOW(),
      (SELECT updated_at FROM public.canonical_customers WHERE organization_id=$1 AND id=$3),
      (SELECT public.canonical_customer_financial_billing_identity_v1_source_digest(c) FROM public.canonical_customers c WHERE c.organization_id=$1 AND c.id=$3),
      $4,'owner',$4,$5,$6,1,'customer_financial.billing_identity','mission27.launch.v1','Exact reviewed billing party')`, [TENANT, BILLING_PARTY, CUSTOMER, ACTOR, SESSION, GRANT]);
    const origin = { version: 'm27-billing-identity-origin-v1', organizationId: TENANT, billingPartyId: BILLING_PARTY, customer: { id: CUSTOMER }, reviewState: 'unreviewed', documentUseAuthorized: false, automaticCustomerCreationAuthorized: false };
    const originDigest = (await pool.query('SELECT public.canonical_completion_digest($1::jsonb) digest', [JSON.stringify(origin)])).rows[0].digest;
    await pool.query(`INSERT INTO public.canonical_customer_financial_billing_identity_snapshots_v1
      (organization_id,id,billing_party_id,customer_id,sequence,snapshot_kind,captured_at,source_customer_updated_at,source_customer_digest,snapshot,snapshot_digest,captured_by_user_id,captured_by_access_role,membership_id,auth_session_id,capability_grant_id,capability_grant_revision,business_purpose,policy_version)
      VALUES($1,$2,$3,$4,1,'party_origin_unreviewed',NOW(),
      (SELECT updated_at FROM public.canonical_customers WHERE organization_id=$1 AND id=$4),
      (SELECT public.canonical_customer_financial_billing_identity_v1_source_digest(c) FROM public.canonical_customers c WHERE c.organization_id=$1 AND c.id=$4),
      $5::jsonb,$6,$7,'owner',$7,$8,$9,1,'customer_financial.billing_identity','mission27.launch.v1')`, [TENANT, BILLING_ORIGIN, BILLING_PARTY, CUSTOMER, JSON.stringify(origin), originDigest, ACTOR, SESSION, GRANT]);
    const review = { version: 'm27-billing-identity-review-v1', organizationId: TENANT, billingPartyId: BILLING_PARTY, customerId: CUSTOMER, reviewId: BILLING_REVIEW, sequence: 1, previousReviewId: null, previousReviewDigest: null,
      origin: { snapshotId: BILLING_ORIGIN, snapshotDigest: originDigest }, customerIdentity: { kind: 'canonical_customer', id: CUSTOMER }, prospectIdentity: { state: 'unavailable', value: null, reason: 'canonical_prospect_source_unavailable' },
      billingContact: { id: BILLING_CONTACT, name: { state: 'reviewed', value: 'Billing Contact' }, email: { state: 'reviewed', value: 'billing@example.test' }, phone: { state: 'not_supplied', value: null } },
      reviewState: 'reviewed', documentUseAuthorized: true, automaticCustomerCreationAuthorized: false };
    const reviewDigest = (await pool.query('SELECT public.canonical_completion_digest($1::jsonb) digest', [JSON.stringify(review)])).rows[0].digest;
    await pool.query(`INSERT INTO public.canonical_customer_financial_billing_identity_reviews_v1
      (organization_id,id,billing_party_id,customer_id,sequence,previous_review_id,origin_snapshot_id,origin_snapshot_digest,source_customer_updated_at,source_customer_digest,billing_contact_id,service_address_id,billing_address_id,reviewed_snapshot,reviewed_snapshot_digest,reviewed_by_user_id,reviewed_by_access_role,membership_id,auth_session_id,capability_grant_id,capability_grant_revision,business_purpose,policy_version,correction_reason,reviewed_at)
      VALUES($1,$2,$3,$4,1,NULL,$5,$6,
      (SELECT updated_at FROM public.canonical_customers WHERE organization_id=$1 AND id=$4),
      (SELECT public.canonical_customer_financial_billing_identity_v1_source_digest(c) FROM public.canonical_customers c WHERE c.organization_id=$1 AND c.id=$4),
      $7,$8,$9,$10::jsonb,$11,$12,'owner',$12,$13,$14,1,'customer_financial.billing_identity','mission27.launch.v1','Initial exact billing contact review',NOW())`,
      [TENANT, BILLING_REVIEW, BILLING_PARTY, CUSTOMER, BILLING_ORIGIN, originDigest, BILLING_CONTACT, uuid(225), uuid(226), JSON.stringify(review), reviewDigest, ACTOR, SESSION, GRANT]);
    const billingAuthority = (await pool.query(`SELECT
      r.sequence=(SELECT max(latest.sequence) FROM public.canonical_customer_financial_billing_identity_reviews_v1 latest WHERE latest.organization_id=r.organization_id AND latest.billing_party_id=r.billing_party_id) latest,
      r.source_customer_digest=public.canonical_customer_financial_billing_identity_v1_source_digest(c) source_digest,
      r.source_customer_updated_at=c.updated_at source_time,
      r.reviewed_snapshot->>'reviewState'='reviewed' review_state,
      r.reviewed_snapshot->'documentUseAuthorized'='true'::jsonb document_authorized,
      r.reviewed_snapshot#>>'{billingContact,email,state}'='reviewed' email_reviewed
      FROM public.canonical_customer_financial_billing_identity_reviews_v1 r
      JOIN public.canonical_customers c ON c.organization_id=r.organization_id AND c.id=r.customer_id
      WHERE r.organization_id=$1 AND r.id=$2`, [TENANT, BILLING_REVIEW])).rows[0];
    expect(billingAuthority).toEqual({ latest: true, source_digest: true, source_time: true, review_state: true, document_authorized: true, email_reviewed: true });
    const policyDocument = { tenantId: TENANT, policyId: POLICY, version: 1, canonicalDigest: POLICY_DIGEST, previousVersionDigest: null };
    await tenantQuery(`INSERT INTO public.canonical_automation_policy_versions_v1 (organization_id,policy_id,version,previous_version_digest,canonical_digest,canonical_text,document,expires_at,source_origin,retention_class,trusted_clock_contract,recorded_time_zone,recorded_at) VALUES($1,$2,1,NULL,$3,$4::text,$4::jsonb,NOW()+INTERVAL '2 years','mission28_native','policy_history','postgresql_statement_timestamp_v1','UTC',statement_timestamp())`, [TENANT, POLICY, POLICY_DIGEST, canonical.canonicalize(policyDocument)]);
    await pool.query(`CREATE ROLE ${quoteIdentifier(RLS_ROLE)} NOLOGIN`);
    await pool.query(`GRANT SELECT ON public.canonical_automation_sender_recipient_resolutions_v1,public.canonical_automation_recipient_authority_items_v1 TO ${quoteIdentifier(RLS_ROLE)}`);
  }, 300000);

  afterAll(async () => {
    if (pool) { await pool.query(`REVOKE ALL ON public.canonical_automation_sender_recipient_resolutions_v1,public.canonical_automation_recipient_authority_items_v1 FROM ${quoteIdentifier(RLS_ROLE)}`).catch(() => {}); await pool.query(`DROP ROLE IF EXISTS ${quoteIdentifier(RLS_ROLE)}`).catch(() => {}); await pool.end(); }
    if (database) await database.cleanup(); if (migrations && path.dirname(migrations) === os.tmpdir()) fs.rmSync(migrations, { recursive: true, force: true });
  }, 180000);

  test('migration 281 is additive, owner-only, forced-RLS, immutable and has no runtime grant', async () => {
    expect((await pool.query('SELECT max(substring(filename,1,3)::integer) latest,count(*)::integer total FROM public._migrations')).rows[0]).toEqual({ latest: 281, total: 277 });
    const rows = (await pool.query(`SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=ANY($1::text[]) ORDER BY relname`, [['canonical_automation_sender_recipient_resolutions_v1','canonical_automation_recipient_authority_items_v1']])).rows;
    expect(rows).toHaveLength(2); expect(rows.every(row => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
    expect((await pool.query(`SELECT has_function_privilege('public','public.canonical_automation_record_sender_recipient_resolution_v1(text,jsonb)','EXECUTE') allowed`)).rows[0].allowed).toBe(false);
  });

  test('stores the complete closed recipient set with no raw contact or effect data and replays immutably', async () => {
    const recipients = await Promise.all(['customer','authorized_billing_contact','lead_or_prospect','staff_member'].map((item, index) => recipient(item, index)));
    const value = await requestFor(1, recipients); const first = await resolve(value);
    expect(first).toEqual(expect.objectContaining({ recipientCount: 4, recipientSetDigest: canonical.digest('mission28.recipient-set.v1\n', recipients), replayed: false, effectCreated: false }));
    expect(await resolve(copy(value))).toEqual(expect.objectContaining({ resolutionDigest: first.resolutionDigest, replayed: true, effectCreated: false }));
    const stored = (await tenantQuery(`SELECT recipient_index,recipient_class,recipient_record_id,parent_customer_id,membership_id,role,source_digest,contact_identity_digest FROM public.canonical_automation_recipient_authority_items_v1 WHERE organization_id=$1 AND resolution_id=$2 ORDER BY recipient_index`, [TENANT, value.resolutionId])).rows;
    expect(stored.map(item => item.recipient_class)).toEqual(['customer','authorized_billing_contact','lead_or_prospect','staff_member']);
    const serialized = JSON.stringify(stored); for (const privateValue of ['customer1@example.test','billing@example.test','part7a-staff@example.test','+12025550102']) expect(serialized).not.toContain(privateValue);
  });

  test('denies cross-customer, changed source, inactive staff and trusted substitution with zero residue', async () => {
    const billing = await recipient('authorized_billing_contact'); const cross = await requestFor(2, [{ ...billing, parentCustomerId: CUSTOMER_TWO }]);
    await expect(resolve(cross)).rejects.toThrow(/reviewed billing contact unavailable/i);
    const customer = await recipient('customer'); const changed = await requestFor(3, [customer]); await pool.query(`UPDATE public.canonical_customers SET email='corrected@example.test',updated_at=clock_timestamp() WHERE id=$1`, [CUSTOMER]);
    try { await expect(resolve(changed)).rejects.toThrow(/source changed or substituted/i); }
    finally { await pool.query(`UPDATE public.canonical_customers SET email='customer1@example.test',updated_at=(SELECT source_customer_updated_at FROM public.canonical_customer_financial_billing_identity_reviews_v1 WHERE id=$2) WHERE id=$1`, [CUSTOMER, BILLING_REVIEW]); }
    const staff = await recipient('staff_member'); const inactive = await requestFor(4, [staff]); await pool.query(`UPDATE public.users SET status='suspended' WHERE id=$1`, [STAFF]);
    try { await expect(resolve(inactive)).rejects.toThrow(/staff recipient unavailable/i); }
    finally { await pool.query(`UPDATE public.users SET status='active' WHERE id=$1`, [STAFF]); }
    const valid = await requestFor(5, [await recipient('staff_member')]); const substituted = trusted(valid); substituted.unitId = uuid(999999); await expect(resolve(valid, substituted)).rejects.toThrow(/trusted resolution/i);
    const ids = [cross.resolutionId, changed.resolutionId, inactive.resolutionId, valid.resolutionId];
    expect((await tenantQuery(`SELECT count(*)::integer count FROM public.canonical_automation_sender_recipient_resolutions_v1 WHERE organization_id=$1 AND resolution_id=ANY($2::uuid[])`, [TENANT, ids])).rows[0].count).toBe(0);
  });

  test('denies unsupported/free-form shapes, duplicate contact identity and action-unit set substitution before storage', async () => {
    const customer = await recipient('customer'); const malformed = await requestFor(6, [{ ...customer, recipientClass: 'collection_agency_legal_credit_or_other_external' }]);
    await expect(resolve(malformed)).rejects.toThrow(/recipient shape invalid/i);
    const freeForm = await requestFor(7, [{ ...customer, email: 'attacker@example.test' }]); await expect(resolve(freeForm)).rejects.toThrow(/recipient shape invalid/i);
    const duplicateA = await recipient('customer', 0); const duplicateB = { ...(await recipient('lead_or_prospect', 1)), contactIdentityDigest: duplicateA.contactIdentityDigest };
    const duplicate = await requestFor(8, [duplicateA, duplicateB]); await expect(resolve(duplicate)).rejects.toThrow(/source changed or substituted|ambiguous or duplicate/i);
    await pool.query(`UPDATE public.canonical_customers SET email='customer1@example.test',phone='+12025550102' WHERE id=$1`, [CUSTOMER_TWO]);
    try {
      const exactReuseRecipients = [await recipient('customer', 0), await recipient('lead_or_prospect', 1)];
      expect(exactReuseRecipients[0].contactIdentityDigest).toBe(exactReuseRecipients[1].contactIdentityDigest);
      const exactReuse = await requestFor(81, exactReuseRecipients); await expect(resolve(exactReuse)).rejects.toThrow(/ambiguous or duplicate/i);
    } finally {
      await pool.query(`UPDATE public.canonical_customers SET email='customer2@example.test',phone='+12025550103' WHERE id=$1`, [CUSTOMER_TWO]);
    }
    const unitMismatchRecipients = [await recipient('staff_member')]; const mismatch = await requestFor(9, unitMismatchRecipients); mismatch.actorBinding.requestedAt = await now(); mismatch.recipients[0].sourceDigest = hash('forged'); reseal(mismatch);
    await expect(resolve(mismatch, trusted(mismatch))).rejects.toThrow(/source changed or substituted/i);
  });

  test('denies stale billing review after an append-only correction and preserves cross-tenant RLS', async () => {
    const billing = await recipient('authorized_billing_contact'); const value = await requestFor(10, [billing]);
    const secondReview = uuid(229); const secondContact = uuid(230); const source = (await pool.query(`SELECT source_customer_updated_at,source_customer_digest,reviewed_snapshot,reviewed_snapshot_digest FROM public.canonical_customer_financial_billing_identity_reviews_v1 WHERE id=$1`, [BILLING_REVIEW])).rows[0];
    const corrected = copy(source.reviewed_snapshot); corrected.reviewId = secondReview; corrected.sequence = 2; corrected.previousReviewId = BILLING_REVIEW; corrected.previousReviewDigest = source.reviewed_snapshot_digest.trim(); corrected.billingContact.id = secondContact; corrected.billingContact.email.value = 'billing-corrected@example.test';
    const correctedDigest = (await pool.query('SELECT public.canonical_completion_digest($1::jsonb) digest', [JSON.stringify(corrected)])).rows[0].digest;
    await pool.query(`INSERT INTO public.canonical_customer_financial_billing_identity_reviews_v1
      (organization_id,id,billing_party_id,customer_id,sequence,previous_review_id,origin_snapshot_id,origin_snapshot_digest,source_customer_updated_at,source_customer_digest,billing_contact_id,service_address_id,billing_address_id,reviewed_snapshot,reviewed_snapshot_digest,reviewed_by_user_id,reviewed_by_access_role,membership_id,auth_session_id,capability_grant_id,capability_grant_revision,business_purpose,policy_version,correction_reason,reviewed_at)
      SELECT organization_id,$2,billing_party_id,customer_id,2,id,origin_snapshot_id,origin_snapshot_digest,source_customer_updated_at,source_customer_digest,$3,service_address_id,billing_address_id,$4::jsonb,$5,reviewed_by_user_id,reviewed_by_access_role,membership_id,auth_session_id,capability_grant_id,capability_grant_revision,business_purpose,policy_version,'Corrected exact billing contact authority',NOW() FROM public.canonical_customer_financial_billing_identity_reviews_v1 WHERE id=$1`, [BILLING_REVIEW, secondReview, secondContact, JSON.stringify(corrected), correctedDigest]);
    await expect(resolve(value)).rejects.toThrow(/reviewed billing contact unavailable/i);
    const client = await pool.connect(); try { await client.query('BEGIN'); await client.query(`SET LOCAL ROLE ${quoteIdentifier(RLS_ROLE)}`); await client.query(`SELECT set_config('northstar.automation_tenant_id',$1,TRUE)`, [OTHER]); expect((await client.query('SELECT count(*)::integer count FROM public.canonical_automation_sender_recipient_resolutions_v1')).rows[0].count).toBe(0); await client.query('ROLLBACK'); } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
  });
});
