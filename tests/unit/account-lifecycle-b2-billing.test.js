'use strict';

const crypto = require('crypto');

const COMPLETE_ENV = Object.freeze({
  PUBLIC_ORIGIN: 'https://www.northstar-os.ai',
  STRIPE_SECRET_KEY: 'placeholder-server-secret',
  STRIPE_WEBHOOK_SECRET: 'placeholder-webhook-secret',
  STRIPE_API_VERSION: '2025-06-30.basil',
  STRIPE_PRICE_STARTER: 'price_starter_placeholder',
  STRIPE_PRICE_PROFESSIONAL: 'price_professional_placeholder',
  STRIPE_PRICE_ENTERPRISE: 'price_enterprise_placeholder',
  STRIPE_PAYMENT_METHOD_CONFIGURATION_ID: 'pmc_placeholder',
  STRIPE_BILLING_PORTAL_CONFIGURATION_ID: 'bpc_placeholder',
  STRIPE_AUTOMATIC_TAX_ENABLED: 'true',
  STRIPE_TAX_ID_COLLECTION_ENABLED: 'true',
});

function signature(secret, rawBody, timestamp) {
  return crypto.createHmac('sha256', secret)
    .update(Buffer.concat([Buffer.from(String(timestamp) + '.', 'utf8'), rawBody]))
    .digest('hex');
}

