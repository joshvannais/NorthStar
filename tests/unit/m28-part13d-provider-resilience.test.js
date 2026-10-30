'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { types } = require('util');
const canonicalJson = require('../../src/automation/canonicalJson');

const ROOT = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const contract = JSON.parse(read('docs/architecture/MISSION_28_PART13D_PROVIDER_RESILIENCE_CONTRACT.json'));
const part6C = JSON.parse(read('docs/architecture/MISSION_28_PART6C_DELIVERY_COORDINATION_CONTRACT.json'));
const part6D = JSON.parse(read('docs/architecture/MISSION_28_PART6D_RETRY_RECONCILIATION_CONTRACT.json'));
const part7B = JSON.parse(read('docs/architecture/MISSION_28_PART7B_COMMUNICATION_PERMISSION_CONTRACT.json'));
const part7C = JSON.parse(read('docs/architecture/MISSION_28_PART7C_CONTENT_TEMPLATE_PREVIEW_CONTRACT.json'));
const part7D = JSON.parse(read('docs/architecture/MISSION_28_PART7D_CHANNEL_DELIVERY_HANDOFF_CONTRACT.json'));
const part13A = JSON.parse(read('docs/architecture/MISSION_28_PART13A_PROVIDER_ADAPTER_CAPABILITY_CONTRACT.json'));
const part13B = JSON.parse(read('docs/architecture/MISSION_28_PART13B_CONNECTION_CREDENTIAL_BOUNDARY_CONTRACT.json'));
const part13C = JSON.parse(read('docs/architecture/MISSION_28_PART13C_AUTHENTICATED_CALLBACK_RECONCILIATION_CONTRACT.json'));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const OPAQUE = /^[a-z][a-z0-9_.:-]{0,127}$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const digestLf = relative => crypto.createHash('sha256').update(read(relative).replace(/\r\n?/g, '\n')).digest('hex').toUpperCase();

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const hash = value => `sha256:${crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')}`;

function clonePlain(value, seen = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('number');
    return value;
  }
  if (!value || typeof value !== 'object' || types.isProxy(value) || seen.has(value)) throw new Error('plain');
  seen.add(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length || Object.keys(value).length !== value.length) throw new Error('array');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const result = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !('value' in descriptor) || descriptor.get || descriptor.set) throw new Error('array descriptor');
      result.push(clonePlain(descriptor.value, seen));
    }
    return result;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length) throw new Error('object');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result = {};
  for (const key of Object.keys(descriptors)) {
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !('value' in descriptor) || descriptor.get || descriptor.set) throw new Error('descriptor');
    result[key] = clonePlain(descriptor.value, seen);
  }
  return result;
}

function exactKeys(value, expected, label) {
  if (Object.keys(value).sort().join('\n') !== [...expected].sort().join('\n')) throw new Error(`${label} fields`);
}
function micros(value) {
  if (!TIME.test(value)) throw new Error('time');
  const parsed = Date.parse(`${value.slice(0, 19)}.000Z`);
  if (!Number.isFinite(parsed)) throw new Error('time');
  if (new Date(parsed).toISOString() !== `${value.slice(0, 19)}.000Z`) throw new Error('time');
  return BigInt(parsed) * 1000n + BigInt(value.slice(20, 26));
}
const seconds = value => BigInt(value) * 1000000n;

function materialOf(value) {
  const copy = clonePlain(value);
  for (const field of contract.digestProjectionContract.materialExcludesOnly) delete copy[field];
  return copy;
}
function assessmentMaterial(value) {
  const copy = clonePlain(value);
  delete copy.assessmentDigest;
  return copy;
}
function retryPolicyMaterial(value) {
  const binding = value.retryAuthorityBinding;
  return {attemptCeiling: binding.attemptCeiling, baseDelaySeconds: binding.baseDelaySeconds, maximumDelaySeconds: binding.maximumDelaySeconds, maximumRetryAfterSeconds: binding.maximumRetryAfterSeconds, maximumJitterSeconds: binding.maximumJitterSeconds};
}
function retryAuthorityMaterial(value) {
  const binding = clonePlain(value.retryAuthorityBinding);
  delete binding.retryAuthorityBindingDigest;
  return binding;
}
function circuitHeadMaterial(value) {
  const binding = value.circuitBinding;
  return {circuitId: binding.circuitId, circuitScopeDigest: binding.circuitScopeDigest, circuitState: binding.circuitState, circuitGeneration: binding.circuitGeneration, predecessorCircuitHeadId: binding.predecessorCircuitHeadId, predecessorCircuitHeadDigest: binding.predecessorCircuitHeadDigest, predecessorCircuitGeneration: binding.predecessorCircuitGeneration, circuitTransitionKind: binding.circuitTransitionKind};
}
function seal(value) {
  value.retryAuthorityBinding.retryPolicyDigest = canonicalJson.digest(part6D.decisionEnvelope.retryPolicyDigestNamespace, retryPolicyMaterial(value));
  value.retryAuthorityBinding.retryAuthorityBindingDigest = canonicalJson.digest(contract.bindingRules.retryAuthorityBindingDigestNamespace, retryAuthorityMaterial(value));
  value.circuitBinding.circuitHeadDigest = hash(circuitHeadMaterial(value));
  value.materialDigest = hash(materialOf(value));
  value.idempotencyKeyDigest = hash({domain: 'mission28.part13d.provider-resilience.v1', material: materialOf(value)});
  value.assessmentDigest = hash(assessmentMaterial(value));
  return value;
}

function circuitScopeMaterial(value) {
  return {
    tenantId: value.tenantId,
    adapterFamilyId: value.sourceProviderBinding.adapterFamilyId,
    environment: value.sourceProviderBinding.environment,
    providerAccountBindingId: value.sourceProviderBinding.providerAccountBindingId,
    providerAccountIdentityDigest: value.sourceProviderBinding.providerAccountIdentityDigest,
    connectionId: value.sourceProviderBinding.connectionId,
    connectionDigest: value.sourceProviderBinding.connectionDigest,
    credentialVersionId: value.sourceProviderBinding.credentialVersionId,
    credentialBindingDigest: value.sourceProviderBinding.credentialBindingDigest,
    capabilityResolutionDigest: value.sourceProviderBinding.capabilityResolutionDigest
  };
}

function baseFixture() {
  const unitId = uuid(6);
  const value = {
    schemaVersion: contract.resilienceEnvelope.schemaVersion,
    tenantId: uuid(1),
    assessmentId: uuid(2),
    actionBinding: {
      transactionId: uuid(3), runId: uuid(4), unitId, outboxId: uuid(5), attemptId: uuid(7), attemptSequence: 1,
      providerRequestIdentity: `m28:${unitId}`, providerRequestIdentityDigest: hash(`m28:${unitId}`), idempotencyReceiptDigest: hash('receipt-6')
    },
    authorityBinding: {
      authorizationRecordId: uuid(8), authorizationRecordDigest: hash('authorization-8'), policyId: uuid(9), policyVersion: 1, policyDigest: hash('policy-9'), sourceSetDigest: hash('sources-9'),
      senderRecipientResolutionId: uuid(10), senderRecipientResolutionDigest: hash('recipient-10'), permissionResolutionId: uuid(11), permissionResolutionDigest: hash('permission-11'),
      contentPreviewId: uuid(12), contentPreviewDigest: hash('content-12'), contentTemplateId: 'owner_approval_request_content_v1', contentTemplateVersion: 1, contentTemplateDigest: part7C.approvedTemplateCatalog[1].contentTemplateDigest,
      attachmentSetDigest: hash('empty-attachment-set'), channelResolutionId: uuid(13), channelResolutionDigest: hash('channel-13'), requestedChannelId: 'email',
      deliveryEvidenceHeadId: uuid(14), deliveryEvidenceHeadDigest: hash('delivery-head-14'), callbackEvidenceHeadId: uuid(15), callbackEvidenceHeadDigest: hash('callback-head-15'), callbackEvidenceHeadSequence: 1
    },
    retryAuthorityBinding: {
      retryDecisionId: uuid(60), retryDecisionDigest: hash('part6d-decision-60'), retryDecisionState: 'retry_scheduled_no_effect', retryDecisionCurrentness: 'latest_exact_current',
      actionUnitId: unitId, providerRequestIdentity: `m28:${unitId}`, attemptOrdinal: 1, attemptCeiling: 3, baseDelaySeconds: 10, maximumDelaySeconds: 300,
      maximumRetryAfterSeconds: 300, maximumJitterSeconds: 20, retryPolicyDigest: '', retryAuthorityBindingDigest: ''
    },
    sourceProviderBinding: {
      adapterFamilyId: 'provider_neutral_email', environment: 'testmode', providerAccountBindingId: uuid(16), providerAccountIdentityDigest: hash('provider-account-16'),
      connectionId: uuid(17), connectionDigest: hash('connection-17'), credentialVersionId: uuid(18), credentialBindingDigest: hash('credential-18'), capabilityResolutionDigest: hash('capability-18')
    },
    incidentBinding: {
      incidentId: uuid(19), incidentKind: 'provider_throttled_definite_no_acceptance', incidentEvidenceDigest: hash('incident-19'), incidentObservedAt: '2026-10-30T11:59:00.000000Z', retryAfterSeconds: 120, definiteNoAcceptance: true
    },
    reconciliationBinding: {outcome: 'not_required', reconciliationEvidenceHeadId: null, reconciliationEvidenceHeadDigest: null, reconciliationEvidenceHeadSequence: null, predecessorCallbackEvidenceHeadId: null, predecessorCallbackEvidenceHeadDigest: null, predecessorCallbackEvidenceHeadSequence: null, priorProviderLaneTerminallyClosed: null},
    circuitBinding: {circuitId: uuid(20), circuitScopeDigest: hash('circuit-scope-20'), circuitState: 'closed', circuitGeneration: 1, circuitHeadId: uuid(61), circuitHeadDigest: '', predecessorCircuitHeadId: null, predecessorCircuitHeadDigest: null, predecessorCircuitGeneration: null, circuitTransitionKind: 'initialize_closed'},
    fallbackBinding: {
      fallbackKind: 'none', fallbackPlanId: null, fallbackPlanVersion: null, fallbackPlanDigest: null, targetAdapterFamilyId: null, targetEnvironment: null, targetProviderAccountBindingId: null,
      targetProviderAccountIdentityDigest: null, targetConnectionId: null, targetConnectionDigest: null, targetCredentialVersionId: null, targetCredentialBindingDigest: null,
      targetCapabilityResolutionDigest: null, targetChannelId: null, targetPermissionResolutionId: null, targetPermissionResolutionDigest: null, targetChannelResolutionId: null,
      targetChannelResolutionDigest: null, targetContentPreviewDigest: null, targetContentTemplateDigest: null, targetAttachmentSetDigest: null, fallbackHop: 0,
      priorProviderLaneClosed: null, targetProviderLaneState: null
    },
    decisionBinding: {
      disposition: 'bounded_same_provider_wait_no_effect', retryAfterAppliedSeconds: 120, fallbackReviewState: 'none', channelSwitchState: 'none', providerSwitchState: 'none', duplicatePreventionState: 'single_provider_lane_enforced'
    },
    assessedAt: '2026-10-30T12:00:00.000000Z',
    materialDigest: '', idempotencyKeyDigest: '', assessmentDigest: ''
  };
  value.circuitBinding.circuitScopeDigest = hash(circuitScopeMaterial(value));
  return seal(value);
}

