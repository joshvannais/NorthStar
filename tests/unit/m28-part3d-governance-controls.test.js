'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { types } = require('node:util');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const parse = relative => JSON.parse(read(relative));
const clone = value => JSON.parse(JSON.stringify(value));
const CONTRACT_PATH = 'docs/architecture/MISSION_28_PART3D_GOVERNANCE_CONTROL_CONTRACT.json';
const ROADMAP_PATH = 'docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md';
const LEDGER_PATH = 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md';
const BASE = 'd227c50f73e3fb9fc89ee48332a9eda57d1c8713';
const BASE_TREE = '1a54cd43a2d3f218cc7040842847caaf668505df';

const INPUT_HASHES = Object.freeze({
  'docs/architecture/MISSION_28_PART1A_AUTHORITY_CONTRACT.md': '92DAD00F8A7623A87C780FC1AC965B66569616650F53FDED8454F51872458179',
  'docs/architecture/MISSION_28_PART1B_SURFACE_INVENTORY.json': '62E37CF07A26F0C2B1A50A2C2F0EB927695500DB32B44B16E5B431F594B93142',
  'docs/architecture/MISSION_28_PART1C_ACTION_RISK_CATALOG.json': '1CB5FF594AE7D1BEED313C1A94D7FE8200FB0024B36DF11B4C668F211481312B',
  'docs/architecture/MISSION_28_PART1D_FIRST_LAUNCH_MATRIX.json': '8CC5C4D62719EA6E6BCF9A340C5BE0593BE2F10CD60360D10562C4979D859B52',
  'docs/architecture/MISSION_28_PART2A_CANONICAL_AUTOMATION_POLICY.json': 'B8BC22AE758E2AD0C2D037963709A947FE0564AF4319DED571F7ABD273D6A4E8',
  'docs/architecture/MISSION_28_PART2B_IMMUTABLE_RECORD_MODEL.json': '3C64287BA287567ADD0E0962A3ED45B90657CA97686435E1D616FFF2F88293B5',
  'docs/architecture/MISSION_28_PART2C_POLICY_LIFECYCLE.json': '91008C2B04D2492F8067F0F31DAB8E4902FA06FEA6A781CB46B4C836453FFACD',
  'docs/architecture/MISSION_28_PART2D_POSTGRES_AUTHORITY.json': '03F32F3C66EF525DF9ACA541F8A7D0C08935E1DD2EDB661468F78CC2A763308A',
  'docs/architecture/MISSION_28_PART3A_FIXED_CAPABILITY_MATRIX.json': 'BFF226B90123575945B8B268E88B844AF21A5FDE03621BAC0182D270C2928A33',
  'docs/architecture/MISSION_28_PART3A_FIXED_CAPABILITY_MATRIX.md': 'F849B39A38377F5B331BE302FD2C4A6065C727F7763127FD17819C20A509C8C1',
  'docs/architecture/MISSION_28_PART3B_APPROVAL_AUTHORIZATION_CONTRACT.json': '6A7558C5BC61C31B627C9C0C474955B98E1D2D7BA5CC537C57F7F9D767A52575',
  'docs/architecture/MISSION_28_PART3B_APPROVAL_AUTHORIZATION_CONTRACT.md': 'C8C0D7CA8D4FDB9F949B2B35FBAAEE91B321D0127B64A77ECFF941C3F315B2D0',
  'docs/architecture/MISSION_28_PART3C_OWNER_LIMITS_CONTRACT.json': '79031B6D3747FA538D151C1E2597AEE3F072D1AB66772A3E6AB58479C2A38321',
  'docs/architecture/MISSION_28_PART3C_OWNER_LIMITS_CONTRACT.md': '461A8D7EC362BFA5D4F55D7FF364F581AA4CB06AF0A3FF831B1FF71A4CD494B4',
});

const UUID = Object.freeze({
  tenant: '00000000-0000-4000-8000-000000000028',
  control: '00000000-0000-4000-8000-0000000003d1',
  policy: '00000000-0000-4000-8000-000000000201',
  run: '00000000-0000-4000-8000-000000000220',
  action: '00000000-0000-4000-8000-000000000230',
  actor: '00000000-0000-4000-8000-000000000301',
  actor2: '00000000-0000-4000-8000-000000000302',
  session: '00000000-0000-4000-8000-000000000311',
  session2: '00000000-0000-4000-8000-000000000312',
  membership: '00000000-0000-4000-8000-000000000321',
  membership2: '00000000-0000-4000-8000-000000000322',
  authorization: '00000000-0000-4000-8000-000000000331',
  recentAuthentication: '00000000-0000-4000-8000-000000000332',
  recentAuthentication2: '00000000-0000-4000-8000-000000000333',
  incident: '00000000-0000-4000-8000-000000000341',
});
const digestValue = char => `sha256:${char.repeat(64)}`;

function normalizedLfSha256(relative) {
  const normalized = read(relative).replace(/\r\n/g, '\n');
  if (normalized.includes('\r')) throw new Error(`lone CR denied: ${relative}`);
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex').toUpperCase();
}

function safeClonePlain(value, seen = new Set()) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('unsafe number');
    return value;
  }
  if (typeof value !== 'object' || types.isProxy(value) || seen.has(value)) throw new Error('non-plain value');
  seen.add(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) throw new Error('custom array prototype');
    const keys = Reflect.ownKeys(value);
    const expected = value.map((_, index) => String(index)).concat('length');
    if (JSON.stringify(keys) !== JSON.stringify(expected)) throw new Error('sparse or decorated array');
    const result = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value') ||
          !descriptor.enumerable || !descriptor.configurable || !descriptor.writable) throw new Error('array descriptor');
      result.push(safeClonePlain(descriptor.value, seen));
    }
    seen.delete(value);
    return result;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) throw new Error('custom object prototype');
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string')) throw new Error('symbol key');
  const result = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value') ||
        !descriptor.enumerable || !descriptor.configurable || !descriptor.writable) throw new Error('object descriptor');
    result[key] = safeClonePlain(descriptor.value, seen);
  }
  seen.delete(value);
  return result;
}

