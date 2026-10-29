const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { types } = require('util');

const ROOT = path.resolve(__dirname, '../..');
const contract = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/architecture/MISSION_28_PART11E_OWNER_WORKLIST_LEGAL_BOUNDARY_CONTRACT.json'), 'utf8'));
const part11D = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/architecture/MISSION_28_PART11D_SUPPRESSION_REBUILD_CONTRACT.json'), 'utf8'));
const UUID = new RegExp(contract.identityGrammar.uuidPattern);
const DIGEST = new RegExp(contract.identityGrammar.digestPattern);
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
  return Number.isFinite(milliseconds) ? BigInt(milliseconds) * 1000n + BigInt(value.slice(20, 26)) : null;
}

function materialOf(input) { const value = copy(input); delete value.projectionId; delete value.materialDigest; delete value.idempotencyKeyDigest; delete value.requestDigest; return value; }
function idempotencyMaterialOf(input) { const value = materialOf(input); delete value.evaluatedAt; return value; }
function requestOf(input) { const value = copy(input); delete value.materialDigest; delete value.idempotencyKeyDigest; delete value.requestDigest; return value; }
function seal(input) { input.materialDigest = hash(materialOf(input)); input.idempotencyKeyDigest = hash(idempotencyMaterialOf(input)); input.requestDigest = hash(requestOf(input)); return input; }

function fixture(levelId = 'manual_contact_review') {
  const tenantId = uuid(1); const invoiceId = uuid(10); const customerId = uuid(11); const versionDigest = digest(12); const sourceSetId = uuid(13); const sourceSetDigest = digest(13); const headId = uuid(14); const headDigest = digest(14); const policyId = uuid(15); const recipientDigest = digest(16);
  const input = {
    schemaVersion: contract.contractVersion,
    tenantId,
    projectionId: uuid(2),
    part11AEligibilityBinding: {tenantId, resolutionId: uuid(20), materialDigest: digest(20), resultState: 'eligible_for_owner_collection_review_only', reasonCode: 'exact_current_collection_review_eligible', issuedInvoiceId: invoiceId, issuedVersionDigest: versionDigest, customerId, sourceSetId, sourceSetDigest, axisMaterialDigest: digest(21), headTransitionId: headId, headTransitionDigest: headDigest, headSequence: 5, recordedCurrentnessState: 'latest_exact_current_at_creation'},
    part11BPolicyBinding: {tenantId, projectionId: uuid(21), materialDigest: digest(22), resultState: 'reminder_policy_definition_valid_no_effect_external_authority_unavailable', reasonCode: 'financial_reminder_source_permission_approval_schedule_and_effect_authority_unavailable', policyId, policyVersion: 1, policyCanonicalDigest: digest(23), phaseId: 'overdue', issuedInvoiceId: invoiceId, issuedVersionDigest: versionDigest, recipientResolutionDigest: recipientDigest, channelId: 'email', permissionResultState: 'unavailable', approvalState: 'required_unavailable', sourceSetId, sourceSetDigest, headTransitionId: headId, headTransitionDigest: headDigest, headSequence: 5, recordedCurrentnessState: 'latest_exact_current_at_creation'},
    part11CMaterialBinding: {tenantId, projectionId: uuid(22), materialDigest: digest(24), resultState: 'reminder_material_unavailable_no_secure_destination_or_external_authority', reasonCode: 'secure_payment_destination_permission_approval_schedule_and_effect_authority_unavailable', issuedInvoiceId: invoiceId, issuedVersionDigest: versionDigest, customerId, currency: 'USD', amountDueMinorUnits: 125000, policyId, policyVersion: 1, phaseId: 'overdue', destinationState: 'unavailable_no_accepted_secure_invoice_payment_destination', explanationId: 'current_invoice_balance_no_effect_v1', recipientResolutionDigest: recipientDigest, sourceSetId, sourceSetDigest, headTransitionId: headId, headTransitionDigest: headDigest, headSequence: 5, recordedCurrentnessState: 'latest_exact_current_at_creation'},
    part11DChangeResolutionBinding: {tenantId, resolutionState: 'clear_exact_current_no_trigger', decisionId: null, materialDigest: null, idempotencyKeyDigest: null, requestDigest: null, selectedKind: null, selectedAction: null, reasonCode: null, labelId: null, priorSourceSetId: sourceSetId, priorSourceSetDigest: sourceSetDigest, priorHeadTransitionId: headId, priorHeadTransitionDigest: headDigest, priorHeadSequence: 5, currentSourceSetId: sourceSetId, currentSourceSetDigest: sourceSetDigest, currentHeadTransitionId: headId, currentHeadTransitionDigest: headDigest, currentHeadSequence: 5, clearResolutionId: uuid(30), clearResolutionDigest: digest(30), currentnessState: 'latest_exact_current', observedAt: '2026-10-29T12:04:00.000000Z'},
    dueAgingBinding: {tenantId, issuedInvoiceId: invoiceId, issuedVersionDigest: versionDigest, projectionId: uuid(31), projectionRevision: 1, projectionDigest: digest(31), issuedDueDate: '2026-09-14', asOfBusinessDate: '2026-10-29', agingBucket: 'overdue_31_60', daysPastDue: 45, sourceSetId, sourceSetDigest, headTransitionId: headId, headTransitionDigest: headDigest, headSequence: 5, currentnessState: 'latest_exact_current', observedAt: '2026-10-29T12:04:00.000000Z'},
    actorAuthorityBinding: {actorId: uuid(40), sessionId: uuid(41), membershipId: uuid(42), sessionSubjectActorId: uuid(40), membershipSubjectActorId: uuid(40), actorTenantId: tenantId, sessionTenantId: tenantId, membershipTenantId: tenantId, actorState: 'active', sessionState: 'active', membershipState: 'active', membershipRoleId: 'owner', capabilityId: 'automation_view', capabilityDecisionId: uuid(43), capabilityDecisionDigest: digest(43), recordScope: 'exact_tenant_owner_worklist_projection'},
    evaluatedAt: '2026-10-29T12:05:00.000000Z', materialDigest: '', idempotencyKeyDigest: '', requestDigest: ''
  };
  if (levelId === 'approval_request_review') setAging(input, 'overdue_1_30', 10);
  else if (levelId === 'final_supported_notice_review') setAging(input, 'overdue_61_90', 75);
  else if (levelId === 'pause_review') setPart11D(input, 'suppress_exact_current', 'owner_pause');
  else if (levelId === 'rebuild_review') setPart11D(input, 'rebuild_exact_current', 'partial_payment');
  return seal(input);
}

