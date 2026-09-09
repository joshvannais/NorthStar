'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {resolveBrowserRuntime}=require('../helpers/playwright-runtime');
const option=(key,fallback)=>(process.argv.find(v=>v.startsWith('--'+key+'='))||'--'+key+'='+fallback).split('=').slice(1).join('=');
process.chdir(path.resolve(__dirname,'../..'));process.env.NODE_ENV='test';
for(const key of ['DATABASE_URL','MIGRATION_DATABASE_URL','OPENAI_API_KEY','POLARIS_OPENAI_ENABLED','RETELL_API_KEY','STRIPE_SECRET_KEY','TWILIO_AUTH_TOKEN','RESEND_API_KEY','SMTP_HOST','SMTP_USER','SMTP_PASS'])delete process.env[key];
async function main(){
 const output=path.resolve(option('output','')),selected=option('browser','chrome'),baseline=process.argv.includes('--baseline');
 assert.ok(process.argv.some(v=>v.startsWith('--output='))&&!fs.existsSync(output));fs.mkdirSync(output,{recursive:true});
 const ledger={browser:selected,baseline,cases:[],pageErrors:[],providerAttempts:0,externalBlocked:[],mutations:[],
  limitations:'Local synthetic PostgreSQL and mounted HTTP. Actual WebKit is not physical Safari. Reflow viewports are not native zoom. No manual assistive technology or founder visual verdict.'};
 let fixture,server,browser,page;
 const https=require('node:https'),oldRequest=https.request,oldGet=https.get,oldFetch=globalThis.fetch;
 const deny=()=>{ledger.providerAttempts++;throw new Error('External transport forbidden');};https.request=deny;https.get=deny;globalThis.fetch=deny;
 try{
  fixture=await require('../helpers/m23-part9b-overview-fixture').createDatabaseFixture({operationalSchedule:true});
  const work=await fixture.createExecution({approvedScheduling:true,title:'Kitchen sink repair',start:new Date(Date.now()+60000).toISOString()});
  server=fixture.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const origin='http://127.0.0.1:'+server.address().port,runtime=resolveBrowserRuntime(selected);
  browser=await runtime.browserType.launch({headless:true,executablePath:runtime.executablePath});ledger.version=browser.version();
  const profiles=[{name:'1440',width:1440,height:1000},{name:'768',width:768,height:1024},{name:'390',width:390,height:844},
   {name:'320',width:320,height:760},{name:'reflow200',width:720,height:500},{name:'reflow400',width:360,height:350}].filter(p=>option('profile','all')==='all'||p.name===option('profile'));
  for(const theme of ['light','dark'])for(const profile of profiles){
   const label=theme+'-'+profile.name,context=await browser.newContext({viewport:{width:profile.width,height:profile.height},hasTouch:profile.width<=390,reducedMotion:'reduce'});
   await context.addInitScript(value=>localStorage.setItem('northstar-theme',value),theme);
   await context.addCookies(Object.entries(fixture.actors.owner.session.cookies).map(([name,value])=>({name,value,url:origin,sameSite:'Lax',httpOnly:name!=='northstar_csrf'})));
   page=await context.newPage();page.on('pageerror',e=>ledger.pageErrors.push({label,message:e.message}));
   page.on('request',r=>{if(r.method()==='POST')ledger.mutations.push({label,path:new URL(r.url()).pathname});});
   await page.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){ledger.externalBlocked.push(route.request().url());return route.abort();}return route.continue();});
   await page.goto(origin+'/dashboard/completion-review?executionId='+work.execution.id);await page.locator('#completionTitle').filter({hasText:'Kitchen sink repair'}).waitFor();
   await page.evaluate(async()=>{await document.fonts.ready;window.scrollTo(0,0);});
   const state=()=>page.evaluate(()=>{const skip=document.querySelector('.completion-skip'),r=skip.getBoundingClientRect(),s=getComputedStyle(skip);
    const back=document.querySelector('.completion-header a[href="/dashboard/operations"]'),b=back.getBoundingClientRect(),bs=getComputedStyle(back);
    return {skip:{focused:document.activeElement===skip,top:r.top,left:r.left,width:r.width,height:r.height,bottom:r.bottom,clip:s.clipPath,transform:s.transform},
     back:{top:b.top,left:b.left,right:b.right,width:b.width,height:b.height,color:bs.color,background:bs.backgroundColor,border:bs.borderTopColor,borderWidth:bs.borderTopWidth,radius:bs.borderTopLeftRadius,underline:bs.textDecorationLine},
     viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,scrollY,theme:document.documentElement.dataset.theme};});
   const normal=await state();assert.ok(normal.scrollWidth<=normal.viewport+1);assert.equal(normal.skip.focused,false);
   if(!baseline){assert.equal(normal.skip.clip,'inset(50%)');assert.ok(normal.skip.width<=1&&normal.skip.height<=1);assert.ok(normal.back.height>=44);assert.ok(normal.back.left>=0&&normal.back.right<=normal.viewport);assert.equal(normal.back.underline,'none');}
   await page.screenshot({path:path.join(output,label+'-normal-viewport.png')});await page.screenshot({path:path.join(output,label+'-normal-full.png'),fullPage:true});
   await page.keyboard.press('Tab');const focused=await state();assert.equal(focused.skip.focused,true,'first Tab focuses skip link');
   assert.ok(focused.skip.top>=0&&focused.skip.top<=16&&focused.skip.left>=0&&focused.skip.left<=16,'skip at viewport top');
   assert.ok(focused.skip.left+focused.skip.width<=focused.viewport+1);if(!baseline)assert.ok(focused.skip.height>=44);
   await page.screenshot({path:path.join(output,label+'-skip-focused-viewport.png')});await page.screenshot({path:path.join(output,label+'-skip-focused-full.png'),fullPage:true});
   await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>document.activeElement.id),'completionMain','skip moves keyboard focus to main');
   if(!baseline)assert.equal((await state()).skip.clip,'inset(50%)','skip hides again after activation');
   await page.locator('.completion-brand').focus();await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));await page.keyboard.press('Shift+Tab');
   const scrolled=await state();assert.equal(scrolled.skip.focused,true);assert.ok(scrolled.skip.top>=0&&scrolled.skip.top<=16,'focused skip remains at viewport top after scrolling');
   await page.screenshot({path:path.join(output,label+'-skip-from-scroll-viewport.png')});await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>document.activeElement.id),'completionMain');
   if(!baseline){
    // Compare the rendered navigation link against the shared, unmodified button
    // classes in the same theme. This inert reference is removed immediately.
    const parity=await page.evaluate(()=>{const expected=document.createElement('a');expected.className='btn btn-secondary';expected.textContent='Reference';document.body.append(expected);
      const actual=document.querySelector('.completion-back'),a=getComputedStyle(actual),b=getComputedStyle(expected),keys=['color','backgroundColor','borderTopColor','borderTopWidth','borderTopLeftRadius','fontWeight','textDecorationLine'];
      const result=Object.fromEntries(keys.map(k=>[k,{actual:a[k],expected:b[k]}]));expected.remove();return result;});
    for(const [key,values] of Object.entries(parity))assert.equal(values.actual,values.expected,label+' shared button '+key);
    await page.getByRole('link',{name:'Back to Operational Overview',exact:true}).focus();await page.keyboard.press('Enter');
    await page.waitForURL(origin+'/dashboard/operations');assert.equal(new URL(page.url()).pathname,'/dashboard/operations');
    ledger.cases.push({label:label+'-button-parity-and-navigation',parity,passed:true});
   }
   ledger.cases.push({label:label+'-skip-keyboard-viewport',normal,focused,scrolled,passed:true});await context.close();page=null;
  }
  assert.deepEqual(ledger.pageErrors,[]);assert.equal(ledger.providerAttempts,0);assert.deepEqual(ledger.mutations,[]);ledger.status='passed';
 }catch(error){ledger.status='failed';ledger.failure={message:error.message,stack:error.stack};if(page)await page.screenshot({path:path.join(output,'failure-viewport.png')}).catch(()=>{});throw error;}
 finally{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));if(fixture)await fixture.cleanup();https.request=oldRequest;https.get=oldGet;globalThis.fetch=oldFetch;fs.writeFileSync(path.join(output,'ledger.json'),JSON.stringify(ledger,null,2));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
