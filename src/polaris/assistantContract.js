'use strict';

const crypto = require('crypto');

const CONTEXT_REQUEST_SCHEMA = 'northstar.polaris.context-request.v1';
const MESSAGE_REQUEST_SCHEMA = 'northstar.polaris.message-request.v1';
const RESPONSE_SCHEMA = 'northstar.polaris.assistant-response.v1';
const CARD_SCHEMA = 'northstar.polaris.customer-intelligence-card.v1';
const STATUS_SCHEMA = 'northstar.polaris.assistant-status.v1';
const MESSAGE_OPERATION = 'polaris_message_v1';
const MAX_STATUS_LABEL = 160;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/i;
const UNKNOWN_CODE = /^[a-z0-9_]{1,100}$/;
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
  const prototype = value && typeof value === 'object' ? Object.getPrototypeOf(value) : null;
  if (!value || typeof value !== 'object' || Array.isArray(value) || prototype !== Object.prototype) {
    throw contractError(code, `${label} must be an object.`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some(key => typeof key !== 'string')) {
    throw contractError(code, `${label} contains unsupported or missing fields.`);
  }
  const actual = ownKeys.sort();
  const expected = keys.slice().sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw contractError(code, `${label} contains unsupported or missing fields.`);
  }
  if (actual.some(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return !descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value') || descriptor.enumerable !== true;
  })) {
    throw contractError(code, `${label} contains unsupported fields.`);
  }
  return value;
}

function exactArray(value, maximum, code, label) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) {
    throw contractError(code, `${label} must be a bounded array.`);
  }
  const actual = Reflect.ownKeys(value);
  const expected = ['length', ...Array.from({ length: value.length }, (_unused, index) => String(index))];
  if (actual.some(key => typeof key !== 'string') || actual.length !== expected.length ||
      expected.some(key => !actual.includes(key)) || expected.slice(1).some(key => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return !descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value') || descriptor.enumerable !== true;
      })) {
    throw contractError(code, `${label} must be an exact bounded array.`);
  }
  return value;
}

function textWithin(value, minimum, maximum) {
  return typeof value === 'string' && value.length >= minimum && value.length <= maximum && !/\u0000/.test(value);
}

function uuidWithin(value) {
  return typeof value === 'string' && UUID.test(value);
}

