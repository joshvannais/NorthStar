'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {types: {isProxy}} = require('util');

const ROOT = path.resolve(__dirname, '../..');
const CONTRACT_PATH = path.join(ROOT, 'docs/architecture/MISSION_28_PART9D_CUSTOMER_REENGAGEMENT_BOUNDARY_CONTRACT.json');
const CONTRACT_MD = path.join(ROOT, 'docs/architecture/MISSION_28_PART9D_CUSTOMER_REENGAGEMENT_BOUNDARY_CONTRACT.md');
const ROADMAP = path.join(ROOT, 'docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md');
const LEDGER = path.join(ROOT, 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md');
const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8'));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
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
    if (proto !== Array.prototype || keys.some(key => key !== 'length' && !/^(0|[1-9][0-9]*)$/.test(key)) || keys.filter(key => key !== 'length').length !== value.length) throw new Error('dense array');
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

function utcMicros(value) {
  const match = typeof value === 'string' ? /^([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2})\.([0-9]{6})Z$/.exec(value) : null;
  if (!match) return null;
  const millisecondForm = `${match[1]}.${match[2].slice(0, 3)}Z`; const millis = Date.parse(millisecondForm);
  if (!Number.isFinite(millis) || new Date(millis).toISOString() !== millisecondForm) return null;
  return BigInt(millis) * 1000n + BigInt(match[2].slice(3));
}

function materialOf(input) { const value = copy(input); delete value.resolutionId; delete value.materialDigest; delete value.idempotencyKeyDigest; delete value.requestDigest; return value; }
function idempotencyMaterialOf(input) { const value = materialOf(input); delete value.evaluatedAt; return value; }
function requestOf(input) { const value = copy(input); delete value.materialDigest; delete value.idempotencyKeyDigest; delete value.requestDigest; return value; }
function seal(input) {
  input.materialDigest = hash(materialOf(input));
  input.idempotencyKeyDigest = hash({namespace: 'mission28.part9d.customer-reengagement-boundary-idempotency.v1', material: idempotencyMaterialOf(input)});
  input.requestDigest = hash(requestOf(input)); return input;
}

function fixture(requestedKind = 'customer_reengagement') {
  return seal({
    schemaVersion: contract.contractVersion, tenantId: uuid(1), resolutionId: uuid(2), requestedKind,
    relationshipBinding: {tenantId: uuid(1), recipientResolutionId: uuid(10), recipientResolutionDigest: digest(10), recipientClassId: 'customer', sourceTriggerId: 'm20.lead_contact_state', canonicalGraphId: uuid(11), customerId: uuid(12), opportunityId: uuid(13), sourceVersion: 4, projectionDigest: digest(11), snapshotId: uuid(14), snapshotDigest: digest(14), sourceSetDigest: digest(15), currentnessResolutionId: uuid(16), currentnessResolutionDigest: digest(16), currentnessState: 'latest_exact_current', observedAt: '2026-10-29T12:04:00.000000Z'},
    launchMatrixBinding: {contractDigest: digestLf('docs/architecture/MISSION_28_PART1D_FIRST_LAUNCH_MATRIX.json').toLowerCase().replace(/^/, 'sha256:'), actionFamily: 'customer_communication', firstLaunchState: 'unavailable', acceptedSourceClassCount: 0, acceptedRoleCount: 0, acceptedCapabilityCount: 0, acceptedChannelCount: 0, acceptedRecipientClassCount: 0, externalEffectsEnabled: false},
    communicationBasisBinding: {contractDigest: digestLf('docs/architecture/MISSION_28_PART7B_COMMUNICATION_PERMISSION_CONTRACT.json').toLowerCase().replace(/^/, 'sha256:'), externalResult: 'always_unavailable_or_suppressed_until_a_later_explicitly_accepted_launch_matrix_legal_provider_channel_and_effect_authority', permissionResolutionId: null, permissionResolutionDigest: null, permissionBasisState: 'unavailable_no_accepted_external_basis', channelId: null, providerMode: 'provider_disabled'},
    policyAuthorityBinding: {contractDigest: digestLf('docs/architecture/MISSION_28_PART2A_CANONICAL_AUTOMATION_POLICY.json').toLowerCase().replace(/^/, 'sha256:'), policyId: null, policyVersion: null, policyDigest: null, authorizationRecordId: null, authorizationRecordDigest: null, authorityState: 'unavailable_no_accepted_reengagement_or_service_followup_policy'},
    suppressionBoundaryBinding: {part5DContractDigest: digestLf('docs/architecture/MISSION_28_PART5D_COLLISION_SUPPRESSION_DRY_RUN_CONTRACT.json').toLowerCase().replace(/^/, 'sha256:'), part9BContractDigest: digestLf('docs/architecture/MISSION_28_PART9B_CONTACT_FOLLOWUP_CADENCE_CONTRACT.json').toLowerCase().replace(/^/, 'sha256:'), suppressionResolutionId: null, suppressionResolutionDigest: null, cadenceResolutionId: null, cadenceResolutionDigest: null, authorityState: 'not_evaluated_because_launch_basis_and_policy_unavailable'},
    actorAuthorityBinding: {actorId: uuid(20), sessionId: uuid(21), membershipId: uuid(22), sessionSubjectActorId: uuid(20), membershipSubjectActorId: uuid(20), actorTenantId: uuid(1), sessionTenantId: uuid(1), membershipTenantId: uuid(1), actorState: 'active', sessionState: 'active', membershipState: 'active', membershipRoleId: 'owner', capabilityId: 'automation_internal_action_view', capabilityDecisionId: uuid(23), capabilityDecisionDigest: digest(23)},
    evaluatedAt: '2026-10-29T12:05:00.000000Z', materialDigest: '', idempotencyKeyDigest: '', requestDigest: ''
  });
}

function validate(input, trusted) {
  dataGate(input); dataGate(trusted);
  if (JSON.stringify(input) !== JSON.stringify(trusted)) throw new Error('trusted resolution');
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > contract.bounds.maximumCanonicalRequestBytes) throw new Error('request size');
  exactKeys(input, contract.resolutionEnvelope.exactFields); exactKeys(input.relationshipBinding, contract.resolutionEnvelope.relationshipBindingExactFields);
  exactKeys(input.launchMatrixBinding, contract.resolutionEnvelope.launchMatrixBindingExactFields); exactKeys(input.communicationBasisBinding, contract.resolutionEnvelope.communicationBasisBindingExactFields);
  exactKeys(input.policyAuthorityBinding, contract.resolutionEnvelope.policyAuthorityBindingExactFields); exactKeys(input.suppressionBoundaryBinding, contract.resolutionEnvelope.suppressionBoundaryBindingExactFields);
  exactKeys(input.actorAuthorityBinding, contract.resolutionEnvelope.actorAuthorityBindingExactFields);
  if (input.schemaVersion !== contract.contractVersion || !UUID.test(input.tenantId) || !UUID.test(input.resolutionId)) throw new Error('root identity');
  const kind = contract.requestKinds.find(item => item.id === input.requestedKind); if (!kind) throw new Error('request kind');

  const relationship = input.relationshipBinding;
  if (relationship.tenantId !== input.tenantId || relationship.recipientClassId !== 'customer' || relationship.sourceTriggerId !== 'm20.lead_contact_state' ||
      [relationship.recipientResolutionId, relationship.canonicalGraphId, relationship.customerId, relationship.opportunityId, relationship.snapshotId, relationship.currentnessResolutionId].some(value => !UUID.test(value)) ||
      [relationship.recipientResolutionDigest, relationship.projectionDigest, relationship.snapshotDigest, relationship.sourceSetDigest, relationship.currentnessResolutionDigest].some(value => !DIGEST.test(value)) ||
      !Number.isSafeInteger(relationship.sourceVersion) || relationship.sourceVersion < 1 || relationship.currentnessState !== 'latest_exact_current') throw new Error('relationship');
  const observedAt = utcMicros(relationship.observedAt); const evaluatedAt = utcMicros(input.evaluatedAt);
  if (observedAt === null || evaluatedAt === null || observedAt > evaluatedAt || evaluatedAt - observedAt > BigInt(contract.bounds.maximumRelationshipObservationAgeSeconds) * 1000000n) throw new Error('relationship currentness');

  const launch = input.launchMatrixBinding;
  if (launch.contractDigest !== `sha256:${contract.frozenInputs.find(item => item.path.endsWith('PART1D_FIRST_LAUNCH_MATRIX.json')).normalizedLfSha256.toLowerCase()}` || launch.actionFamily !== 'customer_communication' || launch.firstLaunchState !== 'unavailable' ||
      [launch.acceptedSourceClassCount, launch.acceptedRoleCount, launch.acceptedCapabilityCount, launch.acceptedChannelCount, launch.acceptedRecipientClassCount].some(value => value !== 0) || launch.externalEffectsEnabled !== false) throw new Error('launch matrix');
  const basis = input.communicationBasisBinding;
  if (basis.contractDigest !== `sha256:${contract.frozenInputs.find(item => item.path.endsWith('PART7B_COMMUNICATION_PERMISSION_CONTRACT.json')).normalizedLfSha256.toLowerCase()}` || basis.externalResult !== 'always_unavailable_or_suppressed_until_a_later_explicitly_accepted_launch_matrix_legal_provider_channel_and_effect_authority' ||
      basis.permissionResolutionId !== null || basis.permissionResolutionDigest !== null || basis.permissionBasisState !== 'unavailable_no_accepted_external_basis' || basis.channelId !== null || basis.providerMode !== 'provider_disabled') throw new Error('communication basis');
  const policy = input.policyAuthorityBinding;
  if (policy.contractDigest !== `sha256:${contract.frozenInputs.find(item => item.path.endsWith('PART2A_CANONICAL_AUTOMATION_POLICY.json')).normalizedLfSha256.toLowerCase()}` ||
      [policy.policyId, policy.policyVersion, policy.policyDigest, policy.authorizationRecordId, policy.authorizationRecordDigest].some(value => value !== null) || policy.authorityState !== 'unavailable_no_accepted_reengagement_or_service_followup_policy') throw new Error('policy authority');
  const suppression = input.suppressionBoundaryBinding;
  if (suppression.part5DContractDigest !== `sha256:${contract.frozenInputs.find(item => item.path.endsWith('PART5D_COLLISION_SUPPRESSION_DRY_RUN_CONTRACT.json')).normalizedLfSha256.toLowerCase()}` ||
      suppression.part9BContractDigest !== `sha256:${contract.frozenInputs.find(item => item.path.endsWith('PART9B_CONTACT_FOLLOWUP_CADENCE_CONTRACT.json')).normalizedLfSha256.toLowerCase()}` ||
      [suppression.suppressionResolutionId, suppression.suppressionResolutionDigest, suppression.cadenceResolutionId, suppression.cadenceResolutionDigest].some(value => value !== null) || suppression.authorityState !== 'not_evaluated_because_launch_basis_and_policy_unavailable') throw new Error('suppression boundary');
  const actor = input.actorAuthorityBinding;
  if ([actor.actorId, actor.sessionId, actor.membershipId, actor.sessionSubjectActorId, actor.membershipSubjectActorId, actor.actorTenantId, actor.sessionTenantId, actor.membershipTenantId, actor.capabilityDecisionId].some(value => !UUID.test(value)) ||
      !DIGEST.test(actor.capabilityDecisionDigest) || actor.actorId !== actor.sessionSubjectActorId || actor.actorId !== actor.membershipSubjectActorId ||
      [actor.actorTenantId, actor.sessionTenantId, actor.membershipTenantId].some(value => value !== input.tenantId) || [actor.actorState, actor.sessionState, actor.membershipState].some(value => value !== 'active') ||
      actor.membershipRoleId !== 'owner' || actor.capabilityId !== 'automation_internal_action_view') throw new Error('actor');
  if (!DIGEST.test(input.materialDigest) || !DIGEST.test(input.idempotencyKeyDigest) || !DIGEST.test(input.requestDigest) ||
      input.materialDigest !== hash(materialOf(input)) || input.idempotencyKeyDigest !== hash({namespace: 'mission28.part9d.customer-reengagement-boundary-idempotency.v1', material: idempotencyMaterialOf(input)}) || input.requestDigest !== hash(requestOf(input))) throw new Error('digest');
  return kind;
}

