'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const cors = require('cors');
const request = require('supertest');
const digest = require('../../src/customerFinancial/paymentProviderBoundary').digest;
const health = require('../../src/customerFinancial/providerLifecycleHealth');
const retention = require('../../src/customerFinancial/providerLifecycleRetention');
const recovery = require('../../src/customerFinancial/providerLifecycleRecovery');
const contract = require('../../src/customerFinancial/providerLifecycleAcceptance');
const repository = require('../../src/customerFinancial/providerLifecycleAcceptanceRepository');
const { providerLifecycleAcceptanceBoundary, hasFramedBody } =
  require('../../src/middleware/providerLifecycleAcceptanceBoundary');
const { corsOptions } = require('../../src/middleware/security');
const { createCustomerFinancialProviderAcceptanceRouter } =
  require('../../src/routes/customerFinancialProviderAcceptance');

const ROOT = path.resolve(__dirname, '../..');
const readFile = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const route = '/api/v1/customer-financial/payment-provider/lifecycle-acceptance';
const source = Object.freeze({
  organizationId: '11111111-1111-4111-8111-111111111111',
  actorUserId: '22222222-2222-4222-8222-222222222222',
  actorAccessRole: 'owner',
  authSessionId: '33333333-3333-4333-8333-333333333333',
});

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function leaves(value, current = [], output = []) {
  if (value === null || typeof value !== 'object') output.push(current);
  else if (Array.isArray(value)) value.forEach((item, index) => leaves(item, [...current, index], output));
  else Object.entries(value).forEach(([key, item]) => leaves(item, [...current, key], output));
  return output;
}
function mutate(value, leaf) {
  const copy = clone(value); let parent = copy;
  for (const key of leaf.slice(0, -1)) parent = parent[key];
  const key = leaf.at(-1); const current = parent[key];
  parent[key] = current === null ? 'forged' : typeof current === 'boolean' ? !current :
    typeof current === 'number' ? current + 1 : `${current}_forged`;
  return copy;
}
function at(value, path) {
  return path.reduce((current, key) => current[key], value);
}
function replaceAt(value, path, replacement) {
  const parent = at(value, path.slice(0, -1));
  parent[path.at(-1)] = replacement;
  return value;
}
function attacked(canonical, change) {
  const candidate = clone(canonical);
  change(candidate);
  return candidate;
}
function malformedPlainDataCases(canonical, nestedPath, arrayPath, zeroPath) {
  const cases = [];
  cases.push(attacked(canonical, value => {
    at(value, nestedPath).completed = true;
    Object.defineProperty(value, 'toJSON', { value: () => clone(canonical) });
  }));
  cases.push(attacked(canonical, value => Object.setPrototypeOf(value,
    { inheritedForgery: true, toJSON: () => clone(canonical) })));
  cases.push(attacked(canonical, value => Object.setPrototypeOf(at(value, nestedPath),
    { inheritedForgery: true })));
  cases.push(attacked(canonical, value => Object.defineProperty(value, 'state', {
    enumerable: true, get: () => 'unavailable',
  })));
  cases.push(attacked(canonical, value => Object.defineProperty(at(value, nestedPath), 'state', {
    enumerable: true, get: () => 'unavailable',
  })));
  cases.push(attacked(canonical, value => Object.defineProperty(value, 'hiddenForgery', {
    value: 'secret', enumerable: false,
  })));
  cases.push(attacked(canonical, value => Object.defineProperty(at(value, nestedPath),
    'hiddenForgery', { value: 'secret', enumerable: false })));
  cases.push(attacked(canonical, value => { value[Symbol('forged')] = 'secret'; }));
  cases.push(attacked(canonical, value => { at(value, nestedPath)[Symbol('forged')] = 'secret'; }));
  cases.push(attacked(canonical, value => replaceAt(value, nestedPath,
    Object.assign(Object.create(null), at(value, nestedPath)))));
  cases.push(attacked(canonical, value => replaceAt(value, nestedPath,
    new Proxy(at(value, nestedPath), {}))));
  cases.push(attacked(canonical, value => Object.setPrototypeOf(at(value, arrayPath),
    Object.create(Array.prototype))));
  cases.push(attacked(canonical, value => Object.defineProperty(at(value, arrayPath), 'toJSON', {
    value: () => clone(at(canonical, arrayPath)), enumerable: false,
  })));
  cases.push(attacked(canonical, value => Object.defineProperty(at(value, arrayPath), '0', {
    enumerable: true, get: () => clone(at(canonical, arrayPath)[0]),
  })));
  cases.push(attacked(canonical, value => { at(value, arrayPath)[Symbol('forged')] = 'secret'; }));
  cases.push(attacked(canonical, value => { at(value, arrayPath).extra = 'secret'; }));
  cases.push(attacked(canonical, value => { delete at(value, arrayPath)[0]; }));
  cases.push(attacked(canonical, value => replaceAt(value, zeroPath, -0)));
  cases.push(attacked(canonical, value => replaceAt(value, zeroPath, Number.NaN)));
  cases.push(attacked(canonical, value => replaceAt(value, zeroPath, Number.POSITIVE_INFINITY)));
  cases.push(attacked(canonical, value => replaceAt(value, zeroPath, new Number(0))));
  cases.push(attacked(canonical, value => replaceAt(value, zeroPath, () => 0)));
  cases.push(attacked(canonical, value => replaceAt(value, zeroPath, 0n)));
  cases.push(attacked(canonical, value => { value.self = value; }));
  cases.push(new Proxy(clone(canonical), {}));
  return cases;
}
function appWithSpies(spies = {}) {
  const app = express();
  app.use(cors(corsOptions));
  app.use(providerLifecycleAcceptanceBoundary);
  app.use(express.json());
  app.use(route, createCustomerFinancialProviderAcceptanceRouter({
    auth: spies.auth || ((req, _res, next) => { req.tenantContext = {
      organizationId: source.organizationId, userId: source.actorUserId };
    req.authSession = { id: source.authSessionId }; req.userRole = 'owner'; next(); }),
    role: spies.role || ((_req, _res, next) => next()),
    throttle: spies.throttle || ((_req, _res, next) => next()),
    read: spies.read || (async () => contract.unavailable()),
  }));
  return app;
}

