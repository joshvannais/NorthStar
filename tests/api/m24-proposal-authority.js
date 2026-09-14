'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),request=require('supertest');
process.env.NODE_ENV='test';process.env.AUTH_ACCESS_SECRET='proposal-authority-local-disposable-secret';
for(const k of ['DATABASE_URL','MIGRATION_DATABASE_URL','OPENAI_API_KEY','RETELL_API_KEY','STRIPE_SECRET_KEY'])delete process.env[k];
const {createEstimateReviewFixture}=require('../helpers/m24-estimate-review-fixture');
const out=process.argv.find(x=>x.startsWith('--output=')).slice(9);assert(!fs.existsSync(out));
(async()=>{let f,restore=()=>{};const result={pass:false,cases:[]};try{
 f=await createEstimateReviewFixture({proposalScope:{measuredFenceLength:{value:'100',unit:'ft'},proposalGeography:'simulated-workspace'}});await require('../helpers/m24-proposal-source').seed(f);const pool=f.db.getPool(),original=pool.connect,clients=new Map(),trace=[];
 function wrap(client){if(clients.has(client))return client;const query=client.query;clients.set(client,query);client.query=function(...args){trace.push({pid:client.processID,sql:String(args[0]?.text||args[0]).slice(0,240)});return query.apply(this,args);};return client;}
 pool.connect=function(callback){if(callback)return original.call(this,(e,c,release)=>callback(e,c&&wrap(c),release));return original.call(this).then(wrap);};
 restore=()=>{pool.connect=original;for(const[c,q]of clients)c.query=q;};
 const route='/api/v1/canonical/estimates/'+f.estimateGraphs[0].ids.estimate+'/proposal-preview',headers=f.actors.owner.session.headers,body={version:'estimate-proposal-preview-v1',selectedRevision:null,expectedBasisDigest:null,overrides:[],candidateIds:[]};
 const response=await request(f.app).post(route).set(headers).send(body);assert.equal(response.status,200,JSON.stringify(response.body));
 const beginnings=trace.filter(t=>/^BEGIN/.test(t.sql));assert.equal(beginnings.length,1);assert.match(beginnings[0].sql,/REPEATABLE READ/);
 const protectedQueries=trace.filter(t=>/canonical_(?:equipment_plan_sources|pricing_sources|commercial|labor_plan_read|estimate_revision_read|travel_write_authority)/.test(t.sql));assert(protectedQueries.length>=5);assert(protectedQueries.every(t=>t.pid===beginnings[0].pid));result.trace=trace.slice();result.cases.push('Actual protected loaders use one PostgreSQL client and one repeatable-read transaction');
 restore();
 const holder=await f.ownerPool.connect(),observer=new(require('pg').Client)({connectionString:process.env.M19_PG_ADMIN_URL});await observer.connect();const databaseName=(await holder.query('SELECT current_database() name')).rows[0].name;let pending;
 try{
  const expiry=await holder.query("UPDATE auth_sessions SET access_expires_at=clock_timestamp()+interval '700 milliseconds' WHERE user_id=$1 AND status='active' RETURNING id",[f.actors.owner.actorUserId]);assert(expiry.rowCount>0);
  await holder.query('BEGIN');await holder.query('SELECT organization_id FROM subscriptions WHERE organization_id=$1 FOR UPDATE',[f.org]);
  pending=request(f.app).post(route).set(headers).send(body).then(r=>({status:r.status,body:r.body}));
  let waiting=false;for(let n=0;n<20;n++){const found=await observer.query("SELECT count(*)::int count FROM pg_stat_activity WHERE datname=$1 AND wait_event_type='Lock' AND pid<>pg_backend_pid()",[databaseName]);if(found.rows[0].count>0){waiting=true;break;}await new Promise(r=>setTimeout(r,25));}
  await new Promise(r=>setTimeout(r,800));await holder.query('COMMIT');const denied=await pending;result.expiredAfterWait=denied;result.actualWaitObserved=waiting;assert(waiting,'Protected read must actually wait on current subscription authority');assert([401,403].includes(denied.status));result.cases.push('Actual session expiry while protected read waits rejects after lock release');
 }finally{await holder.query('ROLLBACK');holder.release();await observer.end();if(pending)result.finalPendingOutcome=await pending;}
 result.pass=true;
}catch(e){result.error={message:e.message,stack:e.stack};process.exitCode=1;}finally{restore();if(f)await f.cleanup();fs.writeFileSync(out,JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify({pass:result.pass,cases:result.cases,error:result.error?.message}));}})();