function project(input, trusted) {
  const kind = validate(input, trusted);
  return Object.freeze({resolutionId: input.resolutionId, tenantId: input.tenantId, requestedKind: input.requestedKind, recipientClassId: 'customer', relationshipCurrentnessState: 'latest_exact_current', resultState: kind.resultState, reasonCode: kind.reasonCode, labelId: `customer_reengagement_boundary_${kind.id}`, fixedLabel: kind.fixedLabel,
    launchAuthorityState: 'unavailable', communicationBasisState: 'unavailable', policyAuthorityState: 'unavailable', suppressionAuthorityState: 'not_evaluated_no_authority', ownerReadableProjectionOnly: true,
    ownerWorklistRecordCreated: false, taskCreated: false, notificationCreated: false, messageCreated: false, providerAttemptCreated: false, externalEffectCreated: false, upstreamMutationCreated: false, moneyEffectCreated: false});
}

class History {
  constructor() { this.byId = new Map(); this.byStable = new Map(); }
  record(input, trusted) {
    const output = project(input, trusted); const previous = this.byId.get(input.resolutionId);
    if (previous) { if (previous.requestDigest !== input.requestDigest) throw new Error('identity conflict'); return Object.freeze({...previous, replayed: true}); }
    if (this.byStable.has(input.idempotencyKeyDigest)) throw new Error('clone');
    const stored = Object.freeze({...output, requestDigest: input.requestDigest, materialDigest: input.materialDigest, idempotencyKeyDigest: input.idempotencyKeyDigest, replayed: false});
    this.byId.set(input.resolutionId, stored); this.byStable.set(input.idempotencyKeyDigest, input.resolutionId); return stored;
  }
}

