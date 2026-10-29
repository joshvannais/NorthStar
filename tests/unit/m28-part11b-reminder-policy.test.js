'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {types: {isProxy}} = require('util');

const ROOT = path.resolve(__dirname, '../..');
const CONTRACT_PATH = path.join(ROOT, 'docs/architecture/MISSION_28_PART11B_REMINDER_POLICY_CONTRACT.json');
const CONTRACT_MD = path.join(ROOT, 'docs/architecture/MISSION_28_PART11B_REMINDER_POLICY_CONTRACT.md');
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
const canonicalTimeZones = new Set(['UTC', ...Intl.supportedValuesOf('timeZone')]);

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
    if (key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable || key === 'toJSON') throw new Error('descriptor');
    dataGate(descriptor.value, seen);
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

function dateDay(value) {
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return null;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) return null;
  return BigInt(parsed / 86400000);
}

function policyMaterialOf(policy) { const value = copy(policy); delete value.canonicalDigest; return value; }
function materialOf(input) { const value = copy(input); delete value.projectionId; delete value.materialDigest; delete value.idempotencyKeyDigest; delete value.requestDigest; return value; }
function idempotencyMaterialOf(input) { const value = materialOf(input); delete value.evaluatedAt; return value; }
function requestOf(input) { const value = copy(input); delete value.materialDigest; delete value.idempotencyKeyDigest; delete value.requestDigest; return value; }
function seal(input) {
  input.policyDefinition.canonicalDigest = hash(policyMaterialOf(input.policyDefinition));
  input.materialDigest = hash(materialOf(input));
  input.idempotencyKeyDigest = hash(idempotencyMaterialOf(input));
  input.requestDigest = hash(requestOf(input));
  return input;
}

function fixture() {
  const tenantId = uuid(1); const invoiceId = uuid(10); const customerId = uuid(11); const versionDigest = digest(10); const policyId = uuid(20); const observedAt = '2026-10-29T12:04:00.000000Z';
  return seal({
    schemaVersion: contract.contractVersion, tenantId, projectionId: uuid(21),
    policyDefinition: {
      policyId, policyVersion: 1, previousPolicyDigest: null, policyState: 'draft_no_effect', phaseId: 'overdue', agingBucketIds: ['overdue_1_30'],
      cadence: {relativeDueDayOffsets: [7, 14, 21], minimumIntervalSeconds: 604800},
      localTime: {tenantTimeZone: 'America/New_York', localTime: '09:00:00', dstResolutionRule: 'part6b_gap_deny_fold_explicit', quietHoursRule: 'part6b_exact_current_calendar_required'},
      gracePeriodDays: 3, frequencyCeiling: {maxAttemptsPerRolling7Days: 2, maxAttemptsPerInvoice: 4}, recipientClassId: 'authorized_billing_contact', channelId: 'email', providerMode: 'provider_disabled',
      wordingId: 'invoice_overdue_reminder_v1', wordingVersion: 1, wordingDigest: 'sha256:90a93d01c40a43c15262d9982977317298d34f291df723d0dadbf90bff7d8d96', approvalClass: 'per_run_approval', stopConditionIds: copy(contract.mandatoryStopConditionIds),
      expiresAt: '2027-01-01T00:00:00.000000Z', rolloutState: 'disabled_contract_only', canonicalDigest: digest(90)
    },
    part11AEligibilityBinding: {tenantId, resolutionId: uuid(30), materialDigest: digest(30), idempotencyKeyDigest: digest(31), requestDigest: digest(32), resultState: 'eligible_for_owner_collection_review_only', reasonCode: 'exact_current_collection_review_eligible', issuedInvoiceId: invoiceId, issuedVersionDigest: versionDigest, sourceSetId: uuid(31), sourceSetDigest: digest(33), axisMaterialDigest: digest(45), headTransitionId: uuid(32), headTransitionDigest: digest(34), headSequence: 5, currentnessState: 'latest_exact_current', observedAt},
    financialAxisBinding: {tenantId, issuedInvoiceId: invoiceId, issuedVersionDigest: versionDigest, customerId, customerIdentityDigest: digest(35), currency: 'USD', invoiceDigest: digest(36), balanceDigest: digest(37), dueAgingProjectionId: uuid(33), dueAgingProjectionRevision: 4, dueAgingProjectionDigest: digest(38), issuedDueDate: '2026-10-15', asOfBusinessDate: '2026-10-29', agingBucket: 'overdue_1_30', daysPastDue: 14, deliveryEvidenceDigest: digest(39), financialStateDigest: digest(40), settlementDigest: digest(41), allocationDigest: digest(42), offlineEvidenceDigest: digest(43), accountingDigest: digest(44), axisMaterialDigest: digest(45), sourceSetId: uuid(31), sourceSetDigest: digest(33), headTransitionId: uuid(32), headTransitionDigest: digest(34), headSequence: 5, currentnessState: 'latest_exact_current', observedAt},
    recipientBinding: {tenantId, recipientResolutionId: uuid(40), recipientResolutionDigest: digest(46), recipientRecordId: uuid(41), recipientRecordDigest: digest(47), recipientClassId: 'authorized_billing_contact', customerId, reviewState: 'reviewed_exact_current', currentnessState: 'latest_exact_current', observedAt},
    channelPermissionBinding: {tenantId, permissionResolutionId: uuid(42), permissionResolutionDigest: digest(48), permissionRecipientResolutionDigest: digest(46), recipientResolutionDigest: digest(46), channelId: 'email', permissionResultState: 'unavailable', providerMode: 'provider_disabled', currentnessState: 'latest_exact_current', observedAt},
    timeAuthorityBinding: {tenantId, calendarId: uuid(43), calendarVersion: 2, calendarDigest: digest(49), calendarState: 'exact_current', tenantTimeZone: 'America/New_York', observedAt},
    approvalBinding: {tenantId, requiredApprovalClass: 'per_run_approval', authorizationId: null, authorizationDigest: null, authorizationState: 'required_unavailable', materialBindingDigest: null, observedAt},
    frequencyEvidenceBinding: {tenantId, issuedInvoiceId: invoiceId, policyId, policyVersion: 1, attemptsInRolling7Days: 0, attemptsForInvoice: 0, lastAcceptedAttemptAt: null, state: 'clear', observedAt, resolutionDigest: digest(50)},
    actorAuthorityBinding: {actorId: uuid(50), sessionId: uuid(51), membershipId: uuid(52), sessionSubjectActorId: uuid(50), membershipSubjectActorId: uuid(50), actorTenantId: tenantId, sessionTenantId: tenantId, membershipTenantId: tenantId, actorState: 'active', sessionState: 'active', membershipState: 'active', membershipRoleId: 'owner', capabilityId: 'automation_policy_draft', capabilityDecisionId: uuid(53), capabilityDecisionDigest: digest(51)},
    evaluatedAt: '2026-10-29T12:05:00.000000Z', materialDigest: digest(91), idempotencyKeyDigest: digest(92), requestDigest: digest(93)
  });
}

