'use strict';

const express = require('express');
const { requireTenantAccess, requireRole } = require('../auth/middleware');
const { BillingError } = require('../billing/service');

function requestId(req) {
  return req.requestId || req.correlationId || 'unavailable';
}

function unavailable(req, res) {
  return res.status(503).json({
    error: 'Billing is temporarily unavailable',
    code: 'billing_unavailable',
    requestId: requestId(req),
  });
}

function failure(req, res, error) {
  if (error instanceof BillingError) {
    return res.status(error.status).json({ error: error.message, code: error.code, requestId: requestId(req) });
  }
  return unavailable(req, res);
}

function exactBody(body, keys) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const actual = Object.keys(body).sort();
  const expected = keys.slice().sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function createBillingWebhookRouter(options = {}) {
  const router = express.Router();
  const service = options.service || null;
  router.post('/webhook', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
    if (!service) return unavailable(req, res);
    if (!Buffer.isBuffer(req.body)) {
      return res.status(400).json({
        error: 'Billing webhook is invalid',
        code: 'billing_webhook_invalid',
        requestId: requestId(req),
      });
    }
    try {
      const outcome = await service.webhook(req.body, req.headers['stripe-signature']);
      return res.status(200).json({
        received: true,
        result: outcome.result,
        code: outcome.code,
        requestId: requestId(req),
      });
    } catch (error) {
      return failure(req, res, error);
    }
  });
  return router;
}

function createBillingAccountRouter(options = {}) {
  const router = express.Router();
  const service = options.service || null;
  const owner = [requireTenantAccess, requireRole('owner')];

  router.post('/checkout', ...owner, async (req, res) => {
    if (!service) return unavailable(req, res);
    if (!exactBody(req.body, ['planKey'])) {
      return res.status(400).json({ error: 'Billing request is invalid', code: 'billing_request_invalid', requestId: requestId(req) });
    }
    try {
      const result = await service.checkout({
        organizationId: req.tenantContext.organizationId,
        userId: req.tenantContext.userId,
        planKey: req.body.planKey,
      });
      return res.status(201).json({ ...result, requestId: requestId(req) });
    } catch (error) { return failure(req, res, error); }
  });

  router.post('/portal', ...owner, async (req, res) => {
    if (!service) return unavailable(req, res);
    if (!exactBody(req.body, [])) {
      return res.status(400).json({ error: 'Billing request is invalid', code: 'billing_request_invalid', requestId: requestId(req) });
    }
    try {
      const result = await service.portal({
        organizationId: req.tenantContext.organizationId,
        userId: req.tenantContext.userId,
      });
      return res.status(201).json({ ...result, requestId: requestId(req) });
    } catch (error) { return failure(req, res, error); }
  });

  router.post('/cancel', ...owner, async (req, res) => {
    if (!service) return unavailable(req, res);
    if (!exactBody(req.body, [])) {
      return res.status(400).json({ error: 'Billing request is invalid', code: 'billing_request_invalid', requestId: requestId(req) });
    }
    try {
      const result = await service.cancel({
        organizationId: req.tenantContext.organizationId,
        userId: req.tenantContext.userId,
      });
      return res.status(202).json({ ...result, requestId: requestId(req) });
    } catch (error) { return failure(req, res, error); }
  });

  return router;
}

module.exports = { createBillingAccountRouter, createBillingWebhookRouter };