describe('Mission 28 Part 9D customer re-engagement boundary', () => {
  test('binds exact Part9C release provenance and all controlling frozen contracts', () => {
    expect(contract.authority).toMatchObject({part: '9D', state: 'implementation_candidate_only', baselineCommit: '37818006a02b4d51821734f6876865125ea96a02', baselineTree: '5e6ebcac8ccc6ac11c6c1bef8d858d2c3d92230c'});
    expect(contract.part9CRelease).toMatchObject({acceptedSourceHead: '16c07e94f472cc22212ec57ec33a85c51bfe76de', pullRequest: 587, deployment: '6fa2248f-ff14-4bae-8815-10842b4a9d3d', imageSha256: 'b72b28a34816a3f278c5056b93aa094537fe48dd1567bcb5e3bfbd4c26e3cabf'});
    for (const item of contract.frozenInputs) expect(digestLf(item.path)).toBe(item.normalizedLfSha256);
  });

  test('freezes exactly two conditional and four explicitly unavailable request kinds', () => {
    expect(contract.requestKinds.map(item => item.id)).toEqual(contract.decisionContract.closedKindOrder);
    expect(contract.decisionContract.conditionalKinds).toEqual(['customer_reengagement', 'service_followup']);
    expect(contract.decisionContract.explicitlyUnavailableKinds).toEqual(['marketing_like_outreach', 'referral_request', 'review_request', 'long_dormant_outreach']);
  });

  test('keeps customer reengagement and service followup unavailable despite an exact current customer relationship', () => {
    for (const requestedKind of contract.decisionContract.conditionalKinds) {
      const input = fixture(requestedKind); const output = project(input, copy(input));
      expect(output).toMatchObject({requestedKind, recipientClassId: 'customer', relationshipCurrentnessState: 'latest_exact_current', resultState: 'unavailable_no_accepted_external_authority', ownerReadableProjectionOnly: true, messageCreated: false, externalEffectCreated: false});
    }
  });

  test('keeps marketing referral review-request and long-dormant outreach explicitly unavailable', () => {
    for (const requestedKind of contract.decisionContract.explicitlyUnavailableKinds) {
      const output = project(fixture(requestedKind), fixture(requestedKind));
      expect(output).toMatchObject({requestedKind, resultState: 'unavailable_unsupported_outreach', reasonCode: `${requestedKind}_unavailable`, ownerReadableProjectionOnly: true});
    }
  });

  test('denies unknown request kinds and cross-kind retargeting', () => {
    const unknown = fixture(); unknown.requestedKind = 'winback_campaign'; seal(unknown); expect(() => project(unknown, copy(unknown))).toThrow('request kind');
    const candidate = fixture('service_followup'); const trusted = copy(candidate); candidate.requestedKind = 'customer_reengagement'; seal(candidate); expect(() => project(candidate, trusted)).toThrow('trusted resolution');
  });

  test('denies cross-tenant noncustomer stale mixed and substituted relationship authority', () => {
    for (const mutation of [value => { value.relationshipBinding.tenantId = uuid(99); }, value => { value.relationshipBinding.recipientClassId = 'lead_or_prospect'; },
      value => { value.relationshipBinding.sourceTriggerId = 'm23.work_completion_reopening_state'; }, value => { value.relationshipBinding.currentnessState = 'stale'; },
      value => { value.relationshipBinding.recipientResolutionDigest = 'not-a-digest'; }, value => { value.relationshipBinding.sourceVersion = 0; }]) {
      const candidate = fixture(); mutation(candidate); seal(candidate); expect(() => project(candidate, copy(candidate))).toThrow('relationship');
    }
    const substituted = fixture(); const trusted = copy(substituted); substituted.relationshipBinding.recipientResolutionDigest = digest(99); seal(substituted); expect(() => project(substituted, trusted)).toThrow('trusted resolution');
  });

  test('enforces bounded trusted relationship observation time without treating time as permission', () => {
    const threshold = fixture(); threshold.relationshipBinding.observedAt = '2026-10-29T12:00:00.000000Z'; seal(threshold); expect(project(threshold, copy(threshold)).resultState).toBe('unavailable_no_accepted_external_authority');
    for (const observedAt of ['2026-10-29T11:59:59.999999Z', '2026-10-29T12:05:00.000001Z', 'not-time']) {
      const candidate = fixture(); candidate.relationshipBinding.observedAt = observedAt; seal(candidate); expect(() => project(candidate, copy(candidate))).toThrow('relationship currentness');
    }
  });

  test('denies launch-matrix widening and candidate-created communication basis', () => {
    for (const mutation of [value => { value.launchMatrixBinding.firstLaunchState = 'conditional'; }, value => { value.launchMatrixBinding.acceptedSourceClassCount = 1; },
      value => { value.launchMatrixBinding.acceptedChannelCount = 1; }, value => { value.launchMatrixBinding.externalEffectsEnabled = true; },
      value => { value.communicationBasisBinding.permissionResolutionId = uuid(40); }, value => { value.communicationBasisBinding.permissionResolutionDigest = digest(40); },
      value => { value.communicationBasisBinding.permissionBasisState = 'owner_reviewed_reported_basis_unverified'; }, value => { value.communicationBasisBinding.channelId = 'email'; }]) {
      const candidate = fixture(); mutation(candidate); seal(candidate); expect(() => project(candidate, copy(candidate))).toThrow();
    }
  });

  test('denies self-created policy authorization suppression or cadence authority', () => {
    for (const mutation of [value => { value.policyAuthorityBinding.policyId = uuid(50); }, value => { value.policyAuthorityBinding.policyVersion = 1; },
      value => { value.policyAuthorityBinding.authorizationRecordDigest = digest(50); }, value => { value.suppressionBoundaryBinding.suppressionResolutionId = uuid(51); },
      value => { value.suppressionBoundaryBinding.suppressionResolutionDigest = digest(51); }, value => { value.suppressionBoundaryBinding.cadenceResolutionId = uuid(52); },
      value => { value.suppressionBoundaryBinding.authorityState = 'clear'; }]) {
      const candidate = fixture(); mutation(candidate); seal(candidate); expect(() => project(candidate, copy(candidate))).toThrow();
    }
  });

  test('denies elapsed-time silence prior-purchase and invented outreach material', () => {
    for (const mutation of [value => { value.dormancyDays = 365; }, value => { value.silenceMeans = 'interest'; }, value => { value.priorPurchaseMeans = 'permission'; },
      value => { value.offer = '20 percent off'; }, value => { value.reviewRatingRequested = 5; }, value => { value.referralReward = 'credit'; },
      value => { value.customerEmail = 'customer@example.test'; }, value => { value.message = 'We miss you'; }]) {
      const candidate = fixture(); mutation(candidate); seal(candidate); expect(() => project(candidate, copy(candidate))).toThrow('keys');
    }
    expect(contract.bounds.longDormantThreshold).toBe('unavailable_not_defined_or_inferred');
  });

  test('uses only fixed nonreflective labels with zero records messages providers or effects', () => {
    for (const item of contract.requestKinds) expect(item.fixedLabel).not.toMatch(/@|phone|token|sk_|customerName|discount|urgent|review us/i);
    for (const item of contract.requestKinds) {
      const output = project(fixture(item.id), fixture(item.id));
      for (const key of ['ownerWorklistRecordCreated', 'taskCreated', 'notificationCreated', 'messageCreated', 'providerAttemptCreated', 'externalEffectCreated', 'upstreamMutationCreated', 'moneyEffectCreated']) expect(output[key]).toBe(false);
    }
  });

  test('uses stable semantic idempotency and immutable no-effect replay', () => {
    const history = new History(); const first = fixture(); expect(history.record(first, copy(first)).replayed).toBe(false); expect(history.record(copy(first), copy(first)).replayed).toBe(true);
    const clone = copy(first); clone.resolutionId = uuid(99); clone.evaluatedAt = '2026-10-29T12:08:00.000000Z'; seal(clone); expect(clone.idempotencyKeyDigest).toBe(first.idempotencyKeyDigest); expect(() => history.record(clone, copy(clone))).toThrow('clone');
    const conflict = copy(first); conflict.evaluatedAt = '2026-10-29T12:08:00.000000Z'; seal(conflict); expect(() => history.record(conflict, copy(conflict))).toThrow('identity conflict');
  });

  test('rejects extra missing accessor symbol proxy toJSON custom-prototype sparse and alias data before hooks', () => {
    for (const mutation of [value => { value.extra = 'x'; }, value => { delete value.requestDigest; }, value => { value.relationshipBinding.toJSON = () => ({}); },
      value => { Object.setPrototypeOf(value.policyAuthorityBinding, {}); }, value => { value.actorAuthorityBinding = value.relationshipBinding; }]) {
      const candidate = fixture(); mutation(candidate); expect(() => project(candidate, fixture())).toThrow();
    }
    let getters = 0; const accessor = fixture(); Object.defineProperty(accessor.relationshipBinding, 'recipientClassId', {enumerable: true, get() { getters += 1; return 'customer'; }}); expect(() => project(accessor, fixture())).toThrow(); expect(getters).toBe(0);
    const symbol = fixture(); symbol[Symbol('secret')] = 'sk_secret'; expect(() => project(symbol, fixture())).toThrow();
    let traps = 0; const proxy = new Proxy(fixture(), {get() { traps += 1; throw new Error('trap'); }, ownKeys() { traps += 1; throw new Error('trap'); }}); expect(() => project(proxy, fixture())).toThrow(); expect(traps).toBe(0);
    const sparse = fixture(); sparse.extraArray = []; sparse.extraArray[1] = 'x'; expect(() => project(sparse, fixture())).toThrow();
  });

  test('freezes docs-tests-only zero-effect boundary with migration287 latest and no288', () => {
    expect(Object.values(contract.privacyAndEffects).every(value => value === 0)).toBe(true);
    expect(contract.runtimeBoundary).toMatchObject({newMigration: false, newTableFunctionRouteOrUi: false, mountedSchedulerWorkerQueueOrPolicyExecutor: false, providerAdapterCallbackOrInboundReceiver: false, externalEffectOrUpstreamMutation: false, nextMigrationAbsent: '288'});
    const migrations = fs.readdirSync(path.join(ROOT, 'migrations')).filter(name => /^\d+_/.test(name)).sort(); expect(migrations.at(-1)).toBe('287_canonical_automation_estimate_quote_resolution_v1.sql'); expect(migrations.some(name => name.startsWith('288_'))).toBe(false);
  });

  test('roadmap and ledger record Part9C released Part9D candidate and Part10+ planned', () => {
    const roadmap = fs.readFileSync(ROADMAP, 'utf8'); const ledger = fs.readFileSync(LEDGER, 'utf8'); const markdown = fs.readFileSync(CONTRACT_MD, 'utf8');
    for (const document of [roadmap, ledger]) {
      expect(document).toContain('Parts 1A–13D are released. Part 13E is the sole implementation candidate.'); expect(document).toContain('Parts 14A–14G remain planned and unimplemented.');
      expect(document).toContain('6fa2248f-ff14-4bae-8815-10842b4a9d3d'); expect(document).toContain('sha256:b72b28a34816a3f278c5056b93aa094537fe48dd1567bcb5e3bfbd4c26e3cabf');
      expect(document).toMatch(/direct applied-history re-query was not repeated|direct applied migration-history re-query was not repeated/i);
    }
    expect(ledger).toContain('| 39 | 9C | Exact-current estimate/quote follow-up | **Released** |'); expect(ledger).toContain('| 40 | 9D | Explicitly reviewed customer re-engagement boundary | **Released** |');
    expect((ledger.match(/\*\*Implementation candidate\*\*/g) || [])).toHaveLength(1); expect((ledger.match(/Planned \/ unimplemented/g) || [])).toHaveLength(7); expect(markdown).toContain('No migration 288');
  });
});
