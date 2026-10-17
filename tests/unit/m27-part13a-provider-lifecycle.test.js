'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const cors = require('cors');
const request = require('supertest');
const boundary = require('../../src/customerFinancial/paymentProviderBoundary');
const connection = require('../../src/customerFinancial/paymentProviderConnection');
const receipt = require('../../src/customerFinancial/paymentProviderEventReceipt');
const contract = require('../../src/customerFinancial/providerLifecycleHealth');
const repository = require('../../src/customerFinancial/providerLifecycleHealthRepository');
const { providerLifecycleHealthBoundary, hasFramedBody } =
  require('../../src/middleware/providerLifecycleHealthBoundary');
const { corsOptions } = require('../../src/middleware/security');
const { createCustomerFinancialProviderLifecycleRouter } =
  require('../../src/routes/customerFinancialProviderLifecycle');

const ROOT = path.resolve(__dirname, '../..');
const readFile = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const route = '/api/v1/customer-financial/payment-provider/lifecycle-health';
const source = Object.freeze({
  organizationId: '11111111-1111-4111-8111-111111111111',
  actorUserId: '22222222-2222-4222-8222-222222222222',
  actorAccessRole: 'owner',
  authSessionId: '33333333-3333-4333-8333-333333333333',
});

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function leaves(value, path = [], output = []) {
  if (value === null || typeof value !== 'object') output.push(path);
  else if (Array.isArray(value)) value.forEach((item, index) => leaves(item, [...path, index], output));
  else Object.entries(value).forEach(([key, item]) => leaves(item, [...path, key], output));
  return output;
}
function mutate(value, path) {
  const copy = clone(value);
  let parent = copy;
  for (const key of path.slice(0, -1)) parent = parent[key];
  const key = path.at(-1); const current = parent[key];
  parent[key] = current === null ? 'forged' : typeof current === 'boolean' ? !current :
    typeof current === 'number' ? current + 1 : `${current}_forged`;
  return copy;
}
function appWithSpies(spies = {}) {
  const app = express();
  app.use(cors(corsOptions));
  app.use(providerLifecycleHealthBoundary);
  app.use(express.json());
  app.use(route, createCustomerFinancialProviderLifecycleRouter({
    auth: spies.auth || ((req, _res, next) => { req.tenantContext = {
      organizationId: source.organizationId, userId: source.actorUserId };
    req.authSession = { id: source.authSessionId }; req.userRole = 'owner'; next(); }),
    role: spies.role || ((_req, _res, next) => next()),
    throttle: spies.throttle || ((_req, _res, next) => next()),
    read: spies.read || (async () => contract.unavailable()),
  }));
  return app;
}

