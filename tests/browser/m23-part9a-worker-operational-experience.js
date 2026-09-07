'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');
const { normalizeEvidenceAction } = require('../../src/fieldEvidence/contract');

process.chdir(path.resolve(__dirname, '../..'));
process.env.NODE_ENV = 'test';
for (const key of ['OPENAI_API_KEY', 'POLARIS_OPENAI_ENABLED', 'RETELL_API_KEY', 'STRIPE_SECRET_KEY',
  'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS']) {
  delete process.env[key];
}

const APPOINTMENT = 'd1600000-0000-4000-8000-000000000001';
const EXECUTION = 'e1600000-0000-4000-8000-000000000001';
const PROFILE = 'b1600000-0000-4000-8000-000000000002';
const ORGANIZATION = 'a1600000-0000-4000-8000-000000000001';
const AUTH_SESSION = 'c1600000-0000-4000-8000-000000000002';
const CHECKLIST = 'c1600000-0000-4000-8000-000000000003';
const HOSTILE = '<img src=x onerror="globalThis.m23Part9aCompromised=true">';
const ASSIGNMENT_DIGEST = 'a'.repeat(64);
const EXECUTION_DIGEST = 'b'.repeat(64);
let currentActions = ['start'];
let currentMaterialKinds = [];
let currentEquipmentKinds = [];

function today(executionPointer = execution().data) {
  return { success: true, requestId: 'browser-today', data: {
    version: 'm22-part6-today-v1', readOnly: true, mutationCapabilities: [],
    evaluatedAt: '2026-09-07T14:00:00.000Z', scopeDigest: 'c'.repeat(64),
    identity: { profileId: PROFILE, displayName: `Alex Rivera ${HOSTILE}`, operationalRole: 'technician' },
    businessProfile: { id: 'f1600000-0000-4000-8000-000000000001', version: 1,
      hash: 'd'.repeat(64), timeZone: 'America/New_York' },
    day: { date: '2026-09-07', start: '2026-09-07T04:00:00.000Z', end: '2026-09-08T04:00:00.000Z', timeZone: 'America/New_York' },
    count: 1, shown: 1, total: 1, truncated: false, digest: 'e'.repeat(64), records: [{
      appointmentId: APPOINTMENT, title: `Kitchen sink repair ${HOSTILE}`, serviceType: 'Plumbing', appointmentStatus: 'scheduled',
      schedule: { state: 'scheduled', start: '2026-09-07T13:00:00.000Z', end: '2026-09-07T15:00:00.000Z', timeZone: 'America/New_York', spansDayBoundary: false },
      assignment: { kind: 'worker', label: 'Alex Rivera', direct: true, currentCrew: false },
      dispatch: { state: 'dispatched' }, review: { needsReview: false, reasons: [] },
      route: { providerNeutral: true, providerCalls: 0, status: 'unavailable', evidenceDigest: null,
        travelDurationMinutes: null, distance: null, implications: ['No route provider was called.'], uncertainty: [] },
      instructions: { status: 'available', text: `Use the side entrance. ${HOSTILE}`, truncated: false },
      customer: { name: `Jamie Carter ${HOSTILE}`, phone: '+1 555 010 1234', serviceLocation: { street: '125 Maple Avenue', city: 'Riverton', state: 'MA', postalCode: '02110' } },
      crew: null, authority: { revision: 7, digest: ASSIGNMENT_DIGEST, approvedCurrent: true },
      execution: { id: executionPointer.id, lifecycleState: executionPointer.lifecycleState,
        revision: executionPointer.revision, digest: executionPointer.digest,
        sourceAssignmentRevision: executionPointer.sourceAssignmentRevision,
        sourceAssignmentDigest: executionPointer.sourceAssignmentDigest },
      workCapabilities: { version: 'm23-part9a-worker-actions-v1', mutable: true,
        actions: currentActions, materialMovementKinds: currentMaterialKinds, equipmentKinds: currentEquipmentKinds },
    }],
  } };
}

