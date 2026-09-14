'use strict';
const assert=require('node:assert/strict'),request=require('supertest'),crypto=require('node:crypto'),parts=require('./m24-cost-composition-input');
module.exports=async(f,route,headers,version)=>{
 const post=(suffix,body)=>request(f.app).post(route+suffix).set({...headers,'Idempotency-Key':crypto.randomUUID()}).send(body),read=async()=>(await request(f.app).get(route+'/review').set(headers)).body.data;
 let review=await read(),body=parts.planBody(review,'labor'),r=await post('/labor-plan-preview',body);assert.equal(r.status,200);parts.acceptPlanPreview(body,r.body.data);r=await post('/labor-plans',body);assert.equal(r.status,201);review=await read();const p=review.laborPlans.current;
 body={sourcePins:review.pins,expectedPlanId:p.id,expectedPlanRevision:p.revision,expectedPlanDigest:p.digest,expectedDecisionRevision:review.decisions.writeBasis.revision,expectedDecisionDigest:review.decisions.writeBasis.digest,reason:'Explicit local legacy labor adoption.',confirmed:true,confirmationVersion:'estimate-cost-adoption-v'+version,changedComponent:'labor',expectedComponents:version===3?review.travelCostComponents:version===2?review.equipmentCostComponents:review.costComponents,assessment:{}};
 if(version===3)body.coverage={componentManifest:require('../../src/estimating/travelCostComposition').manifest({labor:p}),overlaps:[],equipmentOutside:[],confirmed:true,reason:'Explicit separate source costs.'};
 r=await post('/cost-adoption-preview',body);assert.equal(r.status,200,JSON.stringify(r.body));body.assessment=r.body.data.assessment;return{body,version};
};
