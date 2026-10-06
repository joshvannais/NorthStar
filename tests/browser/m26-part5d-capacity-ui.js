'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');
const capacity = require('../../public/js/command-center-capacity-research');

const engine = process.argv[2];
const output = path.resolve(process.argv[3]);
assert.ok(!fs.existsSync(output), 'Browser evidence directory must be new');
fs.mkdirSync(output, { recursive: true });
const dashboard = fs.readFileSync(path.resolve('public/demo-dashboard.html'), 'utf8');
const start = dashboard.indexOf('<section class="demo-panel command-center-capacity"');
const end = dashboard.indexOf('<section class="demo-panel command-center-resource-outlook"', start);
assert.ok(start > 0 && end > start, 'Capacity component must stay mounted in the existing dashboard');
const fragment = dashboard.slice(start, end);

function response(status, data) {
  return { status, data: data || null };
}

(async () => {
  let browser;
  const result = {
    engine,
    pass: false,
    cases: [],
    boundary: 'Local synthetic browser evidence for the shared Part 5D production UI engine. It is not provider, private-production, physical Safari/device, complete accessibility or founder visual evidence.',
  };
  try {
    const runtime = resolveBrowserRuntime(engine);
    browser = await runtime.browserType.launch({ headless: true, executablePath: runtime.executablePath });

    async function makePage({ width, height = 1050, theme = 'light', mode = 'paid', reducedMotion = false }) {
      const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme });
      const page = await context.newPage();
      if (reducedMotion) await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.setContent('<!doctype html><html><head></head><body><main></main></body></html>');
      const styles = ['style.css', 'demo-dashboard.css'].map(file =>
        fs.readFileSync(path.resolve('public/css', file), 'utf8')).join('\n');
      await page.evaluate(({ fragment, theme, styles }) => {
        const style = document.createElement('style'); style.textContent = styles; document.head.append(style);
        document.documentElement.dataset.theme = theme;
        document.querySelector('main').innerHTML = fragment;
      }, { fragment, theme, styles });
      await page.addScriptTag({ path: path.resolve('public/js/command-center-capacity-research.js') });
      await page.evaluate(({ mode }) => {
        window.__calls = [];
        window.__responses = [];
        window.__controller = NorthStarCapacityResearch.create({
          mode,
          document,
          idempotency: () => 'm26-part5d-browser-exact-key',
          fetcher: async (url, options) => {
            window.__calls.push({ url, method: options.method, body: options.body || null,
              idempotencyKey: options.headers && options.headers['Idempotency-Key'] || null });
            const next = window.__responses.shift();
            if (!next) throw new Error('Unexpected capacity request');
            if (next.reject) throw new Error('Synthetic connection failure');
            if (next.hold) await new Promise(resolve => { window.__releaseCapacityResponse = resolve; });
            return { ok: next.status >= 200 && next.status < 300, status: next.status,
              json: async () => next.status >= 200 && next.status < 300
                ? { success: true, data: next.data }
                : { success: false, error: 'Generic failure' } };
          },
        });
      }, { mode });
      return { context, page };
    }

    async function openDetails(page, ...ids) {
      await page.locator('#commandCenterCapacityDetails').evaluate(item => { item.open = true; });
      for (const id of ids) await page.locator('#' + id).evaluate(item => { item.open = true; });
    }

    {
      const { context, page } = await makePage({ width: 1024, theme: 'dark' });
      await page.evaluate(journey => {
        window.__responses.push({ status: 200, data: journey, hold: true });
        window.__pendingCapacityLoad = window.__controller.workspaceReady(
          'paid:empty-tenant:revision:digest:session:generation:expiry');
      }, capacity.demoJourney(0));
      assert.match(await page.locator('#commandCenterCapacityState').innerText(), /Checking records/);
      assert.equal(await page.getByRole('button', { name: 'Check current records', exact: true }).isDisabled(), true);
      await page.evaluate(() => window.__releaseCapacityResponse());
      await page.evaluate(() => window.__pendingCapacityLoad);
      assert.match(await page.locator('#commandCenterCapacityState').innerText(), /Review needed/);
      const darkPresentation = await page.evaluate(() => {
        const parse = value => {
          const channels = String(value).match(/[\d.]+/g).map(Number);
          return { r: channels[0], g: channels[1], b: channels[2], a: channels[3] ?? 1 };
        };
        const blend = (top, bottom) => ({
          r: top.r * top.a + bottom.r * (1 - top.a),
          g: top.g * top.a + bottom.g * (1 - top.a),
          b: top.b * top.a + bottom.b * (1 - top.a),
          a: 1,
        });
        const luminance = color => {
          const channels = [color.r, color.g, color.b].map(channel => {
            const value = channel / 255;
            return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
          });
          return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
        };
        const ratio = (left, right) => {
          const bright = Math.max(luminance(left), luminance(right));
          const dark = Math.min(luminance(left), luminance(right));
          return (bright + .05) / (dark + .05);
        };
        const pill = document.getElementById('commandCenterCapacityState');
        const root = document.getElementById('commandCenterCapacityRoot');
        const surface = parse(getComputedStyle(root).backgroundColor);
        const contrasts = {};
        for (const state of ['current', 'review', 'stale', 'failed', 'restricted']) {
          pill.dataset.state = state;
          const style = getComputedStyle(pill);
          contrasts[state] = ratio(parse(style.color), blend(parse(style.backgroundColor), surface));
        }
        pill.dataset.state = 'review';
        const primary = document.getElementById('commandCenterCapacityPrimaryAction');
        const fontProbe = document.createElement('span');
        fontProbe.style.fontFamily = 'var(--font-sans)';
        root.append(fontProbe);
        const northStarFont = getComputedStyle(fontProbe).fontFamily;
        fontProbe.remove();
        return {
          contrasts,
          buttonFont: getComputedStyle(primary).fontFamily,
          northStarFont,
        };
      });
      for (const [state, ratio] of Object.entries(darkPresentation.contrasts)) {
        assert.ok(ratio >= 4.5, `Dark ${state} status contrast must be at least 4.5:1; received ${ratio}`);
      }
      assert.equal(darkPresentation.buttonFont, darkPresentation.northStarFont,
        'Capacity buttons must use the NorthStar interface typography');
      assert.match(await page.locator('#commandCenterCapacitySetupTitle').textContent(), /Confirm accepted-work period/);
      for (const button of await page.locator('[data-capacity-lane]').all()) assert.equal(await button.isDisabled(), true);
      assert.equal(await page.evaluate(() => window.__calls.map(item => item.method).join(',')), 'GET');
      await page.locator('#commandCenterCapacityRoot').screenshot({ path: path.join(output, 'paid-empty-prerequisite-ready.png') });
      result.cases.push({ name: 'paid-loading-empty-prerequisite', requests: ['GET'],
        enabledGuaranteedFailure: false, darkStatusContrast: darkPresentation.contrasts,
        buttonTypography: 'NorthStar font token', pass: true });
      await context.close();
    }

    {
      const { context, page } = await makePage({ width: 1440, theme: 'light', reducedMotion: true });
      assert.equal(await page.evaluate(() => window.__calls.length), 0, 'Page construction must perform no request');
      await page.evaluate(journey => {
        window.__responses.push({ status: 200, data: journey });
        return window.__controller.workspaceReady('paid:tenant:revision:digest:session:generation:expiry');
      }, capacity.demoJourney(5));
      const text = await page.locator('#commandCenterCapacityRoot').textContent();
      for (const copy of ['Accepted work demand', 'Work expected to remain', 'Role capacity available',
        'Crew', 'Skill', 'Working hours', 'Location', 'Travel', 'Vehicle', 'Equipment',
        'Team coverage', 'Work remaining', 'Overtime pattern', 'Contractor review', 'Hiring pattern',
        'Reviewed: none found', 'Alternative scenarios stay separate', 'The next review is active',
        'consecutive, gap-free reviews', 'same work group, role, method, and rule',
        'Team capacity, work demand, and gap amounts remain private']) assert.match(text, new RegExp(copy));
      const historyText = await page.locator('#commandCenterCapacityHistory').textContent();
      assert.match(historyText, /capacity advisory continuation missed/i);
      assert.match(historyText, /33333333-3333-4333-8333-333333333338/);
      assert.match(historyText, /33333333-3333-4333-8333-333333333339/);
      assert.equal(await page.evaluate(() => window.__calls.map(item => item.method).join(',')), 'GET');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const reduced = await page.locator('#commandCenterCapacityState').evaluate(element =>
        Number.parseFloat(getComputedStyle(element).transitionDuration || '0') <= 0.001);
      assert.equal(reduced, true, 'Reduced-motion media rule must bound transitions');
      await page.locator('#commandCenterCapacityRoot').screenshot({ path: path.join(output, 'paid-desktop-current.png') });
      await page.evaluate(() => {
        window.__capacityScrollCalls = [];
        Element.prototype.scrollIntoView = function (options) { window.__capacityScrollCalls.push(options); };
      });
      await page.getByRole('button', { name: 'Review capacity signals', exact: true }).click();
      const openedFocus = await page.evaluate(() => ({
        tagName: document.activeElement.tagName,
        parentId: document.activeElement.parentElement && document.activeElement.parentElement.id,
        scrollCalls: window.__capacityScrollCalls.length,
      }));
      assert.deepEqual(openedFocus, { tagName: 'SUMMARY', parentId: 'commandCenterCapacitySignalsDetails',
        scrollCalls: 0 }, 'Target-only review must move focus without scripted smooth scrolling');
      result.cases.push({ name: 'paid-desktop-current', requests: ['GET'], reducedMotion: true,
        targetFocus: 'summary', scriptedSmoothScroll: false, overflow: false, pass: true });
      await context.close();
    }

    {
      const { context, page } = await makePage({ width: 390, height: 844, theme: 'light', reducedMotion: true });
      await page.evaluate(journey => {
        window.__responses.push({ status: 200, data: journey });
        return window.__controller.workspaceReady('paid:mobile-review:revision:digest:session:generation:expiry');
      }, capacity.demoJourney(1));
      assert.equal(await page.locator('#commandCenterCapacityState').innerText(), 'Review needed');
      assert.equal(await page.locator('#commandCenterCapacityRoot details[open]').count(), 0,
        'The initial mobile view must keep supporting detail collapsed');
      assert.equal(await page.locator('.command-center-capacity-disclosures > details').count(), 1,
        'The default surface must expose one outer details drill-in');
      assert.equal(await page.locator('#commandCenterCapacityDetails > summary').innerText(), 'Review details');
      const primary = page.locator('#commandCenterCapacityRoot .btn-primary:not([disabled])');
      assert.equal(await primary.count(), 1, 'The capacity card must expose one enabled primary action');
      assert.equal(await primary.innerText(), 'Review capacity signals');
      assert.equal(await primary.getAttribute('aria-controls'),
        'commandCenterCapacityDetails commandCenterCapacitySignalsDetails');
      assert.match(await page.locator('#commandCenterCapacityNotice').innerText(),
        /private capacity signals stay hidden until a person reviews them/i);
      assert.match(await page.locator('.command-center-capacity-impact').innerText(),
        /no employee assignments, schedule changes, overtime approvals, hiring, or contractor contact/i);
      const topAnswerWithinTwoScreens = await primary.evaluate(element =>
        element.getBoundingClientRect().bottom <= window.innerHeight * 2);
      assert.equal(topAnswerWithinTwoScreens, true,
        'The assessment and next action must appear within the first two mobile screenfuls');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.locator('#commandCenterCapacityRoot').screenshot({
        path: path.join(output, 'paid-mobile-review-needed-collapsed.png'),
      });
      result.cases.push({ name: 'paid-mobile-review-needed-collapsed', detailsCollapsed: true,
        enabledPrimaryActions: 1, topAnswerWithinTwoScreens: true, overflow: false, pass: true });
      await context.close();
    }

    {
      const { context, page } = await makePage({ width: 390, height: 1200, theme: 'light', reducedMotion: true });
      const scoped = capacity.demoJourney(0);
      scoped.setup = { state: 'ready', action: 'constrained_work_scopes', token: 'd'.repeat(64), lane: 'all',
        label: 'Review source-backed work formations',
        explanation: 'Approve the complete accepted-work formation set after reviewing every dimension and role classification.',
        reasonLimit: 1000, hiringConsecutivePeriods: 3, scopeReviews: [{
          scopeKey: 'accepted_crew_safe_fixture', formation: 'crew',
          dimensions: { crew: 'applies', skill: 'applies', workingHours: 'applies', location: 'applies',
            travel: 'applies', vehicle: 'applies', equipment: 'applies' },
          targetRole: 'technician', supportRoles: ['dispatcher'], operatorRoles: [],
          targetRoleOptions: ['dispatcher', 'technician'],
          selectableTargetRoles: ['dispatcher'],
          operatorRoleCombinations: [
            { targetRole: 'dispatcher', operatorRoles: ['technician'] },
            { targetRole: 'dispatcher', operatorRoles: ['dispatcher', 'technician'] },
          ],
          sourceState: 'source_backed',
          reviewState: 'needs_review',
        }] };
      await page.evaluate(journey => {
        window.__responses.push({ status: 200, data: journey });
        return window.__controller.workspaceReady('paid:scope-review:revision:digest:session:generation:expiry');
      }, scoped);
      await page.getByRole('button', { name: 'Review team information', exact: true }).click();
      assert.equal(await page.locator('#commandCenterCapacityDetails').evaluate(item => item.open), true);
      assert.equal(await page.locator('#commandCenterCapacityReviewDetails').evaluate(item => item.open), true);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'commandCenterCapacityTargetRole0',
        'Team-information review must focus the first required role control');
      const scopeText = await page.locator('#commandCenterCapacityScopeReviews').textContent();
      for (const copy of ['Accepted work group', 'Crew-based work', 'Crew', 'Skill',
        'Working hours', 'Location', 'Travel', 'Vehicle', 'Equipment', 'Primary role this work depends on',
        'Choose the primary role before saving', 'Role coverage for required vehicles and equipment',
        'complete role combination current records can support without assigning the same person twice',
        'Accepted working hours for that exact combination set the available vehicle and equipment window',
        'Employee names, asset identities, and private amounts remain hidden']) assert.match(scopeText, new RegExp(copy));
      const checkedDisclosure = page.locator('.command-center-capacity-scope-evidence');
      assert.equal(await checkedDisclosure.count(), 1);
      assert.equal(await checkedDisclosure.evaluate(item => item.open), false);
      assert.equal(await checkedDisclosure.locator('summary').innerText(), 'What NorthStar checked');
      const setupButton = page.getByRole('button', { name: 'Confirm role coverage for accepted work', exact: true });
      assert.equal(await setupButton.isDisabled(), true);
      await page.locator('#commandCenterCapacityReviewReason').fill(
        'Approve this exact nonnumeric seven-dimension and mixed-role classification review.');
      assert.equal(await setupButton.isDisabled(), true);
      const targetRole = page.locator('#commandCenterCapacityTargetRole0');
      await targetRole.focus(); await targetRole.selectOption('dispatcher');
      assert.match(await page.locator('#commandCenterCapacityScopeReviews').innerText(), /Other roles involved: Technician/);
      assert.equal(await page.getByRole('radio', { name: 'Dispatcher', exact: true }).count(), 0);
      const technicianOperators = page.getByRole('radio', { name: 'Technician', exact: true });
      const dispatcherTechnicianOperators = page.getByRole('radio', {
        name: 'Dispatcher + Technician', exact: true,
      });
      assert.equal(await technicianOperators.count(), 1);
      assert.equal(await dispatcherTechnicianOperators.count(), 1);
      assert.match(await page.locator('#commandCenterCapacityScopeReviews').innerText(),
        /Dispatcher \+ Technician/);
      await technicianOperators.focus(); await page.keyboard.press('Space');
      assert.equal(await technicianOperators.isChecked(), true);
      assert.equal(await setupButton.isDisabled(), false);
      await page.locator('#commandCenterCapacityRoot').screenshot({
        path: path.join(output, 'paid-mobile-scope-review.png'),
      });
      await page.evaluate(({ saved, next }) => window.__responses.push(
        { status: 201, data: saved }, { status: 200, data: next }), {
        saved: { state: 'capacity_research_setup_recorded', action: 'constrained_work_scopes',
          token: 'd'.repeat(64), receiptId: '44444444-4444-4444-8444-444444444445', revision: 1,
          hiringConsecutivePeriods: 3, researchOnly: true, automaticActionTaken: false, replayed: false },
        next: capacity.demoJourney(1),
      });
      await setupButton.focus(); await page.keyboard.press('Enter');
      await page.waitForFunction(() => window.__calls.filter(item => item.method === 'POST').length === 1);
      const calls = await page.evaluate(() => window.__calls);
      const submitted = JSON.parse(calls.find(item => item.method === 'POST').body);
      assert.deepEqual(submitted.scopeReviews, [{ scopeKey: 'accepted_crew_safe_fixture',
        targetRole: 'dispatcher', operatorRoles: ['technician'] }]);
      assert.equal(/profileId|crewId|assetId|appointmentId|assignmentId|memberId|jobId|digest|Minutes/i
        .test(JSON.stringify(submitted.scopeReviews)), false);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const reduced = await page.locator('#commandCenterCapacityState').evaluate(element =>
        Number.parseFloat(getComputedStyle(element).transitionDuration || '0') <= 0.001);
      assert.equal(reduced, true);
      await page.locator('#commandCenterCapacityRoot').screenshot({
        path: path.join(output, 'paid-mobile-scope-review-complete.png'),
      });
      result.cases.push({ name: 'paid-mobile-seven-dimension-role-review', exactSafeDisclosure: true,
        keyboard: true, reducedMotion: true, overflow: false, pass: true });
      await context.close();
    }

    {
      const { context, page } = await makePage({ width: 1024, theme: 'light' });
      await page.evaluate(journey => {
        window.__responses.push({ status: 200, data: journey });
        return window.__controller.workspaceReady('paid:review');
      }, capacity.demoJourney(1));
      await openDetails(page, 'commandCenterCapacitySignalsDetails');
      await page.locator('#commandCenterCapacityReviewReason').focus();
      await page.keyboard.type('Approve this exact fictional qualitative research receipt.');
      const approve = page.getByRole('button', { name: 'Use these signals', exact: true });
      await approve.focus();
      assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), 'Use these signals');
      await page.evaluate(({ decision, next }) => {
        window.__responses.push({ status: 201, data: decision }, { status: 200, data: next });
      }, { decision: { state: 'capacity_advisory_decision_recorded',
        id: '44444444-4444-4444-8444-444444444444', originId: '33333333-3333-4333-8333-333333333331',
        action: 'approve', revision: 1, researchOnly: true, automaticActionTaken: false, replayed: false,
        previousDecisionId: null, previousDecisionRevision: 0 },
      next: capacity.demoJourney(2) });
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => window.__controller.inspect().journey &&
        window.__controller.inspect().journey.advisory.selectedContinuation);
      const calls = await page.evaluate(() => window.__calls);
      assert.deepEqual(calls.map(item => item.method), ['GET', 'POST', 'GET']);
      assert.match(calls[1].url, /\/safe-decisions$/);
      assert.equal(calls[1].idempotencyKey, 'm26-part5d-browser-exact-key');
      assert.deepEqual(JSON.parse(calls[1].body), {
        action: 'approve', expectedDecisionId: null, expectedDecisionRevision: 0,
        reason: 'Approve this exact fictional qualitative research receipt.', confirmed: true,
        confirmationVersion: 'm26-capacity-ui-decision-v1',
      });
      assert.match(await page.locator('#commandCenterCapacityContinuation').innerText(), /Next review pending/);
      assert.match(await page.locator('#commandCenterCapacityCategories').innerText(), /Hiring pattern[\s\S]*More history needed/i);
      await page.locator('#commandCenterCapacityRoot').screenshot({ path: path.join(output, 'paid-desktop-insufficient-history.png') });
      result.cases.push({ name: 'paid-keyboard-human-review', requests: calls.map(item => item.method), pass: true });
      await context.close();
    }

    {
      const { context, page } = await makePage({ width: 1024, theme: 'light' });
      await page.evaluate(journey => {
        window.__responses.push({ status: 200, data: journey });
        return window.__controller.workspaceReady('paid:uncertain-decision');
      }, capacity.demoJourney(1));
      await openDetails(page, 'commandCenterCapacitySignalsDetails');
      await page.locator('#commandCenterCapacityReviewReason').fill(
        'Review this exact private capacity signal decision.');
      await page.evaluate(() => window.__responses.push({ status: 503 }));
      await page.getByRole('button', { name: 'Use these signals', exact: true }).click();
      const interrupted = page.getByRole('button', { name: 'Review interrupted update', exact: true });
      await interrupted.waitFor();
      assert.equal(await page.locator('#commandCenterCapacityRecordControls').evaluate(item => item.open), false);
      assert.equal(await interrupted.getAttribute('aria-controls'),
        'commandCenterCapacityDetails commandCenterCapacityReviewDetails commandCenterCapacityRecordControls');
      await interrupted.click();
      assert.equal(await page.locator('#commandCenterCapacityReviewDetails').evaluate(item => item.open), true);
      assert.equal(await page.locator('#commandCenterCapacityRecordControls').evaluate(item => item.open), true);
      const retry = page.getByRole('button', { name: 'Retry the same update', exact: true });
      assert.equal(await retry.isVisible(), true);
      assert.equal(await retry.evaluate(element => document.activeElement === element), true);
      assert.deepEqual((await page.evaluate(() => window.__calls)).map(item => item.method), ['GET', 'POST']);
      result.cases.push({ name: 'paid-uncertain-decision-reveals-exact-retry',
        nestedDisclosureOpened: true, retryFocused: true, pass: true });
      await context.close();
    }

    {
      const { context, page } = await makePage({ width: 1024, theme: 'light' });
      await page.evaluate(journey => {
        window.__responses.push({ status: 200, data: journey });
        return window.__controller.workspaceReady('paid:uncertain');
      }, capacity.demoJourney(3));
      await openDetails(page, 'commandCenterCapacityReviewDetails', 'commandCenterCapacityRecordControls');
      await page.locator('#commandCenterCapacityLaneReason').fill('Recover this exact accepted workload research position.');
      await page.evaluate(() => window.__responses.push({ status: 503 }));
      await openDetails(page, 'commandCenterCapacityChecksDetails');
      await page.getByRole('button', { name: 'Save an updated capacity check', exact: true }).first().click();
      await page.getByRole('button', { name: 'Retry the same update', exact: true }).waitFor();
      assert.match(await page.locator('#commandCenterCapacityState').innerText(), /Update needed/);
      await page.evaluate(({ mutation, next }) => window.__responses.push(
        { status: 201, data: mutation }, { status: 200, data: next }), {
        mutation: { state: 'capacity_research_action_recorded', action: 'workload_capture_origin',
          receiptId: '55555555-5555-4555-8555-555555555555', originId: '55555555-5555-4555-8555-555555555555',
          outcomeId: null, continuationId: null, correctionOriginId: null, revision: null, researchOnly: true,
          automaticActionTaken: false, replayed: false },
        next: capacity.demoJourney(4),
      });
      await page.getByRole('button', { name: 'Retry the same update', exact: true }).click();
      await page.waitForFunction(() => window.__controller.inspect().journey &&
        window.__controller.inspect().journey.advisory.selectedContinuation &&
        window.__controller.inspect().journey.advisory.selectedContinuation.state.endsWith('_missed'));
      const posts = (await page.evaluate(() => window.__calls)).filter(item => item.method === 'POST');
      assert.equal(posts.length, 2);
      assert.deepEqual(posts[1], posts[0], 'Uncertain retry must reuse exact endpoint, body and idempotency key');
      assert.match(await page.locator('#commandCenterCapacityState').innerText(), /Review needed/);
      assert.match(await page.locator('#commandCenterCapacityContinuation').textContent(), /missed its fixed deadline/);
      result.cases.push({ name: 'paid-uncertain-exact-retry-recovery', exactRetry: true, pass: true });
      await context.close();
    }

    for (const item of [
      { name: 'restricted', status: 403, label: /Not enough information/ },
      { name: 'conflict', status: 409, label: /Update needed/ },
      { name: 'uncertain', status: 503, label: /Not enough information/,
        notice: /could not check current capacity records/i },
      { name: 'known-failure', status: 400, label: /Not enough information/ },
      { name: 'unavailable', status: 404, label: /Not enough information/ },
    ]) {
      const { context, page } = await makePage({ width: 900 });
      await page.evaluate(status => {
        window.__responses.push({ status });
        return window.__controller.workspaceReady('paid:state:' + status);
      }, item.status);
      assert.match(await page.locator('#commandCenterCapacityState').innerText(), item.label);
      if (item.notice) {
        assert.match(await page.locator('#commandCenterCapacityNotice').innerText(), item.notice);
        assert.doesNotMatch(await page.locator('#commandCenterCapacityNotice').innerText(),
          /update finished|protected update/i);
      }
      assert.equal(await page.evaluate(() => window.__controller.inspect().journey), null);
      assert.equal(await page.getByRole('button', { name: 'Retry the same update', exact: true }).isHidden(), true,
        'Read failures and known write failures must not invent a retryable mutation');
      result.cases.push({ name: `paid-${item.name}`, status: item.status, staleClaimCleared: true, pass: true });
      await context.close();
    }

    {
      const { context, page } = await makePage({ width: 900 });
      await page.evaluate(() => window.__controller.workspaceUnavailable());
      assert.match(await page.locator('#commandCenterCapacityState').innerText(), /Not enough information/);
      assert.equal(await page.evaluate(() => window.__calls.length), 0);
      result.cases.push({ name: 'workspace-unavailable', requests: [], pass: true });
      await context.close();
    }

    {
      const { context, page } = await makePage({ width: 390, height: 1100, theme: 'dark', mode: 'demo' });
      await page.evaluate(() => window.__controller.workspaceReady(
        'demo:tenant:revision:digest:session:generation:expiry'));
      assert.equal(await page.evaluate(() => window.__calls.length), 0);
      assert.match(await page.locator('#commandCenterCapacityState').innerText(), /Review needed/);
      assert.match(await page.locator('#commandCenterCapacitySetupTitle').textContent(), /Confirm accepted-work period/);
      assert.equal(await page.locator('#commandCenterCapacityDetails').evaluate(item => item.open), false,
        'Demo must begin as one collapsed insight');
      assert.equal(await page.locator('#commandCenterCapacityDemoControls').isVisible(), false,
        'Fictional lifecycle controls must stay inside the collapsed detail');
      const visibleActions = await page.locator('#commandCenterCapacityRoot').evaluate(root =>
        Array.from(root.querySelectorAll('button')).filter(button =>
          !button.disabled && button.getClientRects().length > 0).map(button => button.textContent.trim()));
      assert.deepEqual(visibleActions, ['Explore this fictional check'],
        'Collapsed demo must present exactly one visible enabled action');
      assert.equal(await page.locator('#commandCenterCapacityReviewDetails').evaluate(item => item.hidden), true,
        'Paid team review disclosure must be absent in demo mode');
      assert.equal(await page.locator('#commandCenterCapacityReviewDetails > summary').isVisible(), false,
        'Demo users must not be able to focus an empty paid review disclosure');
      await page.getByRole('button', { name: 'Explore this fictional check', exact: true }).click();
      assert.equal(await page.locator('#commandCenterCapacityDetails').evaluate(item => item.open), true);
      assert.equal(await page.locator('#commandCenterCapacityChecksDetails').evaluate(item => item.open), true);
      assert.equal(await page.locator('#commandCenterCapacityChecksDetails > summary').evaluate(item =>
        item === document.activeElement), true, 'Primary demo action must focus the opened check');
      assert.equal(await page.locator('#commandCenterCapacityDemoControls').isVisible(), true,
        'Fictional lifecycle controls may appear only after Review details opens');
      assert.equal(await page.locator('#commandCenterCapacityReviewDetails').isVisible(), false);
      await openDetails(page, 'commandCenterCapacitySignalsDetails');
      assert.match(await page.locator('#commandCenterCapacityTargets').innerText(), /Not enough current information/);
      const demoButton = name => page.getByRole('button', { name, exact: true });
      await demoButton('Continue fictional journey').click();
      assert.match(await page.locator('#commandCenterCapacityAdvisoryState').innerText(), /Current records/);
      await demoButton('Continue fictional journey').click();
      assert.match(await page.locator('#commandCenterCapacityContinuation').innerText(), /Next review pending/);
      assert.match(await page.locator('#commandCenterCapacityCategories').innerText(), /Hiring pattern[\s\S]*More history needed/i);
      await demoButton('Change fictional source').click();
      assert.match(await page.locator('#commandCenterCapacityState').innerText(), /Update needed/);
      assert.match(await page.locator('#commandCenterCapacityContinuation').innerText(), /out of date/);
      await demoButton('Recover with new receipts').click();
      assert.match(await page.locator('#commandCenterCapacityState').innerText(), /Review needed/);
      assert.match(await page.locator('#commandCenterCapacityContinuation').innerText(), /missed its fixed deadline/);
      await demoButton('Continue fictional journey').click();
      assert.match(await page.locator('#commandCenterCapacityContinuation').innerText(), /next review is active/i);
      assert.match(await page.locator('#commandCenterCapacityHistory').textContent(), /capacity advisory continuation missed/i);
      assert.equal(await page.evaluate(() => window.__calls.length), 0, 'Demo lifecycle must make zero paid API calls');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.locator('#commandCenterCapacityRoot').screenshot({ path: path.join(output, 'demo-mobile-recovered.png') });
      await demoButton('Reset capacity research').click();
      assert.match(await page.locator('#commandCenterCapacityTargets').innerText(), /Not enough current information/);
      await demoButton('Continue fictional journey').click();
      await page.evaluate(() => window.__controller.workspaceReady('demo:tenant:revision:digest:session:generation-2:expiry'));
      assert.equal(await page.evaluate(() => window.__controller.inspect().demoStage), 0,
        'Generation identity change must reset local demo state');
      assert.equal(await page.evaluate(() => window.__calls.length), 0);
      result.cases.push({ name: 'demo-mobile-isolated-lifecycle', paidApiCalls: 0,
        productionAccess: 0, defaultVisibleActions: ['Explore this fictional check'], paidReviewHidden: true,
        reset: true, generationInvalidation: true, overflow: false, pass: true });
      await context.close();
    }

    result.pass = true;
  } catch (error) {
    result.error = error.stack;
    process.exitCode = 1;
  } finally {
    await browser?.close();
    fs.writeFileSync(path.join(output, 'RESULT.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
