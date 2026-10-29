const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { types } = require('util');

const ROOT = path.resolve(__dirname, '../..');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
const contract = readJson('docs/architecture/MISSION_28_PART12C_ACTION_QUEUE_LIFECYCLE_CONTRACT.json');
const part12A = readJson('docs/architecture/MISSION_28_PART12A_TENANT_PRIVATE_ACTION_QUEUE_CONTRACT.json');
const part12B = readJson('docs/architecture/MISSION_28_PART12B_REVIEWED_ATTENTION_HANDOFF_CONTRACT.json');
const part3A = readJson('docs/architecture/MISSION_28_PART3A_FIXED_CAPABILITY_MATRIX.json');
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
  const value = materialOf(input); delete value.lifecycleRequestId; delete value.evaluatedAt;
  value.sourceAuthorityBinding.observedAt = null; value.policyEvaluationBinding.evaluatedAt = null;
  value.operationBinding.operationId = null; value.lifecycleHeadBinding.lifecycleId = null;
  value.targetBinding.lifecycleId = null; value.targetBinding.eventId = null; value.targetBinding.eventDigest = null;
  value.timingBinding.requestedAt = null; value.timingBinding.effectiveAt = null;
  return value;
}
function seal(input) { input.materialDigest = hash(materialOf(input)); input.idempotencyKeyDigest = hash(stableOf(input)); input.requestDigest = hash(materialOf(input)); return input; }
function trustedOf(input) { return copy({tenantId: input.tenantId, queueItemBinding: input.queueItemBinding, sourceAuthorityBinding: input.sourceAuthorityBinding, policyEvaluationBinding: input.policyEvaluationBinding, lifecycleHeadBinding: input.lifecycleHeadBinding, operationBinding: input.operationBinding, targetBinding: input.targetBinding, actorAuthorityBinding: input.actorAuthorityBinding, assigneeTransitionBinding: input.assigneeTransitionBinding, timingBinding: input.timingBinding, evaluatedAt: input.evaluatedAt}); }
function lifecycleEventDigest(input) { const value = materialOf(input); delete value.lifecycleRequestId; value.targetBinding.eventDigest = null; return hash(value); }
function semanticFingerprint(input) {
  const queue = input.queueItemBinding; const source = input.sourceAuthorityBinding; const policy = input.policyEvaluationBinding;
  return hash({tenantId: input.tenantId, queueKind: queue.queueKind, actionFamily: queue.actionFamily, sourceRecordId: source.sourceRecordId, sourceRecordDigest: source.sourceRecordDigest, snapshotId: source.snapshotId, snapshotDigest: source.snapshotDigest, policyId: policy.policyId, policyVersion: policy.policyVersion, policyDigest: policy.policyDigest, evaluationId: policy.evaluationId, evaluationOutputDigest: policy.evaluationOutputDigest, originAssigneeActorId: queue.originAssigneeActorId, reasonCode: queue.reasonCode, evidenceQuality: queue.evidenceQuality, trustStatus: queue.trustStatus, uncertaintyState: queue.uncertaintyState, horizonKind: queue.horizonKind, horizonLocalStart: queue.horizonLocalStart});
}
function groupKey(input, assignee = input.targetBinding.assigneeActorId) {
  const queue = input.queueItemBinding; const policy = input.policyEvaluationBinding;
  return hash({tenantId: input.tenantId, queueKind: queue.queueKind, actionFamily: queue.actionFamily, policyId: policy.policyId, assigneeActorId: assignee, reasonCode: queue.reasonCode, evidenceQuality: queue.evidenceQuality, trustStatus: queue.trustStatus, uncertaintyState: queue.uncertaintyState, horizonKind: queue.horizonKind, horizonLocalStart: queue.horizonLocalStart});
}
const nullCorrection = () => ({correctionKind: null, lineageId: null, predecessorSnapshotId: null, predecessorSnapshotDigest: null, predecessorSnapshotLineageSequence: null, replacementSnapshotId: null, replacementSnapshotDigest: null, replacementSnapshotLineageSequence: null, replacementHeadTransitionId: null, replacementHeadTransitionDigest: null, replacementHeadSequence: null, replacementEffectiveSnapshotId: null, replacementEffectiveSnapshotDigest: null, replacementCurrentnessState: null, successorQueueMaterialDigest: null, successorRequired: null});

