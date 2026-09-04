'use strict';

const assert = require('assert');
const { app } = require('../../src/server');
const { buildDemoWorkspace, createInitialDemoState } = require('../../src/commandCenter/workspace');
const { navigationFixture } = require('../helpers/navigation-fixture');
const { MOUNTED_THEME_PAGES } = require('../helpers/site-theme-pages');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');

const VIEWPORTS = Object.freeze({
  desktop: { width: 1440, height: 900 },
  mobile390: { width: 390, height: 844 },
  mobile320: { width: 320, height: 720 },
  zoom200: { width: 640, height: 720, zoom: 2 },
});
const THEMES = Object.freeze(['light', 'dark']);
const FORBIDDEN_PRESENTATION = /```|\bJSON Schema\b|\b(?:stack trace|provider body|response body)\b|\b(?:POLARIS|INTERNAL|PROVIDER)_[A-Z0-9_]{3,}\b|\b(?:Lead|Customer|Request|Conversation) ID\b|\b[0-9a-f]{64}\b/i;
const DEMO_TENANT_ID = '00000000-0000-4000-8000-000000000701';
const DEMO_SESSION_ID = '00000000-0000-4000-8000-000000000702';

function response(body, status = 200) {
  return { status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body), headers: { 'Cache-Control': 'no-store' } };
}

function accountFixture(role, pathname) {
  const pending = pathname === '/account/pending';
  const accessRole = role === 'dispatcher' || role === 'employee'
    ? 'member'
    : role === 'read-only' ? 'viewer' : role;
  return {
    account: {
      user: { id: '00000000-0000-4000-8000-000000000703', email: '', status: pending ? 'pending' : 'active' },
      organization: { id: DEMO_TENANT_ID, name: 'NorthStar Acceptance Fixture' },
      navigation: role === 'employee'
        ? [{ id: 'today', href: '/dashboard/today' }]
        : navigationFixture(),
      membership: { role: accessRole, status: 'active' },
      memberships: [{ role: accessRole, status: 'active' }],
      onboarding: { status: 'complete' },
      subscription: pending
        ? { plan: 'Complete', safe: true, state: 'pending_verification', readOnly: true, showTrialBanner: true }
        : { plan: 'Complete', safe: true, state: role === 'read-only' ? 'subscription_read_only' : 'active', readOnly: role === 'read-only', showTrialBanner: false },
    },
  };
}

function todayFixture(role) {
  return {
    version: 'm22-part6-today-v1', readOnly: true, mutationCapabilities: [],
    evaluatedAt: '2026-09-03T12:00:00.000Z',
    identity: {
      displayName: role === 'employee' ? 'Field Employee' : 'Owner Operator',
      operationalRole: role === 'employee' ? 'technician' : 'owner_operator',
    },
    day: {
      date: '2026-09-03', start: '2026-09-03T04:00:00.000Z',
      end: '2026-09-04T04:00:00.000Z', timeZone: 'America/New_York',
    },
    count: 0, shown: 0, total: 0, truncated: false,
    digest: 'e'.repeat(64), records: [],
  };
}

function workforceFixture() {
  return {
    success: true,
    data: {
      members: [
        {
          profileId: '00000000-0000-4000-8000-000000000711',
          membershipId: '00000000-0000-4000-8000-000000000712',
          name: 'Cameron Fixture', email: 'cameron@example.com', phone: '(206) 555-0102',
          membershipStatus: 'active', accessRole: 'owner', operationalRole: 'owner_operator',
          homeLocationId: '00000000-0000-4000-8000-000000000715',
          skillIds: ['00000000-0000-4000-8000-000000000716'],
        },
        {
          profileId: '00000000-0000-4000-8000-000000000713',
          membershipId: '00000000-0000-4000-8000-000000000714',
          name: 'Avery Installer', email: 'avery@example.com', phone: '',
          membershipStatus: 'active', accessRole: 'member', operationalRole: 'technician',
          homeLocationId: '00000000-0000-4000-8000-000000000715',
          skillIds: [],
        },
      ],
      crews: [{
        id: '00000000-0000-4000-8000-000000000717', key: 'north-crew', name: 'North Crew',
        homeLocationId: '00000000-0000-4000-8000-000000000715',
        members: [{ profileId: '00000000-0000-4000-8000-000000000713', role: 'lead' }],
      }],
      skills: [{
        id: '00000000-0000-4000-8000-000000000716', key: 'roofing', name: 'Roofing',
        description: 'Roof inspection and repair', serviceId: '00000000-0000-4000-8000-000000000718',
      }],
      invitations: [],
      locations: [{ id: '00000000-0000-4000-8000-000000000715', name: 'Main Office' }],
      services: [{ id: '00000000-0000-4000-8000-000000000718', name: 'Roof repair' }],
      policies: [{
        id: '00000000-0000-4000-8000-000000000719', name: 'Safety review',
        description: 'Review access and equipment before dispatch.', enabled: true,
      }],
    },
  };
}

function demoWorkspace() {
  return buildDemoWorkspace({
    tenantId: DEMO_TENANT_ID,
    sessionId: DEMO_SESSION_ID,
    state: createInitialDemoState(DEMO_TENANT_ID, new Date('2026-09-03T12:00:00.000Z')),
    revision: 1,
    simulationCount: 0,
    persisted: false,
    expiresAt: new Date('2099-09-04T12:00:00.000Z'),
  });
}

function canonicalFixture(request, surface, role, viewerId, organizationId) {
  const fixture = {
    success: true,
    data: {
      surface,
      readModelVersion: 'm19-part3-read-v1',
      digest: 'c'.repeat(64),
      items: [],
      records: [],
      metrics: { graphCount: 0, appointmentCount: 0, estimatedRevenue: null },
      authority: {
        userId: viewerId || '00000000-0000-4000-8000-000000000703',
        organizationId: organizationId || DEMO_TENANT_ID,
        sessionId: request.headers()['x-northstar-session-id'] || DEMO_SESSION_ID,
      },
    },
  };
  if (surface === 'calendar') {
    const canMutate = ['owner', 'admin', 'dispatcher'].includes(role);
    fixture.data.timeZoneAuthority = {
      profileId: '00000000-0000-4000-8000-000000000704',
      profileVersion: 1,
      profileHash: 'd'.repeat(64),
      timeZone: 'America/New_York',
    };
    fixture.data.schedulingOperator = {
      canRead: true,
      canMutate,
      reason: canMutate ? null : role === 'read-only' ? 'subscription_read_only' : 'role_not_authorized',
      targets: [],
      discovery: { shown: 0, total: 0, truncated: false },
    };
    fixture.data.schedulingOverview = {
      timeZone: 'America/New_York',
      records: [],
      page: { shown: 0, total: 0, size: 100, cursor: null, nextCursor: null },
    };
  }
  return fixture;
}

async function installBoundary(context, origin, role, evidence) {
  context.on('request', request => {
    const url = new URL(request.url());
    if (!['http:', 'https:'].includes(url.protocol)) return;
    assert.strictEqual(url.origin, origin, `external request escaped loopback: ${url.origin}`);
    assert.strictEqual(Object.keys(request.headers()).some(name => name.toLowerCase() === 'authorization'), false);
    evidence.requests.push(`${request.method()} ${url.pathname}`);
  });
  await context.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    assert.strictEqual(url.origin, origin);
    const framePath = (() => { try { return new URL(request.frame().url()).pathname; } catch (_error) { return ''; } })();
    if (request.method() === 'POST' && url.pathname === '/api/telemetry') return route.fulfill(response({ accepted: true }, 202));
    assert.strictEqual(request.method(), 'GET', `automatic mutation attempted: ${request.method()} ${url.pathname}`);
    if (url.pathname === '/api/auth/me') return route.fulfill(response(accountFixture(role, framePath)));
    if (url.pathname === '/api/account/subscription') return route.fulfill(response({ subscription: accountFixture(role, framePath).account.subscription }));
    if (url.pathname === '/api/demo/command-center') return route.fulfill(response({ success: true, data: demoWorkspace() }));
    const demoCompat = url.pathname.match(/^\/api\/demo\/command-center\/canonical\/compat\/([^/]+)$/);
    if (demoCompat) {
      const workspace = demoWorkspace();
      return route.fulfill(response(canonicalFixture(
        request,
        decodeURIComponent(demoCompat[1]),
        role,
        workspace.viewer.id,
        workspace.tenant.id
      )));
    }
    const paidCompat = url.pathname.match(/^\/api\/v1\/canonical\/compat\/([^/]+)$/);
    if (paidCompat) return route.fulfill(response(canonicalFixture(request, decodeURIComponent(paidCompat[1]), role)));
    if (url.pathname === '/api/v1/business-profile') return route.fulfill(response({ success: true, profile: null }));
    if (url.pathname === '/api/v1/today') return route.fulfill(response({ success: true, data: todayFixture(role) }));
    if (url.pathname === '/api/workforce') return route.fulfill(response(workforceFixture()));
    if (url.pathname === '/api/health') return route.fulfill(response({ status: 'ok', database: 'healthy', persistence: 'healthy' }));
    return route.fulfill(response({ success: true, data: {}, records: [], items: [] }));
  });
}

async function closeAutomaticQuickStart(page) {
  const dialog = page.locator('#northstarQuickStartDialog[open]');
  if (await dialog.count() === 0) return false;
  assert.strictEqual(await dialog.locator(':focus').count(), 1, 'Quick Start places focus inside the modal');
  await page.keyboard.press('Escape');
  assert.strictEqual(await page.locator('#northstarQuickStartDialog[open]').count(), 0, 'Escape closes Quick Start');
  return true;
}

async function semanticAudit(page) {
  return page.evaluate(forbiddenSource => {
    function visible(element) {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
    }
    function labelText(element) {
      const labelledBy = (element.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)
        .map(id => document.getElementById(id)?.textContent || '').join(' ').trim();
      const explicit = element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.textContent || '' : '';
      const wrapped = element.closest('label')?.textContent || '';
      return (element.getAttribute('aria-label') || labelledBy || explicit || wrapped || element.alt || element.value || element.textContent || element.title || '')
        .replace(/\s+/g, ' ').trim();
    }
    function selector(element) {
      if (element.id) return `#${element.id}`;
      const classes = typeof element.className === 'string' ? element.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
      return `${element.tagName.toLowerCase()}${classes ? `.${classes}` : ''}`;
    }
    const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).filter(visible);
    const headingLevels = headings.map(heading => Number(heading.tagName.slice(1)));
    const headingSkips = [];
    for (let index = 1; index < headingLevels.length; index += 1) {
      if (headingLevels[index] > headingLevels[index - 1] + 1) {
        headingSkips.push({ from: headings[index - 1].textContent.trim(), to: headings[index].textContent.trim(), levels: [headingLevels[index - 1], headingLevels[index]] });
      }
    }
    const interactive = Array.from(document.querySelectorAll('a[href],button,input:not([type="hidden"]),select,textarea,[role="button"],[role="link"],[tabindex]:not([tabindex="-1"])')).filter(visible);
    const unnamedControls = interactive.filter(element => !labelText(element)).map(selector);
    const unnamedNavigation = Array.from(document.querySelectorAll('nav')).filter(visible).filter(element => {
      return !(element.getAttribute('aria-label') || element.getAttribute('aria-labelledby') || element.title);
    }).map(selector);
    const inertInteractive = interactive.filter(element => {
      if (!element.matches('[role="button"],[role="link"],[tabindex]')) return false;
      if (element.matches('a[href],button,input,select,textarea')) return false;
      if (element.matches('[role="region"][aria-label],[role="region"][aria-labelledby]')) return false;
      return !element.hasAttribute('onclick') && !element.getAttribute('data-action') && !element.getAttribute('data-navigation-primary');
    }).map(selector);
    const ignoredHandlerNames = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof', 'setTimeout', 'setInterval']);
    const missingInlineHandlers = interactive.flatMap(element => {
      return ['onclick', 'onchange', 'oninput', 'onsubmit', 'onkeydown'].flatMap(attribute => {
        const source = element.getAttribute(attribute) || '';
        const names = [...source.matchAll(/(?:^|[^\w.$])([A-Za-z_$][\w$]*)\s*\(/g)].map(match => match[1]);
        return names.filter(name => !ignoredHandlerNames.has(name) && typeof window[name] !== 'function')
          .map(name => ({ selector: selector(element), attribute, name }));
      });
    });
    const deadLinks = interactive.filter(element => element.tagName === 'A').filter(element => {
      const href = (element.getAttribute('href') || '').trim();
      return (!href || href === '#' || /^javascript:/i.test(href))
        && !element.hasAttribute('onclick') && !element.getAttribute('data-action');
    }).map(element => ({ selector: selector(element), text: labelText(element) }));
    const badges = Array.from(document.querySelectorAll('[class*="pill"],[class*="badge"],[class*="chip"],[class*="tag"]')).filter(element => {
      if (!visible(element) || !element.textContent.trim() || element.children.length) return false;
      const style = getComputedStyle(element);
      const hasSurface = style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent';
      const hasBorder = parseFloat(style.borderLeftWidth) > 0 || parseFloat(style.borderRightWidth) > 0;
      return hasSurface || hasBorder;
    }).map(element => {
      const style = getComputedStyle(element);
      return { selector: selector(element), left: parseFloat(style.paddingLeft) || 0, right: parseFloat(style.paddingRight) || 0, text: element.textContent.trim().slice(0, 50) };
    });
    const disabledActions = Array.from(document.querySelectorAll('button:disabled,input[type="button"]:disabled,input[type="submit"]:disabled')).filter(visible);
    const unexplainedDisabledActions = disabledActions.filter(element => {
      const references = (element.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
      const described = references.map(id => document.getElementById(id)?.textContent || '').join(' ').trim();
      const titled = (element.getAttribute('title') || '').trim();
      const localStatus = element.closest('form,section,article,[role="region"],.card,.panel')
        ?.querySelector('[role="status"],[role="alert"],.description,.cal-context-note')?.textContent?.trim() || '';
      return !(described || titled || localStatus);
    }).map(element => ({ selector: selector(element), text: labelText(element) }));
    return {
      h1: headings.filter(heading => heading.tagName === 'H1').map(heading => heading.textContent.trim()),
      headingSkips,
      mainCount: Array.from(document.querySelectorAll('main,[role="main"]')).filter(visible).length,
      unnamedNavigation,
      unnamedControls,
      inertInteractive,
      missingInlineHandlers,
      deadLinks,
      crampedBadges: badges.filter(badge => badge.left < 6 || badge.right < 6),
      unexplainedDisabledActions,
      overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth,
      forbiddenPresentation: document.body.innerText.match(new RegExp(forbiddenSource, 'i'))?.[0] || null,
      bodyText: document.body.innerText.replace(/\s+/g, ' ').trim(),
    };
  }, FORBIDDEN_PRESENTATION.source);
}

