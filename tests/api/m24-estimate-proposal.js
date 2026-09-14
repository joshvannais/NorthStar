'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),request=require('supertest');
process.env.NODE_ENV='test';process.env.AUTH_ACCESS_SECRET='proposal-local-disposable-secret-at-least-thirty-two';
for(const k of ['DATABASE_URL','MIGRATION_DATABASE_URL','OPENAI_API_KEY','RETELL_API_KEY','STRIPE_SECRET_KEY'])delete process.env[k];
const {createEstimateReviewFixture}=require('../helpers/m24-estimate-review-fixture');
const out=path.resolve(process.argv.find(x=>x.startsWith('--output=')).slice(9));assert.ok(!fs.existsSync(out));fs.mkdirSync(out);const save=(n,v)=>fs.writeFileSync(path.join(out,n),JSON.stringify(v,null,2));
(async()=>{let f;const ledger={cases:[],pass:false};try{
 f=await createEstimateReviewFixture({recordedLaborHours:8,proposalScope:{measuredFenceLength:{value:'100',unit:'ft'},proposalGeography:'simulated-workspace'}});
 const seeded=await require('../helpers/m24-proposal-source').seed(f);
 for(const demo of [false,true]){
  const tag=demo?'demo':'paid';let entry=demo?await request(f.app).get('/api/demo/command-center'):null;
  if(demo&&!entry.body.data.graphs.some(g=>g.polaris?.snapshot?.service?.key==='fence')){
   const cookies=entry.headers['set-cookie'];const created=await request(f.app).post('/api/demo/command-center/simulations/leads').set({Cookie:cookies.map(x=>x.split(';')[0]).join('; '),Origin:'http://localhost',Host:'localhost','X-NorthStar-Demo-Intent':'simulate-lead','Idempotency-Key':require('node:crypto').randomUUID()}).send({expectedRevision:entry.body.data.integrity.revision,scenario:{...require('../../src/commandCenter/scenarioSpace').DEFAULT_SELECTION,service:'fence'}});save('demo-fence-setup.json',{status:created.status,body:created.body});assert.equal(created.status,201);entry=created;entry.headers['set-cookie']=cookies;
  }
  const graph=demo?entry.body.data.graphs.find(g=>g.work?.serviceType==='fence'||g.lead?.serviceType==='fence'||g.snapshot?.service?.key==='fence'||g.polaris?.snapshot?.service?.key==='fence'):f.estimateGraphs[0];
  if(demo)save('demo-entry.json',entry.body);assert.ok(graph,'A fence graph must be selected explicitly');
  const route=(demo?'/api/demo/command-center/estimates/':'/api/v1/canonical/estimates/')+graph.ids.estimate;
  const headers=demo?{Cookie:entry.headers['set-cookie'].map(x=>x.split(';')[0]).join('; '),Origin:'http://localhost',Host:'localhost','X-NorthStar-Demo-Intent':'proposal-preview'}:f.actors.owner.session.headers;
  const before=await request(f.app).get(route+'/review').set(headers);assert.equal(before.status,200,JSON.stringify(before.body));save(tag+'-before.json',before.body);
  let body={version:'estimate-proposal-preview-v1',selectedRevision:null,expectedBasisDigest:null,overrides:[],candidateIds:[]};
  let response=await request(f.app).post(route+'/proposal-preview').set(headers).send(body);save(tag+'-initial-response.json',{status:response.status,body:response.body});assert.equal(response.status,200,JSON.stringify(response.body));
  if(demo&&response.body.data.readiness==='blocked'){
   assert.ok(response.body.data.conflicts.some(s=>s.includes('job detail')));
   body={...body,expectedBasisDigest:response.body.data.basisDigest,overrides:[{fieldId:'material',value:'cedar',unit:'category',sourceKind:'owner_assumption',reason:'For this local proposed replacement, the owner explicitly chooses cedar; the original job remains unchanged.'}]};
   response=await request(f.app).post(route+'/proposal-preview').set(headers).send(body);assert.equal(response.status,200,JSON.stringify(response.body));
  }
  save(tag+'-response.json',{status:response.status,body:response.body});assert.equal(response.body.data.components.length,5);
  assert.equal(response.body.data.components.find(c=>c.kind==='equipment').result.lines[0].status,'matches_reviewed_requirements');
  const feet=demo?Number(graph.polaris.snapshot.service.scope.linearFeet):100;
  assert(Number.isInteger(feet));const cents=(BigInt(feet)*715n+1n)/2n,expected=String(cents/100n)+'.'+String(cents%100n).padStart(2,'0');
  assert.equal(response.body.data.components.find(c=>c.kind==='materials').result.total,expected,'Declared feet × 1.10 waste × $3.25, rounded to cents');
  const repeated=await request(f.app).post(route+'/proposal-preview').set(headers).send({...body,expectedBasisDigest:response.body.data.basisDigest});assert.equal(repeated.status,200,JSON.stringify(repeated.body));assert.equal(repeated.body.data.basisDigest,response.body.data.basisDigest);
  const changed=await request(f.app).post(route+'/proposal-preview').set(headers).send({...body,expectedBasisDigest:'0'.repeat(64)});assert.equal(changed.status,409);
  const after=await request(f.app).get(route+'/review').set(headers);assert.equal(after.status,200);save(tag+'-after.json',after.body);
  function financial(v){return JSON.parse(JSON.stringify(v,(k,x)=>['assessedAt','generatedAt','expiresAt'].includes(k)?undefined:x));}assert.deepEqual(financial(after.body),financial(before.body));
  const denial=await request(f.app).post(route+'/proposal-preview').set(demo?{...headers,'X-NorthStar-Demo-Intent':'wrong'}:{...headers,'X-CSRF-Token':'wrong'}).send(body);assert.equal(denial.status,403,JSON.stringify(denial.body));
  const malformed=await request(f.app).post(route+'/proposal-preview').set(headers).set('Content-Type','application/json').send('{"version":1,"version":2}');assert.equal(malformed.status,400);
  const tooLarge=await request(f.app).post(route+'/proposal-preview').set(headers).send({...body,padding:'x'.repeat(131072)});assert.equal(tooLarge.status,413);
  const appointmentId=graph.ids.appointment||graph.ids.work;
  const scheduling=demo?entry.body.data.schedulingOverview.records.find(r=>r.appointmentId===appointmentId).authority:(await f.ownerPool.query('SELECT revision,rtrim(canonical_digest) digest,appointment_status FROM canonical_schedule_assignments WHERE organization_id=$1 AND appointment_id=$2',[f.org,appointmentId])).rows[0];
  const zone=demo?entry.body.data.configuration.businessProfile.timeZone:'UTC',start=new Date(Date.now()+2*86400000);start.setUTCHours(16,0,0,0);const end=new Date(+start+3600000),time=require('../../public/js/scheduling-time-contract');
  const scheduleBody={expectedRevision:Number(scheduling.revision),expectedDigest:scheduling.digest,expectedTimeZone:zone,action:'schedule',target:{kind:'unassigned',id:null},scheduledStart:time.formatInstant(start.toISOString(),zone).rfc3339,scheduledEnd:time.formatInstant(end.toISOString(),zone).rfc3339,appointmentStatus:scheduling.appointmentStatus||scheduling.appointment_status,reason:'Local explicit time for current resource review'};
  const scheduleRoute=(demo?'/api/demo/command-center/appointments/':'/api/v1/canonical/appointments/')+appointmentId;
  const scheduleHeaders={...headers,'Idempotency-Key':require('node:crypto').randomUUID(),...(demo?{'X-NorthStar-Demo-Intent':'schedule-times','X-NorthStar-Demo-Revision':String(entry.body.data.integrity.revision)}:{})};
  const preview=await request(f.app).post(scheduleRoute+'/mutation-previews').set(scheduleHeaders).send(scheduleBody);save(tag+'-schedule-preview.json',{status:preview.status,body:preview.body});assert.equal(preview.status,201);
  const p=preview.body.data;
  const approval=await request(f.app).post(scheduleRoute+'/mutation-approvals').set({...scheduleHeaders,'Idempotency-Key':require('node:crypto').randomUUID(),...(demo?{'X-NorthStar-Demo-Revision':String(p.demoWorkspaceRevision)}:{})}).send({previewId:p.id,previewDigest:p.previewDigest,acknowledgedWarningDigests:p.warningDigests,acknowledgedReviewReasonDigests:p.reviewReasonDigests,reason:scheduleBody.reason});save(tag+'-schedule-approval.json',{status:approval.status,body:approval.body});assert.equal(approval.status,demo?201:200);
  const staleTime=await request(f.app).post(route+'/proposal-preview').set(headers).send({...body,expectedBasisDigest:response.body.data.basisDigest});assert.equal(staleTime.status,409);
  const timed=await request(f.app).post(route+'/proposal-preview').set(headers).send({...body,expectedBasisDigest:null,overrides:[]});save(tag+'-timed-proposal.json',{status:timed.status,body:timed.body});assert.equal(timed.status,200,JSON.stringify(timed.body));
  assert.ok(timed.body.data.candidates.workers.length>0);assert.ok(timed.body.data.candidates.workers.every(c=>c.availability!=='unknown'));
  ledger.cases.push(tag+' actual current appointment time changes draft basis and uses existing scheduling evaluation');
  if(!demo){
   for(const name of ['dispatcher','member','viewer','otherOwner']){const denied=await request(f.app).post(route+'/proposal-preview').set(f.actors[name].session.headers).send(body);assert.ok([403,404].includes(denied.status),name+': '+JSON.stringify(denied.body));}
   await seeded.retire();
   const revoked=await request(f.app).post(route+'/proposal-preview').set(headers).send({...body,expectedBasisDigest:response.body.data.basisDigest});save('paid-revoked.json',{status:revoked.status,body:revoked.body});assert.equal(revoked.status,409);
   const unavailable=await request(f.app).post(route+'/proposal-preview').set(headers).send(body);assert.equal(unavailable.status,200);assert.deepEqual(unavailable.body.data.components,[]);assert.ok(!JSON.stringify(unavailable.body).includes('Explicit Local Fence Recipe'));
   ledger.cases.push('Actual published recipe retirement rejects old basis and suppresses source; limited roles and other tenant denied');
  }
  ledger.cases.push(tag+' actual preview/repeat/stale/auth/body boundaries and unchanged review');
 }
 ledger.pass=true;
}catch(e){ledger.error={message:e.message,stack:e.stack};process.exitCode=1;}finally{if(f)await f.cleanup();save('RESULT.json',ledger);console.log(JSON.stringify(ledger));}})();