function fixture(operationKind = 'set_priority', originContract = 'part12b_reviewed_handoff', requestedQueueKind = null) {
  const operation = contract.operations.find(item => item.id === operationKind);
  const tenantId = uuid(1); const evaluatedAt = operationKind === 'expire' ? '2026-10-30T12:05:00.000000Z' : '2026-10-29T12:05:00.000000Z';
  const fromPart12B = originContract === 'part12b_reviewed_handoff';
  const queueKind = requestedQueueKind || (fromPart12B ? 'owner_attention_item' : 'owner_task');
  const queueDefinition = fromPart12B ? part12B.queueKinds.find(item => item.id === queueKind) : part12A.queueKinds.find(item => item.id === queueKind);
  const queueItemBinding = {tenantId, queueItemId: uuid(10), queueItemRevision: 1, queueItemDigest: digest(10), queueKind, actionFamily: queueDefinition.actionFamily, reasonCode: fromPart12B ? queueDefinition.reasonCode : queueDefinition.reasonCodes[0], originContract, originProjectionId: uuid(11), originMaterialDigest: digest(11), originIdempotencyKeyDigest: digest(12), originAssigneeActorId: uuid(40), originAssigneeMembershipId: uuid(41), originNotBefore: '2026-10-29T12:05:00.000000Z', originDueBy: '2026-10-30T12:05:00.000000Z', evidenceQuality: fromPart12B ? 'complete_exact_reviewed_cohort' : 'complete_exact_source', trustStatus: fromPart12B ? 'reviewed_advisory_only' : 'source_fact_only_not_permission', uncertaintyState: fromPart12B ? 'descriptive_sample_not_prediction' : 'none_exact_current', horizonKind: fromPart12B ? 'historical_current_cohort' : 'not_applicable', horizonLocalStart: null, sourceLinkDigest: digest(13), completionState: 'unavailable_no_accepted_completion_authority', semanticFingerprintDigest: ''};
  const sourceAuthorityBinding = {tenantId, sourceRecordId: uuid(20), sourceRecordDigest: digest(20), snapshotId: uuid(21), snapshotDigest: digest(21), lineageId: uuid(22), lineageKind: 'active', snapshotLineageSequence: 3, predecessorSnapshotId: uuid(19), predecessorSnapshotDigest: digest(19), headTransitionId: uuid(23), headTransitionDigest: digest(23), headSequence: 5, effectiveSnapshotId: uuid(21), effectiveSnapshotDigest: digest(21), currentnessState: 'latest_exact_current', observedAt: '2026-10-29T12:04:00.000000Z'};
  const policyEvaluationBinding = {tenantId, policyId: uuid(30), policyVersion: 2, policyDigest: digest(30), sourceSetDigest: hash({tenantId, snapshotId: sourceAuthorityBinding.snapshotId, snapshotDigest: sourceAuthorityBinding.snapshotDigest}), evaluationId: uuid(31), evaluationOutputDigest: digest(31), result: queueDefinition.actionFamily === 'owner_approval_request' ? 'approval_required' : 'eligible', evaluatedAt: '2026-10-29T12:05:00.000000Z'};
  const root = operationKind === 'assign';
  let state = 'open';
  if (operationKind === 'reopen') state = 'dismissed_unresolved_visible';
  const lifecycleHeadBinding = {lifecycleId: uuid(50), revision: root ? 0 : 2, eventId: root ? null : uuid(51), eventDigest: root ? null : digest(51), semanticFingerprintDigest: '', state: root ? 'unregistered' : state, groupId: null, groupKeyDigest: null, priority: root ? null : queueDefinition.priorities[0], assigneeActorId: root ? null : queueItemBinding.originAssigneeActorId, assigneeMembershipId: root ? null : queueItemBinding.originAssigneeMembershipId, dueBy: root ? null : queueItemBinding.originDueBy, snoozedUntil: null, dismissReasonCode: state === 'dismissed_unresolved_visible' ? 'owner_dismissed_pending_recheck' : null, escalationLevel: 0, sourceSnapshotId: root ? null : sourceAuthorityBinding.snapshotId, sourceSnapshotDigest: root ? null : sourceAuthorityBinding.snapshotDigest, sourceHeadTransitionId: root ? null : sourceAuthorityBinding.headTransitionId, sourceHeadTransitionDigest: root ? null : sourceAuthorityBinding.headTransitionDigest, sourceHeadSequence: root ? null : sourceAuthorityBinding.headSequence, policyId: root ? null : policyEvaluationBinding.policyId, policyVersion: root ? null : policyEvaluationBinding.policyVersion, policyDigest: root ? null : policyEvaluationBinding.policyDigest, unresolvedConsequenceState: 'unresolved_visible', completionState: 'unavailable_no_accepted_completion_authority'};
  const targetBinding = copy(lifecycleHeadBinding);
  targetBinding.revision = root ? 1 : lifecycleHeadBinding.revision + 1;
  targetBinding.eventId = uuid(52); targetBinding.eventDigest = null;
  targetBinding.state = root ? 'open' : lifecycleHeadBinding.state;
  targetBinding.priority = root ? queueDefinition.priorities[0] : lifecycleHeadBinding.priority;
  targetBinding.assigneeActorId = root ? queueItemBinding.originAssigneeActorId : lifecycleHeadBinding.assigneeActorId;
  targetBinding.assigneeMembershipId = root ? queueItemBinding.originAssigneeMembershipId : lifecycleHeadBinding.assigneeMembershipId;
  targetBinding.dueBy = root ? queueItemBinding.originDueBy : lifecycleHeadBinding.dueBy;
  targetBinding.sourceSnapshotId = sourceAuthorityBinding.snapshotId; targetBinding.sourceSnapshotDigest = sourceAuthorityBinding.snapshotDigest; targetBinding.sourceHeadTransitionId = sourceAuthorityBinding.headTransitionId; targetBinding.sourceHeadTransitionDigest = sourceAuthorityBinding.headTransitionDigest; targetBinding.sourceHeadSequence = sourceAuthorityBinding.headSequence; targetBinding.policyId = policyEvaluationBinding.policyId; targetBinding.policyVersion = policyEvaluationBinding.policyVersion; targetBinding.policyDigest = policyEvaluationBinding.policyDigest;
  const operationBinding = {operationId: uuid(60), operationKind, reasonCode: `action_${operationKind}`, semanticFingerprintDigest: '', groupCandidateCount: operationKind === 'group' ? 2 : 1, sourceCorrectionBinding: nullCorrection()};
  const assigneeTransitionBinding = {fromActorId: lifecycleHeadBinding.assigneeActorId, fromMembershipId: lifecycleHeadBinding.assigneeMembershipId, toActorId: targetBinding.assigneeActorId, toMembershipId: targetBinding.assigneeMembershipId, toMembershipSubjectActorId: targetBinding.assigneeActorId, toTenantId: tenantId, toMembershipState: 'active', toRoleId: fromPart12B ? queueDefinition.assigneeRole : queueDefinition.assigneeRoles[0], assignmentDecisionId: uuid(61), assignmentDecisionDigest: digest(61), recordScope: 'exact_tenant_all_automation'};
  const timingBinding = {requestedAt: evaluatedAt, effectiveAt: operationKind === 'expire' ? queueItemBinding.originDueBy : evaluatedAt, expiresAt: null};
  if (operationKind === 'dedupe_coalesce') Object.assign(targetBinding, copy(lifecycleHeadBinding));
  if (operationKind === 'group') { targetBinding.groupId = uuid(70); }
  if (operationKind === 'set_priority') targetBinding.priority = 'high';
  if (operationKind === 'snooze') { targetBinding.state = 'snoozed'; targetBinding.snoozedUntil = '2026-10-30T12:05:00.000000Z'; timingBinding.expiresAt = targetBinding.snoozedUntil; }
  if (operationKind === 'dismiss') { targetBinding.state = 'dismissed_unresolved_visible'; targetBinding.dismissReasonCode = 'owner_dismissed_pending_recheck'; }
  if (operationKind === 'reassign') { targetBinding.assigneeActorId = uuid(80); targetBinding.assigneeMembershipId = uuid(81); Object.assign(assigneeTransitionBinding, {toActorId: uuid(80), toMembershipId: uuid(81), toMembershipSubjectActorId: uuid(80)}); }
  if (operationKind === 'escalate') { targetBinding.state = 'escalated'; targetBinding.priority = 'high'; targetBinding.escalationLevel = 1; }
  if (operationKind === 'expire') { targetBinding.state = 'expired_unresolved_visible'; }
  if (operationKind === 'reopen') { targetBinding.state = 'open'; targetBinding.dismissReasonCode = null; targetBinding.snoozedUntil = null; targetBinding.dueBy = '2026-11-01T12:05:00.000000Z'; }
  if (operationKind === 'source_correct') {
    targetBinding.state = 'source_changed_stale';
    operationBinding.sourceCorrectionBinding = {correctionKind: 'same_lineage_exact_next_snapshot', lineageId: sourceAuthorityBinding.lineageId, predecessorSnapshotId: sourceAuthorityBinding.snapshotId, predecessorSnapshotDigest: sourceAuthorityBinding.snapshotDigest, predecessorSnapshotLineageSequence: sourceAuthorityBinding.snapshotLineageSequence, replacementSnapshotId: uuid(90), replacementSnapshotDigest: digest(90), replacementSnapshotLineageSequence: sourceAuthorityBinding.snapshotLineageSequence + 1, replacementHeadTransitionId: uuid(91), replacementHeadTransitionDigest: digest(91), replacementHeadSequence: sourceAuthorityBinding.headSequence + 1, replacementEffectiveSnapshotId: uuid(90), replacementEffectiveSnapshotDigest: digest(90), replacementCurrentnessState: 'latest_exact_current', successorQueueMaterialDigest: digest(92), successorRequired: true};
  }
  const input = {schemaVersion: contract.contractVersion, tenantId, lifecycleRequestId: uuid(2), queueItemBinding, sourceAuthorityBinding, policyEvaluationBinding, lifecycleHeadBinding, operationBinding, targetBinding, actorAuthorityBinding: {actorId: uuid(100), sessionId: uuid(101), membershipId: uuid(102), sessionSubjectActorId: uuid(100), membershipSubjectActorId: uuid(100), actorTenantId: tenantId, sessionTenantId: tenantId, membershipTenantId: tenantId, actorState: 'active', sessionState: 'active', membershipState: 'active', membershipRoleId: 'owner', capabilityState: 'unavailable_no_fixed_capability_assignment', capabilityId: null, capabilityDecisionId: null, capabilityDecisionDigest: null, recordScope: null}, assigneeTransitionBinding, timingBinding, evaluatedAt, materialDigest: '', idempotencyKeyDigest: '', requestDigest: ''};
  input.queueItemBinding.semanticFingerprintDigest = semanticFingerprint(input); input.operationBinding.semanticFingerprintDigest = input.queueItemBinding.semanticFingerprintDigest; input.lifecycleHeadBinding.semanticFingerprintDigest = root ? null : input.queueItemBinding.semanticFingerprintDigest; input.targetBinding.semanticFingerprintDigest = input.queueItemBinding.semanticFingerprintDigest;
  if (operationKind === 'group') input.targetBinding.groupKeyDigest = groupKey(input);
  input.targetBinding.eventDigest = operationKind === 'dedupe_coalesce' ? input.lifecycleHeadBinding.eventDigest : lifecycleEventDigest(input);
  seal(input);
  return {input, trusted: trustedOf(input)};
}