function setAging(input, bucket, days) {
  input.dueAgingBinding.agingBucket = bucket; input.dueAgingBinding.daysPastDue = days;
}

function setPart11D(input, state, kind) {
  const resolution = input.part11DChangeResolutionBinding; const rule = part11D.triggerCatalog.find(item => item.kind === kind);
  resolution.resolutionState = state; resolution.decisionId = uuid(50); resolution.materialDigest = digest(50); resolution.idempotencyKeyDigest = digest(51); resolution.requestDigest = digest(52); resolution.selectedKind = kind; resolution.selectedAction = rule.action; resolution.reasonCode = rule.reasonCode; resolution.labelId = rule.labelId; resolution.clearResolutionId = null; resolution.clearResolutionDigest = null;
  if (rule.sourceClass === 'financial_or_document') {
    resolution.currentSourceSetId = uuid(53); resolution.currentSourceSetDigest = digest(53); resolution.currentHeadTransitionId = uuid(54); resolution.currentHeadTransitionDigest = digest(54); resolution.currentHeadSequence = resolution.priorHeadSequence + 1;
    input.dueAgingBinding.sourceSetId = resolution.currentSourceSetId; input.dueAgingBinding.sourceSetDigest = resolution.currentSourceSetDigest; input.dueAgingBinding.headTransitionId = resolution.currentHeadTransitionId; input.dueAgingBinding.headTransitionDigest = resolution.currentHeadTransitionDigest; input.dueAgingBinding.headSequence = resolution.currentHeadSequence;
  }
}

