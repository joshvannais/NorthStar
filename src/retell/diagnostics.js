'use strict';

const config = require('../config');

function getDiagnostics() {
  return {
    status: 'ok',
    canonicalWebhook: true,
    lifecycleAuthority: 'postgresql',
    activeSessions: 'tenant_scoped_canonical_endpoint_only',
    retellPhoneNumbers: (config.retell && (config.retell.fromNumbers || config.retell.phoneNumbers)) || [],
    retellAgentId: (config.retell && config.retell.agentId) || null,
    retellConfigured: Boolean(config.retell && config.retell.apiKey),
  };
}

module.exports = { getDiagnostics };
