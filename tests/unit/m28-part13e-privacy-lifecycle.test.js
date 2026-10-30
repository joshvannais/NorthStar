'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {types} = require('util');

const ROOT = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const contract = JSON.parse(read('docs/architecture/MISSION_28_PART13E_PRIVACY_LIFECYCLE_CONTRACT.json'));
const part3A = JSON.parse(read('docs/architecture/MISSION_28_PART3A_FIXED_CAPABILITY_MATRIX.json'));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const d = n => `sha256:${String(n).padStart(64, '0')}`;
const digestLf = relative => crypto.createHash('sha256').update(read(relative).replace(/\r\n?/g, '\n')).digest('hex').toUpperCase();

function plain(value, seen = new WeakSet()) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return value;
  if (typeof value === 'number') { if (!Number.isSafeInteger(value)) throw new Error('number'); return value; }
  if (!value || typeof value !== 'object' || types.isProxy(value) || seen.has(value)) throw new Error('plain');
  seen.add(value);
  if (Array.isArray(value)) {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length || Object.keys(value).length !== value.length) throw new Error('array');
    return Array.from({length: value.length}, (_, index) => {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor) || descriptor.get || descriptor.set) throw new Error('array descriptor');
      return plain(descriptor.value, seen);
    });
  }
  if (Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length) throw new Error('object');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result = {};
  for (const key of Object.keys(descriptors)) {
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !('value' in descriptor) || descriptor.get || descriptor.set) throw new Error('descriptor');
    result[key] = plain(descriptor.value, seen);
  }
  return result;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const hash = value => `sha256:${crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')}`;
function exact(value, fields, label) {
  if (Object.keys(value).sort().join('|') !== [...fields].sort().join('|')) throw new Error(`${label} fields`);
}
function assessmentMaterial(value) {
  const copy = plain(value); delete copy.materialDigest; delete copy.idempotencyKeyDigest; delete copy.assessmentDigest; return copy;
}
function semanticMaterial(value) {
  const copy = assessmentMaterial(value); delete copy.assessmentId; delete copy.evaluatedAt; return copy;
}
function seal(value) {
  value.materialDigest = hash(assessmentMaterial(value));
  value.idempotencyKeyDigest = hash({domain: contract.contractVersion, material: semanticMaterial(value)});
  const copy = plain(value); delete copy.assessmentDigest; value.assessmentDigest = hash(copy);
  return value;
}
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
function canonicalTime(value) {
  if (typeof value !== 'string' || !TIME.test(value)) return false;
  const milliseconds = `${value.slice(0, 23)}Z`;
  const parsed = new Date(milliseconds);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === milliseconds;
}

function expectedDisposition(value) {
  if (value.authorityBinding.retentionState === 'unavailable' || value.authorityBinding.holdState === 'unavailable' || value.subjectBinding.currentnessState === 'unavailable') return 'unavailable_no_privacy_lifecycle_authority';
  if (value.authorityBinding.holdState === 'active_exact_current') return 'blocked_by_active_hold_no_effect';
  return 'owner_review_only_no_effect';
}

