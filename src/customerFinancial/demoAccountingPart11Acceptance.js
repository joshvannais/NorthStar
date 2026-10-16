'use strict';

const part10 = require('./demoCollectionPart10Acceptance');
const contract = require('./accountingPart11Acceptance');

function bundle(item, workspaceRevision) {
  const current = part10.bundle(item,workspaceRevision);
  const sources = contract.derive(current,'demo');
  return contract.bundle(current,contract.unavailable('demo',current,sources),sources);
}

module.exports = { bundle };
