'use strict';

jest.setTimeout(300000);

const fs = require('node:fs');
const path = require('node:path');
const cors = require('cors');
const express = require('express');
const request = require('supertest');
const part12 = require('../../src/customerFinancial/reportingPart12Acceptance');
const contract = require('../../src/customerFinancial/paidTenantJourneyAcceptance');
const repository = require('../../src/customerFinancial/paidTenantJourneyAcceptanceRepository');
const { paidTenantJourneyAcceptanceBoundary } =
  require('../../src/middleware/paidTenantJourneyAcceptanceBoundary');
const { corsOptions } = require('../../src/middleware/security');
const { createCustomerFinancialEditableEstimateRouter } =
  require('../../src/routes/customerFinancialEditableEstimate');

const ROOT = path.resolve(__dirname, '../..');
const ESTIMATE = '11111111-1111-4111-8111-111111111111';
const RECEIPT = '22222222-2222-4222-8222-222222222222';
const DIGEST = 'a'.repeat(64);
const TENANT = '44444444-4444-4444-8444-444444444444';
const USER = '55555555-5555-4555-8555-555555555555';
const SESSION = '66666666-6666-4666-8666-666666666666';
const clone = value => JSON.parse(JSON.stringify(value));

function mutate(target, pathParts, replacement) {
  let holder = target;
  for (let index = 0; index < pathParts.length - 1; index += 1) holder = holder[pathParts[index]];
  holder[pathParts.at(-1)] = replacement;
}

function fastPart12() {
  return { part12Acceptance:{ state:'incomplete', reason:'part12_reporting_evidence_incomplete' } };
}

function withFastPart12(run) {
  const spy = jest.spyOn(part12, 'projectBundle').mockImplementation(value => value);
  try { return run(fastPart12()); }
  finally { spy.mockRestore(); }
}

async function withFastPart12Async(run) {
  const spy = jest.spyOn(part12, 'projectBundle').mockImplementation(value => value);
  try { return await run(fastPart12()); }
  finally { spy.mockRestore(); }
}

function app(read, counters = {}) {
  const application = express();
  application.use(paidTenantJourneyAcceptanceBoundary);
  application.use(cors(corsOptions));
  application.use(express.json({ verify(req, _res, buffer) { req.rawBody = buffer.toString(); } }));
  const auth = (req, res, next) => {
    counters.auth = (counters.auth || 0) + 1;
    if (req.get('X-Test-Auth') !== 'current') return res.status(401).json({ success:false });
    req.tenantContext = { organizationId:TENANT, userId:USER };
    req.authSession = { id:SESSION };
    req.userRole = req.get('X-Test-Role') || 'owner';
    return next();
  };
  const role = (req, res, next) => {
    counters.role = (counters.role || 0) + 1;
    return ['owner','admin'].includes(req.userRole) ? next() : res.status(403).json({ success:false });
  };
  const throttle = (_req, _res, next) => {
    counters.throttle = (counters.throttle || 0) + 1;
    next();
  };
  application.use('/api/v1/customer-financial/editable-estimates',
    createCustomerFinancialEditableEstimateRouter({ auth, role, throttle,
      poolProvider:() => ({}), paidTenantJourneyAcceptanceRead:read }));
  return application;
}

