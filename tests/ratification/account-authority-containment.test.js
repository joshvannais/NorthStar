'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function publicFiles() {
  const result = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (/\.(?:html|js)$/.test(entry.name)) result.push(target);
    }
  }
  visit(path.join(ROOT, 'public'));
  return result;
}

describe('Account Lifecycle PR A authority containment', () => {
  test('mounted auth uses the PostgreSQL router and cannot reach the JSON user store', () => {
    const server = read('src/server.js');
    const authRouter = read('src/routes/auth.js');
    const accountRepository = read('src/accounts/repository.js');
    expect(server).toContain("app.use('/api/auth', createAuthRouter())");
    expect(server).not.toMatch(/users\/store|addUser|getAllUsers|getUser/);
    expect(authRouter).not.toMatch(/users\/store|data\/users\.json/);
    expect(accountRepository).not.toMatch(/users\/store|data\/users\.json/);
    expect(server.indexOf("app.use('/api/auth'")).toBeLessThan(server.indexOf("app.use('/api', apiRoutes)"));
  });

  test('legacy demo/admin auth is retired and source defaults are absent from runtime modules', () => {
    const runtime = [
      'src/server.js', 'src/auth/middleware.js', 'src/auth/credentials.js',
      'src/routes/auth.js', 'src/config.js',
    ].map(read).join('\n');
    expect(runtime).not.toMatch(/northstar-dev-secret|northstar2024|demo1234|ADMIN_PASSWORD\s*\|\|/);
    expect(runtime).toContain('demo_auth_retired');
    expect(runtime).toContain('legacy_admin_disabled');
    expect(runtime).not.toContain("app.post('/api/auth/demo'");
  });

  test('browser code contains no stored auth/account authority or Bearer injection', () => {
    const browserSource = publicFiles().map(file => fs.readFileSync(file, 'utf8')).join('\n');
    expect(browserSource).not.toMatch(/localStorage\.(?:getItem|setItem|removeItem)\(['"](?:token|user|organization|orgId|role|adminToken)/);
    expect(browserSource).not.toMatch(/Authorization\s*[:=].*Bearer|Bearer\s*['"+]\s*token/);
    expect(browserSource).not.toContain('/api/auth/demo');
    expect(read('public/js/auth-session.js')).toContain("credentials = 'same-origin'");
  });

  test('cookie, CSRF, migration, and startup fail-closed contracts are explicit', () => {
    const credentials = read('src/auth/credentials.js');
    const middleware = read('src/auth/middleware.js');
    const accountRepository = read('src/accounts/repository.js');
    const migration = read('migrations/010_account_session_authority.sql');
    const server = read('src/server.js');
    expect(credentials).toContain('function cookieOptions(httpOnly, maxAge)');
    expect(credentials).toMatch(/res\.cookie\(ACCESS_COOKIE, material\.accessToken, cookieOptions\(true,/);
    expect(credentials).toMatch(/res\.cookie\(REFRESH_COOKIE, material\.refreshToken, cookieOptions\(true,/);
    expect(credentials).toMatch(/res\.cookie\(CSRF_COOKIE, material\.csrfToken, cookieOptions\(false,/);
    expect(credentials).toContain("sameSite: 'lax'");
    expect(credentials).toContain("path: '/'");
    expect(middleware).toContain("req.headers['x-csrf-token']");
    expect(migration).toContain('account email normalization collision');
    expect(accountRepository).toContain("'refresh_replay'");
    expect(migration).not.toMatch(/data\/users\.json|COPY\s+.*users\.json/i);
    expect(server).toContain("throw new Error('PostgreSQL startup authority is unavailable')");
  });
});
