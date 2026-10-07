'use strict';

const express = require('express');
const db = require('../db');
const { requireOnboardedInternal } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { rateLimit } = require('../middleware/rateLimit');

const MONEY = /^(?:0|[1-9][0-9]{0,14})\.[0-9]{2}$/;
const SIGNED = /^-?(?:0|[1-9][0-9]{0,14})\.[0-9]{2}$/;
const MARGIN = /^-?(?:0|[1-9][0-9]{0,8})\.[0-9]{2}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
const REASONS = new Set([
  'reporting_profile_unavailable', 'current_composition_coverage_unavailable',
  'dated_cash_source_unavailable', 'economic_expense_policy_unavailable',
  'economic_expense_policy_stale', 'approved_timing_attribution_unavailable',
  'compatible_revenue_unavailable', 'source_authenticated_composition_unavailable',
  'overhead_overlap_unavailable', 'nonzero_revenue_denominator_unavailable',
  'composition_cohort_mismatch',
]);

function exact(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key =>
      Object.prototype.hasOwnProperty.call(value, key));
}

function scenario(value) {
  return exact(value, ['key', 'label', 'operatingCost', 'profit', 'margin', 'assumption']) &&
    /^[a-z][a-z0-9_-]{1,47}$/.test(value.key || '') && typeof value.label === 'string' &&
    value.label.length > 0 && value.label.length <= 80 && MONEY.test(value.operatingCost || '') &&
    SIGNED.test(value.profit || '') && MARGIN.test(value.margin || '') &&
    exact(value.assumption, ['operatingCostBasisPoints', 'reason']) &&
    Number.isSafeInteger(value.assumption.operatingCostBasisPoints) &&
    value.assumption.operatingCostBasisPoints >= 5000 &&
    value.assumption.operatingCostBasisPoints <= 15999 &&
    typeof value.assumption.reason === 'string' && value.assumption.reason.length > 0;
}

function month(value) {
  return exact(value, ['month', 'revenue', 'directJobCost', 'incrementalJobOverhead',
    'fixedPeriodExpense', 'variablePeriodExpense', 'operatingCost', 'profitLow',
    'profitHigh', 'marginLow', 'marginHigh', 'scenarios']) &&
    /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value.month || '') &&
    ['revenue', 'directJobCost', 'incrementalJobOverhead', 'fixedPeriodExpense',
      'variablePeriodExpense', 'operatingCost'].every(key => MONEY.test(value[key] || '')) &&
    SIGNED.test(value.profitLow || '') && SIGNED.test(value.profitHigh || '') &&
    MARGIN.test(value.marginLow || '') && MARGIN.test(value.marginHigh || '') &&
    Array.isArray(value.scenarios) && value.scenarios.length >= 2 &&
    value.scenarios.length <= 5 && value.scenarios.every(scenario);
}

