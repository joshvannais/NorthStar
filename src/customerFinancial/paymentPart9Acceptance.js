'use strict';

const providerBoundary = require('./paymentProviderBoundary');
const part7Contract = require('./paymentPart7Acceptance');
const paymentAttempt = require('./paymentAttemptAllocationOverpayment');
const depositApplication = require('./depositApplication');
const creditRefund = require('./creditRefundReadiness');
const offlinePayment = require('./offlinePaymentReadiness');
const paymentOutcome = require('./paymentOutcomeReadiness');

const CONTRACT_VERSION = 'm27-payment-part9-acceptance-v1';
const BUNDLE_VERSION = 'm27-payment-part9-preview-bundle-v1';
const REASON = 'part9_financial_evidence_unavailable';
const SOURCE_PARTS = Object.freeze([
  Object.freeze({ part: '9A', contractVersion: paymentAttempt.CONTRACT_VERSION,
    reason: paymentAttempt.REASON }),
  Object.freeze({ part: '9B', contractVersion: depositApplication.CONTRACT_VERSION,
    reason: depositApplication.REASON }),
  Object.freeze({ part: '9C', contractVersion: creditRefund.CONTRACT_VERSION,
    reason: creditRefund.REASON }),
  Object.freeze({ part: '9D', contractVersion: offlinePayment.CONTRACT_VERSION,
    reason: offlinePayment.REASON }),
  Object.freeze({ part: '9E', contractVersion: paymentOutcome.CONTRACT_VERSION,
    reason: paymentOutcome.REASON }),
]);

function exact(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    Object.keys(value).every(key => keys.includes(key));
}

function policy() {
  const launch = providerBoundary.validateLaunchPolicy();
  const accounting = launch.financial?.accounting;
  const numbering = launch.financial?.numbering;
  const exportControl = launch.actionControl?.['customer_financial.accounting.export'];
  const reconcileControl = launch.actionControl?.['customer_financial.accounting.reconcile'];
  const recovery = launch.actionControl?.['customer_financial.record.recover'];
  const performance = launch.performance;
  if (launch.team?.roleAloneAuthorizes !== false ||
      accounting?.adapter !== 'quickbooks_online.accounting_export.v1' ||
      accounting.supportedMode !== 'sandbox' || accounting.currentRuntimeAvailable !== false ||
      accounting.mayInventChartOfAccounts !== false ||
      accounting.mayDecideRecognitionOrTax !== false || accounting.maySupplyCheckClearance !== false ||
      numbering?.receipt !== 'RCT-{tenant_monotonic_10_digit_sequence}' ||
      numbering.reuseAllowed !== false || numbering.gapsAllowed !== true ||
      numbering.yearResetAllowed !== false || exportControl?.mode !== 'conditional_dual_control' ||
      exportControl.maximumRecords !== 1000 || exportControl.maximumMinorUnits !== '100000000' ||
      JSON.stringify(exportControl.singleControlAllowedWhen) !== JSON.stringify([
        'record_count_lte_100','absolute_total_minor_units_lte_10000000',
        'exact_current_minimized_fact_set','current_receiving_adapter']) ||
      JSON.stringify(exportControl.dualControlRequiredWhen) !== JSON.stringify([
        'record_count_gt_100_and_lte_1000',
        'absolute_total_minor_units_gt_10000000_and_lte_100000000']) ||
      reconcileControl?.mode !== 'dual_control' || reconcileControl.singleControlAllowed !== false ||
      JSON.stringify(reconcileControl.appliesTo) !== JSON.stringify([
        'manual_match','manual_mismatch_resolution','manual_books_status_override']) ||
      reconcileControl.adapterAcknowledgementIsHumanAction !== false ||
      recovery?.mode !== 'conditional_dual_control' ||
      JSON.stringify(recovery.singleControlAllowedWhen) !== JSON.stringify([
        'read_only_receipt_lookup','no_external_effect','no_financial_effect',
        'exact_original_request_and_receipt']) ||
      JSON.stringify(recovery.dualControlRequiredWhen) !== JSON.stringify([
        'may_create_or_restore_external_effect','may_create_or_restore_financial_effect']) ||
      recovery.effectMayExceedOriginalRequest !== false ||
      performance?.concurrentWriterPerAggregate !== 1 ||
      performance.maximumAccountingExportRecords !== 1000 ||
      performance.maximumAccountingExportMinorUnits !== '100000000' ||
      performance.singleControlAccountingExportRecords !== 100 ||
      performance.singleControlAccountingExportMinorUnits !== '10000000') {
    throw new Error('Payment Part 9 acceptance policy invalid');
  }
  return launch;
}

function sourceParts(sources) {
  return SOURCE_PARTS.map((expected, index) => Object.freeze({
    part: expected.part,
    contractVersion: expected.contractVersion,
    state: 'unavailable',
    reason: expected.reason,
    digest: providerBoundary.digest(sources[index]),
  }));
}

