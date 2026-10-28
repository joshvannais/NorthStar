'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const MATRIX_PATH = 'docs/architecture/MISSION_28_PART1D_FIRST_LAUNCH_MATRIX.json';
const CONTRACT_PATH = 'docs/architecture/MISSION_28_PART1D_FIRST_LAUNCH_MATRIX.md';
const PART1A_PATH = 'docs/architecture/MISSION_28_PART1A_AUTHORITY_CONTRACT.md';
const INVENTORY_PATH = 'docs/architecture/MISSION_28_PART1B_SURFACE_INVENTORY.json';
const CATALOG_PATH = 'docs/architecture/MISSION_28_PART1C_ACTION_RISK_CATALOG.json';
const ROADMAP_PATH = 'docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md';
const LEDGER_PATH = 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md';

const BASE = 'eba50a7903ac0000a9eb663d52744cc760f3afd3';
const BASE_TREE = 'f923240512ae70a1029708ff9f9c9354a21d504b';
const PART1C_HEAD = '467668a9de408adb381ac91beb61cc73b01532ec';
const PART1C_DEPLOYMENT = 'fbca00f3-5806-46c3-981f-7120306a09ed';
const PART1C_IMAGE = 'ff3695a8ea06b5096d11487c21e7d349f5a686fba2f20e32818df11e62f75452';
const PART1A_SHA = '92DAD00F8A7623A87C780FC1AC965B66569616650F53FDED8454F51872458179';
const PART1B_SHA = '62E37CF07A26F0C2B1A50A2C2F0EB927695500DB32B44B16E5B431F594B93142';
const PART1C_SHA = '1CB5FF594AE7D1BEED313C1A94D7FE8200FB0024B36DF11B4C668F211481312B';
const MATRIX_SHA = '8CC5C4D62719EA6E6BCF9A340C5BE0593BE2F10CD60360D10562C4979D859B52';

const REQUIRED_DIMENSIONS = [
  'source_classes', 'action_families', 'roles_capabilities', 'channels',
  'recipient_classes', 'countries_regions', 'consent_bases', 'quiet_hours',
  'languages', 'providers_modes', 'limits', 'retention', 'legal_provider_review',
  'rollout_flags', 'demo_behavior', 'performance_bounds', 'unavailable_states',
  'migration_rules', 'audit_independence', 'release_sequence',
];

const SOURCE_IDS = [
  'mission20_business_contact_preferences',
  'mission21_knowledge_reference',
  'mission22_appointment_dispatch',
  'mission23_work_execution',
  'mission24_estimate_quote',
  'mission25_26_advisory',
  'mission27_financial_collection',
];

const SOURCE_OWNERS = [
  'Mission 20', 'Mission 21', 'Mission 22', 'Mission 23', 'Mission 24',
  'Missions 25 and 26', 'Mission 27',
];

const ACTION_IDS = [
  'internal_read_digest_task',
  'owner_approval_request',
  'customer_communication',
  'secure_document_delivery',
  'financial_reminder',
  'collection_escalation',
  'unsupported_upstream_mutation_or_money_movement',
];

const ACTION_OWNERS = [
  'Mission 28 tenant-private internal automation policy',
  'Mission 28 owner-control contract',
  'Mission 28 approved customer-communication policy',
  'Mission 28 approved document-delivery policy over upstream-owned documents',
  'Mission 28 approved reminder policy over Mission 27 financial facts',
  'Mission 28 human-controlled collection communication policy over Mission 27 reviewed handoff',
  'No Mission 28 owner',
];

const RISK_IDS = [
  'internal_sensitive', 'owner_attention', 'external_communication',
  'sensitive_document_delivery', 'financial_communication',
  'collection_communication', 'prohibited_mutation_or_money',
];

const CAPABILITY_IDS = [
  'automation_internal_action_view',
  'automation_internal_action_prepare',
  'automation_approval_request_create',
  'automation_approval_decide',
  'automation_collection_work_item_view',
  'automation_collection_work_item_prepare',
  'automation_external_effect_execute',
  'automation_upstream_or_money_mutate',
];

const CHANNEL_IDS = [
  'in_app_passive', 'native_manual_handoff', 'email', 'sms',
  'secure_link_delivery', 'provider_callback',
];

