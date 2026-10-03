'use strict';

const express = require('express');
const db = require('../db');
const { requireOnboardedInternal } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { rateLimit } = require('../middleware/rateLimit');
const { readReviewedRetellLeadReceipts } =
  require('../forecasting/retellReviewedLeadReceipts');
const { inspectRetellCallWindow } = require('../forecasting/retellCallScanReader');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const PROVIDER_ID = /^[A-Za-z0-9_-]{1,160}$/;
const KEY = /^[A-Za-z0-9._:-]{16,128}$/;
const INSTANT =
  /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)\.(\d{6})Z$/;
const DATABASE_INSTANT =
  /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d{1,6}))?(Z|[+-]\d\d:\d\d)$/;
const PURPOSE = 'forecast_demand_source';
const TARGET = 'retell.inbound_calls';
const SNAPSHOT_VERSION = 'm26-as-of-source-manifest-v1';
const CONSENT_VERSION = 'm26-retell-demand-source-consent-v1';
const CONSENT_BOUNDARY =
  'Company permission does not establish caller consent, provider coverage or retention.';
const SNAPSHOT_BOUNDARY =
  'Retell call receipts are not distinct reviewed lead identities or complete provider coverage.';
const REVIEW_BOUNDARY =
  'Call dispositions are review evidence, not certified provider coverage or a lead forecast.';
const REVIEWED_BOUNDARY =
  'Reviewed identities only; no caller consent, retention, provider coverage or forecast is certified.';
const MONTH = /^\d{4}-(0[1-9]|1[0-2])-01$/;
const TRANSITION_TARGETS = [
  'demand.qualification_transition.v1',
  'demand.estimate_request_transition.v1',
  'demand.booking_transition.v1',
  'demand.booking_cancellation.v1',
];
const TRANSITION_METHOD_REVIEW_VERSION = 'm26-transition-method-review-v2';

function exact(value, keys) {
  const prototype = value && typeof value === 'object' ?
    Object.getPrototypeOf(value) : undefined;
  return value && typeof value === 'object' && !Array.isArray(value) &&
    (prototype === Object.prototype || prototype === null) &&
    Object.keys(value).length === keys.length &&
    Object.keys(value).every(key => keys.includes(key));
}

function invalid(res) {
  return res.status(400).json({ success: false, error: {
    category: 'FORECAST_DEMAND_SOURCE_REQUEST_INVALID',
    message: 'Check the demand source details and try again.',
  } });
}

function failure(res, error) {
  const status = error?.code === '42501' ? 403 :
    error?.code === '22023' ? 400 :
      ['23505', '40001', '40P01', '55P03'].includes(error?.code) ? 409 : 503;
  return res.status(status).json({ success: false, error: {
    category: status === 403 ? 'FORECAST_DEMAND_SOURCE_RESTRICTED' :
      status === 400 ? 'FORECAST_DEMAND_SOURCE_REQUEST_INVALID' :
        error?.code === '23505' ? 'FORECAST_DEMAND_SOURCE_REQUEST_REUSED' :
          ['40P01', '55P03', '57014'].includes(error?.code) ?
            'FORECAST_DEMAND_SOURCE_BUSY' :
            status === 409 ? 'FORECAST_DEMAND_SOURCE_CHANGED' :
              'FORECAST_DEMAND_SOURCE_UNAVAILABLE',
    message: status === 403 ? 'You cannot access this demand source.' :
      status === 400 ? 'Check the demand source details and try again.' :
        error?.code === '23505' ?
          'This request was already used with different details. Start a new request.' :
          ['40P01', '55P03', '57014'].includes(error?.code) ?
            'The demand source is busy. Try again shortly.' :
            status === 409 ? 'The demand source changed. Refresh and try again.' :
              'The demand source is temporarily unavailable.',
  } });
}

function actor(req) {
  return { organizationId: req.tenantContext.organizationId,
    actorUserId: req.tenantContext.userId, actorAccessRole: req.userRole,
    authSessionId: req.authSession.id };
}

function validCalendarInstant(value, expression) {
  const match = typeof value === 'string' ? expression.exec(value) : null;
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 ||
      day > new Date(Date.UTC(year, month, 0)).getUTCDate() ||
      hour > 23 || minute > 59 || second > 59) return false;
  const zone = match[8];
  if (zone && zone !== 'Z') {
    const offset = /([+-])(\d\d):(\d\d)/.exec(zone);
    if (!offset || Number(offset[2]) > 23 || Number(offset[3]) > 59) return false;
  }
  return Number.isFinite(Date.parse(value));
}

function validTimestamp(value) {
  return validCalendarInstant(value, DATABASE_INSTANT);
}

function validUtcInstant(value) {
  return validCalendarInstant(value, INSTANT);
}

function validMonth(value) {
  return typeof value === 'string' && MONTH.test(value) &&
    Number.isFinite(Date.parse(value + 'T00:00:00.000Z'));
}

function validTransitionTargets(value) {
  return Array.isArray(value) && value.length === TRANSITION_TARGETS.length &&
    value.every((target, index) => target === TRANSITION_TARGETS[index]);
}

function utcMicros(value) {
  if (!validUtcInstant(value)) return null;
  const milliseconds = Date.parse(value.slice(0, 23) + 'Z');
  return BigInt(milliseconds) * 1000n + BigInt(value.slice(23, 26));
}

function validConsentItem(item) {
  return item && UUID.test(item.id || '') && item.purposeKey === PURPOSE &&
    Number.isSafeInteger(item.revision) && item.revision >= 1 &&
    (item.previousId === null || UUID.test(item.previousId || '')) &&
    ['grant', 'revoke'].includes(item.action) &&
    Array.isArray(item.sourceScope) && item.sourceScope.length === 1 &&
    item.sourceScope[0] === TARGET && item.consentVersion === CONSENT_VERSION &&
    typeof item.reason === 'string' && item.reason.trim().length >= 10 &&
    item.reason.length <= 1000 && Buffer.byteLength(item.reason) <= 4000 &&
    DIGEST.test(item.digest || '') && validTimestamp(item.createdAt) &&
    item.boundary === CONSENT_BOUNDARY;
}

function safeConsent(value) {
  if (!value || typeof value.active !== 'boolean' || !Array.isArray(value.history) ||
      !Number.isSafeInteger(value.total) || value.total < 0 ||
      typeof value.truncated !== 'boolean' || value.history.length > 20 ||
      value.history.length > value.total || value.truncated !== (value.total > 20) ||
      value.history.some(item => !validConsentItem(item)) ||
      (value.current !== null && !validConsentItem(value.current)) ||
      (value.current === null && (value.active || value.total !== 0 ||
        value.history.length !== 0)) ||
      (value.current !== null && (value.history.length === 0 ||
        value.current.id !== value.history[0].id ||
        value.current.revision !== value.history[0].revision ||
        value.current.digest !== value.history[0].digest ||
        value.active !== (value.current.action === 'grant')))) return null;
  for (let index = 0; index + 1 < value.history.length; index += 1) {
    if (value.history[index].previousId !== value.history[index + 1].id ||
        value.history[index].revision !== value.history[index + 1].revision + 1) return null;
  }
  if (value.current !== null && (value.current.revision !== value.total ||
      (value.total === value.history.length &&
        value.history.at(-1).previousId !== null))) return null;
  const project = item => item && ({ id: item.id, revision: item.revision,
    action: item.action, digest: item.digest, createdAt: item.createdAt,
    reason: item.reason, sourceScope: item.sourceScope,
    boundary: item.boundary });
  return { state: value.active ? 'company_permission_active' :
    'company_permission_inactive', active: value.active,
  current: project(value.current), history: value.history.map(project),
  total: value.total, truncated: value.truncated,
  callerConsentVerified: false, providerCoverageVerified: false,
  retentionVerified: false, forecastIssued: false };
}

