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

const { provisionDurableSession } = require('../helpers/account-session-fixture');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');
const { MISSION_26_FIVE_LAYOUTS } = require('../helpers/m26-part12d-rendered-review');
const paidPart11Repository = require('../../src/customerFinancial/accountingPart11AcceptanceRepository');
const demoPart11 = require('../../src/customerFinancial/demoAccountingPart11Acceptance');
const realPaidPart11Read = paidPart11Repository.readBundle;
const realDemoPart11Bundle = demoPart11.bundle;
let part11DigestFault = null;
function corruptPart11Digest(value, kind) {
  const changed=JSON.parse(JSON.stringify(value));
  if (kind === 'part10') changed.part11Acceptance.part10Witness.digest='f'.repeat(64);
  else changed.part11Acceptance.sourceParts[0].digest='e'.repeat(64);
  return changed;
}
paidPart11Repository.readBundle = async function () {
  const value=await realPaidPart11Read.apply(this,arguments);
  if (!part11DigestFault || part11DigestFault.mode !== 'paid') return value;
  const fault=part11DigestFault; part11DigestFault=null;
  return corruptPart11Digest(value,fault.kind);
};
demoPart11.bundle = function () {
  const value=realDemoPart11Bundle.apply(this,arguments);
  if (!part11DigestFault || part11DigestFault.mode !== 'demo') return value;
  const fault=part11DigestFault; part11DigestFault=null;
  return corruptPart11Digest(value,fault.kind);
};
const { createPart4ePaidBrowserFixture } = require('../helpers/m27-part4e-paid-journey-fixture');

function argument(name) {
  const value = process.argv.find(item => item.startsWith(`--${name}=`));
  assert.ok(value, `Missing --${name}`); return value.slice(name.length + 3);
}
const engine = argument('browser');
const output = path.resolve(argument('output'));
const requestedLayout = process.argv.find(item => item.startsWith('--layout='));
const selectedLayouts = requestedLayout ? MISSION_26_FIVE_LAYOUTS.filter(layout =>
  layout.name === requestedLayout.slice('--layout='.length)) : MISSION_26_FIVE_LAYOUTS;
assert.ok(['chrome','webkit'].includes(engine));
assert.ok(selectedLayouts.length > 0, 'Unknown --layout');
assert.ok(!fs.existsSync(output), 'Supply a new output directory');
fs.mkdirSync(output, { recursive: true });
const PART6_REQUIREMENTS = [
  'exact_current_issued_document',
  'reviewed_recipient_and_delivery_choice',
  'customer_financial_invoice_send_capability',
  'recent_auth_and_required_control',
  'exact_delivery_idempotency',
  'delivery_evidence_receipt',
  'scoped_customer_access_revocation',
  'mission28_broader_communication_adapter',
];
const PART7_REQUIREMENTS = [
  'exact_current_launch_policy',
  'tenant_bound_test_provider_connection',
  'current_provider_capability_grant',
  'recent_authentication_and_mfa',
  'compatible_adapter_schema',
  'provider_sandbox_journey_evidence',
  'exact_current_issued_balance',
  'current_scoped_customer_session',
  'exact_payment_idempotency_receipt',
  'server_owned_rollout_flag',
];
const PART9_SOURCES = ['9A','9B','9C','9D','9E'];
const PART10_SOURCES = ['10A','10B','10C'];
const PART11_SOURCES = ['11A','11B','11C'];

async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve); server.once('error', reject);
  });
  return server;
}

async function waitForDatabaseBlockedQuery(pool, relation, blockerPid) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const result = await pool.query(
      `SELECT count(*)::int AS count
         FROM pg_catalog.pg_locks waiting
         JOIN pg_catalog.pg_locks held
           ON held.locktype = waiting.locktype
          AND held.database IS NOT DISTINCT FROM waiting.database
          AND held.relation IS NOT DISTINCT FROM waiting.relation
        WHERE waiting.pid <> $2::int
          AND waiting.relation = pg_catalog.to_regclass($1)
          AND waiting.granted = false
          AND held.pid = $2::int
          AND held.granted = true`, [relation, blockerPid]);
    if (Number(result.rows[0]?.count) > 0) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('Mounted request did not reach the exact database locker');
}