async function founderVisualCorrectionAudit(page, entry, viewportName) {
  const route = entry.route;
  const themeSelectorGeometry = await page.locator('[data-northstar-theme-toggle]:visible').first().evaluate(node => {
    const track = getComputedStyle(node);
    const selection = getComputedStyle(node, '::before');
    return {
      theme: node.getAttribute('data-current-theme'),
      trackWidth: Number.parseFloat(track.width),
      trackHeight: Number.parseFloat(track.height),
      selectionCenterX: Number.parseFloat(selection.left),
      selectionCenterY: Number.parseFloat(selection.top),
      selectionWidth: Number.parseFloat(selection.width),
      selectionHeight: Number.parseFloat(selection.height),
    };
  });
  const expectedSelectionCenterX = themeSelectorGeometry.trackWidth *
    (themeSelectorGeometry.theme === 'dark' ? .75 : .25);
  assert.ok(Math.abs(themeSelectorGeometry.selectionCenterX - expectedSelectionCenterX) <= .5,
    `${viewportName} ${route} centers the selected theme circle over its horizontal half`);
  assert.ok(Math.abs(themeSelectorGeometry.selectionCenterY - themeSelectorGeometry.trackHeight / 2) <= .5,
    `${viewportName} ${route} centers the selected theme circle vertically`);
  assert.ok(Math.abs(themeSelectorGeometry.selectionWidth - themeSelectorGeometry.selectionHeight) <= .5,
    `${viewportName} ${route} keeps the selected theme fill circular`);
  assert.ok(themeSelectorGeometry.selectionWidth >= themeSelectorGeometry.trackHeight - 4,
    `${viewportName} ${route} fills the selected half without an excessive inner gap`);

  if (route === '/') {
    assert.strictEqual(await page.locator('.pricing-feature-list').count(), 3,
      `${viewportName} pricing publishes an included-items list for each public plan`);
    const pricingTypography = await page.locator('.pricing-card .price').first().evaluate(node => ({
      price: getComputedStyle(node).fontFamily,
      body: getComputedStyle(document.body).fontFamily,
    }));
    assert.strictEqual(pricingTypography.price, pricingTypography.body,
      `${viewportName} pricing uses the approved body typeface`);
  }

  if (/\/(?:team|leads|communications)$/.test(route)) {
    const search = page.locator('.northstar-search:visible').first();
    assert.strictEqual(await search.count(), 1, `${viewportName} ${route} exposes one visible shared search control`);
    const spacing = await search.evaluate(node => {
      const icon = node.querySelector('svg').getBoundingClientRect();
      const input = node.querySelector('input[type="search"]').getBoundingClientRect();
      return { iconRight: icon.right, inputLeft: input.left };
    });
    assert.ok(spacing.inputLeft >= spacing.iconRight + 4,
      `${viewportName} ${route} keeps its search icon clear of its input text`);
  }

  if (route.endsWith('/team')) {
    await page.waitForFunction(() => document.documentElement.getAttribute('data-workforce-state') === 'ready');
    const search = page.locator('#teamSearchInput');
    const originalVisibleCards = await page.locator('#workforceShell .wf-card').evaluateAll(nodes =>
      nodes.filter(node => !node.hidden).length);
    assert.ok(originalVisibleCards > 1, `${viewportName} ${route} begins with multiple searchable workforce records`);
    const selectedMemberName = await page.locator('#membersList .wf-card h3').first().innerText();
    assert.ok(selectedMemberName.trim(), `${viewportName} ${route} exposes a named workforce record for search`);
    await search.fill(selectedMemberName);
    const cardStates = await page.locator('#workforceShell .wf-card').evaluateAll(nodes =>
      nodes.map(node => ({ hidden: node.hidden, text: node.innerText })));
    const filteredCards = cardStates.filter(card => !card.hidden).map(card => card.text);
    assert.strictEqual(filteredCards.length, 1,
      `${viewportName} ${route} filters workforce records as the owner types: ${JSON.stringify(cardStates)}`);
    assert.ok(filteredCards[0].includes(selectedMemberName),
      `${viewportName} ${route} retains the matching workforce record`);
    await search.fill('');
    assert.strictEqual(await page.locator('#workforceShell .wf-card').evaluateAll(nodes =>
      nodes.filter(node => !node.hidden).length), originalVisibleCards,
      `${viewportName} ${route} restores workforce records when search is cleared`);
  }

  if (route.endsWith('/integrations')) {
    const categories = page.locator('.integration-category-details');
    const categoryCount = await categories.count();
    if (route.startsWith('/demo')) {
      assert.ok(categoryCount > 0, `${viewportName} ${route} renders integration categories`);
    }
    assert.strictEqual(await categories.evaluateAll(nodes => nodes.filter(node => node.open).length), 0,
      `${viewportName} ${route} renders every integration category collapsed`);
  }

  if (route.endsWith('/polaris')) {
    const placement = await page.locator('.polaris-prompt-bar').evaluate(node => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return { position: style.position, bottomGap: innerHeight - rect.bottom, left: rect.left, right: innerWidth - rect.right };
    });
    assert.strictEqual(placement.position, 'fixed', `${viewportName} ${route} fixes the Polaris composer to the viewport`);
    assert.ok(Math.abs(placement.bottomGap) <= 1, `${viewportName} ${route} anchors the Polaris composer to the bottom edge`);
    assert.ok(placement.left >= 0 && placement.right >= 0, `${viewportName} ${route} keeps the Polaris composer inside the viewport`);
  }

  if (route.endsWith('/business-profile') && viewportName !== 'zoom200') {
    const rail = await page.locator('.bp-container').evaluate(node => {
      const own = node.getBoundingClientRect();
      const parent = node.parentElement.getBoundingClientRect();
      const parentStyle = getComputedStyle(node.parentElement);
      const parentContentWidth = parent.width
        - Number.parseFloat(parentStyle.paddingLeft)
        - Number.parseFloat(parentStyle.paddingRight);
      return { ownWidth: own.width, parentContentWidth };
    });
    assert.ok(Math.abs(rail.parentContentWidth - rail.ownWidth) <= 2,
      `${viewportName} ${route} uses the full available page rail`);
  }

  if (route === '/demo' && viewportName.startsWith('mobile')) {
    const cards = page.locator('.command-center-mobile-customer');
    assert.ok(await cards.count() > 0, `${viewportName} Command Center renders grouped customer cards`);
    assert.strictEqual(await cards.evaluateAll(nodes => nodes.filter(node => node.open).length), 0,
      `${viewportName} Command Center customer cards render collapsed`);
    const firstCard = cards.first();
    const firstSummary = firstCard.locator(':scope > summary');
    await firstSummary.focus();
    await firstSummary.press('Enter');
    assert.strictEqual(await firstCard.evaluate(node => node.open), true,
      `${viewportName} Command Center expands a customer card from the keyboard`);
    const customerControl = firstSummary.locator('.command-center-record-link');
    const routeBeforeCustomerOpen = new URL(page.url()).pathname;
    await customerControl.focus();
    await customerControl.press('Enter');
    await page.locator('.customer-drawer.open[aria-hidden="false"]').waitFor();
    assert.strictEqual(new URL(page.url()).pathname, routeBeforeCustomerOpen,
      `${viewportName} Command Center customer names open the drawer without navigating to Polaris`);
    assert.strictEqual(await firstCard.evaluate(node => node.open), true,
      `${viewportName} Command Center customer-name activation does not collapse the selected card`);
  }

  if (route.endsWith('/leads') && viewportName !== 'zoom200') {
    await page.evaluate(() => {
      if (!document.querySelector('.customer-drawer')) {
        const drawer = document.createElement('div');
        drawer.className = 'customer-drawer open';
        drawer.setAttribute('data-visual-contract-probe', 'true');
        document.body.appendChild(drawer);
      }
    });
    await page.locator('.customer-drawer').waitFor({ state: 'visible' });
    const drawerAudit = await page.evaluate(() => {
      const drawer = document.querySelector('.customer-drawer');
      if (!drawer) return null;
      const rect = drawer.getBoundingClientRect();
      return {
        left: rect.left, right: innerWidth - rect.right,
        top: rect.top, bottom: innerHeight - rect.bottom,
        radius: Number.parseFloat(getComputedStyle(drawer).borderTopLeftRadius),
      };
    });
    assert.ok(drawerAudit, `${viewportName} ${route} mounts the shared customer drawer`);
    if (viewportName.startsWith('mobile')) {
      assert.ok(drawerAudit.left >= 11 && drawerAudit.right >= 11 && drawerAudit.top >= 11 && drawerAudit.bottom >= 11,
        `${viewportName} ${route} keeps the customer drawer away from every viewport edge`);
      assert.ok(drawerAudit.radius >= 18, `${viewportName} ${route} preserves the rounded mobile drawer border`);
    } else {
      assert.ok(drawerAudit.radius >= 16, `${viewportName} ${route} preserves the rounded desktop drawer border`);
    }
  }
}