function validateEnvelope(input) {
  dataOnly(input);
  if (Buffer.byteLength(JSON.stringify(input)) > contract.bounds.maximumCanonicalRequestBytes) throw new Error('size');
  exactKeys(input, contract.envelope.exactFields);
  for (const [key, schema] of [['queueItemBinding','queueItemBindingExactFields'],['sourceAuthorityBinding','sourceAuthorityBindingExactFields'],['policyEvaluationBinding','policyEvaluationBindingExactFields'],['lifecycleHeadBinding','lifecycleHeadBindingExactFields'],['operationBinding','operationBindingExactFields'],['targetBinding','targetBindingExactFields'],['actorAuthorityBinding','actorAuthorityBindingExactFields'],['assigneeTransitionBinding','assigneeTransitionBindingExactFields'],['timingBinding','timingBindingExactFields']]) exactKeys(input[key], contract.envelope[schema]);
  exactKeys(input.operationBinding.sourceCorrectionBinding, contract.envelope.sourceCorrectionBindingExactFields);
  if (input.schemaVersion !== contract.contractVersion || !UUID.test(input.tenantId) || !UUID.test(input.lifecycleRequestId) || input.materialDigest !== hash(materialOf(input)) || input.requestDigest !== hash(materialOf(input)) || input.idempotencyKeyDigest !== hash(stableOf(input))) throw new Error('envelope');
}

