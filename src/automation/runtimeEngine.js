'use strict';

const crypto = require('crypto');
const centerContract = require('../../public/js/automation-center-contract');
const stateEngine = require('../automationCenter/repository');
const businessEngine = require('./businessDecisionEngine');

const CONTRACT = 'mission28.part14c.isolated-automation-demo.v1';
const ACTIONS = Object.freeze([
  'advance_time', 'source_change', 'source_correct', 'pause', 'resume',
  'suppress', 'recover', 'provider_step', 'stop', 'reset_automation',
]);
const PROVIDER_MODE = 'deterministic_local_simulation_no_provider';
const SOURCE_CLASS = 'mission23_work_execution';
const ACTION_FAMILY = 'internal_read_digest_task';
const RECIPIENT_CLASS = 'tenant_owner';
const CHANNEL_ID = 'in_app_passive';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_RESULTS = Object.freeze(new Set([
  'eligibility_evaluation:eligible',
  'proposed_action:prepared_no_effect',
  'scheduled_run:scheduled_unpublished',
  'provider_attempt:deterministic_simulation_started_no_provider',
  'terminal_outcome:completed_internal_simulation_only',
  'suppression:blocks_effect_demo_only',
  'cancellation:accepted_demo_stop_no_effect',
  'cancellation:paused_no_effect',
  'reconciliation:source_correction_bound_no_effect',
  'reconciliation:source_changed_requires_review',
  'reconciliation:bounded_recovery_no_effect',
  'reconciliation:resumed_no_effect',
  'reconciliation:virtual_clock_advanced_no_effect',
]));