async function exerciseQuickStartReopen(page) {
  let trigger = page.locator('[data-quick-start-reopen]:visible').first();
  let openedMobileNavigation = false;
  if (await trigger.count() === 0) {
    const hamburger = page.locator('#navHamburgerBtn:visible');
    assert.strictEqual(await hamburger.count(), 1, 'mobile navigation trigger is available');
    await hamburger.focus();
    await hamburger.press('Enter');
    await page.locator('#mobileMenu.open').waitFor();
    openedMobileNavigation = true;
    trigger = page.locator('[data-quick-start-reopen]:visible').first();
  }
  assert.strictEqual(await trigger.count(), 1, 'Quick Start has a reachable keyboard trigger');
  await trigger.focus();
  await trigger.press('Enter');
  const dialog = page.locator('#northstarQuickStartDialog[open]');
  await dialog.waitFor();
  assert.strictEqual(await dialog.locator(':focus').count(), 1);
  const focusables = dialog.locator('a[href],button:not([disabled])');
  const count = await focusables.count();
  assert.ok(count >= 2);
  await focusables.first().focus();
  await page.keyboard.press('Shift+Tab');
  assert.strictEqual(await dialog.evaluate(element => element.contains(document.activeElement)), true, 'reverse Tab remains in dialog');
  await page.keyboard.press('Escape');
  const returnTarget = openedMobileNavigation ? page.locator('#navHamburgerBtn') : trigger;
  assert.strictEqual(await returnTarget.evaluate(element => document.activeElement === element), true,
    'Quick Start restores focus to its reachable opener');
  if (openedMobileNavigation) {
    assert.strictEqual(await page.locator('#mobileMenu.open').count(), 0, 'Escape closes mobile navigation');
  }
  return { focusables: count, openedMobileNavigation };
}

