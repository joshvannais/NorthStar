'use strict';

const express = require('express');
const db = require('../db');
const { requireOnboardedInternal } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { rateLimit } = require('../middleware/rateLimit');

const MONEY = /^(?:0|[1-9][0-9]{0,14})\.[0-9]{2}$/;
const HOURS = /^(?:0|[1-9][0-9]{0,14})\.[0-9]{6}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
const REASONS = new Set([
  'reporting_currency_unavailable', 'declared_capacity_evidence_unavailable',
  'period_attribution_unavailable', 'current_adopted_labor_plan_unavailable',
  'authorized_rate_or_burden_unavailable', 'rate_or_work_source_applicability_unavailable',
  'planned_person_time_exceeds_declared_capacity_commitment',
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
    'scope', 'work', 'plannedLabor', 'rateAuthority', 'capacity', 'learnedOutcomes',
    'forecastIssued', 'calibratedRangeIssued', 'probabilityIssued',
    'automaticActionAuthorized'];
  if (!exact(value, keys) || value.version !== 'm26-labor-cost-forecast-v1' ||
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
      !exact(value.plannedLabor, ['state', 'coveredCount', 'personHours', 'cost', 'reason']) ||
      !exact(value.rateAuthority, ['state', 'basis', 'payrollVerified', 'reason']) ||
      value.rateAuthority.basis !== 'owner_saved_m24_labor_plan_rates' ||
      value.rateAuthority.payrollVerified !== false ||
      !exact(value.capacity, ['state', 'declaredRole', 'realizedAttendanceVerified',
        'jobSpecificConstraintCompositionAvailable', 'reason']) ||
      value.capacity.realizedAttendanceVerified !== false ||
      value.capacity.jobSpecificConstraintCompositionAvailable !== false ||
      !exact(value.learnedOutcomes,
        ['state', 'applicableServiceCount', 'applied', 'reason']) ||
      value.learnedOutcomes.applied !== false || value.calibratedRangeIssued !== false ||
      value.probabilityIssued !== false || value.automaticActionAuthorized !== false) return null;
  if (value.state === 'unavailable') {
    if (!REASONS.has(value.reason) || value.currency !== null || value.forecastIssued !== false ||
        value.work.state !== 'unavailable' || value.work.scheduledCount !== null ||
        value.work.unscheduledCount !== null || value.work.outsideWindowCount !== null ||
        value.plannedLabor.state !== 'unavailable' || value.plannedLabor.coveredCount !== null ||
        value.plannedLabor.personHours !== null || value.plannedLabor.cost !== null ||
        value.plannedLabor.reason !== value.reason || value.rateAuthority.state !== 'unavailable' ||
        value.rateAuthority.reason !== value.reason || value.capacity.state !== 'unavailable' ||
        value.capacity.declaredRole !== null || value.capacity.reason !== value.reason ||
        value.learnedOutcomes.state !== 'unavailable' ||
        value.learnedOutcomes.applicableServiceCount !== null ||
        value.learnedOutcomes.reason !== value.reason) return null;
    return value;
  }
  if (value.reason !== null || value.forecastIssued !== true ||
      !/^[A-Z]{3}$/.test(value.currency || '') || value.work.state !== 'current' ||
      ![value.work.scheduledCount, value.work.unscheduledCount,
        value.work.outsideWindowCount].every(count => Number.isSafeInteger(count) &&
          count >= 0 && count <= 500) || value.plannedLabor.state !== 'current' ||
      !Number.isSafeInteger(value.plannedLabor.coveredCount) ||
      value.plannedLabor.coveredCount !== value.work.scheduledCount ||
      !HOURS.test(value.plannedLabor.personHours || '') ||
      !MONEY.test(value.plannedLabor.cost || '') || value.plannedLabor.reason !== null ||
      value.rateAuthority.state !== 'current' || value.rateAuthority.reason !== null ||
      value.capacity.state !== 'declared_role_capacity_verified' ||
      typeof value.capacity.declaredRole !== 'string' ||
      !/^[a-z][a-z0-9_-]{1,47}$/.test(value.capacity.declaredRole) ||
      value.capacity.reason !== null || value.learnedOutcomes.state !== 'none_current' ||
      value.learnedOutcomes.applicableServiceCount !== 0 ||
      value.learnedOutcomes.reason !== 'no_current_applicable_owner_adopted_multiplier') return null;
  return value;
}

function failure(res, error) {
  const code = error?.code;
  const status = code === '42501' ? 403 : code === '22023' || code === '22P02' ? 400 :
    ['40001', '40P01', '55P03'].includes(code) ? 409 : 503;
  return res.status(status).json({ success: false, error: {
    category: status === 403 ? 'LABOR_FORECAST_RESTRICTED' :
      status === 400 ? 'LABOR_FORECAST_REQUEST_INVALID' :
        status === 409 ? 'LABOR_FORECAST_CHANGED' : 'LABOR_FORECAST_UNAVAILABLE',
    message: status === 403 ? 'You cannot view this insight.' :
      status === 400 ? 'Check the request and try again.' :
        status === 409 ? 'The labor forecast changed. Refresh and try again.' :
          'The labor forecast is temporarily unavailable.',
  } });
}

function createForecastLaborCostRouter(options = {}) {
  const router = express.Router();
  const poolProvider = options.poolProvider || (() => db.getPool());
  const auth = options.auth || requireOnboardedInternal;
  const permission = options.permission || requirePermission('forecast', 'read');
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `forecast-labor-cost:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
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
        'SELECT public.canonical_forecast_labor_cost_v1_current($1,$2,$3,$4) value',
        identity)).rows[0]?.value;
      const value = sanitizeForecast(raw);
      if (!value) throw new Error('Invalid labor-cost forecast projection');
      await client.query('COMMIT');
      return res.status(200).json({ success: true, data: value });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return failure(res, error);
    } finally { if (client) client.release(); }
  });
  return router;
}

module.exports = { createForecastLaborCostRouter, sanitizeForecast };
