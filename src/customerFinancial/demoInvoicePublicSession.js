'use strict';

const documentContract = require('./invoiceDocument');
const demoDocument = require('./demoInvoiceDocument');
const sessionContract = require('./invoicePublicSession');

function project(item, workspaceRevision) {
  documentContract.project(demoDocument.project(item, workspaceRevision), 'demo');
  return sessionContract.project(sessionContract.unavailable('demo'), 'demo');
}

module.exports = { project };