function incidentFixture(incidentKind) {
  const value = baseFixture();
  const row = contract.incidentCatalog.find(item => item.incidentKind === incidentKind);
  value.incidentBinding.incidentKind = incidentKind;
  value.incidentBinding.incidentEvidenceDigest = hash(`incident-${incidentKind}`);
  value.incidentBinding.retryAfterSeconds = row.retryAfterAllowed ? 120 : null;
  value.incidentBinding.definiteNoAcceptance = ['retryable_definite_no_acceptance', 'terminal_for_current_quota_window', 'terminal_for_exact_template'].includes(row.classification);
  value.retryAuthorityBinding.retryDecisionState = row.requiredPart6DState;
  value.circuitBinding.circuitState = ['credential_failure', 'degraded_capability', 'circuit_breaker_open'].includes(incidentKind) ? 'open' : 'closed';
  value.circuitBinding.circuitTransitionKind = value.circuitBinding.circuitState === 'open' ? 'initialize_open' : 'initialize_closed';
  if (['provider_outage','provider_acknowledgement_unknown'].includes(incidentKind)) {
    Object.assign(value.reconciliationBinding, {outcome: 'pending_uncertain', reconciliationEvidenceHeadId: value.authorityBinding.callbackEvidenceHeadId, reconciliationEvidenceHeadDigest: value.authorityBinding.callbackEvidenceHeadDigest, reconciliationEvidenceHeadSequence: value.authorityBinding.callbackEvidenceHeadSequence, predecessorCallbackEvidenceHeadId: null, predecessorCallbackEvidenceHeadDigest: null, predecessorCallbackEvidenceHeadSequence: null, priorProviderLaneTerminallyClosed: false});
  }
  value.decisionBinding.disposition = row.requiredDisposition;
  value.decisionBinding.retryAfterAppliedSeconds = row.retryAfterAllowed ? 120 : null;
  return seal(value);
}

function providerSwitchFixture(source = incidentFixture('quota_exhausted')) {
  const value = clonePlain(source);
  Object.assign(value.fallbackBinding, {
    fallbackKind: 'provider_switch_review_only', fallbackPlanId: uuid(21), fallbackPlanVersion: 1, fallbackPlanDigest: hash('fallback-plan-21'), targetAdapterFamilyId: 'provider_neutral_email', targetEnvironment: value.sourceProviderBinding.environment,
    targetProviderAccountBindingId: uuid(22), targetProviderAccountIdentityDigest: hash('target-account-22'), targetConnectionId: uuid(23), targetConnectionDigest: hash('target-connection-23'),
    targetCredentialVersionId: uuid(24), targetCredentialBindingDigest: hash('target-credential-24'), targetCapabilityResolutionDigest: hash('target-capability-24'),
    targetChannelId: value.authorityBinding.requestedChannelId, targetPermissionResolutionId: value.authorityBinding.permissionResolutionId,
    targetPermissionResolutionDigest: value.authorityBinding.permissionResolutionDigest, targetChannelResolutionId: value.authorityBinding.channelResolutionId,
    targetChannelResolutionDigest: value.authorityBinding.channelResolutionDigest, targetContentPreviewDigest: value.authorityBinding.contentPreviewDigest,
    targetContentTemplateDigest: value.authorityBinding.contentTemplateDigest, targetAttachmentSetDigest: value.authorityBinding.attachmentSetDigest,
    fallbackHop: 1, priorProviderLaneClosed: true, targetProviderLaneState: 'review_only_not_active'
  });
  Object.assign(value.decisionBinding, {disposition: 'fallback_review_required_no_effect', retryAfterAppliedSeconds: null, fallbackReviewState: 'review_required_no_effect', channelSwitchState: 'none', providerSwitchState: 'review_required_no_effect'});
  return seal(value);
}

function reconciledFixture(incidentKind, outcome) {
  const value = incidentFixture(incidentKind);
  if (!['provider_outage','provider_acknowledgement_unknown'].includes(incidentKind) || !['reconciled_accepted_or_effect_possible','reconciled_definite_no_acceptance'].includes(outcome)) throw new Error('reconciliation fixture');
  const identityOffset = (incidentKind === 'provider_outage' ? 0 : 2) + (outcome === 'reconciled_definite_no_acceptance' ? 1 : 0);
  value.assessmentId = uuid(75 + identityOffset);
  Object.assign(value.reconciliationBinding, {
    outcome,
    reconciliationEvidenceHeadId: uuid(outcome === 'reconciled_definite_no_acceptance' ? 70 : 71),
    reconciliationEvidenceHeadDigest: hash(`reconciliation-${outcome}`),
    reconciliationEvidenceHeadSequence: value.authorityBinding.callbackEvidenceHeadSequence + 1,
    predecessorCallbackEvidenceHeadId: value.authorityBinding.callbackEvidenceHeadId,
    predecessorCallbackEvidenceHeadDigest: value.authorityBinding.callbackEvidenceHeadDigest,
    predecessorCallbackEvidenceHeadSequence: value.authorityBinding.callbackEvidenceHeadSequence,
    priorProviderLaneTerminallyClosed: outcome === 'reconciled_definite_no_acceptance'
  });
  value.incidentBinding.definiteNoAcceptance = outcome === 'reconciled_definite_no_acceptance';
  value.retryAuthorityBinding.retryDecisionState = outcome === 'reconciled_definite_no_acceptance' ? 'permanent_stop_terminal' : 'permanent_stop_unknown_or_unsafe';
  value.decisionBinding.disposition = outcome === 'reconciled_definite_no_acceptance' ? 'stop_no_effect' : 'reconciliation_required_no_resend';
  return seal(value);
}

function advancedCircuitFixture(source = incidentFixture('circuit_breaker_open'), headNumber = 72) {
  const value = clonePlain(source);
  const predecessor = clonePlain(source.circuitBinding);
  value.assessmentId = uuid(headNumber + 100);
  value.incidentBinding.incidentId = uuid(headNumber + 200);
  value.incidentBinding.incidentEvidenceDigest = hash(`incident-circuit-${headNumber}`);
  value.circuitBinding.circuitGeneration = predecessor.circuitGeneration + 1;
  value.circuitBinding.circuitHeadId = uuid(headNumber);
  value.circuitBinding.predecessorCircuitHeadId = predecessor.circuitHeadId;
  value.circuitBinding.predecessorCircuitHeadDigest = predecessor.circuitHeadDigest;
  value.circuitBinding.predecessorCircuitGeneration = predecessor.circuitGeneration;
  value.circuitBinding.circuitTransitionKind = 'open';
  return seal(value);
}

function channelSwitchFixture() {
  const value = providerSwitchFixture();
  Object.assign(value.fallbackBinding, {
    fallbackKind: 'channel_switch_review_only', targetAdapterFamilyId: 'provider_neutral_sms', targetChannelId: 'sms',
    targetPermissionResolutionId: uuid(25), targetPermissionResolutionDigest: hash('sms-permission-25'), targetChannelResolutionId: uuid(26), targetChannelResolutionDigest: hash('sms-channel-26')
  });
  Object.assign(value.decisionBinding, {channelSwitchState: 'review_required_no_effect', providerSwitchState: 'none'});
  return seal(value);
}

