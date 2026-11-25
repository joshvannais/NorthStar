'use strict';

const fs = require('node:fs');
const path = require('node:path');
const artifact = require('../../docs/architecture/MISSION_28_PART14F_BROWSER_ACCEPTANCE.json');
const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const browser = read('tests/browser/m28-part14f-automation-center-acceptance.js');
const page = read('public/js/automation-center-page.js');
const html = read('public/dashboard/automation.html');
const roadmap = read('docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md');

describe('Mission 28 Part 14F genuine browser acceptance', () => {
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
  test('shared navigation controls retain the 44px rendered target minimum', () => {
    const style = read('public/css/style.css');
    const professionalism = read('public/css/site-professionalism.css');
    const demo = read('public/css/demo-runtime.css');
    expect(style).toMatch(/\.hamburger-btn\s*\{[\s\S]*?min-height:\s*44px;/);
    expect(style).toMatch(/\.mobile-menu-close\s*\{[\s\S]*?min-width:\s*44px;[\s\S]*?min-height:\s*44px;/);
    expect(professionalism).toMatch(/\.northstar-theme-switch\s*\{[\s\S]*?height:\s*44px\s*!important;/);
    expect(demo).toMatch(/@media\(max-width:600px\)[\s\S]*?\.compact-demo \.northstar-demo-scenario-field\s*\{\s*grid-template-columns:minmax\(0,1fr\);/);
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
      chrome: { pass: true, cases: 8, pageErrors: 0, unexpectedConsoleErrors: 0, screenshots: 8 },
      playwrightWebkit: { browserRevision: 2336, browserVersion: '26.5', pass: true,
        cases: 8, pageErrors: 0, unexpectedConsoleErrors: 0, screenshots: 8 },
    });
    expect(artifact.writerExecution.chrome.resultSha256).toMatch(/^[A-F0-9]{64}$/);
    expect(artifact.writerExecution.playwrightWebkit.resultSha256).toMatch(/^[A-F0-9]{64}$/);
    expect(artifact.evidenceBoundary.writerEvidenceIndependent).toBe(false);
    expect(artifact.evidenceBoundary.rootIndependentBrowserAcceptance).toBe('pending');
  });
});
