'use strict';

// A recipe is data from an authorized source, never executable code. Keep this
// interpreter independent of profiles, HTTP and storage so both adapters share it.
const {stableValue,sha256}=require('../services/businessProfileAdapter');
const VERSION='estimate-proposal-recipe-v1';
const DIMENSIONS=new Set(['1','ft','ft2','ft3','m','m2','m3','yd3','ea','kg','lb','hour','worker_hour','mile','USD','CAD','EUR']);
const ID=/^[a-z][a-zA-Z0-9_]{0,63}$/;
function fail(message='Review the company estimate recipe.',status=400){throw Object.assign(new Error(message),{status,code:'PROPOSAL_RECIPE_INVALID'});}
function exact(v,keys){return v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));}
function text(v,n=160){return typeof v==='string'&&v.trim().length>0&&v.length<=n&&!/[\u0000-\u001f\u007f-\u009f]/.test(v);}
function unit(v){if(typeof v!=='string'||v.length>80)fail();const parts=v.split('/');if(parts.length>2||parts.some(p=>!DIMENSIONS.has(p)))fail('Use an explicit supported quantity or rate unit.');return v;}
function dims(v){const[a,b]=unit(v).split('/');const d={};if(a!=='1')d[a]=1;if(b&&b!=='1')d[b]=(d[b]||0)-1;return d;}
function dimensionKey(v){return JSON.stringify(Object.entries(v).filter(([,n])=>n).sort(([a],[b])=>a.localeCompare(b)));}
function sameUnit(a,b){return dimensionKey(dims(a))===dimensionKey(dims(b));}
function gcd(a,b){while(b){[a,b]=[b,a%b];}return a;}
function rational(n,d=1n){if(d===0n)fail('A recipe divisor must be greater than zero.');const g=gcd(n,d);n/=g;d/=g;if(n.toString().length>90||d.toString().length>90)fail('The recipe calculation is too large.');return{n,d};}
function number(v){if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$/.test(v))fail('Use a nonnegative quantity with up to six decimal places.');const[a,b='']=v.split('.');return rational(BigInt(a+b),10n**BigInt(b.length));}
function decimal(v){let d=v.d,two=0,five=0;while(d%2n===0n){d/=2n;two++;}while(d%5n===0n){d/=5n;five++;}const places=Math.max(two,five);if(d!==1n||places>6)return null;const n=v.n*10n**BigInt(places)/v.d;const s=n.toString().padStart(places+1,'0');return places?s.slice(0,-places)+'.'+s.slice(-places):s;}
function date(v){return typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;}
function normalize(recipe){
 if(!exact(recipe,['version','id','serviceKey','currency','geography','effectiveOn','reviewBy','fields','steps','components','equipmentCostLines','applicability'])||recipe.version!==VERSION||!ID.test(recipe.id)||!text(recipe.serviceKey)||!['USD','CAD','EUR'].includes(recipe.currency)||!text(recipe.geography)||!date(recipe.effectiveOn)||!date(recipe.reviewBy)||recipe.reviewBy<recipe.effectiveOn)fail();
 if(!Array.isArray(recipe.applicability)||recipe.applicability.length>12)fail();
 const applicabilityIds=new Set();for(const rule of recipe.applicability){if(!exact(rule,['fieldId','value','question'])||!ID.test(rule.fieldId)||applicabilityIds.has(rule.fieldId)||!['string','boolean'].includes(typeof rule.value)||typeof rule.value==='string'&&!text(rule.value,160)||!text(rule.question,300))fail('Review the recipe applicability rules.');applicabilityIds.add(rule.fieldId);}
 if(!Array.isArray(recipe.fields)||recipe.fields.length>24||!Array.isArray(recipe.steps)||recipe.steps.length>12||!Array.isArray(recipe.components)||recipe.components.length>5)fail('This recipe exceeds the supported draft limits.');
 const ids=new Set();
 for(const f of recipe.fields){if(!exact(f,['id','label','type','unit','allowedValues','question','why'])||!ID.test(f.id)||ids.has(f.id)||!text(f.label)||!text(f.question,300)||!text(f.why,300)||!['quantity','category'].includes(f.type))fail();if(f.type==='quantity'){unit(f.unit);if(f.allowedValues!==null)fail();}else if(f.unit!=='category'||!Array.isArray(f.allowedValues)||!f.allowedValues.length||f.allowedValues.length>12||f.allowedValues.some(v=>!text(v,160))||new Set(f.allowedValues).size!==f.allowedValues.length)fail();ids.add(f.id);}
 const fieldIds=new Set(ids);ids.clear();
 for(const s of recipe.steps){
  if(!exact(s,['id','op','unit','args','fieldId','value'])||!ID.test(s.id)||ids.has(s.id)||!['input','constant','sum','product','ratio','ceil'].includes(s.op)||!Array.isArray(s.args)||s.args.length>12)fail();unit(s.unit);
  if(s.op==='input'){if(!fieldIds.has(s.fieldId)||recipe.fields.find(f=>f.id===s.fieldId).type!=='quantity'||s.value!==null||s.args.length||!sameUnit(s.unit,recipe.fields.find(f=>f.id===s.fieldId).unit))fail();}
  else if(s.op==='constant'){if(s.fieldId!==null||s.args.length)fail();number(s.value);}
  else {if(s.fieldId!==null||s.value!==null||s.args.some(id=>!ids.has(id))||(['ratio','product'].includes(s.op)?s.args.length!==2:s.op==='ceil'?s.args.length!==1:s.args.length<1))fail('Recipe steps must refer only to earlier named steps.');}
  ids.add(s.id);
 }
 const kinds=new Set();let lines=0;
 for(const c of recipe.components){if(!exact(c,['kind','version','inputs','bindings'])||!['materials','labor','equipment','travel','pricing'].includes(c.kind)||kinds.has(c.kind)||!text(c.version)||!c.inputs||typeof c.inputs!=='object'||Array.isArray(c.inputs)||!Array.isArray(c.bindings)||c.bindings.length>64)fail();if(c.kind!=='materials'&&c.inputs.serviceKey!==recipe.serviceKey)fail('Every component must apply to the same job service.');kinds.add(c.kind);lines+=Array.isArray(c.inputs.lines)?c.inputs.lines.length:1;
  for(const b of c.bindings){if(!exact(b,['line','field','step'])||!(b.line===null||Number.isInteger(b.line)&&b.line>=0&&b.line<20)||typeof b.field!=='string'||!/^[a-z][a-zA-Z0-9]{0,63}$/.test(b.field)||!ids.has(b.step))fail();}
 }
 if(lines>64||Buffer.byteLength(JSON.stringify(recipe))>65536)fail('This recipe exceeds the supported draft limits.');
 if(!Array.isArray(recipe.equipmentCostLines)||recipe.equipmentCostLines.length>12)fail();
 const equipment=recipe.components.find(c=>c.kind==='equipment'),costIds=new Set();for(const line of recipe.equipmentCostLines){if(costIds.has(line.lineId)||!equipment?.inputs.lines?.some(e=>e.lineId===line.lineId))fail('Each equipment cost must refer to one proposed equipment item.');costIds.add(line.lineId);require('./equipmentCostCalculation').calculateLine(line,costIds.size-1);}
 return stableValue(recipe);
}
function evaluate(raw,facts,now=new Date()){
 const recipe=normalize(raw),day=now.toISOString().slice(0,10),questions=[],values={},provenance=[];
 const stale=day<recipe.effectiveOn||day>recipe.reviewBy;
 for(const f of recipe.fields){const fact=facts[f.id];if(!fact||fact.value===null)continue;if(!exact(fact,['value','unit','source'])||!text(fact.source,300))fail();if(f.type==='category'){if(fact.unit!=='category'||!f.allowedValues.includes(fact.value))fail('Choose an explicitly supported recipe option.');}else{if(!sameUnit(fact.unit,f.unit))fail('A recorded quantity does not match the recipe unit.');number(fact.value);}}
 for(const s of recipe.steps){let value=null;
  if(s.op==='input'){const f=recipe.fields.find(f=>f.id===s.fieldId),fact=facts[f.id];if(!fact||fact.value===null){if(!questions.some(q=>q.id===f.id))questions.push({id:f.id,question:f.question,why:f.why});}else{if(!exact(fact,['value','unit','source'])||!sameUnit(fact.unit,f.unit)||!text(fact.source,300))fail('A recorded quantity does not match the recipe unit.');value=number(fact.value);provenance.push({fieldId:f.id,...fact});}}
  else if(s.op==='constant')value=number(s.value);
  else{const inputs=s.args.map(id=>values[id]),sourceUnits=s.args.map(id=>recipe.steps.find(x=>x.id===id).unit);const actual=dims(sourceUnits[0]);
   if(s.op==='sum'||s.op==='ceil'){if(sourceUnits.some(u=>!sameUnit(u,s.unit)))fail('The recipe combines incompatible units.');}
   else{for(const[k,n]of Object.entries(dims(sourceUnits[1])))actual[k]=(actual[k]||0)+(s.op==='ratio'?-n:n);if(dimensionKey(actual)!==dimensionKey(dims(s.unit)))fail('The recipe result has an incompatible unit.');}
   if(inputs.every(Boolean)){if(s.op==='sum')value=inputs.reduce((a,b)=>rational(a.n*b.d+b.n*a.d,a.d*b.d));else if(s.op==='product')value=rational(inputs[0].n*inputs[1].n,inputs[0].d*inputs[1].d);else if(s.op==='ratio')value=rational(inputs[0].n*inputs[1].d,inputs[0].d*inputs[1].n);else value=rational((inputs[0].n+inputs[0].d-1n)/inputs[0].d);}
  }
  values[s.id]=value;
 }
 if(stale)questions.unshift({id:'recipe_date',question:'Review the company recipe dates.',why:'This recipe is not current for today.'});
 return{recipe,values:Object.fromEntries(Object.entries(values).map(([id,v])=>[id,v?{numerator:String(v.n),denominator:String(v.d),decimal:decimal(v),unit:recipe.steps.find(s=>s.id===id).unit}:null])),provenance,questions:questions.slice(0,12),state:stale?'needs_review':questions.length?'incomplete':'calculated',recipeDigest:sha256(recipe)};
}
module.exports={VERSION,normalize,evaluate,sameUnit};
