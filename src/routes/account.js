'use strict';

const express = require('express');
const db = require('../db');
const { requireActiveAccount } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');

const router = express.Router();

function requestId(req) {
  return req.requestId || req.correlationId || 'unavailable';
}

router.get('/preferences', requireActiveAccount, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT preferences FROM organization_account_preferences WHERE organization_id = $1',
      [req.tenantContext.organizationId]
    );
    if (!result || result.rows.length !== 1) {
      return res.status(503).json({ error: 'Account preferences are unavailable', code: 'preferences_unavailable', requestId: requestId(req) });
    }
    return res.json({ preferences: result.rows[0].preferences, requestId: requestId(req) });
  } catch (_error) {
    return res.status(503).json({ error: 'Account preferences are unavailable', code: 'preferences_unavailable', requestId: requestId(req) });
  }
});

router.put('/preferences', requireActiveAccount, requirePermission('settings', 'update'), async (req, res) => {
  const preferences = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : null;
  if (!preferences || Buffer.byteLength(JSON.stringify(preferences), 'utf8') > 32768) {
    return res.status(400).json({ error: 'Account preferences are invalid', code: 'invalid_preferences', requestId: requestId(req) });
  }
  try {
    const result = await db.query(
      `UPDATE organization_account_preferences
          SET preferences = $2::jsonb, updated_at = NOW()
        WHERE organization_id = $1
        RETURNING preferences`,
      [req.tenantContext.organizationId, JSON.stringify(preferences)]
    );
    if (!result || result.rows.length !== 1) {
      return res.status(503).json({ error: 'Account preferences are unavailable', code: 'preferences_unavailable', requestId: requestId(req) });
    }
    return res.json({ preferences: result.rows[0].preferences, requestId: requestId(req) });
  } catch (_error) {
    return res.status(503).json({ error: 'Account preferences are unavailable', code: 'preferences_unavailable', requestId: requestId(req) });
  }
});

module.exports = router;
