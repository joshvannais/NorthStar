'use strict';

const providerBoundary = require('./paymentProviderBoundary');
const normalization = require('./paymentProviderEventNormalization');
const settlement = require('./paymentSettlementPayout');
const offlinePayment = require('./offlinePaymentReadiness');
const paymentOutcome = require('./paymentOutcomeReadiness');

const CONTRACT_VERSION = 'm27-payment-cash-reporting-v1';
const REASON = 'payment_cash_reporting_coverage_incomplete';
const SOURCE_ORDER = Object.freeze([
  'providerEventNormalization',
  'settlementPayoutReconciliation',
  'offlinePaymentReadiness',
  'paymentOutcomeReadiness',
]);

const FACTS = Object.freeze([
  Object.freeze({ fact:'provider_authorized_amount', source:'providerEventNormalization',
    reason:'provider_event_receipt_unavailable', launchSupport:'supported_test_mode',
    launchState:'unavailable', authority:'authenticated_provider_event' }),
  Object.freeze({ fact:'provider_captured_amount', source:'settlementPayoutReconciliation',
    reason:'provider_capture_evidence_unavailable', launchSupport:'supported_test_mode',
    launchState:'unavailable', authority:'authenticated_provider_capture' }),
  Object.freeze({ fact:'provider_settled_amount', source:'settlementPayoutReconciliation',
    reason:'settlement_unavailable', launchSupport:'supported_test_mode',
    launchState:'unavailable', authority:'authenticated_provider_settlement' }),
  Object.freeze({ fact:'provider_refunded_amount', source:'paymentOutcomeReadiness',
    reason:'settlement_unavailable', launchSupport:'supported_test_mode',
    launchState:'unavailable', authority:'authenticated_provider_refund_settlement' }),
  Object.freeze({ fact:'provider_disputed_amount', source:'paymentOutcomeReadiness',
    reason:'provider_event_receipt_unavailable', launchSupport:'supported_test_mode',
    launchState:'unavailable', authority:'authenticated_provider_dispute' }),
  Object.freeze({ fact:'provider_reversed_amount', source:'paymentOutcomeReadiness',
    reason:'provider_event_receipt_unavailable', launchSupport:'supported_test_mode',
    launchState:'unavailable', authority:'authenticated_provider_reversal' }),
  Object.freeze({ fact:'provider_fee_amount', source:'settlementPayoutReconciliation',
    reason:'provider_fee_disclosure_unavailable', launchSupport:'supported_test_mode',
    launchState:'unavailable', authority:'authenticated_provider_balance_transaction' }),
  Object.freeze({ fact:'offline_cash_received_amount', source:'offlinePaymentReadiness',
    reason:'accepted_offline_receipt_unavailable', launchSupport:'supported',
    launchState:'unavailable', authority:'accepted_offline_cash_receipt' }),
  Object.freeze({ fact:'check_clearance_unknown_amount', source:'offlinePaymentReadiness',
    reason:'accepted_offline_receipt_unavailable', launchSupport:'supported',
    launchState:'unavailable', authority:'accepted_check_receipt' }),
  Object.freeze({ fact:'check_cleared_amount', source:'offlinePaymentReadiness',
    reason:'check_clearance_authority_unavailable', launchSupport:'disabled',
    launchState:'check_clearance_authority_unavailable',
    authority:'authenticated_bank_clearance' }),
  Object.freeze({ fact:'check_returned_amount', source:'paymentOutcomeReadiness',
    reason:'returned_check_authority_unavailable', launchSupport:'supported',
    launchState:'returned_check_authority_unavailable',
    authority:'authenticated_bank_return' }),
  Object.freeze({ fact:'offline_reversed_amount', source:'paymentOutcomeReadiness',
    reason:'accepted_offline_receipt_unavailable', launchSupport:'supported',
    launchState:'unavailable', authority:'accepted_append_only_offline_reversal' }),
  Object.freeze({ fact:'offline_correction_amount', source:'offlinePaymentReadiness',
    reason:'accepted_offline_receipt_unavailable', launchSupport:'supported',
    launchState:'unavailable', authority:'accepted_append_only_offline_correction' }),
]);

