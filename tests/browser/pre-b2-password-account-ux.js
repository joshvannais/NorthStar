'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');

const PUBLIC_ROOT = path.resolve(__dirname, '../../public');
const VIEWPORTS = [
  { label: '1440x900', width: 1440, height: 900 },
  { label: '390x844', width: 390, height: 844 },
];
const THEMES = ['light', 'dark'];

function contentType(file) {
  return ({
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
  })[path.extname(file)] || 'application/octet-stream';
}

function publicFile(pathname) {
  const pages = {
    '/login': 'login.html',
    '/signup': 'signup.html',
    '/reset-password': 'reset-password.html',
  };
  const relative = pages[pathname] || (
    /^\/(?:css|js|assets)\/[A-Za-z0-9._/-]+$/.test(pathname) ? pathname.slice(1) : ''
  );
  if (!relative) return null;
  const file = path.resolve(PUBLIC_ROOT, relative);
  return file.startsWith(`${PUBLIC_ROOT}${path.sep}`) ? file : null;
}

function json(response, status, body) {
  const encoded = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': encoded.length,
    'Cache-Control': 'no-store',
  });
  response.end(encoded);
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let raw = '';
    request.on('data', chunk => { raw += chunk; });
    request.on('error', reject);
    request.on('end', () => {
      try { resolve(JSON.parse(raw)); } catch (error) { reject(error); }
    });
  });
}

