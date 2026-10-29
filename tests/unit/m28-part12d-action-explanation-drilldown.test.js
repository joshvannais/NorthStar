'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { types } = require('util');

const ROOT = path.resolve(__dirname, '../..');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
const contract = readJson('docs/architecture/MISSION_28_PART12D_ACTION_EXPLANATION_DRILLDOWN_CONTRACT.json');
const part12A = readJson('docs/architecture/MISSION_28_PART12A_TENANT_PRIVATE_ACTION_QUEUE_CONTRACT.json');
const part12B = readJson('docs/architecture/MISSION_28_PART12B_REVIEWED_ATTENTION_HANDOFF_CONTRACT.json');
const part12C = readJson('docs/architecture/MISSION_28_PART12C_ACTION_QUEUE_LIFECYCLE_CONTRACT.json');
const part3A = readJson('docs/architecture/MISSION_28_PART3A_FIXED_CAPABILITY_MATRIX.json');
const part3C = readJson('docs/architecture/MISSION_28_PART3C_OWNER_LIMITS_CONTRACT.json');
const part4D = readJson('docs/architecture/MISSION_28_PART4D_FACT_PRECEDENCE_CONTRACT.json');
const part5B = readJson('docs/architecture/MISSION_28_PART5B_DETERMINISTIC_EVALUATOR_CONTRACT.json');
const UUID = new RegExp(contract.identityGrammar.uuidPattern);
const DIGEST = new RegExp(contract.identityGrammar.digestPattern);
const UTC = new RegExp(contract.identityGrammar.utcInstantPattern);
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const digest = n => `sha256:${Number(n).toString(16).padStart(64, '0')}`;
const copy = value => JSON.parse(JSON.stringify(value));
const canonicalize = value => Array.isArray(value) ? value.map(canonicalize) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])])) : value;
const hash = value => `sha256:${crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(canonicalize(value))).digest('hex')}`;
const digestLf = relative => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, relative), 'utf8').replace(/\r\n/g, '\n')).digest('hex').toUpperCase();

function dataOnly(value, seen = new WeakSet()) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number') { if (!Number.isSafeInteger(value)) throw new Error('number'); return; }
  if (typeof value !== 'object' || types.isProxy(value) || seen.has(value)) throw new Error('plain data');
  seen.add(value);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== Array.prototype) throw new Error('prototype');
  if (Object.getOwnPropertySymbols(value).length) throw new Error('symbol');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.hasOwn(descriptors, 'toJSON')) throw new Error('toJSON');
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) throw new Error('sparse');
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[index];
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error('descriptor');
      dataOnly(descriptor.value, seen);
    }
    return;
  }
  for (const descriptor of Object.values(descriptors)) {
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error('descriptor');
    dataOnly(descriptor.value, seen);
  }
}

function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) throw new Error('keys');
}

function micros(value) {
  if (typeof value !== 'string' || !UTC.test(value)) return null;
  const milliseconds = Date.parse(`${value.slice(0, 19)}Z`);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString().slice(0, 19) !== value.slice(0, 19)) return null;
  return BigInt(milliseconds) * 1000n + BigInt(value.slice(20, 26));
}

function materialOf(input) { const value = copy(input); delete value.materialDigest; delete value.idempotencyKeyDigest; delete value.requestDigest; return value; }
function stableOf(input) {
  const value = materialOf(input); delete value.drilldownRequestId; delete value.evaluatedAt;
  value.sourceAuthorityBinding.observedAt = null; value.policyDecisionBinding.evaluatedAt = null;
  return value;
}
function seal(input) { input.materialDigest = hash(materialOf(input)); input.idempotencyKeyDigest = hash(stableOf(input)); input.requestDigest = hash(materialOf(input)); return input; }
function trustedOf(input) { return copy({tenantId: input.tenantId, queueItemBinding: input.queueItemBinding, sourceAuthorityBinding: input.sourceAuthorityBinding, policyDecisionBinding: input.policyDecisionBinding, lifecycleHeadBinding: input.lifecycleHeadBinding, sourceCorrectionBinding: input.sourceCorrectionBinding, limitEvidenceBinding: input.limitEvidenceBinding, priorAttemptEvidenceBinding: input.priorAttemptEvidenceBinding, viewerAuthorityBinding: input.viewerAuthorityBinding, nextSafeChoiceBinding: input.nextSafeChoiceBinding, evaluatedAt: input.evaluatedAt}); }

function queueFingerprint(input) {
  const queue = input.queueItemBinding; const source = input.sourceAuthorityBinding; const policy = input.policyDecisionBinding;
  return hash({tenantId: input.tenantId, queueKind: queue.queueKind, actionFamily: queue.actionFamily, sourceRecordId: source.sourceRecordId, sourceRecordDigest: source.sourceRecordDigest, snapshotId: source.snapshotId, snapshotDigest: source.snapshotDigest, policyId: policy.policyId, policyVersion: policy.policyVersion, policyDigest: policy.policyDigest, evaluationId: policy.evaluationId, evaluationOutputDigest: policy.evaluationOutputDigest, originAssigneeActorId: queue.originAssigneeActorId, reasonCode: queue.reasonCode, evidenceQuality: queue.evidenceQuality, trustStatus: queue.trustStatus, uncertaintyState: queue.uncertaintyState, horizonKind: queue.horizonKind, horizonLocalStart: queue.horizonLocalStart});
}

function nullCorrection() {
  return {correctionKind: null, lineageId: null, predecessorSnapshotId: null, predecessorSnapshotDigest: null, predecessorSnapshotLineageSequence: null, replacementSnapshotId: null, replacementSnapshotDigest: null, replacementSnapshotLineageSequence: null, replacementHeadTransitionId: null, replacementHeadTransitionDigest: null, replacementHeadSequence: null, replacementEffectiveSnapshotId: null, replacementEffectiveSnapshotDigest: null, replacementCurrentnessState: null, successorQueueMaterialDigest: null, successorRequired: null};
}

