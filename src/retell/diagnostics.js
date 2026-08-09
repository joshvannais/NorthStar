'use strict';

const VERIFICATION = Object.freeze({
  signatureHeader: 'x-retell-signature',
  signatureFormat: 'v=<unix_ms>,d=<hex_digest>',
  timestamp: 'embedded-unix-milliseconds',
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