const uuidFields = [
  ['tenantId'], ['assessmentId'], ['actionBinding','transactionId'], ['actionBinding','runId'], ['actionBinding','unitId'], ['actionBinding','outboxId'], ['actionBinding','attemptId'],
  ['authorityBinding','authorizationRecordId'], ['authorityBinding','policyId'], ['authorityBinding','senderRecipientResolutionId'], ['authorityBinding','permissionResolutionId'], ['authorityBinding','contentPreviewId'],
  ['authorityBinding','channelResolutionId'], ['authorityBinding','deliveryEvidenceHeadId'], ['authorityBinding','callbackEvidenceHeadId'], ['sourceProviderBinding','providerAccountBindingId'],
  ['retryAuthorityBinding','retryDecisionId'], ['retryAuthorityBinding','actionUnitId'], ['sourceProviderBinding','connectionId'], ['sourceProviderBinding','credentialVersionId'], ['incidentBinding','incidentId'], ['circuitBinding','circuitId'], ['circuitBinding','circuitHeadId']
];
const digestFields = [
  ['actionBinding','providerRequestIdentityDigest'], ['actionBinding','idempotencyReceiptDigest'], ['authorityBinding','authorizationRecordDigest'], ['authorityBinding','policyDigest'],
  ['authorityBinding','sourceSetDigest'], ['authorityBinding','senderRecipientResolutionDigest'], ['authorityBinding','permissionResolutionDigest'], ['authorityBinding','contentPreviewDigest'],
  ['authorityBinding','contentTemplateDigest'], ['authorityBinding','attachmentSetDigest'], ['authorityBinding','channelResolutionDigest'], ['authorityBinding','deliveryEvidenceHeadDigest'],
  ['authorityBinding','callbackEvidenceHeadDigest'], ['sourceProviderBinding','providerAccountIdentityDigest'], ['sourceProviderBinding','connectionDigest'],
  ['retryAuthorityBinding','retryDecisionDigest'], ['retryAuthorityBinding','retryPolicyDigest'], ['retryAuthorityBinding','retryAuthorityBindingDigest'], ['sourceProviderBinding','credentialBindingDigest'], ['sourceProviderBinding','capabilityResolutionDigest'], ['incidentBinding','incidentEvidenceDigest'], ['circuitBinding','circuitScopeDigest'],
  ['circuitBinding','circuitHeadDigest'], ['materialDigest'], ['idempotencyKeyDigest'], ['assessmentDigest']
];
const get = (value, pathParts) => pathParts.reduce((item, key) => item[key], value);