function execution(state = 'not_started', revision = 3, digest = EXECUTION_DIGEST) {
  return { success: true, data: { id: EXECUTION, appointmentId: APPOINTMENT,
    operationId: 'f1600000-0000-4000-8000-000000000001', graphId: 'a1600000-0000-4000-8000-000000000003',
    opportunityId: 'a1600000-0000-4000-8000-000000000004', assignmentId: 'a1600000-0000-4000-8000-000000000005',
    lifecycleState: state, sourceAssignmentRevision: 7, sourceAssignmentDigest: ASSIGNMENT_DIGEST,
    revision, digest, recordedByUserId: PROFILE, performedByProfileId: PROFILE,
    lastAction: state === 'in_progress' ? 'start' : 'initialize', lastReason: 'Current worker action.',
    createdAt: '2026-09-07T13:00:00.000000Z', updatedAt: '2026-09-07T13:10:00.000000Z' } };
}

function emptyReads(executionPointer = execution().data, evidenceRecords = []) {
  return {
    labor: { success: true, data: { executionId: EXECUTION, intervals: [], summaries: [], totalIntervalCount: 0,
      truncated: false, categoryContract: { version: 'm23-labor-category-v1', digest: '2'.repeat(64), categories: ['break', 'cleanup', 'other', 'production', 'setup', 'travel'] }, interpretation: 'Operational time evidence only; not payroll.' } },
    materials: { success: true, data: { executionId: EXECUTION, movements: [], balances: [], totalMovementCount: 0,
      truncated: false, balanceScope: 'visible execution evidence only', stockKnown: false,
      unitContract: { version: 'm23-material-unit-v1', digest: '8'.repeat(64), quantity: 'positive decimal string', conversionPolicy: 'none' }, interpretation: 'Recorded movement evidence only.' } },
    equipment: { success: true, data: { events: [], total: 0, returned: 0, truncated: false } },
    catalogue: { success: true, data: { assets: [{
      id: 'a1600000-0000-4000-8000-000000000006', name: `Service van ${HOSTILE}`,
      categoryLabel: 'Vehicle', reviewState: 'reviewed', version: 2, assetDigest: '3'.repeat(64),
      knowledgeVersionId: 'a1600000-0000-4000-8000-000000000007', knowledgeDigest: '4'.repeat(64),
      operationRevision: 0, operationDigest: null,
    }], total: 1, returned: 1, truncated: false, canManage: false, authority: 'postgresql' } },
    evidence: { success: true, data: evidenceRecords, total: evidenceRecords.length,
      returned: evidenceRecords.length, truncated: false, nextCursor: null },
    progress: { success: true, data: { executionId: EXECUTION, records: [], total: 0, returned: 0, truncated: false }, nextCursor: null },
    completion: { success: true, data: { execution: executionPointer, activeProposal: null, records: [], totalRecordCount: 0,
      truncated: false, authority: 'postgresql', completionInferred: false, interpretation: 'Explicit completion authority only.' } },
  };
}

