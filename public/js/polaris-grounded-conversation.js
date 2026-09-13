(function(){
 'use strict';
 var VERSION='northstar.polaris.grounded-conversation.v2';
 function validate(data,request){
  if(!data||data.schemaVersion!==VERSION||data.requestId!==request.idempotencyKey||JSON.stringify(data.selected)!==JSON.stringify(request.selected)||data.advisoryOnly!==true||data.canonicalMutationAllowed!==false||!Array.isArray(data.questions)||!Array.isArray(data.explanations)||!Array.isArray(data.proposals)||!Array.isArray(data.evidence)||!Array.isArray(data.trustedFacts)||data.questions.length>4||data.explanations.length>4||data.proposals.length>4)throw new Error('Response could not be confirmed.');
  var ids=new Set(data.evidence.map(function(e){return e.id;}));
  data.questions.concat(data.explanations).forEach(function(item){if(!item||typeof item.text!=='string'||item.text.length>800||!Array.isArray(item.evidenceIds)||item.evidenceIds.some(function(id){return !ids.has(id);}))throw new Error('Response sources changed.');});
  if(['none','capella','estimate_review'].indexOf(data.requestedCard)<0)throw new Error('Review unavailable.');
  return data;
 }
 function render(root,data,isCurrent){
  function el(tag,text,parent){var n=document.createElement(tag);if(text)n.textContent=text;(parent||root).appendChild(n);return n;}
  el('p','AI Explanation — Review Against Recorded Details');
  if(data.questions.length){el('h4','Questions To Clarify');var list=el('ul');data.questions.forEach(function(q){el('li',q.text,list);});}
  if(data.explanations.length){el('h4','What The Recorded Details Support');var list=el('ul');data.explanations.forEach(function(q){el('li',q.text,list);});}
  if(!data.questions.length&&!data.explanations.length)el('p','Review the selected job details to continue.');
  if(data.trustedFacts.length){var d=el('details');el('summary','Recorded Figures',d);data.trustedFacts.forEach(function(f){el('p',f.label+': '+(f.value===null||f.value===undefined?'Not Recorded':String(f.value)+(f.unit?' '+f.unit:'')),d);});}
  var used=new Set();data.questions.concat(data.explanations).forEach(function(q){q.evidenceIds.forEach(function(id){used.add(id);});});
  if(used.size){var d=el('details');el('summary','Sources Used',d);var list=el('ul',null,d);data.evidence.filter(function(e){return used.has(e.id);}).forEach(function(e){el('li',e.label||'Recorded Job Detail',list);});}
  function action(label,editor,proposal){var b=el('button',label);b.type='button';b.className='btn btn-secondary';b.style.margin='0 .75rem .75rem 0';b.onclick=function(){if(!isCurrent()){el('p','The selected record changed. Ask again using its current details.');return;}if(!window.CustomerDetail||!data.reviewTarget){el('p','Open the customer and review its current estimate.');return;}window.CustomerDetail.open(data.reviewTarget.customerId,{groundedReview:{target:data.reviewTarget,editor:editor,proposal:proposal||null}});};}
  if(data.requestedCard!=='none')action(data.requestedCard==='capella'?'Open CAPELLA':'Open Estimate Review',data.requestedCard);
  data.proposals.forEach(function(p){if(p.change){el('p','Proposed '+p.change.unit+': '+p.change.previous+' → '+p.change.value+'. '+p.consequence);}if(['material','labor','equipment','travel'].indexOf(p.editor)>=0)action(p.label,p.editor,p);});
  el('p','Review changes in the plan editor. Nothing here saves, approves or sends a price.');
 }
 window.NorthStarGroundedConversation={validate:validate,render:render};
})();