function validateAssessment(candidate, trusted) {
  const value = clonePlain(candidate); const resolution = clonePlain(trusted);
  if (JSON.stringify(canonical(value)) !== JSON.stringify(canonical(resolution))) throw new Error('trusted resolution');
  exactKeys(value, contract.resilienceEnvelope.exactFields, 'assessment');
  exactKeys(value.actionBinding, contract.resilienceEnvelope.actionBindingExactFields, 'action');
  exactKeys(value.authorityBinding, contract.resilienceEnvelope.authorityBindingExactFields, 'authority');
  exactKeys(value.retryAuthorityBinding, contract.resilienceEnvelope.retryAuthorityBindingExactFields, 'retry authority');
  exactKeys(value.sourceProviderBinding, contract.resilienceEnvelope.sourceProviderBindingExactFields, 'provider');
  exactKeys(value.incidentBinding, contract.resilienceEnvelope.incidentBindingExactFields, 'incident');
  exactKeys(value.reconciliationBinding, contract.resilienceEnvelope.reconciliationBindingExactFields, 'reconciliation');
  exactKeys(value.circuitBinding, contract.resilienceEnvelope.circuitBindingExactFields, 'circuit');
  exactKeys(value.fallbackBinding, contract.resilienceEnvelope.fallbackBindingExactFields, 'fallback');
  exactKeys(value.decisionBinding, contract.resilienceEnvelope.decisionBindingExactFields, 'decision');
  if (value.schemaVersion !== contract.resilienceEnvelope.schemaVersion) throw new Error('schema');
  for (const field of uuidFields) if (!UUID.test(get(value, field))) throw new Error('uuid');
  for (const field of digestFields) if (!DIGEST.test(get(value, field))) throw new Error('digest');
  if (!OPAQUE.test(value.sourceProviderBinding.adapterFamilyId) || !['testmode','livemode'].includes(value.sourceProviderBinding.environment)) throw new Error('provider primitive');
  for (const field of ['contentTemplateId','requestedChannelId']) if (!OPAQUE.test(value.authorityBinding[field])) throw new Error('authority opaque');
  const template = part7C.approvedTemplateCatalog.find(item => item.contentTemplateId === value.authorityBinding.contentTemplateId);
  if (!template || template.contentTemplateVersion !== value.authorityBinding.contentTemplateVersion || template.contentTemplateDigest !== value.authorityBinding.contentTemplateDigest) throw new Error('template authority');
  const adapter = part13A.adapterFamilies.find(item => item.adapterFamilyId === value.sourceProviderBinding.adapterFamilyId);
  const channel = part7D.channelCatalog.find(item => item.channelId === value.authorityBinding.requestedChannelId);
  if (!adapter || adapter.adapterState !== 'disabled' || adapter.providerMode !== 'provider_disabled' || !channel || channel.transportClass !== adapter.adapterFamilyId || channel.resultState !== 'unavailable_external_channel') throw new Error('provider channel authority');
  if (!Number.isSafeInteger(value.actionBinding.attemptSequence) || value.actionBinding.attemptSequence < 1 || value.actionBinding.attemptSequence > contract.bounds.maximumAttemptSequence) throw new Error('attempt');
  if (!Number.isSafeInteger(value.authorityBinding.policyVersion) || value.authorityBinding.policyVersion < 1 || !Number.isSafeInteger(value.authorityBinding.contentTemplateVersion) || value.authorityBinding.contentTemplateVersion < 1) throw new Error('version');
  if (!Number.isSafeInteger(value.authorityBinding.callbackEvidenceHeadSequence) || value.authorityBinding.callbackEvidenceHeadSequence < 1) throw new Error('callback head sequence');
  const retry = value.retryAuthorityBinding;
  if (retry.retryDecisionCurrentness !== 'latest_exact_current' || retry.actionUnitId !== value.actionBinding.unitId || retry.providerRequestIdentity !== value.actionBinding.providerRequestIdentity || retry.attemptOrdinal !== value.actionBinding.attemptSequence) throw new Error('retry action authority');
  if (![retry.attemptOrdinal,retry.attemptCeiling,retry.baseDelaySeconds,retry.maximumDelaySeconds,retry.maximumRetryAfterSeconds,retry.maximumJitterSeconds].every(Number.isSafeInteger) || retry.attemptOrdinal < 1 || retry.attemptOrdinal > retry.attemptCeiling || retry.attemptCeiling < part6D.retryPolicyContract.minimumAttemptCeiling || retry.attemptCeiling > part6D.retryPolicyContract.maximumAttemptCeiling || retry.baseDelaySeconds < part6D.retryPolicyContract.minimumBaseDelaySeconds || retry.baseDelaySeconds > part6D.retryPolicyContract.maximumBaseDelaySeconds || retry.maximumDelaySeconds < retry.baseDelaySeconds || retry.maximumDelaySeconds > part6D.retryPolicyContract.maximumDelaySeconds || retry.maximumRetryAfterSeconds < 1 || retry.maximumRetryAfterSeconds > retry.maximumDelaySeconds || retry.maximumRetryAfterSeconds > part6D.retryPolicyContract.maximumRetryAfterSeconds || retry.maximumJitterSeconds < 0 || retry.maximumJitterSeconds > part6D.retryPolicyContract.maximumJitterSeconds) throw new Error('retry policy bounds');
  if (retry.retryPolicyDigest !== canonicalJson.digest(part6D.decisionEnvelope.retryPolicyDigestNamespace, retryPolicyMaterial(value))) throw new Error('retry policy digest');
  if (retry.retryAuthorityBindingDigest !== canonicalJson.digest(contract.bindingRules.retryAuthorityBindingDigestNamespace, retryAuthorityMaterial(value))) throw new Error('retry authority binding digest');
  if (!Number.isSafeInteger(value.circuitBinding.circuitGeneration) || value.circuitBinding.circuitGeneration < 1 || value.circuitBinding.circuitGeneration > contract.bounds.maximumCircuitGeneration || value.circuitBinding.circuitHeadDigest !== hash(circuitHeadMaterial(value))) throw new Error('circuit generation');
  if (value.circuitBinding.circuitGeneration === 1) {
    if (value.circuitBinding.predecessorCircuitHeadId !== null || value.circuitBinding.predecessorCircuitHeadDigest !== null || value.circuitBinding.predecessorCircuitGeneration !== null || !['initialize_closed','initialize_open'].includes(value.circuitBinding.circuitTransitionKind)) throw new Error('circuit initial lineage');
  } else if (!UUID.test(value.circuitBinding.predecessorCircuitHeadId) || !DIGEST.test(value.circuitBinding.predecessorCircuitHeadDigest) || !Number.isSafeInteger(value.circuitBinding.predecessorCircuitGeneration) || value.circuitBinding.predecessorCircuitGeneration !== value.circuitBinding.circuitGeneration - 1 || value.circuitBinding.circuitHeadId === value.circuitBinding.predecessorCircuitHeadId || value.circuitBinding.circuitHeadDigest === value.circuitBinding.predecessorCircuitHeadDigest || !['open','close_after_separate_current_reconciliation'].includes(value.circuitBinding.circuitTransitionKind)) throw new Error('circuit predecessor lineage');
  if (value.actionBinding.providerRequestIdentity !== `m28:${value.actionBinding.unitId}` || value.actionBinding.providerRequestIdentityDigest !== hash(value.actionBinding.providerRequestIdentity)) throw new Error('request identity');
  if (value.circuitBinding.circuitScopeDigest !== hash(circuitScopeMaterial(value))) throw new Error('circuit scope');
  const incidentTime = micros(value.incidentBinding.incidentObservedAt); const assessed = micros(value.assessedAt);
  if (incidentTime > assessed || assessed - incidentTime > seconds(contract.bounds.maximumIncidentAgeSeconds)) throw new Error('incident time');
  const row = contract.incidentCatalog.find(item => item.incidentKind === value.incidentBinding.incidentKind);
  if (!row) throw new Error('incident kind');
  const reconciliation = value.reconciliationBinding; const reconciliationRow = contract.reconciliationOutcomeCatalog.find(item => item.outcome === reconciliation.outcome);
  if (!reconciliationRow) throw new Error('reconciliation outcome');
  const uncertainIncident = ['provider_outage','provider_acknowledgement_unknown'].includes(row.incidentKind);
  if (!uncertainIncident) {
    if (reconciliation.outcome !== 'not_required' || Object.entries(reconciliation).some(([key,item]) => key !== 'outcome' && item !== null)) throw new Error('reconciliation not required');
  } else if (reconciliation.outcome === 'pending_uncertain') {
    if (reconciliation.reconciliationEvidenceHeadId !== value.authorityBinding.callbackEvidenceHeadId || reconciliation.reconciliationEvidenceHeadDigest !== value.authorityBinding.callbackEvidenceHeadDigest || reconciliation.reconciliationEvidenceHeadSequence !== value.authorityBinding.callbackEvidenceHeadSequence || reconciliation.predecessorCallbackEvidenceHeadId !== null || reconciliation.predecessorCallbackEvidenceHeadDigest !== null || reconciliation.predecessorCallbackEvidenceHeadSequence !== null || reconciliation.priorProviderLaneTerminallyClosed !== false) throw new Error('pending reconciliation lineage');
  } else if (['reconciled_accepted_or_effect_possible','reconciled_definite_no_acceptance'].includes(reconciliation.outcome)) {
    if (!UUID.test(reconciliation.reconciliationEvidenceHeadId) || !DIGEST.test(reconciliation.reconciliationEvidenceHeadDigest) || reconciliation.reconciliationEvidenceHeadId === value.authorityBinding.callbackEvidenceHeadId || reconciliation.reconciliationEvidenceHeadDigest === value.authorityBinding.callbackEvidenceHeadDigest || reconciliation.reconciliationEvidenceHeadSequence !== value.authorityBinding.callbackEvidenceHeadSequence + 1 || reconciliation.predecessorCallbackEvidenceHeadId !== value.authorityBinding.callbackEvidenceHeadId || reconciliation.predecessorCallbackEvidenceHeadDigest !== value.authorityBinding.callbackEvidenceHeadDigest || reconciliation.predecessorCallbackEvidenceHeadSequence !== value.authorityBinding.callbackEvidenceHeadSequence || reconciliation.priorProviderLaneTerminallyClosed !== reconciliationRow.priorLaneTerminallyClosed) throw new Error('reconciled lineage');
  } else throw new Error('uncertain reconciliation state');
  if (reconciliationRow.definiteNoAcceptance !== null && value.incidentBinding.definiteNoAcceptance !== reconciliationRow.definiteNoAcceptance) throw new Error('reconciliation acceptance');
  const expectedRetryState = reconciliationRow.requiredPart6DState || row.requiredPart6DState;
  if (retry.retryDecisionState !== expectedRetryState) throw new Error('retry decision state');
  if (!['closed','open'].includes(value.circuitBinding.circuitState)) throw new Error('circuit state');
  const mustOpen = ['credential_failure','degraded_capability','circuit_breaker_open'].includes(row.incidentKind);
  if ((mustOpen && value.circuitBinding.circuitState !== 'open') || (!mustOpen && value.circuitBinding.circuitState !== 'closed')) throw new Error('circuit coherence');
  if (row.retryAfterAllowed) {
    if (!Number.isSafeInteger(value.incidentBinding.retryAfterSeconds) || value.incidentBinding.retryAfterSeconds < 1 || value.incidentBinding.retryAfterSeconds > contract.bounds.maximumRetryAfterSeconds || value.incidentBinding.retryAfterSeconds > retry.maximumRetryAfterSeconds || value.incidentBinding.retryAfterSeconds > retry.maximumDelaySeconds) throw new Error('retry after');
  } else if (value.incidentBinding.retryAfterSeconds !== null) throw new Error('retry after');
  const requiredDefinite = reconciliation.outcome === 'reconciled_definite_no_acceptance' || ['retryable_definite_no_acceptance','terminal_for_current_quota_window','terminal_for_exact_template'].includes(row.classification);
  if (value.incidentBinding.definiteNoAcceptance !== requiredDefinite) throw new Error('no acceptance');
  const fallback = value.fallbackBinding; const decision = value.decisionBinding;
  if (!contract.fallbackAndSwitchContract.allowedKinds.includes(fallback.fallbackKind)) throw new Error('fallback kind');
  if (decision.duplicatePreventionState !== 'single_provider_lane_enforced') throw new Error('duplicate prevention');
  const targetNullable = contract.resilienceEnvelope.fallbackBindingExactFields.filter(field => !['fallbackKind','fallbackHop','priorProviderLaneClosed','targetProviderLaneState'].includes(field));
  if (fallback.fallbackKind === 'none') {
    if (fallback.fallbackHop !== 0 || fallback.priorProviderLaneClosed !== null || fallback.targetProviderLaneState !== null || targetNullable.some(field => fallback[field] !== null)) throw new Error('no fallback');
    const expectedDisposition = reconciliation.outcome === 'reconciled_definite_no_acceptance' ? 'stop_no_effect' : row.requiredDisposition;
    if (decision.disposition !== expectedDisposition || decision.retryAfterAppliedSeconds !== value.incidentBinding.retryAfterSeconds || decision.fallbackReviewState !== 'none' || decision.channelSwitchState !== 'none' || decision.providerSwitchState !== 'none') throw new Error('incident disposition');
  } else {
    const fallbackReviewAllowed = row.fallbackReviewAllowed || reconciliationRow.fallbackReviewAllowed;
    if (!fallbackReviewAllowed || !value.incidentBinding.definiteNoAcceptance || fallback.fallbackHop !== 1 || fallback.priorProviderLaneClosed !== true || fallback.targetProviderLaneState !== 'review_only_not_active' || (uncertainIncident && reconciliation.priorProviderLaneTerminallyClosed !== true)) throw new Error('fallback authority');
    if (targetNullable.some(field => fallback[field] === null)) throw new Error('fallback target');
    for (const field of ['fallbackPlanId','targetProviderAccountBindingId','targetConnectionId','targetCredentialVersionId','targetPermissionResolutionId','targetChannelResolutionId']) if (!UUID.test(fallback[field])) throw new Error('fallback uuid');
    for (const field of ['fallbackPlanDigest','targetProviderAccountIdentityDigest','targetConnectionDigest','targetCredentialBindingDigest','targetCapabilityResolutionDigest','targetPermissionResolutionDigest','targetChannelResolutionDigest','targetContentPreviewDigest','targetContentTemplateDigest','targetAttachmentSetDigest']) if (!DIGEST.test(fallback[field])) throw new Error('fallback digest');
    if (!Number.isSafeInteger(fallback.fallbackPlanVersion) || fallback.fallbackPlanVersion < 1 || !OPAQUE.test(fallback.targetAdapterFamilyId) || !OPAQUE.test(fallback.targetChannelId) || fallback.targetEnvironment !== value.sourceProviderBinding.environment) throw new Error('fallback primitive');
    const targetAdapter = part13A.adapterFamilies.find(item => item.adapterFamilyId === fallback.targetAdapterFamilyId);
    const targetChannel = part7D.channelCatalog.find(item => item.channelId === fallback.targetChannelId);
    if (!targetAdapter || targetAdapter.adapterState !== 'disabled' || targetAdapter.providerMode !== 'provider_disabled' || !targetChannel || targetChannel.transportClass !== targetAdapter.adapterFamilyId || targetChannel.resultState !== 'unavailable_external_channel') throw new Error('fallback provider channel authority');
    if (fallback.targetContentPreviewDigest !== value.authorityBinding.contentPreviewDigest || fallback.targetContentTemplateDigest !== value.authorityBinding.contentTemplateDigest || fallback.targetAttachmentSetDigest !== value.authorityBinding.attachmentSetDigest) throw new Error('content substitution');
    if (decision.disposition !== 'fallback_review_required_no_effect' || decision.retryAfterAppliedSeconds !== null || decision.fallbackReviewState !== 'review_required_no_effect') throw new Error('fallback disposition');
    if (fallback.fallbackKind === 'provider_switch_review_only') {
      if (fallback.targetChannelId !== value.authorityBinding.requestedChannelId || fallback.targetPermissionResolutionId !== value.authorityBinding.permissionResolutionId || fallback.targetPermissionResolutionDigest !== value.authorityBinding.permissionResolutionDigest || fallback.targetChannelResolutionId !== value.authorityBinding.channelResolutionId || fallback.targetChannelResolutionDigest !== value.authorityBinding.channelResolutionDigest || decision.providerSwitchState !== 'review_required_no_effect' || decision.channelSwitchState !== 'none') throw new Error('provider switch');
      if (fallback.targetProviderAccountBindingId === value.sourceProviderBinding.providerAccountBindingId || fallback.targetProviderAccountIdentityDigest === value.sourceProviderBinding.providerAccountIdentityDigest || fallback.targetConnectionId === value.sourceProviderBinding.connectionId || fallback.targetConnectionDigest === value.sourceProviderBinding.connectionDigest || fallback.targetCredentialVersionId === value.sourceProviderBinding.credentialVersionId || fallback.targetCredentialBindingDigest === value.sourceProviderBinding.credentialBindingDigest) throw new Error('provider switch identity');
    } else if (fallback.targetChannelId === value.authorityBinding.requestedChannelId || fallback.targetPermissionResolutionId === value.authorityBinding.permissionResolutionId || fallback.targetChannelResolutionId === value.authorityBinding.channelResolutionId || decision.channelSwitchState !== 'review_required_no_effect' || decision.providerSwitchState !== 'none') throw new Error('channel switch');
  }
  if (value.materialDigest !== hash(materialOf(value)) || value.idempotencyKeyDigest !== hash({domain: 'mission28.part13d.provider-resilience.v1', material: materialOf(value)}) || value.assessmentDigest !== hash(assessmentMaterial(value))) throw new Error('seal');
  return true;
}

