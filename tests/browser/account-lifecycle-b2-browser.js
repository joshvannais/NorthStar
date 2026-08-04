'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');

const VIEWPORTS = [
  { label: '1440x900', width: 1440, height: 900 },
  { label: '390x844', width: 390, height: 844 },
];
const NOW = new Date('2026-08-04T12:00:00.000Z');
const API_VERSION = '2025-06-30.basil';
const WEBHOOK_SECRET = 'synthetic-browser-webhook-secret';
const PROVIDER_SECRET = 'synthetic-browser-server-secret';

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

function verificationUrl(message) {
  const match = String(message && message.text || '').match(/https?:\/\/[^\s]+/);
  assert.ok(match, 'captured synthetic verification link');
  const value = new URL(match[0]);
  assert.strictEqual(value.pathname, '/verify-email');
  return value;
}

function signature(rawBody, timestamp) {
  const digest = crypto.createHmac('sha256', WEBHOOK_SECRET)
    .update(Buffer.concat([Buffer.from(String(timestamp) + '.', 'utf8'), rawBody]))
    .digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

function eventBuffer(id, type, created, object) {
  return Buffer.from(JSON.stringify({
    id, object: 'event', api_version: API_VERSION, created, type, data: { object },
  }), 'utf8');
}

async function postWebhook(baseUrl, rawBody) {
  const timestamp = Math.floor(NOW.getTime() / 1000);
  const response = await fetch(baseUrl + '/api/billing/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signature(rawBody, timestamp) },
    body: rawBody,
  });
  const body = await response.json();
  assert.strictEqual(response.status, 200, JSON.stringify(body));
  return body;
}

function createInventory(context, origin) {
  const requests = [];
  const responseBodies = [];
  const nonlocal = [];
  const pageErrors = [];
  const consoleErrors = [];
  context.on('page', page => page.on('pageerror', error => pageErrors.push(String(error.message || error))));
  context.on('request', request => {
    const url = new URL(request.url());
    requests.push({ method: request.method(), origin: url.origin, path: url.pathname });
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) nonlocal.push(url.origin);
    assert.ok(!Object.keys(request.headers()).some(name => name.toLowerCase() === 'authorization'));
  });
  context.on('response', response => {
    if (!new URL(response.url()).pathname.startsWith('/api/')) return;
    responseBodies.push(response.text().catch(() => ''));
  });
  function attach(page) {
    page.on('pageerror', error => pageErrors.push(String(error.message || error)));
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
  }
  context.pages().forEach(attach);
  context.on('page', attach);
  return {
    requests,
    async assertSafe() {
      const bodies = await Promise.all(responseBodies);
      assert.deepStrictEqual(nonlocal, [], 'all browser HTTP destinations remain loopback');
      assert.deepStrictEqual(pageErrors, [], 'no browser page errors');
      assert.strictEqual(consoleErrors.length, 1, 'only the deliberate tampered request may log a console error');
      assert.match(consoleErrors[0], /400|Bad Request/, 'console error is the deliberate rejected tamper');
      assert.ok(!bodies.some(body => body.includes(PROVIDER_SECRET) || body.includes(WEBHOOK_SECRET)),
        'provider secrets are absent from mounted API responses');
      return { responses: bodies.length, consoleErrors };
    },
  };
}

async function installNetworkFence(context, origin) {
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) {
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
}

async function login(page, baseUrl, email, password) {
  await page.goto(baseUrl + '/login');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await Promise.all([
    page.waitForURL(url => ['/dashboard', '/dashboard/business-profile'].includes(url.pathname)),
    page.click('#loginForm button[type="submit"]'),
  ]);
}

function checkoutObject(input) {
  return {
    id: input.checkoutId,
    object: 'checkout.session',
    mode: 'subscription',
    status: 'complete',
    client_reference_id: input.organizationId,
    customer: input.customerId,
    subscription: input.subscriptionId,
    metadata: {
      northstar_organization_id: input.organizationId,
      northstar_plan_key: 'starter',
    },
  };
}

function invoiceObject(input) {
  return {
    id: input.invoiceId,
    object: 'invoice',
    customer: input.customerId,
    currency: 'usd',
    paid: true,
    status: 'paid',
    amount_paid: 9900,
    amount_due: 9900,
    amount_remaining: 0,
    total: 9900,
    subtotal: 9900,
    starting_balance: 0,
    ending_balance: 0,
    pre_payment_credit_notes_amount: 0,
    post_payment_credit_notes_amount: 0,
    discounts: [],
    total_discount_amounts: [],
    total_tax_amounts: [],
    parent: {
      subscription_details: {
        subscription: input.subscriptionId,
        metadata: {
          northstar_organization_id: input.organizationId,
          northstar_plan_key: 'starter',
        },
      },
    },
    lines: { data: [{
      amount: 9900,
      currency: 'usd',
      quantity: 1,
      proration: false,
      period: { start: input.periodStart, end: input.periodEnd },
      pricing: { price_details: { price: 'price_starter_synthetic' } },
    }] },
  };
}