const RECIPIENT_IDS = [
  'tenant_owner', 'tenant_admin', 'assigned_staff', 'customer',
  'authorized_billing_contact', 'lead_or_prospect',
  'collection_agency_legal_credit_or_other_external',
];

const PROVIDER_MODE_IDS = ['none_internal', 'provider_disabled', 'sandbox', 'live'];

function json(relative) {
  return JSON.parse(read(relative));
}

function normalizedLfSha256(relative) {
  const normalized = read(relative).replace(/\r\n/g, '\n');
  if (normalized.includes('\r')) throw new Error('lone CR is not canonical');
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex').toUpperCase();
}

function exactKeys(value, expected) {
  expect(value).not.toBeNull();
  expect(Array.isArray(value)).toBe(false);
  expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  expect(Reflect.ownKeys(value)).toEqual(expected);
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    expect(descriptor).toMatchObject({ enumerable: true, configurable: true, writable: true });
    expect(Object.hasOwn(descriptor, 'value')).toBe(true);
  }
}

function assertJsonData(value, seen = new Set()) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return;
  expect(typeof value).toBe('object');
  expect(seen.has(value)).toBe(false);
  seen.add(value);
  if (Array.isArray(value)) {
    expect(Object.getPrototypeOf(value)).toBe(Array.prototype);
    expect(Object.keys(value)).toHaveLength(value.length);
    for (let index = 0; index < value.length; index += 1) {
      expect(Object.hasOwn(value, index)).toBe(true);
      assertJsonData(value[index], seen);
    }
  } else {
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    for (const key of Reflect.ownKeys(value)) {
      expect(typeof key).toBe('string');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      expect(Object.hasOwn(descriptor, 'value')).toBe(true);
      expect(descriptor.enumerable).toBe(true);
      assertJsonData(descriptor.value, seen);
    }
  }
  seen.delete(value);
}

