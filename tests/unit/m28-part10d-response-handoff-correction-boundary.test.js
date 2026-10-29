'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {types: {isProxy}} = require('util');

const ROOT = path.resolve(__dirname, '../..');
const CONTRACT_PATH = path.join(ROOT, 'docs/architecture/MISSION_28_PART10D_RESPONSE_HANDOFF_CORRECTION_BOUNDARY_CONTRACT.json');
const CONTRACT_MD = path.join(ROOT, 'docs/architecture/MISSION_28_PART10D_RESPONSE_HANDOFF_CORRECTION_BOUNDARY_CONTRACT.md');
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
  const milliseconds = `${match[1]}.${match[2].slice(0, 3)}Z`;
  const parsed = Date.parse(milliseconds);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== milliseconds) return null;
  return BigInt(parsed) * 1000n + BigInt(match[2].slice(3));
}

function canonicalTimeZone(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 100) return false;
  try { return new Intl.DateTimeFormat('en-US', {timeZone: value}).resolvedOptions().timeZone === value; } catch (_) { return false; }
}

function materialOf(input) { const value = copy(input); delete value.resolutionId; delete value.materialDigest; delete value.idempotencyKeyDigest; delete value.requestDigest; return value; }
function idempotencyMaterialOf(input) { const value = materialOf(input); delete value.evaluatedAt; return value; }
function requestOf(input) { const value = copy(input); delete value.materialDigest; delete value.idempotencyKeyDigest; delete value.requestDigest; return value; }

function sourceIdentityOf(input) {
  const source = input.targetSourceBinding;
  return source.sourceMission === 22
    ? {tenantId: input.tenantId, appointmentId: source.appointmentId}
    : {tenantId: input.tenantId, executionId: source.executionId, assignmentId: source.assignmentId};
}

function sourcePinsOf(input) {
  const source = input.targetSourceBinding;
  return source.sourceMission === 22
    ? {revision: source.appointmentRevision, digest: source.appointmentDigest, status: source.appointmentStatus, scheduledStart: source.scheduledStart, scheduledEnd: source.scheduledEnd, timeZone: source.timeZone, eventKind: source.eventKind, eventTime: source.eventTime}
    : {executionRevision: source.executionRevision, executionDigest: source.executionDigest, assignmentRevision: source.assignmentRevision, assignmentDigest: source.assignmentDigest, lifecycleState: source.lifecycleState, eventKind: source.eventKind, eventTime: source.eventTime};
}

function bindSourceProof(input) {
  input.targetSourceBinding.sourceRecordIdentityDigest = hash({namespace: 'mission28.part4b.record-identity.v1', value: sourceIdentityOf(input)});
  input.targetSourceBinding.sourceCurrentnessPinsDigest = hash({namespace: 'mission28.part4b.currentness-pins.v1', value: sourcePinsOf(input)});
}

function seal(input) {
  input.materialDigest = hash(materialOf(input));
  input.idempotencyKeyDigest = hash({namespace: 'mission28.part10d.response-handoff-correction-idempotency.v1', material: idempotencyMaterialOf(input)});
  input.requestDigest = hash(requestOf(input));
  return input;
}

