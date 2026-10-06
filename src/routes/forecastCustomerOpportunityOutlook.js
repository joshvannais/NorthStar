'use strict';

const express = require('express');
const db = require('../db');
const { requireOnboardedInternal } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { rateLimit } = require('../middleware/rateLimit');

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
const ACTIONS = Object.freeze({
  estimate_review: 'Review estimate requests',
  lead_review: 'Review open leads',
  customer_review: 'Review customers',
});

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

function count(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 500;
}

function sanitizeOutlook(value) {
  const top = ['version', 'state', 'reason', 'fictional', 'checkedAt', 'scope', 'customers',
    'opportunities', 'qualification', 'estimateRequests', 'recommendedAction',
    'probabilityCalibrated', 'forecastIssued', 'automaticActionAuthorized'];
  if (!exact(value, top) || value.version !== 'm26-customer-opportunity-outlook-v1' ||
      !['current', 'unavailable'].includes(value.state) || typeof value.fictional !== 'boolean' ||
      !validInstant(value.checkedAt) ||
      !exact(value.scope, ['label', 'wholeBusinessCoverageVerified', 'providerCoverageVerified',
        'offPlatformCoverageVerified']) ||
      value.scope.wholeBusinessCoverageVerified !== false ||
      value.scope.providerCoverageVerified !== false || value.scope.offPlatformCoverageVerified !== false ||
      !exact(value.customers, ['count', 'returningCount']) ||
      !exact(value.opportunities, ['count', 'reviewedCount', 'unreviewedCount']) ||
      !exact(value.qualification, ['open', 'qualified', 'unqualified', 'closed']) ||
      !exact(value.estimateRequests, ['open', 'requested', 'withdrawn', 'closed',
        'unreviewed', 'qualifiedNeedsReview']) ||
      !exact(value.recommendedAction, ['key', 'label', 'href']) ||
      !Object.prototype.hasOwnProperty.call(ACTIONS, value.recommendedAction.key) ||
      value.recommendedAction.label !== ACTIONS[value.recommendedAction.key] ||
      value.recommendedAction.href !== '/dashboard/leads' || value.probabilityCalibrated !== false ||
      value.forecastIssued !== false || value.automaticActionAuthorized !== false) return null;
  if (value.state === 'unavailable') {
    return value.reason === 'current_source_limit_exceeded' &&
      value.scope.label === 'Current NorthStar-recorded customer and reviewed opportunity records' &&
      Object.values(value.customers).every(item => item === null) &&
      Object.values(value.opportunities).every(item => item === null) &&
      Object.values(value.qualification).every(item => item === null) &&
      Object.values(value.estimateRequests).every(item => item === null) ? value : null;
  }
  if (value.reason !== null || value.scope.label !== (value.fictional ?
      'Fictional demo customer and reviewed opportunity records' :
      'Current NorthStar-recorded customer and reviewed opportunity records')) return null;
  const values = [...Object.values(value.customers), ...Object.values(value.opportunities),
    ...Object.values(value.qualification), ...Object.values(value.estimateRequests)];
  if (!values.every(count) || value.customers.returningCount > value.customers.count ||
      value.opportunities.reviewedCount + value.opportunities.unreviewedCount !==
        value.opportunities.count ||
      Object.values(value.qualification).reduce((sum, item) => sum + item, 0) !==
        value.opportunities.reviewedCount ||
      value.estimateRequests.open + value.estimateRequests.requested +
        value.estimateRequests.withdrawn + value.estimateRequests.closed +
        value.estimateRequests.unreviewed !== value.opportunities.count ||
      value.estimateRequests.qualifiedNeedsReview > value.qualification.qualified) return null;
  const expected = value.estimateRequests.qualifiedNeedsReview > 0 ||
    value.estimateRequests.unreviewed > 0 ? 'estimate_review' :
    value.qualification.open > 0 || value.opportunities.unreviewedCount > 0 ? 'lead_review' :
      'customer_review';
  return value.recommendedAction.key === expected ? value : null;
}

function failure(res, error) {
  const code = error?.code;
  const status = code === '42501' ? 403 : code === '22023' || code === '22P02' ? 400 :
    ['40001', '40P01', '55P03'].includes(code) ? 409 : 503;
  return res.status(status).json({ success: false, error: {
    category: status === 403 ? 'CUSTOMER_OPPORTUNITY_RESTRICTED' :
      status === 400 ? 'CUSTOMER_OPPORTUNITY_REQUEST_INVALID' :
        status === 409 ? 'CUSTOMER_OPPORTUNITY_CHANGED' : 'CUSTOMER_OPPORTUNITY_UNAVAILABLE',
    message: status === 403 ? 'You cannot view this insight.' :
      status === 400 ? 'Check the request and try again.' :
        status === 409 ? 'The insight changed. Refresh and try again.' :
          'The insight is temporarily unavailable.',
  } });
}

function createForecastCustomerOpportunityOutlookRouter(options = {}) {
  const router = express.Router();
  const poolProvider = options.poolProvider || (() => db.getPool());
  const auth = options.auth || requireOnboardedInternal;
  const permission = options.permission || requirePermission('forecast', 'read');
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `forecast-customer-opportunity:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'private, no-store'); res.set('Referrer-Policy', 'no-referrer');
    res.vary('Cookie'); next();
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
        'SELECT public.canonical_forecast_customer_opportunity_outlook_current($1,$2,$3,$4) value',
        identity)).rows[0]?.value;
      const value = sanitizeOutlook(raw);
      if (!value) throw new Error('Invalid customer and opportunity outlook projection');
      await client.query('COMMIT');
      return res.status(200).json({ success: true, data: value });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return failure(res, error);
    } finally { if (client) client.release(); }
  });
  return router;
}

module.exports = { createForecastCustomerOpportunityOutlookRouter, sanitizeOutlook };
