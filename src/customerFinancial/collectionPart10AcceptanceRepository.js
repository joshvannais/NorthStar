'use strict';

const part9Contract = require('./paymentPart9Acceptance');
const part9Repository = require('./paymentPart9AcceptanceRepository');
const receivableAging = require('./receivableAging');
const receivableAgingRepository = require('./receivableAgingRepository');
const collectionReview = require('./collectionReview');
const collectionReviewRepository = require('./collectionReviewRepository');
const collectionHandoff = require('./collectionHandoffReadiness');
const collectionHandoffRepository = require('./collectionHandoffReadinessRepository');
const contract = require('./collectionPart10Acceptance');

function changed() {
  return Object.assign(new Error('The exact Part 10 collection boundary changed. Reload its current evidence.'), {
    code: 'CUSTOMER_FINANCIAL_COLLECTION_PART10_CHANGED', status: 409,
  });
}

async function readBundle(pool, source, estimateId, receiptId, receiptDigest, options = {}) {
  const readPart9 = options.readPart9 || part9Repository.readBundle;
  const readReceivableAging = options.readReceivableAging || receivableAgingRepository.read;
  const readCollectionReview = options.readCollectionReview || collectionReviewRepository.read;
  const readCollectionHandoff = options.readCollectionHandoff || collectionHandoffRepository.read;
  const before = part9Contract.projectBundle(await readPart9(
    pool, source, estimateId, receiptId, receiptDigest), 'paid');
  const aging = await readReceivableAging(source);
  const review = await readCollectionReview(source, {
    readReceivableAging: async () => aging,
  });
  const handoff = await readCollectionHandoff(source, {
    readCollectionReview: async () => review,
  });
  const sources = { receivableAging: aging, collectionReview: review,
    collectionHandoff: handoff };
  try {
    receivableAging.project(aging);
    collectionReview.projectWithSource(review, aging);
    collectionHandoff.projectWithSource(handoff, review);
  } catch (_error) { throw changed(); }
  const after = part9Contract.projectBundle(await readPart9(
    pool, source, estimateId, receiptId, receiptDigest), 'paid');
  if (JSON.stringify(before) !== JSON.stringify(after)) throw changed();
  try {
    const acceptance = contract.unavailable('paid', after, sources);
    return contract.bundle(after, acceptance, sources);
  } catch (_error) { throw changed(); }
}

module.exports = { readBundle };
