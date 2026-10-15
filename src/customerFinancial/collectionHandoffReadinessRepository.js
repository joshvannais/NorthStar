'use strict';

const collectionReview = require('./collectionReview');
const collectionReviewRepository = require('./collectionReviewRepository');
const contract = require('./collectionHandoffReadiness');

function unavailableError() {
  return Object.assign(new Error('Collection handoff readiness is unavailable.'), {
    code: 'CUSTOMER_FINANCIAL_COLLECTION_HANDOFF_UNAVAILABLE', status: 503,
  });
}

async function read(source, options = {}) {
  const readCollectionReview = options.readCollectionReview || collectionReviewRepository.read;
  const sourceWitness = await readCollectionReview(source);
  try {
    collectionReview.project(sourceWitness);
    return contract.unavailable(sourceWitness);
  } catch (_error) { throw unavailableError(); }
}

module.exports = { read };