function readRaw(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', chunk => { chunks.push(chunk); });
    request.on('error', reject);
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

async function createLoopbackServer() {
  const state = { signup: [], reset: [], login: [], fallback: [] };
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (request.method === 'POST' && url.pathname === '/api/auth/signup') {
      state.signup.push(await readJson(request));
      return json(response, 202, {
        success: true,
        code: 'verification_required',
        message: 'If signup was accepted, check your email for a verification link.',
      });
    }
    if (request.method === 'POST' && url.pathname === '/api/auth/reset-password') {
      state.reset.push(await readJson(request));
      return json(response, 200, { success: true, code: 'password_reset' });
    }
    if (request.method === 'POST' && url.pathname === '/api/auth/login') {
      state.login.push(await readJson(request));
      return json(response, 401, { error: 'Bounded login fixture' });
    }
    if (request.method === 'POST' && url.pathname === '/reset-password') {
      state.fallback.push({
        url: request.url,
        referer: request.headers.referer || '',
        body: await readRaw(request),
      });
      response.writeHead(405, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      response.end('Reset fallback disabled');
      return;
    }
    const file = request.method === 'GET' ? publicFile(url.pathname) : null;
    if (file && fs.existsSync(file) && fs.statSync(file).isFile()) {
      response.writeHead(200, {
        'Content-Type': contentType(file),
        'Referrer-Policy': 'no-referrer',
      });
      fs.createReadStream(file).pipe(response);
      return;
    }
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    origin: `http://127.0.0.1:${address.port}`,
    state,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

function syntheticPassword(length) {
  return crypto.randomBytes(length).toString('base64url').slice(0, length);
}

async function assertControls(page, expectedNames) {
  const buttons = page.locator('[data-password-toggle]');
  const count = await buttons.count();
  assert.strictEqual(count, expectedNames.length, 'mounted password page has the expected visibility controls');
  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    const expectedName = expectedNames[index];
    const target = await button.getAttribute('aria-controls');
    const input = page.locator(`#${target}`);
    const originalValue = await input.inputValue();
    if (originalValue.length < 2) await input.fill('Access8!');
    assert.strictEqual(await button.getAttribute('type'), 'button');
    assert.strictEqual(await button.getAttribute('aria-pressed'), 'false');
    assert.strictEqual(await button.getAttribute('aria-label'), expectedName);
    assert.strictEqual(await page.getByRole('button', { name: expectedName, pressed: false, exact: true }).count(), 1);
    assert.strictEqual(await input.getAttribute('type'), 'password');
    await input.focus();
    await input.evaluate(element => element.setSelectionRange(2, 2));
    await button.click();
    assert.strictEqual(await input.getAttribute('type'), 'text');
    assert.strictEqual(await button.getAttribute('aria-pressed'), 'true');
    assert.strictEqual(await button.getAttribute('aria-label'), expectedName);
    assert.strictEqual(await page.getByRole('button', { name: expectedName, pressed: true, exact: true }).count(), 1);
    await page.waitForFunction(id => {
      const element = document.getElementById(id);
      return document.activeElement === element && element.selectionStart === 2 && element.selectionEnd === 2;
    }, target);
    assert.strictEqual(await input.evaluate(element => document.activeElement === element), true);
    assert.deepStrictEqual(await input.evaluate(element => [element.selectionStart, element.selectionEnd]), [2, 2]);
    await button.click();
    assert.strictEqual(await input.getAttribute('type'), 'password');
    assert.strictEqual(await button.getAttribute('aria-pressed'), 'false');
    assert.strictEqual(await button.getAttribute('aria-label'), expectedName);
    assert.strictEqual(await input.evaluate(element => document.activeElement === element), true);

    await button.focus();
    const keyboardValue = await input.inputValue();
    await button.press('Space');
    assert.strictEqual(await input.getAttribute('type'), 'text');
    assert.strictEqual(await button.getAttribute('aria-pressed'), 'true');
    assert.strictEqual(await button.evaluate(element => document.activeElement === element), true);
    assert.strictEqual(await input.inputValue(), keyboardValue, 'Space never alters the password value');
    await button.press('Space');
    assert.strictEqual(await input.getAttribute('type'), 'password');
    assert.strictEqual(await button.getAttribute('aria-pressed'), 'false');
    assert.strictEqual(await button.evaluate(element => document.activeElement === element), true);
    await button.press('Enter');
    assert.strictEqual(await input.getAttribute('type'), 'text');
    assert.strictEqual(await button.getAttribute('aria-pressed'), 'true');
    assert.strictEqual(await button.evaluate(element => document.activeElement === element), true);
    assert.strictEqual(await input.inputValue(), keyboardValue);
    await button.press('Enter');
    assert.strictEqual(await input.getAttribute('type'), 'password');
    assert.strictEqual(await button.getAttribute('aria-pressed'), 'false');
    assert.strictEqual(await button.evaluate(element => document.activeElement === element), true);
    await input.fill(originalValue);
  }
}

async function assertLayout(page) {
  const layout = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('.password-input-shell > input'));
    const originals = inputs.map(input => input.value);
    inputs.forEach(input => { input.value = 'Autofill-like-long-value-'.repeat(8).slice(0, 128); });
    const result = {
      theme: document.documentElement.getAttribute('data-theme'),
      noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth,
      controls: Array.from(document.querySelectorAll('[data-password-toggle]')).map(button => {
      const bounds = button.getBoundingClientRect();
      const shellElement = button.closest('.password-input-shell');
      const shell = shellElement.getBoundingClientRect();
      const input = shellElement.querySelector('input');
      const inputBounds = input.getBoundingClientRect();
      const style = getComputedStyle(input);
      const paddingEnd = Number.parseFloat(style.paddingInlineEnd);
      const borderEnd = Number.parseFloat(style.borderInlineEndWidth || style.borderRightWidth);
      const textRegionEnd = inputBounds.right - paddingEnd - borderEnd;
      return {
        visible: bounds.width > 0 && bounds.height > 0,
        insideShell: bounds.left >= shell.left && bounds.right <= shell.right &&
          bounds.top >= shell.top && bounds.bottom <= shell.bottom,
        paddingEnd,
        buttonWidth: bounds.width,
        textClearance: bounds.left - textRegionEnd,
      };
      }),
    };
    inputs.forEach((input, index) => { input.value = originals[index]; });
    return result;
  });
  assert.strictEqual(layout.noHorizontalOverflow, true);
  assert.ok(['light', 'dark'].includes(layout.theme));
  assert.ok(layout.controls.every(control => control.visible && control.insideShell));
  assert.ok(layout.controls.every(control => control.paddingEnd >= control.buttonWidth + 16));
  assert.ok(layout.controls.every(control => control.textClearance >= 4), 'input text region clears the visibility control');
}

async function fillSignupIdentity(page) {
  await page.fill('#name', 'Bounded Account Owner');
  await page.fill('#businessName', 'Bounded Account Company');
  await page.fill('#phone', '8605550108');
  await page.fill('#email', 'bounded-account@example.test');
}

