'use strict';

const part12Repository = require('./reportingPart12AcceptanceRepository');
const part9Repository = require('./paymentPart9AcceptanceRepository');
const part10Repository = require('./collectionPart10AcceptanceRepository');
const part11Repository = require('./accountingPart11AcceptanceRepository');
const invoiceReportingRepository = require('./invoiceReceivableReportingRepository');
const paymentReportingRepository = require('./paymentCashReportingRepository');
const downstreamReadersRepository = require('./downstreamReportingReadersRepository');
const providerBoundary = require('./paymentProviderBoundary');
const contract = require('./paidTenantJourneyAcceptance');

function changed(cause) {
  const error = Object.assign(new Error(
    'The exact paid provider-disabled journey changed. Reload its current evidence.'), {
    code: 'CUSTOMER_FINANCIAL_PAID_JOURNEY_CHANGED', status: 409,
  });
  if (cause) Object.defineProperty(error, 'cause', { value: cause });
  return error;
}

async function read(pool, source, estimateId, receiptId, receiptDigest, options = {}) {
  const readPart12 = options.readPart12 || part12Repository.readBundle;
  try {
    const captures = { part9: [], part10: [], part11: [], reporting: [] };
    const readPart9 = async (...args) => {
      const value = await part9Repository.readBundle(...args);
      captures.part9.push(value); return value;
    };
    const readPart10 = async (...args) => {
      const value = await part10Repository.readBundle(...args, { readPart9 });
      captures.part10.push(value); return value;
    };
    const readPart11 = async (...args) => {
      const value = await part11Repository.readBundle(...args, { readPart10 });
      captures.part11.push(value); return value;
    };
    const readSources = async exactSource => {
      const [invoiceReceivableReporting, paymentCashReporting] = await Promise.all([
        invoiceReportingRepository.read(exactSource), paymentReportingRepository.read(exactSource),
      ]);
      const downstreamReportingReaders = await downstreamReadersRepository.read(exactSource, {
        readSources: async () => ({ invoiceReceivableReporting, paymentCashReporting }),
      });
      const value = { invoiceReceivableReporting, paymentCashReporting,
        downstreamReportingReaders };
      captures.reporting.push(value); return value;
    };
    const part12Options = options.readPart12 ? undefined : { readPart11, readSources };
    const part12 = await readPart12(pool, source, estimateId, receiptId, receiptDigest,
      part12Options);
    const same = values => values.length > 0 && values.every(value =>
      providerBoundary.digest(value) === providerBoundary.digest(values[0]));
    const executionTrace = options.executionTrace || (() => {
      if (captures.part9.length !== 4 || captures.part10.length !== 2 ||
          captures.part11.length !== 1 || captures.reporting.length !== 2 ||
          !same(captures.part9) || !same(captures.part10) || !same(captures.part11) ||
          !same(captures.reporting)) throw changed();
      return {
        part9: captures.part9[0], part10: captures.part10[0], part11: captures.part11[0],
        part12Sources: captures.reporting[0],
        repositoryReads: { part9: 4, part10: 2, part11: 1, part12Sources: 2, part12: 1 },
      };
    })();
    return contract.candidate(part12, {
      source, estimateId, handoffReceiptId: receiptId, handoffReceiptDigest: receiptDigest,
    }, executionTrace);
  } catch (error) {
    if (error?.code === 'CUSTOMER_FINANCIAL_PAID_JOURNEY_CHANGED') throw error;
    // Keep upstream authorization, record-scope, and source-availability
    // failures exact. Converting them to currentness conflicts would blur the
    // tenant boundary and make absent records look like stale journey data.
    if ([403, 404, 503].includes(error?.status)) throw error;
    throw changed(error);
  }
}

module.exports = { read };
