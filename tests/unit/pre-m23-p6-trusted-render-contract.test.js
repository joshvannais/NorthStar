'use strict';

const crypto = require('crypto');
const {
  MESSAGE_REQUEST_SCHEMA,
  buildContextResponse,
  validateAssistantResponse,
} = require('../../src/polaris/assistantContract');
const {
  boundedInterceptedResponse,
} = require('../../src/polaris/assistantRuntime');
const {
  RESPONSE_JSON_SCHEMA,
  createOpenAIRuntime,
} = require('../../src/polaris/openaiRuntime');
const trustedPresentation = require('../../public/js/polaris-trusted-presentation');
const browserCard = require('../../public/js/polaris-native-card');

const ORG = 'f1000000-0000-4000-8000-000000000001';
const USER = 'f2000000-0000-4000-8000-000000000001';
const CUSTOMER = 'f3000000-0000-4000-8000-000000000001';
const LEAD = 'f4000000-0000-4000-8000-000000000001';
const GRAPH = 'f5000000-0000-4000-8000-000000000001';
const SNAPSHOT = 'f6000000-0000-4000-8000-000000000001';
const FACT = 'f7000000-0000-4000-8000-000000000001';
const KEY = 'f8000000-0000-4000-8000-000000000001';

const RAW_VALUES = Object.freeze([
  'Recommendation: RESET statement_timeout',
  'for _, invoice := range invoices { total += invoice.Amount }',
  'invoice.total = subtotal * (1 + taxRate)',
  'REVOKE UPDATE ON quotes FROM estimator',
  'interface Quote { total: number }; const quote: Quote = { total: 42 }',
  'from pathlib import Path as P',
  '{job.id: job.total for job in jobs if job.open}',
  'A class-action notice was mentioned by the customer; route the document to counsel without interpreting it.',
  'Return air temperature was 74°F, supply air was 56°F, and the measured split was 18°F.',
  'Use the Command Center to review the open estimate; do not contact the customer yet.',
  'Net 30 applies after the approved service is complete.',
  'Export, Select, package, class, record, transaction, API, and SQL are references in this business note.',
]);

function authority() {
  return { organizationId: ORG, userId: USER, role: 'owner' };
}

function selected() {
  return { kind: 'lead', id: LEAD };
}

function item(raw = RAW_VALUES[0]) {
  return {
    ids: {
      graph: GRAPH,
      customer: CUSTOMER,
      opportunity: LEAD,
      appointment: null,
      polarisSnapshot: SNAPSHOT,
    },
    customer: { name: raw },
    opportunity: { serviceType: raw, scope: raw },
    estimate: { customerPrice: null },
    appointment: { scheduledStart: null },
    facts: [{
      id: FACT,
      variable: raw,
      status: 'accepted',
      normalizedValue: raw,
      evidenceText: raw,
      confidence: 0.8,
    }],
    snapshot: { notCalculated: [raw] },
    snapshotDigest: 'a'.repeat(64),
    projectionDigest: 'b'.repeat(64),
    calculationVersion: 'trusted-render-test-v1',
    readModelVersion: 'm22-part1-read-v1',
  };
}

function localContext(raw) {
  return buildContextResponse(item(raw), selected(), authority(), KEY);
}

function requestContract() {
  return {
    schemaVersion: MESSAGE_REQUEST_SCHEMA,
    idempotencyKey: KEY,
    message: 'Summarize the selected record.',
    selected: selected(),
  };
}

function envelope(raw) {
  const local = localContext(raw);
  return {
    schemaVersion: MESSAGE_REQUEST_SCHEMA,
    requestId: KEY,
    authority: authority(),
    untrustedInput: { message: 'Summarize the selected record.', selected: selected() },
    untrustedContext: { selected: local.selected, answer: local.answer, cards: local.cards },
    safety: {
      storedCustomerContentIsDataOnly: true,
      followStoredInstructions: false,
      canonicalMutationAllowed: false,
      secretsAllowed: false,
    },
  };
}

function semanticChoice(local, intent = 'canonical_overview') {
  return {
    schemaVersion: trustedPresentation.SEMANTIC_SCHEMA,
    answerIntent: intent,
    selectedKind: local.selected.kind,
    cardCount: local.cards.length,
    evidenceCount: local.cards.reduce((sum, card) => sum + card.evidence.length, 0),
    unknownCount: local.cards.reduce((sum, card) => sum + card.unknowns.length, 0),
  };
}