function sanitizeForecast(value) {
  const keys = ['version', 'state', 'reason', 'fictional', 'checkedAt', 'currency',
    'horizon', 'scope', 'kpis', 'months', 'revenue', 'costs', 'range', 'evidence',
    'run', 'forecastIssued', 'calibratedRangeIssued', 'probabilityIssued',
    'automaticActionAuthorized'];
  if (!exact(value, keys) || value.version !== 'm26-operating-profit-forecast-v1' ||
      !['current', 'unavailable'].includes(value.state) || value.fictional !== false ||
      typeof value.checkedAt !== 'string' || !INSTANT.test(value.checkedAt) ||
      !exact(value.horizon, ['kind', 'timeZone', 'startsAt', 'endsAt', 'startsOn', 'endsOnExclusive']) ||
      value.horizon.kind !== 'next_30_elapsed_days_with_local_expense_dates' ||
      !INSTANT.test(value.horizon.startsAt || '') || !INSTANT.test(value.horizon.endsAt || '') ||
      Date.parse(value.horizon.endsAt) - Date.parse(value.horizon.startsAt) !== 30 * 86400000 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value.horizon.startsOn || '') ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value.horizon.endsOnExclusive || '') ||
      Date.parse(`${value.horizon.endsOnExclusive}T00:00:00Z`) -
        Date.parse(`${value.horizon.startsOn}T00:00:00Z`) !== 30 * 86400000 ||
      !exact(value.scope, ['label', 'wholeBusinessCoverageVerified',
        'offPlatformCoverageVerified']) ||
      value.scope.label !== 'Authenticated owner-confirmed scheduled backlog and recorded company operating expenses' ||
      value.scope.wholeBusinessCoverageVerified !== false ||
      value.scope.offPlatformCoverageVerified !== false ||
      !exact(value.kpis, ['operatingCost', 'profitLow', 'profitHigh', 'marginLow', 'marginHigh']) ||
      !exact(value.revenue, ['target', 'amount', 'recognizedRevenueMeasured',
        'earnedRevenueMeasured', 'invoicedRevenueMeasured', 'collectedCashMeasured']) ||
      value.revenue.target !== 'approved_booked_price_before_tax' ||
      [value.revenue.recognizedRevenueMeasured, value.revenue.earnedRevenueMeasured,
        value.revenue.invoicedRevenueMeasured, value.revenue.collectedCashMeasured]
        .some(flag => flag !== false) ||
      !exact(value.costs, ['directJobCost', 'incrementalJobOverhead', 'fixedPeriodExpense',
        'variablePeriodExpense', 'operatingCost', 'datedCashObligations',
        'actualPaymentMeasured']) || value.costs.actualPaymentMeasured !== false ||
      !exact(value.range, ['kind', 'scenarios', 'calibrated', 'probability']) ||
      value.range.kind !== 'deterministic_named_scenarios' ||
      value.range.calibrated !== false || value.range.probability !== false ||
      !exact(value.evidence, ['sourceAuthenticatedComposition',
        'componentQuantitiesAndCostsVerified', 'duplicatePreventionVerified',
        'approvedScheduleTiming', 'overlapReviewed', 'expenseCoverageVerified',
        'currentnessVerified', 'm25AdjustmentApplied', 'externalEventClassified',
        'scopeChangeClassified']) || value.evidence.m25AdjustmentApplied !== false ||
      value.evidence.externalEventClassified !== false ||
      value.evidence.scopeChangeClassified !== false ||
      !exact(value.run, ['calculationVersion', 'digest']) ||
      value.run.calculationVersion !== 'm26-operating-profit-calculation-v1' ||
      value.calibratedRangeIssued !== false || value.probabilityIssued !== false ||
      value.automaticActionAuthorized !== false || !Array.isArray(value.months) ||
      !Array.isArray(value.range.scenarios)) return null;
  if (value.state === 'unavailable') {
    return REASONS.has(value.reason) && value.currency === null && value.forecastIssued === false &&
      Object.values(value.kpis).every(item => item === null) && value.months.length === 0 &&
      value.revenue.amount === null && ['directJobCost', 'incrementalJobOverhead',
        'fixedPeriodExpense', 'variablePeriodExpense', 'operatingCost', 'datedCashObligations']
        .every(key => value.costs[key] === null) && value.range.scenarios.length === 0 &&
      Object.values(value.evidence).every(flag => flag === false) && value.run.digest === null ? value : null;
  }
  if (value.reason !== null || value.forecastIssued !== true ||
      !/^[A-Z]{3}$/.test(value.currency || '') || !MONEY.test(value.kpis.operatingCost || '') ||
      !SIGNED.test(value.kpis.profitLow || '') || !SIGNED.test(value.kpis.profitHigh || '') ||
      !MARGIN.test(value.kpis.marginLow || '') || !MARGIN.test(value.kpis.marginHigh || '') ||
      !Array.isArray(value.months) || value.months.length < 1 || value.months.length > 3 ||
      !value.months.every(month) || !MONEY.test(value.revenue.amount || '') ||
      !['directJobCost', 'incrementalJobOverhead', 'fixedPeriodExpense',
        'variablePeriodExpense', 'operatingCost', 'datedCashObligations']
        .every(key => MONEY.test(value.costs[key] || '')) ||
      value.range.scenarios.length < 2 || value.range.scenarios.length > 5 ||
      !value.range.scenarios.every(scenario) ||
      ['sourceAuthenticatedComposition', 'componentQuantitiesAndCostsVerified',
        'duplicatePreventionVerified', 'approvedScheduleTiming', 'overlapReviewed',
        'expenseCoverageVerified', 'currentnessVerified']
        .some(key => value.evidence[key] !== true) ||
      !/^[0-9a-f]{64}$/.test(value.run.digest || '')) return null;
  const monthKeys = value.months.map(item => item.month);
  if (new Set(monthKeys).size !== monthKeys.length ||
      monthKeys.join('|') !== [...monthKeys].sort().join('|')) return null;
  return value;
}

function failure(res, error) {
  const code = error?.code;
  const status = code === '42501' ? 403 : ['22023', '22P02'].includes(code) ? 400 :
    ['40001', '40P01', '55P03'].includes(code) ? 409 : 503;
  return res.status(status).json({ success: false, error: {
    category: status === 403 ? 'OPERATING_PROFIT_FORECAST_RESTRICTED' :
      status === 400 ? 'OPERATING_PROFIT_FORECAST_REQUEST_INVALID' :
        status === 409 ? 'OPERATING_PROFIT_FORECAST_CHANGED' : 'OPERATING_PROFIT_FORECAST_UNAVAILABLE',
    message: status === 403 ? 'You cannot view this insight.' :
      status === 400 ? 'Check the request and try again.' :
        status === 409 ? 'The operating profit forecast changed. Refresh and try again.' :
          'The operating profit forecast is temporarily unavailable.',
  } });
}

function createForecastOperatingProfitRouter(options = {}) {
  const router = express.Router();
  const poolProvider = options.poolProvider || (() => db.getPool());
  const auth = options.auth || requireOnboardedInternal;
  const permission = options.permission || requirePermission('forecast', 'read');
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `forecast-operating-profit:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
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
      await client.query("SET LOCAL statement_timeout = '20s'");
      await client.query("SET LOCAL lock_timeout = '2s'");
      const identity = [req.tenantContext.organizationId, req.tenantContext.userId,
        req.userRole, req.authSession.id];
      const raw = (await client.query(
        'SELECT public.canonical_forecast_operating_profit_v1_current($1,$2,$3,$4) value',
        identity)).rows[0]?.value;
      const value = sanitizeForecast(raw);
      if (!value) throw new Error('Invalid operating-profit forecast projection');
      await client.query('COMMIT');
      return res.status(200).json({ success: true, data: value });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return failure(res, error);
    } finally { if (client) client.release(); }
  });
  return router;
}

module.exports = { createForecastOperatingProfitRouter, sanitizeForecast };
