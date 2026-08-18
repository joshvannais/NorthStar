'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const ROOT = process.env.NORTHSTAR_TARGET_ROOT
  ? path.resolve(process.env.NORTHSTAR_TARGET_ROOT)
  : path.resolve(__dirname, '..', '..');
process.chdir(ROOT);
const fromRoot = relative => require(path.join(ROOT, relative));
const { createSuiteDatabase } = fromRoot('tests/helpers/m19-part3-postgres-database');
const { canonicalFenceProfile } = fromRoot('tests/helpers/m19-part3-business-profile');
const { provisionDurableSession } = fromRoot('tests/helpers/account-session-fixture');
const { resolveBrowserRuntime } = fromRoot('tests/helpers/playwright-runtime');
const { ingestRetell } = fromRoot('src/services/canonicalGraphService');
const CAPTURE_BASELINE = process.env.NORTHSTAR_CAPTURE_BASELINE_ONLY === '1';
const ROUTES = Object.freeze([
  Object.freeze({ id: 'command-center', path: '/demo', paidPath: '/dashboard', marker: 'One operating view for the day ahead.', surface: '.command-center-blueprint-main' }),
  Object.freeze({ id: 'polaris', path: '/demo/polaris', paidPath: '/dashboard/polaris', marker: 'POLARIS', surface: '.polaris-workspace' }),
  Object.freeze({ id: 'leads', path: '/demo/leads', paidPath: '/dashboard/leads', marker: 'All Leads', surface: '.leads-kpi-grid' }),
  Object.freeze({ id: 'communications', path: '/demo/communications', paidPath: '/dashboard/communications', marker: 'Communications', surface: '#kpiGrid' }),
  Object.freeze({ id: 'my-number', path: '/demo/my-number', paidPath: '/dashboard/my-number', marker: 'My Number', surface: '.settings-section' }),
  Object.freeze({ id: 'calendar', path: '/demo/calendar', paidPath: '/dashboard/calendar', marker: 'Calendar', surface: '#calendarGrid' }),
  Object.freeze({ id: 'team', path: '/demo/team', paidPath: '/dashboard/team', marker: 'Team', surface: '.wf-shell' }),
  Object.freeze({ id: 'ai-settings', path: '/demo/ai-settings', paidPath: '/dashboard/ai-settings', marker: 'AI Settings', surface: '.ai-settings-gateway' }),
  Object.freeze({ id: 'business-profile', path: '/demo/business-profile', paidPath: '/dashboard/business-profile', marker: 'Business Profile', surface: '#businessProfileRoot' }),
  Object.freeze({ id: 'settings', path: '/demo/settings', paidPath: '/dashboard/settings', marker: 'Settings', surface: '.settings-section' }),
  Object.freeze({ id: 'integrations', path: '/demo/integrations', paidPath: '/dashboard/integrations', marker: 'Integrations', surface: '#integrationAuthority' }),
]);
const VIEWPORTS = Object.freeze([
  Object.freeze({ label: 'desktop', width: 1440, height: 900 }),
  Object.freeze({ label: 'tablet', width: 1024, height: 768 }),
  Object.freeze({ label: 'mobile', width: 390, height: 844 }),
  Object.freeze({ label: 'mobile-compact', width: 360, height: 800 }),
]);
const POLARIS_PLACEMENT_ALLOWLIST = Object.freeze(['command-center', 'leads', 'communications']);
const DETAILED_POLARIS_SURFACES = Object.freeze(['command-center', 'leads', 'communications']);
const DEMO_TOOLBAR_ALLOWLIST = Object.freeze([
  'command-center', 'leads', 'communications', 'my-number', 'calendar', 'team', 'ai-settings',
]);
const SUPPORTED_FONT_WEIGHTS = Object.freeze(['400', '500', '600', '700', '800']);
const PROVIDER_ENVIRONMENT = Object.freeze([
  'RETELL_API_KEY', 'RETELL_AGENT_ID', 'RETELL_PHONE_NUMBER', 'RETELL_WEBHOOK_SECRET',
  'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN',
  'TWILIO_PHONE_NUMBER', 'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS',
  'JOBBER_CLIENT_ID', 'JOBBER_CLIENT_SECRET',
]);
const PAID_ORG_A = '8b000000-0000-4000-8000-000000000001';
const PAID_ORG_B = '8b000000-0000-4000-8000-000000000002';
const PAID_USER_A = '8c000000-0000-4000-8000-000000000001';
const PAID_USER_B = '8c000000-0000-4000-8000-000000000002';
const PAID_CUSTOMER_A = 'Authorized Paid Customer';
const PAID_CUSTOMER_B = 'Other Tenant Private Customer';

function paidBusinessProfile(companyName) {
  const profile = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'business-profile.json'), 'utf8'));
  const canonical = canonicalFenceProfile({
    companyName,
    materialRates: { cedar: 123, pine: 71, vinyl: 83, 'chain-link': 47 },
  });
  profile.company.name = companyName;
  profile.services = canonical.services;
  profile.canonicalPricing = canonical.canonicalPricing;
  profile.canonicalCosts = canonical.canonicalCosts;
  return profile;
}

function paidGraphRequest(organizationId, key, customerName, phone, material) {
  const selectedMaterial = material || 'cedar';
  return {
    tenantContext: { organizationId },
    idempotencyKey: key,
    sourceVersion: 'command-center-paid-browser-v1',
    external: {
      customerId: key + ':customer',
      callId: key + ':call',
      transcriptId: key + ':transcript',
      communicationId: key + ':communication',
      appointmentId: key + ':appointment',
    },
    customer: {
      name: customerName,
      phone,
      email: key + '@paid-browser.test',
      address: { city: 'Raleigh', state: 'NC' },
    },
    transcript: [
      { speaker: 'agent', text: 'Thanks for calling. What kind of fence work do you need?' },
      { speaker: 'customer', text: 'I need a 120 foot ' + selectedMaterial + ' privacy fence and an appointment next week.' },
    ],
    facts: [
      { variable: 'jobType', normalizedValue: selectedMaterial + ' privacy fence installation', evidenceText: 'The customer requested a ' + selectedMaterial + ' privacy fence.', speaker: 'customer', confidence: 0.98 },
      { variable: 'linearFeet', normalizedValue: 120, evidenceText: 'The customer requested 120 feet.', speaker: 'customer', confidence: 0.98 },
    ],
    service: { key: 'fence', scope: { linearFeet: 120, material: selectedMaterial, gates: 1 } },
    appointmentPreference: { window: 'next week', flexibility: 'weekday' },
    scheduledAppointment: { start: '2026-08-20T14:00:00.000Z', end: '2026-08-20T16:00:00.000Z' },
    travel: { miles: 8 },
    callDurationSeconds: 185,
    occurredAt: '2026-08-16T16:00:00.000Z',
  };
}

function treeDigest(directory) {
  const hash = crypto.createHash('sha256');
  function visit(current) {
    if (!fs.existsSync(current)) return;
    fs.readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name)).forEach(entry => {
      const absolute = path.join(current, entry.name);
      hash.update(path.relative(directory, absolute).replace(/\\/g, '/'));
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) hash.update(fs.readFileSync(absolute));
    });
  }
  visit(directory);
  return hash.digest('hex');
}

function hasPolarisSurface(routeId) {
  return POLARIS_PLACEMENT_ALLOWLIST.includes(routeId);
}