async function main() {
  const selected = (process.argv.find(value => value.startsWith('--browser=')) || '--browser=chrome').split('=')[1];
  const output = path.resolve(__dirname, '../../outputs/m23-part9a-worker', selected);
  fs.mkdirSync(output, { recursive: true });
  const ledger = { browser: selected, cases: [], externalBlocked: [], providerCalls: 0, pageErrors: [], requests: [] };
  const { app } = require('../../src/server');
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const runtime = resolveBrowserRuntime(selected);
  const browser = await runtime.browserType.launch({ headless: true, executablePath: runtime.executablePath });
  ledger.version = browser.version();
  let currentExecution = execution();
  let failToday = false;
  try {
    for (const theme of ['light', 'dark']) {
      for (const width of [1440, 390, 320]) {
        currentExecution = execution();
        currentActions = ['start'];
        currentMaterialKinds = [];
        currentEquipmentKinds = [];
        let evidenceRecords = [];
        let checklistAttempts = 0;
        const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', hasTouch: width <= 390 });
        await context.addInitScript(value => { sessionStorage.setItem('northstar-theme', value); window.m23Part9aCompromised = false; }, theme);
        await context.addCookies([{ name: 'northstar_csrf', value: 'browser-csrf-token', url: origin, sameSite: 'Lax' }]);
        await context.route('**/*', async route => {
          const request = route.request();
          const url = new URL(request.url());
          if (url.origin !== origin) { ledger.externalBlocked.push(url.origin); return route.fulfill({ status: 204, body: '' }); }
          if (!url.pathname.startsWith('/api/')) return route.continue();
          ledger.requests.push({ method: request.method(), path: url.pathname,
            headers: request.headers(), body: request.postDataJSON ? request.postDataJSON() : null });
          if (url.pathname === '/api/v1/today') {
            if (failToday) return route.abort('internetdisconnected');
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(today(currentExecution.data)) });
          }
          const reads = emptyReads(currentExecution.data, evidenceRecords);
          if (url.pathname === `/api/v1/field-executions/${EXECUTION}` && request.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(currentExecution) });
          if (url.pathname === `/api/v1/field-executions/${EXECUTION}/labor`) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reads.labor) });
          if (url.pathname === `/api/v1/field-executions/${EXECUTION}/materials`) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reads.materials) });
          if (url.pathname === `/api/equipment/executions/${EXECUTION}`) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reads.equipment) });
          if (url.pathname === '/api/equipment/catalogue') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reads.catalogue) });
          if (url.pathname === `/api/v1/field-executions/${EXECUTION}/field-evidence`) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reads.evidence) });
          if (url.pathname === `/api/v1/field-executions/${EXECUTION}/progress`) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reads.progress) });
          if (url.pathname === `/api/v1/field-executions/${EXECUTION}/completion`) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reads.completion) });
          if (url.pathname === `/api/v1/field-executions/${EXECUTION}/field-evidence-actions` && request.method() === 'POST') {
            const normalized = normalizeEvidenceAction({
              organizationId: ORGANIZATION,
              actorUserId: PROFILE,
              actorAccessRole: 'member',
              authSessionId: AUTH_SESSION,
              executionId: EXECUTION,
              idempotencyKey: request.headers()['idempotency-key'],
              body: request.postDataJSON(),
            });
            checklistAttempts += 1;
            ledger.cases.push({ contract: 'create_checklist', attempt: checklistAttempts,
              action: normalized.action, valid: true });
            if (checklistAttempts === 1) {
              return route.fulfill({
                status: 503,
                headers: { 'Retry-After': '1' },
                contentType: 'application/json',
                body: JSON.stringify({ success: false, error: {
                  code: 'M23_FIELD_EVIDENCE_UNAVAILABLE', message: 'Field evidence is temporarily unavailable.',
                } }),
              });
            }
            evidenceRecords = [{
              id: CHECKLIST, rootId: CHECKLIST, previousRecordId: null, type: 'checklist',
              revision: 1, document: normalized.document, digest: '7'.repeat(64),
              executionId: EXECUTION, assignmentId: 'a1600000-0000-4000-8000-000000000005',
              recordedByUserId: PROFILE, performedByProfileId: PROFILE,
              sourceExecutionRevision: currentExecution.data.revision,
              sourceExecutionDigest: currentExecution.data.digest,
              sourceAssignmentRevision: 7, sourceAssignmentDigest: ASSIGNMENT_DIGEST,
              reason: normalized.reason, decidedAt: '2026-09-07T13:12:00.000000Z',
            }];
            return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({
              success: true, data: evidenceRecords[0],
            }) });
          }
          if (url.pathname === `/api/v1/field-executions/${EXECUTION}/transitions` && request.method() === 'POST') {
            currentExecution = execution('in_progress', 4, 'f'.repeat(64));
            currentActions = ['pause', 'start_timer', 'record_manual', 'record_material', 'record_equipment',
              'create_checklist', 'respond_item', 'record_observation', 'record_note', 'record_progress',
              'record_blocker', 'record_exception', 'record_change', 'propose_completion'];
            currentMaterialKinds = ['consumed', 'returned', 'transferred', 'waste'];
            currentEquipmentKinds = ['check_out', 'use', 'check_in', 'reading', 'condition', 'fault',
              'downtime_start', 'downtime_end', 'maintenance'];
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(currentExecution) });
          }
          return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code: 'TEST_UNINVENTORIED', message: 'Uninventoried request.' } }) });
        });
        const page = await context.newPage();
        page.on('pageerror', error => ledger.pageErrors.push(error.message));
        await page.goto(`${origin}/dashboard/work?appointmentId=${APPOINTMENT}&executionId=${EXECUTION}`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.body.dataset.workState === 'ready');
        assert.match(await page.locator('#workTitle').textContent(), /Kitchen sink repair/);
        assert.match(await page.locator('#workCustomer').textContent(), /Jamie Carter/);
        assert.strictEqual(await page.locator('#workMain img:not(.logo-img):not(.mobile-logo), #workMain script').count(), 0);
        assert.strictEqual(await page.evaluate(() => window.m23Part9aCompromised), false);
        const geometry = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth,
          main: document.getElementById('workMain').scrollWidth, focusable: [...document.querySelectorAll('#workMain button,#workMain input,#workMain select,#workMain textarea,#workMain a')]
            .filter(node => !node.disabled && !node.hidden).every(node => node.getBoundingClientRect().height >= 44) }));
        assert.ok(geometry.document <= geometry.viewport + 1, JSON.stringify(geometry));
        assert.ok(geometry.main <= geometry.viewport + 1, JSON.stringify(geometry));
        assert.strictEqual(geometry.focusable, true, JSON.stringify(geometry));
        const snapshot = await page.locator('#workMain').ariaSnapshot();
        for (const name of ['Work status', 'Time', 'Materials', 'Equipment', 'Evidence', 'Progress and issues', 'Completion']) assert.match(snapshot, new RegExp(name));
        if (theme === 'light' && width === 1440) {
          const start = page.getByRole('button', { name: 'Start work' });
          await start.focus(); await start.click();
          const dialog = page.getByRole('dialog', { name: 'Confirm Start work' });
          await dialog.waitFor();
          assert.strictEqual(await page.evaluate(() => document.getElementById('workConfirmDialog').contains(document.activeElement)), true);
          await dialog.getByRole('button', { name: 'Confirm Start work' }).click();
          await page.waitForFunction(() => document.querySelector('#workStateBadge').textContent.includes('In progress'));
          const transition = ledger.requests.find(item => item.method === 'POST' && item.path.endsWith('/transitions'));
          assert.deepStrictEqual(transition.body, { action: 'start', expectedRevision: 3, expectedDigest: EXECUTION_DIGEST,
            expectedAssignmentRevision: 7, expectedAssignmentDigest: ASSIGNMENT_DIGEST,
            reason: 'Start the current assigned work.' });
          assert.match(transition.headers['idempotency-key'], /^m23-part9a-start-/);
          assert.strictEqual(transition.headers['x-csrf-token'], 'browser-csrf-token');
          assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'workLifecyclePrimary');
          assert.strictEqual(await page.getByRole('button', { name: 'Create checklist' }).count(), 1);
          assert.strictEqual(await page.getByRole('button', { name: 'Record equipment use' }).count(), 1);
          await page.getByRole('button', { name: 'Record equipment use' }).click();
          const equipmentKinds = await page.locator('#workEquipmentForm-kind option').evaluateAll(options => options.map(option => option.value));
          assert.deepStrictEqual(equipmentKinds, currentEquipmentKinds);
          assert.ok(equipmentKinds.includes('reading'));
          assert.ok(equipmentKinds.includes('maintenance'));

          await page.getByRole('button', { name: 'Create checklist', exact: true }).first().click();
          await page.locator('#workEvidenceChecklist-prompt').fill('Confirm the shutoff is accessible.');
          await page.locator('#workEvidenceChecklist').getByRole('button', { name: 'Create checklist', exact: true }).click();
          const checklistDialog = page.getByRole('dialog', { name: 'Confirm Create checklist' });
          await checklistDialog.waitFor();
          await checklistDialog.getByRole('button', { name: 'Confirm Create checklist' }).click();
          await page.waitForFunction(() => document.body.dataset.workState === 'retry');
          assert.match(await page.locator('#workStateCopy').textContent(), /after 1/);
          assert.strictEqual(await page.getByRole('button', { name: 'Retry same request' }).count(), 1);
          await page.getByRole('button', { name: 'Retry same request' }).click();
          await page.waitForFunction(() => document.body.dataset.workState === 'success');
          const checklistRequests = ledger.requests.filter(item =>
            item.method === 'POST' && item.path.endsWith('/field-evidence-actions'));
          assert.strictEqual(checklistRequests.length, 2);
          assert.deepStrictEqual(checklistRequests[0].body, checklistRequests[1].body);
          assert.strictEqual(checklistRequests[0].headers['idempotency-key'], checklistRequests[1].headers['idempotency-key']);
          assert.match(checklistRequests[0].headers['idempotency-key'], /^m23-part9a-create_checklist-/);
          assert.strictEqual(await page.getByRole('button', { name: 'Respond to checklist' }).count(), 1);
          assert.strictEqual(await page.locator('#workEvidenceContent .work-record-list li').count(), 1);
          assert.match(await page.locator('#workStatus').textContent(), /recorded and refreshed/);
          assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'workMain');
        }
        await page.screenshot({ path: path.join(output, `${theme}-${width}.png`), fullPage: true });
        ledger.cases.push({ theme, width, geometry, ready: true, inertHostileText: true, reducedMotion: true });
        await context.close();
      }
    }

    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addInitScript(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }); });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.fulfill({ status: 204, body: '' });
      if (url.pathname === '/api/v1/today') return route.abort('internetdisconnected');
      return route.continue();
    });
    const page = await context.newPage();
    await page.goto(`${origin}/dashboard/work?appointmentId=${APPOINTMENT}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.body.dataset.workState === 'offline');
    assert.match(await page.locator('#workStateCopy').textContent(), /Reconnect/);
    ledger.cases.push({ offline: true, durableSuccessClaimed: false });
    await context.close();

    const staleContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const todayExecution = execution();
    const newerExecution = execution('in_progress', 4, 'f'.repeat(64));
    await staleContext.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.fulfill({ status: 204, body: '' });
      if (!url.pathname.startsWith('/api/')) return route.continue();
      if (url.pathname === '/api/v1/today') return route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(today(todayExecution.data)),
      });
      const reads = emptyReads(newerExecution.data, []);
      if (url.pathname === `/api/v1/field-executions/${EXECUTION}`) return route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(newerExecution),
      });
      const mapping = new Map([
        [`/api/v1/field-executions/${EXECUTION}/labor`, reads.labor],
        [`/api/v1/field-executions/${EXECUTION}/materials`, reads.materials],
        [`/api/equipment/executions/${EXECUTION}`, reads.equipment],
        ['/api/equipment/catalogue', reads.catalogue],
        [`/api/v1/field-executions/${EXECUTION}/field-evidence`, reads.evidence],
        [`/api/v1/field-executions/${EXECUTION}/progress`, reads.progress],
        [`/api/v1/field-executions/${EXECUTION}/completion`, reads.completion],
      ]);
      if (mapping.has(url.pathname)) return route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(mapping.get(url.pathname)),
      });
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({
        success: false, error: { code: 'TEST_UNINVENTORIED', message: 'Uninventoried request.' },
      }) });
    });
    const stalePage = await staleContext.newPage();
    await stalePage.goto(`${origin}/dashboard/work?appointmentId=${APPOINTMENT}&executionId=${EXECUTION}`, { waitUntil: 'domcontentloaded' });
    await stalePage.waitForFunction(() => document.body.dataset.workState !== 'loading');
    assert.strictEqual(await stalePage.locator('body').getAttribute('data-work-state'), 'stale');
    assert.match(await stalePage.locator('#workStateCopy').textContent(), /Reload/);
    assert.strictEqual(await stalePage.locator('#workSections:not([hidden])').count(), 0);
    ledger.cases.push({ staleMixedSnapshot: true, mutationCapabilityExposed: false });
    await staleContext.close();

    assert.strictEqual(ledger.externalBlocked.length, 0, JSON.stringify(ledger.externalBlocked));
    assert.strictEqual(ledger.pageErrors.length, 0, JSON.stringify(ledger.pageErrors));
    ledger.result = 'passed';
  } catch (error) {
    ledger.result = 'failed'; ledger.error = error.stack; throw error;
  } finally {
    fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify(ledger, null, 2) + '\n');
    await browser.close().catch(() => {});
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error && error.stack || error); process.exitCode = 1; });
