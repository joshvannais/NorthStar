'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');

const ROUTES = Object.freeze([
  '/', '/faq', '/contact', '/login', '/signup', '/forgot-password',
  '/privacy', '/terms', '/refund', '/legal',
]);
const CANONICAL = route => `https://northstar-os.ai${route === '/' ? '/' : route}`;
const HOSTILE = '<img src=x onerror="globalThis.preM23P2Compromised=true">';

function sha256File(filename) {
  return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}
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
async function assertNoOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    root: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  assert.ok(Math.max(dimensions.body, dimensions.root) <= dimensions.viewport + 1,
    `${label} horizontally overflows: ${JSON.stringify(dimensions)}`);
}
async function assertPublicSemantics(page, route, label) {
  assert.strictEqual(await page.locator('link[rel="canonical"]').getAttribute('href'), CANONICAL(route), `${label} canonical`);
  assert.strictEqual(await page.locator('h1').count(), 1, `${label} requires one h1`);
  assert.ok(await page.locator('h1').isVisible(), `${label} h1 is not visible`);
  for (const href of ['/privacy', '/terms', '/legal']) {
    assert.ok(await page.locator(`footer a[href="${href}"]`).isVisible(), `${label} missing visible ${href} footer link`);
  }
  await assertNoOverflow(page, label);
}
async function assertHomepage(page, label) {
  assert.strictEqual(await page.locator('.demo-banner').count(), 0, `${label} retains redundant banner`);
  assert.ok(await page.locator('a[data-telemetry-action="homepage_explore_demo"]:visible').count());
  assert.ok(await page.locator('a[data-telemetry-action="homepage_start_trial"]:visible').count());
  assert.ok(await page.locator('#demoWebCallPending').isVisible());
  assert.strictEqual(await page.locator('#demoFormCard').isVisible(), false);
  const pendingStyle = await page.locator('#demoWebCallPending').evaluate(node => ({
    textAlign: getComputedStyle(node).textAlign,
    opacity: getComputedStyle(node).opacity,
    filter: getComputedStyle(node).filter,
    left: node.getBoundingClientRect().left,
    right: node.getBoundingClientRect().right,
    viewport: document.documentElement.clientWidth,
  }));
  assert.strictEqual(pendingStyle.textAlign, 'center');
  assert.strictEqual(pendingStyle.opacity, '1');
  assert.strictEqual(pendingStyle.filter, 'none');
  assert.ok(Math.abs(pendingStyle.left - (pendingStyle.viewport - pendingStyle.right)) <= 2, `${label} pending card not centered`);
  const priceFonts = await page.evaluate(() => ({
    price: getComputedStyle(document.querySelector('.pricing-card .price')).fontFamily,
    note: getComputedStyle(document.querySelector('.pricing-card .pricing-note')).fontFamily,
    body: getComputedStyle(document.body).fontFamily,
    truth: getComputedStyle(document.querySelector('.truth-band .stats-bar-value')).fontFamily,
    heading: getComputedStyle(document.querySelector('.section-header h2')).fontFamily,
  }));
  assert.strictEqual(priceFonts.note, priceFonts.body, `${label} pricing note font drift`);
  assert.strictEqual(priceFonts.truth, priceFonts.heading, `${label} truth-band font drift`);
  assert.ok(await page.getByRole('heading', { name: 'Enterprise' }).isVisible());
}
async function assertFocusableFAQ(page) {
  const topic = page.locator('.public-contents-links a').first();
  await topic.focus();
  assert.strictEqual(await topic.evaluate(node => node === document.activeElement), true);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(50);
  assert.strictEqual(new URL(page.url()).hash, '#about-northstar');
}
async function renderRoute(browser, origin, evidenceRoot, entries, fixture) {
  const context = await browser.newContext({ viewport: fixture.viewport, colorScheme: fixture.theme });
  await context.addInitScript(theme => {
    localStorage.setItem('northstar-theme', theme);
    globalThis.preM23P2Compromised = false;
  }, fixture.theme);
  const page = await context.newPage();
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(String(error)));
  await page.route('**/api/demo/homepage/status', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ available: false, state: 'awaiting_approval' }),
  }));
  await page.goto(`${origin}${fixture.route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(250);
  await assertPublicSemantics(page, fixture.route, fixture.label);
  if (fixture.route === '/') await assertHomepage(page, fixture.label);
  if (fixture.route === '/faq') await assertFocusableFAQ(page);
  const toggle = page.locator('[data-northstar-theme-toggle]').first();
  if (await toggle.count()) {
    assert.strictEqual(await toggle.getAttribute('data-current-theme'), fixture.theme);
    await toggle.focus();
    assert.strictEqual(await toggle.evaluate(node => node === document.activeElement), true);
  }
  assert.deepStrictEqual(browserErrors, [], `${fixture.label} page errors`);
  const filename = path.join(evidenceRoot, `${fixture.label}.png`);
  await page.screenshot({ path: filename, fullPage: true });
  entries.push({
    file: path.basename(filename), sha256: sha256File(filename), route: fixture.route,
    browser: fixture.browser, viewport: fixture.viewport, theme: fixture.theme, fixture: 'ordinary-public-route',
  });
  await context.close();
}
async function renderHostileContact(browser, origin, securityRoot, entries, selected) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
  await context.addInitScript(() => { globalThis.preM23P2Compromised = false; });
  const page = await context.newPage();
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(String(error)));
  await page.goto(`${origin}/contact`, { waitUntil: 'domcontentloaded' });
  await page.locator('#contactName').fill(HOSTILE);
  await page.locator('#contactEmail').fill('visitor@example.com');
  await page.locator('#contactTitle').fill(`Bug title ${HOSTILE}`);
  await page.locator('#contactMessage').fill(`Support description ${HOSTILE}`);
  await page.getByRole('button', { name: 'Prepare Email' }).click();
  assert.strictEqual(await page.evaluate(() => globalThis.preM23P2Compromised), false);
  assert.strictEqual(await page.locator('img[src="x"]').count(), 0);
  assert.match(await page.locator('#contactReference').textContent(), /^Email draft NS-DRAFT-[A-Z0-9]+ is ready\./);
  assert.ok((await page.locator('#contactEmailLink').getAttribute('href')).startsWith('mailto:Support@northstar-os.ai?'));
  assert.deepStrictEqual(browserErrors, []);
  const filename = path.join(securityRoot, `${selected}-mobile-dark-hostile-contact.png`);
  await page.screenshot({ path: filename, fullPage: true });
  entries.push({ file: path.basename(filename), sha256: sha256File(filename), route: '/contact', browser: selected,
    viewport: { width: 390, height: 844 }, theme: 'dark', fixture: 'hostile-security' });
  await context.close();
}
async function assertLinksAndRedirect(origin) {
  const legacy = await fetch(`${origin}/demo-dashboard`, { redirect: 'manual' });
  assert.strictEqual(legacy.status, 301);
  assert.strictEqual(legacy.headers.get('location'), '/demo');
  const checked = new Set();
  for (const route of ROUTES) {
    const response = await fetch(`${origin}${route}`);
    assert.strictEqual(response.status, 200, `${route} is not reachable`);
    const html = await response.text();
    for (const match of html.matchAll(/href="([^"#]+)(?:#[^"]*)?"/g)) {
      const href = match[1];
      if (!href.startsWith('/') || href.startsWith('//') || checked.has(href)) continue;
      checked.add(href);
      const linked = await fetch(`${origin}${href}`, { redirect: 'manual' });
      assert.ok(linked.status < 400 || linked.status === 401, `dead internal link ${href}: ${linked.status}`);
    }
  }
}

async function main() {
  const selected = (process.argv.find(value => value.startsWith('--browser=')) || '--browser=chrome').split('=')[1];
  const evidenceRoot = path.resolve(process.env.PRE_M23_P2_EVIDENCE_DIR || 'outputs/pre-m23-p2-visual');
  const securityRoot = path.resolve(process.env.PRE_M23_P2_SECURITY_EVIDENCE_DIR || 'outputs/pre-m23-p2-security');
  const testedRevision = process.env.PRE_M23_P2_TESTED_REVISION || null;
  const testedTree = process.env.PRE_M23_P2_TESTED_TREE || null;
  assert.match(testedRevision || '', /^[0-9a-f]{40}$/);
  assert.match(testedTree || '', /^[0-9a-f]{40}$/);
  assert.notStrictEqual(evidenceRoot, securityRoot);
  fs.mkdirSync(evidenceRoot, { recursive: true });
  fs.mkdirSync(securityRoot, { recursive: true });
  const runtime = resolveBrowserRuntime(selected);
  const { app } = require('../../src/server');
  let server, browser;
  const entries = [], securityEntries = [];
  try {
    server = await listen(app);
    const origin = `http://127.0.0.1:${server.address().port}`;
    await assertLinksAndRedirect(origin);
    browser = await runtime.browserType.launch({ headless: true, executablePath: runtime.executablePath });
    const ordinaryProfiles = selected === 'chrome'
      ? [
          { suffix: 'desktop-light', viewport: { width: 1440, height: 900 }, theme: 'light' },
          { suffix: 'mobile-dark', viewport: { width: 390, height: 844 }, theme: 'dark' },
        ]
      : [
          { suffix: 'desktop-dark', viewport: { width: 1440, height: 900 }, theme: 'dark' },
          { suffix: 'mobile-light', viewport: { width: 390, height: 844 }, theme: 'light' },
        ];
    for (const profile of ordinaryProfiles) {
      for (const route of ROUTES) {
        const slug = route === '/' ? 'home' : route.slice(1);
        await renderRoute(browser, origin, evidenceRoot, entries, {
          browser: selected, route, theme: profile.theme, viewport: profile.viewport,
          label: `${selected}-${profile.suffix}-${slug}`,
        });
      }
    }
    for (const route of ['/', '/faq', '/contact', '/login', '/privacy']) {
      const slug = route === '/' ? 'home' : route.slice(1);
      await renderRoute(browser, origin, evidenceRoot, entries, {
        browser: selected, route, theme: 'light', viewport: { width: 320, height: 720 },
        label: `${selected}-reflow-320-light-${slug}`,
      });
    }
    await renderHostileContact(browser, origin, securityRoot, securityEntries, selected);
    const common = { testedRevision, testedTree, browser: selected, generatedAt: new Date().toISOString() };
    fs.writeFileSync(path.join(evidenceRoot, `${selected}-manifest.json`), JSON.stringify({ ...common, kind: 'ordinary-visual', screenshots: entries }, null, 2) + '\n');
    fs.writeFileSync(path.join(securityRoot, `${selected}-manifest.json`), JSON.stringify({ ...common, kind: 'hostile-security', screenshots: securityEntries }, null, 2) + '\n');
    console.log(JSON.stringify({ browser: selected, ordinaryScreenshots: entries.length, securityScreenshots: securityEntries.length,
      evidenceRoot, securityRoot, testedRevision, testedTree }, null, 2));
  } finally {
    if (browser) await browser.close().catch(() => {});
    await closeServer(server).catch(() => {});
  }
}

main().catch(error => { console.error(error && error.stack || error); process.exitCode = 1; });
