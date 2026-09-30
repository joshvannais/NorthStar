'use strict';

const express = require('express');
const db = require('../db');
const { requireOnboardedInternal } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { rateLimit } = require('../middleware/rateLimit');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const KEY = /^[A-Za-z0-9._:-]{16,128}$/;
const UTC_MICROS = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)\.(\d{6})Z$/;
const DATABASE_INSTANT = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d{1,6}))?(Z|[+-]\d\d:\d\d)$/;
const VERSION = 'm26-commercial-booking-withdrawal-cohort-v1';
const TARGET = 'commercial.owner_reviewed_booking_withdrawal';
const SOURCE = 'northstar_owner_reviewed_commercial_booking_history';

function exact(value, keys) {
  const prototype = value && typeof value === 'object' ?
    Object.getPrototypeOf(value) : undefined;
  return value && typeof value === 'object' && !Array.isArray(value) &&
    (prototype === Object.prototype || prototype === null) &&
    Object.keys(value).length === keys.length &&
    Object.keys(value).every(key => keys.includes(key));
}

function calendarInstant(value, expression) {
  const match = typeof value === 'string' ? expression.exec(value) : null;
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 ||
      day > new Date(Date.UTC(year, month, 0)).getUTCDate() || hour > 23 ||
      minute > 59 || second > 59) return false;
  const zone = match[8];
  if (zone && zone !== 'Z') {
    const offset = /([+-])(\d\d):(\d\d)/.exec(zone);
    if (!offset || Number(offset[2]) > 23 || Number(offset[3]) > 59) return false;
  }
  return Number.isFinite(Date.parse(value));
}

function invalid(res) {
  return res.status(400).json({ success: false, error: {
    category: 'FORECAST_TRANSITION_COHORT_REQUEST_INVALID',
    message: 'Check the transition cohort details and try again.',
  } });
}

function failure(res, error) {
  const status = error?.code === '42501' ? 403 :
    error?.code === '22023' ? 400 :
      ['23505', '40001', '40P01', '55P03'].includes(error?.code) ? 409 : 503;
  const category = status === 403 ? 'FORECAST_TRANSITION_COHORT_RESTRICTED' :
    status === 400 ? 'FORECAST_TRANSITION_COHORT_REQUEST_INVALID' :
      error?.code === '23505' ? 'FORECAST_TRANSITION_COHORT_REQUEST_REUSED' :
        ['40P01', '55P03', '57014'].includes(error?.code) ?
          'FORECAST_TRANSITION_COHORT_BUSY' :
          status === 409 ? 'FORECAST_TRANSITION_COHORT_CHANGED' :
            'FORECAST_TRANSITION_COHORT_UNAVAILABLE';
  const message = status === 403 ? 'You cannot access this transition cohort.' :
    status === 400 ? 'Check the transition cohort details and try again.' :
      error?.code === '23505' ?
        'This request was already used with different details. Start a new request.' :
        ['40P01', '55P03', '57014'].includes(error?.code) ?
          'The transition source is busy. Try again shortly.' :
          status === 409 ? 'The transition source changed. Refresh and try again.' :
            'The transition cohort is temporarily unavailable.';
  return res.status(status).json({ success: false, error: { category, message } });
}

function safeCohort(value, expectedId = null) {
  if (!exact(value, ['id', 'version', 'targetKey', 'state', 'reason', 'cutoffAt',
    'horizonEndsAt', 'capturedAt', 'eligibleCount', 'cancelledCount', 'observedRate',
    'sourceDigest', 'cohortDigest', 'sourceAuthority', 'sourceAuthenticated',
    'sourceCoverageComplete', 'offPlatformCoverageVerified',
    'providerCoverageVerified', 'probabilityCalibrated', 'confidence',
    'forecastIssued', 'paidNumericServing']) || !UUID.test(value.id || '') ||
      value.version !== VERSION ||
      value.targetKey !== TARGET || !['descriptive_only', 'unavailable',
        'source_stale'].includes(value.state) ||
      !(value.reason === null || ['insufficient_history',
        'source_changed_inside_horizon'].includes(value.reason)) ||
      !calendarInstant(value.cutoffAt, DATABASE_INSTANT) ||
      !calendarInstant(value.horizonEndsAt, DATABASE_INSTANT) ||
      !calendarInstant(value.capturedAt, DATABASE_INSTANT) ||
      Date.parse(value.cutoffAt) >= Date.parse(value.horizonEndsAt) ||
      !Number.isSafeInteger(value.eligibleCount) || value.eligibleCount < 0 ||
      value.eligibleCount > 500 || !Number.isSafeInteger(value.cancelledCount) ||
      value.cancelledCount < 0 || value.cancelledCount > value.eligibleCount ||
      !(value.observedRate === null || /^(?:0(?:\.\d{1,6})?|1)$/.test(value.observedRate)) ||
      !(value.sourceDigest === null || DIGEST.test(value.sourceDigest)) ||
      !(value.cohortDigest === null || DIGEST.test(value.cohortDigest)) ||
      value.sourceAuthority !== SOURCE || typeof value.sourceAuthenticated !== 'boolean' ||
      value.sourceCoverageComplete !== false || value.offPlatformCoverageVerified !== false ||
      value.providerCoverageVerified !== false || value.probabilityCalibrated !== false ||
      value.confidence !== 'unavailable' || value.forecastIssued !== false ||
      value.paidNumericServing !== false ||
      (expectedId !== null && value.id !== expectedId)) return null;
  if (value.state === 'descriptive_only' && (value.reason !== null ||
      value.eligibleCount < 1 || value.observedRate === null ||
      !value.sourceAuthenticated || !value.sourceDigest || !value.cohortDigest)) return null;
  if (value.state === 'unavailable' && (value.reason !== 'insufficient_history' ||
      value.eligibleCount !== 0 || value.cancelledCount !== 0 ||
      value.observedRate !== null || !value.sourceAuthenticated ||
      !value.sourceDigest || !value.cohortDigest)) return null;
  if (value.state === 'source_stale' && (value.reason !== 'source_changed_inside_horizon' ||
      value.eligibleCount !== 0 || value.cancelledCount !== 0 ||
      value.observedRate !== null || value.sourceAuthenticated ||
      value.sourceDigest !== null || value.cohortDigest !== null)) return null;
  return { state: value.state, reason: value.reason, cohortId: value.id,
    version: value.version, targetKey: value.targetKey, cutoffAt: value.cutoffAt,
    horizonEndsAt: value.horizonEndsAt, capturedAt: value.capturedAt,
    eligibleCount: value.eligibleCount, cancelledCount: value.cancelledCount,
    observedRate: value.observedRate, sourceDigest: value.sourceDigest,
    cohortDigest: value.cohortDigest, sourceAuthority: value.sourceAuthority,
    sourceAuthenticated: value.sourceAuthenticated,
    sourceCoverageComplete: false, offPlatformCoverageVerified: false,
    providerCoverageVerified: false, probabilityCalibrated: false,
    confidence: 'unavailable', forecastIssued: false, paidNumericServing: false };
}

