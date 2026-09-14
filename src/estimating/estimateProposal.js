'use strict';
const {stableValue,sha256}=require('../services/businessProfileAdapter');
const recipeEngine=require('./proposalRecipe');
const VERSION='estimate-proposal-preview-v1';
const FIELDS={materials:{quantity:null,wastePercent:'1',unitPrice:null},labor:{workerHours:'worker_hour',elapsedHours:'hour',quantity:null,hoursPerUnit:null,hourlyCost:null,burdenPercent:'1'},pricing:{quantity:null,rate:null,amount:null}};
function fail(message,status=400){throw Object.assign(new Error(message),{status,code:'ESTIMATE_PROPOSAL_INVALID'});}
function exact(v,keys){return v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));}
function normalize(body){
 if(!exact(body,['version','selectedRevision','expectedBasisDigest','overrides','candidateIds'])||body.version!==VERSION||!(body.selectedRevision===null||Number.isSafeInteger(body.selectedRevision)&&body.selectedRevision>0&&body.selectedRevision<=10000)||!(body.expectedBasisDigest===null||typeof body.expectedBasisDigest==='string'&&/^[a-f0-9]{64}$/.test(body.expectedBasisDigest))||!Array.isArray(body.overrides)||body.overrides.length>24||!Array.isArray(body.candidateIds)||body.candidateIds.length>24||Buffer.byteLength(JSON.stringify(body))>131072)fail('Review the prepared estimate entries.');
 const ids=new Set();for(const o of body.overrides){if(!exact(o,['fieldId','value','unit','sourceKind','reason'])||typeof o.fieldId!=='string'||ids.has(o.fieldId)||o.sourceKind!=='owner_assumption'||typeof o.reason!=='string'||!o.reason.trim()||o.reason.length>500||typeof o.unit!=='string'||typeof o.value!=='string')fail('Describe the quantity, unit and reason for each owner estimate.');ids.add(o.fieldId);}
 if(new Set(body.candidateIds).size!==body.candidateIds.length||body.candidateIds.some(id=>typeof id!=='string'||id.length>100))fail('Choose an available resource.');
 if(body.expectedBasisDigest===null&&(body.overrides.length||body.candidateIds.length))fail('Prepare the estimate before applying changes.');
 return stableValue(body);
}
function sourceRecipes(sources){
 // Only the already authorized projection reaches here; no raw knowledge rows.
 return(sources.knowledge||[]).filter(s=>s.content?.estimateProposalRecipe).map(s=>{if(!/^[a-f0-9-]{36}$/i.test(s.publicationId)||!/^[a-f0-9]{64}$/.test(s.canonicalDigest))fail('The company recipe source is unavailable.',409);return{pin:{id:s.publicationId,digest:s.canonicalDigest},label:s.label,recipe:s.content.estimateProposalRecipe};});
}
function inputsFor(component,evaluation,currency){
 const inputs=stableValue(component.inputs),allowed=FIELDS[component.kind]||{};
 for(const b of component.bindings){
  if(!Object.hasOwn(allowed,b.field))fail('This recipe contains an unsupported calculated field.');
  const row=b.line===null?inputs:inputs.lines?.[b.line];if(!row||!Object.hasOwn(row,b.field))fail('This recipe refers to a missing line.');
  const value=evaluation.values[b.step];if(!value)return null;if(value.decimal===null)fail('This quantity needs an explicit rounding rule before calculation.');
  const expected=allowed[b.field]||(b.field==='unitPrice'?currency+'/'+row.unit:b.field==='hourlyCost'?currency+'/hour':b.field==='amount'?currency:b.field==='hoursPerUnit'?'worker_hour/'+row.unit:row.unit);
  if(!expected||!recipeEngine.sameUnit(value.unit,expected))fail('The calculated quantity or rate has the wrong unit.');
  let v=value.decimal;
  if(['unitPrice','hourlyCost','amount'].includes(b.field)){const[a,d='']=v.split('.');if(d.length>2)fail('Declare a cost rounded to cents before using it.');v=a+'.'+d.padEnd(2,'0');}
  row[b.field]=v;
 }
 return inputs;
}
function calculateComponent(c,inputs,currency,sourceContext,review){
 if(c.kind==='materials')return require('./materialPlanContract').calculate(inputs,currency,c.version);
 if(c.kind==='labor'){const m=require('./laborPlanContract');if(c.version!==m.VERSION)fail('This labor recipe version is unavailable.');return m.calculate(inputs,currency);}
 if(c.kind==='equipment'){const m=require('./equipmentPlanContract');if(c.version!==m.VERSION)fail('This equipment recipe version is unavailable.');return m.evaluate(inputs,sourceContext,new Date(sourceContext.now));}
 if(c.kind==='travel'){const m=require('./travelPlanContract');if(c.version!==m.VERSION)fail('This travel recipe version is unavailable.');return m.calculate(inputs,currency);}
 if(c.kind==='pricing'){const m=require('./pricingPlanContract');if(c.version!==m.VERSION)fail('This pricing recipe version is unavailable.');return m.preview(inputs,currency,{...review.pricingPlans.sources,basis:{directCosts:null,overheadIncluded:[],overheadUnresolved:true}},new Date(sourceContext.now));}
 fail('This recipe component is unavailable.');
}
function build({review,item,sources,now=new Date(),expiresAt=null,simulated=false},raw){
 const body=normalize(raw),moment=new Date(now),selected=review.selectedRevision??null;
 if(body.selectedRevision!==null&&body.selectedRevision!==selected||review.isCurrent===false)fail('The selected estimate changed. Refresh and choose the current estimate.',409);
 const recipes=sourceRecipes(sources),applicable=[];for(const entry of recipes){if(entry.recipe?.serviceKey!==item.snapshot.service.key)continue;const r=recipeEngine.normalize(entry.recipe);applicable.push({...entry,recipe:r});}
 const components={};for(const[k,name]of Object.entries({materials:'materialPlans',labor:'laborPlans',equipment:'equipmentPlans',travel:'travelPlans',pricing:'pricingPlans'})){const p=review[name]?.current;components[k]=p?{id:p.id,revision:p.revision,digest:p.digest,action:p.action}:null;}
 const timeWindow=Math.floor(moment.getTime()/300000);
 const basis={pins:review.pins,selectedRevision:selected,components,decisionBasis:review.decisions?.writeBasis||null,pricingSourceDigest:review.pricingPlans?.sources?.digest||null,pricingPolicyDigest:review.pricingPolicies?.current?.digest||null,pricingPolicySourceDigest:review.pricingPolicies?.sources?.digest||null,sourceDigest:sources.authorityDigest,resourcesDigest:sources.resources?.digest||null,recipes:applicable.map(r=>({pin:r.pin,digest:sha256(r.recipe)})),date:moment.toISOString().slice(0,10),timeWindow};
 const basisDigest=sha256(basis);if(body.expectedBasisDigest!==null&&body.expectedBasisDigest!==basisDigest)fail('The estimate or its sources changed. Refresh before calculating again.',409);
 const sourceExpiries=[...(sources.assets||[]),...(sources.references||[])].map(s=>Date.parse(s.research?.freshUntil)).filter(t=>Number.isFinite(t)&&t>moment.getTime());
 const deadline=Math.min((timeWindow+1)*300000,expiresAt?Date.parse(expiresAt):Infinity,...sourceExpiries);if(!Number.isFinite(deadline)||deadline<=moment.getTime())fail('This estimate review expired. Refresh to continue.',410);
 const result={version:VERSION,basisDigest,sourcePins:review.pins,componentPins:components,selectedRevision:selected,generatedAt:moment.toISOString(),expiresAt:new Date(deadline).toISOString(),simulated,readiness:'incomplete',components:[],assumptions:[],questions:[],conflicts:[],candidates:{equipment:[],workers:[],availability:'unknown'},completeCost:null,notice:'This is a draft calculation. It does not save plans, approve a price or reserve resources.'};
 result.candidates.workers=sources.resources?.workers||[];result.candidates.truncated=sources.resources?.truncated===true;
 const selectedCandidates=body.candidateIds.map(id=>result.candidates.workers.find(c=>c.id===id));
 if(selectedCandidates.some(c=>!c))fail('A selected resource is no longer available. Refresh the prepared estimate.',409);
 result.selectedCandidateIds=body.candidateIds;
 if(selectedCandidates.some(c=>c.status==='blocked')){result.readiness='blocked';result.conflicts.push('A selected resource does not meet the current requirements. Choose another resource or resolve the recorded conflict.');return stableValue(result);}
 if(applicable.length>1){result.readiness='blocked';result.conflicts.push('More than one company recipe applies. Choose and review the intended recipe before preparing this estimate.');return stableValue(result);}
 if(sources.truncated===true){result.questions=[{id:'source_limit',question:'Review the remaining company sources before choosing a recipe.',why:'Only part of the current source set could be checked. This is not a complete search.'}];result.primaryQuestions=result.questions;return stableValue(result);}
 if(!applicable.length){result.questions=item.snapshot.service.key==='tree_removal'?[
  {id:'measured_output',question:'What output volume and weight should the owner plan to haul?',why:'Tree dimensions do not establish usable chip volume, density or payload. The owner or estimator can add measured details later.'},
  {id:'usable_capacity',question:'What usable vehicle capacity and existing load apply?',why:'Both volume and payload limits matter. Existing contents may still require disposal even when no new output is produced.'},
  {id:'haul_plan',question:'Which disposal destination, route legs and unloading time apply?',why:'Dump trips, driving, queue time and driver absence cannot be invented from a location name.'},
  {id:'work_requirements',question:'Which tasks, equipment and qualified crew does this job require?',why:'Site access, task dependencies, current qualifications and availability need explicit review.'},
  {id:'declared_costs',question:'Which current internal rates and fees apply?',why:'No supplier prices, fuel costs, labor rates or equipment allocations have been established for this job.'}
 ]:[{id:'company_recipe',question:'What quantities, work time and internal rates apply to this job?',why:'No current company recipe is recorded for this service. Add the technical details with the owner or estimator.'}];result.primaryQuestions=result.questions.slice(0,3);if(body.overrides.length||body.candidateIds.length)fail('A current recipe is needed before applying these entries.');return stableValue(result);}
 const entry=applicable[0],r=entry.recipe;
 result.recipe={id:r.id,version:r.version,source:entry.pin,label:entry.label,effectiveOn:r.effectiveOn,reviewBy:r.reviewBy,geography:r.geography};
 result.editableFields=r.fields;
 result.sourceFacts=r.fields.map(f=>({fieldId:f.id,label:f.label,value:sources.unconfirmedFields?.includes(f.id)?null:sources.facts?.[f.id]?.value??(f.type==='category'?(sources.proposalScope||sources.scope)?.[f.id]??null:null),unit:f.unit,state:sources.unconfirmedFields?.includes(f.id)?'needs_confirmation':'recorded_or_missing'}));
 if(r.currency!==review.currency)fail('The company recipe currency does not match this estimate.');
 const facts={};for(const f of r.fields){const fact=sources.facts?.[f.id];if(fact)facts[f.id]=fact;}
 for(const o of body.overrides){if(!r.fields.some(f=>f.id===o.fieldId))fail('This entry is not part of the current recipe.');facts[o.fieldId]={value:o.value,unit:o.unit,source:o.reason};result.assumptions.push(o);}
 const evaluation=recipeEngine.evaluate(r,facts,moment);
 for(const rule of r.applicability){const override=body.overrides.find(o=>o.fieldId===rule.fieldId&&r.fields.find(f=>f.id===o.fieldId)?.type==='category'),actual=override?override.value:(sources.proposalScope||sources.scope)?.[rule.fieldId];if(actual===null||actual===undefined)result.questions.push({id:rule.fieldId,question:rule.question,why:'Confirm this detail before applying the company recipe.'});else if(actual!==rule.value)result.conflicts.push('A recorded job detail does not match this company recipe. Choose an applicable recipe or review the job details.');}
 if(result.conflicts.length){result.readiness='blocked';return stableValue(result);}
 if(result.questions.length)return stableValue(result);
 // Geography is an exact declared applicability label, not inferred coverage.
 if(sources.geography!==r.geography){result.questions.push({id:'recipe_geography',question:'Does this company recipe apply at the job location?',why:'Its recorded area has not been matched to this job.'});return stableValue(result);}
 result.questions.push(...evaluation.questions);result.readiness=evaluation.state;
 result.expiresAt=new Date(Math.min(deadline,Date.parse(r.reviewBy+'T23:59:59.999Z'))).toISOString();
 if(evaluation.state==='needs_review')return stableValue(result);
 for(const c of r.components){const saved=review[{materials:'materialPlans',labor:'laborPlans',equipment:'equipmentPlans',travel:'travelPlans',pricing:'pricingPlans'}[c.kind]]?.current;
  if(saved?.action==='save'){
   const available=saved.inputs&&saved.sourceUnavailable!==true;
   result.components.push({kind:c.kind,version:saved.calculationVersion,inputs:available?saved.inputs:null,result:available?saved.result:null,state:available&&saved.sourceBasisCurrent===true?'retained':'needs_review',replacesSaved:false,savedPlanPresent:true,origin:'current_saved_plan'});
   result.questions.push({id:c.kind+'_saved',question:'Review the saved '+c.kind+' plan under Edit.',why:'The saved plan is retained. New recipe assumptions have not replaced it.'});continue;
  }
  const inputs=inputsFor(c,evaluation,r.currency);
  const row={kind:c.kind,version:c.version,inputs,result:null,state:'incomplete',replacesSaved:false,savedPlanPresent:saved?.action==='save'};
  if(inputs){row.result=calculateComponent(c,inputs,r.currency,{...sources,now:moment.toISOString()},review);row.state='calculated';
   if(c.kind==='equipment'){
    row.costs=r.equipmentCostLines.map((l,index)=>require('./equipmentCostCalculation').calculateLine(l,index));
    if(row.result.lines.some(l=>l.status==='conflicts_with_requirement')){row.state='blocked';result.conflicts.push('Proposed equipment does not meet a recorded job requirement.');}
    else if(row.result.lines.some(l=>l.status==='needs_information')){row.state='needs_review';result.questions.push({id:'equipment_requirements',question:'Which current equipment information confirms the job requirements?',why:'Unconfirmed specifications do not establish suitability.'});}
    if(row.costs.length!==inputs.lines.length||row.costs.some(l=>!l.complete))result.questions.push({id:'equipment_costs',question:'What job costs apply to the proposed equipment?',why:'Missing equipment cost or allocation details are not zero.'});
   }
  }
  result.components.push(row);
 }
 const missing=['materials','labor','equipment','travel','pricing'].filter(k=>!r.components.some(c=>c.kind===k));for(const kind of missing)result.questions.push({id:kind,question:'Review the '+kind+' needed for this job.',why:'No complete applicable '+kind+' recipe is recorded. A missing cost is not zero.'});
 if(result.questions.length||result.components.some(c=>c.state!=='calculated'))result.readiness='incomplete';
 if(result.conflicts.length)result.readiness='blocked';
 result.questions.push({id:'resource_readiness',question:'Confirm the work time, crew and equipment availability before scheduling.',why:'A calculated plan does not confirm availability, qualifications or a reservation.'});
 result.questions.push({id:'cost_coverage',question:'Review which costs are already included before setting the price.',why:'These component drafts have not been combined or adopted. Their costs do not replace the saved estimate or inherit its approval.'});
 if(result.readiness==='calculated')result.readiness='needs_review';
 // Component subtotals remain separate until explicit conserved coverage and
 // equipment cost basis can be resolved; never advertise their sum as complete.
 result.questions=result.questions.slice(0,12);result.primaryQuestions=result.questions.slice(0,3);
 return stableValue(result);
}
module.exports={VERSION,normalize,build,inputsFor};
