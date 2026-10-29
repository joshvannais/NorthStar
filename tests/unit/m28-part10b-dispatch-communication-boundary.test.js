'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {types: {isProxy}} = require('util');

const ROOT = path.resolve(__dirname, '../..');
const CONTRACT_PATH = path.join(ROOT, 'docs/architecture/MISSION_28_PART10B_DISPATCH_COMMUNICATION_BOUNDARY_CONTRACT.json');
const CONTRACT_MD = path.join(ROOT, 'docs/architecture/MISSION_28_PART10B_DISPATCH_COMMUNICATION_BOUNDARY_CONTRACT.md');
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

function canonicalTimeZone(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 100) return false;
  try { return new Intl.DateTimeFormat('en-US', {timeZone: value}).resolvedOptions().timeZone === value; } catch (_) { return false; }
}

function materialOf(input) { const value = copy(input); delete value.resolutionId; delete value.materialDigest; delete value.idempotencyKeyDigest; delete value.requestDigest; return value; }
function idempotencyMaterialOf(input) { const value = materialOf(input); delete value.evaluatedAt; return value; }
function requestOf(input) { const value = copy(input); delete value.materialDigest; delete value.idempotencyKeyDigest; delete value.requestDigest; return value; }
function appointmentIdentityOf(input) { return {tenantId: input.tenantId, appointmentId: input.appointmentBinding.appointmentId}; }
function appointmentPinsOf(input) { const v = input.appointmentBinding; return {appointmentRevision: v.appointmentRevision, appointmentDigest: v.appointmentDigest, appointmentStatus: v.appointmentStatus, scheduledStart: v.scheduledStart, scheduledEnd: v.scheduledEnd, timeZone: v.timeZone, sourceEventKind: v.sourceEventKind, eventTime: v.eventTime}; }
function assignmentIdentityOf(input) { const v = input.assignmentDispatchBinding; return {tenantId: input.tenantId, appointmentId: v.appointmentId, assignmentId: v.assignmentId}; }
function assignmentPinsOf(input) { const v = input.assignmentDispatchBinding; return {assignmentRevision: v.assignmentRevision, assignmentDigest: v.assignmentDigest, appointmentStatus: v.appointmentStatus, targetState: v.targetState, targetKind: v.targetKind, targetId: v.targetId, scheduleState: v.scheduleState, dispatchState: v.dispatchState, scheduledStart: v.scheduledStart, scheduledEnd: v.scheduledEnd, sourceEventKind: v.sourceEventKind, eventTime: v.eventTime}; }

function bindSourceProof(input) {
  input.appointmentBinding.sourceRecordIdentityDigest = hash({namespace: 'mission28.part4b.record-identity.v1', value: appointmentIdentityOf(input)});
  input.appointmentBinding.sourceCurrentnessPinsDigest = hash({namespace: 'mission28.part4b.currentness-pins.v1', value: appointmentPinsOf(input)});
  input.assignmentDispatchBinding.sourceRecordIdentityDigest = hash({namespace: 'mission28.part4b.record-identity.v1', value: assignmentIdentityOf(input)});
  input.assignmentDispatchBinding.sourceCurrentnessPinsDigest = hash({namespace: 'mission28.part4b.currentness-pins.v1', value: assignmentPinsOf(input)});
}

function seal(input) {
  input.materialDigest = hash(materialOf(input));
  input.idempotencyKeyDigest = hash({namespace: 'mission28.part10b.dispatch-communication-boundary-idempotency.v1', material: idempotencyMaterialOf(input)});
  input.requestDigest = hash(requestOf(input));
  return input;
}

