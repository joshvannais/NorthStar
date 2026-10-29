const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { types } = require('util');

const ROOT = path.resolve(__dirname, '../..');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
const contract = readJson('docs/architecture/MISSION_28_PART12B_REVIEWED_ATTENTION_HANDOFF_CONTRACT.json');
const part12A = readJson('docs/architecture/MISSION_28_PART12A_TENANT_PRIVATE_ACTION_QUEUE_CONTRACT.json');
const launch = readJson('docs/architecture/MISSION_28_PART1D_FIRST_LAUNCH_MATRIX.json');
const capabilities = readJson('docs/architecture/MISSION_28_PART3A_FIXED_CAPABILITY_MATRIX.json');
const triggers = readJson('docs/architecture/MISSION_28_PART4A_CLOSED_TRIGGER_CATALOG.json');
const evaluationContract = readJson('docs/architecture/MISSION_28_PART5B_DETERMINISTIC_EVALUATOR_CONTRACT.json');
const UUID = new RegExp(contract.identityGrammar.uuidPattern);
const DIGEST = new RegExp(contract.identityGrammar.digestPattern);
const UTC = new RegExp(contract.identityGrammar.utcInstantPattern);
const SERVICE = new RegExp(contract.identityGrammar.serviceKeyPattern);
const MONTH = new RegExp(contract.identityGrammar.monthPattern);
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
function stableOf(input) { const value = materialOf(input); delete value.attentionProjectionId; delete value.evaluatedAt; return value; }
function requestOf(input) { return materialOf(input); }
function seal(input) { input.materialDigest = hash(materialOf(input)); input.idempotencyKeyDigest = hash(stableOf(input)); input.requestDigest = hash(requestOf(input)); return input; }
function trustedOf(input) { return copy({tenantId: input.tenantId, queueKind: input.queueKind, sourceBinding: input.sourceBinding, advisoryEvidence: input.advisoryEvidence, reviewedHandoffBinding: input.reviewedHandoffBinding, policyEvaluationBinding: input.policyEvaluationBinding, creatorAuthorityBinding: input.creatorAuthorityBinding, assigneeBinding: input.assigneeBinding, dueWindow: input.dueWindow, reasonCode: input.reasonCode, priority: input.priority, sourceLink: input.sourceLink, completionEvidence: input.completionEvidence, evaluatedAt: input.evaluatedAt}); }
function sourceSetDigest(input) { return hash({sourceBinding: input.sourceBinding, advisoryEvidence: input.advisoryEvidence, reviewedHandoffBinding: input.reviewedHandoffBinding}); }

