const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { types } = require('util');

const ROOT = path.resolve(__dirname, '../..');
const contract = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/architecture/MISSION_28_PART11C_REMINDER_MATERIAL_CONTRACT.json'), 'utf8'));
const UUID = new RegExp(contract.identityGrammar.uuidPattern);
const DIGEST = new RegExp(contract.identityGrammar.digestPattern);
const CURRENCY = new RegExp(contract.identityGrammar.currencyPattern);

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const digest = n => `sha256:${Number(n).toString(16).padStart(64, '0')}`;
const copy = value => JSON.parse(JSON.stringify(value));
const canonicalize = value => Array.isArray(value)
  ? value.map(canonicalize)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]))
    : value;
const hash = value => `sha256:${crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(canonicalize(value))).digest('hex')}`;
const digestLf = relative => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, relative), 'utf8').replace(/\r\n/g, '\n')).digest('hex').toUpperCase();

function dataOnly(value, seen = new WeakSet()) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number') { if (!Number.isSafeInteger(value)) throw new Error('number'); return; }
  if (typeof value !== 'object' || types.isProxy(value) || seen.has(value)) throw new Error('plain data');
  seen.add(value);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== Array.prototype) throw new Error('prototype');
  if (Object.getOwnPropertySymbols(value).length) throw new Error('symbol');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.prototype.hasOwnProperty.call(descriptors, 'toJSON')) throw new Error('toJSON');
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) throw new Error('sparse');
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[index];
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value') || !descriptor.enumerable) throw new Error('descriptor');
      dataOnly(descriptor.value, seen);
    }
    return;
  }
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) throw new Error('descriptor');
    dataOnly(descriptor.value, seen);
  }
}

function exactKeys(value, keys) {
  const actual = Object.keys(value).sort(); const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('keys');
}

function utcMicros(value) {
  if (typeof value !== 'string' || !new RegExp(contract.identityGrammar.utcInstantPattern).test(value)) return null;
  const seconds = Date.parse(`${value.slice(0, 19)}Z`); return Number.isFinite(seconds) ? BigInt(seconds) * 1000n + BigInt(value.slice(20, 26)) : null;
}

function explanationMaterialOf(input) {
  const value = input.balanceExplanationBinding;
  return {explanationId: value.explanationId, explanationVersion: value.explanationVersion, explanationDigest: value.explanationDigest, fixedText: value.fixedText, invoiceDigest: value.invoiceDigest, issuedVersionDigest: value.issuedVersionDigest, balanceDigest: value.balanceDigest, currency: value.currency, amountDueMinorUnits: value.amountDueMinorUnits};
}

function materialOf(input) {
  const value = copy(input); delete value.projectionId; delete value.materialDigest; delete value.idempotencyKeyDigest; delete value.requestDigest; return value;
}

function idempotencyMaterialOf(input) {
  const value = materialOf(input); delete value.evaluatedAt; return value;
}

function requestOf(input) {
  const value = copy(input); delete value.materialDigest; delete value.idempotencyKeyDigest; delete value.requestDigest; return value;
}

function seal(input) {
  input.balanceExplanationBinding.materialDigest = hash(explanationMaterialOf(input));
  input.materialDigest = hash(materialOf(input)); input.idempotencyKeyDigest = hash(idempotencyMaterialOf(input)); input.requestDigest = hash(requestOf(input)); return input;
}