function sameSelection(left, right) {
  if (!left || !right) return left === right;
  return left.kind === right.kind && left.id === right.id;
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

function validateEvidence(raw, code, label) {
  const evidence = exactKeys(raw, ['confidence', 'id', 'label', 'source', 'untrustedText', 'value'], code, label);
  const source = exactKeys(evidence.source, ['id', 'kind'], code, `${label}.source`);
  if (!textWithin(evidence.id, 1, 128) || !textWithin(evidence.label, 1, 100) ||
      !textWithin(evidence.value, 1, 2000) ||
      !(evidence.confidence === null || (typeof evidence.confidence === 'number' &&
        Number.isFinite(evidence.confidence) && evidence.confidence >= 0 && evidence.confidence <= 1)) ||
      evidence.untrustedText !== true || source.kind !== 'canonical_fact' || !textWithin(source.id, 1, 128)) {
    throw contractError(code, `${label} is invalid.`);
  }
  return evidence;
}

function validateUnknown(raw, code, label) {
  const unknown = exactKeys(raw, ['code', 'label'], code, label);
  if (typeof unknown.code !== 'string' || !UNKNOWN_CODE.test(unknown.code) || !textWithin(unknown.label, 1, 500)) {
    throw contractError(code, `${label} is invalid.`);
  }
  return unknown;
}

function validateConfidence(raw, code, label) {
  const confidence = exactKeys(raw, ['basis', 'level', 'value'], code, label);
  if (!(confidence.value === null || (typeof confidence.value === 'number' && Number.isFinite(confidence.value) &&
      confidence.value >= 0 && confidence.value <= 1)) ||
      !['unknown', 'low', 'medium', 'high'].includes(confidence.level) || !textWithin(confidence.basis, 1, 500) ||
      (confidence.value === null && confidence.level !== 'unknown')) {
    throw contractError(code, `${label} is invalid.`);
  }
  return confidence;
}

function validateCardAuthority(raw, expectedSelected, code, label) {
  const authority = exactKeys(raw, [
    'calculationVersion', 'graphId', 'projectionDigest', 'readModelVersion', 'selected',
    'snapshotDigest', 'snapshotId',
  ], code, label);
  const selected = validateSelection(authority.selected);
  if (!uuidWithin(authority.graphId) || !uuidWithin(authority.snapshotId) ||
      typeof authority.snapshotDigest !== 'string' || !DIGEST.test(authority.snapshotDigest) ||
      typeof authority.projectionDigest !== 'string' || !DIGEST.test(authority.projectionDigest) ||
      !textWithin(authority.calculationVersion, 1, 128) || !textWithin(authority.readModelVersion, 1, 128) ||
      (expectedSelected && !sameSelection(selected, expectedSelected))) {
    throw contractError(code, `${label} is invalid.`);
  }
  return authority;
}

function validateCustomerIntelligenceCard(raw, options = {}) {
  const code = options.code || 'POLARIS_INTERCEPTED_RESPONSE_INVALID';
  const label = options.label || 'card';
  const card = exactKeys(raw, [
    'advisoryOnly', 'answer', 'authority', 'canonicalMutationAllowed', 'confidence', 'evidence',
    'kind', 'schemaVersion', 'subtitle', 'title', 'tone', 'unknowns',
  ], code, label);
  if (card.schemaVersion !== CARD_SCHEMA || card.kind !== 'customer_intelligence' || card.tone !== 'purple' ||
      !textWithin(card.title, 1, 200) || !textWithin(card.subtitle, 1, 200) || !textWithin(card.answer, 1, 2000) ||
      card.advisoryOnly !== true || card.canonicalMutationAllowed !== false) {
    throw contractError(code, `${label} is invalid.`);
  }
  exactArray(card.evidence, 12, code, `${label}.evidence`).forEach((entry, index) =>
    validateEvidence(entry, code, `${label}.evidence[${index}]`));
  exactArray(card.unknowns, 12, code, `${label}.unknowns`).forEach((entry, index) =>
    validateUnknown(entry, code, `${label}.unknowns[${index}]`));
  validateConfidence(card.confidence, code, `${label}.confidence`);
  validateCardAuthority(card.authority, options.selected || null, code, `${label}.authority`);
  return card;
}

function validateResponseAuthority(raw, code) {
  const authority = exactKeys(raw, ['organizationId', 'role', 'userId'], code, 'response.authority');
  if (!uuidWithin(authority.organizationId) || !uuidWithin(authority.userId) || !textWithin(authority.role, 1, 64)) {
    throw contractError(code, 'response.authority is invalid.');
  }
  return authority;
}

function validateAssistantResponse(raw, expected = {}) {
  const code = 'POLARIS_INTERCEPTED_RESPONSE_INVALID';
  const response = exactKeys(raw, [
    'advisoryOnly', 'answer', 'authority', 'canonicalMutationAllowed', 'cards', 'provider',
    'requestId', 'responseId', 'schemaVersion', 'selected', 'source', 'state',
  ], code, 'response');
  const authority = validateResponseAuthority(response.authority, code);
  const selected = response.selected === null ? null : validateSelection(response.selected);
  const answer = exactKeys(response.answer, ['evidenceCount', 'text', 'unknownCount'], code, 'response.answer');
  const provider = exactKeys(response.provider, ['requestsSent', 'state'], code, 'response.provider');
  const cards = exactArray(response.cards, 4, code, 'response.cards');
  if (response.schemaVersion !== RESPONSE_SCHEMA || !textWithin(response.requestId, 1, 128) ||
      !textWithin(response.responseId, 1, 128) || response.state !== 'available' ||
      !['canonical_local', 'interceptor'].includes(response.source) || !textWithin(answer.text, 1, 8000) ||
      !Number.isSafeInteger(answer.evidenceCount) || answer.evidenceCount < 0 || answer.evidenceCount > 48 ||
      !Number.isSafeInteger(answer.unknownCount) || answer.unknownCount < 0 || answer.unknownCount > 48 ||
      provider.state !== 'unconfigured' || provider.requestsSent !== 0 ||
      response.advisoryOnly !== true || response.canonicalMutationAllowed !== false ||
      (expected.requestId && response.requestId !== expected.requestId) ||
      (expected.source && response.source !== expected.source) ||
      (Object.prototype.hasOwnProperty.call(expected, 'selected') && !sameSelection(selected, expected.selected)) ||
      (expected.authority && (authority.organizationId !== expected.authority.organizationId ||
        authority.userId !== expected.authority.userId || authority.role !== expected.authority.role))) {
    throw contractError(code, 'Intercepted runtime returned an invalid assistant response.', 502);
  }
  if (!selected && cards.length) {
    throw contractError(code, 'A customer-intelligence card requires one exact selected record.', 502);
  }
  cards.forEach((card, index) => validateCustomerIntelligenceCard(card, {
    code, label: `response.cards[${index}]`, selected,
  }));
  const evidenceCount = cards.reduce((sum, card) => sum + card.evidence.length, 0);
  const unknownCount = cards.reduce((sum, card) => sum + card.unknowns.length, 0);
  if (answer.evidenceCount !== evidenceCount || answer.unknownCount !== unknownCount) {
    throw contractError(code, 'Assistant response counts do not match the bounded cards.', 502);
  }
  return response;
}

function validateRuntimeStatusInput(raw) {
  const code = 'POLARIS_RUNTIME_STATUS_INVALID';
  const keys = raw && Object.prototype.hasOwnProperty.call(raw, 'label') ? ['label', 'state'] : ['state'];
  const status = exactKeys(raw, keys, code, 'intercepted status');
  if (!['local', 'unconfigured', 'error', 'available'].includes(status.state) ||
      (Object.prototype.hasOwnProperty.call(status, 'label') && !textWithin(status.label, 1, MAX_STATUS_LABEL))) {
    throw contractError(code, 'Intercepted runtime returned an invalid status.', 502);
  }
  return status;
}

function validateAssistantStatus(raw) {
  const code = 'POLARIS_RUNTIME_STATUS_INVALID';
  const keys = raw && Object.prototype.hasOwnProperty.call(raw, 'intercepted')
    ? ['decisionsRequired', 'intercepted', 'label', 'localCustomerIntelligence', 'providerRequestsEnabled',
      'providerRequestsSent', 'requestId', 'schemaVersion', 'state']
    : ['decisionsRequired', 'label', 'localCustomerIntelligence', 'providerRequestsEnabled',
      'providerRequestsSent', 'requestId', 'schemaVersion', 'state'];
  const status = exactKeys(raw, keys, code, 'assistant status');
  const decisions = exactArray(status.decisionsRequired, PROVIDER_DECISIONS.length, code, 'assistant status decisions');
  if (status.schemaVersion !== STATUS_SCHEMA || !textWithin(status.requestId, 1, 128) ||
      !['local', 'unconfigured', 'error', 'available'].includes(status.state) ||
      !textWithin(status.label, 1, MAX_STATUS_LABEL) || status.localCustomerIntelligence !== 'available' ||
      status.providerRequestsEnabled !== false || status.providerRequestsSent !== 0 ||
      decisions.length !== PROVIDER_DECISIONS.length || decisions.some((value, index) => value !== PROVIDER_DECISIONS[index]) ||
      (Object.prototype.hasOwnProperty.call(status, 'intercepted') && status.intercepted !== true)) {
    throw contractError(code, 'Assistant status is invalid.', 502);
  }
  return status;
}

function messageRequestFingerprint(request, authority) {
  const selected = request.selected ? { id: request.selected.id.toLowerCase(), kind: request.selected.kind } : null;
  return crypto.createHash('sha256').update(JSON.stringify({
    operation: MESSAGE_OPERATION,
    organizationId: authority.organizationId.toLowerCase(),
    userId: authority.userId.toLowerCase(),
    role: authority.role,
    schemaVersion: request.schemaVersion,
    message: request.message,
    selected,
  })).digest('hex');
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
  const response = Object.freeze({
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
  validateAssistantResponse(response, { requestId, authority, selected, source: 'canonical_local' });
  return response;
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
  MAX_STATUS_LABEL,
  MESSAGE_OPERATION,
  MESSAGE_REQUEST_SCHEMA,
  PROVIDER_DECISIONS,
  RESPONSE_SCHEMA,
  SELECTIONS,
  STATUS_SCHEMA,
  UUID,
  buildContextResponse,
  buildCustomerIntelligenceCard,
  contractError,
  messageRequestFingerprint,
  selectedMatchesItem,
  unconfiguredStatus,
  validateAssistantResponse,
  validateAssistantStatus,
  validateContextRequest,
  validateCustomerIntelligenceCard,
  validateMessageRequest,
  validateRuntimeStatusInput,
};
