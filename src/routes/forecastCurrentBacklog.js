'use strict';

const express = require('express');
const db = require('../db');
const { requireOnboardedInternal } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { rateLimit } = require('../middleware/rateLimit');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const KEY = /^[A-Za-z0-9._:-]{16,128}$/;
const DATABASE_INSTANT = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d{1,6}))?(Z|[+-]\d\d:\d\d)$/;

function exact(value, keys) {
  const prototype = value && typeof value === 'object' ? Object.getPrototypeOf(value) : undefined;
  return value && typeof value === 'object' && !Array.isArray(value) &&
    (prototype === Object.prototype || prototype === null) &&
    Object.keys(value).length === keys.length &&
    Object.keys(value).every(key => keys.includes(key));
}

function instant(value) {
  const match = typeof value === 'string' ? DATABASE_INSTANT.exec(value) : null;
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 ||
      day > new Date(Date.UTC(year, month, 0)).getUTCDate() || hour > 23 ||
      minute > 59 || second > 59) return false;
  const zone = match[8];
  if (zone !== 'Z') {
    const offset = /([+-])(\d\d):(\d\d)/.exec(zone);
    if (!offset || Number(offset[2]) > 23 || Number(offset[3]) > 59) return false;
  }
  return Number.isFinite(Date.parse(value));
}

function invalid(res) {
  return res.status(400).json({ success: false, error: {
    category: 'FORECAST_CURRENT_BACKLOG_REQUEST_INVALID',
    message: 'Check the current backlog request and try again.',
  } });
}

function failure(res, error) {
  const status = error?.code === '42501' ? 403 : error?.code === '22023' ? 400 :
    ['23505', '40001', '40P01', '55P03'].includes(error?.code) ? 409 : 503;
  const busy = ['40001', '40P01', '55P03', '57014'].includes(error?.code);
  const category = status === 403 ? 'FORECAST_CURRENT_BACKLOG_RESTRICTED' :
    status === 400 ? 'FORECAST_CURRENT_BACKLOG_REQUEST_INVALID' :
      error?.code === '23505' ? 'FORECAST_CURRENT_BACKLOG_REQUEST_REUSED' :
        busy ? 'FORECAST_CURRENT_BACKLOG_BUSY' :
          status === 409 ? 'FORECAST_CURRENT_BACKLOG_CHANGED' :
            'FORECAST_CURRENT_BACKLOG_UNAVAILABLE';
  const message = status === 403 ? 'You cannot access this current backlog position.' :
    status === 400 ? 'Check the current backlog request and try again.' :
      error?.code === '23505' ?
        'This request was already used with different details. Start a new request.' :
        busy ? 'The current backlog source is busy. Try again shortly.' :
          status === 409 ? 'The current backlog source changed. Refresh and try again.' :
            'The current backlog position is temporarily unavailable.';
  return res.status(status).json({ success: false, error: { category, message } });
}

function safeSnapshot(value, expectedId = null) {
  const keys = ['id', 'version', 'targetKey', 'state', 'reason', 'capturedAt',
    'approvedUnscheduledCount', 'approvedScheduledCount', 'workInProgressCount',
    'completedCount', 'unresolvedLinkageCount', 'knownBacklogCount',
    'plannedPersonMinutes', 'backlogHoursState', 'backlogHoursReason',
    'sourceDigest', 'snapshotDigest', 'sourceAuthority', 'sourceAuthenticated',
    'knownSubsetOnly', 'sourceCoverageComplete', 'offPlatformCoverageVerified',
    'providerCoverageVerified', 'probabilityCalibrated', 'forecastIssued',
    'paidNumericServing'];
  if (!exact(value, keys) || !UUID.test(value.id || '') ||
      value.version !== 'm26-current-backlog-position-v1' ||
      value.targetKey !== 'demand.current_backlog_position.v1' ||
      !['descriptive_subset', 'partial', 'unavailable', 'source_stale'].includes(value.state) ||
      !(value.reason === null || ['unresolved_linkage_present',
        'no_authenticated_approved_booking_history',
        'source_changed_after_capture'].includes(value.reason)) ||
      !instant(value.capturedAt) ||
      !['approvedUnscheduledCount', 'approvedScheduledCount', 'workInProgressCount',
        'completedCount', 'unresolvedLinkageCount', 'knownBacklogCount']
        .every(key => Number.isSafeInteger(value[key]) && value[key] >= 0 && value[key] <= 500) ||
      value.knownBacklogCount !== value.approvedUnscheduledCount +
        value.approvedScheduledCount + value.workInProgressCount ||
      value.plannedPersonMinutes !== null || value.backlogHoursState !== 'unavailable' ||
      value.backlogHoursReason !== 'approved_person_hour_plan_missing' ||
      !(value.sourceDigest === null || DIGEST.test(value.sourceDigest)) ||
      !(value.snapshotDigest === null || DIGEST.test(value.snapshotDigest)) ||
      value.sourceAuthority !==
        'northstar_authenticated_booking_schedule_and_execution_current_position' ||
      typeof value.sourceAuthenticated !== 'boolean' || value.knownSubsetOnly !== true ||
      value.sourceCoverageComplete !== false || value.offPlatformCoverageVerified !== false ||
      value.providerCoverageVerified !== false || value.probabilityCalibrated !== false ||
      value.forecastIssued !== false || value.paidNumericServing !== false ||
      (expectedId !== null && value.id !== expectedId)) return null;
  const total = value.approvedUnscheduledCount + value.approvedScheduledCount +
    value.workInProgressCount + value.completedCount + value.unresolvedLinkageCount;
  if (value.state === 'descriptive_subset' && (value.reason !== null || total < 1 ||
      value.unresolvedLinkageCount !== 0 || !value.sourceAuthenticated ||
      !value.sourceDigest || !value.snapshotDigest)) return null;
  if (value.state === 'partial' && (value.reason !== 'unresolved_linkage_present' ||
      value.unresolvedLinkageCount < 1 || !value.sourceAuthenticated ||
      !value.sourceDigest || !value.snapshotDigest)) return null;
  if (value.state === 'unavailable' &&
      (value.reason !== 'no_authenticated_approved_booking_history' || total !== 0 ||
       !value.sourceAuthenticated || !value.sourceDigest || !value.snapshotDigest)) return null;
  if (value.state === 'source_stale' &&
      (value.reason !== 'source_changed_after_capture' || total !== 0 ||
       value.sourceAuthenticated || value.sourceDigest !== null ||
       value.snapshotDigest !== null)) return null;
  return value;
}

