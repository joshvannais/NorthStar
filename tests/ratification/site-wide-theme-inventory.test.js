'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const { app } = require('../../src/server');
const { MOUNTED_THEME_PAGES, MOUNTED_REDIRECTS } = require('../helpers/site-theme-pages');

const ROOT = path.resolve(__dirname, '../..');
const INTERNAL_LANGUAGE = /\bPR (?:A|B1|B2)\b|PR #|pull request|phase B[12]\b|internal phase|development milestone|implementation availability/i;

function joinMountPath(prefix, routePath) {
  const joined = `${prefix}/${routePath}`.replace(/\/{2,}/g, '/');
  return joined.length > 1 && joined.endsWith('/') ? joined.slice(0, -1) : joined;
}

function staticMountPath(layer) {
  if (layer.regexp && layer.regexp.fast_slash) return '';
  const source = layer.regexp && layer.regexp.source;
  const match = typeof source === 'string'
    ? source.match(/^\^\\\/((?:\\.|[^\\])+)\\\/\?\(\?=\\\/\|\$\)$/)
    : null;
  if (!match) {
    throw new Error(`mounted theme inventory cannot safely decode router mount ${String(source)}`);
  }
  return `/${match[1].replace(/\\\//g, '/').replace(/\\(.)/g, '$1')}`;
}

function mountedGetRoutes(router = app._router, prefix = '') {
  const routes = [];
  for (const layer of router.stack) {
    if (layer.route && layer.route.methods && layer.route.methods.get) {
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      for (const routePath of paths) {
        if (typeof routePath === 'string') routes.push(joinMountPath(prefix, routePath));
      }
      continue;
    }
    if (layer.handle && Array.isArray(layer.handle.stack)) {
      routes.push(...mountedGetRoutes(layer.handle, joinMountPath(prefix, staticMountPath(layer))));
    }
  }
  return routes.filter(route => !route.startsWith('/api')).sort();
}

function htmlFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return htmlFiles(absolute);
    return entry.isFile() && entry.name.endsWith('.html')
      ? [path.relative(ROOT, absolute).replace(/\\/g, '/')]
      : [];
  });
}

function visibleText(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:[a-z]+|#\d+);/gi, ' ')
    .replace(/\s+/g, ' ');
}

