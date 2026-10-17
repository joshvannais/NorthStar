'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const cors = require('cors');
const request = require('supertest');
const digest = require('../../src/customerFinancial/paymentProviderBoundary').digest;
const health = require('../../src/customerFinancial/providerLifecycleHealth');
const retention = require('../../src/customerFinancial/providerLifecycleRetention');
const contract = require('../../src/customerFinancial/providerLifecycleRecovery');
const repository = require('../../src/customerFinancial/providerLifecycleRecoveryRepository');
const { providerLifecycleRecoveryBoundary, hasFramedBody } =
  require('../../src/middleware/providerLifecycleRecoveryBoundary');
const { corsOptions } = require('../../src/middleware/security');
const { createCustomerFinancialProviderRecoveryRouter } =
  require('../../src/routes/customerFinancialProviderRecovery');

const ROOT = path.resolve(__dirname, '../..');
const readFile = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const route = '/api/v1/customer-financial/payment-provider/lifecycle-recovery';
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
function appWithSpies(spies = {}) {
  const app = express();
  app.use(cors(corsOptions));
  app.use(providerLifecycleRecoveryBoundary);
  app.use(express.json());
  app.use(route, createCustomerFinancialProviderRecoveryRouter({
    auth: spies.auth || ((req, _res, next) => { req.tenantContext = {
      organizationId: source.organizationId, userId: source.actorUserId };
    req.authSession = { id: source.authSessionId }; req.userRole = 'owner'; next(); }),
    role: spies.role || ((_req, _res, next) => next()),
    throttle: spies.throttle || ((_req, _res, next) => next()),
    read: spies.read || (async () => contract.unavailable()),
  }));
  return app;
}

