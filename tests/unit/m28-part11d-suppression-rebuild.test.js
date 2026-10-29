const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { types } = require('util');

const ROOT = path.resolve(__dirname, '../..');
const contract = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/architecture/MISSION_28_PART11D_SUPPRESSION_REBUILD_CONTRACT.json'), 'utf8'));
const UUID = new RegExp(contract.identityGrammar.uuidPattern);
const DIGEST = new RegExp(contract.identityGrammar.digestPattern);
const CURRENCY = new RegExp(contract.identityGrammar.currencyPattern);
const UTC = new RegExp(contract.identityGrammar.utcInstantPattern);

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const digest = n => `sha256:${Number(n).toString(16).padStart(64, '0')}`;
const copy = value => JSON.parse(JSON.stringify(value));
const canonicalize = value => Array.isArray(value) ? value.map(canonicalize) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])])) : value;
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
  for (const descriptor of Object.values(descriptors)) {
    if (!descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) throw new Error('descriptor');
    dataOnly(descriptor.value, seen);
  }
}

function exactKeys(value, keys) {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) throw new Error('keys');
}

function micros(value) {
  if (typeof value !== 'string' || !UTC.test(value)) return null;
  const milliseconds = Date.parse(`${value.slice(0, 19)}Z`);
  return Number.isFinite(milliseconds) ? BigInt(milliseconds) * 1000n + BigInt(value.slice(20, 26)) : null;
}

function materialOf(input) { const value = copy(input); delete value.decisionId; delete value.materialDigest; delete value.idempotencyKeyDigest; delete value.requestDigest; return value; }
function idempotencyMaterialOf(input) {
  const value = materialOf(input); delete value.evaluatedAt;
  value.changeSetBinding.evidence.sort((left, right) => {
    const byPrecedence = contract.triggerCatalog.find(item => item.kind === left.kind).precedence - contract.triggerCatalog.find(item => item.kind === right.kind).precedence;
    return byPrecedence || left.evidenceId.localeCompare(right.evidenceId);
  });
  return value;
}
function requestOf(input) { const value = copy(input); delete value.materialDigest; delete value.idempotencyKeyDigest; delete value.requestDigest; return value; }
function seal(input) { input.materialDigest = hash(materialOf(input)); input.idempotencyKeyDigest = hash(idempotencyMaterialOf(input)); input.requestDigest = hash(requestOf(input)); return input; }

function fixture(kind = 'partial_payment') {
  const tenantId = uuid(1); const invoiceId = uuid(10); const customerId = uuid(11); const oldVersion = digest(12); const sourceSetId = uuid(13); const sourceSetDigest = digest(13); const headId = uuid(14); const headDigest = digest(14); const recipientDigest = digest(15); const observedAt = '2026-10-29T12:04:00.000000Z';
  const input = {
    schemaVersion: contract.contractVersion,
    tenantId,
    decisionId: uuid(2),
    part11AEligibilityBinding: {tenantId, resolutionId: uuid(20), materialDigest: digest(20), resultState: 'eligible_for_owner_collection_review_only', reasonCode: 'exact_current_collection_review_eligible', issuedInvoiceId: invoiceId, issuedVersionDigest: oldVersion, customerId, sourceSetId, sourceSetDigest, axisMaterialDigest: digest(21), headTransitionId: headId, headTransitionDigest: headDigest, headSequence: 5, recordedCurrentnessState: 'latest_exact_current_at_creation'},
    part11BPolicyBinding: {tenantId, projectionId: uuid(21), materialDigest: digest(22), resultState: 'reminder_policy_definition_valid_no_effect_external_authority_unavailable', reasonCode: 'financial_reminder_source_permission_approval_schedule_and_effect_authority_unavailable', policyId: uuid(22), policyVersion: 1, policyCanonicalDigest: digest(23), phaseId: 'overdue', issuedInvoiceId: invoiceId, issuedVersionDigest: oldVersion, recipientResolutionDigest: recipientDigest, channelId: 'email', permissionResultState: 'unavailable', approvalState: 'required_unavailable', sourceSetId, sourceSetDigest, headTransitionId: headId, headTransitionDigest: headDigest, headSequence: 5, recordedCurrentnessState: 'latest_exact_current_at_creation'},
    part11CMaterialBinding: {tenantId, projectionId: uuid(23), materialDigest: digest(24), idempotencyKeyDigest: digest(25), requestDigest: digest(26), resultState: 'reminder_material_unavailable_no_secure_destination_or_external_authority', reasonCode: 'secure_payment_destination_permission_approval_schedule_and_effect_authority_unavailable', issuedInvoiceId: invoiceId, issuedVersionDigest: oldVersion, invoiceDigest: digest(27), customerId, customerIdentityDigest: digest(28), currency: 'USD', amountDueMinorUnits: 125000, balanceDigest: digest(29), termsDigest: digest(30), policyId: uuid(22), policyVersion: 1, phaseId: 'overdue', destinationState: 'unavailable_no_accepted_secure_invoice_payment_destination', explanationId: 'current_invoice_balance_no_effect_v1', recipientResolutionDigest: recipientDigest, sourceSetId, sourceSetDigest, headTransitionId: headId, headTransitionDigest: headDigest, headSequence: 5, recordedCurrentnessState: 'latest_exact_current_at_creation'},
    changeSetBinding: {tenantId, changeSetId: uuid(30), priorSourceSetId: sourceSetId, priorSourceSetDigest: sourceSetDigest, priorHeadTransitionId: headId, priorHeadTransitionDigest: headDigest, priorHeadSequence: 5, currentSourceSetId: uuid(31), currentSourceSetDigest: digest(31), currentHeadTransitionId: uuid(32), currentHeadTransitionDigest: digest(32), currentHeadSequence: 6, currentHeadState: 'active', effectiveSnapshotId: uuid(33), effectiveSnapshotDigest: digest(33), currentnessResolutionId: uuid(34), currentnessResolutionDigest: digest(34), currentnessState: 'latest_exact_current', observedAt, evidence: []},
    actorAuthorityBinding: {actorId: uuid(40), sessionId: uuid(41), membershipId: uuid(42), sessionSubjectActorId: uuid(40), membershipSubjectActorId: uuid(40), actorTenantId: tenantId, sessionTenantId: tenantId, membershipTenantId: tenantId, actorState: 'active', sessionState: 'active', membershipState: 'active', membershipRoleId: 'owner', capabilityId: 'automation.financial_reminder.suppression_rebuild.view', capabilityDecisionId: uuid(43), capabilityDecisionDigest: digest(43)},
    evaluatedAt: '2026-10-29T12:05:00.000000Z', materialDigest: '', idempotencyKeyDigest: '', requestDigest: ''
  };
  setEvidence(input, [kind]);
  return seal(input);
}