function setPhase(input, phaseId, agingBucket, daysPastDue) {
  const asOf = Date.parse(`${input.financialAxisBinding.asOfBusinessDate}T00:00:00.000Z`);
  input.financialAxisBinding.issuedDueDate = new Date(asOf - daysPastDue * 86400000).toISOString().slice(0, 10);
  input.financialAxisBinding.agingBucket = agingBucket; input.financialAxisBinding.daysPastDue = daysPastDue;
  input.policyDefinition.phaseId = phaseId; input.policyDefinition.agingBucketIds = [agingBucket]; input.policyDefinition.cadence.relativeDueDayOffsets = [daysPastDue]; input.policyDefinition.gracePeriodDays = 0;
  const wording = contract.fixedCustomerSafeWordingCatalog.find(item => item.phaseId === phaseId);
  input.policyDefinition.wordingId = wording.wordingId; input.policyDefinition.wordingVersion = wording.wordingVersion; input.policyDefinition.wordingDigest = wording.wordingDigest;
  return input;
}

function validIdentity(value, pattern, label) { if (typeof value !== 'string' || !pattern.test(value)) throw new Error(label); }
function fresh(observed, evaluated) { return observed !== null && observed <= evaluated && evaluated - observed <= BigInt(contract.bounds.maximumSourceObservationAgeSeconds) * 1000000n; }

