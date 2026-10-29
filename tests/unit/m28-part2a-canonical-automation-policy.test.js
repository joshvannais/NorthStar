'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const POLICY_PATH = 'docs/architecture/MISSION_28_PART2A_CANONICAL_AUTOMATION_POLICY.json';
const CONTRACT_PATH = 'docs/architecture/MISSION_28_PART2A_CANONICAL_AUTOMATION_POLICY.md';
const MATRIX_PATH = 'docs/architecture/MISSION_28_PART1D_FIRST_LAUNCH_MATRIX.json';
const ROADMAP_PATH = 'docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md';
const LEDGER_PATH = 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md';

const BASE = 'aa875c9a2ad6e03f8d41575e6b19e31aa36ed02d';
const BASE_TREE = '0f7df37487cc8d0b57b7ef79a730ba9fea93e7ac';
const PART1D_HEAD = 'f869b0b1e0da15149e33948e1a732208d585ebd0';
const PART1D_DEPLOYMENT = 'dc96dc7d-5fe7-4eaa-a093-e37792373f6e';
const PART1D_IMAGE = 'cff3f90fa227c84b24e8230581d87d2ff8f0a82cd113ac5e1c00c4589547019d';
const MATRIX_SHA = '8CC5C4D62719EA6E6BCF9A340C5BE0593BE2F10CD60360D10562C4979D859B52';
const POLICY_SHA = 'B8BC22AE758E2AD0C2D037963709A947FE0564AF4319DED571F7ABD273D6A4E8';