function requestPath(request) {
  try { return new URL(request.url()).pathname; } catch (_error) { return ''; }
}

function isApiPost(request, pathname) {
  return request.method() === 'POST' && requestPath(request) === pathname;
}

async function installRequestAudit(context, mounted) {
  const audit = {
    apiPosts: [],
    attemptedEscapes: [],
    firstPartyFailures: [],
    firstPartyResponses: [],
    requests: [],
  };
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== mounted.origin) {
      audit.attemptedEscapes.push({ method: request.method(), url: request.url() });
      await route.abort('blockedbyclient');
      return;
    }
    if (url.origin === mounted.origin) {
      const record = {
        method: request.method(),
        path: url.pathname,
        url: request.url(),
        referer: request.headers().referer || '',
        resourceType: request.resourceType(),
      };
      audit.requests.push(record);
      if (request.method() === 'POST' && url.pathname.startsWith('/api/auth/')) {
        let body = request.postData();
        try { body = request.postDataJSON(); } catch (_error) {}
        audit.apiPosts.push({ ...record, body });
      }
    }
    await route.continue();
  });
  context.on('response', response => {
    const request = response.request();
    const url = new URL(response.url());
    if (url.origin !== mounted.origin) return;
    const record = { method: request.method(), path: url.pathname, status: response.status() };
    audit.firstPartyResponses.push(record);
    const expectedFallback = record.method === 'POST' && record.path === '/reset-password' && record.status === 405;
    if (record.status >= 400 && !expectedFallback) audit.firstPartyFailures.push(record);
  });
  context.on('requestfailed', request => {
    const url = new URL(request.url());
    if (url.origin === mounted.origin) {
      audit.firstPartyFailures.push({
        method: request.method(), path: url.pathname, failure: request.failure() && request.failure().errorText,
      });
    }
  });
  return audit;
}

function apiPostCount(audit, pathname) {
  return audit.apiPosts.filter(record => record.path === pathname).length;
}

async function assertNoApiPost(page, audit, pathname, action, label) {
  const before = apiPostCount(audit, pathname);
  const pending = page.waitForRequest(request => isApiPost(request, pathname), { timeout: 200 });
  await action();
  let observed = null;
  try {
    observed = await pending;
  } catch (error) {
    if (!/Timeout/i.test(String(error && (error.name || error.message)))) throw error;
  }
  assert.strictEqual(observed, null, `${label} emits no ${pathname} request event`);
  assert.strictEqual(apiPostCount(audit, pathname), before, `${label} preserves exact ${pathname} cardinality`);
}

async function assertOneApiPost(page, audit, pathname, action, expectedStatus) {
  const before = apiPostCount(audit, pathname);
  const requestPending = page.waitForRequest(request => isApiPost(request, pathname));
  const responsePending = page.waitForResponse(response => isApiPost(response.request(), pathname));
  await action();
  const [request, response] = await Promise.all([requestPending, responsePending]);
  assert.strictEqual(response.status(), expectedStatus);
  await page.waitForTimeout(50);
  assert.strictEqual(apiPostCount(audit, pathname), before + 1, `${pathname} increments exactly once`);
  let body = request.postData();
  try { body = request.postDataJSON(); } catch (_error) {}
  return body;
}

function assertAuditClean(audit) {
  assert.deepStrictEqual(audit.attemptedEscapes, [], 'no external destination is attempted');
  assert.deepStrictEqual(audit.firstPartyFailures, [], 'all non-fallback first-party assets and responses succeed');
}

async function assertPassiveMismatchKeepsPrimaryFocus(page) {
  const password = page.locator('#password');
  const confirmation = page.locator('#confirmPassword');
  await password.focus();
  await password.evaluate(element => element.setSelectionRange(2, 2));
  await page.keyboard.type('Z');
  assert.strictEqual(await password.evaluate(element => document.activeElement === element), true);
  assert.deepStrictEqual(await password.evaluate(element => [element.selectionStart, element.selectionEnd]), [3, 3]);
  assert.strictEqual(await confirmation.getAttribute('aria-invalid'), 'true');
  assert.strictEqual(await page.locator('#passwordMatchError').isVisible(), true);
  return password.inputValue();
}

