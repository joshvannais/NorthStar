'use strict';

const express = require('express');
const db = require('../db');
const { requireOnboardedInternal } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { rateLimit } = require('../middleware/rateLimit');

const MONEY = /^(?:0|[1-9][0-9]{0,11})\.[0-9]{2}$/;
const POSITIVE_MONEY = /^(?:0\.(?:0[1-9]|[1-9][0-9])|[1-9][0-9]{0,11}\.[0-9]{2})$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const REASONS = new Set(['reporting_profile_unavailable',
  'owner_recorded_schedule_coverage_unavailable', 'owner_recorded_schedule_coverage_stale',
  'schedule_currency_conflict', 'schedule_source_currentness_unavailable',
  'nonempty_zero_schedule_unavailable', 'schedule_amount_capacity_unavailable']);

function exact(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function instant(value) { return typeof value === 'string' && INSTANT.test(value) && Number.isFinite(Date.parse(value)); }
function count(value) { return Number.isSafeInteger(value) && value >= 0 && value <= 12000; }

function sanitizeForecast(value) {
  const keys = ['version', 'state', 'reason', 'fictional', 'checkedAt', 'currency', 'basis', 'horizon',
    'scope', 'overhead', 'financedAssetCash', 'evidence', 'allocation', 'forecastIssued',
    'completeOperatingCostForecastIssued', 'calibratedRangeIssued', 'probabilityIssued',
    'automaticActionAuthorized'];
  if (!exact(value, keys) || value.version !== 'm26-overhead-cash-forecast-v1' ||
      !['current', 'unavailable'].includes(value.state) || value.fictional !== false ||
      !instant(value.checkedAt) || !exact(value.basis,
        ['mode', 'cutoff', 'sourceRevision', 'sourceDigest', 'sourceRecordedAt']) ||
      !['current', 'as_of'].includes(value.basis.mode) || !instant(value.basis.cutoff) ||
      !exact(value.horizon, ['kind', 'timeZone', 'startsOn', 'endsOnExclusive', 'days']) ||
      value.horizon.kind !== 'local_calendar_days' || value.horizon.days !== 30 ||
      !DATE.test(value.horizon.startsOn || '') || !DATE.test(value.horizon.endsOnExclusive || '') ||
      Date.parse(value.horizon.endsOnExclusive + 'T00:00:00Z') -
        Date.parse(value.horizon.startsOn + 'T00:00:00Z') !== 30 * 86400000 ||
      !exact(value.scope, ['label', 'sourceCoverageVerified', 'wholeBusinessCoverageVerified',
        'offPlatformCoverageVerified']) ||
      value.scope.label !== 'Next 30 local calendar dates in the complete owner-recorded schedule source' ||
      value.scope.wholeBusinessCoverageVerified !== false || value.scope.offPlatformCoverageVerified !== false ||
      !exact(value.overhead, ['state', 'amount', 'dueCount', 'scheduleCount', 'reason']) ||
      !exact(value.financedAssetCash, ['state', 'amount', 'dueCount', 'obligationCount',
        'ownerMarkedSatisfiedCount', 'canceledCount', 'reason']) ||
      !exact(value.evidence, ['ownerRecordedSchedules', 'exactAmounts', 'exactDueDates',
        'recurrenceEndRecorded', 'sourceAttested', 'currentRevision', 'completeAsOf',
        'overlapReconciled', 'actualPaymentVerified', 'learnedAdjustmentApplied']) ||
      !exact(value.allocation, ['state', 'basis', 'jobCostAllocationIncluded',
        'economicDepreciationIncluded', 'actualPaymentClaimed', 'reason']) ||
      value.allocation.basis !== 'server_reconciled_m24_reference_manifest' ||
      value.allocation.jobCostAllocationIncluded !== false ||
      value.allocation.economicDepreciationIncluded !== false ||
      value.allocation.actualPaymentClaimed !== false || value.evidence.actualPaymentVerified !== false ||
      value.evidence.learnedAdjustmentApplied !== false ||
      value.completeOperatingCostForecastIssued !== false || value.calibratedRangeIssued !== false ||
      value.probabilityIssued !== false || value.automaticActionAuthorized !== false) return null;
  if (value.state === 'unavailable') {
    const sourceAbsent = value.basis.sourceRevision === null && value.basis.sourceDigest === null &&
      value.basis.sourceRecordedAt === null;
    const sourcePresent = Number.isSafeInteger(value.basis.sourceRevision) && value.basis.sourceRevision > 0 &&
      DIGEST.test(value.basis.sourceDigest || '') && instant(value.basis.sourceRecordedAt);
    if (!REASONS.has(value.reason) || value.currency !== null || value.forecastIssued !== false ||
        !(sourceAbsent || sourcePresent) || value.scope.sourceCoverageVerified !== false ||
        value.overhead.state !== 'unavailable' ||
        [value.overhead.amount, value.overhead.dueCount, value.overhead.scheduleCount].some(item => item !== null) ||
        value.overhead.reason !== value.reason || value.financedAssetCash.state !== 'unavailable' ||
        ['amount', 'dueCount', 'obligationCount', 'ownerMarkedSatisfiedCount', 'canceledCount']
          .some(key => value.financedAssetCash[key] !== null) ||
        value.financedAssetCash.reason !== value.reason || value.allocation.state !== 'unavailable' ||
        value.allocation.reason !== value.reason || Object.entries(value.evidence)
          .some(([key, flag]) => key !== 'actualPaymentVerified' && key !== 'learnedAdjustmentApplied' && flag !== false)) return null;
    return value;
  }
  if (value.reason !== null || !/^[A-Z]{3}$/.test(value.currency || '') ||
      typeof value.horizon.timeZone !== 'string' || value.horizon.timeZone.length < 1 ||
      value.scope.sourceCoverageVerified !== true || value.overhead.state !== 'current' ||
      !MONEY.test(value.overhead.amount || '') || !count(value.overhead.dueCount) ||
      !count(value.overhead.scheduleCount) || value.overhead.reason !== null ||
      value.financedAssetCash.state !== 'current' || !MONEY.test(value.financedAssetCash.amount || '') ||
      ![value.financedAssetCash.dueCount, value.financedAssetCash.obligationCount,
        value.financedAssetCash.ownerMarkedSatisfiedCount, value.financedAssetCash.canceledCount].every(count) ||
      value.financedAssetCash.reason !== null || value.allocation.state !== 'reconciled' ||
      value.allocation.reason !== 'dated_cash_commitments_kept_separate_from_bound_m24_job_cost_and_economic_recovery' ||
      ['ownerRecordedSchedules', 'exactAmounts', 'exactDueDates', 'recurrenceEndRecorded',
        'sourceAttested', 'completeAsOf', 'overlapReconciled'].some(key => value.evidence[key] !== true) ||
      value.evidence.currentRevision !== (value.basis.mode === 'current') ||
      !Number.isSafeInteger(value.basis.sourceRevision) || value.basis.sourceRevision < 1 ||
      !DIGEST.test(value.basis.sourceDigest || '') || !instant(value.basis.sourceRecordedAt) ||
      value.forecastIssued !== true) return null;
  const emptySource = value.overhead.scheduleCount === 0 && value.financedAssetCash.obligationCount === 0;
  if (emptySource ? (value.overhead.amount !== '0.00' || value.financedAssetCash.amount !== '0.00' ||
      value.overhead.dueCount !== 0 || value.financedAssetCash.dueCount !== 0) :
    (!POSITIVE_MONEY.test(value.overhead.amount) || !POSITIVE_MONEY.test(value.financedAssetCash.amount) ||
      value.overhead.dueCount < 1 || value.financedAssetCash.dueCount < 1)) return null;
  return value;
}

function failure(res, error) {
  const status = error?.code === '42501' ? 403 : ['22023', '22P02'].includes(error?.code) ? 400 :
    ['40001', '40P01', '55P03'].includes(error?.code) ? 409 : 503;
  return res.status(status).json({ success: false, error: {
    category: status === 403 ? 'OVERHEAD_CASH_FORECAST_RESTRICTED' :
      status === 400 ? 'OVERHEAD_CASH_FORECAST_REQUEST_INVALID' :
        status === 409 ? 'OVERHEAD_CASH_FORECAST_CHANGED' : 'OVERHEAD_CASH_FORECAST_UNAVAILABLE',
    message: status === 403 ? 'You cannot view this insight.' :
      status === 400 ? 'Check the request and try again.' :
        status === 409 ? 'The overhead and cash forecast changed. Refresh and try again.' :
          'The overhead and cash forecast is temporarily unavailable.',
  } });
}

function createForecastOverheadCashRouter(options = {}) {
  const router = express.Router();
  const poolProvider = options.poolProvider || (() => db.getPool());
  const auth = options.auth || requireOnboardedInternal;
  const permission = options.permission || requirePermission('forecast', 'read');
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `forecast-overhead-cash:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'private, no-store'); res.set('Referrer-Policy', 'no-referrer');
    res.vary('Cookie'); next();
  });
  async function read(req, res, historical) {
    if (historical ? (!exact(req.query, ['cutoff']) || !instant(req.query.cutoff)) : !exact(req.query, [])) {
      return failure(res, { code: '22023' });
    }
    let client;
    try {
      client = await poolProvider().connect();
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      await client.query("SET LOCAL statement_timeout = '15s'");
      await client.query("SET LOCAL lock_timeout = '2s'");
      const parameters = [req.tenantContext.organizationId, req.tenantContext.userId,
        req.userRole, req.authSession.id];
      if (historical) parameters.push(req.query.cutoff);
      const sql = historical
        ? 'SELECT public.canonical_forecast_overhead_cash_v1_as_of($1,$2,$3,$4,$5::timestamptz) value'
        : 'SELECT public.canonical_forecast_overhead_cash_v1_current($1,$2,$3,$4) value';
      const value = sanitizeForecast((await client.query(sql, parameters)).rows[0]?.value);
      if (!value) throw new Error('Invalid overhead-and-cash forecast projection');
      await client.query('COMMIT');
      return res.status(200).json({ success: true, data: value });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return failure(res, error);
    } finally { if (client) client.release(); }
  }
  router.get('/current', auth, permission, throttle, (req, res) => read(req, res, false));
  router.get('/as-of', auth, permission, throttle, (req, res) => read(req, res, true));
  return router;
}

module.exports = { createForecastOverheadCashRouter, sanitizeForecast };
