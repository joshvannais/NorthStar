'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const parse = relative => JSON.parse(read(relative));
const CONTRACT_PATH = 'docs/architecture/MISSION_28_PART2C_POLICY_LIFECYCLE.json';
const NARRATIVE_PATH = 'docs/architecture/MISSION_28_PART2C_POLICY_LIFECYCLE.md';
const ROADMAP_PATH = 'docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md';
const LEDGER_PATH = 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md';

const BASE = 'dd31bb4d36057c4c3f1774c589a0f425210bb439';
const BASE_TREE = '0fb86eefc19c322593d9e09710e9102329d82d12';
const PART2B_HEAD = 'be14e2467b278f00dfd55082b0f42a4497ef5c22';
const PART2B_DEPLOYMENT = '1a04c6ac-412a-4f5f-b86b-7f506b2a3cc8';
const PART2B_IMAGE = '9defb2eda71fc5fb8905c6b4c623aefd5a0b3a7923980b7b6736cdcebbaf217e';
const MODEL_SHA = '5E3E86A5381A85C2003A93E3504DE7F340543DF4961C541BA374E1744B5B8E09';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const clone = value => JSON.parse(JSON.stringify(value));

const STATES = [
  'draft', 'validated', 'previewed', 'active', 'paused', 'superseded',
  'expired', 'retired', 'emergency_stopped',
];
const OPERATIONS = [
  'draft_create', 'validate', 'preview', 'activate', 'pause', 'resume',
  'supersede', 'expire', 'retire', 'emergency_stop', 'bounded_rollback_draft',
];
const EVENT_FIELDS = [
  'schemaVersion', 'tenantId', 'lifecycleEventId', 'policyBinding',
  'lifecycleSequence', 'operation', 'eventClass', 'fromState', 'toState',
  'predecessorBinding', 'idempotencyDigest', 'sourceSnapshotBinding',
  'requirementBindings', 'relatedPolicyBinding', 'currentness', 'payload',
  'payloadDigest', 'eventDigest',
];

function normalizedLfSha256(relative) {
  const normalized = read(relative).replace(/\r\n/g, '\n');
  if (normalized.includes('\r')) throw new Error('lone CR denied');
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex').toUpperCase();
}

function exactKeySet(value, expected) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required');
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string')) throw new Error('symbol key denied');
  expect([...keys].sort()).toEqual([...expected].sort());
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    expect(descriptor).toMatchObject({ enumerable: true, configurable: true, writable: true });
    expect(Object.hasOwn(descriptor, 'value')).toBe(true);
  }
}

function assertPlainData(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) throw new Error('unsafe number');
    return;
  }
  if (typeof value !== 'object') throw new Error('plain data required');
  if (seen.has(value)) throw new Error('alias or cycle denied');
  seen.add(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || Object.keys(value).length !== value.length) throw new Error('array shape');
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) throw new Error('array descriptor');
      assertPlainData(descriptor.value, seen);
    }
  } else {
    if (Object.getPrototypeOf(value) !== Object.prototype) throw new Error('object prototype');
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') throw new Error('symbol key');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) throw new Error('data descriptor');
      assertPlainData(descriptor.value, seen);
    }
  }
  seen.delete(value);
}

function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) throw new Error('safe integer required');
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function digest(namespace, value) {
  return `sha256:${crypto.createHash('sha256').update(namespace + canonicalJson(value), 'utf8').digest('hex')}`;
}

function payloadDigest(payload, model) {
  return digest(model.canonicalization.payloadNamespace, payload);
}

function eventDigest(event, model) {
  const withoutDigest = {};
  for (const field of model.lifecycleEventFields) if (field !== 'eventDigest') withoutDigest[field] = event[field];
  return digest(model.canonicalization.eventNamespace, withoutDigest);
}

function idempotencyDigest(event, model) {
  return digest(model.canonicalization.idempotencyNamespace, {
    tenantId: event.tenantId,
    policyBinding: event.policyBinding,
    lifecycleSequence: event.lifecycleSequence,
    operation: event.operation,
    predecessorEventDigest: event.predecessorBinding?.eventDigest || null,
    relatedPolicyBinding: event.relatedPolicyBinding,
  });
}

function historicalBindingDigest(binding, model) {
  const withoutDigest = {};
  for (const field of model.historicalRunBindingContract.exactKeys) {
    if (field !== 'bindingDigest') withoutDigest[field] = binding[field];
  }
  return digest(model.canonicalization.historicalRunNamespace, withoutDigest);
}

function policyBinding(model, overrides = {}) {
  return {
    tenantId: model.fixtureContract.tenantId,
    policyId: model.fixtureContract.policyId,
    policyVersion: model.fixtureContract.policyVersion,
    policyDigest: model.fixtureContract.policyDigest,
    ...overrides,
  };
}

