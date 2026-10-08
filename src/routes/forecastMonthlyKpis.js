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
const REASONS = new Set(['same_run_manifest_not_available',
  'deterministic_baseline_not_current']);
const IMPLEMENTATION_PROCEDURE =
  'public.canonical_forecast_retell_future_origin_v2_capture(uuid,uuid,text,uuid,text,text,date)';
const SLOT_KEYS = ['revenue','operating_cost','profit','margin','demand','capacity'];
const SPECS = Object.freeze([
  Object.freeze({ key: 'revenue', label: 'Revenue', targetKey: 'revenue.earned_value',
    definitionVersion: 'v1', targetStatus: 'cataloged', components: [], unitKey: 'money',
    sourceScope: 'authorized_earned_value', dimensionKind: 'none' }),
  Object.freeze({ key: 'operating_cost', label: 'Operating cost', targetKey: null,
    definitionVersion: null, targetStatus: 'derived_display_metric_not_registered',
    components: ['cost.accepted_labor.v1','cost.accepted_material.v1',
      'cost.accepted_asset_travel.v1','cost.accepted_overhead.v1'], unitKey: 'money',
    sourceScope: 'complete_non_overlapping_operating_cost_categories', dimensionKind: 'none' }),
  Object.freeze({ key: 'profit', label: 'Profit', targetKey: null, definitionVersion: null,
    targetStatus: 'derived_display_metric_not_registered', components: [
      'revenue.earned_value.v1','cost.accepted_labor.v1','cost.accepted_material.v1',
      'cost.accepted_asset_travel.v1','cost.accepted_overhead.v1'], unitKey: 'money',
    sourceScope: 'compatible_earned_revenue_less_operating_cost', dimensionKind: 'none' }),
  Object.freeze({ key: 'margin', label: 'Margin', targetKey: 'profit.operating_margin',
    definitionVersion: 'v1', targetStatus: 'cataloged', components: [
      'revenue.earned_value.v1','cost.accepted_labor.v1','cost.accepted_material.v1',
      'cost.accepted_asset_travel.v1','cost.accepted_overhead.v1'], unitKey: 'ratio',
    sourceScope: 'compatible_positive_revenue_and_operating_cost', dimensionKind: 'none' }),
  Object.freeze({ key: 'demand', label: 'Demand', targetKey: 'demand.inbound_leads',
    definitionVersion: 'v1', targetStatus: 'cataloged', components: [], unitKey: 'count',
    sourceScope: 'declared_complete_eligible_channels', dimensionKind: 'none' }),
  Object.freeze({ key: 'capacity', label: 'Capacity',
    targetKey: 'capacity.available_role_hours', definitionVersion: 'v1',
    targetStatus: 'cataloged', components: [], unitKey: 'role_hours',
    sourceScope: 'qualified_available_role_hours', dimensionKind: 'role' }),
]);

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

