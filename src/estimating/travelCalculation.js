'use strict';

// Exact declared job costs. Geometry and customer charges never supply inputs.
const {stableValue}=require('../services/businessProfileAdapter');
const {exact,text,source:costSource}=require('./equipmentCostCalculation');
function source(v){if(v?.kind==='recorded_caller'){costSource({...v,kind:'company_reference'});return;}costSource(v);}
const VERSION='estimate-travel-plan-v1',SCALE=1000000n,MAX=99999999999999n;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VEHICLE_CATEGORIES=['fuel_energy','maintenance','ownership_insurance'];
function fail(message='Review the travel entries.',code='TRAVEL_PLAN_INVALID'){throw Object.assign(new Error(message),{status:400,code});}
function qty(v){if(v===null)return null;if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,8})(\.[0-9]{1,6})?$/.test(v))fail('Enter a nonnegative quantity with up to six decimal places.');const[a,b='']=v.split('.');return BigInt(a)*SCALE+BigInt(b.padEnd(6,'0'));}
function money(v){if(v===null)return null;if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,11})\.[0-9]{2}$/.test(v))fail('Enter a cost with two decimal places, or leave it unknown.');return BigInt(v.replace('.',''));}
function decimal(v){return v===null?null:String(v/100n)+'.'+String(v%100n).padStart(2,'0');}
function gcd(a,b){while(b){const t=b;b=a%b;a=t;}return a;}
function rational(n,d=1n){if(d<=0n)fail('The efficiency must be greater than zero.');const g=gcd(n,d);return{n:n/g,d:d/g};}
function add(a,b){return rational(a.n*b.d+b.n*a.d,a.d*b.d);}
function multiply(a,b){return rational(a.n*b.n,a.d*b.d);}
function round(v){return(v.n*2n+v.d)/(v.d*2n);}
function fraction(v){return{numerator:String(v.n),denominator:String(v.d)};}
function integer(v,min,max,label){if(!Number.isSafeInteger(v)||v<min||v>max)fail(label);return BigInt(v);}
function identifier(v){if(typeof v!=='string'||!UUID.test(v))fail('Each travel entry needs its own identity.');return v.toLowerCase();}
function location(v){
 if(!exact(v,['kind','label','sourceId','sourceDigest','latitude','longitude'])||!['business_location','recorded_job','declared'].includes(v.kind)||!text(v.label,500))fail('Choose or describe the operating location and job address.');
 if(v.kind==='declared'){if(v.sourceId!==null||v.sourceDigest!==null)fail('A declared location cannot claim a saved source.');}
 else if(!text(v.sourceId,160)||typeof v.sourceDigest!=='string'||!/^[a-f0-9]{64}$/.test(v.sourceDigest))fail('Refresh the saved location before choosing it.');
 if((v.latitude===null)!==(v.longitude===null))fail('Enter both coordinates or leave both unknown.');
 if(v.latitude!==null&&(!Number.isFinite(v.latitude)||v.latitude< -90||v.latitude>90||!Number.isFinite(v.longitude)||v.longitude< -180||v.longitude>180))fail('Review the location coordinates.');
}
function measurement(v,units){if(!exact(v,['value','unit','basis'])||!units.includes(v.unit)||!['estimated','reported','straight_line'].includes(v.basis))fail('Choose the measurement unit and source meaning.');return qty(v.value);}
function trip(l,index){
 if(!exact(l,['lineId','purpose','origin','destination','distance','time','returnIncluded','trips','vehicles','people','vehicle','labor','source'])||!text(l.purpose,160)||typeof l.returnIncluded!=='boolean')fail('Review the trip and what its quantities represent.');
 identifier(l.lineId);location(l.origin);location(l.destination);source(l.source);
 const distance=measurement(l.distance,['mi','km']),duration=measurement(l.time,['min','hour']);
 if(l.time.basis==='straight_line')fail('Straight-line geometry does not establish travel time.');
 const tripCount=integer(l.trips,1,1000,'Enter between 1 and 1000 trips.'),vehicles=integer(l.vehicles,1,100,'Enter between 1 and 100 vehicles.'),people=l.people===null?null:integer(l.people,0,100,'Enter the total people traveling, up to 100, or leave it unknown.');
 const legs=tripCount*(l.returnIncluded?2n:1n),vehicleLegs=legs*vehicles;
 const miles=distance===null?null:multiply(rational(distance,SCALE),l.distance.unit==='km'?rational(1000000n,1609344n):rational(1n));
 const km=distance===null?null:multiply(rational(distance,SCALE),l.distance.unit==='mi'?rational(1609344n,1000000n):rational(1n));
 const hours=duration===null?null:rational(duration,SCALE*(l.time.unit==='min'?60n:1n));
 const contributions=[],missing=[];
 function contribution(category,value,label){if(value===null)missing.push(label);else if(round(value)>MAX)fail('This trip cost is too large. Review the quantities.');contributions.push({category,exactCents:value===null?null:fraction(value),value});}
 function byDistance(rate,unit){const amount=money(rate);if(!['mi','km'].includes(unit))fail('Choose miles or kilometres for the vehicle rate.');if(amount===null||distance===null||l.distance.basis==='straight_line')return null;return multiply(unit==='mi'?miles:km,rational(amount*vehicleLegs));}
 const v=l.vehicle;
 if(v?.method==='not_applicable'){if(!exact(v,['method','reason'])||!text(v.reason,500))fail('Explain why vehicle cost does not apply.');contribution('vehicle',rational(0n),'Vehicle cost');}
 else if(v?.method==='all_in_distance'){if(!exact(v,['method','rate','unit']))fail('An all-in mileage rate cannot add another vehicle cost.');contribution('vehicle',byDistance(v.rate,v.unit),'Driving distance or vehicle rate');}
 else if(v?.method==='itemized_distance'){
  if(!exact(v,['method','rates'])||!Array.isArray(v.rates)||v.rates.length!==3)fail('Enter each vehicle category, or explicitly mark it not applicable.');const seen=new Set();
  for(const r of v.rates){if(!exact(r,['category','applicable','rate','unit','reason'])||!VEHICLE_CATEGORIES.includes(r.category)||seen.has(r.category)||typeof r.applicable!=='boolean')fail('Each vehicle category can be included only once.');seen.add(r.category);if(!r.applicable){if(r.rate!==null||!text(r.reason,500))fail('Explain the non-applicable vehicle category.');contribution(r.category,rational(0n),r.category);}else{if(r.reason!==null)fail('Remove the non-applicable explanation for a cost that applies.');contribution(r.category,byDistance(r.rate,r.unit),'Vehicle distance or category rate');}}
 }else if(v?.method==='consumption'){
  if(!exact(v,['method','unit','price','basis','quantity','efficiency','otherCosts'])||!['us_gal','l','kwh'].includes(v.unit)||!['whole_job','per_vehicle_leg','efficiency'].includes(v.basis)||!exact(v.otherCosts,['status','note'])||!['included_elsewhere','not_applicable','unknown'].includes(v.otherCosts.status)||!text(v.otherCosts.note,500))fail('State the fuel or energy basis and where other vehicle costs are covered.');
  if(v.otherCosts.status==='unknown')missing.push('Other vehicle cost coverage');
  const rate=money(v.price);let used=null;
  if(v.basis==='efficiency'){
   if(v.quantity!==null||!exact(v.efficiency,['value','unit']))fail('Choose either consumption or efficiency, not both.');const efficiency=qty(v.efficiency.value);
   const expected={us_gal:'mi_per_us_gal',l:'l_per_100km',kwh:'kwh_per_100km'}[v.unit];if(v.efficiency.unit!==expected||efficiency===0n)fail('Choose the matching efficiency unit and a value greater than zero.');
   if(efficiency!==null&&distance!==null&&l.distance.basis!=='straight_line')used=multiply(v.unit==='us_gal'?multiply(miles,rational(SCALE,efficiency)):multiply(km,rational(efficiency,SCALE*100n)),rational(vehicleLegs));
  }else{if(v.efficiency!==null)fail('A consumption amount cannot also apply an efficiency.');const q=qty(v.quantity);if(q!==null)used=rational(q*(v.basis==='whole_job'?1n:vehicleLegs),SCALE);}
  contribution('fuel_energy',used===null||rate===null?null:multiply(used,rational(rate)),'Fuel or energy quantity and price');
 }else if(v?.method==='job_charge'){
  if(!exact(v,['method','amount','scope'])||!['whole_job','per_vehicle_trip'].includes(v.scope))fail('State whether the charge covers the whole job or each vehicle trip.');const m=money(v.amount);contribution('vehicle',m===null?null:rational(m*(v.scope==='whole_job'?1n:vehicles*tripCount)),'Vehicle charge');
 }else fail('Choose how to record vehicle cost.');
 const labor=l.labor;
 if(labor?.method==='not_applicable'){if(!exact(labor,['method','reason'])||!text(labor.reason,500))fail('Explain why travel labor does not apply.');contribution('travel_labor',rational(0n),'Travel labor');}
 else{
  if(!exact(labor,['method','rate','burdenPercent'])||!['all_in','base_burden'].includes(labor.method))fail('Choose the travel labor cost basis.');const rate=money(labor.rate);let burden=0n;
  if(labor.method==='all_in'){if(labor.burdenPercent!==null)fail('An all-in labor rate cannot add another burden.');}
  else {burden=qty(labor.burdenPercent);if(burden!==null&&burden>100n*SCALE)fail('Labor burden must be between 0 and 100 percent.');}
  // People is the whole traveling group, NOT people per vehicle.
  contribution('travel_labor',hours===null||rate===null||burden===null||people===null?null:multiply(hours,rational(legs*people*rate*(100n*SCALE+burden),100n*SCALE)),'Travel time or labor cost');
 }
 const sum=contributions.reduce((s,c)=>c.value===null?s:add(s,c.value),rational(0n)),cents=round(sum);if(cents>MAX)fail('The trip cost is too large.');
 return {lineId:l.lineId,index:index+1,purpose:l.purpose,total:missing.length?null:decimal(cents),knownCostSubtotal:decimal(cents),complete:missing.length===0,missing,exactKnownCents:fraction(sum),contributions:contributions.map(({value,...c})=>c),tripLegs:Number(legs),vehicleLegs:Number(vehicleLegs),totalTravelingPeople:l.people,outsideCoverageRequired:v.method==='consumption'&&v.otherCosts.status==='included_elsewhere'};
}
function logistics(l,index,trips){
 if(!exact(l,['lineId','label','category','applicable','reason','basis','tripId','quantity','unit','rate','source'])||!text(l.label,160)||!['mobilization','loading','waiting','delivery','tolls','parking','permit','accommodation','access'].includes(l.category)||typeof l.applicable!=='boolean')fail('Review the logistics cost.');identifier(l.lineId);source(l.source);
 if(!l.applicable){if(!text(l.reason,500)||[l.tripId,l.quantity,l.unit,l.rate].some(v=>v!==null)||l.basis!=='whole_job')fail('Explain why this logistics cost does not apply.');return{lineId:l.lineId,index:index+1,category:l.category,total:'0.00',knownCostSubtotal:'0.00',complete:true,exactKnownCents:fraction(rational(0n)),missing:[]};}
 if(l.reason!==null||!['whole_job','per_trip','per_vehicle_trip'].includes(l.basis)||!['job','trip','day','hour','item'].includes(l.unit))fail('Choose the logistics quantity unit and multiplication basis.');
 const t=l.basis==='whole_job'?null:trips.find(t=>t.lineId===l.tripId);if(l.basis==='whole_job'?l.tripId!==null:!t)fail('Choose the trip covered by this logistics cost.');
 const q=qty(l.quantity),rate=money(l.rate);if(l.unit==='job'&&q!==null&&q!==SCALE)fail('A whole-job cost uses one job.');
 const multiplier=l.basis==='whole_job'?1n:BigInt(t.trips)*(l.basis==='per_vehicle_trip'?BigInt(t.vehicles):1n),value=q===null||rate===null?null:rational(q*rate*multiplier,SCALE);
 if(value&&round(value)>MAX)fail('The logistics cost is too large.');return{lineId:l.lineId,index:index+1,category:l.category,total:value?decimal(round(value)):null,knownCostSubtotal:value?decimal(round(value)):'0.00',complete:value!==null,exactKnownCents:value?fraction(value):null,missing:value?[]:['Logistics quantity or rate']};
}
function access(v){
 if(!exact(v,['lineId','label','status','start','end','appliesToJob','source'])||!text(v.label,160)||!['closed','open','unknown'].includes(v.status)||![true,false,null].includes(v.appliesToJob))fail('Review the access information.');identifier(v.lineId);source(v.source);
 for(const k of ['start','end'])if(v[k]!==null&&(typeof v[k]!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v[k])||!Number.isFinite(Date.parse(v[k]))||new Date(v[k]).toISOString()!==v[k].replace(/Z$/,v[k].includes('.')?'Z':'.000Z')))fail('Choose a valid access date and time.');
 if(v.start!==null&&v.end!==null&&Date.parse(v.end)<=Date.parse(v.start))fail('The access end time must follow its start time.');
}
function calculate(inputs,currency){
 if(!exact(inputs,['serviceKey','trips','logistics','access','hauls','loadBindings','stagePlan','assessment'])||!text(inputs.serviceKey,160)||!['USD','CAD','EUR'].includes(currency)||!Array.isArray(inputs.trips)||!Array.isArray(inputs.logistics)||!Array.isArray(inputs.access)||inputs.trips.length>12||inputs.logistics.length>12||inputs.access.length>12||inputs.trips.length+inputs.logistics.length===0)fail('Add up to 12 trips and 12 logistics costs for this job.');
 const ids=new Set();for(const l of [...inputs.trips,...inputs.logistics,...inputs.access]){const id=identifier(l.lineId);if(ids.has(id))fail('Each travel entry can appear only once.');ids.add(id);}
 const trips=inputs.trips.map(trip),costs=inputs.logistics.map((l,i)=>logistics(l,i,inputs.trips));inputs.access.forEach(access);
 const all=[...trips,...costs],sum=all.reduce((n,l)=>n+money(l.knownCostSubtotal),0n);if(sum>MAX)fail('The travel total is too large. Review the quantities.');const operational=require('./travelOperations'),hauling=operational.bindLoads(inputs.hauls,inputs.loadBindings,inputs.trips),stagePlan=inputs.stagePlan===null?null:operational.stages(inputs.stagePlan);const complete=all.every(l=>l.complete)&&hauling.complete;
 return stableValue({contract:VERSION,currency,trips,logistics:costs,hauling,stagePlan,total:complete?decimal(sum):null,knownCostSubtotal:decimal(sum),complete,outsideCoverageRequired:trips.filter(t=>t.outsideCoverageRequired).map(t=>t.lineId),rounding:'Each trip and logistics cost is rounded to cents before adding. People are the whole traveling group; whole-job charges and consumption are counted once.'});
}
module.exports={VERSION,MAX,SCALE,UUID,VEHICLE_CATEGORIES,calculate,trip,logistics,location,qty,money,decimal,rational,add,multiply,round,fraction,exact,text,source,fail};
