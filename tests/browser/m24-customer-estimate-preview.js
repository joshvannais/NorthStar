'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');

function pngSize(file) { const value=fs.readFileSync(file);assert.equal(value.subarray(1,4).toString(),'PNG');return{width:value.readUInt32BE(16),height:value.readUInt32BE(20)}; }

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
const versionRequests = [];
const failures = { pdf:0, brand:0 };
const dependencyRequests = { pdf:0, brand:0 };
const app = express();
app.get('/test/fail-once', (req, res) => {
  assert.ok(Object.prototype.hasOwnProperty.call(failures, req.query.kind));
  failures[req.query.kind] = 1;
  res.sendStatus(204);
});
app.get('/js/vendor/pdfmake/pdfmake.min.js', (req, res, next) => {
  dependencyRequests.pdf += 1;
  if (failures.pdf > 0) { failures.pdf -= 1; return res.status(503).type('text').send('transient test failure'); }
  next();
});
app.get('/assets/logo.png', (req, res, next) => {
  if (req.query['customer-estimate-export'] !== '1') return next();
  dependencyRequests.brand += 1;
  if (failures.brand > 0) { failures.brand -= 1; return res.status(503).type('text').send('transient test failure'); }
  next();
});
app.use('/css', express.static(path.resolve(__dirname, '../../public/css')));
app.use('/js', express.static(path.resolve(__dirname, '../../public/js')));
app.use('/assets', express.static(path.resolve(__dirname, '../../public/assets')));
app.use(express.json());
app.get('/api/demo/command-center/estimates/:estimateId/customer-estimate-preview', (req, res) => {
  requests.push(req.path);
  res.json({ success:true, data:req.params.estimateId === boundaryId ? boundaryEstimate : estimate });
});
app.get('/api/demo/command-center/estimates/:estimateId/customer-estimate-versions',(req,res)=>res.json({success:true,data:{current:null,history:[],total:0,truncated:false}}));
app.post('/api/demo/command-center/estimates/:estimateId/customer-estimate-versions',(req,res)=>{versionRequests.push({intent:req.get('X-NorthStar-Demo-Intent'),revision:req.get('X-NorthStar-Demo-Revision'),body:req.body});res.status(201).json({success:true,data:{replayed:false,receipt:{id:'20000000-0000-4000-8000-000000000001',revision:1,previousId:null,actorName:'Demo reviewer',reason:req.body.reason,approvalPin:{id:'30000000-0000-4000-8000-000000000001',digest:'a'.repeat(64)},document:{...estimate,state:'issued',notice:'Fictional demo estimate for product evaluation. No customer was contacted.'},createdAt:'2026-09-15T13:00:00.000Z'}}});});
app.get(['/', '/boundary', '/not-ready'], (req, res) => {
  const id = req.path === '/boundary' ? boundaryId : ordinaryId;
  const commercial = req.path === '/not-ready' ? `{approvalState:'not_approved',sources:{pricingCurrent:false}}` : `{approvalState:'commercial_approved',customerSummary:{},binding:{id:'30000000-0000-4000-8000-000000000001',digest:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'},current:{current:true}}`;
  const target = req.path === '/not-ready' ? `<details id="cdEstimateDetails"><summary>Estimate Details</summary><details id="cdPreparedAdoption"><summary>Review And Save</summary></details></details>` : '';
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/css/style.css"><link rel="stylesheet" href="/css/site-professionalism.css"></head><body><main id="host"></main>${target}<script>window.NorthStarAccountSession={fetch:window.fetch.bind(window)};window.review={simulated:true,demoWorkspaceRevision:7,pins:{estimateId:'${id}'},commercialTerms:${commercial}};</script><script src="/js/customer-estimate-preview.js"></script><script>NorthStarCustomerEstimate.mount(review,document.getElementById('host'));</script></body></html>`);
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
      await page.getByRole('dialog', { name:'Customer Estimate Preview' }).waitFor();
      const dialog = page.getByRole('dialog', { name:'Customer Estimate Preview' });
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
      const labelFonts = await dialog.locator('.customer-estimate-label,.customer-estimate-kicker').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).fontFamily));
      assert.equal(new Set(labelFonts).size, 1);
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
      assert.equal(pngSize(imagePath).width,1600);
      await page.keyboard.press('Escape');
      assert.equal(await dialog.count(), 0);
      assert.equal(await launch.evaluate(node => document.activeElement === node), true);
      assert.deepEqual(errors, []);
      ledger.cases.push({name:test.name,pdf:pdf.suggestedFilename(),image:image.suggestedFilename(),universalImageWidth:1600,boundedContent:true,focusContainedAndRestored:true,consistentSectionLabelFont:true,noInteractiveCustomerActions:true});
      await context.close();
    }
    {
      const context = await browser.newContext({ viewport:{width:390,height:844} });
      const page = await context.newPage();
      await page.goto(origin + '/not-ready');
      const before = requests.length;
      const continueButton = page.getByRole('button', { name:'Continue Estimate' });
      assert.equal(await continueButton.isVisible(), true);
      await continueButton.click();
      assert.equal(await page.locator('#cdEstimateDetails').evaluate(node => node.open), true);
      assert.equal(await page.locator('#cdPreparedAdoption').evaluate(node => node.open), true);
      assert.equal(requests.length, before);
      ledger.cases.push({name:'needs-review-entry',persistent:true,noPreviewRequest:true});
      await context.close();
    }
    {
      const context=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true}),page=await context.newPage();await page.goto(origin+'/');const issue=page.getByRole('button',{name:'Issue Estimate'});await issue.waitFor();await issue.click();await page.getByLabel('Reason for issuing').fill('Owner approved customer-facing estimate');await page.getByLabel(/I reviewed the customer-facing scope/).check();await page.getByRole('button',{name:'Confirm Issue'}).click();const dialog=page.getByRole('dialog',{name:'Customer Estimate Preview'});await dialog.waitFor();assert.equal(await dialog.getByText('Issued',{exact:true}).count(),1);assert.equal(await page.getByRole('button',{name:'View Issued Estimate'}).count(),1);assert.deepEqual(versionRequests,[{intent:'customer-estimate-issue',revision:'7',body:{reason:'Owner approved customer-facing estimate',confirmed:true,confirmationVersion:'customer-estimate-issue-v1'}}]);const issuedPdfEvent=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download PDF'}).click();const issuedPdf=await issuedPdfEvent,issuedPdfPath=path.join(output,'issued.pdf');await issuedPdf.saveAs(issuedPdfPath);assert.ok(fs.readFileSync(issuedPdfPath).subarray(0,5).toString().startsWith('%PDF-'));const issuedImageEvent=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download image'}).click();const issuedImage=await issuedImageEvent,issuedImagePath=path.join(output,'issued-download.png');await issuedImage.saveAs(issuedImagePath);assert.equal(pngSize(issuedImagePath).width,1600);await page.screenshot({path:path.join(output,'issued-mobile.png'),fullPage:true});ledger.cases.push({name:'explicit-issue-and-view',immutableVersion:true,issuedPdfAndImage:true,universalImageWidth:1600,noDeliveryClaim:true});await context.close();
    }
    for (const recovery of [
      {kind:'pdf',button:'Download PDF',message:'The PDF could not be prepared. Try again.',extension:'.pdf'},
      {kind:'brand',button:'Download image',message:'The image could not be prepared. Try again.',extension:'.png'},
    ]) {
      const context = await browser.newContext({ viewport:{width:900,height:780}, acceptDownloads:true });
      const page = await context.newPage();
      await page.goto(origin + '/');
      await page.getByRole('button', { name:'Preview Customer Estimate' }).click();
      const dialog = page.getByRole('dialog', { name:'Customer Estimate Preview' });
      await dialog.waitFor();
      await dialog.locator('img.customer-estimate-mark').evaluate(node => node.complete && node.naturalWidth > 0);
      const before = dependencyRequests[recovery.kind];
      await page.evaluate(kind => fetch('/test/fail-once?kind=' + kind).then(response => response.ok), recovery.kind);
      const button = dialog.getByRole('button', { name:recovery.button });
      await button.click();
      await dialog.getByText(recovery.message, { exact:true }).waitFor();
      assert.equal(await button.isEnabled(), true);
      assert.equal(dependencyRequests[recovery.kind], before + 1);
      const downloadEvent = page.waitForEvent('download');
      await button.click();
      const download = await downloadEvent;
      assert.ok(download.suggestedFilename().endsWith(recovery.extension));
      assert.equal(dependencyRequests[recovery.kind], before + 2);
      ledger.cases.push({name:'transient-' + recovery.kind + '-retry',recovered:true,requests:2});
      await context.close();
    }
    assert.deepEqual(requests, [ordinaryId, ordinaryId, boundaryId, ordinaryId, ordinaryId].map(id => '/api/demo/command-center/estimates/' + id + '/customer-estimate-preview'));
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