function validate(input, trusted) {
  dataOnly(input); dataOnly(trusted);
  if (hash(input) !== hash(trusted)) throw new Error('trusted resolution');
  const envelope = contract.projectionEnvelope;
  exactKeys(input, envelope.exactFields); exactKeys(input.part11AEligibilityBinding, envelope.part11AEligibilityBindingExactFields); exactKeys(input.part11BPolicyBinding, envelope.part11BPolicyBindingExactFields); exactKeys(input.part11CMaterialBinding, envelope.part11CMaterialBindingExactFields); exactKeys(input.part11DChangeResolutionBinding, envelope.part11DChangeResolutionBindingExactFields); exactKeys(input.dueAgingBinding, envelope.dueAgingBindingExactFields); exactKeys(input.actorAuthorityBinding, envelope.actorAuthorityBindingExactFields);
  if (input.schemaVersion !== contract.contractVersion || !UUID.test(input.tenantId) || !UUID.test(input.projectionId)) throw new Error('identity');
  const a = input.part11AEligibilityBinding; const b = input.part11BPolicyBinding; const c = input.part11CMaterialBinding; const d = input.part11DChangeResolutionBinding; const aging = input.dueAgingBinding; const actor = input.actorAuthorityBinding;
  const ids = [a.resolutionId, a.issuedInvoiceId, a.customerId, a.sourceSetId, a.headTransitionId, b.projectionId, b.policyId, c.projectionId, d.priorSourceSetId, d.priorHeadTransitionId, d.currentSourceSetId, d.currentHeadTransitionId, aging.projectionId, actor.actorId, actor.sessionId, actor.membershipId, actor.capabilityDecisionId];
  const digests = [a.materialDigest, a.issuedVersionDigest, a.sourceSetDigest, a.axisMaterialDigest, a.headTransitionDigest, b.materialDigest, b.policyCanonicalDigest, b.recipientResolutionDigest, c.materialDigest, d.priorSourceSetDigest, d.priorHeadTransitionDigest, d.currentSourceSetDigest, d.currentHeadTransitionDigest, aging.projectionDigest, actor.capabilityDecisionDigest, input.materialDigest, input.idempotencyKeyDigest, input.requestDigest];
  if (ids.some(value => !UUID.test(value)) || digests.some(value => !DIGEST.test(value))) throw new Error('identity');
  for (const value of [a.tenantId, b.tenantId, c.tenantId, d.tenantId, aging.tenantId, actor.actorTenantId, actor.sessionTenantId, actor.membershipTenantId]) if (value !== input.tenantId) throw new Error('tenant');
  if (a.resultState !== contract.sourceBindingContract.acceptedPart11AResult || a.reasonCode !== contract.sourceBindingContract.acceptedPart11AReason || b.resultState !== contract.sourceBindingContract.acceptedPart11BResult || b.reasonCode !== contract.sourceBindingContract.acceptedPart11BReason || c.resultState !== contract.sourceBindingContract.acceptedPart11CResult || c.reasonCode !== contract.sourceBindingContract.acceptedPart11CReason || c.destinationState !== contract.sourceBindingContract.acceptedPart11CDestinationState || c.explanationId !== contract.sourceBindingContract.acceptedPart11CExplanationId) throw new Error('prior authority');
  if (a.issuedInvoiceId !== c.issuedInvoiceId || b.issuedInvoiceId !== c.issuedInvoiceId || aging.issuedInvoiceId !== c.issuedInvoiceId || a.issuedVersionDigest !== c.issuedVersionDigest || b.issuedVersionDigest !== c.issuedVersionDigest || aging.issuedVersionDigest !== c.issuedVersionDigest || a.customerId !== c.customerId || b.policyId !== c.policyId || b.policyVersion !== c.policyVersion || b.phaseId !== c.phaseId || b.recipientResolutionDigest !== c.recipientResolutionDigest) throw new Error('prior binding');
  for (const value of [a, b, c]) if (value.sourceSetId !== c.sourceSetId || value.sourceSetDigest !== c.sourceSetDigest || value.headTransitionId !== c.headTransitionId || value.headTransitionDigest !== c.headTransitionDigest || value.headSequence !== c.headSequence || value.recordedCurrentnessState !== 'latest_exact_current_at_creation') throw new Error('prior head');
  if (d.priorSourceSetId !== c.sourceSetId || d.priorSourceSetDigest !== c.sourceSetDigest || d.priorHeadTransitionId !== c.headTransitionId || d.priorHeadTransitionDigest !== c.headTransitionDigest || d.priorHeadSequence !== c.headSequence || d.currentnessState !== 'latest_exact_current') throw new Error('change resolution');
  if (!contract.sourceBindingContract.part11DResolutionStates.includes(d.resolutionState)) throw new Error('change state');
  if (d.resolutionState === 'clear_exact_current_no_trigger') {
    if (d.decisionId !== null || d.materialDigest !== null || d.idempotencyKeyDigest !== null || d.requestDigest !== null || d.selectedKind !== null || d.selectedAction !== null || d.reasonCode !== null || d.labelId !== null || !UUID.test(d.clearResolutionId) || !DIGEST.test(d.clearResolutionDigest) || d.currentSourceSetId !== d.priorSourceSetId || d.currentSourceSetDigest !== d.priorSourceSetDigest || d.currentHeadTransitionId !== d.priorHeadTransitionId || d.currentHeadTransitionDigest !== d.priorHeadTransitionDigest || d.currentHeadSequence !== d.priorHeadSequence) throw new Error('clear resolution');
  } else {
    const rule = part11D.triggerCatalog.find(item => item.kind === d.selectedKind);
    if (!rule || !UUID.test(d.decisionId) || !DIGEST.test(d.materialDigest) || !DIGEST.test(d.idempotencyKeyDigest) || !DIGEST.test(d.requestDigest) || d.selectedAction !== rule.action || d.reasonCode !== rule.reasonCode || d.labelId !== rule.labelId || d.clearResolutionId !== null || d.clearResolutionDigest !== null || (d.resolutionState === 'suppress_exact_current') !== (rule.action === 'suppress') || (d.resolutionState === 'rebuild_exact_current') !== (rule.action === 'rebuild')) throw new Error('Part11D decision');
    if (rule.sourceClass === 'financial_or_document') { if (d.currentHeadSequence !== d.priorHeadSequence + 1 || d.currentSourceSetId === d.priorSourceSetId || d.currentSourceSetDigest === d.priorSourceSetDigest || d.currentHeadTransitionId === d.priorHeadTransitionId || d.currentHeadTransitionDigest === d.priorHeadTransitionDigest) throw new Error('financial head'); }
    else if (d.currentHeadSequence !== d.priorHeadSequence || d.currentSourceSetId !== d.priorSourceSetId || d.currentSourceSetDigest !== d.priorSourceSetDigest || d.currentHeadTransitionId !== d.priorHeadTransitionId || d.currentHeadTransitionDigest !== d.priorHeadTransitionDigest) throw new Error('human head');
  }
  if (aging.sourceSetId !== d.currentSourceSetId || aging.sourceSetDigest !== d.currentSourceSetDigest || aging.headTransitionId !== d.currentHeadTransitionId || aging.headTransitionDigest !== d.currentHeadTransitionDigest || aging.headSequence !== d.currentHeadSequence || aging.currentnessState !== 'latest_exact_current' || !Number.isSafeInteger(aging.projectionRevision) || aging.projectionRevision < 1 || !Number.isSafeInteger(aging.daysPastDue)) throw new Error('aging head');
  const ranges = {not_due: [-36500, -1], due_today: [0, 0], overdue_1_30: [1, 30], overdue_31_60: [31, 60], overdue_61_90: [61, 90], overdue_91_plus: [91, contract.bounds.maximumDaysPastDue]}; const range = ranges[aging.agingBucket]; if (!range || aging.daysPastDue < range[0] || aging.daysPastDue > range[1]) throw new Error('aging coherence');
  if ((b.phaseId === 'pre_due') !== (aging.agingBucket === 'not_due') || (b.phaseId === 'due_today') !== (aging.agingBucket === 'due_today') || (b.phaseId === 'overdue') !== aging.agingBucket.startsWith('overdue_')) throw new Error('phase coherence');
  const evaluated = micros(input.evaluatedAt); if (evaluated === null) throw new Error('time'); for (const observed of [d.observedAt, aging.observedAt]) { const instant = micros(observed); if (instant === null || instant > evaluated || evaluated - instant > BigInt(contract.bounds.maximumSourceObservationAgeSeconds) * 1000000n) throw new Error('currentness'); }
  if (actor.actorId !== actor.sessionSubjectActorId || actor.actorId !== actor.membershipSubjectActorId || actor.actorState !== 'active' || actor.sessionState !== 'active' || actor.membershipState !== 'active' || actor.membershipRoleId !== 'owner' || actor.capabilityId !== 'automation_view' || actor.recordScope !== 'exact_tenant_owner_worklist_projection') throw new Error('actor');
  if (Buffer.byteLength(JSON.stringify(input)) > contract.bounds.maximumCanonicalRequestBytes || input.materialDigest !== hash(materialOf(input)) || input.idempotencyKeyDigest !== hash(idempotencyMaterialOf(input)) || input.requestDigest !== hash(requestOf(input))) throw new Error('digest');
}

