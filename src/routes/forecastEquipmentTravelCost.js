'use strict';

const express = require('express');
const db = require('../db');
const { requireOnboardedInternal } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { rateLimit } = require('../middleware/rateLimit');

const MONEY = /^(?:0|[1-9][0-9]{0,14})\.[0-9]{2}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
const REASONS = new Set([
  'reporting_currency_unavailable', 'period_attribution_unavailable',
  'current_owner_confirmed_booking_unavailable',
  'current_adopted_equipment_travel_plan_unavailable',
  'current_equipment_travel_source_unavailable',
  'learned_adjustment_compatibility_unverified',
]);

function exact(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key =>
      Object.prototype.hasOwnProperty.call(value, key));
}

function validInstant(value) {
  if (typeof value !== 'string' || !INSTANT.test(value) || /T24:|:60(?:\.|Z)/.test(value)) return false;
  const date = new Date(value);
  const parts = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  return Number.isFinite(date.getTime()) && date.getUTCFullYear() === Number(parts[1]) &&
    date.getUTCMonth() + 1 === Number(parts[2]) && date.getUTCDate() === Number(parts[3]) &&
    date.getUTCHours() === Number(parts[4]) && date.getUTCMinutes() === Number(parts[5]) &&
    date.getUTCSeconds() === Number(parts[6]);
}

function validCount(value, maximum = 10000) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

function sanitizeForecast(value) {
  const keys = ['version', 'state', 'reason', 'fictional', 'checkedAt', 'currency', 'horizon',
    'scope', 'work', 'plannedEquipmentTravel', 'allocation', 'operations', 'learnedOutcomes',
    'forecastIssued', 'completeOperatingCostForecastIssued', 'downtimeForecastIssued',
    'calibratedRangeIssued', 'probabilityIssued', 'automaticActionAuthorized'];
  if (!exact(value, keys) || value.version !== 'm26-equipment-travel-cost-forecast-v1' ||
      !['current', 'unavailable'].includes(value.state) || value.fictional !== false ||
      !validInstant(value.checkedAt) ||
      !exact(value.horizon, ['startsAt', 'endsAt', 'days']) ||
      !validInstant(value.horizon.startsAt) || !validInstant(value.horizon.endsAt) ||
      value.horizon.days !== 30 || new Date(value.horizon.endsAt).getTime() -
        new Date(value.horizon.startsAt).getTime() !== 2592000000 ||
      !exact(value.scope, ['label', 'wholeBusinessCoverageVerified', 'offPlatformCoverageVerified']) ||
      value.scope.label !== 'Next 30 days of authenticated NorthStar scheduled backlog' ||
      value.scope.wholeBusinessCoverageVerified !== false ||
      value.scope.offPlatformCoverageVerified !== false ||
      !exact(value.work, ['state', 'scheduledCount', 'unscheduledCount', 'outsideWindowCount']) ||
      !exact(value.plannedEquipmentTravel, ['state', 'coveredCount', 'equipmentLineCount',
        'tripCount', 'logisticsLineCount', 'equipmentCost', 'grossTravelCost',
        'overlapDeduction', 'netTravelCost', 'combinedCost', 'reason']) ||
      !exact(value.allocation, ['state', 'basis', 'v3AllocationReviewed',
        'crossForecastLaborOverlapReviewed', 'reason']) ||
      value.allocation.basis !== 'owner_adopted_m24_cost_allocation_v3' ||
      !exact(value.operations, ['state', 'fuelOrEnergyLineCount', 'maintenanceLineCount',
        'futureUtilizationVerified', 'assetReadinessVerified', 'maintenanceScheduleVerified',
        'downtimeCostVerified', 'providerAuthenticated', 'reason']) ||
      [value.operations.futureUtilizationVerified, value.operations.assetReadinessVerified,
        value.operations.maintenanceScheduleVerified, value.operations.downtimeCostVerified,
        value.operations.providerAuthenticated].some(flag => flag !== false) ||
      !exact(value.learnedOutcomes, ['state', 'applicableServiceCount', 'applied', 'reason']) ||
      value.learnedOutcomes.applied !== false ||
      value.completeOperatingCostForecastIssued !== false ||
      value.downtimeForecastIssued !== false || value.calibratedRangeIssued !== false ||
      value.probabilityIssued !== false || value.automaticActionAuthorized !== false) return null;
  if (value.state === 'unavailable') {
    if (!REASONS.has(value.reason) || value.currency !== null || value.forecastIssued !== false ||
        value.work.state !== 'unavailable' || value.work.scheduledCount !== null ||
        value.work.unscheduledCount !== null || value.work.outsideWindowCount !== null ||
        value.plannedEquipmentTravel.state !== 'unavailable' ||
        ['coveredCount', 'equipmentLineCount', 'tripCount', 'logisticsLineCount',
          'equipmentCost', 'grossTravelCost', 'overlapDeduction', 'netTravelCost',
          'combinedCost'].some(key => value.plannedEquipmentTravel[key] !== null) ||
        value.plannedEquipmentTravel.reason !== value.reason ||
        value.allocation.state !== 'unavailable' || value.allocation.v3AllocationReviewed !== false ||
        value.allocation.crossForecastLaborOverlapReviewed !== false ||
        value.allocation.reason !== value.reason || value.operations.state !== 'unavailable' ||
        value.operations.fuelOrEnergyLineCount !== null || value.operations.maintenanceLineCount !== null ||
        value.operations.reason !== value.reason || value.learnedOutcomes.state !== 'unavailable' ||
        value.learnedOutcomes.applicableServiceCount !== null ||
        value.learnedOutcomes.reason !== value.reason) return null;
    return value;
  }
  const plan = value.plannedEquipmentTravel;
  if (value.reason !== null || value.forecastIssued !== true ||
      !/^[A-Z]{3}$/.test(value.currency || '') || value.work.state !== 'current' ||
      ![value.work.scheduledCount, value.work.unscheduledCount,
        value.work.outsideWindowCount].every(count => validCount(count, 500)) ||
      plan.state !== 'current' || !validCount(plan.coveredCount, 500) ||
      plan.coveredCount !== value.work.scheduledCount ||
      ![plan.equipmentLineCount, plan.tripCount, plan.logisticsLineCount]
        .every(count => validCount(count)) ||
      ![plan.equipmentCost, plan.grossTravelCost, plan.overlapDeduction,
        plan.netTravelCost, plan.combinedCost].every(amount => MONEY.test(amount || '')) ||
      plan.reason !== null || value.allocation.state !== 'reviewed_v3_allocation' ||
      value.allocation.v3AllocationReviewed !== true ||
      value.allocation.crossForecastLaborOverlapReviewed !== true ||
      value.allocation.reason !== 'reviewed_allocation_applied' ||
      value.operations.state !== 'plan_cost_only' ||
      !validCount(value.operations.fuelOrEnergyLineCount) ||
      !validCount(value.operations.maintenanceLineCount) ||
      value.operations.reason !== 'future_operations_evidence_unavailable' ||
      value.learnedOutcomes.state !== 'none_current' ||
      value.learnedOutcomes.applicableServiceCount !== 0 ||
      value.learnedOutcomes.reason !== 'no_current_applicable_owner_adopted_multiplier') return null;
  return value;
}

