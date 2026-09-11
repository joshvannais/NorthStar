'use strict';
const {createDatabaseFixture}=require('../helpers/m23-part9b-overview-fixture');
const {session}=require('../helpers/owner-operations-demo-session');
const time=require('../../public/js/scheduling-time-contract');
const fs=require('fs');
const suite=process.env.M19_PG_ADMIN_URL?describe:describe.skip;
suite('Owner Operations shared SQL and isolated lifecycle',()=>{
 let f;
 beforeAll(async()=>{f=await createDatabaseFixture();},60000);
 afterAll(async()=>{if(f)await f.cleanup();},30000);
 const ok=r=>{expect(r.status).toBe(201);return r.body;};
 test('ordinary scheduled job uses one work identity, real review gate, completion history and reopening',async()=>{
  const s=session(f.app),id=await s.setup(),before=await s.read();
  ok(await s.act(id,'initialize'));ok(await s.act(id,'transition',{action:'start'}));let d=await s.detail(id);
  const observed=time.formatInstant(new Date().toISOString(),d.timeZoneAuthority.timeZone).rfc3339;
  const progress=ok(await s.act(id,'progress',{action:'record_progress',performerProfileId:d.performers[0].id,document:{kind:'progress',description:'One item checked during the recorded work.',observedAt:observed,timeZoneAuthority:d.timeZoneAuthority,evidence:[],workKey:'inspection',quantity:{completed:'1',total:'2',unit:'ea'},milestone:null,uncertainty:'measured',uncertaintyReason:null}})).data;
  const proposal={action:'propose_completion',expiresAt:time.formatInstant(new Date(Date.now()+3600000),d.timeZoneAuthority.timeZone).rfc3339,gateRequirements:{checklists:[],inspections:[],files:[]}};
  expect((await s.act(id,'completion',proposal)).status).toBe(409);
  ok(await s.act(id,'progress',{action:'review',performerProfileId:d.performers[0].id,recordId:progress.id,expectedRecordRevision:progress.revision,expectedRecordDigest:progress.digest,document:{outcome:'owner_confirmed'}}));
  let p=ok(await s.act(id,'completion',proposal)).completionRecord;
  {const fresh=await s.detail(id),review=await s.agent.get('/api/demo/command-center/operations/executions/'+fresh.execution.id+'/completion-review').set('Cookie',s.cookie);expect(review.status).toBe(200);expect(review.body.data.proposal.expiresAt).toMatch(/Z$/);}
  const pin=r=>({id:r.id,revision:r.revision,digest:r.digest});
  ok(await s.act(id,'completion',{action:'withdraw_completion',proposal:pin(p)}));
  p=ok(await s.act(id,'completion',proposal)).completionRecord;
  const approved=ok(await s.act(id,'completion',{action:'approve_completion',proposal:pin(p)})).completionRecord;
  ok(await s.act(id,'completion',{action:'correct_completion',record:pin(approved),annotation:{note:'Recorded correction annotation; original approval retained.',nextAction:null}}));
  const reopened=ok(await s.act(id,'completion',{action:'reopen_execution',completion:pin(approved),nextAction:'Recheck the remaining item.'})).completionRecord;
  expect((await s.act(id,'transition',{action:'resume'})).status).toBe(409);
  ok(await s.act(id,'completion',{action:'resume_reopened',reopening:pin(reopened)}));
  d=await s.detail(id);expect(d.execution.lifecycleState).toBe('in_progress');expect(d.progress).toHaveLength(2);expect(d.completion.records).toHaveLength(7);
  const after=await s.read();expect(after.graphs).toEqual(before.graphs);expect(d.execution.appointmentId).toBe(id);
  const response=await s.agent.get('/api/demo/command-center/operations/executions/'+d.execution.id+'/completion-review').set('Cookie',s.cookie);
  expect(response.status).toBe(200);expect(response.body.data.authority).toBe('isolated_demo_postgresql');
  expect(()=>require('../../public/js/completion-review-contract').validate(response.body.data,{demo:true})).not.toThrow();
  expect(()=>require('../../public/js/completion-review-contract').validate(response.body.data)).toThrow();
 },45000);
 test('older sessions retain their graphs and missing scheduling basis blocks field evidence',async()=>{
  const s=session(f.app),original=await s.read();
  const repo=require('../../src/commandCenter/demoRepository'),token=repo.normalizeToken(decodeURIComponent(s.cookie.slice(s.cookie.indexOf('=')+1)),new Date());
  const legacy=require('../../src/commandCenter/workspace').createInitialDemoState(token.tenantId,token.issuedAt,{seed:repo.workspaceSeedForToken(token.tokenHash)});delete legacy.operationsSchedulingBasis;
  await f.ownerPool.query('INSERT INTO demo_command_center_sessions(id,tenant_id,token_hash,state,created_at,updated_at,expires_at) VALUES($1,$2,$3,$4,$5,$5,$6)',[token.sessionId,token.tenantId,token.tokenHash,legacy,token.issuedAt,token.expiresAt]);
  const id=await s.setup();ok(await s.act(id,'initialize'));ok(await s.act(id,'transition',{action:'start'}));
  const detail=await s.detail(id);expect(detail.schedulingBasis).toBeNull();expect(detail.assignment.needsReview).toBe(true);expect(detail.allowedActions).not.toContain('evidence');
  const before=await s.read();expect((await s.act(id,'evidence',{action:'record_note',performerProfileId:detail.performers[0].id,note:'A proposed observation with unresolved scheduling basis.',caption:null})).status).toBe(409);
  const after=await s.read();expect(after.integrity.revision).toBe(before.integrity.revision);expect(after.graphs).toEqual(before.graphs);expect((await f.ownerPool.query("SELECT state->'graphs' graphs FROM demo_command_center_sessions WHERE id=$1",[token.sessionId])).rows[0].graphs).toEqual(legacy.graphs);
  expect((await f.ownerPool.query("SELECT state?'operationsSchedulingBasis' present FROM demo_command_center_sessions WHERE id=$1",[original.session.id])).rows[0].present).toBe(false);
 });
 test('a session that expires during an ordinary row-lock wait cannot save work',async()=>{
  const s=session(f.app),id=await s.setup();ok(await s.act(id,'initialize'));const detail=await s.detail(id),workspace=await s.read();
  await f.ownerPool.query("UPDATE demo_command_center_sessions SET expires_at=clock_timestamp()+interval '1 second' WHERE id=$1",[workspace.session.id]);
  const before=(await f.ownerPool.query('SELECT state,revision,mutation_count FROM demo_command_center_sessions WHERE id=$1',[workspace.session.id])).rows[0];
  const holder=await f.ownerPool.connect();await holder.query('BEGIN');await holder.query('SELECT id FROM demo_command_center_sessions WHERE id=$1 FOR UPDATE',[workspace.session.id]);
  try{
   const pending=s.send(id,'transition',{...s.pins(detail,true),action:'start'},detail.demoWorkspaceRevision,require('crypto').randomUUID()).then(r=>r);
   await new Promise(resolve=>setTimeout(resolve,1250));await holder.query('COMMIT');
   expect((await pending).status).toBe(410);
   expect((await f.ownerPool.query('SELECT state,revision,mutation_count FROM demo_command_center_sessions WHERE id=$1',[workspace.session.id])).rows[0]).toEqual(before);
  }finally{await holder.query('ROLLBACK');holder.release();}
 });
 test.each(['history_failure','lost_commit_ack'])('ordinary %s preserves atomicity or resolves one committed effect by exact replay',async mode=>{
  const s=session(f.app),id=await s.setup(),d=await s.detail(id),repo=require('../../src/commandCenter/demoRepository');
  const token=repo.normalizeToken(decodeURIComponent(s.cookie.slice(s.cookie.indexOf('=')+1)),new Date());
  const input={operation:'work_action',appointmentId:id,operations:{family:'initialize',body:s.pins(d)},expectedRevision:d.demoWorkspaceRevision,idempotencyKey:require('crypto').randomUUID()};
  const before=(await f.ownerPool.query('SELECT state,revision,mutation_count FROM demo_command_center_sessions WHERE id=$1',[token.sessionId])).rows[0];let injected=false;
  const pool={query:(...args)=>f.runtimePool.query(...args),async connect(){const client=await f.runtimePool.connect();return {release:discard=>client.release(discard),async query(sql,args){if(!injected&&mode==='history_failure'&&sql.includes('INSERT INTO demo_command_center_mutations')){injected=true;throw new Error('LOCAL_HISTORY_FAILURE');}const result=await client.query(sql,args);if(!injected&&mode==='lost_commit_ack'&&sql==='COMMIT'){injected=true;throw new Error('LOCAL_COMMIT_ACK_LOST');}return result;}};}};
  await expect(new repo.DemoCommandCenterRepository(()=>pool).mutate(token,input,{sourceHash:'b'.repeat(64)})).rejects.toThrow(mode==='history_failure'?'LOCAL_HISTORY_FAILURE':'LOCAL_COMMIT_ACK_LOST');expect(injected).toBe(true);
  const after=(await f.ownerPool.query('SELECT state,revision,mutation_count FROM demo_command_center_sessions WHERE id=$1',[token.sessionId])).rows[0];
  if(mode==='history_failure')expect(after).toEqual(before);else{expect(Number(after.revision)).toBe(Number(before.revision)+1);const replay=await new repo.DemoCommandCenterRepository(()=>f.runtimePool).mutate(token,input,{sourceHash:'b'.repeat(64)});expect(replay.replayed).toBe(true);expect(replay.operationsResponse.data.id).toBe(after.state.operations.events[0].work.execution.id);expect((await f.ownerPool.query('SELECT count(*)::int n FROM demo_command_center_mutations WHERE session_id=$1 AND operation=$2',[token.sessionId,'work_action'])).rows[0].n).toBe(1);}
 });
 test('same-key initialization replay preserves one work identity while stale or changed requests fail closed',async()=>{
  const s=session(f.app),id=await s.setup(),d=await s.detail(id),body=s.pins(d),key=require('crypto').randomUUID();
  const first=ok(await s.send(id,'initialize',body,d.demoWorkspaceRevision,key));const after=await s.read();
  const replayResponse=await s.send(id,'initialize',body,d.demoWorkspaceRevision,key);expect(replayResponse.status).toBe(200);const replay=replayResponse.body;expect(replay.replayed).toBe(true);expect(replay.data).toEqual(first.data);
  expect((await s.read()).integrity.revision).toBe(after.integrity.revision);
  expect((await s.send(id,'initialize',{...body,reason:'Different reviewed request.'},d.demoWorkspaceRevision,key)).status).toBe(409);
  expect((await s.send(id,'initialize',body,d.demoWorkspaceRevision,require('crypto').randomUUID())).status).toBe(409);
  expect((await s.detail(id)).execution.id).toBe(first.data.id);
 });
 test('cancelling recorded work preserves the appointment and cannot reopen cancelled work',async()=>{
  const s=session(f.app),id=await s.setup();ok(await s.act(id,'initialize'));const before=await s.detail(id),graphBefore=(await s.read()).graphs;
  const result=ok(await s.act(id,'completion',{action:'cancel_execution',proposal:null}));
  expect(result.data.lifecycleState).toBe('cancelled');const after=await s.detail(id);
  expect(after.assignment).toEqual(before.assignment);expect((await s.read()).graphs).toEqual(graphBefore);
  expect(after.allowedActions).toEqual([]);expect((await s.act(id,'completion',{action:'reopen_execution',completion:{id:result.completionRecord.id,revision:1,digest:result.completionRecord.digest},nextAction:'Try to review cancelled work.'})).status).toBe(409);
 });
 test('required original checklist uses its recorded responses and cannot pass while missing',async()=>{
  const s=session(f.app),id=await s.setup();ok(await s.act(id,'initialize'));ok(await s.act(id,'transition',{action:'start'}));const d=await s.detail(id);
  const checklist=ok(await s.act(id,'evidence',{action:'create_checklist',performerProfileId:d.performers[0].id,template:null,items:[{key:'work-area',prompt:'Work area checked',required:true}]})).data;
  const proposal={action:'propose_completion',expiresAt:new Date(Date.now()+3600000).toISOString(),gateRequirements:{checklists:[{id:checklist.id,revision:checklist.revision,digest:checklist.digest}],inspections:[],files:[]}};
  expect((await s.act(id,'completion',proposal)).status).toBe(409);
  ok(await s.act(id,'evidence',{action:'respond_item',performerProfileId:d.performers[0].id,checklistId:checklist.id,expectedChecklistRevision:checklist.revision,expectedChecklistDigest:checklist.digest,itemKey:'work-area',resultType:'pass',observation:'Work area was checked.',measurement:null,exception:null,supportingEvidenceIds:[]}));
  const proposed=ok(await s.act(id,'completion',proposal));expect(proposed.completionRecord.gateSnapshot.gateResults.find(g=>g.gate==='required_checklists').passed).toBe(true);
 });
 test('mounted paid owner read uses the current shared execution and denies member access',async()=>{
  const ctx=await f.createExecution();const request=require('supertest'); await require('../../src/operations/ownerWorkRepository').readOwnerWork(f.runtimePool,ctx.actor,ctx.appointment);
  const read=await request(f.app).get('/api/v1/field-executions/owner-work/appointments/'+ctx.appointment).set(ctx.actor.session.headers);
  expect(read.status).toBe(200);expect(read.body.data.execution.id).toBe(ctx.execution.id);
  expect(read.body.data.authority).toBe('postgresql');
  const denied=await request(f.app).get('/api/v1/field-executions/owner-work/appointments/'+ctx.appointment).set(f.actors.member.session.headers);
  expect(denied.status).toBe(403);
 });
 test('a genuine completion proposal between discovery and detail returns only the new protected snapshot',async()=>{
  const ctx=await f.createExecution();let changed=false;
  const pool={query:(...args)=>f.runtimePool.query(...args),async connect(){const client=await f.runtimePool.connect();return {release:discard=>client.release(discard),async query(sql,args){const result=await client.query(sql,args);if(sql==='COMMIT'&&!changed){changed=true;await f.completion(ctx);}return result;}};}};
  const result=await require('../../src/operations/ownerWorkRepository').readOwnerWork(pool,ctx.actor,ctx.appointment);
  expect(changed).toBe(true);expect(result.execution.lifecycleState).toBe('completion_pending');expect(result.execution.revision).toBe(ctx.execution.revision);expect(result.completion.activeProposal).not.toBeNull();
 });
 test('concurrent approval and withdrawal produce only one resolution of the current proposal',async()=>{
  const s=session(f.app),id=await s.setup();ok(await s.act(id,'initialize'));ok(await s.act(id,'transition',{action:'start'}));
  const p=ok(await s.act(id,'completion',{action:'propose_completion',expiresAt:new Date(Date.now()+60000).toISOString(),gateRequirements:{checklists:[],inspections:[],files:[]}})).completionRecord,d=await s.detail(id);
  const responses=await Promise.all(['approve_completion','withdraw_completion'].map(action=>s.send(id,'completion',{...s.pins(d),action,proposal:{id:p.id,revision:p.revision,digest:p.digest}},d.demoWorkspaceRevision,require('crypto').randomUUID())));
  expect(responses.map(r=>r.status).sort()).toEqual([201,409]);const detail=await s.detail(id);expect(detail.completion.records).toHaveLength(2);expect(detail.completion.records.filter(r=>['approval','withdrawal'].includes(r.recordKind))).toHaveLength(1);
 });
 test('revoked session after discovery is rejected before detail is returned',async()=>{
  const ctx=await f.createExecution();let changed=false;
  const pool={query:(...args)=>f.runtimePool.query(...args),async connect(){const client=await f.runtimePool.connect();return {release:discard=>client.release(discard),async query(sql,args){const result=await client.query(sql,args);if(sql==='COMMIT'&&!changed){changed=true;await f.ownerPool.query("UPDATE auth_sessions SET status='revoked',revoked_at=clock_timestamp(),revoke_reason='ordinary-discovery-race' WHERE id=$1",[ctx.actor.authSessionId]);}return result;}};}};
  try{await expect(require('../../src/operations/ownerWorkRepository').readOwnerWork(pool,ctx.actor,ctx.appointment)).rejects.toMatchObject({status:403});expect(changed).toBe(true);}
  finally{await f.ownerPool.query("UPDATE auth_sessions SET status='active',revoked_at=NULL,revoke_reason=NULL WHERE id=$1",[ctx.actor.authSessionId]);}
 });
 test('paid loaded completion snapshot is byte-equivalent to the pre-extraction snapshot',async()=>{
  const sql=fs.readFileSync('migrations/049_canonical_completion_reopening_authority.sql','utf8');
  const start=sql.indexOf('CREATE FUNCTION public.canonical_completion_gate_snapshot('),end=sql.indexOf('END $$;',start)+9;
  await f.ownerPool.query(sql.slice(start,end).replace('canonical_completion_gate_snapshot','test_original_completion_gate_snapshot'));
  const ctx=await f.createExecution();
  const r=await f.ownerPool.query("SELECT public.canonical_completion_gate_snapshot($1,$2,$3)::text current, public.test_original_completion_gate_snapshot($1,$2,$3)::text original",[ctx.actor.organizationId,ctx.execution.id,{checklists:[],inspections:[],files:[]}]);
  expect(r.rows[0].current).toBe(r.rows[0].original);
  await f.progress(ctx);await f.fieldEvidence(ctx,'record_note',{note:'Observed local fixture work.',caption:null});
  const requirements={checklists:[],inspections:[],files:[]},evidence={complete:true,labor:[],materials:[],progress:[],field:[],equipmentEvents:[],equipmentLedgers:[]};
  for(const [key,table]of [['progress','canonical_progress_records'],['field','canonical_field_evidence_records']])evidence[key]=(await f.ownerPool.query(`SELECT to_jsonb(r) value FROM ${table} r WHERE organization_id=$1 AND execution_id=$2`,[ctx.actor.organizationId,ctx.execution.id])).rows.map(r=>r.value);
  const assignment=(await f.ownerPool.query('SELECT to_jsonb(a) value FROM canonical_schedule_assignments a WHERE id=$1',[ctx.assignment.id])).rows[0].value;
  const compared=await f.ownerPool.query('SELECT public.canonical_completion_gate_snapshot($1,$2,$3)::text current,public.test_original_completion_gate_snapshot($1,$2,$3)::text original,public.canonical_demo_completion_gate_snapshot($1,$2,$3,$4,$5,transaction_timestamp())::text demo',[ctx.actor.organizationId,ctx.execution.id,requirements,assignment,evidence]);
  expect(compared.rows[0].current).toBe(compared.rows[0].original);expect(compared.rows[0].demo).toBe(compared.rows[0].original);
  expect(JSON.parse(compared.rows[0].demo).gateResults.find(g=>g.gate==='progress_review').passed).toBe(false);
 });
});
