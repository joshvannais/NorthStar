'use strict';

const providerBoundary = require('./paymentProviderBoundary');
const invoiceReporting = require('./invoiceReceivableReporting');
const paymentReporting = require('./paymentCashReporting');

const CONTRACT_VERSION = 'm27-downstream-reporting-readers-v1';
const REASON = 'downstream_reader_authority_unavailable';
const SOURCE_ORDER = Object.freeze([
  'invoiceReceivableReporting',
  'paymentCashReporting',
]);
const READER_ORDER = Object.freeze(['mission25','mission26','mission33']);

function defaultSources() {
  return Object.freeze({
    invoiceReceivableReporting:invoiceReporting.unavailable(),
    paymentCashReporting:paymentReporting.unavailable(),
  });
}

function sourceBundle(raw = defaultSources()) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      JSON.stringify(Object.keys(raw)) !== JSON.stringify(SOURCE_ORDER)) {
    throw new Error('Downstream reporting source bundle invalid');
  }
  const invoiceReceivableReporting = invoiceReporting.project(
    raw.invoiceReceivableReporting);
  const paymentCashReporting = paymentReporting.project(raw.paymentCashReporting);
  return Object.freeze({invoiceReceivableReporting,paymentCashReporting});
}

function witness(source, value) {
  return Object.freeze({source,contractVersion:value.contractVersion,state:value.state,
    reason:value.reason,digest:providerBoundary.digest(value),currentnessRevalidated:true,
    completeCoverage:false,emittedRecordCount:value.reportRowCount});
}

function reader({reader,destinationContractVersion,reason,allowedEvidence,
  requiredEvidence,prohibitions}) {
  return Object.freeze({
    reader,destinationContractVersion,state:'unavailable',reason,value:null,
    purposePermissionRequired:true,purposePermissionCurrent:false,
    sameTenantRequired:true,tenantIdentityExposed:false,
    currentSourceDigestsRequired:true,sourceCurrentnessRevalidated:false,
    completeCoverageRequired:true,completeCoverageAvailable:false,
    acceptedEvidenceOnly:true,allowedEvidence:Object.freeze(allowedEvidence),
    requiredEvidence:Object.freeze(requiredEvidence),
    prohibitions:Object.freeze(prohibitions),
    correctionPropagation:Object.freeze({
      sourceCorrectionInvalidatesPriorProjection:true,
      sourceRevocationInvalidatesPriorProjection:true,
      sourceTombstoneInvalidatesPriorProjection:true,
      purposePermissionChangeInvalidatesPriorProjection:true,
      staleProjectionMayRemainReadable:false,
      correctedValueMayRewritePriorEvidence:false,
    }),
    emittedRecordCount:0,downstreamWriteCount:0,automaticApplicationCount:0,
  });
}

function readers() {
  return Object.freeze([
    reader({
      reader:'mission25',
      destinationContractVersion:'mission25.tenant_edit_observation.v1',
      reason:'learning_permission_unavailable',
      allowedEvidence:['same_tenant_provenance','accepted_human_edit_delta',
        'accepted_option_identity','mission24_acceptance_outcome',
        'mission23_work_outcome','actual_cost','actual_duration',
        'source_currentness','coverage'],
      requiredEvidence:['current_purpose_permission','exact_accepted_observation',
        'exact_source_digests','correction_and_tombstone_lineage'],
      prohibitions:['raw_photo_or_transcript','signature_or_contact_content',
        'payment_instrument','unreviewed_draft','other_tenant_content',
        'cross_tenant_training','automatic_price_or_policy_application'],
    }),
    reader({
      reader:'mission26',
      destinationContractVersion:'mission26.collection_forecast.evidence.v1',
      reason:'collection_forecast_source_and_calibration_unavailable',
      allowedEvidence:['same_tenant_provenance','receivable_coverage',
        'payment_cash_coverage','source_currentness','correction_lineage'],
      requiredEvidence:['source_complete_historical_evidence','accepted_calibration',
        'exact_source_digests','current_collection_forecast_authority'],
      prohibitions:['earned_revenue_inference','missing_as_zero','forecast_as_fact',
        'automatic_collection_action','automatic_schedule_or_invoice_mutation'],
    }),
    reader({
      reader:'mission33',
      destinationContractVersion:'mission33.platform_financial_fact.v1',
      reason:'platform_financial_fact_authority_unavailable',
      allowedEvidence:['platform_level_provenance','aggregate_coverage',
        'source_currentness','correction_lineage'],
      requiredEvidence:['platform_purpose_permission','canonical_metric_registry',
        'cross_company_privacy_controls','exact_source_reconciliation'],
      prohibitions:['tenant_detail_inspection','raw_tenant_content',
        'tenant_owner_role_as_platform_authority','cross_company_disclosure',
        'forecast_or_allocation_as_actual_history'],
    }),
  ]);
}

