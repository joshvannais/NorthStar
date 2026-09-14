"use strict";
const assert=require('node:assert/strict'),request=require('supertest'),crypto=require('node:crypto');
module.exports=async({f,route,headers,body,save})=>{
 const tables=['canonical_material_plans','canonical_labor_plans','canonical_equipment_plans','canonical_equipment_cost_plans','canonical_travel_plans','canonical_estimate_revisions','canonical_pricing_plans','canonical_pricing_policy_plans','canonical_estimate_proposal_adoptions','canonical_travel_fences','canonical_equipment_readiness_fences'];
 async function contents(){const result={};for(const table of tables)result[table]=(await f.ownerPool.query('SELECT to_jsonb(t) row FROM public.'+table+' t WHERE organization_id=$1 ORDER BY to_jsonb(t)::text',[f.org])).rows;return result;}
 const original=await contents();save('risk-before.json',original);const ledger=[];
 const post=(value=body,h=headers,key=crypto.randomUUID())=>request(f.app).post(route+'/proposal-adoptions').set({...h,'Idempotency-Key':key}).send(value);
 for(const[title,value,h,status]of [['missing-consent',{...body,confirmed:false},headers,400],['changed-review',{...body,expectedReviewDigest:'0'.repeat(64)},headers,409],['unknown-field',{...body,extra:true},headers,400],['csrf',body,{...headers,'X-CSRF-Token':'wrong'},403]]){const r=await post(value,h);save('reject-'+title+'.json',{status:r.status,body:r.body});assert.equal(r.status,status,title);assert.deepEqual(await contents(),original);ledger.push(title);}
 for(const[key,actor]of Object.entries(f.actors)){if(['owner','admin'].includes(key))continue;const r=await post(body,actor.session.headers);save('role-'+key+'.json',{status:r.status,body:r.body});assert([401,403,404].includes(r.status),key+' '+r.status);assert.deepEqual(await contents(),original);ledger.push('role '+key);}
 const actor=f.actors.owner,expiry=(await f.ownerPool.query('SELECT access_expires_at FROM auth_sessions WHERE id=$1',[actor.authSessionId])).rows[0].access_expires_at;
 const blocker=await f.ownerPool.connect();let pending;
 try{
  await blocker.query('BEGIN');const blockerPid=(await blocker.query('SELECT pg_backend_pid() pid')).rows[0].pid;await blocker.query('SELECT id FROM canonical_estimates WHERE organization_id=$1 AND id=$2 FOR UPDATE',[f.org,f.estimateGraphs[0].ids.estimate]);
  const deadline=(await f.ownerPool.query("UPDATE auth_sessions SET access_expires_at=clock_timestamp()+interval '1 second' WHERE id=$1 RETURNING access_expires_at",[actor.authSessionId])).rows[0].access_expires_at;
  const start=Date.now();pending=post().then(r=>r);let observed=false;
  while(Date.now()-start<850){const q=await f.ownerPool.query("SELECT count(DISTINCT pid) n FROM pg_locks WHERE NOT granted AND $1=ANY(pg_blocking_pids(pid))",[blockerPid]);if(Number(q.rows[0].n)>0){observed=true;break;}await new Promise(r=>setTimeout(r,20));}
  assert(observed,'Actual aggregate waited on the owned estimate lock');await new Promise(r=>setTimeout(r,Math.max(0,+new Date(deadline)-Date.now()+80)));
  await blocker.query('ROLLBACK');const rejected=await pending;save('expiry-after-wait.json',{status:rejected.status,body:rejected.body,observed,deadline});assert([401,403].includes(rejected.status));assert.deepEqual(await contents(),original);ledger.push('current session expires after actual estimate wait; all rows unchanged');
 }finally{await blocker.query('ROLLBACK');if(pending)await pending;await f.ownerPool.query('UPDATE auth_sessions SET access_expires_at=$2 WHERE id=$1',[actor.authSessionId,expiry]);blocker.release();}
 const keys=[crypto.randomUUID(),crypto.randomUUID()],results=await Promise.all(keys.map(k=>post(body,headers,k)));save('concurrent-requests.json',results.map((r,i)=>({key:keys[i],status:r.status,body:r.body})));
 assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);const winner=results.findIndex(r=>r.status===201),after=await contents();save('risk-after.json',after);
 assert.equal(after.canonical_estimate_revisions.length,original.canonical_estimate_revisions.length+1);assert.equal(after.canonical_estimate_proposal_adoptions.length,1);for(const table of tables.slice(0,7))assert.equal(after[table].length,original[table].length+1,table+' one only');
 const exact=await post(body,headers,keys[winner]);assert.equal(exact.status,200);assert.equal(exact.body.data.replayed,true);const replayed=await contents();for(const table of tables.filter(t=>!t.endsWith('_fences')))assert.deepEqual(replayed[table],after[table]);
 const changed=await post({...body,reason:'A genuinely different review body'},headers,keys[winner]);assert.equal(changed.status,409);ledger.push('concurrent first adoption yields one child and one full component set; exact replay only');
 save('RISK_RESULT.json',{pass:true,ledger});
};