function project(input, trusted) {
  validate(input, trusted);
  const d = input.part11DChangeResolutionBinding; const aging = input.dueAgingBinding;
  const level = contract.graduatedReviewCatalog.find(item => item.sourceState === d.resolutionState && item.allowedPhaseIds.includes(input.part11BPolicyBinding.phaseId) && item.allowedAgingBuckets.includes(aging.agingBucket));
  if (!level) throw new Error('unsupported late stage');
  return Object.freeze({projectionId: input.projectionId, tenantId: input.tenantId, issuedInvoiceId: input.part11CMaterialBinding.issuedInvoiceId, issuedVersionDigest: input.part11CMaterialBinding.issuedVersionDigest, policyId: input.part11BPolicyBinding.policyId, policyVersion: input.part11BPolicyBinding.policyVersion, phaseId: input.part11BPolicyBinding.phaseId, agingBucket: aging.agingBucket, selectedLevelId: level.levelId, selectedSourceState: d.resolutionState, currentHeadTransitionId: d.currentHeadTransitionId, currentHeadTransitionDigest: d.currentHeadTransitionDigest, currentHeadSequence: d.currentHeadSequence, evaluatedAt: input.evaluatedAt, resultState: level.resultState, reasonCode: level.reasonCode, labelId: level.labelId, fixedLabel: level.fixedLabel, ownerReadableProjectionOnly: true, worklistRecordCreated: false, taskCreated: false, approvalRequestCreated: false, manualCallCreated: false, finalNoticeCreated: false, messageCreated: false, providerAttemptCreated: false, feeCreated: false, writeoffCreated: false, legalActionCreated: false, financialMutationCreated: false, accountingMutationCreated: false, balanceMutationCreated: false, externalEffectCreated: false, upstreamMutationCreated: false, moneyEffectCreated: false});
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

describe('Mission 28 Part 11E owner worklist and prohibited legal boundary', () => {
  test('binds exact Part11D release provenance and frozen accepted inputs', () => {
    expect(contract.authority).toMatchObject({part: '11E', state: 'implementation_candidate_only', baselineCommit: 'fdc05855e76ccb9a430114f99522fe1b4648ca62', baselineTree: '8d3820efd3c2c37e5ac89a603ce9481bbd79bba1', frozenSourceSha256: 'DDBA5CA7523A1684330E136313F4416584D142A63167310EEABEC1EBFBB010B4'});
    expect(contract.part11DRelease).toMatchObject({acceptedSourceHead: '5204462d60b8dba20a8148152c1ddffb95da2015', acceptedTree: '8d3820efd3c2c37e5ac89a603ce9481bbd79bba1', pullRequest: 596, mergedMain: 'fdc05855e76ccb9a430114f99522fe1b4648ca62', deploymentIdentity: '21b71cbc-c331-406a-8374-ff5ba98709c6_SUCCESS', imageIdentity: 'sha256:734fa9842bcedba20499887f988964f59e6963cab9edd707985d2c40242a0a1e', runningInstance: '7ee4f747-38c2-4baa-a024-1d7db6e7c218'});
    expect(contract.frozenInputs).toHaveLength(9); for (const item of contract.frozenInputs) expect(digestLf(item.path)).toBe(item.normalizedLfSha256);
  });

  test('defines exactly five privacy-safe graduated owner review levels', () => {
    expect(contract.graduatedReviewCatalog.map(item => item.levelId)).toEqual(['pause_review','rebuild_review','approval_request_review','manual_contact_review','final_supported_notice_review']);
    for (const level of contract.graduatedReviewCatalog) { expect(level.fixedLabel).not.toMatch(/@|phone|token|sk_|customer|invoice number|amount|https?:|threat|lawyer|court|fee|write.?off/i); const output = project(fixture(level.levelId), fixture(level.levelId)); expect(output).toMatchObject({selectedLevelId: level.levelId, resultState: level.resultState, reasonCode: level.reasonCode, labelId: level.labelId, fixedLabel: level.fixedLabel, ownerReadableProjectionOnly: true, worklistRecordCreated: false, taskCreated: false, messageCreated: false, externalEffectCreated: false}); }
  });

  test('gives exact Part11D suppression and rebuild precedence over aging graduation', () => {
    for (const [levelId, bucket, days] of [['pause_review','overdue_91_plus',120], ['rebuild_review','overdue_1_30',3]]) { const input = fixture(levelId); setAging(input, bucket, days); seal(input); expect(project(input, copy(input)).selectedLevelId).toBe(levelId); }
    const clear = fixture('approval_request_review'); setAging(clear, 'overdue_31_60', 45); seal(clear); expect(project(clear, copy(clear)).selectedLevelId).toBe('manual_contact_review');
  });

  test('binds exact Part11A through Part11D tenant invoice policy recipient and source heads', () => {
    for (const mutation of [value => { value.part11AEligibilityBinding.resultState = 'ineligible_balance'; }, value => { value.part11BPolicyBinding.resultState = 'eligible'; }, value => { value.part11CMaterialBinding.destinationState = 'available'; }, value => { value.part11BPolicyBinding.policyId = uuid(99); }, value => { value.part11CMaterialBinding.recipientResolutionDigest = digest(99); }, value => { value.part11DChangeResolutionBinding.priorHeadTransitionDigest = digest(99); }, value => { value.dueAgingBinding.headTransitionDigest = digest(99); }]) { const input = fixture(); mutation(input); seal(input); expect(() => project(input, copy(input))).toThrow(); }
    const candidate = fixture(); const trusted = fixture(); candidate.tenantId = uuid(99); seal(candidate); expect(() => project(candidate, trusted)).toThrow('trusted resolution');
  });

  test('requires an exact trusted clear resolution or exact accepted Part11D decision', () => {
    for (const mutation of [value => { value.part11DChangeResolutionBinding.clearResolutionId = null; }, value => { value.part11DChangeResolutionBinding.currentHeadSequence += 1; }, value => { value.part11DChangeResolutionBinding.selectedKind = 'legal_threat'; }, value => { value.part11DChangeResolutionBinding.selectedAction = 'send'; }]) { const input = fixture(); mutation(input); seal(input); expect(() => project(input, copy(input))).toThrow(); }
    const financial = fixture('rebuild_review'); financial.part11DChangeResolutionBinding.currentHeadSequence += 1; financial.dueAgingBinding.headSequence += 1; seal(financial); expect(() => project(financial, copy(financial))).toThrow('financial head');
  });

  test('enforces exact overdue bucket days and phase coherence and denies non-late clear states', () => {
    for (const mutation of [value => { value.dueAgingBinding.daysPastDue = 31; setAging(value, 'overdue_1_30', 31); }, value => { value.dueAgingBinding.agingBucket = 'overdue_unknown'; }, value => { value.part11BPolicyBinding.phaseId = 'due_today'; }, value => { value.dueAgingBinding.currentnessState = 'stale'; }]) { const input = fixture('approval_request_review'); mutation(input); seal(input); expect(() => project(input, copy(input))).toThrow(); }
    const dueToday = fixture(); dueToday.part11BPolicyBinding.phaseId = 'due_today'; dueToday.part11CMaterialBinding.phaseId = 'due_today'; setAging(dueToday, 'due_today', 0); seal(dueToday); expect(() => project(dueToday, copy(dueToday))).toThrow('unsupported late stage');
  });

  test('requires exact active owner session membership and narrowed released view capability', () => {
    for (const mutation of [value => { value.actorAuthorityBinding.membershipRoleId = 'admin'; }, value => { value.actorAuthorityBinding.capabilityId = 'automation_run_approve'; }, value => { value.actorAuthorityBinding.sessionSubjectActorId = uuid(99); }, value => { value.actorAuthorityBinding.membershipSubjectActorId = uuid(99); }, value => { value.actorAuthorityBinding.sessionState = 'expired'; }, value => { value.actorAuthorityBinding.recordScope = 'tenant_wide'; }]) { const input = fixture(); mutation(input); seal(input); expect(() => project(input, copy(input))).toThrow('actor'); }
  });

  test('fails closed on future stale or over-age currentness evidence', () => {
    for (const mutation of [value => { value.part11DChangeResolutionBinding.observedAt = '2026-10-29T12:05:00.000001Z'; }, value => { value.dueAgingBinding.observedAt = '2026-10-29T11:59:59.999999Z'; }, value => { value.evaluatedAt = 'not-time'; }]) { const input = fixture(); mutation(input); seal(input); expect(() => project(input, copy(input))).toThrow(); }
  });

  test('uses stable idempotency and denies conflicting replay clone and later-head reuse', () => {
    const history = new History(); const first = fixture(); expect(history.record(first, copy(first)).replayed).toBe(false); expect(history.record(copy(first), copy(first)).replayed).toBe(true);
    const clone = copy(first); clone.projectionId = uuid(90); clone.evaluatedAt = '2026-10-29T12:06:00.000000Z'; seal(clone); expect(clone.idempotencyKeyDigest).toBe(first.idempotencyKeyDigest); expect(() => history.record(clone, copy(clone))).toThrow('clone');
    const conflict = copy(first); conflict.evaluatedAt = '2026-10-29T12:06:00.000000Z'; seal(conflict); expect(() => history.record(conflict, copy(conflict))).toThrow('identity conflict');
    const changed = copy(first); changed.dueAgingBinding.projectionRevision += 1; changed.dueAgingBinding.projectionDigest = digest(99); seal(changed); expect(changed.idempotencyKeyDigest).not.toBe(first.idempotencyKeyDigest);
  });

  test('rejects legal escalation operations and free text before any worklist semantics', () => {
    expect(contract.prohibitedEscalationCatalog).toEqual(['external_collection_agency','legal_threat','credit_reporting','lien','repossession','financing','unsupported_fee','write_off','legal_conclusion']);
    for (const field of ['legalThreat','agency','creditReport','lien','fee','writeoff','message']) { const input = fixture(); input[field] = 'candidate'; expect(() => project(input, fixture())).toThrow(); }
    expect(contract.prohibitedBoundary.candidateCannotRequestModelPreviewRecommendScheduleCreatePersistSendOrClaimAnyCatalogItem).toBe(true);
  });

  test('rejects accessors symbols proxies toJSON custom prototypes sparse arrays and aliases before hooks', () => {
    for (const mutation of [value => { value.extra = 'x'; }, value => { delete value.requestDigest; }, value => { value.dueAgingBinding.toJSON = () => ({}); }, value => { Object.setPrototypeOf(value.part11CMaterialBinding, {}); }, value => { value.part11BPolicyBinding = value.part11AEligibilityBinding; }]) { const input = fixture(); mutation(input); expect(() => project(input, fixture())).toThrow(); }
    let getters = 0; const accessor = fixture(); Object.defineProperty(accessor.dueAgingBinding, 'agingBucket', {enumerable: true, get() { getters += 1; return 'overdue_31_60'; }}); expect(() => project(accessor, fixture())).toThrow(); expect(getters).toBe(0);
    const symbol = fixture(); symbol[Symbol('secret')] = 'sk_secret'; expect(() => project(symbol, fixture())).toThrow();
    let traps = 0; const proxy = new Proxy(fixture(), {get() { traps += 1; throw new Error('trap'); }, ownKeys() { traps += 1; throw new Error('trap'); }}); expect(() => project(proxy, fixture())).toThrow(); expect(traps).toBe(0);
    const sparse = fixture(); sparse.hidden = []; sparse.hidden[2] = 'x'; expect(() => project(sparse, fixture())).toThrow();
  });

  test('creates zero worklist task communication legal financial or money effects', () => {
    for (const value of Object.values(contract.privacyAndEffects)) expect(value).toBe(0);
    for (const output of contract.graduatedReviewCatalog.map(level => project(fixture(level.levelId), fixture(level.levelId)))) for (const key of ['worklistRecordCreated','taskCreated','approvalRequestCreated','manualCallCreated','finalNoticeCreated','messageCreated','providerAttemptCreated','feeCreated','writeoffCreated','legalActionCreated','financialMutationCreated','accountingMutationCreated','balanceMutationCreated','externalEffectCreated','upstreamMutationCreated','moneyEffectCreated']) expect(output[key]).toBe(false);
    expect(contract.currentAvailability).toMatchObject({completeMountedPart11AThroughPart11DResolverAvailable: false, exactClearNoTriggerResolutionAvailable: false, ownerWorklistRecordOrTaskRuntimeAvailable: false, legalOrExternalEscalationAuthorityAvailable: false, currentLiveResult: contract.fixedUnavailableDecision.resultState});
  });

  test('freezes docs-tests-only scope with migration287 latest and no288', () => {
    expect(contract.runtimeBoundary).toMatchObject({newMigration: false, newTableFunctionRouteOrUi: false, worklistRecordOrTaskCreated: false, nextMigrationAbsent: '288'});
    const migrations = fs.readdirSync(path.join(ROOT, 'migrations')).filter(name => /^\d+_/.test(name)).sort(); expect(migrations).toHaveLength(283); expect(migrations.at(-1)).toBe('287_canonical_automation_estimate_quote_resolution_v1.sql'); expect(migrations.some(name => name.startsWith('288_'))).toBe(false);
  });

  test('roadmap and ledger record Part11D released Part11E candidate and later slices planned', () => {
    const roadmap = fs.readFileSync(path.join(ROOT, 'docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md'), 'utf8'); const ledger = fs.readFileSync(path.join(ROOT, 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md'), 'utf8');
    for (const value of [roadmap, ledger]) { expect(value).toContain('Parts 1A–13A are released. Part 13B is the sole implementation candidate.'); expect(value).toContain('Parts 13C–14G remain planned and unimplemented.'); for (const identity of ['5204462d60b8dba20a8148152c1ddffb95da2015','fdc05855e76ccb9a430114f99522fe1b4648ca62','21b71cbc-c331-406a-8374-ff5ba98709c6','sha256:734fa9842bcedba20499887f988964f59e6963cab9edd707985d2c40242a0a1e','7ee4f747-38c2-4baa-a024-1d7db6e7c218','b42145ddc95e9bc2a383f9dac6ad1f5a884a90d5a3e999a0c126b2b6e3bae369']) expect(value).toContain(identity); }
    expect((ledger.match(/\| \*\*Released\*\* \|/g) || []).length).toBe(55); expect((ledger.match(/\| \*\*Implementation candidate\*\* \|/g) || []).length).toBe(1); expect((ledger.match(/\| Planned \/ unimplemented \|/g) || []).length).toBe(10);
  });
});
