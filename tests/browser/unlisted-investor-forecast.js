'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

[
  'DATABASE_URL', 'RETELL_API_KEY', 'RETELL_AGENT_ID', 'RETELL_PHONE_NUMBER',
  'RETELL_WEBHOOK_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
  'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER',
  'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS',
].forEach(name => { delete process.env[name]; });
process.env.NODE_ENV = 'test';
process.env.AUTH_ACCESS_SECRET = 'investor-forecast-browser-secret-'.padEnd(64, 'x');

const ROOT = process.env.NORTHSTAR_TARGET_ROOT
  ? path.resolve(process.env.NORTHSTAR_TARGET_ROOT)
  : path.resolve(__dirname, '..', '..');
if (process.env.NORTHSTAR_KEEP_PROCESS_CWD !== '1') process.chdir(ROOT);
const fromRoot = relative => require(path.join(ROOT, relative));
const { resolveBrowserRuntime } = fromRoot('tests/helpers/playwright-runtime');
const { app } = fromRoot('src/server');

const selected = process.argv[2] || 'chrome';
const screenshotDir = process.env.INVESTOR_FORECAST_SCREENSHOT_DIR
  ? path.resolve(process.env.INVESTOR_FORECAST_SCREENSHOT_DIR)
  : path.join(ROOT, 'outputs', 'unlisted-investor-forecast-writer', 'screenshots');

const CASES = Object.freeze([
  Object.freeze({ label: 'desktop-light', width: 1440, height: 1000, colorScheme: 'light' }),
  Object.freeze({ label: 'desktop-dark-preference', width: 1440, height: 1000, colorScheme: 'dark' }),
  Object.freeze({ label: 'mobile-light', width: 390, height: 844, colorScheme: 'light' }),
  Object.freeze({ label: 'mobile-dark-preference', width: 390, height: 844, colorScheme: 'dark' }),
]);

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

