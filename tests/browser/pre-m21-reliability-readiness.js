'use strict';

const assert = require('assert');
const express = require('express');
const path = require('path');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');
const { buildDemoWorkspace, createInitialDemoState } = require('../../src/commandCenter/workspace');

const browserName = process.env.NORTHSTAR_BROWSER || 'chrome';
const publicRoot = path.resolve(__dirname, '..', '..', 'public');

async function run() {
  const createdAt = new Date('2026-08-21T12:00:00.000Z');
  const tenantId = '00000000-0000-4000-8000-000000000021';
  const workspace = buildDemoWorkspace({
    tenantId,
    sessionId: '00000000-0000-4000-8000-000000000022',
    state: createInitialDemoState(tenantId, createdAt),
    revision: 1,
    expiresAt: new Date('2026-08-22T12:00:00.000Z'),
    simulationCount: 0,
    persisted: true,
  });
  const app = express();
  app.use(express.json());
  app.use('/css', express.static(path.join(publicRoot, 'css')));
  app.use('/js', express.static(path.join(publicRoot, 'js')));
  app.use('/assets', express.static(path.join(publicRoot, 'assets')));
  app.get('/', (_req, res) => {
    res.sendFile(path.join(publicRoot, 'index.html'));
  });
  app.get('/demo', (_req, res) => {
    res.sendFile(path.join(publicRoot, 'demo-dashboard.html'));
  });
  app.get('/demo/business-profile', (_req, res) => {
    res.sendFile(path.join(publicRoot, 'dashboard', 'business-profile.html'));
  });
  app.get('/demo/team', (_req, res) => {
    res.sendFile(path.join(publicRoot, 'dashboard', 'team.html'));
  });
  app.get('/demo/polaris', (_req, res) => {
    res.sendFile(path.join(publicRoot, 'dashboard', 'polaris.html'));
  });
  app.get('/api/demo/command-center', (_req, res) => res.json({ success: true, data: workspace }));
  app.post('/api/telemetry', (_req, res) => res.sendStatus(204));
  app.use((_req, res) => res.status(404).json({ error: 'browser-readiness-fixture' }));

  const server = await new Promise((resolve, reject) => {
    const candidate = app.listen(0, '127.0.0.1', () => resolve(candidate));
    candidate.on('error', reject);
  });
  const port = server.address().port;
  const { browserType, executablePath } = resolveBrowserRuntime(browserName);
  const browser = await browserType.launch({ executablePath, headless: true });

  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`http://127.0.0.1:${port}/demo/business-profile`, {
      waitUntil: 'domcontentloaded',
    });
    const search = page.getByLabel('Find a setup section');
    await search.fill('knowledge');
    await page.waitForTimeout(100);
    const visibleTabs = await page.locator('.bp-nav-btn').evaluateAll(tabs => tabs
      .filter(tab => !tab.hidden)
      .map(tab => tab.textContent.trim()));
    assert.strictEqual(visibleTabs.length, 1);
    assert.match(visibleTabs[0], /Voice & Knowledge/);
    assert.match(await page.locator('#businessProfileSectionSearchStatus').innerText(), /1 matching section/i);
    await search.fill('');
    await assert.doesNotReject(() => page.waitForFunction(() => {
      return Array.from(document.querySelectorAll('.bp-nav-btn')).every(tab => !tab.hidden);
    }));

    await page.goto(`http://127.0.0.1:${port}/demo/team`, {
      waitUntil: 'domcontentloaded',
    });
    await page.locator('#membersList .wf-summary').first().waitFor({ state: 'visible' });
    const teamSummary = await page.locator('#membersList').evaluate(node => ({
      summaryCount: node.querySelectorAll('.wf-summary').length,
      controls: node.querySelectorAll('input, select, textarea').length,
      text: node.textContent,
    }));
    assert.ok(teamSummary.summaryCount > 0);
    assert.strictEqual(teamSummary.controls, 0,
      'demo summaries must not masquerade as disabled editors');
    assert.match(teamSummary.text, /Job role/i);
    assert.match(teamSummary.text, /Skills/i);

    await page.goto(`http://127.0.0.1:${port}/`, {
      waitUntil: 'domcontentloaded',
    });
    await page.locator('[data-northstar-site-footer]').waitFor({ state: 'visible' });
    const homepageGeometry = await page.evaluate(() => {
      const rect = selector => {
        const value = document.querySelector(selector).getBoundingClientRect();
        return { left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width };
      };
      const banner = rect('.demo-banner');
      const toggle = rect('[data-northstar-theme-toggle]');
      const feature = rect('#features .card');
      const step = rect('#how-it-works .step');
      const pricing = rect('#pricing .pricing-card');
      return {
        toggleClearance: toggle.top - banner.bottom,
        cards: [feature, step, pricing],
      };
    });
    assert.ok(homepageGeometry.toggleClearance >= 7,
      `mobile theme toggle needs breathing room below the demo banner: ${homepageGeometry.toggleClearance}`);
    const cardLefts = homepageGeometry.cards.map(card => card.left);
    const cardRights = homepageGeometry.cards.map(card => card.right);
    assert.ok(Math.max(...cardLefts) - Math.min(...cardLefts) <= 1,
      `homepage card left edges must align: ${JSON.stringify(homepageGeometry.cards)}`);
    assert.ok(Math.max(...cardRights) - Math.min(...cardRights) <= 1,
      `homepage card right edges must align: ${JSON.stringify(homepageGeometry.cards)}`);
    const footerLabels = await page.locator('[data-northstar-site-footer] .footer-links a').allTextContents();
    assert.deepStrictEqual(footerLabels, ['Home', 'How It Works', 'Pricing', 'FAQ', 'Contact', 'Privacy', 'Terms', 'Refunds', 'Legal']);

    await page.goto(`http://127.0.0.1:${port}/demo/polaris`, {
      waitUntil: 'domcontentloaded',
    });
    assert.strictEqual(await page.locator('#recentActivitySection').count(), 0);
    assert.strictEqual(await page.locator('#pinnedInsightsSection').count(), 0);
    assert.strictEqual(await page.locator('#suggestionsSection').count(), 0);
    assert.strictEqual(await page.getByRole('heading', { name: 'Polaris Intelligence Workspace' }).count(), 1);

    console.log(JSON.stringify({
      browser: browserName,
      businessProfileSearch: 'pass',
      teamDemoSummaries: 'pass',
      homepageSharedWidths: 'pass',
      homepageMobileHeaderClearance: 'pass',
      sharedFooter: 'pass',
      polarisPlaceholderCleanup: 'pass',
    }));
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