function targetFor(requestedKind) {
  const completion = requestedKind === 'completion_concern';
  return {
    tenantId: uuid(1), sourceMission: completion ? 23 : 22, sourceTriggerId: completion ? 'm23.work_completion_reopening_state' : 'm22.appointment_state', sourceClassId: completion ? 'mission23_work_execution' : 'mission22_appointment_dispatch', sourceRecordType: completion ? 'work_execution' : 'appointment', targetRecordId: completion ? uuid(20) : uuid(10), targetRevision: completion ? 8 : 5, targetDigest: completion ? digest(28) : digest(25), targetState: completion ? 'completed' : 'scheduled',
    appointmentId: completion ? null : uuid(10), appointmentRevision: completion ? null : 5, appointmentDigest: completion ? null : digest(25), appointmentStatus: completion ? null : 'scheduled', scheduledStart: completion ? null : '2026-10-29T13:00:00.000000Z', scheduledEnd: completion ? null : '2026-10-29T14:00:00.000000Z', timeZone: completion ? null : 'America/New_York',
    executionId: completion ? uuid(20) : null, executionRevision: completion ? 8 : null, executionDigest: completion ? digest(28) : null, assignmentId: completion ? uuid(21) : null, assignmentRevision: completion ? 6 : null, assignmentDigest: completion ? digest(26) : null, lifecycleState: completion ? 'completed' : null,
    eventKind: completion ? 'completion_approved' : 'appointment_state_changed', eventTime: '2026-10-29T12:02:00.000000Z', sourceEventField: completion ? 'completionRecord.decidedAt' : 'appointment.updated_at', sourceStateSelector: completion ? 'completionRecord.action=approve_completion' : 'revision_digest_and_status=exact', observedAt: '2026-10-29T12:04:00.000000Z', snapshotId: completion ? uuid(22) : uuid(12), snapshotDigest: completion ? digest(32) : digest(22), sourceSetDigest: completion ? digest(33) : digest(23), currentnessResolutionId: completion ? uuid(24) : uuid(14), currentnessResolutionDigest: completion ? digest(34) : digest(24), currentnessState: 'latest_exact_current', lineageState: 'original_exact_current', predecessorRecordRevision: null, predecessorRecordDigest: null, predecessorSnapshotId: null, predecessorSnapshotDigest: null, sourceRecordIdentityDigest: digest(90), sourceCurrentnessPinsDigest: digest(91)
  };
}

function fixture(requestedKind = 'customer_confirmation') {
  const kind = contract.requestKinds.find(item => item.id === requestedKind);
  const input = {
    schemaVersion: contract.contractVersion, tenantId: uuid(1), resolutionId: uuid(2), requestedKind, targetSourceBinding: targetFor(requestedKind),
    responseEvidenceBinding: {state: 'unavailable_no_accepted_authenticated_inbound_handoff', responseEventId: null, responseEventDigest: null, responseOccurredAt: null, authenticatedRecipientIdentityDigest: null, deliveryEvidenceDigest: null, responseKind: null, rawBodyRetained: false},
    pendingCommunicationBinding: {state: 'none_all_prior_communications_unavailable_no_effect', pendingCount: 0, communicationRequestId: null, actionUnitId: null, actionUnitDigest: null},
    correctionBinding: {state: 'no_correction_no_pending_communication', affectedPendingCount: 0, cancelledPendingCount: 0, staledPendingCount: 0, rebuiltPendingCount: 0, currentProjectionRecomputed: false},
    handoffBinding: {state: 'unavailable_no_accepted_response_evidence_or_task_authority', responseEvidenceRecordId: null, responseEvidenceRecordDigest: null, ownerStaffTaskId: null, ownerStaffTaskDigest: null, internalAlertId: null, internalAlertDigest: null, boundedResponseEvidenceCreated: false, ownerStaffTaskCreated: false},
    actorAuthorityBinding: {actorId: uuid(30), sessionId: uuid(31), membershipId: uuid(32), sessionSubjectActorId: uuid(30), membershipSubjectActorId: uuid(30), actorTenantId: uuid(1), sessionTenantId: uuid(1), membershipTenantId: uuid(1), actorState: 'active', sessionState: 'active', membershipState: 'active', membershipRoleId: 'owner', capabilityId: 'automation_internal_action_view', capabilityDecisionId: uuid(33), capabilityDecisionDigest: digest(33)},
    evaluatedAt: '2026-10-29T12:05:00.000000Z', materialDigest: digest(90), idempotencyKeyDigest: digest(91), requestDigest: digest(92)
  };
  if (!kind) throw new Error('fixture kind');
  bindSourceProof(input);
  return seal(input);
}

