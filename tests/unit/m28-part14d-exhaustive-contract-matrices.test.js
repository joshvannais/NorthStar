'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const runtime = require('../../src/automation/runtimeEngine');
const businessEngine = require('../../src/automation/businessDecisionEngine');
const centerContract = require('../../public/js/automation-center-contract');
const { createAutomationCenterRouter } = require('../../src/routes/automationCenter');
const { buildSnapshot } = require('../../src/automationCenter/repository');
const { corsOptions } = require('../../src/middleware/security');
const config = require('../../src/config');
const { DemoCommandCenterRepository, issueToken } = require('../../src/commandCenter/demoRepository');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const TENANT = '00000000-0000-4000-8000-000000000028';
const SESSION = '00000000-0000-4000-8000-000000000002';
const ACTOR = '00000000-0000-4000-8000-000000000001';

function context(overrides = {}) {
  return { tenantId: TENANT, sessionId: SESSION, workspaceGeneration: 1, workspaceRevision: 1,
    anchorTime: '2026-11-23T15:00:00.000Z', ...overrides };
}
function preview(overrides = {}) {
  return { templateId: 'custom', name: 'Private owner review',
    sourceClassId: 'mission23_work_execution', actionFamily: 'internal_read_digest_task',
    recipientClass: 'tenant_owner', channelId: 'in_app_passive', timing: 'review_now', dailyLimit: 2,
    ...overrides };
}
function businessOptions(input, mode = 'isolated_demo') {
  return {
    mode, tenantId: input.tenantId, evaluatedAt: input.evaluatedAt,
    policyId: input.policy.policyId, policyVersion: input.policy.version,
    policyLifecycle: input.policy.lifecycle, policyCurrentness: input.policy.currentness,
    policyExpiresAt: input.policy.expiresAt,
    sourceId: input.source.sourceId, sourceVersion: input.source.version,
    sourceDigest: input.source.sourceDigest, sourceState: input.source.state,
    sourceValue: input.source.value, sourceLineage: input.source.lineage,
    sourceObservedAt: input.source.observedAt, sourceClassId: input.source.sourceClassId,
    actionFamily: input.authorization.actionFamily, recipientClass: input.authorization.recipientClass,
    channelId: input.authorization.channelId, providerMode: input.authorization.providerMode,
    effectClass: input.authorization.effectClass, authorizationState: input.authorization.state,
    permissionState: input.permission.state, controls: { ...input.controls.states },
    schedule: { timeZone: input.schedule.timeZone, localDate: input.schedule.localDate,
      localTime: input.schedule.localTime, foldResolution: input.schedule.foldResolution,
      utcInstant: input.schedule.utcInstant, acceptedAt: input.schedule.acceptedAt,
      expiresAt: input.schedule.expiresAt,
      allowedWindows: input.schedule.allowedWindows.map(value => ({ ...value })),
      quietWindows: input.schedule.quietWindows.map(value => ({ ...value })),
      holidays: input.schedule.holidays.slice() },
    execution: { claimState: input.execution.claimState,
      claimAcquiredAt: input.execution.claimAcquiredAt, claimExpiresAt: input.execution.claimExpiresAt,
      recoveryState: input.execution.recoveryState },
  };
}
function rebuild(input, overrides = {}) {
  const base = businessOptions(input, overrides.mode || input.mode);
  const schedule = { ...base.schedule, ...(overrides.schedule || {}) };
  if ((Object.prototype.hasOwnProperty.call(overrides.schedule || {}, 'timeZone') ||
       Object.prototype.hasOwnProperty.call(overrides.schedule || {}, 'utcInstant')) &&
      !['localDate', 'localTime', 'foldResolution'].some(key =>
        Object.prototype.hasOwnProperty.call(overrides.schedule || {}, key))) {
    Object.assign(schedule, businessEngine.localScheduleMaterial(schedule.timeZone, schedule.utcInstant));
  }
  return businessEngine.controlledInput({ ...base, ...overrides,
    controls: { ...base.controls, ...(overrides.controls || {}) }, schedule,
    execution: { ...base.execution, ...(overrides.execution || {}) } });
}
function emptyResults() {
  return { evaluatedAt: new Date('2026-11-24T00:00:00.000Z'), policies: [], runs: [], records: [],
    documents: [], channels: [], stopControl: [] };
}
function paidApp(readCenter = async (_pool, actor) => buildSnapshot(actor, emptyResults())) {
  const app = express(); app.use(express.json({ limit: '8kb' }));
  const tenantAuth = (req, _res, next) => {
    const role = req.get('x-test-role') || 'owner';
    req.user = { id: ACTOR }; req.userRole = role; req.orgId = TENANT;
    req.tenantContext = { organizationId: TENANT, userId: ACTOR, role };
    req.authSession = { id: SESSION }; req.requestId = 'part14d-matrix'; next();
  };
  app.use('/api/v1/automation-center', createAutomationCenterRouter({ tenantAuth,
    mutationAuth: (_req, _res, next) => next(), throttle: (_req, _res, next) => next(),
    poolProvider: () => ({ name: 'matrix-pool' }), readCenter }));
  app.use((error, _req, res, _next) => res.status(error.status || 500)
    .json({ success: false, code: error.code || 'unavailable' }));
  return app;
}
function knownError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}
function demoTransportFixture() {
  const token = issueToken(new Date('2026-11-23T15:00:00.000Z'));
  const engineContext = context({ tenantId: token.tenantId, sessionId: token.sessionId });
  const initial = runtime.initialState(engineContext);
  const updated = runtime.applyAction(initial, engineContext, 'provider_step');
  const makeRecord = (automationJourney, revision) => ({
    tenantId: token.tenantId, sessionId: token.sessionId, revision,
    state: { generation: 1, createdAt: engineContext.anchorTime, automationJourney },
  });
  const initialRecord = makeRecord(initial, 1);
  const updatedRecord = makeRecord(updated, 2);
  const priorSecret = config.auth.accessSecret;
  config.auth.accessSecret = 'part14d-mounted-transport-matrix-secret-0001';
  const tokenSpy = jest.spyOn(DemoCommandCenterRepository.prototype, 'token').mockReturnValue(token);
  const readSpy = jest.spyOn(DemoCommandCenterRepository.prototype, 'read').mockResolvedValue(initialRecord);
  const replay = new Map();
  const mutateSpy = jest.spyOn(DemoCommandCenterRepository.prototype, 'mutate')
    .mockImplementation(async (actualToken, input, options) => {
      expect(actualToken).toMatchObject({ tenantId: token.tenantId, sessionId: token.sessionId });
      expect(input).toMatchObject({ operation: 'automation_action' });
      expect(Object.keys(input).sort()).toEqual([
        'automationAction', 'expectedRevision', 'idempotencyKey', 'operation',
      ]);
      expect(options.sourceHash).toMatch(/^[0-9a-f]{64}$/);
      if (typeof input.idempotencyKey !== 'string' || input.idempotencyKey.length < 16 ||
          input.idempotencyKey.length > 128) {
        throw knownError(400, 'DEMO_IDEMPOTENCY_REQUIRED', 'A bounded idempotency key is required.');
      }
      const requestDigest = JSON.stringify({ action: input.automationAction,
        expectedRevision: input.expectedRevision });
      const prior = replay.get(input.idempotencyKey);
      if (prior && prior !== requestDigest) {
        throw knownError(409, 'DEMO_IDEMPOTENCY_CONFLICT',
          'That demo action key was already used for a different action.');
      }
      if (prior) return { record: updatedRecord, replayed: true };
      if (input.expectedRevision !== 1) {
        throw knownError(409, 'DEMO_STATE_CHANGED', 'The fictional automation changed.');
      }
      if (input.automationAction !== 'provider_step') {
        throw knownError(409, 'AUTOMATION_DEMO_ACTION_UNAVAILABLE',
          'That fictional action is not currently available.');
      }
      replay.set(input.idempotencyKey, requestDigest);
      return { record: updatedRecord, replayed: false };
    });
  const app = express(); app.set('trust proxy', false);
  app.use('/api/demo', require('../../src/routes/demo'));
  return { app, tokenSpy, readSpy, mutateSpy, cleanup() {
    config.auth.accessSecret = priorSecret;
    tokenSpy.mockRestore(); readSpy.mockRestore(); mutateSpy.mockRestore();
  } };
}

