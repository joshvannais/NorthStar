'use strict';

jest.setTimeout(900000);

const crypto=require('node:crypto');
const http=require('node:http');
const request=require('supertest');
const {createDatabaseFixture}=require('../helpers/m23-part9b-overview-fixture');
const contract=require('../../src/customerFinancial/fictionalDemoJourneyAcceptance');
const detachedRepository=require('../../src/customerFinancial/fictionalDemoJourneyAcceptanceRepository');
const {DemoCommandCenterRepository}=require('../../src/commandCenter/demoRepository');
const {DEFAULT_SELECTION}=require('../../src/commandCenter/scenarioSpace');

const realPostgres=process.env.M19_PG_ADMIN_URL?describe:describe.skip;
const HOST='northstar.test'; const ORIGIN='http://northstar.test';
function cookie(response){return response.headers['set-cookie'][0].split(';')[0];}
function tokenHash(savedCookie){return crypto.createHash('sha256').update(
  decodeURIComponent(savedCookie.slice(savedCookie.indexOf('=')+1))).digest('hex');}
async function protectedCounts(pool){return (await pool.query(`SELECT
  (SELECT count(*)::int FROM canonical_customers) customers,
  (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_origins_v1) origins,
  (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_revisions_v1) drafts,
  (SELECT count(*)::int FROM canonical_customer_financial_invoice_tax_reviews_v1) tax_reviews,
  (SELECT count(*)::int FROM integration_credentials) credentials,
  (SELECT count(*)::int FROM public._migrations WHERE filename LIKE '273_%') migration273`)).rows[0];}
function route(estimate){return `/api/demo/customer-financial/invoice-drafts/${estimate}/part14b-acceptance`;}
function mutation(pending,cookieValue,intent,key){return pending.set('Host',HOST).set('Origin',ORIGIN)
  .set('Sec-Fetch-Site','same-origin').set('Cookie',cookieValue)
  .set('Idempotency-Key',key).set('X-NorthStar-Demo-Intent',intent);}
function deadline(message,ms){return new Promise((_,reject)=>{
  const timer=setTimeout(()=>reject(new Error(message)),ms);timer.unref?.();
});}