function exactKeys(value, expected) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function canonicalJson(value) {
  if (value === null || ['string', 'boolean', 'number'].includes(typeof value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function digest(namespace, value) {
  return `sha256:${crypto.createHash('sha256').update(namespace + canonicalJson(value), 'utf8').digest('hex')}`;
}

function validInstant(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function operation(contract, operationId) {
  return contract.controlOperations.find(item => item.id === operationId);
}

function withoutKey(value, excludedKey) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== excludedKey));
}

function dualControlSubject(decision) {
  return {
    tenantId: decision.tenantId,
    operationId: decision.operationId,
    targetBinding: decision.targetBinding,
    initiatorActorId: decision.actorBinding.actorId,
    authorizationBinding: decision.authorizationBinding,
    reasonBinding: decision.reasonBinding,
    stateEvidence: decision.stateEvidence,
    requestedAt: decision.requestedAt,
    expiresAt: decision.expiresAt,
    idempotencyKey: decision.idempotencyKey,
    resultingControlState: decision.resultingControlState,
  };
}

function breakGlassEvidenceSubject(decision) {
  return {
    tenantId: decision.tenantId,
    operationId: decision.operationId,
    targetBinding: decision.targetBinding,
    reasonBinding: decision.reasonBinding,
    stateEvidence: decision.stateEvidence,
    resultingControlState: decision.resultingControlState,
    breakGlassExpiresAt: decision.breakGlassBinding.expiresAt,
  };
}

function buildDecision(operationId = 'pause_policy', options = {}) {
  const contract = parse(CONTRACT_PATH);
  const rule = operation(contract, operationId);
  const targetKind = rule.targetKind;
  const tenantTarget = targetKind === 'tenant';
  const actionTarget = targetKind === 'action_unit';
  const authorityRequired = ['revoke_standing_authority', 'resume_policy', 'release_tenant_kill'].includes(operationId);
  const dualRequired = operationId === 'release_tenant_kill' || options.dualRequired === true;
  const breakGlass = options.breakGlass === true;
  const currentState = options.currentState || rule.allowedFromStates[0];
  const target = {
    targetKind,
    tenantId: UUID.tenant,
    policyId: tenantTarget ? null : UUID.policy,
    policyVersion: tenantTarget ? null : 4,
    policyDigest: tenantTarget ? null : digestValue('2'),
    sourceSetDigest: tenantTarget ? null : digestValue('3'),
    limitProfileDigest: tenantTarget ? null : digestValue('4'),
    runId: actionTarget ? UUID.run : null,
    actionUnitId: actionTarget ? UUID.action : null,
    actionUnitDigest: actionTarget ? digestValue('5') : null,
    currentState,
    currentStateDigest: digestValue('6'),
  };
  const evidence = {
    policyCurrentness: options.policyCurrentness || 'exact_current',
    sourceCurrentness: options.sourceCurrentness || 'exact_current',
    limitCurrentness: options.limitCurrentness || 'exact_current',
    tenantStopState: tenantTarget ? currentState : 'normal',
    queuedCount: actionTarget ? 1 : 0,
    leasedCount: options.leasedCount || 0,
    inFlightCount: options.inFlightCount || 0,
    uncertainCount: options.uncertainCount || 0,
    completedCount: options.completedCount || 0,
    priorBreakGlassUsed: options.priorBreakGlassUsed === true,
    priorTenantKillUsed: options.priorTenantKillUsed === true,
    priorUncertainOrInFlightObserved: options.priorUncertainOrInFlightObserved === true,
    priorIndependentReviewRequired: options.priorIndependentReviewRequired === true || options.priorBreakGlassUsed === true,
    independentReviewState: options.independentReviewState ||
      (breakGlass ? 'pending' : (options.priorIndependentReviewRequired === true || options.priorBreakGlassUsed === true)
        ? 'completed' : 'not_required'),
    observedAt: '2026-10-28T10:00:00.000Z',
    evidenceDigest: null,
  };
  const decision = {
    contractVersion: contract.controlDecisionGrammar.contractVersion,
    controlId: UUID.control,
    tenantId: UUID.tenant,
    operationId,
    targetBinding: target,
    actorBinding: {
      actorId: UUID.actor,
      sessionId: UUID.session,
      sessionSubjectId: UUID.actor,
      membershipId: UUID.membership,
      membershipSubjectId: UUID.actor,
      membershipTenantId: UUID.tenant,
      membershipRoleId: rule.eligibleMembershipRoleIds[0],
      capabilityIds: clone(rule.requiredCapabilityIds),
      recentAuthenticationEvidenceId: rule.requiresRecentAuthentication ? UUID.recentAuthentication : null,
      recentAuthenticationEvidenceDigest: rule.requiresRecentAuthentication ? digestValue('7') : null,
      recentAuthenticationAt: rule.requiresRecentAuthentication ? '2026-10-28T09:55:00.000Z' : null,
    },
    authorizationBinding: authorityRequired ? {
      authorizationId: UUID.authorization,
      authorizationKind: tenantTarget ? 'tenant_stop_release_approval' : 'standing_authorization',
      tenantId: UUID.tenant,
      subjectKind: tenantTarget ? 'tenant_stop_state' : 'policy_version',
      subjectId: tenantTarget ? UUID.tenant : UUID.policy,
      subjectVersion: tenantTarget ? null : 4,
      subjectDigest: tenantTarget ? target.currentStateDigest : target.policyDigest,
      sourceSetDigest: tenantTarget ? null : target.sourceSetDigest,
      limitProfileDigest: tenantTarget ? null : target.limitProfileDigest,
      targetStateDigest: target.currentStateDigest,
      recordDigest: digestValue('a'),
      materialBindingDigest: digestValue('b'),
      expiresAt: '2026-10-28T11:00:00.000Z',
    } : {
      authorizationId: null, authorizationKind: null, tenantId: null, subjectKind: null,
      subjectId: null, subjectVersion: null, subjectDigest: null, sourceSetDigest: null,
      limitProfileDigest: null, targetStateDigest: null, recordDigest: null,
      materialBindingDigest: null, expiresAt: null,
    },
    reasonBinding: {
      reasonCode: breakGlass ? 'degraded_incident_fail_safe' : 'owner_control_request',
      reasonTextDigest: digestValue('c'),
      incidentId: breakGlass ? UUID.incident : null,
    },
    stateEvidence: evidence,
    dualControlBinding: dualRequired ? {
      required: true,
      initiatorActorId: UUID.actor,
      approverActorId: UUID.actor2,
      approverSessionId: UUID.session2,
      approverSessionSubjectId: UUID.actor2,
      approverMembershipId: UUID.membership2,
      approverMembershipSubjectId: UUID.actor2,
      approverMembershipTenantId: UUID.tenant,
      approverMembershipRoleId: 'owner',
      approverCapabilityIds: clone(rule.requiredCapabilityIds),
      approverRecentAuthenticationEvidenceId: UUID.recentAuthentication2,
      approverRecentAuthenticationEvidenceDigest: digestValue('9'),
      approverRecentAuthenticationAt: '2026-10-28T09:56:00.000Z',
      approvalSubjectDigest: null,
      approvalDigest: digestValue('d'),
      approvalExpiresAt: '2026-10-28T10:30:00.000Z',
    } : {
      required: false,
      initiatorActorId: UUID.actor,
      approverActorId: null,
      approverSessionId: null,
      approverSessionSubjectId: null,
      approverMembershipId: null,
      approverMembershipSubjectId: null,
      approverMembershipTenantId: null,
      approverMembershipRoleId: null,
      approverCapabilityIds: [],
      approverRecentAuthenticationEvidenceId: null,
      approverRecentAuthenticationEvidenceDigest: null,
      approverRecentAuthenticationAt: null,
      approvalSubjectDigest: null,
      approvalDigest: null,
      approvalExpiresAt: null,
    },
    breakGlassBinding: breakGlass ? {
      used: true,
      incidentId: UUID.incident,
      reasonCode: 'degraded_incident_fail_safe',
      expiresAt: '2026-10-28T10:20:00.000Z',
      requiresIndependentReview: true,
      reviewState: 'pending_independent_owner_review',
      evidenceDigest: digestValue('e'),
    } : {
      used: false, incidentId: null, reasonCode: null, expiresAt: null,
      requiresIndependentReview: false, reviewState: 'not_required', evidenceDigest: null,
    },
    requestedAt: '2026-10-28T10:00:00.000Z',
    expiresAt: '2026-10-28T10:15:00.000Z',
    idempotencyKey: `control:${operationId}:exact-1`,
    resultingControlState: rule.resultingState,
    decisionState: contract.controlDecisionGrammar.decisionState,
    decisionDigest: digestValue('0'),
  };
  return seal(decision, contract);
}

function seal(decision, contract = parse(CONTRACT_PATH)) {
  const result = clone(decision);
  result.stateEvidence.evidenceDigest = digest(
    contract.controlDecisionGrammar.stateEvidenceDigestNamespace,
    withoutKey(result.stateEvidence, 'evidenceDigest'),
  );
  result.dualControlBinding.approvalSubjectDigest = result.dualControlBinding.required
    ? digest(contract.controlDecisionGrammar.dualControlSubjectDigestNamespace, dualControlSubject(result))
    : null;
  result.breakGlassBinding.evidenceDigest = result.breakGlassBinding.used
    ? digest(contract.controlDecisionGrammar.breakGlassEvidenceDigestNamespace, breakGlassEvidenceSubject(result))
    : null;
  const material = withoutKey(result, 'decisionDigest');
  result.decisionDigest = digest(contract.controlDecisionGrammar.digestNamespace, material);
  return result;
}

function trustedFor(decision, contract = parse(CONTRACT_PATH)) {
  return {
    tenantId: decision.tenantId,
    operation: clone(operation(contract, decision.operationId)),
    targetBinding: clone(decision.targetBinding),
    actorResolution: clone(decision.actorBinding),
    authorizationResolution: clone(decision.authorizationBinding),
    stateEvidence: clone(decision.stateEvidence),
    dualControlResolution: clone(decision.dualControlBinding),
    breakGlassResolution: clone(decision.breakGlassBinding),
    decisionAt: decision.requestedAt,
    expectedDecisionDigest: decision.decisionDigest,
  };
}

function validateDecision(input, trustedInput) {
  const contract = parse(CONTRACT_PATH);
  let decision;
  let trusted;
  try {
    decision = safeClonePlain(input);
    trusted = safeClonePlain(trustedInput);
  } catch {
    return 'deny_missing_or_self_created_trusted_resolution';
  }
  const grammar = contract.controlDecisionGrammar;
  if (!exactKeys(decision, grammar.exactKeys) ||
      !exactKeys(decision.targetBinding, grammar.targetBindingExactKeys) ||
      !exactKeys(decision.actorBinding, grammar.actorBindingExactKeys) ||
      !exactKeys(decision.authorizationBinding, grammar.authorizationBindingExactKeys) ||
      !exactKeys(decision.reasonBinding, grammar.reasonBindingExactKeys) ||
      !exactKeys(decision.stateEvidence, grammar.stateEvidenceExactKeys) ||
      !exactKeys(decision.dualControlBinding, grammar.dualControlBindingExactKeys) ||
      !exactKeys(decision.breakGlassBinding, grammar.breakGlassBindingExactKeys) ||
      !exactKeys(trusted, contract.trustedResolutionContract.requiredExactKeys)) {
    return 'deny_missing_or_self_created_trusted_resolution';
  }
  const uuid = new RegExp(contract.identityGrammar.uuidPattern);
  const sha = new RegExp(contract.identityGrammar.digestPattern);
  const instant = new RegExp(contract.identityGrammar.utcInstantPattern);
  const opaque = new RegExp(contract.identityGrammar.opaqueIdPattern);
  const rule = operation(contract, decision.operationId);
  if (!rule || canonicalJson(rule) !== canonicalJson(trusted.operation) ||
      decision.contractVersion !== grammar.contractVersion || decision.decisionState !== grammar.decisionState ||
      !uuid.test(decision.controlId) || !uuid.test(decision.tenantId) || trusted.tenantId !== decision.tenantId ||
      canonicalJson(decision.targetBinding) !== canonicalJson(trusted.targetBinding) ||
      canonicalJson(decision.actorBinding) !== canonicalJson(trusted.actorResolution) ||
      canonicalJson(decision.authorizationBinding) !== canonicalJson(trusted.authorizationResolution) ||
      canonicalJson(decision.stateEvidence) !== canonicalJson(trusted.stateEvidence) ||
      canonicalJson(decision.dualControlBinding) !== canonicalJson(trusted.dualControlResolution) ||
      canonicalJson(decision.breakGlassBinding) !== canonicalJson(trusted.breakGlassResolution)) {
    return 'deny_identity_capability_target_or_state_mismatch';
  }
  const target = decision.targetBinding;
  if (target.targetKind !== rule.targetKind || target.tenantId !== decision.tenantId ||
      !rule.allowedFromStates.includes(target.currentState) || !sha.test(target.currentStateDigest)) {
    return 'deny_invalid_transition_or_terminal_reactivation';
  }
  const tenantTarget = target.targetKind === 'tenant';
  const actionTarget = target.targetKind === 'action_unit';
  if (tenantTarget ? [target.policyId, target.policyVersion, target.policyDigest, target.sourceSetDigest,
    target.limitProfileDigest, target.runId, target.actionUnitId, target.actionUnitDigest].some(value => value !== null)
    : (!uuid.test(target.policyId) || !Number.isSafeInteger(target.policyVersion) || target.policyVersion < 1 ||
      !sha.test(target.policyDigest) || !sha.test(target.sourceSetDigest) || !sha.test(target.limitProfileDigest))) {
    return 'deny_identity_capability_target_or_state_mismatch';
  }
  if (actionTarget ? (!uuid.test(target.runId) || !uuid.test(target.actionUnitId) || !sha.test(target.actionUnitDigest))
    : [target.runId, target.actionUnitId, target.actionUnitDigest].some(value => value !== null)) {
    return 'deny_identity_capability_target_or_state_mismatch';
  }
  if (!validInstant(decision.requestedAt, instant) || !validInstant(decision.expiresAt, instant) ||
      !opaque.test(decision.idempotencyKey) || !grammar.reasonCodes.includes(decision.reasonBinding.reasonCode) ||
      !sha.test(decision.reasonBinding.reasonTextDigest) || decision.resultingControlState !== rule.resultingState) {
    return 'deny_identity_capability_target_or_state_mismatch';
  }
  const requestedMs = Date.parse(decision.requestedAt);
  const expiresMs = Date.parse(decision.expiresAt);
  if (expiresMs <= requestedMs || expiresMs - requestedMs > grammar.maximumDecisionLifetimeSeconds * 1000) {
    return 'deny_expired_future_or_nonrecent_auth_or_evidence';
  }
  const actor = decision.actorBinding;
  if (!uuid.test(actor.actorId) || !uuid.test(actor.sessionId) || !uuid.test(actor.membershipId) ||
      actor.sessionSubjectId !== actor.actorId || actor.membershipSubjectId !== actor.actorId ||
      actor.membershipTenantId !== decision.tenantId || !rule.eligibleMembershipRoleIds.includes(actor.membershipRoleId) ||
      canonicalJson(actor.capabilityIds) !== canonicalJson(rule.requiredCapabilityIds) ||
      (rule.requiresRecentAuthentication
        ? (!uuid.test(actor.recentAuthenticationEvidenceId) || !sha.test(actor.recentAuthenticationEvidenceDigest) ||
          !validInstant(actor.recentAuthenticationAt, instant) ||
          Date.parse(actor.recentAuthenticationAt) > requestedMs ||
          requestedMs - Date.parse(actor.recentAuthenticationAt) > grammar.maximumRecentAuthenticationAgeSeconds * 1000)
        : actor.recentAuthenticationEvidenceId !== null || actor.recentAuthenticationEvidenceDigest !== null ||
          actor.recentAuthenticationAt !== null)) {
    return 'deny_identity_capability_target_or_state_mismatch';
  }
  const auth = decision.authorizationBinding;
  const policyAuthorizationRequired = ['revoke_standing_authority', 'resume_policy'].includes(rule.id);
  const tenantStopAuthorizationRequired = rule.id === 'release_tenant_kill';
  const commonAuthorizationInvalid = !uuid.test(auth.authorizationId) || auth.tenantId !== decision.tenantId ||
    !sha.test(auth.subjectDigest) || !sha.test(auth.targetStateDigest) || !sha.test(auth.recordDigest) ||
    !sha.test(auth.materialBindingDigest) || !validInstant(auth.expiresAt, instant) || auth.expiresAt <= decision.requestedAt;
  if (policyAuthorizationRequired ? (commonAuthorizationInvalid || auth.authorizationKind !== 'standing_authorization' ||
    auth.subjectKind !== 'policy_version' || auth.subjectId !== target.policyId || auth.subjectVersion !== target.policyVersion ||
    auth.subjectDigest !== target.policyDigest || auth.sourceSetDigest !== target.sourceSetDigest ||
    auth.limitProfileDigest !== target.limitProfileDigest || auth.targetStateDigest !== target.currentStateDigest)
    : tenantStopAuthorizationRequired ? (commonAuthorizationInvalid ||
      auth.authorizationKind !== 'tenant_stop_release_approval' || auth.subjectKind !== 'tenant_stop_state' ||
      auth.subjectId !== decision.tenantId || auth.subjectVersion !== null ||
      auth.subjectDigest !== target.currentStateDigest || auth.sourceSetDigest !== null ||
      auth.limitProfileDigest !== null || auth.targetStateDigest !== target.currentStateDigest)
      : Object.values(auth).some(value => value !== null)) {
    return 'deny_identity_capability_target_or_state_mismatch';
  }
  const evidence = decision.stateEvidence;
  const increasing = rule.authorityDirection === 'increase_requires_current_authority';
  if (decision.breakGlassBinding.used &&
      (!contract.breakGlassContract.allowedOperations.includes(rule.id) || increasing)) {
    return 'deny_break_glass_widens_or_restores_authority';
  }
  if (rule.id === 'release_tenant_kill' && evidence.tenantStopState !== 'killed') {
    return 'deny_invalid_transition_or_terminal_reactivation';
  }
  const counts = ['queuedCount', 'leasedCount', 'inFlightCount', 'uncertainCount', 'completedCount'];
  const historyFlags = ['priorBreakGlassUsed', 'priorTenantKillUsed', 'priorUncertainOrInFlightObserved',
    'priorIndependentReviewRequired'];
  if (!counts.every(key => Number.isSafeInteger(evidence[key]) && evidence[key] >= 0) ||
      !historyFlags.every(key => typeof evidence[key] === 'boolean') ||
      !Object.entries(grammar.stateEvidenceEnums).every(([key, values]) => values.includes(evidence[key])) ||
      !validInstant(evidence.observedAt, instant) || Date.parse(evidence.observedAt) > requestedMs ||
      !sha.test(evidence.evidenceDigest) || evidence.evidenceDigest !== digest(
        grammar.stateEvidenceDigestNamespace, withoutKey(evidence, 'evidenceDigest')) ||
      trusted.decisionAt !== decision.requestedAt) {
    return 'deny_identity_capability_target_or_state_mismatch';
  }
  if ((evidence.priorIndependentReviewRequired && evidence.independentReviewState === 'not_required') ||
      (!evidence.priorIndependentReviewRequired && !decision.breakGlassBinding.used &&
        evidence.independentReviewState !== 'not_required') ||
      (decision.breakGlassBinding.used && evidence.independentReviewState !== 'pending') ||
      (tenantTarget && evidence.tenantStopState !== target.currentState)) {
    return 'deny_identity_capability_target_or_state_mismatch';
  }
  if (increasing && (evidence.policyCurrentness !== 'exact_current' || evidence.sourceCurrentness !== 'exact_current' ||
      evidence.limitCurrentness !== 'exact_current' || evidence.leasedCount !== 0 || evidence.inFlightCount !== 0 ||
      evidence.uncertainCount !== 0 || !['not_required', 'completed'].includes(evidence.independentReviewState) ||
      requestedMs - Date.parse(evidence.observedAt) > grammar.maximumExactCurrentEvidenceAgeSeconds * 1000)) {
    return 'deny_stale_unavailable_uncertain_or_degraded_authority_increase';
  }
  if (rule.id === 'resume_policy' && evidence.tenantStopState !== 'normal') {
    return 'deny_stale_unavailable_uncertain_or_degraded_authority_increase';
  }
  if (rule.id === 'cancel_action_unit' && (evidence.queuedCount !== 1 || evidence.leasedCount !== 0 ||
      evidence.inFlightCount !== 0 || evidence.uncertainCount !== 0 || evidence.completedCount !== 0)) {
    return 'deny_inflight_or_completed_effect_claim';
  }
  const conditionalDual = rule.id === 'resume_policy' && (evidence.priorBreakGlassUsed ||
    evidence.priorTenantKillUsed || evidence.priorUncertainOrInFlightObserved ||
    evidence.priorIndependentReviewRequired);
  const dualRequired = rule.dualControl === 'always_required' || conditionalDual;
  const dual = decision.dualControlBinding;
  if (dual.required !== dualRequired || dual.initiatorActorId !== actor.actorId) {
    return 'deny_self_approval_or_required_dual_control_missing';
  }
  if (dualRequired) {
    if (!uuid.test(dual.approverActorId) || !uuid.test(dual.approverSessionId) || !uuid.test(dual.approverMembershipId) ||
        dual.approverActorId === actor.actorId || dual.approverSessionId === actor.sessionId ||
        dual.approverMembershipId === actor.membershipId || dual.approverSessionSubjectId !== dual.approverActorId ||
        dual.approverMembershipSubjectId !== dual.approverActorId || dual.approverMembershipTenantId !== decision.tenantId ||
        dual.approverMembershipRoleId !== 'owner' || canonicalJson(dual.approverCapabilityIds) !== canonicalJson(rule.requiredCapabilityIds) ||
        !uuid.test(dual.approverRecentAuthenticationEvidenceId) || !sha.test(dual.approverRecentAuthenticationEvidenceDigest) ||
        !validInstant(dual.approverRecentAuthenticationAt, instant) ||
        Date.parse(dual.approverRecentAuthenticationAt) > requestedMs ||
        requestedMs - Date.parse(dual.approverRecentAuthenticationAt) > grammar.maximumRecentAuthenticationAgeSeconds * 1000 ||
        !sha.test(dual.approvalSubjectDigest) || dual.approvalSubjectDigest !== digest(
          grammar.dualControlSubjectDigestNamespace, dualControlSubject(decision)) || !sha.test(dual.approvalDigest) ||
        !validInstant(dual.approvalExpiresAt, instant) || dual.approvalExpiresAt <= decision.requestedAt) {
      return 'deny_self_approval_or_required_dual_control_missing';
    }
  } else if (dual.approverActorId !== null || dual.approverSessionId !== null || dual.approverSessionSubjectId !== null ||
      dual.approverMembershipId !== null || dual.approverMembershipSubjectId !== null ||
      dual.approverMembershipTenantId !== null || dual.approverMembershipRoleId !== null ||
      dual.approverCapabilityIds.length !== 0 || dual.approverRecentAuthenticationEvidenceId !== null ||
      dual.approverRecentAuthenticationEvidenceDigest !== null || dual.approverRecentAuthenticationAt !== null ||
      dual.approvalSubjectDigest !== null || dual.approvalDigest !== null || dual.approvalExpiresAt !== null) {
    return 'deny_self_approval_or_required_dual_control_missing';
  }
  const breakGlass = decision.breakGlassBinding;
  if (breakGlass.used) {
    if (!contract.breakGlassContract.allowedOperations.includes(rule.id) || increasing ||
        !uuid.test(breakGlass.incidentId) || breakGlass.incidentId !== decision.reasonBinding.incidentId ||
        breakGlass.reasonCode !== decision.reasonBinding.reasonCode || !validInstant(breakGlass.expiresAt, instant) ||
        breakGlass.expiresAt <= decision.requestedAt || breakGlass.requiresIndependentReview !== true ||
        breakGlass.reviewState !== 'pending_independent_owner_review' || !sha.test(breakGlass.evidenceDigest) ||
        breakGlass.evidenceDigest !== digest(grammar.breakGlassEvidenceDigestNamespace, breakGlassEvidenceSubject(decision))) {
      return 'deny_break_glass_widens_or_restores_authority';
    }
  } else if (breakGlass.incidentId !== null || breakGlass.reasonCode !== null || breakGlass.expiresAt !== null ||
      breakGlass.requiresIndependentReview !== false || breakGlass.reviewState !== 'not_required' ||
      breakGlass.evidenceDigest !== null || decision.reasonBinding.incidentId !== null ||
      decision.reasonBinding.reasonCode !== 'owner_control_request') {
    return 'deny_break_glass_widens_or_restores_authority';
  }
  const material = Object.fromEntries(Object.entries(decision).filter(([key]) => key !== 'decisionDigest'));
  const expectedDigest = digest(grammar.digestNamespace, material);
  if (!sha.test(decision.decisionDigest) || decision.decisionDigest !== expectedDigest ||
      trusted.expectedDecisionDigest !== decision.decisionDigest) return 'deny_digest_or_replay_conflict';
  return 'accepted_contract_control_only_no_runtime_or_effect_authority';
}

function validateReplay(existing, candidate, trusted) {
  if (validateDecision(existing, trusted) !== 'accepted_contract_control_only_no_runtime_or_effect_authority' ||
      validateDecision(candidate, trusted) !== 'accepted_contract_control_only_no_runtime_or_effect_authority') {
    return 'deny_digest_or_replay_conflict';
  }
  return existing.controlId === candidate.controlId && existing.decisionDigest === candidate.decisionDigest &&
    canonicalJson(existing) === canonicalJson(candidate)
    ? 'idempotent_exact_replay_no_new_authority' : 'deny_digest_or_replay_conflict';
}

describe('Mission 28 Part 3D governance controls', () => {
  test('binds exact released inputs and Part 3C release provenance', () => {
    const contract = parse(CONTRACT_PATH);
    expect(contract.authority).toEqual({
      mission: 28, part: '3D', state: 'implementation_candidate_only', baselineCommit: BASE,
      baselineTree: BASE_TREE, runtimeControlResolverImplemented: false, databaseOrMigrationAdded: false,
      routeUiSchedulerWorkerQueueOrProviderAuthorityGranted: false,
      externalRecipientOrEffectAuthorityGranted: false, upstreamMutationOrMoneyAuthorityGranted: false,
    });
    expect(contract.part3CRelease).toMatchObject({
      acceptedSourceHead: '3cd41fe5379d92fe629c62e0ebc3a51d8886c3cc', acceptedTree: BASE_TREE,
      pullRequest: 559, mergedMain: BASE, mergedAt: '2026-10-27T20:20:00.000Z',
      deployment: 'b745a483-1031-4020-9ab2-38c0044e599d', deploymentState: 'SUCCESS_RUNNING',
      runningInstance: '0227dd84-13e8-48b1-99fd-8268ae8e8ba8',
      imageSha256: '27c84d6cd34be043aa2f6388080c90b5500a8ea1d87ab018c9d58f34277e5590',
      auditVerdict: 'P0=P1=P2=P3=0', auditReportSha256: null,
    });
    expect(contract.frozenInputs.map(item => item.path)).toEqual(Object.keys(INPUT_HASHES));
    for (const item of contract.frozenInputs) {
      expect(item.normalizedLfSha256).toBe(INPUT_HASHES[item.path]);
      expect(normalizedLfSha256(item.path)).toBe(item.normalizedLfSha256);
    }
  });

  test('defines the exact seven controls without inventing capability authority', () => {
    const contract = parse(CONTRACT_PATH);
    expect(contract.controlOperationOrder).toEqual([
      'pause_policy', 'revoke_standing_authority', 'engage_tenant_kill', 'drain_policy',
      'cancel_action_unit', 'resume_policy', 'release_tenant_kill',
    ]);
    expect(contract.controlOperations.map(item => item.id)).toEqual(contract.controlOperationOrder);
    const part3A = parse('docs/architecture/MISSION_28_PART3A_FIXED_CAPABILITY_MATRIX.json');
    const capabilityIds = new Set(part3A.capabilities.map(item => item.id));
    for (const control of contract.controlOperations) {
      expect(control.requiredCapabilityIds.length).toBeGreaterThan(0);
      expect(control.requiredCapabilityIds.every(id => capabilityIds.has(id))).toBe(true);
      expect(control.boundary).toBeTruthy();
    }
  });

  test('forbids candidate-supplied or replaced trusted resolution consistently', () => {
    const contract = parse(CONTRACT_PATH);
    expect(contract.trustedResolutionContract.candidateMayNotSupplyOrReplaceTrustedResolution).toBe(true);
    expect(contract.identityGrammar.recordSuppliedActorCapabilityTargetStateClockEvidenceOrApprovalNeverCreatesAuthority)
      .toBe(true);
    expect(contract.decisionStates).toContain('deny_missing_or_self_created_trusted_resolution');
    expect(read('docs/architecture/MISSION_28_PART3D_GOVERNANCE_CONTROL_CONTRACT.md'))
      .toContain('Candidate data, a display role or a recomputed outer digest cannot create or retarget any of these authorities.');
  });

  test.each(['pause_policy', 'revoke_standing_authority', 'engage_tenant_kill', 'drain_policy', 'cancel_action_unit', 'resume_policy', 'release_tenant_kill'])
  ('accepts one exact %s decision as contract-only evidence', operationId => {
    const decision = buildDecision(operationId);
    expect(validateDecision(decision, trustedFor(decision)))
      .toBe('accepted_contract_control_only_no_runtime_or_effect_authority');
  });

  test('allows fail-safe reductions with stale evidence but denies every authority increase', () => {
    for (const operationId of ['pause_policy', 'engage_tenant_kill', 'drain_policy']) {
      const decision = buildDecision(operationId, {
        policyCurrentness: 'stale', sourceCurrentness: 'unavailable', limitCurrentness: 'mixed',
      });
      expect(validateDecision(decision, trustedFor(decision)))
        .toBe('accepted_contract_control_only_no_runtime_or_effect_authority');
    }
    for (const operationId of ['resume_policy', 'release_tenant_kill']) {
      const decision = buildDecision(operationId, { sourceCurrentness: 'stale' });
      expect(validateDecision(decision, trustedFor(decision)))
        .toBe('deny_stale_unavailable_uncertain_or_degraded_authority_increase');
    }
  });

  test('binds each authorization to its exact policy or tenant-stop subject after full redigest', () => {
    for (const operationId of ['revoke_standing_authority', 'resume_policy']) {
      const canonical = buildDecision(operationId);
      for (const mutate of [
        value => { value.authorizationBinding.subjectId = '00000000-0000-4000-8000-000000000299'; },
        value => { value.authorizationBinding.subjectVersion += 1; },
        value => { value.authorizationBinding.subjectDigest = digestValue('f'); },
        value => { value.authorizationBinding.sourceSetDigest = digestValue('f'); },
        value => { value.authorizationBinding.limitProfileDigest = digestValue('f'); },
        value => { value.authorizationBinding.targetStateDigest = digestValue('f'); },
      ]) {
        const attack = clone(canonical); mutate(attack); const sealed = seal(attack);
        expect(validateDecision(sealed, trustedFor(sealed))).toBe('deny_identity_capability_target_or_state_mismatch');
      }
    }
    const release = buildDecision('release_tenant_kill');
    for (const mutate of [
      value => { value.authorizationBinding.authorizationKind = 'standing_authorization'; },
      value => { value.authorizationBinding.subjectKind = 'policy_version'; },
      value => { value.authorizationBinding.subjectId = UUID.policy; },
      value => { value.authorizationBinding.subjectVersion = 4; },
      value => { value.authorizationBinding.subjectDigest = digestValue('f'); },
      value => { value.authorizationBinding.sourceSetDigest = digestValue('3'); },
      value => { value.authorizationBinding.targetStateDigest = digestValue('f'); },
    ]) {
      const attack = clone(release); mutate(attack); const sealed = seal(attack);
      expect(validateDecision(sealed, trustedFor(sealed))).toBe('deny_identity_capability_target_or_state_mismatch');
    }
  });

  test('bounds decision lifetime recent authentication and exact-current evidence age', () => {
    const oldActorAuth = buildDecision('resume_policy');
    oldActorAuth.actorBinding.recentAuthenticationAt = '2026-10-28T09:44:59.000Z';
    let sealed = seal(oldActorAuth);
    expect(validateDecision(sealed, trustedFor(sealed))).toBe('deny_identity_capability_target_or_state_mismatch');

    const futureActorAuth = buildDecision('resume_policy');
    futureActorAuth.actorBinding.recentAuthenticationAt = '2026-10-28T10:00:01.000Z';
    sealed = seal(futureActorAuth);
    expect(validateDecision(sealed, trustedFor(sealed))).toBe('deny_identity_capability_target_or_state_mismatch');

    const overlongDecision = buildDecision('pause_policy');
    overlongDecision.expiresAt = '2026-10-28T10:15:01.000Z';
    sealed = seal(overlongDecision);
    expect(validateDecision(sealed, trustedFor(sealed))).toBe('deny_expired_future_or_nonrecent_auth_or_evidence');

    const oldEvidence = buildDecision('resume_policy');
    oldEvidence.stateEvidence.observedAt = '2026-10-28T09:59:29.000Z';
    sealed = seal(oldEvidence);
    expect(validateDecision(sealed, trustedFor(sealed)))
      .toBe('deny_stale_unavailable_uncertain_or_degraded_authority_increase');

    const oldApproverAuth = buildDecision('release_tenant_kill');
    oldApproverAuth.dualControlBinding.approverRecentAuthenticationAt = '2026-10-28T09:44:59.000Z';
    sealed = seal(oldApproverAuth);
    expect(validateDecision(sealed, trustedFor(sealed)))
      .toBe('deny_self_approval_or_required_dual_control_missing');
  });

  test('denies unknown enums contradictory review history reason and tenant-stop evidence', () => {
    const cases = [
      ['pause_policy', value => { value.stateEvidence.policyCurrentness = 'candidate_claimed_current'; }],
      ['pause_policy', value => { value.reasonBinding.reasonCode = 'free_form_override'; }],
      ['resume_policy', value => { value.actorBinding.recentAuthenticationEvidenceId = null; }],
      ['resume_policy', value => { value.stateEvidence.priorIndependentReviewRequired = true; value.stateEvidence.independentReviewState = 'not_required'; }],
      ['engage_tenant_kill', value => { value.stateEvidence.tenantStopState = 'killed'; }],
    ];
    for (const [operationId, mutate] of cases) {
      const attack = buildDecision(operationId); mutate(attack); const sealed = seal(attack);
      expect(validateDecision(sealed, trustedFor(sealed))).toBe('deny_identity_capability_target_or_state_mismatch');
    }
  });

  test('requires exact distinct dual control for stop release and conditional resume', () => {
    const release = buildDecision('release_tenant_kill');
    expect(validateDecision(release, trustedFor(release)))
      .toBe('accepted_contract_control_only_no_runtime_or_effect_authority');
    for (const mutate of [
      value => { value.dualControlBinding.required = false; },
      value => { value.dualControlBinding.approverActorId = value.actorBinding.actorId; value.dualControlBinding.approverSessionSubjectId = value.actorBinding.actorId; value.dualControlBinding.approverMembershipSubjectId = value.actorBinding.actorId; },
      value => { value.dualControlBinding.approverSessionId = value.actorBinding.sessionId; },
      value => { value.dualControlBinding.approverMembershipId = value.actorBinding.membershipId; },
      value => { value.dualControlBinding.approverMembershipTenantId = '00000000-0000-4000-8000-000000000029'; },
      value => { value.dualControlBinding.approverMembershipRoleId = 'admin'; },
      value => { value.dualControlBinding.approvalExpiresAt = '2026-10-28T09:59:00.000Z'; },
    ]) {
      const attack = clone(release); mutate(attack); const sealed = seal(attack);
      expect(validateDecision(sealed, trustedFor(sealed)))
        .toBe('deny_self_approval_or_required_dual_control_missing');
    }
    const forgedSubject = clone(release);
    forgedSubject.dualControlBinding.approvalSubjectDigest = digestValue('f');
    forgedSubject.decisionDigest = digest(
      parse(CONTRACT_PATH).controlDecisionGrammar.digestNamespace,
      withoutKey(forgedSubject, 'decisionDigest'),
    );
    expect(validateDecision(forgedSubject, trustedFor(forgedSubject)))
      .toBe('deny_self_approval_or_required_dual_control_missing');
    for (const options of [
      { priorBreakGlassUsed: true },
      { priorTenantKillUsed: true },
      { priorUncertainOrInFlightObserved: true },
      { priorIndependentReviewRequired: true },
    ]) {
      const resume = buildDecision('resume_policy', { ...options, dualRequired: true });
      expect(validateDecision(resume, trustedFor(resume)))
        .toBe('accepted_contract_control_only_no_runtime_or_effect_authority');
    }
    const missingDual = buildDecision('resume_policy', { priorBreakGlassUsed: true });
    expect(validateDecision(missingDual, trustedFor(missingDual)))
      .toBe('deny_self_approval_or_required_dual_control_missing');
  });

  test('makes break glass reducing-only append-only reviewed evidence with no auto resume', () => {
    for (const operationId of ['pause_policy', 'engage_tenant_kill', 'drain_policy']) {
      const decision = buildDecision(operationId, { breakGlass: true, sourceCurrentness: 'unavailable' });
      expect(validateDecision(decision, trustedFor(decision)))
        .toBe('accepted_contract_control_only_no_runtime_or_effect_authority');
    }
    const resume = buildDecision('resume_policy');
    resume.breakGlassBinding = clone(buildDecision('pause_policy', { breakGlass: true }).breakGlassBinding);
    resume.reasonBinding.incidentId = UUID.incident;
    resume.reasonBinding.reasonCode = 'degraded_incident_fail_safe';
    const sealed = seal(resume);
    expect(validateDecision(sealed, trustedFor(sealed))).toBe('deny_break_glass_widens_or_restores_authority');
    const contract = parse(CONTRACT_PATH);
    expect(contract.breakGlassContract.expiryBehavior).toContain('never_auto_resumes');
    expect(contract.safeDegradedDefaults.breakGlassExpiry).toBe('keep_reducing_state_no_auto_resume');
  });

  test('cancellation denies claimed uncertain completed and upstream-effect interpretations', () => {
    for (const options of [
      { leasedCount: 1 }, { inFlightCount: 1 }, { uncertainCount: 1 }, { completedCount: 1 },
    ]) {
      const decision = buildDecision('cancel_action_unit', options);
      expect(validateDecision(decision, trustedFor(decision))).toBe('deny_inflight_or_completed_effect_claim');
    }
    const wrongState = buildDecision('cancel_action_unit');
    wrongState.targetBinding.currentState = 'provider_accepted';
    const sealed = seal(wrongState);
    expect(validateDecision(sealed, trustedFor(sealed))).toBe('deny_invalid_transition_or_terminal_reactivation');
    expect(parse(CONTRACT_PATH).stateAndCausalityRules.cancelRequiresQueuedNotClaimedAndZeroLeasedInFlightUncertainCompleted).toBe(true);
  });

  test('denies terminal reactivation wrong transitions and kill-release inference', () => {
    for (const state of ['revoked_terminal', 'retired', 'expired', 'cancelled_terminal']) {
      const decision = buildDecision('resume_policy');
      decision.targetBinding.currentState = state;
      const sealed = seal(decision);
      expect(validateDecision(sealed, trustedFor(sealed))).toBe('deny_invalid_transition_or_terminal_reactivation');
    }
    const release = buildDecision('release_tenant_kill');
    release.stateEvidence.tenantStopState = 'normal';
    const sealed = seal(release);
    expect(validateDecision(sealed, trustedFor(sealed))).toBe('deny_invalid_transition_or_terminal_reactivation');
  });

  test('denies coherent cross-tenant actor session membership capability target and trusted-resolution retargets', () => {
    const decision = buildDecision('resume_policy');
    const trusted = trustedFor(decision);
    for (const mutate of [
      value => { value.tenantId = '00000000-0000-4000-8000-000000000029'; value.targetBinding.tenantId = value.tenantId; value.actorBinding.membershipTenantId = value.tenantId; },
      value => { value.targetBinding.policyId = '00000000-0000-4000-8000-000000000299'; },
      value => { value.targetBinding.policyDigest = digestValue('f'); },
      value => { value.actorBinding.sessionSubjectId = UUID.actor2; },
      value => { value.actorBinding.membershipSubjectId = UUID.actor2; },
      value => { value.actorBinding.capabilityIds = ['automation_pause']; },
      value => { value.authorizationBinding.materialBindingDigest = digestValue('f'); },
    ]) {
      const attack = clone(decision); mutate(attack);
      expect(validateDecision(seal(attack), trusted)).toBe('deny_identity_capability_target_or_state_mismatch');
    }
    const wholeRetarget = clone(decision);
    wholeRetarget.tenantId = '00000000-0000-4000-8000-000000000029';
    wholeRetarget.targetBinding.tenantId = wholeRetarget.tenantId;
    wholeRetarget.actorBinding.membershipTenantId = wholeRetarget.tenantId;
    const sealed = seal(wholeRetarget);
    expect(validateDecision(sealed, trusted)).toBe('deny_identity_capability_target_or_state_mismatch');
  });

  test('rejects accessors symbols toJSON proxies sparse data extras and unsafe numbers before trust', () => {
    const decision = buildDecision();
    const trusted = trustedFor(decision);
    let getterCalls = 0;
    const accessor = clone(decision);
    Object.defineProperty(accessor.stateEvidence, 'queuedCount', {
      enumerable: true, configurable: true, get() { getterCalls += 1; return 0; },
    });
    expect(validateDecision(accessor, trusted)).toBe('deny_missing_or_self_created_trusted_resolution');
    expect(getterCalls).toBe(0);
    const symbol = clone(decision); symbol.targetBinding[Symbol('secret')] = 'provider-token';
    expect(validateDecision(symbol, trusted)).toBe('deny_missing_or_self_created_trusted_resolution');
    const toJSON = clone(decision); toJSON.actorBinding.toJSON = () => decision.actorBinding;
    expect(validateDecision(toJSON, trusted)).toBe('deny_missing_or_self_created_trusted_resolution');
    let traps = 0;
    const proxy = new Proxy(clone(decision), { get(target, key, receiver) { traps += 1; return Reflect.get(target, key, receiver); } });
    expect(validateDecision(proxy, trusted)).toBe('deny_missing_or_self_created_trusted_resolution');
    expect(traps).toBe(0);
    const sparse = clone(decision); sparse.actorBinding.capabilityIds = new Array(1);
    expect(validateDecision(sparse, trusted)).toBe('deny_missing_or_self_created_trusted_resolution');
    const extra = clone(decision); extra.customRole = 'enterprise_super_admin';
    expect(validateDecision(extra, trusted)).toBe('deny_missing_or_self_created_trusted_resolution');
    const unsafe = clone(decision); unsafe.stateEvidence.queuedCount = 1.5;
    expect(validateDecision(unsafe, trusted)).toBe('deny_missing_or_self_created_trusted_resolution');
  });

  test('keeps custom roles thresholds SSO and organization governance in Mission 29', () => {
    const boundary = parse(CONTRACT_PATH).mission29Boundary;
    expect(boundary.retainedForMission29).toEqual([
      'custom_role_definition_or_role_hierarchy', 'enterprise_threshold_or_quorum_administration',
      'organization_scale_multi_tenant_governance', 'delegated_administrator_framework',
      'SSO_SCIM_identity_governance_or_enterprise_access_policy',
      'custom_break_glass_roster_or_approval_workflow',
    ]);
    expect(boundary.Part3DMayUseOnly)
      .toBe('fixed_Part3A_capabilities_current_owner_admin_memberships_and_nonconfigurable_dual_control_rules');
  });

  test('accepts only exact idempotent replay and denies conflicting replay', () => {
    const decision = buildDecision('engage_tenant_kill');
    const trusted = trustedFor(decision);
    expect(validateReplay(decision, clone(decision), trusted)).toBe('idempotent_exact_replay_no_new_authority');
    const changed = clone(decision); changed.reasonBinding.reasonTextDigest = digestValue('f');
    expect(validateReplay(decision, seal(changed), trusted)).toBe('deny_digest_or_replay_conflict');
  });

  test('roadmap and ledger retain released history and only Part 5B current', () => {
    const roadmap = read(ROADMAP_PATH);
    const ledger = read(LEDGER_PATH);
    for (const document of [roadmap, ledger]) {
      expect(document).toContain('Parts 1A–11C are released. Part 11D is the sole implementation candidate.');
      expect(document).toContain('3cd41fe5379d92fe629c62e0ebc3a51d8886c3cc');
      expect(document).toContain(BASE);
      expect(document).toContain('b745a483-1031-4020-9ab2-38c0044e599d');
      expect(document).toContain('27c84d6cd34be043aa2f6388080c90b5500a8ea1d87ab018c9d58f34277e5590');
    }
    expect(ledger).toContain('| 11 | 3C | Owner limits and mandatory minimum constraints | **Released** |');
    expect(ledger).toContain('| 12 | 3D | Pause/revoke/kill/drain/cancel/resume and governance boundary | **Released** |');
    expect(ledger).toContain('| 13 | 4A | Closed trigger catalog over accepted Missions 20–27 facts | **Released** |');
    expect(ledger).toContain('| 14 | 4B | Durable tenant-scoped source snapshot and correction lineage | **Released** |');
    expect(ledger).toContain('| 15 | 4C | Evaluation-time and pre-effect currentness revalidation | **Released** |');
    expect(ledger).toContain('independent audit/PR/merge/deployment unavailable');
  });

  test('keeps runtime database provider effect migration and founder boundaries unavailable', () => {
    const contract = parse(CONTRACT_PATH);
    expect(contract.runtimeBoundary).toEqual({
      contractIsExecutableRuntime: false, controlResolverOrPersistenceAvailable: false,
      routeUiOrDatabaseAvailable: false, schedulerWorkerQueueOrProviderAvailable: false,
      recipientMessageOrExternalEffectAvailable: false, migrationAdded: false,
      laterSlicesMayConsumeOnlyAfterIndependentAcceptance: true,
      acceptedDecisionMeaning: 'accepted_contract_control_only_no_runtime_or_effect_authority',
    });
    expect(contract.unavailableEvidence).toEqual(expect.arrayContaining([
      expect.stringContaining('runtime control resolution'),
      expect.stringContaining('real recipients messages external effects'),
      expect.stringContaining('founder visual approval'),
    ]));
    const migrations = fs.readdirSync(path.join(ROOT, 'migrations')).filter(name => name.endsWith('.sql'));
    expect(migrations).toHaveLength(283);
    expect(migrations.at(-1)).toBe('287_canonical_automation_estimate_quote_resolution_v1.sql');
    expect(migrations.some(name => name.startsWith('288_'))).toBe(false);
    expect(migrations.filter(name => name.startsWith('274'))).toEqual(['274_canonical_automation_trigger_snapshots_v1.sql']);
  });
});