async function assertErrorClears(page) {
  await page.waitForFunction(() => document.getElementById('confirmPassword').getAttribute('aria-invalid') === 'false');
  assert.strictEqual(await page.locator('#passwordMatchError').isHidden(), true);
  assert.strictEqual(await page.locator('#passwordMatchError').textContent(), '');
}

async function runDisabledFallback(browser, viewport, mounted) {
  const context = await browser.newContext({ viewport, javaScriptEnabled: false });
  const audit = await installRequestAudit(context, mounted);
  const fallbackBefore = mounted.state.fallback.length;
  const resetBefore = apiPostCount(audit, '/api/auth/reset-password');
  const password = syntheticPassword(16);
  try {
    const page = await context.newPage();
    await page.goto(`${mounted.origin}/reset-password`);
    assert.strictEqual(await page.locator('meta[name="referrer"]').getAttribute('content'), 'no-referrer');
    assert.strictEqual(await page.locator('#resetForm').getAttribute('method'), 'post');
    assert.strictEqual(await page.locator('#resetForm').getAttribute('action'), '/reset-password');
    await page.fill('#password', password);
    await page.fill('#confirmPassword', password);
    const [fallbackResponse] = await Promise.all([
      page.waitForNavigation(),
      page.click('#resetForm button[type="submit"]'),
    ]);
    assert.strictEqual(fallbackResponse.status(), 405);
    assert.strictEqual(page.url(), `${mounted.origin}/reset-password`);
    assert.ok(!page.url().includes(password));
    assert.strictEqual(mounted.state.fallback.length, fallbackBefore + 1);
    const fallback = mounted.state.fallback.at(-1);
    assert.deepStrictEqual(fallback, { url: '/reset-password', referer: '', body: '' });
    assert.strictEqual(apiPostCount(audit, '/api/auth/reset-password'), resetBefore);
    await page.goBack({ waitUntil: 'domcontentloaded' });
    assert.strictEqual(page.url(), `${mounted.origin}/reset-password`);
    assert.ok(!page.url().includes(password));
    assertAuditClean(audit);
    return { requests: audit.requests.length, responses: audit.firstPartyResponses.length };
  } finally {
    await context.close();
  }
}

