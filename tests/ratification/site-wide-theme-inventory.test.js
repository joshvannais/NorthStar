'use strict';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { app } = require('../../src/server');
const { MOUNTED_THEME_PAGES, MOUNTED_REDIRECTS } = require('../helpers/site-theme-pages');

const ROOT = path.resolve(__dirname, '../..');
const INTERNAL_LANGUAGE = /\bPR (?:A|B1|B2)\b|PR #|pull request|phase B[12]\b|internal phase|development milestone|implementation availability/i;

function mountedGetRoutes() {
  return app._router.stack
    .filter(layer => layer.route && layer.route.methods && layer.route.methods.get)
    .map(layer => layer.route.path)
    .filter(route => typeof route === 'string' && !route.startsWith('/api'))
    .sort();
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
    ].sort();
    expect(mountedGetRoutes()).toEqual(expectedRoutes);
    expect(new Set(MOUNTED_THEME_PAGES.map(page => page.route)).size).toBe(MOUNTED_THEME_PAGES.length);
    expect(new Set(MOUNTED_THEME_PAGES.map(page => page.file)).size).toBe(MOUNTED_THEME_PAGES.length);

    const expectedHtml = [
      ...MOUNTED_THEME_PAGES.map(page => page.file),
      'public/design-system.html', // Deliberately unmounted internal design reference.
    ].sort();
    expect(htmlFiles(path.join(ROOT, 'public')).sort()).toEqual(expectedHtml);
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
    expect(html).not.toMatch(/<(?:script|link|img)\b[^>]*(?:src|href)=["']https?:\/\//i);
    expect(visibleText(html)).not.toMatch(INTERNAL_LANGUAGE);
  });

  test.each([
    { route: '/forgot-password', form: 'forgotForm', status: 'forgotStatus' },
    { route: '/reset-password', form: 'resetForm', status: 'resetStatus' },
  ])('$route uses the shared recovery shell without changing mounted form authority', async page => {
    const response = await request(app).get(page.route).expect(200).expect('Content-Type', /html/);
    expect(response.text).toContain('class="account-auth-page"');
    expect(response.text).toContain('class="account-auth-shell"');
    expect(response.text).toContain('class="account-auth-card"');
    expect(response.text).toContain(`id="${page.form}"`);
    expect(response.text).toContain(`id="${page.status}"`);
    expect(response.text).toContain('class="account-auth-return"');
    expect(response.text).toContain('href="/login"');
  });
});
