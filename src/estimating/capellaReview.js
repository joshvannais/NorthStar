'use strict';

const { stableValue } = require('../services/businessProfileAdapter');
const MAX_MONEY = /^(0|[1-9][0-9]{0,11})\.[0-9]{2}$/;
function priceCents(value) {
  return typeof value === 'string' && MAX_MONEY.test(value) ? BigInt(value.replace('.', '')) : null;
}
function recordedCents(value) {
  // Accept only the bounded decimal amounts actually represented by the snapshot.
  // Never round extra precision or silently convert a missing amount to zero.
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  const text = String(value);
  if (!/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  return priceCents(whole + '.' + fraction.padEnd(2, '0'));
}
function decimal(cents) {
  const negative = cents < 0n, absolute = negative ? -cents : cents;
  return (negative ? '-' : '') + (absolute / 100n) + '.' + String(absolute % 100n).padStart(2, '0');
}
function buildCapellaReview(review, snapshot) {
  const decision = review.decisions && review.decisions.current;
  const result = {
    contract: 'NorthStarCapellaRecordedCosts/v1', simulated: review.simulated === true,
    sourcePins: review.pins, recordedAt: review.recordedAt, currency: review.currency,
    decision: decision ? { id: decision.id, revision: decision.revision, digest: decision.digest } : null,
    state: 'review_required', priceBeforeTax: null, recordedDirectCosts: null, remainingAfterDirectCosts: null,
    message: 'Review the job and price to compare it with recorded costs.',
    limitation: 'This comparison covers recorded direct costs only. Additional expenses can reduce the amount remaining; it is not a profit forecast.',
  };
  function unavailable(state, message) { result.state = state; result.message = message; return stableValue(result); }
  if (!decision || decision.action !== 'approve') return stableValue(result);
  if (!decision.id || !Number.isSafeInteger(decision.revision) || decision.revision < 1 || !decision.digest ||
      !decision.sourcePins || JSON.stringify(stableValue(decision.sourcePins)) !== JSON.stringify(stableValue(review.pins)) ||
      decision.currency !== review.currency || !/^[A-Z]{3}$/.test(review.currency || '')) {
    return unavailable('review_changed', 'Refresh this estimate and review its saved price before comparing costs.');
  }
  const price = priceCents(decision.priceBeforeTax);
  const direct = snapshot && Object.prototype.hasOwnProperty.call(snapshot, 'knownDirectCosts') ? recordedCents(snapshot.knownDirectCosts) : null;
  if (price === null) return unavailable('price_unavailable', 'The saved price cannot be compared. Review the scope and price again.');
  if (direct === null) return unavailable('costs_unavailable', 'Recorded direct costs are incomplete or unavailable. Confirm the missing costs before relying on this comparison.');
  const remaining = price - direct;
  result.state = remaining < 0n ? 'shortfall' : 'compared';
  result.priceBeforeTax = decision.priceBeforeTax;
  result.recordedDirectCosts = decimal(direct);
  result.remainingAfterDirectCosts = decimal(remaining);
  result.message = remaining < 0n ? 'The reviewed price is below the recorded direct costs.' : 'Compare the saved reviewed price with the costs recorded for this estimate.';
  return stableValue(result);
}
module.exports = { buildCapellaReview };
