'use strict';

const contract = require('./paymentProviderBoundary');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function restricted() {
  return Object.assign(new Error('Payment-provider access is restricted.'), {
    code: 'CUSTOMER_FINANCIAL_PAYMENT_PROVIDER_RESTRICTED', status: 403,
  });
}

async function read(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source) ||
      !UUID.test(source.organizationId || '') || !UUID.test(source.actorUserId || '') ||
      !UUID.test(source.authSessionId || '') || !['owner','admin'].includes(source.actorAccessRole)) {
    throw restricted();
  }
  // The mounted middleware has reloaded this exact session, membership,
  // subscription and tenant from PostgreSQL. Part 7B does not yet provide a
  // tenant provider-account identity or connection capability grant, so this
  // projection must remain value-free and perform no provider lookup.
  return contract.unavailable();
}

module.exports = { read };