async function roleAcceptance(browser, origin) {
  const cases = [
    { role: 'owner', route: '/dashboard/settings', expectedBadge: /Editable · Owner/i, editable: true },
    { role: 'admin', route: '/dashboard/settings', expectedBadge: /Editable · Admin/i, editable: true },
    { role: 'read-only', route: '/dashboard/settings', expectedBadge: /Read only · Viewer/i, editable: false },
    { role: 'dispatcher', route: '/dashboard/calendar', calendarMutation: true },
    { role: 'employee', route: '/dashboard/today', employeeOnly: true },
  ];
  const evidence = [];
  for (const roleCase of cases) {
    const context = await browser.newContext({ viewport: VIEWPORTS.desktop, colorScheme: 'light' });
    const boundary = { requests: [] };
    await installBoundary(context, origin, roleCase.role, boundary);
    const page = await context.newPage();
    try {
      await page.goto(`${origin}${roleCase.route}`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => document.documentElement.getAttribute('data-northstar-navigation') === 'ready');
      await closeAutomaticQuickStart(page);
      if (roleCase.expectedBadge) {
        await page.locator('#settingsRoleBadge').waitFor();
        assert.match(await page.locator('#settingsRoleBadge').innerText(), roleCase.expectedBadge);
        assert.strictEqual(await page.locator('#companyName').isEnabled(), roleCase.editable,
          `${roleCase.role} setting authority matches visible state`);
        if (!roleCase.editable) {
          assert.match(await page.locator('#settingsAccessStatus').innerText(), /owner or admin can make changes/i);
        }
      }
      if (roleCase.calendarMutation) {
        await page.waitForFunction(() => document.documentElement.dataset.canonicalAuthority === 'server');
        assert.strictEqual(await page.evaluate(() => {
          const projection = window.CanonicalIntelligence && window.CanonicalIntelligence.getProjection('calendar');
          return Boolean(projection && projection.schedulingOperator && projection.schedulingOperator.canMutate);
        }), true, 'dispatcher receives current scheduling authority');
        assert.match(await page.locator('#calendarNewEventArea').innerText(), /No unscheduled role-authorized work/i);
      }
      if (roleCase.employeeOnly) {
        await page.waitForFunction(() => document.body.getAttribute('data-today-state') === 'empty');
        assert.deepStrictEqual(await page.locator('.sidebar-nav a').evaluateAll(links => links.map(link => link.getAttribute('href'))),
          ['/dashboard/today'], 'employee Today navigation remains intentionally minimal');
        assert.match(await page.locator('#todayStatePanel').innerText(), /No work assigned for today/i);
      }
      evidence.push({ role: roleCase.role, route: roleCase.route, requests: boundary.requests.length });
    } finally {
      await context.close();
    }
  }
  return evidence;
}

