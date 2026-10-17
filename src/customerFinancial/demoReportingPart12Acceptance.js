'use strict';

const part11=require('./demoAccountingPart11Acceptance');
const contract=require('./reportingPart12Acceptance');

function bundle(item,workspaceRevision) {
  const current=part11.bundle(item,workspaceRevision);
  return contract.bundle(current);
}

module.exports={bundle};
