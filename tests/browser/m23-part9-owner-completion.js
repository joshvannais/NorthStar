'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');
const fixtureData = require('../helpers/m23-part9-owner-completion-fixture');

process.chdir(path.resolve(__dirname, '../..'));
process.env.NODE_ENV = 'test';
for (const key of ['DATABASE_URL','MIGRATION_DATABASE_URL','OPENAI_API_KEY','POLARIS_OPENAI_ENABLED','RETELL_API_KEY',
  'STRIPE_SECRET_KEY','TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','RESEND_API_KEY','SMTP_HOST','SMTP_USER','SMTP_PASS']) delete process.env[key];
const option = (key, fallback) => (process.argv.find(value => value.startsWith('--' + key + '=')) || '--' + key + '=' + fallback).split('=').slice(1).join('=');

async function main() {
  const selected = option('browser', 'chrome'), hostile = process.argv.includes('--hostile'), durable = process.argv.includes('--database');
  const output = path.resolve(option('output', ''));
  assert.ok(process.argv.some(value => value.startsWith('--output=')) && !fs.existsSync(output), 'new evidence directory required');
  fs.mkdirSync(output, { recursive: true });
  const ledger = { browser: selected, version: null, authority: durable ? 'mounted PostgreSQL runtime authority' : 'intercepted synthetic presentation responses',
    hostile, cases: [], externalBlocked: [], providerCalls: 0, serverExternalAttempts: 0, pageErrors: [], mutationCount: 0,
    limits: 'Playwright WebKit is not physical Safari; reflow viewports are not native browser zoom or manual assistive-technology approval' };
  let fixture, server, browser, activePage;
  const https = require('node:https'), oldRequest = https.request, oldGet = https.get, oldFetch = globalThis.fetch;
  const denyServerExternal = () => { ledger.serverExternalAttempts += 1; throw new Error('Server external transport forbidden in this local browser test'); };
  https.request = denyServerExternal; https.get = denyServerExternal; globalThis.fetch = denyServerExternal;
  try {
    if (durable) fixture = await fixtureData.createDatabaseFixture();
    const app = fixture ? fixture.app : require('../../src/server').app;
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const runtime = resolveBrowserRuntime(selected);
    browser = await runtime.browserType.launch({ headless: true, executablePath: runtime.executablePath });
    ledger.version = browser.version();
    const profiles = [ { name: '1440', width: 1440, height: 1000 }, { name: '390', width: 390, height: 844 },
      { name: '320', width: 320, height: 700 }, { name: 'reflow-200', width: 720, height: 500 }, { name: 'reflow-400', width: 360, height: 250 } ]
      .filter(profile => option('profile', 'all') === 'all' || profile.name === option('profile'));
    assert.ok(profiles.length);
    for (const theme of ['light', 'dark']) for (const profile of profiles) {
      const label = `${hostile ? 'hostile' : 'ordinary'}-${theme}-${profile.name}`;
      let work, body = fixtureData.raw(), mode = 'normal', posts = [];
      if (fixture) { work = await fixture.createExecution(); await fixture.completion(work, 'propose_completion', { expiresAt: new Date(Date.now() + 600000).toISOString() }); }
      const executionId = work ? work.execution.id : fixtureData.id(4);
      const context = await browser.newContext({ viewport: { width: profile.width, height: profile.height }, hasTouch: profile.width <= 390, reducedMotion: 'reduce' });
      await context.addInitScript(value => localStorage.setItem('northstar-theme', value), theme);
      await context.addCookies(fixture ? Object.entries(fixture.actors.owner.session.cookies).map(([name, value]) => ({
        name, value, url: origin, sameSite: 'Lax', httpOnly: name !== 'northstar_csrf',
      })) : [{ name: 'northstar_csrf', value: 'local-browser-test-csrf-000000000000000000000000', url: origin }]);
      const page = await context.newPage(); activePage = page;
      if (process.argv.includes('--diagnostic')) {
        await page.addInitScript(() => {
          window.completionDiagnostic = [];
          const capture = (event, action) => {
            const byId = id => document.getElementById(id);
            window.completionDiagnostic.push({ time: performance.now(), event, action: action || null,
              status: byId('completionStatus') && byId('completionStatus').dataset.state,
              formHidden: byId('completionForm') && byId('completionForm').hidden,
              dialogOpen: byId('completionConfirm') && byId('completionConfirm').open,
              focused: document.activeElement && document.activeElement.id });
          };
          document.addEventListener('click', event => capture('click', event.target.dataset.action || event.target.id), true);
          document.addEventListener('DOMContentLoaded', () => {
            const status = byId => document.getElementById(byId);
            if (status('completionStatus')) new MutationObserver(() => capture('status')).observe(status('completionStatus'), { attributes: true, childList: true });
            if (status('completionForm')) new MutationObserver(() => capture('form')).observe(status('completionForm'), { attributes: true, attributeFilter: ['hidden'] });
          });
        });
      }
      page.on('pageerror', error => ledger.pageErrors.push({ label, message: error.message }));
      await page.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        if (url.origin !== origin) { ledger.externalBlocked.push(url.origin); return route.abort(); }
        if (!fixture && url.pathname === '/api/v1/operational-overview') {
          const overview = require('../helpers/m23-part9b-overview-fixture').overview(
            mode === 'dispatcher-overview' ? 'dispatcher_coordination' : 'owner_admin');
          overview.records[0].executionId = executionId;
          return route.fulfill({ status: 200, json: { success: true, data: overview } });
        }
        if (url.pathname.endsWith('/completion-actions')) {
          ledger.mutationCount += 1; posts.push({ key: req.headers()['idempotency-key'], body: req.postDataJSON() });
          if (fixture) return route.continue();
          require('../../src/completion/contract').normalizeCompletionAction({ ...fixtureData.input, executionId, idempotencyKey: posts.at(-1).key, body: posts.at(-1).body });
          if (mode === 'retry-limited') return route.fulfill({ status: 429, json: { success: false, error: { code: 'RATE_LIMITED' } } });
          if (mode === 'uncertain' && posts.length === 1) return route.abort();
          const action = posts.at(-1).body.action;
          const state = { approve_completion: 'completed', reopen_execution: 'reopened', resume_reopened: 'in_progress', cancel_execution: 'cancelled' }[action];
          if (state) { body = fixtureData.raw(state); body.data.execution.revision += posts.length; body.data.records[0].resultingExecutionRevision = body.data.execution.revision; }
          if (mode === 'refresh-failure') mode = 'get-failure';
          return route.fulfill({ status: 200, json: { success: true, data: body.data.execution } });
        }
        if (url.pathname.endsWith('/completion-review') && url.pathname.startsWith('/api/')) {
          if (fixture) return route.continue();
          if (mode === 'restricted') return route.fulfill({ status: 403, json: { success: false } });
          if (mode === 'get-failure') return route.fulfill({ status: 503, json: { success: false } });
          const data = require('../../src/completion/ownerReview').projectOwnerReview(body,
            fixtureData.context(hostile ? { title: '<strong>Literal service label</strong> '.repeat(6) } : {}), fixtureData.input);
          if (mode === 'invalid') data.commands.push({ action: 'delete_history', target: null });
          return route.fulfill({ status: 200, json: { success: true, data } });
        }
        return route.continue();
      });
      const url = `${origin}/dashboard/completion-review?executionId=${executionId}`;
      const overviewNavigation = await page.goto(`${origin}/dashboard/operations`, { waitUntil: 'networkidle' });
      assert.equal(overviewNavigation.status(), 200, 'mounted operational overview exists');
      const reviewLink = page.locator(`[data-execution-id="${executionId}"]`).getByRole('link', { name: /^Review completion for / });
      await reviewLink.waitFor();
      assert.equal(await reviewLink.getAttribute('href'), `/dashboard/completion-review?executionId=${executionId}`);
      assert.ok((await reviewLink.boundingBox()).height >= 44, 'owner destination keeps a usable touch target');
      await reviewLink.focus();
      await Promise.all([page.waitForURL(url), page.keyboard.press('Enter')]);
      await page.locator('[data-action="approve_completion"]').waitFor();
      assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior), 'auto',
        'decision controls must not move through animated document scrolling during a pointer gesture');
      assert.equal(await page.locator('#completionStatus').getAttribute('role'), 'status');
      assert.equal(await page.locator('#completionStatus').getAttribute('aria-live'), 'polite');
      assert.equal(await page.locator('#completionTitle strong').count(), 0, 'dynamic labels stay literal text');
      assert.equal(await page.locator('.completion-header [data-northstar-theme-control]').count(), 1,
        'theme control stays in the header rather than covering recorded work');
      assert.ok(await page.locator('#completionProposalBody ul').evaluate(element =>
        parseFloat(getComputedStyle(element).paddingInlineStart) >= 16), 'proposal list markers stay inside the card');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'no page horizontal overflow');
      await page.locator('#completionRefresh').focus();
      assert.equal(await page.evaluate(() => document.activeElement.id), 'completionRefresh');
      assert.notEqual(await page.locator('#completionRefresh').evaluate(element => getComputedStyle(element).outlineStyle), 'none');
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(output, label + '-proposal.png'), fullPage: true });
      const act = async action => {
        if (process.argv.includes('--diagnostic')) await page.evaluate(value => {
          window.completionDiagnostic.push({ time: performance.now(), event: 'begin-action', action: value,
            status: document.getElementById('completionStatus').dataset.state,
            formHidden: document.getElementById('completionForm').hidden });
        }, action);
        await page.locator(`[data-action="${action}"]`).first().click();
        await page.locator('#completionReason').fill('Reviewed the explicit recorded work');
        if (await page.locator('#completionNextAction').isVisible()) await page.locator('#completionNextAction').fill('Recheck the completed seal');
        if (await page.locator('#completionNote').isVisible()) await page.locator('#completionNote').fill('Clarified the recorded observation');
        await page.locator('#completionPrepare').click();
        await page.locator('#completionConfirm[open]').waitFor();
        const dialogBounds = await page.locator('#completionConfirm').boundingBox();
        assert.ok(dialogBounds.x >= 15 && dialogBounds.y >= 15 &&
          dialogBounds.x + dialogBounds.width <= profile.width - 15 &&
          dialogBounds.y + dialogBounds.height <= profile.height - 15,
        'confirmation stays inset from every viewport edge');
        assert.ok(Math.abs(dialogBounds.x + dialogBounds.width / 2 - profile.width / 2) <= 1 &&
          Math.abs(dialogBounds.y + dialogBounds.height / 2 - profile.height / 2) <= 1,
        'confirmation is centered in both axes');
        assert.match(await page.locator('#completionConfirmDetails').innerText(), /Execution revision/);
        if (action === 'reopen_execution' || action === 'correct_completion') assert.match(await page.locator('#completionConfirmDetails').innerText(), /Recheck the completed seal/);
        if (action === 'correct_completion') assert.match(await page.locator('#completionConfirmDetails').innerText(), /Clarified the recorded observation/);
        assert.equal(await page.evaluate(() => document.activeElement.id), 'completionCancelButton', 'confirmation starts on safe cancel choice');
        if (action === 'approve_completion' && mode === 'normal' && posts.length === 0) {
          await page.screenshot({ path: path.join(output, label + '-confirmation-viewport.png'), fullPage: false });
        }
        if (hostile) await page.locator('#completionConfirmButton').evaluate(button => { button.click(); button.click(); });
        else await page.locator('#completionConfirmButton').click();
      };
      if (hostile) {
        await page.locator('[data-action="approve_completion"]').click();
        await page.locator('#completionReason').fill('<strong>Not a plain decision</strong>');
        await page.locator('#completionPrepare').click();
        assert.equal(await page.locator('#completionConfirm[open]').count(), 0);
        assert.equal(posts.length, 0);
        await page.locator('#completionFormCancel').click();
      }
      await act('approve_completion');
      await page.waitForFunction(() => document.querySelector('#completionLifecycle').dataset.state === 'completed');
      assert.equal(posts.length, 1, 'one explicit decision request');
      await act('reopen_execution'); await page.waitForFunction(() => document.querySelector('#completionLifecycle').dataset.state === 'reopened');
      await act('resume_reopened'); await page.waitForFunction(() => document.querySelector('#completionLifecycle').dataset.state === 'in_progress');
      if (fixture) {
        await act('correct_completion'); await page.waitForFunction(() => document.querySelector('#completionStatus').dataset.state === 'success');
      }
      await act('cancel_execution'); await page.waitForFunction(() => document.querySelector('#completionLifecycle').dataset.state === 'cancelled');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      if (fixture) {
        const record = (await fixture.ownerPool.query('SELECT lifecycle_state FROM canonical_field_executions WHERE organization_id=$1 AND id=$2', [fixture.org, executionId])).rows[0];
        assert.equal(record.lifecycle_state, 'cancelled');
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(output, label + '.png'), fullPage: true });
      ledger.cases.push({ label, actionCount: posts.length, state: 'cancelled', noOverflow: true });
      if (!fixture) {
        body = fixtureData.raw(); mode = 'refresh-failure'; posts = [];
        await page.reload({ waitUntil: 'networkidle' }); await act('approve_completion');
        await page.waitForFunction(() => document.querySelector('#completionStatus').dataset.state === 'applied-refresh-failed');
        assert.equal(await page.locator('#completionRetry').isVisible(), false);
        assert.equal(posts.length, 1);
        mode = 'normal'; await page.locator('#completionRefresh').click();
        await page.waitForFunction(() => document.querySelector('#completionLifecycle').dataset.state === 'completed');
        body = fixtureData.raw(); mode = 'uncertain'; posts = [];
        await page.reload({ waitUntil: 'networkidle' }); await act('approve_completion');
        await page.waitForFunction(() => document.querySelector('#completionStatus').dataset.state === 'uncertain');
        mode = 'retry-limited';
        await page.locator('#completionRetry').click();
        await page.waitForFunction(() => document.querySelector('#completionStatus').dataset.state === 'uncertain' && !document.querySelector('#completionRetry').disabled);
        assert.equal(posts.length, 2, 'a rate-limited retry does not falsely resolve the original uncertain decision');
        assert.equal(await page.locator('[data-action]:not(:disabled)').count(), 0);
        mode = 'uncertain';
        await page.locator('#completionRetry').click();
        await page.waitForFunction(() => document.querySelector('#completionLifecycle').dataset.state === 'completed');
        assert.equal(posts.length, 3); assert.deepEqual(posts[0], posts[1], 'uncertain retry preserves exact idempotency key/body');
        assert.deepEqual(posts[1], posts[2]);
        mode = 'restricted'; await page.reload({ waitUntil: 'networkidle' });
        await page.waitForFunction(() => document.querySelector('#completionStatus').dataset.state === 'restricted');
        assert.equal(await page.locator('[data-action]').count(), 0);
        assert.equal(await page.locator('#completionTitle').innerText(), 'Completion review');
        assert.equal(await page.locator('#completionHistorySummary').innerText(), '');
        assert.equal(await page.locator('#completionConfirmReason').innerText(), '');
        assert.equal(await page.locator('#completionConfirmDetails').innerText(), '');
        mode = 'invalid'; await page.reload({ waitUntil: 'networkidle' });
        await page.waitForFunction(() => document.querySelector('#completionStatus').dataset.state === 'unavailable');
        assert.equal(await page.locator('[data-action]').count(), 0);
        mode = 'normal'; body = fixtureData.raw();
        await page.goto(`${origin}/dashboard/completion-review?executionId=invalid`, { waitUntil: 'networkidle' });
        await page.waitForFunction(() => document.querySelector('#completionStatus').dataset.state === 'restricted');
        await page.goBack({ waitUntil: 'networkidle' });
        await page.locator('[data-action="approve_completion"]').waitFor();
        mode = 'dispatcher-overview';
        await page.goto(`${origin}/dashboard/operations`, { waitUntil: 'networkidle' });
        await page.locator('[data-execution-id]').waitFor();
        assert.equal(await page.getByRole('link', { name: /^Review completion for / }).count(), 0,
          'dispatcher coordination does not expose an owner decision destination');
        ledger.cases.push({ label: label + '-failure-controls', appliedRefreshFailure: true, exactRetry: true,
          revoked: true, ownerKeyboardLink: true, dispatcherOwnerLinkAbsent: true });
      }
      if (process.argv.includes('--diagnostic')) {
        if (!ledger.diagnostics) ledger.diagnostics = [];
        ledger.diagnostics.push({ label, events: await page.evaluate(() => window.completionDiagnostic || []) });
      }
      await context.close();
      process.stdout.write(JSON.stringify({ completed: label, durable, hostile }) + '\n');
    }
    assert.deepEqual(ledger.pageErrors, []); assert.deepEqual(ledger.externalBlocked, []); assert.equal(ledger.serverExternalAttempts, 0);
    ledger.passed = true;
  } catch (error) {
    ledger.passed = false; ledger.error = { name: error.name, message: error.message };
    if (activePage && !activePage.isClosed()) {
      ledger.failureState = await activePage.evaluate(() => ({ events: window.completionDiagnostic || [],
        status: document.getElementById('completionStatus') && document.getElementById('completionStatus').dataset.state,
        statusText: document.getElementById('completionStatus') && document.getElementById('completionStatus').textContent,
        formHidden: document.getElementById('completionForm') && document.getElementById('completionForm').hidden,
        buttons: Array.from(document.querySelectorAll('[data-action]')).map(button => ({ action: button.dataset.action, disabled: button.disabled })) }));
      await activePage.screenshot({ path: path.join(output, 'failure-viewport.png') });
    }
    throw error;
  }
  finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    if (fixture) await fixture.cleanup();
    https.request = oldRequest; https.get = oldGet; globalThis.fetch = oldFetch;
    fs.writeFileSync(path.join(output, 'RESULT.json'), JSON.stringify(ledger, null, 2) + '\n', { flag: 'wx' });
    process.stdout.write(JSON.stringify({ browser: selected, hostile, durable, passed: ledger.passed, cases: ledger.cases.length, output }) + '\n');
  }
}
main().catch(error => { process.stderr.write(`${error.name}: ${error.message}\n`); process.exitCode = 1; });