const POLICY_FIELDS = [
  'schemaVersion', 'tenantId', 'policyId', 'version', 'previousVersionDigest',
  'trigger', 'action', 'recipient', 'channel', 'schedule', 'limits', 'approval',
  'suppressions', 'expiresAt', 'rolloutState', 'canonicalDigest',
];
const SOURCE_IDS = [
  'mission20_business_contact_preferences', 'mission21_knowledge_reference',
  'mission22_appointment_dispatch', 'mission23_work_execution',
  'mission24_estimate_quote', 'mission25_26_advisory',
  'mission27_financial_collection',
];
const ALLOWED_ACTIONS = [
  'internal_read_digest_task', 'owner_approval_request', 'collection_escalation',
];
const UNAVAILABLE_ACTIONS = [
  'customer_communication', 'secure_document_delivery', 'financial_reminder',
];
const SUPPRESSIONS = [
  'global_stop', 'tenant_pause', 'source_changed_stale_corrected_or_unavailable',
  'manual_activity_or_owner_action', 'prior_effect_unknown_or_unreconciled',
  'recipient_permission_or_channel_unavailable', 'limit_exceeded',
  'expired_or_rollout_disabled',
];
const LIMIT_KEYS = [
  'maxSourceSnapshots', 'maxActions', 'maxInternalRecipients',
  'maxExternalRecipients', 'maxExternalMessages', 'maxProviderAttempts',
  'maxUpstreamMutations', 'maxMoneyEffects', 'maxCanonicalInputBytes',
];
const LIMITS = {
  maxSourceSnapshots: 1,
  maxActions: 1,
  maxInternalRecipients: 1,
  maxExternalRecipients: 0,
  maxExternalMessages: 0,
  maxProviderAttempts: 0,
  maxUpstreamMutations: 0,
  maxMoneyEffects: 0,
  maxCanonicalInputBytes: 65536,
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const UTC_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

const parse = relative => JSON.parse(read(relative));
const clone = value => structuredClone(value);

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

function assertPlainJsonData(value, seen = new Set()) {
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
      assertPlainJsonData(descriptor.value, seen);
    }
  } else {
    if (Object.getPrototypeOf(value) !== Object.prototype) throw new Error('object prototype');
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') throw new Error('symbol key');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) throw new Error('data descriptor');
      assertPlainJsonData(descriptor.value, seen);
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

function digestPolicy(policy, contract) {
  const payload = {};
  for (const key of contract.policyVersionFields) if (key !== 'canonicalDigest') payload[key] = policy[key];
  const input = contract.canonicalization.namespace + canonicalJson(payload);
  return `sha256:${crypto.createHash('sha256').update(input, 'utf8').digest('hex')}`;
}

function validatePolicyVersion(policy, contract, previous = null) {
  assertPlainJsonData(policy);
  exactKeySet(policy, contract.policyVersionFields);
  expect(policy.schemaVersion).toBe('mission28.policy.version.v1');
  expect(policy.tenantId).toMatch(UUID);
  expect(policy.policyId).toMatch(UUID);
  expect(Number.isSafeInteger(policy.version)).toBe(true);
  expect(policy.version).toBeGreaterThan(0);

  if (previous === null) {
    expect(policy.version).toBe(1);
    expect(policy.previousVersionDigest).toBeNull();
  } else {
    expect(policy.tenantId).toBe(previous.tenantId);
    expect(policy.policyId).toBe(previous.policyId);
    expect(policy.version).toBe(previous.version + 1);
    expect(policy.previousVersionDigest).toBe(previous.canonicalDigest);
  }

  exactKeySet(policy.trigger, contract.triggerGrammar.exactKeys);
  expect(policy.trigger.kind).toBe(contract.triggerGrammar.kind);
  expect(contract.triggerGrammar.sourceClassIds).toContain(policy.trigger.sourceClassId);
  exactKeySet(policy.trigger.condition, contract.triggerGrammar.conditionExactKeys);
  expect(contract.triggerGrammar.conditionOperators).toContain(policy.trigger.condition.operator);
  expect(contract.triggerGrammar.conditionExpectedValues).toContain(policy.trigger.condition.expected);

  exactKeySet(policy.action, contract.actionGrammar.exactKeys);
  expect(contract.actionGrammar.policyDefinitionAllowedNotRunnableFamilies).toContain(policy.action.familyId);
  expect(policy.action.kind).toBe(contract.actionGrammar.kind);
  expect(contract.actionGrammar.capabilityIds).toContain(policy.action.capabilityId);
  expect(contract.actionGrammar.riskClasses).toContain(policy.action.riskClass);

  exactKeySet(policy.recipient, contract.recipientGrammar.exactKeys);
  expect(contract.recipientGrammar.classIds).toContain(policy.recipient.classId);
  expect(policy.recipient.binding).toBe(contract.recipientGrammar.binding);
  exactKeySet(policy.channel, contract.channelGrammar.exactKeys);
  expect(contract.channelGrammar.channelIds).toContain(policy.channel.channelId);
  expect(contract.channelGrammar.providerModes).toContain(policy.channel.providerMode);

  const cell = contract.allowedPolicyCells.find(entry => entry.actionFamily === policy.action.familyId);
  expect(cell).toBeDefined();
  expect(cell.sourceClassIds).toContain(policy.trigger.sourceClassId);
  expect(policy.action.capabilityId).toBe(cell.capabilityId);
  expect(policy.action.riskClass).toBe(cell.riskClass);
  expect(cell.recipientClassIds).toContain(policy.recipient.classId);
  expect(policy.channel.channelId).toBe(cell.channelId);
  expect(cell.providerModes).toContain(policy.channel.providerMode);

  exactKeySet(policy.schedule, contract.scheduleGrammar.exactKeys);
  expect(policy.schedule).toEqual({
    mode: 'evaluation_only_no_scheduler',
    timeZone: null,
    notBefore: null,
    quietHoursMode: 'not_applicable_internal',
  });
  exactKeySet(policy.limits, contract.limitGrammar.exactKeys);
  expect(policy.limits).toEqual(LIMITS);
  exactKeySet(policy.approval, contract.approvalGrammar.exactKeys);
  expect(policy.approval).toEqual({
    mode: 'part3_per_run_or_standing_authority_required',
    authorityGranted: false,
  });
  expect(policy.suppressions).toEqual(contract.suppressionGrammar.exactOrder);
  expect(policy.suppressions).toEqual(SUPPRESSIONS);
  expect(policy.expiresAt).toMatch(UTC_SECONDS);
  expect(Number.isNaN(Date.parse(policy.expiresAt))).toBe(false);
  expect(contract.rolloutStateGrammar.allowedValues).toContain(policy.rolloutState);
  expect(contract.rolloutStateGrammar.enabledValues).toEqual([]);
  expect(policy.canonicalDigest).toMatch(DIGEST);
  expect(policy.canonicalDigest).toBe(digestPolicy(policy, contract));
  expect(Buffer.byteLength(canonicalJson(policy), 'utf8')).toBeLessThanOrEqual(LIMITS.maxCanonicalInputBytes);
}

function validateContract(contract) {
  assertPlainJsonData(contract);
  exactKeySet(contract, [
    'contractVersion', 'authority', 'part1DRelease', 'frozenInputs',
    'policyVersionFields', 'identity', 'versioning', 'triggerGrammar',
    'actionGrammar', 'recipientGrammar', 'channelGrammar', 'scheduleGrammar',
    'limitGrammar', 'approvalGrammar', 'suppressionGrammar', 'expiryGrammar',
    'rolloutStateGrammar', 'canonicalization', 'allowedPolicyCells',
    'canonicalExamples', 'unavailableEvidence',
  ]);
  expect(contract.contractVersion).toBe('mission28.part2a.canonical-automation-policy.v1');
  expect(contract.authority).toMatchObject({
    mission: 28,
    part: '2A',
    state: 'implementation_candidate',
    baselineCommit: BASE,
    baselineTree: BASE_TREE,
    runtimeImplemented: false,
    databaseAuthorityGranted: false,
    policyActivationGranted: false,
    providerAuthorityGranted: false,
    externalEffectAuthorityGranted: false,
  });
  expect(contract.part1DRelease).toMatchObject({
    acceptedSourceHead: PART1D_HEAD,
    acceptedTree: BASE_TREE,
    pullRequest: 552,
    mergedMain: BASE,
    deployment: PART1D_DEPLOYMENT,
    deploymentState: 'SUCCESS_RUNNING',
    imageSha256: PART1D_IMAGE,
    auditVerdict: 'P0=P1=P2=P3=0',
    auditReportSha256: null,
  });
  expect(contract.policyVersionFields).toEqual(POLICY_FIELDS);
  expect(contract.triggerGrammar.sourceClassIds).toEqual(SOURCE_IDS);
  expect(contract.actionGrammar.policyDefinitionAllowedNotRunnableFamilies).toEqual(ALLOWED_ACTIONS);
  expect(contract.actionGrammar.unavailableFamilies).toEqual(UNAVAILABLE_ACTIONS);
  expect(contract.actionGrammar.permanentlyDeniedFamilies).toEqual(['unsupported_upstream_mutation_or_money_movement']);
  expect(contract.limitGrammar.ceilings).toEqual(LIMITS);
  expect(contract.canonicalization).toMatchObject({
    algorithm: 'mission28_sorted_json_v1',
    namespace: 'mission28.policy.version.v1\n',
    encoding: 'UTF-8',
    digestAlgorithm: 'SHA-256',
    digestFormat: 'sha256:lowercase_hex',
  });
  expect(contract.allowedPolicyCells.map(cell => cell.actionFamily)).toEqual(ALLOWED_ACTIONS);
  expect(contract.canonicalExamples).toHaveLength(2);
  validatePolicyVersion(contract.canonicalExamples[0], contract);
  validatePolicyVersion(contract.canonicalExamples[1], contract, contract.canonicalExamples[0]);
}

function redigest(policy, contract) {
  policy.canonicalDigest = digestPolicy(policy, contract);
  return policy;
}

describe('Mission 28 Part 2A canonical tenant-private automation policy', () => {
  test('binds exact released Part 1 inputs and the immutable source artifact', () => {
    const contract = parse(POLICY_PATH);
    validateContract(contract);
    expect(normalizedLfSha256(POLICY_PATH)).toBe(POLICY_SHA);
    expect(normalizedLfSha256(MATRIX_PATH)).toBe(MATRIX_SHA);
    for (const input of contract.frozenInputs) expect(normalizedLfSha256(input.path)).toBe(input.normalizedLfSha256);
  });

  test('derives every policy-definition cell from the exact conditional Part 1D matrix without widening it', () => {
    const contract = parse(POLICY_PATH);
    const matrix = parse(MATRIX_PATH);
    const conditional = matrix.launchCells.filter(cell => cell.firstLaunchState === 'conditional_first_launch_not_implemented');
    expect(conditional.map(cell => cell.actionFamily)).toEqual(ALLOWED_ACTIONS);
    for (const allowed of contract.allowedPolicyCells) {
      const cell = conditional.find(entry => entry.actionFamily === allowed.actionFamily);
      expect(allowed.sourceClassIds).toEqual(cell.sourceClassIds);
      expect(cell.capabilityIds).toContain(allowed.capabilityId);
      expect(allowed.riskClass).toBe(cell.riskClass);
      expect(allowed.recipientClassIds).toEqual(cell.recipientClassIds);
      expect(allowed.channelId).toBe('in_app_passive');
      expect(allowed.providerModes).toEqual(['none_internal', 'provider_disabled']);
    }
    expect(matrix.launchCells.filter(cell => cell.firstLaunchState === 'unavailable').map(cell => cell.actionFamily)).toEqual(UNAVAILABLE_ACTIONS);
    expect(matrix.launchCells.filter(cell => cell.firstLaunchState === 'deny_unsupported').map(cell => cell.actionFamily))
      .toEqual(['unsupported_upstream_mutation_or_money_movement']);
  });

  test('canonicalizes key order deterministically and binds every material field into the digest', () => {
    const contract = parse(POLICY_PATH);
    const original = contract.canonicalExamples[0];
    const reversed = Object.fromEntries(Object.entries(original).reverse());
    expect(digestPolicy(reversed, contract)).toBe(original.canonicalDigest);
    for (const key of POLICY_FIELDS.filter(key => key !== 'canonicalDigest')) {
      const mutation = clone(original);
      if (key === 'version') mutation.version = 2;
      else if (key === 'previousVersionDigest') mutation.previousVersionDigest = `sha256:${'a'.repeat(64)}`;
      else if (key === 'expiresAt') mutation.expiresAt = '2031-01-01T00:00:00Z';
      else if (key === 'rolloutState') mutation.rolloutState = 'enabled';
      else if (typeof mutation[key] === 'string') mutation[key] += '-changed';
      else mutation[key] = { changed: true };
      expect(digestPolicy(mutation, contract)).not.toBe(original.canonicalDigest);
    }
  });

  test('rejects semantic widening even when the attacker recomputes a well-formed digest', () => {
    const contract = parse(POLICY_PATH);
    const original = contract.canonicalExamples[0];
    const cases = [
      policy => { policy.tenantId = '00000000-0000-4000-8000-000000000099'; },
      policy => { policy.trigger.sourceClassId = 'unknown_source'; },
      policy => { policy.trigger.condition.operator = 'amount_greater_than'; },
      policy => { policy.trigger.condition.expected = false; },
      policy => { policy.action.familyId = 'customer_communication'; },
      policy => { policy.action.familyId = 'secure_document_delivery'; },
      policy => { policy.action.familyId = 'financial_reminder'; },
      policy => { policy.action.familyId = 'unsupported_upstream_mutation_or_money_movement'; },
      policy => { policy.action.capabilityId = 'automation_external_effect_execute'; },
      policy => { policy.action.riskClass = 'external_communication'; },
      policy => { policy.recipient.classId = 'customer'; },
      policy => { policy.recipient.classId = 'tenant_admin'; policy.action.familyId = 'collection_escalation'; policy.action.capabilityId = 'automation_collection_work_item_prepare'; policy.action.riskClass = 'collection_communication'; policy.trigger.sourceClassId = 'mission27_financial_collection'; },
      policy => { policy.channel.channelId = 'email'; },
      policy => { policy.channel.providerMode = 'sandbox'; },
      policy => { policy.schedule.mode = 'cron'; },
      policy => { policy.schedule.timeZone = 'America/New_York'; },
      policy => { policy.limits.maxSourceSnapshots = 2; },
      policy => { policy.limits.maxExternalRecipients = 1; },
      policy => { policy.limits.maxExternalMessages = 1; },
      policy => { policy.limits.maxProviderAttempts = 1; },
      policy => { policy.limits.maxUpstreamMutations = 1; },
      policy => { policy.limits.maxMoneyEffects = 1; },
      policy => { policy.approval.authorityGranted = true; },
      policy => { policy.approval.mode = 'none'; },
      policy => { policy.suppressions.pop(); },
      policy => { policy.suppressions.reverse(); },
      policy => { policy.expiresAt = '2030-01-01T00:00:00-05:00'; },
      policy => { policy.rolloutState = 'enabled'; },
    ];
    for (const alter of cases) {
      const mutation = clone(original);
      alter(mutation);
      redigest(mutation, contract);
      expect(() => validatePolicyVersion(mutation, contract)).toThrow();
    }
  });

  test('rejects broken append-only identity, predecessor, ordering and replay chains', () => {
    const contract = parse(POLICY_PATH);
    const [v1, v2] = contract.canonicalExamples;
    const cases = [
      policy => { policy.version = 1; },
      policy => { policy.version = 3; },
      policy => { policy.previousVersionDigest = null; },
      policy => { policy.previousVersionDigest = `sha256:${'0'.repeat(64)}`; },
      policy => { policy.policyId = '00000000-0000-4000-8000-00000000002b'; },
      policy => { policy.tenantId = '00000000-0000-4000-8000-000000000029'; },
    ];
    for (const alter of cases) {
      const mutation = clone(v2);
      alter(mutation);
      redigest(mutation, contract);
      expect(() => validatePolicyVersion(mutation, contract, v1)).toThrow();
    }
    expect(() => validatePolicyVersion(clone(v1), contract, v1)).toThrow();
  });

  test('rejects malformed, non-plain, aliased and structurally inexact policy data', () => {
    const contract = parse(POLICY_PATH);
    const original = contract.canonicalExamples[0];
    const mutations = [];
    for (const key of POLICY_FIELDS) {
      const missing = clone(original);
      delete missing[key];
      mutations.push(missing);
    }
    mutations.push({ ...clone(original), extra: true });
    const nestedExtra = clone(original); nestedExtra.action.extra = true; mutations.push(nestedExtra);
    const nestedMissing = clone(original); delete nestedMissing.trigger.condition.expected; mutations.push(nestedMissing);
    const sparse = clone(original); sparse.suppressions = new Array(SUPPRESSIONS.length); mutations.push(sparse);
    const symbol = clone(original); symbol[Symbol('hidden')] = true; mutations.push(symbol);
    const custom = clone(original); Object.setPrototypeOf(custom.action, { familyId: 'customer_communication' }); mutations.push(custom);
    const accessor = clone(original); Object.defineProperty(accessor.trigger, 'sourceClassId', { enumerable: true, get: () => 'mission23_work_execution' }); mutations.push(accessor);
    const toJson = clone(original); Object.defineProperty(toJson.action, 'toJSON', { enumerable: true, value: () => ({}) }); mutations.push(toJson);
    const alias = clone(original); alias.recipient = alias.action; mutations.push(alias);
    const fraction = clone(original); fraction.limits.maxActions = 0.5; mutations.push(fraction);
    const negativeZero = clone(original); negativeZero.limits.maxActions = -0; mutations.push(negativeZero);
    for (const mutation of mutations) expect(() => validatePolicyVersion(mutation, contract)).toThrow();
  });

  test('binds the narrative to identity, grammar, bounds, suppression, digest and unavailable runtime authority', () => {
    const narrative = read(CONTRACT_PATH);
    for (const value of [
      'stable identity', 'append-only versions', 'exact first-bound policy grammar',
      'evaluation-only with no scheduler', '`disabled_contract_only`',
      '`mission28_sorted_json_v1`', 'canonical digest', 'Part 2B', 'Part 2C',
      'Part 2D', 'no independent acceptance', 'founder visual approval',
    ]) expect(narrative.toLowerCase()).toContain(value.toLowerCase());
    for (const action of [...ALLOWED_ACTIONS, ...UNAVAILABLE_ACTIONS, 'unsupported_upstream_mutation_or_money_movement']) {
      expect(narrative).toContain(`\`${action}\``);
    }
  });

  test('records Parts 1A–5A released, Part 5B as the sole candidate, and every later slice planned', () => {
    const roadmap = read(ROADMAP_PATH);
    const ledger = read(LEDGER_PATH);
    expect(roadmap).toContain('Parts 1A–8C are released. Part 8D is the sole implementation candidate.');
    expect(roadmap).toContain('Parts 9A–14G remain planned and unimplemented.');
    for (const identity of [PART1D_HEAD, BASE, PART1D_DEPLOYMENT, PART1D_IMAGE]) {
      expect(roadmap).toContain(identity);
      expect(ledger).toContain(identity);
    }
    const rows = [...ledger.matchAll(/^\| (\d{2}) \| (\d{1,2}[A-G]) \| (.+) \| (.+) \| (.+) \|$/gm)];
    expect(rows).toHaveLength(66);
    expect(rows.slice(0, 4).every(row => row[4] === '**Released**')).toBe(true);
    expect(rows[3][5]).toContain('PR #552');
    expect(rows[4][4]).toBe('**Released**');
    expect(rows[4][5]).toContain('PR #553');
    expect(rows[5][4]).toBe('**Released**');
    expect(rows[5][5]).toContain('PR #554');
    expect(rows[6][4]).toBe('**Released**');
    expect(rows[6][5]).toContain('PR #555');
    expect(rows[7][4]).toBe('**Released**');
    expect(rows[7][5]).toContain('production migration 273');
    expect(rows[8][4]).toBe('**Released**');
    expect(rows[8][5]).toContain('PR #557');
    expect(rows[9][4]).toBe('**Released**');
    expect(rows[9][5]).toContain('PR #558');
    expect(rows[10][4]).toBe('**Released**');
    expect(rows[10][5]).toContain('PR #559');
    expect(rows[11][4]).toBe('**Released**');
    expect(rows[11][5]).toContain('PR #560');
    expect(rows[12][4]).toBe('**Released**');
    expect(rows[12][5]).toContain('PR #561');
    expect(rows[13][4]).toBe('**Released**');
    expect(rows[13][5]).toContain('PR #562');
    expect(rows[14][4]).toBe('**Released**');
    expect(rows[14][5]).toContain('PR #563');
    expect(rows[15][4]).toBe('**Released**');
    expect(rows[15][5]).toContain('PR #564');
    expect(rows[16][4]).toBe('**Released**');
    expect(rows[18][4]).toBe('**Released**');
    expect(rows[19][4]).toBe('**Released**');
    expect(rows[20][4]).toBe('**Released**');
    expect(rows[21][4]).toBe('**Released**');
    expect(rows[22][4]).toBe('**Released**');
    expect(rows[23][4]).toBe('**Released**');
    expect(rows[24][4]).toBe('**Released**');
    expect(rows[25][4]).toBe('**Released**');
    expect(rows[26][4]).toBe('**Released**');
    expect(rows[27][4]).toBe('**Released**');
    expect(rows[28][4]).toBe('**Released**');
    expect(rows[29][4]).toBe('**Released**'); expect(rows[30][4]).toBe('**Released**'); expect(rows[31][4]).toBe('**Released**');
    expect(rows[32][4]).toBe('**Released**');
    expect(rows[33][4]).toBe('**Released**');
    expect(rows[35][4]).toBe('**Implementation candidate**');
    expect(rows.slice(36).every(row => row[4] === 'Planned / unimplemented' && row[5] === 'None')).toBe(true);
    expect((ledger.match(/\*\*Implementation candidate\*\*/g) || [])).toHaveLength(1);
    expect((ledger.match(/Planned \/ unimplemented/g) || [])).toHaveLength(30);
  });

  test('does not activate policy runtime or add a schema migration', () => {
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
    expect(productionSource).not.toContain('MISSION_28_PART2A_CANONICAL_AUTOMATION_POLICY');
    expect(productionSource).not.toContain('mission28.part2a.canonical-automation-policy.v1');
    const migrations = fs.readdirSync(path.join(ROOT, 'migrations')).filter(name => name.endsWith('.sql'))
      .sort((left, right) => Number(left.split('_')[0]) - Number(right.split('_')[0]));
    expect(migrations).toHaveLength(283);
    expect(migrations.at(-1)).toBe('287_canonical_automation_estimate_quote_resolution_v1.sql');
    expect(migrations.some(name => name.startsWith('288_'))).toBe(false);
    expect(migrations.filter(name => /^273_/.test(name))).toEqual(['273_canonical_automation_authority_v1.sql']);
    expect(migrations.filter(name => /^278_/.test(name))).toEqual(['278_canonical_automation_retry_reconciliation_v1.sql']);
    expect(migrations.filter(name => /^279_/.test(name))).toEqual(['279_canonical_automation_delivery_controls_v1.sql']);
    expect(migrations.filter(name => /^274_/.test(name))).toEqual(['274_canonical_automation_trigger_snapshots_v1.sql']);
  });
});
