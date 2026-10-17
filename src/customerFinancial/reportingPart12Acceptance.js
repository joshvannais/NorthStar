'use strict';

const providerBoundary=require('./paymentProviderBoundary');
const part11Contract=require('./accountingPart11Acceptance');
const invoiceReporting=require('./invoiceReceivableReporting');
const paymentReporting=require('./paymentCashReporting');
const downstreamReaders=require('./downstreamReportingReaders');

const CONTRACT_VERSION='m27-reporting-part12-acceptance-v1';
const BUNDLE_VERSION='m27-reporting-part12-preview-bundle-v1';
const REASON='part12_reporting_evidence_incomplete';
const SOURCE_ORDER=Object.freeze(['12A','12B','12C']);
const SURFACE_ORDER=Object.freeze(['command_center','customer_finance']);
const DRILLDOWN_ORDER=Object.freeze([
  'invoice_receivables','payment_cash','downstream_readers',
]);
const DERIVED_SOURCES=new WeakSet();
const SERVER_PART11_BUNDLES=new WeakSet();

function exact(value,keys) {
  return Boolean(value&&typeof value==='object'&&!Array.isArray(value)&&
    Object.keys(value).length===keys.length&&Object.keys(value).every(key=>keys.includes(key)));
}

function serverPart11Bundle(value) {
  // This marker is applied only by the Part 12 repository after the exact
  // in-process Part 11 repository has constructed and validated the bundle.
  // It is module-private provenance, never a caller-authored field.
  if (!value||typeof value!=='object'||Array.isArray(value)||
      value.contractVersion!==part11Contract.BUNDLE_VERSION||
      !['paid','demo'].includes(value.preview?.mode)) {
    throw new Error('Reporting Part 12 Part 11 source invalid');
  }
  SERVER_PART11_BUNDLES.add(value);
  return value;
}

function validatedPart11(value) {
  if (value&&SERVER_PART11_BUNDLES.has(value)) return value;
  const projected=part11Contract.projectBundle(value,value?.preview?.mode);
  SERVER_PART11_BUNDLES.add(projected);
  return projected;
}

function derive(part11Raw,sourcesRaw) {
  const part11=validatedPart11(part11Raw);
  const invoiceReceivableReporting=invoiceReporting.project(
    sourcesRaw?.invoiceReceivableReporting||invoiceReporting.unavailable());
  const paymentCashReporting=paymentReporting.project(
    sourcesRaw?.paymentCashReporting||paymentReporting.unavailable());
  const downstreamReportingReaders=downstreamReaders.project(
    sourcesRaw?.downstreamReportingReaders||downstreamReaders.unavailable({
      invoiceReceivableReporting,paymentCashReporting,
    }),{invoiceReceivableReporting,paymentCashReporting});
  const derived=Object.freeze({part11,invoiceReceivableReporting,paymentCashReporting,
    downstreamReportingReaders});
  DERIVED_SOURCES.add(derived);
  return derived;
}

function validatedSources(part11Raw,sourcesRaw) {
  return sourcesRaw&&DERIVED_SOURCES.has(sourcesRaw)
    ? sourcesRaw : derive(part11Raw,sourcesRaw);
}

function sourceWitnesses(sources) {
  return Object.freeze([
    Object.freeze({part:'12A',contractVersion:invoiceReporting.CONTRACT_VERSION,
      state:sources.invoiceReceivableReporting.state,
      reason:sources.invoiceReceivableReporting.reason,
      digest:providerBoundary.digest(sources.invoiceReceivableReporting),
      exactCurrentnessRevalidated:true,completeCoverage:false}),
    Object.freeze({part:'12B',contractVersion:paymentReporting.CONTRACT_VERSION,
      state:sources.paymentCashReporting.state,
      reason:sources.paymentCashReporting.reason,
      digest:providerBoundary.digest(sources.paymentCashReporting),
      exactCurrentnessRevalidated:true,completeCoverage:false}),
    Object.freeze({part:'12C',contractVersion:downstreamReaders.CONTRACT_VERSION,
      state:sources.downstreamReportingReaders.state,
      reason:sources.downstreamReportingReaders.reason,
      digest:providerBoundary.digest(sources.downstreamReportingReaders),
      exactCurrentnessRevalidated:true,completeCoverage:false}),
  ]);
}

