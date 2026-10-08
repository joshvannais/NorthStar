'use strict';

const express = require('express');
const db = require('../db');
const { requireOnboardedInternal } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { rateLimit } = require('../middleware/rateLimit');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HOURS = /^(?:0|[1-9][0-9]{0,14})(?:\.[0-9]{1,6})?$/;
const UNAVAILABLE_REASONS = new Set([
  'business_calendar_unavailable', 'complete_source_coverage_unavailable',
  'approved_timing_attribution_unavailable',
  'current_owner_confirmed_booking_unavailable',
  'duplicate_current_job_equipment_source',
  'current_adopted_equipment_composition_unavailable',
  'current_adopted_readiness_unavailable', 'exact_asset_identity_unavailable',
  'compatible_m25_outcome_unavailable',
]);

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && own.every(key => {
    if (typeof key !== 'string' || !keys.includes(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
  });
}

function dense(value, maximum) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      value.length > maximum || Reflect.ownKeys(value).length !== value.length + 1) return false;
  return value.every((_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    return descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
  });
}

function plainJson(value, budget, depth = 0) {
  if (++budget.nodes > 120000 || depth > 12) return false;
  if (value === null || typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value)) ||
      (typeof value === 'string' && value.length <= 131072)) return true;
  if (Array.isArray(value)) return dense(value, 200) &&
    value.every(item => plainJson(item, budget, depth + 1));
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length <= 100 && keys.every(key => typeof key === 'string' && key.length <= 160 &&
    !['__proto__','prototype','constructor'].includes(key) &&
    Object.getOwnPropertyDescriptor(value, key)?.enumerable &&
    Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value') &&
    plainJson(Object.getOwnPropertyDescriptor(value, key).value, budget, depth + 1));
}

function validInstant(value) {
  if (typeof value !== 'string' || !INSTANT.test(value) || /T24:|:60(?:\.|Z)/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 19) === value.slice(0, 19);
}

function text(value, maximum = 500) {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum &&
    value === value.trim() && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}

