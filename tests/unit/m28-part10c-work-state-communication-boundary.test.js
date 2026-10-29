'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {types: {isProxy}} = require('util');

const ROOT = path.resolve(__dirname, '../..');
const CONTRACT_PATH = path.join(ROOT, 'docs/architecture/MISSION_28_PART10C_WORK_STATE_COMMUNICATION_BOUNDARY_CONTRACT.json');
const CONTRACT_MD = path.join(ROOT, 'docs/architecture/MISSION_28_PART10C_WORK_STATE_COMMUNICATION_BOUNDARY_CONTRACT.md');
const ROADMAP = path.join(ROOT, 'docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md');
const LEDGER = path.join(ROOT, 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md');
const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8'));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const copy = value => JSON.parse(JSON.stringify(value));
const hash = value => `sha256:${crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
const digestLf = relative => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, relative), 'utf8').replace(/\r\n/g, '\n')).digest('hex').toUpperCase();
const uuid = value => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const digest = value => `sha256:${String(value).padStart(2, '0').slice(-2).repeat(32)}`;

function dataGate(value, seen = new WeakSet()) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return;
  if (typeof value !== 'object' || isProxy(value) || seen.has(value)) throw new Error('plain data');
  seen.add(value);
  const proto = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    const keys = Reflect.ownKeys(value);
    if (proto !== Array.prototype || keys.some(key => key !== 'length' && !/^(0|[1-9][0-9]*)$/.test(key)) || keys.filter(key => key !== 'length').length !== value.length) throw new Error('dense array');
  } else if (proto !== Object.prototype) throw new Error('ordinary object');
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'symbol') throw new Error('symbol');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable || key === 'toJSON') throw new Error('descriptor');
    if (key !== 'length') dataGate(descriptor.value, seen);
  }
}

function exactKeys(value, keys) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || JSON.stringify(Reflect.ownKeys(value)) !== JSON.stringify(keys)) throw new Error('keys');
}

function utcMicros(value) {
  const match = typeof value === 'string' ? /^([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2})\.([0-9]{6})Z$/.exec(value) : null;
  if (!match) return null;
  const millisecondForm = `${match[1]}.${match[2].slice(0, 3)}Z`;
  const millis = Date.parse(millisecondForm);
  if (!Number.isFinite(millis) || new Date(millis).toISOString() !== millisecondForm) return null;
  return BigInt(millis) * 1000n + BigInt(match[2].slice(3));
}

function materialOf(input) { const value = copy(input); delete value.resolutionId; delete value.materialDigest; delete value.idempotencyKeyDigest; delete value.requestDigest; return value; }
function idempotencyMaterialOf(input) { const value = materialOf(input); delete value.evaluatedAt; return value; }
function requestOf(input) { const value = copy(input); delete value.materialDigest; delete value.idempotencyKeyDigest; delete value.requestDigest; return value; }
function identityOf(input) { const value = input.sourceBinding; return value.sourceMode === 'progress' ? {tenantId: input.tenantId, executionId: value.executionId, progressRecordId: value.progressRecordId} : {tenantId: input.tenantId, executionId: value.executionId, assignmentId: value.assignmentId}; }
function currentnessPinsOf(input) { const value = input.sourceBinding; return value.sourceMode === 'progress' ? {executionRevision: value.executionRevision, executionDigest: value.executionDigest, progressRevision: value.progressRevision, progressDigest: value.progressDigest, eventKind: value.eventKind, eventTime: value.eventTime} : {executionRevision: value.executionRevision, executionDigest: value.executionDigest, assignmentRevision: value.assignmentRevision, assignmentDigest: value.assignmentDigest, lifecycleState: value.lifecycleState, eventKind: value.eventKind, eventTime: value.eventTime}; }
function customerSafeEvidenceOf(input) { const value = input.sourceBinding; return {sourceMode: value.sourceMode, executionId: value.executionId, executionRevision: value.executionRevision, executionDigest: value.executionDigest, assignmentId: value.assignmentId, assignmentRevision: value.assignmentRevision, assignmentDigest: value.assignmentDigest, progressRecordId: value.progressRecordId, progressRevision: value.progressRevision, progressDigest: value.progressDigest, progressKind: value.progressKind, progressState: value.progressState, progressReviewState: value.progressReviewState, progressUncertainty: value.progressUncertainty, completionRecordId: value.completionRecordId, completionRecordRevision: value.completionRecordRevision, completionRecordDigest: value.completionRecordDigest, completionAction: value.completionAction, lifecycleState: value.lifecycleState, eventKind: value.eventKind, eventTime: value.eventTime, sourceEventField: value.sourceEventField, sourceStateSelector: value.sourceStateSelector}; }

function bindSourceProof(input) {
  const source = input.sourceBinding;
  if (source.sourceMode === 'unavailable') {
    source.sourceRecordIdentityDigest = null; source.sourceCurrentnessPinsDigest = null; source.customerSafeEvidenceDigest = null; return;
  }
  source.sourceRecordIdentityDigest = hash({namespace: 'mission28.part4b.record-identity.v1', value: identityOf(input)});
  source.sourceCurrentnessPinsDigest = hash({namespace: 'mission28.part4b.currentness-pins.v1', value: currentnessPinsOf(input)});
  source.customerSafeEvidenceDigest = hash({namespace: 'mission28.part10c.customer-safe-evidence.v1', value: customerSafeEvidenceOf(input)});
}

function seal(input) {
  input.materialDigest = hash(materialOf(input));
  input.idempotencyKeyDigest = hash({namespace: 'mission28.part10c.work-state-communication-idempotency.v1', material: idempotencyMaterialOf(input)});
  input.requestDigest = hash(requestOf(input));
  return input;
}

function sourceFor(requestedKind) {
  const progress = ['work_progress_notice', 'work_blocked_notice'].includes(requestedKind);
  const completion = ['work_completed_notice', 'work_reopened_notice'].includes(requestedKind);
  const blocked = requestedKind === 'work_blocked_notice'; const reopened = requestedKind === 'work_reopened_notice';
  const unavailableReasons = {work_started_notice: 'no_accepted_customer_safe_work_started_trigger', ready_for_review_notice: 'completion_pending_is_not_accepted_customer_safe_review_ready_authority', aftercare_notice: 'no_accepted_customer_safe_aftercare_trigger'};
  return {
    tenantId: uuid(1), sourceMode: progress ? 'progress' : completion ? 'completion' : 'unavailable', sourceTriggerId: progress ? 'm23.work_progress_state' : completion ? 'm23.work_completion_reopening_state' : null,
    sourceRecordIdentityDigest: null, sourceCurrentnessPinsDigest: null, customerSafeEvidenceDigest: null,
    executionId: progress || completion ? uuid(10) : null, executionRevision: progress || completion ? (reopened ? 9 : 8) : null, executionDigest: progress || completion ? digest(reopened ? 19 : 18) : null,
    assignmentId: completion ? uuid(11) : null, assignmentRevision: completion ? (reopened ? 7 : 6) : null, assignmentDigest: completion ? digest(reopened ? 27 : 26) : null,
    progressRecordId: progress ? uuid(12) : null, progressRevision: progress ? 4 : null, progressDigest: progress ? digest(24) : null, progressKind: progress ? (blocked ? 'blocker' : 'progress') : null, progressState: blocked ? 'open' : null, progressReviewState: progress ? 'owner_confirmed' : null, progressUncertainty: progress && !blocked ? 'measured' : null,
    completionRecordId: completion ? uuid(13) : null, completionRecordRevision: completion ? (reopened ? 3 : 2) : null, completionRecordDigest: completion ? digest(reopened ? 33 : 32) : null, completionAction: completion ? (reopened ? 'reopen_execution' : 'approve_completion') : null, lifecycleState: completion ? (reopened ? 'reopened' : 'completed') : null,
    eventKind: progress ? 'progress_observed' : completion ? (reopened ? 'work_reopened' : 'completion_approved') : null, eventTime: progress || completion ? '2026-10-29T12:02:00.000000Z' : null,
    sourceEventField: progress ? 'progressRecord.observedAt' : completion ? 'completionRecord.decidedAt' : null, sourceStateSelector: progress ? 'progress_record_revision_digest_and_review_state=exact' : completion ? `completionRecord.action=${reopened ? 'reopen_execution' : 'approve_completion'}` : null,
    observedAt: progress || completion ? '2026-10-29T12:04:00.000000Z' : null,
    snapshotId: progress || completion ? uuid(14) : null, snapshotDigest: progress || completion ? digest(14) : null, sourceSetDigest: progress || completion ? digest(15) : null, currentnessResolutionId: progress || completion ? uuid(16) : null, currentnessResolutionDigest: progress || completion ? digest(16) : null, currentnessState: progress || completion ? 'latest_exact_current' : 'unavailable_no_accepted_trigger', lineageState: progress || completion ? 'original_exact_current' : null,
    sourceUnavailableReason: progress || completion ? null : unavailableReasons[requestedKind]
  };
}

function fixture(requestedKind = 'work_progress_notice') {
  const sourceBinding = sourceFor(requestedKind); const kind = contract.requestKinds.find(item => item.id === requestedKind);
  const input = {
    schemaVersion: contract.contractVersion, tenantId: uuid(1), resolutionId: uuid(2), requestedKind, sourceBinding,
    customerSafeBinding: {state: sourceBinding.sourceMode === 'unavailable' ? 'unavailable_no_customer_safe_source' : 'fixed_customer_safe_state_only', fixedLabel: kind.fixedLabel, rawDescriptionIncluded: false, internalNotesIncluded: false, staffIdentityIncluded: false, staffContactIncluded: false, costIncluded: false, marginIncluded: false, quantityIncluded: false, predictionIncluded: false, uncertainCompletionIncluded: false},
    launchMatrixBinding: {contractDigest: `sha256:${contract.frozenInputs.find(item => item.path.endsWith('PART1D_FIRST_LAUNCH_MATRIX.json')).normalizedLfSha256.toLowerCase()}`, actionFamily: 'customer_communication', firstLaunchState: 'unavailable', acceptedSourceClassCount: 0, acceptedRoleCount: 0, acceptedCapabilityCount: 0, acceptedChannelCount: 0, acceptedRecipientClassCount: 0, externalEffectsEnabled: false},
    communicationBasisBinding: {contractDigest: `sha256:${contract.frozenInputs.find(item => item.path.endsWith('PART7B_COMMUNICATION_PERMISSION_CONTRACT.json')).normalizedLfSha256.toLowerCase()}`, externalResult: 'always_unavailable_or_suppressed_until_a_later_explicitly_accepted_launch_matrix_legal_provider_channel_and_effect_authority', permissionResolutionId: null, permissionResolutionDigest: null, permissionBasisState: 'unavailable_no_accepted_external_basis', channelId: null, providerMode: 'provider_disabled'},
    actorAuthorityBinding: {actorId: uuid(30), sessionId: uuid(31), membershipId: uuid(32), sessionSubjectActorId: uuid(30), membershipSubjectActorId: uuid(30), actorTenantId: uuid(1), sessionTenantId: uuid(1), membershipTenantId: uuid(1), actorState: 'active', sessionState: 'active', membershipState: 'active', membershipRoleId: 'owner', capabilityId: 'automation_internal_action_view', capabilityDecisionId: uuid(33), capabilityDecisionDigest: digest(33)},
    evaluatedAt: '2026-10-29T12:05:00.000000Z', materialDigest: digest(90), idempotencyKeyDigest: digest(91), requestDigest: digest(92)
  };
  bindSourceProof(input); return seal(input);
}

function validateSourceTime(source, evaluatedAt) {
  const observed = utcMicros(source.observedAt); const evaluated = utcMicros(evaluatedAt); const event = utcMicros(source.eventTime);
  if (observed === null || evaluated === null || event === null || event > observed || observed > evaluated || evaluated - observed > BigInt(contract.bounds.maximumSourceObservationAgeSeconds) * 1000000n) throw new Error('source currentness');
}

function validate(input, trusted) {
  dataGate(input); dataGate(trusted); exactKeys(input, contract.resolutionEnvelope.exactFields); exactKeys(input.sourceBinding, contract.resolutionEnvelope.sourceBindingExactFields); exactKeys(input.customerSafeBinding, contract.resolutionEnvelope.customerSafeBindingExactFields); exactKeys(input.launchMatrixBinding, contract.resolutionEnvelope.launchMatrixBindingExactFields); exactKeys(input.communicationBasisBinding, contract.resolutionEnvelope.communicationBasisBindingExactFields); exactKeys(input.actorAuthorityBinding, contract.resolutionEnvelope.actorAuthorityBindingExactFields);
  if (input.schemaVersion !== contract.contractVersion || !UUID.test(input.tenantId) || !UUID.test(input.resolutionId) || utcMicros(input.evaluatedAt) === null || Buffer.byteLength(JSON.stringify(input), 'utf8') > contract.bounds.maximumCanonicalRequestBytes) throw new Error('identity');
  const kind = contract.requestKinds.find(item => item.id === input.requestedKind); if (!kind || input.sourceBinding.sourceMode !== kind.sourceMode) throw new Error('kind');
  if (JSON.stringify(materialOf(input)) !== JSON.stringify(materialOf(trusted))) throw new Error('trusted material');
  const source = input.sourceBinding;
  if (source.tenantId !== input.tenantId) throw new Error('source tenant');
  if (source.sourceMode === 'unavailable') {
    const expectedReasons = {work_started_notice: 'no_accepted_customer_safe_work_started_trigger', ready_for_review_notice: 'completion_pending_is_not_accepted_customer_safe_review_ready_authority', aftercare_notice: 'no_accepted_customer_safe_aftercare_trigger'};
    const nullable = ['sourceTriggerId','sourceRecordIdentityDigest','sourceCurrentnessPinsDigest','customerSafeEvidenceDigest','executionId','executionRevision','executionDigest','assignmentId','assignmentRevision','assignmentDigest','progressRecordId','progressRevision','progressDigest','progressKind','progressState','progressReviewState','progressUncertainty','completionRecordId','completionRecordRevision','completionRecordDigest','completionAction','lifecycleState','eventKind','eventTime','sourceEventField','sourceStateSelector','observedAt','snapshotId','snapshotDigest','sourceSetDigest','currentnessResolutionId','currentnessResolutionDigest','lineageState'];
    if (source.currentnessState !== 'unavailable_no_accepted_trigger' || source.sourceUnavailableReason !== expectedReasons[input.requestedKind] || nullable.some(key => source[key] !== null)) throw new Error('unsupported source');
  } else {
    for (const value of [source.executionId, source.snapshotId, source.currentnessResolutionId]) if (!UUID.test(value)) throw new Error('source identity');
    for (const value of [source.sourceRecordIdentityDigest, source.sourceCurrentnessPinsDigest, source.customerSafeEvidenceDigest, source.executionDigest, source.snapshotDigest, source.sourceSetDigest, source.currentnessResolutionDigest]) if (!DIGEST.test(value)) throw new Error('source digest');
    if (!Number.isSafeInteger(source.executionRevision) || source.executionRevision < 1 || source.currentnessState !== 'latest_exact_current' || source.lineageState !== 'original_exact_current' || source.sourceUnavailableReason !== null) throw new Error('source currentness');
    if (source.sourceRecordIdentityDigest !== hash({namespace: 'mission28.part4b.record-identity.v1', value: identityOf(input)}) || source.sourceCurrentnessPinsDigest !== hash({namespace: 'mission28.part4b.currentness-pins.v1', value: currentnessPinsOf(input)}) || source.customerSafeEvidenceDigest !== hash({namespace: 'mission28.part10c.customer-safe-evidence.v1', value: customerSafeEvidenceOf(input)})) throw new Error('source proof');
    validateSourceTime(source, input.evaluatedAt);
    if (source.sourceMode === 'progress') {
      if (source.sourceTriggerId !== 'm23.work_progress_state' || !UUID.test(source.progressRecordId) || !Number.isSafeInteger(source.progressRevision) || source.progressRevision < 1 || !DIGEST.test(source.progressDigest) || source.eventKind !== 'progress_observed' || source.sourceEventField !== 'progressRecord.observedAt' || source.sourceStateSelector !== 'progress_record_revision_digest_and_review_state=exact' || !contract.decisionContract.supportedProgressReviewStates.includes(source.progressReviewState) || [source.assignmentId,source.assignmentRevision,source.assignmentDigest,source.completionRecordId,source.completionRecordRevision,source.completionRecordDigest,source.completionAction,source.lifecycleState].some(value => value !== null)) throw new Error('progress source');
      if (input.requestedKind === 'work_progress_notice' && (source.progressKind !== 'progress' || source.progressState !== null || source.progressUncertainty !== 'measured')) throw new Error('progress fact');
      if (input.requestedKind === 'work_blocked_notice' && (!['blocker','exception'].includes(source.progressKind) || !contract.decisionContract.supportedBlockingStates.includes(source.progressState) || source.progressUncertainty !== null)) throw new Error('blocked fact');
    } else {
      if (source.sourceTriggerId !== 'm23.work_completion_reopening_state' || !UUID.test(source.assignmentId) || !Number.isSafeInteger(source.assignmentRevision) || source.assignmentRevision < 1 || !DIGEST.test(source.assignmentDigest) || !UUID.test(source.completionRecordId) || !Number.isSafeInteger(source.completionRecordRevision) || source.completionRecordRevision < 1 || !DIGEST.test(source.completionRecordDigest) || [source.progressRecordId,source.progressRevision,source.progressDigest,source.progressKind,source.progressState,source.progressReviewState,source.progressUncertainty].some(value => value !== null)) throw new Error('completion source');
      if (source.sourceEventField !== 'completionRecord.decidedAt') throw new Error('completion event');
      if (input.requestedKind === 'work_completed_notice' && (source.eventKind !== 'completion_approved' || source.completionAction !== 'approve_completion' || source.sourceStateSelector !== 'completionRecord.action=approve_completion' || source.lifecycleState !== 'completed')) throw new Error('completion fact');
      if (input.requestedKind === 'work_reopened_notice' && (source.eventKind !== 'work_reopened' || source.completionAction !== 'reopen_execution' || source.sourceStateSelector !== 'completionRecord.action=reopen_execution' || source.lifecycleState !== 'reopened')) throw new Error('reopened fact');
    }
  }
  const safety = input.customerSafeBinding;
  if (safety.state !== (source.sourceMode === 'unavailable' ? 'unavailable_no_customer_safe_source' : 'fixed_customer_safe_state_only') || safety.fixedLabel !== kind.fixedLabel || [safety.rawDescriptionIncluded,safety.internalNotesIncluded,safety.staffIdentityIncluded,safety.staffContactIncluded,safety.costIncluded,safety.marginIncluded,safety.quantityIncluded,safety.predictionIncluded,safety.uncertainCompletionIncluded].some(value => value !== false)) throw new Error('customer safe');
  const launch = input.launchMatrixBinding;
  if (launch.contractDigest !== `sha256:${contract.frozenInputs.find(item => item.path.endsWith('PART1D_FIRST_LAUNCH_MATRIX.json')).normalizedLfSha256.toLowerCase()}` || launch.actionFamily !== 'customer_communication' || launch.firstLaunchState !== 'unavailable' || [launch.acceptedSourceClassCount,launch.acceptedRoleCount,launch.acceptedCapabilityCount,launch.acceptedChannelCount,launch.acceptedRecipientClassCount].some(value => value !== 0) || launch.externalEffectsEnabled !== false) throw new Error('launch');
  const basis = input.communicationBasisBinding;
  if (basis.contractDigest !== `sha256:${contract.frozenInputs.find(item => item.path.endsWith('PART7B_COMMUNICATION_PERMISSION_CONTRACT.json')).normalizedLfSha256.toLowerCase()}` || basis.externalResult !== 'always_unavailable_or_suppressed_until_a_later_explicitly_accepted_launch_matrix_legal_provider_channel_and_effect_authority' || basis.permissionResolutionId !== null || basis.permissionResolutionDigest !== null || basis.permissionBasisState !== 'unavailable_no_accepted_external_basis' || basis.channelId !== null || basis.providerMode !== 'provider_disabled') throw new Error('communication basis');
  const actor = input.actorAuthorityBinding;
  if ([actor.actorId,actor.sessionId,actor.membershipId,actor.sessionSubjectActorId,actor.membershipSubjectActorId,actor.actorTenantId,actor.sessionTenantId,actor.membershipTenantId,actor.capabilityDecisionId].some(value => !UUID.test(value)) || !DIGEST.test(actor.capabilityDecisionDigest) || actor.actorId !== actor.sessionSubjectActorId || actor.actorId !== actor.membershipSubjectActorId || [actor.actorTenantId,actor.sessionTenantId,actor.membershipTenantId].some(value => value !== input.tenantId) || [actor.actorState,actor.sessionState,actor.membershipState].some(value => value !== 'active') || actor.membershipRoleId !== 'owner' || actor.capabilityId !== 'automation_internal_action_view') throw new Error('actor');
  if (!DIGEST.test(input.materialDigest) || !DIGEST.test(input.idempotencyKeyDigest) || !DIGEST.test(input.requestDigest) || input.materialDigest !== hash(materialOf(input)) || input.idempotencyKeyDigest !== hash({namespace: 'mission28.part10c.work-state-communication-idempotency.v1', material: idempotencyMaterialOf(input)}) || input.requestDigest !== hash(requestOf(input))) throw new Error('digest');
  return kind;
}

function project(input, trusted) {
  const kind = validate(input, trusted);
  return Object.freeze({resolutionId: input.resolutionId, tenantId: input.tenantId, requestedKind: input.requestedKind, executionId: input.sourceBinding.executionId, sourceCurrentnessState: input.sourceBinding.currentnessState, resultState: kind.resultState, reasonCode: kind.reasonCode, fixedLabel: kind.fixedLabel, ownerReadableProjectionOnly: true, worklistRecordCreated: false, taskCreated: false, notificationCreated: false, messageCreated: false, providerAttemptCreated: false, workMutationCreated: false, evidenceMutationCreated: false, completionMutationCreated: false, reopeningMutationCreated: false, externalEffectCreated: false, upstreamMutationCreated: false, moneyEffectCreated: false});
}

class History {
  constructor() { this.byId = new Map(); this.byStable = new Map(); }
  record(input, trusted) {
    const output = project(input, trusted); const previous = this.byId.get(input.resolutionId);
    if (previous) { if (previous.requestDigest !== input.requestDigest) throw new Error('identity conflict'); return Object.freeze({...previous, replayed: true}); }
    if (this.byStable.has(input.idempotencyKeyDigest)) throw new Error('clone');
    const stored = Object.freeze({...output, requestDigest: input.requestDigest, materialDigest: input.materialDigest, idempotencyKeyDigest: input.idempotencyKeyDigest, replayed: false});
    this.byId.set(input.resolutionId, stored); this.byStable.set(input.idempotencyKeyDigest, input.resolutionId); return stored;
  }
}

describe('Mission 28 Part 10C work-state communication boundary', () => {
  test('binds exact Part10B release provenance and frozen controlling inputs', () => {
    expect(contract.authority).toMatchObject({part: '10C', state: 'implementation_candidate_only', baselineCommit: 'aba9701e18ed02048c666aaa1334f1d5a2993e5b', baselineTree: 'd093ba7d009d9fe032feb5db3bc8b4a8cb521c5e'});
    expect(contract.part10BRelease).toMatchObject({acceptedSourceHead: '99d5668de99807c0314cd20c32d18c16c677a4ac', pullRequest: 590, deployment: 'f9f8199b-be1b-497c-ba80-e2c569a9f9ac', runningInstance: '2297ca45-f10a-4558-b0ad-05f7e01adc9f', imageSha256: '6ef12845ec18fa87a1ef36471683bfea2010c98d9adf054ac8b12db21c5e34f6'});
    for (const item of contract.frozenInputs) expect(digestLf(item.path)).toBe(item.normalizedLfSha256);
  });

  test('uses a closed kind order and fixed truthful no-effect results', () => {
    expect(contract.requestKinds.map(item => item.id)).toEqual(contract.decisionContract.closedKindOrder);
    for (const kind of contract.requestKinds) expect(project(fixture(kind.id), fixture(kind.id))).toMatchObject({requestedKind: kind.id, resultState: kind.resultState, reasonCode: kind.reasonCode, messageCreated: false, externalEffectCreated: false});
  });

  test('accepts only exact reviewed progress and blocker evidence', () => {
    expect(project(fixture('work_progress_notice'), fixture('work_progress_notice')).resultState).toBe('unavailable_no_accepted_external_authority');
    expect(project(fixture('work_blocked_notice'), fixture('work_blocked_notice')).resultState).toBe('unavailable_no_accepted_external_authority');
    for (const mutation of [value => { value.sourceBinding.progressReviewState = 'needs_review'; }, value => { value.sourceBinding.progressReviewState = 'disputed'; }, value => { value.sourceBinding.progressKind = 'field_change'; }, value => { value.sourceBinding.progressUncertainty = 'estimated'; }, value => { value.sourceBinding.progressUncertainty = 'unknown'; }]) { const candidate = fixture(); mutation(candidate); bindSourceProof(candidate); seal(candidate); expect(() => project(candidate, copy(candidate))).toThrow(); }
    for (const mutation of [value => { value.sourceBinding.progressState = 'resolved'; }, value => { value.sourceBinding.progressKind = 'progress'; }, value => { value.sourceBinding.progressState = 'customer@example.test'; }]) { const candidate = fixture('work_blocked_notice'); mutation(candidate); bindSourceProof(candidate); seal(candidate); expect(() => project(candidate, copy(candidate))).toThrow('blocked fact'); }
  });

  test('requires exact completion and reopening decisions and never treats an older completion as current after reopening', () => {
    expect(project(fixture('work_completed_notice'), fixture('work_completed_notice')).sourceCurrentnessState).toBe('latest_exact_current');
    expect(project(fixture('work_reopened_notice'), fixture('work_reopened_notice')).sourceCurrentnessState).toBe('latest_exact_current');
    for (const mutation of [value => { value.sourceBinding.lifecycleState = 'reopened'; }, value => { value.sourceBinding.completionAction = 'reopen_execution'; }, value => { value.sourceBinding.eventKind = 'work_reopened'; }, value => { value.sourceBinding.lineageState = 'corrected'; }]) { const candidate = fixture('work_completed_notice'); mutation(candidate); bindSourceProof(candidate); seal(candidate); expect(() => project(candidate, copy(candidate))).toThrow(); }
    for (const mutation of [value => { value.sourceBinding.lifecycleState = 'completed'; }, value => { value.sourceBinding.completionAction = 'approve_completion'; }, value => { value.sourceBinding.eventKind = 'completion_approved'; }]) { const candidate = fixture('work_reopened_notice'); mutation(candidate); bindSourceProof(candidate); seal(candidate); expect(() => project(candidate, copy(candidate))).toThrow(); }
  });

  test('keeps work-started ready-for-review and aftercare unavailable without inference', () => {
    for (const requestedKind of ['work_started_notice','ready_for_review_notice','aftercare_notice']) expect(project(fixture(requestedKind), fixture(requestedKind)).resultState).toBe('unavailable_source_fact_not_supported');
    for (const mutation of [value => { value.sourceBinding.sourceMode = 'completion'; }, value => { value.sourceBinding.lifecycleState = 'in_progress'; }, value => { value.sourceBinding.lifecycleState = 'completion_pending'; }, value => { value.sourceBinding.sourceUnavailableReason = 'inferred_from_elapsed_clock'; }]) { const candidate = fixture('ready_for_review_notice'); mutation(candidate); seal(candidate); expect(() => project(candidate, copy(candidate))).toThrow(); }
  });

  test('binds exact source identities pins snapshots currentness and original lineage', () => {
    const mutations = [value => { value.sourceBinding.tenantId = uuid(99); }, value => { value.sourceBinding.executionId = uuid(99); }, value => { value.sourceBinding.progressRecordId = uuid(99); }, value => { value.sourceBinding.progressRevision += 1; }, value => { value.sourceBinding.progressDigest = digest(99); }, value => { value.sourceBinding.snapshotDigest = digest(99); }, value => { value.sourceBinding.sourceSetDigest = digest(99); }, value => { value.sourceBinding.currentnessState = 'stale'; }, value => { value.sourceBinding.lineageState = 'corrected'; }, value => { value.sourceBinding.eventKind = 'completion_approved'; }, value => { value.sourceBinding.sourceEventField = 'completionRecord.decidedAt'; }, value => { value.sourceBinding.sourceStateSelector = 'progress_record_revision_digest_and_review_state=unknown'; }];
    for (const mutation of mutations) { const trusted = fixture(); const candidate = copy(trusted); mutation(candidate); seal(candidate); expect(() => project(candidate, trusted)).toThrow(); }
  });

  test('enforces finite source observation age and exact source-owned event time', () => {
    const threshold = fixture(); threshold.sourceBinding.observedAt = '2026-10-29T12:00:00.000000Z'; threshold.sourceBinding.eventTime = threshold.sourceBinding.observedAt; bindSourceProof(threshold); seal(threshold); expect(project(threshold, copy(threshold)).sourceCurrentnessState).toBe('latest_exact_current');
    for (const observedAt of ['2026-10-29T11:59:59.999999Z','2026-10-29T12:05:00.000001Z','bad']) { const candidate = fixture(); candidate.sourceBinding.observedAt = observedAt; seal(candidate); expect(() => project(candidate, copy(candidate))).toThrow('source currentness'); }
    const futureEvent = fixture(); futureEvent.sourceBinding.eventTime = '2026-10-29T12:04:00.000001Z'; bindSourceProof(futureEvent); seal(futureEvent); expect(() => project(futureEvent, copy(futureEvent))).toThrow('source currentness');
  });

  test('requires coherent new snapshot and currentness evidence for a genuine source change', () => {
    const changed = fixture(); Object.assign(changed.sourceBinding, {executionRevision: 9, executionDigest: digest(91), progressRevision: 5, progressDigest: digest(92), snapshotId: uuid(91), snapshotDigest: digest(93), sourceSetDigest: digest(94), currentnessResolutionId: uuid(95), currentnessResolutionDigest: digest(95)}); changed.resolutionId = uuid(96); bindSourceProof(changed); seal(changed); expect(project(changed, copy(changed)).sourceCurrentnessState).toBe('latest_exact_current');
    const graft = fixture(); graft.sourceBinding.progressRevision = 5; graft.sourceBinding.progressDigest = digest(92); seal(graft); expect(() => project(graft, copy(graft))).toThrow('source proof');
  });

  test('withholds internal notes staff details cost margin quantity uncertainty and predictions', () => {
    for (const mutation of [value => { value.customerSafeBinding.rawDescriptionIncluded = true; }, value => { value.customerSafeBinding.internalNotesIncluded = true; }, value => { value.customerSafeBinding.staffIdentityIncluded = true; }, value => { value.customerSafeBinding.staffContactIncluded = true; }, value => { value.customerSafeBinding.costIncluded = true; }, value => { value.customerSafeBinding.marginIncluded = true; }, value => { value.customerSafeBinding.quantityIncluded = true; }, value => { value.customerSafeBinding.predictionIncluded = true; }, value => { value.customerSafeBinding.uncertainCompletionIncluded = true; }, value => { value.internalNote = 'customer@example.test cost 999999'; }]) { const candidate = fixture(); mutation(candidate); seal(candidate); expect(() => project(candidate, copy(candidate))).toThrow(); }
  });

  test('denies launch widening candidate-created permission channel provider and effect authority', () => {
    for (const mutation of [value => { value.launchMatrixBinding.firstLaunchState = 'conditional'; }, value => { value.launchMatrixBinding.acceptedSourceClassCount = 1; }, value => { value.launchMatrixBinding.acceptedRecipientClassCount = 1; }, value => { value.launchMatrixBinding.externalEffectsEnabled = true; }, value => { value.communicationBasisBinding.permissionResolutionId = uuid(40); }, value => { value.communicationBasisBinding.permissionBasisState = 'owner_reviewed'; }, value => { value.communicationBasisBinding.channelId = 'sms'; }, value => { value.communicationBasisBinding.providerMode = 'sandbox'; }]) { const candidate = fixture(); mutation(candidate); seal(candidate); expect(() => project(candidate, copy(candidate))).toThrow(); }
  });

  test('denies cross-actor same-tenant substitution inactive authority and oversized requests', () => {
    for (const mutation of [value => { value.actorAuthorityBinding.sessionSubjectActorId = uuid(90); }, value => { value.actorAuthorityBinding.membershipSubjectActorId = uuid(91); }, value => { value.actorAuthorityBinding.membershipTenantId = uuid(99); }, value => { value.actorAuthorityBinding.sessionState = 'revoked'; }, value => { value.actorAuthorityBinding.membershipRoleId = 'admin'; }]) { const candidate = fixture(); mutation(candidate); seal(candidate); expect(() => project(candidate, copy(candidate))).toThrow('actor'); }
    const oversized = fixture(); oversized.customerSafeBinding.fixedLabel = 'x'.repeat(contract.bounds.maximumCanonicalRequestBytes); seal(oversized); expect(() => project(oversized, copy(oversized))).toThrow('identity');
  });

  test('uses stable semantic idempotency and denies clone or conflicting replay reuse', () => {
    const history = new History(); const first = fixture(); expect(history.record(first, copy(first)).replayed).toBe(false); expect(history.record(copy(first), copy(first)).replayed).toBe(true);
    const clone = copy(first); clone.resolutionId = uuid(99); clone.evaluatedAt = '2026-10-29T12:08:00.000000Z'; seal(clone); expect(clone.idempotencyKeyDigest).toBe(first.idempotencyKeyDigest); expect(() => history.record(clone, copy(clone))).toThrow('clone');
    const conflict = copy(first); conflict.evaluatedAt = '2026-10-29T12:08:00.000000Z'; seal(conflict); expect(() => history.record(conflict, copy(conflict))).toThrow('identity conflict');
  });

  test('rejects extra missing accessor symbol proxy toJSON custom-prototype sparse and alias data before hooks', () => {
    for (const mutation of [value => { value.extra = 'x'; }, value => { delete value.requestDigest; }, value => { value.sourceBinding.toJSON = () => ({}); }, value => { Object.setPrototypeOf(value.sourceBinding, {}); }, value => { value.customerSafeBinding = value.sourceBinding; }]) { const candidate = fixture(); mutation(candidate); expect(() => project(candidate, fixture())).toThrow(); }
    let getters = 0; const accessor = fixture(); Object.defineProperty(accessor.sourceBinding, 'progressKind', {enumerable: true, get() { getters += 1; return 'progress'; }}); expect(() => project(accessor, fixture())).toThrow(); expect(getters).toBe(0);
    const symbol = fixture(); symbol[Symbol('secret')] = 'sk_secret'; expect(() => project(symbol, fixture())).toThrow();
    let traps = 0; const proxy = new Proxy(fixture(), {get() { traps += 1; throw new Error('trap'); }, ownKeys() { traps += 1; throw new Error('trap'); }}); expect(() => project(proxy, fixture())).toThrow(); expect(traps).toBe(0);
    const sparse = fixture(); sparse.extraArray = []; sparse.extraArray[1] = 'x'; expect(() => project(sparse, fixture())).toThrow();
  });

  test('uses fixed nonreflective labels and produces zero records messages mutations or effects', () => {
    for (const item of contract.requestKinds) expect(item.fixedLabel).not.toMatch(/@|phone|token|sk_|customerName|workerName|description|note|cost|margin|quantity|urgent/i);
    for (const key of Object.keys(contract.privacyAndEffects)) expect(contract.privacyAndEffects[key]).toBe(0);
    for (const kind of contract.decisionContract.closedKindOrder) { const output = project(fixture(kind), fixture(kind)); for (const key of ['worklistRecordCreated','taskCreated','notificationCreated','messageCreated','providerAttemptCreated','workMutationCreated','evidenceMutationCreated','completionMutationCreated','reopeningMutationCreated','externalEffectCreated','upstreamMutationCreated','moneyEffectCreated']) expect(output[key]).toBe(false); }
  });

  test('freezes docs-tests-only boundary with migration287 latest and no288', () => {
    expect(contract.runtimeBoundary).toMatchObject({newMigration: false, newTableFunctionRouteOrUi: false, mountedSchedulerWorkerQueueOrPolicyExecutor: false, providerAdapterCallbackOrInboundReceiver: false, workProgressCompletionReopeningOrEvidenceMutation: false, nextMigrationAbsent: '288'});
    const migrations = fs.readdirSync(path.join(ROOT, 'migrations')).filter(name => /^\d+_/.test(name)).sort(); expect(migrations.at(-1)).toBe('287_canonical_automation_estimate_quote_resolution_v1.sql'); expect(migrations.some(name => name.startsWith('288_'))).toBe(false);
  });

  test('roadmap and ledger record Part10B released Part10C candidate and Part10D plus planned', () => {
    const roadmap = fs.readFileSync(ROADMAP, 'utf8'); const ledger = fs.readFileSync(LEDGER, 'utf8'); const markdown = fs.readFileSync(CONTRACT_MD, 'utf8');
    for (const document of [roadmap, ledger]) { expect(document).toContain('Parts 1A–11C are released. Part 11D is the sole implementation candidate.'); expect(document).toContain('Parts 11E–14G remain planned and unimplemented.'); expect(document).toContain('f9f8199b-be1b-497c-ba80-e2c569a9f9ac'); expect(document).toContain('sha256:6ef12845ec18fa87a1ef36471683bfea2010c98d9adf054ac8b12db21c5e34f6'); expect(document).toMatch(/direct applied(?: migration)?-history re-query.*unavailable/i); }
    expect(ledger).toContain('| 42 | 10B | Exact dispatch/on-the-way/delay/cancellation communication | **Released** |'); expect(ledger).toContain('| 43 | 10C | Exact customer-safe work-state communication | **Released** |'); expect((ledger.match(/\*\*Implementation candidate\*\*/g) || [])).toHaveLength(1); expect((ledger.match(/Planned \/ unimplemented/g) || [])).toHaveLength(18); expect(markdown).toContain('No migration 288');
  });
});