function unavailable(mode,part11Raw,sourcesRaw) {
  if (!['paid','demo'].includes(mode)) throw new Error('Reporting Part 12 mode invalid');
  const sources=validatedSources(part11Raw,sourcesRaw);
  const part11=sources.part11;
  const sourceValues={invoiceReceivableReporting:sources.invoiceReceivableReporting,
    paymentCashReporting:sources.paymentCashReporting,
    downstreamReportingReaders:sources.downstreamReportingReaders};
  const witnesses=sourceWitnesses(sourceValues);
  const previewWitness=part11.part11Acceptance.previewWitness;
  return Object.freeze({
    contractVersion:CONTRACT_VERSION,
    policyVersion:providerBoundary.POLICY_VERSION,
    policyDigest:providerBoundary.POLICY_DIGEST,
    state:'incomplete',reason:REASON,mode,fictional:mode==='demo',
    previewWitness,
    part11Witness:Object.freeze({
      contractVersion:part11.part11Acceptance.contractVersion,
      state:part11.part11Acceptance.state,
      reason:part11.part11Acceptance.reason,
      digest:providerBoundary.digest(part11.part11Acceptance),
    }),
    sourceOrder:SOURCE_ORDER,
    sourceWitnesses:witnesses,
    surfaceOrder:SURFACE_ORDER,
    surfaces:Object.freeze([
      Object.freeze({surface:'command_center',state:'incomplete',
        reason:'part12_reporting_evidence_incomplete',tenantPrivate:true,
        exactSourceDigestsRequired:true,completeCoverageRequired:true,
        browserDerivedValuesAllowed:false,legacyZeroFallbackAllowed:false,
        renderedFactCount:0}),
      Object.freeze({surface:'customer_finance',state:'incomplete',
        reason:'part12_reporting_evidence_incomplete',tenantPrivate:true,
        exactSourceDigestsRequired:true,completeCoverageRequired:true,
        browserDerivedValuesAllowed:false,legacyZeroFallbackAllowed:false,
        renderedFactCount:0}),
    ]),
    drilldownOrder:DRILLDOWN_ORDER,
    drilldowns:Object.freeze([
      Object.freeze({drilldown:'invoice_receivables',state:'incomplete',
        reason:invoiceReceivableReason(sourceValues),sourcePart:'12A',requiredFactCount:5,
        availableFactCount:0,value:null,currency:null,missingMayBecomeZero:false,
        browserArithmeticAllowed:false}),
      Object.freeze({drilldown:'payment_cash',state:'incomplete',
        reason:sourceValues.paymentCashReporting.reason,sourcePart:'12B',requiredFactCount:13,
        availableFactCount:0,value:null,currency:null,missingMayBecomeZero:false,
        browserArithmeticAllowed:false}),
      Object.freeze({drilldown:'downstream_readers',state:'unavailable',
        reason:sourceValues.downstreamReportingReaders.reason,sourcePart:'12C',requiredFactCount:3,
        availableFactCount:0,value:null,currency:null,missingMayBecomeZero:false,
        browserArithmeticAllowed:false}),
    ]),
    reportingContract:Object.freeze({
      exactSourceContractAndDigestRequired:true,sourceCurrentnessRequired:true,
      completeCoverageRequired:true,partialCoverageMayAppearComplete:false,
      missingUnknownOrUnavailableMayBecomeZero:false,browserDerivedValuesAllowed:false,
      browserArithmeticAllowed:false,legacyZeroFallbackAllowed:false,
      earnedRevenueMayBeInferredFromInvoice:false,
      collectedCashMayBeInferredFromProviderOrOfflineIntent:false,
      forecastMayBePresentedAsHistoricalFact:false,
      factsRemainUnavailableUntilExactAuthorityExists:true,
    }),
    downstreamBoundary:Object.freeze({
      mission25ExactAcceptedObservationsOnly:true,
      mission25AutomaticPriceScheduleInvoiceOrPolicyMutationAllowed:false,
      mission26SourceCompleteHistoryAndAcceptedCalibrationRequired:true,
      mission26ForecastAvailable:false,
      mission33PlatformFactsOnly:true,
      mission33MayInspectTenantDetail:false,
      crossTenantTrainingAllowed:false,
      automaticDownstreamApplicationAllowed:false,
    }),
    access:Object.freeze({
      eligiblePaidReadRoles:Object.freeze(['owner','admin']),
      currentTenantSessionRequired:true,currentSubscriptionRequired:true,
      demoPhysicallyAndLogicallyIsolated:true,customerOrPublicAccessAllowed:false,
      tenantCrossingAllowed:false,readOnlyProjection:true,
    }),
    privacy:Object.freeze({
      tenantCustomerWorkerOrActorIdentityExposed:false,
      invoicePaymentReceiptOrAccountingIdentityExposed:false,
      amountCurrencyDueDateOrFinancialDetailExposed:false,
      providerBankCredentialOrDestinationDetailExposed:false,
      learningForecastOrPlatformDetailExposed:false,
    }),
    acceptance:Object.freeze({
      sourceContractsRevalidated:true,wholePart12FunctionalBoundaryPresent:true,
      paidDemoIsolationAccepted:true,legacyZeroFallbackRemoved:true,
      independentWholeHeadAuditAccepted:false,
      productionPerformanceSlaAccepted:false,
      firstPayingCustomerLiveMoneyValidated:false,
      founderVisualApprovalAccepted:false,
    }),
    exactCurrentnessRevalidated:true,reportRowCount:0,drilldownRowCount:0,
    browserDerivedValueCount:0,legacyZeroFallbackCount:0,learningObservationCount:0,
    forecastCount:0,platformFactCount:0,providerCallCount:0,providerMutationCount:0,
    receiverMutationCount:0,accountingMutationCount:0,downstreamReaderMutationCount:0,
    liveMoneyMovementCount:0,
  });
}

