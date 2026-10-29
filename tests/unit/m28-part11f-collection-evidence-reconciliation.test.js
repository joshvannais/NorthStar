const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { types } = require('util');

const ROOT = path.resolve(__dirname, '../..');
const contract = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/architecture/MISSION_28_PART11F_COLLECTION_EVIDENCE_RECONCILIATION_CONTRACT.json'), 'utf8'));
const UUID = new RegExp(contract.identityGrammar.uuidPattern);
const DIGEST = new RegExp(contract.identityGrammar.digestPattern);
const UTC = new RegExp(contract.identityGrammar.utcInstantPattern);
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const digest = n => `sha256:${Number(n).toString(16).padStart(64, '0')}`;
const copy = value => JSON.parse(JSON.stringify(value));
const canonicalize = value => Array.isArray(value) ? value.map(canonicalize) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])])) : value;
const hash = value => `sha256:${crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(canonicalize(value))).digest('hex')}`;
const digestLf = relative => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, relative), 'utf8').replace(/\r\n/g, '\n')).digest('hex').toUpperCase();
const PART11D_DECISION_AUTHORITY = 'mission28.part11d.suppression-rebuild.v1:decision';
const PART11E_CLEAR_AUTHORITY = 'mission28.part11e.owner-worklist-legal-boundary.v1:clearResolution';

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
      if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) throw new Error('descriptor');
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
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString().slice(0, 19) !== value.slice(0, 19)) return null;
  return BigInt(milliseconds) * 1000n + BigInt(value.slice(20, 26));
}

function materialOf(input) { const value = copy(input); delete value.reconciliationId; delete value.materialDigest; delete value.idempotencyKeyDigest; delete value.requestDigest; return value; }
function idempotencyMaterialOf(input) { const value = materialOf(input); delete value.evaluatedAt; return value; }
function requestOf(input) { const value = copy(input); delete value.materialDigest; delete value.idempotencyKeyDigest; delete value.requestDigest; return value; }
function seal(input) { input.materialDigest = hash(materialOf(input)); input.idempotencyKeyDigest = hash(idempotencyMaterialOf(input)); input.requestDigest = hash(requestOf(input)); return input; }

function evidenceHead(order, tenantId, invoiceId, versionDigest, state) {
  const rule = contract.evidenceCatalog[order - 1];
  const sourceAuthorityId = rule.sourceAuthorityByResolutionState ? rule.sourceAuthorityByResolutionState[state] : rule.sourceAuthorityId;
  return {evidenceKind: rule.evidenceKind, sourceAuthorityId, tenantId, issuedInvoiceId: invoiceId, issuedVersionDigest: versionDigest, lineageId: uuid(100 + order), headEventId: uuid(110 + order), headRevision: 1, headDigest: digest(110 + order), predecessorEventId: null, predecessorEventDigest: null, sourceRecordId: uuid(120 + order), sourceRecordRevision: 1, sourceRecordDigest: digest(120 + order), evidenceState: state, eventAt: '2026-10-29T12:03:00.000000Z', observedAt: '2026-10-29T12:04:00.000000Z', currentnessState: 'latest_exact_current'};
}

