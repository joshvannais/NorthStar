'use strict';

const childProcess=require('node:child_process');
const path=require('node:path');

describe('Mission 27 Part 14B canonical repository authority',()=>{
  test('fresh construction, subclassing, rebinding and export mutation cannot grant Part14B DB authority',()=>{
    const repositoryPath=path.resolve(__dirname,'../../src/commandCenter/demoRepository.js');
    const routePath=path.resolve(__dirname,'../../src/routes/demo.js');
    const script=String.raw`
'use strict';
const repositoryPath=process.argv[1],routePath=process.argv[2];
const api=require(repositoryPath);
const Repository=api.DemoCommandCenterRepository;
let injectedProviderCalls=0,injectedPoolCalls=0;
const injectedProvider=()=>{injectedProviderCalls+=1;return {query(){injectedPoolCalls+=1;},connect(){injectedPoolCalls+=1;}};};
class Subclass extends Repository { pool(){injectedPoolCalls+=1;return injectedProvider();} }
class ReturningSubclass extends Repository { constructor(){super(injectedProvider);return Object.create(Repository.prototype);} }
const values=[new Repository(),new Repository(injectedProvider),new Subclass(),
  new ReturningSubclass(),Object.create(Repository.prototype),
  new Proxy(new Repository(injectedProvider),{})];
const noConstructedOperation=values.every(value=>value.deliverFictionalDemoJourney===undefined);
const prototypeOperation=Repository.prototype.deliverFictionalDemoJourney;
const descriptor=Object.getOwnPropertyDescriptor(api,'deliverFictionalDemoJourney');
const entry=require.cache[repositoryPath];
const exportDescriptor=Object.getOwnPropertyDescriptor(entry,'exports');
const mutationResults=[];
for(const mutate of [
  ()=>{api.deliverFictionalDemoJourney=()=>{};},
  ()=>{delete api.deliverFictionalDemoJourney;},
  ()=>Object.defineProperty(api,'deliverFictionalDemoJourney',{value:()=>{}}),
  ()=>Object.assign(api,{deliverFictionalDemoJourney:()=>{}}),
  ()=>Object.setPrototypeOf(api,{}),
  ()=>{entry.exports={};},
  ()=>Object.defineProperty(entry,'exports',{value:{}}),
]) { try{mutate();mutationResults.push('changed');}catch(_){mutationResults.push('rejected');} }
const router=require(routePath);
const routeCapturedOriginal=api.deliverFictionalDemoJourney===descriptor.value;
let forgedRouteCalls=0;
require.cache[repositoryPath]={id:repositoryPath,filename:repositoryPath,loaded:true,
  exports:Object.freeze(Object.assign(Object.create(null),{
    deliverFictionalDemoJourney(){forgedRouteCalls+=1;throw new Error('forged route authority');}
  })),children:[],paths:[]};
const routeLayer=router.stack.find(layer=>layer.route?.path===
  '/customer-financial/invoice-drafts/:estimateId/part14b-acceptance');
const mountedHandler=routeLayer.route.stack[0].handle;
let mountedStatus=null;
const mountedResponse={headersSent:false,writableEnded:false,destroyed:false,
  set(){return this;},vary(){return this;},status(value){mountedStatus=value;return this;},json(){return this;}};
const request={method:'POST'};
Promise.all([
  api.deliverFictionalDemoJourney.call(values[1],request,{}).then(()=>false,error=>error?.status===503),
  api.deliverFictionalDemoJourney.bind(values[2])(request,{}).then(()=>false,error=>error?.status===503),
  mountedHandler(request,mountedResponse).then(()=>mountedStatus===503),
]).then(aliasRejected=>{
  process.stdout.write(JSON.stringify({noConstructedOperation,prototypeOperationType:typeof prototypeOperation,
    apiNull:Object.getPrototypeOf(api)===null,apiFrozen:Object.isFrozen(api),
    descriptor:{writable:descriptor.writable,configurable:descriptor.configurable,
      enumerable:descriptor.enumerable,type:typeof descriptor.value},
    exportDescriptor:{writable:exportDescriptor.writable,configurable:exportDescriptor.configurable},
    mutationResults,routeCapturedOriginal,aliasRejected,forgedRouteCalls,
    injectedProviderCalls,injectedPoolCalls}));
},error=>{process.stderr.write(String(error?.stack||error));process.exit(1);});
`;
    const result=JSON.parse(childProcess.execFileSync(process.execPath,
      ['-e',script,repositoryPath,routePath],{cwd:path.resolve(__dirname,'../..'),encoding:'utf8'}));
    expect(result).toEqual({
      noConstructedOperation:true,prototypeOperationType:'undefined',apiNull:true,apiFrozen:true,
      descriptor:{writable:false,configurable:false,enumerable:true,type:'function'},
      exportDescriptor:{writable:false,configurable:false},
      mutationResults:Array(7).fill('rejected'),routeCapturedOriginal:true,
      aliasRejected:[true,true,true],forgedRouteCalls:0,injectedProviderCalls:0,injectedPoolCalls:0,
    });
  });
});
