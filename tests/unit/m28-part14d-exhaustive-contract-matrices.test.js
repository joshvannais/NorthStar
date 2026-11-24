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

describe('Mission 28 Part 14D exhaustive semantic and structural matrices', () => {
  test('publishes every frozen dimension without claiming later-slice evidence', () => {
    const artifact = JSON.parse(read('docs/architecture/MISSION_28_PART14D_EXHAUSTIVE_CONTRACT_MATRICES.json'));
    expect(artifact).toMatchObject({
      contractVersion: 'mission28.part14d.exhaustive-contract-matrices.v1',
      status: 'implementation_candidate_not_independently_accepted_not_released',
      base: { acceptedSourceHead: 'b4da799f85333058ccca4cd3fd3c3908537b911f',
        acceptedTree: '731bf82d926e9b32708b6ec396fd98d50a8d9ea3', pullRequest: 610,
        mergedMain: 'db9c14d9206bdb3a6f73d83ee7f480aedb2f9fb1' },
      scope: { part: '14D', migrationAdded: false, latestMigration: 288, nextMigrationAbsent: 289,
        postgreSQLMountedWorkerRestartMeasurementsIncluded: false,
        genuineBrowserAcceptanceIncluded: false, releaseIncluded: false },
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

  test('pins demo framing, revision, idempotency and callback/template/privacy boundaries to closed source', () => {
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
