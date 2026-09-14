'use strict';
// Narrow supplemental DOM proof: execute the actual two adapter functions with
// unrelated host dependencies stubbed. No paid/session/provider authority claim.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {resolveBrowserRuntime}=require('../helpers/playwright-runtime');
const engine=process.argv[2],out=path.resolve(process.argv[3]);fs.mkdirSync(out,{recursive:false});
function source(file,name,next){const s=fs.readFileSync(path.join('public/js',file),'utf8');return s.slice(s.indexOf('  function '+name+'('),s.indexOf('  function '+next+'('));}
(async()=>{const rt=resolveBrowserRuntime(engine),browser=await rt.browserType.launch({headless:true,executablePath:rt.executablePath}),results=[];try{const page=await browser.newPage({viewport:{width:390,height:1000}});await page.setContent('<main id="card"></main>');await page.addScriptTag({path:'public/js/polaris-card.js'});
for(const evidence of ['Demo record detail collected for customerRiskFlag.','{"internal":true}',null,'', 'Exposed wiring needs review.'])for(const emergency of [true,false]){
const r=await page.evaluate(({cc,surface,evidence,emergency})=>{
 const graph={customer:{name:'Synthetic customer'},lead:{serviceType:'hvac'},polaris:{snapshot:{risk:{emergency,evidence}}}},before=JSON.stringify(graph),container=document.querySelector('#card'),global=window;
 const snapshot=g=>g.polaris.snapshot,safeString=(v,f='')=>typeof v==='string'&&v.trim()?v.trim():f,presentationString=safeString,byId=()=>container,finiteNumber=()=>null,titleCase=v=>v,actionEntries=()=>[],detailHref=()=>'/demo/leads',destination=()=>'/demo/leads',humanEvidence=()=>[],missingInputs=()=>[];
 const renderPolaris=eval('('+cc.trim()+')'),riskEntries=eval('('+surface.trim()+')');
 renderPolaris([graph]);container.querySelector('details').open=true;const commandCenter=container.innerText;
 NorthStarPolarisCard.render(container,{contract:NorthStarPolarisCard.CONTRACT,surface:'leads',risks:riskEntries(graph)});container.querySelector('details').open=true;return {evidence,emergency,commandCenter,shared:container.innerText,before,after:JSON.stringify(graph)};
},{cc:source('command-center-page.js','renderPolaris','kpiCard'),surface:source('polaris-surface-card.js','riskEntries','leadProjection'),evidence,emergency});
 assert.equal(r.before,r.after);for(const text of [r.commandCenter,r.shared]){assert.equal(text.includes('Emergency reported.'),emergency);if(emergency){assert(!text.includes('No specific risks'));assert(!/Demo record detail|customerRiskFlag|"internal"/.test(text));if(evidence==='Exposed wiring needs review.')assert(text.includes(evidence));else assert(text.includes('Review the job details before proceeding.'));}}results.push(r);
}await page.screenshot({path:path.join(out,'shared-render.png')});fs.writeFileSync(path.join(out,'RESULT.json'),JSON.stringify({engine,scope:'supplemental actual adapter functions and shared DOM renderer; no mounted authority or paid positive fixture',cases:results},null,2));}finally{await browser.close();}})().catch(e=>{fs.writeFileSync(path.join(out,'FAILURE.txt'),e.stack);process.exitCode=1;});
