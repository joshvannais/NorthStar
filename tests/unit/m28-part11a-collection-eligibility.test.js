'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {types: {isProxy}} = require('util');

const ROOT = path.resolve(__dirname, '../..');
const CONTRACT_PATH = path.join(ROOT, 'docs/architecture/MISSION_28_PART11A_COLLECTION_ELIGIBILITY_CONTRACT.json');
const CONTRACT_MD = path.join(ROOT, 'docs/architecture/MISSION_28_PART11A_COLLECTION_ELIGIBILITY_CONTRACT.md');
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

const AXIS_KEYS = ['invoiceBinding', 'balanceBinding', 'dueAgingBinding', 'deliveryBinding', 'disputeRefundBinding', 'settlementBinding', 'offlinePaymentBinding', 'accountingBinding', 'customerStateBinding'];
function axisMaterialOf(input) { return Object.fromEntries(AXIS_KEYS.map(key => [key, copy(input[key])])); }
function materialOf(input) { const value = copy(input); delete value.resolutionId; delete value.materialDigest; delete value.idempotencyKeyDigest; delete value.requestDigest; return value; }
function idempotencyMaterialOf(input) { const value = materialOf(input); delete value.evaluatedAt; return value; }
function requestOf(input) { const value = copy(input); delete value.materialDigest; delete value.idempotencyKeyDigest; delete value.requestDigest; return value; }
function seal(input) {
  input.sourceSetBinding.axisMaterialDigest = hash(axisMaterialOf(input));
  input.materialDigest = hash(materialOf(input));
  input.idempotencyKeyDigest = hash(idempotencyMaterialOf(input));
  input.requestDigest = hash(requestOf(input));
  return input;
}

function fixture() {
  const tenantId = uuid(1); const invoiceId = uuid(10); const versionId = uuid(11); const customerId = uuid(12); const versionDigest = digest(11); const observedAt = '2026-10-29T12:04:00.000000Z';
  return seal({
    schemaVersion: contract.contractVersion, tenantId, resolutionId: uuid(20),
    invoiceBinding: {tenantId, issuedInvoiceId: invoiceId, issuedInvoiceVersionId: versionId, invoiceRevision: 5, invoiceDigest: digest(12), issuedVersionDigest: versionDigest, customerId, customerIdentityDigest: digest(13), currency: 'USD', invoiceState: 'issued_current', documentState: 'customer_safe_current', replacementState: 'none_current', issuedAt: '2026-10-01T12:00:00.000000Z', currentnessState: 'latest_exact_current', observedAt},
    balanceBinding: {tenantId, issuedInvoiceId: invoiceId, issuedVersionDigest: versionDigest, balanceRevision: 7, balanceDigest: digest(14), currency: 'USD', outstandingMinorUnits: 125000, balanceState: 'positive_exact_current', pendingTenderState: 'none_current', currentnessState: 'latest_exact_current', observedAt},
    dueAgingBinding: {tenantId, issuedInvoiceId: invoiceId, issuedVersionDigest: versionDigest, receivableProjectionId: uuid(30), projectionRevision: 4, projectionDigest: digest(15), issuedDueDate: '2026-10-15', asOfBusinessDate: '2026-10-29', agingBucket: 'overdue_1_30', daysPastDue: 14, currentnessState: 'latest_exact_current', observedAt},
    deliveryBinding: {tenantId, issuedInvoiceId: invoiceId, issuedVersionDigest: versionDigest, deliveryEvidenceId: uuid(31), deliveryEvidenceDigest: digest(16), deliveryState: 'delivered_exact_current', currentnessState: 'latest_exact_current', observedAt},
    disputeRefundBinding: {tenantId, issuedInvoiceId: invoiceId, issuedVersionDigest: versionDigest, financialStateRevision: 3, financialStateDigest: digest(17), disputeState: 'clear_exact_current', refundState: 'clear_exact_current', correctionState: 'none_current', currentnessState: 'latest_exact_current', observedAt},
    settlementBinding: {tenantId, issuedInvoiceId: invoiceId, issuedVersionDigest: versionDigest, settlementRevision: 2, settlementDigest: digest(18), allocationDigest: digest(27), settlementState: 'unsettled_exact_current', currentnessState: 'latest_exact_current', observedAt},
    offlinePaymentBinding: {tenantId, issuedInvoiceId: invoiceId, issuedVersionDigest: versionDigest, evidenceKind: 'exact_current_absence', evidence: {absenceProofId: uuid(32), absenceProofDigest: digest(28), sourceSetId: uuid(40), sourceSetDigest: digest(21), snapshotId: uuid(41), snapshotDigest: digest(23), headTransitionId: uuid(42), headTransitionDigest: digest(24), headSequence: 5, offlineReceiptCount: 0}, currentnessState: 'latest_exact_current', observedAt},
    accountingBinding: {tenantId, issuedInvoiceId: invoiceId, issuedVersionDigest: versionDigest, accountingRevision: 2, accountingDigest: digest(19), accountingState: 'current_no_blocking_adjustment', currentnessState: 'latest_exact_current', observedAt},
    customerStateBinding: {tenantId, customerId, customerIdentityDigest: digest(13), issuedInvoiceId: invoiceId, issuedVersionDigest: versionDigest, receivableProjectionId: uuid(30), projectionRevision: 4, projectionDigest: digest(15), contactability: 'contactable', currentnessState: 'latest_exact_current', observedAt},
    sourceSetBinding: {tenantId, issuedInvoiceId: invoiceId, issuedVersionDigest: versionDigest, sourceSetId: uuid(40), sourceSetDigest: digest(21), axisMaterialDigest: digest(22), triggerIds: copy(contract.sourceAndCurrentnessContract.requiredPart4ATriggerIds), snapshotId: uuid(41), snapshotDigest: digest(23), snapshotLineageSequence: 5, headTransitionId: uuid(42), headTransitionDigest: digest(24), headSequence: 5, headState: 'active', effectiveSnapshotId: uuid(41), effectiveSnapshotDigest: digest(23), currentnessResolutionId: uuid(43), currentnessResolutionDigest: digest(25), currentnessState: 'latest_exact_current', observedAt},
    actorAuthorityBinding: {actorId: uuid(50), sessionId: uuid(51), membershipId: uuid(52), sessionSubjectActorId: uuid(50), membershipSubjectActorId: uuid(50), actorTenantId: tenantId, sessionTenantId: tenantId, membershipTenantId: tenantId, actorState: 'active', sessionState: 'active', membershipState: 'active', membershipRoleId: 'owner', capabilityId: 'automation.collection_eligibility.view', capabilityDecisionId: uuid(53), capabilityDecisionDigest: digest(26)},
    evaluatedAt: '2026-10-29T12:05:00.000000Z', materialDigest: digest(90), idempotencyKeyDigest: digest(91), requestDigest: digest(92)
  });
}