function validate(input, trusted) {
  dataGate(input); dataGate(trusted);
  const envelope = contract.policyProjectionEnvelope;
  exactKeys(input, envelope.exactFields); exactKeys(input.policyDefinition, envelope.policyDefinitionExactFields); exactKeys(input.policyDefinition.cadence, envelope.cadenceExactFields); exactKeys(input.policyDefinition.localTime, envelope.localTimeExactFields); exactKeys(input.policyDefinition.frequencyCeiling, envelope.frequencyCeilingExactFields); exactKeys(input.part11AEligibilityBinding, envelope.part11AEligibilityBindingExactFields); exactKeys(input.financialAxisBinding, envelope.financialAxisBindingExactFields); exactKeys(input.recipientBinding, envelope.recipientBindingExactFields); exactKeys(input.channelPermissionBinding, envelope.channelPermissionBindingExactFields); exactKeys(input.timeAuthorityBinding, envelope.timeAuthorityBindingExactFields); exactKeys(input.approvalBinding, envelope.approvalBindingExactFields); exactKeys(input.frequencyEvidenceBinding, envelope.frequencyEvidenceBindingExactFields); exactKeys(input.actorAuthorityBinding, envelope.actorAuthorityBindingExactFields);
  if (input.schemaVersion !== contract.contractVersion || JSON.stringify(input) !== JSON.stringify(trusted)) throw new Error('trusted resolution');
  const p = input.policyDefinition; const e = input.part11AEligibilityBinding; const f = input.financialAxisBinding; const tenantId = input.tenantId; const evaluated = utcMicros(input.evaluatedAt);
  for (const value of [tenantId, input.projectionId, p.policyId, e.resolutionId, e.issuedInvoiceId, e.sourceSetId, e.headTransitionId, f.issuedInvoiceId, f.customerId, f.dueAgingProjectionId, f.sourceSetId, f.headTransitionId, input.recipientBinding.recipientResolutionId, input.recipientBinding.recipientRecordId, input.channelPermissionBinding.permissionResolutionId, input.timeAuthorityBinding.calendarId, input.frequencyEvidenceBinding.issuedInvoiceId, input.frequencyEvidenceBinding.policyId, input.actorAuthorityBinding.actorId, input.actorAuthorityBinding.sessionId, input.actorAuthorityBinding.membershipId, input.actorAuthorityBinding.capabilityDecisionId]) validIdentity(value, UUID, 'uuid');
  for (const value of [p.canonicalDigest, e.materialDigest, e.idempotencyKeyDigest, e.requestDigest, e.issuedVersionDigest, e.sourceSetDigest, e.axisMaterialDigest, e.headTransitionDigest, f.issuedVersionDigest, f.customerIdentityDigest, f.invoiceDigest, f.balanceDigest, f.dueAgingProjectionDigest, f.deliveryEvidenceDigest, f.financialStateDigest, f.settlementDigest, f.allocationDigest, f.offlineEvidenceDigest, f.accountingDigest, f.axisMaterialDigest, f.sourceSetDigest, f.headTransitionDigest, input.recipientBinding.recipientResolutionDigest, input.recipientBinding.recipientRecordDigest, input.channelPermissionBinding.permissionResolutionDigest, input.channelPermissionBinding.permissionRecipientResolutionDigest, input.channelPermissionBinding.recipientResolutionDigest, input.timeAuthorityBinding.calendarDigest, input.frequencyEvidenceBinding.resolutionDigest, input.actorAuthorityBinding.capabilityDecisionDigest, input.materialDigest, input.idempotencyKeyDigest, input.requestDigest]) validIdentity(value, DIGEST, 'digest');
  if (p.previousPolicyDigest !== null) validIdentity(p.previousPolicyDigest, DIGEST, 'previous policy digest');
  if (!Number.isSafeInteger(p.policyVersion) || p.policyVersion < 1 || (p.policyVersion === 1) !== (p.previousPolicyDigest === null) || p.policyState !== 'draft_no_effect' || p.rolloutState !== 'disabled_contract_only' || p.canonicalDigest !== hash(policyMaterialOf(p))) throw new Error('policy');
  if (tenantId !== e.tenantId || tenantId !== f.tenantId || tenantId !== input.recipientBinding.tenantId || tenantId !== input.channelPermissionBinding.tenantId || tenantId !== input.timeAuthorityBinding.tenantId || tenantId !== input.approvalBinding.tenantId || tenantId !== input.frequencyEvidenceBinding.tenantId || tenantId !== input.actorAuthorityBinding.actorTenantId || tenantId !== input.actorAuthorityBinding.sessionTenantId || tenantId !== input.actorAuthorityBinding.membershipTenantId) throw new Error('tenant');
  if (e.resultState !== contract.sourceAndEligibilityContract.requiredPart11AResult || e.reasonCode !== contract.sourceAndEligibilityContract.requiredPart11AReason || e.currentnessState !== 'latest_exact_current' || f.currentnessState !== 'latest_exact_current' || e.issuedInvoiceId !== f.issuedInvoiceId || e.issuedVersionDigest !== f.issuedVersionDigest || e.sourceSetId !== f.sourceSetId || e.sourceSetDigest !== f.sourceSetDigest || e.axisMaterialDigest !== f.axisMaterialDigest || e.headTransitionId !== f.headTransitionId || e.headTransitionDigest !== f.headTransitionDigest || e.headSequence !== f.headSequence || input.frequencyEvidenceBinding.issuedInvoiceId !== f.issuedInvoiceId) throw new Error('Part11A source');
  if (input.recipientBinding.customerId !== f.customerId || input.recipientBinding.recipientClassId !== p.recipientClassId || input.recipientBinding.recipientClassId !== 'authorized_billing_contact' || input.recipientBinding.reviewState !== 'reviewed_exact_current' || input.recipientBinding.currentnessState !== 'latest_exact_current') throw new Error('recipient');
  if (input.channelPermissionBinding.recipientResolutionDigest !== input.recipientBinding.recipientResolutionDigest || input.channelPermissionBinding.permissionRecipientResolutionDigest !== input.recipientBinding.recipientResolutionDigest || input.channelPermissionBinding.channelId !== p.channelId || !contract.recipientChannelContentApprovalContract.channels.includes(p.channelId) || input.channelPermissionBinding.providerMode !== 'provider_disabled' || p.providerMode !== 'provider_disabled' || !['unavailable','suppressed_opt_out','suppressed_do_not_contact','suppressed_conflicting','suppressed_preference','suppressed_jurisdiction','suppressed_age','suppressed_quiet_hours'].includes(input.channelPermissionBinding.permissionResultState) || input.channelPermissionBinding.currentnessState !== 'latest_exact_current') throw new Error('channel');
  if (input.timeAuthorityBinding.tenantTimeZone !== p.localTime.tenantTimeZone || !canonicalTimeZones.has(p.localTime.tenantTimeZone) || input.timeAuthorityBinding.calendarState !== 'exact_current' || !Number.isSafeInteger(input.timeAuthorityBinding.calendarVersion) || input.timeAuthorityBinding.calendarVersion < 1 || !new RegExp(contract.identityGrammar.localTimePattern).test(p.localTime.localTime) || p.localTime.dstResolutionRule !== 'part6b_gap_deny_fold_explicit' || p.localTime.quietHoursRule !== 'part6b_exact_current_calendar_required') throw new Error('time authority');
  if (!contract.recipientChannelContentApprovalContract.approvalClasses.includes(p.approvalClass) || input.approvalBinding.requiredApprovalClass !== p.approvalClass || input.approvalBinding.authorizationId !== null || input.approvalBinding.authorizationDigest !== null || input.approvalBinding.materialBindingDigest !== null || input.approvalBinding.authorizationState !== 'required_unavailable') throw new Error('approval');
  if (input.actorAuthorityBinding.actorId !== input.actorAuthorityBinding.sessionSubjectActorId || input.actorAuthorityBinding.actorId !== input.actorAuthorityBinding.membershipSubjectActorId || input.actorAuthorityBinding.actorState !== 'active' || input.actorAuthorityBinding.sessionState !== 'active' || input.actorAuthorityBinding.membershipState !== 'active' || input.actorAuthorityBinding.membershipRoleId !== 'owner' || input.actorAuthorityBinding.capabilityId !== 'automation_policy_draft') throw new Error('actor');
  if (JSON.stringify(p.stopConditionIds) !== JSON.stringify(contract.mandatoryStopConditionIds)) throw new Error('stop conditions');
  const wording = contract.fixedCustomerSafeWordingCatalog.find(item => item.wordingId === p.wordingId);
  if (!wording || wording.wordingVersion !== p.wordingVersion || wording.phaseId !== p.phaseId || wording.wordingDigest !== p.wordingDigest || wording.wordingDigest !== `sha256:${crypto.createHash('sha256').update(contract.wordingDigestNamespace + JSON.stringify({wordingId: wording.wordingId, wordingVersion: wording.wordingVersion, phaseId: wording.phaseId, subjectText: wording.subjectText, bodyText: wording.bodyText})).digest('hex')}`) throw new Error('wording');
  const phase = contract.phaseCatalog.find(item => item.phaseId === p.phaseId); if (!phase) throw new Error('phase');
  const offsets = p.cadence.relativeDueDayOffsets;
  if (!Array.isArray(p.agingBucketIds) || p.agingBucketIds.length < 1 || p.agingBucketIds.length > 4 || !Array.isArray(offsets) || offsets.length < 1 || offsets.length > contract.bounds.maximumCadenceOffsets || offsets.some((value, index) => !Number.isSafeInteger(value) || value < contract.bounds.relativeDueDayOffsetMinimum || value > contract.bounds.relativeDueDayOffsetMaximum || (index > 0 && value <= offsets[index - 1])) || !Number.isSafeInteger(p.cadence.minimumIntervalSeconds) || p.cadence.minimumIntervalSeconds < contract.bounds.minimumIntervalSecondsFloor) throw new Error('cadence');
  for (let index = 1; index < offsets.length; index += 1) if ((offsets[index] - offsets[index - 1]) * 86400 < p.cadence.minimumIntervalSeconds) throw new Error('cadence interval');
  const overdueBuckets = contract.phaseCatalog.find(item => item.phaseId === 'overdue').orderedAgingBucketCatalog;
  if (p.phaseId === 'pre_due' && (JSON.stringify(p.agingBucketIds) !== JSON.stringify(['not_due']) || offsets.some(value => value >= 0) || p.gracePeriodDays !== 0)) throw new Error('pre-due phase');
  if (p.phaseId === 'due_today' && (JSON.stringify(p.agingBucketIds) !== JSON.stringify(['due_today']) || JSON.stringify(offsets) !== JSON.stringify([0]) || p.gracePeriodDays !== 0)) throw new Error('due phase');
  if (p.phaseId === 'overdue' && (p.agingBucketIds.some((value, index) => !overdueBuckets.includes(value) || (index > 0 && overdueBuckets.indexOf(value) <= overdueBuckets.indexOf(p.agingBucketIds[index - 1]))) || offsets.some(value => value <= p.gracePeriodDays))) throw new Error('overdue phase');
  if (!p.agingBucketIds.includes(f.agingBucket) || !Number.isSafeInteger(p.gracePeriodDays) || p.gracePeriodDays < 0 || p.gracePeriodDays > contract.bounds.maximumGracePeriodDays) throw new Error('phase source');
  const due = dateDay(f.issuedDueDate); const asOf = dateDay(f.asOfBusinessDate); if (due === null || asOf === null || Number(asOf - due) !== f.daysPastDue) throw new Error('due coherence');
  if (!Number.isSafeInteger(f.dueAgingProjectionRevision) || f.dueAgingProjectionRevision < 1 || !/^[A-Z]{3}$/.test(f.currency) || !Number.isSafeInteger(e.headSequence) || e.headSequence < 1) throw new Error('financial source');
  const ceilings = p.frequencyCeiling; if (![ceilings.maxAttemptsPerRolling7Days, ceilings.maxAttemptsPerInvoice].every(Number.isSafeInteger) || ceilings.maxAttemptsPerRolling7Days < 1 || ceilings.maxAttemptsPerRolling7Days > contract.bounds.maximumAttemptsPerRolling7Days || ceilings.maxAttemptsPerInvoice < ceilings.maxAttemptsPerRolling7Days || ceilings.maxAttemptsPerInvoice > contract.bounds.maximumAttemptsPerInvoice) throw new Error('frequency ceiling');
  const frequency = input.frequencyEvidenceBinding; if (frequency.policyId !== p.policyId || frequency.policyVersion !== p.policyVersion || !Number.isSafeInteger(frequency.attemptsInRolling7Days) || !Number.isSafeInteger(frequency.attemptsForInvoice) || frequency.attemptsInRolling7Days < 0 || frequency.attemptsForInvoice < frequency.attemptsInRolling7Days || frequency.attemptsInRolling7Days > ceilings.maxAttemptsPerRolling7Days || frequency.attemptsForInvoice > ceilings.maxAttemptsPerInvoice || !['clear','limit_reached'].includes(frequency.state)) throw new Error('frequency');
  const evaluatedMicros = evaluated; if (evaluatedMicros === null || utcMicros(p.expiresAt) === null || utcMicros(p.expiresAt) <= evaluatedMicros) throw new Error('expiry');
  for (const observedAt of [e.observedAt, f.observedAt, input.recipientBinding.observedAt, input.channelPermissionBinding.observedAt, input.timeAuthorityBinding.observedAt, input.approvalBinding.observedAt, frequency.observedAt]) if (!fresh(utcMicros(observedAt), evaluatedMicros)) throw new Error('observation');
  const lastAttempt = frequency.lastAcceptedAttemptAt === null ? null : utcMicros(frequency.lastAcceptedAttemptAt);
  if (frequency.attemptsForInvoice === 0) { if (frequency.attemptsInRolling7Days !== 0 || lastAttempt !== null) throw new Error('zero lifetime attempts'); }
  else if (lastAttempt === null || lastAttempt > evaluatedMicros) throw new Error('last attempt');
  if (frequency.attemptsInRolling7Days === 0 && frequency.attemptsForInvoice > 0 && evaluatedMicros - lastAttempt <= 604800000000n) throw new Error('empty rolling window');
  if (frequency.attemptsInRolling7Days > 0 && evaluatedMicros - lastAttempt > 604800000000n) throw new Error('attempt window');
  const limit = frequency.attemptsInRolling7Days === ceilings.maxAttemptsPerRolling7Days || frequency.attemptsForInvoice === ceilings.maxAttemptsPerInvoice;
  if ((frequency.state === 'limit_reached') !== limit) throw new Error('frequency state');
  if (Buffer.byteLength(JSON.stringify(input)) > contract.bounds.maximumCanonicalRequestBytes || input.materialDigest !== hash(materialOf(input)) || input.idempotencyKeyDigest !== hash(idempotencyMaterialOf(input)) || input.requestDigest !== hash(requestOf(input))) throw new Error('digest');
}