describe('Mission 27 Part 14A paid provider-disabled journey', () => {
  test('projects the exact launch matrix, ordered integrated fixture and offline semantics', () => {
    withFastPart12(source => {
      const value = contract.candidate(source);
      expect(contract.project(clone(value), source)).toEqual(value);
    expect(value).toMatchObject({
      contractVersion:'m27-paid-provider-disabled-journey-v1',
      state:'complete_provider_disabled', reason:'live_capability_disabled', value:null,
      mode:'paid', fictional:false,
      launchMatrix:{ rolloutStage:'disabled', liveCapabilityEnabled:false,
        providerMode:'test', providerMethod:'card', partialProviderPaymentsEnabled:false,
        multiInvoiceProviderPaymentsEnabled:false, offlineCashReceiptEnabled:true,
        offlineCheckReceiptEnabled:true, checkClearedTransitionEnabled:false,
        checkClearanceAuthority:'unavailable_until_authenticated_bank_source',
        checkClearanceUnavailableState:'check_clearance_authority_unavailable' },
      fixture:{ fixtureVersion:'m27-local-synthetic-provider-fixture-v1', deterministic:true,
        inProcess:true, providerAccountUsed:false, credentialUsed:false,
        externalTransportUsed:false, liveMoneyUsed:false,
        offline:{ reviewedCurrentHumanRequired:true,
          cashReceiptState:'offline_received',
          cashEffect:'reduce_collectible_balance_by_exact_allocation',
          cashCustomerReceiptState:'unavailable', cashAccountingHandoffState:'unavailable',
          cashReportingState:'incomplete', cashProviderSettlementClaimed:false,
          checkReceiptState:'check_clearance_unknown',
          checkEffect:'pending_tender_blocks_collection_only',
          checkFaceOrSettledBalanceChanged:false, checkCollectionActionBlocked:true,
          checkClearedState:'check_clearance_authority_unavailable',
          providerOrBankSettlementClaimed:false } },
      separation:{ fixtureEvidenceIsFinancialTruth:false,
        fixtureEvidenceMayCreateProviderOrBankSettlement:false,
        fixtureEvidenceMayCreateInvoicePaymentRefundReceiptOrAccountingRecord:false,
        unavailableMayBecomeZero:false, providerSuccessMayImplySettlement:false,
        checkReceivedMayImplyClearance:false },
      authorityAndCurrentness:{ exactTenantSessionRoleAndRecordScopeRequired:true,
        currentHumanReviewAndIssueAuthorityRequired:true,
        idempotencyKeyAndExactRequestDigestRequiredForConsequentialActions:true,
        oneConcurrentWriterPerAggregate:true, duplicateConsequentialEffectAllowed:false,
        customerPrivateOrProviderSecretReturned:false },
      acceptance:{ exactPaidProductionModulesMounted:true,
        completeOrderedLocalSyntheticTracePresent:true,
        providerDisabledBoundaryPreserved:true,
        partialAndMultiInvoicePathsCorrectlyExcluded:true,
        offlineCashAndCheckSemanticsCovered:true,
        providerSandboxEvidenceAccepted:false, livePaymentEvidenceAccepted:false },
      providerCallCount:0, providerMutationCount:0, receiverMutationCount:0,
      accountingMutationCount:0, downstreamMutationCount:0,
      databaseMutationCount:0, liveMoneyMovementCount:0,
    });
      expect(value.fixture.stages.map(stage => stage.stage)).toEqual([...contract.STAGE_ORDER]);
      expect(value.fixture.stages.every(stage => stage.syntheticOnly &&
        !stage.financialTruthAccepted && !stage.durableProductionEffectCreated &&
        !stage.externalEffectCreated)).toBe(true);
      expect(value.sourceWitnesses.map(sourceWitness => sourceWitness.source)).toEqual([
        'part12_reporting_acceptance','part13_release_authority',
      ]);
      expect(value.sourceWitnesses.every(sourceWitness =>
        /^[0-9a-f]{64}$/.test(sourceWitness.digest))).toBe(true);
      expect(value.releasedPart13).toEqual(contract.RELEASED_PART13);
    });
  });

  test('rejects every contradictory section before acceptance', () => {
    withFastPart12(source => {
      const canonical = contract.candidate(source);
      const cases = [
        ['state',['state'],'complete_live'],
        ['reason',['reason'],'provider_sandbox_accepted'],
        ['source digest',['sourceWitnesses',0,'digest'],'f'.repeat(64)],
        ['source order',['sourceWitnesses'],null],
        ['launch method',['launchMatrix','providerMethod'],'bank_account'],
        ['partial policy',['launchMatrix','partialProviderPaymentsEnabled'],true],
        ['check authority',['launchMatrix','checkClearanceUnavailableState'],'check_cleared'],
        ['fixture version',['fixture','fixtureVersion'],'live-provider-v1'],
        ['stage semantics',['fixture','stages',4,'productionState'],'settled'],
        ['offline cash',['fixture','offline','cashEffect'],'mark_invoice_paid'],
        ['offline check',['fixture','offline','checkFaceOrSettledBalanceChanged'],true],
        ['authority',['authorityAndCurrentness','oneConcurrentWriterPerAggregate'],false],
        ['separation',['separation','fixtureEvidenceIsFinancialTruth'],true],
        ['effect',['providerCallCount'],1],
        ['verdict',['acceptance','providerSandboxEvidenceAccepted'],true],
      ];
      for (const [_name, fieldPath, replacement] of cases) {
        const raw = clone(canonical);
        if (replacement === null) raw.sourceWitnesses.reverse();
        else mutate(raw, fieldPath, replacement);
        expect(() => contract.project(raw, source)).toThrow(
          'Paid provider-disabled journey acceptance boundary invalid');
      }
    });
  });

  test('rejects non-plain, accessor, symbol and toJSON masquerades without invoking hooks', () => {
    withFastPart12(source => {
      const canonical = contract.candidate(source);
      let hooks = 0;
      const attempts = [];
      const inherited = Object.create(canonical);
      attempts.push(inherited);
      const withToJSON = clone(canonical);
      Object.defineProperty(withToJSON, 'toJSON',
        { enumerable:false, value() { hooks += 1; return canonical; } });
      attempts.push(withToJSON);
      const withGetter = clone(canonical);
      Object.defineProperty(withGetter, 'state',
        { enumerable:true, get() { hooks += 1; return canonical.state; } });
      attempts.push(withGetter);
      const withSymbol = clone(canonical);
      withSymbol[Symbol('secret')] = 'forged';
      attempts.push(withSymbol);
      for (const attempt of attempts) expect(() => contract.project(attempt, source)).toThrow();
      expect(hooks).toBe(0);

      for (const prototype of [Object.prototype, Array.prototype]) {
        for (const descriptor of [
          { configurable:true, value() { hooks += 1; return canonical; } },
          { configurable:true, get() { hooks += 1; return () => canonical; } },
        ]) {
          Object.defineProperty(prototype, 'toJSON', descriptor);
          let rejected = false;
          try { contract.project(canonical, source); }
          catch (_error) { rejected = true; }
          finally { delete prototype.toJSON; }
          expect(rejected).toBe(true);
        }
      }
      expect(hooks).toBe(0);
    });
  });

  test('consumes atomic Part 12 state, rejects source drift and shares no request state', async () => {
    await withFastPart12Async(async current => {
      const sourceA = { organizationId:TENANT, actorUserId:USER,
        actorAccessRole:'owner', authSessionId:SESSION };
      const sourceB = { ...sourceA,
        organizationId:'77777777-7777-4777-8777-777777777777' };
      const readPart12 = jest.fn(async (_pool, source) => clone(current));
      const [a,b] = await Promise.all([
        repository.read({}, sourceA, ESTIMATE, RECEIPT, DIGEST, { readPart12 }),
        repository.read({}, sourceB, ESTIMATE, RECEIPT, DIGEST, { readPart12 }),
      ]);
      expect(contract.project(clone(a), current)).toEqual(a);
      expect(b).toEqual(a);
      expect(readPart12).toHaveBeenCalledTimes(2);
      const tenants = readPart12.mock.calls.map(call => call[1].organizationId);
      expect(tenants.filter(value => value === TENANT)).toHaveLength(1);
      expect(tenants.filter(value => value === sourceB.organizationId)).toHaveLength(1);
      const driftingRead = jest.fn().mockRejectedValue(Object.assign(
        new Error('Part 12 changed'), { code:'CUSTOMER_FINANCIAL_REPORTING_PART12_CHANGED' }));
      await expect(repository.read({}, sourceA, ESTIMATE, RECEIPT, DIGEST,
        { readPart12:driftingRead })).rejects.toMatchObject({
        code:'CUSTOMER_FINANCIAL_PAID_JOURNEY_CHANGED', status:409,
      });
    });
  });

  test('enforces private auth, role, exact query, body, method and GET-only CORS boundaries', async () => {
    const value = withFastPart12(source => contract.candidate(source));
    const read = jest.fn().mockResolvedValue(value);
    const counters = {};
    const application = app(read, counters);
    const route = `/api/v1/customer-financial/editable-estimates/${ESTIMATE}` +
      '/paid-tenant-journey-acceptance';
    const query = { handoffReceiptId:RECEIPT, handoffReceiptDigest:DIGEST };
    const headers = { 'X-Test-Auth':'current', 'X-Test-Role':'owner' };
    const ok = await request(application).get(route).query(query).set(headers);
    expect(ok.status).toBe(200);
    expect(ok.headers['cache-control']).toContain('private');
    expect(ok.headers['cache-control']).toContain('no-store');
    expect(ok.body.data).toEqual(value);
    expect((await request(application).get(route).query(query)).status).toBe(401);
    expect((await request(application).get(route).query(query)
      .set({ ...headers, 'X-Test-Role':'member' })).status).toBe(403);
    read.mockClear();
    const widened = await request(application).get(route)
      .query({ ...query, accountId:'acct_victim', amountMinorUnits:'100', credential:'sk_secret' })
      .set(headers);
    expect(widened.status).toBe(400);
    expect(JSON.stringify(widened.body)).not.toMatch(/acct_victim|100|sk_secret/);
    expect(read).not.toHaveBeenCalled();
    const beforeBoundary = { ...counters };
    for (const body of ['"sk_scalar"','{"credential":"sk_malformed"',
      JSON.stringify({ accountId:'acct_victim', amountMinorUnits:100 })]) {
      const response = await request(application).get(route).query(query).set(headers)
        .type('application/json').send(body);
      expect(response.status).toBe(400);
      expect(response.headers['cache-control']).toContain('private');
      expect(response.headers['cache-control']).toContain('no-store');
      expect(JSON.stringify(response.body)).not.toMatch(/sk_scalar|sk_malformed|acct_victim|100/);
    }
    for (const method of ['head','options','post','put','patch','delete','trace','propfind']) {
      const response = await request(application)[method](route).query(query)
        .set(headers).set('Origin','http://localhost:3000')
        .set('Access-Control-Request-Method','POST')
        .type('application/json').send('"sk_method"');
      expect(response.status).toBe(405);
      expect(response.headers.allow).toBe('GET');
      expect(response.headers['access-control-allow-methods']).toBeUndefined();
      expect(response.headers['cache-control']).toContain('private');
      expect(JSON.stringify(response.body || {})).not.toMatch(/sk_method/);
    }
    expect(read).not.toHaveBeenCalled();
    expect(counters).toEqual(beforeBoundary);
  });

  test('ratifies Part 13 release, exact Part 14A authority and migration 272/no273', () => {
    const roadmap = fs.readFileSync(path.join(ROOT,
      'docs/roadmap/MISSION_27_CUSTOMER_FINANCIAL_LIFECYCLE.md'),'utf8');
    const ledger = fs.readFileSync(path.join(ROOT,
      'docs/roadmap/MISSION_27_ACCEPTANCE_LEDGER.md'),'utf8');
    const architecture = fs.readFileSync(path.join(ROOT,
      'docs/architecture/MISSION_27_PART14A_PAID_PROVIDER_DISABLED_JOURNEY.md'),'utf8');
    expect(roadmap).toContain('released complete Part 13; original Part 14A is the current');
    expect(roadmap).toContain('d465d2c0576547571aa2b6c930d22af12b723381');
    expect(roadmap).toContain('0ee0e7c1-d388-4a53-b293-50c59cbe4c7d');
    expect(roadmap).toContain('Complete paid-tenant production path with live capability disabled');
    expect(ledger).toContain('| 13D |');
    expect(ledger).toContain('| 14A | [Complete paid-tenant provider-disabled journey');
    expect(architecture).toContain('The slice does not add another invoice');
    expect(architecture).toContain('check_clearance_authority_unavailable');
    expect(fs.readdirSync(path.join(ROOT,'migrations')).some(name => /^273_/.test(name))).toBe(false);
  });
});
