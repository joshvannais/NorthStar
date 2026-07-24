'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium, webkit } = require('playwright');
const { app } = require('../../src/server');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const screenshotRoot = process.env.NORTHSTAR_SCREENSHOT_DIR;
if (!screenshotRoot) throw new Error('NORTHSTAR_SCREENSHOT_DIR is required');

function selected(name, envName) {
  const configured = String(process.env[envName] || '').split(',').map(function (value) {
    return value.trim();
  }).filter(Boolean);
  return configured.length === 0 || configured.includes(name);
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise(function (_resolve, reject) {
    timer = setTimeout(function () {
      reject(new Error(label + ' timed out after ' + timeoutMs + 'ms'));
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(function () {
    clearTimeout(timer);
  });
}

const ROUTES = [
  { name: 'command-center', path: '/dashboard', primary: '.cc-workspace' },
  { name: 'polaris', path: '/dashboard/polaris', primary: '.polaris-workspace' },
  { name: 'leads', path: '/dashboard/leads', primary: '#mainContent, .main-content' },
  { name: 'lead-detail', path: '/dashboard/lead?id=visual-lead', primary: '.lead-detail-container' },
  { name: 'communications', path: '/dashboard/communications', primary: '#mainContent, .main-content' },
  { name: 'my-number', path: '/dashboard/my-number', primary: '#mainContent, .main-content' },
  { name: 'calendar', path: '/dashboard/calendar', primary: '.cal-layout' },
  { name: 'ai-settings', path: '/dashboard/ai-settings', primary: '#mainContent, .main-content' },
  { name: 'business-profile', path: '/dashboard/business-profile', primary: '.bp-container' },
  { name: 'settings', path: '/dashboard/settings', primary: '#mainContent, .main-content' },
  { name: 'integrations', path: '/dashboard/integrations', primary: '#mainContent, .main-content' },
  { name: 'executive-brief', path: '/dashboard/executive-brief', primary: '.eb-workspace, .main-content' },
];

const VIEWPORTS = [
  { name: '1366x768', width: 1366, height: 768, mobile: false },
  { name: '1440x900', width: 1440, height: 900, mobile: false },
  { name: '1920x1080', width: 1920, height: 1080, mobile: false },
  { name: '2560x1440', width: 2560, height: 1440, mobile: false },
  { name: '390x844', width: 390, height: 844, mobile: true },
];

const now = '2026-07-24T14:00:00.000Z';
const customers = [
  { id: 'customer-1', name: 'Morgan Lee', phone: '(555) 010-1001', email: 'morgan@example.test', health: 88, totalJobs: 3, status: 'active' },
  { id: 'customer-2', name: 'Taylor Reed', phone: '(555) 010-1002', email: 'taylor@example.test', health: 64, totalJobs: 1, status: 'active' },
  { id: 'customer-3', name: 'Jordan Patel', phone: '(555) 010-1003', email: 'jordan@example.test', health: 42, totalJobs: 0, status: 'new' },
];
const opportunities = [
  {
    id: 'opp-1',
    customerId: 'customer-1',
    title: 'Electrical - Morgan Lee',
    stage: 'qualified',
    status: 'new',
    estimatedValue: 1800,
    createdAt: now,
    metadata: { polarisIntelligence: { service: 'Electrical', customerFacingPrice: 1800, confidenceScore: 91, recommendedAction: { action: 'Schedule inspection' } } },
  },
  {
    id: 'opp-2',
    customerId: 'customer-2',
    title: 'Plumbing - Taylor Reed',
    stage: 'scheduled',
    status: 'scheduled',
    estimatedValue: 950,
    createdAt: now,
    metadata: { polarisIntelligence: { service: 'Plumbing', customerFacingPrice: 950, confidenceScore: 84, recommendedAction: { action: 'Confirm appointment' } } },
  },
  {
    id: 'opp-3',
    customerId: 'customer-3',
    title: 'HVAC - Jordan Patel',
    stage: 'lead',
    status: 'contacted',
    estimatedValue: 6200,
    createdAt: now,
    metadata: { polarisIntelligence: { service: 'HVAC', customerFacingPrice: 6200, confidenceScore: 76, recommendedAction: { action: 'Collect system details' } } },
  },
];
const communications = [
  {
    id: 'comm-1',
    customerId: 'customer-1',
    type: 'call',
    direction: 'inbound',
    status: 'completed',
    subject: 'Electrical service call',
    content: 'Customer reported an outlet issue and requested an inspection.',
    createdAt: now,
    duration: '6 min',
    metadata: { customerName: 'Morgan Lee', phone: '(555) 010-1001', service: 'Electrical', estimatedPrice: 1800 },
  },
  {
    id: 'comm-2',
    customerId: 'customer-2',
    type: 'call',
    direction: 'inbound',
    status: 'completed',
    subject: 'Plumbing estimate',
    content: 'Customer requested a plumbing estimate for a scheduled visit.',
    createdAt: now,
    duration: '4 min',
    metadata: { customerName: 'Taylor Reed', phone: '(555) 010-1002', service: 'Plumbing', estimatedPrice: 950 },
  },
];

function fixtureFor(url) {
  const pathname = url.pathname;
  if (pathname === '/api/leads/visual-lead') {
    return {
      id: 'visual-lead',
      callerName: 'Morgan Lee',
      phone: '(555) 010-1001',
      email: 'morgan@example.test',
      service: 'Electrical',
      address: '100 NorthStar Way',
      status: 'new',
      estimatedPrice: 1800,
      summary: 'Representative authorized lead with a scheduled electrical inspection.',
      transcript: 'Customer requested a safe on-site inspection and confirmed weekday availability.',
      createdAt: now,
    };
  }
  if (pathname === '/api/leads') {
    return {
      items: opportunities.map(function (item, index) {
        return {
          id: item.id,
          caller: customers[index].name,
          status: item.status,
          outcome: index === 1 ? 'appointment-set' : 'lead-captured',
          avgPrice: item.estimatedValue,
          appointment_date: index === 1 ? '2026-07-24' : null,
        };
      }),
      count: opportunities.length,
    };
  }
  if (pathname === '/api/v1/customers') return { customers, total: customers.length };
  if (pathname === '/api/v1/opportunities') return { opportunities, total: opportunities.length };
  if (pathname === '/api/v1/opportunities/pipeline') {
    return { opportunities, totalValue: 8950, weightedValue: 6120, activeDeals: 3, winRate: 67 };
  }
  if (pathname === '/api/v1/communications') return { communications, total: communications.length };
  if (pathname === '/api/v1/calendar/events') {
    return {
      events: [
        { id: 'calendar-1', title: 'Morgan Lee - Electrical', date: '2026-07-24', time: '10:00 AM', type: 'appointment', estimatedPrice: 1800 },
        { id: 'calendar-2', title: 'Taylor Reed - Plumbing', date: '2026-07-25', time: '1:30 PM', type: 'appointment', estimatedPrice: 950 },
      ],
    };
  }
  if (pathname === '/api/v1/analytics/executive') {
    return {
      summary: 'NorthStar is operating with a healthy representative pipeline and three active opportunities.',
      executiveSummary: 'NorthStar is operating with a healthy representative pipeline and three active opportunities.',
      companyHealth: 86,
      healthStatus: 'active',
      revenue: { total: 8950, outstanding: 2750, forecast: 12400, collectionRate: '92%' },
      priorities: [{ title: 'Confirm Morgan inspection', description: 'Electrical inspection is ready to schedule.', priority: 'high' }],
    };
  }
  if (pathname === '/api/v1/analytics/kpis') {
    return {
      kpis: {
        totalJobs: 12,
        inProgressJobs: 4,
        completedJobs: 8,
        activeDeals: 3,
        totalDeals: 5,
        wonDeals: 2,
        pendingEstimates: 2,
        pipelineValue: 8950,
        weightedPipelineValue: 6120,
        overdueTasks: 1,
        winRate: 67,
        companyHealthScore: 86,
        collectionRate: 92,
        taskCompletionRate: 89,
        totalCustomers: 3,
        totalRevenue: 8950,
        outstandingRevenue: 2750,
      },
    };
  }
  if (pathname === '/api/v1/analytics/dashboard') {
    return {
      companyHealth: 86,
      pipeline: { totalValue: 8950, weightedValue: 6120, activeDeals: 3, winRate: 67 },
      operations: { totalJobs: 12, inProgress: 4, completedJobs: 8 },
    };
  }
  if (pathname === '/api/v1/analytics/alerts') {
    return { alerts: [{ type: 'Follow-up', severity: 'medium', message: 'One customer follow-up is due today.' }] };
  }
  if (pathname === '/api/v1/workflows/agenda/today') {
    return { tasks: [{ id: 'task-1', type: 'appointment', title: 'Morgan inspection', description: 'Electrical site visit', priority: 'high' }] };
  }
  if (pathname === '/api/v1/business-profile') {
    return {
      businessName: 'NorthStar Solutions',
      companyName: 'NorthStar Solutions',
      phone: '(555) 010-2000',
      email: 'office@northstar.example',
      website: 'https://northstar.example',
      address: '100 NorthStar Way',
      city: 'Charlotte',
      state: 'NC',
      zip: '28202',
      timezone: 'America/New_York',
      services: ['Electrical', 'Plumbing', 'HVAC'],
      businessHours: {},
      financial: { hourlyRate: 125, minimumJobAmount: 195 },
    };
  }
  if (pathname === '/api/integrations/jobber/status') return { connected: true, accountName: 'NorthStar Test Account' };
  if (pathname === '/api/v1/financial/estimates') return { estimates: [{ id: 'estimate-1', customerId: 'customer-1', total: 1800, status: 'draft' }], total: 1 };
  if (pathname === '/api/v1/financial/metrics') return { revenue: 8950, outstanding: 2750, margin: 34 };
  if (pathname.indexOf('/api/v1/polaris/') === 0) {
    return {
      success: true,
      status: 'operational',
      polaris: {
        service: 'Electrical',
        customerFacingPrice: 1800,
        confidenceScore: 91,
        scope: { issue: 'Outlet inspection', timing: 'Weekday' },
        missingInformation: ['Panel age'],
        assumptions: [],
        recommendedAction: { action: 'Schedule inspection' },
      },
      context: { overview: { activeLeads: 3, pipelineValue: 8950 }, leads: opportunities },
    };
  }
  return {
    success: true,
    items: [],
    data: {},
    customers,
    opportunities,
    communications,
    total: 0,
  };
}

async function installFixtures(context) {
  await context.addInitScript(function () {
    localStorage.setItem('token', 'visual-layout-token');
    localStorage.setItem('northstar_token', 'visual-layout-token');
    localStorage.setItem('user', JSON.stringify({
      id: 'visual-user',
      name: 'Visual Test Owner',
      email: 'visual@example.test',
      role: 'owner',
    }));
  });
  await context.route('**/api/**', function (route) {
    const requestUrl = new URL(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(fixtureFor(requestUrl)),
    });
  });
}

async function waitForStableReady(page, route) {
  await page.waitForLoadState('domcontentloaded');
  if (route.name === 'lead-detail') {
    await page.waitForFunction(function () {
      return window.__northstarLeadDetailState &&
        window.__northstarLeadDetailState.status === 'ready';
    });
  } else if (route.name === 'calendar') {
    await page.waitForFunction(function () {
      return window.calState && window.calState.serverState.kind === 'ready' &&
        window.calState.leadsState.kind === 'ready';
    });
  } else if (route.name === 'command-center') {
    await page.waitForFunction(function () {
      const content = document.getElementById('ccContent');
      return content && getComputedStyle(content).display !== 'none';
    });
  }
  await page.evaluate(function () {
    return document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  });
  await page.waitForFunction(function () {
    const main = document.querySelector('.main-content');
    if (!main) return false;
    const rect = main.getBoundingClientRect();
    const key = [rect.left, rect.top, rect.width, rect.height, document.documentElement.scrollWidth].map(Math.round).join(':');
    if (!window.__northstarLayoutProbe || window.__northstarLayoutProbe.key !== key) {
      window.__northstarLayoutProbe = { key, count: 1 };
      return false;
    }
    window.__northstarLayoutProbe.count += 1;
    return window.__northstarLayoutProbe.count >= 4;
  }, null, { polling: 100, timeout: 15000 });
}

async function measure(page, primarySelector) {
  return page.evaluate(function (selector) {
    function box(element) {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        display: style.display,
        visibility: style.visibility,
      };
    }
    const sidebarElement = document.querySelector('.sidebar');
    const mainElement = document.querySelector('.main-content');
    const primaryElement = document.querySelector(selector) || mainElement;
    const candidates = Array.from(document.querySelectorAll(
      '.card, [class*="-card"], [class*="-grid"], table, form'
    )).filter(function (element) {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 20 && rect.height > 10 && style.display !== 'none' && style.visibility !== 'hidden';
    }).slice(0, 80);
    return {
      viewport: { width: innerWidth, height: innerHeight },
      document: {
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
      },
      sidebar: box(sidebarElement),
      main: box(mainElement),
      primary: box(primaryElement),
      mobileHeader: box(document.querySelector('.mobile-header')),
      cards: candidates.map(function (element) {
        return {
          className: String(element.className || '').slice(0, 120),
          box: box(element),
        };
      }),
    };
  }, primarySelector);
}

function assertGeometry(result, route, viewport, engine) {
  const prefix = engine + ' ' + viewport.name + ' ' + route.name + ': ';
  assert.ok(result.main, prefix + 'main shell missing');
  assert.ok(result.primary, prefix + 'primary content missing');
  assert.ok(result.document.scrollWidth <= viewport.width + 1, prefix + 'horizontal document overflow ' + result.document.scrollWidth);
  assert.ok(result.main.width > 0 && result.primary.width > 0, prefix + 'zero-width content');
  assert.ok(result.main.left >= -1 && result.main.right <= viewport.width + 1, prefix + 'main shell clipped');
  assert.ok(result.primary.left >= -1 && result.primary.right <= viewport.width + 1, prefix + 'primary content clipped');

  if (viewport.mobile) {
    assert.ok(!result.sidebar || result.sidebar.display === 'none' || result.sidebar.width === 0, prefix + 'desktop sidebar visible on mobile');
    assert.ok(result.mobileHeader && result.mobileHeader.display !== 'none' && result.mobileHeader.width > 0, prefix + 'mobile navigation missing');
    assert.ok(result.main.width >= viewport.width - 2, prefix + 'mobile main shell does not use viewport');
    return;
  }

  assert.ok(result.sidebar && result.sidebar.display !== 'none' && result.sidebar.width >= 220, prefix + 'desktop sidebar missing');
  assert.ok(!result.mobileHeader || result.mobileHeader.display === 'none' || result.mobileHeader.height === 0, prefix + 'desktop substituted mobile menu');
  assert.ok(Math.abs(result.sidebar.top - result.main.top) <= 2, prefix + 'sidebar and main are not in the same row');
  assert.ok(result.main.left >= result.sidebar.right - 2, prefix + 'sidebar/content collision');
  assert.ok(result.main.top < Math.min(80, viewport.height * 0.1), prefix + 'primary shell begins below initial dashboard row');
  assert.ok(result.primary.top < viewport.height, prefix + 'primary content is outside initial viewport');

  const usable = viewport.width - result.sidebar.width;
  assert.ok(result.main.width >= usable * 0.85, prefix + 'main shell uses only ' + result.main.width + ' of ' + usable);
  const leftGutter = Math.max(0, result.primary.left - result.main.left);
  const rightGutter = Math.max(0, result.main.right - result.primary.right);
  const primaryRatio = result.primary.width / result.main.width;
  if (primaryRatio < 0.85) {
    assert.ok(Math.abs(leftGutter - rightGutter) <= 32, prefix + 'unbalanced primary gutters ' + leftGutter + '/' + rightGutter);
    assert.ok(Math.max(leftGutter, rightGutter) <= usable * 0.25 + 2, prefix + 'unexplained blank width exceeds 25%');
  }

  for (const candidate of result.cards) {
    assert.ok(candidate.box.left >= -1, prefix + 'card/control clipped left: ' + candidate.className);
    assert.ok(candidate.box.right <= viewport.width + 1, prefix + 'card/control clipped right: ' + candidate.className);
  }
}

async function legacyLeadMeasurement(page, baseUrl) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(baseUrl + '/dashboard/lead?id=visual-lead', { waitUntil: 'domcontentloaded' });
  await waitForStableReady(page, ROUTES.find(function (item) { return item.name === 'lead-detail'; }));
  return page.evaluate(function () {
    const layout = document.querySelector('.dashboard-layout');
    layout.className = 'app-layout';
    const style = document.createElement('style');
    style.textContent = '.app-layout{display:block!important;min-height:0!important;width:100%!important;overflow:visible!important}.main-content{display:grid!important;grid-template-columns:1fr 1fr!important;gap:0 24px!important;align-content:start!important}';
    document.head.appendChild(style);
    const sidebar = document.querySelector('.sidebar').getBoundingClientRect();
    const main = document.querySelector('.main-content').getBoundingClientRect();
    const primary = document.querySelector('.lead-detail-container').getBoundingClientRect();
    return {
      sidebar: { top: sidebar.top, bottom: sidebar.bottom, width: sidebar.width },
      main: { top: main.top, left: main.left, width: main.width },
      primary: { top: primary.top, left: primary.left, width: primary.width },
      blankBeforePrimary: primary.top,
    };
  });
}

async function runTarget(target, baseUrl) {
  fs.mkdirSync(screenshotRoot, { recursive: true });
  const browser = await target.launch();
  const results = [];
  try {
    const context = await browser.newContext();
    await installFixtures(context);
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.setDefaultNavigationTimeout(30000);
    const browserErrors = [];
    page.on('pageerror', function (error) {
      browserErrors.push('pageerror: ' + error.message);
    });
    page.on('console', function (message) {
      if (message.type() === 'error') browserErrors.push('console: ' + message.text());
    });
    page.on('response', function (response) {
      const url = new URL(response.url());
      if (url.origin === baseUrl && response.status() >= 400) {
        browserErrors.push('first-party response ' + response.status() + ': ' + url.pathname);
      }
    });

    const beforeLead = await legacyLeadMeasurement(page, baseUrl);
    assert.ok(beforeLead.main.top >= beforeLead.sidebar.bottom - 2, 'legacy lead diagnostic did not reproduce below-sidebar layout');

    browserErrors.length = 0;
    await page.goto(baseUrl + '/dashboard/legacy', { waitUntil: 'load' });
    const legacyDocument = await page.evaluate(function () {
      return {
        pathname: location.pathname,
        readyState: document.readyState,
        hasAppStore: Boolean(window.AppStore),
        actions: document.querySelectorAll('#ccActions a').length,
      };
    });
    assert.equal(legacyDocument.pathname, '/dashboard/legacy');
    assert.equal(legacyDocument.readyState, 'complete');
    assert.equal(legacyDocument.hasAppStore, true);
    assert.ok(
      legacyDocument.actions >= 5,
      'legacy dashboard inline application did not execute: ' +
        JSON.stringify({ legacyDocument, browserErrors })
    );
    assert.deepEqual(browserErrors, [], target.name + ' legacy dashboard browser errors');

    for (const viewport of VIEWPORTS.filter(function (item) {
      return selected(item.name, 'NORTHSTAR_VIEWPORTS');
    })) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const route of ROUTES.filter(function (item) {
        return selected(item.name, 'NORTHSTAR_ROUTES');
      })) {
        process.stdout.write(target.name + ': ' + viewport.name + ' ' + route.name + '\n');
        browserErrors.length = 0;
        await page.goto(baseUrl + route.path, { waitUntil: 'domcontentloaded' });
        await page.addStyleTag({
          content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}',
        });
        await waitForStableReady(page, route);
        const geometry = await measure(page, route.primary);
        assertGeometry(geometry, route, viewport, target.name);
        assert.deepEqual(browserErrors, [], target.name + ' ' + viewport.name + ' ' + route.name + ' browser errors');

        const stem = [target.name, viewport.name, route.name, 'populated'].join('-');
        const viewportPath = path.join(screenshotRoot, stem + '-viewport.png');
        const fullPath = path.join(screenshotRoot, stem + '-full.png');
        await withTimeout(page.screenshot({ path: viewportPath }), 30000, stem + ' viewport screenshot');
        await withTimeout(page.screenshot({ path: fullPath, fullPage: true }), 30000, stem + ' full screenshot');
        process.stdout.write(target.name + ': ' + viewport.name + ' ' + route.name + ' captured\n');
        results.push({
          engine: target.name,
          viewport: viewport.name,
          route: route.name,
          state: 'populated',
          geometry,
          screenshots: { viewport: viewportPath, full: fullPath },
        });
      }
    }

    for (const viewport of [VIEWPORTS[1], VIEWPORTS[4]].filter(function (item) {
      return selected(item.name, 'NORTHSTAR_VIEWPORTS') &&
        selected('lead-detail', 'NORTHSTAR_ROUTES');
    })) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await context.route('**/api/leads/visual-missing**', function (route) {
        return route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'not_found', message: 'Record not found.' } }),
        });
      });
      browserErrors.length = 0;
      await page.goto(baseUrl + '/dashboard/lead?id=visual-missing', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(function () {
        return window.__northstarLeadDetailState &&
          window.__northstarLeadDetailState.status === 'not-found';
      });
      const geometry = await measure(page, '.lead-detail-container');
      assertGeometry(geometry, ROUTES[3], viewport, target.name);
      const stem = [target.name, viewport.name, 'lead-detail', 'safe-error'].join('-');
      const viewportPath = path.join(screenshotRoot, stem + '-viewport.png');
      const fullPath = path.join(screenshotRoot, stem + '-full.png');
      await withTimeout(page.screenshot({ path: viewportPath }), 30000, stem + ' viewport screenshot');
      await withTimeout(page.screenshot({ path: fullPath, fullPage: true }), 30000, stem + ' full screenshot');
      results.push({
        engine: target.name,
        viewport: viewport.name,
        route: 'lead-detail',
        state: 'safe-error',
        geometry,
        screenshots: { viewport: viewportPath, full: fullPath },
      });
    }
    await context.close();
    return { engine: target.name, beforeLead, results };
  } finally {
    await withTimeout(browser.close(), 30000, target.name + ' browser close');
  }
}

