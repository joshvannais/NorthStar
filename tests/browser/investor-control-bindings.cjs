'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {resolveBrowserRuntime}=require('../helpers/playwright-runtime');
const root=path.resolve(__dirname,'../..');
(async()=>{
  const runtime=resolveBrowserRuntime('chrome'),browser=await runtime.browserType.launch({executablePath:runtime.executablePath,headless:true});
  const receipts=[];
  try{
    const page=await browser.newPage();await page.goto(pathToFileURL(path.join(root,'public/unlisted/investor-forecast.html')).href);
    await page.waitForFunction(()=>window.currentNorthStarInvestorResult);
    // Bound the probe to one forecast month; this tests production input parsing
    // and normalized result bindings, not10-year forecasts for each perturbation.
    await page.locator('#forecastMonths').evaluate(el=>el.value='1');await page.locator('#selectedMonth').fill('1');await page.locator('#recalculate').click();
    const controls=await page.locator('[data-path]').evaluateAll(elements=>elements.map(el=>({path:el.dataset.path,kind:el.dataset.kind,value:el.type==='checkbox'?el.checked:el.value,options:el.tagName==='SELECT'?[...el.options].map(o=>o.value):null})));
    assert.equal(new Set(controls.map(c=>c.path)).size,controls.length,'one field per canonical scalar path');
    for(const control of controls){
      const locator=page.locator(`[data-path="${control.path}"]`);
      let next=control.kind==='boolean'?!control.value:control.options?control.options.find(v=>v!==control.value):control.value===''?'1':String(Number(control.value)===0?1:Number(control.value)+(control.kind==='integer'?1:Math.max(.01,Math.abs(Number(control.value))*.01)));
      if(next===undefined)continue;
      const set=value=>locator.evaluate((el,v)=>{if(el.type==='checkbox')el.checked=v;else el.value=String(v);el.dispatchEvent(new Event('change',{bubbles:true}));},value);
      await set(next);await page.locator('#recalculate').click();
      const outcome=await page.evaluate(key=>({error:document.querySelector('#validationSummary').classList.contains('show')?document.querySelector('#validationSummary').innerText.trim():'',value:key.split('.').reduce((v,k)=>v?.[k],window.currentNorthStarInvestorResult.config)}),control.path);
      let expected=control.kind==='boolean'||control.kind==='select'?next:['percent','signedPercent'].includes(control.kind)?Number(next)/100:Number(next);
      if(control.path.includes('.planMix.')) {
        const prefix=control.path.slice(0,control.path.lastIndexOf('.')+1);
        const total=controls.filter(c=>c.path.startsWith(prefix)).reduce((sum,c)=>sum+Number(c.path===control.path?next:c.value)/100,0);
        expected/=total; // Plan weights are explicitly normalized shares.
      }
      const matches=typeof expected==='number'?Math.abs(outcome.value-expected)<1e-7:outcome.value===expected;
      assert.ok(matches||outcome.error,`${control.path} silently failed binding: expected${expected}, actual${outcome.value}`);
      receipts.push({path:control.path,kind:control.kind,entered:next,expected,normalized:outcome.value,status:matches?'bound':'explicit validation rejection',validation:outcome.error||null});
      await set(control.value);await page.locator('#recalculate').click();
      assert.equal(await page.locator('#validationSummary').evaluate(el=>el.classList.contains('show')),false,'restoring baseline succeeds');
    }
  }finally{await browser.close();fs.writeFileSync(path.join(root,'outputs/investor-revision/control-bindings.json'),JSON.stringify({qualification:'All generated scalar controls perturbed individually through production DOM/recalculate. Cross-field-invalid settings must reject visibly; rejection is not proof of economic effect. Array editors and named primary controls have separate interaction/numerical coverage.',count:receipts.length,bound:receipts.filter(r=>r.status==='bound').length,rejected:receipts.filter(r=>r.status!=='bound').length,controls:receipts},null,2));}
  console.log(`${receipts.length} scalar bindings checked; ${receipts.filter(r=>r.status==='bound').length} normalized changes, ${receipts.filter(r=>r.status!=='bound').length} visible validation rejections`);
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
