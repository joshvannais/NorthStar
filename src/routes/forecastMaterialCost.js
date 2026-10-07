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
  'current_adopted_material_plan_unavailable', 'current_material_price_unavailable',
  'reported_material_availability_unavailable',
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

function sanitizeForecast(value) {
  const keys = ['version', 'state', 'reason', 'fictional', 'checkedAt', 'currency', 'horizon',
    'scope', 'work', 'plannedMaterials', 'purchasing', 'availability',
    'inventoryValuation', 'learnedOutcomes', 'forecastIssued',
    'completePurchasingForecastIssued', 'inventoryForecastIssued',
    'calibratedRangeIssued', 'probabilityIssued', 'automaticActionAuthorized'];
  if (!exact(value, keys) || value.version !== 'm26-material-cost-forecast-v1' ||
      !['current', 'unavailable'].includes(value.state) || value.fictional !== false ||
      !validInstant(value.checkedAt) ||
      !exact(value.horizon, ['startsAt', 'endsAt', 'days']) ||
      !validInstant(value.horizon.startsAt) || !validInstant(value.horizon.endsAt) ||
      value.horizon.days !== 30 || new Date(value.horizon.endsAt).getTime() -
        new Date(value.horizon.startsAt).getTime() !== 2592000000 ||
      !exact(value.scope, ['label', 'wholeBusinessCoverageVerified',
        'offPlatformCoverageVerified']) ||
      value.scope.label !== 'Next 30 days of authenticated NorthStar scheduled backlog' ||
      value.scope.wholeBusinessCoverageVerified !== false ||
      value.scope.offPlatformCoverageVerified !== false ||
      !exact(value.work, ['state', 'scheduledCount', 'unscheduledCount', 'outsideWindowCount']) ||
      !exact(value.plannedMaterials, ['state', 'coveredCount', 'lineCount', 'baseCost',
        'wasteCost', 'lineCost', 'reason']) ||
      !exact(value.purchasing, ['state', 'basis', 'purchaseOrdersVerified',
        'deliveryFeesIncluded', 'taxTreatmentVerified', 'transportIncluded', 'reason']) ||
      value.purchasing.basis !== 'owner_adopted_m24_material_plan' ||
      [value.purchasing.purchaseOrdersVerified, value.purchasing.deliveryFeesIncluded,
        value.purchasing.taxTreatmentVerified, value.purchasing.transportIncluded]
        .some(flag => flag !== false) ||
      !exact(value.availability, ['state', 'reportedSufficientLineCount',
        'inventoryVerified', 'reservationVerified', 'supplierAuthenticated', 'reason']) ||
      value.availability.inventoryVerified !== false ||
      value.availability.reservationVerified !== false ||
      value.availability.supplierAuthenticated !== false ||
      !exact(value.inventoryValuation, ['state', 'amount', 'reason']) ||
      value.inventoryValuation.state !== 'unavailable' || value.inventoryValuation.amount !== null ||
      value.inventoryValuation.reason !== 'inventory_records_unavailable' ||
      !exact(value.learnedOutcomes, ['state', 'applicableServiceCount', 'applied', 'reason']) ||
      value.learnedOutcomes.applied !== false ||
      value.completePurchasingForecastIssued !== false ||
      value.inventoryForecastIssued !== false || value.calibratedRangeIssued !== false ||
      value.probabilityIssued !== false || value.automaticActionAuthorized !== false) return null;
  if (value.state === 'unavailable') {
    if (!REASONS.has(value.reason) || value.currency !== null || value.forecastIssued !== false ||
        value.work.state !== 'unavailable' || value.work.scheduledCount !== null ||
        value.work.unscheduledCount !== null || value.work.outsideWindowCount !== null ||
        value.plannedMaterials.state !== 'unavailable' ||
        value.plannedMaterials.coveredCount !== null || value.plannedMaterials.lineCount !== null ||
        value.plannedMaterials.baseCost !== null || value.plannedMaterials.wasteCost !== null ||
        value.plannedMaterials.lineCost !== null || value.plannedMaterials.reason !== value.reason ||
        value.purchasing.state !== 'unavailable' || value.purchasing.reason !== value.reason ||
        value.availability.state !== 'unavailable' ||
        value.availability.reportedSufficientLineCount !== null ||
        value.availability.reason !== value.reason || value.learnedOutcomes.state !== 'unavailable' ||
        value.learnedOutcomes.applicableServiceCount !== null ||
        value.learnedOutcomes.reason !== value.reason) return null;
    return value;
  }
  if (value.reason !== null || value.forecastIssued !== true ||
      !/^[A-Z]{3}$/.test(value.currency || '') || value.work.state !== 'current' ||
      ![value.work.scheduledCount, value.work.unscheduledCount,
        value.work.outsideWindowCount].every(count => Number.isSafeInteger(count) &&
          count >= 0 && count <= 500) || value.plannedMaterials.state !== 'current' ||
      !Number.isSafeInteger(value.plannedMaterials.coveredCount) ||
      value.plannedMaterials.coveredCount !== value.work.scheduledCount ||
      !Number.isSafeInteger(value.plannedMaterials.lineCount) ||
      value.plannedMaterials.lineCount < 0 || value.plannedMaterials.lineCount > 10000 ||
      ![value.plannedMaterials.baseCost, value.plannedMaterials.wasteCost,
        value.plannedMaterials.lineCost].every(amount => MONEY.test(amount || '')) ||
      value.plannedMaterials.reason !== null || value.purchasing.state !== 'plan_cost_only' ||
      value.purchasing.reason !== 'purchase_terms_unavailable' ||
      value.availability.state !== 'owner_recorded_reported_sufficient' ||
      value.availability.reportedSufficientLineCount !== value.plannedMaterials.lineCount ||
      value.availability.reason !== 'reported_availability_is_not_reserved_inventory' ||
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
    category: status === 403 ? 'MATERIAL_FORECAST_RESTRICTED' :
      status === 400 ? 'MATERIAL_FORECAST_REQUEST_INVALID' :
        status === 409 ? 'MATERIAL_FORECAST_CHANGED' : 'MATERIAL_FORECAST_UNAVAILABLE',
    message: status === 403 ? 'You cannot view this insight.' :
      status === 400 ? 'Check the request and try again.' :
        status === 409 ? 'The material forecast changed. Refresh and try again.' :
          'The material forecast is temporarily unavailable.',
  } });
}

function createForecastMaterialCostRouter(options = {}) {
  const router = express.Router();
  const poolProvider = options.poolProvider || (() => db.getPool());
  const auth = options.auth || requireOnboardedInternal;
  const permission = options.permission || requirePermission('forecast', 'read');
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `forecast-material-cost:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
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
        'SELECT public.canonical_forecast_material_cost_v1_current($1,$2,$3,$4) value',
        identity)).rows[0]?.value;
      const value = sanitizeForecast(raw);
      if (!value) throw new Error('Invalid material-cost forecast projection');
      await client.query('COMMIT');
      return res.status(200).json({ success: true, data: value });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return failure(res, error);
    } finally { if (client) client.release(); }
  });
  return router;
}

module.exports = { createForecastMaterialCostRouter, sanitizeForecast };