function fixture(handoffKind = 'mission25_reviewed_recommendation', queueKind = 'owner_attention_item') {
  const tenantId = uuid(1); const m25 = handoffKind === 'mission25_reviewed_recommendation';
  const handoff = contract.supportedHandoffs.find(item => item.id === handoffKind);
  const queue = contract.queueKinds.find(item => item.id === queueKind);
  const trigger = triggers.triggers.find(item => item.id === handoff.triggerId);
  const sourceRecordId = uuid(m25 ? 50 : 60); const sourceRecordDigest = digest(m25 ? 50 : 60); const sourceRevision = 3;
  const sourceBinding = {tenantId, triggerId: trigger.id, sourceClassId: trigger.sourceClassId, actionFamily: queue.actionFamily, sourceRecordId, sourceRecordRevision: sourceRevision, sourceRecordDigest, sourceIdentityDigest: hash({tenantId, triggerId: trigger.id, sourceRecordId, sourceRevision, sourceRecordDigest}), snapshotId: uuid(20), snapshotDigest: digest(20), lineageId: uuid(21), lineageKind: 'active', snapshotLineageSequence: 3, predecessorSnapshotId: uuid(19), predecessorSnapshotDigest: digest(19), headTransitionId: uuid(22), headTransitionDigest: digest(22), headSequence: 5, effectiveSnapshotId: uuid(20), effectiveSnapshotDigest: digest(20), eventKind: m25 ? 'reviewed_recommendation_created' : 'handoff_review_event_recorded', eventTime: '2026-10-29T12:00:00.000000Z', observedAt: '2026-10-29T12:04:00.000000Z', currentnessState: 'latest_exact_current'};
  const advisoryEvidence = {handoffKind, serviceKey: m25 ? 'plumbing.repair' : null, proposalId: m25 ? sourceRecordId : null, proposalRevision: m25 ? sourceRevision : null, proposalDigest: m25 ? sourceRecordDigest : null, consentRevision: m25 ? 4 : null, consentDigest: m25 ? digest(54) : null, sourceSummarySetDigest: m25 ? digest(55) : null, forecastRunId: m25 ? null : uuid(61), runDigest: m25 ? null : digest(61), outputDigest: m25 ? null : digest(62), currentnessRevision: m25 ? null : 7, currentnessDigest: m25 ? null : digest(63), forecastHandoffId: m25 ? null : sourceRecordId, forecastHandoffRevision: m25 ? null : sourceRevision, forecastHandoffDigest: m25 ? null : sourceRecordDigest, forecastHandoffState: m25 ? null : 'requested', forecastReviewEventRevision: m25 ? null : sourceRevision, forecastReviewEventDigest: m25 ? null : digest(64), evidenceQuality: handoff.evidenceQuality, trustStatus: handoff.trustStatus, uncertaintyState: handoff.uncertaintyState, horizonKind: handoff.horizonKind, horizonLocalStart: m25 ? null : '2026-11-01', unavailableState: 'none_exact_current'};
  sourceBinding.sourceIdentityDigest = hash({tenantId, triggerId: trigger.id, sourceRecordId, sourceRevision, sourceRecordDigest, advisoryEvidence});
  const reviewedHandoffBinding = {tenantId, handoffKind, handoffId: sourceRecordId, handoffRevision: sourceRevision, handoffDigest: sourceRecordDigest, reviewState: handoff.acceptedReviewState, reviewAction: handoff.acceptedReviewAction, reviewEventId: uuid(m25 ? 51 : 64), reviewEventRevision: sourceRevision, reviewEventDigest: m25 ? sourceRecordDigest : advisoryEvidence.forecastReviewEventDigest, reviewedByActorId: uuid(30), reviewedBySessionId: uuid(31), reviewedByMembershipId: uuid(32), reviewedBySessionSubjectActorId: uuid(30), reviewedByMembershipSubjectActorId: uuid(30), reviewedByTenantId: tenantId, reviewedBySessionTenantId: tenantId, reviewedByMembershipTenantId: tenantId, reviewedByActorState: 'active', reviewedBySessionState: 'active', reviewedByMembershipState: 'active', reviewedByMembershipRoleId: 'owner', reviewedAt: sourceBinding.eventTime, expiresAt: '2026-11-28T12:00:00.000000Z', receiverClass: 'mission28_tenant_private_attention_only', advisoryOnly: true, automaticActionAuthorized: false, externalEffectAuthorized: false};
  const input = {
    schemaVersion: contract.contractVersion, tenantId, attentionProjectionId: uuid(2), queueKind,
    sourceBinding, advisoryEvidence, reviewedHandoffBinding,
    policyEvaluationBinding: {tenantId, policyId: uuid(70), policyVersion: 3, policyDigest: digest(70), sourceSetDigest: '', ruleId: uuid(71), ruleDigest: digest(71), actionTemplateId: uuid(72), actionTemplateDigest: digest(72), actionFamilyId: queue.actionFamily, evaluationId: uuid(73), evaluationOutputDigest: digest(73), result: queue.evaluationResult, reasonCodes: queue.evaluationResult === 'eligible' ? ['rule_match','all_required_contract_authority_current'] : ['rule_match','authorization_required'], evidenceQuality: 'complete_exact', evaluatedAt: '2026-10-29T12:05:00.000000Z'},
    creatorAuthorityBinding: {actorId: uuid(40), sessionId: uuid(41), membershipId: uuid(42), sessionSubjectActorId: uuid(40), membershipSubjectActorId: uuid(40), actorTenantId: tenantId, sessionTenantId: tenantId, membershipTenantId: tenantId, actorState: 'active', sessionState: 'active', membershipState: 'active', membershipRoleId: 'owner', part1DCapabilityId: queue.creatorCapability, part3AVisibilityCapabilityId: 'automation_view', capabilityDecisionId: uuid(43), capabilityDecisionDigest: digest(43), recordScope: 'exact_tenant_all_automation'},
    assigneeBinding: {assigneeActorId: uuid(44), assigneeMembershipId: uuid(45), assigneeMembershipSubjectActorId: uuid(44), assigneeTenantId: tenantId, assigneeMembershipState: 'active', assigneeRoleId: 'owner', recipientClassId: 'tenant_owner'},
    dueWindow: {notBefore: '2026-10-29T12:05:00.000000Z', dueBy: '2026-10-30T12:05:00.000000Z'}, reasonCode: queue.reasonCode, priority: queue.priorities[0],
    sourceLink: {linkKind: 'opaque_internal_reviewed_advisory', tenantId, sourceRecordId, sourceRecordDigest, snapshotId: sourceBinding.snapshotId, snapshotDigest: sourceBinding.snapshotDigest, reviewedHandoffId: sourceRecordId, reviewedHandoffDigest: sourceRecordDigest},
    completionEvidence: {state: 'unavailable_no_accepted_completion_authority', completionRecordId: null, completionRecordDigest: null, completedByActorId: null, completedAt: null},
    evaluatedAt: '2026-10-29T12:05:00.000000Z', materialDigest: '', idempotencyKeyDigest: '', requestDigest: ''
  };
  input.policyEvaluationBinding.sourceSetDigest = sourceSetDigest(input);
  seal(input);
  return {input, trusted: trustedOf(input)};
}

