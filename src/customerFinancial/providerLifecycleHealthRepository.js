'use strict';

const contract = require('./providerLifecycleHealth');
const providerBoundary = require('./paymentProviderBoundary');
const providerConnection = require('./paymentProviderConnection');
const providerEventReceipt = require('./paymentProviderEventReceipt');
const providerBoundaryRepository = require('./paymentProviderBoundaryRepository');
const providerConnectionRepository = require('./paymentProviderConnectionRepository');
const providerEventReceiptRepository = require('./paymentProviderEventReceiptRepository');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function restricted() {
  return Object.assign(new Error('Provider lifecycle health access is restricted.'), {
    code: 'CUSTOMER_FINANCIAL_PROVIDER_LIFECYCLE_RESTRICTED', status: 403,
  });
}

function stale() {
  return Object.assign(new Error('Refresh the current provider lifecycle evidence.'), {
    code: 'CUSTOMER_FINANCIAL_PROVIDER_LIFECYCLE_STALE', status: 409,
  });
}

function sourceCurrent(source) {
  return source && typeof source === 'object' && !Array.isArray(source) &&
    Object.keys(source).sort().join(',') ===
      'actorAccessRole,actorUserId,authSessionId,organizationId' &&
    UUID.test(source.organizationId || '') && UUID.test(source.actorUserId || '') &&
    UUID.test(source.authSessionId || '') && source.actorAccessRole === 'owner';
}

function createRepository(options = {}) {
  const readBoundary = options.readBoundary || providerBoundaryRepository.read;
  const readConnection = options.readConnection || providerConnectionRepository.read;
  const readReceipt = options.readReceipt || providerEventReceiptRepository.read;
  async function snapshot(source) {
    const [boundaryRaw, connectionRaw, receiptRaw] = await Promise.all([
      readBoundary(source), readConnection(source), readReceipt(source),
    ]);
    return Object.freeze({ boundary: providerBoundary.project(boundaryRaw),
      connection: providerConnection.project(connectionRaw),
      receipt: providerEventReceipt.project(receiptRaw) });
  }
  async function read(source) {
    if (!sourceCurrent(source)) throw restricted();
    const before = await snapshot(source);
    const value = contract.unavailable(before.boundary, before.connection, before.receipt);
    const after = await snapshot(source);
    if (JSON.stringify(before) !== JSON.stringify(after)) throw stale();
    return contract.project(value, after.boundary, after.connection, after.receipt);
  }
  return Object.freeze({ read });
}

const production = createRepository();
module.exports = { sourceCurrent, createRepository, read: production.read };
