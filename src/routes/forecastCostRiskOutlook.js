'use strict';

const express = require('express');
const db = require('../db');
const { requireOnboardedInternal } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { rateLimit } = require('../middleware/rateLimit');

const MONEY = /^(?:-?(?:0|[1-9][0-9]{0,14}))\.[0-9]{2}$/;
const UNSIGNED_MONEY = /^(?:0|[1-9][0-9]{0,14})\.[0-9]{2}$/;
const PERCENT = /^(?:-?(?:0|[1-9][0-9]{0,14}))\.[0-9]$/;
const UNSIGNED_PERCENT = /^(?:0|[1-9][0-9]{0,14})\.[0-9]$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;

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

function unavailableFacts(value) {
  return value.costBasis.state === 'unavailable' && value.costBasis.coveredCount === null &&
    value.costBasis.amount === null && value.costBasis.reason === 'current_cost_basis_unavailable' &&
    value.contribution.state === 'unavailable' && value.contribution.amount === null &&
    value.contribution.reason === 'current_cost_basis_unavailable' &&
    value.margin.state === 'unavailable' && value.margin.percent === null &&
    value.margin.reason === 'current_cost_basis_unavailable' &&
    value.concentration.state === 'unavailable' &&
    value.concentration.largestBookedSharePercent === null &&
    value.concentration.largestBookedAmount === null &&
    value.concentration.reason === 'current_booked_work_unavailable';
}

function cents(value) {
  const negative = value.startsWith('-');
  const parts = (negative ? value.slice(1) : value).split('.');
  const amount = BigInt(parts[0]) * 100n + BigInt(parts[1]);
  return negative ? -amount : amount;
}

function ratioTenths(numerator, denominator) {
  if (denominator <= 0n) return null;
  const negative = numerator < 0n;
  const scaled = (negative ? -numerator : numerator) * 1000n;
  let rounded = scaled / denominator;
  if ((scaled % denominator) * 2n >= denominator) rounded += 1n;
  if (negative) rounded = -rounded;
  const absolute = rounded < 0n ? -rounded : rounded;
  return `${rounded < 0n ? '-' : ''}${absolute / 10n}.${absolute % 10n}`;
}

