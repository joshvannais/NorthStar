'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const parse = relative => JSON.parse(read(relative));
const clone = value => JSON.parse(JSON.stringify(value));

const MODEL_PATH = 'docs/architecture/MISSION_28_PART3A_FIXED_CAPABILITY_MATRIX.json';
const NARRATIVE_PATH = 'docs/architecture/MISSION_28_PART3A_FIXED_CAPABILITY_MATRIX.md';
const ROADMAP_PATH = 'docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md';
const LEDGER_PATH = 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md';
const BASE = '529286cf2d513df93680e2c236e37f562782cb52';
const BASE_TREE = 'cb2f7072f475e927f75ee3b562884adf01234d70';

const INPUT_HASHES = Object.freeze({
  'docs/architecture/MISSION_28_PART1A_AUTHORITY_CONTRACT.md': '92DAD00F8A7623A87C780FC1AC965B66569616650F53FDED8454F51872458179',
  'docs/architecture/MISSION_28_PART1B_SURFACE_INVENTORY.json': '62E37CF07A26F0C2B1A50A2C2F0EB927695500DB32B44B16E5B431F594B93142',
  'docs/architecture/MISSION_28_PART1C_ACTION_RISK_CATALOG.json': '1CB5FF594AE7D1BEED313C1A94D7FE8200FB0024B36DF11B4C668F211481312B',
  'docs/architecture/MISSION_28_PART1D_FIRST_LAUNCH_MATRIX.json': '8CC5C4D62719EA6E6BCF9A340C5BE0593BE2F10CD60360D10562C4979D859B52',
  'docs/architecture/MISSION_28_PART2A_CANONICAL_AUTOMATION_POLICY.json': 'B8BC22AE758E2AD0C2D037963709A947FE0564AF4319DED571F7ABD273D6A4E8',
  'docs/architecture/MISSION_28_PART2B_IMMUTABLE_RECORD_MODEL.json': '3C64287BA287567ADD0E0962A3ED45B90657CA97686435E1D616FFF2F88293B5',
  'docs/architecture/MISSION_28_PART2C_POLICY_LIFECYCLE.json': '91008C2B04D2492F8067F0F31DAB8E4902FA06FEA6A781CB46B4C836453FFACD',
  'docs/architecture/MISSION_28_PART2D_POSTGRES_AUTHORITY.json': '03F32F3C66EF525DF9ACA541F8A7D0C08935E1DD2EDB661468F78CC2A763308A',
});

const EXPECTED_CAPABILITIES = Object.freeze([
  ['automation_view', 'view_automation', 'tenant_private_read', false, [
    ['owner', 'exact_tenant_all_automation'],
    ['admin', 'exact_tenant_all_automation'],
    ['member', 'exact_assigned_internal_records_only'],
  ]],
  ['automation_policy_draft', 'draft_policy', 'no_authority_draft', false, [
    ['owner', 'exact_tenant_policy_drafts'], ['admin', 'exact_tenant_policy_drafts'],
  ]],
  ['automation_run_approve', 'approve_run', 'consequential_per_run_authority', true, [
    ['owner', 'one_exact_tenant_run_preview'],
  ]],
  ['automation_standing_authority_activate', 'activate_standing_authority', 'consequential_standing_authority', true, [
    ['owner', 'one_exact_tenant_policy_version'],
  ]],
  ['automation_standing_authority_change', 'change_standing_authority', 'consequential_standing_authority', true, [
    ['owner', 'one_exact_tenant_policy_version_transition'],
  ]],
  ['automation_pause', 'pause_automation', 'authority_reducing_control', false, [
    ['owner', 'exact_tenant_or_exact_policy_scope'], ['admin', 'exact_tenant_or_exact_policy_scope'],
  ]],
  ['automation_retry_reviewed', 'retry_action', 'duplicate_effect_risk', true, [
    ['owner', 'one_exact_failed_or_reconciled_action_unit'],
  ]],
  ['automation_evidence_export', 'export_evidence', 'tenant_private_sensitive_export', true, [
    ['owner', 'exact_tenant_minimized_evidence'], ['admin', 'exact_tenant_minimized_evidence'],
  ]],
  ['automation_channel_availability_manage', 'manage_channel_availability', 'provider_and_sender_boundary', true, [
    ['owner', 'exact_tenant_channel_availability'],
  ]],
  ['automation_tenant_stop_operate', 'operate_tenant_wide_stop', 'tenant_wide_fail_safe_control', false, [
    ['owner', 'exact_tenant_global_stop'], ['admin', 'exact_tenant_global_stop'],
  ]],
]);

