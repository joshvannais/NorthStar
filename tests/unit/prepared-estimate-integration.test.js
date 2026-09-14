'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
test('every existing shared drawer host loads the prepared controller first',()=>{
 const hosts=['dashboard.html','demo-dashboard.html','dashboard/command-center.html','dashboard/communications.html','dashboard/leads.html','dashboard/polaris.html'];
 for(const host of hosts){const html=fs.readFileSync(path.join(root,'public',host),'utf8');assert.equal(html.split('/js/prepared-estimate.js').length,2);assert(html.indexOf('/js/prepared-estimate.js')<html.indexOf('/js/customer-detail.js'));}
});
test('prepared controller has only ephemeral transport and no persistence or aggregate save',()=>{
 const js=fs.readFileSync(path.join(root,'public/js/prepared-estimate.js'),'utf8');assert.equal((js.match(/NorthStarAccountSession\.fetch/g)||[]).length,1);assert(js.includes("'/proposal-preview'"));assert(!/localStorage|sessionStorage|proposal-adoptions|material-plans|pricing-plans|Idempotency-Key/.test(js));
 const demo=fs.readFileSync(path.join(root,'public/js/demo-runtime.js'),'utf8');assert(demo.includes("preparedHeaders.set('X-NorthStar-Demo-Intent','proposal-preview')"));assert(demo.includes("encodeURIComponent(prepared[1])+'/proposal-preview'"));
});
