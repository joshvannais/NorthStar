'use strict';

const express = require('express');
const db = require('../db');
const {
  requireOnboardedInternal,
  requireTenantAccess,
  requireVerifiedExternalAction,
} = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { ingestLead } = require('../services/canonicalGraphService');
const { listCanonicalGraphs, requestContext } = require('./canonicalPolaris');

const router = express.Router();

function idempotencyKey(req) {
  return req.get('Idempotency-Key') || req.get('X-Idempotency-Key') || '';
}

function blocked(_req, res) {
  return res.status(409).json({
    success: false,
    error: {
      code: 'LEGACY_AUTHORITY_READ_ONLY',
      message: 'This legacy mutation is disabled; use an organization-scoped canonical operation.',
    },
  });
}

router.post('/leads', requireOnboardedInternal, requirePermission('leads', 'create'), async function (req, res) {
  const key = idempotencyKey(req);
  if (!key) {
    return res.status(400).json({ success: false, error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Idempotency-Key is required for canonical writes.' } });
  }
  const body = req.body || {};
  const name = String(body.customerName || body.caller || body.name || '').trim();
  if (!name) {
    return res.status(400).json({ success: false, error: { code: 'CUSTOMER_NAME_REQUIRED', message: 'Customer name is required.' } });
  }
  const serviceKey = String(body.serviceKey || body.serviceType || body.serviceRequested || body.service || 'general').trim().toLowerCase();
  const transcript = Array.isArray(body.transcript) ? body.transcript : [{
    turnId: 'manual-lead-1',
    speaker: 'customer',
    text: String(body.summary || body.notes || (serviceKey + ' inquiry')),
  }];
  const result = await ingestLead(db.getPool(), {
    tenantContext: req.tenantContext,
    idempotencyKey: key,
    sourceVersion: 'authenticated-lead-api-v1',
    external: { customerId: body.externalCustomerId || null },
    customer: {
      name,
      email: body.email || null,
      phone: body.phone || body.phoneNumber || null,
      address: body.address || body.jobAddress || null,
    },
    transcript,
    facts: Array.isArray(body.facts) ? body.facts : [],
    service: { key: serviceKey, scope: body.scope || {} },
    appointmentPreference: body.appointmentPreference || (body.preferredTime ? { text: body.preferredTime } : null),
  });
  if (result.status !== 201) return res.status(result.status).json(result.body);
  return res.status(201).json({
    ...result.body,
    lead: {
      id: result.body.ids.opportunity,
      customerId: result.body.ids.customer,
      customerName: name,
      phone: body.phone || body.phoneNumber || null,
      service: serviceKey,
      status: 'lead',
      canonical: true,
    },
  });
});

router.get('/leads/export', requireVerifiedExternalAction, requirePermission('leads', 'read'), async function (req, res) {
  try {
    const items = await listCanonicalGraphs(db.getPool(), requestContext(req), { limit: 100, status: null, customerId: null });
    const fields = ['id', 'customerId', 'customerName', 'phone', 'email', 'service', 'status', 'estimatedPrice'];
    const records = items.map(function (item) {
      return {
        id: item.ids.opportunity,
        customerId: item.ids.customer,
        customerName: item.customer.name,
        phone: item.customer.phone,
        email: item.customer.email,
        service: item.opportunity.serviceType,
        status: item.opportunity.status,
        estimatedPrice: item.estimate.customerPrice,
      };
    });
    function csv(value) {
      const normalized = value === undefined || value === null ? '' : String(value);
      return /[",\n]/.test(normalized) ? '"' + normalized.replace(/"/g, '""') + '"' : normalized;
    }
    const output = '\ufeff' + fields.join(',') + '\n' + records.map(function (record) {
      return fields.map(function (field) { return csv(record[field]); }).join(',');
    }).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=leads-export-' + new Date().toISOString().slice(0, 10) + '.csv');
    return res.send(output);
  } catch (_error) {
    return res.status(503).json({ success: false, error: { code: 'CANONICAL_PERSISTENCE_UNAVAILABLE', message: 'Canonical PostgreSQL persistence is unavailable.' } });
  }
});

router.put('/leads/:id', requireTenantAccess, requirePermission('leads', 'update'), blocked);
router.delete('/leads/:id', requireTenantAccess, requirePermission('leads', 'delete'), blocked);
router.post('/leads/import', requireTenantAccess, requirePermission('leads', 'create'), blocked);
router.post('/leads/simulate', requireTenantAccess, requirePermission('leads', 'create'), blocked);

module.exports = router;
