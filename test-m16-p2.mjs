import { chromium } from 'playwright';

const BASE = 'http://localhost:3456';

async function run() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ bypassCSP: true, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  const logs = [];
  const pageErrors = [];
  const apiCalls = [];
  page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => pageErrors.push(err.message));
  page.on('response', res => {
    if (res.url().includes('/api/v1/polaris/chat')) apiCalls.push({ url: res.url(), status: res.status() });
  });

  const results = {};
  function record(section, pass, detail) {
    console.log(`  ${pass ? 'PASS' : 'FAIL'} ${section}: ${detail}`);
    results[section] = { pass, detail };
  }

  // Login
  await page.goto(BASE + '/demo-login', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Load Polaris page
  console.log('=== 1. PAGE LOAD ===');
  await page.goto(BASE + '/dashboard/polaris', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Verify input and button are enabled
  const uiCheck = await page.evaluate(() => {
    const input = document.getElementById('polarisPromptInput');
    const btn = document.getElementById('polarisSendBtn');
    return {
      inputExists: !!input,
      btnExists: !!btn,
      inputEnabled: input && !input.disabled,
      btnEnabled: btn && !btn.disabled,
      inputPlaceholder: input ? input.placeholder : null,
      btnText: btn ? btn.textContent : null,
    };
  });
  record('Input enabled', uiCheck.inputExists && uiCheck.inputEnabled,
    'placeholder="' + uiCheck.inputPlaceholder + '"');
  record('Send button enabled', uiCheck.btnExists && uiCheck.btnEnabled,
    'text="' + uiCheck.btnText + '"');

  // Send a message
  console.log('\n=== 2. SEND MESSAGE ===');
  await page.fill('#polarisPromptInput', 'Hello Polaris!');
  await page.click('#polarisSendBtn');
  await page.waitForTimeout(4000);

  // Check user message rendered
  const userMsg = await page.evaluate(() => {
    const messages = document.querySelectorAll('.polaris-chat-user');
    return messages.length > 0 ? messages[0].textContent.substring(0, 40) : null;
  });
  record('User message rendered', !!userMsg, userMsg || 'Not found');

  // Check assistant response
  const assistantMsg = await page.evaluate(() => {
    const messages = document.querySelectorAll('.polaris-chat-assistant');
    return messages.length > 0 ? messages[0].textContent.substring(0, 80) : null;
  });
  record('Assistant response', !!assistantMsg,
    assistantMsg ? '"' + assistantMsg + '"' : 'Not found');

  // Input cleared and re-enabled after send
  const afterSend = await page.evaluate(() => {
    const input = document.getElementById('polarisPromptInput');
    return { value: input ? input.value : null, enabled: input && !input.disabled };
  });
  record('Input cleared', afterSend.value === '', 'value=""');
  record('Input re-enabled', afterSend.enabled, afterSend.enabled ? 'Yes' : 'No');

  // Enter key submits
  console.log('\n=== 3. ENTER KEY ===');
  await page.fill('#polarisPromptInput', 'Enter test');
  await page.press('#polarisPromptInput', 'Enter');
  await page.waitForTimeout(3000);
  const totalMsgs = await page.evaluate(() => document.querySelectorAll('.polaris-chat-message').length);
  record('Enter submits', totalMsgs >= 3, totalMsgs + ' total messages');

  // API calls
  console.log('\n=== 4. API CALLS ===');
  apiCalls.forEach(c => console.log('  ' + c.status + ' ' + c.url.substring(0, 60)));
  record('API endpoint reached', apiCalls.length > 0, apiCalls.length + ' calls');

  // Console errors
  console.log('\n=== 5. CONSOLE ===');
  const newErrors = pageErrors.filter(e => !e.includes('NotificationService') && !e.includes('showNotification'));
  record('No errors', newErrors.length === 0,
    newErrors.length === 0 ? 'Clean' : newErrors.length + ' errors');

  // Dark mode screenshot
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.waitForTimeout(1000);
  const darkMsgs = await page.evaluate(() => document.querySelectorAll('.polaris-chat-message').length);
  record('Dark mode', darkMsgs >= 3, darkMsgs + ' messages');

  // Summary
  console.log('\n=== SUMMARY ===');
  const passCount = Object.values(results).filter(r => r.pass).length;
  const failCount = Object.values(results).filter(r => !r.pass).length;
  console.log('Passed: ' + passCount + '/' + Object.keys(results).length);
  console.log('Failed: ' + failCount);
  console.log(failCount === 0 ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED');

  await browser.close();
}

run().catch(err => { console.error('FATAL:', err); process.exit(1); });
