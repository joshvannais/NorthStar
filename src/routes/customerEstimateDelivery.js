'use strict';
const express=require('express');
const path=require('node:path');
const crypto=require('node:crypto');
const db=require('../db');
const repository=require('../estimating/customerEstimateDeliveryRepository');
const {rateLimit}=require('../middleware/rateLimit');
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
function publicKey(req){const token=String(req.params.token||'');return'estimate-delivery:'+req.ip+':'+crypto.createHash('sha256').update(token).digest('hex').slice(0,16);}
function sameOrigin(req){const origin=req.get('Origin');if(!origin)return false;try{return new URL(origin).host===req.get('host');}catch(_){return false;}}
function failure(res,error){const e=repository.failure(error);return res.status(e.status).json({success:false,error:{category:e.code,message:e.message}});}
function createCustomerEstimateDeliveryRouter(options={}){const router=express.Router(),poolProvider=options.poolProvider||(()=>db.getPool()),throttle=options.throttle||rateLimit('public-api',publicKey);
 router.get('/customer-estimates/:token',throttle,async(req,res)=>{res.set('Cache-Control','no-store');res.set('Referrer-Policy','no-referrer');if(!TOKEN.test(req.params.token))return failure(res,Object.assign(new Error('unavailable'),{code:'P0002'}));const client=await poolProvider().connect();try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const data=await repository.publicRead(client,req.params.token);await client.query('COMMIT');return res.json({success:true,data});}catch(e){await client.query('ROLLBACK').catch(()=>{});return failure(res,e);}finally{client.release();}});
 async function mutate(req,res,kind){res.set('Cache-Control','no-store');res.set('Referrer-Policy','no-referrer');if(!req.customerEstimateDeliveryBodyValidated||!TOKEN.test(req.params.token)||!sameOrigin(req))return res.status(400).json({success:false,error:{category:'CUSTOMER_ESTIMATE_DELIVERY_INVALID',message:'Open the customer estimate link again and retry this action.'}});try{const data=await repository.publicMutate(poolProvider(),{token:req.params.token,idempotencyKey:req.get('Idempotency-Key'),remoteAddress:req.ip,userAgent:req.get('User-Agent')},req.body,kind);return res.status(data.replayed?200:201).json({success:true,data});}catch(e){return failure(res,e);}}
 router.post('/customer-estimates/:token/accept',throttle,(req,res)=>mutate(req,res,'accepted'));
 router.post('/customer-estimates/:token/questions',throttle,(req,res)=>mutate(req,res,'question'));
 return router;
}
function mountCustomerEstimatePage(app){app.get('/estimate/:token',(req,res)=>{res.set('Cache-Control','no-store');res.set('Referrer-Policy','no-referrer');if(!TOKEN.test(req.params.token))return res.status(404).send('Customer estimate unavailable.');return res.sendFile(path.join(__dirname,'..','..','public','customer-estimate.html'));});}
module.exports={createCustomerEstimateDeliveryRouter,mountCustomerEstimatePage,sameOrigin};