function correctedSuccessor(original) {
  const value = copy(original); const source = value.targetSourceBinding; const mission22 = source.sourceMission === 22;
  value.resolutionId = uuid(80); value.evaluatedAt = '2026-10-29T12:08:00.000000Z';
  source.predecessorRecordRevision = source.targetRevision; source.predecessorRecordDigest = source.targetDigest; source.predecessorSnapshotId = source.snapshotId; source.predecessorSnapshotDigest = source.snapshotDigest;
  source.targetRevision += 1; source.targetDigest = digest(81); source.snapshotId = uuid(81); source.snapshotDigest = digest(82); source.sourceSetDigest = digest(83); source.currentnessResolutionId = uuid(84); source.currentnessResolutionDigest = digest(84); source.eventTime = '2026-10-29T12:06:00.000000Z'; source.observedAt = '2026-10-29T12:07:00.000000Z'; source.lineageState = 'corrected_successor_exact_current';
  if (mission22) { source.appointmentRevision = source.targetRevision; source.appointmentDigest = source.targetDigest; }
  else { source.executionRevision = source.targetRevision; source.executionDigest = source.targetDigest; }
  value.correctionBinding.state = 'corrected_source_current_projection_rebuilt_no_pending_communication'; value.correctionBinding.currentProjectionRecomputed = true;
  bindSourceProof(value); return seal(value);
}

function validateSource(input) {
  const source = input.targetSourceBinding;
  if (source.tenantId !== input.tenantId || ![22, 23].includes(source.sourceMission) || !UUID.test(source.targetRecordId) || !Number.isSafeInteger(source.targetRevision) || source.targetRevision < 1 || !DIGEST.test(source.targetDigest) || !UUID.test(source.snapshotId) || !DIGEST.test(source.snapshotDigest) || !DIGEST.test(source.sourceSetDigest) || !UUID.test(source.currentnessResolutionId) || !DIGEST.test(source.currentnessResolutionDigest) || source.currentnessState !== 'latest_exact_current') throw new Error('source identity');
  const observed = utcMicros(source.observedAt); const evaluated = utcMicros(input.evaluatedAt); const event = utcMicros(source.eventTime);
  if (observed === null || evaluated === null || event === null || event > observed || observed > evaluated || evaluated - observed > BigInt(contract.bounds.maximumSourceObservationAgeSeconds) * 1000000n) throw new Error('source time');
  if (source.sourceRecordIdentityDigest !== hash({namespace: 'mission28.part4b.record-identity.v1', value: sourceIdentityOf(input)}) || source.sourceCurrentnessPinsDigest !== hash({namespace: 'mission28.part4b.currentness-pins.v1', value: sourcePinsOf(input)})) throw new Error('source proof');
  if (source.sourceMission === 22) {
    if (source.sourceTriggerId !== 'm22.appointment_state' || source.sourceClassId !== 'mission22_appointment_dispatch' || source.sourceRecordType !== 'appointment' || source.targetRecordId !== source.appointmentId || source.targetRevision !== source.appointmentRevision || source.targetDigest !== source.appointmentDigest || source.targetState !== source.appointmentStatus || !UUID.test(source.appointmentId) || !Number.isSafeInteger(source.appointmentRevision) || !DIGEST.test(source.appointmentDigest) || source.appointmentStatus !== 'scheduled' || utcMicros(source.scheduledStart) === null || utcMicros(source.scheduledEnd) === null || source.scheduledStart >= source.scheduledEnd || !canonicalTimeZone(source.timeZone) || source.eventKind !== 'appointment_state_changed' || source.sourceEventField !== 'appointment.updated_at' || source.sourceStateSelector !== 'revision_digest_and_status=exact' || [source.executionId,source.executionRevision,source.executionDigest,source.assignmentId,source.assignmentRevision,source.assignmentDigest,source.lifecycleState].some(item => item !== null)) throw new Error('appointment source');
  } else if (source.sourceTriggerId !== 'm23.work_completion_reopening_state' || source.sourceClassId !== 'mission23_work_execution' || source.sourceRecordType !== 'work_execution' || source.targetRecordId !== source.executionId || source.targetRevision !== source.executionRevision || source.targetDigest !== source.executionDigest || source.targetState !== source.lifecycleState || !UUID.test(source.executionId) || !Number.isSafeInteger(source.executionRevision) || !DIGEST.test(source.executionDigest) || !UUID.test(source.assignmentId) || !Number.isSafeInteger(source.assignmentRevision) || !DIGEST.test(source.assignmentDigest) || source.lifecycleState !== 'completed' || source.eventKind !== 'completion_approved' || source.sourceEventField !== 'completionRecord.decidedAt' || source.sourceStateSelector !== 'completionRecord.action=approve_completion' || [source.appointmentId,source.appointmentRevision,source.appointmentDigest,source.appointmentStatus,source.scheduledStart,source.scheduledEnd,source.timeZone].some(item => item !== null)) throw new Error('completion source');
  if (source.lineageState === 'original_exact_current') {
    if ([source.predecessorRecordRevision,source.predecessorRecordDigest,source.predecessorSnapshotId,source.predecessorSnapshotDigest].some(item => item !== null)) throw new Error('original lineage');
  } else if (source.lineageState === 'corrected_successor_exact_current') {
    if (!Number.isSafeInteger(source.predecessorRecordRevision) || source.targetRevision !== source.predecessorRecordRevision + 1 || !DIGEST.test(source.predecessorRecordDigest) || source.predecessorRecordDigest === source.targetDigest || !UUID.test(source.predecessorSnapshotId) || !DIGEST.test(source.predecessorSnapshotDigest) || source.predecessorSnapshotId === source.snapshotId || source.predecessorSnapshotDigest === source.snapshotDigest) throw new Error('corrected lineage');
  } else throw new Error('lineage');
}

