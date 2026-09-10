'use strict';

// Read projection only: never calculate or persist a price/approval.
const { stableValue } = require('./businessProfileAdapter');
const COMPONENTS = [
  ['Calculated price before tax', 'customerFacingPrice'],
  ['Recorded tax', 'tax'], ['Calculated total including tax', 'totalIncludingTax'],
  ['Recorded material cost', 'knownDirectMaterialCost'],
  ['Recorded labor cost', 'knownInternalLaborCost'],
  ['Recorded equipment cost', 'knownEquipmentCost'],
  ['Recorded direct costs', 'knownDirectCosts'], ['Recorded overhead', 'overhead'],
];
function component(label, source, key) {
  const present = Boolean(source && Object.prototype.hasOwnProperty.call(source, key));
  const value = present ? source[key] : undefined;
  const finite = typeof value === 'number' && Number.isFinite(value);
  return { label, amount: finite ? value : null, sourceState: !present ? 'missing' : value === null ? 'unavailable' : finite ? 'recorded' : 'invalid' };
}
function buildEstimateReview(item, options = {}) {
  if (!item || !item.ids || !item.ids.estimate || !item.snapshot || !item.snapshotDigest ||
      !item.normalizedInputFingerprint || !item.businessProfileAuthorityId ||
      !item.businessProfileInputVersion || !item.businessProfileInputHash || !item.calculationVersion) {
    throw new Error('Estimate review source is incomplete');
  }
  const values = item.snapshot;
  const rows = COMPONENTS.map(([label, key]) => component(label, values, key));
  rows.push(component('Recorded travel cost', values.travel, 'knownInternalCost'));
  const missing = [];
  if (rows.some(row => row.amount === null)) missing.push('Some amounts are unavailable. Confirm the missing costs before quoting.');
  if (Array.isArray(values.notCalculated) && values.notCalculated.length) {
    missing.push('Review the job details for missing information and expenses this estimate does not cover.');
  }
  return stableValue({
    contract: 'NorthStarEstimateReview/v1', simulated: options.simulated === true,
    pins: { estimateId: item.ids.estimate, graphId: item.ids.graph, customerId: item.ids.customer,
      operationId: item.ids.operation, opportunityId: item.ids.opportunity,
      supportingFactIds: item.supportingTranscriptFactIds || [],
      snapshotId: item.ids.polarisSnapshot, snapshotDigest: item.snapshotDigest,
      calculationVersion: item.calculationVersion, normalizedInputFingerprint: item.normalizedInputFingerprint,
      businessProfileId: item.businessProfileAuthorityId, businessProfileVersion: item.businessProfileInputVersion,
      businessProfileHash: item.businessProfileInputHash },
    recordedAt: item.snapshotCreatedAt || null,
    currency: item.estimate && item.estimate.currency || null,
    approval: 'not_recorded_here',
    approvalMessage: 'Approval is not recorded here. A person needs to confirm the job and price before preparing a customer quote.',
    basisMessage: 'Calculated guidance from the information recorded at the time. These costs may not include every expense for the job.',
    rows, missing,
  });
}
module.exports = { buildEstimateReview };
