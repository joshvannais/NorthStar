'use strict';
// Benign local trusted fixtures exercise the shared renderer, including empty evidence.
process.env.NODE_ENV='test';
process.env.AUTH_ACCESS_SECRET='m213-renderer-local-fixture-secret-only';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const fixture=require('./pre-m23-p6-polaris-safe'),trusted=require('../../public/js/polaris-trusted-presentation');
const native=require('../../public/js/polaris-native-card');
const arg=n=>process.argv.find(v=>v.startsWith('--'+n+'=')).slice(n.length+3),engine=arg('browser'),out=path.resolve(arg('output'));
assert.ok(!fs.existsSync(out));fs.mkdirSync(out,{recursive:true});
(async()=>{let server,browser;const ledger={engine,cases:[],pass:false};try{
 server=await fixture.listen();const origin='http://127.0.0.1:'+server.address().port,rt=require('../helpers/playwright-runtime').resolveBrowserRuntime(engine);
 browser=await rt.browserType.launch({headless:true,executablePath:rt.executablePath});
 for(const demo of [false,true])for(const [width,theme]of[[1440,'light'],[390,'dark']]){
  const tag=(demo?'demo':'paid')+'-'+width+'-'+theme,c=await browser.newContext({viewport:{width,height:1000}});await c.addInitScript(t=>localStorage.setItem('northstar-theme',t),theme);
  const p=await c.newPage(),state={external:[],api:[],messageCalls:0,messageKeys:[],unconfigured:false};await fixture.installRoutes(p,state);
  await p.goto(origin+(demo?'/demo/polaris':'/dashboard/polaris')+'?kind=lead&id='+fixture.LEAD);await p.locator('.polaris-native-card').first().waitFor();
  const card=fixture.messageResponse({idempotencyKey:'benign-local-render'},false).cards[0];
  card.evidence=[];card.confidence={value:null,level:'unknown',basis:'No confidence recorded.'};
  card.unknowns=[{code:'not_calculated_1',label:'Unused source label'},{code:'not_calculated_2',label:'Unused source label'},{code:'schedule_missing',label:'Unused source label'}];
  const selected=card.authority.selected,projected=trusted.projectTrustedDisplay([card],selected,'canonical_overview').cards[0],before=JSON.stringify(projected);
  native.validateCustomerIntelligenceCard(projected);
  const result=await p.evaluate(card=>{const host=document.createElement('div');host.id='m213-render-fixture';document.querySelector('main').prepend(host);const before=JSON.stringify(card);NorthStarPolarisCard.renderCustomerIntelligenceCard(host,card);return{before,after:JSON.stringify(card),text:host.innerText,notices:[...host.querySelectorAll('.polaris-native-card-unknown')].map(e=>e.textContent)};},projected);
  assert.equal(result.before,result.after);assert.equal(JSON.stringify(projected),before);assert.deepEqual(projected.unknowns.map(x=>x.code),['not_calculated_1','not_calculated_2','schedule_missing']);
  assert.deepEqual(result.notices,['An additional calculation is not available. (2 unresolved items)','A scheduled start is not recorded.']);
  assert.match(result.text,/No supporting details are recorded yet\./);assert.match(result.text,/Recorded-Detail Confidence/);assert.match(result.text,/not price accuracy/);assert.doesNotMatch(result.text,/canonical evidence/);
  const invalid=JSON.parse(before);invalid.confidence.value=2;assert.throws(()=>native.validateCustomerIntelligenceCard(invalid));
  await p.locator('#m213-render-fixture').scrollIntoViewIfNeeded();await p.screenshot({path:path.join(out,tag+'-empty.png')});
  const populated=fixture.messageResponse({idempotencyKey:'benign-populated-render'},false).cards[0];populated.unknowns=card.unknowns;populated.evidence.forEach(e=>{e.confidence=1;});populated.confidence.value=1;populated.confidence.level='high';
  const actual=trusted.projectTrustedDisplay([populated],selected,'canonical_overview').cards[0];
  await p.evaluate(card=>NorthStarPolarisCard.renderCustomerIntelligenceCard(document.getElementById('m213-render-fixture'),card),actual);
  const text=await p.locator('#m213-render-fixture').innerText();assert.match(text,/100%/);assert.match(text,/Recorded-Detail Confidence/);assert.match(text,/not price accuracy/);
  await p.screenshot({path:path.join(out,tag+'-recorded.png')});ledger.cases.push({tag,empty:result,populatedText:text,unknownIds:projected.unknowns.map(x=>x.code),invalidConfidenceRejected:true,pass:true});await c.close();
 }
 ledger.pass=true;
}catch(e){ledger.error=e.stack;process.exitCode=1;}finally{if(browser)await browser.close();if(server)await fixture.closeServer(server);fs.writeFileSync(path.join(out,'RESULT.json'),JSON.stringify(ledger,null,2));console.log(JSON.stringify({pass:ledger.pass,cases:ledger.cases.length,error:ledger.error}));}})();
