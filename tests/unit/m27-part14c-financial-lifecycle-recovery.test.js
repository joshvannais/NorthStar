'use strict';

const cors = require('cors');
const express = require('express');
const request = require('supertest');
const workspace = require('../../src/commandCenter/workspace');
const demoPart6 = require('../../src/customerFinancial/demoInvoicePart6Acceptance');
const part5 = require('../../src/customerFinancial/invoicePart5Acceptance');
const part6 = require('../../src/customerFinancial/invoicePart6Acceptance');
const part7 = require('../../src/customerFinancial/paymentPart7Acceptance');
const part9 = require('../../src/customerFinancial/paymentPart9Acceptance');
const part10 = require('../../src/customerFinancial/collectionPart10Acceptance');
const part11 = require('../../src/customerFinancial/accountingPart11Acceptance');
const part12 = require('../../src/customerFinancial/reportingPart12Acceptance');
const paidJourney = require('../../src/customerFinancial/paidTenantJourneyAcceptance');
const providerRecovery = require('../../src/customerFinancial/providerLifecycleRecovery');
const providerAcceptance = require('../../src/customerFinancial/providerLifecycleAcceptance');
const contract = require('../../src/customerFinancial/financialLifecycleRecoveryAcceptance');
const { financialLifecycleRecoveryAcceptanceBoundary } =
  require('../../src/middleware/financialLifecycleRecoveryAcceptanceBoundary');
const { corsOptions } = require('../../src/middleware/security');
const { createCustomerFinancialEditableEstimateRouter } =
  require('../../src/routes/customerFinancialEditableEstimate');

const RECEIPT = '22222222-2222-4222-8222-222222222222';
const DIGEST = 'a'.repeat(64);
const TENANT = '44444444-4444-4444-8444-444444444444';
const OTHER_TENANT = '77777777-7777-4777-8777-777777777777';
const USER = '55555555-5555-4555-8555-555555555555';
const SESSION = '66666666-6666-4666-8666-666666666666';
const clone = value => JSON.parse(JSON.stringify(value));
let ESTIMATE; let context; let canonicalPaid; let canonicalRecovery;
let canonicalAcceptance; let canonical;

function paidBundle() {
  const state = workspace.createInitialDemoState(TENANT, new Date('2026-10-15T12:00:00Z'),
    { seed:'part14c-financial-lifecycle-recovery' });
  const view = workspace.buildDemoWorkspace({ tenantId:TENANT, sessionId:RECEIPT, state,
    revision:1, simulationCount:0, persisted:true,
    expiresAt:new Date('2026-10-16T12:00:00Z') });
  const item = workspace.demoCanonicalItems(view)[0];
  const demoBundle = demoPart6.bundle(item, 1);
  const preview = { ...demoBundle.preview, mode:'paid', fictional:false,
    documentPreview:{ ...demoBundle.preview.documentPreview, fictional:false },
    previewDigest:'b'.repeat(64) };
  const a5 = part5.unavailable('paid', preview); const b5 = part5.bundle(preview, a5);
  const a6 = part6.unavailable('paid', a5.previewWitness); const b6 = part6.bundle(b5, a6);
  const a7 = part7.unavailable('paid', b6); const b7 = part7.bundle(b6, a7);
  const s9 = part9.defaultSources(b7);
  const b9 = part9.bundle(b7, part9.unavailable('paid', b7, s9), s9);
  const s10 = part10.defaultSources();
  const b10 = part10.bundle(b9, part10.unavailable('paid', b9, s10), s10);
  const s11 = part11.derive(b10, 'paid');
  const b11 = part11.bundle(b10, part11.unavailable('paid', b10, s11), s11);
  const d12 = part12.derive(b11);
  const s12 = { invoiceReceivableReporting:d12.invoiceReceivableReporting,
    paymentCashReporting:d12.paymentCashReporting,
    downstreamReportingReaders:d12.downstreamReportingReaders };
  return { bundle:part12.bundle(b11, part12.unavailable('paid', b11, s12), s12),
    trace:{ part9:b9, part10:b10, part11:b11, part12Sources:s12,
      repositoryReads:{ part9:4,part10:2,part11:1,part12Sources:2,part12:1 } } };
}

function source(role = 'owner', tenant = TENANT) {
  return { organizationId:tenant, actorUserId:USER, actorAccessRole:role, authSessionId:SESSION };
}