function fixture() {
  const tenantId = uuid(1); const invoiceId = uuid(10); const versionId = uuid(11); const customerId = uuid(12); const sourceSetId = uuid(13); const headId = uuid(14); const versionDigest = digest(11); const sourceSetDigest = digest(13); const headDigest = digest(14); const recipientDigest = digest(30); const observedAt = '2026-10-29T12:04:00.000000Z';
  const input = {
    schemaVersion: contract.contractVersion,
    tenantId,
    projectionId: uuid(2),
    part11AEligibilityBinding: {tenantId, resolutionId: uuid(20), materialDigest: digest(20), idempotencyKeyDigest: digest(21), requestDigest: digest(22), resultState: 'eligible_for_owner_collection_review_only', reasonCode: 'exact_current_collection_review_eligible', issuedInvoiceId: invoiceId, issuedVersionDigest: versionDigest, sourceSetId, sourceSetDigest, axisMaterialDigest: digest(23), headTransitionId: headId, headTransitionDigest: headDigest, headSequence: 5, currentnessState: 'latest_exact_current', observedAt},
    part11BPolicyBinding: {tenantId, projectionId: uuid(21), materialDigest: digest(24), idempotencyKeyDigest: digest(25), requestDigest: digest(26), resultState: 'reminder_policy_definition_valid_no_effect_external_authority_unavailable', reasonCode: 'financial_reminder_source_permission_approval_schedule_and_effect_authority_unavailable', policyId: uuid(22), policyVersion: 1, policyCanonicalDigest: digest(27), policyState: 'draft_no_effect', rolloutState: 'disabled_contract_only', phaseId: 'overdue', issuedInvoiceId: invoiceId, issuedVersionDigest: versionDigest, recipientResolutionDigest: recipientDigest, channelId: 'email', permissionResultState: 'unavailable', approvalState: 'required_unavailable', sourceSetId, sourceSetDigest, headTransitionId: headId, headTransitionDigest: headDigest, headSequence: 5, currentnessState: 'latest_exact_current', observedAt},
    invoiceDocumentBinding: {tenantId, issuedInvoiceId: invoiceId, issuedInvoiceVersionId: versionId, invoiceRevision: 5, invoiceDigest: digest(31), issuedVersionDigest: versionDigest, customerId, customerIdentityDigest: digest(32), currency: 'USD', invoiceState: 'issued_current', documentState: 'customer_safe_current', replacementState: 'none_current', termsDigest: digest(33), termsMutationState: 'unchanged_exact_current', issuedAt: '2026-10-01T12:00:00.000000Z', sourceSetId, sourceSetDigest, headTransitionId: headId, headTransitionDigest: headDigest, headSequence: 5, currentnessState: 'latest_exact_current', observedAt},
    amountDueBinding: {tenantId, issuedInvoiceId: invoiceId, issuedVersionDigest: versionDigest, balanceRevision: 7, balanceDigest: digest(34), currency: 'USD', amountDueMinorUnits: 125000, balanceState: 'positive_exact_current', pendingTenderState: 'none_current', feeAddedMinorUnits: 0, termsChanged: false, chargeInitiated: false, paymentMethodSelected: null, settlementClaimState: 'unsettled_exact_current', accountingClaimState: 'current_no_blocking_adjustment', sourceSetId, sourceSetDigest, headTransitionId: headId, headTransitionDigest: headDigest, headSequence: 5, currentnessState: 'latest_exact_current', observedAt},
    paymentDestinationBinding: {state: contract.securePaymentDestinationContract.currentState, reasonCode: contract.securePaymentDestinationContract.currentReason, destinationId: null, destinationVersion: null, destinationDigest: null, documentVersionDigest: null, recipientResolutionDigest: null, destinationClass: null, scopeState: null, expiresAt: null, rawToken: null, url: null, paymentMethodId: null, providerAccountId: null, chargeAuthority: false},
    balanceExplanationBinding: {explanationId: contract.balanceExplanationCatalog[0].explanationId, explanationVersion: 1, explanationDigest: contract.balanceExplanationCatalog[0].explanationDigest, fixedText: contract.balanceExplanationCatalog[0].fixedText, invoiceDigest: digest(31), issuedVersionDigest: versionDigest, balanceDigest: digest(34), currency: 'USD', amountDueMinorUnits: 125000, materialDigest: ''},
    recipientChannelBinding: {tenantId, recipientResolutionDigest: recipientDigest, recipientClassId: 'authorized_billing_contact', recipientReviewState: 'reviewed_exact_current', channelId: 'email', permissionResultState: 'unavailable', providerMode: 'provider_disabled', currentnessState: 'latest_exact_current', observedAt},
    actorAuthorityBinding: {actorId: uuid(40), sessionId: uuid(41), membershipId: uuid(42), sessionSubjectActorId: uuid(40), membershipSubjectActorId: uuid(40), actorTenantId: tenantId, sessionTenantId: tenantId, membershipTenantId: tenantId, actorState: 'active', sessionState: 'active', membershipState: 'active', membershipRoleId: 'owner', capabilityId: 'automation.financial_reminder.material.view', capabilityDecisionId: uuid(43), capabilityDecisionDigest: digest(43)},
    evaluatedAt: '2026-10-29T12:05:00.000000Z', materialDigest: '', idempotencyKeyDigest: '', requestDigest: ''
  };
  return seal(input);
}

