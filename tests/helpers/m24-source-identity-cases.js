'use strict';
const whitespace=[0x20,0xa0,0x1680,...Array.from({length:11},(_,i)=>0x2000+i),0x2028,0x2029,0x202f,0x205f,0x3000,0xfeff];
const cases=whitespace.map(cp=>({name:'edge U+'+cp.toString(16),equivalent:true,change:e=>{for(const k of ['issuer','reference','materialSpecification'])e[k]=String.fromCodePoint(cp)+e[k]+String.fromCodePoint(cp);}}));
for(const field of ['issuer','reference','materialSpecification']){
 cases.push({name:field+' outer spaces',equivalent:true,change:e=>e[field]=' '+e[field]+' '});
 cases.push({name:field+' different case',equivalent:false,change:e=>e[field]=e[field].toUpperCase()});
 cases.push({name:field+' distinct suffix',equivalent:false,change:e=>e[field]+=' Other'});
 cases.push({name:field+' zero width space retained',equivalent:false,change:e=>e[field]='\u200b'+e[field]});
}
cases.push({name:'different internal spaces',equivalent:false,change:e=>e.materialSpecification='cedar  boards'});
cases.push({name:'null specification remains distinct',equivalent:false,change:e=>e.materialSpecification=null});
cases.push({name:'different effective date',equivalent:false,change:e=>e.effectiveOn='2026-09-02'});
function inputsFor(partition){const a={lineId:'00000000-0000-4000-8000-000000000051',material:'Boards',quantity:'1',unit:'ft',wastePercent:'0',unitPrice:'3.25',sourceType:'entered_price',sourceNote:'Recorded test source',priceDate:'2026-09-01',evidence:{kind:'supplier_quote',issuer:'Acme Supply',reference:'Quote q-7',effectiveOn:'2026-09-01',validThrough:null,countryCode:null,region:null,locality:null,serviceKey:'fence',materialSpecification:'cedar boards',statedUnit:'ft',statedCurrency:'USD',statedUnitPrice:'3.25',appliesToReviewedJob:true,exceptionReason:null}};const b=structuredClone(a);b.lineId='00000000-0000-4000-8000-000000000052';b.unitPrice='4.00';b.evidence.statedUnitPrice='4.00';partition.change(b.evidence);return{lines:[a,b],sourceAssessment:null};}
module.exports={cases,inputsFor};