function fixture(state = 'open', originContract = 'part12b_reviewed_handoff', requestedQueueKind = null) {
  const tenantId = uuid(1); const evaluatedAt = '2026-10-29T12:05:00.000000Z';
  const fromPart12B = originContract === 'part12b_reviewed_handoff';
  const queueKind = requestedQueueKind || (fromPart12B ? 'owner_attention_item' : 'owner_task');
  const queueDefinition = fromPart12B ? part12B.queueKinds.find(item => item.id === queueKind) : part12A.queueKinds.find(item => item.id === queueKind);
  const result = queueDefinition.actionFamily === 'owner_approval_request' ? 'approval_required' : 'eligible';
  const sourceAuthorityBinding = {tenantId, sourceRecordId: uuid(20), sourceRecordDigest: digest(20), snapshotId: uuid(21), snapshotDigest: digest(21), lineageId: uuid(22), lineageKind: 'active', snapshotLineageSequence: 3, predecessorSnapshotId: uuid(19), predecessorSnapshotDigest: digest(19), headTransitionId: uuid(23), headTransitionDigest: digest(23), headSequence: 5, effectiveSnapshotId: uuid(21), effectiveSnapshotDigest: digest(21), currentnessState: state === 'source_changed_stale' ? 'corrected' : 'latest_exact_current', observedAt: '2026-10-29T12:04:00.000000Z'};
  const policyDecisionBinding = {tenantId, policyId: uuid(30), policyVersion: 2, policyDigest: digest(30), sourceSetDigest: hash({tenantId, snapshotId: sourceAuthorityBinding.snapshotId, snapshotDigest: sourceAuthorityBinding.snapshotDigest}), evaluationId: uuid(31), evaluationOutputDigest: digest(31), result, reasonCodes: result === 'approval_required' ? copy(contract.decisionAndEvidenceContract.approvalRequiredReasonCodes) : copy(contract.decisionAndEvidenceContract.eligibleReasonCodes), evidenceQuality: 'complete_exact', evaluatedAt};
  const queueItemBinding = {tenantId, queueItemId: uuid(10), queueItemRevision: 1, queueItemDigest: digest(10), queueKind, actionFamily: queueDefinition.actionFamily, reasonCode: fromPart12B ? queueDefinition.reasonCode : queueDefinition.reasonCodes[0], originContract, originProjectionId: uuid(11), originMaterialDigest: digest(11), originIdempotencyKeyDigest: digest(12), originAssigneeActorId: uuid(40), originAssigneeMembershipId: uuid(41), evidenceQuality: fromPart12B ? 'complete_exact_reviewed_cohort' : 'complete_exact_source', trustStatus: fromPart12B ? 'reviewed_advisory_only' : 'source_fact_only_not_permission', uncertaintyState: fromPart12B ? 'descriptive_sample_not_prediction' : 'none_exact_current', horizonKind: fromPart12B ? 'historical_current_cohort' : 'not_applicable', horizonLocalStart: null, sourceLinkDigest: digest(13), completionState: 'unavailable_no_accepted_completion_authority', semanticFingerprintDigest: ''};
  const lifecycleHeadBinding = {tenantId, queueItemId: queueItemBinding.queueItemId, queueItemDigest: queueItemBinding.queueItemDigest, lifecycleId: uuid(50), revision: 3, eventId: uuid(51), eventDigest: digest(51), semanticFingerprintDigest: '', state, groupId: null, groupKeyDigest: null, priority: state === 'escalated' ? 'high' : 'normal', assigneeActorId: queueItemBinding.originAssigneeActorId, assigneeMembershipId: queueItemBinding.originAssigneeMembershipId, dueBy: '2026-10-30T12:05:00.000000Z', snoozedUntil: state === 'snoozed' ? '2026-10-29T13:05:00.000000Z' : null, dismissReasonCode: state === 'dismissed_unresolved_visible' ? 'owner_dismissed_pending_recheck' : null, escalationLevel: state === 'escalated' ? 1 : 0, sourceSnapshotId: sourceAuthorityBinding.snapshotId, sourceSnapshotDigest: sourceAuthorityBinding.snapshotDigest, sourceHeadTransitionId: sourceAuthorityBinding.headTransitionId, sourceHeadTransitionDigest: sourceAuthorityBinding.headTransitionDigest, sourceHeadSequence: sourceAuthorityBinding.headSequence, policyId: policyDecisionBinding.policyId, policyVersion: policyDecisionBinding.policyVersion, policyDigest: policyDecisionBinding.policyDigest, unresolvedConsequenceState: 'unresolved_visible', completionState: 'unavailable_no_accepted_completion_authority'};
  const sourceCorrectionBinding = state === 'source_changed_stale' ? {correctionKind: 'same_lineage_exact_next_snapshot', lineageId: sourceAuthorityBinding.lineageId, predecessorSnapshotId: sourceAuthorityBinding.snapshotId, predecessorSnapshotDigest: sourceAuthorityBinding.snapshotDigest, predecessorSnapshotLineageSequence: sourceAuthorityBinding.snapshotLineageSequence, replacementSnapshotId: uuid(90), replacementSnapshotDigest: digest(90), replacementSnapshotLineageSequence: sourceAuthorityBinding.snapshotLineageSequence + 1, replacementHeadTransitionId: uuid(91), replacementHeadTransitionDigest: digest(91), replacementHeadSequence: sourceAuthorityBinding.headSequence + 1, replacementEffectiveSnapshotId: uuid(90), replacementEffectiveSnapshotDigest: digest(90), replacementCurrentnessState: 'latest_exact_current', successorQueueMaterialDigest: digest(92), successorRequired: true} : nullCorrection();
  const limitEvidenceBinding = {state: 'unavailable_no_mounted_limit_resolution', mandatoryConstraintManifestDigest: contract.limitsAndAttemptsContract.mandatoryConstraintManifestDigest, limitProfileId: null, limitProfileDigest: null, effectiveLimitDigest: null, evaluatedAt: null};
  const priorAttemptEvidenceBinding = {tenantId, state: 'unavailable_no_mounted_action_attempt_history', attemptCount: 0, latestAttemptId: null, latestAttemptDigest: null, latestAttemptAt: null, providerRequestId: null, outcomeState: 'unavailable'};
  const viewerAuthorityBinding = {actorId: uuid(100), sessionId: uuid(101), membershipId: uuid(102), sessionSubjectActorId: uuid(100), membershipSubjectActorId: uuid(100), actorTenantId: tenantId, sessionTenantId: tenantId, membershipTenantId: tenantId, actorState: 'active', sessionState: 'active', membershipState: 'active', membershipRoleId: 'owner', capabilityState: 'exact_current_granted', capabilityId: 'automation_view', capabilityDecisionId: uuid(103), capabilityDecisionDigest: digest(103), recordScope: 'exact_tenant_all_automation', recordId: queueItemBinding.queueItemId};
  const choice = contract.supportedCurrentStates.find(item => item.id === state);
  const nextSafeChoiceBinding = {choiceId: choice.nextSafeChoiceId, labelId: choice.labelId, fixedLabel: choice.fixedLabel, requiredCapabilityId: 'automation_view', authorityState: 'label_only_no_action_authority', recordScope: 'exact_tenant_all_automation', actionAuthorityGranted: false, effectAuthorityGranted: false};
  const input = {schemaVersion: contract.contractVersion, tenantId, drilldownRequestId: uuid(2), queueItemBinding, sourceAuthorityBinding, policyDecisionBinding, lifecycleHeadBinding, sourceCorrectionBinding, limitEvidenceBinding, priorAttemptEvidenceBinding, viewerAuthorityBinding, nextSafeChoiceBinding, evaluatedAt, materialDigest: '', idempotencyKeyDigest: '', requestDigest: ''};
  input.queueItemBinding.semanticFingerprintDigest = queueFingerprint(input); input.lifecycleHeadBinding.semanticFingerprintDigest = input.queueItemBinding.semanticFingerprintDigest;
  seal(input);
  return {input, trusted: trustedOf(input)};
}

