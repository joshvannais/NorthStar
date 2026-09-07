'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'outputs/investor-revision/p3-notice');fs.mkdirSync(out,{recursive:true});
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const read=()=>fs.readFileSync(path.join(root,'public/unlisted/investor-forecast.html'),'utf8').replace(/\r\n/g,'\n');
const priorHead='90bd1de43c139e6fc903843726a17ce459b68fba';
const prior=cp.execFileSync('git',['show',priorHead+':public/unlisted/investor-forecast.html'],{cwd:root,encoding:'utf8',maxBuffer:8e6});
const source=read(),initial=sha(source);
const scripts=html=>[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]);
const [oldEngine,oldUi]=scripts(prior),[engine,ui]=scripts(source);
const withoutDefaults=engine=>engine.replace(/  function createDefaultConfig\(overrides\) \{[\s\S]*?\n  function applyScenarioPreset/, '  function applyScenarioPreset');
assert.equal(withoutDefaults(engine),withoutDefaults(oldEngine),'no numerical-engine edits outside config notice generation');
assert.equal(ui,oldUi,'UI script unchanged');
assert.equal(source.match(/<style>([\s\S]*?)<\/style>/)[1],prior.match(/<style>([\s\S]*?)<\/style>/)[1],'all CSS unchanged');
const header=html=>html.slice(html.indexOf('<header'),html.indexOf('</header>')+9);assert.equal(header(source),header(prior),'header markup unchanged');
const report={sourceSha256:initial,priorHead,priorHtmlSha256:sha(prior),scopeChecks:{engineOutsideCreateDefaultConfigIdentical:true,uiIdentical:true,cssIdentical:true,headerIdentical:true},retainedBroadChecks:{head:priorHead,sourceSha256:sha(prior),bindingCount:276,originalBrowserAssertions:2544,rerunOnThisRevision:false},testFirst:{passed:14,failed:3,sourceHead:priorHead},completed:false,checks:[]};
const jobs=[['actual-history',['--test','tests/ratification/investor-actual-history.cjs']],['numerical',['--test','tests/ratification/investor-revision.numerical.cjs']],['route',['scripts/run-investor-route-tests.cjs']],['actual-browser',['tests/browser/investor-actual-history.cjs']]];
for(const [name,args] of jobs){assert.equal(sha(read()),initial,'source immutable before check');console.log('Starting '+name);const result=cp.spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',timeout:240000,maxBuffer:16e6});fs.writeFileSync(path.join(out,name+'.log'),((result.stdout||'')+(result.stderr||'')).trimEnd()+'\n');report.checks.push({name,exitCode:result.status,sourceSha256:sha(read()),error:result.error?.message||null});report.completed=report.checks.length===jobs.length&&result.status===0;fs.writeFileSync(path.join(out,'verification-results.json'),JSON.stringify(report,null,2)+'\n');assert.equal(result.status,0,name+' failed');assert.equal(sha(read()),initial,'source immutable after check');console.log(name+' passed');}
