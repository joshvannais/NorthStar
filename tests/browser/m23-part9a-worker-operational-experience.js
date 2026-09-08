'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');
const { normalizeEvidenceAction } = require('../../src/fieldEvidence/contract');
const {
  LABOR_CATEGORY_CONTRACT_DIGEST,
  LABOR_CATEGORY_CONTRACT_VERSION,
  MATERIAL_UNIT_CONTRACT_DIGEST,
  MATERIAL_UNIT_CONTRACT_VERSION,
  normalizeInitialization,
  normalizeLaborAction,
  normalizeMaterialAction,
  normalizeTransition,
} = require('../../src/operations/contract');
const { normalizeOperation } = require('../../src/equipment/contract');
const { normalizeProgressAction } = require('../../src/progress/contract');
const { normalizeCompletionAction } = require('../../src/completion/contract');

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
const CHECKLIST_RESPONSE = 'c1600000-0000-4000-8000-000000000004';
const LABOR_INTERVAL = 'c1600000-0000-4000-8000-000000000005';
const COMPLETION_PROPOSAL = 'c1600000-0000-4000-8000-000000000006';
const HOSTILE = '<img src=x onerror="globalThis.m23Part9aCompromised=true">';
const ASSIGNMENT_DIGEST = 'a'.repeat(64);
const EXECUTION_DIGEST = 'b'.repeat(64);
let currentActions = ['start'];
let currentMaterialKinds = [];
let currentEquipmentKinds = [];

function inProgressActions(timerOpen = false) {
  return ['pause', timerOpen ? 'stop_timer' : 'start_timer', 'record_manual', 'record_material', 'record_equipment',
    'create_checklist', 'respond_item', 'record_observation', 'record_note', 'record_progress',
    'record_blocker', 'record_exception', 'record_change', 'propose_completion'];
}

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
      execution: executionPointer ? { id: executionPointer.id, lifecycleState: executionPointer.lifecycleState,
        revision: executionPointer.revision, digest: executionPointer.digest,
        sourceAssignmentRevision: executionPointer.sourceAssignmentRevision,
        sourceAssignmentDigest: executionPointer.sourceAssignmentDigest } : null,
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

