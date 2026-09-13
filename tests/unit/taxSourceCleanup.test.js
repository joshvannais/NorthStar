'use strict';
const http=require('node:http');
const {createTaxSourceTransport}=require('../../src/estimating/taxSourceTransport');
const context={country:'US',region:'CT',locality:'Windsor',jurisdiction:'CT',serviceKey:'fixture',classification:'fixture'};
jest.setTimeout(10000);
test.each(['status','mime','encoding','bad_redirect','follow_redirect','caller_abort','timeout','success','parser_reject'])('native localhost lifecycle closes all %s responses before return',async mode=>{
 const owned=[],server=http.createServer((req,res)=>{
  const state={path:req.url,closed:false,ticks:0};owned.push(state);res.on('close',()=>{state.closed=true;clearInterval(state.timer);});
  if(mode==='follow_redirect'&&req.url==='/next'||mode==='success'){res.writeHead(200,{'content-type':'text/plain'});res.end('fixture');return;}
  if(mode==='parser_reject'){res.writeHead(200,{'content-type':'application/pdf'});res.end('%PDF-invalid');return;}
  const headers={'content-type':mode==='mime'?'application/octet-stream':'text/plain'};
  if(mode==='encoding')headers['content-encoding']='gzip';
  if(mode.includes('redirect'))headers.location=mode==='bad_redirect'?'https://unapproved.example/source':'/next';
  res.writeHead(mode==='status'?403:mode.includes('redirect')?302:200,headers);res.write('small benign body');
  state.timer=setInterval(()=>{state.ticks++;res.write('x');},10);
 });
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 const requests=[],responses=[],controller=new AbortController();
 const request=(url,options,callback)=>{const req=http.request({host:'127.0.0.1',port:server.address().port,path:url.pathname,method:'GET',signal:options.signal,agent:false},res=>{responses.push(res);callback(res);});requests.push(req);return req;};
 const transport=createTaxSourceTransport({documents:()=>[{url:'https://official.example/source',...(mode==='parser_reject'?{documentType:'pdf'}:{})}],allowedOrigins:new Set(['https://official.example']),lookup:async()=>[{address:'8.8.8.8',family:4}],request,timeoutMs:mode==='timeout'?100:2000});
 let abortTimer;
 try{
  if(mode==='caller_abort')abortTimer=setTimeout(()=>controller.abort(),50);
  if(['success','follow_redirect'].includes(mode))await expect(transport.acquire(context,{signal:controller.signal})).resolves.toMatchObject([{content:'fixture'}]);
  else await expect(transport.acquire(context,{signal:controller.signal})).rejects.toThrow();
  expect(requests.every(r=>r.destroyed&&r.closed)).toBe(true);
  expect(responses.every(r=>r.destroyed)).toBe(true);
  // Local peer close notification is asynchronous; no body may remain active.
  await new Promise(done=>setTimeout(done,25));expect(owned.every(r=>r.closed)).toBe(true);
  if(mode==='follow_redirect')expect(requests).toHaveLength(2);
 }finally{clearTimeout(abortTimer);controller.abort();server.closeAllConnections();await new Promise(done=>server.close(done));}
});
