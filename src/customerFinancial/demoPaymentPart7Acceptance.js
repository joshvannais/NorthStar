'use strict';

const part6 = require('./demoInvoicePart6Acceptance');
const providerBoundary = require('./paymentProviderBoundary');
const providerConnection = require('./paymentProviderConnection');
const initiationPlan = require('./paymentInitiationPlan');
const contract = require('./paymentPart7Acceptance');

function bundle(item, workspaceRevision) {
  const current = part6.bundle(item, workspaceRevision);
  const boundary = providerBoundary.project(providerBoundary.unavailable());
  const connection = providerConnection.project(providerConnection.unavailable());
  const plan = initiationPlan.unavailable(
    current.part6Acceptance.publicSession, connection, 'demo');
  return contract.bundle(current,
    contract.unavailable('demo', current, boundary, connection, plan));
}

module.exports = { bundle };
