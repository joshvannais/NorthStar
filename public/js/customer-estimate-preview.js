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
    (estimate.adjustments || []).forEach(function (line) { rows.push({ label:line.label+' (included)', amount:money(line.amount, estimate.currency), kind:'adjustment' }); });
    rows.push({ label:'Subtotal', amount:money(estimate.subtotal, estimate.currency), kind:'subtotal' });
    (estimate.taxes || []).forEach(function (line) { var treatment=line.treatment==='zero_rate'?'Zero rate':line.treatment==='exempt'?'Exempt':line.treatment==='taxable'?'Taxable':'Reviewed';rows.push({ label:line.label+' · '+treatment, amount:money(line.amount, estimate.currency), kind:'tax' }); });
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
    if ((estimate.payments || []).length) { var payments=append(card,'section','customer-estimate-payments');append(payments,'h3','', 'Payment schedule');(estimate.payments||[]).forEach(function(row){var line=append(payments,'div','customer-estimate-row');append(line,'span','',row.label);append(line,'strong','',money(row.amount,estimate.currency));}); }
    append(card,'p','customer-estimate-notice',estimate.notice);
    var footer = append(card,'footer','customer-estimate-signature');append(footer,'span','customer-estimate-star','✦');append(footer,'span','',estimate.platformSignature);
    return card;
  }

  function wrap(value, maximum) {
    var words=safeText(value).split(/\s+/).filter(Boolean), lines=[], current='';
    words.forEach(function(word){while(word.length>maximum){if(current){lines.push(current);current='';}lines.push(word.slice(0,maximum));word=word.slice(maximum);}var next=current?current+' '+word:word;if(next.length>maximum&&current){lines.push(current);current=word;}else current=next;});if(current)lines.push(current);return lines.length?lines:[''];
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

  function pdfDefinition(estimate, identityImages) {
    var issuer=[estimate.issuer.phone,estimate.issuer.email,estimate.issuer.website,estimate.issuer.address].filter(Boolean).join(' · '),rows=presentationRows(estimate).map(function(row){return [{text:row.label,bold:row.kind==='total'},{text:row.amount,bold:row.kind==='total',alignment:'right'}];});
    var issuerName=identityImages&&identityImages.issuer?{image:identityImages.issuer,width:Math.min(300,identityImages.issuerWidth),margin:[0,2,0,0]}:{text:estimate.issuer.name,style:'brand'};
    var customerName=identityImages&&identityImages.customer?{image:identityImages.customer,width:Math.min(220,identityImages.customerWidth),margin:[0,5,0,0]}:{text:estimate.customer.name,bold:true,margin:[0,5,0,0]};
    var content=[{text:'ESTIMATE',style:'kicker'},{columns:[issuerName,{stack:[{text:estimate.reference,bold:true,alignment:'right'},{text:estimate.state==='preview'?'Preview':'Issued',color:'#8a681d',alignment:'right',margin:[0,4,0,0]}]}],margin:[0,0,0,8]}];
    if(issuer)content.push({text:issuer,style:'muted',margin:[0,0,0,22]});
    content.push({columns:[{stack:[{text:'PREPARED FOR',style:'kicker'},customerName,{text:estimate.customer.address||'',style:'muted',margin:[0,4,0,0]}]},{stack:[{text:'WORK',style:'kicker'},{text:estimate.work.title,bold:true,margin:[0,5,0,0]}]}],columnGap:24,margin:[0,0,0,22]});
    content.push({text:'PROJECT SCOPE',style:'kicker'},{text:estimate.work.scope,margin:[0,6,0,22]},{text:'ESTIMATE',style:'kicker'},{table:{widths:['*',90],body:rows},layout:{hLineWidth:function(index,node){return index===rows.length-1?1.5:index===rows.length-2||index===estimate.charges.length+estimate.adjustments.length?0.5:0;},hLineColor:function(){return'#b58c32';},vLineWidth:function(){return 0;},paddingTop:function(){return 7;},paddingBottom:function(){return 7;},paddingLeft:function(){return 0;},paddingRight:function(){return 0;}}});
    if((estimate.payments||[]).length)content.push({text:'PAYMENT SCHEDULE',style:'kicker',margin:[0,22,0,6]},{table:{widths:['*',90],body:estimate.payments.map(function(row){return [{text:row.label},{text:money(row.amount,estimate.currency),alignment:'right'}];})},layout:'noBorders'});
    content.push({text:estimate.notice,style:'notice',margin:[0,22,0,0]});
    return {info:{title:'Estimate for '+estimate.customer.name,author:estimate.issuer.name,subject:estimate.work.title},pageSize:'LETTER',pageMargins:[54,54,54,54],background:function(_page,size){return{canvas:[{type:'rect',x:28,y:28,w:size.width-56,h:size.height-56,r:10,lineColor:'#b58c32',lineWidth:1.5}]};},footer:function(){return{text:estimate.platformSignature,alignment:'right',color:'#69707d',fontSize:8,margin:[0,0,54,28]};},content:content,defaultStyle:{font:'Roboto',fontSize:10,color:'#111827',lineHeight:1.35},styles:{kicker:{fontSize:8,bold:true,color:'#8a681d',characterSpacing:1.1},brand:{fontSize:21,bold:true},muted:{fontSize:9,color:'#69707d'},notice:{fontSize:8,color:'#69707d'}}};
  }
  var pdfLoader=null;
  function loadScript(source){return new Promise(function(resolve,reject){var script=document.createElement('script');script.src=source;script.onload=resolve;script.onerror=function(){reject(new Error('PDF support could not be loaded.'));};document.head.appendChild(script);});}
  function ensurePdfMake(){if(window.pdfMake&&window.pdfMake.createPdf)return Promise.resolve(window.pdfMake);if(!pdfLoader)pdfLoader=loadScript('/js/vendor/pdfmake/pdfmake.min.js').then(function(){return loadScript('/js/vendor/pdfmake/vfs_fonts.js');}).then(function(){if(!window.pdfMake||!window.pdfMake.createPdf)throw new Error('PDF support is unavailable.');return window.pdfMake;});return pdfLoader;}
  function identityImage(value,size,weight){var canvas=document.createElement('canvas'),ctx=canvas.getContext('2d'),scale=3;ctx.font=weight+' '+(size*scale)+'px Inter, Segoe UI, sans-serif';var width=Math.ceil(ctx.measureText(value).width+8*scale),height=Math.ceil(size*1.45*scale);canvas.width=width;canvas.height=height;ctx.font=weight+' '+(size*scale)+'px Inter, Segoe UI, sans-serif';ctx.fillStyle='#111827';ctx.textBaseline='top';ctx.fillText(value,4*scale,0);return{data:canvas.toDataURL('image/png'),width:width/scale};}
  function pdfBlob(estimate){return ensurePdfMake().then(function(pdfMake){var issuer=identityImage(estimate.issuer.name,21,'700'),customer=identityImage(estimate.customer.name,10,'700'),images={issuer:issuer.data,issuerWidth:issuer.width,customer:customer.data,customerWidth:customer.width};return new Promise(function(resolve,reject){try{pdfMake.createPdf(pdfDefinition(estimate,images)).getBlob(resolve);}catch(error){reject(error);}});});}

  function canvasBlob(estimate) {
    var width=1600,padding=110,scale=2,measure=document.createElement('canvas').getContext('2d'),body=documentLines(estimate),wrapped=[];body.forEach(function(line){measure.font=(line.bold?'700 ':'400 ')+(line.size*scale)+'px Inter, Segoe UI, sans-serif';if(line.text.indexOf('|')>=0){var parts=line.text.split('|'),amountText=parts.slice(1).join('|'),labelRows=wrapCanvas(measure,parts[0],width-padding*2-360);labelRows.forEach(function(value,index){wrapped.push({...line,text:value+'|'+(index===0?amountText:'')});});return;}wrapCanvas(measure,line.text,width-padding*2).forEach(function(value){wrapped.push({...line,text:value});});});var height=Math.max(2100,240+wrapped.reduce(function(sum,line){return sum+(line.signature?0:line.gap*scale);},0));var canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;var ctx=canvas.getContext('2d');ctx.fillStyle='#fbfaf7';ctx.fillRect(0,0,width,height);ctx.strokeStyle='#b58c32';ctx.lineWidth=4;roundRect(ctx,50,50,width-100,height-100,34);ctx.stroke();var y=150;wrapped.forEach(function(line){ctx.font=(line.bold?'700 ':'400 ')+(line.size*scale)+'px Inter, Segoe UI, sans-serif';ctx.fillStyle=line.color==='gold'?'#8a681d':line.muted||line.signature?'#69707d':'#111827';if(line.signature){ctx.textAlign='right';ctx.fillText(line.text,width-padding,height-85);ctx.textAlign='left';return;}if(line.text.indexOf('|')>=0){var parts=line.text.split('|');ctx.textAlign='left';ctx.fillText(parts[0],padding,y);if(parts.slice(1).join('|')){ctx.textAlign='right';ctx.fillText(parts.slice(1).join('|'),width-padding,y);ctx.textAlign='left';}}else{ctx.fillText(line.text,padding,y);}y+=line.gap*scale;});return new Promise(function(resolve,reject){canvas.toBlob(function(blob){if(blob)resolve(blob);else reject(new Error('Image unavailable'));},'image/png');});
  }
  function wrapCanvas(ctx,value,max){var words=safeText(value).split(/\s+/).filter(Boolean),rows=[],current='';function split(word){var parts=[],piece='';Array.from(word).forEach(function(character){var next=piece+character;if(piece&&ctx.measureText(next).width>max){parts.push(piece);piece=character;}else piece=next;});if(piece)parts.push(piece);return parts;}words.forEach(function(word){var pieces=split(word);pieces.forEach(function(piece,index){var join=current&&index===0?current+' '+piece:piece;if(current&&index===0&&ctx.measureText(join).width<=max){current=join;}else{if(current)rows.push(current);current=piece;}if(index<pieces.length-1){rows.push(current);current='';}});});if(current)rows.push(current);return rows.length?rows:[''];}
  function roundRect(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
  function save(blob,name){var url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();setTimeout(function(){URL.revokeObjectURL(url);},1000);}

  function open(estimate, returnFocus) {
    var overlay=append(document.body,'div','customer-estimate-overlay');overlay.setAttribute('role','presentation');var dialog=append(overlay,'section','customer-estimate-dialog');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','customerEstimateDialogTitle');dialog.tabIndex=-1;
    var bar=append(dialog,'div','customer-estimate-dialog-bar');var title=append(bar,'h2','', 'Customer estimate preview');title.id='customerEstimateDialogTitle';var close=append(bar,'button','customer-estimate-close','×');close.type='button';close.setAttribute('aria-label','Close customer estimate preview');
    var body=append(dialog,'div','customer-estimate-dialog-body');body.appendChild(estimateCard(estimate));var actions=append(dialog,'div','customer-estimate-dialog-actions');var pdf=append(actions,'button','btn btn-secondary','Download PDF');pdf.type='button';var image=append(actions,'button','btn btn-secondary','Download image');image.type='button';var defaultNote=estimate.state==='preview'?'Downloads are previews. Nothing is sent to the customer.':'Downloads match this issued estimate.',note=append(actions,'p','',defaultNote);note.setAttribute('role','status');note.setAttribute('aria-live','polite');
    function keyboard(event){if(!overlay.isConnected)return;if(event.key==='Escape'){event.preventDefault();shut();return;}if(event.key!=='Tab')return;var controls=Array.prototype.slice.call(dialog.querySelectorAll('button:not([disabled]),summary,[href],[tabindex]:not([tabindex="-1"])'));if(!controls.length)return;var first=controls[0],last=controls[controls.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
    function shut(){document.removeEventListener('keydown',keyboard);overlay.remove();document.body.classList.remove('customer-estimate-open');if(returnFocus&&returnFocus.isConnected)returnFocus.focus();}close.onclick=shut;overlay.onclick=function(event){if(event.target===overlay)shut();};document.addEventListener('keydown',keyboard);pdf.onclick=function(){pdf.disabled=true;note.textContent='Preparing the PDF…';pdfBlob(estimate).then(function(blob){save(blob,estimate.reference+'.pdf');note.textContent=defaultNote;}).catch(function(){note.textContent='The PDF could not be prepared. Try again.';}).finally(function(){pdf.disabled=false;});};image.onclick=function(){image.disabled=true;note.textContent='Preparing the image…';canvasBlob(estimate).then(function(blob){save(blob,estimate.reference+'.png');note.textContent=defaultNote;}).catch(function(){note.textContent='The image could not be prepared. Try again.';}).finally(function(){image.disabled=false;});};document.body.classList.add('customer-estimate-open');close.focus();
  }

  function route(review) { var id=encodeURIComponent(review.pins.estimateId);return (review.simulated?'/api/demo/command-center/estimates/':'/api/v1/canonical/estimates/')+id+'/customer-estimate-preview'; }
  function mount(review, host) {
    if(!host||!review||!review.commercialTerms||!review.commercialTerms.customerSummary)return null;
    var section=append(host,'section','customer-estimate-launch');append(section,'p','customer-estimate-kicker','Customer document');append(section,'h4','', 'Share a clear estimate');append(section,'p','', 'Preview the customer-safe version and download a matching PDF or image. Nothing is sent from this preview.');var button=append(section,'button','btn btn-primary','Preview Customer Estimate');button.type='button';var status=append(section,'p','customer-estimate-launch-status','');status.setAttribute('role','status');status.setAttribute('aria-live','polite');button.onclick=function(){button.disabled=true;status.textContent='Preparing the customer estimate…';window.NorthStarAccountSession.fetch(route(review),{cache:'no-store'}).then(function(response){return response.json().catch(function(){return{};}).then(function(body){if(!response.ok)throw{status:response.status,message:body.error&&body.error.message};return body.data;});}).then(function(estimate){status.textContent='';open(estimate,button);}).catch(function(error){status.textContent=error&&error.message||'The customer estimate is unavailable. Refresh the saved estimate and try again.';}).finally(function(){button.disabled=false;});};return section;
  }

  return { money:money, presentationRows:presentationRows, pdfDefinition:pdfDefinition, mount:mount };
}));