function validate(input, trusted) {
  dataGate(input); dataGate(trusted); exactKeys(input, contract.resolutionEnvelope.exactFields); exactKeys(input.targetSourceBinding, contract.resolutionEnvelope.targetSourceBindingExactFields); exactKeys(input.responseEvidenceBinding, contract.resolutionEnvelope.responseEvidenceBindingExactFields); exactKeys(input.pendingCommunicationBinding, contract.resolutionEnvelope.pendingCommunicationBindingExactFields); exactKeys(input.correctionBinding, contract.resolutionEnvelope.correctionBindingExactFields); exactKeys(input.handoffBinding, contract.resolutionEnvelope.handoffBindingExactFields); exactKeys(input.actorAuthorityBinding, contract.resolutionEnvelope.actorAuthorityBindingExactFields);
  if (input.schemaVersion !== contract.contractVersion || !UUID.test(input.tenantId) || !UUID.test(input.resolutionId) || utcMicros(input.evaluatedAt) === null || Buffer.byteLength(JSON.stringify(input), 'utf8') > contract.bounds.maximumCanonicalRequestBytes || JSON.stringify(materialOf(input)) !== JSON.stringify(materialOf(trusted))) throw new Error('identity');
  const kind = contract.requestKinds.find(item => item.id === input.requestedKind); if (!kind || kind.sourceTriggerId !== input.targetSourceBinding.sourceTriggerId) throw new Error('kind');
  validateSource(input);
  const unavailable = input.responseEvidenceBinding;
  if (unavailable.state !== 'unavailable_no_accepted_authenticated_inbound_handoff' || unavailable.rawBodyRetained !== false || ['responseEventId','responseEventDigest','responseOccurredAt','authenticatedRecipientIdentityDigest','deliveryEvidenceDigest','responseKind'].some(key => unavailable[key] !== null)) throw new Error('response evidence');
  const pending = input.pendingCommunicationBinding;
  if (pending.state !== 'none_all_prior_communications_unavailable_no_effect' || pending.pendingCount !== 0 || ['communicationRequestId','actionUnitId','actionUnitDigest'].some(key => pending[key] !== null)) throw new Error('pending');
  const corrected = input.targetSourceBinding.lineageState === 'corrected_successor_exact_current'; const correction = input.correctionBinding;
  if (correction.state !== (corrected ? 'corrected_source_current_projection_rebuilt_no_pending_communication' : 'no_correction_no_pending_communication') || correction.currentProjectionRecomputed !== corrected || [correction.affectedPendingCount,correction.cancelledPendingCount,correction.staledPendingCount,correction.rebuiltPendingCount].some(value => value !== 0)) throw new Error('correction');
  const handoff = input.handoffBinding;
  if (handoff.state !== 'unavailable_no_accepted_response_evidence_or_task_authority' || handoff.boundedResponseEvidenceCreated !== false || handoff.ownerStaffTaskCreated !== false || ['responseEvidenceRecordId','responseEvidenceRecordDigest','ownerStaffTaskId','ownerStaffTaskDigest','internalAlertId','internalAlertDigest'].some(key => handoff[key] !== null)) throw new Error('handoff');
  const actor = input.actorAuthorityBinding;
  if ([actor.actorId,actor.sessionId,actor.membershipId,actor.sessionSubjectActorId,actor.membershipSubjectActorId,actor.actorTenantId,actor.sessionTenantId,actor.membershipTenantId,actor.capabilityDecisionId].some(value => !UUID.test(value)) || !DIGEST.test(actor.capabilityDecisionDigest) || actor.actorId !== actor.sessionSubjectActorId || actor.actorId !== actor.membershipSubjectActorId || [actor.actorTenantId,actor.sessionTenantId,actor.membershipTenantId].some(value => value !== input.tenantId) || [actor.actorState,actor.sessionState,actor.membershipState].some(value => value !== 'active') || actor.membershipRoleId !== 'owner' || actor.capabilityId !== 'automation_internal_action_view') throw new Error('actor');
  if (!DIGEST.test(input.materialDigest) || !DIGEST.test(input.idempotencyKeyDigest) || !DIGEST.test(input.requestDigest) || input.materialDigest !== hash(materialOf(input)) || input.idempotencyKeyDigest !== hash({namespace: 'mission28.part10d.response-handoff-correction-idempotency.v1', material: idempotencyMaterialOf(input)}) || input.requestDigest !== hash(requestOf(input))) throw new Error('digest');
  return kind;
}

