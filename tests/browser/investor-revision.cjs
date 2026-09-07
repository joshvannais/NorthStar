'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');
const root = path.resolve(__dirname,'../..');
const out = path.join(root,'outputs/investor-revision');
const screenshotDir=path.join(out,'screenshots');
fs.mkdirSync(screenshotDir,{recursive:true});
const cases=[{name:'desktop-light',width:1440,height:1000,colorScheme:'light'},
  {name:'desktop-dark-preference',width:1440,height:1000,colorScheme:'dark'},
  {name:'mobile-light',width:390,height:844,colorScheme:'light'},
  {name:'mobile-dark-preference',width:390,height:844,colorScheme:'dark'}];
const receipts=[];
const selected=process.argv[2]||'chrome';
(async()=>{
  const runtime=resolveBrowserRuntime(selected);
  const browser=await runtime.browserType.launch({executablePath:runtime.executablePath,headless:true});
  try {
    for(const setting of cases){
      const context=await browser.newContext({viewport:{width:setting.width,height:setting.height},colorScheme:setting.colorScheme,acceptDownloads:true});
      const page=await context.newPage();const errors=[],requests=[];let assertions=0;const check=(v,m)=>{assert.ok(v,m);assertions++;};
      page.on('pageerror',e=>errors.push(e.message));page.on('request',req=>{if(/^https?:/.test(req.url()))requests.push(req.url());});
      await page.goto(pathToFileURL(path.join(root,'public/unlisted/investor-forecast.html')).href);
      await page.waitForFunction(()=>window.currentNorthStarInvestorResult && document.querySelectorAll('.month-summary').length===120);
      check(await page.locator('#monthlyHeader th').count()===7,'seven desktop columns');
      check(await page.locator('.month-summary').count()===120,'120 months in main results');
      check(await page.locator('#primaryMetrics').innerText().then(t=>t.includes('Cash-recovery date unavailable')),'unconfigured cash recovery');
      check(await page.locator('#assumptionWarnings').innerText().then(t=>t.includes('Taxes unconfigured')&&t.includes('Distribution policy not configured')&&t.includes('$0 — no paid campaign scheduled')),'visible missing-authority warnings');
      check(await page.locator('#investorOwnership').inputValue()==='1','new1% terms');
      check(await page.evaluate(()=>window.currentNorthStarInvestorResult.summary.openingLegalEarmark===0 && window.currentNorthStarInvestorResult.summary.startingCompanyCash===10000 && window.currentNorthStarInvestorResult.config.cash.forecastPrelaunchLegalPayment===15000 && window.currentNorthStarInvestorResult.config.actualLegalReadinessCost===0),'forecast15k payment leaves10k opening bank and no duplicate earmark');
      check(await page.locator('#dealSummary').innerText().then(t=>t.includes('12,500')&&t.includes('15,000')),'visible founder legal planning range');
      check(await page.locator('#dealSummary').innerText().then(t=>t.includes('$25,000')&&t.includes('$10,000')&&t.includes('FORECAST prelaunch')),'visible funding-to-opening-cash bridge');
      check(await page.evaluate(()=>document.body.scrollWidth<=innerWidth+1),'no page-wide overflow');
      check(await page.evaluate(()=>document.querySelector('.monthly-table').scrollWidth<=document.querySelector('#monthlyProjectionScroll').clientWidth+2),'no sideways primary monthly table');
      check(await page.locator('.investor-view-control').evaluate(label=>{const box=label.querySelector('input').getBoundingClientRect(),text=label.querySelector('span').getBoundingClientRect();return Math.abs(box.y+box.height/2-text.y-text.height/2)<2 && text.x-box.right>=8 && text.x-box.right<=12;}),'investor checkbox sits inline beside label, not floating above');
      await page.screenshot({path:path.join(screenshotDir,setting.name+'-initial.png')});
      await page.locator('#dealSummary').scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(screenshotDir,setting.name+'-opening-bridge.png')});
      await page.locator('#monthlyDetails').scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(screenshotDir,setting.name+'-months.png')});
      // Every main detail is operated, not merely counted. Late months remain
      // in the same results area and are keyboard-operable.
      for(let month=1;month<=120;month++){
        const button=page.locator(`[data-expand-month="${month}"]`);
        await button.click();
        check(await button.getAttribute('aria-expanded')==='true',`month${month} expands`);
        check(await page.locator(`#month-detail-${month}`).isVisible(),`month${month} detail visible`);
      const detail=await page.locator(`#month-detail-${month}`).innerText();
        check(!/\b\d[\d,]*\.\d{4,}\b/.test(detail),`month${month} has no raw long decimals`);
        check(detail.includes('Cash bridge')&&detail.includes('Protections, not payments'),`month${month} detail reconciliation`);
        await button.press('Enter');
        check(await button.getAttribute('aria-expanded')==='false',`month${month} keyboard collapse`);
      }
      await page.locator('[data-jump-month="109"]').click();
      check(await page.locator('[data-expand-month="109"]').evaluate(el=>el===document.activeElement),'year10 navigation focuses month109');
      await page.locator('[data-expand-month="120"]').click();
      await page.locator('#investorView').check();
      check(await page.locator('#month-detail-120 .investor-detail').isVisible(),'optional investor detail');
      await page.locator('#month-detail-120 details summary').click();
      check(await page.locator('#month-detail-120 tbody tr').count()>=30,'complete expense ledger opens');
      await page.locator('#month-detail-120').scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(screenshotDir,setting.name+'-month120-detail.png')});
      await page.locator('#investmentAmount').fill('50000');await page.locator('#recalculate').click();
      check(await page.evaluate(()=>window.currentNorthStarInvestorResult.config.deal.impliedPostMoney===5000000),'investment changes fixed-ownership valuation');
      check(await page.locator('#dealSummary').innerText().then(t=>t.includes('5,000,000')),'valuation label follows result');
      await page.locator('#selectedMonth').fill('1');await page.locator('#selectedMonth').dispatchEvent('change');
      check(await page.locator('#primaryMetrics').innerText().then(t=>t.includes('Month 1; not collections')),'selected-month overview follows month1');
      const monthlyDownload=page.waitForEvent('download');await page.locator('#exportMonthly').click();const monthly=await monthlyDownload;
      const downloadPath=await monthly.path();const csv=fs.readFileSync(downloadPath,'utf8');
      check(csv.trim().split(/\r?\n/).length===121,'monthly export120 rows');
      check(csv.split(/\r?\n/)[0].includes('fixedCommittedOperatingCosts'),'ledger fields exported');
      const annualDownload=page.waitForEvent('download');await page.locator('#exportAnnual').click();const annual=await annualDownload;
      check(fs.readFileSync(await annual.path(),'utf8').trim().split(/\r?\n/).length===11,'annual export10 rows');
      check(fs.readFileSync(await annual.path(),'utf8').split(/\r?\n/)[0].includes('openingForecastLegalPayment'),'annual export includes opening-payment context without recurring charge');
      await page.locator('#annualDetails > summary').click();check(await page.locator('#annualRows tr').count()===10,'annual view remains optional');
      await page.locator('#exploreDetails > summary').click();
      await page.locator('#dealAdvancedInputs').locator('..').locator('summary').click();
      await page.locator('#investorOwnership').fill('20');await page.locator('#recalculate').click();
      check(await page.locator('#primaryMetrics').innerText().then(t=>t.includes('20.0%')),'ownership labels update dynamically');
      await page.locator('#save').click();await page.locator('#reset').click();check(await page.locator('#investorOwnership').inputValue()==='1','reset default1');
      await page.locator('#load').click();check(await page.locator('#investorOwnership').inputValue()==='20','saved terms restored');
      // A real old storage payload keeps10%, including its explicit policy.
      await page.evaluate(()=>localStorage.setItem('northstar-investor-calculator-v3.3',JSON.stringify({version:'3.3.0',investorOwnership:.1,cash:{distributionPayoutRatio:.5,distributionStartMonth:1}})));
      await page.locator('#load').click();check(await page.locator('#investorOwnership').inputValue()==='10','saved3.3 deal10% preserved');
      check(await page.evaluate(()=>window.currentNorthStarInvestorResult.config.cash.distributionPayoutRatio===.5),'saved payout preserved');
      check(await page.evaluate(()=>window.currentNorthStarInvestorResult.config.cash.legalReviewReserve===0),'legacy reserve not silently added');
      check(await page.evaluate(()=>window.currentNorthStarInvestorResult.config.cash.forecastPrelaunchLegalPayment===0),'legacy opening forecast payment not silently added');
      await page.locator('#reset').click();
      await page.locator('#investmentAmount').fill('-1');await page.locator('#recalculate').click();check(await page.locator('#validationSummary').innerText().then(t=>t.length>0),'invalid amount validation');
      await page.locator('#investmentAmount').fill('25000');await page.locator('#recalculate').click();
      await page.locator('#exploreDetails').evaluate(el=>el.open=true);
      const policy=page.locator('[data-path="cash.distributionPolicy"]');await policy.locator('xpath=ancestor::details').evaluateAll(items=>items.forEach(el=>el.open=true));
      await policy.selectOption('dated');await page.locator('#distributionRequestsEditor').fill('3, 10000');
      await page.locator('[data-path="cash.provisionalDistributionsWithoutTaxEstimate"]').check();
      await page.locator('#recalculate').click();
      check(await page.evaluate(()=>window.currentNorthStarInvestorResult.config.cash.distributionRequests[0].amount===10000),'dated request UI binding');
      await page.locator('[data-path="cash.legalReviewReserve"]').fill('12500');
      await page.locator('[data-path="cash.forecastPrelaunchLegalPayment"]').fill('0');
      await page.locator('#legalReviewPaymentsEditor').fill('2, 5000');await page.locator('#recalculate').click();
      check(await page.evaluate(()=>window.currentNorthStarInvestorResult.config.cash.legalReviewReserve===12500 && window.currentNorthStarInvestorResult.rows[1].legalReviewEarmark===7500 && window.currentNorthStarInvestorResult.rows[1].opex.legalReviewPayment===5000),'legal reserve and invoice UI bindings');
      // Use one worker draw so browser engine parity is actually exercised.
      await page.locator('#reset').click();
      const iterations=page.locator('[data-path="uncertainty.iterations"]');
      await iterations.locator('xpath=ancestor::details').evaluateAll(items=>items.forEach(el=>el.open=true));
      await iterations.fill('1');await page.locator('#runSimulation').click();
      await page.waitForFunction(()=>document.querySelector('#exportSimulation').disabled===false,{},{timeout:30000});
      check(await page.locator('#simulationResults').innerText().then(t=>t.length>0),'worker simulation completes');
      const simulationDownload=page.waitForEvent('download');await page.locator('#exportSimulation').click();const simulation=await simulationDownload;
      const evidence=JSON.parse(fs.readFileSync(await simulation.path(),'utf8'));
      check(evidence.normalizedConfig.cash.forecastPrelaunchLegalPayment===15000 && evidence.normalizedConfig.actualLegalReadinessCost===0 && evidence.distributionProjectionAvailable===false,'worker export retains forecast/actual opening distinction and unavailable payouts');
      check(errors.length===0,'no JS errors');check(requests.length===0,'no external browser requests');
      receipts.push({case:setting.name,assertions,monthsOpened:120,errors,externalRequests:requests,screenshots:[setting.name+'-initial.png',setting.name+'-opening-bridge.png',setting.name+'-months.png',setting.name+'-month120-detail.png']});
      await context.close();console.log(`${setting.name}: ${assertions} assertions passed;120 months opened`);
    }
  }finally{await browser.close();fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify({browser:selected,cases:receipts,qualification:'Automated installed-browser evidence, not physical-device/Safari or founder visual approval.'},null,2));}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
