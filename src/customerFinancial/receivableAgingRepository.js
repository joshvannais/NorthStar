'use strict';

const contract = require('./receivableAging');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function restricted() {
  return Object.assign(new Error('Receivable-aging access is restricted.'), {
    code: 'CUSTOMER_FINANCIAL_RECEIVABLE_AGING_RESTRICTED', status: 403,
  });
}

async function read(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source) ||
      !UUID.test(source.organizationId || '') || !UUID.test(source.actorUserId || '') ||
      !UUID.test(source.authSessionId || '') || !['owner','admin'].includes(source.actorAccessRole)) {
    throw restricted();
  }
  // The mounted middleware reloads the exact tenant, membership, subscription and
  // session from PostgreSQL. No immutable issued receivable population exists yet,
  // so a database scan would confuse draft or simulated records with financial truth.
  return contract.unavailable();
}

module.exports = { read };
