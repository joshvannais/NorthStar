'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const base='a2f1de845a1bdc43bb7b556d7067b2d67aa89f9a',root=path.resolve(__dirname,'../..'),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const output=process.argv.find(v=>v.startsWith('--output='))?.slice(9);assert.ok(output&&!fs.existsSync(output));
const git=(...args)=>execFileSync('git',args,{cwd:root});
const oldFiles=git('ls-tree','-r','--name-only',base,'migrations').toString('utf8').trim().split('\n').filter(p=>p.endsWith('.sql'));
assert.equal(oldFiles.length,66);const preserved=oldFiles.map(file=>{const old=git('show',base+':'+file),current=fs.readFileSync(path.join(root,file));assert.deepEqual(current,old,file);return{file,sha256:hash(current)};});
function routine(text,marker){const start=text.indexOf(marker);assert.ok(start>=0);const end=text.indexOf('END $$;',start);assert.ok(end>start);return text.slice(start,end+7);}
const old=routine(git('show',base+':migrations/046_m23_equipment_operations.sql').toString('utf8'),'CREATE FUNCTION public.equipment_operation_mutate('),current=routine(fs.readFileSync(path.join(root,'migrations/069_canonical_equipment_readiness.sql'),'utf8'),'CREATE OR REPLACE FUNCTION public.equipment_operation_mutate(');
const added=[" PERFORM public.canonical_equipment_readiness_fence(org,asset_value);\n"," PERFORM public.equipment_actor(org,actor,role_value,session_value,csrf,TRUE,FALSE);\n"];
assert.equal(current.split(added[0]).length-1,1);assert.equal(current.split(added[1]).length-1,2);
const stripped=current.replace('CREATE OR REPLACE FUNCTION','CREATE FUNCTION').replace(added[0],'').split(added[1]).join('');assert.equal(stripped,old,'046 successor must differ only by one fence and two post-wait actor checks');
fs.writeFileSync(output,JSON.stringify({pass:true,base,preserved,successor:{oldSha256:hash(old),newSha256:hash(current),onlyChanges:['CREATE OR REPLACE syntax','one existing-key fence touch','actor recheck before historical replay','actor recheck before new event'],strippedEqualsOriginal:true},newMigrationSha256:hash(fs.readFileSync(path.join(root,'migrations/069_canonical_equipment_readiness.sql')))},null,2));
console.log('66 prior migrations byte-identical; exact046 successor delta verified.');
