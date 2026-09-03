'use strict';

const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const vm = require('vm');
const {
  MESSAGE_REQUEST_SCHEMA,
  RESPONSE_SCHEMA,
  buildContextResponse,
  messageRequestFingerprint,
} = require('../../src/polaris/assistantContract');
const { createIdempotencyRegistry } = require('../../src/polaris/assistantRuntime');
const { createOpenAIRuntime } = require('../../src/polaris/openaiRuntime');
const { createCanonicalRouter } = require('../../src/routes/canonicalPolaris');
const cardRenderer = require('../../public/js/polaris-native-card');
const trustedPresentation = require('../../public/js/polaris-trusted-presentation');

const ORG = 'e1000000-0000-4000-8000-000000000001';
const USER = 'e2000000-0000-4000-8000-000000000001';
const CUSTOMER = 'e3000000-0000-4000-8000-000000000001';
const LEAD = 'e4000000-0000-4000-8000-000000000001';
const GRAPH = 'e6000000-0000-4000-8000-000000000001';
const SNAPSHOT = 'e7000000-0000-4000-8000-000000000001';
const FACT = 'e8000000-0000-4000-8000-000000000001';
const KEY = 'e9000000-0000-4000-8000-000000000001';
const DIGEST = 'abcdef0123456789'.repeat(4);

const PROHIBITED_PRESENTATION = Object.freeze([
  ['internal error code', 'POLARIS_PROVIDER_RESPONSE_INVALID'],
  ['provider response identifier', 'resp_opaque_internal_123'],
  ['internal contract identifier', 'northstar.polaris.assistant-response.v1'],
  ['raw JSON', '{"schemaVersion":"northstar.polaris.assistant-response.v1","cards":[]}'],
  ['JSON Schema text', 'json_schema additionalProperties "required": ["answer"]'],
  ['code fence', '```js throw new Error("private"); ```'],
  ['unfenced HTML script', '<script>doWork()</script>'],
  ['unfenced event-handler markup', '<img src="x" onerror="doWork()">'],
  ['unfenced XML', '<?xml version="1.0"?><quote total="500" />'],
  ['unfenced doctype markup', '<!DOCTYPE html><html><body>Private</body></html>'],
  ['unfenced markup mixed with prose', 'Recommended next step: <section class="internal">doWork()</section>'],
  ['whitespace-separated markup', '< script >doWork()</ script >'],
  ['entity-escaped markup', '&lt;script&gt;doWork()&lt;/script&gt;'],
  ['unfenced JavaScript DOM call', 'document.body.remove();'],
  ['unfenced JavaScript global call', 'console.log("customer");'],
  ['unfenced JavaScript bare call', 'alert("private")'],
  ['unfenced JavaScript request', 'fetch("/api/customers").then(render);'],
  ['unfenced JavaScript control flow', 'if (ready) { approve(); }'],
  ['unfenced JavaScript class', 'class Estimate { total() { return 500; } }'],
  ['unfenced SQL select', 'SELECT customer_id FROM customers WHERE active = true;'],
  ['unfenced SQL select with case and whitespace', 'sElEcT\nemail\nFrOm users\nWhErE active = 1;'],
  ['unfenced SQL insert', 'INSERT INTO customers (email) VALUES ("private@example.invalid");'],
  ['unfenced SQL update', 'UPDATE customers SET active = false WHERE customer_id = 7;'],
  ['unfenced SQL delete', 'DELETE FROM customers WHERE active = false;'],
  ['unfenced SQL schema command', 'DROP TABLE customers;'],
  ['unfenced SQL common-table expression', 'WITH active AS (SELECT id FROM customers) SELECT id FROM active;'],
  ['unfenced SQL scalar query', 'SELECT 1;'],
  ['unfenced curl command', 'curl https://example.invalid/api'],
  ['prose-prefixed curl command', 'Use curl https://example.invalid/private'],
  ['unfenced wget command', 'wget -q https://example.invalid/private'],
  ['unfenced PowerShell command', 'PowerShell -Command "Get-ChildItem Env:"'],
  ['unfenced PowerShell cmdlet', 'Invoke-WebRequest -Uri https://example.invalid/private'],
  ['unfenced cmd command', 'cmd.exe /c dir C:\\private'],
  ['unfenced shell command', "bash -c 'rm -rf /tmp/private'"],
  ['unfenced direct shell delete', 'rm -rf /tmp/private'],
  ['unfenced shell listing', 'ls -la /tmp/private'],
  ['unfenced shell file read', 'cat /etc/passwd'],
  ['unfenced shell redirect', 'echo private > output.txt'],
  ['unfenced privileged service command', 'sudo systemctl restart northstar'],
  ['unfenced container command', 'docker run --rm hidden-image'],
  ['unfenced cluster command', 'kubectl get pods'],
  ['unfenced secure-shell command', 'ssh owner@example.invalid'],
  ['unfenced interpreter invocation', 'python private_script.py'],
  ['unfenced runtime invocation', 'node private_server.js'],
  ['unfenced permission command', 'chmod 600 private.txt'],
  ['unfenced PowerShell output cmdlet', 'Write-Output "private"'],
  ['unfenced package command', 'npm install hidden-package'],
  ['prose-prefixed package command', 'Run npm install hidden-package'],
  ['unfenced git command', 'git reset --hard HEAD~1'],
  ['prose-prefixed git command', 'Please run git reset --hard HEAD~1'],
  ['unfenced Python function', 'def calculate_total(price, quantity):\n    return price * quantity'],
  ['inline Python function', 'Here is code: def calculate_total(price): return price'],
  ['unfenced Python import and call', 'import os\nprint(os.environ)'],
  ['unfenced CSS rule', '.estimate-card { display: none; }'],
  ['unfenced CSS at-rule', '@media (max-width: 600px) { body { display: none; } }'],
  ['unfenced C source', '#include <stdio.h>\nint main(void) { return 0; }'],
  ['provider HTTP body and header', 'HTTP/1.1 429 Too Many Requests\nx-request-id: req_hidden_123'],
  ['Python stack trace', 'Traceback (most recent call last):\n  File "private.py", line 1, in <module>'],
  ['fullwidth markup obfuscation', '＜script＞doWork()＜／script＞'],
  ['zero-width JavaScript obfuscation', 'docu\u200bment.body.remove();'],
  ['zero-width shell obfuscation', 'cu\u200brl https://example.invalid/private'],
  ['inline code span', '`private_code`'],
  ['mixed prose and SQL', 'The estimate is ready. SELECT total FROM invoices WHERE paid = false;'],
  ['mixed prose and shell', 'Recommended action: curl -H "Authorization: private" https://example.invalid/api'],
  ['stack trace', 'TypeError: private failure\n    at internal.js:1:2'],
  ['UUID', '123e4567-e89b-42d3-a456-426614174000'],
  ['digest', DIGEST],
]);