const PROFILE_CAPABILITIES = Object.freeze({
  owner: EXPECTED_CAPABILITIES.map(([id]) => id),
  admin: [
    'automation_view', 'automation_policy_draft', 'automation_pause',
    'automation_evidence_export', 'automation_tenant_stop_operate',
  ],
  member: ['automation_view'],
  viewer: [],
});

const PART1D_IDS = Object.freeze([
  'automation_internal_action_view', 'automation_internal_action_prepare',
  'automation_approval_request_create', 'automation_approval_decide',
  'automation_collection_work_item_view', 'automation_collection_work_item_prepare',
  'automation_external_effect_execute', 'automation_upstream_or_money_mutate',
]);

function normalizedLfSha256(relative) {
  const normalized = read(relative).replace(/\r\n/g, '\n');
  if (normalized.includes('\r')) throw new Error(`lone CR denied: ${relative}`);
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex').toUpperCase();
}

function expectExactKeys(value, keys, label) {
  expect(value).not.toBeNull();
  expect(Array.isArray(value)).toBe(false);
  expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  expect(Object.keys(value)).toEqual(keys);
  for (const key of keys) expect(Object.prototype.hasOwnProperty.call(value, key)).toBe(true);
  return value;
}

function expectPlainData(value, label = 'root') {
  if (value === null || ['string', 'boolean', 'number'].includes(typeof value)) return;
  expect(typeof value).toBe('object');
  if (Array.isArray(value)) {
    expect(Object.keys(value)).toEqual(value.map((_, index) => String(index)));
    value.forEach((item, index) => expectPlainData(item, `${label}[${index}]`));
    return;
  }
  expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  expect(Reflect.ownKeys(value)).toEqual(Object.keys(value));
  for (const [key, item] of Object.entries(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    expect(descriptor).toMatchObject({ enumerable: true, configurable: true, writable: true });
    expect(Object.prototype.hasOwnProperty.call(descriptor, 'value')).toBe(true);
    expectPlainData(item, `${label}.${key}`);
  }
}

function validateMatrix(model) {
  expectPlainData(model);
  expectExactKeys(model, [
    'contractVersion', 'authority', 'part2DRelease', 'frozenInputs', 'membershipVocabulary',
    'decisionStates', 'capabilities', 'membershipProfiles', 'subjectContract',
    'part1DCapabilityDisposition', 'deniedCombinations', 'runtimeBoundary', 'unavailableEvidence',
  ], 'matrix');
  expect(model.contractVersion).toBe('mission28.part3a.fixed-capability-matrix.v1');

  expectExactKeys(model.authority, [
    'mission', 'part', 'state', 'baselineCommit', 'baselineTree',
    'runtimeCapabilityResolutionImplemented', 'routeOrUiAuthorityGranted',
    'policyApprovalOrActivationAuthorityGranted', 'schedulerWorkerOrRetryAuthorityGranted',
    'providerAuthorityGranted', 'externalEffectAuthorityGranted',
    'upstreamMutationAuthorityGranted', 'moneyAuthorityGranted',
  ], 'authority');
  expect(model.authority).toEqual({
    mission: 28, part: '3A', state: 'implementation_candidate_only',
    baselineCommit: BASE, baselineTree: BASE_TREE,
    runtimeCapabilityResolutionImplemented: false, routeOrUiAuthorityGranted: false,
    policyApprovalOrActivationAuthorityGranted: false, schedulerWorkerOrRetryAuthorityGranted: false,
    providerAuthorityGranted: false, externalEffectAuthorityGranted: false,
    upstreamMutationAuthorityGranted: false, moneyAuthorityGranted: false,
  });

  expect(model.part2DRelease).toEqual({
    acceptedSourceHead: '98c4b3562ad48787472584ca64c601d584c2427f', acceptedTree: BASE_TREE,
    pullRequest: 556, mergedMain: BASE, deployment: 'f40e401a-649f-42b3-a1cc-71dbd0ffce4d',
    deploymentState: 'SUCCESS_RUNNING',
    imageSha256: '586afe8103acc0e4f27d5967e8a8554876d7f5f51dc38bd7c7f4a98e2c320337',
    auditVerdict: 'P0=P1=P2=P3=0', auditReportSha256: null,
    health: [
      'startup_ready', 'migrations_269_of_269_latest_273_no_274', 'authority_objects_present',
      'legacy_conversion_rows_zero', 'health_200', 'root_200', 'demo_200',
    ],
  });

  expect(model.frozenInputs).toHaveLength(8);
  expect(model.frozenInputs.map(item => item.path)).toEqual(Object.keys(INPUT_HASHES));
  for (const input of model.frozenInputs) {
    expectExactKeys(input, ['path', 'normalizedLfSha256'], 'frozen input');
    expect(input.normalizedLfSha256).toBe(INPUT_HASHES[input.path]);
    expect(normalizedLfSha256(input.path)).toBe(input.normalizedLfSha256);
  }

  expect(model.membershipVocabulary).toEqual({
    sourcePath: 'src/auth/permissions.js',
    normalizedLfSha256: '4FD11A90AC6EE584614535580ED45C6AAE2A23B73547CE62D28A73BB11C40D42',
    canonicalMembershipRoleIds: ['owner', 'admin', 'member', 'viewer'],
    exactActiveTenantMembershipRequired: true, exactAuthenticatedSessionRequired: true,
    displayRoleNameAuthority: 'deny', operationalRoleTitleAuthority: 'deny',
    jobTitleTeamTitleLabelOrAliasAuthority: 'deny', roleCaseFoldingOrFuzzyAlias: 'deny',
    customRolesOrEnterpriseAdministration: 'Mission29_only',
  });
  expect(normalizedLfSha256(model.membershipVocabulary.sourcePath)).toBe(model.membershipVocabulary.normalizedLfSha256);
  expect(model.decisionStates).toEqual([
    'eligible_contract_only_no_runtime_authority', 'deny_missing_or_invalid_actor_authority',
    'deny_recent_authentication_required', 'deny_capability_not_assigned',
    'deny_scope_mismatch', 'deny_unsupported_operation',
  ]);

  expect(model.capabilities).toHaveLength(EXPECTED_CAPABILITIES.length);
  expect(new Set(model.capabilities.map(capability => capability.id)).size).toBe(EXPECTED_CAPABILITIES.length);
  for (const [index, expected] of EXPECTED_CAPABILITIES.entries()) {
    const capability = model.capabilities[index];
    expectExactKeys(capability, [
      'id', 'operation', 'consequenceClass', 'grants', 'requiresRecentAuthentication',
      'deferredRequirements', 'boundary',
    ], `capability ${index}`);
    expect(capability.id).toBe(expected[0]);
    expect(capability.operation).toBe(expected[1]);
    expect(capability.consequenceClass).toBe(expected[2]);
    expect(capability.requiresRecentAuthentication).toBe(expected[3]);
    expect(capability.grants.map(grant => [grant.membershipRoleId, grant.recordScope])).toEqual(expected[4]);
    capability.grants.forEach(grant => expectExactKeys(grant, ['membershipRoleId', 'recordScope'], 'grant'));
    expect(capability.deferredRequirements.length).toBeGreaterThan(0);
    expect(capability.boundary.length).toBeGreaterThan(30);
  }

  expect(model.membershipProfiles.map(profile => profile.membershipRoleId)).toEqual(['owner', 'admin', 'member', 'viewer']);
  for (const profile of model.membershipProfiles) {
    expectExactKeys(profile, ['membershipRoleId', 'capabilityIds', 'boundary'], 'membership profile');
    expect(profile.capabilityIds).toEqual(PROFILE_CAPABILITIES[profile.membershipRoleId]);
    const fromGrants = model.capabilities
      .filter(capability => capability.grants.some(grant => grant.membershipRoleId === profile.membershipRoleId))
      .map(capability => capability.id);
    expect(profile.capabilityIds).toEqual(fromGrants);
  }

  expect(model.subjectContract).toEqual({
    requiredInputs: [
      'tenantId', 'actorId', 'actorTenantId', 'sessionId', 'sessionSubjectActorId',
      'sessionTenantId', 'membershipId', 'membershipSubjectActorId',
      'membershipTenantId', 'membershipRoleId', 'membershipStatus',
      'recentAuthenticationState', 'capabilityId', 'operation', 'recordScope', 'recordTenantId',
    ],
    opaqueIdentityInputs: [
      'tenantId', 'actorId', 'actorTenantId', 'sessionId', 'sessionSubjectActorId',
      'sessionTenantId', 'membershipId', 'membershipSubjectActorId', 'membershipTenantId',
      'recordTenantId',
    ],
    opaqueIdentifierPattern: '^[A-Za-z0-9][A-Za-z0-9._:@|/-]{0,255}$',
    membershipStatus: 'active', allTenantIdentitiesMustMatchExactly: true,
    actorIdMustEqualSessionSubjectAndMembershipSubjectExactly: true,
    actorAndSessionMustResolveFromServerAuthority: true,
    membershipMustBeRereadFromServerAuthorityAtDecision: true,
    operationAndRecordScopeMustResolveFromServerAuthority: true,
    recentAuthenticationRequirementMustMatchMatrix: true,
    capabilityAndOperationMustMatchOneExactMatrixRow: true,
    recordScopeMustMatchOneExactGrant: true,
    missingStaleSuspendedCrossTenantUnknownOrAmbiguous: 'deny',
    sameTenantCrossActorSessionOrMembershipSubstitution: 'deny',
    emptyWhitespaceControlNonCanonicalOrOversizedOpaqueIdentifier: 'deny',
    displayOrOperationalRoleFieldsAcceptedAsAuthority: false,
    wildcardPrefixSuffixCaseFoldedOrFuzzyCapability: 'deny',
    capabilityDelegationInheritanceChainingOrImpersonation: 'deny',
    capabilityAloneCreatesApprovalActivationRetryProviderOrEffect: false,
  });

  expect(model.part1DCapabilityDisposition.map(item => item.id)).toEqual(PART1D_IDS);
  expect(model.part1DCapabilityDisposition.slice(0, 6).every(item => item.state === 'preserved_released_no_implicit_part3a_alias')).toBe(true);
  expect(model.part1DCapabilityDisposition[6].state).toBe('unavailable_no_assignment');
  expect(model.part1DCapabilityDisposition[7].state).toBe('permanently_denied_no_assignment');
  expect(model.deniedCombinations).toHaveLength(14);
  expect(model.deniedCombinations).toEqual(expect.arrayContaining([
    'display_role_operational_role_job_title_team_title_label_or_alias_used_as_authority',
    'same_tenant_cross_actor_session_or_membership_subject_substitution',
    'empty_whitespace_control_noncanonical_or_oversized_opaque_identity',
    'cross_tenant_actor_session_membership_policy_record_or_capability_scope',
    'admin_approves_run_activates_or_changes_standing_authority_retries_or_manages_channel_authority',
    'provider_external_recipient_message_upstream_accounting_legal_or_money_authority',
  ]));
  expect(model.runtimeBoundary).toEqual({
    matrixIsExecutableRuntime: false, runtimeResolverAvailable: false,
    routeUiWorkerSchedulerQueueProviderOrExportAvailable: false,
    databaseCapabilityGrantAdded: false, migrationAdded: false,
    laterSlicesMayOnlyConsumeAfterIndependentAcceptance: true,
    allEligibleResults: 'eligible_contract_only_no_runtime_authority',
  });
  expect(model.unavailableEvidence).toHaveLength(8);
  expect(model.unavailableEvidence.join(' ')).toMatch(/legal privacy consent/);
  expect(model.unavailableEvidence.join(' ')).toMatch(/founder visual approval/);
}

function evaluateRequest(model, request) {
  validateMatrix(model);
  const required = model.subjectContract.requiredInputs;
  if (required.some(key => !Object.prototype.hasOwnProperty.call(request, key))) {
    return 'deny_missing_or_invalid_actor_authority';
  }
  const opaquePattern = new RegExp(model.subjectContract.opaqueIdentifierPattern);
  if (model.subjectContract.opaqueIdentityInputs.some(key =>
    typeof request[key] !== 'string' || !opaquePattern.test(request[key]))) {
    return 'deny_missing_or_invalid_actor_authority';
  }
  if ([request.tenantId, request.actorTenantId, request.sessionTenantId, request.membershipTenantId, request.recordTenantId]
      .some(value => value !== request.tenantId) ||
      request.actorId !== request.sessionSubjectActorId ||
      request.actorId !== request.membershipSubjectActorId ||
      request.membershipStatus !== 'active' ||
      !model.membershipVocabulary.canonicalMembershipRoleIds.includes(request.membershipRoleId)) {
    return 'deny_missing_or_invalid_actor_authority';
  }
  const capability = model.capabilities.find(item => item.id === request.capabilityId);
  if (!capability) return 'deny_capability_not_assigned';
  if (!['valid_recent', 'not_required'].includes(request.recentAuthenticationState) ||
      (capability.requiresRecentAuthentication && request.recentAuthenticationState !== 'valid_recent')) {
    return 'deny_recent_authentication_required';
  }
  if (capability.operation !== request.operation) return 'deny_unsupported_operation';
  const grant = capability.grants.find(item => item.membershipRoleId === request.membershipRoleId);
  if (!grant) return 'deny_capability_not_assigned';
  if (grant.recordScope !== request.recordScope) return 'deny_scope_mismatch';
  return 'eligible_contract_only_no_runtime_authority';
}

function requestFor(role, capabilityId) {
  const model = parse(MODEL_PATH);
  const capability = model.capabilities.find(item => item.id === capabilityId);
  const grant = capability.grants.find(item => item.membershipRoleId === role);
  return {
    tenantId: 'tenant-a', actorId: 'actor-a', actorTenantId: 'tenant-a', sessionId: 'session-a',
    sessionSubjectActorId: 'actor-a', sessionTenantId: 'tenant-a', membershipId: 'membership-a',
    membershipSubjectActorId: 'actor-a', membershipTenantId: 'tenant-a',
    membershipRoleId: role, membershipStatus: 'active', capabilityId,
    recentAuthenticationState: capability.requiresRecentAuthentication ? 'valid_recent' : 'not_required',
    operation: capability.operation, recordScope: grant && grant.recordScope, recordTenantId: 'tenant-a',
  };
}

describe('Mission 28 Part 3A fixed capability matrix', () => {
  test('binds exact released inputs, Part 2D release truth and the ten-row matrix', () => {
    validateMatrix(parse(MODEL_PATH));
  });

  test('enumerates every positive fixed grant and returns contract-only eligibility', () => {
    const model = parse(MODEL_PATH);
    let grantCount = 0;
    for (const capability of model.capabilities) {
      for (const grant of capability.grants) {
        grantCount += 1;
        expect(evaluateRequest(model, requestFor(grant.membershipRoleId, capability.id)))
          .toBe('eligible_contract_only_no_runtime_authority');
      }
    }
    expect(grantCount).toBe(16);
  });

  test('display and operational labels cannot grant or widen authority', () => {
    const model = parse(MODEL_PATH);
    for (const role of ['viewer', 'member', 'admin']) {
      const attack = {
        ...requestFor('owner', 'automation_run_approve'),
        membershipRoleId: role,
        displayRoleName: 'Owner', operationalRoleTitle: 'tenant_owner',
        jobTitle: 'Founder and super admin', teamTitle: 'Owner',
      };
      expect(evaluateRequest(model, attack)).toBe('deny_capability_not_assigned');
    }
    const viewerRead = {
      ...requestFor('owner', 'automation_view'), membershipRoleId: 'viewer',
      displayRoleName: 'owner', operationalRoleTitle: 'admin',
    };
    expect(evaluateRequest(model, viewerRead)).toBe('deny_capability_not_assigned');
  });

  test('denies missing, inactive, cross-tenant, unknown and ambiguous subject authority', () => {
    const model = parse(MODEL_PATH);
    const valid = requestFor('owner', 'automation_view');
    const attacks = [
      { ...valid, actorId: null },
      { ...valid, actorTenantId: 'tenant-b' },
      { ...valid, sessionId: null },
      { ...valid, sessionSubjectActorId: 'actor-b' },
      { ...valid, membershipId: null },
      { ...valid, membershipSubjectActorId: 'actor-b' },
      { ...valid, membershipStatus: 'inactive' },
      { ...valid, membershipStatus: 'suspended' },
      { ...valid, sessionTenantId: 'tenant-b' },
      { ...valid, membershipTenantId: 'tenant-b' },
      { ...valid, recordTenantId: 'tenant-b' },
      { ...valid, membershipRoleId: 'Owner' },
      { ...valid, membershipRoleId: 'staff' },
      { ...valid, membershipRoleId: 'super_admin' },
    ];
    for (const attack of attacks) {
      expect(evaluateRequest(model, attack)).toBe('deny_missing_or_invalid_actor_authority');
    }
    const missing = { ...valid };
    delete missing.sessionId;
    expect(evaluateRequest(model, missing)).toBe('deny_missing_or_invalid_actor_authority');
  });

  test('denies same-tenant cross-actor session or membership substitution', () => {
    const model = parse(MODEL_PATH);
    const valid = requestFor('owner', 'automation_run_approve');
    const attacks = [
      { ...valid, sessionSubjectActorId: 'actor-b' },
      { ...valid, membershipSubjectActorId: 'actor-b' },
      { ...valid, sessionSubjectActorId: 'actor-b', membershipSubjectActorId: 'actor-b' },
      { ...valid, actorId: 'actor-b' },
      { ...valid, actorId: 'actor-b', sessionSubjectActorId: 'actor-b' },
      { ...valid, actorId: 'actor-b', membershipSubjectActorId: 'actor-b' },
    ];
    for (const attack of attacks) {
      expect(attack.tenantId).toBe(valid.tenantId);
      expect(evaluateRequest(model, attack)).toBe('deny_missing_or_invalid_actor_authority');
    }
  });

  test('denies empty, whitespace, control, noncanonical and oversized opaque identities', () => {
    const model = parse(MODEL_PATH);
    const valid = requestFor('owner', 'automation_view');
    for (const key of model.subjectContract.opaqueIdentityInputs) {
      for (const invalid of ['', ' ', '\t', ` ${valid[key]}`, `${valid[key]} `, 'actor\nvalue',
        'actor value', '-leading-marker', 'a'.repeat(257)]) {
        expect(evaluateRequest(model, { ...valid, [key]: invalid }))
          .toBe('deny_missing_or_invalid_actor_authority');
      }
    }
  });

  test('denies unknown, fuzzy, mismatched-operation and mismatched-scope requests', () => {
    const model = parse(MODEL_PATH);
    const valid = requestFor('owner', 'automation_standing_authority_activate');
    for (const capabilityId of [
      'automation_*', 'AUTOMATION_STANDING_AUTHORITY_ACTIVATE',
      'automation_standing_authority_activate ', 'prefix_automation_standing_authority_activate',
      'automation_approval_decide', 'automation_external_effect_execute',
    ]) {
      expect(evaluateRequest(model, { ...valid, capabilityId })).toBe('deny_capability_not_assigned');
    }
    expect(evaluateRequest(model, { ...valid, operation: 'approve_run' })).toBe('deny_unsupported_operation');
    expect(evaluateRequest(model, { ...valid, recordScope: 'exact_tenant_all_automation' })).toBe('deny_scope_mismatch');
  });

  test('fails closed when a matrix row requires recent authentication', () => {
    const model = parse(MODEL_PATH);
    for (const [capabilityId] of EXPECTED_CAPABILITIES.filter(([, , , recent]) => recent)) {
      const request = requestFor('owner', capabilityId);
      expect(evaluateRequest(model, { ...request, recentAuthenticationState: 'missing' }))
        .toBe('deny_recent_authentication_required');
      expect(evaluateRequest(model, { ...request, recentAuthenticationState: 'stale' }))
        .toBe('deny_recent_authentication_required');
      expect(evaluateRequest(model, { ...request, recentAuthenticationState: null }))
        .toBe('deny_recent_authentication_required');
    }
  });

  test('keeps consequential grants owner-only and admin/member/viewer fail closed', () => {
    const model = parse(MODEL_PATH);
    const ownerOnly = [
      'automation_run_approve', 'automation_standing_authority_activate',
      'automation_standing_authority_change', 'automation_retry_reviewed',
      'automation_channel_availability_manage',
    ];
    for (const capabilityId of ownerOnly) {
      for (const role of ['admin', 'member', 'viewer']) {
        const request = { ...requestFor('owner', capabilityId), membershipRoleId: role };
        expect(evaluateRequest(model, request)).toBe('deny_capability_not_assigned');
      }
    }
    const member = requestFor('member', 'automation_view');
    expect(evaluateRequest(model, { ...member, recordScope: 'exact_tenant_all_automation' })).toBe('deny_scope_mismatch');
  });

  test('rejects matrix drift, widening, aliases and runtime authority even when positive rows remain', () => {
    const original = parse(MODEL_PATH);
    const mutations = [
      model => { model.capabilities.pop(); },
      model => { [model.capabilities[0], model.capabilities[1]] = [model.capabilities[1], model.capabilities[0]]; },
      model => { model.capabilities[1] = clone(model.capabilities[0]); },
      model => { model.capabilities[2].grants.push({ membershipRoleId: 'admin', recordScope: 'one_exact_tenant_run_preview' }); },
      model => { model.capabilities[0].grants[0].recordScope = '*'; },
      model => { model.membershipProfiles[1].capabilityIds.push('automation_run_approve'); },
      model => { model.membershipVocabulary.canonicalMembershipRoleIds.push('staff'); },
      model => { model.membershipVocabulary.displayRoleNameAuthority = 'allow'; },
      model => { model.authority.runtimeCapabilityResolutionImplemented = true; },
      model => { model.authority.providerAuthorityGranted = true; },
      model => { model.runtimeBoundary.matrixIsExecutableRuntime = true; },
      model => { model.runtimeBoundary.migrationAdded = true; },
      model => { model.part1DCapabilityDisposition[3].state = 'alias_automation_run_approve'; },
      model => { model.deniedCombinations.pop(); },
      model => { model.frozenInputs[7].normalizedLfSha256 = '0'.repeat(64); },
      model => { model.part2DRelease.deploymentState = 'candidate'; },
    ];
    for (const mutate of mutations) {
      const candidate = clone(original);
      mutate(candidate);
      expect(() => validateMatrix(candidate)).toThrow();
    }
  });

  test('preserves provider, external-effect, upstream-mutation and money denials', () => {
    const model = parse(MODEL_PATH);
    const assignedCapabilityIds = model.capabilities.map(capability => capability.id).join(' ');
    expect(assignedCapabilityIds).not.toMatch(/automation_(send|charge|refund|pay|provider_execute|external_effect_execute)/);
    expect(model.authority).toMatchObject({
      providerAuthorityGranted: false, externalEffectAuthorityGranted: false,
      upstreamMutationAuthorityGranted: false, moneyAuthorityGranted: false,
    });
    expect(model.runtimeBoundary).toMatchObject({
      matrixIsExecutableRuntime: false, runtimeResolverAvailable: false,
      routeUiWorkerSchedulerQueueProviderOrExportAvailable: false,
    });
  });

  test('roadmap and ledger record Part 3A released and Part 3B candidate only', () => {
    const roadmap = read(ROADMAP_PATH);
    const ledger = read(LEDGER_PATH);
    for (const document of [roadmap, ledger]) {
      expect(document).toContain('Parts 1A–3A released; Part 3B implementation candidate only.');
      expect(document).toContain('98c4b3562ad48787472584ca64c601d584c2427f');
      expect(document).toContain('f40e401a-649f-42b3-a1cc-71dbd0ffce4d');
      expect(document).toContain('586afe8103acc0e4f27d5967e8a8554876d7f5f51dc38bd7c7f4a98e2c320337');
    }
    expect(ledger).toContain('| 08 | 2D | PostgreSQL authority, canonicalization, retention and restart contract | **Released** |');
    expect(ledger).toContain('| 09 | 3A | Fixed action capability matrix | **Released** |');
    expect(ledger).toContain('| 10 | 3B | Per-run approval versus standing authorization | **Implementation candidate** |');
    expect(roadmap).toContain('Released Part 3A artifacts');
    expect(roadmap).toContain('Current Part 3B artifacts');
  });

  test('narrative states exact display-role, runtime and unavailable boundaries', () => {
    const narrative = read(NARRATIVE_PATH);
    for (const phrase of [
      'Implementation candidate only',
      'not display names',
      'eligible_contract_only_no_runtime_authority',
      'Part 1D `staff` does not silently become canonical `member`',
      'creates no control',
      'provider sandbox/live money/first-paying-customer validation',
      'founder visual approval remain unavailable and unclaimed',
    ]) expect(narrative).toContain(phrase);
  });
});