describe('Mission 27 Part 13D provider lifecycle acceptance', () => {
  test('rejects every non-plain Part13C and Part13D masquerade before trust or projection', async () => {
    const acceptance = contract.unavailable();
    const sourceRecovery = recovery.unavailable();
    const acceptanceCases = malformedPlainDataCases(acceptance,
      ['loadAndCapacity'], ['sources'], ['providerCallCount']);
    const recoveryCases = malformedPlainDataCases(sourceRecovery,
      ['migrationAndRestart'], ['sources'], ['providerCallCount']);

    expect(contract.project(clone(acceptance), clone(sourceRecovery))).toEqual(acceptance);
    expect(contract.unavailable(clone(sourceRecovery))).toEqual(acceptance);
    for (const candidate of acceptanceCases) {
      expect(() => contract.project(candidate, clone(sourceRecovery)))
        .toThrow('Provider lifecycle acceptance boundary invalid');
    }
    for (const candidate of recoveryCases) {
      expect(() => contract.unavailable(candidate))
        .toThrow('Provider lifecycle acceptance boundary invalid');
      expect(() => contract.project(clone(acceptance), candidate))
        .toThrow('Provider lifecycle acceptance boundary invalid');
    }

    Object.defineProperty(Object.prototype, 'part13dPollution', {
      value: 'forged', enumerable: true, configurable: true,
    });
    try {
      expect(() => contract.project(clone(acceptance), clone(sourceRecovery)))
        .toThrow('Provider lifecycle acceptance boundary invalid');
      expect(() => contract.unavailable(clone(sourceRecovery)))
        .toThrow('Provider lifecycle acceptance boundary invalid');
    } finally {
      delete Object.prototype.part13dPollution;
    }

    const masked = clone(sourceRecovery);
    masked.failover.completed = true;
    Object.defineProperty(masked, 'toJSON', { value: () => clone(sourceRecovery) });
    const readRecovery = jest.fn(async () => masked);
    await expect(repository.createRepository({ readRecovery }).read(source))
      .rejects.toThrow('Provider lifecycle acceptance boundary invalid');
    expect(readRecovery).toHaveBeenCalledTimes(1);

    const exportsBefore = Object.keys(contract).sort();
    expect(exportsBefore).toEqual(['CONTRACT_VERSION', 'REASON', 'REQUIREMENTS',
      'policy', 'project', 'unavailable'].sort());
  });

  test('projects every exact server-owned semantic leaf and rejects any mutation', () => {
    const value = contract.unavailable();
    expect(contract.project(clone(value))).toEqual(value);
    expect(value).toMatchObject({
      contractVersion: 'm27-provider-lifecycle-acceptance-v1',
      state: 'unavailable', reason: 'provider_lifecycle_acceptance_unavailable',
      value: null,
      loadAndCapacity: { maximumJsonRequestBytes: 65536,
        maximumProviderEventBytes: 262144, maximumPageSize: 100,
        maximumAccountingExportRecords: 1000,
        maximumAccountingExportMinorUnits: '100000000',
        maximumSynchronousMutationSeconds: 5, maximumProviderSessionMinutes: 30,
        webhookClockToleranceSeconds: 300, concurrentWriterPerAggregate: 1,
        loadTestAccepted: false, capacityAccepted: false },
      abuseResistance: { exactTenantAndSessionRequired: true, ownerRoleRequired: true,
        queryFieldsAllowed: false, requestBodyAllowed: false, readMethod: 'GET',
        unsupportedMethodsFailClosed: true, getOnlyCors: true,
        duplicateConsequentialEffectsAllowed: false, missingEvidenceBecomesZero: false,
        delayedEvidenceBecomesFailure: false, olderSourceFallbackAllowed: false,
        denialOfServiceReviewAccepted: false, abuseResistanceAccepted: false },
      securityReview: { accepted: false,
        requiredBefore: ['provider_sandbox_acceptance','live_payment_launch'],
        providerSandboxAuthorized: false, livePaymentAuthorized: false },
      disasterRecovery: { requiredMigrationSequence: 272, backupIdentity: null,
        restoreEvidenceDigest: null, sourceIntegrityVerified: false,
        restoreTestAccepted: false, productionRestoreAuthorized: false },
      independentAcceptance: { oneWriterRequired: true,
        sameIndependentWholeHeadAuditorRequired: true,
        maximumAcceptedFindingSeverity: 'none_p0_through_p3',
        requiredHttp200Paths: ['/api/health','/','/demo/'],
        auditPerformed: false, accepted: false },
      missionVerdicts: { fullLocal: false, productionDeployedProviderDisabled: false,
        providerSandboxAccepted: false, livePaymentAccepted: false, missionComplete: false,
        providerSandboxRequired: true, liveMoneyCanaryRequired: true,
        founderVisualVerdictRequired: true },
    });
    expect(leaves(value).length).toBeGreaterThan(120);
    for (const leaf of leaves(value)) expect(() => contract.project(mutate(value, leaf)))
      .toThrow('Provider lifecycle acceptance boundary invalid');
  });

  test('rejects structural, source, digest, ordering, contradiction and joint-forgery variants', () => {
    const value = clone(contract.unavailable()); const cases = [];
    const missing = clone(value); delete missing.disasterRecovery; cases.push(missing);
    cases.push({ ...clone(value), providerAccountIdentity: 'acct_victim' });
    const reordered = clone(value); reordered.sources.reverse(); cases.push(reordered);
    const renamed = clone(value); renamed.sources[0].source = 'part13_forger'; cases.push(renamed);
    const duplicate = clone(value); duplicate.sources[1] = clone(duplicate.sources[0]); cases.push(duplicate);
    const forged = clone(value); forged.sources[0].digest = digest({ forged: true });
    forged.securityReview.accepted = true; cases.push(forged);
    const restoreForgery = clone(value); restoreForgery.disasterRecovery.state = 'available';
    restoreForgery.disasterRecovery.restoreTestAccepted = true; cases.push(restoreForgery);
    const abuseForgery = clone(value); abuseForgery.abuseResistance.state = 'available';
    abuseForgery.abuseResistance.missingEvidenceBecomesZero = true; cases.push(abuseForgery);
    cases.push(Object.fromEntries(Object.entries(value).reverse()));
    for (const candidate of cases) expect(() => contract.project(candidate))
      .toThrow('Provider lifecycle acceptance boundary invalid');
  });

  test('binds exact Part13A-C evidence with separate fail-closed acceptance axes', () => {
    const value = contract.unavailable(); const sourceRecovery = recovery.unavailable();
    expect(value.sources).toEqual([
      { source: 'part13c_provider_lifecycle_recovery',
        contractVersion: recovery.CONTRACT_VERSION, digest: digest(sourceRecovery) },
      { source: 'part13b_provider_lifecycle_retention',
        contractVersion: retention.CONTRACT_VERSION, digest: digest(retention.unavailable()) },
      { source: 'part13a_provider_lifecycle_health',
        contractVersion: health.CONTRACT_VERSION, digest: digest(health.unavailable()) },
    ]);
    expect(value.requirements.map(item => [item.requirement, item.state, item.reason]))
      .toEqual(contract.REQUIREMENTS.map(([name, reason]) => [name, 'unavailable', reason]));
    expect(value.privacy).toEqual({ organizationIdentityReturned: false,
      actorIdentityReturned: false, sessionIdentityReturned: false,
      customerIdentityReturned: false, providerAccountIdentityReturned: false,
      providerCredentialReferenceReturned: false, providerEventIdentityReturned: false,
      requestOrReceiptIdentityReturned: false, backupOrRestoreIdentityReturned: false,
      auditorIdentityReturned: false, rawPayloadReturned: false,
      secretValueReturned: false });
    expect(value).toMatchObject({ loadTestAuthorized: false, abuseTestAuthorized: false,
      securityReviewAccepted: false, disasterRestoreAuthorized: false,
      independentPart13Accepted: false, providerCallCount: 0, providerMutationCount: 0,
      receiverMutationCount: 0, accountingMutationCount: 0, databaseMutationCount: 0,
      liveMoneyMovementCount: 0 });
    expect(JSON.stringify(value)).not.toMatch(
      /"organizationId":|"actorUserId":|"authSessionId":|acct_[A-Za-z0-9]|sk_[A-Za-z0-9]|whsec_|https:\/\//);
  });

  test('rereads exact Part13C chain every request and rejects drift, aliases and tenant changes', async () => {
    const readRecovery = jest.fn(async () => recovery.unavailable());
    const repo = repository.createRepository({ readRecovery });
    await expect(repo.read(source)).resolves.toEqual(contract.unavailable());
    expect(readRecovery).toHaveBeenCalledTimes(2);
    for (const invalid of [null, {}, { ...source, actorAccessRole: 'admin' },
      { ...source, tenantId: source.organizationId }, { ...source, organizationId: 'victim' },
      { ...source, authSessionId: null }, Object.assign(Object.create(null), source),
      Object.assign(Object.create({ inherited: true }), source), new Proxy({ ...source }, {}),
      Object.defineProperty({ ...source }, 'actorAccessRole',
        { enumerable: true, get: () => 'owner' }),
      Object.assign({ ...source }, { [Symbol('forged')]: true })]) {
      await expect(repo.read(invalid)).rejects.toMatchObject({
        code: 'CUSTOMER_FINANCIAL_PROVIDER_ACCEPTANCE_RESTRICTED', status: 403,
      });
    }
    const forged = clone(recovery.unavailable()); forged.failover.completed = true;
    await expect(repository.createRepository({ readRecovery: async () => forged }).read(source))
      .rejects.toThrow('Provider lifecycle recovery boundary invalid');
    const alias = recovery.unavailable(); let calls = 0;
    const mutatingAlias = repository.createRepository({ readRecovery: async () => {
      calls += 1; if (calls === 2) {
        const changed = clone(alias); changed.runbook.operatorAcknowledged = true; return changed;
      }
      return alias;
    } });
    await expect(mutatingAlias.read(source))
      .rejects.toThrow('Provider lifecycle recovery boundary invalid');
    readRecovery.mockClear();
    const parallel = await Promise.all(Array.from({ length: 20 }, () => repo.read(source)));
    expect(parallel.every(item => JSON.stringify(item) === JSON.stringify(contract.unavailable()))).toBe(true);
    expect(readRecovery).toHaveBeenCalledTimes(40);
  });

  test('recognizes exact framing and rejects every unsupported method before downstream entry', () => {
    const req = (headers = {}, rawHeaders = []) => ({ headers, rawHeaders });
    expect(hasFramedBody(req())).toBe(false);
    expect(hasFramedBody(req({ 'content-length': '0' }, ['Content-Length','0']))).toBe(false);
    expect(hasFramedBody(req({ 'content-length': '000' }, ['content-length','000']))).toBe(false);
    expect(hasFramedBody(req({ 'content-length': '1' }, ['Content-Length','1']))).toBe(true);
    expect(hasFramedBody(req({ 'content-length': 'invalid' }, ['Content-Length','invalid']))).toBe(true);
    expect(hasFramedBody(req({ 'content-length': '0' },
      ['Content-Length','0','content-length','0']))).toBe(true);
    expect(hasFramedBody(req({ 'transfer-encoding': 'chunked' },
      ['Transfer-Encoding','chunked']))).toBe(true);
    for (const method of ['HEAD','OPTIONS','POST','PUT','PATCH','DELETE','ACL','BIND','CHECKOUT',
      'CONNECT','COPY','LINK','LOCK','MERGE','MKACTIVITY','MKCALENDAR','MKCOL','MOVE',
      'M-SEARCH','NOTIFY','PROPFIND','PROPPATCH','PURGE','REBIND','REPORT','SEARCH','SOURCE',
      'SUBSCRIBE','TRACE','UNBIND','UNLINK','UNLOCK','UNSUBSCRIBE']) {
      const headers = {}; const body = [];
      const res = { set(name, value) { headers[name.toLowerCase()] = value; return this; },
        vary(value) { headers.vary = value; return this; },
        status(value) { this.statusCode = value; return this; },
        json(value) { body.push(value); return this; } };
      const next = jest.fn();
      providerLifecycleAcceptanceBoundary({ method, path: route, headers: {}, rawHeaders: [] }, res, next);
      expect(res.statusCode).toBe(405); expect(headers.allow).toBe('GET');
      expect(headers['cache-control']).toBe('private, no-store');
      expect(body[0].error.category).toBe('CUSTOMER_FINANCIAL_PROVIDER_ACCEPTANCE_METHOD_NOT_ALLOWED');
      expect(next).not.toHaveBeenCalled();
    }
  });

  test('owns method, body, path, query and GET-only CORS before all downstream entry', async () => {
    const auth = jest.fn((_req, _res, next) => next());
    const throttle = jest.fn((_req, _res, next) => next()); const read = jest.fn();
    const app = appWithSpies({ auth, throttle, read });
    const protectedPaths = [route, route + '/', route.toUpperCase(),
      '/Api/V1/Customer-Financial/Payment-Provider/Lifecycle-Acceptance'];
    const methods = ['head','options','post','put','patch','delete'];
    const bodies = [{ type: 'application/json', value: { secret: 'sk_forbidden' } },
      { type: 'application/json', value: 'sk_forbidden' },
      { type: 'application/json', value: '[malformed' },
      { type: 'text/plain', value: 'acct_forbidden' },
      { type: 'application/octet-stream', value: Buffer.from([0,1,2,3]) }];
    for (const protectedPath of protectedPaths) for (const method of methods) for (const body of bodies) {
      const response = await request(app)[method](protectedPath)
        .set('Origin','http://localhost:3000').set('Access-Control-Request-Method','GET')
        .set('Content-Type', body.type).send(body.value && typeof body.value === 'object' &&
          !Buffer.isBuffer(body.value) ? JSON.stringify(body.value) : body.value);
      expect(response.status).toBe(405); expect(response.headers.allow).toBe('GET');
      expect(response.headers['cache-control']).toContain('private');
      expect([undefined, 'GET']).toContain(response.headers['access-control-allow-methods']);
      if (method === 'options') expect(response.headers['access-control-allow-methods']).toBe('GET');
      expect(JSON.stringify(response.body)).not.toMatch(/sk_forbidden|acct_forbidden|malformed/);
    }
    for (const body of bodies) {
      const response = await request(app).get(route).set('Content-Type', body.type).send(body.value);
      expect(response.status).toBe(400);
      expect(response.headers['cache-control']).toContain('private');
      expect(JSON.stringify(response.body)).not.toMatch(/sk_forbidden|acct_forbidden|malformed/);
    }
    expect((await request(app).get(route + '?account=acct_forbidden&mode=live')).status).toBe(400);
    expect(auth).not.toHaveBeenCalled(); expect(throttle).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  }, 30000);

  test('allows only exact empty GET equivalents, isolates near misses and adds no effects or migration', async () => {
    const read = jest.fn(async () => contract.unavailable()); const app = appWithSpies({ read });
    for (const allowed of [route, route + '/', route.toUpperCase(),
      '/Api/V1/Customer-Financial/Payment-Provider/Lifecycle-Acceptance',
      route.replace('/payment-provider/','/payment-provider/./'),
      route.replace('/payment-provider/','/payment-provider/%2e/'),
      route.replace('/payment-provider/','/payment-provider\\')]) {
      const response = await request(app).get(allowed).set('Content-Length','0');
      expect(response.status).toBe(200); expect(response.body.data).toEqual(contract.unavailable());
    }
    for (const near of [route + '/extra', route.replace('lifecycle-acceptance','lifecycle-acceptancex'),
      route.replace('/payment-provider/','/payment-provider//'),
      route.replace('lifecycle-acceptance','lifecycle%2Dacceptance'),
      route.replace('lifecycle-acceptance','lifecycle%2Facceptance'),
      route.replace('lifecycle-acceptance','lifecycle%5Cacceptance')]) {
      expect((await request(app).get(near)).status).toBe(404);
    }
    expect(read).toHaveBeenCalledTimes(7);
    const files = ['src/customerFinancial/providerLifecycleAcceptance.js',
      'src/customerFinancial/providerLifecycleAcceptanceRepository.js',
      'src/customerFinancial/providerLifecycleAcceptanceHttpBoundary.js',
      'src/middleware/providerLifecycleAcceptanceBoundary.js',
      'src/routes/customerFinancialProviderAcceptance.js'];
    const implementation = files.map(readFile).join('\n'); const server = readFile('src/server.js');
    expect(implementation).not.toMatch(
      /fetch\(|axios|stripe\.|checkout\.sessions|paymentIntents|https\.request|process\.env\.[A-Z_]*STRIPE/i);
    expect(implementation).not.toMatch(/router\.(post|put|patch|delete)\(/);
    expect(implementation).not.toMatch(/WeakSet|WeakMap|trustedSource|identityMarker|\bcache\b/);
    expect(readFile('src/routes/demo.js')).not.toContain('lifecycle-acceptance');
    expect(server.indexOf("payment-provider/lifecycle-acceptance")).toBeLessThan(
      server.indexOf("payment-provider',"));
    const migrations = fs.readdirSync(path.join(ROOT, 'migrations'))
      .filter(name => name.endsWith('.sql')).sort();
    expect(migrations.at(-1)).toBe('272_customer_financial_invoice_draft_preview_v1.sql');
    expect(migrations.some(name => /^273_/.test(name))).toBe(false);
  });
});