function validateEnvelope(input) {
  dataOnly(input);
  if (Buffer.byteLength(JSON.stringify(input)) > contract.bounds.maximumCanonicalRequestBytes) throw new Error('size');
  exactKeys(input, contract.envelope.exactFields);
  for (const [key, schema] of [['queueItemBinding','queueItemBindingExactFields'],['sourceAuthorityBinding','sourceAuthorityBindingExactFields'],['policyDecisionBinding','policyDecisionBindingExactFields'],['lifecycleHeadBinding','lifecycleHeadBindingExactFields'],['sourceCorrectionBinding','sourceCorrectionBindingExactFields'],['limitEvidenceBinding','limitEvidenceBindingExactFields'],['priorAttemptEvidenceBinding','priorAttemptEvidenceBindingExactFields'],['viewerAuthorityBinding','viewerAuthorityBindingExactFields'],['nextSafeChoiceBinding','nextSafeChoiceBindingExactFields']]) exactKeys(input[key], contract.envelope[schema]);
  if (input.schemaVersion !== contract.contractVersion || !UUID.test(input.tenantId) || !UUID.test(input.drilldownRequestId) || input.materialDigest !== hash(materialOf(input)) || input.requestDigest !== hash(materialOf(input)) || input.idempotencyKeyDigest !== hash(stableOf(input))) throw new Error('envelope');
}

