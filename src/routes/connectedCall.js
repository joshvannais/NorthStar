'use strict';
const express=require('express');
const webhook=require('../voice/webhook');
const {createConnectedCallAdapter}=require('../polaris/connectedCall');
const {createConnectedCallRepository}=require('../polaris/connectedCallRepository');
function createConnectedCallRouter({getPool,verifyRaw}={}){
 const router=express.Router({caseSensitive:true,strict:true});
 router.post('/api/retell/tools/job-guidance',express.raw({type:()=>true,limit:'64kb'}),async(req,res)=>{
  res.set('Cache-Control','no-store');
  const controller=new AbortController(),abort=()=>{if(!res.writableEnded)controller.abort();};req.once('aborted',abort);res.once('close',abort);
  let timer;const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Object.assign(new Error('Call guidance timed out'),{statusCode:503}));},25000);timer.unref?.();});
  try{
   const verifier=verifyRaw||((raw,signature)=>{const parsed=webhook.parseSignature(signature);return parsed&&webhook.validateTimestamp(parsed.timestamp)&&webhook.validateSignature(raw,signature);});
   // No provider adapter is provisioned by mounting this authenticated boundary.
   const repository=createConnectedCallRepository(getPool);
   const resolveGenerate=()=>{const generate=req.app.locals.connectedCallGenerate;if(typeof generate!=='function')throw Object.assign(new Error('Call guidance is not connected. The owner can review these details.'),{statusCode:503});return generate;};
   const handle=createConnectedCallAdapter({...repository,verifyRaw:verifier,
    authorize:async input=>{const generate=resolveGenerate();if(typeof generate.authorize!=='function')throw Object.assign(new Error('Call guidance authority is unavailable.'),{statusCode:503});return generate.authorize(input);},
    generate:async input=>resolveGenerate()(input)});
   return res.json(await Promise.race([handle(req.body,req.get('X-Retell-Signature'),{signal:controller.signal}),timeout]));
  }catch(e){return res.status([400,403,409,413,429,503].includes(e.statusCode)?e.statusCode:503).json({status:'unavailable',message:'Call guidance is unavailable. Ask the owner to review the missing job details.'});}finally{clearTimeout(timer);controller.abort();req.removeListener('aborted',abort);res.removeListener('close',abort);}
 });return router;
}
module.exports={createConnectedCallRouter};