async function proveDatabaseDelayedSuppression(options) {
  const allowedRelations = new Set([
    'public.canonical_customer_financial_invoice_draft_revisions_v1',
    'public.demo_command_center_sessions',
  ]);
  assert.ok(allowedRelations.has(options.relation));
  const client = await options.pool.connect(); let open = false; let released = false;
  try {
    await client.query('BEGIN'); open = true;
    const blocker = await client.query('SELECT pg_backend_pid()::int AS pid');
    await client.query(`LOCK TABLE ${options.relation} IN ACCESS EXCLUSIVE MODE`);
    const started = options.page.waitForRequest(request =>
      new URL(request.url()).pathname.endsWith(options.routePath), { timeout: 30000 });
    const completed = options.page.waitForResponse(response =>
      new URL(response.url()).pathname.endsWith(options.routePath), { timeout: 30000 })
      .then(response => ({ response }), error => ({ error }));
    const reload = options.root.getByRole('button', { name: 'Reload current preview' });
    await reload.focus(); await reload.press('Enter');
    await started;
    await waitForDatabaseBlockedQuery(options.pool, options.relation, blocker.rows[0].pid);
    await options.summary.focus(); await options.summary.press('Enter');
    await options.root.locator('table').waitFor({ state: 'detached', timeout: 10000 });
    assert.equal(await options.root.locator('.invoice-part5-acceptance').count(), 0);
    assert.equal(await options.root.locator('.invoice-part6-acceptance').count(), 0);
    assert.equal(await options.root.locator('.invoice-part7-acceptance').count(), 0);
    assert.equal(await options.root.locator('.invoice-part9-acceptance').count(), 0);
    assert.equal(await options.root.locator('.invoice-part10-acceptance').count(), 0);
    assert.equal(await options.root.locator('.invoice-part11-acceptance').count(), 0);
    assert.equal(await options.root.getByText(/\$/, { exact: false }).count(), 0);
    await client.query('COMMIT'); open = false; client.release(); released = true;
    const completion = await completed;
    if (completion.error) throw completion.error;
    assert.equal(completion.response.status(), 200);
    await options.page.waitForTimeout(100);
    assert.equal(await options.root.locator('table').count(), 0);
    assert.equal(await options.root.locator('.invoice-part6-acceptance').count(), 0);
    assert.equal(await options.root.locator('.invoice-part7-acceptance').count(), 0);
    assert.equal(await options.root.locator('.invoice-part9-acceptance').count(), 0);
    assert.equal(await options.root.locator('.invoice-part10-acceptance').count(), 0);
    assert.equal(await options.root.locator('.invoice-part11-acceptance').count(), 0);
    let reopenedRequests=0;
    const countReopenedRequest=request=>{
      if(new URL(request.url()).pathname.endsWith(options.routePath))reopenedRequests+=1;
    };
    options.page.on('request',countReopenedRequest);
    try {
      await options.summary.focus(); await options.summary.press('Enter');
      assert.equal(await options.root.evaluate(node=>node.open),true);
      await options.root.getByText(options.expectedText, { exact: true }).waitFor({ timeout: 240000 });
      await options.page.waitForTimeout(100);
    } finally { options.page.off('request',countReopenedRequest); }
    assert.equal(reopenedRequests,1);
    assert.equal(await options.root.locator('.invoice-part6-requirements li').count(), 8);
    assert.equal(await options.root.locator('.invoice-part7-requirements li').count(), 10);
    assert.equal(await options.root.locator('.invoice-part9-sources li').count(), 5);
    assert.equal(await options.root.locator('.invoice-part10-sources li').count(), 3);
    assert.equal(await options.root.locator('.invoice-part11-sources li').count(), 3);
  } finally {
    if (open) await client.query('ROLLBACK').catch(() => {});
    if (!released) client.release();
  }
}

