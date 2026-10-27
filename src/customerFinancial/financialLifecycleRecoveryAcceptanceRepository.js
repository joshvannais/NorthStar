'use strict';

const providerBoundary = require('./paymentProviderBoundary');
const paidJourneyRepository = require('./paidTenantJourneyAcceptanceRepository');
const providerRecoveryRepository = require('./providerLifecycleRecoveryRepository');
const providerAcceptanceRepository = require('./providerLifecycleAcceptanceRepository');
const contract = require('./financialLifecycleRecoveryAcceptance');

function changed(cause) {
  const error = Object.assign(new Error(
    'The exact financial lifecycle recovery journey changed. Reload its current evidence.'), {
    code: 'CUSTOMER_FINANCIAL_RECOVERY_ACCEPTANCE_CHANGED', status: 409,
  });
  if (cause) Object.defineProperty(error, 'cause', { value: cause });
  return error;
}

async function read(pool, source, estimateId, receiptId, receiptDigest) {
  try {
    const beforePaid = await paidJourneyRepository.read(
      pool, source, estimateId, receiptId, receiptDigest);
    const beforeRecovery = await providerRecoveryRepository.read(source);
    const beforeAcceptance = await providerAcceptanceRepository.read(source);
    const context = { source, estimateId, handoffReceiptId: receiptId,
      handoffReceiptDigest: receiptDigest };
    const value = contract.candidate(beforePaid, beforeRecovery, beforeAcceptance, context);
    const afterRecovery = await providerRecoveryRepository.read(source);
    const afterAcceptance = await providerAcceptanceRepository.read(source);
    const afterPaid = await paidJourneyRepository.read(
      pool, source, estimateId, receiptId, receiptDigest);
    // The second raw snapshots are untrusted repository values. Build their
    // exact Part 14C projection first so the contract's recursive
    // descriptor-only data gate rejects accessors, proxies and exotic values
    // before any digest or serialization can traverse them. The canonical
    // projection binds the full digest of each of the three sources, so one
    // comparison retains exact before/after currentness without touching raw
    // second-snapshot fields here.
    const afterValue = contract.candidate(
      afterPaid, afterRecovery, afterAcceptance, context);
    if (providerBoundary.digest(value) !== providerBoundary.digest(afterValue)) {
      throw changed();
    }
    return contract.project(value, afterPaid, afterRecovery, afterAcceptance, context);
  } catch (error) {
    if (error?.code === 'CUSTOMER_FINANCIAL_RECOVERY_ACCEPTANCE_CHANGED') throw error;
    if ([403, 404, 503].includes(error?.status)) throw error;
    throw changed(error);
  }
}

module.exports = { read };
