'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const MODEL_PATH = 'docs/architecture/MISSION_28_PART2B_IMMUTABLE_RECORD_MODEL.json';
const CONTRACT_PATH = 'docs/architecture/MISSION_28_PART2B_IMMUTABLE_RECORD_MODEL.md';
const POLICY_PATH = 'docs/architecture/MISSION_28_PART2A_CANONICAL_AUTOMATION_POLICY.json';
const ROADMAP_PATH = 'docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md';
const LEDGER_PATH = 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md';

const BASE = 'cc55048e91c2b5c6dd70671d01ebe913123201ad';
const BASE_TREE = '954f9e685642ee23c17376c83cc92a34ae6b72ad';
const PART2A_HEAD = '6f1c299193456afd756542da43c72c6517101661';
const PART2A_DEPLOYMENT = '9e976ab1-733d-4d85-b1f6-6c33073dc3aa';
const PART2A_IMAGE = 'a4fffc825163c836e10a59a60fd64586531d6a365b96eced5b0ce3a880fa5372';
const POLICY_SHA = 'B8BC22AE758E2AD0C2D037963709A947FE0564AF4319DED571F7ABD273D6A4E8';
const MODEL_SHA = 'A281A841761BF7F82C29E850756D28D1ADC93E0F2A0B10309809580FA10C36F4';

const RECORD_TYPES = [
  'eligibility_evaluation', 'proposed_action', 'approval', 'scheduled_run',
  'action_unit', 'provider_attempt', 'provider_acknowledgement',
  'delivery_state', 'reply_opt_out', 'internal_task', 'suppression',
  'cancellation', 'reconciliation', 'terminal_outcome',
];
const RECORD_FIELDS = [
  'schemaVersion', 'tenantId', 'recordId', 'runId', 'recordType',
  'causalOrdinal', 'policyBinding', 'sourceBindings', 'causalParents',
  'classification', 'currentness', 'payload', 'payloadDigest', 'recordDigest',
];
const AUTOMATION_DECISIONS = [
  'eligibility_evaluation', 'proposed_action', 'approval', 'scheduled_run',
  'action_unit', 'internal_task', 'suppression', 'cancellation',
];
const EFFECT_EVIDENCE = [
  'provider_acknowledgement', 'delivery_state', 'reply_opt_out',
  'reconciliation', 'terminal_outcome',
];
const SOURCE_IDS = [
  'mission20_business_contact_preferences', 'mission21_knowledge_reference',
  'mission22_appointment_dispatch', 'mission23_work_execution',
  'mission24_estimate_quote', 'mission25_26_advisory',
  'mission27_financial_collection',
];
const SOURCE_OWNERS = [
  'Mission 20', 'Mission 21', 'Mission 22', 'Mission 23', 'Mission 24',
  'Missions 25 and 26', 'Mission 27',
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const clone = value => JSON.parse(JSON.stringify(value));
const parse = relative => JSON.parse(read(relative));

function normalizedLfSha256(relative) {
  const normalized = read(relative).replace(/\r\n/g, '\n');
  if (normalized.includes('\r')) throw new Error('lone CR is not canonical');
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex').toUpperCase();
}

function exactKeySet(value, expected) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required');
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string')) throw new Error('symbol keys denied');
  expect([...keys].sort()).toEqual([...expected].sort());
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    expect(descriptor).toMatchObject({ enumerable: true, configurable: true, writable: true });
    expect(Object.hasOwn(descriptor, 'value')).toBe(true);
  }
}

