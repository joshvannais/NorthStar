'use strict';

const express = require('express');
const db = require('../db');
const { requireOnboardedInternal, requireTenantAccess } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const {
  normalizeExecutionId,
  normalizeInitialization,
  normalizeTransition,
} = require('../operations/contract');
const { requireExecutionBodyBoundary } = require('../operations/httpBoundary');
const {
  initializeFieldExecution,
  readFieldExecution,
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
  const initialize = typeof options.initialize === 'function' ? options.initialize : initializeFieldExecution;
  const transition = typeof options.transition === 'function' ? options.transition : transitionFieldExecution;
  const read = typeof options.read === 'function' ? options.read : readFieldExecution;

  router.post('/appointments/:appointmentId', requireExecutionBodyBoundary,
    mutationAuth, permission('operations', 'update'), async (req, res) => {
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
    mutationAuth, permission('operations', 'update'), async (req, res) => {
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

  router.get('/:executionId', tenantAuth, permission('operations', 'read'), async (req, res) => {
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
