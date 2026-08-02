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

    for (const mutation of [
      { RESEND_API_KEY: undefined },
      { RESEND_API_KEY: '' },
      { RESEND_API_KEY: ' re_invalid' },
      { RESEND_API_KEY: 're_invalid key' },
      { RESEND_API_KEY: 're_invalid\r\nInjected: yes' },
      { RESEND_API_KEY: `re_invalid${String.fromCharCode(0)}` },
      { RESEND_API_KEY: `re_${'a'.repeat(510)}` },
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
    [400, 'validation_rejection'],
    [401, 'authorization_rejection'],
    [403, 'authorization_rejection'],
    [409, 'idempotency_conflict'],
    [422, 'validation_rejection'],
    [429, 'rate_limited'],
    [500, 'provider_failure'],
    [502, 'provider_failure'],
    [503, 'provider_failure'],
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
      expect(['unexpected_redirect', 'malformed_response']).toContain(error.category);
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