function validate(input, trusted) {
  dataOnly(input); dataOnly(trusted);
  if (JSON.stringify(input) !== JSON.stringify(trusted)) throw new Error('trusted resolution');
  const envelope = contract.projectionEnvelope;
  exactKeys(input, envelope.exactFields); exactKeys(input.part11AEligibilityBinding, envelope.part11AEligibilityBindingExactFields); exactKeys(input.part11BPolicyBinding, envelope.part11BPolicyBindingExactFields); exactKeys(input.invoiceDocumentBinding, envelope.invoiceDocumentBindingExactFields); exactKeys(input.amountDueBinding, envelope.amountDueBindingExactFields); exactKeys(input.paymentDestinationBinding, envelope.paymentDestinationBindingExactFields); exactKeys(input.balanceExplanationBinding, envelope.balanceExplanationBindingExactFields); exactKeys(input.recipientChannelBinding, envelope.recipientChannelBindingExactFields); exactKeys(input.actorAuthorityBinding, envelope.actorAuthorityBindingExactFields);
  if (input.schemaVersion !== contract.contractVersion) throw new Error('version');
  const uuidValues = [input.tenantId, input.projectionId, input.part11AEligibilityBinding.resolutionId, input.part11BPolicyBinding.projectionId, input.part11BPolicyBinding.policyId, input.invoiceDocumentBinding.issuedInvoiceId, input.invoiceDocumentBinding.issuedInvoiceVersionId, input.invoiceDocumentBinding.customerId, input.part11AEligibilityBinding.sourceSetId, input.part11AEligibilityBinding.headTransitionId, input.actorAuthorityBinding.actorId, input.actorAuthorityBinding.sessionId, input.actorAuthorityBinding.membershipId, input.actorAuthorityBinding.capabilityDecisionId];
  const digestValues = [input.part11AEligibilityBinding.materialDigest, input.part11AEligibilityBinding.idempotencyKeyDigest, input.part11AEligibilityBinding.requestDigest, input.part11AEligibilityBinding.issuedVersionDigest, input.part11AEligibilityBinding.sourceSetDigest, input.part11AEligibilityBinding.axisMaterialDigest, input.part11AEligibilityBinding.headTransitionDigest, input.part11BPolicyBinding.materialDigest, input.part11BPolicyBinding.idempotencyKeyDigest, input.part11BPolicyBinding.requestDigest, input.part11BPolicyBinding.policyCanonicalDigest, input.invoiceDocumentBinding.invoiceDigest, input.invoiceDocumentBinding.issuedVersionDigest, input.invoiceDocumentBinding.customerIdentityDigest, input.invoiceDocumentBinding.termsDigest, input.amountDueBinding.balanceDigest, input.balanceExplanationBinding.explanationDigest, input.balanceExplanationBinding.materialDigest, input.recipientChannelBinding.recipientResolutionDigest, input.actorAuthorityBinding.capabilityDecisionDigest, input.materialDigest, input.idempotencyKeyDigest, input.requestDigest];
  if (uuidValues.some(value => !UUID.test(value)) || digestValues.some(value => !DIGEST.test(value))) throw new Error('identity');
  const tenant = input.tenantId; const invoice = input.invoiceDocumentBinding; const invoiceId = invoice.issuedInvoiceId; const versionDigest = invoice.issuedVersionDigest; const sourceSetId = input.part11AEligibilityBinding.sourceSetId; const sourceSetDigest = input.part11AEligibilityBinding.sourceSetDigest; const headId = input.part11AEligibilityBinding.headTransitionId; const headDigest = input.part11AEligibilityBinding.headTransitionDigest; const headSequence = input.part11AEligibilityBinding.headSequence;
  for (const value of [input.part11AEligibilityBinding.tenantId, input.part11BPolicyBinding.tenantId, invoice.tenantId, input.amountDueBinding.tenantId, input.recipientChannelBinding.tenantId, input.actorAuthorityBinding.actorTenantId, input.actorAuthorityBinding.sessionTenantId, input.actorAuthorityBinding.membershipTenantId]) if (value !== tenant) throw new Error('tenant');
  if (input.part11AEligibilityBinding.resultState !== contract.sourceBindingContract.requiredPart11AResult || input.part11AEligibilityBinding.reasonCode !== contract.sourceBindingContract.requiredPart11AReason || input.part11BPolicyBinding.resultState !== contract.sourceBindingContract.requiredPart11BResult || input.part11BPolicyBinding.reasonCode !== contract.sourceBindingContract.requiredPart11BReason) throw new Error('source result');
  if (input.part11AEligibilityBinding.issuedInvoiceId !== invoiceId || input.part11BPolicyBinding.issuedInvoiceId !== invoiceId || input.amountDueBinding.issuedInvoiceId !== invoiceId || input.part11AEligibilityBinding.issuedVersionDigest !== versionDigest || input.part11BPolicyBinding.issuedVersionDigest !== versionDigest || input.amountDueBinding.issuedVersionDigest !== versionDigest) throw new Error('invoice version');
  for (const value of [input.part11BPolicyBinding, invoice, input.amountDueBinding]) if (value.sourceSetId !== sourceSetId || value.sourceSetDigest !== sourceSetDigest || value.headTransitionId !== headId || value.headTransitionDigest !== headDigest || value.headSequence !== headSequence) throw new Error('source head');
  for (const value of [input.part11AEligibilityBinding.currentnessState, input.part11BPolicyBinding.currentnessState, invoice.currentnessState, input.amountDueBinding.currentnessState, input.recipientChannelBinding.currentnessState]) if (value !== contract.sourceBindingContract.requiredCurrentness) throw new Error('currentness');
  if (!Number.isSafeInteger(input.part11BPolicyBinding.policyVersion) || input.part11BPolicyBinding.policyVersion < 1 || input.part11BPolicyBinding.policyState !== 'draft_no_effect' || input.part11BPolicyBinding.rolloutState !== 'disabled_contract_only' || !['pre_due','due_today','overdue'].includes(input.part11BPolicyBinding.phaseId)) throw new Error('policy');
  if (invoice.invoiceState !== 'issued_current' || invoice.documentState !== 'customer_safe_current' || invoice.replacementState !== 'none_current' || invoice.termsMutationState !== 'unchanged_exact_current' || !Number.isSafeInteger(invoice.invoiceRevision) || invoice.invoiceRevision < 1 || !CURRENCY.test(invoice.currency)) throw new Error('document');
  const amount = input.amountDueBinding;
  if (!Number.isSafeInteger(amount.balanceRevision) || amount.balanceRevision < 1 || !Number.isSafeInteger(amount.amountDueMinorUnits) || amount.amountDueMinorUnits <= 0 || amount.amountDueMinorUnits > contract.bounds.maximumSafeMinorUnits || amount.currency !== invoice.currency || amount.balanceState !== 'positive_exact_current' || amount.pendingTenderState !== 'none_current' || amount.feeAddedMinorUnits !== 0 || amount.termsChanged !== false || amount.chargeInitiated !== false || amount.paymentMethodSelected !== null || amount.settlementClaimState !== 'unsettled_exact_current' || amount.accountingClaimState !== 'current_no_blocking_adjustment') throw new Error('amount');
  const destination = input.paymentDestinationBinding;
  if (destination.state !== contract.securePaymentDestinationContract.currentState || destination.reasonCode !== contract.securePaymentDestinationContract.currentReason || destination.chargeAuthority !== false || Object.entries(destination).some(([key, value]) => !['state','reasonCode','chargeAuthority'].includes(key) && value !== null)) throw new Error('destination');
  const explanation = input.balanceExplanationBinding; const catalog = contract.balanceExplanationCatalog[0];
  if (explanation.explanationId !== catalog.explanationId || explanation.explanationVersion !== catalog.explanationVersion || explanation.explanationDigest !== catalog.explanationDigest || explanation.fixedText !== catalog.fixedText || explanation.invoiceDigest !== invoice.invoiceDigest || explanation.issuedVersionDigest !== versionDigest || explanation.balanceDigest !== amount.balanceDigest || explanation.currency !== amount.currency || explanation.amountDueMinorUnits !== amount.amountDueMinorUnits || explanation.materialDigest !== hash(explanationMaterialOf(input))) throw new Error('explanation');
  if (hash(contract.balanceExplanationDigestNamespace + JSON.stringify({explanationId: catalog.explanationId, explanationVersion: catalog.explanationVersion, fixedText: catalog.fixedText})) !== catalog.explanationDigest) throw new Error('explanation catalog');
  const recipient = input.recipientChannelBinding;
  if (recipient.recipientResolutionDigest !== input.part11BPolicyBinding.recipientResolutionDigest || recipient.recipientClassId !== 'authorized_billing_contact' || recipient.recipientReviewState !== 'reviewed_exact_current' || recipient.channelId !== input.part11BPolicyBinding.channelId || !['email','sms'].includes(recipient.channelId) || recipient.permissionResultState !== input.part11BPolicyBinding.permissionResultState || recipient.permissionResultState !== 'unavailable' || recipient.providerMode !== 'provider_disabled' || input.part11BPolicyBinding.approvalState !== 'required_unavailable') throw new Error('recipient channel');
  const actor = input.actorAuthorityBinding;
  if (actor.actorId !== actor.sessionSubjectActorId || actor.actorId !== actor.membershipSubjectActorId || actor.actorState !== 'active' || actor.sessionState !== 'active' || actor.membershipState !== 'active' || actor.membershipRoleId !== 'owner' || actor.capabilityId !== 'automation.financial_reminder.material.view') throw new Error('actor');
  const evaluated = utcMicros(input.evaluatedAt); if (evaluated === null) throw new Error('time');
  for (const value of [input.part11AEligibilityBinding.observedAt, input.part11BPolicyBinding.observedAt, invoice.observedAt, amount.observedAt, recipient.observedAt]) { const observed = utcMicros(value); if (observed === null || observed > evaluated || evaluated - observed > BigInt(contract.bounds.maximumSourceObservationAgeSeconds) * 1000000n) throw new Error('observation'); }
  const issuedAt = utcMicros(invoice.issuedAt);
  if (issuedAt === null || issuedAt > evaluated || Buffer.byteLength(JSON.stringify(input)) > contract.bounds.maximumCanonicalRequestBytes || input.materialDigest !== hash(materialOf(input)) || input.idempotencyKeyDigest !== hash(idempotencyMaterialOf(input)) || input.requestDigest !== hash(requestOf(input))) throw new Error('digest');
}