function assertPlainJsonData(value, seen = new Set(), location = '$') {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) throw new Error('unsafe number');
    return;
  }
  if (typeof value !== 'object') throw new Error('plain JSON data required');
  if (seen.has(value)) throw new Error('cycle or alias denied');
  seen.add(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) throw new Error('array prototype');
    if (Object.keys(value).length !== value.length) throw new Error('sparse array');
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) throw new Error('array descriptor');
      assertPlainJsonData(descriptor.value, seen, `${location}[${index}]`);
    }
  } else {
    if (Object.getPrototypeOf(value) !== Object.prototype) throw new Error(`object prototype at ${location}`);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') throw new Error('symbol key');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) throw new Error('data descriptor');
      assertPlainJsonData(descriptor.value, seen, `${location}.${key}`);
    }
  }
  seen.delete(value);
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) throw new Error('safe integer required');
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function sha256(namespace, value) {
  return `sha256:${crypto.createHash('sha256').update(namespace + canonicalJson(value), 'utf8').digest('hex')}`;
}

function digestPayload(payload, model) {
  return sha256(model.canonicalization.payloadNamespace, payload);
}

function digestRecord(record, model) {
  const payload = {};
  for (const key of model.recordFields) if (key !== 'recordDigest') payload[key] = record[key];
  return sha256(model.canonicalization.recordNamespace, payload);
}

function validatePayloadValue(value, schema) {
  if (schema.type === 'enum') expect(schema.allowedValues).toContain(value);
  else if (schema.type === 'boolean') expect(typeof value).toBe('boolean');
  else if (schema.type === 'uuid') expect(value).toMatch(UUID);
  else if (schema.type === 'digest') expect(value).toMatch(DIGEST);
  else if (schema.type === 'nullable_uuid') {
    if (value !== null) expect(value).toMatch(UUID);
  } else if (schema.type === 'uuid_array') {
    expect(Array.isArray(value)).toBe(true);
    expect(new Set(value).size).toBe(value.length);
    for (const entry of value) expect(entry).toMatch(UUID);
  } else if (schema.type === 'digest_array') {
    expect(Array.isArray(value)).toBe(true);
    for (const entry of value) expect(entry).toMatch(DIGEST);
  } else throw new Error(`unknown payload type ${schema.type}`);
}

