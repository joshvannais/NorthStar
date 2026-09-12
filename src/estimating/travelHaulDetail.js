"use strict";
// Optional measured loads and explicitly sourced density. Raw facts remain immutable.
const m=require('./travelCalculation');
const BASE=['lineId','label','material','homogeneous','volume','mass','initialLoadOwner','initialLoadNote','source'];
const volumeFactor={yd3:m.rational(764554857984n,1000000000000n),m3:m.rational(1n)},massFactor={lb:m.rational(45359237n,100000000n),kg:m.rational(1n)};
function fail(message){m.fail(message,'TRAVEL_OPERATIONS_INVALID');}
function ratio(a,b){return m.rational(a.n*b.d,a.d*b.n);}
function quantity(v){return String(v/m.SCALE)+(v%m.SCALE?'.'+String(v%m.SCALE).padStart(6,'0').replace(/0+$/,''):'');}
function prepare(raw){
 const h=structuredClone(raw),detail=h.detail;delete h.detail;
 if(!m.exact(h,BASE)||!m.text(h.label,160)||!m.text(h.material,160)||typeof h.homogeneous!=='boolean'||typeof h.lineId!=='string'||!m.UUID.test(h.lineId)||!['this_job','other_job','unknown'].includes(h.initialLoadOwner)||!m.text(h.initialLoadNote,500))fail('Review the haul fields.');m.source(h.source);
 for(const k of ['volume','mass']){const d=h[k];if(!m.exact(d,['applicable','reason','unit','output','retained','capacity','existing'])||![true,false,null].includes(d.applicable)||!(k==='volume'?volumeFactor[d.unit]:massFactor[d.unit]))fail('Review the load dimensions and units.');const values=['output','retained','capacity','existing'].map(key=>m.qty(d[key]));if(d.applicable===false){if(!m.text(d.reason,500)||values.some(x=>x!==null))fail('Explain the non-applicable dimension without recorded quantities.');}else if(d.reason!==null)fail('Remove the non-applicable explanation.');}
 if(detail===undefined)return {inputs:h,detail:null,densityUnresolved:false,densityDerived:[]};
 if(!m.exact(detail,['equipmentBasis','density','orderedLoads'])||!Array.isArray(detail.orderedLoads)||detail.orderedLoads.length>12)fail('Record up to 12 independently measured loads.');
 const basis=detail.equipmentBasis;if(basis!==null&&(!m.exact(basis,['planId','revision','digest','lineId'])||![basis.planId,basis.lineId].every(v=>typeof v==='string'&&m.UUID.test(v))||!Number.isSafeInteger(basis.revision)||basis.revision<1||typeof basis.digest!=='string'||!/^[a-f0-9]{64}$/.test(basis.digest)))fail('Choose an exact saved equipment configuration.');
 let densityUnresolved=false;const densityDerived=[];
 if(detail.density!==null){const d=detail.density;if(!m.exact(d,['value','massUnit','volumeUnit','source'])||!massFactor[d.massUnit]||!volumeFactor[d.volumeUnit]||!h.homogeneous||detail.orderedLoads.length)fail('Density applies only to one homogeneous material, not a mixed load sequence.');m.source(d.source);const density=m.qty(d.value);if(density===0n)fail('Density must be greater than zero or unknown.');
 if(h.volume.applicable!==true||h.mass.applicable!==true)fail('A density conversion requires both volume and payload dimensions.');
 for(const key of ['output','retained']){const volume=m.qty(h.volume[key]);if(volume===null||density===null){densityUnresolved=true;continue;}let converted=m.rational(volume*density,m.SCALE);converted=m.multiply(converted,ratio(volumeFactor[h.volume.unit],volumeFactor[d.volumeUnit]));converted=m.multiply(converted,ratio(massFactor[d.massUnit],massFactor[h.mass.unit]));if(converted.n%converted.d!==0n){densityUnresolved=true;continue;}const value=converted.n/converted.d;if(value>999999999999999n)fail('The density conversion exceeds the supported quantity.');if(h.mass[key]!==null&&m.qty(h.mass[key])!==value)fail('Recorded mass and sourced density disagree. Review the density or measured quantity.');if(h.mass[key]===null){h.mass[key]=quantity(value);densityDerived.push(key);}}
 }
 return {inputs:h,detail,densityUnresolved,densityDerived};
}
function ordered(h,detail){
 const active=['volume','mass'].filter(k=>h[k].applicable!==false);if(!active.length)fail('Record an applicable load dimension.');
 const sums={volume:0n,mass:0n},known={volume:true,mass:true},seen=new Set(),rows=[];let complete=true;
 for(const load of detail.orderedLoads){if(!m.exact(load,['loadId','volume','mass','initialLoadOwner','initialLoadNote'])||typeof load.loadId!=='string'||!m.UUID.test(load.loadId)||seen.has(load.loadId)||!['this_job','other_job','unknown'].includes(load.initialLoadOwner)||!m.text(load.initialLoadNote,500))fail('Review each measured load and existing-content responsibility.');seen.add(load.loadId);if(load.initialLoadOwner==='unknown')complete=false;let hasQuantity=false,rowKnown=true;
 const row={loadId:load.loadId};for(const k of ['volume','mass']){const d=load[k];if(!m.exact(d,['quantity','capacity','existing']))fail('Record the measured amount, capacity and existing contents for each load.');const q=m.qty(d.quantity),capacity=m.qty(d.capacity),existing=m.qty(d.existing);if(h[k].applicable===false){if([q,capacity,existing].some(x=>x!==null))fail('Remove quantities for the non-applicable dimension.');continue;}if(h[k].applicable!==true||[q,capacity,existing].some(x=>x===null)){complete=false;rowKnown=false;known[k]=false;continue;}if(capacity===0n||existing>capacity||q>capacity-existing)fail('A measured load exceeds its recorded remaining capacity.');if(q>0n)hasQuantity=true;sums[k]+=q;row[k]={unit:h[k].unit,quantity:m.fraction(m.rational(q,m.SCALE)),remainingCapacity:m.fraction(m.rational(capacity-existing,m.SCALE))};}
 if(rowKnown&&!hasQuantity)fail('Remove an empty measured load.');rows.push(row);
 }
 for(const k of active){const output=m.qty(h[k].output),retained=m.qty(h[k].retained);if(output===null||retained===null){complete=false;continue;}if(retained>output)fail('Retained output exceeds processed output.');if(known[k]&&sums[k]!==output-retained)fail('The measured loads do not match the new material after onsite retention.');}
 return {lineId:h.lineId,complete,additionalLoads:complete?rows.length:null,declaredLoads:rows.length,firstLoad:rows[0]||null,lastLoad:rows.at(-1)||null,measuredLoads:rows,existingDisposalIncluded:false,basis:{volume:h.volume,mass:h.mass,initialLoadOwner:h.initialLoadOwner,detail},cautions:complete?['Each measured load was checked against its own declared capacity. Existing contents and disposal costs remain separate.']:['The ordered loads still need quantities, capacities or existing-content responsibility.']};
}
module.exports={prepare,ordered};