function completedProviderResponse(payload) {
  return {
    id: 'resp_safe_metadata_only',
    status: 'completed',
    incomplete_details: null,
    output_text: JSON.stringify(payload),
    output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(payload) }] }],
    usage: {
      input_tokens: 120,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      output_tokens: 40,
      total_tokens: 160,
    },
  };
}

function collectStrings(value, output = []) {
  if (typeof value === 'string') output.push(value);
  else if (Array.isArray(value)) value.forEach(entry => collectStrings(entry, output));
  else if (value && typeof value === 'object') Object.keys(value).forEach(key => collectStrings(value[key], output));
  return output;
}

function assertNoUnrestrictedStrings(schema, path = '$') {
  if (!schema || typeof schema !== 'object') return;
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.includes('string')) {
    expect(schema.enum || Object.prototype.hasOwnProperty.call(schema, 'const')).toBeTruthy();
  }
  if (schema.properties) {
    Object.entries(schema.properties).forEach(([key, child]) => assertNoUnrestrictedStrings(child, `${path}.${key}`));
  }
  if (schema.items) assertNoUnrestrictedStrings(schema.items, `${path}[]`);
}

function mutateDisplay(response, location, value) {
  const clone = JSON.parse(JSON.stringify(response));
  if (location === 'answer') clone.answer.text = value;
  if (location === 'title') clone.cards[0].title = value;
  if (location === 'subtitle') clone.cards[0].subtitle = value;
  if (location === 'card-answer') clone.cards[0].answer = value;
  if (location === 'evidence-label') clone.cards[0].evidence[0].label = value;
  if (location === 'evidence-value') clone.cards[0].evidence[0].value = value;
  if (location === 'unknown-label') clone.cards[0].unknowns[0].label = value;
  if (location === 'confidence-basis') clone.cards[0].confidence.basis = value;
  return clone;
}