function validateMatrix(matrix) {
  assertJsonData(matrix);
  exactKeys(matrix, [
    'contractVersion', 'authority', 'requiredDimensions', 'decisionStates',
    'sourceClasses', 'capabilities', 'roles', 'channels', 'recipientClasses',
    'countryRegionPolicy', 'consentBases', 'quietHours', 'languages',
    'providerModes', 'limits', 'retention', 'legalProviderReview', 'rolloutFlags',
    'demoBehavior', 'performanceBounds', 'unavailableStates', 'migrationRules',
    'auditIndependence', 'releaseSequence', 'launchCells', 'part1Exit',
    'unavailableEvidence',
  ]);
  expect(matrix.contractVersion).toBe('mission28.part1d.first-launch-matrix.v1');
  expect(matrix.requiredDimensions).toEqual(REQUIRED_DIMENSIONS);
  expect(matrix.decisionStates).toEqual([
    'conditional_first_launch_not_implemented', 'unavailable',
    'deny_invalid', 'deny_unsupported',
  ]);

  exactKeys(matrix.authority, [
    'mission', 'part', 'state', 'baselineCommit', 'baselineTree', 'part1C',
    'frozenInputs', 'runtimeImplemented', 'runtimeAuthorityGranted',
    'providerAuthorityGranted', 'externalEffectAuthorityGranted',
  ]);
  expect(matrix.authority).toMatchObject({
    mission: 28,
    part: '1D',
    state: 'implementation_candidate',
    baselineCommit: BASE,
    baselineTree: BASE_TREE,
    runtimeImplemented: false,
    runtimeAuthorityGranted: false,
    providerAuthorityGranted: false,
    externalEffectAuthorityGranted: false,
  });
  expect(matrix.authority.part1C).toEqual({
    sourceHead: PART1C_HEAD,
    pullRequest: 551,
    mergedMain: BASE,
    deployment: PART1C_DEPLOYMENT,
    deploymentState: 'SUCCESS_RUNNING',
    imageSha256: PART1C_IMAGE,
    auditVerdict: 'P0=P1=P2=P3=0',
    auditReportSha256: null,
  });
  expect(matrix.authority.frozenInputs).toEqual([
    { path: PART1A_PATH, normalizedLfSha256: PART1A_SHA },
    { path: INVENTORY_PATH, normalizedLfSha256: PART1B_SHA },
    { path: CATALOG_PATH, normalizedLfSha256: PART1C_SHA },
  ]);

  expect(matrix.sourceClasses.map(entry => entry.id)).toEqual(SOURCE_IDS);
  expect(matrix.sourceClasses.map(entry => entry.owner)).toEqual(SOURCE_OWNERS);
  expect(matrix.capabilities.map(entry => entry.id)).toEqual(CAPABILITY_IDS);
  expect(matrix.capabilities.slice(0, 6).every(entry => entry.firstLaunch)).toBe(true);
  expect(matrix.capabilities.slice(6).every(entry => !entry.firstLaunch)).toBe(true);
  expect(matrix.roles.map(entry => entry.id)).toEqual(['owner', 'admin', 'staff']);
  expect(matrix.roles[0].capabilityIds).toEqual(CAPABILITY_IDS.slice(0, 6));
  expect(matrix.roles[1].capabilityIds).toEqual(CAPABILITY_IDS.slice(0, 3));
  expect(matrix.roles[2].capabilityIds).toEqual(['automation_internal_action_view']);
  expect(matrix.channels.map(entry => entry.id)).toEqual(CHANNEL_IDS);
  expect(matrix.recipientClasses.map(entry => entry.id)).toEqual(RECIPIENT_IDS);
  expect(matrix.providerModes.map(entry => entry.id)).toEqual(PROVIDER_MODE_IDS);

  expect(matrix.countryRegionPolicy.externalAcceptedCountriesRegions).toEqual([]);
  expect(matrix.consentBases.externalAccepted).toEqual([]);
  expect(matrix.languages.internalInterface).toEqual(['en-US']);
  expect(matrix.languages.externalCustomerContent).toEqual([]);
  expect(matrix.providerModes[1].firstLaunchState).toBe('required_default');
  expect(matrix.rolloutFlags).toMatchObject({
    globalAutomationEnabled: false,
    tenantAutomationEnabled: false,
    externalEffectsEnabled: false,
    providerEffectsEnabled: false,
    moneyEffectsEnabled: false,
    default: 'fail_closed_disabled',
  });
  expect(matrix.demoBehavior).toMatchObject({
    paidDataAccess: false,
    realRecipientAccess: false,
    credentialAccess: false,
    providerCalls: 0,
    moneyEffects: 0,
    externalEffects: 0,
  });
  expect(matrix.limits).toEqual({
    maxTenantsPerActionUnit: 1,
    maxSourceSnapshotsPerActionUnit: 1,
    maxActionsPerEvaluation: 1,
    maxInternalRecipientsPerAction: 1,
    maxExternalRecipientsPerAction: 0,
    maxExternalMessagesPerAction: 0,
    maxProviderAttemptsPerAction: 0,
    maxRetriesPerAction: 0,
    maxUpstreamMutationsPerAction: 0,
    maxMoneyMovementsPerAction: 0,
    batchOrFanout: 'unavailable',
  });
  expect(matrix.performanceBounds).toMatchObject({
    maxSourceSnapshotsPerDecision: 1,
    maxActionUnitsPerDecision: 1,
    maxInternalRecipientsPerDecision: 1,
    maxExternalFanout: 0,
    maxProviderWork: 0,
    maxDecisionInputBytes: 65536,
    mountedLocalDecisionDeadlineMilliseconds: 2000,
    hostedProductionSla: 'unavailable',
  });
  expect(matrix.migrationRules).toMatchObject({
    part1DMigration: 'none',
    sourceMigrationCount: 268,
    latestSourceMigration: 272,
    migration273Present: false,
  });
  expect(matrix.auditIndependence).toEqual({
    writerEvidenceIndependent: false,
    requiredAudit: 'fresh_isolated_whole_exact_head',
    acceptedSeverityCountsRequired: 'P0=P1=P2=P3=0',
    sameWriterCorrections: true,
    sameAuditorReauditRequired: true,
  });

  expect(matrix.launchCells.map(cell => cell.actionFamily)).toEqual(ACTION_IDS);
  expect(matrix.launchCells.map(cell => cell.owner)).toEqual(ACTION_OWNERS);
  expect(matrix.launchCells.map(cell => cell.riskClass)).toEqual(RISK_IDS);
  expect(matrix.launchCells.map(cell => cell.firstLaunchState)).toEqual([
    'conditional_first_launch_not_implemented',
    'conditional_first_launch_not_implemented',
    'unavailable', 'unavailable', 'unavailable',
    'conditional_first_launch_not_implemented',
    'deny_unsupported',
  ]);
  for (const cell of matrix.launchCells) {
    exactKeys(cell, [
      'actionFamily', 'owner', 'riskClass', 'firstLaunchState', 'sourceClassIds',
      'roleIds', 'capabilityIds', 'channelIds', 'recipientClassIds',
      'providerModeIds', 'allowedBindings', 'boundary',
    ]);
    expect(cell.sourceClassIds.every(id => SOURCE_IDS.includes(id))).toBe(true);
    expect(cell.roleIds.every(id => ['owner', 'admin', 'staff'].includes(id))).toBe(true);
    expect(cell.capabilityIds.every(id => CAPABILITY_IDS.includes(id))).toBe(true);
    expect(cell.channelIds.every(id => CHANNEL_IDS.includes(id))).toBe(true);
    expect(cell.recipientClassIds.every(id => RECIPIENT_IDS.includes(id))).toBe(true);
    expect(cell.providerModeIds.every(id => PROVIDER_MODE_IDS.includes(id))).toBe(true);
    for (const binding of cell.allowedBindings) {
      expect(binding).toEqual({
        roleId: binding.roleId,
        capabilityId: binding.capabilityId,
        recipientClassId: binding.recipientClassId,
      });
      expect(cell.roleIds).toContain(binding.roleId);
      expect(cell.capabilityIds).toContain(binding.capabilityId);
      expect(cell.recipientClassIds).toContain(binding.recipientClassId);
      const role = matrix.roles.find(candidate => candidate.id === binding.roleId);
      expect(role.capabilityIds).toContain(binding.capabilityId);
    }
    expect(cell.boundary.length).toBeGreaterThan(100);
  }
  for (const cell of matrix.launchCells.slice(2, 5)) {
    expect(cell.sourceClassIds).toEqual([]);
    expect(cell.roleIds).toEqual([]);
    expect(cell.capabilityIds).toEqual([]);
    expect(cell.channelIds).toEqual([]);
    expect(cell.recipientClassIds).toEqual([]);
    expect(cell.providerModeIds).toEqual(['provider_disabled']);
    expect(cell.allowedBindings).toEqual([]);
  }
  const unsupported = matrix.launchCells[6];
  expect(unsupported.sourceClassIds).toEqual([]);
  expect(unsupported.roleIds).toEqual([]);
  expect(unsupported.capabilityIds).toEqual([]);
  expect(unsupported.channelIds).toEqual([]);
  expect(unsupported.recipientClassIds).toEqual([]);
  expect(unsupported.providerModeIds).toEqual(['provider_disabled']);
  expect(unsupported.allowedBindings).toEqual([]);

  expect(matrix.part1Exit).toEqual({
    inventorySurfaceCount: 49,
    inventorySourceReferenceCount: 181,
    inventoryDispositionCount: 6,
    actionFamilyCount: 7,
    firstLaunchConditionalActionFamilies: [
      'internal_read_digest_task', 'owner_approval_request', 'collection_escalation',
    ],
    unavailableFirstLaunchActionFamilies: [
      'customer_communication', 'secure_document_delivery', 'financial_reminder',
    ],
    unsupportedActionFamilies: ['unsupported_upstream_mutation_or_money_movement'],
    part1CUnsupportedCombinationCount: 16,
    state: 'candidate_pending_independent_acceptance',
  });
  expect(matrix.unavailableStates).toHaveLength(13);
  expect(new Set(matrix.unavailableStates).size).toBe(13);
  expect(matrix.releaseSequence).toHaveLength(7);
  expect(matrix.unavailableEvidence).toHaveLength(5);
}