function hours(value) {
  if (typeof value !== 'string' || !HOURS.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'));
}

function validHorizon(value, checkedAt, state) {
  return exact(value, ['kind','timeZone','startsAt','endsAt','startsOn','endsOnExclusive']) &&
    value.kind === 'next_30_elapsed_days' &&
    (text(value.timeZone, 100) || (state === 'unavailable' && value.timeZone === null)) &&
    validInstant(value.startsAt) && validInstant(value.endsAt) && value.startsAt === checkedAt &&
    DATE.test(value.startsOn) && DATE.test(value.endsOnExclusive) &&
    new Date(value.endsAt).getTime() - new Date(value.startsAt).getTime() === 2592000000;
}

function validSource(value, index, budget) {
  if (!exact(value, ['sourceIndex','job','estimate','composition','equipmentCostPlan',
    'equipmentPlan','readinessPlan']) || value.sourceIndex !== index ||
      !exact(value.job, ['appointmentId','assignmentId','bookingReviewId',
        'bookingConfirmationId','issuedVersionId','plannedWindow']) ||
      ![value.job.appointmentId,value.job.assignmentId,value.job.bookingReviewId,
        value.job.bookingConfirmationId,value.job.issuedVersionId].every(id => UUID.test(id || '')) ||
      !exact(value.job.plannedWindow, ['startsAt','endsAt']) ||
      !validInstant(value.job.plannedWindow.startsAt) || !validInstant(value.job.plannedWindow.endsAt) ||
      value.job.plannedWindow.startsAt >= value.job.plannedWindow.endsAt ||
      !exact(value.estimate, ['id','revisionId','revision','digest']) ||
      !UUID.test(value.estimate.id || '') || !UUID.test(value.estimate.revisionId || '') ||
      !Number.isSafeInteger(value.estimate.revision) || value.estimate.revision < 1 ||
      !DIGEST.test(value.estimate.digest || '') ||
      !exact(value.composition, ['id','revision','digest','calculationVersion',
        'componentManifest','coverageAssessment']) || !UUID.test(value.composition.id || '') ||
      !Number.isSafeInteger(value.composition.revision) || value.composition.revision < 1 ||
      !DIGEST.test(value.composition.digest || '') ||
      value.composition.calculationVersion !== 'estimate-cost-adoption-v3' ||
      !plainJson(value.composition.componentManifest, budget) ||
      !plainJson(value.composition.coverageAssessment, budget)) return false;
  for (const [name, version] of [['equipmentCostPlan','estimate-equipment-cost-plan-v1'],
    ['equipmentPlan','estimate-equipment-plan-v1'],
    ['readinessPlan','estimate-equipment-readiness-v1']]) {
    const item = value[name];
    const keys = name === 'readinessPlan' ?
      ['id','revision','digest','calculationVersion','evidenceDigest'] :
      ['id','revision','digest','calculationVersion'];
    if (!exact(item, keys) || !UUID.test(item.id || '') ||
        !Number.isSafeInteger(item.revision) || item.revision < 1 ||
        !DIGEST.test(item.digest || '') || item.calculationVersion !== version ||
        (name === 'readinessPlan' && !DIGEST.test(item.evidenceDigest || ''))) return false;
  }
  return true;
}

function validUse(value, sources) {
  return exact(value, ['sourceIndex','lineId','plannedWindow','claimedOperatingHours']) &&
    Number.isSafeInteger(value.sourceIndex) && value.sourceIndex >= 0 &&
    value.sourceIndex < sources.length && UUID.test(value.lineId || '') &&
    exact(value.plannedWindow, ['startsAt','endsAt']) &&
    value.plannedWindow.startsAt === sources[value.sourceIndex].job.plannedWindow.startsAt &&
    value.plannedWindow.endsAt === sources[value.sourceIndex].job.plannedWindow.endsAt &&
    hours(value.claimedOperatingHours) !== null && hours(value.claimedOperatingHours) > 0n;
}

function validAsset(value, sources, sourceAsOf, horizon) {
  const keys = ['asset','plannedUtilization','meter','serviceInterval','maintenanceDue',
    'serviceTiming','currentReadiness','rentalLease','downtimeRisk'];
  if (!exact(value, keys) || !exact(value.asset,
    ['id','version','digest','category','accessType','planAccessBasis']) ||
      !UUID.test(value.asset.id || '') || !Number.isSafeInteger(value.asset.version) ||
      value.asset.version < 1 || !DIGEST.test(value.asset.digest || '') ||
      !['vehicle','equipment','tool','trailer','attachment','other'].includes(value.asset.category) ||
      !['owned','leased','rented','borrowed','unknown'].includes(value.asset.accessType) ||
      !['unknown','owned','rented','financed'].includes(value.asset.planAccessBasis)) return false;
  const planned = value.plannedUtilization;
  if (!exact(planned, ['state','claimedOperatingHours','useCount','uses',
    'operatingTimeVerified','checkoutDurationUsed','reason']) ||
      !['current_claimed_plan_only','unavailable'].includes(planned.state) ||
      !Number.isSafeInteger(planned.useCount) || planned.useCount < 1 ||
      !dense(planned.uses, 10000) || planned.uses.length !== planned.useCount ||
      !planned.uses.every(use => validUse(use, sources)) ||
      planned.operatingTimeVerified !== false || planned.checkoutDurationUsed !== false) return false;
  const total = planned.uses.reduce((sum, use) => sum + hours(use.claimedOperatingHours), 0n);
  if (planned.state === 'current_claimed_plan_only') {
    if (hours(planned.claimedOperatingHours) !== total || planned.reason !== null) return false;
  } else if (planned.claimedOperatingHours !== null ||
      planned.reason !== 'non_overlapping_planned_utilization_unavailable') return false;
  const meter = value.meter;
  if (!exact(meter, ['state','meterKey','unit','reading','observedAt','eventId','eventRevision',
    'eventDigest','ledgerRevision','ledgerDigest','resetApplied','correctionApplied',
    'historyComplete','reason']) || !['current_as_of_source','unavailable'].includes(meter.state)) return false;
  if (meter.state === 'current_as_of_source') {
    if (!text(meter.meterKey, 80) || meter.unit !== 'hours' || hours(meter.reading) === null ||
        !validInstant(meter.observedAt) || !UUID.test(meter.eventId || '') ||
        meter.observedAt > sourceAsOf ||
        !Number.isSafeInteger(meter.eventRevision) || meter.eventRevision < 1 ||
        !DIGEST.test(meter.eventDigest || '') || !Number.isSafeInteger(meter.ledgerRevision) ||
        meter.ledgerRevision < meter.eventRevision || !DIGEST.test(meter.ledgerDigest || '') ||
        typeof meter.resetApplied !== 'boolean' || typeof meter.correctionApplied !== 'boolean' ||
        meter.historyComplete !== true || meter.reason !== null) return false;
  } else if (!(meter.meterKey === null || text(meter.meterKey, 80)) ||
      !(meter.unit === null || text(meter.unit, 40)) || meter.reading !== null ||
      meter.observedAt !== null || meter.eventId !== null || meter.eventRevision !== null ||
      meter.eventDigest !== null ||
      !(meter.ledgerRevision === null || Number.isSafeInteger(meter.ledgerRevision) &&
        meter.ledgerRevision >= 1) ||
      !(meter.ledgerDigest === null || DIGEST.test(meter.ledgerDigest)) ||
      (meter.ledgerRevision === null) !== (meter.ledgerDigest === null) ||
      meter.resetApplied !== null || meter.correctionApplied !== null ||
      meter.historyComplete !== false || !text(meter.reason)) return false;
  const service = value.serviceInterval;
  if (!exact(service, ['state','meterKey','unit','threshold','thresholdReference',
    'currentReading','projectedReading','hoursRemainingAtStart','thresholdReachedNow',
    'thresholdReachedByClaimedPlan','verifiedServiceDate','reason']) ||
      !['current_claimed_plan_position','unavailable'].includes(service.state) ||
      service.verifiedServiceDate !== null) return false;
  if (service.state === 'current_claimed_plan_position') {
    const current = hours(service.currentReading);
    const projected = hours(service.projectedReading);
    const threshold = hours(service.threshold);
    const remaining = hours(service.hoursRemainingAtStart);
    if (meter.state !== 'current_as_of_source' || service.meterKey !== meter.meterKey ||
        service.unit !== 'hours' || !text(service.thresholdReference) ||
        [threshold,current,projected,remaining].some(item => item === null) ||
        current !== hours(meter.reading) || projected !== current + total ||
        remaining !== (threshold > current ? threshold - current : 0n) ||
        typeof service.thresholdReachedNow !== 'boolean' ||
        service.thresholdReachedNow !== (current >= threshold) ||
        typeof service.thresholdReachedByClaimedPlan !== 'boolean' ||
        service.thresholdReachedByClaimedPlan !== (projected >= threshold) ||
        service.reason !== null) return false;
  } else if ([service.threshold,service.thresholdReference,service.currentReading,
    service.projectedReading,service.hoursRemainingAtStart,service.thresholdReachedNow,
    service.thresholdReachedByClaimedPlan].some(item => item !== null) || !text(service.reason)) return false;
  const maintenance = value.maintenanceDue;
  if (!exact(maintenance, ['state','dueAt','dueWithinHorizon','dueByRecordedMeter',
    'dueByClaimedPlanEnd','maintenanceScheduleVerified','maintenanceWorkAuthorized','reason']) ||
      !['current_claimed_plan_position','unavailable'].includes(maintenance.state) ||
      maintenance.maintenanceScheduleVerified !== false || maintenance.maintenanceWorkAuthorized !== false) return false;
  if (maintenance.state === 'current_claimed_plan_position') {
    if (service.state !== 'current_claimed_plan_position' ||
        !(maintenance.dueAt === null || validInstant(maintenance.dueAt)) ||
        typeof maintenance.dueWithinHorizon !== 'boolean' ||
        maintenance.dueWithinHorizon !== (maintenance.dueAt !== null &&
          maintenance.dueAt >= horizon.startsAt && maintenance.dueAt < horizon.endsAt) ||
        typeof maintenance.dueByRecordedMeter !== 'boolean' ||
        maintenance.dueByRecordedMeter !== service.thresholdReachedNow ||
        typeof maintenance.dueByClaimedPlanEnd !== 'boolean' || maintenance.reason !== null) return false;
    if (maintenance.dueByClaimedPlanEnd !== service.thresholdReachedByClaimedPlan) return false;
  } else if ([maintenance.dueAt,maintenance.dueWithinHorizon,
    maintenance.dueByRecordedMeter,maintenance.dueByClaimedPlanEnd].some(item => item !== null) ||
    !text(maintenance.reason)) return false;
  if (!exact(value.serviceTiming, ['state','serviceAt','reason']) ||
      value.serviceTiming.state !== 'unavailable' || value.serviceTiming.serviceAt !== null ||
      value.serviceTiming.reason !== 'operating_hour_timing_unavailable' ||
      !exact(value.currentReadiness, ['state','recordedDowntime','recordedFault',
        'sourceCondition','reason']) ||
      !['current_as_of_source','unavailable'].includes(value.currentReadiness.state)) return false;
  if (value.currentReadiness.state === 'current_as_of_source') {
    if (typeof value.currentReadiness.recordedDowntime !== 'boolean' ||
        typeof value.currentReadiness.recordedFault !== 'boolean' ||
        !['unknown','reported_no_problem','problem_reported','out_of_service']
          .includes(value.currentReadiness.sourceCondition) || value.currentReadiness.reason !== null) return false;
  } else if ([value.currentReadiness.recordedDowntime,value.currentReadiness.recordedFault,
    value.currentReadiness.sourceCondition].some(item => item !== null) ||
    value.currentReadiness.reason !== 'complete_equipment_history_unavailable') return false;
  if (!exact(value.rentalLease, ['state','assetAccessType','planAccessBasis',
    'providerAvailabilityVerified','providerMaintenanceVerified','reason']) ||
      !['owned_current','provider_semantics_unavailable'].includes(value.rentalLease.state) ||
      value.rentalLease.assetAccessType !== value.asset.accessType ||
      value.rentalLease.planAccessBasis !== value.asset.planAccessBasis ||
      value.rentalLease.providerAvailabilityVerified !== false ||
      value.rentalLease.providerMaintenanceVerified !== false ||
      (value.rentalLease.state === 'owned_current' ?
        value.asset.accessType !== 'owned' || value.asset.planAccessBasis !== 'owned' ||
          value.rentalLease.reason !== null :
        value.asset.accessType === 'owned' && value.asset.planAccessBasis === 'owned' ||
          value.rentalLease.reason !== 'rental_or_lease_provider_evidence_unavailable')) return false;
  return exact(value.downtimeRisk, ['state','risk','probability','reason']) &&
    value.downtimeRisk.state === 'unavailable' && value.downtimeRisk.risk === null &&
    value.downtimeRisk.probability === null &&
    value.downtimeRisk.reason === 'evaluated_downtime_risk_evidence_unavailable';
}

function sanitizeForecast(value) {
  const keys = ['version','state','reason','fictional','checkedAt','sourceAsOf','horizon','scope',
    'sourceCoverage','sources','assets','utilization','learnedOutcomes','evidence','run',
    'forecastIssued','utilizationForecastIssued','serviceIntervalForecastIssued',
    'maintenanceDueForecastIssued','serviceTimingForecastIssued','downtimeRiskForecastIssued',
    'calibratedRangeIssued','probabilityIssued','automaticActionAuthorized'];
  if (!exact(value, keys) || value.version !== 'm26-asset-utilization-risk-forecast-v1' ||
      !['current','unavailable'].includes(value.state) || value.fictional !== false ||
      !validInstant(value.checkedAt) || !validInstant(value.sourceAsOf) ||
      !validHorizon(value.horizon, value.checkedAt, value.state) ||
      !exact(value.scope, ['label','wholeBusinessCoverageVerified','offPlatformCoverageVerified']) ||
      value.scope.label !== 'Authenticated owner-confirmed scheduled backlog' ||
      value.scope.wholeBusinessCoverageVerified !== false ||
      value.scope.offPlatformCoverageVerified !== false ||
      !exact(value.learnedOutcomes, ['state','applicableValueCount','applied','reason']) ||
      value.learnedOutcomes.applied !== false ||
      !exact(value.evidence, ['sourceAuthenticatedUtilization','currentAdoptedEquipmentVerified',
        'currentReadinessVerified','currentnessVerified','compatibleUnitsVerified',
        'periodAttributionVerified','meterHistoryVerified','serviceThresholdPolicyVerified',
        'maintenanceScheduleVerified','rentalLeaseProviderEvidenceVerified','m25AdjustmentApplied',
        'evaluatedDowntimeRiskVerified']) ||
      [value.evidence.maintenanceScheduleVerified,
        value.evidence.rentalLeaseProviderEvidenceVerified,value.evidence.m25AdjustmentApplied,
        value.evidence.evaluatedDowntimeRiskVerified].some(flag => flag !== false) ||
      !exact(value.run, ['calculationVersion','sourceDigest','digest']) ||
      value.run.calculationVersion !== 'm26-asset-utilization-risk-calculation-v1' ||
      value.serviceTimingForecastIssued !== false || value.downtimeRiskForecastIssued !== false ||
      value.calibratedRangeIssued !== false || value.probabilityIssued !== false ||
      value.automaticActionAuthorized !== false) return null;
  if (value.state === 'unavailable') {
    if (!UNAVAILABLE_REASONS.has(value.reason) || value.sources !== null || value.assets !== null ||
        !exact(value.sourceCoverage, ['state','completeAsOf','hasMore',
          'currentBookedPositionCount','scheduledJobCount','unscheduledJobCount','outsideWindowCount',
          'equipmentRevisionCount','readinessRevisionCount','plannedUseCount','assetCount','reason']) ||
        value.sourceCoverage.state !== 'unavailable' || value.sourceCoverage.completeAsOf !== false ||
        value.sourceCoverage.hasMore !== null || value.sourceCoverage.reason !== value.reason ||
        Object.entries(value.sourceCoverage).some(([key, item]) =>
          !['state','completeAsOf','hasMore','reason'].includes(key) && item !== null) ||
        !exact(value.utilization, ['state','assetCount','useCount','claimedOperatingHours',
          'operatingTimeVerified','checkoutDurationUsed','reason']) ||
        value.utilization.state !== 'unavailable' || value.utilization.assetCount !== null ||
        value.utilization.useCount !== null || value.utilization.claimedOperatingHours !== null ||
        value.utilization.operatingTimeVerified !== false ||
        value.utilization.checkoutDurationUsed !== false || value.utilization.reason !== value.reason ||
        value.learnedOutcomes.state !== 'unavailable' ||
        value.learnedOutcomes.applicableValueCount !== null ||
        value.learnedOutcomes.reason !== value.reason ||
        Object.values(value.evidence).some(flag => flag !== false) ||
        value.run.sourceDigest !== null || value.run.digest !== null ||
        [value.forecastIssued,value.utilizationForecastIssued,
          value.serviceIntervalForecastIssued,value.maintenanceDueForecastIssued]
          .some(flag => flag !== false)) return null;
    return value;
  }
  if (value.reason !== null || !dense(value.sources, 500) || !dense(value.assets, 10000) ||
      !exact(value.sourceCoverage, ['state','completeAsOf','hasMore',
        'currentBookedPositionCount','scheduledJobCount','unscheduledJobCount','outsideWindowCount',
        'equipmentRevisionCount','readinessRevisionCount','plannedUseCount','assetCount','reason']) ||
      value.sourceCoverage.state !== 'complete_as_of' || value.sourceCoverage.completeAsOf !== true ||
      value.sourceCoverage.hasMore !== false || value.sourceCoverage.reason !== null ||
      ![value.sourceCoverage.currentBookedPositionCount,value.sourceCoverage.scheduledJobCount,
        value.sourceCoverage.unscheduledJobCount,value.sourceCoverage.outsideWindowCount,
        value.sourceCoverage.equipmentRevisionCount,value.sourceCoverage.readinessRevisionCount,
        value.sourceCoverage.plannedUseCount,value.sourceCoverage.assetCount]
        .every(count => Number.isSafeInteger(count) && count >= 0 && count <= 10000) ||
      value.sourceCoverage.currentBookedPositionCount !==
        value.sourceCoverage.scheduledJobCount + value.sourceCoverage.outsideWindowCount ||
      value.sourceCoverage.unscheduledJobCount !== 0 ||
      value.sourceCoverage.scheduledJobCount !== value.sources.length ||
      value.sourceCoverage.equipmentRevisionCount !== value.sources.length ||
      value.sourceCoverage.readinessRevisionCount !== value.sources.length ||
      value.sourceCoverage.assetCount !== value.assets.length ||
      value.learnedOutcomes.state !== 'none_current' ||
      value.learnedOutcomes.applicableValueCount !== 0 ||
      value.learnedOutcomes.reason !== 'no_compatible_current_owner_adopted_operating_hour_value' ||
      [value.evidence.sourceAuthenticatedUtilization,
        value.evidence.currentAdoptedEquipmentVerified,value.evidence.currentReadinessVerified,
        value.evidence.currentnessVerified,value.evidence.compatibleUnitsVerified,
        value.evidence.periodAttributionVerified].some(flag => flag !== true) ||
      !DIGEST.test(value.run.sourceDigest || '') || !DIGEST.test(value.run.digest || '')) return null;
  const budget = { nodes: 0 };
  if (!value.sources.every((source, index) => validSource(source, index, budget)) ||
      !value.assets.every(asset => validAsset(asset, value.sources, value.sourceAsOf,
        value.horizon))) return null;
  const ids = new Set(value.assets.map(asset => asset.asset.id.toLowerCase()));
  const uses = value.assets.flatMap(asset => asset.plannedUtilization.uses);
  const useKeys = new Set(uses.map(use => `${use.sourceIndex}:${use.lineId.toLowerCase()}`));
  if (ids.size !== value.assets.length || useKeys.size !== uses.length ||
      uses.length !== value.sourceCoverage.plannedUseCount ||
      !exact(value.utilization, ['state','assetCount','useCount','claimedOperatingHours',
        'operatingTimeVerified','checkoutDurationUsed','reason']) ||
      value.utilization.assetCount !== value.assets.length || value.utilization.useCount !== uses.length ||
      value.utilization.operatingTimeVerified !== false || value.utilization.checkoutDurationUsed !== false) return null;
  const unavailableUtilization = value.assets.some(asset =>
    asset.plannedUtilization.state === 'unavailable');
  if (unavailableUtilization) {
    if (value.utilization.state !== 'unavailable' || value.utilization.claimedOperatingHours !== null ||
        value.utilization.reason !== 'non_overlapping_planned_utilization_unavailable' ||
        value.forecastIssued !== false || value.utilizationForecastIssued !== false) return null;
  } else {
    const total = uses.reduce((sum, use) => sum + hours(use.claimedOperatingHours), 0n);
    if (value.utilization.state !== 'current_claimed_plan_only' ||
        hours(value.utilization.claimedOperatingHours) !== total || value.utilization.reason !== null ||
        value.forecastIssued !== true || value.utilizationForecastIssued !== true) return null;
  }
  const allService = value.assets.length > 0 && value.assets.every(asset =>
    asset.serviceInterval.state === 'current_claimed_plan_position');
  const allMaintenance = value.assets.length > 0 && value.assets.every(asset =>
    asset.maintenanceDue.state === 'current_claimed_plan_position');
  return value.serviceIntervalForecastIssued === allService &&
    value.maintenanceDueForecastIssued === allMaintenance &&
    value.evidence.meterHistoryVerified === allService &&
    value.evidence.serviceThresholdPolicyVerified === allService ? value : null;
}

function failure(res, error) {
  const code = error?.code;
  const status = code === '42501' ? 403 : code === '22023' || code === '22P02' ? 400 :
    ['40001','40P01','55P03'].includes(code) ? 409 : 503;
  return res.status(status).json({ success: false, error: {
    category: status === 403 ? 'ASSET_UTILIZATION_RISK_RESTRICTED' :
      status === 400 ? 'ASSET_UTILIZATION_RISK_REQUEST_INVALID' :
        status === 409 ? 'ASSET_UTILIZATION_RISK_CHANGED' : 'ASSET_UTILIZATION_RISK_UNAVAILABLE',
    message: status === 403 ? 'You cannot view this resource forecast.' :
      status === 400 ? 'Check the request and try again.' :
        status === 409 ? 'The resource forecast changed. Refresh and try again.' :
          'The resource forecast is temporarily unavailable.',
  } });
}

function createForecastAssetUtilizationRiskRouter(options = {}) {
  const router = express.Router();
  const poolProvider = options.poolProvider || (() => db.getPool());
  const auth = options.auth || requireOnboardedInternal;
  const permission = options.permission || requirePermission('forecast', 'read');
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `forecast-asset-utilization-risk:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('Referrer-Policy', 'no-referrer');
    res.vary('Cookie');
    next();
  });
  router.get('/current', auth, permission, throttle, async (req, res) => {
    if (!exact(req.query, [])) return failure(res, { code: '22023' });
    let client;
    try {
      client = await poolProvider().connect();
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      await client.query("SET LOCAL statement_timeout = '15s'");
      await client.query("SET LOCAL lock_timeout = '2s'");
      const identity = [req.tenantContext.organizationId, req.tenantContext.userId,
        req.userRole, req.authSession.id];
      const raw = (await client.query(
        'SELECT public.canonical_forecast_asset_utilization_risk_v1_current($1,$2,$3,$4) value',
        identity)).rows[0]?.value;
      const value = sanitizeForecast(raw);
      if (!value) throw new Error('Invalid asset-utilization risk projection');
      await client.query('COMMIT');
      return res.status(200).json({ success: true, data: value });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return failure(res, error);
    } finally { if (client) client.release(); }
  });
  return router;
}

module.exports = { createForecastAssetUtilizationRiskRouter, sanitizeForecast };