function fixture() {
  const tenantId = uuid(1); const invoiceId = uuid(10); const versionDigest = digest(10); const customerId = uuid(11); const policyId = uuid(12); const sourceSetId = uuid(13); const sourceSetDigest = digest(13); const headId = uuid(14); const headDigest = digest(14);
  const input = {
    schemaVersion: contract.contractVersion,
    tenantId,
    reconciliationId: uuid(2),
    acceptedChainBinding: {tenantId, issuedInvoiceId: invoiceId, issuedVersionDigest: versionDigest, customerId, policyId, policyVersion: 1, sourceSetId, sourceSetDigest, headTransitionId: headId, headTransitionDigest: headDigest, headSequence: 5, part11AResolutionId: uuid(20), part11AMaterialDigest: digest(20), part11AResultState: 'eligible_for_owner_collection_review_only', part11AReasonCode: 'exact_current_collection_review_eligible', part11BProjectionId: uuid(21), part11BMaterialDigest: digest(21), part11BResultState: 'reminder_policy_definition_valid_no_effect_external_authority_unavailable', part11BReasonCode: 'financial_reminder_source_permission_approval_schedule_and_effect_authority_unavailable', part11CProjectionId: uuid(22), part11CMaterialDigest: digest(22), part11CResultState: 'reminder_material_unavailable_no_secure_destination_or_external_authority', part11CReasonCode: 'secure_payment_destination_permission_approval_schedule_and_effect_authority_unavailable', part11DDecisionId: uuid(23), part11DMaterialDigest: digest(23), clearResolutionId: null, clearResolutionDigest: null, part11DResolutionState: 'suppress_exact_current', part11EProjectionId: uuid(24), part11EMaterialDigest: digest(24), part11EResultState: 'owner_pause_review_no_effect', part11EReasonCode: 'exact_current_suppression_requires_owner_review', part11ELevelId: 'pause_review', recordedCurrentnessState: 'latest_exact_current_at_creation'},
    communicationEvidenceHeads: [
      evidenceHead(1, tenantId, invoiceId, versionDigest, 'not_created'),
      evidenceHead(2, tenantId, invoiceId, versionDigest, 'unavailable_no_message_or_evidence'),
      evidenceHead(3, tenantId, invoiceId, versionDigest, 'unavailable_no_authenticated_inbound'),
      evidenceHead(4, tenantId, invoiceId, versionDigest, 'unavailable'),
      evidenceHead(5, tenantId, invoiceId, versionDigest, 'suppress_exact_current'),
      evidenceHead(6, tenantId, invoiceId, versionDigest, 'pause_review')
    ],
    mission27OutcomeBinding: {tenantId, issuedInvoiceId: invoiceId, issuedVersionDigest: versionDigest, sourceContractVersion: 'm27-collection-part10-acceptance-v1', sourceBundleVersion: 'm27-collection-part10-preview-bundle-v1', sourceAcceptanceState: 'unavailable', sourceAcceptanceReason: 'part10_collection_evidence_unavailable', sourceAcceptanceDigest: digest(30), outcomeAuthorityState: 'unavailable_no_exact_current_collection_outcome', outcomeRecordId: null, outcomeRevision: null, outcomeDigest: null, outcomeState: null, sourceSetId: null, sourceSetDigest: null, headTransitionId: null, headTransitionDigest: null, headSequence: null, currentnessState: 'unavailable', observedAt: '2026-10-29T12:04:00.000000Z'},
    actorAuthorityBinding: {actorId: uuid(40), sessionId: uuid(41), membershipId: uuid(42), sessionSubjectActorId: uuid(40), membershipSubjectActorId: uuid(40), actorTenantId: tenantId, sessionTenantId: tenantId, membershipTenantId: tenantId, actorState: 'active', sessionState: 'active', membershipState: 'active', membershipRoleId: 'owner', capabilityId: 'automation_view', capabilityDecisionId: uuid(43), capabilityDecisionDigest: digest(43), recordScope: 'exact_tenant_collection_reconciliation_projection'},
    evaluatedAt: '2026-10-29T12:05:00.000000Z', materialDigest: '', idempotencyKeyDigest: '', requestDigest: ''
  };
  input.communicationEvidenceHeads[4].sourceRecordId = input.acceptedChainBinding.part11DDecisionId;
  input.communicationEvidenceHeads[4].sourceRecordDigest = input.acceptedChainBinding.part11DMaterialDigest;
  input.communicationEvidenceHeads[5].sourceRecordId = input.acceptedChainBinding.part11EProjectionId;
  input.communicationEvidenceHeads[5].sourceRecordDigest = input.acceptedChainBinding.part11EMaterialDigest;
  return seal(input);
}

function applyAcceptedPair(input, pair) {
  const chain = input.acceptedChainBinding;
  Object.assign(chain, pair);
  if (pair.part11DResolutionState === 'clear_exact_current_no_trigger') {
    chain.part11DDecisionId = null;
    chain.part11DMaterialDigest = null;
    chain.clearResolutionId = uuid(25);
    chain.clearResolutionDigest = digest(25);
    input.communicationEvidenceHeads[4].sourceRecordId = chain.clearResolutionId;
    input.communicationEvidenceHeads[4].sourceRecordDigest = chain.clearResolutionDigest;
    input.communicationEvidenceHeads[4].sourceAuthorityId = PART11E_CLEAR_AUTHORITY;
  } else {
    chain.part11DDecisionId = uuid(23);
    chain.part11DMaterialDigest = digest(23);
    chain.clearResolutionId = null;
    chain.clearResolutionDigest = null;
    input.communicationEvidenceHeads[4].sourceRecordId = chain.part11DDecisionId;
    input.communicationEvidenceHeads[4].sourceRecordDigest = chain.part11DMaterialDigest;
    input.communicationEvidenceHeads[4].sourceAuthorityId = PART11D_DECISION_AUTHORITY;
  }
  input.communicationEvidenceHeads[4].evidenceState = pair.part11DResolutionState;
  input.communicationEvidenceHeads[5].evidenceState = pair.part11ELevelId;
  return input;
}

