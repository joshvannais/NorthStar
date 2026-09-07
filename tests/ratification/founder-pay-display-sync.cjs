'use strict';
// Mechanical worker and fingerprint generation from the canonical inline engine.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..'),file=path.join(root,'public/unlisted/investor-forecast.html'),out=path.join(root,'outputs/founder-pay-display');
let html=fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n');const scripts=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
if(scripts.length!==2)throw Error('Expected canonical engine and UI');
const old=Buffer.from(html.match(/<template id="monteCarloWorkerSource">([\s\S]*?)<\/template>/)[1],'base64').toString();const handler=old.slice(old.indexOf('self.onmessage = function'));
if(!handler.startsWith('self.onmessage'))throw Error('Missing worker handler');
const worker=scripts[0]+'\n'+handler,sha=x=>crypto.createHash('sha256').update(x).digest('hex');
html=html.replace(/(<template id="monteCarloWorkerSource">)[\s\S]*?(<\/template>)/,(_,a,b)=>a+Buffer.from(worker).toString('base64')+b);
for(const [key,value]of Object.entries({engine:scripts[0],ui:scripts[1],css:html.match(/<style>([\s\S]*?)<\/style>/)[1]}))html=html.replace(new RegExp(`(<meta name="northstar-v33-${key}-sha256" content=")[^"]+`),`$1${sha(value)}`);
fs.writeFileSync(file,html);fs.mkdirSync(out,{recursive:true});const manifest={source:'public/unlisted/investor-forecast.html',baseCommit:'fc2251d5e5b1118fa7fa94f740158328f1bdf243',engineSha256:sha(scripts[0]),uiSha256:sha(scripts[1]),workerSha256:sha(worker),htmlSha256:sha(html),bytes:Buffer.byteLength(html)};fs.writeFileSync(path.join(out,'source-manifest.json'),JSON.stringify(manifest,null,2)+'\n');console.log(manifest);