function validate(input, trusted) {
  validateEnvelope(input); dataOnly(trusted); exactKeys(trusted, contract.envelope.trustedResolutionExactFields);
  if (trusted.tenantId !== input.tenantId || trusted.evaluatedAt !== input.evaluatedAt) throw new Error('trusted');
  for (const key of contract.envelope.trustedResolutionExactFields.filter(key => !['tenantId','evaluatedAt'].includes(key))) if (hash(trusted[key]) !== hash(input[key])) throw new Error('trusted');
  const queue = input.queueItemBinding; const source = input.sourceAuthorityBinding; const policy = input.policyEvaluationBinding; const head = input.lifecycleHeadBinding; const op = input.operationBinding; const target = input.targetBinding; const actor = input.actorAuthorityBinding; const assignment = input.assigneeTransitionBinding;
  for (const tenant of [queue.tenantId, source.tenantId, policy.tenantId, actor.actorTenantId, actor.sessionTenantId, actor.membershipTenantId, assignment.toTenantId]) if (tenant !== input.tenantId) throw new Error('tenant');
  for (const value of [queue.queueItemId, queue.originProjectionId, queue.originAssigneeActorId, queue.originAssigneeMembershipId, source.sourceRecordId, source.snapshotId, source.lineageId, source.predecessorSnapshotId, source.headTransitionId, source.effectiveSnapshotId, policy.policyId, policy.evaluationId, head.lifecycleId, op.operationId, target.lifecycleId, actor.actorId, actor.sessionId, actor.membershipId, assignment.toActorId, assignment.toMembershipId, assignment.assignmentDecisionId]) if (!UUID.test(value)) throw new Error('identity');
  for (const value of [queue.queueItemDigest, queue.originMaterialDigest, queue.originIdempotencyKeyDigest, queue.sourceLinkDigest, queue.semanticFingerprintDigest, source.sourceRecordDigest, source.snapshotDigest, source.predecessorSnapshotDigest, source.headTransitionDigest, source.effectiveSnapshotDigest, policy.policyDigest, policy.sourceSetDigest, policy.evaluationOutputDigest, op.semanticFingerprintDigest, target.semanticFingerprintDigest, assignment.assignmentDecisionDigest, input.materialDigest, input.idempotencyKeyDigest, input.requestDigest]) if (!DIGEST.test(value)) throw new Error('digest');
  if (!Number.isSafeInteger(queue.queueItemRevision) || queue.queueItemRevision < 1 || queue.completionState !== 'unavailable_no_accepted_completion_authority' || !micros(queue.originNotBefore) || !micros(queue.originDueBy) || micros(queue.originDueBy) <= micros(queue.originNotBefore) || micros(queue.originDueBy) - micros(queue.originNotBefore) > BigInt(contract.bounds.maximumDueWindowSeconds) * 1000000n) throw new Error('queue');
  const queueDefinition = queue.originContract === 'part12b_reviewed_handoff' ? part12B.queueKinds.find(item => item.id === queue.queueKind) : queue.originContract === 'part12a_action_queue' ? part12A.queueKinds.find(item => item.id === queue.queueKind) : null;
  const expectedReason = queue.originContract === 'part12b_reviewed_handoff' ? queueDefinition?.reasonCode : queueDefinition?.reasonCodes?.includes(queue.reasonCode) ? queue.reasonCode : null;
  const expectedPolicyResult = queue.actionFamily === 'owner_approval_request' ? 'approval_required' : 'eligible';
  const allowedAssigneeRoles = queue.originContract === 'part12b_reviewed_handoff' ? [queueDefinition?.assigneeRole] : queueDefinition?.assigneeRoles;
  if (!queueDefinition || queue.actionFamily !== queueDefinition.actionFamily || queue.reasonCode !== expectedReason || policy.result !== expectedPolicyResult || !allowedAssigneeRoles.includes(assignment.toRoleId) || queue.semanticFingerprintDigest !== semanticFingerprint(input) || op.semanticFingerprintDigest !== queue.semanticFingerprintDigest) throw new Error('queue material');
  if (queue.originContract === 'part12b_reviewed_handoff') {
    const handoff = part12B.supportedHandoffs.find(item => item.evidenceQuality === queue.evidenceQuality && item.trustStatus === queue.trustStatus && item.uncertaintyState === queue.uncertaintyState && item.horizonKind === queue.horizonKind && item.queueKinds.includes(queue.queueKind));
    if (!handoff || (handoff.horizonKind === 'historical_current_cohort' ? queue.horizonLocalStart !== null : !/^\d{4}-\d{2}-01$/.test(queue.horizonLocalStart))) throw new Error('handoff evidence');
  } else if (queue.evidenceQuality !== 'complete_exact_source' || queue.trustStatus !== 'source_fact_only_not_permission' || queue.uncertaintyState !== 'none_exact_current' || queue.horizonKind !== 'not_applicable' || queue.horizonLocalStart !== null) throw new Error('queue evidence');
  if (source.lineageKind !== 'active' || !['latest_exact_current','stale','corrected','replaced','tombstoned'].includes(source.currentnessState) || !Number.isSafeInteger(source.snapshotLineageSequence) || source.snapshotLineageSequence < 2 || !Number.isSafeInteger(source.headSequence) || source.headSequence < 1 || source.effectiveSnapshotId !== source.snapshotId || source.effectiveSnapshotDigest !== source.snapshotDigest || policy.sourceSetDigest !== hash({tenantId: input.tenantId, snapshotId: source.snapshotId, snapshotDigest: source.snapshotDigest}) || !Number.isSafeInteger(policy.policyVersion) || policy.policyVersion < 1 || !['eligible','approval_required'].includes(policy.result)) throw new Error('source policy');
  const operation = contract.operations.find(item => item.id === op.operationKind);
  if (!operation || !operation.from.includes(head.state)) throw new Error('operation');
  const evaluated = micros(input.evaluatedAt); const observed = micros(source.observedAt); const requested = micros(input.timingBinding.requestedAt); const effective = micros(input.timingBinding.effectiveAt);
  if (evaluated === null || observed === null || requested === null || effective === null || observed > evaluated || requested > evaluated || effective < requested || micros(policy.evaluatedAt) === null) throw new Error('time');
  if (operation.requiresCurrentSourcePolicy && (source.currentnessState !== 'latest_exact_current' || policy.evaluatedAt !== input.evaluatedAt || evaluated - observed > BigInt(contract.bounds.maximumSourceObservationAgeSeconds) * 1000000n)) throw new Error('currentness');
  if (!operation.requiresCurrentSourcePolicy && !['latest_exact_current','stale','corrected','replaced','tombstoned'].includes(source.currentnessState)) throw new Error('fail-safe currentness');
  if (actor.actorId !== actor.sessionSubjectActorId || actor.actorId !== actor.membershipSubjectActorId || actor.actorState !== 'active' || actor.sessionState !== 'active' || actor.membershipState !== 'active' || !['owner','admin'].includes(actor.membershipRoleId) || actor.capabilityState !== 'unavailable_no_fixed_capability_assignment' || [actor.capabilityId, actor.capabilityDecisionId, actor.capabilityDecisionDigest, actor.recordScope].some(value => value !== null)) throw new Error('actor');
  if (assignment.toActorId !== assignment.toMembershipSubjectActorId || assignment.toMembershipState !== 'active' || !['owner','member'].includes(assignment.toRoleId) || !['exact_tenant_all_automation','exact_assigned_internal_records_only'].includes(assignment.recordScope)) throw new Error('assignee');
  if (op.reasonCode !== `action_${op.operationKind}` || !Number.isSafeInteger(op.groupCandidateCount)) throw new Error('operation material');
  for (const value of [head, target]) {
    const hasGroup = value.groupId !== null || value.groupKeyDigest !== null;
    if (hasGroup && (!UUID.test(value.groupId) || !DIGEST.test(value.groupKeyDigest))) throw new Error('group binding');
    if (!contract.priorityOrder.includes(value.priority) && value.priority !== null) throw new Error('priority binding');
    if (!Number.isSafeInteger(value.escalationLevel) || value.escalationLevel < 0 || value.escalationLevel > contract.bounds.maximumEscalationLevel) throw new Error('escalation binding');
  }
  if (target.lifecycleId !== head.lifecycleId || target.unresolvedConsequenceState !== 'unresolved_visible' || target.completionState !== 'unavailable_no_accepted_completion_authority' || target.semanticFingerprintDigest !== queue.semanticFingerprintDigest || micros(target.dueBy) === null) throw new Error('target common');
  const root = op.operationKind === 'assign';
  if (root) {
    if (head.revision !== 0 || head.state !== 'unregistered' || [head.eventId,head.eventDigest,head.semanticFingerprintDigest,head.assigneeActorId,head.assigneeMembershipId,head.dueBy,head.sourceSnapshotId,head.policyId].some(value => value !== null) || target.revision !== 1 || target.state !== 'open' || target.priority !== queueDefinition.priorities[0] || target.assigneeActorId !== queue.originAssigneeActorId || target.assigneeMembershipId !== queue.originAssigneeMembershipId || assignment.fromActorId !== null || assignment.fromMembershipId !== null) throw new Error('assign root');
  } else {
    for (const value of [head.eventId, head.eventDigest, head.semanticFingerprintDigest, head.assigneeActorId, head.assigneeMembershipId, head.dueBy, head.sourceSnapshotId, head.sourceSnapshotDigest, head.sourceHeadTransitionId, head.sourceHeadTransitionDigest, head.policyId, head.policyDigest]) if (value === null) throw new Error('head');
    for (const value of [head.eventId, head.assigneeActorId, head.assigneeMembershipId]) if (!UUID.test(value)) throw new Error('head identity');
    for (const value of [head.eventDigest, head.semanticFingerprintDigest, head.sourceSnapshotDigest, head.sourceHeadTransitionDigest, head.policyDigest]) if (!DIGEST.test(value)) throw new Error('head digest');
    if (!Number.isSafeInteger(head.revision) || head.revision < 1 || !Number.isSafeInteger(head.sourceHeadSequence) || micros(head.dueBy) === null || head.sourceSnapshotId !== source.snapshotId || head.sourceSnapshotDigest !== source.snapshotDigest || head.sourceHeadTransitionId !== source.headTransitionId || head.sourceHeadTransitionDigest !== source.headTransitionDigest || head.sourceHeadSequence !== source.headSequence || head.policyId !== policy.policyId || head.policyVersion !== policy.policyVersion || head.policyDigest !== policy.policyDigest || head.semanticFingerprintDigest !== queue.semanticFingerprintDigest) throw new Error('head binding');
    if (assignment.fromActorId !== head.assigneeActorId || assignment.fromMembershipId !== head.assigneeMembershipId) throw new Error('assignment predecessor');
  }
  if (target.sourceSnapshotId !== source.snapshotId || target.sourceSnapshotDigest !== source.snapshotDigest || target.sourceHeadTransitionId !== source.headTransitionId || target.sourceHeadTransitionDigest !== source.headTransitionDigest || target.sourceHeadSequence !== source.headSequence || target.policyId !== policy.policyId || target.policyVersion !== policy.policyVersion || target.policyDigest !== policy.policyDigest) throw new Error('target authority');
  if (operation.advancesRevision) {
    if (target.revision !== head.revision + 1 || !UUID.test(target.eventId) || target.eventDigest !== lifecycleEventDigest(input)) throw new Error('revision');
  } else if (hash(target) !== hash(head)) throw new Error('coalesce head');
  if (operation.to !== 'same' && target.state !== operation.to) throw new Error('state');
  if (operation.to === 'same' && target.state !== head.state) throw new Error('same state');
  const correction = op.sourceCorrectionBinding;
  if (op.operationKind !== 'source_correct' && Object.values(correction).some(value => value !== null)) throw new Error('unexpected correction');
  if (op.operationKind === 'dedupe_coalesce' && (op.groupCandidateCount !== 1 || target.eventId !== head.eventId)) throw new Error('dedupe');
  if (op.operationKind === 'group') {
    if (!UUID.test(target.groupId) || target.groupKeyDigest !== groupKey(input) || op.groupCandidateCount < 2 || op.groupCandidateCount > contract.bounds.maximumGroupSize) throw new Error('group');
  }
  if (op.operationKind !== 'group' && op.groupCandidateCount !== 1) throw new Error('group count');
  if (op.operationKind === 'set_priority' && (target.priority === head.priority || !contract.priorityOrder.includes(target.priority))) throw new Error('priority');
  if (op.operationKind === 'snooze') {
    const until = micros(target.snoozedUntil); if (until === null || until <= evaluated || until - evaluated > BigInt(contract.bounds.maximumSnoozeSeconds) * 1000000n || input.timingBinding.expiresAt !== target.snoozedUntil) throw new Error('snooze');
  }
  if (op.operationKind === 'dismiss' && target.dismissReasonCode !== 'owner_dismissed_pending_recheck') throw new Error('dismiss');
  if (op.operationKind === 'reassign' && (target.assigneeActorId !== assignment.toActorId || target.assigneeMembershipId !== assignment.toMembershipId || target.assigneeActorId === head.assigneeActorId)) throw new Error('reassign');
  if (!['assign','reassign'].includes(op.operationKind) && (assignment.toActorId !== head.assigneeActorId || assignment.toMembershipId !== head.assigneeMembershipId || target.assigneeActorId !== head.assigneeActorId || target.assigneeMembershipId !== head.assigneeMembershipId)) throw new Error('assignee change');
  if (op.operationKind === 'assign' && (assignment.toActorId !== queue.originAssigneeActorId || assignment.toMembershipId !== queue.originAssigneeMembershipId)) throw new Error('assign target');
  if (op.operationKind === 'escalate') {
    const fromIndex = contract.priorityOrder.indexOf(head.priority); if (target.escalationLevel !== head.escalationLevel + 1 || target.escalationLevel > contract.bounds.maximumEscalationLevel || contract.priorityOrder.indexOf(target.priority) !== fromIndex + 1) throw new Error('escalate');
  }
  if (op.operationKind === 'expire' && (effective < micros(head.dueBy) || target.state !== 'expired_unresolved_visible')) throw new Error('expire');
  if (op.operationKind === 'reopen' && (target.state !== 'open' || target.dismissReasonCode !== null || target.snoozedUntil !== null || micros(target.dueBy) <= evaluated || micros(target.dueBy) - evaluated > BigInt(contract.bounds.maximumDueWindowSeconds) * 1000000n)) throw new Error('reopen');
  if (op.operationKind === 'source_correct') {
    for (const value of [correction.lineageId, correction.predecessorSnapshotId, correction.replacementSnapshotId, correction.replacementHeadTransitionId, correction.replacementEffectiveSnapshotId]) if (!UUID.test(value)) throw new Error('correction identity');
    for (const value of [correction.predecessorSnapshotDigest, correction.replacementSnapshotDigest, correction.replacementHeadTransitionDigest, correction.replacementEffectiveSnapshotDigest, correction.successorQueueMaterialDigest]) if (!DIGEST.test(value)) throw new Error('correction digest');
    if (correction.correctionKind !== 'same_lineage_exact_next_snapshot' || correction.lineageId !== source.lineageId || correction.predecessorSnapshotId !== source.snapshotId || correction.predecessorSnapshotDigest !== source.snapshotDigest || correction.predecessorSnapshotLineageSequence !== source.snapshotLineageSequence || correction.replacementSnapshotId === source.snapshotId || correction.replacementSnapshotDigest === source.snapshotDigest || correction.replacementSnapshotLineageSequence !== source.snapshotLineageSequence + 1 || correction.replacementHeadTransitionId === source.headTransitionId || correction.replacementHeadTransitionDigest === source.headTransitionDigest || correction.replacementHeadSequence !== source.headSequence + 1 || correction.replacementEffectiveSnapshotId !== correction.replacementSnapshotId || correction.replacementEffectiveSnapshotDigest !== correction.replacementSnapshotDigest || correction.replacementCurrentnessState !== 'latest_exact_current' || correction.successorRequired !== true || !DIGEST.test(correction.successorQueueMaterialDigest) || correction.successorQueueMaterialDigest === queue.originMaterialDigest) throw new Error('correction');
  }
  if (op.operationKind !== 'snooze' && input.timingBinding.expiresAt !== null) throw new Error('unexpected expiry');
  if (operation.advancesRevision) {
    const expected = copy(head);
    Object.assign(expected, {revision: head.revision + 1, eventId: target.eventId, eventDigest: target.eventDigest, semanticFingerprintDigest: queue.semanticFingerprintDigest});
    if (root) Object.assign(expected, {state: 'open', groupId: null, groupKeyDigest: null, priority: queueDefinition.priorities[0], assigneeActorId: queue.originAssigneeActorId, assigneeMembershipId: queue.originAssigneeMembershipId, dueBy: queue.originDueBy, snoozedUntil: null, dismissReasonCode: null, escalationLevel: 0, sourceSnapshotId: source.snapshotId, sourceSnapshotDigest: source.snapshotDigest, sourceHeadTransitionId: source.headTransitionId, sourceHeadTransitionDigest: source.headTransitionDigest, sourceHeadSequence: source.headSequence, policyId: policy.policyId, policyVersion: policy.policyVersion, policyDigest: policy.policyDigest});
    if (op.operationKind === 'group') Object.assign(expected, {groupId: target.groupId, groupKeyDigest: target.groupKeyDigest});
    if (op.operationKind === 'set_priority') expected.priority = target.priority;
    if (op.operationKind === 'snooze') Object.assign(expected, {state: 'snoozed', snoozedUntil: target.snoozedUntil});
    if (op.operationKind === 'dismiss') Object.assign(expected, {state: 'dismissed_unresolved_visible', dismissReasonCode: target.dismissReasonCode});
    if (op.operationKind === 'reassign') Object.assign(expected, {assigneeActorId: target.assigneeActorId, assigneeMembershipId: target.assigneeMembershipId});
    if (op.operationKind === 'escalate') Object.assign(expected, {state: 'escalated', priority: target.priority, escalationLevel: target.escalationLevel});
    if (op.operationKind === 'expire') expected.state = 'expired_unresolved_visible';
    if (op.operationKind === 'reopen') Object.assign(expected, {state: 'open', dueBy: target.dueBy, snoozedUntil: null, dismissReasonCode: null});
    if (op.operationKind === 'source_correct') expected.state = 'source_changed_stale';
    if (hash(expected) !== hash(target)) throw new Error('operation field drift');
  }
  return true;
}