const ORDINARY_PRESENTATION = Object.freeze([
  'Family-owned HVAC service with a 64-point seasonal inspection.',
  'Reference 123e4567-e89b-42d3-a456-42661417400 is not a UUID.',
  `Lot ${'a'.repeat(63)} has 63 characters.`,
  `Lot ${'b'.repeat(65)} has 65 characters.`,
  'The customer asked for a JSON-formatted controller export after the visit.',
  'Request ID details remain in the private office record.',
  'Use the additional properties listed in the signed estimate.',
  'The error-free installation includes a written workmanship review.',
  'Select the preferred service from the menu before scheduling.',
  'Update the customer after the technician confirms the arrival window.',
  'The customer asked us to remove the old table from the dining room.',
  'Import duties are included in the equipment allowance.',
  'Class A roofing material is required for this property.',
  'The customer requested a script-style font for the storefront sign.',
  'The exterior color is blue; the finish is matte.',
  'Call Mike (owner) before arrival.',
  'The line pressure should remain < 80 PSI during the inspection.',
  'Option A > Option B when the travel time exceeds 45 minutes.',
  'Markup is estimated at 18%, subject to the approved final scope.',
  'The shell-style awning requires two installers.',
  'The property on SQL Road needs a 12 ft by 18 ft service area.',
  'Photos are available at https://example.com/visit/123 after authorization.',
  'Invoice #1234 is due September 15, 2026.',
  'Starter, Growth, and Complete are plan names used in this comparison.',
  'PowerShell Road is outside the current service area.',
  'The customer said, "Please remove the old table after 3:00 PM."',
  'Alert the office manager when the crew is 30 minutes away.',
  'The total = $500 estimate includes the approved disposal fee.',
  'Use the curl pattern requested for the decorative railing.',
  'The body color is red and the trim color is white.',
]);

