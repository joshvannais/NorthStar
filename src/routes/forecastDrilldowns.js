'use strict';

const express = require('express');
const db = require('../db');
const { requireOnboardedInternal } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { rateLimit } = require('../middleware/rateLimit');
const { SPECS, sanitizeForecastMonthlyKpis } = require('./forecastMonthlyKpis');

const VERSION = 'm26-forecast-drilldowns-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REASONS = new Set(['same_run_manifest_not_available',
  'deterministic_baseline_not_current']);

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

function same(value, expected) {
  return JSON.stringify(value) === JSON.stringify(expected);
}

function copy(value) {
  return value === null ? null : JSON.parse(JSON.stringify(value));
}

function unavailableDetail() {
  return {
    sourceCoverage: {
      state: 'unavailable', reason: 'authenticated_complete_source_coverage_not_available',
      numerator: null, denominator: null, sourceKind: null, sourceScope: null,
      receiptDigest: null, complete: false,
    },
    assumptions: {
      state: 'unavailable', reason: 'structured_assumption_lineage_not_available',
      lineageDigest: null, authorId: null, sourceKind: null, revision: null,
      applicabilityDigest: null, currentnessDigest: null, items: [],
    },
    confidence: {
      state: 'unavailable', reason: 'reviewed_evaluation_not_available',
      percentage: null, evaluationDigest: null, calibrated: false,
    },
    uncertainty: {
      state: 'unavailable', reason: 'authenticated_uncertainty_drivers_not_available',
      drivers: [], evidenceDigest: null,
    },
    staleInputs: {
      state: 'unavailable', reason: 'dependency_currentness_index_not_available',
      correctionRevocationDeletion: null, permissionRetention: null,
      profileCalendarConfigurationAlgorithm: null, supersededRevision: null,
      currentnessDigest: null,
    },
    change: {
      state: 'unavailable', reason: 'compatible_prior_issued_point_forecast_not_available',
      amount: null, priorRunId: null, priorOutputDigest: null,
    },
    error: {
      state: 'unavailable', reason: 'later_finalized_comparable_actual_not_available',
      amount: null, actualSourceDigest: null, outcomeFinalityDigest: null,
    },
    cause: {
      state: 'unknown', reason: 'authenticated_lineage_difference_not_available',
      drivers: [], lineageDigest: null,
    },
  };
}

function projectForecastDrilldowns(input) {
  const bundle = sanitizeForecastMonthlyKpis(input);
  if (!bundle) return null;
  const slots = bundle.slots.map(slot => ({
    key: slot.key,
    label: slot.label,
    state: 'unavailable',
    reason: bundle.reason,
    identity: {
      target: copy(slot.target), unit: copy(slot.unit), scope: copy(slot.scope),
      manifestEntryState: slot.manifestEntryState,
      runId: bundle.run.runId, runRevision: bundle.run.revision,
      outputDigest: slot.outputDigest, sourceSnapshotDigest: slot.sourceSnapshotDigest,
      currentnessDigest: slot.currentnessDigest,
    },
    ...unavailableDetail(),
  }));
  return {
    version: VERSION,
    state: 'unavailable',
    reason: bundle.reason,
    organizationId: bundle.organizationId,
    originId: bundle.originId,
    checkedAt: bundle.checkedAt,
    bundle: copy(bundle),
    period: copy(bundle.month),
    slots,
    currentness: {
      anchorCurrent: bundle.currentness.anchorCurrent,
      manifestCurrent: false,
      detailReadersCurrent: false,
      refreshRequired: true,
      correctionOrRevocationApplied: bundle.currentness.correctionOrRevocationApplied,
    },
    digests: {
      drilldown: null,
      bundle: bundle.digests.bundle,
      timeline: bundle.anchor?.timelineDigest || null,
      run: null,
      manifest: null,
    },
    sourceCoverageAuthenticated: false,
    assumptionsAuthenticated: false,
    evaluationReviewed: false,
    staleInputAuthorityAvailable: false,
    numericalDetailIssued: false,
    paidNumericServing: false,
    automaticActionAuthorized: false,
    researchOnly: true,
  };
}