function setAging(input, agingBucket, daysPastDue) {
  const asOf = Date.parse(`${input.dueAgingBinding.asOfBusinessDate}T00:00:00.000Z`);
  input.dueAgingBinding.issuedDueDate = new Date(asOf - daysPastDue * 86400000).toISOString().slice(0, 10);
  input.dueAgingBinding.agingBucket = agingBucket;
  input.dueAgingBinding.daysPastDue = daysPastDue;
  return input;
}

function setOfflineReceipt(input, offlineState, eventKind) {
  input.offlinePaymentBinding.evidenceKind = 'exact_current_receipt';
  input.offlinePaymentBinding.evidence = {offlineReceiptId: uuid(33), offlineRevision: 1, offlineDigest: digest(29), offlineState, allocationDigest: input.settlementBinding.allocationDigest, eventKind, eventTime: '2026-10-29T11:55:00.000000Z'};
  return input;
}

function validateEnum(value, values, name) { if (typeof value !== 'string' || !values.includes(value)) throw new Error(name); }
function validateIdentity(value, pattern, name) { if (typeof value !== 'string' || !pattern.test(value)) throw new Error(name); }

function validate(input, trusted) {
  dataGate(input); dataGate(trusted);
  exactKeys(input, contract.resolutionEnvelope.exactFields); exactKeys(input.invoiceBinding, contract.resolutionEnvelope.invoiceBindingExactFields); exactKeys(input.balanceBinding, contract.resolutionEnvelope.balanceBindingExactFields); exactKeys(input.dueAgingBinding, contract.resolutionEnvelope.dueAgingBindingExactFields); exactKeys(input.deliveryBinding, contract.resolutionEnvelope.deliveryBindingExactFields); exactKeys(input.disputeRefundBinding, contract.resolutionEnvelope.disputeRefundBindingExactFields); exactKeys(input.settlementBinding, contract.resolutionEnvelope.settlementBindingExactFields); exactKeys(input.offlinePaymentBinding, contract.resolutionEnvelope.offlinePaymentBindingExactFields); exactKeys(input.accountingBinding, contract.resolutionEnvelope.accountingBindingExactFields); exactKeys(input.customerStateBinding, contract.resolutionEnvelope.customerStateBindingExactFields); exactKeys(input.sourceSetBinding, contract.resolutionEnvelope.sourceSetBindingExactFields); exactKeys(input.actorAuthorityBinding, contract.resolutionEnvelope.actorAuthorityBindingExactFields);
  if (input.offlinePaymentBinding.evidenceKind === 'exact_current_absence') exactKeys(input.offlinePaymentBinding.evidence, contract.resolutionEnvelope.offlineAbsenceProofExactFields); else if (input.offlinePaymentBinding.evidenceKind === 'exact_current_receipt') exactKeys(input.offlinePaymentBinding.evidence, contract.resolutionEnvelope.offlineReceiptEvidenceExactFields); else throw new Error('offline evidence kind');
  if (input.schemaVersion !== contract.contractVersion || JSON.stringify(input) !== JSON.stringify(trusted)) throw new Error('trusted resolution');
  for (const value of [input.tenantId, input.resolutionId, input.invoiceBinding.issuedInvoiceId, input.invoiceBinding.issuedInvoiceVersionId, input.invoiceBinding.customerId, input.dueAgingBinding.receivableProjectionId, input.deliveryBinding.deliveryEvidenceId, input.customerStateBinding.receivableProjectionId, input.sourceSetBinding.sourceSetId, input.sourceSetBinding.snapshotId, input.sourceSetBinding.headTransitionId, input.sourceSetBinding.currentnessResolutionId, input.actorAuthorityBinding.actorId, input.actorAuthorityBinding.sessionId, input.actorAuthorityBinding.membershipId, input.actorAuthorityBinding.capabilityDecisionId]) validateIdentity(value, UUID, 'uuid');
  for (const value of [input.invoiceBinding.invoiceDigest, input.invoiceBinding.issuedVersionDigest, input.invoiceBinding.customerIdentityDigest, input.balanceBinding.balanceDigest, input.dueAgingBinding.projectionDigest, input.deliveryBinding.deliveryEvidenceDigest, input.disputeRefundBinding.financialStateDigest, input.settlementBinding.settlementDigest, input.settlementBinding.allocationDigest, input.accountingBinding.accountingDigest, input.customerStateBinding.projectionDigest, input.sourceSetBinding.sourceSetDigest, input.sourceSetBinding.axisMaterialDigest, input.sourceSetBinding.snapshotDigest, input.sourceSetBinding.headTransitionDigest, input.sourceSetBinding.effectiveSnapshotDigest, input.sourceSetBinding.currentnessResolutionDigest, input.actorAuthorityBinding.capabilityDecisionDigest, input.materialDigest, input.idempotencyKeyDigest, input.requestDigest]) validateIdentity(value, DIGEST, 'digest');
  const invoice = input.invoiceBinding; const invoiceId = invoice.issuedInvoiceId; const versionDigest = invoice.issuedVersionDigest; const tenantId = input.tenantId;
  if (invoice.tenantId !== tenantId || input.sourceSetBinding.tenantId !== tenantId || input.actorAuthorityBinding.actorTenantId !== tenantId || input.actorAuthorityBinding.sessionTenantId !== tenantId || input.actorAuthorityBinding.membershipTenantId !== tenantId || input.actorAuthorityBinding.actorId !== input.actorAuthorityBinding.sessionSubjectActorId || input.actorAuthorityBinding.actorId !== input.actorAuthorityBinding.membershipSubjectActorId) throw new Error('tenant actor');
  for (const axis of ['balanceBinding', 'dueAgingBinding', 'deliveryBinding', 'disputeRefundBinding', 'settlementBinding', 'offlinePaymentBinding', 'accountingBinding']) if (input[axis].tenantId !== tenantId || input[axis].issuedInvoiceId !== invoiceId || input[axis].issuedVersionDigest !== versionDigest) throw new Error('invoice axis');
  if (input.customerStateBinding.tenantId !== tenantId || input.customerStateBinding.customerId !== invoice.customerId || input.customerStateBinding.customerIdentityDigest !== invoice.customerIdentityDigest || input.customerStateBinding.issuedInvoiceId !== invoiceId || input.customerStateBinding.issuedVersionDigest !== versionDigest || input.customerStateBinding.receivableProjectionId !== input.dueAgingBinding.receivableProjectionId || input.customerStateBinding.projectionRevision !== input.dueAgingBinding.projectionRevision || input.customerStateBinding.projectionDigest !== input.dueAgingBinding.projectionDigest || input.customerStateBinding.observedAt !== input.dueAgingBinding.observedAt || input.sourceSetBinding.issuedInvoiceId !== invoiceId || input.sourceSetBinding.issuedVersionDigest !== versionDigest || input.balanceBinding.currency !== invoice.currency || !/^[A-Z]{3}$/.test(invoice.currency)) throw new Error('source binding');
  if (input.sourceSetBinding.effectiveSnapshotId !== input.sourceSetBinding.snapshotId || input.sourceSetBinding.effectiveSnapshotDigest !== input.sourceSetBinding.snapshotDigest || input.sourceSetBinding.headState !== 'active' || !Number.isSafeInteger(input.sourceSetBinding.snapshotLineageSequence) || !Number.isSafeInteger(input.sourceSetBinding.headSequence) || input.sourceSetBinding.snapshotLineageSequence < 1 || input.sourceSetBinding.headSequence < 1 || JSON.stringify(input.sourceSetBinding.triggerIds) !== JSON.stringify(contract.sourceAndCurrentnessContract.requiredPart4ATriggerIds) || input.sourceSetBinding.axisMaterialDigest !== hash(axisMaterialOf(input))) throw new Error('source set');
  for (const key of AXIS_KEYS) validateEnum(input[key].currentnessState, contract.closedStateCatalog.currentnessState, 'currentness'); validateEnum(input.sourceSetBinding.currentnessState, contract.closedStateCatalog.currentnessState, 'currentness');
  validateEnum(invoice.invoiceState, contract.closedStateCatalog.invoiceState, 'invoice'); validateEnum(invoice.documentState, contract.closedStateCatalog.documentState, 'document'); validateEnum(invoice.replacementState, contract.closedStateCatalog.replacementState, 'replacement'); validateEnum(input.balanceBinding.balanceState, contract.closedStateCatalog.balanceState, 'balance'); validateEnum(input.balanceBinding.pendingTenderState, contract.closedStateCatalog.pendingTenderState, 'tender'); validateEnum(input.dueAgingBinding.agingBucket, contract.closedStateCatalog.agingBucket, 'aging'); validateEnum(input.deliveryBinding.deliveryState, contract.closedStateCatalog.deliveryState, 'delivery'); validateEnum(input.disputeRefundBinding.disputeState, contract.closedStateCatalog.disputeState, 'dispute'); validateEnum(input.disputeRefundBinding.refundState, contract.closedStateCatalog.refundState, 'refund'); validateEnum(input.disputeRefundBinding.correctionState, contract.closedStateCatalog.correctionState, 'correction'); validateEnum(input.settlementBinding.settlementState, contract.closedStateCatalog.settlementState, 'settlement'); validateEnum(input.offlinePaymentBinding.evidenceKind, contract.closedStateCatalog.offlineEvidenceKind, 'offline kind'); validateEnum(input.accountingBinding.accountingState, contract.closedStateCatalog.accountingState, 'accounting'); validateEnum(input.customerStateBinding.contactability, contract.closedStateCatalog.contactability, 'contactability');
  for (const value of [invoice.invoiceRevision, input.balanceBinding.balanceRevision, input.dueAgingBinding.projectionRevision, input.disputeRefundBinding.financialStateRevision, input.settlementBinding.settlementRevision, input.accountingBinding.accountingRevision, input.customerStateBinding.projectionRevision]) if (!Number.isSafeInteger(value) || value < 1) throw new Error('revision');
  if (!Number.isSafeInteger(input.balanceBinding.outstandingMinorUnits) || input.balanceBinding.outstandingMinorUnits < 0 || input.balanceBinding.outstandingMinorUnits > contract.bounds.maximumSafeMinorUnits || !Number.isSafeInteger(input.dueAgingBinding.daysPastDue) || input.dueAgingBinding.daysPastDue < contract.bounds.minimumDaysPastDue || input.dueAgingBinding.daysPastDue > contract.bounds.maximumDaysPastDue) throw new Error('amount');
  if (input.balanceBinding.balanceState === 'positive_exact_current' && input.balanceBinding.outstandingMinorUnits === 0) throw new Error('positive balance'); if (input.balanceBinding.balanceState === 'zero_exact_current' && input.balanceBinding.outstandingMinorUnits !== 0) throw new Error('zero balance');
  const evaluated = utcMicros(input.evaluatedAt); if (evaluated === null) throw new Error('time');
  for (const value of [invoice.issuedAt, ...AXIS_KEYS.map(key => input[key].observedAt), input.sourceSetBinding.observedAt]) if (utcMicros(value) === null) throw new Error('time');
  const aggregateObserved = utcMicros(input.sourceSetBinding.observedAt); for (const value of AXIS_KEYS.map(key => input[key].observedAt)) { const observed = utcMicros(value); if (observed > evaluated || observed > aggregateObserved || evaluated - observed > BigInt(contract.bounds.maximumSourceObservationAgeSeconds) * 1000000n) throw new Error('observation'); } if (aggregateObserved > evaluated || evaluated - aggregateObserved > BigInt(contract.bounds.maximumSourceObservationAgeSeconds) * 1000000n) throw new Error('observation');
  const dueDay = dateDay(input.dueAgingBinding.issuedDueDate); const asOfDay = dateDay(input.dueAgingBinding.asOfBusinessDate); if (dueDay === null || asOfDay === null) throw new Error('due date');
  const elapsedDays = Number(asOfDay - dueDay); if (input.dueAgingBinding.daysPastDue !== elapsedDays) throw new Error('due coherence');
  const bucket = input.dueAgingBinding.agingBucket; const coherentBucket = (bucket === 'not_due' && elapsedDays < 0) || (bucket === 'due_today' && elapsedDays === 0) || (bucket === 'overdue_1_30' && elapsedDays >= 1 && elapsedDays <= 30) || (bucket === 'overdue_31_60' && elapsedDays >= 31 && elapsedDays <= 60) || (bucket === 'overdue_61_90' && elapsedDays >= 61 && elapsedDays <= 90) || (bucket === 'overdue_91_plus' && elapsedDays >= 91); if (!coherentBucket) throw new Error('due coherence');
  const offline = input.offlinePaymentBinding; if (offline.evidenceKind === 'exact_current_absence') { const evidence = offline.evidence; for (const value of [evidence.absenceProofId, evidence.sourceSetId, evidence.snapshotId, evidence.headTransitionId]) validateIdentity(value, UUID, 'offline uuid'); for (const value of [evidence.absenceProofDigest, evidence.sourceSetDigest, evidence.snapshotDigest, evidence.headTransitionDigest]) validateIdentity(value, DIGEST, 'offline digest'); if (evidence.sourceSetId !== input.sourceSetBinding.sourceSetId || evidence.sourceSetDigest !== input.sourceSetBinding.sourceSetDigest || evidence.snapshotId !== input.sourceSetBinding.snapshotId || evidence.snapshotDigest !== input.sourceSetBinding.snapshotDigest || evidence.headTransitionId !== input.sourceSetBinding.headTransitionId || evidence.headTransitionDigest !== input.sourceSetBinding.headTransitionDigest || evidence.headSequence !== input.sourceSetBinding.headSequence || evidence.offlineReceiptCount !== 0) throw new Error('offline absence proof'); } else { const evidence = offline.evidence; validateIdentity(evidence.offlineReceiptId, UUID, 'offline uuid'); for (const value of [evidence.offlineDigest, evidence.allocationDigest]) validateIdentity(value, DIGEST, 'offline digest'); const eventTime = utcMicros(evidence.eventTime); if (!Number.isSafeInteger(evidence.offlineRevision) || evidence.offlineRevision < 1 || eventTime === null || eventTime > utcMicros(offline.observedAt)) throw new Error('offline receipt'); validateEnum(evidence.offlineState, contract.closedStateCatalog.offlineState, 'offline state'); validateEnum(evidence.eventKind, contract.closedStateCatalog.offlineEventKind, 'offline event'); const eventState = {cash_received: 'offline_received', check_received: 'check_clearance_unknown', check_cleared: 'check_cleared', check_returned: 'check_returned', offline_reversed: 'offline_reversed'}; if (eventState[evidence.eventKind] !== evidence.offlineState || evidence.allocationDigest !== input.settlementBinding.allocationDigest) throw new Error('offline receipt binding'); }
  if (!['active'].includes(input.actorAuthorityBinding.actorState) || input.actorAuthorityBinding.sessionState !== 'active' || input.actorAuthorityBinding.membershipState !== 'active' || input.actorAuthorityBinding.membershipRoleId !== 'owner' || input.actorAuthorityBinding.capabilityId !== 'automation.collection_eligibility.view') throw new Error('actor');
  if (Buffer.byteLength(JSON.stringify(input)) > contract.bounds.maximumCanonicalRequestBytes || input.materialDigest !== hash(materialOf(input)) || input.idempotencyKeyDigest !== hash(idempotencyMaterialOf(input)) || input.requestDigest !== hash(requestOf(input))) throw new Error('digest');
}

