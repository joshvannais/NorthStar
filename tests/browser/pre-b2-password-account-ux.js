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

async function createLoopbackServer() {
  const state = { signup: [], reset: [], login: [] };
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

async function assertControls(page) {
  const buttons = page.locator('[data-password-toggle]');
  const count = await buttons.count();
  assert.ok(count > 0, 'mounted password page has a visibility control');
  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    const target = await button.getAttribute('aria-controls');
    const input = page.locator(`#${target}`);
    assert.strictEqual(await button.getAttribute('type'), 'button');
    assert.strictEqual(await button.getAttribute('aria-pressed'), 'false');
    assert.strictEqual(await button.getAttribute('aria-label'), 'Show password');
    assert.strictEqual(await input.getAttribute('type'), 'password');
    await input.focus();
    await input.evaluate(element => element.setSelectionRange(0, 0));
    await button.click();
    assert.strictEqual(await input.getAttribute('type'), 'text');
    assert.strictEqual(await button.getAttribute('aria-pressed'), 'true');
    assert.strictEqual(await button.getAttribute('aria-label'), 'Hide password');
    assert.strictEqual(await page.evaluate(() => document.activeElement.id), target);
    await button.click();
    assert.strictEqual(await input.getAttribute('type'), 'password');
    assert.strictEqual(await button.getAttribute('aria-pressed'), 'false');
    assert.strictEqual(await button.getAttribute('aria-label'), 'Show password');
  }
}

async function assertLayout(page) {
  const layout = await page.evaluate(() => ({
    noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth,
    controls: Array.from(document.querySelectorAll('[data-password-toggle]')).map(button => {
      const bounds = button.getBoundingClientRect();
      const shell = button.closest('.password-input-shell').getBoundingClientRect();
      return {
        visible: bounds.width > 0 && bounds.height > 0,
        insideShell: bounds.left >= shell.left && bounds.right <= shell.right &&
          bounds.top >= shell.top && bounds.bottom <= shell.bottom,
      };
    }),
  }));
  assert.strictEqual(layout.noHorizontalOverflow, true);
  assert.ok(layout.controls.every(control => control.visible && control.insideShell));
}

async function fillSignupIdentity(page) {
  await page.fill('#name', 'Bounded Account Owner');
  await page.fill('#businessName', 'Bounded Account Company');
  await page.fill('#phone', '8605550108');
  await page.fill('#email', 'bounded-account@example.test');
}

