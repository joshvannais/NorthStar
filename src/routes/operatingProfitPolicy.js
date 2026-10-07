'use strict';

const express = require('express');
const db = require('../db');
const { requireOnboardedInternal } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { rateLimit } = require('../middleware/rateLimit');

const DIGEST = /^(?:none|[0-9a-f]{64})$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;

function exact(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key =>
      Object.prototype.hasOwnProperty.call(value, key));
}

function validPolicy(value) {
  if (!exact(value, ['action', 'currency', 'effectiveOn', 'coverage', 'expenses',
    'scenarios', 'schedulePin', 'overlapReview']) ||
      !['replace', 'revoke'].includes(value.action)) return false;
  if (value.action === 'revoke') return value.currency === null && value.effectiveOn === null &&
    value.coverage === null && Array.isArray(value.expenses) && value.expenses.length === 0 &&
    Array.isArray(value.scenarios) && value.scenarios.length === 0 &&
    value.schedulePin === null && value.overlapReview === null;
  const structurallyValid = /^[A-Z]{3}$/.test(value.currency || '') && /^\d{4}-\d{2}-\d{2}$/.test(value.effectiveOn || '') &&
    exact(value.coverage, ['startsOn', 'endsOn', 'recordedThrough', 'complete']) &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.coverage.startsOn || '') &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.coverage.endsOn || '') &&
    value.coverage.endsOn >= value.coverage.startsOn &&
    INSTANT.test(value.coverage.recordedThrough || '') && value.coverage.complete === true &&
    Array.isArray(value.expenses) && value.expenses.length <= 120 && value.expenses.every(expense =>
      exact(expense, ['expenseKey', 'label', 'classification', 'amount',
        'recognitionStartsOn', 'recognitionEndsOn', 'source']) &&
      /^[a-z0-9][a-z0-9._-]{1,63}$/.test(expense.expenseKey || '') &&
      ['fixed_period', 'variable_period'].includes(expense.classification) &&
      /^(?:0|[1-9][0-9]{0,11})\.[0-9]{2}$/.test(expense.amount || '') &&
      /^\d{4}-\d{2}-\d{2}$/.test(expense.recognitionStartsOn || '') &&
      /^\d{4}-\d{2}-\d{2}$/.test(expense.recognitionEndsOn || '') &&
      expense.recognitionStartsOn >= value.coverage.startsOn &&
      expense.recognitionEndsOn <= value.coverage.endsOn &&
      expense.recognitionEndsOn >= expense.recognitionStartsOn &&
      exact(expense.source, ['kind', 'reference', 'documentDigest', 'attestedAt']) &&
      ['owner_attested', 'source_document'].includes(expense.source.kind) &&
      typeof expense.source.reference === 'string' && expense.source.reference.length > 0 &&
      (expense.source.kind === 'owner_attested' ? expense.source.documentDigest === null :
        /^[0-9a-f]{64}$/.test(expense.source.documentDigest || '')) &&
      INSTANT.test(expense.source.attestedAt || '')) &&
    Array.isArray(value.scenarios) && value.scenarios.length >= 2 &&
    value.scenarios.length <= 5 && value.scenarios.every(scenario =>
      exact(scenario, ['key', 'label', 'operatingCostBasisPoints', 'reason']) &&
      /^[a-z][a-z0-9_-]{1,47}$/.test(scenario.key || '') &&
      typeof scenario.label === 'string' && scenario.label.length > 0 &&
      Number.isSafeInteger(scenario.operatingCostBasisPoints) &&
      scenario.operatingCostBasisPoints >= 5000 && scenario.operatingCostBasisPoints <= 15999 &&
      typeof scenario.reason === 'string' && scenario.reason.length > 0) &&
    exact(value.schedulePin, ['revision', 'digest']) &&
    Number.isSafeInteger(value.schedulePin.revision) && value.schedulePin.revision >= 1 &&
    value.schedulePin.revision <= 10000 && /^[0-9a-f]{64}$/.test(value.schedulePin.digest || '') &&
    exact(value.overlapReview, ['status', 'reason']) && value.overlapReview.status === 'reconciled' &&
    typeof value.overlapReview.reason === 'string' && value.overlapReview.reason.length > 0;
  if (!structurallyValid) return false;
  const expenseKeys = value.expenses.map(expense => expense.expenseKey);
  const scenarioKeys = value.scenarios.map(scenario => scenario.key);
  return new Set(expenseKeys).size === expenseKeys.length &&
    new Set(scenarioKeys).size === scenarioKeys.length &&
    value.scenarios.filter(scenario => scenario.key === 'recorded_plan' &&
      scenario.operatingCostBasisPoints === 10000).length === 1;
}