function sanitizeOutlook(value) {
  const keys = ['version', 'state', 'reason', 'fictional', 'checkedAt', 'currency', 'scope',
    'bookedWork', 'costBasis', 'contribution', 'margin', 'concentration', 'underutilization',
    'delays', 'equipmentDowntime', 'companyProfit', 'forecastIssued',
    'automaticActionAuthorized'];
  if (!exact(value, keys) || value.version !== 'm26-cost-risk-outlook-v1' ||
      !['current', 'unavailable'].includes(value.state) || value.fictional !== false ||
      !validInstant(value.checkedAt) || value.forecastIssued !== false ||
      value.automaticActionAuthorized !== false ||
      !exact(value.scope, ['label', 'wholeBusinessCoverageVerified']) ||
      value.scope.label !== 'Current owner-confirmed booked work' ||
      value.scope.wholeBusinessCoverageVerified !== false ||
      !exact(value.bookedWork, ['state', 'count', 'amountBeforeTax']) ||
      !exact(value.costBasis, ['state', 'coveredCount', 'amount', 'reason']) ||
      !exact(value.contribution, ['state', 'amount', 'reason']) ||
      !exact(value.margin, ['state', 'percent', 'reason']) ||
      !exact(value.concentration,
        ['state', 'largestBookedSharePercent', 'largestBookedAmount', 'reason']) ||
      !exact(value.underutilization, ['state', 'location']) ||
      value.underutilization.state !== 'available_elsewhere' ||
      value.underutilization.location !== 'team_capacity' ||
      !exact(value.delays, ['state', 'reason']) || value.delays.state !== 'unavailable' ||
      value.delays.reason !== 'verified_delay_authority_unavailable' ||
      !exact(value.equipmentDowntime, ['state', 'reason']) ||
      value.equipmentDowntime.state !== 'unavailable' ||
      value.equipmentDowntime.reason !== 'verified_downtime_authority_unavailable' ||
      !exact(value.companyProfit, ['state', 'reason']) || value.companyProfit.state !== 'unavailable' ||
      value.companyProfit.reason !== 'complete_overhead_authority_unavailable') return null;
  if (value.state === 'unavailable') {
    if (value.reason !== 'commercial_sources_unavailable' || value.currency !== null ||
        value.bookedWork.state !== 'unavailable' || value.bookedWork.count !== null ||
        value.bookedWork.amountBeforeTax !== null || !unavailableFacts(value)) return null;
    return value;
  }
  if (value.reason !== null || !/^[A-Z]{3}$/.test(value.currency || '') ||
      value.bookedWork.state !== 'current' || !Number.isSafeInteger(value.bookedWork.count) ||
      value.bookedWork.count < 0 || value.bookedWork.count > 1000 ||
      !UNSIGNED_MONEY.test(value.bookedWork.amountBeforeTax || '') ||
      !Number.isSafeInteger(value.costBasis.coveredCount) || value.costBasis.coveredCount < 0 ||
      value.costBasis.coveredCount > value.bookedWork.count) return null;
  const costCurrent = value.costBasis.state === 'current';
  if (costCurrent) {
    if (value.costBasis.reason !== null || value.costBasis.coveredCount !== value.bookedWork.count ||
        !UNSIGNED_MONEY.test(value.costBasis.amount || '') ||
        value.contribution.state !== 'current' || value.contribution.reason !== null ||
        !MONEY.test(value.contribution.amount || '') ||
        cents(value.contribution.amount) !== cents(value.bookedWork.amountBeforeTax) -
          cents(value.costBasis.amount)) return null;
    const marginCurrent = value.margin.state === 'current';
    const bookedCents = cents(value.bookedWork.amountBeforeTax);
    if (bookedCents > 0n ? !marginCurrent || value.margin.reason !== null ||
      !PERCENT.test(value.margin.percent || '') || value.margin.percent !==
        ratioTenths(cents(value.contribution.amount), bookedCents) :
      marginCurrent || value.margin.state !== 'unavailable' || value.margin.percent !== null ||
        value.margin.reason !== 'no_booked_value') return null;
  } else if (value.costBasis.state !== 'unavailable' || value.costBasis.amount !== null ||
      value.costBasis.reason !== 'incomplete_current_cost_basis' ||
      value.contribution.state !== 'unavailable' || value.contribution.amount !== null ||
      value.contribution.reason !== 'incomplete_current_cost_basis' ||
      value.margin.state !== 'unavailable' || value.margin.percent !== null ||
      value.margin.reason !== 'incomplete_current_cost_basis') return null;
  if (value.concentration.state === 'current') {
    const bookedCents = cents(value.bookedWork.amountBeforeTax);
    if (value.concentration.reason !== null ||
        !UNSIGNED_PERCENT.test(value.concentration.largestBookedSharePercent || '') ||
        !UNSIGNED_MONEY.test(value.concentration.largestBookedAmount || '') ||
        value.bookedWork.count < 1 || bookedCents <= 0n ||
        cents(value.concentration.largestBookedAmount) > bookedCents ||
        value.concentration.largestBookedSharePercent !== ratioTenths(
          cents(value.concentration.largestBookedAmount), bookedCents)) return null;
  } else if (value.concentration.state !== 'none' ||
      value.bookedWork.amountBeforeTax !== '0.00' ||
      value.concentration.reason !== null || value.concentration.largestBookedSharePercent !== '0.0' ||
      value.concentration.largestBookedAmount !== '0.00') return null;
  return value;
}

function failure(res, error) {
  const code = error?.code;
  const status = code === '42501' ? 403 : code === '22023' || code === '22P02' ? 400 :
    ['40001', '40P01', '55P03'].includes(code) ? 409 : 503;
  return res.status(status).json({ success: false, error: {
    category: status === 403 ? 'COST_RISK_RESTRICTED' :
      status === 400 ? 'COST_RISK_REQUEST_INVALID' :
        status === 409 ? 'COST_RISK_CHANGED' : 'COST_RISK_UNAVAILABLE',
    message: status === 403 ? 'You cannot view this insight.' :
      status === 400 ? 'Check the request and try again.' :
        status === 409 ? 'The insight changed. Refresh and try again.' :
          'The insight is temporarily unavailable.',
  } });
}

function createForecastCostRiskOutlookRouter(options = {}) {
  const router = express.Router();
  const poolProvider = options.poolProvider || (() => db.getPool());
  const auth = options.auth || requireOnboardedInternal;
  const permission = options.permission || requirePermission('forecast', 'read');
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `forecast-cost-risk-outlook:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
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
        'SELECT public.canonical_forecast_cost_risk_outlook_current($1,$2,$3,$4) value',
        identity)).rows[0]?.value;
      const value = sanitizeOutlook(raw);
      if (!value) throw new Error('Invalid cost and risk outlook projection');
      await client.query('COMMIT');
      return res.status(200).json({ success: true, data: value });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return failure(res, error);
    } finally { if (client) client.release(); }
  });
  return router;
}

module.exports = { createForecastCostRiskOutlookRouter, sanitizeOutlook };