function validate(input, trusted) {
  dataOnly(input); dataOnly(trusted);
  exactKeys(input, contract.envelope.exactFields); exactKeys(trusted, contract.envelope.trustedResolutionExactFields);
  for (const [key, fields] of [['sourceBinding','sourceBindingExactFields'],['advisoryEvidence','advisoryEvidenceExactFields'],['reviewedHandoffBinding','reviewedHandoffBindingExactFields'],['policyEvaluationBinding','policyEvaluationBindingExactFields'],['creatorAuthorityBinding','creatorAuthorityBindingExactFields'],['assigneeBinding','assigneeBindingExactFields'],['dueWindow','dueWindowExactFields'],['sourceLink','sourceLinkExactFields'],['completionEvidence','completionEvidenceExactFields']]) exactKeys(input[key], contract.envelope[fields]);
  if (input.schemaVersion !== contract.contractVersion || !UUID.test(input.tenantId) || !UUID.test(input.attentionProjectionId) || trusted.tenantId !== input.tenantId || trusted.evaluatedAt !== input.evaluatedAt) throw new Error('envelope');
  for (const key of ['queueKind','sourceBinding','advisoryEvidence','reviewedHandoffBinding','policyEvaluationBinding','creatorAuthorityBinding','assigneeBinding','dueWindow','reasonCode','priority','sourceLink','completionEvidence']) if (hash(input[key]) !== hash(trusted[key])) throw new Error('trusted resolution');
  const queue = contract.queueKinds.find(item => item.id === input.queueKind); const handoff = contract.supportedHandoffs.find(item => item.id === input.advisoryEvidence.handoffKind); if (!queue || !handoff || !handoff.queueKinds.includes(queue.id)) throw new Error('kind');
  const source = input.sourceBinding; const evidence = input.advisoryEvidence; const review = input.reviewedHandoffBinding; const policy = input.policyEvaluationBinding; const creator = input.creatorAuthorityBinding; const assignee = input.assigneeBinding;
  for (const tenant of [source.tenantId, review.tenantId, review.reviewedByTenantId, review.reviewedBySessionTenantId, review.reviewedByMembershipTenantId, policy.tenantId, creator.actorTenantId, creator.sessionTenantId, creator.membershipTenantId, assignee.assigneeTenantId, input.sourceLink.tenantId]) if (tenant !== input.tenantId) throw new Error('tenant');
  for (const value of [source.sourceRecordId, source.snapshotId, source.lineageId, source.predecessorSnapshotId, source.headTransitionId, review.handoffId, review.reviewEventId, review.reviewedByActorId, review.reviewedBySessionId, review.reviewedByMembershipId, policy.policyId, policy.ruleId, policy.actionTemplateId, policy.evaluationId, creator.actorId, creator.sessionId, creator.membershipId, creator.capabilityDecisionId, assignee.assigneeActorId, assignee.assigneeMembershipId, input.sourceLink.sourceRecordId, input.sourceLink.snapshotId, input.sourceLink.reviewedHandoffId]) if (!UUID.test(value)) throw new Error('identity');
  for (const value of [source.sourceRecordDigest, source.sourceIdentityDigest, source.snapshotDigest, source.predecessorSnapshotDigest, source.headTransitionDigest, source.effectiveSnapshotDigest, review.handoffDigest, review.reviewEventDigest, policy.policyDigest, policy.sourceSetDigest, policy.ruleDigest, policy.actionTemplateDigest, policy.evaluationOutputDigest, creator.capabilityDecisionDigest, input.sourceLink.sourceRecordDigest, input.sourceLink.snapshotDigest, input.sourceLink.reviewedHandoffDigest, input.materialDigest, input.idempotencyKeyDigest, input.requestDigest]) if (!DIGEST.test(value)) throw new Error('digest');
  const trigger = triggers.triggers.find(item => item.id === source.triggerId);
  if (!trigger || trigger.id !== handoff.triggerId || source.sourceClassId !== handoff.sourceClassId || source.sourceClassId !== contract.sourceAuthorityContract.sourceClassId || source.actionFamily !== queue.actionFamily || !trigger.allowedActionFamilies.includes(queue.actionFamily) || !contract.sourceAuthorityContract.allowedTriggerIds.includes(source.triggerId)) throw new Error('trigger action');
  if (!Number.isSafeInteger(source.sourceRecordRevision) || source.sourceRecordRevision < 1 || source.sourceIdentityDigest !== hash({tenantId: input.tenantId, triggerId: source.triggerId, sourceRecordId: source.sourceRecordId, sourceRevision: source.sourceRecordRevision, sourceRecordDigest: source.sourceRecordDigest, advisoryEvidence: evidence}) || source.lineageKind !== 'active' || source.currentnessState !== 'latest_exact_current' || !Number.isSafeInteger(source.snapshotLineageSequence) || source.snapshotLineageSequence < 2 || source.snapshotLineageSequence > contract.bounds.maximumLineageSequence || !Number.isSafeInteger(source.headSequence) || source.headSequence < 1 || source.effectiveSnapshotId !== source.snapshotId || source.effectiveSnapshotDigest !== source.snapshotDigest || !trigger.eventTime.kinds.some(item => item.eventKind === source.eventKind)) throw new Error('source head');
  const evaluated = micros(input.evaluatedAt); const observed = micros(source.observedAt); const event = micros(source.eventTime); const reviewed = micros(review.reviewedAt); const expires = micros(review.expiresAt);
  if (evaluated === null || observed === null || event === null || reviewed === null || expires === null || observed > evaluated || evaluated - observed > BigInt(contract.bounds.maximumSourceObservationAgeSeconds) * 1000000n || reviewed > evaluated || expires <= evaluated || policy.evaluatedAt !== input.evaluatedAt) throw new Error('time');
  for (const key of contract.envelope.advisoryEvidenceExactFields) if (evidence[key] === undefined) throw new Error('advisory shape');
  for (const key of handoff.sourceSpecificRequired) if (evidence[key] === null) throw new Error('source required');
  for (const key of handoff.sourceSpecificNull) if (evidence[key] !== null) throw new Error('source branch');
  if (evidence.evidenceQuality !== handoff.evidenceQuality || evidence.trustStatus !== handoff.trustStatus || evidence.uncertaintyState !== handoff.uncertaintyState || evidence.horizonKind !== handoff.horizonKind || evidence.unavailableState !== 'none_exact_current') throw new Error('advisory states');
  if (handoff.sourceMission === 25) {
    if (!SERVICE.test(evidence.serviceKey) || evidence.proposalId !== source.sourceRecordId || evidence.proposalRevision !== source.sourceRecordRevision || evidence.proposalDigest !== source.sourceRecordDigest || !Number.isSafeInteger(evidence.consentRevision) || evidence.consentRevision < 1 || !DIGEST.test(evidence.consentDigest) || !DIGEST.test(evidence.sourceSummarySetDigest) || evidence.horizonLocalStart !== null) throw new Error('m25');
  } else if (evidence.forecastHandoffId !== source.sourceRecordId || evidence.forecastHandoffRevision !== source.sourceRecordRevision || evidence.forecastHandoffDigest !== source.sourceRecordDigest || evidence.forecastHandoffState !== 'requested' || !Number.isSafeInteger(evidence.currentnessRevision) || evidence.currentnessRevision < 1 || !Number.isSafeInteger(evidence.forecastReviewEventRevision) || evidence.forecastReviewEventRevision !== evidence.forecastHandoffRevision || !UUID.test(evidence.forecastRunId) || ![evidence.runDigest,evidence.outputDigest,evidence.currentnessDigest,evidence.forecastReviewEventDigest].every(value => DIGEST.test(value)) || !MONTH.test(evidence.horizonLocalStart)) throw new Error('m26');
  if (review.handoffKind !== handoff.id || review.handoffId !== source.sourceRecordId || review.handoffRevision !== source.sourceRecordRevision || review.handoffDigest !== source.sourceRecordDigest || review.reviewState !== handoff.acceptedReviewState || review.reviewAction !== handoff.acceptedReviewAction || review.reviewEventRevision !== source.sourceRecordRevision || review.reviewedByActorId !== review.reviewedBySessionSubjectActorId || review.reviewedByActorId !== review.reviewedByMembershipSubjectActorId || review.reviewedByActorState !== 'active' || review.reviewedBySessionState !== 'active' || review.reviewedByMembershipState !== 'active' || !['owner','admin'].includes(review.reviewedByMembershipRoleId) || review.receiverClass !== 'mission28_tenant_private_attention_only' || review.advisoryOnly !== true || review.automaticActionAuthorized !== false || review.externalEffectAuthorized !== false) throw new Error('review');
  if (handoff.sourceMission === 25 && (review.reviewEventDigest !== evidence.proposalDigest || review.reviewedAt !== source.eventTime) || handoff.sourceMission === 26 && (review.reviewEventDigest !== evidence.forecastReviewEventDigest || review.reviewedAt !== source.eventTime)) throw new Error('review event');
  if (!Number.isSafeInteger(policy.policyVersion) || policy.policyVersion < 1 || policy.sourceSetDigest !== sourceSetDigest(input) || policy.actionFamilyId !== queue.actionFamily || policy.result !== queue.evaluationResult || policy.evidenceQuality !== 'complete_exact' || policy.reasonCodes.length < 2 || policy.reasonCodes.length > contract.bounds.maximumReasonCodes || new Set(policy.reasonCodes).size !== policy.reasonCodes.length) throw new Error('policy');
  const reasons = queue.evaluationResult === 'eligible' ? ['rule_match','all_required_contract_authority_current'] : ['rule_match','authorization_required'];
  if (JSON.stringify(policy.reasonCodes) !== JSON.stringify(reasons) || !evaluationContract.resultContract.states.includes(policy.result)) throw new Error('evaluation');
  const launchCell = launch.launchCells.find(item => item.actionFamily === queue.actionFamily); const launchBinding = launchCell && launchCell.allowedBindings.find(item => item.roleId === creator.membershipRoleId && item.capabilityId === creator.part1DCapabilityId && item.recipientClassId === queue.recipientClass);
  if (!launchCell || launchCell.firstLaunchState !== 'conditional_first_launch_not_implemented' || !launchCell.sourceClassIds.includes(source.sourceClassId) || !launchBinding) throw new Error('launch');
  const profile = capabilities.membershipProfiles.find(item => item.membershipRoleId === creator.membershipRoleId);
  if (creator.actorId !== creator.sessionSubjectActorId || creator.actorId !== creator.membershipSubjectActorId || creator.actorState !== 'active' || creator.sessionState !== 'active' || creator.membershipState !== 'active' || creator.part1DCapabilityId !== queue.creatorCapability || creator.part3AVisibilityCapabilityId !== 'automation_view' || !profile || !profile.capabilityIds.includes('automation_view') || creator.recordScope !== 'exact_tenant_all_automation') throw new Error('creator');
  if (assignee.assigneeActorId !== assignee.assigneeMembershipSubjectActorId || assignee.assigneeMembershipState !== 'active' || assignee.assigneeRoleId !== queue.assigneeRole || assignee.recipientClassId !== queue.recipientClass) throw new Error('assignee');
  const part12AKind = part12A.queueKinds.find(item => item.id === queue.part12AQueueKind);
  if (!part12AKind || part12AKind.actionFamily !== queue.actionFamily || part12AKind.creatorCapability !== queue.creatorCapability || part12AKind.recipientClass !== queue.recipientClass || !part12AKind.assigneeRoles.includes(queue.assigneeRole)) throw new Error('part12a');
  const notBefore = micros(input.dueWindow.notBefore); const dueBy = micros(input.dueWindow.dueBy);
  if (notBefore === null || dueBy === null || notBefore < evaluated || dueBy < notBefore || dueBy - evaluated > BigInt(contract.bounds.maximumDueWindowSeconds) * 1000000n || input.reasonCode !== queue.reasonCode || !queue.priorities.includes(input.priority)) throw new Error('attention material');
  if (input.sourceLink.linkKind !== 'opaque_internal_reviewed_advisory' || input.sourceLink.sourceRecordId !== source.sourceRecordId || input.sourceLink.sourceRecordDigest !== source.sourceRecordDigest || input.sourceLink.snapshotId !== source.snapshotId || input.sourceLink.snapshotDigest !== source.snapshotDigest || input.sourceLink.reviewedHandoffId !== review.handoffId || input.sourceLink.reviewedHandoffDigest !== review.handoffDigest) throw new Error('link');
  if (input.completionEvidence.state !== contract.recordContract.completionEvidenceState || ['completionRecordId','completionRecordDigest','completedByActorId','completedAt'].some(key => input.completionEvidence[key] !== null)) throw new Error('completion');
  if (Buffer.byteLength(JSON.stringify(input)) > contract.bounds.maximumCanonicalRequestBytes || input.materialDigest !== hash(materialOf(input)) || input.idempotencyKeyDigest !== hash(stableOf(input)) || input.requestDigest !== hash(requestOf(input))) throw new Error('sealed');
}

