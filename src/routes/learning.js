'use strict';

const express = require('express');
const db = require('../db');
const { requireOnboardedInternal, requireTenantAccess } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { rateLimit } = require('../middleware/rateLimit');
const contract = require('../learning/laborOutcomeContract');
const repository = require('../learning/laborOutcomeRepository');
const importContract = require('../learning/externalLaborImportContract');
const importRepository = require('../learning/externalLaborImportRepository');
const reconciliationContract = require('../learning/externalLaborReconciliationContract');
const reconciliationRepository = require('../learning/externalLaborReconciliationRepository');
const importedOutcomeContract = require('../learning/importedLaborOutcomeContract');
const importedOutcomeRepository = require('../learning/importedLaborOutcomeRepository');
const calibrationContract = require('../learning/importedLaborCalibrationContract');
const calibrationRepository = require('../learning/importedLaborCalibrationRepository');
const learningCenterRepository = require('../learning/learningCenterRepository');

function requestId(req) {
  const value = String(req.requestId || req.correlationId || 'unavailable');
  return /^[ -~]{1,128}$/.test(value) ? value : 'unavailable';
}

function actor(req) {
  const authority = req.accountAuthority || {};
  const tenant = req.tenantContext || {};
  return {
    organizationId: tenant.organizationId,
    actorUserId: tenant.userId,
    actorAccessRole: req.userRole,
    authSessionId: req.authSession && req.authSession.id,
    membershipId: authority.membership_id || null,
  };
}

function replyError(req, res, error) {
  const status = Number.isInteger(error && (error.status || error.statusCode)) ? (error.status || error.statusCode) : 503;
  const code = error && error.code || 'M25_LEARNING_UNAVAILABLE';
  const unavailable = code.startsWith('M25_IMPORTED_CALIBRATION_') ? 'Imported labor calibration is temporarily unavailable.' :
    code.startsWith('M25_IMPORTED_OUTCOME_') ? 'Imported labor outcome learning is temporarily unavailable.' :
    code.startsWith('M25_MATCH_') ? 'External labor reconciliation is temporarily unavailable.' :
    code.startsWith('M25_IMPORT_') ? 'External labor imports are temporarily unavailable.' :
      'Labor outcome learning is temporarily unavailable.';
  return res.status(status).json({ success: false, requestId: requestId(req), error: {
    code,
    message: status === 503 ? unavailable : error.message,
  } });
}