function validAnchor(value) {
  return exact(value, ['originId','timelineDigest','target','unit','horizon','scope','profile',
    'sourceSnapshotDigest','sourceReceiptDigest','baselineDigest','configurationDigest',
    'algorithm']) && UUID.test(value.originId || '') && DIGEST.test(value.timelineDigest || '') &&
    exact(value.target, ['key','definitionVersion','sourceScope']) &&
    value.target.key === 'demand.inbound_leads' && value.target.definitionVersion === 'v1' &&
    value.target.sourceScope === 'retell_only_tenant_all' &&
    exact(value.unit, ['key','currency']) && value.unit.key === 'count' &&
    value.unit.currency === null &&
    exact(value.horizon, ['localStart','startsAt','endsAt','grain','timeZone']) &&
    MONTH.test(value.horizon.localStart || '') && validInstant(value.horizon.startsAt) &&
    validInstant(value.horizon.endsAt) && value.horizon.startsAt < value.horizon.endsAt &&
    value.horizon.grain === 'business_local_month' &&
    exact(value.scope, ['sourceScope','serviceKey','areaKey','dimensionKeys']) &&
    value.scope.sourceScope === 'retell_only_tenant_all' && value.scope.serviceKey === null &&
    value.scope.areaKey === null && dense(value.scope.dimensionKeys, 0) &&
    exact(value.profile, ['businessProfileId','businessProfileVersion',
      'businessProfileHash','timeZone']) && UUID.test(value.profile.businessProfileId || '') &&
    Number.isSafeInteger(value.profile.businessProfileVersion) &&
    value.profile.businessProfileVersion > 0 && DIGEST.test(value.profile.businessProfileHash || '') &&
    typeof value.profile.timeZone === 'string' && value.profile.timeZone.length > 0 &&
    value.profile.timeZone.length <= 100 && value.profile.timeZone === value.horizon.timeZone &&
    ['sourceSnapshotDigest','sourceReceiptDigest','baselineDigest','configurationDigest']
      .every(key => DIGEST.test(value[key] || '')) &&
    exact(value.algorithm, ['key','version','definitionDigest','implementationDigest',
      'buildIdentity']) && value.algorithm.key === 'retell_three_complete_month_mean' &&
    value.algorithm.version === 'm26-retell-three-month-mean-v2' &&
    DIGEST.test(value.algorithm.definitionDigest || '') &&
    DIGEST.test(value.algorithm.implementationDigest || '') &&
    exact(value.algorithm.buildIdentity, ['kind','procedure']) &&
    value.algorithm.buildIdentity.kind === 'postgresql_function_definition_sha256' &&
    value.algorithm.buildIdentity.procedure === IMPLEMENTATION_PROCEDURE;
}

function validMonth(value, anchor) {
  return exact(value, ['localStart','startsAt','endsAt','grain','timeZone',
    'calendarDigest','partialPeriod']) && MONTH.test(value.localStart || '') &&
    validInstant(value.startsAt) && validInstant(value.endsAt) &&
    value.startsAt < value.endsAt && value.grain === 'business_local_month' &&
    value.localStart === anchor.horizon.localStart &&
    value.startsAt === anchor.horizon.startsAt && value.endsAt === anchor.horizon.endsAt &&
    value.timeZone === anchor.profile.timeZone && value.calendarDigest === null &&
    value.partialPeriod === null;
}

function validRun(value) {
  return exact(value, ['state','reason','runId','revision','predictionCutoff',
    'manifestDigest','algorithmSetDigest','configurationDigest','sourceSnapshotDigest',
    'complete','current']) && value.state === 'unavailable' &&
    value.reason === 'same_run_manifest_not_available' && value.complete === false &&
    value.current === false && ['runId','revision','predictionCutoff','manifestDigest',
      'algorithmSetDigest','configurationDigest','sourceSnapshotDigest']
      .every(key => value[key] === null);
}

function validTarget(target, spec) {
  return exact(target, ['key','definitionVersion','status','componentTargets']) &&
    target.key === spec.targetKey && target.definitionVersion === spec.definitionVersion &&
    target.status === spec.targetStatus && dense(target.componentTargets, spec.components.length) &&
    target.componentTargets.every((component, index) => component === spec.components[index]);
}

function validSlot(value, spec, reason) {
  return exact(value, ['key','label','state','reason','target','unit','scope',
    'manifestEntryState','value','outputDigest','sourceSnapshotDigest','coverageDigest',
    'currentnessDigest']) && value.key === spec.key && value.label === spec.label &&
    value.state === 'unavailable' && value.reason === reason && validTarget(value.target, spec) &&
    exact(value.unit, ['key','currency']) && value.unit.key === spec.unitKey &&
    value.unit.currency === null &&
    exact(value.scope, ['sourceScope','serviceKey','areaKey','dimensionKind',
      'dimensionValue','dimensionDigest']) && value.scope.sourceScope === spec.sourceScope &&
    value.scope.serviceKey === null && value.scope.areaKey === null &&
    value.scope.dimensionKind === spec.dimensionKind && value.scope.dimensionValue === null &&
    value.scope.dimensionDigest === null &&
    value.manifestEntryState === 'unknown_manifest_unavailable' &&
    ['value','outputDigest','sourceSnapshotDigest','coverageDigest','currentnessDigest']
      .every(key => value[key] === null);
}