function project(input, trusted) {
  validate(input, trusted);
  return Object.freeze({attentionProjectionId: input.attentionProjectionId, tenantId: input.tenantId, queueKind: input.queueKind, handoffKind: input.advisoryEvidence.handoffKind, sourceRecordId: input.sourceBinding.sourceRecordId, sourceRecordDigest: input.sourceBinding.sourceRecordDigest, reviewedHandoffId: input.reviewedHandoffBinding.handoffId, reviewedHandoffDigest: input.reviewedHandoffBinding.handoffDigest, policyId: input.policyEvaluationBinding.policyId, policyVersion: input.policyEvaluationBinding.policyVersion, policyDigest: input.policyEvaluationBinding.policyDigest, evaluationId: input.policyEvaluationBinding.evaluationId, evaluationOutputDigest: input.policyEvaluationBinding.evaluationOutputDigest, assigneeActorId: input.assigneeBinding.assigneeActorId, evidenceQuality: input.advisoryEvidence.evidenceQuality, trustStatus: input.advisoryEvidence.trustStatus, uncertaintyState: input.advisoryEvidence.uncertaintyState, horizonKind: input.advisoryEvidence.horizonKind, horizonLocalStart: input.advisoryEvidence.horizonLocalStart, unavailableState: contract.fixedDecision.unavailableState, evaluatedAt: input.evaluatedAt, resultState: contract.fixedDecision.resultState, reasonState: contract.fixedDecision.reasonState, labelId: contract.fixedDecision.labelId, fixedLabel: contract.fixedDecision.fixedLabel, ownerReadableNoEffectOnly: true, queueRecordCreated: false, attentionItemCreated: false, approvalRequestCreated: false, completionEvidenceCreated: false, messageCreated: false, providerAttemptCreated: false, externalEffectCreated: false, upstreamMutationCreated: false, financialEffectCreated: false, moneyEffectCreated: false});
}

