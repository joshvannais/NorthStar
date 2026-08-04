'use strict';

const crypto = require('crypto');
const request = require('supertest');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');

const TEST_ENV = Object.freeze({
  PUBLIC_ORIGIN: 'http://127.0.0.1',
  STRIPE_SECRET_KEY: 'synthetic-server-secret',
  STRIPE_WEBHOOK_SECRET: 'synthetic-webhook-secret',
  STRIPE_API_VERSION: '2025-06-30.basil',
  STRIPE_PRICE_STARTER: 'price_starter_synthetic',
  STRIPE_PRICE_PROFESSIONAL: 'price_professional_synthetic',
  STRIPE_PRICE_ENTERPRISE: 'price_enterprise_synthetic',
  STRIPE_PAYMENT_METHOD_CONFIGURATION_ID: 'pmc_synthetic',
  STRIPE_BILLING_PORTAL_CONFIGURATION_ID: 'bpc_synthetic',
  STRIPE_AUTOMATIC_TAX_ENABLED: 'true',
  STRIPE_TAX_ID_COLLECTION_ENABLED: 'true',
});

function cookieHeader(response) {
  return (response.headers['set-cookie'] || []).map(value => value.split(';')[0]).join('; ');
}

function csrf(response) {
  const value = (response.headers['set-cookie'] || []).find(item => item.startsWith('northstar_csrf='));
  return value ? decodeURIComponent(value.split(';')[0].split('=').slice(1).join('=')) : '';
}

function linkToken(message) {
  const match = String(message && message.text || '').match(/https?:\/\/[^\s]+/);
  if (!match) throw new Error('Synthetic verification link was not captured');
  return new URL(match[0]).searchParams.get('token');
}

