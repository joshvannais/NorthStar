'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');
process.env.NODE_ENV = 'test';
process.env.AUTH_ACCESS_SECRET = 'm25-part13h-learning-center-browser-secret-20260918';
for (const key of ['DATABASE_URL','MIGRATION_DATABASE_URL','OPENAI_API_KEY','RETELL_API_KEY','STRIPE_SECRET_KEY']) delete process.env[key];
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const engine = process.argv[2], output = path.resolve(process.argv[3]), captureRoot = path.resolve(process.argv[4]);
const layouts = [
  { name:'phone-narrow-dark', width:360, height:800, theme:'dark' }, { name:'phone-light', width:390, height:844, theme:'light' },
  { name:'tablet-portrait-dark', width:768, height:1024, theme:'dark' }, { name:'tablet-landscape-light', width:1024, height:768, theme:'light' },
  { name:'desktop-dark', width:1440, height:900, theme:'dark' },
];
const forbidden = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\[object Object\]|\bM25_[A-Z0-9_]+|request\s+id\b|\b(?:credentials?|token|schema|digest|revision|projection|authority|idempotency|internal state)\b/i;
const digest = 'a'.repeat(64), opaque = '11111111-1111-4111-8111-111111111111';
const consent = { current:{ revision:1, digest, action:'grant' }, history:[], total:1, truncated:false };
const preview = { version:'m25-job-outcome-proposal-registry-preview-v1', serviceKey:'tree-service', cohortSize:7, status:'review_available', availableImpactCount:1, unavailableImpactCount:0,
  areas:[{ area:'labor', label:'Labor', status:'review_available', measures:[{ metric:{ metricKey:'worker_hours', label:'Worker hours', basis:'NorthStar worker hours' }, impact:{ status:'relative_review', planningArea:'labor_planning', direction:'increase', changePercent:'12.50', statement:'Future worker-hour planning would be reviewed at 12.5 percent higher.', absoluteValueStatus:'unavailable' } }] }], uncertaintyBoundary:'This sample describes seven selected completed jobs. It is not a forecast or promise.' };
const center = { version:'m25-learning-center-v6', authority:'tenant_private_postgresql', evaluatedAt:'2026-09-18T12:00:00.000Z', sources:[], sourceTotal:0, sourcesTruncated:false, outcomeServiceKeys:['tree-service'], outcomeServiceTotal:1, outcomeServicesTruncated:false,
  nativeLabor:{ active:false, current:null }, nativeEquipment:{ active:false, current:null }, nativeMaterial:{ active:false, current:null }, learningBoundary:'Learning remains advisory. NorthStar does not automatically change company records or business policy.' };