function failure(res, error) {
  const code = error?.code;
  const status = code === '42501' ? 403 : code === '22023' || code === '22P02' ? 400 :
    ['40001', '40P01', '55P03'].includes(code) ? 409 : 503;
  return res.status(status).json({ success: false, error: {
    category: status === 403 ? 'EQUIPMENT_TRAVEL_FORECAST_RESTRICTED' :
      status === 400 ? 'EQUIPMENT_TRAVEL_FORECAST_REQUEST_INVALID' :
        status === 409 ? 'EQUIPMENT_TRAVEL_FORECAST_CHANGED' :
          'EQUIPMENT_TRAVEL_FORECAST_UNAVAILABLE',
    message: status === 403 ? 'You cannot view this insight.' :
      status === 400 ? 'Check the request and try again.' :
        status === 409 ? 'The equipment and travel forecast changed. Refresh and try again.' :
          'The equipment and travel forecast is temporarily unavailable.',
  } });
}

function createForecastEquipmentTravelCostRouter(options = {}) {
  const router = express.Router();
  const poolProvider = options.poolProvider || (() => db.getPool());
  const auth = options.auth || requireOnboardedInternal;
  const permission = options.permission || requirePermission('forecast', 'read');
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `forecast-equipment-travel-cost:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
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
        'SELECT public.canonical_forecast_equipment_travel_cost_v1_current($1,$2,$3,$4) value',
        identity)).rows[0]?.value;
      const value = sanitizeForecast(raw);
      if (!value) throw new Error('Invalid equipment-and-travel forecast projection');
      await client.query('COMMIT');
      return res.status(200).json({ success: true, data: value });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return failure(res, error);
    } finally { if (client) client.release(); }
  });
  return router;
}

module.exports = { createForecastEquipmentTravelCostRouter, sanitizeForecast };