async function main() {
  const server = await new Promise(function (resolve, reject) {
    const listener = app.listen(0, '127.0.0.1', function () { resolve(listener); });
    listener.once('error', reject);
  });
  const baseUrl = 'http://127.0.0.1:' + server.address().port;
  const targets = [
    {
      name: 'installed-chrome',
      launch: function () {
        return chromium.launch({ headless: true, executablePath: chromePath });
      },
    },
    {
      name: 'playwright-webkit',
      launch: function () {
        return webkit.launch({ headless: true });
      },
    },
  ].filter(function (target) {
    return !process.env.NORTHSTAR_BROWSER_TARGET ||
      process.env.NORTHSTAR_BROWSER_TARGET === target.name;
  });

  const output = {
    generatedAt: new Date().toISOString(),
    routeManifest: ROUTES,
    viewports: VIEWPORTS,
    targets: [],
  };
  try {
    for (const target of targets) {
      process.stdout.write(target.name + ': matrix start\n');
      output.targets.push(await runTarget(target, baseUrl));
      process.stdout.write(target.name + ': matrix PASS\n');
    }
  } finally {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise(function (resolve) { server.close(resolve); });
  }
  fs.writeFileSync(
    path.join(
      screenshotRoot,
      'dashboard-layout-results-' +
        (process.env.NORTHSTAR_BROWSER_TARGET || 'all') + '-' +
        (process.env.NORTHSTAR_VIEWPORTS || 'all').replace(/[^a-zA-Z0-9x_-]+/g, '_') + '-' +
        (process.env.NORTHSTAR_ROUTES || 'all').replace(/[^a-zA-Z0-9_-]+/g, '_') +
        '.json'
    ),
    JSON.stringify(output, null, 2)
  );
}

main().catch(function (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
});
