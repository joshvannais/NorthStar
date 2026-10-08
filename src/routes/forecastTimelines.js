'use strict';

const express = require('express');
const db = require('../db');
const { requireOnboardedInternal } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { rateLimit } = require('../middleware/rateLimit');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const MONTH = /^\d{4}-(?:0[1-9]|1[0-2])-01$/;
const REASONS = new Set(['complete_saved_run_inventory_not_available',
  'deterministic_baseline_not_current']);
const GRAINS = ['week', 'month', 'quarter'];
const LABELS = ['Weekly', 'Monthly', 'Quarterly'];
const IMPLEMENTATION_PROCEDURE =
  'public.canonical_forecast_retell_future_origin_v2_capture(uuid,uuid,text,uuid,text,text,date)';

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && own.every(key => {
    if (typeof key !== 'string' || !keys.includes(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
  });
}

function dense(value, size) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      value.length !== size || Reflect.ownKeys(value).length !== size + 1) return false;
  return value.every((_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    return descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
  });
}

function validInstant(value) {
  if (typeof value !== 'string' || !INSTANT.test(value)) return false;
  const milliseconds = Date.parse(value.slice(0, 23) + 'Z');
  return Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString().slice(0, 23) === value.slice(0, 23);
}

function validSubject(value, checkedAt) {
  if (!exact(value, ['target','unit','horizon','scope','profile','sourceSnapshotDigest',
    'sourceReceiptDigest','baselineDigest','configurationDigest','algorithm']) ||
      !exact(value.target, ['key','definitionVersion','sourceScope']) ||
      value.target.key !== 'demand.inbound_leads' || value.target.definitionVersion !== 'v1' ||
      value.target.sourceScope !== 'retell_only_tenant_all' ||
      !exact(value.unit, ['key','currency']) || value.unit.key !== 'count' ||
      value.unit.currency !== null ||
      !exact(value.horizon, ['localStart','startsAt','endsAt','grain','timeZone']) ||
      !MONTH.test(value.horizon.localStart || '') || !validInstant(value.horizon.startsAt) ||
      !validInstant(value.horizon.endsAt) || value.horizon.startsAt >= value.horizon.endsAt ||
      value.horizon.grain !== 'business_local_month' ||
      typeof value.horizon.timeZone !== 'string' || value.horizon.timeZone.length < 1 ||
      value.horizon.timeZone.length > 100 || value.horizon.startsAt <= checkedAt ||
      !exact(value.scope, ['sourceScope','serviceKey','areaKey','dimensionKeys']) ||
      value.scope.sourceScope !== 'retell_only_tenant_all' || value.scope.serviceKey !== null ||
      value.scope.areaKey !== null || !dense(value.scope.dimensionKeys, 0) ||
      !exact(value.profile, ['businessProfileId','businessProfileVersion',
        'businessProfileHash','timeZone']) || !UUID.test(value.profile.businessProfileId || '') ||
      !Number.isSafeInteger(value.profile.businessProfileVersion) ||
      value.profile.businessProfileVersion < 1 ||
      !DIGEST.test(value.profile.businessProfileHash || '') ||
      value.profile.timeZone !== value.horizon.timeZone ||
      !['sourceSnapshotDigest','sourceReceiptDigest','baselineDigest','configurationDigest']
        .every(key => DIGEST.test(value[key] || '')) ||
      !exact(value.algorithm, ['key','version','definitionDigest','implementationDigest',
        'buildIdentity']) || value.algorithm.key !== 'retell_three_complete_month_mean' ||
      value.algorithm.version !== 'm26-retell-three-month-mean-v2' ||
      !DIGEST.test(value.algorithm.definitionDigest || '') ||
      !DIGEST.test(value.algorithm.implementationDigest || '') ||
      !exact(value.algorithm.buildIdentity, ['kind','procedure']) ||
      value.algorithm.buildIdentity.kind !== 'postgresql_function_definition_sha256' ||
      value.algorithm.buildIdentity.procedure !== IMPLEMENTATION_PROCEDURE) return false;
  return true;
}

function validPeriods(value, reason) {
  if (!dense(value, 3)) return false;
  return value.every((period, index) => exact(period,
    ['grain','label','state','reason','startsAt','endsAt','partialPeriod',
      'current','prior','actual']) && period.grain === GRAINS[index] &&
    period.label === LABELS[index] && period.state === 'unavailable' &&
    period.reason === reason && ['startsAt','endsAt','partialPeriod','current','prior','actual']
      .every(key => period[key] === null));
}

function validRequirements(value, current, timeZone) {
  if (!exact(value, ['completeRunInventory','issuanceChronology','finalizedActuals',
    'businessCalendarBuckets'])) return false;
  const inventory = value.completeRunInventory;
  const chronology = value.issuanceChronology;
  const actuals = value.finalizedActuals;
  const calendar = value.businessCalendarBuckets;
  return exact(inventory, ['state','reason','complete','inventoryDigest','runCount',
    'currentRunId','currentRunDigest','priorRunId','priorRunDigest']) &&
    inventory.state === 'unavailable' &&
    inventory.reason === 'complete_saved_run_inventory_not_available' &&
    inventory.complete === false && ['inventoryDigest','runCount','currentRunId',
      'currentRunDigest','priorRunId','priorRunDigest'].every(key => inventory[key] === null) &&
    exact(chronology, ['state','reason','verified','currentIssuedAt','priorIssuedAt']) &&
    chronology.state === 'unavailable' &&
    chronology.reason === 'pre_outcome_issuance_chronology_not_available' &&
    chronology.verified === false && chronology.currentIssuedAt === null &&
    chronology.priorIssuedAt === null &&
    exact(actuals, ['state','reason','sourceAuthenticated','outcomeFinalityPolicyVersion',
      'outcomeFinalityPolicyDigest','actualInventoryDigest']) &&
    actuals.state === 'unavailable' &&
    actuals.reason === 'authorized_finalized_actuals_not_available' &&
    actuals.sourceAuthenticated === false && ['outcomeFinalityPolicyVersion',
      'outcomeFinalityPolicyDigest','actualInventoryDigest'].every(key => actuals[key] === null) &&
    exact(calendar, ['state','reason','timeZone','calendarDigest',
      'partialPeriodsDisclosed','grains']) && calendar.state === 'unavailable' &&
    calendar.reason === 'compatible_business_calendar_buckets_not_available' &&
    calendar.timeZone === (current ? timeZone : null) && calendar.calendarDigest === null &&
    calendar.partialPeriodsDisclosed === false && dense(calendar.grains, 3) &&
    calendar.grains.join('|') === GRAINS.join('|');
}

