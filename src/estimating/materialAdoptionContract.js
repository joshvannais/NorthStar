'use strict';

const { stableValue, sha256 } = require('../services/businessProfileAdapter');
const material = require('./materialPlanContract');
const VERSION = 'estimate-material-adoption-v1';
const V2 = 'estimate-material-adoption-v2';
const V3 = 'estimate-material-adoption-v3';
const V4='estimate-material-adoption-v4';
const VERSIONS = Object.freeze([VERSION,V2,V3,V4]);
const BASE_VERSION = 'm19-part3-canonical-v2';
const MAX_CENTS = 99999999999999n;
const FIELDS = ['sourcePins', 'expectedPlanId', 'expectedPlanRevision', 'expectedPlanDigest',
  'expectedDecisionRevision', 'expectedDecisionDigest', 'reason', 'confirmed', 'confirmationVersion'];

function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status, code: 'ESTIMATE_ADOPTION_INVALID' });
}
function cents(value) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,11})\.[0-9]{2}$/.test(value)) return null;
  return BigInt(value.replace('.', ''));
}
function recordedCents(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  const text = String(value);
  if (!/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  return cents(whole + '.' + fraction.padEnd(2, '0'));
}
function decimal(value) {
  return value === null ? null : String(value / 100n) + '.' + String(value % 100n).padStart(2, '0');
}
function nonnegative(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }

// Deliberately retained, versioned cost-only calculation. Original customer pricing,
// tax and operational snapshots are never modified or recalculated here.
function calculate(item, plan, version=VERSION) {
  if (item?.calculationVersion !== BASE_VERSION || !item.snapshot ||
      !VERSIONS.includes(version) || !material.VERSIONS.includes(plan?.calculationVersion) || (VERSIONS.indexOf(version)<material.VERSIONS.indexOf(plan?.calculationVersion)) || plan.action !== 'save' ||
      plan.currency !== item.estimate?.currency || !['USD', 'CAD', 'EUR'].includes(plan.currency)) {
    fail('This estimate or material plan cannot be used for a new cost review.');
  }
  const result = material.calculate(plan.inputs, plan.currency, plan.calculationVersion);
  const original = item.snapshot;
  const laborValid = nonnegative(original.laborCharge);
  const equipmentValid = nonnegative(original.equipmentCharge);
  const distance = original.travel?.distanceMiles;
  const travelValid = distance === null || nonnegative(distance);
  const labor = recordedCents(original.knownInternalLaborCost);
  const equipment = recordedCents(original.knownEquipmentCost);
  const travel = recordedCents(original.travel?.knownInternalCost);
  const materialCents = cents(result.total);
  const required = [materialCents];
  if (laborValid && original.laborCharge > 0) required.push(labor);
  if (equipmentValid && original.equipmentCharge > 0) required.push(equipment);
  if (travelValid && distance !== null) required.push(travel);
  const complete = original.service?.supported === true && laborValid && equipmentValid &&
    travelValid && required.every(value => value !== null);
  const total = complete ? required.reduce((sum, value) => sum + value, 0n) : null;
  if (total !== null && total > MAX_CENTS) fail('The combined costs are too large. Review the material quantity and price.');
  return stableValue({ calculationVersion: version, currency: plan.currency,
    material: result, knownDirectMaterialCost: result.total,
    knownInternalLaborCost: decimal(labor), knownEquipmentCost: decimal(equipment),
    knownTravelInternalCost: decimal(travel), knownDirectCosts: decimal(total),
    overhead: null, grossProfit: null, netProfit: null,
    applicability: { material: true, labor: laborValid ? original.laborCharge > 0 : null,
      equipment: equipmentValid ? original.equipmentCharge > 0 : null,
      travel: travelValid ? distance !== null : null } });
}

function normalize(body) {
  if(body?.confirmationVersion==='estimate-cost-adoption-v1')return require('./costAdoptionContract').normalize(body);
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).length !== FIELDS.length || !FIELDS.every(key => Object.hasOwn(body, key)) ||
      !body.sourcePins || typeof body.sourcePins !== 'object' || Array.isArray(body.sourcePins) ||
      typeof body.expectedPlanId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.expectedPlanId) ||
      !Number.isSafeInteger(body.expectedPlanRevision) || body.expectedPlanRevision < 1 || body.expectedPlanRevision > 10000 ||
      typeof body.expectedPlanDigest !== 'string' || !/^[0-9a-f]{64}$/.test(body.expectedPlanDigest) ||
      !Number.isSafeInteger(body.expectedDecisionRevision) || body.expectedDecisionRevision < 0 || body.expectedDecisionRevision > 10000 ||
      typeof body.expectedDecisionDigest !== 'string' ||
      (body.expectedDecisionRevision === 0 ? body.expectedDecisionDigest !== 'none' : !/^[0-9a-f]{64}$/.test(body.expectedDecisionDigest)) ||
      body.confirmed !== true || !VERSIONS.includes(body.confirmationVersion) || typeof body.reason !== 'string' ||
      !body.reason.trim() || Array.from(body.reason.trim()).length > 2000 || /[\u0000-\u001f\u007f-\u009f]/.test(body.reason)) {
    fail('Review the material plan and confirm how it will change this estimate.');
  }
  return stableValue({ ...body, reason: body.reason.trim() });
}
function checkBasis(body, review, plan) {
  const basis = review.decisions?.writeBasis || material.decisionBasis(review.decisions?.current);
  if (!plan || plan.action !== 'save' || body.expectedPlanId !== plan.id ||
      body.expectedPlanRevision !== plan.revision || body.expectedPlanDigest !== plan.digest ||
      body.expectedDecisionRevision !== basis.revision || body.expectedDecisionDigest !== basis.digest ||
      sha256(body.sourcePins) !== sha256(review.pins) || sha256(plan.sourcePins) !== sha256(review.pins) ||
      plan.currency !== review.currency || review.isCurrent === false) {
    fail('The estimate, material plan or price review changed. Refresh and review the plan again.', 409);
  }
}
module.exports = { VERSION, V2, V3, V4, VERSIONS, BASE_VERSION, calculate, normalize, checkBasis, cents, recordedCents, decimal };
