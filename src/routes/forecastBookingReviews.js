'use strict';

const express = require('express');
const db = require('../db');
const { requireOnboardedInternal } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { rateLimit } = require('../middleware/rateLimit');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const KEY = /^[A-Za-z0-9._:-]{16,128}$/;

function invalid(res) {
  return res.status(400).json({ success: false, error: {
    category: 'FORECAST_REVIEW_REQUEST_INVALID',
    message: 'Check the review details and try again.',
  } });
}

function failure(res, error) {
  const status = error?.code === '42501' ? 403 :
    error?.code === '22023' ? 400 :
      ['23505', '40001', '40P01', '55P03'].includes(error?.code) ? 409 : 503;
  return res.status(status).json({ success: false, error: {
    category: status === 403 ? 'FORECAST_REVIEW_RESTRICTED' :
      status === 400 ? 'FORECAST_REVIEW_REQUEST_INVALID' :
        error?.code === '23505' ? 'FORECAST_REVIEW_REQUEST_REUSED' :
          error?.code === '55P03' || error?.code === '40P01' ?
            'FORECAST_REVIEW_BUSY' :
            status === 409 ? 'FORECAST_REVIEW_CHANGED' : 'FORECAST_REVIEW_UNAVAILABLE',
    message: status === 403 ? 'You cannot make this review.' :
      status === 400 ? 'Check the review details and try again.' :
        error?.code === '23505' ?
          'This request was already used with different details. Start a new request.' :
          error?.code === '55P03' || error?.code === '40P01' ?
            'The review is busy. Try again shortly.' :
            status === 409 ? 'The review changed. Refresh and try again.' :
              'The review is temporarily unavailable.',
  } });
}