function validate(candidate, separatelyTrusted) {
  const value = plain(candidate); const trusted = plain(separatelyTrusted);
  const env = contract.assessmentEnvelope;
  exact(value, env.exactFields, 'root');
  exact(value.subjectBinding, env.subjectBindingExactFields, 'subject');
  exact(value.actorBinding, env.actorBindingExactFields, 'actor');
  exact(value.authorityBinding, env.authorityBindingExactFields, 'authority');
  exact(value.privacyBinding, env.privacyBindingExactFields, 'privacy');
  exact(value.detailBinding, env.detailBindingExactFields, 'detail');
  exact(value.lifecycleBinding, env.lifecycleBindingExactFields, 'lifecycle');
  if (!same(value, trusted)) throw new Error('trusted resolution');
  if (value.schemaVersion !== env.schemaVersion || !UUID.test(value.tenantId) || !UUID.test(value.assessmentId) || !canonicalTime(value.evaluatedAt)) throw new Error('identity');
  const row = contract.operationCatalog.find(item => item.operationKind === value.operationKind);
  if (!row || row.subjectKind !== value.subjectBinding.subjectKind || row.requiredCapabilityId !== value.actorBinding.capabilityId) throw new Error('operation');
  const subject = value.subjectBinding;
  if (subject.subjectTenantId !== value.tenantId || !UUID.test(subject.subjectId) || !DIGEST.test(subject.subjectDigest) || !Number.isSafeInteger(subject.subjectRevision) || subject.subjectRevision < 1 || subject.subjectRevision > contract.bounds.maximumSubjectRevision) throw new Error('subject');
  if (!['latest_exact_current', 'unavailable'].includes(subject.currentnessState)) throw new Error('currentness');
  const sourceValues = [subject.sourceHeadId, subject.sourceHeadDigest, subject.sourceHeadSequence];
  if (subject.currentnessState === 'latest_exact_current') {
    if (!UUID.test(sourceValues[0]) || !DIGEST.test(sourceValues[1]) || !Number.isSafeInteger(sourceValues[2]) || sourceValues[2] < 1 || sourceValues[2] > contract.bounds.maximumSequence) throw new Error('source head');
  } else if (sourceValues.some(item => item !== null)) throw new Error('unavailable source');
  const actor = value.actorBinding;
  const tenantIds = [actor.actorTenantId, actor.sessionTenantId, actor.membershipTenantId, actor.recordTenantId];
  if (tenantIds.some(item => item !== value.tenantId) || actor.actorId !== actor.sessionSubjectActorId || actor.actorId !== actor.membershipSubjectActorId) throw new Error('actor binding');
  if (![actor.actorId, actor.sessionId, actor.membershipId].every(item => UUID.test(item)) || actor.membershipStatus !== 'active') throw new Error('actor identity');
  const capability = part3A.capabilities.find(item => item.id === actor.capabilityId);
  const grant = capability && capability.grants.find(item => item.membershipRoleId === actor.membershipRoleId && item.recordScope === actor.recordScope);
  if (!capability || !grant || (capability.requiresRecentAuthentication && actor.recentAuthenticationState !== 'recent_exact') || (!capability.requiresRecentAuthentication && !['recent_exact', 'not_required'].includes(actor.recentAuthenticationState))) throw new Error('capability');
  const authority = value.authorityBinding;
  if (authority.authorityTenantId !== value.tenantId || !UUID.test(authority.policySourceHeadId) || !DIGEST.test(authority.policySourceHeadDigest) || !UUID.test(authority.actionAuditHeadId) || !DIGEST.test(authority.actionAuditHeadDigest)) throw new Error('authority');
  if (!['unavailable', 'reviewed_retain', 'reviewed_delete_eligible'].includes(authority.retentionState) || !['unavailable', 'clear_exact_current', 'active_exact_current'].includes(authority.holdState)) throw new Error('authority state');
  const retentionAvailable = authority.retentionState !== 'unavailable';
  if (retentionAvailable !== (UUID.test(authority.retentionPolicyId || '') && DIGEST.test(authority.retentionPolicyDigest || ''))) throw new Error('retention identity');
  const holdAvailable = authority.holdState !== 'unavailable';
  if (holdAvailable !== (UUID.test(authority.holdResolutionId || '') && DIGEST.test(authority.holdResolutionDigest || ''))) throw new Error('hold identity');
  const privacy = value.privacyBinding;
  if (privacy.privacyTenantId !== value.tenantId || privacy.profileId !== contract.privacyProfile.profileId || !DIGEST.test(privacy.profileDigest) || privacy.tenantAggregateOnly !== true || privacy.containsForbiddenMaterial !== false || privacy.crossTenantMaterial !== false || privacy.rawPayloadRetained !== false) throw new Error('privacy');
  const detail = value.detailBinding;
  const nullDetail = ['exportSchemaId','exportSchemaDigest','exportMaximumRows','exportMaximumBytes','exportCursorDigest','customerScopeId','customerScopeDigest','incidentOrRecoveryEvidenceHeadId','incidentOrRecoveryEvidenceHeadDigest','evidenceItemCount'];
  if (!Array.isArray(detail.exportFieldIds) || new Set(detail.exportFieldIds).size !== detail.exportFieldIds.length) throw new Error('export fields');
  if (!Array.isArray(detail.dimensionIds) || new Set(detail.dimensionIds).size !== detail.dimensionIds.length) throw new Error('dimensions');
  if (['metrics_read','trace_read'].includes(value.operationKind)) {
    if (detail.dimensionIds.length < 1 || detail.dimensionIds.length > contract.bounds.maximumMetricDimensions || detail.dimensionIds.some(item => !contract.privacyProfile.allowedMetricDimensions.includes(item)) || detail.exportFieldIds.length || nullDetail.some(field => detail[field] !== null)) throw new Error('metric detail');
  } else if (value.operationKind === 'export_review') {
    if (detail.dimensionIds.length || detail.exportFieldIds.length < 1 || detail.exportFieldIds.length > contract.bounds.maximumExportFields || detail.exportFieldIds.some(item => !contract.privacyProfile.allowedAuditMaterial.includes(item)) || !UUID.test(detail.exportSchemaId || '') || !DIGEST.test(detail.exportSchemaDigest || '') || !Number.isSafeInteger(detail.exportMaximumRows) || detail.exportMaximumRows < 1 || detail.exportMaximumRows > contract.bounds.maximumExportRows || !Number.isSafeInteger(detail.exportMaximumBytes) || detail.exportMaximumBytes < 1 || detail.exportMaximumBytes > contract.bounds.maximumExportBytes || !DIGEST.test(detail.exportCursorDigest || '') || ['customerScopeId','customerScopeDigest','incidentOrRecoveryEvidenceHeadId','incidentOrRecoveryEvidenceHeadDigest','evidenceItemCount'].some(field => detail[field] !== null)) throw new Error('export detail');
  } else if (value.operationKind === 'customer_erasure_review') {
    if (detail.dimensionIds.length || detail.exportFieldIds.length || !UUID.test(detail.customerScopeId || '') || !DIGEST.test(detail.customerScopeDigest || '') || ['exportSchemaId','exportSchemaDigest','exportMaximumRows','exportMaximumBytes','exportCursorDigest','incidentOrRecoveryEvidenceHeadId','incidentOrRecoveryEvidenceHeadDigest','evidenceItemCount'].some(field => detail[field] !== null)) throw new Error('customer detail');
  } else if (['incident_evidence_review','recovery_review'].includes(value.operationKind)) {
    if (detail.dimensionIds.length || detail.exportFieldIds.length || !UUID.test(detail.incidentOrRecoveryEvidenceHeadId || '') || !DIGEST.test(detail.incidentOrRecoveryEvidenceHeadDigest || '') || !Number.isSafeInteger(detail.evidenceItemCount) || detail.evidenceItemCount < 0 || detail.evidenceItemCount > contract.bounds.maximumIncidentEvidenceItems || ['exportSchemaId','exportSchemaDigest','exportMaximumRows','exportMaximumBytes','exportCursorDigest','customerScopeId','customerScopeDigest'].some(field => detail[field] !== null)) throw new Error('evidence detail');
  } else if (detail.dimensionIds.length || detail.exportFieldIds.length || nullDetail.some(field => detail[field] !== null)) throw new Error('unexpected detail');
  const lifecycle = value.lifecycleBinding;
  if (!Number.isSafeInteger(lifecycle.sequence) || lifecycle.sequence < 1 || lifecycle.sequence > contract.bounds.maximumSequence || lifecycle.disposition !== expectedDisposition(value)) throw new Error('lifecycle');
  if (lifecycle.sequence === 1) { if (lifecycle.predecessorAssessmentId !== null || lifecycle.predecessorAssessmentDigest !== null) throw new Error('first predecessor'); }
  else if (!UUID.test(lifecycle.predecessorAssessmentId || '') || !DIGEST.test(lifecycle.predecessorAssessmentDigest || '')) throw new Error('predecessor');
  if (!DIGEST.test(value.materialDigest) || value.materialDigest !== hash(assessmentMaterial(value))) throw new Error('material digest');
  if (!DIGEST.test(value.idempotencyKeyDigest) || value.idempotencyKeyDigest !== hash({domain: contract.contractVersion, material: semanticMaterial(value)})) throw new Error('idempotency digest');
  const copy = plain(value); delete copy.assessmentDigest;
  if (!DIGEST.test(value.assessmentDigest) || value.assessmentDigest !== hash(copy)) throw new Error('assessment digest');
  return value;
}

