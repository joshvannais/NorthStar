'use strict';
const { observeUserWording } = require('../helpers/m23-user-wording');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {resolveBrowserRuntime}=require('../helpers/playwright-runtime');
const {navigationFixture}=require('../helpers/navigation-fixture');
const builder=require('../../src/commandCenter/workspace');
const canonical=require('../../src/routes/canonicalPolaris');
const opt=(key,fallback)=>(process.argv.find(value=>value.startsWith('--'+key+'='))||'--'+key+'='+fallback).split('=').slice(1).join('=');
const id=n=>`e4900000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const output=path.resolve(opt('output',''));assert.ok(process.argv.some(value=>value.startsWith('--output='))&&!fs.existsSync(output));fs.mkdirSync(output,{recursive:true});
const baseline=process.argv.includes('--baseline'),selected=opt('browser','chrome');
const ledger={browser:selected,baseline,authority:'mounted production pages and modules with intercepted synthetic canonical read responses; not durable persistence evidence',cases:[],requests:[],external:[],pageErrors:[],limits:'Playwright WebKit is not physical Safari; CSS reflow is not native zoom; no manual AT or founder personal verdict'};
const demo=builder.buildDemoWorkspace({tenantId:id(1),sessionId:id(3),state:builder.createInitialDemoState(id(1),new Date('2026-09-09T12:00:00Z')),revision:1,simulationCount:0,persisted:false,expiresAt:new Date('2099-09-09T12:00:00Z')});
const items=builder.demoCanonicalItems(demo).slice(0,2);
items.forEach((item,index)=>{item.source={...item.source,type:'lead'};item.customer.name=index?'Morgan Reed':'Alex Morgan';item.customer.email=index?'morgan@example.com':'alex@example.com';item.appointment.scheduledStart='2026-09-09T13:00:00.000Z';item.appointment.scheduledEnd='2026-09-09T15:00:00.000Z';item.appointment.status='scheduled';item.appointment.scheduleAuthority={revision:4,digest:'b'.repeat(64),targetState:'assigned',scheduleState:'scheduled',dispatchState:'dispatched',scheduledStart:item.appointment.scheduledStart,scheduledEnd:item.appointment.scheduledEnd,appointmentStatus:'scheduled'};});
const ids={appointmentId:items[0].ids.appointment,graphId:items[0].ids.graph,customerId:items[0].ids.customer};
const operator={canRead:true,canMutate:false,reason:'subscription_read_only',targets:[],digest:'c'.repeat(64),truncated:false,discovery:{version:'m22-part5-target-directory-v1',endpoint:'/api/v1/canonical/operator-targets',pageSize:100,shown:0,total:0,truncated:false}};
const categoryNames=['unassigned','due','overdue','atRisk','conflicting'];
const scheduling={version:'m22-part5-overview-v1',timeZone:'America/New_York',digest:'a'.repeat(64),total:2,shown:2,
 page:{size:100,shown:2,total:2,cursor:null,nextCursor:null},definitions:Object.fromEntries(categoryNames.map(key=>[key,'Synthetic current scheduling category'])),categories:Object.fromEntries(categoryNames.map(key=>[key,key==='atRisk'?items.map(item=>item.ids.appointment):[]])),counts:Object.fromEntries(categoryNames.map(key=>[key,key==='atRisk'?2:0])),
 records:items.map(item=>({appointmentId:item.ids.appointment,graphId:item.ids.graph,customer:item.customer,work:{title:item.snapshot.service.label,opportunityId:item.ids.opportunity},authority:item.appointment.scheduleAuthority,flags:{atRisk:true},conflict:{status:'clear',hardConflicts:[],warnings:[],needsReview:false},allowedActions:[]}))};
const workspace=builder.buildPaidWorkspace({context:{organizationId:id(1)},items,schedulingOperator:operator,schedulingOverview:scheduling});
const timezone={profileId:id(9),profileVersion:1,profileHash:'d'.repeat(64),timeZone:'America/New_York'};
const account={account:{user:{id:id(2),name:'Alex Owner',email:'owner@example.com',status:'active'},organization:{id:id(1),name:'NorthStar Local Fixture'},navigation:navigationFixture(),membership:{role:'owner',status:'active'},memberships:[{role:'owner',status:'active'}],onboarding:{status:'complete'},subscription:{plan:'Complete',safe:true,state:'active',readOnly:false,showTrialBanner:false}}};
async function main(){
 const https=require('node:https');https.request=()=>{throw Error('Server external transport forbidden');};https.get=https.request;
 const app=require('../../src/server').app,server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`,runtime=resolveBrowserRuntime(selected),browser=await runtime.browserType.launch({headless:true,executablePath:runtime.executablePath});ledger.version=browser.version();
  await observeUserWording(browser);
 let active;
 try{
 const profiles=[{name:'1440',width:1440,height:1000},{name:'390',width:390,height:844},{name:'320',width:320,height:740},{name:'reflow-200',width:720,height:500},{name:'reflow-400',width:360,height:350}].filter(p=>opt('profile','all')==='all'||p.name===opt('profile'));
 for(const theme of ['light','dark'])for(const profile of profiles)for(const surface of ['calendar','command','customer','communications'].filter(value=>opt('surface','all')==='all'||value===opt('surface'))){
  const label=`ordinary-${surface}-${theme}-${profile.name}`,context=await browser.newContext({viewport:profile,reducedMotion:'reduce'});let mode='available',linkRequests=0;
  await context.addInitScript(theme=>{localStorage.setItem('northstar-theme',theme);localStorage.setItem('northstar-quick-start-seen','true');},theme);
  const page=await context.newPage();active=page;page.on('pageerror',error=>ledger.pageErrors.push({label,error:error.message}));
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());if(url.origin!==origin){ledger.external.push(url.origin);return route.abort();}
   if(baseline && ['/js/calendar-engine.js','/js/command-center-page.js','/js/customer-detail.js'].includes(url.pathname))return route.fulfill({status:200,contentType:'text/javascript',body:execFileSync('git',['-c','safe.directory='+path.resolve(__dirname,'../..'),'show','49638af463f1e679193998b3b99bbf49560e7573:public'+url.pathname],{cwd:path.resolve(__dirname,'../..'),encoding:'utf8'})});
   if(!url.pathname.startsWith('/api/'))return route.continue();
   ledger.requests.push({label,method:request.method(),path:url.pathname});
   const json=(data,status=200)=>route.fulfill({status,json:data});
   if(url.pathname==='/api/auth/me')return json(account);
   if(url.pathname==='/api/account/subscription')return json({subscription:account.account.subscription});
   if(url.pathname==='/api/v1/command-center/workspace')return json({success:true,data:workspace});
   if(url.pathname==='/api/demo/command-center')return json({success:true,data:demo});
   if(url.pathname.includes('/links/appointments/')){
    linkRequests+=1;const appointmentId=url.pathname.split('/').at(-1),graphId=url.searchParams.get('graphId'),customerId=url.searchParams.get('customerId');
    assert.ok(items.some(item=>item.ids.appointment===appointmentId&&item.ids.graph===graphId&&item.ids.customer===customerId),'exact selector association');
    if(mode==='restricted')return json({success:false},403);if(mode==='error')return json({success:false},503);
    if(mode==='slow')await new Promise(resolve=>setTimeout(resolve,350));
    const available=mode!=='unavailable';return json({success:true,data:{version:'m23-part9-execution-link-v1',state:available?'available':'unavailable',appointmentId,graphId,customerId,executionId:available?id(7):null,href:available?'/dashboard/completion-review?executionId='+id(7):null}});
   }
   if(url.pathname.endsWith('/completion-review')){const f=require('../helpers/m23-part9-owner-completion-fixture');const raw=f.raw();raw.data.execution.id=id(7);raw.data.execution.appointmentId=ids.appointmentId;return json({success:false},403);}
   const compat=url.pathname.match(/\/canonical\/compat\/([^/]+)$/);if(compat){const filtered=url.searchParams.get('customerId')?items.filter(item=>item.ids.customer===url.searchParams.get('customerId')):items;
    const data=canonical.compatibilityProjection(compat[1],filtered,{organizationId:id(1),userId:id(2),sessionId:request.headers()['x-northstar-session-id']},timezone);if(compat[1]==='calendar')Object.assign(data,{schedulingOperator:operator,schedulingOverview:scheduling});return json({success:true,data});}
   if(url.pathname==='/api/telemetry')return json({accepted:true},202);
   return json({success:true,data:{},items:[],records:[]});
  });
  const pathname=surface==='calendar'?'/dashboard/calendar':surface==='command'?'/dashboard':surface==='communications'?'/dashboard/communications':'/dashboard/leads';await page.goto(origin+pathname);await page.waitForLoadState('networkidle');
  const quick=page.locator('#northstarQuickStartDialog[open]');if(await quick.count()){await page.keyboard.press('Escape');}
  if(surface==='customer'||surface==='communications'){
    const row=page.locator(surface==='communications'?'[data-customer-card-action="open-call"]':'[data-customer-card-action="open-lead"]').first();await row.waitFor({state:'visible'});await row.click();await page.locator('#cdDrawerContent').waitFor({state:'visible'});
  }
  const target=surface==='calendar'?'#calendarAuthorityBoard .execution-link':surface==='command'?'#commandCenterSchedulingRecords .execution-link':'#cdExecutionRecords .execution-link';
  if(baseline){const section=page.locator(surface==='calendar'?'#calendarAuthorityBoard':surface==='command'?'#commandCenterSchedulingRecords':'#cdCustomerDrawer');await section.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,label+'.png')});ledger.cases.push({label,baseline:true});await context.close();continue;}
  const disclosure=page.locator(target).first();await disclosure.waitFor({state:'visible'});assert.equal(linkRequests,0);await disclosure.locator('summary').click();await disclosure.getByRole('link',{name:'Review completion'}).waitFor();assert.equal(linkRequests,1);
  const geometry=await disclosure.evaluate(node=>{const box=node.getBoundingClientRect(),control=node.querySelector('summary').getBoundingClientRect(),link=node.querySelector('a').getBoundingClientRect();return{left:box.left,right:box.right,width:innerWidth,summaryHeight:control.height,linkHeight:link.height,overflow:document.documentElement.scrollWidth>innerWidth+1};});
  assert.ok(geometry.left>=-1&&geometry.right<=geometry.width+1,JSON.stringify(geometry));assert.ok(geometry.summaryHeight>=43&&geometry.linkHeight>=43);assert.equal(geometry.overflow,false);await page.screenshot({path:path.join(output,label+'.png')});
  await disclosure.locator('summary').focus();await page.keyboard.press('Enter');await page.waitForFunction(selector=>{const node=document.querySelector(selector);return !node.open&&!node.querySelector('a');},target);assert.equal(await disclosure.locator('a').count(),0);
  mode='restricted';await disclosure.locator('summary').click();await disclosure.getByText('Completion review is available only',{exact:false}).waitFor();assert.equal(await disclosure.locator('a').count(),0);
  await disclosure.locator('summary').click();mode='unavailable';await disclosure.locator('summary').click();await disclosure.getByText('Work details could not be found or confirmed.',{exact:false}).waitFor();assert.equal(await disclosure.locator('a').count(),0);
  await disclosure.locator('summary').click();mode='slow';await disclosure.locator('summary').click();await disclosure.getByText('Checking access to this job’s work details…').waitFor();await disclosure.locator('summary').click();await page.waitForTimeout(400);assert.equal(await disclosure.locator('a').count(),0);
  mode='error';await disclosure.locator('summary').click();await disclosure.getByRole('button',{name:'Try again'}).waitFor();mode='available';await disclosure.getByRole('button',{name:'Try again'}).click();await disclosure.getByRole('link',{name:'Review completion'}).waitFor();
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('northstar:auth-generation')));assert.equal(await disclosure.locator('a').count(),0);await disclosure.locator('summary').click();await disclosure.getByRole('link',{name:'Review completion'}).waitFor();
  await Promise.all([page.waitForURL('**/dashboard/completion-review?executionId='+id(7)),disclosure.getByRole('link',{name:'Review completion'}).click()]);assert.equal(new URL(page.url()).searchParams.get('executionId'),id(7));
  if(surface==='command' && theme==='light' && profile.name==='1440'){
    await page.goto(origin+'/dashboard');await page.waitForLoadState('networkidle');
    const upcoming=page.locator('#commandCenterSchedule .execution-link').first();await upcoming.locator('summary').click();await upcoming.getByRole('link',{name:'Review completion'}).waitFor();await page.screenshot({path:path.join(output,'ordinary-command-upcoming-light-1440.png')});await Promise.all([page.waitForURL('**/dashboard/completion-review?executionId='+id(7)),upcoming.getByRole('link',{name:'Review completion'}).click()]);ledger.cases.push({label:'command-upcoming-pointer',destination:true});
    const beforeDemo=linkRequests;await page.goto(origin+'/demo');await page.waitForLoadState('networkidle');
    const demoQuick=page.locator('#northstarQuickStartDialog[open]');if(await demoQuick.count())await page.keyboard.press('Escape');
    const demoDisclosure=page.locator('#commandCenterSchedule .execution-link').first();await demoDisclosure.waitFor({state:'visible'});await demoDisclosure.locator('summary').click();await demoDisclosure.getByText('Demo work is read-only.',{exact:false}).waitFor();assert.equal(await demoDisclosure.locator('a').count(),0);assert.equal(linkRequests,beforeDemo);ledger.cases.push({label:'demo-local-read-only',paidLookupRequests:0});
  }
  ledger.cases.push({label,geometry,linkRequests,pointer:true,keyboard:true,restricted:true,retry:true,destination:true,unavailable:true,staleResponseDiscarded:true,authInvalidation:true});await context.close();
 }
 assert.equal(ledger.pageErrors.length,0,JSON.stringify(ledger.pageErrors));fs.writeFileSync(path.join(output,'ledger.json'),JSON.stringify(ledger,null,2),{flag:'wx'});console.log(JSON.stringify({browser:selected,cases:ledger.cases.length,success:true}));
 }catch(error){ledger.error=error.stack;if(active&&!active.isClosed())await active.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});fs.writeFileSync(path.join(output,'failed-ledger.json'),JSON.stringify(ledger,null,2),{flag:'wx'});throw error;}
 finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