function decision(input) {
  const currentness = [...AXIS_KEYS.map(key => input[key].currentnessState), input.sourceSetBinding.currentnessState];
  if (currentness.some(state => state !== 'latest_exact_current')) return contract.decisionPrecedence[0];
  if (input.invoiceBinding.invoiceState !== 'issued_current' || input.invoiceBinding.documentState !== 'customer_safe_current' || input.invoiceBinding.replacementState !== 'none_current') return contract.decisionPrecedence[1];
  if (input.balanceBinding.balanceState !== 'positive_exact_current' || input.balanceBinding.outstandingMinorUnits <= 0 || input.balanceBinding.pendingTenderState !== 'none_current') return contract.decisionPrecedence[2];
  if (input.deliveryBinding.deliveryState !== 'delivered_exact_current') return contract.decisionPrecedence[4];
  if (input.disputeRefundBinding.disputeState !== 'clear_exact_current' || input.disputeRefundBinding.refundState !== 'clear_exact_current' || input.disputeRefundBinding.correctionState !== 'none_current') return contract.decisionPrecedence[5];
  const offlineClear = input.offlinePaymentBinding.evidenceKind === 'exact_current_absence' || (input.offlinePaymentBinding.evidenceKind === 'exact_current_receipt' && ['offline_received', 'check_cleared'].includes(input.offlinePaymentBinding.evidence.offlineState));
  if (input.settlementBinding.settlementState !== 'unsettled_exact_current' || !offlineClear) return contract.decisionPrecedence[6];
  if (input.accountingBinding.accountingState !== 'current_no_blocking_adjustment') return contract.decisionPrecedence[7];
  if (input.customerStateBinding.contactability !== 'contactable') return contract.decisionPrecedence[8];
  return contract.decisionPrecedence[9];
}

