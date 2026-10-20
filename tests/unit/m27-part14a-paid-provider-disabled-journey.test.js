'use strict';

jest.setTimeout(600000);

const fs = require('node:fs');
const path = require('node:path');
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
const contract = require('../../src/customerFinancial/paidTenantJourneyAcceptance');
const repository = require('../../src/customerFinancial/paidTenantJourneyAcceptanceRepository');
const authority = require('../../src/customerFinancial/mission27Part14Authority');
const { paidTenantJourneyAcceptanceBoundary } =
  require('../../src/middleware/paidTenantJourneyAcceptanceBoundary');
const { corsOptions } = require('../../src/middleware/security');
const { createCustomerFinancialEditableEstimateRouter } =
  require('../../src/routes/customerFinancialEditableEstimate');

const ROOT = path.resolve(__dirname, '../..');
const RECEIPT = '22222222-2222-4222-8222-222222222222';
const DIGEST = 'a'.repeat(64);
const TENANT = '44444444-4444-4444-8444-444444444444';
const OTHER_TENANT = '77777777-7777-4777-8777-777777777777';
const USER = '55555555-5555-4555-8555-555555555555';
const SESSION = '66666666-6666-4666-8666-666666666666';
const clone = value => JSON.parse(JSON.stringify(value));
let canonicalPart12; let canonicalTrace; let canonical; let chain; let context; let ESTIMATE;

function paidBundle() {
  const state = workspace.createInitialDemoState(TENANT, new Date('2026-10-15T12:00:00Z'),
    { seed:'part14a-paid-provider-disabled-journey' });
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

function makeContext(role = 'owner', tenant = TENANT, estimateId = ESTIMATE) {
  return { source:source(role, tenant), estimateId,
    handoffReceiptId:RECEIPT, handoffReceiptDigest:DIGEST };
}

function mutate(target, pathParts, replacement) {
  let holder = target;
  for (let index = 0; index < pathParts.length - 1; index += 1) holder = holder[pathParts[index]];
  holder[pathParts.at(-1)] = replacement;
}

async function withFastChain(run) {
  const spies = [
    jest.spyOn(part5, 'projectBundle').mockReturnValue(chain.part5),
    jest.spyOn(part6, 'projectBundle').mockReturnValue(chain.part6),
    jest.spyOn(part7, 'projectBundle').mockReturnValue(chain.part7),
    jest.spyOn(part9, 'projectBundle').mockReturnValue(chain.part9),
    jest.spyOn(part10, 'projectBundle').mockReturnValue(chain.part10),
    jest.spyOn(part11, 'derive').mockReturnValue(chain.part11Sources),
    jest.spyOn(part11, 'projectBundle').mockReturnValue(chain.part11),
    jest.spyOn(part12, 'derive').mockReturnValue({ part11:chain.part11, ...chain.part12Sources }),
    jest.spyOn(part12, 'projectBundle').mockReturnValue(chain.part12),
  ];
  try { return await run(); } finally { spies.reverse().forEach(spy => spy.mockRestore()); }
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
    req.userRole = req.get('X-Test-Role') || 'owner'; return next();
  };
  const role = (req, res, next) => {
    counters.role = (counters.role || 0) + 1;
    return ['owner','admin'].includes(req.userRole) ? next() : res.status(403).json({ success:false });
  };
  const throttle = (_req, _res, next) => { counters.throttle = (counters.throttle || 0) + 1; next(); };
  application.use('/api/v1/customer-financial/editable-estimates',
    createCustomerFinancialEditableEstimateRouter({ auth, role, throttle,
      poolProvider:() => ({}), paidTenantJourneyAcceptanceRead:read }));
  return application;
}

beforeAll(() => {
  const paid = paidBundle(); canonicalPart12 = paid.bundle; canonicalTrace = paid.trace;
  ESTIMATE = canonicalPart12.preview.draftIdentity.estimateId;
  context = makeContext();
  chain = contract.executeReleasedContracts(canonicalPart12, canonicalTrace);
  canonical = contract.candidate(canonicalPart12, context, canonicalTrace);
});