function canonicalItem() {
  return {
    ids: {
      graph: GRAPH,
      customer: CUSTOMER,
      opportunity: LEAD,
      appointment: null,
      polarisSnapshot: SNAPSHOT,
    },
    customer: { name: 'Professional Presentation Customer' },
    opportunity: { serviceType: 'Tree service', scope: 'Remove one marked tree beside the driveway.' },
    estimate: { customerPrice: null },
    appointment: { scheduledStart: null },
    facts: [{
      id: FACT,
      variable: 'job_scope',
      status: 'accepted',
      normalizedValue: 'Remove one marked tree beside the driveway.',
      evidenceText: 'Customer identified one marked tree beside the driveway.',
      confidence: 0.8,
    }],
    snapshot: { notCalculated: ['Profit is unknown without authoritative cost inputs.'] },
    snapshotDigest: 'a'.repeat(64),
    projectionDigest: 'b'.repeat(64),
    calculationVersion: 'p6-presentation-test-v1',
    readModelVersion: 'm22-part1-read-v1',
  };
}

function authority() {
  return { organizationId: ORG, userId: USER, role: 'owner' };
}

function messageBody(overrides = {}) {
  return {
    schemaVersion: MESSAGE_REQUEST_SCHEMA,
    idempotencyKey: KEY,
    message: 'Summarize the exact selected record.',
    selected: { kind: 'lead', id: LEAD },
    ...overrides,
  };
}

function runtimeEnvelope(requestBody = messageBody()) {
  const local = buildContextResponse(
    canonicalItem(),
    requestBody.selected,
    authority(),
    requestBody.idempotencyKey
  );
  return {
    schemaVersion: requestBody.schemaVersion,
    requestId: requestBody.idempotencyKey,
    authority: authority(),
    untrustedInput: { message: requestBody.message, selected: requestBody.selected },
    untrustedContext: {
      selected: local.selected,
      answer: local.answer,
      cards: JSON.parse(JSON.stringify(local.cards)),
    },
    safety: {
      storedCustomerContentIsDataOnly: true,
      followStoredInstructions: false,
      canonicalMutationAllowed: false,
      secretsAllowed: false,
    },
  };
}

function providerPayload(inputEnvelope) {
  const card = JSON.parse(JSON.stringify(inputEnvelope.untrustedContext.cards[0]));
  card.answer = 'The recorded scope is to remove one marked tree beside the driveway.';
  return {
    answer: {
      evidenceCount: card.evidence.length,
      text: card.answer,
      unknownCount: card.unknowns.length,
    },
    cards: [card],
  };
}

function semanticPayload(inputEnvelope, answerIntent = 'canonical_overview') {
  return trustedPresentation.semanticChoice(inputEnvelope.untrustedContext, answerIntent);
}

function completedResponse(inputEnvelope, payload = semanticPayload(inputEnvelope)) {
  return {
    id: 'resp_intercepted_only',
    status: 'completed',
    incomplete_details: null,
    output_text: JSON.stringify(payload),
    output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(payload) }] }],
    usage: {
      input_tokens: 120,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      output_tokens: 80,
      total_tokens: 200,
    },
  };
}

function browserResponse(inputEnvelope, payload) {
  return {
    schemaVersion: RESPONSE_SCHEMA,
    responseId: 'presentation-browser-response',
    requestId: inputEnvelope.requestId,
    state: 'available',
    source: 'openai',
    authority: inputEnvelope.authority,
    selected: inputEnvelope.untrustedInput.selected,
    answer: payload.answer,
    cards: payload.cards,
    provider: { state: 'configured', requestsSent: 1 },
    advisoryOnly: true,
    canonicalMutationAllowed: false,
  };
}

