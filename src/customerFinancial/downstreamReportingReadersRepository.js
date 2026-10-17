'use strict';

const providerBoundary = require('./paymentProviderBoundary');
const invoiceRepository = require('./invoiceReceivableReportingRepository');
const paymentRepository = require('./paymentCashReportingRepository');
const readers = require('./downstreamReportingReaders');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function failure(code,status,message) {
  return Object.assign(new Error(message),{code,status});
}

function validateSource(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source) ||
      Object.keys(source).length !== 4 || !UUID.test(source.organizationId || '') ||
      !UUID.test(source.actorUserId || '') || !UUID.test(source.authSessionId || '') ||
      !['owner','admin'].includes(source.actorAccessRole)) {
    throw failure('CUSTOMER_FINANCIAL_DOWNSTREAM_READERS_RESTRICTED',403,
      'Downstream financial reporting access is restricted.');
  }
}

async function defaultReadSources(source) {
  const [invoiceReceivableReporting,paymentCashReporting]=await Promise.all([
    invoiceRepository.read(source),paymentRepository.read(source),
  ]);
  return {invoiceReceivableReporting,paymentCashReporting};
}

async function read(source,dependencies={}) {
  validateSource(source);
  const readSources=dependencies.readSources || defaultReadSources;
  const before=readers.sourceBundle(await readSources(source));
  const value=readers.unavailable(before);
  const after=readers.sourceBundle(await readSources(source));
  if (providerBoundary.digest(before) !== providerBoundary.digest(after)) {
    throw failure('CUSTOMER_FINANCIAL_DOWNSTREAM_READERS_SOURCE_CHANGED',409,
      'The downstream reporting sources changed. Reload the current report.');
  }
  return readers.project(value,after);
}

module.exports = { read };