describe('Mission 28 Part 14D exhaustive semantic and structural matrices', () => {
  test('publishes every frozen dimension without claiming later-slice evidence', () => {
    const artifact = JSON.parse(read('docs/architecture/MISSION_28_PART14D_EXHAUSTIVE_CONTRACT_MATRICES.json'));
    expect(artifact).toMatchObject({
      contractVersion: 'mission28.part14d.exhaustive-contract-matrices.v1',
      status: 'released',
      base: { acceptedSourceHead: 'b4da799f85333058ccca4cd3fd3c3908537b911f',
        acceptedTree: '731bf82d926e9b32708b6ec396fd98d50a8d9ea3', pullRequest: 610,
        mergedMain: 'db9c14d9206bdb3a6f73d83ee7f480aedb2f9fb1' },
      scope: { part: '14D', migrationAdded: false, latestMigration: 288, nextMigrationAbsent: 289,
        postgreSQLMountedWorkerRestartMeasurementsIncluded: false,
        genuineBrowserAcceptanceIncluded: false, releaseIncluded: false },
      release: { acceptedSourceHead: 'fd917d5459033e0af78fb65e1f368c31d33ef68c',
        acceptedTree: '7210b21b9aa42fbe67d01846ca87cc6d64aad656', pullRequest: 611,
        mergedMain: 'cb2c68aac404bc055352c78853e8b3ce0d90982c',
        deploymentId: '2f26683f-aaee-42ad-9cf5-2c4c4891cdbf',
        productionMigrations: '284_of_284_through_288_no_289' },
      matrices: { privacyAndEffects: { providerCalled: false, recipientContacted: false,
        paidTenantMutatedByDemo: false, externalEffectCreated: false,
        financialEffectCreated: false, moneyEffectCreated: false } },
    });
    expect(artifact.scope.dimensions).toEqual([
      'policies', 'sources', 'versions', 'digests', 'currentness', 'roles', 'capabilities',
      'sessions', 'tenants', 'recipients', 'consent', 'paths', 'queries', 'bodies', 'framing',
      'methods', 'CORS', 'templates', 'callbacks', 'idempotency', 'concurrency', 'corrections',
      'retries', 'restarts', 'privacy', 'zero unintended effects',
    ]);
    expect(read('docs/architecture/MISSION_28_PART14D_EXHAUSTIVE_CONTRACT_MATRICES.md'))
      .toMatch(/Part 14E remains\s+the authority for fresh PostgreSQL/);
    const released = JSON.parse(read('docs/architecture/MISSION_28_PART14C_ISOLATED_DEMO_PARITY.json'));
    expect(released.release).toMatchObject({
      backupId: '0f3f9bf0-6eeb-43fa-b269-38e227ad0ec1',
      backupExternalId: 'vs_1795556666328_jtoie91hdqa3ze8b',
      quotaRotation: { olderSnapshotsRemovedBeforeReplacementToClearQuota: 5,
        priorNewestProtectedBackupId: '32307774-0077-478b-8c18-d99405af7b96',
        priorNewestRemovedOnlyAfterFreshReplacementConfirmed: true,
        retainedBackupsAfterRotation: 1 },
    });
    expect(read('docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md')).toContain(
      '| Mission 28 released baseline | Part 14E source `d63b9ff59f6af6aae63e6eeaa2f9683354245eea`; main `1c7eea4fd98773ed07b91bc632b10ca6f1ff03e3`; tree `bf795536a331b940519c33e05115ce2f93c47daa` |'
    );
  });

  test('evaluates a closed restrictive authority matrix from one exact positive control', () => {
    const base = runtime.businessInputForState(runtime.initialState(context()), context());
    expect(businessEngine.evaluate(base)).toMatchObject({
      policy: { state: 'active_exact_current' }, evaluation: { state: 'eligible' },
      suppression: { state: 'clear' }, scheduler: { state: 'scheduled_unpublished' },
      recovery: { state: 'ready_no_effect' }, runnable: true,
      effects: { recipients: 0, providerCalls: 0, external: 0, financial: 0, money: 0 },
    });
    const cases = [
      ['policy paused', { policyLifecycle: 'paused' }, ['paused', 'ineligible', 'unavailable']],
      ['policy currentness unavailable', { policyCurrentness: 'unavailable' }, ['unavailable', 'unavailable', 'unavailable']],
      ['source unavailable', { sourceState: 'unavailable', sourceValue: null }, ['active_exact_current', 'unavailable', 'unavailable']],
      ['lineage unavailable', { sourceLineage: 'unavailable' }, ['active_exact_current', 'unavailable', 'unavailable']],
      ['authorization required', { authorizationState: 'required' }, ['active_exact_current', 'approval_required', 'unavailable']],
      ['recipient permission blocked', { permissionState: 'exact_current_blocked' }, ['active_exact_current', 'suppressed', 'unavailable']],
      ['global pause', { controls: { globalPause: 'matched' } }, ['active_exact_current', 'suppressed', 'unavailable']],
      ['provider uncertainty', { controls: { providerUncertainty: 'matched' } }, ['active_exact_current', 'unavailable', 'unavailable']],
      ['source changed', { controls: { sourceChange: 'matched' } }, ['active_exact_current', 'unavailable', 'unavailable']],
      ['execution uncertain', { execution: { claimState: 'uncertain', claimAcquiredAt: null,
        claimExpiresAt: null, recoveryState: 'unavailable' } },
      ['active_exact_current', 'eligible', 'reconciliation_required_no_resend']],
    ];
    for (const [label, overrides, expected] of cases) {
      const decision = businessEngine.evaluate(rebuild(base, overrides));
      expect([decision.policy.state, decision.evaluation.state, decision.recovery.state])
        .toEqual(expected);
      expect(decision.runnable).toBe(false);
      expect(Object.values(decision.effects).every(value => value === 0)).toBe(true);
      expect(label).toBeTruthy();
    }
  });

  test('rejects version, digest, tenant, session-owned identity and closed-vocabulary retargeting', () => {
    const original = runtime.businessInputForState(runtime.initialState(context()), context());
    for (const mutation of [
      value => { value.tenantId = '00000000-0000-4000-8000-000000000029'; },
      value => { value.policy.version += 1; },
      value => { value.source.sourceDigest = 'sha256:' + 'f'.repeat(64); },
      value => { value.authorization.channelId = 'unknown_channel'; },
      value => { value.controls.states.globalPause = 'unknown'; },
    ]) {
      const copy = structuredClone(original); mutation(copy);
      expect(() => businessEngine.evaluate(copy)).toThrow(/binding|digest|unsupported|invalid/i);
    }
    const foreign = runtime.initialState(context({ sessionId: '00000000-0000-4000-8000-000000000003' }));
    expect(() => runtime.validateState(foreign, context())).toThrow(/binding|history/i);
  });

  test('keeps every offered correction, retry and recovery action executable without widening authority', () => {
    let state = runtime.initialState(context());
    for (const action of runtime.allowedActions(state, context())) {
      expect(() => runtime.applyAction(state, context(), action)).not.toThrow();
    }
    state = runtime.applyAction(state, context(), 'source_change');
    expect(runtime.allowedActions(state, context())).toContain('source_correct');
    const corrected = runtime.applyAction(state, context(), 'source_correct');
    expect(runtime.businessDecision(corrected, context()).runnable).toBe(true);
    let claimed = runtime.applyAction(runtime.initialState(context()), context(), 'provider_step');
    claimed = runtime.applyAction(claimed, context(), 'pause');
    claimed = runtime.applyAction(claimed, context(), 'advance_time');
    claimed = runtime.applyAction(claimed, context(), 'resume');
    expect(runtime.allowedActions(claimed, context())).toContain('recover');
    expect(runtime.allowedActions(claimed, context())).not.toContain('provider_step');
    const recovered = runtime.applyAction(claimed, context(), 'recover');
    expect(runtime.businessDecision(recovered, context()).effects)
      .toEqual({ recipients: 0, providerCalls: 0, external: 0, financial: 0, money: 0 });
  });

  test.each([
    ['owner', 200], ['admin', 200], ['member', 403], ['viewer', 403],
  ])('bounds paid reads to exact role/capability authority: %s', async (role, status) => {
    const readCenter = jest.fn(async (_pool, actor) => buildSnapshot(actor, emptyResults()));
    const response = await request(paidApp(readCenter)).get('/api/v1/automation-center')
      .set('x-test-role', role).expect(status);
    expect(response.headers['cache-control']).toMatch(/no-store/);
    expect(readCenter).toHaveBeenCalledTimes(status === 200 ? 1 : 0);
    if (status === 200) expect(readCenter.mock.calls[0][1]).toMatchObject({
      organizationId: TENANT, actorUserId: ACTOR, actorAccessRole: role, authSessionId: SESSION,
    });
  });

  test('prevents paid path, method, query, body and preview inputs from widening authority', async () => {
    const readCenter = jest.fn(async (_pool, actor) => buildSnapshot(actor, emptyResults()));
    const app = paidApp(readCenter);
    await request(app).get('/api/v1/automation-center?tenant=' + encodeURIComponent('foreign')).expect(200);
    expect(readCenter.mock.calls[0][1].organizationId).toBe(TENANT);
    const valid = await request(app).post('/api/v1/automation-center/preview').send(preview()).expect(200);
    expect(valid.body.data).toMatchObject({ previewOnly: true, saved: false, activated: false,
      queued: false, recipientContacted: false, providerAttemptCreated: false,
      externalEffectCreated: false, financialEffectCreated: false, moneyEffectCreated: false });
    await request(app).post('/api/v1/automation-center/preview').send({ ...preview(), tenantId: 'foreign' }).expect(400);
    await request(app).put('/api/v1/automation-center/preview').send(preview()).expect(404);
    await request(app).delete('/api/v1/automation-center').expect(404);
    expect(readCenter).toHaveBeenCalledTimes(1);
  });

  test('keeps CORS transport allowlisting separate from tenant and business authority', async () => {
    const resolve = (origin, pathName = '/api/v1/automation-center') => new Promise((yes, no) => {
      corsOptions({ path: pathName, header: name => name === 'Origin' ? origin : undefined },
        (error, options) => error ? no(error) : yes(options));
    });
    await expect(resolve('https://northstarsolutions.app')).resolves.toMatchObject({ origin: true, credentials: true });
    await expect(resolve('https://attacker.invalid')).resolves.toMatchObject({ origin: false, credentials: true });
    await expect(resolve(undefined)).resolves.toMatchObject({ origin: true, credentials: true });
  });

  test('executes the complete mounted demo transport denial, revision, replay and conflict matrix', async () => {
    const fixture = demoTransportFixture();
    const sameOrigin = test => test.set('Host', 'northstar.test').set('Origin', 'http://northstar.test');
    const previewBody = preview();
    const actionBody = { action: 'provider_step', expectedRevision: 1 };
    const denied = [
      ['read query', () => request(fixture.app).get('/api/demo/automation-center?tenant=foreign'),
        400, 'demo_automation_request_invalid'],
      ['preview missing origin', () => request(fixture.app).post('/api/demo/automation-center/preview')
        .set('Host', 'northstar.test').set('X-NorthStar-Demo-Intent', 'automation-center-preview')
        .set('X-NorthStar-Demo-Revision', '1').send(previewBody), 403, 'demo_same_origin_required'],
      ['preview foreign origin', () => request(fixture.app).post('/api/demo/automation-center/preview')
        .set('Host', 'northstar.test').set('Origin', 'https://attacker.invalid')
        .set('X-NorthStar-Demo-Intent', 'automation-center-preview')
        .set('X-NorthStar-Demo-Revision', '1').send(previewBody), 403, 'demo_same_origin_required'],
      ['preview cross-site framing', () => sameOrigin(request(fixture.app)
        .post('/api/demo/automation-center/preview')).set('Sec-Fetch-Site', 'cross-site')
        .set('X-NorthStar-Demo-Intent', 'automation-center-preview')
        .set('X-NorthStar-Demo-Revision', '1').send(previewBody), 403, 'demo_same_origin_required'],
      ['preview missing intent', () => sameOrigin(request(fixture.app)
        .post('/api/demo/automation-center/preview')).set('X-NorthStar-Demo-Revision', '1')
        .send(previewBody), 403, 'demo_intent_required'],
      ['preview wrong intent', () => sameOrigin(request(fixture.app)
        .post('/api/demo/automation-center/preview')).set('X-NorthStar-Demo-Intent', 'automation-center-action')
        .set('X-NorthStar-Demo-Revision', '1').send(previewBody), 403, 'demo_intent_required'],
      ['preview unknown body member', () => sameOrigin(request(fixture.app)
        .post('/api/demo/automation-center/preview')).set('X-NorthStar-Demo-Intent', 'automation-center-preview')
        .set('X-NorthStar-Demo-Revision', '1').send({ ...previewBody, tenantId: 'foreign' }),
      400, 'demo_automation_preview_invalid'],
      ['action missing origin', () => request(fixture.app).post('/api/demo/automation-center/actions')
        .set('Host', 'northstar.test').set('X-NorthStar-Demo-Intent', 'automation-center-action')
        .set('Idempotency-Key', '00000000-0000-4000-8000-000000000091').send(actionBody),
      403, 'demo_same_origin_required'],
      ['action foreign origin', () => request(fixture.app).post('/api/demo/automation-center/actions')
        .set('Host', 'northstar.test').set('Origin', 'https://attacker.invalid')
        .set('X-NorthStar-Demo-Intent', 'automation-center-action')
        .set('Idempotency-Key', '00000000-0000-4000-8000-000000000092').send(actionBody),
      403, 'demo_same_origin_required'],
      ['action cross-site framing', () => sameOrigin(request(fixture.app)
        .post('/api/demo/automation-center/actions')).set('Sec-Fetch-Site', 'cross-site')
        .set('X-NorthStar-Demo-Intent', 'automation-center-action')
        .set('Idempotency-Key', '00000000-0000-4000-8000-000000000093').send(actionBody),
      403, 'demo_same_origin_required'],
      ['action wrong intent', () => sameOrigin(request(fixture.app)
        .post('/api/demo/automation-center/actions')).set('X-NorthStar-Demo-Intent', 'automation-center-preview')
        .set('Idempotency-Key', '00000000-0000-4000-8000-000000000094').send(actionBody),
      403, 'demo_intent_required'],
      ['action missing body member', () => sameOrigin(request(fixture.app)
        .post('/api/demo/automation-center/actions')).set('X-NorthStar-Demo-Intent', 'automation-center-action')
        .set('Idempotency-Key', '00000000-0000-4000-8000-000000000095')
        .send({ action: 'provider_step' }), 400, 'demo_automation_action_invalid'],
      ['action unknown body member', () => sameOrigin(request(fixture.app)
        .post('/api/demo/automation-center/actions')).set('X-NorthStar-Demo-Intent', 'automation-center-action')
        .set('Idempotency-Key', '00000000-0000-4000-8000-000000000096')
        .send({ ...actionBody, tenantId: 'foreign' }), 400, 'demo_automation_action_invalid'],
    ];
    try {
      for (const [label, perform, status, code] of denied) {
        const before = [fixture.tokenSpy.mock.calls.length, fixture.readSpy.mock.calls.length,
          fixture.mutateSpy.mock.calls.length];
        const response = await perform().expect(status);
        expect(response.headers['cache-control']).toMatch(/no-store/);
        expect(response.body).toMatchObject({ success: false, error: { code } });
        expect([fixture.tokenSpy.mock.calls.length, fixture.readSpy.mock.calls.length,
          fixture.mutateSpy.mock.calls.length]).toEqual(before);
        expect(label).toBeTruthy();
      }

      const beforeMethods = [fixture.tokenSpy.mock.calls.length, fixture.readSpy.mock.calls.length,
        fixture.mutateSpy.mock.calls.length];
      await request(fixture.app).put('/api/demo/automation-center/actions').send(actionBody).expect(404);
      await request(fixture.app).delete('/api/demo/automation-center').expect(404);
      expect([fixture.tokenSpy.mock.calls.length, fixture.readSpy.mock.calls.length,
        fixture.mutateSpy.mock.calls.length]).toEqual(beforeMethods);

      const readResponse = await request(fixture.app).get('/api/demo/automation-center').expect(200);
      expect(readResponse.headers['cache-control']).toMatch(/no-store/);
      expect(readResponse.body).toMatchObject({ success: true,
        demo: { workspaceRevision: 1,
          zeroEffects: { recipients: 0, providerCalls: 0, external: 0, financial: 0, money: 0 } } });

      const currentPreview = await sameOrigin(request(fixture.app)
        .post('/api/demo/automation-center/preview')).set('X-NorthStar-Demo-Intent', 'automation-center-preview')
        .set('X-NorthStar-Demo-Revision', '1').send(previewBody).expect(200);
      expect(currentPreview.body).toMatchObject({ success: true,
        data: { previewOnly: true, recipientContacted: false, providerAttemptCreated: false,
          externalEffectCreated: false, financialEffectCreated: false, moneyEffectCreated: false },
        demo: { workspaceRevision: 1 } });
      for (const revision of [undefined, '2', 'not-a-revision']) {
        let stale = sameOrigin(request(fixture.app).post('/api/demo/automation-center/preview'))
          .set('X-NorthStar-Demo-Intent', 'automation-center-preview');
        if (revision !== undefined) stale = stale.set('X-NorthStar-Demo-Revision', revision);
        const response = await stale.send(previewBody).expect(409);
        expect(response.body).toMatchObject({ success: false,
          error: { code: 'demo_automation_changed' } });
      }
      expect(fixture.mutateSpy).not.toHaveBeenCalled();

      const missingKey = await sameOrigin(request(fixture.app)
        .post('/api/demo/automation-center/actions')).set('X-NorthStar-Demo-Intent', 'automation-center-action')
        .send(actionBody).expect(400);
      expect(missingKey.body.error.code).toBe('demo_idempotency_required');
      const staleAction = await sameOrigin(request(fixture.app)
        .post('/api/demo/automation-center/actions')).set('X-NorthStar-Demo-Intent', 'automation-center-action')
        .set('Idempotency-Key', '00000000-0000-4000-8000-000000000097')
        .send({ action: 'provider_step', expectedRevision: 9 }).expect(409);
      expect(staleAction.body.error.code).toBe('demo_state_changed');

      const stableKey = '00000000-0000-4000-8000-000000000099';
      const first = await sameOrigin(request(fixture.app).post('/api/demo/automation-center/actions'))
        .set('X-NorthStar-Demo-Intent', 'automation-center-action').set('Idempotency-Key', stableKey)
        .send(actionBody).expect(201);
      expect(first.body).toMatchObject({ success: true, replayed: false,
        data: { runs: [{ state: 'in_flight' }] }, demo: { workspaceRevision: 2,
          zeroEffects: { recipients: 0, providerCalls: 0, external: 0, financial: 0, money: 0 } } });
      const replay = await sameOrigin(request(fixture.app).post('/api/demo/automation-center/actions'))
        .set('X-NorthStar-Demo-Intent', 'automation-center-action').set('Idempotency-Key', stableKey)
        .send(actionBody).expect(200);
      expect(replay.body).toMatchObject({ success: true, replayed: true,
        demo: { workspaceRevision: 2 } });
      const conflict = await sameOrigin(request(fixture.app).post('/api/demo/automation-center/actions'))
        .set('X-NorthStar-Demo-Intent', 'automation-center-action').set('Idempotency-Key', stableKey)
        .send({ action: 'pause', expectedRevision: 1 }).expect(409);
      expect(conflict.body.error.code).toBe('demo_idempotency_conflict');
      expect(fixture.mutateSpy).toHaveBeenCalledTimes(5);
    } finally { fixture.cleanup(); }
  });

  test('pins callback, template and privacy boundaries to accepted closed source', () => {
    const demoRoute = read('src/routes/demo.js');
    expect(demoRoute).toMatch(/router\.get\('\/automation-center'[\s\S]*Object\.keys\(req\.query/);
    expect(demoRoute).toMatch(/router\.post\('\/automation-center\/preview'[\s\S]*mutationBoundary\(req, res, 'automation-center-preview'\)/);
    expect(demoRoute).toMatch(/router\.post\('\/automation-center\/actions'[\s\S]*mutationBoundary\(req, res, 'automation-center-action'\)/);
    expect(demoRoute).toContain("exactBody(req.body, ['action', 'expectedRevision'])");
    expect(demoRoute).toContain("idempotencyKey: req.get('Idempotency-Key')");
    expect(demoRoute).toContain("expectedRevision: req.body.expectedRevision");
    expect(centerContract.TEMPLATES.map(value => value.id)).toEqual([
      'owner-work-review', 'estimate-follow-up-review', 'appointment-update-review', 'invoice-reminder-review',
    ]);
    for (const template of centerContract.TEMPLATES) {
      expect(template.description).not.toMatch(/credential|provider adapter|idempotency|queue|digest/i);
    }
    const routeSources = read('src/routes/automationCenter.js') + demoRoute;
    expect(routeSources).not.toMatch(/sendgrid|twilio|stripe|retell/i);
    const artifact = JSON.parse(read('docs/architecture/MISSION_28_PART14D_EXHAUSTIVE_CONTRACT_MATRICES.json'));
    const callback = JSON.parse(read('docs/architecture/MISSION_28_PART13C_AUTHENTICATED_CALLBACK_RECONCILIATION_CONTRACT.json'));
    const template = JSON.parse(read('docs/architecture/MISSION_28_PART7C_CONTENT_TEMPLATE_PREVIEW_CONTRACT.json'));
    expect(artifact.matrices.templatesAndCallbacks).toMatchObject({
      templateContract: 'docs/architecture/MISSION_28_PART7C_CONTENT_TEMPLATE_PREVIEW_CONTRACT.json',
      callbackContract: 'docs/architecture/MISSION_28_PART13C_AUTHENTICATED_CALLBACK_RECONCILIATION_CONTRACT.json',
      callbackStatusStates: callback.statusStateVocabulary,
      callbackSimulationOrProviderClaimAdded: false,
    });
    expect(template.approvedTemplateCatalog.every(item =>
      item.wordingOrigin === 'approved_static_catalog' &&
      item.customerSafeRule === 'closed_catalog_no_free_text_internal_no_effect')).toBe(true);
    expect(callback.authenticationContract).toMatchObject({
      candidateSuppliedVerifiedBooleanOrSignatureMaterial: 'deny',
      sameReplayIdentitySameCanonicalDigest: 'idempotent_historical_replay_no_new_record_or_authority',
      sameReplayIdentityDifferentCanonicalDigest: 'deny',
    });
    expect(callback.actionBindingContract.callbackEvidenceNeverCreatesActionPermissionRecipientChannelRetryResendOrEffectAuthority).toBe(true);
    expect(callback.lineageAndCorrectionContract).toMatchObject({
      correctionAppendOnlyNeverUpdateDeleteOrRewritePriorEvidence: true,
      correctionNeverCreatesRetryResendSuppressionPaymentAccountingBusinessOrLegalAuthority: true,
    });
    expect(artifact.evidenceBoundary.callbacks).toMatch(/no_callback_simulation_or_provider_claim/);
  });
});
