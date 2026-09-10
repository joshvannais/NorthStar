"use strict";
const { stableValue } = require('../services/businessProfileAdapter');
const VERSION = 'm19-part3-canonical-v2';
function buildMaterialReview(review, snapshot) {
  const present = Boolean(snapshot && Object.prototype.hasOwnProperty.call(snapshot, 'knownDirectMaterialCost'));
  const value = present ? snapshot.knownDirectMaterialCost : undefined;
  const text = typeof value === 'number' && Number.isFinite(value) && value >= 0 ? String(value) : '';
  const supportedCurrency = ['USD', 'CAD', 'EUR'].includes(review.currency);
  const valid = supportedCurrency && /^(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?$/.test(text);
  const parts = text.split('.');
  const raw = snapshot && snapshot.service && snapshot.service.scope && snapshot.service.scope.material;
  const material = typeof raw === 'string' && raw.trim().length > 0 && raw.trim().length <= 160 && !/[\u0000-\u001f\u007f]/.test(raw) ? raw.trim() : null;
  const basisKnown = review.pins.calculationVersion === VERSION && snapshot && snapshot.calculationVersion === VERSION;
  return stableValue({
    contract: 'NorthStarMaterialReview/v1', sourcePins: review.pins, recordedAt: review.recordedAt,
    currency: review.currency, simulated: review.simulated === true,
    material, materialState: material ? 'recorded' : raw == null || raw === '' ? 'unspecified' : 'unavailable',
    amount: valid ? parts[0] + '.' + (parts[1] || '').padEnd(2, '0') : null,
    amountState: !present ? 'missing' : value === null ? 'unavailable' : valid ? 'recorded' : 'invalid',
    basis: basisKnown ? 'recorded_configured_amount' : 'unavailable',
    quantity: 'not_recorded', unit: 'not_recorded', waste: 'not_recorded', availability: 'not_verified', priceEffectiveDate: 'not_recorded',
  });
}
module.exports = { buildMaterialReview };