function validIdentity(value, slot, bundle) {
  return exact(value, ['target','unit','scope','manifestEntryState','runId','runRevision',
    'outputDigest','sourceSnapshotDigest','currentnessDigest']) &&
    same(value.target, slot.target) && same(value.unit, slot.unit) &&
    same(value.scope, slot.scope) && value.manifestEntryState === slot.manifestEntryState &&
    value.runId === bundle.run.runId && value.runRevision === bundle.run.revision &&
    value.outputDigest === slot.outputDigest &&
    value.sourceSnapshotDigest === slot.sourceSnapshotDigest &&
    value.currentnessDigest === slot.currentnessDigest;
}

function validUnavailableDetail(value) {
  const coverage = value.sourceCoverage;
  const assumptions = value.assumptions;
  const confidence = value.confidence;
  const uncertainty = value.uncertainty;
  const stale = value.staleInputs;
  const change = value.change;
  const error = value.error;
  const cause = value.cause;
  return exact(coverage, ['state','reason','numerator','denominator','sourceKind','sourceScope',
    'receiptDigest','complete']) && coverage.state === 'unavailable' &&
    coverage.reason === 'authenticated_complete_source_coverage_not_available' &&
    ['numerator','denominator','sourceKind','sourceScope','receiptDigest']
      .every(key => coverage[key] === null) && coverage.complete === false &&
    exact(assumptions, ['state','reason','lineageDigest','authorId','sourceKind','revision',
      'applicabilityDigest','currentnessDigest','items']) && assumptions.state === 'unavailable' &&
    assumptions.reason === 'structured_assumption_lineage_not_available' &&
    ['lineageDigest','authorId','sourceKind','revision','applicabilityDigest','currentnessDigest']
      .every(key => assumptions[key] === null) && dense(assumptions.items, 0) &&
    exact(confidence, ['state','reason','percentage','evaluationDigest','calibrated']) &&
    confidence.state === 'unavailable' &&
    confidence.reason === 'reviewed_evaluation_not_available' &&
    confidence.percentage === null && confidence.evaluationDigest === null &&
    confidence.calibrated === false &&
    exact(uncertainty, ['state','reason','drivers','evidenceDigest']) &&
    uncertainty.state === 'unavailable' &&
    uncertainty.reason === 'authenticated_uncertainty_drivers_not_available' &&
    dense(uncertainty.drivers, 0) && uncertainty.evidenceDigest === null &&
    exact(stale, ['state','reason','correctionRevocationDeletion','permissionRetention',
      'profileCalendarConfigurationAlgorithm','supersededRevision','currentnessDigest']) &&
    stale.state === 'unavailable' &&
    stale.reason === 'dependency_currentness_index_not_available' &&
    ['correctionRevocationDeletion','permissionRetention',
      'profileCalendarConfigurationAlgorithm','supersededRevision','currentnessDigest']
      .every(key => stale[key] === null) &&
    exact(change, ['state','reason','amount','priorRunId','priorOutputDigest']) &&
    change.state === 'unavailable' &&
    change.reason === 'compatible_prior_issued_point_forecast_not_available' &&
    ['amount','priorRunId','priorOutputDigest'].every(key => change[key] === null) &&
    exact(error, ['state','reason','amount','actualSourceDigest','outcomeFinalityDigest']) &&
    error.state === 'unavailable' &&
    error.reason === 'later_finalized_comparable_actual_not_available' &&
    ['amount','actualSourceDigest','outcomeFinalityDigest'].every(key => error[key] === null) &&
    exact(cause, ['state','reason','drivers','lineageDigest']) && cause.state === 'unknown' &&
    cause.reason === 'authenticated_lineage_difference_not_available' &&
    dense(cause.drivers, 0) && cause.lineageDigest === null;
}

