'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {types: {isProxy}} = require('util');

const ROOT = path.resolve(__dirname, '../..');
const CONTRACT_PATH = path.join(ROOT, 'docs/architecture/MISSION_28_PART9C_ESTIMATE_QUOTE_FOLLOWUP_CONTRACT.json');
const CONTRACT_MD = path.join(ROOT, 'docs/architecture/MISSION_28_PART9C_ESTIMATE_QUOTE_FOLLOWUP_CONTRACT.md');
const ROADMAP = path.join(ROOT, 'docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md');
const LEDGER = path.join(ROOT, 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md');
const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8'));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ESTIMATE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[45][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const copy = value => JSON.parse(JSON.stringify(value));
const hash = value => `sha256:${crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
const digestLf = relative => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, relative), 'utf8').replace(/\r\n/g, '\n')).digest('hex').toUpperCase();
const uuid = value => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const digest = value => `sha256:${String(value).padStart(2, '0').slice(-2).repeat(32)}`;

function dataGate(value, seen = new WeakSet()) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return;
  if (typeof value !== 'object' || isProxy(value) || seen.has(value)) throw new Error('plain data');
  seen.add(value);
  const proto = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    const keys = Reflect.ownKeys(value);
    if (proto !== Array.prototype || keys.some(key => key !== 'length' && !/^(0|[1-9][0-9]*)$/.test(key)) ||
        keys.filter(key => key !== 'length').length !== value.length) throw new Error('dense array');
  } else if (proto !== Object.prototype) throw new Error('ordinary object');
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'symbol') throw new Error('symbol');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable || key === 'toJSON') throw new Error('descriptor');
    if (key !== 'length') dataGate(descriptor.value, seen);
  }
}

function exactKeys(value, keys) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || JSON.stringify(Reflect.ownKeys(value)) !== JSON.stringify(keys)) throw new Error('keys');
}

function materialOf(input) {
  const value = copy(input); delete value.followupResolutionId; delete value.materialDigest; delete value.idempotencyKeyDigest; delete value.requestDigest; return value;
}
function idempotencyMaterialOf(input) { const value = materialOf(input); delete value.evaluatedAt; return value; }
function requestOf(input) { const value = copy(input); delete value.materialDigest; delete value.idempotencyKeyDigest; delete value.requestDigest; return value; }
function seal(input) {
  input.materialDigest = hash(materialOf(input));
  input.idempotencyKeyDigest = hash({namespace: 'mission28.part9c.estimate-quote-followup-idempotency.v1', material: idempotencyMaterialOf(input)});
  input.requestDigest = hash(requestOf(input)); return input;
}

function estimateBinding() {
  return {
    estimateId: uuid(900001), customerEstimateVersionId: uuid(900002), revision: 4,
    customerEstimateVersionDigest: digest(12), documentDigest: digest(13), commercialApprovalId: uuid(900003),
    commercialApprovalDigest: digest(14), termsId: uuid(900004), termsDigest: digest(15), decisionId: uuid(900005), decisionDigest: digest(16)
  };
}

function actorBinding() {
  return {
    actorId: uuid(10), sessionId: uuid(11), membershipId: uuid(12), sessionSubjectActorId: uuid(10), membershipSubjectActorId: uuid(10),
    actorTenantId: uuid(1), sessionTenantId: uuid(1), membershipTenantId: uuid(1), actorState: 'active', sessionState: 'active', membershipState: 'active',
    membershipRoleId: 'owner', capabilityId: 'automation_internal_action_prepare', capabilityDecisionId: uuid(13), capabilityDecisionDigest: digest(17)
  };
}

function part9BBoundary() {
  return {
    contractDigest: 'sha256:4fe477863980c9829d24900d93ae6a0071ee0ff1c541697257ed234337d76f15',
    externalChannelState: 'unavailable_not_accepted_by_Part1D_or_Part7B',
    cadenceDisposition: 'automation_stopped_owner_review_required_no_effect', silenceState: 'not_evidence'
  };
}

function sourceBinding(stateId = 'revision') {
  const item = contract.stateCatalog.find(entry => entry.stateId === stateId);
  const base = estimateBinding(); const available = item.currentSourceAvailability === 'accepted_upstream_fact_only';
  const response = available && item.triggerId === 'm24.customer_quote_response_state';
  const eventId = stateId === 'revision' ? base.customerEstimateVersionId : uuid({expired: 900021, accepted: 900022, question: 900023}[stateId] || 900099);
  const eventDigest = stateId === 'revision' ? base.customerEstimateVersionDigest : digest({expired: 21, accepted: 22, question: 23}[stateId] || 99);
  return {
    tenantId: uuid(1), estimateId: base.estimateId, customerEstimateVersionId: base.customerEstimateVersionId,
    customerEstimateVersionDigest: base.customerEstimateVersionDigest, documentDigest: base.documentDigest, stateId,
    availabilityState: item.currentSourceAvailability, triggerId: available ? item.triggerId : null, eventKind: available ? item.eventKind : null,
    sourceState: available ? item.sourceState : null,
    eventTime: available ? '2026-10-28T12:00:00.000000Z' : null, eventIdentityId: available ? eventId : null, eventIdentityDigest: available ? eventDigest : null,
    deliveryLinkId: response ? uuid(900030) : null, deliveryLinkDigest: response ? digest(30) : null, sourceRevision: available ? (stateId === 'revision' ? base.revision : 1) : null,
    snapshotId: available ? uuid(900040) : null, snapshotDigest: available ? digest(40) : null, recordIdentityDigest: available ? digest(41) : null,
    sourceSetDigest: available ? digest(42) : null, currentnessResolutionId: available ? uuid(900043) : null,
    currentnessResolutionDigest: available ? digest(43) : null, currentnessState: available ? 'latest_exact_current' : null,
    observedAt: available ? '2026-10-28T12:04:00.000000Z' : null
  };
}

function fixture(stateId = 'revision') {
  return seal({
    schemaVersion: contract.contractVersion, tenantId: uuid(1), followupResolutionId: uuid(2), estimateBinding: estimateBinding(),
    sourceStateBinding: sourceBinding(stateId), actorAuthorityBinding: actorBinding(), part9BBoundaryBinding: part9BBoundary(), requestedStateId: stateId,
    evaluatedAt: '2026-10-28T12:05:00.000000Z', materialDigest: '', idempotencyKeyDigest: '', requestDigest: ''
  });
}

function utcMicros(value) {
  const match = typeof value === 'string' ? /^([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2})\.([0-9]{6})Z$/.exec(value) : null;
  if (!match) return null;
  const millisecondForm = `${match[1]}.${match[2].slice(0, 3)}Z`; const millis = Date.parse(millisecondForm);
  if (!Number.isFinite(millis) || new Date(millis).toISOString() !== millisecondForm) return null;
  return BigInt(millis) * 1000n + BigInt(match[2].slice(3));
}

function validate(input, trusted) {
  dataGate(input); dataGate(trusted);
  if (JSON.stringify(input) !== JSON.stringify(trusted)) throw new Error('trusted resolution');
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > contract.bounds.maximumCanonicalRequestBytes) throw new Error('request size');
  exactKeys(input, contract.resolutionEnvelope.exactFields);
  exactKeys(input.estimateBinding, contract.resolutionEnvelope.estimateBindingExactFields);
  exactKeys(input.sourceStateBinding, contract.resolutionEnvelope.sourceStateBindingExactFields);
  exactKeys(input.actorAuthorityBinding, contract.resolutionEnvelope.actorAuthorityBindingExactFields);
  exactKeys(input.part9BBoundaryBinding, contract.resolutionEnvelope.part9BBoundaryBindingExactFields);
  if (input.schemaVersion !== contract.contractVersion || !UUID.test(input.tenantId) || !UUID.test(input.followupResolutionId)) throw new Error('root identity');

  const estimate = input.estimateBinding;
  if (!ESTIMATE_ID.test(estimate.estimateId) || !UUID.test(estimate.customerEstimateVersionId) || !Number.isSafeInteger(estimate.revision) || estimate.revision < 1 || estimate.revision > 10000 ||
      [estimate.customerEstimateVersionDigest, estimate.documentDigest, estimate.commercialApprovalDigest, estimate.termsDigest, estimate.decisionDigest].some(value => !DIGEST.test(value)) ||
      [estimate.commercialApprovalId, estimate.termsId, estimate.decisionId].some(value => !UUID.test(value))) throw new Error('estimate');

  const actor = input.actorAuthorityBinding;
  if ([actor.actorId, actor.sessionId, actor.membershipId, actor.sessionSubjectActorId, actor.membershipSubjectActorId, actor.actorTenantId,
    actor.sessionTenantId, actor.membershipTenantId, actor.capabilityDecisionId].some(value => !UUID.test(value)) || !DIGEST.test(actor.capabilityDecisionDigest) ||
    actor.actorId !== actor.sessionSubjectActorId || actor.actorId !== actor.membershipSubjectActorId ||
    [actor.actorTenantId, actor.sessionTenantId, actor.membershipTenantId].some(value => value !== input.tenantId) ||
    [actor.actorState, actor.sessionState, actor.membershipState].some(value => value !== 'active') || actor.membershipRoleId !== 'owner' ||
    actor.capabilityId !== 'automation_internal_action_prepare') throw new Error('actor');

  const boundary = input.part9BBoundaryBinding;
  if (boundary.contractDigest !== 'sha256:4fe477863980c9829d24900d93ae6a0071ee0ff1c541697257ed234337d76f15' ||
      boundary.externalChannelState !== 'unavailable_not_accepted_by_Part1D_or_Part7B' ||
      boundary.cadenceDisposition !== 'automation_stopped_owner_review_required_no_effect' || boundary.silenceState !== 'not_evidence') throw new Error('Part9B boundary');

  const item = contract.stateCatalog.find(entry => entry.stateId === input.requestedStateId);
  if (!item || input.sourceStateBinding.stateId !== input.requestedStateId) throw new Error('state');
  const source = input.sourceStateBinding;
  if (source.tenantId !== input.tenantId || source.estimateId !== estimate.estimateId || source.customerEstimateVersionId !== estimate.customerEstimateVersionId ||
      source.customerEstimateVersionDigest !== estimate.customerEstimateVersionDigest || source.documentDigest !== estimate.documentDigest ||
      source.availabilityState !== item.currentSourceAvailability) throw new Error('source binding');

  const available = item.currentSourceAvailability === 'accepted_upstream_fact_only';
  const authorityFields = ['triggerId', 'eventKind', 'sourceState', 'eventTime', 'eventIdentityId', 'eventIdentityDigest', 'sourceRevision', 'snapshotId', 'snapshotDigest',
    'recordIdentityDigest', 'sourceSetDigest', 'currentnessResolutionId', 'currentnessResolutionDigest', 'currentnessState', 'observedAt'];
  if (!available) {
    if (authorityFields.some(key => source[key] !== null) || source.deliveryLinkId !== null || source.deliveryLinkDigest !== null) throw new Error('unavailable source');
  } else {
    if (source.triggerId !== item.triggerId || source.eventKind !== item.eventKind || source.sourceState !== item.sourceState || source.currentnessState !== 'latest_exact_current' ||
        !UUID.test(source.eventIdentityId) || !DIGEST.test(source.eventIdentityDigest) || !UUID.test(source.snapshotId) || !DIGEST.test(source.snapshotDigest) ||
        !DIGEST.test(source.recordIdentityDigest) || !DIGEST.test(source.sourceSetDigest) || !UUID.test(source.currentnessResolutionId) ||
        !DIGEST.test(source.currentnessResolutionDigest) || !Number.isSafeInteger(source.sourceRevision) || source.sourceRevision < 1) throw new Error('source authority');
    const eventTime = utcMicros(source.eventTime); const observedAt = utcMicros(source.observedAt); const evaluatedAt = utcMicros(input.evaluatedAt);
    if (eventTime === null || observedAt === null || evaluatedAt === null || eventTime > observedAt || observedAt > evaluatedAt ||
        evaluatedAt - observedAt > BigInt(contract.bounds.maximumResolutionObservationAgeSeconds) * 1000000n) throw new Error('source time');
    const response = item.triggerId === 'm24.customer_quote_response_state';
    if (response !== (UUID.test(source.deliveryLinkId) && DIGEST.test(source.deliveryLinkDigest))) throw new Error('delivery link');
    if (!response && (source.deliveryLinkId !== null || source.deliveryLinkDigest !== null || source.eventIdentityId !== estimate.customerEstimateVersionId ||
        source.eventIdentityDigest !== estimate.customerEstimateVersionDigest || source.sourceRevision !== estimate.revision)) throw new Error('version event');
    if (input.requestedStateId === 'revision' && estimate.revision < contract.stateAuthorityContract.revisionLineageRule.minimumRevisedVersionRevision) throw new Error('initial issue is not revision');
  }

  if (!DIGEST.test(input.materialDigest) || !DIGEST.test(input.idempotencyKeyDigest) || !DIGEST.test(input.requestDigest) || utcMicros(input.evaluatedAt) === null ||
      input.materialDigest !== hash(materialOf(input)) || input.idempotencyKeyDigest !== hash({namespace: 'mission28.part9c.estimate-quote-followup-idempotency.v1', material: idempotencyMaterialOf(input)}) ||
      input.requestDigest !== hash(requestOf(input))) throw new Error('digest');
  return item;
}

function project(input, trusted) {
  const item = validate(input, trusted); const available = item.currentSourceAvailability === 'accepted_upstream_fact_only';
  const resultStates = contract.decisionContract.acceptedSourceResultStates;
  return Object.freeze({
    followupResolutionId: input.followupResolutionId, tenantId: input.tenantId, estimateId: input.estimateBinding.estimateId,
    customerEstimateVersionId: input.estimateBinding.customerEstimateVersionId, requestedStateId: input.requestedStateId,
    resolvedStateId: available ? input.requestedStateId : null, sourceAvailabilityState: item.currentSourceAvailability,
    resultState: available ? resultStates[input.requestedStateId] : contract.decisionContract.unavailableSourceResultState,
    reasonCode: available ? `exact_${input.requestedStateId}_upstream_fact_no_effect` : `${input.requestedStateId}_source_unavailable`,
    labelId: `estimate_quote_followup_${input.requestedStateId}`, fixedLabel: item.fixedLabel,
    supportedCustomerActionId: available ? item.supportedCustomerActionId : null,
    customerActionInvitationState: contract.decisionContract.customerActionInvitationState, silenceState: contract.decisionContract.silenceState,
    expirationState: input.requestedStateId === 'expired' && available ? 'exact_source_owned_expiry_no_extension' : 'no_new_or_extended_expiration',
    termsExtensionState: contract.decisionContract.termsExtensionState, urgencyState: contract.decisionContract.urgencyState,
    messageCreated: false, customerActionInvitationCreated: false, providerAttemptCreated: false, externalEffectCreated: false,
    priceMutated: false, scopeMutated: false, termsMutated: false
  });
}

class History {
  constructor() { this.byId = new Map(); this.byStable = new Map(); }
  record(input, trusted) {
    const result = project(input, trusted); const previous = this.byId.get(input.followupResolutionId);
    if (previous) { if (previous.requestDigest !== input.requestDigest) throw new Error('identity conflict'); return Object.freeze({...previous, replayed: true}); }
    if (this.byStable.has(input.idempotencyKeyDigest)) throw new Error('clone');
    const stored = Object.freeze({...result, requestDigest: input.requestDigest, materialDigest: input.materialDigest, idempotencyKeyDigest: input.idempotencyKeyDigest, replayed: false});
    this.byId.set(input.followupResolutionId, stored); this.byStable.set(input.idempotencyKeyDigest, input.followupResolutionId); return stored;
  }
}

describe('Mission 28 Part 9C exact-current estimate quote follow-up', () => {
  test('binds exact Part9B release provenance and frozen source contracts', () => {
    expect(contract.authority).toMatchObject({part: '9C', state: 'implementation_candidate_only', baselineCommit: '94d3d0494e975b615c8a7ff0b1a0dd0c9c7772c3', baselineTree: '7172b89771e1f6157663b3af63f51ac06de5f745'});
    expect(contract.part9BRelease).toMatchObject({acceptedSourceHead: 'a964822bdabb3835d4dfcdd9760f89ac16af8813', pullRequest: 586, deployment: '527aa9cb-cadb-444c-a657-55e630dbeb62', imageSha256: 'efc0f8a03b7f6004dbc1ab0759a670a43633e44e9938fdbe5f64fb36d5e401b8'});
    for (const item of contract.frozenInputs) expect(digestLf(item.path)).toBe(item.normalizedLfSha256);
  });

  test('freezes exactly seven ordered states with truthful current source availability', () => {
    expect(contract.stateCatalog.map(item => item.stateId)).toEqual(contract.stateAuthorityContract.closedOrder);
    expect(contract.stateAuthorityContract.supportedCurrentSourceStates).toEqual(['expired', 'accepted', 'question', 'revision']);
    expect(contract.stateAuthorityContract.unavailableCurrentSourceStates).toEqual(['sent', 'expiring', 'declined']);
    expect(contract.stateCatalog).toHaveLength(7);
  });

  test('projects accepted upstream facts as owner-readable truth with zero effect', () => {
    for (const stateId of ['expired', 'accepted', 'question', 'revision']) {
      const input = fixture(stateId); const result = project(input, copy(input));
      expect(result.resolvedStateId).toBe(stateId); expect(result.sourceAvailabilityState).toBe('accepted_upstream_fact_only');
      expect(result.supportedCustomerActionId).toBe(contract.stateCatalog.find(item => item.stateId === stateId).supportedCustomerActionId);
      for (const key of ['messageCreated', 'customerActionInvitationCreated', 'providerAttemptCreated', 'externalEffectCreated', 'priceMutated', 'scopeMutated', 'termsMutated']) expect(result[key]).toBe(false);
    }
  });

  test('keeps sent expiring and declined unavailable without fabricating state or action', () => {
    for (const stateId of ['sent', 'expiring', 'declined']) {
      const input = fixture(stateId); const result = project(input, copy(input));
      expect(result).toMatchObject({requestedStateId: stateId, resolvedStateId: null, resultState: 'followup_unavailable_no_accepted_source_no_effect', supportedCustomerActionId: null, customerActionInvitationCreated: false});
    }
  });

  test('binds every supported state to the exact Part4A trigger event and source selector', () => {
    for (const stateId of ['expired', 'accepted', 'question', 'revision']) {
      const input = fixture(stateId); const item = contract.stateCatalog.find(entry => entry.stateId === stateId);
      expect(input.sourceStateBinding).toMatchObject({triggerId: item.triggerId, eventKind: item.eventKind, availabilityState: 'accepted_upstream_fact_only'});
      for (const mutation of [value => { value.sourceStateBinding.triggerId = 'm20.lead_contact_state'; },
        value => { value.sourceStateBinding.eventKind = stateId === 'accepted' ? 'delivery_link_expired' : 'customer_accepted'; },
        value => { value.sourceStateBinding.sourceState = stateId === 'accepted' ? 'expired' : 'accepted'; }, value => { value.sourceStateBinding.stateId = 'sent'; },
        value => { value.sourceStateBinding.currentnessState = 'stale'; }, ...(stateId === 'revision' ? [value => { value.sourceStateBinding.sourceRevision += 1; }] : [])]) {
        const candidate = fixture(stateId); mutation(candidate); seal(candidate); expect(() => project(candidate, copy(candidate))).toThrow();
      }
    }
  });

  test('accepts only a later issued version as revision and denies the initial revision-one issue', () => {
    const later = fixture('revision'); later.estimateBinding.revision = 2; later.sourceStateBinding.sourceRevision = 2; seal(later);
    expect(project(later, copy(later))).toMatchObject({resolvedStateId: 'revision', fixedLabel: 'Estimate revision ready for owner review'});
    const initial = fixture('revision'); initial.estimateBinding.revision = 1; initial.sourceStateBinding.sourceRevision = 1; seal(initial);
    expect(() => project(initial, copy(initial))).toThrow('initial issue is not revision');
    expect(contract.stateAuthorityContract.revisionLineageRule).toMatchObject({firstIssuedRevision: 1, minimumRevisedVersionRevision: 2,
      predecessorDigestClaim: 'not_claimed_because_the_frozen_Part4A_trigger_binding_does_not_expose_a_predecessor_digest'});
  });

  test('denies invented authority for unavailable states and silence aliases', () => {
    for (const stateId of ['sent', 'expiring', 'declined']) {
      const candidate = fixture(stateId); candidate.sourceStateBinding.triggerId = 'm24.customer_quote_response_state'; candidate.sourceStateBinding.eventKind = 'customer_accepted';
      candidate.sourceStateBinding.sourceState = 'accepted'; candidate.sourceStateBinding.eventTime = '2026-10-28T12:00:00.000000Z'; candidate.sourceStateBinding.eventIdentityId = uuid(99); candidate.sourceStateBinding.eventIdentityDigest = digest(99);
      candidate.sourceStateBinding.sourceRevision = 1; candidate.sourceStateBinding.snapshotId = uuid(98); candidate.sourceStateBinding.snapshotDigest = digest(98);
      candidate.sourceStateBinding.recordIdentityDigest = digest(97); candidate.sourceStateBinding.sourceSetDigest = digest(96); candidate.sourceStateBinding.currentnessResolutionId = uuid(95);
      candidate.sourceStateBinding.currentnessResolutionDigest = digest(95); candidate.sourceStateBinding.currentnessState = 'latest_exact_current'; candidate.sourceStateBinding.observedAt = '2026-10-28T12:04:00.000000Z'; seal(candidate);
      expect(() => project(candidate, copy(candidate))).toThrow('unavailable source');
    }
    const silence = fixture(); silence.requestedStateId = 'silence'; silence.sourceStateBinding.stateId = 'silence'; seal(silence); expect(() => project(silence, copy(silence))).toThrow('state');
  });

  test('denies cross-tenant cross-estimate version digest actor and boundary retargeting', () => {
    for (const mutation of [value => { value.tenantId = uuid(99); }, value => { value.sourceStateBinding.tenantId = uuid(99); }, value => { value.sourceStateBinding.estimateId = uuid(99); },
      value => { value.sourceStateBinding.customerEstimateVersionId = uuid(99); }, value => { value.sourceStateBinding.documentDigest = digest(99); }, value => { value.estimateBinding.revision = 0; },
      value => { value.actorAuthorityBinding.membershipTenantId = uuid(99); }, value => { value.actorAuthorityBinding.sessionSubjectActorId = uuid(99); }, value => { value.actorAuthorityBinding.actorState = 'suspended'; },
      value => { value.part9BBoundaryBinding.contractDigest = digest(99); }, value => { value.part9BBoundaryBinding.externalChannelState = 'available'; }, value => { value.part9BBoundaryBinding.silenceState = 'accepted'; }]) {
      const candidate = fixture(); mutation(candidate); seal(candidate); expect(() => project(candidate, copy(candidate))).toThrow();
    }
  });

  test('enforces exact event observation evaluation order and bounded currentness', () => {
    const threshold = fixture(); threshold.sourceStateBinding.observedAt = '2026-10-28T12:00:00.000000Z'; threshold.sourceStateBinding.eventTime = '2026-10-28T12:00:00.000000Z'; seal(threshold);
    expect(project(threshold, copy(threshold)).resolvedStateId).toBe('revision');
    for (const mutation of [value => { value.sourceStateBinding.observedAt = '2026-10-28T11:59:59.999999Z'; }, value => { value.sourceStateBinding.observedAt = '2026-10-28T12:06:00.000000Z'; },
      value => { value.sourceStateBinding.eventTime = '2026-10-28T12:04:00.000001Z'; }, value => { value.sourceStateBinding.eventTime = 'not-time'; }]) {
      const candidate = fixture(); mutation(candidate); seal(candidate); expect(() => project(candidate, copy(candidate))).toThrow('source time');
    }
  });

  test('never extends terms changes price or scope fabricates urgency or treats silence as acceptance', () => {
    const accepted = project(fixture('accepted'), fixture('accepted'));
    expect(accepted).toMatchObject({resultState: 'terminal_followup_stopped_no_effect', silenceState: 'not_evidence', termsExtensionState: 'forbidden_none', urgencyState: 'forbidden_none'});
    for (const mutation of [value => { value.price = '999999'; }, value => { value.scope = 'extra work'; }, value => { value.extendedExpiresAt = '2027-01-01T00:00:00.000000Z'; },
      value => { value.urgent = true; }, value => { value.silenceMeans = 'accepted'; }, value => { value.message = 'Act now'; }, value => { value.customerEmail = 'customer@example.test'; }]) {
      const candidate = fixture(); mutation(candidate); seal(candidate); expect(() => project(candidate, copy(candidate))).toThrow('keys');
    }
  });

  test('uses only closed nonreflective labels and never copies legacy private material', () => {
    for (const item of contract.stateCatalog) expect(item.fixedLabel).not.toMatch(/@|phone|token|sk_|customerName|question text|act now|urgent/i);
    expect(contract.stateAuthorityContract.legacyBoundary).toMatch(/never_copied|never copied/i);
    for (const mutation of [value => { value.sourceStateBinding.questionText = 'Please call 555-0100'; }, value => { value.sourceStateBinding.token = 'secret'; },
      value => { value.sourceStateBinding.customerName = 'Customer'; }, value => { value.sourceStateBinding.responseBody = {accepted: true}; }]) {
      const candidate = fixture('question'); mutation(candidate); seal(candidate); expect(() => project(candidate, copy(candidate))).toThrow('keys');
    }
  });

  test('keeps stable semantic idempotency and immutable no-effect replay', () => {
    const history = new History(); const first = fixture('revision'); expect(history.record(first, copy(first)).replayed).toBe(false); expect(history.record(copy(first), copy(first)).replayed).toBe(true);
    const clone = copy(first); clone.followupResolutionId = uuid(99); clone.evaluatedAt = '2026-10-28T12:08:00.000000Z'; seal(clone);
    expect(clone.idempotencyKeyDigest).toBe(first.idempotencyKeyDigest); expect(clone.materialDigest).not.toBe(first.materialDigest); expect(() => history.record(clone, copy(clone))).toThrow('clone');
    const conflict = copy(first); conflict.evaluatedAt = '2026-10-28T12:08:00.000000Z'; seal(conflict);
    expect(() => history.record(conflict, copy(conflict))).toThrow('identity conflict');
  });

  test('rejects unknown missing accessor symbol proxy toJSON custom-prototype sparse and alias data before hooks', () => {
    for (const mutation of [value => { value.extra = 'x'; }, value => { delete value.requestDigest; }, value => { value.sourceStateBinding.toJSON = () => ({}); },
      value => { Object.setPrototypeOf(value.estimateBinding, {}); }, value => { value.actorAuthorityBinding = value.sourceStateBinding; }]) {
      const candidate = fixture(); mutation(candidate); expect(() => project(candidate, fixture())).toThrow();
    }
    let getters = 0; const accessor = fixture(); Object.defineProperty(accessor.sourceStateBinding, 'stateId', {enumerable: true, get() { getters += 1; return 'revision'; }}); expect(() => project(accessor, fixture())).toThrow(); expect(getters).toBe(0);
    const symbol = fixture(); symbol[Symbol('secret')] = 'sk_secret'; expect(() => project(symbol, fixture())).toThrow();
    let traps = 0; const proxy = new Proxy(fixture(), {get() { traps += 1; throw new Error('trap'); }, ownKeys() { traps += 1; throw new Error('trap'); }}); expect(() => project(proxy, fixture())).toThrow(); expect(traps).toBe(0);
    const sparse = fixture(); sparse.extraArray = []; sparse.extraArray[1] = 'x'; expect(() => project(sparse, fixture())).toThrow();
  });

  test('freezes docs-tests-only zero-effect boundary with migration287 latest and no288', () => {
    expect(Object.values(contract.privacyAndEffects).every(value => value === 0)).toBe(true);
    expect(contract.runtimeBoundary).toMatchObject({newMigration: false, newTableFunctionRouteOrUi: false, mountedSchedulerWorkerQueueOrPolicyExecutor: false, providerAdapterCallbackOrInboundReceiver: false, externalEffectOrUpstreamMutation: false, nextMigrationAbsent: '288'});
    const migrations = fs.readdirSync(path.join(ROOT, 'migrations')).filter(name => /^\d+_/.test(name)).sort(); expect(migrations.at(-1)).toBe('287_canonical_automation_estimate_quote_resolution_v1.sql'); expect(migrations.some(name => name.startsWith('288_'))).toBe(false);
  });

  test('roadmap and ledger record Part9B released Part9C candidate only and Part9D+ planned', () => {
    const roadmap = fs.readFileSync(ROADMAP, 'utf8'); const ledger = fs.readFileSync(LEDGER, 'utf8'); const markdown = fs.readFileSync(CONTRACT_MD, 'utf8');
    for (const document of [roadmap, ledger]) {
      expect(document).toContain('Parts 1A–10C are released. Part 10D is the sole implementation candidate.'); expect(document).toContain('Parts 11A–14G remain planned and unimplemented.');
      expect(document).toContain('527aa9cb-cadb-444c-a657-55e630dbeb62'); expect(document).toContain('sha256:efc0f8a03b7f6004dbc1ab0759a670a43633e44e9938fdbe5f64fb36d5e401b8');
    }
    expect(ledger).toContain('| 38 | 9B | Bounded contact-attempt and response-follow-up cadence | **Released** |'); expect(ledger).toContain('| 39 | 9C | Exact-current estimate/quote follow-up | **Released** |'); expect(ledger).toContain('| 40 | 9D | Explicitly reviewed customer re-engagement boundary | **Released** |');
    expect((ledger.match(/\*\*Implementation candidate\*\*/g) || [])).toHaveLength(1); expect((ledger.match(/Planned \/ unimplemented/g) || [])).toHaveLength(22); expect(markdown).toContain('No migration 288');
  });
});
