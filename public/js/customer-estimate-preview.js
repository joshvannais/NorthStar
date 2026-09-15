(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NorthStarCustomerEstimate = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function money(value, currency) {
    var number = Number(value);
    if (!Number.isFinite(number)) return 'Unavailable';
    try { return new Intl.NumberFormat('en-US', { style:'currency', currency:currency || 'USD' }).format(number); }
    catch (_error) { return (currency === 'USD' ? '$' : '') + number.toFixed(2); }
  }

  function safeText(value) { return typeof value === 'string' ? value : ''; }

  function presentationRows(estimate) {
    var rows = [];
    (estimate.charges || []).forEach(function (line) { rows.push({ label:line.label, amount:money(line.amount, estimate.currency), kind:'charge' }); });
    rows.push({ label:'Subtotal', amount:money(estimate.subtotal, estimate.currency), kind:'subtotal' });
    rows.push({ label:'Tax', amount:money(estimate.tax, estimate.currency), kind:'tax' });
    rows.push({ label:'Estimated total', amount:money(estimate.total, estimate.currency), kind:'total' });
    return rows;
  }

  function append(parent, tag, className, text) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    parent.appendChild(element);
    return element;
  }

  function estimateCard(estimate) {
    var card = document.createElement('article'); card.className = 'customer-estimate-document';
    var header = append(card,'header','customer-estimate-header');
    var brand = append(header,'div','customer-estimate-brand');
    append(brand,'p','customer-estimate-kicker','Estimate');
    append(brand,'h2','',estimate.issuer.name);
    if (estimate.issuer.dba) append(brand,'p','customer-estimate-muted',estimate.issuer.dba);
    var meta = append(header,'div','customer-estimate-meta');
    append(meta,'strong','',estimate.reference);
    append(meta,'span','',estimate.state === 'preview' ? 'Preview' : 'Issued');
    var contact = [estimate.issuer.phone,estimate.issuer.email,estimate.issuer.website,estimate.issuer.address].filter(Boolean);
    if (contact.length) append(card,'p','customer-estimate-contact',contact.join(' · '));
    var intro = append(card,'section','customer-estimate-intro');
    var customer = append(intro,'div',''); append(customer,'span','customer-estimate-label','Prepared for'); append(customer,'strong','',estimate.customer.name); if(estimate.customer.address) append(customer,'p','',estimate.customer.address);
    var work = append(intro,'div',''); append(work,'span','customer-estimate-label','Work'); append(work,'strong','',estimate.work.title);
    var scope = append(card,'section','customer-estimate-scope'); append(scope,'h3','', 'Project scope'); append(scope,'p','',estimate.work.scope);
    var cost = append(card,'section','customer-estimate-costs'); append(cost,'h3','', 'Estimate');
    presentationRows(estimate).forEach(function (row) { var line=append(cost,'div','customer-estimate-row customer-estimate-'+row.kind);append(line,'span','',row.label);append(line,'strong','',row.amount); });
    if ((estimate.adjustments || []).length) { var adjusted=append(card,'details','customer-estimate-adjustments');var title=append(adjusted,'summary','', 'Adjustments included');title.setAttribute('aria-label','Show adjustments included in the estimate');(estimate.adjustments||[]).forEach(function(row){var line=append(adjusted,'div','customer-estimate-row');append(line,'span','',row.label);append(line,'strong','',money(row.amount,estimate.currency));}); }
    if ((estimate.payments || []).length) { var payments=append(card,'section','customer-estimate-payments');append(payments,'h3','', 'Payment schedule');(estimate.payments||[]).forEach(function(row){var line=append(payments,'div','customer-estimate-row');append(line,'span','',row.label);append(line,'strong','',money(row.amount,estimate.currency));}); }
    append(card,'p','customer-estimate-notice',estimate.notice);
    var footer = append(card,'footer','customer-estimate-signature');append(footer,'span','customer-estimate-star','✦');append(footer,'span','',estimate.platformSignature);
    return card;
  }

  function ascii(value) { return safeText(value).normalize('NFKD').replace(/[^\x20-\x7E]/g,'').replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)'); }
  function wrap(value, maximum) {
    var words=safeText(value).split(/\s+/).filter(Boolean), lines=[], current='';
    words.forEach(function(word){var next=current?current+' '+word:word;if(next.length>maximum&&current){lines.push(current);current=word;}else current=next;});if(current)lines.push(current);return lines.length?lines:[''];
  }
  function documentLines(estimate) {
    var lines=[{text:'ESTIMATE',size:10,gap:16,color:'gold'},{text:estimate.issuer.name,size:22,gap:28,bold:true}];
    [estimate.issuer.phone,estimate.issuer.email,estimate.issuer.website,estimate.issuer.address].filter(Boolean).forEach(function(v){wrap(v,78).forEach(function(row){lines.push({text:row,size:9,gap:13});});});
    lines.push({text:estimate.reference+'  |  '+(estimate.state==='preview'?'Preview':'Issued'),size:9,gap:24});
    lines.push({text:'PREPARED FOR',size:9,gap:14,color:'gold'});lines.push({text:estimate.customer.name,size:13,gap:18,bold:true});if(estimate.customer.address)wrap(estimate.customer.address,78).forEach(function(v){lines.push({text:v,size:10,gap:14});});
    lines.push({text:'WORK',size:9,gap:14,color:'gold'});lines.push({text:estimate.work.title,size:13,gap:18,bold:true});
    lines.push({text:'PROJECT SCOPE',size:9,gap:14,color:'gold'});wrap(estimate.work.scope,78).forEach(function(v){lines.push({text:v,size:10,gap:14});});
    lines.push({text:'ESTIMATE',size:9,gap:18,color:'gold'});presentationRows(estimate).forEach(function(row){lines.push({text:row.label+'|'+row.amount,size:row.kind==='total'?13:10,gap:row.kind==='total'?24:17,bold:row.kind==='total'});});
    if((estimate.payments||[]).length){lines.push({text:'PAYMENT SCHEDULE',size:9,gap:18,color:'gold'});estimate.payments.forEach(function(row){lines.push({text:row.label+'|'+money(row.amount,estimate.currency),size:10,gap:17});});}
    wrap(estimate.notice,78).forEach(function(v){lines.push({text:v,size:8,gap:12,muted:true});});lines.push({text:'Prepared with NorthStar',size:8,gap:12,signature:true});return lines;
  }

  function pdfBytes(estimate) {
    var pages=[],page=[],height=0;documentLines(estimate).forEach(function(line){if(page.length&&height+line.gap>680){pages.push(page);page=[];height=0;}page.push(line);height+=line.gap;});if(page.length)pages.push(page);
    var objects=['','<< /Type /Catalog /Pages 2 0 R >>','', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'];
    var kids=[];pages.forEach(function(lines,index){var pageId=5+index*2,contentId=pageId+1;kids.push(pageId+' 0 R');var y=746,commands=['0.72 0.57 0.18 RG 1.25 w 32 32 548 728 re S'];lines.forEach(function(line){var left=line.signature?438:48,right=null,drawY=line.signature?48:y;if(line.text.indexOf('|')>=0){var parts=line.text.split('|');line={...line,text:parts[0]};right=parts.slice(1).join('|');}var color=line.color==='gold'?'0.62 0.46 0.12':line.muted||line.signature?'0.35 0.38 0.43':'0.08 0.10 0.16';commands.push('BT '+color+' rg /F'+(line.bold?'2':'1')+' '+line.size+' Tf '+left+' '+drawY+' Td ('+ascii(line.text)+') Tj ET');if(right)commands.push('BT '+color+' rg /F'+(line.bold?'2':'1')+' '+line.size+' Tf 420 '+drawY+' Td ('+ascii(right)+') Tj ET');if(!line.signature)y-=line.gap;});var stream=commands.join('\n');objects[pageId]='<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents '+contentId+' 0 R >>';objects[contentId]='<< /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream';});objects[2]='<< /Type /Pages /Kids ['+kids.join(' ')+'] /Count '+kids.length+' >>';
    var output='%PDF-1.4\n',offsets=[0];for(var i=1;i<objects.length;i++){offsets[i]=output.length;output+=i+' 0 obj\n'+objects[i]+'\nendobj\n';}var xref=output.length;output+='xref\n0 '+objects.length+'\n0000000000 65535 f \n';for(var j=1;j<objects.length;j++)output+=String(offsets[j]).padStart(10,'0')+' 00000 n \n';output+='trailer\n<< /Size '+objects.length+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF';return new TextEncoder().encode(output);
  }

  function canvasBlob(estimate) {
    var width=1600,padding=110,scale=2,measure=document.createElement('canvas').getContext('2d'),body=documentLines(estimate),wrapped=[];body.forEach(function(line){if(line.text.indexOf('|')>=0){wrapped.push(line);return;}measure.font=(line.bold?'700 ':'400 ')+(line.size*scale)+'px Inter, Segoe UI, sans-serif';wrapCanvas(measure,line.text,width-padding*2,line).forEach(function(value){wrapped.push({...line,text:value});});});var height=Math.max(2100,240+wrapped.reduce(function(sum,line){return sum+(line.signature?0:line.gap*scale);},0));var canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;var ctx=canvas.getContext('2d');ctx.fillStyle='#fbfaf7';ctx.fillRect(0,0,width,height);ctx.strokeStyle='#b58c32';ctx.lineWidth=4;roundRect(ctx,50,50,width-100,height-100,34);ctx.stroke();var y=150;wrapped.forEach(function(line){ctx.font=(line.bold?'700 ':'400 ')+(line.size*scale)+'px Inter, Segoe UI, sans-serif';ctx.fillStyle=line.color==='gold'?'#8a681d':line.muted||line.signature?'#69707d':'#111827';if(line.signature){ctx.textAlign='right';ctx.fillText(line.text,width-padding,height-85);ctx.textAlign='left';return;}if(line.text.indexOf('|')>=0){var parts=line.text.split('|');ctx.textAlign='left';ctx.fillText(parts[0],padding,y);ctx.textAlign='right';ctx.fillText(parts.slice(1).join('|'),width-padding,y);ctx.textAlign='left';}else{ctx.fillText(line.text,padding,y);}y+=line.gap*scale;});return new Promise(function(resolve,reject){canvas.toBlob(function(blob){if(blob)resolve(blob);else reject(new Error('Image unavailable'));},'image/png');});
  }
  function wrapCanvas(ctx,value,max,line){var words=safeText(value).split(/\s+/).filter(Boolean),rows=[],current='';words.forEach(function(word){var next=current?current+' '+word:word;if(current&&ctx.measureText(next).width>max){rows.push(current);current=word;}else current=next;});if(current)rows.push(current);return rows.length?rows:[''];}
  function roundRect(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
  function save(blob,name){var url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();setTimeout(function(){URL.revokeObjectURL(url);},1000);}

  function open(estimate, returnFocus) {
    var overlay=append(document.body,'div','customer-estimate-overlay');overlay.setAttribute('role','presentation');var dialog=append(overlay,'section','customer-estimate-dialog');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','customerEstimateDialogTitle');dialog.tabIndex=-1;
    var bar=append(dialog,'div','customer-estimate-dialog-bar');var title=append(bar,'h2','', 'Customer estimate preview');title.id='customerEstimateDialogTitle';var close=append(bar,'button','customer-estimate-close','×');close.type='button';close.setAttribute('aria-label','Close customer estimate preview');
    var body=append(dialog,'div','customer-estimate-dialog-body');body.appendChild(estimateCard(estimate));var actions=append(dialog,'div','customer-estimate-dialog-actions');var pdf=append(actions,'button','btn btn-secondary','Download PDF');pdf.type='button';var image=append(actions,'button','btn btn-secondary','Download image');image.type='button';append(actions,'p','',estimate.state==='preview'?'Downloads are previews. Nothing is sent to the customer.':'Downloads match this issued estimate.');
    function keyboard(event){if(!overlay.isConnected)return;if(event.key==='Escape'){event.preventDefault();shut();return;}if(event.key!=='Tab')return;var controls=Array.prototype.slice.call(dialog.querySelectorAll('button:not([disabled]),summary,[href],[tabindex]:not([tabindex="-1"])'));if(!controls.length)return;var first=controls[0],last=controls[controls.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
    function shut(){document.removeEventListener('keydown',keyboard);overlay.remove();document.body.classList.remove('customer-estimate-open');if(returnFocus&&returnFocus.isConnected)returnFocus.focus();}close.onclick=shut;overlay.onclick=function(event){if(event.target===overlay)shut();};document.addEventListener('keydown',keyboard);pdf.onclick=function(){save(new Blob([pdfBytes(estimate)],{type:'application/pdf'}),estimate.reference+'.pdf');};image.onclick=function(){image.disabled=true;canvasBlob(estimate).then(function(blob){save(blob,estimate.reference+'.png');}).finally(function(){image.disabled=false;});};document.body.classList.add('customer-estimate-open');close.focus();
  }

  function route(review) { var id=encodeURIComponent(review.pins.estimateId);return (review.simulated?'/api/v1/command-center/estimates/':'/api/v1/canonical/estimates/')+id+'/customer-estimate-preview'; }
  function mount(review, host) {
    if(!host||!review||!review.commercialTerms||!review.commercialTerms.customerSummary)return null;
    var section=append(host,'section','customer-estimate-launch');append(section,'p','customer-estimate-kicker','Customer document');append(section,'h4','', 'Share a clear estimate');append(section,'p','', 'Preview the customer-safe version and download a matching PDF or image. Nothing is sent from this preview.');var button=append(section,'button','btn btn-primary','Preview Customer Estimate');button.type='button';var status=append(section,'p','customer-estimate-launch-status','');status.setAttribute('role','status');status.setAttribute('aria-live','polite');button.onclick=function(){button.disabled=true;status.textContent='Preparing the customer estimate…';window.NorthStarAccountSession.fetch(route(review),{cache:'no-store'}).then(function(response){return response.json().catch(function(){return{};}).then(function(body){if(!response.ok)throw{status:response.status,message:body.error&&body.error.message};return body.data;});}).then(function(estimate){status.textContent='';open(estimate,button);}).catch(function(error){status.textContent=error&&error.message||'The customer estimate is unavailable. Refresh the saved estimate and try again.';}).finally(function(){button.disabled=false;});};return section;
  }

  return { money:money, presentationRows:presentationRows, pdfBytes:pdfBytes, mount:mount };
}));