function validateHead(head, index, input, evaluated) {
  const envelope = contract.reconciliationEnvelope; const rule = contract.evidenceCatalog[index];
  exactKeys(head, envelope.communicationEvidenceHeadExactFields);
  const requiredAuthority = rule.sourceAuthorityByResolutionState ? rule.sourceAuthorityByResolutionState[head.evidenceState] : rule.sourceAuthorityId;
  if (head.evidenceKind !== rule.evidenceKind || typeof requiredAuthority !== 'string' || head.sourceAuthorityId !== requiredAuthority || head.tenantId !== input.tenantId || head.issuedInvoiceId !== input.acceptedChainBinding.issuedInvoiceId || head.issuedVersionDigest !== input.acceptedChainBinding.issuedVersionDigest || !rule.closedStates.includes(head.evidenceState)) throw new Error('evidence binding');
  for (const value of [head.lineageId, head.headEventId, head.sourceRecordId]) if (!UUID.test(value)) throw new Error('evidence identity');
  for (const value of [head.headDigest, head.sourceRecordDigest]) if (!DIGEST.test(value)) throw new Error('evidence digest');
  if (!Number.isSafeInteger(head.headRevision) || !Number.isSafeInteger(head.sourceRecordRevision) || head.headRevision < 1 || head.sourceRecordRevision < 1 || head.headRevision > contract.bounds.maximumSafeLineageRevision || head.sourceRecordRevision > contract.bounds.maximumSafeLineageRevision) throw new Error('evidence revision');
  if (head.headRevision === 1) { if (head.predecessorEventId !== null || head.predecessorEventDigest !== null) throw new Error('first predecessor'); }
  else if (!UUID.test(head.predecessorEventId) || !DIGEST.test(head.predecessorEventDigest)) throw new Error('later predecessor');
  const eventAt = micros(head.eventAt); const observedAt = micros(head.observedAt);
  if (eventAt === null || observedAt === null || eventAt > observedAt || observedAt > evaluated || evaluated - observedAt > BigInt(contract.bounds.maximumSourceObservationAgeSeconds) * 1000000n || head.currentnessState !== 'latest_exact_current') throw new Error('evidence currentness');
}

function validate(input, trusted) {
  dataOnly(input); dataOnly(trusted);
  if (hash(input) !== hash(trusted)) throw new Error('trusted resolution');
  const envelope = contract.reconciliationEnvelope;
  exactKeys(input, envelope.exactFields); exactKeys(input.acceptedChainBinding, envelope.acceptedChainBindingExactFields); exactKeys(input.mission27OutcomeBinding, envelope.mission27OutcomeBindingExactFields); exactKeys(input.actorAuthorityBinding, envelope.actorAuthorityBindingExactFields);
  if (input.schemaVersion !== contract.contractVersion || !UUID.test(input.tenantId) || !UUID.test(input.reconciliationId) || !Array.isArray(input.communicationEvidenceHeads) || input.communicationEvidenceHeads.length !== contract.bounds.evidenceHeadCount) throw new Error('envelope');
  const chain = input.acceptedChainBinding; const actor = input.actorAuthorityBinding; const outcome = input.mission27OutcomeBinding;
  for (const value of [chain.tenantId, outcome.tenantId, actor.actorTenantId, actor.sessionTenantId, actor.membershipTenantId]) if (value !== input.tenantId) throw new Error('tenant');
  for (const value of [chain.issuedInvoiceId, chain.customerId, chain.policyId, chain.sourceSetId, chain.headTransitionId, chain.part11AResolutionId, chain.part11BProjectionId, chain.part11CProjectionId, chain.part11EProjectionId, actor.actorId, actor.sessionId, actor.membershipId, actor.capabilityDecisionId]) if (!UUID.test(value)) throw new Error('chain identity');
  for (const value of [chain.issuedVersionDigest, chain.sourceSetDigest, chain.headTransitionDigest, chain.part11AMaterialDigest, chain.part11BMaterialDigest, chain.part11CMaterialDigest, chain.part11EMaterialDigest, actor.capabilityDecisionDigest, outcome.sourceAcceptanceDigest, input.materialDigest, input.idempotencyKeyDigest, input.requestDigest]) if (!DIGEST.test(value)) throw new Error('chain digest');
  if (!Number.isSafeInteger(chain.policyVersion) || chain.policyVersion < 1 || !Number.isSafeInteger(chain.headSequence) || chain.headSequence < 1 || chain.recordedCurrentnessState !== 'latest_exact_current_at_creation') throw new Error('chain revision');
  const acceptedPair = contract.acceptedChainCoherence.find(item => item.part11DResolutionState === chain.part11DResolutionState && item.part11ELevelId === chain.part11ELevelId && item.part11EResultState === chain.part11EResultState && item.part11EReasonCode === chain.part11EReasonCode);
  if (chain.part11AResultState !== 'eligible_for_owner_collection_review_only' || chain.part11AReasonCode !== 'exact_current_collection_review_eligible' || chain.part11BResultState !== 'reminder_policy_definition_valid_no_effect_external_authority_unavailable' || chain.part11BReasonCode !== 'financial_reminder_source_permission_approval_schedule_and_effect_authority_unavailable' || chain.part11CResultState !== 'reminder_material_unavailable_no_secure_destination_or_external_authority' || chain.part11CReasonCode !== 'secure_payment_destination_permission_approval_schedule_and_effect_authority_unavailable' || !acceptedPair) throw new Error('accepted chain state');
  const isClear = chain.part11DResolutionState === 'clear_exact_current_no_trigger';
  if (isClear) {
    if (chain.part11DDecisionId !== null || chain.part11DMaterialDigest !== null || !UUID.test(chain.clearResolutionId) || !DIGEST.test(chain.clearResolutionDigest)) throw new Error('clear resolution identity');
  } else if (!UUID.test(chain.part11DDecisionId) || !DIGEST.test(chain.part11DMaterialDigest) || chain.clearResolutionId !== null || chain.clearResolutionDigest !== null) throw new Error('Part11D resolution identity');
  const evaluated = micros(input.evaluatedAt); if (evaluated === null) throw new Error('evaluation time');
  input.communicationEvidenceHeads.forEach((head, index) => validateHead(head, index, input, evaluated));
  const suppression = input.communicationEvidenceHeads[4]; const intervention = input.communicationEvidenceHeads[5];
  const activeResolutionId = isClear ? chain.clearResolutionId : chain.part11DDecisionId; const activeResolutionDigest = isClear ? chain.clearResolutionDigest : chain.part11DMaterialDigest;
  if (suppression.sourceRecordId !== activeResolutionId || suppression.sourceRecordDigest !== activeResolutionDigest || suppression.evidenceState !== chain.part11DResolutionState || intervention.sourceRecordId !== chain.part11EProjectionId || intervention.sourceRecordDigest !== chain.part11EMaterialDigest || intervention.evidenceState !== chain.part11ELevelId) throw new Error('accepted chain evidence');
  if (outcome.issuedInvoiceId !== chain.issuedInvoiceId || outcome.issuedVersionDigest !== chain.issuedVersionDigest || outcome.sourceContractVersion !== contract.mission27OutcomeContract.requiredSourceContractVersion || outcome.sourceBundleVersion !== contract.mission27OutcomeContract.requiredSourceBundleVersion || outcome.sourceAcceptanceState !== contract.mission27OutcomeContract.currentSourceAcceptanceState || outcome.sourceAcceptanceReason !== contract.mission27OutcomeContract.currentSourceAcceptanceReason || outcome.outcomeAuthorityState !== contract.mission27OutcomeContract.currentOutcomeAuthorityState || outcome.currentnessState !== 'unavailable') throw new Error('Mission27 outcome');
  for (const key of ['outcomeRecordId','outcomeRevision','outcomeDigest','outcomeState','sourceSetId','sourceSetDigest','headTransitionId','headTransitionDigest','headSequence']) if (outcome[key] !== null) throw new Error('fabricated outcome');
  const outcomeObserved = micros(outcome.observedAt); if (outcomeObserved === null || outcomeObserved > evaluated || evaluated - outcomeObserved > BigInt(contract.bounds.maximumSourceObservationAgeSeconds) * 1000000n) throw new Error('outcome currentness');
  if (actor.actorId !== actor.sessionSubjectActorId || actor.actorId !== actor.membershipSubjectActorId || actor.actorState !== 'active' || actor.sessionState !== 'active' || actor.membershipState !== 'active' || actor.membershipRoleId !== 'owner' || actor.capabilityId !== 'automation_view' || actor.recordScope !== 'exact_tenant_collection_reconciliation_projection') throw new Error('actor');
  if (Buffer.byteLength(JSON.stringify(input)) > contract.bounds.maximumCanonicalRequestBytes || input.materialDigest !== hash(materialOf(input)) || input.idempotencyKeyDigest !== hash(idempotencyMaterialOf(input)) || input.requestDigest !== hash(requestOf(input))) throw new Error('digest');
}