function trustedContext(model, overrides = {}) {
  return {
    tenantId: model.fixtureContract.tenantId,
    policyBinding: policyBinding(model),
    sourceSnapshotBinding: {
      tenantId: model.fixtureContract.tenantId,
      sourceSetDigest: model.fixtureContract.sourceSetDigest,
      currentnessMarker: 'contract_fixture_unverified',
    },
    authorityEvidenceDigest: model.fixtureContract.grammarAuthorityEvidenceDigest,
    trustedTimeEvidenceDigest: model.fixtureContract.grammarTrustedTimeEvidenceDigest,
    currentness: {
      policyState: 'contract_fixture_unverified',
      sourceState: 'contract_fixture_unverified',
      marker: 'contract_fixture_unverified',
    },
    relatedPolicyBindings: {
      successor: null,
      rollback_source: null,
    },
    ...overrides,
  };
}

function eventId(index) {
  return `00000000-0000-4000-8000-${String(300 + index).padStart(12, '0')}`;
}

function definition(model, operation) {
  const value = model.operationDefinitions.find(item => item.operation === operation);
  if (!value) throw new Error(`unknown operation ${operation}`);
  return value;
}

function buildEvent(model, operation, previous, priorEvents, options = {}) {
  const rule = definition(model, operation);
  const validation = [...priorEvents].reverse().find(event => event.operation === 'validate');
  const preview = [...priorEvents].reverse().find(event => event.operation === 'preview');
  const event = {
    schemaVersion: 'mission28.policy.lifecycle.event.v1',
    tenantId: model.fixtureContract.tenantId,
    lifecycleEventId: eventId(options.idIndex || priorEvents.length + 1),
    policyBinding: clone(options.policyBinding || policyBinding(model)),
    lifecycleSequence: previous ? previous.lifecycleSequence + 1 : 1,
    operation,
    eventClass: rule.eventClass,
    fromState: previous ? previous.toState : null,
    toState: rule.toState,
    predecessorBinding: previous ? {
      lifecycleEventId: previous.lifecycleEventId,
      eventDigest: previous.eventDigest,
      operation: previous.operation,
      toState: previous.toState,
    } : null,
    idempotencyDigest: '',
    sourceSnapshotBinding: clone(options.sourceSnapshotBinding || trustedContext(model).sourceSnapshotBinding),
    requirementBindings: {
      validationEventDigest: rule.requiresValidation ? validation?.eventDigest || null : null,
      previewEventDigest: rule.requiresPreview ? preview?.eventDigest || null : null,
      authorityEvidenceDigest: rule.requiresAuthority ? model.fixtureContract.grammarAuthorityEvidenceDigest : null,
      trustedTimeEvidenceDigest: rule.requiresTrustedTime ? model.fixtureContract.grammarTrustedTimeEvidenceDigest : null,
    },
    relatedPolicyBinding: options.relatedPolicyBinding ? {
      relation: operation === 'supersede' ? 'successor' : 'rollback_source',
      policyBinding: clone(options.relatedPolicyBinding),
      activationEventDigest: options.relatedActivationEventDigest || `sha256:${'e'.repeat(64)}`,
      terminalEventDigest: operation === 'bounded_rollback_draft'
        ? options.relatedTerminalEventDigest || `sha256:${'f'.repeat(64)}`
        : null,
    } : null,
    currentness: {
      policyState: 'contract_fixture_unverified',
      sourceState: 'contract_fixture_unverified',
      marker: 'contract_fixture_unverified',
    },
    payload: {
      reasonCode: `${operation}_contract_fixture`,
      grammarFixtureOnly: true,
      externalEffects: 0,
    },
    payloadDigest: '',
    eventDigest: '',
  };
  event.idempotencyDigest = idempotencyDigest(event, model);
  event.payloadDigest = payloadDigest(event.payload, model);
  event.eventDigest = eventDigest(event, model);
  return event;
}

function validateCurrentness(event) {
  const { policyState, sourceState, marker } = event.currentness;
  const fixture = 'contract_fixture_unverified';
  if (policyState === fixture || sourceState === fixture) {
    expect(policyState).toBe(fixture);
    expect(sourceState).toBe(fixture);
    expect(marker).toBe(fixture);
  } else if (policyState === 'unavailable' || sourceState === 'unavailable') {
    expect(marker).toBe('unavailable_fail_closed');
  } else if (policyState === 'stale' || sourceState === 'stale') {
    expect(marker).toBe('stale_fail_closed');
  } else {
    expect(policyState).toBe('exact_current');
    expect(sourceState).toBe('exact_current');
    expect(marker).toBe('exact_current_not_runtime_revalidated');
  }
}

