'use strict';

const express = require('express');
const db = require('../db');
const { requireOnboardedInternal, requireTenantAccess } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { rateLimit } = require('../middleware/rateLimit');
const {
  normalizeExecutionId,
  normalizeInitialization,
  normalizeLaborAction,
  normalizeMaterialAction,
  normalizeMaterialReadQuery,
  normalizeTransition,
} = require('../operations/contract');
const { requireExecutionBodyBoundary } = require('../operations/httpBoundary');
const {
  normalizeEvidenceAction,
  normalizeFileHeaders,
  normalizeReadQuery,
} = require('../fieldEvidence/contract');
const {
  authorizeFileRetrieval,
  mutateFieldEvidence,
  readFieldEvidence,
} = require('../fieldEvidence/repository');
const {
  createAuthorizedRetrieval,
  createUnavailableStorage,
  ingestFileEvidence,
} = require('../fieldEvidence/fileStorage');
const {
  initializeFieldExecution,
  mutateLaborTime,
  mutateMaterialInventory,
  readFieldExecution,
  readLaborTime,
  readMaterialInventory,
  transitionFieldExecution,
} = require('../operations/repository');

function requestId(req) {
  const candidate = String(req.requestId || req.correlationId || 'unavailable');
  return /^[ -~]{1,128}$/.test(candidate) ? candidate : 'unavailable';
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

function typedError(req, res, error) {
  const status = error && (error.status || error.statusCode);
  if (!Number.isInteger(status) || !error.code) return false;
  res.status(status).json({
    success: false,
    requestId: requestId(req),
    error: { code: error.code, message: error.message },
  });
  return true;
}

function createFieldExecutionsRouter(options = {}) {
  const router = express.Router();
  const poolProvider = typeof options.poolProvider === 'function' ? options.poolProvider : () => db.getPool();
  const tenantAuth = typeof options.tenantAuth === 'function' ? options.tenantAuth : requireTenantAccess;
  const mutationAuth = typeof options.mutationAuth === 'function' ? options.mutationAuth : requireOnboardedInternal;
  const permission = typeof options.permission === 'function' ? options.permission : requirePermission;
  const throttle = typeof options.throttle === 'function' ? options.throttle : rateLimit(
    'internal-api',
    req => `field-execution:${req.tenantContext.organizationId}:${req.tenantContext.userId}`
  );
  const initialize = typeof options.initialize === 'function' ? options.initialize : initializeFieldExecution;
  const transition = typeof options.transition === 'function' ? options.transition : transitionFieldExecution;
  const read = typeof options.read === 'function' ? options.read : readFieldExecution;
  const laborMutate = typeof options.laborMutate === 'function' ? options.laborMutate : mutateLaborTime;
  const laborRead = typeof options.laborRead === 'function' ? options.laborRead : readLaborTime;
  const materialMutate = typeof options.materialMutate === 'function'
    ? options.materialMutate : mutateMaterialInventory;
  const materialRead = typeof options.materialRead === 'function'
    ? options.materialRead : readMaterialInventory;
  const evidenceMutate = typeof options.evidenceMutate === 'function'
    ? options.evidenceMutate : mutateFieldEvidence;
  const evidenceRead = typeof options.evidenceRead === 'function'
    ? options.evidenceRead : readFieldEvidence;
  const fileAuthorize = typeof options.fileAuthorize === 'function'
    ? options.fileAuthorize : authorizeFileRetrieval;
  const fileIngest = typeof options.fileIngest === 'function' ? options.fileIngest : ingestFileEvidence;
  const storage = options.fileStorage || createUnavailableStorage();

  router.post('/appointments/:appointmentId', requireExecutionBodyBoundary,
    mutationAuth, throttle, permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = normalizeInitialization({
          ...actor(req),
          appointmentId: req.params.appointmentId,
          idempotencyKey: req.get('Idempotency-Key'),
          body: req.body,
        });
        const result = await initialize(poolProvider(), {
          ...normalized,
          csrfToken: req.get('X-CSRF-Token'),
          requestCorrelationId: requestId(req),
        });
        res.set('Cache-Control', 'no-store, private');
        if (result.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(result.status).json(result.body);
      } catch (error) {
        if (typedError(req, res, error)) return undefined;
        return res.status(503).json({
          success: false,
          requestId: requestId(req),
          error: {
            code: 'M23_EXECUTION_UNAVAILABLE',
            message: 'Field execution is temporarily unavailable.',
          },
        });
      }
    });

  router.post('/:executionId/transitions', requireExecutionBodyBoundary,
    mutationAuth, throttle, permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = normalizeTransition({
          ...actor(req),
          executionId: req.params.executionId,
          idempotencyKey: req.get('Idempotency-Key'),
          body: req.body,
        });
        const result = await transition(poolProvider(), {
          ...normalized,
          csrfToken: req.get('X-CSRF-Token'),
          requestCorrelationId: requestId(req),
        });
        res.set('Cache-Control', 'no-store, private');
        if (result.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(result.status).json(result.body);
      } catch (error) {
        if (typedError(req, res, error)) return undefined;
        return res.status(503).json({
          success: false,
          requestId: requestId(req),
          error: {
            code: 'M23_EXECUTION_UNAVAILABLE',
            message: 'Field execution is temporarily unavailable.',
          },
        });
      }
    });

  router.post('/:executionId/labor-actions', requireExecutionBodyBoundary,
    mutationAuth, throttle, permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = normalizeLaborAction({
          ...actor(req), executionId: req.params.executionId,
          idempotencyKey: req.get('Idempotency-Key'), body: req.body,
        });
        const result = await laborMutate(poolProvider(), {
          ...normalized,
          csrfToken: req.get('X-CSRF-Token'),
          requestCorrelationId: requestId(req),
        });
        res.set('Cache-Control', 'no-store, private');
        if (result.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(result.status).json(result.body);
      } catch (error) {
        if (typedError(req, res, error)) return undefined;
        return res.status(503).json({
          success: false, requestId: requestId(req),
          error: { code: 'M23_LABOR_UNAVAILABLE', message: 'Labor evidence is temporarily unavailable.' },
        });
      }
    });

  router.get('/:executionId/labor', tenantAuth, throttle,
    permission('operations', 'read'), async (req, res) => {
      if (!req.query || Object.keys(req.query).length !== 0) {
        return res.status(400).json({
          success: false, requestId: requestId(req),
          error: { code: 'M23_LABOR_QUERY_FORBIDDEN',
            message: 'Labor evidence reads derive authority from the current signed-in session.' },
        });
      }
      try {
        const executionId = normalizeExecutionId(req.params.executionId);
        const result = await laborRead(poolProvider(), { ...actor(req), executionId });
        res.set('Cache-Control', 'no-store, private');
        return res.status(result.status).json({ ...result.body, requestId: requestId(req) });
      } catch (error) {
        if (typedError(req, res, error)) return undefined;
        return res.status(503).json({
          success: false, requestId: requestId(req),
          error: { code: 'M23_LABOR_UNAVAILABLE', message: 'Labor evidence is temporarily unavailable.' },
        });
      }
    });

  router.post('/:executionId/material-actions', requireExecutionBodyBoundary,
    mutationAuth, throttle, permission('operations', 'update'), async (req, res) => {
      res.set('Cache-Control', 'no-store, private');
      try {
        const normalized = normalizeMaterialAction({
          ...actor(req), executionId: req.params.executionId,
          idempotencyKey: req.get('Idempotency-Key'), body: req.body,
        });
        const result = await materialMutate(poolProvider(), {
          ...normalized,
          csrfToken: req.get('X-CSRF-Token'),
          requestCorrelationId: requestId(req),
        });
        if (result.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(result.status).json(result.body);
      } catch (error) {
        if (typedError(req, res, error)) return undefined;
        return res.status(503).json({
          success: false, requestId: requestId(req),
          error: { code: 'M23_MATERIAL_UNAVAILABLE',
            message: 'Material evidence is temporarily unavailable.' },
        });
      }
    });

  router.get('/:executionId/materials', tenantAuth, throttle,
    permission('operations', 'read'), async (req, res) => {
      res.set('Cache-Control', 'no-store, private');
      try {
        const executionId = normalizeExecutionId(req.params.executionId);
        const balanceWindow = normalizeMaterialReadQuery(req.query);
        const result = await materialRead(poolProvider(), {
          ...actor(req), executionId, ...balanceWindow,
        });
        return res.status(result.status).json({ ...result.body, requestId: requestId(req) });
      } catch (error) {
        if (typedError(req, res, error)) return undefined;
        return res.status(503).json({
          success: false, requestId: requestId(req),
          error: { code: 'M23_MATERIAL_UNAVAILABLE',
            message: 'Material evidence is temporarily unavailable.' },
        });
      }
    });

  router.post('/:executionId/field-evidence-actions', requireExecutionBodyBoundary,
    mutationAuth, throttle, permission('operations', 'update'), async (req, res) => {
      res.set('Cache-Control', 'no-store, private');
      try {
        const normalized = normalizeEvidenceAction({
          ...actor(req), executionId: req.params.executionId,
          idempotencyKey: req.get('Idempotency-Key'), body: req.body,
        });
        const result = await evidenceMutate(poolProvider(), {
          ...normalized, csrfToken: req.get('X-CSRF-Token'), requestCorrelationId: requestId(req),
        });
        if (result.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(result.status).json(result.body);
      } catch (error) {
        if (typedError(req, res, error)) return undefined;
        return res.status(503).json({ success: false, requestId: requestId(req),
          error: { code: 'M23_FIELD_EVIDENCE_UNAVAILABLE', message: 'Field evidence is temporarily unavailable.' } });
      }
    });

  router.post('/:executionId/files', mutationAuth, throttle,
    permission('operations', 'update'), async (req, res) => {
      res.set('Cache-Control', 'no-store, private');
      try {
        const normalized = normalizeFileHeaders({ ...actor(req), executionId: req.params.executionId }, req.headers);
        const result = await fileIngest({
          pool: poolProvider(), storage, stream: req, metadata: normalized,
          csrfToken: req.get('X-CSRF-Token'), requestCorrelationId: requestId(req),
          contentEncoding: req.get('Content-Encoding') || 'identity',
        });
        if (result.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(result.status).json(result.body);
      } catch (error) {
        if (typedError(req, res, error)) return undefined;
        return res.status(503).json({ success: false, requestId: requestId(req),
          error: { code: 'M23_FIELD_STORAGE_UNAVAILABLE', message: 'Field file storage is temporarily unavailable.' } });
      }
    });

  router.get('/:executionId/field-evidence', tenantAuth, throttle,
    permission('operations', 'read'), async (req, res) => {
      res.set('Cache-Control', 'no-store, private');
      try {
        const executionId = normalizeExecutionId(req.params.executionId);
        const window = normalizeReadQuery(req.query);
        const result = await evidenceRead(poolProvider(), { ...actor(req), executionId, ...window });
        const body = { ...result.body, requestId: requestId(req) };
        const cursorData = body.nextCursorData;
        delete body.nextCursorData;
        body.nextCursor = cursorData ? Buffer.from(JSON.stringify(cursorData), 'utf8').toString('base64url') : null;
        return res.status(result.status).json(body);
      } catch (error) {
        if (typedError(req, res, error)) return undefined;
        return res.status(503).json({ success: false, requestId: requestId(req),
          error: { code: 'M23_FIELD_EVIDENCE_UNAVAILABLE', message: 'Field evidence is temporarily unavailable.' } });
      }
    });

  router.get('/:executionId/files/:objectId', tenantAuth, throttle,
    permission('operations', 'read'), async (req, res) => {
      res.set('Cache-Control', 'no-store, private');
      try {
        const authorization = await fileAuthorize(poolProvider(), {
          ...actor(req), executionId: normalizeExecutionId(req.params.executionId),
          objectId: normalizeExecutionId(req.params.objectId),
        });
        const retrieval = await createAuthorizedRetrieval(storage, authorization);
        return res.status(200).json({ success: true, requestId: requestId(req), data: retrieval });
      } catch (error) {
        if (typedError(req, res, error)) return undefined;
        return res.status(503).json({ success: false, requestId: requestId(req),
          error: { code: 'M23_FIELD_STORAGE_UNAVAILABLE', message: 'Field file retrieval is temporarily unavailable.' } });
      }
    });

  router.get('/:executionId', tenantAuth, throttle, permission('operations', 'read'), async (req, res) => {
    if (!req.query || Object.keys(req.query).length !== 0) {
      return res.status(400).json({
        success: false,
        requestId: requestId(req),
        error: {
          code: 'M23_EXECUTION_QUERY_FORBIDDEN',
          message: 'Field execution reads derive authority from the current signed-in session.',
        },
      });
    }
    try {
      const executionId = normalizeExecutionId(req.params.executionId);
      const result = await read(poolProvider(), { ...actor(req), executionId });
      res.set('Cache-Control', 'no-store, private');
      return res.status(result.status).json({ ...result.body, requestId: requestId(req) });
    } catch (error) {
      if (typedError(req, res, error)) return undefined;
      return res.status(503).json({
        success: false,
        requestId: requestId(req),
        error: {
          code: 'M23_EXECUTION_UNAVAILABLE',
          message: 'Field execution is temporarily unavailable.',
        },
      });
    }
  });

  return router;
}

module.exports = { createFieldExecutionsRouter };