function project(input, trusted) {
  validate(input, trusted);
  return Object.freeze({lifecycleRequestId: input.lifecycleRequestId, tenantId: input.tenantId, queueItemId: input.queueItemBinding.queueItemId, lifecycleId: input.lifecycleHeadBinding.lifecycleId, operationKind: input.operationBinding.operationKind, currentState: input.lifecycleHeadBinding.state, targetState: input.targetBinding.state, sourceSnapshotId: input.sourceAuthorityBinding.snapshotId, sourceSnapshotDigest: input.sourceAuthorityBinding.snapshotDigest, policyId: input.policyEvaluationBinding.policyId, policyVersion: input.policyEvaluationBinding.policyVersion, policyDigest: input.policyEvaluationBinding.policyDigest, assigneeActorId: input.targetBinding.assigneeActorId, priority: input.targetBinding.priority, groupId: input.targetBinding.groupId, evidenceQuality: input.queueItemBinding.evidenceQuality, trustStatus: input.queueItemBinding.trustStatus, uncertaintyState: input.queueItemBinding.uncertaintyState, horizonKind: input.queueItemBinding.horizonKind, horizonLocalStart: input.queueItemBinding.horizonLocalStart, unresolvedConsequenceState: input.targetBinding.unresolvedConsequenceState, completionState: input.targetBinding.completionState, evaluatedAt: input.evaluatedAt, resultState: contract.fixedDecision.resultState, reasonState: contract.fixedDecision.reasonState, labelId: contract.fixedDecision.labelId, fixedLabel: contract.fixedDecision.fixedLabel, ownerReadableNoEffectOnly: true, lifecycleEventCreated: false, queueItemCreated: false, queueItemHidden: false, completionEvidenceCreated: false, messageCreated: false, providerAttemptCreated: false, externalEffectCreated: false, upstreamMutationCreated: false, financialEffectCreated: false, moneyEffectCreated: false});
}