function coherentReject(mutate, fixture = baseFixture()) {
  const value = clonePlain(fixture); mutate(value); seal(value);
  expect(() => validateAssessment(value, clonePlain(value))).toThrow();
}

function trustedReject(mutate, fixture = baseFixture()) {
  const trusted = clonePlain(fixture); const candidate = clonePlain(fixture); mutate(candidate); seal(candidate);
  expect(() => validateAssessment(candidate, trusted)).toThrow('trusted resolution');
}

class AssessmentHistory {
  constructor() { this.byId = new Map(); this.byMaterial = new Map(); this.circuits = new CircuitHeadHistory(); this.reconciliations = new ReconciliationHeadHistory(); }
  record(candidate, trusted) {
    validateAssessment(candidate, trusted);
    const existing = this.byId.get(candidate.assessmentId);
    if (existing) {
      if (existing !== candidate.assessmentDigest) throw new Error('assessment conflict');
      return 'idempotent_historical_replay';
    }
    if (this.byMaterial.has(candidate.idempotencyKeyDigest)) throw new Error('semantic clone reuse');
    const circuitPlan = this.circuits.plan(candidate);
    const reconciliationPlan = this.reconciliations.plan(candidate);
    this.circuits.commit(circuitPlan);
    this.reconciliations.commit(reconciliationPlan);
    this.byId.set(candidate.assessmentId, candidate.assessmentDigest);
    this.byMaterial.set(candidate.idempotencyKeyDigest, candidate.assessmentId);
    return 'recorded_no_effect';
  }
}

class CircuitHeadHistory {
  constructor() { this.byScope = new Map(); }
  plan(value) {
    const binding = value.circuitBinding;
    const scope = `${value.tenantId}|${binding.circuitScopeDigest}`;
    const current = this.byScope.get(scope);
    const head = {circuitId: binding.circuitId, id: binding.circuitHeadId, digest: binding.circuitHeadDigest, generation: binding.circuitGeneration};
    if (!current) {
      if (head.generation !== 1 || binding.predecessorCircuitHeadId !== null || binding.predecessorCircuitHeadDigest !== null || binding.predecessorCircuitGeneration !== null) throw new Error('circuit initial head');
      return {scope, head};
    }
    if (head.id === current.id && head.digest === current.digest && head.generation === current.generation && head.circuitId === current.circuitId) return null;
    if (head.circuitId !== current.circuitId || head.generation !== current.generation + 1 || binding.predecessorCircuitHeadId !== current.id || binding.predecessorCircuitHeadDigest !== current.digest || binding.predecessorCircuitGeneration !== current.generation || head.id === current.id || head.digest === current.digest) throw new Error('circuit authoritative head');
    return {scope, head};
  }
  commit(plan) { if (plan) this.byScope.set(plan.scope, plan.head); }
}

class ReconciliationHeadHistory {
  constructor() { this.byScope = new Map(); }
  plan(value) {
    const binding = value.reconciliationBinding;
    if (binding.outcome === 'not_required') return null;
    const scope = `${value.tenantId}|${value.actionBinding.unitId}|${value.authorityBinding.callbackEvidenceHeadId}`;
    const current = this.byScope.get(scope);
    const head = {id: binding.reconciliationEvidenceHeadId, digest: binding.reconciliationEvidenceHeadDigest, sequence: binding.reconciliationEvidenceHeadSequence, outcome: binding.outcome, priorProviderLaneTerminallyClosed: binding.priorProviderLaneTerminallyClosed};
    const initial = {id: value.authorityBinding.callbackEvidenceHeadId, digest: value.authorityBinding.callbackEvidenceHeadDigest, sequence: value.authorityBinding.callbackEvidenceHeadSequence};
    if (!current) {
      if (binding.outcome === 'pending_uncertain') return {scope, head: {...initial, outcome: binding.outcome, priorProviderLaneTerminallyClosed: binding.priorProviderLaneTerminallyClosed}};
      if (binding.predecessorCallbackEvidenceHeadId !== initial.id || binding.predecessorCallbackEvidenceHeadDigest !== initial.digest || binding.predecessorCallbackEvidenceHeadSequence !== initial.sequence || head.sequence !== initial.sequence + 1) throw new Error('reconciliation initial successor');
      return {scope, head};
    }
    if (head.id === current.id && head.digest === current.digest && head.sequence === current.sequence) {
      if (head.outcome !== current.outcome || head.priorProviderLaneTerminallyClosed !== current.priorProviderLaneTerminallyClosed) throw new Error('reconciliation head meaning conflict');
      return null;
    }
    if (binding.outcome === 'pending_uncertain' || binding.predecessorCallbackEvidenceHeadId !== current.id || binding.predecessorCallbackEvidenceHeadDigest !== current.digest || binding.predecessorCallbackEvidenceHeadSequence !== current.sequence || head.sequence !== current.sequence + 1 || head.id === current.id || head.digest === current.digest) throw new Error('reconciliation authoritative head');
    return {scope, head};
  }
  commit(plan) { if (plan) this.byScope.set(plan.scope, plan.head); }
}

class InspectionHistory {
  constructor() { this.byId = new Map(); this.byMaterial = new Map(); }
  record(candidate, trusted) {
    const decision = inspect(candidate, trusted);
    const existing = this.byId.get(candidate.requestId);
    if (existing) {
      if (existing !== candidate.requestDigest) throw new Error('request conflict');
      return {state: 'idempotent_historical_replay', decision};
    }
    if (this.byMaterial.has(candidate.idempotencyKeyDigest)) throw new Error('request semantic clone reuse');
    this.byId.set(candidate.requestId, candidate.requestDigest);
    this.byMaterial.set(candidate.idempotencyKeyDigest, candidate.requestId);
    return {state: 'recorded_no_effect', decision};
  }
}

function inspectionPair() {
  const input = {schemaVersion: contract.contractVersion, tenantId: uuid(1), requestId: uuid(50), requestedOperation: contract.inspectionRequest.requestedOperation, adapterFamilyId: 'provider_neutral_email', evaluatedAt: '2026-10-30T12:00:00.000000Z', materialDigest: '', idempotencyKeyDigest: '', requestDigest: ''};
  sealInspection(input);
  const trusted = {tenantId: input.tenantId, adapterFamilyId: input.adapterFamilyId, adapterState: 'disabled', providerMode: 'provider_disabled', providerAccountState: 'unavailable', connectionState: 'unavailable', credentialState: 'unavailable', capabilityState: 'unavailable', callbackState: 'unavailable', incidentResolverState: 'unavailable', circuitBreakerState: 'unavailable', fallbackPlanState: 'unavailable', channelSwitchState: 'unavailable', providerSwitchState: 'unavailable', observedAt: input.evaluatedAt};
  return {input, trusted};
}

function inspectionMaterial(value) {
  const material = clonePlain(value);
  for (const field of ['requestId','evaluatedAt','materialDigest','idempotencyKeyDigest','requestDigest']) delete material[field];
  return material;
}

function inspectionRequestMaterial(value) {
  const request = clonePlain(value);
  delete request.requestDigest;
  return request;
}

function sealInspection(value) {
  const material = inspectionMaterial(value);
  value.materialDigest = hash(material);
  value.idempotencyKeyDigest = hash({domain: 'mission28.part13d.inspection.v1', material});
  value.requestDigest = hash(inspectionRequestMaterial(value));
  return value;
}