function project(input, trusted) {
  validate(input, trusted); const fixed = contract.fixedDecision;
  return Object.freeze({projectionId: input.projectionId, tenantId: input.tenantId, issuedInvoiceId: input.invoiceDocumentBinding.issuedInvoiceId, issuedVersionDigest: input.invoiceDocumentBinding.issuedVersionDigest, currency: input.amountDueBinding.currency, amountDueMinorUnits: input.amountDueBinding.amountDueMinorUnits, policyId: input.part11BPolicyBinding.policyId, policyVersion: input.part11BPolicyBinding.policyVersion, phaseId: input.part11BPolicyBinding.phaseId, destinationState: input.paymentDestinationBinding.state, explanationId: input.balanceExplanationBinding.explanationId, evaluatedAt: input.evaluatedAt, resultState: fixed.resultState, reasonCode: fixed.reasonCode, labelId: fixed.labelId, fixedLabel: fixed.fixedLabel, ownerReadableMaterialOnly: true, reminderMaterialRecordCreated: false, scheduleCreated: false, worklistRecordCreated: false, taskCreated: false, messageCreated: false, paymentLinkCreated: false, providerAttemptCreated: false, chargeCreated: false, paymentMethodSelected: false, feeAdded: false, termsChanged: false, financialMutationCreated: false, accountingMutationCreated: false, balanceMutationCreated: false, externalEffectCreated: false, upstreamMutationCreated: false, moneyEffectCreated: false});
}