function sanitizePolicy(value) {
  if (!exact(value, ['state', 'revision', 'digest', 'action', 'createdAt', 'policy']) ||
      !['absent', 'current', 'revoked'].includes(value.state) ||
      !Number.isSafeInteger(value.revision) || value.revision < 0 || value.revision > 10000 ||
      !DIGEST.test(value.digest || '')) return null;
  if (value.state === 'absent') return value.revision === 0 && value.digest === 'none' &&
    value.action === null && value.createdAt === null && value.policy === null ? value : null;
  if (!['replace', 'revoke'].includes(value.action) || typeof value.createdAt !== 'string' ||
      !INSTANT.test(value.createdAt) || !validPolicy(value.policy)) return null;
  if (value.state === 'current' && value.action !== 'replace' ||
      value.state === 'revoked' && value.action !== 'revoke') return null;
  return value;
}

function sanitizeReceipt(value) {
  return exact(value, ['revision', 'digest', 'action', 'replayed']) &&
    Number.isSafeInteger(value.revision) && value.revision >= 1 && value.revision <= 10000 &&
    /^[0-9a-f]{64}$/.test(value.digest || '') && ['replace', 'revoke'].includes(value.action) &&
    typeof value.replayed === 'boolean' ? value : null;
}

function failure(res, error) {
  const code = error?.code;
  const status = code === '42501' ? 403 : ['22023', '22P02', '23505'].includes(code) ? 400 :
    ['40001', '40P01', '55P03'].includes(code) ? 409 : 503;
  return res.status(status).json({ success: false, error: {
    category: status === 403 ? 'OPERATING_PROFIT_POLICY_RESTRICTED' :
      status === 400 ? 'OPERATING_PROFIT_POLICY_INVALID' :
        status === 409 ? 'OPERATING_PROFIT_POLICY_CHANGED' : 'OPERATING_PROFIT_POLICY_UNAVAILABLE',
    message: status === 403 ? 'You cannot manage this source.' :
      status === 400 ? 'Review the operating expense policy and try again.' :
        status === 409 ? 'The operating expense source changed. Refresh and review again.' :
          'The operating expense source is temporarily unavailable.',
  } });
}

function createOperatingProfitPolicyRouter(options = {}) {
  const router = express.Router();
  const poolProvider = options.poolProvider || (() => db.getPool());
  const auth = options.auth || requireOnboardedInternal;
  const permission = options.permission || requirePermission('forecast', 'read');
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `operating-profit-policy:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('Referrer-Policy', 'no-referrer');
    res.vary('Cookie');
    next();
  });
  router.get('/', auth, permission, throttle, async (req, res) => {
    if (!exact(req.query, [])) return failure(res, { code: '22023' });
    let client;
    try {
      client = await poolProvider().connect();
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      await client.query("SET LOCAL statement_timeout = '15s'");
      await client.query("SET LOCAL lock_timeout = '2s'");
      const identity = [req.tenantContext.organizationId, req.tenantContext.userId,
        req.userRole, req.authSession.id, null];
      const raw = (await client.query(
        'SELECT public.canonical_operating_profit_policy_read($1,$2,$3,$4,$5) value',
        identity)).rows[0]?.value;
      const value = sanitizePolicy(raw);
      if (!value) throw new Error('Invalid operating-profit policy projection');
      await client.query('COMMIT');
      return res.status(200).json({ success: true, data: value });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return failure(res, error);
    } finally { if (client) client.release(); }
  });
  router.post('/', auth, permission, throttle, async (req, res) => {
    const key = req.get('Idempotency-Key');
    const csrf = req.get('X-CSRF-Token');
    const lockKey = `m26:operating-profit-policy:${req.tenantContext.organizationId}`;
    let client; let locked = false;
    try {
      client = await poolProvider().connect();
      await client.query("SET statement_timeout = '15s'");
      await client.query("SET lock_timeout = '2s'");
      await client.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [lockKey]);
      locked = true;
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await client.query("SET LOCAL statement_timeout = '15s'");
      await client.query("SET LOCAL lock_timeout = '2s'");
      const args = [req.tenantContext.organizationId, req.tenantContext.userId,
        req.userRole, req.authSession.id, csrf, key, req.body];
      const raw = (await client.query(
        'SELECT public.canonical_operating_profit_policy_mutate($1,$2,$3,$4,$5,$6,$7::jsonb) value',
        args)).rows[0]?.value;
      const value = sanitizeReceipt(raw);
      if (!value) throw new Error('Invalid operating-profit policy receipt');
      await client.query('COMMIT');
      if (value.replayed) res.set('Idempotency-Replayed', 'true');
      return res.status(value.replayed ? 200 : 201).json({ success: true, data: value });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return failure(res, error);
    } finally {
      if (client && locked) {
        await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [lockKey])
          .catch(() => {});
      }
      if (client) { await client.query('RESET ALL').catch(() => {}); client.release(); }
    }
  });
  return router;
}

module.exports = { createOperatingProfitPolicyRouter, sanitizePolicy, sanitizeReceipt };