function buildApp(read, counters = {}) {
  const application = express();
  application.use(financialLifecycleRecoveryAcceptanceBoundary);
  application.use(cors(corsOptions));
  application.use(express.json());
  const auth = (req, res, next) => {
    counters.auth = (counters.auth || 0) + 1;
    if (req.get('X-Test-Auth') !== 'current') return res.status(401).json({ success:false });
    req.tenantContext = { organizationId:TENANT, userId:USER };
    req.authSession = { id:SESSION }; req.userRole = req.get('X-Test-Role') || 'owner';
    return next();
  };
  const role = (req, res, next) => {
    counters.role = (counters.role || 0) + 1;
    return req.userRole === 'owner' ? next() : res.status(403).json({ success:false });
  };
  const throttle = (_req, _res, next) => {
    counters.throttle = (counters.throttle || 0) + 1; next();
  };
  application.use('/api/v1/customer-financial/editable-estimates',
    createCustomerFinancialEditableEstimateRouter({ auth, role, recoveryRole:role, throttle,
      poolProvider:() => ({}), financialLifecycleRecoveryAcceptanceRead:read }));
  return application;
}

function isolatedRepository(readers) {
  let value;
  jest.isolateModules(() => {
    jest.doMock('../../src/customerFinancial/paidTenantJourneyAcceptanceRepository', () => ({
      read:readers.paid,
    }));
    jest.doMock('../../src/customerFinancial/providerLifecycleRecoveryRepository', () => ({
      read:readers.recovery,
    }));
    jest.doMock('../../src/customerFinancial/providerLifecycleAcceptanceRepository', () => ({
      read:readers.acceptance,
    }));
    value = require('../../src/customerFinancial/financialLifecycleRecoveryAcceptanceRepository');
  });
  return value;
}

beforeAll(() => {
  const paid = paidBundle(); ESTIMATE = paid.bundle.preview.draftIdentity.estimateId;
  context = { source:source(), estimateId:ESTIMATE, handoffReceiptId:RECEIPT,
    handoffReceiptDigest:DIGEST };
  canonicalPaid = paidJourney.candidate(paid.bundle, context, paid.trace);
  canonicalRecovery = providerRecovery.unavailable();
  canonicalAcceptance = providerAcceptance.unavailable(canonicalRecovery);
  canonical = contract.candidate(canonicalPaid, canonicalRecovery, canonicalAcceptance, context);
});

afterEach(() => jest.restoreAllMocks());

