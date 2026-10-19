'use strict';

jest.setTimeout(900000);

const crypto=require('node:crypto');
const request=require('supertest');
const {createDatabaseFixture}=require('../helpers/m23-part9b-overview-fixture');
const contract=require('../../src/customerFinancial/fictionalDemoJourneyAcceptance');
const repository=require('../../src/customerFinancial/fictionalDemoJourneyAcceptanceRepository');
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

realPostgres('Mission 27 Part 14B mounted resettable fictional journey',()=>{
  let fixture,transport,readSpy;
  beforeAll(async()=>{
    for(const key of ['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','OPENAI_API_KEY','RETELL_API_KEY',
      'TWILIO_AUTH_TOKEN','RESEND_API_KEY','SMTP_HOST','SMTP_USER','SMTP_PASS']) delete process.env[key];
    transport=jest.spyOn(require('https'),'request').mockImplementation(()=>{
      throw new Error('External transport forbidden in Part 14B');});
    readSpy=jest.spyOn(repository,'read');
    fixture=await createDatabaseFixture();
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
    const reset=await resetRequest();const replay=await resetRequest();
    expect(reset.status).toBe(200);expect(replay.status).toBe(200);
    expect(reset.body.replayed).toBe(false);expect(replay.body.replayed).toBe(true);
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
    expect(transport).not.toHaveBeenCalled();
  });

  test('method body query CORS privacy and cross-session boundaries fail before source entry',async()=>{
    const entry=await request(fixture.app).get('/api/demo/command-center').set('Host',HOST);
    const savedCookie=cookie(entry),estimate=entry.body.data.graphs[0].ids.estimate,target=route(estimate);
    readSpy.mockClear();
    const widened=await request(fixture.app).get(target).query({tenantId:'victim',accountId:'acct_victim',
      amountMinorUnits:'100',credential:'sk_secret'}).set('Host',HOST).set('Cookie',savedCookie);
    expect(widened.status).toBe(400);expect(JSON.stringify(widened.body)).not.toMatch(/victim|acct_|100|sk_secret/);
    expect(readSpy).not.toHaveBeenCalled();
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
    expect(readSpy).not.toHaveBeenCalled();
    const second=await request(fixture.app).get('/api/demo/command-center').set('Host',HOST);
    expect((await request(fixture.app).get(target).set('Host',HOST).set('Cookie',cookie(second))).status)
      .toBe(404);
    expect(readSpy).toHaveBeenCalledTimes(1);
    expect(transport).not.toHaveBeenCalled();
  });
});
