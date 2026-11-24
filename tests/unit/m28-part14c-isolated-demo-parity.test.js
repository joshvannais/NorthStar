'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const request = require('supertest');
const runtime = require('../../src/automation/runtimeEngine');
const businessEngine = require('../../src/automation/businessDecisionEngine');
const demoProjection = require('../../src/automation/demoProjection');
const paidStateEngine = require('../../src/automationCenter/repository');
const centerContract = require('../../public/js/automation-center-contract');
const commandCenterContract = require('../../public/js/command-center-contract');
const config = require('../../src/config');
const { DemoCommandCenterRepository, issueToken } = require('../../src/commandCenter/demoRepository');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const TENANT = '00000000-0000-4000-8000-000000000028';
const SESSION = '00000000-0000-4000-8000-000000000002';
function context(overrides = {}) {
  return { tenantId: TENANT, sessionId: SESSION, workspaceGeneration: 1, workspaceRevision: 1,
    anchorTime: '2026-11-23T15:00:00.000Z', ...overrides };
}
function businessOptions(input, mode) {
  return {
    mode, tenantId: input.tenantId, evaluatedAt: input.evaluatedAt,
    policyId: input.policy.policyId, policyVersion: input.policy.version,
    policyLifecycle: input.policy.lifecycle, policyCurrentness: input.policy.currentness,
    policyExpiresAt: input.policy.expiresAt,
    sourceId: input.source.sourceId, sourceVersion: input.source.version,
    sourceDigest: input.source.sourceDigest, sourceState: input.source.state,
    sourceValue: input.source.value, sourceLineage: input.source.lineage,
    sourceObservedAt: input.source.observedAt,
    sourceClassId: input.source.sourceClassId,
    actionFamily: input.authorization.actionFamily,
    recipientClass: input.authorization.recipientClass,
    channelId: input.authorization.channelId,
    providerMode: input.authorization.providerMode,
    effectClass: input.authorization.effectClass,
    authorizationState: input.authorization.state, permissionState: input.permission.state,
    controls: { ...input.controls.states },
    schedule: {
      timeZone: input.schedule.timeZone, localDate: input.schedule.localDate,
      localTime: input.schedule.localTime, foldResolution: input.schedule.foldResolution,
      utcInstant: input.schedule.utcInstant,
      acceptedAt: input.schedule.acceptedAt, expiresAt: input.schedule.expiresAt,
      allowedWindows: input.schedule.allowedWindows.map(window => ({ ...window })),
      quietWindows: input.schedule.quietWindows.map(window => ({ ...window })),
      holidays: input.schedule.holidays.slice(),
    },
    execution: {
      claimState: input.execution.claimState, claimAcquiredAt: input.execution.claimAcquiredAt,
      claimExpiresAt: input.execution.claimExpiresAt, recoveryState: input.execution.recoveryState,
    },
  };
}
function rebuildBusinessInput(input, mode, overrides = {}) {
  const options = businessOptions(input, mode);
  const scheduleOverrides = overrides.schedule || {};
  const schedule = { ...options.schedule, ...scheduleOverrides };
  if ((Object.prototype.hasOwnProperty.call(scheduleOverrides, 'timeZone') ||
       Object.prototype.hasOwnProperty.call(scheduleOverrides, 'utcInstant')) &&
      !['localDate', 'localTime', 'foldResolution'].some(field =>
        Object.prototype.hasOwnProperty.call(scheduleOverrides, field))) {
    Object.assign(schedule,
      businessEngine.localScheduleMaterial(schedule.timeZone, schedule.utcInstant));
  }
  return businessEngine.controlledInput({ ...options, ...overrides,
    controls: { ...options.controls, ...(overrides.controls || {}) },
    schedule,
    execution: { ...options.execution, ...(overrides.execution || {}) } });
}
function record(automationJourney, overrides = {}) {
  return { tenantId: TENANT, sessionId: SESSION, revision: 1,
    state: { generation: 1, createdAt: '2026-11-23T15:00:00.000Z',
      ...(automationJourney ? { automationJourney } : {}) }, ...overrides };
}
function actionSequence(actions) {
  let state;
  const results = [];
  for (const action of actions) {
    state = runtime.applyAction(state, context(), action);
    results.push({ action, state, projected: demoProjection.project(record(state)) });
  }
  return results;
}
function deferred() {
  let resolve; let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush(count = 10) { for (let index = 0; index < count; index += 1) await Promise.resolve(); }
function demoPageHarness(json) {
  class FakeElement {
    constructor(tagName = 'div', attributes = {}) {
      this.tagName = tagName.toUpperCase(); this.dataset = {}; this.hidden = false;
      this.childNodes = []; this.attributes = { ...attributes }; this.listeners = {}; this.value = '';
      this.disabled = false; this.selectedIndex = 0; this._text = '';
    }
    get textContent() { return this._text + this.childNodes.map(child => child.textContent || '').join(''); }
    set textContent(value) { this._text = String(value); this.childNodes = []; }
    appendChild(child) { this.childNodes.push(child); return child; }
    replaceChildren(...children) { this._text = ''; this.childNodes = children; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; }
    addEventListener(name, listener) { this.listeners[name] = listener; }
    emit(name, event = {}) { return this.listeners[name] && this.listeners[name]({ currentTarget: this, ...event }); }
    focus() {}
  }
  const html = read('public/dashboard/automation.html');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  const elements = Object.fromEntries(ids.map(id => [id, new FakeElement()]));
  const buttons = [...html.matchAll(/<button[^>]*data-automation-demo-action="([^"]+)"[^>]*>/g)]
    .map(match => new FakeElement('button', { 'data-automation-demo-action': match[1] }));
  const listeners = {};
  const document = {
    readyState: 'loading', getElementById: id => elements[id], createElement: tag => new FakeElement(tag),
    querySelectorAll: selector => selector === '[data-automation-demo-action]' ? buttons : [],
    addEventListener: (name, listener) => { listeners[name] = listener; },
  };
  const window = {
    NorthStarAutomationCenter: centerContract, NorthStarAccountSession: { json },
    NorthStarDemoRuntime: { active: true },
    crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000099' },
  };
  vm.runInNewContext(read('public/js/automation-center-page.js'), { window, document, Intl, Date, Promise, Error, Math });
  return { buttons, elements, listeners };
}
function envelope(state, revision = 1) {
  return demoProjection.project(record(state, { revision }));
}

describe('Mission 28 Part 14C shared isolated runtime', () => {
  test('publishes a source-linked candidate contract without claiming unavailable acceptance', () => {
    const artifact = JSON.parse(read('docs/architecture/MISSION_28_PART14C_ISOLATED_DEMO_PARITY.json'));
    expect(artifact).toMatchObject({
      contractVersion: 'mission28.part14c.isolated-demo-parity.v1',
      status: 'implementation_candidate_not_independently_accepted_not_released',
      base: {
        acceptedSourceHead: 'c0775903ed4e42d1ade8c9936ced2d141d8ff942',
        acceptedTree: '83869d378c2583c350ee4b899c4276e6db091035',
        pullRequest: 609,
        mergedMain: 'd43f0c588fb1785bb0afb6568997a329b485cc8d',
      },
      scope: { part: '14C', demoPath: '/demo/automation', migrationAdded: true,
        latestMigration: 288, nextMigrationAbsent: 289, mission31GuidedSimulationIncluded: false },
      isolatedAuthority: { tenantSessionGenerationBound: true,
        identityBinding: 'exact_uuid_versions_1_through_8_including_repository_uuidv5_no_coercion',
        workspaceRevisionCompareAndSwap: true,
        paidCookiesSelectDemoAuthority: false, fictionalDataCanEnterPaidAuthority: false },
      controlledAdapters: { processingClaim: 'immutable_per_provider_attempt_with_new_identity_after_recovery',
        pauseResumeRefreshesClaim: false,
        actionAvailability: 'every_offered_action_satisfies_its_exact_shared_business_and_admission_predicate' },
      raceAndReset: { currentLoadOrActionFailureInvalidatesDependentPreview: true,
        unboundConflictClearsMountedState: true },
      effectBoundary: { paidTenantMutated: false, providerCalled: false, recipientContacted: false,
        externalEffectCreated: false, financialEffectCreated: false, moneyEffectCreated: false },
    });
    expect(Object.values(artifact.effectBoundary).every(value => value === false)).toBe(true);
    expect(read('docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md'))
      .toContain('Parts 1A–14B are released. Part 14C is the sole implementation candidate.');
    expect(read('docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md')).toContain('Part 14B audit / release');
  });

  test('creates one deterministic fictional journey with fixed adapters and zero effects', () => {
    const left = runtime.initialState(context());
    const right = runtime.initialState(context());
    expect(left).toEqual(right);
    expect(runtime.validateState(left, context())).toEqual(left);
    expect(left).toMatchObject({
      virtualNow: '2026-11-23T16:00:00.000Z',
      source: { version: 1, observedAt: '2026-11-23T15:00:00.000Z' },
      run: {
        scheduleAcceptedAt: '2026-11-23T15:00:00.000Z',
        scheduledAt: '2026-11-23T16:00:00.000Z',
      },
    });
    expect(left.events.slice(0, 3).map(event => event.at))
      .toEqual(Array(3).fill('2026-11-23T15:00:00.000Z'));
    const projected = demoProjection.project(record(left));
    expect(projected.snapshot.counts).toMatchObject({ policies: 1, activePolicies: 1, runs: 1 });
    expect(projected.snapshot.runs[0].state).toBe('queued');
    expect(projected.demo).toMatchObject({
      contract: 'mission28.part14c.isolated-automation-demo.v1', generation: 1,
      providerMode: 'deterministic_local_simulation_no_provider',
      zeroEffects: { recipients: 0, providerCalls: 0, external: 0, financial: 0, money: 0 },
    });
    expect(projected.demo.allowedActions).toEqual(expect.arrayContaining([
      'provider_step', 'pause', 'suppress', 'source_change', 'reset_automation',
    ]));
    expect(projected.demo.allowedActions).not.toContain('source_correct');
    expect(projected.snapshot.channels.find(item => item.id === 'email')).toMatchObject({
      state: 'fictional_simulation_only', providerMode: 'Controlled simulation; no outside-service calls',
    });
    expect(JSON.stringify(projected)).not.toMatch(/api[_-]?key|credential|real recipient/i);
    const weekendContext = context({ anchorTime: '2026-11-22T04:30:00.000Z' });
    const weekendState = runtime.initialState(weekendContext);
    expect(runtime.businessDecision(weekendState, weekendContext).scheduler.state).toBe('scheduled_unpublished');
  });

  test('uses tenant/session/generation bindings so another demo cannot select the same fictional authority', () => {
    const first = runtime.initialState(context());
    const otherTenantContext = context({ tenantId: '00000000-0000-4000-8000-000000000029' });
    const otherTenant = runtime.initialState(otherTenantContext);
    const second = runtime.initialState(context({ sessionId: '00000000-0000-4000-8000-000000000003' }));
    const regenerated = runtime.initialState(context({ workspaceGeneration: 2 }));
    expect(otherTenant.source.id).not.toBe(first.source.id);
    expect(otherTenant.policy.id).not.toBe(first.policy.id);
    expect(second.source.id).not.toBe(first.source.id);
    expect(second.policy.id).not.toBe(first.policy.id);
    expect(regenerated.source.id).not.toBe(first.source.id);
    expect(() => runtime.validateState(first, context({ sessionId: '00000000-0000-4000-8000-000000000003' })))
      .toThrow(/bindings|history/i);
    expect(() => runtime.validateState(first, otherTenantContext)).toThrow(/bindings|history/i);
  });

  test('preserves repository-issued UUIDv5 tenant and session identities through every shared decision binding', () => {
    const issued = issueToken(new Date('2026-11-23T15:00:00.000Z'));
    expect(issued.tenantId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(issued.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const issuedContext = context({ tenantId: issued.tenantId, sessionId: issued.sessionId });
    const state = runtime.initialState(issuedContext);
    const input = runtime.businessInputForState(state, issuedContext);
    expect(input.tenantId).toBe(issued.tenantId);
    for (const component of ['policy', 'source', 'authorization', 'permission', 'controls', 'schedule', 'execution']) {
      expect(input[component].tenantId).toBe(issued.tenantId);
    }
    expect(businessEngine.evaluate(input)).toMatchObject({
      runnable: true, policy: { state: 'active_exact_current' }, evaluation: { state: 'eligible' },
    });
    expect(() => businessEngine.controlledInput({
      ...businessOptions(input, 'isolated_demo'),
      tenantId: '00000000-0000-0000-8000-000000000000',
    })).toThrow(/tenant is invalid/i);
  });

  test('rejects corrupted embedded journey bindings instead of serving labels from untrusted persisted state', () => {
    const state = runtime.initialState(context());
    state.source.id = '00000000-0000-4000-8000-000000000099';
    expect(() => demoProjection.project(record(state))).toThrow(/bindings|unavailable/i);
    const foreignRun = runtime.initialState(context());
    foreignRun.events[0].runId = '00000000-0000-4000-8000-000000000099';
    expect(() => runtime.validateState(foreignRun, context())).toThrow(/history/i);
    const reversedTime = runtime.applyAction(undefined, context(), 'advance_time');
    reversedTime.events.at(-1).at = '2026-11-23T14:59:59.000Z';
    expect(() => runtime.validateState(reversedTime, context())).toThrow(/history/i);
    const unknownEvidence = runtime.initialState(context());
    unknownEvidence.events.at(-1).outcome = 'internal_success';
    expect(() => runtime.validateState(unknownEvidence, context())).toThrow(/history/i);
    const futureSchedule = runtime.initialState(context());
    futureSchedule.run.scheduledAt = '2026-11-23T15:00:01.000Z';
    expect(() => runtime.validateState(futureSchedule, context())).toThrow(/bindings|history/i);
    const incoherentPolicy = runtime.initialState(context());
    incoherentPolicy.policy.control = 'paused';
    expect(() => runtime.validateState(incoherentPolicy, context())).toThrow(/bindings/i);
    const rewrittenPrelude = runtime.initialState(context());
    rewrittenPrelude.events[0].type = 'reconciliation';
    rewrittenPrelude.events[0].outcome = 'bounded_recovery_no_effect';
    expect(() => runtime.validateState(rewrittenPrelude, context())).toThrow(/history/i);
    const impossibleCompletion = runtime.applyAction(
      runtime.applyAction(runtime.initialState(context()), context(), 'provider_step'), context(), 'provider_step');
    impossibleCompletion.events.at(-1).type = 'provider_attempt';
    impossibleCompletion.events.at(-1).outcome = 'deterministic_simulation_started_no_provider';
    expect(() => runtime.validateState(impossibleCompletion, context())).toThrow(/history/i);
    expect(read('src/commandCenter/demoRepository.js')).toContain(
      'validateAutomationJourney(parsedState, token.tenantId, token.sessionId, parsedRevision)');
    expect(read('src/commandCenter/demoRepository.js')).toContain(
      'validateAutomationJourney(nextState, current.tenantId, current.sessionId, nextRevision)');
  });

  test('projects coherent policy, evaluation, scheduler, suppression and recovery states through one renderer', () => {
    const results = actionSequence([
      'source_change', 'source_correct', 'resume', 'advance_time', 'provider_step', 'suppress',
      'recover', 'resume', 'pause', 'resume', 'stop', 'reset_automation',
    ]);
    expect(results.map(item => item.projected.snapshot.runs[0].state)).toEqual([
      'stale', 'recovery', 'queued', 'queued', 'in_flight', 'suppressed',
      'recovery', 'queued', 'paused', 'queued', 'stopped', 'queued',
    ]);
    expect(results[0].projected.demo.allowedActions).toContain('source_correct');
    expect(results[0].projected.demo.allowedActions).not.toContain('provider_step');
    expect(results[10].projected.demo.allowedActions).toEqual(['reset_automation']);
    const corrected = results[1];
    expect(corrected.state.source.version).toBe(corrected.state.run.capturedSourceVersion);
    expect(corrected.state.source.observedAt).toBe('2026-11-23T16:00:00.000Z');
    expect(runtime.businessInputForState(corrected.state, context()).source.observedAt)
      .toBe(corrected.state.source.observedAt);
    expect(new Date(corrected.state.run.scheduleAcceptedAt).getTime())
      .toBeGreaterThanOrEqual(new Date(corrected.state.source.observedAt).getTime());
    expect(corrected.state.policy.version).toBe(2);
    expect(corrected.state.run.scheduleAcceptedAt).toBe(corrected.state.virtualNow);
    expect(new Date(corrected.state.run.scheduledAt).getTime() -
      new Date(corrected.state.run.scheduleAcceptedAt).getTime()).toBe(60 * 60 * 1000);
    expect(results[2].projected.demo.allowedActions).not.toContain('provider_step');
    expect(results[3].projected.demo.allowedActions).toContain('provider_step');
    expect(corrected.projected.snapshot.timeline.map(item => item.label)).toEqual(
      expect.arrayContaining(['Review evidence recorded', 'Schedule evidence recorded']));
  });

  test('runs a deterministic local provider sequence without strengthening internal completion', () => {
    const results = actionSequence(['provider_step', 'provider_step']);
    expect(results[0].projected.snapshot.runs[0]).toMatchObject({ state: 'in_flight',
      stateExplanation: expect.stringMatching(/recorded work is being processed/i) });
    expect(results[1].projected.snapshot.runs[0]).toMatchObject({ state: 'completed',
      stateExplanation: expect.stringMatching(/does not prove.*business outcome/i) });
    expect(results[1].projected.demo.zeroEffects).toEqual({ recipients: 0, providerCalls: 0,
      external: 0, financial: 0, money: 0 });
    expect(results[1].state.events.at(-1)).toMatchObject({
      type: 'terminal_outcome', outcome: 'completed_internal_simulation_only',
    });
  });

  test('virtual time is server-fixed, expires schedules, and cannot be widened by action input', () => {
    let state = runtime.initialState(context());
    const original = state.virtualNow;
    state = runtime.applyAction(state, context(), 'advance_time');
    expect(new Date(state.virtualNow).getTime() - new Date(original).getTime()).toBe(24 * 60 * 60 * 1000);
    state = runtime.applyAction(state, context(), 'advance_time');
    state = runtime.applyAction(state, context(), 'advance_time');
    expect(demoProjection.project(record(state)).snapshot.runs[0].state).toBe('expired');
    for (const attacked of ['advance_time:365', 'provider_success', '', null, { action: 'advance_time' }]) {
      expect(() => runtime.normalizeAction(attacked)).toThrow(/choose one current/i);
    }
  });

  test('pause and resume preserve an immutable claim, and expiry requires a new recovered claim', () => {
    let state = runtime.applyAction(runtime.initialState(context()), context(), 'provider_step');
    const originalClaim = runtime.demoEvidenceRow(state, context());
    state = runtime.applyAction(state, context(), 'pause');
    state = runtime.applyAction(state, context(), 'advance_time');
    state = runtime.applyAction(state, context(), 'resume');
    const resumedExpiredClaim = runtime.demoEvidenceRow(state, context());
    expect(resumedExpiredClaim).toMatchObject({
      lease_id: originalClaim.lease_id,
      lease_acquired_at: originalClaim.lease_acquired_at,
      lease_expires_at: originalClaim.lease_expires_at,
    });
    const projection = demoProjection.project(record(state));
    expect(projection.snapshot.runs[0].state).toBe('recovery');
    expect(projection.demo.allowedActions).toContain('recover');
    expect(projection.demo.allowedActions).not.toContain('provider_step');
    expect(() => runtime.applyAction(state, context(), 'provider_step'))
      .toThrow(/not available|must pass/i);
    state = runtime.applyAction(state, context(), 'recover');
    expect(demoProjection.project(record(state)).snapshot.runs[0].state).toBe('recovery');
    state = runtime.applyAction(state, context(), 'resume');
    expect(demoProjection.project(record(state)).snapshot.runs[0].state).toBe('queued');
    expect(runtime.allowedActions(state, context())).toContain('provider_step');
    state = runtime.applyAction(state, context(), 'provider_step');
    const recoveredClaim = runtime.demoEvidenceRow(state, context());
    expect(recoveredClaim.lease_id).not.toBe(originalClaim.lease_id);
    expect(recoveredClaim.lease_acquired_at).toBe(state.virtualNow);
    expect(state.events.filter(event => event.type === 'provider_attempt')).toHaveLength(2);
  });

  test('reset advances generation and invalidates every prior fictional identity and history', () => {
    let state = runtime.applyAction(undefined, context(), 'source_change');
    const prior = JSON.parse(JSON.stringify(state));
    state = runtime.applyAction(state, context(), 'reset_automation');
    expect(state.generation).toBe(prior.generation + 1);
    expect(state.run.id).not.toBe(prior.run.id);
    expect(state.source.id).not.toBe(prior.source.id);
    expect(state.source.digest).not.toBe(prior.source.digest);
    expect(state.policy.id).not.toBe(prior.policy.id);
    expect(state.source.version).toBe(1);
    expect(state.source.observedAt).toBe(context().anchorTime);
    expect(state.events).toHaveLength(3);
    expect(() => runtime.validateState(prior, context({ workspaceGeneration: 2 }))).toThrow();
  });

  test('binds every later fictional source version to its exact history-owned observation time', () => {
    let state = runtime.applyAction(runtime.initialState(context()), context(), 'advance_time');
    state = runtime.applyAction(state, context(), 'source_change');
    const changedAt = state.events.at(-1).at;
    expect(state.source).toMatchObject({ version: 2, observedAt: changedAt });
    expect(state.source.observedAt).toBe(state.virtualNow);
    const changedInput = runtime.businessInputForState(state, context());
    expect(changedInput.source).toMatchObject({ version: 2, observedAt: changedAt });
    state = runtime.applyAction(state, context(), 'source_correct');
    expect(state.source.observedAt).toBe(changedAt);
    expect(state.run.scheduleAcceptedAt).toBe(state.virtualNow);
    expect(new Date(state.run.scheduleAcceptedAt).getTime())
      .toBeGreaterThanOrEqual(new Date(state.source.observedAt).getTime());
    const tampered = JSON.parse(JSON.stringify(state));
    tampered.source.observedAt = context().anchorTime;
    expect(() => runtime.validateState(tampered, context())).toThrow(/history|bindings/i);
  });

  test('offers source correction only when the shared admission predicate can execute it', () => {
    const expectUnavailable = (state, action) => {
      try { runtime.applyAction(state, context(), action); throw new Error('Expected the action to fail.'); }
      catch (error) { expect(error).toMatchObject({ code: 'AUTOMATION_DEMO_ACTION_UNAVAILABLE', status: 409 }); }
    };
    const expectEveryOfferedActionToExecute = state => {
      for (const action of runtime.allowedActions(state, context())) {
        expect(() => runtime.applyAction(state, context(), action)).not.toThrow();
      }
    };

    let pausedAndStale = runtime.applyAction(runtime.initialState(context()), context(), 'pause');
    pausedAndStale = runtime.applyAction(pausedAndStale, context(), 'source_change');
    expect(runtime.allowedActions(pausedAndStale, context())).toContain('resume');
    expect(runtime.allowedActions(pausedAndStale, context())).not.toContain('source_correct');
    expectUnavailable(pausedAndStale, 'source_correct');
    expectEveryOfferedActionToExecute(pausedAndStale);

    const explicitlyResumed = runtime.applyAction(pausedAndStale, context(), 'resume');
    expect(runtime.allowedActions(explicitlyResumed, context())).toContain('source_correct');
    const corrected = runtime.applyAction(explicitlyResumed, context(), 'source_correct');
    expect(corrected.run.capturedSourceVersion).toBe(corrected.source.version);
    expect(runtime.businessDecision(corrected, context())).toMatchObject({
      policy: { state: 'active_exact_current' }, evaluation: { state: 'eligible' },
      scheduler: { state: 'scheduled_unpublished' }, runnable: true,
    });

    let expiredAndStale = runtime.initialState(context());
    for (let day = 0; day < 31; day += 1) {
      expiredAndStale = runtime.applyAction(expiredAndStale, context(), 'advance_time');
    }
    expiredAndStale = runtime.applyAction(expiredAndStale, context(), 'source_change');
    expect(runtime.businessDecision(expiredAndStale, context()).policy.state).toBe('expired');
    expect(runtime.allowedActions(expiredAndStale, context())).not.toContain('source_correct');
    expectUnavailable(expiredAndStale, 'source_correct');
    expectEveryOfferedActionToExecute(expiredAndStale);
  });

  test('paid and demo previews use the same mounted no-effect engine', () => {
    const input = { templateId: 'custom', name: 'Private owner review',
      sourceClassId: 'mission23_work_execution', actionFamily: 'internal_read_digest_task',
      recipientClass: 'tenant_owner', channelId: 'in_app_passive', timing: 'review_now', dailyLimit: 2 };
    const paidPreview = runtime.buildNoEffectPreview(input);
    const demoPreview = runtime.buildNoEffectPreview(input, { mode: 'isolated_demo' });
    expect(paidPreview).toMatchObject(centerContract.buildPreview(input));
    expect(paidPreview).toMatchObject({ previewOnly: true, saved: false,
      activated: false, queued: false, recipientContacted: false, providerAttemptCreated: false,
      externalEffectCreated: false, financialEffectCreated: false, moneyEffectCreated: false });
    expect(paidPreview.engineAssessment).toEqual(expect.objectContaining({
      policy: 'unavailable', evaluation: 'unavailable', scheduler: 'preview_only_no_schedule_created',
      suppression: 'mandatory_checks_required_before_effect', recovery: 'not_applicable_no_effect',
      run: 'unavailable', providerMode: 'provider_unavailable_preview_no_effect',
      recipients: 0, providerCalls: 0, externalEffects: 0, financialEffects: 0, moneyEffects: 0,
    }));
    expect(paidPreview.engineAssessment.businessInputDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(paidPreview.engineAssessment.businessOutputDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(demoPreview.engineAssessment).toMatchObject({
      providerMode: 'provider_unavailable_preview_no_effect', providerCalls: 0,
      recipients: 0, externalEffects: 0, financialEffects: 0, moneyEffects: 0,
    });

    const state = runtime.initialState(context());
    const exactBusinessInput = runtime.businessInputForState(state, context(), 'isolated_demo');
    const exactPreview = runtime.buildNoEffectPreview(input,
      { mode: 'isolated_demo', businessInput: exactBusinessInput });
    expect(exactPreview.engineAssessment).toMatchObject({ policy: 'active_exact_current',
      evaluation: 'eligible', scheduler: 'scheduled_unpublished', suppression: 'clear',
      run: 'ready_no_effect', providerMode: 'deterministic_local_simulation_no_provider' });

    const different = { templateId: 'custom', name: 'Invoices and collection review',
      sourceClassId: 'mission27_financial_collection', actionFamily: 'collection_escalation',
      recipientClass: 'exact_customer_record', channelId: 'email', timing: 'review_now', dailyLimit: 1 };
    const mismatchedPreview = runtime.buildNoEffectPreview(different,
      { mode: 'isolated_demo', businessInput: exactBusinessInput });
    expect(mismatchedPreview).toMatchObject({ action: 'Prepare collection review',
      recipient: 'Customer on the exact record', channel: 'Email',
      engineAssessment: { policy: 'unavailable', evaluation: 'unavailable',
        scheduler: 'preview_only_no_schedule_created', suppression: 'mandatory_checks_required_before_effect',
        run: 'unavailable', providerMode: 'provider_unavailable_preview_no_effect' } });
    expect(mismatchedPreview.engineAssessment.businessInputDigest)
      .not.toBe(exactPreview.engineAssessment.businessInputDigest);
    const unavailableBound = runtime.unavailableBusinessInput('isolated_demo', different);
    expect(unavailableBound.source.sourceClassId).toBe(different.sourceClassId);
    expect(unavailableBound.authorization).toMatchObject({ actionFamily: different.actionFamily,
      recipientClass: different.recipientClass, channelId: different.channelId,
      providerMode: 'provider_unavailable_preview_no_effect', effectClass: 'external_preview_no_effect' });
  });

  test('executes paid and isolated evidence through the same policy, evaluation, scheduler, suppression and recovery functions', () => {
    let state = runtime.initialState(context());
    const canonical = runtime.demoEvidenceRow(state, context());
    const shared = paidStateEngine.evaluateEvidence(canonical, state.virtualNow);
    expect(shared).toMatchObject({
      policy: { id: 'active' }, evaluation: { currentness: null },
      scheduler: { scheduleExpired: false, activeLease: false },
      suppression: null, recovery: { state: null }, run: { id: 'queued' },
    });
    expect(demoProjection.project(record(state)).snapshot.runs[0].state).toBe(shared.run.id);

    state = runtime.applyAction(state, context(), 'suppress');
    const held = paidStateEngine.evaluateEvidence(runtime.demoEvidenceRow(state, context()), state.virtualNow);
    expect(held.suppression).toMatchObject({ id: 'suppressed' });
    expect(held.run.id).toBe('suppressed');
    expect(demoProjection.project(record(state)).snapshot.runs[0].state).toBe(held.run.id);

    state = runtime.applyAction(state, context(), 'recover');
    const recovery = paidStateEngine.evaluateEvidence(runtime.demoEvidenceRow(state, context()), state.virtualNow);
    expect(recovery.recovery).toMatchObject({ state: 'bounded_history_verified_no_effect',
      nonblockingSuperseded: false, projected: { id: 'recovery' } });
    expect(recovery.run.id).toBe('recovery');
  });

  test('uses one source-linked business engine for equivalent paid and demo decisions and restrictive counterexamples', () => {
    const state = runtime.initialState(context());
    const paidInput = runtime.businessInputForState(state, context(), 'paid_no_effect_preview');
    const demoInput = runtime.businessInputForState(state, context(), 'isolated_demo');
    const paid = businessEngine.evaluate(paidInput);
    const demo = businessEngine.evaluate(demoInput);
    expect(demoInput.source.sourceClassId).toBe(runtime.SOURCE_CLASS);
    expect(demoInput.authorization).toMatchObject({ actionFamily: runtime.ACTION_FAMILY,
      recipientClass: runtime.RECIPIENT_CLASS, channelId: runtime.CHANNEL_ID,
      providerMode: 'provider_disabled', effectClass: 'internal_only_no_external_effect' });
    const decisions = value => ({
      policy: value.policy.state, evaluation: value.evaluation.state,
      scheduler: value.scheduler.state, suppression: value.suppression.state,
      recovery: value.recovery.state, runnable: value.runnable, effects: value.effects,
    });
    expect(decisions(paid)).toEqual(decisions(demo));
    expect(decisions(paid)).toEqual({ policy: 'active_exact_current', evaluation: 'eligible',
      scheduler: 'scheduled_unpublished', suppression: 'clear', recovery: 'ready_no_effect',
      runnable: true, effects: { recipients: 0, providerCalls: 0, external: 0, financial: 0, money: 0 } });
    expect([paid, paid.policy, paid.evaluation, paid.suppression, paid.scheduler,
      paid.recovery, paid.effects].every(Object.isFrozen)).toBe(true);
    expect(Object.keys(businessEngine.SOURCES)).toEqual(['evaluator', 'suppression', 'scheduler', 'recovery']);
    const candidateArtifact = JSON.parse(read('docs/architecture/MISSION_28_PART14C_ISOLATED_DEMO_PARITY.json'));
    expect(candidateArtifact.sharedEngines.acceptedSourceContracts).toEqual(Object.values(businessEngine.SOURCES));
    expect(candidateArtifact.sharedEngines).toMatchObject({
      missingAuthorityDisposition:
        'source_value_and_execution_material_are_explicit_required_inputs_never_positive_defaults',
      localScheduleBinding:
        'tenant_zone_local_date_whole_second_local_time_explicit_not_ambiguous_or_earlier_or_later_fold_and_exact_matching_utc_instant',
    });
    for (const source of Object.values(businessEngine.SOURCES)) {
      const normalized = read(source.path).replace(/\r\n/g, '\n').trim() + '\n';
      expect(crypto.createHash('sha256').update(normalized).digest('hex').toUpperCase())
        .toBe(source.normalizedLfSha256);
    }
    const retargeted = JSON.parse(JSON.stringify(demoInput));
    retargeted.source.value = 'stale';
    expect(() => businessEngine.evaluate(retargeted)).toThrow(/source binding/i);

    const changed = runtime.applyAction(state, context(), 'source_change');
    const restrictedPaid = businessEngine.evaluate(
      runtime.businessInputForState(changed, context(), 'paid_no_effect_preview'));
    const restrictedDemo = businessEngine.evaluate(
      runtime.businessInputForState(changed, context(), 'isolated_demo'));
    expect(decisions(restrictedPaid)).toEqual(decisions(restrictedDemo));
    expect(decisions(restrictedPaid)).toMatchObject({ evaluation: 'unavailable',
      suppression: 'unavailable', scheduler: 'unavailable', recovery: 'unavailable', runnable: false });
    expect(runtime.allowedActions(changed, context())).not.toContain('provider_step');

    const paused = runtime.applyAction(state, context(), 'pause');
    const suppressed = runtime.applyAction(state, context(), 'suppress');
    const suppressedThenChanged = runtime.applyAction(suppressed, context(), 'source_change');
    const expiredSchedule = runtime.applyAction(runtime.applyAction(state, context(), 'advance_time'),
      context(), 'advance_time');
    const expiredClaim = runtime.applyAction(runtime.applyAction(state, context(), 'provider_step'),
      context(), 'advance_time');
    for (const [candidate, expected] of [
      [paused, { policy: 'paused', evaluation: 'ineligible', runnable: false }],
      [suppressed, { evaluation: 'suppressed', suppression: 'suppressed', runnable: false }],
      [suppressedThenChanged, { evaluation: 'unavailable', suppression: 'unavailable', runnable: false }],
      [expiredSchedule, { scheduler: 'expired', runnable: false }],
      [expiredClaim, { recovery: 'recovery_required', runnable: false }],
    ]) {
      const paidResult = businessEngine.evaluate(
        runtime.businessInputForState(candidate, context(), 'paid_no_effect_preview'));
      const demoResult = businessEngine.evaluate(
        runtime.businessInputForState(candidate, context(), 'isolated_demo'));
      expect(decisions(paidResult)).toEqual(decisions(demoResult));
      expect(decisions(paidResult)).toMatchObject(expected);
    }

    for (const [overrides, expected] of [
      [{ authorizationState: 'required' },
        { evaluation: 'approval_required', suppression: 'clear', runnable: false }],
      [{ permissionState: 'exact_current_blocked' },
        { evaluation: 'suppressed', suppression: 'suppressed', runnable: false }],
      [{ schedule: { quietWindows: [{ weekday: 1, startMinute: 0, endMinute: 1440 }] } },
        { scheduler: 'suppressed', runnable: false }],
      [{ sourceValue: 'not_current', controls: { recentManualActivity: 'matched' } },
        { evaluation: 'suppressed', suppression: 'suppressed', runnable: false }],
      [{ policyLifecycle: 'paused', controls: { globalPause: 'unavailable' } },
        { evaluation: 'unavailable', suppression: 'unavailable', runnable: false }],
      [{ policyExpiresAt: '2026-11-22T15:00:00.000Z', sourceState: 'unavailable', sourceValue: null },
        { policy: 'expired', evaluation: 'unavailable', runnable: false }],
    ]) {
      const paidResult = businessEngine.evaluate(rebuildBusinessInput(paidInput, 'paid_no_effect_preview', overrides));
      const demoResult = businessEngine.evaluate(rebuildBusinessInput(demoInput, 'isolated_demo', overrides));
      expect(decisions(paidResult)).toEqual(decisions(demoResult));
      expect(decisions(paidResult)).toMatchObject(expected);
    }
  });

  test('fails mandatory controls closed and preserves exact scope applicability', () => {
    const input = runtime.businessInputForState(runtime.initialState(context()), context());
    expect(input.controls.states).toEqual({
      globalPause: 'clear', tenantPause: 'clear', customerPause: 'not_applicable',
      documentPause: 'not_applicable', recipientOptOut: 'not_applicable',
      providerUncertainty: 'clear', sourceChange: 'clear', activeConversation: 'not_applicable',
      recentManualActivity: 'clear', duplicateContent: 'clear', higherPriorityAction: 'clear',
    });
    for (const kind of ['globalPause', 'tenantPause', 'providerUncertainty', 'sourceChange',
      'recentManualActivity', 'duplicateContent', 'higherPriorityAction']) {
      expect(() => rebuildBusinessInput(input, input.mode, { controls: { [kind]: 'not_applicable' } }))
        .toThrow(/mandatory control/i);
    }
    const options = businessOptions(input, input.mode);
    delete options.controls.globalPause;
    expect(() => businessEngine.controlledInput(options)).toThrow(/controls fields/i);
    expect(() => rebuildBusinessInput(input, input.mode, { controls: { recipientOptOut: 'clear' } }))
      .toThrow(/recipient control applicability/i);
    const external = runtime.unavailableBusinessInput('isolated_demo', {
      sourceClassId: 'mission27_financial_collection', actionFamily: 'collection_escalation',
      recipientClass: 'exact_customer_record', channelId: 'email',
    });
    expect(external.controls.states).toMatchObject({ customerPause: 'unavailable',
      documentPause: 'unavailable', recipientOptOut: 'unavailable', activeConversation: 'unavailable' });
    expect(businessEngine.evaluate(external)).toMatchObject({ evaluation: { state: 'unavailable' },
      suppression: { state: 'unavailable' }, runnable: false });
  });

  test('requires explicit source and execution authority instead of manufacturing positive defaults', () => {
    const input = runtime.businessInputForState(runtime.initialState(context()), context());
    expect(businessEngine.evaluate(input)).toMatchObject({ evaluation: { state: 'eligible' },
      recovery: { state: 'ready_no_effect' }, runnable: true });

    for (const missingSourceValue of [undefined, null]) {
      const options = businessOptions(input, input.mode);
      if (missingSourceValue === undefined) delete options.sourceValue;
      else options.sourceValue = missingSourceValue;
      expect(() => businessEngine.controlledInput(options)).toThrow(/known source value/i);
    }
    for (const missingExecution of [undefined, null]) {
      const options = businessOptions(input, input.mode);
      if (missingExecution === undefined) delete options.execution;
      else options.execution = missingExecution;
      expect(() => businessEngine.controlledInput(options)).toThrow(/execution is unavailable/i);
    }
  });

  test('binds explicit local date, time and daylight-saving fold choice to the exact UTC instant', () => {
    const foldContext = context({ anchorTime: '2026-11-01T04:30:00.000Z' });
    const input = runtime.businessInputForState(runtime.initialState(foldContext), foldContext);
    expect(input.schedule).toMatchObject({ timeZone: 'America/New_York',
      localDate: '2026-11-01', localTime: '01:30:00', foldResolution: 'earlier',
      utcInstant: '2026-11-01T05:30:00.000Z' });
    expect(businessEngine.evaluate(input)).toMatchObject({ scheduler: {
      state: 'scheduled_unpublished', localDate: '2026-11-01', localTime: '01:30:00',
      foldResolution: 'earlier' }, runnable: true });

    const later = rebuildBusinessInput(input, input.mode,
      { schedule: { utcInstant: '2026-11-01T06:30:00.000Z' } });
    expect(later.schedule).toMatchObject({ localDate: '2026-11-01', localTime: '01:30:00',
      foldResolution: 'later', utcInstant: '2026-11-01T06:30:00.000Z' });
    expect(businessEngine.evaluate(later)).toMatchObject({ scheduler: {
      state: 'scheduled_unpublished', foldResolution: 'later' }, runnable: true });

    const wrongFold = businessOptions(input, input.mode);
    Object.assign(wrongFold.schedule, { utcInstant: '2026-11-01T06:30:00.000Z',
      localDate: '2026-11-01', localTime: '01:30:00', foldResolution: 'earlier' });
    expect(() => businessEngine.controlledInput(wrongFold)).toThrow(/daylight-saving schedule resolution/i);

    for (const missing of ['localDate', 'localTime', 'foldResolution']) {
      const options = businessOptions(input, input.mode);
      delete options.schedule[missing];
      expect(() => businessEngine.controlledInput(options)).toThrow(/schedule fields/i);
    }

    const ordinary = runtime.businessInputForState(runtime.initialState(context()), context());
    expect(ordinary.schedule.foldResolution).toBe('not_ambiguous');
    const nonexistent = businessOptions(ordinary, ordinary.mode);
    Object.assign(nonexistent.schedule, { utcInstant: '2026-03-08T07:30:00.000Z',
      localDate: '2026-03-08', localTime: '02:30:00', foldResolution: 'not_ambiguous' });
    expect(() => businessEngine.controlledInput(nonexistent))
      .toThrow(/daylight-saving schedule resolution/i);
  });

  test('enforces coherent admission time and independent 366/367 day scheduler horizons', () => {
    const input = runtime.businessInputForState(runtime.initialState(context()), context());
    const accepted = Date.parse(input.schedule.acceptedAt);
    const iso = milliseconds => new Date(milliseconds).toISOString();
    const policyExpiresAt = iso(accepted + 370 * 24 * 60 * 60 * 1000);
    const atBoundary = businessEngine.evaluate(rebuildBusinessInput(input, input.mode, {
      policyExpiresAt,
      schedule: { utcInstant: iso(accepted + 366 * 24 * 60 * 60 * 1000),
        expiresAt: iso(accepted + 367 * 24 * 60 * 60 * 1000) },
    }));
    expect(atBoundary).toMatchObject({ scheduler: { state: 'scheduled_unpublished' }, runnable: true });
    const afterScheduleHorizon = businessEngine.evaluate(rebuildBusinessInput(input, input.mode, {
      policyExpiresAt,
      schedule: { utcInstant: iso(accepted + 366 * 24 * 60 * 60 * 1000 + 1),
        expiresAt: iso(accepted + 367 * 24 * 60 * 60 * 1000) },
    }));
    expect(afterScheduleHorizon).toMatchObject({ scheduler: { state: 'unavailable',
      reason: 'schedule_time_bounds_invalid' }, runnable: false });
    const afterExpirationHorizon = businessEngine.evaluate(rebuildBusinessInput(input, input.mode, {
      policyExpiresAt,
      schedule: { utcInstant: iso(accepted + 365 * 24 * 60 * 60 * 1000),
        expiresAt: iso(accepted + 367 * 24 * 60 * 60 * 1000 + 1) },
    }));
    expect(afterExpirationHorizon).toMatchObject({ scheduler: { state: 'unavailable',
      reason: 'schedule_time_bounds_invalid' }, runnable: false });
    const sourceAfterAdmission = businessEngine.evaluate(rebuildBusinessInput(input, input.mode, {
      sourceObservedAt: iso(accepted + 1),
    }));
    expect(sourceAfterAdmission).toMatchObject({ scheduler: { state: 'unavailable',
      reason: 'schedule_time_bounds_invalid' }, runnable: false });
    const fractionalInstant = businessEngine.evaluate(rebuildBusinessInput(input, input.mode, {
      schedule: { utcInstant: '2026-11-23T16:00:00.123Z' },
    }));
    expect(fractionalInstant).toMatchObject({ scheduler: { state: 'unavailable',
      reason: 'schedule_time_bounds_invalid', localDate: null, localMinute: null }, runnable: false });
  });

  test('preserves fractional source and admission provenance while selecting a representable due instant', () => {
    const fractional = context({ anchorTime: '2026-11-23T15:00:00.123Z' });
    const state = runtime.initialState(fractional);
    expect(state.source.observedAt).toBe('2026-11-23T15:00:00.123Z');
    expect(state.run.scheduleAcceptedAt).toBe('2026-11-23T15:00:00.123Z');
    expect(state.run.scheduledAt).toBe('2026-11-23T16:00:01.000Z');
    expect(state.virtualNow).toBe(state.run.scheduledAt);
    expect(new Date(state.run.scheduledAt).getUTCMilliseconds()).toBe(0);
    expect(runtime.businessDecision(state, fractional)).toMatchObject({
      scheduler: { state: 'scheduled_unpublished' }, runnable: true,
    });
  });

  test('keeps unavailable source lineage unavailable and reserves ineligibility for exact terminal lineage', () => {
    const input = runtime.businessInputForState(runtime.initialState(context()), context());
    const unavailable = businessEngine.evaluate(rebuildBusinessInput(input, input.mode,
      { sourceLineage: 'unavailable' }));
    expect(unavailable).toMatchObject({ evaluation: { state: 'unavailable',
      reason: 'source_lineage_unavailable', evidenceQuality: 'unavailable' }, runnable: false });
    const unavailableBeatsRestrictivePolicy = businessEngine.evaluate(rebuildBusinessInput(input, input.mode,
      { sourceLineage: 'unavailable', policyLifecycle: 'paused' }));
    expect(unavailableBeatsRestrictivePolicy).toMatchObject({ evaluation: { state: 'unavailable',
      reason: 'source_lineage_unavailable', evidenceQuality: 'unavailable' }, runnable: false });
    const unavailableBeatsUnknown = businessEngine.evaluate(rebuildBusinessInput(input, input.mode,
      { sourceState: 'unknown', sourceValue: null, sourceLineage: 'unavailable' }));
    expect(unavailableBeatsUnknown).toMatchObject({ evaluation: { state: 'unavailable',
      reason: 'source_lineage_unavailable', evidenceQuality: 'unavailable' }, runnable: false });
    for (const sourceLineage of ['tombstoned', 'reversed']) {
      expect(businessEngine.evaluate(rebuildBusinessInput(input, input.mode, { sourceLineage })))
        .toMatchObject({ evaluation: { state: 'ineligible', reason: 'source_lineage_not_active',
          evidenceQuality: 'complete_exact' }, runnable: false });
    }
  });

  test('rejects incoherent transition shortcuts instead of changing labels without authority', () => {
    const initial = runtime.initialState(context());
    const expectUnavailable = (state, action) => {
      try { runtime.applyAction(state, context(), action); throw new Error('Expected the action to fail.'); }
      catch (error) { expect(error).toMatchObject({ code: 'AUTOMATION_DEMO_ACTION_UNAVAILABLE', status: 409 }); }
    };
    expectUnavailable(initial, 'source_correct');
    expectUnavailable(initial, 'resume');
    expectUnavailable(initial, 'recover');
    const paused = runtime.applyAction(initial, context(), 'pause');
    expectUnavailable(paused, 'pause');
    const stale = runtime.applyAction(initial, context(), 'source_change');
    expectUnavailable(stale, 'provider_step');
    expectUnavailable(stale, 'suppress');
    const completed = runtime.applyAction(runtime.applyAction(initial, context(), 'provider_step'), context(), 'provider_step');
    expectUnavailable(completed, 'suppress');
    let bounded = initial;
    for (let index = 0; index < 37; index += 1) bounded = runtime.applyAction(bounded, context(), 'advance_time');
    expect(runtime.allowedActions(bounded, context())).toEqual(['reset_automation']);
    expect(() => runtime.applyAction(bounded, context(), 'advance_time')).toThrow(/history is full/i);
  });

  test('reset invalidates older preview and action successes without exposing obsolete fictional state', async () => {
    const initial = runtime.initialState(context());
    const initialEnvelope = envelope(initial, 1);
    const olderAction = deferred(); const resetAction = deferred(); const preview = deferred();
    const json = jest.fn()
      .mockResolvedValueOnce({ success: true, data: initialEnvelope.snapshot, demo: initialEnvelope.demo })
      .mockImplementationOnce(() => preview.promise)
      .mockImplementationOnce(() => olderAction.promise)
      .mockImplementationOnce(() => resetAction.promise);
    const { buttons, elements, listeners } = demoPageHarness(json);
    listeners.DOMContentLoaded(); await flush();
    const template = elements.automationTemplates.childNodes[0].childNodes.find(node => node.tagName === 'BUTTON');
    template.emit('click');
    buttons.find(button => button.getAttribute('data-automation-demo-action') === 'provider_step').emit('click');
    buttons.find(button => button.getAttribute('data-automation-demo-action') === 'reset_automation').emit('click');
    const reset = runtime.applyAction(initial, context(), 'reset_automation');
    const resetEnvelope = envelope(reset, 2);
    resetAction.resolve({ success: true, data: resetEnvelope.snapshot, demo: resetEnvelope.demo }); await flush();
    expect(elements.automationDemoGeneration.textContent).toContain('Demo 2 · saved version 2');
    expect(elements.automationDemoStatus.textContent).toMatch(/reset.*older pending/i);
    const older = runtime.applyAction(initial, context(), 'provider_step');
    const olderEnvelope = envelope(older, 2);
    olderAction.resolve({ success: true, data: olderEnvelope.snapshot, demo: olderEnvelope.demo });
    preview.resolve({ success: true, data: runtime.buildNoEffectPreview({
      templateId: 'owner-work-review', name: 'Old preview', sourceClassId: 'mission23_work_execution',
      actionFamily: 'internal_read_digest_task', recipientClass: 'tenant_owner', channelId: 'in_app_passive',
      timing: 'review_now', dailyLimit: 1,
    }) });
    await flush();
    expect(elements.automationDemoGeneration.textContent).toContain('Demo 2 · saved version 2');
    expect(elements.automationDemoStatus.textContent).toMatch(/reset.*older pending/i);
    expect(elements.automationPreview.hidden).toBe(true);
    expect(elements.previewSummary.textContent).toBe('');
  });

  test('an unbound preview conflict clears a later mounted reset because server ordering is unavailable', async () => {
    const initial = runtime.initialState(context());
    const initialEnvelope = envelope(initial, 1);
    const preview = deferred(); const resetAction = deferred();
    const json = jest.fn()
      .mockResolvedValueOnce({ success: true, data: initialEnvelope.snapshot, demo: initialEnvelope.demo })
      .mockImplementationOnce(() => preview.promise)
      .mockImplementationOnce(() => resetAction.promise);
    const { buttons, elements, listeners } = demoPageHarness(json);
    listeners.DOMContentLoaded(); await flush();
    const template = elements.automationTemplates.childNodes[0].childNodes.find(node => node.tagName === 'BUTTON');
    template.emit('click');
    buttons.find(button => button.getAttribute('data-automation-demo-action') === 'reset_automation').emit('click');
    const reset = runtime.applyAction(initial, context(), 'reset_automation');
    const resetEnvelope = envelope(reset, 2);
    resetAction.resolve({ success: true, data: resetEnvelope.snapshot, demo: resetEnvelope.demo }); await flush();
    preview.reject(Object.assign(new Error('CONFLICT'), { status: 409 })); await flush();
    expect(elements.automationDemoGeneration.textContent).toBe('Not loaded');
    expect(elements.automationDemoControls.hidden).toBe(true);
    expect(elements.automationStatus.dataset.state).toBe('conflict');
    expect(elements.automationSummary.hidden).toBe(true);
  });

  test('a superseded action conflict clears a later reset when a newer server revision may exist', async () => {
    const initial = runtime.initialState(context());
    const initialEnvelope = envelope(initial, 1);
    const olderAction = deferred(); const resetAction = deferred();
    const json = jest.fn()
      .mockResolvedValueOnce({ success: true, data: initialEnvelope.snapshot, demo: initialEnvelope.demo })
      .mockImplementationOnce(() => olderAction.promise)
      .mockImplementationOnce(() => resetAction.promise);
    const { buttons, elements, listeners } = demoPageHarness(json);
    listeners.DOMContentLoaded(); await flush();
    buttons.find(button => button.getAttribute('data-automation-demo-action') === 'provider_step').emit('click');
    buttons.find(button => button.getAttribute('data-automation-demo-action') === 'reset_automation').emit('click');
    const reset = runtime.applyAction(initial, context(), 'reset_automation');
    const resetEnvelope = envelope(reset, 2);
    resetAction.resolve({ success: true, data: resetEnvelope.snapshot, demo: resetEnvelope.demo }); await flush();
    expect(elements.automationDemoGeneration.textContent).toContain('Demo 2 · saved version 2');
    olderAction.reject(Object.assign(new Error('CONFLICT'), { status: 409 })); await flush();
    expect(elements.automationDemoGeneration.textContent).toBe('Not loaded');
    expect(elements.automationDemoControls.hidden).toBe(true);
    expect(elements.automationStatus.dataset.state).toBe('conflict');
    expect(elements.automationSummary.hidden).toBe(true);
  });

  test('an older demo preview conflict clears state while a newer preview remains unresolved', async () => {
    const initialEnvelope = envelope(runtime.initialState(context()), 1);
    const olderPreview = deferred(); const newerPreview = deferred();
    const json = jest.fn()
      .mockResolvedValueOnce({ success: true, data: initialEnvelope.snapshot, demo: initialEnvelope.demo })
      .mockImplementationOnce(() => olderPreview.promise)
      .mockImplementationOnce(() => newerPreview.promise);
    const { elements, listeners } = demoPageHarness(json);
    listeners.DOMContentLoaded(); await flush();
    const template = elements.automationTemplates.childNodes[0].childNodes.find(node => node.tagName === 'BUTTON');
    template.emit('click'); template.emit('click'); await flush();
    expect(elements.automationDemoControls.hidden).toBe(false);
    olderPreview.reject(Object.assign(new Error('CONFLICT'), { status: 409 })); await flush();
    expect(elements.automationStatus.dataset.state).toBe('conflict');
    expect(elements.automationDemoControls.hidden).toBe(true);
    expect(elements.automationDemoGeneration.textContent).toBe('Not loaded');
    newerPreview.resolve({ success: true, data: runtime.buildNoEffectPreview({
      templateId: 'owner-work-review', name: 'Obsolete preview', sourceClassId: 'mission23_work_execution',
      actionFamily: 'internal_read_digest_task', recipientClass: 'tenant_owner', channelId: 'in_app_passive',
      timing: 'review_now', dailyLimit: 1,
    }) });
    await flush();
    expect(elements.automationDemoControls.hidden).toBe(true);
    expect(elements.automationPreview.hidden).toBe(true);
    expect(elements.previewSummary.textContent).toBe('');
  });

  test('a pending action blocks an ambiguous refresh and invalidates a preview started before commit', async () => {
    const initial = runtime.initialState(context());
    const initialEnvelope = envelope(initial, 1);
    const action = deferred(); const preview = deferred();
    const json = jest.fn()
      .mockResolvedValueOnce({ success: true, data: initialEnvelope.snapshot, demo: initialEnvelope.demo })
      .mockImplementationOnce(() => action.promise)
      .mockImplementationOnce(() => preview.promise);
    const { buttons, elements, listeners } = demoPageHarness(json);
    listeners.DOMContentLoaded(); await flush();
    buttons.find(button => button.getAttribute('data-automation-demo-action') === 'provider_step').emit('click');
    elements.automationRefresh.emit('click');
    expect(json).toHaveBeenCalledTimes(2);
    const template = elements.automationTemplates.childNodes[0].childNodes.find(node => node.tagName === 'BUTTON');
    template.emit('click');
    expect(json).toHaveBeenCalledTimes(3);
    const updated = runtime.applyAction(initial, context(), 'provider_step');
    const updatedEnvelope = envelope(updated, 2);
    action.resolve({ success: true, data: updatedEnvelope.snapshot, demo: updatedEnvelope.demo });
    await flush();
    preview.resolve({ success: true, data: runtime.buildNoEffectPreview({
      templateId: 'owner-work-review', name: 'Obsolete preview', sourceClassId: 'mission23_work_execution',
      actionFamily: 'internal_read_digest_task', recipientClass: 'tenant_owner', channelId: 'in_app_passive',
      timing: 'review_now', dailyLimit: 1,
    }) });
    await flush();
    expect(elements.automationDemoGeneration.textContent).toContain('saved version 2');
    expect(elements.automationPreview.hidden).toBe(true);
    expect(elements.previewSummary.textContent).toBe('');
  });

  test('a current action failure invalidates a preview that began while the mutation was pending', async () => {
    const initialEnvelope = envelope(runtime.initialState(context()), 1);
    const action = deferred(); const preview = deferred();
    const json = jest.fn()
      .mockResolvedValueOnce({ success: true, data: initialEnvelope.snapshot, demo: initialEnvelope.demo })
      .mockImplementationOnce(() => action.promise)
      .mockImplementationOnce(() => preview.promise);
    const { buttons, elements, listeners } = demoPageHarness(json);
    listeners.DOMContentLoaded(); await flush();
    const template = elements.automationTemplates.childNodes[0].childNodes.find(node => node.tagName === 'BUTTON');
    buttons.find(button => button.getAttribute('data-automation-demo-action') === 'provider_step').emit('click');
    template.emit('click');
    action.reject(Object.assign(new Error('UNAVAILABLE'), { status: 503 })); await flush();
    expect(elements.automationSummary.hidden).toBe(true);
    expect(elements.automationPreview.hidden).toBe(true);
    expect(elements.automationStatus.dataset.state).toBe('unavailable');
    preview.resolve({ success: true, data: runtime.buildNoEffectPreview({
      templateId: 'owner-work-review', name: 'Obsolete preview', sourceClassId: 'mission23_work_execution',
      actionFamily: 'internal_read_digest_task', recipientClass: 'tenant_owner', channelId: 'in_app_passive',
      timing: 'review_now', dailyLimit: 1,
    }) });
    await flush();
    expect(elements.automationSummary.hidden).toBe(true);
    expect(elements.automationPreview.hidden).toBe(true);
    expect(elements.previewSummary.textContent).toBe('');
    expect(elements.automationStatus.dataset.state).toBe('unavailable');
  });

  test('a current read failure invalidates a preview that began while the read was pending', async () => {
    const initialEnvelope = envelope(runtime.initialState(context()), 1);
    const load = deferred(); const preview = deferred();
    const json = jest.fn()
      .mockResolvedValueOnce({ success: true, data: initialEnvelope.snapshot, demo: initialEnvelope.demo })
      .mockImplementationOnce(() => load.promise)
      .mockImplementationOnce(() => preview.promise);
    const { elements, listeners } = demoPageHarness(json);
    listeners.DOMContentLoaded(); await flush();
    const template = elements.automationTemplates.childNodes[0].childNodes.find(node => node.tagName === 'BUTTON');
    elements.automationRefresh.emit('click');
    template.emit('click');
    load.reject(Object.assign(new Error('UNAVAILABLE'), { status: 503 })); await flush();
    expect(elements.automationSummary.hidden).toBe(true);
    expect(elements.automationPreview.hidden).toBe(true);
    expect(elements.automationStatus.dataset.state).toBe('unavailable');
    preview.resolve({ success: true, data: runtime.buildNoEffectPreview({
      templateId: 'owner-work-review', name: 'Obsolete preview', sourceClassId: 'mission23_work_execution',
      actionFamily: 'internal_read_digest_task', recipientClass: 'tenant_owner', channelId: 'in_app_passive',
      timing: 'review_now', dailyLimit: 1,
    }) });
    await flush();
    expect(elements.automationPreview.hidden).toBe(true);
    expect(elements.previewSummary.textContent).toBe('');
    expect(elements.automationStatus.dataset.state).toBe('unavailable');
  });

  test('an older authorization failure clears a newer pending isolated action and every rendered fictional value', async () => {
    const initialEnvelope = envelope(runtime.initialState(context()), 7);
    const oldAction = deferred(); const newerAction = deferred();
    const json = jest.fn()
      .mockResolvedValueOnce({ success: true, data: initialEnvelope.snapshot,
        demo: { ...initialEnvelope.demo, workspaceRevision: 7 } })
      .mockImplementationOnce(() => oldAction.promise)
      .mockImplementationOnce(() => newerAction.promise);
    const { buttons, elements, listeners } = demoPageHarness(json);
    listeners.DOMContentLoaded(); await flush();
    const provider = buttons.find(button => button.getAttribute('data-automation-demo-action') === 'provider_step');
    const reset = buttons.find(button => button.getAttribute('data-automation-demo-action') === 'reset_automation');
    provider.emit('click'); reset.emit('click'); await flush();
    elements.automationDemoBoundary.textContent = 'DISTINCTIVE PRIOR FICTIONAL VALUE';
    oldAction.reject(Object.assign(new Error('FORBIDDEN'), { status: 403 })); await flush();
    expect(elements.automationStatus.dataset.state).toBe('error');
    expect(elements.automationDemoControls.hidden).toBe(true);
    expect(elements.automationDemoGeneration.textContent).toBe('Not loaded');
    expect(elements.automationDemoSource.textContent).toBe('Unavailable');
    expect(elements.automationDemoPolicy.textContent).toBe('Unavailable');
    expect(elements.automationDemoTime.textContent).toBe('Unavailable');
    expect(elements.automationDemoBoundary.textContent).toBe('No fictional automation state is loaded.');
    expect(elements.automationDemoBoundary.textContent).not.toContain('DISTINCTIVE');
    newerAction.resolve({ success: true, data: initialEnvelope.snapshot, demo: initialEnvelope.demo }); await flush();
    expect(elements.automationDemoControls.hidden).toBe(true);
    expect(elements.automationDemoGeneration.textContent).toBe('Not loaded');
  });

  test('rejects an untrusted demo envelope and clears the partially rendered snapshot', async () => {
    const initialEnvelope = envelope(runtime.initialState(context()), 1);
    const json = jest.fn().mockResolvedValueOnce({
      success: true,
      data: initialEnvelope.snapshot,
      demo: { ...initialEnvelope.demo, disclaimer: 'untrusted response copy' },
    });
    const { elements, listeners } = demoPageHarness(json);
    listeners.DOMContentLoaded(); await flush();
    expect(elements.automationStatus.dataset.state).toBe('unavailable');
    expect(elements.automationSummary.hidden).toBe(true);
    expect(elements.automationDemoControls.hidden).toBe(true);
    expect(elements.automationDemoGeneration.textContent).toBe('Not loaded');
    expect(elements.automationDemoBoundary.textContent).toBe('No fictional automation state is loaded.');
    expect(elements.automationDemoBoundary.textContent).not.toContain('untrusted');
  });

  test('mounts one isolated route and transport instead of a static response or paid authority shortcut', () => {
    const demoRoute = read('src/routes/demo.js');
    const demoRuntime = read('public/js/demo-runtime.js');
    const server = read('src/server.js');
    const projection = read('src/automation/demoProjection.js');
    const paidRoute = read('src/routes/automationCenter.js');
    expect(commandCenterContract.AUTOMATION_ROUTE).toMatchObject({
      paidPath: '/dashboard/automation', demoPath: '/demo/automation', resource: 'automation',
    });
    expect(commandCenterContract.routesForMode('demo').map(route => route.id)).toContain('automation-center');
    expect(server).toContain("'automation-center': 'public/dashboard/automation.html'");
    expect(demoRuntime).toContain("url.pathname === '/api/v1/automation-center'");
    expect(demoRuntime).toMatch(/url\.pathname === '\/api\/v1\/automation-center'[\s\S]*loadWorkspace\(true\)[\s\S]*nativeFetch\('\/api\/demo\/automation-center'/);
    expect(demoRoute).toContain("router.get('/automation-center'");
    expect(demoRoute).toContain("router.post('/automation-center/actions'");
    expect(demoRoute).toContain("mutationBoundary(req, res, 'automation-center-action')");
    expect(demoRoute).toContain("operation: 'automation_action'");
    expect(projection).toContain("require('../automationCenter/repository')");
    expect(paidRoute).toContain('automationRuntime.buildNoEffectPreview');
    expect(read('src/automation/runtimeEngine.js')).toContain('stateEngine.evaluateEvidence');
    expect(read('src/automationCenter/repository.js')).toContain('const state = resolvePolicy(row, evaluatedAt)');
    expect(read('src/automationCenter/repository.js')).toContain('const scheduler = resolveScheduler(row, evaluatedAt)');
    expect(read('src/automationCenter/repository.js')).toContain('const recovery = resolveRecovery(row, scheduler)');
    expect(read('src/automation/runtimeEngine.js')).not.toMatch(/require\(['"](?:https?|axios|node-fetch|stripe|twilio|resend)/);
    expect(read('src/automation/demoProjection.js')).not.toMatch(/tests[\\/]|\.\.\/\.\.\/tests/);
    const migration = read('migrations/288_demo_automation_center_action_v1.sql');
    const acceptedOperations = [
      'customer_estimate_issue', 'proposal_adopt', 'simulate_lead', 'reset', 'learning_step',
      'forecast_journey', 'billing_identity', 'automation_action', 'estimate_review', 'material_plan',
      'estimate_adopt', 'schedule_preview', 'schedule_approve', 'work_action', 'labor_plan',
      'equipment_plan', 'equipment_cost', 'equipment_ready', 'travel_plan', 'pricing_plan',
      'pricing_policy', 'commercial_terms', 'commercial_ok', 'tax_profile',
    ];
    for (const operation of acceptedOperations) expect(migration).toContain(`'${operation}'`);
    expect(migration).toContain('DROP CONSTRAINT demo_command_center_mutations_operation_check');
    expect(migration).toContain('ADD CONSTRAINT demo_command_center_mutations_operation_check');
    expect(migration).not.toMatch(/\b(?:UPDATE|DELETE|TRUNCATE)\b/);
    expect(new Set(acceptedOperations).size).toBe(24);
    expect(fs.readdirSync(path.join(ROOT, 'migrations')).some(name => /^289_/.test(name))).toBe(false);
    expect(read('tests/integration/m28-part14c-isolated-demo-parity-postgres.test.js'))
      .toContain("operation='automation_action'");
  });

  test('serves mounted fictional read, preview and CAS action routes behind explicit same-origin intent', async () => {
    const token = issueToken(new Date('2026-11-23T15:00:00.000Z'));
    const routeContext = context({ tenantId: token.tenantId, sessionId: token.sessionId });
    const initial = runtime.initialState(routeContext);
    const initialRecord = record(initial, { tenantId: token.tenantId, sessionId: token.sessionId });
    const updatedState = runtime.applyAction(initial, routeContext, 'provider_step');
    const updatedRecord = record(updatedState, {
      revision: 2, tenantId: token.tenantId, sessionId: token.sessionId,
    });
    const previousSecret = config.auth.accessSecret;
    config.auth.accessSecret = 'part14c-isolated-route-test-secret-0001';
    const tokenSpy = jest.spyOn(DemoCommandCenterRepository.prototype, 'token').mockReturnValue(token);
    const readSpy = jest.spyOn(DemoCommandCenterRepository.prototype, 'read').mockResolvedValue(initialRecord);
    const mutateSpy = jest.spyOn(DemoCommandCenterRepository.prototype, 'mutate')
      .mockImplementation(async (_token, input, options) => {
        expect(input).toMatchObject({ operation: 'automation_action', expectedRevision: 1,
          automationAction: 'provider_step' });
        expect(options.sourceHash).toMatch(/^[0-9a-f]{64}$/);
        return { record: updatedRecord, replayed: false };
      });
    try {
      const app = express();
      app.set('trust proxy', false);
      app.use('/api/demo', require('../../src/routes/demo'));
      const readResponse = await request(app).get('/api/demo/automation-center')
        .set('Host', 'northstar.test').expect(200);
      expect(readResponse.body).toMatchObject({ success: true,
        data: { runs: [{ state: 'queued' }] },
        demo: { contract: runtime.CONTRACT, workspaceRevision: 1 } });

      const previewInput = { templateId: 'custom', name: 'Private owner review',
        sourceClassId: 'mission23_work_execution', actionFamily: 'internal_read_digest_task',
        recipientClass: 'tenant_owner', channelId: 'in_app_passive', timing: 'review_now', dailyLimit: 2 };
      const previewResponse = await request(app).post('/api/demo/automation-center/preview')
        .set('Host', 'northstar.test').set('Origin', 'http://northstar.test')
        .set('X-NorthStar-Demo-Intent', 'automation-center-preview')
        .set('X-NorthStar-Demo-Revision', '1').send(previewInput).expect(200);
      expect(previewResponse.body.data).toMatchObject({ previewOnly: true,
        engineAssessment: { policy: 'active_exact_current', evaluation: 'eligible',
          scheduler: 'scheduled_unpublished', suppression: 'clear', recovery: 'ready_no_effect',
          run: 'ready_no_effect', providerCalls: 0 } });
      const unmatchedPreview = await request(app).post('/api/demo/automation-center/preview')
        .set('Host', 'northstar.test').set('Origin', 'http://northstar.test')
        .set('X-NorthStar-Demo-Intent', 'automation-center-preview')
        .set('X-NorthStar-Demo-Revision', '1').send({ templateId: 'custom',
          name: 'Collection review only', sourceClassId: 'mission27_financial_collection',
          actionFamily: 'collection_escalation', recipientClass: 'exact_customer_record',
          channelId: 'email', timing: 'review_now', dailyLimit: 1 }).expect(200);
      expect(unmatchedPreview.body.data).toMatchObject({ action: 'Prepare collection review',
        channel: 'Email', engineAssessment: { policy: 'unavailable', evaluation: 'unavailable',
          scheduler: 'preview_only_no_schedule_created', run: 'unavailable',
          providerMode: 'provider_unavailable_preview_no_effect', providerCalls: 0 } });
      await request(app).post('/api/demo/automation-center/preview')
        .set('Host', 'northstar.test').set('Origin', 'http://northstar.test')
        .set('X-NorthStar-Demo-Intent', 'automation-center-preview')
        .set('X-NorthStar-Demo-Revision', '1')
        .send({ ...previewInput, evaluatedAt: '2099-01-01T00:00:00.000Z', providerResult: 'success' })
        .expect(400);

      const actionResponse = await request(app).post('/api/demo/automation-center/actions')
        .set('Host', 'northstar.test').set('Origin', 'http://northstar.test')
        .set('X-NorthStar-Demo-Intent', 'automation-center-action')
        .set('Idempotency-Key', '00000000-0000-4000-8000-000000000099')
        .send({ action: 'provider_step', expectedRevision: 1 }).expect(201);
      expect(actionResponse.body).toMatchObject({ success: true, replayed: false,
        data: { runs: [{ state: 'in_flight' }] }, demo: { workspaceRevision: 2 } });

      await request(app).post('/api/demo/automation-center/actions')
        .set('Host', 'northstar.test').set('Origin', 'https://attacker.invalid')
        .set('X-NorthStar-Demo-Intent', 'automation-center-action')
        .set('Idempotency-Key', '00000000-0000-4000-8000-000000000100')
        .send({ action: 'provider_step', expectedRevision: 1 }).expect(403);
      expect(readSpy).toHaveBeenCalledTimes(3);
      expect(mutateSpy).toHaveBeenCalledTimes(1);
    } finally {
      config.auth.accessSecret = previousSecret;
      tokenSpy.mockRestore(); readSpy.mockRestore(); mutateSpy.mockRestore();
    }
  });
});