async function inspectProfessionalPresentation(page, label) {
  const snapshot = await page.evaluate(async supportedWeights => {
    await document.fonts.ready;
    function visible(node) {
      if (!node) return false;
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    }
    const nodes = Array.from(document.querySelectorAll('body, button, input, select, textarea, a, h1, h2, h3, p, li, summary'))
      .filter(visible);
    const normalizedWeight = value => value === 'normal' ? '400' : value === 'bold' ? '700' : value;
    const families = Array.from(new Set(nodes.map(node => getComputedStyle(node).fontFamily)));
    const nativeFamily = /(?:-apple-system|BlinkMacSystemFont|Segoe UI|Helvetica Neue|Arial|sans-serif)/i;
    const fontOffenders = nodes.filter(node => !nativeFamily.test(getComputedStyle(node).fontFamily)).map(node => ({
      tag: node.tagName,
      id: node.id,
      className: typeof node.className === 'string' ? node.className : '',
      family: getComputedStyle(node).fontFamily,
      text: (node.innerText || node.value || node.getAttribute('aria-label') || '').trim().slice(0, 120),
    }));
    const renderedWeights = Array.from(new Set(nodes.map(node => normalizedWeight(getComputedStyle(node).fontWeight))));
    const bodyText = document.body.innerText.replace(/\u00a0/g, ' ');
    const violations = [];
    const patterns = [
      ['raw object serialization', /\[object Object\]/i],
      ['raw JSON object', /(?:^|\s)\{\s*"[A-Za-z0-9_ -]+"\s*:/m],
      ['internal UUID', /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i],
      ['internal long digest', /\b[0-9a-f]{40,}\b/i],
      ['internal source key', /\b(?:snapshotDigest|canonicalDigest|calculationVersion|sourceVersion|organizationId|tenantId|canonicalSourceId|graphId)\b/i],
      ['internal snake-case token', /\b[a-z][a-z0-9]*_[a-z0-9_]+\b/],
      ['unexplained calculation placeholder', /\bNot calculated\b/i],
      ['missing whitespace', /\bpreview\.No\b/i],
      ['malformed separator', /(?:—\s*)?\|\s*\|/],
    ];
    patterns.forEach(([name, pattern]) => { if (pattern.test(bodyText)) violations.push(name); });
    return {
      bodyText,
      violations,
      families,
      fontOffenders,
      renderedWeights,
    };
  }, SUPPORTED_FONT_WEIGHTS);
  assert.ok(snapshot.families.length > 0 && snapshot.fontOffenders.length === 0,
    label + ' renders all visible text and controls with the canonical native system stack: ' + JSON.stringify(snapshot.fontOffenders));
  assert.ok(snapshot.renderedWeights.every(weight => SUPPORTED_FONT_WEIGHTS.includes(weight)),
    label + ' renders only supported font weights: ' + JSON.stringify(snapshot.renderedWeights));
  assert.deepStrictEqual(snapshot.violations, [], label + ' contains no raw/internal/malformed user-facing text');
  return snapshot;
}

async function captureEvidence(page, mode, route, viewport, phase) {
  const configured = process.env.NORTHSTAR_SCREENSHOT_DIR;
  if (!configured) return null;
  const directory = path.resolve(configured);
  const relative = path.relative(ROOT, directory);
  assert.ok(relative.startsWith('..') || path.isAbsolute(relative), 'screenshots must stay outside the repository');
  fs.mkdirSync(directory, { recursive: true });
  const name = [mode, viewport.label, route.id, phase].join('--').replace(/[^a-z0-9_.-]+/gi, '-').toLowerCase() + '.png';
  const target = path.join(directory, name);
  await page.screenshot({ path: target, fullPage: true });
  return target;
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

async function waitReady(page, route, revision) {
  await page.waitForFunction(({ expectedRevision, marker, surface, routeId, expectsPolaris, expectsToolbar }) => {
    const api = window.NorthStarDemoRuntime;
    const value = api && api.getWorkspace && api.getWorkspace();
    const root = document.documentElement;
    const node = document.querySelector(surface);
    const mountedCard = routeId === 'command-center'
      ? document.querySelector('#commandCenterPolaris[data-polaris-card="northstar_polaris_intelligence_card_v1"]')
      : document.querySelector('#northstarPolarisSurfaceCard[data-state="ready"]');
    const cardReady = expectsPolaris ? Boolean(mountedCard) : !mountedCard;
    const toolbarReady = expectsToolbar
      ? Boolean(document.getElementById('northstarDemoToolbar'))
      : !document.getElementById('northstarDemoToolbar');
    return value && value.integrity.revision === expectedRevision &&
      root.getAttribute('data-northstar-navigation') === 'ready' &&
      root.getAttribute('data-demo-workspace') === 'ready' &&
      toolbarReady && node && cardReady &&
      document.body.textContent.includes(marker);
  }, {
    expectedRevision: revision, marker: route.marker, surface: route.surface,
    routeId: route.id, expectsPolaris: hasPolarisSurface(route.id),
    expectsToolbar: DEMO_TOOLBAR_ALLOWLIST.includes(route.id),
  }, { timeout: 15000 });
}

async function waitCatalogueTerminal(page, route) {
  if (route.id !== 'integrations') return;
  await page.waitForFunction(() => {
    const root = document.getElementById('integrationCatalogueRoot');
    return root && ['ready', 'error'].includes(root.dataset.state);
  }, null, { timeout: 15000 });
}

async function inspectCurrent(page, route, revision, viewport) {
  await waitReady(page, route, revision);
  await waitCatalogueTerminal(page, route);
  await inspectProfessionalPresentation(page, route.path + ' ' + viewport.label);
  const snapshot = await page.evaluate(({ routeId, routePath, mobile }) => {
    function rect(node) {
      if (!node) return null;
      const value = node.getBoundingClientRect();
      return { left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width, height: value.height };
    }
    function visible(node) {
      if (!node) return false;
      const value = rect(node);
      const style = getComputedStyle(node);
      const browserVisible = typeof node.checkVisibility === 'function'
        ? node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
        : node.getClientRects().length > 0;
      return browserVisible && value.width > 0 && value.height > 0 &&
        style.display !== 'none' && style.visibility !== 'hidden';
    }
    const main = document.querySelector('.main-content');
    const toolbar = document.getElementById('northstarDemoToolbar');
    const mainStyle = getComputedStyle(main);
    const mainRect = rect(main);
    const toolbarRect = rect(toolbar);
    const contentLeft = mainRect.left + parseFloat(mainStyle.paddingLeft || '0');
    const contentRight = mainRect.right - parseFloat(mainStyle.paddingRight || '0');
    const nextSurface = Array.from(main.children).find(node => node !== toolbar && visible(node));
    const controlRects = toolbar ? Array.from(toolbar.querySelectorAll('button, select, a')).filter(visible).map(node => ({
      id: node.id || node.textContent.trim(), rect: rect(node),
    })) : [];
    const overlaps = [];
    for (let left = 0; left < controlRects.length; left += 1) {
      for (let right = left + 1; right < controlRects.length; right += 1) {
        const a = controlRects[left].rect;
        const b = controlRects[right].rect;
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
            Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) {
          overlaps.push(controlRects[left].id + ' / ' + controlRects[right].id);
        }
      }
    }
    const sidebarLinks = Array.from(document.querySelectorAll('.sidebar-nav a')).map(node => ({
      id: node.dataset.navId, href: node.getAttribute('href'), current: node.getAttribute('aria-current'), visible: visible(node),
    }));
    const mobileLinks = Array.from(document.querySelectorAll('.mobile-menu-nav a')).map(node => ({
      id: node.dataset.navId, href: node.getAttribute('href'), current: node.getAttribute('aria-current'),
    }));
    const polarisCard = document.querySelector('.polaris-card');
    const mountedPolarisCard = routeId === 'command-center'
      ? document.querySelector('#commandCenterPolaris[data-polaris-card]')
      : document.getElementById('northstarPolarisSurfaceCard');
    const polarisGrid = mountedPolarisCard && mountedPolarisCard.querySelector('.polaris-card-detail-grid');
    const polarisCardRect = rect(mountedPolarisCard);
    const polarisItemsContained = !mountedPolarisCard || Array.from(mountedPolarisCard.querySelectorAll('li, a, p, span')).every(node => {
      const itemRect = rect(node);
      return itemRect.left >= polarisCardRect.left - 1 && itemRect.right <= polarisCardRect.right + 1;
    });
    const teamCrewLayout = routeId === 'team' ? Array.from(document.querySelectorAll('.wf-crew-member')).map(row => {
      const rowRect = row.getBoundingClientRect();
      const wrapperRect = row.parentElement.getBoundingClientRect();
      const wrapperStyle = getComputedStyle(row.parentElement);
      const wrapperContentWidth = wrapperRect.width -
        parseFloat(wrapperStyle.paddingLeft || '0') - parseFloat(wrapperStyle.paddingRight || '0');
      const memberRect = row.querySelector('.wf-member-toggle').getBoundingClientRect();
      const leadRect = row.querySelector('.wf-lead-toggle').getBoundingClientRect();
      return {
        contained: memberRect.left >= rowRect.left - 1 && leadRect.right <= rowRect.right + 1,
        separated: memberRect.right <= leadRect.left - 4,
        fullWidth: rowRect.width >= wrapperContentWidth - 2,
        contentFits: row.scrollWidth <= row.clientWidth + 1 &&
          row.querySelector('.wf-member-toggle').scrollWidth <= row.querySelector('.wf-member-toggle').clientWidth + 1 &&
          row.querySelector('.wf-lead-toggle').scrollWidth <= row.querySelector('.wf-lead-toggle').clientWidth + 1,
        compactControls: Array.from(row.querySelectorAll('input')).every(input => input.getBoundingClientRect().width <= 20),
        semanticWhitespace: /\S\s+Crew lead$/.test(row.textContent),
        label: row.textContent.trim(),
      };
    }) : null;
    const averageLeadValue = routeId === 'leads' ? document.getElementById('kpiAvgValue') : null;
    return {
      pathname: location.pathname,
      workspace: window.NorthStarDemoRuntime.getWorkspace(),
      body: document.body.textContent,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      sidebarLinks,
      mobileLinks,
      sidebarVisible: visible(document.querySelector('.sidebar')),
      mobileHeaderVisible: visible(document.querySelector('.mobile-header')),
      mobileHeaderPosition: document.querySelector('.mobile-header') && getComputedStyle(document.querySelector('.mobile-header')).position,
      activeSidebar: sidebarLinks.filter(item => item.current === 'page').map(item => item.id),
      activeMobile: mobileLinks.filter(item => item.current === 'page').map(item => item.id),
      genericShells: document.querySelectorAll('.demo-command-layout, .demo-command-nav-link, #demoCommandContent').length,
      contentLeft,
      contentRight,
      mainRect,
      mainPaddingLeft: parseFloat(mainStyle.paddingLeft || '0'),
      mainPaddingRight: parseFloat(mainStyle.paddingRight || '0'),
      toolbarRect,
      nextSurfaceRect: rect(nextSurface),
      overlaps,
      themeRect: rect(document.querySelector('[data-northstar-theme-control]')),
      themeLocation: document.querySelector('[data-northstar-theme-control]') &&
        document.querySelector('[data-northstar-theme-control]').parentElement &&
        document.querySelector('[data-northstar-theme-control]').parentElement.dataset.northstarThemeLocation,
      polarisGridOverflow: polarisGrid ? polarisGrid.scrollWidth - polarisGrid.clientWidth : null,
      polarisItemsContained,
      teamCrewLayout,
      averageLeadValueContained: !averageLeadValue || averageLeadValue.scrollWidth <= averageLeadValue.clientWidth + 1,
      polarisCardCount: document.querySelectorAll('[data-polaris-card="northstar_polaris_intelligence_card_v1"]').length,
      polarisCardPresent: Boolean(mountedPolarisCard),
      polarisCardContract: mountedPolarisCard && mountedPolarisCard.dataset.polarisCard,
      polarisCardSurface: mountedPolarisCard && mountedPolarisCard.dataset.polarisSurface,
      polarisCardState: routeId === 'command-center' ? 'ready' : mountedPolarisCard && mountedPolarisCard.dataset.state,
      polarisCardText: mountedPolarisCard && mountedPolarisCard.textContent,
      polarisObjectHrefs: mountedPolarisCard ? Array.from(mountedPolarisCard.querySelectorAll('.polaris-card-object-links a')).map(node => node.getAttribute('href')) : [],
      polarisDetailed: Boolean(mountedPolarisCard && mountedPolarisCard.querySelector('.polaris-card-details')),
      catalogueState: routeId === 'integrations' && document.getElementById('integrationCatalogueRoot').dataset.state,
      catalogueCategories: routeId === 'integrations' ? document.querySelectorAll('#integrationCategoryList .integration-category').length : null,
      catalogueProviders: routeId === 'integrations' ? document.querySelectorAll('#integrationCategoryList .integration-card').length : null,
      catalogueProviderNames: routeId === 'integrations'
        ? Array.from(document.querySelectorAll('#integrationCategoryList .integration-card h3')).map(node => node.textContent.trim())
        : [],
      routeId,
      routePath,
      mobile,
    };
  }, { routeId: route.id, routePath: route.path, mobile: viewport.width <= 768 });

  assert.strictEqual(snapshot.pathname, route.path, route.path + ' exact route');
  assert.strictEqual(snapshot.workspace.integrity.revision, revision, route.path + ' shared revision');
  assert.strictEqual(snapshot.sidebarLinks.length, ROUTES.length, route.path + ' full canonical desktop navigation');
  assert.strictEqual(snapshot.mobileLinks.length, ROUTES.length, route.path + ' full canonical mobile navigation');
  assert.ok(snapshot.sidebarLinks.concat(snapshot.mobileLinks).every(item => item.href === '/demo' || item.href.startsWith('/demo/')),
    route.path + ' account-free navigation projection');
  assert.deepStrictEqual(snapshot.activeSidebar, [route.id], route.path + ' desktop active destination');
  assert.deepStrictEqual(snapshot.activeMobile, [route.id], route.path + ' mobile active destination');
  assert.strictEqual(snapshot.sidebarVisible, viewport.width > 768, route.path + ' responsive sidebar visibility');
  assert.strictEqual(snapshot.mobileHeaderVisible, viewport.width <= 768, route.path + ' responsive mobile header visibility');
  assert.strictEqual(snapshot.genericShells, 0, route.path + ' generic Parity shell removed');
  assert.ok(snapshot.overflow <= 1, route.path + ' no horizontal overflow');
  if (DEMO_TOOLBAR_ALLOWLIST.includes(route.id)) {
    assert.ok(snapshot.toolbarRect.left - snapshot.mainRect.left >= 11 &&
      snapshot.mainRect.right - snapshot.toolbarRect.right >= 11,
    route.path + ' demo controls retain responsive outer gutters');
    assert.ok(snapshot.toolbarRect.left >= snapshot.contentLeft - 1 && snapshot.toolbarRect.right <= snapshot.contentRight + 1,
      route.path + ' demo controls stay within content gutters');
    if (snapshot.nextSurfaceRect) {
      assert.ok(snapshot.nextSurfaceRect.top - snapshot.toolbarRect.bottom >= 8, route.path + ' demo controls do not touch canonical surface');
    }
  } else {
    assert.strictEqual(snapshot.toolbarRect, null, route.path + ' intentionally omits the simulation box');
  }
  assert.deepStrictEqual(snapshot.overlaps, [], route.path + ' demo controls do not overlap');
  if (hasPolarisSurface(route.id)) {
    assert.strictEqual(snapshot.polarisCardPresent, true, route.path + ' approved Polaris card is mounted');
    assert.strictEqual(snapshot.polarisCardCount, 1, route.path + ' has exactly one mounted Polaris card');
    assert.strictEqual(snapshot.polarisCardContract, 'northstar_polaris_intelligence_card_v1', route.path + ' Polaris card contract');
    assert.strictEqual(snapshot.polarisCardSurface, route.id, route.path + ' page-specific Polaris surface');
    assert.strictEqual(snapshot.polarisCardState, 'ready', route.path + ' Polaris projection ready');
    assert.ok(!snapshot.polarisCardText.includes('[object Object]'), route.path + ' no raw object rendering');
    assert.ok(!snapshot.polarisCardText.includes('Not calculated'), route.path + ' no unexplained calculation placeholder');
    assert.strictEqual(snapshot.polarisDetailed, DETAILED_POLARIS_SURFACES.includes(route.id),
      route.path + ' detailed-card depth');
    if (snapshot.polarisGridOverflow !== null) {
      assert.ok(snapshot.polarisGridOverflow <= 1, route.path + ' Polaris card text stays contained');
      assert.strictEqual(snapshot.polarisItemsContained, true, route.path + ' Polaris items stay within the card');
    }
  } else {
    assert.strictEqual(snapshot.polarisCardPresent, false, route.path + ' has no misplaced standalone Polaris card');
    assert.strictEqual(snapshot.polarisCardCount, 0, route.path + ' has no Polaris contract residue');
  }
  if (route.id === 'integrations') {
    assert.strictEqual(snapshot.catalogueState, 'ready', route.path + ' catalogue contract reaches ready');
    assert.ok(snapshot.catalogueCategories > 0, route.path + ' renders customer-connectable catalogue categories');
    assert.ok(snapshot.catalogueProviders > 0, route.path + ' renders customer-connectable providers');
    assert.ok(!snapshot.catalogueProviderNames.some(name => ['OpenAI', 'Twilio', 'ElevenLabs'].includes(name)),
      route.path + ' hides internal platform providers from the customer catalogue');
  }
  if (route.id === 'team') {
    assert.ok(snapshot.teamCrewLayout.length > 0 && snapshot.teamCrewLayout.every(row =>
      row.contained && row.separated && row.fullWidth && row.contentFits && row.compactControls && row.semanticWhitespace),
      route.path + ' crew membership and lead controls remain contained and distinct: ' + JSON.stringify(snapshot.teamCrewLayout));
  }
  if (route.id === 'leads') {
    assert.strictEqual(snapshot.averageLeadValueContained, true, route.path + ' unavailable average value never wraps mid-word');
  }
  assert.ok(snapshot.themeRect && snapshot.themeRect.left >= 0 && snapshot.themeRect.right <= viewport.width &&
    snapshot.themeRect.top >= 0 && snapshot.themeRect.bottom <= viewport.height,
  route.path + ' theme toggle remains in the viewport');
  assert.strictEqual(snapshot.themeLocation, viewport.width <= 768 ? 'mobile' : 'desktop',
    route.path + ' theme toggle is docked in the visible navigation shell rather than over page content');
  if (viewport.width <= 768) {
    assert.strictEqual(snapshot.mobileHeaderPosition, 'fixed', route.path + ' mobile navigation and theme shell remain viewport-fixed');
  }
  return snapshot;
}

async function exercisePolarisDisclosure(page, route, viewport) {
  if (!DETAILED_POLARIS_SURFACES.includes(route.id)) return;
  const selector = route.id === 'command-center'
    ? '#commandCenterPolaris .polaris-card-details'
    : '#northstarPolarisSurfaceCard .polaris-card-details';
  const details = page.locator(selector);
  assert.strictEqual(await details.count(), 1, route.path + ' one detailed Polaris disclosure');
  assert.strictEqual(await details.evaluate(node => node.open), false, route.path + ' details start collapsed');
  await details.locator('summary').click();
  assert.strictEqual(await details.evaluate(node => node.open), true, route.path + ' details expand by click');
  await details.locator('summary').click();
  assert.strictEqual(await details.evaluate(node => node.open), false, route.path + ' details collapse by click');
  console.log('PARITY_BROWSER_CHECKPOINT ' + viewport.label + ' polaris-disclosure ' + route.id);
}

async function enterDemo(page, origin, revision, viewport) {
  const route = ROUTES[0];
  const response = await page.goto(origin + route.path, { waitUntil: 'domcontentloaded', timeout: 15000 });
  assert.ok(response, route.path + ' entry response');
  assert.ok([200, 304].includes(response.status()), route.path + ' shell HTTP ' + response.status());
  return inspectCurrent(page, route, revision, viewport);
}

async function mobileMenuSnapshot(page, routeId) {
  return page.evaluate(expectedRouteId => {
    function rect(node) {
      if (!node) return null;
      const value = node.getBoundingClientRect();
      return {
        left: value.left,
        right: value.right,
        top: value.top,
        bottom: value.bottom,
        width: value.width,
        height: value.height,
      };
    }
    const menu = document.getElementById('mobileMenu');
    const overlay = document.getElementById('mobileOverlay');
    const hamburger = document.getElementById('navHamburgerBtn');
    const mobileHeader = document.querySelector('.mobile-header');
    const sidebar = document.querySelector('.sidebar');
    const firstSidebarLink = sidebar && sidebar.querySelector('.sidebar-nav a');
    const link = menu && menu.querySelector('a[data-nav-id="' + expectedRouteId + '"]');
    const menuStyle = menu && getComputedStyle(menu);
    const overlayStyle = overlay && getComputedStyle(overlay);
    const linkRect = rect(link);
    const sidebarLinkRect = rect(firstSidebarLink);
    const hit = linkRect && document.elementFromPoint(
      Math.max(0, Math.min(innerWidth - 1, linkRect.left + (linkRect.width / 2))),
      Math.max(0, Math.min(innerHeight - 1, linkRect.top + (linkRect.height / 2)))
    );
    const sidebarHit = sidebarLinkRect && document.elementFromPoint(
      Math.max(0, Math.min(innerWidth - 1, sidebarLinkRect.left + (sidebarLinkRect.width / 2))),
      Math.max(0, Math.min(innerHeight - 1, sidebarLinkRect.top + (sidebarLinkRect.height / 2)))
    );
    return {
      viewport: { width: innerWidth, height: innerHeight },
      menuRect: rect(menu),
      linkRect,
      menuClass: menu && menu.className,
      menuState: menu && menu.dataset.state,
      menuTransform: menuStyle && menuStyle.transform,
      menuVisibility: menuStyle && menuStyle.visibility,
      menuPointerEvents: menuStyle && menuStyle.pointerEvents,
      overlayDisplay: overlayStyle && overlayStyle.display,
      overlayOpacity: overlayStyle && overlayStyle.opacity,
      overlayHidden: overlay && overlay.getAttribute('aria-hidden'),
      expanded: hamburger && hamburger.getAttribute('aria-expanded'),
      menuHidden: menu && menu.getAttribute('aria-hidden'),
      menuInert: Boolean(menu && menu.hasAttribute('inert')),
      bodyInlineOverflow: document.body.style.overflow,
      activeId: document.activeElement && document.activeElement.id,
      activeInsideMenu: Boolean(menu && menu.contains(document.activeElement)),
      linkOwnsHit: Boolean(link && hit && link.contains(hit)),
      mobileHeaderDisplay: mobileHeader && getComputedStyle(mobileHeader).display,
      sidebarDisplay: sidebar && getComputedStyle(sidebar).display,
      sidebarRect: rect(sidebar),
      sidebarLinkRect,
      sidebarLinkCount: sidebar && sidebar.querySelectorAll('.sidebar-nav a').length,
      sidebarLinkOwnsHit: Boolean(firstSidebarLink && sidebarHit && firstSidebarLink.contains(sidebarHit)),
      sidebarHit: sidebarHit && {
        tag: sidebarHit.tagName,
        id: sidebarHit.id,
        className: typeof sidebarHit.className === 'string' ? sidebarHit.className : '',
      },
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  }, routeId);
}

function assertMobileMenuClosed(snapshot, label) {
  assert.ok(snapshot.menuRect && snapshot.menuRect.right <= 1,
    label + ': closed menu stays fully off-canvas');
  assert.strictEqual(snapshot.expanded, 'false', label + ': hamburger reports collapsed state');
  assert.strictEqual(snapshot.menuHidden, 'true', label + ': closed menu is hidden from assistive technology');
  assert.strictEqual(snapshot.menuInert, true, label + ': closed menu cannot receive keyboard or pointer interaction');
  assert.strictEqual(snapshot.menuState, 'closed', label + ': closed state is explicit');
  assert.strictEqual(snapshot.menuVisibility, 'hidden', label + ': closed menu is not visibly painted');
  assert.strictEqual(snapshot.menuPointerEvents, 'none', label + ': closed menu cannot intercept pointer input');
  assert.strictEqual(snapshot.overlayHidden, 'true', label + ': closed overlay is hidden from assistive technology');
  assert.strictEqual(snapshot.bodyInlineOverflow, '', label + ': closed menu restores body scrolling');
  assert.ok(snapshot.documentOverflow <= 1, label + ': closed menu creates no horizontal overflow');
}

function assertMobileMenuOpen(snapshot, label) {
  assert.ok(snapshot.menuRect && snapshot.menuRect.left >= -1 && snapshot.menuRect.right <= snapshot.viewport.width + 1,
    label + ': open menu is fully inside the viewport');
  assert.ok(snapshot.linkRect && snapshot.linkRect.left >= 0 && snapshot.linkRect.right <= snapshot.viewport.width &&
    snapshot.linkRect.top >= 0 && snapshot.linkRect.bottom <= snapshot.viewport.height,
    label + ': requested route link is visibly inside the viewport');
  assert.strictEqual(snapshot.expanded, 'true', label + ': hamburger reports expanded state');
  assert.strictEqual(snapshot.menuHidden, 'false', label + ': open menu is exposed to assistive technology');
  assert.strictEqual(snapshot.menuInert, false, label + ': open menu accepts keyboard and pointer interaction');
  assert.strictEqual(snapshot.menuState, 'open', label + ': open state is explicit');
  assert.strictEqual(snapshot.menuVisibility, 'visible', label + ': open menu is visibly painted');
  assert.strictEqual(snapshot.menuPointerEvents, 'auto', label + ': open menu accepts pointer input');
  assert.notStrictEqual(snapshot.overlayDisplay, 'none', label + ': open overlay is painted');
  assert.strictEqual(snapshot.overlayHidden, 'false', label + ': open overlay state is truthful');
  assert.strictEqual(snapshot.bodyInlineOverflow, 'hidden', label + ': open menu locks body scrolling');
  assert.strictEqual(snapshot.linkOwnsHit, true, label + ': no off-screen duplicate or overlay intercepts the route link');
  assert.ok(snapshot.documentOverflow <= 1, label + ': open menu creates no horizontal overflow');
}

async function waitForMobileMenuState(page, expectedOpen) {
  await page.waitForFunction(open => {
    const menu = document.getElementById('mobileMenu');
    if (!menu) return false;
    const value = menu.getBoundingClientRect();
    const style = getComputedStyle(menu);
    return open
      ? menu.classList.contains('open') && menu.dataset.state === 'open' &&
          value.left >= -1 && value.right <= innerWidth + 1 && style.visibility === 'visible'
      : !menu.classList.contains('open') && menu.dataset.state === 'closed' &&
          value.right <= 1 && style.visibility === 'hidden';
  }, expectedOpen, { timeout: 3000 });
}

async function openMobileMenu(page, routeId, label, keyboard) {
  const hamburger = page.locator('#navHamburgerBtn');
  if (keyboard) {
    await hamburger.focus();
    await page.keyboard.press('Enter');
  } else {
    await hamburger.click();
  }
  await waitForMobileMenuState(page, true);
  const snapshot = await mobileMenuSnapshot(page, routeId);
  assertMobileMenuOpen(snapshot, label);
  assert.strictEqual(snapshot.activeId, 'navCloseBtn', label + ': focus enters the open navigation drawer');
  return snapshot;
}

async function exerciseMobileMenuControls(page, viewport, mode) {
  const label = viewport.label + '/' + mode + '-controls';
  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = 'auto';
    window.scrollTo(0, 0);
  });
  await page.waitForFunction(() => window.scrollY <= 1);
  await page.evaluate(() => document.documentElement.style.removeProperty('scroll-behavior'));
  const initial = await mobileMenuSnapshot(page, 'polaris');
  assertMobileMenuClosed(initial, label + '/initial');
  if (viewport.width > 768) {
    assert.strictEqual(initial.mobileHeaderDisplay, 'none', label + ': desktop/tablet hamburger remains hidden');
    assert.notStrictEqual(initial.sidebarDisplay, 'none', label + ': desktop/tablet sidebar remains visible');
    assert.ok(initial.sidebarRect && initial.sidebarRect.left >= 0 && initial.sidebarRect.right <= initial.viewport.width,
      label + ': desktop/tablet sidebar stays in the viewport');
    assert.strictEqual(initial.sidebarLinkCount, ROUTES.length, label + ': desktop/tablet keeps every route link');
    assert.strictEqual(initial.sidebarLinkOwnsHit, true,
      label + ': desktop/tablet route link owns its hit target: ' + JSON.stringify({
        sidebar: initial.sidebarRect,
        link: initial.sidebarLinkRect,
        hit: initial.sidebarHit,
      }));
    return;
  }

  await openMobileMenu(page, 'polaris', label + '/keyboard-open', true);
  await captureEvidence(page, mode + '-navigation', ROUTES[1], viewport, 'menu-open');
  await page.keyboard.press('Tab');
  assert.strictEqual((await mobileMenuSnapshot(page, 'polaris')).activeInsideMenu, true,
    label + ': Tab navigation stays inside the open drawer');
  await page.keyboard.press('Escape');
  await waitForMobileMenuState(page, false);
  const escaped = await mobileMenuSnapshot(page, 'polaris');
  assertMobileMenuClosed(escaped, label + '/escape-close');
  assert.strictEqual(escaped.activeId, 'navHamburgerBtn', label + ': Escape returns focus to the hamburger');

  await openMobileMenu(page, 'polaris', label + '/outside-open', false);
  const outsidePoint = await page.evaluate(() => ({ x: innerWidth - 12, y: Math.min(innerHeight - 12, 100) }));
  assert.strictEqual(await page.evaluate(point => {
    const node = document.elementFromPoint(point.x, point.y);
    return Boolean(node && node.id === 'mobileOverlay');
  }, outsidePoint), true, label + ': backdrop owns the outside-click target');
  await page.mouse.click(outsidePoint.x, outsidePoint.y);
  await waitForMobileMenuState(page, false);
  assertMobileMenuClosed(await mobileMenuSnapshot(page, 'polaris'), label + '/outside-close');

  await openMobileMenu(page, 'polaris', label + '/button-open', false);
  await page.locator('#navCloseBtn').click();
  await waitForMobileMenuState(page, false);
  assertMobileMenuClosed(await mobileMenuSnapshot(page, 'polaris'), label + '/button-close');
}