function fixture(operationKind = 'deletion_review') {
  const row = contract.operationCatalog.find(item => item.operationKind === operationKind);
  const capability = part3A.capabilities.find(item => item.id === row.requiredCapabilityId);
  const grant = capability.grants.find(item => item.membershipRoleId === 'owner');
  const detailBinding = {dimensionIds: [], exportFieldIds: [], exportSchemaId: null, exportSchemaDigest: null, exportMaximumRows: null, exportMaximumBytes: null, exportCursorDigest: null, customerScopeId: null, customerScopeDigest: null, incidentOrRecoveryEvidenceHeadId: null, incidentOrRecoveryEvidenceHeadDigest: null, evidenceItemCount: null};
  if (['metrics_read','trace_read'].includes(operationKind)) detailBinding.dimensionIds = ['fixed_action_family'];
  if (operationKind === 'export_review') Object.assign(detailBinding, {exportFieldIds: ['internal_opaque_identity','canonical_digest','fixed_state'], exportSchemaId: uuid(40), exportSchemaDigest: d(40), exportMaximumRows: 1000, exportMaximumBytes: 1048576, exportCursorDigest: d(41)});
  if (operationKind === 'customer_erasure_review') Object.assign(detailBinding, {customerScopeId: uuid(42), customerScopeDigest: d(42)});
  if (['incident_evidence_review','recovery_review'].includes(operationKind)) Object.assign(detailBinding, {incidentOrRecoveryEvidenceHeadId: uuid(43), incidentOrRecoveryEvidenceHeadDigest: d(43), evidenceItemCount: 1});
  return seal({
    schemaVersion: contract.assessmentEnvelope.schemaVersion,
    tenantId: uuid(1), assessmentId: uuid(2), operationKind,
    subjectBinding: {subjectTenantId: uuid(1), subjectKind: row.subjectKind, subjectId: uuid(3), subjectDigest: d(3), subjectRevision: 1, currentnessState: 'unavailable', sourceHeadId: null, sourceHeadDigest: null, sourceHeadSequence: null},
    actorBinding: {actorId: uuid(4), actorTenantId: uuid(1), sessionId: uuid(5), sessionSubjectActorId: uuid(4), sessionTenantId: uuid(1), membershipId: uuid(6), membershipSubjectActorId: uuid(4), membershipTenantId: uuid(1), membershipRoleId: 'owner', membershipStatus: 'active', capabilityId: row.requiredCapabilityId, recordScope: grant.recordScope, recordTenantId: uuid(1), recentAuthenticationState: capability.requiresRecentAuthentication ? 'recent_exact' : 'not_required'},
    authorityBinding: {authorityTenantId: uuid(1), retentionPolicyId: null, retentionPolicyDigest: null, retentionState: 'unavailable', holdResolutionId: null, holdResolutionDigest: null, holdState: 'unavailable', policySourceHeadId: uuid(7), policySourceHeadDigest: d(7), actionAuditHeadId: uuid(8), actionAuditHeadDigest: d(8)},
    privacyBinding: {privacyTenantId: uuid(1), profileId: contract.privacyProfile.profileId, profileDigest: d(9), tenantAggregateOnly: true, containsForbiddenMaterial: false, crossTenantMaterial: false, rawPayloadRetained: false},
    detailBinding,
    lifecycleBinding: {sequence: 1, predecessorAssessmentId: null, predecessorAssessmentDigest: null, disposition: 'unavailable_no_privacy_lifecycle_authority'},
    evaluatedAt: '2026-10-30T12:00:00.000000Z', materialDigest: d(0), idempotencyKeyDigest: d(0), assessmentDigest: d(0)
  });
}
function reviewedFixture(operationKind = 'deletion_review', holdState = 'clear_exact_current') {
  const value = fixture(operationKind);
  value.subjectBinding = {...value.subjectBinding, currentnessState: 'latest_exact_current', sourceHeadId: uuid(20), sourceHeadDigest: d(20), sourceHeadSequence: 4};
  value.authorityBinding = {...value.authorityBinding, retentionPolicyId: uuid(21), retentionPolicyDigest: d(21), retentionState: 'reviewed_delete_eligible', holdResolutionId: uuid(22), holdResolutionDigest: d(22), holdState};
  value.lifecycleBinding.disposition = holdState === 'active_exact_current' ? 'blocked_by_active_hold_no_effect' : 'owner_review_only_no_effect';
  return seal(value);
}