function validateEvent(event, model, priorEvents, trusted) {
  assertPlainData(event);
  assertPlainData(trusted);
  exactKeySet(event, model.lifecycleEventFields);
  exactKeySet(trusted, [
    'tenantId', 'policyBinding', 'sourceSnapshotBinding',
    'authorityEvidenceDigest', 'trustedTimeEvidenceDigest', 'currentness',
    'relatedPolicyBindings',
  ]);
  expect(event.schemaVersion).toBe('mission28.policy.lifecycle.event.v1');
  expect(event.tenantId).toBe(trusted.tenantId);
  expect(event.tenantId).toMatch(UUID);
  expect(event.lifecycleEventId).toMatch(UUID);
  expect(Number.isSafeInteger(event.lifecycleSequence)).toBe(true);
  expect(event.lifecycleSequence).toBeGreaterThan(0);
  expect(priorEvents.some(item => item.lifecycleEventId === event.lifecycleEventId)).toBe(false);

  exactKeySet(event.policyBinding, model.bindingSchemas.policyBindingExactKeys);
  expect(event.policyBinding).toEqual(trusted.policyBinding);
  expect(event.policyBinding.tenantId).toBe(event.tenantId);
  expect(event.policyBinding.policyId).toMatch(UUID);
  expect(event.policyBinding.policyVersion).toBeGreaterThan(0);
  expect(event.policyBinding.policyDigest).toMatch(DIGEST);

  const rule = definition(model, event.operation);
  expect(event.eventClass).toBe(rule.eventClass);
  expect(rule.allowedFromStates).toContain(event.fromState);
  expect(event.toState).toBe(rule.toState);
  if (event.predecessorBinding === null) {
    expect(event.lifecycleSequence).toBe(1);
    expect(['draft_create', 'bounded_rollback_draft']).toContain(event.operation);
  } else {
    exactKeySet(event.predecessorBinding, model.bindingSchemas.lifecycleEventBindingExactKeys);
    const predecessor = priorEvents.at(-1);
    expect(predecessor).toBeDefined();
    expect(event.predecessorBinding).toEqual({
      lifecycleEventId: predecessor.lifecycleEventId,
      eventDigest: predecessor.eventDigest,
      operation: predecessor.operation,
      toState: predecessor.toState,
    });
    expect(event.lifecycleSequence).toBe(predecessor.lifecycleSequence + 1);
    expect(event.fromState).toBe(predecessor.toState);
  }

  expect(event.idempotencyDigest).toMatch(DIGEST);
  expect(event.idempotencyDigest).toBe(idempotencyDigest(event, model));
  expect(priorEvents.some(item => item.idempotencyDigest === event.idempotencyDigest)).toBe(false);
  exactKeySet(event.sourceSnapshotBinding, model.bindingSchemas.sourceSnapshotBindingExactKeys);
  expect(event.sourceSnapshotBinding).toEqual(trusted.sourceSnapshotBinding);
  expect(event.sourceSnapshotBinding.tenantId).toBe(event.tenantId);
  exactKeySet(event.requirementBindings, model.bindingSchemas.requirementBindingsExactKeys);
  for (const value of Object.values(event.requirementBindings)) if (value !== null) expect(value).toMatch(DIGEST);
  const validation = [...priorEvents].reverse().find(item => item.operation === 'validate');
  const preview = [...priorEvents].reverse().find(item => item.operation === 'preview');
  expect(event.requirementBindings.validationEventDigest).toBe(rule.requiresValidation ? validation?.eventDigest || null : null);
  expect(event.requirementBindings.previewEventDigest).toBe(rule.requiresPreview ? preview?.eventDigest || null : null);
  expect(event.requirementBindings.authorityEvidenceDigest).toBe(rule.requiresAuthority ? trusted.authorityEvidenceDigest : null);
  expect(event.requirementBindings.trustedTimeEvidenceDigest).toBe(rule.requiresTrustedTime ? trusted.trustedTimeEvidenceDigest : null);

  if (rule.relatedPolicyRule === 'none') expect(event.relatedPolicyBinding).toBeNull();
  else {
    expect(event.relatedPolicyBinding).not.toBeNull();
    exactKeySet(event.relatedPolicyBinding, model.bindingSchemas.relatedPolicyBindingExactKeys);
    expect(model.bindingSchemas.relatedPolicyRelations).toContain(event.relatedPolicyBinding.relation);
    exactKeySet(trusted.relatedPolicyBindings, model.bindingSchemas.relatedPolicyRelations);
    expect(trusted.relatedPolicyBindings[event.relatedPolicyBinding.relation]).not.toBeNull();
    expect(event.relatedPolicyBinding).toEqual(trusted.relatedPolicyBindings[event.relatedPolicyBinding.relation]);
    exactKeySet(event.relatedPolicyBinding.policyBinding, model.bindingSchemas.policyBindingExactKeys);
    expect(event.relatedPolicyBinding.policyBinding.tenantId).toBe(event.tenantId);
    expect(event.relatedPolicyBinding.policyBinding.policyId).toBe(event.policyBinding.policyId);
    expect(event.relatedPolicyBinding.policyBinding.policyDigest).toMatch(DIGEST);
    expect(event.relatedPolicyBinding.activationEventDigest).toMatch(DIGEST);
    if (event.operation === 'supersede') {
      expect(event.relatedPolicyBinding.relation).toBe('successor');
      expect(event.relatedPolicyBinding.terminalEventDigest).toBeNull();
      expect(event.relatedPolicyBinding.policyBinding.policyVersion).toBe(event.policyBinding.policyVersion + 1);
      expect(event.relatedPolicyBinding.policyBinding.policyDigest).not.toBe(event.policyBinding.policyDigest);
    } else {
      expect(event.relatedPolicyBinding.relation).toBe('rollback_source');
      expect(event.relatedPolicyBinding.terminalEventDigest).toMatch(DIGEST);
      expect(event.relatedPolicyBinding.policyBinding.policyVersion).toBeLessThan(event.policyBinding.policyVersion);
    }
  }

  exactKeySet(event.currentness, model.bindingSchemas.currentnessExactKeys);
  expect(model.currentnessSchema.policyStates).toContain(event.currentness.policyState);
  expect(model.currentnessSchema.sourceStates).toContain(event.currentness.sourceState);
  expect(model.currentnessSchema.markers).toContain(event.currentness.marker);
  expect(event.currentness).toEqual(trusted.currentness);
  expect(event.sourceSnapshotBinding.currentnessMarker).toBe(event.currentness.marker);
  validateCurrentness(event);
  exactKeySet(event.payload, ['reasonCode', 'grammarFixtureOnly', 'externalEffects']);
  expect(event.payload).toEqual({
    reasonCode: `${event.operation}_contract_fixture`,
    grammarFixtureOnly: true,
    externalEffects: 0,
  });
  expect(event.payloadDigest).toBe(payloadDigest(event.payload, model));
  expect(event.eventDigest).toBe(eventDigest(event, model));
}

