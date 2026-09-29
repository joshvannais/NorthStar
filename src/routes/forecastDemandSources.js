'use strict';

const express = require('express');
const db = require('../db');
const { requireOnboardedInternal } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { rateLimit } = require('../middleware/rateLimit');
const { readReviewedRetellLeadReceipts } =
  require('../forecasting/retellReviewedLeadReceipts');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
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
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `forecast-demand-source:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
  const captureThrottle = options.captureThrottle || rateLimit('forecast-source-capture', req =>
    `forecast-demand-source-capture:${req.tenantContext.organizationId}`);
  const reviewThrottle = options.reviewThrottle || rateLimit('forecast-source-review', req =>
    `forecast-demand-source-review:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);

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

  return router;
}

module.exports = { createForecastDemandSourcesRouter };