function createForecastCurrentBacklogRouter(options = {}) {
  const router = express.Router();
  const poolProvider = options.poolProvider || (() => db.getPool());
  const auth = options.auth || requireOnboardedInternal;
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `forecast-current-backlog:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
  const captureThrottle = options.captureThrottle || rateLimit('forecast-source-capture', req =>
    `forecast-current-backlog-capture:${req.tenantContext.organizationId}`);

  router.use((_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('Referrer-Policy', 'no-referrer');
    res.vary('Cookie');
    next();
  });

  async function run(req, res, { write = false, sql, params, validate }) {
    const attempts = write ? 2 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      let client;
      try {
        client = await poolProvider().connect();
        await client.query(write ? 'BEGIN ISOLATION LEVEL SERIALIZABLE' : 'BEGIN');
        await client.query("SET LOCAL statement_timeout = '5000ms'");
        const identity = [req.tenantContext.organizationId, req.tenantContext.userId,
          req.userRole, req.authSession.id];
        const value = (await client.query(sql, [...identity, ...params])).rows[0]?.value;
        const data = validate(value);
        if (!data) throw new Error('Invalid guarded current backlog result');
        await client.query('COMMIT');
        if (write && value.replayed === true) res.set('Idempotency-Replayed', 'true');
        return res.status(write && value.replayed === false ? 201 : 200)
          .json({ success: true, data });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        if (write && ['40001', '23505'].includes(error?.code) && attempt + 1 < attempts) continue;
        return failure(res, error);
      } finally { if (client) client.release(); }
    }
    return failure(res, { code: '40001' });
  }

  router.post('/snapshots', auth, requirePermission('forecast', 'update'),
    captureThrottle, async (req, res) => {
      const key = req.get('Idempotency-Key');
      if (!exact(req.query, []) || !exact(req.body, []) || !KEY.test(key || '')) return invalid(res);
      return run(req, res, { write: true,
        sql: 'SELECT public.canonical_forecast_current_backlog_snapshot_capture($1,$2,$3,$4,$5,$6) value',
        params: [req.get('X-CSRF-Token'), key], validate(value) {
          if (!value || typeof value.replayed !== 'boolean') return null;
          const snapshot = safeSnapshot(value.snapshot);
          return snapshot && { ...snapshot, replayed: value.replayed };
        } });
    });

  router.get('/snapshots/:snapshotId', auth, requirePermission('forecast', 'read'),
    throttle, async (req, res) => {
      const snapshotId = String(req.params.snapshotId || '').toLowerCase();
      if (!UUID.test(snapshotId) || !exact(req.query, [])) return invalid(res);
      return run(req, res, {
        sql: 'SELECT public.canonical_forecast_current_backlog_snapshot_read($1,$2,$3,$4,$5) value',
        params: [snapshotId], validate: value => safeSnapshot(value, snapshotId),
      });
    });
  return router;
}

module.exports = { createForecastCurrentBacklogRouter, safeSnapshot };