function validateLifecycleLedger(events, model, trusted) {
  assertPlainData(events);
  const accepted = [];
  for (const event of events) {
    validateEvent(event, model, accepted, trusted);
    accepted.push(event);
  }
  const terminalEvents = accepted.filter(event => model.terminalStates.includes(event.toState));
  expect(terminalEvents.length).toBeLessThanOrEqual(1);
  if (terminalEvents.length === 1) expect(accepted.at(-1)).toBe(terminalEvents[0]);
}

function buildActiveLedger(model) {
  const events = [];
  for (const operation of ['draft_create', 'validate', 'preview', 'activate', 'pause', 'resume']) {
    events.push(buildEvent(model, operation, events.at(-1) || null, events));
  }
  return events;
}

function redigestLedger(events, model) {
  const prior = [];
  for (const event of events) {
    if (event.predecessorBinding !== null && prior.length > 0) {
      const predecessor = prior.at(-1);
      event.predecessorBinding = {
        lifecycleEventId: predecessor.lifecycleEventId,
        eventDigest: predecessor.eventDigest,
        operation: predecessor.operation,
        toState: predecessor.toState,
      };
    }
    event.idempotencyDigest = idempotencyDigest(event, model);
    event.payloadDigest = payloadDigest(event.payload, model);
    event.eventDigest = eventDigest(event, model);
    prior.push(event);
  }
}

function buildHistoricalBinding(model, activeEvent) {
  const binding = {
    tenantId: model.fixtureContract.tenantId,
    runId: '00000000-0000-4000-8000-0000000003f0',
    policyBinding: clone(activeEvent.policyBinding),
    sourceSnapshotBinding: clone(activeEvent.sourceSnapshotBinding),
    createdByLifecycleEventBinding: {
      lifecycleEventId: activeEvent.lifecycleEventId,
      eventDigest: activeEvent.eventDigest,
      operation: activeEvent.operation,
      toState: activeEvent.toState,
    },
    lifecycleStateAtCreation: 'active',
    immutable: true,
    bindingDigest: '',
  };
  binding.bindingDigest = historicalBindingDigest(binding, model);
  return binding;
}

function validateHistoricalBinding(binding, model, expected) {
  assertPlainData(binding);
  exactKeySet(binding, model.historicalRunBindingContract.exactKeys);
  expect(binding).toEqual(expected);
  expect(binding.tenantId).toMatch(UUID);
  expect(binding.runId).toMatch(UUID);
  expect(binding.policyBinding.tenantId).toBe(binding.tenantId);
  expect(binding.sourceSnapshotBinding.tenantId).toBe(binding.tenantId);
  expect(binding.lifecycleStateAtCreation).toBe('active');
  expect(binding.immutable).toBe(true);
  expect(binding.bindingDigest).toBe(historicalBindingDigest(binding, model));
}

