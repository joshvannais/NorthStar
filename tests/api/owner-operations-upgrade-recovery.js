'use strict';
// Actual source-build rehearsal against one disposable, populated database.
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),{fork}=require('node:child_process'),{Pool}=require('pg');
const {session}=require('../helpers/owner-operations-demo-session');
const arg=n=>path.resolve(process.argv.find(v=>v.startsWith('--'+n+'=')).slice(n.length+3));
const base=arg('base'),paused=arg('paused'),combined=arg('combined'),output=arg('output'),candidate=path.resolve(__dirname,'../..');
assert.ok(!fs.existsSync(output));
(async()=>{const children=[],ledger={candidate,paused,combined,cases:[]};let pool;
 async function launch(source,seed,connection){const child=fork(path.join(__dirname,'../helpers/owner-operations-rehearsal-child.js'),[source,seed?'seed':'run'],{env:{...process.env,...connection},stdio:['ignore','inherit','inherit','ipc']});children.push(child);return new Promise((resolve,reject)=>{child.once('message',m=>m.error?reject(new Error(m.error)):resolve({...m,child}));child.once('exit',n=>reject(new Error('Child exited '+n)));});}
 async function stop(child){if(child.connected){const done=new Promise(r=>child.once('exit',r));child.send('stop');await done;}}
 async function paidSnapshot(){const names=['canonical_field_executions','canonical_progress_records','canonical_completion_records'];const result={};for(const name of names){const rows=await pool.query('SELECT row_to_json(t)::text value FROM '+name+' t ORDER BY id');result[name]=rows.rows;}return result;}
 async function saved(id){return(await pool.query('SELECT state,revision,mutation_count FROM demo_command_center_sessions WHERE id=$1',[id])).rows[0];}
 const success=r=>{assert.equal(r.status,201,JSON.stringify(r.body));return r.body;};
 try{
  const fixture=await launch(base,true);pool=new Pool({connectionString:fixture.migrationUrl});
  const old=await paidSnapshot(),migrations=(await pool.query('SELECT filename,checksum FROM _migrations ORDER BY filename')).rows;assert.equal(migrations.length,61);
  assert.ok(old.canonical_field_executions.length>=3);assert.ok(old.canonical_progress_records.length);assert.ok(old.canonical_completion_records.length>=3);
  const connection={DATABASE_URL:fixture.databaseUrl,MIGRATION_DATABASE_URL:fixture.migrationUrl};let current=await launch(candidate,false,connection);
  assert.deepEqual(await paidSnapshot(),old);assert.deepEqual((await pool.query("SELECT filename,checksum FROM _migrations WHERE filename<'064' ORDER BY filename")).rows,migrations);
  ledger.cases.push('Actual released populated execution/progress/pending/approved history survives candidate064 upgrade byte-for-byte;61 SQL identities unchanged');
  const s=session(current.origin),id=await s.setup();success(await s.act(id,'initialize'));success(await s.act(id,'transition',{action:'start'}));let d=await s.detail(id);
  success(await s.act(id,'evidence',{action:'record_note',performerProfileId:d.performers[0].id,note:'Retained simulated field observation.',caption:null}));
  const p=success(await s.act(id,'completion',{action:'propose_completion',expiresAt:new Date(Date.now()+3600000).toISOString(),gateRequirements:{checklists:[],inspections:[],files:[]}})).completionRecord;
  const w=await s.read(),before=await saved(w.session.id),pin={id:p.id,revision:p.revision,digest:p.digest};
  await stop(current.child);ledger.cases.push('Real isolated schedule/assignment/dispatch and work/note/pending-proposal history populated before pause');
  for(const source of [paused,combined]){
   const app=await launch(source,false,connection);s.use(app.origin);d=await s.detail(id);assert.equal(d.execution.lifecycleState,'completion_pending');
   const review=await s.agent.get('/api/demo/command-center/operations/executions/'+d.execution.id+'/completion-review').set('Cookie',s.cookie);assert.equal(review.status,200);assert.equal(review.body.data.proposal.id,p.id);
   assert.equal((await s.act(id,'completion',{action:'approve_completion',proposal:pin})).status,503);
   assert.deepEqual(await saved(w.session.id),before);assert.deepEqual(await paidSnapshot(),old);await stop(app.child);
   ledger.cases.push('Actually executed '+path.basename(source)+' reads pending proposal and saved evidence;503 denies mutation without modifying demo or paid histories');
  }
  current=await launch(candidate,false,connection);s.use(current.origin);success(await s.act(id,'completion',{action:'approve_completion',proposal:pin}));
  d=await s.detail(id);assert.equal(d.execution.lifecycleState,'completed');const after=await saved(w.session.id);assert.deepEqual(after.state.graphs,before.state.graphs);assert.deepEqual(after.state.operations.events.slice(1),before.state.operations.events);assert.deepEqual(await paidSnapshot(),old);
  ledger.cases.push('Actual compatible forward resume approves original pending proposal with current pins, preserving prior events, operational graph and paid histories');ledger.passed=true;
 }catch(error){ledger.failure=error.message;throw error;}finally{if(pool)await pool.end();for(const child of children.slice().reverse())await stop(child);fs.writeFileSync(output,JSON.stringify(ledger,null,2));}
})().catch(error=>{console.error(error);process.exitCode=1;});
