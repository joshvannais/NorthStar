'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

const PUBLIC_ROUTES = Object.freeze({
  '/': 'public/index.html',
  '/faq': 'public/faq.html',
  '/contact': 'public/contact.html',
  '/login': 'public/login.html',
  '/signup': 'public/signup.html',
  '/forgot-password': 'public/forgot-password.html',
  '/privacy': 'public/privacy.html',
  '/terms': 'public/terms.html',
  '/refund': 'public/refund.html',
  '/legal': 'public/legal.html',
});

const PUBLISHED_OUTCOMES = Object.freeze([
  'Calls and Lead Context',
  'Customer and Work Records',
  'Explainable Polaris Estimates',
  'Schedules and Attention',
  'Operational Next Actions',
  'Outcome Learning',
]);

describe('Pre-Mission-23 P2 public clarity', () => {
  test('uses one canonical public route and shared visual layer on every public surface', () => {
    for (const [route, file] of Object.entries(PUBLIC_ROUTES)) {
      const html = read(file);
      const canonical = route === '/' ? 'https://northstar-os.ai/' : `https://northstar-os.ai${route}`;
      expect(html).toContain(`<link rel="canonical" href="${canonical}">`);
      expect(html).toContain('/css/site-professionalism.css');
      expect(html).toContain('/css/public-site.css');
      expect(html).toContain('href="/privacy"');
      expect(html).toContain('href="/terms"');
      expect(html).toContain('href="/legal"');
    }
  });

  test('removes the redundant banner and keeps the working demo ahead of trial and Web Call', () => {
    const html = read('public/index.html');
    expect(html).not.toContain('class="demo-banner"');
    expect(html).not.toContain('guided-preview-disclosure');
    expect(html).toContain('id="demoFormCard" hidden');
    expect(html).toContain('Browser Web Call &mdash; Awaiting Approval');
    expect(html.indexOf('homepage_explore_demo')).toBeLessThan(html.indexOf('homepage_start_trial'));
    expect(html.indexOf('homepage_start_trial')).toBeLessThan(html.indexOf('demoWebCallPending'));
    expect(read('public/js/homepage-demo.js')).toContain('if (form) form.hidden = !state.available;');
  });

  test('uses approved typography and a non-clouded centered Web Call presentation', () => {
    const css = read('public/css/public-site.css');
    expect(css).toMatch(/\.demo-hero\s*\{[^}]*opacity:\s*1;[^}]*filter:\s*none;/);
    expect(css).toMatch(/\.demo-web-call-pending\s*\{[^}]*align-items:\s*center;[^}]*justify-items:\s*center;[^}]*text-align:\s*center;/);
    expect(css).toMatch(/\.pricing-card \.price\s*\{[^}]*font-family:\s*var\(--font-body\)\s*!important;/);
    expect(css).toMatch(/\.pricing-card \.pricing-note\s*\{[^}]*font-family:\s*var\(--font-body\)\s*!important;/);
    expect(css).toMatch(/\.truth-band \.stats-bar-value\s*\{[^}]*font-family:\s*var\(--font-display\)\s*!important;/);
  });

  test('publishes approved prices and billed-minute allowances without inventing enterprise terms', () => {
    const html = read('public/index.html');
    for (const [plan, price] of [['Starter', '$149'], ['Growth', '$299'], ['Complete', '$499']]) {
      expect(html).toContain(`<h3>${plan}</h3>`);
      expect(html).toContain(`<div class="price">${price}<span>/mo</span></div>`);
    }
    expect(html).toContain('<h3>Enterprise</h3>');
    expect(html).toContain('Eligibility thresholds, price, included usage, and overage terms are not yet published.');
    expect(html).not.toMatch(/\b30\s+(?:or more\s+)?employees\b/i);
    const enterpriseCard = html.match(/<div class="pricing-card enterprise">([\s\S]*?)<\/div>\s*<\/div>/)[1];
    expect(enterpriseCard).not.toMatch(/\$\d/);
    expect(html).toContain('<strong>160</strong> billed call minutes per month');
    expect(html).toContain('<strong>325</strong> billed call minutes per month');
    expect(html).toContain('<strong>540</strong> billed call minutes per month');
    expect(html).not.toContain('Plan allocation not yet published');
    const comparison = html.match(/<table class="pricing-comparison">([\s\S]*?)<\/table>/)[1];
    for (const outcome of PUBLISHED_OUTCOMES) {
      expect((comparison.match(new RegExp(outcome, 'g')) || []).length).toBe(1);
    }
  });

  test('makes FAQ topics keyboard targets and covers the approved question inventory', () => {
    const html = read('public/faq.html');
    const css = read('public/css/public-site.css');
    expect(html).toContain('class="public-contents-links"');
    expect(css).toMatch(/\.public-contents-links a:focus-visible\s*\{/);
    for (const topic of [
      'About NorthStar', 'Account-free demo', 'Browser Web Call', 'Polaris results',
      'Pricing', 'Integrations', 'Support', 'Getting started', 'Privacy and control', 'Accessibility',
    ]) expect(html).toContain(`>${topic}</a>`);
    expect((html.match(/<details class="faq-item"/g) || []).length).toBeGreaterThanOrEqual(14);
    expect(html).toContain('does not replace acceptance on every physical device');
  });

  test('routes bug reports to durable authenticated authority and keeps general email drafts truthful', () => {
    const html = read('public/contact.html');
    expect(html).toContain('id="contactDraftForm"');
    expect(html).not.toContain('<option value="Report a bug">Report a bug</option>');
    expect(html).toContain('href="/dashboard/report-a-bug"');
    expect(html).toContain('A successful submission receives a durable case reference and organization history');
    expect(html).toContain('public visitors cannot submit a case or see report history');
    expect(html).toContain('id="contactTitle"');
    expect(html).toContain('Use the signed-in Report a Bug page for a bounded screenshot and durable case.');
    expect(html).toContain("'NS-DRAFT-'");
    expect(html).toContain("localStorage.setItem('northstar_support_drafts'");
    expect(html).toContain('It is not a received support case, ticket number, or delivery confirmation.');
    expect(html).toContain('NorthStar does not claim receipt until its support mailbox receives it.');
    expect(html).not.toContain('/api/contact');
  });

  test('gives every paid desktop sidebar action a bounded legible grid area', () => {
    const navigation = read('public/js/nav-component.js');
    const css = read('public/css/site-professionalism.css');
    expect(navigation).toContain("mode === 'demo' ? 'sidebar-footer' : 'sidebar-footer sidebar-footer-paid'");
    expect(css).toMatch(/\.sidebar-footer-paid\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto;/s);
    expect(css).toMatch(/\.sidebar-footer-paid\s*>\s*\[data-support-action\]\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;[^}]*width:\s*100%;/s);
    expect(css).toMatch(/\.sidebar-footer-paid\s*>\s*\[data-account-logout\]\s*\{[^}]*width:\s*100%;/s);
    expect(css).toMatch(/\.sidebar-footer-paid \.northstar-theme-slot\s*\{[^}]*margin-left:\s*0;[^}]*justify-self:\s*end;/s);
  });

  test('keeps signup minimal, login demo-forward, and reset delivery non-enumerating', () => {
    const signup = read('public/signup.html');
    const login = read('public/login.html');
    const forgot = read('public/forgot-password.html');
    expect(signup).not.toMatch(/<input[^>]+(?:id|name)="phone"/i);
    expect(signup).toContain('Add your business phone, service area, and operating details during guided setup.');
    expect(login).toContain('href="/demo"');
    expect(login).toContain('Open the account-free demo');
    expect(forgot).toContain('if the account is eligible');
    expect(forgot).toContain('check your inbox and spam folder after a few minutes');
    expect(forgot).not.toMatch(/account (?:exists|does not exist|not found)/i);
  });

  test('adds privacy contents while preserving sourced retention and provider boundaries', () => {
    const privacy = read('public/privacy.html');
    expect(privacy).toContain('aria-label="Privacy policy topics"');
    for (const id of ['information-collected', 'information-use', 'data-sharing', 'data-security', 'data-retention', 'privacy-rights', 'cookies', 'privacy-contact']) {
      expect(privacy).toContain(`id="${id}"`);
    }
    expect(privacy).toContain('After cancellation, data is deleted within 90 days unless legally required otherwise.');
    expect(privacy).toContain('service providers (cloud hosting, telephony, AI processing)');
  });

  test('keeps public commercial and readiness claims reconciled', () => {
    const publicCopy = Object.values(PUBLIC_ROUTES).map(read).join('\n');
    expect(publicCopy).not.toMatch(/SOC\s*2/i);
    expect(publicCopy).not.toMatch(/All systems operational/i);
    expect(publicCopy).not.toMatch(/Intelligence API Connected/i);
    expect(read('public/refund.html')).toContain('currently presents monthly prices only');
    expect(read('public/legal.html')).toContain('No public uptime guarantee or service-credit commitment is offered');
    expect(read('public/terms.html')).toContain('AI Office Manager and business operating system');
  });

  test('retains one canonical account-free demo destination', () => {
    const server = read('src/server.js');
    expect(server).toMatch(/app\.get\('\/demo-dashboard',[\s\S]*?res\.redirect\(301, '\/demo'\);[\s\S]*?\}\);/);
    const publicCopy = Object.values(PUBLIC_ROUTES).map(read).join('\n');
    expect(publicCopy).not.toMatch(/href=["']\/demo-dashboard["']/);
  });
});
