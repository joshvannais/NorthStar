'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');

const PLAYWRIGHT = 'C:/Users/joshv/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const WEBKIT = 'C:/Users/joshv/AppData/Local/Temp/NorthStar-PR66-dbf3b553-WebKit-1.61.1/webkit-2311/Playwright.exe';

async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  return server;
}

async function main() {
  if (!process.env.M19_PG_ADMIN_URL) throw new Error('Disposable PostgreSQL 18 identity is required');
  if (!fs.existsSync(CHROME) || !fs.existsSync(WEBKIT)) throw new Error('Chrome and physical Playwright WebKit executables are required');
  const { chromium, webkit } = require(PLAYWRIGHT);
  const allocation = await createSuiteDatabase('account-browser');
  const originals = {};
  for (const key of ['DATABASE_URL', 'AUTH_ACCESS_SECRET', 'ACCOUNT_SIGNUP_ENABLED', 'ACCOUNT_VERIFICATION_DELIVERY_READY', 'NODE_ENV']) {
    originals[key] = process.env[key];
  }
  process.env.DATABASE_URL = allocation.connectionString;
  process.env.AUTH_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');
  process.env.ACCOUNT_SIGNUP_ENABLED = 'true';
  process.env.ACCOUNT_VERIFICATION_DELIVERY_READY = 'false';
  process.env.NODE_ENV = 'test';

  let db;
  let server;
  const browsers = [];
  try {
    db = require('../../src/db');
    assert.strictEqual(await db.initDatabase(), true);
    const { app } = require('../../src/server');
    const { putBusinessProfile } = require('../../src/services/organizationAuthority');
    server = await listen(app);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const pool = db.getPool();

    async function apiSignup(email) {
      await pool.query("DELETE FROM auth_rate_limits WHERE event_type = 'signup_ip'");
      const response = await request(app).post('/api/auth/signup').send({
        name: 'Browser Owner', businessName: `Browser ${email}`, phone: '8605550199',
        email, password: 'browser password 123',
      });
      assert.strictEqual(response.status, 201);
      return response;
    }

    await apiSignup('browser-active@example.test');
    const active = await pool.query("SELECT id, organization_id FROM users WHERE email_normalized = 'browser-active@example.test'");
    await pool.query("UPDATE users SET status = 'active' WHERE id = $1", [active.rows[0].id]);
    await putBusinessProfile(pool, {
      organizationId: active.rows[0].organization_id,
      userId: active.rows[0].id,
      profile: canonicalFenceProfile({ companyName: 'Browser Active Company' }),
    });

    async function assertNoBrowserAuthority(page) {
      const stored = await page.evaluate(() => ({
        local: Object.keys(localStorage),
        session: Object.keys(sessionStorage),
      }));
      const forbidden = stored.local.concat(stored.session).filter(key => /token|auth|user|organization|orgid|role|credential/i.test(key));
      assert.deepStrictEqual(forbidden, []);
    }

    async function exercise(browserType, executablePath, viewport, label) {
      const browser = await browserType.launch({ executablePath, headless: true });
      browsers.push(browser);
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));

      await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });
      await page.fill('#email', 'BROWSER-ACTIVE@EXAMPLE.TEST');
      await page.fill('#password', 'browser password 123');
      await Promise.all([
        page.waitForURL(url => url.pathname === '/dashboard'),
        page.click('#loginForm button[type=submit]'),
      ]);
      await page.waitForLoadState('networkidle');
      assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${label} dashboard overflow`);
      await assertNoBrowserAuthority(page);

      const state = await context.storageState();
      await pool.query(
        `UPDATE auth_sessions SET access_expires_at = NOW() - INTERVAL '1 minute'
          WHERE user_id = $1 AND status = 'active'`,
        [active.rows[0].id]
      );
      await context.close();

      const restarted = await browser.newContext({ viewport, storageState: state });
      const restartedPage = await restarted.newPage();
      restartedPage.on('pageerror', error => errors.push(error.message));
      await restartedPage.goto(`${baseUrl}/dashboard`, { waitUntil: 'domcontentloaded' });
      await restartedPage.waitForFunction(() => (
        window.NorthStarAccountSession && window.NorthStarAccountSession.getAccount() !== null
      ));
      assert.strictEqual(new URL(restartedPage.url()).pathname, '/dashboard');
      const refreshed = await pool.query(
        'SELECT access_expires_at > NOW() AS refreshed FROM auth_sessions WHERE user_id = $1 AND status = $2',
        [active.rows[0].id, 'active']
      );
      assert.strictEqual(refreshed.rows.some(row => row.refreshed), true, `${label} restart did not refresh`);
      await assertNoBrowserAuthority(restartedPage);
      assert.deepStrictEqual(errors, [], `${label} page errors`);
      await restarted.close();
    }

    for (const [label, browserType, executablePath] of [
      ['chrome', chromium, CHROME], ['webkit', webkit, WEBKIT],
    ]) {
      await exercise(browserType, executablePath, { width: 1440, height: 900 }, `${label}-desktop`);
      await exercise(browserType, executablePath, { width: 390, height: 844 }, `${label}-mobile`);
    }

    const pendingBrowser = await chromium.launch({ executablePath: CHROME, headless: true });
    browsers.push(pendingBrowser);
    const pendingContext = await pendingBrowser.newContext({ viewport: { width: 390, height: 844 } });
    const pendingPage = await pendingContext.newPage();
    await pendingPage.goto(`${baseUrl}/signup`);
    await pendingPage.fill('#name', 'Pending Owner');
    await pendingPage.fill('#businessName', 'Pending Browser Company');
    await pendingPage.fill('#phone', '8605550123');
    await pendingPage.fill('#email', 'pending-browser@example.test');
    await pendingPage.fill('#password', 'pending password 123');
    await Promise.all([
      pendingPage.waitForURL(url => url.pathname === '/account/pending'),
      pendingPage.click('#signupForm button[type=submit]'),
    ]);
    assert.strictEqual(await pendingPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await assertNoBrowserAuthority(pendingPage);
    await pendingContext.close();

    console.log('Account Lifecycle browser matrix passed: Chrome + WebKit at 1440x900 and 390x844');
  } finally {
    for (const browser of browsers.reverse()) await browser.close().catch(() => {});
    if (server) await new Promise(resolve => server.close(resolve));
    if (db) await db.close();
    await allocation.cleanup();
    Object.entries(originals).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