function evaluate(matrix, input) {
  const keys = [
    'actionFamily', 'sourceClass', 'role', 'capability', 'channel', 'recipientClass',
    'providerMode', 'tenantMatch', 'sourceCurrent', 'authorityCurrent',
    'retentionGateSatisfied', 'professionalReviewSatisfied', 'withinLimits',
    'runtimeExecutionRequested', 'externalEffectRequested',
    'upstreamMutationRequested', 'moneyMovementRequested',
  ];
  if (input === null || typeof input !== 'object' || Array.isArray(input) ||
      Object.getPrototypeOf(input) !== Object.prototype ||
      Reflect.ownKeys(input).length !== keys.length ||
      !keys.every(key => Object.hasOwn(input, key))) return 'deny_invalid';
  const cell = matrix.launchCells.find(candidate => candidate.actionFamily === input.actionFamily);
  if (!cell) return 'deny_invalid';
  if (cell.firstLaunchState === 'deny_unsupported' || input.runtimeExecutionRequested ||
      input.externalEffectRequested || input.upstreamMutationRequested || input.moneyMovementRequested) {
    return 'deny_unsupported';
  }
  if (cell.firstLaunchState === 'unavailable') return 'unavailable';
  if (!cell.sourceClassIds.includes(input.sourceClass) || !cell.roleIds.includes(input.role) ||
      !cell.capabilityIds.includes(input.capability) || !cell.channelIds.includes(input.channel) ||
      !cell.recipientClassIds.includes(input.recipientClass) ||
      !cell.providerModeIds.includes(input.providerMode)) return 'deny_invalid';
  const role = matrix.roles.find(candidate => candidate.id === input.role);
  if (!role || !role.capabilityIds.includes(input.capability)) return 'deny_invalid';
  if (!cell.allowedBindings.some(binding => binding.roleId === input.role &&
      binding.capabilityId === input.capability &&
      binding.recipientClassId === input.recipientClass)) return 'deny_invalid';
  if (!input.tenantMatch || !input.sourceCurrent || !input.authorityCurrent ||
      !input.retentionGateSatisfied || !input.professionalReviewSatisfied || !input.withinLimits) {
    return 'unavailable';
  }
  return 'conditional_first_launch_not_implemented';
}

