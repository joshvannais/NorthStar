'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { benignFixture } = require('./m23-part9a-worker-operational-experience');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');
const { normalizeCompletionAction } = require('../../src/completion/contract');
const { normalizeEvidenceAction } = require('../../src/fieldEvidence/contract');
const EXECUTION = 'e1600000-0000-4000-8000-000000000001';
const APPOINTMENT = 'd1600000-0000-4000-8000-000000000001';
const ACTOR = { organizationId: 'a1600000-0000-4000-8000-000000000001', actorUserId: 'b1600000-0000-4000-8000-000000000002', actorAccessRole: 'member', authSessionId: 'c1600000-0000-4000-8000-000000000002', executionId: EXECUTION };
const eid = n => `c2600000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function observation(n, previous) { return { id: eid(n), rootId: previous ? previous.rootId : eid(n), previousRecordId: previous ? previous.id : null, type: 'observation', revision: previous ? previous.revision + 1 : 1, digest: n.toString(16).padStart(64, '0'), executionId: EXECUTION, document: { kind: 'observation', observationClass: 'inspection', resultType: 'pass', observation: `Routine inspection ${n} complete.`, measurement: null, exception: null, supportingEvidenceIds: [] }, decidedAt: '2026-09-08T03:00:00.000000Z' }; }
function pageEnvelope(records, total = records.length, nextCursor = null) { return { success: true, data: records, returned: records.length, total, truncated: nextCursor !== null, nextCursor }; }
async function main() {
  const selected = (process.argv.find(v => v.startsWith('--browser=')) || '--browser=chrome').split('=')[1];
  const outputArgument = process.argv.find(v => v.startsWith('--output=')); assert(outputArgument, 'Explicit non-overwriting output directory required');
  const output = path.resolve(outputArgument.slice(9)); fs.mkdirSync(output, { recursive: true });
  assert(!fs.existsSync(path.join(output, 'results.json')), 'Evidence already exists');
  const baseline = process.argv.includes('--baseline');
  const baselineHead = 'c22de9d053b65814fd59ae471e97d9eea01e3da3';
  const baselineFiles = {};
  if (baseline) {
    const git = 'C:/Users/joshv/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/git/cmd/git.exe';
    for (const name of ['field-execution-client.js', 'work-page.js']) baselineFiles['/js/' + name] =
      execFileSync(git, ['show', baselineHead + ':public/js/' + name], { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8' });
  }
  const { app } = require('../../src/server'); const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const runtime = resolveBrowserRuntime(selected); const browser = await runtime.browserType.launch({ executablePath: runtime.executablePath, headless: true });
  const report = { browser: selected, version: browser.version(), source: baseline ? baselineHead : 'current correction working tree', fixture: 'Ordinary synthetic field text only; all legacy markup fragments replaced before rendering.', cases: [], tabCopies: [], externalRequests: [], pageErrors: [], posts: [] };
  let scenario = 'empty'; let records = []; let evidenceCalls = 0;
  async function context(width = 1440, theme = 'light') {
    const ctx = await browser.newContext({ viewport: { width, height: width === 1440 ? 900 : 844 }, reducedMotion: 'reduce' });
    await ctx.addInitScript(value => { if (location.protocol === 'http:') localStorage.setItem('northstar-theme', value); }, theme);
    await ctx.addCookies([{ name: 'northstar_csrf', value: 'browser-csrf-token', url: origin, sameSite: 'Lax' }]);
    ctx.on('page', p => p.on('pageerror', e => report.pageErrors.push(e.message)));
    await ctx.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) { report.externalRequests.push(url.origin); return route.abort(); }
      if (baselineFiles[url.pathname]) return route.fulfill({ contentType: 'application/javascript', body: baselineFiles[url.pathname] });
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const respond = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (request.method() === 'POST') {
        const body = request.postDataJSON(); const key = request.headers()['idempotency-key'];
        if (url.pathname.endsWith('/completion-actions')) normalizeCompletionAction({ ...ACTOR, idempotencyKey: key, body });
        else if (url.pathname.endsWith('/field-evidence-actions')) normalizeEvidenceAction({ ...ACTOR, idempotencyKey: key, body });
        else throw new Error('Unexpected mutation in focused functional check');
        report.posts.push({ path: url.pathname, body, key });
        return respond({ success: false, error: { code: 'TEMPORARY_TEST_UNAVAILABLE', message: 'This local check leaves the request unconfirmed.' } }, 503);
      }
      const fixture = benignFixture(records);
      assert(!/[<>]/.test(JSON.stringify(fixture)), 'Only ordinary benign fixture text is permitted');
      if (url.pathname === '/api/v1/today') return respond(fixture.today);
      if (url.pathname.endsWith('/field-evidence')) {
        evidenceCalls++;
        if (scenario === 'unavailable') return respond({ success: false, error: { code: 'M23_FIELD_EVIDENCE_UNAVAILABLE', message: 'Field evidence is temporarily unavailable.' } }, 503);
        if (scenario === 'pagination') return respond(url.searchParams.has('cursor') ? pageEnvelope([observation(2)], 2) : pageEnvelope([observation(1)], 2, 'ordinary-next-page'));
        if (scenario === 'pagination-unavailable' && url.searchParams.has('cursor')) return respond({ success: false, error: { code: 'M23_FIELD_EVIDENCE_UNAVAILABLE' } }, 503);
        if (scenario === 'pagination-unavailable') return respond(pageEnvelope([observation(1)], 2, 'ordinary-next-page'));
        return respond(pageEnvelope(records));
      }
      const table = { [`/api/v1/field-executions/${EXECUTION}`]: fixture.execution, [`/api/v1/field-executions/${EXECUTION}/labor`]: fixture.reads.labor, [`/api/v1/field-executions/${EXECUTION}/materials`]: fixture.reads.materials, [`/api/equipment/executions/${EXECUTION}`]: fixture.reads.equipment, '/api/equipment/catalogue': fixture.reads.catalogue, [`/api/v1/field-executions/${EXECUTION}/progress`]: fixture.reads.progress, [`/api/v1/field-executions/${EXECUTION}/completion`]: fixture.reads.completion };
      return respond(table[url.pathname] || { success: false }, table[url.pathname] ? 200 : 404);
    }); return ctx;
  }
  const workUrl = `${origin}/dashboard/work?appointmentId=${APPOINTMENT}&executionId=${EXECUTION}`;
  async function loaded(p) { await p.waitForFunction(() => ['ready', 'partial-file'].includes(document.body.dataset.workState)); }
  async function open(ctx) { const p = await ctx.newPage(); await p.goto(workUrl); await loaded(p); return p; }
  async function propose(p) { await p.getByRole('button', { name: 'Propose completion', exact: true }).first().click(); await p.locator('#workCompletionForm').getByRole('button', { name: 'Propose completion', exact: true }).click(); }
  async function confirm(p, label) { await p.getByRole('dialog').getByRole('button', { name: `Confirm ${label}`, exact: true }).click(); await p.waitForFunction(() => document.body.dataset.workState === 'retry'); }
  async function note(p, value) { await p.getByRole('button', { name: 'Add note', exact: true }).click(); if (value !== undefined) await p.locator('#workEvidenceNote-note').fill(value); }
  async function sendNote(p) { await p.locator('#workEvidenceNote').getByRole('button', { name: 'Record field note', exact: true }).click(); await confirm(p, 'Record field note'); return report.posts.at(-1).key; }
  async function check(name, fn) { try { await fn(); report.cases.push({ name, passed: true }); } catch(error) { report.cases.push({ name, passed: false, error: error.message }); } }
  try {
    for (const mode of ['unavailable', 'pagination-unavailable', 'over-limit']) await check(`F1 ${mode} never becomes an automatic empty/partial selection`, async () => {
      scenario = mode; records = mode === 'over-limit' ? Array.from({ length: 21 }, (_, i) => observation(i + 1)) : [];
      const ctx = await context(); try { const p = await open(ctx); assert.equal(await p.getByRole('button', { name: 'Propose completion', exact: true }).count(), 0); assert.match(await p.locator('#workCompletionContent').innerText(), /evidence|inspection/i); } finally { await ctx.close(); }
    });
    await check('F1 complete paginated evidence includes every current inspection', async () => {
      scenario = 'pagination'; records = []; evidenceCalls = 0; const ctx = await context();
      try { const p = await open(ctx); await propose(p); await confirm(p, 'Propose completion'); assert.deepEqual(report.posts.at(-1).body.gateRequirements.inspections.map(p => p.id).sort(), [eid(1), eid(2)]); assert(evidenceCalls >= 2); } finally { await ctx.close(); }
    });
    await check('F2 refreshed corrected inspection selects successor only', async () => {
      scenario = 'normal'; const first = observation(1); records = [observation(2, first), first]; const ctx = await context();
      try { const p = await open(ctx); await propose(p); await confirm(p, 'Propose completion'); assert.deepEqual(report.posts.at(-1).body.gateRequirements.inspections, [{ id: eid(2), revision: 2, digest: observation(2, first).digest }]); } finally { await ctx.close(); }
    });
    await check('F1 evidence changed since presentation requires another review', async () => {
      scenario = 'normal'; records = [observation(1)]; const ctx = await context();
      try { const p = await open(ctx); records = [observation(2), observation(1)]; const before = report.posts.length; await propose(p); await p.waitForTimeout(150); assert.equal(await p.getByRole('dialog').isVisible(), false); assert.equal(report.posts.length, before); assert.match(await p.locator('#workCompletionContent').innerText(), /changed|review/i); assert.match(await p.locator('#workStatus').innerText(), /changed|review/i); assert.equal(await p.evaluate(() => document.activeElement.id), 'workCompletionContent'); } finally { await ctx.close(); }
    });
    await check('F3 same-tab reload retains draft and persisted retry identity', async () => {
      scenario = 'empty'; records = []; const ctx = await context();
      try { const p = await open(ctx); await note(p, 'Same-tab unsaved note.'); const key = await sendNote(p); await p.reload(); await loaded(p); await note(p); assert.equal(await p.locator('#workEvidenceNote-note').inputValue(), 'Same-tab unsaved note.'); assert.equal(await sendNote(p), key); } finally { await ctx.close(); }
    });
    await check('F3 same-tab back-forward retains draft and retry identity after reacquiring ownership', async () => {
      scenario = 'empty'; records = []; const ctx = await context();
      try { const p = await open(ctx); await note(p, 'Return to this same-tab draft.'); const key = await sendNote(p); await p.goto(origin + '/dashboard/today'); await p.goBack(); await loaded(p); await note(p); assert.equal(await p.locator('#workEvidenceNote-note').inputValue(), 'Return to this same-tab draft.'); assert.equal(await sendNote(p), key); } finally { await ctx.close(); }
    });
    for (const copy of ['opener', 'copied-sessionStorage']) await check(`F3 ${copy} owns separate drafts and retry identities`, async () => {
      scenario = 'empty'; records = []; const ctx = await context();
      try {
        const original = await open(ctx); await note(original, 'Unsaved note belongs to the original tab.'); const originalKey = await sendNote(original); await original.reload(); await loaded(original); await note(original);
        let duplicate;
        if (copy === 'opener') { const waiting = ctx.waitForEvent('page'); await original.evaluate(url => window.open(url, '_blank'), workUrl); duplicate = await waiting; await duplicate.waitForLoadState(); }
        else { const storage = await original.evaluate(() => Object.fromEntries(Object.entries(sessionStorage))); duplicate = await ctx.newPage(); await duplicate.addInitScript(items => { if (!sessionStorage.getItem('functional-copy-seeded')) { for(const [key, value] of Object.entries(items)) sessionStorage.setItem(key, value); sessionStorage.setItem('functional-copy-seeded', 'true'); } }, storage); await duplicate.goto(workUrl); }
        await loaded(duplicate); await note(duplicate); const copiedDraft = await duplicate.locator('#workEvidenceNote-note').inputValue(); await duplicate.locator('#workEvidenceNote-note').fill('Independent tab note.'); const duplicateKey = await sendNote(duplicate);
        report.tabCopies.push({ copy, copiedDraft, draftIsolated: copiedDraft === '', retryIdentityIsolated: duplicateKey !== originalKey });
        assert.equal(await original.locator('#workEvidenceNote-note').inputValue(), 'Unsaved note belongs to the original tab.'); assert.equal(copiedDraft, ''); assert.notEqual(duplicateKey, originalKey);
      } finally { await ctx.close(); }
    });
    for (const width of [1440, 390, 320]) for (const theme of ['light', 'dark']) await check(`presentation ${width} ${theme}`, async () => {
      scenario = 'unavailable'; records = []; const ctx = await context(width, theme);
      try { const p = await open(ctx); await p.locator('#workCompletion').scrollIntoViewIfNeeded(); assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false); await p.screenshot({ path: path.join(output, `${width}-${theme}.png`) }); assert.equal(await p.locator('#workStatus').getAttribute('role'), 'status'); await p.keyboard.press('Tab'); assert(await p.evaluate(() => document.activeElement !== document.body)); } finally { await ctx.close(); }
    });
    assert.equal(report.externalRequests.length, 0); assert.equal(report.pageErrors.length, 0); report.passed = report.cases.every(c => c.passed);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); }
  console.log(JSON.stringify({ browser: selected, passed: report.passed, passedCases: report.cases.filter(c => c.passed).length, cases: report.cases.length, failures: report.cases.filter(c => !c.passed) }, null, 2));
  if (!report.passed) process.exitCode = 1;
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
