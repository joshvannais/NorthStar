'use strict';

const part11=require('./demoAccountingPart11Acceptance');
const contract=require('./reportingPart12Acceptance');

function bundle(item,workspaceRevision) {
  const current=part11.bundle(item,workspaceRevision);
  const sources=contract.derive(current);
  return contract.bundle(current,contract.unavailable('demo',current,sources),sources);
}

module.exports={bundle};
