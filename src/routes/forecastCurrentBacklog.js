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

function failure(res, error, overflow = false) {
  const status = error?.code === '42501' ? 403 : error?.code === '22023' ? 400 :
    ['23505', '40001', '40P01', '55P03'].includes(error?.code) ? 409 : 503;
  const busy = ['40001', '40P01', '55P03', '57014'].includes(error?.code);
  const category = status === 403 ? 'FORECAST_CURRENT_BACKLOG_RESTRICTED' :
    status === 400 ? 'FORECAST_CURRENT_BACKLOG_REQUEST_INVALID' :
      error?.code === '23505' ? 'FORECAST_CURRENT_BACKLOG_REQUEST_REUSED' :
        overflow && error?.code === '54000' ? 'FORECAST_CURRENT_BACKLOG_OVERSIZED' :
        busy ? 'FORECAST_CURRENT_BACKLOG_BUSY' :
          status === 409 ? 'FORECAST_CURRENT_BACKLOG_CHANGED' :
            'FORECAST_CURRENT_BACKLOG_UNAVAILABLE';
  const message = status === 403 ? 'You cannot access this current backlog position.' :
    status === 400 ? 'Check the current backlog request and try again.' :
      error?.code === '23505' ?
        'This request was already used with different details. Start a new request.' :
        overflow && error?.code === '54000' ?
          'Current backlog exceeds a supported review or response-size limit.' :
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
      !(value.plannedPersonMinutes === null ||
        /^(?:0|[1-9][0-9]{0,13})(?:\.[0-9]{1,6})?$/.test(value.plannedPersonMinutes)) ||
      !['available', 'unavailable'].includes(value.backlogHoursState) ||
      !(value.backlogHoursReason === null || [
        'approved_person_hour_plan_missing', 'no_active_backlog',
        'unresolved_linkage_present', 'reviewed_person_hour_plan_missing',
        'reviewed_person_hour_plan_not_current', 'source_changed_after_capture',
      ].includes(value.backlogHoursReason)) ||
      !(value.sourceDigest === null || DIGEST.test(value.sourceDigest)) ||
      !(value.snapshotDigest === null || DIGEST.test(value.snapshotDigest)) ||
      value.sourceAuthority !==
        'northstar_authenticated_booking_schedule_and_execution_current_position' ||
      typeof value.sourceAuthenticated !== 'boolean' || value.knownSubsetOnly !== true ||
      value.sourceCoverageComplete !== false || value.offPlatformCoverageVerified !== false ||
      value.providerCoverageVerified !== false || value.probabilityCalibrated !== false ||
      value.forecastIssued !== false || value.paidNumericServing !== false ||
      (expectedId !== null && value.id !== expectedId)) return null;
  if (value.backlogHoursState === 'available' &&
      (value.plannedPersonMinutes === null || Number(value.plannedPersonMinutes) <= 0 ||
       value.backlogHoursReason !== null)) return null;
  if (value.backlogHoursState === 'unavailable' &&
      (value.plannedPersonMinutes !== null || value.backlogHoursReason === null)) return null;
  const total = value.approvedUnscheduledCount + value.approvedScheduledCount +
    value.workInProgressCount + value.completedCount + value.unresolvedLinkageCount;
  const descriptiveHoursValid = value.backlogHoursState === 'available' ?
    value.plannedPersonMinutes !== null && Number(value.plannedPersonMinutes) > 0 &&
      value.backlogHoursReason === null :
    value.plannedPersonMinutes === null && [
      'approved_person_hour_plan_missing', 'no_active_backlog',
      'reviewed_person_hour_plan_missing', 'reviewed_person_hour_plan_not_current',
    ].includes(value.backlogHoursReason);
  if (value.state === 'descriptive_subset' && (value.reason !== null || total < 1 ||
      value.unresolvedLinkageCount !== 0 || !value.sourceAuthenticated ||
      !value.sourceDigest || !value.snapshotDigest || !descriptiveHoursValid)) return null;
  if (value.state === 'partial' && (value.reason !== 'unresolved_linkage_present' ||
      value.unresolvedLinkageCount < 1 || !value.sourceAuthenticated ||
      !value.sourceDigest || !value.snapshotDigest || value.plannedPersonMinutes !== null ||
      value.backlogHoursState !== 'unavailable' ||
      value.backlogHoursReason !== 'unresolved_linkage_present')) return null;
  if (value.state === 'unavailable' &&
      (value.reason !== 'no_authenticated_approved_booking_history' || total !== 0 ||
       !value.sourceAuthenticated || !value.sourceDigest || !value.snapshotDigest ||
       value.plannedPersonMinutes !== null || value.backlogHoursState !== 'unavailable' ||
       !['approved_person_hour_plan_missing', 'no_active_backlog']
         .includes(value.backlogHoursReason))) return null;
  if (value.state === 'source_stale' &&
      (value.reason !== 'source_changed_after_capture' || total !== 0 ||
       value.sourceAuthenticated || value.sourceDigest !== null ||
       value.snapshotDigest !== null || value.backlogHoursState !== 'unavailable' ||
       value.backlogHoursReason !== 'source_changed_after_capture' ||
       value.plannedPersonMinutes !== null)) return null;
  return value;
}

