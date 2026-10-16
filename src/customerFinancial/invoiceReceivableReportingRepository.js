'use strict';

const providerBoundary = require('./paymentProviderBoundary');
const receivableAging = require('./receivableAging');
const receivableRepository = require('./receivableAgingRepository');
const reporting = require('./invoiceReceivableReporting');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function failure(code, status, message) {
  return Object.assign(new Error(message), { code, status });
}

function validateSource(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source) ||
      Object.keys(source).length !== 4 || !UUID.test(source.organizationId || '') ||
      !UUID.test(source.actorUserId || '') || !UUID.test(source.authSessionId || '') ||
      !['owner','admin'].includes(source.actorAccessRole)) {
    throw failure('CUSTOMER_FINANCIAL_REPORTING_RESTRICTED', 403,
      'Invoice and receivable reporting access is restricted.');
  }
}

async function read(source, dependencies = {}) {
  validateSource(source);
  const readReceivables = dependencies.readReceivables || receivableRepository.read;
  const before = receivableAging.project(await readReceivables(source));
  const value = reporting.unavailable(before);
  const after = receivableAging.project(await readReceivables(source));
  if (providerBoundary.digest(before) !== providerBoundary.digest(after)) {
    throw failure('CUSTOMER_FINANCIAL_REPORTING_SOURCE_CHANGED', 409,
      'The receivable reporting source changed. Reload the current report.');
  }
  return reporting.project(value, after);
}

module.exports = { read };
