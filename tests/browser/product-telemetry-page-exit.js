'use strict';

const assert = require('assert');
const express = require('express');
const path = require('path');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');

const browserName = process.env.NORTHSTAR_BROWSER || 'webkit';
const navigationCount = Number(process.env.NORTHSTAR_TELEMETRY_NAVIGATIONS || 240);
const publicRoot = path.resolve(__dirname, '..', '..', 'public');
const pendingExitKey = 'northstar:product-telemetry:pending-exit:v1';
const routes = ['/', '/faq', '/demo', '/demo/leads', '/dashboard', '/dashboard/settings'];

function telemetryFixture(route) {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Telemetry ${route}</title></head>
<body data-route="${route}"><main>NorthStar telemetry transport fixture</main>
<script src="/js/product-telemetry.js"></script></body>
</html>`;
}

async function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

async function close(server) {
  return new Promise(resolve => server.close(resolve));
}

async function run() {
  assert.ok(Number.isInteger(navigationCount) && navigationCount >= 12,
    'telemetry navigation count must be an integer of at least 12');

  const accepted = [];
  const app = express();
  app.use(express.json({ limit: '8kb' }));
  app.use('/js', express.static(path.join(publicRoot, 'js')));
  app.get('/favicon.ico', (_req, res) => res.sendStatus(204));
  for (const route of routes) app.get(route, (_req, res) => res.type('html').send(telemetryFixture(route)));
  app.post('/api/telemetry', (req, res) => {
    accepted.push(req.body);
    res.sendStatus(202);
  });
  app.use((_req, res) => res.sendStatus(404));

  const server = await listen(app);
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;
  const runtime = resolveBrowserRuntime(browserName);
  const browser = await runtime.browserType.launch({ executablePath: runtime.executablePath, headless: true });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const pageErrors = [];
    const consoleErrors = [];
    const failedTelemetryRequests = [];
    const transports = [];

    page.on('pageerror', error => pageErrors.push(String(error && error.message || error)));
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('requestfailed', request => {
      if (new URL(request.url()).pathname === '/api/telemetry') {
        failedTelemetryRequests.push(request.failure() && request.failure().errorText || 'request failed');
      }
    });
    await page.exposeFunction('__northstarObserveTelemetryTransport', value => transports.push(value));
    await page.addInitScript(() => {
      localStorage.setItem('northstar_telemetry_consent_v1', 'granted');
      const nativeFetch = window.fetch.bind(window);
      window.fetch = function (input, init) {
        const url = new URL(typeof input === 'string' ? input : input.url, window.location.href);
        if (url.pathname === '/api/telemetry') {
          window.__northstarObserveTelemetryTransport({
            kind: 'fetch',
            keepalive: Boolean(init && init.keepalive),
          });
        }
        return nativeFetch(input, init);
      };
      const nativeBeacon = navigator.sendBeacon && navigator.sendBeacon.bind(navigator);
      if (nativeBeacon) {
        navigator.sendBeacon = function (url, data) {
          const parsed = new URL(url, window.location.href);
          if (parsed.pathname === '/api/telemetry') {
            window.__northstarObserveTelemetryTransport({ kind: 'beacon', keepalive: true });
          }
          return nativeBeacon(url, data);
        };
      }
    });

    for (let index = 0; index < navigationCount; index += 1) {
      const route = routes[index % routes.length];
      await page.goto(origin + route, { waitUntil: 'domcontentloaded' });
      await page.locator('main').waitFor({ state: 'visible' });
    }
    await page.waitForFunction(expected => {
      return window.sessionStorage.getItem(expected) === null;
    }, pendingExitKey);
    await page.waitForTimeout(250);

    const pageViews = accepted.filter(value => value && value.event === 'page_view');
    const pageExits = accepted.filter(value => value && value.event === 'page_exit');
    assert.strictEqual(pageErrors.length, 0, `page errors: ${JSON.stringify(pageErrors)}`);
    assert.strictEqual(consoleErrors.length, 0, `console errors: ${JSON.stringify(consoleErrors)}`);
    assert.strictEqual(failedTelemetryRequests.length, 0,
      `failed telemetry requests: ${JSON.stringify(failedTelemetryRequests)}`);
    assert.strictEqual(pageViews.length, navigationCount, 'every loaded page reports one page view');
    assert.strictEqual(pageExits.length, navigationCount - 1,
      'each completed transition flushes the prior bounded page-exit event');
    assert.ok(transports.length >= pageViews.length + pageExits.length,
      'transport observer recorded every accepted telemetry class');
    assert.ok(transports.every(item => item.kind === 'fetch' && item.keepalive === false),
      `page-exit telemetry must avoid sendBeacon and keepalive: ${JSON.stringify(transports)}`);

    await context.close();

    const optOutCountBefore = accepted.length;
    const optOutContext = await browser.newContext();
    await optOutContext.addInitScript(key => {
      Object.defineProperty(navigator, 'globalPrivacyControl', { configurable: true, get: () => true });
      sessionStorage.setItem(key, JSON.stringify([{
        event: 'page_exit', surface: 'public', routeClass: 'home', action: 'none',
        elapsedBucket: 'under_15s', injected: 'must-not-leave-browser',
      }]));
    }, pendingExitKey);
    const optOutPage = await optOutContext.newPage();
    await optOutPage.goto(origin + '/', { waitUntil: 'domcontentloaded' });
    await optOutPage.waitForTimeout(100);
    assert.strictEqual(accepted.length, optOutCountBefore, 'GPC opt-out sends no telemetry');
    assert.strictEqual(await optOutPage.evaluate(key => sessionStorage.getItem(key), pendingExitKey), null,
      'GPC opt-out clears pending telemetry');
    await optOutContext.close();

    console.log(JSON.stringify({
      browser: browserName,
      navigationCount,
      pageViews: pageViews.length,
      pageExits: pageExits.length,
      transportCount: transports.length,
      pageErrors,
      consoleErrors,
      failedTelemetryRequests,
      privacyOptOut: 'pass',
    }));
  } finally {
    await browser.close();
    await close(server);
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
