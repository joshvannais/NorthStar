'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const request = require('supertest');

[
  'DATABASE_URL', 'RETELL_API_KEY', 'RETELL_AGENT_ID', 'RETELL_PHONE_NUMBER',
  'RETELL_WEBHOOK_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
  'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER',
  'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS',
].forEach(name => { delete process.env[name]; });

const ROOT = path.resolve(__dirname, '..', '..');
const BASE = 'c5a3195cb3b9825e00657e4a1689711878caff58';
const SLICE_ONE_MERGE = 'dfff096241d3be4fd1580a741cfe21ee64a5dfb3';
const LEGACY_INLINE_COMMIT = '88f432b9585cb8610329b1854b3e4478ef5b9e5f';
const RETIRED = Object.freeze([
  Object.freeze({
    path: 'public/js/customer-drawer.js',
    asset: '/js/customer-drawer.js',
    blob: 'a0a0c037237d9d381b9f9740516482afc22dd7bd',
    size: 22481,
  }),
  Object.freeze({
    path: 'public/js/dashboard-init.js',
    asset: '/js/dashboard-init.js',
    blob: '981ae554d118ef42840b78309afb814128399882',
    size: 29324,
  }),
]);
const TEST_PATHS = Object.freeze([
  'tests/browser/m19-part4-final-reachability.js',
  'tests/ratification/m19-part4-final-reachability.test.js',
]);
const { MOUNTED_THEME_PAGES, MOUNTED_REDIRECTS } = require('../helpers/site-theme-pages');
const packageMetadata = require('../../package.json');
const { app } = require('../..');

function git(args, options = {}) {
  return childProcess.execFileSync('git', [
    '-c', `safe.directory=${ROOT.replace(/\\/g, '/')}`,
    '-C', ROOT,
    ...args,
  ], {
    encoding: options.encoding === undefined ? 'utf8' : options.encoding,
    windowsHide: true,
  });
}

function nullList(value) {
  return String(value).split('\0').filter(Boolean).map(item => item.replace(/\\/g, '/'));
}

function currentTrackedPaths() {
  return nullList(git(['ls-files', '-z']));
}

function treePaths(ref) {
  return nullList(git(['ls-tree', '-r', '-z', '--name-only', ref]));
}

function readBlob(ref, relative) {
  return git(['show', `${ref}:${relative}`]);
}

function scriptsIn(html) {
  return [...String(html).matchAll(/<script\b([^>]*)>/gi)].map(match => {
    const source = /\bsrc=["']([^"']+)["']/i.exec(match[1]);
    return source ? source[1] : '<inline>';
  });
}

function trackedText() {
  const result = [];
  for (const relative of currentTrackedPaths()) {
    const filename = path.join(ROOT, ...relative.split('/'));
    if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) continue;
    const bytes = fs.readFileSync(filename);
    if (bytes.includes(0)) continue;
    result.push({ relative, source: bytes.toString('utf8') });
  }
  return result;
}

