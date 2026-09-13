'use strict';
const {createOpenAIRuntime,createProductionOpenAIRuntime,countRequest}=require('../../src/polaris/openaiRuntime');
const grounded=require('../../src/polaris/groundedConversation');
const envelope=(purpose='grounded_conversation')=>({purpose,requestId:'fixture',authority:{organizationId:'fixture-org',role:'owner'},untrustedInput:{selected:{kind:'work',id:'fixture-work'},message:'Which details need review?'},groundedContext:{evidence:[],proposals:[],allowedCards:[]}});
const response=(details={cached_tokens:0,cache_write_tokens:0})=>({id:'fixture-response',status:'completed',output_text:JSON.stringify({questions:[],explanations:[],proposalIds:[],requestedCard:'none'}),usage:{input_tokens:100,output_tokens:20,total_tokens:120,input_tokens_details:details}});
function harness({count,create}={}) {
 const countTransport=jest.fn(count|| (async()=>({object:'response.input_tokens',input_tokens:100})));
 const send=jest.fn(create|| (async()=>response()));
 const revalidate=jest.fn(async()=>{});
 return {countTransport,send,revalidate,runtime:createOpenAIRuntime({enabled:true,configured:true,countTransport,client:{responses:{create:send}}})};
}
describe('exact request accounting without live provider access',()=>{
 test('installed SDK supports exact count fields and zero retries using an in-memory fetch',async()=>{
  const OpenAI=require('openai');let wire;
  const client=new OpenAI({apiKey:'synthetic-not-a-key',maxRetries:0,fetch:async(url,options)=>{
    wire={url:String(url),body:JSON.parse(options.body)};
    return new Response(JSON.stringify({object:'response.input_tokens',input_tokens:100}),{status:200,headers:{'Content-Type':'application/json'}});
  }});
  const count=require('../../src/polaris/openaiRuntime').createCountTransport(client);
  const h=harness({count});await h.runtime.respond(envelope(),{revalidate:h.revalidate});
  expect(wire.url).toMatch(/\/responses\/input_tokens$/);expect(wire.body).toEqual(countRequest(h.send.mock.calls[0][0]));
 });
 test.each(['grounded_conversation','caller_guidance'])('%s counts full schema/instructions before one generation',async purpose=>{
  const h=harness();await h.runtime.respond(envelope(purpose),{revalidate:h.revalidate});
  expect(h.countTransport).toHaveBeenCalledTimes(1);expect(h.send).toHaveBeenCalledTimes(1);expect(h.revalidate).toHaveBeenCalledTimes(2);
  const body=h.send.mock.calls[0][0], count=h.countTransport.mock.calls[0][0];expect(count).toEqual(countRequest(body));
  expect(Object.keys(count).sort()).toEqual(['input','instructions','model','reasoning','text','truncation']);
  expect(count.text.format.schema).toEqual(grounded.RESPONSE_JSON_SCHEMA);expect(Object.isFrozen(count.text.format.schema)).toBe(true);
  if(purpose==='caller_guidance')expect(count.instructions).toContain('Speak to the caller naturally');
  expect(h.countTransport.mock.calls[0][1].signal).toBe(h.send.mock.calls[0][1].signal);
 });
 test('whole body byte limit rejects before either transport',async()=>{
  const h=harness(), e=envelope();e.untrustedInput.message='x'.repeat(14500);
  await expect(h.runtime.respond(e,{revalidate:h.revalidate})).rejects.toMatchObject({code:'POLARIS_INPUT_TOO_LARGE'});
  expect(h.countTransport).not.toHaveBeenCalled();expect(h.send).not.toHaveBeenCalled();
 });
 test.each([16001,-1,NaN,1.5])('invalid or excessive count %s never generates',async n=>{
  const h=harness({count:async()=>({object:'response.input_tokens',input_tokens:n})});
  await expect(h.runtime.respond(envelope(),{revalidate:h.revalidate})).rejects.toBeTruthy();expect(h.send).not.toHaveBeenCalled();
 });
 test('count failure makes no retry or generation',async()=>{
  const h=harness({count:async()=>{throw Object.assign(new Error('fixture'),{code:'ECONNRESET'});}});
  await expect(h.runtime.respond(envelope(),{revalidate:h.revalidate})).rejects.toBeTruthy();expect(h.countTransport).toHaveBeenCalledTimes(1);expect(h.send).not.toHaveBeenCalled();
 });
 test('parent abort reaches count transport and prevents generation',async()=>{
  let observed=false;const c=new AbortController();
  const h=harness({count:(_b,{signal})=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>{observed=true;reject(Object.assign(new Error('aborted'),{name:'AbortError'}));},{once:true});c.abort();})});
  await expect(h.runtime.respond(envelope(),{signal:c.signal,revalidate:h.revalidate})).rejects.toBeTruthy();expect(observed).toBe(true);expect(h.send).not.toHaveBeenCalled();
 });
 test('late generation completion after abort is not delivered and retains known cost',async()=>{
  const c=new AbortController(),h=harness({create:async()=>{c.abort();return response();}});
  await expect(h.runtime.respond(envelope(),{signal:c.signal,revalidate:h.revalidate})).rejects.toMatchObject({code:'POLARIS_PROVIDER_TIMEOUT',polarisUsage:{costNanoUsd:44000,outcomeClass:'failed'}});
  expect(h.send).toHaveBeenCalledTimes(1);
 });
 test('count and generation share one twenty-second abort deadline',async()=>{
  jest.useFakeTimers();let generationAborted=false;
  try {
   const h=harness({count:()=>new Promise(resolve=>setTimeout(()=>resolve({object:'response.input_tokens',input_tokens:100}),9000)),
    create:(_body,{signal})=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>resolve(response()),12000);signal.addEventListener('abort',()=>{clearTimeout(timer);generationAborted=true;reject(Object.assign(new Error('aborted'),{name:'AbortError'}));},{once:true});})});
   const rejection=expect(h.runtime.respond(envelope(),{revalidate:h.revalidate})).rejects.toMatchObject({code:'POLARIS_PROVIDER_TIMEOUT',polarisUsage:{costNanoUsd:20000000}});
   await jest.advanceTimersByTimeAsync(20000);await rejection;expect(generationAborted).toBe(true);expect(h.send).toHaveBeenCalledTimes(1);expect(jest.getTimerCount()).toBe(0);
  } finally {jest.useRealTimers();}
 });
 test.each(['authority','body'])('%s changes during count fail closed',async kind=>{
  const e=envelope(), h=harness({count:async()=>{if(kind==='body')e.untrustedInput.message='changed';return {object:'response.input_tokens',input_tokens:100};}});
  if(kind==='authority')h.revalidate.mockResolvedValueOnce(undefined).mockRejectedValueOnce(Object.assign(new Error('changed'),{code:'POLARIS_ACCESS_CHANGED'}));
  await expect(h.runtime.respond(e,{revalidate:h.revalidate})).rejects.toBeTruthy();expect(h.send).not.toHaveBeenCalled();
 });
 test('missing authority callback cannot disclose count',async()=>{
  const h=harness();await expect(h.runtime.respond(envelope())).rejects.toMatchObject({code:'POLARIS_ACCESS_CHANGED'});expect(h.countTransport).not.toHaveBeenCalled();
 });
 test('uncertain generation retains full reservation and never retries',async()=>{
  const h=harness({create:async()=>{throw Object.assign(new Error('fixture'),{code:'ECONNRESET'});}});
  await expect(h.runtime.respond(envelope(),{revalidate:h.revalidate})).rejects.toMatchObject({polarisUsage:{costNanoUsd:20000000,attemptCount:1,providerRequestId:null}});
  expect(h.send).toHaveBeenCalledTimes(1);
 });
 test.each([[0,0,44000],[10,20,43200],[100,0,26000],[0,100,49000]])('cache read %s/write %s has exact charge',async(read,write,expected)=>{
  const h=harness({create:async()=>response({cached_tokens:read,cache_write_tokens:write})});
  expect((await h.runtime.respond(envelope(),{revalidate:h.revalidate})).usage.costNanoUsd).toBe(expected);
 });
 test.each([[60,41],[-1,0],[0,0.5]])('invalid cache buckets %s/%s cannot settle success',async(read,write)=>{
  const h=harness({create:async()=>response({cached_tokens:read,cache_write_tokens:write})});
  await expect(h.runtime.respond(envelope(),{revalidate:h.revalidate})).rejects.toMatchObject({code:'POLARIS_PROVIDER_RESPONSE_INVALID'});expect(h.send).toHaveBeenCalledTimes(1);
 });
 test('production unresolved charge gate cannot be enabled by flags or factory injection',async()=>{
  const factory=jest.fn(()=>{throw new Error('must not construct provider');});
  const runtime=createProductionOpenAIRuntime({POLARIS_OPENAI_ENABLED:'true',OPENAI_API_KEY:'synthetic-not-a-key',POLARIS_GROUNDED_V2_ENABLED:'true'},{clientFactory:factory});
  await expect(runtime.respond(envelope())).rejects.toMatchObject({code:'POLARIS_ACCOUNTING_UNAVAILABLE'});expect(factory).not.toHaveBeenCalled();
 });
});