function validate(input, trusted) {
  validateEnvelope(input); dataOnly(trusted); exactKeys(trusted, contract.envelope.trustedResolutionExactFields);
  if (trusted.tenantId !== input.tenantId || trusted.evaluatedAt !== input.evaluatedAt) throw new Error('trusted');
  for (const key of contract.envelope.trustedResolutionExactFields.filter(key => !['tenantId','evaluatedAt'].includes(key))) if (hash(trusted[key]) !== hash(input[key])) throw new Error('trusted');
  const queue = input.queueItemBinding; const source = input.sourceAuthorityBinding; const policy = input.policyDecisionBinding; const head = input.lifecycleHeadBinding; const correction = input.sourceCorrectionBinding; const limit = input.limitEvidenceBinding; const attempts = input.priorAttemptEvidenceBinding; const viewer = input.viewerAuthorityBinding; const choice = input.nextSafeChoiceBinding;
  for (const tenant of [queue.tenantId, source.tenantId, policy.tenantId, head.tenantId, attempts.tenantId, viewer.actorTenantId, viewer.sessionTenantId, viewer.membershipTenantId]) if (tenant !== input.tenantId) throw new Error('tenant');
  for (const value of [queue.queueItemId, queue.originProjectionId, queue.originAssigneeActorId, queue.originAssigneeMembershipId, source.sourceRecordId, source.snapshotId, source.lineageId, source.predecessorSnapshotId, source.headTransitionId, source.effectiveSnapshotId, policy.policyId, policy.evaluationId, head.lifecycleId, head.eventId, head.assigneeActorId, head.assigneeMembershipId, viewer.actorId, viewer.sessionId, viewer.membershipId, viewer.capabilityDecisionId, viewer.recordId]) if (!UUID.test(value)) throw new Error('identity');
  for (const value of [queue.queueItemDigest, queue.originMaterialDigest, queue.originIdempotencyKeyDigest, queue.sourceLinkDigest, queue.semanticFingerprintDigest, source.sourceRecordDigest, source.snapshotDigest, source.predecessorSnapshotDigest, source.headTransitionDigest, source.effectiveSnapshotDigest, policy.policyDigest, policy.sourceSetDigest, policy.evaluationOutputDigest, head.queueItemDigest, head.eventDigest, head.semanticFingerprintDigest, head.sourceSnapshotDigest, head.sourceHeadTransitionDigest, head.policyDigest, viewer.capabilityDecisionDigest, input.materialDigest, input.idempotencyKeyDigest, input.requestDigest]) if (!DIGEST.test(value)) throw new Error('digest');
  const definition = queue.originContract === 'part12b_reviewed_handoff' ? part12B.queueKinds.find(item => item.id === queue.queueKind) : queue.originContract === 'part12a_action_queue' ? part12A.queueKinds.find(item => item.id === queue.queueKind) : null;
  const expectedReason = queue.originContract === 'part12b_reviewed_handoff' ? definition?.reasonCode : definition?.reasonCodes?.includes(queue.reasonCode) ? queue.reasonCode : null;
  if (!definition || queue.actionFamily !== definition.actionFamily || queue.reasonCode !== expectedReason || queue.semanticFingerprintDigest !== queueFingerprint(input) || queue.completionState !== 'unavailable_no_accepted_completion_authority' || !Number.isSafeInteger(queue.queueItemRevision) || queue.queueItemRevision < 1) throw new Error('queue');
  if (queue.originContract === 'part12b_reviewed_handoff') {
    const handoff = part12B.supportedHandoffs.find(item => item.evidenceQuality === queue.evidenceQuality && item.trustStatus === queue.trustStatus && item.uncertaintyState === queue.uncertaintyState && item.horizonKind === queue.horizonKind && item.queueKinds.includes(queue.queueKind)); if (!handoff || queue.horizonLocalStart !== null) throw new Error('handoff');
  } else if (queue.evidenceQuality !== 'complete_exact_source' || queue.trustStatus !== 'source_fact_only_not_permission' || queue.uncertaintyState !== 'none_exact_current' || queue.horizonKind !== 'not_applicable' || queue.horizonLocalStart !== null) throw new Error('source evidence');
  if (source.lineageKind !== 'active' || source.effectiveSnapshotId !== source.snapshotId || source.effectiveSnapshotDigest !== source.snapshotDigest || !Number.isSafeInteger(source.snapshotLineageSequence) || source.snapshotLineageSequence < 2 || !Number.isSafeInteger(source.headSequence) || source.headSequence < 1) throw new Error('source');
  if (policy.sourceSetDigest !== hash({tenantId: input.tenantId, snapshotId: source.snapshotId, snapshotDigest: source.snapshotDigest}) || !Number.isSafeInteger(policy.policyVersion) || policy.policyVersion < 1 || policy.result !== (queue.actionFamily === 'owner_approval_request' ? 'approval_required' : 'eligible') || !['eligible','approval_required'].includes(policy.result) || policy.evidenceQuality !== 'complete_exact') throw new Error('decision');
  const expectedReasons = policy.result === 'eligible' ? contract.decisionAndEvidenceContract.eligibleReasonCodes : contract.decisionAndEvidenceContract.approvalRequiredReasonCodes;
  if (!Array.isArray(policy.reasonCodes) || policy.reasonCodes.length > contract.bounds.maximumReasonCodes || hash(policy.reasonCodes) !== hash(expectedReasons) || new Set(policy.reasonCodes).size !== policy.reasonCodes.length || policy.reasonCodes.some(code => !part5B.reasonContract.closedCodes.includes(code))) throw new Error('reasons');
  const evaluated = micros(input.evaluatedAt); const observed = micros(source.observedAt); const decisionAt = micros(policy.evaluatedAt);
  if (evaluated === null || observed === null || decisionAt === null || observed > evaluated || decisionAt > evaluated) throw new Error('time');
  const stateDefinition = contract.supportedCurrentStates.find(item => item.id === head.state);
  const groupValid = head.groupId === null && head.groupKeyDigest === null || UUID.test(head.groupId) && DIGEST.test(head.groupKeyDigest);
  if (!stateDefinition || !groupValid || !part12C.priorityOrder.includes(head.priority) || micros(head.dueBy) === null || head.snoozedUntil !== null && micros(head.snoozedUntil) === null || ![null, 'owner_dismissed_pending_recheck'].includes(head.dismissReasonCode) || head.queueItemId !== queue.queueItemId || head.queueItemDigest !== queue.queueItemDigest || head.semanticFingerprintDigest !== queue.semanticFingerprintDigest || head.sourceSnapshotId !== source.snapshotId || head.sourceSnapshotDigest !== source.snapshotDigest || head.sourceHeadTransitionId !== source.headTransitionId || head.sourceHeadTransitionDigest !== source.headTransitionDigest || head.sourceHeadSequence !== source.headSequence || head.policyId !== policy.policyId || head.policyVersion !== policy.policyVersion || head.policyDigest !== policy.policyDigest || head.unresolvedConsequenceState !== 'unresolved_visible' || head.completionState !== 'unavailable_no_accepted_completion_authority' || !Number.isSafeInteger(head.revision) || head.revision < 1 || head.revision > contract.bounds.maximumLifecycleRevision || !Number.isSafeInteger(head.sourceHeadSequence) || head.sourceHeadSequence < 1 || head.sourceHeadSequence > contract.bounds.maximumHeadSequence || !Number.isSafeInteger(head.escalationLevel) || head.escalationLevel < 0 || head.escalationLevel > part12C.bounds.maximumEscalationLevel) throw new Error('lifecycle');
  if (head.state === 'source_changed_stale') {
    for (const value of [correction.lineageId, correction.predecessorSnapshotId, correction.replacementSnapshotId, correction.replacementHeadTransitionId, correction.replacementEffectiveSnapshotId]) if (!UUID.test(value)) throw new Error('correction identity');
    for (const value of [correction.predecessorSnapshotDigest, correction.replacementSnapshotDigest, correction.replacementHeadTransitionDigest, correction.replacementEffectiveSnapshotDigest]) if (!DIGEST.test(value)) throw new Error('correction digest');
    if (!DIGEST.test(correction.successorQueueMaterialDigest) || source.currentnessState !== 'corrected' || correction.correctionKind !== 'same_lineage_exact_next_snapshot' || correction.lineageId !== source.lineageId || correction.predecessorSnapshotId !== source.snapshotId || correction.predecessorSnapshotDigest !== source.snapshotDigest || correction.predecessorSnapshotLineageSequence !== source.snapshotLineageSequence || correction.replacementSnapshotId === source.snapshotId || correction.replacementSnapshotDigest === source.snapshotDigest || correction.replacementSnapshotLineageSequence !== source.snapshotLineageSequence + 1 || correction.replacementHeadTransitionId === source.headTransitionId || correction.replacementHeadTransitionDigest === source.headTransitionDigest || correction.replacementHeadSequence !== source.headSequence + 1 || correction.replacementEffectiveSnapshotId !== correction.replacementSnapshotId || correction.replacementEffectiveSnapshotDigest !== correction.replacementSnapshotDigest || correction.replacementCurrentnessState !== 'latest_exact_current' || correction.successorQueueMaterialDigest === queue.originMaterialDigest || correction.successorRequired !== true) throw new Error('correction');
  } else {
    if (source.currentnessState !== 'latest_exact_current' || evaluated - observed > BigInt(contract.bounds.maximumSourceObservationAgeSeconds) * 1000000n || Object.values(correction).some(value => value !== null)) throw new Error('currentness');
  }
  if (limit.state !== 'unavailable_no_mounted_limit_resolution' || limit.mandatoryConstraintManifestDigest !== part3C.mandatoryConstraints.manifestDigest || [limit.limitProfileId, limit.limitProfileDigest, limit.effectiveLimitDigest, limit.evaluatedAt].some(value => value !== null)) throw new Error('limits');
  if (attempts.state !== 'unavailable_no_mounted_action_attempt_history' || attempts.attemptCount !== 0 || attempts.outcomeState !== 'unavailable' || [attempts.latestAttemptId, attempts.latestAttemptDigest, attempts.latestAttemptAt, attempts.providerRequestId].some(value => value !== null)) throw new Error('attempts');
  const viewCapability = part3A.capabilities.find(item => item.id === 'automation_view');
  if (!viewCapability || viewer.actorId !== viewer.sessionSubjectActorId || viewer.actorId !== viewer.membershipSubjectActorId || viewer.actorState !== 'active' || viewer.sessionState !== 'active' || viewer.membershipState !== 'active' || !contract.viewerContract.allowedRoles.includes(viewer.membershipRoleId) || !viewCapability.grants.some(grant => grant.membershipRoleId === viewer.membershipRoleId && grant.recordScope === viewer.recordScope) || viewer.capabilityState !== 'exact_current_granted' || viewer.capabilityId !== 'automation_view' || viewer.recordScope !== 'exact_tenant_all_automation' || viewer.recordId !== queue.queueItemId) throw new Error('viewer');
  if (choice.choiceId !== stateDefinition.nextSafeChoiceId || choice.labelId !== stateDefinition.labelId || choice.fixedLabel !== stateDefinition.fixedLabel || choice.requiredCapabilityId !== 'automation_view' || choice.authorityState !== 'label_only_no_action_authority' || choice.recordScope !== viewer.recordScope || choice.actionAuthorityGranted !== false || choice.effectAuthorityGranted !== false) throw new Error('choice');
  return true;
}

