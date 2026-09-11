'use strict';
// Authored, nonfinancial demo dialogue. Only supplied scenario facts may be spoken.
// This is not a provider call, retrieval engine, price calculator or saved-history rewrite.
const services = require('../routes/simulation/scenario-catalog');
const known = value => value !== undefined && value !== null && value !== '';
const words = value => String(value).replace(/_/g, ' ');
const sentence = value => { const s=words(value).trim(); return s ? s.charAt(0).toUpperCase()+s.slice(1).replace(/[.!?]+$/, '')+'.' : "I'm not sure."; };
function answer(key,value,scope,service) {
 if(!known(value)) return "I'm not sure about that yet.";
 const jobs={install:'A new installation',replace:'A replacement',repair:'A repair',inspect:'An inspection',maintain:'I need someone to maintain the system',upgrade:'An upgrade'};
 switch(key){
 case 'jobType':return (jobs[value]||'I need someone to assess the work')+'.';
 case 'material':return service==='roofing'&&value==='architectural'?'Architectural shingles.':sentence(value);
 case 'linearFeet':case 'height':return 'About '+value+' feet.';
 case 'squares':return 'About '+value+' roofing squares.';
 case 'squareFeet':case 'sqft':return 'About '+value+' square feet.';
 case 'tonnage':return 'I believe it is '+value+' tons.';
 case 'seer':return 'I am considering SEER '+value+'.';
 case 'existingAge':return 'About '+value+' years old.';
 case 'stories':return value+' '+(Number(value)===1?'story.':'stories.');
 case 'existingLayers':return value+' existing '+(Number(value)===1?'layer.':'layers.');
 case 'gates':return Array.isArray(value)?(value.length?value.map(g=>known(g.type)?words(g.type)+' gate':'gate').join(' and ')+'.':'No gates.'):"I'm not sure how many gates yet.";
 case 'removalRequired':return value?'Yes, there is an old fence that needs to come down.':'No existing fence needs removal.';
 case 'existingRemoval':return value?'Yes, the existing concrete needs removal.':'No existing concrete needs removal.';
 case 'flashingReplace':return value?'I believe the flashing needs replacement.':'I do not think the flashing needs replacement, but please check it.';
 case 'ductworkReplace':return value?'I believe the ductwork needs replacement.':'I do not think the ductwork needs replacement, but please check it.';
 case 'permitsRequired':return value?'I understand a permit is required.':'I do not believe a permit is required, but please verify that.';
 case 'waterShutoff':return value?'Yes, the water has been shut off.':'No, the water has not been shut off.';
 case 'safetyConcern':return value?'Yes, I have a current safety concern.':'No current safety concern.';
 case 'finish':return value==='broom'?'A broom finish.':sentence(value);
 default:return typeof value==='string'||typeof value==='number'?sentence(value):"I'm not sure about that yet.";
 }
}
function demoConversation({serviceKey,scope={},customer={},businessProfile=null,selectionProfile=null}) {
 const service=services[serviceKey];if(!service)throw new Error('Unsupported demo conversation service');
 const turns=[];const say=(speaker,text)=>turns.push({speaker,text});const exchange=(question,response)=>{say('ai',question);say('customer',response);};
 say('ai','Thank you for calling. I’m the virtual receptionist. What can I help you with?');
 const subject={fence:'a fence',roofing:'my roof',hvac:'my heating or cooling system',plumbing:'a plumbing issue',electrical:'some electrical work',concrete:'a concrete project'}[serviceKey];
 say('customer','I would like help with '+subject+'.');
 const listed=businessProfile&&Array.isArray(businessProfile.services)&&businessProfile.services.find(item=>item.key===serviceKey);
 say('ai',listed?'Our services include '+String(listed.label).replace(/^[A-Z](?=[a-z])/, c=>c.toLowerCase())+'. Let me take a few details for the team.':'Let me take a few details so the team can confirm how they can help.');
 for(const q of [...service.questions.discovery,...service.questions.scope]) exchange(q.ask,answer(q.id,scope[q.id],scope,serviceKey));
 if(selectionProfile){exchange('What would you like the team to help you decide?',selectionProfile.intent.material.customerLine);exchange('How soon do you need help?',selectionProfile.urgency.material.customerLine);exchange('Is there anything we should know about access or the property?',selectionProfile.context.material.customerLine);}
 if(scope.safetyConcern===true||(selectionProfile&&selectionProfile.urgency.material.emergency===true))say('ai','If there is immediate danger, please keep clear and contact emergency services. I can note the concern for the team, but I cannot confirm an emergency response time.');
 if(known(customer.address))exchange('What is the address for the work?',String(customer.address));
 if(known(customer.phone))exchange('What is the best number for a follow-up?',String(customer.phone));
 if(known(customer.email))exchange('Where would you like to receive the estimate?',String(customer.email));
 exchange('What timing works best for you?',selectionProfile?selectionProfile.scheduling.material.customerLine:known(scope.schedulingConstraint)?sentence(scope.schedulingConstraint):known(scope.timeline)?sentence(scope.timeline):'Please call me to work out a time.');
 say('customer','Can you tell me what it will cost?');
 say('ai','The team needs to check the details before giving you a price. They can review the measurements, materials and access with you first.');
 if(selectionProfile)exchange('What would you like to do next?',selectionProfile.outcome.material.customerLine);
 else say('customer','Please have someone follow up with me.');
 say('ai','Thank you. The team will need to confirm the scope and any appointment with you before the work goes ahead.');
 return turns;
}
module.exports={demoConversation};
