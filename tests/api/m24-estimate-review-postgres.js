'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),request=require('supertest');
process.env.NODE_ENV='test';
for(const key of ['DATABASE_URL','MIGRATION_DATABASE_URL','OPENAI_API_KEY','RETELL_API_KEY','STRIPE_SECRET_KEY','POLARIS_OPENAI_ENABLED']) delete process.env[key];
const {createEstimateReviewFixture}=require('../helpers/m24-estimate-review-fixture');
const output=process.argv.find(v=>v.startsWith('--output=')).slice(9);
(async()=>{let f;const ledger={checks:[]};try{
 f=await createEstimateReviewFixture(); const graph=f.estimateGraphs[0], other=f.estimateGraphs[1];
 const url='/api/v1/canonical/estimates/'+graph.ids.estimate+'/review';
 async function read(actor='owner',target=url){return request(f.app).get(target).set(f.actors[actor].session.headers);}
 async function digest(){return (await f.ownerPool.query("SELECT (SELECT md5(string_agg(row_to_json(e)::text,'' ORDER BY id)) FROM canonical_estimates e) estimates,(SELECT md5(string_agg(row_to_json(s)::text,'' ORDER BY id)) FROM canonical_polaris_snapshots s) snapshots,(SELECT md5(string_agg(row_to_json(o)::text,'' ORDER BY id)) FROM canonical_operations o) operations")).rows[0];}
 ledger.database=(await f.ownerPool.query("SELECT current_setting('server_version') version,current_setting('TimeZone') timezone,current_setting('server_encoding') encoding,current_setting('data_checksums') checksums,(SELECT datcollate FROM pg_database WHERE datname=current_database()) locale")).rows[0];
 assert.match(ledger.database.version,/^18\./);assert.equal(ledger.database.timezone,'UTC');assert.equal(ledger.database.encoding,'UTF8');assert.equal(ledger.database.checksums,'on');assert.equal(ledger.database.locale,'C');
 const before=await digest();let result=await read();assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.headers['cache-control'],'no-store');
 const review=result.body.data;assert.equal(review.pins.estimateId,graph.ids.estimate);assert.equal(review.pins.snapshotDigest,graph.snapshotDigest);assert.equal(review.pins.normalizedInputFingerprint,graph.normalizedInputFingerprint);assert.equal(review.rows[0].amount,graph.snapshot.customerFacingPrice);assert.equal(review.rows[1].amount,0);assert.equal(review.approval,'not_recorded_here');ledger.checks.push('owner exact stored pins/amounts/zero/null/approval and no-store');
 for(const [actor,status] of [['admin',200],['dispatcher',403],['member',403],['viewer',403],['otherOwner',404]]) {result=await read(actor);assert.equal(result.status,status,actor+JSON.stringify(result.body));ledger.checks.push(actor+' '+status);}
 result=await request(f.app).get(url);assert.equal(result.status,401);ledger.checks.push('unauthenticated 401');
 result=await read('owner','/api/v1/canonical/estimates/'+other.ids.estimate+'/review');assert.equal(result.status,200);assert.equal(result.body.data.rows[0].amount,null);ledger.checks.push('incomplete exact estimate remains unpriced');
 assert.deepEqual(await digest(),before);ledger.checks.push('GETs do not change estimates/snapshots/operations');
 const {putBusinessProfile}=require('../../src/services/organizationAuthority');const profile=require('../helpers/m19-part3-business-profile').canonicalFenceProfile({customerMarkupPercent:12});profile.company.timeZone='UTC';await putBusinessProfile(f.ownerPool,{organizationId:f.org,userId:f.actors.owner.actorUserId,expectedVersion:'org-profile-v2',profile});result=await read();assert.equal(result.status,200);assert.deepEqual(result.body.data,review);ledger.checks.push('new profile does not reprice historical review');
 await f.ownerPool.query("UPDATE organization_memberships SET status='suspended' WHERE id=$1",[f.actors.admin.actorUserId]);result=await read('admin');assert.ok([401,403].includes(result.status));ledger.checks.push('inactive current membership denied');
 await f.ownerPool.query("UPDATE organization_memberships SET status='active',role='member' WHERE id=$1",[f.actors.admin.actorUserId]);result=await read('admin');assert.ok([401,403].includes(result.status));ledger.checks.push('changed durable access role denied');
 await f.ownerPool.query("UPDATE auth_sessions SET status='revoked' WHERE id=$1",[f.actors.owner.authSessionId]);result=await read();assert.equal(result.status,401);ledger.checks.push('revoked session denied');
 ledger.pass=true;
}finally{if(f)await f.cleanup();fs.writeFileSync(output,JSON.stringify(ledger,null,2));}})().catch(e=>{console.error(e);process.exitCode=1;});
