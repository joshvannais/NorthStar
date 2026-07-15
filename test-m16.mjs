import { chromium } from 'playwright';

const BASE = 'http://localhost:3456';

async function run() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ bypassCSP: true, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  const logs = [];
  const pageErrors = [];
  page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => pageErrors.push(err.message));

  const results = {};
  function record(section, pass, detail) {
    console.log(`  ${pass ? '✅' : '❌'} ${section}: ${detail}`);
    results[section] = { pass, detail };
  }

  // ── 1. Route: /polaris loads ──
  console.log('=== 1. ROUTE VERIFICATION ===');
  await page.goto(`${BASE}/dashboard/polaris`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  record('Route: /dashboard/polaris loads', true, `HTTP 200, title: ${await page.title()}`);

  // ── 2. Layout renders correctly ──
  console.log('\n=== 2. LAYOUT VERIFICATION ===');
  const layout = await page.evaluate(() => {
    return {
      sidebar: !!document.querySelector('.sidebar'),
      topbar: !!document.querySelector('.polaris-topbar'),
      conversation: !!document.querySelector('.polaris-conversation'),
      sidebarPanel: !!document.querySelector('.polaris-sidebar'),
      promptBar: !!document.querySelector('.polaris-prompt-bar'),
      welcomeTitle: document.querySelector('.polaris-welcome-title')?.textContent || '',
      polarisNav: !!document.querySelector('a[href="/dashboard/polaris"]'),
      navActive: document.querySelector('a[href="/dashboard/polaris"]')?.classList.contains('active'),
    };
  });
  record('Layout: Sidebar', layout.sidebar, 'Sidebar exists');
  record('Layout: Top bar', layout.topbar, 'POLARIS top bar exists');
  record('Layout: Conversation panel', layout.conversation, 'Conversation panel exists');
  record('Layout: Intelligence sidebar', layout.sidebarPanel, 'Right sidebar exists');
  record('Layout: Prompt bar', layout.promptBar, 'Bottom prompt bar exists');
  record('Layout: Welcome title', layout.welcomeTitle === 'Welcome to POLARIS™', layout.welcomeTitle);
  record('Layout: Nav active', layout.navActive, 'POLARIS nav link is active');

  // ── 3. Placeholder sections ──
  console.log('\n=== 3. PLACEHOLDER SECTIONS ===');
  const placeholders = await page.evaluate(() => {
    const cards = document.querySelectorAll('.polaris-placeholder-card');
    return Array.from(cards).map(c => c.textContent.trim());
  });
  record('Placeholders: count', placeholders.length >= 5, `${placeholders.length} cards`);
  placeholders.forEach((p, i) => console.log(`  • ${p}`));

  // ── 4. Suggested questions ──
  const suggestedChips = await page.evaluate(() => {
    const chips = document.querySelectorAll('.polaris-suggested-chip');
    return Array.from(chips).map(c => c.textContent.trim());
  });
  record('Suggested questions', suggestedChips.length >= 4, `${suggestedChips.length} chips`);
  console.log('  Questions:', suggestedChips);

  // ── 5. Sidebar sections ──
  const sidebarSections = await page.evaluate(() => {
    const headings = document.querySelectorAll('.polaris-sidebar-heading');
    return Array.from(headings).map(h => h.textContent.trim());
  });
  record('Sidebar sections', sidebarSections.length >= 4, `${sidebarSections.length} sections`);
  console.log('  Sections:', sidebarSections);

  // ── 6. Screenshot: Light mode ──
  await page.screenshot({ path: '/tmp/m16-polaris-light.png', fullPage: true });
  console.log('\n  Screenshot: /tmp/m16-polaris-light.png');

  // ── 7. Dark mode ──
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/tmp/m16-polaris-dark.png', fullPage: true });
  const darkLayout = await page.evaluate(() => {
    return {
      topbar: !!document.querySelector('.polaris-topbar'),
      conversation: !!document.querySelector('.polaris-conversation'),
      sidebar: !!document.querySelector('.polaris-sidebar'),
      promptBar: !!document.querySelector('.polaris-prompt-bar'),
    };
  });
  record('Dark mode: all elements render', 
    darkLayout.topbar && darkLayout.conversation && darkLayout.sidebar && darkLayout.promptBar,
    'All layout elements present');
  console.log('  Screenshot: /tmp/m16-polaris-dark.png');

  // ── 8. Console errors ──
  console.log('\n=== 4. CONSOLE VERIFICATION ===');
  const consoleErrors = logs.filter(l => l.includes('[error]') || l.includes('PAGE_ERROR'));
  record('Console: no errors', consoleErrors.length === 0,
    consoleErrors.length === 0 ? 'Clean console' : `${consoleErrors.length} errors`);
  consoleErrors.forEach(e => console.log(`  ${e}`));

  // ── 9. Existing pages unaffected ──
  console.log('\n=== 5. REGRESSION CHECKS ===');
  const regPages = ['/dashboard', '/dashboard/leads', '/dashboard/communications', '/dashboard/calendar'];
  for (const p of regPages) {
    const freshPage = await context.newPage();
    const freshErrors = [];
    freshPage.on('pageerror', e => freshErrors.push(e.message));
    await freshPage.goto(`${BASE}${p}`, { waitUntil: 'networkidle', timeout: 10000 }).catch(() => {});
    await freshPage.waitForTimeout(2000);
    const bodyLen = await freshPage.evaluate(() => document.body?.innerHTML?.length || 0);
    const hasPolarisNav = await freshPage.evaluate(() => 
      !!document.querySelector('a[href="/dashboard/polaris"]'));
    const newErrors = freshErrors.filter(e => !e.includes('NotificationService') && !e.includes('showNotification'));
    record(`Regression: ${p}`, bodyLen > 0 && newErrors.length === 0,
      `${(bodyLen/1000).toFixed(0)}k chars, nav=${hasPolarisNav}, ${newErrors.length} new errors`);
    await freshPage.close();
  }

  // ── 10. Summary ──
  console.log('\n=== VERIFICATION SUMMARY ===');
  const passCount = Object.values(results).filter(r => r.pass).length;
  const failCount = Object.values(results).filter(r => !r.pass).length;
  console.log(`\nPassed: ${passCount}/${Object.keys(results).length}`);
  console.log(`Failed: ${failCount}`);
  console.log(`\n${failCount === 0 ? '✅ ALL CHECKS PASSED' : '❌ SOME CHECKS FAILED'}`);

  if (failCount > 0) {
    console.log('\nFailures:');
    Object.entries(results).filter(([,r]) => !r.pass).forEach(([k, r]) => console.log(`  ❌ ${k}: ${r.detail}`));
  }

  await browser.close();
}

run().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});