function validSource(item) {
  return item && item.sourceKind === 'retell_call' &&
    UUID.test(item.sourceId || '') && item.revision === 1 &&
    DIGEST.test(item.digest || '') && item.state === 'active' &&
    validUtcInstant(item.recordedAt) &&
    (item.eventAt === null || validUtcInstant(item.eventAt));
}

function validCurrentSnapshot(value, organizationId, requireReadFlags) {
  return value && UUID.test(value.id || '') &&
    value.version === SNAPSHOT_VERSION && value.organizationId === organizationId &&
    value.purposeKey === PURPOSE && value.targetKey === TARGET &&
    validUtcInstant(value.asOf) && validUtcInstant(value.capturedAt) &&
    value.asOf === value.capturedAt && UUID.test(value.sourceConsentId || '') &&
    DIGEST.test(value.sourceConsentDigest || '') &&
    value.identityBoundary === SNAPSHOT_BOUNDARY &&
    DIGEST.test(value.sourceSnapshotDigest || '') && Array.isArray(value.sources) &&
    value.sources.length <= 1000 && value.sourceCount === value.sources.length &&
    !value.sources.some(item => !validSource(item)) &&
    (!requireReadFlags || (value.stale === false && value.refreshRequired === false));
}

function createForecastDemandSourcesRouter(options = {}) {
  const router = express.Router();
  const poolProvider = options.poolProvider || (() => db.getPool());
  const auth = options.auth || requireOnboardedInternal;
  const readReviewed = options.readReviewed || readReviewedRetellLeadReceipts;
  const inspectWindow = options.inspectWindow || inspectRetellCallWindow;
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `forecast-demand-source:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
  const captureThrottle = options.captureThrottle || rateLimit('forecast-source-capture', req =>
    `forecast-demand-source-capture:${req.tenantContext.organizationId}`);
  const periodCertificationThrottle = options.periodCertificationThrottle ||
    rateLimit('forecast-period-certification', req =>
      `forecast-period-certification:${req.tenantContext.organizationId}`);
  const reviewThrottle = options.reviewThrottle || rateLimit('forecast-source-review', req =>
    `forecast-demand-source-review:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
  const originThrottle = options.originThrottle || rateLimit('forecast-transition-origin', req =>
    `forecast-transition-origin:${req.tenantContext.organizationId}`);
  const evaluationThrottle = options.evaluationThrottle ||
    rateLimit('forecast-evaluation-capture', req =>
      `forecast-transition-evaluation:${req.tenantContext.organizationId}`);

  router.use((_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('Referrer-Policy', 'no-referrer');
    res.vary('Cookie');
    next();
  });

  async function run(req, res, { isolation = 'READ COMMITTED', sql, params,
    write = false, validate }) {
    let client;
    try {
      client = await poolProvider().connect();
      await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
      await client.query("SET LOCAL statement_timeout = '10000ms'");
      await client.query("SET LOCAL lock_timeout = '2000ms'");
      const identity = [req.tenantContext.organizationId,
        req.tenantContext.userId, req.userRole, req.authSession.id];
      const value = (await client.query(sql, [...identity, ...params])).rows[0]?.value;
      const data = validate(value);
      if (!data) throw new Error('Invalid guarded demand source result');
      await client.query('COMMIT');
      if (write && value.replayed === true) res.set('Idempotency-Replayed', 'true');
      return res.status(write && value.replayed === false ? 201 : 200)
        .json({ success: true, data });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return failure(res, error);
    } finally { if (client) client.release(); }
  }

  router.get('/retell/consent', auth, requirePermission('forecast', 'read'), throttle,
    async (req, res) => {
      if (!exact(req.query, [])) return invalid(res);
      return run(req, res, {
        sql: 'SELECT public.canonical_forecast_retell_source_consent_read($1,$2,$3,$4) value',
        params: [], validate: safeConsent,
      });
    });

  router.post('/retell/consent', auth, requirePermission('forecast', 'update'),
    captureThrottle, async (req, res) => {
      const body = req.body, key = req.get('Idempotency-Key');
      if (!exact(req.query, []) ||
          !exact(body, ['action', 'expectedRevision', 'expectedDigest', 'reason',
        'confirmed', 'confirmationVersion']) ||
          !['grant', 'revoke'].includes(body.action) ||
          !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0 ||
          body.expectedRevision > 10000 ||
          !(body.expectedDigest === 'none' || DIGEST.test(body.expectedDigest || '')) ||
          typeof body.reason !== 'string' || body.reason.trim().length < 10 ||
          body.reason.length > 1000 || Buffer.byteLength(body.reason) > 4000 ||
          body.confirmed !== true ||
          body.confirmationVersion !== 'm26-retell-demand-source-consent-v1' ||
          !KEY.test(key || '')) return invalid(res);
      return run(req, res, { isolation: 'SERIALIZABLE', write: true,
        sql: 'SELECT public.canonical_forecast_retell_source_consent_mutate($1,$2,$3,$4,$5,$6,$7::jsonb) value',
        params: [req.get('X-CSRF-Token'), key, JSON.stringify(body)],
        validate(value) {
          if (!value || !validConsentItem(value.consent) ||
              value.consent.action !== body.action || typeof value.replayed !== 'boolean' ||
              typeof value.current !== 'boolean' || typeof value.active !== 'boolean' ||
              value.active !== (value.current && value.consent.action === 'grant')) {
            return null;
          }
          return { state: value.active ? 'company_permission_active' :
            'company_permission_inactive', consentId: value.consent.id,
          revision: value.consent.revision, digest: value.consent.digest,
          action: value.consent.action, current: value.current,
          replayed: value.replayed, callerConsentVerified: false,
          providerCoverageVerified: false, retentionVerified: false,
          forecastIssued: false };
        } });
    });

  router.post('/retell/snapshots', auth, requirePermission('forecast', 'update'),
    captureThrottle, async (req, res) => {
      const key = req.get('Idempotency-Key');
      if (!exact(req.query, []) || !exact(req.body, []) || !KEY.test(key || '')) {
        return invalid(res);
      }
      return run(req, res, { isolation: 'SERIALIZABLE', write: true,
        sql: 'SELECT public.canonical_forecast_retell_call_snapshot_capture($1,$2,$3,$4,$5,$6) value',
        params: [req.get('X-CSRF-Token'), key], validate(value) {
          const snapshot = value?.snapshot;
          if (!snapshot || !UUID.test(snapshot.id || '') || typeof value.replayed !== 'boolean') {
            return null;
          }
          if (snapshot.stale === true && snapshot.refreshRequired === true &&
              Array.isArray(snapshot.sources) && snapshot.sources.length === 0) {
            return { state: 'source_receipt_stale', snapshotId: snapshot.id,
              sourceSnapshotDigest: DIGEST.test(snapshot.sourceSnapshotDigest || '') ?
                snapshot.sourceSnapshotDigest : null,
              sourceCount: 0, replayed: value.replayed,
              reviewedLeadIdentityVerified: false, callerConsentVerified: false,
              providerCoverageVerified: false, retentionVerified: false,
              historicalCoverageVerified: false, forecastIssued: false };
          }
          if (!validCurrentSnapshot(snapshot,
            req.tenantContext.organizationId, false)) return null;
          return { state: 'retell_call_source_recorded', snapshotId: snapshot.id,
          sourceSnapshotDigest: snapshot.sourceSnapshotDigest,
          sourceCount: snapshot.sourceCount, replayed: value.replayed,
          reviewedLeadIdentityVerified: false, callerConsentVerified: false,
          providerCoverageVerified: false, retentionVerified: false,
          historicalCoverageVerified: false, forecastIssued: false };
        } });
    });

  router.get('/retell/snapshots/:snapshotId', auth,
    requirePermission('forecast', 'read'), throttle, async (req, res) => {
      if (!UUID.test(req.params.snapshotId || '') || !exact(req.query, [])) return invalid(res);
      return run(req, res, {
        sql: 'SELECT public.canonical_forecast_retell_call_snapshot_read($1,$2,$3,$4,$5) value',
        params: [req.params.snapshotId.toLowerCase()], validate(value) {
          if (!value || value.id !== req.params.snapshotId.toLowerCase() ||
              typeof value.stale !== 'boolean' || !Array.isArray(value.sources) ||
              value.sources.length > 1000) return null;
          if (value.stale === true) {
            if (value.refreshRequired !== true || value.sources.length !== 0) return null;
            return { state: 'source_receipt_stale', snapshotId: value.id,
              sourceSnapshotDigest: DIGEST.test(value.sourceSnapshotDigest || '') ?
                value.sourceSnapshotDigest : null,
              sources: [], refreshRequired: true,
              reviewedLeadIdentityVerified: false, historicalCoverageVerified: false,
              providerCoverageVerified: false, retentionVerified: false,
              forecastIssued: false };
          }
          if (!validCurrentSnapshot(value,
            req.tenantContext.organizationId, true)) return null;
          return { state: 'retell_call_source_current', snapshotId: value.id,
            sourceSnapshotDigest: value.sourceSnapshotDigest,
            sources: value.sources.map(item => ({ callSourceId: item.sourceId,
              sourceDigest: item.digest, occurredAt: item.eventAt,
              recordedAt: item.recordedAt })), refreshRequired: false,
            reviewedLeadIdentityVerified: false, historicalCoverageVerified: false,
            providerCoverageVerified: false, retentionVerified: false,
            forecastIssued: false };
        } });
    });

  router.get('/retell/snapshots/:snapshotId/reviews', auth,
    requirePermission('forecast', 'read'), throttle, async (req, res) => {
      if (!UUID.test(req.params.snapshotId || '') || !exact(req.query, [])) return invalid(res);
      return run(req, res, {
        sql: 'SELECT public.canonical_forecast_retell_call_reviews_read($1,$2,$3,$4,$5) value',
        params: [req.params.snapshotId.toLowerCase()], validate(value) {
          if (!value || value.snapshotId !== req.params.snapshotId.toLowerCase() ||
              typeof value.stale !== 'boolean' || !Array.isArray(value.calls) ||
              value.calls.length > 1000) return null;
          const ids = new Set();
          if (value.calls.some(item => {
            if (!UUID.test(item?.callSourceId || '') || ids.has(item.callSourceId) ||
                !['reviewed', 'unresolved'].includes(item.status) ||
                !Number.isSafeInteger(item.reviewRevision) || item.reviewRevision < 0) return true;
            ids.add(item.callSourceId);
            return item.status === 'reviewed' ?
              (!['new_lead', 'repeat_lead', 'not_lead'].includes(item.disposition) ||
               item.reviewRevision < 1 || !DIGEST.test(item.reviewDigest || '') ||
               !validUtcInstant(item.reviewedAt) ||
               (item.disposition === 'repeat_lead' ?
                 !UUID.test(item.anchorCallSourceId || '') : item.anchorCallSourceId !== null)) :
              item.disposition !== null || item.anchorCallSourceId !== null ||
                item.reviewedAt !== null ||
                (item.reviewDigest !== null && !DIGEST.test(item.reviewDigest || ''));
          })) return null;
          if (value.stale === false &&
              (!DIGEST.test(value.sourceSnapshotDigest || '') ||
               value.boundary !== REVIEW_BOUNDARY ||
               !Number.isSafeInteger(value.callCount) ||
               !Number.isSafeInteger(value.reviewedCount) ||
               !Number.isSafeInteger(value.unresolvedCount) ||
               value.callCount !== value.calls.length ||
               value.reviewedCount < 0 || value.unresolvedCount < 0 ||
               value.reviewedCount + value.unresolvedCount !== value.callCount ||
               value.calls.filter(item => item.status === 'reviewed').length !==
                 value.reviewedCount)) return null;
          if (value.stale === true && value.calls.length !== 0) return null;
          return { state: value.stale ? 'source_receipt_stale' :
            value.unresolvedCount === 0 ? 'call_reviews_complete' : 'call_reviews_incomplete',
          snapshotId: value.snapshotId, sourceSnapshotDigest:
            value.sourceSnapshotDigest || null, callCount: value.callCount ?? value.calls.length,
          reviewedCount: value.reviewedCount ?? 0,
          unresolvedCount: value.unresolvedCount ?? value.calls.length,
          calls: value.calls.map(item => ({ callSourceId: item.callSourceId,
            status: item.status, disposition: item.disposition || null,
            anchorCallSourceId: item.anchorCallSourceId || null,
            reviewRevision: item.reviewRevision,
            reviewDigest: item.reviewDigest || null })),
          historicalCoverageVerified: false, providerCoverageVerified: false,
          forecastIssued: false };
        } });
    });

  router.post('/retell/snapshots/:snapshotId/reviews/:callSourceId', auth,
    requirePermission('forecast', 'update'), reviewThrottle, async (req, res) => {
      const body = req.body, key = req.get('Idempotency-Key');
      const keys = ['expectedSourceDigest', 'expectedRevision', 'expectedDigest',
        'disposition', 'anchorCallSourceId', 'reason', 'confirmed', 'confirmationVersion'];
      if (!UUID.test(req.params.snapshotId || '') || !exact(req.query, []) ||
          !UUID.test(req.params.callSourceId || '') || !exact(body, keys) ||
          !DIGEST.test(body.expectedSourceDigest || '') ||
          !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0 ||
          body.expectedRevision > 10000 ||
          !(body.expectedDigest === 'none' || DIGEST.test(body.expectedDigest || '')) ||
          !['new_lead', 'repeat_lead', 'not_lead', 'unresolved'].includes(body.disposition) ||
          (body.disposition === 'repeat_lead' ?
            !UUID.test(body.anchorCallSourceId || '') : body.anchorCallSourceId !== null) ||
          typeof body.reason !== 'string' || body.reason.trim().length < 10 ||
          body.reason.length > 1000 || Buffer.byteLength(body.reason) > 4000 ||
          body.confirmed !== true ||
          body.confirmationVersion !== 'm26-retell-call-review-v1' ||
          !KEY.test(key || '')) return invalid(res);
      const guardedBody = { transcriptId: req.params.callSourceId.toLowerCase(),
        expectedSourceDigest: body.expectedSourceDigest,
        expectedRevision: body.expectedRevision, expectedDigest: body.expectedDigest,
        disposition: body.disposition, anchorTranscriptId:
          body.anchorCallSourceId?.toLowerCase() || null, reason: body.reason,
        confirmed: true, confirmationVersion: body.confirmationVersion };
      return run(req, res, { isolation: 'SERIALIZABLE', write: true,
        sql: 'SELECT public.canonical_forecast_retell_call_review_mutate($1,$2,$3,$4,$5,$6,$7,$8::jsonb) value',
        params: [req.get('X-CSRF-Token'), key, req.params.snapshotId.toLowerCase(),
          JSON.stringify(guardedBody)], validate(value) {
          if (!value || !UUID.test(value.id || '') ||
              !Number.isSafeInteger(value.revision) || value.revision < 1 ||
              !DIGEST.test(value.digest || '') || typeof value.replayed !== 'boolean' ||
              !['recorded', 'stale'].includes(value.status)) return null;
          return { state: value.status === 'recorded' ? 'call_review_recorded' :
            'call_review_stale', reviewId: value.id, revision: value.revision,
          digest: value.digest, replayed: value.replayed,
          providerCoverageVerified: false, historicalCoverageVerified: false,
          forecastIssued: false };
        } });
    });

  router.get('/retell/snapshots/:snapshotId/reviewed-source-window', auth,
    requirePermission('forecast', 'read'), throttle, async (req, res) => {
      if (!UUID.test(req.params.snapshotId || '') ||
          !exact(req.query, ['startsAt', 'endsAt']) ||
          !validUtcInstant(req.query.startsAt) || !validUtcInstant(req.query.endsAt)) {
        return invalid(res);
      }
      try {
        const client = await poolProvider().connect();
        let value;
        try {
          await client.query('BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY');
          await client.query("SET LOCAL statement_timeout = '10000ms'");
          await client.query("SET LOCAL lock_timeout = '2000ms'");
          value = await readReviewed({ pool: client, actor: actor(req),
            snapshotId: req.params.snapshotId.toLowerCase(),
            startsAt: req.query.startsAt, endsAt: req.query.endsAt });
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK').catch(() => {});
          throw error;
        } finally { client.release(); }
        const receiptIds = new Set();
        if (!value || !['unavailable', 'reviewed_source_only'].includes(value.state) ||
            (value.state === 'unavailable' &&
              (typeof value.reason !== 'string' || value.reason.length === 0)) ||
            (value.state === 'reviewed_source_only' &&
              (!DIGEST.test(value.sourceSnapshotDigest || '') ||
               !Array.isArray(value.leadReceipts) || value.leadReceipts.length > 1000 ||
               !Number.isSafeInteger(value.callCount) || value.callCount < 0 ||
               !Number.isSafeInteger(value.reviewedDistinctLeadCount) ||
               value.reviewedDistinctLeadCount < 0 ||
               value.reviewedDistinctLeadCount > value.callCount ||
               value.leadReceipts.length !== value.reviewedDistinctLeadCount ||
               value.historicalCoverageCertified !== false ||
               value.boundary !== REVIEWED_BOUNDARY ||
               value.leadReceipts.some(receipt => {
                 const first = utcMicros(receipt?.firstReceiptAt);
                 const reviewed = utcMicros(receipt?.reviewedAt);
                 if (!exact(receipt, ['organizationId', 'leadId', 'firstReceiptAt',
                   'reviewedAt', 'sourceDigest', 'state']) ||
                     receipt.organizationId !== req.tenantContext.organizationId ||
                     !UUID.test(receipt.leadId || '') || receiptIds.has(receipt.leadId) ||
                     first === null || reviewed === null || reviewed < first ||
                     !DIGEST.test(receipt.sourceDigest || '') || receipt.state !== 'active') {
                   return true;
                 }
                 receiptIds.add(receipt.leadId);
                 return false;
               })))) {
          throw new Error('Invalid guarded reviewed source result');
        }
        return res.json({ success: true, data: value.state === 'unavailable' ? {
          state: 'unavailable', reason: value.reason, historicalCoverageVerified: false,
          providerCoverageVerified: false, forecastIssued: false,
        } : { state: 'reviewed_source_only', snapshotId:
          req.params.snapshotId.toLowerCase(),
        sourceSnapshotDigest: value.sourceSnapshotDigest,
        callCount: value.callCount,
        reviewedDistinctLeadCount: value.reviewedDistinctLeadCount,
        historicalCoverageVerified: false, providerCoverageVerified: false,
        retentionVerified: false, forecastIssued: false } });
      } catch (error) { return failure(res, error); }
    });

  router.post('/retell/period-snapshots', auth,
    requirePermission('forecast', 'update'), periodCertificationThrottle, async (req, res) => {
      const body = req.body, key = req.get('Idempotency-Key');
      if (!exact(req.query, []) || !exact(body, ['localMonthStart']) ||
          !validMonth(body.localMonthStart) || !KEY.test(key || '')) return invalid(res);
      return run(req, res, { isolation: 'READ COMMITTED', write: true,
        sql: `SELECT public.canonical_forecast_retell_period_snapshot_v2_capture(
          $1,$2,$3,$4,$5,$6,$7::date) value`,
        params: [req.get('X-CSRF-Token'), key, body.localMonthStart], validate(value) {
          if (!value || !['retell_period_snapshot_saved',
            'retell_period_snapshot_unavailable'].includes(value.state) ||
              typeof value.replayed !== 'boolean') return null;
          if (value.state === 'retell_period_snapshot_unavailable') {
            if (typeof value.reason !== 'string' || !value.reason) return null;
            return { state: value.state, reason: value.reason,
              localMonthStart: body.localMonthStart,
              refreshRequired: ['source_changed_refresh_required',
                'source_permission_changed_refresh_required'].includes(value.reason),
              providerCoverageVerified: false,
              wholeBusinessCoverageVerified: false, forecastIssued: false };
          }
          const snapshot = value.snapshot;
          if (!validCurrentSnapshot(snapshot, req.tenantContext.organizationId, false) ||
              snapshot.windowVersion !== 'm26-retell-period-source-window-v2' ||
              snapshot.localMonthStart !== body.localMonthStart ||
              !validUtcInstant(snapshot.sourceWindowStartsAt) ||
              !validUtcInstant(snapshot.sourceWindowEndsAt) ||
              utcMicros(snapshot.sourceWindowStartsAt) >= utcMicros(snapshot.sourceWindowEndsAt)) {
            return null;
          }
          return { state: value.state, snapshotId: snapshot.id,
            localMonthStart: snapshot.localMonthStart,
            sourceWindowStartsAt: snapshot.sourceWindowStartsAt,
            sourceWindowEndsAt: snapshot.sourceWindowEndsAt,
            sourceSnapshotDigest: snapshot.sourceSnapshotDigest,
            sources: snapshot.sources.map(item => ({ callSourceId: item.sourceId,
              sourceDigest: item.digest, occurredAt: item.eventAt,
              recordedAt: item.recordedAt })), sourceCount: snapshot.sourceCount,
            replayed: value.replayed, reviewedLeadIdentityVerified: false,
            providerCoverageVerified: false, wholeBusinessCoverageVerified: false,
            forecastIssued: false };
        } });
    });

  router.get('/retell/period-certifications/:localMonthStart', auth,
    requirePermission('forecast', 'read'), throttle, async (req, res) => {
      if (!validMonth(req.params.localMonthStart) || !exact(req.query, [])) return invalid(res);
      return run(req, res, {
        sql: `SELECT public.canonical_forecast_retell_period_certification_v2_read(
          $1,$2,$3,$4,$5::date) value`, params: [req.params.localMonthStart],
        validate(value) {
          if (!value || value.localMonthStart !== req.params.localMonthStart ||
              !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0 ||
              !(value.expectedDigest === 'none' || DIGEST.test(value.expectedDigest || ''))) {
            return null;
          }
          if (value.state === 'retell_period_certification_missing') return {
            state: value.state, localMonthStart: value.localMonthStart,
            expectedRevision: 0, expectedDigest: 'none',
            providerCoverageVerified: false, wholeBusinessCoverageVerified: false,
            forecastIssued: false };
          if (!['retell_period_certified', 'retell_period_revoked'].includes(value.state) ||
              !UUID.test(value.id || '') || !UUID.test(value.snapshotId || '') ||
              !Number.isSafeInteger(value.revision) || value.revision < 1 ||
              !DIGEST.test(value.digest || '') || value.expectedRevision !== value.revision ||
              value.expectedDigest !== value.digest || !['certify', 'revoke'].includes(value.action) ||
              !validUtcInstant(value.recordedAt)) return null;
          return { state: value.state, id: value.id,
            localMonthStart: value.localMonthStart, snapshotId: value.snapshotId,
            revision: value.revision, digest: value.digest, action: value.action,
            recordedAt: value.recordedAt, expectedRevision: value.expectedRevision,
            expectedDigest: value.expectedDigest,
            callerConsentAttested: value.callerConsentAttested,
            providerCoverageAttested: value.providerCoverageAttested,
            retentionAttested: value.retentionAttested,
            providerIndependentVerified: false, wholeBusinessCoverageVerified: false,
            forecastIssued: false, paidNumericServing: false };
        } });
    });

  router.post('/retell/period-certifications', auth,
    requirePermission('forecast', 'update'), periodCertificationThrottle, async (req, res) => {
      const body = req.body, key = req.get('Idempotency-Key');
      const keys = ['action', 'snapshotId', 'localMonthStart', 'expectedRevision',
        'expectedDigest', 'callerConsentAttested', 'providerCoverageAttested',
        'retentionAttested', 'reason', 'confirmed', 'confirmationVersion'];
      if (!exact(req.query, []) || !exact(body, keys) ||
          !['certify', 'revoke'].includes(body.action) ||
          !UUID.test(body.snapshotId || '') || !validMonth(body.localMonthStart) ||
          !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0 ||
          body.expectedRevision > 10000 ||
          !(body.expectedDigest === 'none' || DIGEST.test(body.expectedDigest || '')) ||
          typeof body.reason !== 'string' || body.reason.trim().length < 10 ||
          body.reason.length > 1000 || Buffer.byteLength(body.reason) > 4000 ||
          body.confirmed !== true ||
          body.confirmationVersion !== 'm26-retell-period-certification-v2' ||
          typeof body.callerConsentAttested !== 'boolean' ||
          typeof body.providerCoverageAttested !== 'boolean' ||
          typeof body.retentionAttested !== 'boolean' ||
          (body.action === 'certify' &&
            (!body.callerConsentAttested || !body.providerCoverageAttested ||
             !body.retentionAttested)) || !KEY.test(key || '')) return invalid(res);
      const identity = [req.tenantContext.organizationId,
        req.tenantContext.userId, req.userRole, req.authSession.id];
      let evidenceDigest = '0'.repeat(64), providerScanCount = 0;
      let providerScanDigest = '0'.repeat(64);
      let providerScanEvidence = {};
      try {
        if (body.action === 'certify') {
          const prepareClient = await poolProvider().connect();
          let evidence;
          try {
            // The guarded period reader takes source/profile SHARE locks to
            // prevent a concurrent correction from crossing this scan. Keep
            // the route side-effect free, but do not declare the transaction
            // READ ONLY because PostgreSQL forbids those required row locks.
            await prepareClient.query('BEGIN ISOLATION LEVEL READ COMMITTED');
            await prepareClient.query("SET LOCAL statement_timeout = '10000ms'");
            await prepareClient.query("SET LOCAL lock_timeout = '2000ms'");
            evidence = (await prepareClient.query(
              `SELECT public.canonical_forecast_retell_period_evidence_v2(
               $1,$2,$3,$4,$5,$6::date) value`,
              [...identity, body.snapshotId.toLowerCase(), body.localMonthStart])).rows[0]?.value;
            await prepareClient.query('COMMIT');
          } catch (error) {
            await prepareClient.query('ROLLBACK').catch(() => {}); throw error;
          } finally { prepareClient.release(); }
          if (!evidence || evidence.state !== 'retell_period_ready_for_certification' ||
              evidence.organizationId !== req.tenantContext.organizationId ||
              evidence.snapshotId !== body.snapshotId.toLowerCase() ||
              evidence.localMonthStart !== body.localMonthStart ||
              !UUID.test(evidence.integrationOwnershipId || '') ||
              !PROVIDER_ID.test(evidence.agentId || '') ||
              !DIGEST.test(evidence.snapshotDigest || '') ||
              !DIGEST.test(evidence.providerCallDigestSetDigest || '') ||
              !validUtcInstant(evidence.startsAt) || !validUtcInstant(evidence.endsAt) ||
              !DIGEST.test(evidence.sourceManifestDigest || '') ||
              !Number.isSafeInteger(evidence.sourceCount) || evidence.sourceCount < 0 ||
              evidence.sourceCount > 1000 || !Number.isSafeInteger(
                evidence.reviewedDistinctLeadCount) ||
              evidence.reviewedDistinctLeadCount < 0 ||
              evidence.reviewedDistinctLeadCount > evidence.sourceCount ||
              evidence.scope !== 'retell_only_tenant_all' ||
              evidence.targetKey !== 'demand.inbound_leads' || evidence.targetVersion !== 'v1') {
            return res.status(409).json({ success: false, error: {
              category: 'FORECAST_DEMAND_SOURCE_CHANGED',
              message: 'The demand source changed. Refresh and try again.',
            } });
          }
          const scan = await inspectWindow({ pool: poolProvider(), actor: actor(req),
            snapshotId: body.snapshotId.toLowerCase(), startsAt: evidence.startsAt,
            endsAt: evidence.endsAt, fetchPage: options.fetchRetellPage });
          if (!scan || scan.state !== 'snapshot_matched' ||
              !Number.isSafeInteger(scan.callCount) ||
              scan.callCount !== evidence.sourceCount ||
              scan.agentId !== evidence.agentId ||
              !Array.isArray(scan.canonicalCallDigests) ||
              scan.canonicalCallDigests.length !== scan.callCount ||
              scan.sourceSnapshotDigest !== evidence.snapshotDigest ||
              !validUtcInstant(scan.scannedAt) ||
              !UUID.test(evidence.integrationOwnershipId || '')) {
            return res.status(409).json({ success: false, error: {
              category: 'FORECAST_DEMAND_SOURCE_COVERAGE_UNAVAILABLE',
              message: 'Complete Retell coverage could not be confirmed for this period.',
            } });
          }
          providerScanCount = scan.callCount;
          providerScanEvidence = {
            version: 'm26-retell-provider-scan-v2',
            organizationId: evidence.organizationId,
            snapshotId: evidence.snapshotId,
            localMonthStart: evidence.localMonthStart,
            startsAt: evidence.startsAt,
            endsAt: evidence.endsAt,
            integrationOwnershipId: evidence.integrationOwnershipId,
            agentId: evidence.agentId,
            canonicalCallDigests: scan.canonicalCallDigests,
            callCount: scan.callCount,
            sourceSnapshotDigest: scan.sourceSnapshotDigest,
            scannedAt: scan.scannedAt,
          };
        }
        const client = await poolProvider().connect();
        try {
          await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
          await client.query("SET LOCAL statement_timeout = '10000ms'");
          await client.query("SET LOCAL lock_timeout = '2000ms'");
          const value = (await client.query(
            `SELECT public.canonical_forecast_retell_period_certification_v2_mutate(
             $1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10,$11,$12,$13,$14,$15::jsonb,
             $16,$17,$18,$19,$20) value`,
            [...identity, req.get('X-CSRF-Token'), key, body.action,
              body.snapshotId.toLowerCase(), body.localMonthStart, body.expectedRevision,
              body.expectedDigest, evidenceDigest, providerScanCount, providerScanDigest,
              JSON.stringify(providerScanEvidence),
              body.callerConsentAttested, body.providerCoverageAttested,
              body.retentionAttested, body.reason, body.confirmationVersion])).rows[0]?.value;
          if (!value || !['retell_period_certified', 'retell_period_revoked'].includes(value.state) ||
              !UUID.test(value.id || '') || !Number.isSafeInteger(value.revision) ||
              value.revision < 1 || !DIGEST.test(value.digest || '') ||
              typeof value.replayed !== 'boolean') throw new Error('Invalid period certification result');
          await client.query('COMMIT');
          if (value.replayed) res.set('Idempotency-Replayed', 'true');
          return res.status(value.replayed ? 200 : 201).json({ success: true, data: {
            ...value, localMonthStart: body.localMonthStart,
            scope: 'retell_only_tenant_all', callerConsentAttested:
              body.action === 'certify', providerCoverageAttested: body.action === 'certify',
            retentionAttested: body.action === 'certify', providerIndependentVerified: false,
            wholeBusinessCoverageVerified: false, forecastIssued: false,
            paidNumericServing: false } });
        } catch (error) {
          await client.query('ROLLBACK').catch(() => {}); throw error;
        } finally { client.release(); }
      } catch (error) { return failure(res, error); }
    });

  router.post('/retell/future-origins', auth, requirePermission('forecast', 'update'),
    captureThrottle, async (req, res) => {
      const body = req.body, key = req.get('Idempotency-Key');
      if (!exact(req.query, []) || !exact(body, ['localHorizonStart']) ||
          !validMonth(body.localHorizonStart) || !KEY.test(key || '')) return invalid(res);
      return run(req, res, { isolation: 'READ COMMITTED', write: true,
        sql: `SELECT public.canonical_forecast_retell_future_origin_v2_capture(
          $1,$2,$3,$4,$5,$6,$7::date) value`,
        params: [req.get('X-CSRF-Token'), key, body.localHorizonStart],
        validate(value) {
          if (!value || !['retell_future_origin_saved', 'retell_future_unavailable']
            .includes(value.state) || value.researchOnly !== true ||
              value.paidNumericServing !== false || value.forecastServingEnabled !== false) return null;
          if (value.state === 'retell_future_unavailable') {
            if (typeof value.reason !== 'string' || !value.reason) return null;
            return { state: value.state, reason: value.reason, researchOnly: true,
              realForecastEligible: false, paidNumericServing: false,
              forecastServingEnabled: false, forecastIssued: false };
          }
          if (!UUID.test(value.id || '') || !validTimestamp(value.asOf) ||
              value.localHorizonStart !== body.localHorizonStart ||
              !DIGEST.test(value.evidenceDigest || '') || value.outputDigest !== undefined ||
              typeof value.replayed !== 'boolean') return null;
          return { state: value.state, id: value.id, asOf: value.asOf,
            localHorizonStart: value.localHorizonStart,
            evidenceDigest: value.evidenceDigest, replayed: value.replayed,
            researchOnly: true, amountWithheld: true, scope: 'retell_only_tenant_all',
            serviceMixAvailable: false, areaForecastAvailable: false,
            providerIndependentVerified: false, wholeBusinessCoverageVerified: false,
            realForecastEligible: false, paidNumericServing: false,
            forecastServingEnabled: false, forecastIssued: false };
        } });
    });

  router.get('/retell/future-origins/:originId', auth,
    requirePermission('forecast', 'read'), throttle, async (req, res) => {
      if (!UUID.test(req.params.originId || '') || !exact(req.query, [])) return invalid(res);
      return run(req, res, {
        sql: `SELECT public.canonical_forecast_retell_future_origin_v2_read(
          $1,$2,$3,$4,$5) value`, params: [req.params.originId.toLowerCase()],
        validate(value) {
          if (value === null) return { state: 'not_found' };
          if (!value || !['retell_future_origin_current', 'retell_future_origin_stale']
            .includes(value.state) || value.id !== req.params.originId.toLowerCase() ||
              value.researchOnly !== true || value.amountWithheld !== true ||
              value.outputDigest !== undefined ||
              value.paidNumericServing !== false || value.forecastServingEnabled !== false) return null;
          if (value.state === 'retell_future_origin_stale') return {
            state: value.state, id: value.id, refreshRequired: true,
            researchOnly: true, amountWithheld: true, realForecastEligible: false,
            paidNumericServing: false, forecastServingEnabled: false,
            forecastIssued: false };
          if (!validTimestamp(value.asOf) || !validMonth(value.localHorizonStart) ||
              !validUtcInstant(value.horizonStartsAt) || !validUtcInstant(value.horizonEndsAt) ||
              !DIGEST.test(value.evidenceDigest || '') ||
              value.scope !== 'retell_only_tenant_all' ||
              value.targetKey !== 'demand.inbound_leads' || value.targetVersion !== 'v1') return null;
          return { state: value.state, id: value.id, asOf: value.asOf,
            localHorizonStart: value.localHorizonStart,
            horizonStartsAt: value.horizonStartsAt, horizonEndsAt: value.horizonEndsAt,
            targetKey: value.targetKey, targetVersion: value.targetVersion,
            scope: value.scope, evidenceDigest: value.evidenceDigest,
            researchOnly: true, amountWithheld: true,
            serviceMixAvailable: false, areaForecastAvailable: false,
            providerIndependentVerified: false, wholeBusinessCoverageVerified: false,
            realForecastEligible: false, paidNumericServing: false,
            forecastServingEnabled: false, forecastIssued: false };
        } });
    });

  router.post('/transitions/method-reviews', auth,
    requirePermission('forecast', 'update'), reviewThrottle, async (req, res) => {
      const body = req.body, key = req.get('Idempotency-Key');
      if (!exact(req.query, []) || !exact(body, ['action', 'expectedRevision',
        'expectedDigest', 'reason', 'confirmed', 'confirmationVersion']) ||
          !['approve', 'reject'].includes(body.action) ||
          !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0 ||
          body.expectedRevision > 10000 ||
          !(body.expectedDigest === 'none' || DIGEST.test(body.expectedDigest || '')) ||
          ((body.expectedRevision === 0) !== (body.expectedDigest === 'none')) ||
          typeof body.reason !== 'string' || body.reason.trim().length < 10 ||
          body.reason.length > 1000 || Buffer.byteLength(body.reason) > 4000 ||
          body.confirmed !== true ||
          body.confirmationVersion !== TRANSITION_METHOD_REVIEW_VERSION ||
          !KEY.test(key || '')) return invalid(res);
      return run(req, res, { isolation: 'SERIALIZABLE', write: true,
        sql: `SELECT public.canonical_forecast_transition_method_review_v2_mutate(
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) value`,
        params: [req.get('X-CSRF-Token'), key, body.action, body.reason,
          body.expectedRevision, body.expectedDigest, true, body.confirmationVersion],
        validate(value) {
          if (!value || value.state !== 'transition_method_review_recorded' ||
              !UUID.test(value.id || '') || !UUID.test(value.methodId || '') ||
              !Number.isSafeInteger(value.revision) || value.revision < 1 ||
              !['approve', 'reject'].includes(value.action) ||
              !DIGEST.test(value.reviewDigest || '') ||
              !DIGEST.test(value.methodDigest || '') ||
              typeof value.replayed !== 'boolean' || value.researchOnly !== true ||
              value.automaticSelection !== false || value.automaticActionTaken !== false ||
              value.paidNumericServing !== false ||
              value.forecastServingEnabled !== false) return null;
          return { state: value.state, id: value.id, revision: value.revision,
            action: value.action, reviewDigest: value.reviewDigest,
            methodId: value.methodId, methodDigest: value.methodDigest,
            replayed: value.replayed, approved: value.action === 'approve',
            researchOnly: true, automaticSelection: false,
            automaticActionTaken: false, forecastIssued: false,
            paidNumericServing: false, forecastServingEnabled: false };
        } });
    });

  router.get('/transitions/method-reviews/current', auth,
    requirePermission('forecast', 'read'), throttle, async (req, res) => {
      if (!exact(req.query, [])) return invalid(res);
      return run(req, res, {
        sql: `SELECT public.canonical_forecast_transition_method_review_v2_read(
          $1,$2,$3,$4) value`, params: [], validate(value) {
          if (!value || !['transition_method_review_current',
            'transition_method_review_unavailable'].includes(value.state) ||
              value.researchOnly !== true || value.automaticSelection !== false ||
              value.automaticActionTaken !== false || value.paidNumericServing !== false ||
              value.forecastServingEnabled !== false) return null;
          if (value.state === 'transition_method_review_unavailable') {
            if (value.reason !== 'review_missing' || value.expectedRevision !== 0 ||
                value.expectedDigest !== 'none' || value.approved !== false) return null;
            return { state: value.state, reason: value.reason,
              expectedRevision: 0, expectedDigest: 'none', approved: false,
              researchOnly: true, automaticSelection: false,
              automaticActionTaken: false, forecastIssued: false,
              paidNumericServing: false, forecastServingEnabled: false };
          }
          if (!UUID.test(value.id || '') || !UUID.test(value.methodId || '') ||
              !Number.isSafeInteger(value.revision) || value.revision < 1 ||
              !['approve', 'reject'].includes(value.action) ||
              value.approved !== (value.action === 'approve') ||
              !DIGEST.test(value.reviewDigest || '') || !DIGEST.test(value.methodDigest || '') ||
              typeof value.methodVersion !== 'string' ||
              typeof value.calculationVersion !== 'string' ||
              typeof value.reviewVersion !== 'string' ||
              !validTransitionTargets(value.targets) || !validTimestamp(value.reviewedAt)) {
            return null;
          }
          return { state: value.state, id: value.id, revision: value.revision,
            action: value.action, approved: value.approved,
            reviewDigest: value.reviewDigest, methodId: value.methodId,
            methodDigest: value.methodDigest, methodVersion: value.methodVersion,
            calculationVersion: value.calculationVersion,
            reviewVersion: value.reviewVersion, targets: value.targets,
            reviewedAt: value.reviewedAt, researchOnly: true,
            automaticSelection: false, automaticActionTaken: false,
            forecastIssued: false, paidNumericServing: false,
            forecastServingEnabled: false };
        } });
    });

  router.post('/transitions/future-origins', auth,
    requirePermission('forecast', 'update'), originThrottle, async (req, res) => {
      const key = req.get('Idempotency-Key');
      if (!exact(req.query, []) || !exact(req.body, []) || !KEY.test(key || '')) {
        return invalid(res);
      }
      return run(req, res, { isolation: 'READ COMMITTED', write: true,
        sql: `SELECT public.canonical_forecast_transition_origin_v2_capture(
          $1,$2,$3,$4,$5,$6) value`,
        params: [req.get('X-CSRF-Token'), key], validate(value) {
          if (!value || !['transition_origin_saved', 'transition_origin_unavailable',
            'transition_origin_stale'].includes(value.state) ||
              value.researchOnly !== true || value.paidNumericServing !== false ||
              value.forecastServingEnabled !== false) return null;
          if (value.state !== 'transition_origin_saved') {
            if (typeof value.reason !== 'string' || !value.reason) return null;
            return { state: value.state, reason: value.reason,
              refreshRequired: value.state === 'transition_origin_stale',
              researchOnly: true, probabilityWithheld: true,
              outputDigestWithheld: true, sourceCoverageComplete: false,
              providerCoverageVerified: false, offPlatformCoverageVerified: false,
              wholeBusinessCoverageVerified: false, empiricalCalibrationVerified: false,
              empiricalDriftVerified: false, realForecastEligible: false,
              forecastIssued: false, paidNumericServing: false,
              forecastServingEnabled: false };
          }
          if (!UUID.test(value.id || '') || !validTimestamp(value.asOf) ||
              !validTimestamp(value.predictionCutoffAt) ||
              !validTimestamp(value.horizonEndsAt) ||
              !validTransitionTargets(value.targets) ||
              value.sourceCoverageComplete !== true ||
              value.sourceCoverageScope !==
                'post_installation_northstar_selected_sources_only' ||
              value.uncertaintyState !==
                'unavailable_insufficient_natural_calibration' ||
              value.probabilityWithheld !== true || value.outputDigestWithheld !== true ||
              typeof value.replayed !== 'boolean') return null;
          return { state: value.state, id: value.id, asOf: value.asOf,
            predictionCutoffAt: value.predictionCutoffAt,
            horizonEndsAt: value.horizonEndsAt, targets: value.targets,
            sourceCoverageComplete: true,
            sourceCoverageScope: value.sourceCoverageScope,
            uncertaintyState: value.uncertaintyState, replayed: value.replayed,
            researchOnly: true, probabilityWithheld: true,
            outputDigestWithheld: true, providerCoverageVerified: false,
            offPlatformCoverageVerified: false, wholeBusinessCoverageVerified: false,
            naturalProductionHistoryVerified: false,
            empiricalCalibrationVerified: false, empiricalDriftVerified: false,
            realForecastEligible: false, forecastIssued: false,
            paidNumericServing: false, forecastServingEnabled: false };
        } });
    });

  router.get('/transitions/future-origins/:originId', auth,
    requirePermission('forecast', 'read'), throttle, async (req, res) => {
      if (!UUID.test(req.params.originId || '') || !exact(req.query, [])) return invalid(res);
      return run(req, res, { sql: `SELECT public.canonical_forecast_transition_origin_v2_read(
        $1,$2,$3,$4,$5) value`, params: [req.params.originId.toLowerCase()],
      validate(value) {
        if (value === null) return { state: 'not_found' };
        if (!value || !['transition_origin_current', 'transition_origin_stale']
          .includes(value.state)) return null;
        if (value.state === 'transition_origin_stale') {
          if (!UUID.test(value.id || '') || value.refreshRequired !== true ||
              typeof value.reason !== 'string' || !value.reason) return null;
          return { state: value.state, id: value.id, reason: value.reason,
            refreshRequired: true, researchOnly: true, probabilityWithheld: true,
            outputDigestWithheld: true, sourceCoverageComplete: false,
            realForecastEligible: false, forecastIssued: false,
            paidNumericServing: false, forecastServingEnabled: false };
        }
        if (!UUID.test(value.id || '') || value.id !== req.params.originId.toLowerCase() ||
            !validTimestamp(value.asOf) ||
            !validTimestamp(value.predictionCutoffAt) ||
            !validTimestamp(value.horizonEndsAt) ||
            typeof value.timeZone !== 'string' || !value.timeZone ||
            typeof value.methodVersion !== 'string' || !value.methodVersion ||
            typeof value.calculationVersion !== 'string' || !value.calculationVersion ||
            typeof value.reviewVersion !== 'string' || !value.reviewVersion ||
            !validTransitionTargets(value.targets) ||
            value.sourceCoverageComplete !== true ||
            value.sourceCoverageScope !==
              'post_installation_northstar_selected_sources_only' ||
            value.uncertaintyState !==
              'unavailable_insufficient_natural_calibration' ||
            value.probabilityWithheld !== true || value.outputDigestWithheld !== true ||
            value.paidNumericServing !== false ||
            value.forecastServingEnabled !== false) return null;
        return { state: value.state, id: value.id, asOf: value.asOf,
          predictionCutoffAt: value.predictionCutoffAt,
          horizonEndsAt: value.horizonEndsAt, timeZone: value.timeZone,
          methodVersion: value.methodVersion,
          calculationVersion: value.calculationVersion,
          reviewVersion: value.reviewVersion, targets: value.targets,
          sourceCoverageComplete: true, sourceCoverageScope: value.sourceCoverageScope,
          uncertaintyState: value.uncertaintyState,
          researchOnly: true, probabilityWithheld: true,
          outputDigestWithheld: true, providerCoverageVerified: false,
          offPlatformCoverageVerified: false, wholeBusinessCoverageVerified: false,
          naturalProductionHistoryVerified: false,
          empiricalCalibrationVerified: false, empiricalDriftVerified: false,
          realForecastEligible: false, forecastIssued: false,
          paidNumericServing: false, forecastServingEnabled: false };
      } });
    });

  router.post('/transitions/future-origins/:originId/evaluations', auth,
    requirePermission('forecast', 'update'), evaluationThrottle, async (req, res) => {
      const key = req.get('Idempotency-Key');
      if (!UUID.test(req.params.originId || '') || !exact(req.query, []) ||
          !exact(req.body, []) || !KEY.test(key || '')) return invalid(res);
      return run(req, res, { isolation: 'READ COMMITTED', write: true,
        sql: `SELECT public.canonical_forecast_transition_evaluation_v2_capture(
          $1,$2,$3,$4,$5,$6,$7) value`,
        params: [req.get('X-CSRF-Token'), key, req.params.originId.toLowerCase()],
        validate(value) {
          if (value === null) return { state: 'not_found' };
          if (!value || !['transition_evaluation_saved',
            'transition_evaluation_unavailable'].includes(value.state) ||
              value.researchOnly !== true || value.metricsWithheld !== true) return null;
          if (value.state === 'transition_evaluation_unavailable') {
            if (typeof value.reason !== 'string' || !value.reason) return null;
            return { state: value.state, reason: value.reason, researchOnly: true,
              metricsWithheld: true, calibrationClaimed: false,
              driftVerdictIssued: false, automaticActionTaken: false,
              paidNumericServing: false, forecastServingEnabled: false };
          }
          if (!UUID.test(value.id || '') ||
              value.originId !== req.params.originId.toLowerCase() ||
              !Number.isSafeInteger(value.revision) || value.revision < 1 ||
              typeof value.replayed !== 'boolean' || value.calibrationClaimed !== false ||
              value.driftVerdictIssued !== false || value.automaticActionTaken !== false ||
              value.paidNumericServing !== false ||
              value.forecastServingEnabled !== false) {
            return null;
          }
          return { state: value.state, id: value.id, originId: value.originId,
            revision: value.revision, replayed: value.replayed,
            researchOnly: true, metricsWithheld: true, calibrationClaimed: false,
            driftVerdictIssued: false, automaticActionTaken: false,
            paidNumericServing: false, forecastServingEnabled: false };
        } });
    });

  router.get('/transitions/evaluations/:evaluationId', auth,
    requirePermission('forecast', 'read'), throttle, async (req, res) => {
      if (!UUID.test(req.params.evaluationId || '') || !exact(req.query, [])) {
        return invalid(res);
      }
      return run(req, res, {
        sql: `SELECT public.canonical_forecast_transition_evaluation_v2_read(
          $1,$2,$3,$4,$5) value`, params: [req.params.evaluationId.toLowerCase()],
        validate(value) {
          if (value === null) return { state: 'not_found' };
          if (!value || !['transition_evaluation_current',
            'transition_evaluation_stale'].includes(value.state) ||
              !UUID.test(value.id || '') || !UUID.test(value.originId || '') ||
              value.researchOnly !== true || value.metricsWithheld !== true) return null;
          if (value.state === 'transition_evaluation_stale') {
            if (value.refreshRequired !== true || typeof value.reason !== 'string' ||
                !value.reason) return null;
            return { state: value.state, id: value.id, originId: value.originId,
              reason: value.reason, refreshRequired: true, researchOnly: true,
              metricsWithheld: true, calibrationClaimed: false,
              driftVerdictIssued: false, automaticActionTaken: false,
              paidNumericServing: false, forecastServingEnabled: false };
          }
          if (!Number.isSafeInteger(value.revision) || value.revision < 1 ||
              !validTimestamp(value.evaluatedAt) || value.calibrationClaimed !== false ||
              value.driftVerdictIssued !== false || value.automaticActionTaken !== false ||
              value.paidNumericServing !== false ||
              value.forecastServingEnabled !== false) return null;
          return { state: value.state, id: value.id, originId: value.originId,
            revision: value.revision, evaluatedAt: value.evaluatedAt,
            researchOnly: true, metricsWithheld: true, calibrationClaimed: false,
            driftVerdictIssued: false, automaticActionTaken: false,
            paidNumericServing: false, forecastServingEnabled: false };
        } });
    });

  return router;
}

module.exports = { createForecastDemandSourcesRouter };
