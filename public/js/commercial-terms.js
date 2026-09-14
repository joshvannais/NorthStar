(function () {
  'use strict';
  var draft = null, serial = 0;
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function reset() { draft = null; serial++; }
  function render(review, parent, options) {
    var old = parent.querySelector('#cdCommercialTerms'), wasOpen = old && old.open;
    if (old) old.remove();
    var root = document.createElement('details'); root.id = 'cdCommercialTerms'; root.className = 'drawer-labor-plan'; root.open = !!wasOpen; parent.appendChild(root);
    function el(tag, text, target) { var n = document.createElement(tag); if (text) n.textContent = text; (target || root).appendChild(n); return n; }
    el('summary', 'Commercial Terms');
    var plans = review.commercialTerms;
    if (!plans || ['estimate-commercial-terms-v1','estimate-commercial-terms-v2'].indexOf(plans.contract)<0 || plans.simulated !== review.simulated) { el('p', 'Commercial terms are unavailable. Refresh this estimate.'); return; }
    function resultView(r, target) {
      if (!r) return;
      [['Price Before Tax', r.netBeforeTax], ['Tax', r.tax], ['Total Payable', r.total]].forEach(function (pair) { var row = el('div', null, target); row.className = 'drawer-pricing-item'; el('span', pair[0], row); el('span', options.money(pair[1], review.currency), row); });
      if (!r.complete) el('p', 'Some charges or tax treatment are still unknown. You can save these entries and complete them later.', target);
      if (r.taxAuthority === 'owner_recorded') el('p', 'Tax treatment was recorded by your company. NorthStar has not validated it.', target);
      var detail = el('details', null, target); el('summary', 'Charge And Payment Details', detail);
      (r.lines || []).forEach(function (line) { el('p', line.label + ': ' + options.money(line.adjustedAmount, review.currency), detail); });
      (r.adjustments || []).forEach(function (a) { el('p', a.label + ': ' + options.money(a.amount, review.currency) + '. ' + a.reason, detail); });
      (r.taxGroups || []).forEach(function (g) { el('p', g.label + ' — Tax: ' + options.money(g.tax, review.currency), detail); });
      (r.payments || []).forEach(function (s) { el('p', (s.label || 'Payment') + ': ' + options.money(s.amount, review.currency), detail); });
    }
    function savedFacts(inputs,target){if(!inputs)return;var d=el('details',null,target);el('summary','Recorded Job And Source Details',d);var f=inputs.jobApplicability;if(f){[['Service Operation','serviceOperation'],['Property Use','propertyUse'],['Work Context','workContext'],['Customer Exemption','customerExemption']].forEach(function(pair){var value=f[pair[1]],display=!value||value==='unknown'?'Not Yet Recorded':value.replace(/_/g,' ');el('p',pair[0]+': '+display,d);if(f.evidenceRef[pair[1]])el('p','Source: '+f.evidenceRef[pair[1]],d);});}else el('p','Job-specific applicability was not recorded with these earlier terms. Review it when revising.',d);(inputs.taxGroups||[]).forEach(function(g){var source=g.source;el('p',g.label,d);if(inputs.version==='estimate-commercial-terms-v2'){[['Legal Start','legalEffectiveOn'],['Known Legal End','legalEndsOn'],['Source Reviewed','reviewedOn'],['Review Valid Through','reviewValidThrough']].forEach(function(pair){el('p',pair[0]+': '+(source[pair[1]]||'Not Recorded'),d);});}else el('p','Earlier Source Period: '+(source.effectiveOn||'Not Recorded')+' � '+(source.endsOn||'End Not Recorded'),d);});}
    if (plans.simulated) el('p', 'Simulated Commercial Review — No Customer Document Or Payment Is Sent.');
    if (plans.current) { el('p', plans.current.action === 'withdraw' ? 'These terms were withdrawn. Saved history remains available.' : plans.binding ? 'The current scope, price and commercial terms were approved together.' : plans.current.current ? 'Saved terms are a proposal until you approve the full review.' : 'Earlier terms — review current pricing and sources before approving.'); resultView(plans.current.result, root); savedFacts(plans.current.inputs,root); }
    else el('p', 'Review discounts, fees, tax treatment and payment stages from the saved pricing proposal.');
    if (plans.history.length) { var history = el('details'); el('summary', 'Commercial History', history); plans.history.forEach(function (p) { var d = el('details', null, history); el('summary', (p.action === 'withdraw' ? 'Withdrawn Terms' : 'Saved Terms') + ' — ' + (p.actorName || 'Company Reviewer'), d); el('p', p.reason, d); resultView(p.result, d); savedFacts(p.inputs,d); }); }
    function button(label, fn, target, id) { var b = el('button', label, target); b.type = 'button'; b.className = 'btn btn-secondary'; b.onclick = fn; if (id) b.id = id; return b; }
    if (!plans.canMutate) { el('p', plans.mutationsPaused ? 'New commercial terms and approvals are paused. Refresh to check saved history.' : 'Select the current estimate with an authorized account to review these terms.'); return; }
    var basis = JSON.stringify([review.pins, plans.decisionBasis, plans.current && plans.current.digest, plans.sources.digest]);
    if (draft && draft.basis !== basis) { draft.result = null; draft.request = null; draft.confirmed = false; draft.basis = basis; draft.changed = true; }
    function source() { return {kind:'unknown',note:'',reference:'',legalEffectiveOn:null,legalEndsOn:null,reviewedOn:null,reviewValidThrough:null,jurisdiction:'',location:'',serviceKey:plans.sources.serviceKey,collectionBasis:'',acknowledged:false,ruleId:null,ruleDigest:null}; }
    function taxGroup(lines) { return {groupId:crypto.randomUUID(),label:'Tax Treatment',lineIds:lines,behavior:'exclusive',treatment:'unknown',ratePercent:null,source:source()}; }
    var charges = (plans.sources.pricing && plans.sources.pricing.result.lines || []).filter(function (l) { return !l.includedIn; });
    function empty() { return {version:'estimate-commercial-terms-v2',jobApplicability:{serviceOperation:null,propertyUse:'unknown',workContext:'unknown',customerExemption:'unknown',evidenceRef:{serviceOperation:'',propertyUse:'',workContext:'',customerExemption:''}},transactionDate:null,adjustments:[],fees:[],taxGroups:charges.length ? [taxGroup(charges.map(function (l) { return l.lineId; }))] : [],payments:{mode:'none',balanceId:null,stages:[]}}; }
    function rerender(id) { var open = {}; root.querySelectorAll('details[data-commercial-section]').forEach(function (d) { open[d.dataset.commercialSection] = d.open; }); render(review,parent,options); var mounted=parent.querySelector('#cdCommercialTerms'); mounted.open=true; mounted.querySelectorAll('details[data-commercial-section]').forEach(function(d){if(Object.prototype.hasOwnProperty.call(open,d.dataset.commercialSection))d.open=open[d.dataset.commercialSection];}); var n=id&&document.getElementById(id); if(n){var ancestor=n.parentElement;while(ancestor&&mounted.contains(ancestor)){if(ancestor.tagName==='DETAILS')ancestor.open=true;ancestor=ancestor.parentElement;}n.focus();} }
    function start(action) { draft={action:action,basis:basis,inputs:plans.current&&plans.current.action==='save'&&plans.current.inputs?clone(plans.current.inputs):empty(),reason:'',scopeSummary:'',policyReason:'',policyUnknownAcknowledged:false,ownerRecordedTaxAcknowledged:false,confirmed:false,result:null,request:null}; if(draft.inputs.version!=='estimate-commercial-terms-v2'){draft.inputs.version='estimate-commercial-terms-v2';draft.inputs.jobApplicability=empty().jobApplicability;draft.inputs.taxGroups.forEach(function(g){var old=g.source;g.source=Object.assign(source(),{note:old.note,reference:old.reference,jurisdiction:old.jurisdiction,location:old.location,serviceKey:old.serviceKey,collectionBasis:old.collectionBasis});g.treatment='unknown';g.ratePercent=null;});} rerender(action==='save'?'cdCommercialDate':'cdCommercialReason'); }
    if (!draft) {
      if(plans.sources.pricingCurrent)button(plans.current&&plans.current.action==='save'?'Revise Commercial Terms':'Add Commercial Terms',function(){start('save');},root,'cdCommercialStart');
      if(plans.current&&plans.current.action==='save')button('Withdraw Commercial Terms',function(){start('withdraw');},root,'cdCommercialWithdraw');
      if(plans.current&&plans.current.current&&plans.current.result&&plans.current.result.complete&&!plans.binding)button('Review Full Approval',function(){start('approve');},root,'cdCommercialApprove');
      if(!plans.sources.pricingCurrent)el('p','Save a current pricing proposal before adding terms. Existing terms can still be withdrawn.');
      return;
    }
    root.open=true; var active=draft, generation=serial, form=el('form'), status=el('p',draft.changed?'The estimate or source changed. Review current entries and calculate again.':'',form); status.id='cdCommercialStatus';status.tabIndex=-1;status.setAttribute('role','status');
    var confirmation,results;
    function invalidate(){active.result=null;active.request=null;active.confirmed=false;if(confirmation)confirmation.checked=false;if(results)results.replaceChildren();}
    function nullable(v){return v.trim()===''?null:v.trim();}
    function money(v){v=nullable(v);if(v!==null&&/^-?\d+(\.\d{1,2})?$/.test(v)){var a=v.split('.');return a[0]+'.'+((a[1]||'')+'00').slice(0,2);}return v;}
    function field(target,label,id,value,set,choices){var labelNode=el('label',null,target);labelNode.htmlFor=id;el('span',label,labelNode);var input=el(choices?'select':'input',null,labelNode);input.id=id;if(choices)choices.forEach(function(c){var o=el('option',c[1],input);o.value=c[0];});input.value=value==null?'':value;input.addEventListener(choices?'change':'input',function(){invalidate();set(input.value);});return input;}
    function check(target,label,id,value,set){var l=el('label',null,target);l.className='drawer-decision-confirmation';var n=el('input',null,l);n.type='checkbox';n.id=id;n.checked=value;el('span',label,l);n.onchange=function(){invalidate();set(n.checked);};return n;}
    function section(target,label,id){var d=el('details',null,target);d.dataset.commercialSection=id;el('summary',label,d);return d;}
    function lines(target, selected, available, id){available.forEach(function(l,i){check(target,l.label,id+'-'+i,selected.indexOf(l.lineId)>=0,function(yes){var at=selected.indexOf(l.lineId);if(yes&&at<0)selected.push(l.lineId);if(!yes&&at>=0)selected.splice(at,1);});});}
    function remove(array,index,id){array.splice(index,1);invalidate();rerender(id);}
    if(active.action==='save'){
      var v=active.inputs;
      field(form,'Transaction Date','cdCommercialDate',v.transactionDate,function(x){v.transactionDate=nullable(x);}).type='date';
      el('p','Leave unknown facts blank. Complete tax treatment is required before full approval.',form);
      var facts=section(form,'Job Details For Tax Review','jobFacts'),jf=v.jobApplicability;
      el('p','Record facts for this job and where you learned them. Unknown details may stay blank. These declarations do not establish an exemption or legal treatment.',facts);
      [['Service Operation','serviceOperation',null],['Property Use','propertyUse',[['unknown','Not Yet Known'],['residential','Residential'],['commercial','Commercial'],['mixed','Mixed'],['other','Other']]],['Work Context','workContext',[['unknown','Not Yet Known'],['maintenance','Maintenance'],['repair','Repair'],['new_construction','New Construction'],['capital_improvement','Capital Improvement'],['other','Other']]],['Customer Exemption','customerExemption',[['unknown','Not Yet Known'],['none','No Exemption Claimed'],['claimed','Exemption Claimed']]]].forEach(function(f){field(facts,f[0],'cdCommercialFact'+f[1],jf[f[1]],function(x){jf[f[1]]=f[1]==='serviceOperation'?nullable(x):x;},f[2]);field(facts,f[0]+' Source','cdCommercialFactSource'+f[1],jf.evidenceRef[f[1]],function(x){jf.evidenceRef[f[1]]=x;});});
      el('p','Record the operation specified by the reviewed source. A matching service name alone does not establish coverage.',facts);
      var adjustments=section(form,'Discounts And Price Adjustments','adjustments');
      v.adjustments.forEach(function(a,i){var id='cdCommercialAdjustment'+i,box=section(adjustments,a.label||'Price Adjustment',id);
        field(box,'Label',id+'Label',a.label,function(x){a.label=x;});
        field(box,'Type',id+'Kind',a.kind,function(x){a.kind=x;if(x==='adjustment'){a.method='fixed';a.percent=null;}rerender(id+'Kind');},[['line_discount','Line Discount'],['order_discount','Order Discount'],['adjustment','Signed Price Adjustment']]);
        field(box,'Method',id+'Method',a.method,function(x){a.method=x;a.amount=null;a.percent=null;rerender(id+'Method');},a.kind==='adjustment'?[['fixed','Fixed Amount']]:[['fixed','Fixed Amount'],['percent','Percentage']]);
        field(box,a.method==='fixed'?'Amount':'Percentage',id+'Amount',a.method==='fixed'?a.amount:a.percent,function(x){a[a.method==='fixed'?'amount':'percent']=a.method==='fixed'?money(x):nullable(x);});
        field(box,'Reason',id+'Reason',a.reason,function(x){a.reason=x;});el('p','Choose the charges this adjustment applies to.',box);lines(box,a.lineIds,charges,id+'Lines');button('Remove Adjustment',function(){remove(v.adjustments,i,'cdCommercialAddAdjustment');},box);
      });
      if(v.adjustments.length<12)button('Add Adjustment',function(){v.adjustments.push({adjustmentId:crypto.randomUUID(),label:'',kind:'adjustment',method:'fixed',amount:null,percent:null,lineIds:[],reason:''});invalidate();rerender('cdCommercialAdjustment'+(v.adjustments.length-1)+'Label');},adjustments,'cdCommercialAddAdjustment');
      el('p','Apply line discounts first, then the order discount, then signed adjustments. A discount does not change the recorded job costs.',adjustments);
      var fees=section(form,'Additional Fees','fees');
      v.fees.forEach(function(f,i){var id='cdCommercialFee'+i,box=section(fees,f.label||'Fee',id);field(box,'Label',id+'Label',f.label,function(x){f.label=x;});field(box,'Amount',id+'Amount',f.amount,function(x){f.amount=money(x);});field(box,'Reason',id+'Reason',f.reason,function(x){f.reason=x;});button('Remove Fee',function(){remove(v.fees,i,'cdCommercialAddFee');},box);});
      if(charges.length+v.fees.length<12)button('Add Fee',function(){v.fees.push({lineId:crypto.randomUUID(),label:'',amount:null,reason:''});invalidate();rerender('cdCommercialFee'+(v.fees.length-1)+'Label');},fees,'cdCommercialAddFee');
      var taxes=section(form,'Tax Treatment','tax');
      v.taxGroups.forEach(function(g,i){var id='cdCommercialTax'+i,box=section(taxes,g.label||'Tax Group',id),s=g.source;
        field(box,'Label',id+'Label',g.label,function(x){g.label=x;});lines(box,g.lineIds,charges.concat(v.fees),id+'Lines');
        field(box,'Price Includes Tax',id+'Behavior',g.behavior,function(x){g.behavior=x;},[['exclusive','Tax Added To Price'],['inclusive','Tax Included In Price']]);
        field(box,'Treatment',id+'Treatment',g.treatment,function(x){g.treatment=x;g.ratePercent=x==='zero_rate'||x==='exempt'?'0':null;rerender(id+'Treatment');},[['unknown','Not Yet Known'],['taxable','Taxable'],['zero_rate','Zero Rate'],['exempt','Exempt']]);
        if(g.treatment==='taxable')field(box,'Tax Rate (%)',id+'Rate',g.ratePercent,function(x){g.ratePercent=nullable(x);});
        var evidence=section(box,'Source And Applicability',id+'Source');
        var eligibleRules=(plans.sources.validatedRules||[]).filter(function(r){return r.version==='tax-preparation-v2'&&r.serviceKey===(plans.simulated?plans.sources.taxServiceKey:plans.sources.serviceKey);});
        field(evidence,'Tax Source',id+'Kind',s.kind==='validated'?'rule:'+s.ruleId:s.kind,function(x){var r=eligibleRules.find(function(r){return 'rule:'+r.id===x;});if(r){g.treatment=r.treatment;g.ratePercent=r.ratePercent;g.behavior=r.behavior;g.source={kind:'validated',note:r.sourceNote||'Current validated source artifact',reference:r.sourceReference||r.id,legalEffectiveOn:r.legalEffectiveOn,legalEndsOn:r.legalEndsOn,reviewedOn:r.reviewedOn,reviewValidThrough:r.reviewValidThrough,jurisdiction:r.jurisdiction,location:'',serviceKey:r.serviceKey,collectionBasis:r.collectionBasis,acknowledged:false,ruleId:r.id,ruleDigest:r.digest};}else{s.kind=x;s.ruleId=null;s.ruleDigest=null;s.acknowledged=false;if(x==='unknown'){g.treatment='unknown';g.ratePercent=null;}}rerender(id+'Kind');},[['unknown','Not Yet Reviewed'],['owner_recorded','Recorded By My Company']].concat(eligibleRules.map(function(r){return['rule:'+r.id,plans.simulated?'Simulated Practice Coverage':'Available Validated Coverage'];})));
        if(s.kind==='validated'){[['Legal Start','legalEffectiveOn'],['Known Legal End','legalEndsOn'],['Source Reviewed','reviewedOn'],['Review Valid Through','reviewValidThrough']].forEach(function(pair){el('p',pair[0]+': '+(s[pair[1]]||'Not Recorded'),evidence);});el('p',plans.simulated?'Authored practice coverage only. This is not a real tax rate or registration.':'Coverage matches the saved company setup. Review the exact job location and date before approval.',evidence);field(evidence,'Job Location',id+'location',s.location,function(x){s.location=x;});check(evidence,'I reviewed this source and its applicability to the job.',id+'Acknowledged',s.acknowledged,function(x){s.acknowledged=x;});}

        if(s.kind==='owner_recorded'){
          el('p','Record the treatment you reviewed with an appropriate external source. This does not make it NorthStar-validated tax coverage.',evidence);
          [['Source Note','note'],['Source Reference','reference'],['Jurisdiction','jurisdiction'],['Job Location','location'],['Collection Basis','collectionBasis']].forEach(function(f){field(evidence,f[0],id+f[1],s[f[1]],function(x){s[f[1]]=x;});});
          [['Legal Start Date','legalEffectiveOn'],['Known Legal End Date','legalEndsOn'],['Source Reviewed On','reviewedOn'],['Review Valid Through','reviewValidThrough']].forEach(function(f){field(evidence,f[0],id+f[1],s[f[1]],function(x){s[f[1]]=nullable(x);}).type='date';});
          check(evidence,'I reviewed this treatment and its applicability using the recorded external source.',id+'Acknowledged',s.acknowledged,function(x){s.acknowledged=x;});
        }
        button('Remove Tax Group',function(){remove(v.taxGroups,i,'cdCommercialAddTax');},box);
      });
      if(v.taxGroups.length<12)button('Add Tax Group',function(){v.taxGroups.push(taxGroup([]));invalidate();rerender('cdCommercialTax'+(v.taxGroups.length-1)+'Label');},taxes,'cdCommercialAddTax');
      var payments=section(form,'Payment Stages','payments'),p=v.payments;
      field(payments,'Payment Plan','cdCommercialPaymentMode',p.mode,function(x){p.mode=x;p.balanceId=x==='none'?null:crypto.randomUUID();p.stages=x==='none'?[]:[{stageId:p.balanceId,label:'Final Balance',kind:'balance',value:x==='share'?'100':null}];rerender('cdCommercialPaymentMode');},[['none','No Payment Stages Recorded'],['amount','Fixed Stage Amounts'],['share','Shares Of Total']]);
      if(p.mode!=='none'){
        el('p','Payment stages divide the total payable; they are not additional charges. The final balance receives the remainder.',payments);
        p.stages.forEach(function(s,i){var id='cdCommercialPayment'+i;field(payments,'Stage Label',id+'Label',s.label,function(x){s.label=x;});field(payments,p.mode==='share'?'Share (%)':'Amount',id+'Value',s.value,function(x){s.value=p.mode==='amount'?money(x):nullable(x);});if(s.kind!=='balance'){field(payments,'Stage Type',id+'Kind',s.kind,function(x){s.kind=x;},[['deposit','Deposit'],['milestone','Milestone']]);button('Remove Stage',function(){remove(p.stages,i,'cdCommercialAddPayment');},payments);}});
        if(p.stages.length<11)button('Add Payment Stage',function(){p.stages.splice(p.stages.length-1,0,{stageId:crypto.randomUUID(),label:'',kind:'milestone',value:p.mode==='share'?'0':null});invalidate();rerender('cdCommercialPayment'+(p.stages.length-2)+'Label');},payments,'cdCommercialAddPayment');
      }
    }
    if(active.action==='approve'){
      resultView(plans.current.result,form);savedFacts(plans.current.inputs,form);
      field(form,'Approved Scope','cdCommercialScope',active.scopeSummary,function(x){active.scopeSummary=x;}).required=true;
      if(plans.comparison.state==='below')field(form,'Reason For Price Below Policy','cdCommercialException',active.policyReason,function(x){active.policyReason=x;}).required=true;
      if(plans.comparison.state==='unavailable')check(form,'I understand a current policy comparison is unavailable.','cdCommercialPolicyUnknown',active.policyUnknownAcknowledged,function(x){active.policyUnknownAcknowledged=x;});
      if(plans.current.result.taxAuthority==='owner_recorded')check(form,'I reviewed the company-recorded tax treatment. NorthStar has not validated this treatment.','cdCommercialTaxAcknowledged',active.ownerRecordedTaxAcknowledged,function(x){active.ownerRecordedTaxAcknowledged=x;});
    }
    field(form,'Reason For This Review','cdCommercialReason',active.reason,function(x){active.reason=x;}).required=true;
    results=el('div',null,form);if(active.result)resultView(active.result,results);
    confirmation=check(form,active.action==='approve'?'I approve the recorded scope, price, adjustments, tax treatment, total and payment stages. This does not send a document or collect payment.':active.action==='withdraw'?'I reviewed withdrawing these terms. Saved history remains available.':'I reviewed these entries and their unknowns. Saving does not approve the price or tax treatment.','cdCommercialConfirm',active.confirmed,function(x){active.confirmed=x;});
    // Confirmation changes do not discard the already reviewed calculation or exact request.
    confirmation.onchange=function(){active.confirmed=confirmation.checked;};
    var actions=el('div',null,form);actions.className='drawer-review-actions';if(active.action==='save')button('Calculate Terms',function(){send(true);},actions,'cdCommercialCalculate');
    var save=el('button',active.action==='approve'?'Approve Full Review':active.action==='withdraw'?'Confirm Withdrawal':'Save Commercial Terms',actions);save.type='submit';save.className='btn btn-primary';save.id='cdCommercialSave';
    button('Cancel',function(){draft=null;rerender('cdCommercialStart');},actions,'cdCommercialCancel');
    form.onsubmit=function(e){e.preventDefault();if(!active.confirmed||active.action==='save'&&!active.result){status.textContent=active.action==='withdraw'?'Review and confirm the withdrawal.':active.action==='approve'?'Review the full terms and confirm approval.':'Calculate the terms, then review and confirm them.';status.focus();return;}send(false);};
    function current(){return generation===serial&&draft===active&&options.isCurrent();}
    function send(preview){
      if(!form.reportValidity())return;var attempt=!preview&&active.request;
      if(!attempt){var body=active.action==='approve'?{termsPin:{id:plans.current.id,revision:plans.current.revision,digest:plans.current.digest},evidenceDigest:plans.sources.digest,expectedDecisionRevision:plans.decisionBasis.revision,expectedDecisionDigest:plans.decisionBasis.digest,scopeSummary:active.scopeSummary,reason:active.reason,confirmed:true,confirmationVersion:'estimate-commercial-terms-v2',exceptions:{policyReason:active.policyReason,policyUnknownAcknowledged:active.policyUnknownAcknowledged,ownerRecordedTaxAcknowledged:active.ownerRecordedTaxAcknowledged}}:{action:active.action,expectedRevision:plans.current?plans.current.revision:0,expectedDigest:plans.current?plans.current.digest:'none',sourcePins:review.pins,expectedDecisionRevision:plans.decisionBasis.revision,expectedDecisionDigest:plans.decisionBasis.digest,inputs:active.action==='withdraw'?null:clone(active.inputs),currency:review.currency,reason:active.reason,confirmed:true,confirmationVersion:'estimate-commercial-terms-v2',evidenceDigest:plans.sources.digest};attempt={key:crypto.randomUUID(),body:body,workspaceRevision:review.demoWorkspaceRevision};if(!preview)active.request=attempt;}
      var headers={'Content-Type':'application/json','Idempotency-Key':attempt.key};if(review.simulated)headers['X-NorthStar-Demo-Revision']=String(attempt.workspaceRevision);
      var disabled=Array.prototype.map.call(form.elements,function(n){var d=n.disabled;n.disabled=true;return d;});status.textContent=preview?'Calculating Terms…':'Saving Commercial Review…';
      window.NorthStarAccountSession.fetch('/api/v1/canonical/estimates/'+encodeURIComponent(review.pins.estimateId)+(preview?'/commercial-preview':active.action==='approve'?'/commercial-approvals':'/commercial-terms'),{method:'POST',headers:headers,body:JSON.stringify(attempt.body)}).then(function(r){return r.json().catch(function(){return{};}).then(function(b){if(!r.ok)throw{status:r.status,category:b.error&&b.error.category,message:b.error&&b.error.message};return b;});}).then(function(b){if(!current())return;if(preview){if(!b.success||!b.data||b.data.evidenceDigest!==plans.sources.digest)throw{status:409};active.result=b.data.result;active.request=null;active.confirmed=false;confirmation.checked=false;results.replaceChildren();resultView(active.result,results);status.textContent='Review the calculated amounts and any unknowns, then confirm to save.';}else{draft=null;options.refresh();}}).catch(function(e){if(!current())return;var paused=e.status===503&&e.category==='commercial_paused',known=[400,401,403,404,409,410,413,429].indexOf(e.status)>=0||paused;
        status.textContent=e.status===400?(e.message||'Review the charges, tax treatment and confirmation. Calculate again.'):e.status===401?'Sign in again before saving.':e.status===403?'Your current account cannot change these terms.':e.status===404?'This estimate is unavailable. Choose a current estimate.':e.status===409?'The estimate, price or source changed. Refresh, calculate again and confirm.':e.status===410?'This demo session expired. Refresh to start again.':e.status===413?'Shorten the entries and source notes before trying again.':e.status===429?(e.category==='commercial_history_limit'?'This demo has reached its commercial history limit. Saved history remains available. Deliberately resetting removes its practice work.':'Saving is currently limited. Check saved history and try later.'):paused?'New commercial terms and approvals are paused. Refresh to check saved history.':preview?'Terms could not be calculated. Try calculating again.':'The save result is unconfirmed. Retry this same attempt without changing entries, or refresh to check saved history.';if(known||preview)invalidate();
      }).finally(function(){if(current()){Array.prototype.forEach.call(form.elements,function(n,i){n.disabled=disabled[i];});status.focus();}});
    }
  }
  window.NorthStarCommercialTerms={render:render,reset:reset};
})();
