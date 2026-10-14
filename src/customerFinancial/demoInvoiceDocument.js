'use strict';

const documentContract = require('./invoiceDocument');
const part5Contract = require('./invoicePart5Acceptance');
const demoPart5 = require('./demoInvoicePart5Acceptance');

function project(item, workspaceRevision) {
  // Rebuild the exact fictional Part 5 bundle from one demo-workspace snapshot,
  // validate it, and discard it. Demo never falls back to paid data or a
  // provider and cannot manufacture an issued document.
  part5Contract.projectBundle(demoPart5.bundle(item, workspaceRevision), 'demo');
  return documentContract.project(documentContract.unavailable('demo'), 'demo');
}

module.exports = { project };