function inspect(candidate, trusted) {
  const input = clonePlain(candidate); const resolution = clonePlain(trusted);
  exactKeys(input, contract.inspectionRequest.exactFields, 'request'); exactKeys(resolution, contract.inspectionRequest.trustedResolutionExactFields, 'resolution');
  if (input.schemaVersion !== contract.contractVersion || input.requestedOperation !== contract.inspectionRequest.requestedOperation || !UUID.test(input.tenantId) || !UUID.test(input.requestId) || !OPAQUE.test(input.adapterFamilyId) || !TIME.test(input.evaluatedAt) || input.tenantId !== resolution.tenantId || input.adapterFamilyId !== resolution.adapterFamilyId || input.evaluatedAt !== resolution.observedAt) throw new Error('request');
  const material = inspectionMaterial(input);
  if (input.materialDigest !== hash(material) || input.idempotencyKeyDigest !== hash({domain: 'mission28.part13d.inspection.v1', material}) || input.requestDigest !== hash(inspectionRequestMaterial(input))) throw new Error('request seal');
  const expectedAuthority = {...contract.currentAuthority, observedAt: input.evaluatedAt, tenantId: input.tenantId, adapterFamilyId: input.adapterFamilyId};
  delete expectedAuthority.resilienceDecisionsCreated; delete expectedAuthority.fallbackOrSwitchAttemptsCreated;
  if (JSON.stringify(canonical(resolution)) !== JSON.stringify(canonical(expectedAuthority))) throw new Error('authority');
  return clonePlain(contract.fixedDecision);
}

