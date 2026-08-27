'use strict';

const express = require('express');
const db = require('../db');
const { requireTenantAccess } = require('../auth/middleware');
const { hasPermission, requirePermission } = require('../auth/permissions');
const {
  getCanonicalGraph,
  listCanonicalGraphPage,
  requestContext,
} = require('./canonicalPolaris');
const { buildPaidWorkspace } = require('../commandCenter/workspace');
const { actorInput, loadSchedulingOperatorDirectory } = require('../scheduling/operatorDirectory');
const { buildSchedulingOverviewPage } = require('../scheduling/overviewRepository');
const { validateGraphCursor } = require('../scheduling/graphCursor');

const DETAIL_KINDS = Object.freeze({
  customer: Object.freeze({ idKey: 'customer', resource: 'leads' }),
  lead: Object.freeze({ idKey: 'opportunity', resource: 'leads' }),
  work: Object.freeze({ idKey: 'appointment', resource: 'calendar' }),
});

function requestId(req) {
  return req.requestId || req.correlationId || 'unavailable';
}

function unavailable(req, res) {
  return res.status(503).json({
    success: false,
    requestId: requestId(req),
    error: {
      code: 'COMMAND_CENTER_UNAVAILABLE',
      message: 'The role-authorized Command Center projection is temporarily unavailable.',
    },
  });
}

function paidRequestContext(req) {
  const context = requestContext(req);
  if (!context) return null;
  return Object.freeze({ ...context, sessionId: 'paid-command-center', explicitSession: null });
}

function createCommandCenterRouter(options = {}) {
  const router = express.Router();
  const poolProvider = typeof options.poolProvider === 'function' ? options.poolProvider : () => db.getPool();

  router.get('/workspace', requireTenantAccess, requirePermission('dashboard', 'read'), async (req, res) => {
    try {
      const requestedCursor = validateGraphCursor(
        Object.prototype.hasOwnProperty.call(req.query, 'cursor') ? req.query.cursor : null
      );
      const context = paidRequestContext(req);
      const pool = poolProvider();
      if (!context || !pool || typeof pool.query !== 'function') return unavailable(req, res);
      const schedulingOperator = await loadSchedulingOperatorDirectory(pool, actorInput(req));
      if (!schedulingOperator.canRead) {
        return res.status(403).json({
          success: false,
          requestId: requestId(req),
          error: {
            code: 'COMMAND_CENTER_OPERATOR_REQUIRED',
            message: 'The scheduling Command Center is limited to current owners, admins, and active dispatchers.',
          },
        });
      }
      const evaluated = await buildSchedulingOverviewPage(pool, {
        organizationId: context.organizationId,
        actorUserId: context.userId,
        actorAccessRole: req.userRole,
        authSessionId: req.authSession && req.authSession.id,
        cursor: requestedCursor && requestedCursor.raw || null,
        loadPage: (client, page) => listCanonicalGraphPage(client, context, {
          limit: page.limit, cursor: page.cursor, status: null, customerId: null,
        }),
      });
      return res.json({
        success: true,
        data: buildPaidWorkspace({
          context,
          items: evaluated.pageItems,
          schedulingOperator,
          schedulingOverview: evaluated.overview,
        }),
        requestId: requestId(req),
      });
    } catch (_error) {
      if (_error && Number.isInteger(_error.status || _error.statusCode) && _error.code) {
        const status = _error.status || _error.statusCode;
        return res.status(status).json({
          success: false,
          requestId: requestId(req),
          error: { code: _error.code, message: _error.message },
        });
      }
      return unavailable(req, res);
    }
  });

  router.get('/polaris/:kind/:id', requireTenantAccess, async (req, res) => {
    const definition = DETAIL_KINDS[req.params.kind];
    if (!definition) {
      return res.status(404).json({
        success: false,
        requestId: requestId(req),
        error: { code: 'COMMAND_CENTER_DETAIL_NOT_FOUND', message: 'That Command Center detail is unavailable.' },
      });
    }
    if (!hasPermission(req.userRole, definition.resource, 'read')) {
      return res.status(403).json({
        success: false,
        requestId: requestId(req),
        error: { code: 'COMMAND_CENTER_DETAIL_FORBIDDEN', message: 'Your role cannot read that Command Center detail.' },
      });
    }
    try {
      const context = paidRequestContext(req);
      const pool = poolProvider();
      if (!context || !pool || typeof pool.query !== 'function') return unavailable(req, res);
      const schedulingOperator = await loadSchedulingOperatorDirectory(pool, actorInput(req));
      if (!schedulingOperator.canRead) {
        return res.status(403).json({
          success: false,
          requestId: requestId(req),
          error: {
            code: 'COMMAND_CENTER_OPERATOR_REQUIRED',
            message: 'The scheduling Command Center is limited to current owners, admins, and active dispatchers.',
          },
        });
      }
      const item = await getCanonicalGraph(pool, context, req.params.id);
      if (!item || item.ids[definition.idKey] !== req.params.id) {
        return res.status(404).json({
          success: false,
          requestId: requestId(req),
          error: { code: 'COMMAND_CENTER_DETAIL_NOT_FOUND', message: 'That Command Center detail was not found.' },
        });
      }
      const workspace = buildPaidWorkspace({ context, items: [item] });
      return res.json({ success: true, data: workspace.graphs[0], integrity: workspace.integrity, requestId: requestId(req) });
    } catch (_error) {
      return unavailable(req, res);
    }
  });

  return router;
}

module.exports = { createCommandCenterRouter, DETAIL_KINDS, paidRequestContext };