realPostgres('Mission 27 Part 14B mounted resettable fictional journey',()=>{
  let fixture,transport,journeyDbEntrySpy,forgedDetachedCalls=0;
  beforeAll(async()=>{
    for(const key of ['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','OPENAI_API_KEY','RETELL_API_KEY',
      'TWILIO_AUTH_TOKEN','RESEND_API_KEY','SMTP_HOST','SMTP_USER','SMTP_PASS']) delete process.env[key];
    transport=jest.spyOn(require('https'),'request').mockImplementation(()=>{
      throw new Error('External transport forbidden in Part 14B');});
    const compatibilityPath=require.resolve(
      '../../src/customerFinancial/fictionalDemoJourneyAcceptanceRepository');
    const realCompatibilityEntry=require.cache[compatibilityPath];
    require.cache[compatibilityPath]={id:compatibilityPath,filename:compatibilityPath,loaded:true,
      exports:new Proxy({}, {get(){forgedDetachedCalls+=1;return ()=>{forgedDetachedCalls+=1;};}}),
      children:[],paths:[]};
    try { fixture=await createDatabaseFixture();
      journeyDbEntrySpy=jest.spyOn(fixture.db.getPool(),'connect'); }
    finally { require.cache[compatibilityPath]=realCompatibilityEntry; }
  },180000);
  afterAll(async()=>{try{if(fixture)await fixture.cleanup();}finally{jest.restoreAllMocks();}},180000);

  test('uses one isolated fictional namespace and reset restores exact canonical lifecycle baseline',async()=>{
    const before=await protectedCounts(fixture.ownerPool);
    const entry=await request(fixture.app).get('/api/demo/command-center').set('Host',HOST);
    expect(entry.status).toBe(200);const savedCookie=cookie(entry);
    const firstEstimate=entry.body.data.graphs[0].ids.estimate;
    const simulationKey=crypto.randomUUID();
    const simulated=await mutation(request(fixture.app)
      .post('/api/demo/command-center/simulations/leads'),savedCookie,'simulate-lead',simulationKey)
      .send({expectedRevision:entry.body.data.integrity.revision,
        scenario:{...DEFAULT_SELECTION,service:'roofing'}});
    expect(simulated.status).toBe(201);expect(simulated.body.data.graphs).toHaveLength(4);
    const changed=await request(fixture.app).get(route(firstEstimate)).set('Host',HOST)
      .set('Cookie',savedCookie);
    expect(changed.status).toBe(200);expect(changed.headers['cache-control']).toContain('private');
    expect(changed.headers['cache-control']).toContain('no-store');expect(changed.headers.vary).toContain('Cookie');
    const session=(await fixture.ownerPool.query(
      `SELECT id,tenant_id FROM demo_command_center_sessions WHERE token_hash=$1`,
      [tokenHash(savedCookie)])).rows[0];
    expect(contract.project(changed.body.data,changed.body.data.part12Bundle,{
      tenantId:session.tenant_id,sessionId:session.id,
      estimateId:firstEstimate,workspaceRevision:2,
      workspaceGeneration:changed.body.data.journeyAcceptance.reset.currentGeneration,
      workspaceSeedDigest:changed.body.data.journeyAcceptance.journeyBinding.workspaceSeedDigest,
      workspaceStateDigest:changed.body.data.journeyAcceptance.journeyBinding.workspaceStateDigest,
      canonicalBaseline:false,currentMutationKeyCount:0,simulationCount:1})).toEqual(changed.body.data);
    expect(changed.body.data.journeyAcceptance.reset).toMatchObject({canonicalBaseline:false,
      currentWorkspaceRevision:2,currentSimulationCount:1,resetRemovesUserCreatedDemoMutations:true});
    expect(changed.body.data.journeyAcceptance.lifecycle.stages.map(value=>value.name))
      .toEqual(contract.STAGE_ORDER);
    expect(changed.body.data.journeyAcceptance.lifecycle.stages.map(value=>value.state))
      .toEqual(contract.STAGE_STATES);
    expect(changed.body.data.journeyAcceptance.launchMatrix).toMatchObject({
      offlineCashReceiptEnabled:true,offlineCheckReceiptEnabled:true,
      checkClearedTransitionEnabled:false,checkClearanceState:'check_clearance_authority_unavailable'});
    const resetKey=crypto.randomUUID();
    const resetRequest=()=>mutation(request(fixture.app).post('/api/demo/command-center/reset'),
      savedCookie,'reset',resetKey).send({expectedRevision:2});
    const concurrent=await Promise.all([resetRequest(),resetRequest()]);
    expect(concurrent.map(value=>value.status)).toEqual([200,200]);
    expect(concurrent.map(value=>value.body.replayed).sort()).toEqual([false,true]);
    const reset=concurrent.find(value=>!value.body.replayed);
    const replay=concurrent.find(value=>value.body.replayed);
    expect(replay.body.data).toEqual(reset.body.data);
    expect(reset.body.data.graphs).toHaveLength(3);expect(reset.body.data.session.simulationCount).toBe(0);
    const resetEstimate=reset.body.data.graphs[0].ids.estimate;
    expect(resetEstimate).not.toBe(firstEstimate);
    const recovered=await request(fixture.app).get(route(resetEstimate)).set('Host',HOST)
      .set('Cookie',savedCookie);
    expect(recovered.status).toBe(200);
    expect(recovered.body.data.journeyAcceptance.reset).toMatchObject({canonicalBaseline:true,
      currentWorkspaceRevision:3,currentSimulationCount:0,currentMutationKeyCount:0});
    expect(recovered.body.data.journeyAcceptance.sourceReadCount).toBe(2);
    for(const key of ['providerCallCount','providerMutationCount','receiverMutationCount',
      'outboundMessageCount','accountingMutationCount','downstreamMutationCount',
      'paidRepositoryReadCount','productionDatabaseMutationCount','liveMoneyMovementCount'])
      expect(recovered.body.data.journeyAcceptance[key]).toBe(0);
    expect(await protectedCounts(fixture.ownerPool)).toEqual(before);
    expect(forgedDetachedCalls).toBe(0);
    expect(transport).not.toHaveBeenCalled();
  });

  test('method body query CORS privacy and cross-session boundaries fail before source entry',async()=>{
    const entry=await request(fixture.app).get('/api/demo/command-center').set('Host',HOST);
    const savedCookie=cookie(entry),estimate=entry.body.data.graphs[0].ids.estimate,target=route(estimate);
    journeyDbEntrySpy.mockClear();
    const widened=await request(fixture.app).get(target).query({tenantId:'victim',accountId:'acct_victim',
      amountMinorUnits:'100',credential:'sk_secret'}).set('Host',HOST).set('Cookie',savedCookie);
    expect(widened.status).toBe(400);expect(JSON.stringify(widened.body)).not.toMatch(/victim|acct_|100|sk_secret/);
    expect(journeyDbEntrySpy).not.toHaveBeenCalled();
    for(const body of ['"sk_scalar_secret"','{"credential":"sk_malformed"',
      JSON.stringify({accountId:'acct_victim',amountMinorUnits:100})]){
      const response=await request(fixture.app).get(target).type('application/json').send(body)
        .set('Host',HOST).set('Cookie',savedCookie);
      expect(response.status).toBe(400);expect(response.headers['cache-control']).toContain('private');
      expect(response.headers['cache-control']).toContain('no-store');
      expect(JSON.stringify(response.body)).not.toMatch(/sk_scalar|sk_malformed|acct_victim|100/);
    }
    for(const method of ['head','options','post','put','patch','delete','trace','propfind']){
      const response=await request(fixture.app)[method](target).set('Host',HOST).set('Cookie',savedCookie)
        .set('Origin',ORIGIN).set('Access-Control-Request-Method','POST')
        .type('application/json').send('"sk_method_secret"');
      expect(response.status).toBe(405);expect(response.headers.allow).toBe('GET');
      expect(response.headers['access-control-allow-methods']).toBeUndefined();
      expect(response.headers['cache-control']).toContain('private');
      expect(JSON.stringify(response.body||{})).not.toMatch(/sk_method_secret/);
    }
    expect(journeyDbEntrySpy).not.toHaveBeenCalled();
    const second=await request(fixture.app).get('/api/demo/command-center').set('Host',HOST);
    expect((await request(fixture.app).get(target).set('Host',HOST).set('Cookie',cookie(second))).status)
      .toBe(404);
    expect(journeyDbEntrySpy).toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });

  test('serializes the final Part14B projection and response against reset on the exact session',async()=>{
    const entry=await request(fixture.app).get('/api/demo/command-center').set('Host',HOST);
    const savedCookie=cookie(entry),estimate=entry.body.data.graphs[0].ids.estimate;
    const independent=await request(fixture.app).get('/api/demo/command-center').set('Host',HOST);
    const independentCookie=cookie(independent);
    const simulated=await mutation(request(fixture.app)
      .post('/api/demo/command-center/simulations/leads'),savedCookie,'simulate-lead',crypto.randomUUID())
      .send({expectedRevision:entry.body.data.integrity.revision,
        scenario:{...DEFAULT_SELECTION,service:'roofing'}});
    expect(simulated.status).toBe(201);expect(simulated.body.data.integrity.revision).toBe(2);
    let enteredResolve,releaseResolve,abortEnteredResolve;
    const entered=new Promise(resolve=>{enteredResolve=resolve;});
    const release=new Promise(resolve=>{releaseResolve=resolve;});
    const abortEntered=new Promise(resolve=>{abortEnteredResolve=resolve;});
    const originalSend=fixture.app.response.send;
    let responseBarrierMode='hold';
    const responseBarrier=jest.spyOn(fixture.app.response,'send').mockImplementation(
      function(...args){
        if(responseBarrierMode==='hold'&&this.req?.url?.includes('/part14b-acceptance')){
          responseBarrierMode=null;
          enteredResolve();release.then(()=>originalSend.apply(this,args));return this;
        }
        if(responseBarrierMode==='abort'&&this.req?.url?.includes('/part14b-acceptance')){
          responseBarrierMode=null;
          this.type('application/json');this.write('{"success":');
          abortEnteredResolve();setImmediate(()=>this.socket?.destroy());return this;
        }
        return originalSend.apply(this,args);
      });
    try {
      const settlementOrder=[];
      let barrierObserved=false;
      const pendingRead=request(fixture.app).get(route(estimate)).set('Host',HOST)
        .set('X-Part14B-Response-Barrier','hold')
        .set('Cookie',savedCookie).then(value=>{if(!barrierObserved)throw new Error(
          `Part14B response completed before barrier: ${value.status} ${JSON.stringify(value.body)}`);
          settlementOrder.push('read');return value;});
      await Promise.race([entered.then(()=>{barrierObserved=true;}),pendingRead,
        deadline('Part14B serialization barrier was not reached',600000)]);
      const independentReset=await Promise.race([
        mutation(request(fixture.app).post('/api/demo/command-center/reset'),
          independentCookie,'reset',crypto.randomUUID()).send({expectedRevision:1}),
        new Promise((_,reject)=>setTimeout(
          ()=>reject(new Error('Independent demo reset was blocked by another session read')),5000))
      ]);
      expect(independentReset.status).toBe(200);
      expect(independentReset.body.data.integrity.revision).toBe(2);
      let resetSettled=false;
      const pendingReset=mutation(request(fixture.app).post('/api/demo/command-center/reset'),
        savedCookie,'reset',crypto.randomUUID()).send({expectedRevision:2})
        .then(value=>{resetSettled=true;settlementOrder.push('reset');return value;});
      let waiting=false;
      for(let attempt=0;attempt<100&&!waiting;attempt+=1){
        const row=await fixture.ownerPool.query(
          "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted) waiting");
        waiting=row.rows[0].waiting;if(!waiting)await new Promise(resolve=>setTimeout(resolve,10));
      }
      expect(waiting).toBe(true);expect(resetSettled).toBe(false);
      releaseResolve();
      const lockedRead=await pendingRead;const reset=await pendingReset;
      expect(settlementOrder).toEqual(['read','reset']);
      expect(lockedRead.status).toBe(200);
      expect(lockedRead.body.data.journeyAcceptance.reset.currentWorkspaceRevision).toBe(2);
      expect(reset.status).toBe(200);expect(reset.body.data.integrity.revision).toBe(3);
      const stale=await request(fixture.app).get(route(estimate)).set('Host',HOST)
        .set('Cookie',savedCookie);
      expect(stale.status).toBe(404);
      const currentEstimate=reset.body.data.graphs[0].ids.estimate;
      const current=await request(fixture.app).get(route(currentEstimate)).set('Host',HOST)
        .set('Cookie',savedCookie);
      expect(current.status).toBe(200);
      expect(current.body.data.journeyAcceptance.reset.currentWorkspaceRevision).toBe(3);
      const failedReset=await mutation(request(fixture.app).post('/api/demo/command-center/reset'),
        savedCookie,'reset',crypto.randomUUID()).send({expectedRevision:2});
      expect(failedReset.status).toBe(409);
      const afterFailedReset=await fixture.ownerPool.query(
        'SELECT revision FROM demo_command_center_sessions WHERE token_hash=$1',
        [tokenHash(savedCookie)]);
      expect(afterFailedReset.rows).toHaveLength(1);
      expect(Number(afterFailedReset.rows[0].revision)).toBe(3);
      responseBarrierMode='abort';
      const mounted=await new Promise((resolve,reject)=>{
        const server=fixture.app.listen(0,'127.0.0.1',()=>resolve(server));server.once('error',reject);
      });
      try {
        const aborted=new Promise(resolve=>{
          let settled=false;const finish=value=>{if(!settled){settled=true;resolve(value);}};
          const pending=http.request({host:'127.0.0.1',port:mounted.address().port,method:'GET',
            path:route(currentEstimate),headers:{Host:HOST,Cookie:savedCookie}},response=>{
            response.resume();response.once('end',()=>finish(false));
            response.once('aborted',()=>finish(true));response.once('error',()=>finish(true));
            response.once('close',()=>{if(!response.complete)finish(true);});
          });
          pending.once('error',()=>finish(true));pending.end();
        });
        await Promise.race([abortEntered,
          deadline('Part14B abort barrier was not reached',600000)]);
        expect(await aborted).toBe(true);
      } finally {
        mounted.closeAllConnections?.();
        await new Promise(resolve=>mounted.close(resolve));
      }
      const afterAbort=await Promise.race([
        mutation(request(fixture.app).post('/api/demo/command-center/reset'),savedCookie,
          'reset',crypto.randomUUID()).send({expectedRevision:3}),
        new Promise((_,reject)=>setTimeout(
          ()=>reject(new Error('Aborted Part14B response leaked its session lock')),10000)),
      ]);
      expect(afterAbort.status).toBe(200);
      expect(afterAbort.body.data.integrity.revision).toBe(4);
      expect(transport).not.toHaveBeenCalled();
    } finally {responseBarrier.mockRestore();releaseResolve();}
  });

  test('rejects every Express-matched malformed identifier and composed request before session entry',async()=>{
    const entry=await request(fixture.app).get('/api/demo/command-center').set('Host',HOST);
    const savedCookie=cookie(entry),valid=entry.body.data.graphs[0].ids.estimate;
    journeyDbEntrySpy.mockClear();
    const base='/api/demo/customer-financial/invoice-drafts/';
    const suffix='/part14b-acceptance';
    for(const segment of ['not-a-uuid','x'.repeat(2048),'caf%C3%A9','%2F','%252F','%E0%A4%A']) {
      const response=await request(fixture.app).get(base+segment+suffix+'?secret=sk_query&secret=again')
        .set('Host',HOST).set('Cookie',savedCookie);
      expect({segment,status:response.status}).toEqual({segment,status:400});
      expect(response.headers['cache-control']).toContain('private');
      expect(response.headers['cache-control']).toContain('no-store');
      expect(response.headers['x-request-id']).toBeUndefined();
      expect(JSON.stringify(response.body)).not.toMatch(/sk_query|not-a-uuid|café/);
      expect(journeyDbEntrySpy).not.toHaveBeenCalled();
    }
    for(const path of [base+valid+suffix,base+'not-a-uuid'+suffix]) {
      const content=await request(fixture.app).get(path).set('Host',HOST).set('Cookie',savedCookie)
        .set('Content-Type','application/json');
      expect(content.status).toBe(400);expect(content.headers['x-request-id']).toBeUndefined();
      const method=await request(fixture.app).options(path).set('Host',HOST).set('Cookie',savedCookie)
        .set('Origin',ORIGIN).set('Content-Type','application/json').send('"sk_method"');
      expect(method.status).toBe(405);expect(method.headers.allow).toBe('GET');
      expect(method.headers['access-control-allow-methods']).toBeUndefined();
      expect(method.headers['x-request-id']).toBeUndefined();
      expect(journeyDbEntrySpy).not.toHaveBeenCalled();
    }
    const server=await new Promise((resolve,reject)=>{
      const mounted=fixture.app.listen(0,'127.0.0.1',()=>resolve(mounted));
      mounted.once('error',reject);
    });
    try {
      const raw=path=>new Promise((resolve,reject)=>{
        const pending=http.request({host:'127.0.0.1',port:server.address().port,
          method:'GET',path,headers:{Host:HOST,Cookie:savedCookie}},response=>{
          let body='';response.setEncoding('utf8');response.on('data',chunk=>{body+=chunk;});
          response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body}));
        });
        pending.once('error',reject);pending.end();
      });
      for(const segment of ['..','%2e','%2E%2E','%2f','%5c']) {
        const response=await raw(base+segment+suffix+'?secret=sk_raw');
        expect({segment,status:response.status}).toEqual({segment,status:400});
        expect(response.headers['cache-control']).toContain('private');
        expect(response.headers['cache-control']).toContain('no-store');
        expect(response.headers['x-request-id']).toBeUndefined();
        expect(response.body).not.toMatch(/sk_raw/);
        expect(journeyDbEntrySpy).not.toHaveBeenCalled();
      }
      expect(journeyDbEntrySpy).not.toHaveBeenCalled();
      const empty=await raw(base+'/'+suffix.slice(1)+'?secret=sk_raw');
      expect(empty.status).toBe(404);
    } finally {await new Promise(resolve=>server.close(resolve));}
    expect(transport).not.toHaveBeenCalled();
  });

  test('exposes no detached record, token, transaction, loader, or reusable lock capability',async()=>{
    expect(Object.isFrozen(detachedRepository)).toBe(true);
    expect(Object.getPrototypeOf(detachedRepository)).toBeNull();
    expect(Reflect.ownKeys(detachedRepository)).toEqual([]);
    expect(DemoCommandCenterRepository.prototype.withCurrentReadAuthority).toBeUndefined();
    expect(DemoCommandCenterRepository.prototype.deliverFictionalDemoJourney).toBeUndefined();
    const aliases=['read','recordContext','serializeResponse','bundle','project','load','token','transaction'];
    for(const name of aliases) expect(detachedRepository[name]).toBeUndefined();
    const before=await protectedCounts(fixture.ownerPool);
    const detached={tenantId:crypto.randomUUID(),sessionId:crypto.randomUUID(),revision:1,
      simulationCount:0,state:{generation:1,seed:'0'.repeat(64)}};
    for(const name of aliases) expect(()=>detachedRepository[name]?.(detached,crypto.randomUUID()))
      .not.toThrow();
    expect(await protectedCounts(fixture.ownerPool)).toEqual(before);
    expect(transport).not.toHaveBeenCalled();
  });
});