function unavailable(sourcesRaw = defaultSources()) {
  const sources = sourceBundle(sourcesRaw);
  const sourceWitnesses = SOURCE_ORDER.map(name => witness(name,sources[name]));
  const readerValues = readers();
  return Object.freeze({
    contractVersion:CONTRACT_VERSION,
    policyVersion:providerBoundary.POLICY_VERSION,
    policyDigest:providerBoundary.POLICY_DIGEST,
    state:'unavailable',reason:REASON,value:null,
    sourceOrder:SOURCE_ORDER,sourceWitnesses:Object.freeze(sourceWitnesses),
    readerOrder:READER_ORDER,readers:readerValues,
    provenanceContract:Object.freeze({
      sameTenantOnly:true,exactSourceContractAndDigestRequired:true,
      sourceCurrentnessRequired:true,coverageEvidenceRequired:true,
      editAndOutcomeEvidenceRemainDistinct:true,
      capacityAndRiskRemainAdvisory:true,
      missingOrUnavailableMayBecomeZero:false,
      browserDerivedEvidenceAllowed:false,
    }),
    coverageEvidence:Object.freeze({
      invoiceReceivableState:sources.invoiceReceivableReporting.state,
      invoiceReceivableReason:sources.invoiceReceivableReporting.reason,
      invoiceReceivableDigest:providerBoundary.digest(sources.invoiceReceivableReporting),
      invoiceReceivableComplete:
        sources.invoiceReceivableReporting.coverageSummary.allFactsComplete,
      paymentCashState:sources.paymentCashReporting.state,
      paymentCashReason:sources.paymentCashReporting.reason,
      paymentCashDigest:providerBoundary.digest(sources.paymentCashReporting),
      paymentCashComplete:sources.paymentCashReporting.coverageSummary.allFactsComplete,
      downstreamCoverageComplete:false,
      zeroEmittedRecordsProvesZeroFinancialActivity:false,
    }),
    mutationBoundary:Object.freeze({
      mayChangePrice:false,mayChangeOption:false,mayChangeEstimate:false,
      mayChangeSchedule:false,mayChangeAssignment:false,mayChangeInvoice:false,
      mayChangePayment:false,mayChangeCollection:false,mayChangePolicy:false,
      mayTrainAcrossTenants:false,mayCreatePlatformAuthority:false,
    }),
    access:Object.freeze({
      tenantPrivate:true,eligiblePaidRoles:Object.freeze(['owner','admin']),
      currentTenantSessionRequired:true,currentSubscriptionRequired:true,
      tenantCrossingAllowed:false,customerOrPublicAccessAllowed:false,
      demoRouteAvailable:false,readOnlyProjection:true,
    }),
    privacy:Object.freeze({
      tenantCustomerOrWorkerIdentityExposed:false,
      invoicePaymentReceiptOrAccountingIdentityExposed:false,
      amountCurrencyDueDateOrFinancialDetailExposed:false,
      editOutcomeCapacityOrRiskDetailExposed:false,
      sourcePermissionOrCredentialDetailExposed:false,
      platformAdministrativeIdentityExposed:false,
    }),
    exactSourcesRevalidatedBeforeAndAfterProjection:true,
    reportRowCount:0,learningObservationCount:0,forecastCount:0,
    platformFactCount:0,providerCallCount:0,providerMutationCount:0,
    receiverMutationCount:0,accountingMutationCount:0,
    downstreamReaderMutationCount:0,liveMoneyMovementCount:0,
  });
}

function isExactProjection(raw,expected) {
  return Boolean(raw && expected && typeof raw === 'object' && !Array.isArray(raw) &&
    typeof expected === 'object' && !Array.isArray(expected) &&
    Object.keys(raw).length === Object.keys(expected).length &&
    JSON.stringify(raw) === JSON.stringify(expected));
}

function project(raw,sourcesRaw) {
  const expected=unavailable(sourcesRaw);
  if (!isExactProjection(raw,expected)) {
    throw new Error('Downstream reporting readers boundary invalid');
  }
  return expected;
}

module.exports = { CONTRACT_VERSION, REASON, SOURCE_ORDER, READER_ORDER,
  defaultSources, sourceBundle, unavailable, isExactProjection, project };
