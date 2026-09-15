'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');

const arg = name => process.argv.find(value => value.startsWith('--' + name + '=')).slice(name.length + 3);
const engine = arg('browser');
const output = path.resolve(arg('output'));
assert.ok(!fs.existsSync(output));
fs.mkdirSync(output, { recursive: true });

const ordinaryId = '10000000-0000-4000-8000-000000000001';
const boundaryId = '10000000-0000-4000-8000-000000000002';
const estimate = {
  contract:'NorthStarCustomerEstimatePreview/v1', simulated:true,
  issuer:{name:'Windsor Tree Company',dba:'',email:'office@example.com',phone:'(860) 555-0100',website:'windsortree.example',address:'100 Main Street, Windsor, CT 06095'},
  customer:{name:'Jordan Blake',address:'12 Maple Street, Windsor, CT 06095'},
  work:{title:'Tree removal',scope:'Remove one mature maple near the rear property line. Chip brush, remove logs, and leave the work area broom clean.'},
  currency:'USD',
  charges:[{label:'Tree removal and site cleanup',kind:'charge',amount:'1400.00'},{label:'Permit coordination',kind:'fee',amount:'75.00'}],
  adjustments:[{label:'Scheduling adjustment',amount:'-50.00'}],
  taxes:[{label:'Connecticut sales tax',treatment:'taxable',amount:'93.66'}],
  subtotal:'1475.00',tax:'93.66',total:'1568.66',
  payments:[{label:'Deposit',kind:'deposit',amount:'400.00'},{label:'Balance after completion',kind:'balance',amount:'1168.66'}],
  preparedAt:'2026-09-15T12:30:00.000Z',reference:'EST-2A4C9D118E',state:'preview',
  notice:'Fictional demo estimate for product evaluation. No customer was contacted.',
  capabilities:{downloadPdf:true,downloadImage:true,accept:false,askQuestion:false},
  platformSignature:'Powered by NorthStar',
};
const boundaryEstimate = {
  ...estimate,
  issuer:{...estimate.issuer,name:'Café 李 Tree Company'},
  customer:{...estimate.customer,name:'José O’Neil 李'},
  work:{title:'Tree removal',scope:'S'.repeat(4000)},
  charges:[{label:'L'.repeat(200),kind:'charge',amount:'1400.00'}],
  reference:'EST-BOUNDARY1',
};

const requests = [];
const app = express();
app.use('/css', express.static(path.resolve(__dirname, '../../public/css')));
app.use('/js', express.static(path.resolve(__dirname, '../../public/js')));
app.use('/assets', express.static(path.resolve(__dirname, '../../public/assets')));
app.get('/api/demo/command-center/estimates/:estimateId/customer-estimate-preview', (req, res) => {
  requests.push(req.path);
  res.json({ success:true, data:req.params.estimateId === boundaryId ? boundaryEstimate : estimate });
});
app.get(['/', '/boundary'], (req, res) => {
  const id = req.path === '/boundary' ? boundaryId : ordinaryId;
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/css/style.css"><link rel="stylesheet" href="/css/site-professionalism.css"></head><body><main id="host"></main><script>window.NorthStarAccountSession={fetch:window.fetch.bind(window)};window.review={simulated:true,pins:{estimateId:'${id}'},commercialTerms:{customerSummary:{}}};</script><script src="/js/customer-estimate-preview.js"></script><script>NorthStarCustomerEstimate.mount(review,document.getElementById('host'));</script></body></html>`);
});

