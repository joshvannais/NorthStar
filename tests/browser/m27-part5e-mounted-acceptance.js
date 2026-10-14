'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
process.chdir(path.resolve(__dirname, '../..'));
process.env.NODE_ENV = 'test';
process.env.AUTH_ACCESS_SECRET = 'm27-part5e-mounted-browser-disposable-only';
for (const key of ['DATABASE_URL','MIGRATION_DATABASE_URL','OPENAI_API_KEY','POLARIS_OPENAI_ENABLED',
  'RETELL_API_KEY','STRIPE_SECRET_KEY','TWILIO_AUTH_TOKEN','RESEND_API_KEY','SMTP_HOST','SMTP_USER','SMTP_PASS']) {
  delete process.env[key];
}

const { createPart4ePaidBrowserFixture } = require('../helpers/m27-part4e-paid-journey-fixture');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');
const { MISSION_26_FIVE_LAYOUTS } = require('../helpers/m26-part12d-rendered-review');

function argument(name) {
  const value = process.argv.find(item => item.startsWith(`--${name}=`));
  assert.ok(value, `Missing --${name}`); return value.slice(name.length + 3);
}
const engine = argument('browser');
const output = path.resolve(argument('output'));
assert.ok(['chrome','webkit'].includes(engine));
assert.ok(!fs.existsSync(output), 'Supply a new output directory');
fs.mkdirSync(output, { recursive: true });

async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve); server.once('error', reject);
  });
  return server;
}

async function openActualCustomerInvoice(page, customer) {
  const quickStart = page.locator('#northstarQuickStartDialog[open]');
  if (await quickStart.count()) await quickStart.getByRole('button', { name: 'Close quick start', exact: true }).click();
  await page.waitForFunction(() => window.CustomerDetail &&
    typeof window.CustomerDetail.open === 'function', null, { timeout: 30000 });
  await page.evaluate(customerId => window.CustomerDetail.open(customerId), customer);
  await page.locator('#cdCustomerDrawer:not([hidden])').waitFor({ timeout: 30000 });
  const summary = page.locator('#cdEstimateHub > .invoice-draft-preview > summary');
  await summary.waitFor({ timeout: 60000 });
  await summary.focus(); await page.keyboard.press('Enter');
  await page.locator('#cdEstimateHub .invoice-draft-preview-heading').waitFor({ timeout: 30000 });
  return page.locator('#cdEstimateHub > .invoice-draft-preview');
}

async function assertTaxEvidence(root) {
  await root.getByText('Exact tax preparation evidence to review', { exact: true }).waitFor({ timeout: 30000 });
  assert.equal(await root.getByText('Prepared line tax evidence', { exact: true }).count(), 1);
  assert.equal(await root.getByText(/Mission 24 line .+ · tax group .+ · invoice source digest [a-f0-9]{64}/).count(), 1);
  const rows = root.locator('.invoice-draft-tax-evidence tbody tr');
  assert.ok(await rows.count() >= 1); assert.ok(await rows.count() <= 24);
  for (const label of ['Taxable basis','Prepared tax','Registration evidence','Nexus evidence',
    'Exemption snapshot','Rounding identity','Separated collected-tax liability',
    'Credit/refund lineage','Professional tax policy']) {
    assert.ok(await root.getByText(label, { exact: true }).count() >= 1, `missing ${label}`);
  }
  assert.ok(await root.getByText(/tax_liability_separate_from_commercial_subtotal/).count() >= 1);
  assert.ok(await root.getByText(/professional_tax_policy_unavailable|tax_authority_unavailable/).count() >= 1);
  assert.ok(await root.getByText(/credit_refund_lineage_unavailable/).count() >= 1);
  assert.ok(await root.getByText(/mission24\.canonical_commercial_numeric_round\.v1/).count() >= 1);
  assert.ok(await root.getByText(/owner_recorded|validated/).count() >= 1);
}