function project(input, trusted) {
  validate(input, trusted);
  const chain = input.acceptedChainBinding; const outcome = input.mission27OutcomeBinding;
  return Object.freeze({reconciliationId: input.reconciliationId, tenantId: input.tenantId, issuedInvoiceId: chain.issuedInvoiceId, issuedVersionDigest: chain.issuedVersionDigest, sourceSetId: chain.sourceSetId, sourceSetDigest: chain.sourceSetDigest, headTransitionId: chain.headTransitionId, headTransitionDigest: chain.headTransitionDigest, headSequence: chain.headSequence, evidenceSummaryDigest: hash(input.communicationEvidenceHeads), mission27OutcomeAuthorityState: outcome.outcomeAuthorityState, evaluatedAt: input.evaluatedAt, resultState: contract.fixedDecision.resultState, reasonCode: contract.fixedDecision.reasonCode, labelId: contract.fixedDecision.labelId, fixedLabel: contract.fixedDecision.fixedLabel, ownerReadableReconciliationOnly: true, communicationAttemptCreated: false, messageCreated: false, providerAttemptCreated: false, promiseCreated: false, suppressionCreated: false, ownerTaskCreated: false, paymentCreated: false, cashRecorded: false, revenueRecorded: false, settlementCreated: false, accountingMutationCreated: false, balanceMutationCreated: false, collectionOutcomeCreated: false, collectionSuccessClaimed: false, externalEffectCreated: false, upstreamMutationCreated: false, moneyEffectCreated: false});
}

