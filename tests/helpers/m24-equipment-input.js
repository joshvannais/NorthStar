'use strict';
const crypto=require('node:crypto');
const {IDENTITY}=require('../../src/estimating/equipmentPlanContract');
function line(overrides={}){return {lineId:crypto.randomUUID(),task:'Install fence posts',assetId:null,identity:Object.fromEntries(IDENTITY.map(k=>[k,null])),accessBasis:'unknown',requirements:[],knowledgePins:[],ownerReview:'Configuration needs review.',...overrides};}
function inputs(lines=[line()]){return {serviceKey:'fence',lines,assessment:null};}
module.exports={line,inputs};
