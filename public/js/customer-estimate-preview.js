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
    var scope = append(card,'section','customer-estimate-scope'); append(scope,'p','customer-estimate-label customer-estimate-section-label', 'Project scope'); append(scope,'p','',estimate.work.scope);
    var cost = append(card,'section','customer-estimate-costs'); append(cost,'p','customer-estimate-label customer-estimate-section-label', 'Estimate');
    presentationRows(estimate).forEach(function (row) { var line=append(cost,'div','customer-estimate-row customer-estimate-'+row.kind);append(line,'span','',row.label);append(line,'strong','',row.amount); });
    if ((estimate.payments || []).length) { var payments=append(card,'section','customer-estimate-payments');append(payments,'p','customer-estimate-label customer-estimate-section-label', 'Payment schedule');(estimate.payments||[]).forEach(function(row){var line=append(payments,'div','customer-estimate-row');append(line,'span','',row.label);append(line,'strong','',money(row.amount,estimate.currency));}); }
    append(card,'p','customer-estimate-notice',estimate.notice);
    var footer = append(card,'footer','customer-estimate-signature');var mark=append(footer,'img','customer-estimate-mark');mark.src='/assets/logo.png';mark.alt='';append(footer,'span','',estimate.platformSignature);
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
    wrap(estimate.notice,78).forEach(function(v){lines.push({text:v,size:8,gap:12,muted:true});});lines.push({text:estimate.platformSignature,size:8,gap:12,signature:true});return lines;
  }

  function pdfDefinition(estimate, identityImages) {
    function breakLongTokens(value,limit){return safeText(value).split(/(\s+)/).map(function(token){if(/^\s+$/.test(token)||Array.from(token).length<=limit)return token;var characters=Array.from(token),pieces=[];while(characters.length)pieces.push(characters.splice(0,limit).join(''));return pieces.join('\u200b');}).join('');}
    var issuer=[estimate.issuer.phone,estimate.issuer.email,estimate.issuer.website,estimate.issuer.address].filter(Boolean).join(' · '),rows=presentationRows(estimate).map(function(row){return [{text:breakLongTokens(row.label,36),bold:row.kind==='total',noWrap:false},{text:row.amount,bold:row.kind==='total',alignment:'right',noWrap:true}];});
    var issuerName=identityImages&&identityImages.issuer?{image:identityImages.issuer,width:Math.min(300,identityImages.issuerWidth),margin:[0,2,0,0]}:{text:estimate.issuer.name,style:'brand'};
    var customerName=identityImages&&identityImages.customer?{image:identityImages.customer,width:Math.min(220,identityImages.customerWidth),margin:[0,5,0,0]}:{text:estimate.customer.name,bold:true,margin:[0,5,0,0]};
    var content=[{text:'ESTIMATE',style:'kicker'},{columns:[issuerName,{stack:[{text:estimate.reference,bold:true,alignment:'right'},{text:estimate.state==='preview'?'Preview':'Issued',color:'#8a681d',alignment:'right',margin:[0,4,0,0]}]}],margin:[0,0,0,8]}];
    if(issuer)content.push({text:issuer,style:'muted',margin:[0,0,0,22]});
    content.push({columns:[{stack:[{text:'PREPARED FOR',style:'kicker'},customerName,{text:estimate.customer.address||'',style:'muted',margin:[0,4,0,0]}]},{stack:[{text:'WORK',style:'kicker'},{text:estimate.work.title,bold:true,margin:[0,5,0,0]}]}],columnGap:24,margin:[0,0,0,22]});
    content.push({text:'PROJECT SCOPE',style:'kicker'},{text:estimate.work.scope,margin:[0,6,0,22]},{text:'ESTIMATE',style:'kicker'},{table:{widths:['*',90],body:rows},layout:{hLineWidth:function(index,node){return index===rows.length-1?1.5:index===rows.length-2||index===estimate.charges.length+estimate.adjustments.length?0.5:0;},hLineColor:function(){return'#b58c32';},vLineWidth:function(){return 0;},paddingTop:function(){return 7;},paddingBottom:function(){return 7;},paddingLeft:function(){return 0;},paddingRight:function(){return 0;}}});
    if((estimate.payments||[]).length)content.push({text:'PAYMENT SCHEDULE',style:'kicker',margin:[0,22,0,6]},{table:{widths:['*',90],body:estimate.payments.map(function(row){return [{text:breakLongTokens(row.label,36),noWrap:false},{text:money(row.amount,estimate.currency),alignment:'right',noWrap:true}];})},layout:'noBorders'});
    content.push({text:estimate.notice,style:'notice',margin:[0,22,0,0]});
    return {info:{title:'Estimate for '+estimate.customer.name,author:estimate.issuer.name,subject:estimate.work.title},pageSize:'LETTER',pageMargins:[54,54,54,54],background:function(_page,size){return{canvas:[{type:'rect',x:28,y:28,w:size.width-56,h:size.height-56,r:10,lineColor:'#b58c32',lineWidth:1.5}]};},footer:function(){var signature=[{text:estimate.platformSignature,width:'auto',color:'#69707d',fontSize:10,bold:true}];if(identityImages&&identityImages.brandMark)signature.unshift({image:identityImages.brandMark,width:16,height:16,margin:[0,-3,7,0]});signature.unshift({text:''});return{columns:signature,columnGap:0,margin:[54,0,54,27]};},content:content,defaultStyle:{font:'Roboto',fontSize:10,color:'#111827',lineHeight:1.35},styles:{kicker:{fontSize:8,bold:true,color:'#8a681d',characterSpacing:1.1},brand:{fontSize:21,bold:true},muted:{fontSize:9,color:'#69707d'},notice:{fontSize:8,color:'#69707d'}}};
  }
  var pdfLoader=null,pdfFontsReady=false;
  function loadScript(source){return new Promise(function(resolve,reject){var script=document.createElement('script');script.src=source;script.onload=resolve;script.onerror=function(){reject(new Error('PDF support could not be loaded.'));};document.head.appendChild(script);});}
  function ensurePdfMake(){if(window.pdfMake&&window.pdfMake.createPdf&&pdfFontsReady)return Promise.resolve(window.pdfMake);if(!pdfLoader){var runtime=window.pdfMake&&window.pdfMake.createPdf?Promise.resolve():loadScript('/js/vendor/pdfmake/pdfmake.min.js');pdfLoader=runtime.then(function(){if(pdfFontsReady)return null;return loadScript('/js/vendor/pdfmake/vfs_fonts.js').then(function(){pdfFontsReady=true;});}).then(function(){if(!window.pdfMake||!window.pdfMake.createPdf||!pdfFontsReady)throw new Error('PDF support is unavailable.');return window.pdfMake;}).catch(function(error){pdfLoader=null;throw error;});}return pdfLoader;}
  function identityImage(value,size,weight){var canvas=document.createElement('canvas'),ctx=canvas.getContext('2d'),scale=3,stack='-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';ctx.font=weight+' '+(size*scale)+'px '+stack;var width=Math.ceil(ctx.measureText(value).width+8*scale),height=Math.ceil(size*1.45*scale);canvas.width=width;canvas.height=height;ctx.font=weight+' '+(size*scale)+'px '+stack;ctx.fillStyle='#111827';ctx.textBaseline='top';ctx.fillText(value,4*scale,0);return{data:canvas.toDataURL('image/png'),width:width/scale};}
  var brandLoader=null;
  function brandImage(){if(!brandLoader)brandLoader=new Promise(function(resolve,reject){var mark=new Image();mark.onload=function(){resolve(mark);};mark.onerror=function(){brandLoader=null;reject(new Error('NorthStar mark is unavailable.'));};mark.src='/assets/logo.png?customer-estimate-export=1';});return brandLoader;}
  function drawBrandMark(ctx,mark,x,y,size){var crop=Math.min(mark.naturalWidth,mark.naturalHeight),sourceX=(mark.naturalWidth-crop)/2,sourceY=Math.max(0,(mark.naturalHeight-crop)*.43);ctx.drawImage(mark,sourceX,sourceY,crop,crop,x,y,size,size);}
  function brandData(mark){var canvas=document.createElement('canvas');canvas.width=96;canvas.height=96;var ctx=canvas.getContext('2d');drawBrandMark(ctx,mark,0,0,96);return canvas.toDataURL('image/png');}
  function pdfBlob(estimate){return Promise.all([ensurePdfMake(),brandImage()]).then(function(values){var pdfMake=values[0],issuer=identityImage(estimate.issuer.name,21,'700'),customer=identityImage(estimate.customer.name,10,'700'),images={issuer:issuer.data,issuerWidth:issuer.width,customer:customer.data,customerWidth:customer.width,brandMark:brandData(values[1])};return new Promise(function(resolve,reject){try{pdfMake.createPdf(pdfDefinition(estimate,images)).getBlob(resolve);}catch(error){reject(error);}});});}

  function canvasBlob(estimate) {
    return brandImage().then(function(mark){
      var width=1600,outer=64,padding=112,contentWidth=width-padding*2;
      var measure=document.createElement('canvas').getContext('2d');
      function font(size,weight){return (weight||'400')+' '+size+'px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';}
      function rows(value,size,weight,maximum){measure.font=font(size,weight);return wrapCanvas(measure,value,maximum||contentWidth);}
      var contact=rows([estimate.issuer.phone,estimate.issuer.email,estimate.issuer.website,estimate.issuer.address].filter(Boolean).join(' · '),23,'400');
      var scope=rows(estimate.work.scope,27,'400');
      var costRows=presentationRows(estimate).map(function(row){var labels=rows(row.label,row.kind==='total'?30:26,row.kind==='total'?'700':'400',contentWidth-350);return{row:row,labels:labels,height:Math.max(row.kind==='total'?82:64,labels.length*36+24)};});
      var paymentRows=(estimate.payments||[]).map(function(row){return{label:rows(row.label,25,'400',contentWidth-350),amount:money(row.amount,estimate.currency)};});
      var notice=rows(estimate.notice,20,'400');
      var headerHeight=190+contact.length*32,introHeight=190,scopeHeight=105+scope.length*39;
      var costsHeight=105+costRows.reduce(function(sum,item){return sum+item.height;},0)+26;
      var paymentsHeight=paymentRows.length?105+paymentRows.reduce(function(sum,item){return sum+Math.max(58,item.label.length*32+20);},0)+20:0;
      var noticeHeight=notice.length*29+50,footerHeight=90;
      var height=outer+headerHeight+30+introHeight+34+scopeHeight+34+costsHeight+(paymentsHeight?34+paymentsHeight:0)+28+noticeHeight+footerHeight+outer;
      var canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;var ctx=canvas.getContext('2d');
      ctx.fillStyle='#fbfaf7';ctx.fillRect(0,0,width,height);ctx.strokeStyle='#b58c32';ctx.lineWidth=4;roundRect(ctx,outer,outer,width-outer*2,height-outer*2,34);ctx.stroke();
      function text(value,x,y,size,weight,color,align){ctx.font=font(size,weight);ctx.fillStyle=color||'#111827';ctx.textAlign=align||'left';ctx.textBaseline='alphabetic';ctx.fillText(value,x,y);}
      function kicker(value,x,y){text(value.toUpperCase(),x,y,20,'800','#8a681d');}
      function divider(y){ctx.strokeStyle='#ded2b8';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(padding,y);ctx.lineTo(width-padding,y);ctx.stroke();}
      function card(x,y,w,h,fill){ctx.fillStyle=fill||'#f7f3eb';roundRect(ctx,x,y,w,h,22);ctx.fill();ctx.strokeStyle='#ded2b8';ctx.lineWidth=2;ctx.stroke();}
      var y=136;kicker('Estimate',padding,y);text(estimate.issuer.name,padding,y+61,50,'700');
      text(estimate.reference,width-padding,y+18,24,'700','#111827','right');
      text(estimate.state==='preview'?'Preview':'Issued',width-padding,y+58,22,'600','#8a681d','right');
      var contactY=y+116;contact.forEach(function(line){text(line,padding,contactY,23,'400','#69707d');contactY+=32;});
      y=outer+headerHeight;divider(y);y+=30;
      var gap=28,column=(contentWidth-gap)/2;card(padding,y,column,introHeight,'#f5f1e8');card(padding+column+gap,y,column,introHeight,'#f5f1e8');
      kicker('Prepared for',padding+30,y+48);text(estimate.customer.name,padding+30,y+94,30,'700');
      var customerAddress=rows(estimate.customer.address||'',23,'400',column-60),addressY=y+132;customerAddress.forEach(function(line){text(line,padding+30,addressY,23,'400','#5f6774');addressY+=30;});
      kicker('Work',padding+column+gap+30,y+48);var workRows=rows(estimate.work.title,30,'700',column-60),workY=y+94;workRows.forEach(function(line){text(line,padding+column+gap+30,workY,30,'700');workY+=38;});
      y+=introHeight+34;kicker('Project scope',padding,y+22);var scopeY=y+70;scope.forEach(function(line){text(line,padding,scopeY,27,'400');scopeY+=39;});y+=scopeHeight+34;
      kicker('Estimate',padding,y+22);var costTop=y+58;card(padding,costTop,contentWidth,costsHeight-58,'#ffffff');var rowY=costTop+24;
      costRows.forEach(function(item,index){var isTotal=item.row.kind==='total';if(isTotal){ctx.fillStyle='#f4ead1';ctx.fillRect(padding+2,rowY,contentWidth-4,item.height);}var baseline=rowY+40,labelY=baseline;item.labels.forEach(function(line){text(line,padding+28,labelY,isTotal?30:26,isTotal?'700':'400');labelY+=36;});text(item.row.amount,width-padding-28,baseline,isTotal?34:27,isTotal?'800':'650',isTotal?'#8a681d':'#111827','right');rowY+=item.height;if(index<costRows.length-1){ctx.strokeStyle=isTotal?'#b58c32':'#ece5d8';ctx.lineWidth=isTotal?2:1;ctx.beginPath();ctx.moveTo(padding+28,rowY);ctx.lineTo(width-padding-28,rowY);ctx.stroke();}});y+=costsHeight+34;
      if(paymentRows.length){kicker('Payment schedule',padding,y+22);var paymentTop=y+58;card(padding,paymentTop,contentWidth,paymentsHeight-58,'#f7f3eb');var paymentY=paymentTop+24;paymentRows.forEach(function(item,index){var itemHeight=Math.max(58,item.label.length*32+20),lineY=paymentY+38;item.label.forEach(function(line){text(line,padding+28,lineY,25,'400');lineY+=32;});text(item.amount,width-padding-28,paymentY+38,26,'650','#111827','right');paymentY+=itemHeight;if(index<paymentRows.length-1){ctx.strokeStyle='#ded2b8';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(padding+28,paymentY);ctx.lineTo(width-padding-28,paymentY);ctx.stroke();}});y+=paymentsHeight+28;}
      card(padding,y,contentWidth,noticeHeight,'#f4f0e7');var noticeY=y+34;notice.forEach(function(line){text(line,padding+28,noticeY,20,'400','#646b76');noticeY+=29;});
      var signatureY=height-outer-40;text(estimate.platformSignature,width-padding,signatureY,24,'600','#69707d','right');var signatureWidth=ctx.measureText(estimate.platformSignature).width,markSize=44;drawBrandMark(ctx,mark,width-padding-signatureWidth-markSize-16,signatureY-35,markSize);
      return new Promise(function(resolve,reject){canvas.toBlob(function(blob){if(blob)resolve(blob);else reject(new Error('Image unavailable'));},'image/png');});
    });
  }
  function wrapCanvas(ctx,value,max){var words=safeText(value).split(/\s+/).filter(Boolean),rows=[],current='';function split(word){var parts=[],piece='';Array.from(word).forEach(function(character){var next=piece+character;if(piece&&ctx.measureText(next).width>max){parts.push(piece);piece=character;}else piece=next;});if(piece)parts.push(piece);return parts;}words.forEach(function(word){var pieces=split(word);pieces.forEach(function(piece,index){var join=current&&index===0?current+' '+piece:piece;if(current&&index===0&&ctx.measureText(join).width<=max){current=join;}else{if(current)rows.push(current);current=piece;}if(index<pieces.length-1){rows.push(current);current='';}});});if(current)rows.push(current);return rows.length?rows:[''];}
  function roundRect(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
  function save(blob,name){var url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();setTimeout(function(){URL.revokeObjectURL(url);},1000);}

  function open(estimate, returnFocus) {
    var overlay=append(document.body,'div','customer-estimate-overlay');overlay.setAttribute('role','presentation');var dialog=append(overlay,'section','customer-estimate-dialog');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','customerEstimateDialogTitle');dialog.tabIndex=-1;
    var bar=append(dialog,'div','customer-estimate-dialog-bar');var title=append(bar,'h2','', 'Customer Estimate Preview');title.id='customerEstimateDialogTitle';var close=append(bar,'button','customer-estimate-close','×');close.type='button';close.setAttribute('aria-label','Close customer estimate preview');
    var body=append(dialog,'div','customer-estimate-dialog-body');body.appendChild(estimateCard(estimate));var actions=append(dialog,'div','customer-estimate-dialog-actions');var pdf=append(actions,'button','btn btn-secondary','Download PDF');pdf.type='button';var image=append(actions,'button','btn btn-secondary','Download image');image.type='button';var defaultNote=estimate.state==='preview'?'Downloads are previews. Nothing is sent to the customer.':'Downloads match this issued estimate.',note=append(actions,'p','',defaultNote);note.setAttribute('role','status');note.setAttribute('aria-live','polite');
    function keyboard(event){if(!overlay.isConnected)return;if(event.key==='Escape'){event.preventDefault();shut();return;}if(event.key!=='Tab')return;var controls=Array.prototype.slice.call(dialog.querySelectorAll('button:not([disabled]),summary,[href],[tabindex]:not([tabindex="-1"])'));if(!controls.length)return;var first=controls[0],last=controls[controls.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
    function shut(){document.removeEventListener('keydown',keyboard);overlay.remove();document.body.classList.remove('customer-estimate-open');if(returnFocus&&returnFocus.isConnected)returnFocus.focus();}close.onclick=shut;overlay.onclick=function(event){if(event.target===overlay)shut();};document.addEventListener('keydown',keyboard);pdf.onclick=function(){pdf.disabled=true;note.textContent='Preparing the PDF…';pdfBlob(estimate).then(function(blob){save(blob,estimate.reference+'.pdf');note.textContent=defaultNote;}).catch(function(){note.textContent='The PDF could not be prepared. Try again.';}).finally(function(){pdf.disabled=false;});};image.onclick=function(){image.disabled=true;note.textContent='Preparing the image…';canvasBlob(estimate).then(function(blob){save(blob,estimate.reference+'.png');note.textContent=defaultNote;}).catch(function(){note.textContent='The image could not be prepared. Try again.';}).finally(function(){image.disabled=false;});};document.body.classList.add('customer-estimate-open');close.focus();
  }

  function route(review) { var id=encodeURIComponent(review.pins.estimateId);return (review.simulated?'/api/demo/command-center/estimates/':'/api/v1/canonical/estimates/')+id+'/customer-estimate-preview'; }
  function versionRoute(review){var id=encodeURIComponent(review.pins.estimateId);return(review.simulated?'/api/demo/command-center/estimates/':'/api/v1/canonical/estimates/')+id+'/customer-estimate-versions';}
  function responseData(response){return response.json().catch(function(){return{};}).then(function(body){if(!response.ok)throw{status:response.status,category:body.error&&body.error.category,message:body.error&&body.error.message};return body.data;});}
  function mount(review, host) {
    if(!host||!review)return null;
    var commercial=review.commercialTerms||{},ready=!!(commercial.customerSummary&&commercial.approvalState==='commercial_approved'&&commercial.binding&&commercial.current&&commercial.current.current===true);
    var section=append(host,'section','customer-estimate-launch');section.dataset.state=ready?'ready':'needs-review';append(section,'p','customer-estimate-kicker',ready?'Customer estimate':'Estimate');var heading=append(section,'h4','',ready?'Customer estimate ready':'Estimate needs review'),description=append(section,'p','',ready?'Preview the customer version, then issue an immutable version when it is ready. Issuing does not send it.':'Continue the estimate from one place. NorthStar will show the remaining review needed before a customer version can be issued.'),actions=append(section,'div','customer-estimate-launch-actions');var preview=append(actions,'button','btn btn-secondary',ready?'Preview Customer Estimate':'Continue Estimate');preview.type='button';var issue=ready?append(actions,'button','btn btn-primary','Issue Estimate'):null;if(issue)issue.type='button';var status=append(section,'p','customer-estimate-launch-status',ready?'Checking issued versions…':'');status.setAttribute('role','status');status.setAttribute('aria-live','polite');var historyHost=append(section,'div','customer-estimate-version-history');
    var external=document.getElementById('cdBtnEstimate'),externalStatus=document.getElementById('cdEstimateActionStatus');
    function externalState(label){if(!external)return;external.disabled=false;external.setAttribute('aria-label','Estimate, '+label.toLowerCase());if(externalStatus)externalStatus.textContent=label;}
    if(external){external.onclick=function(){preview.click();};externalState(ready?'Ready':'Needs review');}
    function goToReview(){var target=document.getElementById('cdEstimateDetails');if(target){target.open=true;var next=document.getElementById(commercial.sources&&commercial.sources.pricingCurrent?'cdCommercialTerms':'cdPreparedAdoption')||target.querySelector('summary,button');if(next&&next.tagName==='DETAILS')next.open=true;var focus=next&&next.querySelector?next.querySelector('summary,button,input,select'):next;if(focus){focus.focus();focus.scrollIntoView({block:'nearest'});}}status.textContent='Review the highlighted estimate step below.';}
    function showEstimate(button,estimate,note){open(estimate,button);status.textContent=note||'Customer estimate ready.';}
    preview.onclick=function(){if(!ready){goToReview();return;}preview.disabled=true;status.textContent='Preparing the customer estimate…';window.NorthStarAccountSession.fetch(route(review),{cache:'no-store'}).then(responseData).then(function(estimate){showEstimate(preview,estimate,'Preview ready. Nothing was sent.');}).catch(function(error){status.textContent=error&&error.message||'The customer estimate is unavailable. Refresh the saved estimate and try again.';}).finally(function(){preview.disabled=false;});};
    function renderHistory(data){historyHost.replaceChildren();var current=data&&data.current,match=!!(current&&current.approvalPin&&commercial.binding&&current.approvalPin.id===commercial.binding.id);if(current){heading.textContent=match?'Estimate issued':'New estimate revision ready';description.textContent=match?'Version '+current.revision+' is saved and cannot be altered. Delivery has not been recorded.':'An earlier version remains saved. Review and issue the newly approved revision when ready.';if(match){externalState('Issued');external.onclick=function(){showEstimate(external,current.document,'Viewing issued version '+current.revision+'.');};issue.textContent='View Issued Estimate';issue.className='btn btn-primary';issue.onclick=function(){showEstimate(issue,current.document,'Viewing issued version '+current.revision+'.');};}else issue.textContent='Issue New Version';var details=append(historyHost,'details','customer-estimate-history');append(details,'summary','',data.total+' issued '+(data.total===1?'version':'versions'));(data.history||[]).forEach(function(version){var row=append(details,'div','customer-estimate-history-row');var view=append(row,'button','btn btn-secondary','Version '+version.revision);view.type='button';view.onclick=function(){showEstimate(view,version.document,'Viewing issued version '+version.revision+'.');};append(row,'span','',new Date(version.createdAt).toLocaleString());});}else status.textContent='Ready to preview or issue.';if(issue&&!match)issue.onclick=beginIssue;}
    function beginIssue(){historyHost.querySelector('.customer-estimate-issue-form')?.remove();var form=append(historyHost,'form','customer-estimate-issue-form');append(form,'h5','','Issue this estimate');append(form,'p','','This saves an immutable customer version. It does not send the estimate or record customer acceptance.');var label=append(form,'label');append(label,'span','','Reason for issuing');var reason=append(label,'input');reason.type='text';reason.required=true;reason.maxLength=1000;reason.value='Approved customer estimate';var confirmation=append(form,'label','drawer-decision-confirmation');var checkbox=append(confirmation,'input');checkbox.type='checkbox';checkbox.required=true;append(confirmation,'span','','I reviewed the customer-facing scope, price, tax, total and payment schedule.');var formActions=append(form,'div','customer-estimate-launch-actions'),confirm=append(formActions,'button','btn btn-primary','Confirm Issue');confirm.type='submit';var cancel=append(formActions,'button','btn btn-secondary','Cancel');cancel.type='button';cancel.onclick=function(){form.remove();issue.focus();};form.onsubmit=function(event){event.preventDefault();if(!form.reportValidity())return;var headers={'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()};if(review.simulated){headers['X-NorthStar-Demo-Revision']=String(review.demoWorkspaceRevision);headers['X-NorthStar-Demo-Intent']='customer-estimate-issue';}confirm.disabled=true;issue.disabled=true;preview.disabled=true;status.textContent='Issuing the customer estimate…';window.NorthStarAccountSession.fetch(versionRoute(review),{method:'POST',headers:headers,body:JSON.stringify({reason:reason.value,confirmed:true,confirmationVersion:'customer-estimate-issue-v1'})}).then(responseData).then(function(data){form.remove();if(data&&data.receipt){renderHistory({current:data.receipt,history:[data.receipt],total:1});showEstimate(issue,data.receipt.document,'Issued version '+data.receipt.revision+' is saved. Nothing was sent.');loadHistory();}else return loadHistory();}).catch(function(error){status.textContent=error&&error.message||'The issue result is unconfirmed. Refresh to check issued versions before retrying.';}).finally(function(){confirm.disabled=false;issue.disabled=false;preview.disabled=false;});};reason.focus();}
    function loadHistory(){if(!ready)return Promise.resolve();return window.NorthStarAccountSession.fetch(versionRoute(review),{cache:'no-store'}).then(responseData).then(renderHistory).catch(function(error){status.textContent=error&&error.message||'Issued-version history is unavailable. You can still preview the current estimate.';});}
    if(ready){issue.onclick=beginIssue;loadHistory();}return section;
  }

  return { money:money, presentationRows:presentationRows, pdfDefinition:pdfDefinition, mount:mount };
}));