class History {
  constructor() { this.byId = new Map(); this.byStable = new Map(); }
  record(input, trusted) {
    const output = project(input, trusted); const prior = this.byId.get(input.attentionProjectionId);
    if (prior) { if (prior.requestDigest !== input.requestDigest || prior.materialDigest !== input.materialDigest || prior.idempotencyKeyDigest !== input.idempotencyKeyDigest) throw new Error('identity conflict'); return {...prior, replayed: true}; }
    if (this.byStable.has(input.idempotencyKeyDigest)) throw new Error('semantic clone');
    const stored = Object.freeze({...output, requestDigest: input.requestDigest, materialDigest: input.materialDigest, idempotencyKeyDigest: input.idempotencyKeyDigest, replayed: false}); this.byId.set(input.attentionProjectionId, stored); this.byStable.set(input.idempotencyKeyDigest, input.attentionProjectionId); return stored;
  }
}

function rejectCoherent(mutate, kind, queue) {
  const pair = fixture(kind, queue); mutate(pair.input); pair.input.policyEvaluationBinding.sourceSetDigest = sourceSetDigest(pair.input); seal(pair.input); pair.trusted = trustedOf(pair.input); expect(() => project(pair.input, pair.trusted)).toThrow();
}

describe('Mission 28 Part 12B reviewed attention handoff contract', () => {
  test('binds exact Part12A release, frozen inputs and source anchors', () => {
    expect(contract.authority).toMatchObject({part: '12B', state: 'implementation_candidate_only', baselineCommit: 'b7640e2b111bf09ef21b3094f0c2840209900c52', baselineTree: '32c3454a5923707cb33db51e5068f3085791778a'});
    expect(contract.part12ARelease).toMatchObject({acceptedSourceHead: '67a61f18e4fbc98ea4cc13ea8da5979bc0326aa3', acceptedTree: '32c3454a5923707cb33db51e5068f3085791778a', pullRequest: 599, mergedMain: 'b7640e2b111bf09ef21b3094f0c2840209900c52', productionAccepted: true, freshAudit: {verdict: 'P0=0_P1=0_P2=0_P3=0', nodeVersion: '22.23.3', focusedTests: '15/15', parts11ATo12A: '7_suites_105_tests', cumulativeMission28: '51_suites_707_tests', migrationHistory: '2_suites_40_tests', syntax: '51/51', json: '50/50', migrations: '283_through_287_no_288', changedPaths: '55_docs_tests_only', protectedPaths: 0}, release: {deploymentId: '1910f182-b342-424d-9d15-77c0a5c8e316', deploymentStatus: 'SUCCESS', serviceInstanceId: '7ee4f747-38c2-4baa-a024-1d7db6e7c218', deploymentInstanceId: 'dce382b6-d78d-4765-8ae1-597b801da8c2', deploymentInstanceStatus: 'RUNNING', imageSha256: 'sha256:4e194cb746a01384fbc7a19e2832f11efafefdab1b32274658319b5c3d0165d3', canonicalStartup: 'ready'}, directAppliedProductionMigrationHistory: 'unavailable_and_unclaimed'});
    for (const item of contract.frozenInputs) expect(digestLf(item.path)).toBe(item.normalizedLfSha256);
    const m25 = fs.readFileSync(path.join(ROOT, 'src/learning/jobOutcomeProposalContract.js'), 'utf8'); const m26 = fs.readFileSync(path.join(ROOT, 'src/forecasting/forecastHandoffRepository.js'), 'utf8');
    for (const anchor of ['expectedConsentRevision','expectedConsentDigest','summaryIds']) expect(m25).toContain(anchor);
    for (const anchor of ['m26-forecast-reviewed-handoff-v1','currentnessDigest','outboundCommunicationAuthorized','advisoryOnly']) expect(m26).toContain(anchor);
  });

  test.each(contract.supportedHandoffs.flatMap(handoff => contract.queueKinds.map(queue => [handoff.id, queue.id])))('projects %s to %s only as fixed unavailable no-effect evidence', (handoffKind, queueKind) => {
    const pair = fixture(handoffKind, queueKind); const output = project(pair.input, pair.trusted);
    expect(output).toMatchObject({handoffKind, queueKind, resultState: contract.fixedDecision.resultState, unavailableState: contract.fixedDecision.unavailableState, ownerReadableNoEffectOnly: true, queueRecordCreated: false, attentionItemCreated: false, approvalRequestCreated: false, messageCreated: false, providerAttemptCreated: false, externalEffectCreated: false, upstreamMutationCreated: false, financialEffectCreated: false, moneyEffectCreated: false});
  });

  test('requires the exact Mission25 reviewed recommendation identity consent evidence trust and horizon', () => {
    for (const mutation of [v => { v.advisoryEvidence.proposalId = uuid(99); }, v => { v.advisoryEvidence.proposalRevision += 1; }, v => { v.advisoryEvidence.proposalDigest = digest(99); }, v => { v.advisoryEvidence.consentRevision = 0; }, v => { v.advisoryEvidence.consentDigest = 'none'; }, v => { v.advisoryEvidence.sourceSummarySetDigest = 'bad'; }, v => { v.advisoryEvidence.serviceKey = 'Bad Service'; }, v => { v.advisoryEvidence.evidenceQuality = 'partial_unknown'; }, v => { v.advisoryEvidence.trustStatus = 'prediction'; }, v => { v.advisoryEvidence.uncertaintyState = 'certain'; }, v => { v.advisoryEvidence.horizonKind = 'future_month'; }, v => { v.advisoryEvidence.unavailableState = 'consent_revoked'; }, v => { v.advisoryEvidence.forecastRunId = uuid(90); }]) rejectCoherent(mutation, 'mission25_reviewed_recommendation', 'owner_attention_item');
  });

  test('requires the exact current requested Mission26 handoff run output uncertainty horizon and review event', () => {
    for (const mutation of [v => { v.advisoryEvidence.forecastHandoffState = 'dismissed'; }, v => { v.reviewedHandoffBinding.reviewAction = 'dismissed'; }, v => { v.reviewedHandoffBinding.reviewState = 'expired'; }, v => { v.advisoryEvidence.forecastRunId = uuid(90); }, v => { v.advisoryEvidence.runDigest = digest(90); }, v => { v.advisoryEvidence.outputDigest = digest(90); }, v => { v.advisoryEvidence.currentnessRevision = 0; }, v => { v.advisoryEvidence.currentnessDigest = digest(90); }, v => { v.advisoryEvidence.forecastReviewEventRevision += 1; }, v => { v.advisoryEvidence.forecastReviewEventDigest = digest(90); }, v => { v.advisoryEvidence.uncertaintyState = 'quantified'; }, v => { v.advisoryEvidence.horizonLocalStart = '2026-11-02'; }, v => { v.advisoryEvidence.proposalId = uuid(90); }]) rejectCoherent(mutation, 'mission26_reviewed_advisory_handoff', 'owner_attention_item');
  });

  test('binds exact Part4 source snapshot authoritative head event selector and correction currentness', () => {
    for (const mutation of [v => { v.sourceBinding.triggerId = 'm25.current_reviewed_outcome_summary'; }, v => { v.sourceBinding.sourceClassId = 'mission23_work_execution'; }, v => { v.sourceBinding.actionFamily = 'collection_escalation'; }, v => { v.sourceBinding.lineageKind = 'correction'; }, v => { v.sourceBinding.snapshotLineageSequence = 1; }, v => { v.sourceBinding.effectiveSnapshotId = uuid(99); }, v => { v.sourceBinding.effectiveSnapshotDigest = digest(99); }, v => { v.sourceBinding.eventKind = 'unknown'; }, v => { v.sourceBinding.currentnessState = 'stale'; }, v => { v.sourceBinding.observedAt = '2026-10-29T11:50:00.000000Z'; }]) rejectCoherent(mutation, 'mission25_reviewed_recommendation', 'owner_attention_item');
  });

  test('binds exact reviewed actor session membership tenant state and review expiry', () => {
    for (const mutation of [v => { v.reviewedHandoffBinding.reviewedByActorId = uuid(99); }, v => { v.reviewedHandoffBinding.reviewedBySessionSubjectActorId = uuid(99); }, v => { v.reviewedHandoffBinding.reviewedByMembershipSubjectActorId = uuid(99); }, v => { v.reviewedHandoffBinding.reviewedByTenantId = uuid(99); }, v => { v.reviewedHandoffBinding.reviewedByActorState = 'disabled'; }, v => { v.reviewedHandoffBinding.reviewedBySessionState = 'revoked'; }, v => { v.reviewedHandoffBinding.reviewedByMembershipState = 'inactive'; }, v => { v.reviewedHandoffBinding.reviewedByMembershipRoleId = 'member'; }, v => { v.reviewedHandoffBinding.expiresAt = v.evaluatedAt; }, v => { v.reviewedHandoffBinding.advisoryOnly = false; }, v => { v.reviewedHandoffBinding.automaticActionAuthorized = true; }, v => { v.reviewedHandoffBinding.externalEffectAuthorized = true; }]) rejectCoherent(mutation, 'mission25_reviewed_recommendation', 'owner_attention_item');
  });

  test('requires exact current Part5 policy evaluation action family source set result reasons and evidence', () => {
    for (const mutation of [v => { v.policyEvaluationBinding.policyVersion = 0; }, v => { v.policyEvaluationBinding.actionFamilyId = 'collection_escalation'; }, v => { v.policyEvaluationBinding.result = 'suppressed'; }, v => { v.policyEvaluationBinding.reasonCodes = ['rule_match','all_required_contract_authority_current','authorization_required']; }, v => { v.policyEvaluationBinding.evidenceQuality = 'partial_unknown'; }, v => { v.policyEvaluationBinding.evaluatedAt = '2026-10-29T12:04:00.000000Z'; }]) rejectCoherent(mutation, 'mission25_reviewed_recommendation', 'owner_attention_item');
    const sourceSet = fixture(); sourceSet.input.policyEvaluationBinding.sourceSetDigest = digest(99); seal(sourceSet.input); sourceSet.trusted = trustedOf(sourceSet.input); expect(() => project(sourceSet.input, sourceSet.trusted)).toThrow('policy');
    rejectCoherent(v => { v.policyEvaluationBinding.result = 'eligible'; v.policyEvaluationBinding.reasonCodes = ['rule_match','all_required_contract_authority_current']; }, 'mission26_reviewed_advisory_handoff', 'owner_approval_request');
  });

  test('enforces tenant actor session membership capability assignee and Part12A queue binding', () => {
    for (const mutation of [v => { v.creatorAuthorityBinding.actorTenantId = uuid(99); }, v => { v.creatorAuthorityBinding.actorId = uuid(99); }, v => { v.creatorAuthorityBinding.sessionState = 'revoked'; }, v => { v.creatorAuthorityBinding.membershipRoleId = 'member'; }, v => { v.creatorAuthorityBinding.part1DCapabilityId = 'automation_internal_action_view'; }, v => { v.creatorAuthorityBinding.part3AVisibilityCapabilityId = 'approve_run'; }, v => { v.creatorAuthorityBinding.recordScope = 'exact_assigned_internal_records_only'; }, v => { v.assigneeBinding.assigneeTenantId = uuid(99); }, v => { v.assigneeBinding.assigneeMembershipSubjectActorId = uuid(99); }, v => { v.assigneeBinding.assigneeMembershipState = 'inactive'; }, v => { v.assigneeBinding.assigneeRoleId = 'member'; }, v => { v.assigneeBinding.recipientClassId = 'assigned_staff'; }]) rejectCoherent(mutation, 'mission25_reviewed_recommendation', 'owner_attention_item');
  });

  test('denies cross-tenant source policy horizon identity grafts and candidate-created trusted authority', () => {
    const mutations = [v => { v.sourceBinding.tenantId = uuid(99); }, v => { v.reviewedHandoffBinding.handoffId = uuid(99); }, v => { v.sourceLink.reviewedHandoffDigest = digest(99); }, v => { v.sourceBinding.sourceRecordId = uuid(99); }, v => { v.advisoryEvidence.horizonKind = 'calendar_month'; v.advisoryEvidence.horizonLocalStart = '2026-11-01'; }];
    for (const mutation of mutations) rejectCoherent(mutation, 'mission25_reviewed_recommendation', 'owner_attention_item');
    for (const mutation of [v => { v.priority = 'high'; }, v => { v.policyEvaluationBinding.policyId = uuid(99); }, v => { v.policyEvaluationBinding.policyDigest = digest(99); }, v => { v.policyEvaluationBinding.evaluationId = uuid(99); }]) { const pair = fixture(); mutation(pair.input); pair.input.policyEvaluationBinding.sourceSetDigest = sourceSetDigest(pair.input); seal(pair.input); expect(() => project(pair.input, pair.trusted)).toThrow('trusted resolution'); }
  });

  test('rejects malformed hostile data before projection or digest trust', () => {
    const mutations = [v => { v.extra = true; }, v => { delete v.schemaVersion; }, v => { v.queueKind = null; }, v => { v.reasonCode = 'customer@example.test'; }, v => { v.priority = 'urgent'; }, v => { v.dueWindow.dueBy = '2027-12-01T00:00:00.000000Z'; }, v => { v.completionEvidence.state = 'completed'; }, v => { v.completionEvidence.completionRecordId = uuid(99); }, v => { v.sourceLink.linkKind = 'https://customer.example/secret'; }];
    for (const mutation of mutations) rejectCoherent(mutation, 'mission25_reviewed_recommendation', 'owner_attention_item');
    const getter = fixture(); let reads = 0; Object.defineProperty(getter.input.advisoryEvidence, 'proposalDigest', {enumerable: true, get() { reads += 1; return digest(50); }}); expect(() => project(getter.input, getter.trusted)).toThrow(); expect(reads).toBe(0);
    for (const hostile of [new Proxy(fixture().input, {}), Object.assign(Object.create({polluted: true}), fixture().input), Object.assign(fixture().input, {toJSON() { return {}; }}), Object.assign(fixture().input, {[Symbol('secret')]: true})]) expect(() => project(hostile, fixture().trusted)).toThrow();
    const sparse = fixture(); sparse.input.policyEvaluationBinding.reasonCodes = Array(2); expect(() => project(sparse.input, sparse.trusted)).toThrow();
  });

  test('provides exact replay while denying identity conflict and semantic clone reuse', () => {
    const history = new History(); const pair = fixture(); expect(history.record(pair.input, pair.trusted).replayed).toBe(false); expect(history.record(copy(pair.input), copy(pair.trusted)).replayed).toBe(true);
    const conflict = copy(pair.input); conflict.priority = 'high'; seal(conflict); expect(() => history.record(conflict, trustedOf(conflict))).toThrow('identity conflict');
    const clone = copy(pair.input); clone.attentionProjectionId = uuid(99); seal(clone); expect(clone.idempotencyKeyDigest).toBe(pair.input.idempotencyKeyDigest); expect(() => history.record(clone, trustedOf(clone))).toThrow('semantic clone');
  });

  test('keeps evidence visible and all records effects outcomes and learned authority at zero', () => {
    const output = project(...Object.values(fixture('mission26_reviewed_advisory_handoff', 'owner_approval_request')));
    expect(output).toMatchObject({evidenceQuality: 'complete_exact_reviewed_forecast_run', trustStatus: 'reviewed_advisory_only', uncertaintyState: 'unquantified_visible', horizonKind: 'calendar_month', horizonLocalStart: '2026-11-01', unavailableState: 'handoff_to_action_queue_runtime_unavailable'});
    expect(Object.entries(output).filter(([key]) => /(Created|EffectCreated|MutationCreated)$/.test(key)).every(([, value]) => value === false)).toBe(true);
    expect(contract.reviewedHandoffContract.learnedRecommendationPredictionOrReviewNeverCreatesFactPolicyPermissionApprovalOrActionAuthority).toBe(true);
  });

  test('reconciles roadmap and ledger to Part12C released and Part12D sole candidate', () => {
    const roadmap = fs.readFileSync(path.join(ROOT, 'docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md'), 'utf8'); const ledger = fs.readFileSync(path.join(ROOT, 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md'), 'utf8');
    for (const value of [roadmap, ledger]) { expect(value).toContain('Parts 1A–13B are released. Part 13C is the sole implementation candidate.'); expect(value).toContain('Parts 13D–14G remain planned and unimplemented.'); for (const identity of ['67a61f18e4fbc98ea4cc13ea8da5979bc0326aa3','32c3454a5923707cb33db51e5068f3085791778a','b7640e2b111bf09ef21b3094f0c2840209900c52','1910f182-b342-424d-9d15-77c0a5c8e316','7ee4f747-38c2-4baa-a024-1d7db6e7c218','dce382b6-d78d-4765-8ae1-597b801da8c2','sha256:4e194cb746a01384fbc7a19e2832f11efafefdab1b32274658319b5c3d0165d3','b42145ddc95e9bc2a383f9dac6ad1f5a884a90d5a3e999a0c126b2b6e3bae369']) expect(value).toContain(identity); expect(value).toMatch(/direct applied production migration history.*unavailable.*unclaimed/i); }
    expect((ledger.match(/\| \*\*Released\*\* \|/g) || []).length).toBe(56); expect((ledger.match(/\| \*\*Implementation candidate\*\* \|/g) || []).length).toBe(1); expect((ledger.match(/\| Planned \/ unimplemented \|/g) || []).length).toBe(9);
    expect(ledger).toContain('| 51 | 12A | Tenant-private owner/staff action queues | **Released** |'); expect(ledger).toContain('| 52 | 12B | Reviewed Mission 25/26 attention-item handoffs | **Released** |'); expect(ledger).toContain('| 53 | 12C | Internal-action dedupe, grouping, priority and correction | **Released** |');
  });

  test('keeps runtime persistence provider effect and later-slice authority unavailable', () => {
    expect(contract.runtimeBoundary).toMatchObject({newMigration: false, newTableFunctionRouteWorkerQueueSchedulerOrUi: false, mountedReviewedHandoffToQueueResolver: false, mountedTaskOrApprovalPersistence: false, queueRecordsCreated: 0, attentionItemsCreated: 0, approvalRequestsCreated: 0, messagesCreated: 0, providerAttemptsCreated: 0, externalEffectsCreated: 0, upstreamMutationsCreated: 0, financialEffectsCreated: 0, moneyEffectsCreated: 0, latestMigration: '287_canonical_automation_estimate_quote_resolution_v1.sql', nextMigrationAbsent: '288'});
    expect(contract.laterSliceBoundary).toMatchObject({laterAuthorityNotGranted: true}); expect(contract.unavailableEvidence).toEqual(expect.arrayContaining([expect.stringContaining('real recipients'), expect.stringContaining('founder visual approval')]));
  });
});