function fixture(requestedKind = 'dispatch_notice') {
  const cancellation = requestedKind === 'appointment_cancellation_notice';
  const unsupported = ['on_the_way_notice', 'delay_notice', 'arrival_window_notice'].includes(requestedKind);
  const input = {
    schemaVersion: 'mission28.part10b.dispatch-communication-boundary.v1', tenantId: uuid(1), resolutionId: uuid(2), requestedKind,
    appointmentBinding: {
      tenantId: uuid(1), appointmentId: uuid(10), sourceTriggerId: 'm22.appointment_state', sourceRecordIdentityDigest: digest(11), sourceCurrentnessPinsDigest: digest(12), appointmentRevision: cancellation ? 8 : 7, appointmentDigest: cancellation ? digest(18) : digest(17), appointmentStatus: cancellation ? 'cancelled' : 'scheduled', scheduledStart: '2026-10-30T14:00:00.000000Z', scheduledEnd: '2026-10-30T15:00:00.000000Z', timeZone: 'America/New_York', sourceEventKind: cancellation ? 'appointment_state_changed' : 'appointment_schedule_effective', eventTime: cancellation ? '2026-10-29T12:03:00.000000Z' : '2026-10-30T14:00:00.000000Z', observedAt: '2026-10-29T12:04:00.000000Z', appointmentSnapshotId: uuid(13), appointmentSnapshotDigest: digest(13), assignmentSnapshotId: uuid(14), assignmentSnapshotDigest: digest(14), sourceSetDigest: digest(15), currentnessResolutionId: uuid(16), currentnessResolutionDigest: digest(16), currentnessState: 'latest_exact_current'
    },
    assignmentDispatchBinding: {
      tenantId: uuid(1), appointmentId: uuid(10), sourceTriggerId: 'm22.assignment_dispatch_state', sourceRecordIdentityDigest: digest(21), sourceCurrentnessPinsDigest: digest(22), assignmentId: uuid(20), assignmentRevision: cancellation ? 10 : 9, assignmentDigest: cancellation ? digest(30) : digest(29), appointmentStatus: cancellation ? 'cancelled' : 'scheduled', targetState: 'assigned', targetKind: 'profile', targetId: uuid(23), scheduleState: 'scheduled', dispatchState: cancellation ? 'revoked' : 'dispatched', scheduledStart: '2026-10-30T14:00:00.000000Z', scheduledEnd: '2026-10-30T15:00:00.000000Z', sourceEventKind: 'assignment_state_changed', eventTime: cancellation ? '2026-10-29T12:03:00.000000Z' : '2026-10-29T12:02:00.000000Z', observedAt: '2026-10-29T12:04:00.000000Z', assignmentSnapshotId: uuid(14), assignmentSnapshotDigest: digest(14), sourceSetDigest: digest(15), currentnessResolutionId: uuid(16), currentnessResolutionDigest: digest(16), currentnessState: 'latest_exact_current'
    },
    operationalSignalBinding: {
      state: cancellation ? 'exact_cancellation_fact' : unsupported ? 'unavailable_no_exact_Mission22_source' : 'exact_dispatch_fact',
      dispatchFactAvailable: !cancellation && !unsupported,
      cancellationFactAvailable: cancellation,
      onTheWayFactAvailable: false,
      delayFactAvailable: false,
      arrivalWindowFactAvailable: false,
      travelOrRouteEvidenceAvailable: false
    },
    workerPrivacyBinding: {disclosureState: 'withheld_private_worker_and_location_data', fixedLabel: contract.decisionContract.fixedWorkerLabel, workerNameIncluded: false, workerContactIncluded: false, locationIncluded: false, coordinatesIncluded: false, routeIncluded: false, etaIncluded: false},
    launchMatrixBinding: {contractDigest: `sha256:${contract.frozenInputs.find(item => item.path.endsWith('PART1D_FIRST_LAUNCH_MATRIX.json')).normalizedLfSha256.toLowerCase()}`, actionFamily: 'customer_communication', firstLaunchState: 'unavailable', acceptedSourceClassCount: 0, acceptedRoleCount: 0, acceptedCapabilityCount: 0, acceptedChannelCount: 0, acceptedRecipientClassCount: 0, externalEffectsEnabled: false},
    communicationBasisBinding: {contractDigest: `sha256:${contract.frozenInputs.find(item => item.path.endsWith('PART7B_COMMUNICATION_PERMISSION_CONTRACT.json')).normalizedLfSha256.toLowerCase()}`, externalResult: 'always_unavailable_or_suppressed_until_a_later_explicitly_accepted_launch_matrix_legal_provider_channel_and_effect_authority', permissionResolutionId: null, permissionResolutionDigest: null, permissionBasisState: 'unavailable_no_accepted_external_basis', channelId: null, providerMode: 'provider_disabled'},
    actorAuthorityBinding: {actorId: uuid(30), sessionId: uuid(31), membershipId: uuid(32), sessionSubjectActorId: uuid(30), membershipSubjectActorId: uuid(30), actorTenantId: uuid(1), sessionTenantId: uuid(1), membershipTenantId: uuid(1), actorState: 'active', sessionState: 'active', membershipState: 'active', membershipRoleId: 'owner', capabilityId: 'automation_internal_action_view', capabilityDecisionId: uuid(33), capabilityDecisionDigest: digest(33)},
    evaluatedAt: '2026-10-29T12:05:00.000000Z', materialDigest: digest(90), idempotencyKeyDigest: digest(91), requestDigest: digest(92)
  };
  bindSourceProof(input);
  return seal(input);
}

function validateSourceTimes(source, evaluatedAt) {
  const observed = utcMicros(source.observedAt); const evaluated = utcMicros(evaluatedAt); const event = utcMicros(source.eventTime);
  if (observed === null || evaluated === null || event === null || observed > evaluated || evaluated - observed > BigInt(contract.bounds.maximumSourceObservationAgeSeconds) * 1000000n) throw new Error('source currentness');
}