function defaultSources(part7) {
  const attempt = paymentAttempt.unavailable();
  const deposit = depositApplication.unavailable(depositApplication.unavailableOrigin(), attempt);
  const correction = creditRefund.unavailable(undefined, attempt);
  const offline = offlinePayment.unavailable(correction);
  const outcome = paymentOutcome.unavailable(offline);
  return { paymentAttempt: attempt, depositApplication: deposit,
    creditRefund: correction, offlinePayment: offline, paymentOutcome: outcome };
}

function unavailable(mode, part7Raw, sourcesRaw = {}, upstream) {
  const part7 = part7Contract.projectBundle(part7Raw, mode);
  const defaults = defaultSources(part7);
  const attemptRaw = sourcesRaw.paymentAttempt || defaults.paymentAttempt;
  const depositRaw = sourcesRaw.depositApplication || defaults.depositApplication;
  const correctionRaw = sourcesRaw.creditRefund || defaults.creditRefund;
  const offlineRaw = sourcesRaw.offlinePayment || defaults.offlinePayment;
  const outcomeRaw = sourcesRaw.paymentOutcome || defaults.paymentOutcome;
  const attempt = upstream ? paymentAttempt.projectWithSources(attemptRaw,
    upstream.paymentInitiationPlan, upstream.settlementPayout) : paymentAttempt.project(attemptRaw);
  const deposit = upstream ? depositApplication.projectWithSources(depositRaw,
    upstream.invoiceDraftOrigin, attempt) : depositApplication.project(depositRaw);
  const correction = upstream ? creditRefund.projectWithSources(correctionRaw,
    upstream.postIssueCorrection, attempt) : creditRefund.project(correctionRaw);
  const offline = upstream ? offlinePayment.projectWithSource(offlineRaw, correction) :
    offlinePayment.project(offlineRaw);
  const outcome = upstream ? paymentOutcome.projectWithSource(outcomeRaw, offline) :
    paymentOutcome.project(outcomeRaw);
  policy();
  if ((mode === 'paid' && (attempt.sourceWitnesses.paymentInitiationPlanDigest !==
        part7.part7Acceptance.sourceWitnesses.paymentInitiationDigest ||
      correction.sourceWitnesses.postIssueCorrectionDigest !==
        providerBoundary.digest(part7.part5Acceptance.postIssueCorrection))) ||
      deposit.sourceWitnesses.paymentAttemptAllocationDigest !== providerBoundary.digest(attempt) ||
      correction.sourceWitnesses.paymentAttemptAllocationDigest !== providerBoundary.digest(attempt) ||
      offline.sourceWitness.creditRefundReadinessDigest !== providerBoundary.digest(correction) ||
      outcome.sourceWitness.offlinePaymentReadinessDigest !== providerBoundary.digest(offline)) {
    throw new Error('Payment Part 9 source lineage invalid');
  }
  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    policyVersion: providerBoundary.POLICY_VERSION,
    policyDigest: providerBoundary.POLICY_DIGEST,
    state: 'unavailable',
    reason: REASON,
    mode,
    fictional: mode === 'demo',
    previewWitness: part7.part7Acceptance.previewWitness,
    sourceParts: Object.freeze(sourceParts([attempt, deposit, correction, offline, outcome])),
    concurrency: Object.freeze({
      state: 'unavailable', reason: paymentAttempt.REASON,
      maximumConcurrentWriterPerAggregate: 1,
      exactAggregateRevisionRequired: true,
      exactRequestDigestAndIdempotencyReceiptRequired: true,
      sameKeyChangedRequestConflicts: true,
      duplicateOrReplayMayRepeatEffect: false,
      arrivalOrderMayAuthorizeEffect: false,
      settledMoneyMayBeRefusedRetroactively: false,
      crossAxisSilentOverwriteAllowed: false,
      missingAmountOrEvidenceMayBecomeZero: false,
    }),
    correctionRecovery: Object.freeze({
      state: 'unavailable', reason: 'source_authority_unavailable', value: null,
      correctionsAreAppendOnly: true,
      priorAcceptedEvidenceMayBeRewritten: false,
      exactOriginalRequestAndReceiptRequired: true,
      readOnlyLookupRequiresNoExternalOrFinancialEffect: true,
      restoringExternalOrFinancialEffectRequiresDualControl: true,
      recoveryMayExceedOriginalRequest: false,
      sourceCorrectionOrReopeningRequiresCurrentProjection: true,
      staleOrChangedSourceClearsRenderedFinancialState: true,
      recoveryReceiptIdentity: null,
    }),
    customerReceipt: Object.freeze({
      state: 'unavailable', reason: 'source_authority_unavailable', value: null,
      numberingPattern: 'RCT-{tenant_monotonic_10_digit_sequence}',
      serverAssigned: true, immutable: true, gapsAllowed: true,
      reuseAllowed: false, annualResetAllowed: false,
      exactAcceptedFinancialFactRequired: true,
      checkReceivedRequiredWording: 'check received — clearance unknown',
      receiptMayClaimProviderSettlementOrBankClearance: false,
      refundRequestIsCompletedRefund: false,
      providerDisputeErasesOriginalPayment: false,
      negativeBalanceCreditRevenueAndExpenseRemainSeparate: true,
      customerReceiptIdentity: null,
      publicReceiptRouteAvailable: false,
    }),
    accounting: Object.freeze({
      state: 'accounting_adapter_unavailable', reason: 'accounting_adapter_unavailable', value: null,
      adapter: 'quickbooks_online.accounting_export.v1', supportedMode: 'sandbox',
      runtimeAvailable: false, exportAndAcknowledgementOnly: true,
      mayInventChartOfAccounts: false, mayDecideRecognitionOrTax: false,
      maySupplyCheckClearance: false,
      maximumExportRecords: 1000, maximumExportMinorUnits: '100000000',
      singleControlMaximumRecords: 100, singleControlMaximumMinorUnits: '10000000',
      aboveSingleControlRequiresTwoDifferentCurrentHumans: true,
      manualReconciliationAlwaysDualControl: true,
      adapterAcknowledgementIsHumanAction: false,
      exactCurrentMinimizedFactSetAndAdapterRequired: true,
      accountingReceiptIdentity: null,
      earnedRevenuePolicyAvailable: false,
    }),
    access: Object.freeze({
      eligiblePaidRoles: Object.freeze(['owner','admin']),
      roleAloneAuthorizesFinancialAction: false,
      demoPhysicallyAndLogicallyIsolated: true,
      customerReceiptRequiresScopedCustomerAccess: true,
      staffRoleMaySubstituteForCustomerAccess: false,
      tenantCrossingAllowed: false,
    }),
    acceptance: Object.freeze({
      sourceContractsRevalidated: true,
      wholePart9FunctionalBoundaryPresent: true,
      independentWholeHeadAuditAccepted: false,
      providerSandboxEvidenceAccepted: false,
      firstPayingCustomerLiveMoneyValidated: false,
      founderVisualApprovalAccepted: false,
    }),
    exactCurrentnessRevalidated: true,
    customerReceiptRowCount: 0,
    correctionRowCount: 0,
    recoveryRowCount: 0,
    accountingExportRowCount: 0,
    accountingReconciliationRowCount: 0,
    providerCallCount: 0,
    providerMutationCount: 0,
    receiverMutationCount: 0,
    accountingMutationCount: 0,
    liveMoneyMovementCount: 0,
  });
}

