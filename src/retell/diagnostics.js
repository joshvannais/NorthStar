'use strict';

const VERIFICATION = Object.freeze({
  algorithm: 'hmac-sha256',
  signatureHeader: 'x-retell-signature',
  timestampHeader: 'x-retell-timestamp',
  maximumAgeSeconds: 300,
});

function verificationProjection() {
  return { ...VERIFICATION };
}

function getDiagnostics() {
  return {
    endpoint: { method: 'POST', path: '/api/retell/webhook' },
    verification: verificationProjection(),
  };
}

function getWebhookConfiguration() {
  return {
    endpoint: { method: 'POST', path: '/api/retell/webhook' },
    verification: verificationProjection(),
  };
}

module.exports = { getDiagnostics, getWebhookConfiguration, VERIFICATION };