function setEvidence(input, kinds) {
  const prior = input.part11CMaterialBinding;
  const hasFinancial = kinds.some(kind => contract.triggerCatalog.find(item => item.kind === kind).sourceClass === 'financial_or_document');
  if (hasFinancial) {
    input.changeSetBinding.currentSourceSetId = uuid(31); input.changeSetBinding.currentSourceSetDigest = digest(31); input.changeSetBinding.currentHeadTransitionId = uuid(32); input.changeSetBinding.currentHeadTransitionDigest = digest(32); input.changeSetBinding.currentHeadSequence = input.changeSetBinding.priorHeadSequence + 1;
  } else {
    input.changeSetBinding.currentSourceSetId = input.changeSetBinding.priorSourceSetId; input.changeSetBinding.currentSourceSetDigest = input.changeSetBinding.priorSourceSetDigest; input.changeSetBinding.currentHeadTransitionId = input.changeSetBinding.priorHeadTransitionId; input.changeSetBinding.currentHeadTransitionDigest = input.changeSetBinding.priorHeadTransitionDigest; input.changeSetBinding.currentHeadSequence = input.changeSetBinding.priorHeadSequence;
  }
  input.changeSetBinding.evidence = kinds.map((kind, index) => {
    const rule = contract.triggerCatalog.find(item => item.kind === kind); const financial = rule.sourceClass === 'financial_or_document';
    const positive = ['partial_payment','credit','reversal','reopening','payment_failure'].includes(kind); const nonnegative = ['replacement','correction'].includes(kind);
    return {evidenceId: uuid(100 + index), kind, sourceAuthorityId: rule.sourceAuthorityId, sourceRecordId: uuid(200 + index), sourceRevision: index + 1, sourceDigest: digest(200 + index), authorityResolutionId: uuid(300 + index), authorityResolutionDigest: digest(300 + index), authoritySequence: index + 1, eventId: uuid(400 + index), eventDigest: digest(400 + index), eventTime: '2026-10-29T12:03:00.000000Z', observedAt: '2026-10-29T12:04:00.000000Z', tenantId: input.tenantId, issuedInvoiceId: prior.issuedInvoiceId, issuedVersionDigest: kind === 'replacement' ? digest(999) : prior.issuedVersionDigest, customerId: prior.customerId, recipientResolutionDigest: financial ? null : prior.recipientResolutionDigest, currency: kind === 'full_payment' || positive || nonnegative ? prior.currency : null, amountDueMinorUnits: kind === 'full_payment' ? 0 : positive ? 100000 : nonnegative ? 90000 : null, state: rule.state, currentnessState: 'latest_exact_current', headTransitionId: financial ? input.changeSetBinding.currentHeadTransitionId : null, headTransitionDigest: financial ? input.changeSetBinding.currentHeadTransitionDigest : null, headSequence: financial ? input.changeSetBinding.currentHeadSequence : null};
  });
}

