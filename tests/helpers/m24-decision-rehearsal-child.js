'use strict';
// Runs only as an IPC child of the disposable upgrade rehearsal. No production start/workers.
const path=require('node:path'),assert=require('node:assert/strict');
const source=path.resolve(process.argv[2]),seed=process.argv[3]==='seed';
process.env.NODE_ENV='test';process.env.AUTH_ACCESS_SECRET='m24-decision-disposable-demo-test-secret-only';
for(const key of ['OPENAI_API_KEY','RETELL_API_KEY','STRIPE_SECRET_KEY'])delete process.env[key];
(async()=>{let fixture,db,server;try{
 let app,metadata={};
 if(seed){delete process.env.DATABASE_URL;delete process.env.MIGRATION_DATABASE_URL;fixture=await require(path.join(source,'tests/helpers/m24-estimate-review-fixture')).createEstimateReviewFixture();app=fixture.app;db=fixture.db;metadata={databaseUrl:process.env.DATABASE_URL,migrationUrl:process.env.MIGRATION_DATABASE_URL,actors:fixture.actors,graphs:fixture.estimateGraphs};}
 else{db=require(path.join(source,'src/db'));assert.equal(await db.initDatabase(),true);app=require(path.join(source,'src/server')).app;}
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));process.send({ready:true,origin:'http://127.0.0.1:'+server.address().port,...metadata});
 await new Promise(r=>process.once('message',r));await new Promise(r=>server.close(r));if(fixture)await fixture.cleanup();else await db.close();process.disconnect();
}catch(error){process.send({error:error.message});process.exitCode=1;}})();
