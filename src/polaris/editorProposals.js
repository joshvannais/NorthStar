'use strict';
// Only an explicit, unit-bearing user instruction may populate this bounded field.
// Model prose cannot supply an amount or choose a different task or work-time basis.
function laborAssumption(message,review){
 const match=typeof message==='string'&&message.trim().match(/^set labor line ([1-9]|1[0-9]|20) worker-hours to ((?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,6})?)\.?$/i);
 const plan=review?.laborPlans,current=plan?.current;
 if(!match||!plan?.canMutate||!review.isCurrent||current?.action!=='save')return null;
 const index=Number(match[1])-1,line=current.inputs?.lines?.[index];if(!line||line.basis!=='worker_hours')return null;
 return {id:'propose_labor_hours',editor:'labor',label:'Review Proposed Worker-Hours',planDigest:current.digest,
  sourcePins:review.pins,change:{lineId:line.lineId,index,field:'workerHours',previous:line.workerHours,value:match[2],unit:'worker-hours',source:'explicit_user_assumption'},
  evidenceIds:['user_assumption'],saveRequired:true,renewedReviewRequired:true,
  consequence:'This is your proposed work-time assumption. Recalculate and save the plan, then adopt a new estimate revision and review the price.'};
}
module.exports={laborAssumption};
