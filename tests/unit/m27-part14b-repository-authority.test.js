'use strict';

const childProcess=require('node:child_process');
const path=require('node:path');

const ROOT=path.resolve(__dirname,'../..');
const paths={
  server:path.join(ROOT,'src/server.js'),
  db:path.join(ROOT,'src/db.js'),
  repository:path.join(ROOT,'src/commandCenter/demoRepository.js'),
  route:path.join(ROOT,'src/routes/demo.js'),
  api:path.join(ROOT,'src/routes/api.js'),
  sealed:path.join(ROOT,'src/customerFinancial/paidTenantJourneyAcceptance.js'),
};

function fresh(script,args=[]){
  return JSON.parse(childProcess.execFileSync(process.execPath,['-e',script,...args],{
    cwd:ROOT,encoding:'utf8',env:{...process.env,NODE_ENV:'test'},timeout:120000,
  }));
}

describe('Mission 27 Part 14B canonical application authority',()=>{
  test.each([
    ['db',['db']],['repository',['repository']],['route',['route']],['api',['api']],
    ['db+repository+route+api',['db','repository','route','api']],
  ])('pre-import %s cache substitution fails before authority or effects',(_name,targets)=>{
    const script=String.raw`
'use strict';
const values=JSON.parse(process.argv[1]),targets=JSON.parse(process.argv[2]);
let forgedOperation=0,injectedPoolProvider=0,injectedPoolQuery=0,sourceReads=0,upstream=0;
const forged={
 db:{getPool(){injectedPoolProvider+=1;return {query(){injectedPoolQuery+=1;},connect(){injectedPoolQuery+=1;}};}},
 repository:Object.freeze(Object.assign(Object.create(null),{
   deliverFictionalDemoJourney(){forgedOperation+=1;},
   DemoCommandCenterRepository:class ForgedRepository{constructor(){sourceReads+=1;}},
   DemoCommandCenterHousekeepingWorker:class ForgedWorker{constructor(){upstream+=1;}},
 })),
 route:Object.freeze({stack:[]}),api:Object.freeze({stack:[]}),
};
for(const target of targets)require.cache[values[target]]={id:values[target],filename:values[target],
 loaded:true,exports:forged[target],children:[],paths:[]};
let loaded=false,error=null;
try{require(values.server);loaded=true;}catch(value){error=value&&value.message;}
process.stdout.write(JSON.stringify({loaded,error,forgedOperation,injectedPoolProvider,
 injectedPoolQuery,sourceReads,upstream}));`;
    const result=fresh(script,[JSON.stringify(paths),JSON.stringify(targets)]);
    expect(result).toEqual({loaded:false,
      error:'The fictional demo journey application composition is unavailable.',
      forgedOperation:0,injectedPoolProvider:0,injectedPoolQuery:0,sourceReads:0,upstream:0});
  });

  test('a pre-import Module._load wrapper is rejected before application imports',()=>{
    const script=String.raw`
'use strict';
const server=process.argv[1],Module=require('node:module'),real=Module._load;
let forgedLoads=0;
Module._load=function forgedLoad(request,parent,isMain,options){forgedLoads+=1;
 return real.call(this,request,parent,isMain,options);};
let loaded=false,error=null;
try{require(server);loaded=true;}catch(value){error=value&&value.message;}
process.stdout.write(JSON.stringify({loaded,error,forgedLoads}));`;
    const result=fresh(script,[paths.server]);
    expect(result.loaded).toBe(false);
    expect(result.error).toBe('The fictional demo journey application composition is unavailable.');
    expect(result.forgedLoads).toBe(1);
  });

  test.each([
    'genuine-load-separate-cache','fake-load-genuine-cache','getter','proxy','deleted',
  ])('process.getBuiltinModule %s cannot select the inspected loader/cache',variant=>{
    const script=String.raw`
'use strict';
const values=JSON.parse(process.argv[1]),variant=process.argv[2],Module=require('node:module');
const realDb=require(values.db);let selectorCalls=0,getterCalls=0,fakeLoads=0;
let injectedPoolProvider=0,injectedPoolQuery=0,handlerCalls=0;
const fakePool={query(){injectedPoolQuery+=1;throw new Error('FORGED_DB_QUERY_REACHED');},
 connect(){injectedPoolQuery+=1;throw new Error('FORGED_DB_CONNECT_REACHED');}};
require.cache[values.db]={id:values.db,filename:values.db,loaded:true,exports:{...realDb,
 getPool(){injectedPoolProvider+=1;return fakePool;}},children:[],paths:[]};
const original=process.getBuiltinModule;
const facade=variant==='genuine-load-separate-cache'?{_load:Module._load,_cache:Object.create(null)}:
 variant==='fake-load-genuine-cache'?{_load(){fakeLoads+=1;},_cache:require.cache}:new Proxy({}, {
  get(target,key){getterCalls+=1;return key==='_load'?Module._load:
    key==='_cache'?Object.create(null):Reflect.get(target,key);}
 });
if(variant==='getter')Object.defineProperty(process,'getBuiltinModule',{configurable:true,get(){
 getterCalls+=1;return function(name){selectorCalls+=1;return name==='module'?facade:original(name);};}});
else if(variant==='deleted')delete process.getBuiltinModule;
else process.getBuiltinModule=function(name){selectorCalls+=1;return name==='module'?facade:original(name);};
let loaded=false,error=null;
try{require(values.server);loaded=true;}catch(value){error=value&&value.message;}
process.stdout.write(JSON.stringify({loaded,error,selectorCalls,getterCalls,fakeLoads,
 injectedPoolProvider,injectedPoolQuery,handlerCalls}));`;
    expect(fresh(script,[JSON.stringify(paths),variant])).toEqual({loaded:false,
      error:'The fictional demo journey application composition is unavailable.',
      selectorCalls:0,getterCalls:0,fakeLoads:0,injectedPoolProvider:0,injectedPoolQuery:0,
      handlerCalls:0});
  });

  test('a local require.cache and Module._cache split fails before application imports',()=>{
    const script=String.raw`
'use strict';
const server=process.argv[1],Module=require('node:module'),realExtension=Module._extensions['.js'];
let extensionCalls=0;
Module._extensions['.js']=function(filenameModule,filename){
 if(filename===server){extensionCalls+=1;const cacheAtConstruction=Module._cache;
   Module._cache=Object.create(null);
   try{return realExtension(filenameModule,filename);}
   finally{Module._cache=cacheAtConstruction;}
 }
 return realExtension(filenameModule,filename);
};
let loaded=false,error=null;
try{require(server);loaded=true;}catch(value){error=value&&value.message;}
process.stdout.write(JSON.stringify({loaded,error,extensionCalls}));`;
    expect(fresh(script,[paths.server])).toEqual({loaded:false,
      error:'The fictional demo journey application composition is unavailable.',extensionCalls:1});
  });

  test('direct repository and route imports expose no Part14B operation',()=>{
    const script=String.raw`
'use strict';
const values=JSON.parse(process.argv[1]),repo=require(values.repository),route=require(values.route);
const routePaths=route.stack.filter(layer=>layer.route).map(layer=>layer.route.path);
const Repository=repo.DemoCommandCenterRepository;let injected=0;
class Derived extends Repository{pool(){injected+=1;return {query(){injected+=1;}};}}
const instances=[new Repository(),new Repository(()=>{injected+=1;return {};}),new Derived(),
 Object.create(Repository.prototype),new Proxy(new Repository(()=>{injected+=1;return {};}),{})];
process.stdout.write(JSON.stringify({repoNull:Object.getPrototypeOf(repo)===null,
 repoFrozen:Object.isFrozen(repo),repoKeys:Reflect.ownKeys(repo).filter(key=>String(key).includes('Fictional')),
 hasDelivery:Object.prototype.hasOwnProperty.call(repo,'deliverFictionalDemoJourney'),
 hasBootstrap:Object.prototype.hasOwnProperty.call(repo,'consumeFictionalDemoJourney'),
 prototypeDelivery:typeof Repository.prototype.deliverFictionalDemoJourney,
 instanceDelivery:instances.map(value=>typeof value.deliverFictionalDemoJourney),
 routeHasPart14B:routePaths.includes('/customer-financial/invoice-drafts/:estimateId/part14b-acceptance'),injected}));`;
    const result=fresh(script,[JSON.stringify(paths)]);
    expect(result).toEqual({repoNull:true,repoFrozen:true,repoKeys:[],hasDelivery:false,
      hasBootstrap:false,prototypeDelivery:'undefined',instanceDelivery:Array(5).fill('undefined'),
      routeHasPart14B:false,injected:0});
  });

  test('the two exact auditor pre-import exploits cannot reach a Part14B capability',()=>{
    const script=String.raw`
'use strict';
const values=JSON.parse(process.argv[1]);let provider=0,query=0,forgedOperation=0;
require.cache[values.db]={id:values.db,filename:values.db,loaded:true,exports:{
 getPool(){provider+=1;return {query(){query+=1;},connect(){query+=1;}};}
},children:[],paths:[]};
const api=require(values.repository);
const directType=typeof api.deliverFictionalDemoJourney;
const forged=Object.create(null);
for(const key of Reflect.ownKeys(api))Object.defineProperty(forged,key,
 Object.getOwnPropertyDescriptor(api,key));
Object.defineProperty(forged,'deliverFictionalDemoJourney',{enumerable:true,writable:false,
 configurable:false,value(){forgedOperation+=1;}});Object.freeze(forged);
require.cache[values.repository]={id:values.repository,filename:values.repository,loaded:true,
 exports:forged,children:[],paths:[]};delete require.cache[values.route];
const router=require(values.route),routeCount=router.stack.filter(layer=>layer.route&&layer.route.path===
 '/customer-financial/invoice-drafts/:estimateId/part14b-acceptance').length;
process.stdout.write(JSON.stringify({directType,provider,query,forgedOperation,routeCount}));`;
    expect(fresh(script,[JSON.stringify(paths)])).toEqual({directType:'undefined',provider:0,query:0,
      forgedOperation:0,routeCount:0});
  });

  test('clean canonical startup mounts one private handler and later cache replacement cannot redirect it',()=>{
    const script=String.raw`
'use strict';
const values=JSON.parse(process.argv[1]);require(values.sealed);
const server=require(values.server),repo=require(values.repository);
const routes=server.app._router.stack.filter(layer=>layer.route&&layer.route.path===
 '/api/demo/customer-financial/invoice-drafts/:estimateId/part14b-acceptance');
const handler=routes[0].route.stack[0].handle;let forgedOperation=0,status=null,body=null;
require.cache[values.repository]={id:values.repository,filename:values.repository,loaded:true,
 exports:Object.freeze(Object.assign(Object.create(null),{
  deliverFictionalDemoJourney(){forgedOperation+=1;}
 })),children:[],paths:[]};
const req={method:'POST',params:{estimateId:'11111111-1111-4111-8111-111111111111'},headers:{},
 requestId:'test'};
const res={headersSent:false,writableEnded:false,destroyed:false,set(){return this;},vary(){return this;},
 status(value){status=value;return this;},json(value){body=value;return this;}};
handler(req,res).then(()=>process.stdout.write(JSON.stringify({routeCount:routes.length,
 repoNull:Object.getPrototypeOf(repo)===null,repoFrozen:Object.isFrozen(repo),
 exportedOperation:typeof repo.deliverFictionalDemoJourney,
 exportedBootstrap:typeof repo.consumeFictionalDemoJourney,forgedOperation,status,body})),
 error=>{console.error(error&&error.stack||error);process.exit(1);});`;
    const result=fresh(script,[JSON.stringify(paths)]);
    expect(result).toMatchObject({routeCount:1,repoNull:true,repoFrozen:true,
      exportedOperation:'undefined',exportedBootstrap:'undefined',forgedOperation:0,status:503,
      body:{success:false,error:{code:'demo_command_center_unavailable'}}});
  });
});