async function run(engine, origin) {
  const runtime = resolveBrowserRuntime(engine);
  const browser = await runtime.browserType.launch({ executablePath: runtime.executablePath, headless: true });
  const evidence = [];
  const failures = [];
  try {
    const selectedRoutes = process.env.NORTHSTAR_P7_ROUTE
      ? MOUNTED_THEME_PAGES.filter(entry => entry.route === process.env.NORTHSTAR_P7_ROUTE)
      : MOUNTED_THEME_PAGES;
    assert.ok(selectedRoutes.length > 0, 'NORTHSTAR_P7_ROUTE must select a mounted route');
    const selectedViewports = process.env.NORTHSTAR_P7_VIEWPORT
      ? [[process.env.NORTHSTAR_P7_VIEWPORT, VIEWPORTS[process.env.NORTHSTAR_P7_VIEWPORT]]]
      : Object.entries(VIEWPORTS);
    assert.ok(selectedViewports.every(([, value]) => value), 'unknown NORTHSTAR_P7_VIEWPORT');
    const selectedThemes = process.env.NORTHSTAR_P7_THEME ? [process.env.NORTHSTAR_P7_THEME] : THEMES;
    assert.ok(selectedThemes.every(theme => THEMES.includes(theme)), 'unknown NORTHSTAR_P7_THEME');

    for (const [viewportName, viewport] of selectedViewports) {
      for (const theme of selectedThemes) {
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          colorScheme: theme,
        });
        const boundary = { requests: [] };
        await context.addInitScript(selectedTheme => {
          try { localStorage.setItem('northstar-theme', selectedTheme); } catch (_error) {}
        }, theme);
        await installBoundary(context, origin, 'owner', boundary);
        const page = await context.newPage();
        const pageErrors = [];
        const consoleErrors = [];
        page.on('pageerror', error => pageErrors.push(String(error && error.message || error)));
        page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
        try {
          for (const entry of selectedRoutes) {
            await page.goto(`${origin}${entry.route}`, { waitUntil: 'networkidle' });
            if (entry.surface === 'dashboard' || entry.surface === 'public-demo') {
              await page.waitForFunction(() => ['ready', 'denied'].includes(document.documentElement.getAttribute('data-northstar-navigation')), null, { timeout: 5000 });
            }
            await closeAutomaticQuickStart(page);
            if (viewport.zoom) {
              await page.evaluate(zoom => { document.documentElement.style.zoom = String(zoom); }, viewport.zoom);
              assert.strictEqual(await page.evaluate(() => Number.parseFloat(getComputedStyle(document.documentElement).zoom)), viewport.zoom,
                `${engine} ${viewportName} applies the requested zoom`);
            }
            const audit = await semanticAudit(page);
            await founderVisualCorrectionAudit(page, entry, viewportName);
            const label = `${engine} ${viewportName} ${theme} ${entry.route}`;
            if (audit.h1.length !== 1) failures.push({ label, kind: 'h1', value: audit.h1 });
            if (audit.mainCount !== 1) failures.push({ label, kind: 'main', value: audit.mainCount });
            if (audit.headingSkips.length) failures.push({ label, kind: 'heading-skips', value: audit.headingSkips });
            if (audit.unnamedNavigation.length) failures.push({ label, kind: 'unnamed-navigation', value: audit.unnamedNavigation });
            if (audit.unnamedControls.length) failures.push({ label, kind: 'unnamed-controls', value: audit.unnamedControls });
            if (audit.inertInteractive.length) failures.push({ label, kind: 'inert-interactive', value: audit.inertInteractive });
            if (audit.missingInlineHandlers.length) failures.push({ label, kind: 'missing-inline-handler', value: audit.missingInlineHandlers.slice(0, 20) });
            if (audit.deadLinks.length) failures.push({ label, kind: 'dead-link', value: audit.deadLinks.slice(0, 20) });
            if (audit.crampedBadges.length) failures.push({ label, kind: 'cramped-badges', value: audit.crampedBadges.slice(0, 20) });
            if (audit.unexplainedDisabledActions.length) failures.push({ label, kind: 'disabled-action-without-reason', value: audit.unexplainedDisabledActions.slice(0, 20) });
            if (audit.overflow > 1) failures.push({ label, kind: 'horizontal-overhang', value: audit.overflow });
            if (audit.forbiddenPresentation) failures.push({ label, kind: 'developer-presentation', value: audit.forbiddenPresentation });
            if (entry.route.endsWith('/polaris')) {
              if (!/No conversation selected|Choose a conversation|Ask Polaris|Start a conversation|Welcome to POLARIS/i.test(audit.bodyText)) {
                failures.push({ label, kind: 'polaris-empty-state', value: audit.bodyText.slice(0, 500) });
              }
            }
            const quickStart = entry.route === '/dashboard' && viewportName === 'mobile390' && theme === 'light'
              ? await exerciseQuickStartReopen(page)
              : null;
            evidence.push({ route: entry.route, viewport: viewportName, theme, quickStart, requests: boundary.requests.length });
          }
          assert.deepStrictEqual(pageErrors, [], `${engine} page errors`);
          assert.deepStrictEqual(consoleErrors, [], `${engine} console errors`);
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
  }
  assert.deepStrictEqual(failures, [], `${engine} route acceptance failures: ${JSON.stringify(failures)}`);
  return evidence;
}

async function main() {
  const selection = process.env.NORTHSTAR_BROWSER || 'all';
  assert.ok(['chrome', 'firefox', 'webkit', 'all'].includes(selection), 'NORTHSTAR_BROWSER must be chrome, firefox, webkit, or all');
  const engines = selection === 'all' ? ['chrome', 'firefox', 'webkit'] : [selection];
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const runs = [];
    for (const engine of engines) {
      const runtime = resolveBrowserRuntime(engine);
      const browser = await runtime.browserType.launch({ executablePath: runtime.executablePath, headless: true });
      let roles;
      try { roles = await roleAcceptance(browser, origin); } finally { await browser.close(); }
      runs.push({ engine, roles, evidence: await run(engine, origin) });
    }
    process.stdout.write(`${JSON.stringify({ success: true, runs })}\n`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  process.stderr.write(`${error && error.stack || error}\n`);
  process.exitCode = 1;
});