function project(input, trusted) {
  validate(input, trusted);
  return Object.freeze({drilldownRequestId: input.drilldownRequestId, tenantId: input.tenantId, queueItemId: input.queueItemBinding.queueItemId, lifecycleId: input.lifecycleHeadBinding.lifecycleId, currentState: input.lifecycleHeadBinding.state, sourceSnapshotId: input.sourceAuthorityBinding.snapshotId, sourceSnapshotDigest: input.sourceAuthorityBinding.snapshotDigest, policyId: input.policyDecisionBinding.policyId, policyVersion: input.policyDecisionBinding.policyVersion, policyDigest: input.policyDecisionBinding.policyDigest, decisionResult: input.policyDecisionBinding.result, decisionReasonCodes: copy(input.policyDecisionBinding.reasonCodes), evidenceQuality: input.queueItemBinding.evidenceQuality, trustStatus: input.queueItemBinding.trustStatus, uncertaintyState: input.queueItemBinding.uncertaintyState, horizonKind: input.queueItemBinding.horizonKind, completionState: input.lifecycleHeadBinding.completionState, limitEvidenceState: input.limitEvidenceBinding.state, priorAttemptEvidenceState: input.priorAttemptEvidenceBinding.state, nextSafeChoiceId: input.nextSafeChoiceBinding.choiceId, nextSafeChoiceLabelId: input.nextSafeChoiceBinding.labelId, nextSafeChoiceLabel: input.nextSafeChoiceBinding.fixedLabel, evaluatedAt: input.evaluatedAt, resultState: contract.fixedDecision.resultState, reasonState: contract.fixedDecision.reasonState, labelId: contract.fixedDecision.labelId, fixedLabel: contract.fixedDecision.fixedLabel, ownerReadableNoEffectOnly: true, actionAuthorityGranted: false, drilldownRecordCreated: false, queueItemChanged: false, lifecycleEventCreated: false, completionEvidenceCreated: false, scheduleCreated: false, workCreated: false, estimateChanged: false, messageCreated: false, recipientContacted: false, providerAttemptCreated: false, externalEffectCreated: false, upstreamMutationCreated: false, financialEffectCreated: false, moneyEffectCreated: false, enterpriseAuthorityGranted: false, legalAuthorityGranted: false});
}

class History {
  constructor() { this.byRequest = new Map(); this.byStable = new Map(); }
  record(input, trusted) {
    validateEnvelope(input); dataOnly(trusted); exactKeys(trusted, contract.envelope.trustedResolutionExactFields); const prior = this.byRequest.get(input.drilldownRequestId);
    if (prior) { if (prior.requestDigest !== input.requestDigest || prior.materialDigest !== input.materialDigest || prior.idempotencyKeyDigest !== input.idempotencyKeyDigest) throw new Error('identity conflict'); return {...prior, replayed: true}; }
    const output = project(input, trusted); if (this.byStable.has(input.idempotencyKeyDigest)) throw new Error('semantic clone');
    const stored = Object.freeze({...output, requestDigest: input.requestDigest, materialDigest: input.materialDigest, idempotencyKeyDigest: input.idempotencyKeyDigest, replayed: false}); this.byRequest.set(input.drilldownRequestId, stored); this.byStable.set(input.idempotencyKeyDigest, input.drilldownRequestId); return stored;
  }
}

