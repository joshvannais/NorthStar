(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NorthStarCustomerFinancialInvoicePreview = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var mountGeneration = 0;
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
    document.head.appendChild(style);
  }
  function exactObject(value, keys) {
    return value && typeof value === 'object' && !Array.isArray(value) &&
      Object.keys(value).length === keys.length &&
      Object.keys(value).every(function (key) { return keys.includes(key); });
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
  function mount(review, host) {
    if (!review || !host || !review.pins || !review.pins.estimateId) return null;
    injectStyles(); var mountToken = ++mountGeneration, requestToken = 0, data = null,
      part5 = null, part6 = null, part7 = null, part9 = null, context = null;
    var section = node('details', undefined, host, 'invoice-draft-preview');
    var summary = node('summary', review.simulated ? 'Review fictional invoice draft' : 'Review invoice draft', section);
    var body = node('div', undefined, section, 'invoice-draft-preview-body');
    var base = '/api/v1/customer-financial/editable-estimates/' + encodeURIComponent(review.pins.estimateId);
    function active(token) { return token === requestToken && mountToken === mountGeneration && section.isConnected; }
    function clearAndStatus(text, alert) {
      data = null; part5 = null; part6 = null; part7 = null; part9 = null; context = null; body.replaceChildren(); var status = node('p', text, body, 'invoice-draft-preview-status');
      status.setAttribute('role', alert ? 'alert' : 'status'); status.setAttribute('aria-live', 'polite');
      status.tabIndex = -1; status.focus(); return status;
    }
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
    function invalidBundle(value) {
      return !value || value.contractVersion !== 'm27-payment-part9-preview-bundle-v1' ||
        Object.keys(value).length !== 6 || !Object.prototype.hasOwnProperty.call(value, 'preview') ||
        !Object.prototype.hasOwnProperty.call(value, 'part5Acceptance') ||
        !Object.prototype.hasOwnProperty.call(value, 'part6Acceptance') ||
        !Object.prototype.hasOwnProperty.call(value, 'part7Acceptance') ||
        !Object.prototype.hasOwnProperty.call(value, 'part9Acceptance');
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
      return post(url, value).then(function () { if (active(token)) load(); })
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
    function render(bundle) {
      var value = bundle && bundle.preview, acceptance = bundle && bundle.part5Acceptance;
      var deliveryAcceptance = bundle && bundle.part6Acceptance;
      var paymentAcceptance = bundle && bundle.part7Acceptance;
      var part9Acceptance = bundle && bundle.part9Acceptance;
      if (invalidBundle(bundle) || invalid(value) || invalidPart5(acceptance) ||
          invalidPart6(deliveryAcceptance) || !samePart5Witness(value, acceptance) ||
          !samePart6Witness(value, deliveryAcceptance) ||
          invalidPart7(paymentAcceptance, review.simulated ? 'demo' : 'paid') ||
          !samePart7Witness(value, paymentAcceptance) ||
          invalidPart9(part9Acceptance, review.simulated ? 'demo' : 'paid') ||
          !samePart9Witness(value, part9Acceptance)) return rejected({ status: 409,
        message: 'The exact invoice draft changed. Reload its current evidence.' });
      data = value; part5 = acceptance; part6 = deliveryAcceptance;
      part7 = paymentAcceptance; part9 = part9Acceptance;
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
      var actions = node('div', undefined, body, 'invoice-draft-preview-actions');
      var reload = node('button','Reload current preview',actions,'btn btn-secondary'); reload.type='button'; reload.onclick=load;
      if (!value.fictional && context?.draft) { var edit = node('button','Edit current invoice draft',actions,'btn btn-secondary');
        edit.type='button'; edit.onclick=function(){renderDraft(context.draft,context.capability,context.receipt);}; }
      heading.focus();
    }
    function rejected(error) {
      requestToken += 1; clearAndStatus(error && error.status === 403 ?
        'Invoice draft review requires a current owner or administrator.' : error && error.status === 404 ?
          'This invoice draft is unavailable.' : error && error.status === 409 ?
            'The invoice draft changed. Reload its exact current evidence.' :
            'Invoice draft preview is temporarily unavailable. Retry from this estimate.', true);
      var actions = node('div', undefined, body, 'invoice-draft-preview-actions');
      var retry = node('button','Retry invoice preview',actions,'btn btn-secondary'); retry.type='button'; retry.onclick=load;
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
        return request(base + '/payment-part9-acceptance?handoffReceiptId=' + encodeURIComponent(receipt.receiptId) +
          '&handoffReceiptDigest=' + encodeURIComponent(receipt.receiptDigest));
      });
    }
    function load() {
      var token = ++requestToken; clearAndStatus('Loading the exact current invoice draft…', false);
      var demoBase = '/api/demo/customer-financial/invoice-drafts/' + encodeURIComponent(review.pins.estimateId);
      var promise = review.simulated ? request(demoBase + '/part9-acceptance') : loadPaid(token);
      return promise.then(function (value) { if (value && active(token)) render(value); })
        .catch(function (error) { if (active(token)) rejected(error); });
    }
    function clearCollapsed() { requestToken += 1; data = null; part5 = null; part6 = null; part7 = null; part9 = null; context = null; body.replaceChildren(); }
    summary.addEventListener('click', function () { if (section.open) clearCollapsed(); });
    section.addEventListener('toggle', function () {
      if (!section.open) { clearCollapsed(); return; }
      load();
    });
    return section;
  }
  function clear() { mountGeneration += 1; }
  return { mount: mount, clear: clear, money: money, invalidPart7: invalidPart7,
    invalidPart9: invalidPart9 };
}));
