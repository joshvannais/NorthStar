'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fixture = require('./pre-m23-p6-polaris-safe');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');

const option = name => {
  const entry = process.argv.find(value => value.startsWith(`--${name}=`));
  return entry ? entry.split('=').slice(1).join('=') : '';
};

const engine = option('browser');
const output = path.resolve(option('output'));
assert.ok(['chrome', 'webkit'].includes(engine), 'browser must be chrome or webkit');
assert.ok(!fs.existsSync(output), `output already exists: ${output}`);
fs.mkdirSync(output, { recursive: true });

async function main() {
  let server;
  let browser;
  const ledger = { engine, cases: [], externalRequests: [], pass: false };
  try {
    server = await fixture.listen();
    const origin = `http://127.0.0.1:${server.address().port}`;
    const runtime = resolveBrowserRuntime(engine);
    browser = await runtime.browserType.launch({ headless: true, executablePath: runtime.executablePath });

    for (const width of [390, 1440]) {
      for (const theme of ['light', 'dark']) {
        const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: theme });
        await context.addInitScript(value => localStorage.setItem('northstar-theme', value), theme);
        const page = await context.newPage();
        const state = {
          external: [], api: [], messageCalls: 0, messageKeys: [], unconfigured: false,
        };
        let submittedQuestion = null;
        page.on('request', request => {
          if (!request.url().endsWith('/api/v1/canonical/polaris/assistant/messages')) return;
          submittedQuestion = request.postDataJSON().message;
        });
        await fixture.installRoutes(page, state);

        await page.goto(`${origin}/dashboard/business-profile`, { waitUntil: 'domcontentloaded' });
        const profileCopy = page.getByText(
          'Customer-financial documents remain unavailable until a later accepted Mission 27 release.',
          { exact: false }
        );
        await profileCopy.waitFor({ state: 'visible' });
        assert.equal(await page.getByText(/used across estimates, invoices, communications/i).count(), 0);
        await profileCopy.screenshot({ path: path.join(output, `${engine}-${width}-${theme}-profile.png`) });

        await page.goto(`${origin}/dashboard/polaris`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !document.getElementById('polarisSendBtn').disabled);
        const prompt = page.getByRole('button', {
          name: 'Ask: What estimate value needs review this week?', exact: true,
        });
        await prompt.waitFor({ state: 'visible' });
        assert.equal(await prompt.isEnabled(), true);
        await prompt.focus();
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')),
          'Ask: What estimate value needs review this week?');
        await page.keyboard.press('Enter');
        for (let attempt = 0; attempt < 100 && state.messageCalls !== 1; attempt += 1) {
          await page.waitForTimeout(10);
        }
        assert.ok(state.messageCalls === 0 || state.messageCalls === 1);
        if (state.messageCalls === 1) {
          assert.equal(submittedQuestion, 'What estimate value needs review this week?');
        } else {
          assert.equal(await page.getByRole('listitem', { name: 'Your message' })
            .last().locator('.polaris-chat-text').innerText(),
          'What estimate value needs review this week?');
        }
        assert.equal(await page.getByText('What revenue is at risk this week?', { exact: true }).count(), 0);
        await page.screenshot({
          path: path.join(output, `${engine}-${width}-${theme}-polaris.png`),
          fullPage: true,
          animations: 'disabled',
        });
        ledger.cases.push({
          width, theme, profileCopy: true, promptKeyboardActivation: true,
          submitted: state.messageCalls === 1,
        });
        assert.deepEqual(
          state.api.filter(entry => /\/retell\/|\/integrations\/jobber(?:\/|$)/.test(entry.path)),
          []
        );
        ledger.externalRequests.push(...state.external);
        await context.close();
      }
    }

    assert.deepEqual(ledger.externalRequests, []);
    ledger.pass = true;
  } finally {
    if (browser) await browser.close();
    await fixture.closeServer(server);
    fs.writeFileSync(path.join(output, 'ledger.json'), JSON.stringify(ledger, null, 2));
  }
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