describe('Mission 27 Part 13C provider operational recovery readiness', () => {
  test('projects every exact server-owned semantic leaf and rejects any mutation', () => {
    const value = contract.unavailable();
    expect(contract.project(clone(value))).toEqual(value);
    expect(value).toMatchObject({
      contractVersion: 'm27-provider-lifecycle-recovery-v1',
      state: 'unavailable', reason: 'provider_operational_recovery_authority_unavailable',
      value: null,
      migrationAndRestart: { requiredMigrationSequence: 272, laterMigrationExpected: false,
        exactSchemaCurrent: false, restartRecoveryComplete: false,
        previousVersionFallbackAllowed: false },
      concurrency: { concurrentWriterPerAggregate: 1, exactAggregateIdentityRequired: true,
        exactRequestDigestRequired: true, serializeDuplicateRequests: true,
        changedReuseConflicts: true, executionVerified: false },
      failover: { providerFailoverTarget: null, automaticFailoverAuthorized: false,
        crossAccountReplayAuthorized: false, crossModeReplayAuthorized: false },
      uncertainResultRecovery: { requiredCapability: 'customer_financial.record.recover',
        readOnlyReceiptLookupSingleControlAllowed: true,
        effectRecoveryRequiresDualControl: true, receiptLookupBeforeRetryRequired: true,
        effectMayExceedOriginalRequest: false, retryAuthorized: false },
      providerOutage: { degradedStateVocabulary: ['unavailable','pending'],
        currentDegradedState: 'unavailable', delayedEvidenceRemainsPending: true,
        delayedEvidenceBecomesFailure: false, missingEvidenceBecomesZero: false,
        successMayBeFabricated: false, consequentialAutomaticRetryAuthorized: false },
      queueAndBackpressure: { maximumBatchSize: 100,
        maximumSynchronousMutationSeconds: 5, queueDepth: null,
        durableQueueAvailable: false, backpressureRefusesUnacceptedNewWork: true,
        backpressureDropsAcceptedWork: false, droppedItemCount: 0 },
      observability: { providerSuccessCount: null, providerFailureCount: null,
        sensitivePayloadLoggingAllowed: false, operationalEvidenceAccepted: false },
      alerts: { receiverIdentity: null, alertingAuthorized: false,
        receiverMutationAuthorized: false, acknowledged: false },
      runbook: { runbookVersion: null, rollbackProcedureAccepted: false,
        outageProcedureAccepted: false, uncertainResultProcedureAccepted: false },
    });
    expect(leaves(value).length).toBeGreaterThan(145);
    for (const leaf of leaves(value)) expect(() => contract.project(mutate(value, leaf)))
      .toThrow('Provider lifecycle recovery boundary invalid');
  });

  test('rejects structural, source, digest, ordering, contradiction and joint-forgery variants', () => {
    const value = clone(contract.unavailable()); const cases = [];
    const missing = clone(value); delete missing.providerOutage; cases.push(missing);
    cases.push({ ...clone(value), providerAccountIdentity: 'acct_victim' });
    const reordered = clone(value); reordered.sources.reverse(); cases.push(reordered);
    const renamed = clone(value); renamed.sources[0].source = 'part13_forger'; cases.push(renamed);
    const duplicate = clone(value); duplicate.sources[1] = clone(duplicate.sources[0]); cases.push(duplicate);
    const forged = clone(value); forged.sources[0].digest = digest({ forged: true });
    forged.uncertainResultRecovery.recovered = true; cases.push(forged);
    const outageForgery = clone(value); outageForgery.providerOutage.state = 'available';
    outageForgery.providerOutage.successMayBeFabricated = true; cases.push(outageForgery);
    const queueForgery = clone(value); queueForgery.queueAndBackpressure.queueDepth = 0;
    queueForgery.queueAndBackpressure.durableQueueAvailable = true; cases.push(queueForgery);
    cases.push(Object.fromEntries(Object.entries(value).reverse()));
    for (const candidate of cases) expect(() => contract.project(candidate))
      .toThrow('Provider lifecycle recovery boundary invalid');
  });

  test('binds exact Part13B and nested Part13A evidence with separate fail-closed axes', () => {
    const value = contract.unavailable(); const sourceRetention = retention.unavailable();
    expect(value.sources).toEqual([
      { source: 'part13b_provider_lifecycle_retention',
        contractVersion: retention.CONTRACT_VERSION, digest: digest(sourceRetention) },
      { source: 'part13a_provider_lifecycle_health',
        contractVersion: health.CONTRACT_VERSION, digest: digest(health.unavailable()) },
    ]);
    expect(value.requirements.map(item => [item.requirement, item.state, item.reason]))
      .toEqual(contract.REQUIREMENTS.map(([name, reason]) => [name, 'unavailable', reason]));
    expect(value.privacy).toEqual({ organizationIdentityReturned: false,
      actorIdentityReturned: false, sessionIdentityReturned: false,
      customerIdentityReturned: false, providerAccountIdentityReturned: false,
      providerCredentialReferenceReturned: false, providerEventIdentityReturned: false,
      requestOrReceiptIdentityReturned: false, queueIdentityReturned: false,
      alertReceiverIdentityReturned: false, rawPayloadReturned: false,
      secretValueReturned: false });
    expect(value).toMatchObject({ migrationAuthorized: false, failoverAuthorized: false,
      recoveryAuthorized: false, queueMutationAuthorized: false,
      alertMutationAuthorized: false, providerCallCount: 0, providerMutationCount: 0,
      receiverMutationCount: 0, accountingMutationCount: 0, databaseMutationCount: 0,
      liveMoneyMovementCount: 0 });
    expect(JSON.stringify(value)).not.toMatch(
      /"organizationId":|"actorUserId":|"authSessionId":|acct_[A-Za-z0-9]|sk_[A-Za-z0-9]|whsec_|https:\/\//);
  });

  test('rereads exact Part13B chain every request and rejects drift, aliases and tenant changes', async () => {
    const readRetention = jest.fn(async () => retention.unavailable());
    const repo = repository.createRepository({ readRetention });
    await expect(repo.read(source)).resolves.toEqual(contract.unavailable());
    expect(readRetention).toHaveBeenCalledTimes(2);
    for (const invalid of [null, {}, { ...source, actorAccessRole: 'admin' },
      { ...source, tenantId: source.organizationId }, { ...source, organizationId: 'victim' },
      { ...source, authSessionId: null }]) {
      await expect(repo.read(invalid)).rejects.toMatchObject({
        code: 'CUSTOMER_FINANCIAL_PROVIDER_RECOVERY_RESTRICTED', status: 403,
      });
    }
    const forged = clone(retention.unavailable()); forged.cleanup.completed = true;
    await expect(repository.createRepository({ readRetention: async () => forged }).read(source))
      .rejects.toThrow('Provider lifecycle retention boundary invalid');
    const alias = retention.unavailable(); let calls = 0;
    const mutatingAlias = repository.createRepository({ readRetention: async () => {
      calls += 1; if (calls === 2) {
        const changed = clone(alias); changed.replayWindow.replayAccepted = true; return changed;
      }
      return alias;
    } });
    await expect(mutatingAlias.read(source))
      .rejects.toThrow('Provider lifecycle retention boundary invalid');
    readRetention.mockClear();
    const parallel = await Promise.all(Array.from({ length: 20 }, () => repo.read(source)));
    expect(parallel.every(item => JSON.stringify(item) === JSON.stringify(contract.unavailable()))).toBe(true);
    expect(readRetention).toHaveBeenCalledTimes(40);
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
      providerLifecycleRecoveryBoundary({ method, path: route, headers: {}, rawHeaders: [] }, res, next);
      expect(res.statusCode).toBe(405); expect(headers.allow).toBe('GET');
      expect(headers['cache-control']).toBe('private, no-store');
      expect(body[0].error.category).toBe('CUSTOMER_FINANCIAL_PROVIDER_RECOVERY_METHOD_NOT_ALLOWED');
      expect(next).not.toHaveBeenCalled();
    }
  });

  test('owns method, body, path, query and GET-only CORS before all downstream entry', async () => {
    const auth = jest.fn((_req, _res, next) => next());
    const throttle = jest.fn((_req, _res, next) => next()); const read = jest.fn();
    const app = appWithSpies({ auth, throttle, read });
    const protectedPaths = [route, route + '/', route.toUpperCase(),
      '/Api/V1/Customer-Financial/Payment-Provider/Lifecycle-Recovery'];
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
      '/Api/V1/Customer-Financial/Payment-Provider/Lifecycle-Recovery',
      route.replace('/payment-provider/','/payment-provider/./'),
      route.replace('/payment-provider/','/payment-provider/%2e/'),
      route.replace('/payment-provider/','/payment-provider\\')]) {
      const response = await request(app).get(allowed).set('Content-Length','0');
      expect(response.status).toBe(200); expect(response.body.data).toEqual(contract.unavailable());
    }
    for (const near of [route + '/extra', route.replace('lifecycle-recovery','lifecycle-recoveryx'),
      route.replace('/payment-provider/','/payment-provider//'),
      route.replace('lifecycle-recovery','lifecycle%2Drecovery'),
      route.replace('lifecycle-recovery','lifecycle%2Frecovery'),
      route.replace('lifecycle-recovery','lifecycle%5Crecovery')]) {
      expect((await request(app).get(near)).status).toBe(404);
    }
    expect(read).toHaveBeenCalledTimes(7);
    const files = ['src/customerFinancial/providerLifecycleRecovery.js',
      'src/customerFinancial/providerLifecycleRecoveryRepository.js',
      'src/customerFinancial/providerLifecycleRecoveryHttpBoundary.js',
      'src/middleware/providerLifecycleRecoveryBoundary.js',
      'src/routes/customerFinancialProviderRecovery.js'];
    const implementation = files.map(readFile).join('\n'); const server = readFile('src/server.js');
    expect(implementation).not.toMatch(
      /fetch\(|axios|stripe\.|checkout\.sessions|paymentIntents|https\.request|process\.env\.[A-Z_]*STRIPE/i);
    expect(implementation).not.toMatch(/router\.(post|put|patch|delete)\(/);
    expect(implementation).not.toMatch(/WeakSet|WeakMap|trustedSource|identityMarker|\bcache\b/);
    expect(readFile('src/routes/demo.js')).not.toContain('lifecycle-recovery');
    expect(server.indexOf("payment-provider/lifecycle-recovery")).toBeLessThan(
      server.indexOf("payment-provider',"));
    const migrations = fs.readdirSync(path.join(ROOT, 'migrations'))
      .filter(name => name.endsWith('.sql')).sort();
    expect(migrations.at(-1)).toBe('272_customer_financial_invoice_draft_preview_v1.sql');
    expect(migrations.some(name => /^273_/.test(name))).toBe(false);
  });
});
