'use strict';

const express = require('express');
const db = require('../db');
const { requireOnboardedInternal } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { rateLimit } = require('../middleware/rateLimit');

const MONEY = /^(0|[1-9][0-9]{0,11})\.[0-9]{2}$/;
const AGGREGATE_MONEY = /^(0|[1-9][0-9]{0,17})\.[0-9]{2}$/;
const CURRENCY = /^[A-Z]{3}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
const TOP_REASONS = new Set([
  null, 'commercial_baseline_unavailable', 'commercial_baseline_not_current',
]);
const PLANNING_REASONS = new Set([null, 'current_pipeline_snapshot_unavailable']);

function exact(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function validInstant(value) {
  if (typeof value !== 'string') return false;
  const match = value.match(INSTANT);
  if (!match || /T24:|:60(?:\.|Z)/.test(value)) return false;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return false;
  const parts = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  return parsed.getUTCFullYear() === Number(parts[1]) &&
    parsed.getUTCMonth() + 1 === Number(parts[2]) && parsed.getUTCDate() === Number(parts[3]) &&
    parsed.getUTCHours() === Number(parts[4]) && parsed.getUTCMinutes() === Number(parts[5]) &&
    parsed.getUTCSeconds() === Number(parts[6]);
}

function amountCents(value) {
  if (!AGGREGATE_MONEY.test(value || '')) return null;
  const [whole, fraction] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction);
}

function planningFactValid(value) {
  if (value.state !== 'current' || !Number.isSafeInteger(value.count) ||
      value.count < 0 || value.count > 256) return false;
  const cents = amountCents(value.amountBeforeTax);
  return cents !== null && cents <= BigInt(value.count) * 99999999999999n;
}