async function clickVisibleMobileRoute(page, origin, route, label) {
  const opened = await openMobileMenu(page, route.id, label + '/open', false);
  const point = {
    x: opened.linkRect.left + (opened.linkRect.width / 2),
    y: opened.linkRect.top + (opened.linkRect.height / 2),
  };
  await Promise.all([
    page.waitForURL(url => url.origin === origin && url.pathname === route.path, { timeout: 15000 }),
    page.mouse.click(point.x, point.y),
  ]);
}

async function clickRoute(page, origin, route, revision, viewport) {
  const mobile = viewport.width <= 768;
  if (mobile) {
    await clickVisibleMobileRoute(page, origin, route, viewport.label + '/demo/' + route.id);
  } else {
    const selector = '.sidebar-nav a[data-nav-id="' + route.id + '"]';
    await Promise.all([
      page.waitForURL(url => url.origin === origin && url.pathname === route.path, { timeout: 15000 }),
      page.click(selector),
    ]);
  }
  const snapshot = await inspectCurrent(page, route, revision, viewport);
  if (mobile) assertMobileMenuClosed(await mobileMenuSnapshot(page, route.id), viewport.label + '/demo/' + route.id + '/arrival');
  return snapshot;
}

async function waitPaidReady(page, route) {
  await page.waitForFunction(({ marker, surface, routeId, expectsPolaris }) => {
    const account = window.NorthStarAccountSession && window.NorthStarAccountSession.getAccount &&
      window.NorthStarAccountSession.getAccount();
    const mountedCard = routeId === 'command-center'
      ? document.querySelector('#commandCenterPolaris[data-polaris-card="northstar_polaris_intelligence_card_v1"]')
      : document.querySelector('#northstarPolarisSurfaceCard[data-state="ready"]');
    const cardReady = expectsPolaris ? Boolean(mountedCard) : !mountedCard;
    return account && document.documentElement.getAttribute('data-northstar-navigation') === 'ready' &&
      !document.getElementById('northstarDemoToolbar') && document.querySelector(surface) && cardReady &&
      document.body.textContent.includes(marker);
  }, {
    marker: route.marker, surface: route.surface, routeId: route.id,
    expectsPolaris: hasPolarisSurface(route.id),
  }, { timeout: 15000 });
}

