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
  const nav = read('public/js/nav-component.js');
  const commandCenter = read('public/dashboard/command-center.html');
  const demoDashboard = read('public/demo-dashboard.html');
  const demoRoute = read('src/routes/demo.js');
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

  test('the account-free guided call preserves seven industries and all nine scenario choices', () => {
    const industryBlock = blockById(homepage, 'demoIndustry');
    const industries = attributeValues(industryBlock, 'value').filter(Boolean);
    expect(industries).toEqual([
      'Roofing',
      'HVAC',
      'Plumbing',
      'Electrical',
      'Landscaping',
      'Cleaning',
      'General',
    ]);

    const expectedScenarios = [
      'emergency',
      'estimate',
      'price-shopper',
      'returning',
      'insurance',
      'difficult',
      'scheduling-conflict',
      'billing',
      'custom',
    ];
    expect(attributeValues(blockById(homepage, 'scenarioChips'), 'data-scenario').sort())
      .toEqual([...expectedScenarios].sort());
    expect(attributeValues(blockById(homepage, 'modalScenarioChips'), 'data-scenario').sort())
      .toEqual([...expectedScenarios].sort());
    expect(homepageDemo).toContain("var CONNECTION_TIMEOUT_MS = 10000;");
    for (const scenario of expectedScenarios) expect(homepageDemo).toContain("'" + scenario + "'");
  });

  test('the coaching dialog validates first, cannot be backdrop-dismissed, and stays accessible', () => {
    expect(homepage).toMatch(/id=["']demoFormNotice["'][^>]*role=["']status["'][^>]*aria-live=["']polite["']/i);
    expect(homepage).toMatch(/id=["']preCallModal["'][^>]*role=["']dialog["'][^>]*aria-modal=["']true["']/i);
    expect(homepage).toContain('One Quick Tip Before We Call');
    expect(homepage).toContain('id="selectedScenarioContext"');
    expect(homepageDemo).toMatch(/function showPreCallModal\(\)[\s\S]*validateForm\(\)[\s\S]*openDialog\(/);
    expect(homepageDemo).not.toMatch(/target\s*===\s*(?:modal|overlay)|dismissOutside|backdrop/i);
    expect(homepageDemo).toMatch(/previousFocus/);
    expect(homepageDemo).toMatch(/aria-hidden/);
    expect(homepageDemo).not.toMatch(/\balert\s*\(|\bconfirm\s*\(|\bprompt\s*\(/);
  });

  test('the selected scenario drives a provider-free browser preview with bounded recovery', () => {
    expect(homepage).toContain('This guided preview runs in your browser');
    expect(homepageDemo).toContain('NorthStarHomepageDemo');
    expect(homepageDemo).toContain('NorthStarTranscriptRenderer.render');
    expect(homepageDemo).toMatch(/scenario\.turns/);
    expect(homepageDemo).toMatch(/connectionTimer\s*=\s*global\.setTimeout/);
    expect(homepageDemo).toMatch(/CONNECTION_TIMEOUT_MS/);
    expect(homepageDemo).toContain('The guided call took too long to start.');
    expect(homepageDemo).not.toMatch(/\/api\/demo\/call|\/:id\/simulate|RETELL|TWILIO|fetch\s*\(/i);
    expect(homepage).not.toMatch(/href=["']\/demo-login/i);
    expect(demoRoute).toContain("outboundCalls: false");
    expect(demoRoute).toContain("guidedPreview: true");
    expect(demoRoute).toContain("code: 'demo_external_action_retired'");

    const legacyInlineEnd = homepage.lastIndexOf('function resetDemo');
    const moduleDeclaration = homepage.lastIndexOf('/js/homepage-demo.js');
    expect(moduleDeclaration).toBeGreaterThan(legacyInlineEnd);
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
    expect(homepageCss).toMatch(/\.demo-scenarios[\s\S]*flex-wrap:\s*wrap/);
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