class History {
  constructor() { this.byRequest = new Map(); this.byStable = new Map(); }
  record(input, trusted) {
    validateEnvelope(input); dataOnly(trusted); exactKeys(trusted, contract.envelope.trustedResolutionExactFields); const prior = this.byRequest.get(input.lifecycleRequestId);
    if (prior) { if (prior.requestDigest !== input.requestDigest || prior.materialDigest !== input.materialDigest || prior.idempotencyKeyDigest !== input.idempotencyKeyDigest) throw new Error('identity conflict'); return {...prior, replayed: true}; }
    const output = project(input, trusted);
    if (this.byStable.has(input.idempotencyKeyDigest)) throw new Error('semantic clone');
    const stored = Object.freeze({...output, requestDigest: input.requestDigest, materialDigest: input.materialDigest, idempotencyKeyDigest: input.idempotencyKeyDigest, replayed: false}); this.byRequest.set(input.lifecycleRequestId, stored); this.byStable.set(input.idempotencyKeyDigest, input.lifecycleRequestId); return stored;
  }
}

function rejectCoherent(operation, mutate) {
  const pair = fixture(operation); mutate(pair.input); pair.input.queueItemBinding.semanticFingerprintDigest = semanticFingerprint(pair.input); pair.input.operationBinding.semanticFingerprintDigest = pair.input.queueItemBinding.semanticFingerprintDigest; if (operation !== 'dedupe_coalesce') { if (pair.input.lifecycleHeadBinding.state !== 'unregistered') pair.input.lifecycleHeadBinding.semanticFingerprintDigest = pair.input.queueItemBinding.semanticFingerprintDigest; pair.input.targetBinding.semanticFingerprintDigest = pair.input.queueItemBinding.semanticFingerprintDigest; } if (operation !== 'dedupe_coalesce') pair.input.targetBinding.eventDigest = lifecycleEventDigest(pair.input); seal(pair.input); pair.trusted = trustedOf(pair.input); expect(() => project(pair.input, pair.trusted)).toThrow();
}

