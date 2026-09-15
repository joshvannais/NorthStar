'use strict';
const {createOpenAIRuntime,createProductionOpenAIRuntime,countRequest}=require('../../src/polaris/openaiRuntime');
const grounded=require('../../src/polaris/groundedConversation');
const accounting=require('../../src/polaris/providerAccounting');
const countAccounting=accounting.parseCountAccounting({POLARIS_INPUT_COUNT_ACCOUNTING_VERSION:accounting.COUNT_ENDPOINT_VERSION,POLARIS_INPUT_COUNT_MAX_COST_NANO_USD:'0',POLARIS_INPUT_COUNT_TARIFF_EVIDENCE_DIGEST:'a'.repeat(64),POLARIS_INPUT_COUNT_TARIFF_REVIEWED_ON:'2026-09-14'});
const envelope=(purpose='grounded_conversation')=>({purpose,requestId:'fixture',authority:{organizationId:'fixture-org',role:'owner'},untrustedInput:{selected:{kind:'work',id:'fixture-work'},message:'Which details need review?'},groundedContext:{evidence:[],proposals:[],allowedCards:[]}});
const response=(details={cached_tokens:0,cache_write_tokens:0})=>({id:'fixture-response',status:'completed',output_text:JSON.stringify({questions:[],explanations:[],proposalIds:[],requestedCard:'none'}),usage:{input_tokens:100,output_tokens:20,total_tokens:120,input_tokens_details:details}});
function harness({count,create}={}) {
 const countTransport=jest.fn(count|| (async()=>({object:'response.input_tokens',input_tokens:100})));
 const send=jest.fn(create|| (async()=>response()));
 const revalidate=jest.fn(async()=>{});
 return {countTransport,send,revalidate,runtime:createOpenAIRuntime({enabled:true,configured:true,countAccounting,countTransport,client:{responses:{create:send}}})};
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
   const rejection=expect(h.runtime.respond(envelope(),{revalidate:h.revalidate})).rejects.toMatchObject({code:'POLARIS_PROVIDER_TIMEOUT',polarisUsage:{costNanoUsd:accounting.MAX_GENERATION_COST_NANO_USD,attemptCount:2}});
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
  await expect(h.runtime.respond(envelope(),{revalidate:h.revalidate})).rejects.toMatchObject({polarisUsage:{costNanoUsd:accounting.MAX_GENERATION_COST_NANO_USD,attemptCount:2,providerRequestId:null}});
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
 test('count and generation keep separate identities while conserving the fixed reservation',async()=>{
  const priced=accounting.parseCountAccounting({POLARIS_INPUT_COUNT_ACCOUNTING_VERSION:accounting.COUNT_ENDPOINT_VERSION,POLARIS_INPUT_COUNT_MAX_COST_NANO_USD:String(accounting.MAX_COUNT_COST_NANO_USD),POLARIS_INPUT_COUNT_TARIFF_EVIDENCE_DIGEST:'b'.repeat(64),POLARIS_INPUT_COUNT_TARIFF_REVIEWED_ON:'2026-09-14'});
  const send=jest.fn(async()=>response()),countTransport=jest.fn(async()=>({object:'response.input_tokens',input_tokens:100}));
  const runtime=createOpenAIRuntime({enabled:true,configured:true,countAccounting:priced,countTransport,client:{responses:{create:send}}});
  const usage=(await runtime.respond(envelope(),{revalidate:async()=>{}})).usage;
  expect(usage).toMatchObject({accountingVersion:accounting.ACCOUNTING_VERSION,costNanoUsd:accounting.MAX_COUNT_COST_NANO_USD+44000,attemptCount:2,count:{inputTokens:100,costCeilingNanoUsd:accounting.MAX_COUNT_COST_NANO_USD,tariffEvidenceDigest:'b'.repeat(64),tariffReviewedOn:'2026-09-14',outcomeClass:'completed'},generation:{providerRequestId:'fixture-response',costNanoUsd:44000}});
  expect(usage.count.requestDigest).toMatch(/^[a-f0-9]{64}$/);expect(usage.count.responseDigest).toMatch(/^[a-f0-9]{64}$/);expect(usage.costNanoUsd).toBeLessThanOrEqual(accounting.TOTAL_RESERVATION_NANO_USD);
 });
 test('production counted path requires a complete bounded tariff record before constructing a client',async()=>{
  const factory=jest.fn(()=>({responses:{inputTokens:{count:async()=>({object:'response.input_tokens',input_tokens:100})},create:async()=>response()}}));
  const base={POLARIS_OPENAI_ENABLED:'true',OPENAI_API_KEY:'synthetic-not-a-key',POLARIS_GROUNDED_V2_ENABLED:'true'};
  const incomplete=createProductionOpenAIRuntime({...base,POLARIS_INPUT_COUNT_ACCOUNTING_VERSION:accounting.COUNT_ENDPOINT_VERSION},{clientFactory:factory});
  await expect(incomplete.respond(envelope(),{revalidate:async()=>{}})).rejects.toMatchObject({code:'POLARIS_ACCOUNTING_UNAVAILABLE'});expect(factory).not.toHaveBeenCalled();
  const complete=createProductionOpenAIRuntime({...base,POLARIS_INPUT_COUNT_ACCOUNTING_VERSION:accounting.COUNT_ENDPOINT_VERSION,POLARIS_INPUT_COUNT_MAX_COST_NANO_USD:'0',POLARIS_INPUT_COUNT_TARIFF_EVIDENCE_DIGEST:'c'.repeat(64),POLARIS_INPUT_COUNT_TARIFF_REVIEWED_ON:'2026-09-14'},{clientFactory:factory});
  await expect(complete.respond(envelope(),{revalidate:async()=>{}})).resolves.toHaveProperty('usage.accountingVersion',accounting.ACCOUNTING_VERSION);expect(factory).toHaveBeenCalledTimes(1);
 });
 test('count tariff configuration is all-or-nothing and bounded by the fixed reservation',()=>{
  const base={POLARIS_INPUT_COUNT_ACCOUNTING_VERSION:accounting.COUNT_ENDPOINT_VERSION,POLARIS_INPUT_COUNT_MAX_COST_NANO_USD:'0',POLARIS_INPUT_COUNT_TARIFF_EVIDENCE_DIGEST:'d'.repeat(64),POLARIS_INPUT_COUNT_TARIFF_REVIEWED_ON:'2026-09-14'};
  expect(accounting.parseCountAccounting(base)).toMatchObject({maxCostNanoUsd:0});
  expect(accounting.parseCountAccounting({...base,POLARIS_INPUT_COUNT_MAX_COST_NANO_USD:String(accounting.MAX_COUNT_COST_NANO_USD+1)})).toBeNull();
  expect(accounting.parseCountAccounting({...base,POLARIS_INPUT_COUNT_TARIFF_EVIDENCE_DIGEST:'not-a-digest'})).toBeNull();
  expect(accounting.parseCountAccounting({...base,POLARIS_INPUT_COUNT_TARIFF_REVIEWED_ON:''})).toBeNull();
 });
});
