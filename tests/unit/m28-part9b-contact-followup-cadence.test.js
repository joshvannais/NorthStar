'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {types: {isProxy}} = require('util');

const ROOT = path.resolve(__dirname, '../..');
const CONTRACT_PATH = path.join(ROOT, 'docs/architecture/MISSION_28_PART9B_CONTACT_FOLLOWUP_CADENCE_CONTRACT.json');
const CONTRACT_MD = path.join(ROOT, 'docs/architecture/MISSION_28_PART9B_CONTACT_FOLLOWUP_CADENCE_CONTRACT.md');
const ROADMAP = path.join(ROOT, 'docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md');
const LEDGER = path.join(ROOT, 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md');
const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8'));
const part7B = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/architecture/MISSION_28_PART7B_COMMUNICATION_PERMISSION_CONTRACT.json'), 'utf8'));
const part7F = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/architecture/MISSION_28_PART7F_DELIVERY_EVIDENCE_CONTRACT.json'), 'utf8'));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const UTC = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$/;
const copy = value => JSON.parse(JSON.stringify(value));
const hash = value => `sha256:${crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
const digestLf = relative => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, relative), 'utf8').replace(/\r\n/g, '\n')).digest('hex').toUpperCase();

function dataGate(value, seen = new WeakSet()) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return;
  if (typeof value !== 'object' || isProxy(value) || seen.has(value)) throw new Error('plain data');
  seen.add(value);
  const proto = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    const keys = Reflect.ownKeys(value);
    if (proto !== Array.prototype || keys.some(key => key !== 'length' && !/^(0|[1-9][0-9]*)$/.test(key)) ||
        keys.filter(key => key !== 'length').length !== value.length) throw new Error('dense array');
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

function materialOf(input) {
  const value = copy(input); delete value.cadenceResolutionId; delete value.materialDigest; delete value.idempotencyKeyDigest; delete value.requestDigest; return value;
}
function idempotencyMaterialOf(input) { const value = materialOf(input); delete value.evaluatedAt; return value; }
function requestOf(input) { const value = copy(input); delete value.materialDigest; delete value.idempotencyKeyDigest; delete value.requestDigest; return value; }
function seal(input) {
  input.materialDigest = hash(materialOf(input));
  input.idempotencyKeyDigest = hash({namespace: 'mission28.part9b.contact-followup-cadence-idempotency.v1', material: idempotencyMaterialOf(input)});
  input.requestDigest = hash(requestOf(input)); return input;
}

function sourceBinding() {
  return {
    tenantId: '00000000-0000-4000-8000-000000000001', triggerId: 'm20.lead_contact_state', recordIdentityDigest: `sha256:${'20'.repeat(32)}`,
    snapshotId: '00000000-0000-4000-8000-000000000021', snapshotDigest: `sha256:${'21'.repeat(32)}`, sourceSetDigest: `sha256:${'22'.repeat(32)}`,
    currentnessResolutionId: '00000000-0000-4000-8000-000000000023', currentnessResolutionDigest: `sha256:${'23'.repeat(32)}`, currentnessState: 'latest_exact_current',
    evaluationId: '00000000-0000-4000-8000-000000000024', evaluationOutputDigest: `sha256:${'24'.repeat(32)}`, evaluationResult: 'eligible'
  };
}

function part9ABinding() {
  return {
    tenantId: '00000000-0000-4000-8000-000000000001', resolutionId: '00000000-0000-4000-8000-000000000025', materialDigest: `sha256:${'25'.repeat(32)}`, sourceSetDigest: `sha256:${'22'.repeat(32)}`,
    actionUnitId: '00000000-0000-4000-8000-000000000028', actionUnitDigest: `sha256:${'28'.repeat(32)}`,
    customerAcknowledgementState: 'unavailable_customer_acknowledgement_no_external_authority', internalAlertState: 'ready_internal_alert_no_effect'
  };
}

function actorBinding() {
  return {
    actorId: '00000000-0000-4000-8000-000000000010', sessionId: '00000000-0000-4000-8000-000000000011', membershipId: '00000000-0000-4000-8000-000000000012',
    sessionSubjectActorId: '00000000-0000-4000-8000-000000000010', membershipSubjectActorId: '00000000-0000-4000-8000-000000000010',
    actorTenantId: '00000000-0000-4000-8000-000000000001', sessionTenantId: '00000000-0000-4000-8000-000000000001', membershipTenantId: '00000000-0000-4000-8000-000000000001',
    actorState: 'active', sessionState: 'active', membershipState: 'active', membershipRoleId: 'owner', capabilityId: 'automation_internal_action_prepare',
    capabilityDecisionId: '00000000-0000-4000-8000-000000000013', capabilityDecisionDigest: `sha256:${'13'.repeat(32)}`
  };
}

function permissionBinding(state = 'unavailable') {
  return {
    tenantId: '00000000-0000-4000-8000-000000000001', sourceSetDigest: `sha256:${'22'.repeat(32)}`,
    actionUnitId: '00000000-0000-4000-8000-000000000028', actionUnitDigest: `sha256:${'28'.repeat(32)}`,
    recipientResolutionId: '00000000-0000-4000-8000-000000000030', recipientResolutionDigest: `sha256:${'30'.repeat(32)}`,
    recipientClassId: 'lead_or_prospect', permissionResolutionId: '00000000-0000-4000-8000-000000000031', permissionResolutionDigest: `sha256:${'31'.repeat(32)}`,
    permissionRecipientResolutionDigest: `sha256:${'30'.repeat(32)}`, channelId: 'email', permissionResultState: state, providerMode: 'provider_disabled'
  };
}

function frequencyBinding(state = 'clear', attempts = 0) {
  return {
    tenantId: '00000000-0000-4000-8000-000000000001', sourceSetDigest: `sha256:${'22'.repeat(32)}`,
    actionUnitId: '00000000-0000-4000-8000-000000000028', actionUnitDigest: `sha256:${'28'.repeat(32)}`,
    cadencePolicyId: '00000000-0000-4000-8000-000000000040', cadencePolicyDigest: `sha256:${'40'.repeat(32)}`, attemptCeiling: 3,
    attemptWindowSeconds: 604800, minimumIntervalSeconds: 86400, attemptsInWindow: attempts,
    lastAcceptedAttemptAt: attempts === 0 ? null : '2026-10-27T12:00:00.000000Z', nextAttemptNotBefore: attempts === 0 ? null : '2026-10-28T12:00:00.000000Z',
    cadenceExpiresAt: '2026-11-11T12:05:00.000000Z', observedAt: '2026-10-28T12:04:00.000000Z',
    state, resolutionDigest: `sha256:${'41'.repeat(32)}`
  };
}

function quietHoursBinding(state = 'unavailable') {
  return {
    tenantId: '00000000-0000-4000-8000-000000000001', calendarId: '00000000-0000-4000-8000-000000000050', calendarVersion: 1, calendarDigest: `sha256:${'50'.repeat(32)}`,
    tenantTimeZone: 'America/Chicago', state, observedAt: '2026-10-28T12:04:00.000000Z',
    nextAllowedAt: ['inside_quiet_hours', 'holiday_closed'].includes(state) ? '2026-10-28T14:00:00.000000Z' : null,
    resolutionDigest: `sha256:${'51'.repeat(32)}`
  };
}

function collisionBinding(resultState = 'selected_no_effect', reasonCode = 'selected_no_effect') {
  return {
    tenantId: '00000000-0000-4000-8000-000000000001', sourceSetDigest: `sha256:${'22'.repeat(32)}`,
    actionUnitId: '00000000-0000-4000-8000-000000000028', actionUnitDigest: `sha256:${'28'.repeat(32)}`,
    analysisId: '00000000-0000-4000-8000-000000000060', asOf: '2026-10-28T12:04:00.000000Z', inputDigest: `sha256:${'60'.repeat(32)}`,
    outputDigest: `sha256:${'61'.repeat(32)}`, resultState, reasonCode
  };
}

function responseBinding() {
  return {
    tenantId: '00000000-0000-4000-8000-000000000001', sourceSetDigest: `sha256:${'22'.repeat(32)}`, actionUnitId: '00000000-0000-4000-8000-000000000028', actionUnitDigest: `sha256:${'28'.repeat(32)}`,
    deliveryEvidenceResolutionId: '00000000-0000-4000-8000-000000000070', deliveryEvidenceResolutionDigest: `sha256:${'70'.repeat(32)}`,
    replyState: 'unavailable_no_authenticated_inbound', optOutState: 'unavailable_no_authenticated_inbound', strongestClaim: 'none', state: 'no_accepted_response_evidence'
  };
}

function fixture() {
  return seal({
    schemaVersion: 'mission28.part9b.contact-followup-cadence.v1', tenantId: '00000000-0000-4000-8000-000000000001', cadenceResolutionId: '00000000-0000-4000-8000-000000000002',
    sourceBinding: sourceBinding(), part9AResolutionBinding: part9ABinding(), actorAuthorityBinding: actorBinding(), channelPermissionBinding: permissionBinding(),
    frequencyBinding: frequencyBinding(), quietHoursBinding: quietHoursBinding(), collisionBinding: collisionBinding(), responseEvidenceBinding: responseBinding(),
    evaluatedAt: '2026-10-28T12:05:00.000000Z', materialDigest: '', idempotencyKeyDigest: '', requestDigest: ''
  });
}

function canonicalTimeZone(value) {
  try { return new Intl.DateTimeFormat('en-US', {timeZone: value}).resolvedOptions().timeZone === value; } catch { return false; }
}

function utcMillis(value) {
  const micros = utcMicros(value);
  return micros === null ? NaN : Number(micros / 1000n);
}

function utcMicros(value) {
  const match = typeof value === 'string' ? /^([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2})\.([0-9]{6})Z$/.exec(value) : null;
  if (!match) return null;
  const millisecondForm = `${match[1]}.${match[2].slice(0, 3)}Z`; const millis = Date.parse(millisecondForm);
  if (!Number.isFinite(millis) || new Date(millis).toISOString() !== millisecondForm) return null;
  return BigInt(millis) * 1000n + BigInt(match[2].slice(3));
}

function requireFresh(observedAt, evaluatedAt) {
  const observed = utcMicros(observedAt); const evaluated = utcMicros(evaluatedAt);
  if (observed === null || evaluated === null || observed > evaluated ||
      evaluated - observed > BigInt(contract.bounds.maximumResolutionObservationAgeSeconds) * 1000000n) throw new Error('stale resolution');
}

function validate(input, trusted) {
  dataGate(input); dataGate(trusted);
  if (JSON.stringify(input) !== JSON.stringify(trusted)) throw new Error('trusted resolution');
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > contract.bounds.maximumCanonicalRequestBytes) throw new Error('request size');
  exactKeys(input, contract.resolutionEnvelope.exactFields);
  for (const [value, keys] of [[input.sourceBinding, contract.resolutionEnvelope.sourceBindingExactFields], [input.part9AResolutionBinding, contract.resolutionEnvelope.part9AResolutionBindingExactFields],
    [input.actorAuthorityBinding, contract.resolutionEnvelope.actorAuthorityBindingExactFields], [input.channelPermissionBinding, contract.resolutionEnvelope.channelPermissionBindingExactFields],
    [input.frequencyBinding, contract.resolutionEnvelope.frequencyBindingExactFields], [input.quietHoursBinding, contract.resolutionEnvelope.quietHoursBindingExactFields],
    [input.collisionBinding, contract.resolutionEnvelope.collisionBindingExactFields], [input.responseEvidenceBinding, contract.resolutionEnvelope.responseEvidenceBindingExactFields]]) exactKeys(value, keys);
  if (input.schemaVersion !== contract.contractVersion) throw new Error('schema');

  const uuidValues = [input.tenantId, input.cadenceResolutionId, input.sourceBinding.tenantId, input.sourceBinding.snapshotId, input.sourceBinding.currentnessResolutionId, input.sourceBinding.evaluationId,
    input.part9AResolutionBinding.tenantId, input.part9AResolutionBinding.resolutionId, input.part9AResolutionBinding.actionUnitId, input.actorAuthorityBinding.actorId, input.actorAuthorityBinding.sessionId, input.actorAuthorityBinding.membershipId,
    input.actorAuthorityBinding.sessionSubjectActorId, input.actorAuthorityBinding.membershipSubjectActorId, input.actorAuthorityBinding.actorTenantId,
    input.actorAuthorityBinding.sessionTenantId, input.actorAuthorityBinding.membershipTenantId, input.actorAuthorityBinding.capabilityDecisionId,
    input.channelPermissionBinding.tenantId, input.channelPermissionBinding.actionUnitId, input.channelPermissionBinding.recipientResolutionId, input.channelPermissionBinding.permissionResolutionId,
    input.frequencyBinding.tenantId, input.frequencyBinding.actionUnitId, input.frequencyBinding.cadencePolicyId, input.quietHoursBinding.tenantId, input.quietHoursBinding.calendarId,
    input.collisionBinding.tenantId, input.collisionBinding.actionUnitId, input.collisionBinding.analysisId, input.responseEvidenceBinding.tenantId,
    input.responseEvidenceBinding.actionUnitId, input.responseEvidenceBinding.deliveryEvidenceResolutionId];
  if (uuidValues.some(value => !UUID.test(value))) throw new Error('uuid');
  const digests = [input.sourceBinding.recordIdentityDigest, input.sourceBinding.snapshotDigest, input.sourceBinding.sourceSetDigest, input.sourceBinding.currentnessResolutionDigest,
    input.sourceBinding.evaluationOutputDigest, input.part9AResolutionBinding.materialDigest, input.part9AResolutionBinding.sourceSetDigest, input.part9AResolutionBinding.actionUnitDigest,
    input.actorAuthorityBinding.capabilityDecisionDigest, input.channelPermissionBinding.sourceSetDigest, input.channelPermissionBinding.actionUnitDigest,
    input.channelPermissionBinding.recipientResolutionDigest, input.channelPermissionBinding.permissionResolutionDigest, input.channelPermissionBinding.permissionRecipientResolutionDigest,
    input.frequencyBinding.sourceSetDigest, input.frequencyBinding.actionUnitDigest, input.frequencyBinding.cadencePolicyDigest, input.frequencyBinding.resolutionDigest,
    input.quietHoursBinding.calendarDigest, input.quietHoursBinding.resolutionDigest, input.collisionBinding.sourceSetDigest, input.collisionBinding.actionUnitDigest,
    input.collisionBinding.inputDigest, input.collisionBinding.outputDigest, input.responseEvidenceBinding.actionUnitDigest,
    input.responseEvidenceBinding.sourceSetDigest, input.responseEvidenceBinding.deliveryEvidenceResolutionDigest, input.materialDigest, input.idempotencyKeyDigest, input.requestDigest];
  if (digests.some(value => !DIGEST.test(value))) throw new Error('digest');
  if (!Number.isFinite(utcMillis(input.evaluatedAt))) throw new Error('time');

  const source = input.sourceBinding;
  if (source.tenantId !== input.tenantId || source.triggerId !== 'm20.lead_contact_state' || source.currentnessState !== 'latest_exact_current' || source.evaluationResult !== 'eligible') throw new Error('source');
  const part9A = input.part9AResolutionBinding;
  if (part9A.tenantId !== input.tenantId || part9A.sourceSetDigest !== source.sourceSetDigest || part9A.customerAcknowledgementState !== contract.exactCurrentAuthority.part9A.customerAcknowledgementState ||
      part9A.internalAlertState !== contract.exactCurrentAuthority.part9A.internalAlertState) throw new Error('Part9A');

  const actor = input.actorAuthorityBinding;
  if (actor.actorId !== actor.sessionSubjectActorId || actor.actorId !== actor.membershipSubjectActorId ||
      [actor.actorTenantId, actor.sessionTenantId, actor.membershipTenantId].some(value => value !== input.tenantId) ||
      [actor.actorState, actor.sessionState, actor.membershipState].some(value => value !== 'active') || actor.membershipRoleId !== 'owner' || actor.capabilityId !== 'automation_internal_action_prepare') throw new Error('actor');

  const permission = input.channelPermissionBinding;
  const permittedStates = contract.exactCurrentAuthority.channelPermission.currentAcceptedStates;
  if (permission.tenantId !== input.tenantId || permission.sourceSetDigest !== source.sourceSetDigest || permission.actionUnitId !== part9A.actionUnitId ||
      permission.actionUnitDigest !== part9A.actionUnitDigest || permission.permissionRecipientResolutionDigest !== permission.recipientResolutionDigest ||
      permission.recipientClassId !== 'lead_or_prospect' || !contract.exactCurrentAuthority.channelPermission.channelIds.includes(permission.channelId) ||
      !permittedStates.includes(permission.permissionResultState) || permission.providerMode !== 'provider_disabled' ||
      !part7B.resolution.resultStates.includes(permission.permissionResultState)) throw new Error('permission');

  const frequency = input.frequencyBinding;
  for (const key of ['attemptCeiling', 'attemptWindowSeconds', 'minimumIntervalSeconds', 'attemptsInWindow']) if (!Number.isSafeInteger(frequency[key]) || frequency[key] < 0) throw new Error('frequency number');
  if (frequency.tenantId !== input.tenantId || frequency.sourceSetDigest !== source.sourceSetDigest || frequency.actionUnitId !== part9A.actionUnitId || frequency.actionUnitDigest !== part9A.actionUnitDigest ||
      frequency.attemptCeiling !== contract.bounds.attemptCeiling || frequency.attemptWindowSeconds !== contract.bounds.attemptWindowSeconds ||
      frequency.minimumIntervalSeconds !== contract.bounds.minimumIntervalSeconds || frequency.attemptsInWindow > frequency.attemptCeiling ||
      !contract.frequencyContract.states.includes(frequency.state) || !Number.isFinite(utcMillis(frequency.cadenceExpiresAt)) ||
      utcMillis(frequency.cadenceExpiresAt) <= utcMillis(input.evaluatedAt) || utcMillis(frequency.cadenceExpiresAt) - utcMillis(input.evaluatedAt) > contract.bounds.cadenceHorizonSeconds * 1000) throw new Error('frequency');
  requireFresh(frequency.observedAt, input.evaluatedAt);
  if ((frequency.attemptsInWindow === 0) !== (frequency.lastAcceptedAttemptAt === null) || (frequency.attemptsInWindow === 0) !== (frequency.nextAttemptNotBefore === null)) throw new Error('attempt evidence');
  if (frequency.lastAcceptedAttemptAt !== null) {
    const lastAttempt = utcMicros(frequency.lastAcceptedAttemptAt); const nextAttempt = utcMicros(frequency.nextAttemptNotBefore); const evaluated = utcMicros(input.evaluatedAt);
    if (lastAttempt === null || nextAttempt === null || evaluated === null || lastAttempt > evaluated ||
        lastAttempt < evaluated - BigInt(frequency.attemptWindowSeconds) * 1000000n ||
        nextAttempt !== lastAttempt + BigInt(frequency.minimumIntervalSeconds) * 1000000n) throw new Error('attempt time');
  }
  if ((frequency.state === 'limit_reached') !== (frequency.attemptsInWindow === frequency.attemptCeiling) ||
      (frequency.state === 'clear' && (frequency.attemptsInWindow >= frequency.attemptCeiling || (frequency.nextAttemptNotBefore !== null && frequency.nextAttemptNotBefore > input.evaluatedAt))) ||
      (frequency.state === 'minimum_interval_active' && (frequency.attemptsInWindow === 0 || frequency.attemptsInWindow >= frequency.attemptCeiling || frequency.nextAttemptNotBefore <= input.evaluatedAt))) throw new Error('frequency state');

  const quiet = input.quietHoursBinding;
  if (quiet.tenantId !== input.tenantId || !Number.isSafeInteger(quiet.calendarVersion) || quiet.calendarVersion < 1 || !canonicalTimeZone(quiet.tenantTimeZone) ||
      !contract.quietHoursContract.states.includes(quiet.state)) throw new Error('quiet hours');
  requireFresh(quiet.observedAt, input.evaluatedAt);
  const closed = ['inside_quiet_hours', 'holiday_closed'].includes(quiet.state);
  if (closed !== (quiet.nextAllowedAt !== null) || (quiet.nextAllowedAt !== null && (!Number.isFinite(utcMillis(quiet.nextAllowedAt)) || utcMillis(quiet.nextAllowedAt) <= utcMillis(input.evaluatedAt)))) throw new Error('next allowed');

  const collision = input.collisionBinding;
  if (collision.tenantId !== input.tenantId || collision.sourceSetDigest !== source.sourceSetDigest || collision.actionUnitId !== part9A.actionUnitId ||
      collision.actionUnitDigest !== part9A.actionUnitDigest || !contract.collisionAndResponseContract.acceptedPairs.some(pair => pair.resultState === collision.resultState && pair.reasonCode === collision.reasonCode)) throw new Error('collision');
  requireFresh(collision.asOf, input.evaluatedAt);
  const response = input.responseEvidenceBinding;
  if (response.tenantId !== input.tenantId || response.sourceSetDigest !== source.sourceSetDigest || response.actionUnitId !== part9A.actionUnitId || response.actionUnitDigest !== part9A.actionUnitDigest ||
      response.replyState !== part7F.currentLaunchProfile.replyState || response.optOutState !== part7F.currentLaunchProfile.optOutState ||
      response.strongestClaim !== 'none' || response.state !== 'no_accepted_response_evidence') throw new Error('response evidence');

  if (input.materialDigest !== hash(materialOf(input)) || input.idempotencyKeyDigest !== hash({namespace: 'mission28.part9b.contact-followup-cadence-idempotency.v1', material: idempotencyMaterialOf(input)}) ||
      input.requestDigest !== hash(requestOf(input))) throw new Error('canonical digest');
}

function reasonFor(input) {
  const permission = input.channelPermissionBinding.permissionResultState;
  if (permission === 'suppressed_opt_out') return 'recipient_opt_out_active';
  if (permission === 'suppressed_do_not_contact') return 'do_not_contact_active';
  if (['suppressed_conflicting', 'suppressed_preference', 'suppressed_jurisdiction', 'suppressed_age'].includes(permission)) return 'permission_suppressed';
  const collision = input.collisionBinding;
  if (collision.reasonCode === 'global_pause_active') return 'global_pause_active';
  if (collision.reasonCode === 'tenant_pause_active') return 'tenant_pause_active';
  if (collision.reasonCode === 'active_conversation_present') return 'active_conversation_present';
  if (collision.reasonCode === 'recent_manual_activity_present') return 'recent_manual_activity_present';
  if (collision.resultState === 'unavailable') return 'current_evidence_unavailable';
  if (collision.resultState === 'superseded') return 'higher_priority_action_active';
  if (input.frequencyBinding.state === 'limit_reached') return 'frequency_limit_reached';
  if (input.frequencyBinding.state === 'minimum_interval_active') return 'minimum_interval_active';
  if (input.frequencyBinding.state === 'unavailable') return 'frequency_evidence_unavailable';
  if (permission === 'suppressed_quiet_hours' || ['inside_quiet_hours', 'holiday_closed'].includes(input.quietHoursBinding.state)) return 'quiet_hours_active';
  if (input.quietHoursBinding.state === 'unavailable') return 'quiet_hours_unavailable';
  return 'channel_permission_unavailable';
}

function project(input, trusted) {
  validate(input, trusted);
  const reasonCode = reasonFor(input); const fixedLabel = contract.decisionContract.fixedLabels[reasonCode];
  if (!fixedLabel) throw new Error('decision');
  return Object.freeze({
    cadenceResolutionId: input.cadenceResolutionId, tenantId: input.tenantId, sourceSetDigest: input.sourceBinding.sourceSetDigest,
    actionUnitId: input.part9AResolutionBinding.actionUnitId, actionUnitDigest: input.part9AResolutionBinding.actionUnitDigest,
    recipientResolutionId: input.channelPermissionBinding.recipientResolutionId, channelId: input.channelPermissionBinding.channelId, evaluatedAt: input.evaluatedAt,
    resultState: contract.decisionContract.resultState, reasonCode,
    labelId: `contact_followup_${reasonCode}`, fixedLabel, ownerWorklistDisposition: contract.decisionContract.ownerWorklistDisposition,
    ownerWorklistRecordCreated: false, messageCreated: false, taskCreated: false, scheduleCreated: false, providerAttemptCreated: false, externalEffectCreated: false
  });
}

class History {
  constructor() { this.byId = new Map(); this.byStable = new Map(); }
  record(input, trusted) {
    const result = project(input, trusted); const previous = this.byId.get(input.cadenceResolutionId);
    if (previous) { if (previous.requestDigest !== input.requestDigest) throw new Error('identity conflict'); return Object.freeze({...previous, replayed: true}); }
    if (this.byStable.has(input.idempotencyKeyDigest)) throw new Error('clone');
    const stored = Object.freeze({...result, requestDigest: input.requestDigest, materialDigest: input.materialDigest, idempotencyKeyDigest: input.idempotencyKeyDigest, replayed: false});
    this.byId.set(input.cadenceResolutionId, stored); this.byStable.set(input.idempotencyKeyDigest, input.cadenceResolutionId); return stored;
  }
}

describe('Mission 28 Part 9B bounded contact follow-up cadence', () => {
  test('binds exact released inputs and Part9A provenance', () => {
    expect(contract.authority).toMatchObject({part: '9B', state: 'implementation_candidate_only', baselineCommit: '5ec0cf241ed7325ed260f2d43d50267d60f92383', baselineTree: '00892dbc3d274d89a55fafef36e9339fbfe85397'});
    expect(contract.part9ARelease).toMatchObject({acceptedSourceHead: 'e0c67097993f1248e6e6101722700462cea782d5', freshAudit: 'P0_P1_P2_P3_zero', pullRequest: 585, deployment: 'f5d52e11-8e65-4a69-946e-801198360f42', imageSha256: 'e22da885e7999eb7843a23cceaf9c3ce38aed3a36d104b552f5758abf103053c'});
    for (const item of contract.frozenInputs) expect(digestLf(item.path)).toBe(item.normalizedLfSha256);
  });

  test('freezes finite cadence bounds without missing-as-zero fallbacks', () => {
    expect(contract.bounds).toMatchObject({attemptCeiling: 3, attemptWindowSeconds: 604800, minimumIntervalSeconds: 86400, cadenceHorizonSeconds: 1209600, maximumResolutionObservationAgeSeconds: 300, ownerWorklistReasonsMaximum: 1});
    expect(contract.frequencyContract.attemptEvidence).toMatch(/separately_resolved/); expect(contract.bounds.unboundedOrZeroFrequencyQuietHourOrExpirationFallback).toBe('deny');
  });

  test('returns one fixed owner-review projection and no effect for the current unavailable channel', () => {
    const result = project(fixture(), fixture());
    expect(result).toEqual(expect.objectContaining({tenantId: '00000000-0000-4000-8000-000000000001', sourceSetDigest: `sha256:${'22'.repeat(32)}`, actionUnitId: '00000000-0000-4000-8000-000000000028', recipientResolutionId: '00000000-0000-4000-8000-000000000030', channelId: 'email', resultState: 'automation_stopped_owner_review_required_no_effect', reasonCode: 'quiet_hours_unavailable', fixedLabel: 'Follow-up stopped — quiet-hour authority unavailable', ownerWorklistDisposition: 'owner_readable_projection_only_no_record_notification_or_task_created'}));
    for (const key of ['ownerWorklistRecordCreated', 'messageCreated', 'taskCreated', 'scheduleCreated', 'providerAttemptCreated', 'externalEffectCreated']) expect(result[key]).toBe(false);
  });

  test('suppresses opt-out, do-not-contact and other exact permission denials before any contact', () => {
    for (const [state, reason] of [['suppressed_opt_out', 'recipient_opt_out_active'], ['suppressed_do_not_contact', 'do_not_contact_active'], ['suppressed_preference', 'permission_suppressed'], ['suppressed_quiet_hours', 'quiet_hours_active']]) {
      const input = fixture(); input.channelPermissionBinding.permissionResultState = state; seal(input); expect(project(input, copy(input)).reasonCode).toBe(reason);
    }
  });

  test('stops for active conversation, recent manual activity, unavailable evidence and higher-priority work', () => {
    for (const [resultState, collisionReason, expected] of [['suppressed', 'active_conversation_present', 'active_conversation_present'], ['suppressed', 'recent_manual_activity_present', 'recent_manual_activity_present'],
      ['unavailable', 'source_material_changed', 'current_evidence_unavailable'], ['superseded', 'higher_priority_action_active', 'higher_priority_action_active']]) {
      const input = fixture(); input.collisionBinding = collisionBinding(resultState, collisionReason); seal(input); expect(project(input, copy(input)).reasonCode).toBe(expected);
    }
  });

  test('reports global and tenant pauses before frequency quiet-hour or channel decisions', () => {
    for (const reason of ['global_pause_active', 'tenant_pause_active']) {
      const input = fixture(); input.collisionBinding = collisionBinding('suppressed', reason); input.frequencyBinding = frequencyBinding('limit_reached', 3);
      input.quietHoursBinding = quietHoursBinding('inside_quiet_hours'); seal(input);
      const result = project(input, copy(input)); expect(result.reasonCode).toBe(reason); expect(result.fixedLabel).toBe(contract.decisionContract.fixedLabels[reason]);
      for (const key of ['ownerWorklistRecordCreated', 'messageCreated', 'taskCreated', 'scheduleCreated', 'providerAttemptCreated', 'externalEffectCreated']) expect(result[key]).toBe(false);
    }
  });

  test('stops at the attempt ceiling and during exact quiet hours or holidays', () => {
    const limit = fixture(); limit.frequencyBinding = frequencyBinding('limit_reached', 3); seal(limit); expect(project(limit, copy(limit)).reasonCode).toBe('frequency_limit_reached');
    const interval = fixture(); interval.frequencyBinding = frequencyBinding('minimum_interval_active', 1);
    interval.frequencyBinding.lastAcceptedAttemptAt = '2026-10-28T11:00:00.000000Z'; interval.frequencyBinding.nextAttemptNotBefore = '2026-10-29T11:00:00.000000Z';
    seal(interval); expect(project(interval, copy(interval)).reasonCode).toBe('minimum_interval_active');
    for (const state of ['inside_quiet_hours', 'holiday_closed']) { const input = fixture(); input.quietHoursBinding = quietHoursBinding(state); seal(input); expect(project(input, copy(input)).reasonCode).toBe('quiet_hours_active'); }
  });

  test('preserves Part9A customer acknowledgement unavailable and passive internal alert no-effect truth', () => {
    const input = fixture(); expect(input.part9AResolutionBinding).toMatchObject(contract.exactCurrentAuthority.part9A);
    expect(contract.fixedTruthContract.ownerWorklistReadyNeverMeans).toMatch(/record_notification_task_message_schedule_attempt/);
    for (const mutation of [value => { value.part9AResolutionBinding.customerAcknowledgementState = 'sent'; }, value => { value.part9AResolutionBinding.internalAlertState = 'staff_alerted'; }, value => { value.part9AResolutionBinding.sourceSetDigest = `sha256:${'99'.repeat(32)}`; }]) {
      const candidate = fixture(); mutation(candidate); seal(candidate); expect(() => project(candidate, copy(candidate))).toThrow();
    }
  });

  test('denies cross-tenant actor source recipient and permission retargeting', () => {
    for (const mutation of [value => { value.tenantId = '00000000-0000-4000-8000-000000000099'; }, value => { value.sourceBinding.tenantId = '00000000-0000-4000-8000-000000000099'; },
      value => { value.part9AResolutionBinding.tenantId = '00000000-0000-4000-8000-000000000099'; }, value => { value.actorAuthorityBinding.membershipTenantId = '00000000-0000-4000-8000-000000000099'; },
      value => { value.actorAuthorityBinding.sessionSubjectActorId = '00000000-0000-4000-8000-000000000099'; }, value => { value.actorAuthorityBinding.actorState = 'suspended'; },
      value => { value.channelPermissionBinding.sourceSetDigest = `sha256:${'99'.repeat(32)}`; }, value => { value.channelPermissionBinding.permissionRecipientResolutionDigest = `sha256:${'99'.repeat(32)}`; },
      value => { value.channelPermissionBinding.actionUnitId = '00000000-0000-4000-8000-000000000099'; }, value => { value.frequencyBinding.tenantId = '00000000-0000-4000-8000-000000000099'; },
      value => { value.frequencyBinding.sourceSetDigest = `sha256:${'99'.repeat(32)}`; }, value => { value.collisionBinding.actionUnitDigest = `sha256:${'99'.repeat(32)}`; },
      value => { value.responseEvidenceBinding.tenantId = '00000000-0000-4000-8000-000000000099'; }, value => { value.responseEvidenceBinding.sourceSetDigest = `sha256:${'99'.repeat(32)}`; }, value => { value.quietHoursBinding.tenantId = '00000000-0000-4000-8000-000000000099'; },
      value => { value.channelPermissionBinding.recipientClassId = 'customer'; }, value => { value.channelPermissionBinding.channelId = 'in_app_passive'; },
      value => { value.channelPermissionBinding.providerMode = 'live'; }, value => { value.channelPermissionBinding.permissionResultState = 'clear_internal_passive_no_effect'; }]) {
      const candidate = fixture(); mutation(candidate); seal(candidate); expect(() => project(candidate, copy(candidate))).toThrow();
    }
  });

  test('denies invalid counts, intervals, history and expiration instead of coercing or defaulting', () => {
    for (const mutation of [value => { value.frequencyBinding.attemptsInWindow = -1; }, value => { value.frequencyBinding.attemptsInWindow = 1.5; },
      value => { value.frequencyBinding.attemptsInWindow = 4; }, value => { value.frequencyBinding.attemptCeiling = 0; }, value => { value.frequencyBinding.minimumIntervalSeconds = 0; },
      value => { value.frequencyBinding.attemptsInWindow = 1; }, value => { value.frequencyBinding.lastAcceptedAttemptAt = '2026-10-29T12:00:00.000000Z'; },
      value => { value.frequencyBinding.cadenceExpiresAt = '2026-11-12T12:05:00.000000Z'; }, value => { value.frequencyBinding.state = 'limit_reached'; }]) {
      const candidate = fixture(); mutation(candidate); seal(candidate); expect(() => project(candidate, copy(candidate))).toThrow();
    }
  });

  test('binds every positive count to the exact inclusive seven-day attempt window', () => {
    const inside = fixture(); inside.frequencyBinding = frequencyBinding('clear', 1); seal(inside); expect(project(inside, copy(inside)).resultState).toBe(contract.decisionContract.resultState);
    const threshold = fixture(); threshold.frequencyBinding = frequencyBinding('clear', 1);
    threshold.frequencyBinding.lastAcceptedAttemptAt = '2026-10-21T12:05:00.000000Z'; threshold.frequencyBinding.nextAttemptNotBefore = '2026-10-22T12:05:00.000000Z'; seal(threshold);
    expect(project(threshold, copy(threshold)).resultState).toBe(contract.decisionContract.resultState);
    for (const [last, next] of [
      ['2026-10-21T12:04:59.999999Z', '2026-10-22T12:04:59.999999Z'],
      ['2026-10-21T12:04:59.000000Z', '2026-10-22T12:04:59.000000Z'],
      ['2026-10-20T12:00:00.000000Z', '2026-10-21T12:00:00.000000Z']
    ]) {
      const stale = fixture(); stale.frequencyBinding = frequencyBinding('clear', 1); stale.frequencyBinding.lastAcceptedAttemptAt = last; stale.frequencyBinding.nextAttemptNotBefore = next; seal(stale);
      expect(() => project(stale, copy(stale))).toThrow('attempt time');
    }
  });

  test('accepts fresh and exact-threshold observations but denies stale future or incoherent clock evidence', () => {
    const threshold = fixture(); threshold.frequencyBinding.observedAt = '2026-10-28T12:00:00.000000Z'; threshold.quietHoursBinding.observedAt = '2026-10-28T12:00:00.000000Z'; threshold.collisionBinding.asOf = '2026-10-28T12:00:00.000000Z'; seal(threshold); expect(project(threshold, copy(threshold)).resultState).toBe(contract.decisionContract.resultState);
    for (const mutation of [value => { value.quietHoursBinding.tenantTimeZone = 'US/Central'; }, value => { value.quietHoursBinding.tenantTimeZone = 'customer@example.test'; },
      value => { value.quietHoursBinding.state = 'unknown'; }, value => { value.quietHoursBinding.observedAt = '2026-10-29T12:00:00.000000Z'; },
      value => { value.quietHoursBinding.observedAt = '2026-10-28T11:59:59.000000Z'; }, value => { value.frequencyBinding.observedAt = '2026-10-28T11:59:59.000000Z'; },
      value => { value.collisionBinding.asOf = '2026-10-28T11:59:59.000000Z'; }, value => { value.collisionBinding.asOf = '2026-10-28T12:06:00.000000Z'; },
      value => { value.quietHoursBinding.nextAllowedAt = '2026-10-28T14:00:00.000000Z'; }, value => { value.quietHoursBinding.state = 'inside_quiet_hours'; }]) {
      const candidate = fixture(); mutation(candidate); seal(candidate); expect(() => project(candidate, copy(candidate))).toThrow();
    }
    const nonEastern = fixture(); nonEastern.quietHoursBinding.tenantTimeZone = 'America/Denver'; seal(nonEastern); expect(project(nonEastern, copy(nonEastern)).resultState).toBe(contract.decisionContract.resultState);
  });

  test('rejects fabricated reply, opt-out, attempt, free text, labels and outcomes', () => {
    for (const mutation of [value => { value.responseEvidenceBinding.replyState = 'reply_received'; }, value => { value.responseEvidenceBinding.optOutState = 'opt_out_received'; },
      value => { value.customerEmail = 'customer@example.test'; }, value => { value.replyBody = 'yes please'; }, value => { value.fixedLabel = 'Message sent'; },
      value => { value.providerStatus = 'delivered'; }, value => { value.staffOutcome = 'called'; }]) {
      const candidate = fixture(); mutation(candidate); seal(candidate); expect(() => project(candidate, copy(candidate))).toThrow();
    }
    for (const label of Object.values(contract.decisionContract.fixedLabels)) expect(label).not.toMatch(/@|phone|message sent|delivered|replied|customerId|providerId|sk_/i);
  });

  test('keeps stable idempotency across identity and evaluation time with immutable no-effect replay', () => {
    const history = new History(); const first = fixture(); expect(history.record(first, copy(first)).replayed).toBe(false); expect(history.record(copy(first), copy(first)).replayed).toBe(true);
    const clone = copy(first); clone.cadenceResolutionId = '00000000-0000-4000-8000-000000000099'; clone.evaluatedAt = '2026-10-28T12:08:00.000000Z'; seal(clone);
    expect(clone.idempotencyKeyDigest).toBe(first.idempotencyKeyDigest); expect(clone.materialDigest).not.toBe(first.materialDigest); expect(() => history.record(clone, copy(clone))).toThrow('clone');
    const conflict = copy(first); conflict.evaluatedAt = '2026-10-28T12:08:00.000000Z'; seal(conflict); expect(() => history.record(conflict, copy(conflict))).toThrow('identity conflict');
  });

  test('rejects unknown, missing, accessor, symbol, proxy, toJSON, custom-prototype, sparse and alias data before hooks', () => {
    for (const mutation of [value => { value.extra = 'x'; }, value => { delete value.requestDigest; }, value => { value.sourceBinding.toJSON = () => ({}); },
      value => { Object.setPrototypeOf(value.frequencyBinding, {}); }, value => { value.channelPermissionBinding = value.sourceBinding; }]) {
      const candidate = fixture(); mutation(candidate); expect(() => project(candidate, fixture())).toThrow();
    }
    let getters = 0; const accessor = fixture(); Object.defineProperty(accessor.frequencyBinding, 'attemptsInWindow', {enumerable: true, get() { getters += 1; return 0; }}); expect(() => project(accessor, fixture())).toThrow(); expect(getters).toBe(0);
    const symbol = fixture(); symbol[Symbol('secret')] = 'sk_secret'; expect(() => project(symbol, fixture())).toThrow();
    let traps = 0; const proxy = new Proxy(fixture(), {get() { traps += 1; throw new Error('trap'); }, ownKeys() { traps += 1; throw new Error('trap'); }}); expect(() => project(proxy, fixture())).toThrow(); expect(traps).toBe(0);
    const sparse = fixture(); sparse.extraArray = []; sparse.extraArray[1] = 'x'; expect(() => project(sparse, fixture())).toThrow();
  });

  test('freezes zero-effect runtime boundaries with migration287 latest and no288', () => {
    expect(Object.values(contract.privacyAndEffects).every(value => value === 0)).toBe(true);
    expect(contract.runtimeBoundary).toMatchObject({newMigration: false, newTableFunctionRouteOrUi: false, mountedSchedulerWorkerQueueOrPolicyExecutor: false, providerAdapterCallbackOrInboundReceiver: false, customerOrInternalMessageNotificationTaskOrWorklistRecord: false, externalEffectOrUpstreamMutation: false, nextMigrationAbsent: '288'});
    const migrations = fs.readdirSync(path.join(ROOT, 'migrations')).filter(name => /^\d+_/.test(name)).sort(); expect(migrations.at(-1)).toBe('287_canonical_automation_estimate_quote_resolution_v1.sql'); expect(migrations.some(name => name.startsWith('288_'))).toBe(false);
  });

  test('roadmap and ledger preserve Part9A while recording Part9B released and Part9C candidate', () => {
    const roadmap = fs.readFileSync(ROADMAP, 'utf8'); const ledger = fs.readFileSync(LEDGER, 'utf8'); const markdown = fs.readFileSync(CONTRACT_MD, 'utf8');
    for (const document of [roadmap, ledger]) { expect(document).toContain('Parts 1A–10A are released. Part 10B is the sole implementation candidate.'); expect(document).toContain('Parts 10C–14G remain planned and unimplemented.'); expect(document).toContain('f5d52e11-8e65-4a69-946e-801198360f42'); expect(document).toContain('sha256:e22da885e7999eb7843a23cceaf9c3ce38aed3a36d104b552f5758abf103053c'); }
    expect(ledger).toContain('| 37 | 9A | Supported inquiry acknowledgement and internal alert | **Released** |'); expect(ledger).toContain('| 38 | 9B | Bounded contact-attempt and response-follow-up cadence | **Released** |'); expect(ledger).toContain('| 39 | 9C | Exact-current estimate/quote follow-up | **Released** |'); expect(ledger).toContain('| 40 | 9D | Explicitly reviewed customer re-engagement boundary | **Released** |');
    expect((ledger.match(/\*\*Implementation candidate\*\*/g) || [])).toHaveLength(1); expect((ledger.match(/Planned \/ unimplemented/g) || [])).toHaveLength(24); expect(markdown).toContain('No migration 288');
  });
});