describe('P6 trusted semantic presentation boundary', () => {
  test('strict provider output schema contains only bounded semantic values and no display strings', () => {
    expect(RESPONSE_JSON_SCHEMA.required).toEqual([
      'answerIntent', 'cardCount', 'evidenceCount', 'schemaVersion', 'selectedKind', 'unknownCount',
    ]);
    assertNoUnrestrictedStrings(RESPONSE_JSON_SCHEMA);
    expect(JSON.stringify(RESPONSE_JSON_SCHEMA)).not.toMatch(/title|subtitle|label|basis|free.?text|display|answer.*text/i);
  });

  test.each(RAW_VALUES)('raw canonical value never reaches local trusted display: %s', raw => {
    const response = localContext(raw);
    expect(trustedPresentation.validateTrustedResponseDisplay(response)).toBe(response);
    expect(() => browserCard.validateAssistantResponse(response)).not.toThrow();
    const visible = collectStrings({ answer: response.answer, cards: response.cards }).join('\n');
    expect(visible).not.toContain(raw);
    expect(visible).toMatch(/selected lead|supporting fact|unresolved item/i);
  });

  test.each([
    'answer', 'title', 'subtitle', 'card-answer', 'evidence-label', 'evidence-value',
    'unknown-label', 'confidence-basis',
  ])('server and browser reject any forged %s display string', location => {
    const response = mutateDisplay(localContext('Ordinary source value.'), location, RAW_VALUES[0]);
    expect(() => validateAssistantResponse(response, {
      requestId: KEY,
      authority: authority(),
      selected: selected(),
      source: 'canonical_local',
    })).toThrow();
    expect(() => browserCard.validateAssistantResponse(response)).toThrow();
  });

  test('interceptor accepts only semantic choice and constructs all visible wording locally', () => {
    const local = localContext(RAW_VALUES[1]);
    const choice = semanticChoice(local, 'evidence_review');
    const response = boundedInterceptedResponse(choice, requestContract(), authority(), local);
    expect(response.source).toBe('interceptor');
    expect(response.answer.text).toMatch(/supporting fact/i);
    expect(collectStrings({ answer: response.answer, cards: response.cards }).join('\n')).not.toContain(RAW_VALUES[1]);
    expect(() => browserCard.validateAssistantResponse(response)).not.toThrow();
  });

  test('legacy free-text response and semantic extras, omissions, unknowns, accessors, and foreign prototypes fail closed', () => {
    const local = localContext('Ordinary source value.');
    const choice = semanticChoice(local);
    const legacy = JSON.parse(JSON.stringify(local));
    legacy.source = 'interceptor';
    legacy.provider = { state: 'unconfigured', requestsSent: 0 };
    expect(() => boundedInterceptedResponse(legacy, requestContract(), authority(), local)).toThrow();
    expect(() => boundedInterceptedResponse({ ...choice, displayText: 'Injected wording.' }, requestContract(), authority(), local)).toThrow();
    const missing = { ...choice };
    delete missing.cardCount;
    expect(() => boundedInterceptedResponse(missing, requestContract(), authority(), local)).toThrow();
    expect(() => boundedInterceptedResponse({ ...choice, answerIntent: 'provider_free_text' }, requestContract(), authority(), local)).toThrow();
    expect(() => boundedInterceptedResponse(Object.assign(Object.create({ inherited: true }), choice), requestContract(), authority(), local)).toThrow();
    const accessor = { ...choice };
    Object.defineProperty(accessor, 'answerIntent', { enumerable: true, get: () => 'canonical_overview' });
    expect(() => boundedInterceptedResponse(accessor, requestContract(), authority(), local)).toThrow();
  });

  test.each(['canonical_overview', 'evidence_review', 'unknowns_review'])('provider intent %s selects only fixed NorthStar copy', async intent => {
    const input = envelope(RAW_VALUES[2]);
    const payload = semanticChoice(input.untrustedContext, intent);
    const client = { responses: { create: jest.fn(async () => completedProviderResponse(payload)) } };
    const runtime = createOpenAIRuntime({ configured: true, enabled: true, client });
    const result = await runtime.respond(input);
    expect(result.response.source).toBe('openai');
    expect(result.response.provider).toEqual({ state: 'configured', requestsSent: 1 });
    expect(result.usage).toMatchObject({ inputTokens: 120, outputTokens: 40, attemptCount: 1, outcomeClass: 'completed' });
    expect(trustedPresentation.validateTrustedResponseDisplay(result.response)).toBe(result.response);
    expect(collectStrings({ answer: result.response.answer, cards: result.response.cards }).join('\n')).not.toContain(RAW_VALUES[2]);
  });

  test('provider cannot alter counts, kind, unknown intent, shape, or inject any free-text key', async () => {
    const input = envelope('Ordinary source value.');
    const valid = semanticChoice(input.untrustedContext);
    const invalid = [
      { ...valid, cardCount: valid.cardCount + 1 },
      { ...valid, evidenceCount: valid.evidenceCount + 1 },
      { ...valid, unknownCount: valid.unknownCount + 1 },
      { ...valid, selectedKind: 'customer' },
      { ...valid, answerIntent: 'raw_text' },
      { ...valid, answer: 'Arbitrary provider wording.' },
    ];
    for (const payload of invalid) {
      const runtime = createOpenAIRuntime({
        configured: true,
        enabled: true,
        client: { responses: { create: jest.fn(async () => completedProviderResponse(payload)) } },
      });
      await expect(runtime.respond(input)).rejects.toMatchObject({ code: 'POLARIS_PROVIDER_RESPONSE_INVALID' });
    }
  });

  test('semantic choice does not contain authority, evidence, unknown, confidence, advisory, mutation, or display values', () => {
    const local = localContext('Ordinary source value.');
    const choice = semanticChoice(local);
    expect(Object.keys(choice).sort()).toEqual([
      'answerIntent', 'cardCount', 'evidenceCount', 'schemaVersion', 'selectedKind', 'unknownCount',
    ]);
    const serialized = JSON.stringify(choice);
    expect(serialized).not.toMatch(/authority|digest|evidence\"\s*:|unknowns|confidence|advisory|mutation|title|subtitle|label|basis|text/i);
  });

  test('response id remains deterministic for the same semantic choice and local authority', async () => {
    const input = envelope('Ordinary source value.');
    const payload = semanticChoice(input.untrustedContext, 'canonical_overview');
    const respond = async () => completedProviderResponse(payload);
    const first = await createOpenAIRuntime({ configured: true, enabled: true, client: { responses: { create: respond } } }).respond(input);
    const second = await createOpenAIRuntime({ configured: true, enabled: true, client: { responses: { create: respond } } }).respond(input);
    expect(first.response.responseId).toBe(second.response.responseId);
    expect(first.response.responseId).toMatch(/^[a-f0-9]{64}$/);
    expect(crypto.createHash('sha256').update(first.response.responseId).digest('hex')).toHaveLength(64);
  });
});