class HeadHistory {
  constructor() { this.heads = new Map(); }
  append(head) {
    dataOnly(head); const key = `${head.tenantId}:${head.evidenceKind}:${head.lineageId}`; const prior = this.heads.get(key);
    if (!prior) { if (head.headRevision !== 1 || head.predecessorEventId !== null || head.predecessorEventDigest !== null) throw new Error('first'); }
    else if (head.headRevision !== prior.headRevision + 1 || head.predecessorEventId !== prior.headEventId || head.predecessorEventDigest !== prior.headDigest || head.issuedInvoiceId !== prior.issuedInvoiceId || head.issuedVersionDigest !== prior.issuedVersionDigest || head.sourceRecordDigest === prior.sourceRecordDigest || head.headEventId === prior.headEventId || head.headDigest === prior.headDigest) throw new Error('lineage');
    this.heads.set(key, copy(head)); return copy(head);
  }
}

class ReconciliationHistory {
  constructor() { this.byId = new Map(); this.byStable = new Map(); }
  record(input, trusted) {
    const output = project(input, trusted); const prior = this.byId.get(input.reconciliationId);
    if (prior) { if (prior.requestDigest !== input.requestDigest || prior.materialDigest !== input.materialDigest || prior.idempotencyKeyDigest !== input.idempotencyKeyDigest) throw new Error('identity conflict'); return Object.freeze({...prior, replayed: true}); }
    if (this.byStable.has(input.idempotencyKeyDigest)) throw new Error('clone');
    const stored = Object.freeze({...output, requestDigest: input.requestDigest, materialDigest: input.materialDigest, idempotencyKeyDigest: input.idempotencyKeyDigest, replayed: false}); this.byId.set(input.reconciliationId, stored); this.byStable.set(input.idempotencyKeyDigest, input.reconciliationId); return stored;
  }
}