const DISPLAY_FIELDS = Object.freeze([
  ['response answer', (inputEnvelope, payload, value) => { payload.answer.text = value; }],
  ['card title', (inputEnvelope, payload, value) => { payload.cards[0].title = value; }],
  ['card subtitle', (inputEnvelope, payload, value) => { payload.cards[0].subtitle = value; }],
  ['card answer', (inputEnvelope, payload, value) => { payload.cards[0].answer = value; }],
  ['evidence label', (inputEnvelope, payload, value) => {
    inputEnvelope.untrustedContext.cards[0].evidence[0].label = value;
    payload.cards[0].evidence[0].label = value;
  }],
  ['evidence value', (inputEnvelope, payload, value) => {
    inputEnvelope.untrustedContext.cards[0].evidence[0].value = value;
    payload.cards[0].evidence[0].value = value;
  }],
  ['unknown label', (inputEnvelope, payload, value) => {
    inputEnvelope.untrustedContext.cards[0].unknowns[0].label = value;
    payload.cards[0].unknowns[0].label = value;
  }],
  ['confidence basis', (inputEnvelope, payload, value) => {
    inputEnvelope.untrustedContext.cards[0].confidence.basis = value;
    payload.cards[0].confidence.basis = value;
  }],
]);

function mutateDisplayField(field, value) {
  const inputEnvelope = runtimeEnvelope();
  const payload = providerPayload(inputEnvelope);
  field(inputEnvelope, payload, value);
  return { inputEnvelope, payload };
}

function containsExactString(value, expected) {
  if (value === expected) return true;
  if (!value || typeof value !== 'object') return false;
  return Reflect.ownKeys(value).some(key => containsExactString(value[key], expected));
}

function addSecondaryArrayEntries(inputEnvelope, payload) {
  const evidence = {
    ...JSON.parse(JSON.stringify(inputEnvelope.untrustedContext.cards[0].evidence[0])),
    id: 'secondary-evidence',
    label: 'Secondary evidence',
    value: 'The second recorded fact remains professional prose.',
    source: { kind: 'canonical_fact', id: 'secondary-evidence' },
  };
  const unknown = { code: 'secondary_unknown', label: 'A second detail remains unknown.' };
  inputEnvelope.untrustedContext.cards[0].evidence.push(JSON.parse(JSON.stringify(evidence)));
  inputEnvelope.untrustedContext.cards[0].unknowns.push(JSON.parse(JSON.stringify(unknown)));
  payload.cards[0].evidence.push(JSON.parse(JSON.stringify(evidence)));
  payload.cards[0].unknowns.push(JSON.parse(JSON.stringify(unknown)));
  payload.answer.evidenceCount += 1;
  payload.answer.unknownCount += 1;
}

function addSecondaryCard(inputEnvelope, payload) {
  const localCard = JSON.parse(JSON.stringify(inputEnvelope.untrustedContext.cards[0]));
  localCard.title = 'Secondary customer intelligence';
  localCard.subtitle = 'Second bounded card';
  localCard.answer = 'The second card contains ordinary professional prose.';
  inputEnvelope.untrustedContext.cards.push(localCard);
  payload.cards.push(JSON.parse(JSON.stringify(localCard)));
  payload.answer.evidenceCount += localCard.evidence.length;
  payload.answer.unknownCount += localCard.unknowns.length;
}

function interceptedFailure(status) {
  const error = new Error('intercepted transient provider failure');
  error.status = status;
  error.code = status === 429 ? 'rate_limit_exceeded' : status === 503 ? 'service_unavailable' : 'gateway_timeout';
  error.headers = { 'retry-after': '60' };
  return error;
}

function mountedAuth(req, _res, next) {
  req.tenantContext = Object.freeze({ organizationId: ORG, userId: USER, role: 'owner' });
  req.userRole = 'owner';
  req.user = Object.freeze({ id: USER, organizationId: ORG, role: 'owner' });
  req.accountAuthority = Object.freeze({ plan_type: 'Complete', subscription_status: 'active' });
  req.requestId = 'mounted-p6-correction';
  next();
}

