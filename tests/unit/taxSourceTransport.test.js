'use strict';
const {EventEmitter}=require('node:events');
const {createTaxSourceTransport}=require('../../src/estimating/taxSourceTransport');
const context={country:'US',region:'XX',locality:'',jurisdiction:'',serviceKey:'fixture',classification:''};
function fixture(responses,options={}){
 const calls=[],lookups=[];let destroyed=0,aborted=0;
 const request=(url,config,callback)=>{const req=new EventEmitter();calls.push({url:url.href,config});req.destroy=error=>{if(req.destroyed)return;req.destroyed=true;destroyed++;if(error)req.emit('error',error);queueMicrotask(()=>req.emit('close'));};req.end=()=>queueMicrotask(()=>{const item=responses.shift();if(item.hang){config.signal.addEventListener('abort',()=>{aborted++;req.destroy(new Error('Native request aborted'));},{once:true});return;}const res=new EventEmitter();res.statusCode=item.status||200;res.headers=item.headers||{'content-type':'text/plain'};res.resume=()=>{};res.destroy=()=>{res.destroyed=true;};callback(res);queueMicrotask(()=>{if(item.body)res.emit('data',Buffer.from(item.body));res.emit('end');});});return req;};
 const lookup=async host=>{lookups.push(host);return options.addresses?.[lookups.length-1]||[{address:'8.8.8.8',family:4}];};
 const transport=createTaxSourceTransport({documents:()=>options.documents||[{url:'https://official.example/source'}],allowedOrigins:new Set(['https://official.example','https://other.example']),lookup,request,timeoutMs:100});
 return {transport,calls,lookups,counts:()=>({destroyed,aborted})};
}
test('each approved redirect resolves and pins a public address with no credentials',async()=>{
 const f=fixture([{status:302,headers:{location:'https://other.example/next'}},{body:'Source'}]);
 expect(await f.transport.acquire(context)).toMatchObject([{url:'https://other.example/next',content:'Source'}]);
 expect(f.lookups).toEqual(['official.example','other.example']);
 for(const c of f.calls){expect(c.config.method).toBe('GET');expect(c.config.headers).not.toHaveProperty('Authorization');c.config.lookup('ignored',{},(error,address,family)=>{expect(error).toBeNull();expect(address).toBe('8.8.8.8');expect(family).toBe(4);});}
});
test.each(['http://official.example/path','https://private.example/path','https://user:password@official.example/path'])('rejects unapproved redirect %s',async location=>{
 const f=fixture([{status:302,headers:{location}}]);await expect(f.transport.acquire(context)).rejects.toThrow();expect(f.calls).toHaveLength(1);
});
test('redirect DNS cannot switch to a private address',async()=>{
 const f=fixture([{status:302,headers:{location:'/next'}}],{addresses:[[{address:'8.8.8.8',family:4}],[{address:'127.0.0.1',family:4}]]});await expect(f.transport.acquire(context)).rejects.toThrow(/public network/);expect(f.calls).toHaveLength(1);
});
test('third redirect stops before a fourth request',async()=>{
 const f=fixture(Array.from({length:3},()=>({status:302,headers:{location:'/next'}})));await expect(f.transport.acquire(context)).rejects.toThrow(/redirect limit/);expect(f.calls).toHaveLength(3);
});
test.each([{'content-type':'application/octet-stream'},{'content-type':'text/html','content-encoding':'gzip'}])('rejects unsupported or compressed body %j',async headers=>{
 const f=fixture([{headers,body:'untrusted'}]);await expect(f.transport.acquire(context)).rejects.toThrow(/unsupported/);
});
test('oversize stream destroys native request instead of retaining extra bytes',async()=>{
 const f=fixture([{body:'x'.repeat(32769)}]);await expect(f.transport.acquire(context)).rejects.toThrow(/review limit/);expect(f.counts().destroyed).toBe(1);
});
test('single acquisition deadline aborts a native hung redirect request',async()=>{
 const f=fixture([{status:302,headers:{location:'/next'}},{hang:true}]);await expect(f.transport.acquire(context)).rejects.toThrow(/interrupted/);expect(f.counts()).toEqual({destroyed:2,aborted:1});expect(f.calls[0].config.signal).toBe(f.calls[1].config.signal);
});

test('one acquisition deadline spans two documents and aborts the second native request',async()=>{
 const f=fixture([{body:'first'},{hang:true}],{documents:[{url:'https://official.example/first'},{url:'https://official.example/second'}]});const start=Date.now();await expect(f.transport.acquire(context)).rejects.toThrow();expect(f.calls).toHaveLength(2);expect(f.counts().aborted).toBe(1);expect(Date.now()-start).toBeLessThan(1000);
});