function policy() {
  const launch = offlinePayment.policy();
  const financial = launch.financial;
  const offline = financial.offline;
  if (financial.provider !== 'stripe_connect' || financial.supportedMode !== 'test' ||
      financial.liveModeDefaultEnabled !== false || financial.supportedCurrency !== 'USD' ||
      JSON.stringify(normalization.EVIDENCE_STATES) !== JSON.stringify([
        'created','authorized','processing','succeeded','failed','canceled','settled',
        'reversed','corrected',
      ]) || JSON.stringify(offlinePayment.OFFLINE_STATES) !== JSON.stringify([
        'offline_received','check_clearance_unknown','check_cleared','check_returned',
        'offline_reversed',
      ]) || offline.cashReceiptEnabled !== true || offline.checkReceiptEnabled !== true ||
      offline.checkClearedTransitionEnabled !== false ||
      offline.checkClearanceAuthority !== 'unavailable_until_authenticated_bank_source' ||
      offline.returnedCheckAuthority.missingAuthorityState !==
        'returned_check_authority_unavailable' ||
      offline.correctionEffect !== 'append_only_replacement_or_reversal_never_in_place') {
    throw new Error('Payment and cash reporting policy is unavailable');
  }
  return launch;
}

function defaultSources() {
  const offline = offlinePayment.unavailable();
  return Object.freeze({
    providerEventNormalization: normalization.unavailable(),
    settlementPayoutReconciliation: settlement.unavailable(),
    offlinePaymentReadiness: offline,
    paymentOutcomeReadiness: paymentOutcome.unavailable(offline),
  });
}

function sourceBundle(raw = defaultSources()) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      JSON.stringify(Object.keys(raw)) !== JSON.stringify(SOURCE_ORDER)) {
    throw new Error('Payment and cash reporting source bundle invalid');
  }
  const providerEventNormalization = normalization.project(raw.providerEventNormalization);
  const settlementPayoutReconciliation = settlement.project(
    raw.settlementPayoutReconciliation);
  const offlinePaymentReadiness = offlinePayment.project(raw.offlinePaymentReadiness);
  const paymentOutcomeReadiness = paymentOutcome.projectWithSource(
    raw.paymentOutcomeReadiness, offlinePaymentReadiness);
  return Object.freeze({ providerEventNormalization, settlementPayoutReconciliation,
    offlinePaymentReadiness, paymentOutcomeReadiness });
}

function witness(name, source) {
  return Object.freeze({ source:name, contractVersion:source.contractVersion,
    state:source.state, reason:source.reason, digest:providerBoundary.digest(source),
    currentnessRevalidated:true });
}

function fact(definition, sources) {
  const source = sources[definition.source];
  return Object.freeze({
    fact:definition.fact,
    state:definition.launchState,
    reason:definition.reason,
    valueType:'minor_units',
    value:null,
    currency:null,
    coverage:Object.freeze({
      state:'incomplete', complete:false, reason:definition.reason,
      sourceContractVersion:source.contractVersion,
      sourceDigest:providerBoundary.digest(source),
      sourceAsOf:null, totalSourceRecordCount:null, acceptedSourceRecordCount:null,
      completenessProven:false, partialPopulationMayBePresentedAsComplete:false,
      missingRecordsOrValuesMayBecomeZero:false,
      sourceCurrentnessRevalidated:false,
    }),
    launchMatrixSupport:Object.freeze({
      support:definition.launchSupport,
      currentState:definition.launchState,
      requiredAuthority:definition.authority,
      currentAuthorityAvailable:false,
      positiveRuntimeAvailable:false,
      mayInferFromAnotherFact:false,
    }),
  });
}