function samePolicy(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function validateRecord(record, model, priorRecords = []) {
  assertPlainJsonData(record);
  exactKeySet(record, model.recordFields);
  expect(record.schemaVersion).toBe('mission28.record.v1');
  expect(record.tenantId).toMatch(UUID);
  expect(record.recordId).toMatch(UUID);
  expect(record.runId).toMatch(UUID);
  expect(Number.isSafeInteger(record.causalOrdinal)).toBe(true);
  expect(record.causalOrdinal).toBeGreaterThan(0);
  expect(priorRecords.some(item => item.recordId === record.recordId)).toBe(false);

  const definition = model.recordDefinitions.find(item => item.recordType === record.recordType);
  expect(definition).toBeDefined();
  exactKeySet(record.policyBinding, model.bindingSchemas.policyBindingExactKeys);
  expect(record.policyBinding.policyId).toMatch(UUID);
  expect(Number.isSafeInteger(record.policyBinding.policyVersion)).toBe(true);
  expect(record.policyBinding.policyVersion).toBeGreaterThan(0);
  expect(record.policyBinding.policyDigest).toMatch(DIGEST);

  expect(Array.isArray(record.sourceBindings)).toBe(true);
  expect(record.sourceBindings.length).toBeGreaterThan(0);
  const sourceKeys = new Set();
  for (const binding of record.sourceBindings) {
    exactKeySet(binding, model.bindingSchemas.sourceBindingExactKeys);
    const sourceIndex = model.bindingSchemas.sourceClassIds.indexOf(binding.sourceClassId);
    expect(sourceIndex).toBeGreaterThanOrEqual(0);
    expect(binding.ownerMission).toBe(model.bindingSchemas.sourceOwnerMissions[sourceIndex]);
    expect(binding.sourceRecordId).toMatch(UUID);
    expect(Number.isSafeInteger(binding.sourceVersion)).toBe(true);
    expect(binding.sourceVersion).toBeGreaterThan(0);
    expect(binding.sourceDigest).toMatch(DIGEST);
    expect(model.bindingSchemas.sourceCurrentnessMarkers).toContain(binding.currentnessMarker);
    const key = `${binding.sourceClassId}:${binding.sourceRecordId}`;
    expect(sourceKeys.has(key)).toBe(false);
    sourceKeys.add(key);
  }

  expect(record.causalParents.length).toBeGreaterThanOrEqual(definition.minimumParents);
  expect(record.causalParents.length).toBeLessThanOrEqual(definition.maximumParents);
  const parentIds = new Set();
  for (const parentLink of record.causalParents) {
    exactKeySet(parentLink, model.bindingSchemas.causalParentExactKeys);
    expect(parentIds.has(parentLink.recordId)).toBe(false);
    parentIds.add(parentLink.recordId);
    const parent = priorRecords.find(item => item.recordId === parentLink.recordId);
    expect(parent).toBeDefined();
    expect(parentLink.recordType).toBe(parent.recordType);
    expect(parentLink.recordDigest).toBe(parent.recordDigest);
    expect(definition.allowedParentTypes).toContain(parent.recordType);
    expect(parent.tenantId).toBe(record.tenantId);
    expect(parent.runId).toBe(record.runId);
    expect(samePolicy(parent.policyBinding, record.policyBinding)).toBe(true);
    expect(parent.causalOrdinal).toBeLessThan(record.causalOrdinal);
  }

  exactKeySet(record.classification, model.classificationSchema.exactKeys);
  expect(record.classification).toEqual({
    authorityClass: definition.authorityClass,
    recordClass: definition.recordClass,
    effectClaim: definition.effectClaim,
  });
  exactKeySet(record.currentness, model.currentnessSchema.exactKeys);
  expect(model.currentnessSchema.policyStates).toContain(record.currentness.policyState);
  expect(model.currentnessSchema.sourceStates).toContain(record.currentness.sourceState);
  expect(model.currentnessSchema.markers).toContain(record.currentness.marker);

  expect(definition.payloadSchema.map(item => item.field)).toEqual(Reflect.ownKeys(record.payload));
  for (const schema of definition.payloadSchema) validatePayloadValue(record.payload[schema.field], schema);
  expect(record.payloadDigest).toBe(digestPayload(record.payload, model));
  expect(record.recordDigest).toBe(digestRecord(record, model));

  if (record.recordType === 'provider_attempt') {
    expect(model.part2BAvailability.providerModesAllowed).toContain(record.payload.providerMode);
    expect(model.part2BAvailability.providerAttemptStatesAllowed).toContain(record.payload.attemptState);
    expect(record.payload.effectOccurred).toBe(false);
  }
  if (record.recordType === 'provider_acknowledgement') {
    expect(record.payload).toMatchObject({ ackState: 'unavailable_contract_fixture', authenticated: false, strongerEffectProven: false });
  }
  if (record.recordType === 'delivery_state') {
    expect(record.payload).toMatchObject({ deliveryState: 'unavailable_contract_fixture', evidenceSource: 'contract_fixture', strongestClaim: 'none' });
  }
  if (record.recordType === 'reply_opt_out') {
    expect(record.payload).toMatchObject({ responseState: 'unavailable_contract_fixture', authenticated: false });
  }
  if (record.recordType === 'internal_task') expect(record.payload.externalEffect).toBe(false);
  if (record.recordType === 'cancellation') expect(record.payload.effectReversalClaim).toBe(false);
  if (record.recordType === 'reconciliation') {
    expect(record.payload.reconciliationState).toBe('unavailable_contract_fixture');
    expect(record.payload.strongestClaim).toBe('none');
  }
  if (record.recordType === 'terminal_outcome') {
    expect(record.payload.terminalState).toBe('unavailable');
    expect(record.payload.businessOutcomeClaimed).toBe(false);
  }
}

const PREFERRED_PARENT = {
  proposed_action: 'eligibility_evaluation',
  approval: 'proposed_action',
  scheduled_run: 'approval',
  action_unit: 'scheduled_run',
  provider_attempt: 'action_unit',
  provider_acknowledgement: 'provider_attempt',
  delivery_state: 'provider_acknowledgement',
  reply_opt_out: 'delivery_state',
  internal_task: 'proposed_action',
  suppression: 'eligibility_evaluation',
  cancellation: 'action_unit',
  reconciliation: 'provider_attempt',
  terminal_outcome: 'action_unit',
};

function recordId(index) {
  return `00000000-0000-4000-8000-${String(100 + index).padStart(12, '0')}`;
}

function buildFixtureLedger(model) {
  const records = [];
  for (let index = 0; index < model.recordDefinitions.length; index += 1) {
    const definition = model.recordDefinitions[index];
    const parentType = PREFERRED_PARENT[definition.recordType];
    const parent = parentType ? records.find(item => item.recordType === parentType) : null;
    const record = {
      schemaVersion: 'mission28.record.v1',
      tenantId: model.fixtureContract.tenantId,
      recordId: recordId(index + 1),
      runId: model.fixtureContract.runId,
      recordType: definition.recordType,
      causalOrdinal: index + 1,
      policyBinding: {
        policyId: model.fixtureContract.policyId,
        policyVersion: model.fixtureContract.policyVersion,
        policyDigest: model.fixtureContract.policyDigest,
      },
      sourceBindings: [clone(model.fixtureContract.sourceBinding)],
      causalParents: parent ? [{
        recordId: parent.recordId,
        recordType: parent.recordType,
        recordDigest: parent.recordDigest,
      }] : [],
      classification: {
        authorityClass: definition.authorityClass,
        recordClass: definition.recordClass,
        effectClaim: definition.effectClaim,
      },
      currentness: {
        policyState: 'contract_fixture_unverified',
        sourceState: 'contract_fixture_unverified',
        marker: 'contract_fixture_unverified',
      },
      payload: clone(definition.fixturePayload),
      payloadDigest: '',
      recordDigest: '',
    };
    record.payloadDigest = digestPayload(record.payload, model);
    record.recordDigest = digestRecord(record, model);
    validateRecord(record, model, records);
    records.push(record);
  }
  return records;
}

function validateLedger(records, model) {
  assertPlainJsonData(records);
  const accepted = [];
  let previousOrdinal = 0;
  for (const record of records) {
    expect(record.causalOrdinal).toBeGreaterThan(previousOrdinal);
    validateRecord(record, model, accepted);
    accepted.push(record);
    previousOrdinal = record.causalOrdinal;
  }
  const terminals = records.filter(item => item.recordType === 'terminal_outcome');
  expect(terminals).toHaveLength(1);
  return accepted;
}

function redigest(record, model) {
  record.payloadDigest = digestPayload(record.payload, model);
  record.recordDigest = digestRecord(record, model);
  return record;
}

function validateModel(model) {
  assertPlainJsonData(model);
  exactKeySet(model, [
    'contractVersion', 'authority', 'part2ARelease', 'frozenInputs',
    'recordFields', 'identityContract', 'bindingSchemas', 'classificationSchema',
    'currentnessSchema', 'payloadValueTypes', 'recordDefinitions',
    'immutabilityContract', 'part2BAvailability', 'canonicalization',
    'structuralRules', 'fixtureContract', 'unavailableEvidence',
  ]);
  expect(model.contractVersion).toBe('mission28.part2b.immutable-record-model.v1');
  expect(model.authority).toMatchObject({
    mission: 28,
    part: '2B',
    state: 'implementation_candidate',
    baselineCommit: BASE,
    baselineTree: BASE_TREE,
    runtimeImplemented: false,
    databaseAuthorityGranted: false,
    lifecycleAuthorityGranted: false,
    providerAuthorityGranted: false,
    externalEffectAuthorityGranted: false,
  });
  expect(model.part2ARelease).toMatchObject({
    acceptedSourceHead: PART2A_HEAD,
    acceptedTree: BASE_TREE,
    pullRequest: 553,
    mergedMain: BASE,
    deployment: PART2A_DEPLOYMENT,
    deploymentState: 'SUCCESS_RUNNING',
    imageSha256: PART2A_IMAGE,
    auditVerdict: 'P0=P1=P2=P3=0',
    auditReportSha256: null,
  });
  expect(model.recordFields).toEqual(RECORD_FIELDS);
  expect(model.recordDefinitions.map(item => item.recordType)).toEqual(RECORD_TYPES);
  expect(new Set(model.recordDefinitions.map(item => item.recordType)).size).toBe(14);
  expect(model.recordDefinitions.filter(item => item.authorityClass === 'automation_decision').map(item => item.recordType)).toEqual(AUTOMATION_DECISIONS);
  expect(model.recordDefinitions.filter(item => item.authorityClass === 'external_effect').map(item => item.recordType)).toEqual(['provider_attempt']);
  expect(model.recordDefinitions.filter(item => item.authorityClass === 'effect_evidence').map(item => item.recordType)).toEqual(EFFECT_EVIDENCE);
  expect(model.bindingSchemas.sourceClassIds).toEqual(SOURCE_IDS);
  expect(model.bindingSchemas.sourceOwnerMissions).toEqual(SOURCE_OWNERS);
  expect(model.part2BAvailability).toMatchObject({
    policyActivation: false,
    providerModesAllowed: ['provider_disabled'],
    providerAttemptStatesAllowed: ['not_attempted_contract_fixture'],
    externalEffectsAllowed: 0,
    providerCallsAllowed: 0,
    upstreamMutationsAllowed: 0,
    accountingEffectsAllowed: 0,
    moneyEffectsAllowed: 0,
  });
  const seen = new Set();
  for (const definition of model.recordDefinitions) {
    exactKeySet(definition, [
      'recordType', 'authorityClass', 'recordClass', 'effectClaim',
      'allowedParentTypes', 'minimumParents', 'maximumParents',
      'payloadSchema', 'fixturePayload', 'effectBoundary',
    ]);
    expect(seen.has(definition.recordType)).toBe(false);
    seen.add(definition.recordType);
    expect(model.classificationSchema.authorityClasses).toContain(definition.authorityClass);
    expect(model.classificationSchema.effectClaims).toContain(definition.effectClaim);
    expect(definition.allowedParentTypes.every(type => seen.has(type))).toBe(true);
    expect(definition.minimumParents).toBeGreaterThanOrEqual(0);
    expect(definition.maximumParents).toBeGreaterThanOrEqual(definition.minimumParents);
    expect(definition.payloadSchema.map(item => item.field)).toEqual(Reflect.ownKeys(definition.fixturePayload));
    expect(new Set(definition.payloadSchema.map(item => item.field)).size).toBe(definition.payloadSchema.length);
    for (const schema of definition.payloadSchema) {
      exactKeySet(schema, ['field', 'type', 'allowedValues']);
      expect(model.payloadValueTypes).toContain(schema.type);
      validatePayloadValue(definition.fixturePayload[schema.field], schema);
    }
  }
  validateLedger(buildFixtureLedger(model), model);
}

describe('Mission 28 Part 2B immutable record model', () => {
  test('binds the exact released inputs, source artifact and Part 2A release identity', () => {
    const model = parse(MODEL_PATH);
    validateModel(model);
    expect(normalizedLfSha256(MODEL_PATH)).toBe(MODEL_SHA);
    expect(normalizedLfSha256(POLICY_PATH)).toBe(POLICY_SHA);
    for (const input of model.frozenInputs) expect(normalizedLfSha256(input.path)).toBe(input.normalizedLfSha256);
  });

  test('builds fourteen separate immutable records with exact digest-linked causal ordering', () => {
    const model = parse(MODEL_PATH);
    const records = buildFixtureLedger(model);
    expect(records.map(item => item.recordType)).toEqual(RECORD_TYPES);
    expect(records.map(item => item.recordId)).toHaveLength(new Set(records.map(item => item.recordId)).size);
    expect(records.every(item => item.tenantId === model.fixtureContract.tenantId)).toBe(true);
    expect(records.every(item => item.runId === model.fixtureContract.runId)).toBe(true);
    expect(records.every(item => samePolicy(item.policyBinding, records[0].policyBinding))).toBe(true);
    expect(records.every(item => item.sourceBindings[0].sourceDigest === model.fixtureContract.sourceBinding.sourceDigest)).toBe(true);
    validateLedger(records, model);
  });

  test('rejects cross-tenant, cross-run and cross-policy parent substitution after recomputed digests', () => {
    const model = parse(MODEL_PATH);
    const records = buildFixtureLedger(model);
    const proposedIndex = records.findIndex(item => item.recordType === 'proposed_action');
    const cases = [
      record => { record.tenantId = '00000000-0000-4000-8000-000000000029'; },
      record => { record.runId = '00000000-0000-4000-8000-00000000002c'; },
      record => { record.policyBinding.policyId = '00000000-0000-4000-8000-00000000002d'; },
      record => { record.policyBinding.policyVersion = 1; },
      record => { record.policyBinding.policyDigest = `sha256:${'9'.repeat(64)}`; },
    ];
    for (const alter of cases) {
      const mutation = clone(records);
      alter(mutation[proposedIndex]);
      redigest(mutation[proposedIndex], model);
      expect(() => validateLedger(mutation, model)).toThrow();
    }
  });

  test('rejects malformed, contradictory or duplicated source and currentness bindings after digest recomputation', () => {
    const model = parse(MODEL_PATH);
    const records = buildFixtureLedger(model);
    const proposedIndex = records.findIndex(item => item.recordType === 'proposed_action');
    const cases = [
      record => { record.sourceBindings[0].ownerMission = 'Mission 24'; },
      record => { record.sourceBindings[0].sourceClassId = 'unsupported_source'; },
      record => { record.sourceBindings[0].sourceRecordId = 'not-a-uuid'; },
      record => { record.sourceBindings[0].sourceVersion = 0; },
      record => { record.sourceBindings[0].sourceDigest = 'sha256:not-a-digest'; },
      record => { record.sourceBindings[0].currentnessMarker = 'runtime_current'; },
      record => { record.sourceBindings.push(clone(record.sourceBindings[0])); },
      record => { record.currentness.policyState = 'active'; },
      record => { record.currentness.sourceState = 'current'; },
      record => { record.currentness.marker = 'runtime_current'; },
    ];
    for (const alter of cases) {
      const mutation = clone(records);
      alter(mutation[proposedIndex]);
      redigest(mutation[proposedIndex], model);
      expect(() => validateLedger(mutation, model)).toThrow();
    }
  });

  test('rejects identity tampering, missing or duplicated links, stale parent digests and event reordering', () => {
    const model = parse(MODEL_PATH);
    const records = buildFixtureLedger(model);
    const proposedIndex = records.findIndex(item => item.recordType === 'proposed_action');
    const cases = [
      list => { list[proposedIndex].recordId = list[0].recordId; redigest(list[proposedIndex], model); },
      list => { list[proposedIndex].causalParents = []; redigest(list[proposedIndex], model); },
      list => { list[proposedIndex].causalParents.push(clone(list[proposedIndex].causalParents[0])); redigest(list[proposedIndex], model); },
      list => { list[proposedIndex].causalParents[0].recordDigest = `sha256:${'8'.repeat(64)}`; redigest(list[proposedIndex], model); },
      list => { list[proposedIndex].causalParents[0].recordType = 'scheduled_run'; redigest(list[proposedIndex], model); },
      list => { list[proposedIndex].causalOrdinal = 1; redigest(list[proposedIndex], model); },
      list => { [list[0], list[1]] = [list[1], list[0]]; },
    ];
    for (const alter of cases) {
      const mutation = clone(records);
      alter(mutation);
      expect(() => validateLedger(mutation, model)).toThrow();
    }
  });

  test('rejects record conflation and stronger authority or evidence claims even with recomputed digests', () => {
    const model = parse(MODEL_PATH);
    const records = buildFixtureLedger(model);
    const proposedIndex = records.findIndex(item => item.recordType === 'proposed_action');
    const providerIndex = records.findIndex(item => item.recordType === 'provider_attempt');
    const deliveryIndex = records.findIndex(item => item.recordType === 'delivery_state');
    const terminalIndex = records.findIndex(item => item.recordType === 'terminal_outcome');
    const cases = [
      list => { list[proposedIndex].recordType = 'approval'; redigest(list[proposedIndex], model); },
      list => { list[proposedIndex].classification.authorityClass = 'external_effect'; redigest(list[proposedIndex], model); },
      list => { list[providerIndex].payload.attemptState = 'attempted'; list[providerIndex].payload.providerMode = 'live'; list[providerIndex].payload.effectOccurred = true; redigest(list[providerIndex], model); },
      list => { list[providerIndex].payload.moneyEffect = true; redigest(list[providerIndex], model); },
      list => { list[deliveryIndex].payload.deliveryState = 'delivered'; list[deliveryIndex].payload.evidenceSource = 'authenticated_provider'; list[deliveryIndex].payload.strongestClaim = 'delivered'; redigest(list[deliveryIndex], model); },
      list => { list[terminalIndex].payload.terminalState = 'completed_internal'; list[terminalIndex].payload.businessOutcomeClaimed = true; redigest(list[terminalIndex], model); },
    ];
    for (const alter of cases) {
      const mutation = clone(records);
      alter(mutation);
      expect(() => validateLedger(mutation, model)).toThrow();
    }
  });

  test('rejects mutable evidence replacement, duplicate identity and ambiguous terminal outcomes', () => {
    const model = parse(MODEL_PATH);
    const records = buildFixtureLedger(model);
    const delivery = records.find(item => item.recordType === 'delivery_state');
    const rewritten = clone(delivery);
    rewritten.currentness.marker = 'captured_not_runtime_revalidated';
    redigest(rewritten, model);
    expect(rewritten.recordId).toBe(delivery.recordId);
    expect(rewritten.recordDigest).not.toBe(delivery.recordDigest);
    expect(() => validateRecord(rewritten, model, records)).toThrow();

    const secondTerminal = clone(records.at(-1));
    secondTerminal.recordId = '00000000-0000-4000-8000-000000000199';
    secondTerminal.causalOrdinal = records.at(-1).causalOrdinal + 1;
    redigest(secondTerminal, model);
    const ambiguous = [...records, secondTerminal];
    expect(() => validateLedger(ambiguous, model)).toThrow();
  });

  test('rejects malformed, non-plain, structurally inexact and digest-tampered records', () => {
    const model = parse(MODEL_PATH);
    const records = buildFixtureLedger(model);
    const original = records[1];
    const mutations = [];
    for (const key of RECORD_FIELDS) {
      const missing = clone(original);
      delete missing[key];
      mutations.push(missing);
    }
    mutations.push({ ...clone(original), extra: true });
    const nestedExtra = clone(original); nestedExtra.payload.extra = true; mutations.push(nestedExtra);
    const symbol = clone(original); symbol[Symbol('hidden')] = true; mutations.push(symbol);
    const accessor = clone(original); Object.defineProperty(accessor.payload, 'actionFamily', { enumerable: true, get: () => 'internal_read_digest_task' }); mutations.push(accessor);
    const toJson = clone(original); Object.defineProperty(toJson.payload, 'toJSON', { enumerable: true, value: () => ({}) }); mutations.push(toJson);
    const custom = clone(original); Object.setPrototypeOf(custom.payload, { externalEffect: true }); mutations.push(custom);
    const sparse = clone(original); sparse.sourceBindings = new Array(1); mutations.push(sparse);
    const alias = clone(original); alias.payload = alias.policyBinding; mutations.push(alias);
    const fraction = clone(original); fraction.causalOrdinal = 1.5; mutations.push(fraction);
    const negativeZero = clone(original); negativeZero.causalOrdinal = -0; mutations.push(negativeZero);
    const payloadTamper = clone(original); payloadTamper.payload.recipientClassId = 'tenant_admin'; mutations.push(payloadTamper);
    const recordTamper = clone(original); recordTamper.recordDigest = `sha256:${'f'.repeat(64)}`; mutations.push(recordTamper);
    for (const mutation of mutations) expect(() => validateRecord(mutation, model, [records[0]])).toThrow();
  });

  test('binds the narrative to separation, immutability, causal ordering and Part 2D exclusions', () => {
    const narrative = read(CONTRACT_PATH).toLowerCase();
    for (const value of [
      'fourteen separate record kinds', 'append-only', 'cross-tenant',
      'cross-policy', 'causal ordinal', 'payload digest', 'record digest',
      'provider-attempt', 'acknowledgement', 'delivery', 'reply/opt-out',
      'terminal outcome', 'part 2c', 'part 2d', 'postgresql', 'trusted time',
      'founder visual approval',
    ]) expect(narrative).toContain(value);
    for (const recordType of RECORD_TYPES) expect(narrative).toContain(`\`${recordType}\``);
  });

  test('records Parts 1A–1D and 2A released, only Part 2B current and every later slice planned', () => {
    const roadmap = read(ROADMAP_PATH);
    const ledger = read(LEDGER_PATH);
    expect(roadmap).toContain('Parts 1A–1D and 2A released; Part 2B implementation candidate only.');
    expect(roadmap).toContain('Parts 2C–14G remain planned and unimplemented.');
    for (const identity of [PART2A_HEAD, BASE, PART2A_DEPLOYMENT, PART2A_IMAGE]) {
      expect(roadmap).toContain(identity);
      expect(ledger).toContain(identity);
    }
    const rows = [...ledger.matchAll(/^\| (\d{2}) \| (\d{1,2}[A-G]) \| (.+) \| (.+) \| (.+) \|$/gm)];
    expect(rows).toHaveLength(66);
    expect(rows.slice(0, 5).every(row => row[4] === '**Released**')).toBe(true);
    expect(rows[4][5]).toContain('PR #553');
    expect(rows[5][4]).toBe('**Implementation candidate**');
    expect(rows[5][5]).toContain('source-only immutable record contract');
    expect(rows.slice(6).every(row => row[4] === 'Planned / unimplemented' && row[5] === 'None')).toBe(true);
    expect((ledger.match(/\*\*Implementation candidate\*\*/g) || [])).toHaveLength(1);
    expect((ledger.match(/Planned \/ unimplemented/g) || [])).toHaveLength(60);
  });

  test('adds no runtime, database, migration, provider, scheduling, route, UI or demo behavior', () => {
    const productionFiles = [];
    const walk = directory => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(absolute);
        else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) productionFiles.push(absolute);
      }
    };
    walk(path.join(ROOT, 'src'));
    const productionSource = productionFiles.map(file => fs.readFileSync(file, 'utf8')).join('\n');
    expect(productionSource).not.toContain('MISSION_28_PART2B_IMMUTABLE_RECORD_MODEL');
    expect(productionSource).not.toContain('mission28.part2b.immutable-record-model.v1');
    const migrations = fs.readdirSync(path.join(ROOT, 'migrations')).filter(name => name.endsWith('.sql'))
      .sort((left, right) => Number(left.split('_')[0]) - Number(right.split('_')[0]));
    expect(migrations).toHaveLength(268);
    expect(migrations.at(-1)).toBe('272_customer_financial_invoice_draft_preview_v1.sql');
    expect(migrations.some(name => /^273_/.test(name))).toBe(false);
  });
});
