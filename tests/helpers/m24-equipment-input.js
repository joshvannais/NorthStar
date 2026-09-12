'use strict';
const crypto=require('node:crypto');
const {IDENTITY}=require('../../src/estimating/equipmentPlanContract');
function line(overrides={}){return {lineId:crypto.randomUUID(),task:'Install fence posts',assetId:null,identity:Object.fromEntries(IDENTITY.map(k=>[k,null])),accessBasis:'unknown',requirements:[],knowledgePins:[],ownerReview:'Configuration needs review.',...overrides};}
function inputs(lines=[line()]){return {serviceKey:'fence',lines,assessment:null};}
function requirementsPlan(count){const requirement=()=>({requirementId:crypto.randomUUID(),label:'Recorded Diameter',kind:'numeric',operator:'at_least',value:'150',unit:'mm',origin:'owner_entry',scopeKey:null,specificationIndex:null});return inputs([line({requirements:Array.from({length:6},requirement)}),line({requirements:Array.from({length:count-6},requirement)})]);}
module.exports={line,inputs,requirementsPlan};
