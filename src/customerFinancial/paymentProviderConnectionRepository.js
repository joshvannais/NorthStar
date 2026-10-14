'use strict';

const contract = require('./paymentProviderConnection');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function restricted() {
  return Object.assign(new Error('Payment-provider connection access is restricted.'), {
    code: 'CUSTOMER_FINANCIAL_PROVIDER_CONNECTION_RESTRICTED', status: 403,
  });
}

function sourceCurrent(source) {
  return source && typeof source === 'object' && !Array.isArray(source) &&
    UUID.test(source.organizationId || '') && UUID.test(source.actorUserId || '') &&
    UUID.test(source.authSessionId || '') && source.actorAccessRole === 'owner';
}

async function read(source) {
  if (!sourceCurrent(source)) throw restricted();
  return contract.unavailable();
}

async function attempt(source, body) {
  if (!sourceCurrent(source)) throw restricted();
  contract.validateIntent(body);
  // No accepted provider account, MFA ceremony, provider-scoped grant, or
  // server-side credential authority exists. Intents stop here without a
  // provider lookup, credential operation, durable receipt, or money effect.
  return contract.unavailable();
}

module.exports = { read, attempt };
