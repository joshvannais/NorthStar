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
  const demo = read('public/dashboard/command-center.html');
  const demoCss = read('public/css/demo-runtime.css');
  const demoRuntime = read('public/js/demo-runtime.js');
  const themeScript = read('public/js/theme.js');

  test('the fixed theme toggle no longer reserves a horizontal body rail', () => {
    const toggleRule = sharedCss.match(/\.theme-toggle\s*\{([^}]*)\}/s)?.[1] || '';

    expect(sharedCss).not.toMatch(/body\s*\{[^}]*padding-right\s*:\s*calc\(64px/si);
    expect(sharedCss).not.toMatch(/padding-right\s*:\s*calc\([^)]*safe-area-inset-right/si);
    expect(sharedCss).toMatch(/\.northstar-theme-control\s*\{[^}]*position\s*:\s*fixed[^}]*right\s*:[^;}]+[^}]*bottom\s*:[^;}]+/si);
    expect(sharedCss).toMatch(/\.theme-toggle\s*\{[^}]*width\s*:\s*44px[^}]*height\s*:\s*44px/si);
    expect(toggleRule).toContain('transition: border-color 0.2s, transform 0.2s;');
    expect(toggleRule).not.toMatch(/background-color\s+0\.2s|(?:^|,)\s*color\s+0\.2s/m);
    expect(sharedCss).toMatch(/html\[data-theme-switching\][\s\S]*?transition\s*:\s*none\s*!important/);
    expect(themeScript).toMatch(/setAttribute\('data-theme-switching',\s*''\)/);
    expect(themeScript).toMatch(/requestAnimationFrame\(function \(\) \{ global\.requestAnimationFrame\(release\); \}\)/);
    expect(demoCss).not.toMatch(/padding-right\s*:/i);
    expect(themeScript).toMatch(/refreshControlPosition:\s*dockToggle/);
    expect(themeScript).not.toMatch(/Number\(style\.opacity\)\s*<=\s*0/);
  });

  test('the homepage is explicitly centered and exposes the account-free dashboard entry', () => {
    expect(homepage).toMatch(/\.demo-container\s*\{[^}]*width\s*:\s*min\(calc\(100% - 32px\), 1100px\)[^}]*margin-inline\s*:\s*auto/si);
    expect(homepage.match(/href=["']\/demo-dashboard["']/g).length).toBeGreaterThanOrEqual(2);
    expect(homepage).not.toMatch(/href=["']\/demo-login["']/i);
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
    expect(demo.match(/<link\b[^>]*\bhref=["']\/css\/demo-runtime\.css["'][^>]*>/gi)).toHaveLength(1);
    expect(demo).toContain('/js/demo-runtime.js');
    expect(demo).toContain('/js/nav-component.js');
    expect(demo).toContain('Command Center');
    expect(demo).toContain('Polaris™ Intelligence');
  });

  test('the shared adapter exposes only bounded demo mutations and rewrites paid links locally', () => {
    expect(demoRuntime).toContain("simulate.id = 'demoSimulateLead'");
    expect(demoRuntime).toContain("reset.id = 'demoReset'");
    expect(demoRuntime).toContain("select.id = 'demoScenario'");
    expect(demoRuntime).toContain('/api/demo/command-center/simulations/leads');
    expect(demoRuntime).toContain('/api/demo/command-center/reset');
    expect(demoRuntime).toContain("code: 'demo_external_request_blocked'");
    expect(demoRuntime).toContain('route.demoPath');
    expect(demoRuntime).not.toMatch(/https?:\/\/(?!northstar\.invalid)/i);
    expect(demoCss).toMatch(/\.northstar-demo-toolbar[\s\S]*max-width:\s*100%/);
    expect(demoCss).toMatch(/@media \(max-width:\s*768px\)/);
  });
});
