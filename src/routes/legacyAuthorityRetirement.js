'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth/middleware');

function retired(_req, res) {
  return res.status(410).json({
    success: false,
    error: {
      code: 'LEGACY_AUTHORITY_RETIRED',
      message: 'This legacy authority has been retired. Use an organization-scoped canonical endpoint.',
    },
  });
}

function createLegacyAuthorityRetirementRouter() {
  const router = express.Router();

  router.get('/health', async function (_req, res) {
    let postgresHealthy = false;
    try {
      const result = await db.getPool().query('SELECT 1 AS ready');
      postgresHealthy = result.rows.length === 1 && result.rows[0].ready === 1;
    } catch (_error) {
      postgresHealthy = false;
    }
    const status = postgresHealthy ? 'ok' : 'degraded';
    const components = {
      database: postgresHealthy ? 'healthy' : 'unavailable',
      canonicalPersistence: postgresHealthy ? 'healthy' : 'unavailable',
    };
    return res.status(postgresHealthy ? 200 : 503).json({
      status,
      service: 'northstar-solutions-api',
      persistence: 'postgresql',
      components,
      data: { status, service: 'northstar-solutions-api', persistence: 'postgresql', components },
    });
  });

  router.get('/polaris/status', retired);
  router.post('/contact', retired);
  router.get('/contact/messages', requireAuth, retired);

  const retiredAuthority = /^\/(?:polaris|customers|communications|opportunities|workflows|financial|assets|crew|jobs|analytics|engines|dashboard|leads|calls|calendar)(?:\/|$)/;
  router.all(retiredAuthority, requireAuth, retired);
  return router;
}

module.exports = { createLegacyAuthorityRetirementRouter, retired };
