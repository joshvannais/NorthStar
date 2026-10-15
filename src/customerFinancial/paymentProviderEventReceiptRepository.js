'use strict';

const providerBoundaryRepository = require('./paymentProviderBoundaryRepository');
const contract = require('./paymentProviderEventReceipt');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function restricted() {
  return Object.assign(new Error('Provider-event receipt access is restricted.'), {
    code: 'CUSTOMER_FINANCIAL_PROVIDER_EVENT_RECEIPT_RESTRICTED', status: 403,
  });
}

async function read(source, options = {}) {
  if (!source || typeof source !== 'object' || Array.isArray(source) ||
      !UUID.test(source.organizationId || '') || !UUID.test(source.actorUserId || '') ||
      !UUID.test(source.authSessionId || '') ||
      !['owner', 'admin'].includes(source.actorAccessRole)) throw restricted();
  const readProviderBoundary = options.readProviderBoundary || providerBoundaryRepository.read;
  const providerBoundary = await readProviderBoundary(source);
  // No public receiver is mounted until a tenant provider identity, signing
  // credential, exact adapter verifier and reviewed retention authority exist.
  // This private projection therefore cannot accept or persist caller data.
  return contract.unavailable(providerBoundary);
}

module.exports = { read };
