'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const cors = require('cors');
const request = require('supertest');
const digest = require('../../src/customerFinancial/paymentProviderBoundary').digest;
const health = require('../../src/customerFinancial/providerLifecycleHealth');
const contract = require('../../src/customerFinancial/providerLifecycleRetention');
const repository = require('../../src/customerFinancial/providerLifecycleRetentionRepository');
const { providerLifecycleRetentionBoundary, hasFramedBody } =
  require('../../src/middleware/providerLifecycleRetentionBoundary');
const { corsOptions } = require('../../src/middleware/security');
const { createCustomerFinancialProviderRetentionRouter } =
  require('../../src/routes/customerFinancialProviderRetention');

const ROOT = path.resolve(__dirname, '../..');
const readFile = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const route = '/api/v1/customer-financial/payment-provider/lifecycle-retention';
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
  app.use(providerLifecycleRetentionBoundary);
  app.use(express.json());
  app.use(route, createCustomerFinancialProviderRetentionRouter({
    auth: spies.auth || ((req, _res, next) => { req.tenantContext = {
      organizationId: source.organizationId, userId: source.actorUserId };
    req.authSession = { id: source.authSessionId }; req.userRole = 'owner'; next(); }),
    role: spies.role || ((_req, _res, next) => next()),
    throttle: spies.throttle || ((_req, _res, next) => next()),
    read: spies.read || (async () => contract.unavailable()),
  }));
  return app;
}

