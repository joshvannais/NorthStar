'use strict';
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
process.env.NODE_ENV='test';process.env.AUTH_ACCESS_SECRET='operations-protected-local-fixture-only-secret';
for(const k of ['DATABASE_URL','MIGRATION_DATABASE_URL','OPENAI_API_KEY','RETELL_API_KEY','STRIPE_SECRET_KEY'])delete process.env[k];
const request=require('supertest'),{createDatabaseFixture}=require('../helpers/m23-part9b-overview-fixture');
const output=path.resolve(process.argv[2]);assert(!fs.existsSync(output));
(async()=>{let f;const evidence={cases:[]};try{
 f=await createDatabaseFixture();const work=await f.createExecution();
 for(const actor of [null,f.actors.member,f.actors.dispatcher,f.actors.owner]){
  const cookies=actor?Object.entries(actor.session.cookies).map(([k,v])=>k+'='+v).join('; '):null;
  for(const endpoint of ['/api/v1/operational-overview?state=active&limit=25','/api/v1/field-executions/owner-work']){
   let r=request(f.app).get(endpoint);if(cookies)r=r.set('Cookie',cookies);const response=await r;
   evidence.cases.push({actor:actor===null?'unauthenticated':actor===f.actors.member?'member':actor===f.actors.dispatcher?'dispatcher':'owner',endpoint,status:response.status,body:response.body});
   if(!actor)assert.equal(response.status,401);
   else if(actor===f.actors.owner)assert.equal(response.status,200);
   else if(endpoint.includes('owner-work'))assert.equal(response.status,403);
   else assert.equal(response.status,actor===f.actors.dispatcher?200:403);
  }
 }
 evidence.executionId=work.execution.id;
}catch(e){evidence.failure=e.stack;process.exitCode=1;}finally{fs.writeFileSync(output,JSON.stringify(evidence,null,2));await f?.cleanup();}})();
