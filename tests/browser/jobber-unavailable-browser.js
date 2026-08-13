'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');
const { provisionDurableSession } = require('../helpers/account-session-fixture');

const ORG_ID = '8f000000-0000-4000-8000-000000000001';
const OWNER_ID = '8f000000-0000-4000-8000-000000000002';
const VIEWPORTS = Object.freeze([
  Object.freeze({ label: '1440x900', width: 1440, height: 900 }),
  Object.freeze({ label: '390x844', width: 390, height: 844 }),
]);
const PROVIDER_ENVIRONMENT = Object.freeze([
  'RETELL_API_KEY', 'RETELL_AGENT_ID', 'RETELL_PHONE_NUMBER', 'RETELL_WEBHOOK_SECRET',
  'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN',
  'TWILIO_PHONE_NUMBER', 'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS',
  'JOBBER_CLIENT_ID', 'JOBBER_CLIENT_SECRET', 'JOBBER_INTEGRATION_ENABLED',
  'JOBBER_OAUTH_ENABLED', 'JOBBER_TOKEN_PERSISTENCE_ENABLED',
]);

async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  return server;
}

async function closeServer(server) {
  if (!server) return;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

async function persistedDigest(pool) {
  const ownership = await pool.query(
    `SELECT organization_id, id, provider, external_integration_id, status, metadata
       FROM canonical_integration_ownership
      ORDER BY organization_id, id`
  );
  const oauth = await pool.query(
    `SELECT id, organization_id, user_id, auth_session_id, provider, state_hash, status
       FROM oauth_authorization_states
      ORDER BY id`
  );
  const profiles = await pool.query(
    `SELECT organization_id, id, version_number, is_active, raw_profile
       FROM canonical_business_profiles
      ORDER BY organization_id, id`
  );
  return crypto.createHash('sha256')
    .update(JSON.stringify({ ownership: ownership.rows, oauth: oauth.rows, profiles: profiles.rows }))
    .digest('hex');
}

async function exerciseViewport(browser, origin, session, viewport, evidence) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(() => {
    window.__jobberBrowserPoison = '<img src=x onerror=window.__jobberXss=1>';
    window.__jobberXss = 0;
    localStorage.setItem('northstar-theme', 'dark');
    localStorage.setItem('jobber', 'connected');
    sessionStorage.setItem('jobber_status', 'connected');
  });
  await context.addCookies([
    { name: 'northstar_access', value: session.accessToken, url: origin, httpOnly: true, sameSite: 'Lax' },
    { name: 'northstar_csrf', value: session.csrfToken, url: origin, httpOnly: false, sameSite: 'Lax' },
  ]);
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    if (['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) {
      return route.fulfill({
        status: 200,
        contentType: url.hostname === 'fonts.googleapis.com' ? 'text/css' : 'font/woff2',
        body: '',
      });
    }
    evidence.external.push({ method: route.request().method(), url: route.request().url() });
    return route.fulfill({ status: 204, body: '' });
  });
  context.on('request', request => {
    const url = new URL(request.url());
    if (url.origin !== origin) return;
    evidence.local.push({ method: request.method(), path: url.pathname, authorization: request.headers().authorization || null });
  });

  const page = await context.newPage();
  const label = viewport.label;
  page.on('pageerror', error => evidence.pageErrors.push(label + ': ' + (error.stack || error.message)));
  page.on('console', message => {
    if (message.type() === 'error') evidence.consoleErrors.push(label + ': ' + message.text());
  });
  try {
    const response = await page.goto(
      origin + '/dashboard/integrations?jobber=connected&provider=jobber&status=connected#connected',
      { waitUntil: 'domcontentloaded' }
    );
    assert.strictEqual(response.status(), 200, label + ': mounted integrations page');
    await page.waitForFunction(() => document.getElementById('integrationCatalogueRoot')?.dataset.state === 'ready');

    const assertTruthful = async phase => {
      const projection = await page.evaluate(() => ({
        jobberState: document.getElementById('integration-provider-jobber-status')?.dataset.status,
        jobberLabel: document.getElementById('integration-provider-jobber-status')?.textContent.trim(),
        retellState: document.getElementById('integration-provider-retell-status')?.dataset.status,
        providerCards: document.querySelectorAll('[data-provider-key]').length,
        jobberCards: document.querySelectorAll('[data-provider-key="jobber"]').length,
        providerActions: document.querySelectorAll('[data-provider-key] button,[data-provider-key] a[href],form').length,
        oauthLinks: document.querySelectorAll('a[href*="jobber"],a[href*="oauth"],a[href*="callback"]').length,
        poisonVisible: document.body.textContent.includes(window.__jobberBrowserPoison),
        xss: window.__jobberXss,
        query: location.search,
        hash: location.hash,
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      }));
      assert.deepStrictEqual(
        [projection.jobberState, projection.jobberLabel],
        ['coming_soon', 'Coming soon'],
        `${label}/${phase}: source-disabled Jobber remains server-authoritative`
      );
      assert.strictEqual(projection.retellState, 'requires_provider_approval', `${label}/${phase}: missing authority fails closed`);
      assert.strictEqual(projection.providerCards, 26, `${label}/${phase}: exact provider inventory`);
      assert.strictEqual(projection.jobberCards, 1, `${label}/${phase}: Jobber is reconciled once`);
      assert.strictEqual(projection.providerActions, 0, `${label}/${phase}: no provider management controls`);
      assert.strictEqual(projection.oauthLinks, 0, `${label}/${phase}: no OAuth destination`);
      assert.strictEqual(projection.poisonVisible, false, `${label}/${phase}: browser poison is not rendered`);
      assert.strictEqual(projection.xss, 0, `${label}/${phase}: browser poison does not execute`);
      assert.match(projection.query, /jobber=connected/, `${label}/${phase}: forged query is inert input, not status`);
      assert.strictEqual(projection.hash, '#connected', `${label}/${phase}: forged fragment is inert`);
      assert.strictEqual(projection.overflow, false, `${label}/${phase}: no responsive overflow`);
    };

    await assertTruthful('initial');
    await page.evaluate(() => {
      document.documentElement.dataset.jobberStatus = 'connected';
      document.body.dataset.provider = 'jobber';
      window.jobberConnected = true;
    });
    await page.evaluate(() => window.NorthStarIntegrations.reload());
    await page.waitForFunction(() => document.getElementById('integrationCatalogueRoot')?.dataset.state === 'ready');
    await assertTruthful('rerender');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.getElementById('integrationCatalogueRoot')?.dataset.state === 'ready');
    await assertTruthful('reload');
  } finally {
    await context.close();
  }
}