function invoiceReceivableReason(sources) {
  return sources.invoiceReceivableReporting.reason;
}

function project(raw,mode,part11Raw,sourcesRaw) {
  const sources=validatedSources(part11Raw,sourcesRaw);
  const expected=unavailable(mode,part11Raw,sources);
  if (!exact(raw,Object.keys(expected))||JSON.stringify(raw)!==JSON.stringify(expected)) {
    throw new Error('Reporting Part 12 acceptance invalid');
  }
  return expected;
}

function bundle(part11Raw,acceptance,sourcesRaw) {
  const mode=part11Raw?.preview?.mode;
  const sources=validatedSources(part11Raw,sourcesRaw);
  const part11=sources.part11;
  const value=project(acceptance,mode,part11,sources);
  if (JSON.stringify(value.previewWitness)!==
      JSON.stringify(part11.part11Acceptance.previewWitness)) {
    throw new Error('Reporting Part 12 preview bundle currentness mismatch');
  }
  return Object.freeze({
    contractVersion:BUNDLE_VERSION,
    preview:part11.preview,part5Acceptance:part11.part5Acceptance,
    part6Acceptance:part11.part6Acceptance,part7Acceptance:part11.part7Acceptance,
    part9Acceptance:part11.part9Acceptance,part10Acceptance:part11.part10Acceptance,
    part11SourceContracts:part11.part11SourceContracts,
    part11Acceptance:part11.part11Acceptance,part12Acceptance:value,
  });
}

function projectBundle(raw,expectedMode,sourcesRaw) {
  const keys=['contractVersion','preview','part5Acceptance','part6Acceptance',
    'part7Acceptance','part9Acceptance','part10Acceptance','part11SourceContracts',
    'part11Acceptance','part12Acceptance'];
  if (!exact(raw,keys)||raw.contractVersion!==BUNDLE_VERSION) {
    throw new Error('Reporting Part 12 preview bundle invalid');
  }
  const part11={contractVersion:part11Contract.BUNDLE_VERSION,preview:raw.preview,
    part5Acceptance:raw.part5Acceptance,part6Acceptance:raw.part6Acceptance,
    part7Acceptance:raw.part7Acceptance,part9Acceptance:raw.part9Acceptance,
    part10Acceptance:raw.part10Acceptance,
    part11SourceContracts:raw.part11SourceContracts,part11Acceptance:raw.part11Acceptance};
  const sources=validatedSources(part11,sourcesRaw);
  const expected=bundle(part11,raw.part12Acceptance,sources);
  if (JSON.stringify(raw)!==JSON.stringify(expected)) {
    throw new Error('Reporting Part 12 preview bundle invalid');
  }
  if (expectedMode&&expected.preview.mode!==expectedMode) {
    throw new Error('Reporting Part 12 preview bundle mode mismatch');
  }
  return expected;
}

module.exports={CONTRACT_VERSION,BUNDLE_VERSION,REASON,SOURCE_ORDER,SURFACE_ORDER,
  DRILLDOWN_ORDER,serverPart11Bundle,derive,sourceWitnesses,unavailable,project,bundle,projectBundle};
