'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {types: {isProxy}} = require('util');

const ROOT = path.resolve(__dirname, '../..');
const CONTRACT_PATH = path.join(ROOT, 'docs/architecture/MISSION_28_PART10A_APPOINTMENT_COMMUNICATION_BOUNDARY_CONTRACT.json');
const CONTRACT_MD = path.join(ROOT, 'docs/architecture/MISSION_28_PART10A_APPOINTMENT_COMMUNICATION_BOUNDARY_CONTRACT.md');
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
  const millisecondForm = `${match[1]}.${match[2].slice(0, 3)}Z`; const millis = Date.parse(millisecondForm);
  if (!Number.isFinite(millis) || new Date(millis).toISOString() !== millisecondForm) return null;
  return BigInt(millis) * 1000n + BigInt(match[2].slice(3));
}

function localParts(instant, timeZone) {
  if (utcMicros(instant) === null || typeof timeZone !== 'string' || timeZone.length === 0 || timeZone.length > 100) throw new Error('local schedule');
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'});
  } catch (_) { throw new Error('local schedule'); }
  if (formatter.resolvedOptions().timeZone !== timeZone) throw new Error('local schedule');
  const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).filter(item => item.type !== 'literal').map(item => [item.type, item.value]));
  return {date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}:${parts.second}`};
}

function materialOf(input) { const value = copy(input); delete value.resolutionId; delete value.materialDigest; delete value.idempotencyKeyDigest; delete value.requestDigest; return value; }
function idempotencyMaterialOf(input) { const value = materialOf(input); delete value.evaluatedAt; return value; }
function requestOf(input) { const value = copy(input); delete value.materialDigest; delete value.idempotencyKeyDigest; delete value.requestDigest; return value; }
function appointmentRecordIdentityOf(input) { return {tenantId: input.tenantId, appointmentId: input.appointmentBinding.appointmentId}; }
function appointmentCurrentnessPinsOf(input) { const value = input.appointmentBinding; return {appointmentRevision: value.appointmentRevision, appointmentDigest: value.appointmentDigest, appointmentStatus: value.appointmentStatus, scheduledStart: value.scheduledStart, scheduledEnd: value.scheduledEnd, timeZone: value.timeZone, sourceEventKind: value.sourceEventKind, eventTime: value.eventTime}; }
function assignmentRecordIdentityOf(input) { const value = input.assignedContactBinding; return {tenantId: input.tenantId, appointmentId: value.appointmentId, assignmentId: value.assignmentId}; }
function assignmentCurrentnessPinsOf(input) { const value = input.assignedContactBinding; return {assignmentRevision: value.assignmentRevision, assignmentDigest: value.assignmentDigest, appointmentStatus: value.appointmentStatus, sourceEventKind: value.sourceEventKind, eventTime: value.eventTime, targetState: value.targetState, targetKind: value.targetKind, targetId: value.targetId}; }
function bindSourceProof(input) {
  input.appointmentBinding.sourceRecordIdentityDigest = hash({namespace: 'mission28.part4b.record-identity.v1', value: appointmentRecordIdentityOf(input)});
  input.appointmentBinding.sourceCurrentnessPinsDigest = hash({namespace: 'mission28.part4b.currentness-pins.v1', value: appointmentCurrentnessPinsOf(input)});
  input.assignedContactBinding.sourceRecordIdentityDigest = hash({namespace: 'mission28.part4b.record-identity.v1', value: assignmentRecordIdentityOf(input)});
  input.assignedContactBinding.sourceCurrentnessPinsDigest = hash({namespace: 'mission28.part4b.currentness-pins.v1', value: assignmentCurrentnessPinsOf(input)});
  return input;
}
function seal(input) {
  input.materialDigest = hash(materialOf(input));
  input.idempotencyKeyDigest = hash({namespace: 'mission28.part10a.appointment-communication-boundary-idempotency.v1', material: idempotencyMaterialOf(input)});
  input.requestDigest = hash(requestOf(input)); return input;
}

function fixture(requestedKind = 'appointment_confirmation') {
  return seal(bindSourceProof({
    schemaVersion: contract.contractVersion, tenantId: uuid(1), resolutionId: uuid(2), requestedKind,
    appointmentBinding: {tenantId: uuid(1), appointmentId: uuid(10), sourceTriggerId: 'm22.appointment_state', sourceRecordIdentityDigest: '', sourceCurrentnessPinsDigest: '', appointmentRevision: 4, appointmentDigest: digest(10), appointmentStatus: 'scheduled', scheduledStart: '2026-10-30T14:00:00.000000Z', scheduledEnd: '2026-10-30T15:00:00.000000Z', timeZone: 'America/New_York', sourceEventKind: 'appointment_schedule_effective', eventTime: '2026-10-30T14:00:00.000000Z', observedAt: '2026-10-29T12:04:00.000000Z', appointmentSnapshotId: uuid(11), appointmentSnapshotDigest: digest(11), assignmentSnapshotId: uuid(12), assignmentSnapshotDigest: digest(12), sourceSetDigest: digest(13), currentnessResolutionId: uuid(14), currentnessResolutionDigest: digest(14), currentnessState: 'latest_exact_current'},
    assignedContactBinding: {tenantId: uuid(1), appointmentId: uuid(10), sourceTriggerId: 'm22.assignment_dispatch_state', sourceRecordIdentityDigest: '', sourceCurrentnessPinsDigest: '', assignmentId: uuid(15), assignmentRevision: 7, assignmentDigest: digest(15), appointmentStatus: 'scheduled', sourceEventKind: 'assignment_schedule_effective', eventTime: '2026-10-30T14:00:00.000000Z', observedAt: '2026-10-29T12:04:00.000000Z', assignmentSnapshotId: uuid(12), assignmentSnapshotDigest: digest(12), sourceSetDigest: digest(13), currentnessResolutionId: uuid(14), currentnessResolutionDigest: digest(14), currentnessState: 'latest_exact_current', targetState: 'assigned', targetKind: 'profile', targetId: uuid(16), contactClass: 'assigned_staff', contactDisclosureState: 'generic_customer_safe_label_only'},
    localScheduleBinding: {scheduledStart: '2026-10-30T14:00:00.000000Z', scheduledEnd: '2026-10-30T15:00:00.000000Z', timeZone: 'America/New_York', timeZoneAuthority: 'exact_Mission22_tenant_authority', timeZoneProfileId: uuid(17), timeZoneProfileVersion: 3, timeZoneProfileDigest: digest(17), localStartDate: '2026-10-30', localStartTime: '10:00:00', localEndDate: '2026-10-30', localEndTime: '11:00:00'},
    locationSafetyBinding: {disclosureState: 'withheld_no_customer_safe_location_authority', fixedLabel: contract.decisionContract.fixedLocationLabel, sourceLocationId: null, addressIncluded: false, coordinatesIncluded: false},
    launchMatrixBinding: {contractDigest: `sha256:${digestLf('docs/architecture/MISSION_28_PART1D_FIRST_LAUNCH_MATRIX.json').toLowerCase()}`, actionFamily: 'customer_communication', firstLaunchState: 'unavailable', acceptedSourceClassCount: 0, acceptedRoleCount: 0, acceptedCapabilityCount: 0, acceptedChannelCount: 0, acceptedRecipientClassCount: 0, externalEffectsEnabled: false},
    communicationBasisBinding: {contractDigest: `sha256:${digestLf('docs/architecture/MISSION_28_PART7B_COMMUNICATION_PERMISSION_CONTRACT.json').toLowerCase()}`, externalResult: 'always_unavailable_or_suppressed_until_a_later_explicitly_accepted_launch_matrix_legal_provider_channel_and_effect_authority', permissionResolutionId: null, permissionResolutionDigest: null, permissionBasisState: 'unavailable_no_accepted_external_basis', channelId: null, providerMode: 'provider_disabled'},
    actorAuthorityBinding: {actorId: uuid(20), sessionId: uuid(21), membershipId: uuid(22), sessionSubjectActorId: uuid(20), membershipSubjectActorId: uuid(20), actorTenantId: uuid(1), sessionTenantId: uuid(1), membershipTenantId: uuid(1), actorState: 'active', sessionState: 'active', membershipState: 'active', membershipRoleId: 'owner', capabilityId: 'automation_internal_action_view', capabilityDecisionId: uuid(23), capabilityDecisionDigest: digest(23)},
    evaluatedAt: '2026-10-29T12:05:00.000000Z', materialDigest: '', idempotencyKeyDigest: '', requestDigest: ''
  }));
}

function validate(input, trusted) {
  dataGate(input); dataGate(trusted);
  if (JSON.stringify(input) !== JSON.stringify(trusted)) throw new Error('trusted resolution');
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > contract.bounds.maximumCanonicalRequestBytes) throw new Error('request size');
  exactKeys(input, contract.resolutionEnvelope.exactFields); exactKeys(input.appointmentBinding, contract.resolutionEnvelope.appointmentBindingExactFields);
  exactKeys(input.assignedContactBinding, contract.resolutionEnvelope.assignedContactBindingExactFields); exactKeys(input.localScheduleBinding, contract.resolutionEnvelope.localScheduleBindingExactFields);
  exactKeys(input.locationSafetyBinding, contract.resolutionEnvelope.locationSafetyBindingExactFields); exactKeys(input.launchMatrixBinding, contract.resolutionEnvelope.launchMatrixBindingExactFields);
  exactKeys(input.communicationBasisBinding, contract.resolutionEnvelope.communicationBasisBindingExactFields); exactKeys(input.actorAuthorityBinding, contract.resolutionEnvelope.actorAuthorityBindingExactFields);
  if (input.schemaVersion !== contract.contractVersion || !UUID.test(input.tenantId) || !UUID.test(input.resolutionId)) throw new Error('root identity');
  const kind = contract.requestKinds.find(item => item.id === input.requestedKind); if (!kind) throw new Error('request kind');

  const appointment = input.appointmentBinding;
  if (appointment.tenantId !== input.tenantId || appointment.sourceTriggerId !== contract.sourceAuthorityTruth.appointmentTriggerId || appointment.appointmentStatus !== 'scheduled' || appointment.sourceEventKind !== 'appointment_schedule_effective' || appointment.eventTime !== appointment.scheduledStart || appointment.currentnessState !== 'latest_exact_current' ||
      appointment.sourceRecordIdentityDigest !== hash({namespace: 'mission28.part4b.record-identity.v1', value: appointmentRecordIdentityOf(input)}) || appointment.sourceCurrentnessPinsDigest !== hash({namespace: 'mission28.part4b.currentness-pins.v1', value: appointmentCurrentnessPinsOf(input)}) ||
      !Number.isSafeInteger(appointment.appointmentRevision) || appointment.appointmentRevision < 1 ||
      [appointment.appointmentId, appointment.appointmentSnapshotId, appointment.assignmentSnapshotId, appointment.currentnessResolutionId].some(value => !UUID.test(value)) ||
      [appointment.appointmentDigest, appointment.appointmentSnapshotDigest, appointment.assignmentSnapshotDigest, appointment.sourceSetDigest, appointment.currentnessResolutionDigest].some(value => !DIGEST.test(value))) throw new Error('appointment');
  const start = utcMicros(appointment.scheduledStart); const end = utcMicros(appointment.scheduledEnd); const observed = utcMicros(appointment.observedAt); const evaluated = utcMicros(input.evaluatedAt);
  if (start === null || end === null || end <= start || observed === null || evaluated === null || observed > evaluated || evaluated - observed > BigInt(contract.bounds.maximumAppointmentObservationAgeSeconds) * 1000000n) throw new Error('appointment currentness');

  const assignment = input.assignedContactBinding;
  if (assignment.tenantId !== input.tenantId || assignment.appointmentId !== appointment.appointmentId || assignment.sourceTriggerId !== contract.sourceAuthorityTruth.assignmentTriggerId || assignment.appointmentStatus !== appointment.appointmentStatus || assignment.sourceEventKind !== 'assignment_schedule_effective' || assignment.eventTime !== appointment.scheduledStart || assignment.observedAt !== appointment.observedAt || assignment.currentnessState !== 'latest_exact_current' ||
      assignment.assignmentSnapshotId !== appointment.assignmentSnapshotId || assignment.assignmentSnapshotDigest !== appointment.assignmentSnapshotDigest || assignment.sourceSetDigest !== appointment.sourceSetDigest || assignment.currentnessResolutionId !== appointment.currentnessResolutionId || assignment.currentnessResolutionDigest !== appointment.currentnessResolutionDigest ||
      assignment.sourceRecordIdentityDigest !== hash({namespace: 'mission28.part4b.record-identity.v1', value: assignmentRecordIdentityOf(input)}) || assignment.sourceCurrentnessPinsDigest !== hash({namespace: 'mission28.part4b.currentness-pins.v1', value: assignmentCurrentnessPinsOf(input)}) ||
      !UUID.test(assignment.assignmentId) || !UUID.test(assignment.assignmentSnapshotId) || !Number.isSafeInteger(assignment.assignmentRevision) || assignment.assignmentRevision < 1 || !DIGEST.test(assignment.assignmentDigest) || !DIGEST.test(assignment.assignmentSnapshotDigest) || !DIGEST.test(assignment.sourceSetDigest) || !UUID.test(assignment.currentnessResolutionId) || !DIGEST.test(assignment.currentnessResolutionDigest) || assignment.targetState !== 'assigned' || !['profile', 'crew'].includes(assignment.targetKind) || !UUID.test(assignment.targetId) ||
      assignment.contactClass !== (assignment.targetKind === 'profile' ? 'assigned_staff' : 'assigned_crew') || assignment.contactDisclosureState !== 'generic_customer_safe_label_only') throw new Error('assigned contact');

  const schedule = input.localScheduleBinding;
  if (schedule.scheduledStart !== appointment.scheduledStart || schedule.scheduledEnd !== appointment.scheduledEnd || schedule.timeZone !== appointment.timeZone || schedule.timeZoneAuthority !== 'exact_Mission22_tenant_authority' || !UUID.test(schedule.timeZoneProfileId) || !Number.isSafeInteger(schedule.timeZoneProfileVersion) || schedule.timeZoneProfileVersion < 1 || !DIGEST.test(schedule.timeZoneProfileDigest)) throw new Error('local schedule');
  const localStart = localParts(schedule.scheduledStart, schedule.timeZone); const localEnd = localParts(schedule.scheduledEnd, schedule.timeZone);
  if (schedule.localStartDate !== localStart.date || schedule.localStartTime !== localStart.time || schedule.localEndDate !== localEnd.date || schedule.localEndTime !== localEnd.time) throw new Error('local schedule');

  const location = input.locationSafetyBinding;
  if (location.disclosureState !== 'withheld_no_customer_safe_location_authority' || location.fixedLabel !== contract.decisionContract.fixedLocationLabel || location.sourceLocationId !== null || location.addressIncluded !== false || location.coordinatesIncluded !== false) throw new Error('location safety');
  const launch = input.launchMatrixBinding;
  if (launch.contractDigest !== `sha256:${contract.frozenInputs.find(item => item.path.endsWith('PART1D_FIRST_LAUNCH_MATRIX.json')).normalizedLfSha256.toLowerCase()}` || launch.actionFamily !== 'customer_communication' || launch.firstLaunchState !== 'unavailable' ||
      [launch.acceptedSourceClassCount, launch.acceptedRoleCount, launch.acceptedCapabilityCount, launch.acceptedChannelCount, launch.acceptedRecipientClassCount].some(value => value !== 0) || launch.externalEffectsEnabled !== false) throw new Error('launch matrix');
  const basis = input.communicationBasisBinding;
  if (basis.contractDigest !== `sha256:${contract.frozenInputs.find(item => item.path.endsWith('PART7B_COMMUNICATION_PERMISSION_CONTRACT.json')).normalizedLfSha256.toLowerCase()}` || basis.externalResult !== 'always_unavailable_or_suppressed_until_a_later_explicitly_accepted_launch_matrix_legal_provider_channel_and_effect_authority' ||
      basis.permissionResolutionId !== null || basis.permissionResolutionDigest !== null || basis.permissionBasisState !== 'unavailable_no_accepted_external_basis' || basis.channelId !== null || basis.providerMode !== 'provider_disabled') throw new Error('communication basis');
  const actor = input.actorAuthorityBinding;
  if ([actor.actorId, actor.sessionId, actor.membershipId, actor.sessionSubjectActorId, actor.membershipSubjectActorId, actor.actorTenantId, actor.sessionTenantId, actor.membershipTenantId, actor.capabilityDecisionId].some(value => !UUID.test(value)) || !DIGEST.test(actor.capabilityDecisionDigest) ||
      actor.actorId !== actor.sessionSubjectActorId || actor.actorId !== actor.membershipSubjectActorId || [actor.actorTenantId, actor.sessionTenantId, actor.membershipTenantId].some(value => value !== input.tenantId) ||
      [actor.actorState, actor.sessionState, actor.membershipState].some(value => value !== 'active') || actor.membershipRoleId !== 'owner' || actor.capabilityId !== 'automation_internal_action_view') throw new Error('actor');
  if (!DIGEST.test(input.materialDigest) || !DIGEST.test(input.idempotencyKeyDigest) || !DIGEST.test(input.requestDigest) || input.materialDigest !== hash(materialOf(input)) ||
      input.idempotencyKeyDigest !== hash({namespace: 'mission28.part10a.appointment-communication-boundary-idempotency.v1', material: idempotencyMaterialOf(input)}) || input.requestDigest !== hash(requestOf(input))) throw new Error('digest');
  return kind;
}

function project(input, trusted) {
  const kind = validate(input, trusted);
  return Object.freeze({resolutionId: input.resolutionId, tenantId: input.tenantId, requestedKind: input.requestedKind, appointmentId: input.appointmentBinding.appointmentId, appointmentCurrentnessState: 'latest_exact_current', assignedContactLabel: contract.decisionContract.fixedAssignedContactLabel,
    localSchedule: Object.freeze({startDate: input.localScheduleBinding.localStartDate, startTime: input.localScheduleBinding.localStartTime, endDate: input.localScheduleBinding.localEndDate, endTime: input.localScheduleBinding.localEndTime, timeZone: input.localScheduleBinding.timeZone}),
    locationLabel: contract.decisionContract.fixedLocationLabel, resultState: kind.resultState, reasonCode: kind.reasonCode, fixedLabel: kind.fixedLabel, ownerReadableProjectionOnly: true,
    ownerWorklistRecordCreated: false, taskCreated: false, notificationCreated: false, messageCreated: false, providerAttemptCreated: false, schedulingMutationCreated: false, assignmentMutationCreated: false, dispatchMutationCreated: false, routeMutationCreated: false, externalEffectCreated: false, upstreamMutationCreated: false, moneyEffectCreated: false});
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

describe('Mission 28 Part 10A appointment communication boundary', () => {
  test('binds exact Part9D release provenance and frozen controlling contracts', () => {
    expect(contract.authority).toMatchObject({part: '10A', state: 'implementation_candidate_only', baselineCommit: 'f76f1b15aa30b253a94524043a3334d171c0b3cd', baselineTree: '02f3ea4e81ee44cf9488aa9f3428b692cbde139f'});
    expect(contract.part9DRelease).toMatchObject({acceptedSourceHead: 'ae6f78d9a6a52eff829a5c168b063cd309af19cc', pullRequest: 588, deployment: '3bf5403d-0b8a-46be-965d-ec2814dc4484', runningInstance: 'ac03974b-e43a-40de-92b4-d70cdb5c3416', imageSha256: 'adb66d539e6dfe1b32dd6b83a0fef63582c39795cbd85fe7fe001499c4871596'});
    for (const item of contract.frozenInputs) expect(digestLf(item.path)).toBe(item.normalizedLfSha256);
  });

  test('keeps confirmation and reminder fixed unavailable despite exact current scheduled facts', () => {
    expect(contract.requestKinds.map(item => item.id)).toEqual(contract.decisionContract.closedKindOrder);
    for (const requestedKind of contract.decisionContract.closedKindOrder) expect(project(fixture(requestedKind), fixture(requestedKind))).toMatchObject({requestedKind, resultState: 'unavailable_no_accepted_external_authority', appointmentCurrentnessState: 'latest_exact_current', ownerReadableProjectionOnly: true, messageCreated: false, externalEffectCreated: false});
  });

  test('binds exact scheduled appointment and denies status revision digest interval event or currentness substitution', () => {
    for (const mutation of [value => { value.appointmentBinding.tenantId = uuid(99); }, value => { value.appointmentBinding.appointmentStatus = 'cancelled'; }, value => { value.appointmentBinding.appointmentStatus = 'completed'; },
      value => { value.appointmentBinding.appointmentRevision = 0; }, value => { value.appointmentBinding.appointmentDigest = 'bad'; }, value => { value.appointmentBinding.scheduledEnd = value.appointmentBinding.scheduledStart; },
      value => { value.appointmentBinding.sourceEventKind = 'appointment_state_changed'; }, value => { value.appointmentBinding.eventTime = '2026-10-30T13:00:00.000000Z'; }, value => { value.appointmentBinding.currentnessState = 'stale'; }]) {
      const candidate = fixture(); mutation(candidate); seal(candidate); expect(() => project(candidate, copy(candidate))).toThrow();
    }
  });

  test('enforces bounded observation currentness while allowing future schedule-effective event time', () => {
    const threshold = fixture(); threshold.appointmentBinding.observedAt = '2026-10-29T12:00:00.000000Z'; threshold.assignedContactBinding.observedAt = threshold.appointmentBinding.observedAt; seal(threshold); expect(project(threshold, copy(threshold)).localSchedule.startDate).toBe('2026-10-30');
    for (const observedAt of ['2026-10-29T11:59:59.999999Z', '2026-10-29T12:05:00.000001Z', 'bad']) { const candidate = fixture(); candidate.appointmentBinding.observedAt = observedAt; candidate.assignedContactBinding.observedAt = observedAt; seal(candidate); expect(() => project(candidate, copy(candidate))).toThrow('appointment currentness'); }
  });

  test('binds assigned profile or crew without exposing private contact values', () => {
    expect(project(fixture(), fixture()).assignedContactLabel).toBe('Assigned contact recorded — private details withheld');
    const crew = fixture(); Object.assign(crew.assignedContactBinding, {assignmentRevision: 8, assignmentDigest: digest(80), targetKind: 'crew', targetId: uuid(81), contactClass: 'assigned_crew', assignmentSnapshotId: uuid(82), assignmentSnapshotDigest: digest(82), sourceSetDigest: digest(83), currentnessResolutionId: uuid(84), currentnessResolutionDigest: digest(84)}); Object.assign(crew.appointmentBinding, {assignmentSnapshotId: uuid(82), assignmentSnapshotDigest: digest(82), sourceSetDigest: digest(83), currentnessResolutionId: uuid(84), currentnessResolutionDigest: digest(84)}); bindSourceProof(crew); seal(crew); expect(project(crew, copy(crew)).assignedContactLabel).toBe(contract.decisionContract.fixedAssignedContactLabel);
    for (const mutation of [value => { value.assignedContactBinding.tenantId = uuid(99); }, value => { value.assignedContactBinding.appointmentId = uuid(99); }, value => { value.assignedContactBinding.sourceTriggerId = 'm22.appointment_state'; }, value => { value.assignedContactBinding.targetState = 'unassigned'; }, value => { value.assignedContactBinding.targetKind = 'user'; }, value => { value.assignedContactBinding.targetId = null; }, value => { value.assignedContactBinding.contactClass = 'customer'; }, value => { value.assignedContactBinding.contactDisclosureState = 'raw_contact'; }]) {
      const candidate = fixture(); mutation(candidate); seal(candidate); expect(() => project(candidate, copy(candidate))).toThrow('assigned contact');
    }
  });

  test('derives exact local time from canonical tenant IANA zone without inference or alias', () => {
    const output = project(fixture(), fixture()); expect(output.localSchedule).toEqual({startDate: '2026-10-30', startTime: '10:00:00', endDate: '2026-10-30', endTime: '11:00:00', timeZone: 'America/New_York'});
    const retarget = fixture(); Object.assign(retarget.localScheduleBinding, {timeZone: 'America/Chicago', localStartTime: '09:00:00', localEndTime: '10:00:00'}); seal(retarget); expect(() => project(retarget, copy(retarget))).toThrow('local schedule');
    for (const zone of ['US/Eastern', 'EST', 'UTC+04:00', '', 'Not/AZone']) { const candidate = fixture(); candidate.localScheduleBinding.timeZone = zone; seal(candidate); expect(() => project(candidate, copy(candidate))).toThrow('local schedule'); }
  });

  test('denies local date time zone or schedule substitution after recomputing digests', () => {
    for (const mutation of [value => { value.localScheduleBinding.scheduledStart = '2026-10-30T16:00:00.000000Z'; }, value => { value.localScheduleBinding.localStartDate = '2026-10-31'; }, value => { value.localScheduleBinding.localStartTime = '11:00:00'; }, value => { value.localScheduleBinding.timeZoneAuthority = 'browser'; }, value => { value.localScheduleBinding.timeZoneProfileId = 'bad'; }, value => { value.localScheduleBinding.timeZoneProfileVersion = 0; }, value => { value.localScheduleBinding.timeZoneProfileDigest = 'bad'; }]) {
      const candidate = fixture(); mutation(candidate); seal(candidate); expect(() => project(candidate, copy(candidate))).toThrow('local schedule');
    }
  });

  test('denies valid-looking appointment time-zone and assignment retargets with unchanged snapshots or currentness', () => {
    const zone = fixture(); zone.appointmentBinding.timeZone = 'America/Chicago'; Object.assign(zone.localScheduleBinding, {timeZone: 'America/Chicago', localStartTime: '09:00:00', localEndTime: '10:00:00'}); seal(zone); expect(() => project(zone, copy(zone))).toThrow('appointment');
    for (const mutation of [value => { value.assignedContactBinding.assignmentId = uuid(80); }, value => { value.assignedContactBinding.assignmentRevision = 8; }, value => { value.assignedContactBinding.assignmentDigest = digest(80); }, value => { value.assignedContactBinding.targetId = uuid(81); }, value => { value.assignedContactBinding.eventTime = '2026-10-30T14:01:00.000000Z'; }]) {
      const candidate = fixture(); mutation(candidate); seal(candidate); expect(() => project(candidate, copy(candidate))).toThrow('assigned contact');
    }
  });

  test('withholds location and rejects address coordinate access and route material', () => {
    expect(project(fixture(), fixture()).locationLabel).toBe('Location details unavailable — verify before communication');
    for (const mutation of [value => { value.locationSafetyBinding.sourceLocationId = uuid(70); }, value => { value.locationSafetyBinding.addressIncluded = true; }, value => { value.locationSafetyBinding.coordinatesIncluded = true; },
      value => { value.locationSafetyBinding.fixedLabel = '123 Customer Street'; }, value => { value.address = '123 Customer Street'; }, value => { value.latitude = 42.1; }, value => { value.accessInstructions = 'gate code 1234'; }]) {
      const candidate = fixture(); mutation(candidate); seal(candidate); expect(() => project(candidate, copy(candidate))).toThrow();
    }
  });

  test('denies launch widening and candidate-created permission channel or provider authority', () => {
    for (const mutation of [value => { value.launchMatrixBinding.firstLaunchState = 'conditional'; }, value => { value.launchMatrixBinding.acceptedSourceClassCount = 1; }, value => { value.launchMatrixBinding.acceptedRecipientClassCount = 1; },
      value => { value.launchMatrixBinding.externalEffectsEnabled = true; }, value => { value.communicationBasisBinding.permissionResolutionId = uuid(40); }, value => { value.communicationBasisBinding.permissionBasisState = 'owner_reviewed_reported_basis_unverified'; },
      value => { value.communicationBasisBinding.channelId = 'email'; }, value => { value.communicationBasisBinding.providerMode = 'sandbox'; }]) {
      const candidate = fixture(); mutation(candidate); seal(candidate); expect(() => project(candidate, copy(candidate))).toThrow();
    }
  });

  test('denies cross-actor same-tenant substitution and inactive authority', () => {
    for (const mutation of [value => { value.actorAuthorityBinding.sessionSubjectActorId = uuid(90); }, value => { value.actorAuthorityBinding.membershipSubjectActorId = uuid(91); }, value => { value.actorAuthorityBinding.membershipTenantId = uuid(99); }, value => { value.actorAuthorityBinding.sessionState = 'revoked'; }, value => { value.actorAuthorityBinding.membershipRoleId = 'admin'; }]) {
      const candidate = fixture(); mutation(candidate); seal(candidate); expect(() => project(candidate, copy(candidate))).toThrow('actor');
    }
  });

  test('uses stable semantic idempotency and invalidates exact appointment or assignment changes', () => {
    const history = new History(); const first = fixture(); expect(history.record(first, copy(first)).replayed).toBe(false); expect(history.record(copy(first), copy(first)).replayed).toBe(true);
    const clone = copy(first); clone.resolutionId = uuid(99); clone.evaluatedAt = '2026-10-29T12:08:00.000000Z'; seal(clone); expect(clone.idempotencyKeyDigest).toBe(first.idempotencyKeyDigest); expect(() => history.record(clone, copy(clone))).toThrow('clone');
    const conflict = copy(first); conflict.evaluatedAt = '2026-10-29T12:08:00.000000Z'; seal(conflict); expect(() => history.record(conflict, copy(conflict))).toThrow('identity conflict');
    const changed = copy(first); changed.resolutionId = uuid(98); changed.appointmentBinding.appointmentRevision += 1; changed.appointmentBinding.appointmentDigest = digest(98); seal(changed); expect(changed.idempotencyKeyDigest).not.toBe(first.idempotencyKeyDigest);
  });

  test('rejects extra missing accessor symbol proxy toJSON custom-prototype sparse and alias data before hooks', () => {
    for (const mutation of [value => { value.extra = 'x'; }, value => { delete value.requestDigest; }, value => { value.appointmentBinding.toJSON = () => ({}); }, value => { Object.setPrototypeOf(value.assignedContactBinding, {}); }, value => { value.localScheduleBinding = value.appointmentBinding; }]) {
      const candidate = fixture(); mutation(candidate); expect(() => project(candidate, fixture())).toThrow();
    }
    let getters = 0; const accessor = fixture(); Object.defineProperty(accessor.appointmentBinding, 'appointmentStatus', {enumerable: true, get() { getters += 1; return 'scheduled'; }}); expect(() => project(accessor, fixture())).toThrow(); expect(getters).toBe(0);
    const symbol = fixture(); symbol[Symbol('secret')] = 'sk_secret'; expect(() => project(symbol, fixture())).toThrow();
    let traps = 0; const proxy = new Proxy(fixture(), {get() { traps += 1; throw new Error('trap'); }, ownKeys() { traps += 1; throw new Error('trap'); }}); expect(() => project(proxy, fixture())).toThrow(); expect(traps).toBe(0);
    const sparse = fixture(); sparse.extraArray = []; sparse.extraArray[1] = 'x'; expect(() => project(sparse, fixture())).toThrow();
  });

  test('uses fixed nonreflective labels and produces zero records messages scheduling mutations or effects', () => {
    for (const item of contract.requestKinds) expect(item.fixedLabel).not.toMatch(/@|phone|token|sk_|customerName|address|urgent/i);
    for (const key of Object.keys(contract.privacyAndEffects)) expect(contract.privacyAndEffects[key]).toBe(0);
    for (const kind of contract.decisionContract.closedKindOrder) { const output = project(fixture(kind), fixture(kind)); for (const key of ['ownerWorklistRecordCreated', 'taskCreated', 'notificationCreated', 'messageCreated', 'providerAttemptCreated', 'schedulingMutationCreated', 'assignmentMutationCreated', 'dispatchMutationCreated', 'routeMutationCreated', 'externalEffectCreated', 'upstreamMutationCreated', 'moneyEffectCreated']) expect(output[key]).toBe(false); }
  });

  test('freezes docs-tests-only boundary with migration287 latest and no288', () => {
    expect(contract.runtimeBoundary).toMatchObject({newMigration: false, newTableFunctionRouteOrUi: false, mountedSchedulerWorkerQueueOrPolicyExecutor: false, providerAdapterCallbackOrInboundReceiver: false, scheduleAssignmentDispatchRouteOrLocationMutation: false, nextMigrationAbsent: '288'});
    const migrations = fs.readdirSync(path.join(ROOT, 'migrations')).filter(name => /^\d+_/.test(name)).sort(); expect(migrations.at(-1)).toBe('287_canonical_automation_estimate_quote_resolution_v1.sql'); expect(migrations.some(name => name.startsWith('288_'))).toBe(false);
  });

  test('roadmap and ledger record Part9D released Part10A candidate and Part10B plus planned', () => {
    const roadmap = fs.readFileSync(ROADMAP, 'utf8'); const ledger = fs.readFileSync(LEDGER, 'utf8'); const markdown = fs.readFileSync(CONTRACT_MD, 'utf8');
    for (const document of [roadmap, ledger]) {
      expect(document).toContain('Parts 1A–11E are released. Part 11F is the sole implementation candidate.'); expect(document).toContain('Parts 12A–14G remain planned and unimplemented.');
      expect(document).toContain('3bf5403d-0b8a-46be-965d-ec2814dc4484'); expect(document).toContain('sha256:adb66d539e6dfe1b32dd6b83a0fef63582c39795cbd85fe7fe001499c4871596');
      expect(document).toMatch(/direct applied-history re-query was not repeated|direct applied migration-history re-query was not repeated/i);
    }
    expect(ledger).toContain('| 40 | 9D | Explicitly reviewed customer re-engagement boundary | **Released** |'); expect(ledger).toContain('| 41 | 10A | Exact appointment confirmation and reminder | **Released** |'); expect(ledger).toContain('| 42 | 10B | Exact dispatch/on-the-way/delay/cancellation communication | **Released** |'); expect(ledger).toContain('| 43 | 10C | Exact customer-safe work-state communication | **Released** |');
    expect((ledger.match(/\*\*Implementation candidate\*\*/g) || [])).toHaveLength(1); expect((ledger.match(/Planned \/ unimplemented/g) || [])).toHaveLength(16); expect(markdown).toContain('No migration 288');
  });
});