function safePersonPlanReview(value, expectedAppointmentId = null) {
  const keys = ['id', 'appointmentId', 'revision', 'previousId', 'action', 'state',
    'plannedPersonMinutes', 'reason', 'createdAt', 'digest', 'sourceAuthority',
    'sourceAuthenticated', 'sourceCurrent', 'knownSubsetOnly',
    'sourceCoverageComplete', 'offPlatformCoverageVerified',
    'providerCoverageVerified', 'forecastIssued', 'paidNumericServing'];
  if (!exact(value, keys) || !UUID.test(value.id || '') ||
      !UUID.test(value.appointmentId || '') ||
      !Number.isSafeInteger(value.revision) || value.revision < 1 ||
      value.revision > 10000 ||
      !(value.previousId === null || UUID.test(value.previousId)) ||
      !['approve', 'withdraw'].includes(value.action) ||
      !['approved', 'withdrawn', 'source_stale'].includes(value.state) ||
      !(value.plannedPersonMinutes === null ||
        /^(?:0|[1-9][0-9]{0,13})(?:\.[0-9]{1,6})?$/.test(value.plannedPersonMinutes)) ||
      typeof value.reason !== 'string' || value.reason.length < 1 ||
      value.reason.length > 2000 || !instant(value.createdAt) ||
      !DIGEST.test(value.digest || '') || value.sourceAuthority !==
        'owner_reviewed_m24_labor_plan_for_authenticated_booking' ||
      typeof value.sourceAuthenticated !== 'boolean' ||
      typeof value.sourceCurrent !== 'boolean' || value.knownSubsetOnly !== true ||
      value.sourceCoverageComplete !== false ||
      value.offPlatformCoverageVerified !== false ||
      value.providerCoverageVerified !== false || value.forecastIssued !== false ||
      value.paidNumericServing !== false || (expectedAppointmentId !== null &&
        value.appointmentId !== expectedAppointmentId)) return null;
  if (value.state === 'approved' && (value.action !== 'approve' ||
      value.plannedPersonMinutes === null || Number(value.plannedPersonMinutes) <= 0 ||
      !value.sourceAuthenticated || !value.sourceCurrent)) return null;
  if (value.state === 'withdrawn' && (value.action !== 'withdraw' ||
      value.plannedPersonMinutes !== null || !value.sourceAuthenticated ||
      !value.sourceCurrent)) return null;
  if (value.state === 'source_stale' && (value.action !== 'approve' ||
      value.plannedPersonMinutes !== null || value.sourceAuthenticated ||
      value.sourceCurrent)) return null;
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
  const reviewThrottle = options.reviewThrottle || rateLimit('forecast-source-review', req =>
    `forecast-current-backlog-review:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);

  router.use((_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('Referrer-Policy', 'no-referrer');
    res.vary('Cookie');
    next();
  });

  async function run(req, res, { write = false, overflow = false, sql, params, validate }) {
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
        return failure(res, error, overflow);
      } finally { if (client) client.release(); }
    }
    return failure(res, { code: '40001' }, overflow);
  }

  router.post('/snapshots', auth, requirePermission('forecast', 'update'),
    captureThrottle, async (req, res) => {
      const key = req.get('Idempotency-Key');
      if (!exact(req.query, []) || !exact(req.body, []) || !KEY.test(key || '')) return invalid(res);
      return run(req, res, { write: true, overflow: true,
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

  router.post('/person-plan-sources/:appointmentId/reviews', auth,
    requirePermission('forecast', 'update'), reviewThrottle, async (req, res) => {
      const appointmentId = String(req.params.appointmentId || '').toLowerCase();
      const body = req.body, key = req.get('Idempotency-Key');
      const keys = ['action', 'expectedCurrentReviewId',
        'expectedCurrentReviewDigest', 'assignmentId',
        'expectedAssignmentRevision', 'expectedAssignmentDigest', 'estimateId',
        'laborPlanId', 'expectedLaborPlanRevision', 'expectedLaborPlanDigest',
        'reason', 'confirmed', 'confirmationVersion'];
      const approve = body?.action === 'approve';
      const uuidOrNull = value => value === null || UUID.test(value || '');
      const digestOrNull = value => value === null || DIGEST.test(value || '');
      if (!UUID.test(appointmentId) || !exact(req.query, []) || !exact(body, keys) ||
          !['approve', 'withdraw'].includes(body.action) ||
          !uuidOrNull(body.expectedCurrentReviewId) ||
          !((body.expectedCurrentReviewId === null &&
            body.expectedCurrentReviewDigest === 'none') ||
            (body.expectedCurrentReviewId !== null &&
              DIGEST.test(body.expectedCurrentReviewDigest || ''))) ||
          !uuidOrNull(body.assignmentId) || !digestOrNull(body.expectedAssignmentDigest) ||
          !uuidOrNull(body.estimateId) || !uuidOrNull(body.laborPlanId) ||
          !digestOrNull(body.expectedLaborPlanDigest) ||
          !(body.expectedAssignmentRevision === null ||
            Number.isSafeInteger(body.expectedAssignmentRevision)) ||
          !(body.expectedLaborPlanRevision === null ||
            Number.isSafeInteger(body.expectedLaborPlanRevision)) ||
          (approve && (body.assignmentId === null || body.estimateId === null ||
            body.laborPlanId === null || body.expectedAssignmentRevision < 1 ||
            body.expectedLaborPlanRevision < 1 ||
            body.expectedAssignmentDigest === null ||
            body.expectedLaborPlanDigest === null)) ||
          (!approve && [body.assignmentId, body.expectedAssignmentRevision,
            body.expectedAssignmentDigest, body.estimateId, body.laborPlanId,
            body.expectedLaborPlanRevision, body.expectedLaborPlanDigest]
            .some(value => value !== null)) || body.confirmed !== true ||
          body.confirmationVersion !== 'm26-current-backlog-person-plan-v1' ||
          typeof body.reason !== 'string' || body.reason.length < 1 ||
          body.reason.length > 2000 || !KEY.test(key || '')) return invalid(res);
      return run(req, res, { write: true,
        sql: 'SELECT public.canonical_forecast_backlog_person_plan_mutate($1,$2,$3,$4,$5,$6,$7,$8) value',
        params: [req.get('X-CSRF-Token'), key, appointmentId, body],
        validate(value) {
          if (!value || typeof value.replayed !== 'boolean') return null;
          const review = safePersonPlanReview(value.review, appointmentId);
          return review && { review, replayed: value.replayed };
        } });
    });

  router.get('/person-plan-sources/:appointmentId/reviews', auth,
    requirePermission('forecast', 'read'), throttle, async (req, res) => {
      const appointmentId = String(req.params.appointmentId || '').toLowerCase();
      if (!UUID.test(appointmentId) || !exact(req.query, [])) return invalid(res);
      return run(req, res, {
        sql: 'SELECT public.canonical_forecast_backlog_person_plan_read($1,$2,$3,$4,$5) value',
        params: [appointmentId], validate(value) {
          if (!exact(value, ['current', 'history', 'total', 'truncated', 'boundary']) ||
              !(value.current === null || safePersonPlanReview(value.current, appointmentId)) ||
              !Array.isArray(value.history) || value.history.length > 20 ||
              !value.history.every(item => safePersonPlanReview(item, appointmentId)) ||
              !Number.isSafeInteger(value.total) || value.total < value.history.length ||
              value.truncated !== (value.total > 20) ||
              typeof value.boundary !== 'string' || value.boundary.length < 1) return null;
          return value;
        } });
    });
  return router;
}

module.exports = { createForecastCurrentBacklogRouter, safeSnapshot, safePersonPlanReview };
