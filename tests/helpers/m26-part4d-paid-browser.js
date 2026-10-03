'use strict';

const { resolveBrowserRuntime } = require('./playwright-runtime');

async function openPaidResearchBrowser(fixture, actorName = 'owner') {
  const server = fixture.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const runtime = resolveBrowserRuntime('chrome');
  const browser = await runtime.browserType.launch({ headless: true,
    executablePath: runtime.executablePath });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 },
    reducedMotion: 'reduce' });
  await context.addInitScript(() => localStorage.setItem('northstar-quick-start-seen', 'true'));
  await context.addCookies(Object.entries(fixture.actors[actorName].session.cookies)
    .map(([name, value]) => ({ name, value, url: origin, sameSite: 'Lax',
      httpOnly: name !== 'northstar_csrf' })));
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  const responses = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', async response => {
    if (!response.url().includes('/api/v1/forecast/')) return;
    const request = response.request();
    const text = await response.text().catch(() => '');
    let body = null;
    try { body = JSON.parse(text); } catch (_error) { body = text; }
    responses.push({ status: response.status(), url: response.url(), method: request.method(),
      headers: request.headers(), postData: request.postData(), body });
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()} ${text}`);
  });
  await page.goto(`${origin}/dashboard`);
  await page.waitForLoadState('networkidle');
  if (await page.locator('#northstarQuickStartDialog[open]').count()) await page.keyboard.press('Escape');
  await page.locator('#commandCenterDemandState').getByText('Research only').waitFor();
  const setup = page.locator('.command-center-research-setup');
  if (!(await setup.getAttribute('open'))) await setup.locator(':scope > summary').click();
  return {
    page,
    errors,
    responses,
    async action(name, expectedText, slot = 'Setup') {
      await page.locator(`[data-demand-research-action="${name}"]`).click();
      if (expectedText) {
        try {
          await page.locator(`#commandCenterResearch${slot}`).getByText(expectedText).waitFor({ timeout: 5000 });
        } catch (error) {
          const rendered = await page.locator(`#commandCenterResearch${slot}`).innerText()
            .catch(() => '(status unavailable)');
          throw new Error(`${name} did not render ${String(expectedText)}; status was: ${rendered}\n` +
            `${errors.join('\n')}\n${error.message}`);
        }
      }
    },
    async close() {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
      await new Promise(resolve => server.close(resolve));
      if (errors.length) throw new Error(`Part 4D browser errors:\n${errors.join('\n')}`);
    },
  };
}

module.exports = { openPaidResearchBrowser };