function validRequirements(value) {
  if (!exact(value, ['sameRunManifest','earnedRevenueAuthority','operatingCostCoverage',
    'demandCoverage','capacityScope'])) return false;
  const manifest = value.sameRunManifest;
  const revenue = value.earnedRevenueAuthority;
  const cost = value.operatingCostCoverage;
  const demand = value.demandCoverage;
  const capacity = value.capacityScope;
  return exact(manifest, ['state','reason','complete','runId','revision','predictionCutoff',
    'manifestDigest','presentTargetCount','expectedTargetCount','absentTargets']) &&
    manifest.state === 'unavailable' && manifest.reason === 'same_run_manifest_not_available' &&
    manifest.complete === false && manifest.expectedTargetCount === 6 &&
    ['runId','revision','predictionCutoff','manifestDigest','presentTargetCount','absentTargets']
      .every(key => manifest[key] === null) &&
    exact(revenue, ['state','reason','recognitionPolicyVersion','recognitionPolicyDigest',
      'completeEventTimeCoverage']) && revenue.state === 'unavailable' &&
    revenue.reason === 'authorized_earned_revenue_not_available' &&
    revenue.recognitionPolicyVersion === null && revenue.recognitionPolicyDigest === null &&
    revenue.completeEventTimeCoverage === false &&
    exact(cost, ['state','reason','costBasisVersion','costBasisDigest','currency',
      'categoriesComplete','nonOverlapping','longJobAllocationVerified']) &&
    cost.state === 'unavailable' &&
    cost.reason === 'complete_operating_cost_categories_not_available' &&
    ['costBasisVersion','costBasisDigest','currency'].every(key => cost[key] === null) &&
    cost.categoriesComplete === false && cost.nonOverlapping === false &&
    cost.longJobAllocationVerified === false &&
    exact(demand, ['state','reason','eligibleChannelScope','distinctLeadIdentityComplete',
      'rawRetellCallsSeparated']) && demand.state === 'unavailable' &&
    demand.reason === 'same_run_demand_target_not_available' &&
    demand.eligibleChannelScope === null && demand.distinctLeadIdentityComplete === false &&
    demand.rawRetellCallsSeparated === true &&
    exact(capacity, ['state','reason','roleKey','dimensionDigest',
      'qualifiedAvailabilityComplete','commitmentOverlapReviewed']) &&
    capacity.state === 'unavailable' &&
    capacity.reason === 'same_run_role_capacity_target_not_available' &&
    capacity.roleKey === null && capacity.dimensionDigest === null &&
    capacity.qualifiedAvailabilityComplete === false &&
    capacity.commitmentOverlapReviewed === false;
}

function validGraph(value, reason, month) {
  if (!exact(value, ['state','reason','month','series']) || value.state !== 'unavailable' ||
      value.reason !== reason || (value.month !== month && JSON.stringify(value.month) !==
        JSON.stringify(month)) || !dense(value.series, SPECS.length)) return false;
  return value.series.every((series, index) => exact(series,
    ['key','value','unitKey']) && series.key === SPECS[index].key &&
    series.value === null && series.unitKey === SPECS[index].unitKey);
}