function signed(rawBody, timestamp) {
  const digest = crypto.createHmac('sha256', TEST_ENV.STRIPE_WEBHOOK_SECRET)
    .update(Buffer.concat([Buffer.from(String(timestamp) + '.', 'utf8'), rawBody]))
    .digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

function eventBuffer(id, type, created, object, apiVersion = TEST_ENV.STRIPE_API_VERSION) {
  return Buffer.from(JSON.stringify({ id, object: 'event', api_version: apiVersion, created, type, data: { object } }), 'utf8');
}

function invoiceObject(input) {
  return {
    id: input.id,
    object: 'invoice',
    customer: input.customerId,
    currency: 'usd',
    paid: input.paid,
    status: input.paid ? 'paid' : 'open',
    parent: {
      subscription_details: {
        subscription: input.subscriptionId,
        metadata: {
          northstar_organization_id: input.organizationId,
          northstar_plan_key: input.planKey || 'starter',
        },
      },
    },
    lines: {
      data: [{
        amount: input.amount === undefined ? 9900 : input.amount,
        currency: 'usd',
        period: { start: input.periodStart, end: input.periodEnd },
        pricing: { price_details: { price: input.priceId || 'price_starter_synthetic' } },
      }],
    },
  };
}

function subscriptionObject(input) {
  return {
    id: input.subscriptionId,
    object: 'subscription',
    customer: input.customerId,
    status: input.status,
    cancel_at_period_end: input.cancelAtPeriodEnd,
    current_period_start: input.periodStart,
    current_period_end: input.periodEnd,
    metadata: {
      northstar_organization_id: input.organizationId,
      northstar_plan_key: 'starter',
    },
    items: { data: [{ price: { id: 'price_starter_synthetic' } }] },
  };
}

describe('Account Lifecycle PR B2 mounted PostgreSQL billing authority', () => {
  jest.setTimeout(30000);
  let allocation;
  let db;
  let pool;
  let app;
  let repository;
  let billingRepository;
  let providerCalls;
  let capture;
  let priorDatabaseUrl;
  let controlledNow = new Date('2026-08-04T12:00:00.000Z');
  let failAfterWebhook = false;
  let owner;
  let session;
  let releaseCheckout;
  let checkoutStarted;

  async function postWebhook(rawBody, signatureHeader = signed(rawBody, Math.floor(controlledNow.getTime() / 1000))) {
    return request(app)
      .post('/api/billing/webhook')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', signatureHeader)
      .send(rawBody.toString('utf8'));
  }

  beforeAll(async () => {
    if (!process.env.M19_PG_ADMIN_URL) {
      throw new Error('Disposable PostgreSQL 18 identity is required for Account Lifecycle PR B2');
    }
    allocation = await createSuiteDatabase('account lifecycle b2');
    priorDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = allocation.connectionString;
    jest.resetModules();
    db = require('../../src/db');
    expect(await db.initDatabase()).toBe(true);
    pool = db.getPool();

    const { AccountRepository } = require('../../src/accounts/repository');
    const { BillingRepository } = require('../../src/billing/repository');
    const { BillingService } = require('../../src/billing/service');
    const { buildBillingConfiguration } = require('../../src/billing/config');
    const { StripeProvider } = require('../../src/billing/stripeProvider');
    const { createDisposableAccountApp } = require('../helpers/account-test-app');
    repository = new AccountRepository(pool, { testClock: () => controlledNow });
    billingRepository = new BillingRepository(pool, {
      testClock: () => controlledNow,
      testFailure: async () => {
        if (failAfterWebhook) {
          failAfterWebhook = false;
          throw new Error('synthetic transaction rollback');
        }
      },
    });
    const configuration = buildBillingConfiguration(TEST_ENV, { allowLoopback: true });
    providerCalls = [];
    const fetchImpl = jest.fn(async (url, options) => {
      providerCalls.push({ url, options });
      if (url.endsWith('/v1/checkout/sessions')) {
        if (checkoutStarted) checkoutStarted();
        if (releaseCheckout) await new Promise(resolve => { releaseCheckout.resolve = resolve; });
        const form = new URLSearchParams(options.body);
        return new Response(JSON.stringify({
          id: 'cs_synthetic_b2',
          url: 'https://checkout.stripe.com/c/pay/synthetic-b2',
          expires_at: Number(form.get('expires_at')),
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.endsWith('/v1/billing_portal/sessions')) {
        return new Response(JSON.stringify({
          id: 'bps_synthetic_b2',
          url: 'https://billing.stripe.com/p/session/synthetic-b2',
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.endsWith('/v1/subscriptions/sub_synthetic_b2')) {
        return new Response(JSON.stringify({
          id: 'sub_synthetic_b2', cancel_at_period_end: true,
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error('Unexpected intercepted provider destination');
    });
    const provider = new StripeProvider(configuration, {
      fetchImpl,
      now: () => controlledNow,
      timeoutMs: 2000,
    });
    const billingService = new BillingService({
      configuration,
      provider,
      repository: billingRepository,
      now: () => controlledNow,
    });
    capture = { messages: [], async send(message) { this.messages.push(message); return { accepted: true }; } };
    app = createDisposableAccountApp({
      repository,
      billingService,
      emailCapture: capture,
      publicOrigin: 'http://127.0.0.1',
    });

    const signup = await request(app).post('/api/auth/signup').send({
      name: 'B2 Owner',
      businessName: 'B2 Company',
      email: 'owner.b2@example.test',
      password: 'B2-authentic-password-123!',
      phone: '+1 555 010 2020',
    });
    expect(signup.status).toBe(202);
    expect(capture.messages).toHaveLength(1);
    const verification = await request(app).post('/api/auth/verify-email').send({ token: linkToken(capture.messages[0]) });
    expect(verification.status).toBe(200);
    const login = await request(app).post('/api/auth/login').send({
      email: 'owner.b2@example.test', password: 'B2-authentic-password-123!',
    });
    expect(login.status).toBe(200);
    session = { cookie: cookieHeader(login), csrf: csrf(login) };
    owner = (await pool.query(
      `SELECT id AS user_id, organization_id FROM users WHERE email_normalized = 'owner.b2@example.test'`
    )).rows[0];
  });

  afterAll(async () => {
    if (db) await db.close();
    if (priorDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = priorDatabaseUrl;
    if (allocation) await allocation.cleanup();
  });

  test('owner-only Checkout ignores tenant and amount tampering and is concurrency bounded', async () => {
    const tampered = await request(app)
      .post('/api/billing/checkout')
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf)
      .send({ planKey: 'starter', organizationId: crypto.randomUUID(), amount: 1, currency: 'eur' });
    expect(tampered.status).toBe(400);
    expect(providerCalls).toHaveLength(0);

    const invalidPlan = await request(app)
      .post('/api/billing/checkout')
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf)
      .send({ planKey: 'annual' });
    expect(invalidPlan.status).toBe(400);
    expect(invalidPlan.body.code).toBe('billing_plan_invalid');

    await pool.query('UPDATE organization_memberships SET role = \'admin\' WHERE user_id = $1', [owner.user_id]);
    const notOwner = await request(app)
      .post('/api/billing/checkout')
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf)
      .send({ planKey: 'starter' });
    expect(notOwner.status).toBe(403);
    expect(providerCalls).toHaveLength(0);
    await pool.query('UPDATE organization_memberships SET role = \'owner\' WHERE user_id = $1', [owner.user_id]);

    let startedResolve;
    const started = new Promise(resolve => { startedResolve = resolve; });
    checkoutStarted = startedResolve;
    releaseCheckout = {};
    const firstPromise = request(app)
      .post('/api/billing/checkout')
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf)
      .send({ planKey: 'starter' })
      .then(value => value);
    const firstStage = await Promise.race([
      started.then(() => ({ started: true })),
      firstPromise.then(response => ({ response })),
    ]);
    if (firstStage.response) {
      throw new Error(`Checkout returned before provider: ${firstStage.response.status} ${JSON.stringify(firstStage.response.body)}`);
    }
    const concurrent = await request(app)
      .post('/api/billing/checkout')
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf)
      .send({ planKey: 'starter' });
    expect(concurrent.status).toBe(409);
    expect(concurrent.body.code).toBe('billing_checkout_in_progress');
    releaseCheckout.resolve();
    const first = await firstPromise;
    checkoutStarted = null;
    releaseCheckout = null;
    expect(first.status).toBe(201);
    expect(first.body).toEqual(expect.objectContaining({
      activationPendingWebhook: true,
      checkout: expect.objectContaining({
        url: 'https://checkout.stripe.com/c/pay/synthetic-b2',
      }),
    }));
    expect(providerCalls).toHaveLength(1);
    const form = new URLSearchParams(providerCalls[0].options.body);
    expect(providerCalls[0].url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(form.get('line_items[0][price]')).toBe('price_starter_synthetic');
    expect(form.get('client_reference_id')).toBe(owner.organization_id);
    expect(form.get('metadata[northstar_organization_id]')).toBe(owner.organization_id);
    expect(form.get('success_url')).toBe('http://127.0.0.1/dashboard/settings?billing=return');
    expect(form.get('unit_amount')).toBeNull();

    const state = (await pool.query(
      'SELECT status, billing_authority_verified, stripe_customer_id FROM subscriptions WHERE organization_id = $1',
      [owner.organization_id]
    )).rows[0];
    expect(state).toEqual({ status: 'trialing', billing_authority_verified: false, stripe_customer_id: null });
  });

  test('raw signed Checkout binding never activates and signature failures leave zero durable event', async () => {
    const created = Math.floor(controlledNow.getTime() / 1000);
    const checkout = eventBuffer('evt_checkout_b2', 'checkout.session.completed', created, {
      id: 'cs_synthetic_b2',
      object: 'checkout.session',
      mode: 'subscription',
      status: 'complete',
      client_reference_id: owner.organization_id,
      customer: 'cus_synthetic_b2',
      subscription: 'sub_synthetic_b2',
      metadata: {
        northstar_organization_id: owner.organization_id,
        northstar_plan_key: 'starter',
      },
    });
    const unsigned = await postWebhook(checkout, '');
    expect(unsigned.status).toBe(400);
    const staleTimestamp = created - 301;
    const stale = await postWebhook(checkout, signed(checkout, staleTimestamp));
    expect(stale.status).toBe(400);
    const changed = Buffer.concat([checkout, Buffer.from('\n')]);
    const changedResponse = await postWebhook(changed, signed(checkout, created));
    expect(changedResponse.status).toBe(400);
    expect((await pool.query('SELECT count(*)::int AS total FROM billing_webhook_events')).rows[0].total).toBe(0);

    const accepted = await postWebhook(checkout);
    expect(accepted.status).toBe(200);
    expect(accepted.body.code).toBe('checkout_bound_pending_payment');
    const state = (await pool.query(
      `SELECT status, billing_authority_verified, stripe_customer_id, stripe_subscription_id,
              billing_plan_key
         FROM subscriptions WHERE organization_id = $1`,
      [owner.organization_id]
    )).rows[0];
    expect(state).toEqual({
      status: 'trialing',
      billing_authority_verified: false,
      stripe_customer_id: 'cus_synthetic_b2',
      stripe_subscription_id: 'sub_synthetic_b2',
      billing_plan_key: 'starter',
    });
  });

  test('concurrent paid delivery is atomic and duplicate-safe, with automatic banner suppression', async () => {
    const created = Math.floor(controlledNow.getTime() / 1000) + 10;
    const paid = eventBuffer('evt_paid_b2', 'invoice.paid', created, invoiceObject({
      id: 'in_paid_b2',
      customerId: 'cus_synthetic_b2',
      subscriptionId: 'sub_synthetic_b2',
      organizationId: owner.organization_id,
      paid: true,
      periodStart: 1785542400,
      periodEnd: 1788220800,
    }));
    const [left, right] = await Promise.all([postWebhook(paid), postWebhook(paid)]);
    expect([left.status, right.status]).toEqual([200, 200]);
    expect([left.body.result, right.body.result].sort()).toEqual(['duplicate', 'processed']);
    expect((await pool.query(
      `SELECT count(*)::int AS total FROM billing_webhook_events WHERE provider_event_id = 'evt_paid_b2'`
    )).rows[0].total).toBe(1);
    const state = (await pool.query(
      `SELECT status, billing_authority_verified, plan_type, billing_plan_key,
              current_period_start, current_period_end
         FROM subscriptions WHERE organization_id = $1`,
      [owner.organization_id]
    )).rows[0];
    expect(state.status).toBe('active');
    expect(state.billing_authority_verified).toBe(true);
    expect(state.plan_type).toBe('Starter');
    expect(state.billing_plan_key).toBe('starter');
    const projection = await request(app)
      .get('/api/account/subscription?organizationId=foreign&paid=true&state=active')
      .set('Cookie', session.cookie);
    expect(projection.status).toBe(200);
    expect(projection.body.subscription).toEqual(expect.objectContaining({
      state: 'active', safe: true, readOnly: false, showTrialBanner: false,
      upgradeAvailable: false, billingAuthorityVerified: true, planKey: 'starter',
    }));
  });

  test('out-of-order failures do not regress paid state and unsupported events are durable no-ops', async () => {
    const older = Math.floor(controlledNow.getTime() / 1000) + 5;
    const failed = eventBuffer('evt_failed_old_b2', 'invoice.payment_failed', older, invoiceObject({
      id: 'in_failed_old_b2',
      customerId: 'cus_synthetic_b2',
      subscriptionId: 'sub_synthetic_b2',
      organizationId: owner.organization_id,
      paid: false,
      periodStart: 1785542400,
      periodEnd: 1788220800,
    }));
    const ignored = await postWebhook(failed);
    expect(ignored.status).toBe(200);
    expect(ignored.body.code).toBe('out_of_order_event');
    expect((await pool.query(
      'SELECT status FROM subscriptions WHERE organization_id = $1', [owner.organization_id]
    )).rows[0].status).toBe('active');

    const unsupported = eventBuffer('evt_unsupported_b2', 'payment_intent.succeeded', older + 20, {
      id: 'pi_synthetic', object: 'payment_intent', amount: 1,
    });
    const unsupportedResponse = await postWebhook(unsupported);
    expect(unsupportedResponse.status).toBe(200);
    expect(unsupportedResponse.body).toEqual(expect.objectContaining({ result: 'ignored', code: 'unsupported_event' }));
    expect((await pool.query(
      `SELECT processing_status FROM billing_webhook_events WHERE provider_event_id = 'evt_unsupported_b2'`
    )).rows[0].processing_status).toBe('ignored');
  });

  test('payment failure, rollback-safe reconciliation, portal, and cancellation honor paid-through access', async () => {
    const renewalStart = 1788220800;
    const renewalEnd = 1790812800;
    const failedCreated = Math.floor(controlledNow.getTime() / 1000) + 30;
    const failed = eventBuffer('evt_failed_new_b2', 'invoice.payment_failed', failedCreated, invoiceObject({
      id: 'in_failed_new_b2',
      customerId: 'cus_synthetic_b2',
      subscriptionId: 'sub_synthetic_b2',
      organizationId: owner.organization_id,
      paid: false,
      periodStart: renewalStart,
      periodEnd: renewalEnd,
    }));
    expect((await postWebhook(failed)).body.code).toBe('payment_failure_reconciled');
    let projection = await request(app).get('/api/account/subscription').set('Cookie', session.cookie);
    expect(projection.body.subscription).toEqual(expect.objectContaining({
      state: 'past_due', readOnly: false, portalAvailable: true,
      cancelAvailable: true,
    }));

    await pool.query('UPDATE organization_memberships SET role = \'admin\' WHERE user_id = $1', [owner.user_id]);
    const providerCallsBeforeRoleNegatives = providerCalls.length;
    for (const route of ['portal', 'cancel']) {
      const denied = await request(app)
        .post(`/api/billing/${route}`)
        .set('Cookie', session.cookie)
        .set('X-CSRF-Token', session.csrf)
        .send({});
      expect(denied.status).toBe(403);
    }
    expect(providerCalls).toHaveLength(providerCallsBeforeRoleNegatives);
    await pool.query('UPDATE organization_memberships SET role = \'owner\' WHERE user_id = $1', [owner.user_id]);

    const portal = await request(app)
      .post('/api/billing/portal')
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf)
      .send({});
    expect(portal.status).toBe(201);
    expect(portal.body.portal.url).toBe('https://billing.stripe.com/p/session/synthetic-b2');

    const paidCreated = failedCreated + 10;
    const renewalPaid = eventBuffer('evt_paid_renewal_b2', 'invoice.paid', paidCreated, invoiceObject({
      id: 'in_failed_new_b2',
      customerId: 'cus_synthetic_b2',
      subscriptionId: 'sub_synthetic_b2',
      organizationId: owner.organization_id,
      paid: true,
      periodStart: renewalStart,
      periodEnd: renewalEnd,
    }));
    failAfterWebhook = true;
    const rolledBack = await postWebhook(renewalPaid);
    expect(rolledBack.status).toBe(503);
    expect((await pool.query(
      `SELECT count(*)::int AS total FROM billing_webhook_events WHERE provider_event_id = 'evt_paid_renewal_b2'`
    )).rows[0].total).toBe(0);
    expect((await pool.query(
      'SELECT status FROM subscriptions WHERE organization_id = $1', [owner.organization_id]
    )).rows[0].status).toBe('past_due');
    const retried = await postWebhook(renewalPaid);
    expect(retried.status).toBe(200);
    expect(retried.body.code).toBe('paid_activation_reconciled');

    const cancel = await request(app)
      .post('/api/billing/cancel')
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf)
      .send({});
    expect(cancel.status).toBe(202);
    expect(cancel.body.cancellation).toEqual(expect.objectContaining({
      requested: true, confirmationPendingWebhook: true,
    }));
    expect((await pool.query(
      'SELECT cancel_at_period_end FROM subscriptions WHERE organization_id = $1', [owner.organization_id]
    )).rows[0].cancel_at_period_end).toBe(false);

    const subscriptionCreated = paidCreated + 10;
    const scheduled = eventBuffer('evt_subscription_cancel_b2', 'customer.subscription.updated', subscriptionCreated,
      subscriptionObject({
        subscriptionId: 'sub_synthetic_b2', customerId: 'cus_synthetic_b2',
        organizationId: owner.organization_id, status: 'active', cancelAtPeriodEnd: true,
        periodStart: renewalStart, periodEnd: renewalEnd,
      }));
    expect((await postWebhook(scheduled)).body.code).toBe('cancellation_scheduled');
    const repeatedCancel = await request(app)
      .post('/api/billing/cancel')
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf)
      .send({});
    expect(repeatedCancel.body.cancellation).toEqual(expect.objectContaining({
      requested: false, alreadyScheduled: true,
    }));

    const deleted = eventBuffer('evt_subscription_deleted_b2', 'customer.subscription.deleted', subscriptionCreated + 10,
      subscriptionObject({
        subscriptionId: 'sub_synthetic_b2', customerId: 'cus_synthetic_b2',
        organizationId: owner.organization_id, status: 'canceled', cancelAtPeriodEnd: false,
        periodStart: renewalStart, periodEnd: renewalEnd,
      }));
    expect((await postWebhook(deleted)).body.code).toBe('cancellation_reconciled');
    projection = await request(app).get('/api/account/subscription').set('Cookie', session.cookie);
    expect(projection.body.subscription).toEqual(expect.objectContaining({ state: 'canceled', readOnly: false }));
    controlledNow = new Date(renewalEnd * 1000);
    projection = await request(app).get('/api/account/subscription').set('Cookie', session.cookie);
    expect(projection.body.subscription).toEqual(expect.objectContaining({ state: 'canceled', readOnly: true }));
  });

  test('conflicting provider ownership and wrong API version fail closed without event retention', async () => {
    const invoiceIdentityConflict = eventBuffer(
      'evt_invoice_identity_conflict_b2',
      'invoice.paid',
      Math.floor(controlledNow.getTime() / 1000),
      invoiceObject({
        id: 'in_failed_new_b2',
        customerId: 'cus_synthetic_b2',
        subscriptionId: 'sub_synthetic_b2',
        organizationId: owner.organization_id,
        paid: true,
        periodStart: 1788307200,
        periodEnd: 1790899200,
      })
    );
    const invoiceConflictResponse = await postWebhook(invoiceIdentityConflict);
    expect(invoiceConflictResponse.status).toBe(409);
    expect(invoiceConflictResponse.body.code).toBe('billing_invoice_identity_conflict');
    expect((await pool.query(
      `SELECT count(*)::int AS total FROM billing_webhook_events
        WHERE provider_event_id = 'evt_invoice_identity_conflict_b2'`
    )).rows[0].total).toBe(0);

    const secondOrganization = crypto.randomUUID();
    await pool.query(
      `INSERT INTO organizations (id, name, email)
       VALUES ($1, 'Conflicting organization', 'conflict.b2@example.test')`,
      [secondOrganization]
    );
    await pool.query(
      `INSERT INTO subscriptions (id, organization_id, plan_type, status, trial_started_at, trial_ends_at)
       VALUES ($1, $2, 'Trial', 'expired', NULL, NULL)`,
      [crypto.randomUUID(), secondOrganization]
    );
    const created = Math.floor(controlledNow.getTime() / 1000);
    const conflict = eventBuffer('evt_conflict_b2', 'checkout.session.completed', created, {
      id: 'cs_conflict_b2', object: 'checkout.session', mode: 'subscription', status: 'complete',
      client_reference_id: secondOrganization,
      customer: 'cus_synthetic_b2', subscription: 'sub_synthetic_b2',
      metadata: { northstar_organization_id: secondOrganization, northstar_plan_key: 'starter' },
    });
    const conflictResponse = await postWebhook(conflict);
    expect(conflictResponse.status).toBe(409);
    expect(conflictResponse.body.code).toBe('billing_ownership_conflict');
    expect((await pool.query(
      `SELECT count(*)::int AS total FROM billing_webhook_events WHERE provider_event_id = 'evt_conflict_b2'`
    )).rows[0].total).toBe(0);

    const wrongVersion = eventBuffer('evt_version_b2', 'payment_intent.succeeded', created, {
      id: 'pi_version_b2', object: 'payment_intent',
    }, '2024-06-20');
    const versionResponse = await postWebhook(wrongVersion);
    expect(versionResponse.status).toBe(400);
    expect(versionResponse.body.code).toBe('billing_webhook_version_unavailable');
    expect((await pool.query(
      `SELECT count(*)::int AS total FROM billing_webhook_events WHERE provider_event_id = 'evt_version_b2'`
    )).rows[0].total).toBe(0);
  });
});