function sanitizeForecastDrilldowns(value) {
  const keys = ['version','state','reason','organizationId','originId','checkedAt','bundle',
    'period','slots','currentness','digests','sourceCoverageAuthenticated',
    'assumptionsAuthenticated','evaluationReviewed','staleInputAuthorityAvailable',
    'numericalDetailIssued','paidNumericServing','automaticActionAuthorized','researchOnly'];
  if (!exact(value, keys) || value.version !== VERSION || value.state !== 'unavailable' ||
      !REASONS.has(value.reason) || !UUID.test(value.organizationId || '') ||
      !UUID.test(value.originId || '')) return null;
  const bundle = sanitizeForecastMonthlyKpis(value.bundle);
  if (!bundle || value.organizationId !== bundle.organizationId ||
      value.originId !== bundle.originId || value.checkedAt !== bundle.checkedAt ||
      value.reason !== bundle.reason || !same(value.period, bundle.month) ||
      !dense(value.slots, SPECS.length)) return null;
  if (!value.slots.every((slot, index) => exact(slot,
    ['key','label','state','reason','identity','sourceCoverage','assumptions','confidence',
      'uncertainty','staleInputs','change','error','cause']) &&
      slot.key === bundle.slots[index].key && slot.label === bundle.slots[index].label &&
      slot.state === 'unavailable' && slot.reason === value.reason &&
      validIdentity(slot.identity, bundle.slots[index], bundle) &&
      validUnavailableDetail(slot))) return null;
  if (!exact(value.currentness, ['anchorCurrent','manifestCurrent','detailReadersCurrent',
    'refreshRequired','correctionOrRevocationApplied']) ||
      value.currentness.anchorCurrent !== bundle.currentness.anchorCurrent ||
      value.currentness.manifestCurrent !== false ||
      value.currentness.detailReadersCurrent !== false ||
      value.currentness.refreshRequired !== true ||
      value.currentness.correctionOrRevocationApplied !==
        bundle.currentness.correctionOrRevocationApplied ||
      !exact(value.digests, ['drilldown','bundle','timeline','run','manifest']) ||
      value.digests.drilldown !== null || value.digests.bundle !== bundle.digests.bundle ||
      value.digests.timeline !== (bundle.anchor?.timelineDigest || null) ||
      value.digests.run !== null || value.digests.manifest !== null ||
      value.sourceCoverageAuthenticated !== false ||
      value.assumptionsAuthenticated !== false || value.evaluationReviewed !== false ||
      value.staleInputAuthorityAvailable !== false || value.numericalDetailIssued !== false ||
      value.paidNumericServing !== false || value.automaticActionAuthorized !== false ||
      value.researchOnly !== true) return null;
  return value;
}

function failure(res, error) {
  const status = error?.code === '42501' ? 403 : error?.code === '22023' ? 400 :
    error?.code === '40001' ? 409 : 503;
  return res.status(status).json({ success: false, error: {
    category: status === 403 ? 'FORECAST_DRILLDOWNS_RESTRICTED' :
      status === 400 ? 'FORECAST_DRILLDOWNS_REQUEST_INVALID' :
        status === 409 ? 'FORECAST_DRILLDOWNS_CHANGED' :
          'FORECAST_DRILLDOWNS_UNAVAILABLE',
    message: status === 403 ? 'You cannot view these forecast details.' :
      status === 400 ? 'Check the forecast detail request and try again.' :
        status === 409 ? 'The forecast detail evidence changed. Refresh and try again.' :
          'Forecast details are temporarily unavailable.',
  } });
}

function createForecastDrilldownsRouter(options = {}) {
  const router = express.Router();
  const poolProvider = options.poolProvider || (() => db.getPool());
  const auth = options.auth || requireOnboardedInternal;
  const permission = options.permission || requirePermission('forecast', 'read');
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `forecast-drilldowns:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
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
          category: 'FORECAST_DRILLDOWNS_NOT_FOUND',
          message: 'This forecast detail anchor was not found.',
        } });
      }
      const value = sanitizeForecastDrilldowns(projectForecastDrilldowns(raw));
      if (!value) throw new Error('Invalid guarded forecast drilldown projection');
      await client.query('COMMIT');
      return res.status(200).json({ success: true, data: value });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return failure(res, error);
    } finally { if (client) client.release(); }
  });
  return router;
}

module.exports = { VERSION, createForecastDrilldownsRouter,
  projectForecastDrilldowns, sanitizeForecastDrilldowns };