function validate(input, trusted) {
  dataOnly(input); dataOnly(trusted);
  if (hash(input) !== hash(trusted)) throw new Error('trusted resolution');
  const envelope = contract.decisionEnvelope;
  exactKeys(input, envelope.exactFields); exactKeys(input.part11AEligibilityBinding, envelope.part11AEligibilityBindingExactFields); exactKeys(input.part11BPolicyBinding, envelope.part11BPolicyBindingExactFields); exactKeys(input.part11CMaterialBinding, envelope.part11CMaterialBindingExactFields); exactKeys(input.changeSetBinding, envelope.changeSetBindingExactFields); exactKeys(input.actorAuthorityBinding, envelope.actorAuthorityBindingExactFields); for (const evidence of input.changeSetBinding.evidence) exactKeys(evidence, envelope.evidenceExactFields);
  if (input.schemaVersion !== contract.contractVersion || !UUID.test(input.tenantId) || !UUID.test(input.decisionId)) throw new Error('identity');
  const a = input.part11AEligibilityBinding; const b = input.part11BPolicyBinding; const c = input.part11CMaterialBinding; const change = input.changeSetBinding;
  const identities = [a.resolutionId, a.issuedInvoiceId, a.customerId, b.projectionId, b.policyId, b.issuedInvoiceId, c.projectionId, c.issuedInvoiceId, c.customerId, change.changeSetId, change.priorSourceSetId, change.priorHeadTransitionId, change.currentSourceSetId, change.currentHeadTransitionId, change.effectiveSnapshotId, change.currentnessResolutionId, input.actorAuthorityBinding.actorId, input.actorAuthorityBinding.sessionId, input.actorAuthorityBinding.membershipId, input.actorAuthorityBinding.capabilityDecisionId];
  const digests = [a.materialDigest, a.issuedVersionDigest, a.sourceSetDigest, a.axisMaterialDigest, a.headTransitionDigest, b.materialDigest, b.policyCanonicalDigest, b.issuedVersionDigest, b.recipientResolutionDigest, b.sourceSetDigest, b.headTransitionDigest, c.materialDigest, c.idempotencyKeyDigest, c.requestDigest, c.issuedVersionDigest, c.invoiceDigest, c.customerIdentityDigest, c.balanceDigest, c.termsDigest, c.recipientResolutionDigest, c.sourceSetDigest, c.headTransitionDigest, change.priorSourceSetDigest, change.priorHeadTransitionDigest, change.currentSourceSetDigest, change.currentHeadTransitionDigest, change.effectiveSnapshotDigest, change.currentnessResolutionDigest, input.actorAuthorityBinding.capabilityDecisionDigest, input.materialDigest, input.idempotencyKeyDigest, input.requestDigest];
  if (identities.some(value => !UUID.test(value)) || digests.some(value => !DIGEST.test(value))) throw new Error('identity');
  for (const value of [a.tenantId, b.tenantId, c.tenantId, change.tenantId, input.actorAuthorityBinding.actorTenantId, input.actorAuthorityBinding.sessionTenantId, input.actorAuthorityBinding.membershipTenantId]) if (value !== input.tenantId) throw new Error('tenant');
  if (a.resultState !== contract.sourceBindingContract.acceptedPart11AResult || a.reasonCode !== contract.sourceBindingContract.acceptedPart11AReason || b.resultState !== contract.sourceBindingContract.acceptedPart11BResult || b.reasonCode !== contract.sourceBindingContract.acceptedPart11BReason || c.resultState !== contract.sourceBindingContract.acceptedPart11CResult || c.reasonCode !== contract.sourceBindingContract.acceptedPart11CReason || c.destinationState !== contract.sourceBindingContract.acceptedPart11CDestinationState || c.explanationId !== contract.sourceBindingContract.acceptedPart11CExplanationId) throw new Error('prior authority');
  if (a.issuedInvoiceId !== c.issuedInvoiceId || b.issuedInvoiceId !== c.issuedInvoiceId || a.issuedVersionDigest !== c.issuedVersionDigest || b.issuedVersionDigest !== c.issuedVersionDigest || a.customerId !== c.customerId || b.policyId !== c.policyId || b.policyVersion !== c.policyVersion || !Number.isSafeInteger(c.policyVersion) || c.policyVersion < 1 || b.phaseId !== c.phaseId || !['pre_due','due_today','overdue'].includes(c.phaseId) || b.recipientResolutionDigest !== c.recipientResolutionDigest || !CURRENCY.test(c.currency) || !Number.isSafeInteger(c.amountDueMinorUnits) || c.amountDueMinorUnits <= 0) throw new Error('prior binding');
  for (const value of [a, b, c]) if (value.sourceSetId !== c.sourceSetId || value.sourceSetDigest !== c.sourceSetDigest || value.headTransitionId !== c.headTransitionId || value.headTransitionDigest !== c.headTransitionDigest || value.headSequence !== c.headSequence || value.recordedCurrentnessState !== 'latest_exact_current_at_creation') throw new Error('prior head');
  if (change.priorSourceSetId !== c.sourceSetId || change.priorSourceSetDigest !== c.sourceSetDigest || change.priorHeadTransitionId !== c.headTransitionId || change.priorHeadTransitionDigest !== c.headTransitionDigest || change.priorHeadSequence !== c.headSequence || change.currentHeadState !== 'active' || change.currentnessState !== 'latest_exact_current' || !Number.isSafeInteger(change.priorHeadSequence) || change.priorHeadSequence < 1 || !Number.isSafeInteger(change.currentHeadSequence) || change.currentHeadSequence < 1) throw new Error('change head');
  if (!Array.isArray(change.evidence) || change.evidence.length < 1 || change.evidence.length > contract.bounds.maximumEvidenceItems) throw new Error('evidence count');
  const evidenceIds = new Set(); const kinds = new Set(); let hasFinancial = false;
  const evaluated = micros(input.evaluatedAt); const changeObserved = micros(change.observedAt); if (evaluated === null || changeObserved === null || changeObserved > evaluated || evaluated - changeObserved > BigInt(contract.bounds.maximumSourceObservationAgeSeconds) * 1000000n) throw new Error('time');
  for (const evidence of change.evidence) {
    const rule = contract.triggerCatalog.find(item => item.kind === evidence.kind); if (!rule || evidence.sourceAuthorityId !== rule.sourceAuthorityId || evidence.state !== rule.state) throw new Error('trigger');
    if (!UUID.test(evidence.evidenceId) || !UUID.test(evidence.sourceRecordId) || !UUID.test(evidence.authorityResolutionId) || !UUID.test(evidence.eventId) || !DIGEST.test(evidence.sourceDigest) || !DIGEST.test(evidence.authorityResolutionDigest) || !DIGEST.test(evidence.eventDigest) || !Number.isSafeInteger(evidence.sourceRevision) || evidence.sourceRevision < 1 || !Number.isSafeInteger(evidence.authoritySequence) || evidence.authoritySequence < 1 || evidenceIds.has(evidence.evidenceId) || kinds.has(evidence.kind)) throw new Error('evidence identity');
    evidenceIds.add(evidence.evidenceId); kinds.add(evidence.kind);
    if (evidence.tenantId !== input.tenantId || evidence.issuedInvoiceId !== c.issuedInvoiceId || evidence.customerId !== c.customerId || evidence.currentnessState !== 'latest_exact_current') throw new Error('evidence binding');
    if (evidence.kind === 'replacement' ? evidence.issuedVersionDigest === c.issuedVersionDigest : evidence.issuedVersionDigest !== c.issuedVersionDigest) throw new Error('evidence version');
    const eventTime = micros(evidence.eventTime); const observedAt = micros(evidence.observedAt); if (eventTime === null || observedAt === null || eventTime > observedAt || observedAt > evaluated || evaluated - observedAt > BigInt(contract.bounds.maximumSourceObservationAgeSeconds) * 1000000n) throw new Error('evidence time');
    const financial = rule.sourceClass === 'financial_or_document'; hasFinancial ||= financial;
    if (financial) {
      if (evidence.recipientResolutionDigest !== null || evidence.headTransitionId !== change.currentHeadTransitionId || evidence.headTransitionDigest !== change.currentHeadTransitionDigest || evidence.headSequence !== change.currentHeadSequence) throw new Error('financial head');
    } else if (evidence.recipientResolutionDigest !== c.recipientResolutionDigest || evidence.headTransitionId !== null || evidence.headTransitionDigest !== null || evidence.headSequence !== null || evidence.currency !== null || evidence.amountDueMinorUnits !== null) throw new Error('human authority');
    const positive = ['partial_payment','credit','reversal','reopening','payment_failure'].includes(evidence.kind); const nonnegative = ['replacement','correction'].includes(evidence.kind);
    if (evidence.kind === 'full_payment') { if (evidence.currency !== c.currency || evidence.amountDueMinorUnits !== 0) throw new Error('full payment'); }
    else if (positive) { if (evidence.currency !== c.currency || !Number.isSafeInteger(evidence.amountDueMinorUnits) || evidence.amountDueMinorUnits <= 0 || evidence.amountDueMinorUnits > contract.bounds.maximumSafeMinorUnits) throw new Error('positive amount'); }
    else if (nonnegative) { if (evidence.currency !== c.currency || !Number.isSafeInteger(evidence.amountDueMinorUnits) || evidence.amountDueMinorUnits < 0 || evidence.amountDueMinorUnits > contract.bounds.maximumSafeMinorUnits) throw new Error('replacement amount'); }
    else if (financial && (evidence.currency !== null || evidence.amountDueMinorUnits !== null)) throw new Error('nonclaim amount');
  }
  if (hasFinancial) {
    if (change.currentHeadSequence !== change.priorHeadSequence + 1 || change.currentHeadTransitionId === change.priorHeadTransitionId || change.currentHeadTransitionDigest === change.priorHeadTransitionDigest || change.currentSourceSetId === change.priorSourceSetId || change.currentSourceSetDigest === change.priorSourceSetDigest) throw new Error('financial change');
  } else if (change.currentHeadSequence !== change.priorHeadSequence || change.currentHeadTransitionId !== change.priorHeadTransitionId || change.currentHeadTransitionDigest !== change.priorHeadTransitionDigest || change.currentSourceSetId !== change.priorSourceSetId || change.currentSourceSetDigest !== change.priorSourceSetDigest) throw new Error('human source retarget');
  const actor = input.actorAuthorityBinding; if (actor.actorId !== actor.sessionSubjectActorId || actor.actorId !== actor.membershipSubjectActorId || actor.actorState !== 'active' || actor.sessionState !== 'active' || actor.membershipState !== 'active' || actor.membershipRoleId !== 'owner' || actor.capabilityId !== 'automation.financial_reminder.suppression_rebuild.view') throw new Error('actor');
  if (Buffer.byteLength(JSON.stringify(input)) > contract.bounds.maximumCanonicalRequestBytes || input.materialDigest !== hash(materialOf(input)) || input.idempotencyKeyDigest !== hash(idempotencyMaterialOf(input)) || input.requestDigest !== hash(requestOf(input))) throw new Error('digest');
}