async function runJourney(engine, viewport, mounted) {
  const runtime = resolveBrowserRuntime(engine);
  const browser = await runtime.browserType.launch({
    executablePath: runtime.executablePath,
    headless: true,
  });
  const context = await browser.newContext({ viewport });
  const requests = [];
  try {
    context.on('request', request => {
      const url = new URL(request.url());
      if (!['http:', 'https:'].includes(url.protocol)) return;
      assert.strictEqual(url.origin, mounted.origin, `loopback-only browser destination ${request.url()}`);
      assert.ok(!Object.keys(request.headers()).some(name => name.toLowerCase() === 'authorization'));
      requests.push({
        method: request.method(),
        path: url.pathname,
        url: request.url(),
        referer: request.headers().referer || '',
        resourceType: request.resourceType(),
      });
    });
    const page = context.pages()[0] || await context.newPage();

    await page.goto(`${mounted.origin}/login`);
    await page.fill('#password', syntheticPassword(8));
    await assertControls(page);
    await assertLayout(page);
    assert.strictEqual(mounted.state.login.length, 0, 'visibility controls never submit login');

    await page.goto(`${mounted.origin}/signup`);
    await assertControls(page);
    await assertLayout(page);
    assert.strictEqual(await page.locator('#password').getAttribute('minlength'), '8');
    assert.strictEqual(await page.locator('#confirmPassword').getAttribute('minlength'), '8');
    assert.match(await page.locator('#passwordPolicyHint').textContent(), /8 to 128 characters/i);
    await fillSignupIdentity(page);
    const seven = syntheticPassword(7);
    await page.fill('#password', seven);
    await page.fill('#confirmPassword', seven);
    const signupBeforeSeven = mounted.state.signup.length;
    await page.locator('#signupForm').evaluate(form => form.requestSubmit());
    assert.strictEqual(mounted.state.signup.length, signupBeforeSeven, 'seven characters sends no signup request');
    assert.strictEqual(await page.locator('#password').evaluate(input => input.matches(':invalid')), true);

    const accepted = syntheticPassword(8);
    await page.fill('#password', accepted);
    await page.fill('#confirmPassword', `${accepted}x`);
    const signupBeforeMismatch = mounted.state.signup.length;
    await page.click('#signupForm button[type="submit"]');
    assert.strictEqual(mounted.state.signup.length, signupBeforeMismatch, 'signup mismatch sends no request');
    assert.strictEqual(await page.locator('#confirmPassword').getAttribute('aria-invalid'), 'true');
    assert.strictEqual(await page.locator('#passwordMatchError').isVisible(), true);
    assert.match(await page.locator('#passwordMatchError').textContent(), /do not match/i);
    assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'confirmPassword');

    await page.fill('#confirmPassword', accepted);
    await page.waitForFunction(() => document.getElementById('confirmPassword').getAttribute('aria-invalid') === 'false');
    assert.deepStrictEqual(await page.locator('#signupForm').evaluate(form => ({
      passwordValid: form.querySelector('#password').checkValidity(),
      confirmationValid: form.querySelector('#confirmPassword').checkValidity(),
      formValid: form.checkValidity(),
      errorHidden: form.querySelector('#passwordMatchError').hidden,
      submitDisabled: form.querySelector('button[type="submit"]').disabled,
    })), {
      passwordValid: true, confirmationValid: true, formValid: true, errorHidden: true, submitDisabled: false,
    });
    const signupResponse = page.waitForResponse(response => response.url().endsWith('/api/auth/signup'));
    await page.click('#signupForm button[type="submit"]');
    assert.strictEqual((await signupResponse).status(), 202);
    const signupBody = mounted.state.signup.at(-1);
    assert.deepStrictEqual(Object.keys(signupBody).sort(), ['businessName', 'email', 'name', 'password', 'phone']);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(signupBody, 'confirmPassword'), false);

    const token = crypto.randomBytes(32).toString('base64url');
    assert.strictEqual(token.length, 43);
    const resetRequestStart = requests.length;
    await page.goto(`${mounted.origin}/reset-password?token=${token}`);
    assert.strictEqual(page.url(), `${mounted.origin}/reset-password`);
    assert.strictEqual(await page.locator('meta[name="referrer"]').getAttribute('content'), 'no-referrer');
    await assertControls(page);
    await assertLayout(page);
    assert.strictEqual(await page.locator('#password').getAttribute('minlength'), '8');
    assert.strictEqual(await page.locator('#confirmPassword').getAttribute('minlength'), '8');
    assert.match(await page.locator('#passwordPolicyHint').textContent(), /8 to 128 characters/i);

    await page.fill('#password', seven);
    await page.fill('#confirmPassword', seven);
    const resetBeforeSeven = mounted.state.reset.length;
    await page.locator('#resetForm').evaluate(form => form.requestSubmit());
    assert.strictEqual(mounted.state.reset.length, resetBeforeSeven, 'seven characters sends no reset request');
    assert.strictEqual(await page.locator('#password').evaluate(input => input.matches(':invalid')), true);

    const replacement = syntheticPassword(8);
    await page.fill('#password', replacement);
    await page.fill('#confirmPassword', `${replacement}x`);
    const resetBeforeMismatch = mounted.state.reset.length;
    await page.click('#resetForm button[type="submit"]');
    assert.strictEqual(mounted.state.reset.length, resetBeforeMismatch, 'reset mismatch sends no request');
    assert.strictEqual(await page.locator('#confirmPassword').getAttribute('aria-invalid'), 'true');
    assert.strictEqual(await page.locator('#passwordMatchError').isVisible(), true);
    assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'confirmPassword');

    await page.fill('#confirmPassword', replacement);
    await page.waitForFunction(() => document.getElementById('confirmPassword').getAttribute('aria-invalid') === 'false');
    const resetResponse = page.waitForResponse(response => response.url().endsWith('/api/auth/reset-password'));
    await page.click('#resetForm button[type="submit"]');
    assert.strictEqual((await resetResponse).status(), 200);
    await page.waitForFunction(() => document.getElementById('resetStatus').textContent.includes('Password reset'));
    const resetBody = mounted.state.reset.at(-1);
    assert.deepStrictEqual(Object.keys(resetBody).sort(), ['password', 'token']);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(resetBody, 'confirmPassword'), false);

    const storage = await page.evaluate(() => JSON.stringify({
      local: Object.fromEntries(Object.entries(localStorage)),
      session: Object.fromEntries(Object.entries(sessionStorage)),
    }));
    assert.ok(!storage.includes(replacement), 'password confirmation never reaches browser storage');
    for (const request of requests.slice(resetRequestStart).filter(item => item.resourceType !== 'document')) {
      assert.strictEqual(request.referer, '', `${request.method} ${request.path} reset referrer`);
      assert.ok(!request.url.includes(token), `${request.method} ${request.path} omits reset token from URL`);
    }

    return {
      engine,
      viewport: viewport.label,
      requests: requests.length,
      signupPosts: mounted.state.signup.length,
      resetPosts: mounted.state.reset.length,
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
      for (const viewport of VIEWPORTS) evidence.push(await runJourney(engine, viewport, mounted));
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
