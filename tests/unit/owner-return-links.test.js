'use strict';
const fs=require('fs'),path=require('path');
for(const host of ['operations','completion-review'])test(host+' loads route contract before demo runtime and uses only canonical header destinations',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../../public/dashboard/'+host+'.html'),'utf8');
 const contract=html.indexOf('<script src="/js/command-center-contract.js">'),demo=html.indexOf('<script src="/js/demo-runtime.js">');
 expect(contract).toBeGreaterThan(-1);expect(contract).toBeLessThan(demo);
 const header=html.match(/<header[\s\S]*?<\/header>/)[0];
 const links=[...header.matchAll(/href="([^"]+)"/g)].map(m=>m[1]);
 expect(links).toEqual(host==='operations'?['/dashboard','/dashboard']:['/dashboard','/dashboard/operations']);
});
const vm=require('vm');
function runtime(fetch,path='/demo/operations'){
 const document={documentElement:{classList:{add(){}},dataset:{}},readyState:'loading',addEventListener(){}};
 const window={location:{pathname:path,origin:'https://local.test'},fetch,sessionStorage:{setItem(){}},dispatchEvent(){}};
 vm.runInNewContext(fs.readFileSync(require('path').join(__dirname,'../../public/js/demo-runtime.js'),'utf8'),{window,document,URL,Response,Headers,Map,CustomEvent:function(){}});
 return window.NorthStarDemoRuntime;
}
test('concurrent owner reads wait for one shared workspace and preserve server response status',async()=>{
 let release;const pending=new Promise(r=>release=r),calls=[];
 const fetch=url=>{calls.push(url);return url==='/api/demo/command-center'?pending:Promise.resolve(new Response('{}',{status:401}));};
 const r=runtime(fetch),reads=['/api/v1/operational-overview','/api/v1/field-executions/owner-work','/api/v1/field-executions/11111111-1111-4111-8111-111111111111/completion-review'].map(url=>r.fetch(url));
 expect(calls).toEqual(['/api/demo/command-center']);
 release(new Response(JSON.stringify({success:true,data:{session:{id:'local'},integrity:{revision:1}}})));
 expect((await Promise.all(reads)).map(r=>r.status)).toEqual([401,401,401]);expect(calls).toHaveLength(4);expect(calls.slice(1).every(p=>p.startsWith('/api/demo/command-center/operations'))).toBe(true);
});
test('failed session establishment rejects owner reads without issuing them; paid runtime stays inactive',async()=>{
 const fetch=jest.fn(()=>Promise.resolve(new Response('{}',{status:410}))),r=runtime(fetch);
 await expect(r.fetch('/api/v1/field-executions/owner-work')).rejects.toThrow('workspace is unavailable');expect(fetch).toHaveBeenCalledTimes(1);
 expect(runtime(fetch,'/dashboard/operations').active).toBe(false);expect(fetch).toHaveBeenCalledTimes(1);
});
