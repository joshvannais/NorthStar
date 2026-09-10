'use strict';
const express=require('express');
const {parseUnambiguousJson,rawRequestPath,contentTypeAllowed,contentEncodingAllowed}=require('../scheduling/recommendationHttpBoundary');
const raw=express.raw({inflate:false,limit:32768,type:()=>true});
function estimateDecisionBodyBoundary(req,res,next){
 if(req.method!=='POST'||!/^\/api\/(?:v1\/canonical|demo\/command-center)\/estimates\/[^/]+\/(?:decisions|material-plans|material-plan-preview|material-adoptions|material-adoption-preview)\/?$/.test(rawRequestPath(req)))return next();
 res.set('Cache-Control','no-store');
 const reject=status=>res.status(status).json({success:false,error:{code:'ESTIMATE_DECISION_INVALID',message:'This review could not be read. Check your entries and try again.'}});
 if(!contentTypeAllowed(req)||!contentEncodingAllowed(req))return reject(415);
 raw(req,res,error=>{if(error)return reject(error.type==='entity.too.large'?413:400);try{req.body=parseUnambiguousJson(new TextDecoder('utf-8',{fatal:true}).decode(req.body));req.estimateDecisionBodyValidated=true;return next();}catch(_){return reject(400);}});
}
module.exports={estimateDecisionBodyBoundary};
