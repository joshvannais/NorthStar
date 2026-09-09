'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {resolveBrowserRuntime}=require('../helpers/playwright-runtime');
const option=(key,fallback)=>(process.argv.find(value=>value.startsWith('--'+key+'=')) || '--'+key+'='+fallback).split('=').slice(1).join('=');
process.chdir(path.resolve(__dirname,'../..'));process.env.NODE_ENV='test';
for(const key of ['DATABASE_URL','MIGRATION_DATABASE_URL','OPENAI_API_KEY','RETELL_API_KEY','STRIPE_SECRET_KEY','TWILIO_AUTH_TOKEN','RESEND_API_KEY','SMTP_HOST','SMTP_USER','SMTP_PASS'])delete process.env[key];
async function main(){
  const output=path.resolve(option('output','')),selected=option('browser','chrome'),hostile=process.argv.includes('--hostile');
  assert.ok(process.argv.some(v=>v.startsWith('--output='))&&!fs.existsSync(output),'new output directory required');fs.mkdirSync(output,{recursive:true});
  const ledger={browser:selected,version:null,authority:'mounted production modules with fresh disposable PostgreSQL 18.4',hostile,cases:[],pageErrors:[],externalBlocked:[],serverExternalAttempts:0,limitations:'WebKit is not physical Safari. Reflow is not native OS zoom or manual assistive-technology acceptance.'};
  let fixture,server,browser;
  const https=require('node:https'),originalRequest=https.request,originalGet=https.get,originalFetch=globalThis.fetch;
  function deny(){ledger.serverExternalAttempts++;throw new Error('No external transport in local profile validation');}
  https.request=deny;https.get=deny;globalThis.fetch=deny;
  try{
    fixture=await require('../helpers/m23-part9b-overview-fixture').createDatabaseFixture();
    await fixture.ownerPool.query("UPDATE users SET name=$2 WHERE id=$1",[fixture.actors.member.actorUserId,hostile?'<strong>Literal name</strong> with a very long professional display name for reflow checks':'Jordan Ellis']);
    await fixture.ownerPool.query("UPDATE users SET name='Morgan Brooks' WHERE id=$1",[fixture.actors.owner.actorUserId]);
    const repo=require('../../src/workforce/workProfileRepository');
    const profile={title:hostile?'Service technician — long professional title for small screens':'Residential service technician',
      summary:hostile?'<strong>Literal professional summary</strong> '.repeat(20):'Thoughtful residential repairs, careful site preparation and clear customer handovers. I enjoy finding the practical detail that makes a job go smoothly.',
      skills:hostile?['A very long self-described capability that must wrap safely within its card','Fixture repair','Site preparation']:['Fixture repair','Site preparation','Customer handovers'],
      certifications:[{id:'safety',name:'Workplace safety training',issuer:'Example Training Academy',expiresOn:'2099-09-09',documentReference:'CERT-2026-014'},
        {id:'tools',name:'Power tool operation',issuer:'Example Skills Centre',expiresOn:null,documentReference:null},
        {id:'expired',name:'Equipment safety refresher',issuer:'Example Training Academy',expiresOn:'2025-01-01',documentReference:'CERT-2024-006'}]};
    let latest=await repo.readProfile(fixture.runtimePool,fixture.actors.member);
    await repo.mutate(fixture.runtimePool,fixture.actors.member,null,crypto.randomUUID(),{action:'submit',expectedRevision:latest.profile.revision,profile});
    latest=await repo.readProfile(fixture.runtimePool,fixture.actors.member);
    await repo.mutate(fixture.runtimePool,fixture.actors.owner,fixture.actors.member.actorUserId,crypto.randomUUID(),
      {action:'approve',expectedRevision:latest.profile.revision,reason:'Reviewed professional information and the original safety training record.',verifiedCertificationIds:['safety']});
    await repo.mutate(fixture.runtimePool,fixture.actors.member,null,crypto.randomUUID(),{action:'availability',expectedRevision:0,
      availability:{status:'limited',note:'Available for afternoon service calls today.',until:new Date(Date.now()+3600000).toISOString()}});
    server=fixture.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const origin='http://127.0.0.1:'+server.address().port,runtime=resolveBrowserRuntime(selected);
    browser=await runtime.browserType.launch({headless:true,executablePath:runtime.executablePath});ledger.version=browser.version();
    const profiles=[{name:'1440',width:1440,height:1000},{name:'1280',width:1280,height:720},{name:'1920',width:1920,height:1080},
      {name:'768',width:768,height:1024},{name:'430',width:430,height:932},{name:'390',width:390,height:844},{name:'375',width:375,height:812},
      {name:'320',width:320,height:760},{name:'reflow200',width:720,height:500},{name:'reflow400',width:360,height:350}]
      .filter(p=>option('profile','all')==='all'||p.name===option('profile'));
    assert.ok(profiles.length);
    async function contextFor(actor,p,theme){
      const context=await browser.newContext({viewport:{width:p.width,height:p.height},hasTouch:p.width<=430,reducedMotion:'reduce'});
      await context.addInitScript(theme=>localStorage.setItem('northstar-theme',theme),theme);
      await context.addCookies(Object.entries(fixture.actors[actor].session.cookies).map(([name,value])=>({name,value,url:origin,sameSite:'Lax',httpOnly:name!=='northstar_csrf'})));
      await context.route('**/*',async route=>{if(new URL(route.request().url()).origin!==origin){ledger.externalBlocked.push(route.request().url());return route.abort();}return route.continue();});
      const page=await context.newPage();page.on('pageerror',error=>ledger.pageErrors.push(error.message));return {context,page};
    }
    async function check(page,label){
      await require('../helpers/m23-user-wording').assertUserWording(page,label);
      // Keyboard and review interactions scroll focused controls into view.
      // Reset before a full-page capture so fixed headers stay at page origin.
      await page.evaluate(async()=>{
        await document.fonts.ready;document.activeElement?.blur();
        // The canonical shell can also scroll an overflow ancestor after a
        // control receives focus; window.scrollY alone does not observe it.
        document.querySelectorAll('html,body,.app-layout,.dashboard-layout,.main-content').forEach(e=>e.scrollTo({top:0,left:0,behavior:'instant'}));
        window.scrollTo({top:0,left:0,behavior:'instant'});
      });
      await page.waitForFunction(()=>window.scrollY===0);
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      assert.equal(await page.locator('h1').count(),1);
      const result=await page.evaluate(()=>{
        const visible=e=>e.getClientRects().length>0;
        const overflow=[...document.querySelectorAll('#profileMain input,#profileMain button,#profileMain textarea,#profileMain .wp-panel')].filter(visible).filter(e=>{const r=e.getBoundingClientRect();return r.left < -1 || r.right>innerWidth+1;}).map(e=>e.id||e.className);
        const missing=[...document.querySelectorAll('input,textarea,select,button')].filter(visible).filter(e=>!e.labels?.length&&!e.getAttribute('aria-label')&&!e.textContent.trim()&&e.type!=='submit').map(e=>e.id);
        const heading=document.querySelector('h1').getBoundingClientRect();
        const headers=[...document.querySelectorAll('header,.mobile-header')].filter(visible).filter(e=>['fixed','sticky'].includes(getComputedStyle(e).position)).map(e=>e.getBoundingClientRect().bottom);
        return {scroll:document.documentElement.scrollWidth,width:innerWidth,overflow,missing,headingTop:heading.top,headerBottom:Math.max(0,...headers)};
      });
      assert.ok(result.scroll<=result.width+1,label+' horizontal overflow '+JSON.stringify(result));assert.deepEqual(result.overflow,[],label+' clipped controls');assert.deepEqual(result.missing,[],label+' names');
      await page.screenshot({path:path.join(output,label+'.png'),fullPage:true});
      assert.ok(result.headingTop>=result.headerBottom,label+' header overlaps the page title '+JSON.stringify(result));
      ledger.cases.push({label,...result,passed:true});
    }
    async function saved(page){
      await page.waitForFunction(()=>document.getElementById('profileStatus').textContent==='Saved to your organization’s profile history.'
        && document.getElementById('profileStatus').dataset.state==='success');
    }
    if(process.argv.includes('--onboarding-readonly')){
      await fixture.ownerPool.query("UPDATE organization_onboarding SET status='business_profile_required',completed_at=NULL WHERE organization_id=$1",[fixture.org]);
      for(const theme of ['light','dark'])for(const p of profiles.filter(p=>['1440','390'].includes(p.name)))for(const actor of ['member','owner']){
        const {context,page}=await contextFor(actor,p,theme);
        const posts=[];page.on('request',request=>{if(request.method()==='POST' && request.url().includes('/api/work-profiles/'))posts.push(request.url());});
        await page.goto(origin+(actor==='member'?'/dashboard/my-work-profile':'/dashboard/work-profile-reviews'));
        if(actor==='owner')await page.getByRole('button',{name:'Review Jordan Ellis',exact:true}).click();
        await page.getByRole('heading',{name:'Read-only profile',exact:true}).waitFor();
        assert.equal(await page.locator('#profileEditor').isVisible(),false);
        assert.equal(await page.locator('#profileEditor input,#profileEditor textarea').count(),0,'No draft editor is offered from a false capability');
        for(const name of ['Build my profile','Edit my profile','Update availability','Review & approve','Request changes','Revoke approval']){
          assert.equal(await page.getByRole('button',{name,exact:true}).count(),0,'No false mutation affordance: '+name);
        }
        await check(page,'onboarding-readonly-'+theme+'-'+p.name+'-'+actor);
        assert.deepEqual(posts,[],'No false-affordance POST can erase a draft/editor');
        await context.close();
      }
    }else for(const theme of ['light','dark'])for(const p of profiles){
      const label=(hostile?'hostile-':'ordinary-')+theme+'-'+p.name;
      const {context,page}=await contextFor('member',p,theme);
      await page.goto(origin+'/dashboard/my-work-profile');await page.getByRole('button',{name:'Edit my profile',exact:true}).waitFor();
      const themeButton=page.locator('[data-northstar-theme-toggle]');
      await themeButton.focus();await page.keyboard.press('Space');
      await page.waitForFunction(expected=>document.documentElement.dataset.theme===expected,theme==='light'?'dark':'light');
      await page.keyboard.press('Space');await page.waitForFunction(expected=>document.documentElement.dataset.theme===expected,theme);
      const geometry=await themeButton.evaluate(e=>{
        const box=e.getBoundingClientRect(),pseudo=getComputedStyle(e,'::before'),matrix=new DOMMatrix(pseudo.transform);
        const icon=e.querySelector(e.dataset.currentTheme==='dark'?'.northstar-theme-moon svg':'.northstar-theme-sun svg').getBoundingClientRect();
        const x=box.left+parseFloat(pseudo.left)+matrix.m41+parseFloat(pseudo.width)/2,y=box.top+parseFloat(pseudo.top)+matrix.m42+parseFloat(pseudo.height)/2;
        return {dx:Math.abs(x-(icon.left+icon.width/2)),dy:Math.abs(y-(icon.top+icon.height/2))};
      });
      assert.ok(geometry.dx<1&&geometry.dy<1,'Canonical theme thumb is centered on its icon');
      if(p.width<=430){
        await page.locator('#todayMenuToggle').focus();await page.keyboard.press('Enter');
        await page.locator('#todayMobileMenu.open').waitFor();
        assert.equal(await page.locator('#todayMobileMenu a[data-nav-id="my-work-profile"]').getAttribute('aria-current'),'page');
        await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement.id==='todayMenuToggle');
      }
      await check(page,label+'-self');
      if(p.name==='1440'||p.name==='390'||option('profile','all')!=='all'){
        await page.getByRole('button',{name:'Edit my profile',exact:true}).click();
        await page.getByLabel('Professional summary',{exact:true}).fill(profile.summary+' Clear notes help the whole team.');
        await page.getByRole('button',{name:'Submit for review',exact:true}).click();
        await saved(page);
        await page.locator('#profileContent .wp-grid .wp-badge[data-state="pending"]').waitFor();
        await check(page,label+'-pending');
        await page.getByRole('button',{name:'Update availability',exact:true}).click();
        await page.getByLabel('Availability',{exact:true}).selectOption('not_shared');
        await page.getByRole('button',{name:'Save availability',exact:true}).click();
        await saved(page);
        await page.locator('#profileContent .wp-grid .wp-badge[data-state="not_shared"]').waitFor();
        // Actual request commits, response is lost, same-key retry must replay.
        await page.getByRole('button',{name:'Edit my profile',exact:true}).click();
        await page.getByLabel('Professional title',{exact:true}).fill(profile.title);
        let intercepted=false;
        await page.route('**/api/work-profiles/me',async route=>{
          if(route.request().method()==='POST'&&!intercepted){intercepted=true;await route.fetch();return route.abort();}return route.continue();
        });
        await page.getByRole('button',{name:'Submit for review',exact:true}).click();
        await page.getByRole('button',{name:'Retry same request',exact:true}).waitFor();
        await page.getByRole('button',{name:'Retry same request',exact:true}).click();
        await saved(page);
        await page.getByRole('button',{name:'Edit my profile',exact:true}).waitFor();
        await page.unroute('**/api/work-profiles/me');
        const owner=await contextFor('owner',p,theme);
        await owner.page.goto(origin+'/dashboard/work-profile-reviews');
        await owner.page.getByRole('button',{name:/Review (Jordan Ellis|<strong>Literal name)/}).click();
        await owner.page.getByRole('button',{name:'Review & approve',exact:true}).waitFor();
        await check(owner.page,label+'-review');
        await owner.page.getByRole('button',{name:'Review & approve',exact:true}).click();
        await owner.page.getByLabel('Reason for this decision',{exact:true}).fill('Reviewed the current professional information and original safety training record.');
        await owner.page.getByLabel('Workplace safety training',{exact:true}).check();
        await owner.page.getByRole('button',{name:'Review decision',exact:true}).click();
        await owner.page.getByRole('dialog').waitFor();
        for(let tab=0;tab<4;tab++){await owner.page.keyboard.press('Tab');assert.equal(await owner.page.locator('#profileConfirm').evaluate(e=>e.contains(document.activeElement)),true);}
        await owner.page.keyboard.press('Escape');assert.equal(await owner.page.locator('#profileConfirm').evaluate(e=>e.open),false);
        await owner.page.waitForFunction(()=>document.activeElement && document.activeElement.textContent==='Review decision');
        await owner.page.getByRole('button',{name:'Review decision',exact:true}).click();
        await owner.page.getByRole('button',{name:'Confirm decision',exact:true}).click();
        await saved(owner.page);
        await owner.page.getByRole('button',{name:'Revoke approval',exact:true}).waitFor();
        await check(owner.page,label+'-approved');
        await owner.page.getByRole('button',{name:'Revoke approval',exact:true}).click();
        await owner.page.getByLabel('Reason for this decision',{exact:true}).fill('Training evidence was withdrawn; please provide the current record.');
        await owner.page.getByRole('button',{name:'Review decision',exact:true}).click();
        await owner.page.getByRole('button',{name:'Confirm decision',exact:true}).click();await saved(owner.page);
        await check(owner.page,label+'-revoked');
        await owner.context.close();
        await page.getByRole('button',{name:'Reload profile',exact:true}).click();await page.getByRole('button',{name:'Edit my profile',exact:true}).waitFor();
        // A stale server decision leaves the draft but removes authority.
        await page.getByRole('button',{name:'Edit my profile',exact:true}).click();
        await page.getByLabel('Professional title',{exact:true}).fill('A retained local draft');
        await page.route('**/api/work-profiles/me',route=>route.request().method()==='POST'?route.fulfill({status:409,json:{success:false,error:{message:'Version changed'}}}):route.continue());
        await page.getByRole('button',{name:'Submit for review',exact:true}).click();await page.locator('#profileStatus[data-state="conflict"]').waitFor();
        assert.equal(await page.getByLabel('Professional title',{exact:true}).inputValue(),'A retained local draft');
        await check(page,label+'-conflict');
        await page.unroute('**/api/work-profiles/me');
        page.once('dialog',dialog=>dialog.accept());
        await page.getByRole('button',{name:'Reload profile',exact:true}).click();await page.getByRole('button',{name:'Edit my profile',exact:true}).waitFor();
        await page.route('**/api/work-profiles/me',route=>route.fulfill({status:503,json:{success:false,error:{message:'Unavailable'}}}));
        await page.getByRole('button',{name:'Reload profile',exact:true}).click();await page.getByRole('heading',{name:'Work profiles are unavailable',exact:true}).waitFor();
        await check(page,label+'-error');await page.unroute('**/api/work-profiles/me');
      }
      await context.close();
    }
    // Empty, read-only account still gets a useful profile page.
    const empty=await contextFor('viewer',{width:390,height:844},'light');
    await empty.page.goto(origin+'/dashboard/my-work-profile');await empty.page.getByRole('heading',{name:'Read-only profile',exact:true}).waitFor();await check(empty.page,'ordinary-light-390-empty-viewer');await empty.context.close();
    assert.deepEqual(ledger.pageErrors,[]);assert.equal(ledger.serverExternalAttempts,0);
    ledger.passed=true;console.log(JSON.stringify({browser:selected,cases:ledger.cases.length,passed:true}));
  }catch(error){
    if(browser)for(const context of browser.contexts())for(const page of context.pages()){
      try { await page.screenshot({path:path.join(output,'failure-'+crypto.randomUUID()+'.png'),fullPage:true}); }catch{}
    }
    throw error;
  }finally{
    if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));if(fixture)await fixture.cleanup();
    https.request=originalRequest;https.get=originalGet;globalThis.fetch=originalFetch;
    fs.writeFileSync(path.join(output,'ledger.json'),JSON.stringify(ledger,null,2));
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