async function openActualCustomerInvoice(page, customer) {
  const quickStart = page.locator('#northstarQuickStartDialog[open]');
  if (await quickStart.count()) await quickStart.getByRole('button', { name: 'Close quick start', exact: true }).click();
  await page.waitForFunction(() => window.CustomerDetail &&
    typeof window.CustomerDetail.open === 'function', null, { timeout: 30000 });
  await page.evaluate(customerId => window.CustomerDetail.open(customerId), customer);
  await page.locator('#cdCustomerDrawer:not([hidden])').waitFor({ timeout: 30000 });
  await page.locator('#cdCustomerDrawer[aria-busy="false"]').waitFor({ timeout: 60000 });
  await page.waitForFunction(() => document.getElementById('cdEstimateReview')?.getAttribute('aria-busy') === 'false',
    null, { timeout: 60000 });
  const summary = page.locator('#cdEstimateHub > .invoice-draft-preview > summary');
  await summary.waitFor({ timeout: 60000 });
  // Customer-detail and demo-workspace renders can replace the disclosure once
  // after their independent busy flags clear. Exercise the mounted disclosure
  // only after one concrete visible summary survives a render quiescence.
  let settled = false;
  for (let attempt = 0; attempt < 10 && !settled; attempt += 1) {
    const candidate = await summary.elementHandle();
    await page.waitForTimeout(250);
    settled = !!candidate && await candidate.evaluate(node => node.isConnected);
    await candidate?.dispose();
  }
  assert.equal(settled, true, 'Invoice disclosure did not settle after mounted rendering');
  await summary.focus(); await summary.press('Enter');
  await page.locator('#cdEstimateHub .invoice-draft-preview-heading').waitFor({ timeout: 240000 });
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

async function assertPart7ClientContract(page, acceptance, mode) {
  const result=await page.evaluate(({value,expectedMode})=>{
    const canonical=JSON.parse(JSON.stringify(value));
    const auditor=JSON.parse(JSON.stringify(value));
    Object.assign(auditor.requirements[0],{state:'unavailable',reason:'forged_reason'});
    auditor.sandbox.providerAccountId='acct_victim';
    auditor.adapterSchema.callerAuthoredProviderObjectAccepted=true;
    auditor.rollout.rollbackCanMarkInvoicePaid=true;
    auditor.driftAndDisconnect.automaticReconnectAuthorized=true;
    auditor.access.staffRoleMaySubstituteForCustomerSession=true;
    auditor.protections.missingAmountMayBeTreatedAsZero=true;
    auditor.methods[0].policyState='unsupported';
    auditor.methods[1].policyState='launch_supported';
    return {
      canonicalAccepted:!window.NorthStarCustomerFinancialInvoicePreview.invalidPart7(canonical,expectedMode),
      auditorContradictionRejected:window.NorthStarCustomerFinancialInvoicePreview.invalidPart7(auditor,expectedMode),
    };
  },{value:acceptance,expectedMode:mode});
  assert.deepEqual(result,{canonicalAccepted:true,auditorContradictionRejected:true});
}

async function assertPart9ClientContract(page, acceptance, mode) {
  const result=await page.evaluate(({value,expectedMode})=>{
    const canonical=JSON.parse(JSON.stringify(value));
    const auditor=JSON.parse(JSON.stringify(value));
    auditor.sourceParts.reverse();
    auditor.concurrency.arrivalOrderMayAuthorizeEffect=true;
    auditor.correctionRecovery.priorAcceptedEvidenceMayBeRewritten=true;
    auditor.customerReceipt.checkReceivedRequiredWording='payment complete';
    auditor.accounting.runtimeAvailable=true;
    auditor.accounting.maySupplyCheckClearance=true;
    auditor.access.staffRoleMaySubstituteForCustomerAccess=true;
    auditor.acceptance.independentWholeHeadAuditAccepted=true;
    auditor.customerReceiptRowCount=1;
    return {
      canonicalAccepted:!window.NorthStarCustomerFinancialInvoicePreview.invalidPart9(canonical,expectedMode),
      auditorContradictionRejected:window.NorthStarCustomerFinancialInvoicePreview.invalidPart9(auditor,expectedMode),
    };
  },{value:acceptance,expectedMode:mode});
  assert.deepEqual(result,{canonicalAccepted:true,auditorContradictionRejected:true});
}

async function assertPart10ClientContract(page, acceptance, mode) {
  const result=await page.evaluate(({value,expectedMode})=>{
    const canonical=JSON.parse(JSON.stringify(value));
    const auditor=JSON.parse(JSON.stringify(value));
    auditor.sourceParts.reverse();
    auditor.failureRetry.orderedFailureStates.reverse();
    auditor.failureRetry.automaticReminderRetryOrChargeSupported=true;
    auditor.failureRetry.priorProviderSessionMayBeReused=true;
    auditor.revocation.orderedRevocationAxes.reverse();
    auditor.revocation.roleOrRetryMayBypassRevocation=true;
    auditor.access.staffRoleMaySubstituteForCustomerSession=true;
    auditor.privacy.recipientOrContactDetailExposed=true;
    auditor.acceptance.independentWholeHeadAuditAccepted=true;
    auditor.outboundMessageCount=1;
    return {
      canonicalAccepted:!window.NorthStarCustomerFinancialInvoicePreview.invalidPart10(canonical,expectedMode),
      auditorContradictionRejected:window.NorthStarCustomerFinancialInvoicePreview.invalidPart10(auditor,expectedMode),
    };
  },{value:acceptance,expectedMode:mode});
  assert.deepEqual(result,{canonicalAccepted:true,auditorContradictionRejected:true});
}

async function assertPart11ClientContract(page, bundle, mode) {
  const result=await page.evaluate(async({value,sources,part10,preview,expectedMode})=>{
    const canonical=JSON.parse(JSON.stringify(value));
    const canonicalSources=JSON.parse(JSON.stringify(sources));
    const auditor=JSON.parse(JSON.stringify(value));
    auditor.sourceParts.reverse();
    auditor.taxAccountingBoundary.accountingRuntimeAvailable=true;
    auditor.taxAccountingBoundary.journalTaxFilingRevenueRecognitionOrBooksCloseAuthorized=true;
    auditor.retentionHold.recognizedHoldPurposes.reverse();
    auditor.retentionHold.missingRetentionOrHoldStateMayAuthorizeDeletion=true;
    auditor.adapterLifecycle.exactStates.reverse();
    auditor.adapterLifecycle.automaticReconnectAllowed=true;
    auditor.adapterLifecycle.disconnectMayDeleteImmutableReceiptsOrAudit=true;
    auditor.adapterLifecycle.regrantRequiresFreshReviewedAuthority=false;
    auditor.privacy.adapterCredentialSecretOrIdempotencyKeyExposed=true;
    auditor.acceptance.independentWholeHeadAuditAccepted=true;
    auditor.accountingMutationCount=1;
    const wrongPart10=JSON.parse(JSON.stringify(value));
    wrongPart10.part10Witness.digest='f'.repeat(64);
    const wrongSource=JSON.parse(JSON.stringify(value));
    wrongSource.sourceParts[0].digest='e'.repeat(64);
    const wrongSourceContract=JSON.parse(JSON.stringify(sources));
    wrongSourceContract.part11A.state='current';
    const api=window.NorthStarCustomerFinancialInvoicePreview;
    return {
      canonicalAccepted:!api.invalidPart11(canonical,expectedMode) &&
        !await api.invalidPart11SourceWitnesses(canonical,canonicalSources) &&
        await api.samePart11Witness(preview,canonical,part10),
      auditorContradictionRejected:api.invalidPart11(auditor,expectedMode),
      wrongPart10Rejected:!await api.samePart11Witness(preview,wrongPart10,part10),
      wrongSourceRejected:await api.invalidPart11SourceWitnesses(wrongSource,canonicalSources),
      wrongSourceContractRejected:await api.invalidPart11SourceWitnesses(
        canonical,wrongSourceContract),
    };
  },{value:bundle.part11Acceptance,sources:bundle.part11SourceContracts,
    part10:bundle.part10Acceptance,preview:bundle.preview,expectedMode:mode});
  assert.deepEqual(result,{canonicalAccepted:true,auditorContradictionRejected:true,
    wrongPart10Rejected:true,wrongSourceRejected:true,wrongSourceContractRejected:true});
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

async function assertPart11FailureCleared(root) {
  await root.locator('[role=alert]').waitFor({timeout:120000});
  assert.equal(await root.locator('table').count(),0);
  assert.equal(await root.locator('.invoice-draft-preview-document').count(),0);
  assert.equal(await root.locator('.invoice-part5-acceptance').count(),0);
  assert.equal(await root.locator('.invoice-part6-acceptance').count(),0);
  assert.equal(await root.locator('.invoice-part7-acceptance').count(),0);
  assert.equal(await root.locator('.invoice-part9-acceptance').count(),0);
  assert.equal(await root.locator('.invoice-part10-acceptance').count(),0);
  assert.equal(await root.locator('.invoice-part11-acceptance').count(),0);
  assert.equal(await root.getByText(/\$/, {exact:false}).count(),0);
}

(async () => {
  let prepared; let server; let browser; let activePage;
  const ledger = { engine, layouts: [], actualPage: '/dashboard', mockedResponses: 0,
    requestInterceptions: 0, responseInterceptions: 0,
    providerCalls: 0, receiverMutations: 0, liveMoneyEvidence: 'not-run-deferred-first-paying-customer' };
  try {
    prepared = await createPart4ePaidBrowserFixture();
    server = await listen(prepared.fixture.app);
    const origin = `http://127.0.0.1:${server.address().port}`;
    const runtime = resolveBrowserRuntime(engine);
    browser = await runtime.browserType.launch({ headless: true, executablePath: runtime.executablePath });
    for (let index = 0; index < selectedLayouts.length; index += 1) {
      const layout = selectedLayouts[index];
      const layoutSession = await provisionDurableSession(prepared.fixture.ownerPool, {
        organizationId: prepared.fixture.org, userId: prepared.actor.actorUserId,
        membershipId: prepared.actor.actorUserId, role: prepared.actor.actorAccessRole,
      });
      const context = await browser.newContext({ viewport: { width: layout.width, height: layout.height },
        colorScheme: layout.colorScheme, reducedMotion: 'reduce' });
      await context.addInitScript(theme => localStorage.setItem('northstar-theme', theme), layout.colorScheme);
      await context.addCookies(Object.entries(layoutSession.cookies).map(([name,value]) => ({
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
            url.pathname.includes('/invoice-part6') || url.pathname.includes('/payment-part9') ||
            url.pathname.includes('/collection-part10') ||
            url.pathname.includes('/accounting-part11') ||
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
            url.pathname.includes('/invoice-part6') || url.pathname.includes('/payment-part9') ||
            url.pathname.includes('/collection-part10') ||
            url.pathname.includes('/accounting-part11') ||
            url.pathname.includes('/billable-work-review')) {
          const row = [...routeEvidence].reverse().find(value => value.path === url.pathname + url.search &&
            value.status === undefined); if (row) row.status = response.status();
          if (url.pathname.includes('/accounting-part11-acceptance') && response.status() === 200) {
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
      await root.getByText('Invoice draft — not issued', { exact: true }).waitFor({ timeout: 240000 });
      await root.getByText('Approval, issue, and invoice lifecycle', { exact: true }).waitFor({ timeout: 30000 });
      assert.equal(await root.locator('.invoice-part5-axes li').count(), 7);
      assert.equal(await root.locator('.invoice-part5-corrections li').count(), 4);
      await root.getByText('Customer document, portal, and delivery', { exact: true }).waitFor({ timeout: 30000 });
      assert.equal(await root.locator('.invoice-part6-requirements li').count(), 8);
      for (const requirement of PART6_REQUIREMENTS) {
        assert.equal(await root.getByText(`${requirement} · Unavailable`, { exact: true }).count(), 1);
      }
      assert.equal(await root.locator('.invoice-part6-actions li').count(), 6);
      await root.getByText('Payment provider and initiation', { exact: true }).waitFor({ timeout: 30000 });
      assert.equal(await root.locator('.invoice-part7-requirements li').count(), 10);
      for (const requirement of PART7_REQUIREMENTS) {
        assert.equal(await root.locator('.invoice-part7-requirements li').filter({hasText:requirement}).count(),1);
      }
      assert.equal(await root.locator('.invoice-part7-controls li').count(), 8);
      assert.equal(await root.locator('.invoice-part7-methods li').count(), 2);
      await root.getByText('Payment corrections, receipts, and accounting', { exact: true })
        .waitFor({ timeout: 30000 });
      assert.equal(await root.locator('.invoice-part9-sources li').count(), 5);
      for (const sourcePart of PART9_SOURCES) {
        assert.equal(await root.locator('.invoice-part9-sources li')
          .filter({hasText:`${sourcePart} · unavailable`}).count(),1);
      }
      assert.equal(await root.locator('.invoice-part9-controls li').count(), 18);
      assert.equal(await root.getByText(
        'Required check wording · check received — clearance unknown',{exact:true}).count(),1);
      assert.equal(await root.getByText('Unknown required field accepted · false',{exact:true}).count(),1);
      assert.equal(await root.getByText('Optional output may authorize an effect · false',{exact:true}).count(),1);
      await root.getByText('Collections review and follow-up', { exact: true })
        .waitFor({ timeout: 30000 });
      assert.equal(await root.locator('.invoice-part10-sources li').count(), 3);
      for (const sourcePart of PART10_SOURCES) {
        assert.equal(await root.locator('.invoice-part10-sources li')
          .filter({hasText:`${sourcePart} ·`}).count(),1);
      }
      assert.equal(await root.locator('.invoice-part10-failures li').count(), 13);
      assert.equal(await root.locator('.invoice-part10-revocations li').count(), 12);
      await root.getByText('Accounting handoff and reconciliation', { exact: true })
        .waitFor({ timeout: 30000 });
      assert.equal(await root.locator('.invoice-part11-sources li').count(), 3);
      for (const sourcePart of PART11_SOURCES) {
        assert.equal(await root.locator('.invoice-part11-sources li')
          .filter({hasText:`${sourcePart} · unavailable`}).count(),1);
      }
      assert.equal(await root.locator('.invoice-part11-boundaries li').count(), 16);
      assert.equal(await root.getByRole('button', { name: /approve invoice|issue|send|resend|revoke|deliver|collect|correct invoice|connect provider|start checkout|pay invoice/i }).count(), 0);
      assert.ok(await root.getByText(`Mounted ${engine} ${layout.name} reviewed line`, { exact: true }).count() ||
        await root.getByText(`Concurrent ${engine} exact-current line`, { exact: true }).count());
      if (index === 0) {
        part11DigestFault={mode:'paid',kind:'part10'};
        await root.getByRole('button',{name:'Reload current preview'}).focus();
        await root.getByRole('button',{name:'Reload current preview'}).press('Enter');
        await assertPart11FailureCleared(root);
        assert.equal(part11DigestFault,null);
        await root.getByRole('button',{name:'Retry invoice preview'}).focus();
        await root.getByRole('button',{name:'Retry invoice preview'}).press('Enter');
        await root.getByText('Accounting handoff and reconciliation',{exact:true})
          .waitFor({timeout:120000});
      }
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
      assert.equal(await root.locator('.invoice-part7-acceptance').count(), 0);
      assert.equal(await root.locator('.invoice-part9-acceptance').count(), 0);
      assert.equal(await root.locator('.invoice-part10-acceptance').count(), 0);
      assert.equal(await root.locator('.invoice-part11-acceptance').count(), 0);
      assert.equal(await root.getByText(/Mounted .* reviewed line/, { exact: false }).count(), 0);
      await recordTax(root);
      await root.getByText('Invoice draft — not issued', { exact: true }).waitFor({ timeout: 240000 });
      await root.getByText(`Reopen ${engine} ${layout.name} exact-current line`, { exact: true })
        .waitFor({ timeout: 240000 });
      if (index === 0) {
        await proveDatabaseDelayedSuppression({ page, root, summary,
          pool: prepared.fixture.ownerPool,
          relation: 'public.canonical_customer_financial_invoice_draft_revisions_v1',
          routePath: '/invoice-draft',
          expectedText: `Reopen ${engine} ${layout.name} exact-current line` });
      }
      await auditActualSurface(page, root, layout);
      assert.ok(routeEvidence.some(row => row.method === 'POST' && row.path.endsWith('/invoice-draft/workflow-capability') && row.status === 200));
      assert.ok(routeEvidence.some(row => row.method === 'POST' && /\/invoice-draft$/.test(row.path) && [200,201].includes(row.status)));
      assert.ok(routeEvidence.some(row => row.method === 'POST' && row.path.endsWith('/invoice-draft/tax-review') && [200,201,409].includes(row.status)));
      assert.ok(routeEvidence.some(row => row.method === 'GET' && row.path.includes('/accounting-part11-acceptance?') && row.status === 200));
      assert.equal(routeEvidence.some(row => row.method === 'GET' && row.path.includes('/invoice-draft/preview?')), false);
      assert.ok(bundleEvidence.length >= 1);
      const malformedBundles=bundleEvidence.filter(bundle =>
        bundle.part11Acceptance.part10Witness.digest==='f'.repeat(64));
      assert.equal(malformedBundles.length,index===0?1:0);
      const exactBundles=bundleEvidence.filter(bundle =>
        bundle.part11Acceptance.part10Witness.digest!=='f'.repeat(64));
      for (const bundle of exactBundles) {
        assert.equal(bundle.contractVersion, 'm27-accounting-part11-preview-bundle-v1');
        assert.equal(bundle.preview.draftIdentity.revision,
          bundle.part5Acceptance.previewWitness.draftRevision);
        assert.equal(bundle.preview.draftIdentity.draftDigest,
          bundle.part5Acceptance.previewWitness.draftDigest);
        assert.equal(bundle.preview.previewDigest,
          bundle.part5Acceptance.previewWitness.previewDigest);
        assert.deepEqual(bundle.part6Acceptance.previewWitness,
          bundle.part5Acceptance.previewWitness);
        assert.deepEqual(bundle.part6Acceptance.delivery.requirements.map(value => value.requirement),
          PART6_REQUIREMENTS);
        assert.equal(bundle.part6Acceptance.delivery.actions.length, 6);
        assert.equal(bundle.part6Acceptance.outboundMessageCount, 0);
        assert.deepEqual(bundle.part7Acceptance.previewWitness,
          bundle.part6Acceptance.previewWitness);
        assert.deepEqual(bundle.part7Acceptance.requirements.map(value => value.requirement),
          PART7_REQUIREMENTS);
        assert.equal(bundle.part7Acceptance.sandbox.requiredForMissionCompletion, true);
        assert.equal(bundle.part7Acceptance.sandbox.evidenceAccepted, false);
        assert.equal(bundle.part7Acceptance.rollout.stage, 'disabled');
        assert.equal(bundle.part7Acceptance.providerCallCount, 0);
        assert.equal(bundle.part7Acceptance.liveMoneyMovementCount, 0);
        await assertPart7ClientContract(page,bundle.part7Acceptance,'paid');
        assert.deepEqual(bundle.part9Acceptance.previewWitness,
          bundle.part7Acceptance.previewWitness);
        assert.deepEqual(bundle.part9Acceptance.sourceParts.map(value => value.part), PART9_SOURCES);
        assert.equal(bundle.part9Acceptance.concurrency.maximumConcurrentWriterPerAggregate,1);
        assert.equal(bundle.part9Acceptance.customerReceipt.checkReceivedRequiredWording,
          'check received — clearance unknown');
        assert.equal(bundle.part9Acceptance.accounting.runtimeAvailable,false);
        assert.equal(bundle.part9Acceptance.acceptance.independentWholeHeadAuditAccepted,false);
        assert.equal(bundle.part9Acceptance.providerCallCount,0);
        assert.equal(bundle.part9Acceptance.receiverMutationCount,0);
        assert.equal(bundle.part9Acceptance.accountingMutationCount,0);
        assert.equal(bundle.part9Acceptance.liveMoneyMovementCount,0);
        await assertPart9ClientContract(page,bundle.part9Acceptance,'paid');
        assert.deepEqual(bundle.part10Acceptance.previewWitness,
          bundle.part9Acceptance.previewWitness);
        assert.deepEqual(bundle.part10Acceptance.sourceParts.map(value => value.part),PART10_SOURCES);
        assert.equal(bundle.part10Acceptance.failureRetry.automaticReminderRetryOrChargeSupported,false);
        assert.equal(bundle.part10Acceptance.failureRetry.priorProviderSessionMayBeReused,false);
        assert.equal(bundle.part10Acceptance.revocation.roleOrRetryMayBypassRevocation,false);
        assert.equal(bundle.part10Acceptance.access.staffRoleMaySubstituteForCustomerSession,false);
        assert.equal(bundle.part10Acceptance.outboundMessageCount,0);
        assert.equal(bundle.part10Acceptance.providerCallCount,0);
        assert.equal(bundle.part10Acceptance.receiverMutationCount,0);
        assert.equal(bundle.part10Acceptance.accountingMutationCount,0);
        assert.equal(bundle.part10Acceptance.liveMoneyMovementCount,0);
        await assertPart10ClientContract(page,bundle.part10Acceptance,'paid');
        assert.deepEqual(bundle.part11Acceptance.previewWitness,
          bundle.part10Acceptance.previewWitness);
        assert.deepEqual(bundle.part11Acceptance.sourceParts.map(value => value.part),PART11_SOURCES);
        assert.deepEqual(bundle.part11Acceptance.retentionHold.recognizedHoldPurposes,
          ['legal','tax','accounting','provider','security']);
        assert.equal(bundle.part11Acceptance.retentionHold.financialRecordCalendarYears,7);
        assert.equal(bundle.part11Acceptance.retentionHold.holdsSuspendEligibleDeletion,true);
        assert.equal(bundle.part11Acceptance.retentionHold.deletionAuthorized,false);
        assert.deepEqual(bundle.part11Acceptance.adapterLifecycle.exactStates,
          ['connection_unavailable','disconnect_unavailable','regrant_unavailable']);
        assert.equal(bundle.part11Acceptance.adapterLifecycle.automaticReconnectAllowed,false);
        assert.equal(bundle.part11Acceptance.adapterLifecycle.disconnectMayDeleteImmutableReceiptsOrAudit,false);
        assert.equal(bundle.part11Acceptance.adapterLifecycle.regrantRequiresFreshReviewedAuthority,true);
        assert.equal(bundle.part11Acceptance.providerCallCount,0);
        assert.equal(bundle.part11Acceptance.receiverMutationCount,0);
        assert.equal(bundle.part11Acceptance.accountingMutationCount,0);
        assert.equal(bundle.part11Acceptance.liveMoneyMovementCount,0);
        await assertPart11ClientContract(page,bundle,'paid');
      }
      if (index === 0) assert.ok(routeEvidence.some(row => row.method === 'POST' && row.path.endsWith('/invoice-draft-origin') && [200,201].includes(row.status)));
      assert.deepEqual(external, []); assert.deepEqual(errors, []);
      await page.screenshot({ fullPage: true, path: path.join(output, `${engine}-${layout.name}.png`) });
      ledger.layouts.push({ name: layout.name, routeEvidence, taxEvidence: true,
        part5Acceptance: true, part6Acceptance: true, part7Acceptance: true,
        part9Acceptance: true, part10Acceptance: true, part11Acceptance: true,
        completePart7ContractValidation: true,
        completePart9ContractValidation: true,
        completePart10ContractValidation: true, completePart11ContractValidation: true,
        keyboard: true, responsive: true,
        currentnessRecovery: index === 0, delayedResponseSuppression: index === 0,
        malformedPart11DigestClearing: index === 0 });
      delete ledger.current;
      await context.close();

      const demoContext = await browser.newContext({ viewport: { width: layout.width, height: layout.height },
        colorScheme: layout.colorScheme, reducedMotion: 'reduce' });
      await demoContext.addInitScript(theme => localStorage.setItem('northstar-theme', theme), layout.colorScheme);
      const demoPage = await demoContext.newPage(); activePage = demoPage;
      const demoErrors = [], demoExternal = [], demoRoutes = [], demoPaidRoutes = [];
      ledger.current = { name: layout.name, mode: 'demo', errors: demoErrors };
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
      await demoRoot.getByText('Fictional invoice draft — not issued', { exact: true }).waitFor({ timeout:120000 });
      await demoRoot.getByText('Approval, issue, and invoice lifecycle', { exact: true }).waitFor({ timeout:30000 });
      assert.equal(await demoRoot.locator('.invoice-part5-axes li').count(), 7);
      assert.equal(await demoRoot.locator('.invoice-part5-corrections li').count(), 4);
      await demoRoot.getByText('Customer document, portal, and delivery', { exact:true }).waitFor({timeout:30000});
      assert.equal(await demoRoot.locator('.invoice-part6-requirements li').count(),8);
      for (const requirement of PART6_REQUIREMENTS) {
        assert.equal(await demoRoot.getByText(`${requirement} · Unavailable`, { exact:true }).count(),1);
      }
      assert.equal(await demoRoot.locator('.invoice-part6-actions li').count(),6);
      await demoRoot.getByText('Payment provider and initiation',{exact:true}).waitFor({timeout:30000});
      assert.equal(await demoRoot.locator('.invoice-part7-requirements li').count(),10);
      for (const requirement of PART7_REQUIREMENTS) {
        assert.equal(await demoRoot.locator('.invoice-part7-requirements li').filter({hasText:requirement}).count(),1);
      }
      assert.equal(await demoRoot.locator('.invoice-part7-controls li').count(),8);
      assert.equal(await demoRoot.locator('.invoice-part7-methods li').count(),2);
      await demoRoot.getByText('Payment corrections, receipts, and accounting',{exact:true})
        .waitFor({timeout:30000});
      assert.equal(await demoRoot.locator('.invoice-part9-sources li').count(),5);
      for (const sourcePart of PART9_SOURCES) {
        assert.equal(await demoRoot.locator('.invoice-part9-sources li')
          .filter({hasText:`${sourcePart} · unavailable`}).count(),1);
      }
      assert.equal(await demoRoot.locator('.invoice-part9-controls li').count(),18);
      assert.equal(await demoRoot.getByText('Unknown required field accepted · false',{exact:true}).count(),1);
      assert.equal(await demoRoot.getByText('Optional output may authorize an effect · false',{exact:true}).count(),1);
      await demoRoot.getByText('Collections review and follow-up',{exact:true})
        .waitFor({timeout:30000});
      assert.equal(await demoRoot.locator('.invoice-part10-sources li').count(),3);
      for (const sourcePart of PART10_SOURCES) {
        assert.equal(await demoRoot.locator('.invoice-part10-sources li')
          .filter({hasText:`${sourcePart} ·`}).count(),1);
      }
      assert.equal(await demoRoot.locator('.invoice-part10-failures li').count(),13);
      assert.equal(await demoRoot.locator('.invoice-part10-revocations li').count(),12);
      await demoRoot.getByText('Accounting handoff and reconciliation',{exact:true})
        .waitFor({timeout:30000});
      assert.equal(await demoRoot.locator('.invoice-part11-sources li').count(),3);
      for (const sourcePart of PART11_SOURCES) {
        assert.equal(await demoRoot.locator('.invoice-part11-sources li')
          .filter({hasText:`${sourcePart} · unavailable`}).count(),1);
      }
      assert.equal(await demoRoot.locator('.invoice-part11-boundaries li').count(),16);
      assert.equal(await demoRoot.getByText(/Fictional demo boundary/).count(), 6);
      assert.equal(await demoRoot.getByRole('button', {name:/approve invoice|issue|send|resend|revoke|deliver|collect|correct invoice|connect provider|start checkout|pay invoice/i}).count(),0);
      assert.equal(demoRoutes.some(row => row.path.endsWith('/preview')), false);
      assert.ok(demoRoutes.some(row => row.path.endsWith('/part11-acceptance') && row.status === 200));
      const demoPart11=await demoPage.evaluate(async estimateId=>{
        const response=await fetch('/api/demo/customer-financial/invoice-drafts/'+
          encodeURIComponent(estimateId)+'/part11-acceptance',{cache:'no-store'});
        const body=await response.json(); return body.data;
      },graph.ids.estimate);
      await assertPart7ClientContract(demoPage,demoPart11.part7Acceptance,'demo');
      await assertPart9ClientContract(demoPage,demoPart11.part9Acceptance,'demo');
      await assertPart10ClientContract(demoPage,demoPart11.part10Acceptance,'demo');
      await assertPart11ClientContract(demoPage,demoPart11,'demo');
      if (index === 0) {
        part11DigestFault={mode:'demo',kind:'source'};
        await demoRoot.getByRole('button',{name:'Reload current preview'}).focus();
        await demoRoot.getByRole('button',{name:'Reload current preview'}).press('Enter');
        await assertPart11FailureCleared(demoRoot);
        assert.equal(part11DigestFault,null);
        await demoRoot.getByRole('button',{name:'Retry invoice preview'}).focus();
        await demoRoot.getByRole('button',{name:'Retry invoice preview'}).press('Enter');
        await demoRoot.getByText('Accounting handoff and reconciliation',{exact:true})
          .waitFor({timeout:120000});
        const delayedDemoSummary = demoRoot.locator(':scope > summary');
        await proveDatabaseDelayedSuppression({ page:demoPage, root:demoRoot,
          summary:delayedDemoSummary, pool:prepared.fixture.ownerPool,
          relation:'public.demo_command_center_sessions',
          routePath:'/part11-acceptance',
          expectedText:'Fictional invoice draft — not issued' });
      }
      const oldSummary = demoRoot.locator(':scope > summary'); await oldSummary.focus(); await oldSummary.press('Enter');
      await demoRoot.locator('table').waitFor({state:'detached',timeout:10000});
      const oldDemoRevision=await demoPage.evaluate(() => Number(document.documentElement.dataset.demoRevision));
      const resetGraph = await demoPage.evaluate(async () => {
        const currentResponse=await fetch('/api/demo/command-center',{cache:'no-store'});
        const current=(await currentResponse.json()).data;
        const response=await fetch('/api/demo/command-center/reset',{method:'POST',cache:'no-store',
          headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID(),
            'X-NorthStar-Demo-Intent':'reset'},
          body:JSON.stringify({expectedRevision:current.integrity.revision})});
        const body=await response.json(); if(!response.ok||!body.success)throw new Error('demo reset failed');
        return {...body.data.graphs[0],workspaceRevision:body.data.integrity.revision};
      });
      assert.ok(resetGraph.workspaceRevision > oldDemoRevision);
      await oldSummary.focus(); await oldSummary.press('Enter');
      assert.equal(await demoRoot.evaluate(node=>node.open),true);
      const resetAlert=demoRoot.locator('[role=alert]'); await resetAlert.waitFor({timeout:30000});
      assert.match(await resetAlert.textContent(), /changed|unavailable/i);
      assert.equal(await demoRoot.locator('table').count(),0);
      assert.equal(await demoRoot.locator('.invoice-part5-acceptance').count(),0);
      assert.equal(await demoRoot.locator('.invoice-part6-acceptance').count(),0);
      assert.equal(await demoRoot.locator('.invoice-part7-acceptance').count(),0);
      assert.equal(await demoRoot.locator('.invoice-part9-acceptance').count(),0);
      assert.equal(await demoRoot.locator('.invoice-part10-acceptance').count(),0);
      assert.equal(await demoRoot.locator('.invoice-part11-acceptance').count(),0);
      await demoPage.reload({waitUntil:'networkidle'});
      assert.equal(await demoPage.evaluate(() => Number(document.documentElement.dataset.demoRevision)),
        resetGraph.workspaceRevision);
      const recoveredDemoRoot=await openActualCustomerInvoice(demoPage,resetGraph.ids.customer);
      await recoveredDemoRoot.getByText('Fictional invoice draft — not issued',{exact:true})
        .waitFor({timeout:120000});
      await recoveredDemoRoot.getByText('Approval, issue, and invoice lifecycle',{exact:true})
        .waitFor({timeout:30000});
      await recoveredDemoRoot.getByText('Payment provider and initiation',{exact:true})
        .waitFor({timeout:30000});
      await recoveredDemoRoot.getByText('Payment corrections, receipts, and accounting',{exact:true})
        .waitFor({timeout:30000});
      await recoveredDemoRoot.getByText('Collections review and follow-up',{exact:true})
        .waitFor({timeout:30000});
      await recoveredDemoRoot.getByText('Accounting handoff and reconciliation',{exact:true})
        .waitFor({timeout:30000});
      assert.deepEqual(demoExternal, []); assert.deepEqual(demoErrors, []);
      assert.deepEqual(demoPaidRoutes, []);
      await demoPage.screenshot({fullPage:true,path:path.join(output,`${engine}-${layout.name}-demo.png`)});
      ledger.layouts.at(-1).demo = { actualPage:'/demo', routes:demoRoutes, fictional:true,
        resetClearing:true, delayedResponseSuppression:index===0,
        malformedPart11DigestClearing:index===0,
        completePart7ContractValidation:true, completePart9ContractValidation:true,
        completePart10ContractValidation:true, completePart11ContractValidation:true,
        paidRouteCalls:demoPaidRoutes.length };
      delete ledger.current;
      await demoContext.close();
    }
    assert.equal(ledger.layouts.length, selectedLayouts.length);
  } catch (error) {
    ledger.failure = error.stack; process.exitCode = 1;
    if (activePage && !activePage.isClosed()) {
      ledger.failureState = await activePage.evaluate(() => ({
        demoRevision: document.documentElement.dataset.demoRevision || null,
        invoicePreviewText: document.querySelector('#cdEstimateHub > .invoice-draft-preview')?.textContent || null,
        invoicePreviewHtml: document.querySelector('#cdEstimateHub > .invoice-draft-preview')?.innerHTML || null,
      })).catch(() => null);
      await activePage.screenshot({ fullPage: true, path: path.join(output, 'failure.png') }).catch(() => {});
    }
  } finally {
    paidPart11Repository.readBundle=realPaidPart11Read;
    demoPart11.bundle=realDemoPart11Bundle;
    fs.writeFileSync(path.join(output, 'ledger.json'), JSON.stringify(ledger, null, 2));
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    if (prepared) await prepared.fixture.cleanup();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