function project(input, trusted) {
  validate(input, trusted); const outcome = decision(input);
  return Object.freeze({schemaVersion: contract.contractVersion, tenantId: input.tenantId, resolutionId: input.resolutionId, issuedInvoiceId: input.invoiceBinding.issuedInvoiceId, issuedVersionDigest: input.invoiceBinding.issuedVersionDigest, resultState: outcome.result, reasonCode: outcome.reasonCode, fixedLabel: outcome.fixedLabel, mountedResolverAvailable: false, currentLiveResult: contract.currentAvailability.currentLiveResult, ownerReadableProjectionOnly: true, eligibilityRecordCreated: false, collectionReviewRecordCreated: false, worklistRecordCreated: false, taskCreated: false, messageCreated: false, providerAttemptCreated: false, financialMutationCreated: false, accountingMutationCreated: false, balanceMutationCreated: false, externalEffectCreated: false, upstreamMutationCreated: false, moneyEffectCreated: false});
}

class History {
  constructor() { this.byId = new Map(); this.byStable = new Map(); }
  record(input, trusted) {
    const output = project(input, trusted); const previous = this.byId.get(input.resolutionId);
    if (previous) { if (previous.requestDigest !== input.requestDigest) throw new Error('identity conflict'); return Object.freeze({...previous, replayed: true}); }
    if (this.byStable.has(input.idempotencyKeyDigest)) throw new Error('clone');
    const stored = Object.freeze({...output, requestDigest: input.requestDigest, materialDigest: input.materialDigest, idempotencyKeyDigest: input.idempotencyKeyDigest, replayed: false}); this.byId.set(input.resolutionId, stored); this.byStable.set(input.idempotencyKeyDigest, input.resolutionId); return stored;
  }
}