describe('mounted site-wide theme inventory', () => {
  test('the production GET graph and tested page inventory are exact', () => {
    const expectedRoutes = [
      ...MOUNTED_THEME_PAGES.map(page => page.route),
      ...MOUNTED_REDIRECTS,
      '/site.webmanifest', // Explicit non-HTML install metadata; not a themed page.
    ].sort();
    expect(mountedGetRoutes()).toEqual(expectedRoutes);
    expect(new Set(MOUNTED_THEME_PAGES.map(page => page.route)).size).toBe(MOUNTED_THEME_PAGES.length);
    const demoPages = MOUNTED_THEME_PAGES.filter(page => page.surface === 'public-demo');
    expect(demoPages).toHaveLength(9);
    expect(new Set(demoPages.map(page => page.file))).toEqual(new Set([
      'public/demo-dashboard.html',
      'public/dashboard/polaris.html',
      'public/dashboard/leads.html',
      'public/dashboard/communications.html',
      'public/dashboard/calendar.html',
      'public/dashboard/team.html',
      'public/dashboard/business-profile.html',
      'public/dashboard/settings.html',
      'public/dashboard/integrations.html',
    ]));

    const expectedHtml = [
      ...new Set(MOUNTED_THEME_PAGES.map(page => page.file)),
      'public/dashboard/ai-settings.html', // Preserved unmounted redirect-target provenance.
      'public/dashboard.html', // Preserved unmounted legacy simulation-harness provenance.
      'public/dashboard/command-center.html', // Preserved unmounted Command Center source provenance.
      'public/dashboard/my-number.html', // Preserved unmounted redirect-target provenance.
      'public/design-system.html', // Deliberately unmounted internal design reference.
    ].sort();
    expect(htmlFiles(path.join(ROOT, 'public')).sort()).toEqual(expectedHtml);
  });

  test('nested Express routers cannot hide a newly mounted customer HTML route', () => {
    const synthetic = express();
    const child = express.Router();
    const grandchild = express.Router();
    synthetic.get('/known', (_req, res) => res.type('html').send('<h1>known</h1>'));
    grandchild.get('/hidden', (_req, res) => res.type('html').send('<h1>hidden</h1>'));
    child.use('/child', grandchild);
    synthetic.use('/nested', child);

    const allowlist = ['/known'];
    const discovered = mountedGetRoutes(synthetic._router);
    expect(discovered).toEqual(['/known', '/nested/child/hidden']);
    expect(discovered).not.toEqual(allowlist);
  });

  test.each(MOUNTED_THEME_PAGES)('$route mounts exactly one shared early theme system', async page => {
    const response = await request(app).get(page.route).expect(200).expect('Content-Type', /html/);
    const html = response.text;
    const themeScripts = html.match(/<script\b[^>]*\bsrc=["']\/js\/theme\.js["'][^>]*><\/script>/gi) || [];
    const stylesheets = html.match(/<link\b[^>]*\bhref=["']\/css\/style\.css["'][^>]*>/gi) || [];

    expect(themeScripts).toHaveLength(1);
    expect(stylesheets).toHaveLength(1);
    expect(html.indexOf(themeScripts[0])).toBeLessThan(html.indexOf(stylesheets[0]));
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?northstar-theme[\s\S]*?<\/script>/i);
    const runtimeHtml = html.replace(/<link\b[^>]*\brel=["']canonical["'][^>]*>/gi, '');
    expect(runtimeHtml).not.toMatch(/<(?:script|link|img)\b[^>]*(?:src|href)=["']https?:\/\//i);
    expect(visibleText(html)).not.toMatch(INTERNAL_LANGUAGE);
  });

  test.each([
    { route: '/forgot-password', form: 'forgotForm', status: 'forgotStatus' },
    { route: '/reset-password', form: 'resetForm', status: 'resetStatus' },
  ])('$route uses the shared recovery shell without changing mounted form authority', async page => {
    const response = await request(app).get(page.route).expect(200).expect('Content-Type', /html/);
    expect(response.text).toMatch(/<body\b[^>]*\bclass=["'][^"']*\baccount-auth-page\b[^"']*["']/i);
    expect(response.text).toContain('class="account-auth-shell"');
    expect(response.text).toContain('class="account-auth-card"');
    expect(response.text).toContain(`id="${page.form}"`);
    expect(response.text).toContain(`id="${page.status}"`);
    expect(response.text).toContain('class="account-auth-return"');
    expect(response.text).toContain('href="/login"');
  });

  test('reset-password fallback is non-GET, unnamed, and keeps token cleanup ahead of resources', () => {
    const html = fs.readFileSync(path.join(ROOT, 'public/reset-password.html'), 'utf8');
    const form = html.match(/<form\b[^>]*\bid=["']resetForm["'][^>]*>/i);
    const password = html.match(/<input\b[^>]*\bid=["']password["'][^>]*>/i);
    const confirmation = html.match(/<input\b[^>]*\bid=["']confirmPassword["'][^>]*>/i);
    expect(form).not.toBeNull();
    expect(form[0]).toMatch(/\bmethod=["']post["']/i);
    expect(form[0]).toMatch(/\baction=["']\/reset-password["']/i);
    expect(form[0]).not.toMatch(/\baction=["'][^"']*\?/i);
    expect(password).not.toBeNull();
    expect(confirmation).not.toBeNull();
    expect(password[0]).not.toMatch(/\bname=/i);
    expect(confirmation[0]).not.toMatch(/\bname=/i);
    expect(html).not.toMatch(/<input\b[^>]*\btype=["']hidden["']/i);
    expect(html).not.toMatch(/(?:localStorage|sessionStorage|console\.(?:log|warn|error))\b/);

    const referrerPolicy = html.indexOf('<meta name="referrer" content="no-referrer">');
    const tokenRead = html.indexOf("new URLSearchParams(window.location.search).getAll('token')");
    const cleanup = html.indexOf("window.history.replaceState(null, '', '/reset-password')");
    const firstResource = Math.min(
      ...['<script src=', '<link rel="stylesheet"'].map(value => {
        const index = html.indexOf(value);
        return index === -1 ? Number.POSITIVE_INFINITY : index;
      })
    );
    expect(referrerPolicy).toBeGreaterThan(-1);
    expect(referrerPolicy).toBeLessThan(tokenRead);
    expect(tokenRead).toBeLessThan(cleanup);
    expect(cleanup).toBeLessThan(firstResource);
  });
});