async function main() {
  const { browserType, executablePath } = resolveBrowserRuntime(selected);
  fs.mkdirSync(screenshotDir, { recursive: true });
  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.once('error', reject);
  });
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  let browser = null;
  const results = [];
  try {
    browser = await browserType.launch({
      headless: true,
      executablePath,
      args: selected === 'chrome' ? ['--no-sandbox'] : [],
    });
    for (const testCase of CASES) {
      const context = await browser.newContext({
        viewport: { width: testCase.width, height: testCase.height },
        colorScheme: testCase.colorScheme,
      });
      const page = await context.newPage();
      const consoleErrors = [];
      const pageErrors = [];
      const requestFailures = [];
      const externalRequests = [];
      page.on('console', message => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
      page.on('pageerror', error => pageErrors.push(error.message));
      page.on('requestfailed', request => requestFailures.push({
        url: request.url(),
        failure: request.failure()?.errorText || 'unknown',
      }));
      page.on('request', request => {
        const url = request.url();
        if (!url.startsWith(origin) && !url.startsWith('blob:') && !url.startsWith('data:')) {
          externalRequests.push(url);
        }
      });

      const response = await page.goto(`${origin}/investor/forecast`, {
        waitUntil: 'load',
        timeout: 120000,
      });
      assert.strictEqual(response.status(), 200, `${testCase.label}: route status`);
      assert.strictEqual(
        response.headers()['x-robots-tag'],
        'noindex, nofollow, noarchive, nosnippet',
        `${testCase.label}: response noindex`
      );
      assert.match(
        response.headers()['cache-control'] || '',
        /(?:^|,\s*)no-transform(?:,|$)/,
        `${testCase.label}: intermediary transformation is forbidden`
      );
      await page.waitForFunction(() => (
        window.currentNorthStarInvestorResult
        && window.currentNorthStarInvestorResult.rows
        && window.currentNorthStarInvestorResult.rows.length === 120
      ), null, { timeout: 120000 });

      const initial = await page.evaluate(() => {
        const visible = element => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          let ancestor = element.parentElement;
          while (ancestor) {
            if (ancestor.tagName === 'DETAILS' && !ancestor.open) {
              const summary = ancestor.querySelector(':scope > summary');
              if (!summary || !summary.contains(element)) return false;
            }
            ancestor = ancestor.parentElement;
          }
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };
        const viewportWidth = document.documentElement.clientWidth;
        const pageOverflow = document.documentElement.scrollWidth - viewportWidth;
        const contained = Array.from(document.querySelectorAll(
          '.status-pill, .provenance-badge, .suffix, #projectionStartDate'
        )).filter(visible).map(element => {
          const rect = element.getBoundingClientRect();
          const parentRect = element.parentElement ? element.parentElement.getBoundingClientRect() : rect;
          return {
            tag: element.tagName,
            id: element.id,
            className: element.className,
            leftViewport: rect.left >= -1,
            rightViewport: rect.right <= viewportWidth + 1,
            leftParent: rect.left >= parentRect.left - 1,
            rightParent: rect.right <= parentRect.right + 1,
          };
        });
        return {
          title: document.title,
          metaRobots: document.querySelector('meta[name="robots"]')?.content,
          rows: window.currentNorthStarInvestorResult.rows.length,
          annualDataRows: window.currentNorthStarInvestorResult.annualSummary.length,
          annualDomRows: document.querySelectorAll('#annualRows > tr').length,
          monthlyYearGroups: document.querySelectorAll('#monthlyYearGroups > details.year-group').length,
          monthlyDomRows: document.querySelectorAll('#monthlyYearGroups > details.year-group tbody > tr').length,
          pageOverflow,
          dateOverflow: document.querySelector('#projectionStartDate').scrollWidth
            - document.querySelector('#projectionStartDate').clientWidth,
          suffixOverflows: Array.from(document.querySelectorAll('.suffix')).filter(visible)
            .map(element => element.scrollWidth - element.clientWidth),
          contained,
          computedColorScheme: getComputedStyle(document.documentElement).colorScheme,
        };
      });
      assert.strictEqual(initial.title, 'Northstar Investment Calculator', `${testCase.label}: title`);
      assert.strictEqual(initial.metaRobots, 'noindex,nofollow,noarchive,nosnippet', `${testCase.label}: meta noindex`);
      assert.strictEqual(initial.rows, 120, `${testCase.label}: 120 calculation rows`);
      assert.strictEqual(initial.annualDataRows, 10, `${testCase.label}: 10 annual calculation rows`);
      assert.strictEqual(initial.annualDomRows, 10, `${testCase.label}: 10 annual table rows`);
      assert.strictEqual(initial.monthlyYearGroups, 10, `${testCase.label}: 10 monthly year groups`);
      assert.strictEqual(initial.monthlyDomRows, 120, `${testCase.label}: 120 monthly table rows`);
      assert.ok(initial.pageOverflow <= 1, `${testCase.label}: no page-level horizontal overflow (${initial.pageOverflow}px)`);
      assert.ok(initial.dateOverflow <= 1, `${testCase.label}: date control content fits (${initial.dateOverflow}px)`);
      assert.ok(initial.suffixOverflows.every(value => value <= 1), `${testCase.label}: suffix controls fit`);
      const escaped = initial.contained.filter(item => (
        !item.leftViewport || !item.rightViewport || !item.leftParent || !item.rightParent
      ));
      assert.strictEqual(escaped.length, 0,
        `${testCase.label}: visible date, pill, and suffix bounds: ${JSON.stringify(escaped.slice(0, 10))}`);
      assert.strictEqual(initial.computedColorScheme, 'light', `${testCase.label}: canonical calculator supports light mode only`);

      const explore = page.locator('#exploreDetails');
      assert.strictEqual(await explore.getAttribute('open'), null, `${testCase.label}: detail hub starts collapsed`);
      await explore.locator(':scope > summary').click();
      assert.ok(await explore.getAttribute('open') !== null, `${testCase.label}: detail hub expands`);
      for (const detailId of ['annualDetails', 'monthlyDetails', 'teamDetails']) {
        const detail = page.locator(`#${detailId}`);
        assert.strictEqual(await detail.getAttribute('open'), null, `${testCase.label}: ${detailId} starts collapsed`);
        await detail.locator(':scope > summary').click();
        assert.ok(await detail.getAttribute('open') !== null, `${testCase.label}: ${detailId} expands`);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(overflow <= 1, `${testCase.label}: ${detailId} does not cause page overflow`);
        await detail.locator(':scope > summary').click();
        assert.strictEqual(await detail.getAttribute('open'), null, `${testCase.label}: ${detailId} collapses`);
      }
      let blobWorkerSimulation = 'not-run';
      if (testCase.label === 'desktop-light') {
        const uncertainty = page.locator('#uncertaintyDetails');
        await uncertainty.locator(':scope > summary').click();
        await page.locator('[data-path="uncertainty.iterations"]').fill('1');
        await page.locator('#runSimulation').click();
        await page.waitForFunction(() => document.querySelector('#exportSimulation')?.disabled === false,
          null, { timeout: 120000 });
        const simulationText = await page.locator('#simulationResults').innerText();
        assert.match(simulationText, /Seed 32026 · 1 iteration/,
          `${testCase.label}: blob-backed worker completed one seeded iteration: ${JSON.stringify(simulationText)}`);
        blobWorkerSimulation = 'completed-1-seeded-iteration';
        await uncertainty.locator(':scope > summary').click();
      }
      await explore.locator(':scope > summary').click();
      assert.strictEqual(await explore.getAttribute('open'), null, `${testCase.label}: detail hub collapses`);

      await page.locator('#investmentAmount').fill('25001');
      await page.locator('#recalculate').click();
      await page.waitForFunction(() => document.querySelector('#investmentAmount')?.value === '25001'
        && window.currentNorthStarInvestorResult?.summary?.startingOperatingCash === 25001, null, { timeout: 120000 });
      const recalculated = await page.evaluate(() => ({
        rows: window.currentNorthStarInvestorResult.rows.length,
        annualRows: window.currentNorthStarInvestorResult.annualSummary.length,
        startingOperatingCash: window.currentNorthStarInvestorResult.summary.startingOperatingCash,
        validationVisible: document.querySelector('#validationSummary').classList.contains('show'),
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }));
      assert.deepStrictEqual(recalculated, {
        rows: 120,
        annualRows: 10,
        startingOperatingCash: 25001,
        validationVisible: false,
        pageOverflow: 0,
      }, `${testCase.label}: recalculate preserves the 120-month connected forecast`);

      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(100);
      const screenshot = path.join(screenshotDir, `${selected}-${testCase.label}.png`);
      await page.screenshot({ path: screenshot, fullPage: false });
      assert.deepStrictEqual(consoleErrors, [], `${testCase.label}: no console errors`);
      assert.deepStrictEqual(pageErrors, [], `${testCase.label}: no page errors`);
      assert.deepStrictEqual(requestFailures, [], `${testCase.label}: no request failures`);
      assert.deepStrictEqual(externalRequests, [], `${testCase.label}: no external network requests`);
      results.push({
        case: testCase.label,
        rows: initial.rows,
        annualRows: initial.annualDomRows,
        monthlyRows: initial.monthlyDomRows,
        recalculateStartingOperatingCash: recalculated.startingOperatingCash,
        pageOverflow: initial.pageOverflow,
        computedColorScheme: initial.computedColorScheme,
        blobWorkerSimulation,
        consoleErrors: 0,
        pageErrors: 0,
        requestFailures: 0,
        externalRequests: 0,
        screenshot: path.relative(ROOT, screenshot).replace(/\\/g, '/'),
        screenshotSha256: sha256(screenshot),
      });
      await context.close();
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
  const evidence = { browser: selected, cases: results };
  const evidencePath = path.join(path.dirname(screenshotDir), `browser-evidence-${selected}.json`);
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