function project(input, trusted) {
  validate(input, trusted);
  const fixed = contract.fixedDecision;
  return Object.freeze({projectionId: input.projectionId, tenantId: input.tenantId, policyId: input.policyDefinition.policyId, policyVersion: input.policyDefinition.policyVersion, policyState: input.policyDefinition.policyState, rolloutState: input.policyDefinition.rolloutState, phaseId: input.policyDefinition.phaseId, issuedInvoiceId: input.financialAxisBinding.issuedInvoiceId, issuedVersionDigest: input.financialAxisBinding.issuedVersionDigest, recipientReviewState: input.recipientBinding.reviewState, permissionResultState: input.channelPermissionBinding.permissionResultState, approvalState: input.approvalBinding.authorizationState, frequencyState: input.frequencyEvidenceBinding.state, calendarState: input.timeAuthorityBinding.calendarState, evaluatedAt: input.evaluatedAt, resultState: fixed.resultState, reasonCode: fixed.reasonCode, labelId: fixed.labelId, fixedLabel: fixed.fixedLabel, ownerReadablePolicyOnly: true, policyRecordCreated: false, scheduleCreated: false, worklistRecordCreated: false, taskCreated: false, messageCreated: false, providerAttemptCreated: false, financialMutationCreated: false, accountingMutationCreated: false, balanceMutationCreated: false, externalEffectCreated: false, upstreamMutationCreated: false, moneyEffectCreated: false});
}

