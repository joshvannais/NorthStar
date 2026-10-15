'use strict';

const receiptRepository = require('./paymentProviderEventReceiptRepository');
const contract = require('./paymentProviderEventNormalization');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function restricted() {
  return Object.assign(new Error('Provider-event normalization access is restricted.'), {
    code: 'CUSTOMER_FINANCIAL_PROVIDER_EVENT_NORMALIZATION_RESTRICTED', status: 403,
  });
}

async function read(source, options = {}) {
  if (!source || typeof source !== 'object' || Array.isArray(source) ||
      !UUID.test(source.organizationId || '') || !UUID.test(source.actorUserId || '') ||
      !UUID.test(source.authSessionId || '') ||
      !['owner', 'admin'].includes(source.actorAccessRole)) throw restricted();
  const readReceipt = options.readReceipt || receiptRepository.read;
  const receipt = await readReceipt(source);
  // Part 8A exposes no authenticated receipt or event identity. Part 8B can
  // freeze deterministic normalization rules, but cannot accept caller data,
  // normalize an event, persist a projection or produce a financial effect.
  return contract.unavailable(receipt);
}

module.exports = { read };
