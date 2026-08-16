'use strict';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { app } = require('../../src/server');

const ROOT = path.resolve(__dirname, '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function readOptional(relativePath) {
  const absolute = path.join(ROOT, relativePath);
  return fs.existsSync(absolute) ? fs.readFileSync(absolute, 'utf8') : '';
}

function blockById(source, id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return source.match(new RegExp('<([a-z][\\w:-]*)[^>]+id=["\\\']' + escaped + '["\\\'][^>]*>([\\s\\S]*?)<\\/\\1>', 'i'))?.[2] || '';
}

function attributeValues(source, attribute) {
  const pattern = new RegExp('\\b' + attribute + '=["\\\']([^"\\\']+)["\\\']', 'gi');
  return Array.from(source.matchAll(pattern), match => match[1]);
}

describe('authorized Homepage Refresh contracts', () => {
  const homepage = read('public/index.html');
  const sharedCss = read('public/css/style.css');
  const homepageCss = readOptional('public/css/homepage-refresh.css');
  const homepageDemo = readOptional('public/js/homepage-demo.js');
  const retellWebEntry = read('src/browser/retellWebEntry.mjs');
  const nav = read('public/js/nav-component.js');
  const commandCenter = read('public/dashboard/command-center.html');
  const demoDashboard = read('public/demo-dashboard.html');
  const demoRoute = read('src/routes/demo.js');
  const faq = read('public/faq.html');
  const contact = read('public/contact.html');
  const manifestText = readOptional('public/site.webmanifest');

  test('public positioning describes the truthful operating system rather than a disguised receptionist', () => {
    expect(homepage).toContain('AI Office Manager and business operating system');
    expect(homepage).toContain('calls, leads, estimates, schedules, and next actions');
    expect(homepage).toContain('outcome learning');
    expect(homepage).not.toMatch(/Meet Your Future\s*<span>AI Receptionist|customers won['’]t know it['’]s AI/i);
    expect(homepage).not.toMatch(/Revenue Generated|Calls Answered|99%|3x More Leads|Google Sheets sync|calendar fills itself/i);
    expect(homepage).not.toMatch(/no forwarding|no new numbers to hand out|starts answering calls immediately/i);
  });

  test('pricing publishes only the three authorized monthly list prices without entitlements', () => {
    const pricing = blockById(homepage, 'pricing');
    expect(pricing).toContain('Starter');
    expect(pricing).toContain('$149');
    expect(pricing).toContain('Growth');
    expect(pricing).toContain('$299');
    expect(pricing).toContain('Complete');
    expect(pricing).toContain('$499');
    expect(pricing).toContain('Monthly list price');
    expect(pricing).toContain('Plan details are finalized before launch');
    expect(pricing).not.toMatch(/\$99|\$199|Professional|Enterprise|<ul\b|Everything in|phone number|minutes|calls|seats|allowance|overage|add-on/i);
  });

  test('the account-free browser Web Call exposes only mounted supported industries and no scripted scenario catalogue', () => {
    const industryBlock = blockById(homepage, 'demoIndustry');
    const industries = attributeValues(industryBlock, 'value').filter(Boolean);
    expect(industries).toEqual([
      'Roofing',
      'HVAC',
      'Plumbing',
      'Electrical',
      'Painting',
      'Tree Service',
      'Window Tinting',
      'Concrete',
    ]);
    expect(homepage).not.toContain('id="scenarioChips"');
    expect(homepage).not.toContain('id="modalScenarioChips"');
    expect(homepageDemo).not.toMatch(/scenario\.turns|var SCENARIOS/);
    expect(homepageDemo).toContain("var CONNECTION_TIMEOUT_MS = 20000;");
    expect(homepageDemo).toContain("var MAX_CALL_MS = 5 * 60 * 1000;");
  });

  test('FAQ and support are focused, truthful destinations with the canonical entity footer', () => {
    expect(homepage).toContain('href="/faq"');
    expect(faq).toContain('Frequently Asked Questions');
    expect(faq).toContain('Starter $149, Growth $299, and Complete $499');
    expect(faq).toContain('Production activation remains unavailable');
    expect(contact).toContain('href="mailto:Support@northstar-os.ai"');
    expect(contact).toContain('Delivery boundary:');
    expect(contact).not.toContain('/api/contact');
    expect(contact).not.toMatch(/ctomail/i);
    for (const source of [homepage, faq, contact]) {
      expect(source).toContain('NorthStar Solutions LLC');
    }
  });

  test('the consent dialog validates first, is deliberately dismissible, and stays accessible', () => {
    expect(homepage).toMatch(/id=["']demoFormNotice["'][^>]*role=["']status["'][^>]*aria-live=["']polite["']/i);
    expect(homepage).toMatch(/id=["']preCallModal["'][^>]*role=["']dialog["'][^>]*aria-modal=["']true["']/i);
    expect(homepage).toContain('Before Your Browser Web Call');
    expect(homepage).toContain('id="selectedScenarioContext"');
    expect(homepageDemo).toMatch(/function showPreCallModal\(\)[\s\S]*validateForm\(\)/);
    expect(homepageDemo).toMatch(/event\.target\s*===\s*overlay/);
    expect(homepageDemo).toMatch(/previousFocus/);
    expect(homepageDemo).toMatch(/aria-hidden/);
    expect(homepageDemo).not.toMatch(/\balert\s*\(|\bconfirm\s*\(|\bprompt\s*\(/);
  });

  test('the page drives a user-initiated Retell browser Web Call with audible consent and fail-closed deletion', () => {
    expect(homepage).toContain('Account-free browser Web Call');
    expect(homepage).toContain('id="demoConsentCheckbox"');
    expect(homepage).toContain('Withdraw &amp; Delete');
    expect(homepage).toContain('Retry Verified Deletion');
    expect(homepageDemo).toContain('NorthStarHomepageDemo');
    expect(homepageDemo).toContain("import(SDK_URL)");
    expect(homepageDemo).toContain('SpeechSynthesisUtterance');
    expect(homepageDemo).toContain("var CONSENT_PHRASE = 'I consent to this AI demo and temporary recording'");
    expect(homepageDemo).toContain("'X-NorthStar-Demo-Intent': 'start-homepage-web-call'");
    expect(homepageDemo).toContain("'X-NorthStar-Demo-Intent': 'calculate-homepage-polaris'");
    expect(homepageDemo).toContain("'X-NorthStar-Demo-Intent': 'delete-homepage-web-call'");
    expect(homepageDemo).toMatch(/CONNECTION_TIMEOUT_MS/);
    expect(homepageDemo).toContain('Deletion not verified — results withheld');
    expect(retellWebEntry).toMatch(/setLogLevel\(LogLevel\.silent\)/);
    expect(homepageDemo).not.toMatch(/\/api\/demo\/call|\/:id\/simulate|TWILIO/i);
    expect(homepage).not.toMatch(/href=["']\/demo-login/i);
    expect(demoRoute).toContain("outboundCalls: false");
    expect(demoRoute).toContain("guidedPreview: false");
    expect(demoRoute).toContain("browserWebCall: true");
    expect(demoRoute).toContain("code: 'demo_external_action_retired'");
    expect(homepageDemo).not.toMatch(/sessionStorage|localStorage|indexedDB/i);
  });

  test('one accessible brand token and lockup contract spans public, auth, demo, and paid surfaces', () => {
    expect(sharedCss).toContain('--northstar-brand-gold: #6D5005;');
    expect(sharedCss).toContain('--northstar-lockup-width: 148px;');
    expect(sharedCss).toContain('--northstar-lockup-height: 40px;');
    expect(sharedCss).toMatch(/\.northstar-lockup[\s\S]*color:\s*var\(--northstar-brand-gold\)/);
    expect(sharedCss).toMatch(/\.nav-logo[\s\S]*width:\s*var\(--northstar-lockup-width\)[\s\S]*height:\s*var\(--northstar-lockup-height\)/);
    expect(nav).toContain('northstar-lockup');
    expect(nav).not.toMatch(/color:var\(--brand-600\)/);
    expect(homepageCss).toMatch(/\.demo-eyebrow[\s\S]*\.demo-panel-kicker[\s\S]*var\(--northstar-brand-gold\)/);
    expect(homepageCss).toMatch(/\.cc-card-title[\s\S]*var\(--northstar-brand-gold\)/);
    expect(commandCenter).toContain('cc-card-title');
    expect(demoDashboard).toContain('demo-panel-kicker');
  });

  test('responsive, theme, motion, and install metadata remain explicit without offline claims', async () => {
    expect(homepage).toContain('href="/assets/favicon.svg"');
    expect(homepage).toContain('href="/site.webmanifest"');
    expect(homepage).toMatch(/name=["']theme-color["'][^>]*media=["']\(prefers-color-scheme: light\)["']/i);
    expect(homepage).toMatch(/name=["']theme-color["'][^>]*media=["']\(prefers-color-scheme: dark\)["']/i);
    expect(homepageCss).toContain('@media (prefers-reduced-motion: reduce)');
    expect(homepageCss).toMatch(/\.demo-modal-card[\s\S]*max-height:\s*calc\(100dvh/);
    expect(homepageCss).toMatch(/\.web-call-controls[\s\S]*flex-wrap:\s*wrap/);
    expect(homepageCss).toMatch(/\.nav-inner[\s\S]*width:\s*min\(calc\(100% - 32px\)/);
    expect(sharedCss).toMatch(/\.footer[\s\S]*padding-bottom:\s*max\(/);

    expect(manifestText).not.toBe('');
    const manifest = JSON.parse(manifestText);
    expect(manifest).toMatchObject({
      name: 'NorthStar AI Office Manager',
      short_name: 'NorthStar',
      start_url: '/',
      scope: '/',
      icons: [{
        src: '/assets/logo.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      }],
    });
    expect(JSON.stringify(manifest)).not.toMatch(/offline|service.?worker|background.?sync/i);

    const response = await request(app).get('/site.webmanifest').expect(200);
    expect(response.text).toBe(manifestText);
  });
});
