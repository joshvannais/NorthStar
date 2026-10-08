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
const AMOUNT = /^(?:0|[1-9][0-9]{0,14})(?:\.[0-9]{1,6})?$/;
const UNAVAILABLE_REASONS = new Set([
  'source_or_profile_changed_refresh_required',
  'complete_period_lineage_unavailable',
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
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString().slice(0, 23) ===
    value.slice(0, 23);
}

function validDateOrder(left, right) {
  return validInstant(left) && validInstant(right) && Date.parse(left) < Date.parse(right);
}

function validEvaluation(value) {
  return exact(value, ['state','evaluatedAt','outcomeDigest','reason']) &&
    value.state === 'unavailable' && value.evaluatedAt === null &&
    value.outcomeDigest === null && value.reason === 'finalized_outcome_not_available';
}

function validDigests(value, current) {
  if (!exact(value, ['configuration','input','output','baseline','receipt'])) return false;
  return Object.values(value).every(item => current ? DIGEST.test(item || '') : item === null);
}

function validCurrentness(value, current) {
  return exact(value, ['sourceCurrent','refreshRequired','correctionOrRevocationApplied']) &&
    value.sourceCurrent === current && value.refreshRequired === !current &&
    value.correctionOrRevocationApplied === !current;
}

function validConfiguration(value) {
  return exact(value, ['version','targetKey','targetVersion','sourceScope','algorithmId',
    'algorithmVersion','method','minimumPeriods','horizonGrain','unit','decimalScale',
    'rounding','observationOrder']) &&
    value.version === 'm26-deterministic-baseline-configuration-v1' &&
    value.targetKey === 'demand.inbound_leads' && value.targetVersion === 'v1' &&
    value.sourceScope === 'retell_only_tenant_all' &&
    value.algorithmId === 'retell_three_complete_month_mean' &&
    value.algorithmVersion === 'm26-retell-three-month-mean-v2' &&
    value.method === 'arithmetic_mean_comparable_prior_periods' &&
    value.minimumPeriods === 3 && value.horizonGrain === 'business_local_month' &&
    value.unit === 'count' && value.decimalScale === 6 && value.rounding === 'half_up' &&
    value.observationOrder === 'local_month_start_ascending';
}

function validObservation(value) {
  return exact(value, ['localMonthStart','state','count','sourceWindowStartsAt',
    'sourceWindowEndsAt','sourceRecordedThrough','certificationId','certificationRevision',
    'certificationDigest','certificationAction','certificationRecordedAt','snapshotId',
    'snapshotDigest','coverageEvidenceDigest','providerScanDigest','callerConsentAttested',
    'providerCoverageAttestedRetellOnly','retentionAttested']) &&
    MONTH.test(value.localMonthStart || '') && value.state === 'complete' &&
    Number.isSafeInteger(value.count) && value.count >= 0 && value.count <= 1000000000 &&
    validDateOrder(value.sourceWindowStartsAt, value.sourceWindowEndsAt) &&
    validInstant(value.sourceRecordedThrough) &&
    Date.parse(value.sourceRecordedThrough) >= Date.parse(value.sourceWindowEndsAt) &&
    UUID.test(value.certificationId || '') && Number.isSafeInteger(value.certificationRevision) &&
    value.certificationRevision >= 1 && DIGEST.test(value.certificationDigest || '') &&
    value.certificationAction === 'certify' && validInstant(value.certificationRecordedAt) &&
    UUID.test(value.snapshotId || '') && DIGEST.test(value.snapshotDigest || '') &&
    DIGEST.test(value.coverageEvidenceDigest || '') && DIGEST.test(value.providerScanDigest || '') &&
    value.callerConsentAttested === true &&
    value.providerCoverageAttestedRetellOnly === true && value.retentionAttested === true;
}

function validOutput(value) {
  return exact(value, ['contractVersion','target','unit','value','confidence','uncertainty',
    'applicability','calculationVersion','researchOnly','realForecastEligible',
    'paidNumericServing','forecastServingEnabled']) &&
    value.contractVersion === 'm26-forecast-output-v1' &&
    exact(value.target, ['key','definitionVersion']) &&
    value.target.key === 'demand.inbound_leads' && value.target.definitionVersion === 'v1' &&
    exact(value.unit, ['key','currency']) && value.unit.key === 'count' &&
    value.unit.currency === null && exact(value.value, ['kind','amount']) &&
    value.value.kind === 'point' && AMOUNT.test(value.value.amount || '') &&
    exact(value.confidence, ['state','backtestDigest']) &&
    value.confidence.state === 'unavailable' && value.confidence.backtestDigest === null &&
    exact(value.uncertainty, ['state','drivers']) &&
    value.uncertainty.state === 'unquantified' && dense(value.uncertainty.drivers, 3) &&
    value.uncertainty.drivers.join('|') === 'retell_only|human_attested_coverage|uncalibrated' &&
    exact(value.applicability, ['serviceKey','areaKey','limits']) &&
    value.applicability.serviceKey === null && value.applicability.areaKey === null &&
    dense(value.applicability.limits, 2) &&
    value.applicability.limits.join('|') === 'retell_only|tenant_all' &&
    value.calculationVersion === 'm26-retell-three-month-mean-v2' &&
    value.researchOnly === true && value.realForecastEligible === false &&
    value.paidNumericServing === false && value.forecastServingEnabled === false;
}

function validSourceSnapshot(value, issuedAt, horizon) {
  if (!exact(value, ['state','completeAsOf','sourceScope','sourceAsOf','profile',
    'periodInventoryDigest','evidenceDigest','expectedPeriods','includedPeriods',
    'excludedPeriods','missingPeriods','stalePeriods','hasMore','paginationVersion',
    'nextCursor','observations','providerCoverageAttestedRetellOnly',
    'providerIndependentVerified','wholeBusinessCoverageVerified']) ||
      value.state !== 'complete_as_of' || value.completeAsOf !== true ||
      value.sourceScope !== 'retell_only_tenant_all' || value.sourceAsOf !== issuedAt ||
      !exact(value.profile, ['businessProfileId','businessProfileVersion',
        'businessProfileHash','timeZone']) || !UUID.test(value.profile.businessProfileId || '') ||
      !Number.isSafeInteger(value.profile.businessProfileVersion) ||
      value.profile.businessProfileVersion < 1 ||
      !DIGEST.test(value.profile.businessProfileHash || '') ||
      typeof value.profile.timeZone !== 'string' || value.profile.timeZone.length < 1 ||
      value.profile.timeZone.length > 100 || value.profile.timeZone !== horizon.timeZone ||
      !DIGEST.test(value.periodInventoryDigest || '') || !DIGEST.test(value.evidenceDigest || '') ||
      value.expectedPeriods !== 3 || value.includedPeriods !== 3 ||
      value.excludedPeriods !== 0 || value.missingPeriods !== 0 || value.stalePeriods !== 0 ||
      value.hasMore !== false || value.paginationVersion !== 'bounded_single_page' ||
      value.nextCursor !== null || !dense(value.observations, 3) ||
      !value.observations.every(validObservation) ||
      value.providerCoverageAttestedRetellOnly !== true ||
      value.providerIndependentVerified !== false ||
      value.wholeBusinessCoverageVerified !== false) return false;
  const months = value.observations.map(item => item.localMonthStart);
  const expectedMonths = [4, 3, 2].map(offset => {
    const date = new Date(`${horizon.localStart}T00:00:00.000Z`);
    date.setUTCMonth(date.getUTCMonth() - offset);
    return date.toISOString().slice(0, 10);
  });
  return new Set(months).size === 3 && months.join('|') === [...months].sort().join('|') &&
    months.join('|') === expectedMonths.join('|') &&
    value.observations.every(item => Date.parse(item.sourceRecordedThrough) <= Date.parse(issuedAt) &&
      Date.parse(item.certificationRecordedAt) <= Date.parse(issuedAt));
}

function sanitizeBaseline(value) {
  const keys = ['version','state','reason','originId','checkedAt','issuedAt','evaluationAsOf',
    'target','configuration','horizon','unit','sourceSnapshot','output','evaluation','digests',
    'currentness','sourceAuthenticated','researchOnly','realForecastEligible','forecastIssued',
    'paidNumericServing','probabilityIssued','calibratedRangeIssued','automaticActionAuthorized'];
  if (!exact(value, keys) || value.version !== 'm26-deterministic-baseline-v1' ||
      !['current','unavailable'].includes(value.state) || !UUID.test(value.originId || '') ||
      !validInstant(value.checkedAt) || !validEvaluation(value.evaluation) ||
      value.researchOnly !== true || value.realForecastEligible !== false ||
      value.paidNumericServing !== false || value.probabilityIssued !== false ||
      value.calibratedRangeIssued !== false || value.automaticActionAuthorized !== false) return null;
  if (value.state === 'unavailable') {
    if (!UNAVAILABLE_REASONS.has(value.reason) || value.issuedAt !== null ||
        value.evaluationAsOf !== null || value.target !== null || value.configuration !== null ||
        value.horizon !== null || value.unit !== null || value.sourceSnapshot !== null ||
        value.output !== null || !validDigests(value.digests, false) ||
        !validCurrentness(value.currentness, false) || value.sourceAuthenticated !== false ||
        value.forecastIssued !== false) return null;
    return value;
  }
  if (value.reason !== null || !validInstant(value.issuedAt) || value.evaluationAsOf !== null ||
      !exact(value.target, ['key','definitionVersion','sourceScope']) ||
      value.target.key !== 'demand.inbound_leads' || value.target.definitionVersion !== 'v1' ||
      value.target.sourceScope !== 'retell_only_tenant_all' ||
      !validConfiguration(value.configuration) ||
      !exact(value.horizon, ['localStart','startsAt','endsAt','grain','timeZone']) ||
      !MONTH.test(value.horizon.localStart || '') ||
      !validDateOrder(value.horizon.startsAt, value.horizon.endsAt) ||
      value.horizon.grain !== 'business_local_month' ||
      typeof value.horizon.timeZone !== 'string' || value.horizon.timeZone.length < 1 ||
      value.horizon.timeZone.length > 100 || Date.parse(value.issuedAt) >= Date.parse(value.horizon.startsAt) ||
      !exact(value.unit, ['key','currency']) || value.unit.key !== 'count' ||
      value.unit.currency !== null ||
      !validSourceSnapshot(value.sourceSnapshot, value.issuedAt, value.horizon) ||
      !validOutput(value.output) || !validDigests(value.digests, true) ||
      !validCurrentness(value.currentness, true) || value.sourceAuthenticated !== true ||
      value.forecastIssued !== true) return null;
  return value;
}

function failure(res, error) {
  const status = error?.code === '42501' ? 403 :
    ['22023','22P02'].includes(error?.code) ? 400 :
      ['40001','40P01','55P03'].includes(error?.code) ? 409 : 503;
  return res.status(status).json({ success: false, error: {
    category: status === 403 ? 'DETERMINISTIC_BASELINE_RESTRICTED' :
      status === 400 ? 'DETERMINISTIC_BASELINE_REQUEST_INVALID' :
        status === 409 ? 'DETERMINISTIC_BASELINE_CHANGED' :
          'DETERMINISTIC_BASELINE_UNAVAILABLE',
    message: status === 403 ? 'You cannot view this baseline.' :
      status === 400 ? 'Check the baseline request and try again.' :
        status === 409 ? 'The baseline changed. Refresh and try again.' :
          'The deterministic baseline is temporarily unavailable.',
  } });
}

function createForecastDeterministicBaselinesRouter(options = {}) {
  const router = express.Router();
  const poolProvider = options.poolProvider || (() => db.getPool());
  const auth = options.auth || requireOnboardedInternal;
  const permission = options.permission || requirePermission('forecast', 'read');
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `forecast-deterministic-baseline:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
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
        `SELECT public.canonical_forecast_deterministic_baseline_v1_read(
         $1,$2,$3,$4,$5) value`, [req.tenantContext.organizationId,
          req.tenantContext.userId, req.userRole, req.authSession.id,
          req.params.originId])).rows[0]?.value;
      if (raw === null || raw === undefined) {
        await client.query('COMMIT');
        return res.status(404).json({ success: false, error: {
          category: 'DETERMINISTIC_BASELINE_NOT_FOUND',
          message: 'This deterministic baseline was not found.',
        } });
      }
      const value = sanitizeBaseline(raw);
      if (!value) throw new Error('Invalid deterministic baseline projection');
      await client.query('COMMIT');
      return res.status(200).json({ success: true, data: value });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return failure(res, error);
    } finally { if (client) client.release(); }
  });
  return router;
}

module.exports = { createForecastDeterministicBaselinesRouter, sanitizeBaseline };