describe('Account Lifecycle PR B2 billing boundary', () => {
  test('production configuration is complete-or-unavailable and prices remain source-owned', () => {
    const { PLANS, buildBillingConfiguration } = require('../../src/billing/config');
    expect(buildBillingConfiguration({})).toBeNull();
    for (const key of Object.keys(COMPLETE_ENV)) {
      const incomplete = { ...COMPLETE_ENV };
      delete incomplete[key];
      expect(buildBillingConfiguration(incomplete)).toBeNull();
    }
    expect(buildBillingConfiguration({ ...COMPLETE_ENV, STRIPE_AUTOMATIC_TAX_ENABLED: 'false' })).toBeNull();
    expect(buildBillingConfiguration({ ...COMPLETE_ENV, PUBLIC_ORIGIN: 'https://evil.example.test' })).toBeNull();
    expect(buildBillingConfiguration({
      ...COMPLETE_ENV,
      STRIPE_PRICE_ENTERPRISE: COMPLETE_ENV.STRIPE_PRICE_STARTER,
    })).toBeNull();

    expect(PLANS).toEqual({
      starter: expect.objectContaining({ name: 'Starter', monthlyAmountCents: 9900 }),
      professional: expect.objectContaining({ name: 'Professional', monthlyAmountCents: 19900 }),
      enterprise: expect.objectContaining({ name: 'Enterprise', monthlyAmountCents: 29900 }),
    });
    const configured = buildBillingConfiguration(COMPLETE_ENV);
    expect(configured.publicOrigin).toBe('https://www.northstar-os.ai');
    expect(configured.plans.starter.priceId).toBe('price_starter_placeholder');
    expect(JSON.stringify(configured)).not.toContain(COMPLETE_ENV.STRIPE_SECRET_KEY);
    expect(JSON.stringify(configured)).not.toContain(COMPLETE_ENV.STRIPE_WEBHOOK_SECRET);
  });

  test('signature verification uses the exact raw bytes and a bounded timestamp', () => {
    const { verifyStripeSignature } = require('../../src/billing/stripeProvider');
    const raw = Buffer.from('{"id":"evt_synthetic","type":"invoice.paid"}\n', 'utf8');
    const now = 1785859200;
    const digest = signature(COMPLETE_ENV.STRIPE_WEBHOOK_SECRET, raw, now);
    expect(verifyStripeSignature({
      rawBody: raw,
      signatureHeader: `t=${now},v1=${'0'.repeat(64)},v1=${digest}`,
      secret: COMPLETE_ENV.STRIPE_WEBHOOK_SECRET,
      nowSeconds: now,
    })).toEqual({ timestamp: now });

    for (const candidate of [
      { rawBody: Buffer.from(raw.toString('utf8').trim(), 'utf8'), signatureHeader: `t=${now},v1=${digest}`, nowSeconds: now },
      { rawBody: raw, signatureHeader: `t=${now - 301},v1=${signature(COMPLETE_ENV.STRIPE_WEBHOOK_SECRET, raw, now - 301)}`, nowSeconds: now },
      { rawBody: raw, signatureHeader: `t=${now + 301},v1=${signature(COMPLETE_ENV.STRIPE_WEBHOOK_SECRET, raw, now + 301)}`, nowSeconds: now },
      { rawBody: raw, signatureHeader: `t=${now}`, nowSeconds: now },
      { rawBody: raw, signatureHeader: `t=${now},t=${now},v1=${digest}`, nowSeconds: now },
      { rawBody: 'not-a-buffer', signatureHeader: `t=${now},v1=${digest}`, nowSeconds: now },
    ]) {
      expect(() => verifyStripeSignature({
        ...candidate,
        secret: COMPLETE_ENV.STRIPE_WEBHOOK_SECRET,
      })).toThrow(expect.objectContaining({ code: 'billing_webhook_invalid' }));
    }
  });

  test('intercepted Checkout uses fixed Stripe destination and server-owned fields', async () => {
    const { buildBillingConfiguration } = require('../../src/billing/config');
    const { StripeProvider } = require('../../src/billing/stripeProvider');
    const calls = [];
    const fetchImpl = jest.fn(async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({
        id: 'cs_synthetic_checkout',
        url: 'https://checkout.stripe.com/c/pay/synthetic',
        expires_at: 1785846600,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const provider = new StripeProvider(buildBillingConfiguration(COMPLETE_ENV, { exposeSecrets: true }), {
      fetchImpl,
      timeoutMs: 1000,
      now: () => new Date('2026-08-04T12:00:00.000Z'),
    });

    const result = await provider.createCheckout({
      organizationId: '00000000-0000-4000-8000-000000000001',
      email: 'owner@example.test',
      planKey: 'starter',
      idempotencyKey: 'northstar-b2-' + 'a'.repeat(64),
    });
    expect(result).toEqual({
      id: 'cs_synthetic_checkout',
      url: 'https://checkout.stripe.com/c/pay/synthetic',
      expiresAt: '2026-08-04T12:30:00.000Z',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(calls[0].url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(calls[0].options.redirect).toBe('manual');
    expect(calls[0].options.headers['Idempotency-Key']).toMatch(/^northstar-b2-/);
    const form = new URLSearchParams(calls[0].options.body);
    expect(form.get('mode')).toBe('subscription');
    expect(form.get('line_items[0][price]')).toBe('price_starter_placeholder');
    expect(form.get('line_items[0][quantity]')).toBe('1');
    expect(form.get('success_url')).toBe('https://www.northstar-os.ai/dashboard/settings?billing=return');
    expect(form.get('cancel_url')).toBe('https://www.northstar-os.ai/dashboard/settings?billing=cancelled');
    expect(form.get('client_reference_id')).toBe('00000000-0000-4000-8000-000000000001');
    expect(form.get('metadata[northstar_organization_id]')).toBe('00000000-0000-4000-8000-000000000001');
    expect(form.get('subscription_data[metadata][northstar_plan_key]')).toBe('starter');
    expect(form.get('automatic_tax[enabled]')).toBe('true');
    expect(form.get('payment_method_configuration')).toBe('pmc_placeholder');
    expect(form.get('unit_amount')).toBeNull();
    expect(JSON.stringify(calls)).not.toContain('9900');
  });

  test('provider failures are bounded, single-attempt, and never expose response bodies', async () => {
    const { buildBillingConfiguration } = require('../../src/billing/config');
    const { StripeProvider } = require('../../src/billing/stripeProvider');
    const fetchImpl = jest.fn(async () => new Response(
      JSON.stringify({ error: { message: 'sensitive provider body', payment_method: 'pm_synthetic' } }),
      { status: 429, headers: { 'content-type': 'application/json' } }
    ));
    const provider = new StripeProvider(buildBillingConfiguration(COMPLETE_ENV, { exposeSecrets: true }), {
      fetchImpl,
      timeoutMs: 1000,
    });
    let failure;
    try {
      await provider.createPortal({
        customerId: 'cus_synthetic',
        idempotencyKey: 'northstar-b2-' + 'b'.repeat(64),
      });
    } catch (error) {
      failure = error;
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(failure).toEqual(expect.objectContaining({
      code: 'billing_provider_rate_limited',
      indeterminate: false,
    }));
    expect(JSON.stringify(failure)).not.toContain('sensitive provider body');
    expect(JSON.stringify(failure)).not.toContain('pm_synthetic');
  });

  test.each([
    ['request rejection', async () => new Response('{}', { status: 400 }), 'billing_provider_request_rejected', false],
    ['access rejection', async () => new Response('{}', { status: 401 }), 'billing_provider_access_rejected', false],
    ['conflict', async () => new Response('{}', { status: 409 }), 'billing_provider_conflict', false],
    ['redirect', async () => new Response('', { status: 302 }), 'billing_provider_redirect_rejected', false],
    ['provider unavailable', async () => new Response('{}', { status: 503 }), 'billing_provider_unavailable', true],
    ['malformed success', async () => new Response('not-json', { status: 200 }), 'billing_provider_malformed_response', true],
    ['oversized success', async () => new Response('x'.repeat(17 * 1024), { status: 200 }), 'billing_provider_malformed_response', true],
    ['network failure', async () => { throw new Error('synthetic network failure'); }, 'billing_provider_network_failure', true],
    ['deadline', async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('synthetic abort');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    }), 'billing_provider_timeout', true],
  ])('classifies intercepted %s without retry', async (_label, fetchImpl, code, indeterminate) => {
    const { buildBillingConfiguration } = require('../../src/billing/config');
    const { StripeProvider } = require('../../src/billing/stripeProvider');
    const intercepted = jest.fn(fetchImpl);
    const provider = new StripeProvider(buildBillingConfiguration(COMPLETE_ENV), {
      fetchImpl: intercepted,
      timeoutMs: 10,
    });
    await expect(provider.createPortal({
      customerId: 'cus_synthetic',
      idempotencyKey: 'northstar-b2-' + 'c'.repeat(64),
    })).rejects.toEqual(expect.objectContaining({ code, indeterminate }));
    expect(intercepted).toHaveBeenCalledTimes(1);
  });

  test('paid and paid-through projections require verified PostgreSQL provider authority', () => {
    const { projectSubscription, canMutateInternal } = require('../../src/accounts/subscriptionPolicy');
    const base = {
      subscription_status: 'active',
      server_now: '2026-08-04T12:00:00.000Z',
      current_period_start: '2026-08-01T00:00:00.000Z',
      current_period_end: '2026-09-01T00:00:00.000Z',
      billing_plan_key: 'starter',
      stripe_customer_id: 'cus_synthetic',
      stripe_subscription_id: 'sub_synthetic',
    };
    expect(projectSubscription(base, { billingAvailable: true })).toEqual(expect.objectContaining({
      state: 'unavailable', safe: false, readOnly: true, upgradeAvailable: false,
    }));

    const active = projectSubscription({ ...base, billing_authority_verified: true }, { billingAvailable: true });
    expect(active).toEqual(expect.objectContaining({
      state: 'active', safe: true, readOnly: false, showTrialBanner: false,
      upgradeAvailable: false, planKey: expect.any(String),
    }));
    expect(canMutateInternal(active)).toBe(true);

    const canceledPaidThrough = projectSubscription({
      ...base,
      subscription_status: 'canceled',
      billing_authority_verified: true,
    }, { billingAvailable: true });
    expect(canceledPaidThrough.readOnly).toBe(false);
    expect(canMutateInternal(canceledPaidThrough)).toBe(true);

    const canceledEnded = projectSubscription({
      ...base,
      subscription_status: 'canceled',
      billing_authority_verified: true,
      server_now: '2026-09-01T00:00:00.000Z',
    }, { billingAvailable: true });
    expect(canceledEnded.readOnly).toBe(true);
    expect(canMutateInternal(canceledEnded)).toBe(false);
  });
});
