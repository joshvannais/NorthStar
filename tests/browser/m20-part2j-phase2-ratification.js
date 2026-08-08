'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { app } = require('../../src/server');
const { navigationFixture } = require('../helpers/navigation-fixture');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');
const { auditMountedAccessibility, assertAccessibilityAudit } = require('../helpers/theme-accessibility-audit');

const ROOT = path.resolve(__dirname, '..', '..');
const ROUTES = Object.freeze([
  '/dashboard/business-profile',
  '/dashboard/settings',
  '/dashboard/team',
  '/dashboard/integrations',
]);
const VIEWPORTS = Object.freeze([
  { label: 'desktop', width: 1440, height: 900 },
  { label: 'mobile', width: 390, height: 844 },
]);
const THEMES = Object.freeze(['light', 'dark']);
const ROLES = Object.freeze(['owner', 'viewer']);
const PROFILE = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'business-profile.json'), 'utf8'));

function json(body, status = 200) {
  return { status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) };
}

function account(role) {
  return {
    user: { id: '99000000-0000-4000-8000-000000000001', status: 'active', email: 'm20-part2j@example.test' },
    organization: { id: '99000000-0000-4000-8000-000000000002', name: 'M20 Part 2J Fixture' },
    membership: { role },
    memberships: [{ role }],
    onboarding: { status: 'complete' },
    subscription: { safe: true, state: 'active', readOnly: false, showTrialBanner: false },
    navigation: navigationFixture(),
  };
}

function workforceFixture() {
  return {
    members: [],
    invitations: [{
      invitationId: 'invite-ratification',
      name: 'Pending ratification',
      email: 'pending-ratification@example.test',
      phone: '',
      accessRole: 'member',
      operationalRole: 'employee',
      homeLocationId: null,
      skillIds: [],
      status: 'pending',
    }],
    skills: [], crews: [], locations: [], services: [],
    policies: [{ id: 'policy-ratification', name: 'Ratification policy', description: 'Literal policy bytes.', enabled: true }],
  };
}

async function installBoundary(context, origin, role, evidence, options = {}) {
  let workforceRequests = 0;
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) {
      evidence.external.push({ role, method: request.method(), url: request.url() });
      return route.fulfill({ status: 204, body: '' });
    }
    if (!url.pathname.startsWith('/api/')) return route.continue();

    evidence.api.push({ role, method: request.method(), path: url.pathname });
    assert.strictEqual(request.method(), 'GET', `automatic mutation escaped the Part 2J matrix: ${request.method()} ${url.pathname}`);
    if (options.delayMs) await new Promise(resolve => setTimeout(resolve, options.delayMs));
    if (url.pathname === '/api/auth/me') return route.fulfill(json({ account: account(role) }));
    if (url.pathname === '/api/account/subscription') {
      return route.fulfill(json({ subscription: account(role).subscription }));
    }

    const authorityFailure = options.failAuthority === true;
    if (url.pathname === '/api/v1/business-profile') {
      return route.fulfill(authorityFailure ? json({ success: false }, 503) : json({ success: true, data: PROFILE }));
    }
    if (url.pathname === '/api/assets') {
      return route.fulfill(authorityFailure ? json({ success: false }, 503) : json({
        success: true,
        data: { assets: [], locations: [], services: [], canManage: role === 'owner' },
      }));
    }
    if (url.pathname === '/api/account/preferences') {
      return route.fulfill(authorityFailure ? json({ error: 'unavailable' }, 503) : json({ preferences: {
        companyName: 'M20 Part 2J Fixture', companyInfo: 'Exact company bytes', smartRouting: true, contacts: [],
        emailEnabled: true, emailCallSummary: false, emailAppointment: true,
        smsEnabled: false, smsUrgent: false, emailAddress: '', smsNumber: '',
      } }));
    }
    if (url.pathname === '/api/workforce') {
      workforceRequests += 1;
      const workforceFailure = authorityFailure || (options.failWorkforceAfterReady && workforceRequests > 1);
      return route.fulfill(workforceFailure ? json({ error: 'unavailable' }, 503) : json({ success: true, data: workforceFixture() }));
    }
    if (url.pathname === '/api/v1/integrations/status') {
      return route.fulfill(authorityFailure ? json({ success: false }, 503) : json({ success: true, data: {
        authority: 'canonical_integration_ownership',
        connectors: [{ provider: 'retell', status: 'not_provisioned' }, { provider: 'voice', status: 'inactive' }],
      } }));
    }
    if (url.pathname === '/api/integrations/jobber/status') {
      return route.fulfill(authorityFailure
        ? json({ error: 'unavailable' }, 503)
        : json({ available: false, configured: false, connected: false }));
    }
    evidence.unexpectedApi.push({ role, method: request.method(), path: url.pathname });
    return route.fulfill(json({ error: 'unexpected API path' }, 500));
  });
}