function project(input, trusted) {
  validate(input, trusted);
  const selected = [...input.changeSetBinding.evidence].sort((left, right) => contract.triggerCatalog.find(item => item.kind === left.kind).precedence - contract.triggerCatalog.find(item => item.kind === right.kind).precedence)[0];
  const rule = contract.triggerCatalog.find(item => item.kind === selected.kind);
  return Object.freeze({decisionId: input.decisionId, tenantId: input.tenantId, issuedInvoiceId: input.part11CMaterialBinding.issuedInvoiceId, issuedVersionDigest: input.part11CMaterialBinding.issuedVersionDigest, policyId: input.part11BPolicyBinding.policyId, policyVersion: input.part11BPolicyBinding.policyVersion, selectedKind: rule.kind, selectedAction: rule.action, selectedEvidenceId: selected.evidenceId, currentHeadTransitionId: input.changeSetBinding.currentHeadTransitionId, currentHeadTransitionDigest: input.changeSetBinding.currentHeadTransitionDigest, currentHeadSequence: input.changeSetBinding.currentHeadSequence, evaluatedAt: input.evaluatedAt, resultState: rule.action === 'suppress' ? 'reminder_suppressed_no_effect' : 'reminder_rebuild_required_no_effect', reasonCode: rule.reasonCode, labelId: rule.labelId, fixedLabel: rule.fixedLabel, ownerReadableDecisionOnly: true, suppressionRecordCreated: false, rebuildRecordCreated: false, materialRecordCreated: false, scheduleCreated: false, worklistRecordCreated: false, taskCreated: false, messageCreated: false, providerAttemptCreated: false, financialMutationCreated: false, accountingMutationCreated: false, balanceMutationCreated: false, externalEffectCreated: false, upstreamMutationCreated: false, moneyEffectCreated: false});
}

