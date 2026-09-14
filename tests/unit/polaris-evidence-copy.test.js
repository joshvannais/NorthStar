'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path');
function api(){const window={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../public/js/polaris-card.js'),'utf8'),{window});return window.NorthStarPolarisCard;}
function graph(service,facts,notCalculated=[]){return {lead:{serviceType:service},polaris:{facts,snapshot:{notCalculated}}};}
const fact=(variable,normalizedValue,status='collected')=>({variable,normalizedValue,status,evidenceText:'Demo record detail collected for '+variable+'.'});
test('persisted boilerplate is replaced using actual values and explicit units, zero retained',()=>{
 const g=graph('hvac',[fact('customerDistanceMiles',0),fact('sqft',2100),fact('seer',16),fact('tonnage',3),fact('jobType','Replacement')]);const before=JSON.stringify(g),r=api().describeGraph(g);
 expect(r.evidence).toEqual(['Distance: 0 miles','Floor Area: 2100 square feet','SEER: 16','HVAC Capacity: 3 tons','Job Type: Replacement']);expect(JSON.stringify(g)).toBe(before);
});
test('unknown, invalid quantity and non-HVAC equipment facts do not invent labels/units',()=>{
 const r=api().describeGraph(graph('fencing',[fact('seer',16),fact('tonnage',3),fact('sqft',null),fact('linearFeet',{value:10}),fact('internalFoo','x')]));
 expect(r.evidence.join(' ')).not.toMatch(/SEER|tons|internalFoo|\[object/);expect(r.missing).toContain('Floor Area needs confirmation.');expect(r.missing).toContain('Additional job details need review in the customer record.');
});
test('old calculation reasons remain immutable but ordinary missingness is actionable',()=>{
 const g=graph('hvac',[],[{field:'vehicleCost',reason:'No authoritative vehicle-cost allocation input is supported in Part 3.'},{field:'fuelCost',reason:'No authoritative fuel-cost allocation input is supported in Part 3.'},{field:'actualCrewAssignment',reason:'No actual crew assignment was supplied.'},{field:'unknownThing',reason:'internalFoo snapshot'}]);const before=JSON.stringify(g),r=api().describeGraph(g);
 expect(r.missing.join(' ')).not.toMatch(/Part 3|authoritative|unknownThing|internalFoo|snapshot/);expect(r.missing.join(' ')).toMatch(/Vehicle cost needs confirmation/);expect(r.missing.join(' ')).toMatch(/Check the current schedule/);expect(JSON.stringify(g)).toBe(before);
});
test('conflicting recorded values remain explicitly unresolved',()=>{expect(api().describeGraph(graph('hvac',[fact('seer',14,'conflicting')])).evidence[0]).toBe('SEER: 14 — Needs confirmation');});