function validateModel(model) {
  assertPlainData(model);
  exactKeySet(model, [
    'contractVersion', 'authority', 'part2BRelease', 'frozenInputs', 'states',
    'terminalStates', 'operationDefinitions', 'lifecycleEventFields',
    'bindingSchemas', 'currentnessSchema', 'idempotencyContract',
    'historicalRunBindingContract', 'boundedRollbackContract',
    'emergencyStopContract', 'supersessionContract', 'availability',
    'canonicalization', 'fixtureContract', 'unavailableEvidence',
  ]);
  expect(model.contractVersion).toBe('mission28.part2c.policy-lifecycle.v1');
  expect(model.authority).toMatchObject({
    mission: 28,
    part: '2C',
    state: 'implementation_candidate',
    baselineCommit: BASE,
    baselineTree: BASE_TREE,
    sourceContractOnly: true,
    runtimeActivationGranted: false,
    databaseAuthorityGranted: false,
    trustedTimeGranted: false,
    providerAuthorityGranted: false,
    externalEffectAuthorityGranted: false,
  });
  expect(model.part2BRelease).toMatchObject({
    acceptedSourceHead: PART2B_HEAD,
    acceptedTree: BASE_TREE,
    pullRequest: 554,
    mergedMain: BASE,
    deployment: PART2B_DEPLOYMENT,
    deploymentState: 'SUCCESS_RUNNING',
    imageSha256: PART2B_IMAGE,
    auditVerdict: 'P0=P1=P2=P3=0',
    auditReportSha256: null,
  });
  expect(model.states).toEqual(STATES);
  expect(model.terminalStates).toEqual(['superseded', 'expired', 'retired', 'emergency_stopped']);
  expect(model.operationDefinitions.map(item => item.operation)).toEqual(OPERATIONS);
  expect(model.lifecycleEventFields).toEqual(EVENT_FIELDS);
  expect(new Set(model.operationDefinitions.map(item => item.operation)).size).toBe(11);
  for (const operation of model.operationDefinitions) {
    exactKeySet(operation, [
      'operation', 'eventClass', 'allowedFromStates', 'toState',
      'requiresValidation', 'requiresPreview', 'requiresAuthority',
      'requiresTrustedTime', 'relatedPolicyRule', 'terminal',
    ]);
    expect(operation.allowedFromStates.length).toBeGreaterThan(0);
    expect(operation.allowedFromStates.every(state => state === null || STATES.includes(state))).toBe(true);
    expect(STATES).toContain(operation.toState);
    expect(operation.terminal).toBe(model.terminalStates.includes(operation.toState));
  }
  expect(model.availability).toMatchObject({
    grammarFixtureOnly: true,
    activationAuthorityAvailable: false,
    pauseResumeRetireSupersedeAuthorityAvailable: false,
    emergencyStopRuntimeAvailable: false,
    trustedTimeAvailable: false,
    rollbackRuntimeAvailable: false,
    providerCallsAllowed: 0,
    externalEffectsAllowed: 0,
    upstreamMutationsAllowed: 0,
    accountingEffectsAllowed: 0,
    moneyEffectsAllowed: 0,
  });
  expect(model.boundedRollbackContract.requiredLifecycle).toEqual(['draft', 'validated', 'previewed', 'active']);
  expect(model.historicalRunBindingContract).toMatchObject({
    immutable: true,
    rebindToNewPolicyVersion: 'deny',
    rebindToNewSourceSnapshot: 'deny',
  });
}

