'use strict';

const express = require('express');
const { securityHeaders } = require('../middleware/security');
const { auditLogger } = require('../middleware/auditLog');
const { getDiagnostics, getWebhookConfiguration } = require('../retell/diagnostics');
const { handleWebhook, handleRetellWebhook } = require('../voice/webhook');

const MAX_WEBHOOK_BODY = '1mb';
const rawWebhookBody = express.raw({
  limit: MAX_WEBHOOK_BODY,
  type() { return true; },
});

function createRetellWebhookBoundaryRouter() {
  // Only the two documented spellings below own the raw signed boundary and
  // its transaction-scoped audit row. Express defaults would also accept case
  // variants and an optional trailing slash, while the audit classifier is
  // intentionally exact.
  const router = express.Router({ caseSensitive: true, strict: true });

  // These exact provider entry points must run before the application's global
  // JSON parser. Composite signature and replay validation therefore operate on
  // the received bytes before JSON decoding or canonical persistence.
  router.post('/api/retell/webhook', securityHeaders, auditLogger, rawWebhookBody, handleRetellWebhook);
  router.post('/api/v1/voice/webhook', securityHeaders, auditLogger, rawWebhookBody, handleWebhook);

  // Public inspection is intentionally limited to immutable protocol facts.
  // Tenant state and runtime/provider configuration remain behind canonical,
  // authenticated endpoints.
  router.get('/api/retell/webhook/diagnostics', securityHeaders, auditLogger, (_req, res) => {
    return res.json(getDiagnostics());
  });
  router.get('/api/retell/webhook/config', securityHeaders, auditLogger, (_req, res) => {
    return res.json(getWebhookConfiguration());
  });

  return router;
}

module.exports = { createRetellWebhookBoundaryRouter, MAX_WEBHOOK_BODY };