async function inspectPaidCurrent(page, route, viewport, expectedLeadHref) {
  await waitPaidReady(page, route);
  await waitCatalogueTerminal(page, route);
  await inspectProfessionalPresentation(page, route.paidPath + ' ' + viewport.label);
  const snapshot = await page.evaluate(({ routeId, expectedPath }) => {
    function rect(node) {
      if (!node) return null;
      const value = node.getBoundingClientRect();
      return { left: value.left, right: value.right, top: value.top, bottom: value.bottom };
    }
    const mounted = routeId === 'command-center'
      ? document.querySelector('#commandCenterPolaris[data-polaris-card]')
      : document.getElementById('northstarPolarisSurfaceCard');
    const cardRect = rect(mounted);
    const contained = !mounted || Array.from(mounted.querySelectorAll('li, a, p, span')).filter(node => {
      return typeof node.checkVisibility === 'function'
        ? node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
        : node.getClientRects().length > 0;
    }).every(node => {
      const value = rect(node);
      return value.left >= cardRect.left - 1 && value.right <= cardRect.right + 1;
    });
    const sidebarLinks = Array.from(document.querySelectorAll('.sidebar-nav a')).map(node => ({
      id: node.dataset.navId, href: node.getAttribute('href'), current: node.getAttribute('aria-current'),
    }));
    const mobileLinks = Array.from(document.querySelectorAll('.mobile-menu-nav a')).map(node => ({
      id: node.dataset.navId, href: node.getAttribute('href'), current: node.getAttribute('aria-current'),
    }));
    return {
      pathname: location.pathname,
      expectedPath,
      body: document.body.innerText,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      toolbar: Boolean(document.getElementById('northstarDemoToolbar')),
      sidebarLinks,
      mobileLinks,
      activeSidebar: sidebarLinks.filter(item => item.current === 'page').map(item => item.id),
      activeMobile: mobileLinks.filter(item => item.current === 'page').map(item => item.id),
      cardCount: document.querySelectorAll('[data-polaris-card="northstar_polaris_intelligence_card_v1"]').length,
      cardContract: mounted && mounted.dataset.polarisCard,
      cardSurface: mounted && mounted.dataset.polarisSurface,
      cardState: routeId === 'command-center' ? 'ready' : mounted && mounted.dataset.state,
      cardText: mounted && mounted.innerText,
      cardDetailed: Boolean(mounted && mounted.querySelector('.polaris-card-details')),
      cardContained: contained,
      objectHrefs: mounted ? Array.from(mounted.querySelectorAll('.polaris-card-object-links a')).map(node => node.getAttribute('href')) : [],
      catalogueState: routeId === 'integrations' && document.getElementById('integrationCatalogueRoot').dataset.state,
      catalogueCategories: routeId === 'integrations' ? document.querySelectorAll('#integrationCategoryList .integration-category').length : null,
      catalogueProviders: routeId === 'integrations' ? document.querySelectorAll('#integrationCategoryList .integration-card').length : null,
      catalogueProviderNames: routeId === 'integrations'
        ? Array.from(document.querySelectorAll('#integrationCategoryList .integration-card h3')).map(node => node.textContent.trim())
        : [],
    };
  }, { routeId: route.id, expectedPath: route.paidPath });

  assert.strictEqual(snapshot.pathname, route.paidPath, route.paidPath + ' exact paid route');
  assert.strictEqual(snapshot.toolbar, false, route.paidPath + ' has no demo controls');
  assert.strictEqual(snapshot.sidebarLinks.length, ROUTES.length, route.paidPath + ' full paid desktop navigation');
  assert.strictEqual(snapshot.mobileLinks.length, ROUTES.length, route.paidPath + ' full paid mobile navigation');
  assert.deepStrictEqual(snapshot.sidebarLinks.map(item => item.href), ROUTES.map(item => item.paidPath),
    route.paidPath + ' exact paid desktop destinations');
  assert.deepStrictEqual(snapshot.mobileLinks.map(item => item.href), ROUTES.map(item => item.paidPath),
    route.paidPath + ' exact paid mobile destinations');
  assert.deepStrictEqual(snapshot.activeSidebar, [route.id], route.paidPath + ' paid desktop active destination');
  assert.deepStrictEqual(snapshot.activeMobile, [route.id], route.paidPath + ' paid mobile active destination');
  assert.ok(snapshot.overflow <= 1, route.paidPath + ' has no horizontal overflow at ' + viewport.label);
  assert.ok(!snapshot.body.includes(PAID_CUSTOMER_B), route.paidPath + ' excludes tenant B data');
  assert.ok(!/Simulate Lead|Reset demo|account-free demo workspace|fictional demo workspace/i.test(snapshot.body),
    route.paidPath + ' contains no demo controls or language');
  if (hasPolarisSurface(route.id)) {
    assert.strictEqual(snapshot.cardCount, 1, route.paidPath + ' exactly one mounted Polaris card');
    assert.strictEqual(snapshot.cardContract, 'northstar_polaris_intelligence_card_v1', route.paidPath + ' shared card contract');
    assert.strictEqual(snapshot.cardSurface, route.id, route.paidPath + ' page-specific projection');
    assert.strictEqual(snapshot.cardState, 'ready', route.paidPath + ' role-authorized projection ready');
    assert.strictEqual(snapshot.cardContained, true, route.paidPath + ' card content stays contained');
    assert.strictEqual(snapshot.cardDetailed, DETAILED_POLARIS_SURFACES.includes(route.id),
      route.paidPath + ' detailed-card depth');
    assert.ok(!snapshot.cardText.includes('[object Object]') && !snapshot.cardText.includes('Not calculated'),
      route.paidPath + ' card remains human-readable');
    assert.deepStrictEqual(snapshot.objectHrefs, [expectedLeadHref],
      route.paidPath + ' exposes one focused complete-intelligence path for the exact tenant A lead');
  } else {
    assert.strictEqual(snapshot.cardCount, 0, route.paidPath + ' has no misplaced standalone Polaris card');
    assert.strictEqual(snapshot.cardContract, null, route.paidPath + ' has no Polaris card contract residue');
    assert.deepStrictEqual(snapshot.objectHrefs, [], route.paidPath + ' has no orphaned Polaris object actions');
  }
  if (route.id === 'integrations') {
    assert.strictEqual(snapshot.catalogueState, 'ready', route.paidPath + ' catalogue contract reaches ready');
    assert.ok(snapshot.catalogueCategories > 0, route.paidPath + ' renders customer-connectable catalogue categories');
    assert.ok(snapshot.catalogueProviders > 0, route.paidPath + ' renders customer-connectable providers');
    assert.ok(!snapshot.catalogueProviderNames.some(name => ['OpenAI', 'Twilio', 'ElevenLabs'].includes(name)),
      route.paidPath + ' hides internal platform providers from the customer catalogue');
  }
  return snapshot;
}

