'use strict';

const previewContract = require('./invoiceDraftPreview');
const preview = require('./demoInvoiceDraftPreview');
const contract = require('./invoicePart5Acceptance');

function project(item, workspaceRevision) {
  // Rebuild and strictly validate the current fictional preview from the
  // account-free workspace on every request. No paid repository or provider is
  // consulted and no Part 5 action is authorized.
  const currentPreview = previewContract.project(preview.project(item, workspaceRevision));
  return contract.project(contract.unavailable('demo', currentPreview), 'demo');
}

function bundle(item, workspaceRevision) {
  // One immutable demo-workspace snapshot owns both projections. This avoids
  // pairing a fictional preview from one reset/revision with another Part 5
  // response and performs no paid repository or provider call.
  const currentPreview = previewContract.project(preview.project(item, workspaceRevision));
  return contract.bundle(currentPreview,
    contract.project(contract.unavailable('demo', currentPreview), 'demo'));
}

module.exports = { project, bundle };