function attachPage(page, evidence, label) {
  page.on('pageerror', error => evidence.pageErrors.push(label + ': ' + (error.stack || error.message)));
  page.on('console', message => {
    if (message.type() === 'error') evidence.consoleErrors.push(label + ': ' + message.text());
  });
}

async function waitReady(page, route) {
  if (route === '/dashboard/business-profile') {
    await page.waitForFunction(() => document.getElementById('businessProfileRoot')?.dataset.state === 'ready');
  } else if (route === '/dashboard/settings') {
    await page.waitForFunction(() => document.getElementById('notificationPreferencesAuthority')?.dataset.state === 'ready');
  } else if (route === '/dashboard/team') {
    await page.waitForFunction(() => document.documentElement.dataset.workforceState === 'ready');
  } else {
    await page.waitForFunction(() => document.getElementById('integrationStatusRoot')?.dataset.state === 'ready');
  }
}

async function pageSnapshot(page) {
  return page.evaluate(() => {
    function visible(element) {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      for (let current = element; current; current = current.parentElement) {
        const style = getComputedStyle(current);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
      }
      return true;
    }
    function accessibleName(element) {
      const direct = element.getAttribute('aria-label');
      if (direct && direct.trim()) return direct.trim();
      const labelled = element.getAttribute('aria-labelledby');
      if (labelled) {
        const text = labelled.split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ').trim();
        if (text) return text;
      }
      if (element.labels && element.labels.length) {
        const text = Array.from(element.labels).map(label => label.textContent || '').join(' ').trim();
        if (text) return text;
      }
      const title = (element.getAttribute('title') || '').trim();
      if (title) return title;
      if (element.matches('button,a[href],[role="tab"]')) return (element.textContent || '').trim();
      return '';
    }
    const controls = Array.from(document.querySelectorAll('main a[href],main button,main input:not([type="hidden"]),main select,main textarea,main [role="tab"]'))
      .filter(visible);
    const ids = Array.from(document.querySelectorAll('[id]')).map(node => node.id);
    return {
      duplicateIds: ids.filter((id, index) => ids.indexOf(id) !== index),
      unnamedControls: controls.filter(control => !accessibleName(control)).map(control => control.id || control.outerHTML.slice(0, 100)),
      main: Boolean(document.querySelector('main#mainContent[tabindex="-1"]')),
      skip: Boolean(document.querySelector('.skip-link[href="#mainContent"]')),
      toast: Boolean(document.querySelector('#toast[role="status"][aria-live="polite"][aria-atomic="true"]')),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      theme: document.documentElement.dataset.theme,
    };
  });
}

async function assertBusinessProfile(page, role) {
  const tabs = page.locator('#bpNav [role="tab"]');
  assert.strictEqual(await tabs.count(), 15, 'all Business Profile sections remain keyboard-addressable');
  await tabs.first().focus();
  await page.keyboard.press('ArrowRight');
  assert.strictEqual(await tabs.nth(1).evaluate(node => document.activeElement === node), true, 'right arrow advances tab focus');
  await page.keyboard.press('End');
  assert.strictEqual(await tabs.last().evaluate(node => document.activeElement === node), true, 'End focuses the final tab');
  for (let index = 0; index < await tabs.count(); index += 1) {
    await tabs.nth(index).click();
    const snapshot = await pageSnapshot(page);
    assert.deepStrictEqual(snapshot.unnamedControls, [], `Business Profile tab ${index} accessible names`);
  }
  const enabledEditors = await page.locator('.bp-section input:not([readonly]),.bp-section select,.bp-section textarea:not([readonly])')
    .evaluateAll(controls => controls.filter(control => !control.disabled).length);
  assert.ok(enabledEditors > 0, `${role} Business Profile values remain locally inspectable after authority load`);
  assert.strictEqual(await page.locator('#saveBtn').isDisabled(), role === 'viewer', 'only authorized roles can persist Business Profile changes');
}

async function assertSettings(page, role) {
  assert.strictEqual(await page.locator('#integration-twilio').evaluate(node =>
    document.getElementById('mainContent').contains(node)), true, 'Settings main landmark contains Integrations');
  if (role === 'owner') {
    await page.fill('#companyInfoAiContext', 'secondary edit');
    assert.strictEqual(await page.inputValue('#companyInfo'), 'secondary edit');
    await page.fill('#companyInfo', 'primary edit');
    assert.strictEqual(await page.inputValue('#companyInfoAiContext'), 'primary edit');
  } else {
    assert.strictEqual(await page.locator('[data-settings-mutable]:not(:disabled)').count(), 0, 'viewer settings are fail-closed');
  }
}

