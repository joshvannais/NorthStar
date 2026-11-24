'use strict';

// This is the mounted, effect-free business-decision seam for Part 14C. It
// implements the accepted Part 5B/5D and 6B precedence over server-resolved
// material. Both paid preview and isolated demo call this module. It never
// resolves tenant data, writes authority, creates a queue item, or calls a
// provider; those remain separate, unavailable authorities.
const canonical = require('./canonicalJson');

const CONTRACT = 'mission28.part14c.shared-business-decision.v1';
const MODES = Object.freeze(['paid_no_effect_preview', 'isolated_demo']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const CONTROL_KINDS = Object.freeze([
  'globalPause', 'tenantPause', 'customerPause', 'documentPause',
  'recipientOptOut', 'providerUncertainty', 'sourceChange',
  'activeConversation', 'recentManualActivity', 'duplicateContent',
  'higherPriorityAction',
]);
const CONTROL_STATES = Object.freeze(['clear', 'matched', 'unavailable', 'not_applicable']);
const SOURCE_STATES = Object.freeze(['known', 'unknown', 'unavailable']);
const POLICY_LIFECYCLES = Object.freeze(['active', 'paused', 'expired', 'retired', 'emergency_stopped', 'unavailable']);
const POLICY_CURRENTNESS = Object.freeze(['exact_current', 'unavailable']);
const SOURCE_LINEAGES = Object.freeze(['active', 'tombstoned', 'reversed', 'unavailable']);
const PERMISSION_STATES = Object.freeze(['exact_current_allowed', 'exact_current_blocked', 'unavailable']);
const AUTHORIZATION_STATES = Object.freeze(['exact_current_satisfied', 'required', 'expired', 'unavailable']);
const CLAIM_STATES = Object.freeze(['none', 'active', 'expired', 'uncertain']);
const RECOVERY_STATES = Object.freeze([
  'not_required', 'bounded_history_verified_no_effect',
  'reconciliation_required_no_resend', 'unavailable',
]);
const WEEKDAYS = Object.freeze({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 });

const SOURCES = Object.freeze({
  evaluator: Object.freeze({ path: 'docs/architecture/MISSION_28_PART5B_DETERMINISTIC_EVALUATOR_CONTRACT.json',
    normalizedLfSha256: 'BAD13E2EE322990655E3C817F89B227DDE40D591054746286002F9628BAA9758' }),
  suppression: Object.freeze({ path: 'docs/architecture/MISSION_28_PART5D_COLLISION_SUPPRESSION_DRY_RUN_CONTRACT.json',
    normalizedLfSha256: 'DAD8279E384924222EB1F0F8F86B0EC739197334F727596DD6A3F53044865FFA' }),
  scheduler: Object.freeze({ path: 'docs/architecture/MISSION_28_PART6B_DURABLE_SCHEDULER_CONTRACT.json',
    normalizedLfSha256: '36EC7DE5DEE42EBA9C95D67A8549EFA6204AC2B142AC4C54ACB49688F42600EF' }),
  recovery: Object.freeze({ path: 'docs/architecture/MISSION_28_PART6F_RECOVERY_AUTHORITY_CONTRACT.json',
    normalizedLfSha256: '31427D49C49575B908293BF5E8442B15BB7F960D5952E0910B89EC8C4869FBFE' }),
});

function fail(message) { throw new TypeError(`Mission 28 shared decision ${message}`); }
function iso(value, label) {
  if (typeof value !== 'string') fail(`${label} is unavailable`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) fail(`${label} is invalid`);
  return value;
}
function uuid(value, label) { if (!UUID.test(String(value || ''))) fail(`${label} is invalid`); return value; }
function hash(value, label) { if (!DIGEST.test(String(value || ''))) fail(`${label} is invalid`); return value; }
function digest(namespace, value) { return canonical.digest(`${namespace}\n`, value); }
function seal(namespace, value) { return { ...value, digest: digest(namespace, value) }; }
function exact(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    fail(`${label} shape is invalid`);
  }
  const actual = Object.keys(value).sort();
  const expected = keys.slice().sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} fields are invalid`);
  }
}
function clone(value) { return JSON.parse(canonical.canonicalize(value)); }
function at(value) { return new Date(value).getTime(); }
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
function validLocalDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function localParts(instant, timeZone) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(instant));
  } catch (_) { fail('time zone is unavailable'); }
  const values = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  if (!WEEKDAYS[values.weekday]) fail('local schedule could not be resolved');
  return Object.freeze({
    date: `${values.year}-${values.month}-${values.day}`,
    minute: Number(values.hour) * 60 + Number(values.minute),
    weekday: WEEKDAYS[values.weekday],
  });
}
function inWindows(windows, weekday, minute) {
  return windows.some(window => window.weekday === weekday && minute >= window.startMinute && minute < window.endMinute);
}
function validateWindows(windows, label) {
  if (!Array.isArray(windows) || windows.length < (label === 'allowed windows' ? 1 : 0) || windows.length > 32) {
    fail(`${label} are invalid`);
  }
  let prior = null; const priorEnd = new Map();
  for (const window of windows) {
    exact(window, ['weekday', 'startMinute', 'endMinute'], label);
    if (!Number.isInteger(window.weekday) || window.weekday < 1 || window.weekday > 7 ||
        !Number.isInteger(window.startMinute) || !Number.isInteger(window.endMinute) ||
        window.startMinute < 0 || window.endMinute > 1440 || window.startMinute >= window.endMinute) {
      fail(`${label} are invalid`);
    }
    const key = window.weekday * 1441 + window.startMinute;
    if (prior !== null && key <= prior) fail(`${label} are not strictly ordered`);
    if ((priorEnd.get(window.weekday) || -1) > window.startMinute) fail(`${label} overlap`);
    priorEnd.set(window.weekday, window.endMinute);
    prior = key;
  }
}

function normalizedControls(overrides = {}) {
  const selected = clone(overrides);
  if (!selected || typeof selected !== 'object' || Array.isArray(selected)) fail('controls are invalid');
  if (Object.keys(selected).some(key => !CONTROL_KINDS.includes(key))) fail('control kind is unsupported');
  const controls = {};
  for (const kind of CONTROL_KINDS) {
    const value = Object.hasOwn(selected, kind) ? selected[kind] :
      (['customerPause', 'documentPause', 'activeConversation'].includes(kind) ? 'not_applicable' : 'clear');
    if (!CONTROL_STATES.includes(value)) fail('control state is unsupported');
    controls[kind] = value;
  }
  return controls;
}

function controlledInput(options = {}) {
  const evaluatedAt = iso(options.evaluatedAt, 'evaluation time');
  const tenantId = uuid(options.tenantId, 'tenant');
  const policyId = uuid(options.policyId, 'policy');
  const sourceId = uuid(options.sourceId, 'source');
  if (!MODES.includes(options.mode)) fail('mode is unsupported');
  if (!Number.isSafeInteger(options.policyVersion) || options.policyVersion < 1 ||
      !Number.isSafeInteger(options.sourceVersion) || options.sourceVersion < 1) fail('version is invalid');
  if (!POLICY_LIFECYCLES.includes(options.policyLifecycle)) fail('policy lifecycle is unsupported');
  if (!POLICY_CURRENTNESS.includes(options.policyCurrentness)) fail('policy currentness is unsupported');
  if (!SOURCE_STATES.includes(options.sourceState)) fail('source state is unsupported');
  if (!SOURCE_LINEAGES.includes(options.sourceLineage)) fail('source lineage is unsupported');
  if (!PERMISSION_STATES.includes(options.permissionState)) fail('permission state is unsupported');
  if (!AUTHORIZATION_STATES.includes(options.authorizationState)) fail('authorization state is unsupported');
  const sourceValue = options.sourceValue === undefined ? 'latest_exact_current' : options.sourceValue;
  if (options.sourceState === 'known' && typeof sourceValue !== 'string') fail('known source value is invalid');
  if (options.sourceState !== 'known' && sourceValue !== null) fail('absent source value must remain null');
  const schedule = clone(options.schedule);
  exact(schedule, ['timeZone', 'utcInstant', 'acceptedAt', 'expiresAt', 'allowedWindows', 'quietWindows', 'holidays'], 'schedule');
  iso(schedule.utcInstant, 'schedule instant'); iso(schedule.acceptedAt, 'schedule acceptance time');
  iso(schedule.expiresAt, 'schedule expiration');
  if (typeof schedule.timeZone !== 'string' || schedule.timeZone.length > 64) fail('time zone is invalid');
  const exactZones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  if (schedule.timeZone !== 'UTC' && !exactZones.includes(schedule.timeZone)) fail('time zone is unavailable');
  validateWindows(schedule.allowedWindows, 'allowed windows'); validateWindows(schedule.quietWindows, 'quiet windows');
  if (!Array.isArray(schedule.holidays) || schedule.holidays.length > 64 ||
      schedule.holidays.some((day, index) => !validLocalDate(day) || (index && day <= schedule.holidays[index - 1]))) {
    fail('holidays are invalid');
  }
  if (at(schedule.acceptedAt) > at(evaluatedAt)) fail('schedule acceptance is from the future');
  const execution = clone(options.execution || { claimState: 'none', claimAcquiredAt: null,
    claimExpiresAt: null, recoveryState: 'not_required' });
  exact(execution, ['claimState', 'claimAcquiredAt', 'claimExpiresAt', 'recoveryState'], 'execution');
  if (!CLAIM_STATES.includes(execution.claimState) || !RECOVERY_STATES.includes(execution.recoveryState)) {
    fail('execution state is unsupported');
  }
  if (execution.claimState === 'none') {
    if (execution.claimAcquiredAt !== null || execution.claimExpiresAt !== null) fail('empty claim has timestamps');
  } else if (execution.claimState === 'uncertain') {
    if (execution.claimAcquiredAt !== null || execution.claimExpiresAt !== null) fail('uncertain claim invents timestamps');
  } else {
    iso(execution.claimAcquiredAt, 'claim acquisition time'); iso(execution.claimExpiresAt, 'claim expiration time');
    if (at(execution.claimExpiresAt) <= at(execution.claimAcquiredAt) ||
        at(execution.claimAcquiredAt) > at(evaluatedAt)) fail('claim interval is invalid');
  }
  const policy = seal('mission28.part14c.shared-policy.v1', {
    tenantId, policyId, version: options.policyVersion, lifecycle: options.policyLifecycle,
    currentness: options.policyCurrentness, expiresAt: iso(options.policyExpiresAt, 'policy expiration'),
    rule: { factRef: 'source.currentness_state', operator: 'equals', expected: 'latest_exact_current' },
  });
  const source = seal('mission28.part14c.shared-source.v1', {
    tenantId, sourceId, version: options.sourceVersion, sourceDigest: hash(options.sourceDigest, 'source digest'),
    state: options.sourceState, value: sourceValue, lineage: options.sourceLineage,
    observedAt: iso(options.sourceObservedAt, 'source observation time'),
  });
  const permission = seal('mission28.part14c.shared-permission.v1', { tenantId, state: options.permissionState });
  const authorization = seal('mission28.part14c.shared-authorization.v1', {
    tenantId, kind: 'standing_authorization', state: options.authorizationState,
    policyDigest: policy.digest, sourceDigest: source.digest, permissionDigest: permission.digest,
    actionFamily: 'internal_read_digest_task', recipientClass: 'tenant_owner',
    channelId: 'in_app_passive', providerMode: 'no_external_provider',
    effectClass: 'internal_only_no_external_effect',
  });
  const controls = seal('mission28.part14c.shared-controls.v1', { tenantId, states: normalizedControls(options.controls) });
  const scheduleBinding = seal('mission28.part14c.shared-schedule.v1', {
    tenantId, policyDigest: policy.digest, sourceDigest: source.digest,
    authorizationDigest: authorization.digest, permissionDigest: permission.digest,
    controlsDigest: controls.digest, ...schedule,
  });
  const executionBinding = seal('mission28.part14c.shared-execution.v1', {
    tenantId, scheduleDigest: scheduleBinding.digest, ...execution,
  });
  const input = {
    contract: CONTRACT, mode: options.mode, tenantId, evaluatedAt,
    policy, source, authorization, permission, controls, schedule: scheduleBinding, execution: executionBinding,
  };
  return { ...input, inputDigest: digest('mission28.part14c.shared-decision-input.v1', input) };
}

function validateInput(input) {
  exact(input, ['contract', 'mode', 'tenantId', 'evaluatedAt', 'policy', 'source', 'authorization', 'permission',
    'controls', 'schedule', 'execution', 'inputDigest'], 'input');
  if (input.contract !== CONTRACT || !MODES.includes(input.mode)) fail('contract or mode is unsupported');
  uuid(input.tenantId, 'tenant'); iso(input.evaluatedAt, 'evaluation time'); hash(input.inputDigest, 'input digest');
  for (const [kind, namespace, fields] of [
    ['policy', 'mission28.part14c.shared-policy.v1', ['tenantId', 'policyId', 'version', 'lifecycle', 'currentness', 'expiresAt', 'rule', 'digest']],
    ['source', 'mission28.part14c.shared-source.v1', ['tenantId', 'sourceId', 'version', 'sourceDigest', 'state', 'value', 'lineage', 'observedAt', 'digest']],
    ['authorization', 'mission28.part14c.shared-authorization.v1', ['tenantId', 'kind', 'state', 'policyDigest',
      'sourceDigest', 'permissionDigest', 'actionFamily', 'recipientClass', 'channelId', 'providerMode',
      'effectClass', 'digest']],
    ['permission', 'mission28.part14c.shared-permission.v1', ['tenantId', 'state', 'digest']],
    ['controls', 'mission28.part14c.shared-controls.v1', ['tenantId', 'states', 'digest']],
    ['schedule', 'mission28.part14c.shared-schedule.v1', ['tenantId', 'policyDigest', 'sourceDigest',
      'authorizationDigest', 'permissionDigest', 'controlsDigest', 'timeZone', 'utcInstant', 'acceptedAt',
      'expiresAt', 'allowedWindows', 'quietWindows', 'holidays', 'digest']],
    ['execution', 'mission28.part14c.shared-execution.v1', ['tenantId', 'scheduleDigest', 'claimState',
      'claimAcquiredAt', 'claimExpiresAt', 'recoveryState', 'digest']],
  ]) {
    exact(input[kind], fields, kind);
    if (input[kind].tenantId !== input.tenantId ||
        digest(namespace, Object.fromEntries(Object.entries(input[kind]).filter(([key]) => key !== 'digest'))) !== input[kind].digest) {
      fail(`${kind} binding is invalid`);
    }
  }
  uuid(input.policy.policyId, 'policy'); uuid(input.source.sourceId, 'source');
  if (!Number.isSafeInteger(input.policy.version) || input.policy.version < 1 ||
      !Number.isSafeInteger(input.source.version) || input.source.version < 1 ||
      !POLICY_LIFECYCLES.includes(input.policy.lifecycle) ||
      !POLICY_CURRENTNESS.includes(input.policy.currentness) ||
      !SOURCE_STATES.includes(input.source.state) || !SOURCE_LINEAGES.includes(input.source.lineage) ||
      !AUTHORIZATION_STATES.includes(input.authorization.state) ||
      input.authorization.kind !== 'standing_authorization' ||
      !PERMISSION_STATES.includes(input.permission.state)) fail('bound decision vocabulary is unsupported');
  if (input.authorization.policyDigest !== input.policy.digest ||
      input.authorization.sourceDigest !== input.source.digest ||
      input.authorization.permissionDigest !== input.permission.digest ||
      input.authorization.actionFamily !== 'internal_read_digest_task' ||
      input.authorization.recipientClass !== 'tenant_owner' ||
      input.authorization.channelId !== 'in_app_passive' ||
      input.authorization.providerMode !== 'no_external_provider' ||
      input.authorization.effectClass !== 'internal_only_no_external_effect' ||
      input.schedule.policyDigest !== input.policy.digest || input.schedule.sourceDigest !== input.source.digest ||
      input.schedule.authorizationDigest !== input.authorization.digest ||
      input.schedule.permissionDigest !== input.permission.digest ||
      input.schedule.controlsDigest !== input.controls.digest ||
      input.execution.scheduleDigest !== input.schedule.digest) fail('cross-component binding is invalid');
  exact(input.policy.rule, ['factRef', 'operator', 'expected'], 'rule');
  if (input.policy.rule.factRef !== 'source.currentness_state' || input.policy.rule.operator !== 'equals' ||
      input.policy.rule.expected !== 'latest_exact_current') fail('rule is unsupported');
  exact(input.controls.states, CONTROL_KINDS, 'controls');
  if (CONTROL_KINDS.some(kind => !CONTROL_STATES.includes(input.controls.states[kind]))) {
    fail('control state is unsupported');
  }
  iso(input.policy.expiresAt, 'policy expiration'); iso(input.source.observedAt, 'source observation time');
  hash(input.source.sourceDigest, 'source digest');
  if ((input.source.state === 'known' && typeof input.source.value !== 'string') ||
      (input.source.state !== 'known' && input.source.value !== null)) fail('source value is incoherent');
  iso(input.schedule.utcInstant, 'schedule instant'); iso(input.schedule.acceptedAt, 'schedule acceptance time');
  iso(input.schedule.expiresAt, 'schedule expiration');
  const exactZones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  if (input.schedule.timeZone !== 'UTC' && !exactZones.includes(input.schedule.timeZone)) fail('time zone is unavailable');
  validateWindows(input.schedule.allowedWindows, 'allowed windows');
  validateWindows(input.schedule.quietWindows, 'quiet windows');
  if (!Array.isArray(input.schedule.holidays) || input.schedule.holidays.length > 64 ||
      input.schedule.holidays.some((day, index) => !validLocalDate(day) ||
        (index && day <= input.schedule.holidays[index - 1]))) fail('holidays are invalid');
  if (at(input.schedule.acceptedAt) > at(input.evaluatedAt)) fail('schedule acceptance is from the future');
  if (!CLAIM_STATES.includes(input.execution.claimState) ||
      !RECOVERY_STATES.includes(input.execution.recoveryState)) fail('execution state is unsupported');
  if (['none', 'uncertain'].includes(input.execution.claimState)) {
    if (input.execution.claimAcquiredAt !== null || input.execution.claimExpiresAt !== null) {
      fail('execution timestamps are incoherent');
    }
  } else {
    iso(input.execution.claimAcquiredAt, 'claim acquisition time');
    iso(input.execution.claimExpiresAt, 'claim expiration time');
    if (at(input.execution.claimExpiresAt) <= at(input.execution.claimAcquiredAt) ||
        at(input.execution.claimAcquiredAt) > at(input.evaluatedAt)) {
      fail('execution timestamps are incoherent');
    }
  }
  const material = Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'inputDigest'));
  if (digest('mission28.part14c.shared-decision-input.v1', material) !== input.inputDigest) fail('input binding is invalid');
  return input;
}

function policyDecision(input) {
  const policy = input.policy;
  let state = 'unavailable'; let reason = 'policy_currentness_unavailable';
  if (policy.currentness === 'exact_current') {
    if (policy.lifecycle !== 'active') { state = policy.lifecycle; reason = `policy_${policy.lifecycle}`; }
    else if (at(policy.expiresAt) <= at(input.evaluatedAt)) { state = 'expired'; reason = 'policy_expired'; }
    else { state = 'active_exact_current'; reason = 'policy_active_exact_current'; }
  }
  return seal('mission28.part14c.shared-policy-decision.v1', { state, reason, policyDigest: policy.digest });
}
function evaluationDecision(input, policy) {
  const source = input.source;
  let state; let reason; let evidenceQuality;
  if (policy.state === 'unavailable') { state = 'unavailable'; reason = policy.reason; evidenceQuality = 'unavailable'; }
  else if (source.state === 'unavailable' || source.observedAt > input.evaluatedAt) {
    state = 'unavailable'; reason = 'source_unavailable'; evidenceQuality = 'unavailable';
  } else if (source.state === 'unknown') {
    state = 'unavailable'; reason = 'source_unknown'; evidenceQuality = 'partial_unknown';
  } else if (input.authorization.state === 'unavailable') {
    state = 'unavailable'; reason = 'authorization_unavailable'; evidenceQuality = 'unavailable';
  } else if (policy.state === 'expired') {
    state = 'expired'; reason = policy.reason; evidenceQuality = 'complete_exact';
  } else if (policy.state !== 'active_exact_current') {
    state = 'ineligible'; reason = policy.reason; evidenceQuality = 'complete_exact';
  } else if (source.lineage !== 'active') {
    state = 'ineligible'; reason = 'source_lineage_not_active'; evidenceQuality = 'complete_exact';
  } else if (source.value !== input.policy.rule.expected) {
    state = 'ineligible'; reason = 'rule_no_match'; evidenceQuality = 'complete_exact';
  } else if (['required', 'expired'].includes(input.authorization.state)) {
    state = 'approval_required'; reason = 'authorization_required'; evidenceQuality = 'complete_exact';
  } else {
    state = 'eligible'; reason = 'rule_match_exact_current'; evidenceQuality = 'complete_exact';
  }
  return seal('mission28.part14c.shared-evaluation-decision.v1', {
    state, reason, evidenceQuality, policyDigest: input.policy.digest, sourceDigest: source.digest,
    authorizationDigest: input.authorization.digest,
  });
}
function suppressionDecision(input) {
  let state = 'clear'; let reason = 'all_exact_controls_clear';
  const unavailableKind = CONTROL_KINDS.find(kind => input.controls.states[kind] === 'unavailable');
  if (input.permission.state === 'unavailable') { state = 'unavailable'; reason = 'permission_unavailable'; }
  else if (unavailableKind) { state = 'unavailable'; reason = `${unavailableKind}_unavailable`; }
  else if (input.controls.states.sourceChange === 'matched') {
    state = 'unavailable'; reason = 'sourceChange_matched';
  } else if (input.controls.states.providerUncertainty === 'matched') {
    state = 'unavailable'; reason = 'providerUncertainty_matched';
  } else if (input.permission.state === 'exact_current_blocked') {
    state = 'suppressed'; reason = 'recipient_permission_blocked';
  } else {
    const matchedKind = [
      'globalPause', 'tenantPause', 'customerPause', 'documentPause', 'recipientOptOut',
      'activeConversation', 'recentManualActivity', 'duplicateContent', 'higherPriorityAction',
    ].find(kind => input.controls.states[kind] === 'matched');
    if (matchedKind) {
      state = matchedKind === 'higherPriorityAction' ? 'superseded' : 'suppressed';
      reason = `${matchedKind}_matched`;
    }
  }
  return seal('mission28.part14c.shared-suppression-decision.v1', {
    state, reason, permissionDigest: input.permission.digest, controlsDigest: input.controls.digest,
  });
}
function evaluationWithSuppression(evaluation, suppression) {
  if (suppression.state === 'unavailable') {
    return seal('mission28.part14c.shared-evaluation-decision.v1', {
      state: 'unavailable', reason: suppression.reason, evidenceQuality: 'unavailable',
      policyDigest: evaluation.policyDigest, sourceDigest: evaluation.sourceDigest,
      authorizationDigest: evaluation.authorizationDigest,
    });
  }
  // Exact policy expiry and exact tombstoned/reversed lineage precede a
  // suppression match in the released Part 5B result order.
  if (['unavailable', 'expired'].includes(evaluation.state) ||
      evaluation.reason === 'source_lineage_not_active') return evaluation;
  if (suppression.state === 'clear') return evaluation;
  if (['suppressed', 'superseded'].includes(suppression.state)) {
    return seal('mission28.part14c.shared-evaluation-decision.v1', {
      state: 'suppressed', reason: suppression.reason, evidenceQuality: 'complete_exact',
      policyDigest: evaluation.policyDigest, sourceDigest: evaluation.sourceDigest,
      authorizationDigest: evaluation.authorizationDigest,
    });
  }
  return evaluation;
}
function schedulerDecision(input, evaluation, suppression) {
  const schedule = input.schedule;
  let state = 'unavailable'; let reason = 'schedule_prerequisite_unavailable';
  let local = null;
  if (evaluation.state === 'eligible' && suppression.state === 'clear') {
    local = localParts(schedule.utcInstant, schedule.timeZone);
    if (at(schedule.expiresAt) <= at(input.evaluatedAt)) {
      state = 'expired'; reason = 'schedule_expired';
    } else if (at(schedule.utcInstant) <= at(schedule.acceptedAt) || at(schedule.expiresAt) <= at(schedule.utcInstant) ||
        at(schedule.expiresAt) > at(schedule.acceptedAt) + 367 * 24 * 60 * 60 * 1000) {
      reason = 'schedule_time_bounds_invalid';
    } else if (schedule.holidays.includes(local.date)) {
      state = 'suppressed'; reason = 'schedule_holiday';
    } else if (!inWindows(schedule.allowedWindows, local.weekday, local.minute)) {
      state = 'suppressed'; reason = 'schedule_outside_allowed_window';
    } else if (inWindows(schedule.quietWindows, local.weekday, local.minute)) {
      state = 'suppressed'; reason = 'schedule_quiet_window';
    } else {
      state = 'scheduled_unpublished'; reason = 'exact_calendar_schedule_recorded';
    }
  }
  return seal('mission28.part14c.shared-scheduler-decision.v1', {
    state, reason, scheduleDigest: schedule.digest, utcInstant: schedule.utcInstant,
    localDate: local ? local.date : null, localMinute: local ? local.minute : null,
  });
}
function recoveryDecision(input, evaluation, suppression, scheduler) {
  const execution = input.execution;
  let state = 'ready_no_effect'; let reason = 'no_claim_or_recovery_block';
  if (evaluation.state !== 'eligible' || suppression.state !== 'clear' || scheduler.state !== 'scheduled_unpublished') {
    state = 'unavailable'; reason = 'business_decision_not_runnable';
  } else if (execution.recoveryState === 'unavailable' || execution.claimState === 'uncertain') {
    state = 'reconciliation_required_no_resend'; reason = 'execution_history_uncertain';
  } else if (execution.recoveryState === 'reconciliation_required_no_resend') {
    state = 'reconciliation_required_no_resend'; reason = 'reconciliation_required';
  } else if (execution.claimState === 'active') {
    state = at(execution.claimExpiresAt) > at(input.evaluatedAt) ? 'in_flight' : 'recovery_required';
    reason = state === 'in_flight' ? 'exact_active_claim' : 'claim_expired';
  } else if (execution.claimState === 'expired') {
    state = 'recovery_required'; reason = 'claim_expired';
  } else if (execution.recoveryState === 'bounded_history_verified_no_effect') {
    state = 'recovery_reviewed_no_effect'; reason = 'bounded_history_verified';
  }
  return seal('mission28.part14c.shared-recovery-decision.v1', {
    state, reason, executionDigest: execution.digest,
  });
}

function evaluate(inputValue) {
  const input = validateInput(inputValue);
  const policy = policyDecision(input);
  const preliminaryEvaluation = evaluationDecision(input, policy);
  const suppression = suppressionDecision(input);
  // Part 5B's accepted result precedence includes exact current suppression:
  // eligible is impossible unless suppression is clear. Keep the separate
  // Part 5D decision while projecting its restrictive result into the shared
  // evaluation result used by both paid preview and isolated demo.
  const evaluation = evaluationWithSuppression(preliminaryEvaluation, suppression);
  const scheduler = schedulerDecision(input, evaluation, suppression);
  const recovery = recoveryDecision(input, evaluation, suppression, scheduler);
  const output = {
    contract: CONTRACT, mode: input.mode, inputDigest: input.inputDigest,
    policy, evaluation, suppression, scheduler, recovery,
    runnable: evaluation.state === 'eligible' && suppression.state === 'clear' &&
      scheduler.state === 'scheduled_unpublished' &&
      ['ready_no_effect', 'in_flight', 'recovery_reviewed_no_effect'].includes(recovery.state),
    effects: { recipients: 0, providerCalls: 0, external: 0, financial: 0, money: 0 },
  };
  return deepFreeze({ ...output, outputDigest: digest('mission28.part14c.shared-business-output.v1', output) });
}

module.exports = Object.freeze({
  CONTRACT, CONTROL_KINDS, MODES, SOURCES, controlledInput, evaluate,
});