function createForecastTransitionCohortsRouter(options = {}) {
  const router = express.Router();
  const poolProvider = options.poolProvider || (() => db.getPool());
  const auth = options.auth || requireOnboardedInternal;
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `forecast-transition-cohort:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
  const captureThrottle = options.captureThrottle || rateLimit('forecast-source-capture', req =>
    `forecast-transition-cohort-capture:${req.tenantContext.organizationId}`);

  router.use((_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('Referrer-Policy', 'no-referrer');
    res.vary('Cookie');
    next();
  });

  async function run(req, res, { isolation = 'READ COMMITTED', sql, params,
    write = false, validate }) {
    const attempts = write ? 2 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      let client;
      try {
        client = await poolProvider().connect();
        await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
        await client.query("SET LOCAL statement_timeout = '10000ms'");
        await client.query("SET LOCAL lock_timeout = '2000ms'");
        const identity = [req.tenantContext.organizationId,
          req.tenantContext.userId, req.userRole, req.authSession.id];
        const value = (await client.query(sql, [...identity, ...params])).rows[0]?.value;
        const data = validate(value);
        if (!data) throw new Error('Invalid guarded transition cohort result');
        await client.query('COMMIT');
        if (write && value.replayed === true) res.set('Idempotency-Replayed', 'true');
        return res.status(write && value.replayed === false && value.cohort ? 201 : 200)
          .json({ success: true, data });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        // A concurrent winner can surface as a serialization or uniqueness
        // conflict at the transaction edge. Retry once in a new transaction so
        // the immutable receipt can be replayed. Timeouts bound both attempts.
        if (write && ['40001', '23505'].includes(error?.code) &&
            attempt + 1 < attempts) continue;
        return failure(res, error);
      } finally { if (client) client.release(); }
    }
    return failure(res, { code: '40001' });
  }

  router.post('/commercial-booking-withdrawals', auth, requirePermission('forecast', 'update'),
    captureThrottle, async (req, res) => {
      const body = req.body, key = req.get('Idempotency-Key');
      if (!exact(req.query, []) || !exact(body, ['cutoffAt', 'horizonEndsAt']) ||
          !calendarInstant(body.cutoffAt, UTC_MICROS) ||
          !calendarInstant(body.horizonEndsAt, UTC_MICROS) ||
          Date.parse(body.cutoffAt) >= Date.parse(body.horizonEndsAt) ||
          !KEY.test(key || '')) return invalid(res);
      return run(req, res, { isolation: 'READ COMMITTED', write: true,
        sql: 'SELECT public.canonical_forecast_booking_cancellation_cohort_capture($1,$2,$3,$4,$5,$6,$7,$8) value',
        params: [req.get('X-CSRF-Token'), key, body.cutoffAt, body.horizonEndsAt],
        validate(value) {
          if (!value || typeof value.replayed !== 'boolean') return null;
          if (value.state === 'source_changed_inside_horizon') {
            if (value.replayed !== false || value.sourceAuthenticated !== false ||
                value.sourceCoverageComplete !== false ||
                value.offPlatformCoverageVerified !== false ||
                value.providerCoverageVerified !== false ||
                value.probabilityCalibrated !== false ||
                value.confidence !== 'unavailable' || value.forecastIssued !== false ||
                value.paidNumericServing !== false) return null;
            return { state: value.state, reason: 'source_correction_inside_horizon',
              sourceAuthenticated: false, sourceCoverageComplete: false,
              offPlatformCoverageVerified: false, providerCoverageVerified: false,
              probabilityCalibrated: false, forecastIssued: false,
              confidence: 'unavailable', paidNumericServing: false };
          }
          const cohort = safeCohort(value.cohort);
          return cohort && { ...cohort, replayed: value.replayed };
        } });
    });

  router.get('/commercial-booking-withdrawals/:cohortId', auth,
    requirePermission('forecast', 'read'), throttle, async (req, res) => {
      if (!UUID.test(req.params.cohortId || '') || !exact(req.query, [])) return invalid(res);
      const cohortId = req.params.cohortId.toLowerCase();
      return run(req, res, {
        sql: 'SELECT public.canonical_forecast_booking_cancellation_cohort_read($1,$2,$3,$4,$5) value',
        params: [cohortId], validate: value => safeCohort(value, cohortId),
      });
    });
  return router;
}

module.exports = { createForecastTransitionCohortsRouter };