function createForecastBookingReviewsRouter(options = {}) {
  const router = express.Router();
  const poolProvider = options.poolProvider || (() => db.getPool());
  const auth = options.auth || requireOnboardedInternal;
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `forecast-booking-reviews:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('Referrer-Policy', 'no-referrer');
    res.vary('Cookie');
    next();
  });

  async function query(req, res, sql, params, write) {
    let client;
    try {
      client = await poolProvider().connect();
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      const identity = [req.tenantContext.organizationId, req.tenantContext.userId,
        req.userRole, req.authSession.id];
      const value = (await client.query(sql, [...identity, ...params])).rows[0]?.value;
      if (!value || value.forecastIssued !== false ||
          value.bookedWorkVerified !== false || typeof value.state !== 'string') {
        throw new Error('Invalid guarded commercial review result');
      }
      const position = value.state === 'owner_reviewed_booking_candidate';
      if (position && (value.ownerAttestationCurrentAtRead !== true ||
          value.commercialStatus !== 'owner_reviewed_booking' ||
          !/^(0|[1-9][0-9]{0,11})\.[0-9]{2}$/.test(value.reviewedPriceBeforeTax || '') ||
          !/^[A-Z]{3}$/.test(value.currency || '') ||
          !UUID.test(value.reviewId || ''))) {
        throw new Error('Invalid guarded owner-reviewed price position');
      }
      await client.query('COMMIT');
      if (write && value.replayed === true) res.set('Idempotency-Replayed', 'true');
      return res.status(write && value.replayed === false && value.id ? 201 : 200)
        .json({ success: true, data: {
          state: value.state, reviewId: value.id || value.reviewId || null,
          previousReviewId: value.previousReviewId || null,
          replayed: value.replayed === true,
          reviewCurrentAtRead: value.reviewCurrentAtRead === true,
          schedulingNeedsReview: value.schedulingNeedsReview === true,
          ...(position ? { commercialStatus: value.commercialStatus,
            reviewedPriceBeforeTax: value.reviewedPriceBeforeTax,
            currency: value.currency, ownerAttestationCurrentAtRead: true,
            historicalCoverageVerified: false,
            earnedRevenueMeasured: false, collectedCashMeasured: false } : {}),
          bookedWorkVerified: false, forecastIssued: false,
        } });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return failure(res, error);
    } finally { if (client) client.release(); }
  }

  async function confirmationQuery(req, res, sql, params, write) {
    let client;
    try {
      client = await poolProvider().connect();
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      const identity = [req.tenantContext.organizationId, req.tenantContext.userId,
        req.userRole, req.authSession.id];
      const value = (await client.query(sql, [...identity, ...params])).rows[0]?.value;
      const current = value?.state === 'owner_confirmed_booked_work_current';
      if (!value || value.forecastIssued !== false || typeof value.state !== 'string' ||
          (current && (write || value.bookedWorkVerified !== true ||
            value.commercialStatus !== 'owner_confirmed_booked' ||
            value.authority !== 'paid_owner_or_admin_confirmation' ||
            value.historicalCoverageVerified !== false ||
            value.wholeBusinessCoverageVerified !== false ||
            value.earnedRevenueMeasured !== false ||
            value.collectedCashMeasured !== false ||
            !UUID.test(value.confirmationId || '') ||
            !UUID.test(value.reviewId || '') ||
            !UUID.test(value.appointmentId || '') ||
            !/^(0|[1-9][0-9]{0,11})\.[0-9]{2}$/.test(value.priceBeforeTax || '') ||
            !/^[A-Z]{3}$/.test(value.currency || ''))) ||
          (!current && value.bookedWorkVerified !== false &&
            value.state !== 'booking_confirmation_recorded') ||
          (write && value.state === 'booking_confirmation_recorded' &&
            (!UUID.test(value.id || '') || !UUID.test(value.reviewId || '') ||
              value.currentnessUnknown !== true))) {
        throw new Error('Invalid guarded booked-work confirmation result');
      }
      await client.query('COMMIT');
      if (write && value.replayed === true) res.set('Idempotency-Replayed', 'true');
      return res.status(write && value.replayed === false && value.id ? 201 : 200)
        .json({ success: true, data: current ? {
          state: value.state, confirmationId: value.confirmationId,
          reviewId: value.reviewId, appointmentId: value.appointmentId,
          commercialStatus: value.commercialStatus,
          priceBeforeTax: value.priceBeforeTax, currency: value.currency,
          authority: value.authority, bookedWorkVerified: true,
          historicalCoverageVerified: false, wholeBusinessCoverageVerified: false,
          earnedRevenueMeasured: false, collectedCashMeasured: false,
          forecastIssued: false,
        } : {
          state: value.state, confirmationId: value.id || null,
          reviewId: value.reviewId || null,
          replayed: value.replayed === true,
          currentnessUnknown: value.currentnessUnknown === true,
          bookedWorkVerified: false, forecastIssued: false,
        } });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return failure(res, error);
    } finally { if (client) client.release(); }
  }

  router.post('/first', auth, requirePermission('forecast', 'update'), throttle,
    async (req, res) => {
      const body = req.body;
      const key = req.get('Idempotency-Key');
      if (!body || Array.isArray(body) ||
          Object.keys(body).sort().join(',') !== 'approvalId,reason' ||
          typeof body.approvalId !== 'string' || !UUID.test(body.approvalId) ||
          typeof body.reason !== 'string' || body.reason.trim().length < 10 ||
          body.reason.trim().length > 1000 || Buffer.byteLength(body.reason) > 4000 ||
          !KEY.test(key || '')) return invalid(res);
      return query(req, res,
        'SELECT public.canonical_forecast_review_first_booking($1,$2,$3,$4,$5,$6,$7,$8) value',
        [body.approvalId, body.reason, key, req.get('X-CSRF-Token')], true);
    });

  router.post('/:reviewId/cancel', auth, requirePermission('forecast', 'update'), throttle,
    async (req, res) => {
      const body = req.body;
      const key = req.get('Idempotency-Key');
      if (!UUID.test(req.params.reviewId || '') || !body || Array.isArray(body) ||
          Object.keys(body).sort().join(',') !== 'reason' ||
          typeof body.reason !== 'string' || body.reason.trim().length < 10 ||
          body.reason.trim().length > 1000 || Buffer.byteLength(body.reason) > 4000 ||
          !KEY.test(key || '')) return invalid(res);
      return query(req, res,
        'SELECT public.canonical_forecast_cancel_booking_review($1,$2,$3,$4,$5,$6,$7,$8) value',
        [req.params.reviewId, body.reason, key, req.get('X-CSRF-Token')], true);
    });

  router.post('/:reviewId/correct', auth, requirePermission('forecast', 'update'), throttle,
    async (req, res) => {
      const body = req.body;
      const key = req.get('Idempotency-Key');
      if (!UUID.test(req.params.reviewId || '') || !body || Array.isArray(body) ||
          Object.keys(body).sort().join(',') !== 'approvalId,reason' ||
          typeof body.approvalId !== 'string' || !UUID.test(body.approvalId) ||
          typeof body.reason !== 'string' || body.reason.trim().length < 10 ||
          body.reason.trim().length > 1000 || Buffer.byteLength(body.reason) > 4000 ||
          !KEY.test(key || '')) return invalid(res);
      return query(req, res,
        'SELECT public.canonical_forecast_correct_booking_review($1,$2,$3,$4,$5,$6,$7,$8,$9) value',
        [req.params.reviewId, body.approvalId, body.reason, key,
          req.get('X-CSRF-Token')], true);
    });

  router.post('/:reviewId/confirm-booked', auth, requirePermission('forecast', 'update'), throttle,
    async (req, res) => {
      const body = req.body;
      const key = req.get('Idempotency-Key');
      if (!UUID.test(req.params.reviewId || '') || !body || Array.isArray(body) ||
          Object.keys(body).sort().join(',') !== 'confirmationVersion,confirmed,reason' ||
          body.confirmed !== true ||
          body.confirmationVersion !== 'owner-booked-work-confirm-v1' ||
          typeof body.reason !== 'string' || body.reason.trim().length < 10 ||
          body.reason.trim().length > 1000 || Buffer.byteLength(body.reason) > 4000 ||
          !KEY.test(key || '')) return invalid(res);
      return confirmationQuery(req, res,
        'SELECT public.canonical_forecast_confirm_booked_work($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) value',
        [req.params.reviewId, req.get('X-CSRF-Token'), key, body.reason,
          true, body.confirmationVersion], true);
    });

  router.get('/confirmations/:confirmationId/currentness', auth,
    requirePermission('forecast', 'read'), throttle, async (req, res) => {
      if (!UUID.test(req.params.confirmationId || '')) return invalid(res);
      return confirmationQuery(req, res,
        'SELECT public.canonical_forecast_booked_work_confirmation_currentness($1,$2,$3,$4,$5) value',
        [req.params.confirmationId], false);
    });

  router.get('/booked-work/months/:month/observed', auth,
    requirePermission('forecast', 'read'), throttle, async (req, res) => {
      if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(req.params.month || '') ||
          req.params.month.startsWith('0000')) return invalid(res);
      let client;
      try {
        client = await poolProvider().connect();
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        const value = (await client.query(
          'SELECT public.canonical_forecast_booked_work_month_observed($1,$2,$3,$4,$5) value',
          [req.tenantContext.organizationId, req.tenantContext.userId,
            req.userRole, req.authSession.id, req.params.month])).rows[0]?.value;
        const observed = value?.state === 'observed_owner_confirmed_jobs';
        if (!value || value.forecastIssued !== false ||
            value.completePeriodVerified !== false || value.month !== req.params.month ||
            (observed && (value.includedJobConfirmationsVerified !== true ||
              value.wholeBusinessCoverageVerified !== false ||
              value.earnedRevenueMeasured !== false ||
              value.collectedCashMeasured !== false ||
              value.timeZone !== 'UTC' || !Number.isInteger(value.confirmedJobCount) ||
              value.confirmedJobCount < 1 || value.confirmedJobCount > 100 ||
              !/^(0|[1-9][0-9]{0,14})\.[0-9]{2}$/.test(value.observedBeforeTax || '') ||
              !/^[A-Z]{3}$/.test(value.currency || ''))) ||
            (!observed && (value.state !== 'booked_work_month_unavailable' ||
              typeof value.reason !== 'string' ||
              value.observedBeforeTax !== undefined))) {
          throw new Error('Invalid guarded observed booked-work month result');
        }
        await client.query('COMMIT');
        return res.status(200).json({ success: true, data: observed ? {
          state: value.state, month: value.month, timeZone: 'UTC',
          confirmedJobCount: value.confirmedJobCount,
          observedBeforeTax: value.observedBeforeTax, currency: value.currency,
          includedJobConfirmationsVerified: true, completePeriodVerified: false,
          wholeBusinessCoverageVerified: false, earnedRevenueMeasured: false,
          collectedCashMeasured: false, forecastIssued: false,
        } : {
          state: value.state, month: value.month, reason: value.reason,
          completePeriodVerified: false, forecastIssued: false,
        } });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        return failure(res, error);
      } finally { if (client) client.release(); }
    });

  router.post('/booked-work/source-anchor', auth,
    requirePermission('forecast', 'update'), throttle, async (req, res) => {
      const body = req.body;
      const key = req.get('Idempotency-Key');
      if (!body || Array.isArray(body) ||
          Object.keys(body).sort().join(',') !== 'confirmationVersion,confirmed,reason' ||
          body.confirmed !== true ||
          body.confirmationVersion !== 'booked-work-source-anchor-v1' ||
          typeof body.reason !== 'string' || body.reason.trim().length < 10 ||
          body.reason.trim().length > 1000 || Buffer.byteLength(body.reason) > 4000 ||
          !KEY.test(key || '')) return invalid(res);
      let client;
      try {
        client = await poolProvider().connect();
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        const value = (await client.query(
          'SELECT public.canonical_forecast_capture_booked_work_anchor($1,$2,$3,$4,$5,$6,$7,$8,$9) value',
          [req.tenantContext.organizationId, req.tenantContext.userId,
            req.userRole, req.authSession.id, req.get('X-CSRF-Token'),
            key, body.reason, true, body.confirmationVersion])).rows[0]?.value;
        if (!value || !['booked_work_source_anchored',
          'booked_work_source_already_anchored'].includes(value.state) ||
          !UUID.test(value.anchorId || '') ||
          typeof value.coverageStartsAt !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}T/.test(value.coverageStartsAt) ||
          value.completePeriodVerified !== false || value.forecastIssued !== false) {
          throw new Error('Invalid guarded booked-work source anchor');
        }
        await client.query('COMMIT');
        if (value.replayed === true) res.set('Idempotency-Replayed', 'true');
        return res.status(value.state === 'booked_work_source_anchored' &&
          value.replayed === false ? 201 : 200).json({ success: true, data: {
          state: value.state, anchorId: value.anchorId,
          coverageStartsAt: value.coverageStartsAt,
          replayed: value.replayed === true,
          completePeriodVerified: false, forecastIssued: false,
        } });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        return failure(res, error);
      } finally { if (client) client.release(); }
    });

  router.get('/booked-work/months/:month/source', auth,
    requirePermission('forecast', 'read'), throttle, async (req, res) => {
      if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(req.params.month || '') ||
          req.params.month.startsWith('0000')) return invalid(res);
      let client;
      try {
        client = await poolProvider().connect();
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        const value = (await client.query(
          'SELECT public.canonical_forecast_booked_work_source_month($1,$2,$3,$4,$5) value',
          [req.tenantContext.organizationId, req.tenantContext.userId,
            req.userRole, req.authSession.id, req.params.month])).rows[0]?.value;
        const current = value?.state === 'northstar_confirmation_source_month_current';
        if (!value || value.forecastIssued !== false ||
            value.completePeriodVerified !== false || value.month !== req.params.month ||
            (current && (value.sourceMonthCoverageVerified !== true ||
              value.wholeBusinessCoverageVerified !== false ||
              value.earnedRevenueMeasured !== false ||
              value.collectedCashMeasured !== false ||
              !UUID.test(value.anchorId || '') || value.timeZone !== 'UTC' ||
              !Number.isInteger(value.confirmedJobCount) ||
              value.confirmedJobCount < 1 || value.confirmedJobCount > 100 ||
              !/^(0|[1-9][0-9]{0,14})\.[0-9]{2}$/.test(value.currentConfirmedBeforeTax || '') ||
              !/^[A-Z]{3}$/.test(value.currency || ''))) ||
            (!current && (value.state !== 'booked_work_source_month_unavailable' ||
              value.sourceMonthCoverageVerified !== false ||
              typeof value.reason !== 'string' ||
              value.currentConfirmedBeforeTax !== undefined))) {
          throw new Error('Invalid guarded booked-work source month');
        }
        await client.query('COMMIT');
        return res.status(200).json({ success: true, data: current ? {
          state: value.state, month: value.month, timeZone: 'UTC',
          anchorId: value.anchorId, coverageStartsAt: value.coverageStartsAt,
          confirmedJobCount: value.confirmedJobCount,
          currentConfirmedBeforeTax: value.currentConfirmedBeforeTax,
          currency: value.currency, sourceMonthCoverageVerified: true,
          completePeriodVerified: false, wholeBusinessCoverageVerified: false,
          earnedRevenueMeasured: false, collectedCashMeasured: false,
          forecastIssued: false,
        } : {
          state: value.state, reason: value.reason, month: value.month,
          sourceMonthCoverageVerified: false,
          completePeriodVerified: false, forecastIssued: false,
        } });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        return failure(res, error);
      } finally { if (client) client.release(); }
    });

  router.get('/:reviewId/currentness', auth, requirePermission('forecast', 'read'), throttle,
    async (req, res) => {
      if (!UUID.test(req.params.reviewId || '')) return invalid(res);
      return query(req, res,
        'SELECT public.canonical_forecast_commercial_review_currentness($1,$2,$3,$4,$5) value',
        [req.params.reviewId], false);
    });
  router.get('/:reviewId/position', auth, requirePermission('forecast', 'read'), throttle,
    async (req, res) => {
      if (!UUID.test(req.params.reviewId || '')) return invalid(res);
      return query(req, res,
        'SELECT public.canonical_forecast_owner_reviewed_booking_position($1,$2,$3,$4,$5) value',
        [req.params.reviewId], false);
    });
  return router;
}

module.exports = { createForecastBookingReviewsRouter };