function project(raw, mode, part7Bundle, sources, upstream) {
  const expected = unavailable(mode, part7Bundle, sources, upstream);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).length !== Object.keys(expected).length) {
    throw new Error('Payment Part 9 acceptance boundary invalid');
  }
  if (sources) {
    if (JSON.stringify(raw) !== JSON.stringify(expected)) {
      throw new Error('Payment Part 9 acceptance boundary invalid');
    }
    return expected;
  }
  const actualComparable = JSON.parse(JSON.stringify(raw));
  const expectedComparable = JSON.parse(JSON.stringify(expected));
  if (!Array.isArray(actualComparable.sourceParts) || actualComparable.sourceParts.length !== 5 ||
      actualComparable.sourceParts.some(value => !/^[0-9a-f]{64}$/.test(value.digest || ''))) {
    throw new Error('Payment Part 9 acceptance boundary invalid');
  }
  actualComparable.sourceParts.forEach((value, index) => {
    value.digest = expectedComparable.sourceParts[index].digest;
  });
  if (JSON.stringify(actualComparable) !== JSON.stringify(expectedComparable)) {
    throw new Error('Payment Part 9 acceptance boundary invalid');
  }
  return raw;
}

function bundle(part7Raw, acceptance, sources, upstream) {
  const part7 = part7Contract.projectBundle(part7Raw);
  const value = project(acceptance, part7.preview.mode, part7, sources, upstream);
  if (JSON.stringify(value.previewWitness) !==
      JSON.stringify(part7.part7Acceptance.previewWitness)) {
    throw new Error('Payment Part 9 preview bundle currentness mismatch');
  }
  return Object.freeze({
    contractVersion: BUNDLE_VERSION,
    preview: part7.preview,
    part5Acceptance: part7.part5Acceptance,
    part6Acceptance: part7.part6Acceptance,
    part7Acceptance: part7.part7Acceptance,
    part9Acceptance: value,
  });
}

function projectBundle(raw, expectedMode, sources, upstream) {
  if (!exact(raw, ['contractVersion','preview','part5Acceptance','part6Acceptance',
    'part7Acceptance','part9Acceptance']) || raw.contractVersion !== BUNDLE_VERSION) {
    throw new Error('Payment Part 9 preview bundle invalid');
  }
  const part7 = {
    contractVersion: part7Contract.BUNDLE_VERSION,
    preview: raw.preview,
    part5Acceptance: raw.part5Acceptance,
    part6Acceptance: raw.part6Acceptance,
    part7Acceptance: raw.part7Acceptance,
  };
  const value = bundle(part7, raw.part9Acceptance, sources, upstream);
  if (expectedMode && value.preview.mode !== expectedMode) {
    throw new Error('Payment Part 9 preview bundle mode mismatch');
  }
  return value;
}

module.exports = { CONTRACT_VERSION, BUNDLE_VERSION, REASON, SOURCE_PARTS,
  policy, defaultSources, unavailable, project, bundle, projectBundle };