function sanitizeOutlook(value) {
  const topKeys = ['version', 'state', 'reason', 'fictional', 'checkedAt', 'currency',
    'scope', 'authorizedEstimate', 'approvedPrice', 'bookedWork', 'planning',
    'earnedRevenue', 'cashTiming', 'forecastIssued', 'automaticActionAuthorized'];
  if (!exact(value, topKeys) || value.version !== 'm26-revenue-cash-outlook-v1' ||
      !['current', 'unavailable'].includes(value.state) || !TOP_REASONS.has(value.reason) ||
      value.fictional !== false || !validInstant(value.checkedAt) ||
      value.forecastIssued !== false || value.automaticActionAuthorized !== false ||
      !exact(value.scope, ['label', 'wholeBusinessCoverageVerified']) ||
      value.scope.label !== 'Current supported NorthStar commercial records' ||
      value.scope.wholeBusinessCoverageVerified !== false ||
      !exact(value.authorizedEstimate, ['state', 'amountBeforeTax']) ||
      !exact(value.approvedPrice, ['state', 'amountBeforeTax']) ||
      !exact(value.bookedWork, ['state', 'amountBeforeTax', 'classification']) ||
      value.bookedWork.classification !== 'committed' ||
      !exact(value.planning, ['state', 'reason', 'snapshotMode', 'capturedAt',
        'horizonStartsAt', 'horizonEndsAt', 'approvedNotBooked',
        'preliminaryEstimate', 'weightsWithheld', 'weightsAreScenarioAssumptions',
        'probability', 'forecastIssued']) ||
      !['current', 'unavailable'].includes(value.planning.state) ||
      !PLANNING_REASONS.has(value.planning.reason) || value.planning.weightsWithheld !== true ||
      value.planning.weightsAreScenarioAssumptions !== true ||
      !exact(value.planning.approvedNotBooked, ['state', 'count', 'amountBeforeTax', 'committed']) ||
      !exact(value.planning.preliminaryEstimate, ['state', 'count', 'amountBeforeTax', 'committed']) ||
      value.planning.approvedNotBooked.committed !== false ||
      value.planning.preliminaryEstimate.committed !== false ||
      !exact(value.planning.probability, ['state', 'reason']) ||
      value.planning.probability.state !== 'unavailable' ||
      value.planning.probability.reason !== 'calibrated_probability_authority_unavailable' ||
      value.planning.forecastIssued !== false ||
      !exact(value.earnedRevenue, ['state', 'amount', 'reason']) ||
      value.earnedRevenue.state !== 'unavailable' || value.earnedRevenue.amount !== null ||
      value.earnedRevenue.reason !== 'recognition_authority_unavailable' ||
      !exact(value.cashTiming, ['state', 'amount', 'reason']) ||
      value.cashTiming.state !== 'unavailable' || value.cashTiming.amount !== null ||
      value.cashTiming.reason !== 'financial_period_coverage_unavailable') return null;
  const current = value.state === 'current';
  if ((current && (value.reason !== null || !CURRENCY.test(value.currency || '') ||
      value.authorizedEstimate.state !== 'current' ||
      value.approvedPrice.state !== 'current' || value.bookedWork.state !== 'current' ||
      !MONEY.test(value.authorizedEstimate.amountBeforeTax || '') ||
      !MONEY.test(value.approvedPrice.amountBeforeTax || '') ||
      !MONEY.test(value.bookedWork.amountBeforeTax || ''))) ||
      (!current && (value.reason === null || value.currency !== null ||
        value.authorizedEstimate.state !== 'unavailable' ||
        value.approvedPrice.state !== 'unavailable' || value.bookedWork.state !== 'unavailable' ||
        value.authorizedEstimate.amountBeforeTax !== null ||
        value.approvedPrice.amountBeforeTax !== null || value.bookedWork.amountBeforeTax !== null ||
        value.planning.state !== 'unavailable'))) return null;
  const planningCurrent = value.planning.state === 'current';
  if ((planningCurrent && (value.planning.reason !== null ||
      !['current_at_read', 'frozen_at_capture'].includes(value.planning.snapshotMode) ||
      !validInstant(value.planning.capturedAt) || !validInstant(value.planning.horizonStartsAt) ||
      !validInstant(value.planning.horizonEndsAt) ||
      Date.parse(value.planning.capturedAt) >= Date.parse(value.planning.horizonStartsAt) ||
      Date.parse(value.planning.horizonEndsAt) <= Date.parse(value.planning.horizonStartsAt) ||
      value.planning.approvedNotBooked.state !== 'current' ||
      value.planning.preliminaryEstimate.state !== 'current' ||
      !planningFactValid(value.planning.approvedNotBooked) ||
      !planningFactValid(value.planning.preliminaryEstimate) ||
      value.planning.approvedNotBooked.count + value.planning.preliminaryEstimate.count > 256 ||
      !AGGREGATE_MONEY.test(value.planning.approvedNotBooked.amountBeforeTax || '') ||
      !AGGREGATE_MONEY.test(value.planning.preliminaryEstimate.amountBeforeTax || ''))) ||
      (!planningCurrent && (value.planning.reason !== 'current_pipeline_snapshot_unavailable' ||
        value.planning.snapshotMode !== null || value.planning.capturedAt !== null ||
        value.planning.horizonStartsAt !== null || value.planning.horizonEndsAt !== null ||
        value.planning.approvedNotBooked.state !== 'unavailable' ||
        value.planning.preliminaryEstimate.state !== 'unavailable' ||
        value.planning.approvedNotBooked.count !== null ||
        value.planning.preliminaryEstimate.count !== null ||
        value.planning.approvedNotBooked.amountBeforeTax !== null ||
        value.planning.preliminaryEstimate.amountBeforeTax !== null))) return null;
  return {
    version: value.version, state: value.state, reason: value.reason, fictional: false,
    checkedAt: value.checkedAt, currency: value.currency,
    scope: { label: value.scope.label, wholeBusinessCoverageVerified: false },
    authorizedEstimate: { state: value.authorizedEstimate.state,
      amountBeforeTax: value.authorizedEstimate.amountBeforeTax },
    approvedPrice: { state: value.approvedPrice.state,
      amountBeforeTax: value.approvedPrice.amountBeforeTax },
    bookedWork: { state: value.bookedWork.state,
      amountBeforeTax: value.bookedWork.amountBeforeTax, classification: 'committed' },
    planning: { state: value.planning.state, reason: value.planning.reason,
      snapshotMode: value.planning.snapshotMode, capturedAt: value.planning.capturedAt,
      horizonStartsAt: value.planning.horizonStartsAt,
      horizonEndsAt: value.planning.horizonEndsAt,
      approvedNotBooked: { state: value.planning.approvedNotBooked.state,
        count: value.planning.approvedNotBooked.count,
        amountBeforeTax: value.planning.approvedNotBooked.amountBeforeTax,
        committed: false },
      preliminaryEstimate: { state: value.planning.preliminaryEstimate.state,
        count: value.planning.preliminaryEstimate.count,
        amountBeforeTax: value.planning.preliminaryEstimate.amountBeforeTax,
        committed: false },
      weightsWithheld: true, weightsAreScenarioAssumptions: true,
      probability: { state: 'unavailable',
        reason: 'calibrated_probability_authority_unavailable' },
      forecastIssued: false },
    earnedRevenue: { state: 'unavailable', amount: null,
      reason: 'recognition_authority_unavailable' },
    cashTiming: { state: 'unavailable', amount: null,
      reason: 'financial_period_coverage_unavailable' },
    forecastIssued: false, automaticActionAuthorized: false,
  };
}

function failure(res, error) {
  const code = error?.code;
  const status = code === '42501' ? 403 :
    code === '22023' || code === '22P02' ? 400 :
      ['40001', '40P01', '55P03'].includes(code) ? 409 : 503;
  return res.status(status).json({ success: false, error: {
    category: status === 403 ? 'FORECAST_OUTLOOK_RESTRICTED' :
      status === 400 ? 'FORECAST_OUTLOOK_REQUEST_INVALID' :
        status === 409 ? 'FORECAST_OUTLOOK_CHANGED' : 'FORECAST_OUTLOOK_UNAVAILABLE',
    message: status === 403 ? 'You cannot view this outlook.' :
      status === 400 ? 'Check the request and try again.' :
        status === 409 ? 'The outlook changed. Refresh and try again.' :
          'The outlook is temporarily unavailable.',
  } });
}

function createForecastRevenueCashOutlookRouter(options = {}) {
  const router = express.Router();
  const poolProvider = options.poolProvider || (() => db.getPool());
  const auth = options.auth || requireOnboardedInternal;
  const permission = options.permission || requirePermission('forecast', 'read');
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `forecast-revenue-cash-outlook:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
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
        'SELECT public.canonical_forecast_revenue_cash_outlook_current($1,$2,$3,$4) value',
        identity)).rows[0]?.value;
      const value = sanitizeOutlook(raw);
      if (!value) throw new Error('Invalid revenue and cash outlook projection');
      await client.query('COMMIT');
      return res.status(200).json({ success: true, data: value });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return failure(res, error);
    } finally { if (client) client.release(); }
  });
  return router;
}

module.exports = { createForecastRevenueCashOutlookRouter, sanitizeOutlook };