function validate(input, trusted) {
  dataGate(input); dataGate(trusted);
  exactKeys(input, contract.resolutionEnvelope.exactFields);
  exactKeys(input.appointmentBinding, contract.resolutionEnvelope.appointmentBindingExactFields);
  exactKeys(input.assignmentDispatchBinding, contract.resolutionEnvelope.assignmentDispatchBindingExactFields);
  exactKeys(input.operationalSignalBinding, contract.resolutionEnvelope.operationalSignalBindingExactFields);
  exactKeys(input.workerPrivacyBinding, contract.resolutionEnvelope.workerPrivacyBindingExactFields);
  exactKeys(input.launchMatrixBinding, contract.resolutionEnvelope.launchMatrixBindingExactFields);
  exactKeys(input.communicationBasisBinding, contract.resolutionEnvelope.communicationBasisBindingExactFields);
  exactKeys(input.actorAuthorityBinding, contract.resolutionEnvelope.actorAuthorityBindingExactFields);
  if (input.schemaVersion !== contract.contractVersion || !UUID.test(input.tenantId) || !UUID.test(input.resolutionId) || utcMicros(input.evaluatedAt) === null) throw new Error('identity');
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > contract.bounds.maximumCanonicalRequestBytes) throw new Error('request bound');
  const kind = contract.requestKinds.find(item => item.id === input.requestedKind); if (!kind) throw new Error('kind');
  if (JSON.stringify(materialOf(input)) !== JSON.stringify(materialOf(trusted))) throw new Error('trusted material');
  const appointment = input.appointmentBinding; const assignment = input.assignmentDispatchBinding;
  for (const value of [appointment.tenantId, appointment.appointmentId, appointment.appointmentSnapshotId, appointment.assignmentSnapshotId, appointment.currentnessResolutionId, assignment.tenantId, assignment.appointmentId, assignment.assignmentId, assignment.targetId, assignment.assignmentSnapshotId, assignment.currentnessResolutionId]) if (!UUID.test(value)) throw new Error('source identity');
  for (const value of [appointment.sourceRecordIdentityDigest, appointment.sourceCurrentnessPinsDigest, appointment.appointmentDigest, appointment.appointmentSnapshotDigest, appointment.assignmentSnapshotDigest, appointment.sourceSetDigest, appointment.currentnessResolutionDigest, assignment.sourceRecordIdentityDigest, assignment.sourceCurrentnessPinsDigest, assignment.assignmentDigest, assignment.assignmentSnapshotDigest, assignment.sourceSetDigest, assignment.currentnessResolutionDigest]) if (!DIGEST.test(value)) throw new Error('source digest');
  if (appointment.tenantId !== input.tenantId || assignment.tenantId !== input.tenantId || assignment.appointmentId !== appointment.appointmentId || appointment.sourceTriggerId !== 'm22.appointment_state' || assignment.sourceTriggerId !== 'm22.assignment_dispatch_state' || !Number.isSafeInteger(appointment.appointmentRevision) || appointment.appointmentRevision < 1 || !Number.isSafeInteger(assignment.assignmentRevision) || assignment.assignmentRevision < 1 || !['preferred', 'scheduled', 'cancelled', 'completed'].includes(appointment.appointmentStatus) || !canonicalTimeZone(appointment.timeZone)) throw new Error('source binding');
  if (appointment.sourceRecordIdentityDigest !== hash({namespace: 'mission28.part4b.record-identity.v1', value: appointmentIdentityOf(input)}) || appointment.sourceCurrentnessPinsDigest !== hash({namespace: 'mission28.part4b.currentness-pins.v1', value: appointmentPinsOf(input)}) || assignment.sourceRecordIdentityDigest !== hash({namespace: 'mission28.part4b.record-identity.v1', value: assignmentIdentityOf(input)}) || assignment.sourceCurrentnessPinsDigest !== hash({namespace: 'mission28.part4b.currentness-pins.v1', value: assignmentPinsOf(input)})) throw new Error('source proof');
  if (appointment.assignmentSnapshotId !== assignment.assignmentSnapshotId || appointment.assignmentSnapshotDigest !== assignment.assignmentSnapshotDigest || appointment.sourceSetDigest !== assignment.sourceSetDigest || appointment.currentnessResolutionId !== assignment.currentnessResolutionId || appointment.currentnessResolutionDigest !== assignment.currentnessResolutionDigest || appointment.currentnessState !== 'latest_exact_current' || assignment.currentnessState !== 'latest_exact_current') throw new Error('source currentness');
  if (appointment.scheduledStart !== assignment.scheduledStart || appointment.scheduledEnd !== assignment.scheduledEnd) throw new Error('schedule');
  if (assignment.scheduleState === 'scheduled' && (utcMicros(appointment.scheduledStart) === null || utcMicros(appointment.scheduledEnd) === null || utcMicros(appointment.scheduledEnd) <= utcMicros(appointment.scheduledStart))) throw new Error('schedule');
  if (assignment.scheduleState === 'unscheduled' && (appointment.scheduledStart !== null || appointment.scheduledEnd !== null)) throw new Error('schedule');
  validateSourceTimes(appointment, input.evaluatedAt); validateSourceTimes(assignment, input.evaluatedAt);
  if (!['appointment_state_changed', 'appointment_schedule_effective'].includes(appointment.sourceEventKind) || !['assignment_state_changed', 'assignment_schedule_effective'].includes(assignment.sourceEventKind)) throw new Error('event');
  if (appointment.sourceEventKind === 'appointment_schedule_effective' && (appointment.appointmentStatus !== 'scheduled' || appointment.eventTime !== appointment.scheduledStart)) throw new Error('appointment event');
  if (assignment.sourceEventKind === 'assignment_schedule_effective' && (assignment.appointmentStatus !== 'scheduled' || assignment.eventTime !== assignment.scheduledStart)) throw new Error('assignment event');
  if (appointment.sourceEventKind === 'appointment_state_changed' && utcMicros(appointment.eventTime) > utcMicros(appointment.observedAt)) throw new Error('appointment event');
  if (assignment.sourceEventKind === 'assignment_state_changed' && utcMicros(assignment.eventTime) > utcMicros(assignment.observedAt)) throw new Error('assignment event');
  if (assignment.targetState !== 'assigned' || !['profile', 'crew'].includes(assignment.targetKind) || !contract.decisionContract.scheduleStateVocabulary.includes(assignment.scheduleState) || !contract.decisionContract.dispatchStateVocabulary.includes(assignment.dispatchState) || assignment.appointmentStatus !== appointment.appointmentStatus) throw new Error('assignment state');
  const signal = input.operationalSignalBinding;
  const falseSignals = [signal.onTheWayFactAvailable, signal.delayFactAvailable, signal.arrivalWindowFactAvailable, signal.travelOrRouteEvidenceAvailable].every(value => value === false);
  if (!falseSignals) throw new Error('unsupported source claim');
  if (input.requestedKind === 'dispatch_notice' && (appointment.appointmentStatus !== 'scheduled' || assignment.scheduleState !== 'scheduled' || assignment.dispatchState !== 'dispatched' || signal.state !== 'exact_dispatch_fact' || signal.dispatchFactAvailable !== true || signal.cancellationFactAvailable !== false)) throw new Error('dispatch fact');
  if (input.requestedKind === 'appointment_cancellation_notice' && (appointment.appointmentStatus !== 'cancelled' || appointment.sourceEventKind !== 'appointment_state_changed' || signal.state !== 'exact_cancellation_fact' || signal.dispatchFactAvailable !== false || signal.cancellationFactAvailable !== true)) throw new Error('cancellation fact');
  if (['on_the_way_notice', 'delay_notice', 'arrival_window_notice'].includes(input.requestedKind) && (appointment.appointmentStatus !== 'scheduled' || assignment.scheduleState !== 'scheduled' || signal.state !== 'unavailable_no_exact_Mission22_source' || signal.dispatchFactAvailable !== false || signal.cancellationFactAvailable !== false)) throw new Error('unsupported fact');
  const privacy = input.workerPrivacyBinding;
  if (privacy.disclosureState !== 'withheld_private_worker_and_location_data' || privacy.fixedLabel !== contract.decisionContract.fixedWorkerLabel || [privacy.workerNameIncluded, privacy.workerContactIncluded, privacy.locationIncluded, privacy.coordinatesIncluded, privacy.routeIncluded, privacy.etaIncluded].some(value => value !== false)) throw new Error('privacy');
  const launch = input.launchMatrixBinding;
  if (launch.contractDigest !== `sha256:${contract.frozenInputs.find(item => item.path.endsWith('PART1D_FIRST_LAUNCH_MATRIX.json')).normalizedLfSha256.toLowerCase()}` || launch.actionFamily !== 'customer_communication' || launch.firstLaunchState !== 'unavailable' || [launch.acceptedSourceClassCount, launch.acceptedRoleCount, launch.acceptedCapabilityCount, launch.acceptedChannelCount, launch.acceptedRecipientClassCount].some(value => value !== 0) || launch.externalEffectsEnabled !== false) throw new Error('launch');
  const basis = input.communicationBasisBinding;
  if (basis.contractDigest !== `sha256:${contract.frozenInputs.find(item => item.path.endsWith('PART7B_COMMUNICATION_PERMISSION_CONTRACT.json')).normalizedLfSha256.toLowerCase()}` || basis.externalResult !== 'always_unavailable_or_suppressed_until_a_later_explicitly_accepted_launch_matrix_legal_provider_channel_and_effect_authority' || basis.permissionResolutionId !== null || basis.permissionResolutionDigest !== null || basis.permissionBasisState !== 'unavailable_no_accepted_external_basis' || basis.channelId !== null || basis.providerMode !== 'provider_disabled') throw new Error('communication basis');
  const actor = input.actorAuthorityBinding;
  if ([actor.actorId, actor.sessionId, actor.membershipId, actor.sessionSubjectActorId, actor.membershipSubjectActorId, actor.actorTenantId, actor.sessionTenantId, actor.membershipTenantId, actor.capabilityDecisionId].some(value => !UUID.test(value)) || !DIGEST.test(actor.capabilityDecisionDigest) || actor.actorId !== actor.sessionSubjectActorId || actor.actorId !== actor.membershipSubjectActorId || [actor.actorTenantId, actor.sessionTenantId, actor.membershipTenantId].some(value => value !== input.tenantId) || [actor.actorState, actor.sessionState, actor.membershipState].some(value => value !== 'active') || actor.membershipRoleId !== 'owner' || actor.capabilityId !== 'automation_internal_action_view') throw new Error('actor');
  if (!DIGEST.test(input.materialDigest) || !DIGEST.test(input.idempotencyKeyDigest) || !DIGEST.test(input.requestDigest) || input.materialDigest !== hash(materialOf(input)) || input.idempotencyKeyDigest !== hash({namespace: 'mission28.part10b.dispatch-communication-boundary-idempotency.v1', material: idempotencyMaterialOf(input)}) || input.requestDigest !== hash(requestOf(input))) throw new Error('digest');
  return kind;
}