function subscriptionObject(input) {
  return {
    id: input.subscriptionId,
    object: 'subscription',
    customer: input.customerId,
    status: 'active',
    cancel_at_period_end: true,
    current_period_start: input.periodStart,
    current_period_end: input.periodEnd,
    metadata: {
      northstar_organization_id: input.organizationId,
      northstar_plan_key: 'starter',
    },
    items: { data: [{ price: { id: 'price_starter_synthetic' } }] },
  };
}

async function runJourney(spec, viewport, state) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `northstar-b2-${spec.engine}-${viewport.width}-`));
  let context;
  try {
    context = await spec.runtime.browserType.launchPersistentContext(profile, {
      executablePath: spec.runtime.executablePath,
      headless: true,
      viewport: { width: viewport.width, height: viewport.height },
    });
    await installNetworkFence(context, state.baseUrl);
    const trace = createInventory(context, state.baseUrl);
    const page = context.pages()[0] || await context.newPage();
    const suffix = crypto.randomBytes(8).toString('hex');
    const email = `b2-browser-${suffix}@example.test`;
    const password = 'Browser-billing-password-123!';
    const messageStart = state.capture.messages.length;

    await page.goto(state.baseUrl + '/signup');
    await page.fill('#name', 'Billing Browser Owner');
    await page.fill('#businessName', `Billing Browser ${suffix}`);
    await page.fill('#phone', '8605550198');
    await page.fill('#email', email);
    await page.fill('#password', password);
    await page.fill('#confirmPassword', password);
    const signup = page.waitForResponse(response => response.url().endsWith('/api/auth/signup'));
    await page.click('#signupForm button[type="submit"]');
    assert.strictEqual((await signup).status(), 202);
    assert.strictEqual(state.capture.messages.length, messageStart + 1);

    await login(page, state.baseUrl, email, password);
    const link = verificationUrl(state.capture.messages.at(-1));
    await page.goto(link.toString());
    await page.waitForFunction(() => document.getElementById('verifyStatus').textContent.includes('14-day trial'));
    assert.strictEqual(page.url(), state.baseUrl + '/verify-email');

    await page.goto(state.baseUrl + '/dashboard/business-profile');
    const saved = await page.evaluate(async profileValue => {
      const response = await NorthStarAccountSession.fetch('/api/v1/business-profile', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profileValue),
      });
      return { status: response.status, body: await response.json() };
    }, canonicalFenceProfile({ companyName: `Billing Browser ${suffix}` }));
    assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));

    await page.evaluate(async () => {
      localStorage.setItem('northstar-subscription-state', 'active');
      sessionStorage.setItem('northstar-paid', 'true');
      window.northstarPaid = true;
    });
    await page.goto(state.baseUrl + '/dashboard/settings?billing=success&paid=true&plan=enterprise');
    await page.waitForFunction(() => document.getElementById('subscription-billing-status').textContent.includes('Choose'));
    assert.strictEqual(new URL(page.url()).search, '', 'return query is removed and has no authority');
    assert.match(await page.locator('#northstar-trial-status').textContent(), /14 days remaining/);

    const trialUi = await page.evaluate(() => ({
      labels: Array.from(document.querySelectorAll('#subscription-billing-actions button')).map(item => item.textContent),
      status: document.getElementById('subscription-billing-status').textContent,
      overflow: document.documentElement.scrollWidth <= innerWidth,
      sectionWidth: document.getElementById('subscription-billing').getBoundingClientRect().width,
    }));
    assert.deepStrictEqual(trialUi.labels, [
      'Starter — $99/month', 'Professional — $199/month', 'Enterprise — $299/month',
    ]);
    assert.ok(trialUi.overflow && trialUi.sectionWidth > 0);
    assert.match(trialUi.status, /signed paid invoice/);

    const forged = await page.evaluate(async () => {
      const response = await NorthStarAccountSession.fetch('/api/account/subscription?paid=true&plan=enterprise');
      return response.json();
    });
    assert.strictEqual(forged.subscription.state, 'trialing');
    assert.strictEqual(forged.subscription.planKey, null);

    const providerStart = state.providerCalls.length;
    const tampered = await page.evaluate(async () => {
      const response = await NorthStarAccountSession.fetch('/api/billing/checkout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planKey: 'starter', amount: 1, organizationId: 'foreign' }),
      });
      return { status: response.status, body: await response.json() };
    });
    assert.strictEqual(tampered.status, 400);
    assert.strictEqual(state.providerCalls.length, providerStart);

    const checkout = await page.evaluate(async () => {
      const response = await NorthStarAccountSession.fetch('/api/billing/checkout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planKey: 'starter' }),
      });
      return { status: response.status, body: await response.json() };
    });
    assert.strictEqual(checkout.status, 201, JSON.stringify(checkout.body));
    assert.strictEqual(checkout.body.activationPendingWebhook, true);
    assert.strictEqual(new URL(checkout.body.checkout.url).hostname, 'checkout.stripe.com');
    assert.ok(!Object.hasOwn(checkout.body.checkout, 'id'), 'provider object id remains server-side');
    assert.strictEqual(state.providerCalls.length, providerStart + 1);

    const authority = (await state.pool.query(
      'SELECT id AS user_id, organization_id FROM users WHERE email_normalized = $1', [email]
    )).rows[0];
    const ids = {
      checkoutId: `cs_browser_${suffix}`,
      customerId: `cus_browser_${suffix}`,
      subscriptionId: `sub_browser_${suffix}`,
      invoiceId: `in_browser_${suffix}`,
      organizationId: authority.organization_id,
      periodStart: Math.floor(NOW.getTime() / 1000),
      periodEnd: Math.floor(NOW.getTime() / 1000) + 31 * 86400,
    };
    const call = state.providerCalls.at(-1);
    assert.strictEqual(call.kind, 'checkout');
    assert.strictEqual(call.organizationId, authority.organization_id);
    assert.strictEqual(call.planKey, 'starter');
    assert.strictEqual(call.amountCents, 9900);

    const preEvidence = await page.evaluate(async () => {
      const response = await NorthStarAccountSession.fetch('/api/account/subscription');
      return response.json();
    });
    assert.strictEqual(preEvidence.subscription.state, 'trialing', 'Checkout response never activates payment');

    await postWebhook(state.baseUrl, eventBuffer(
      `evt_checkout_${suffix}`, 'checkout.session.completed', ids.periodStart,
      checkoutObject(ids)
    ));
    const afterCheckout = await page.evaluate(async () => {
      await NorthStarTrialStatus.refresh();
      return NorthStarAccountSession.json('/api/account/subscription');
    });
    assert.strictEqual(afterCheckout.subscription.state, 'trialing', 'signed Checkout completion still does not activate');
    assert.match(await page.locator('#northstar-trial-status').textContent(), /14 days remaining/);

    await postWebhook(state.baseUrl, eventBuffer(
      `evt_invoice_${suffix}`, 'invoice.paid', ids.periodStart + 1,
      invoiceObject(ids)
    ));
    await page.evaluate(() => Promise.all([NorthStarTrialStatus.refresh(), NorthStarBillingSettings.refresh()]));
    await page.waitForFunction(() => !document.getElementById('northstar-trial-status'));
    const paidUi = await page.evaluate(() => ({
      bannerCount: document.querySelectorAll('#northstar-trial-status').length,
      status: document.getElementById('subscription-billing-status').textContent,
      labels: Array.from(document.querySelectorAll('#subscription-billing-actions button')).map(item => item.textContent),
      overflow: document.documentElement.scrollWidth <= innerWidth,
    }));
    assert.strictEqual(paidUi.bannerCount, 0);
    assert.match(paidUi.status, /Starter .* active through/);
    assert.deepStrictEqual(paidUi.labels, ['Manage billing', 'Cancel at period end']);
    assert.strictEqual(paidUi.overflow, true);

    const portal = await page.evaluate(async () => {
      const response = await NorthStarAccountSession.fetch('/api/billing/portal', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      return { status: response.status, body: await response.json() };
    });
    assert.strictEqual(portal.status, 201);
    assert.strictEqual(new URL(portal.body.portal.url).hostname, 'billing.stripe.com');
    assert.ok(!Object.hasOwn(portal.body.portal, 'id'), 'portal provider id remains server-side');

    const cancellation = await page.evaluate(async () => {
      const response = await NorthStarAccountSession.fetch('/api/billing/cancel', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      return { status: response.status, body: await response.json() };
    });
    assert.strictEqual(cancellation.status, 202);
    assert.strictEqual(cancellation.body.cancellation.confirmationPendingWebhook, true);
    const beforeCancelEvidence = await page.evaluate(() => NorthStarAccountSession.json('/api/account/subscription'));
    assert.strictEqual(beforeCancelEvidence.subscription.cancelAtPeriodEnd, false);

    await postWebhook(state.baseUrl, eventBuffer(
      `evt_cancel_${suffix}`, 'customer.subscription.updated', ids.periodStart + 2,
      subscriptionObject(ids)
    ));
    await page.evaluate(() => NorthStarBillingSettings.refresh());
    const canceledUi = await page.evaluate(() => ({
      status: document.getElementById('subscription-billing-status').textContent,
      labels: Array.from(document.querySelectorAll('#subscription-billing-actions button')).map(item => item.textContent),
    }));
    assert.match(canceledUi.status, /canceled at period end/);
    assert.deepStrictEqual(canceledUi.labels, ['Manage billing']);

    await state.pool.query(
      `UPDATE subscriptions
          SET status = 'active', cancel_at_period_end = FALSE,
              current_period_start = $2, current_period_end = $3
        WHERE organization_id = $1`,
      [authority.organization_id, new Date(NOW.getTime() - 31 * 86400000), new Date(NOW.getTime() - 1)]
    );
    const expiredProjection = await page.evaluate(async () => {
      await Promise.all([NorthStarTrialStatus.refresh(), NorthStarBillingSettings.refresh()]);
      return NorthStarAccountSession.json('/api/account/subscription');
    });
    await page.waitForSelector('#northstar-trial-status[data-state="restricted"]');
    const expiredUi = await page.evaluate(() => ({
      banner: document.getElementById('northstar-trial-status').textContent,
      bannerRole: document.getElementById('northstar-trial-status').getAttribute('role'),
      status: document.getElementById('subscription-billing-status').textContent,
      labels: Array.from(document.querySelectorAll('#subscription-billing-actions button')).map(item => item.textContent),
    }));
    assert.strictEqual(expiredProjection.subscription.state, 'expired');
    assert.strictEqual(expiredProjection.subscription.readOnly, true);
    assert.strictEqual(expiredProjection.subscription.portalAvailable, false);
    assert.strictEqual(expiredProjection.subscription.cancelAvailable, false);
    assert.match(expiredUi.banner, /paid-through period has ended/);
    assert.strictEqual(expiredUi.bannerRole, 'alert');
    assert.match(expiredUi.status, /paid-through period has ended/);
    assert.doesNotMatch(expiredUi.status, / is active through /);
    assert.deepStrictEqual(expiredUi.labels, []);

    const traceEvidence = await trace.assertSafe();
    assert.ok(state.providerCalls.slice(providerStart).every(callItem => callItem.intercepted === true));
    return {
      engine: spec.engine === 'chrome' ? 'installed Chrome' : 'actual Playwright WebKit',
      viewport: viewport.label,
      browserRequests: trace.requests.length,
      apiResponses: traceEvidence.responses,
      expectedRejectedTamperConsoleErrors: traceEvidence.consoleErrors.length,
      unexpectedConsoleErrors: 0,
      providerBoundaryCalls: state.providerCalls.length - providerStart,
      externalProviderTransmissions: 0,
      paidBannerRemovedAfterSignedInvoice: true,
      cancellationPreservedPaidThrough: true,
      expiredActiveRestrictionVisible: true,
      expiredActiveControlsHidden: true,
    };
  } finally {
    if (context) await context.close().catch(() => {});
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

async function main() {
  for (const key of ['M19_PG_ADMIN_URL', 'M19_EXPECTED_PG_DATA_DIR', 'M19_EXPECTED_PG_PORT', 'M19_TEST_RUN_ID']) {
    assert.ok(process.env[key], `${key} is required`);
  }
  const selection = process.env.NORTHSTAR_BROWSER || 'both';
  assert.ok(['chrome', 'webkit', 'both'].includes(selection));
  const engines = selection === 'both' ? ['chrome', 'webkit'] : [selection];
  const allocation = await createSuiteDatabase(`account-lifecycle-b2-browser-${selection}`);
  const prior = { database: process.env.DATABASE_URL, secret: process.env.AUTH_ACCESS_SECRET };
  process.env.DATABASE_URL = allocation.connectionString;
  process.env.AUTH_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');
  let db;
  let server;
  try {
    db = require('../../src/db');
    assert.strictEqual(await db.initDatabase(), true);
    const pool = db.getPool();
    const port = await reservePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const { AccountRepository } = require('../../src/accounts/repository');
    const { BillingRepository } = require('../../src/billing/repository');
    const { BillingService } = require('../../src/billing/service');
    const { buildBillingConfiguration } = require('../../src/billing/config');
    const { StripeProvider } = require('../../src/billing/stripeProvider');
    const repository = new AccountRepository(pool, { testClock: () => NOW });
    const billingRepository = new BillingRepository(pool, { testClock: () => NOW });
    const configuration = buildBillingConfiguration({
      PUBLIC_ORIGIN: baseUrl,
      STRIPE_SECRET_KEY: PROVIDER_SECRET,
      STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
      STRIPE_API_VERSION: API_VERSION,
      STRIPE_PRICE_STARTER: 'price_starter_synthetic',
      STRIPE_PRICE_PROFESSIONAL: 'price_professional_synthetic',
      STRIPE_PRICE_ENTERPRISE: 'price_enterprise_synthetic',
      STRIPE_PAYMENT_METHOD_CONFIGURATION_ID: 'pmc_synthetic',
      STRIPE_BILLING_PORTAL_CONFIGURATION_ID: 'bpc_synthetic',
      STRIPE_AUTOMATIC_TAX_ENABLED: 'true',
      STRIPE_TAX_ID_COLLECTION_ENABLED: 'true',
    }, { allowLoopback: true });
    assert.ok(configuration, 'synthetic fail-closed billing configuration');
    const providerCalls = [];
    const provider = new StripeProvider(configuration, {
      now: () => NOW,
      timeoutMs: 2000,
      fetchImpl: async (url, options) => {
        assert.strictEqual(new URL(url).origin, 'https://api.stripe.com');
        const form = new URLSearchParams(options.body);
        if (url.endsWith('/v1/checkout/sessions')) {
          const suffix = form.get('client_reference_id').replace(/-/g, '').slice(0, 16);
          providerCalls.push({
            intercepted: true, kind: 'checkout',
            organizationId: form.get('client_reference_id'),
            planKey: form.get('metadata[northstar_plan_key]'),
            amountCents: configuration.plans[form.get('metadata[northstar_plan_key]')].monthlyAmountCents,
          });
          return new Response(JSON.stringify({
            id: `cs_browser_${suffix}`,
            url: `https://checkout.stripe.com/c/pay/browser-${suffix}`,
            expires_at: Number(form.get('expires_at')),
          }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (url.endsWith('/v1/billing_portal/sessions')) {
          providerCalls.push({ intercepted: true, kind: 'portal' });
          return new Response(JSON.stringify({
            id: `bps_browser_${crypto.randomBytes(8).toString('hex')}`,
            url: 'https://billing.stripe.com/p/session/browser-synthetic',
          }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (url.includes('/v1/subscriptions/')) {
          const subscriptionId = decodeURIComponent(new URL(url).pathname.split('/').at(-1));
          providerCalls.push({ intercepted: true, kind: 'cancel' });
          return new Response(JSON.stringify({ id: subscriptionId, cancel_at_period_end: true }), {
            status: 200, headers: { 'content-type': 'application/json' },
          });
        }
        throw new Error('Unexpected intercepted provider destination');
      },
    });
    const billingService = new BillingService({
      configuration, provider, repository: billingRepository, now: () => NOW,
    });
    const capture = { messages: [], async send(message) {
      this.messages.push(JSON.parse(JSON.stringify(message)));
      return { accepted: true };
    } };
    const app = require('../helpers/account-test-app').createDisposableAccountApp({
      repository, billingService, emailCapture: capture, publicOrigin: baseUrl,
    });
    server = app.listen(port, '127.0.0.1');
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const state = { baseUrl, capture, pool, providerCalls };
    const journeys = [];
    for (const engine of engines) {
      const runtime = resolveBrowserRuntime(engine);
      for (const viewport of VIEWPORTS) journeys.push(await runJourney({ engine, runtime }, viewport, state));
    }
    console.log(JSON.stringify({
      browser: selection,
      physicalSafari: false,
      viewports: VIEWPORTS.map(item => item.label),
      providerAccountReadiness: 'unavailable',
      liveProviderTraffic: false,
      journeys,
    }));
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (db) await db.close();
    await allocation.cleanup();
    if (prior.database === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = prior.database;
    if (prior.secret === undefined) delete process.env.AUTH_ACCESS_SECRET; else process.env.AUTH_ACCESS_SECRET = prior.secret;
  }
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
