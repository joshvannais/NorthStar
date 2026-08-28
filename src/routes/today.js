'use strict';

const express = require('express');
const db = require('../db');
const { requireTenantAccess } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { actorInput } = require('../scheduling/operatorDirectory');
const { loadToday } = require('../scheduling/todayRepository');

function requestId(req) {
  return req.requestId || req.correlationId || 'unavailable';
}

function typedResponse(req, res, error) {
  const status = error && (error.status || error.statusCode);
  if (!Number.isInteger(status) || !error.code) return null;
  return res.status(status).json({
    success: false,
    requestId: requestId(req),
    error: { code: error.code, message: error.message },
  });
}

function createTodayRouter(options = {}) {
  const router = express.Router();
  const poolProvider = typeof options.poolProvider === 'function' ? options.poolProvider : () => db.getPool();
  const auth = typeof options.auth === 'function' ? options.auth : requireTenantAccess;
  const permission = typeof options.permission === 'function' ? options.permission : requirePermission;
  const loader = typeof options.loader === 'function' ? options.loader : loadToday;

  router.get('/', auth, permission('dashboard', 'read'), async (req, res) => {
    res.set('Cache-Control', 'no-store, private');
    if (!req.query || Object.keys(req.query).length !== 0) {
      return res.status(400).json({
        success: false,
        requestId: requestId(req),
        error: {
          code: 'M22_TODAY_QUERY_FORBIDDEN',
          message: 'Today derives its tenant, worker, crews, and day from the current signed-in authority.',
        },
      });
    }
    try {
      const pool = poolProvider();
      const data = await loader(pool, actorInput(req));
      return res.json({ success: true, data, requestId: requestId(req) });
    } catch (error) {
      const typed = typedResponse(req, res, error);
      if (typed) return typed;
      return res.status(503).json({
        success: false,
        requestId: requestId(req),
        error: { code: 'M22_TODAY_UNAVAILABLE', message: 'Today is temporarily unavailable.' },
      });
    }
  });

  return router;
}

module.exports = { createTodayRouter };
