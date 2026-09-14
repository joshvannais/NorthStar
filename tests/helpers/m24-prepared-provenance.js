'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
module.exports=async function({p,ctx,route,origin,tag,out,save,before,read,demo,requests}){
 await p.locator('#cdPreparedAdjust').click();await p.locator('#cdPreparedField-0').fill('100');await p.locator('#cdPreparedField-0-reason').fill('Measured test scope');await p.locator('#cdPreparedField-1').selectOption('cedar');await p.locator('#cdPreparedField-1-reason').fill('Reviewed proposed material');
 let mode='reordered';const observations=[];
 await p.route('**/proposal-preview',async r=>{const response=await r.fetch(),body=await response.json();assert.equal(response.status(),200);const d=body.data;
  if(['reordered','missing','zero'].includes(mode)){
   const c=d.components.find(x=>x.kind==='equipment'),line=c.inputs.lines[0],result=c.result.lines[0],cost=c.costs[0];
   c.inputs.lines=[{...line,task:'Equipment A',lineId:'11111111-1111-4111-8111-111111111111'},{...line,task:'Equipment B',lineId:'22222222-2222-4222-8222-222222222222'}];c.result.lines=c.inputs.lines.map(l=>({...result,lineId:l.lineId}));
   c.costs=[{...cost,lineId:c.inputs.lines[1].lineId,total:'22.00'},...(mode==='missing'?[]:[{...cost,lineId:c.inputs.lines[0].lineId,total:mode==='zero'?'0.00':'11.00'}])];
  }else{
   d.recipe.label='Current proposed recipe';d.recipe.effectiveOn='2026-01-01';d.recipe.reviewBy='2027-01-01';
   for(const c of d.components)if(mode==='retained'||(mode==='mixed'&&['materials','equipment','travel'].includes(c.kind))){c.origin='current_saved_plan';c.state='retained';c.savedPlanPresent=true;}
  }
  save(tag+'-'+mode+'-projection.json',{attribution:'Controlled response projection on actual mounted protected page; not persisted historical source proof',response:body});await r.fulfill({response,json:body});
 });
 for(mode of ['reordered','missing','zero','retained','new','mixed']){
  await p.locator('#cdPreparedCalculate').click();await p.waitForFunction(()=>document.querySelector('#cdPreparedStatus')?.textContent.startsWith('Draft prepared'));
  assert(!/[\u00c2\u00e2\ufffd]/.test(await p.locator('#cdPreparedGroups').innerText()));
  const group=p.locator('.prepared-group').filter({has:p.getByRole('heading',{name:'Equipment',exact:true})});
  if(['reordered','missing','zero'].includes(mode)){
   const rows=await group.locator('.prepared-row').allTextContents();assert(rows.some(t=>t.includes('Equipment A')));const costs=rows.filter(t=>t.startsWith('Equipment cost'));assert.deepEqual(costs,['Equipment cost'+(mode==='missing'?'Unavailable':mode==='zero'?'$0.00':'$11.00'),'Equipment cost$22.00']);
  }else for(const[kind,title]of [['materials','Materials'],['labor','Work And Crew'],['equipment','Equipment'],['travel','Travel And Logistics'],['pricing','Price']]){
   const g=p.locator('.prepared-group').filter({has:p.getByRole('heading',{name:title,exact:true})}),retained=mode==='retained'||mode==='mixed'&&['materials','equipment','travel'].includes(kind);
   if(retained){assert.equal(await g.getByText('Planning Source',{exact:true}).count(),0);assert.match(await g.innerText(),/Review this saved plan's sources under Edit/);assert(!/Current proposed recipe|2026-01-01|2027-01-01/.test(await g.textContent()));}
   else{await g.getByText('Planning Source',{exact:true}).click();assert.match(await g.innerText(),/Current proposed recipe/);assert.match(await g.innerText(),/2026-01-01/);assert.match(await g.innerText(),/2027-01-01/);}
  }
  await group.scrollIntoViewIfNeeded();save(tag+'-'+mode+'-render.json',{text:await p.locator('#cdPreparedGroups').innerText()});if(['missing','mixed'].includes(mode))await p.screenshot({path:path.join(out,tag+'-'+mode+'.png')});observations.push(mode);
 }
 await p.unroute('**/proposal-preview');const after=await read();save(tag+'-after.json',after);const stable=v=>JSON.parse(JSON.stringify(v,(k,x)=>['assessedAt','generatedAt','expiresAt'].includes(k)?undefined:x));assert.deepEqual(stable(after),stable(before));assert(requests.filter(r=>r.method==='POST').every(r=>r.path.endsWith('/proposal-preview')));await p.keyboard.press('Escape');await p.goto(origin+(demo?'/demo':'/dashboard'));await p.waitForLoadState('networkidle');assert.equal((await ctx.request.get(origin+route+'/review')).status(),200);if(demo)assert.deepEqual(requests.filter(r=>r.path.startsWith('/api/v1/')),[]);return{tag,pass:true,observations,requests};
};
