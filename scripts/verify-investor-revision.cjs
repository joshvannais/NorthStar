'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),out=path.join(root,'outputs/investor-revision');
const hash=()=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'public/unlisted/investor-forecast.html'),'utf8').replace(/\r\n/g,'\n')).digest('hex');
const initial=hash(),receipts=[];
const jobs=[['numerical',['--test','tests/ratification/investor-revision.numerical.cjs']],['before-after',['scripts/investor-before-after.cjs']],['route',['scripts/run-investor-route-tests.cjs']],['bindings',['tests/browser/investor-control-bindings.cjs']],['browser',['tests/browser/unlisted-investor-forecast.js','chrome']]];
for(const [name,args] of jobs){
  if(hash()!==initial)throw new Error('Source changed during verification; start a fresh immutable run.');
  console.log('Starting '+name);
  const result=cp.spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',timeout:600000,maxBuffer:16*1024*1024});
  fs.writeFileSync(path.join(out,`${name}-verification.log`),(result.stdout||'')+(result.stderr||''));
  receipts.push({name,exitCode:result.status,sourceSha256:hash(),error:result.error?.message||null});
  fs.writeFileSync(path.join(out,'verification-results.json'),JSON.stringify({sourceSha256:initial,completed:receipts.length===jobs.length&&result.status===0,checks:receipts},null,2));
  if(result.status!==0||hash()!==initial)throw new Error(`${name} failed or source changed; inspect verification log.`);
  console.log(name+' passed on '+initial);
}