describe('Mission 28 Part 2C policy lifecycle', () => {
  test('binds exact released inputs, Part 2B release and frozen lifecycle authority', () => {
    const model = parse(CONTRACT_PATH);
    validateModel(model);
    expect(normalizedLfSha256(CONTRACT_PATH)).toBe(MODEL_SHA);
    for (const input of model.frozenInputs) expect(normalizedLfSha256(input.path)).toBe(input.normalizedLfSha256);
  });

  test('defines the exact allowed transition grammar without granting runtime activation', () => {
    const model = parse(CONTRACT_PATH);
    const transitions = Object.fromEntries(model.operationDefinitions.map(item => [item.operation, [item.allowedFromStates, item.toState]]));
    expect(transitions).toEqual({
      draft_create: [[null], 'draft'],
      validate: [['draft'], 'validated'],
      preview: [['validated'], 'previewed'],
      activate: [['previewed'], 'active'],
      pause: [['active'], 'paused'],
      resume: [['paused'], 'active'],
      supersede: [['active', 'paused'], 'superseded'],
      expire: [['draft', 'validated', 'previewed', 'active', 'paused'], 'expired'],
      retire: [['draft', 'validated', 'previewed', 'active', 'paused'], 'retired'],
      emergency_stop: [['active', 'paused'], 'emergency_stopped'],
      bounded_rollback_draft: [[null], 'draft'],
    });
    expect(model.availability.activationAuthorityAvailable).toBe(false);
    expect(model.availability.emergencyStopRuntimeAvailable).toBe(false);
    expect(model.availability.externalEffectsAllowed).toBe(0);
  });

  test('accepts only an immutable grammar fixture with validation, preview and exact authority prerequisites', () => {
    const model = parse(CONTRACT_PATH);
    const events = buildActiveLedger(model);
    expect(events.map(event => event.operation)).toEqual(['draft_create', 'validate', 'preview', 'activate', 'pause', 'resume']);
    validateLifecycleLedger(events, model, trustedContext(model));
    expect(events.find(event => event.operation === 'activate').requirementBindings).toEqual({
      validationEventDigest: events[1].eventDigest,
      previewEventDigest: events[2].eventDigest,
      authorityEvidenceDigest: model.fixtureContract.grammarAuthorityEvidenceDigest,
      trustedTimeEvidenceDigest: null,
    });
    expect(events.every(event => event.payload.grammarFixtureOnly && event.payload.externalEffects === 0)).toBe(true);
  });

  test('rejects skipped, forged, reordered and stale transition chains after digest recomputation', () => {
    const model = parse(CONTRACT_PATH);
    const base = buildActiveLedger(model);
    const cases = [
      list => { list.splice(1, 1); for (let index = 0; index < list.length; index += 1) list[index].lifecycleSequence = index + 1; redigestLedger(list, model); },
      list => { list[1].operation = 'activate'; list[1].eventClass = 'lifecycle_decision'; list[1].toState = 'active'; redigestLedger(list, model); },
      list => { [list[1], list[2]] = [list[2], list[1]]; redigestLedger(list, model); },
      list => { list[2].currentness = { policyState: 'stale', sourceState: 'exact_current', marker: 'exact_current_not_runtime_revalidated' }; redigestLedger(list, model); },
      list => {
        list[2].currentness = { policyState: 'stale', sourceState: 'exact_current', marker: 'stale_fail_closed' };
        list[2].sourceSnapshotBinding.currentnessMarker = 'stale_fail_closed';
        redigestLedger(list, model);
      },
      list => { list[3].requirementBindings.validationEventDigest = null; redigestLedger(list, model); },
      list => { list[3].requirementBindings.previewEventDigest = null; redigestLedger(list, model); },
      list => { list[3].requirementBindings.authorityEvidenceDigest = null; redigestLedger(list, model); },
    ];
    for (const alter of cases) {
      const mutation = clone(base);
      alter(mutation);
      expect(() => validateLifecycleLedger(mutation, model, trustedContext(model))).toThrow();
    }
  });

  test('rejects coherent whole-ledger tenant, policy and source rebound after full redigest', () => {
    const model = parse(CONTRACT_PATH);
    const base = buildActiveLedger(model);
    const cases = [
      list => {
        for (const event of list) {
          event.tenantId = '00000000-0000-4000-8000-000000000029';
          event.policyBinding.tenantId = event.tenantId;
          event.sourceSnapshotBinding.tenantId = event.tenantId;
        }
      },
      list => {
        for (const event of list) {
          event.policyBinding.policyId = '00000000-0000-4000-8000-00000000002d';
          event.policyBinding.policyVersion = 99;
          event.policyBinding.policyDigest = `sha256:${'9'.repeat(64)}`;
        }
      },
      list => { for (const event of list) event.sourceSnapshotBinding.sourceSetDigest = `sha256:${'9'.repeat(64)}`; },
    ];
    for (const alter of cases) {
      const mutation = clone(base);
      alter(mutation);
      redigestLedger(mutation, model);
      expect(() => validateLifecycleLedger(mutation, model, trustedContext(model))).toThrow();
    }
  });

  test('rejects resume or any successor transition after terminal expiry retirement or emergency stop', () => {
    const model = parse(CONTRACT_PATH);
    const active = buildActiveLedger(model).slice(0, 4);
    for (const terminalOperation of ['expire', 'retire', 'emergency_stop']) {
      const events = clone(active);
      const terminal = buildEvent(model, terminalOperation, events.at(-1), events);
      events.push(terminal);
      validateLifecycleLedger(events, model, trustedContext(model));
      const bypass = buildEvent(model, 'resume', terminal, events);
      events.push(bypass);
      expect(() => validateLifecycleLedger(events, model, trustedContext(model))).toThrow();
    }
  });

  test('rejects supersession forks, version gaps, cross-tenant successors and old-version reactivation', () => {
    const model = parse(CONTRACT_PATH);
    const active = buildActiveLedger(model).slice(0, 4);
    const successor = policyBinding(model, {
      policyVersion: 3,
      policyDigest: `sha256:${'c'.repeat(64)}`,
    });
    const supersede = buildEvent(model, 'supersede', active.at(-1), active, { relatedPolicyBinding: successor });
    const supersedeTrusted = trustedContext(model, {
      relatedPolicyBindings: { successor: clone(supersede.relatedPolicyBinding), rollback_source: null },
    });
    validateLifecycleLedger([...active, supersede], model, supersedeTrusted);
    for (const invalid of [
      { ...successor, policyVersion: 4 },
      { ...successor, tenantId: '00000000-0000-4000-8000-000000000029' },
      { ...successor, policyId: '00000000-0000-4000-8000-00000000002d' },
      { ...successor, policyDigest: model.fixtureContract.policyDigest },
    ]) {
      const mutation = buildEvent(model, 'supersede', active.at(-1), active, { relatedPolicyBinding: invalid });
      expect(() => validateLifecycleLedger([...active, mutation], model, supersedeTrusted)).toThrow();
    }
    const forgedActivation = clone(supersede);
    forgedActivation.relatedPolicyBinding.activationEventDigest = `sha256:${'9'.repeat(64)}`;
    forgedActivation.idempotencyDigest = idempotencyDigest(forgedActivation, model);
    forgedActivation.eventDigest = eventDigest(forgedActivation, model);
    expect(() => validateLifecycleLedger([...active, forgedActivation], model, supersedeTrusted)).toThrow();
    const fork = clone(supersede);
    fork.lifecycleEventId = eventId(99);
    fork.relatedPolicyBinding.policyBinding.policyDigest = `sha256:${'d'.repeat(64)}`;
    fork.idempotencyDigest = idempotencyDigest(fork, model);
    fork.eventDigest = eventDigest(fork, model);
    expect(() => validateLifecycleLedger([...active, supersede, fork], model, supersedeTrusted)).toThrow();
    const reactivate = buildEvent(model, 'resume', supersede, [...active, supersede]);
    expect(() => validateLifecycleLedger([...active, supersede, reactivate], model, supersedeTrusted)).toThrow();
  });

  test('models bounded rollback only as a new next-version draft with new validation and authority', () => {
    const model = parse(CONTRACT_PATH);
    const immediatePredecessor = policyBinding(model);
    const rollbackSource = policyBinding(model, {
      policyVersion: 1,
      policyDigest: 'sha256:ac63a452babdac43089bf5a0413ac5fe66b4263b8e03fe5e0299e70916166b48',
    });
    const target = policyBinding(model, {
      policyVersion: 3,
      policyDigest: `sha256:${'c'.repeat(64)}`,
    });
    const validateRollback = (targetBinding, previousBinding, sourceBinding, previousVersionDigest) => {
      expect(targetBinding.tenantId).toBe(previousBinding.tenantId);
      expect(targetBinding.policyId).toBe(previousBinding.policyId);
      expect(targetBinding.policyVersion).toBe(previousBinding.policyVersion + 1);
      expect(targetBinding.policyDigest).not.toBe(previousBinding.policyDigest);
      expect(previousVersionDigest).toBe(previousBinding.policyDigest);
      expect(sourceBinding.tenantId).toBe(targetBinding.tenantId);
      expect(sourceBinding.policyId).toBe(targetBinding.policyId);
      expect(sourceBinding.policyVersion).toBeLessThan(targetBinding.policyVersion);
      expect(sourceBinding.policyDigest).not.toBe(targetBinding.policyDigest);
    };
    expect(() => validateRollback(target, immediatePredecessor, rollbackSource, immediatePredecessor.policyDigest)).not.toThrow();
    const invalid = [
      () => validateRollback({ ...target, policyVersion: 2 }, immediatePredecessor, rollbackSource, immediatePredecessor.policyDigest),
      () => validateRollback(target, immediatePredecessor, rollbackSource, rollbackSource.policyDigest),
      () => validateRollback(target, immediatePredecessor, { ...rollbackSource, tenantId: '00000000-0000-4000-8000-000000000029' }, immediatePredecessor.policyDigest),
      () => validateRollback(target, immediatePredecessor, { ...rollbackSource, policyId: '00000000-0000-4000-8000-00000000002d' }, immediatePredecessor.policyDigest),
    ];
    for (const attempt of invalid) expect(attempt).toThrow();
    const rollbackDraft = buildEvent(model, 'bounded_rollback_draft', null, [], {
      policyBinding: target,
      relatedPolicyBinding: rollbackSource,
      idIndex: 80,
    });
    const rollbackTrusted = trustedContext(model, {
      policyBinding: target,
      relatedPolicyBindings: { successor: null, rollback_source: clone(rollbackDraft.relatedPolicyBinding) },
    });
    validateLifecycleLedger([rollbackDraft], model, rollbackTrusted);
    const forgedTerminal = clone(rollbackDraft);
    forgedTerminal.relatedPolicyBinding.terminalEventDigest = `sha256:${'9'.repeat(64)}`;
    forgedTerminal.idempotencyDigest = idempotencyDigest(forgedTerminal, model);
    forgedTerminal.eventDigest = eventDigest(forgedTerminal, model);
    expect(() => validateLifecycleLedger([forgedTerminal], model, rollbackTrusted)).toThrow();
    expect(rollbackDraft.toState).toBe('draft');
    expect(model.boundedRollbackContract.authorityRule).toContain('new_authority');
    expect(model.boundedRollbackContract.rewindOrReactivateOldVersion).toBe('deny');
  });

  test('keeps historical runs bound to their exact policy, source and activation event across later versions', () => {
    const model = parse(CONTRACT_PATH);
    const activeEvent = buildActiveLedger(model)[3];
    const binding = buildHistoricalBinding(model, activeEvent);
    validateHistoricalBinding(binding, model, clone(binding));
    const cases = [
      value => { value.policyBinding.policyVersion = 3; value.policyBinding.policyDigest = `sha256:${'c'.repeat(64)}`; value.bindingDigest = historicalBindingDigest(value, model); },
      value => { value.sourceSnapshotBinding.sourceSetDigest = `sha256:${'9'.repeat(64)}`; value.bindingDigest = historicalBindingDigest(value, model); },
      value => { value.createdByLifecycleEventBinding.eventDigest = `sha256:${'8'.repeat(64)}`; value.bindingDigest = historicalBindingDigest(value, model); },
      value => { value.lifecycleStateAtCreation = 'paused'; value.bindingDigest = historicalBindingDigest(value, model); },
      value => { value.immutable = false; value.bindingDigest = historicalBindingDigest(value, model); },
    ];
    for (const alter of cases) {
      const mutation = clone(binding);
      alter(mutation);
      expect(() => validateHistoricalBinding(mutation, model, binding)).toThrow();
    }
  });

  test('rejects lifecycle mutation, conflicting replay, duplicate transition and malformed data', () => {
    const model = parse(CONTRACT_PATH);
    const events = buildActiveLedger(model);
    const original = events[2];
    const exactReplay = clone(original);
    expect(exactReplay).toEqual(original);
    expect(model.idempotencyContract.sameDigestSameCanonicalEvent).toBe('idempotent_replay_no_new_record');
    expect(() => validateLifecycleLedger([...events.slice(0, 3), exactReplay], model, trustedContext(model))).toThrow();

    const mutations = [];
    const missing = clone(original); delete missing.toState; mutations.push(missing);
    const extra = clone(original); extra.externalEffect = true; mutations.push(extra);
    const symbol = clone(original); symbol[Symbol('hidden')] = true; mutations.push(symbol);
    const accessor = clone(original); Object.defineProperty(accessor.payload, 'reasonCode', { enumerable: true, get: () => 'preview_contract_fixture' }); mutations.push(accessor);
    const toJson = clone(original); Object.defineProperty(toJson.payload, 'toJSON', { enumerable: true, value: () => ({}) }); mutations.push(toJson);
    const custom = clone(original); Object.setPrototypeOf(custom.payload, { authorityGranted: true }); mutations.push(custom);
    const alias = clone(original); alias.payload = alias.currentness; mutations.push(alias);
    const digestTamper = clone(original); digestTamper.eventDigest = `sha256:${'9'.repeat(64)}`; mutations.push(digestTamper);
    for (const mutation of mutations) {
      expect(() => validateEvent(mutation, model, events.slice(0, 2), trustedContext(model))).toThrow();
    }
  });

  test('binds the narrative to terminal safety, rollback history and Part 2D exclusions', () => {
    const narrative = read(NARRATIVE_PATH).toLowerCase();
    for (const phrase of [
      'append-only lifecycle', 'draft', 'validated', 'previewed', 'active',
      'paused', 'superseded', 'expired', 'retired', 'emergency-stopped',
      'bounded rollback', 'historical runs', 'exact tenant', 'idempotency',
      'part 2d', 'trusted-time', 'founder visual approval',
    ]) expect(narrative).toContain(phrase);
    expect(narrative).toContain('rollback never rewinds or reactivates an old policy version');
    expect(narrative).toContain('cannot rebind an old run to a newer policy or source');
  });

  test('records Parts 1A–1D and 2A–2B released, only Part 2C current and every later slice planned', () => {
    const roadmap = read(ROADMAP_PATH);
    const ledger = read(LEDGER_PATH);
    expect(roadmap).toContain('Parts 1A–1D and 2A–2B released; Part 2C implementation candidate only.');
    expect(roadmap).toContain('Parts 2D–14G remain planned and unimplemented.');
    for (const identity of [PART2B_HEAD, BASE, PART2B_DEPLOYMENT, PART2B_IMAGE]) {
      expect(roadmap).toContain(identity);
      expect(ledger).toContain(identity);
    }
    const rows = [...ledger.matchAll(/^\| (\d{2}) \| (\d{1,2}[A-G]) \| (.+) \| (.+) \| (.+) \|$/gm)];
    expect(rows).toHaveLength(66);
    expect(rows.slice(0, 6).every(row => row[4] === '**Released**')).toBe(true);
    expect(rows[5][5]).toContain('PR #554');
    expect(rows[6][4]).toBe('**Implementation candidate**');
    expect(rows[6][5]).toContain('source-only policy lifecycle contract');
    expect(rows.slice(7).every(row => row[4] === 'Planned / unimplemented' && row[5] === 'None')).toBe(true);
    expect((ledger.match(/\*\*Implementation candidate\*\*/g) || [])).toHaveLength(1);
    expect((ledger.match(/Planned \/ unimplemented/g) || [])).toHaveLength(59);
  });

  test('adds no runtime activation, production source, package or migration', () => {
    expect(fs.existsSync(path.join(ROOT, 'migrations/273_mission28_automation.sql'))).toBe(false);
    expect(read('src/server.js')).not.toContain('MISSION_28_PART2C_POLICY_LIFECYCLE');
    expect(read('package.json')).not.toContain('m28-part2c');
    const model = parse(CONTRACT_PATH);
    expect(model.authority.sourceContractOnly).toBe(true);
    expect(model.availability.providerCallsAllowed).toBe(0);
    expect(model.availability.moneyEffectsAllowed).toBe(0);
  });
});