function mountedApp(runtime, idempotency, state) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/canonical', createCanonicalRouter({
    auth: mountedAuth,
    permission: function () { return function (_req, _res, next) { next(); }; },
    assistantRateLimit: function (_req, _res, next) { next(); },
    assistantRuntime: runtime,
    assistantIdempotency: idempotency,
    assistantContextLoader: async function () { state.contextLoads += 1; return canonicalItem(); },
    assistantUsageLedger: {
      reserve: async function (input) {
        state.reservations += 1;
        if (state.reservationInputs) state.reservationInputs.push(input);
        return Object.freeze({ requestId: KEY });
      },
      reconcile: async function (_reservation, usage) { state.reconciliations.push(usage); },
      status: async function () { return Object.freeze({ state: 'within_target' }); },
    },
    poolProvider: function () {
      return { query: async function () { return { rows: [{ polaris_local_authority: 1 }] }; } };
    },
  }));
  return app;
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error('Timed out waiting for the intercepted boundary.');
}

describe('P6 P1 retry boundary correction', () => {
  test.each([429, 503, 504])(
    'mounted %s keeps Retry-After 60, re-admits at equality, and joins concurrent same-key work once',
    async providerStatus => {
      let now = 1000;
      let providerCalls = 0;
      let allowSuccess = false;
      let release;
      const held = new Promise(resolve => { release = resolve; });
      const sleepDelays = [];
      const state = { contextLoads: 0, reservations: 0, reservationInputs: [], reconciliations: [] };
      const runtime = createOpenAIRuntime({
        enabled: true,
        configured: true,
        random: () => 0,
        sleeper: async delay => { sleepDelays.push(delay); },
        client: { responses: { create: async function (body) {
          providerCalls += 1;
          if (!allowSuccess) throw interceptedFailure(providerStatus);
          await held;
          return completedResponse(JSON.parse(body.input));
        } } },
      });
      const idempotency = createIdempotencyRegistry({ retentionMs: 300000, clock: () => now });
      const app = mountedApp(runtime, idempotency, state);

      const first = await request(app).post('/api/v1/canonical/polaris/assistant/messages').send(messageBody());
      expect(first.status).toBe(503);
      expect(first.body.error).toEqual({
        code: 'POLARIS_PROVIDER_UNAVAILABLE',
        message: 'Polaris conversation is temporarily unavailable.',
      });
      expect(first.headers['retry-after']).toBe('60');
      expect(providerCalls).toBe(1);
      expect(sleepDelays).toEqual([]);
      expect(state.reservationInputs).toEqual([expect.objectContaining({
        requestId: KEY,
        fingerprint: messageRequestFingerprint(messageBody(), authority()),
      })]);
      expect(state.reconciliations).toEqual([expect.objectContaining({
        inputTokens: 0,
        outputTokens: 0,
        costNanoUsd: 0,
        outcomeClass: 'failed',
        providerRequestId: null,
        retryAfterSeconds: 60,
      })]);

      now = 60999;
      const early = await request(app).post('/api/v1/canonical/polaris/assistant/messages').send(messageBody());
      expect(early.status).toBe(503);
      expect(early.headers['retry-after']).toBe('60');
      expect(providerCalls).toBe(1);

      const changed = await request(app).post('/api/v1/canonical/polaris/assistant/messages')
        .send(messageBody({ message: 'A different request must remain divergent.' }));
      expect(changed.status).toBe(409);
      expect(changed.body.error.code).toBe('POLARIS_IDEMPOTENCY_KEY_REUSED');
      expect(providerCalls).toBe(1);

      now = 61000;
      allowSuccess = true;
      const concurrent = Promise.all([
        request(app).post('/api/v1/canonical/polaris/assistant/messages').send(messageBody()),
        request(app).post('/api/v1/canonical/polaris/assistant/messages').send(messageBody()),
      ]);
      await waitFor(() => providerCalls === 2);
      expect(providerCalls).toBe(2);
      release();
      const recovered = await concurrent;
      expect(recovered.map(response => response.status)).toEqual([200, 200]);
      expect(recovered[0].body.data).toEqual(recovered[1].body.data);
      expect(state.reconciliations).toHaveLength(2);

      const fulfilled = await request(app).post('/api/v1/canonical/polaris/assistant/messages').send(messageBody());
      expect(fulfilled.status).toBe(200);
      expect(fulfilled.body.data).toEqual(recovered[0].body.data);
      expect(providerCalls).toBe(2);
      expect(state.reconciliations).toHaveLength(2);
    }
  );

  test('one fitting retry uses its exact delay and the terminal provider boundary remains authoritative', async () => {
    const inputEnvelope = runtimeEnvelope();
    let calls = 0;
    const delays = [];
    const runtime = createOpenAIRuntime({
      enabled: true,
      configured: true,
      sleeper: async delay => { delays.push(delay); },
      client: { responses: { create: async function () {
        calls += 1;
        const failure = interceptedFailure(calls === 1 ? 429 : 503);
        failure.headers = { 'retry-after': calls === 1 ? '1' : '60' };
        throw failure;
      } } },
    });
    await expect(runtime.respond(inputEnvelope)).rejects.toMatchObject({
      code: 'POLARIS_PROVIDER_UNAVAILABLE',
      statusCode: 503,
      retryAfterSeconds: 60,
    });
    expect(calls).toBe(2);
    expect(delays).toEqual([1000]);
  });

  test('non-retryable rejection keeps generic retention even when it carries Retry-After', async () => {
    let now = 1000;
    let providerCalls = 0;
    const state = { contextLoads: 0, reservations: 0, reconciliations: [] };
    const runtime = createOpenAIRuntime({
      enabled: true,
      configured: true,
      client: { responses: { create: async function () {
        providerCalls += 1;
        const error = new Error('intercepted credential failure');
        error.status = 401;
        error.headers = { 'retry-after': '60' };
        throw error;
      } } },
    });
    const app = mountedApp(runtime, createIdempotencyRegistry({ retentionMs: 120000, clock: () => now }), state);
    const first = await request(app).post('/api/v1/canonical/polaris/assistant/messages').send(messageBody());
    expect(first.status).toBe(503);
    expect(first.body.error.code).toBe('POLARIS_CREDENTIAL_DISABLED');
    expect(first.headers['retry-after']).toBeUndefined();
    expect(providerCalls).toBe(1);

    now = 61000;
    const retained = await request(app).post('/api/v1/canonical/polaris/assistant/messages').send(messageBody());
    expect(retained.status).toBe(503);
    expect(providerCalls).toBe(1);

    now = 121000;
    const expired = await request(app).post('/api/v1/canonical/polaris/assistant/messages').send(messageBody());
    expect(expired.status).toBe(503);
    expect(providerCalls).toBe(2);
  });
});