function unavailable(sourcesRaw = defaultSources()) {
  const sources = sourceBundle(sourcesRaw);
  const launch = policy();
  const facts = FACTS.map(definition => fact(definition,sources));
  const sourceWitnesses = SOURCE_ORDER.map(name => witness(name,sources[name]));
  return Object.freeze({
    contractVersion:CONTRACT_VERSION,
    policyVersion:providerBoundary.POLICY_VERSION,
    policyDigest:providerBoundary.POLICY_DIGEST,
    state:'incomplete',
    reason:REASON,
    value:null,
    sourceOrder:SOURCE_ORDER,
    sourceWitnesses:Object.freeze(sourceWitnesses),
    factOrder:Object.freeze(FACTS.map(definition => definition.fact)),
    facts:Object.freeze(facts),
    amountContract:Object.freeze({
      supportedCurrency:launch.financial.supportedCurrency,
      integerMinorUnitsRequired:true,
      oneMatchingCurrencyRequired:true,
      signedCorrectionAndReversalAmountsRetainOwnFact:true,
      grossFeeNetAndRefundAmountsRemainSeparate:true,
      missingAmountMayBecomeZero:false,
      incompleteFactsMayBeSummedComparedOrNetted:false,
      browserArithmeticAllowed:false,
    }),
    separationContract:Object.freeze({
      providerAuthorizedCapturedSettledRefundedDisputedReversedAndFeeRemainSeparate:true,
      acceptedOfflineCashReceiptMayImplyProviderAuthorization:false,
      acceptedOfflineCashReceiptMayImplyProviderCapture:false,
      acceptedOfflineCashReceiptMayImplyProviderSettlement:false,
      acceptedOfflineCashReceiptMayImplyBankDeposit:false,
      checkClearanceUnknownMayImplyCheckCleared:false,
      checkClearanceUnknownMayImplySettledCash:false,
      checkReturnedMayImplyProviderReversal:false,
      offlineReversalMayImplyPhysicalCashReturn:false,
      offlineCorrectionMayRewritePriorEvidence:false,
      accountingAcknowledgementMaySupplyProviderOrBankEvidence:false,
    }),
    launchMatrix:Object.freeze({
      provider:'stripe_connect', providerMode:'test', providerLiveModeEnabled:false,
      providerMethod:'card', currency:'USD',
      offlineCashReceiptSupport:'supported', checkReceiptSupport:'supported',
      checkClearedTransitionSupport:'disabled',
      checkClearanceAuthorityState:'check_clearance_authority_unavailable',
      returnedCheckSupport:'supported',
      returnedCheckAuthorityState:'returned_check_authority_unavailable',
      offlineReversalSupport:'supported', offlineCorrectionSupport:'supported_append_only',
    }),
    coverageSummary:Object.freeze({
      state:'incomplete', reason:REASON, requiredFactCount:FACTS.length,
      completeFactCount:0, incompleteFactCount:FACTS.length, allFactsComplete:false,
      sourceAsOf:null, reportCurrency:null, reportMayBePresentedAsComplete:false,
      partialFactsMayBeSummedComparedOrNetted:false,
      unknownOrMissingFactMayBecomeZero:false,
    }),
    access:Object.freeze({
      tenantPrivate:true, eligiblePaidRoles:Object.freeze(['owner','admin']),
      currentTenantSessionRequired:true, currentSubscriptionRequired:true,
      tenantCrossingAllowed:false, customerOrPublicAccessAllowed:false,
      demoRouteAvailable:false, readOnlyProjection:true,
    }),
    privacy:Object.freeze({
      tenantCustomerInvoicePaymentOrReceiptIdentityExposed:false,
      amountCurrencyEventOrBalanceDetailExposed:false,
      providerAccountObjectEventOrCredentialDetailExposed:false,
      bankAccountCheckOrReturnSourceDetailExposed:false,
      actorReviewerApproverOrRecipientIdentityExposed:false,
      accountingOrTaxDetailExposed:false,
    }),
    exactSourcesRevalidatedBeforeAndAfterProjection:true,
    reportRowCount:0,
    browserDerivedValueCount:0,
    providerCallCount:0,
    providerMutationCount:0,
    receiverMutationCount:0,
    accountingMutationCount:0,
    downstreamReaderMutationCount:0,
    liveMoneyMovementCount:0,
  });
}

function project(raw, sourcesRaw) {
  const expected = unavailable(sourcesRaw);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).length !== Object.keys(expected).length ||
      JSON.stringify(raw) !== JSON.stringify(expected)) {
    throw new Error('Payment and cash reporting boundary invalid');
  }
  return expected;
}

module.exports = { CONTRACT_VERSION, REASON, SOURCE_ORDER, FACTS, policy,
  defaultSources, sourceBundle, unavailable, project };