const proposal = { activeConsent:true, current:{ id:opaque, digest, fresh:true, available:true, cohortSize:7, statusMessage:'Advice from the selected comparable jobs is ready for review.' }, history:[], total:1, truncated:false };
const registry = { activeConsent:true, current:{ id:opaque, digest, previewDigest:digest, fresh:true, available:true, preview, statusMessage:'This saved proposal preview is ready for owner review.' }, history:[], total:1, truncated:false };
function planning(status='current') { return { serviceKey:'tree-service', current:[{ id:opaque, revision:1, digest, state:'active', planningArea:'labor_planning', metricKey:'worker_hours', basis:'NorthStar worker hours', multiplier:'1.125000', statusMessage:status==='current'?'This owner-adopted service planning value is current.':'Permission for this learning source was removed. The adopted value remains in place for owner review.', lineage:{ status, requiresOwnerReview:status!=='current', planningValueInEffect:true } }], history:[], total:1, truncated:false }; }
const ledger = { engine, demoLayouts:[], paidLayouts:[], cases:[], pageErrors:[], externalRequests:[], pass:false };
let browser, server, fixture;
function body(data) { return JSON.stringify({ success:true, data }); }
async function routePaid(context, origin, lifecycle='current', mutations=[]) {
  await context.route('**/*', route => { const url = new URL(route.request().url()); if (url.origin !== origin) { ledger.externalRequests.push(url.href); return route.abort(); } return route.fallback(); });
  await context.route('**/api/v1/learning/**', async route => {
    const url = new URL(route.request().url()), pathname = url.pathname, method = route.request().method();
    if (method === 'POST') mutations.push(pathname);
    let data;
    if (pathname.endsWith('/center')) data = center;
    else if (pathname.endsWith('/job-outcome-graph/consent') || pathname.endsWith('/job-outcome-proposals/consent')) data = consent;
    else if (pathname.endsWith('/job-outcome-proposals/tree-service')) data = proposal;
    else if (pathname.endsWith('/job-outcome-proposal-registry/tree-service')) data = registry;
    else if (pathname.endsWith('/job-outcome-planning-values/tree-service')) data = planning(lifecycle);
    else if (pathname.endsWith('/job-outcome-planning-values/tree-service/adoption-preview')) data = { registryVersionId:opaque, expectedRegistryDigest:digest, expectedPreviewDigest:digest, planningArea:'labor_planning', metricKey:'worker_hours', basis:'NorthStar worker hours', multiplier:'1.125000', direction:'increase', selectionDigest:digest };
    else if (pathname.endsWith('/job-outcome-planning-values/tree-service/adoptions') || pathname.endsWith('/job-outcome-planning-values/tree-service/rollbacks')) data = { planningValue:planning().current[0], replayed:false };
    else return route.fallback();
    return route.fulfill({ status:method==='POST'?201:200, contentType:'application/json', body:body(data) });
  });
}
(async()=>{
 try {
  fs.mkdirSync(captureRoot,{recursive:true}); fixture=await createDatabaseFixture(); server=fixture.app.listen(0,'127.0.0.1'); await new Promise(resolve=>server.once('listening',resolve)); const origin=`http://127.0.0.1:${server.address().port}`;
  const runtime=resolveBrowserRuntime(engine); browser=await runtime.browserType.launch({headless:true,executablePath:runtime.executablePath}); ledger.browserVersion=browser.version();
  for(const layout of layouts){
   const context=await browser.newContext({viewport:{width:layout.width,height:layout.height},reducedMotion:'reduce'}); await context.addInitScript(theme=>localStorage.setItem('northstar-theme',theme),layout.theme);
   await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==origin){ledger.externalRequests.push(url.href);return route.abort();}return route.continue();});
   const page=await context.newPage(); page.on('pageerror',error=>ledger.pageErrors.push(`demo-${layout.name}: ${error.message}`)); await page.goto(`${origin}/demo/learning-center`,{waitUntil:'networkidle'});
   await page.getByRole('heading',{name:'Review planning suggestions'}).waitFor(); await page.getByText(/This is fictional demonstration data/).waitFor();
   const text=await page.locator('#jobOutcomeReview').innerText(); for(const phrase of ['Completed job comparisons','Planning suggestions','Evidence review','Current owner planning values','Current multiplier: 1.08×']) assert.match(text,new RegExp(phrase,'i')); assert.doesNotMatch(await page.locator('body').innerText(),forbidden);
   assert.equal(await page.locator('#jobOutcomeReview button:not([disabled])').count(),0); const geometry=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth})); assert.ok(geometry.scrollWidth<=geometry.width,JSON.stringify(geometry));
   const capture=path.join(captureRoot,`${engine}-demo-${layout.name}.png`); await page.screenshot({path:capture,fullPage:true}); ledger.demoLayouts.push({...layout,capture}); await page.evaluate(()=>scrollTo(0,document.body.scrollHeight)); await page.reload({waitUntil:'networkidle'}); await page.getByRole('heading',{name:'Review planning suggestions'}).waitFor(); assert.equal(await page.evaluate(()=>scrollY),0); await context.close();
  }
  for(const [index,layout] of layouts.entries()){
   const mutations=[],context=await browser.newContext({viewport:{width:layout.width,height:layout.height},reducedMotion:'reduce'}); await context.addInitScript(theme=>localStorage.setItem('northstar-theme',theme),layout.theme); await context.addCookies(Object.entries(fixture.actors.owner.session.cookies).map(([name,value])=>({name,value,url:origin,sameSite:'Lax',httpOnly:name!=='northstar_csrf'}))); await routePaid(context,origin,'current',mutations);
   const page=await context.newPage(); page.on('pageerror',error=>ledger.pageErrors.push(`paid-${layout.name}: ${error.message}`)); await page.goto(`${origin}/dashboard/learning-center`,{waitUntil:'networkidle'}); await page.getByText('Current multiplier: 1.13×').waitFor();
   assert.equal(await page.getByLabel('Service to review').inputValue(),'tree-service'); assert.doesNotMatch(await page.locator('body').innerText(),forbidden); const geometry=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth})); assert.ok(geometry.scrollWidth<=geometry.width,JSON.stringify(geometry));
   if(index===0){ await page.getByRole('button',{name:'Review for adoption'}).click(); await page.getByText(/Proposed future planning multiplier: 1.13×/).waitFor(); await page.getByLabel(/I understand this changes/).check(); await page.getByRole('button',{name:'Adopt planning value'}).click(); await page.getByRole('button',{name:'Review rollback'}).click(); await page.getByLabel(/I understand this removes/).check(); await page.getByRole('button',{name:'Remove planning value'}).click(); assert.ok(mutations.some(value=>value.endsWith('/adoptions'))); assert.ok(mutations.some(value=>value.endsWith('/rollbacks'))); }
   const capture=path.join(captureRoot,`${engine}-paid-${layout.name}.png`); await page.screenshot({path:capture,fullPage:true}); ledger.paidLayouts.push({...layout,capture}); await context.close();
  }
  for(const lifecycle of ['proposal_superseded','permission_revoked','permission_replaced','evidence_changed_or_unavailable','lineage_unavailable']){
   const context=await browser.newContext({viewport:{width:390,height:844}}); await context.addCookies(Object.entries(fixture.actors.owner.session.cookies).map(([name,value])=>({name,value,url:origin,sameSite:'Lax',httpOnly:name!=='northstar_csrf'}))); await routePaid(context,origin,lifecycle,[]); const page=await context.newPage(); page.on('pageerror',error=>ledger.pageErrors.push(`${lifecycle}: ${error.message}`)); await page.goto(`${origin}/dashboard/learning-center`,{waitUntil:'networkidle'}); await page.locator('#jobOutcomeReview .learning-pill[data-state="review"]').last().waitFor(); assert.doesNotMatch(await page.locator('#jobOutcomeReview').innerText(),forbidden); await context.close();
  }
  const errorContext=await browser.newContext({viewport:{width:390,height:844}}); await errorContext.addCookies(Object.entries(fixture.actors.owner.session.cookies).map(([name,value])=>({name,value,url:origin,sameSite:'Lax',httpOnly:name!=='northstar_csrf'}))); await errorContext.route('**/api/v1/learning/job-outcome-graph/consent',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'M25_PRIVATE_FAILURE'},requestId:opaque})})); await errorContext.route('**/api/v1/learning/center',route=>route.fulfill({status:200,contentType:'application/json',body:body(center)})); const errorPage=await errorContext.newPage(); errorPage.on('pageerror',error=>ledger.pageErrors.push(`error: ${error.message}`)); await errorPage.goto(`${origin}/dashboard/learning-center`,{waitUntil:'networkidle'}); await errorPage.getByText('Completed job learning is temporarily unavailable. Refresh and try again.').waitFor(); assert.doesNotMatch(await errorPage.locator('body').innerText(),forbidden); await errorContext.close();
  ledger.cases.push('Five demo and five paid owner layouts show evidence, uncertainty, adoption and rollback without overflow or internal identifiers.'); ledger.cases.push('Stale, revoked, replaced and unavailable lifecycle states remain visible while adopted values stay explicit.'); ledger.cases.push('Structured failures become one plain recovery message.'); assert.deepEqual(ledger.pageErrors,[]); assert.deepEqual(ledger.externalRequests,[]); ledger.pass=true;
 }catch(error){ledger.error=error.stack;process.exitCode=1;}finally{fs.writeFileSync(output,JSON.stringify(ledger,null,2));await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));await fixture?.cleanup();}
})();
