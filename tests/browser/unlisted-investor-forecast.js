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
  : path.join(ROOT, 'outputs', 'unlisted-investor-forecast-monthly-layout-writer', 'screenshots');

const CASES = Object.freeze([
  Object.freeze({ label: 'desktop-light', width: 1440, height: 1000, colorScheme: 'light' }),
  Object.freeze({ label: 'desktop-dark-preference', width: 1440, height: 1000, colorScheme: 'dark' }),
  Object.freeze({ label: 'mobile-light', width: 390, height: 844, colorScheme: 'light' }),
  Object.freeze({ label: 'mobile-dark-preference', width: 390, height: 844, colorScheme: 'dark' }),
]);

const BASELINE_ENGINE_SNAPSHOT = Object.freeze({
  summary: Object.freeze({
    startingOperatingCash: 25000,
    endingCash: 18999135.90949049,
    endingActiveCustomers: 4134.761904761905,
    endingArr: 13098925.714285709,
    totalRevenue: 63817706.25753198,
    totalOperatingProfit: 37948271.818981,
    cumulativeInvestorDistributions: 1897413.59094905,
    recoveryMonth: 31,
  }),
  month1: Object.freeze({
    month: 1,
    plannedNewPayingCustomers: 1.5,
    newPayingCustomers: 1.5,
    activeCustomers: 1.5,
    totalRevenue: 396,
    totalOperatingExpense: 300,
    endingCash: 25009.1695,
  }),
  month12: Object.freeze({
    month: 12,
    plannedNewPayingCustomers: 12,
    newPayingCustomers: 9.944727272727274,
    activeCustomers: 65.94922465011821,
    totalRevenue: 17410.59530763121,
    totalOperatingExpense: 400,
    endingCash: 60407.905662068595,
  }),
  month120: Object.freeze({
    month: 120,
    plannedNewPayingCustomers: 120,
    newPayingCustomers: 111.75657840148439,
    activeCustomers: 4134.761904761905,
    totalRevenue: 1091577.1428571425,
    totalOperatingExpense: 168608,
    endingCash: 18999135.90949049,
  }),
  year1: Object.freeze({
    year: 1,
    monthsIncluded: 12,
    plannedGrossAdditions: 87,
    capacitySupportedGrossAdditions: 75.82227272727273,
    endingCustomers: 65.94922465011821,
    revenue: 93192.04145379088,
  }),
  year10: Object.freeze({
    year: 10,
    monthsIncluded: 12,
    plannedGrossAdditions: 1440,
    capacitySupportedGrossAdditions: 1431.7565784014844,
    endingCustomers: 4134.761904761905,
    revenue: 12815999.235855302,
  }),
});

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
        const pick = (value, keys) => Object.fromEntries(keys.map(key => [key, value[key]]));
        const viewportWidth = document.documentElement.clientWidth;
        const pageOverflow = document.documentElement.scrollWidth - viewportWidth;
        const overview = document.querySelector('#results-title').closest('section');
        const monthly = document.querySelector('#monthlyDetails');
        const annual = document.querySelector('#annualDetails');
        const monthlyScroll = document.querySelector('#monthlyProjectionScroll');
        const monthlyRows = Array.from(document.querySelectorAll('#monthlyRows > tr'));
        const scrollRect = monthlyScroll.getBoundingClientRect();
        const headerRect = document.querySelector('#monthlyHeader').getBoundingClientRect();
        const rowRects = [0, 11, 12].map(index => monthlyRows[index].getBoundingClientRect());
        const result = window.currentNorthStarInvestorResult;
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
          monthlyDomRows: monthlyRows.length,
          monthSequence: monthlyRows.map(row => Number(row.dataset.month)),
          monthlyYearGroups: monthly.querySelectorAll('.year-group').length,
          overviewImmediatelyBeforeMonthly: overview.nextElementSibling === monthly,
          annualImmediatelyAfterMonthly: monthly.nextElementSibling === annual,
          monthlyTag: monthly.tagName,
          monthlyVisible: visible(monthly) && visible(monthlyScroll),
          monthlyRegionRole: monthlyScroll.getAttribute('role'),
          monthlyRegionTabIndex: monthlyScroll.tabIndex,
          monthlyScrollTop: monthlyScroll.scrollTop,
          monthlyClientHeight: monthlyScroll.clientHeight,
          monthlyScrollHeight: monthlyScroll.scrollHeight,
          monthlyClientWidth: monthlyScroll.clientWidth,
          monthlyScrollWidth: monthlyScroll.scrollWidth,
          stickyHeaderPosition: getComputedStyle(document.querySelector('#monthlyHeader')).position,
          headerTopOffset: headerRect.top - scrollRect.top,
          firstRowVisible: rowRects[0].top >= headerRect.bottom - 1 && rowRects[0].bottom <= scrollRect.bottom + 1,
          month12Visible: rowRects[1].bottom <= scrollRect.bottom + 1,
          month13InitiallyBelowViewport: rowRects[2].top >= scrollRect.bottom - 1,
          engineSnapshot: {
            summary: pick(result.summary, [
              'startingOperatingCash', 'endingCash', 'endingActiveCustomers', 'endingArr',
              'totalRevenue', 'totalOperatingProfit', 'cumulativeInvestorDistributions', 'recoveryMonth',
            ]),
            month1: pick(result.rows[0], [
              'month', 'plannedNewPayingCustomers', 'newPayingCustomers', 'activeCustomers',
              'totalRevenue', 'totalOperatingExpense', 'endingCash',
            ]),
            month12: pick(result.rows[11], [
              'month', 'plannedNewPayingCustomers', 'newPayingCustomers', 'activeCustomers',
              'totalRevenue', 'totalOperatingExpense', 'endingCash',
            ]),
            month120: pick(result.rows[119], [
              'month', 'plannedNewPayingCustomers', 'newPayingCustomers', 'activeCustomers',
              'totalRevenue', 'totalOperatingExpense', 'endingCash',
            ]),
            year1: pick(result.annualSummary[0], [
              'year', 'monthsIncluded', 'plannedGrossAdditions', 'capacitySupportedGrossAdditions',
              'endingCustomers', 'revenue',
            ]),
            year10: pick(result.annualSummary[9], [
              'year', 'monthsIncluded', 'plannedGrossAdditions', 'capacitySupportedGrossAdditions',
              'endingCustomers', 'revenue',
            ]),
          },
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
      assert.strictEqual(initial.monthlyDomRows, 120, `${testCase.label}: 120 monthly table rows`);
      assert.deepStrictEqual(initial.monthSequence, Array.from({ length: 120 }, (_, index) => index + 1),
        `${testCase.label}: monthly rows are one contiguous Month 1–120 sequence`);
      assert.strictEqual(initial.monthlyYearGroups, 0, `${testCase.label}: monthly projection has no year groups`);
      assert.strictEqual(initial.overviewImmediatelyBeforeMonthly, true,
        `${testCase.label}: monthly projection immediately follows Forecast overview`);
      assert.strictEqual(initial.annualImmediatelyAfterMonthly, true,
        `${testCase.label}: annual summary remains a separate secondary section after monthly projection`);
      assert.strictEqual(initial.monthlyTag, 'SECTION', `${testCase.label}: monthly projection is not a collapsed details control`);
      assert.strictEqual(initial.monthlyVisible, true, `${testCase.label}: monthly projection renders open by default`);
      assert.strictEqual(initial.monthlyRegionRole, 'region', `${testCase.label}: monthly viewport is an accessible region`);
      assert.strictEqual(initial.monthlyRegionTabIndex, 0, `${testCase.label}: monthly viewport is keyboard focusable`);
      assert.strictEqual(initial.monthlyScrollTop, 0, `${testCase.label}: monthly viewport starts at Month 1`);
      assert.ok(initial.monthlyScrollHeight > initial.monthlyClientHeight,
        `${testCase.label}: later months require contained vertical scrolling`);
      assert.ok(initial.monthlyScrollWidth > initial.monthlyClientWidth,
        `${testCase.label}: wide monthly detail uses contained horizontal scrolling`);
      assert.strictEqual(initial.stickyHeaderPosition, 'sticky', `${testCase.label}: monthly header is sticky`);
      assert.ok(Math.abs(initial.headerTopOffset) <= 2,
        `${testCase.label}: monthly header begins at the scroll-region top (${initial.headerTopOffset}px)`);
      assert.strictEqual(initial.firstRowVisible, true, `${testCase.label}: Month 1 is initially visible beneath the header`);
      assert.strictEqual(initial.month12Visible, true, `${testCase.label}: Month 12 is initially visible`);
      assert.strictEqual(initial.month13InitiallyBelowViewport, true,
        `${testCase.label}: Month 13 begins beyond the initial 12-row viewport`);
      assert.deepStrictEqual(initial.engineSnapshot, BASELINE_ENGINE_SNAPSHOT,
        `${testCase.label}: financial engine results match the exact pre-layout baseline`);
      assert.ok(initial.pageOverflow <= 1, `${testCase.label}: no page-level horizontal overflow (${initial.pageOverflow}px)`);
      assert.ok(initial.dateOverflow <= 1, `${testCase.label}: date control content fits (${initial.dateOverflow}px)`);
      assert.ok(initial.suffixOverflows.every(value => value <= 1), `${testCase.label}: suffix controls fit`);
      const escaped = initial.contained.filter(item => (
        !item.leftViewport || !item.rightViewport || !item.leftParent || !item.rightParent
      ));
      assert.strictEqual(escaped.length, 0,
        `${testCase.label}: visible date, pill, and suffix bounds: ${JSON.stringify(escaped.slice(0, 10))}`);
      assert.strictEqual(initial.computedColorScheme, 'light', `${testCase.label}: canonical calculator supports light mode only`);

      const monthlyScroll = page.locator('#monthlyProjectionScroll');
      await monthlyScroll.focus();
      assert.strictEqual(await page.evaluate(() => document.activeElement?.id), 'monthlyProjectionScroll',
        `${testCase.label}: monthly scroll region accepts keyboard focus`);
      const month120Reachability = await page.evaluate(() => {
        const region = document.querySelector('#monthlyProjectionScroll');
        region.scrollTop = region.scrollHeight;
        region.scrollLeft = region.scrollWidth;
        const regionRect = region.getBoundingClientRect();
        const headerRect = document.querySelector('#monthlyHeader').getBoundingClientRect();
        const month120Rect = document.querySelector('#monthlyRows > tr[data-month="120"]').getBoundingClientRect();
        return {
          atVerticalEnd: Math.abs((region.scrollHeight - region.clientHeight) - region.scrollTop) <= 2,
          horizontalScrollMoved: region.scrollLeft > 0,
          month120Visible: month120Rect.top >= headerRect.bottom - 1 && month120Rect.bottom <= regionRect.bottom + 1,
          headerStillPinned: Math.abs(headerRect.top - regionRect.top) <= 2,
          pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      assert.deepStrictEqual(month120Reachability, {
        atVerticalEnd: true,
        horizontalScrollMoved: true,
        month120Visible: true,
        headerStillPinned: true,
        pageOverflow: 0,
      }, `${testCase.label}: Month 120 and the final column are reachable only inside the contained viewport`);
      await page.evaluate(() => {
        const region = document.querySelector('#monthlyProjectionScroll');
        region.scrollTop = 0;
        region.scrollLeft = 0;
      });

      const explore = page.locator('#exploreDetails');
      assert.strictEqual(await explore.getAttribute('open'), null, `${testCase.label}: detail hub starts collapsed`);
      const annual = page.locator('#annualDetails');
      assert.strictEqual(await annual.getAttribute('open'), null, `${testCase.label}: annualDetails starts collapsed`);
      await annual.locator(':scope > summary').click();
      assert.ok(await annual.getAttribute('open') !== null, `${testCase.label}: annualDetails expands`);
      await annual.locator(':scope > summary').click();
      assert.strictEqual(await annual.getAttribute('open'), null, `${testCase.label}: annualDetails collapses`);
      await explore.locator(':scope > summary').click();
      assert.ok(await explore.getAttribute('open') !== null, `${testCase.label}: detail hub expands`);
      for (const detailId of ['comparisonDetails', 'teamDetails']) {
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
        monthlyDomRows: document.querySelectorAll('#monthlyRows > tr').length,
        annualDomRows: document.querySelectorAll('#annualRows > tr').length,
        monthSequence: Array.from(document.querySelectorAll('#monthlyRows > tr'), row => Number(row.dataset.month)),
        startingOperatingCash: window.currentNorthStarInvestorResult.summary.startingOperatingCash,
        validationVisible: document.querySelector('#validationSummary').classList.contains('show'),
        monthlyScrollTop: document.querySelector('#monthlyProjectionScroll').scrollTop,
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }));
      assert.strictEqual(recalculated.rows, 120, `${testCase.label}: recalculation retains 120 data rows`);
      assert.strictEqual(recalculated.annualRows, 10, `${testCase.label}: recalculation retains 10 annual data rows`);
      assert.strictEqual(recalculated.monthlyDomRows, 120, `${testCase.label}: recalculation retains 120 monthly DOM rows`);
      assert.strictEqual(recalculated.annualDomRows, 10, `${testCase.label}: recalculation retains 10 annual DOM rows`);
      assert.deepStrictEqual(recalculated.monthSequence, Array.from({ length: 120 }, (_, index) => index + 1),
        `${testCase.label}: recalculation retains the contiguous Month 1–120 sequence`);
      assert.strictEqual(recalculated.startingOperatingCash, 25001,
        `${testCase.label}: recalculation applies the edited investment`);
      assert.strictEqual(recalculated.validationVisible, false, `${testCase.label}: recalculation has no validation error`);
      assert.strictEqual(recalculated.monthlyScrollTop, 0, `${testCase.label}: recalculation returns the monthly viewport to Month 1`);
      assert.ok(recalculated.pageOverflow <= 1, `${testCase.label}: recalculation has no page overflow`);

      await page.locator('#monthlyDetails').scrollIntoViewIfNeeded();
      await page.waitForTimeout(100);
      const screenshot = path.join(screenshotDir, `${selected}-${testCase.label}.png`);
      await page.locator('#monthlyDetails').screenshot({ path: screenshot });
      assert.deepStrictEqual(consoleErrors, [], `${testCase.label}: no console errors`);
      assert.deepStrictEqual(pageErrors, [], `${testCase.label}: no page errors`);
      assert.deepStrictEqual(requestFailures, [], `${testCase.label}: no request failures`);
      assert.deepStrictEqual(externalRequests, [], `${testCase.label}: no external network requests`);
      results.push({
        case: testCase.label,
        rows: initial.rows,
        annualRows: initial.annualDomRows,
        monthlyRows: initial.monthlyDomRows,
        contiguousMonths: `${initial.monthSequence[0]}-${initial.monthSequence[initial.monthSequence.length - 1]}`,
        monthlyViewportRowsInitiallyVisible: '1-12',
        month120Reachable: month120Reachability.month120Visible,
        stickyHeader: initial.stickyHeaderPosition,
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
