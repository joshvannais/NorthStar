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
const QUANTITY = /^(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{1,6})?$/;
const UNAVAILABLE_REASONS = new Set([
  'business_calendar_unavailable', 'complete_source_coverage_unavailable',
  'approved_timing_attribution_unavailable', 'long_job_phase_attribution_unavailable',
  'current_owner_confirmed_booking_unavailable', 'duplicate_current_job_travel_source',
  'current_adopted_travel_composition_unavailable',
  'current_adopted_route_coverage_unavailable', 'compatible_m25_outcome_unavailable',
]);

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && own.every(key => typeof key === 'string' &&
    keys.includes(key) && Object.getOwnPropertyDescriptor(value, key)?.enumerable &&
    Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
}

function dense(value, maximum) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      value.length > maximum || Reflect.ownKeys(value).length !== value.length + 1) return false;
  return value.every((_, index) => Object.getOwnPropertyDescriptor(value, index)?.enumerable &&
    Object.hasOwn(Object.getOwnPropertyDescriptor(value, index), 'value'));
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

function quantity(value) {
  if (typeof value !== 'string' || !QUANTITY.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'));
}

function validHorizon(value, checkedAt, state) {
  return exact(value, ['kind','timeZone','startsAt','endsAt','startsOn','endsOnExclusive']) &&
    value.kind === 'next_30_elapsed_days' &&
    (text(value.timeZone, 100) || state === 'unavailable' && value.timeZone === null) &&
    validInstant(value.startsAt) && validInstant(value.endsAt) && value.startsAt === checkedAt &&
    DATE.test(value.startsOn) && DATE.test(value.endsOnExclusive) &&
    new Date(value.endsAt).getTime() - new Date(value.startsAt).getTime() === 2592000000;
}

function validPlannedWindow(value, horizon) {
  return exact(value, ['startsAt','endsAt','timeZone','assignmentRevision','assignmentDigest',
    'approvalId','timeZoneAuthority','timeEvidenceDigest']) &&
    validInstant(value.startsAt) && validInstant(value.endsAt) && value.startsAt < value.endsAt &&
    value.timeZone === horizon.timeZone && Number.isSafeInteger(value.assignmentRevision) &&
    value.assignmentRevision >= 2 && DIGEST.test(value.assignmentDigest || '') &&
    UUID.test(value.approvalId || '') && DIGEST.test(value.timeEvidenceDigest || '') &&
    exact(value.timeZoneAuthority,
      ['profileHash','profileId','profileVersion','timeZone','evaluatedAt']) &&
    DIGEST.test(value.timeZoneAuthority.profileHash || '') &&
    UUID.test(value.timeZoneAuthority.profileId || '') &&
    Number.isSafeInteger(value.timeZoneAuthority.profileVersion) &&
    value.timeZoneAuthority.profileVersion >= 1 &&
    value.timeZoneAuthority.timeZone === horizon.timeZone &&
    validInstant(value.timeZoneAuthority.evaluatedAt);
}

function validSource(value, index, horizon) {
  return exact(value, ['sourceIndex','job','estimate','composition','travelPlan']) &&
    value.sourceIndex === index &&
    exact(value.job, ['appointmentId','assignmentId','bookingReviewId','bookingConfirmationId',
      'issuedVersionId','plannedWindow']) &&
    [value.job.appointmentId,value.job.assignmentId,value.job.bookingReviewId,
      value.job.bookingConfirmationId,value.job.issuedVersionId].every(id => UUID.test(id || '')) &&
    validPlannedWindow(value.job.plannedWindow, horizon) &&
    exact(value.estimate, ['id','revisionId','revision','digest']) &&
    UUID.test(value.estimate.id || '') && UUID.test(value.estimate.revisionId || '') &&
    Number.isSafeInteger(value.estimate.revision) && value.estimate.revision >= 1 &&
    DIGEST.test(value.estimate.digest || '') &&
    exact(value.composition, ['id','revision','digest','calculationVersion','manifestDigest',
      'coverageDigest']) && UUID.test(value.composition.id || '') &&
    Number.isSafeInteger(value.composition.revision) && value.composition.revision >= 1 &&
    DIGEST.test(value.composition.digest || '') &&
    value.composition.calculationVersion === 'estimate-cost-adoption-v3' &&
    DIGEST.test(value.composition.manifestDigest || '') &&
    DIGEST.test(value.composition.coverageDigest || '') &&
    exact(value.travelPlan, ['id','revision','digest','calculationVersion','sourceDigest',
      'assessmentDigest','assessedThrough']) &&
    UUID.test(value.travelPlan.id || '') && Number.isSafeInteger(value.travelPlan.revision) &&
    value.travelPlan.revision >= 1 && DIGEST.test(value.travelPlan.digest || '') &&
    value.travelPlan.calculationVersion === 'estimate-travel-plan-v1' &&
    DIGEST.test(value.travelPlan.sourceDigest || '') &&
    DIGEST.test(value.travelPlan.assessmentDigest || '') &&
    DATE.test(value.travelPlan.assessedThrough || '');
}

function validUnavailablePosition(value, reason) {
  return exact(value, ['state','value','unit','reason']) && value.state === 'unavailable' &&
    value.value === null && value.unit === null && value.reason === reason;
}

function validRoute(value, sources) {
  if (!exact(value, ['sourceIndex','tripId','route','movement','resource','declaredDistance',
    'verifiedRoadMileage','routeTiming','fuelEnergy','capacity']) ||
      !Number.isSafeInteger(value.sourceIndex) || value.sourceIndex < 0 ||
      value.sourceIndex >= sources.length || !UUID.test(value.tripId || '') ||
      !exact(value.route, ['originDigest','destinationDigest','direction','returnIncluded']) ||
      !DIGEST.test(value.route.originDigest || '') || !DIGEST.test(value.route.destinationDigest || '') ||
      value.route.direction !== 'origin_to_destination' ||
      typeof value.route.returnIncluded !== 'boolean' ||
      !exact(value.movement, ['state','class','roadTransportationVerified',
        'onsiteEquipmentMovementVerified','reason']) || value.movement.state !== 'unavailable' ||
      value.movement.class !== null || value.movement.roadTransportationVerified !== false ||
      value.movement.onsiteEquipmentMovementVerified !== false ||
      value.movement.reason !== 'movement_class_unavailable' ||
      !exact(value.resource, ['state','assetId','kind','accessType','providerSemanticsVerified',
        'reason']) || value.resource.state !== 'unavailable' || value.resource.assetId !== null ||
      value.resource.kind !== null || value.resource.accessType !== null ||
      value.resource.providerSemanticsVerified !== false ||
      value.resource.reason !== 'resource_identity_unavailable') return false;
  const distance = value.declaredDistance;
  if (!exact(distance, ['state','oneWayQuantity','unit','basis','tripCount','vehicleCount',
    'tripLegs','vehicleLegs','totalVehicleLegDistance','sourceAuthenticated','reason']) ||
      distance.state !== 'current_claimed_plan_only' || quantity(distance.oneWayQuantity) === null ||
      !['mi','km'].includes(distance.unit) || !['estimated','reported'].includes(distance.basis) ||
      !Number.isSafeInteger(distance.tripCount) || distance.tripCount < 1 ||
      !Number.isSafeInteger(distance.vehicleCount) || distance.vehicleCount < 1 ||
      !Number.isSafeInteger(distance.tripLegs) || distance.tripLegs < 1 ||
      !Number.isSafeInteger(distance.vehicleLegs) || distance.vehicleLegs < 1 ||
      distance.tripLegs !== distance.tripCount * (value.route.returnIncluded ? 2 : 1) ||
      distance.vehicleLegs !== distance.tripLegs * distance.vehicleCount ||
      quantity(distance.totalVehicleLegDistance) !==
        quantity(distance.oneWayQuantity) * BigInt(distance.vehicleLegs) ||
      distance.sourceAuthenticated !== true || distance.reason !== null) return false;
  return validUnavailablePosition(value.verifiedRoadMileage, 'verified_road_route_unavailable') &&
    validUnavailablePosition(value.routeTiming, 'verified_route_timing_unavailable') &&
    validUnavailablePosition(value.fuelEnergy, 'independent_consumption_evidence_unavailable') &&
    validUnavailablePosition(value.capacity, 'resource_capacity_and_load_evidence_unavailable');
}

function sanitizeForecast(value) {
  const keys = ['version','state','reason','fictional','checkedAt','sourceAsOf','horizon','scope',
    'sourceCoverage','sources','routes','declaredRouteLoad','verifiedRoadMileage','routeTiming',
    'fuelEnergy','logisticsCapacityRisk','learnedOutcomes','evidence','run','forecastIssued',
    'declaredRouteLoadForecastIssued','roadMileageForecastIssued','routeTimingForecastIssued',
    'fuelEnergyForecastIssued','logisticsCapacityRiskForecastIssued','calibratedRangeIssued',
    'probabilityIssued','automaticActionAuthorized'];
  if (!exact(value, keys) || value.version !== 'm26-route-load-risk-forecast-v1' ||
      !['current','unavailable'].includes(value.state) || value.fictional !== false ||
      !validInstant(value.checkedAt) || !validInstant(value.sourceAsOf) ||
      !validHorizon(value.horizon, value.checkedAt, value.state) ||
      !exact(value.scope, ['label','wholeBusinessCoverageVerified','offPlatformCoverageVerified']) ||
      value.scope.label !== 'Authenticated owner-confirmed scheduled backlog' ||
      value.scope.wholeBusinessCoverageVerified !== false ||
      value.scope.offPlatformCoverageVerified !== false ||
      !exact(value.evidence, ['sourceAuthenticatedDeclaredDistance','currentAdoptedTravelVerified',
        'currentnessVerified','compatibleUnitsVerified','periodAttributionVerified',
        'movementClassVerified','verifiedRoadRouting','resourceIdentityVerified',
        'independentConsumptionEvidenceVerified','capacityLoadEvidenceVerified',
        'rentalLeaseProviderEvidenceVerified','m25AdjustmentApplied']) ||
      !exact(value.run, ['calculationVersion','sourceDigest','digest']) ||
      value.run.calculationVersion !== 'm26-route-load-risk-calculation-v1' ||
      value.roadMileageForecastIssued !== false || value.routeTimingForecastIssued !== false ||
      value.fuelEnergyForecastIssued !== false ||
      value.logisticsCapacityRiskForecastIssued !== false ||
      value.calibratedRangeIssued !== false || value.probabilityIssued !== false ||
      value.automaticActionAuthorized !== false) return null;
  if (value.state === 'unavailable') {
    if (!UNAVAILABLE_REASONS.has(value.reason) || value.sources !== null || value.routes !== null ||
        !exact(value.sourceCoverage, ['state','completeAsOf','hasMore',
          'currentBookedPositionCount','scheduledJobCount','unscheduledJobCount',
          'outsideWindowCount','travelRevisionCount','routeLineCount','reason']) ||
        value.sourceCoverage.state !== 'unavailable' || value.sourceCoverage.completeAsOf !== false ||
        value.sourceCoverage.hasMore !== null || value.sourceCoverage.reason !== value.reason ||
        Object.entries(value.sourceCoverage).some(([key, item]) =>
          !['state','completeAsOf','hasMore','reason'].includes(key) && item !== null) ||
        !exact(value.declaredRouteLoad, ['state','routeLineCount','tripLegs','vehicleLegs',
          'declaredVehicleMiles','declaredVehicleKilometres','reason']) ||
        value.declaredRouteLoad.state !== 'unavailable' ||
        Object.entries(value.declaredRouteLoad).some(([key, item]) =>
          !['state','reason'].includes(key) && item !== null) ||
        value.declaredRouteLoad.reason !== value.reason ||
        !validUnavailablePosition(value.verifiedRoadMileage, value.reason) ||
        !validUnavailablePosition(value.routeTiming, value.reason) ||
        !validUnavailablePosition(value.fuelEnergy, value.reason) ||
        !validUnavailablePosition(value.logisticsCapacityRisk, value.reason) ||
        !exact(value.learnedOutcomes, ['state','applicableValueCount','applied','reason']) ||
        value.learnedOutcomes.state !== 'unavailable' ||
        value.learnedOutcomes.applicableValueCount !== null ||
        value.learnedOutcomes.applied !== false || value.learnedOutcomes.reason !== value.reason ||
        Object.values(value.evidence).some(flag => flag !== false) ||
        value.run.sourceDigest !== null || value.run.digest !== null ||
        value.forecastIssued !== false || value.declaredRouteLoadForecastIssued !== false) return null;
    return value;
  }
  if (value.reason !== null || !dense(value.sources, 500) || !dense(value.routes, 6000) ||
      !exact(value.sourceCoverage, ['state','completeAsOf','hasMore',
        'currentBookedPositionCount','scheduledJobCount','unscheduledJobCount',
        'outsideWindowCount','travelRevisionCount','routeLineCount','reason']) ||
      value.sourceCoverage.state !== 'complete_as_of' || value.sourceCoverage.completeAsOf !== true ||
      value.sourceCoverage.hasMore !== false || value.sourceCoverage.reason !== null ||
      ![value.sourceCoverage.currentBookedPositionCount,value.sourceCoverage.scheduledJobCount,
        value.sourceCoverage.unscheduledJobCount,value.sourceCoverage.outsideWindowCount,
        value.sourceCoverage.travelRevisionCount,value.sourceCoverage.routeLineCount]
        .every(count => Number.isSafeInteger(count) && count >= 0 && count <= 6000) ||
      value.sourceCoverage.currentBookedPositionCount !==
        value.sourceCoverage.scheduledJobCount + value.sourceCoverage.outsideWindowCount ||
      value.sourceCoverage.unscheduledJobCount !== 0 ||
      value.sourceCoverage.scheduledJobCount !== value.sources.length ||
      value.sourceCoverage.travelRevisionCount !== value.sources.length ||
      value.sourceCoverage.routeLineCount !== value.routes.length ||
      !value.sources.every((source, index) => validSource(source, index, value.horizon)) ||
      !value.routes.every(route => validRoute(route, value.sources)) ||
      new Set(value.sources.map(source => source.estimate.id.toLowerCase())).size !==
        value.sources.length ||
      new Set(value.routes.map(route => `${route.sourceIndex}:${route.tripId.toLowerCase()}`)).size !==
        value.routes.length ||
      !exact(value.declaredRouteLoad, ['state','routeLineCount','tripLegs','vehicleLegs',
        'declaredVehicleMiles','declaredVehicleKilometres','reason']) ||
      value.declaredRouteLoad.state !== 'current_claimed_plan_only' ||
      value.declaredRouteLoad.routeLineCount !== value.routes.length ||
      !Number.isSafeInteger(value.declaredRouteLoad.tripLegs) ||
      !Number.isSafeInteger(value.declaredRouteLoad.vehicleLegs) ||
      quantity(value.declaredRouteLoad.declaredVehicleMiles) === null ||
      quantity(value.declaredRouteLoad.declaredVehicleKilometres) === null ||
      value.declaredRouteLoad.reason !== null ||
      value.declaredRouteLoad.tripLegs !==
        value.routes.reduce((sum, route) => sum + route.declaredDistance.tripLegs, 0) ||
      value.declaredRouteLoad.vehicleLegs !==
        value.routes.reduce((sum, route) => sum + route.declaredDistance.vehicleLegs, 0) ||
      quantity(value.declaredRouteLoad.declaredVehicleMiles) !==
        value.routes.filter(route => route.declaredDistance.unit === 'mi')
          .reduce((sum, route) => sum + quantity(route.declaredDistance.totalVehicleLegDistance), 0n) ||
      quantity(value.declaredRouteLoad.declaredVehicleKilometres) !==
        value.routes.filter(route => route.declaredDistance.unit === 'km')
          .reduce((sum, route) => sum + quantity(route.declaredDistance.totalVehicleLegDistance), 0n) ||
      !validUnavailablePosition(value.verifiedRoadMileage, 'verified_road_route_unavailable') ||
      !validUnavailablePosition(value.routeTiming, 'verified_route_timing_unavailable') ||
      !validUnavailablePosition(value.fuelEnergy, 'independent_consumption_evidence_unavailable') ||
      !validUnavailablePosition(value.logisticsCapacityRisk,
        'resource_capacity_and_load_evidence_unavailable') ||
      !exact(value.learnedOutcomes, ['state','applicableValueCount','applied','reason']) ||
      value.learnedOutcomes.state !== 'none_current' ||
      value.learnedOutcomes.applicableValueCount !== 0 ||
      value.learnedOutcomes.applied !== false ||
      value.learnedOutcomes.reason !== 'no_compatible_current_owner_adopted_route_value' ||
      [value.evidence.sourceAuthenticatedDeclaredDistance,
        value.evidence.currentAdoptedTravelVerified,value.evidence.currentnessVerified,
        value.evidence.compatibleUnitsVerified,value.evidence.periodAttributionVerified]
        .some(flag => flag !== true) ||
      [value.evidence.movementClassVerified,value.evidence.verifiedRoadRouting,
        value.evidence.resourceIdentityVerified,
        value.evidence.independentConsumptionEvidenceVerified,
        value.evidence.capacityLoadEvidenceVerified,
        value.evidence.rentalLeaseProviderEvidenceVerified,
        value.evidence.m25AdjustmentApplied].some(flag => flag !== false) ||
      !DIGEST.test(value.run.sourceDigest || '') || !DIGEST.test(value.run.digest || '') ||
      value.forecastIssued !== true || value.declaredRouteLoadForecastIssued !== true) return null;
  return value;
}

function failure(res, error) {
  const code = error?.code;
  const status = code === '42501' ? 403 : code === '22023' || code === '22P02' ? 400 :
    ['40001','40P01','55P03'].includes(code) ? 409 : 503;
  return res.status(status).json({ success: false, error: {
    category: status === 403 ? 'ROUTE_LOAD_RISK_RESTRICTED' :
      status === 400 ? 'ROUTE_LOAD_RISK_REQUEST_INVALID' :
        status === 409 ? 'ROUTE_LOAD_RISK_CHANGED' : 'ROUTE_LOAD_RISK_UNAVAILABLE',
    message: status === 403 ? 'You cannot view this resource forecast.' :
      status === 400 ? 'Check the request and try again.' :
        status === 409 ? 'The resource forecast changed. Refresh and try again.' :
          'The resource forecast is temporarily unavailable.',
  } });
}

function createForecastRouteLoadRiskRouter(options = {}) {
  const router = express.Router();
  const poolProvider = options.poolProvider || (() => db.getPool());
  const auth = options.auth || requireOnboardedInternal;
  const permission = options.permission || requirePermission('forecast', 'read');
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `forecast-route-load-risk:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('Referrer-Policy', 'no-referrer');
    res.vary('Cookie'); next();
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
        'SELECT public.canonical_forecast_route_load_risk_v1_current($1,$2,$3,$4) value',
        identity)).rows[0]?.value;
      const value = sanitizeForecast(raw);
      if (!value) throw new Error('Invalid route-load risk projection');
      await client.query('COMMIT');
      return res.status(200).json({ success: true, data: value });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return failure(res, error);
    } finally { if (client) client.release(); }
  });
  return router;
}

module.exports = { createForecastRouteLoadRiskRouter, sanitizeForecast };