describe('Mission 27 Part 14A paid provider-disabled journey', () => {
  test('executes every released production contract for one exact bound incomplete journey', () => {
    expect(canonical).toMatchObject({
      contractVersion:'m27-paid-provider-disabled-journey-v1',
      executionVersion:'m27-production-contract-journey-execution-v1',
      state:'incomplete_provider_disabled',
      reason:'required_production_stage_evidence_unavailable', value:null,
      mode:'paid', fictional:false,
      launchMatrix:{ rolloutStage:'disabled', liveCapabilityEnabled:false,
        providerMode:'test', providerMethod:'card', partialProviderPaymentsEnabled:false,
        multiInvoiceProviderPaymentsEnabled:false, offlineCashReceiptEnabled:true,
        offlineCheckReceiptEnabled:true, checkClearedTransitionEnabled:false,
        checkClearanceUnavailableState:'check_clearance_authority_unavailable' },
      execution:{ deterministic:true, inProcess:true,
        explicitSyntheticProviderDisabledProvenance:true, requiredStageCount:12,
        contractValidationStageCount:12, skippedStageCount:0, duplicateStageCount:0,
        repositoryReadCounts:{part9:4,part10:2,part11:1,part12Sources:2,part12:1},
        completeContractValidationTrace:true, completeProductionJourney:false,
        providerAccountUsed:false, credentialUsed:false, externalTransportUsed:false,
        liveMoneyUsed:false },
      acceptance:{ exactPaidProductionContractsExecuted:true,
        completeOrderedContractValidationTracePresent:true,
        completeProductionJourneyAccepted:false,
        offlineCashAndCheckBranchesIndependentlyValidated:true,
        providerSandboxEvidenceAccepted:false, livePaymentEvidenceAccepted:false },
      idempotencyReplayEffectCount:0, providerCallCount:0, providerMutationCount:0,
      receiverMutationCount:0, accountingMutationCount:0, downstreamMutationCount:0,
      databaseMutationCount:0, liveMoneyMovementCount:0,
    });
    expect(canonical.execution.stages.map(stage => stage.stage)).toEqual([...contract.STAGE_ORDER]);
    expect(canonical.execution.stages.every(stage => stage.contractValidationExecuted &&
      !stage.productionEffectExecuted && !stage.durableEffectCreated &&
      !stage.externalEffectCreated && stage.journeyBindingDigest ===
        canonical.journeyBinding.journeyBindingDigest)).toBe(true);
    expect(canonical.execution.productionContractsExecuted).toEqual([
      part5.CONTRACT_VERSION, part6.CONTRACT_VERSION, part7.CONTRACT_VERSION,
      part9.CONTRACT_VERSION, part10.CONTRACT_VERSION, part11.CONTRACT_VERSION,
      part12.CONTRACT_VERSION,
    ]);
    expect(canonical.journeyBinding).toMatchObject({ draftRevision:1, currency:'USD',
      preparedDocumentTotalState:'preparation_only', amountDueState:'unavailable',
      amountDueValue:null, rawTenantActorSessionEstimateOrReceiptIdentityReturned:false });
    expect(JSON.stringify(canonical)).not.toMatch(new RegExp(`${TENANT}|${USER}|${SESSION}|${ESTIMATE}|${RECEIPT}`));
  });

  test('executes cash and check independently through balance receipt accounting and reporting', () => {
    expect(canonical.offlineBranches.map(branch => branch.method)).toEqual(['cash','check']);
    expect(canonical.offlineBranches[0]).toMatchObject({ intendedAcceptedState:'offline_received',
      productionState:'unavailable', balanceFact:'offline_cash_received_amount',
      receiptState:'unavailable', accountingState:'unavailable', reportingState:'incomplete',
      acceptedReceiptCreated:false, balanceMutationCreated:false,
      customerReceiptCreated:false, accountingHandoffCreated:false,
      reportingRecordCreated:false, providerOrBankSettlementClaimed:false });
    expect(canonical.offlineBranches[1]).toMatchObject({
      intendedAcceptedState:'check_clearance_unknown', productionState:'unavailable',
      balanceFact:'check_clearance_unknown_amount',
      checkClearanceState:'check_clearance_authority_unavailable',
      acceptedReceiptCreated:false, providerOrBankSettlementClaimed:false });
    expect(canonical.offlineBranches[0].journeyBindingDigest)
      .toBe(canonical.offlineBranches[1].journeyBindingDigest);
  });

  test('rejects reordered skipped duplicate replay effect binding and offline contradictions', async () => {
    await withFastChain(async () => {
      const cases = [
        ['state',['state'],'complete_provider_disabled'],
        ['binding',['journeyBinding','draftRevision'],2],
        ['stage order',['execution','stages'],null],
        ['skipped',['execution','skippedStageCount'],1],
        ['duplicate',['execution','duplicateStageCount'],1],
        ['replay',['idempotencyReplayEffectCount'],1],
        ['effect',['providerCallCount'],1],
        ['cash',['offlineBranches',0,'acceptedReceiptCreated'],true],
        ['check',['offlineBranches',1,'checkClearanceState'],'check_cleared'],
        ['completion',['acceptance','completeProductionJourneyAccepted'],true],
        ['read_count',['execution','repositoryReadCounts','part9'],3],
      ];
      for (const [_name, fieldPath, replacement] of cases) {
        const raw = clone(canonical);
        if (replacement === null) raw.execution.stages.reverse();
        else mutate(raw, fieldPath, replacement);
        expect(() => contract.project(raw, canonicalPart12, context, canonicalTrace)).toThrow(
          'Paid provider-disabled journey acceptance boundary invalid');
      }
    });
  });

  test('fails closed on exact source version digest identity and currentness drift', () => {
    const cases = [
      value => { value.preview.draftIdentity.draftDigest = 'f'.repeat(64); },
      value => { value.part9Acceptance.sourceParts[3].digest = 'f'.repeat(64); },
      value => { value.part12Acceptance.sourceWitnesses[2].digest = 'f'.repeat(64); },
      value => { value.part12Acceptance.exactCurrentnessRevalidated = false; },
    ];
    for (const change of cases) {
      const raw = clone(canonicalPart12); change(raw);
      expect(() => contract.executeReleasedContracts(raw, canonicalTrace)).toThrow();
    }
    const traceCases = [
      value => { value.repositoryReads.part9 = 3; },
      value => { value.part9.part9Acceptance.sourceParts[3].digest = 'e'.repeat(64); },
      value => { value.part10.part10Acceptance.sourceParts.reverse(); },
      value => { value.part11.part11Acceptance.exactCurrentnessRevalidated = false; },
      value => { value.part12Sources.paymentCashReporting.facts.reverse(); },
    ];
    for (const change of traceCases) {
      const trace = clone(canonicalTrace); change(trace);
      expect(() => contract.executeReleasedContracts(canonicalPart12, trace)).toThrow();
    }
    expect(() => contract.candidate(canonicalPart12,
      makeContext('owner', TENANT, '11111111-1111-4111-8111-111111111111'),
      canonicalTrace)).toThrow();
  });

  test('rejects nonplain accessor symbol and toJSON data without invoking hooks', () => {
    let hooks = 0;
    const contexts = [];
    const inherited = Object.create(context); contexts.push(inherited);
    const getter = clone(context);
    Object.defineProperty(getter, 'estimateId', { enumerable:true,
      get() { hooks += 1; return ESTIMATE; } }); contexts.push(getter);
    const symbol = clone(context); symbol[Symbol('secret')] = 'forged'; contexts.push(symbol);
    const serializer = clone(context);
    Object.defineProperty(serializer, 'toJSON', { value() { hooks += 1; return context; } });
    contexts.push(serializer);
    for (const value of contexts) {
      expect(() => contract.candidate(canonicalPart12, value, canonicalTrace)).toThrow();
    }
    expect(hooks).toBe(0);
  });

  test('rereads exact source for concurrent replay and never shares tenant or actor binding', async () => {
    await withFastChain(async () => {
      const readPart12 = jest.fn(async () => clone(canonicalPart12));
      const injected = { readPart12, executionTrace:canonicalTrace };
      const a = repository.read({}, source('owner'), ESTIMATE, RECEIPT, DIGEST, injected);
      const b = repository.read({}, source('admin'), ESTIMATE, RECEIPT, DIGEST, injected);
      const [owner, admin] = await Promise.all([a,b]);
      expect(readPart12).toHaveBeenCalledTimes(2);
      expect(owner.journeyBinding.recordScopeDigest).toBe(admin.journeyBinding.recordScopeDigest);
      expect(owner.journeyBinding.requestAuthorizationDigest)
        .not.toBe(admin.journeyBinding.requestAuthorizationDigest);
      expect(owner.journeyBinding.journeyBindingDigest)
        .not.toBe(admin.journeyBinding.journeyBindingDigest);
      const foreign = await repository.read({}, source('owner', OTHER_TENANT), ESTIMATE,
        RECEIPT, DIGEST, injected);
      expect(foreign.journeyBinding.recordScopeDigest).not.toBe(owner.journeyBinding.recordScopeDigest);
      expect(foreign.providerCallCount).toBe(0);
      const changed = jest.fn().mockRejectedValue(Object.assign(new Error('changed'),
        { code:'CUSTOMER_FINANCIAL_REPORTING_PART12_CHANGED' }));
      await expect(repository.read({}, source(), ESTIMATE, RECEIPT, DIGEST,
        { readPart12:changed })).rejects.toMatchObject({
        code:'CUSTOMER_FINANCIAL_PAID_JOURNEY_CHANGED', status:409,
      });
    });
  });

  test('enforces private auth role exact query body method and GET-only CORS', async () => {
    const read = jest.fn().mockResolvedValue(canonical); const counters = {};
    const application = app(read, counters);
    const route = `/api/v1/customer-financial/editable-estimates/${ESTIMATE}` +
      '/paid-tenant-journey-acceptance';
    const query = { handoffReceiptId:RECEIPT, handoffReceiptDigest:DIGEST };
    const headers = { 'X-Test-Auth':'current', 'X-Test-Role':'owner' };
    const ok = await request(application).get(route).query(query).set(headers);
    expect(ok.status).toBe(200); expect(ok.headers['cache-control']).toContain('private');
    expect(ok.headers['cache-control']).toContain('no-store');
    expect((await request(application).get(route).query(query)).status).toBe(401);
    expect((await request(application).get(route).query(query)
      .set({ ...headers, 'X-Test-Role':'member' })).status).toBe(403);
    read.mockClear();
    const widened = await request(application).get(route)
      .query({ ...query, accountId:'acct_victim', amountMinorUnits:'100', credential:'sk_secret' })
      .set(headers);
    expect(widened.status).toBe(400); expect(read).not.toHaveBeenCalled();
    expect(JSON.stringify(widened.body)).not.toMatch(/acct_victim|100|sk_secret/);
    const beforeBoundary = { ...counters };
    for (const body of ['"sk_scalar"','{"credential":"sk_malformed"',
      JSON.stringify({ accountId:'acct_victim', amountMinorUnits:100 })]) {
      const response = await request(application).get(route).query(query).set(headers)
        .type('application/json').send(body);
      expect(response.status).toBe(400);
      expect(response.headers['cache-control']).toContain('private');
      expect(JSON.stringify(response.body)).not.toMatch(/sk_scalar|sk_malformed|acct_victim|100/);
    }
    for (const method of ['head','options','post','put','patch','delete','trace','propfind']) {
      const response = await request(application)[method](route).query(query).set(headers)
        .set('Origin','http://localhost:3000').set('Access-Control-Request-Method','POST')
        .type('application/json').send('"sk_method"');
      expect(response.status).toBe(405); expect(response.headers.allow).toBe('GET');
      expect([undefined,'GET']).toContain(response.headers['access-control-allow-methods']);
      expect(response.headers['cache-control']).toContain('private');
      expect(JSON.stringify(response.body || {})).not.toMatch(/sk_method/);
    }
    expect(read).not.toHaveBeenCalled(); expect(counters).toEqual(beforeBoundary);
  });

  test('ratifies complete canonical roadmap ledger and architecture and rejects contradictions', () => {
    const docs = Object.fromEntries(Object.entries(authority.CANONICAL_DOCUMENTS)
      .map(([name,entry])=>[name,fs.readFileSync(path.join(ROOT,entry.path),'utf8')]));
    expect(authority.validate(docs)).toEqual(expect.objectContaining({
      currentSlice:'14B', currentStatus:'candidate', migrationLatest:272,
      migration273Present:false, laterSlices:['14C','14D','14E','14F','14G'],
    }));
    const mutations = [
      ['false release','ledger','Accepted; no P0–P3 at head `5dc2a257b42bd2c08e7bd9ab45a2f9ed8e0720f3`','Part 14B accepted and released'],
      ['false production complete','ledger','Accepted; no P0–P3 at head `5dc2a257b42bd2c08e7bd9ab45a2f9ed8e0720f3`','Part 14B production complete'],
      ['deployed','ledger','sole automatic deployment `c82929fa-7393-4d91-975b-9bb7080e61b6` passed Docker build and selected the hardened `setpriv` start but restarted before health with only the generic pre-Node rejection; fourth diagnostic correction pending','deployment `forged` succeeded; Part 14B released'],
      ['later slice','ledger','| 14C | Integrated migration/replay/correction/refund/offline-return/retention/delete/restore journey | No','| 14C | Integrated migration/replay/correction/refund/offline-return/retention/delete/restore journey | Complete'],
      ['automatic SMS','architecture14A','Founder visual approval remains separate.','Founder visual approval remains separate. Automatic SMS authorized.'],
      ['automatic charge','architecture14A','Founder visual approval remains separate.','Founder visual approval remains separate. Automatic charge authorized.'],
      ['automatic refund','architecture14A','Founder visual approval remains separate.','Founder visual approval remains separate. Automatic refund authorized.'],
      ['accounting','architecture14A','Founder visual approval remains separate.','Founder visual approval remains separate. Automatic accounting authorized.'],
      ['external','architecture14A','Founder visual approval remains separate.','Founder visual approval remains separate. External effect authorized.'],
      ['provider','architecture14A','Founder visual approval remains separate.','Founder visual approval remains separate. Provider sandbox accepted.'],
      ['clearance','architecture14A','Founder visual approval remains separate.','Founder visual approval remains separate. Offline check cleared.'],
      ['scope omitted','roadmap','secure customer delivery, ',''],
      ['order','architecture14A','1. `launch_approved_billable_handoff`','1. `customer_receipt`'],
      ['identity','roadmap',authority.PART13_RELEASE.head,'f'.repeat(40)],
      ['currentness','architecture14A','complete production journey remains false','complete production journey remains true'],
      ['contradictory append','architecture14A','Founder visual approval remains separate.','Founder visual approval remains separate. Live payment accepted.'],
    ];
    for (const [_name, key, from, to] of mutations) {
      const altered = { ...docs, [key]:docs[key].replace(from, to) };
      expect(altered[key]).not.toBe(docs[key]);
      expect(() => authority.validate(altered)).toThrow(
        'Mission 27 Part 14 authority ratification invalid');
    }
    expect(fs.readdirSync(path.join(ROOT,'migrations')).some(name => /^273_/.test(name))).toBe(false);
  });
});