async function main() {
  if (!process.env.M19_PG_ADMIN_URL) throw new Error('Disposable PostgreSQL 18 identity is required');
  const selection = String(process.env.NORTHSTAR_BROWSER || 'both').toLowerCase();
  assert.ok(['chrome', 'webkit', 'both'].includes(selection), 'NORTHSTAR_BROWSER must be chrome, webkit, or both');
  const engines = selection === 'both' ? ['chrome', 'webkit'] : [selection];
  const original = new Map();
  for (const key of ['DATABASE_URL', 'AUTH_ACCESS_SECRET', ...PROVIDER_ENVIRONMENT]) original.set(key, process.env[key]);
  const suiteDatabase = await createSuiteDatabase('jobber-catalogue');
  let db;
  let server;
  const launched = [];
  const evidence = { local: [], external: [], pageErrors: [], consoleErrors: [] };
  const versions = {};
  try {
    process.env.DATABASE_URL = suiteDatabase.connectionString;
    process.env.AUTH_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');
    for (const key of PROVIDER_ENVIRONMENT) delete process.env[key];
    db = require('../../src/db');
    assert.strictEqual(await db.initDatabase(), true, 'disposable PostgreSQL initializes');
    const pool = db.getPool();
    const postgres = await pool.query(
      `SELECT current_setting('server_version') AS version,
              current_setting('TimeZone') AS timezone,
              current_setting('data_checksums') AS checksums`
    );
    assert.match(postgres.rows[0].version, /^18\./);
    assert.strictEqual(postgres.rows[0].timezone, 'UTC');
    assert.strictEqual(postgres.rows[0].checksums, 'on');
    await pool.query(
      `INSERT INTO organizations (id, name, email)
       VALUES ($1, 'Jobber Catalogue Tenant', 'jobber-catalogue@example.test')`,
      [ORG_ID]
    );
    await pool.query(
      `INSERT INTO users (id, organization_id, name, email, password_hash, role, status)
       VALUES ($1, $2, 'Jobber Catalogue Owner', 'jobber-owner@example.test', 'not-used', 'owner', 'active')`,
      [OWNER_ID, ORG_ID]
    );
    const { putBusinessProfile } = require('../../src/services/organizationAuthority');
    await putBusinessProfile(pool, {
      organizationId: ORG_ID,
      userId: OWNER_ID,
      expectedVersion: null,
      profile: canonicalFenceProfile({ companyName: 'Jobber Catalogue Tenant' }),
    });
    const session = await provisionDurableSession(pool, { userId: OWNER_ID, organizationId: ORG_ID, role: 'owner' });
    const before = await persistedDigest(pool);

    const { app } = require('../../src/server');
    server = await listen(app);
    const origin = 'http://127.0.0.1:' + server.address().port;
    for (const engine of engines) {
      const runtime = resolveBrowserRuntime(engine);
      const browser = await runtime.browserType.launch({ executablePath: runtime.executablePath, headless: true });
      launched.push(browser);
      versions[engine] = browser.version();
      for (const viewport of VIEWPORTS) await exerciseViewport(browser, origin, session, viewport, evidence);
    }

    assert.deepStrictEqual(evidence.external, [], 'no provider or unexpected external request');
    assert.deepStrictEqual(evidence.pageErrors, [], 'no page errors');
    assert.deepStrictEqual(evidence.consoleErrors, [], 'no console errors');
    assert.ok(evidence.local.every(entry => entry.method === 'GET'), 'browser emits only GET requests');
    assert.ok(evidence.local.every(entry => entry.authorization === null), 'browser emits no bearer authorization');
    assert.strictEqual(evidence.local.some(entry => /\/api\/integrations\/jobber\/(?:status|auth|callback|disconnect)/.test(entry.path)), false,
      'browser emits no provider-specific or OAuth request');
    assert.strictEqual(evidence.local.some(entry => entry.path === '/api/v1/integrations/status'), false,
      'browser does not consume the legacy status route');
    assert.ok(evidence.local.filter(entry => entry.path === '/api/v1/integrations/catalogue').length >= engines.length * VIEWPORTS.length * 3,
      'all forged-state lifecycles consume the server catalogue');
    assert.strictEqual(await persistedDigest(pool), before, 'forged browser state causes no persisted authority or OAuth change');

    console.log('JOBBER_CATALOGUE_BROWSER_EVIDENCE ' + JSON.stringify({
      engines,
      versions,
      postgres: postgres.rows[0],
      viewports: VIEWPORTS.map(value => value.label),
      forgedStates: ['query', 'fragment', 'localStorage', 'sessionStorage', 'DOM dataset', 'window global'],
      jobberPresentation: 'Coming soon',
      providerSpecificRequests: 0,
      oauthRequests: 0,
      nonGetRequests: 0,
      providerExternalRequests: 0,
      persistedDigest: before,
      physicalSafari: false,
    }));
  } finally {
    for (const browser of launched.reverse()) await browser.close().catch(() => {});
    await closeServer(server).catch(() => {});
    if (db && db.getPool()) await db.getPool().end().catch(() => {});
    await suiteDatabase.cleanup();
    for (const [key, value] of original) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
