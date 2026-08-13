'use strict';

const {
  TransactionalDeliveryError,
  TransactionalEmail,
  createResendAdapter,
  validatedProductionConfiguration,
} = require('../../src/email/transactional');

const TEST_KEY = 're_test_only_abcdefghijklmnopqrstuvwxyz0123456789';
const ORIGIN = 'https://www.northstar-os.ai';
const FROM = 'notifications@northstar-os.ai';
const DELIVERY_ID = '11111111-2222-4333-8444-555555555555';
const REQUEST_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function validEnvironment(overrides = {}) {
  return {
    RESEND_API_KEY: TEST_KEY,
    PUBLIC_ORIGIN: ORIGIN,
    TRANSACTIONAL_EMAIL_FROM: FROM,
    ...overrides,
  };
}

function jsonResponse(status, value, headers = {}) {
  return new Response(value === undefined ? null : JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function scriptedBodyFetch(steps, evidence = {}) {
  evidence.calls = 0;
  evidence.aborts = 0;
  evidence.cancels = 0;
  evidence.releases = 0;
  return async (_url, options) => {
    evidence.calls += 1;
    let index = 0;
    let pending = null;
    let closed = false;
    const timers = new Set();
    const cleanup = () => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      options.signal.removeEventListener('abort', abort);
    };
    const abort = () => {
      evidence.aborts += 1;
      if (pending) {
        const error = new Error('deadline');
        error.name = 'AbortError';
        pending.reject(error);
        pending = null;
      }
    };
    options.signal.addEventListener('abort', abort);
    const reader = {
      read() {
        const step = steps[index++] || { never: true, safetyMs: 250 };
        return new Promise((resolve, reject) => {
          pending = { reject };
          const finish = value => {
            pending = null;
            resolve(value);
          };
          if (step.never) {
            const safety = setTimeout(() => {
              timers.delete(safety);
              pending = null;
              reject(new Error('test safety deadline'));
            }, step.safetyMs || 250);
            timers.add(safety);
            return;
          }
          const timer = setTimeout(() => {
            timers.delete(timer);
            if (closed) return;
            if (step.done) closed = true;
            finish(step.done
              ? { done: true }
              : { done: false, value: new TextEncoder().encode(step.value) });
          }, step.delayMs || 0);
          timers.add(timer);
        });
      },
      async cancel() {
        evidence.cancels += 1;
        closed = true;
        cleanup();
      },
      releaseLock() {
        evidence.releases += 1;
        cleanup();
      },
    };
    return {
      status: 200,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      body: { getReader: () => reader },
    };
  };
}

function createEmail(fetchImpl, options = {}) {
  const configuration = validatedProductionConfiguration(validEnvironment());
  expect(configuration).not.toBeNull();
  return new TransactionalEmail({
    adapter: createResendAdapter(configuration, { fetchImpl, ...options }),
    publicOrigin: configuration.origin,
    from: configuration.from,
    production: true,
  });
}

function validMessage() {
  return {
    from: { name: 'NorthStar Notifications', address: FROM },
    to: 'owner@example.test',
    subject: 'Bounded subject',
    text: 'Bounded text',
    html: '<p>Bounded text</p>',
  };
}

function validContext() {
  return {
    idempotencyKey: 'northstar-b1-test-' + 'a'.repeat(64),
    requestId: REQUEST_ID,
  };
}

async function rejectedOutcome(fetchImpl, options = {}) {
  const configuration = validatedProductionConfiguration(validEnvironment());
  const adapter = createResendAdapter(configuration, { fetchImpl, ...options });
  try {
    await adapter.send(validMessage(), validContext());
  } catch (error) {
    expect(error).toBeInstanceOf(TransactionalDeliveryError);
    const serialized = JSON.stringify(error);
    for (const forbidden of [TEST_KEY, 'owner@example.test', 'Bounded text', 'northstar-b1-test']) {
      expect(serialized).not.toContain(forbidden);
    }
    return error;
  }
  throw new Error('Expected Resend delivery rejection');
}

describe('production Resend transactional delivery', () => {
  test('requires the exact source-owned B1 configuration and ignores SMTP authority', () => {
    const valid = validatedProductionConfiguration(validEnvironment({
      SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: '587', SMTP_USER: 'ignored', SMTP_PASS: 'ignored',
      TRANSACTIONAL_EMAIL_FROM_NAME: 'Attacker Controlled',
    }));
    expect(valid).not.toBeNull();
    expect(valid.origin).toBe(ORIGIN);
    expect(valid.from).toBe(FROM);
    expect(valid.apiKey).toBe(TEST_KEY);

    for (const apiKey of [
      'future-format-opaque-key',
      'opaque.key:segment/with+punctuation=value',
      '!#$%&\'()*+,-./:;<=>?@[]^_`{|}~',
    ]) {
      const future = validatedProductionConfiguration(validEnvironment({ RESEND_API_KEY: apiKey }));
      expect(future).not.toBeNull();
      expect(future.apiKey).toBe(apiKey);
    }

    for (const mutation of [
      { RESEND_API_KEY: undefined },
      { RESEND_API_KEY: '' },
      { RESEND_API_KEY: ' leading-space' },
      { RESEND_API_KEY: 'trailing-space ' },
      { RESEND_API_KEY: 'embedded space' },
      { RESEND_API_KEY: 'embedded\ttab' },
      { RESEND_API_KEY: 're_invalid\r\nInjected: yes' },
      { RESEND_API_KEY: `re_invalid${String.fromCharCode(0)}` },
      { RESEND_API_KEY: `visible${String.fromCharCode(127)}del` },
      { RESEND_API_KEY: 'opaque-é' },
      { RESEND_API_KEY: 'a'.repeat(4097) },
      { PUBLIC_ORIGIN: 'https://northstar-os.ai' },
      { PUBLIC_ORIGIN: 'http://www.northstar-os.ai' },
      { PUBLIC_ORIGIN: 'https://www.northstar-os.ai/path' },
      { TRANSACTIONAL_EMAIL_FROM: '' },
      { TRANSACTIONAL_EMAIL_FROM: 'NorthStar Notifications <notifications@northstar-os.ai>' },
      { TRANSACTIONAL_EMAIL_FROM: 'one@northstar-os.ai,two@northstar-os.ai' },
      { TRANSACTIONAL_EMAIL_FROM: 'notifications@northstar-os.ai\r\nBcc:x@example.test' },
    ]) {
      expect(validatedProductionConfiguration(validEnvironment(mutation))).toBeNull();
    }
    expect(validatedProductionConfiguration({
      PUBLIC_ORIGIN: ORIGIN,
      TRANSACTIONAL_EMAIL_FROM: FROM,
      SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: '587', SMTP_USER: 'user', SMTP_PASS: 'pass',
    })).toBeNull();
  });

  test('sends the exact fixed request with bounded non-identifying idempotency authority', async () => {
    const calls = [];
    const email = createEmail(async (url, options) => {
      calls.push({ url: String(url), options });
      return jsonResponse(200, { id: '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794' });
    });

    await email.verification('Owner@Example.Test', 'A'.repeat(43), {
      deliveryId: DELIVERY_ID,
      requestId: REQUEST_ID,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.resend.com/emails');
    expect(calls[0].options.method).toBe('POST');
    expect(calls[0].options.redirect).toBe('manual');
    expect(calls[0].options.headers['Content-Type']).toBe('application/json');
    expect(calls[0].options.headers.Authorization).toBe(`Bearer ${TEST_KEY}`);
    const idempotencyKey = calls[0].options.headers['Idempotency-Key'];
    expect(idempotencyKey).toMatch(/^northstar-b1-email-verification-[0-9a-f]{64}$/);
    expect(idempotencyKey.length).toBeLessThanOrEqual(256);
    for (const forbidden of [
      'owner', 'example', DELIVERY_ID, REQUEST_ID, 'A'.repeat(43),
    ]) expect(idempotencyKey.toLowerCase()).not.toContain(forbidden.toLowerCase());

    const body = JSON.parse(calls[0].options.body);
    expect(body).toEqual({
      from: 'NorthStar Notifications <notifications@northstar-os.ai>',
      to: ['owner@example.test'],
      subject: 'Verify your NorthStar email',
      text: `Verify your email within 24 hours: ${ORIGIN}/verify-email?token=${'A'.repeat(43)}\n\nYour 14-day trial begins only after verification.`,
      html: `<p>Verify your email within 24 hours: <a href="${ORIGIN}/verify-email?token=${'A'.repeat(43)}">Verify your email</a></p><p>Your 14-day trial begins only after verification.</p>`,
    });
    expect(body).not.toHaveProperty('reply_to');
    expect(body).not.toHaveProperty('cc');
    expect(body).not.toHaveProperty('bcc');
    expect(body).not.toHaveProperty('headers');
  });

  test('returns only a bounded accepted outcome and never returns authorization material', async () => {
    const configuration = validatedProductionConfiguration(validEnvironment());
    const adapter = createResendAdapter(configuration, {
      fetchImpl: async () => jsonResponse(202, { id: 'provider-message_123' }),
      now: () => new Date('2026-08-02T12:00:00.000Z'),
    });
    const outcome = await adapter.send(validMessage(), validContext());
    expect(outcome).toEqual({
      provider: 'resend', accepted: true, category: 'accepted', code: 'resend_accepted',
      httpStatus: 202, providerMessageIdPresent: true, providerMessageId: 'provider-message_123',
      attemptedAt: '2026-08-02T12:00:00.000Z', requestId: REQUEST_ID,
    });
    expect(JSON.stringify(outcome)).not.toContain(TEST_KEY);
  });

  test('exports a typed bounded delivery error', () => {
    expect(TransactionalDeliveryError).toEqual(expect.any(Function));
  });

  test.each([
    [400, 'provider_request_rejected'],
    [401, 'provider_access_rejected'],
    [403, 'provider_access_rejected'],
    [409, 'provider_conflict'],
    [422, 'provider_request_rejected'],
    [429, 'provider_rate_limited'],
    [500, 'provider_unavailable'],
    [502, 'provider_unavailable'],
    [503, 'provider_unavailable'],
  ])('classifies provider HTTP %i without consuming its body', async (status, category) => {
    const error = await rejectedOutcome(async () => jsonResponse(status, {
      message: `${TEST_KEY} owner@example.test Bounded text`,
    }));
    expect(error).toEqual(expect.objectContaining({
      provider: 'resend', accepted: false, category, code: `resend_${category}`,
      httpStatus: status, providerMessageIdPresent: false, requestId: REQUEST_ID,
    }));
  });

  test('classifies network rejection and timeout without retrying', async () => {
    let networkCalls = 0;
    const network = await rejectedOutcome(async () => {
      networkCalls += 1;
      throw new Error(`network ${TEST_KEY}`);
    });
    expect(network.category).toBe('network_failure');
    expect(networkCalls).toBe(1);

    let timeoutCalls = 0;
    const timeout = await rejectedOutcome((_url, options) => new Promise((_resolve, reject) => {
      timeoutCalls += 1;
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    }), { timeoutMs: 5 });
    expect(timeout.category).toBe('timeout');
    expect(timeoutCalls).toBe(1);
  });

  test('keeps one timeout across headers and every response-body chunk', async () => {
    const cases = [
      {
        name: 'first body chunk delayed',
        steps: [
          { delayMs: 200, value: '{"id":"late"}' },
          { done: true },
        ],
      },
      {
        name: 'first chunk arrives then remainder stalls',
        steps: [
          { value: '{"id":' },
          { delayMs: 200, value: '"late"}' },
          { done: true },
        ],
      },
      {
        name: 'body remains indefinitely open',
        steps: [{ never: true, safetyMs: 250 }],
      },
    ];
    for (const testCase of cases) {
      const evidence = {};
      const started = Date.now();
      const error = await rejectedOutcome(scriptedBodyFetch(testCase.steps, evidence), { timeoutMs: 20 });
      expect(error.category).toBe('timeout');
      expect(Date.now() - started).toBeLessThan(150);
      expect(evidence).toEqual(expect.objectContaining({
        calls: 1, aborts: 1, cancels: 1, releases: 1,
      }));
    }
  });

  test('accepts an immediate pre-deadline body and clears response resources once', async () => {
    jest.useFakeTimers();
    try {
      const evidence = {};
      const adapter = createResendAdapter(validatedProductionConfiguration(validEnvironment()), {
        fetchImpl: scriptedBodyFetch([
          { delayMs: 5, value: '{"id":"just-in-time"}' },
          { done: true },
        ], evidence),
        timeoutMs: 50,
      });
      const delivery = adapter.send(validMessage(), validContext());
      await jest.advanceTimersByTimeAsync(5);
      await jest.advanceTimersToNextTimerAsync();
      const outcome = await delivery;
      expect(outcome.accepted).toBe(true);
      await jest.advanceTimersByTimeAsync(60);
      expect(evidence).toEqual(expect.objectContaining({
        calls: 1, aborts: 0, cancels: 0, releases: 1,
      }));
    } finally {
      jest.useRealTimers();
    }
  });

  test('preserves the incremental response limit for chunked bodies', async () => {
    const evidence = {};
    const error = await rejectedOutcome(scriptedBodyFetch([
      { value: 'a'.repeat(9000) },
      { value: 'b'.repeat(9000) },
      { done: true },
    ], evidence), { timeoutMs: 100 });
    expect(error.category).toBe('malformed_provider_response');
    expect(evidence).toEqual(expect.objectContaining({ calls: 1, cancels: 1, releases: 1 }));
  });

  test('rejects redirects and every malformed or oversized success response', async () => {
    const cases = [
      async () => new Response(null, { status: 302, headers: { Location: 'https://attacker.invalid/' } }),
      async () => new Response(null, { status: 200, headers: { 'Content-Type': 'application/json' } }),
      async () => new Response('{not-json', { status: 200, headers: { 'Content-Type': 'application/json' } }),
      async () => new Response('x'.repeat(16385), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }),
      async () => jsonResponse(200, {}),
      async () => jsonResponse(200, { id: '' }),
      async () => jsonResponse(200, { id: 'invalid provider id' }),
      async () => jsonResponse(200, { id: 'a'.repeat(129) }),
      async () => new Response(JSON.stringify({ id: 'provider-id' }), {
        status: 200, headers: { 'Content-Type': 'text/plain' },
      }),
    ];
    for (const fetchImpl of cases) {
      const error = await rejectedOutcome(fetchImpl);
      expect(['provider_redirect_rejected', 'malformed_provider_response']).toContain(error.category);
    }
  });

  test('keeps one operation deterministic and changes the key for a superseded token operation', async () => {
    const keys = [];
    const email = createEmail(async (_url, options) => {
      keys.push(options.headers['Idempotency-Key']);
      return jsonResponse(200, { id: `provider-${keys.length}` });
    });
    for (const deliveryId of [
      DELIVERY_ID,
      DELIVERY_ID,
      '99999999-8888-4777-8666-555555555555',
    ]) {
      await email.verification('owner@example.test', 'B'.repeat(43), {
        deliveryId,
        requestId: REQUEST_ID,
      });
    }
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
    expect(new Set(keys).size).toBe(2);
  });
});