function internalInput(overrides = {}) {
  return {
    actionFamily: 'internal_read_digest_task',
    sourceClass: 'mission20_business_contact_preferences',
    role: 'owner',
    capability: 'automation_internal_action_prepare',
    channel: 'in_app_passive',
    recipientClass: 'tenant_owner',
    providerMode: 'provider_disabled',
    tenantMatch: true,
    sourceCurrent: true,
    authorityCurrent: true,
    retentionGateSatisfied: true,
    professionalReviewSatisfied: true,
    withinLimits: true,
    runtimeExecutionRequested: false,
    externalEffectRequested: false,
    upstreamMutationRequested: false,
    moneyMovementRequested: false,
    ...overrides,
  };
}

describe('Mission 28 Part 1D first-supported launch matrix', () => {
  test('freezes exact released inputs, all required dimensions and no runtime/provider/effect authority', () => {
    const matrix = json(MATRIX_PATH);
    validateMatrix(matrix);
    expect(normalizedLfSha256(MATRIX_PATH)).toBe(MATRIX_SHA);
    for (const input of matrix.authority.frozenInputs) {
      expect(normalizedLfSha256(input.path)).toBe(input.normalizedLfSha256);
    }
    expect(matrix.requiredDimensions).toEqual(REQUIRED_DIMENSIONS);
  });

  test('binds the exact frozen Part 1D source sentence and every narrative dimension', () => {
    const roadmap = read(ROADMAP_PATH);
    const contract = read(CONTRACT_PATH);
    expect(roadmap).toContain('| D | Freeze the first-supported launch matrix and acceptance ledger: source classes, action families, roles/capabilities, channels, recipient classes, countries/regions, consent bases, quiet hours, languages, providers/modes, limits, retention, legal/provider review, rollout flags, demo behavior, performance bounds, unavailable states, migration rules, audit independence, and release sequence. |');
    for (const action of ACTION_IDS) expect(contract).toContain(`\`${action}\``);
    for (const risk of RISK_IDS) expect(contract).toContain(`\`${risk}\``);
    for (const dimension of [
      'Source', 'role', 'channel', 'recipient', 'region', 'consent', 'quiet',
      'language', 'Provider', 'limits', 'retention', 'flags', 'demo',
      'performance', 'Unavailable', 'migration', 'Audit', 'release sequence',
    ]) expect(contract.toLowerCase()).toContain(dimension.toLowerCase());
  });

  test('satisfies the Part 1 exit inventory, owner/risk and contradiction boundaries', () => {
    const matrix = json(MATRIX_PATH);
    const inventory = json(INVENTORY_PATH);
    const catalog = json(CATALOG_PATH);
    expect(inventory.surfaces).toHaveLength(matrix.part1Exit.inventorySurfaceCount);
    expect(inventory.surfaces.flatMap(surface => surface.sourceRefs))
      .toHaveLength(matrix.part1Exit.inventorySourceReferenceCount);
    expect(inventory.dispositions).toHaveLength(matrix.part1Exit.inventoryDispositionCount);
    expect(new Set(inventory.surfaces.map(surface => surface.disposition)))
      .toEqual(new Set(inventory.dispositions));
    expect(catalog.actionFamilies.map(entry => [entry.id, entry.owner, entry.riskClass]))
      .toEqual(matrix.launchCells.map(entry => [entry.actionFamily, entry.owner, entry.riskClass]));
    expect(catalog.unsupportedCombinations)
      .toHaveLength(matrix.part1Exit.part1CUnsupportedCombinationCount);
    expect(matrix.launchCells.every(cell => cell.firstLaunchState !== 'allow')).toBe(true);
  });

  test('returns only conditional-not-implemented or denials and never runtime permission', () => {
    const matrix = json(MATRIX_PATH);
    expect(evaluate(matrix, internalInput())).toBe('conditional_first_launch_not_implemented');
    const approval = internalInput({
      actionFamily: 'owner_approval_request',
      capability: 'automation_approval_decide',
    });
    expect(evaluate(matrix, approval)).toBe('conditional_first_launch_not_implemented');
    const collection = internalInput({
      actionFamily: 'collection_escalation',
      sourceClass: 'mission27_financial_collection',
      capability: 'automation_collection_work_item_prepare',
    });
    expect(evaluate(matrix, collection)).toBe('conditional_first_launch_not_implemented');
    for (const actionFamily of ACTION_IDS.slice(2, 5)) {
      expect(evaluate(matrix, internalInput({ actionFamily }))).toBe('unavailable');
    }
    expect(evaluate(matrix, internalInput({
      actionFamily: 'unsupported_upstream_mutation_or_money_movement',
    }))).toBe('deny_unsupported');
  });

  test('fails identity, capability, source, retention, review, limits and every effect request closed', () => {
    const matrix = json(MATRIX_PATH);
    const cases = [
      [{ actionFamily: 'unknown' }, 'deny_invalid'],
      [{ sourceClass: 'unknown' }, 'deny_invalid'],
      [{ role: 'staff', capability: 'automation_internal_action_prepare' }, 'deny_invalid'],
      [{ capability: 'automation_external_effect_execute' }, 'deny_invalid'],
      [{ channel: 'email' }, 'deny_invalid'],
      [{ recipientClass: 'customer' }, 'deny_invalid'],
      [{ providerMode: 'sandbox' }, 'deny_invalid'],
      [{ tenantMatch: false }, 'unavailable'],
      [{ sourceCurrent: false }, 'unavailable'],
      [{ authorityCurrent: false }, 'unavailable'],
      [{ retentionGateSatisfied: false }, 'unavailable'],
      [{ professionalReviewSatisfied: false }, 'unavailable'],
      [{ withinLimits: false }, 'unavailable'],
      [{ runtimeExecutionRequested: true }, 'deny_unsupported'],
      [{ externalEffectRequested: true }, 'deny_unsupported'],
      [{ upstreamMutationRequested: true }, 'deny_unsupported'],
      [{ moneyMovementRequested: true }, 'deny_unsupported'],
    ];
    for (const [mutation, expected] of cases) {
      expect(evaluate(matrix, internalInput(mutation))).toBe(expected);
    }
    expect(evaluate(matrix, { ...internalInput(), extra: true })).toBe('deny_invalid');
    expect(evaluate(matrix, null)).toBe('deny_invalid');
  });

  test('rejects deletions, reorder, authority widening, provider enablement and optimistic release drift', () => {
    const original = json(MATRIX_PATH);
    const mutations = [];
    const mutate = callback => {
      const value = structuredClone(original);
      callback(value);
      mutations.push(value);
    };
    mutate(value => value.requiredDimensions.pop());
    mutate(value => value.sourceClasses.reverse());
    mutate(value => value.capabilities[6].firstLaunch = true);
    mutate(value => value.roles[2].capabilityIds.push('automation_internal_action_prepare'));
    mutate(value => { value.channels[2].firstLaunchState = 'conditional'; });
    mutate(value => { value.recipientClasses[3].firstLaunchState = 'conditional_internal'; });
    mutate(value => value.countryRegionPolicy.externalAcceptedCountriesRegions.push('US'));
    mutate(value => value.consentBases.externalAccepted.push('invented'));
    mutate(value => value.languages.externalCustomerContent.push('en-US'));
    mutate(value => { value.providerModes[2].firstLaunchState = 'conditional'; });
    mutate(value => { value.limits.maxExternalMessagesPerAction = 1; });
    mutate(value => { value.rolloutFlags.externalEffectsEnabled = true; });
    mutate(value => { value.demoBehavior.providerCalls = 1; });
    mutate(value => { value.migrationRules.migration273Present = true; });
    mutate(value => { value.auditIndependence.writerEvidenceIndependent = true; });
    mutate(value => { value.launchCells[2].firstLaunchState = 'conditional_first_launch_not_implemented'; });
    mutate(value => { value.launchCells[6].firstLaunchState = 'unavailable'; });
    mutate(value => value.launchCells.shift());
    mutate(value => { value.authority.runtimeAuthorityGranted = true; });
    mutate(value => { value.part1Exit.state = 'accepted'; });
    mutate(value => { value.extra = true; });
    for (const mutation of mutations) expect(() => validateMatrix(mutation)).toThrow();
  });

  test('records Parts 1A–5A released, only Part 5B current and every later slice planned', () => {
    const roadmap = read(ROADMAP_PATH);
    const ledger = read(LEDGER_PATH);
    expect(roadmap).toContain('Parts 1A–8A are released. Part 8B is the sole implementation candidate.');
    expect(roadmap).toContain('Parts 8C–14G remain planned and unimplemented.');
    for (const identity of [PART1C_HEAD, BASE, PART1C_DEPLOYMENT, PART1C_IMAGE]) {
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
    expect(rows[33][4]).toBe('**Implementation candidate**');
    expect(rows.slice(34).every(row => row[4] === 'Planned / unimplemented' && row[5] === 'None')).toBe(true);
    expect((ledger.match(/\*\*Implementation candidate\*\*/g) || [])).toHaveLength(1);
    expect((ledger.match(/Planned \/ unimplemented/g) || [])).toHaveLength(32);
    expect(ledger).toContain('independent audit/PR/merge/deployment unavailable');
  });

  test('adds no runtime activation or migration and keeps all unavailable evidence unclaimed', () => {
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
    expect(productionSource).not.toContain('MISSION_28_PART1D_FIRST_LAUNCH_MATRIX');
    expect(productionSource).not.toContain('mission28.part1d.first-launch-matrix.v1');
    const migrations = fs.readdirSync(path.join(ROOT, 'migrations')).filter(name => name.endsWith('.sql'))
      .sort((left, right) => Number(left.split('_')[0]) - Number(right.split('_')[0]));
    expect(migrations).toHaveLength(283);
    expect(migrations.at(-1)).toBe('287_canonical_automation_estimate_quote_resolution_v1.sql');
    expect(migrations.some(name => name.startsWith('288_'))).toBe(false);
    expect(migrations.filter(name => /^273_/.test(name))).toEqual(['273_canonical_automation_authority_v1.sql']);
    expect(migrations.filter(name => /^278_/.test(name))).toEqual(['278_canonical_automation_retry_reconciliation_v1.sql']);
    expect(migrations.filter(name => /^279_/.test(name))).toEqual(['279_canonical_automation_delivery_controls_v1.sql']);
    expect(migrations.filter(name => /^274_/.test(name))).toEqual(['274_canonical_automation_trigger_snapshots_v1.sql']);
    const documents = `${read(CONTRACT_PATH)}\n${read(LEDGER_PATH)}`.toLowerCase();
    for (const boundary of [
      'professional legal', 'provider accounts', 'real recipients', 'live money',
      'hosted load/sla', 'physical safari/devices', 'manual assistive-technology',
      'founder visual approval',
    ]) expect(documents).toContain(boundary);
  });
});