class History {
  constructor() { this.byId = new Map(); this.byStable = new Map(); }
  record(input, trusted) {
    const output = project(input, trusted); const prior = this.byId.get(input.projectionId);
    if (prior) { if (prior.requestDigest !== input.requestDigest || prior.materialDigest !== input.materialDigest || prior.idempotencyKeyDigest !== input.idempotencyKeyDigest) throw new Error('identity conflict'); return Object.freeze({...prior, replayed: true}); }
    if (this.byStable.has(input.idempotencyKeyDigest)) throw new Error('clone');
    const stored = Object.freeze({...output, requestDigest: input.requestDigest, materialDigest: input.materialDigest, idempotencyKeyDigest: input.idempotencyKeyDigest, replayed: false}); this.byId.set(input.projectionId, stored); this.byStable.set(input.idempotencyKeyDigest, input.projectionId); return stored;
  }
}

describe('Mission 28 Part 11B reminder policy', () => {
  test('binds exact Part11A release provenance and all frozen controlling inputs', () => {
    expect(contract.authority).toMatchObject({part: '11B', state: 'implementation_candidate_only', baselineCommit: '2d585afd2420ada2f49e2d7bf35e5dccd0c258eb', baselineTree: 'f839ffd067d7e1baab9ab7babae92374f9764ea3'});
    expect(contract.part11ARelease).toEqual({acceptedSourceHead: '6a87b1e15856475dd7b0746cbe61a37a149ccba0', acceptedTree: 'f839ffd067d7e1baab9ab7babae92374f9764ea3', freshAudit: 'P0_P1_P2_P3_zero', freshAuditEvidence: 'exact_Node_22.23.3; focused_17_of_17; cumulative_45_suites_619_tests; migration_history_2_suites_40_tests; syntax_45; JSON_44; migrations_283_through_287_no_288; protected_0; clean', pullRequest: 593, mergedMain: '2d585afd2420ada2f49e2d7bf35e5dccd0c258eb', deploymentIdentity: 'eb08e10a-97d2-45ce-be16-c95394c082b4_SUCCESS_RUNNING', imageIdentity: 'sha256:56ce7688ff23c8ca2f0067afecd31efcddd2c2943a560e470f9d4f9e12e44a01', runningInstance: '664a109f-d792-4dce-812c-2588777c37b7', migrationEvidence: 'source_283_through_287_no_288; direct_applied_history_not_requeried_and_unclaimed', healthEvidence: 'canonical_startup_ready; api_health_root_dashboard_demo_HTTP_200; database_and_canonicalPersistence_healthy; dashboard_demo_exact_91314_byte_sha256_ab65083c5dd9bac308798171df2e65f711e89df9a6864ea15b569bf9f64ab757_parity'});
    expect(contract.frozenInputs).toHaveLength(12); for (const item of contract.frozenInputs) expect(digestLf(item.path)).toBe(item.normalizedLfSha256);
  });

  test('accepts exact pre-due due-today and every canonical overdue bucket only as no-effect policy evidence', () => {
    const phases = [['pre_due','not_due',-7],['due_today','due_today',0],['overdue','overdue_1_30',1],['overdue','overdue_1_30',30],['overdue','overdue_31_60',31],['overdue','overdue_31_60',60],['overdue','overdue_61_90',61],['overdue','overdue_61_90',90],['overdue','overdue_91_plus',91]];
    for (const [phase, bucket, days] of phases) { const input = setPhase(fixture(), phase, bucket, days); seal(input); expect(project(input, copy(input))).toMatchObject({phaseId: phase, resultState: 'reminder_policy_definition_valid_no_effect_external_authority_unavailable', ownerReadablePolicyOnly: true, policyRecordCreated: false, scheduleCreated: false, messageCreated: false, externalEffectCreated: false, moneyEffectCreated: false}); }
    expect(contract.cadenceAndGraceContract.agingIsEvidenceNotPermission).toBe(true);
  });

  test('keeps current due-aging evidence separate from cadence offsets and never derives a schedule', () => {
    const overdueBetweenOffsets = setPhase(fixture(), 'overdue', 'overdue_1_30', 10); overdueBetweenOffsets.policyDefinition.cadence.relativeDueDayOffsets = [7, 14, 21]; seal(overdueBetweenOffsets); expect(project(overdueBetweenOffsets, copy(overdueBetweenOffsets))).toMatchObject({phaseId: 'overdue', scheduleCreated: false});
    const preDueBetweenOffsets = setPhase(fixture(), 'pre_due', 'not_due', -10); preDueBetweenOffsets.policyDefinition.cadence.relativeDueDayOffsets = [-14, -7]; seal(preDueBetweenOffsets); expect(project(preDueBetweenOffsets, copy(preDueBetweenOffsets))).toMatchObject({phaseId: 'pre_due', scheduleCreated: false});
  });

  test('denies phase bucket cadence grace and wording contradictions', () => {
    const mutations = [value => { value.policyDefinition.phaseId = 'pre_due'; }, value => { value.policyDefinition.agingBucketIds = ['not_due']; }, value => { value.policyDefinition.cadence.relativeDueDayOffsets = [-1, 7]; }, value => { value.policyDefinition.cadence.relativeDueDayOffsets = [7, 7]; }, value => { value.policyDefinition.cadence.relativeDueDayOffsets = [7, 8]; }, value => { value.policyDefinition.gracePeriodDays = 14; }, value => { value.policyDefinition.wordingId = 'invoice_due_reminder_v1'; value.policyDefinition.wordingDigest = contract.fixedCustomerSafeWordingCatalog[1].wordingDigest; }, value => { value.financialAxisBinding.daysPastDue = 13; }, value => { value.financialAxisBinding.agingBucket = 'due_today'; }];
    for (const mutation of mutations) { const input = fixture(); mutation(input); seal(input); expect(() => project(input, copy(input))).toThrow(); }
  });

  test('binds exact Part11A eligibility and every separate financial axis to one trusted source head', () => {
    const input = fixture(); expect(project(input, copy(input)).resultState).toBe(contract.fixedDecision.resultState);
    const mutations = [value => { value.part11AEligibilityBinding.resultState = 'ineligible_balance'; }, value => { value.part11AEligibilityBinding.currentnessState = 'stale'; }, value => { value.financialAxisBinding.currentnessState = 'mixed'; }, value => { value.financialAxisBinding.issuedInvoiceId = uuid(99); }, value => { value.financialAxisBinding.issuedVersionDigest = digest(99); }, value => { value.financialAxisBinding.sourceSetDigest = digest(99); }, value => { value.financialAxisBinding.headTransitionDigest = digest(99); }, value => { value.part11AEligibilityBinding.headSequence += 1; }, value => { value.recipientBinding.customerId = uuid(99); }];
    for (const mutation of mutations) { const candidate = fixture(); mutation(candidate); seal(candidate); expect(() => project(candidate, copy(candidate))).toThrow(); }
    const trusted = fixture(); const retarget = copy(trusted); retarget.financialAxisBinding.accountingDigest = digest(99); seal(retarget); expect(() => project(retarget, trusted)).toThrow('trusted resolution');
  });

  test('requires exact canonical tenant local time and preserves the Part6B DST and quiet-hour boundary', () => {
    const chicago = fixture(); chicago.policyDefinition.localTime.tenantTimeZone = 'America/Chicago'; chicago.timeAuthorityBinding.tenantTimeZone = 'America/Chicago'; seal(chicago); expect(project(chicago, copy(chicago)).resultState).toBe(contract.fixedDecision.resultState);
    for (const mutation of [value => { value.policyDefinition.localTime.tenantTimeZone = 'US/Eastern'; value.timeAuthorityBinding.tenantTimeZone = 'US/Eastern'; }, value => { value.policyDefinition.localTime.tenantTimeZone = 'America/Chicago'; }, value => { value.policyDefinition.localTime.localTime = '9:00'; }, value => { value.policyDefinition.localTime.dstResolutionRule = 'choose_earlier'; }, value => { value.policyDefinition.localTime.quietHoursRule = 'fallback_sms'; }, value => { value.timeAuthorityBinding.calendarState = 'stale'; }, value => { value.policyDefinition.localTime.utcInstant = '2026-10-29T13:00:00.000000Z'; }]) { const input = fixture(); mutation(input); seal(input); expect(() => project(input, copy(input))).toThrow(); }
    expect(contract.tenantLocalTimeContract.policyLocalTimeNeverCreatesScheduleOrTrustedClockAuthority).toBe(true);
  });

  test('requires exact reviewed billing recipient disabled external channel fixed wording and unavailable approval', () => {
    for (const mutation of [value => { value.policyDefinition.recipientClassId = 'customer'; }, value => { value.recipientBinding.recipientClassId = 'lead_or_prospect'; }, value => { value.recipientBinding.reviewState = 'candidate_reviewed'; }, value => { value.policyDefinition.channelId = 'push'; }, value => { value.channelPermissionBinding.channelId = 'sms'; }, value => { value.channelPermissionBinding.permissionResultState = 'clear_internal_passive_no_effect'; }, value => { value.policyDefinition.providerMode = 'live'; }, value => { value.policyDefinition.wordingDigest = digest(99); }, value => { value.policyDefinition.subjectText = 'Pay urgently'; }, value => { value.policyDefinition.approvalClass = 'admin_approval'; }, value => { value.approvalBinding.authorizationState = 'approved'; value.approvalBinding.authorizationId = uuid(90); value.approvalBinding.authorizationDigest = digest(90); value.approvalBinding.materialBindingDigest = digest(91); }]) { const input = fixture(); mutation(input); seal(input); expect(() => project(input, copy(input))).toThrow(); }
    for (const item of contract.fixedCustomerSafeWordingCatalog) expect(`${item.subjectText} ${item.bodyText}`).not.toMatch(/@|https?:|\$|fee|threat|urgent|immediate|legal|token|sk_|[0-9]{4,}/i);
  });

  test('enforces finite attempt ceilings and exact rolling-window evidence independently of observation freshness', () => {
    const atThreshold = fixture(); atThreshold.frequencyEvidenceBinding.attemptsInRolling7Days = 1; atThreshold.frequencyEvidenceBinding.attemptsForInvoice = 1; atThreshold.frequencyEvidenceBinding.lastAcceptedAttemptAt = '2026-10-22T12:05:00.000000Z'; seal(atThreshold); expect(project(atThreshold, copy(atThreshold)).resultState).toBe(contract.fixedDecision.resultState);
    const tooOld = copy(atThreshold); tooOld.frequencyEvidenceBinding.lastAcceptedAttemptAt = '2026-10-22T12:04:59.999999Z'; seal(tooOld); expect(() => project(tooOld, copy(tooOld))).toThrow('attempt window');
    const priorLifetimeAttempt = fixture(); priorLifetimeAttempt.frequencyEvidenceBinding.attemptsForInvoice = 1; priorLifetimeAttempt.frequencyEvidenceBinding.lastAcceptedAttemptAt = '2026-10-22T12:04:59.999999Z'; seal(priorLifetimeAttempt); expect(project(priorLifetimeAttempt, copy(priorLifetimeAttempt)).frequencyState).toBe('clear');
    const atLimit = fixture(); atLimit.frequencyEvidenceBinding.attemptsInRolling7Days = 2; atLimit.frequencyEvidenceBinding.attemptsForInvoice = 2; atLimit.frequencyEvidenceBinding.lastAcceptedAttemptAt = '2026-10-29T11:00:00.000000Z'; atLimit.frequencyEvidenceBinding.state = 'limit_reached'; seal(atLimit); expect(project(atLimit, copy(atLimit)).resultState).toBe(contract.fixedDecision.resultState);
    for (const mutation of [value => { value.policyDefinition.frequencyCeiling.maxAttemptsPerRolling7Days = 4; }, value => { value.policyDefinition.frequencyCeiling.maxAttemptsPerInvoice = 0; }, value => { value.frequencyEvidenceBinding.attemptsInRolling7Days = -1; }, value => { value.frequencyEvidenceBinding.attemptsInRolling7Days = 3; }, value => { value.frequencyEvidenceBinding.attemptsForInvoice = 5; }, value => { value.frequencyEvidenceBinding.attemptsForInvoice = 1; }, value => { value.frequencyEvidenceBinding.attemptsForInvoice = 1; value.frequencyEvidenceBinding.lastAcceptedAttemptAt = '2026-10-29T11:00:00.000000Z'; }, value => { value.frequencyEvidenceBinding.lastAcceptedAttemptAt = '2026-10-29T11:00:00.000000Z'; }, value => { value.frequencyEvidenceBinding.observedAt = '2026-10-29T11:59:59.999999Z'; }]) { const input = fixture(); mutation(input); seal(input); expect(() => project(input, copy(input))).toThrow(); }
  });

  test('returns every closed owner-readable policy authority state without creating authority or effects', () => {
    const output = project(fixture(), fixture()); exactKeys(output, contract.policyProjectionEnvelope.outputFieldsCreatedOnlyByTrustedProjection);
    expect(output).toMatchObject({policyState: 'draft_no_effect', rolloutState: 'disabled_contract_only', recipientReviewState: 'reviewed_exact_current', permissionResultState: 'unavailable', approvalState: 'required_unavailable', frequencyState: 'clear', calendarState: 'exact_current', ownerReadablePolicyOnly: true, policyRecordCreated: false, scheduleCreated: false, messageCreated: false, externalEffectCreated: false});
  });

  test('requires the complete ordered mandatory stop catalog without borrowing Part11D runtime semantics', () => {
    expect(contract.stopConditionBoundary.laterAuthority).toMatch(/Part11D/); expect(contract.mandatoryStopConditionIds).toHaveLength(10);
    for (const mutation of [value => { value.policyDefinition.stopConditionIds.pop(); }, value => { value.policyDefinition.stopConditionIds.reverse(); }, value => { value.policyDefinition.stopConditionIds[0] = 'ignore_global_stop'; }, value => { value.policyDefinition.stopConditionIds.push(value.policyDefinition.stopConditionIds[0]); }]) { const input = fixture(); mutation(input); seal(input); expect(() => project(input, copy(input))).toThrow('stop conditions'); }
  });

  test('requires an exact active owner actor session membership and draft capability', () => {
    for (const mutation of [value => { value.actorAuthorityBinding.sessionSubjectActorId = uuid(90); }, value => { value.actorAuthorityBinding.membershipSubjectActorId = uuid(91); }, value => { value.actorAuthorityBinding.membershipTenantId = uuid(99); }, value => { value.actorAuthorityBinding.actorState = 'suspended'; }, value => { value.actorAuthorityBinding.sessionState = 'revoked'; }, value => { value.actorAuthorityBinding.membershipRoleId = 'admin'; }, value => { value.actorAuthorityBinding.capabilityId = 'automation_standing_authority_activate'; }]) { const input = fixture(); mutation(input); seal(input); expect(() => project(input, copy(input))).toThrow(); }
  });

  test('uses stable semantic idempotency and rejects clone or conflicting replay reuse', () => {
    const history = new History(); const first = fixture(); expect(history.record(first, copy(first)).replayed).toBe(false); expect(history.record(copy(first), copy(first)).replayed).toBe(true);
    const clone = copy(first); clone.projectionId = uuid(99); clone.evaluatedAt = '2026-10-29T12:06:00.000000Z'; seal(clone); expect(clone.idempotencyKeyDigest).toBe(first.idempotencyKeyDigest); expect(() => history.record(clone, copy(clone))).toThrow('clone');
    const conflict = copy(first); conflict.evaluatedAt = '2026-10-29T12:06:00.000000Z'; seal(conflict); expect(conflict.idempotencyKeyDigest).toBe(first.idempotencyKeyDigest); expect(() => history.record(conflict, copy(conflict))).toThrow('identity conflict');
    const materialChange = copy(first); materialChange.policyDefinition.channelId = 'sms'; materialChange.channelPermissionBinding.channelId = 'sms'; seal(materialChange); expect(materialChange.idempotencyKeyDigest).not.toBe(first.idempotencyKeyDigest);
  });

  test('rejects extra missing accessor symbol proxy toJSON custom-prototype sparse and alias data before hooks', () => {
    for (const mutation of [value => { value.extra = 'x'; }, value => { delete value.requestDigest; }, value => { delete value.financialAxisBinding; }, value => { value.policyDefinition.toJSON = () => ({}); }, value => { Object.setPrototypeOf(value.recipientBinding, {}); }, value => { value.channelPermissionBinding = value.recipientBinding; }]) { const input = fixture(); mutation(input); expect(() => project(input, fixture())).toThrow(); }
    let getters = 0; const accessor = fixture(); Object.defineProperty(accessor.policyDefinition, 'phaseId', {enumerable: true, get() { getters += 1; return 'overdue'; }}); expect(() => project(accessor, fixture())).toThrow(); expect(getters).toBe(0);
    const symbol = fixture(); symbol[Symbol('secret')] = 'sk_secret'; expect(() => project(symbol, fixture())).toThrow();
    let traps = 0; const proxy = new Proxy(fixture(), {get() { traps += 1; throw new Error('trap'); }, ownKeys() { traps += 1; throw new Error('trap'); }}); expect(() => project(proxy, fixture())).toThrow(); expect(traps).toBe(0);
    const sparse = fixture(); sparse.policyDefinition.stopConditionIds = []; sparse.policyDefinition.stopConditionIds[9] = contract.mandatoryStopConditionIds[9]; expect(() => project(sparse, fixture())).toThrow();
  });

  test('uses one fixed nonreflective unavailable result and creates zero records messages mutations or effects', () => {
    expect(contract.fixedDecision.fixedLabel).toBe('Reminder policy unavailable — current communication authority is not available'); expect(contract.fixedDecision.fixedLabel).not.toMatch(/@|phone|token|sk_|customerName|invoiceNumber|amount|description|note|urgent|[0-9]{4,}/i);
    for (const value of Object.values(contract.privacyAndEffects)) expect(value).toBe(0);
    const output = project(fixture(), fixture()); for (const key of ['policyRecordCreated','scheduleCreated','worklistRecordCreated','taskCreated','messageCreated','providerAttemptCreated','financialMutationCreated','accountingMutationCreated','balanceMutationCreated','externalEffectCreated','upstreamMutationCreated','moneyEffectCreated']) expect(output[key]).toBe(false);
  });

  test('freezes docs-tests-only scope with migration287 latest and no288', () => {
    expect(contract.runtimeBoundary).toMatchObject({newMigration: false, newTableFunctionRouteOrUi: false, policyRecordOrLifecycleCreated: false, nextMigrationAbsent: '288'});
    const migrations = fs.readdirSync(path.join(ROOT, 'migrations')).filter(name => /^\d+_/.test(name)).sort(); expect(migrations).toHaveLength(283); expect(migrations.at(-1)).toBe('287_canonical_automation_estimate_quote_resolution_v1.sql'); expect(migrations.some(name => name.startsWith('288_'))).toBe(false);
  });

  test('roadmap and ledger record Part11A released Part11B candidate and later slices planned', () => {
    const roadmap = fs.readFileSync(ROADMAP, 'utf8'); const ledger = fs.readFileSync(LEDGER, 'utf8'); const markdown = fs.readFileSync(CONTRACT_MD, 'utf8');
    for (const document of [roadmap, ledger]) { expect(document).toContain('Parts 1A–11C are released. Part 11D is the sole implementation candidate.'); expect(document).toContain('Parts 11E–14G remain planned and unimplemented.'); for (const identity of ['6a87b1e15856475dd7b0746cbe61a37a149ccba0','2d585afd2420ada2f49e2d7bf35e5dccd0c258eb','eb08e10a-97d2-45ce-be16-c95394c082b4','sha256:56ce7688ff23c8ca2f0067afecd31efcddd2c2943a560e470f9d4f9e12e44a01','664a109f-d792-4dce-812c-2588777c37b7','ab65083c5dd9bac308798171df2e65f711e89df9a6864ea15b569bf9f64ab757']) expect(document).toContain(identity); expect(document).toMatch(/direct applied.*unavailable.*unclaimed/i); }
    expect(ledger).toContain('| 45 | 11A | Exact-current issued-invoice collection eligibility | **Released** |'); expect(ledger).toContain('| 46 | 11B | Reminder-policy grammar and limits | **Released** |'); expect(ledger).toContain('| 47 | 11C | Exact invoice, amount, destination and balance explanation | **Released** |'); expect((ledger.match(/\*\*Implementation candidate\*\*/g) || [])).toHaveLength(1); expect((ledger.match(/Planned \/ unimplemented/g) || [])).toHaveLength(18); expect(markdown).toContain('Migration 287 remains latest and migration 288 is absent.');
  });
});