describe('Mission 27 Part 14C financial lifecycle recovery acceptance', () => {
  test('projects every ordered recovery and offline scenario without claiming an effect', () => {
    expect(canonical).toMatchObject({
      contractVersion:'m27-financial-lifecycle-recovery-acceptance-v1',
      state:'incomplete_required_evidence',
      reason:'financial_lifecycle_recovery_evidence_unavailable', value:null,
      mode:'paid', fictional:false,
      offline:{launchEnabled:true,cashAcceptedState:'offline_received',
        checkReceivedState:'check_clearance_unknown',
        checkClearanceState:'check_clearance_authority_unavailable',
        checkReturnedState:'check_returned',offlineReversalState:'offline_reversed',
        bankClearanceClaimed:false,providerSettlementClaimed:false,
        receiptRecorded:false,correctionRecorded:false,reversalRecorded:false,
        returnRecorded:false,balanceMutationCount:0},
      recovery:{migrationLatest:272,
        migration273Expected:false,previousVersionFallbackAllowed:false,
        concurrentWriterPerAggregate:1,exactRequestDigestRequired:true,
        serializeDuplicateRequests:true,changedReuseConflicts:true,
        receiptLookupBeforeRetryRequired:true,recoveryMayExceedOriginalRequest:false,
        olderSourceFallbackAllowed:false,delayedEvidenceBecomesFailure:false,
        destructiveCleanupAuthorized:false,restoreTestAccepted:false,
        productionRestoreAuthorized:false},
      acceptance:{allRequiredScenariosProjected:true,
        exactReleasedProductionContractsRevalidated:true,
        completePositiveRecoveryJourneyAccepted:false,
        independentWholeHeadAuditAccepted:false,providerSandboxEvidenceAccepted:false,
        productionRestoreEvidenceAccepted:false,livePaymentEvidenceAccepted:false,
        founderVisualApprovalAccepted:false},
      exactCurrentnessRevalidatedBeforeAndAfterProjection:true,
      migrationMutationCount:0,providerCallCount:0,providerMutationCount:0,
      receiverMutationCount:0,accountingMutationCount:0,downstreamMutationCount:0,
      databaseMutationCount:0,liveMoneyMovementCount:0,
    });
    expect(canonical.scenarioOrder).toEqual([...contract.SCENARIO_ORDER]);
    expect(canonical.scenarios.map(value => value.scenario)).toEqual([...contract.SCENARIO_ORDER]);
    expect(canonical.scenarios.every(value => value.positiveEvidenceAccepted === false &&
      value.effectAuthorized === false && value.effectExecuted === false)).toBe(true);
    expect(JSON.stringify(canonical)).not.toMatch(
      new RegExp(`${TENANT}|${USER}|${SESSION}|${ESTIMATE}|${RECEIPT}|sk_|acct_|customer@`, 'i'));
  });

  test('rejects malformed semantics, ordering, witnesses and non-data values', () => {
    const cases = [
      value => { value.state = 'complete'; },
      value => { value.scenarioOrder.reverse(); },
      value => { value.scenarios[0].scenario = 'restart'; },
      value => { value.scenarios[3].effectAuthorized = true; },
      value => { value.offline.checkClearanceState = 'check_cleared'; },
      value => { value.offline.balanceMutationCount = 1; },
      value => { value.recovery.migration273Expected = true; },
      value => { value.recovery.changedReuseConflicts = false; },
      value => { value.separation.restoreMayRepeatExternalEffect = true; },
      value => { value.acceptance.livePaymentEvidenceAccepted = true; },
      value => { value.providerCallCount = 1; },
      value => { value.sourceWitnesses[0].digest = 'f'.repeat(64); },
      value => { delete value.scenarios[5].rule; },
      value => { value.scenarios.push(clone(value.scenarios[0])); },
    ];
    for (const mutate of cases) {
      const value = clone(canonical); mutate(value);
      expect(() => contract.project(value, canonicalPaid, canonicalRecovery,
        canonicalAcceptance, context)).toThrow(/boundary invalid/);
    }
    let getters = 0;
    const accessor = clone(canonical);
    Object.defineProperty(accessor.recovery, 'migrationLatest', {
      enumerable:true, get() { getters += 1; return [272]; },
    });
    expect(() => contract.project(accessor, canonicalPaid, canonicalRecovery,
      canonicalAcceptance, context)).toThrow(/boundary invalid/);
    expect(getters).toBe(0);
    const polluted = clone(canonical); polluted.scenarios[0][Symbol('secret')] = 'sk_secret';
    expect(() => contract.project(polluted, canonicalPaid, canonicalRecovery,
      canonicalAcceptance, context)).toThrow(/boundary invalid/);
    const exotic = clone(canonical); Object.setPrototypeOf(exotic.offline, { trusted:true });
    expect(() => contract.project(exotic, canonicalPaid, canonicalRecovery,
      canonicalAcceptance, context)).toThrow(/boundary invalid/);
    const sparse = clone(canonical); delete sparse.scenarios[2];
    expect(() => contract.project(sparse, canonicalPaid, canonicalRecovery,
      canonicalAcceptance, context)).toThrow(/boundary invalid/);

    const upstreamCases = [
      value => { value.journeyBinding.extra = true; },
      value => { value.releasedPart13.pullRequest = 999; },
      value => { value.sourceWitnesses[1].digest = 'f'.repeat(64); },
      value => { value.launchMatrix.checkClearanceAuthority = 'available'; },
      value => { value.execution.productionContractsExecuted.reverse(); },
      value => { value.execution.repositoryReadCounts.part12 = 2; },
      value => { value.execution.stages[0].sourceDigest = 'not-a-digest'; },
      value => { value.offlineBranches[0].extra = 'forged'; },
      value => { value.separation.productionValuesRemainServerOwned = false; },
      value => { value.authorityAndCurrentness.sourceCorrectionRequiresNewProjection = false; },
      value => { value.acceptance.completeProductionJourneyAccepted = true; },
    ];
    for (const mutate of upstreamCases) {
      const paid = clone(canonicalPaid); mutate(paid);
      expect(() => contract.candidate(paid, canonicalRecovery, canonicalAcceptance, context))
        .toThrow(/boundary invalid/);
    }
  });

  test('rereads every exact upstream and rejects any before-after change', async () => {
    const paidRead = jest.fn()
      .mockResolvedValueOnce(canonicalPaid).mockResolvedValueOnce(canonicalPaid);
    const recoveryRead = jest.fn()
      .mockResolvedValueOnce(canonicalRecovery).mockResolvedValueOnce(canonicalRecovery);
    const acceptanceRead = jest.fn()
      .mockResolvedValueOnce(canonicalAcceptance).mockResolvedValueOnce(canonicalAcceptance);
    const firstRepository = isolatedRepository({
      paid:paidRead,recovery:recoveryRead,acceptance:acceptanceRead,
    });
    await expect(firstRepository.read({}, source(), ESTIMATE, RECEIPT, DIGEST))
      .resolves.toEqual(canonical);
    expect(paidRead).toHaveBeenCalledTimes(2);
    expect(recoveryRead).toHaveBeenCalledTimes(2);
    expect(acceptanceRead).toHaveBeenCalledTimes(2);

    const changedPaid = clone(canonicalPaid); changedPaid.policyDigest = 'f'.repeat(64);
    const changedRepository = isolatedRepository({
      paid:jest.fn().mockResolvedValueOnce(canonicalPaid).mockResolvedValueOnce(changedPaid),
      recovery:jest.fn().mockResolvedValue(canonicalRecovery),
      acceptance:jest.fn().mockResolvedValue(canonicalAcceptance),
    });
    await expect(changedRepository.read({}, source(), ESTIMATE, RECEIPT, DIGEST))
      .rejects.toMatchObject({status:409,code:'CUSTOMER_FINANCIAL_RECOVERY_ACCEPTANCE_CHANGED'});
  });

  test('the private owner GET fails closed for widened input, bodies, methods and roles', async () => {
    const calls = { read:0 };
    const read = async (_pool, requestSource, estimateId, receiptId, receiptDigest) => {
      calls.read += 1;
      return contract.candidate(canonicalPaid, canonicalRecovery, canonicalAcceptance,
        {source:requestSource,estimateId,handoffReceiptId:receiptId,
          handoffReceiptDigest:receiptDigest});
    };
    const counters = {}; const application = buildApp(read, counters);
    const route = `/api/v1/customer-financial/editable-estimates/${ESTIMATE}` +
      '/financial-lifecycle-recovery-acceptance';
    const query = {handoffReceiptId:RECEIPT,handoffReceiptDigest:DIGEST};
    const headers = {'X-Test-Auth':'current','X-Test-Role':'owner'};
    const ok = await request(application).get(route).query(query).set(headers);
    expect(ok.status).toBe(200); expect(ok.headers['cache-control']).toContain('private');
    expect(ok.headers['cache-control']).toContain('no-store'); expect(calls.read).toBe(1);
    expect((await request(application).get(route).query(query)
      .set({...headers,'X-Test-Role':'admin'})).status).toBe(403);
    expect((await request(application).get(route).query(query)
      .set({...headers,'X-Test-Auth':'missing'})).status).toBe(401);

    calls.read = 0;
    const widened = await request(application).get(route)
      .query({...query,tenantId:OTHER_TENANT,credential:'sk_secret',amount:'100'}).set(headers);
    expect(widened.status).toBe(400);
    expect(JSON.stringify(widened.body)).not.toMatch(/sk_secret|77777777|100/);
    const beforeEarlyBoundaryCases = {...counters};
    for (const body of ['"sk_scalar"','{"credential":"sk_bad"',
      JSON.stringify({accountId:'acct_victim',amount:100})]) {
      const response = await request(application).get(route).query(query).set(headers)
        .type('application/json').send(body);
      expect(response.status).toBe(400);
      expect(response.headers['cache-control']).toContain('private');
      expect(JSON.stringify(response.body)).not.toMatch(/sk_scalar|sk_bad|acct_victim|100/);
    }
    for (const method of ['head','options','post','put','patch','delete']) {
      const response = await request(application)[method](route).query(query).set(headers)
        .type('application/json').send('"sk_method"');
      expect(response.status).toBe(405); expect(response.headers.allow).toBe('GET');
      expect(JSON.stringify(response.body || {})).not.toMatch(/sk_method/);
    }
    for (const malformedId of ['not-a-uuid','1234','x'.repeat(512),'acct_victim']) {
      const malformedRoute = `/api/v1/customer-financial/editable-estimates/${malformedId}` +
        '/financial-lifecycle-recovery-acceptance';
      const response = await request(application).get(malformedRoute).query(query).set(headers)
        .type('application/json').send('"sk_invalid_path"');
      expect(response.status).toBe(400);
      expect(response.headers['cache-control']).toContain('private');
      expect(JSON.stringify(response.body || {})).not.toMatch(/sk_invalid_path|acct_victim/);
    }
    expect(calls.read).toBe(0);
    expect(counters.auth).toBe(beforeEarlyBoundaryCases.auth);
    expect(counters.role).toBe(beforeEarlyBoundaryCases.role);
    expect(counters.throttle).toBe(beforeEarlyBoundaryCases.throttle);
  });
});
