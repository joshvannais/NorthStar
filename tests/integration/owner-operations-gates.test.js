'use strict';
const crypto=require('crypto');
const {createDatabaseFixture}=require('../helpers/m23-part9b-overview-fixture');
const suite=process.env.M19_PG_ADMIN_URL?describe:describe.skip;
suite('shared completion loader with explicit isolated typed evidence',()=>{
 let f;beforeAll(async()=>{f=await createDatabaseFixture();},60000);afterAll(async()=>{if(f)await f.cleanup();},30000);
 const gates=['required_checklists','required_inspections','required_files','unresolved_blockers_or_exceptions','progress_review','open_labor_timers','labor_review','material_review','equipment_checkout','equipment_downtime','field_evidence_review'];
 test('complete lifecycle matrix rejects unsupported pairs and preserves correction state',async()=>{
  const states=['not_started','in_progress','paused','completion_pending','completed','reopened','cancelled'];
  const actions=['start','pause','resume','propose_completion','approve_completion','withdraw_completion','cancel_execution','reopen_execution','resume_reopened','correct_completion'];
  const allowed={not_started:{start:'in_progress',cancel_execution:'cancelled'},in_progress:{pause:'paused',propose_completion:'completion_pending',cancel_execution:'cancelled'},paused:{resume:'in_progress',propose_completion:'completion_pending',cancel_execution:'cancelled'},completion_pending:{approve_completion:'completed',withdraw_completion:'paused',cancel_execution:'cancelled'},completed:{reopen_execution:'reopened'},reopened:{propose_completion:'completion_pending',resume_reopened:'in_progress',cancel_execution:'cancelled'},cancelled:{}};
  for(const state of states)for(const action of actions){const result=await f.runtimePool.query('SELECT canonical_work_lifecycle_after($1,$2,$3) value',[state,action,'paused']);expect(result.rows[0].value).toBe(action==='correct_completion'?state:allowed[state][action]||null);}
  expect((await f.runtimePool.query("SELECT canonical_work_lifecycle_after('completion_pending','withdraw_completion','completed') value")).rows[0].value).toBeNull();
 });
 test.each(gates)('%s is blocked by its actual missing or unresolved evidence',async gate=>{
  const org=crypto.randomUUID(),execution=crypto.randomUUID(),id=crypto.randomUUID(),asset=crypto.randomUUID(),digest='a'.repeat(64);
  const row={id,root_id:id,organization_id:org,execution_id:execution,revision:1,canonical_digest:digest};
  const requirements={checklists:[],inspections:[],files:[]},data={complete:true,labor:[],materials:[],progress:[],field:[],equipmentEvents:[],equipmentLedgers:[]};
  if(gate.startsWith('required_'))requirements[{required_checklists:'checklists',required_inspections:'inspections',required_files:'files'}[gate]].push({id,revision:1,digest});
  if(gate==='unresolved_blockers_or_exceptions')data.progress=[{...row,evidence_type:'blocker',document:{kind:'blocker',state:'open',reviewState:'owner_confirmed'}}];
  if(gate==='progress_review')data.progress=[{...row,evidence_type:'progress',document:{kind:'progress',reviewState:'needs_review'}}];
  if(gate==='open_labor_timers')data.labor=[{...row,review_state:'accepted',observed_end:null}];
  if(gate==='labor_review')data.labor=[{...row,review_state:'needs_review',observed_end:'2026-09-11T12:00:00Z'}];
  if(gate==='material_review')data.materials=[{...row,review_state:'needs_review'}];
  if(gate.startsWith('equipment_')){data.equipmentEvents=[{...row,asset_id:asset}];data.equipmentLedgers=[{organization_id:org,asset_id:asset,revision:1,digest,state:{checkedOutExecution:gate==='equipment_checkout'?execution:null,downtime:gate==='equipment_downtime',recordedFault:false}}];}
  if(gate==='field_evidence_review')data.field=[{...row,evidence_type:'observation',document:{kind:'observation',resultType:'needs_review'}}];
  const assignment={id:crypto.randomUUID(),revision:1,canonical_digest:digest};
  const result=(await f.runtimePool.query('SELECT public.canonical_demo_completion_gate_snapshot($1,$2,$3,$4,$5,$6) value',[org,execution,requirements,assignment,data,'2026-09-11T13:00:00Z'])).rows[0].value;
  expect(result.gateResults.map(g=>g.gate)).toEqual(gates);expect(result.gateResults.find(g=>g.gate===gate).passed).toBe(false);expect(result.hardGatesPassed).toBe(false);
 });
 test('absent evidence is rejected rather than equated with an empty complete set',async()=>{
  await expect(f.runtimePool.query('SELECT public.canonical_demo_completion_gate_snapshot($1,$2,$3,$4,$5,$6)',[crypto.randomUUID(),crypto.randomUUID(),{checklists:[],inspections:[],files:[]},{id:crypto.randomUUID(),revision:1,canonical_digest:'a'.repeat(64)},{complete:false},'2026-09-11T13:00:00Z'])).rejects.toMatchObject({code:'22023'});
 });
});
