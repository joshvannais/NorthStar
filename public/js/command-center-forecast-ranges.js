(function (global) {
  'use strict';

  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  var DIGEST = /^[0-9a-f]{64}$/;
  var INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
  var DATE = /^\d{4}-\d{2}-\d{2}$/;
  var DECIMAL = /^(?:0|[1-9]\d{0,25})(?:\.\d{1,6})?$/;
  var MONEY = /^(?:0|[1-9]\d{0,25})\.\d{6}$/;
  var PRICE = /^(?:0|[1-9]\d{0,11})\.\d{2}$/;
  var REQUEST_MONEY = /^(?:0|[1-9]\d{0,11})\.\d{6}$/;
  var SIGNED_MONEY = /^-?(?:0|[1-9]\d{0,25})\.\d{6}$/;
  var NAMES = ['adverse', 'base', 'favorable'];

  function exact(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    var own = Reflect.ownKeys(value);
    return own.length === keys.length && own.every(function (key) {
      var descriptor = typeof key === 'string' && Object.getOwnPropertyDescriptor(value, key);
      return keys.indexOf(key) >= 0 && descriptor && descriptor.enumerable &&
        Object.prototype.hasOwnProperty.call(descriptor, 'value');
    });
  }
  function dense(value, maximum) {
    if (!Array.isArray(value) || value.length > maximum ||
        Reflect.ownKeys(value).length !== value.length + 1) return false;
    return value.every(function (_item, index) {
      var descriptor = Object.getOwnPropertyDescriptor(value, index);
      return descriptor && descriptor.enumerable &&
        Object.prototype.hasOwnProperty.call(descriptor, 'value');
    });
  }
  function instant(value) {
    return typeof value === 'string' && INSTANT.test(value) && Number.isFinite(Date.parse(value));
  }
  function uuid(value) { return typeof value === 'string' && UUID.test(value); }
  function digest(value) { return typeof value === 'string' && DIGEST.test(value); }
  function text(value, maximum) {
    return typeof value === 'string' && value === value.trim() && value.length > 0 &&
      value.length <= (maximum || 256) && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
  }
  function decimal(value) { return typeof value === 'string' && DECIMAL.test(value); }
  function safeInteger(value) { return Number.isSafeInteger(value) && value >= 0; }
  function nullableDigest(value) { return value === null || digest(value); }
  function nullableUuid(value) { return value === null || uuid(value); }

  var BASELINE_IMPLEMENTATION_PROCEDURE =
    'public.canonical_forecast_retell_future_origin_v2_capture(uuid,uuid,text,uuid,text,text,date)';

  function validBaselineIdentity(value, assessedAt) {
    if (!exact(value, ['target', 'unit', 'horizon', 'scope', 'profile', 'sourceAsOf',
      'sourceSnapshotDigest', 'sourceReceiptDigest', 'baselineDigest', 'configurationDigest',
      'algorithm']) || !exact(value.target, ['key', 'definitionVersion', 'sourceScope']) ||
      value.target.key !== 'demand.inbound_leads' || value.target.definitionVersion !== 'v1' ||
      value.target.sourceScope !== 'retell_only_tenant_all' ||
      !exact(value.unit, ['key', 'currency']) || value.unit.key !== 'count' ||
      value.unit.currency !== null ||
      !exact(value.horizon, ['localStart', 'startsAt', 'endsAt', 'grain', 'timeZone']) ||
      !DATE.test(value.horizon.localStart || '') || !instant(value.horizon.startsAt) ||
      !instant(value.horizon.endsAt) || value.horizon.startsAt >= value.horizon.endsAt ||
      value.horizon.grain !== 'business_local_month' || !text(value.horizon.timeZone, 100) ||
      !exact(value.scope, ['sourceScope', 'serviceKey', 'areaKey', 'dimensionKeys']) ||
      value.scope.sourceScope !== 'retell_only_tenant_all' || value.scope.serviceKey !== null ||
      value.scope.areaKey !== null || !dense(value.scope.dimensionKeys, 0) ||
      value.scope.dimensionKeys.length !== 0 ||
      !exact(value.profile, ['businessProfileId', 'businessProfileVersion',
        'businessProfileHash', 'timeZone']) || !uuid(value.profile.businessProfileId) ||
      !safeInteger(value.profile.businessProfileVersion) || value.profile.businessProfileVersion < 1 ||
      !digest(value.profile.businessProfileHash) || value.profile.timeZone !== value.horizon.timeZone ||
      !instant(value.sourceAsOf) || value.sourceAsOf > assessedAt ||
      assessedAt >= value.horizon.startsAt ||
      ![value.sourceSnapshotDigest, value.sourceReceiptDigest,
        value.baselineDigest, value.configurationDigest].every(digest) ||
      !exact(value.algorithm, ['key', 'version', 'definitionDigest', 'implementationDigest',
        'buildIdentity']) || value.algorithm.key !== 'retell_three_complete_month_mean' ||
      value.algorithm.version !== 'm26-retell-three-month-mean-v2' ||
      !digest(value.algorithm.definitionDigest) ||
      !digest(value.algorithm.implementationDigest) ||
      !exact(value.algorithm.buildIdentity, ['kind', 'procedure']) ||
      value.algorithm.buildIdentity.kind !== 'postgresql_function_definition_sha256' ||
      value.algorithm.buildIdentity.procedure !== BASELINE_IMPLEMENTATION_PROCEDURE) return false;
    return true;
  }

  function validBaselineObservations(value) {
    if (!dense(value, 120)) return false;
    var previous = null;
    for (var index = 0; index < value.length; index += 1) {
      var item = value[index];
      if (!exact(item, ['localMonthStart', 'state', 'count', 'sourceWindowStartsAt',
        'sourceWindowEndsAt', 'sourceRecordedThrough', 'certificationId',
        'certificationRevision', 'certificationDigest', 'certificationAction',
        'certificationRecordedAt', 'snapshotId', 'snapshotDigest', 'coverageEvidenceDigest',
        'providerScanDigest', 'callerConsentAttested', 'providerCoverageAttestedRetellOnly',
        'retentionAttested']) || !DATE.test(item.localMonthStart || '') ||
        item.state !== 'complete' || !safeInteger(item.count) ||
        !instant(item.sourceWindowStartsAt) || !instant(item.sourceWindowEndsAt) ||
        !instant(item.sourceRecordedThrough) || item.sourceWindowStartsAt >= item.sourceWindowEndsAt ||
        !uuid(item.certificationId) || !safeInteger(item.certificationRevision) ||
        item.certificationRevision < 1 || !digest(item.certificationDigest) ||
        item.certificationAction !== 'certify' || !instant(item.certificationRecordedAt) ||
        !uuid(item.snapshotId) || !digest(item.snapshotDigest) ||
        !digest(item.coverageEvidenceDigest) || !digest(item.providerScanDigest) ||
        item.callerConsentAttested !== true ||
        item.providerCoverageAttestedRetellOnly !== true || item.retentionAttested !== true ||
        (previous !== null && item.localMonthStart <= previous)) return false;
      previous = item.localMonthStart;
    }
    return true;
  }

  function validateBaseline(value) {
    var keys = ['version', 'state', 'reason', 'originId', 'checkedAt', 'issuedAt',
      'evaluationAsOf', 'target', 'configuration', 'horizon', 'unit', 'sourceSnapshot',
      'output', 'evaluation', 'provenance', 'digests', 'currentness', 'sourceAuthenticated',
      'researchOnly', 'realForecastEligible', 'forecastIssued', 'paidNumericServing',
      'probabilityIssued', 'calibratedRangeIssued', 'automaticActionAuthorized'];
    if (!exact(value, keys) || value.version !== 'm26-deterministic-baseline-v1' ||
      ['current', 'unavailable'].indexOf(value.state) < 0 || !uuid(value.originId) ||
      !instant(value.checkedAt) || !exact(value.evaluation,
        ['state', 'evaluatedAt', 'outcomeDigest', 'reason']) ||
      !exact(value.digests, ['configuration', 'input', 'output', 'baseline', 'receipt']) ||
      !exact(value.currentness, ['sourceCurrent', 'refreshRequired',
        'correctionOrRevocationApplied']) || value.researchOnly !== true ||
      value.realForecastEligible !== false || value.paidNumericServing !== false ||
      value.probabilityIssued !== false || value.calibratedRangeIssued !== false ||
      value.automaticActionAuthorized !== false) return null;
    if (value.state === 'unavailable') {
      return ['source_or_profile_changed_refresh_required',
        'complete_period_lineage_unavailable',
        'algorithm_identity_changed_refresh_required',
        'baseline_clock_or_horizon_ineligible'].indexOf(value.reason) >= 0 &&
        value.issuedAt === null && value.evaluationAsOf === null &&
        value.target === null && value.configuration === null && value.horizon === null &&
        value.unit === null && value.sourceSnapshot === null && value.output === null &&
        value.provenance === null && Object.keys(value.digests).every(function (key) {
          return value.digests[key] === null;
        }) && value.currentness.sourceCurrent === false &&
        value.currentness.refreshRequired === true &&
        value.currentness.correctionOrRevocationApplied === true &&
        value.sourceAuthenticated === false && value.forecastIssued === false ? value : null;
    }
    if (value.reason !== null || !instant(value.issuedAt) || value.issuedAt > value.checkedAt ||
      value.evaluationAsOf !== null || !exact(value.target,
        ['key', 'definitionVersion', 'sourceScope']) ||
      value.target.key !== 'demand.inbound_leads' || value.target.definitionVersion !== 'v1' ||
      value.target.sourceScope !== 'retell_only_tenant_all' ||
      !exact(value.configuration, ['version', 'targetKey', 'targetVersion', 'sourceScope',
        'algorithmId', 'algorithmVersion', 'definitionDigest', 'implementationDigest',
        'buildIdentity', 'method', 'minimumPeriods', 'horizonGrain', 'unit', 'decimalScale',
        'rounding', 'observationOrder']) ||
      value.configuration.version !== 'm26-deterministic-baseline-configuration-v1' ||
      value.configuration.targetKey !== 'demand.inbound_leads' ||
      value.configuration.targetVersion !== 'v1' ||
      value.configuration.sourceScope !== 'retell_only_tenant_all' ||
      value.configuration.algorithmId !== 'retell_three_complete_month_mean' ||
      !text(value.configuration.algorithmVersion, 160) ||
      value.configuration.method !== 'arithmetic_mean_comparable_prior_periods' ||
      value.configuration.minimumPeriods !== 3 ||
      value.configuration.horizonGrain !== 'business_local_month' ||
      value.configuration.unit !== 'count' || value.configuration.decimalScale !== 6 ||
      value.configuration.rounding !== 'half_up' ||
      value.configuration.observationOrder !== 'local_month_start_ascending' ||
      !digest(value.configuration.definitionDigest) ||
      !digest(value.configuration.implementationDigest) ||
      !exact(value.configuration.buildIdentity, ['kind', 'procedure']) ||
      !exact(value.horizon, ['localStart', 'startsAt', 'endsAt', 'grain', 'timeZone']) ||
      !DATE.test(value.horizon.localStart || '') || !instant(value.horizon.startsAt) ||
      !instant(value.horizon.endsAt) || value.horizon.startsAt >= value.horizon.endsAt ||
      !exact(value.unit, ['key', 'currency']) || value.unit.key !== 'count' ||
      value.unit.currency !== null || !exact(value.sourceSnapshot,
        ['state', 'completeAsOf', 'sourceScope', 'sourceAsOf', 'profile',
          'periodInventoryDigest', 'evidenceDigest', 'expectedPeriods', 'includedPeriods',
          'excludedPeriods', 'missingPeriods', 'stalePeriods', 'hasMore', 'paginationVersion',
          'nextCursor', 'observations', 'providerCoverageAttestedRetellOnly',
          'providerIndependentVerified', 'wholeBusinessCoverageVerified']) ||
      value.sourceSnapshot.state !== 'complete_as_of' ||
      value.sourceSnapshot.completeAsOf !== true || value.sourceSnapshot.hasMore !== false ||
      value.sourceSnapshot.sourceScope !== 'retell_only_tenant_all' ||
      !instant(value.sourceSnapshot.sourceAsOf) ||
      !exact(value.sourceSnapshot.profile, ['businessProfileId', 'businessProfileVersion',
        'businessProfileHash', 'timeZone']) ||
      !uuid(value.sourceSnapshot.profile.businessProfileId) ||
      !safeInteger(value.sourceSnapshot.profile.businessProfileVersion) ||
      value.sourceSnapshot.profile.businessProfileVersion < 1 ||
      !digest(value.sourceSnapshot.profile.businessProfileHash) ||
      value.sourceSnapshot.profile.timeZone !== value.horizon.timeZone ||
      value.sourceSnapshot.nextCursor !== null ||
      !validBaselineObservations(value.sourceSnapshot.observations) ||
      value.sourceSnapshot.expectedPeriods !== 3 ||
      value.sourceSnapshot.includedPeriods !== value.sourceSnapshot.observations.length ||
      value.sourceSnapshot.includedPeriods !== 3 || value.sourceSnapshot.excludedPeriods !== 0 ||
      value.sourceSnapshot.missingPeriods !== 0 || value.sourceSnapshot.stalePeriods !== 0 ||
      value.sourceSnapshot.paginationVersion !== 'bounded_single_page' ||
      value.sourceSnapshot.providerCoverageAttestedRetellOnly !== true ||
      value.sourceSnapshot.providerIndependentVerified !== false ||
      value.sourceSnapshot.wholeBusinessCoverageVerified !== false ||
      !digest(value.sourceSnapshot.periodInventoryDigest) ||
      !digest(value.sourceSnapshot.evidenceDigest) ||
      !exact(value.output, ['contractVersion', 'target', 'unit', 'value', 'confidence',
        'uncertainty', 'applicability', 'calculationVersion', 'researchOnly',
        'realForecastEligible', 'paidNumericServing', 'forecastServingEnabled']) ||
      value.output.contractVersion !== 'm26-forecast-output-v1' ||
      !exact(value.output.target, ['key', 'definitionVersion']) ||
      value.output.target.key !== value.target.key ||
      value.output.target.definitionVersion !== value.target.definitionVersion ||
      !exact(value.output.unit, ['key', 'currency']) || value.output.unit.key !== 'count' ||
      value.output.unit.currency !== null ||
      !exact(value.output.value, ['kind', 'amount']) || value.output.value.kind !== 'point' ||
      !decimal(value.output.value.amount) || value.output.researchOnly !== true ||
      !exact(value.output.confidence, ['state', 'backtestDigest']) ||
      value.output.confidence.state !== 'unavailable' || value.output.confidence.backtestDigest !== null ||
      !exact(value.output.uncertainty, ['state', 'drivers']) ||
      value.output.uncertainty.state !== 'unquantified' || !dense(value.output.uncertainty.drivers, 20) ||
      !exact(value.output.applicability, ['serviceKey', 'areaKey', 'limits']) ||
      value.output.applicability.serviceKey !== null || value.output.applicability.areaKey !== null ||
      !dense(value.output.applicability.limits, 20) ||
      value.output.realForecastEligible !== false || value.output.paidNumericServing !== false ||
      value.output.forecastServingEnabled !== false || !Object.keys(value.digests)
        .every(function (key) { return digest(value.digests[key]); }) ||
      value.currentness.sourceCurrent !== true || value.currentness.refreshRequired !== false ||
      value.currentness.correctionOrRevocationApplied !== false ||
      value.sourceAuthenticated !== true || value.forecastIssued !== true) return null;
    return value;
  }

  function validRangeRequirements(value) {
    var keys = ['completeEligibleOriginInventory', 'preOutcomeChronology',
      'comparableFinalizedOutcomes', 'reviewedCalibrationPolicy', 'versionedQuantilePolicy',
      'heldOutEvaluation', 'existingDescriptiveEvidence'];
    if (!exact(value, keys)) return false;
    var inventory = value.completeEligibleOriginInventory;
    var denominator = ['issued', 'unavailable', 'unpaired', 'corrected', 'revoked',
      'normalization_failed'];
    if (!exact(inventory, ['state', 'reason', 'inventoryDigest', 'totalCount', 'issuedCount',
      'unavailableCount', 'unpairedCount', 'correctedCount', 'revokedCount',
      'normalizationFailedCount', 'denominatorCategories']) || inventory.state !== 'unavailable' ||
      inventory.reason !== 'complete_saved_prediction_inventory_not_available' ||
      !['inventoryDigest', 'totalCount', 'issuedCount', 'unavailableCount', 'unpairedCount',
        'correctedCount', 'revokedCount', 'normalizationFailedCount'].every(function (key) {
          return inventory[key] === null;
        }) || !dense(inventory.denominatorCategories, denominator.length) ||
      inventory.denominatorCategories.length !== denominator.length ||
      inventory.denominatorCategories.join('|') !== denominator.join('|')) return false;
    var chronology = value.preOutcomeChronology;
    if (!exact(chronology, ['state', 'reason', 'verified', 'latestPredictionIssuedAt',
      'earliestOutcomeFinalizedAt']) || chronology.state !== 'unavailable' ||
      chronology.reason !== 'pre_outcome_prediction_chronology_not_available' ||
      chronology.verified !== false || chronology.latestPredictionIssuedAt !== null ||
      chronology.earliestOutcomeFinalizedAt !== null) return false;
    var outcomes = value.comparableFinalizedOutcomes;
    if (!exact(outcomes, ['state', 'reason', 'outcomeFinalityPolicyVersion',
      'outcomeFinalityPolicyDigest', 'pairedCount', 'unpairedCount', 'correctedCount',
      'revokedCount']) || outcomes.state !== 'unavailable' ||
      outcomes.reason !== 'comparable_finalized_outcomes_not_available' ||
      !['outcomeFinalityPolicyVersion', 'outcomeFinalityPolicyDigest', 'pairedCount',
        'unpairedCount', 'correctedCount', 'revokedCount'].every(function (key) {
          return outcomes[key] === null;
        })) return false;
    var policy = value.reviewedCalibrationPolicy;
    if (!exact(policy, ['state', 'reason', 'policyVersion', 'policyDigest', 'sufficiencyRule',
      'independenceRule', 'concentrationRule', 'acceptableErrorRule']) ||
      policy.state !== 'unavailable' ||
      policy.reason !== 'contractor_calibration_policy_not_available' ||
      !['policyVersion', 'policyDigest', 'sufficiencyRule', 'independenceRule',
        'concentrationRule', 'acceptableErrorRule'].every(function (key) {
          return policy[key] === null;
        })) return false;
    var quantiles = value.versionedQuantilePolicy;
    if (!exact(quantiles, ['state', 'reason', 'policyVersion', 'policyDigest', 'nominalCoverage',
      'quantileDefinition', 'p10Definition', 'p50Definition', 'p90Definition']) ||
      quantiles.state !== 'unavailable' ||
      quantiles.reason !== 'versioned_quantile_policy_not_available' ||
      !['policyVersion', 'policyDigest', 'nominalCoverage', 'quantileDefinition',
        'p10Definition', 'p50Definition', 'p90Definition'].every(function (key) {
          return quantiles[key] === null;
        })) return false;
    var evaluation = value.heldOutEvaluation;
    if (!exact(evaluation, ['state', 'reason', 'evaluationPolicyVersion',
      'evaluationPolicyDigest', 'evaluationDigest', 'evaluationCurrentnessDigest', 'evaluatedAt',
      'trainingOriginPeriods', 'heldOutOriginPeriods', 'pairedCount', 'exclusions',
      'nominalCoverage', 'empiricalCoverage', 'quantileScores', 'recency', 'drift',
      'materialDownside']) || evaluation.state !== 'unavailable' ||
      evaluation.reason !== 'held_out_calibration_evaluation_not_available' ||
      !['evaluationPolicyVersion', 'evaluationPolicyDigest', 'evaluationDigest',
        'evaluationCurrentnessDigest', 'evaluatedAt', 'trainingOriginPeriods',
        'heldOutOriginPeriods', 'pairedCount', 'nominalCoverage', 'empiricalCoverage',
        'quantileScores', 'recency', 'drift', 'materialDownside'].every(function (key) {
          return evaluation[key] === null;
        }) || !exact(evaluation.exclusions,
        ['unavailable', 'unpaired', 'corrected', 'revoked', 'normalizationFailed']) ||
      !Object.keys(evaluation.exclusions).every(function (key) {
        return evaluation.exclusions[key] === null;
      })) return false;
    var descriptive = value.existingDescriptiveEvidence;
    return exact(descriptive, ['state', 'targetKey', 'requestedTargetKey',
      'usableForCalibration', 'reason']) && descriptive.state === 'inapplicable' &&
      descriptive.targetKey === 'pipeline.approved_estimates' &&
      descriptive.requestedTargetKey === 'demand.inbound_leads' &&
      descriptive.usableForCalibration === false &&
      descriptive.reason === 'different_target_and_point_only_descriptive_evidence';
  }

  function validateRange(value) {
    var keys = ['version', 'state', 'reason', 'originId', 'assessedAt', 'baselineIdentity',
      'range', 'distribution', 'requirements', 'currentness', 'digests', 'sourceAuthenticated',
      'researchOnly', 'realForecastEligible', 'probabilityDistributionIssued',
      'calibratedRangeIssued', 'paidNumericServing', 'automaticActionAuthorized'];
    if (!exact(value, keys) || value.version !== 'm26-calibrated-range-assessment-v1' ||
      value.state !== 'unavailable' || ['calibration_evidence_not_established',
        'deterministic_baseline_not_current'].indexOf(value.reason) < 0 || !uuid(value.originId) ||
      !instant(value.assessedAt) || !exact(value.range,
        ['state', 'reason', 'p10', 'p50', 'p90', 'nominalCentralCoverage',
          'empiricalCalibrationClaimed']) || value.range.state !== 'unavailable' ||
      value.range.reason !== value.reason || value.range.p10 !== null ||
      value.range.p50 !== null || value.range.p90 !== null ||
      value.range.nominalCentralCoverage !== null ||
      value.range.empiricalCalibrationClaimed !== false ||
      !exact(value.distribution, ['state', 'reason', 'family', 'parameters',
        'distributionDigest']) || value.distribution.state !== 'unavailable' ||
      value.distribution.reason !== value.reason || value.distribution.family !== null ||
      value.distribution.parameters !== null || value.distribution.distributionDigest !== null ||
      !validRangeRequirements(value.requirements) ||
      !exact(value.currentness, ['baselineCurrent', 'evidenceCurrent', 'refreshRequired',
        'correctionOrRevocationApplied']) || value.currentness.evidenceCurrent !== false ||
      value.currentness.refreshRequired !== true ||
      typeof value.currentness.correctionOrRevocationApplied !== 'boolean' ||
      !exact(value.digests, ['assessment', 'completeOriginInventory', 'calibrationPolicy',
        'quantilePolicy', 'heldOutEvaluation', 'backtest']) ||
      !['completeOriginInventory', 'calibrationPolicy', 'quantilePolicy', 'heldOutEvaluation',
        'backtest'].every(function (key) { return value.digests[key] === null; }) ||
      value.researchOnly !== true || value.realForecastEligible !== false ||
      value.probabilityDistributionIssued !== false || value.calibratedRangeIssued !== false ||
      value.paidNumericServing !== false || value.automaticActionAuthorized !== false) return null;
    if (value.reason === 'calibration_evidence_not_established') {
      if (!validBaselineIdentity(value.baselineIdentity, value.assessedAt) ||
        !digest(value.digests.assessment) ||
        value.sourceAuthenticated !== true || value.currentness.baselineCurrent !== true ||
        value.currentness.correctionOrRevocationApplied !== false) return null;
    } else if (value.baselineIdentity !== null || value.digests.assessment !== null ||
      value.sourceAuthenticated !== false || value.currentness.baselineCurrent !== false ||
      value.currentness.correctionOrRevocationApplied !== true) return null;
    return value;
  }

  function validScenarioValue(value, state, reason) {
    return exact(value, ['state', 'reason', 'preliminaryEstimate', 'approvedUnbooked', 'total']) &&
      value.state === state && value.reason === reason && (state === 'unavailable'
        ? value.preliminaryEstimate === null && value.approvedUnbooked === null && value.total === null
        : MONEY.test(value.preliminaryEstimate || '') &&
          MONEY.test(value.approvedUnbooked || '') && MONEY.test(value.total || ''));
  }
  function validScenarioApplicability(value, assumption) {
    var keys = ['targetKey', 'targetVersion', 'estimateId', 'category',
      'estimateSnapshotDigest', 'decisionId', 'decisionRevision', 'decisionDigest',
      'issuedVersionId', 'issuedVersionRevision', 'issuedDocumentDigest', 'priceBeforeTax',
      'currency', 'horizonRuleVersion'];
    return exact(value, keys) && value.targetKey === 'pipeline.open_value_scenario' &&
      value.targetVersion === 'v1' && value.estimateId === assumption.estimateId &&
      value.category === assumption.category &&
      value.estimateSnapshotDigest === assumption.estimateSnapshotDigest &&
      nullableUuid(value.decisionId) &&
      (value.decisionRevision === null || safeInteger(value.decisionRevision)) &&
      nullableDigest(value.decisionDigest) && nullableUuid(value.issuedVersionId) &&
      (value.issuedVersionRevision === null || safeInteger(value.issuedVersionRevision)) &&
      nullableDigest(value.issuedDocumentDigest) &&
      value.priceBeforeTax === assumption.priceBeforeTax && value.currency === assumption.currency &&
      value.horizonRuleVersion === 'next-complete-tenant-local-month-v1';
  }
  function validScenarioAssumptions(value, review) {
    if (!dense(value, 256)) return false;
    var seen = Object.create(null);
    for (var index = 0; index < value.length; index += 1) {
      var assumption = value[index];
      if (!exact(assumption, ['estimateId', 'estimateSnapshotDigest', 'category',
        'priceBeforeTax', 'currency', 'applicability', 'variations']) ||
        !uuid(assumption.estimateId) || !digest(assumption.estimateSnapshotDigest) ||
        ['preliminary_estimate', 'approved_unbooked'].indexOf(assumption.category) < 0 ||
        !PRICE.test(assumption.priceBeforeTax || '') || !/^[A-Z]{3}$/.test(assumption.currency || '') ||
        seen[assumption.estimateId] ||
        !validScenarioApplicability(assumption.applicability, assumption) ||
        !exact(assumption.variations, NAMES)) return false;
      seen[assumption.estimateId] = true;
      var weights = [];
      for (var nameIndex = 0; nameIndex < NAMES.length; nameIndex += 1) {
        var variation = assumption.variations[NAMES[nameIndex]];
        if (!exact(variation, ['weightPpm', 'changedAssumption', 'reason', 'author', 'source',
          'recordedAt', 'applicability', 'revision']) || !safeInteger(variation.weightPpm) ||
          variation.weightPpm > 1000000 || !exact(variation.changedAssumption,
            ['field', 'fromWeightPpm', 'toWeightPpm']) ||
          variation.changedAssumption.field !== 'conversion_weight_ppm' ||
          !safeInteger(variation.changedAssumption.fromWeightPpm) ||
          variation.changedAssumption.fromWeightPpm > 1000000 ||
          variation.changedAssumption.toWeightPpm !== variation.weightPpm ||
          !text(variation.reason, 1000) || variation.reason.length < 10 ||
          !exact(variation.author, ['userId', 'membershipId']) ||
          !uuid(variation.author.userId) || !uuid(variation.author.membershipId) ||
          !exact(variation.source, ['kind', 'digest']) ||
          variation.source.kind !== 'owner_approved_scenario_assumption' ||
          !digest(variation.source.digest) || !instant(variation.recordedAt) ||
          variation.revision !== review.revision ||
          !validScenarioApplicability(variation.applicability, assumption) ||
          JSON.stringify(variation.applicability) !== JSON.stringify(assumption.applicability)) {
          return false;
        }
        weights.push(variation.weightPpm);
      }
      if (weights[0] > weights[1] || weights[1] > weights[2] ||
        assumption.variations.base.changedAssumption.fromWeightPpm !== weights[1]) return false;
    }
    return true;
  }
  function validateScenario(value) {
    var keys = ['version', 'state', 'reason', 'checkedAt', 'asOf', 'horizon', 'currency',
      'target', 'sourceSnapshot', 'scenarioReview', 'scenarios', 'assumptions', 'digests',
      'currentness', 'sourceAuthenticated', 'assumptionSourcesAuthenticated',
      'weightsAreScenarioAssumptions', 'probabilityCalibrated', 'percentilesIssued',
      'earnedRevenueMeasured', 'cashMeasured', 'researchOnly', 'realForecastEligible',
      'forecastIssued', 'paidNumericServing', 'automaticActionAuthorized'];
    if (!exact(value, keys) || value.version !== 'm26-named-pipeline-scenario-v1' ||
      ['current', 'unavailable'].indexOf(value.state) < 0 || !instant(value.checkedAt) ||
      !exact(value.target, ['key', 'version']) ||
      value.target.key !== 'pipeline.open_value_scenario' || value.target.version !== 'v1' ||
      !exact(value.scenarios, NAMES) || !dense(value.assumptions, 256) ||
      !exact(value.digests, ['source', 'assumptions', 'output', 'review', 'currentness']) ||
      !exact(value.currentness, ['reviewCurrent', 'sourceCurrent', 'policyCurrent',
        'profileCurrent', 'refreshRequired', 'correctionOrRevocationApplied']) ||
      value.weightsAreScenarioAssumptions !== true || value.probabilityCalibrated !== false ||
      value.percentilesIssued !== false || value.earnedRevenueMeasured !== false ||
      value.cashMeasured !== false || value.researchOnly !== true ||
      value.realForecastEligible !== false || value.paidNumericServing !== false ||
      value.automaticActionAuthorized !== false) return null;
    if (value.state === 'unavailable') {
      var unavailableReasons = ['no_current_scenario_review', 'scenario_review_revoked',
        'clock_reversal', 'scenario_window_elapsed', 'business_profile_changed',
        'scenario_policy_changed', 'scenario_source_changed'];
      return unavailableReasons.indexOf(value.reason) >= 0 && value.asOf === null && value.horizon === null &&
        value.currency === null && value.sourceSnapshot === null && value.scenarioReview === null &&
        value.assumptions.length === 0 && NAMES.every(function (name) {
          return validScenarioValue(value.scenarios[name], 'unavailable', value.reason);
        }) && Object.keys(value.digests).every(function (key) { return value.digests[key] === null; }) &&
        value.currentness.reviewCurrent === false && value.currentness.sourceCurrent === false &&
        value.currentness.policyCurrent === false && value.currentness.profileCurrent === false &&
        value.currentness.refreshRequired === true && value.sourceAuthenticated === false &&
        value.assumptionSourcesAuthenticated === false && value.forecastIssued === false ? value : null;
    }
    if (value.reason !== null || !instant(value.asOf) || value.checkedAt < value.asOf ||
      !exact(value.horizon, ['startsAt', 'endsAt', 'upperBoundary', 'timeZone']) ||
      !instant(value.horizon.startsAt) || !instant(value.horizon.endsAt) ||
      value.horizon.upperBoundary !== 'exclusive' || value.horizon.startsAt >= value.horizon.endsAt ||
      !/^[A-Z]{3}$/.test(value.currency || '') || !exact(value.sourceSnapshot,
        ['state', 'digest', 'profile', 'pipelinePolicy', 'statuses', 'estimateHighWaterOrder',
          'pipelineEpochId', 'pipelineEpochDigest', 'openRiskDigest',
          'integratedCommercialSourceDigest', 'completeAsOf', 'hasMore']) ||
      value.sourceSnapshot.state !== 'complete_as_of' || !digest(value.sourceSnapshot.digest) ||
      value.sourceSnapshot.completeAsOf !== true || value.sourceSnapshot.hasMore !== false ||
      !exact(value.sourceSnapshot.profile, ['id', 'version', 'hash', 'anchorId', 'timeZone']) ||
      !uuid(value.sourceSnapshot.profile.id) || !safeInteger(value.sourceSnapshot.profile.version) ||
      value.sourceSnapshot.profile.version < 1 || !digest(value.sourceSnapshot.profile.hash) ||
      !uuid(value.sourceSnapshot.profile.anchorId) ||
      value.sourceSnapshot.profile.timeZone !== value.horizon.timeZone ||
      !exact(value.sourceSnapshot.pipelinePolicy, ['id', 'revision', 'digest']) ||
      !uuid(value.sourceSnapshot.pipelinePolicy.id) ||
      !safeInteger(value.sourceSnapshot.pipelinePolicy.revision) ||
      value.sourceSnapshot.pipelinePolicy.revision < 1 ||
      !digest(value.sourceSnapshot.pipelinePolicy.digest) ||
      !exact(value.sourceSnapshot.statuses, ['estimateCount', 'authoritativeOpenRiskCount',
        'scenarioMemberCount', 'preliminaryEstimateCount', 'approvedUnbookedCount',
        'withdrawnExcludedCount', 'reviewedUnconfirmedExcludedCount',
        'confirmedBookedExcludedCount', 'correctedExcludedCount', 'cancelledExcludedCount',
        'outsideAuthoritativeOpenRiskExcludedCount']) ||
      !Object.keys(value.sourceSnapshot.statuses).every(function (key) {
        return safeInteger(value.sourceSnapshot.statuses[key]);
      }) || !safeInteger(value.sourceSnapshot.estimateHighWaterOrder) ||
      !uuid(value.sourceSnapshot.pipelineEpochId) ||
      ![value.sourceSnapshot.pipelineEpochDigest, value.sourceSnapshot.openRiskDigest,
        value.sourceSnapshot.integratedCommercialSourceDigest].every(digest) ||
      !exact(value.scenarioReview, ['id', 'revision', 'authorUserId', 'membershipId',
        'recordedAt', 'digest']) || !uuid(value.scenarioReview.id) ||
      !safeInteger(value.scenarioReview.revision) || value.scenarioReview.revision < 1 ||
      !uuid(value.scenarioReview.authorUserId) || !uuid(value.scenarioReview.membershipId) ||
      !instant(value.scenarioReview.recordedAt) || !digest(value.scenarioReview.digest) ||
      !validScenarioAssumptions(value.assumptions, value.scenarioReview) ||
      !NAMES.every(function (name) {
        return validScenarioValue(value.scenarios[name], 'assumption_only', null);
      }) || !['preliminaryEstimate', 'approvedUnbooked', 'total'].every(function (key) {
        return BigInt(value.scenarios.adverse[key].replace('.', '')) <=
          BigInt(value.scenarios.base[key].replace('.', '')) &&
          BigInt(value.scenarios.base[key].replace('.', '')) <=
          BigInt(value.scenarios.favorable[key].replace('.', ''));
      }) || !Object.keys(value.digests).every(function (key) { return digest(value.digests[key]); }) ||
      value.digests.source !== value.sourceSnapshot.digest ||
      value.digests.review !== value.scenarioReview.digest ||
      !['reviewCurrent', 'sourceCurrent', 'policyCurrent', 'profileCurrent'].every(function (key) {
        return value.currentness[key] === true;
      }) || value.currentness.refreshRequired !== false ||
      value.currentness.correctionOrRevocationApplied !== false ||
      value.sourceAuthenticated !== true || value.assumptionSourcesAuthenticated !== true ||
      value.forecastIssued !== true) return null;
    return value;
  }

  function validSensitivityCurrentness(value, current) {
    return exact(value, ['scenarioCurrent', 'sourceCurrent', 'assumptionsCurrent',
      'policyCurrent', 'profileCurrent', 'refreshRequired', 'correctionOrRevocationApplied']) &&
      ['scenarioCurrent', 'sourceCurrent', 'assumptionsCurrent', 'policyCurrent',
        'profileCurrent'].every(function (key) { return value[key] === current; }) &&
      value.refreshRequired === !current && value.correctionOrRevocationApplied === !current;
  }
  function validSensitivityDigests(value, current) {
    return exact(value, ['input', 'output', 'source', 'assumptions', 'review', 'currentness']) &&
      Object.keys(value).every(function (key) {
        return current ? digest(value[key]) : value[key] === null;
      });
  }
  function validBinding(value) {
    return value === null || (exact(value, ['kind', 'weightPpm']) &&
      ['selected_weight_lower_bound', 'selected_weight_upper_bound'].indexOf(value.kind) >= 0 &&
      safeInteger(value.weightPpm) && value.weightPpm <= 1000000);
  }
  function validBaseAssumption(value, selected) {
    return exact(value, ['weightPpm', 'changedAssumption', 'reason', 'author', 'source',
      'recordedAt', 'applicability', 'revision']) && safeInteger(value.weightPpm) &&
      value.weightPpm <= 1000000 && exact(value.changedAssumption,
        ['field', 'fromWeightPpm', 'toWeightPpm']) &&
      value.changedAssumption.field === 'conversion_weight_ppm' &&
      value.changedAssumption.fromWeightPpm === value.weightPpm &&
      value.changedAssumption.toWeightPpm === value.weightPpm && text(value.reason, 1000) &&
      value.reason.length >= 10 && exact(value.author, ['userId', 'membershipId']) &&
      uuid(value.author.userId) && uuid(value.author.membershipId) &&
      exact(value.source, ['kind', 'digest']) &&
      value.source.kind === 'owner_approved_scenario_assumption' && digest(value.source.digest) &&
      instant(value.recordedAt) && safeInteger(value.revision) && value.revision >= 1 &&
      value.applicability && value.applicability.estimateId === selected.id &&
      value.applicability.estimateSnapshotDigest === selected.snapshotDigest &&
      value.applicability.category === selected.category;
  }
  function validForward(value, selected, constraint) {
    if (!exact(value, ['state', 'reason', 'changedAssumption', 'selectedEstimate',
      'categoryTotal', 'bindingConstraint']) || value.state !== 'assumption_only' ||
      value.reason !== null || !exact(value.changedAssumption,
        ['field', 'fromWeightPpm', 'toWeightPpm']) ||
      value.changedAssumption.field !== 'conversion_weight_ppm' ||
      value.changedAssumption.fromWeightPpm !== constraint.bounds.basePpm ||
      !safeInteger(value.changedAssumption.toWeightPpm) ||
      value.changedAssumption.toWeightPpm < constraint.bounds.lowerPpm ||
      value.changedAssumption.toWeightPpm > constraint.bounds.upperPpm ||
      !validBinding(value.bindingConstraint)) return false;
    for (var index = 0; index < 2; index += 1) {
      var item = index === 0 ? value.selectedEstimate : value.categoryTotal;
      if (!exact(item, ['baselineAmount', 'proposedAmount', 'changeAmount']) ||
        !MONEY.test(item.baselineAmount || '') || !MONEY.test(item.proposedAmount || '') ||
        !SIGNED_MONEY.test(item.changeAmount || '')) return false;
    }
    return selected.baseAssumption.weightPpm === constraint.bounds.basePpm;
  }
  function validReverse(value, target, constraint) {
    if (!exact(value, ['state', 'reason', 'requiredWeightPpm', 'selectedEstimateAmount',
      'categoryTotal', 'bindingConstraint'])) return false;
    if (value.state === 'impossible') return value.reason ===
      'target_exceeds_selected_weight_bound' && value.requiredWeightPpm === null &&
      value.selectedEstimateAmount === null && value.categoryTotal === null &&
      exact(value.bindingConstraint, ['kind', 'weightPpm']) &&
      value.bindingConstraint.kind === 'selected_weight_upper_bound' &&
      value.bindingConstraint.weightPpm === constraint.bounds.upperPpm;
    return value.state === 'assumption_only' && value.reason === null &&
      safeInteger(value.requiredWeightPpm) &&
      value.requiredWeightPpm >= constraint.bounds.lowerPpm &&
      value.requiredWeightPpm <= constraint.bounds.upperPpm &&
      MONEY.test(value.selectedEstimateAmount || '') &&
      exact(value.categoryTotal, ['minimumAmount', 'attainedAmount',
        'changeFromBaselineAmount']) && value.categoryTotal.minimumAmount === target.minimumAmount &&
      MONEY.test(value.categoryTotal.attainedAmount || '') &&
      SIGNED_MONEY.test(value.categoryTotal.changeFromBaselineAmount || '') &&
      validBinding(value.bindingConstraint);
  }
  function validateSensitivity(value) {
    var keys = ['version', 'state', 'reason', 'checkedAt', 'asOf', 'horizon', 'currency',
      'scenario', 'selectedEstimate', 'target', 'constraint', 'forward', 'reverse', 'digests',
      'currentness', 'sourceAuthenticated', 'assumptionSourcesAuthenticated',
      'weightsAreScenarioAssumptions', 'probabilityCalibrated', 'percentilesIssued',
      'targetIsWhatIfThreshold', 'earnedRevenueMeasured', 'cashMeasured',
      'recommendationIssued', 'researchOnly', 'realForecastEligible', 'analysisIssued',
      'paidNumericServing', 'automaticActionAuthorized'];
    if (!exact(value, keys) || value.version !== 'm26-pipeline-sensitivity-v1' ||
      ['assumption_only', 'unavailable'].indexOf(value.state) < 0 || !instant(value.checkedAt) ||
      !exact(value.digests, ['input', 'output', 'source', 'assumptions', 'review', 'currentness']) ||
      !exact(value.currentness, ['scenarioCurrent', 'sourceCurrent', 'assumptionsCurrent',
        'policyCurrent', 'profileCurrent', 'refreshRequired', 'correctionOrRevocationApplied']) ||
      value.weightsAreScenarioAssumptions !== true || value.probabilityCalibrated !== false ||
      value.percentilesIssued !== false || value.targetIsWhatIfThreshold !== true ||
      value.earnedRevenueMeasured !== false || value.cashMeasured !== false ||
      value.recommendationIssued !== false || value.researchOnly !== true ||
      value.realForecastEligible !== false || value.paidNumericServing !== false ||
      value.automaticActionAuthorized !== false) return null;
    if (value.state === 'unavailable') {
      return text(value.reason, 160) && value.asOf === null && value.horizon === null &&
        value.currency === null && value.scenario === null && value.selectedEstimate === null &&
        value.target === null && value.constraint === null && value.forward === null &&
        value.reverse === null && validSensitivityDigests(value.digests, false) &&
        validSensitivityCurrentness(value.currentness, false) && value.sourceAuthenticated === false &&
        value.assumptionSourcesAuthenticated === false && value.analysisIssued === false ? value : null;
    }
    if (value.reason !== null || !instant(value.asOf) || value.checkedAt < value.asOf ||
      !exact(value.horizon,
      ['startsAt', 'endsAt', 'upperBoundary', 'timeZone']) || !instant(value.horizon.startsAt) ||
      !instant(value.horizon.endsAt) || value.horizon.upperBoundary !== 'exclusive' ||
      value.asOf >= value.horizon.startsAt || value.horizon.startsAt >= value.horizon.endsAt ||
      !/^[A-Z]{3}$/.test(value.currency || '') || !exact(value.scenario,
        ['reviewId', 'reviewRevision', 'reviewDigest', 'sourceSnapshotDigest',
          'assumptionDigest', 'currentnessDigest']) || !uuid(value.scenario.reviewId) ||
      !safeInteger(value.scenario.reviewRevision) || value.scenario.reviewRevision < 1 ||
      ![value.scenario.reviewDigest, value.scenario.sourceSnapshotDigest,
        value.scenario.assumptionDigest, value.scenario.currentnessDigest].every(digest) ||
      !exact(value.selectedEstimate, ['id', 'snapshotDigest', 'category', 'decision',
        'issuedVersion', 'priceBeforeTax', 'currency', 'baseAssumption']) ||
      !uuid(value.selectedEstimate.id) || !digest(value.selectedEstimate.snapshotDigest) ||
      ['preliminary_estimate', 'approved_unbooked'].indexOf(value.selectedEstimate.category) < 0 ||
      !exact(value.selectedEstimate.decision, ['id', 'revision', 'digest']) ||
      !nullableUuid(value.selectedEstimate.decision.id) ||
      (value.selectedEstimate.decision.revision !== null &&
        !safeInteger(value.selectedEstimate.decision.revision)) ||
      !nullableDigest(value.selectedEstimate.decision.digest) ||
      !exact(value.selectedEstimate.issuedVersion, ['id', 'revision', 'digest']) ||
      !nullableUuid(value.selectedEstimate.issuedVersion.id) ||
      (value.selectedEstimate.issuedVersion.revision !== null &&
        !safeInteger(value.selectedEstimate.issuedVersion.revision)) ||
      !nullableDigest(value.selectedEstimate.issuedVersion.digest) ||
      !PRICE.test(value.selectedEstimate.priceBeforeTax || '') ||
      value.selectedEstimate.currency !== value.currency ||
      !validBaseAssumption(value.selectedEstimate.baseAssumption, value.selectedEstimate) ||
      !exact(value.target, ['kind', 'category', 'minimumAmount', 'definition', 'provenance',
        'interpretation']) || value.target.kind !== 'minimum_category_total' ||
      value.target.category !== value.selectedEstimate.category ||
      !REQUEST_MONEY.test(value.target.minimumAmount || '') ||
      !exact(value.target.definition, ['key', 'version', 'digest']) ||
      value.target.definition.key !== 'pipeline.minimum_category_total' ||
      value.target.definition.version !== 'v1' || !digest(value.target.definition.digest) ||
      !exact(value.target.provenance, ['kind', 'actorUserId', 'digest']) ||
      value.target.provenance.kind !== 'authorized_user_input' ||
      !uuid(value.target.provenance.actorUserId) || !digest(value.target.provenance.digest) ||
      value.target.interpretation !== 'user_selected_what_if_threshold' ||
      !exact(value.constraint, ['kind', 'bounds', 'definition', 'provenance']) ||
      value.constraint.kind !== 'selected_estimate_conversion_weight' ||
      !exact(value.constraint.bounds, ['lowerPpm', 'basePpm', 'upperPpm']) ||
      ![value.constraint.bounds.lowerPpm, value.constraint.bounds.basePpm,
        value.constraint.bounds.upperPpm].every(safeInteger) ||
      value.constraint.bounds.lowerPpm > value.constraint.bounds.basePpm ||
      value.constraint.bounds.basePpm > value.constraint.bounds.upperPpm ||
      !exact(value.constraint.definition, ['key', 'version', 'digest']) ||
      value.constraint.definition.key !== 'pipeline.selected_estimate_conversion_weight' ||
      value.constraint.definition.version !== 'v1' ||
      !digest(value.constraint.definition.digest) ||
      !exact(value.constraint.provenance, ['kind', 'id', 'revision', 'digest']) ||
      value.constraint.provenance.kind !== 'owner_approved_pipeline_policy' ||
      !uuid(value.constraint.provenance.id) ||
      !safeInteger(value.constraint.provenance.revision) ||
      value.constraint.provenance.revision < 1 ||
      !digest(value.constraint.provenance.digest) ||
      !validForward(value.forward, value.selectedEstimate, value.constraint) ||
      !validReverse(value.reverse, value.target, value.constraint) ||
      !validSensitivityDigests(value.digests, true) ||
      value.digests.source !== value.scenario.sourceSnapshotDigest ||
      value.digests.assumptions !== value.scenario.assumptionDigest ||
      value.digests.review !== value.scenario.reviewDigest ||
      value.digests.currentness !== value.scenario.currentnessDigest ||
      !validSensitivityCurrentness(value.currentness, true) ||
      value.sourceAuthenticated !== true || value.assumptionSourcesAuthenticated !== true ||
      value.analysisIssued !== true) return null;
    return value;
  }

  function unavailableBaseline(originId, reason) {
    return { version: 'm26-deterministic-baseline-v1', state: 'unavailable', reason: reason,
      originId: originId, checkedAt: '2026-10-08T12:00:00.000000Z', issuedAt: null,
      evaluationAsOf: null, target: null, configuration: null, horizon: null, unit: null,
      sourceSnapshot: null, output: null, evaluation: { state: 'unavailable', evaluatedAt: null,
        outcomeDigest: null, reason: 'finalized_outcome_not_available' }, provenance: null,
      digests: { configuration: null, input: null, output: null, baseline: null, receipt: null },
      currentness: { sourceCurrent: false, refreshRequired: true,
        correctionOrRevocationApplied: true }, sourceAuthenticated: false, researchOnly: true,
      realForecastEligible: false, forecastIssued: false, paidNumericServing: false,
      probabilityIssued: false, calibratedRangeIssued: false, automaticActionAuthorized: false };
  }
  function unavailableRange(originId) {
    return { version: 'm26-calibrated-range-assessment-v1', state: 'unavailable',
      reason: 'deterministic_baseline_not_current', originId: originId,
      assessedAt: '2026-10-08T12:00:00.000000Z', baselineIdentity: null,
      range: { state: 'unavailable', reason: 'deterministic_baseline_not_current', p10: null,
        p50: null, p90: null, nominalCentralCoverage: null, empiricalCalibrationClaimed: false },
      distribution: { state: 'unavailable', reason: 'deterministic_baseline_not_current',
        family: null, parameters: null, distributionDigest: null }, requirements: {
        completeEligibleOriginInventory: { state: 'unavailable',
          reason: 'complete_saved_prediction_inventory_not_available', inventoryDigest: null,
          totalCount: null, issuedCount: null, unavailableCount: null, unpairedCount: null,
          correctedCount: null, revokedCount: null, normalizationFailedCount: null,
          denominatorCategories: ['issued', 'unavailable', 'unpaired', 'corrected', 'revoked',
            'normalization_failed'] },
        preOutcomeChronology: { state: 'unavailable',
          reason: 'pre_outcome_prediction_chronology_not_available', verified: false,
          latestPredictionIssuedAt: null, earliestOutcomeFinalizedAt: null },
        comparableFinalizedOutcomes: { state: 'unavailable',
          reason: 'comparable_finalized_outcomes_not_available',
          outcomeFinalityPolicyVersion: null, outcomeFinalityPolicyDigest: null,
          pairedCount: null, unpairedCount: null, correctedCount: null, revokedCount: null },
        reviewedCalibrationPolicy: { state: 'unavailable',
          reason: 'contractor_calibration_policy_not_available', policyVersion: null,
          policyDigest: null, sufficiencyRule: null, independenceRule: null,
          concentrationRule: null, acceptableErrorRule: null },
        versionedQuantilePolicy: { state: 'unavailable',
          reason: 'versioned_quantile_policy_not_available', policyVersion: null,
          policyDigest: null, nominalCoverage: null, quantileDefinition: null,
          p10Definition: null, p50Definition: null, p90Definition: null },
        heldOutEvaluation: { state: 'unavailable',
          reason: 'held_out_calibration_evaluation_not_available', evaluationPolicyVersion: null,
          evaluationPolicyDigest: null, evaluationDigest: null,
          evaluationCurrentnessDigest: null, evaluatedAt: null, trainingOriginPeriods: null,
          heldOutOriginPeriods: null, pairedCount: null, exclusions: { unavailable: null,
            unpaired: null, corrected: null, revoked: null, normalizationFailed: null },
          nominalCoverage: null, empiricalCoverage: null, quantileScores: null, recency: null,
          drift: null, materialDownside: null },
        existingDescriptiveEvidence: { state: 'inapplicable',
          targetKey: 'pipeline.approved_estimates', requestedTargetKey: 'demand.inbound_leads',
          usableForCalibration: false,
          reason: 'different_target_and_point_only_descriptive_evidence' }
      }, currentness: { baselineCurrent: false, evidenceCurrent: false, refreshRequired: true,
        correctionOrRevocationApplied: true }, digests: { assessment: null,
        completeOriginInventory: null, calibrationPolicy: null, quantilePolicy: null,
        heldOutEvaluation: null, backtest: null }, sourceAuthenticated: false,
      researchOnly: true, realForecastEligible: false, probabilityDistributionIssued: false,
      calibratedRangeIssued: false, paidNumericServing: false, automaticActionAuthorized: false };
  }
  function unavailableScenario(reason) {
    var item = function () { return { state: 'unavailable', reason: reason,
      preliminaryEstimate: null, approvedUnbooked: null, total: null }; };
    return { version: 'm26-named-pipeline-scenario-v1', state: 'unavailable', reason: reason,
      checkedAt: '2026-10-08T12:00:00.000000Z', asOf: null, horizon: null, currency: null,
      target: { key: 'pipeline.open_value_scenario', version: 'v1' }, sourceSnapshot: null,
      scenarioReview: null, scenarios: { adverse: item(), base: item(), favorable: item() },
      assumptions: [], digests: { source: null, assumptions: null, output: null, review: null,
        currentness: null }, currentness: { reviewCurrent: false, sourceCurrent: false,
        policyCurrent: false, profileCurrent: false, refreshRequired: true,
        correctionOrRevocationApplied: false }, sourceAuthenticated: false,
      assumptionSourcesAuthenticated: false, weightsAreScenarioAssumptions: true,
      probabilityCalibrated: false, percentilesIssued: false, earnedRevenueMeasured: false,
      cashMeasured: false, researchOnly: true, realForecastEligible: false,
      forecastIssued: false, paidNumericServing: false, automaticActionAuthorized: false };
  }
  function unavailableSensitivity(reason) {
    return { version: 'm26-pipeline-sensitivity-v1', state: 'unavailable', reason: reason,
      checkedAt: '2026-10-08T12:00:00.000000Z', asOf: null, horizon: null, currency: null,
      scenario: null, selectedEstimate: null, target: null, constraint: null, forward: null,
      reverse: null, digests: { input: null, output: null, source: null, assumptions: null,
        review: null, currentness: null }, currentness: { scenarioCurrent: false,
        sourceCurrent: false, assumptionsCurrent: false, policyCurrent: false,
        profileCurrent: false, refreshRequired: true, correctionOrRevocationApplied: true },
      sourceAuthenticated: false, assumptionSourcesAuthenticated: false,
      weightsAreScenarioAssumptions: true, probabilityCalibrated: false,
      percentilesIssued: false, targetIsWhatIfThreshold: true, earnedRevenueMeasured: false,
      cashMeasured: false, recommendationIssued: false, researchOnly: true,
      realForecastEligible: false, analysisIssued: false, paidNumericServing: false,
      automaticActionAuthorized: false };
  }
  function demoBundle() {
    var originId = '90000000-0000-4000-8000-000000000009';
    return { baseline: unavailableBaseline(originId, 'complete_period_lineage_unavailable'),
      range: unavailableRange(originId), scenario: unavailableScenario('no_current_scenario_review'),
      sensitivity: unavailableSensitivity('named_scenario_unavailable') };
  }

  function create(options) {
    var document = options.document; var generation = 0; var authority = null;
    var scenario = null; var sensitivity = null;
    function id(name) { return document.getElementById(name); }
    function element(tag, className, content) {
      var node = document.createElement(tag); if (className) node.className = className;
      if (content !== undefined) node.textContent = String(content); return node;
    }
    function label(value) {
      return String(value || 'unavailable').replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ').replace(/^./, function (letter) { return letter.toUpperCase(); });
    }
    function shown(value) {
      if (value === null || value === undefined) return 'Unavailable';
      if (value === true) return 'Yes'; if (value === false) return 'No'; return String(value);
    }
    function validAuthority(value) {
      return exact(value, ['tenantId', 'role', 'mode', 'fictional']) && text(value.tenantId, 160) &&
        text(value.role, 64) && value.mode === options.mode &&
        value.fictional === (options.mode === 'demo');
    }
    function metadata(title, rows) {
      var section = element('section', 'command-center-forecast-metadata');
      section.appendChild(element('h4', null, title)); var list = element('dl');
      rows.forEach(function (row) {
        list.append(element('dt', null, row[0]), element('dd', null, shown(row[1])));
      }); section.appendChild(list); return section;
    }
    function setCard(name, state, value, context, rows) {
      id('commandCenterForecast' + name + 'State').textContent = state;
      id('commandCenterForecast' + name + 'State').dataset.state = state === 'Unavailable' ||
        state === 'Not analyzed' || state === 'Impossible target' ? 'unavailable' : 'current';
      id('commandCenterForecast' + name + 'Value').textContent = value;
      id('commandCenterForecast' + name + 'Context').textContent = context;
      var details = id('commandCenterForecast' + name + 'Details'); details.replaceChildren();
      if (rows && rows.length) details.appendChild(metadata(name + ' evidence', rows));
      else details.appendChild(element('p', null, 'No current authenticated evidence is shown.'));
    }
    function authorityRows() {
      return [['Authenticated tenant', authority.tenantId], ['Authenticated role', authority.role],
        ['Workspace mode', authority.mode], ['Fictional isolated data', authority.fictional]];
    }
    function clearAll(message) {
      setCard('Baseline', 'Unavailable', 'Not available', message, null);
      setCard('Range', 'Unavailable', 'P10 / P50 / P90 withheld', message, null);
      setCard('Scenario', 'Unavailable', 'Not available', message, null);
      setCard('Sensitivity', 'Not analyzed', 'Not available', message, null);
      id('commandCenterForecastEvidenceMap').replaceChildren();
      id('commandCenterForecastEvidenceDescription').textContent =
        'No forecast evidence is shown. There is no quantitative shared scale.';
      var target = id('commandCenterForecastAuthority'); target.replaceChildren();
      target.appendChild(element('p', null, 'Current authenticated tenant and role context is unavailable.'));
    }
    function announce(message) { id('commandCenterForecastStatus').textContent = message; }
    function loading() {
      generation += 1; scenario = null; sensitivity = null;
      id('commandCenterForecastRanges').setAttribute('aria-busy', 'true');
      id('commandCenterForecastState').textContent = 'Loading';
      id('commandCenterForecastState').dataset.state = 'loading';
      clearAll('Loading current forecast evidence. Previous values and lineage were cleared.');
      id('commandCenterForecastExplanation').textContent =
        'Checking exact current baseline, range and named-scenario evidence.';
      id('commandCenterForecastBoundary').textContent =
        'No probability, percentile, scenario amount, sensitivity amount or recommendation is shown while loading.';
      announce('Forecast evidence is loading. Previous values were cleared.');
    }
    function baselineRows(value) {
      var rows = authorityRows().concat([['Contract', value.version], ['State', value.state],
        ['Reason', value.reason], ['Origin receipt', value.originId], ['Checked at', value.checkedAt],
        ['Issued at', value.issuedAt], ['Source current', value.currentness.sourceCurrent],
        ['Refresh required', value.currentness.refreshRequired],
        ['Correction or revocation applied', value.currentness.correctionOrRevocationApplied]]);
      if (value.state === 'current') rows = rows.concat([
        ['Target', value.target.key], ['Target version', value.target.definitionVersion],
        ['Source scope', value.target.sourceScope], ['Unit', value.unit.key],
        ['Currency', value.unit.currency], ['Horizon grain', value.horizon.grain],
        ['Horizon starts at', value.horizon.startsAt], ['Horizon ends at', value.horizon.endsAt],
        ['Business time zone', value.horizon.timeZone], ['Algorithm', value.configuration.algorithmId],
        ['Algorithm version', value.configuration.algorithmVersion],
        ['Build kind', value.configuration.buildIdentity.kind],
        ['Build procedure', value.configuration.buildIdentity.procedure],
        ['Configuration digest', value.digests.configuration], ['Input digest', value.digests.input],
        ['Output digest', value.digests.output], ['Baseline digest', value.digests.baseline],
        ['Source snapshot digest', value.sourceSnapshot.evidenceDigest],
        ['Complete as of', value.sourceSnapshot.completeAsOf], ['Has more', value.sourceSnapshot.hasMore],
        ['Paid numeric serving', value.paidNumericServing]]);
      return rows;
    }
    function rangeRows(value) {
      var rows = authorityRows().concat([['Contract', value.version], ['State', value.state],
        ['Reason', value.reason], ['Origin receipt', value.originId], ['Assessed at', value.assessedAt],
        ['Baseline current', value.currentness.baselineCurrent],
        ['Evidence current', value.currentness.evidenceCurrent],
        ['Refresh required', value.currentness.refreshRequired],
        ['P10 issued', value.range.p10 !== null], ['P50 issued', value.range.p50 !== null],
        ['P90 issued', value.range.p90 !== null],
        ['Empirical calibration claimed', value.range.empiricalCalibrationClaimed],
        ['Assessment digest', value.digests.assessment],
        ['Paid numeric serving', value.paidNumericServing]]);
      if (value.baselineIdentity) rows = rows.concat([
        ['Target', value.baselineIdentity.target.key],
        ['Target version', value.baselineIdentity.target.definitionVersion],
        ['Source scope', value.baselineIdentity.target.sourceScope],
        ['Unit', value.baselineIdentity.unit.key], ['Currency', value.baselineIdentity.unit.currency],
        ['Horizon grain', value.baselineIdentity.horizon.grain],
        ['Horizon starts at', value.baselineIdentity.horizon.startsAt],
        ['Horizon ends at', value.baselineIdentity.horizon.endsAt],
        ['Business time zone', value.baselineIdentity.horizon.timeZone],
        ['Source snapshot digest', value.baselineIdentity.sourceSnapshotDigest],
        ['Baseline digest', value.baselineIdentity.baselineDigest],
        ['Configuration digest', value.baselineIdentity.configurationDigest],
        ['Algorithm', value.baselineIdentity.algorithm.key],
        ['Algorithm version', value.baselineIdentity.algorithm.version]]);
      return rows;
    }
    function scenarioRows(value) {
      var rows = authorityRows().concat([['Contract', value.version], ['State', value.state],
        ['Reason', value.reason], ['Checked at', value.checkedAt],
        ['Weights are scenario assumptions', value.weightsAreScenarioAssumptions],
        ['Probability calibrated', value.probabilityCalibrated],
        ['Percentiles issued', value.percentilesIssued], ['Paid numeric serving', value.paidNumericServing]]);
      if (value.state === 'current') rows = rows.concat([
        ['As of', value.asOf], ['Currency', value.currency],
        ['Horizon starts at', value.horizon.startsAt], ['Horizon ends at', value.horizon.endsAt],
        ['Business time zone', value.horizon.timeZone], ['Scenario review id', value.scenarioReview.id],
        ['Scenario review revision', value.scenarioReview.revision],
        ['Scenario review digest', value.scenarioReview.digest],
        ['Source snapshot digest', value.sourceSnapshot.digest],
        ['Assumption digest', value.digests.assumptions], ['Output digest', value.digests.output],
        ['Currentness digest', value.digests.currentness],
        ['Assumption count', value.assumptions.length], ['Source complete as of', value.sourceSnapshot.completeAsOf],
        ['Source has more', value.sourceSnapshot.hasMore]]);
      return rows;
    }
    function sensitivityRows(value) {
      var rows = authorityRows().concat([['Contract', value.version], ['State', value.state],
        ['Reason', value.reason], ['Checked at', value.checkedAt],
        ['Weights are scenario assumptions', value.weightsAreScenarioAssumptions],
        ['Target is what-if threshold', value.targetIsWhatIfThreshold],
        ['Probability calibrated', value.probabilityCalibrated],
        ['Percentiles issued', value.percentilesIssued], ['Recommendation issued', value.recommendationIssued],
        ['Paid numeric serving', value.paidNumericServing]]);
      if (value.state === 'assumption_only') rows = rows.concat([
        ['Scenario review id', value.scenario.reviewId],
        ['Scenario review revision', value.scenario.reviewRevision],
        ['Scenario review digest', value.scenario.reviewDigest],
        ['Source snapshot digest', value.scenario.sourceSnapshotDigest],
        ['Assumption digest', value.scenario.assumptionDigest],
        ['Currentness digest', value.scenario.currentnessDigest],
        ['Selected estimate id', value.selectedEstimate.id],
        ['Selected estimate revision digest', value.selectedEstimate.snapshotDigest],
        ['Target kind', value.target.kind], ['Constraint kind', value.constraint.kind],
        ['Reverse state', value.reverse.state], ['Reverse reason', value.reverse.reason],
        ['Binding constraint', value.reverse.bindingConstraint && value.reverse.bindingConstraint.kind],
        ['Input digest', value.digests.input], ['Output digest', value.digests.output],
        ['Business time zone', value.horizon.timeZone]]);
      return rows;
    }
    function renderBaseline(value) {
      if (!value) return setCard('Baseline', 'Unavailable', 'Not available',
        'The authenticated deterministic baseline response is unavailable.', null);
      if (value.state === 'unavailable') return setCard('Baseline', 'Unavailable', 'Not available',
        'No point baseline is current. Exact reason: ' + label(value.reason) + '.', baselineRows(value));
      setCard('Baseline', 'Research only', 'Point value withheld',
        'A current authenticated point baseline exists for research, but paid numeric serving is disabled.',
        baselineRows(value));
    }
    function renderRange(value) {
      if (!value) return setCard('Range', 'Unavailable', 'P10 / P50 / P90 withheld',
        'The authenticated calibration assessment is unavailable.', null);
      setCard('Range', 'Unavailable', 'P10 / P50 / P90 withheld',
        'No calibrated probability distribution or percentile range was issued. Exact reason: ' +
          label(value.reason) + '.', rangeRows(value));
    }
    function renderScenario(value) {
      scenario = value && value.state === 'current' ? value : null;
      if (!value) return setCard('Scenario', 'Unavailable', 'Not available',
        'The authenticated named-scenario response is unavailable.', null);
      if (value.state === 'unavailable') return setCard('Scenario', 'Unavailable', 'Not available',
        'No current reviewed adverse, base and favorable assumptions exist. Exact reason: ' +
          label(value.reason) + '.', scenarioRows(value));
      setCard('Scenario', 'What-if only', 'Values withheld',
        'Adverse, base and favorable are explicit assumption variations. They are not percentiles, measured odds or promised revenue.',
        scenarioRows(value));
    }
    function renderSensitivity(value) {
      sensitivity = value;
      if (!value) return setCard('Sensitivity', 'Not analyzed', 'Not available',
        'Choose an explicit supported what-if target in its authorized workflow before forward or reverse analysis can exist.', null);
      if (value.state === 'unavailable') return setCard('Sensitivity', 'Unavailable', 'Not available',
        'No current bounded sensitivity result exists. Exact reason: ' + label(value.reason) + '.',
        sensitivityRows(value));
      if (value.reverse.state === 'impossible') return setCard('Sensitivity', 'Impossible target',
        'No in-bounds solution', 'The requested threshold exceeds the approved selected-weight bound. No weight was invented.',
        sensitivityRows(value));
      setCard('Sensitivity', 'What-if only', 'Values withheld',
        'Forward and reverse results are bounded assumption checks, not probabilities, recommendations or promised revenue.',
        sensitivityRows(value));
    }
    function renderMap() {
      var target = id('commandCenterForecastEvidenceMap'); target.replaceChildren();
      [['Baseline', id('commandCenterForecastBaselineState').textContent],
        ['Calibrated range', id('commandCenterForecastRangeState').textContent],
        ['Named scenarios', id('commandCenterForecastScenarioState').textContent],
        ['Sensitivity', id('commandCenterForecastSensitivityState').textContent]]
        .forEach(function (item) {
          var row = element('div', 'command-center-forecast-map-row');
          row.append(element('span', 'command-center-forecast-map-marker'),
            element('strong', null, item[0]), element('span', null, item[1]));
          target.appendChild(row);
        });
      id('commandCenterForecastEvidenceDescription').textContent =
        'Evidence status only, with no shared quantitative scale. Baseline: ' +
        id('commandCenterForecastBaselineState').textContent + '. Calibrated range: ' +
        id('commandCenterForecastRangeState').textContent + '. Named scenarios: ' +
        id('commandCenterForecastScenarioState').textContent + '. Sensitivity: ' +
        id('commandCenterForecastSensitivityState').textContent + '.';
    }
    function renderAuthority() {
      var target = id('commandCenterForecastAuthority'); target.replaceChildren();
      target.appendChild(metadata('Current authenticated boundary', authorityRows()));
    }
    function renderBundle(bundle) {
      var safe = { baseline: validateBaseline(bundle && bundle.baseline),
        range: validateRange(bundle && bundle.range),
        scenario: validateScenario(bundle && bundle.scenario),
        sensitivity: validateSensitivity(bundle && bundle.sensitivity) };
      renderAuthority(); renderBaseline(safe.baseline); renderRange(safe.range);
      renderScenario(safe.scenario); renderSensitivity(safe.sensitivity); renderMap();
      id('commandCenterForecastRanges').setAttribute('aria-busy', 'false');
      id('commandCenterForecastState').textContent = options.mode === 'demo'
        ? 'Fictional evidence' : 'Range unavailable';
      id('commandCenterForecastState').dataset.state = 'unavailable';
      id('commandCenterForecastExplanation').textContent = options.mode === 'demo'
        ? 'This isolated fictional example uses the same guarded presentation and does not call paid forecast routes.'
        : 'Current forecast evidence is separated below. No calibrated probability range is available.';
      id('commandCenterForecastBoundary').textContent =
        'A point baseline is not a calibrated range. Named scenarios and sensitivity targets are what-if assumptions, not percentiles, probabilities, promised revenue, recommendations or automatic actions.';
      announce((options.mode === 'demo' ? 'Fictional isolated forecast evidence loaded. ' :
        'Forecast evidence loaded. ') + 'P10, P50 and P90 remain unavailable.');
    }
    function fetchDomain(url, validator, run) {
      return options.fetcher(url, { method: 'GET', credentials: 'same-origin', cache: 'no-store',
        headers: { Accept: 'application/json' } }).then(function (response) {
        return response.json().catch(function () { return null; }).then(function (payload) {
          if (run !== generation || !response.ok || !payload || payload.success !== true) return null;
          return validator(payload.data);
        });
      }).catch(function () { return null; });
    }
    function originId() {
      var supplied = typeof options.originProvider === 'function' ? options.originProvider() : null;
      return uuid(supplied) ? supplied : null;
    }
    function load(nextAuthority) {
      loading(); var run = generation;
      authority = validAuthority(nextAuthority) ? nextAuthority : null;
      if (!authority) {
        id('commandCenterForecastRanges').setAttribute('aria-busy', 'false');
        id('commandCenterForecastState').textContent = 'Workspace unavailable';
        id('commandCenterForecastState').dataset.state = 'unavailable';
        id('commandCenterForecastExplanation').textContent =
          'Current authenticated tenant and role context is required before forecast evidence can load.';
        id('commandCenterForecastBoundary').textContent =
          'No forecast evidence is shown without current tenant and role authority.';
        announce('Forecast evidence is unavailable. Previous values were cleared.');
        return Promise.resolve();
      }
      if (options.mode === 'demo') { renderBundle(demoBundle()); return Promise.resolve(); }
      var origin = originId();
      var baseline = origin ? fetchDomain('/api/v1/forecast/deterministic-baselines/' +
        encodeURIComponent(origin), validateBaseline, run) : Promise.resolve(null);
      var range = origin ? fetchDomain('/api/v1/forecast/calibrated-ranges/' +
        encodeURIComponent(origin), validateRange, run) : Promise.resolve(null);
      return Promise.all([baseline, range,
        fetchDomain('/api/v1/forecast/named-pipeline-scenarios/current', validateScenario, run)])
        .then(function (values) {
          if (run !== generation) return;
          renderBundle({ baseline: values[0], range: values[1], scenario: values[2],
            sensitivity: null });
        });
    }
    function sensitivityReady(value) {
      var safe = validateSensitivity(value);
      if (!authority || options.mode !== 'paid' || !scenario || !safe ||
        safe.state !== 'assumption_only' || safe.scenario.reviewId !== scenario.scenarioReview.id ||
        safe.scenario.reviewRevision !== scenario.scenarioReview.revision ||
        safe.scenario.reviewDigest !== scenario.scenarioReview.digest ||
        safe.scenario.sourceSnapshotDigest !== scenario.digests.source ||
        safe.scenario.assumptionDigest !== scenario.digests.assumptions ||
        safe.scenario.currentnessDigest !== scenario.digests.currentness) {
        renderSensitivity(null); renderMap();
        return false;
      }
      renderSensitivity(safe); renderMap(); return true;
    }
    return { workspaceReady: load, workspaceLoading: loading,
      sensitivityReady: sensitivityReady, workspaceUnavailable: function () {
        generation += 1; authority = null; scenario = null; sensitivity = null;
        id('commandCenterForecastRanges').setAttribute('aria-busy', 'false');
        id('commandCenterForecastState').textContent = 'Workspace unavailable';
        id('commandCenterForecastState').dataset.state = 'unavailable';
        clearAll('No forecast evidence is shown while the workspace is unavailable.');
        id('commandCenterForecastExplanation').textContent =
          'The workspace could not load. Refresh to retry current forecast evidence.';
        id('commandCenterForecastBoundary').textContent =
          'No baseline, range, scenario or sensitivity value is retained after workspace loss.';
        announce('Forecast evidence is unavailable. Previous values were cleared.');
      } };
  }

  global.NorthStarForecastRanges = { create: create, demoBundle: demoBundle,
    validateBaseline: validateBaseline, validateRange: validateRange,
    validateScenario: validateScenario, validateSensitivity: validateSensitivity };
})(window);