async function saveDraft(root, marker) {
  await root.getByRole('button', { name: 'Save reviewed invoice draft' }).waitFor({ timeout: 30000 });
  const descriptions = root.getByLabel('Customer description');
  assert.ok(await descriptions.count() >= 1);
  await descriptions.first().fill(marker);
  const form = root.locator('.invoice-draft-workflow-form');
  const confirm = form.getByRole('checkbox'); await confirm.focus(); await confirm.press('Space');
  const save = form.getByRole('button', { name: 'Save reviewed invoice draft' });
  await save.focus(); await save.press('Enter');
}

async function correctDraftThroughRealSession(page, estimate, marker) {
  return page.evaluate(async input => {
    async function json(url, options) {
      const response = await window.NorthStarAccountSession.fetch(url, options || { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(`mounted correction failed ${response.status}`);
      return body.data;
    }
    const base = `/api/v1/customer-financial/editable-estimates/${encodeURIComponent(input.estimate)}`;
    const billable = await json(base + '/billable-work-review?sourceClass=final_balance');
    const receipt = billable.handoffReceipt;
    const capability = await json(base + '/invoice-draft/workflow-capability', {
      method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json',
        'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ confirmed: true,
        confirmationVersion: 'm27-invoice-draft-workflow-capability-v1' }) });
    const query = `?handoffReceiptId=${encodeURIComponent(receipt.receiptId)}` +
      `&handoffReceiptDigest=${encodeURIComponent(receipt.receiptDigest)}`;
    const draft = await json(base + '/invoice-draft' + query);
    const edit = { contractVersion: 'm27-invoice-draft-edit-v1', originId: draft.originId,
      originDigest: draft.originDigest, lines: draft.lines.map((line, ordinal) => ({
        ordinal, sourceLineDigest: line.sourceLineDigest, group: line.group,
        description: ordinal === 0 ? input.marker : line.description,
        allocatedMinorUnits: line.allocatedAmount.minorUnits })) };
    return json(base + '/invoice-draft', { method: 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ handoffReceiptId: receipt.receiptId,
        handoffReceiptDigest: receipt.receiptDigest, capabilityGrantId: capability.grantId,
        capabilityGrantRevision: Number(capability.revision), businessPurpose: capability.businessPurpose,
        policyVersion: capability.policyVersion, expectedRevision: Number(draft.revision),
        expectedDraftDigest: draft.draftDigest, draft: edit,
        reason: 'Concurrent mounted browser correction proves exact currentness clearing.',
        confirmed: true, confirmationVersion: 'm27-invoice-draft-revision-save-v1' }) });
  }, { estimate, marker });
}

async function recordTax(root) {
  await assertTaxEvidence(root);
  const form = root.locator('.invoice-draft-workflow-form');
  const confirm = form.getByRole('checkbox'); await confirm.focus(); await confirm.press('Space');
  const record = form.getByRole('button', { name: 'Record tax preparation review' });
  await record.focus(); await record.press('Enter');
}

