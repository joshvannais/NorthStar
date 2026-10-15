'use strict';

const receivableAging = require('./receivableAging');
const receivableAgingRepository = require('./receivableAgingRepository');
const contract = require('./collectionReview');

function unavailableError() {
  return Object.assign(new Error('Collection review is unavailable.'), {
    code: 'CUSTOMER_FINANCIAL_COLLECTION_REVIEW_UNAVAILABLE', status: 503,
  });
}

async function read(source, options = {}) {
  const readReceivableAging = options.readReceivableAging || receivableAgingRepository.read;
  const sourceWitness = await readReceivableAging(source);
  try {
    receivableAging.project(sourceWitness);
    return contract.unavailable(sourceWitness);
  } catch (_error) { throw unavailableError(); }
}

module.exports = { read };