function project(input, trusted) {
  const kind = validate(input, trusted);
  return Object.freeze({resolutionId: input.resolutionId, tenantId: input.tenantId, requestedKind: input.requestedKind, appointmentId: input.appointmentBinding.appointmentId, assignmentId: input.assignmentDispatchBinding.assignmentId, sourceCurrentnessState: 'latest_exact_current', workerLabel: contract.decisionContract.fixedWorkerLabel, resultState: kind.resultState, reasonCode: kind.reasonCode, fixedLabel: kind.fixedLabel, ownerReadableProjectionOnly: true, worklistRecordCreated: false, taskCreated: false, notificationCreated: false, messageCreated: false, providerAttemptCreated: false, schedulingMutationCreated: false, assignmentMutationCreated: false, dispatchMutationCreated: false, routeMutationCreated: false, appointmentMutationCreated: false, externalEffectCreated: false, upstreamMutationCreated: false, moneyEffectCreated: false});
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

describe('Mission 28 Part 10B dispatch communication boundary', () => {
  test('binds exact Part10A release provenance and frozen controlling inputs', () => {
    expect(contract.authority).toMatchObject({part: '10B', state: 'implementation_candidate_only', baselineCommit: '9b0ecc3ccf21fcf997971e2c9fe12df71c413331', baselineTree: '41739ae3b11042110cd7d2b01838b8b0ea8ac58d'});
    expect(contract.part10ARelease).toMatchObject({acceptedSourceHead: '954057afa821de5db94469bca13f37855978e82d', pullRequest: 589, deployment: '23aec085-588a-4593-9220-afdff6e62bdc', runningInstance: 'a654a18b-73aa-4905-883c-48eeaadeb21c', imageSha256: '55303e99920f1d102ac2333c29ec66f5f1d2c91b837c05d25b34f21a894dc913'});
    for (const item of contract.frozenInputs) expect(digestLf(item.path)).toBe(item.normalizedLfSha256);
  });

  test('uses a closed request order and fixed truthful no-effect results', () => {
    expect(contract.requestKinds.map(item => item.id)).toEqual(contract.decisionContract.closedKindOrder);
    for (const requestedKind of contract.decisionContract.closedKindOrder) {
      const input = fixture(requestedKind); const output = project(input, copy(input));
      expect(output).toMatchObject({requestedKind, resultState: contract.requestKinds.find(item => item.id === requestedKind).resultState, ownerReadableProjectionOnly: true, messageCreated: false, externalEffectCreated: false});
    }
  });

  test('requires exact current dispatched Mission22 state for dispatch notice', () => {
    for (const mutation of [value => { value.assignmentDispatchBinding.dispatchState = 'not_dispatched'; }, value => { value.assignmentDispatchBinding.dispatchState = 'revoked'; }, value => { value.assignmentDispatchBinding.scheduleState = 'unscheduled'; }, value => { value.assignmentDispatchBinding.targetState = 'unassigned'; }, value => { value.appointmentBinding.appointmentStatus = 'preferred'; }]) {
      const candidate = fixture(); mutation(candidate); bindSourceProof(candidate); seal(candidate); expect(() => project(candidate, copy(candidate))).toThrow();
    }
  });

  test('requires exact cancelled current state-change fact without mutating the appointment', () => {
    const output = project(fixture('appointment_cancellation_notice'), fixture('appointment_cancellation_notice'));
    expect(output).toMatchObject({resultState: 'unavailable_no_accepted_external_authority', appointmentMutationCreated: false, schedulingMutationCreated: false});
    const stillDispatched = fixture('appointment_cancellation_notice'); stillDispatched.assignmentDispatchBinding.dispatchState = 'dispatched'; bindSourceProof(stillDispatched); seal(stillDispatched); expect(project(stillDispatched, copy(stillDispatched)).resultState).toBe('unavailable_no_accepted_external_authority');
    const unscheduled = fixture('appointment_cancellation_notice'); Object.assign(unscheduled.appointmentBinding, {scheduledStart: null, scheduledEnd: null}); Object.assign(unscheduled.assignmentDispatchBinding, {scheduleState: 'unscheduled', scheduledStart: null, scheduledEnd: null, dispatchState: 'not_dispatched'}); bindSourceProof(unscheduled); seal(unscheduled); expect(project(unscheduled, copy(unscheduled)).resultState).toBe('unavailable_no_accepted_external_authority');
    for (const mutation of [value => { value.appointmentBinding.appointmentStatus = 'scheduled'; }, value => { value.assignmentDispatchBinding.appointmentStatus = 'scheduled'; }, value => { value.appointmentBinding.sourceEventKind = 'appointment_schedule_effective'; }]) {
      const candidate = fixture('appointment_cancellation_notice'); mutation(candidate); bindSourceProof(candidate); seal(candidate); expect(() => project(candidate, copy(candidate))).toThrow();
    }
  });

  test('keeps on-the-way delay and arrival-window unavailable and never infers them', () => {
    for (const kind of ['on_the_way_notice', 'delay_notice', 'arrival_window_notice']) expect(project(fixture(kind), fixture(kind))).toMatchObject({requestedKind: kind, resultState: 'unavailable_source_fact_not_supported'});
    for (const mutation of [value => { value.operationalSignalBinding.onTheWayFactAvailable = true; }, value => { value.operationalSignalBinding.delayFactAvailable = true; }, value => { value.operationalSignalBinding.arrivalWindowFactAvailable = true; }, value => { value.operationalSignalBinding.travelOrRouteEvidenceAvailable = true; }, value => { value.operationalSignalBinding.state = 'inferred_from_dispatch'; }]) {
      const candidate = fixture('on_the_way_notice'); mutation(candidate); seal(candidate); expect(() => project(candidate, copy(candidate))).toThrow();
    }
  });

  test('binds exact appointment and assignment identities currentness pins snapshots and event selectors', () => {
    const chicago = fixture();
    Object.assign(chicago.appointmentBinding, {appointmentRevision: 8, appointmentDigest: digest(80), timeZone: 'America/Chicago', appointmentSnapshotId: uuid(80), appointmentSnapshotDigest: digest(81), assignmentSnapshotId: uuid(82), assignmentSnapshotDigest: digest(82), sourceSetDigest: digest(83), currentnessResolutionId: uuid(84), currentnessResolutionDigest: digest(84)});
    Object.assign(chicago.assignmentDispatchBinding, {assignmentSnapshotId: uuid(82), assignmentSnapshotDigest: digest(82), sourceSetDigest: digest(83), currentnessResolutionId: uuid(84), currentnessResolutionDigest: digest(84)});
    bindSourceProof(chicago); seal(chicago); expect(project(chicago, copy(chicago)).sourceCurrentnessState).toBe('latest_exact_current');
    const mutations = [value => { value.appointmentBinding.tenantId = uuid(99); }, value => { value.assignmentDispatchBinding.appointmentId = uuid(99); }, value => { value.assignmentDispatchBinding.assignmentId = uuid(99); }, value => { value.assignmentDispatchBinding.assignmentRevision += 1; }, value => { value.assignmentDispatchBinding.assignmentDigest = digest(99); }, value => { value.appointmentBinding.timeZone = 'America/Chicago'; }, value => { value.appointmentBinding.appointmentSnapshotDigest = digest(99); }, value => { value.assignmentDispatchBinding.sourceSetDigest = digest(99); }, value => { value.assignmentDispatchBinding.currentnessState = 'stale'; }, value => { value.assignmentDispatchBinding.sourceEventKind = 'assignment_schedule_effective'; }, value => { value.appointmentBinding.appointmentStatus = 'customer@example.test'; value.assignmentDispatchBinding.appointmentStatus = 'customer@example.test'; }, value => { value.appointmentBinding.timeZone = 'US/Eastern'; }];
    for (const [index, mutation] of mutations.entries()) {
      const trusted = fixture(); const candidate = copy(trusted); mutation(candidate); seal(candidate); let rejected = false; try { project(candidate, trusted); } catch (_) { rejected = true; } if (!rejected) throw new Error(`accepted source mutation ${index}`);
    }
  });

  test('enforces finite observation currentness while allowing future schedule-effective event time', () => {
    const threshold = fixture(); threshold.appointmentBinding.observedAt = '2026-10-29T12:00:00.000000Z'; threshold.assignmentDispatchBinding.observedAt = threshold.appointmentBinding.observedAt; threshold.assignmentDispatchBinding.eventTime = threshold.assignmentDispatchBinding.observedAt; bindSourceProof(threshold); seal(threshold); expect(project(threshold, copy(threshold)).sourceCurrentnessState).toBe('latest_exact_current');
    for (const observedAt of ['2026-10-29T11:59:59.999999Z', '2026-10-29T12:05:00.000001Z', 'bad']) { const candidate = fixture(); candidate.appointmentBinding.observedAt = observedAt; candidate.assignmentDispatchBinding.observedAt = observedAt; seal(candidate); expect(() => project(candidate, copy(candidate))).toThrow('source currentness'); }
  });

  test('withholds worker location route contact telemetry and ETA material', () => {
    expect(project(fixture(), fixture()).workerLabel).toBe('Assigned worker recorded — private details withheld');
    for (const mutation of [value => { value.workerPrivacyBinding.workerNameIncluded = true; }, value => { value.workerPrivacyBinding.workerContactIncluded = true; }, value => { value.workerPrivacyBinding.locationIncluded = true; }, value => { value.workerPrivacyBinding.coordinatesIncluded = true; }, value => { value.workerPrivacyBinding.routeIncluded = true; }, value => { value.workerPrivacyBinding.etaIncluded = true; }, value => { value.workerName = 'Private Worker'; }, value => { value.phone = '+15555550123'; }, value => { value.latitude = 42.1; }, value => { value.route = 'customer address'; }]) {
      const candidate = fixture(); mutation(candidate); seal(candidate); expect(() => project(candidate, copy(candidate))).toThrow();
    }
  });

  test('denies launch widening and candidate-created permission channel provider or effect authority', () => {
    for (const mutation of [value => { value.launchMatrixBinding.firstLaunchState = 'conditional'; }, value => { value.launchMatrixBinding.acceptedSourceClassCount = 1; }, value => { value.launchMatrixBinding.acceptedRecipientClassCount = 1; }, value => { value.launchMatrixBinding.externalEffectsEnabled = true; }, value => { value.communicationBasisBinding.permissionResolutionId = uuid(40); }, value => { value.communicationBasisBinding.permissionBasisState = 'owner_reviewed'; }, value => { value.communicationBasisBinding.channelId = 'sms'; }, value => { value.communicationBasisBinding.providerMode = 'sandbox'; }]) {
      const candidate = fixture(); mutation(candidate); seal(candidate); expect(() => project(candidate, copy(candidate))).toThrow();
    }
  });

  test('denies cross-actor same-tenant substitution and inactive authority', () => {
    for (const mutation of [value => { value.actorAuthorityBinding.sessionSubjectActorId = uuid(90); }, value => { value.actorAuthorityBinding.membershipSubjectActorId = uuid(91); }, value => { value.actorAuthorityBinding.membershipTenantId = uuid(99); }, value => { value.actorAuthorityBinding.sessionState = 'revoked'; }, value => { value.actorAuthorityBinding.membershipRoleId = 'admin'; }]) {
      const candidate = fixture(); mutation(candidate); seal(candidate); expect(() => project(candidate, copy(candidate))).toThrow('actor');
    }
  });

  test('uses stable semantic idempotency and invalidates exact source changes', () => {
    const history = new History(); const first = fixture(); expect(history.record(first, copy(first)).replayed).toBe(false); expect(history.record(copy(first), copy(first)).replayed).toBe(true);
    const clone = copy(first); clone.resolutionId = uuid(99); clone.evaluatedAt = '2026-10-29T12:08:00.000000Z'; seal(clone); expect(clone.idempotencyKeyDigest).toBe(first.idempotencyKeyDigest); expect(() => history.record(clone, copy(clone))).toThrow('clone');
    const conflict = copy(first); conflict.evaluatedAt = '2026-10-29T12:08:00.000000Z'; seal(conflict); expect(() => history.record(conflict, copy(conflict))).toThrow('identity conflict');
    const changed = copy(first); changed.resolutionId = uuid(98); Object.assign(changed.assignmentDispatchBinding, {assignmentRevision: 10, assignmentDigest: digest(98), assignmentSnapshotId: uuid(82), assignmentSnapshotDigest: digest(82), sourceSetDigest: digest(83), currentnessResolutionId: uuid(84), currentnessResolutionDigest: digest(84)}); Object.assign(changed.appointmentBinding, {assignmentSnapshotId: uuid(82), assignmentSnapshotDigest: digest(82), sourceSetDigest: digest(83), currentnessResolutionId: uuid(84), currentnessResolutionDigest: digest(84)}); bindSourceProof(changed); seal(changed); expect(changed.idempotencyKeyDigest).not.toBe(first.idempotencyKeyDigest); expect(history.record(changed, copy(changed)).replayed).toBe(false);
  });

  test('rejects extra missing accessor symbol proxy toJSON custom-prototype sparse and alias data before hooks', () => {
    for (const mutation of [value => { value.extra = 'x'; }, value => { delete value.requestDigest; }, value => { value.appointmentBinding.toJSON = () => ({}); }, value => { Object.setPrototypeOf(value.assignmentDispatchBinding, {}); }, value => { value.assignmentDispatchBinding = value.appointmentBinding; }]) {
      const candidate = fixture(); mutation(candidate); expect(() => project(candidate, fixture())).toThrow();
    }
    let getters = 0; const accessor = fixture(); Object.defineProperty(accessor.assignmentDispatchBinding, 'dispatchState', {enumerable: true, get() { getters += 1; return 'dispatched'; }}); expect(() => project(accessor, fixture())).toThrow(); expect(getters).toBe(0);
    const symbol = fixture(); symbol[Symbol('secret')] = 'sk_secret'; expect(() => project(symbol, fixture())).toThrow();
    let traps = 0; const proxy = new Proxy(fixture(), {get() { traps += 1; throw new Error('trap'); }, ownKeys() { traps += 1; throw new Error('trap'); }}); expect(() => project(proxy, fixture())).toThrow(); expect(traps).toBe(0);
    const sparse = fixture(); sparse.extraArray = []; sparse.extraArray[1] = 'x'; expect(() => project(sparse, fixture())).toThrow();
  });

  test('uses fixed nonreflective labels and produces zero records messages mutations or effects', () => {
    for (const item of contract.requestKinds) expect(item.fixedLabel).not.toMatch(/@|phone|token|sk_|customerName|workerName|address|route|urgent/i);
    for (const key of Object.keys(contract.privacyAndEffects)) expect(contract.privacyAndEffects[key]).toBe(0);
    for (const kind of contract.decisionContract.closedKindOrder) { const output = project(fixture(kind), fixture(kind)); for (const key of ['worklistRecordCreated', 'taskCreated', 'notificationCreated', 'messageCreated', 'providerAttemptCreated', 'schedulingMutationCreated', 'assignmentMutationCreated', 'dispatchMutationCreated', 'routeMutationCreated', 'appointmentMutationCreated', 'externalEffectCreated', 'upstreamMutationCreated', 'moneyEffectCreated']) expect(output[key]).toBe(false); }
  });

  test('freezes docs-tests-only boundary with migration287 latest and no288', () => {
    expect(contract.runtimeBoundary).toMatchObject({newMigration: false, newTableFunctionRouteOrUi: false, mountedSchedulerWorkerQueueOrPolicyExecutor: false, providerAdapterCallbackOrInboundReceiver: false, scheduleAssignmentDispatchRouteAppointmentOrLocationMutation: false, nextMigrationAbsent: '288'});
    const migrations = fs.readdirSync(path.join(ROOT, 'migrations')).filter(name => /^\d+_/.test(name)).sort(); expect(migrations.at(-1)).toBe('287_canonical_automation_estimate_quote_resolution_v1.sql'); expect(migrations.some(name => name.startsWith('288_'))).toBe(false);
  });

  test('roadmap and ledger record Part10A released Part10B candidate and Part10C plus planned', () => {
    const roadmap = fs.readFileSync(ROADMAP, 'utf8'); const ledger = fs.readFileSync(LEDGER, 'utf8'); const markdown = fs.readFileSync(CONTRACT_MD, 'utf8');
    for (const document of [roadmap, ledger]) {
      expect(document).toContain('Parts 1A–10A are released. Part 10B is the sole implementation candidate.'); expect(document).toContain('Parts 10C–14G remain planned and unimplemented.');
      expect(document).toContain('23aec085-588a-4593-9220-afdff6e62bdc'); expect(document).toContain('sha256:55303e99920f1d102ac2333c29ec66f5f1d2c91b837c05d25b34f21a894dc913');
      expect(document).toMatch(/direct applied-history re-query was not repeated|direct applied migration-history re-query was not repeated/i);
    }
    expect(ledger).toContain('| 41 | 10A | Exact appointment confirmation and reminder | **Released** |'); expect(ledger).toContain('| 42 | 10B | Exact dispatch/on-the-way/delay/cancellation communication | **Implementation candidate** |');
    expect((ledger.match(/\*\*Implementation candidate\*\*/g) || [])).toHaveLength(1); expect((ledger.match(/Planned \/ unimplemented/g) || [])).toHaveLength(24); expect(markdown).toContain('No migration 288');
  });
});
