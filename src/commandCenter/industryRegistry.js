'use strict';
const {packs,scopeFor}=require('./industryIntelligence');
// Existing fictional definitions retain their values; intelligence review is a separate gate.
const legacy=Object.freeze([
  Object.freeze({ key: 'fence', label: 'Fence installation', estimate: 6800, jobType: 'replacement', scope: Object.freeze({ jobType: 'replace', linearFeet: 146, material: 'cedar', height: 6, gates: 2 }) }),
  Object.freeze({ key: 'roofing', label: 'Roof replacement', estimate: 14800, jobType: 'replacement', scope: Object.freeze({ jobType: 'replace', squares: 28, material: 'architectural', pitch: '6/12', stories: 2 }) }),
  Object.freeze({ key: 'hvac', label: 'HVAC service', estimate: 9600, jobType: 'replacement', scope: Object.freeze({ jobType: 'replace', systemType: 'heat pump', tonnage: 3, seer: 16, sqft: 2100 }) }),
  Object.freeze({ key: 'plumbing', label: 'Plumbing service', estimate: 2850, jobType: 'repair', scope: Object.freeze({ jobType: 'repair', fixture: 'water heater', leakSeverity: 'contained', waterShutoff: true }) }),
  Object.freeze({ key: 'electrical', label: 'Electrical service', estimate: 4250, jobType: 'upgrade', scope: Object.freeze({ jobType: 'upgrade', symptoms: 'panel capacity review', breakerBehavior: 'stable', safetyConcern: false }) }),
  Object.freeze({ key: 'concrete', label: 'Concrete installation', estimate: 11200, jobType: 'installation', scope: Object.freeze({ jobType: 'install', squareFeet: 720, finish: 'broom', existingRemoval: true, access: 'driveway access' }) }),
]);
const definitions=Object.freeze([...legacy,...Object.values(packs).map(pack=>Object.freeze({
 key:pack.id,label:pack.label,estimate:1000,jobType:'estimate visit',scope:Object.freeze(scopeFor(pack.id,'visit')),
}))]);
const coverage=Object.freeze({requiredReviewedProfiles:200,reviewedProfiles:0,availableDemoProfiles:definitions.length,
 note:'Fictional examples. Job details and costs need review; the full industry library is still being reviewed.'});
module.exports={definitions,legacy,packs,coverage};