describe('Mission 28 Part 11A collection eligibility', () => {
  test('binds exact Part10D release provenance and all frozen controlling inputs', () => {
    expect(contract.authority).toMatchObject({part: '11A', state: 'implementation_candidate_only', baselineCommit: '99aee0958d1e7c4097f0a534c8fa6461766b7784', baselineTree: '524169816689bde1f685ac4bd8bcbc09c303fdc0'});
    expect(contract.part10DRelease).toEqual({acceptedSourceHead: '9353c69c176aac4c777804c4da8fe897f2b84b6f', acceptedTree: '524169816689bde1f685ac4bd8bcbc09c303fdc0', freshAudit: 'third_fresh_isolated_audit_P0_P1_P2_P3_zero', freshAuditEvidence: 'exact_Node_22.23.3; focused_14_of_14; cumulative_44_suites_602_tests; migration_history_2_suites_40_tests; syntax_44; JSON_43; protected_0', pullRequest: 592, mergedMain: '99aee0958d1e7c4097f0a534c8fa6461766b7784', deploymentIdentity: '77f306ac-caf3-44ee-bcd5-6a8ea4ca0239_SUCCESS', imageIdentity: 'sha256:37afa2e518ae71a1cfef11aadc9f59f087f706ca9438c3e4bfd03fb43058d310', runningInstance: 'e396317c-8684-4203-92d4-46007ed9a184', migrationEvidence: 'source_283_through_287_no_288; direct_applied_history_not_requeried_and_unclaimed', healthEvidence: 'canonical_startup_ready; api_health_root_dashboard_demo_HTTP_200; database_and_canonicalPersistence_healthy; dashboard_demo_exact_91314_byte_sha256_ab65083c5dd9bac308798171df2e65f711e89df9a6864ea15b569bf9f64ab757_parity'});
    expect(contract.frozenInputs).toHaveLength(16); for (const item of contract.frozenInputs) expect(digestLf(item.path)).toBe(item.normalizedLfSha256);
  });

  test('freezes all separately trusted axes and yields owner-review eligibility without effect authority', () => {
    const input = fixture(); const output = project(input, copy(input));
    expect(output).toMatchObject({resultState: 'eligible_for_owner_collection_review_only', reasonCode: 'exact_current_collection_review_eligible', mountedResolverAvailable: false, currentLiveResult: 'ineligible_source_authority_unavailable', ownerReadableProjectionOnly: true, collectionReviewRecordCreated: false, messageCreated: false, moneyEffectCreated: false});
    expect(contract.sourceAndCurrentnessContract.axisRule).toMatch(/separate exact-current trusted axes/); expect(contract.currentAvailability.completeMountedMission27SourceResolver).toBe(false);
  });

  test('preserves the exact Mission27 pre-due due-today and overdue vocabulary as evidence for later Part11B policy only', () => {
    expect(contract.closedStateCatalog.agingBucket).toEqual(['not_due','due_today','overdue_1_30','overdue_31_60','overdue_61_90','overdue_91_plus']);
    expect(contract.closedStateCatalog.contactability).toEqual(['contactable','not_contactable','unknown']);
    for (const [bucket, days] of [['not_due', -1], ['due_today', 0], ['overdue_1_30', 1], ['overdue_1_30', 30], ['overdue_31_60', 31], ['overdue_31_60', 60], ['overdue_61_90', 61], ['overdue_61_90', 90], ['overdue_91_plus', 91]]) {
      const input = setAging(fixture(), bucket, days); seal(input); const output = project(input, copy(input));
      expect(output).toMatchObject({resultState: 'eligible_for_owner_collection_review_only', currentLiveResult: 'ineligible_source_authority_unavailable', ownerReadableProjectionOnly: true, messageCreated: false, providerAttemptCreated: false, externalEffectCreated: false, moneyEffectCreated: false});
    }
    expect(contract.sourceAndCurrentnessContract.canonicalAgingRule).toMatch(/every bucket is evidence.*never permission/);
    expect(contract.sourceAndCurrentnessContract.canonicalContactabilityRule).toMatch(/even contactable never authorizes communication/);
  });

  test('fails closed on stale unknown or incoherent due-aging and unsupported contactability evidence', () => {
    const stale = fixture(); stale.dueAgingBinding.currentnessState = 'stale'; seal(stale); expect(project(stale, copy(stale)).resultState).toBe('ineligible_source_authority_unavailable');
    for (const mutation of [value => { value.dueAgingBinding.agingBucket = 'unknown'; }, value => { value.dueAgingBinding.agingBucket = '1_30_days'; }, value => { value.dueAgingBinding.daysPastDue = 13; }, value => { value.dueAgingBinding.agingBucket = 'due_today'; }, value => { setAging(value, 'overdue_31_60', 30); }, value => { setAging(value, 'overdue_1_30', 31); }, value => { value.dueAgingBinding.issuedDueDate = '2026-02-30'; }]) { const input = fixture(); mutation(input); seal(input); expect(() => project(input, copy(input))).toThrow(); }
    for (const contactability of ['not_contactable', 'unknown']) { const input = fixture(); input.customerStateBinding.contactability = contactability; seal(input); expect(project(input, copy(input)).resultState).toBe('ineligible_customer_state'); }
  });

  test('requires independent exact-current canonical offline-payment absence authority', () => {
    expect(contract.sourceAndCurrentnessContract.requiredPart4ATriggerIds).toContain('m27.offline_payment_state');
    expect(contract.sourceAndCurrentnessContract.offlinePaymentRule).toMatch(/zero offline receipts.*cash-received.*check-cleared.*fails closed/);
    const clear = fixture(); expect(project(clear, copy(clear)).resultState).toBe('eligible_for_owner_collection_review_only');
    const stale = fixture(); stale.offlinePaymentBinding.currentnessState = 'stale'; seal(stale); expect(project(stale, copy(stale)).resultState).toBe('ineligible_source_authority_unavailable');
    for (const mutation of [value => { value.offlinePaymentBinding.evidence.offlineReceiptCount = 1; }, value => { value.offlinePaymentBinding.evidence.sourceSetId = uuid(99); }, value => { value.offlinePaymentBinding.evidence.snapshotDigest = digest(99); }, value => { value.offlinePaymentBinding.evidence.headSequence += 1; }]) { const input = fixture(); mutation(input); seal(input); expect(() => project(input, copy(input))).toThrow('offline absence proof'); }
    for (const [offlineState, eventKind] of [['offline_received','cash_received'], ['check_cleared','check_cleared']]) { const input = setOfflineReceipt(fixture(), offlineState, eventKind); seal(input); expect(project(input, copy(input)).resultState).toBe('eligible_for_owner_collection_review_only'); }
    for (const [offlineState, eventKind] of [['check_clearance_unknown','check_received'], ['check_returned','check_returned'], ['offline_reversed','offline_reversed']]) { const input = setOfflineReceipt(fixture(), offlineState, eventKind); seal(input); expect(project(input, copy(input)).resultState).toBe('ineligible_settlement'); }
    const unknown = setOfflineReceipt(fixture(), 'unknown', 'check_received'); seal(unknown); expect(() => project(unknown, copy(unknown))).toThrow('offline state');
    const allocationGraft = setOfflineReceipt(fixture(), 'check_clearance_unknown', 'check_received'); allocationGraft.offlinePaymentBinding.evidence.allocationDigest = digest(99); seal(allocationGraft); expect(() => project(allocationGraft, copy(allocationGraft))).toThrow('offline receipt binding');
    const futureEvent = setOfflineReceipt(fixture(), 'check_cleared', 'check_cleared'); futureEvent.offlinePaymentBinding.evidence.eventTime = '2026-10-29T12:04:00.000001Z'; seal(futureEvent); expect(() => project(futureEvent, copy(futureEvent))).toThrow('offline receipt');
  });

  test('applies the closed fail-closed precedence across invoice balance due delivery correction settlement accounting and customer state', () => {
    const cases = [
      [value => { value.invoiceBinding.currentnessState = 'unavailable'; }, 'ineligible_source_authority_unavailable'],
      [value => { value.invoiceBinding.invoiceState = 'draft'; }, 'ineligible_invoice'],
      [value => { value.invoiceBinding.invoiceState = 'void'; }, 'ineligible_invoice'],
      [value => { value.invoiceBinding.replacementState = 'replaced'; }, 'ineligible_invoice'],
      [value => { value.balanceBinding.balanceState = 'zero_exact_current'; value.balanceBinding.outstandingMinorUnits = 0; }, 'ineligible_balance'],
      [value => { value.balanceBinding.pendingTenderState = 'uncertain'; }, 'ineligible_balance'],
      [value => { value.deliveryBinding.deliveryState = 'unknown'; }, 'ineligible_delivery'],
      [value => { value.disputeRefundBinding.disputeState = 'active'; }, 'ineligible_dispute_refund_or_correction'],
      [value => { value.disputeRefundBinding.refundState = 'pending'; }, 'ineligible_dispute_refund_or_correction'],
      [value => { setOfflineReceipt(value, 'check_clearance_unknown', 'check_received'); }, 'ineligible_settlement'],
      [value => { value.accountingBinding.accountingState = 'pending_adjustment'; }, 'ineligible_accounting'],
      [value => { value.customerStateBinding.contactability = 'not_contactable'; }, 'ineligible_customer_state']
    ];
    for (const [mutation, expected] of cases) { const input = fixture(); mutation(input); seal(input); expect(project(input, copy(input)).resultState).toBe(expected); }
  });

  test('denies cross-tenant customer invoice version currency and aggregate-source grafts', () => {
    const mutations = [value => { value.balanceBinding.tenantId = uuid(99); }, value => { value.deliveryBinding.issuedInvoiceId = uuid(99); }, value => { value.offlinePaymentBinding.tenantId = uuid(99); }, value => { value.offlinePaymentBinding.issuedVersionDigest = digest(99); }, value => { value.accountingBinding.issuedVersionDigest = digest(99); }, value => { value.balanceBinding.currency = 'EUR'; }, value => { value.customerStateBinding.customerId = uuid(99); }, value => { value.customerStateBinding.customerIdentityDigest = digest(99); }, value => { value.customerStateBinding.projectionDigest = digest(99); }, value => { value.sourceSetBinding.issuedInvoiceId = uuid(99); }, value => { value.sourceSetBinding.effectiveSnapshotId = uuid(99); }, value => { value.sourceSetBinding.triggerIds = [...value.sourceSetBinding.triggerIds].reverse(); }];
    for (const mutation of mutations) { const input = fixture(); mutation(input); seal(input); expect(() => project(input, copy(input))).toThrow(); }
  });

  test('binds the complete axis material digest and denies hidden axis substitution', () => {
    const input = fixture(); input.balanceBinding.balanceDigest = digest(99); input.materialDigest = hash(materialOf(input)); input.idempotencyKeyDigest = hash(idempotencyMaterialOf(input)); input.requestDigest = hash(requestOf(input)); expect(() => project(input, copy(input))).toThrow('source set');
    const coherent = fixture(); coherent.balanceBinding.balanceDigest = digest(99); seal(coherent); expect(project(coherent, copy(coherent)).resultState).toBe('eligible_for_owner_collection_review_only');
  });

  test('requires recent trusted observations without allowing timestamps to establish precedence', () => {
    const threshold = fixture(); for (const key of AXIS_KEYS) threshold[key].observedAt = '2026-10-29T12:00:00.000000Z'; threshold.sourceSetBinding.observedAt = '2026-10-29T12:00:00.000000Z'; seal(threshold); expect(project(threshold, copy(threshold)).resultState).toBe('eligible_for_owner_collection_review_only');
    for (const observedAt of ['2026-10-29T11:59:59.999999Z', '2026-10-29T12:05:00.000001Z']) { const input = fixture(); input.deliveryBinding.observedAt = observedAt; seal(input); expect(() => project(input, copy(input))).toThrow('observation'); }
    const newerTimestampStaleHead = fixture(); newerTimestampStaleHead.sourceSetBinding.headState = 'superseded'; seal(newerTimestampStaleHead); expect(() => project(newerTimestampStaleHead, copy(newerTimestampStaleHead))).toThrow('source set');
  });

  test('requires canonical primitive identities amounts and closed states without coercion', () => {
    const mutations = [value => { value.invoiceBinding.issuedInvoiceId = 'invoice-10'; }, value => { value.invoiceBinding.invoiceDigest = 'abc'; }, value => { value.invoiceBinding.currency = 'usd'; }, value => { value.balanceBinding.outstandingMinorUnits = '125000'; }, value => { value.balanceBinding.outstandingMinorUnits = -1; }, value => { value.balanceBinding.balanceState = 'paid_enough'; }, value => { value.dueAgingBinding.daysPastDue = 1.5; }, value => { value.dueAgingBinding.agingBucket = '1_30_days'; }, value => { value.customerStateBinding.contactability = 'reviewable_not_communication_authorized'; }, value => { value.deliveryBinding.deliveryState = 'customer@example.test'; }, value => { value.accountingBinding.accountingState = null; }];
    for (const mutation of mutations) { const input = fixture(); mutation(input); seal(input); expect(() => project(input, copy(input))).toThrow(); }
  });

  test('uses separately trusted material and denies same-tenant candidate retargeting after redigest', () => {
    const trusted = fixture();
    for (const mutation of [value => { value.invoiceBinding.invoiceState = 'issued_current'; value.invoiceBinding.issuedInvoiceId = uuid(99); }, value => { value.balanceBinding.outstandingMinorUnits += 1; }, value => { value.deliveryBinding.deliveryEvidenceDigest = digest(99); }, value => { value.sourceSetBinding.headSequence += 1; }]) { const candidate = copy(trusted); mutation(candidate); seal(candidate); expect(() => project(candidate, trusted)).toThrow('trusted resolution'); }
  });

  test('requires exact active owner actor session membership and capability binding', () => {
    const mutations = [value => { value.actorAuthorityBinding.sessionSubjectActorId = uuid(90); }, value => { value.actorAuthorityBinding.membershipSubjectActorId = uuid(91); }, value => { value.actorAuthorityBinding.membershipTenantId = uuid(99); }, value => { value.actorAuthorityBinding.actorState = 'suspended'; }, value => { value.actorAuthorityBinding.sessionState = 'revoked'; }, value => { value.actorAuthorityBinding.membershipRoleId = 'admin'; }, value => { value.actorAuthorityBinding.capabilityId = 'automation.policy.activate'; }];
    for (const mutation of mutations) { const input = fixture(); mutation(input); seal(input); expect(() => project(input, copy(input))).toThrow(); }
  });

  test('uses stable semantic idempotency and denies clone or conflicting replay reuse', () => {
    const history = new History(); const first = fixture(); expect(history.record(first, copy(first)).replayed).toBe(false); expect(history.record(copy(first), copy(first)).replayed).toBe(true);
    const clone = copy(first); clone.resolutionId = uuid(99); clone.evaluatedAt = '2026-10-29T12:08:00.000000Z'; for (const key of AXIS_KEYS) clone[key].observedAt = '2026-10-29T12:07:00.000000Z'; clone.sourceSetBinding.observedAt = '2026-10-29T12:07:00.000000Z'; seal(clone); expect(clone.idempotencyKeyDigest).not.toBe(first.idempotencyKeyDigest);
    const semanticClone = copy(first); semanticClone.resolutionId = uuid(99); semanticClone.evaluatedAt = '2026-10-29T12:08:00.000000Z'; seal(semanticClone); expect(semanticClone.idempotencyKeyDigest).toBe(first.idempotencyKeyDigest); expect(() => history.record(semanticClone, copy(semanticClone))).toThrow('clone');
    const conflict = copy(first); conflict.evaluatedAt = '2026-10-29T12:08:00.000000Z'; seal(conflict); expect(conflict.idempotencyKeyDigest).toBe(first.idempotencyKeyDigest); expect(() => history.record(conflict, copy(conflict))).toThrow('identity conflict');
  });

  test('rejects extra missing accessor symbol proxy toJSON custom-prototype sparse and alias data before hooks', () => {
    for (const mutation of [value => { value.extra = 'x'; }, value => { delete value.requestDigest; }, value => { delete value.offlinePaymentBinding; }, value => { value.invoiceBinding.toJSON = () => ({}); }, value => { Object.setPrototypeOf(value.balanceBinding, {}); }, value => { value.deliveryBinding = value.balanceBinding; }]) { const input = fixture(); mutation(input); expect(() => project(input, fixture())).toThrow(); }
    let getters = 0; const accessor = fixture(); Object.defineProperty(accessor.invoiceBinding, 'invoiceState', {enumerable: true, get() { getters += 1; return 'issued_current'; }}); expect(() => project(accessor, fixture())).toThrow(); expect(getters).toBe(0);
    const symbol = fixture(); symbol[Symbol('secret')] = 'sk_secret'; expect(() => project(symbol, fixture())).toThrow();
    let traps = 0; const proxy = new Proxy(fixture(), {get() { traps += 1; throw new Error('trap'); }, ownKeys() { traps += 1; throw new Error('trap'); }}); expect(() => project(proxy, fixture())).toThrow(); expect(traps).toBe(0);
    const sparse = fixture(); sparse.sourceSetBinding.triggerIds = []; sparse.sourceSetBinding.triggerIds[4] = 'm27.reviewed_collection_handoff'; expect(() => project(sparse, fixture())).toThrow();
  });

  test('uses fixed nonreflective labels and produces zero records messages mutations or effects', () => {
    for (const item of contract.decisionPrecedence) expect(item.fixedLabel).not.toMatch(/@|phone|token|sk_|customerName|invoiceNumber|description|note|urgent|[0-9]{4,}/i);
    for (const key of Object.keys(contract.privacyAndEffects)) expect(contract.privacyAndEffects[key]).toBe(0);
    const output = project(fixture(), fixture()); for (const key of ['eligibilityRecordCreated','collectionReviewRecordCreated','worklistRecordCreated','taskCreated','messageCreated','providerAttemptCreated','financialMutationCreated','accountingMutationCreated','balanceMutationCreated','externalEffectCreated','upstreamMutationCreated','moneyEffectCreated']) expect(output[key]).toBe(false);
  });

  test('freezes docs-tests-only boundary with migration287 latest and no288', () => {
    expect(contract.runtimeBoundary).toMatchObject({newMigration: false, newTableFunctionRouteOrUi: false, mountedEligibilityResolver: false, collectionReviewWorklistOrTaskCreator: false, nextMigrationAbsent: '288'});
    const migrations = fs.readdirSync(path.join(ROOT, 'migrations')).filter(name => /^\d+_/.test(name)).sort(); expect(migrations.at(-1)).toBe('287_canonical_automation_estimate_quote_resolution_v1.sql'); expect(migrations.some(name => name.startsWith('288_'))).toBe(false);
  });

  test('roadmap and ledger record Part10D released Part11A candidate and later slices planned', () => {
    const roadmap = fs.readFileSync(ROADMAP, 'utf8'); const ledger = fs.readFileSync(LEDGER, 'utf8'); const markdown = fs.readFileSync(CONTRACT_MD, 'utf8');
    for (const document of [roadmap, ledger]) { expect(document).toContain('Parts 1A–10D are released. Part 11A is the sole implementation candidate.'); expect(document).toContain('Parts 11B–14G remain planned and unimplemented.'); for (const identity of ['9353c69c176aac4c777804c4da8fe897f2b84b6f','99aee0958d1e7c4097f0a534c8fa6461766b7784','77f306ac-caf3-44ee-bcd5-6a8ea4ca0239','sha256:37afa2e518ae71a1cfef11aadc9f59f087f706ca9438c3e4bfd03fb43058d310','e396317c-8684-4203-92d4-46007ed9a184','ab65083c5dd9bac308798171df2e65f711e89df9a6864ea15b569bf9f64ab757']) expect(document).toContain(identity); expect(document).toMatch(/direct applied-history re-query was not repeated.*unavailable/i); }
    expect(ledger).toContain('| 44 | 10D | Response handoff and source correction cancellation | **Released** |'); expect(ledger).toContain('| 45 | 11A | Exact-current issued-invoice collection eligibility | **Implementation candidate** |'); expect((ledger.match(/\*\*Implementation candidate\*\*/g) || [])).toHaveLength(1); expect((ledger.match(/Planned \/ unimplemented/g) || [])).toHaveLength(21); expect(markdown).toContain('Migration 287 remains latest and migration 288 is absent.');
  });
});