async function clickPaidRoute(page, origin, route, viewport, expectedLeadHref) {
  const mobile = viewport.width <= 768;
  if (mobile) {
    const projectedRoute = { id: route.id, path: route.paidPath };
    await clickVisibleMobileRoute(page, origin, projectedRoute, viewport.label + '/paid/' + route.id);
  } else {
    const selector = '.sidebar-nav a[data-nav-id="' + route.id + '"]';
    await Promise.all([
      page.waitForURL(url => url.origin === origin && url.pathname === route.paidPath, { timeout: 15000 }),
      page.click(selector),
    ]);
  }
  const snapshot = await inspectPaidCurrent(page, route, viewport, expectedLeadHref);
  if (mobile) assertMobileMenuClosed(await mobileMenuSnapshot(page, route.id), viewport.label + '/paid/' + route.id + '/arrival');
  return snapshot;
}

async function exercisePaidViewport(browser, origin, viewport, session, ledger, expectedLeadHref) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, serviceWorkers: 'block' });
  context.setDefaultTimeout(10000);
  await context.addCookies(Object.entries(session.cookies).map(([name, value]) => ({
    name, value, url: origin, httpOnly: name !== 'northstar_csrf', sameSite: 'Lax',
  })));
  const label = 'paid-' + viewport.label;
  const page = await context.newPage();
  page.on('request', request => ledger.requests.push({ viewport: label, method: request.method(), url: request.url() }));
  page.on('response', response => {
    if (response.status() >= 400) ledger.httpErrors.push({ viewport: label, status: response.status(), url: response.url() });
  });
  page.on('console', message => {
    const location = message.location();
    const source = location && location.url ? ' [' + location.url + (location.lineNumber != null ? ':' + location.lineNumber : '') + ']' : '';
    if (message.type() === 'warning') ledger.warnings.push(label + ': ' + message.text() + source);
    if (message.type() === 'error') ledger.consoleErrors.push(label + ': ' + message.text() + source);
  });
  page.on('pageerror', error => ledger.pageErrors.push(label + ': ' + error.message));
  try {
    const entry = await page.goto(origin + ROUTES[0].paidPath, { waitUntil: 'domcontentloaded', timeout: 15000 });
    assert.ok(entry && [200, 304].includes(entry.status()), 'paid Command Center shell loads');
    const first = await inspectPaidCurrent(page, ROUTES[0], viewport, expectedLeadHref);
    await captureEvidence(page, 'paid', ROUTES[0], viewport, 'canonical');
    await exerciseMobileMenuControls(page, viewport, 'paid');
    await exerciseTheme(page, viewport);
    await captureEvidence(page, 'paid', ROUTES[0], viewport, 'theme');
    assert.strictEqual(first.objectHrefs.length, 1, viewport.label + ' paid Command Center exposes one focused complete-intelligence path');
    const absentEstimate = await page.evaluate(() => {
      const valueCard = Array.from(document.querySelectorAll('#commandCenterKpis .demo-kpi-card')).find(card => {
        const label = card.querySelector('span');
        return label && label.textContent.trim() === 'Recorded opportunity value';
      });
      return {
        kpiValue: valueCard && valueCard.querySelector('strong') && valueCard.querySelector('strong').textContent.trim(),
        kpiNote: valueCard && valueCard.querySelector('small') && valueCard.querySelector('small').textContent.trim(),
        chart: document.getElementById('commandCenterChartBars').innerText,
        chartSummary: document.getElementById('commandCenterChartSummary').innerText,
        tableValues: Array.from(document.querySelectorAll('#commandCenterLeadRows tr td:nth-child(3)'))
          .map(cell => cell.textContent.trim()),
        polaris: document.getElementById('commandCenterPolaris').innerText,
      };
    });
    assert.strictEqual(absentEstimate.kpiValue, 'Unavailable', viewport.label + ' null estimate stays unavailable in the paid KPI');
    assert.strictEqual(absentEstimate.kpiNote, 'No role-authorized customer price is available.',
      viewport.label + ' paid KPI explains the absent canonical price');
    assert.ok(absentEstimate.chart.includes('No recorded opportunity values are available for this view.'),
      viewport.label + ' null estimate stays absent from the chart');
    assert.ok(absentEstimate.chartSummary.includes('empty until a role-authorized estimate is recorded'),
      viewport.label + ' paid chart explains its missing input');
    assert.deepStrictEqual(absentEstimate.tableValues, ['Unavailable — no recorded estimate'],
      viewport.label + ' paid table does not fabricate a zero-dollar estimate');
    assert.ok(!absentEstimate.polaris.includes('A recorded customer-facing estimate is available for review.'),
      viewport.label + ' paid Polaris card does not claim an absent estimate exists');
    await exercisePolarisDisclosure(page, { ...ROUTES[0], path: ROUTES[0].paidPath }, viewport);

    for (const route of ROUTES.slice(1)) {
      await clickPaidRoute(page, origin, route, viewport, expectedLeadHref);
      await exercisePolarisDisclosure(page, { ...route, path: route.paidPath }, viewport);
      await captureEvidence(page, 'paid', route, viewport, 'canonical');
      console.log('PARITY_BROWSER_CHECKPOINT paid-' + viewport.label + ' route ' + route.id);
    }

    await clickPaidRoute(page, origin, ROUTES[0], viewport, expectedLeadHref);
    const leadLink = page.locator('#commandCenterPolaris .polaris-card-primary-action').first();
    const leadHref = await leadLink.getAttribute('href');
    assert.ok(leadHref && leadHref.startsWith('/dashboard/polaris?kind=lead&id='), viewport.label + ' paid lead path');
    await Promise.all([
      page.waitForURL(url => url.origin === origin && url.pathname + url.search === leadHref, { timeout: 15000 }),
      leadLink.click(),
    ]);
    const detail = await inspectPaidCurrent(page, ROUTES[1], viewport, expectedLeadHref);
    await captureEvidence(page, 'paid', ROUTES[1], viewport, 'object-detail');
    assert.strictEqual(detail.cardCount, 0, viewport.label + ' paid Polaris remains chat-centric without a duplicate surface card');
    assert.ok(!detail.body.includes(PAID_CUSTOMER_B), viewport.label + ' paid Polaris excludes tenant B');
    console.log('PARITY_BROWSER_CHECKPOINT paid-' + viewport.label + ' complete');
    return { viewport: viewport.label, routes: ROUTES.length, tenant: PAID_ORG_A };
  } finally {
    await context.close();
  }
}