class History {
  constructor() { this.byId = new Map(); this.bySemantic = new Map(); this.children = new Map(); this.head = null; }
  record(candidate, trusted) {
    const value = validate(candidate, trusted);
    const existing = this.byId.get(value.assessmentId);
    if (existing) { if (existing.assessmentDigest !== value.assessmentDigest) throw new Error('id conflict'); return {accepted: true, replay: true}; }
    if (this.bySemantic.has(value.idempotencyKeyDigest)) throw new Error('clone');
    const predecessor = value.lifecycleBinding.predecessorAssessmentId;
    if (this.head === null) { if (value.lifecycleBinding.sequence !== 1 || predecessor !== null) throw new Error('first'); }
    else {
      if (predecessor !== this.head.assessmentId || value.lifecycleBinding.predecessorAssessmentDigest !== this.head.assessmentDigest || value.lifecycleBinding.sequence !== this.head.lifecycleBinding.sequence + 1) throw new Error('non-head');
      if (this.children.has(predecessor)) throw new Error('fork');
    }
    this.byId.set(value.assessmentId, value); this.bySemantic.set(value.idempotencyKeyDigest, value.assessmentId);
    if (predecessor) this.children.set(predecessor, value.assessmentId);
    this.head = value; return {accepted: true, replay: false};
  }
}

