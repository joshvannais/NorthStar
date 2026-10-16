'use strict';

const providerBoundary = require('./paymentProviderBoundary');
const reporting = require('./paymentCashReporting');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function failure(code,status,message) {
  return Object.assign(new Error(message),{code,status});
}

function validateSource(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source) ||
      Object.keys(source).length !== 4 || !UUID.test(source.organizationId || '') ||
      !UUID.test(source.actorUserId || '') || !UUID.test(source.authSessionId || '') ||
      !['owner','admin'].includes(source.actorAccessRole)) {
    throw failure('CUSTOMER_FINANCIAL_PAYMENT_CASH_REPORTING_RESTRICTED',403,
      'Payment and cash reporting access is restricted.');
  }
}

async function read(source,dependencies = {}) {
  validateSource(source);
  const readSources = dependencies.readSources || (async () => reporting.defaultSources());
  const before = reporting.sourceBundle(await readSources(source));
  const value = reporting.unavailable(before);
  const after = reporting.sourceBundle(await readSources(source));
  if (providerBoundary.digest(before) !== providerBoundary.digest(after)) {
    throw failure('CUSTOMER_FINANCIAL_PAYMENT_CASH_REPORTING_SOURCE_CHANGED',409,
      'The payment and cash reporting source changed. Reload the current report.');
  }
  return reporting.project(value,after);
}

module.exports = { read };