describe('Mission 28 Part 11F collection evidence reconciliation', () => {
  test('binds exact Part11E release provenance and all frozen source contracts', () => {
    expect(contract.authority).toMatchObject({part: '11F', state: 'implementation_candidate_only', baselineCommit: 'f4c904f59bfc02999bd4fe23f4c3c158aee74c9e', baselineTree: '8895d7d25c28334d2cf234ed465c5ddf8059cba1'});
    expect(contract.part11ERelease).toMatchObject({acceptedSourceHead: 'ce5ea804c8d33b2ec1ba9eb9bf9c01cd99ccdda8', acceptedTree: '8895d7d25c28334d2cf234ed465c5ddf8059cba1', pullRequest: 597, mergedMain: 'f4c904f59bfc02999bd4fe23f4c3c158aee74c9e', deploymentIdentity: 'f92d6748-1ee9-436d-972e-daa980c2836f_SUCCESS', imageIdentity: 'sha256:32d3283e1c6efa109a5981ffb9cb3a4c5b5165094b22ecc19c60312fce97096c', runningInstance: '7ee4f747-38c2-4baa-a024-1d7db6e7c218'});
    expect(contract.frozenInputs).toHaveLength(13); for (const item of contract.frozenInputs) expect(digestLf(item.path)).toBe(item.normalizedLfSha256);
  });

  test('freezes exactly six ordered evidence classes with separate strongest meanings', () => {
    expect(contract.evidenceCatalog.map(item => item.evidenceKind)).toEqual(['attempt','delivery','reply','promise','suppression','owner_intervention']);
    expect(contract.evidenceCatalog.slice(0, 4).map(item => item.sourceAuthorityId)).toEqual(['mission28.part7f.delivery-evidence.v1:providerAttemptState','mission28.part7f.delivery-evidence.v1:deliveryState','mission28.part7f.delivery-evidence.v1:authenticatedResponseStates','m27-collection-review-v1:promiseToPayState']);
    expect(contract.evidenceCatalog[4].sourceAuthorityByResolutionState).toEqual({suppress_exact_current: PART11D_DECISION_AUTHORITY, rebuild_exact_current: PART11D_DECISION_AUTHORITY, clear_exact_current_no_trigger: PART11E_CLEAR_AUTHORITY});
    expect(contract.evidenceCatalog[5].sourceAuthorityId).toBe('mission28.part11e.owner-worklist-legal-boundary.v1:selectedLevelId');
    for (const item of contract.evidenceCatalog) { expect(item.fixedLabel).not.toMatch(/@|phone|token|sk_|customer name|invoice number|amount|https?:|legal|threat/i); expect(item.strongestMeaning).not.toMatch(/^payment$|^collection_success$/); }
  });

  test('projects only the fixed unavailable owner-readable no-effect result', () => {
    expect(project(fixture(), fixture())).toMatchObject({resultState: 'collection_reconciliation_unavailable_no_exact_current_outcome_authority', mission27OutcomeAuthorityState: 'unavailable_no_exact_current_collection_outcome', ownerReadableReconciliationOnly: true, messageCreated: false, paymentCreated: false, cashRecorded: false, revenueRecorded: false, accountingMutationCreated: false, balanceMutationCreated: false, collectionOutcomeCreated: false, collectionSuccessClaimed: false, externalEffectCreated: false, moneyEffectCreated: false});
  });

  test('binds the exact accepted Part11A through Part11E receipts and current head', () => {
    for (const mutation of [value => { value.acceptedChainBinding.part11AResultState = 'ineligible'; }, value => { value.acceptedChainBinding.part11BMaterialDigest = digest(99); }, value => { value.acceptedChainBinding.part11CReasonCode = 'available'; }, value => { value.acceptedChainBinding.part11DResolutionState = 'rebuild_exact_current'; }, value => { value.acceptedChainBinding.part11ELevelId = 'manual_contact_review'; }, value => { value.acceptedChainBinding.headTransitionDigest = digest(99); }]) { const input = fixture(); mutation(input); seal(input); expect(() => project(input, fixture())).toThrow(); }
    for (const pair of contract.acceptedChainCoherence) {
      const input = applyAcceptedPair(fixture(), pair); seal(input);
      const chain = input.acceptedChainBinding; const suppression = input.communicationEvidenceHeads[4];
      if (pair.part11DResolutionState === 'clear_exact_current_no_trigger') expect(chain).toMatchObject({part11DDecisionId: null, part11DMaterialDigest: null, clearResolutionId: uuid(25), clearResolutionDigest: digest(25)});
      else expect(chain).toMatchObject({part11DDecisionId: uuid(23), part11DMaterialDigest: digest(23), clearResolutionId: null, clearResolutionDigest: null});
      expect([suppression.sourceAuthorityId, suppression.sourceRecordId, suppression.sourceRecordDigest]).toEqual(pair.part11DResolutionState === 'clear_exact_current_no_trigger' ? [PART11E_CLEAR_AUTHORITY, chain.clearResolutionId, chain.clearResolutionDigest] : [PART11D_DECISION_AUTHORITY, chain.part11DDecisionId, chain.part11DMaterialDigest]);
      expect(project(input, copy(input)).resultState).toBe(contract.fixedDecision.resultState);
    }
  });

  test('requires mutually exclusive Part11D decision or separately trusted clear resolution identity', () => {
    expect(contract.acceptedChainResolutionIdentityContract.candidateMayNotFabricateRetargetCombineOrSubstituteEitherResolutionIdentity).toBe(true);
    const clearPair = contract.acceptedChainCoherence[2];
    const suppressMutations = [value => { value.acceptedChainBinding.part11DDecisionId = null; }, value => { value.acceptedChainBinding.part11DMaterialDigest = null; }, value => { value.acceptedChainBinding.clearResolutionId = uuid(99); value.acceptedChainBinding.clearResolutionDigest = digest(99); }, value => { value.communicationEvidenceHeads[4].sourceRecordId = uuid(99); }, value => { value.communicationEvidenceHeads[4].sourceAuthorityId = PART11E_CLEAR_AUTHORITY; }, value => { value.communicationEvidenceHeads[4].sourceAuthorityId = 'candidate.resolution'; }];
    for (const mutation of suppressMutations) { const input = fixture(); mutation(input); seal(input); expect(() => project(input, copy(input))).toThrow(); }
    const clearMutations = [value => { value.acceptedChainBinding.clearResolutionId = null; }, value => { value.acceptedChainBinding.clearResolutionDigest = null; }, value => { value.acceptedChainBinding.part11DDecisionId = uuid(99); value.acceptedChainBinding.part11DMaterialDigest = digest(99); }, value => { value.communicationEvidenceHeads[4].sourceRecordDigest = digest(99); }, value => { value.communicationEvidenceHeads[4].sourceRecordId = uuid(23); value.communicationEvidenceHeads[4].sourceRecordDigest = digest(23); }, value => { value.communicationEvidenceHeads[4].sourceAuthorityId = PART11D_DECISION_AUTHORITY; }, value => { value.communicationEvidenceHeads[4].sourceAuthorityId = 'candidate.resolution'; }];
    for (const mutation of clearMutations) { const input = applyAcceptedPair(fixture(), clearPair); mutation(input); seal(input); expect(() => project(input, copy(input))).toThrow(); }
  });

  test('binds every evidence head to exact tenant invoice version kind authority and source record', () => {
    for (const mutation of [value => { value.communicationEvidenceHeads[0].tenantId = uuid(99); }, value => { value.communicationEvidenceHeads[1].issuedVersionDigest = digest(99); }, value => { value.communicationEvidenceHeads[2].evidenceKind = 'delivery'; }, value => { value.communicationEvidenceHeads[3].sourceAuthorityId = 'candidate.promise'; }, value => { value.communicationEvidenceHeads[4].sourceRecordDigest = digest(99); }, value => { value.communicationEvidenceHeads[5].sourceRecordId = uuid(99); }, value => { value.communicationEvidenceHeads.reverse(); }]) { const input = fixture(); mutation(input); seal(input); expect(() => project(input, copy(input))).toThrow(); }
  });

  test('requires strict event observation evaluation order and current heads', () => {
    for (const mutation of [value => { value.communicationEvidenceHeads[0].eventAt = '2026-10-29T12:04:00.000001Z'; }, value => { value.communicationEvidenceHeads[1].observedAt = '2026-10-29T12:05:00.000001Z'; }, value => { value.communicationEvidenceHeads[2].observedAt = '2026-10-29T11:59:59.999999Z'; }, value => { value.communicationEvidenceHeads[3].currentnessState = 'stale'; }, value => { value.communicationEvidenceHeads[4].eventAt = '2026-02-30T12:03:00.000000Z'; }, value => { value.evaluatedAt = 'invalid'; }]) { const input = fixture(); mutation(input); seal(input); expect(() => project(input, copy(input))).toThrow(); }
  });

  test('enforces immutable exact-next correction lineage independently of time', () => {
    const history = new HeadHistory(); const first = fixture().communicationEvidenceHeads[1]; history.append(first);
    const next = copy(first); next.headEventId = uuid(200); next.headRevision = 2; next.headDigest = digest(200); next.predecessorEventId = first.headEventId; next.predecessorEventDigest = first.headDigest; next.sourceRecordId = uuid(201); next.sourceRecordRevision = 2; next.sourceRecordDigest = digest(201); next.eventAt = '2026-10-29T11:00:00.000000Z'; expect(history.append(next).headRevision).toBe(2);
    for (const mutation of [value => { value.headRevision = 4; }, value => { value.predecessorEventId = uuid(99); }, value => { value.sourceRecordDigest = next.sourceRecordDigest; }, value => { value.issuedVersionDigest = digest(99); }]) { const bad = copy(next); bad.headEventId = uuid(202); bad.headDigest = digest(202); bad.sourceRecordDigest = digest(202); bad.headRevision = 3; bad.predecessorEventId = next.headEventId; bad.predecessorEventDigest = next.headDigest; mutation(bad); expect(() => history.append(bad)).toThrow(); }
  });

  test('rejects first-head predecessor aliases and later heads without exact predecessors', () => {
    for (const mutation of [value => { value.communicationEvidenceHeads[0].predecessorEventId = uuid(99); }, value => { value.communicationEvidenceHeads[1].headRevision = 2; }, value => { value.communicationEvidenceHeads[2].headRevision = 0; }, value => { value.communicationEvidenceHeads[3].headRevision = 1.5; }]) { const input = fixture(); mutation(input); seal(input); expect(() => project(input, copy(input))).toThrow(); }
  });

  test('accepts no fabricated Mission27 collection outcome identity or stronger state', () => {
    const outcome = contract.mission27OutcomeContract; expect(outcome).toMatchObject({currentSourceAcceptanceState: 'unavailable', currentSourceAcceptanceReason: 'part10_collection_evidence_unavailable', currentOutcomeAuthorityState: 'unavailable_no_exact_current_collection_outcome', paymentSettlementAccountingOrBalanceEvidenceAloneNeverCreatesCollectionOutcome: true});
    for (const mutation of [value => { value.mission27OutcomeBinding.sourceAcceptanceState = 'available'; }, value => { value.mission27OutcomeBinding.outcomeRecordId = uuid(99); }, value => { value.mission27OutcomeBinding.outcomeState = 'collected'; }, value => { value.mission27OutcomeBinding.sourceSetDigest = digest(99); }, value => { value.mission27OutcomeBinding.currentnessState = 'latest_exact_current'; }]) { const input = fixture(); mutation(input); seal(input); expect(() => project(input, copy(input))).toThrow(); }
  });

  test('communication promise suppression and intervention evidence never becomes financial truth', () => {
    for (const key of Object.keys(contract.privacyAndEffects)) expect(contract.privacyAndEffects[key]).toBe(0);
    for (const state of ['provider_accepted','sent','delivered']) { const input = fixture(); input.communicationEvidenceHeads[1].evidenceState = state; seal(input); const output = project(input, copy(input)); expect(output).toMatchObject({paymentCreated: false, cashRecorded: false, revenueRecorded: false, settlementCreated: false, accountingMutationCreated: false, collectionOutcomeCreated: false, collectionSuccessClaimed: false}); }
    for (const [index, state] of [[2,'reply_received'],[3,'kept'],[4,'rebuild_exact_current'],[5,'final_supported_notice_review']]) { const input = fixture(); input.communicationEvidenceHeads[index].evidenceState = state; if (index === 4) applyAcceptedPair(input, contract.acceptedChainCoherence[1]); if (index === 5) applyAcceptedPair(input, contract.acceptedChainCoherence[4]); seal(input); expect(project(input, copy(input)).collectionSuccessClaimed).toBe(false); }
  });

  test('requires exact active owner session membership and narrowed record scope', () => {
    for (const mutation of [value => { value.actorAuthorityBinding.membershipRoleId = 'admin'; }, value => { value.actorAuthorityBinding.sessionSubjectActorId = uuid(99); }, value => { value.actorAuthorityBinding.membershipSubjectActorId = uuid(99); }, value => { value.actorAuthorityBinding.actorState = 'disabled'; }, value => { value.actorAuthorityBinding.capabilityId = 'automation_run_approve'; }, value => { value.actorAuthorityBinding.recordScope = 'tenant_wide'; }]) { const input = fixture(); mutation(input); seal(input); expect(() => project(input, copy(input))).toThrow('actor'); }
  });

  test('uses stable semantic idempotency and denies replay clone and conflict', () => {
    const history = new ReconciliationHistory(); const first = fixture(); expect(history.record(first, copy(first)).replayed).toBe(false); expect(history.record(copy(first), copy(first)).replayed).toBe(true);
    const clone = copy(first); clone.reconciliationId = uuid(90); clone.evaluatedAt = '2026-10-29T12:05:30.000000Z'; seal(clone); expect(clone.idempotencyKeyDigest).toBe(first.idempotencyKeyDigest); expect(() => history.record(clone, copy(clone))).toThrow('clone');
    const conflict = copy(first); conflict.evaluatedAt = '2026-10-29T12:05:30.000000Z'; seal(conflict); expect(() => history.record(conflict, copy(conflict))).toThrow('identity conflict');
  });

  test('rejects malformed descriptor proxy alias free-text and extra-field inputs before projection', () => {
    for (const mutation of [value => { value.extra = 'x'; }, value => { delete value.requestDigest; }, value => { value.communicationEvidenceHeads[0].message = 'customer@example.test'; }, value => { value.communicationEvidenceHeads[1].toJSON = () => ({}); }, value => { Object.setPrototypeOf(value.mission27OutcomeBinding, {}); }, value => { value.communicationEvidenceHeads[1] = value.communicationEvidenceHeads[0]; }]) { const input = fixture(); mutation(input); expect(() => project(input, fixture())).toThrow(); }
    let getters = 0; const accessor = fixture(); Object.defineProperty(accessor.communicationEvidenceHeads[0], 'evidenceState', {enumerable: true, get() { getters += 1; return 'not_created'; }}); expect(() => project(accessor, fixture())).toThrow(); expect(getters).toBe(0);
    const symbol = fixture(); symbol[Symbol('secret')] = 'sk_secret'; expect(() => project(symbol, fixture())).toThrow();
    let traps = 0; const proxy = new Proxy(fixture(), {get() { traps += 1; throw new Error('trap'); }, ownKeys() { traps += 1; throw new Error('trap'); }}); expect(() => project(proxy, fixture())).toThrow(); expect(traps).toBe(0);
    const sparse = fixture(); sparse.communicationEvidenceHeads[8] = sparse.communicationEvidenceHeads[0]; expect(() => project(sparse, fixture())).toThrow();
  });

  test('freezes docs-tests-only scope with migration287 latest and no288', () => {
    expect(contract.runtimeBoundary).toMatchObject({newMigration: false, newTableFunctionRouteOrUi: false, communicationEvidenceOrReconciliationRecordCreated: false, nextMigrationAbsent: '288'});
    const migrations = fs.readdirSync(path.join(ROOT, 'migrations')).filter(name => /^\d+_/.test(name)).sort(); expect(migrations).toHaveLength(283); expect(migrations.at(-1)).toBe('287_canonical_automation_estimate_quote_resolution_v1.sql'); expect(migrations.some(name => name.startsWith('288_'))).toBe(false);
  });

  test('roadmap and ledger record Part11E released Part11F candidate and later slices planned', () => {
    const roadmap = fs.readFileSync(path.join(ROOT, 'docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md'), 'utf8'); const ledger = fs.readFileSync(path.join(ROOT, 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md'), 'utf8');
    for (const value of [roadmap, ledger]) { expect(value).toContain('Parts 1A–12B are released. Part 12C is the sole implementation candidate.'); expect(value).toContain('Parts 12D–14G remain planned and unimplemented.'); for (const identity of ['ce5ea804c8d33b2ec1ba9eb9bf9c01cd99ccdda8','f4c904f59bfc02999bd4fe23f4c3c158aee74c9e','f92d6748-1ee9-436d-972e-daa980c2836f','sha256:32d3283e1c6efa109a5981ffb9cb3a4c5b5165094b22ecc19c60312fce97096c','7ee4f747-38c2-4baa-a024-1d7db6e7c218','b42145ddc95e9bc2a383f9dac6ad1f5a884a90d5a3e999a0c126b2b6e3bae369']) expect(value).toContain(identity); }
    expect((ledger.match(/\| \*\*Released\*\* \|/g) || []).length).toBe(52); expect((ledger.match(/\| \*\*Implementation candidate\*\* \|/g) || []).length).toBe(1); expect((ledger.match(/\| Planned \/ unimplemented \|/g) || []).length).toBe(13);
  });
});
