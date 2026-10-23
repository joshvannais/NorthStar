(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NorthStarCustomerFinancialInvoicePreview = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var mountGeneration = 0, activeDemoMount = null, activeDisclosureMount = null;
  function node(tag, text, parent, className) {
    var value = document.createElement(tag); if (text !== undefined) value.textContent = text;
    if (parent) parent.appendChild(value); if (className) value.className = className; return value;
  }
  function uuid() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    var bytes = new Uint8Array(16); crypto.getRandomValues(bytes); bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128; var hex = Array.prototype.map.call(bytes,
      function (value) { return value.toString(16).padStart(2, '0'); }).join('');
    return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
  }
  function request(url, options) {
    var fetcher = window.NorthStarAccountSession && window.NorthStarAccountSession.fetch || window.fetch;
    var settings = Object.assign({ cache: 'no-store', headers: { Accept: 'application/json' } }, options || {});
    settings.headers = Object.assign({ Accept: 'application/json' }, settings.headers || {});
    return fetcher.call(window.NorthStarAccountSession || window, url, settings).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        if (!response.ok || !body.success) throw { status: response.status,
          message: body.error && body.error.message };
        return body.data;
      });
    });
  }
  function post(url, body) {
    return request(url, { method: 'POST', headers: { 'Content-Type': 'application/json',
      'Idempotency-Key': uuid() }, body: JSON.stringify(body) });
  }
  function money(value) {
    if (!value || value.currency !== 'USD' || value.minorUnitExponent !== 2 ||
        !/^-?(0|[1-9][0-9]{0,15})$/.test(value.minorUnits || '') ||
        !/^-?(0|[1-9][0-9]{0,15})\.[0-9]{2}$/.test(value.decimal || '')) return 'Unavailable';
    var parts = value.decimal.split('.'), negative = parts[0][0] === '-', whole = negative ? parts[0].slice(1) : parts[0];
    return (negative ? '−$' : '$') + whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + parts[1];
  }
  function injectStyles() {
    if (document.getElementById('customerFinancialInvoicePreviewStyles')) return;
    var style = node('style'); style.id = 'customerFinancialInvoicePreviewStyles';
    style.textContent = '.invoice-draft-preview{margin-top:1rem;border:1px solid var(--border-color,#d6d7db);border-radius:14px;background:var(--surface,#fff);color:inherit}.invoice-draft-preview>summary{padding:1rem;font-weight:700;cursor:pointer}.invoice-draft-preview-body{padding:0 1rem 1rem}.invoice-draft-preview-status:focus,.invoice-draft-preview-heading:focus,.invoice-draft-preview button:focus,.invoice-draft-preview input:focus,.invoice-draft-preview textarea:focus,.invoice-draft-tax-evidence>summary:focus{outline:3px solid var(--focus-ring,#d0a847);outline-offset:3px}.invoice-draft-preview-document,.invoice-draft-workflow-step,.invoice-part5-acceptance,.invoice-part6-acceptance,.invoice-part7-acceptance{border:1px solid var(--border-color,#d6d7db);border-radius:12px;padding:1rem;background:var(--surface-subtle,#f7f5ef)}.invoice-draft-preview-demo{display:inline-block;padding:.25rem .55rem;border-radius:999px;background:#f3d57b;color:#241b00;font-weight:750}.invoice-draft-preview-lines{width:100%;border-collapse:collapse;margin:.75rem 0}.invoice-draft-preview-lines th,.invoice-draft-preview-lines td{padding:.55rem;text-align:left;border-bottom:1px solid var(--border-color,#d6d7db);vertical-align:top;overflow-wrap:anywhere}.invoice-draft-preview-lines th:last-child,.invoice-draft-preview-lines td:last-child{text-align:right}.invoice-draft-preview-totals{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.45rem 1rem;max-width:30rem;margin-left:auto}.invoice-draft-preview-totals dt{font-weight:650}.invoice-draft-preview-totals dd{margin:0;text-align:right}.invoice-draft-preview-boundary{padding:.75rem;border-radius:10px;background:var(--surface-subtle,#f4f1e9)}.invoice-draft-preview-actions{display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.75rem}.invoice-part5-acceptance,.invoice-part6-acceptance,.invoice-part7-acceptance{margin-top:1rem}.invoice-part5-gates,.invoice-part6-gates,.invoice-part7-gates{display:grid;grid-template-columns:minmax(9rem,auto) minmax(0,1fr);gap:.35rem .8rem}.invoice-part5-gates dt,.invoice-part6-gates dt,.invoice-part7-gates dt{font-weight:700}.invoice-part5-gates dd,.invoice-part6-gates dd,.invoice-part7-gates dd{margin:0;overflow-wrap:anywhere}.invoice-part5-axes,.invoice-part5-corrections,.invoice-part6-requirements,.invoice-part6-actions,.invoice-part7-requirements,.invoice-part7-methods,.invoice-part7-controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.35rem 1.2rem;padding-left:1.2rem}.invoice-part6-requirements li,.invoice-part6-actions li,.invoice-part7-requirements li,.invoice-part7-methods li,.invoice-part7-controls li{overflow-wrap:anywhere}.invoice-part5-subheading,.invoice-part6-subheading,.invoice-part7-subheading{margin-bottom:.4rem}.invoice-draft-workflow-form,.invoice-draft-workflow-field{display:grid;gap:.6rem}.invoice-draft-workflow-line{display:grid;grid-template-columns:minmax(9rem,1fr) minmax(12rem,2fr) auto;gap:.6rem;align-items:end;margin:.7rem 0}.invoice-draft-workflow-line label{display:grid;gap:.3rem}.invoice-draft-workflow-form textarea{min-height:5rem}.invoice-draft-tax-evidence{margin:.75rem 0;border-block:1px solid var(--border-color,#d6d7db);padding:.65rem 0}.invoice-draft-tax-evidence>summary{font-weight:700;cursor:pointer}.invoice-draft-tax-evidence dl{display:grid;grid-template-columns:minmax(10rem,auto) minmax(0,1fr);gap:.35rem .75rem}.invoice-draft-tax-evidence dt{font-weight:650}.invoice-draft-tax-evidence dd{margin:0;overflow-wrap:anywhere}.invoice-draft-tax-gaps{margin:.35rem 0}.invoice-draft-tax-provenance{max-width:24rem}@media(max-width:680px){.invoice-draft-preview{border-radius:10px}.invoice-draft-preview-lines thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}.invoice-draft-preview-lines tr{display:grid;padding:.65rem 0;border-bottom:1px solid var(--border-color,#d6d7db)}.invoice-draft-preview-lines td{display:flex;justify-content:space-between;gap:1rem;border:0;padding:.2rem 0;text-align:right}.invoice-draft-preview-lines td:before{content:attr(data-label);font-weight:650;text-align:left}.invoice-draft-preview-actions .btn{width:100%}.invoice-part5-gates,.invoice-part5-axes,.invoice-part5-corrections,.invoice-part6-gates,.invoice-part6-requirements,.invoice-part6-actions,.invoice-part7-gates,.invoice-part7-requirements,.invoice-part7-methods,.invoice-part7-controls{grid-template-columns:1fr}.invoice-draft-workflow-line{grid-template-columns:1fr}.invoice-draft-workflow-line .invoice-draft-workflow-amount{justify-self:start}.invoice-draft-tax-evidence dl{grid-template-columns:1fr}.invoice-draft-tax-evidence dd{margin-bottom:.45rem}}@media(forced-colors:active){.invoice-draft-preview,.invoice-draft-preview-document,.invoice-draft-workflow-step,.invoice-part5-acceptance,.invoice-part6-acceptance,.invoice-part7-acceptance{border:2px solid CanvasText}.invoice-draft-preview-demo{border:1px solid CanvasText}}';
    style.textContent += '.invoice-part9-acceptance{border:1px solid var(--border-color,#d6d7db);border-radius:12px;padding:1rem;background:var(--surface-subtle,#f7f5ef);margin-top:1rem}' +
      '.invoice-part9-gates{display:grid;grid-template-columns:minmax(9rem,auto) minmax(0,1fr);gap:.35rem .8rem}' +
      '.invoice-part9-gates dt{font-weight:700}.invoice-part9-gates dd{margin:0;overflow-wrap:anywhere}' +
      '.invoice-part9-sources,.invoice-part9-controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.35rem 1.2rem;padding-left:1.2rem}' +
      '.invoice-part9-sources li,.invoice-part9-controls li{overflow-wrap:anywhere}' +
      '@media(max-width:680px){.invoice-part9-gates,.invoice-part9-sources,.invoice-part9-controls{grid-template-columns:1fr}}' +
      '@media(forced-colors:active){.invoice-part9-acceptance{border:2px solid CanvasText}}';
    style.textContent += '.invoice-part10-acceptance{border:1px solid var(--border-color,#d6d7db);border-radius:12px;padding:1rem;background:var(--surface-subtle,#f7f5ef);margin-top:1rem}' +
      '.invoice-part10-gates{display:grid;grid-template-columns:minmax(9rem,auto) minmax(0,1fr);gap:.35rem .8rem}' +
      '.invoice-part10-gates dt{font-weight:700}.invoice-part10-gates dd{margin:0;overflow-wrap:anywhere}' +
      '.invoice-part10-sources,.invoice-part10-failures,.invoice-part10-revocations{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.35rem 1.2rem;padding-left:1.2rem}' +
      '.invoice-part10-sources li,.invoice-part10-failures li,.invoice-part10-revocations li{overflow-wrap:anywhere}' +
      '@media(max-width:680px){.invoice-part10-gates,.invoice-part10-sources,.invoice-part10-failures,.invoice-part10-revocations{grid-template-columns:1fr}}' +
      '@media(forced-colors:active){.invoice-part10-acceptance{border:2px solid CanvasText}}';
    style.textContent += '.invoice-part11-acceptance{border:1px solid var(--border-color,#d6d7db);border-radius:12px;padding:1rem;background:var(--surface-subtle,#f7f5ef);margin-top:1rem}' +
      '.invoice-part11-gates{display:grid;grid-template-columns:minmax(9rem,auto) minmax(0,1fr);gap:.35rem .8rem}' +
      '.invoice-part11-gates dt{font-weight:700}.invoice-part11-gates dd{margin:0;overflow-wrap:anywhere}' +
      '.invoice-part11-sources,.invoice-part11-boundaries{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.35rem 1.2rem;padding-left:1.2rem}' +
      '.invoice-part11-sources li,.invoice-part11-boundaries li{overflow-wrap:anywhere}' +
      '@media(max-width:680px){.invoice-part11-gates,.invoice-part11-sources,.invoice-part11-boundaries{grid-template-columns:1fr}}' +
      '@media(forced-colors:active){.invoice-part11-acceptance{border:2px solid CanvasText}}';
    style.textContent += '.invoice-part12-acceptance{border:1px solid var(--border-color,#d6d7db);border-radius:12px;padding:1rem;background:var(--surface-subtle,#f7f5ef);margin-top:1rem}' +
      '.invoice-part12-gates{display:grid;grid-template-columns:minmax(9rem,auto) minmax(0,1fr);gap:.35rem .8rem}' +
      '.invoice-part12-gates dt{font-weight:700}.invoice-part12-gates dd{margin:0;overflow-wrap:anywhere}' +
      '.invoice-part12-sources,.invoice-part12-drilldowns,.invoice-part12-boundaries{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.35rem 1.2rem;padding-left:1.2rem}' +
      '.invoice-part12-sources li,.invoice-part12-drilldowns li,.invoice-part12-boundaries li{overflow-wrap:anywhere}' +
      '@media(max-width:680px){.invoice-part12-gates,.invoice-part12-sources,.invoice-part12-drilldowns,.invoice-part12-boundaries{grid-template-columns:1fr}}' +
      '@media(forced-colors:active){.invoice-part12-acceptance{border:2px solid CanvasText}}';
    style.textContent += '.invoice-part14b-acceptance{border:2px solid #b88b17;border-radius:12px;padding:1rem;background:var(--surface-subtle,#f7f5ef);margin-top:1rem}' +
      '.invoice-part14b-gates{display:grid;grid-template-columns:minmax(9rem,auto) minmax(0,1fr);gap:.35rem .8rem}' +
      '.invoice-part14b-gates dt{font-weight:700}.invoice-part14b-gates dd{margin:0;overflow-wrap:anywhere}' +
      '.invoice-part14b-stages,.invoice-part14b-boundaries{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.35rem 1.2rem;padding-left:1.2rem}' +
      '.invoice-part14b-stages li,.invoice-part14b-boundaries li{overflow-wrap:anywhere}' +
      '@media(max-width:680px){.invoice-part14b-gates,.invoice-part14b-stages,.invoice-part14b-boundaries{grid-template-columns:1fr}}' +
      '@media(forced-colors:active){.invoice-part14b-acceptance{border:2px solid CanvasText}}';
    document.head.appendChild(style);
  }
  function exactObject(value, keys) {
    return value && typeof value === 'object' && !Array.isArray(value) &&
      Object.keys(value).length === keys.length &&
      Object.keys(value).every(function (key) { return keys.includes(key); });
  }
  function stableObject(value) {
    if (Array.isArray(value)) return value.map(stableObject);
    if (value && typeof value === 'object') return Object.keys(value).sort().reduce(function (result,key) {
      result[key]=stableObject(value[key]); return result;
    },{});
    return value;
  }
  function digestObject(value) {
    var cryptoApi=typeof globalThis!=='undefined'&&globalThis.crypto;
    if ((!cryptoApi||!cryptoApi.subtle)&&typeof require==='function') {
      cryptoApi=require('node:crypto').webcrypto;
    }
    if (!cryptoApi||!cryptoApi.subtle||typeof TextEncoder==='undefined') {
      return Promise.reject(new Error('Digest validation unavailable'));
    }
    var bytes=new TextEncoder().encode(JSON.stringify(stableObject(value)));
    return cryptoApi.subtle.digest('SHA-256',bytes).then(function(buffer){
      return Array.prototype.map.call(new Uint8Array(buffer),function(byte){
        return byte.toString(16).padStart(2,'0');
      }).join('');
    });
  }
  var PART14B_STAGE_NAMES=Object.freeze([
    'approved_estimate_selected','billable_handoff_projected','invoice_draft_reviewed',
    'invoice_issued_fictionally','secure_delivery_recorded_fictionally',
    'provider_session_disabled','provider_event_simulated_fictionally',
    'settlement_simulated_fictionally','customer_receipt_generated_fictionally',
    'correction_refund_dispute_simulated_fictionally',
    'receivable_collections_projected_fictionally','accounting_handoff_projected_fictionally',
    'downstream_reporting_projected_fictionally','offline_cash_received_fictionally',
    'offline_check_received_clearance_unknown_fictionally'
  ]);
  var PART14B_STAGE_STATES=Object.freeze([
    'fictional_current','fictional_current','fictional_reviewed','fictional_issued',
    'fictional_delivered','provider_disabled','fictional_event_recorded',
    'fictional_settlement_recorded','fictional_receipt_available','fictional_correction_recorded',
    'fictional_receivable_current','fictional_handoff_current','fictional_reporting_current',
    'offline_received','check_clearance_unknown'
  ]);
  var PART14B_STAGE_SOURCES=Object.freeze([
    ['m27-invoice-draft-preview-v1','current',null],
    ['m27-invoice-draft-preview-v1','current',null],
    ['m27-invoice-part5-acceptance-v1','unavailable','invoice_issue_authority_unavailable'],
    ['m27-invoice-issue-readiness-v1','unavailable','final_invoice_approval_unavailable'],
    ['m27-invoice-delivery-readiness-v1','unavailable','issued_invoice_unavailable'],
    ['m27-payment-part7-acceptance-v1','unavailable','provider_sandbox_evidence_unavailable'],
    ['m27-payment-part9-acceptance-v1','unavailable','part9_financial_evidence_unavailable'],
    ['m27-payment-part9-acceptance-v1','unavailable','part9_financial_evidence_unavailable'],
    ['m27-payment-part9-acceptance-v1','unavailable','source_authority_unavailable'],
    ['m27-payment-part9-acceptance-v1','unavailable','source_authority_unavailable'],
    ['m27-collection-part10-acceptance-v1','unavailable','part10_collection_evidence_unavailable'],
    ['m27-accounting-part11-acceptance-v1','unavailable','part11_accounting_evidence_unavailable'],
    ['m27-reporting-part12-acceptance-v1','incomplete','part12_reporting_evidence_incomplete'],
    ['m27-payment-part9-acceptance-v1','unavailable','source_authority_unavailable'],
    ['m27-payment-part9-acceptance-v1','unavailable','source_authority_unavailable']
  ]);
  var PART14B_GET_PROTOTYPE=Object.getPrototypeOf;
  var PART14B_GET_DESCRIPTOR=Object.getOwnPropertyDescriptor;
  var PART14B_OWN_KEYS=Reflect.ownKeys;
  var PART14B_HAS_OWN=Object.prototype.hasOwnProperty;
  var PART14B_OBJECT_PROTOTYPE=Object.prototype;
  var PART14B_ARRAY_PROTOTYPE=Array.prototype;
  var PART14B_IS_PROXY=null;
  if (typeof require==='function') {
    try { PART14B_IS_PROXY=require('node:util').types.isProxy; } catch (_) {}
  }
  function copyPart14BData(value,depth) {
    if (depth>64) throw new Error('Part 14B data shape invalid');
    if (value===null||typeof value==='string'||typeof value==='boolean') return value;
    if (typeof value==='number') {
      if (!Number.isFinite(value)||Object.is(value,-0)) throw new Error('Part 14B data shape invalid');
      return value;
    }
    if (!value||typeof value!=='object'||PART14B_IS_PROXY&&PART14B_IS_PROXY(value)) {
      throw new Error('Part 14B data shape invalid');
    }
    var array=Array.isArray(value),prototype;
    try { prototype=PART14B_GET_PROTOTYPE(value); } catch (_) {
      throw new Error('Part 14B data shape invalid');
    }
    if (prototype!==(array?PART14B_ARRAY_PROTOTYPE:PART14B_OBJECT_PROTOTYPE)||
        PART14B_GET_DESCRIPTOR(value,'toJSON')||
        PART14B_GET_DESCRIPTOR(prototype,'toJSON')) throw new Error('Part 14B data shape invalid');
    var keys;
    try { keys=PART14B_OWN_KEYS(value); } catch (_) {
      throw new Error('Part 14B data shape invalid');
    }
    if (keys.some(function(key){return typeof key!=='string';})) {
      throw new Error('Part 14B data shape invalid');
    }
    if (array) {
      var length=PART14B_GET_DESCRIPTOR(value,'length');
      if (!length||length.enumerable||length.configurable||length.writable!==true||
          !Number.isSafeInteger(length.value)||length.value<0||keys.length!==length.value+1) {
        throw new Error('Part 14B data shape invalid');
      }
      var list=[];
      for (var index=0;index<length.value;index+=1) {
        if (keys[index]!==String(index)) throw new Error('Part 14B data shape invalid');
        var item=PART14B_GET_DESCRIPTOR(value,String(index));
        if (!item||!item.enumerable||!item.configurable||item.writable!==true||
            !PART14B_HAS_OWN.call(item,'value')) throw new Error('Part 14B data shape invalid');
        list.push(copyPart14BData(item.value,depth+1));
      }
      if (keys[keys.length-1]!=='length') throw new Error('Part 14B data shape invalid');
      return list;
    }
    var result={};
    keys.forEach(function(key){
      var descriptor=PART14B_GET_DESCRIPTOR(value,key);
      if (!descriptor||!descriptor.enumerable||!descriptor.configurable||descriptor.writable!==true||
          !PART14B_HAS_OWN.call(descriptor,'value')) throw new Error('Part 14B data shape invalid');
      result[key]=copyPart14BData(descriptor.value,depth+1);
    });
    return result;
  }
  function copyFictionalDemoEnvelope(value) {
    try { return copyPart14BData(value,0); } catch (_) { return null; }
  }
  function exactOrdered(value,keys) {
    if (!value||typeof value!=='object'||Array.isArray(value)) return false;
    var actual=Object.keys(value);
    return actual.length===keys.length&&actual.every(function(key,index){return key===keys[index];});
  }
  function projectPart14B(value,part12Bundle,expectedRevision) {
    var topKeys=['contractVersion','policyVersion','policyDigest','state','reason','mode','fictional',
      'syntheticEvidenceOnly','label','sourceWitness','journeyBinding','launchMatrix','lifecycle','reset',
      'isolation','acceptance','exactCurrentnessRevalidatedBeforeAndAfterProjection','sourceReadCount',
      'providerCallCount','providerMutationCount','receiverMutationCount','outboundMessageCount',
      'accountingMutationCount','downstreamMutationCount','paidRepositoryReadCount',
      'productionDatabaseMutationCount','liveMoneyMovementCount'];
    var stageKeys=['name','state','sourceContractVersion','sourceState','sourceReason','sourceDigest',
      'journeyBindingDigest','fictional','syntheticEvidenceOnly','current',
      'humanAuthorityFabricated','providerOrBankTruthFabricated','productionEffectExecuted',
      'durableExternalEffectCreated'];
    var zeroKeys=['sourceReadCount','providerCallCount','providerMutationCount','receiverMutationCount',
      'outboundMessageCount','accountingMutationCount','downstreamMutationCount','paidRepositoryReadCount',
      'productionDatabaseMutationCount','liveMoneyMovementCount'];
    var isolationKeys=['accountFreeDemoNamespaceOnly','exactTenantSessionRecordAndSourceRequired',
      'paidRepositoryReadAllowed','paidRouteFallbackAllowed','paidPrivateDataReturned',
      'providerAccountAllowed','credentialOrSecretAllowed','providerTransportAllowed','webhookAllowed',
      'receiverOrOutboundDeliveryAllowed','productionDatabaseWriteAllowed',
      'realCustomerSessionOrDocumentAllowed','crossSessionReuseAllowed','cacheSharedWithPaidData'];
    var acceptanceKeys=['completeResettableFictionalJourneyProjected',
      'exactPart12ProductionContractsRevalidated','strictPaidDemoIsolationPreserved',
      'realisticFictionalLifecycleStatesPresent','checkReceivedRemainsDistinctFromClearance',
      'providerSandboxEvidenceAccepted','livePaymentEvidenceAccepted','productionJourneyAccepted',
      'independentWholeHeadAuditAccepted','founderVisualApprovalAccepted'];
    var sourceWitnessKeys=['contractVersion','digest'];
    var journeyBindingKeys=['tenantScopeDigest','sessionScopeDigest','recordScopeDigest',
      'workspaceRevision','workspaceGeneration','workspaceSeedDigest','workspaceStateDigest',
      'draftRevision','draftDigest','previewDigest','currency','journeyBindingDigest',
      'rawTenantSessionOrRecordIdentityReturned'];
    var launchKeys=['rolloutStage','liveCapabilityEnabled','providerMode','providerMethod',
      'partialProviderPaymentsEnabled','multiInvoiceProviderPaymentsEnabled',
      'offlineCashReceiptEnabled','offlineCheckReceiptEnabled','checkClearedTransitionEnabled',
      'checkClearanceState'];
    var lifecycleKeys=['stages','requiredStageCount','currentStageCount','skippedStageCount',
      'duplicateStageCount','exactOrderedSourceContractsRevalidated',
      'realisticFictionalStatesProjected','humanReviewRepresentedAsFictionalEvidenceOnly',
      'providerSessionEventAndSettlementRepresentedAsFictionalEvidenceOnly',
      'productionFinancialTruthCreated'];
    var resetKeys=['supported','endpoint','currentGeneration','currentWorkspaceRevision',
      'canonicalBaseline','currentMutationKeyCount','currentSimulationCount',
      'exactExpectedRevisionRequired','idempotencyKeyRequired','sameSessionOnly',
      'duplicateResetReplays','resetRestoresCanonicalBaseline','resetRemovesUserCreatedDemoMutations',
      'resetMayReadOrMutatePaidData'];
    try { value=copyPart14BData(value,0); } catch (_) { return Promise.resolve(null); }
    if (!part12Bundle||!exactOrdered(value,topKeys)||!exactOrdered(value.sourceWitness,sourceWitnessKeys)||
        !exactOrdered(value.journeyBinding,journeyBindingKeys)||
        !exactOrdered(value.launchMatrix,launchKeys)||!exactOrdered(value.lifecycle,lifecycleKeys)||
        !exactOrdered(value.reset,resetKeys)||
        value.contractVersion!=='m27-fictional-demo-journey-acceptance-v1'||
        value.policyVersion!=='mission27.launch.v1'||
        value.policyDigest!=='d24c8c83f6076cedbcf916d5a9f95240fdd4aa72758c930ea511336fa5b3c56a'||
        value.state!=='current_fictional_demo'||value.reason!==null||value.mode!=='demo'||
        value.fictional!==true||value.syntheticEvidenceOnly!==true||
        value.label!=='Fictional financial lifecycle — no real customer, provider, bank, or money effect'||
        value.sourceWitness.contractVersion!=='m27-reporting-part12-preview-bundle-v1'||
        !/^[0-9a-f]{64}$/.test(value.sourceWitness.digest)||
        value.journeyBinding.workspaceRevision!==expectedRevision||
        !Number.isSafeInteger(value.journeyBinding.workspaceGeneration)||
        value.journeyBinding.workspaceGeneration<1||
        value.journeyBinding.draftRevision!==part12Bundle?.preview?.draftIdentity?.revision||
        value.journeyBinding.draftDigest!==part12Bundle?.preview?.draftIdentity?.draftDigest||
        value.journeyBinding.previewDigest!==part12Bundle?.preview?.previewDigest||
        value.journeyBinding.currency!=='USD'||
        value.journeyBinding.rawTenantSessionOrRecordIdentityReturned!==false||
        ['tenantScopeDigest','sessionScopeDigest','recordScopeDigest','workspaceSeedDigest',
          'workspaceStateDigest','draftDigest','previewDigest','journeyBindingDigest']
          .some(function(key){return !/^[0-9a-f]{64}$/.test(value.journeyBinding[key]);})||
        new Set([value.journeyBinding.tenantScopeDigest,value.journeyBinding.sessionScopeDigest,
          value.journeyBinding.recordScopeDigest]).size!==3||
        value.launchMatrix.rolloutStage!=='disabled'||
        value.launchMatrix.liveCapabilityEnabled!==false||value.launchMatrix.providerMode!=='test'||
        value.launchMatrix.providerMethod!=='card'||
        value.launchMatrix.partialProviderPaymentsEnabled!==false||
        value.launchMatrix.multiInvoiceProviderPaymentsEnabled!==false||
        value.launchMatrix.offlineCashReceiptEnabled!==true||
        value.launchMatrix.offlineCheckReceiptEnabled!==true||
        value.launchMatrix.checkClearedTransitionEnabled!==false||
        value.launchMatrix.checkClearanceState!=='check_clearance_authority_unavailable'||
        !Array.isArray(value.lifecycle.stages)||value.lifecycle.stages.length!==15||
        value.lifecycle.requiredStageCount!==15||value.lifecycle.currentStageCount!==15||
        value.lifecycle.skippedStageCount!==0||value.lifecycle.duplicateStageCount!==0||
        value.lifecycle.exactOrderedSourceContractsRevalidated!==true||
        value.lifecycle.realisticFictionalStatesProjected!==true||
        value.lifecycle.humanReviewRepresentedAsFictionalEvidenceOnly!==true||
        value.lifecycle.providerSessionEventAndSettlementRepresentedAsFictionalEvidenceOnly!==true||
        value.lifecycle.productionFinancialTruthCreated!==false||
        value.lifecycle.stages.some(function(stage,index){return !exactOrdered(stage,stageKeys)||
          stage.name!==PART14B_STAGE_NAMES[index]||stage.state!==PART14B_STAGE_STATES[index]||
          stage.sourceContractVersion!==PART14B_STAGE_SOURCES[index][0]||
          stage.sourceState!==PART14B_STAGE_SOURCES[index][1]||
          stage.sourceReason!==PART14B_STAGE_SOURCES[index][2]||
          !/^[0-9a-f]{64}$/.test(stage.sourceDigest||'')||
          stage.journeyBindingDigest!==value.journeyBinding.journeyBindingDigest||
          stage.fictional!==true||stage.syntheticEvidenceOnly!==true||stage.current!==true||
          stage.humanAuthorityFabricated!==false||stage.providerOrBankTruthFabricated!==false||
          stage.productionEffectExecuted!==false||stage.durableExternalEffectCreated!==false;})||
        value.reset.supported!==true||value.reset.endpoint!=='/api/demo/command-center/reset'||
        value.reset.currentWorkspaceRevision!==expectedRevision||
        !Number.isSafeInteger(value.reset.currentGeneration)||value.reset.currentGeneration<1||
        typeof value.reset.canonicalBaseline!=='boolean'||
        value.reset.currentGeneration!==value.journeyBinding.workspaceGeneration||
        !Number.isSafeInteger(value.reset.currentMutationKeyCount)||value.reset.currentMutationKeyCount<0||
        !Number.isSafeInteger(value.reset.currentSimulationCount)||value.reset.currentSimulationCount<0||
        value.reset.exactExpectedRevisionRequired!==true||value.reset.idempotencyKeyRequired!==true||
        value.reset.sameSessionOnly!==true||value.reset.duplicateResetReplays!==true||
        value.reset.resetRestoresCanonicalBaseline!==true||
        value.reset.resetRemovesUserCreatedDemoMutations!==true||
        value.reset.resetMayReadOrMutatePaidData!==false||
        value.reset.canonicalBaseline!==(value.reset.currentMutationKeyCount===0&&
          value.reset.currentSimulationCount===0)||
        !exactOrdered(value.isolation,isolationKeys)||Object.keys(value.isolation).some(function(key){
          var expectedTrue=['accountFreeDemoNamespaceOnly','exactTenantSessionRecordAndSourceRequired'].includes(key);
          return value.isolation[key]!==expectedTrue;})||
        !exactOrdered(value.acceptance,acceptanceKeys)||
        value.acceptance.completeResettableFictionalJourneyProjected!==true||
        value.acceptance.exactPart12ProductionContractsRevalidated!==true||
        value.acceptance.strictPaidDemoIsolationPreserved!==true||
        value.acceptance.realisticFictionalLifecycleStatesPresent!==true||
        value.acceptance.checkReceivedRemainsDistinctFromClearance!==true||
        value.acceptance.providerSandboxEvidenceAccepted!==false||
        value.acceptance.livePaymentEvidenceAccepted!==false||
        value.acceptance.productionJourneyAccepted!==false||
        value.acceptance.independentWholeHeadAuditAccepted!==false||
        value.acceptance.founderVisualApprovalAccepted!==false||
        value.exactCurrentnessRevalidatedBeforeAndAfterProjection!==true||
        zeroKeys.some(function(key){return value[key]!==(key==='sourceReadCount'?2:0);})) {
      return Promise.resolve(null);
    }
    var binding={tenantScopeDigest:value.journeyBinding.tenantScopeDigest,
      sessionScopeDigest:value.journeyBinding.sessionScopeDigest,
      recordScopeDigest:value.journeyBinding.recordScopeDigest,
      workspaceRevision:value.journeyBinding.workspaceRevision,
      workspaceGeneration:value.journeyBinding.workspaceGeneration,
      workspaceSeedDigest:value.journeyBinding.workspaceSeedDigest,
      workspaceStateDigest:value.journeyBinding.workspaceStateDigest,
      draftRevision:value.journeyBinding.draftRevision,
      draftDigest:value.journeyBinding.draftDigest,previewDigest:value.journeyBinding.previewDigest,
      currency:value.journeyBinding.currency};
    var stageSources=[part12Bundle.preview,part12Bundle.preview,part12Bundle.part5Acceptance,
      part12Bundle.part5Acceptance.issueReadiness,part12Bundle.part6Acceptance.delivery,
      part12Bundle.part7Acceptance,part12Bundle.part9Acceptance,part12Bundle.part9Acceptance,
      part12Bundle.part9Acceptance.customerReceipt,part12Bundle.part9Acceptance.correctionRecovery,
      part12Bundle.part10Acceptance,part12Bundle.part11Acceptance,part12Bundle.part12Acceptance,
      part12Bundle.part9Acceptance,part12Bundle.part9Acceptance];
    return Promise.all([digestObject(part12Bundle),digestObject(binding)].concat(
      stageSources.map(digestObject))).then(function(digests){
      if (digests[0]!==value.sourceWitness.digest||
          digests[1]!==value.journeyBinding.journeyBindingDigest||
          value.lifecycle.stages.some(function(stage,index){return stage.sourceDigest!==digests[index+2];})) {
        return null;
      }
      return value;
    }).catch(function(){return null;});
  }
  function invalidPart14B(value,part12Bundle,expectedRevision) {
    return projectPart14B(value,part12Bundle,expectedRevision).then(function(projected){
      return !projected;
    });
  }
  var PART11_SOURCE_DIGEST_MARKER='__EXACT_UPSTREAM_DIGEST__';
  var PART11_SOURCE_SEMANTIC_DIGESTS=Object.freeze([
    'c2ed3cb5b88883c17bb1c32268315ace21270993288e8c575613977463ec91a9',
    'efbe2cddc2c48da32ca627e23bd529fc30fbdb9b24aa29ae6ef64b39df76a69f',
    'e631008106c452f332927a0143e56f400e17d5dae6610e834924d5ca9f993a60',
  ]);
  function part11SourceSemanticProjection(value,part) {
    if (!value || typeof value!=='object' || Array.isArray(value)) return null;
    var projected=JSON.parse(JSON.stringify(value));
    if (part==='11A') {
      if (!projected.part10Witness ||
          !/^[0-9a-f]{64}$/.test(projected.part10Witness.digest||'')) return null;
      projected.part10Witness.digest=PART11_SOURCE_DIGEST_MARKER;
    } else if (part==='11B') {
      if (!projected.sourceWitness ||
          !/^[0-9a-f]{64}$/.test(projected.sourceWitness.digest||'')) return null;
      projected.sourceWitness.digest=PART11_SOURCE_DIGEST_MARKER;
    } else if (part==='11C') {
      if (!projected.sourceWitness ||
          !/^[0-9a-f]{64}$/.test(projected.sourceWitness.digest||'') ||
          !/^[0-9a-f]{64}$/.test(projected.sourceWitness.exportContractDigest||'')) return null;
      projected.sourceWitness.digest=PART11_SOURCE_DIGEST_MARKER;
      projected.sourceWitness.exportContractDigest=PART11_SOURCE_DIGEST_MARKER;
    } else return null;
    return projected;
  }
  function matchesDemoWorkspaceRevision(preview, expectedRevision) {
    return Number.isSafeInteger(expectedRevision) && expectedRevision >= 1 &&
      !!preview && !!preview.draftIdentity &&
      preview.draftIdentity.revision === expectedRevision;
  }
  function recoverAfterSuccessfulMutation(options) {
    var defer = options.defer || function (callback) { setTimeout(callback, 0); };
    return new Promise(function (resolve, reject) {
      defer(function () {
        if (!options.active()) { resolve(false); return; }
        var reopened = !options.section.open;
        options.beforeOpen();
        if (reopened) options.section.open = true;
        try { Promise.resolve(options.reload()).then(function () { resolve(reopened); }, reject); }
        catch (error) { reject(error); }
      });
    });
  }
  function shouldResumeMutationRecovery(previous, host, estimateId) {
    return !!previous && previous.host === host && previous.estimateId === estimateId &&
      previous.section && !previous.section.isConnected &&
      previous.desiredOpen() === true && previous.mutationRecoveryActive() === true;
  }
  function canPreserveMountedDisclosure(previous, review, host) {
    var estimateId = review && review.pins && review.pins.estimateId;
    return !!previous && previous.host === host &&
      previous.estimateId === String(estimateId || '') &&
      previous.section && previous.section.isConnected;
  }
  function preserveMountedDisclosure(review, host) {
    return canPreserveMountedDisclosure(activeDisclosureMount, review, host) ?
      activeDisclosureMount.section : null;
  }
  function invalidPart7(value, expectedMode) {
    var witness = value && value.previewWitness, sources = value && value.sourceWitnesses;
    var schema = value && value.adapterSchema, sandbox = value && value.sandbox;
    var rollout = value && value.rollout, drift = value && value.driftAndDisconnect;
    var protections = value && value.protections, access = value && value.access;
    var expectedRequirements = [
      ['exact_current_launch_policy','current',null],
      ['tenant_bound_test_provider_connection','unavailable','provider_connection_prerequisites_unavailable'],
      ['current_provider_capability_grant','unavailable','provider_connection_capability_unavailable'],
      ['recent_authentication_and_mfa','unavailable','mfa_authority_unavailable'],
      ['compatible_adapter_schema','unavailable','provider_adapter_runtime_unavailable'],
      ['provider_sandbox_journey_evidence','unavailable','provider_sandbox_evidence_unavailable'],
      ['exact_current_issued_balance','unavailable','issued_invoice_unavailable'],
      ['current_scoped_customer_session','unavailable','invoice_public_session_unavailable'],
      ['exact_payment_idempotency_receipt','not_created','payment_plan_not_authorized'],
      ['server_owned_rollout_flag','disabled','payment_rollout_disabled'],
    ];
    var denied = [value && value.providerSandboxAccepted,value && value.providerConnectionCurrent,
      value && value.paymentPlanCurrent,value && value.paymentInitiationAuthorized,
      value && value.providerSessionCreated,value && value.paymentSuccessRecorded,
      value && value.settlementRecorded];
    var sourceDigests = sources && [sources.providerBoundaryDigest,sources.providerConnectionDigest,
      sources.paymentInitiationDigest];
    return !exactObject(value, ['contractVersion','state','reason','mode','fictional','previewWitness',
      'sourceWitnesses','requirements','adapterSchema','sandbox','rollout','driftAndDisconnect',
      'methods','protections','access','exactCurrentnessRevalidated','providerSandboxAccepted',
      'providerConnectionCurrent','paymentPlanCurrent','paymentInitiationAuthorized',
      'providerSessionCreated','paymentSuccessRecorded','settlementRecorded','providerCallCount',
      'providerMutationCount','receiverMutationCount','liveMoneyMovementCount']) ||
      value.contractVersion !== 'm27-payment-part7-acceptance-v1' ||
      value.state !== 'unavailable' || value.reason !== 'provider_sandbox_evidence_unavailable' ||
      !['paid','demo'].includes(expectedMode) || value.mode !== expectedMode ||
      value.fictional !== (expectedMode === 'demo') ||
      !exactObject(witness, ['contractVersion','mode','draftRevision','draftDigest','previewDigest']) ||
      witness.contractVersion !== 'm27-invoice-part5-preview-witness-v1' || witness.mode !== expectedMode ||
      !Number.isSafeInteger(witness.draftRevision) || witness.draftRevision < 0 ||
      !/^[0-9a-f]{64}$/.test(witness.draftDigest || '') ||
      !/^[0-9a-f]{64}$/.test(witness.previewDigest || '') ||
      !exactObject(sources, ['providerBoundaryContractVersion','providerBoundaryDigest',
        'providerConnectionContractVersion','providerConnectionDigest',
        'paymentInitiationContractVersion','paymentInitiationDigest']) ||
      sources.providerBoundaryContractVersion !== 'm27-payment-provider-boundary-v1' ||
      sources.providerConnectionContractVersion !== 'm27-payment-provider-connection-v1' ||
      sources.paymentInitiationContractVersion !== 'm27-payment-initiation-plan-v1' ||
      sourceDigests.some(function (digest) { return !/^[0-9a-f]{64}$/.test(digest || ''); }) ||
      new Set(sourceDigests).size !== sourceDigests.length ||
      !Array.isArray(value.requirements) || value.requirements.length !== expectedRequirements.length ||
      value.requirements.some(function (item,index) {
        var expected = expectedRequirements[index];
        return !exactObject(item, ['requirement','state','reason']) ||
          item.requirement !== expected[0] || item.state !== expected[1] || item.reason !== expected[2];
      }) ||
      !exactObject(schema, ['contractVersion','state','reason','value','provider','mode',
        'acceptedMajorVersion','minimumSupportedMinorVersion','maximumTestedMinorVersion',
        'breakingChangeRequiresNewMajorVersion','unknownRequiredFieldAccepted',
        'unknownOptionalFieldMayAuthorizeEffect','backwardCompatibleMinorInputRequired',
        'forwardCompatibleOptionalOutputRequired','callerAuthoredProviderObjectAccepted',
        'providerPayloadMayMarkInvoicePaid']) ||
      schema.contractVersion !== 'm27-payment-provider-adapter-schema-v1' ||
      schema.state !== 'unavailable' || schema.reason !== 'provider_adapter_runtime_unavailable' ||
      schema.value !== null || schema.provider !== 'stripe_connect' || schema.mode !== 'test' ||
      schema.acceptedMajorVersion !== 1 || schema.minimumSupportedMinorVersion !== 0 ||
      schema.maximumTestedMinorVersion !== 0 || schema.breakingChangeRequiresNewMajorVersion !== true ||
      schema.unknownRequiredFieldAccepted !== false ||
      schema.unknownOptionalFieldMayAuthorizeEffect !== false ||
      schema.backwardCompatibleMinorInputRequired !== true ||
      schema.forwardCompatibleOptionalOutputRequired !== true ||
      schema.callerAuthoredProviderObjectAccepted !== false ||
      schema.providerPayloadMayMarkInvoicePaid !== false ||
      !exactObject(sandbox, ['state','reason','value','requiredForMissionCompletion',
        'evidenceAccepted','syntheticEvidenceMaySubstitute','providerAccountId','providerSessionId',
        'hostedCheckoutUrl']) || sandbox.state !== 'unavailable' ||
      sandbox.reason !== 'provider_sandbox_evidence_unavailable' || sandbox.value !== null ||
      sandbox.requiredForMissionCompletion !== true || sandbox.evidenceAccepted !== false ||
      sandbox.syntheticEvidenceMaySubstitute !== false || sandbox.providerAccountId !== null ||
      sandbox.providerSessionId !== null || sandbox.hostedCheckoutUrl !== null ||
      !exactObject(rollout, ['stage','tenantFlagDefault','tenantFlagEnabled','featureFlagRollbackState',
        'rollbackBlocksNewInitiation','rollbackCanMarkInvoicePaid','liveCapabilityEnabled',
        'liveCapabilityPrerequisites']) || rollout.stage !== 'disabled' ||
      rollout.tenantFlagDefault !== 'off' || rollout.tenantFlagEnabled !== false ||
      rollout.featureFlagRollbackState !== 'active' || rollout.rollbackBlocksNewInitiation !== true ||
      rollout.rollbackCanMarkInvoicePaid !== false || rollout.liveCapabilityEnabled !== false ||
      !Array.isArray(rollout.liveCapabilityPrerequisites) ||
      rollout.liveCapabilityPrerequisites.join(',') !==
        'accepted_parts_8_and_9,accepted_part_13_controls,separately_authorized_live_canary' ||
      !exactObject(drift, ['capabilityDriftBehavior','accountOrModeDriftBehavior','disconnectBehavior',
        'credentialRotationBehavior','automaticReconnectAuthorized','browserReturnMayRestoreAuthority']) ||
      drift.capabilityDriftBehavior !== 'deny_and_require_current_reauthorization' ||
      drift.accountOrModeDriftBehavior !== 'deny_and_require_exact_revalidation' ||
      drift.disconnectBehavior !== 'deny_new_initiation_and_clear_provider_state' ||
      drift.credentialRotationBehavior !== 'deny_until_current_server_credential_authority' ||
      drift.automaticReconnectAuthorized !== false || drift.browserReturnMayRestoreAuthority !== false ||
      !Array.isArray(value.methods) || value.methods.length !== 2 ||
      !exactObject(value.methods[0], ['method','policyState','runtimeState','reason']) ||
      value.methods[0].method !== 'card' || value.methods[0].policyState !== 'launch_supported' ||
      value.methods[0].runtimeState !== 'unavailable' ||
      value.methods[0].reason !== 'payment_provider_unavailable' ||
      !exactObject(value.methods[1], ['method','policyState','runtimeState','reason']) ||
      value.methods[1].method !== 'any_other_online_method' ||
      value.methods[1].policyState !== 'unsupported' || value.methods[1].runtimeState !== 'unsupported' ||
      value.methods[1].reason !== 'payment_method_unsupported' ||
      !exactObject(protections, ['duplicateClickRequiresSameIdempotencyReceipt',
        'changedRequestUnderSameIdempotencyKeyConflicts',
        'amountCurrencyInvoiceOrAllocationChangeInvalidatesPlan','stalePlanMayReachProvider',
        'missingAmountMayBeTreatedAsZero','browserReturnAuthorizesPayment']) ||
      protections.duplicateClickRequiresSameIdempotencyReceipt !== true ||
      protections.changedRequestUnderSameIdempotencyKeyConflicts !== true ||
      protections.amountCurrencyInvoiceOrAllocationChangeInvalidatesPlan !== true ||
      protections.stalePlanMayReachProvider !== false || protections.missingAmountMayBeTreatedAsZero !== false ||
      protections.browserReturnAuthorizesPayment !== false ||
      !exactObject(access, ['staffReadRoles','providerConnectionRole','customerInitiationAuthority',
        'staffRoleMaySubstituteForCustomerSession','roleAloneAuthorizesProviderAction',
        'tenantCrossingAllowed']) || !Array.isArray(access.staffReadRoles) ||
      access.staffReadRoles.join(',') !== 'owner,admin' || access.providerConnectionRole !== 'owner' ||
      access.customerInitiationAuthority !== 'current_scoped_customer_session' ||
      access.staffRoleMaySubstituteForCustomerSession !== false ||
      access.roleAloneAuthorizesProviderAction !== false || access.tenantCrossingAllowed !== false ||
      value.exactCurrentnessRevalidated !== true || denied.some(function (item) { return item !== false; }) ||
      value.providerCallCount !== 0 || value.providerMutationCount !== 0 ||
      value.receiverMutationCount !== 0 || value.liveMoneyMovementCount !== 0;
  }
  function invalidPart9(value, expectedMode) {
    var witness = value && value.previewWitness, concurrency = value && value.concurrency;
    var recovery = value && value.correctionRecovery, receipt = value && value.customerReceipt;
    var accounting = value && value.accounting, access = value && value.access;
    var acceptance = value && value.acceptance;
    var expectedParts = [
      ['9A','m27-payment-attempt-allocation-overpayment-readiness-v1','payment_attempt_evidence_unavailable'],
      ['9B','m27-deposit-application-readiness-v1','deposit_payment_evidence_unavailable'],
      ['9C','m27-credit-note-refund-request-readiness-v1','credit_refund_source_evidence_unavailable'],
      ['9D','m27-offline-payment-intake-readiness-v1','issued_invoice_allocation_unavailable'],
      ['9E','m27-payment-outcome-readiness-v1','financial_outcome_source_evidence_unavailable'],
    ];
    var counts = value && [value.customerReceiptRowCount,value.correctionRowCount,
      value.recoveryRowCount,value.accountingExportRowCount,value.accountingReconciliationRowCount,
      value.providerCallCount,value.providerMutationCount,value.receiverMutationCount,
      value.accountingMutationCount,value.liveMoneyMovementCount];
    return !exactObject(value, ['contractVersion','policyVersion','policyDigest','state','reason',
      'mode','fictional','previewWitness','sourceParts','concurrency','correctionRecovery',
      'customerReceipt','accounting','access','acceptance','exactCurrentnessRevalidated',
      'customerReceiptRowCount','correctionRowCount','recoveryRowCount','accountingExportRowCount',
      'accountingReconciliationRowCount','providerCallCount','providerMutationCount',
      'receiverMutationCount','accountingMutationCount','liveMoneyMovementCount']) ||
      value.contractVersion !== 'm27-payment-part9-acceptance-v1' ||
      value.policyVersion !== 'mission27.launch.v1' ||
      value.policyDigest !== 'd24c8c83f6076cedbcf916d5a9f95240fdd4aa72758c930ea511336fa5b3c56a' ||
      value.state !== 'unavailable' || value.reason !== 'part9_financial_evidence_unavailable' ||
      !['paid','demo'].includes(expectedMode) || value.mode !== expectedMode ||
      value.fictional !== (expectedMode === 'demo') ||
      !exactObject(witness, ['contractVersion','mode','draftRevision','draftDigest','previewDigest']) ||
      witness.contractVersion !== 'm27-invoice-part5-preview-witness-v1' || witness.mode !== expectedMode ||
      !Number.isSafeInteger(witness.draftRevision) || witness.draftRevision < 0 ||
      !/^[0-9a-f]{64}$/.test(witness.draftDigest || '') ||
      !/^[0-9a-f]{64}$/.test(witness.previewDigest || '') ||
      !Array.isArray(value.sourceParts) || value.sourceParts.length !== expectedParts.length ||
      value.sourceParts.some(function (part,index) { var expected = expectedParts[index];
        return !exactObject(part,['part','contractVersion','state','reason','digest']) ||
          part.part !== expected[0] || part.contractVersion !== expected[1] ||
          part.state !== 'unavailable' || part.reason !== expected[2] ||
          !/^[0-9a-f]{64}$/.test(part.digest || ''); }) ||
      new Set(value.sourceParts.map(function (part) { return part.digest; })).size !== 5 ||
      !exactObject(concurrency,['state','reason','maximumConcurrentWriterPerAggregate',
        'exactAggregateRevisionRequired','exactRequestDigestAndIdempotencyReceiptRequired',
        'sameKeyChangedRequestConflicts','duplicateOrReplayMayRepeatEffect',
        'arrivalOrderMayAuthorizeEffect','settledMoneyMayBeRefusedRetroactively',
        'crossAxisSilentOverwriteAllowed','missingAmountOrEvidenceMayBecomeZero']) ||
      concurrency.state !== 'unavailable' || concurrency.reason !== 'payment_attempt_evidence_unavailable' ||
      concurrency.maximumConcurrentWriterPerAggregate !== 1 ||
      concurrency.exactAggregateRevisionRequired !== true ||
      concurrency.exactRequestDigestAndIdempotencyReceiptRequired !== true ||
      concurrency.sameKeyChangedRequestConflicts !== true ||
      concurrency.duplicateOrReplayMayRepeatEffect !== false ||
      concurrency.arrivalOrderMayAuthorizeEffect !== false ||
      concurrency.settledMoneyMayBeRefusedRetroactively !== false ||
      concurrency.crossAxisSilentOverwriteAllowed !== false ||
      concurrency.missingAmountOrEvidenceMayBecomeZero !== false ||
      !exactObject(recovery,['state','reason','value','correctionsAreAppendOnly',
        'priorAcceptedEvidenceMayBeRewritten','exactOriginalRequestAndReceiptRequired',
        'readOnlyLookupRequiresNoExternalOrFinancialEffect',
        'restoringExternalOrFinancialEffectRequiresDualControl','recoveryMayExceedOriginalRequest',
        'sourceCorrectionOrReopeningRequiresCurrentProjection',
        'staleOrChangedSourceClearsRenderedFinancialState','recoveryReceiptIdentity']) ||
      recovery.state !== 'unavailable' || recovery.reason !== 'source_authority_unavailable' ||
      recovery.value !== null || recovery.correctionsAreAppendOnly !== true ||
      recovery.priorAcceptedEvidenceMayBeRewritten !== false ||
      recovery.exactOriginalRequestAndReceiptRequired !== true ||
      recovery.readOnlyLookupRequiresNoExternalOrFinancialEffect !== true ||
      recovery.restoringExternalOrFinancialEffectRequiresDualControl !== true ||
      recovery.recoveryMayExceedOriginalRequest !== false ||
      recovery.sourceCorrectionOrReopeningRequiresCurrentProjection !== true ||
      recovery.staleOrChangedSourceClearsRenderedFinancialState !== true ||
      recovery.recoveryReceiptIdentity !== null ||
      !exactObject(receipt,['state','reason','value','numberingPattern','serverAssigned','immutable',
        'gapsAllowed','reuseAllowed','annualResetAllowed','exactAcceptedFinancialFactRequired',
        'checkReceivedRequiredWording','receiptMayClaimProviderSettlementOrBankClearance',
        'refundRequestIsCompletedRefund','providerDisputeErasesOriginalPayment',
        'negativeBalanceCreditRevenueAndExpenseRemainSeparate','customerReceiptIdentity',
        'publicReceiptRouteAvailable']) || receipt.state !== 'unavailable' ||
      receipt.reason !== 'source_authority_unavailable' || receipt.value !== null ||
      receipt.numberingPattern !== 'RCT-{tenant_monotonic_10_digit_sequence}' ||
      receipt.serverAssigned !== true || receipt.immutable !== true || receipt.gapsAllowed !== true ||
      receipt.reuseAllowed !== false || receipt.annualResetAllowed !== false ||
      receipt.exactAcceptedFinancialFactRequired !== true ||
      receipt.checkReceivedRequiredWording !== 'check received — clearance unknown' ||
      receipt.receiptMayClaimProviderSettlementOrBankClearance !== false ||
      receipt.refundRequestIsCompletedRefund !== false ||
      receipt.providerDisputeErasesOriginalPayment !== false ||
      receipt.negativeBalanceCreditRevenueAndExpenseRemainSeparate !== true ||
      receipt.customerReceiptIdentity !== null || receipt.publicReceiptRouteAvailable !== false ||
      !exactObject(accounting,['state','reason','value','adapter','supportedMode','runtimeAvailable',
        'exportAndAcknowledgementOnly','mayInventChartOfAccounts','mayDecideRecognitionOrTax',
        'maySupplyCheckClearance','maximumExportRecords','maximumExportMinorUnits',
        'singleControlMaximumRecords','singleControlMaximumMinorUnits',
        'aboveSingleControlRequiresTwoDifferentCurrentHumans','manualReconciliationAlwaysDualControl',
        'adapterAcknowledgementIsHumanAction','exactCurrentMinimizedFactSetAndAdapterRequired',
        'accountingReceiptIdentity','earnedRevenuePolicyAvailable']) ||
      accounting.state !== 'accounting_adapter_unavailable' ||
      accounting.reason !== 'accounting_adapter_unavailable' || accounting.value !== null ||
      accounting.adapter !== 'quickbooks_online.accounting_export.v1' ||
      accounting.supportedMode !== 'sandbox' || accounting.runtimeAvailable !== false ||
      accounting.exportAndAcknowledgementOnly !== true ||
      accounting.mayInventChartOfAccounts !== false || accounting.mayDecideRecognitionOrTax !== false ||
      accounting.maySupplyCheckClearance !== false || accounting.maximumExportRecords !== 1000 ||
      accounting.maximumExportMinorUnits !== '100000000' ||
      accounting.singleControlMaximumRecords !== 100 ||
      accounting.singleControlMaximumMinorUnits !== '10000000' ||
      accounting.aboveSingleControlRequiresTwoDifferentCurrentHumans !== true ||
      accounting.manualReconciliationAlwaysDualControl !== true ||
      accounting.adapterAcknowledgementIsHumanAction !== false ||
      accounting.exactCurrentMinimizedFactSetAndAdapterRequired !== true ||
      accounting.accountingReceiptIdentity !== null || accounting.earnedRevenuePolicyAvailable !== false ||
      !exactObject(access,['eligiblePaidRoles','roleAloneAuthorizesFinancialAction',
        'demoPhysicallyAndLogicallyIsolated','customerReceiptRequiresScopedCustomerAccess',
        'staffRoleMaySubstituteForCustomerAccess','tenantCrossingAllowed']) ||
      !Array.isArray(access.eligiblePaidRoles) || access.eligiblePaidRoles.join(',') !== 'owner,admin' ||
      access.roleAloneAuthorizesFinancialAction !== false ||
      access.demoPhysicallyAndLogicallyIsolated !== true ||
      access.customerReceiptRequiresScopedCustomerAccess !== true ||
      access.staffRoleMaySubstituteForCustomerAccess !== false || access.tenantCrossingAllowed !== false ||
      !exactObject(acceptance,['sourceContractsRevalidated','wholePart9FunctionalBoundaryPresent',
        'independentWholeHeadAuditAccepted','providerSandboxEvidenceAccepted',
        'firstPayingCustomerLiveMoneyValidated','founderVisualApprovalAccepted']) ||
      acceptance.sourceContractsRevalidated !== true ||
      acceptance.wholePart9FunctionalBoundaryPresent !== true ||
      acceptance.independentWholeHeadAuditAccepted !== false ||
      acceptance.providerSandboxEvidenceAccepted !== false ||
      acceptance.firstPayingCustomerLiveMoneyValidated !== false ||
      acceptance.founderVisualApprovalAccepted !== false ||
      value.exactCurrentnessRevalidated !== true || counts.some(function (count) { return count !== 0; });
  }
  function invalidPart10(value, expectedMode) {
    var witness = value && value.previewWitness, part9Witness = value && value.part9Witness;
    var failure = value && value.failureRetry, revocation = value && value.revocation;
    var access = value && value.access, privacy = value && value.privacy;
    var acceptance = value && value.acceptance;
    var expectedParts = [
      ['10A','m27-receivable-aging-v1','incomplete','receivable_population_incomplete'],
      ['10B','m27-collection-review-v1','unavailable','receivable_population_incomplete'],
      ['10C','m27-collection-handoff-readiness-v1','unavailable','receivable_population_incomplete'],
    ];
    var expectedFailures = ['source_unavailable','source_changed','request_rejected',
      'retry_currentness_unknown','cooldown_unknown','receiver_unavailable','delivery_evidence_unknown'];
    var expectedRevocations = ['issued_invoice_or_document','scoped_customer_session',
      'reviewed_recipient','delivery_authority','provider_checkout_session',
      'collection_capability','mission28_receiver','idempotency_receipt'];
    var counts = value && [value.receivableRowCount,value.collectionReviewRowCount,
      value.promiseToPayRowCount,value.handoffRequestRowCount,value.manualResendRequestRowCount,
      value.outboundMessageCount,value.providerCallCount,value.providerMutationCount,
      value.receiverMutationCount,value.accountingMutationCount,value.liveMoneyMovementCount];
    return !exactObject(value,['contractVersion','policyVersion','policyDigest','state','reason',
      'mode','fictional','previewWitness','part9Witness','sourceParts','failureRetry','revocation',
      'access','privacy','acceptance','exactCurrentnessRevalidated','receivableRowCount',
      'collectionReviewRowCount','promiseToPayRowCount','handoffRequestRowCount',
      'manualResendRequestRowCount','outboundMessageCount','providerCallCount',
      'providerMutationCount','receiverMutationCount','accountingMutationCount',
      'liveMoneyMovementCount']) || value.contractVersion !== 'm27-collection-part10-acceptance-v1' ||
      value.policyVersion !== 'mission27.launch.v1' ||
      value.policyDigest !== 'd24c8c83f6076cedbcf916d5a9f95240fdd4aa72758c930ea511336fa5b3c56a' ||
      value.state !== 'unavailable' || value.reason !== 'part10_collection_evidence_unavailable' ||
      !['paid','demo'].includes(expectedMode) || value.mode !== expectedMode ||
      value.fictional !== (expectedMode === 'demo') ||
      !exactObject(witness,['contractVersion','mode','draftRevision','draftDigest','previewDigest']) ||
      witness.contractVersion !== 'm27-invoice-part5-preview-witness-v1' || witness.mode !== expectedMode ||
      !Number.isSafeInteger(witness.draftRevision) || witness.draftRevision < 0 ||
      !/^[0-9a-f]{64}$/.test(witness.draftDigest || '') ||
      !/^[0-9a-f]{64}$/.test(witness.previewDigest || '') ||
      !exactObject(part9Witness,['contractVersion','state','reason','digest']) ||
      part9Witness.contractVersion !== 'm27-payment-part9-acceptance-v1' ||
      part9Witness.state !== 'unavailable' ||
      part9Witness.reason !== 'part9_financial_evidence_unavailable' ||
      !/^[0-9a-f]{64}$/.test(part9Witness.digest || '') ||
      !Array.isArray(value.sourceParts) || value.sourceParts.length !== expectedParts.length ||
      value.sourceParts.some(function (part,index) { var expected = expectedParts[index];
        return !exactObject(part,['part','contractVersion','state','reason','digest']) ||
          part.part !== expected[0] || part.contractVersion !== expected[1] ||
          part.state !== expected[2] || part.reason !== expected[3] ||
          !/^[0-9a-f]{64}$/.test(part.digest || ''); }) ||
      new Set(value.sourceParts.map(function (part) { return part.digest; })).size !== 3 ||
      !exactObject(failure,['state','reason','orderedFailureStates',
        'exactCurrentSourceRequiredBeforeEveryRetry','humanReviewedRetryRequired',
        'automaticReminderRetryOrChargeSupported','priorProviderSessionMayBeReused',
        'missingOrUnknownCooldownDenies','failedOrRejectedRequestMayCreateEffect',
        'changedSourceMayReusePriorRequestOrReceipt',
        'retryMayBypassRecipientCapabilityAssuranceOrControl','retryMayExceedOriginalReviewedRequest',
        'staleGenerationOrDelayedResponseMayRepopulateRenderedState']) ||
      failure.state !== 'unavailable' || failure.reason !== 'receivable_population_incomplete' ||
      !Array.isArray(failure.orderedFailureStates) ||
      failure.orderedFailureStates.join(',') !== expectedFailures.join(',') ||
      failure.exactCurrentSourceRequiredBeforeEveryRetry !== true ||
      failure.humanReviewedRetryRequired !== true ||
      failure.automaticReminderRetryOrChargeSupported !== false ||
      failure.priorProviderSessionMayBeReused !== false ||
      failure.missingOrUnknownCooldownDenies !== true ||
      failure.failedOrRejectedRequestMayCreateEffect !== false ||
      failure.changedSourceMayReusePriorRequestOrReceipt !== false ||
      failure.retryMayBypassRecipientCapabilityAssuranceOrControl !== false ||
      failure.retryMayExceedOriginalReviewedRequest !== false ||
      failure.staleGenerationOrDelayedResponseMayRepopulateRenderedState !== false ||
      !exactObject(revocation,['state','reason','orderedRevocationAxes',
        'everyAxisRevalidatedBeforeDisplayOrAction','revocationClearsRenderedPrivateAndCollectionState',
        'revokedInvoiceDocumentSessionRecipientOrCheckoutMayBeReused',
        'revokedCapabilityDeliveryAuthorityReceiverOrReceiptMayAuthorize',
        'roleOrRetryMayBypassRevocation','revocationCreatesFinancialOrExternalEffect']) ||
      revocation.state !== 'unavailable' || revocation.reason !== 'revocation_authority_unavailable' ||
      !Array.isArray(revocation.orderedRevocationAxes) ||
      revocation.orderedRevocationAxes.join(',') !== expectedRevocations.join(',') ||
      revocation.everyAxisRevalidatedBeforeDisplayOrAction !== true ||
      revocation.revocationClearsRenderedPrivateAndCollectionState !== true ||
      revocation.revokedInvoiceDocumentSessionRecipientOrCheckoutMayBeReused !== false ||
      revocation.revokedCapabilityDeliveryAuthorityReceiverOrReceiptMayAuthorize !== false ||
      revocation.roleOrRetryMayBypassRevocation !== false ||
      revocation.revocationCreatesFinancialOrExternalEffect !== false ||
      !exactObject(access,['eligiblePaidRoles','currentTenantSessionRequired',
        'currentSubscriptionRequired','roleAloneAuthorizesCollectionAction',
        'scopedCustomerSessionRequiredForCustomerAction','staffRoleMaySubstituteForCustomerSession',
        'demoPhysicallyAndLogicallyIsolated','tenantCrossingAllowed']) ||
      !Array.isArray(access.eligiblePaidRoles) || access.eligiblePaidRoles.join(',') !== 'owner,admin' ||
      access.currentTenantSessionRequired !== true || access.currentSubscriptionRequired !== true ||
      access.roleAloneAuthorizesCollectionAction !== false ||
      access.scopedCustomerSessionRequiredForCustomerAction !== true ||
      access.staffRoleMaySubstituteForCustomerSession !== false ||
      access.demoPhysicallyAndLogicallyIsolated !== true || access.tenantCrossingAllowed !== false ||
      !exactObject(privacy,['tenantIdentityExposed','customerIdentityExposed','invoiceIdentityExposed',
        'amountDueDateOrHoldExposed','recipientOrContactDetailExposed','collectionNoteOrPromiseExposed',
        'messageContentExposed','rawLinkTokenProviderSessionOrSecretExposed',
        'actorOrApproverIdentityExposed']) ||
      Object.keys(privacy).some(function (key) { return privacy[key] !== false; }) ||
      !exactObject(acceptance,['sourceContractsRevalidated','wholePart10FunctionalBoundaryPresent',
        'paidDemoIsolationAccepted','failureRetryRevocationPrivacyBoundaryPresent',
        'independentWholeHeadAuditAccepted','firstPayingCustomerLiveMoneyValidated',
        'founderVisualApprovalAccepted']) || acceptance.sourceContractsRevalidated !== true ||
      acceptance.wholePart10FunctionalBoundaryPresent !== true ||
      acceptance.paidDemoIsolationAccepted !== true ||
      acceptance.failureRetryRevocationPrivacyBoundaryPresent !== true ||
      acceptance.independentWholeHeadAuditAccepted !== false ||
      acceptance.firstPayingCustomerLiveMoneyValidated !== false ||
      acceptance.founderVisualApprovalAccepted !== false ||
      value.exactCurrentnessRevalidated !== true || counts.some(function (count) { return count !== 0; });
  }
  function invalidPart11(value, expectedMode) {
    var witness=value&&value.previewWitness, part10Witness=value&&value.part10Witness;
    var tax=value&&value.taxAccountingBoundary, retention=value&&value.retentionHold;
    var adapter=value&&value.adapterLifecycle, access=value&&value.access;
    var privacy=value&&value.privacy, acceptance=value&&value.acceptance;
    var expectedParts=[
      ['11A','m27-accounting-export-contract-v1','unavailable','accounting_export_source_facts_unavailable'],
      ['11B','m27-accounting-export-readiness-v1','unavailable','accounting_destination_and_export_authority_unavailable'],
      ['11C','m27-accounting-reconciliation-readiness-v1','unavailable','accounting_acknowledgement_and_reconciliation_authority_unavailable'],
    ];
    var expectedTaxPins=['jurisdiction','basis','rate','amount','currency','rounding_version','decision_digest'];
    var expectedHolds=['legal','tax','accounting','provider','security'];
    var expectedAdapterStates=['connection_unavailable','disconnect_unavailable','regrant_unavailable'];
    var counts=value&&[value.exportRecordCount,value.destinationSelectionCount,
      value.mappingReviewCount,value.transmissionCount,value.acknowledgementCount,
      value.reconciliationRecordCount,value.reconciliationCorrectionCount,
      value.retentionDeletionCount,value.adapterConnectionMutationCount,
      value.accountingMutationCount,value.northStarSourceMutationCount,
      value.externalRecordMutationCount,value.providerCallCount,value.receiverMutationCount,
      value.liveMoneyMovementCount];
    return !exactObject(value,['contractVersion','policyVersion','policyDigest','state','reason',
      'mode','fictional','previewWitness','part10Witness','sourceParts','taxAccountingBoundary',
      'retentionHold','adapterLifecycle','access','privacy','acceptance',
      'exactCurrentnessRevalidated','exportRecordCount','destinationSelectionCount',
      'mappingReviewCount','transmissionCount','acknowledgementCount',
      'reconciliationRecordCount','reconciliationCorrectionCount','retentionDeletionCount',
      'adapterConnectionMutationCount','accountingMutationCount','northStarSourceMutationCount',
      'externalRecordMutationCount','providerCallCount','receiverMutationCount',
      'liveMoneyMovementCount']) || value.contractVersion!=='m27-accounting-part11-acceptance-v1' ||
      value.policyVersion!=='mission27.launch.v1' ||
      value.policyDigest!=='d24c8c83f6076cedbcf916d5a9f95240fdd4aa72758c930ea511336fa5b3c56a' ||
      value.state!=='unavailable' || value.reason!=='part11_accounting_evidence_unavailable' ||
      !['paid','demo'].includes(expectedMode) || value.mode!==expectedMode ||
      value.fictional!==(expectedMode==='demo') ||
      !exactObject(witness,['contractVersion','mode','draftRevision','draftDigest','previewDigest']) ||
      witness.contractVersion!=='m27-invoice-part5-preview-witness-v1' || witness.mode!==expectedMode ||
      !Number.isSafeInteger(witness.draftRevision) || witness.draftRevision<0 ||
      !/^[0-9a-f]{64}$/.test(witness.draftDigest||'') ||
      !/^[0-9a-f]{64}$/.test(witness.previewDigest||'') ||
      !exactObject(part10Witness,['contractVersion','state','reason','digest']) ||
      part10Witness.contractVersion!=='m27-collection-part10-acceptance-v1' ||
      part10Witness.state!=='unavailable' ||
      part10Witness.reason!=='part10_collection_evidence_unavailable' ||
      !/^[0-9a-f]{64}$/.test(part10Witness.digest||'') ||
      !Array.isArray(value.sourceParts) || value.sourceParts.length!==expectedParts.length ||
      value.sourceParts.some(function(part,index){var expected=expectedParts[index];
        return !exactObject(part,['part','contractVersion','state','reason','digest']) ||
          part.part!==expected[0] || part.contractVersion!==expected[1] ||
          part.state!==expected[2] || part.reason!==expected[3] ||
          !/^[0-9a-f]{64}$/.test(part.digest||'');}) ||
      new Set(value.sourceParts.map(function(part){return part.digest;})).size!==3 ||
      !exactObject(tax,['state','reason','value','providerTaxCalculationEnabled',
        'exactCurrentMission24TaxDecisionRequired','taxRequiredPins','filingOrNexusAuthority',
        'configuredAccountingAdapter','configuredAccountingMode','accountingRuntimeAvailable',
        'accountingMayInventChartOfAccounts','accountingMayDecideRecognitionOrTax',
        'accountingMaySupplyCheckClearance','legalReviewAccepted','taxReviewAccepted',
        'accountingReviewAccepted','providerReviewAccepted','securityReviewAccepted',
        'journalTaxFilingRevenueRecognitionOrBooksCloseAuthorized']) ||
      tax.state!=='unavailable' || tax.reason!=='tax_and_accounting_review_unavailable' ||
      tax.value!==null || tax.providerTaxCalculationEnabled!==false ||
      tax.exactCurrentMission24TaxDecisionRequired!==true ||
      !Array.isArray(tax.taxRequiredPins) || tax.taxRequiredPins.join(',')!==expectedTaxPins.join(',') ||
      tax.filingOrNexusAuthority!==false ||
      tax.configuredAccountingAdapter!=='quickbooks_online.accounting_export.v1' ||
      tax.configuredAccountingMode!=='sandbox' || tax.accountingRuntimeAvailable!==false ||
      tax.accountingMayInventChartOfAccounts!==false ||
      tax.accountingMayDecideRecognitionOrTax!==false || tax.accountingMaySupplyCheckClearance!==false ||
      tax.legalReviewAccepted!==false || tax.taxReviewAccepted!==false ||
      tax.accountingReviewAccepted!==false || tax.providerReviewAccepted!==false ||
      tax.securityReviewAccepted!==false ||
      tax.journalTaxFilingRevenueRecognitionOrBooksCloseAuthorized!==false ||
      !exactObject(retention,['contractVersion','state','reason','value','recognizedHoldPurposes',
        'financialRecordCalendarYears','immutableIdempotencyAndAuditCalendarYears',
        'holdsSuspendEligibleDeletion','legalTaxAccountingProviderSecurityReviewComplete',
        'currentRetentionAuthorityState','currentHoldState','currentDeletionAuthorityState',
        'requiredDeletionCapability','exactRecordPolicyHoldAndSourcePinsRequired',
        'missingRetentionOrHoldStateMayAuthorizeDeletion',
        'disconnectMayDeleteSourceExportAcknowledgementReconciliationOrAudit',
        'holdReleaseMayRewriteOrBackdateRecord','deletionAuthorized']) ||
      retention.contractVersion!=='m27-accounting-retention-hold-v1' ||
      retention.state!=='unavailable' || retention.reason!=='source_retention_unavailable' ||
      retention.value!==null || !Array.isArray(retention.recognizedHoldPurposes) ||
      retention.recognizedHoldPurposes.join(',')!==expectedHolds.join(',') ||
      retention.financialRecordCalendarYears!==7 ||
      retention.immutableIdempotencyAndAuditCalendarYears!==7 ||
      retention.holdsSuspendEligibleDeletion!==true ||
      retention.legalTaxAccountingProviderSecurityReviewComplete!==false ||
      retention.currentRetentionAuthorityState!=='unavailable' ||
      retention.currentHoldState!=='unavailable' || retention.currentDeletionAuthorityState!=='unavailable' ||
      retention.requiredDeletionCapability!=='customer_financial.record.delete' ||
      retention.exactRecordPolicyHoldAndSourcePinsRequired!==true ||
      retention.missingRetentionOrHoldStateMayAuthorizeDeletion!==false ||
      retention.disconnectMayDeleteSourceExportAcknowledgementReconciliationOrAudit!==false ||
      retention.holdReleaseMayRewriteOrBackdateRecord!==false || retention.deletionAuthorized!==false ||
      !exactObject(adapter,['contractVersion','exactStates','state','reason','value',
        'configuredAdapter','configuredMode','runtimeAvailable','currentConnectionState',
        'currentGrantState','currentDisconnectAuthorityState','currentRegrantAuthorityState',
        'ownerActionSpecificCapabilityRequired','currentRecentAuthenticationAndMfaRequired',
        'exactTenantAdapterModeDestinationMappingAndReasonRequired','automaticReconnectAllowed',
        'disconnectStopsNewPreviewTransmissionAcknowledgementAndReconciliation',
        'disconnectMayRewriteNorthStarOrExternalFacts','disconnectMayDeleteImmutableReceiptsOrAudit',
        'priorGrantCredentialDestinationMappingOrReceiptMayBeReusedAfterDisconnect',
        'regrantRequiresFreshReviewedAuthority','roleAloneAuthorizesDisconnectOrRegrant',
        'disconnectAuthorized','regrantAuthorized']) ||
      adapter.contractVersion!=='m27-accounting-adapter-lifecycle-v1' ||
      !Array.isArray(adapter.exactStates) || adapter.exactStates.join(',')!==expectedAdapterStates.join(',') ||
      adapter.state!=='unavailable' || adapter.reason!=='accounting_adapter_unavailable' ||
      adapter.value!==null || adapter.configuredAdapter!=='quickbooks_online.accounting_export.v1' ||
      adapter.configuredMode!=='sandbox' || adapter.runtimeAvailable!==false ||
      adapter.currentConnectionState!=='unavailable' || adapter.currentGrantState!=='unavailable' ||
      adapter.currentDisconnectAuthorityState!=='unavailable' ||
      adapter.currentRegrantAuthorityState!=='unavailable' ||
      adapter.ownerActionSpecificCapabilityRequired!==true ||
      adapter.currentRecentAuthenticationAndMfaRequired!==true ||
      adapter.exactTenantAdapterModeDestinationMappingAndReasonRequired!==true ||
      adapter.automaticReconnectAllowed!==false ||
      adapter.disconnectStopsNewPreviewTransmissionAcknowledgementAndReconciliation!==true ||
      adapter.disconnectMayRewriteNorthStarOrExternalFacts!==false ||
      adapter.disconnectMayDeleteImmutableReceiptsOrAudit!==false ||
      adapter.priorGrantCredentialDestinationMappingOrReceiptMayBeReusedAfterDisconnect!==false ||
      adapter.regrantRequiresFreshReviewedAuthority!==true ||
      adapter.roleAloneAuthorizesDisconnectOrRegrant!==false ||
      adapter.disconnectAuthorized!==false || adapter.regrantAuthorized!==false ||
      !exactObject(access,['eligiblePaidReadRoles','currentTenantSessionRequired',
        'currentSubscriptionRequired','roleAloneAuthorizesAccountingAction',
        'demoPhysicallyAndLogicallyIsolated','customerOrPublicAccessAllowed','tenantCrossingAllowed']) ||
      !Array.isArray(access.eligiblePaidReadRoles) || access.eligiblePaidReadRoles.join(',')!=='owner,admin' ||
      access.currentTenantSessionRequired!==true || access.currentSubscriptionRequired!==true ||
      access.roleAloneAuthorizesAccountingAction!==false ||
      access.demoPhysicallyAndLogicallyIsolated!==true ||
      access.customerOrPublicAccessAllowed!==false || access.tenantCrossingAllowed!==false ||
      !exactObject(privacy,['tenantOrCustomerIdentityExposed',
        'sourceRecordAmountCurrencyOrTimestampExposed','destinationAccountCompanyOrMappingExposed',
        'exportRequestAcknowledgementOrExternalRecordExposed',
        'retentionHoldOrDeletionTargetIdentityExposed','adapterCredentialSecretOrIdempotencyKeyExposed',
        'actorApproverOrReviewerIdentityExposed']) ||
      Object.keys(privacy).some(function(key){return privacy[key]!==false;}) ||
      !exactObject(acceptance,['sourceContractsRevalidated','wholePart11FunctionalBoundaryPresent',
        'paidDemoIsolationAccepted','taxAccountingRetentionHoldAndAdapterLifecycleBoundaryPresent',
        'independentWholeHeadAuditAccepted','productionPerformanceSlaAccepted',
        'firstPayingCustomerLiveMoneyValidated','founderVisualApprovalAccepted']) ||
      acceptance.sourceContractsRevalidated!==true ||
      acceptance.wholePart11FunctionalBoundaryPresent!==true || acceptance.paidDemoIsolationAccepted!==true ||
      acceptance.taxAccountingRetentionHoldAndAdapterLifecycleBoundaryPresent!==true ||
      acceptance.independentWholeHeadAuditAccepted!==false ||
      acceptance.productionPerformanceSlaAccepted!==false ||
      acceptance.firstPayingCustomerLiveMoneyValidated!==false ||
      acceptance.founderVisualApprovalAccepted!==false ||
      value.exactCurrentnessRevalidated!==true ||
      counts.some(function(count){return count!==0;});
  }
  function invalidPart11SourceWitnesses(acceptance, sourceContracts, part10Acceptance) {
    if (!exactObject(sourceContracts,['part11A','part11B','part11C']) ||
        !acceptance || !Array.isArray(acceptance.sourceParts) ||
        acceptance.sourceParts.length!==3 || !part10Acceptance) return Promise.resolve(true);
    var sources=[sourceContracts.part11A,sourceContracts.part11B,sourceContracts.part11C];
    var semantic=sources.map(function(value,index){
      return part11SourceSemanticProjection(value,['11A','11B','11C'][index]);
    });
    if (semantic.some(function(value){return !value;})) return Promise.resolve(true);
    return Promise.all([
      digestObject(part10Acceptance),digestObject(sources[0]),digestObject(sources[1]),
      digestObject(sources[2]),digestObject(semantic[0]),digestObject(semantic[1]),
      digestObject(semantic[2]),
    ]).then(function(digests){
      return sources[0].part10Witness.digest!==digests[0] ||
        sources[1].sourceWitness.digest!==digests[1] ||
        sources[2].sourceWitness.digest!==digests[2] ||
        sources[2].sourceWitness.exportContractDigest!==digests[1] ||
        acceptance.sourceParts.some(function(part,index){return part.digest!==digests[index+1];}) ||
        PART11_SOURCE_SEMANTIC_DIGESTS.some(function(expected,index){
          return digests[index+4]!==expected;
        });
    }).catch(function(){return true;});
  }
  function samePart11Witness(preview, acceptance, part10Acceptance) {
    var identity=preview&&preview.draftIdentity, witness=acceptance&&acceptance.previewWitness;
    var part10Witness=acceptance&&acceptance.part10Witness;
    if (!identity||!witness||!part10Witness||!part10Acceptance) return Promise.resolve(false);
    return digestObject(part10Acceptance).then(function(digest){
      return identity.revision===witness.draftRevision &&
        identity.draftDigest===witness.draftDigest && preview.previewDigest===witness.previewDigest &&
        part10Witness.contractVersion===part10Acceptance.contractVersion &&
        part10Witness.state===part10Acceptance.state &&
        part10Witness.reason===part10Acceptance.reason && part10Witness.digest===digest;
    }).catch(function(){return false;});
  }
  var PART12_DYNAMIC_MARKER='__EXACT_CURRENT_VALUE__';
  var PART12_SOURCE_DIGESTS=Object.freeze([
    '0f51c0015195e5031fa8fd014d9958f86e504cc89c21f6487828adc6a42a54b4',
    '34dcc5811f94ea35c5d5fc7266698f781558f8cde0682b4630fea9c1818304e2',
    '0aa1a18404e13670c9247231f32fa849d114a9bf0022538de58eae14a208afa1',
  ]);
  var PART12_SEMANTIC_DIGEST='19fa94e22180860c0a1a0a4ab85ec8541f853e8437a1a8015b587416069f86a4';
  function part12SemanticProjection(value,expectedMode) {
    if (!value||typeof value!=='object'||Array.isArray(value)||
        value.mode!==expectedMode||value.fictional!==(expectedMode==='demo')) return null;
    var witness=value.previewWitness, part11Witness=value.part11Witness;
    if (!exactObject(witness,['contractVersion','mode','draftRevision','draftDigest','previewDigest']) ||
        witness.contractVersion!=='m27-invoice-part5-preview-witness-v1' ||
        witness.mode!==expectedMode || !Number.isSafeInteger(witness.draftRevision) ||
        witness.draftRevision<0 || !/^[0-9a-f]{64}$/.test(witness.draftDigest||'') ||
        !/^[0-9a-f]{64}$/.test(witness.previewDigest||'') ||
        !exactObject(part11Witness,['contractVersion','state','reason','digest']) ||
        part11Witness.contractVersion!=='m27-accounting-part11-acceptance-v1' ||
        part11Witness.state!=='unavailable' ||
        part11Witness.reason!=='part11_accounting_evidence_unavailable' ||
        !/^[0-9a-f]{64}$/.test(part11Witness.digest||'')) return null;
    if (!Array.isArray(value.sourceWitnesses)||value.sourceWitnesses.length!==3 ||
        value.sourceWitnesses.some(function(source,index){
          return source.digest!==PART12_SOURCE_DIGESTS[index];
        })) return null;
    var projected=JSON.parse(JSON.stringify(value));
    projected.mode=PART12_DYNAMIC_MARKER;
    projected.fictional=PART12_DYNAMIC_MARKER;
    projected.previewWitness.mode=PART12_DYNAMIC_MARKER;
    projected.previewWitness.draftRevision=PART12_DYNAMIC_MARKER;
    projected.previewWitness.draftDigest=PART12_DYNAMIC_MARKER;
    projected.previewWitness.previewDigest=PART12_DYNAMIC_MARKER;
    projected.part11Witness.digest=PART12_DYNAMIC_MARKER;
    return projected;
  }
  function invalidPart12(value,expectedMode) {
    var projected=part12SemanticProjection(value,expectedMode);
    if (!projected) return Promise.resolve(true);
    return digestObject(projected).then(function(digest){
      return digest!==PART12_SEMANTIC_DIGEST;
    }).catch(function(){return true;});
  }
  function samePart12Witness(preview,acceptance,part11Acceptance) {
    var identity=preview&&preview.draftIdentity, witness=acceptance&&acceptance.previewWitness;
    var part11Witness=acceptance&&acceptance.part11Witness;
    if (!identity||!witness||!part11Witness||!part11Acceptance) return Promise.resolve(false);
    return digestObject(part11Acceptance).then(function(digest){
      return identity.revision===witness.draftRevision &&
        identity.draftDigest===witness.draftDigest && preview.previewDigest===witness.previewDigest &&
        part11Witness.contractVersion===part11Acceptance.contractVersion &&
        part11Witness.state===part11Acceptance.state &&
        part11Witness.reason===part11Acceptance.reason && part11Witness.digest===digest;
    }).catch(function(){return false;});
  }
  function mount(review, host) {
    if (!review || !host || !review.pins || !review.pins.estimateId) return null;
    var estimateId = String(review.pins.estimateId);
    var resumeMutationRecovery = shouldResumeMutationRecovery(activeDisclosureMount, host, estimateId);
    injectStyles(); var mountToken = ++mountGeneration, requestToken = 0, data = null,
      part5 = null, part6 = null, part7 = null, part9 = null, part10 = null, part11 = null,
      part12 = null, part14b = null,
      context = null;
    var desiredOpenState = resumeMutationRecovery, keyboardActivationState = null,
      mutationRecoveryActive = resumeMutationRecovery;
    var expectedDemoRevision = review.simulated ?
      Number(document.documentElement.dataset.demoRevision) : null;
    var section = node('details', undefined, host, 'invoice-draft-preview');
    var summary = node('summary', review.simulated ? 'Review fictional invoice draft' : 'Review invoice draft', section);
    var body = node('div', undefined, section, 'invoice-draft-preview-body');
    var base = '/api/v1/customer-financial/editable-estimates/' + encodeURIComponent(review.pins.estimateId);
    function active(token) { return token === requestToken && mountToken === mountGeneration && section.isConnected; }
    function clearAndStatus(text, alert) {
      data = null; part5 = null; part6 = null; part7 = null; part9 = null; part10 = null;
      part11 = null; part12 = null; part14b = null; context = null; body.replaceChildren();
      var status = node('p', text, body, 'invoice-draft-preview-status');
      status.setAttribute('role', alert ? 'alert' : 'status'); status.setAttribute('aria-live', 'polite');
      status.tabIndex = -1; status.focus(); return status;
    }
    function invalidateDemoMount() {
      requestToken += 1;
      clearAndStatus('The invoice draft changed. Reload its exact current evidence.', true);
    }
    activeDemoMount = review.simulated ? { expectedRevision: expectedDemoRevision,
      section: section, invalidate: invalidateDemoMount,
      validate: function(value){return render(value,requestToken);} } : null;
    function invalid(value) {
      return !value || value.contractVersion !== 'm27-invoice-draft-preview-v1' ||
        value.state !== 'current' || value.sourceCurrent !== true ||
        value.reconciliation?.amountDue?.state !== 'unavailable' || value.reconciliation.amountDue.value !== null ||
        value.documentPreview?.issuedDocument !== false || !Array.isArray(value.documentPreview?.lines) ||
        !/^[0-9a-f]{64}$/.test(value.previewDigest || '');
    }
    function invalidPart5(value) {
      var finalReview = value && value.finalReview, issue = value && value.issueReadiness;
      var lifecycle = value && value.lifecycle, correction = value && value.postIssueCorrection;
      var witness = value && value.previewWitness;
      return !value || value.contractVersion !== 'm27-invoice-part5-acceptance-v1' ||
        value.state !== 'unavailable' || value.reason !== 'invoice_issue_authority_unavailable' ||
        value.mode !== (review.simulated ? 'demo' : 'paid') || value.fictional !== !!review.simulated ||
        witness?.contractVersion !== 'm27-invoice-part5-preview-witness-v1' ||
        witness.mode !== value.mode ||
        !Number.isSafeInteger(witness.draftRevision) || witness.draftRevision < 0 ||
        !/^[0-9a-f]{64}$/.test(witness.draftDigest || '') ||
        !/^[0-9a-f]{64}$/.test(witness.previewDigest || '') ||
        value.exactCurrentnessRevalidated !== true ||
        finalReview?.contractVersion !== 'm27-invoice-final-review-v1' ||
        finalReview.state !== 'unavailable' || finalReview.value !== null ||
        issue?.contractVersion !== 'm27-invoice-issue-readiness-v1' ||
        issue.state !== 'unavailable' || issue.value !== null ||
        lifecycle?.contractVersion !== 'm27-invoice-lifecycle-projection-v1' ||
        lifecycle.state !== 'unavailable' || lifecycle.value !== null ||
        !Array.isArray(lifecycle.axes) || lifecycle.axes.length !== 7 ||
        correction?.contractVersion !== 'm27-invoice-post-issue-correction-v1' ||
        correction.state !== 'unavailable' || correction.value !== null ||
        !Array.isArray(correction.records) || correction.records.length !== 4 ||
        finalReview.approvalAuthorized !== false || finalReview.invoiceAuthorized !== false ||
        finalReview.issueAuthorized !== false || finalReview.receivableAuthorized !== false ||
        issue.approvalCurrent !== false || issue.numberReservationAuthorized !== false ||
        issue.numberAssigned !== false || issue.issueReceiptCreated !== false ||
        issue.invoiceAuthorized !== false || issue.receivableAuthorized !== false ||
        lifecycle.axes.some(function (axis) {
          return axis.state !== 'unavailable' || axis.value !== null;
        }) || lifecycle.reminderAuthorized !== false || lifecycle.feeAuthorized !== false ||
        lifecycle.collectionAuthorized !== false || lifecycle.automaticChargeAuthorized !== false ||
        correction.records.some(function (record) {
          return record.state !== 'unavailable' || record.value !== null ||
            record.appendOnlyRecordAuthorized !== false || record.issuedVersionMutationAuthorized !== false;
        }) || correction.creditRecordAuthorized !== false || correction.debitRecordAuthorized !== false ||
        correction.replacementRecordAuthorized !== false || correction.voidRecordAuthorized !== false ||
        [finalReview,issue,lifecycle,correction].some(function (stage) {
          return stage.providerCallCount !== 0 || stage.receiverMutationCount !== 0;
        }) ||
        [value.approvalAuthorized,value.issueAuthorized,value.reminderAuthorized,
          value.feeAuthorized,value.collectionAuthorized,value.automaticChargeAuthorized,
          value.correctionAuthorized].some(function (allowed) { return allowed !== false; }) ||
        value.providerCallCount !== 0 || value.receiverMutationCount !== 0;
    }
    function samePart5Witness(preview, acceptance) {
      var identity = preview && preview.draftIdentity, witness = acceptance && acceptance.previewWitness;
      return !!identity && !!witness && identity.revision === witness.draftRevision &&
        identity.draftDigest === witness.draftDigest && preview.previewDigest === witness.previewDigest;
    }
    function invalidPart6(value) {
      var witness = value && value.previewWitness, documentValue = value && value.document;
      var session = value && value.publicSession, portal = value && value.customerPortal;
      var delivery = value && value.delivery;
      var actionNames = ['email_delivery_handoff','sms_delivery_handoff','resend',
        'revoke_customer_access','delivery_recovery','mission28_broader_communication_handoff'];
      var requirementNames = ['exact_current_issued_document','reviewed_recipient_and_delivery_choice',
        'customer_financial_invoice_send_capability','recent_auth_and_required_control',
        'exact_delivery_idempotency','delivery_evidence_receipt',
        'scoped_customer_access_revocation','mission28_broader_communication_adapter'];
      var denied = [value?.emailDeliveryAuthorized,value?.smsDeliveryAuthorized,
        value?.resendAuthorized,value?.revocationAuthorized,value?.recoveryAuthorized,
        value?.mission28HandoffAuthorized,value?.messageSent,value?.deliveryReceiptCreated,
        value?.accessRevocationRecorded,value?.automaticSendAuthorized,
        value?.automaticRetryAuthorized];
      return !value || value.contractVersion !== 'm27-invoice-part6-acceptance-v1' ||
        value.state !== 'unavailable' || value.reason !== 'issued_invoice_unavailable' ||
        value.mode !== (review.simulated ? 'demo' : 'paid') || value.fictional !== !!review.simulated ||
        witness?.contractVersion !== 'm27-invoice-part5-preview-witness-v1' ||
        !Number.isSafeInteger(witness.draftRevision) || witness.draftRevision < 0 ||
        !/^[0-9a-f]{64}$/.test(witness.draftDigest || '') ||
        !/^[0-9a-f]{64}$/.test(witness.previewDigest || '') ||
        documentValue?.contractVersion !== 'm27-customer-invoice-document-v1' ||
        documentValue.state !== 'unavailable' || documentValue.value !== null ||
        session?.contractVersion !== 'm27-invoice-public-session-v1' ||
        session.state !== 'unavailable' || session.value !== null ||
        portal?.contractVersion !== 'm27-invoice-customer-portal-v1' ||
        portal.state !== 'unavailable' || portal.value !== null ||
        delivery?.contractVersion !== 'm27-invoice-delivery-readiness-v1' ||
        delivery.state !== 'unavailable' || delivery.value !== null ||
        !Array.isArray(delivery.requirements) || delivery.requirements.length !== requirementNames.length ||
        delivery.requirements.some(function (requirement, index) {
          return !requirement || Object.keys(requirement).length !== 2 ||
            requirement.requirement !== requirementNames[index] || requirement.state !== 'unavailable';
        }) ||
        !Array.isArray(delivery.actions) || delivery.actions.length !== actionNames.length ||
        delivery.actions.some(function (action, index) {
          return action.action !== actionNames[index] || action.state !== 'unavailable' ||
            action.value !== null || action.authorized !== false;
        }) || value.exactCurrentnessRevalidated !== true || value.exactDocumentCurrent !== false ||
        value.recipientReviewed !== false || value.explicitDeliveryChoiceCurrent !== false ||
        value.invoiceSendCapabilityCurrent !== false || value.recentAuthenticationCurrent !== false ||
        value.customerSessionCurrent !== false || denied.some(function (allowed) { return allowed !== false; }) ||
        value.providerCallCount !== 0 || value.receiverMutationCount !== 0 ||
        value.outboundMessageCount !== 0;
    }
    function samePart6Witness(preview, acceptance) {
      var identity = preview && preview.draftIdentity, witness = acceptance && acceptance.previewWitness;
      return !!identity && !!witness && identity.revision === witness.draftRevision &&
        identity.draftDigest === witness.draftDigest && preview.previewDigest === witness.previewDigest;
    }
    function samePart7Witness(preview, acceptance) {
      var identity = preview && preview.draftIdentity, witness = acceptance && acceptance.previewWitness;
      return !!identity && !!witness && identity.revision === witness.draftRevision &&
        identity.draftDigest === witness.draftDigest && preview.previewDigest === witness.previewDigest;
    }
    function samePart9Witness(preview, acceptance) {
      var identity = preview && preview.draftIdentity, witness = acceptance && acceptance.previewWitness;
      return !!identity && !!witness && identity.revision === witness.draftRevision &&
        identity.draftDigest === witness.draftDigest && preview.previewDigest === witness.previewDigest;
    }
    function samePart10Witness(preview, acceptance, part9Acceptance) {
      var identity = preview && preview.draftIdentity, witness = acceptance && acceptance.previewWitness;
      var part9Witness = acceptance && acceptance.part9Witness;
      return !!identity && !!witness && !!part9Witness &&
        identity.revision === witness.draftRevision &&
        identity.draftDigest === witness.draftDigest && preview.previewDigest === witness.previewDigest &&
        part9Witness.contractVersion === part9Acceptance.contractVersion &&
        part9Witness.state === part9Acceptance.state && part9Witness.reason === part9Acceptance.reason;
    }
    function invalidBundle(value) {
      return !value || value.contractVersion !== 'm27-reporting-part12-preview-bundle-v1' ||
        !exactOrdered(value,['contractVersion','preview','part5Acceptance','part6Acceptance',
          'part7Acceptance','part9Acceptance','part10Acceptance','part11SourceContracts',
          'part11Acceptance','part12Acceptance']);
    }
    function workflowHeading(text) {
      body.replaceChildren(); var card = node('section', undefined, body, 'invoice-draft-workflow-step');
      var heading = node('h4', text, card, 'invoice-draft-preview-heading'); heading.tabIndex = -1;
      heading.focus(); return card;
    }
    function confirmation(form, defaultReason, label) {
      var reasonLabel = node('label', undefined, form, 'invoice-draft-workflow-field');
      node('span', 'Review reason', reasonLabel); var reason = node('textarea', undefined, reasonLabel);
      reason.required = true; reason.minLength = 12; reason.maxLength = 1000; reason.value = defaultReason;
      var confirmLabel = node('label', undefined, form); var confirm = node('input', undefined, confirmLabel);
      confirm.type = 'checkbox'; confirm.required = true; node('span', ' ' + label, confirmLabel);
      return { reason: reason, confirm: confirm };
    }
    function capabilityBody(capability) {
      return { capabilityGrantId: capability.grantId,
        capabilityGrantRevision: Number(capability.revision),
        businessPurpose: capability.businessPurpose, policyVersion: capability.policyVersion };
    }
    function mutate(url, value) {
      var token = ++requestToken; clearAndStatus('Saving the exact reviewed invoice draft…', false);
      return post(url, value).then(function () {
        return recoverAfterSuccessfulMutation({ section: section,
          active: function () { return active(token); },
          beforeOpen: function () { mutationRecoveryActive = true; desiredOpenState = true; },
          reload: load }).finally(function () { mutationRecoveryActive = false; });
      })
        .catch(function (error) { if (active(token)) rejected(error); });
    }
    function renderOrigin(origin, capability, receipt) {
      context = { capability: capability, receipt: receipt, origin: origin };
      var card = workflowHeading('Capture the reviewed invoice source');
      node('p', 'This pins the current reviewed final-balance handoff and its customer-safe Mission 24 lines. It does not create or issue an invoice.', card,
        'invoice-draft-preview-boundary');
      var form = node('form', undefined, card, 'invoice-draft-workflow-form');
      var controls = confirmation(form, 'Capture this reviewed customer-safe invoice source.',
        'I reviewed this exact final-balance source and want to create its immutable draft origin.');
      var submit = node('button', 'Capture reviewed invoice source', form, 'btn btn-primary'); submit.type = 'submit';
      form.onsubmit = function (event) { event.preventDefault(); if (!form.reportValidity()) return;
        mutate(base + '/invoice-draft-origin', Object.assign({ handoffReceiptId: receipt.receiptId,
          handoffReceiptDigest: receipt.receiptDigest, expectedCandidateDigest: origin.candidateDigest,
          reason: controls.reason.value.trim(), confirmed: controls.confirm.checked,
          confirmationVersion: 'm27-invoice-draft-origin-capture-v1' }, capabilityBody(capability))); };
    }
    function renderDraft(draft, capability, receipt) {
      context = { capability: capability, receipt: receipt, draft: draft };
      var card = workflowHeading('Review customer-facing invoice lines');
      node('p', 'Edit wording and grouping while preserving every server-provided allocation and the accepted commercial subtotal.', card,
        'invoice-draft-preview-boundary');
      var form = node('form', undefined, card, 'invoice-draft-workflow-form');
      var inputs = draft.lines.map(function (line) {
        var row = node('div', undefined, form, 'invoice-draft-workflow-line');
        var groupLabel = node('label', undefined, row); node('span', 'Group', groupLabel);
        var group = node('input', undefined, groupLabel); group.value = line.group; group.required = true; group.maxLength = 120;
        var descriptionLabel = node('label', undefined, row); node('span', 'Customer description', descriptionLabel);
        var description = node('input', undefined, descriptionLabel); description.value = line.description;
        description.required = true; description.maxLength = 500;
        node('span', money(line.allocatedAmount), row, 'invoice-draft-workflow-amount');
        return { source: line, group: group, description: description };
      });
      var controls = confirmation(form, 'Review customer wording and exact invoice allocations.',
        'I reviewed every description, group, and unchanged exact allocation.');
      var submit = node('button', 'Save reviewed invoice draft', form, 'btn btn-primary'); submit.type = 'submit';
      form.onsubmit = function (event) { event.preventDefault(); if (!form.reportValidity()) return;
        var edit = { contractVersion: 'm27-invoice-draft-edit-v1', originId: draft.originId,
          originDigest: draft.originDigest, lines: inputs.map(function (entry, ordinal) { return {
            ordinal: ordinal, sourceLineDigest: entry.source.sourceLineDigest,
            group: entry.group.value.trim(), description: entry.description.value.trim(),
            allocatedMinorUnits: entry.source.allocatedAmount.minorUnits }; }) };
        mutate(base + '/invoice-draft', Object.assign({ handoffReceiptId: receipt.receiptId,
          handoffReceiptDigest: receipt.receiptDigest, expectedRevision: Number(draft.revision),
          expectedDraftDigest: draft.draftDigest, draft: edit, reason: controls.reason.value.trim(),
          confirmed: controls.confirm.checked,
          confirmationVersion: 'm27-invoice-draft-revision-save-v1' }, capabilityBody(capability))); };
    }
    function renderTax(tax, capability, receipt, draft) {
      context = { capability: capability, receipt: receipt, draft: draft, tax: tax };
      var card = workflowHeading('Record the invoice-date tax preparation');
      var preparation = tax.preparation || {}, liability = preparation.collectedTaxLiability || {};
      node('p', 'Invoice date ' + (preparation.invoiceDate || 'unavailable') + ' · service ' +
        (preparation.serviceJurisdiction?.region || 'unavailable') + ' · billing ' +
        (preparation.billingJurisdiction?.region || 'unavailable') + ' · prepared tax ' +
        money(liability.amount) + '.', card);
      node('p', 'Professional tax policy remains unavailable. Recording this exact preparation does not authorize approval, issue, delivery, a receivable, or collection.', card,
        'invoice-draft-preview-boundary');
      var evidence = node('details', undefined, card, 'invoice-draft-tax-evidence'); evidence.open = true;
      node('summary', 'Exact tax preparation evidence to review', evidence);
      node('p', 'Every value below is the bounded server-owned preparation that this review records. Missing authority stays unavailable.', evidence);
      var table = node('table', undefined, evidence, 'invoice-draft-preview-lines');
      var caption = node('caption', 'Prepared line tax evidence', table, 'sr-only');
      caption.textContent = 'Prepared line tax evidence';
      var head = node('thead', undefined, table), headRow = node('tr', undefined, head);
      ['Line','Treatment','Mode','Rate','Taxable basis','Prepared tax','Provenance'].forEach(function (label) {
        var heading = node('th', label, headRow); heading.scope = 'col';
      });
      var tableBody = node('tbody', undefined, table);
      (preparation.lines || []).forEach(function (line) {
        var row = node('tr', undefined, tableBody), source = line.source || {};
        var provenance = ['Mission 24 line ' + (line.mission24LineId || 'not recorded'),
          'tax group ' + (line.taxGroupId || 'not recorded'),
          'invoice source digest ' + (line.invoiceSourceLineDigest || 'not recorded'),
          source.kind, source.jurisdiction, source.location, source.serviceKey,
          source.collectionBasis, source.reference, source.effectiveOn,
          source.endsOn || 'open-ended', source.reviewedOn, source.reviewValidThrough,
          source.ruleId, source.ruleDigest].map(function (value) { return value || 'not recorded'; }).join(' · ');
        [String(Number(line.ordinal) + 1), line.treatment, line.inclusiveExclusive,
          String(line.ratePercent) + '%', money(line.taxableBasis), money(line.collectedTax), provenance]
          .forEach(function (value, index) { var cell = node('td', value, row,
            index === 6 ? 'invoice-draft-tax-provenance' : undefined);
          cell.dataset.label = ['Line','Treatment','Mode','Rate','Taxable basis','Prepared tax','Provenance'][index]; });
      });
      var facts = node('dl', undefined, evidence);
      function fact(label, value) { node('dt', label, facts); node('dd', value, facts); }
      var registration = preparation.registrationEvidence || {};
      fact('Registration evidence', registration.state === 'source_snapshot' ?
        [registration.state, registration.registration, registration.registrationReference,
          registration.collectionBasis, registration.taxProfileId, 'revision ' + registration.taxProfileRevision,
          registration.taxProfileDigest].map(function (value) { return value || 'not recorded'; }).join(' · ') :
        'Unavailable · ' + (registration.reason || 'registration_evidence_unavailable'));
      var nexus = preparation.nexusEvidence || {};
      fact('Nexus evidence', (nexus.state || 'unavailable') + ' · ' +
        (nexus.reason || 'professional_tax_policy_unavailable'));
      var exemption = preparation.exemptionSnapshot || {};
      fact('Exemption snapshot', [exemption.classification, exemption.evidenceReference,
        exemption.profileExemptionReference].map(function (value) { return value || 'not recorded'; }).join(' · '));
      var rounding = preparation.rounding || {};
      fact('Rounding identity', [rounding.version, rounding.mode,
        'minor-unit exponent ' + String(rounding.minorUnitExponent)].join(' · '));
      fact('Separated collected-tax liability', [money(liability.amount), liability.arithmeticRole,
        'revenue recognition ' + (liability.revenueRecognitionAuthorized === true ? 'authorized' : 'not authorized'),
        'filing ' + (liability.filingAuthorized === true ? 'authorized' : 'not authorized')].join(' · '));
      var lineage = preparation.creditRefundAdjustmentLineage || {};
      fact('Credit/refund lineage', (lineage.state || 'unavailable') + ' · ' +
        (lineage.reason || 'credit_refund_lineage_unavailable'));
      var gaps = node('ul', undefined, evidence, 'invoice-draft-tax-gaps');
      (lineage.missingEvidence || []).forEach(function (gap) { node('li', 'Missing evidence · ' + gap, gaps); });
      fact('Professional tax policy', (tax.professionalPolicy?.state || 'unavailable') + ' · ' +
        (tax.professionalPolicy?.reason || 'tax_authority_unavailable'));
      var form = node('form', undefined, card, 'invoice-draft-workflow-form');
      var controls = confirmation(form, 'Review this exact invoice-date tax preparation evidence.',
        'I reviewed this exact preparation and understand professional tax authority remains unavailable.');
      var submit = node('button', 'Record tax preparation review', form, 'btn btn-primary'); submit.type = 'submit';
      form.onsubmit = function (event) { event.preventDefault(); if (!form.reportValidity()) return;
        mutate(base + '/invoice-draft/tax-review', Object.assign({ handoffReceiptId: receipt.receiptId,
          handoffReceiptDigest: receipt.receiptDigest, expectedCandidateDigest: tax.candidateDigest,
          reason: controls.reason.value.trim(), confirmed: controls.confirm.checked,
          confirmationVersion: 'm27-invoice-date-tax-review-record-v1' }, capabilityBody(capability))); };
    }
    function renderPart5(value) {
      var card = node('section', undefined, body, 'invoice-part5-acceptance');
      var headingId = 'invoicePart5AcceptanceHeading-' + String(mountToken);
      card.setAttribute('aria-labelledby', headingId);
      var heading = node('h5', 'Approval, issue, and invoice lifecycle', card,
        'invoice-part5-acceptance-heading'); heading.id = headingId;
      node('p', 'NorthStar rechecked the complete current invoice journey. Approval, issue, delivery, payment, reminders, fees, collection, and corrections stay unavailable until their exact evidence and authority exist.',
        card, 'invoice-draft-preview-boundary');
      var gates = node('dl', undefined, card, 'invoice-part5-gates');
      [['Final approval',value.finalReview.reason],['Number and issue',value.issueReadiness.reason],
        ['Lifecycle',value.lifecycle.reason],['Post-issue corrections',value.postIssueCorrection.reason]]
        .forEach(function (entry) { node('dt', entry[0], gates); node('dd', 'Unavailable · ' + entry[1], gates); });
      var axisHeading = node('h6', 'Seven independent lifecycle checks', card);
      var axes = node('ul', undefined, card, 'invoice-part5-axes');
      value.lifecycle.axes.forEach(function (axis) {
        node('li', axis.axis + ' · Unavailable · ' + axis.reason, axes);
      });
      var correctionHeading = node('h6', 'Append-only correction boundaries', card);
      var records = node('ul', undefined, card, 'invoice-part5-corrections');
      value.postIssueCorrection.records.forEach(function (record) {
        node('li', record.recordType + ' · Unavailable · ' + record.requiredControl, records);
      });
      node('p', (value.fictional ? 'Fictional demo boundary. ' : '') +
        'No provider, receiver, invoice, receivable, reminder, collection, correction, or money action occurred.',
        card, value.fictional ? 'invoice-draft-preview-demo' : 'invoice-draft-preview-boundary');
      axisHeading.className = 'invoice-part5-subheading'; correctionHeading.className = 'invoice-part5-subheading';
    }
    function renderPart6(value) {
      var card = node('section', undefined, body, 'invoice-part6-acceptance');
      var headingId = 'invoicePart6AcceptanceHeading-' + String(mountToken);
      card.setAttribute('aria-labelledby', headingId);
      var heading = node('h5', 'Customer document, portal, and delivery', card,
        'invoice-part6-acceptance-heading'); heading.id = headingId;
      node('p', 'NorthStar rechecked the complete current invoice journey. The customer document, secure session, portal, email or SMS handoff, resend, revoke, recovery, and broader Mission 28 communication handoff remain unavailable until their exact authority exists.',
        card, 'invoice-draft-preview-boundary');
      var gates = node('dl', undefined, card, 'invoice-part6-gates');
      [['Customer document',value.document.reason],['Secure public session',value.publicSession.reason],
        ['Customer portal',value.customerPortal.reason]]
        .forEach(function (entry) { node('dt', entry[0], gates); node('dd', 'Unavailable · ' + entry[1], gates); });
      var requirementHeading = node('h6', 'Eight required delivery prerequisites', card,
        'invoice-part6-subheading');
      requirementHeading.className = 'invoice-part6-subheading';
      var requirements = node('ul', undefined, card, 'invoice-part6-requirements');
      value.delivery.requirements.forEach(function (requirement) {
        node('li', requirement.requirement + ' · Unavailable', requirements);
      });
      var actionHeading = node('h6', 'Six independent delivery and recovery checks', card,
        'invoice-part6-subheading');
      actionHeading.className = 'invoice-part6-subheading';
      var actions = node('ul', undefined, card, 'invoice-part6-actions');
      value.delivery.actions.forEach(function (action) {
        node('li', action.action + ' · Unavailable · ' + action.reason, actions);
      });
      node('p', (value.fictional ? 'Fictional demo boundary. ' : '') +
        'No customer credential, message, delivery receipt, revocation, provider call, receiver mutation, or money action was created.',
        card, value.fictional ? 'invoice-draft-preview-demo' : 'invoice-draft-preview-boundary');
    }
    function renderPart7(value) {
      var card = node('section', undefined, body, 'invoice-part7-acceptance');
      var headingId = 'invoicePart7AcceptanceHeading-' + String(mountToken);
      card.setAttribute('aria-labelledby', headingId);
      var heading = node('h5', 'Payment provider and initiation', card,
        'invoice-part7-acceptance-heading'); heading.id = headingId;
      node('p', 'NorthStar rechecked the complete payment-provider boundary. Sandbox proof is ' +
        value.sandbox.state + ' (' + value.sandbox.reason + '), the rollout is ' +
        value.rollout.stage + ', and live payment capability is ' +
        (value.rollout.liveCapabilityEnabled ? 'enabled' : 'disabled') + '.',
        card, 'invoice-draft-preview-boundary');
      var gates = node('dl', undefined, card, 'invoice-part7-gates');
      [['Provider sandbox',value.sandbox.reason],
        ['Provider connection',value.requirements[1].reason],
        ['Payment initiation',value.requirements[6].reason],
        ['Rollout',value.rollout.stage + ' · tenant flag ' + value.rollout.tenantFlagDefault]]
        .forEach(function (entry) { node('dt', entry[0], gates);
          node('dd', entry[0] === 'Rollout' ? entry[1] : 'Unavailable · ' + entry[1], gates); });
      var requirementHeading = node('h6', 'Ten exact payment prerequisites', card,
        'invoice-part7-subheading'); requirementHeading.className = 'invoice-part7-subheading';
      var requirements = node('ul', undefined, card, 'invoice-part7-requirements');
      value.requirements.forEach(function (requirement) {
        node('li', requirement.requirement + ' · ' + requirement.state +
          (requirement.reason ? ' · ' + requirement.reason : ''), requirements);
      });
      var schema = value.adapterSchema;
      var schemaHeading = node('h6', 'Adapter compatibility and rollback controls', card,
        'invoice-part7-subheading'); schemaHeading.className = 'invoice-part7-subheading';
      var controls = node('ul', undefined, card, 'invoice-part7-controls');
      [
        schema.provider + ' adapter · schema major ' + schema.acceptedMajorVersion +
          ', tested minor ' + schema.maximumTestedMinorVersion + ' · ' + schema.state + ' · ' + schema.reason,
        'Unknown required field accepted · ' + String(schema.unknownRequiredFieldAccepted),
        'Optional output may authorize an effect · ' + String(schema.unknownOptionalFieldMayAuthorizeEffect),
        'Capability drift · ' + value.driftAndDisconnect.capabilityDriftBehavior,
        'Disconnect · ' + value.driftAndDisconnect.disconnectBehavior,
        'Feature flag rollback · ' + value.rollout.featureFlagRollbackState +
          ' · blocks new initiation ' + String(value.rollout.rollbackBlocksNewInitiation) +
          ' · may mark invoice paid ' + String(value.rollout.rollbackCanMarkInvoicePaid),
        'Duplicate click requires same idempotency receipt · ' +
          String(value.protections.duplicateClickRequiresSameIdempotencyReceipt),
        'Amount, currency, invoice, or allocation change invalidates plan · ' +
          String(value.protections.amountCurrencyInvoiceOrAllocationChangeInvalidatesPlan),
      ].forEach(function (text) { node('li', text, controls); });
      var methodsHeading = node('h6', 'Payment method states', card,
        'invoice-part7-subheading'); methodsHeading.className = 'invoice-part7-subheading';
      var methods = node('ul', undefined, card, 'invoice-part7-methods');
      value.methods.forEach(function (method) {
        node('li', method.method + ' · ' + method.policyState + ' · ' + method.runtimeState +
          ' · ' + method.reason, methods);
      });
      node('p', (value.fictional ? 'Fictional demo boundary. ' : '') +
        'Provider calls ' + value.providerCallCount + ' · provider mutations ' +
        value.providerMutationCount + ' · receiver mutations ' + value.receiverMutationCount +
        ' · live-money movements ' + value.liveMoneyMovementCount + '. Sandbox evidence required · ' +
        String(value.sandbox.requiredForMissionCompletion) + '; synthetic evidence may substitute · ' +
        String(value.sandbox.syntheticEvidenceMaySubstitute) + '.',
        card, value.fictional ? 'invoice-draft-preview-demo' : 'invoice-draft-preview-boundary');
    }
    function renderPart9(value) {
      var card = node('section', undefined, body, 'invoice-part9-acceptance');
      var headingId = 'invoicePart9AcceptanceHeading-' + String(mountToken);
      card.setAttribute('aria-labelledby', headingId);
      var heading = node('h5', 'Payment corrections, receipts, and accounting', card,
        'invoice-part9-acceptance-heading'); heading.id = headingId;
      node('p', 'NorthStar rechecked the complete Part 9 boundary. Payment attempts, deposits, ' +
        'credits and refunds, offline receipts, and payment outcomes remain value-free until exact ' +
        'financial evidence exists.', card, 'invoice-draft-preview-boundary');
      var gates = node('dl', undefined, card, 'invoice-part9-gates');
      [['Customer receipt', value.customerReceipt.reason],
        ['Correction and recovery', value.correctionRecovery.reason],
        ['Accounting adapter', value.accounting.reason],
        ['Independent audit', value.acceptance.independentWholeHeadAuditAccepted ? 'accepted' : 'not accepted']]
        .forEach(function (entry) { node('dt', entry[0], gates);
          node('dd', entry[0] === 'Independent audit' ? entry[1] : 'Unavailable · ' + entry[1], gates); });
      var sourceHeading = node('h6', 'Five exact Part 9 source boundaries', card,
        'invoice-part7-subheading'); sourceHeading.className = 'invoice-part7-subheading';
      var sources = node('ul', undefined, card, 'invoice-part9-sources');
      value.sourceParts.forEach(function (part) {
        node('li', part.part + ' · ' + part.state + ' · ' + part.reason, sources);
      });
      var controlHeading = node('h6', 'Concurrency, recovery, receipt, and accounting controls', card,
        'invoice-part7-subheading'); controlHeading.className = 'invoice-part7-subheading';
      var controls = node('ul', undefined, card, 'invoice-part9-controls');
      [
        'Concurrent writers per aggregate · ' + value.concurrency.maximumConcurrentWriterPerAggregate,
        'Exact aggregate revision and idempotency receipt required · ' +
          String(value.concurrency.exactAggregateRevisionRequired &&
            value.concurrency.exactRequestDigestAndIdempotencyReceiptRequired),
        'Duplicate or replay may repeat an effect · ' +
          String(value.concurrency.duplicateOrReplayMayRepeatEffect),
        'Arrival order may authorize an effect · ' + String(value.concurrency.arrivalOrderMayAuthorizeEffect),
        'Settled money may be refused retroactively · ' +
          String(value.concurrency.settledMoneyMayBeRefusedRetroactively),
        'Corrections are append-only · ' + String(value.correctionRecovery.correctionsAreAppendOnly),
        'Read-only recovery requires the exact original request and receipt with no effect · ' +
          String(value.correctionRecovery.exactOriginalRequestAndReceiptRequired &&
            value.correctionRecovery.readOnlyLookupRequiresNoExternalOrFinancialEffect),
        'Recovery that restores an effect requires dual control · ' +
          String(value.correctionRecovery.restoringExternalOrFinancialEffectRequiresDualControl),
        'Recovery may exceed the original request · ' +
          String(value.correctionRecovery.recoveryMayExceedOriginalRequest),
        'Changed or stale sources clear rendered financial state · ' +
          String(value.correctionRecovery.staleOrChangedSourceClearsRenderedFinancialState),
        'Receipt number · ' + value.customerReceipt.numberingPattern + ' · immutable, no reuse',
        'Required check wording · ' + value.customerReceipt.checkReceivedRequiredWording,
        'Receipt may claim provider settlement or bank clearance · ' +
          String(value.customerReceipt.receiptMayClaimProviderSettlementOrBankClearance),
        'Refund request is a completed refund · ' +
          String(value.customerReceipt.refundRequestIsCompletedRefund),
        'Accounting · ' + value.accounting.adapter + ' · ' + value.accounting.state,
        'Accounting may invent chart, tax, recognition, or check clearance · ' +
          String(value.accounting.mayInventChartOfAccounts || value.accounting.mayDecideRecognitionOrTax ||
            value.accounting.maySupplyCheckClearance),
        'Accounting export caps · ' + value.accounting.maximumExportRecords + ' records · ' +
          value.accounting.maximumExportMinorUnits + ' USD minor units',
        'Manual accounting reconciliation always requires dual control · ' +
          String(value.accounting.manualReconciliationAlwaysDualControl),
      ].forEach(function (text) { node('li', text, controls); });
      node('p', (value.fictional ? 'Fictional demo boundary. ' : '') +
        'Customer receipts ' + value.customerReceiptRowCount + ' · corrections ' +
        value.correctionRowCount + ' · recoveries ' + value.recoveryRowCount +
        ' · accounting exports ' + value.accountingExportRowCount + ' · provider calls ' +
        value.providerCallCount + ' · receiver mutations ' + value.receiverMutationCount +
        ' · accounting mutations ' + value.accountingMutationCount + ' · live-money movements ' +
        value.liveMoneyMovementCount + '. Provider sandbox, first-customer live-money validation, ' +
        'independent audit, and founder visual approval remain unaccepted.', card,
        value.fictional ? 'invoice-draft-preview-demo' : 'invoice-draft-preview-boundary');
    }
    function renderPart10(value) {
      var card = node('section', undefined, body, 'invoice-part10-acceptance');
      var headingId = 'invoicePart10AcceptanceHeading-' + String(mountToken);
      card.setAttribute('aria-labelledby', headingId);
      var heading = node('h5', 'Collections review and follow-up', card,
        'invoice-part10-acceptance-heading'); heading.id = headingId;
      node('p', 'NorthStar rechecked the complete Part 10 boundary. Receivable aging, human ' +
        'collection review, and both reviewed follow-up paths remain value-free until exact current ' +
        'invoice, recipient, authority, cooldown, receiver, and delivery evidence exists.', card,
      'invoice-draft-preview-boundary');
      var gates = node('dl', undefined, card, 'invoice-part10-gates');
      [['Receivable population', value.sourceParts[0].state + ' · ' + value.sourceParts[0].reason],
        ['Collection review', value.sourceParts[1].state + ' · ' + value.sourceParts[1].reason],
        ['Reviewed handoff or resend', value.sourceParts[2].state + ' · ' + value.sourceParts[2].reason],
        ['Independent audit', value.acceptance.independentWholeHeadAuditAccepted ? 'accepted' : 'not accepted']]
        .forEach(function (entry) { node('dt', entry[0], gates); node('dd', entry[1], gates); });
      node('h6', 'Three exact Part 10 source boundaries', card, 'invoice-part7-subheading');
      var sources = node('ul', undefined, card, 'invoice-part10-sources');
      value.sourceParts.forEach(function (part) {
        node('li', part.part + ' · ' + part.state + ' · ' + part.reason, sources);
      });
      node('h6', 'Failure and reviewed retry boundary', card, 'invoice-part7-subheading');
      var failures = node('ul', undefined, card, 'invoice-part10-failures');
      value.failureRetry.orderedFailureStates.forEach(function (state) {
        node('li', state.replace(/_/g, ' ') + ' · unavailable', failures);
      });
      [
        'Exact current source required before every retry · ' +
          String(value.failureRetry.exactCurrentSourceRequiredBeforeEveryRetry),
        'Human-reviewed retry required · ' + String(value.failureRetry.humanReviewedRetryRequired),
        'Automatic reminder, retry, or charge supported · ' +
          String(value.failureRetry.automaticReminderRetryOrChargeSupported),
        'Prior provider session may be reused · ' +
          String(value.failureRetry.priorProviderSessionMayBeReused),
        'Unknown cooldown denies · ' + String(value.failureRetry.missingOrUnknownCooldownDenies),
        'Failed or rejected request may create an effect · ' +
          String(value.failureRetry.failedOrRejectedRequestMayCreateEffect),
      ].forEach(function (text) { node('li', text, failures); });
      node('h6', 'Revocation and privacy boundary', card, 'invoice-part7-subheading');
      var revocations = node('ul', undefined, card, 'invoice-part10-revocations');
      value.revocation.orderedRevocationAxes.forEach(function (axis) {
        node('li', axis.replace(/_/g, ' ') + ' · revalidated before display or action', revocations);
      });
      [
        'Revocation clears rendered private and collection state · ' +
          String(value.revocation.revocationClearsRenderedPrivateAndCollectionState),
        'Revoked invoice, session, recipient, or checkout may be reused · ' +
          String(value.revocation.revokedInvoiceDocumentSessionRecipientOrCheckoutMayBeReused),
        'Role or retry may bypass revocation · ' + String(value.revocation.roleOrRetryMayBypassRevocation),
        'Revocation creates a financial or external effect · ' +
          String(value.revocation.revocationCreatesFinancialOrExternalEffect),
      ].forEach(function (text) { node('li', text, revocations); });
      node('p', (value.fictional ? 'Fictional demo boundary. ' : '') +
        'Receivable rows ' + value.receivableRowCount + ' · review rows ' +
        value.collectionReviewRowCount + ' · promises ' + value.promiseToPayRowCount +
        ' · handoff requests ' + value.handoffRequestRowCount + ' · resend requests ' +
        value.manualResendRequestRowCount + ' · outbound messages ' + value.outboundMessageCount +
        ' · provider calls ' + value.providerCallCount + ' · receiver mutations ' +
        value.receiverMutationCount + ' · live-money movements ' + value.liveMoneyMovementCount +
        '. Mission 28 receiver evidence, private production, first-customer live-money validation, ' +
        'independent audit, and founder visual approval remain unaccepted.', card,
        value.fictional ? 'invoice-draft-preview-demo' : 'invoice-draft-preview-boundary');
    }
    function renderPart11(value) {
      var card=node('section',undefined,body,'invoice-part11-acceptance');
      var headingId='invoicePart11AcceptanceHeading-'+String(mountToken);
      card.setAttribute('aria-labelledby',headingId);
      var heading=node('h5','Accounting handoff and reconciliation',card,
        'invoice-part10-acceptance-heading'); heading.id=headingId;
      node('p','NorthStar rechecked the complete Part 11 boundary. Export, acknowledgement, '+
        'reconciliation, retention, holds, disconnect, and regrant remain value-free until exact '+
        'current source, adapter, professional review, assurance, and control evidence exists.',card,
      'invoice-draft-preview-boundary');
      var gates=node('dl',undefined,card,'invoice-part11-gates');
      [['Export source',value.sourceParts[0].state+' · '+value.sourceParts[0].reason],
        ['Destination and transmission',value.sourceParts[1].state+' · '+value.sourceParts[1].reason],
        ['Bidirectional reconciliation',value.sourceParts[2].state+' · '+value.sourceParts[2].reason],
        ['Independent audit',value.acceptance.independentWholeHeadAuditAccepted?'accepted':'not accepted']]
        .forEach(function(entry){node('dt',entry[0],gates);node('dd',entry[1],gates);});
      node('h6','Three exact Part 11 source boundaries',card,'invoice-part7-subheading');
      var sources=node('ul',undefined,card,'invoice-part11-sources');
      value.sourceParts.forEach(function(part){
        node('li',part.part+' · '+part.state+' · '+part.reason,sources);
      });
      node('h6','Tax, accounting, retention, and hold boundary',card,'invoice-part7-subheading');
      var boundaries=node('ul',undefined,card,'invoice-part11-boundaries');
      [
        'Tax provider calculation enabled · '+String(value.taxAccountingBoundary.providerTaxCalculationEnabled),
        'Exact current Mission 24 tax decision required · '+
          String(value.taxAccountingBoundary.exactCurrentMission24TaxDecisionRequired),
        'Accounting adapter · '+value.taxAccountingBoundary.configuredAccountingAdapter+' · '+
          value.taxAccountingBoundary.configuredAccountingMode+' · runtime '+
          String(value.taxAccountingBoundary.accountingRuntimeAvailable),
        'Accounting may invent chart, tax, recognition, or clearance · '+
          String(value.taxAccountingBoundary.accountingMayInventChartOfAccounts ||
            value.taxAccountingBoundary.accountingMayDecideRecognitionOrTax ||
            value.taxAccountingBoundary.accountingMaySupplyCheckClearance),
        'Financial record retention · '+value.retentionHold.financialRecordCalendarYears+' calendar years',
        'Immutable idempotency and audit retention · '+
          value.retentionHold.immutableIdempotencyAndAuditCalendarYears+' calendar years',
        'Holds suspend eligible deletion · '+String(value.retentionHold.holdsSuspendEligibleDeletion),
        'Missing retention or hold state may authorize deletion · '+
          String(value.retentionHold.missingRetentionOrHoldStateMayAuthorizeDeletion),
      ].forEach(function(text){node('li',text,boundaries);});
      node('h6','Adapter disconnect and regrant boundary',card,'invoice-part7-subheading');
      var lifecycle=node('ul',undefined,card,'invoice-part11-boundaries');
      value.adapterLifecycle.exactStates.forEach(function(state){
        node('li',state.replace(/_/g,' ')+' · unavailable',lifecycle);
      });
      [
        'Automatic reconnect allowed · '+String(value.adapterLifecycle.automaticReconnectAllowed),
        'Disconnect stops new export and reconciliation work · '+
          String(value.adapterLifecycle.disconnectStopsNewPreviewTransmissionAcknowledgementAndReconciliation),
        'Disconnect may delete immutable receipts or audit · '+
          String(value.adapterLifecycle.disconnectMayDeleteImmutableReceiptsOrAudit),
        'Regrant requires fresh reviewed authority · '+
          String(value.adapterLifecycle.regrantRequiresFreshReviewedAuthority),
        'Role alone authorizes disconnect or regrant · '+
          String(value.adapterLifecycle.roleAloneAuthorizesDisconnectOrRegrant),
      ].forEach(function(text){node('li',text,lifecycle);});
      node('p',(value.fictional?'Fictional demo boundary. ':'')+
        'Export records '+value.exportRecordCount+' · transmissions '+value.transmissionCount+
        ' · acknowledgements '+value.acknowledgementCount+' · reconciliations '+
        value.reconciliationRecordCount+' · deletions '+value.retentionDeletionCount+
        ' · adapter mutations '+value.adapterConnectionMutationCount+' · accounting mutations '+
        value.accountingMutationCount+' · provider calls '+value.providerCallCount+
        ' · receiver mutations '+value.receiverMutationCount+' · live-money movements '+
        value.liveMoneyMovementCount+'. Adapter runtime, private production, professional review, '+
        'production performance, first-customer live-money validation, independent audit, and '+
        'founder visual approval remain unaccepted.',card,
        value.fictional?'invoice-draft-preview-demo':'invoice-draft-preview-boundary');
    }
    function renderPart12(value) {
      var card=node('section',undefined,body,'invoice-part12-acceptance');
      var headingId='invoicePart12AcceptanceHeading-'+String(mountToken);
      card.setAttribute('aria-labelledby',headingId);
      var heading=node('h5','Financial reporting and downstream evidence',card,
        'invoice-part10-acceptance-heading'); heading.id=headingId;
      node('p','NorthStar rechecked the complete Part 12 reporting boundary. Invoice, receivable, '+
        'payment, cash, learning, forecast, and platform facts remain unavailable until exact '+
        'current source and complete coverage evidence exists. Missing evidence is never shown as zero.',
      card,'invoice-draft-preview-boundary');
      var gates=node('dl',undefined,card,'invoice-part12-gates');
      [['Coverage',value.state+' · '+value.reason],
        ['Command Center',value.surfaces[0].state+' · no legacy-zero fallback'],
        ['Customer finance',value.surfaces[1].state+' · no legacy-zero fallback'],
        ['Independent audit',value.acceptance.independentWholeHeadAuditAccepted?'accepted':'not accepted']]
        .forEach(function(entry){node('dt',entry[0],gates);node('dd',entry[1],gates);});
      node('h6','Exact Part 12 source boundaries',card,'invoice-part7-subheading');
      var sources=node('ul',undefined,card,'invoice-part12-sources');
      value.sourceWitnesses.forEach(function(source){
        node('li',source.part+' · '+source.state+' · '+source.reason,sources);
      });
      node('h6','Purpose-limited drilldowns',card,'invoice-part7-subheading');
      var drilldowns=node('ul',undefined,card,'invoice-part12-drilldowns');
      value.drilldowns.forEach(function(drilldown){
        node('li',drilldown.drilldown.replace(/_/g,' ')+' · '+drilldown.state+' · '+
          drilldown.availableFactCount+' of '+drilldown.requiredFactCount+' facts available',drilldowns);
      });
      node('h6','Reporting and downstream controls',card,'invoice-part7-subheading');
      var boundaries=node('ul',undefined,card,'invoice-part12-boundaries');
      [
        'Complete coverage required · '+String(value.reportingContract.completeCoverageRequired),
        'Missing, unknown, or unavailable may become zero · '+
          String(value.reportingContract.missingUnknownOrUnavailableMayBecomeZero),
        'Browser-derived values allowed · '+String(value.reportingContract.browserDerivedValuesAllowed),
        'Legacy-zero fallback allowed · '+String(value.reportingContract.legacyZeroFallbackAllowed),
        'Mission 25 accepted observations only · '+
          String(value.downstreamBoundary.mission25ExactAcceptedObservationsOnly),
        'Mission 26 source-complete history and accepted calibration required · '+
          String(value.downstreamBoundary.mission26SourceCompleteHistoryAndAcceptedCalibrationRequired),
        'Mission 33 may inspect tenant detail · '+
          String(value.downstreamBoundary.mission33MayInspectTenantDetail),
        'Cross-tenant training allowed · '+String(value.downstreamBoundary.crossTenantTrainingAllowed),
      ].forEach(function(text){node('li',text,boundaries);});
      node('p',(value.fictional?'Fictional demo boundary. ':'')+
        'Report rows '+value.reportRowCount+' · drilldown rows '+value.drilldownRowCount+
        ' · browser-derived values '+value.browserDerivedValueCount+' · legacy-zero fallbacks '+
        value.legacyZeroFallbackCount+' · learning observations '+value.learningObservationCount+
        ' · forecasts '+value.forecastCount+' · platform facts '+value.platformFactCount+
        ' · provider calls '+value.providerCallCount+' · receiver mutations '+
        value.receiverMutationCount+' · accounting mutations '+value.accountingMutationCount+
        ' · live-money movements '+value.liveMoneyMovementCount+
        '. Source-complete production evidence, accepted calibration, production performance, '+
        'first-customer live-money validation, independent audit, and founder visual approval remain unaccepted.',
        card,value.fictional?'invoice-draft-preview-demo':'invoice-draft-preview-boundary');
    }
    function renderPart14B(value) {
      var card=node('section',undefined,body,'invoice-part14b-acceptance');
      var heading=node('h5','Complete fictional financial journey',card,
        'invoice-part10-acceptance-heading');
      heading.id='invoicePart14BAcceptanceHeading-'+String(mountToken);
      card.setAttribute('aria-labelledby',heading.id);
      node('p',value.label,card,'invoice-draft-preview-demo');
      node('p','This resettable walkthrough uses NorthStar’s released financial contracts with fictional '+
        'evidence only. It never contacts a customer, provider, bank, accounting receiver, or moves money.',
      card,'invoice-draft-preview-boundary');
      var gates=node('dl',undefined,card,'invoice-part14b-gates');
      [['Journey',value.state],['Lifecycle stages',String(value.lifecycle.currentStageCount)+' of '+
        String(value.lifecycle.requiredStageCount)+' current'],
      ['Demo baseline',value.reset.canonicalBaseline?'canonical':'contains fictional demo changes'],
      ['Check state',value.launchMatrix.checkClearanceState],
      ['Independent audit',value.acceptance.independentWholeHeadAuditAccepted?'accepted':'not accepted']]
        .forEach(function(entry){node('dt',entry[0],gates);node('dd',entry[1],gates);});
      node('h6','Fictional lifecycle',card,'invoice-part7-subheading');
      var stages=node('ol',undefined,card,'invoice-part14b-stages');
      value.lifecycle.stages.forEach(function(stage){
        node('li',stage.name.replace(/_/g,' ')+' · '+stage.state,stages);
      });
      node('h6','Isolation and reset boundaries',card,'invoice-part7-subheading');
      var boundaries=node('ul',undefined,card,'invoice-part14b-boundaries');
      [
        'Paid repository reads · '+value.paidRepositoryReadCount,
        'Provider calls · '+value.providerCallCount,
        'Receiver mutations · '+value.receiverMutationCount,
        'Accounting mutations · '+value.accountingMutationCount,
        'Live-money movements · '+value.liveMoneyMovementCount,
        'Reset removes fictional user changes · '+String(value.reset.resetRemovesUserCreatedDemoMutations),
        'Check received remains distinct from clearance · '+
          String(value.acceptance.checkReceivedRemainsDistinctFromClearance)
      ].forEach(function(text){node('li',text,boundaries);});
    }
    async function render(bundle, token) {
      // A network response is untrusted as one complete value. Sanitize the
      // entire Parts 5-12/14B graph descriptor-first before reading even its
      // outer contractVersion. All later validators receive only the detached
      // data-only copy, so an accessor/toJSON/prototype poison cannot execute
      // while old financial state is still retained.
      if (review.simulated) {
        bundle=copyFictionalDemoEnvelope(bundle);
        if (!bundle) return rejected({status:409});
      }
      var lifecycleBundle=review.simulated&&bundle&&bundle.contractVersion===
        'm27-fictional-demo-journey-bundle-v1'?bundle:null;
      var financialBundle=lifecycleBundle?lifecycleBundle.part12Bundle:bundle;
      var part14bAcceptance=lifecycleBundle&&lifecycleBundle.journeyAcceptance;
      bundle=financialBundle;
      var value = bundle && bundle.preview, acceptance = bundle && bundle.part5Acceptance;
      var deliveryAcceptance = bundle && bundle.part6Acceptance;
      var paymentAcceptance = bundle && bundle.part7Acceptance;
      var part9Acceptance = bundle && bundle.part9Acceptance;
      var part10Acceptance = bundle && bundle.part10Acceptance;
      var part11SourceContracts = bundle && bundle.part11SourceContracts;
      var part11Acceptance = bundle && bundle.part11Acceptance;
      var part12Acceptance = bundle && bundle.part12Acceptance;
      var invalidSynchronous = invalidBundle(bundle) || invalid(value) ||
          (review.simulated && !matchesDemoWorkspaceRevision(value, expectedDemoRevision)) ||
          invalidPart5(acceptance) ||
          invalidPart6(deliveryAcceptance) || !samePart5Witness(value, acceptance) ||
          !samePart6Witness(value, deliveryAcceptance) ||
          invalidPart7(paymentAcceptance, review.simulated ? 'demo' : 'paid') ||
          !samePart7Witness(value, paymentAcceptance) ||
          invalidPart9(part9Acceptance, review.simulated ? 'demo' : 'paid') ||
          !samePart9Witness(value, part9Acceptance) ||
          invalidPart10(part10Acceptance, review.simulated ? 'demo' : 'paid') ||
          !samePart10Witness(value, part10Acceptance, part9Acceptance) ||
          invalidPart11(part11Acceptance, review.simulated ? 'demo' : 'paid');
      if (review.simulated && (!lifecycleBundle||!exactOrdered(lifecycleBundle,
        ['contractVersion','part12Bundle','journeyAcceptance']))) invalidSynchronous=true;
      var digestResults=invalidSynchronous ? [true,false,true,false,null] : await Promise.all([
        invalidPart11SourceWitnesses(part11Acceptance,part11SourceContracts,part10Acceptance),
        samePart11Witness(value,part11Acceptance,part10Acceptance),
        invalidPart12(part12Acceptance,review.simulated?'demo':'paid'),
        samePart12Witness(value,part12Acceptance,part11Acceptance),
        review.simulated?projectPart14B(part14bAcceptance,bundle,expectedDemoRevision):null,
      ]);
      if (token!==undefined && !active(token)) return;
      if (invalidSynchronous || digestResults[0] || !digestResults[1] ||
          digestResults[2] || !digestResults[3] || review.simulated&&!digestResults[4]) return rejected({ status: 409,
        message: 'The exact invoice draft changed. Reload its current evidence.' });
      if (review.simulated) part14bAcceptance=digestResults[4];
      data = value; part5 = acceptance; part6 = deliveryAcceptance;
      part7 = paymentAcceptance; part9 = part9Acceptance; part10 = part10Acceptance;
      part11 = part11Acceptance; part12 = part12Acceptance; part14b = part14bAcceptance;
      body.replaceChildren(); var preview = value.documentPreview, totals = value.reconciliation;
      var heading = node('h4', preview.label, body, 'invoice-draft-preview-heading'); heading.tabIndex = -1;
      if (value.fictional) node('p', 'Fictional demo · no customer, provider, invoice, receivable, or money action', body,
        'invoice-draft-preview-demo');
      var documentCard = node('section', undefined, body, 'invoice-draft-preview-document');
      documentCard.setAttribute('aria-label', value.fictional ? 'Fictional invoice draft preview' : 'Invoice draft preview');
      var table = node('table', undefined, documentCard, 'invoice-draft-preview-lines');
      var caption = node('caption', 'Customer-safe draft lines', table); caption.className = 'sr-only';
      var head = node('thead', undefined, table), headRow = node('tr', undefined, head);
      ['Description','Group','Amount'].forEach(function (label) { node('th', label, headRow).scope = 'col'; });
      var tbody = node('tbody', undefined, table);
      preview.lines.forEach(function (line) { var row = node('tr', undefined, tbody);
        var description = node('td', line.description, row); description.dataset.label = 'Description';
        var group = node('td', line.group, row); group.dataset.label = 'Group';
        var amount = node('td', money(line.amount), row); amount.dataset.label = 'Amount'; });
      var list = node('dl', undefined, documentCard, 'invoice-draft-preview-totals');
      [['Subtotal before tax',money(totals.subtotalBeforeTax)],['Prepared tax',money(totals.preparedTax)],
        ['Prepared document total',money(totals.preparedDocumentTotal.value)],['Amount due','Unavailable']]
        .forEach(function (entry) { node('dt', entry[0], list); node('dd', entry[1], list); });
      node('p','Prepared tax is shown for review only. Professional tax policy is unavailable, so this draft cannot be approved, issued, delivered, or treated as a receivable.',body,'invoice-draft-preview-boundary');
      node('p','Amount due remains unavailable until exact native deposits, prior payments, credits, refunds, tax authority, and issue evidence are reconciled. Missing evidence is never shown as zero.',body,'invoice-draft-preview-boundary');
      node('p','PDF and immutable customer-facing document generation begin in their owning later slices. No provider or receiver was called.',body,'invoice-draft-preview-boundary');
      renderPart5(acceptance);
      renderPart6(deliveryAcceptance);
      renderPart7(paymentAcceptance);
      renderPart9(part9Acceptance);
      renderPart10(part10Acceptance);
      renderPart11(part11Acceptance);
      renderPart12(part12Acceptance);
      if (part14bAcceptance) renderPart14B(part14bAcceptance);
      var actions = node('div', undefined, body, 'invoice-draft-preview-actions');
      var reload = node('button','Reload current preview',actions,'btn btn-secondary'); reload.type='button'; reload.onclick=load;
      if (!value.fictional && context?.draft) { var edit = node('button','Edit current invoice draft',actions,'btn btn-secondary');
        edit.type='button'; edit.onclick=function(){renderDraft(context.draft,context.capability,context.receipt);}; }
      heading.focus();
      return true;
    }
    function rejected(error) {
      requestToken += 1; clearAndStatus(error && error.status === 403 ?
        'Invoice draft review requires a current owner or administrator.' : error && error.status === 404 ?
          'This invoice draft is unavailable.' : error && error.status === 409 ?
            'The invoice draft changed. Reload its exact current evidence.' :
            'Invoice draft preview is temporarily unavailable. Retry from this estimate.', true);
      var actions = node('div', undefined, body, 'invoice-draft-preview-actions');
      var retry = node('button','Retry invoice preview',actions,'btn btn-secondary'); retry.type='button'; retry.onclick=load;
      return false;
    }
    function loadPaid(token) {
      var receipt; var capability; var draft;
      return request(base + '/billable-work-review?sourceClass=final_balance').then(function (billable) {
        if (!active(token)) return null;
        receipt = billable && billable.state === 'reviewed_current' && billable.handoffReceipt;
        if (!receipt || !/^[0-9a-f-]{36}$/i.test(receipt.receiptId || '') ||
            !/^[0-9a-f]{64}$/.test(receipt.receiptDigest || '')) throw { status: 409 };
        return post(base + '/invoice-draft/workflow-capability', { confirmed: true,
          confirmationVersion: 'm27-invoice-draft-workflow-capability-v1' });
      }).then(function (value) {
        if (!value || !active(token)) return null; capability = value;
        return request(base + '/invoice-draft-origin?handoffReceiptId=' + encodeURIComponent(receipt.receiptId) +
          '&handoffReceiptDigest=' + encodeURIComponent(receipt.receiptDigest));
      }).then(function (origin) {
        if (!origin || !active(token)) return null;
        if (origin.state === 'ready_to_capture') { renderOrigin(origin, capability, receipt); return null; }
        if (origin.state !== 'current') throw { status: 409 };
        return request(base + '/invoice-draft?handoffReceiptId=' + encodeURIComponent(receipt.receiptId) +
          '&handoffReceiptDigest=' + encodeURIComponent(receipt.receiptDigest));
      }).then(function (value) {
        if (!value || !active(token)) return null; draft = value;
        if (draft.state !== 'current') throw { status: 409 };
        if (Number(draft.revision) === 0) { renderDraft(draft, capability, receipt); return null; }
        context = { capability: capability, receipt: receipt, draft: draft };
        return request(base + '/invoice-draft/tax-review?handoffReceiptId=' + encodeURIComponent(receipt.receiptId) +
          '&handoffReceiptDigest=' + encodeURIComponent(receipt.receiptDigest));
      }).then(function (tax) {
        if (!tax || !active(token)) return null;
        if (tax.state === 'ready_to_record') { renderTax(tax, capability, receipt, draft); return null; }
        if (tax.state !== 'recorded_policy_unavailable') throw { status: 409 };
        context = { capability: capability, receipt: receipt, draft: draft, tax: tax };
        return request(base + '/reporting-part12-acceptance?handoffReceiptId=' + encodeURIComponent(receipt.receiptId) +
          '&handoffReceiptDigest=' + encodeURIComponent(receipt.receiptDigest));
      });
    }
    function load() {
      var token = ++requestToken; clearAndStatus('Loading the exact current invoice draft…', false);
      var demoBase = '/api/demo/customer-financial/invoice-drafts/' + encodeURIComponent(review.pins.estimateId);
      var promise = review.simulated ? request(demoBase + '/part14b-acceptance') : loadPaid(token);
      return promise.then(function (value) { if (value && active(token)) return render(value,token); })
        .catch(function (error) { if (active(token)) rejected(error); });
    }
    function clearCollapsed() { requestToken += 1; data = null; part5 = null; part6 = null; part7 = null; part9 = null; part10 = null; part11 = null; part12 = null; part14b = null; context = null; body.replaceChildren(); }
    function toggleDisclosure() {
      // A native disclosure can settle a queued browser toggle after the
      // desired-state observer.  User activation must therefore toggle the
      // state the user can actually see, not a stale recovery intent.
      var opening = !section.open; desiredOpenState = opening; section.open = opening;
      if (opening) load(); else clearCollapsed();
    }
    function settleKeyboardDisclosure(expectedOpen) {
      setTimeout(function () {
        if (!section.isConnected) return;
        desiredOpenState = expectedOpen;
        section.open = expectedOpen;
      }, 0);
    }
    summary.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return;
      event.preventDefault(); if (event.repeat) return;
      mutationRecoveryActive = false;
      keyboardActivationState = { desiredOpen: !section.open };
      toggleDisclosure();
    });
    summary.addEventListener('keyup', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return;
      event.preventDefault();
      if (keyboardActivationState !== null) {
        settleKeyboardDisclosure(keyboardActivationState.desiredOpen);
      }
    });
    summary.addEventListener('pointerdown', function () {
      mutationRecoveryActive = false;
      keyboardActivationState = null;
    });
    summary.addEventListener('click', function (event) {
      event.preventDefault();
      if (mutationRecoveryActive) return;
      // A real pointer activation always passed through pointerdown, which
      // clears the keyboard state.  WebKit does not consistently expose a
      // keyboard-generated click as detail=0, so the surviving state itself is
      // the reliable native-boundary signal for suppressing the duplicate.
      if (keyboardActivationState !== null) {
        settleKeyboardDisclosure(keyboardActivationState.desiredOpen);
        keyboardActivationState = null;
        return;
      }
      keyboardActivationState = null;
      toggleDisclosure();
    });
    section.addEventListener('toggle', function () {
      if (section.open !== desiredOpenState) section.open = desiredOpenState;
    });
    var disclosureObserver = new MutationObserver(function () {
      if (!section.isConnected) { disclosureObserver.disconnect(); return; }
      if (section.open !== desiredOpenState) section.open = desiredOpenState;
    });
    disclosureObserver.observe(section, { attributes: true, attributeFilter: ['open'] });
    if (activeDisclosureMount && typeof activeDisclosureMount.disconnect === 'function') {
      activeDisclosureMount.disconnect();
    }
    activeDisclosureMount = { host: host, estimateId: estimateId, section: section,
      desiredOpen: function () { return desiredOpenState; },
      mutationRecoveryActive: function () { return mutationRecoveryActive; },
      disconnect: function () { disclosureObserver.disconnect(); } };
    if (resumeMutationRecovery) {
      section.open = true;
      setTimeout(function () {
        if (mountToken !== mountGeneration || !section.isConnected || !desiredOpenState) return;
        load().finally(function () { mutationRecoveryActive = false; });
      }, 0);
    }
    return section;
  }
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('northstar:demo-workspace', function (event) {
      if (!activeDemoMount) return;
      if (!activeDemoMount.section.isConnected) { activeDemoMount = null; return; }
      var revision = Number(event && event.detail && event.detail.integrity &&
        event.detail.integrity.revision);
      if (revision !== activeDemoMount.expectedRevision) activeDemoMount.invalidate();
    });
  }
  function clear() {
    mountGeneration += 1;
    if (activeDemoMount && activeDemoMount.section.isConnected) activeDemoMount.invalidate();
    activeDemoMount = null;
    if (activeDisclosureMount && typeof activeDisclosureMount.disconnect === 'function') {
      activeDisclosureMount.disconnect();
    }
    activeDisclosureMount = null;
  }
  function validateActiveFictionalDemoEnvelope(value) {
    if (!activeDemoMount || !activeDemoMount.section.isConnected ||
        typeof activeDemoMount.validate!=='function') return Promise.resolve(false);
    try { return Promise.resolve(activeDemoMount.validate(value)); }
    catch (_) { activeDemoMount.invalidate(); return Promise.resolve(false); }
  }
  return { mount: mount, clear: clear, money: money, invalidPart7: invalidPart7,
    invalidPart9: invalidPart9, invalidPart10: invalidPart10, invalidPart11: invalidPart11,
    invalidPart11SourceWitnesses: invalidPart11SourceWitnesses,
    samePart11Witness: samePart11Witness,
    invalidPart12: invalidPart12, samePart12Witness: samePart12Witness,
    invalidPart14B: invalidPart14B, projectPart14B: projectPart14B,
    copyFictionalDemoEnvelope: copyFictionalDemoEnvelope,
    validateActiveFictionalDemoEnvelope: validateActiveFictionalDemoEnvelope,
    matchesDemoWorkspaceRevision: matchesDemoWorkspaceRevision,
    recoverAfterSuccessfulMutation: recoverAfterSuccessfulMutation,
    canPreserveMountedDisclosure: canPreserveMountedDisclosure,
    preserveMountedDisclosure: preserveMountedDisclosure,
    shouldResumeMutationRecovery: shouldResumeMutationRecovery };
}));