async function assertTeam(page, role) {
  if (role === 'owner') {
    assert.strictEqual(await page.locator('#invitationsPanel').isVisible(), true, 'owner sees pending invitations');
    assert.strictEqual(await page.locator('#invitationsList button').count(), 2, 'owner invitation actions render');
  } else {
    assert.strictEqual(await page.locator('#invitationsPanel').isHidden(), true, 'viewer invitation authority stays hidden');
    assert.strictEqual(await page.locator('#invitationsList button').count(), 0, 'viewer receives no invitation actions');
  }
}

async function assertIntegrations(page) {
  assert.strictEqual(await page.getAttribute('#integrationStatusRoot', 'data-state'), 'ready');
  assert.strictEqual(await page.getAttribute('#canonical-retell-status', 'data-status'), 'not_provisioned');
  assert.strictEqual(await page.getAttribute('#canonical-voice-status', 'data-status'), 'inactive');
  assert.strictEqual(await page.getAttribute('#jobber-status', 'data-status'), 'unavailable');
  assert.strictEqual(await page.locator('#jobber-btn').isDisabled(), true, 'unavailable Jobber action stays disabled');
}

async function runMatrix(browser, engine, origin, evidence) {
  const rows = [];
  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      for (const role of ROLES) {
        const context = await browser.newContext({ viewport });
        await context.addInitScript(selected => localStorage.setItem('northstar-theme', selected), theme);
        await installBoundary(context, origin, role, evidence);
        const page = await context.newPage();
        const label = `${engine} ${viewport.label} ${theme} ${role}`;
        attachPage(page, evidence, label);
        try {
          for (const route of ROUTES) {
            await page.goto(origin + route, { waitUntil: 'domcontentloaded' });
            await waitReady(page, route);
            const snapshot = await pageSnapshot(page);
            assert.deepStrictEqual(snapshot.duplicateIds, [], `${label} ${route} duplicate IDs`);
            assert.deepStrictEqual(snapshot.unnamedControls, [], `${label} ${route} accessible names`);
            assert.strictEqual(snapshot.main, true, `${label} ${route} main target`);
            assert.strictEqual(snapshot.skip, true, `${label} ${route} skip link`);
            assert.strictEqual(snapshot.toast, true, `${label} ${route} toast announcement`);
            assert.ok(snapshot.overflow <= 1, `${label} ${route} horizontal overflow ${snapshot.overflow}`);
            assert.strictEqual(snapshot.theme, theme, `${label} ${route} theme`);
            assertAccessibilityAudit(await auditMountedAccessibility(page), `${label} ${route}`);
            await page.locator('.skip-link').focus();
            await page.keyboard.press('Enter');
            assert.strictEqual(await page.locator('#mainContent').evaluate(node => document.activeElement === node), true,
              `${label} ${route} skip link moves focus to main`);
            if (route === '/dashboard/business-profile') await assertBusinessProfile(page, role);
            if (route === '/dashboard/settings') await assertSettings(page, role);
            if (route === '/dashboard/team') await assertTeam(page, role);
            if (route === '/dashboard/integrations') await assertIntegrations(page);
          }
          rows.push({ engine, viewport: viewport.label, theme, role, routes: ROUTES.length });
        } finally {
          await context.close();
        }
      }
    }
  }
  return rows;
}

async function runWorkforceReloadFailure(browser, engine, origin, evidence) {
  const context = await browser.newContext({ viewport: VIEWPORTS[1] });
  await context.addInitScript(() => localStorage.setItem('northstar-theme', 'dark'));
  await installBoundary(context, origin, 'owner', evidence, { failWorkforceAfterReady: true });
  const page = await context.newPage();
  attachPage(page, evidence, engine + ' workforce reload error');
  try {
    await page.goto(origin + '/dashboard/team', { waitUntil: 'domcontentloaded' });
    await waitReady(page, '/dashboard/team');
    assert.strictEqual(await page.locator('#invitationsPanel').isVisible(), true, 'pending invitation starts visible');
    assert.strictEqual(await page.locator('#invitationsList button:not(:disabled)').count(), 2, 'pending invitation actions start enabled');
    await page.evaluate(() => window.NorthStarWorkforce.reload());
    await page.waitForFunction(() => document.documentElement.dataset.workforceState === 'error');
    assert.strictEqual(await page.locator('#invitationsPanel').isHidden(), true, 'reload error hides stale invitation authority');
    assert.strictEqual(await page.locator('#invitationsList button').count(), 0, 'reload error removes stale invitation actions');
    const activeControls = await page.locator('#workforceShell button,#workforceShell input,#workforceShell select,#workforceShell textarea')
      .evaluateAll(controls => controls.filter(control => {
        const style = getComputedStyle(control);
        const rect = control.getBoundingClientRect();
        return !control.disabled && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      }).length);
    assert.strictEqual(activeControls, 0, 'reload error exposes no stale workforce actions');
  } finally {
    await context.close();
  }
}

