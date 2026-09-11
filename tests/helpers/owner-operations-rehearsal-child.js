'use strict';
const path=require('path');
const source=path.resolve(process.argv[2]),seed=process.argv[3]==='seed';
process.env.NODE_ENV='test';process.env.AUTH_ACCESS_SECRET='owner-operations-rehearsal-local-only';
for(const key of ['OPENAI_API_KEY','RETELL_API_KEY','STRIPE_SECRET_KEY'])delete process.env[key];
let fixture,server,db;
(async()=>{
 let evidence={};
 if(seed){
  delete process.env.DATABASE_URL;delete process.env.MIGRATION_DATABASE_URL;
  fixture=await require(path.join(source,'tests/helpers/m23-part9b-overview-fixture')).createDatabaseFixture();
  const progress=await fixture.createExecution();await fixture.progress(progress);await fixture.fieldEvidence(progress,'record_note',{note:'Retained pre-upgrade field observation.',caption:null});
  const pending=await fixture.createExecution();await fixture.completion(pending);
  const complete=await fixture.createExecution(),proposal=await fixture.completion(complete);
  const record=proposal.body.completionRecord;
  await fixture.completion(complete,'approve_completion',{proposal:{id:record.id,revision:record.revision,digest:record.digest}});
  evidence={paidExecutionIds:[progress.execution.id,pending.execution.id,complete.execution.id],owner:fixture.actors.owner};
  db=fixture.db;
 }else{
  db=require(path.join(source,'src/db'));if(!await db.initDatabase())throw new Error('Candidate startup failed');
 }
 const app=fixture?fixture.app:require(path.join(source,'src/server')).app;
 server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 process.send({origin:'http://127.0.0.1:'+server.address().port,databaseUrl:process.env.DATABASE_URL,migrationUrl:process.env.MIGRATION_DATABASE_URL,...evidence});
 process.on('message',async message=>{if(message!=='stop')return;await new Promise(resolve=>server.close(resolve));if(fixture)await fixture.cleanup();else await db.close();process.exit(0);});
})().catch(error=>{process.send?.({error:error.message});process.exitCode=1;});
