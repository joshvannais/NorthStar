'use strict';

const express = require('express');
const db = require('../db');
const { requireAccountMutation, requireOnboardedInternal } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { rateLimit } = require('../middleware/rateLimit');

const DIGEST = /^[0-9a-f]{64}$/;
const KEY = /^[A-Za-z0-9._:-]{16,128}$/;
const TOKEN = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONEY = /^(?:0|[1-9][0-9]{0,11})\.[0-9]{2}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
const CATEGORIES = new Set(['rent', 'utilities', 'insurance', 'tax', 'administration',
  'maintenance', 'interest', 'principal', 'debt_service', 'other']);

function exact(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function validInstant(value) {
  return typeof value === 'string' && INSTANT.test(value) && Number.isFinite(Date.parse(value));
}
function validText(value, maximum) {
  return typeof value === 'string' && value.trim().length > 0 &&
    Buffer.byteLength(value, 'utf8') <= maximum * 4;
}

function normalizeSnapshot(body) {
  const keys = ['expectedRevision', 'expectedDigest', 'action', 'currency', 'effectiveOn',
    'coverage', 'schedules', 'allocationPolicy', 'reason', 'confirmed', 'confirmationVersion'];
  if (!exact(body, keys) || !Number.isSafeInteger(body.expectedRevision) ||
      body.expectedRevision < 0 || body.expectedRevision > 10000 ||
      !(body.expectedDigest === 'none' || DIGEST.test(body.expectedDigest || '')) ||
      ((body.expectedRevision === 0) !== (body.expectedDigest === 'none')) ||
      !['replace', 'revoke'].includes(body.action) || !validText(body.reason, 2000) ||
      body.confirmed !== true || body.confirmationVersion !== 'operating-cost-schedule-snapshot-v1') {
    throw Object.assign(new Error('Operating-cost schedule input is invalid.'), { code: '22023' });
  }
  if (body.action === 'revoke') {
    if (body.currency !== null || body.effectiveOn !== null || body.coverage !== null ||
        body.allocationPolicy !== null || !Array.isArray(body.schedules) || body.schedules.length !== 0) {
      throw Object.assign(new Error('Revocation must not retain schedules.'), { code: '22023' });
    }
    return Object.freeze(structuredClone(body));
  }
  if (!/^[A-Z]{3}$/.test(body.currency || '') || !validDate(body.effectiveOn) ||
      !exact(body.coverage, ['startsOn', 'endsOn', 'recordedThrough', 'complete']) ||
      !validDate(body.coverage.startsOn) || !validDate(body.coverage.endsOn) ||
      body.coverage.endsOn < body.coverage.startsOn || !validInstant(body.coverage.recordedThrough) ||
      body.coverage.complete !== true || !Array.isArray(body.schedules) || body.schedules.length > 100 ||
      !exact(body.allocationPolicy, ['status', 'basis', 'mission24EquipmentTreatment',
        'mission24OverheadTreatment', 'economicDepreciationTreatment',
        'actualPaymentTreatment', 'reason']) || body.allocationPolicy.status !== 'reconciled' ||
      body.allocationPolicy.basis !== 'owner_approved_schedule_policy' ||
      body.allocationPolicy.mission24EquipmentTreatment !== 'separate_job_cost_allocation' ||
      body.allocationPolicy.mission24OverheadTreatment !== 'separate_job_cost_allocation' ||
      body.allocationPolicy.economicDepreciationTreatment !== 'excluded' ||
      body.allocationPolicy.actualPaymentTreatment !== 'not_evidence' ||
      !validText(body.allocationPolicy.reason, 1000)) {
    throw Object.assign(new Error('Operating-cost coverage or policy is invalid.'), { code: '22023' });
  }
  const scheduleKeys = new Set();
  for (const schedule of body.schedules) {
    if (!exact(schedule, ['scheduleKey', 'kind', 'assetId', 'amount', 'currency', 'dueDates',
      'recurrenceEnd', 'includedCategories', 'sourceAttestation']) ||
      !TOKEN.test(schedule.scheduleKey || '') || scheduleKeys.has(schedule.scheduleKey) ||
      !['overhead_expense', 'financed_asset_obligation'].includes(schedule.kind) ||
      !MONEY.test(schedule.amount || '') || schedule.currency !== body.currency ||
      !Array.isArray(schedule.dueDates) || schedule.dueDates.length < 1 ||
      schedule.dueDates.length > 120 || !validDate(schedule.recurrenceEnd) ||
      !Array.isArray(schedule.includedCategories) || schedule.includedCategories.length < 1 ||
      schedule.includedCategories.length > 12 ||
      (schedule.kind === 'overhead_expense' ? schedule.assetId !== null : !UUID.test(schedule.assetId || ''))) {
      throw Object.assign(new Error('Operating-cost schedule is invalid.'), { code: '22023' });
    }
    scheduleKeys.add(schedule.scheduleKey);
    const dates = new Set();
    for (const due of schedule.dueDates) {
      if (!exact(due, ['dueOn', 'paymentStatus']) || !validDate(due.dueOn) || dates.has(due.dueOn) ||
          !['scheduled', 'owner_marked_satisfied', 'canceled'].includes(due.paymentStatus) ||
          due.dueOn < body.coverage.startsOn || due.dueOn > body.coverage.endsOn ||
          due.dueOn > schedule.recurrenceEnd) {
        throw Object.assign(new Error('Operating-cost due date is invalid.'), { code: '22023' });
      }
      dates.add(due.dueOn);
    }
    const categories = new Set(schedule.includedCategories);
    if (categories.size !== schedule.includedCategories.length ||
        schedule.includedCategories.some(category => !CATEGORIES.has(category)) ||
        (schedule.kind === 'overhead_expense' &&
          ['principal', 'interest', 'debt_service'].some(category => categories.has(category))) ||
        (schedule.kind === 'financed_asset_obligation' && !categories.has('debt_service'))) {
      throw Object.assign(new Error('Operating-cost categories overlap or are invalid.'), { code: '22023' });
    }
    const source = schedule.sourceAttestation;
    if (!exact(source, ['kind', 'reference', 'documentDigest', 'attestedAt']) ||
        !['owner_attested', 'source_document'].includes(source.kind) ||
        !validText(source.reference, 500) || !validInstant(source.attestedAt) ||
        (source.kind === 'owner_attested' ? source.documentDigest !== null :
          !DIGEST.test(source.documentDigest || ''))) {
      throw Object.assign(new Error('Operating-cost source attestation is invalid.'), { code: '22023' });
    }
  }
  return Object.freeze(structuredClone(body));
}

function sanitizeSource(value) {
  if (!exact(value, ['state', 'revision', 'digest', 'action', 'snapshot']) ||
      !['absent', 'current', 'revoked'].includes(value.state)) return null;
  if (value.state === 'absent') return value.revision === 0 && value.digest === 'none' &&
    value.action === null && value.snapshot === null ? value : null;
  if (!Number.isSafeInteger(value.revision) || value.revision < 1 || value.revision > 10000 ||
      !DIGEST.test(value.digest || '') || !['replace', 'revoke'].includes(value.action) ||
      value.state !== (value.action === 'replace' ? 'current' : 'revoked') ||
      !value.snapshot || typeof value.snapshot !== 'object' || Array.isArray(value.snapshot)) return null;
  try {
    normalizeSnapshot({ expectedRevision: value.revision, expectedDigest: value.digest,
      ...value.snapshot, reason: 'Validate the private current source read.', confirmed: true,
      confirmationVersion: 'operating-cost-schedule-snapshot-v1' });
  } catch (_error) { return null; }
  return value;
}

function failure(res, error) {
  const status = error?.code === '42501' ? 403 :
    ['22023', '22P02', '22007'].includes(error?.code) ? 400 :
      ['23505', '40001', '40P01', '55P03'].includes(error?.code) ? 409 : 503;
  return res.status(status).json({ success: false, error: {
    category: status === 403 ? 'OPERATING_COST_SCHEDULE_RESTRICTED' :
      status === 400 ? 'OPERATING_COST_SCHEDULE_INVALID' :
        status === 409 ? 'OPERATING_COST_SCHEDULE_CHANGED' : 'OPERATING_COST_SCHEDULE_UNAVAILABLE',
    message: status === 403 ? 'You cannot change company obligation schedules.' :
      status === 400 ? 'Review the exact schedule, source, dates, and allocation policy.' :
        status === 409 ? 'The company obligation schedule changed. Refresh and try again.' :
          'Company obligation schedules are temporarily unavailable.',
  } });
}

function ownerOnly(req, res, next) {
  if (!['owner', 'admin'].includes(req.userRole)) return failure(res, { code: '42501' });
  next();
}

function createOperatingCostSchedulesRouter(options = {}) {
  const router = express.Router();
  const poolProvider = options.poolProvider || (() => db.getPool());
  const mutationAuth = options.mutationAuth || options.auth || requireAccountMutation;
  const readAuth = options.readAuth || options.auth || requireOnboardedInternal;
  const mutationPermission = options.mutationPermission || options.permission ||
    requirePermission('settings', 'update');
  const readPermission = options.readPermission || options.permission || requirePermission('settings', 'read');
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `operating-cost-schedules:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'private, no-store'); res.set('Referrer-Policy', 'no-referrer');
    res.vary('Cookie'); next();
  });
  router.get('/current', readAuth, ownerOnly, readPermission, throttle, async (req, res) => {
    if (!exact(req.query, [])) return failure(res, { code: '22023' });
    let client;
    try {
      client = await poolProvider().connect();
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      await client.query("SET LOCAL statement_timeout = '15s'");
      await client.query("SET LOCAL lock_timeout = '2s'");
      const parameters = [req.tenantContext.organizationId, req.tenantContext.userId,
        req.userRole, req.authSession.id];
      const raw = (await client.query(
        'SELECT public.canonical_operating_cost_snapshot_read($1,$2,$3,$4) value',
        parameters)).rows[0]?.value;
      const value = sanitizeSource(raw);
      if (!value) throw new Error('Invalid operating-cost source projection');
      await client.query('COMMIT');
      return res.status(200).json({ success: true, data: value });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return failure(res, error);
    } finally { if (client) client.release(); }
  });
  router.put('/current', mutationAuth, ownerOnly, mutationPermission, throttle, async (req, res) => {
    let client;
    try {
      const body = normalizeSnapshot(req.body);
      const idempotencyKey = req.get('Idempotency-Key');
      if (!KEY.test(idempotencyKey || '')) throw Object.assign(new Error('Invalid key'), { code: '22023' });
      client = await poolProvider().connect();
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await client.query("SET LOCAL statement_timeout = '15s'");
      await client.query("SET LOCAL lock_timeout = '2s'");
      const parameters = [req.tenantContext.organizationId, req.tenantContext.userId,
        req.userRole, req.authSession.id, req.get('X-CSRF-Token'), idempotencyKey, body];
      const value = (await client.query(
        'SELECT public.canonical_operating_cost_snapshot_mutate($1,$2,$3,$4,$5,$6,$7::jsonb) value',
        parameters)).rows[0]?.value;
      if (!exact(value, ['revision', 'digest', 'action', 'replayed']) ||
          !Number.isSafeInteger(value.revision) || value.revision < 1 || !DIGEST.test(value.digest || '') ||
          !['replace', 'revoke'].includes(value.action) || typeof value.replayed !== 'boolean') {
        throw new Error('Invalid operating-cost schedule projection');
      }
      await client.query('COMMIT');
      if (value.replayed) res.set('Idempotency-Replayed', 'true');
      return res.status(value.replayed ? 200 : 201).json({ success: true, data: value });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return failure(res, error);
    } finally { if (client) client.release(); }
  });
  return router;
}

module.exports = { createOperatingCostSchedulesRouter, normalizeSnapshot, sanitizeSource };