class History {
  constructor() { this.byId = new Map(); this.byStable = new Map(); }
  record(input, trusted) {
    const output = project(input, trusted); const prior = this.byId.get(input.projectionId);
    if (prior) { if (prior.requestDigest !== input.requestDigest || prior.materialDigest !== input.materialDigest || prior.idempotencyKeyDigest !== input.idempotencyKeyDigest) throw new Error('identity conflict'); return Object.freeze({...prior, replayed: true}); }
    if (this.byStable.has(input.idempotencyKeyDigest)) throw new Error('clone');
    const stored = Object.freeze({...output, requestDigest: input.requestDigest, materialDigest: input.materialDigest, idempotencyKeyDigest: input.idempotencyKeyDigest, replayed: false}); this.byId.set(input.projectionId, stored); this.byStable.set(input.idempotencyKeyDigest, input.projectionId); return stored;
  }
}

describe('Mission 28 Part 11C reminder material', () => {
  test('binds exact Part11B release provenance and all frozen inputs', () => {
    expect(contract.authority).toMatchObject({part: '11C', state: 'implementation_candidate_only', baselineCommit: 'a4da3b83936a411b4315e3a8bc43f69da0b52485', baselineTree: 'bd1aa5a1eb67684316e40dfaea01e5b1c9dd753b'});
    expect(contract.part11BRelease).toMatchObject({acceptedSourceHead: '914f5d4424a300d8ab3649141ecab6b5a32bb625', acceptedTree: 'bd1aa5a1eb67684316e40dfaea01e5b1c9dd753b', pullRequest: 594, mergedMain: 'a4da3b83936a411b4315e3a8bc43f69da0b52485', deploymentIdentity: 'fa5e57be-777b-4970-ab03-8f1c2040171d_SUCCESS_RUNNING', imageIdentity: 'sha256:02753e2605eadc2cdf8a00fae0a51c42b7f86f947086c0ab0318861e376f537d', runningInstance: '098014a5-7bc1-4171-bc50-e58a871b82fc'});
    expect(contract.frozenInputs).toHaveLength(13); for (const item of contract.frozenInputs) expect(digestLf(item.path)).toBe(item.normalizedLfSha256);
  });

  test('projects exact owner-readable invoice currency amount and explanation with fixed unavailable destination', () => {
    const input = fixture(); const output = project(input, copy(input)); exactKeys(output, contract.projectionEnvelope.outputFieldsCreatedOnlyByTrustedProjection);
    expect(output).toMatchObject({currency: 'USD', amountDueMinorUnits: 125000, destinationState: 'unavailable_no_accepted_secure_invoice_payment_destination', resultState: 'reminder_material_unavailable_no_secure_destination_or_external_authority', ownerReadableMaterialOnly: true, reminderMaterialRecordCreated: false, messageCreated: false, chargeCreated: false, externalEffectCreated: false, moneyEffectCreated: false});
  });

  test('binds Part11A eligibility and Part11B policy to the same exact invoice source set and head', () => {
    for (const mutation of [value => { value.part11AEligibilityBinding.resultState = 'ineligible_balance'; }, value => { value.part11BPolicyBinding.resultState = 'eligible'; }, value => { value.part11BPolicyBinding.issuedInvoiceId = uuid(99); }, value => { value.part11BPolicyBinding.issuedVersionDigest = digest(99); }, value => { value.part11BPolicyBinding.sourceSetDigest = digest(99); }, value => { value.invoiceDocumentBinding.headSequence += 1; }, value => { value.amountDueBinding.headTransitionDigest = digest(99); }, value => { value.part11AEligibilityBinding.currentnessState = 'stale'; }]) { const input = fixture(); mutation(input); seal(input); expect(() => project(input, copy(input))).toThrow(); }
    const trusted = fixture(); const retarget = copy(trusted); retarget.invoiceDocumentBinding.customerId = uuid(99); seal(retarget); expect(() => project(retarget, trusted)).toThrow('trusted resolution');
  });

  test('requires one exact issued current customer-safe nonreplaced document and unchanged terms', () => {
    for (const mutation of [value => { value.invoiceDocumentBinding.invoiceState = 'draft'; }, value => { value.invoiceDocumentBinding.documentState = 'private_internal'; }, value => { value.invoiceDocumentBinding.replacementState = 'replaced'; }, value => { value.invoiceDocumentBinding.termsMutationState = 'changed'; }, value => { value.invoiceDocumentBinding.invoiceRevision = 0; }, value => { value.invoiceDocumentBinding.currency = 'usd'; value.amountDueBinding.currency = 'usd'; value.balanceExplanationBinding.currency = 'usd'; }]) { const input = fixture(); mutation(input); seal(input); expect(() => project(input, copy(input))).toThrow('document'); }
    const futureIssued = fixture(); futureIssued.invoiceDocumentBinding.issuedAt = '2026-10-29T12:05:00.000001Z'; seal(futureIssued); expect(() => project(futureIssued, copy(futureIssued))).toThrow('digest');
  });

  test('requires exact positive integer minor-unit amount due and same currency without fee terms charge method or outcome claims', () => {
    for (const mutation of [value => { value.amountDueBinding.amountDueMinorUnits = 0; value.balanceExplanationBinding.amountDueMinorUnits = 0; }, value => { value.amountDueBinding.amountDueMinorUnits = 1.5; }, value => { value.amountDueBinding.currency = 'EUR'; }, value => { value.amountDueBinding.feeAddedMinorUnits = 1; }, value => { value.amountDueBinding.termsChanged = true; }, value => { value.amountDueBinding.chargeInitiated = true; }, value => { value.amountDueBinding.paymentMethodSelected = uuid(90); }, value => { value.amountDueBinding.settlementClaimState = 'settled'; }, value => { value.amountDueBinding.accountingClaimState = 'earned'; }]) { const input = fixture(); mutation(input); seal(input); expect(() => project(input, copy(input))).toThrow(); }
  });

  test('fails closed on every candidate supplied payment destination link token method provider or charge value', () => {
    expect(contract.currentAvailability.secureInvoicePaymentDestinationAuthorityAvailable).toBe(false);
    for (const mutation of [value => { value.paymentDestinationBinding.destinationId = uuid(90); }, value => { value.paymentDestinationBinding.destinationVersion = 1; }, value => { value.paymentDestinationBinding.destinationDigest = digest(90); }, value => { value.paymentDestinationBinding.rawToken = 'secret'; }, value => { value.paymentDestinationBinding.url = 'https://pay.example.test/x'; }, value => { value.paymentDestinationBinding.paymentMethodId = uuid(91); }, value => { value.paymentDestinationBinding.providerAccountId = 'acct_123'; }, value => { value.paymentDestinationBinding.chargeAuthority = true; }, value => { value.paymentDestinationBinding.state = 'exact_current'; }]) { const input = fixture(); mutation(input); seal(input); expect(() => project(input, copy(input))).toThrow('destination'); }
  });

  test('requires one immutable customer-safe explanation bound to exact invoice version balance currency and amount', () => {
    expect(contract.balanceExplanationCatalog[0].explanationDigest).toBe(hash(contract.balanceExplanationDigestNamespace + JSON.stringify({explanationId: contract.balanceExplanationCatalog[0].explanationId, explanationVersion: 1, fixedText: contract.balanceExplanationCatalog[0].fixedText})));
    for (const mutation of [value => { value.balanceExplanationBinding.fixedText = 'Pay immediately.'; }, value => { value.balanceExplanationBinding.explanationDigest = digest(99); }, value => { value.balanceExplanationBinding.invoiceDigest = digest(99); }, value => { value.balanceExplanationBinding.balanceDigest = digest(99); }, value => { value.balanceExplanationBinding.amountDueMinorUnits += 1; }, value => { value.balanceExplanationBinding.currency = 'EUR'; }]) { const input = fixture(); mutation(input); seal(input); expect(() => project(input, copy(input))).toThrow('explanation'); }
    expect(contract.balanceExplanationCatalog[0].fixedText).not.toMatch(/@|https?:|\$|urgent|immediate|threat|legal|token|provider|invoice\s*#|[0-9]{4,}/i);
  });

  test('preserves exact reviewed recipient disabled channel unavailable approval and owner capability', () => {
    for (const mutation of [value => { value.recipientChannelBinding.recipientResolutionDigest = digest(99); }, value => { value.recipientChannelBinding.recipientClassId = 'customer'; }, value => { value.recipientChannelBinding.recipientReviewState = 'candidate'; }, value => { value.recipientChannelBinding.channelId = 'sms'; }, value => { value.recipientChannelBinding.permissionResultState = 'clear'; }, value => { value.recipientChannelBinding.providerMode = 'live'; }, value => { value.part11BPolicyBinding.approvalState = 'approved'; }, value => { value.actorAuthorityBinding.sessionSubjectActorId = uuid(99); }, value => { value.actorAuthorityBinding.actorState = 'suspended'; }, value => { value.actorAuthorityBinding.capabilityId = 'automation.financial_reminder.send'; }]) { const input = fixture(); mutation(input); seal(input); expect(() => project(input, copy(input))).toThrow(); }
  });

  test('denies stale future or over-age source evidence and later source changes', () => {
    for (const mutation of [value => { value.invoiceDocumentBinding.currentnessState = 'stale'; }, value => { value.amountDueBinding.observedAt = '2026-10-29T11:59:59.999999Z'; }, value => { value.part11BPolicyBinding.observedAt = '2026-10-29T12:05:00.000001Z'; }, value => { value.part11AEligibilityBinding.sourceSetDigest = digest(99); }]) { const input = fixture(); mutation(input); seal(input); expect(() => project(input, copy(input))).toThrow(); }
    const prior = fixture(); const correctedTerms = copy(prior); correctedTerms.invoiceDocumentBinding.termsDigest = digest(99); seal(correctedTerms); expect(project(correctedTerms, copy(correctedTerms)).resultState).toBe(contract.fixedDecision.resultState); expect(correctedTerms.idempotencyKeyDigest).not.toBe(prior.idempotencyKeyDigest);
  });

  test('uses stable semantic idempotency and rejects clone and conflicting replay reuse', () => {
    const history = new History(); const first = fixture(); expect(history.record(first, copy(first)).replayed).toBe(false); expect(history.record(copy(first), copy(first)).replayed).toBe(true);
    const clone = copy(first); clone.projectionId = uuid(99); clone.evaluatedAt = '2026-10-29T12:06:00.000000Z'; seal(clone); expect(clone.idempotencyKeyDigest).toBe(first.idempotencyKeyDigest); expect(() => history.record(clone, copy(clone))).toThrow('clone');
    const reorderedClone = copy(first); reorderedClone.projectionId = uuid(98); reorderedClone.evaluatedAt = '2026-10-29T12:06:00.000000Z'; reorderedClone.amountDueBinding = Object.fromEntries(Object.entries(reorderedClone.amountDueBinding).reverse()); seal(reorderedClone); expect(reorderedClone.idempotencyKeyDigest).toBe(first.idempotencyKeyDigest); expect(() => history.record(reorderedClone, copy(reorderedClone))).toThrow('clone');
    const conflict = copy(first); conflict.evaluatedAt = '2026-10-29T12:06:00.000000Z'; seal(conflict); expect(conflict.idempotencyKeyDigest).toBe(first.idempotencyKeyDigest); expect(() => history.record(conflict, copy(conflict))).toThrow('identity conflict');
    const changed = copy(first); changed.amountDueBinding.amountDueMinorUnits += 1; changed.balanceExplanationBinding.amountDueMinorUnits += 1; seal(changed); expect(changed.idempotencyKeyDigest).not.toBe(first.idempotencyKeyDigest);
  });

  test('rejects extra missing accessor symbol proxy toJSON custom prototype sparse and alias data before hooks', () => {
    for (const mutation of [value => { value.extra = 'x'; }, value => { delete value.requestDigest; }, value => { value.invoiceDocumentBinding.toJSON = () => ({}); }, value => { Object.setPrototypeOf(value.amountDueBinding, {}); }, value => { value.amountDueBinding = value.invoiceDocumentBinding; }]) { const input = fixture(); mutation(input); expect(() => project(input, fixture())).toThrow(); }
    let getters = 0; const accessor = fixture(); Object.defineProperty(accessor.amountDueBinding, 'amountDueMinorUnits', {enumerable: true, get() { getters += 1; return 125000; }}); expect(() => project(accessor, fixture())).toThrow(); expect(getters).toBe(0);
    const symbol = fixture(); symbol[Symbol('secret')] = 'sk_secret'; expect(() => project(symbol, fixture())).toThrow();
    let traps = 0; const proxy = new Proxy(fixture(), {get() { traps += 1; throw new Error('trap'); }, ownKeys() { traps += 1; throw new Error('trap'); }}); expect(() => project(proxy, fixture())).toThrow(); expect(traps).toBe(0);
    const sparse = fixture(); sparse.paymentDestinationBinding = []; sparse.paymentDestinationBinding[13] = false; expect(() => project(sparse, fixture())).toThrow();
  });

  test('returns one fixed nonreflective unavailable label and creates zero records messages mutations or effects', () => {
    expect(contract.fixedDecision.fixedLabel).toBe('Reminder material unavailable — secure payment destination and communication authority are not available'); expect(contract.fixedDecision.fixedLabel).not.toMatch(/@|phone|token|sk_|customer|invoiceNumber|amount|description|note|urgent|[0-9]{4,}/i);
    for (const value of Object.values(contract.privacyAndEffects)) expect(value).toBe(0);
    const output = project(fixture(), fixture()); for (const key of ['reminderMaterialRecordCreated','scheduleCreated','worklistRecordCreated','taskCreated','messageCreated','paymentLinkCreated','providerAttemptCreated','chargeCreated','paymentMethodSelected','feeAdded','termsChanged','financialMutationCreated','accountingMutationCreated','balanceMutationCreated','externalEffectCreated','upstreamMutationCreated','moneyEffectCreated']) expect(output[key]).toBe(false);
  });

  test('freezes docs-tests-only scope with migration287 latest and no288', () => {
    expect(contract.runtimeBoundary).toMatchObject({newMigration: false, newTableFunctionRouteOrUi: false, materialRecordCreated: false, nextMigrationAbsent: '288'});
    const migrations = fs.readdirSync(path.join(ROOT, 'migrations')).filter(name => /^\d+_/.test(name)).sort(); expect(migrations).toHaveLength(283); expect(migrations.at(-1)).toBe('287_canonical_automation_estimate_quote_resolution_v1.sql'); expect(migrations.some(name => name.startsWith('288_'))).toBe(false);
  });

  test('roadmap and ledger record Part11B released Part11C candidate and later slices planned', () => {
    const roadmap = fs.readFileSync(path.join(ROOT, 'docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md'), 'utf8'); const ledger = fs.readFileSync(path.join(ROOT, 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md'), 'utf8');
    for (const value of [roadmap, ledger]) { expect(value).toContain('Parts 1A–12D are released. Part 13A is the sole implementation candidate.'); expect(value).toContain('914f5d4424a300d8ab3649141ecab6b5a32bb625'); expect(value).toContain('fa5e57be-777b-4970-ab03-8f1c2040171d'); expect(value).toContain('sha256:02753e2605eadc2cdf8a00fae0a51c42b7f86f947086c0ab0318861e376f537d'); }
    expect((ledger.match(/\| \*\*Released\*\* \|/g) || []).length).toBe(54); expect((ledger.match(/\| \*\*Implementation candidate\*\* \|/g) || []).length).toBe(1); expect((ledger.match(/\| Planned \/ unimplemented \|/g) || []).length).toBe(11);
  });
});