describe('Mission 27 Part 13A provider lifecycle and operational controls', () => {
  test('projects the complete exact server-owned lifecycle contract and every semantic leaf fails closed', () => {
    const value = contract.unavailable();
    expect(contract.project(clone(value))).toEqual(value);
    expect(value).toMatchObject({
      contractVersion: 'm27-provider-lifecycle-health-v1',
      state: 'unavailable', reason: 'provider_lifecycle_authority_unavailable', value: null,
      adapter: { provider: 'stripe_connect', requiredSchemaVersion: 'm27-provider-adapter-v1',
        registrationState: 'unavailable', registeredAdapterIdentity: null,
        registeredAdapterVersion: null, runtimeAvailable: false },
      accountHealth: { tenantBound: true, state: 'unavailable',
        providerAccountIdentity: null, mayBeAssumedHealthy: false },
      capabilityDrift: { comparisonState: 'unavailable', driftState: 'unavailable',
        driftMayBeAssumedAbsent: false, driftBlocksConnectionAndInitiation: true,
        exactRevalidationRequired: true },
      modeIsolation: { policyMode: 'test', activeMode: null,
        sandboxEvidenceState: 'unavailable', liveModeEnabled: false,
        credentialReuseAcrossModesAuthorized: false },
      connectionRecovery: { automaticReconnectAuthorized: false,
        explicitReconnectOperation: 'connect',
        reconnectRequiresVerifiedDisconnectedPredecessor: true },
      incidentControl: { rolloutStage: 'disabled', authorityState: 'unavailable',
        newConnectionAuthorized: false, paymentInitiationAuthorized: false,
        providerEventIngestionAuthorized: false, automaticRecoveryAuthorized: false },
    });
    expect(leaves(value).length).toBeGreaterThan(100);
    for (const leaf of leaves(value)) expect(() => contract.project(mutate(value, leaf)))
      .toThrow('Provider lifecycle health boundary invalid');
  });

  test('rejects missing, added, reordered, renamed, duplicated and jointly forged source witnesses', () => {
    const value = clone(contract.unavailable());
    const cases = [];
    const missing = clone(value); delete missing.webhookLifecycle; cases.push(missing);
    cases.push({ ...clone(value), providerAccountId: 'acct_forged' });
    const reordered = clone(value); reordered.sources.reverse(); cases.push(reordered);
    const renamed = clone(value); renamed.sources[0].source = 'part13_forger'; cases.push(renamed);
    const duplicated = clone(value); duplicated.sources[1] = clone(duplicated.sources[0]); cases.push(duplicated);
    const jointlyForged = clone(value);
    jointlyForged.sources[0].digest = boundary.digest({ forged: true });
    jointlyForged.adapter.provider = 'forged_provider'; cases.push(jointlyForged);
    const keyReordered = Object.fromEntries(Object.entries(value).reverse()); cases.push(keyReordered);
    for (const candidate of cases) expect(() => contract.project(candidate))
      .toThrow('Provider lifecycle health boundary invalid');
  });

  test('binds exact Part7 sources and exposes no account, endpoint, secret or effect', () => {
    const value = contract.unavailable();
    expect(value.sources).toEqual([
      { source: 'part7a_payment_provider_boundary', contractVersion: boundary.CONTRACT_VERSION,
        digest: boundary.digest(boundary.unavailable()) },
      { source: 'part7b_provider_connection', contractVersion: connection.CONTRACT_VERSION,
        digest: boundary.digest(connection.unavailable()) },
      { source: 'part8a_provider_event_receipt', contractVersion: receipt.CONTRACT_VERSION,
        digest: boundary.digest(receipt.unavailable()) },
    ]);
    expect(value.requirements.map(item => [item.requirement, item.state])).toEqual(
      contract.REQUIREMENTS.map(([name]) => [name, 'unavailable']));
    expect(value.privacy).toEqual({ organizationIdentityReturned: false,
      actorIdentityReturned: false, sessionIdentityReturned: false,
      providerAccountIdentityReturned: false, credentialReferenceReturned: false,
      webhookEndpointReturned: false, secretValueReturned: false });
    expect(value).toMatchObject({ adapterRegistrationAuthorized: false,
      accountHealthRefreshAuthorized: false, credentialRotationAuthorized: false,
      webhookRotationAuthorized: false, incidentDisablementAuthorized: false,
      providerCallCount: 0, providerMutationCount: 0, credentialMutationCount: 0,
      webhookMutationCount: 0, receiverMutationCount: 0, accountingMutationCount: 0,
      liveMoneyMovementCount: 0 });
    expect(JSON.stringify(value)).not.toMatch(
      /"organizationId":|"actorUserId":|"authSessionId":|acct_[A-Za-z0-9]|sk_[A-Za-z0-9]|whsec_|https:\/\//);
  });

  test('repository strictly rereads both exact sources and rejects source, alias and concurrency drift', async () => {
    const boundaryRead = jest.fn(async () => boundary.unavailable());
    const connectionRead = jest.fn(async () => connection.unavailable());
    const receiptRead = jest.fn(async () => receipt.unavailable());
    const repo = repository.createRepository({ readBoundary: boundaryRead,
      readConnection: connectionRead, readReceipt: receiptRead });
    await expect(repo.read(source)).resolves.toEqual(contract.unavailable());
    expect(boundaryRead).toHaveBeenCalledTimes(2);
    expect(connectionRead).toHaveBeenCalledTimes(2);
    expect(receiptRead).toHaveBeenCalledTimes(2);
    for (const invalid of [null, {}, { ...source, actorAccessRole: 'admin' },
      { ...source, actorAccessRole: 'owner', tenantId: source.organizationId },
      { ...source, organizationId: 'victim' }, { ...source, authSessionId: null }]) {
      await expect(repo.read(invalid)).rejects.toMatchObject({
        code: 'CUSTOMER_FINANCIAL_PROVIDER_LIFECYCLE_RESTRICTED', status: 403,
      });
    }
    const forgedConnection = clone(connection.unavailable());
    forgedConnection.credentials.rawSecretStored = true;
    const forgedRepo = repository.createRepository({
      readBoundary: async () => boundary.unavailable(),
      readConnection: async () => forgedConnection,
      readReceipt: async () => receipt.unavailable(),
    });
    await expect(forgedRepo.read(source)).rejects.toThrow('Payment-provider connection boundary invalid');
    expect(() => contract.unavailable(boundary.unavailable(), forgedConnection))
      .toThrow('Payment-provider connection boundary invalid');
    boundaryRead.mockClear(); connectionRead.mockClear(); receiptRead.mockClear();
    const parallel = await Promise.all(Array.from({ length: 16 }, () => repo.read(source)));
    expect(parallel.every(value => JSON.stringify(value) ===
      JSON.stringify(contract.unavailable()))).toBe(true);
    expect(boundaryRead).toHaveBeenCalledTimes(32);
    expect(connectionRead).toHaveBeenCalledTimes(32);
    expect(receiptRead).toHaveBeenCalledTimes(32);
  });

  test('recognizes every supported body framing before parsing', () => {
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
    expect(hasFramedBody(req({ 'transfer-encoding': 'gzip, chunked' },
      ['Transfer-Encoding','gzip, chunked']))).toBe(true);
  });

  test('owns the complete method/body/path/CORS composition before any downstream entry', async () => {
    const auth = jest.fn((_req, _res, next) => next());
    const throttle = jest.fn((_req, _res, next) => next());
    const read = jest.fn();
    const app = appWithSpies({ auth, throttle, read });
    const protectedPaths = [route, route + '/',
      '/API/V1/CUSTOMER-FINANCIAL/PAYMENT-PROVIDER/LIFECYCLE-HEALTH',
      '/api/v1/customer-financial/payment-provider/Lifecycle-Health?tenant=victim'];
    const methods = ['head','options','post','put','patch','delete'];
    const bodies = [{ type: 'application/json', value: { secret: 'sk_forbidden' } },
      { type: 'application/json', value: 'sk_forbidden' },
      { type: 'application/json', value: '[malformed' },
      { type: 'text/plain', value: 'acct_forbidden' },
      { type: 'application/octet-stream', value: Buffer.from([0,1,2,3]) }];
    for (const protectedPath of protectedPaths.slice(0, 3)) {
      for (const method of methods) {
        for (const body of bodies) {
          const response = await request(app)[method](protectedPath)
            .set('Origin', 'http://localhost:3000').set('Access-Control-Request-Method', 'GET')
            .set('Content-Type', body.type)
            .send(body.value && typeof body.value === 'object' && !Buffer.isBuffer(body.value) ?
              JSON.stringify(body.value) : body.value);
          expect(response.status).toBe(405);
          expect(response.headers['cache-control']).toContain('private');
          expect(response.headers['cache-control']).toContain('no-store');
          expect(response.headers.allow).toBe('GET');
          expect([undefined, 'GET']).toContain(response.headers['access-control-allow-methods']);
          if (method === 'options') expect(response.headers['access-control-allow-methods']).toBe('GET');
          expect(JSON.stringify(response.body)).not.toMatch(/sk_forbidden|acct_forbidden|malformed/);
        }
      }
    }
    for (const body of bodies) {
      const response = await request(app).get(route).set('Content-Type', body.type).send(body.value);
      expect(response.status).toBe(400);
      expect(response.headers['cache-control']).toContain('private');
      expect(JSON.stringify(response.body)).not.toMatch(/sk_forbidden|acct_forbidden|malformed/);
    }
    const query = await request(app).get(protectedPaths[3]);
    expect(query.status).toBe(400);
    expect(auth).not.toHaveBeenCalled();
    expect(throttle).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  }, 30000);

  test('allows only exact empty GET path forms and leaves near misses unrelated', async () => {
    const read = jest.fn(async () => contract.unavailable());
    const app = appWithSpies({ read });
    for (const allowed of [route, route + '/', route.toUpperCase(),
      '/Api/V1/Customer-Financial/Payment-Provider/Lifecycle-Health',
      route.replace('/payment-provider/','/payment-provider/./'),
      route.replace('/payment-provider/','/payment-provider/%2e/'),
      route.replace('/payment-provider/','/payment-provider\\')]) {
      const response = await request(app).get(allowed).set('Content-Length', '0');
      expect(response.status).toBe(200);
      expect(response.body.data).toEqual(contract.unavailable());
      expect(response.headers['cache-control']).toContain('private');
    }
    for (const near of [route + '/extra', route.replace('lifecycle-health','lifecycle-healthx'),
      route.replace('/payment-provider/','/payment-provider//'),
      route.replace('lifecycle-health','lifecycle%2Dhealth'),
      route.replace('lifecycle-health','lifecycle%2Fhealth'),
      route.replace('lifecycle-health','lifecycle%5Chealth'),
      '/api/v1/customer-financial/payment-provider']) {
      expect([near, (await request(app).get(near)).status]).toEqual([near, 404]);
    }
    expect(read).toHaveBeenCalledTimes(7);
  });

  test('contains no mutation/demo/provider transport or migration 273 and is mounted before generic provider route', () => {
    const files = ['src/customerFinancial/providerLifecycleHealth.js',
      'src/customerFinancial/providerLifecycleHealthRepository.js',
      'src/customerFinancial/providerLifecycleHealthHttpBoundary.js',
      'src/middleware/providerLifecycleHealthBoundary.js',
      'src/routes/customerFinancialProviderLifecycle.js'];
    const implementation = files.map(readFile).join('\n');
    const server = readFile('src/server.js');
    expect(implementation).not.toMatch(
      /fetch\(|axios|stripe\.|checkout\.sessions|paymentIntents|https\.request|process\.env\.[A-Z_]*STRIPE/i);
    expect(implementation).not.toMatch(/router\.(post|put|patch|delete)\(/);
    expect(readFile('src/routes/demo.js')).not.toContain('lifecycle-health');
    expect(server.indexOf("payment-provider/lifecycle-health")).toBeLessThan(
      server.indexOf("payment-provider',"));
    const migrations = fs.readdirSync(path.join(ROOT, 'migrations'))
      .filter(name => name.endsWith('.sql')).sort();
    expect(migrations.at(-1)).toBe('272_customer_financial_invoice_draft_preview_v1.sql');
    expect(migrations.some(name => /^273_/.test(name))).toBe(false);
  });
});