class History {
  constructor() { this.byId = new Map(); this.byStable = new Map(); }
  record(input, trusted) {
    const output = project(input, trusted); const prior = this.byId.get(input.decisionId);
    if (prior) { if (prior.requestDigest !== input.requestDigest || prior.materialDigest !== input.materialDigest || prior.idempotencyKeyDigest !== input.idempotencyKeyDigest) throw new Error('identity conflict'); return Object.freeze({...prior, replayed: true}); }
    if (this.byStable.has(input.idempotencyKeyDigest)) throw new Error('clone');
    const stored = Object.freeze({...output, requestDigest: input.requestDigest, materialDigest: input.materialDigest, idempotencyKeyDigest: input.idempotencyKeyDigest, replayed: false}); this.byId.set(input.decisionId, stored); this.byStable.set(input.idempotencyKeyDigest, input.decisionId); return stored;
  }
}

describe('Mission 28 Part 11D suppression and rebuild', () => {
  test('binds exact Part11C release provenance and frozen accepted inputs', () => {
    expect(contract.authority).toMatchObject({part: '11D', state: 'implementation_candidate_only', baselineCommit: '05d8457ecd1ff48b338e1da6337808707e92deb5', baselineTree: 'b1545862770f1519a42434f7b2a9871dd387db17'});
    expect(contract.part11CRelease).toMatchObject({acceptedSourceHead: '2d2d082399cd1f35519fa0cb4a837efa0fec45e2', acceptedTree: 'b1545862770f1519a42434f7b2a9871dd387db17', pullRequest: 595, mergedMain: '05d8457ecd1ff48b338e1da6337808707e92deb5', deploymentIdentity: '2135f372-13c2-419b-8b8a-12da526d1a95_SUCCESS_RUNNING', imageIdentity: 'sha256:957fc8466a71ee7d07c38d281cebba7c7b1e0e6b8da43d80ddac48462fa45d78', runningInstance: 'fb9a6f8d-c84b-4da3-8268-a8bd643d4427'});
    expect(contract.frozenInputs).toHaveLength(13); for (const item of contract.frozenInputs) expect(digestLf(item.path)).toBe(item.normalizedLfSha256);
  });

  test('covers every frozen trigger with its exact action reason label and source class', () => {
    expect(contract.triggerCatalog).toHaveLength(18); expect(contract.triggerCatalog.map(item => item.precedence)).toEqual([...Array(18)].map((_, index) => index + 1));
    for (const rule of contract.triggerCatalog) { const input = fixture(rule.kind); const output = project(input, copy(input)); expect(output).toMatchObject({selectedKind: rule.kind, selectedAction: rule.action, reasonCode: rule.reasonCode, labelId: rule.labelId, fixedLabel: rule.fixedLabel, ownerReadableDecisionOnly: true, suppressionRecordCreated: false, rebuildRecordCreated: false, messageCreated: false, externalEffectCreated: false, moneyEffectCreated: false}); }
  });

  test('selects the highest precedence evidence independent of input order', () => {
    for (const kinds of [['partial_payment','opt_out'], ['correction','dispute','owner_pause'], ['payment_failure','manual_contact','full_payment']]) { const input = fixture(kinds[0]); setEvidence(input, kinds); seal(input); const expected = [...kinds].sort((left, right) => contract.triggerCatalog.find(item => item.kind === left).precedence - contract.triggerCatalog.find(item => item.kind === right).precedence)[0]; expect(project(input, copy(input)).selectedKind).toBe(expected); const reversed = copy(input); reversed.changeSetBinding.evidence.reverse(); seal(reversed); expect(project(reversed, copy(reversed)).selectedKind).toBe(expected); }
  });

  test('binds exact Part11A Part11B Part11C tenant invoice policy recipient and prior head', () => {
    for (const mutation of [value => { value.part11AEligibilityBinding.resultState = 'ineligible_balance'; }, value => { value.part11AEligibilityBinding.reasonCode = 'candidate_reason'; }, value => { value.part11BPolicyBinding.resultState = 'eligible'; }, value => { value.part11BPolicyBinding.reasonCode = 'candidate_reason'; }, value => { value.part11CMaterialBinding.resultState = 'available'; }, value => { value.part11CMaterialBinding.reasonCode = 'candidate_reason'; }, value => { value.part11CMaterialBinding.destinationState = 'available'; }, value => { value.part11BPolicyBinding.policyId = uuid(99); }, value => { value.part11CMaterialBinding.recipientResolutionDigest = digest(99); }, value => { value.part11AEligibilityBinding.issuedVersionDigest = digest(99); }, value => { value.part11CMaterialBinding.customerId = uuid(99); }, value => { value.changeSetBinding.priorHeadTransitionDigest = digest(99); }]) { const input = fixture(); mutation(input); seal(input); expect(() => project(input, copy(input))).toThrow(); }
    const candidate = fixture(); const trusted = fixture(); candidate.tenantId = uuid(99); seal(candidate); expect(() => project(candidate, trusted)).toThrow('trusted resolution');
    const reorderedTrusted = JSON.parse(JSON.stringify(fixture()), (key, value) => value && !Array.isArray(value) && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse()) : value); expect(() => project(fixture(), reorderedTrusted)).not.toThrow();
  });

  test('requires the exact next source head for financial changes and forbids source retarget on human controls', () => {
    for (const mutation of [value => { value.changeSetBinding.currentHeadSequence += 1; value.changeSetBinding.evidence[0].headSequence += 1; }, value => { value.changeSetBinding.currentHeadTransitionId = value.changeSetBinding.priorHeadTransitionId; value.changeSetBinding.evidence[0].headTransitionId = value.changeSetBinding.priorHeadTransitionId; }, value => { value.changeSetBinding.currentSourceSetDigest = value.changeSetBinding.priorSourceSetDigest; }]) { const input = fixture('partial_payment'); mutation(input); seal(input); expect(() => project(input, copy(input))).toThrow('financial change'); }
    const human = fixture('manual_contact'); human.changeSetBinding.currentHeadSequence += 1; seal(human); expect(() => project(human, copy(human))).toThrow('human source retarget');
  });

  test('denies wrong authority state duplicate kind unknown kind and candidate-created human authority', () => {
    for (const mutation of [value => { value.changeSetBinding.evidence[0].sourceAuthorityId = 'candidate'; }, value => { value.changeSetBinding.evidence[0].state = 'clear'; }, value => { value.changeSetBinding.evidence[0].currentnessState = 'stale'; }, value => { value.changeSetBinding.evidence[0].kind = 'charge_customer'; }]) { const input = fixture(); mutation(input); seal(input); expect(() => project(input, copy(input))).toThrow(); }
    const duplicate = fixture('manual_contact'); const second = copy(duplicate.changeSetBinding.evidence[0]); second.evidenceId = uuid(999); second.eventId = uuid(998); second.eventDigest = digest(998); duplicate.changeSetBinding.evidence.push(second); seal(duplicate); expect(() => project(duplicate, copy(duplicate))).toThrow('evidence identity');
    const human = fixture('opt_out'); human.changeSetBinding.evidence[0].recipientResolutionDigest = digest(99); seal(human); expect(() => project(human, copy(human))).toThrow('human authority');
  });

  test('enforces exact amount currency and replacement-version semantics without inferring outcomes', () => {
    for (const [kind, mutation] of [['full_payment', value => { value.changeSetBinding.evidence[0].amountDueMinorUnits = 1; }], ['partial_payment', value => { value.changeSetBinding.evidence[0].amountDueMinorUnits = 0; }], ['credit', value => { value.changeSetBinding.evidence[0].currency = 'EUR'; }], ['pending_payment', value => { value.changeSetBinding.evidence[0].amountDueMinorUnits = 1; value.changeSetBinding.evidence[0].currency = 'USD'; }], ['replacement', value => { value.changeSetBinding.evidence[0].issuedVersionDigest = value.part11CMaterialBinding.issuedVersionDigest; }], ['correction', value => { value.changeSetBinding.evidence[0].issuedVersionDigest = digest(999); }]]) { const input = fixture(kind); mutation(input); seal(input); expect(() => project(input, copy(input))).toThrow(); }
  });

  test('fails closed on stale future over-age or time-ordered evidence', () => {
    for (const mutation of [value => { value.changeSetBinding.observedAt = '2026-10-29T12:05:00.000001Z'; }, value => { value.changeSetBinding.evidence[0].observedAt = '2026-10-29T11:59:59.999999Z'; }, value => { value.changeSetBinding.evidence[0].eventTime = '2026-10-29T12:04:00.000001Z'; }, value => { value.changeSetBinding.currentnessState = 'mixed'; }]) { const input = fixture(); mutation(input); seal(input); expect(() => project(input, copy(input))).toThrow(); }
  });

  test('uses canonical stable idempotency and denies conflicting replay or clone reuse', () => {
    const history = new History(); const first = fixture(); expect(history.record(first, copy(first)).replayed).toBe(false); expect(history.record(copy(first), copy(first)).replayed).toBe(true);
    const clone = copy(first); clone.decisionId = uuid(90); clone.evaluatedAt = '2026-10-29T12:06:00.000000Z'; clone.changeSetBinding.evidence = clone.changeSetBinding.evidence.map(value => Object.fromEntries(Object.entries(value).reverse())); seal(clone); expect(clone.idempotencyKeyDigest).toBe(first.idempotencyKeyDigest); expect(() => history.record(clone, copy(clone))).toThrow('clone');
    const conflict = copy(first); conflict.evaluatedAt = '2026-10-29T12:06:00.000000Z'; seal(conflict); expect(() => history.record(conflict, copy(conflict))).toThrow('identity conflict');
    const newHead = copy(first); newHead.changeSetBinding.currentHeadTransitionId = uuid(91); newHead.changeSetBinding.currentHeadTransitionDigest = digest(91); newHead.changeSetBinding.evidence[0].headTransitionId = uuid(91); newHead.changeSetBinding.evidence[0].headTransitionDigest = digest(91); seal(newHead); expect(newHead.idempotencyKeyDigest).not.toBe(first.idempotencyKeyDigest);
    const multi = fixture('partial_payment'); setEvidence(multi, ['partial_payment','opt_out']); seal(multi); const aliasHistory = new History(); aliasHistory.record(multi, copy(multi)); const reordered = copy(multi); reordered.decisionId = uuid(97); reordered.evaluatedAt = '2026-10-29T12:06:00.000000Z'; reordered.changeSetBinding.evidence.reverse(); seal(reordered); expect(reordered.idempotencyKeyDigest).toBe(multi.idempotencyKeyDigest); expect(() => aliasHistory.record(reordered, copy(reordered))).toThrow('clone');
  });

  test('rejects extra missing accessors symbols proxies toJSON custom prototypes sparse arrays and aliases before hooks', () => {
    for (const mutation of [value => { value.extra = 'x'; }, value => { delete value.requestDigest; }, value => { value.changeSetBinding.toJSON = () => ({}); }, value => { Object.setPrototypeOf(value.part11CMaterialBinding, {}); }, value => { value.part11BPolicyBinding = value.part11AEligibilityBinding; }]) { const input = fixture(); mutation(input); expect(() => project(input, fixture())).toThrow(); }
    let getters = 0; const accessor = fixture(); Object.defineProperty(accessor.changeSetBinding.evidence[0], 'kind', {enumerable: true, get() { getters += 1; return 'partial_payment'; }}); expect(() => project(accessor, fixture())).toThrow(); expect(getters).toBe(0);
    const symbol = fixture(); symbol[Symbol('secret')] = 'sk_secret'; expect(() => project(symbol, fixture())).toThrow();
    let traps = 0; const proxy = new Proxy(fixture(), {get() { traps += 1; throw new Error('trap'); }, ownKeys() { traps += 1; throw new Error('trap'); }}); expect(() => project(proxy, fixture())).toThrow(); expect(traps).toBe(0);
    const sparse = fixture(); sparse.changeSetBinding.evidence = []; sparse.changeSetBinding.evidence[2] = copy(fixture().changeSetBinding.evidence[0]); expect(() => project(sparse, fixture())).toThrow();
  });

  test('returns fixed privacy-safe labels and creates zero records messages mutations or effects', () => {
    for (const rule of contract.triggerCatalog) expect(rule.fixedLabel).not.toMatch(/@|phone|token|sk_|customerName|invoiceNumber|amount|description|note|https?:|[0-9]{4,}/i);
    for (const value of Object.values(contract.privacyAndEffects)) expect(value).toBe(0);
    const output = project(fixture(), fixture()); for (const key of ['suppressionRecordCreated','rebuildRecordCreated','materialRecordCreated','scheduleCreated','worklistRecordCreated','taskCreated','messageCreated','providerAttemptCreated','financialMutationCreated','accountingMutationCreated','balanceMutationCreated','externalEffectCreated','upstreamMutationCreated','moneyEffectCreated']) expect(output[key]).toBe(false);
  });

  test('freezes docs-tests-only scope with migration287 latest and no288', () => {
    expect(contract.runtimeBoundary).toMatchObject({newMigration: false, newTableFunctionRouteOrUi: false, suppressionOrRebuildRecordCreated: false, nextMigrationAbsent: '288'});
    const migrations = fs.readdirSync(path.join(ROOT, 'migrations')).filter(name => /^\d+_/.test(name)).sort(); expect(migrations).toHaveLength(283); expect(migrations.at(-1)).toBe('287_canonical_automation_estimate_quote_resolution_v1.sql'); expect(migrations.some(name => name.startsWith('288_'))).toBe(false);
  });

  test('roadmap and ledger record Part11D released Part11E candidate and later slices planned', () => {
    const roadmap = fs.readFileSync(path.join(ROOT, 'docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md'), 'utf8'); const ledger = fs.readFileSync(path.join(ROOT, 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md'), 'utf8');
    for (const value of [roadmap, ledger]) { expect(value).toContain('Parts 1A–11E are released. Part 11F is the sole implementation candidate.'); for (const identity of ['2d2d082399cd1f35519fa0cb4a837efa0fec45e2','05d8457ecd1ff48b338e1da6337808707e92deb5','2135f372-13c2-419b-8b8a-12da526d1a95','sha256:957fc8466a71ee7d07c38d281cebba7c7b1e0e6b8da43d80ddac48462fa45d78','fb9a6f8d-c84b-4da3-8268-a8bd643d4427','b42145ddc95e9bc2a383f9dac6ad1f5a884a90d5a3e999a0c126b2b6e3bae369']) expect(value).toContain(identity); }
    expect((ledger.match(/\| \*\*Released\*\* \|/g) || []).length).toBe(49); expect((ledger.match(/\| \*\*Implementation candidate\*\* \|/g) || []).length).toBe(1); expect((ledger.match(/\| Planned \/ unimplemented \|/g) || []).length).toBe(16);
  });
});