let server;
let browser;
(async () => {
  const ledger = { pass:false, cases:[] };
  try {
    server = await new Promise(resolve => {
      const value = app.listen(0, '127.0.0.1', () => resolve(value));
    });
    const origin = 'http://127.0.0.1:' + server.address().port;
    const { browserType, executablePath } = resolveBrowserRuntime(engine);
    browser = await browserType.launch({ headless:true, executablePath });
    const cases = [
      {name:'light-desktop',theme:'light',viewport:{width:1280,height:900},path:'/'},
      {name:'dark-mobile',theme:'dark',viewport:{width:390,height:844},path:'/'},
      {name:'boundary-mobile',theme:'dark',viewport:{width:390,height:844},path:'/boundary',boundary:true},
    ];
    for (const test of cases) {
      const context = await browser.newContext({ viewport:test.viewport, acceptDownloads:true });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin + test.path);
      await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), test.theme);
      const launch = page.getByRole('button', { name:'Preview Customer Estimate' });
      await launch.click();
      await page.getByRole('dialog', { name:'Customer estimate preview' }).waitFor();
      const dialog = page.getByRole('dialog', { name:'Customer estimate preview' });
      const close = dialog.getByRole('button', { name:'Close customer estimate preview' });
      const imageButton = dialog.getByRole('button', { name:'Download image' });
      assert.equal(await close.evaluate(node => document.activeElement === node), true);
      await page.keyboard.press('Shift+Tab');
      assert.equal(await imageButton.evaluate(node => document.activeElement === node), true);
      await page.keyboard.press('Tab');
      assert.equal(await close.evaluate(node => document.activeElement === node), true);
      assert.equal(await dialog.getByText('$1,568.66', { exact:true }).count(), 1);
      assert.equal(await dialog.getByText('Scheduling adjustment (included)', { exact:true }).count(), 1);
      assert.equal(await dialog.getByText('Connecticut sales tax · Taxable', { exact:true }).count(), 1);
      assert.equal(await dialog.getByText('Powered by NorthStar', { exact:true }).count(), 1);
      const mark = dialog.locator('img.customer-estimate-mark');
      assert.equal(await mark.count(), 1);
      assert.equal(await mark.evaluate(node => node.complete && node.naturalWidth > 0 && node.naturalHeight > 0), true);
      assert.equal(await dialog.getByRole('button', { name:/accept estimate/i }).count(), 0);
      assert.equal(await dialog.getByRole('button', { name:/ask a question/i }).count(), 0);
      const overflow = await page.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll('.customer-estimate-document,.customer-estimate-scope p,.customer-estimate-row span'));
        return {page:document.documentElement.scrollWidth <= innerWidth, content:nodes.every(node => node.scrollWidth <= node.clientWidth)};
      });
      assert.deepEqual(overflow, {page:true,content:true});
      if (test.boundary) {
        assert.equal(await dialog.getByText('Café 李 Tree Company', { exact:true }).count(), 1);
        assert.equal(await dialog.getByText('José O’Neil 李', { exact:true }).count(), 1);
      }
      await page.screenshot({ path:path.join(output, test.name + '.png'), fullPage:false });
      const pdfEvent = page.waitForEvent('download');
      await dialog.getByRole('button', { name:'Download PDF' }).click();
      const pdf = await pdfEvent;
      const pdfPath = path.join(output, test.name + '.pdf');
      await pdf.saveAs(pdfPath);
      assert.ok(fs.readFileSync(pdfPath).subarray(0, 5).toString().startsWith('%PDF-'));
      const imageEvent = page.waitForEvent('download');
      await imageButton.click();
      const image = await imageEvent;
      const imagePath = path.join(output, test.name + '-download.png');
      await image.saveAs(imagePath);
      assert.equal(fs.readFileSync(imagePath).subarray(1, 4).toString(), 'PNG');
      await page.keyboard.press('Escape');
      assert.equal(await dialog.count(), 0);
      assert.equal(await launch.evaluate(node => document.activeElement === node), true);
      assert.deepEqual(errors, []);
      ledger.cases.push({name:test.name,pdf:pdf.suggestedFilename(),image:image.suggestedFilename(),boundedContent:true,focusContainedAndRestored:true,noInteractiveCustomerActions:true});
      await context.close();
    }
    assert.deepEqual(requests, [ordinaryId, ordinaryId, boundaryId].map(id => '/api/demo/command-center/estimates/' + id + '/customer-estimate-preview'));
    ledger.demoRouteRequests = requests;
    ledger.pass = true;
    fs.writeFileSync(path.join(output, 'RESULT.json'), JSON.stringify(ledger, null, 2));
    console.log(JSON.stringify(ledger));
  } catch (error) {
    console.error(error.stack);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
})();
