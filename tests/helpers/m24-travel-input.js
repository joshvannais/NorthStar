'use strict';
const id=n=>'11111111-1111-4111-8111-'+String(n).padStart(12,'0');
const evidence=()=>({kind:'my_estimate',issuer:'',reference:'',note:'Declared practice basis',effectiveOn:null,endsOn:null,geography:''});
const location=label=>({kind:'declared',label,sourceId:null,sourceDigest:null,latitude:null,longitude:null});
function fixture(){return{serviceKey:'fence',trips:[{lineId:id(1),purpose:'Job travel',origin:location('Operating office'),destination:location('Recorded practice job'),distance:{value:'10',unit:'mi',basis:'estimated'},time:{value:'20',unit:'min',basis:'estimated'},returnIncluded:true,trips:2,vehicles:1,people:2,vehicle:{method:'all_in_distance',rate:'0.60',unit:'mi'},labor:{method:'all_in',rate:'30.00',burdenPercent:null},source:evidence()}],logistics:[{lineId:id(2),label:'Parking',category:'parking',applicable:true,reason:null,basis:'whole_job',tripId:null,quantity:'1',unit:'job',rate:'5.00',source:evidence()}],access:[],hauls:[],loadBindings:[],stagePlan:null,assessment:null};}
module.exports={fixture,evidence,location,id};