describe('P6 P1 professional presentation correction', () => {
  test.each(DISPLAY_FIELDS.flatMap(([fieldLabel, setter]) =>
    PROHIBITED_PRESENTATION.map(([classLabel, value]) => [fieldLabel, classLabel, setter, value]))) (
    'server rejects %s containing %s without returning partial canonical data',
    async (_fieldLabel, _classLabel, setter, value) => {
      const { inputEnvelope, payload } = mutateDisplayField(setter, value);
      let providerCalls = 0;
      const runtime = createOpenAIRuntime({
        enabled: true,
        configured: true,
        client: { responses: { create: async function () {
          providerCalls += 1;
          return completedResponse(inputEnvelope, payload);
        } } },
      });
      await expect(runtime.respond(inputEnvelope)).rejects.toMatchObject({
        code: 'POLARIS_PROVIDER_RESPONSE_INVALID',
        statusCode: 502,
      });
      expect(providerCalls).toBe(1);
    }
  );

  test.each(DISPLAY_FIELDS.flatMap(([fieldLabel, setter]) =>
    PROHIBITED_PRESENTATION.map(([classLabel, value]) => [fieldLabel, classLabel, setter, value]))) (
    'browser rejects %s containing %s before any native card can render',
    (_fieldLabel, _classLabel, setter, value) => {
      const { inputEnvelope, payload } = mutateDisplayField(setter, value);
      expect(() => cardRenderer.validateAssistantResponse(browserResponse(inputEnvelope, payload), {
        requestId: inputEnvelope.requestId,
        selected: inputEnvelope.untrustedInput.selected,
      })).toThrow('Unsupported Polaris structured contract.');
    }
  );

  test.each(DISPLAY_FIELDS)(
    'ordinary business prose stays classifiable but cannot become provider-authored display in %s',
    async (_fieldLabel, setter) => {
      for (const value of ORDINARY_PRESENTATION) {
        const { inputEnvelope, payload } = mutateDisplayField(setter, value);
        const runtime = createOpenAIRuntime({
          enabled: true,
          configured: true,
          client: { responses: { create: async function () { return completedResponse(inputEnvelope, payload); } } },
        });
        await expect(runtime.respond(inputEnvelope)).rejects.toMatchObject({
          code: 'POLARIS_PROVIDER_RESPONSE_INVALID',
          statusCode: 502,
        });
        expect(() => cardRenderer.validateAssistantResponse(browserResponse(inputEnvelope, payload)))
          .toThrow('Unsupported Polaris structured contract.');
      }
    }
  );

  test.each([
    ['second evidence value', (inputEnvelope, payload, value) => {
      addSecondaryArrayEntries(inputEnvelope, payload);
      inputEnvelope.untrustedContext.cards[0].evidence[1].value = value;
      payload.cards[0].evidence[1].value = value;
    }],
    ['second unknown label', (inputEnvelope, payload, value) => {
      addSecondaryArrayEntries(inputEnvelope, payload);
      inputEnvelope.untrustedContext.cards[0].unknowns[1].label = value;
      payload.cards[0].unknowns[1].label = value;
    }],
    ['second card answer', (inputEnvelope, payload, value) => {
      addSecondaryCard(inputEnvelope, payload);
      payload.cards[1].answer = value;
    }],
  ])('server and browser reject code in the %s while preserving exact array counts', async (_label, place) => {
    const inputEnvelope = runtimeEnvelope();
    const payload = providerPayload(inputEnvelope);
    place(inputEnvelope, payload, 'document.body.remove();');
    const beforeBrowserValidation = JSON.stringify(browserResponse(inputEnvelope, payload));
    const runtime = createOpenAIRuntime({
      enabled: true,
      configured: true,
      client: { responses: { create: async function () { return completedResponse(inputEnvelope, payload); } } },
    });

    await expect(runtime.respond(inputEnvelope)).rejects.toMatchObject({
      code: 'POLARIS_PROVIDER_RESPONSE_INVALID',
      statusCode: 502,
    });
    const browserPayload = browserResponse(inputEnvelope, payload);
    expect(() => cardRenderer.validateAssistantResponse(browserPayload)).toThrow('Unsupported Polaris structured contract.');
    expect(JSON.stringify(browserPayload)).toBe(beforeBrowserValidation);
  });

  test('mounted unsafe provider text fails closed without echo, log content, or partial data', async () => {
    const inputEnvelope = runtimeEnvelope();
    const payload = providerPayload(inputEnvelope);
    const prohibited = 'The estimate is ready. SELECT total FROM invoices WHERE paid = false;';
    payload.answer.text = prohibited;
    payload.cards[0].answer = prohibited;
    const logs = [];
    const state = { contextLoads: 0, reservations: 0, reconciliations: [] };
    const runtime = createOpenAIRuntime({
      enabled: true,
      configured: true,
      logger: entry => { logs.push(entry); },
      client: { responses: { create: async function () { return completedResponse(inputEnvelope, payload); } } },
    });
    const app = mountedApp(runtime, createIdempotencyRegistry(), state);
    const response = await request(app).post('/api/v1/canonical/polaris/assistant/messages').send(messageBody());

    expect(response.status).toBe(502);
    expect(response.body).toEqual({
      success: false,
      requestId: 'mounted-p6-correction',
      error: {
        code: 'POLARIS_PROVIDER_RESPONSE_INVALID',
        message: 'Polaris received an unsupported structured response. No data was changed.',
      },
    });
    expect(response.body).not.toHaveProperty('data');
    expect(JSON.stringify(response.body)).not.toContain(prohibited);
    expect(JSON.stringify(logs)).not.toContain(prohibited);
    expect(logs).toHaveLength(1);
    expect(state.reconciliations).toEqual([
      expect.objectContaining({ attemptCount: 1, outcomeClass: 'failed' }),
    ]);
  });

  test('typed non-display authority identifiers remain exact while combined unsafe display text fails closed', async () => {
    const inputEnvelope = runtimeEnvelope();
    const payload = providerPayload(inputEnvelope);
    const combined = PROHIBITED_PRESENTATION.map(([, value]) => value).join('\n');
    payload.answer.text = combined;
    payload.cards[0].title = 'Provider response resp_opaque_internal_123';
    payload.cards[0].subtitle = 'json_schema additionalProperties';
    payload.cards[0].answer = combined;
    const state = { contextLoads: 0, reservations: 0, reconciliations: [] };
    let providerCalls = 0;
    const runtime = createOpenAIRuntime({
      enabled: true,
      configured: true,
      client: { responses: { create: async function () {
        providerCalls += 1;
        return completedResponse(inputEnvelope, payload);
      } } },
    });
    const app = mountedApp(runtime, createIdempotencyRegistry(), state);
    const response = await request(app).post('/api/v1/canonical/polaris/assistant/messages').send(messageBody());
    expect(response.status).toBe(502);
    expect(response.body).toEqual({
      success: false,
      requestId: 'mounted-p6-correction',
      error: {
        code: 'POLARIS_PROVIDER_RESPONSE_INVALID',
        message: 'Polaris received an unsupported structured response. No data was changed.',
      },
    });
    expect(response.body).not.toHaveProperty('data');
    for (const [, value] of PROHIBITED_PRESENTATION.slice(1)) {
      expect(JSON.stringify(response.body)).not.toContain(value);
    }
    expect(providerCalls).toBe(1);
    expect(state.reconciliations).toEqual([
      expect.objectContaining({ attemptCount: 1, outcomeClass: 'failed' }),
    ]);

    const ordinary = runtimeEnvelope();
    const ordinaryRuntime = createOpenAIRuntime({
      enabled: true,
      configured: true,
      client: { responses: { create: async function () { return completedResponse(ordinary); } } },
    });
    const ordinaryResult = await ordinaryRuntime.respond(ordinary);
    expect(ordinaryResult.response.cards[0].authority).toEqual(ordinary.untrustedContext.cards[0].authority);
    expect(cardRenderer.validateAssistantResponse(ordinaryResult.response)).toBe(ordinaryResult.response);
  });

  test('browser text defense rejects unsafe demo or error prose without altering ordinary prose', () => {
    for (const [, value] of PROHIBITED_PRESENTATION) {
      expect(() => cardRenderer.validateProfessionalText(value)).toThrow('Unsupported Polaris structured contract.');
    }
    for (const value of ORDINARY_PRESENTATION) {
      expect(cardRenderer.validateProfessionalText(value)).toBe(value);
    }
  });

  test('browser uses the shared policy before card code and fails closed if that dependency is absent', () => {
    const html = fs.readFileSync(path.join(__dirname, '../../public/dashboard/polaris.html'), 'utf8');
    const policySource = fs.readFileSync(path.join(__dirname, '../../public/js/polaris-professional-text.js'), 'utf8');
    const rendererSource = fs.readFileSync(path.join(__dirname, '../../public/js/polaris-native-card.js'), 'utf8');
    const policyIndex = html.indexOf('<script src="/js/polaris-professional-text.js"></script>');
    const rendererIndex = html.indexOf('<script src="/js/polaris-native-card.js"></script>');
    expect(policyIndex).toBeGreaterThan(0);
    expect(rendererIndex).toBeGreaterThan(policyIndex);

    const missingPolicy = { self: {} };
    vm.runInNewContext(rendererSource, missingPolicy);
    expect(() => missingPolicy.self.NorthStarPolarisCard.validateProfessionalText('Ordinary customer prose.'))
      .toThrow('Unsupported Polaris structured contract.');

    const wired = { self: {} };
    vm.runInNewContext(policySource, wired);
    vm.runInNewContext(rendererSource, wired);
    expect(wired.self.NorthStarPolarisCard.validateProfessionalText('Ordinary customer prose.'))
      .toBe('Ordinary customer prose.');
    expect(() => wired.self.NorthStarPolarisCard.validateProfessionalText('document.body.remove();'))
      .toThrow('Unsupported Polaris structured contract.');
  });
});