function project(input, trusted) {
  const kind = validate(input, trusted);
  return Object.freeze({resolutionId: input.resolutionId, tenantId: input.tenantId, requestedKind: input.requestedKind, targetRecordId: input.targetSourceBinding.targetRecordId, targetRevision: input.targetSourceBinding.targetRevision, lineageState: input.targetSourceBinding.lineageState, resultState: kind.resultState, reasonCode: kind.reasonCode, fixedLabel: kind.fixedLabel, ownerReadableProjectionOnly: true, responseEvidenceCreated: false, worklistRecordCreated: false, taskCreated: false, internalAlertCreated: false, notificationCreated: false, messageCreated: false, providerAttemptCreated: false, pendingCommunicationMutationCreated: false, Mission22MutationCreated: false, Mission23MutationCreated: false, externalEffectCreated: false, upstreamMutationCreated: false, moneyEffectCreated: false});
}

class History {
  constructor() { this.byId = new Map(); this.byStable = new Map(); this.latestByTarget = new Map(); }
  record(input, trusted) {
    const output = project(input, trusted); const previous = this.byId.get(input.resolutionId);
    if (previous) { if (previous.requestDigest !== input.requestDigest) throw new Error('identity conflict'); return Object.freeze({...previous, replayed: true}); }
    if (this.byStable.has(input.idempotencyKeyDigest)) throw new Error('clone');
    const key = `${input.tenantId}:${input.targetSourceBinding.sourceTriggerId}:${input.targetSourceBinding.targetRecordId}`; const latest = this.latestByTarget.get(key); const source = input.targetSourceBinding;
    if (source.lineageState === 'corrected_successor_exact_current' && (!latest || latest.targetRevision !== source.predecessorRecordRevision || latest.targetDigest !== source.predecessorRecordDigest || latest.snapshotId !== source.predecessorSnapshotId || latest.snapshotDigest !== source.predecessorSnapshotDigest)) throw new Error('predecessor');
    if (source.lineageState === 'original_exact_current' && latest) throw new Error('duplicate root');
    const stored = Object.freeze({...output, targetDigest: source.targetDigest, snapshotId: source.snapshotId, snapshotDigest: source.snapshotDigest, requestDigest: input.requestDigest, materialDigest: input.materialDigest, idempotencyKeyDigest: input.idempotencyKeyDigest, replayed: false});
    this.byId.set(input.resolutionId, stored); this.byStable.set(input.idempotencyKeyDigest, input.resolutionId); this.latestByTarget.set(key, stored); return stored;
  }
}