function createLearningRouter(options = {}) {
  const router = express.Router();
  const poolProvider = typeof options.poolProvider === 'function' ? options.poolProvider : () => db.getPool();
  const tenantAuth = options.tenantAuth || requireTenantAccess;
  const mutationAuth = options.mutationAuth || requireOnboardedInternal;
  const permission = options.permission || requirePermission;
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `learning:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
  const headers = (_req, res, next) => { res.set('Cache-Control', 'no-store, private'); res.vary('Cookie'); next(); };
  const ownerOnly = (req, res, next) => ['owner', 'admin'].includes(req.userRole) ? next() : replyError(req, res,
    Object.assign(new Error('Labor outcome learning is restricted to current owners and administrators.'),
      { code: 'M25_LEARNING_FORBIDDEN', status: 403 }));
  const importOwnerOnly = (req, res, next) => ['owner', 'admin'].includes(req.userRole) ? next() : replyError(req, res,
    Object.assign(new Error('External labor imports are restricted to current owners and administrators.'),
      { code: 'M25_IMPORT_FORBIDDEN', status: 403 }));

  router.get('/center', headers, tenantAuth, ownerOnly, throttle, permission('learning', 'read'), async (req, res) => {
    try {
      const data = await learningCenterRepository.read(poolProvider(), actor(req));
      return res.json({ success: true, data, requestId: requestId(req) });
    } catch (error) { return replyError(req, res, error); }
  });

  router.get('/labor-duration-consent', headers, tenantAuth, ownerOnly, throttle, permission('operations', 'read'), async (req, res) => {
    try {
      const data = await repository.readConsent(poolProvider(), actor(req));
      return res.json({ success: true, data, requestId: requestId(req) });
    } catch (error) { return replyError(req, res, error); }
  });

  router.post('/labor-duration-consent', headers, mutationAuth, ownerOnly, throttle, permission('operations', 'update'), async (req, res) => {
    try {
      const body = contract.normalizeConsent(req.body);
      const data = await repository.mutateConsent(poolProvider(), {
        ...actor(req), csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key'),
      }, body);
      if (data.replayed) res.set('Idempotency-Replayed', 'true');
      return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
    } catch (error) { return replyError(req, res, error); }
  });

  router.get('/estimates/:estimateId/labor-duration-outcomes', headers, tenantAuth, ownerOnly, throttle,
    permission('operations', 'read'), async (req, res) => {
      try {
        const estimateId = contract.normalizeEstimateId(req.params.estimateId);
        const data = await repository.readOutcome(poolProvider(), { ...actor(req), estimateId });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.post('/estimates/:estimateId/labor-duration-outcomes', headers, mutationAuth, ownerOnly, throttle,
    permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = contract.normalizeObservation(req.params.estimateId, req.body);
        const data = await repository.observe(poolProvider(), {
          ...actor(req), ...normalized, csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key'),
        });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.get('/external-labor-sources/:sourceKey/consent', headers, tenantAuth, importOwnerOnly, throttle,
    permission('operations', 'read'), async (req, res) => {
      try {
        const sourceKey = importContract.normalizeSourceKey(req.params.sourceKey);
        const data = await importRepository.readConsent(poolProvider(), { ...actor(req), sourceKey });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.post('/external-labor-sources/:sourceKey/consent', headers, mutationAuth, importOwnerOnly, throttle,
    permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = importContract.normalizeConsent(req.params.sourceKey, req.body);
        const { sourceKey, ...body } = normalized;
        const data = await importRepository.mutateConsent(poolProvider(), {
          ...actor(req), sourceKey, body, csrfToken: req.get('X-CSRF-Token'),
          idempotencyKey: req.get('Idempotency-Key'),
        });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.post('/external-labor-sources/:sourceKey/batches', headers, mutationAuth, importOwnerOnly, throttle,
    permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = importContract.normalizeBatch(req.params.sourceKey, req.body);
        const { sourceKey, ...body } = normalized;
        const data = await importRepository.importBatch(poolProvider(), {
          ...actor(req), sourceKey, body, csrfToken: req.get('X-CSRF-Token'),
          idempotencyKey: req.get('Idempotency-Key'),
        });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.get('/external-labor-sources/:sourceKey', headers, tenantAuth, importOwnerOnly, throttle,
    permission('operations', 'read'), async (req, res) => {
      try {
        const sourceKey = importContract.normalizeSourceKey(req.params.sourceKey);
        const data = await importRepository.readSource(poolProvider(), { ...actor(req), sourceKey });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.get('/external-labor-sources/:sourceKey/matches', headers, tenantAuth, importOwnerOnly, throttle,
    permission('operations', 'read'), async (req, res) => {
      try {
        const sourceKey = importContract.normalizeSourceKey(req.params.sourceKey);
        const data = await reconciliationRepository.readMatches(poolProvider(), { ...actor(req), sourceKey });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.post('/external-labor-sources/:sourceKey/matches', headers, mutationAuth, importOwnerOnly, throttle,
    permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = reconciliationContract.normalizeMatch(req.params.sourceKey, req.body);
        const { sourceKey, ...body } = normalized;
        const data = await reconciliationRepository.mutateMatch(poolProvider(), {
          ...actor(req), sourceKey, body, csrfToken: req.get('X-CSRF-Token'),
          idempotencyKey: req.get('Idempotency-Key'),
        });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.get('/external-labor-sources/:sourceKey/imported-labor-duration-consent', headers, tenantAuth,
    importOwnerOnly, throttle, permission('operations', 'read'), async (req, res) => {
      try {
        const sourceKey = importContract.normalizeSourceKey(req.params.sourceKey);
        const data = await importedOutcomeRepository.readConsent(poolProvider(), { ...actor(req), sourceKey });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.post('/external-labor-sources/:sourceKey/imported-labor-duration-consent', headers, mutationAuth,
    importOwnerOnly, throttle, permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = importedOutcomeContract.normalizeConsent(req.params.sourceKey, req.body);
        const { sourceKey, ...body } = normalized;
        const data = await importedOutcomeRepository.mutateConsent(poolProvider(), {
          ...actor(req), sourceKey, body, csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key'),
        });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.get('/external-labor-sources/:sourceKey/estimates/:estimateId/imported-labor-duration-outcomes',
    headers, tenantAuth, importOwnerOnly, throttle, permission('operations', 'read'), async (req, res) => {
      try {
        const sourceKey = importContract.normalizeSourceKey(req.params.sourceKey);
        const estimateId = importedOutcomeContract.normalizeEstimateId(req.params.estimateId);
        const data = await importedOutcomeRepository.readOutcome(poolProvider(), { ...actor(req), sourceKey, estimateId });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.post('/external-labor-sources/:sourceKey/estimates/:estimateId/imported-labor-duration-outcomes',
    headers, mutationAuth, importOwnerOnly, throttle, permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = importedOutcomeContract.normalizeObservation(req.params.sourceKey, req.params.estimateId, req.body);
        const data = await importedOutcomeRepository.observe(poolProvider(), {
          ...actor(req), ...normalized, csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key'),
        });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.get('/external-labor-sources/:sourceKey/imported-labor-calibration-consent', headers, tenantAuth,
    importOwnerOnly, throttle, permission('operations', 'read'), async (req, res) => {
      try {
        const sourceKey = importContract.normalizeSourceKey(req.params.sourceKey);
        const data = await calibrationRepository.readConsent(poolProvider(), { ...actor(req), sourceKey });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.post('/external-labor-sources/:sourceKey/imported-labor-calibration-consent', headers, mutationAuth,
    importOwnerOnly, throttle, permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = calibrationContract.normalizeConsent(req.params.sourceKey, req.body);
        const { sourceKey, ...body } = normalized;
        const data = await calibrationRepository.mutateConsent(poolProvider(), {
          ...actor(req), sourceKey, body, csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key'),
        });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.get('/external-labor-sources/:sourceKey/imported-labor-calibrations/:serviceKey', headers, tenantAuth,
    importOwnerOnly, throttle, permission('operations', 'read'), async (req, res) => {
      try {
        const sourceKey = importContract.normalizeSourceKey(req.params.sourceKey);
        const serviceKey = calibrationContract.normalizeServiceKey(req.params.serviceKey);
        const data = await calibrationRepository.read(poolProvider(), { ...actor(req), sourceKey, serviceKey });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.post('/external-labor-sources/:sourceKey/imported-labor-calibrations/:serviceKey', headers, mutationAuth,
    importOwnerOnly, throttle, permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = calibrationContract.normalizeProposal(req.params.sourceKey, req.params.serviceKey, req.body);
        const data = await calibrationRepository.propose(poolProvider(), {
          ...actor(req), ...normalized, csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key'),
        });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  return router;
}

module.exports = { createLearningRouter };
