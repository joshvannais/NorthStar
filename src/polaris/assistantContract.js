'use strict';

const crypto = require('crypto');

const CONTEXT_REQUEST_SCHEMA = 'northstar.polaris.context-request.v1';
const MESSAGE_REQUEST_SCHEMA = 'northstar.polaris.message-request.v1';
const RESPONSE_SCHEMA = 'northstar.polaris.assistant-response.v1';
const CARD_SCHEMA = 'northstar.polaris.customer-intelligence-card.v1';
const STATUS_SCHEMA = 'northstar.polaris.assistant-status.v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SELECTIONS = Object.freeze({
  customer: Object.freeze({ idKey: 'customer', resource: 'leads' }),
  lead: Object.freeze({ idKey: 'opportunity', resource: 'leads' }),
  work: Object.freeze({ idKey: 'appointment', resource: 'calendar' }),
});
const PROVIDER_DECISIONS = Object.freeze([
  'credential_source',
  'current_official_documentation_review',
  'model',
  'budget_and_rate',
  'timeout_and_retry',
  'retention_and_logging',
  'user_facing_failure_policy',
]);

function contractError(code, message, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function exactKeys(value, keys, code, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw contractError(code, `${label} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const expected = keys.slice().sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw contractError(code, `${label} contains unsupported or missing fields.`);
  }
  return value;
}

function validateSelection(raw) {
  const selected = exactKeys(raw, ['id', 'kind'], 'POLARIS_SELECTION_INVALID', 'selected');
  if (!Object.prototype.hasOwnProperty.call(SELECTIONS, selected.kind) ||
      typeof selected.id !== 'string' || !UUID.test(selected.id)) {
    throw contractError('POLARIS_SELECTION_INVALID', 'selected must identify one exact customer, lead, or work UUID.');
  }
  return Object.freeze({ kind: selected.kind, id: selected.id.toLowerCase() });
}

function validateContextRequest(body) {
  const request = exactKeys(body, ['schemaVersion', 'selected'], 'POLARIS_CONTEXT_REQUEST_INVALID', 'request');
  if (request.schemaVersion !== CONTEXT_REQUEST_SCHEMA) {
    throw contractError('POLARIS_CONTEXT_SCHEMA_UNSUPPORTED', 'The selected-context request schema is unsupported.');
  }
  return Object.freeze({ schemaVersion: CONTEXT_REQUEST_SCHEMA, selected: validateSelection(request.selected) });
}

function validateMessageRequest(body) {
  const keys = body && Object.prototype.hasOwnProperty.call(body, 'selected')
    ? ['idempotencyKey', 'message', 'schemaVersion', 'selected']
    : ['idempotencyKey', 'message', 'schemaVersion'];
  const request = exactKeys(body, keys, 'POLARIS_MESSAGE_REQUEST_INVALID', 'request');
  if (request.schemaVersion !== MESSAGE_REQUEST_SCHEMA) {
    throw contractError('POLARIS_MESSAGE_SCHEMA_UNSUPPORTED', 'The assistant-message request schema is unsupported.');
  }
  if (typeof request.idempotencyKey !== 'string' || !UUID.test(request.idempotencyKey)) {
    throw contractError('POLARIS_IDEMPOTENCY_KEY_INVALID', 'idempotencyKey must be one UUID.');
  }
  if (typeof request.message !== 'string' || request.message !== request.message.trim() ||
      request.message.length < 1 || request.message.length > 4000 || /\u0000/.test(request.message)) {
    throw contractError('POLARIS_MESSAGE_INVALID', 'message must contain 1 to 4,000 bounded text characters.');
  }
  return Object.freeze({
    schemaVersion: MESSAGE_REQUEST_SCHEMA,
    idempotencyKey: request.idempotencyKey.toLowerCase(),
    message: request.message,
    selected: request.selected ? validateSelection(request.selected) : null,
  });
}

function boundedText(value, maximum = 500) {
  if (value === null || value === undefined) return null;
  let text;
  if (typeof value === 'string') text = value;
  else if (typeof value === 'number' || typeof value === 'boolean') text = String(value);
  else {
    try { text = JSON.stringify(value); } catch (_error) { text = null; }
  }
  if (!text) return null;
  return text.length > maximum ? `${text.slice(0, maximum - 1)}…` : text;
}

function humanize(value) {
  const text = boundedText(value, 100);
  if (!text) return 'Recorded fact';
  return text.replace(/[._-]+/g, ' ').replace(/\b\w/g, character => character.toUpperCase());
}

function evidenceProjection(item) {
  const facts = Array.isArray(item && item.facts) ? item.facts : [];
  return facts.filter(fact => fact && fact.id && fact.status !== 'rejected').slice(0, 12).map(fact => ({
    id: String(fact.id),
    label: humanize(fact.variable || fact.type || fact.field || fact.key),
    value: boundedText(fact.evidenceText || fact.normalizedValue, 500) || 'Recorded without displayable detail.',
    confidence: Number.isFinite(Number(fact.confidence))
      ? Math.max(0, Math.min(1, Number(fact.confidence))) : null,
    source: Object.freeze({ kind: 'canonical_fact', id: String(fact.id) }),
    untrustedText: true,
  }));
}

function unknownProjection(item) {
  const unknowns = [];
  const add = (code, label) => {
    if (!unknowns.some(entry => entry.code === code)) unknowns.push({ code, label });
  };
  if (!item || !item.customer || !boundedText(item.customer.name, 200)) add('customer_name_missing', 'Customer name is not recorded.');
  if (!item || !item.opportunity || !boundedText(item.opportunity.serviceType, 200)) add('service_type_missing', 'Service type is not recorded.');
  if (!item || !item.opportunity || !boundedText(item.opportunity.scope, 500)) add('work_scope_missing', 'Work scope is not recorded.');
  const customerPrice = item && item.estimate && item.estimate.customerPrice;
  if (customerPrice === null || customerPrice === undefined || customerPrice === '' ||
      !Number.isFinite(Number(customerPrice))) {
    add('customer_price_missing', 'Customer-facing estimate is not recorded.');
  }
  if (!item || !item.appointment || !item.appointment.scheduledStart) add('schedule_missing', 'A scheduled start is not recorded.');
  const notCalculated = Array.isArray(item && item.snapshot && item.snapshot.notCalculated)
    ? item.snapshot.notCalculated : [];
  for (const entry of notCalculated.slice(0, 12)) {
    const text = boundedText(entry, 300);
    if (text) add(`not_calculated_${unknowns.length + 1}`, text);
  }
  return unknowns.slice(0, 12);
}

function confidenceProjection(evidence) {
  const values = evidence.map(entry => entry.confidence).filter(value => Number.isFinite(value));
  if (!values.length) return Object.freeze({ value: null, level: 'unknown', basis: 'No bounded confidence values are recorded.' });
  const value = Math.round((values.reduce((sum, current) => sum + current, 0) / values.length) * 1000) / 1000;
  const level = value >= 0.8 ? 'high' : value >= 0.5 ? 'medium' : 'low';
  return Object.freeze({ value, level, basis: `${values.length} recorded canonical fact confidence value${values.length === 1 ? '' : 's'}.` });
}

function selectedMatchesItem(item, selected) {
  const definition = SELECTIONS[selected.kind];
  return Boolean(item && item.ids && item.ids[definition.idKey] === selected.id);
}

function buildCustomerIntelligenceCard(item, selected) {
  if (!selectedMatchesItem(item, selected)) {
    throw contractError('POLARIS_SELECTED_RECORD_NOT_FOUND', 'The selected record was not found in the current organization.', 404);
  }
  const evidence = evidenceProjection(item);
  const unknowns = unknownProjection(item);
  const customerName = boundedText(item.customer && item.customer.name, 200) || 'Customer';
  const serviceType = boundedText(item.opportunity && item.opportunity.serviceType, 200);
  const scope = boundedText(item.opportunity && item.opportunity.scope, 500);
  const answer = scope || (serviceType
    ? `${serviceType} is recorded, but the work scope is unknown.`
    : 'The selected record is available, but service and work-scope details are unknown.');
  return Object.freeze({
    schemaVersion: CARD_SCHEMA,
    kind: 'customer_intelligence',
    tone: 'purple',
    title: customerName,
    subtitle: serviceType || 'Service type unknown',
    answer,
    evidence,
    unknowns,
    confidence: confidenceProjection(evidence),
    authority: Object.freeze({
      selected: Object.freeze({ ...selected }),
      graphId: item.ids.graph,
      snapshotId: item.ids.polarisSnapshot,
      snapshotDigest: item.snapshotDigest,
      projectionDigest: item.projectionDigest,
      calculationVersion: item.calculationVersion,
      readModelVersion: item.readModelVersion,
    }),
    advisoryOnly: true,
    canonicalMutationAllowed: false,
  });
}

function responseId(requestId, card) {
  return crypto.createHash('sha256').update(JSON.stringify({ requestId, authority: card.authority })).digest('hex');
}

function buildContextResponse(item, selected, authority, requestId) {
  const card = buildCustomerIntelligenceCard(item, selected);
  return Object.freeze({
    schemaVersion: RESPONSE_SCHEMA,
    responseId: responseId(requestId, card),
    requestId,
    state: 'available',
    source: 'canonical_local',
    authority: Object.freeze({
      organizationId: authority.organizationId,
      userId: authority.userId,
      role: authority.role,
    }),
    selected: Object.freeze({ ...selected }),
    answer: Object.freeze({
      text: card.answer,
      evidenceCount: card.evidence.length,
      unknownCount: card.unknowns.length,
    }),
    cards: Object.freeze([card]),
    provider: Object.freeze({ state: 'unconfigured', requestsSent: 0 }),
    advisoryOnly: true,
    canonicalMutationAllowed: false,
  });
}

function unconfiguredStatus(requestId) {
  return Object.freeze({
    schemaVersion: STATUS_SCHEMA,
    requestId,
    state: 'unconfigured',
    label: 'Provider-backed conversation unavailable',
    localCustomerIntelligence: 'available',
    providerRequestsEnabled: false,
    providerRequestsSent: 0,
    decisionsRequired: PROVIDER_DECISIONS,
  });
}

module.exports = {
  CARD_SCHEMA,
  CONTEXT_REQUEST_SCHEMA,
  MESSAGE_REQUEST_SCHEMA,
  PROVIDER_DECISIONS,
  RESPONSE_SCHEMA,
  SELECTIONS,
  STATUS_SCHEMA,
  UUID,
  buildContextResponse,
  buildCustomerIntelligenceCard,
  contractError,
  selectedMatchesItem,
  unconfiguredStatus,
  validateContextRequest,
  validateMessageRequest,
};
