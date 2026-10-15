'use strict';

const part7 = require('./demoPaymentPart7Acceptance');
const contract = require('./paymentPart9Acceptance');

function bundle(item, workspaceRevision) {
  const current = part7.bundle(item, workspaceRevision);
  return contract.bundle(current, contract.unavailable('demo', current));
}

module.exports = { bundle };