async function exerciseTheme(page, viewport) {
  const before = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, url: location.href }));
  await page.click('[data-northstar-theme-toggle]');
  await page.waitForFunction(previous => {
    const root = document.documentElement;
    return root.dataset.theme && root.dataset.theme !== previous && !root.hasAttribute('data-theme-switching');
  }, before.theme);
  const after = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    url: location.href,
    rect: (() => { const value = document.querySelector('[data-northstar-theme-control]').getBoundingClientRect(); return { left: value.left, right: value.right, top: value.top, bottom: value.bottom }; })(),
  }));
  assert.notStrictEqual(after.theme, before.theme, viewport.label + ' theme changes on click');
  assert.strictEqual(after.url, before.url, viewport.label + ' theme click does not navigate');
  assert.ok(after.rect.left >= 0 && after.rect.right <= viewport.width && after.rect.top >= 0 && after.rect.bottom <= viewport.height,
    viewport.label + ' theme control stays flush and visible');
}

async function exerciseViewport(browser, origin, viewport, ledger) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, serviceWorkers: 'block' });
  context.setDefaultTimeout(10000);
  const page = await context.newPage();
  page.on('request', request => ledger.requests.push({ viewport: viewport.label, method: request.method(), url: request.url() }));
  page.on('response', response => {
    if (response.status() >= 400) ledger.httpErrors.push({ viewport: viewport.label, status: response.status(), url: response.url() });
  });
  page.on('console', message => {
    const location = message.location();
    const source = location && location.url ? ' [' + location.url + (location.lineNumber != null ? ':' + location.lineNumber : '') + ']' : '';
    if (message.type() === 'warning') ledger.warnings.push(viewport.label + ': ' + message.text() + source);
    if (message.type() === 'error') {
      const entry = viewport.label + ': ' + message.text() + source;
      ledger.consoleErrors.push(entry);
      console.log('PARITY_BROWSER_CONSOLE_ERROR ' + entry);
    }
  });
  page.on('pageerror', error => ledger.pageErrors.push(viewport.label + ': ' + error.message));
  try {
    console.log('PARITY_BROWSER_CHECKPOINT ' + viewport.label + ' entry');
    const initial = await enterDemo(page, origin, 1, viewport);
    await captureEvidence(page, 'demo', ROUTES[0], viewport, 'seed');
    await exercisePolarisDisclosure(page, ROUTES[0], viewport);
    assert.strictEqual(initial.workspace.session.durable, false, viewport.label + ' GET remains projection-only');
    assert.strictEqual(initial.workspace.graphs.length, 3, viewport.label + ' seed graph count');
    const initialConfiguration = initial.workspace.configuration;
    const initialNavigation = initial.workspace.navigation;
    const initialDigest = initial.workspace.integrity.digest;
    await exerciseMobileMenuControls(page, viewport, 'demo');
    await exerciseTheme(page, viewport);
    console.log('PARITY_BROWSER_CHECKPOINT ' + viewport.label + ' theme');

    for (const route of ROUTES.slice(1)) {
      const snapshot = await clickRoute(page, origin, route, 1, viewport);
      await exercisePolarisDisclosure(page, route, viewport);
      await captureEvidence(page, 'demo', route, viewport, 'seed');
      assert.strictEqual(snapshot.workspace.integrity.digest, initialDigest, route.path + ' exact initial digest');
      if (route.id === 'polaris') {
        const requestOffset = ledger.requests.length;
        const prompt = page.locator('#polarisPromptInput').first();
        const send = page.locator('#polarisSendBtn').first();
        await prompt.fill("What's my pipeline health?");
        await send.click();
        await page.waitForFunction(() => Array.from(document.querySelectorAll('.polaris-chat-message')).some(node =>
          node.textContent.includes('The current demo pipeline contains') &&
          node.textContent.includes('no live provider request was sent')
        ));
        const chatRequests = ledger.requests.slice(requestOffset).filter(entry =>
          new URL(entry.url).pathname === '/api/v1/polaris/chat'
        );
        assert.deepStrictEqual(chatRequests, [], viewport.label + ' demo Polaris chat stays browser-local');
      }
      console.log('PARITY_BROWSER_CHECKPOINT ' + viewport.label + ' route ' + route.id);
    }

    await clickRoute(page, origin, ROUTES[0], 1, viewport);
    const scenarioBuilder = page.locator('.northstar-demo-scenario-builder');
    if (!(await scenarioBuilder.evaluate(node => node.open))) {
      await scenarioBuilder.locator('summary').click();
    }
    const scenarioSelection = {
      business: 'multi_crew',
      service: 'roofing',
      intent: 'second_opinion',
      urgency: 'safety_emergency',
      context: 'insurance_claim',
      scheduling: 'weather_window',
      outcome: 'booked',
    };
    for (const [dimension, value] of Object.entries(scenarioSelection)) {
      await page.selectOption('[data-scenario-dimension="' + dimension + '"]', value);
    }
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
      page.click('#demoSimulateLead'),
    ]);
    await waitReady(page, ROUTES[0], 2);
    console.log('PARITY_BROWSER_CHECKPOINT ' + viewport.label + ' simulated');
    const simulated = await page.evaluate(() => window.NorthStarDemoRuntime.getWorkspace());
    assert.strictEqual(simulated.session.durable, true, viewport.label + ' explicit mutation creates durable session');
    assert.strictEqual(simulated.session.simulationCount, 1, viewport.label + ' simulation count');
    assert.strictEqual(simulated.graphs.length, 4, viewport.label + ' one added graph');
    assert.notStrictEqual(simulated.integrity.digest, initialDigest, viewport.label + ' state digest advances');
    assert.deepStrictEqual(simulated.configuration, initialConfiguration, viewport.label + ' configuration remains stable');
    assert.deepStrictEqual(simulated.navigation, initialNavigation, viewport.label + ' navigation remains stable');
    const added = simulated.graphs[0];
    assert.strictEqual(added.lead.serviceType, 'roofing', viewport.label + ' selected service');
    assert.deepStrictEqual(added.scenario.selection, scenarioSelection, viewport.label + ' complete selected scenario');
    assert.strictEqual(added.polaris.snapshot.risk.emergency, true, viewport.label + ' urgency changes Polaris risk');
    assert.ok(added.communication.transcript.some(turn => turn.text.includes('second opinion')),
      viewport.label + ' caller intent changes the generated conversation');
    assert.strictEqual(added.polaris.completeDetail, true, viewport.label + ' complete Polaris detail');
    assert.match(added.polaris.snapshotDigest, /^[0-9a-f]{64}$/, viewport.label + ' snapshot digest');
    const simulatedCommandCard = await inspectCurrent(page, ROUTES[0], 2, viewport);
    await captureEvidence(page, 'demo', ROUTES[0], viewport, 'simulated');
    assert.ok(simulatedCommandCard.polarisObjectHrefs.some(href => href && href.includes(encodeURIComponent(added.ids.lead))),
      viewport.label + ' Command Center card links to the simulated lead detail');

    const leadsRoute = ROUTES.find(route => route.id === 'leads');
    console.log('PARITY_BROWSER_CHECKPOINT ' + viewport.label + ' leads-revisit-start');
    const leads = await clickRoute(page, origin, leadsRoute, 2, viewport);
    await page.waitForFunction(name => Array.from(document.querySelectorAll('#leadsContent tr'))
      .some(row => row.textContent.includes(name)), added.customer.name, { timeout: 10000 });
    assert.ok(leads.workspace.graphs.some(graph => graph.ids.graph === added.ids.graph), 'Leads reads the committed graph');
    const rowTarget = await page.evaluate(async name => {
      const row = Array.from(document.querySelectorAll('#leadsContent tr')).find(candidate => candidate.textContent.includes(name));
      if (!row) return null;
      row.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const value = row.getBoundingClientRect();
      const visibleLeft = Math.max(0, value.left);
      const visibleRight = Math.min(window.innerWidth, value.right);
      const visibleTop = Math.max(0, value.top);
      const visibleBottom = Math.min(window.innerHeight, value.bottom);
      const x = visibleLeft + (visibleRight - visibleLeft) / 2;
      const y = visibleTop + (visibleBottom - visibleTop) / 2;
      const hit = document.elementFromPoint(x, y);
      return {
        x,
        y,
        rowLeft: value.left,
        rowRight: value.right,
        rowTop: value.top,
        rowBottom: value.bottom,
        width: visibleRight - visibleLeft,
        height: visibleBottom - visibleTop,
        hitTag: hit && hit.tagName,
        hitId: hit && hit.id,
        hitClass: hit && hit.className,
        exactHit: Boolean(hit && hit.closest('#leadsContent tr') === row),
      };
    }, added.customer.name);
    assert.ok(rowTarget && rowTarget.width > 0 && rowTarget.height > 0 && rowTarget.exactHit,
      viewport.label + ' newly rendered lead row is unobstructed and actionable: ' + JSON.stringify(rowTarget));
    if (viewport.width <= 768) {
      const mobileLeadLayout = await page.evaluate(name => {
        const row = Array.from(document.querySelectorAll('#leadsContent tr')).find(candidate => candidate.textContent.includes(name));
        const cells = row ? Array.from(row.querySelectorAll('td')) : [];
        return {
          rowDisplay: row && getComputedStyle(row).display,
          overflow: document.getElementById('leadsContent').scrollWidth - document.getElementById('leadsContent').clientWidth,
          labels: cells.map(cell => cell.dataset.label),
          narrowestCell: cells.length ? Math.min.apply(null, cells.slice(0, -1).map(cell => cell.getBoundingClientRect().width)) : 0,
        };
      }, added.customer.name);
      assert.strictEqual(mobileLeadLayout.rowDisplay, 'grid', 'mobile Leads renders each customer as a readable card');
      assert.ok(mobileLeadLayout.overflow <= 1, 'mobile Leads cards do not require horizontal scrolling');
      assert.deepStrictEqual(mobileLeadLayout.labels,
        ['Customer', 'Phone', 'Service', 'Estimated value', 'Date', 'Status', 'Actions'],
        'mobile Leads cards retain explicit human-readable field labels');
      assert.ok(mobileLeadLayout.narrowestCell >= 240,
        'mobile Leads values have enough width to avoid letter-by-letter wrapping: ' + JSON.stringify(mobileLeadLayout));
    }
    await page.mouse.click(rowTarget.x, rowTarget.y);
    console.log('PARITY_BROWSER_CHECKPOINT ' + viewport.label + ' lead-row-clicked');
    await page.waitForFunction(name => {
      const drawer = document.getElementById('cdCustomerDrawer');
      const content = document.getElementById('cdDrawerContent');
      return drawer && drawer.classList.contains('open') && content && getComputedStyle(content).display !== 'none' &&
        drawer.textContent.includes(name) && drawer.textContent.includes('POLARIS');
    }, added.customer.name, { timeout: 10000 });
    const drawerText = await page.locator('#cdCustomerDrawer').innerText();
    console.log('PARITY_BROWSER_CHECKPOINT ' + viewport.label + ' drawer-ready');
    assert.ok(drawerText.includes(added.customer.name), viewport.label + ' clicked customer opens canonical detail');
    assert.ok(drawerText.includes(added.lead.serviceLabel), viewport.label + ' detail retains canonical service');
    assert.ok(drawerText.includes('POLARIS'), viewport.label + ' detail contains Polaris intelligence');
    for (const heading of [
      'Contact Information', 'Customer Profile', 'Job Details', 'Description',
      'Gates and missing information', 'Materials', 'Equipment', 'Scheduling', 'Pricing', 'Risk',
    ]) {
      assert.ok(drawerText.toLowerCase().includes(heading.toLowerCase()),
        viewport.label + ' detail contains readable ' + heading + ' section');
    }
    const drawerOrder = ['Contact Information', 'Customer Profile', 'Job Details', 'Polaris™ Intelligence']
      .map(heading => drawerText.toLowerCase().indexOf(heading.toLowerCase()));
    assert.ok(drawerOrder.every(index => index >= 0) && drawerOrder.every((value, index) => index === 0 || value > drawerOrder[index - 1]),
      viewport.label + ' detail keeps contact and profile first, then work and Polaris intelligence');
    assert.ok(!/\[object Object\]|\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b|\b[0-9a-f]{40,}\b/i.test(drawerText),
      viewport.label + ' detail never exposes object serialization or internal identifiers');
    assert.ok(drawerText.includes('AI AGENT') && !drawerText.includes('No transcript available.'),
      viewport.label + ' detail renders the authentic generated transcript');
    const drawerContainment = await page.evaluate(() => {
      const drawerNode = document.getElementById('cdCustomerDrawer');
      const drawer = drawerNode.getBoundingClientRect();
      const drawerBody = document.getElementById('cdDrawerBody');
      const description = document.getElementById('cdDescription');
      const value = description.getBoundingClientRect();
      const polaris = drawerNode.querySelector('.drawer-polaris-insight');
      const polarisStyle = getComputedStyle(polaris);
      const pricingRows = Array.from(drawerNode.querySelectorAll('.drawer-pricing-item'));
      return {
        inside: value.left >= drawer.left && value.right <= drawer.right,
        wrapped: description.scrollWidth <= description.clientWidth + 1,
        drawerContained: drawer.left >= -1 && drawer.right <= window.innerWidth + 1 && drawer.top >= -1 && drawer.bottom <= window.innerHeight + 1,
        scrollable: drawerBody.scrollHeight - drawerBody.clientHeight <= 1 || ['auto', 'scroll'].includes(getComputedStyle(drawerBody).overflowY),
        closeVisible: document.getElementById('cdDrawerClose').getBoundingClientRect().width > 0,
        purplePolaris: /linear-gradient/i.test(polarisStyle.backgroundImage) &&
          /(?:76, 29, 149|109, 40, 217|124, 58, 237|46, 16, 101|91, 33, 182)/.test(polarisStyle.backgroundImage),
        pricingSeparated: pricingRows.length > 0 && pricingRows.every(row => {
          const spans = row.querySelectorAll(':scope > span');
          if (spans.length !== 2) return false;
          const left = spans[0].getBoundingClientRect();
          const right = spans[1].getBoundingClientRect();
          return right.left - left.right >= 7;
        }),
        pricingTextSeparated: /Subtotal\s+Unavailable/i.test(drawerNode.textContent) &&
          /Tax\s+Unavailable because/i.test(drawerNode.textContent),
      };
    });
    assert.deepStrictEqual(drawerContainment, {
      inside: true, wrapped: true, drawerContained: true, scrollable: true, closeVisible: true, purplePolaris: true,
      pricingSeparated: true, pricingTextSeparated: true,
    },
      viewport.label + ' canonical scope text remains contained and wrapped');
    await captureEvidence(page, 'demo', leadsRoute, viewport, 'customer-detail-open');
    const drawerScroll = await page.evaluate(async () => {
      const body = document.getElementById('cdDrawerBody');
      const drawer = document.getElementById('cdCustomerDrawer').getBoundingClientRect();
      const polarisNode = document.querySelector('#cdCustomerDrawer .drawer-polaris-insight');
      polarisNode.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'instant' });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const polaris = polarisNode.getBoundingClientRect();
      return {
        scrollTop: body.scrollTop,
        scrollableDistance: body.scrollHeight - body.clientHeight,
        polarisVisible: polaris.bottom > drawer.top && polaris.top < drawer.bottom,
      };
    });
    assert.ok((drawerScroll.scrollableDistance <= 1 || drawerScroll.scrollTop > 0) && drawerScroll.polarisVisible,
      viewport.label + ' customer detail reaches the contained Polaris intelligence by scrolling when needed: ' + JSON.stringify(drawerScroll));
    await captureEvidence(page, 'demo', leadsRoute, viewport, 'customer-detail-polaris');
    await page.click('#cdDrawerClose');
    await page.waitForFunction(() => {
      const drawer = document.getElementById('cdCustomerDrawer');
      const style = getComputedStyle(drawer);
      return !drawer.classList.contains('open') && Number.parseFloat(style.opacity) === 0 && style.pointerEvents === 'none';
    });
    await captureEvidence(page, 'demo', leadsRoute, viewport, 'simulated');

    for (const id of ['communications', 'my-number', 'calendar', 'command-center']) {
      const route = ROUTES.find(candidate => candidate.id === id);
      const snapshot = await clickRoute(page, origin, route, 2, viewport);
      if (id === 'calendar') {
        const agendaButton = page.locator('.cal-view-tab', { hasText: 'Agenda' });
        await agendaButton.click();
        await page.waitForFunction(() => window.calState && window.calState.view === 'agenda');
      }
      if (id !== 'my-number') {
        await page.waitForFunction(name => document.body.textContent.includes(name), added.customer.name);
      } else {
        assert.ok(snapshot.workspace.graphs.some(graph => graph.ids.graph === added.ids.graph),
          route.path + ' reads the shared canonical workspace without inventing customer calling data');
      }
      if (!hasPolarisSurface(id)) {
        assert.strictEqual(snapshot.polarisCardCount, 0, route.path + ' retains canonical state without a misplaced Polaris card');
      }
      await captureEvidence(page, 'demo', route, viewport, 'simulated');
      console.log('PARITY_BROWSER_CHECKPOINT ' + viewport.label + ' propagated ' + id);
    }

    const polarisRoute = ROUTES.find(route => route.id === 'polaris');
    const detailPath = polarisRoute.path + '?kind=lead&id=' + encodeURIComponent(added.ids.lead);
    const detailLink = page.locator('#commandCenterPolaris .polaris-card-primary-action').first();
    assert.strictEqual(await detailLink.getAttribute('href'), detailPath, viewport.label + ' exact lead-detail destination');
    await Promise.all([
      page.waitForURL(url => url.origin === origin && url.pathname + url.search === detailPath, { timeout: 15000 }),
      detailLink.click(),
    ]);
    const detail = await inspectCurrent(page, polarisRoute, 2, viewport);
    await captureEvidence(page, 'demo', polarisRoute, viewport, 'object-detail');
    console.log('PARITY_BROWSER_CHECKPOINT ' + viewport.label + ' polaris-detail');
    assert.strictEqual(detail.polarisCardCount, 0, viewport.label + ' Polaris remains chat-centric without a duplicate surface card');
    assert.ok(detail.workspace.graphs.some(graph => graph.ids.graph === added.ids.graph),
      viewport.label + ' Polaris reads the complete shared simulated graph');
    const visiblePolarisPrompt = page.locator('textarea[aria-label="Ask Polaris a question"]:visible');
    assert.strictEqual(await visiblePolarisPrompt.count(), 1,
      viewport.label + ' Polaris exposes one visible business-intelligence chat entry point');
    assert.strictEqual(await visiblePolarisPrompt.getAttribute('placeholder'), 'Ask Polaris anything...',
      viewport.label + ' Polaris keeps the business-intelligence chat entry point');
    assert.strictEqual(await visiblePolarisPrompt.isEnabled(), true,
      viewport.label + ' Polaris business-intelligence chat entry point remains usable');

    for (const id of ['team', 'ai-settings', 'business-profile', 'settings', 'integrations']) {
      const route = ROUTES.find(candidate => candidate.id === id);
      const snapshot = await clickRoute(page, origin, route, 2, viewport);
      assert.deepStrictEqual(snapshot.workspace.configuration, initialConfiguration, route.path + ' configuration stability');
      assert.strictEqual(snapshot.polarisCardCount, 0, route.path + ' has no misplaced Polaris card after simulation');
      assert.ok(snapshot.workspace.graphs.some(graph => graph.ids.graph === added.ids.graph),
        route.path + ' retains the one canonical simulated state without a standalone Polaris projection');
      await captureEvidence(page, 'demo', route, viewport, 'simulated');
      console.log('PARITY_BROWSER_CHECKPOINT ' + viewport.label + ' config ' + id);
    }

    await clickRoute(page, origin, ROUTES[0], 2, viewport);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
      page.click('#demoReset'),
    ]);
    await waitReady(page, ROUTES[0], 3);
    console.log('PARITY_BROWSER_CHECKPOINT ' + viewport.label + ' reset');
    const reset = await page.evaluate(() => window.NorthStarDemoRuntime.getWorkspace());
    assert.strictEqual(reset.graphs.length, 3, viewport.label + ' reset restores seed graph count');
    assert.strictEqual(reset.session.simulationCount, 0, viewport.label + ' reset count');
    assert.deepStrictEqual(reset.configuration, initialConfiguration, viewport.label + ' reset preserves configuration');
    assert.ok(!reset.graphs.some(graph => graph.ids.graph === added.ids.graph), viewport.label + ' reset removes only session-added graph');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitReady(page, ROUTES[0], 3);
    const reloaded = await page.evaluate(() => window.NorthStarDemoRuntime.getWorkspace());
    assert.strictEqual(reloaded.session.durable, true, viewport.label + ' durable state survives reload');
    assert.strictEqual(reloaded.integrity.digest, reset.integrity.digest, viewport.label + ' reload digest');
    console.log('PARITY_BROWSER_CHECKPOINT ' + viewport.label + ' complete');
    return { viewport: viewport.label, sessionId: reloaded.session.id, finalDigest: reloaded.integrity.digest };
  } finally {
    await context.close();
  }
}

