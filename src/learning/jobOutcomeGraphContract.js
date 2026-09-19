'use strict';

const DIGEST = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOURCE = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const TOKEN = /^ref_[0-9a-f]{64}$/;
const PRINTABLE_REFERENCE = /^[!-~]{1,128}$/;
const CONSENT_KEYS = ['action','expectedRevision','expectedDigest','reason','confirmed','confirmationVersion'];
const GRAPH_KEYS = ['expectedConsentRevision','expectedConsentDigest','nodes','reason','confirmed','confirmationVersion'];
const NODE_KEYS = ['nodeKind','observationId','locator'];
const LOCATOR_KEYS = Object.freeze({
  native_labor: [],
  imported_labor: ['sourceKey'],
  imported_travel: ['sourceKey'],
  native_equipment: [],
  imported_asset: ['sourceKey'],
  native_material: ['executionId'],
  imported_material_quantity: ['sourceKey'],
  imported_material_cost: ['sourceKey'],
  external_customer: ['crmSourceKey','communicationSourceKey','crmEstimateReference','communicationEstimateReference'],
  external_project: ['sourceKey','projectReference'],
  external_financial: ['sourceKey'],
});

function fail() {
  throw Object.assign(new Error('Job outcome review details are invalid.'), {
    code: 'M25_JOB_OUTCOME_GRAPH_INPUT_INVALID', status: 400,
  });
}
function exact(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join('|') === [...keys].sort().join('|');
}
function text(value) {
  return typeof value === 'string' && value === value.trim() && value === value.normalize('NFC') &&
    value.length >= 1 && value.length <= 2000 && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}
function source(value) { return typeof value === 'string' && SOURCE.test(value); }
function reference(value) { return typeof value === 'string' && PRINTABLE_REFERENCE.test(value); }

function normalizeConsent(body) {
  if (!exact(body, CONSENT_KEYS) || !['grant','revoke'].includes(body.action) ||
      !Number.isInteger(body.expectedRevision) || body.expectedRevision < 0 || body.expectedRevision > 10000 ||
      !(body.expectedDigest === 'none' || DIGEST.test(String(body.expectedDigest || ''))) ||
      ((body.expectedRevision === 0) !== (body.expectedDigest === 'none')) || !text(body.reason) ||
      body.confirmed !== true || body.confirmationVersion !== 'm25-job-outcome-graph-consent-v1') fail();
  return Object.freeze({ ...body });
}

function normalizeLocator(kind, locator) {
  const keys = LOCATOR_KEYS[kind];
  if (!keys || !exact(locator, keys)) fail();
  if (keys.includes('sourceKey') && !source(locator.sourceKey)) fail();
  if (keys.includes('crmSourceKey') && !source(locator.crmSourceKey)) fail();
  if (keys.includes('communicationSourceKey') && !source(locator.communicationSourceKey)) fail();
  if (keys.includes('executionId') && !UUID.test(String(locator.executionId || ''))) fail();
  if (keys.includes('projectReference') && !reference(locator.projectReference)) fail();
  if (keys.includes('crmEstimateReference') && !reference(locator.crmEstimateReference)) fail();
  if (keys.includes('communicationEstimateReference') && !TOKEN.test(String(locator.communicationEstimateReference || ''))) fail();
  return Object.freeze({ ...locator });
}

function normalizeNode(value) {
  if (!exact(value, NODE_KEYS) || !Object.hasOwn(LOCATOR_KEYS, value.nodeKind) ||
      !UUID.test(String(value.observationId || ''))) fail();
  return Object.freeze({
    nodeKind: value.nodeKind,
    observationId: String(value.observationId).toLowerCase(),
    locator: normalizeLocator(value.nodeKind, value.locator),
  });
}

function normalizeGraph(estimateId, body) {
  if (!UUID.test(String(estimateId || '')) || !exact(body, GRAPH_KEYS) ||
      !Number.isInteger(body.expectedConsentRevision) || body.expectedConsentRevision < 1 || body.expectedConsentRevision > 10000 ||
      !DIGEST.test(String(body.expectedConsentDigest || '')) || !Array.isArray(body.nodes) ||
      body.nodes.length < 2 || body.nodes.length > 100 || !text(body.reason) || body.confirmed !== true ||
      body.confirmationVersion !== 'm25-job-outcome-graph-v1') fail();
  const nodes = body.nodes.map(normalizeNode).sort((left, right) => {
    const a = `${left.nodeKind}|${left.observationId}|${JSON.stringify(left.locator)}`;
    const b = `${right.nodeKind}|${right.observationId}|${JSON.stringify(right.locator)}`;
    return a.localeCompare(b);
  });
  const identities = new Set(nodes.map(node => `${node.nodeKind}:${node.observationId}`));
  if (identities.size !== nodes.length) fail();
  return Object.freeze({ estimateId: String(estimateId).toLowerCase(), ...body, nodes: Object.freeze(nodes) });
}

function normalizeRead(estimateId) {
  if (!UUID.test(String(estimateId || ''))) fail();
  return Object.freeze({ estimateId: String(estimateId).toLowerCase() });
}

module.exports = { LOCATOR_KEYS, normalizeConsent, normalizeGraph, normalizeRead };