describe('Mission 28 Part 13E privacy lifecycle boundary', () => {
  test('binds the frozen authority, exact released Part 13D identities and all input hashes', () => {
    expect(contract.frozenAuthority).toMatchObject({part: '13', slice: 'E', crossTenantAnalyticsBoundary: expect.stringContaining('Mission33')});
    expect(contract.part13DRelease).toMatchObject({acceptedSourceHead: '997ba10385f259f4298bed6447d083bcb83796e4', acceptedTree: 'f3fa9099e2c8557c29d944a1d6b90c409d4e3cb6', pullRequest: 606, mergedMain: '2275b9f94f65ffe9f362a872ddd8b9a24d76b9d1', release: {deploymentId: '75f64645-b482-499d-9a8e-b78a2e71153e', deploymentInstanceId: '949051dd-ebd3-4c11-8f8d-d68efa46b020', imageSha256: 'sha256:21ae0d3cc9d7d98dc17952f9f6ed142c5ce93d30e4211672cf8433d6767d5c04'}});
    for (const item of contract.frozenInputs) expect(digestLf(item.path)).toBe(item.normalizedLfSha256);
  });

  test('covers every frozen operation with a closed subject and capability while keeping all authority unavailable', () => {
    expect(contract.operationCatalog.map(item => item.operationKind)).toEqual(['metrics_read','trace_read','action_audit_read','retention_review','deletion_review','hold_review','customer_erasure_review','tenant_offboarding_review','policy_revocation_review','source_revocation_review','export_review','cleanup_review','incident_evidence_review','recovery_review']);
    for (const row of contract.operationCatalog) {
      const value = fixture(row.operationKind);
      expect(validate(value, plain(value)).operationKind).toBe(row.operationKind);
      expect(row.result).toBe('unavailable_no_privacy_lifecycle_authority');
    }
    expect(Object.values(contract.currentAuthority).filter(value => typeof value === 'number').every(value => value === 0)).toBe(true);
    expect(contract.fixedDecision).toMatchObject({recordWritten: false, recordDeleted: false, recordExported: false, holdCreated: false, customerErased: false, tenantOffboarded: false, policyOrSourceRevoked: false, providerCalled: false, recipientContacted: false, externalEffectCreated: false, moneyMoved: false, legalConclusionCreated: false});
  });

  test('fails descriptor-first before getters proxies serializers symbols custom prototypes sparse or aliased data can create authority', () => {
    const attacks = [];
    const getter = fixture(); let getterCount = 0; Object.defineProperty(getter.subjectBinding, 'subjectId', {enumerable: true, get() { getterCount += 1; return uuid(3); }}); attacks.push([getter, () => getterCount]);
    attacks.push([new Proxy(fixture(), {}), () => 0]);
    const toJSON = fixture(); toJSON.toJSON = () => 'secret'; attacks.push([toJSON, () => 0]);
    const symbol = fixture(); symbol[Symbol('secret')] = 'value'; attacks.push([symbol, () => 0]);
    const custom = fixture(); Object.setPrototypeOf(custom.privacyBinding, {evil: true}); attacks.push([custom, () => 0]);
    const sparse = fixture(); sparse.extra = []; sparse.extra.length = 1; attacks.push([sparse, () => 0]);
    const alias = fixture(); alias.privacyBinding = alias.subjectBinding; attacks.push([alias, () => 0]);
    for (const [attack, count] of attacks) { expect(() => validate(attack, fixture())).toThrow(); expect(count()).toBe(0); }
  });

  test('denies candidate-created trust, cross-tenant and cross-actor authority even after coherent redigest', () => {
    const base = fixture();
    const mutations = [
      value => { value.tenantId = uuid(90); value.subjectBinding.subjectTenantId = uuid(90); value.actorBinding.actorTenantId = uuid(90); value.actorBinding.sessionTenantId = uuid(90); value.actorBinding.membershipTenantId = uuid(90); value.actorBinding.recordTenantId = uuid(90); value.authorityBinding.authorityTenantId = uuid(90); value.privacyBinding.privacyTenantId = uuid(90); },
      value => { value.actorBinding.sessionSubjectActorId = uuid(91); },
      value => { value.actorBinding.membershipSubjectActorId = uuid(92); },
      value => { value.actorBinding.membershipRoleId = 'admin'; },
      value => { value.subjectBinding.subjectId = uuid(93); value.subjectBinding.subjectDigest = d(93); }
    ];
    for (const mutate of mutations) { const attack = plain(base); mutate(attack); seal(attack); expect(() => validate(attack, base)).toThrow('trusted resolution'); }
  });

  test('keeps retention and hold identities mutually coherent and applies fail-closed precedence', () => {
    expect(validate(reviewedFixture(), reviewedFixture()).lifecycleBinding.disposition).toBe('owner_review_only_no_effect');
    expect(validate(reviewedFixture('deletion_review', 'active_exact_current'), reviewedFixture('deletion_review', 'active_exact_current')).lifecycleBinding.disposition).toBe('blocked_by_active_hold_no_effect');
    const attacks = [
      value => { value.authorityBinding.retentionState = 'reviewed_delete_eligible'; },
      value => { value.authorityBinding.holdState = 'clear_exact_current'; },
      value => { value.lifecycleBinding.disposition = 'owner_review_only_no_effect'; }
    ];
    for (const mutate of attacks) { const attack = fixture(); mutate(attack); seal(attack); expect(() => validate(attack, attack)).toThrow(); }
    const bypass = reviewedFixture(); bypass.authorityBinding.holdState = 'active_exact_current'; seal(bypass); expect(() => validate(bypass, bypass)).toThrow('lifecycle');
  });

  test('forbids private/raw/cross-tenant material and keeps Mission 33 analytics separate', () => {
    for (const field of ['containsForbiddenMaterial', 'crossTenantMaterial', 'rawPayloadRetained']) {
      const attack = fixture('metrics_read'); attack.privacyBinding[field] = true; seal(attack); expect(() => validate(attack, attack)).toThrow('privacy');
    }
    expect(contract.privacyProfile.forbiddenMaterial).toEqual(expect.arrayContaining(['message_body','credential','recipient_address','free_text','provider_raw_payload','ip_address','user_agent']));
    expect(contract.privacyProfile.crossTenantAggregationOrJoining).toBe('deny_Mission33_only');
    expect(contract.deniedCombinations).toContain('cross_tenant_metric_trace_export_or_platform_analytics');
  });

  test('binds metric, export, erasure, incident and recovery details to closed bounded material', () => {
    const attacks = [
      ['metrics_read', value => value.detailBinding.dimensionIds.push('customer_email')],
      ['metrics_read', value => value.detailBinding.dimensionIds.push('fixed_action_family')],
      ['export_review', value => { value.detailBinding.exportMaximumRows = contract.bounds.maximumExportRows + 1; }],
      ['export_review', value => { value.detailBinding.exportCursorDigest = null; }],
      ['export_review', value => { value.detailBinding.exportFieldIds.push('message_body'); }],
      ['customer_erasure_review', value => { value.detailBinding.customerScopeId = null; }],
      ['incident_evidence_review', value => { value.detailBinding.evidenceItemCount = contract.bounds.maximumIncidentEvidenceItems + 1; }],
      ['recovery_review', value => { value.detailBinding.incidentOrRecoveryEvidenceHeadDigest = null; }]
    ];
    for (const [operation, mutate] of attacks) { const value = fixture(operation); mutate(value); seal(value); expect(() => validate(value, value)).toThrow(); }
    const badTime = fixture(); badTime.evaluatedAt = '2026-02-30T12:00:00.000000Z'; seal(badTime); expect(() => validate(badTime, badTime)).toThrow('identity');
  });

  test('preserves immutable audit/history and denies replay conflicts semantic clones forks gaps and reordered heads', () => {
    const history = new History(); const first = fixture('action_audit_read');
    expect(history.record(first, first)).toEqual({accepted: true, replay: false});
    expect(history.record(first, first)).toEqual({accepted: true, replay: true});
    const conflict = plain(first); conflict.evaluatedAt = '2026-10-30T12:00:01.000000Z'; seal(conflict); expect(() => history.record(conflict, conflict)).toThrow('id conflict');
    const clone = plain(first); clone.assessmentId = uuid(30); clone.evaluatedAt = '2026-10-30T12:00:02.000000Z'; seal(clone); expect(() => history.record(clone, clone)).toThrow('clone');
    const second = reviewedFixture('action_audit_read'); second.assessmentId = uuid(31); second.lifecycleBinding = {sequence: 2, predecessorAssessmentId: first.assessmentId, predecessorAssessmentDigest: first.assessmentDigest, disposition: 'owner_review_only_no_effect'}; second.evaluatedAt = '2026-10-30T12:00:03.000000Z'; seal(second); expect(history.record(second, second).accepted).toBe(true);
    const fork = reviewedFixture('action_audit_read'); fork.assessmentId = uuid(32); fork.subjectBinding.subjectId = uuid(33); fork.lifecycleBinding = {sequence: 2, predecessorAssessmentId: first.assessmentId, predecessorAssessmentDigest: first.assessmentDigest, disposition: 'owner_review_only_no_effect'}; seal(fork); expect(() => history.record(fork, fork)).toThrow('non-head');
    const gap = reviewedFixture('action_audit_read'); gap.assessmentId = uuid(34); gap.lifecycleBinding = {sequence: 4, predecessorAssessmentId: second.assessmentId, predecessorAssessmentDigest: second.assessmentDigest, disposition: 'owner_review_only_no_effect'}; seal(gap); expect(() => history.record(gap, gap)).toThrow('non-head');
  });

  test('keeps export, erasure, offboarding, revocation, cleanup, incident and recovery as separate no-effect reviews', () => {
    expect(contract.lifecycleSemantics.export).toContain('executor_unavailable');
    expect(contract.lifecycleSemantics.customerErasure).toContain('never_silently_deleted');
    expect(contract.lifecycleSemantics.tenantOffboarding).toContain('separate_no_completion_claim');
    expect(contract.lifecycleSemantics.policyOrSourceRevocation).toContain('preserves_historical');
    expect(contract.lifecycleSemantics.cleanup).toContain('never_deletes_immutable');
    expect(contract.lifecycleSemantics.incidentEvidence).toContain('not_provider_outcome');
    expect(contract.lifecycleSemantics.recovery).toContain('never_reclaims_resends_retries');
    expect(contract.unavailableEvidence).toEqual(expect.arrayContaining(['customer_identity_verification_erasure_executor_and_upstream_deletion_evidence','tenant_offboarding_export_cleanup_provider_disconnect_and_completion_evidence','cross_tenant_platform_analytics_Mission33_privacy_authority']));
  });

  test('keeps runtime, migrations, providers, recipients, financial effects and legal claims absent', () => {
    expect(contract.runtimeBoundary).toEqual({runtimeResolverMounted: false, persistenceAdded: false, routeUiWorkerSchedulerQueueOrCleanupJobAdded: false, providerRecipientMessageOrEffectPathAdded: false, migrationAdded: false, latestMigration: 287, nextMigrationAbsent: 288, currentInspectionAlwaysReturnsFixedDecision: true});
    expect(contract.deniedCombinations).toEqual(expect.arrayContaining(['provider_recipient_message_external_effect_upstream_mutation_accounting_financial_effect_or_money_authority','professional_legal_privacy_retention_erasure_offboarding_regulatory_security_or_compliance_claim']));
  });

  test('keeps roadmap and 66-row ledger exact with Part 13E candidate only', () => {
    const roadmap = read('docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md'); const ledger = read('docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md');
    for (const value of [roadmap, ledger]) { expect(value).toContain('Parts 1A–13D are released. Part 13E is the sole implementation candidate.'); expect(value).toContain('Parts 14A–14G remain planned and unimplemented.'); }
    expect(roadmap).toContain('Released Part 13D baseline: accepted source `997ba10385f259f4298bed6447d083bcb83796e4`');
    expect(roadmap).toContain('Current Part 13E artifacts:');
    expect(ledger).toContain('| 58 | 13D | Provider outage/quota/degradation/circuit-breaker/fallback | **Released** |');
    expect(ledger).toContain('| 59 | 13E | Privacy-safe observability, retention, deletion and lifecycle | **Implementation candidate** |');
    const rows = ledger.split(/\r?\n/).filter(line => /^\| \d{2} \|/.test(line));
    expect(rows).toHaveLength(66); expect(rows.filter(line => line.includes('**Released**'))).toHaveLength(58); expect(rows.filter(line => line.includes('**Implementation candidate**'))).toHaveLength(1);
  });
});
