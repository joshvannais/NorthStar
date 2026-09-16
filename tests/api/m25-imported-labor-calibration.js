'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
process.env.NODE_ENV = 'test';
process.env.AUTH_ACCESS_SECRET = 'm25-imported-labor-calibration-local-disposable-secret';
for (const key of ['DATABASE_URL','MIGRATION_DATABASE_URL','OPENAI_API_KEY','RETELL_API_KEY','STRIPE_SECRET_KEY']) delete process.env[key];
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const { ingestLead } = require('../../src/services/canonicalGraphService');
const parts = require('../helpers/m24-cost-composition-input');
const output = (process.argv.find(value => value.startsWith('--output=')) || '--output=m25-imported-labor-calibration-result.json').slice(9);
assert.ok(!fs.existsSync(output));
const sourceKey = 'payroll.primary';

(async () => {
  let f; const ledger = { cases: [] };
  try {
    f = await createDatabaseFixture({ operationalSchedule: true });
    const owner = f.actors.owner;
    const profile = (await f.ownerPool.query('SELECT raw_profile,version_label FROM canonical_business_profiles WHERE organization_id=$1 AND is_active=true',[f.org])).rows[0];
    const estimates = [];
    for (let i=0;i<5;i+=1) {
      const external=crypto.randomUUID();
      const ingested=await ingestLead(f.runtimePool,{tenantContext:{organizationId:f.org,trusted:true},idempotencyKey:external,
        sourceVersion:'m25-calibration-fixture-v1',external:{customerId:external,callId:external,transcriptId:external,communicationId:external,appointmentId:external},
        customer:{name:`Calibration customer ${i+1}`,phone:`+1555555030${i}`,email:`${external}@example.test`,address:{line1:`${i+1} Test Way`,city:'Boston',state:'MA',postalCode:'02108'}},
        transcript:[{turnId:'scope',speaker:'customer',text:'The work is expected to require sixteen worker hours.'}],
        facts:[{variable:'laborHours',normalizedValue:16,evidenceText:'sixteen worker hours',speaker:'customer',evidenceTurnId:'scope',confidence:1}],
        service:{key:'plumbing',scope:{jobType:'repair',laborHours:16,description:'Imported labor calibration'}},
        businessProfile:profile.raw_profile,businessProfileVersion:profile.version_label});
      assert.equal(ingested.status,201,JSON.stringify(ingested));
      const estimate=ingested.body.ids.estimate; estimates.push(estimate); f.estimateGraphs=[ingested.body];
      const root=`/api/v1/canonical/estimates/${estimate}`;
      const post=(suffix,body)=>request(f.app).post(root+suffix).set(owner.session.headers).set('Idempotency-Key',crypto.randomUUID()).send(body);
      const read=async()=>{const value=await request(f.app).get(root+'/review').set(owner.session.headers);assert.equal(value.status,200,JSON.stringify(value.body));return value.body.data;};
      let state=await read(); const plan=parts.planBody(state,'labor'); let response=await post('/labor-plan-preview',plan);
      assert.equal(response.status,200,JSON.stringify(response.body)); parts.acceptPlanPreview(plan,response.body.data);
      response=await post('/labor-plans',plan); assert.equal(response.status,201,JSON.stringify(response.body)); state=await read();
      const adoption=parts.adoptionBody(state,'labor'); response=await post('/cost-adoption-preview',adoption);
      assert.equal(response.status,200,JSON.stringify(response.body)); adoption.assessment=response.body.data.assessment;
      response=await post('/cost-adoptions',adoption); assert.equal(response.status,201,JSON.stringify(response.body));
    }
    ledger.cases.push('Five same-service estimates retain separate adopted sixteen-worker-hour labor plans.');

    const root=`/api/v1/learning/external-labor-sources/${sourceKey}`;
    const post=(suffix,body,key=crypto.randomUUID(),actor=owner)=>request(f.app).post(root+suffix).set(actor.session.headers)
      .set('X-CSRF-Token',actor.csrfToken).set('Idempotency-Key',key).send(body);
    let response=await post('/consent',{action:'grant',expectedRevision:0,expectedDigest:'none',reason:'Use reviewed external labor evidence.',confirmed:true,confirmationVersion:'m25-external-labor-import-consent-v1'});
    assert.equal(response.status,201,JSON.stringify(response.body)); const sourceConsent=response.body.data.consent;
    const ratios=[1,1.1,1.2,1.25,1.3]; const records=ratios.map((ratio,i)=>{const start=new Date(Date.UTC(2026,0,i+1,8));const end=new Date(start.getTime()+16*ratio*3600000);return{
      externalRecordId:`shift-${i+1}`,externalVersion:1,state:'active',workerReference:'worker-7',jobReference:`job-${i+1}`,category:'production',
      observedStart:start.toISOString(),observedEnd:end.toISOString(),sourceUpdatedAt:new Date(end.getTime()+60000).toISOString()};});
    response=await post('/batches',{schemaVersion:'m25-external-labor-time-v1',mode:'continuous_update',expectedConsentRevision:sourceConsent.revision,
      expectedConsentDigest:sourceConsent.digest,cursorBefore:null,cursorAfter:'cursor-1',complete:false,records,
      reason:'Stage five current reviewed labor outcomes.',confirmed:true,confirmationVersion:'m25-external-labor-import-batch-v1'});
    assert.equal(response.status,201,JSON.stringify(response.body));
    const readMatches=async()=>{const value=await request(f.app).get(root+'/matches').set(owner.session.headers);assert.equal(value.status,200,JSON.stringify(value.body));return value.body.data;};
    let matches=await readMatches(); const workerTarget=matches.workerTargets.find(v=>v.targetId===f.actors.member.actorUserId);
    const matchBody=(kind,reference,sourceDigest,target)=>({referenceKind:kind,externalReference:reference,action:'link',targetId:target.targetId,
      expectedRevision:0,expectedDigest:'none',expectedSourceDigest:sourceDigest,expectedTargetDigest:target.digest,
      reason:'Owner reviewed the current source reference and same-tenant target.',confirmed:true,confirmationVersion:'m25-external-labor-reference-match-v1'});
    const workerRef=matches.references.find(v=>v.referenceKind==='worker'); response=await post('/matches',matchBody('worker','worker-7',workerRef.sourceDigest,workerTarget));
    assert.equal(response.status,201,JSON.stringify(response.body));
    for(let i=0;i<5;i+=1){const ref=matches.references.find(v=>v.referenceKind==='job'&&v.externalReference===`job-${i+1}`);
      const target=matches.jobTargets.find(v=>v.targetId===estimates[i]);assert.ok(ref&&target);
      response=await post('/matches',matchBody('job',`job-${i+1}`,ref.sourceDigest,target));assert.equal(response.status,201,JSON.stringify(response.body));}
    ledger.cases.push('One worker and five jobs are explicitly reconciled to current same-tenant targets.');

    const outcomeGrant={action:'grant',expectedRevision:0,expectedDigest:'none',reason:'Compare matched imported work with adopted plans.',confirmed:true,confirmationVersion:'m25-imported-labor-duration-consent-v1'};
    response=await post('/imported-labor-duration-consent',outcomeGrant);assert.equal(response.status,201,JSON.stringify(response.body));const outcomeConsent=response.body.data.consent;
    const calibrationGrant={action:'grant',expectedRevision:0,expectedDigest:'none',reason:'Summarize current reviewed imported labor outcomes.',confirmed:true,confirmationVersion:'m25-imported-labor-calibration-consent-v1'};
    const consentKey=crypto.randomUUID(); response=await post('/imported-labor-calibration-consent',calibrationGrant,consentKey);
    assert.equal(response.status,201,JSON.stringify(response.body));const calibrationConsent=response.body.data.consent;
    assert.equal((await post('/imported-labor-calibration-consent',calibrationGrant,consentKey)).status,200);
    assert.equal((await post('/imported-labor-calibration-consent',calibrationGrant,crypto.randomUUID(),f.actors.member)).status,403);
    const proposalBody={expectedConsentRevision:calibrationConsent.revision,expectedConsentDigest:calibrationConsent.digest,
      reason:'Review the complete current five-job sample.',confirmed:true,confirmationVersion:'m25-imported-labor-calibration-proposal-v1'};
    for(let i=0;i<5;i+=1){const body={externalJobReference:`job-${i+1}`,expectedConsentRevision:outcomeConsent.revision,
      expectedConsentDigest:outcomeConsent.digest,reason:'Compare this matched job with its adopted plan.',confirmed:true,
      confirmationVersion:'m25-imported-labor-duration-observation-v1'};
      response=await post(`/estimates/${estimates[i]}/imported-labor-duration-outcomes`,body);assert.equal(response.status,201,JSON.stringify(response.body));
      if(i===3){const tooSmall=await post('/imported-labor-calibrations/plumbing',proposalBody);assert.equal(tooSmall.status,409,JSON.stringify(tooSmall.body));assert.equal(tooSmall.body.error.code,'M25_IMPORTED_CALIBRATION_SAMPLE_REQUIRED');}}
    ledger.cases.push('Calibration fails closed until five current reviewed same-service outcomes exist.');

    const proposalKey=crypto.randomUUID(); response=await post('/imported-labor-calibrations/plumbing',proposalBody,proposalKey);
    assert.equal(response.status,201,JSON.stringify(response.body)); const proposal=response.body.data.proposal;
    assert.equal(proposal.sampleSize,5);assert.equal(proposal.medianActualToPlannedRatio,'1.2000');assert.equal(proposal.lowerQuartileRatio,'1.1000');
    assert.equal(proposal.upperQuartileRatio,'1.2500');assert.equal(proposal.proposedPlannedHoursMultiplier,'1.2000');assert.equal(proposal.advisoryCode,'increase_planned_hours');
    assert.equal((await post('/imported-labor-calibrations/plumbing',proposalBody,proposalKey)).status,200);
    assert.equal((await post('/imported-labor-calibrations/plumbing',proposalBody)).status,409);
    let read=await request(f.app).get(root+'/imported-labor-calibrations/plumbing').set(owner.session.headers);
    assert.equal(read.status,200);assert.equal(read.body.data.current.fresh,true);assert.equal(read.body.data.current.advisoryAvailable,true);
    const other=await request(f.app).get(root+'/imported-labor-calibrations/plumbing').set(f.actors.otherOwner.session.headers);
    assert.equal(other.status,200);assert.equal(other.body.data.current,null);
    ledger.cases.push('The median and quartiles are deterministic, tenant-private and advisory-only.');

    const corrected={...records[0],externalVersion:2,observedEnd:new Date(new Date(records[0].observedStart).getTime()+18*3600000).toISOString(),sourceUpdatedAt:new Date(Date.UTC(2026,0,2,4)).toISOString()};
    response=await post('/batches',{schemaVersion:'m25-external-labor-time-v1',mode:'continuous_update',expectedConsentRevision:sourceConsent.revision,
      expectedConsentDigest:sourceConsent.digest,cursorBefore:'cursor-1',cursorAfter:'cursor-2',complete:false,records:[corrected],
      reason:'Correct one current source interval.',confirmed:true,confirmationVersion:'m25-external-labor-import-batch-v1'});
    assert.equal(response.status,201,JSON.stringify(response.body));
    read=await request(f.app).get(root+'/imported-labor-calibrations/plumbing').set(owner.session.headers);
    assert.equal(read.status,200);assert.equal(read.body.data.current.fresh,false);assert.equal(read.body.data.current.advisoryAvailable,false);
    assert.equal(read.body.data.current.advisoryCode,null);assert.equal(read.body.data.current.proposedPlannedHoursMultiplier,null);
    ledger.cases.push('A source correction stales the sample and masks the saved recommendation.');

    response=await post('/imported-labor-calibration-consent',{action:'revoke',expectedRevision:calibrationConsent.revision,
      expectedDigest:calibrationConsent.digest,reason:'Stop this calibration purpose.',confirmed:true,confirmationVersion:'m25-imported-labor-calibration-consent-v1'});
    assert.equal(response.status,201,JSON.stringify(response.body));
    read=await request(f.app).get(root+'/imported-labor-calibrations/plumbing').set(owner.session.headers);
    assert.equal(read.body.data.activeConsent,false);assert.equal(read.body.data.current,null);assert.deepEqual(read.body.data.history,[]);
    const privileges=(await f.ownerPool.query(`SELECT
      has_table_privilege($1,'canonical_external_labor_calibration_consents','SELECT') consent_table,
      has_table_privilege($1,'canonical_external_labor_calibration_proposals','INSERT') proposal_table,
      has_function_privilege($1,'canonical_imported_labor_calibration_basis(uuid,text,text)','EXECUTE') helper,
      has_function_privilege($1,'canonical_imported_labor_calibration_read(uuid,uuid,text,uuid,text,text)','EXECUTE') entry`,[f.roles.runtime])).rows[0];
    assert.deepEqual(privileges,{consent_table:false,proposal_table:false,helper:false,entry:true});
    await assert.rejects(f.ownerPool.query('DELETE FROM canonical_external_labor_calibration_proposals'));
    const bytes=fs.readFileSync(path.join(__dirname,'../../migrations/087_canonical_imported_labor_calibration.sql'));const checksum=crypto.createHash('sha256').update(bytes).digest('hex');
    const applied=(await f.ownerPool.query("SELECT trim(checksum) checksum FROM _migrations WHERE filename='087_canonical_imported_labor_calibration.sql'")).rows;
    assert.deepEqual(applied,[{checksum}]);
    ledger.cases.push('Revocation hides derived values; runtime authority is guarded and immutable migration provenance is exact.');
    ledger.pass=true;
  } catch(error){ledger.error=error.stack;ledger.cause=error.cause&&{message:error.cause.message,code:error.cause.code,constraint:error.cause.constraint,detail:error.cause.detail};process.exitCode=1;}
  finally{if(f)await f.cleanup();fs.writeFileSync(output,JSON.stringify(ledger,null,2));console.log(JSON.stringify(ledger));}
})();
