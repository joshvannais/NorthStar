'use strict';
const {fixture,id}=require('./m24-travel-input');
const source=()=>fixture().trips[0].source;
function haul(){return{lineId:id(1),label:'Measured chip output',material:'Chipped wood',homogeneous:true,volume:{applicable:true,reason:null,unit:'yd3',output:'25',retained:'0',capacity:'10',existing:'0'},mass:{applicable:true,reason:null,unit:'lb',output:'2500',retained:'0',capacity:'2000',existing:'0'},initialLoadOwner:'other_job',initialLoadNote:'Existing contents belong to earlier work; separate disposal cost.',source:source()};}
function stageInput(){return{resources:[{resourceId:id(1),label:'Declared driver',kind:'person',available:true,source:source()},{resourceId:id(2),label:'Declared onsite worker',kind:'person',available:true,source:source()}],stages:[{stageId:id(3),label:'Disposal trip',kind:'travel',duration:'60',unit:'min',dependencies:[],resourceIds:[id(1)],source:source()},{stageId:id(4),label:'Independent onsite work',kind:'onsite',duration:'45',unit:'min',dependencies:[],resourceIds:[id(2)],source:source()}]};}
module.exports={haul,stageInput,source};