describe('Mission 28 Part 10D response handoff and correction boundary', () => {
  test('binds exact Part10C release provenance and all frozen controlling inputs', () => {
    expect(contract.authority).toMatchObject({part: '10D', state: 'implementation_candidate_only', baselineCommit: '762653d73dc88ecfd77c14d0bb66382fa15669c7', baselineTree: '9dbb4b713954d1755f8065e45e906f2a38a2be57'});
    expect(contract.part10CRelease).toMatchObject({acceptedSourceHead: '348c9f4ea829e04478b89bc4a5f7a733a1fb1f19', acceptedTree: '9dbb4b713954d1755f8065e45e906f2a38a2be57', pullRequest: 591, mergedMain: '762653d73dc88ecfd77c14d0bb66382fa15669c7'});
    for (const item of contract.frozenInputs) expect(digestLf(item.path)).toBe(item.normalizedLfSha256);
  });

  test('uses six closed fixed no-effect request results without fabricating a response or task', () => {
    expect(contract.requestKinds.map(item => item.id)).toEqual(['customer_confirmation','customer_question','reschedule_request','cancellation_request','access_update','completion_concern']);
    for (const kind of contract.requestKinds) expect(project(fixture(kind.id), fixture(kind.id))).toMatchObject({requestedKind: kind.id, resultState: kind.resultState, reasonCode: kind.reasonCode, fixedLabel: kind.fixedLabel, responseEvidenceCreated: false, taskCreated: false, messageCreated: false, externalEffectCreated: false});
  });

  test('binds every Mission22 appointment pin and Mission23 completion pin to the exact source proof', () => {
    const central = fixture(); central.targetSourceBinding.timeZone = 'America/Chicago'; bindSourceProof(central); seal(central); expect(project(central, copy(central)).targetRecordId).toBe(uuid(10));
    const mutations = [value => { value.targetSourceBinding.tenantId = uuid(99); }, value => { value.targetSourceBinding.targetRevision += 1; }, value => { value.targetSourceBinding.targetDigest = digest(99); }, value => { value.targetSourceBinding.appointmentStatus = 'cancelled'; }, value => { value.targetSourceBinding.scheduledStart = '2026-10-29T15:00:00.000000Z'; }, value => { value.targetSourceBinding.timeZone = 'America/Chicago'; }, value => { value.targetSourceBinding.eventKind = 'appointment_schedule_effective'; }, value => { value.targetSourceBinding.snapshotDigest = digest(99); }, value => { value.targetSourceBinding.currentnessState = 'stale'; }];
    for (const mutation of mutations) { const trusted = fixture(); const candidate = copy(trusted); mutation(candidate); seal(candidate); expect(() => project(candidate, trusted)).toThrow(); }
    for (const mutation of [value => { value.targetSourceBinding.executionId = uuid(99); }, value => { value.targetSourceBinding.assignmentId = uuid(99); }, value => { value.targetSourceBinding.assignmentRevision += 1; }, value => { value.targetSourceBinding.lifecycleState = 'reopened'; }, value => { value.targetSourceBinding.eventKind = 'work_reopened'; }]) { const trusted = fixture('completion_concern'); const candidate = copy(trusted); mutation(candidate); seal(candidate); expect(() => project(candidate, trusted)).toThrow(); }
  });

  test('requires exact recent source observation and denies stale mixed unavailable or ambiguous lineage', () => {
    const threshold = fixture(); threshold.targetSourceBinding.observedAt = '2026-10-29T12:00:00.000000Z'; threshold.targetSourceBinding.eventTime = threshold.targetSourceBinding.observedAt; bindSourceProof(threshold); seal(threshold); expect(project(threshold, copy(threshold)).lineageState).toBe('original_exact_current');
    for (const mutation of [value => { value.targetSourceBinding.observedAt = '2026-10-29T11:59:59.999999Z'; }, value => { value.targetSourceBinding.observedAt = '2026-10-29T12:05:00.000001Z'; }, value => { value.targetSourceBinding.currentnessState = 'mixed'; }, value => { value.targetSourceBinding.lineageState = 'tombstoned'; }]) { const candidate = fixture(); mutation(candidate); bindSourceProof(candidate); seal(candidate); expect(() => project(candidate, copy(candidate))).toThrow(); }
  });

  test('accepts only a coherent exact corrected successor and advances immutable current projection', () => {
    const history = new History(); const original = fixture(); const first = history.record(original, copy(original)); const corrected = correctedSuccessor(original); const second = history.record(corrected, copy(corrected));
    expect(first).toMatchObject({targetRevision: 5, lineageState: 'original_exact_current', pendingCommunicationMutationCreated: false}); expect(second).toMatchObject({targetRevision: 6, lineageState: 'corrected_successor_exact_current', pendingCommunicationMutationCreated: false});
    for (const mutation of [value => { value.targetSourceBinding.predecessorRecordRevision -= 1; }, value => { value.targetSourceBinding.predecessorRecordDigest = digest(99); }, value => { value.targetSourceBinding.predecessorSnapshotId = uuid(99); }, value => { value.targetSourceBinding.targetRevision += 1; }, value => { value.targetSourceBinding.targetDigest = value.targetSourceBinding.predecessorRecordDigest; }, value => { value.correctionBinding.affectedPendingCount = 1; }, value => { value.correctionBinding.rebuiltPendingCount = 1; }]) { const candidate = correctedSuccessor(original); mutation(candidate); bindSourceProof(candidate); seal(candidate); const isolated = new History(); isolated.record(original, copy(original)); expect(() => isolated.record(candidate, copy(candidate))).toThrow(); }
  });

  test('requires the corrected successor to name the exact latest immutable predecessor', () => {
    const history = new History(); const original = fixture(); history.record(original, copy(original)); const graft = correctedSuccessor(original); graft.targetSourceBinding.predecessorRecordDigest = digest(99); bindSourceProof(graft); seal(graft); expect(() => history.record(graft, copy(graft))).toThrow('predecessor');
  });

  test('denies fabricated response evidence pending communication task alert notification and source mutation', () => {
    for (const mutation of [value => { value.responseEvidenceBinding.state = 'authenticated'; }, value => { value.responseEvidenceBinding.responseEventId = uuid(90); }, value => { value.responseEvidenceBinding.responseKind = 'question'; }, value => { value.responseEvidenceBinding.rawBodyRetained = true; }, value => { value.pendingCommunicationBinding.pendingCount = 1; }, value => { value.pendingCommunicationBinding.communicationRequestId = uuid(90); }, value => { value.handoffBinding.responseEvidenceRecordId = uuid(90); }, value => { value.handoffBinding.ownerStaffTaskId = uuid(91); }, value => { value.handoffBinding.internalAlertId = uuid(92); }, value => { value.handoffBinding.boundedResponseEvidenceCreated = true; }, value => { value.handoffBinding.ownerStaffTaskCreated = true; }]) { const candidate = fixture(); mutation(candidate); seal(candidate); expect(() => project(candidate, copy(candidate))).toThrow(); }
  });

  test('denies cross-actor same-tenant substitution inactive authority and oversized requests', () => {
    for (const mutation of [value => { value.actorAuthorityBinding.sessionSubjectActorId = uuid(90); }, value => { value.actorAuthorityBinding.membershipSubjectActorId = uuid(91); }, value => { value.actorAuthorityBinding.membershipTenantId = uuid(99); }, value => { value.actorAuthorityBinding.sessionState = 'revoked'; }, value => { value.actorAuthorityBinding.membershipRoleId = 'admin'; }]) { const candidate = fixture(); mutation(candidate); seal(candidate); expect(() => project(candidate, copy(candidate))).toThrow('actor'); }
    const oversized = fixture(); oversized.handoffBinding.state = 'x'.repeat(contract.bounds.maximumCanonicalRequestBytes); seal(oversized); expect(() => project(oversized, copy(oversized))).toThrow('identity');
  });

  test('uses stable semantic idempotency and denies clone or conflicting replay reuse', () => {
    const history = new History(); const first = fixture(); expect(history.record(first, copy(first)).replayed).toBe(false); expect(history.record(copy(first), copy(first)).replayed).toBe(true);
    const clone = copy(first); clone.resolutionId = uuid(99); clone.evaluatedAt = '2026-10-29T12:08:00.000000Z'; seal(clone); expect(clone.idempotencyKeyDigest).toBe(first.idempotencyKeyDigest); expect(() => history.record(clone, copy(clone))).toThrow('clone');
    const conflict = copy(first); conflict.evaluatedAt = '2026-10-29T12:08:00.000000Z'; seal(conflict); expect(() => history.record(conflict, copy(conflict))).toThrow('identity conflict');
  });

  test('rejects extra missing accessor symbol proxy toJSON custom-prototype sparse and alias data before hooks', () => {
    for (const mutation of [value => { value.extra = 'x'; }, value => { delete value.requestDigest; }, value => { value.targetSourceBinding.toJSON = () => ({}); }, value => { Object.setPrototypeOf(value.targetSourceBinding, {}); }, value => { value.responseEvidenceBinding = value.targetSourceBinding; }]) { const candidate = fixture(); mutation(candidate); expect(() => project(candidate, fixture())).toThrow(); }
    let getters = 0; const accessor = fixture(); Object.defineProperty(accessor.targetSourceBinding, 'targetState', {enumerable: true, get() { getters += 1; return 'scheduled'; }}); expect(() => project(accessor, fixture())).toThrow(); expect(getters).toBe(0);
    const symbol = fixture(); symbol[Symbol('secret')] = 'sk_secret'; expect(() => project(symbol, fixture())).toThrow();
    let traps = 0; const proxy = new Proxy(fixture(), {get() { traps += 1; throw new Error('trap'); }, ownKeys() { traps += 1; throw new Error('trap'); }}); expect(() => project(proxy, fixture())).toThrow(); expect(traps).toBe(0);
    const sparse = fixture(); sparse.extraArray = []; sparse.extraArray[1] = 'x'; expect(() => project(sparse, fixture())).toThrow();
  });

  test('uses fixed nonreflective labels and produces zero records messages mutations or effects', () => {
    for (const item of contract.requestKinds) expect(item.fixedLabel).not.toMatch(/@|phone|token|sk_|customerName|workerName|location|access code|description|note|concern text|urgent/i);
    for (const key of Object.keys(contract.privacyAndEffects)) expect(contract.privacyAndEffects[key]).toBe(0);
    for (const kind of contract.requestKinds) { const output = project(fixture(kind.id), fixture(kind.id)); for (const key of ['responseEvidenceCreated','worklistRecordCreated','taskCreated','internalAlertCreated','notificationCreated','messageCreated','providerAttemptCreated','pendingCommunicationMutationCreated','Mission22MutationCreated','Mission23MutationCreated','externalEffectCreated','upstreamMutationCreated','moneyEffectCreated']) expect(output[key]).toBe(false); }
  });

  test('freezes docs-tests-only boundary with migration287 latest and no288', () => {
    expect(contract.runtimeBoundary).toMatchObject({newMigration: false, newTableFunctionRouteOrUi: false, authenticatedInboundReceiver: false, responseEvidenceStoreOrTaskCreator: false, Mission22ScheduleAssignmentDispatchOrAppointmentMutation: false, Mission23WorkCompletionEvidenceOrReopeningMutation: false, nextMigrationAbsent: '288'});
    const migrations = fs.readdirSync(path.join(ROOT, 'migrations')).filter(name => /^\d+_/.test(name)).sort(); expect(migrations.at(-1)).toBe('287_canonical_automation_estimate_quote_resolution_v1.sql'); expect(migrations.some(name => name.startsWith('288_'))).toBe(false);
  });

  test('roadmap and ledger record Part10C released Part10D candidate and later slices planned', () => {
    const roadmap = fs.readFileSync(ROADMAP, 'utf8'); const ledger = fs.readFileSync(LEDGER, 'utf8'); const markdown = fs.readFileSync(CONTRACT_MD, 'utf8');
    for (const document of [roadmap, ledger]) { expect(document).toContain('Parts 1A–10C are released. Part 10D is the sole implementation candidate.'); expect(document).toContain('Parts 11A–14G remain planned and unimplemented.'); expect(document).toContain('348c9f4ea829e04478b89bc4a5f7a733a1fb1f19'); expect(document).toContain('762653d73dc88ecfd77c14d0bb66382fa15669c7'); expect(document).toMatch(/direct applied(?: migration)?-history re-query.*unavailable/i); }
    expect(ledger).toContain('| 43 | 10C | Exact customer-safe work-state communication | **Released** |'); expect(ledger).toContain('| 44 | 10D | Response handoff and source correction cancellation | **Implementation candidate** |'); expect((ledger.match(/\*\*Implementation candidate\*\*/g) || [])).toHaveLength(1); expect((ledger.match(/Planned \/ unimplemented/g) || [])).toHaveLength(22); expect(markdown).toContain('Migration 287 remains latest and migration 288 is absent.');
  });
});