async function captureBaselineDemoViewport(browser, origin, viewport) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    for (const route of ROUTES) {
      const response = await page.goto(origin + route.path, { waitUntil: 'networkidle', timeout: 15000 });
      assert.ok(response && [200, 304].includes(response.status()), 'baseline ' + route.path + ' response');
      await page.waitForFunction(({ marker, surface }) => {
        const workspace = window.NorthStarDemoRuntime && window.NorthStarDemoRuntime.getWorkspace &&
          window.NorthStarDemoRuntime.getWorkspace();
        return workspace && document.documentElement.getAttribute('data-northstar-navigation') === 'ready' &&
          document.querySelector(surface) && document.body.textContent.includes(marker);
      }, { marker: route.marker, surface: route.surface }, { timeout: 15000 });
      if (route.id === 'integrations') await waitCatalogueTerminal(page, route);
      await page.waitForTimeout(100);
      await captureEvidence(page, 'demo', route, viewport, 'before');
    }
    return { viewport: viewport.label, routes: ROUTES.length, browserErrors: errors };
  } finally {
    await context.close();
  }
}

async function captureBaselinePaidViewport(browser, origin, viewport, session) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, serviceWorkers: 'block' });
  context.setDefaultTimeout(10000);
  await context.addCookies(Object.entries(session.cookies).map(([name, value]) => ({
    name, value, url: origin, httpOnly: name !== 'northstar_csrf', sameSite: 'Lax',
  })));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    for (const route of ROUTES) {
      const response = await page.goto(origin + route.paidPath, { waitUntil: 'networkidle', timeout: 15000 });
      assert.ok(response && [200, 304].includes(response.status()), 'baseline ' + route.paidPath + ' response');
      await page.waitForFunction(({ marker, surface }) => {
        const account = window.NorthStarAccountSession && window.NorthStarAccountSession.getAccount &&
          window.NorthStarAccountSession.getAccount();
        return account && document.documentElement.getAttribute('data-northstar-navigation') === 'ready' &&
          document.querySelector(surface) && document.body.textContent.includes(marker);
      }, { marker: route.marker, surface: route.surface }, { timeout: 15000 });
      if (route.id === 'integrations') await waitCatalogueTerminal(page, route);
      await page.waitForTimeout(100);
      await captureEvidence(page, 'paid', route, viewport, 'before');
    }
    return { viewport: viewport.label, routes: ROUTES.length, browserErrors: errors };
  } finally {
    await context.close();
  }
}