function sanitizeForecastMonthlyKpis(value) {
  const keys = ['version','state','reason','organizationId','originId','checkedAt','anchor',
    'month','run','slots','requirements','graph','currentness','digests',
    'anchorSourceAuthenticated','sameRunManifestComplete','bundleIssued',
    'paidNumericServing','automaticActionAuthorized','researchOnly'];
  if (!exact(value, keys) || value.version !== 'm26-monthly-kpi-bundle-v1' ||
      value.state !== 'unavailable' || !REASONS.has(value.reason) ||
      !UUID.test(value.organizationId || '') || !UUID.test(value.originId || '') ||
      !validInstant(value.checkedAt) || !validRun(value.run) ||
      !dense(value.slots, SPECS.length) ||
      !value.slots.every((slot, index) => validSlot(slot, SPECS[index], value.reason)) ||
      !validRequirements(value.requirements) || !validGraph(value.graph, value.reason, value.month) ||
      !exact(value.currentness, ['anchorCurrent','manifestCurrent','sourceReadersCurrent',
        'refreshRequired','correctionOrRevocationApplied']) ||
      value.currentness.manifestCurrent !== false ||
      value.currentness.sourceReadersCurrent !== false ||
      value.currentness.refreshRequired !== true ||
      !exact(value.digests, ['bundle','run','manifest']) || value.digests.run !== null ||
      value.digests.manifest !== null || value.sameRunManifestComplete !== false ||
      value.bundleIssued !== false || value.paidNumericServing !== false ||
      value.automaticActionAuthorized !== false || value.researchOnly !== true) return null;
  const current = value.reason === 'same_run_manifest_not_available';
  if (current) {
    if (!validAnchor(value.anchor) || !validMonth(value.month, value.anchor) ||
        value.anchor.originId.toLowerCase() !== value.originId.toLowerCase() ||
        value.month.localStart !== value.anchor.horizon?.localStart ||
        !DIGEST.test(value.digests.bundle || '') || value.anchorSourceAuthenticated !== true ||
        value.currentness.anchorCurrent !== true ||
        value.currentness.correctionOrRevocationApplied !== false) return null;
  } else if (value.anchor !== null || value.month !== null || value.digests.bundle !== null ||
      value.anchorSourceAuthenticated !== false || value.currentness.anchorCurrent !== false ||
      value.currentness.correctionOrRevocationApplied !== true) return null;
  return value;
}

function failure(res, error) {
  const status = error?.code === '42501' ? 403 :
    ['22023','22P02'].includes(error?.code) ? 400 :
      ['40001','40P01','55P03'].includes(error?.code) ? 409 : 503;
  return res.status(status).json({ success: false, error: {
    category: status === 403 ? 'FORECAST_MONTHLY_KPIS_RESTRICTED' :
      status === 400 ? 'FORECAST_MONTHLY_KPIS_REQUEST_INVALID' :
        status === 409 ? 'FORECAST_MONTHLY_KPIS_CHANGED' :
          'FORECAST_MONTHLY_KPIS_UNAVAILABLE',
    message: status === 403 ? 'You cannot view these monthly forecast KPIs.' :
      status === 400 ? 'Check the monthly KPI request and try again.' :
        status === 409 ? 'The monthly KPI evidence changed. Refresh and try again.' :
          'The monthly forecast KPIs are temporarily unavailable.',
  } });
}

function createForecastMonthlyKpisRouter(options = {}) {
  const router = express.Router();
  const poolProvider = options.poolProvider || (() => db.getPool());
  const auth = options.auth || requireOnboardedInternal;
  const permission = options.permission || requirePermission('forecast', 'read');
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `forecast-monthly-kpis:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
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
        `SELECT public.canonical_forecast_monthly_kpis_v1_read(
         $1,$2,$3,$4,$5) value`, [req.tenantContext.organizationId,
          req.tenantContext.userId, req.userRole, req.authSession.id,
          req.params.originId])).rows[0]?.value;
      if (raw === null || raw === undefined) {
        await client.query('COMMIT');
        return res.status(404).json({ success: false, error: {
          category: 'FORECAST_MONTHLY_KPIS_NOT_FOUND',
          message: 'This monthly KPI anchor was not found.',
        } });
      }
      const value = sanitizeForecastMonthlyKpis(raw);
      if (!value) throw new Error('Invalid guarded monthly KPI projection');
      await client.query('COMMIT');
      return res.status(200).json({ success: true, data: value });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return failure(res, error);
    } finally { if (client) client.release(); }
  });
  return router;
}

module.exports = { SLOT_KEYS, SPECS, createForecastMonthlyKpisRouter,
  sanitizeForecastMonthlyKpis };