function rejectCoherent(state, mutate, originContract = 'part12b_reviewed_handoff', queueKind = null) {
  const pair = fixture(state, originContract, queueKind); mutate(pair.input); pair.input.queueItemBinding.semanticFingerprintDigest = queueFingerprint(pair.input); pair.input.lifecycleHeadBinding.semanticFingerprintDigest = pair.input.queueItemBinding.semanticFingerprintDigest; seal(pair.input); expect(() => project(pair.input, pair.trusted)).toThrow();
}

describe('Mission 28 Part 12D action explanation and drilldown contract', () => {
  test('binds exact Part12C release evidence and frozen inputs', () => {
    expect(contract.authority).toMatchObject({part: '12D', state: 'implementation_candidate_only', baselineCommit: '2e09782ea730624afae30c8d833bc7157b1179ab', baselineTree: 'ef5326b775e375e6b7ce759dfca818816b596b36'});
    expect(contract.part12CRelease).toMatchObject({acceptedSourceHead: '20686587287d19bfecd58069d8e03d6c2130071b', acceptedTree: 'ef5326b775e375e6b7ce759dfca818816b596b36', pullRequest: 601, mergedMain: '2e09782ea730624afae30c8d833bc7157b1179ab', productionAccepted: true, freshAudit: {verdict: 'P0=0_P1=0_P2=0_P3=0', nodeVersion: '22.23.3', focusedTests: '26/26', parts11ATo12C: '9_suites_148_tests', cumulativeMission28: '53_suites_750_tests', migrationHistory: '2_suites_40_tests', syntax: '53/53', json: '52/52', migrations: '283_through_287_no_288', changedPaths: '57_docs_tests_only', protectedPaths: 0}, release: {deploymentId: 'dfec31f0-97bf-4acd-b737-37c7e539b67c', deploymentStatus: 'SUCCESS', serviceInstanceId: '7ee4f747-38c2-4baa-a024-1d7db6e7c218', deploymentInstanceId: 'b159efaa-20ca-4f14-b432-f1877f87ad31', deploymentInstanceStatus: 'RUNNING', imageSha256: 'sha256:791ebe1fe09245e53bf459829811b6e004c323a8acc352798530e8ee487867fe', canonicalStartup: 'ready'}, directAppliedProductionMigrationHistory: 'unavailable_and_unclaimed'});
    expect(contract.frozenInputs).toHaveLength(8); for (const item of contract.frozenInputs) expect(digestLf(item.path)).toBe(item.normalizedLfSha256);
  });

  test.each(contract.supportedCurrentStates.map(item => item.id))('projects %s only as a fixed private no-effect drilldown', state => {
    const output = project(...Object.values(fixture(state)));
    const expected = contract.supportedCurrentStates.find(item => item.id === state);
    expect(output).toMatchObject({currentState: state, nextSafeChoiceId: expected.nextSafeChoiceId, nextSafeChoiceLabelId: expected.labelId, nextSafeChoiceLabel: expected.fixedLabel, completionState: 'unavailable_no_accepted_completion_authority', limitEvidenceState: 'unavailable_no_mounted_limit_resolution', priorAttemptEvidenceState: 'unavailable_no_mounted_action_attempt_history', resultState: contract.fixedDecision.resultState, ownerReadableNoEffectOnly: true, actionAuthorityGranted: false});
  });

  test('binds every released Part12A and Part12B queue kind without creating queue or completion authority', () => {
    for (const queue of part12A.queueKinds) expect(() => project(...Object.values(fixture('open', 'part12a_action_queue', queue.id)))).not.toThrow();
    for (const queue of part12B.queueKinds) expect(() => project(...Object.values(fixture('open', 'part12b_reviewed_handoff', queue.id)))).not.toThrow();
    for (const mutation of [v => { v.queueItemBinding.originContract = 'unknown'; }, v => { v.queueItemBinding.reasonCode = 'different'; }, v => { v.queueItemBinding.actionFamily = 'customer_communication'; }, v => { v.queueItemBinding.completionState = 'completed'; }]) rejectCoherent('open', mutation);
  });

  test('uses the exact released Part12C semantic fingerprint projection and rejects every omitted-field drift', () => {
    expect(contract.semanticFingerprintContract.exactProjectionFields).toEqual([
      'tenantId', 'queueItemBinding.queueKind', 'queueItemBinding.actionFamily', 'sourceAuthorityBinding.sourceRecordId', 'sourceAuthorityBinding.sourceRecordDigest', 'sourceAuthorityBinding.snapshotId', 'sourceAuthorityBinding.snapshotDigest', 'policyDecisionBinding.policyId', 'policyDecisionBinding.policyVersion', 'policyDecisionBinding.policyDigest', 'policyDecisionBinding.evaluationId', 'policyDecisionBinding.evaluationOutputDigest', 'queueItemBinding.originAssigneeActorId', 'queueItemBinding.reasonCode', 'queueItemBinding.evidenceQuality', 'queueItemBinding.trustStatus', 'queueItemBinding.uncertaintyState', 'queueItemBinding.horizonKind', 'queueItemBinding.horizonLocalStart'
    ]);
    expect(contract.semanticFingerprintContract.part12DOriginContractProjectionFieldsAreNotAdded).toEqual(['queueItemBinding.originContract', 'queueItemBinding.originProjectionId', 'queueItemBinding.originMaterialDigest']);
    const mutations = [
      value => { value.sourceAuthorityBinding.sourceRecordId = uuid(99); },
      value => { value.sourceAuthorityBinding.sourceRecordDigest = digest(99); },
      value => { value.policyDecisionBinding.policyDigest = digest(99); },
      value => { value.policyDecisionBinding.evaluationId = uuid(99); },
      value => { value.queueItemBinding.originAssigneeActorId = uuid(99); },
      value => { value.queueItemBinding.evidenceQuality = 'complete_exact_source'; },
      value => { value.queueItemBinding.trustStatus = 'source_fact_only_not_permission'; },
      value => { value.queueItemBinding.uncertaintyState = 'none_exact_current'; },
      value => { value.queueItemBinding.horizonKind = 'not_applicable'; },
      value => { value.queueItemBinding.horizonLocalStart = '2026-10-01'; }
    ];
    for (const mutate of mutations) {
      const pair = fixture(); const releasedFingerprint = pair.input.queueItemBinding.semanticFingerprintDigest;
      mutate(pair.input); expect(queueFingerprint(pair.input)).not.toBe(releasedFingerprint);
      seal(pair.input); pair.trusted = trustedOf(pair.input);
      expect(() => project(pair.input, pair.trusted)).toThrow('queue');
    }
  });

  test('binds exact policy source decision lifecycle and immutable current head', () => {
    for (const mutation of [v => { v.sourceAuthorityBinding.snapshotId = uuid(99); }, v => { v.sourceAuthorityBinding.headTransitionDigest = digest(99); }, v => { v.policyDecisionBinding.policyVersion += 1; }, v => { v.policyDecisionBinding.sourceSetDigest = digest(99); }, v => { v.policyDecisionBinding.evaluationOutputDigest = digest(99); }, v => { v.policyDecisionBinding.reasonCodes = ['rule_no_match']; }, v => { v.lifecycleHeadBinding.queueItemId = uuid(99); }, v => { v.lifecycleHeadBinding.sourceHeadSequence += 1; }, v => { v.lifecycleHeadBinding.policyId = uuid(99); }, v => { v.lifecycleHeadBinding.eventDigest = digest(99); }, v => { v.lifecycleHeadBinding.groupId = uuid(70); }, v => { v.lifecycleHeadBinding.priority = 'critical'; }, v => { v.lifecycleHeadBinding.dueBy = 'tomorrow'; }, v => { v.lifecycleHeadBinding.dismissReasonCode = 'customer@example.test'; }]) rejectCoherent('open', mutation);
    expect(part4D.coalescingAndPrecedence.orderedRules).toContain('eventTime_or_observedAt_never_overrides_lineage_sequence_predecessor_or_separately_trusted_operation');
  });

  test('requires exact source-correction lineage and rejects stale or ambiguous non-correction material', () => {
    expect(project(...Object.values(fixture('source_changed_stale')))).toMatchObject({currentState: 'source_changed_stale', nextSafeChoiceId: 'review_source_correction'});
    for (const mutation of [v => { v.sourceAuthorityBinding.currentnessState = 'mixed'; }, v => { v.sourceCorrectionBinding.lineageId = uuid(99); }, v => { v.sourceCorrectionBinding.replacementSnapshotLineageSequence += 1; }, v => { v.sourceCorrectionBinding.replacementHeadTransitionId = v.sourceAuthorityBinding.headTransitionId; }, v => { v.sourceCorrectionBinding.replacementHeadTransitionDigest = v.sourceAuthorityBinding.headTransitionDigest; }, v => { v.sourceCorrectionBinding.replacementHeadSequence = v.sourceAuthorityBinding.headSequence; }, v => { v.sourceCorrectionBinding.replacementEffectiveSnapshotId = uuid(99); }, v => { v.sourceCorrectionBinding.successorQueueMaterialDigest = v.queueItemBinding.originMaterialDigest; }, v => { v.sourceCorrectionBinding.successorRequired = false; }]) rejectCoherent('source_changed_stale', mutation);
    rejectCoherent('open', v => { v.sourceAuthorityBinding.currentnessState = 'stale'; }); rejectCoherent('open', v => { v.sourceCorrectionBinding.correctionKind = 'same_lineage_exact_next_snapshot'; });
  });

  test('keeps limits and prior attempts explicitly unavailable instead of fabricating zeros or outcomes', () => {
    const output = project(...Object.values(fixture())); expect(output).toMatchObject({limitEvidenceState: 'unavailable_no_mounted_limit_resolution', priorAttemptEvidenceState: 'unavailable_no_mounted_action_attempt_history'});
    for (const mutation of [v => { v.limitEvidenceBinding.limitProfileId = uuid(99); }, v => { v.limitEvidenceBinding.effectiveLimitDigest = digest(99); }, v => { v.limitEvidenceBinding.mandatoryConstraintManifestDigest = digest(99); }, v => { v.priorAttemptEvidenceBinding.attemptCount = 1; }, v => { v.priorAttemptEvidenceBinding.latestAttemptId = uuid(99); }, v => { v.priorAttemptEvidenceBinding.outcomeState = 'delivered'; }, v => { v.priorAttemptEvidenceBinding.providerRequestId = 'provider-secret'; }]) rejectCoherent('open', mutation);
  });

  test('requires exact same-tenant owner viewer subject capability scope and record identity', () => {
    for (const role of ['owner','admin']) { const pair = fixture(); pair.input.viewerAuthorityBinding.membershipRoleId = role; seal(pair.input); pair.trusted = trustedOf(pair.input); expect(() => project(pair.input, pair.trusted)).not.toThrow(); }
    for (const mutation of [v => { v.viewerAuthorityBinding.sessionSubjectActorId = uuid(99); }, v => { v.viewerAuthorityBinding.membershipSubjectActorId = uuid(99); }, v => { v.viewerAuthorityBinding.membershipTenantId = uuid(99); }, v => { v.viewerAuthorityBinding.actorState = 'disabled'; }, v => { v.viewerAuthorityBinding.membershipRoleId = 'member'; }, v => { v.viewerAuthorityBinding.capabilityId = 'automation_run_approve'; }, v => { v.viewerAuthorityBinding.recordScope = 'exact_assigned_internal_records_only'; }, v => { v.viewerAuthorityBinding.recordId = uuid(99); }]) rejectCoherent('open', mutation);
  });

  test('derives fixed next-safe-choice labels without granting any separate action authority', () => {
    for (const mutation of [v => { v.nextSafeChoiceBinding.choiceId = 'send_customer_message'; }, v => { v.nextSafeChoiceBinding.labelId = 'customer@example.test'; }, v => { v.nextSafeChoiceBinding.fixedLabel = 'Pay $999 now'; }, v => { v.nextSafeChoiceBinding.requiredCapabilityId = 'automation_run_approve'; }, v => { v.nextSafeChoiceBinding.authorityState = 'authorized'; }, v => { v.nextSafeChoiceBinding.actionAuthorityGranted = true; }, v => { v.nextSafeChoiceBinding.effectAuthorityGranted = true; }]) rejectCoherent('open', mutation);
    expect(contract.fixedDecision.neverMeans).toMatch(/schedule_work_estimate_message_recipient_provider_external_upstream_financial_money_enterprise_or_legal_authority/);
  });

  test('rejects malformed and hostile data before digest identity or history lookup', () => {
    for (const mutation of [v => { v.extra = true; }, v => { delete v.schemaVersion; }, v => { v.policyDecisionBinding.reasonCodes = null; }, v => { v.nextSafeChoiceBinding.extra = true; }]) rejectCoherent('open', mutation);
    const getter = fixture(); let reads = 0; Object.defineProperty(getter.input.queueItemBinding, 'queueItemDigest', {enumerable: true, get() { reads += 1; return digest(10); }}); expect(() => project(getter.input, getter.trusted)).toThrow(); expect(reads).toBe(0);
    for (const hostile of [new Proxy(fixture().input, {}), Object.assign(Object.create({polluted: true}), fixture().input), Object.assign(fixture().input, {toJSON() { return {}; }}), Object.assign(fixture().input, {[Symbol('secret')]: true})]) expect(() => project(hostile, fixture().trusted)).toThrow();
    const sparse = fixture(); sparse.input.policyDecisionBinding.reasonCodes = Object.assign(Array(3), ['rule_match']); expect(() => project(sparse.input, sparse.trusted)).toThrow();
    const alias = fixture(); alias.input.sourceCorrectionBinding = alias.input.sourceAuthorityBinding; expect(() => project(alias.input, alias.trusted)).toThrow();
  });

  test('provides exact replay and denies request conflict and semantic clone reuse', () => {
    const history = new History(); const pair = fixture(); expect(history.record(pair.input, pair.trusted).replayed).toBe(false); expect(history.record(copy(pair.input), copy(pair.trusted)).replayed).toBe(true);
    const conflict = copy(pair.input); conflict.nextSafeChoiceBinding.labelId = 'different'; seal(conflict); expect(() => history.record(conflict, trustedOf(conflict))).toThrow('identity conflict');
    const clone = copy(pair.input); clone.drilldownRequestId = uuid(999); clone.evaluatedAt = '2026-10-29T12:05:01.000000Z'; clone.sourceAuthorityBinding.observedAt = '2026-10-29T12:04:01.000000Z'; clone.policyDecisionBinding.evaluatedAt = clone.evaluatedAt; seal(clone); expect(clone.idempotencyKeyDigest).toBe(pair.input.idempotencyKeyDigest); expect(() => history.record(clone, trustedOf(clone))).toThrow('semantic clone');
    const malformedReplay = copy(pair.input); malformedReplay.extra = true; expect(() => history.record(malformedReplay, pair.trusted)).toThrow();
  });

  test('keeps every persistence provider external financial enterprise legal and completion claim at zero', () => {
    const output = project(...Object.values(fixture('escalated'))); const booleans = Object.entries(output).filter(([key]) => /(Created|Changed|Contacted|Granted)$/.test(key)); expect(booleans.every(([, value]) => value === false)).toBe(true);
    expect(contract.runtimeBoundary).toMatchObject({newMigration: false, newTableFunctionRouteWorkerQueueSchedulerOrUi: false, mountedActionExplanationOrDrilldownResolver: false, mountedLimitOrPriorAttemptResolver: false, acceptedCompletionOrNextChoiceActionAuthority: false, drilldownRecordsCreated: 0, queueItemsChanged: 0, lifecycleEventsCreated: 0, messagesCreated: 0, recipientsContacted: 0, providerAttemptsCreated: 0, externalEffectsCreated: 0, upstreamMutationsCreated: 0, financialEffectsCreated: 0, moneyEffectsCreated: 0, enterpriseAuthorityGranted: false, legalAuthorityGranted: false, latestMigration: '287_canonical_automation_estimate_quote_resolution_v1.sql', nextMigrationAbsent: '288'});
  });

  test('reconciles roadmap and ledger to Part12C released and Part12D sole candidate', () => {
    const roadmap = fs.readFileSync(path.join(ROOT, 'docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md'), 'utf8'); const ledger = fs.readFileSync(path.join(ROOT, 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md'), 'utf8');
    for (const value of [roadmap, ledger]) { expect(value).toContain('Parts 1A–13A are released. Part 13B is the sole implementation candidate.'); expect(value).toContain('Parts 13C–14G remain planned and unimplemented.'); for (const identity of ['20686587287d19bfecd58069d8e03d6c2130071b','ef5326b775e375e6b7ce759dfca818816b596b36','2e09782ea730624afae30c8d833bc7157b1179ab','dfec31f0-97bf-4acd-b737-37c7e539b67c','7ee4f747-38c2-4baa-a024-1d7db6e7c218','b159efaa-20ca-4f14-b432-f1877f87ad31','sha256:791ebe1fe09245e53bf459829811b6e004c323a8acc352798530e8ee487867fe','0a1f73636ca4fe873330301107a9c3ed92edea9a4a2a285467b0aeede581fd38','b42145ddc95e9bc2a383f9dac6ad1f5a884a90d5a3e999a0c126b2b6e3bae369']) expect(value).toContain(identity); expect(value).toMatch(/direct applied production migration history.*unavailable.*unclaimed/i); }
    expect((ledger.match(/\| \*\*Released\*\* \|/g) || []).length).toBe(55); expect((ledger.match(/\| \*\*Implementation candidate\*\* \|/g) || []).length).toBe(1); expect((ledger.match(/\| Planned \/ unimplemented \|/g) || []).length).toBe(10);
    expect(ledger).toContain('| 54 | 12D | Owner explanation and cross-authority drilldown | **Released** |'); expect(ledger).toContain('| 55 | 13A | Provider-neutral adapter and capability discovery | **Released** |');
  });
});
