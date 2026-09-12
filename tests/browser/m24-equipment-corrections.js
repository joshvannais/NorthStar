'use strict';
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path');process.env.NODE_ENV='test';process.env.AUTH_ACCESS_SECRET='m24-equipment-browser-local-disposable-secret';for(const k of ['DATABASE_URL','MIGRATION_DATABASE_URL','OPENAI_API_KEY','RETELL_API_KEY','STRIPE_SECRET_KEY'])delete process.env[k];const{createEstimateReviewFixture}=require('../helpers/m24-estimate-review-fixture'),{resolveBrowserRuntime}=require('../helpers/playwright-runtime');const arg=n=>process.argv.find(v=>v.startsWith('--'+n+'=')).slice(n.length+3),engine=arg('browser'),out=path.resolve(arg('output'));assert.ok(!fs.existsSync(out));fs.mkdirSync(out,{recursive:true});
(async()=>{let f,server,browser;const ledger={engine,cases:[],errors:[]};try{f=await createEstimateReviewFixture({recordedLaborHours:2});await require('../helpers/m24-equipment-sources').seed(f);server=f.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin='http://127.0.0.1:'+server.address().port,rt=resolveBrowserRuntime(engine);browser=await rt.browserType.launch({headless:true,executablePath:rt.executablePath});
for(const demo of (process.argv.includes('--demo-only')?[true]:[false,true]))for(const[theme,width]of (process.argv.includes('--smoke')?[['light',1440]]:[['light',1440],['dark',390]])){const tag=(demo?'demo':'paid')+'-'+theme+'-'+width,c=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'});await c.addInitScript(t=>localStorage.setItem('northstar-theme',t),theme);if(!demo)await c.addCookies(Object.entries(f.actors.owner.session.cookies).map(([name,value])=>({name,value,url:origin,sameSite:'Lax',httpOnly:name!=='northstar_csrf'})));const p=await c.newPage();const calls=[];p.on('pageerror',e=>ledger.errors.push(e.message));p.on('request',r=>calls.push({path:new URL(r.url()).pathname,method:r.method()}));await p.goto(origin+(demo?'/demo':'/dashboard'));await p.waitForLoadState('networkidle');if(await p.locator('#northstarQuickStartDialog[open]').count())await p.keyboard.press('Escape');const graph=demo?await p.evaluate(async()=>((await(await fetch('/api/demo/command-center')).json()).data.graphs[0])):f.estimateGraphs[0];
if(demo)await p.getByRole('button',{name:graph.customer.name,exact:true}).first().click();else await p.evaluate(id=>CustomerDetail.open(id),graph.ids.customer);await p.locator('#cdEquipmentPlan').waitFor({state:'attached'});await p.waitForFunction(()=>!document.querySelector('#cdEstimateReviewRefresh').disabled);
async function expand(){const selectors=await p.locator('#cdEquipmentPlan').evaluate(e=>{const result=[];for(let x=e;x;x=x.parentElement)if(x.tagName==='DETAILS'&&!x.open)result.unshift(x.id?'#'+x.id:'.'+x.classList[0]);return result;});for(const s of selectors)await p.locator(s+' > summary').first().click();}
async function click(name){await p.getByRole('button',{name,exact:true}).focus();await p.keyboard.press('Enter');}

await expand();await click('Plan Equipment');await p.locator('#cdEquipmentTask-0').fill('Check the recorded requirements');
await p.getByText('Job Requirements',{exact:true}).click();await click('Add Requirement');
async function focused(id){assert.deepEqual(await p.locator('#'+id).evaluate(e=>({open:e.closest('details').open,focused:document.activeElement===e})),{open:true,focused:true});}
await focused('cdEquipmentRequirement-0-0');
async function keyboardChoice(id,key){await p.locator('#'+id).focus();await p.keyboard.press(key);await p.keyboard.press('Enter');await focused(id);}
await keyboardChoice('cdEquipmentRequirement-0-0-origin','End');assert.equal(await p.locator('#cdEquipmentRequirement-0-0-origin').inputValue(),'recorded_job');
const factOptions=await p.locator('#cdEquipmentRequirement-0-0-fact option').count();assert.ok(factOptions>1);
await keyboardChoice('cdEquipmentRequirement-0-0-fact','End');assert.notEqual(await p.locator('#cdEquipmentRequirement-0-0-fact').inputValue(),'');
await keyboardChoice('cdEquipmentRequirement-0-0-kind','End');assert.equal(await p.locator('#cdEquipmentRequirement-0-0-kind').inputValue(),'categorical');
await p.keyboard.press('Tab');
const reviewPath=(demo?'/api/demo/command-center':'/api/v1/canonical')+'/estimates/'+graph.ids.estimate+'/review';
const recorded=await p.evaluate(async route=>(await(await fetch(route)).json()).data,reviewPath);
const scope=recorded.equipmentPlans.sources.scope,entries=Object.entries(scope),numeric=entries.find(([k,v])=>/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$/.test(String(v))),categorical=entries.find(([k,v])=>typeof v==='string'&&!/time.?zone/i.test(k)&&!/^\d/.test(v));
assert.ok(numeric,'ordinary source contains numeric fact');assert.ok(categorical,'ordinary source contains categorical fact');
await p.locator('#cdEquipmentRequirement-0-0').fill('Recorded Job Requirement');await p.locator('#cdEquipmentReason').fill('Review recorded equipment requirements');
await p.locator('#cdEquipmentRequirement-0-0-fact').selectOption(categorical[0]);await focused('cdEquipmentRequirement-0-0-fact');
// Switch Number then Exact Text; the recorded categorical source remains intact through both.
await keyboardChoice('cdEquipmentRequirement-0-0-kind','Home');await keyboardChoice('cdEquipmentRequirement-0-0-kind','End');await p.keyboard.press('Tab');
assert.equal(await p.locator('#cdEquipmentRequirement-0-0-value').inputValue(),String(categorical[1]));assert.equal(await p.locator('#cdEquipmentRequirement-0-0-value').getAttribute('readonly'),'');
async function preview(expected){assert.deepEqual(await p.locator('#cdEquipmentPlan form :invalid').evaluateAll(es=>es.map(e=>e.id)),[]);const [r]=await Promise.all([p.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.endsWith('/equipment-plan-preview')),click('Preview Equipment Review')]);const b=await r.json();assert.equal(r.status(),expected,JSON.stringify(b));await p.waitForFunction(()=>!document.querySelector('#cdEquipmentReason').disabled);return b;}
let result=await preview(200);assert.equal(result.data.result.lines[0].requirements[0].required,String(categorical[1]));assert.equal(result.data.result.lines[0].requirements[0].origin,'recorded_job');
await keyboardChoice('cdEquipmentRequirement-0-0-kind','Home');await p.keyboard.press('Tab');assert.equal(await p.locator('#cdEquipmentRequirement-0-0-value').inputValue(),String(categorical[1]));await preview(400);assert.match(await p.locator('#cdEquipmentPlan').innerText(),/Check the equipment, requirements and units/);assert.equal(await p.locator('#cdEquipmentConfirm').isChecked(),false);
await p.locator('#cdEquipmentRequirement-0-0-fact').selectOption(numeric[0]);await focused('cdEquipmentRequirement-0-0-fact');await keyboardChoice('cdEquipmentRequirement-0-0-kind','End');await keyboardChoice('cdEquipmentRequirement-0-0-kind','Home');await p.keyboard.press('Tab');assert.equal(await p.locator('#cdEquipmentRequirement-0-0-value').inputValue(),String(numeric[1]));result=await preview(200);assert.equal(result.data.result.lines[0].requirements[0].required,String(numeric[1]));assert.doesNotMatch(await p.locator('#cdEquipmentPlan').innerText(),/estimate or sources changed/);
await p.screenshot({path:path.join(out,tag+'-recorded-preview.png')});

// Add six requirements on first item, six on second through actual controls.
for(let n=1;n<6;n++)await click('Add Requirement');await click('Add Equipment');
const summaries=p.getByText('Job Requirements',{exact:true});await summaries.nth(1).click();
for(let n=0;n<6;n++){const buttons=p.getByRole('button',{name:'Add Requirement',exact:true});await buttons.last().focus();await p.keyboard.press('Enter');}
assert.equal(await p.getByRole('button',{name:'Add Requirement',exact:true}).count(),0);
assert.equal(await p.locator('#cdEquipmentPlan').evaluate(e=>Array.from(e.querySelectorAll('input')).filter(x=>/^cdEquipmentRequirement-\d+-\d+$/.test(x.id)).length),12);
assert.match(await p.locator('#cdEquipmentPlan').innerText(),/12 requirements across this plan/);
await p.getByRole('button',{name:'Remove Requirement',exact:true}).last().click();assert.equal(await p.getByRole('button',{name:'Add Requirement',exact:true}).count(),2);
await click('Cancel Equipment Plan');assert.equal(await p.evaluate(()=>document.activeElement.id),'cdEquipmentStart');
assert.equal(calls.filter(r=>r.method==='POST').length,3);assert.ok(calls.filter(r=>r.method==='POST').every(r=>r.path.endsWith('/equipment-plan-preview')));if(demo)assert.equal(calls.filter(r=>r.path.startsWith('/api/v1/')).length,0);
ledger.cases.push({tag,passed:true,keyboard:['Source','Recorded Job Fact','Comparison'],totalBound:12,posts:3,previews:['categorical200','invalidNumeric400','numeric200']});await c.close();}
assert.deepEqual(ledger.errors,[]);ledger.pass=true;
}catch(e){ledger.error=e.stack;process.exitCode=1;}finally{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));if(f)await f.cleanup();fs.writeFileSync(path.join(out,'ledger.json'),JSON.stringify(ledger,null,2));console.log(JSON.stringify(ledger));}})();
