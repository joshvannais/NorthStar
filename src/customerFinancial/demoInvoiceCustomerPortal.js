'use strict';

const sessionContract = require('./invoicePublicSession');
const demoSession = require('./demoInvoicePublicSession');
const portalContract = require('./invoiceCustomerPortal');

function project(item, workspaceRevision) {
  sessionContract.project(demoSession.project(item, workspaceRevision), 'demo');
  return portalContract.project(portalContract.unavailable('demo'), 'demo');
}

module.exports = { project };
