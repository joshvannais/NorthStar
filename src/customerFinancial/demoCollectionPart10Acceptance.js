'use strict';

const part9 = require('./demoPaymentPart9Acceptance');
const contract = require('./collectionPart10Acceptance');

function bundle(item, workspaceRevision) {
  const current = part9.bundle(item, workspaceRevision);
  const sources = contract.defaultSources();
  return contract.bundle(current, contract.unavailable('demo', current, sources), sources);
}

module.exports = { bundle };
