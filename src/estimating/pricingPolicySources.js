'use strict';
const {sha256,stableValue}=require('../services/businessProfileAdapter');
const pricing=require('./pricingPlanContract'),contract=require('./pricingPolicyContract');
function fromPricing(sources,p,review){
 const valid=p?.action==='save'&&p.currency===review.currency&&sha256(p.sourcePins)===sha256(review.pins)&&pricing.sourceList(p.inputs).every(s=>pricing.currentSource(s,sources))&&p.result?.directCosts===sources.basis.directCosts;
 const d=review.decisions.current,reviewedPrice=d?.action==='approve'&&d.currency===review.currency&&sha256(d.sourcePins)===sha256(review.pins)?d.priceBeforeTax:null;
 const payload={...sources,pricingPin:valid?contract.pin(p):null,pricingSources:valid?pricing.sourceList(p.inputs):[],basis:valid?{...sources.basis,overhead:p.result.overhead,proposedBeforeTax:p.result.proposedBeforeTax,reviewedPrice}:null};return stableValue({...payload,digest:sha256(payload)});
}
function demo(state,item,review,now=new Date()){return fromPricing(require('./pricingSourceBasis').demo(state,item,review,now),state.pricingPlans?.[item.ids.estimate]?.[0],review);}
function present(raw,input){const s=require('./pricingSourceBasis').present(raw.baseSources,input),p=raw.pricing;const review={currency:raw.currency,pins:raw.sourcePins,decisions:{current:raw.decision}};return{...fromPricing(s,p,review),digest:raw.digest};}
module.exports={fromPricing,demo,present};