async function auditActualSurface(page, root, layout) {
  const audit = await page.evaluate(({ width }) => {
    const visible = element => {
      const style = getComputedStyle(element), rect = element.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const surface = document.querySelector('#cdCustomerDrawer');
    const unnamed = Array.from(surface.querySelectorAll('button,input,textarea,summary'))
      .filter(visible).filter(element => element.tagName !== 'SUMMARY' &&
        !element.getAttribute('aria-label') && !element.textContent.trim() &&
        !(element.labels && element.labels.length)).map(element => element.outerHTML.slice(0,120));
    return { unnamed, overflow: document.documentElement.scrollWidth - width,
      duplicateIds: Array.from(document.querySelectorAll('[id]')).map(node => node.id)
        .filter((id,index,array) => array.indexOf(id) !== index),
      drawerVisible: visible(surface), privatePricesVisible: surface.textContent.includes('$') };
  }, { width: layout.width });
  assert.deepEqual(audit.unnamed, []); assert.ok(audit.overflow <= 1);
  assert.deepEqual(Array.from(new Set(audit.duplicateIds)), []);
  assert.equal(audit.drawerVisible, true); assert.equal(audit.privatePricesVisible, true);
  assert.equal(await root.getByRole('button', { name: /issue|send|collect|approve invoice/i }).count(), 0);
}

(async () => {
  let prepared; let server; let browser; let activePage;
  const ledger = { engine, layouts: [], actualPage: '/dashboard', mockedResponses: 0,
    providerCalls: 0, receiverMutations: 0, liveMoneyEvidence: 'not-run-deferred-first-paying-customer' };
  try {
    prepared = await createPart4ePaidBrowserFixture();
    server = await listen(prepared.fixture.app);
    const origin = `http://127.0.0.1:${server.address().port}`;
    const runtime = resolveBrowserRuntime(engine);
    browser = await runtime.browserType.launch({ headless: true, executablePath: runtime.executablePath });
    for (let index = 0; index < MISSION_26_FIVE_LAYOUTS.length; index += 1) {
      const layout = MISSION_26_FIVE_LAYOUTS[index];
      const context = await browser.newContext({ viewport: { width: layout.width, height: layout.height },
        colorScheme: layout.colorScheme, reducedMotion: 'reduce' });
      await context.addInitScript(theme => localStorage.setItem('northstar-theme', theme), layout.colorScheme);
      await context.addCookies(Object.entries(prepared.actor.session.cookies).map(([name,value]) => ({
        name, value, url: origin, sameSite: 'Lax', httpOnly: name !== 'northstar_csrf' })));
      const page = await context.newPage(); activePage = page; const errors = []; const external = [];
      const routeEvidence = []; const bundleEvidence = []; const failedResponses = []; const consoleErrors = [];
      ledger.current = { name: layout.name, errors, failedResponses, consoleErrors };
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
      page.on('request', request => {
        const url = new URL(request.url());
        if (url.origin !== origin && !['data:','blob:'].includes(url.protocol)) external.push(request.url());
        if (url.pathname.includes('/invoice-draft') || url.pathname.includes('/invoice-part5') ||
            url.pathname.includes('/invoice-part6') ||
            url.pathname.includes('/billable-work-review')) {
          routeEvidence.push({ method: request.method(), path: url.pathname + url.search });
        }
      });
      page.on('response', response => {
        const url = new URL(response.url());
        if (url.origin === origin && response.status() >= 400) {
          failedResponses.push({ method: response.request().method(), path: url.pathname + url.search,
            status: response.status() });
        }
        if (url.pathname.includes('/invoice-draft') || url.pathname.includes('/invoice-part5') ||
            url.pathname.includes('/invoice-part6') ||
            url.pathname.includes('/billable-work-review')) {
          const row = [...routeEvidence].reverse().find(value => value.path === url.pathname + url.search &&
            value.status === undefined); if (row) row.status = response.status();
          if (url.pathname.includes('/invoice-part6-acceptance') && response.status() === 200) {
            response.json().then(body => bundleEvidence.push(body.data)).catch(error =>
              consoleErrors.push(error.message));
          }
        }
      });
      await page.goto(origin + '/dashboard', { waitUntil: 'networkidle' });
      const root = await openActualCustomerInvoice(page, prepared.customer);
      if (await root.getByRole('button', { name: 'Capture reviewed invoice source' }).count()) {
        const form = root.locator('.invoice-draft-workflow-form');
        await form.getByRole('checkbox').focus(); await form.getByRole('checkbox').press('Space');
        await form.getByRole('button', { name: 'Capture reviewed invoice source' }).focus();
        await form.getByRole('button', { name: 'Capture reviewed invoice source' }).press('Enter');
      } else {
        await root.getByText('Invoice draft — not issued', { exact: true }).waitFor({ timeout: 30000 });
        await root.getByRole('button', { name: 'Edit current invoice draft' }).focus();
        await root.getByRole('button', { name: 'Edit current invoice draft' }).press('Enter');
      }
      await saveDraft(root, `Mounted ${engine} ${layout.name} reviewed line`);
      await root.getByRole('button', { name: 'Record tax preparation review' }).waitFor({ timeout: 30000 });
      await assertTaxEvidence(root);
      if (index === 0) {
        await correctDraftThroughRealSession(page, prepared.estimate,
          `Concurrent ${engine} exact-current line`);
        await recordTax(root);
        await root.locator('[role=alert]').waitFor({ timeout: 30000 });
        assert.equal(await root.locator('.invoice-draft-tax-evidence').count(), 0);
        assert.equal(await root.locator('table').count(), 0);
        assert.equal(await root.getByRole('button', { name: 'Record tax preparation review' }).count(), 0);
        await root.getByRole('button', { name: 'Retry invoice preview' }).focus();
        await root.getByRole('button', { name: 'Retry invoice preview' }).press('Enter');
        await root.getByRole('button', { name: 'Record tax preparation review' }).waitFor({ timeout: 30000 });
      }
      await recordTax(root);
      await root.getByText('Invoice draft — not issued', { exact: true }).waitFor({ timeout: 30000 });
      await root.getByText('Approval, issue, and invoice lifecycle', { exact: true }).waitFor({ timeout: 30000 });
      assert.equal(await root.locator('.invoice-part5-axes li').count(), 7);
      assert.equal(await root.locator('.invoice-part5-corrections li').count(), 4);
      await root.getByText('Customer document, portal, and delivery', { exact: true }).waitFor({ timeout: 30000 });
      assert.equal(await root.locator('.invoice-part6-actions li').count(), 6);
      assert.equal(await root.getByRole('button', { name: /approve invoice|issue|send|resend|revoke|deliver|collect|correct invoice/i }).count(), 0);
      assert.ok(await root.getByText(`Mounted ${engine} ${layout.name} reviewed line`, { exact: true }).count() ||
        await root.getByText(`Concurrent ${engine} exact-current line`, { exact: true }).count());
      const summary = root.locator(':scope > summary'); await summary.focus(); await summary.press('Enter');
      await root.locator('table').waitFor({ state: 'detached', timeout: 10000 });
      assert.equal(await root.getByText('Invoice draft — not issued', { exact: true }).count(), 0);
      assert.equal(await root.getByText(/\$/, { exact: false }).count(), 0);
      await correctDraftThroughRealSession(page, prepared.estimate,
        `Reopen ${engine} ${layout.name} exact-current line`);
      await summary.focus(); await summary.press('Enter');
      await root.getByRole('button', { name: 'Record tax preparation review' }).waitFor({ timeout: 30000 });
      assert.equal(await root.locator('.invoice-draft-preview-document').count(), 0);
      assert.equal(await root.locator('.invoice-part5-acceptance').count(), 0);
      assert.equal(await root.locator('.invoice-part6-acceptance').count(), 0);
      assert.equal(await root.getByText(/Mounted .* reviewed line/, { exact: false }).count(), 0);
      await recordTax(root);
      await root.getByText('Invoice draft — not issued', { exact: true }).waitFor({ timeout: 30000 });
      await root.getByText(`Reopen ${engine} ${layout.name} exact-current line`, { exact: true })
        .waitFor({ timeout: 30000 });
      if (index === 0) {
        await page.evaluate(() => {
          const realFetch = window.fetch.bind(window);
          let armed = true;
          window.m27Part6dDelayedResponseReady = false;
          window.m27Part6dResolveDelayedResponse = null;
          window.m27Part6dRestoreFetch = () => { window.fetch = realFetch; };
          window.fetch = async function delayedRealPart6Response(url, options) {
            const response = await realFetch(url, options);
            if (armed && String(url).includes('/invoice-part6-acceptance?')) {
              armed = false;
              window.m27Part6dDelayedResponseReady = true;
              await new Promise(resolve => { window.m27Part6dResolveDelayedResponse = resolve; });
            }
            return response;
          };
        });
        await root.getByRole('button', { name: 'Reload current preview' }).click();
        await page.waitForFunction(() => window.m27Part6dDelayedResponseReady === true &&
          typeof window.m27Part6dResolveDelayedResponse === 'function', null, { timeout: 30000 });
        await summary.focus(); await summary.press('Enter');
        await summary.focus(); await summary.press('Enter');
        await root.getByText(`Reopen ${engine} ${layout.name} exact-current line`, { exact: true })
          .waitFor({ timeout: 30000 });
        await page.evaluate(async () => {
          window.m27Part6dResolveDelayedResponse();
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          window.m27Part6dRestoreFetch();
        });
        assert.equal(await root.getByText(`Reopen ${engine} ${layout.name} exact-current line`,
          { exact: true }).count(), 1);
        assert.equal(await root.locator('.invoice-part6-acceptance').count(), 1);
      }
      await auditActualSurface(page, root, layout);
      assert.ok(routeEvidence.some(row => row.method === 'POST' && row.path.endsWith('/invoice-draft/workflow-capability') && row.status === 200));
      assert.ok(routeEvidence.some(row => row.method === 'POST' && /\/invoice-draft$/.test(row.path) && [200,201].includes(row.status)));
      assert.ok(routeEvidence.some(row => row.method === 'POST' && row.path.endsWith('/invoice-draft/tax-review') && [200,201,409].includes(row.status)));
      assert.ok(routeEvidence.some(row => row.method === 'GET' && row.path.includes('/invoice-part6-acceptance?') && row.status === 200));
      assert.equal(routeEvidence.some(row => row.method === 'GET' && row.path.includes('/invoice-draft/preview?')), false);
      assert.ok(bundleEvidence.length >= 1);
      for (const bundle of bundleEvidence) {
        assert.equal(bundle.contractVersion, 'm27-invoice-part6-preview-bundle-v1');
        assert.equal(bundle.preview.draftIdentity.revision,
          bundle.part5Acceptance.previewWitness.draftRevision);
        assert.equal(bundle.preview.draftIdentity.draftDigest,
          bundle.part5Acceptance.previewWitness.draftDigest);
        assert.equal(bundle.preview.previewDigest,
          bundle.part5Acceptance.previewWitness.previewDigest);
        assert.deepEqual(bundle.part6Acceptance.previewWitness,
          bundle.part5Acceptance.previewWitness);
        assert.equal(bundle.part6Acceptance.delivery.actions.length, 6);
        assert.equal(bundle.part6Acceptance.outboundMessageCount, 0);
      }
      if (index === 0) assert.ok(routeEvidence.some(row => row.method === 'POST' && row.path.endsWith('/invoice-draft-origin') && [200,201].includes(row.status)));
      assert.deepEqual(external, []); assert.deepEqual(errors, []);
      await page.screenshot({ fullPage: true, path: path.join(output, `${engine}-${layout.name}.png`) });
      ledger.layouts.push({ name: layout.name, routeEvidence, taxEvidence: true,
        part5Acceptance: true, part6Acceptance: true, keyboard: true, responsive: true,
        currentnessRecovery: index === 0, delayedResponseSuppression: index === 0 });
      delete ledger.current;
      await context.close();

      const demoContext = await browser.newContext({ viewport: { width: layout.width, height: layout.height },
        colorScheme: layout.colorScheme, reducedMotion: 'reduce' });
      await demoContext.addInitScript(theme => localStorage.setItem('northstar-theme', theme), layout.colorScheme);
      const demoPage = await demoContext.newPage(); activePage = demoPage;
      const demoErrors = [], demoExternal = [], demoRoutes = [], demoPaidRoutes = [];
      demoPage.on('pageerror', error => demoErrors.push(error.message));
      demoPage.on('request', request => {
        const url = new URL(request.url());
        if (url.origin !== origin && !['data:','blob:'].includes(url.protocol)) demoExternal.push(request.url());
        if (url.pathname.includes('/api/demo/customer-financial/invoice-drafts/')) {
          demoRoutes.push({method:request.method(),path:url.pathname});
        }
        if (url.pathname.startsWith('/api/v1/customer-financial/')) {
          demoPaidRoutes.push({method:request.method(),path:url.pathname});
        }
      });
      demoPage.on('response', response => {
        const pathName = new URL(response.url()).pathname;
        const row = [...demoRoutes].reverse().find(value => value.path === pathName && value.status === undefined);
        if (row) row.status = response.status();
      });
      await demoPage.goto(origin + '/demo', { waitUntil: 'networkidle' });
      const graph = await demoPage.evaluate(async () => {
        const response = await fetch('/api/demo/command-center', {cache:'no-store'});
        const body = await response.json(); return body.data.graphs[0];
      });
      const demoRoot = await openActualCustomerInvoice(demoPage, graph.ids.customer);
      await demoRoot.getByText('Fictional invoice draft — not issued', { exact: true }).waitFor({ timeout:30000 });
      await demoRoot.getByText('Approval, issue, and invoice lifecycle', { exact: true }).waitFor({ timeout:30000 });
      assert.equal(await demoRoot.locator('.invoice-part5-axes li').count(), 7);
      assert.equal(await demoRoot.locator('.invoice-part5-corrections li').count(), 4);
      await demoRoot.getByText('Customer document, portal, and delivery', { exact:true }).waitFor({timeout:30000});
      assert.equal(await demoRoot.locator('.invoice-part6-actions li').count(),6);
      assert.equal(await demoRoot.getByText(/Fictional demo boundary/).count(), 2);
      assert.equal(await demoRoot.getByRole('button', {name:/approve invoice|issue|send|resend|revoke|deliver|collect|correct invoice/i}).count(),0);
      assert.equal(demoRoutes.some(row => row.path.endsWith('/preview')), false);
      assert.ok(demoRoutes.some(row => row.path.endsWith('/part6-acceptance') && row.status === 200));
      const oldSummary = demoRoot.locator(':scope > summary'); await oldSummary.focus(); await oldSummary.press('Enter');
      await demoRoot.locator('table').waitFor({state:'detached',timeout:10000});
      const resetGraph = await demoPage.evaluate(async () => {
        const currentResponse=await fetch('/api/demo/command-center',{cache:'no-store'});
        const current=(await currentResponse.json()).data;
        const response=await fetch('/api/demo/command-center/reset',{method:'POST',cache:'no-store',
          headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID(),
            'X-NorthStar-Demo-Intent':'reset'},
          body:JSON.stringify({expectedRevision:current.integrity.revision})});
        const body=await response.json(); if(!response.ok||!body.success)throw new Error('demo reset failed');
        return body.data.graphs[0];
      });
      await oldSummary.focus(); await oldSummary.press('Enter');
      await demoRoot.locator('[role=alert]').waitFor({timeout:30000});
      assert.equal(await demoRoot.locator('table').count(),0);
      assert.equal(await demoRoot.locator('.invoice-part5-acceptance').count(),0);
      assert.equal(await demoRoot.locator('.invoice-part6-acceptance').count(),0);
      await demoPage.reload({waitUntil:'networkidle'});
      const recoveredDemoRoot=await openActualCustomerInvoice(demoPage,resetGraph.ids.customer);
      await recoveredDemoRoot.getByText('Fictional invoice draft — not issued',{exact:true})
        .waitFor({timeout:30000});
      await recoveredDemoRoot.getByText('Approval, issue, and invoice lifecycle',{exact:true})
        .waitFor({timeout:30000});
      assert.deepEqual(demoExternal, []); assert.deepEqual(demoErrors, []);
      assert.deepEqual(demoPaidRoutes, []);
      await demoPage.screenshot({fullPage:true,path:path.join(output,`${engine}-${layout.name}-demo.png`)});
      ledger.layouts.at(-1).demo = { actualPage:'/demo', routes:demoRoutes, fictional:true,
        resetClearing:true, paidRouteCalls:demoPaidRoutes.length };
      await demoContext.close();
    }
    assert.equal(ledger.layouts.length, 5);
  } catch (error) {
    ledger.failure = error.stack; process.exitCode = 1;
    if (activePage && !activePage.isClosed()) {
      await activePage.screenshot({ fullPage: true, path: path.join(output, 'failure.png') }).catch(() => {});
    }
  } finally {
    fs.writeFileSync(path.join(output, 'ledger.json'), JSON.stringify(ledger, null, 2));
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    if (prepared) await prepared.fixture.cleanup();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
