'use strict';
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../../public/js/customer-detail.js'),'utf8');
const start=source.indexOf('  function workPresentation(data)'),end=source.indexOf('  function renderJobDescription(data)',start);
const context={presentationFormat:()=>({isInternalKey:()=>false,label:key=>key}),describe:value=>String(value),displayDescription:value=>String(value),fmtCurrency:value=>String(value),gateSummary:()=>[]};
vm.createContext(context);vm.runInContext(source.slice(start,end),context);
const data=(key,scope,label)=>({intelligence:{service:{key,label:label||key,scope}}});
test('HVAC uses recorded square-foot area, SEER and cooling tons, with no price/unit conversion',()=>{
 const input=data('hvac',{systemType:'heat pump',seer:16,sqft:2100,tonnage:3},'HVAC service');const before=JSON.stringify(input),result=context.workPresentation(input).description;
 expect(result).toContain('SEER: 16');expect(result).toContain('Area: 2100 square feet');expect(result).toContain('Cooling capacity: 3 tons');expect(context.jobDescription(input)).toBe('HVAC service involving a heat pump system. Recorded area: 2100 square feet.');expect(JSON.stringify(input)).toBe(before);
});
test('zero is preserved, absent measurements are not invented, and legacy height/other tonnage gains no guessed unit',()=>{
 expect(context.workPresentation(data('hvac',{sqft:0,tonnage:0})).description).toEqual(['Area: 0 square feet','Cooling capacity: 0 tons']);
 expect(context.workPresentation(data('fence',{height:6,tonnage:3})).description).toEqual(['height: 6','tonnage: 3']);
 expect(context.jobDescription(data('hvac',{},'HVAC service'))).not.toMatch(/tons|square feet/);
});
test('source prose is retained verbatim while structured facts do not duplicate it',()=>{
 const prose='Replace the damaged gate. Keep the garden clear and confirm the owner’s requested access.';
 const input=data('fence',{description:prose,material:'cedar'},'Fence installation');expect(context.jobDescription(input)).toBe(prose);expect(context.workPresentation(input).description).toEqual(['material: cedar']);
});
test('concrete summary uses only the recorded finish and area',()=>{
 const input=data('concrete',{finish:'broom',squareFeet:720},'Concrete installation');expect(context.jobDescription(input)).toBe('Concrete installation with a broom finish. Recorded area: 720 square feet.');
});
