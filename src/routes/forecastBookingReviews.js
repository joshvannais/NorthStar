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
      await client.query('COMMIT');
      if (write && value.replayed === true) res.set('Idempotency-Replayed', 'true');
      return res.status(write && value.replayed === false && value.id ? 201 : 200)
        .json({ success: true, data: {
          state: value.state, reviewId: value.id || value.reviewId || null,
          previousReviewId: value.previousReviewId || null,
          replayed: value.replayed === true,
          reviewCurrentAtRead: value.reviewCurrentAtRead === true,
          schedulingNeedsReview: value.schedulingNeedsReview === true,
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

  router.get('/:reviewId/currentness', auth, requirePermission('forecast', 'read'), throttle,
    async (req, res) => {
      if (!UUID.test(req.params.reviewId || '')) return invalid(res);
      return query(req, res,
        'SELECT public.canonical_forecast_commercial_review_currentness($1,$2,$3,$4,$5) value',
        [req.params.reviewId], false);
    });
  return router;
}

module.exports = { createForecastBookingReviewsRouter };
