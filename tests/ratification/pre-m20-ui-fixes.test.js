'use strict';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { app } = require('../../src/server');

const ROOT = path.resolve(__dirname, '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

describe('pre-Mission 20 public UI corrections', () => {
  const sharedCss = read('public/css/style.css');
  const homepage = read('public/index.html');
  const demo = read('public/demo-dashboard.html');
  const demoCss = read('public/css/demo-dashboard.css');

  test('the fixed theme toggle no longer reserves a horizontal body rail', () => {
    expect(sharedCss).not.toMatch(/body\s*\{[^}]*padding-right\s*:\s*calc\(64px/si);
    expect(sharedCss).not.toMatch(/padding-right\s*:\s*calc\([^)]*safe-area-inset-right/si);
    expect(sharedCss).toMatch(/\.northstar-theme-control\s*\{[^}]*position\s*:\s*fixed[^}]*right\s*:[^;}]+[^}]*bottom\s*:[^;}]+/si);
    expect(sharedCss).toMatch(/\.theme-toggle\s*\{[^}]*width\s*:\s*44px[^}]*height\s*:\s*44px/si);
    expect(demoCss).not.toMatch(/padding-right\s*:/i);
    expect(read('public/js/theme.js')).toMatch(/refreshControlPosition:\s*dockToggle/);
  });

  test('the homepage is explicitly centered and exposes the account-free dashboard entry', () => {
    expect(homepage).toMatch(/\.demo-container\s*\{[^}]*width\s*:\s*min\(calc\(100% - 32px\), 1100px\)[^}]*margin-inline\s*:\s*auto/si);
    expect(homepage.match(/href=["']\/demo-dashboard["']/g)).toHaveLength(2);
    expect(homepage).toContain('Explore the account-free demo dashboard');
    expect(homepage).toContain('sample data only, no sign-in required');
  });

  test('the account-free dashboard is a mounted public HTML document', async () => {
    const response = await request(app)
      .get('/demo-dashboard')
      .expect(200)
      .expect('Content-Type', /html/);

    expect(response.text).toBe(demo);
    expect(demo.match(/<script\b[^>]*\bsrc=["']\/js\/theme\.js["'][^>]*><\/script>/gi)).toHaveLength(1);
    expect(demo.match(/<link\b[^>]*\bhref=["']\/css\/style\.css["'][^>]*>/gi)).toHaveLength(1);
    expect(demo.match(/<link\b[^>]*\bhref=["']\/css\/demo-dashboard\.css["'][^>]*>/gi)).toHaveLength(1);
    expect(demo).toMatch(/Fictional preview:/);
    expect(demo).toMatch(/not connected to an account, provider, customer record, or production data source/);
    expect(demo).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
    expect(demo).not.toMatch(/\bstyle\s*=/i);
  });

  test('the demo is read-only, provider-free, and linked only to public destinations', () => {
    expect(demo).not.toMatch(/\/api\/|\bfetch\s*\(|XMLHttpRequest|EventSource|WebSocket|auth-session|app-store/i);
    expect(demo).not.toMatch(/<form\b|<input\b|<button\b/i);
    expect(demo).not.toMatch(/href=["']\/(?:dashboard|settings|leads|calls|reports|calendar|business-profile)(?:[\/?#"'])/i);
    expect(demo).not.toMatch(/<(?:script|link|img)\b[^>]*(?:src|href)=["']https?:\/\//i);

    const hrefs = Array.from(demo.matchAll(/\bhref=["']([^"']+)["']/gi), match => match[1]);
    const allowed = new Set([
      '/',
      '/#demoPreCallView',
      '/signup',
      '/privacy',
      '/terms',
      '/legal',
      '/css/style.css',
      '/css/demo-dashboard.css',
      '/assets/logo.png',
      '#demoDashboardMain',
    ]);
    expect(hrefs.filter(href => !allowed.has(href))).toEqual([]);
  });
});
