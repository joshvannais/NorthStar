'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createEstimateReviewFixture } = require('../helpers/m24-estimate-review-fixture');
const commercial = require('../../src/estimating/commercialContract');
const { fixture: commercialFixture, group } = require('../helpers/m24-commercial-input');
const { fixture: pricingFixture } = require('../helpers/m24-pricing-input');
const canonical = require('../../src/automation/canonicalJson');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const copy = value => JSON.parse(JSON.stringify(value));
const hash = value => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;

realPostgres('Mission 28 Part 8A PostgreSQL exact approved estimate no-effect resolution through migration 287', () => {
  let f; let actor; let estimate; let customer; let version; let terms; let approval; let transactionId; let unitId; let authorizationBinding;
  const ok = (response, status, label) => { expect(response.status).toBe(status); if (response.status !== status) throw new Error(`${label}: ${response.status} ${JSON.stringify(response.body)}`); return response.body.data; };
  const get = suffix => request(f.app).get(`/api/v1/canonical/estimates/${estimate}${suffix}`).set(actor.session.headers);
  const post = (suffix, body) => request(f.app).post(`/api/v1/canonical/estimates/${estimate}${suffix}`).set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID()).send(body);
  async function now() { return (await f.ownerPool.query('SELECT public.canonical_automation_utc_v1(clock_timestamp()) value')).rows[0].value; }

  async function issueCurrentVersion() {
    ok(await request(f.app).post('/api/v1/forecast/price-history/ordered-snapshots').set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID()).send({}), 201, 'price snapshot');
    ok(await request(f.app).post('/api/v1/forecast/price-history/ordered-anchor/activate').set(actor.session.headers).send({}), 200, 'price anchor');
    let review=ok(await get('/review'),200,'review');
    ok(await post('/pricing-plans',{action:'save',expectedRevision:0,expectedDigest:'none',sourcePins:review.pins,
      expectedDecisionRevision:review.decisions.writeBasis.revision,expectedDecisionDigest:review.decisions.writeBasis.digest,
      inputs:pricingFixture(review.pricingPlans.serviceKey),currency:review.currency,reason:'Synthetic Part 8A pricing source',confirmed:true,
      confirmationVersion:review.pricingPlans.contract,evidenceDigest:review.pricingPlans.sources.digest}),201,'pricing');
    review=ok(await get('/review'),200,'review after pricing'); const inputs=commercialFixture().value; inputs.version=review.commercialTerms.contract;
    inputs.jobApplicability={serviceOperation:'fence_installation',propertyUse:'residential',workContext:'new_construction',customerExemption:'none',
      evidenceRef:{serviceOperation:'Reviewed scope',propertyUse:'Recorded property',workContext:'Reviewed scope',customerExemption:'Customer statement'}};
    inputs.transactionDate=review.commercialTerms.sources.asOfDate; inputs.taxGroups=[group(['installation'],{behavior:'exclusive'})];
    inputs.taxGroups[0].source.serviceKey=review.commercialTerms.sources.serviceKey;
    Object.assign(inputs.taxGroups[0].source,{legalEffectiveOn:inputs.taxGroups[0].source.effectiveOn,legalEndsOn:null,
      reviewedOn:review.commercialTerms.sources.asOfDate,reviewValidThrough:review.commercialTerms.sources.asOfDate});
    delete inputs.taxGroups[0].source.effectiveOn; delete inputs.taxGroups[0].source.endsOn;
    ok(await post('/commercial-terms',{action:'save',expectedRevision:0,expectedDigest:'none',sourcePins:review.pins,
      expectedDecisionRevision:review.commercialTerms.decisionBasis.revision,expectedDecisionDigest:review.commercialTerms.decisionBasis.digest,
      inputs,currency:review.currency,reason:'Synthetic Part 8A commercial terms',confirmed:true,
      confirmationVersion:review.commercialTerms.contract,evidenceDigest:review.commercialTerms.sources.digest}),201,'terms');
    review=ok(await get('/review'),200,'review after terms');
    ok(await post('/commercial-approvals',{termsPin:commercial.pin(review.commercialTerms.current),evidenceDigest:review.commercialTerms.sources.digest,
      expectedDecisionRevision:review.commercialTerms.decisionBasis.revision,expectedDecisionDigest:review.commercialTerms.decisionBasis.digest,
      scopeSummary:'Install the exact reviewed cedar fence.',reason:'Owner approved exact Part 8A commercial scope',confirmed:true,
      confirmationVersion:review.commercialTerms.contract,exceptions:{policyReason:'',policyUnknownAcknowledged:true,ownerRecordedTaxAcknowledged:true}}),201,'approval');
    const issued=ok(await post('/customer-estimate-versions',{reason:'Owner issued exact Part 8A customer-safe version',confirmed:true,
      confirmationVersion:'customer-estimate-issue-v1'}),201,'issue');
    version=(await f.ownerPool.query('SELECT * FROM canonical_customer_estimate_versions WHERE organization_id=$1 AND id=$2',[f.org,issued.receipt.id])).rows[0];
    terms=(await f.ownerPool.query('SELECT * FROM canonical_commercial_terms WHERE organization_id=$1 AND id=$2',[f.org,version.terms_id])).rows[0];
    approval=(await f.ownerPool.query('SELECT * FROM canonical_commercial_approvals WHERE organization_id=$1 AND id=$2',[f.org,version.commercial_approval_id])).rows[0];
  }

  async function seedActionAuthority() {
    const policyId=uuid(100); transactionId=uuid(820001); unitId=uuid(820002); const runId=uuid(820003);
    authorizationBinding={authorizationId:uuid(820004),authorizationKind:'per_run_approval',authorizationRecordDigest:hash('part8a-auth'),authorizationMaterialBindingDigest:hash('part8a-material')};
    const policyDocument={tenantId:f.org,policyId,version:1};
    const client=await f.ownerPool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT public.canonical_automation_enter_tenant_v1($1)', [f.org]);
      await client.query(`INSERT INTO public.canonical_automation_policy_versions_v1
      (organization_id,policy_id,version,canonical_digest,canonical_text,document,expires_at,source_origin,retention_class,trusted_clock_contract,recorded_time_zone,recorded_at)
      VALUES($1,$2,1,$3,$4::text,$4::jsonb,NOW()+INTERVAL '1 year','mission28_native','policy_history','postgresql_statement_timestamp_v1','UTC',statement_timestamp())`,
      [f.org,policyId,hash('part8a-policy'),canonical.canonicalize(policyDocument)]);
      const doc={tenantId:f.org,transactionId,runId,policyBinding:{policyId,policyVersion:1,policyDigest:hash('part8a-policy')},
        sourceBinding:{sourceSetDigest:hash('part8a-source'),snapshotIds:[],snapshotDigests:[]},authorizationBinding,actionUnits:[{unitId}],requestDigest:hash('part8a-transaction')};
      await client.query(`INSERT INTO public.canonical_automation_action_transactions_v1
      (organization_id,transaction_id,run_id,policy_id,policy_version,policy_digest,source_set_digest,decision_digest,authorization_digest,currentness_digest,request_digest,unit_count,canonical_text,document,retention_class,trusted_clock_contract,recorded_time_zone,recorded_at)
      VALUES($1,$2,$3,$4,1,$5,$6,$7,$8,$9,$10,1,$11::text,$11::jsonb,'decision_history','postgresql_statement_timestamp_v1','UTC',statement_timestamp())`,
      [f.org,transactionId,runId,policyId,hash('part8a-policy'),doc.sourceBinding.sourceSetDigest,hash('part8a-decision'),
        canonical.digest('mission28.authorization-binding.v1\n',authorizationBinding),hash('part8a-current'),doc.requestDigest,canonical.canonicalize(doc)]);
      await client.query(`INSERT INTO public.canonical_automation_action_units_v1
      (organization_id,transaction_id,unit_id,run_id,unit_index,action_family_id,action_template_id,action_template_digest,recipient_set_digest,channel_id,provider_mode,effect_class,material_digest,idempotency_key_digest,unit_digest,state,recorded_at)
      VALUES($1,$2,$3,$4,0,'owner_approval_request','owner_approval_request_v1',$5,$6,'in_app_passive','provider_disabled','internal_record_only',$7,$8,$9,'committed_unpublished',statement_timestamp())`,
      [f.org,transactionId,unitId,runId,hash('part8a-template'),hash('part8a-recipient'),hash('part8a-unit-material'),hash('part8a-unit-idempotency'),hash('part8a-unit')]);
      await client.query('COMMIT');
    } catch(error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  function build(suffix=1) {
    const value={schemaVersion:'mission28.estimate-quote-resolution.v1',tenantId:f.org,estimateQuoteResolutionId:uuid(830000+suffix),transactionId,unitId,
      estimateBinding:{estimateId:estimate,customerEstimateVersionId:version.id,revision:Number(version.revision),customerEstimateVersionDigest:`sha256:${version.digest.trim()}`,
        documentDigest:`sha256:${version.document_digest.trim()}`,commercialApprovalId:approval.id,commercialApprovalDigest:`sha256:${approval.digest.trim()}`,
        termsId:terms.id,termsDigest:`sha256:${terms.digest.trim()}`,decisionId:approval.decision_id,decisionDigest:`sha256:${approval.decision_pin.digest}`},
      authorizationBinding:copy(authorizationBinding),requestedChannelId:'email',requestedProfileId:'current_launch_exact_document_external_delivery_unavailable',
      actorBinding:{actorId:actor.actorUserId,sessionId:actor.authSessionId,membershipId:actor.actorUserId,membershipRole:'owner'},evaluatedAt:null,requestDigest:''};
    return now().then(time=>{value.evaluatedAt=time;value.requestDigest=canonical.digest('mission28.estimate-quote-resolution.v1\n',Object.fromEntries(Object.entries(value).filter(([key])=>key!=='requestDigest')));return value;});
  }
  const trusted=value=>Object.fromEntries(['tenantId','transactionId','unitId','estimateBinding','authorizationBinding','requestedChannelId','requestedProfileId','actorBinding','evaluatedAt'].map(key=>[key,copy(value[key])]));
  async function store(value,trust=trusted(value)){
    const client=await f.ownerPool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const result=(await client.query('SELECT public.canonical_automation_record_estimate_quote_resolution_v1($1,$2::jsonb) result',[canonical.canonicalize(value),JSON.stringify(trust)])).rows[0].result;
      await client.query('COMMIT'); return result;
    } catch(error) { await client.query('ROLLBACK').catch(()=>{}); throw error; }
    finally { client.release(); }
  }
  async function tenantQuery(sql,params=[]){
    const client=await f.ownerPool.connect();
    try { await client.query('BEGIN'); await client.query('SELECT public.canonical_automation_enter_tenant_v1($1)',[f.org]);
      const result=await client.query(sql,params); await client.query('COMMIT'); return result;
    } catch(error) { await client.query('ROLLBACK').catch(()=>{}); throw error; }
    finally { client.release(); }
  }

  beforeAll(async()=>{f=await createEstimateReviewFixture();actor=f.actors.owner;estimate=f.estimateGraphs[0].ids.estimate;customer=f.estimateGraphs[0].ids.customer;await issueCurrentVersion();await seedActionAuthority();},300000);
  afterAll(async()=>{if(f)await f.cleanup();},180000);

  test('migration287 is exact, immutable, forced-RLS and owner-only',async()=>{
    expect((await f.ownerPool.query('SELECT max(substring(filename,1,3)::integer) latest,count(*)::integer total FROM public._migrations')).rows[0]).toEqual({latest:287,total:283});
    expect((await f.ownerPool.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='canonical_automation_estimate_quote_resolutions_v1'")).rows[0]).toEqual({relrowsecurity:true,relforcerowsecurity:true});
    expect((await f.ownerPool.query("SELECT has_function_privilege('public','canonical_automation_record_estimate_quote_resolution_v1(text,jsonb)','EXECUTE') allowed")).rows[0].allowed).toBe(false);
  });

  test('stores and exactly replays only document-bound external-delivery-unavailable truth with zero sensitive payload or effect',async()=>{
    const value=await build(1);const first=await store(value);expect(first).toMatchObject({resultState:'exact_document_bound_external_delivery_unavailable',replayed:false,
      messageCreated:false,accessGrantCreated:false,providerAttempted:false,customerResponseCreated:false,priceOrScopeMutated:false,effectCreated:false});
    expect(await store(copy(value))).toMatchObject({estimateQuoteResolutionDigest:first.estimateQuoteResolutionDigest,replayed:true,effectCreated:false});
    const row=(await tenantQuery('SELECT * FROM canonical_automation_estimate_quote_resolutions_v1 WHERE organization_id=$1 AND estimate_quote_resolution_id=$2',[f.org,value.estimateQuoteResolutionId])).rows[0];
    expect(row).toMatchObject({customer_id:customer,requested_channel_id:'email',document_state:'exact_current_approved_customer_safe_version',
      channel_preview_state:'unavailable_no_accepted_external_customer_channel',expiration_state:'not_created_no_access_grant',
      customer_response_state:'unavailable_no_access_or_authenticated_response',delivery_state:'unavailable_no_message_or_access'});
    const serialized=JSON.stringify(row);expect(serialized).not.toContain('@example.test');expect(serialized).not.toContain('Install the exact reviewed');expect(serialized).not.toContain('15000');
  });

  test('rejects malformed and trusted substitution with zero residue',async()=>{
    const original=await build(10);for(const mutate of [value=>{value.extra='customer@example.test';},value=>{value.estimateBinding.documentDigest=hash('wrong');},
      value=>{value.authorizationBinding.authorizationRecordDigest=hash('wrong');},value=>{value.requestedChannelId='provider_live';},value=>{delete value.estimateBinding.termsDigest;}]){
      const value=copy(original);mutate(value);value.requestDigest=canonical.digest('mission28.estimate-quote-resolution.v1\n',Object.fromEntries(Object.entries(value).filter(([key])=>key!=='requestDigest')));await expect(store(value,trusted(value))).rejects.toThrow();}
    const wrong=trusted(original);wrong.estimateBinding.customerEstimateVersionId=uuid(99);await expect(store(original,wrong)).rejects.toThrow(/trusted resolution/i);
    expect((await tenantQuery('SELECT count(*)::integer count FROM canonical_automation_estimate_quote_resolutions_v1 WHERE estimate_quote_resolution_id=$1',[original.estimateQuoteResolutionId])).rows[0].count).toBe(0);
  });

  test('rejects clone material, a superseded document and legacy delivery-link adoption without creating effects',async()=>{
    const value=await build(20);await store(value);const clone=copy(value);clone.estimateQuoteResolutionId=uuid(830021);clone.requestDigest=canonical.digest('mission28.estimate-quote-resolution.v1\n',Object.fromEntries(Object.entries(clone).filter(([key])=>key!=='requestDigest')));await expect(store(clone,trusted(clone))).rejects.toThrow(/unique|duplicate/i);
    const legacy=await build(22);const legacyClient=await f.ownerPool.connect();let legacyError;
    try { await legacyClient.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await legacyClient.query(`INSERT INTO canonical_customer_estimate_delivery_links(id,organization_id,estimate_id,version_id,token_hash,actor_user_id,membership_id,auth_session_id,expires_at,request_key_hash,request_digest,digest)
        VALUES($1,$2,$3,$4,$5,$6,$6,$7,NOW()+INTERVAL '1 day',$8,$9,$10)`,[uuid(899001),f.org,estimate,version.id,'a'.repeat(64),actor.actorUserId,actor.authSessionId,'b'.repeat(64),'c'.repeat(64),'d'.repeat(64)]);
      try { await legacyClient.query('SELECT public.canonical_automation_record_estimate_quote_resolution_v1($1,$2::jsonb)',[canonical.canonicalize(legacy),JSON.stringify(trusted(legacy))]); }
      catch(error) { legacyError=error; }
      await legacyClient.query('ROLLBACK');
    } finally { await legacyClient.query('ROLLBACK').catch(()=>{}); legacyClient.release(); }
    expect(legacyError).toBeDefined(); expect(legacyError.message).toMatch(/authority unavailable/i);
    const stale=await build(23);await f.ownerPool.query("UPDATE canonical_customers SET name=name||' corrected',updated_at=clock_timestamp() WHERE organization_id=$1 AND id=$2",[f.org,customer]);
    await expect(store(stale)).rejects.toThrow(/customer estimate changed|authority unavailable/i);
    expect((await tenantQuery('SELECT count(*)::integer count FROM canonical_automation_estimate_quote_resolutions_v1 WHERE estimate_quote_resolution_id=ANY($1::uuid[])',[[value.estimateQuoteResolutionId,clone.estimateQuoteResolutionId,legacy.estimateQuoteResolutionId,stale.estimateQuoteResolutionId]])).rows[0].count).toBe(1);
  });
});