async function main() {
  const selected = process.env.NORTHSTAR_BROWSER;
  assert.ok(selected === 'chrome' || selected === 'webkit', 'NORTHSTAR_BROWSER must be chrome or webkit');
  const runtime = resolveBrowserRuntime(selected);
  const selectedViewports = process.env.NORTHSTAR_VIEWPORT
    ? VIEWPORTS.filter(viewport => viewport.label === process.env.NORTHSTAR_VIEWPORT)
    : VIEWPORTS;
  assert.ok(selectedViewports.length > 0,
    'NORTHSTAR_VIEWPORT must be desktop, tablet, mobile, or mobile-compact when provided');
  const suiteDatabase = await createSuiteDatabase('cc-parity-browser');
  const originalEnvironment = new Map();
  for (const name of PROVIDER_ENVIRONMENT.concat(['DATABASE_URL', 'NODE_ENV', 'AUTH_ACCESS_SECRET'])) {
    originalEnvironment.set(name, process.env[name]);
  }
  const beforeData = treeDigest(path.join(ROOT, 'data'));
  let db;
  let server;
  let browser;
  const originalFetch = global.fetch;
  try {
    for (const name of PROVIDER_ENVIRONMENT) delete process.env[name];
    process.env.DATABASE_URL = suiteDatabase.connectionString;
    process.env.NODE_ENV = 'test';
    process.env.AUTH_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');
    process.chdir(ROOT);
    db = fromRoot('src/db');
    assert.strictEqual(await db.initDatabase(), true, 'disposable PostgreSQL initialized');
    const pool = db.getPool();
    await pool.query(
      `INSERT INTO organizations (id, name, email) VALUES
        ($1, 'Paid Browser Organization A', 'paid-browser-a@northstar.test'),
        ($2, 'Paid Browser Organization B', 'paid-browser-b@northstar.test')`,
      [PAID_ORG_A, PAID_ORG_B]
    );
    for (const user of [
      [PAID_USER_A, PAID_ORG_A, 'paid-browser-owner-a@northstar.test'],
      [PAID_USER_B, PAID_ORG_B, 'paid-browser-owner-b@northstar.test'],
    ]) {
      await pool.query(
        `INSERT INTO users (id, organization_id, name, email, password_hash, role, status)
         VALUES ($1,$2,$3,$4,'not-used','owner','active')`,
        [user[0], user[1], user[2], user[2]]
      );
    }
    await pool.query(
      `INSERT INTO notification_preferences (
         organization_id, email_new_lead, email_call_summary, email_appointment,
         sms_new_lead, sms_urgent, notification_email, notification_phone
       ) VALUES
         ($1,TRUE,TRUE,TRUE,FALSE,TRUE,'paid-browser-owner-a@northstar.test',''),
         ($2,FALSE,FALSE,FALSE,FALSE,FALSE,'paid-browser-owner-b@northstar.test','')`,
      [PAID_ORG_A, PAID_ORG_B]
    );
    await pool.query(
      `INSERT INTO organization_account_preferences (organization_id, preferences)
       VALUES ($1,'{}'::jsonb),($2,'{}'::jsonb)`,
      [PAID_ORG_A, PAID_ORG_B]
    );
    const { putBusinessProfile } = fromRoot('src/services/organizationAuthority');
    await putBusinessProfile(pool, {
      organizationId: PAID_ORG_A,
      userId: PAID_USER_A,
      expectedVersion: null,
      profile: paidBusinessProfile('Paid Browser Organization A'),
    });
    await putBusinessProfile(pool, {
      organizationId: PAID_ORG_B,
      userId: PAID_USER_B,
      expectedVersion: null,
      profile: paidBusinessProfile('Paid Browser Organization B'),
    });
    const paidA = await ingestRetell(pool, paidGraphRequest(PAID_ORG_A, 'paid-browser-a', PAID_CUSTOMER_A, '+15550101001', 'redwood'));
    const paidB = await ingestRetell(pool, paidGraphRequest(PAID_ORG_B, 'paid-browser-b', PAID_CUSTOMER_B, '+15550101002'));
    assert.strictEqual(paidA.status, 201, 'tenant A real canonical graph created');
    assert.strictEqual(paidB.status, 201, 'tenant B negative-control graph created');
    const paidSession = await provisionDurableSession(pool, {
      userId: PAID_USER_A, organizationId: PAID_ORG_A, role: 'owner',
    });
    global.fetch = async function () { throw new Error('provider boundary must remain unused'); };
    const { app } = fromRoot('src/server');
    server = await listen(app);
    const origin = 'http://127.0.0.1:' + server.address().port;
    browser = await runtime.browserType.launch({ executablePath: runtime.executablePath, headless: true });
    if (CAPTURE_BASELINE) {
      const demo = [];
      const paid = [];
      for (const viewport of selectedViewports) demo.push(await captureBaselineDemoViewport(browser, origin, viewport));
      for (const viewport of selectedViewports) paid.push(await captureBaselinePaidViewport(browser, origin, viewport, paidSession));
      console.log('COMMAND_CENTER_PARITY_BASELINE_RECEIPT ' + JSON.stringify({
        browser: selected,
        version: browser.version(),
        targetRoot: ROOT,
        viewports: selectedViewports.map(value => value.label),
        routes: ROUTES.length,
        demo,
        paid,
      }));
      return;
    }
    const ledger = { requests: [], httpErrors: [], warnings: [], consoleErrors: [], pageErrors: [] };
    const receipts = [];
    for (const viewport of selectedViewports) receipts.push(await exerciseViewport(browser, origin, viewport, ledger));
    const paidReceipts = [];
    const paidLeadHref = '/dashboard/polaris?kind=lead&id=' + encodeURIComponent(paidA.body.ids.opportunity);
    for (const viewport of selectedViewports) {
      paidReceipts.push(await exercisePaidViewport(browser, origin, viewport, paidSession, ledger, paidLeadHref));
    }

    const external = ledger.requests.filter(entry => new URL(entry.url).origin !== origin);
    const mutations = ledger.requests.filter(entry => entry.method !== 'GET' && entry.method !== 'HEAD' && entry.method !== 'OPTIONS');
    assert.deepStrictEqual(external, [], 'all browser traffic remains on the disposable loopback origin');
    assert.strictEqual(mutations.length, selectedViewports.length * 2, 'one simulate and one reset per viewport');
    assert.ok(mutations.every(entry => {
      const pathname = new URL(entry.url).pathname;
      return entry.method === 'POST' && (pathname === '/api/demo/command-center/simulations/leads' || pathname === '/api/demo/command-center/reset');
    }), 'only bounded demo mutations occur');
    assert.deepStrictEqual(ledger.httpErrors, [], 'browser HTTP errors');
    assert.deepStrictEqual(ledger.warnings, [], 'browser console warnings');
    assert.deepStrictEqual(ledger.consoleErrors, [], 'browser console errors');
    assert.deepStrictEqual(ledger.pageErrors, [], 'browser page errors');

    const rows = (await pool.query(
      `SELECT count(*)::int AS sessions,
              count(DISTINCT tenant_id)::int AS tenants,
              min(revision)::int AS minimum_revision,
              max(simulation_count)::int AS maximum_simulation_count,
              bool_and(token_hash ~ '^[0-9a-f]{64}$') AS token_hashes_only
         FROM demo_command_center_sessions`
    )).rows[0];
    assert.deepStrictEqual(rows, {
      sessions: selectedViewports.length,
      tenants: selectedViewports.length,
      minimum_revision: 3,
      maximum_simulation_count: 0,
      token_hashes_only: true,
    }, 'one isolated durable tenant/session per browser context');

    console.log('COMMAND_CENTER_PARITY_BROWSER_RECEIPT ' + JSON.stringify({
      browser: selected,
      version: browser.version(),
      viewports: selectedViewports.map(value => value.label),
      routes: ROUTES.length,
      receipts,
      paidReceipts,
      requests: ledger.requests.length,
      mutations: mutations.length,
      externalRequests: external.length,
      httpErrors: ledger.httpErrors.length,
      warnings: ledger.warnings.length,
      consoleErrors: ledger.consoleErrors.length,
      pageErrors: ledger.pageErrors.length,
      postgres: rows,
    }));
  } finally {
    if (browser) await browser.close();
    await closeServer(server);
    if (db) await db.close();
    global.fetch = originalFetch;
    for (const [name, value] of originalEnvironment) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await suiteDatabase.cleanup();
    assert.strictEqual(treeDigest(path.join(ROOT, 'data')), beforeData, 'browser test does not alter repository data');
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