function foldedDynamicLoaderSnippets(source) {
  const snippets = [];
  const patterns = [
    /\b(?:[A-Za-z_$][\w$]*\.)?src\s*=\s*[^;\r\n]+/g,
    /\bsetAttribute\s*\(\s*["']src["'][^;\r\n]+/g,
    /\b(?:importScripts|import|require)\s*\([^;\r\n]+/g,
    /\bnew\s+(?:SharedWorker|Worker)\s*\([^;\r\n]+/g,
    /\bserviceWorker\s*\.\s*register\s*\([^;\r\n]+/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      snippets.push(match[0].replace(/[\s'"`+]/g, '').toLowerCase());
    }
  }
  return snippets;
}

function mountedRoutePaths() {
  return app._router.stack
    .filter(layer => layer.route)
    .map(layer => layer.route.path)
    .filter(value => typeof value === 'string');
}

describe('Mission 19 Part 4 Slice 5 final reachability retirement', () => {
  test('full-history provenance fixes the two-file retirement boundary', () => {
    expect(packageMetadata.main).toBe('src/server.js');
    expect(packageMetadata.scripts).toMatchObject({
      start: 'node src/server.js',
      dev: 'node --watch src/server.js',
    });
    expect(git(['rev-parse', '--is-shallow-repository']).trim()).toBe('false');
    expect(git(['merge-base', '--is-ancestor', SLICE_ONE_MERGE, BASE], { encoding: null })).toBeInstanceOf(Buffer);
    expect(git(['merge-base', '--is-ancestor', LEGACY_INLINE_COMMIT, BASE], { encoding: null })).toBeInstanceOf(Buffer);

    for (const candidate of RETIRED) {
      expect(git(['rev-parse', `${BASE}:${candidate.path}`]).trim()).toBe(candidate.blob);
      expect(Number(git(['cat-file', '-s', `${BASE}:${candidate.path}`]).trim())).toBe(candidate.size);
    }

    const customerPages = ['command-center.html', 'leads.html', 'communications.html'];
    for (const page of customerPages) {
      const relative = `public/dashboard/${page}`;
      expect(readBlob(`${SLICE_ONE_MERGE}^1`, relative)).toContain('/js/customer-drawer.js');
      expect(readBlob(SLICE_ONE_MERGE, relative)).not.toContain('/js/customer-drawer.js');
      expect(fs.readFileSync(path.join(ROOT, ...relative.split('/')), 'utf8')).not.toContain('/js/customer-drawer.js');
    }
    expect(readBlob(`${LEGACY_INLINE_COMMIT}^`, 'public/dashboard.html')).toContain('/js/dashboard-init.js');
    expect(readBlob(LEGACY_INLINE_COMMIT, 'public/dashboard.html')).not.toContain('/js/dashboard-init.js');
    expect(readBlob(BASE, 'public/dashboard.html')).not.toContain('/js/dashboard-init.js');
    expect(readBlob(BASE, 'public/dashboard.html')).not.toBe(readBlob(LEGACY_INLINE_COMMIT, 'public/dashboard.html'));
  });

  test('only the two authorized public scripts are absent while retained boundaries remain', () => {
    const base = new Set(treePaths(BASE));
    const current = new Set(currentTrackedPaths());
    const missingPublicScripts = [...base]
      .filter(relative => relative.startsWith('public/js/') && relative.endsWith('.js') && !current.has(relative))
      .sort();
    expect(missingPublicScripts).toEqual(RETIRED.map(candidate => candidate.path).sort());
    expect([...current].filter(relative => relative.startsWith('public/js/') && !base.has(relative))).toEqual([]);
    expect([...base].filter(relative => relative.startsWith('src/') && !current.has(relative))).toEqual([]);
    expect([...base].filter(relative => relative.startsWith('migrations/') && !current.has(relative))).toEqual([]);
    expect(TEST_PATHS.every(relative => current.has(relative) && fs.existsSync(path.join(ROOT, ...relative.split('/'))))).toBe(true);

    expect(current.has('public/design-system.html')).toBe(true);
    expect(MOUNTED_THEME_PAGES.some(page => page.file === 'public/design-system.html')).toBe(false);
    expect(current.has('public/js/retell-provider.js')).toBe(true);
    expect(fs.readFileSync(path.join(ROOT, 'public/js/calendar-engine.js'), 'utf8'))
      .toMatch(/if \(event\.type === 'lead' && window\.CustomerDrawer\)[\s\S]*window\.CustomerDrawer\.open\(lead\)/);
    expect(fs.readFileSync(path.join(ROOT, 'public/js/customer-detail.js'), 'utf8')).toContain('cdCustomerDrawer');
  });

  test('complete tracked literal and dynamic-load inventory reaches neither retired asset', () => {
    const files = trackedText();
    const production = files.filter(file => file.relative.startsWith('public/') || file.relative.startsWith('src/'));

    for (const candidate of RETIRED) {
      const basename = path.posix.basename(candidate.path).toLowerCase();
      const literalReferences = files
        .filter(file => file.source.toLowerCase().includes(basename))
        .map(file => file.relative)
        .sort();
      expect(literalReferences).toEqual([...TEST_PATHS].sort());

      const declaredScripts = production
        .filter(file => file.relative.endsWith('.html'))
        .flatMap(file => scriptsIn(file.source).map(source => ({ file: file.relative, source })))
        .filter(entry => entry.source.toLowerCase().endsWith('/' + basename));
      expect(declaredScripts).toEqual([]);

      const dynamicLoads = production.flatMap(file => foldedDynamicLoaderSnippets(file.source)
        .filter(snippet => snippet.includes(basename))
        .map(snippet => ({ file: file.relative, snippet })));
      expect(dynamicLoads).toEqual([]);
    }

    const synthetic = "const s=document.createElement('script');s.src='/js/customer-' + 'drawer.js';document.head.appendChild(s);";
    expect(foldedDynamicLoaderSnippets(synthetic)).toContain("s.src=/js/customer-drawer.js");
    expect(production.filter(file => /navigator\s*\.\s*serviceWorker|\bcaches\s*\.\s*open|\bimportScripts\s*\(/.test(file.source)))
      .toEqual([]);
    expect(currentTrackedPaths().filter(relative => /(^|\/)(?:service-worker|sw)\.js$|\.webmanifest$/i.test(relative)))
      .toEqual([]);
  });

  test('the real package entrypoint mounts all 28 pages and retires both direct/deep asset URLs', async () => {
    const mounted = mountedRoutePaths();
    expect(MOUNTED_THEME_PAGES).toHaveLength(28);
    for (const page of MOUNTED_THEME_PAGES) expect(mounted).toContain(page.route);
    for (const route of MOUNTED_REDIRECTS) expect(mounted).toContain(route);

    const declarations = [];
    for (const page of MOUNTED_THEME_PAGES) {
      const suffix = page.route === '/dashboard/lead'
        ? '?id=00000000-0000-4000-8000-000000000905'
        : '';
      const response = await request(app).get(page.route + suffix);
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/^text\/html\b/i);
      expect(response.headers['cache-control']).toMatch(/public,\s*max-age=0/i);
      declarations.push(...scriptsIn(response.text).map(source => ({ route: page.route, source })));
    }
    expect(declarations.filter(entry => RETIRED.some(candidate => entry.source.endsWith(candidate.asset)))).toEqual([]);

    const redirectExpectations = Object.freeze({
      '/dashboard/calls': { status: 301, location: '/dashboard/communications' },
      '/demo-login': { status: 302, location: '/login?demo=retired' },
    });
    for (const route of MOUNTED_REDIRECTS) {
      const first = await request(app).get(route).redirects(0);
      expect({ status: first.status, location: first.headers.location }).toEqual(redirectExpectations[route]);
      const final = await request(app).get(route).redirects(1);
      expect(final.status).toBe(200);
      expect(scriptsIn(final.text).some(source => RETIRED.some(candidate => source.endsWith(candidate.asset)))).toBe(false);
    }

    const direct = [];
    for (const candidate of RETIRED) {
      const response = await request(app).get(candidate.asset);
      direct.push({ asset: candidate.asset, status: response.status, cacheControl: response.headers['cache-control'] || null });
      expect((await request(app).get('/' + path.posix.basename(candidate.path))).status).toBe(404);
    }
    expect(direct.map(item => ({ asset: item.asset, status: item.status }))).toEqual(
      RETIRED.map(candidate => ({ asset: candidate.asset, status: 404 }))
    );
  });
});