async function runErrorStates(browser, engine, origin, evidence) {
  const context = await browser.newContext({ viewport: VIEWPORTS[1] });
  await context.addInitScript(() => localStorage.setItem('northstar-theme', 'light'));
  await installBoundary(context, origin, 'owner', evidence, { failAuthority: true, delayMs: 80 });
  const page = await context.newPage();
  attachPage(page, evidence, engine + ' error states');
  try {
    for (const route of ROUTES) {
      await page.goto(origin + route, { waitUntil: 'domcontentloaded' });
      if (route === '/dashboard/business-profile') {
        assert.strictEqual(await page.getAttribute('#businessProfileRoot', 'aria-busy'), 'true');
        await page.waitForFunction(() => document.getElementById('businessProfileRoot')?.dataset.state === 'error');
        assert.strictEqual(await page.locator('.bp-section input:not(:disabled),.bp-section select:not(:disabled),.bp-section textarea:not(:disabled)').count(), 0);
      } else if (route === '/dashboard/settings') {
        assert.strictEqual(await page.getAttribute('#notificationPreferencesAuthority', 'data-state'), 'loading');
        await page.waitForFunction(() => document.getElementById('notificationPreferencesAuthority')?.dataset.state === 'error');
        assert.strictEqual(await page.locator('[data-settings-mutable]:not(:disabled)').count(), 0);
      } else if (route === '/dashboard/team') {
        assert.strictEqual(await page.getAttribute('#workforceShell', 'aria-busy'), 'true');
        await page.waitForFunction(() => document.documentElement.dataset.workforceState === 'error');
        for (const id of ['membersList', 'skillsList', 'crewsList', 'policiesList']) {
          assert.match(await page.textContent('#' + id), /unavailable/i, `${engine} ${id} explicit error state`);
        }
      } else {
        assert.strictEqual(await page.getAttribute('#integrationStatusRoot', 'aria-busy'), 'true');
        await page.waitForFunction(() => document.getElementById('integrationStatusRoot')?.dataset.state === 'error');
      }
    }
  } finally {
    await context.close();
  }
}

async function listen(application) {
  const server = application.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  return server;
}

async function main() {
  const selected = (process.argv.find(value => value.startsWith('--browser=')) || '--browser=chrome').split('=')[1];
  assert.ok(['chrome', 'webkit'].includes(selected), 'browser must be chrome or webkit');
  const { browserType, executablePath } = resolveBrowserRuntime(selected);
  const server = await listen(app);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const evidence = { api: [], external: [], unexpectedApi: [], consoleErrors: [], pageErrors: [] };
  let browser;
  try {
    browser = await browserType.launch({ headless: true, executablePath });
    const matrix = await runMatrix(browser, selected, origin, evidence);
    await runErrorStates(browser, selected, origin, evidence);
    await runWorkforceReloadFailure(browser, selected, origin, evidence);
    assert.deepStrictEqual(evidence.external, [], 'provider/external requests');
    assert.deepStrictEqual(evidence.unexpectedApi, [], 'unexpected API paths');
    const expectedAuthorityErrors = evidence.consoleErrors.filter(entry =>
      entry.includes('error states: Failed to load resource: the server responded with a status of 503') ||
      entry.includes('workforce reload error: Failed to load resource: the server responded with a status of 503'));
    const unexpectedConsoleErrors = evidence.consoleErrors.filter(entry => !expectedAuthorityErrors.includes(entry));
    assert.deepStrictEqual(unexpectedConsoleErrors, [], 'unexpected console errors');
    assert.ok(expectedAuthorityErrors.length >= ROUTES.length, 'negative controls must observe failed authority responses');
    assert.deepStrictEqual(evidence.pageErrors, [], 'page errors');
    process.stdout.write(JSON.stringify({
      success: true,
      engine: selected === 'chrome' ? 'installed Chrome' : 'actual Playwright WebKit',
      physicalSafari: false,
      matrix,
      errorRoutes: ROUTES,
      reloadErrorRoutes: ['/dashboard/team'],
      automaticMethods: [...new Set(evidence.api.map(item => item.method))],
      providerRequests: evidence.external.length,
      expectedAuthorityConsoleErrors: expectedAuthorityErrors.length,
      unexpectedConsoleErrors: unexpectedConsoleErrors.length,
    }) + '\n');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  process.stderr.write((error && error.stack || String(error)) + '\n');
  process.exitCode = 1;
});