async function runJourney(engine, viewport, theme, mounted) {
  const runtime = resolveBrowserRuntime(engine);
  const browser = await runtime.browserType.launch({
    executablePath: runtime.executablePath,
    headless: true,
  });
  const context = await browser.newContext({ viewport });
  await context.addInitScript(selectedTheme => {
    localStorage.setItem('northstar-theme', selectedTheme);
  }, theme);
  const audit = await installRequestAudit(context, mounted);
  try {
    const page = await context.newPage();

    await page.goto(`${mounted.origin}/login`);
    assert.strictEqual(await page.locator('html').getAttribute('data-theme'), theme);
    await page.fill('#password', syntheticPassword(8));
    await assertControls(page, ['Password visibility']);
    await assertLayout(page);
    await page.waitForTimeout(50);
    assert.strictEqual(apiPostCount(audit, '/api/auth/login'), 0, 'visibility controls never submit login');

    await page.goto(`${mounted.origin}/signup`);
    assert.strictEqual(await page.locator('html').getAttribute('data-theme'), theme);
    await assertControls(page, ['Password visibility', 'Confirm password visibility']);
    await assertLayout(page);
    assert.strictEqual(await page.locator('#password').getAttribute('minlength'), '8');
    assert.strictEqual(await page.locator('#confirmPassword').getAttribute('minlength'), '8');
    assert.match(await page.locator('#passwordPolicyHint').textContent(), /8 to 128 characters/i);
    await fillSignupIdentity(page);
    const seven = syntheticPassword(7);
    await page.fill('#password', seven);
    await page.fill('#confirmPassword', seven);
    await assertNoApiPost(page, audit, '/api/auth/signup',
      () => page.locator('#signupForm').evaluate(form => form.requestSubmit()), 'seven-character signup');
    assert.strictEqual(await page.locator('#password').evaluate(input => input.matches(':invalid')), true);

    const accepted = syntheticPassword(8);
    await page.fill('#password', accepted);
    await page.fill('#confirmPassword', `${accepted}x`);
    await assertNoApiPost(page, audit, '/api/auth/signup',
      () => page.click('#signupForm button[type="submit"]'), 'signup confirmation mismatch');
    assert.strictEqual(await page.locator('#confirmPassword').getAttribute('aria-invalid'), 'true');
    assert.strictEqual(await page.locator('#passwordMatchError').isVisible(), true);
    assert.match(await page.locator('#passwordMatchError').textContent(), /do not match/i);
    assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'confirmPassword');

    const submittedSignupPassword = await assertPassiveMismatchKeepsPrimaryFocus(page);
    await page.fill('#confirmPassword', submittedSignupPassword);
    await assertErrorClears(page);
    assert.deepStrictEqual(await page.locator('#signupForm').evaluate(form => ({
      passwordValid: form.querySelector('#password').checkValidity(),
      confirmationValid: form.querySelector('#confirmPassword').checkValidity(),
      formValid: form.checkValidity(),
      errorHidden: form.querySelector('#passwordMatchError').hidden,
      submitDisabled: form.querySelector('button[type="submit"]').disabled,
    })), {
      passwordValid: true, confirmationValid: true, formValid: true, errorHidden: true, submitDisabled: false,
    });
    const signupBody = await assertOneApiPost(
      page, audit, '/api/auth/signup', () => page.click('#signupForm button[type="submit"]'), 202
    );
    assert.deepStrictEqual(Object.keys(signupBody).sort(), ['businessName', 'email', 'name', 'password', 'phone']);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(signupBody, 'confirmPassword'), false);
    assert.strictEqual(signupBody.password, submittedSignupPassword);

    const token = crypto.randomBytes(32).toString('base64url');
    assert.strictEqual(token.length, 43);
    const resetRequestStart = audit.requests.length;
    await page.goto(`${mounted.origin}/reset-password?token=${token}`);
    assert.strictEqual(page.url(), `${mounted.origin}/reset-password`);
    assert.strictEqual(await page.locator('html').getAttribute('data-theme'), theme);
    assert.strictEqual(await page.locator('meta[name="referrer"]').getAttribute('content'), 'no-referrer');
    assert.strictEqual(await page.locator('#resetForm').getAttribute('method'), 'post');
    assert.strictEqual(await page.locator('#resetForm').getAttribute('action'), '/reset-password');
    assert.strictEqual(await page.locator('#password').getAttribute('name'), null);
    assert.strictEqual(await page.locator('#confirmPassword').getAttribute('name'), null);
    await assertControls(page, ['New password visibility', 'Confirm password visibility']);
    await assertLayout(page);
    assert.strictEqual(await page.locator('#password').getAttribute('minlength'), '8');
    assert.strictEqual(await page.locator('#confirmPassword').getAttribute('minlength'), '8');
    assert.match(await page.locator('#passwordPolicyHint').textContent(), /8 to 128 characters/i);

    await page.fill('#password', seven);
    await page.fill('#confirmPassword', seven);
    await assertNoApiPost(page, audit, '/api/auth/reset-password',
      () => page.locator('#resetForm').evaluate(form => form.requestSubmit()), 'seven-character reset');
    assert.strictEqual(await page.locator('#password').evaluate(input => input.matches(':invalid')), true);

    const replacement = syntheticPassword(8);
    await page.fill('#password', replacement);
    await page.fill('#confirmPassword', `${replacement}x`);
    await assertNoApiPost(page, audit, '/api/auth/reset-password',
      () => page.click('#resetForm button[type="submit"]'), 'reset confirmation mismatch');
    assert.strictEqual(await page.locator('#confirmPassword').getAttribute('aria-invalid'), 'true');
    assert.strictEqual(await page.locator('#passwordMatchError').isVisible(), true);
    assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'confirmPassword');

    const submittedResetPassword = await assertPassiveMismatchKeepsPrimaryFocus(page);
    await page.fill('#confirmPassword', submittedResetPassword);
    await assertErrorClears(page);
    const resetBody = await assertOneApiPost(
      page, audit, '/api/auth/reset-password', () => page.click('#resetForm button[type="submit"]'), 200
    );
    await page.waitForFunction(() => document.getElementById('resetStatus').textContent.includes('Password reset'));
    assert.deepStrictEqual(Object.keys(resetBody).sort(), ['password', 'token']);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(resetBody, 'confirmPassword'), false);
    assert.strictEqual(resetBody.password, submittedResetPassword);
    assert.strictEqual(resetBody.token, token);

    const storage = await page.evaluate(() => JSON.stringify({
      local: Object.fromEntries(Object.entries(localStorage)),
      session: Object.fromEntries(Object.entries(sessionStorage)),
    }));
    for (const secret of [submittedSignupPassword, submittedResetPassword, token]) {
      assert.ok(!storage.includes(secret), 'password and reset credentials never reach browser storage');
    }
    for (const request of audit.requests.slice(resetRequestStart).filter(item => item.resourceType !== 'document')) {
      assert.strictEqual(request.referer, '', `${request.method} ${request.path} reset referrer`);
      assert.ok(!request.url.includes(token), `${request.method} ${request.path} omits reset token from URL`);
      assert.ok(!request.url.includes(submittedResetPassword), `${request.method} ${request.path} omits password from URL`);
    }

    const fallbackToken = crypto.randomBytes(32).toString('base64url');
    const fallbackPassword = syntheticPassword(16);
    const fallbackBefore = mounted.state.fallback.length;
    const resetApiBeforeFallback = apiPostCount(audit, '/api/auth/reset-password');
    const fallbackPage = await context.newPage();
    await fallbackPage.goto(`${mounted.origin}/reset-password?token=${fallbackToken}`);
    assert.strictEqual(fallbackPage.url(), `${mounted.origin}/reset-password`);
    await fallbackPage.fill('#password', fallbackPassword);
    await fallbackPage.fill('#confirmPassword', fallbackPassword);
    const [fallbackResponse] = await Promise.all([
      fallbackPage.waitForNavigation(),
      fallbackPage.locator('#resetForm').evaluate(form => form.submit()),
    ]);
    assert.strictEqual(fallbackResponse.status(), 405);
    assert.strictEqual(fallbackPage.url(), `${mounted.origin}/reset-password`);
    assert.strictEqual(mounted.state.fallback.length, fallbackBefore + 1);
    const fallback = mounted.state.fallback.at(-1);
    assert.deepStrictEqual(fallback, { url: '/reset-password', referer: '', body: '' });
    assert.strictEqual(apiPostCount(audit, '/api/auth/reset-password'), resetApiBeforeFallback);
    for (const secret of [fallbackToken, fallbackPassword]) {
      assert.ok(!fallbackPage.url().includes(secret));
      assert.ok(!fallback.url.includes(secret));
      assert.ok(!fallback.referer.includes(secret));
      assert.ok(!fallback.body.includes(secret));
    }
    await fallbackPage.goBack({ waitUntil: 'domcontentloaded' });
    assert.strictEqual(fallbackPage.url(), `${mounted.origin}/reset-password`);
    assert.ok(!fallbackPage.url().includes(fallbackToken));
    assert.ok(!fallbackPage.url().includes(fallbackPassword));
    await fallbackPage.close();

    assert.strictEqual(apiPostCount(audit, '/api/auth/login'), 0);
    assert.strictEqual(apiPostCount(audit, '/api/auth/signup'), 1);
    assert.strictEqual(apiPostCount(audit, '/api/auth/reset-password'), 1);
    assertAuditClean(audit);
    const disabledFallback = await runDisabledFallback(browser, viewport, mounted);

    return {
      engine,
      viewport: viewport.label,
      theme,
      requests: audit.requests.length,
      responses: audit.firstPartyResponses.length,
      apiPosts: audit.apiPosts.length,
      disabledFallback,
    };
  } finally {
    await context.close();
    await browser.close();
  }
}

async function main() {
  const selection = process.env.NORTHSTAR_BROWSER || 'both';
  assert.ok(['chrome', 'webkit', 'both'].includes(selection));
  const engines = selection === 'both' ? ['chrome', 'webkit'] : [selection];
  const mounted = await createLoopbackServer();
  const evidence = [];
  try {
    for (const engine of engines) {
      for (const viewport of VIEWPORTS) {
        for (const theme of THEMES) evidence.push(await runJourney(engine, viewport, theme, mounted));
      }
    }
    process.stdout.write(`${JSON.stringify({ success: true, evidence })}\n`);
  } finally {
    await mounted.close();
  }
}

main().catch(error => {
  process.stderr.write(`${error && error.stack || error}\n`);
  process.exitCode = 1;
});