describe('Mission 28 Part 13D provider resilience, fallback and switching', () => {
  test('binds frozen authority, released Part 13C provenance and every exact input hash', () => {
    expect(contract.frozenAuthority).toMatchObject({part: '13', slice: 'D', scopeAnchor: expect.stringContaining('No fallback widens consent'), laterSlices: expect.stringContaining('Part13E')});
    expect(contract.part13CRelease).toMatchObject({acceptedSourceHead: '7b59f3771f6dc921cecd418816a313a22874863f', acceptedTree: '88f16eeb2e2bcda79e0eddfea04369bacd35c784', pullRequest: 605, mergedMain: 'eb72645427f65a2a3a535ed373bc730b5b153be2', productionAccepted: true, freshAudit: {verdict: 'P0=0_P1=0_P2=0_P3=0', nodeVersion: '22.23.3', focusedTests: '14/14', cumulativeMission28: '57_suites_807_tests', syntax: '57/57', json: '56/56'}, release: {deploymentId: '6e950c47-3b2a-47ca-bbab-bb7e804d33a5', deploymentInstanceId: '8466b56a-90be-49c0-8a53-c98209109332', imageSha256: 'sha256:ef54c6b0840ff88de3844899128de45477b2dca0985af8a8fe6847f1e0cb9f25'}});
    for (const item of contract.frozenInputs) expect(digestLf(item.path)).toBe(item.normalizedLfSha256);
  });

  test('keeps every provider resilience authority fixed unavailable with zero effects', () => {
    const pair = inspectionPair();
    expect(inspect(pair.input, pair.trusted)).toEqual(contract.fixedDecision);
    expect(contract.currentAuthority).toMatchObject({adapterState: 'disabled', providerMode: 'provider_disabled', providerAccountState: 'unavailable', connectionState: 'unavailable', credentialState: 'unavailable', capabilityState: 'unavailable', callbackState: 'unavailable', incidentResolverState: 'unavailable', circuitBreakerState: 'unavailable', fallbackPlanState: 'unavailable', resilienceDecisionsCreated: 0, fallbackOrSwitchAttemptsCreated: 0});
    expect(contract.fixedDecision).toMatchObject({retryAuthorized: false, fallbackAuthorized: false, channelSwitchAuthorized: false, providerSwitchAuthorized: false, providerAttemptCreated: false, recipientContacted: false, messageCreated: false, externalEffectCreated: false});
    const forged = clonePlain(pair.trusted); forged.connectionState = 'connected'; expect(() => inspect(pair.input, forged)).toThrow();
    for (const field of ['materialDigest','idempotencyKeyDigest','requestDigest']) {
      const tampered = clonePlain(pair.input); tampered[field] = hash(`tampered-${field}`); expect(() => inspect(tampered, pair.trusted)).toThrow('request seal');
    }
    const semanticClone = clonePlain(pair.input); semanticClone.requestId = uuid(51); semanticClone.evaluatedAt = '2026-10-30T12:01:00.000000Z'; sealInspection(semanticClone);
    expect(semanticClone.materialDigest).toBe(pair.input.materialDigest); expect(semanticClone.idempotencyKeyDigest).toBe(pair.input.idempotencyKeyDigest); expect(semanticClone.requestDigest).not.toBe(pair.input.requestDigest);
  });

  test('freezes a closed nonconflated incident catalog and exact dispositions', () => {
    expect(contract.incidentCatalog.map(item => item.incidentKind)).toEqual(['provider_outage','quota_exhausted','provider_throttled_definite_no_acceptance','template_rejected','credential_failure','degraded_capability','circuit_breaker_open','provider_acknowledgement_unknown']);
    for (const row of contract.incidentCatalog) expect(validateAssessment(incidentFixture(row.incidentKind), incidentFixture(row.incidentKind))).toBe(true);
    coherentReject(value => { value.incidentBinding.incidentKind = 'provider_slow'; });
    coherentReject(value => { value.decisionBinding.disposition = 'delivered'; });
  });

  test('keeps outage and unknown acknowledgement blocked until exact reconciliation proves definite non-acceptance', () => {
    for (const kind of ['provider_outage','provider_acknowledgement_unknown']) {
      const value = incidentFixture(kind);
      expect(value).toMatchObject({incidentBinding: {definiteNoAcceptance: false, retryAfterSeconds: null}, decisionBinding: {disposition: 'reconciliation_required_no_resend', fallbackReviewState: 'none', channelSwitchState: 'none', providerSwitchState: 'none'}});
      coherentReject(item => { Object.assign(item.fallbackBinding, providerSwitchFixture().fallbackBinding); Object.assign(item.decisionBinding, providerSwitchFixture().decisionBinding); }, value);
      coherentReject(item => { item.incidentBinding.definiteNoAcceptance = true; }, value);

      const acceptedOrPossible = reconciledFixture(kind, 'reconciled_accepted_or_effect_possible');
      expect(validateAssessment(acceptedOrPossible, clonePlain(acceptedOrPossible))).toBe(true);
      coherentReject(item => { Object.assign(item.fallbackBinding, providerSwitchFixture().fallbackBinding); Object.assign(item.decisionBinding, providerSwitchFixture().decisionBinding); }, acceptedOrPossible);

      const definiteNoAcceptance = reconciledFixture(kind, 'reconciled_definite_no_acceptance');
      const reviewedFallback = providerSwitchFixture(definiteNoAcceptance);
      expect(validateAssessment(reviewedFallback, clonePlain(reviewedFallback))).toBe(true);
      expect(reviewedFallback).toMatchObject({reconciliationBinding: {outcome: 'reconciled_definite_no_acceptance', priorProviderLaneTerminallyClosed: true}, incidentBinding: {definiteNoAcceptance: true}, fallbackBinding: {priorProviderLaneClosed: true, targetProviderLaneState: 'review_only_not_active'}, decisionBinding: {disposition: 'fallback_review_required_no_effect'}});
      coherentReject(item => { item.reconciliationBinding.priorProviderLaneTerminallyClosed = false; }, reviewedFallback);
      coherentReject(item => { item.reconciliationBinding.reconciliationEvidenceHeadSequence += 1; }, reviewedFallback);
      coherentReject(item => { item.reconciliationBinding.predecessorCallbackEvidenceHeadDigest = hash('other-callback-head'); }, reviewedFallback);
    }
    expect(part6D.classificationContract.uncertainFirstDecision).toBe('reconciliation_required_no_resend');
    expect(part13C.lineageAndCorrectionContract.lateReorderedDuplicateOrConflictingEvidence).toContain('non_authoritative_unknown');
  });

  test('bounds Retry-After to separately trusted definite-no-acceptance throttling only', () => {
    expect(validateAssessment(baseFixture(), clonePlain(baseFixture()))).toBe(true);
    coherentReject(value => { value.incidentBinding.retryAfterSeconds = 0; value.decisionBinding.retryAfterAppliedSeconds = 0; });
    coherentReject(value => { value.incidentBinding.retryAfterSeconds = contract.bounds.maximumRetryAfterSeconds + 1; value.decisionBinding.retryAfterAppliedSeconds = contract.bounds.maximumRetryAfterSeconds + 1; });
    coherentReject(value => { value.incidentBinding.definiteNoAcceptance = false; });
    coherentReject(value => { value.retryAuthorityBinding.maximumDelaySeconds = 60; value.retryAuthorityBinding.maximumRetryAfterSeconds = 60; });
    const outage = incidentFixture('provider_outage'); coherentReject(value => { value.incidentBinding.retryAfterSeconds = 10; value.decisionBinding.retryAfterAppliedSeconds = 10; }, outage);
    expect(contract.decisionCoherence.retryPolicyLimit).toContain('exact_Part6D');
  });

  test('stops template and credential failures without changing content or inventing rotation', () => {
    const rejected = incidentFixture('template_rejected'); expect(rejected.decisionBinding.disposition).toBe('stop_no_effect');
    const credential = incidentFixture('credential_failure'); expect(credential).toMatchObject({circuitBinding: {circuitState: 'open'}, decisionBinding: {disposition: 'circuit_open_stop_no_effect'}});
    trustedReject(value => { value.authorityBinding.contentPreviewDigest = hash('changed-content'); }, rejected);
    coherentReject(value => { Object.assign(value.fallbackBinding, providerSwitchFixture().fallbackBinding); Object.assign(value.decisionBinding, providerSwitchFixture().decisionBinding); }, credential);
    expect(contract.incidentSemantics.templateRejection).toContain('no_silent');
    expect(contract.incidentSemantics.credentialFailure).toContain('no_candidate_rotation');
  });

  test('opens degraded-capability circuits and never weakens required semantics', () => {
    const value = incidentFixture('degraded_capability');
    expect(value).toMatchObject({circuitBinding: {circuitState: 'open'}, decisionBinding: {disposition: 'circuit_open_stop_no_effect'}});
    coherentReject(item => { item.circuitBinding.circuitState = 'closed'; }, value);
    trustedReject(item => { item.sourceProviderBinding.capabilityResolutionDigest = hash('less-capable'); }, value);
    expect(contract.incidentSemantics.degradedCapability).toContain('no_tracking_attachment_sender_template_or_content_downgrade');
  });

  test('serializes one exact monotonic circuit head and rejects stale repeated decreased forked or skipped generations', () => {
    const history = new AssessmentHistory();
    const initial = incidentFixture('circuit_breaker_open');
    expect(history.record(initial, clonePlain(initial))).toBe('recorded_no_effect');
    expect(history.record(initial, clonePlain(initial))).toBe('idempotent_historical_replay');

    const sameHeadReference = clonePlain(initial);
    sameHeadReference.assessmentId = uuid(801);
    sameHeadReference.incidentBinding.incidentId = uuid(802);
    sameHeadReference.incidentBinding.incidentEvidenceDigest = hash('same-current-circuit-head-reference');
    seal(sameHeadReference);
    expect(history.record(sameHeadReference, clonePlain(sameHeadReference))).toBe('recorded_no_effect');

    const successor = advancedCircuitFixture(initial, 72);
    expect(history.record(successor, clonePlain(successor))).toBe('recorded_no_effect');

    const stale = clonePlain(initial); stale.assessmentId = uuid(803); stale.incidentBinding.incidentId = uuid(804); stale.incidentBinding.incidentEvidenceDigest = hash('stale-circuit-head'); seal(stale);
    expect(() => history.record(stale, clonePlain(stale))).toThrow('circuit authoritative head');

    const fork = advancedCircuitFixture(initial, 73);
    expect(() => history.record(fork, clonePlain(fork))).toThrow('circuit authoritative head');

    const skipped = advancedCircuitFixture(initial, 74);
    skipped.circuitBinding.circuitGeneration = 4;
    skipped.circuitBinding.predecessorCircuitGeneration = 3;
    skipped.circuitBinding.predecessorCircuitHeadId = uuid(999);
    skipped.circuitBinding.predecessorCircuitHeadDigest = hash('missing-generation-two');
    seal(skipped);
    expect(() => history.record(skipped, clonePlain(skipped))).toThrow('circuit authoritative head');

    const decreased = clonePlain(initial); decreased.assessmentId = uuid(805); decreased.circuitBinding.circuitHeadId = uuid(806); decreased.incidentBinding.incidentId = uuid(807); decreased.incidentBinding.incidentEvidenceDigest = hash('decreased-circuit-head'); seal(decreased);
    expect(() => history.record(decreased, clonePlain(decreased))).toThrow('circuit authoritative head');

    coherentReject(value => { value.circuitBinding.circuitGeneration = 2; value.circuitBinding.predecessorCircuitGeneration = 1; value.circuitBinding.predecessorCircuitHeadId = value.circuitBinding.circuitHeadId; value.circuitBinding.predecessorCircuitHeadDigest = value.circuitBinding.circuitHeadDigest; value.circuitBinding.circuitTransitionKind = 'open'; }, initial);
    expect(contract.circuitBreakerContract.generation).toContain('strictly_predecessor_plus_one');
  });

  test('keeps one exact append-only reconciliation successor and denies conflicting forks', () => {
    const history = new AssessmentHistory();
    const pending = incidentFixture('provider_outage');
    expect(history.record(pending, clonePlain(pending))).toBe('recorded_no_effect');
    const resolved = reconciledFixture('provider_outage', 'reconciled_definite_no_acceptance');
    expect(history.record(resolved, clonePlain(resolved))).toBe('recorded_no_effect');
    expect(history.record(resolved, clonePlain(resolved))).toBe('idempotent_historical_replay');

    const fork = reconciledFixture('provider_outage', 'reconciled_accepted_or_effect_possible');
    fork.assessmentId = uuid(811); fork.incidentBinding.incidentId = uuid(812); fork.incidentBinding.incidentEvidenceDigest = hash('reconciliation-fork'); seal(fork);
    expect(() => history.record(fork, clonePlain(fork))).toThrow('reconciliation authoritative head');

    const meaningConflict = clonePlain(resolved);
    meaningConflict.assessmentId = uuid(815);
    meaningConflict.incidentBinding.incidentId = uuid(816);
    meaningConflict.incidentBinding.incidentEvidenceDigest = hash('same-reconciliation-head-different-meaning');
    meaningConflict.incidentBinding.definiteNoAcceptance = false;
    meaningConflict.reconciliationBinding.outcome = 'reconciled_accepted_or_effect_possible';
    meaningConflict.reconciliationBinding.priorProviderLaneTerminallyClosed = false;
    meaningConflict.retryAuthorityBinding.retryDecisionState = 'permanent_stop_unknown_or_unsafe';
    meaningConflict.decisionBinding.disposition = 'reconciliation_required_no_resend';
    seal(meaningConflict);
    expect(validateAssessment(meaningConflict, clonePlain(meaningConflict))).toBe(true);
    expect(() => history.record(meaningConflict, clonePlain(meaningConflict))).toThrow('reconciliation head meaning conflict');

    const stalePending = clonePlain(pending); stalePending.assessmentId = uuid(813); stalePending.incidentBinding.incidentId = uuid(814); stalePending.incidentBinding.incidentEvidenceDigest = hash('stale-pending-reconciliation'); seal(stalePending);
    expect(() => history.record(stalePending, clonePlain(stalePending))).toThrow('reconciliation authoritative head');
  });

  test('freezes provider switching as review-only with exact same permission channel and content', () => {
    const value = providerSwitchFixture(); expect(validateAssessment(value, clonePlain(value))).toBe(true);
    expect(value).toMatchObject({fallbackBinding: {fallbackKind: 'provider_switch_review_only', fallbackHop: 1, priorProviderLaneClosed: true, targetProviderLaneState: 'review_only_not_active'}, decisionBinding: {disposition: 'fallback_review_required_no_effect', providerSwitchState: 'review_required_no_effect', channelSwitchState: 'none'}});
    coherentReject(item => { item.fallbackBinding.targetPermissionResolutionDigest = hash('wider-permission'); }, value);
    coherentReject(item => { item.fallbackBinding.targetChannelId = 'sms'; }, value);
    coherentReject(item => { item.fallbackBinding.targetContentPreviewDigest = hash('changed-content'); }, value);
    coherentReject(item => { item.fallbackBinding.priorProviderLaneClosed = false; }, value);
    coherentReject(item => { item.fallbackBinding.targetProviderLaneState = 'active'; }, value);
    coherentReject(item => { item.fallbackBinding.targetEnvironment = 'livemode'; }, value);
    coherentReject(item => { item.fallbackBinding.targetProviderAccountBindingId = item.sourceProviderBinding.providerAccountBindingId; }, value);
    coherentReject(item => { item.fallbackBinding.targetCredentialBindingDigest = item.sourceProviderBinding.credentialBindingDigest; }, value);
  });

  test('requires an independent exact permission and channel binding for review-only channel switching', () => {
    const value = channelSwitchFixture(); expect(validateAssessment(value, clonePlain(value))).toBe(true);
    expect(value).toMatchObject({fallbackBinding: {fallbackKind: 'channel_switch_review_only', targetChannelId: 'sms'}, decisionBinding: {channelSwitchState: 'review_required_no_effect', providerSwitchState: 'none'}});
    coherentReject(item => { item.fallbackBinding.targetPermissionResolutionId = item.authorityBinding.permissionResolutionId; }, value);
    coherentReject(item => { item.fallbackBinding.targetChannelResolutionId = item.authorityBinding.channelResolutionId; }, value);
    coherentReject(item => { item.fallbackBinding.targetAttachmentSetDigest = hash('dropped-attachments'); }, value);
    expect(part7B.versionedPermission.externalOptInRule).toContain('remains_unavailable');
    expect(part7D.channelCatalog.find(item => item.channelId === 'sms').resultState).toBe('unavailable_external_channel');
  });

  test('retains one stable action request identity and one provider lane across all review paths', () => {
    const value = providerSwitchFixture();
    expect(value.actionBinding.providerRequestIdentity).toBe(`m28:${value.actionBinding.unitId}`);
    expect(contract.fallbackAndSwitchContract).toMatchObject({maximumFallbackHops: 1, oneActiveProviderLanePerAction: true, oldLaneMustBeDefiniteNoAcceptanceAndTerminallyClosed: true, stableActionProviderRequestAndIdempotencyIdentityMustNotChange: true});
    coherentReject(item => { item.actionBinding.providerRequestIdentity = `m28:${uuid(999)}`; item.actionBinding.providerRequestIdentityDigest = hash(item.actionBinding.providerRequestIdentity); }, value);
    coherentReject(item => { item.fallbackBinding.fallbackHop = 2; }, value);
    coherentReject(item => { item.decisionBinding.duplicatePreventionState = 'two_provider_lanes'; }, value);
    expect(part6C.providerRequestIdentityContract.providerRequestIdentity).toBe('m28_colon_exact_Part6A_unitId');
  });

  test('binds candidate material to a separately trusted exact resolution and full digest projections', () => {
    const value = baseFixture(); expect(validateAssessment(value, clonePlain(value))).toBe(true);
    const forged = clonePlain(value); forged.incidentBinding.incidentKind = 'quota_exhausted'; seal(forged); expect(() => validateAssessment(forged, value)).toThrow('trusted resolution');
    const clone = clonePlain(value); clone.assessmentId = uuid(999); clone.assessedAt = '2026-10-30T12:01:00.000000Z'; seal(clone);
    expect(clone.materialDigest).toBe(value.materialDigest); expect(clone.idempotencyKeyDigest).toBe(value.idempotencyKeyDigest); expect(clone.assessmentDigest).not.toBe(value.assessmentDigest);
    expect(contract.digestProjectionContract.materialExcludesOnly).toEqual(['assessmentId','assessedAt','materialDigest','idempotencyKeyDigest','assessmentDigest']);
    coherentReject(item => { item.circuitBinding.circuitScopeDigest = hash('retargeted-circuit-scope'); }, value);
  });

  test('denies assessment and inspection conflicts or semantic clones while replay stays idempotent', () => {
    const value = baseFixture(); const assessments = new AssessmentHistory();
    expect(assessments.record(value, clonePlain(value))).toBe('recorded_no_effect');
    expect(assessments.record(value, clonePlain(value))).toBe('idempotent_historical_replay');
    const conflict = clonePlain(value); conflict.assessedAt = '2026-10-30T12:01:00.000000Z'; seal(conflict); expect(() => assessments.record(conflict, clonePlain(conflict))).toThrow('assessment conflict');
    const clone = clonePlain(value); clone.assessmentId = uuid(999); clone.assessedAt = '2026-10-30T12:01:00.000000Z'; seal(clone); expect(() => assessments.record(clone, clonePlain(clone))).toThrow('semantic clone reuse');

    const pair = inspectionPair(); const inspections = new InspectionHistory();
    expect(inspections.record(pair.input, pair.trusted).state).toBe('recorded_no_effect');
    expect(inspections.record(pair.input, pair.trusted).state).toBe('idempotent_historical_replay');
    const requestConflict = clonePlain(pair.input); requestConflict.evaluatedAt = '2026-10-30T12:01:00.000000Z'; sealInspection(requestConflict); const conflictTrusted = clonePlain(pair.trusted); conflictTrusted.observedAt = requestConflict.evaluatedAt; expect(() => inspections.record(requestConflict, conflictTrusted)).toThrow('request conflict');
    const requestClone = clonePlain(pair.input); requestClone.requestId = uuid(51); requestClone.evaluatedAt = '2026-10-30T12:01:00.000000Z'; sealInspection(requestClone); const cloneTrusted = clonePlain(pair.trusted); cloneTrusted.observedAt = requestClone.evaluatedAt; expect(() => inspections.record(requestClone, cloneTrusted)).toThrow('request semantic clone reuse');
  });

  test('rejects stale clocks, malformed fields and cross-authority retargeting before any decision', () => {
    coherentReject(value => { value.incidentBinding.incidentObservedAt = '2026-10-30T11:44:59.999999Z'; });
    coherentReject(value => { value.incidentBinding.incidentObservedAt = '2026-10-30T12:00:00.000001Z'; });
    coherentReject(value => { value.incidentBinding.incidentObservedAt = '2026-02-31T11:59:00.000000Z'; });
    trustedReject(value => { value.tenantId = uuid(999); });
    trustedReject(value => { value.authorityBinding.policyId = uuid(999); });
    trustedReject(value => { value.authorityBinding.senderRecipientResolutionId = uuid(999); });
    trustedReject(value => { value.sourceProviderBinding.connectionId = uuid(999); });
    coherentReject(value => { value.incidentBinding.unexpected = 'secret@example.test'; });
    coherentReject(value => { delete value.circuitBinding.circuitId; });
  });

  test('rejects getters proxies toJSON symbols custom prototypes sparse arrays and aliased objects', () => {
    const base = baseFixture(); let reads = 0;
    const getter = clonePlain(base); Object.defineProperty(getter, 'tenantId', {enumerable: true, get() { reads += 1; return uuid(1); }}); expect(() => validateAssessment(getter, base)).toThrow(); expect(reads).toBe(0);
    const proxy = new Proxy(base, {get() { reads += 1; return undefined; }}); expect(() => validateAssessment(proxy, base)).toThrow(); expect(reads).toBe(0);
    const ownToJSON = clonePlain(base); ownToJSON.toJSON = () => ({secret: 'sk_secret'}); expect(() => validateAssessment(ownToJSON, base)).toThrow();
    const symbol = clonePlain(base); symbol[Symbol('secret')] = 'customer@example.test'; expect(() => validateAssessment(symbol, base)).toThrow();
    const custom = clonePlain(base); Object.setPrototypeOf(custom, {inherited: true}); expect(() => validateAssessment(custom, base)).toThrow();
    const sparse = clonePlain(base); sparse.extra = []; sparse.extra.length = 2; sparse.extra[1] = 'x'; expect(() => validateAssessment(sparse, base)).toThrow();
    const alias = clonePlain(base); alias.alias = alias.authorityBinding; expect(() => validateAssessment(alias, base)).toThrow();
  });

  test('keeps runtime provider recipient effect accounting and money authority at zero', () => {
    expect(contract.runtimeBoundary).toEqual({newMigration: false, newTableFunctionRouteUiWorkerQueueSchedulerCircuitCallbackAdapterOrResolver: false, providerAccountConnectionCredentialOrSecretRead: false, providerSandboxOrLiveCallPerformed: false, realIncidentObserved: false, realFallbackPlanCreated: false, providerAttemptsCreated: 0, recipientsContacted: 0, messagesCreated: 0, externalEffectsCreated: 0, upstreamMutationsCreated: 0, financialEffectsCreated: 0, moneyEffectsCreated: 0, latestMigration: '287_canonical_automation_estimate_quote_resolution_v1.sql', nextMigrationAbsent: '288'});
    expect(part13A.adapterFamilies.every(item => item.adapterState === 'disabled')).toBe(true);
    expect(part13B.currentTrustedResolution).toMatchObject({providerAccountState: 'unavailable_not_verified', connectionState: 'disabled_unavailable', credentialState: 'unavailable'});
    expect(part13B.adapterFamilyBindings.every(item => item.providerMode === 'provider_disabled')).toBe(true);
    expect(contract.unavailableEvidence).toEqual(expect.arrayContaining(['provider_accounts_connections_credentials_secrets_senders_domains_numbers_or_templates','provider_sandbox_or_live_outage_quota_throttle_template_rejection_credential_failure_or_degradation','real_callbacks_reconciliation_fallback_switch_recipient_message_or_delivery_evidence','external_effect_upstream_mutation_financial_effect_or_live_money']));
  });

  test('keeps the roadmap and 66-row ledger exact with Part 13D candidate only', () => {
    const roadmap = read('docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md'); const ledger = read('docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md');
    for (const value of [roadmap, ledger]) {
      expect(value).toContain('Parts 1A–13C are released. Part 13D is the sole implementation candidate.');
      expect(value).toContain('Parts 13E–14G'); expect(value).toContain('planned and unimplemented');
    }
    expect(roadmap).toContain('Released Part 13C baseline: accepted corrected source `7b59f3771f6dc921cecd418816a313a22874863f`');
    expect(roadmap).toContain('Current Part 13D artifacts:');
    expect(ledger).toContain('| 57 | 13C | Authenticated callbacks and exact status reconciliation | **Released** |');
    expect(ledger).toContain('| 58 | 13D | Provider outage/quota/degradation/circuit-breaker/fallback | **Implementation candidate** |');
    const rows = ledger.split(/\r?\n/).filter(line => /^\| \d{2} \|/.test(line));
    expect(rows).toHaveLength(66); expect(rows.filter(line => line.includes('**Released**'))).toHaveLength(57); expect(rows.filter(line => line.includes('**Implementation candidate**'))).toHaveLength(1);
    expect(rows.slice(58).every(line => line.includes('Planned / unimplemented'))).toBe(true);
    expect(fs.readdirSync(path.join(ROOT, 'migrations')).filter(name => /^\d+_.*\.sql$/.test(name))).toHaveLength(283);
    expect(fs.existsSync(path.join(ROOT, 'migrations', '288_canonical_automation_provider_resilience_v1.sql'))).toBe(false);
  });
});
