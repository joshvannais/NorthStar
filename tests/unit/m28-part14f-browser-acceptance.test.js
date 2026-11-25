'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const artifact = require('../../docs/architecture/MISSION_28_PART14F_BROWSER_ACCEPTANCE.json');
const { errorHandler } = require('../../src/middleware/errorHandler');
const { createAutomationCenterRouter } = require('../../src/routes/automationCenter');
const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const browser = read('tests/browser/m28-part14f-automation-center-acceptance.js');
const page = read('public/js/automation-center-page.js');
const html = read('public/dashboard/automation.html');
const roadmap = read('docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md');

describe('Mission 28 Part 14F genuine browser acceptance', () => {
  test('canonical error middleware preserves bounded preview validation as 400', async () => {
    const app = express(); app.use(express.json());
    app.use('/api/v1/automation-center', createAutomationCenterRouter({
      tenantAuth: (req, _res, next) => {
        req.user = { id: '00000000-0000-4000-8000-000000000001' };
        req.userRole = 'owner'; req.tenantContext = {
          organizationId: '00000000-0000-4000-8000-000000000028',
          userId: '00000000-0000-4000-8000-000000000001', role: 'owner',
        };
        req.orgId = req.tenantContext.organizationId;
        req.authSession = { id: '00000000-0000-4000-8000-000000000002' };
        req.requestId = 'part14f-preview-validation'; next();
      },
      mutationAuth: (_req, _res, next) => next(), throttle: (_req, _res, next) => next(),
    }));
    app.use(errorHandler);
    const response = await request(app).post('/api/v1/automation-center/preview').send({
      templateId: 'custom', name: 'Bounded owner work review',
      sourceClassId: 'mission23_work_execution', actionFamily: 'internal_read_digest_task',
      recipientClass: 'tenant_owner', channelId: 'in_app_passive', timing: 'review_now', dailyLimit: 26,
    }).expect(400);
    expect(response.body.error).toMatchObject({ code: 'AUTOMATION_CENTER_PREVIEW_INVALID' });
  });
  test('binds the exact released Part 14E baseline', () => {
    expect(artifact.base).toMatchObject({
      acceptedSourceHead: 'd63b9ff59f6af6aae63e6eeaa2f9683354245eea',
      acceptedTree: 'bf795536a331b940519c33e05115ce2f93c47daa', pullRequest: 612,
      mergedMain: '1c7eea4fd98773ed07b91bc632b10ca6f1ff03e3',
      productionMigrations: '285_of_285_through_289_no_290',
    });
  });
  test('keeps the frozen Part 14F scope and Part 14G boundary', () => {
    expect(roadmap).toContain('Genuine paid and isolated-demo Chrome plus Playwright WebKit desktop/mobile acceptance');
    expect(artifact.scope).toMatchObject({ part: '14F', releaseIncluded: false, migrationAdded: false });
    expect(artifact.evidenceBoundary.part14G).toBe('not_implemented');
  });
  test.each(['chrome', 'webkit', 'desktop', 'mobile', 'light', 'dark'])(
    'declares the %s matrix axis', value => expect(JSON.stringify(artifact.scope)).toContain(value));
  test('uses the real database fixture and canonical mounted app', () => {
    expect(browser).toContain("createDatabaseFixture()");
    expect(browser).toContain("fixture.app.listen(0, '127.0.0.1')");
    expect(browser).toContain('fixture.actors.owner.session');
  });
  test('contains no browser request or response interception', () => {
    expect(browser).not.toMatch(/\.route\s*\(|route\.fulfill|route\.abort|setRequestInterception|mockResponse/i);
    expect(artifact.scope).toMatchObject({ requestInterception: false, responseInterception: false,
      routeFulfillment: false });
  });
  test('rejects every external-origin browser request', () => {
    expect(browser).toContain("assert.equal(url.origin, origin");
    expect(browser).toContain("result.requests.some(item => item.origin !== origin)");
  });
  test('covers direct, reload, back-forward and fragment deep links', () => {
    expect(browser).toContain("#automationEvidence");
    expect(browser).toContain('page.reload('); expect(browser).toContain('page.goBack(');
  });
  test('covers keyboard, focus and accessibility semantics', () => {
    expect(browser).toContain("page.locator('.automation-skip')");
    expect(browser).toContain('node.tabIndex');
    expect(browser).toContain("page.keyboard.press('Enter')");
    expect(browser).toContain("document.activeElement?.id");
    expect(browser).toContain('ariaSnapshot()');
    expect(html).toContain('id="automationMain"'); expect(html).toContain('aria-live="polite"');
  });
  test('covers responsive geometry, target size and both themes', () => {
    expect(browser).toContain('horizontalOverflow'); expect(browser).toContain('height < 44');
    expect(browser).toContain("name: 'mobile-dark'"); expect(browser).toContain("name: 'desktop-light'");
    expect(browser).toContain('isMobile: Boolean(mode.isMobile)');
    expect(browser).toContain('hasTouch: Boolean(mode.isMobile)');
  });
  test('executes each applicable workflow in every engine-surface-layout-theme slot', () => {
    expect(browser).not.toContain("mode.name === 'desktop-light'");
    expect(browser).toContain('workflowReceipts = { preview: await keyboardAndPreview(page)');
    expect(browser).toContain('workflowReceipts = { demo: await demoWorkflows(page, mode)');
    expect(browser).toContain('finalStatus: second.summaryHidden');
    expect(browser).toContain("'provider_step', 'provider_step', 'stop', 'reset_automation'");
  });
  test('uses ordinary keyboard activation for every template and the bounded custom setup', () => {
    expect(browser).toContain("assert.equal(await cards.count(), 4)");
    expect(browser).toContain("await page.keyboard.press('Enter')");
    expect(browser).not.toContain("getByRole('button', { name: 'Preview this setup' }).first().click()");
    expect(browser).toContain("await page.locator('#setupName').fill('Bounded owner work review')");
    expect(browser).toContain("await page.locator('#setupDailyLimit').fill('26')");
    expect(browser).toContain('invalidClearedPriorPreview: true');
    expect(browser).toContain('customRecovery: true');
  });
  test('keeps genuine primary pointer and touch activation alongside keyboard activation', () => {
    expect(page).toContain("button.addEventListener('pointerup', finish)");
    expect(page).toContain("button.addEventListener('touchend', finish");
    expect(page).toContain("button.addEventListener('click', function (event)");
    expect(page).toContain('if (directHandled && event.detail !== 0)');
    expect(page).toContain("document.addEventListener('pointerup', guardEnd, true)");
    expect(page).toContain("document.addEventListener('touchend', guardEnd, true)");
    expect(page).toContain('sameGesture(event) && !releaseInside(event)');
    expect(page).toContain('document.elementFromPoint(x, y)');
    expect(page).not.toContain("button.addEventListener('mouseup', finish)");
    expect(browser).toContain('submitPreviewWithPointerOrTouch');
    expect(browser).toContain('if (mode.isMobile) await button.tap()');
    expect(browser).toContain('else await button.click()');
    expect(browser).toContain("input: mode.isMobile ? 'touch' : 'pointer'");
    expect(browser).toContain('canceledPointerActivation(page, surface)');
    expect(browser).toContain('inside-to-outside cancellation must not activate');
    expect(browser).toContain('outside-to-inside release must not activate');
    expect(browser).toContain('document.elementFromPoint(inside.x, inside.y)');
    expect(html).toContain('/js/automation-center-page.js?v=m28-part14f-pointer-20261125');
    expect(browser).not.toMatch(/force\s*:/);
  });
  test('seeds and verifies meaningful tenant-private paid content before clearing it', () => {
    expect(browser).toContain('canonical_automation_store_policy_v1');
    expect(browser).toContain("assert.equal(await page.locator('#summaryPolicies').innerText(), '1')");
    expect(browser).toContain("assert.equal(await page.locator('#automationPolicies article').count(), 0)");
    expect(browser).toContain('populatedPolicyRecovered: true');
  });
  test('shared navigation controls retain the 44px rendered target minimum', () => {
    const style = read('public/css/style.css');
    const professionalism = read('public/css/site-professionalism.css');
    const demo = read('public/css/demo-runtime.css');
    expect(style).toMatch(/\.hamburger-btn\s*\{[\s\S]*?min-height:\s*44px;/);
    expect(style).toMatch(/\.mobile-menu-close\s*\{[\s\S]*?min-width:\s*44px;[\s\S]*?min-height:\s*44px;/);
    expect(professionalism).toMatch(/\.northstar-theme-switch\s*\{[\s\S]*?height:\s*44px\s*!important;/);
    expect(demo).toMatch(/@media\(max-width:600px\)[\s\S]*?\.compact-demo \.northstar-demo-scenario-field\s*\{\s*grid-template-columns:minmax\(0,1fr\);/);
  });
  test('version-binds every changed shared stylesheet through the paid and demo automation document', () => {
    for (const asset of ['demo-runtime.css', 'style.css', 'site-professionalism.css']) {
      expect(html).toContain(`/css/${asset}?v=m28-part14f-browser-20261125`);
    }
    expect(browser).toContain('warmCacheAssetVersioning: true');
    expect(browser).toContain("asset + '?v=m28-part14f-browser-20261125'");
  });
  test('executes the complete bounded demo control families through rendered buttons', () => {
    for (const action of ['source_change', 'source_correct', 'pause', 'resume', 'suppress', 'recover',
      'advance_time', 'provider_step', 'stop', 'reset_automation']) expect(browser).toContain(`'${action}'`);
    expect(browser).toContain('data-automation-demo-action');
  });
  test('covers genuine delayed, stale, error and recovery paths', () => {
    expect(browser).toContain('LOCK TABLE public.demo_command_center_sessions IN ACCESS EXCLUSIVE MODE');
    expect(browser).toContain('staleConflict(context, origin)');
    expect(browser).toContain("unavailable.port = '1'");
    expect(browser).toContain('fixture.db.initDatabase()');
  });
  test('covers paid authorization loss and fail-closed clearing', () => {
    expect(browser).toContain("UPDATE organization_memberships SET role='member'");
    expect(browser).toContain("UPDATE organization_memberships SET role='owner'");
    expect(browser).toContain("locator('#automationSummary').isHidden()");
  });
  test('retains cross-request conflict clearing in the product page', () => {
    expect(page).toMatch(/error && error\.status === 409[\s\S]+invalidateConflict/);
    expect(page).toContain('clearSensitive();');
  });
  test('keeps all effect and evidence boundaries explicit', () => {
    expect(artifact.effectBoundary).toMatchObject({ realRecipients: 0, realProviderCalls: 0,
      externalEffects: 0, financialEffects: 0, moneyEffects: 0, productionDataMutated: false,
      privateProductionRead: false });
    expect(artifact.evidenceBoundary.founderVisualApproval).toBe('separate_unavailable_unclaimed');
  });
  test('keeps physical and manual review separate from automation evidence', () => {
    expect(artifact.evidenceBoundary.physicalSafariDevices).toBe('unavailable_unclaimed');
    expect(artifact.evidenceBoundary.manualAssistiveTechnology).toBe('unavailable_unclaimed');
  });
  test('binds the exact green writer browser ledgers without calling them independent', () => {
    expect(artifact.writerExecution).toMatchObject({
      node: '22.23.3', playwrightCore: '1.62.1', requestInterception: false,
      responseInterception: false, externalOriginRequests: 0,
      chrome: { pass: true, cases: 8, pageErrors: 0, unexpectedConsoleErrors: 0, screenshots: 8,
        canceledGestureReceipts: 4, canceledGesturePosts: 0 },
      playwrightWebkit: { browserRevision: 2336, browserVersion: '26.5', pass: true,
        cases: 8, pageErrors: 0, unexpectedConsoleErrors: 0, screenshots: 8,
        canceledGestureReceipts: 4, canceledGesturePosts: 0 },
      nativeCanceledGestureProbe: { pass: true, cases: 4, hitTargetValidated: true,
        insideToOutsidePosts: 0, outsideToInsidePosts: 0, pageErrors: 0 },
    });
    expect(artifact.writerExecution.chrome.resultSha256).toMatch(/^[A-F0-9]{64}$/);
    expect(artifact.writerExecution.playwrightWebkit.resultSha256).toMatch(/^[A-F0-9]{64}$/);
    expect(artifact.evidenceBoundary.writerEvidenceIndependent).toBe(false);
    expect(artifact.evidenceBoundary.rootIndependentBrowserAcceptance).toBe('pending');
  });
});
