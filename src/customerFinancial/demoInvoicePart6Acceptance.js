'use strict';

const part5 = require('./demoInvoicePart5Acceptance');
const portalContract = require('./invoiceCustomerPortal');
const portal = require('./demoInvoiceCustomerPortal');
const contract = require('./invoicePart6Acceptance');

function bundle(item, workspaceRevision) {
  portalContract.project(portal.project(item, workspaceRevision), 'demo');
  const current = part5.bundle(item, workspaceRevision);
  return contract.bundle(current,
    contract.unavailable('demo', current.acceptance.previewWitness));
}

module.exports = { bundle };
