'use strict';
const crypto=require('node:crypto');
function source(){return{kind:'my_estimate',reference:'',note:'Task-specific estimate',effectiveOn:null,endsOn:null,geography:''};}
function line(overrides={}){return{lineId:crypto.randomUUID(),task:'Install Fence',basis:'people_time',workerHours:null,people:2,elapsedHours:'8',quantity:null,unit:null,hoursPerUnit:null,rateMode:'base_burden',hourlyCost:'50.00',burdenPercent:'20',quantitySource:source(),rateSource:source(),...overrides};}
function inputs(lines=[line()]){return{serviceKey:'fence',lines,assessment:null};}
module.exports={line,inputs,source};