function sanitizeForecastTimeline(value) {
  const keys = ['version','state','reason','organizationId','originId','checkedAt',
    'comparisonMode','subject','periods','requirements','currentness','digests',
    'sourceAuthenticated','runInventoryComplete','actualSourceAuthenticated',
    'timelineIssued','paidNumericServing','automaticActionAuthorized','researchOnly'];
  if (!exact(value, keys) || value.version !== 'm26-forecast-timeline-v1' ||
      value.state !== 'unavailable' || !REASONS.has(value.reason) ||
      !UUID.test(value.organizationId || '') || !UUID.test(value.originId || '') ||
      !validInstant(value.checkedAt) || value.comparisonMode !== 'current_prior_actual' ||
      !validPeriods(value.periods, value.reason) ||
      !exact(value.currentness, ['baselineCurrent','runInventoryCurrent','actualsCurrent',
        'refreshRequired','correctionOrRevocationApplied']) ||
      value.currentness.runInventoryCurrent !== false ||
      value.currentness.actualsCurrent !== false || value.currentness.refreshRequired !== true ||
      !exact(value.digests, ['timeline','runInventory','actualInventory']) ||
      value.digests.runInventory !== null || value.digests.actualInventory !== null ||
      value.runInventoryComplete !== false || value.actualSourceAuthenticated !== false ||
      value.timelineIssued !== false || value.paidNumericServing !== false ||
      value.automaticActionAuthorized !== false || value.researchOnly !== true) return null;
  const current = value.reason === 'complete_saved_run_inventory_not_available';
  if (current) {
    if (!validSubject(value.subject, value.checkedAt) ||
        !validRequirements(value.requirements, true, value.subject.horizon.timeZone) ||
        value.currentness.baselineCurrent !== true ||
        value.currentness.correctionOrRevocationApplied !== false ||
        value.sourceAuthenticated !== true || !DIGEST.test(value.digests.timeline || '')) return null;
  } else if (value.subject !== null ||
      !validRequirements(value.requirements, false, null) ||
      value.currentness.baselineCurrent !== false ||
      value.currentness.correctionOrRevocationApplied !== true ||
      value.sourceAuthenticated !== false || value.digests.timeline !== null) return null;
  return value;
}

function failure(res, error) {
  const status = error?.code === '42501' ? 403 :
    ['22023','22P02'].includes(error?.code) ? 400 :
      ['40001','40P01','55P03'].includes(error?.code) ? 409 : 503;
  return res.status(status).json({ success: false, error: {
    category: status === 403 ? 'FORECAST_TIMELINE_RESTRICTED' :
      status === 400 ? 'FORECAST_TIMELINE_REQUEST_INVALID' :
        status === 409 ? 'FORECAST_TIMELINE_CHANGED' : 'FORECAST_TIMELINE_UNAVAILABLE',
    message: status === 403 ? 'You cannot view this forecast timeline.' :
      status === 400 ? 'Check the timeline request and try again.' :
        status === 409 ? 'The timeline evidence changed. Refresh and try again.' :
          'The forecast timeline is temporarily unavailable.',
  } });
}

function createForecastTimelinesRouter(options = {}) {
  const router = express.Router();
  const poolProvider = options.poolProvider || (() => db.getPool());
  const auth = options.auth || requireOnboardedInternal;
  const permission = options.permission || requirePermission('forecast', 'read');
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `forecast-timeline:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('Referrer-Policy', 'no-referrer');
    res.vary('Cookie');
    next();
  });
  router.get('/:originId', auth, permission, throttle, async (req, res) => {
    if (!UUID.test(req.params.originId || '') || !exact(req.query, [])) {
      return failure(res, { code: '22023' });
    }
    let client;
    try {
      client = await poolProvider().connect();
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      await client.query("SET LOCAL statement_timeout = '20s'");
      await client.query("SET LOCAL lock_timeout = '2s'");
      const raw = (await client.query(
        `SELECT public.canonical_forecast_timeline_v1_read(
         $1,$2,$3,$4,$5) value`, [req.tenantContext.organizationId,
          req.tenantContext.userId, req.userRole, req.authSession.id,
          req.params.originId])).rows[0]?.value;
      if (raw === null || raw === undefined) {
        await client.query('COMMIT');
        return res.status(404).json({ success: false, error: {
          category: 'FORECAST_TIMELINE_NOT_FOUND',
          message: 'This forecast timeline was not found.',
        } });
      }
      const value = sanitizeForecastTimeline(raw);
      if (!value) throw new Error('Invalid guarded forecast timeline projection');
      await client.query('COMMIT');
      return res.status(200).json({ success: true, data: value });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return failure(res, error);
    } finally { if (client) client.release(); }
  });
  return router;
}

module.exports = { createForecastTimelinesRouter, sanitizeForecastTimeline };