describe('Mission 27 Part 13B lifecycle retention, deletion and cleanup readiness', () => {
  test('projects every exact server-owned semantic leaf and fails closed on any mutation', () => {
    const value = contract.unavailable();
    expect(contract.project(clone(value))).toEqual(value);
    expect(value).toMatchObject({
      contractVersion: 'm27-provider-lifecycle-retention-v1',
      state: 'unavailable', reason: 'retention_deletion_authority_unavailable', value: null,
      checkpoints: { maximumPageSize: 100, concurrentWriterPerAggregate: 1,
        checkpointIdentity: null, persisted: false, mayAuthorizeReplayOrDeletion: false },
      replayWindow: { webhookClockToleranceSeconds: 300, rawProviderEventDays: 30,
        replayWindowEvaluated: false, replayAccepted: false, olderSourceFallbackAllowed: false },
      retention: { rawQuotedJobMediaDays: 30, rawProviderEventDays: 30,
        publicSessionTombstoneDays: 30,
        financialRecordCalendarYears: 7, immutableIdempotencyAndAuditCalendarYears: 7,
        policyReviewComplete: false, rawTranscriptCopiedIntoMission27: false,
        retentionLaunchAuthorized: false },
      deletionRequest: { state: 'unavailable', scope: null, scopeDigest: null,
        dualControlSatisfied: false, authorized: false, executed: false, deletedRecordCount: 0 },
      holds: { holdsSuspendEligibleDeletion: true, disputeBlocksDestructiveCleanup: true,
        legalHoldState: 'unavailable', auditHoldState: 'unavailable',
        disputeHoldState: 'unavailable', refundHoldState: 'unavailable',
        unknownHoldStateBlocksDestructiveCleanup: true,
        refundHoldBlocksDestructiveCleanup: true },
      cleanup: { resumableCleanupRequired: true, maximumBatchSize: 100,
        checkpointIdentity: null, processedCount: 0, deletedCount: 0, completed: false },
      tombstone: { minimizedNonSensitiveProofRequired: true, publicSessionTombstoneDays: 30,
        retainedFieldNames: null, tombstoneWritten: false, tombstoneCount: 0 },
    });
    expect(leaves(value).length).toBeGreaterThan(100);
    for (const leaf of leaves(value)) expect(() => contract.project(mutate(value, leaf)))
      .toThrow('Provider lifecycle retention boundary invalid');
  });

  test('rejects every structural, source, digest, ordering and joint-forgery variant', () => {
    const value = clone(contract.unavailable()); const cases = [];
    const missing = clone(value); delete missing.holds; cases.push(missing);
    cases.push({ ...clone(value), customerIdentity: 'victim' });
    const reordered = clone(value); reordered.sources.reverse(); cases.push(reordered);
    const renamed = clone(value); renamed.sources[0].source = 'part13_forger'; cases.push(renamed);
    const duplicate = clone(value); duplicate.sources[1] = clone(duplicate.sources[0]); cases.push(duplicate);
    const forged = clone(value); forged.sources[0].digest = digest({ forged: true });
    forged.cleanup.completed = true; cases.push(forged);
    cases.push(Object.fromEntries(Object.entries(value).reverse()));
    for (const candidate of cases) expect(() => contract.project(candidate))
      .toThrow('Provider lifecycle retention boundary invalid');
  });

  test('binds exact Part13A and Part8A evidence with separate fail-closed lifecycle axes', () => {
    const value = contract.unavailable(); const sourceHealth = health.unavailable();
    expect(value.sources).toEqual([
      { source: 'part13a_provider_lifecycle_health', contractVersion: health.CONTRACT_VERSION,
        digest: digest(sourceHealth) },
      { source: 'part8a_provider_event_receipt',
        contractVersion: sourceHealth.webhookLifecycle.providerEventReceiptVersion,
        digest: sourceHealth.webhookLifecycle.providerEventReceiptDigest },
    ]);
    expect(value.requirements.map(item => [item.requirement, item.state, item.reason]))
      .toEqual(contract.REQUIREMENTS.map(([name, reason]) => [name, 'unavailable', reason]));
    expect(value.privacy).toEqual({ organizationIdentityReturned: false,
      actorIdentityReturned: false, sessionIdentityReturned: false,
      customerIdentityReturned: false, providerAccountIdentityReturned: false,
      providerEventIdentityReturned: false, deletionScopeReturned: false,
      holdIdentityReturned: false, checkpointIdentityReturned: false,
      secretValueReturned: false });
    expect(value).toMatchObject({ checkpointWriteAuthorized: false, replayAuthorized: false,
      retentionStarted: false, deletionRequestAuthorized: false, holdMutationAuthorized: false,
      cleanupAuthorized: false, tombstoneWriteAuthorized: false, providerCallCount: 0,
      providerMutationCount: 0, receiverMutationCount: 0, accountingMutationCount: 0,
      databaseMutationCount: 0, liveMoneyMovementCount: 0 });
    expect(JSON.stringify(value)).not.toMatch(
      /"organizationId":|"actorUserId":|"authSessionId":|acct_[A-Za-z0-9]|sk_[A-Za-z0-9]|whsec_|https:\/\//);
  });

  test('repository rereads exact Part13A on every request and rejects source or concurrency drift', async () => {
    const readHealth = jest.fn(async () => health.unavailable());
    const repo = repository.createRepository({ readHealth });
    await expect(repo.read(source)).resolves.toEqual(contract.unavailable());
    expect(readHealth).toHaveBeenCalledTimes(2);
    for (const invalid of [null, {}, { ...source, actorAccessRole: 'admin' },
      { ...source, actorAccessRole: 'owner', tenantId: source.organizationId },
      { ...source, organizationId: 'victim' }, { ...source, authSessionId: null }]) {
      await expect(repo.read(invalid)).rejects.toMatchObject({
        code: 'CUSTOMER_FINANCIAL_PROVIDER_RETENTION_RESTRICTED', status: 403,
      });
    }
    const forgedHealth = clone(health.unavailable());
    forgedHealth.incidentControl.paymentInitiationAuthorized = true;
    await expect(repository.createRepository({ readHealth: async () => forgedHealth }).read(source))
      .rejects.toThrow('Provider lifecycle health boundary invalid');
    let call = 0;
    const drifting = repository.createRepository({ readHealth: async () => {
      call += 1; const value = clone(health.unavailable());
      if (call === 2) value.state = 'forged';
      return value;
    } });
    await expect(drifting.read(source)).rejects.toThrow('Provider lifecycle health boundary invalid');
    readHealth.mockClear();
    const parallel = await Promise.all(Array.from({ length: 16 }, () => repo.read(source)));
    expect(parallel.every(item => JSON.stringify(item) === JSON.stringify(contract.unavailable()))).toBe(true);
    expect(readHealth).toHaveBeenCalledTimes(32);
  });

  test('recognizes all supported body framing before parsing', () => {
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
  });

  test('rejects every named unsupported HTTP method before downstream entry', () => {
    const methods = ['HEAD','OPTIONS','POST','PUT','PATCH','DELETE','ACL','BIND','CHECKOUT',
      'CONNECT','COPY','LINK','LOCK','MERGE','MKACTIVITY','MKCALENDAR','MKCOL','MOVE',
      'M-SEARCH','NOTIFY','PROPFIND','PROPPATCH','PURGE','REBIND','REPORT','SEARCH','SOURCE',
      'SUBSCRIBE','TRACE','UNBIND','UNLINK','UNLOCK','UNSUBSCRIBE'];
    for (const method of methods) {
      const req = { method, path: route, headers: {}, rawHeaders: [] };
      const headers = {}; const body = [];
      const res = { set(name, value) { headers[name.toLowerCase()] = value; return this; },
        vary(value) { headers.vary = value; return this; },
        status(value) { this.statusCode = value; return this; },
        json(value) { body.push(value); return this; } };
      const next = jest.fn();
      providerLifecycleRetentionBoundary(req, res, next);
      expect(res.statusCode).toBe(405); expect(headers.allow).toBe('GET');
      expect(headers['cache-control']).toBe('private, no-store');
      expect(body).toEqual([{ success: false, error: {
        category: 'CUSTOMER_FINANCIAL_PROVIDER_RETENTION_METHOD_NOT_ALLOWED',
        message: 'Use the provider lifecycle retention read boundary.' } }]);
      expect(next).not.toHaveBeenCalled();
    }
  });

  test('owns method, body, path, query and CORS composition before all downstream entry', async () => {
    const auth = jest.fn((_req, _res, next) => next());
    const throttle = jest.fn((_req, _res, next) => next()); const read = jest.fn();
    const app = appWithSpies({ auth, throttle, read });
    const protectedPaths = [route, route + '/', route.toUpperCase()];
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
      expect(response.status).toBe(405);
      expect(response.headers['cache-control']).toContain('private');
      expect(response.headers['cache-control']).toContain('no-store');
      expect(response.headers.allow).toBe('GET');
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

  test('allows only exact empty GET equivalents, leaves near misses alone, and adds no effects or migration', async () => {
    const read = jest.fn(async () => contract.unavailable()); const app = appWithSpies({ read });
    for (const allowed of [route, route + '/', route.toUpperCase(),
      '/Api/V1/Customer-Financial/Payment-Provider/Lifecycle-Retention',
      route.replace('/payment-provider/','/payment-provider/./'),
      route.replace('/payment-provider/','/payment-provider/%2e/'),
      route.replace('/payment-provider/','/payment-provider\\')]) {
      const response = await request(app).get(allowed).set('Content-Length','0');
      expect(response.status).toBe(200); expect(response.body.data).toEqual(contract.unavailable());
    }
    for (const near of [route + '/extra', route.replace('lifecycle-retention','lifecycle-retentionx'),
      route.replace('/payment-provider/','/payment-provider//'),
      route.replace('lifecycle-retention','lifecycle%2Dretention'),
      route.replace('lifecycle-retention','lifecycle%2Fretention'),
      route.replace('lifecycle-retention','lifecycle%5Cretention')]) {
      expect((await request(app).get(near)).status).toBe(404);
    }
    expect(read).toHaveBeenCalledTimes(7);
    const files = ['src/customerFinancial/providerLifecycleRetention.js',
      'src/customerFinancial/providerLifecycleRetentionRepository.js',
      'src/customerFinancial/providerLifecycleRetentionHttpBoundary.js',
      'src/middleware/providerLifecycleRetentionBoundary.js',
      'src/routes/customerFinancialProviderRetention.js'];
    const implementation = files.map(readFile).join('\n'); const server = readFile('src/server.js');
    expect(implementation).not.toMatch(
      /fetch\(|axios|stripe\.|checkout\.sessions|paymentIntents|https\.request|process\.env\.[A-Z_]*STRIPE/i);
    expect(implementation).not.toMatch(/router\.(post|put|patch|delete)\(/);
    expect(readFile('src/routes/demo.js')).not.toContain('lifecycle-retention');
    expect(server.indexOf("payment-provider/lifecycle-retention")).toBeLessThan(
      server.indexOf("payment-provider',"));
    const migrations = fs.readdirSync(path.join(ROOT, 'migrations'))
      .filter(name => name.endsWith('.sql')).sort();
    expect(migrations.at(-1)).toBe('272_customer_financial_invoice_draft_preview_v1.sql');
    expect(migrations.some(name => /^273_/.test(name))).toBe(false);
  });
});
