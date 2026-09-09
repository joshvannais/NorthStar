'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { benignFixture } = require('./m23-part9a-worker-operational-experience');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');
const { observeUserWording, assertUserWording } = require('../helpers/m23-user-wording');
const option = (key, fallback) => (process.argv.find(v => v.startsWith('--'+key+'=')) || '--'+key+'='+fallback).split('=').slice(1).join('=');
async function main() {
  const output = path.resolve(option('output','')); assert(process.argv.some(v => v.startsWith('--output=')) && !fs.existsSync(output)); fs.mkdirSync(output);
  const ledger = { source: execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(), browser:option('browser','chrome'), authority:'mounted product page with ordinary intercepted Today responses; presentation evidence only', cases:[], external:[], errors:[] };
  const server = require('../../src/server').app.listen(0,'127.0.0.1'); await new Promise(resolve => server.once('listening',resolve));
  const origin = 'http://127.0.0.1:'+server.address().port;
  const runtime=resolveBrowserRuntime(ledger.browser); const browser=await runtime.browserType.launch({headless:true,executablePath:runtime.executablePath}); await observeUserWording(browser); ledger.version=browser.version();
  try {
    for (const width of [1440,390]) for (const theme of ['light','dark']) {
      const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
      await context.addInitScript(value=>localStorage.setItem('northstar-theme',value),theme);
      let mode='loading',release; const gate=new Promise(resolve=>{release=resolve;});
      await context.route('**/*',async route=>{
        const url=new URL(route.request().url()); if(url.origin!==origin){ledger.external.push(url.origin);return route.abort();}
        if(!url.pathname.startsWith('/api/'))return route.continue();
        if(url.pathname!=='/api/v1/today')return route.fulfill({status:404,json:{success:false}});
        if(mode==='loading')await gate;
        if(mode==='offline')return route.abort();
        if(['restricted','stale','error'].includes(mode))return route.fulfill({status:{restricted:403,stale:409,error:503}[mode],json:{success:false,error:{code:'UNAVAILABLE',message:'PostgreSQL internal route diagnostics'}}});
        const value=benignFixture().today;if(mode==='empty'){value.data.records=[];value.data.count=0;value.data.shown=0;value.data.total=0;}
        return route.fulfill({json:value});
      });
      const page=await context.newPage();page.on('pageerror',e=>ledger.errors.push(e.message));await page.goto(origin+'/dashboard/today');
      await page.locator('body[data-today-state="loading"]').waitFor();await assertUserWording(page,'Today loading');mode='ready';release();
      for(const state of ['ready','empty','restricted','stale','error','offline']) {
        mode=state;if(state==='offline'){await page.evaluate(()=>Object.defineProperty(navigator,'onLine',{get:()=>false,configurable:true}));await page.locator('#todayStateAction').click();}else if(state!=='ready')await page.reload();
        const expected=state;await page.locator('body[data-today-state="'+expected+'"]').waitFor();
        if(state==='ready') for(const disclosure of await page.locator('details').all())await disclosure.evaluate(e=>{e.open=true;});
        await assertUserWording(page,'Today '+state);await page.screenshot({path:path.join(output,theme+'-'+width+'-'+state+'.png'),fullPage:true});
        ledger.cases.push({state,renderedState:expected,width,theme});
      }
      await context.close();
    }
    assert.deepEqual(ledger.errors,[]);ledger.passed=true;
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(output,'ledger.json'),JSON.stringify(ledger,null,2));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
