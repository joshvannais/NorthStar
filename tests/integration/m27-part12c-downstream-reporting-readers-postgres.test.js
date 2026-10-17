'use strict';

const request=require('supertest');
const {createEstimateReviewFixture}=require('../helpers/m24-estimate-review-fixture');
const readers=require('../../src/customerFinancial/downstreamReportingReaders');

const realPostgres=process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

realPostgres('Mission 27 Part 12C mounted downstream reporting readers',()=>{
  let fixture;let transport;let repositoryRead;
  const route='/api/v1/customer-financial/reporting/downstream-readers';

  beforeAll(async()=>{
    for (const key of ['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','OPENAI_API_KEY',
      'RETELL_API_KEY','TWILIO_AUTH_TOKEN','RESEND_API_KEY','SMTP_HOST','SMTP_USER','SMTP_PASS']) {
      delete process.env[key];
    }
    repositoryRead=jest.spyOn(
      require('../../src/customerFinancial/downstreamReportingReadersRepository'),'read');
    transport=jest.spyOn(require('https'),'request').mockImplementation(()=>{
      throw new Error('External transport forbidden in Part 12C');
    });
    fixture=await createEstimateReviewFixture({additionalCompleteEstimates:1});
  },180000);

  afterAll(async()=>{try{if(fixture) await fixture.cleanup();}finally{jest.restoreAllMocks();}},180000);

  test('owner and administrator receive exact minimized value-free readers',async()=>{
    const owner=await request(fixture.app).get(route).set(fixture.actors.owner.session.headers);
    const admin=await request(fixture.app).get(route).set(fixture.actors.admin.session.headers);
    expect(owner.status).toBe(200);expect(admin.status).toBe(200);
    expect(owner.body.data).toEqual(admin.body.data);
    expect(()=>readers.project(owner.body.data,readers.defaultSources())).not.toThrow();
    expect(owner.headers['cache-control']).toContain('private');
    expect(owner.headers['cache-control']).toContain('no-store');
    expect(owner.headers.vary).toContain('Cookie');
    expect(owner.body.data).toMatchObject({
      contractVersion:'m27-downstream-reporting-readers-v1',state:'unavailable',
      reason:'downstream_reader_authority_unavailable',value:null,
      readerOrder:['mission25','mission26','mission33'],reportRowCount:0,
      learningObservationCount:0,forecastCount:0,platformFactCount:0,
      providerCallCount:0,providerMutationCount:0,receiverMutationCount:0,
      accountingMutationCount:0,downstreamReaderMutationCount:0,liveMoneyMovementCount:0,
    });
    expect(owner.body.data.readers.every(item=>item.state === 'unavailable' &&
      item.value === null && item.purposePermissionCurrent === false &&
      item.completeCoverageAvailable === false && item.emittedRecordCount === 0)).toBe(true);
    expect(JSON.stringify(owner.body.data)).not.toMatch(
      new RegExp(`${fixture.org}|${fixture.actors.owner.actorUserId}|customer@example|acct_|pi_|ch_`,'i'));
    expect(transport).not.toHaveBeenCalled();
  },120000);

  test('session role query tenant and subscription boundaries fail closed',async()=>{
    expect((await request(fixture.app).get(route)).status).toBe(401);
    expect((await request(fixture.app).get(route)
      .set(fixture.actors.member.session.headers)).status).toBe(403);
    const other=await request(fixture.app).get(route)
      .set(fixture.actors.otherOwner.session.headers);
    expect(other.status).toBe(200);expect(other.body.data).toEqual(readers.unavailable());
    expect(JSON.stringify(other.body)).not.toContain(fixture.org);
    repositoryRead.mockClear();
    const widened=await request(fixture.app).get(route)
      .query({tenantId:fixture.org,sourceDigest:'a'.repeat(64),purposePermission:'granted',
        amountMinorUnits:'100',identity:'victim',credential:'sk_secret'})
      .set(fixture.actors.owner.session.headers);
    expect(widened.status).toBe(400);expect(repositoryRead).not.toHaveBeenCalled();
    expect(JSON.stringify(widened.body)).not.toMatch(/victim|sk_secret|100|purposePermission/);
    await fixture.ownerPool.query(
      "UPDATE subscriptions SET status='canceled',updated_at=clock_timestamp() WHERE organization_id=$1",
      [fixture.org]);
    expect((await request(fixture.app).get(route)
      .set(fixture.actors.owner.session.headers)).status).toBe(403);
    await fixture.ownerPool.query(
      "UPDATE subscriptions SET status='active',updated_at=clock_timestamp() WHERE organization_id=$1",
      [fixture.org]);
    expect(transport).not.toHaveBeenCalled();
  },120000);

  test('body path and method matrices stop before parser throttle source or repository',async()=>{
    repositoryRead.mockClear();
    const bodyCases=[
      request(fixture.app).get(route).type('json').send({tenantId:fixture.org,
        sourceDigest:'a'.repeat(64),purposePermission:'granted',credential:'sk_secret'}),
      request(fixture.app).get(route).type('json').send([{identity:'victim'}]),
      request(fixture.app).get(route).type('json').send({}),
      request(fixture.app).get(route).type('json').send('"sk_secret_scalar"'),
      request(fixture.app).get(route).type('json').send('123456789'),
      request(fixture.app).get(route).type('json').send('true'),
      request(fixture.app).get(route).type('json').send('null'),
      request(fixture.app).get(route).type('json').send('{"credential":"sk_secret"'),
      request(fixture.app).get(route).type('form').send({accountId:'acct_secret'}),
      request(fixture.app).get(route).type('text').send('identity=victim'),
      request(fixture.app).get(route).type('application/octet-stream')
        .send(Buffer.from('amountMinorUnits=100')),
    ];
    for (const bodyRequest of bodyCases) {
      const response=await bodyRequest.set(fixture.actors.owner.session.headers);
      expect(response.status).toBe(400);
      expect(response.headers['cache-control']).toContain('private');
      expect(response.headers['cache-control']).toContain('no-store');
      expect(response.headers['x-ratelimit-limit']).toBeUndefined();
      expect(response.body).toEqual({success:false,error:{
        category:'CUSTOMER_FINANCIAL_DOWNSTREAM_READERS_INVALID',
        message:'Review the exact current downstream reporting evidence.'}});
      expect(JSON.stringify(response.body)).not.toMatch(
        /victim|acct_secret|sk_secret|123456789|amountMinorUnits|purposePermission/i);
      expect(repositoryRead).not.toHaveBeenCalled();
    }
    const equivalents=[
      '/API/v1/customer-financial/reporting/downstream-readers',
      '/api/V1/customer-financial/REPORTING/DOWNSTREAM-READERS',
      '/ApI/V1/CuStOmEr-FiNaNcIaL/RePoRtInG/DoWnStReAm-ReAdErS/',
      '/api/v1/customer-financial/reporting//downstream-readers',
      '/API/V1/CUSTOMER-FINANCIAL/REPORTING//DOWNSTREAM-READERS/',
      '/api/v1/customer-financial/reporting/downstream-readers?identity=victim',
    ];
    for (const pathName of equivalents) {
      const response=await request(fixture.app).get(pathName).type('json')
        .send('"sk_path_secret"').set(fixture.actors.owner.session.headers);
      expect(response.status).toBe(400);
      expect(response.headers['cache-control']).toContain('private');
      expect(response.headers['x-ratelimit-limit']).toBeUndefined();
      expect(JSON.stringify(response.body)).not.toMatch(/sk_path_secret|identity|victim/);
      expect(repositoryRead).not.toHaveBeenCalled();
    }
    const methods=['head','options','post','put','patch','delete','trace','propfind'];
    for (const pathName of [route,
      '/API/V1/CUSTOMER-FINANCIAL/REPORTING//DOWNSTREAM-READERS/?query=secret']) {
      for (const method of methods) for (const body of [undefined,'"sk_scalar_secret"',
        '{"credential":"sk_malformed"']) {
        let pending=request(fixture.app)[method](pathName)
          .set('Origin','http://localhost:3000').set('Access-Control-Request-Method','POST');
        if (body !== undefined) pending=pending.type('application/json').send(body);
        const response=await pending;
        expect(response.status).toBe(405);
        expect(response.headers['cache-control']).toContain('private');
        expect(response.headers.allow).toBeUndefined();
        if (method === 'options') expect(response.headers['access-control-allow-methods']).toBe('GET');
        expect(response.text || '').not.toMatch(/sk_scalar_secret|sk_malformed|credential/);
      }
    }
    expect(repositoryRead).not.toHaveBeenCalled();expect(transport).not.toHaveBeenCalled();
  },120000);

  test('restart preserves unavailable projection with no durable or external residue',async()=>{
    const count=async()=>(await fixture.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM integration_credentials) credentials,
      (SELECT count(*)::int FROM information_schema.tables WHERE table_schema='public' AND
       (table_name LIKE '%downstream%report%' OR table_name LIKE '%financial%reader%')) part12c_tables`))
      .rows[0];
    const before=await count();
    const first=await request(fixture.app).get(route).set(fixture.actors.owner.session.headers);
    expect(first.status).toBe(200);expect(await count()).toEqual(before);
    expect((await request(fixture.app).post(route)
      .set(fixture.actors.owner.session.headers).send({action:'publish'})).status).toBe(405);
    expect(await fixture.db.initDatabase()).toBe(true);
    const restarted=await request(fixture.app).get(route)
      .set(fixture.actors.owner.session.headers);
    expect(restarted.status).toBe(200);expect(restarted.body.data).toEqual(first.body.data);
    expect(await count()).toEqual(before);
    expect((await fixture.ownerPool.query(
      "SELECT count(*)::int count FROM public._migrations WHERE filename LIKE '273_%'"))
      .rows[0].count).toBe(0);
    expect(transport).not.toHaveBeenCalled();
  },180000);
});
