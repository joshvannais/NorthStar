'use strict';
// Local trusted response fixtures only; no provider or persistence requests.
process.env.NODE_ENV = 'test';
process.env.AUTH_ACCESS_SECRET = 'm24-fixed-copy-local-fixture-secret-only';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fixture = require('./pre-m23-p6-polaris-safe');
const trusted = require('../../public/js/polaris-trusted-presentation');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');
const arg = name => process.argv.find(value => value.startsWith('--' + name + '=')).split('=').slice(1).join('=');
const engine = arg('browser'), output = path.resolve(arg('output'));
assert.ok(!fs.existsSync(output)); fs.mkdirSync(output, { recursive: true });
async function main() {
  let server, browser;
  const ledger = { engine, fixture: 'local trusted fixed responses; no live provider', cases: [] };
  try {
    server = await fixture.listen();
    const origin = 'http://127.0.0.1:' + server.address().port;
    const runtime = resolveBrowserRuntime(engine);
    browser = await runtime.browserType.launch({ headless: true, executablePath: runtime.executablePath });
    for (const width of [390, 1440]) for (const theme of ['light', 'dark']) {
      for (const intent of ['none', 'canonical_overview', 'evidence_review', 'unknowns_review', 'business_operations_reference', 'unavailable']) {
        const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: theme });
        await context.addInitScript(value => localStorage.setItem('northstar-theme', value), theme);
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const state = { external: [], api: [], messageCalls: 0, messageKeys: [], unconfigured: false };
        await fixture.installRoutes(page, state);
        let expected, messages = 0;
        await page.route('**/assistant/messages', route => {
          messages++;
          const body = route.request().postDataJSON();
          const response = fixture.messageResponse(body, false);
          if (intent === 'none') { response.selected = null; response.cards = []; }
          const projection = trusted.projectTrustedDisplay(response.cards, response.selected,
            ['none', 'unavailable'].includes(intent) ? 'canonical_overview' : intent);
          response.answer = projection.answer; response.cards = projection.cards;
          expected = response.answer.text;
          if (intent === 'none') {
            assert.equal(expected, 'Select one customer, lead, or work record to review its saved details.');
            // Existing page passes a null backing and safely rejects no-selection messages.
            expected = 'Polaris could not confirm this answer. Refresh the selected record and try again. No data was changed.';
          }
          if (intent === 'unavailable') {
            // Benign incomplete response: ordinary failure must not expose diagnostic details.
            delete response.answer;
            response.diagnostic = 'local fixture diagnostic';
            expected = 'Polaris could not confirm this answer. Refresh the selected record and try again. No data was changed.';
          }
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: response }) });
        });
        await page.goto(origin + '/dashboard/polaris' + (intent === 'none' ? '' : '?kind=lead&id=' + fixture.LEAD));
        if (intent !== 'none') await page.locator('.polaris-native-card').first().waitFor();
        await page.waitForFunction(() => !document.getElementById('polarisSendBtn').disabled);
        await fixture.submitSelectedQuestion(page, 'Review the saved details.');
        await page.waitForFunction(() => document.querySelectorAll('.polaris-chat-text').length > 1);
        await page.getByText(expected, { exact: true }).last().waitFor();
        const text = await page.locator('.polaris-chat-text').last().innerText();
        assert.equal(text, expected);
        assert.doesNotMatch(text, /canonical|structured|API|SQL|documentation context|local fixture diagnostic/);
        assert.equal(messages, 1);
        assert.equal(await page.getByRole('button', { name: 'Retry this message' }).count(), 0);
        assert.deepEqual(errors, []);
        const file = engine + '-' + width + '-' + theme + '-' + intent + '.png';
        await page.screenshot({ path: path.join(output, file), fullPage: true });
        ledger.cases.push({ width, theme, intent, text, screenshot: file, messages, mocked: true });
        await context.close();
      }
    }
    ledger.pass = true;
  } finally {
    if (browser) await browser.close();
    await fixture.closeServer(server);
    fs.writeFileSync(path.join(output, 'ledger.json'), JSON.stringify(ledger, null, 2));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