describe('Mission 28 Part 12C action queue lifecycle contract', () => {
  test('binds exact Part12B release evidence and all frozen inputs', () => {
    expect(contract.authority).toMatchObject({part: '12C', state: 'implementation_candidate_only', baselineCommit: '17e732513aeae591ebceeb6832294c0ea4a2f5b4', baselineTree: 'd66dd55993c9ba39dda64768c475d6cb5c660266'});
    expect(contract.part12BRelease).toMatchObject({acceptedSourceHead: '72e33ce1f9a80e0ecde92bb7b93fdc5a8a518d02', acceptedTree: 'd66dd55993c9ba39dda64768c475d6cb5c660266', pullRequest: 600, mergedMain: '17e732513aeae591ebceeb6832294c0ea4a2f5b4', productionAccepted: true, freshAudit: {verdict: 'P0=0_P1=0_P2=0_P3=0', nodeVersion: '22.23.3', focusedTests: '17/17', parts11ATo12B: '8_suites_122_tests', cumulativeMission28: '52_suites_724_tests', migrationHistory: '2_suites_40_tests', syntax: '52/52', json: '51/51', migrations: '283_through_287_no_288', changedPaths: '56_docs_tests_only', protectedPaths: 0}, release: {deploymentId: '8bdf94ab-8ae7-46e1-8e76-2f2d619280ef', deploymentStatus: 'SUCCESS', serviceInstanceId: '7ee4f747-38c2-4baa-a024-1d7db6e7c218', deploymentInstanceId: 'a825b82c-ed48-4938-9f4d-2d13195713a2', deploymentInstanceStatus: 'RUNNING', imageSha256: 'sha256:8b3bbcde9feeb50b1fb42c0ea34d44e782c72b14ad639e897135642c3a5d23de', canonicalStartup: 'ready'}, directAppliedProductionMigrationHistory: 'unavailable_and_unclaimed'});
    for (const item of contract.frozenInputs) expect(digestLf(item.path)).toBe(item.normalizedLfSha256);
    expect(part3A.capabilities.map(item => item.id)).not.toContain('automation_internal_action_manage');
    const actor = fixture().input.actorAuthorityBinding; expect(actor).toMatchObject({capabilityState: 'unavailable_no_fixed_capability_assignment', capabilityId: null, capabilityDecisionId: null, capabilityDecisionDigest: null, recordScope: null});
  });

  test.each(contract.operations.map(item => item.id))('validates %s only as fixed unavailable no-effect evidence', operation => {
    const pair = fixture(operation); const output = project(pair.input, pair.trusted);
    expect(output).toMatchObject({operationKind: operation, resultState: contract.fixedDecision.resultState, unresolvedConsequenceState: 'unresolved_visible', completionState: 'unavailable_no_accepted_completion_authority', ownerReadableNoEffectOnly: true, lifecycleEventCreated: false, queueItemCreated: false, queueItemHidden: false, completionEvidenceCreated: false, messageCreated: false, providerAttemptCreated: false, externalEffectCreated: false, upstreamMutationCreated: false, financialEffectCreated: false, moneyEffectCreated: false});
  });

  test('binds initial assignment to the exact Part12 origin assignee and current authority', () => {
    for (const queue of part12A.queueKinds) expect(() => project(...Object.values(fixture('assign', 'part12a_action_queue', queue.id)))).not.toThrow();
    for (const queue of part12B.queueKinds) expect(() => project(...Object.values(fixture('assign', 'part12b_reviewed_handoff', queue.id)))).not.toThrow();
    for (const mutation of [v => { v.lifecycleHeadBinding.revision = 1; }, v => { v.lifecycleHeadBinding.eventId = uuid(99); }, v => { v.targetBinding.revision = 2; }, v => { v.queueItemBinding.reasonCode = 'different_reason'; }, v => { v.policyEvaluationBinding.result = 'approval_required'; }, v => { v.assigneeTransitionBinding.toRoleId = 'member'; }, v => { v.assigneeTransitionBinding.fromActorId = uuid(99); }, v => { v.assigneeTransitionBinding.toActorId = uuid(99); }, v => { v.targetBinding.assigneeActorId = uuid(99); }, v => { v.actorAuthorityBinding.sessionSubjectActorId = uuid(99); }, v => { v.actorAuthorityBinding.capabilityId = 'automation_view'; }]) rejectCoherent('assign', mutation);
  });

  test('deduplicates only the exact semantic fingerprint and never hides unresolved consequential work', () => {
    const pair = fixture('dedupe_coalesce'); const output = project(pair.input, pair.trusted); expect(output.queueItemHidden).toBe(false); expect(output.currentState).toBe(output.targetState);
    for (const mutation of [v => { v.sourceAuthorityBinding.sourceRecordId = uuid(99); }, v => { v.sourceAuthorityBinding.snapshotDigest = digest(99); }, v => { v.policyEvaluationBinding.policyId = uuid(99); }, v => { v.queueItemBinding.horizonKind = 'calendar_month'; }, v => { v.queueItemBinding.uncertaintyState = 'unquantified_visible'; }, v => { v.queueItemBinding.originAssigneeActorId = uuid(99); }, v => { v.queueItemBinding.reasonCode = 'different_reason'; }]) rejectCoherent('dedupe_coalesce', mutation);
  });

  test('groups bounded related work while preserving each item lifecycle source and unresolved identity', () => {
    const first = fixture('group'); const second = fixture('group'); second.input.lifecycleRequestId = uuid(200); second.input.queueItemBinding.queueItemId = uuid(201); second.input.lifecycleHeadBinding.lifecycleId = uuid(202); second.input.targetBinding.lifecycleId = uuid(202); second.input.targetBinding.groupId = first.input.targetBinding.groupId; second.input.queueItemBinding.queueItemDigest = digest(201); second.input.queueItemBinding.semanticFingerprintDigest = semanticFingerprint(second.input); second.input.operationBinding.semanticFingerprintDigest = second.input.queueItemBinding.semanticFingerprintDigest; second.input.lifecycleHeadBinding.semanticFingerprintDigest = second.input.queueItemBinding.semanticFingerprintDigest; second.input.targetBinding.semanticFingerprintDigest = second.input.queueItemBinding.semanticFingerprintDigest; second.input.targetBinding.groupKeyDigest = groupKey(second.input); second.input.targetBinding.eventDigest = lifecycleEventDigest(second.input); seal(second.input); second.trusted = trustedOf(second.input);
    const outputs = [project(first.input, first.trusted), project(second.input, second.trusted)]; expect(new Set(outputs.map(item => item.queueItemId)).size).toBe(2); expect(new Set(outputs.map(item => item.lifecycleId)).size).toBe(2); expect(outputs.every(item => item.groupId === first.input.targetBinding.groupId && item.unresolvedConsequenceState === 'unresolved_visible' && item.queueItemHidden === false)).toBe(true);
    for (const mutation of [v => { v.operationBinding.groupCandidateCount = 1; }, v => { v.operationBinding.groupCandidateCount = 2.5; }, v => { v.operationBinding.groupCandidateCount = 33; }, v => { v.targetBinding.groupKeyDigest = digest(99); }, v => { v.targetBinding.groupId = null; }]) rejectCoherent('group', mutation);
  });

  test('enforces closed priority and one-step escalation without creating recipient legal or financial authority', () => {
    expect(project(...Object.values(fixture('escalate')))).toMatchObject({priority: 'high', targetState: 'escalated', externalEffectCreated: false, financialEffectCreated: false, moneyEffectCreated: false});
    for (const mutation of [v => { v.targetBinding.priority = 'urgent'; }, v => { v.targetBinding.escalationLevel = 2; }, v => { v.targetBinding.priority = 'legal'; }]) rejectCoherent('escalate', mutation);
    for (const mutation of [v => { v.targetBinding.priority = v.lifecycleHeadBinding.priority; }, v => { v.targetBinding.priority = 'critical'; }]) rejectCoherent('set_priority', mutation);
  });

  test('keeps snooze dismiss and expiry finite unresolved visible and never completed', () => {
    for (const operation of ['snooze','dismiss','expire']) { const output = project(...Object.values(fixture(operation))); expect(output.unresolvedConsequenceState).toBe('unresolved_visible'); expect(output.completionState).toBe('unavailable_no_accepted_completion_authority'); expect(output.queueItemHidden).toBe(false); }
    for (const mutation of [v => { v.targetBinding.snoozedUntil = v.evaluatedAt; v.timingBinding.expiresAt = v.evaluatedAt; }, v => { v.targetBinding.snoozedUntil = '2026-11-30T12:05:00.000000Z'; v.timingBinding.expiresAt = v.targetBinding.snoozedUntil; }, v => { v.targetBinding.completionState = 'completed'; }]) rejectCoherent('snooze', mutation);
    rejectCoherent('dismiss', v => { v.targetBinding.dismissReasonCode = 'customer@example.test'; }); rejectCoherent('expire', v => { v.timingBinding.effectiveAt = '2026-10-29T12:05:00.000000Z'; });
  });

  test('requires exact same-tenant assignee transition identities and scope', () => {
    expect(project(...Object.values(fixture('reassign'))).assigneeActorId).toBe(uuid(80));
    for (const mutation of [v => { v.assigneeTransitionBinding.toTenantId = uuid(99); }, v => { v.assigneeTransitionBinding.toMembershipSubjectActorId = uuid(99); }, v => { v.assigneeTransitionBinding.toMembershipState = 'inactive'; }, v => { v.assigneeTransitionBinding.recordScope = 'all'; }, v => { v.assigneeTransitionBinding.fromActorId = uuid(99); }, v => { v.targetBinding.assigneeActorId = v.lifecycleHeadBinding.assigneeActorId; }]) rejectCoherent('reassign', mutation);
  });

  test('reopens only append-only from an unresolved state under exact-current source and policy', () => {
    expect(project(...Object.values(fixture('reopen')))).toMatchObject({currentState: 'dismissed_unresolved_visible', targetState: 'open'});
    for (const mutation of [v => { v.sourceAuthorityBinding.currentnessState = 'stale'; }, v => { v.policyEvaluationBinding.evaluatedAt = '2026-10-29T12:04:00.000000Z'; }, v => { v.targetBinding.revision += 1; }, v => { v.targetBinding.dueBy = v.evaluatedAt; }]) rejectCoherent('reopen', mutation);
  });

  test('source correction preserves old history and binds exact next same-lineage snapshot and head', () => {
    const pair = fixture('source_correct'); const before = copy(pair.input.lifecycleHeadBinding); const output = project(pair.input, pair.trusted); expect(output.targetState).toBe('source_changed_stale'); expect(pair.input.lifecycleHeadBinding).toEqual(before); expect(output.unresolvedConsequenceState).toBe('unresolved_visible');
    for (const mutation of [v => { v.operationBinding.sourceCorrectionBinding.lineageId = uuid(99); }, v => { v.operationBinding.sourceCorrectionBinding.predecessorSnapshotId = uuid(99); }, v => { v.operationBinding.sourceCorrectionBinding.replacementSnapshotLineageSequence += 1; }, v => { v.operationBinding.sourceCorrectionBinding.replacementHeadTransitionId = v.sourceAuthorityBinding.headTransitionId; }, v => { v.operationBinding.sourceCorrectionBinding.replacementHeadTransitionDigest = v.sourceAuthorityBinding.headTransitionDigest; }, v => { v.operationBinding.sourceCorrectionBinding.replacementHeadSequence = v.sourceAuthorityBinding.headSequence; }, v => { v.operationBinding.sourceCorrectionBinding.replacementSnapshotId = v.sourceAuthorityBinding.snapshotId; }, v => { v.operationBinding.sourceCorrectionBinding.replacementEffectiveSnapshotId = uuid(99); }, v => { v.operationBinding.sourceCorrectionBinding.replacementEffectiveSnapshotDigest = digest(99); }, v => { v.operationBinding.sourceCorrectionBinding.successorRequired = false; }, v => { v.operationBinding.sourceCorrectionBinding.successorQueueMaterialDigest = v.queueItemBinding.originMaterialDigest; }]) rejectCoherent('source_correct', mutation);
  });

  test('fails closed on stale mixed non-head cross-tenant cross-policy and reordered material', () => {
    for (const mutation of [v => { v.sourceAuthorityBinding.currentnessState = 'mixed'; }, v => { v.sourceAuthorityBinding.observedAt = '2026-10-29T12:05:00.000001Z'; }, v => { v.sourceAuthorityBinding.effectiveSnapshotId = uuid(99); }, v => { v.sourceAuthorityBinding.headTransitionDigest = digest(99); }, v => { v.sourceAuthorityBinding.tenantId = uuid(99); }, v => { v.policyEvaluationBinding.policyVersion += 1; }, v => { v.lifecycleHeadBinding.sourceHeadSequence += 1; }, v => { v.lifecycleHeadBinding.policyId = uuid(99); }, v => { v.targetBinding.revision += 1; }]) rejectCoherent('set_priority', mutation);
    expect(part4D.coalescingAndPrecedence.orderedRules).toContain('eventTime_or_observedAt_never_overrides_lineage_sequence_predecessor_or_separately_trusted_operation'); expect(part5B.resolutionStates.source).toContain('mixed');
  });

  test('preserves Part12A and Part12B evidence quality uncertainty horizon source and completion boundaries', () => {
    const output = project(...Object.values(fixture('set_priority'))); expect(output).toMatchObject({evidenceQuality: 'complete_exact_reviewed_cohort', trustStatus: 'reviewed_advisory_only', uncertaintyState: 'descriptive_sample_not_prediction', horizonKind: 'historical_current_cohort', horizonLocalStart: null, completionState: 'unavailable_no_accepted_completion_authority'});
    for (const mutation of [v => { v.queueItemBinding.evidenceQuality = 'partial'; }, v => { v.queueItemBinding.trustStatus = 'fact'; }, v => { v.queueItemBinding.uncertaintyState = 'certain'; }, v => { v.queueItemBinding.horizonKind = 'unknown'; }, v => { v.queueItemBinding.sourceLinkDigest = 'customer@example.test'; }]) rejectCoherent('set_priority', mutation);
  });

  test('rejects malformed hostile data before identity digest dedupe or grouping lookup', () => {
    for (const mutation of [v => { v.extra = true; }, v => { delete v.schemaVersion; }, v => { v.operationBinding.operationKind = null; }, v => { v.targetBinding.extra = true; }, v => { v.operationBinding.sourceCorrectionBinding.extra = true; }]) rejectCoherent('group', mutation);
    const getter = fixture('group'); let reads = 0; Object.defineProperty(getter.input.queueItemBinding, 'queueItemDigest', {enumerable: true, get() { reads += 1; return digest(10); }}); expect(() => project(getter.input, getter.trusted)).toThrow(); expect(reads).toBe(0);
    for (const hostile of [new Proxy(fixture().input, {}), Object.assign(Object.create({polluted: true}), fixture().input), Object.assign(fixture().input, {toJSON() { return {}; }}), Object.assign(fixture().input, {[Symbol('secret')]: true})]) expect(() => project(hostile, fixture().trusted)).toThrow();
    const sparse = fixture(); sparse.input.operationBinding = Object.assign(Array(3), sparse.input.operationBinding); expect(() => project(sparse.input, sparse.trusted)).toThrow();
  });

  test('provides exact replay and denies identity conflict and semantic clone reuse', () => {
    const history = new History(); const pair = fixture('set_priority'); expect(history.record(pair.input, pair.trusted).replayed).toBe(false); expect(history.record(copy(pair.input), copy(pair.trusted)).replayed).toBe(true);
    const conflict = copy(pair.input); conflict.targetBinding.priority = 'urgent'; conflict.targetBinding.eventDigest = lifecycleEventDigest(conflict); seal(conflict); expect(() => history.record(conflict, trustedOf(conflict))).toThrow('identity conflict');
    const clockClone = copy(pair.input); clockClone.lifecycleRequestId = uuid(999); clockClone.evaluatedAt = '2026-10-29T12:05:01.000000Z'; clockClone.timingBinding.requestedAt = clockClone.evaluatedAt; clockClone.timingBinding.effectiveAt = clockClone.evaluatedAt; clockClone.policyEvaluationBinding.evaluatedAt = clockClone.evaluatedAt; clockClone.sourceAuthorityBinding.observedAt = '2026-10-29T12:04:01.000000Z'; clockClone.targetBinding.eventDigest = lifecycleEventDigest(clockClone); seal(clockClone); expect(clockClone.idempotencyKeyDigest).toBe(pair.input.idempotencyKeyDigest); expect(() => history.record(clockClone, trustedOf(clockClone))).toThrow('semantic clone');
    const identityClone = copy(pair.input); identityClone.lifecycleRequestId = uuid(998); identityClone.operationBinding.operationId = uuid(997); identityClone.lifecycleHeadBinding.lifecycleId = uuid(996); identityClone.targetBinding.lifecycleId = uuid(996); identityClone.targetBinding.eventId = uuid(995); identityClone.targetBinding.eventDigest = lifecycleEventDigest(identityClone); seal(identityClone); expect(identityClone.idempotencyKeyDigest).toBe(pair.input.idempotencyKeyDigest); expect(() => history.record(identityClone, trustedOf(identityClone))).toThrow('semantic clone');
    const laterStaleResolution = copy(pair.trusted); laterStaleResolution.sourceAuthorityBinding.currentnessState = 'stale'; expect(history.record(copy(pair.input), laterStaleResolution).replayed).toBe(true);
    const malformedReplay = copy(pair.input); malformedReplay.extra = true; expect(() => history.record(malformedReplay, pair.trusted)).toThrow();
  });

  test('keeps all lifecycle persistence completion provider and effect claims at zero', () => {
    const output = project(...Object.values(fixture('source_correct'))); expect(Object.entries(output).filter(([key]) => /(Created|Hidden)$/.test(key)).every(([, value]) => value === false)).toBe(true);
    expect(contract.runtimeBoundary).toMatchObject({newMigration: false, newTableFunctionRouteWorkerQueueSchedulerOrUi: false, mountedLifecycleResolverOrPersistence: false, acceptedCompletionAuthority: false, lifecycleEventsCreated: 0, queueItemsCreated: 0, queueItemsHidden: 0, messagesCreated: 0, providerAttemptsCreated: 0, externalEffectsCreated: 0, upstreamMutationsCreated: 0, financialEffectsCreated: 0, moneyEffectsCreated: 0, latestMigration: '287_canonical_automation_estimate_quote_resolution_v1.sql', nextMigrationAbsent: '288'});
  });

  test('reconciles roadmap and ledger to Part12C released and Part12D sole candidate', () => {
    const roadmap = fs.readFileSync(path.join(ROOT, 'docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md'), 'utf8'); const ledger = fs.readFileSync(path.join(ROOT, 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md'), 'utf8');
    for (const value of [roadmap, ledger]) { expect(value).toContain('Parts 1A–13B are released. Part 13C is the sole implementation candidate.'); expect(value).toContain('Parts 13D–14G remain planned and unimplemented.'); for (const identity of ['72e33ce1f9a80e0ecde92bb7b93fdc5a8a518d02','d66dd55993c9ba39dda64768c475d6cb5c660266','17e732513aeae591ebceeb6832294c0ea4a2f5b4','8bdf94ab-8ae7-46e1-8e76-2f2d619280ef','7ee4f747-38c2-4baa-a024-1d7db6e7c218','a825b82c-ed48-4938-9f4d-2d13195713a2','sha256:8b3bbcde9feeb50b1fb42c0ea34d44e782c72b14ad639e897135642c3a5d23de','b42145ddc95e9bc2a383f9dac6ad1f5a884a90d5a3e999a0c126b2b6e3bae369']) expect(value).toContain(identity); expect(value).toMatch(/direct applied production migration history.*unavailable.*unclaimed/i); }
    expect((ledger.match(/\| \*\*Released\*\* \|/g) || []).length).toBe(56); expect((ledger.match(/\| \*\*Implementation candidate\*\* \|/g) || []).length).toBe(1); expect((ledger.match(/\| Planned \/ unimplemented \|/g) || []).length).toBe(9);
    expect(ledger).toContain('| 52 | 12B | Reviewed Mission 25/26 attention-item handoffs | **Released** |'); expect(ledger).toContain('| 53 | 12C | Internal-action dedupe, grouping, priority and correction | **Released** |');
  });
});
