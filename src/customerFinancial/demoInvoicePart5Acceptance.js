'use strict';

const previewContract = require('./invoiceDraftPreview');
const preview = require('./demoInvoiceDraftPreview');
const contract = require('./invoicePart5Acceptance');

function project(item, workspaceRevision) {
  // Rebuild and strictly validate the current fictional preview from the
  // account-free workspace on every request. No paid repository or provider is
  // consulted and no Part 5 action is authorized.
  previewContract.project(preview.project(item, workspaceRevision));
  return contract.project(contract.unavailable('demo'), 'demo');
}

module.exports = { project };
