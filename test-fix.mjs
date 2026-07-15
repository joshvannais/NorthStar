import { chromium } from 'playwright';

const browser = await chromium.launch({headless: true, args: ['--no-sandbox']});
const page = await browser.newPage({bypassCSP: true});

const intelligenceCalls = [];
page.on('request', req => {
  if (req.url().includes('/api/v1/polaris/intelligence')) {
    intelligenceCalls.push({ headers: req.headers(), method: req.method() });
  }
});
page.on('response', res => {
  if (res.url().includes('/api/v1/polaris/intelligence')) {
    const last = intelligenceCalls.find(c => c.status === undefined);
    if (last) last.status = res.status();
  }
});

// Login
await page.goto('http://localhost:3456/demo-login', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

// Navigate to lead page (loads polaris-engine.js)
await page.goto('http://localhost:3456/dashboard/lead?id=mrk123jsklz6yk', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

// Directly call fetchM13Intelligence
const result = await page.evaluate(async () => {
  const testLead = { id: 'test123', service: 'HVAC Repair', avgPrice: 500 };
  try {
    const estimate = await window.PolarisEngine.fetchM13Intelligence(testLead);
    return { success: true, hasTotal: Boolean(estimate && estimate.total), total: estimate ? estimate.total : null };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

console.log('=== DIRECT CALL RESULT ===');
console.log(JSON.stringify(result, null, 2));

console.log('\n=== CAPTURED REQUEST ===');
console.log(JSON.stringify(intelligenceCalls, null, 2));

const hasAuth = intelligenceCalls.some(c => c.headers && c.headers.authorization);
const got200 = intelligenceCalls.some(c => c.status === 200);
console.log('\n=== VERDICT ===');
console.log('Auth header sent: ' + hasAuth);
console.log('Response 200: ' + got200);
console.log('Function returned data: ' + result.success);
console.log('All checks passed: ' + (hasAuth && got200 && result.success));

await browser.close();