function emptyReads(executionPointer = execution().data, evidenceRecords = [], laborIntervals = [],
  completionRecords = [], activeProposal = null) {
  return {
    labor: { success: true, data: { executionId: EXECUTION, intervals: laborIntervals, summaries: [],
      totalIntervalCount: laborIntervals.length, truncated: false,
      categoryContract: { version: LABOR_CATEGORY_CONTRACT_VERSION, digest: LABOR_CATEGORY_CONTRACT_DIGEST,
        categories: ['break', 'cleanup', 'other', 'production', 'setup', 'travel'] },
      interpretation: 'Operational time evidence only; not payroll.' } },
    materials: { success: true, data: { executionId: EXECUTION, movements: [], balances: [], totalMovementCount: 0,
      truncated: false, balanceScope: 'visible execution evidence only', stockKnown: false,
      unitContract: { version: MATERIAL_UNIT_CONTRACT_VERSION, digest: MATERIAL_UNIT_CONTRACT_DIGEST,
        quantity: 'positive decimal string', conversionPolicy: 'none' }, interpretation: 'Recorded movement evidence only.' } },
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
    completion: { success: true, data: { execution: executionPointer, activeProposal,
      records: completionRecords, totalRecordCount: completionRecords.length,
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
    const browserProfiles = [
      { name: '1440', width: 1440, height: 900, deviceScaleFactor: 1, hasTouch: false, zoomPercent: null },
      { name: 'zoom-200', width: 720, height: 450, deviceScaleFactor: 2, hasTouch: false, zoomPercent: 200 },
      { name: '390', width: 390, height: 844, deviceScaleFactor: 1, hasTouch: true, zoomPercent: null },
      { name: 'zoom-400', width: 360, height: 225, deviceScaleFactor: 4, hasTouch: false, zoomPercent: 400 },
      { name: '320', width: 320, height: 700, deviceScaleFactor: 1, hasTouch: true, zoomPercent: null },
    ];
    for (const theme of ['light', 'dark']) {
      for (const profile of browserProfiles) {
        const width = profile.width;
        currentExecution = execution();
        currentActions = ['start'];
        currentMaterialKinds = [];
        currentEquipmentKinds = [];
        let evidenceRecords = [];
        let checklistAttempts = 0;
        let laborIntervals = [];
        let completionRecords = [];
        let activeProposal = null;
        let conflictTransition = false;
        const partialEvidence = theme === 'dark' && profile.name === '1440';
        const context = await browser.newContext({
          viewport: { width, height: profile.height },
          deviceScaleFactor: profile.deviceScaleFactor,
          reducedMotion: 'reduce',
          hasTouch: profile.hasTouch,
        });
        await context.addInitScript(value => { localStorage.setItem('northstar-theme', value); window.m23Part9aCompromised = false; }, theme);
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
          const reads = emptyReads(currentExecution.data, evidenceRecords, laborIntervals,
            completionRecords, activeProposal);
          if (url.pathname === `/api/v1/field-executions/${EXECUTION}` && request.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(currentExecution) });
          if (url.pathname === `/api/v1/field-executions/${EXECUTION}/labor`) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reads.labor) });
          if (url.pathname === `/api/v1/field-executions/${EXECUTION}/materials`) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reads.materials) });
          if (url.pathname === `/api/equipment/executions/${EXECUTION}`) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reads.equipment) });
          if (url.pathname === '/api/equipment/catalogue') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reads.catalogue) });
          if (url.pathname === `/api/v1/field-executions/${EXECUTION}/field-evidence`) return route.fulfill(partialEvidence
            ? { status: 503, contentType: 'application/json', body: JSON.stringify({ success: false,
              error: { code: 'M23_FIELD_STORAGE_UNAVAILABLE', message: 'Durable field-file storage is unavailable.' } }) }
            : { status: 200, contentType: 'application/json', body: JSON.stringify(reads.evidence) });
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
            ledger.cases.push({ contract: 'field_evidence', attempt: checklistAttempts,
              action: normalized.action, valid: true });
            if (normalized.action === 'create_checklist' && checklistAttempts === 1) {
              return route.fulfill({
                status: 503,
                headers: { 'Retry-After': '1' },
                contentType: 'application/json',
                body: JSON.stringify({ success: false, error: {
                  code: 'M23_FIELD_EVIDENCE_UNAVAILABLE', message: 'Field evidence is temporarily unavailable.',
                } }),
              });
            }
            const evidenceId = normalized.action === 'create_checklist' ? CHECKLIST : CHECKLIST_RESPONSE;
            const evidenceDigest = normalized.action === 'create_checklist' ? '7'.repeat(64) : '6'.repeat(64);
            const evidenceRecord = {
              id: evidenceId, rootId: evidenceId, previousRecordId: null,
              type: normalized.document.kind, revision: 1, document: normalized.document,
              digest: evidenceDigest,
              executionId: EXECUTION, assignmentId: 'a1600000-0000-4000-8000-000000000005',
              recordedByUserId: PROFILE, performedByProfileId: PROFILE,
              sourceExecutionRevision: currentExecution.data.revision,
              sourceExecutionDigest: currentExecution.data.digest,
              sourceAssignmentRevision: 7, sourceAssignmentDigest: ASSIGNMENT_DIGEST,
              reason: normalized.reason, decidedAt: '2026-09-07T13:12:00.000000Z',
            };
            if (normalized.action === 'create_checklist') evidenceRecords = [evidenceRecord];
            else evidenceRecords = evidenceRecords.concat(evidenceRecord);
            return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({
              success: true, data: evidenceRecord,
            }) });
          }
          if (url.pathname === `/api/v1/field-executions/${EXECUTION}/labor-actions` && request.method() === 'POST') {
            const normalized = normalizeLaborAction({
              organizationId: ORGANIZATION, actorUserId: PROFILE, actorAccessRole: 'member',
              authSessionId: AUTH_SESSION, executionId: EXECUTION,
              idempotencyKey: request.headers()['idempotency-key'], body: request.postDataJSON(),
            });
            ledger.cases.push({ contract: 'labor', action: normalized.action, valid: true });
            if (normalized.action === 'start_timer') {
              laborIntervals = [{ id: LABOR_INTERVAL, category: normalized.category,
                observedStart: '2026-09-07T13:13:00.000000Z', observedEnd: null,
                reviewState: 'unreviewed', revision: 1, digest: '5'.repeat(64) }];
              currentActions = inProgressActions(true);
            } else if (normalized.action === 'stop_timer') {
              laborIntervals = [];
              currentActions = inProgressActions(false);
            }
            return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ success: true, data: {} }) });
          }
          if (url.pathname === `/api/v1/field-executions/${EXECUTION}/material-actions` && request.method() === 'POST') {
            const normalized = normalizeMaterialAction({
              organizationId: ORGANIZATION, actorUserId: PROFILE, actorAccessRole: 'member',
              authSessionId: AUTH_SESSION, executionId: EXECUTION,
              idempotencyKey: request.headers()['idempotency-key'], body: request.postDataJSON(),
            });
            ledger.cases.push({ contract: 'material', action: normalized.action,
              movementKind: normalized.movementKind, valid: true });
            return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ success: true, data: {} }) });
          }
          if (url.pathname === `/api/equipment/executions/${EXECUTION}/actions` && request.method() === 'POST') {
            const normalized = normalizeOperation(request.postDataJSON());
            ledger.cases.push({ contract: 'equipment', action: normalized.action,
              kind: normalized.kind, valid: true });
            return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ success: true, data: {} }) });
          }
          if (url.pathname === `/api/v1/field-executions/${EXECUTION}/progress-actions` && request.method() === 'POST') {
            const normalized = normalizeProgressAction({
              organizationId: ORGANIZATION, actorUserId: PROFILE, actorAccessRole: 'member',
              authSessionId: AUTH_SESSION, executionId: EXECUTION,
              idempotencyKey: request.headers()['idempotency-key'], body: request.postDataJSON(),
            });
            ledger.cases.push({ contract: 'progress', action: normalized.action,
              kind: normalized.document.kind, valid: true });
            return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ success: true, data: {} }) });
          }
          if (url.pathname === `/api/v1/field-executions/${EXECUTION}/completion-actions` && request.method() === 'POST') {
            const normalized = normalizeCompletionAction({
              organizationId: ORGANIZATION, actorUserId: PROFILE, actorAccessRole: 'member',
              authSessionId: AUTH_SESSION, executionId: EXECUTION,
              idempotencyKey: request.headers()['idempotency-key'], body: request.postDataJSON(),
            });
            ledger.cases.push({ contract: 'completion', action: normalized.action, valid: true });
            if (normalized.action === 'propose_completion') {
              currentExecution = execution('completion_pending', 5, '9'.repeat(64));
              activeProposal = { id: COMPLETION_PROPOSAL, revision: 1, digest: '8'.repeat(64),
                recordKind: 'proposal', lifecycleAfter: 'completion_pending',
                decidedAt: '2026-09-07T13:14:00.000000Z' };
              completionRecords = [activeProposal];
              currentActions = ['withdraw_completion'];
              currentMaterialKinds = [];
              currentEquipmentKinds = [];
            } else if (normalized.action === 'withdraw_completion') {
              currentExecution = execution('in_progress', 6, '1'.repeat(64));
              activeProposal = null;
              completionRecords = completionRecords.concat({
                id: 'c1600000-0000-4000-8000-000000000007', revision: 1, digest: '0'.repeat(64),
                recordKind: 'withdrawal', lifecycleAfter: 'in_progress',
                decidedAt: '2026-09-07T13:15:00.000000Z',
              });
              currentActions = inProgressActions(false);
              currentMaterialKinds = ['consumed', 'returned', 'transferred', 'waste'];
              currentEquipmentKinds = ['check_out', 'use', 'check_in', 'reading', 'condition', 'fault',
                'downtime_start', 'downtime_end', 'maintenance'];
            }
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: currentExecution.data }) });
          }
          if (url.pathname === `/api/v1/field-executions/${EXECUTION}/transitions` && request.method() === 'POST') {
            if (conflictTransition) {
              conflictTransition = false;
              return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({
                success: false, error: { code: 'M23_EXECUTION_STALE', message: `Execution changed ${HOSTILE}` },
              }) });
            }
            const normalized = normalizeTransition({
              organizationId: ORGANIZATION, actorUserId: PROFILE, actorAccessRole: 'member',
              authSessionId: AUTH_SESSION, executionId: EXECUTION,
              idempotencyKey: request.headers()['idempotency-key'], body: request.postDataJSON(),
            });
            ledger.cases.push({ contract: 'lifecycle', action: normalized.action, valid: true });
            currentExecution = execution('in_progress', 4, 'f'.repeat(64));
            currentActions = inProgressActions(false);
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
        await page.waitForFunction(expected => document.body.dataset.workState === expected,
          partialEvidence ? 'partial-file' : 'ready');
        assert.strictEqual(await page.locator('html').getAttribute('data-theme'), theme);
        assert.match(await page.locator('#workTitle').textContent(), /Kitchen sink repair/);
        assert.match(await page.locator('#workCustomer').textContent(), /Jamie Carter/);
        assert.strictEqual(await page.locator('#workMain img:not(.logo-img):not(.mobile-logo), #workMain script').count(), 0);
        assert.strictEqual(await page.evaluate(() => window.m23Part9aCompromised), false);
        const geometry = await page.evaluate(() => {
          const title = document.getElementById('workTitle').getBoundingClientRect();
          const badge = document.getElementById('workStateBadge').getBoundingClientRect();
          const overview = document.querySelector('.work-overview-grid').getBoundingClientRect();
          return { viewport: innerWidth, document: document.documentElement.scrollWidth,
            main: document.getElementById('workMain').scrollWidth,
            devicePixelRatio,
            badge: { width: badge.width, height: badge.height },
            overviewBelowHeading: overview.top >= Math.max(title.bottom, badge.bottom) - 1,
            focusable: [...document.querySelectorAll('#workMain button,#workMain input,#workMain select,#workMain textarea,#workMain a')]
              .filter(node => !node.disabled && !node.hidden).every(node => node.getBoundingClientRect().height >= 44) };
        });
        assert.ok(geometry.document <= geometry.viewport + 1, JSON.stringify(geometry));
        assert.ok(geometry.main <= geometry.viewport + 1, JSON.stringify(geometry));
        assert.strictEqual(geometry.devicePixelRatio, profile.deviceScaleFactor, JSON.stringify(geometry));
        assert.ok(geometry.badge.width >= 72 && geometry.badge.height <= 54, JSON.stringify(geometry));
        assert.strictEqual(geometry.overviewBelowHeading, true, JSON.stringify(geometry));
        assert.strictEqual(geometry.focusable, true, JSON.stringify(geometry));
        if (partialEvidence) {
          assert.match(await page.locator('#workStatus').textContent(), /evidence source is unavailable/);
          assert.match(await page.locator('#workEvidenceContent').textContent(), /could not be loaded/);
          ledger.cases.push({ partialFile: true, missingEvidenceClaimedAsSuccess: false });
        }
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

          conflictTransition = true;
          await page.getByRole('button', { name: 'Pause work' }).click();
          await page.getByRole('dialog', { name: 'Confirm Pause work' })
            .getByRole('button', { name: 'Confirm Pause work' }).click();
          await page.waitForFunction(() => document.body.dataset.workState === 'conflict');
          assert.match(await page.locator('#workStateCopy').textContent(), /Reload/);
          assert.strictEqual(await page.evaluate(() => window.m23Part9aCompromised), false);
          await page.getByRole('button', { name: 'Reload current work' }).click();
          await page.waitForFunction(() => document.body.dataset.workState === 'ready');
          ledger.cases.push({ conflict: true, staleMutationClaimedAsSuccess: false, reloaded: true });

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

          await page.getByRole('button', { name: 'Respond to checklist' }).click();
          await page.locator('#workEvidenceResponse-observation').fill('The shutoff is accessible and labeled.');
          await page.locator('#workEvidenceResponse').getByRole('button', { name: 'Record checklist response' }).click();
          await page.getByRole('dialog', { name: 'Confirm Record checklist response' })
            .getByRole('button', { name: 'Confirm Record checklist response' }).click();
          await page.waitForFunction(() => document.querySelectorAll('#workEvidenceContent .work-record-list li').length === 2);
          assert.strictEqual(await page.getByRole('button', { name: 'Respond to checklist' }).count(), 0);

          await page.getByRole('button', { name: 'Add note' }).click();
          await page.locator('#workEvidenceNote-note').fill('Server-confirmed worker note.');
          await page.locator('#workEvidenceNote').getByRole('button', { name: 'Record field note' }).click();
          failToday = true;
          await page.getByRole('dialog', { name: 'Confirm Record field note' })
            .getByRole('button', { name: 'Confirm Record field note' }).click();
          await page.waitForFunction(() => document.body.dataset.workState === 'applied-but-refresh-failed');
          assert.match(await page.locator('#workStateCopy').textContent(), /acknowledged/);
          failToday = false;
          await page.getByRole('button', { name: 'Reload current work' }).click();
          await page.waitForFunction(() => document.body.dataset.workState === 'ready');
          ledger.cases.push({ appliedButRefreshFailed: true, falseFailureClaimed: false, recoveredByFreshRead: true });

          await page.getByRole('button', { name: 'Start timer' }).click();
          await page.locator('#workLaborStart').getByRole('button', { name: 'Record timer start' }).click();
          await page.getByRole('dialog', { name: 'Confirm Record timer start' })
            .getByRole('button', { name: 'Confirm Record timer start' }).click();
          await page.getByRole('button', { name: 'Stop timer' }).waitFor();
          await page.getByRole('button', { name: 'Stop timer' }).click();
          await page.getByRole('dialog', { name: 'Confirm Stop timer' })
            .getByRole('button', { name: 'Confirm Stop timer' }).click();
          await page.getByRole('button', { name: 'Start timer' }).waitFor();

          await page.getByRole('button', { name: 'Add manual time' }).click();
          await page.locator('#workLaborManual-observedStart').fill('2026-09-07T09:00');
          await page.locator('#workLaborManual-observedEnd').fill('2026-09-07T09:30');
          await page.locator('#workLaborManual').getByRole('button', { name: 'Record manual time' }).click();
          await page.getByRole('dialog', { name: 'Confirm Record manual time' })
            .getByRole('button', { name: 'Confirm Record manual time' }).click();
          await page.waitForFunction(() => document.getElementById('workStatus').textContent.includes('Record manual time was recorded'));

          await page.getByRole('button', { name: 'Record material' }).click();
          await page.locator('#workMaterialForm-movementKind').selectOption('transferred');
          assert.strictEqual(await page.locator('#workMaterialForm-locationKey').getAttribute('required'), '');
          assert.strictEqual(await page.locator('#workMaterialForm-destinationLocationKey').getAttribute('required'), '');
          assert.strictEqual(await page.locator('#workMaterialForm-adjustmentDirection').isHidden(), true);
          await page.locator('#workMaterialForm').getByRole('button', { name: 'Discard draft' }).click();
          assert.strictEqual(await page.locator('#workMaterialForm-movementKind').inputValue(), 'consumed');
          assert.strictEqual(await page.locator('#workMaterialForm-locationKey').getAttribute('required'), null);
          assert.strictEqual(await page.locator('#workMaterialForm-destinationLocationKey').getAttribute('required'), null);
          assert.strictEqual(await page.locator('#workMaterialForm-destinationLocationKey').isHidden(), true);
          await page.locator('#workMaterialForm-movementKind').selectOption('transferred');
          await page.locator('#workMaterialForm-itemKey').fill('copper.pipe');
          await page.locator('#workMaterialForm-description').fill('Transferred copper pipe to the current work location.');
          await page.locator('#workMaterialForm-quantity').fill('2');
          await page.locator('#workMaterialForm-locationKey').fill('truck.stock');
          await page.locator('#workMaterialForm-destinationLocationKey').fill('job.site');
          const materialValidity = await page.locator('#workMaterialForm').evaluate(form => ({
            valid: form.checkValidity(),
            controls: [...form.elements].filter(control => !control.checkValidity()).map(control => ({
              name: control.name, value: control.value, message: control.validationMessage,
            })),
          }));
          assert.strictEqual(materialValidity.valid, true, JSON.stringify(materialValidity));
          await page.locator('#workMaterialForm').getByRole('button', { name: 'Record material evidence' }).click();
          await page.getByRole('dialog', { name: 'Confirm Record material evidence' })
            .getByRole('button', { name: 'Confirm Record material evidence' }).click();
          await page.waitForFunction(() => document.getElementById('workStatus').textContent.includes('Record material evidence was recorded'));

          await page.getByRole('button', { name: 'Record equipment use' }).click();
          await page.locator('#workEquipmentForm-kind').selectOption('reading');
          assert.strictEqual(await page.locator('#workEquipmentForm-meterKey').getAttribute('required'), '');
          await page.locator('#workEquipmentForm').getByRole('button', { name: 'Discard draft' }).click();
          assert.strictEqual(await page.locator('#workEquipmentForm-kind').inputValue(), 'check_out');
          assert.strictEqual(await page.locator('#workEquipmentForm-meterKey').getAttribute('required'), null);
          assert.strictEqual(await page.locator('#workEquipmentForm-meterKey').isHidden(), true);
          await page.locator('#workEquipmentForm-kind').selectOption('reading');
          await page.locator('#workEquipmentForm-observedAt').fill('2026-09-07T09:35');
          await page.locator('#workEquipmentForm-meterKey').fill('engine.hours');
          await page.locator('#workEquipmentForm-reading').fill('128.5');
          await page.locator('#workEquipmentForm-unit').selectOption('hours');
          await page.locator('#workEquipmentForm-description').fill('Observed the service van engine-hour reading.');
          await page.locator('#workEquipmentForm').getByRole('button', { name: 'Record equipment evidence' }).click();
          await page.getByRole('dialog', { name: 'Confirm Record equipment evidence' })
            .getByRole('button', { name: 'Confirm Record equipment evidence' }).click();
          await page.waitForFunction(() => document.getElementById('workStatus').textContent.includes('Record equipment evidence was recorded'));

          await page.getByRole('button', { name: 'Record progress' }).click();
          await page.locator('#workProgressForm-description').fill('Completed one of two planned fixture replacements.');
          await page.locator('#workProgressForm-completed').fill('1');
          await page.locator('#workProgressForm-total').fill('2');
          await page.locator('#workProgressForm').getByRole('button', { name: 'Record progress' }).click();
          await page.getByRole('dialog', { name: 'Confirm Record progress' })
            .getByRole('button', { name: 'Confirm Record progress' }).click();
          await page.waitForFunction(() => document.getElementById('workStatus').textContent.includes('Record progress was recorded'));

          for (const issue of ['blocker', 'exception']) {
            const labelName = `Record ${issue}`;
            const formId = issue === 'blocker' ? '#workBlockerForm' : '#workExceptionForm';
            await page.getByRole('button', { name: labelName }).click();
            await page.locator(`${formId}-description`).fill(`Observed ${issue} requiring bounded follow-up.`);
            await page.locator(`${formId}-followUp`).fill(`Review the recorded ${issue} with the owner.`);
            await page.locator(formId).getByRole('button', { name: labelName }).click();
            await page.getByRole('dialog', { name: `Confirm ${labelName}` })
              .getByRole('button', { name: `Confirm ${labelName}` }).click();
            await page.waitForFunction(expected => document.getElementById('workStatus').textContent.includes(expected),
              `${labelName} was recorded`);
          }

          await page.getByRole('button', { name: 'Record field change' }).click();
          await page.locator('#workChangeForm-description').fill('The accessible shutoff location differs from the original note.');
          await page.locator('#workChangeForm-initiator').fill('Observed by the assigned worker.');
          await page.locator('#workChangeForm-affectedWork').fill('Fixture replacement sequencing.');
          await page.locator('#workChangeForm-scheduleImplications').fill('No schedule change observed.');
          await page.locator('#workChangeForm-resourceImplications').fill('No additional resource required.');
          await page.locator('#workChangeForm').getByRole('button', { name: 'Record field change' }).click();
          await page.getByRole('dialog', { name: 'Confirm Record field change' })
            .getByRole('button', { name: 'Confirm Record field change' }).click();
          await page.waitForFunction(() => document.getElementById('workStatus').textContent.includes('Record field change was recorded'));

          await page.getByRole('button', { name: 'Propose completion' }).click();
          await page.locator('#workCompletionForm').getByRole('button', { name: 'Propose completion' }).click();
          await page.getByRole('dialog', { name: 'Confirm Propose completion' })
            .getByRole('button', { name: 'Confirm Propose completion' }).click();
          await page.getByRole('button', { name: 'Withdraw completion proposal' }).waitFor();
          await page.getByRole('button', { name: 'Withdraw completion proposal' }).click();
          await page.getByRole('dialog', { name: 'Confirm Withdraw completion proposal' })
            .getByRole('button', { name: 'Confirm Withdraw completion proposal' }).click();
          await page.waitForFunction(() => document.querySelector('#workStateBadge').textContent.includes('In progress'));

          const validatedActions = ledger.cases.filter(item => item.valid).map(item => item.action);
          for (const action of ['start', 'start_timer', 'stop_timer', 'record_manual', 'record',
            'create_checklist', 'respond_item', 'record_progress', 'record_blocker',
            'record_exception', 'record_change', 'propose_completion', 'withdraw_completion']) {
            assert.ok(validatedActions.includes(action), `missing mounted contract exercise for ${action}`);
          }
        }
        await page.screenshot({ path: path.join(output, `${theme}-${profile.name}.png`), fullPage: true });
        ledger.cases.push({ theme, profile: profile.name, width, deviceScaleFactor: profile.deviceScaleFactor,
          zoomPercent: profile.zoomPercent, zoomEvidence: profile.zoomPercent ? 'device-metrics-equivalent' : null,
          geometry, ready: true, inertHostileText: true, reducedMotion: true });
        await context.close();
      }
    }

    currentExecution = execution('not_started', 1, '7'.repeat(64));
    currentActions = ['initialize'];
    currentMaterialKinds = [];
    currentEquipmentKinds = [];
    const initializeContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    await initializeContext.addCookies([{ name: 'northstar_csrf', value: 'browser-csrf-token', url: origin, sameSite: 'Lax' }]);
    let initialized = false;
    let initializationAttempts = 0;
    await initializeContext.route('**/*', route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== origin) return route.fulfill({ status: 204, body: '' });
      if (!url.pathname.startsWith('/api/')) return route.continue();
      ledger.requests.push({ method: request.method(), path: url.pathname,
        headers: request.headers(), body: request.postDataJSON ? request.postDataJSON() : null });
      if (url.pathname === '/api/v1/today') return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify(today(initialized ? currentExecution.data : null)),
      });
      if (url.pathname === `/api/v1/field-executions/appointments/${APPOINTMENT}` && request.method() === 'POST') {
        const normalized = normalizeInitialization({
          organizationId: ORGANIZATION, actorUserId: PROFILE, actorAccessRole: 'member',
          authSessionId: AUTH_SESSION, appointmentId: APPOINTMENT,
          idempotencyKey: request.headers()['idempotency-key'], body: request.postDataJSON(),
        });
        initializationAttempts += 1;
        initialized = true;
        currentActions = ['start'];
        ledger.cases.push({ contract: 'initialization', action: 'initialize', valid: true,
          expectedAssignmentRevision: normalized.expectedAssignmentRevision });
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(currentExecution) });
      }
      if (initialized) {
        const reads = emptyReads(currentExecution.data, []);
        const mapping = new Map([
          [`/api/v1/field-executions/${EXECUTION}`, currentExecution],
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
      }
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({
        success: false, error: { code: 'TEST_UNINVENTORIED', message: 'Uninventoried request.' },
      }) });
    });
    const initializePage = await initializeContext.newPage();
    await initializePage.goto(`${origin}/dashboard/work?appointmentId=${APPOINTMENT}`, { waitUntil: 'domcontentloaded' });
    await initializePage.waitForFunction(() => document.body.dataset.workState === 'empty', null, { timeout: 5000 });
    assert.match(await initializePage.locator('#workStateCopy').textContent(), /server-owned work record/);
    await initializePage.getByRole('button', { name: 'Open work record' }).click();
    const initializeConfirm = initializePage.getByRole('dialog', { name: 'Confirm Open work record' })
      .getByRole('button', { name: 'Confirm Open work record' });
    await initializeConfirm.evaluate(button => { button.click(); button.click(); });
    await initializePage.getByRole('button', { name: 'Start work' }).waitFor();
    assert.strictEqual(initializationAttempts, 1);
    const initializationRequest = ledger.requests.find(item =>
      item.method === 'POST' && item.path.endsWith(`/appointments/${APPOINTMENT}`));
    assert.deepStrictEqual(initializationRequest.body, {
      expectedAssignmentRevision: 7, expectedAssignmentDigest: ASSIGNMENT_DIGEST,
      reason: 'Open the current assigned work detail.',
    });
    assert.match(initializationRequest.headers['idempotency-key'], /^m23-part9a-initialize-/);
    assert.strictEqual(initializationRequest.headers['x-csrf-token'], 'browser-csrf-token');
    ledger.cases.push({ initializeFromEmpty: true, doubleSubmitSuppressed: true,
      currentExecutionReloaded: true });
    await initializeContext.close();

    currentExecution = execution('completed', 7, '6'.repeat(64));
    currentActions = [];
    currentMaterialKinds = [];
    currentEquipmentKinds = [];
    const readOnlyContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    await readOnlyContext.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.fulfill({ status: 204, body: '' });
      if (!url.pathname.startsWith('/api/')) return route.continue();
      if (url.pathname === '/api/v1/today') return route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(today(currentExecution.data)),
      });
      const reads = emptyReads(currentExecution.data, []);
      const mapping = new Map([
        [`/api/v1/field-executions/${EXECUTION}`, currentExecution],
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
    const readOnlyPage = await readOnlyContext.newPage();
    await readOnlyPage.goto(`${origin}/dashboard/work?appointmentId=${APPOINTMENT}&executionId=${EXECUTION}`,
      { waitUntil: 'domcontentloaded' });
    await readOnlyPage.waitForFunction(() => document.body.dataset.workState === 'read-only', null, { timeout: 5000 });
    assert.strictEqual(await readOnlyPage.locator('#workSections').isVisible(), true);
    assert.match(await readOnlyPage.locator('#workStateBadge').textContent(), /Completed/);
    assert.match(await readOnlyPage.locator('#workStatus').textContent(), /read-only/);
    assert.strictEqual(await readOnlyPage.locator('#workSections button').count(), 0);
    ledger.cases.push({ readOnly: true, terminalHistoryVisible: true, mutationCapabilityExposed: false });
    await readOnlyContext.close();

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

    currentExecution = execution('in_progress', 4, 'f'.repeat(64));
    currentActions = inProgressActions(false);
    currentMaterialKinds = ['consumed', 'returned', 'transferred', 'waste'];
    currentEquipmentKinds = ['check_out', 'use', 'check_in', 'reading', 'condition', 'fault',
      'downtime_start', 'downtime_end', 'maintenance'];
    const draftContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await draftContext.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.fulfill({ status: 204, body: '' });
      if (!url.pathname.startsWith('/api/')) return route.continue();
      if (url.pathname === '/api/v1/today') return route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(today(currentExecution.data)),
      });
      const reads = emptyReads(currentExecution.data, []);
      const mapping = new Map([
        [`/api/v1/field-executions/${EXECUTION}`, currentExecution],
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
    const draftPage = await draftContext.newPage();
    const draftUrl = `${origin}/dashboard/work?appointmentId=${APPOINTMENT}&executionId=${EXECUTION}`;
    await draftPage.goto(draftUrl, { waitUntil: 'domcontentloaded' });
    await draftPage.waitForFunction(() => document.body.dataset.workState === 'ready');
    await draftPage.getByRole('button', { name: 'Add note' }).click();
    await draftPage.locator('#workEvidenceNote-note').fill('Unsaved note for the prior execution revision.');

    const parallelPage = await draftContext.newPage();
    await parallelPage.goto(draftUrl, { waitUntil: 'domcontentloaded' });
    await parallelPage.waitForFunction(() => document.body.dataset.workState === 'ready');
    await parallelPage.getByRole('button', { name: 'Add note' }).click();
    assert.strictEqual(await parallelPage.locator('#workEvidenceNote-note').inputValue(), '');
    await parallelPage.goto(`${origin}/dashboard/today`, { waitUntil: 'domcontentloaded' });
    await parallelPage.waitForFunction(() => document.body.dataset.todayState === 'ready');
    await parallelPage.goBack({ waitUntil: 'domcontentloaded' });
    await parallelPage.waitForFunction(() => document.body.dataset.workState === 'ready');
    assert.match(await parallelPage.locator('#workTitle').textContent(), /Kitchen sink repair/);
    ledger.cases.push({ multipleTabs: true, draftSharedAcrossTabs: false, backForwardAuthorityReloaded: true });
    await parallelPage.close();

    currentExecution = execution('in_progress', 5, '2'.repeat(64));
    await draftPage.reload({ waitUntil: 'domcontentloaded' });
    await draftPage.waitForFunction(() => document.body.dataset.workState === 'ready');
    await draftPage.getByRole('button', { name: 'Add note' }).click();
    assert.strictEqual(await draftPage.locator('#workEvidenceNote-note').inputValue(), '');
    assert.deepStrictEqual(await draftPage.evaluate(() => Object.keys(sessionStorage)
      .filter(key => key.startsWith('northstar-work-draft:'))), []);
    ledger.cases.push({ executionRevisionChanged: true, staleDraftRestored: false });
    await draftContext.close();

    currentExecution = execution('in_progress', 4, 'f'.repeat(64));
    currentActions = inProgressActions(false);
    currentMaterialKinds = ['consumed', 'returned', 'transferred', 'waste'];
    currentEquipmentKinds = ['check_out', 'use', 'check_in', 'reading', 'condition', 'fault',
      'downtime_start', 'downtime_end', 'maintenance'];
    const expiredContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await expiredContext.addInitScript(() => { window.m23Part9aCompromised = false; });
    let sessionExpired = false;
    await expiredContext.route('**/*', route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== origin) return route.fulfill({ status: 204, body: '' });
      if (!url.pathname.startsWith('/api/')) return route.continue();
      if (request.method() === 'POST' && sessionExpired) return route.fulfill({
        status: 401, contentType: 'application/json', body: JSON.stringify({
          success: false, error: { code: 'SESSION_NOT_CURRENT', message: `Session expired ${HOSTILE}` },
        }),
      });
      if (url.pathname === '/api/v1/today') return route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(today(currentExecution.data)),
      });
      const reads = emptyReads(currentExecution.data, []);
      const mapping = new Map([
        [`/api/v1/field-executions/${EXECUTION}`, currentExecution],
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
    const expiredPage = await expiredContext.newPage();
    await expiredPage.goto(`${origin}/dashboard/work?appointmentId=${APPOINTMENT}&executionId=${EXECUTION}`,
      { waitUntil: 'domcontentloaded' });
    await expiredPage.waitForFunction(() => document.body.dataset.workState === 'ready');
    await expiredPage.getByRole('button', { name: 'Add note' }).click();
    await expiredPage.locator('#workEvidenceNote-note').fill('Device-local draft before session rotation.');
    sessionExpired = true;
    await expiredPage.getByRole('button', { name: 'Pause work' }).click();
    await expiredPage.getByRole('dialog', { name: 'Confirm Pause work' })
      .getByRole('button', { name: 'Confirm Pause work' }).click();
    await expiredPage.waitForFunction(() => document.body.dataset.workState === 'restricted');
    const restrictedText = await expiredPage.locator('#workMain').textContent();
    for (const priorTenantText of ['Kitchen sink repair', 'Jamie Carter', 'Alex Rivera', HOSTILE]) {
      assert.ok(!restrictedText.includes(priorTenantText), `restricted view retained ${priorTenantText}`);
    }
    assert.strictEqual(await expiredPage.evaluate(() => window.m23Part9aCompromised), false);
    assert.strictEqual(await expiredPage.locator('#workSections').isHidden(), true);
    assert.deepStrictEqual(await expiredPage.evaluate(() => Object.keys(sessionStorage)
      .filter(key => key.startsWith('northstar-work-draft:'))), []);
    ledger.cases.push({ sessionRotation: true, staleTenantPresentationRemoved: true,
      staleDraftRemoved: true, mutationCapabilityExposed: false });
    await expiredContext.close();

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