function fail(message, code = 'AUTOMATION_DEMO_STATE_INVALID') {
  const error = new Error(message);
  error.code = code;
  error.status = code === 'AUTOMATION_DEMO_ACTION_UNAVAILABLE' ? 409 :
    code === 'AUTOMATION_DEMO_ACTION_INVALID' ? 400 : 503;
  throw error;
}
function exactObject(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const actual = Object.keys(value).sort();
  const expected = keys.slice().sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function asIso(value, label) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) fail(`${label} is unavailable.`);
  return parsed.toISOString();
}
function addMilliseconds(value, milliseconds) {
  return new Date(new Date(value).getTime() + milliseconds).toISOString();
}
function addMillisecondsAtWholeSecond(value, milliseconds) {
  const target = new Date(value).getTime() + milliseconds;
  return new Date(Math.ceil(target / 1000) * 1000).toISOString();
}
function deterministicUuid(namespace, material) {
  const bytes = Buffer.from(crypto.createHash('sha256').update(`${namespace}\0${material}`, 'utf8').digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function digest(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')}`;
}
function sourceDigest(context, generation, version, observedAt) {
  return digest({ tenantId: context.tenantId, sessionId: context.sessionId,
    workspaceGeneration: context.workspaceGeneration,
    automationGeneration: generation, version, observedAt, fictional: true });
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function contextValue(context) {
  if (!context || !UUID.test(String(context.tenantId || '')) || !UUID.test(String(context.sessionId || '')) ||
      !Number.isSafeInteger(context.workspaceGeneration) || context.workspaceGeneration < 1 ||
      !Number.isSafeInteger(context.workspaceRevision) || context.workspaceRevision < 1) {
    fail('The isolated automation context is unavailable.');
  }
  return {
    tenantId: context.tenantId, sessionId: context.sessionId,
    workspaceGeneration: context.workspaceGeneration, workspaceRevision: context.workspaceRevision,
    anchorTime: asIso(context.anchorTime, 'The fictional source time'),
  };
}
function eventId(context, generation, sequence) {
  return deterministicUuid('mission28-part14c-event',
    `${context.tenantId}:${context.sessionId}:${context.workspaceGeneration}:${generation}:${sequence}`);
}
function runId(context, generation, sequence) {
  return deterministicUuid('mission28-part14c-run',
    `${context.tenantId}:${context.sessionId}:${context.workspaceGeneration}:${generation}:${sequence}`);
}
function initialState(context, generation = 1) {
  const bounded = contextValue(context);
  const anchor = bounded.anchorTime;
  const authorityKey = `${bounded.tenantId}:${bounded.sessionId}:${bounded.workspaceGeneration}:${generation}`;
  const policyId = deterministicUuid('mission28-part14c-policy', authorityKey);
  const firstRunId = runId(bounded, generation, 1);
  const scheduledAt = addMillisecondsAtWholeSecond(anchor, 60 * 60 * 1000);
  const value = {
    contract: CONTRACT, generation, virtualNow: scheduledAt,
    source: { id: deterministicUuid('mission28-part14c-source', authorityKey),
      version: 1, observedAt: anchor, digest: sourceDigest(bounded, generation, 1, anchor) },
    policy: { id: policyId, version: 1, lifecycle: 'active', control: 'active_resumed',
      expiresAt: addMilliseconds(anchor, 30 * 24 * 60 * 60 * 1000) },
    run: { id: firstRunId, sequence: 1, capturedSourceVersion: 1,
      scheduleAcceptedAt: anchor, scheduledAt,
      scheduleExpiresAt: addMilliseconds(anchor, 2 * 24 * 60 * 60 * 1000), phase: 'queued',
      phaseRecordedAt: anchor, providerStep: 0, suppression: false, recovery: null },
    tenantControl: 'active_resumed',
    events: [
      { id: eventId(bounded, generation, 1), sequence: 1, runId: firstRunId,
        type: 'eligibility_evaluation', at: anchor, outcome: 'eligible' },
      { id: eventId(bounded, generation, 2), sequence: 2, runId: firstRunId,
        type: 'proposed_action', at: anchor, outcome: 'prepared_no_effect' },
      { id: eventId(bounded, generation, 3), sequence: 3, runId: firstRunId,
        type: 'scheduled_run', at: anchor, outcome: 'scheduled_unpublished' },
    ],
  };
  requireRunnableBusinessPrelude(value, bounded);
  validateState(value, bounded);
  return value;
}

function validateEvent(event, context, state, priorSequence, priorAt, allowedRunIds) {
  if (!exactObject(event, ['id', 'sequence', 'runId', 'type', 'at', 'outcome']) || !UUID.test(event.id) ||
      !UUID.test(event.runId) || !Number.isSafeInteger(event.sequence) || event.sequence !== priorSequence + 1 ||
      typeof event.type !== 'string' || !/^[a-z_]{3,40}$/.test(event.type) ||
      typeof event.outcome !== 'string' || !/^[a-z_]{3,64}$/.test(event.outcome) ||
      !EVENT_RESULTS.has(`${event.type}:${event.outcome}`) || !allowedRunIds.has(event.runId) ||
      asIso(event.at, 'The fictional evidence time') !== event.at ||
      (priorAt && new Date(event.at).getTime() < new Date(priorAt).getTime()) ||
      new Date(event.at).getTime() > new Date(state.virtualNow).getTime() ||
      event.id !== eventId(context, state.generation, event.sequence)) {
    fail('The isolated automation history is unavailable.');
  }
}

function validateHistoryCoherence(value, context) {
  const expected = {
    virtualNow: addMillisecondsAtWholeSecond(context.anchorTime, 60 * 60 * 1000),
    sourceVersion: 1,
    sourceObservedAt: context.anchorTime,
    runSequence: 1,
    capturedSourceVersion: 1,
    lifecycle: 'active',
    control: 'active_resumed',
    tenantControl: 'active_resumed',
    phase: 'queued',
    providerStep: 0,
    suppression: false,
    recovery: null,
    scheduleAcceptedAt: context.anchorTime,
    scheduledAt: addMillisecondsAtWholeSecond(context.anchorTime, 60 * 60 * 1000),
    scheduleExpiresAt: addMilliseconds(context.anchorTime, 48 * 60 * 60 * 1000),
    phaseRecordedAt: context.anchorTime,
    scheduleExpected: false,
    stopped: false,
  };
  for (const event of value.events.slice(3)) {
    if (expected.stopped) fail('The isolated automation history continues after its terminal stop.');
    const exact = `${event.type}:${event.outcome}`;
    if (exact === 'reconciliation:virtual_clock_advanced_no_effect') {
      expected.virtualNow = addMilliseconds(expected.virtualNow, 24 * 60 * 60 * 1000);
    } else if (exact === 'reconciliation:source_changed_requires_review') {
      expected.sourceVersion += 1;
      expected.sourceObservedAt = expected.virtualNow;
    } else if (exact === 'reconciliation:source_correction_bound_no_effect') {
      if (expected.sourceVersion === expected.capturedSourceVersion || expected.scheduleExpected) {
        fail('The isolated automation source correction history is unavailable.');
      }
      expected.runSequence += 1;
      expected.capturedSourceVersion = expected.sourceVersion;
      expected.phase = 'queued'; expected.providerStep = 0;
      expected.suppression = false; expected.recovery = 'bounded_history_verified_no_effect';
      expected.scheduleAcceptedAt = expected.virtualNow;
      expected.scheduledAt = addMilliseconds(expected.virtualNow, 60 * 60 * 1000);
      expected.scheduleExpiresAt = addMilliseconds(expected.virtualNow, 48 * 60 * 60 * 1000);
      expected.phaseRecordedAt = expected.virtualNow;
      expected.scheduleExpected = true;
    } else if (exact === 'scheduled_run:scheduled_unpublished') {
      if (!expected.scheduleExpected) fail('The isolated automation schedule history is unavailable.');
      expected.scheduleExpected = false;
    } else if (exact === 'cancellation:paused_no_effect') {
      if (expected.lifecycle !== 'active' || expected.control !== 'active_resumed') {
        fail('The isolated automation pause history is unavailable.');
      }
      expected.lifecycle = 'paused'; expected.control = 'paused';
    } else if (exact === 'reconciliation:resumed_no_effect') {
      if (expected.lifecycle !== 'paused' && !expected.recovery) {
        fail('The isolated automation resume history is unavailable.');
      }
      expected.lifecycle = 'active'; expected.control = 'active_resumed'; expected.recovery = null;
    } else if (exact === 'suppression:blocks_effect_demo_only') {
      if (expected.sourceVersion !== expected.capturedSourceVersion || expected.lifecycle !== 'active' ||
          expected.control !== 'active_resumed' || expected.tenantControl !== 'active_resumed' ||
          expected.recovery || expected.suppression || expected.phase === 'completed_internal' ||
          new Date(expected.scheduleExpiresAt).getTime() <= new Date(expected.virtualNow).getTime()) {
        fail('The isolated automation safeguard history is unavailable.');
      }
      expected.suppression = true; expected.phase = 'queued'; expected.providerStep = 0;
      expected.phaseRecordedAt = expected.virtualNow;
    } else if (exact === 'reconciliation:bounded_recovery_no_effect') {
      const expiredProcessingClaim = expected.phase === 'processing' &&
        new Date(expected.phaseRecordedAt).getTime() + (30 * 60 * 1000) <=
          new Date(expected.virtualNow).getTime();
      if (expected.tenantControl !== 'active_resumed' ||
          (!expected.suppression && !expected.recovery && !expiredProcessingClaim)) {
        fail('The isolated automation recovery history is unavailable.');
      }
      expected.lifecycle = 'active'; expected.control = 'active_resumed';
      expected.suppression = false; expected.recovery = 'bounded_history_verified_no_effect';
      expected.phase = 'queued'; expected.providerStep = 0; expected.phaseRecordedAt = expected.virtualNow;
    } else if (exact === 'provider_attempt:deterministic_simulation_started_no_provider') {
      if (expected.sourceVersion !== expected.capturedSourceVersion || expected.lifecycle !== 'active' ||
          expected.control !== 'active_resumed' || expected.tenantControl !== 'active_resumed' ||
          expected.recovery || expected.suppression || expected.phase !== 'queued' ||
          new Date(expected.scheduledAt).getTime() > new Date(expected.virtualNow).getTime() ||
          new Date(expected.scheduleExpiresAt).getTime() <= new Date(expected.virtualNow).getTime()) {
        fail('The isolated automation processing history is unavailable.');
      }
      expected.phase = 'processing'; expected.providerStep = 1; expected.phaseRecordedAt = expected.virtualNow;
    } else if (exact === 'terminal_outcome:completed_internal_simulation_only') {
      if (expected.phase !== 'processing' || expected.providerStep !== 1 || expected.recovery || expected.suppression) {
        fail('The isolated automation completion history is unavailable.');
      }
      expected.phase = 'completed_internal'; expected.providerStep = 2; expected.phaseRecordedAt = expected.virtualNow;
    } else if (exact === 'cancellation:accepted_demo_stop_no_effect') {
      if (expected.tenantControl !== 'active_resumed') fail('The isolated automation stop history is unavailable.');
      expected.tenantControl = 'bulk_stopped_terminal'; expected.stopped = true;
    } else {
      fail('The isolated automation history contains an unsupported transition.');
    }
    if (event.at !== expected.virtualNow ||
        event.runId !== runId(context, value.generation, expected.runSequence)) {
      fail('The isolated automation transition binding is unavailable.');
    }
  }
  if (expected.scheduleExpected || value.virtualNow !== expected.virtualNow ||
      value.source.version !== expected.sourceVersion || value.source.observedAt !== expected.sourceObservedAt ||
      value.run.sequence !== expected.runSequence ||
      value.run.capturedSourceVersion !== expected.capturedSourceVersion ||
      value.policy.lifecycle !== expected.lifecycle || value.policy.control !== expected.control ||
      value.tenantControl !== expected.tenantControl || value.run.phase !== expected.phase ||
      value.run.providerStep !== expected.providerStep || value.run.suppression !== expected.suppression ||
      value.run.recovery !== expected.recovery || value.run.scheduleAcceptedAt !== expected.scheduleAcceptedAt ||
      value.run.scheduledAt !== expected.scheduledAt ||
      value.run.scheduleExpiresAt !== expected.scheduleExpiresAt ||
      value.run.phaseRecordedAt !== expected.phaseRecordedAt ||
      value.policy.expiresAt !== addMilliseconds(context.anchorTime, 30 * 24 * 60 * 60 * 1000)) {
    fail('The isolated automation state does not match its exact history.');
  }
}

function validateState(value, context) {
  const bounded = contextValue(context);
  if (!exactObject(value, ['contract', 'generation', 'virtualNow', 'source', 'policy', 'run', 'tenantControl', 'events']) ||
      value.contract !== CONTRACT || !Number.isSafeInteger(value.generation) || value.generation < 1 ||
      asIso(value.virtualNow, 'The virtual clock') !== value.virtualNow ||
      !exactObject(value.source, ['id', 'version', 'observedAt', 'digest']) || !UUID.test(value.source.id) ||
      !Number.isSafeInteger(value.source.version) || value.source.version < 1 || !/^sha256:[0-9a-f]{64}$/.test(value.source.digest) ||
      asIso(value.source.observedAt, 'The fictional source observation time') !== value.source.observedAt ||
      !exactObject(value.policy, ['id', 'version', 'lifecycle', 'control', 'expiresAt']) || !UUID.test(value.policy.id) ||
      !Number.isSafeInteger(value.policy.version) || value.policy.version < 1 ||
      !['active', 'paused', 'expired', 'retired'].includes(value.policy.lifecycle) ||
      !['active_resumed', 'paused', 'revoked_terminal'].includes(value.policy.control) ||
      asIso(value.policy.expiresAt, 'The fictional policy expiry') !== value.policy.expiresAt ||
      !exactObject(value.run, ['id', 'sequence', 'capturedSourceVersion', 'scheduleAcceptedAt', 'scheduledAt', 'scheduleExpiresAt',
        'phase', 'phaseRecordedAt', 'providerStep', 'suppression', 'recovery']) || !UUID.test(value.run.id) ||
      !Number.isSafeInteger(value.run.sequence) || value.run.sequence < 1 ||
      !Number.isSafeInteger(value.run.capturedSourceVersion) || value.run.capturedSourceVersion < 1 ||
      asIso(value.run.scheduleAcceptedAt, 'The fictional schedule acceptance') !== value.run.scheduleAcceptedAt ||
      asIso(value.run.scheduledAt, 'The fictional schedule') !== value.run.scheduledAt ||
      asIso(value.run.scheduleExpiresAt, 'The fictional schedule expiry') !== value.run.scheduleExpiresAt ||
      new Date(value.run.scheduledAt).getTime() <= new Date(value.run.scheduleAcceptedAt).getTime() ||
      new Date(value.run.scheduleExpiresAt).getTime() <= new Date(value.run.scheduledAt).getTime() ||
      !['queued', 'processing', 'completed_internal'].includes(value.run.phase) ||
      asIso(value.run.phaseRecordedAt, 'The fictional processing time') !== value.run.phaseRecordedAt ||
      !Number.isSafeInteger(value.run.providerStep) || value.run.providerStep < 0 || value.run.providerStep > 2 ||
      typeof value.run.suppression !== 'boolean' || ![null, 'bounded_history_verified_no_effect'].includes(value.run.recovery) ||
      !['active_resumed', 'bulk_stopped_terminal'].includes(value.tenantControl) ||
      !Array.isArray(value.events) || value.events.length < 3 || value.events.length > 40 ||
      value.run.sequence > value.events.length) fail('The isolated automation state is unavailable.');
  const authorityKey = `${bounded.tenantId}:${bounded.sessionId}:${bounded.workspaceGeneration}:${value.generation}`;
  if (value.source.id !== deterministicUuid('mission28-part14c-source', authorityKey) ||
      value.policy.id !== deterministicUuid('mission28-part14c-policy', authorityKey) ||
      value.run.id !== runId(bounded, value.generation, value.run.sequence) ||
      value.source.digest !== sourceDigest(bounded, value.generation, value.source.version, value.source.observedAt) ||
      value.policy.version !== value.run.sequence ||
      value.run.capturedSourceVersion > value.source.version ||
      new Date(value.virtualNow).getTime() < new Date(bounded.anchorTime).getTime() ||
      new Date(value.source.observedAt).getTime() < new Date(bounded.anchorTime).getTime() ||
      new Date(value.source.observedAt).getTime() > new Date(value.virtualNow).getTime() ||
      new Date(value.run.scheduleAcceptedAt).getTime() > new Date(value.virtualNow).getTime() ||
      new Date(value.run.phaseRecordedAt).getTime() < new Date(bounded.anchorTime).getTime() ||
      new Date(value.run.phaseRecordedAt).getTime() > new Date(value.virtualNow).getTime() ||
      !((value.policy.lifecycle === 'active' && value.policy.control === 'active_resumed') ||
        (value.policy.lifecycle === 'paused' && value.policy.control === 'paused')) ||
      value.run.providerStep !== ({ queued: 0, processing: 1, completed_internal: 2 })[value.run.phase]) {
    fail('The isolated automation bindings are unavailable.');
  }
  const allowedRunIds = new Set(Array.from({ length: value.run.sequence }, (_unused, index) =>
    runId(bounded, value.generation, index + 1)));
  let prior = 0; let priorAt = null;
  for (const event of value.events) {
    validateEvent(event, bounded, value, prior, priorAt, allowedRunIds);
    prior = event.sequence; priorAt = event.at;
  }
  const firstRunId = runId(bounded, value.generation, 1);
  const requiredPrelude = [
    ['eligibility_evaluation', 'eligible'],
    ['proposed_action', 'prepared_no_effect'],
    ['scheduled_run', 'scheduled_unpublished'],
  ];
  if (requiredPrelude.some((entry, index) => value.events[index].runId !== firstRunId ||
      value.events[index].type !== entry[0] || value.events[index].outcome !== entry[1] ||
      value.events[index].at !== bounded.anchorTime) ||
      (value.tenantControl === 'bulk_stopped_terminal' &&
        `${value.events[value.events.length - 1].type}:${value.events[value.events.length - 1].outcome}` !==
          'cancellation:accepted_demo_stop_no_effect')) {
    fail('The isolated automation history binding is unavailable.');
  }
  validateHistoryCoherence(value, bounded);
  return clone(value);
}

function currentState(value, context) {
  return value === undefined || value === null ? initialState(context) : validateState(value, context);
}
function normalizeAction(value) {
  if (typeof value !== 'string' || !ACTIONS.includes(value)) {
    fail('Choose one current fictional automation action.', 'AUTOMATION_DEMO_ACTION_INVALID');
  }
  return value;
}
function actionEventCost(action) {
  return action === 'reset_automation' ? 0 : action === 'source_correct' ? 2 : 1;
}

function appendEvent(state, context, type, outcome, run = state.run) {
  const sequence = state.events.length + 1;
  state.events.push({ id: eventId(context, state.generation, sequence), sequence, runId: run.id,
    type, at: state.virtualNow, outcome });
}
function prepareCurrentRun(state, context) {
  state.policy.version += 1;
  state.run = {
    id: runId(context, state.generation, state.run.sequence + 1), sequence: state.run.sequence + 1,
    capturedSourceVersion: state.source.version, scheduleAcceptedAt: state.virtualNow,
    scheduledAt: addMillisecondsAtWholeSecond(state.virtualNow, 60 * 60 * 1000),
    scheduleExpiresAt: addMilliseconds(state.virtualNow, 48 * 60 * 60 * 1000), phase: 'queued',
    phaseRecordedAt: state.virtualNow, providerStep: 0, suppression: false,
    recovery: 'bounded_history_verified_no_effect',
  };
  return state;
}
function beginCurrentRun(state, context, outcome) {
  prepareCurrentRun(state, context);
  requireRunnableBusinessPrelude(state, context);
  appendEvent(state, context, 'reconciliation', outcome);
  appendEvent(state, context, 'scheduled_run', 'scheduled_unpublished');
}

function recordPayload(event) {
  const exact = `${event.type}:${event.outcome}`;
  const payloads = {
    'eligibility_evaluation:eligible': { eligibility_state: 'eligible' },
    'scheduled_run:scheduled_unpublished': { schedule_record_state: 'scheduled' },
    'terminal_outcome:completed_internal_simulation_only': { terminal_state: 'completed_internal' },
    'suppression:blocks_effect_demo_only': { suppression_blocks_effect: true },
    'cancellation:accepted_demo_stop_no_effect': { cancellation_state: 'accepted' },
    'cancellation:paused_no_effect': { cancellation_state: 'unavailable' },
    'reconciliation:source_correction_bound_no_effect': { reconciliation_state: 'corrected' },
    'reconciliation:source_changed_requires_review': { reconciliation_state: 'uncertain' },
    'reconciliation:bounded_recovery_no_effect': { reconciliation_state: 'consistent' },
    'reconciliation:resumed_no_effect': { reconciliation_state: 'consistent' },
    'reconciliation:virtual_clock_advanced_no_effect': { reconciliation_state: 'consistent' },
  };
  return payloads[exact] || {};
}
function latestRecoveryAt(state) {
  const event = state.events.slice().reverse().find(item => item.type === 'reconciliation' &&
    ['bounded_recovery_no_effect', 'source_correction_bound_no_effect'].includes(item.outcome));
  return event ? event.at : state.run.phaseRecordedAt;
}
function evidenceIds(state) {
  // Every processing claim is bound to its own immutable provider-attempt
  // record. Recovery can queue another attempt, but it cannot rewrite the
  // identity or timestamps of an earlier claim.
  const claimSequence = state.events.filter(event => event.runId === state.run.id &&
    event.type === 'provider_attempt' && event.outcome === 'deterministic_simulation_started_no_provider').length;
  return Object.freeze({
    schedule: deterministicUuid('mission28-part14c-schedule', state.run.id),
    transaction: deterministicUuid('mission28-part14c-transaction', state.run.id),
    lease: deterministicUuid('mission28-part14c-lease', `${state.run.id}:${claimSequence}`),
  });
}

// Server-owned adapters supply the same exact business-decision input for paid
// no-effect preview and isolated demo. Request fields never select policy,
// source, permission, calendar, clock, provider, or recovery authority.
function businessInputForState(value, context, mode = 'isolated_demo') {
  const state = value;
  const bounded = contextValue(context);
  const sourceCurrent = state.run.capturedSourceVersion === state.source.version;
  const leaseExpiresAt = state.run.phase === 'processing'
    ? addMilliseconds(state.run.phaseRecordedAt, 30 * 60 * 1000) : null;
  const claimState = state.run.phase === 'processing'
    ? (new Date(leaseExpiresAt).getTime() > new Date(state.virtualNow).getTime() ? 'active' : 'expired') : 'none';
  return businessEngine.controlledInput({
    mode, tenantId: bounded.tenantId, evaluatedAt: state.virtualNow,
    policyId: state.policy.id, policyVersion: state.policy.version,
    policyLifecycle: state.policy.lifecycle, policyCurrentness: 'exact_current',
    policyExpiresAt: state.policy.expiresAt,
    sourceId: state.source.id, sourceVersion: state.source.version,
    sourceDigest: state.source.digest, sourceState: sourceCurrent ? 'known' : 'unavailable',
    sourceValue: sourceCurrent ? 'latest_exact_current' : null,
    sourceLineage: 'active', sourceObservedAt: state.source.observedAt,
    sourceClassId: SOURCE_CLASS, actionFamily: ACTION_FAMILY,
    recipientClass: RECIPIENT_CLASS, channelId: CHANNEL_ID,
    providerMode: 'provider_disabled', effectClass: 'internal_only_no_external_effect',
    authorizationState: 'exact_current_satisfied', permissionState: 'exact_current_allowed',
    controls: {
      globalPause: 'clear',
      tenantPause: state.tenantControl === 'active_resumed' ? 'clear' : 'matched',
      customerPause: 'not_applicable', documentPause: 'not_applicable',
      recipientOptOut: 'not_applicable',
      providerUncertainty: 'clear',
      sourceChange: sourceCurrent ? 'clear' : 'matched',
      activeConversation: 'not_applicable',
      recentManualActivity: state.run.suppression ? 'matched' : 'clear',
      duplicateContent: 'clear', higherPriorityAction: 'clear',
    },
    schedule: {
      timeZone: 'America/New_York', utcInstant: state.run.scheduledAt,
      acceptedAt: state.run.scheduleAcceptedAt,
      expiresAt: state.run.scheduleExpiresAt,
      allowedWindows: [
        { weekday: 1, startMinute: 0, endMinute: 1440 },
        { weekday: 2, startMinute: 0, endMinute: 1440 },
        { weekday: 3, startMinute: 0, endMinute: 1440 },
        { weekday: 4, startMinute: 0, endMinute: 1440 },
        { weekday: 5, startMinute: 0, endMinute: 1440 },
        { weekday: 6, startMinute: 0, endMinute: 1440 },
        { weekday: 7, startMinute: 0, endMinute: 1440 },
      ],
      quietWindows: [], holidays: [],
    },
    execution: {
      claimState,
      claimAcquiredAt: claimState === 'none' ? null : state.run.phaseRecordedAt,
      claimExpiresAt: claimState === 'none' ? null : leaseExpiresAt,
      recoveryState: state.run.recovery || 'not_required',
    },
  });
}

function businessDecision(value, context, mode = 'isolated_demo') {
  const state = currentState(value, context);
  return businessEngine.evaluate(businessInputForState(state, context, mode));
}

function isRunnableBusinessPrelude(decision) {
  return decision.runnable && decision.policy.state === 'active_exact_current' &&
    decision.evaluation.state === 'eligible' && decision.suppression.state === 'clear' &&
    decision.scheduler.state === 'scheduled_unpublished' &&
    ['ready_no_effect', 'recovery_reviewed_no_effect'].includes(decision.recovery.state);
}
function requireRunnableBusinessPrelude(state, context) {
  const decision = businessEngine.evaluate(businessInputForState(state, context));
  if (!isRunnableBusinessPrelude(decision)) {
    fail('The fictional policy, source, safeguards, calendar, or recovery decision is unavailable.');
  }
  return decision;
}
function canBeginCurrentRun(state, context) {
  const candidate = prepareCurrentRun(clone(state), context);
  return isRunnableBusinessPrelude(
    businessEngine.evaluate(businessInputForState(candidate, context)));
}

function unavailableBusinessInput(mode = 'paid_no_effect_preview', requestedMaterial = {}) {
  if (!businessEngine.MODES.includes(mode)) fail('The no-effect business mode is unavailable.');
  const evaluatedAt = '1970-01-01T15:00:00.000Z';
  const selected = {
    sourceClassId: requestedMaterial.sourceClassId || SOURCE_CLASS,
    actionFamily: requestedMaterial.actionFamily || ACTION_FAMILY,
    recipientClass: requestedMaterial.recipientClass || RECIPIENT_CLASS,
    channelId: requestedMaterial.channelId || CHANNEL_ID,
  };
  const internal = selected.channelId === 'in_app_passive' && selected.recipientClass !== 'exact_customer_record';
  const id = deterministicUuid('mission28-part14c-preview',
    `${mode}:unavailable-no-effect:${JSON.stringify(selected)}`);
  const controls = Object.fromEntries(businessEngine.CONTROL_KINDS.map(kind => [kind, 'unavailable']));
  controls.customerPause = selected.recipientClass === 'exact_customer_record' ? 'unavailable' : 'not_applicable';
  controls.recipientOptOut = selected.recipientClass === 'exact_customer_record' ? 'unavailable' : 'not_applicable';
  controls.activeConversation = selected.recipientClass === 'exact_customer_record' ? 'unavailable' : 'not_applicable';
  controls.documentPause = ['mission24_estimate_quote', 'mission27_financial_collection']
    .includes(selected.sourceClassId) ? 'unavailable' : 'not_applicable';
  return businessEngine.controlledInput({
    mode, tenantId: id, evaluatedAt,
    policyId: deterministicUuid('mission28-part14c-paid-preview-policy', id), policyVersion: 1,
    policyLifecycle: 'unavailable', policyCurrentness: 'unavailable',
    policyExpiresAt: '1970-01-02T15:00:00.000Z',
    sourceId: deterministicUuid('mission28-part14c-paid-preview-source', id), sourceVersion: 1,
    sourceDigest: digest({ unavailable: true, noEffect: true }), sourceState: 'unavailable',
    sourceValue: null, sourceLineage: 'unavailable', sourceObservedAt: evaluatedAt,
    ...selected,
    providerMode: internal ? 'provider_disabled' : 'provider_unavailable_preview_no_effect',
    effectClass: internal ? 'internal_only_no_external_effect' : 'external_preview_no_effect',
    authorizationState: 'unavailable', permissionState: 'unavailable',
    controls,
    schedule: {
      timeZone: 'America/New_York', utcInstant: '1970-01-01T16:00:00.000Z',
      acceptedAt: evaluatedAt, expiresAt: '1970-01-02T16:00:00.000Z',
      allowedWindows: [{ weekday: 4, startMinute: 540, endMinute: 1020 }],
      quietWindows: [], holidays: [],
    },
    execution: { claimState: 'uncertain', claimAcquiredAt: null, claimExpiresAt: null,
      recoveryState: 'unavailable' },
  });
}
// The fictional adapter creates the same closed row vocabulary consumed by
// production Automation Center reads. It cannot select a clock, provider,
// recipient, tenant, or state vocabulary from request fields.
function demoEvidenceRow(value, context) {
  const state = currentState(value, context);
  const event = state.events[state.events.length - 1];
  const ids = evidenceIds(state);
  const row = {
    run_id: state.run.id,
    policy_id: state.policy.id,
    policy_version: String(state.policy.version),
    latest_record_type: event.type,
    currentness_marker: state.run.capturedSourceVersion === state.source.version
      ? 'captured_exact_current' : 'captured_stale_fail_closed',
    latest_recorded_at: event.at,
    policy_expires_at: state.policy.expiresAt,
    policy_lifecycle_state: state.policy.lifecycle,
    policy_lifecycle_currentness: 'exact_current_not_runtime_revalidated',
    schedule_id: ids.schedule,
    schedule_transaction_id: ids.transaction,
    schedule_expires_at: state.run.scheduleExpiresAt,
    schedule_count: 1,
    action_unit_count: 1,
    retry_state: null,
    retry_next_attempt_at: null,
    retry_updated_at: null,
    lease_id: null,
    lease_acquired_at: null,
    lease_expires_at: null,
    recovery_transaction_id: null,
    recovery_policy_id: null,
    recovery_policy_version: null,
    recovery_state: state.run.recovery,
    recovery_recorded_at: null,
    tenant_control_state: state.tenantControl,
    policy_control_state: state.policy.control,
    action_control_state: 'active_resumed',
    action_execution_phase: state.run.phase === 'processing' ? 'leased' : 'queued',
    action_control_updated_at: state.run.phaseRecordedAt,
    ...recordPayload(event),
  };
  if (state.run.phase === 'processing') {
    row.lease_id = ids.lease;
    row.lease_acquired_at = state.run.phaseRecordedAt;
    row.lease_expires_at = addMilliseconds(state.run.phaseRecordedAt, 30 * 60 * 1000);
  }
  if (state.run.phase === 'completed_internal') {
    row.latest_record_type = 'terminal_outcome';
    row.terminal_state = 'completed_internal';
  }
  if (state.run.suppression) {
    row.latest_record_type = 'suppression';
    row.suppression_blocks_effect = true;
    row.action_control_state = null;
    row.action_execution_phase = null;
    row.action_control_updated_at = null;
  }
  if (state.tenantControl !== 'active_resumed') {
    row.latest_record_type = 'cancellation';
    row.cancellation_state = 'accepted';
  }
  if (state.run.recovery) {
    row.recovery_transaction_id = ids.transaction;
    row.recovery_policy_id = state.policy.id;
    row.recovery_policy_version = String(state.policy.version);
    row.recovery_recorded_at = latestRecoveryAt(state);
  }
  return Object.freeze(row);
}
function deriveEvidence(value, context) {
  const state = currentState(value, context);
  const row = demoEvidenceRow(state, context);
  const shared = stateEngine.evaluateEvidence(row, state.virtualNow);
  const business = businessEngine.evaluate(businessInputForState(state, context));
  // Only exact runnable/completed projections preserve the fictional
  // eligibility record. In particular, an expired processing claim projects
  // recovery and cannot be strengthened back to eligible by schedule presence.
  const eligible = ['queued', 'in_flight', 'completed'].includes(shared.run.id);
  return Object.freeze({
    policy: Object.freeze({ lifecycle: shared.policy.id, control: state.policy.control,
      business: business.policy.state }),
    evaluation: business.evaluation.state === 'eligible' && eligible ? 'eligible' :
      business.evaluation.state === 'eligible' ? shared.run.id : business.evaluation.state,
    scheduler: business.scheduler.state === 'scheduled_unpublished' ? state.run.phase : business.scheduler.state,
    suppression: business.suppression.state === 'clear' ? 'exact_current_clear' : business.suppression.state,
    recovery: ['recovery_required', 'reconciliation_required_no_resend', 'unavailable']
      .includes(business.recovery.state) ? business.recovery.state : shared.recovery.state,
    runState: shared.run,
    business,
    sourceCurrent: state.run.capturedSourceVersion === state.source.version,
    provider: Object.freeze({ mode: PROVIDER_MODE, step: state.run.providerStep }),
    effects: Object.freeze({ recipients: 0, providerCalls: 0, external: 0, financial: 0, money: 0 }),
  });
}

function allowedActions(value, context) {
  const state = currentState(value, context);
  if (state.tenantControl !== 'active_resumed') return Object.freeze(['reset_automation']);
  const evidence = deriveEvidence(state, context);
  const actions = ['advance_time', 'source_change'];
  // Correction creates a new exact run and schedule. Offer it only when that
  // exact hypothetical admission passes the same mounted policy, evaluation,
  // suppression, scheduler, and recovery predicate used by applyAction.
  if (!evidence.sourceCurrent && canBeginCurrentRun(state, context)) actions.push('source_correct');
  if (evidence.policy.lifecycle === 'active' && state.policy.control === 'active_resumed') actions.push('pause');
  if (evidence.policy.lifecycle === 'paused' ||
      (evidence.policy.lifecycle === 'active' && state.run.recovery)) actions.push('resume');
  if (evidence.sourceCurrent && evidence.evaluation === 'eligible' && !evidence.recovery &&
      !state.run.suppression && state.run.phase !== 'completed_internal') actions.push('suppress');
  if (state.run.suppression || state.run.recovery || evidence.runState.id === 'recovery') actions.push('recover');
  if (evidence.sourceCurrent && evidence.evaluation === 'eligible' && evidence.scheduler !== 'expired' &&
      new Date(state.virtualNow).getTime() >= new Date(state.run.scheduledAt).getTime() &&
      !evidence.recovery && state.run.providerStep < 2) actions.push('provider_step');
  actions.push('stop', 'reset_automation');
  return Object.freeze(actions.filter(action => state.events.length + actionEventCost(action) <= 40));
}

function applyAction(value, context, actionValue) {
  const bounded = contextValue(context);
  const action = normalizeAction(actionValue);
  const current = currentState(value, bounded);
  if (action === 'reset_automation') return initialState(bounded, current.generation + 1);
  if (current.events.length + actionEventCost(action) > 40) {
    fail('The bounded fictional history is full. Reset it before another simulated step.',
      'AUTOMATION_DEMO_ACTION_UNAVAILABLE');
  }
  if (!allowedActions(current, bounded).includes(action)) {
    fail('That fictional automation action is not available for the current recorded state.',
      'AUTOMATION_DEMO_ACTION_UNAVAILABLE');
  }
  const next = clone(current);
  if (next.tenantControl !== 'active_resumed' && action !== 'recover') {
    fail('This fictional automation is stopped. Reset it before another simulated step.', 'AUTOMATION_DEMO_ACTION_UNAVAILABLE');
  }
  if (action === 'advance_time') {
    next.virtualNow = addMilliseconds(next.virtualNow, 24 * 60 * 60 * 1000);
    appendEvent(next, bounded, 'reconciliation', 'virtual_clock_advanced_no_effect');
  } else if (action === 'source_change') {
    next.source.version += 1;
    next.source.observedAt = next.virtualNow;
    next.source.digest = sourceDigest(bounded, next.generation, next.source.version, next.source.observedAt);
    appendEvent(next, bounded, 'reconciliation', 'source_changed_requires_review');
  } else if (action === 'source_correct') {
    if (next.run.capturedSourceVersion === next.source.version) {
      fail('The fictional source is already current.', 'AUTOMATION_DEMO_ACTION_UNAVAILABLE');
    }
    beginCurrentRun(next, bounded, 'source_correction_bound_no_effect');
  } else if (action === 'pause') {
    if (next.policy.lifecycle !== 'active' || next.policy.control !== 'active_resumed') {
      fail('This fictional policy is not currently active.', 'AUTOMATION_DEMO_ACTION_UNAVAILABLE');
    }
    next.policy.lifecycle = 'paused'; next.policy.control = 'paused';
    appendEvent(next, bounded, 'cancellation', 'paused_no_effect');
  } else if (action === 'resume') {
    if (next.policy.lifecycle !== 'paused' && !next.run.recovery) {
      fail('This fictional policy has no paused or recovery state to resume.', 'AUTOMATION_DEMO_ACTION_UNAVAILABLE');
    }
    next.policy.lifecycle = 'active'; next.policy.control = 'active_resumed';
    // Resume changes policy authority only. It cannot refresh or replace an
    // immutable processing claim. An expired claim therefore still projects
    // recovery and must be explicitly recovered before another claim begins.
    next.run.recovery = null;
    appendEvent(next, bounded, 'reconciliation', 'resumed_no_effect');
  } else if (action === 'suppress') {
    if (next.run.suppression || next.run.phase === 'completed_internal') {
      fail('Completed fictional work cannot be reopened by suppression.', 'AUTOMATION_DEMO_ACTION_UNAVAILABLE');
    }
    const evidence = deriveEvidence(next, bounded);
    if (!evidence.sourceCurrent || evidence.evaluation !== 'eligible' || evidence.recovery) {
      fail('Current fictional source, policy, stop, and recovery checks must pass before suppression.',
        'AUTOMATION_DEMO_ACTION_UNAVAILABLE');
    }
    next.run.suppression = true; next.run.phase = 'queued'; next.run.providerStep = 0;
    next.run.phaseRecordedAt = next.virtualNow;
    appendEvent(next, bounded, 'suppression', 'blocks_effect_demo_only');
  } else if (action === 'recover') {
    if (next.tenantControl !== 'active_resumed') {
      fail('A terminal fictional company stop requires reset, not recovery.', 'AUTOMATION_DEMO_ACTION_UNAVAILABLE');
    }
    const evidence = deriveEvidence(next, bounded);
    if (!next.run.suppression && !next.run.recovery && evidence.runState.id !== 'recovery') {
      fail('This fictional run has no recovery state to review.', 'AUTOMATION_DEMO_ACTION_UNAVAILABLE');
    }
    next.policy.lifecycle = 'active'; next.policy.control = 'active_resumed';
    next.run.recovery = 'bounded_history_verified_no_effect'; next.run.suppression = false;
    next.run.phase = 'queued'; next.run.providerStep = 0; next.run.phaseRecordedAt = next.virtualNow;
    appendEvent(next, bounded, 'reconciliation', 'bounded_recovery_no_effect');
  } else if (action === 'provider_step') {
    const evidence = deriveEvidence(next, bounded);
    if (!evidence.sourceCurrent || evidence.evaluation !== 'eligible' || evidence.scheduler === 'expired' || evidence.recovery) {
      fail('Current fictional source, policy, schedule, stop, and recovery checks must pass before the next simulated step.',
        'AUTOMATION_DEMO_ACTION_UNAVAILABLE');
    }
    if (next.run.providerStep === 0) {
      next.run.phase = 'processing'; next.run.providerStep = 1; next.run.phaseRecordedAt = next.virtualNow;
      appendEvent(next, bounded, 'provider_attempt', 'deterministic_simulation_started_no_provider');
    } else if (next.run.providerStep === 1) {
      next.run.phase = 'completed_internal'; next.run.providerStep = 2; next.run.phaseRecordedAt = next.virtualNow;
      appendEvent(next, bounded, 'terminal_outcome', 'completed_internal_simulation_only');
    } else {
      fail('The deterministic fictional provider simulation is already complete.', 'AUTOMATION_DEMO_ACTION_UNAVAILABLE');
    }
  } else if (action === 'stop') {
    if (next.tenantControl !== 'active_resumed') {
      fail('This fictional workspace is already stopped.', 'AUTOMATION_DEMO_ACTION_UNAVAILABLE');
    }
    next.tenantControl = 'bulk_stopped_terminal';
    appendEvent(next, bounded, 'cancellation', 'accepted_demo_stop_no_effect');
  }
  validateState(next, bounded);
  return next;
}

function buildNoEffectPreview(value, options = {}) {
  const businessMode = options.mode === 'isolated_demo' ? 'isolated_demo' : 'paid_no_effect_preview';
  const requestedMaterial = centerContract.normalizePreviewInput(value);
  const preview = centerContract.buildPreview(requestedMaterial);
  const supplied = options.businessInput;
  const materialMatches = supplied && supplied.source && supplied.authorization &&
    supplied.source.sourceClassId === requestedMaterial.sourceClassId &&
    supplied.authorization.actionFamily === requestedMaterial.actionFamily &&
    supplied.authorization.recipientClass === requestedMaterial.recipientClass &&
    supplied.authorization.channelId === requestedMaterial.channelId;
  const business = businessEngine.evaluate(materialMatches
    ? supplied : unavailableBusinessInput(businessMode, requestedMaterial));
  if (business.mode !== businessMode) fail('The no-effect preview authority is unavailable.');
  const providerMode = businessMode === 'isolated_demo' && business.runnable
    ? PROVIDER_MODE : 'provider_unavailable_preview_no_effect';
  const engineAssessment = Object.freeze({
    policy: business.policy.state,
    evaluation: business.evaluation.state,
    scheduler: business.scheduler.state === 'unavailable' ? 'preview_only_no_schedule_created' : business.scheduler.state,
    suppression: business.suppression.state === 'unavailable'
      ? 'mandatory_checks_required_before_effect' : business.suppression.state,
    recovery: business.recovery.state === 'unavailable' ? 'not_applicable_no_effect' : business.recovery.state,
    run: business.runnable ? 'ready_no_effect' : 'unavailable',
    businessInputDigest: business.inputDigest, businessOutputDigest: business.outputDigest,
    providerMode, recipients: 0, providerCalls: 0, externalEffects: 0,
    financialEffects: 0, moneyEffects: 0,
  });
  if (Object.keys(engineAssessment).filter(key => typeof engineAssessment[key] === 'number')
    .some(key => engineAssessment[key] !== 0)) {
    fail('The no-effect preview boundary is unavailable.');
  }
  return Object.freeze({ ...preview, engineAssessment });
}

module.exports = Object.freeze({
  ACTIONS, ACTION_FAMILY, CHANNEL_ID, CONTRACT, PROVIDER_MODE, RECIPIENT_CLASS, SOURCE_CLASS,
  allowedActions, applyAction, buildNoEffectPreview, businessDecision, businessInputForState,
  currentState, demoEvidenceRow, deriveEvidence, deterministicUuid, evidenceIds, initialState,
  normalizeAction, unavailableBusinessInput, validateState,
});
