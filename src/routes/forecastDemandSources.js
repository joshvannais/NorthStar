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
const INSTANT = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/;

function exact(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
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
          ['40P01', '55P03'].includes(error?.code) ? 'FORECAST_DEMAND_SOURCE_BUSY' :
            status === 409 ? 'FORECAST_DEMAND_SOURCE_CHANGED' :
              'FORECAST_DEMAND_SOURCE_UNAVAILABLE',
    message: status === 403 ? 'You cannot access this demand source.' :
      status === 400 ? 'Check the demand source details and try again.' :
        error?.code === '23505' ?
          'This request was already used with different details. Start a new request.' :
          ['40P01', '55P03'].includes(error?.code) ?
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

function safeConsent(value) {
  if (!value || typeof value.active !== 'boolean' || !Array.isArray(value.history) ||
      !Number.isSafeInteger(value.total) || value.total < 0 ||
      typeof value.truncated !== 'boolean' || value.history.length > 20 ||
      value.history.some(item => !UUID.test(item?.id || '') ||
        !Number.isSafeInteger(item.revision) || item.revision < 1 ||
        !['grant', 'revoke'].includes(item.action) || !DIGEST.test(item.digest || '')) ||
      (value.current !== null && (!UUID.test(value.current?.id || '') ||
        !DIGEST.test(value.current?.digest || '')))) return null;
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

function createForecastDemandSourcesRouter(options = {}) {
  const router = express.Router();
  const poolProvider = options.poolProvider || (() => db.getPool());
  const auth = options.auth || requireOnboardedInternal;
  const readReviewed = options.readReviewed || readReviewedRetellLeadReceipts;
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `forecast-demand-source:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
  const captureThrottle = options.captureThrottle || rateLimit('forecast-source-capture', req =>
    `forecast-demand-source-capture:${req.tenantContext.organizationId}`);

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
      if (!exact(body, ['action', 'expectedRevision', 'expectedDigest', 'reason',
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
          if (!value || !UUID.test(value.consent?.id || '') ||
              !DIGEST.test(value.consent?.digest || '') ||
              !Number.isSafeInteger(value.consent?.revision) ||
              value.consent.action !== body.action || typeof value.replayed !== 'boolean' ||
              typeof value.current !== 'boolean' || typeof value.active !== 'boolean') return null;
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
      if (!exact(req.body, []) || !KEY.test(key || '')) return invalid(res);
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
          if (!DIGEST.test(snapshot.sourceSnapshotDigest || '') ||
              !Array.isArray(snapshot.sources) || snapshot.sources.length > 1000 ||
              snapshot.sourceCount !== snapshot.sources.length ||
              snapshot.sources.some(item => !UUID.test(item?.sourceId || '') ||
                !DIGEST.test(item?.digest || ''))) return null;
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
          if (value.refreshRequired !== false ||
              !DIGEST.test(value.sourceSnapshotDigest || '') ||
              value.sources.some(item => !UUID.test(item?.sourceId || '') ||
                !DIGEST.test(item?.digest || '') || item.sourceKind !== 'retell_call' ||
                !['active'].includes(item.state) ||
                (item.eventAt !== null && !INSTANT.test(item.eventAt || '')) ||
                !INSTANT.test(item.recordedAt || ''))) return null;
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
               (item.disposition === 'repeat_lead' ?
                 !UUID.test(item.anchorCallSourceId || '') : item.anchorCallSourceId !== null)) :
              item.disposition !== null || item.anchorCallSourceId !== null ||
                (item.reviewDigest !== null && !DIGEST.test(item.reviewDigest || ''));
          })) return null;
          if (value.stale === false &&
              (!Number.isSafeInteger(value.callCount) ||
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
    requirePermission('forecast', 'update'), captureThrottle, async (req, res) => {
      const body = req.body, key = req.get('Idempotency-Key');
      const keys = ['expectedSourceDigest', 'expectedRevision', 'expectedDigest',
        'disposition', 'anchorCallSourceId', 'reason', 'confirmed', 'confirmationVersion'];
      if (!UUID.test(req.params.snapshotId || '') ||
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
          !INSTANT.test(req.query.startsAt || '') || !INSTANT.test(req.query.endsAt || '')) {
        return invalid(res);
      }
      try {
        const value = await readReviewed({ pool: poolProvider(), actor: actor(req),
          snapshotId: req.params.snapshotId.toLowerCase(),
          startsAt: req.query.startsAt, endsAt: req.query.endsAt });
        if (!value || !['unavailable', 'reviewed_source_only'].includes(value.state) ||
            (value.state === 'unavailable' &&
              (typeof value.reason !== 'string' || value.reason.length === 0)) ||
            (value.state === 'reviewed_source_only' &&
              (!DIGEST.test(value.sourceSnapshotDigest || '') ||
               !Array.isArray(value.leadReceipts) || value.leadReceipts.length > 1000 ||
               !Number.isSafeInteger(value.callCount) ||
               !Number.isSafeInteger(value.reviewedDistinctLeadCount)))) {
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
