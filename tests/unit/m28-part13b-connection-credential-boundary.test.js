'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { types } = require('util');

const ROOT = path.resolve(__dirname, '../..');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
const contract = readJson('docs/architecture/MISSION_28_PART13B_CONNECTION_CREDENTIAL_BOUNDARY_CONTRACT.json');
const part1B = readJson('docs/architecture/MISSION_28_PART1B_SURFACE_INVENTORY.json');
const part3A = readJson('docs/architecture/MISSION_28_PART3A_FIXED_CAPABILITY_MATRIX.json');
const part7B = readJson('docs/architecture/MISSION_28_PART7B_COMMUNICATION_PERMISSION_CONTRACT.json');
const part13A = readJson('docs/architecture/MISSION_28_PART13A_PROVIDER_ADAPTER_CAPABILITY_CONTRACT.json');
const UUID = new RegExp(contract.identityGrammar.uuidPattern);
const DIGEST = new RegExp(contract.identityGrammar.digestPattern);
const OPAQUE = new RegExp(contract.identityGrammar.opaqueIdentifierPattern);
const UTC = new RegExp(contract.identityGrammar.utcInstantPattern);
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
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
  if (Object.hasOwn(descriptors, 'toJSON')) throw new Error('toJSON');
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) throw new Error('sparse');
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[index];
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error('descriptor');
      dataOnly(descriptor.value, seen);
    }
    return;
  }
  for (const descriptor of Object.values(descriptors)) {
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error('descriptor');
    dataOnly(descriptor.value, seen);
  }
}

function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) throw new Error('keys');
}

function micros(value) {
  if (typeof value !== 'string' || !UTC.test(value)) return null;
  const milliseconds = Date.parse(`${value.slice(0, 19)}Z`);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString().slice(0, 19) !== value.slice(0, 19)) return null;
  return BigInt(milliseconds) * 1000n + BigInt(value.slice(20, 26));
}

function registryBinding() {
  return {
    registryDigest: hash({adapterFamilies: part13A.adapterFamilies, channels: part13A.outboundChannelCatalog, statuses: part13A.statusMeaningCatalog}),
    part13AContractDigest: `sha256:${contract.frozenInputs.find(item => item.part === '13A').normalizedLfSha256.toLowerCase()}`,
    adapterFamilyDigest: hash(contract.adapterFamilyBindings),
    adapterState: 'disabled',
    providerMode: 'provider_disabled'
  };
}

function subjectResolution(input) {
  const value = {
    tenantId: input.tenantId,
    actorId: 'actor-100',
    actorTenantId: input.tenantId,
    sessionId: 'session-100',
    sessionSubjectActorId: 'actor-100',
    sessionTenantId: input.tenantId,
    membershipId: 'membership-100',
    membershipSubjectActorId: 'actor-100',
    membershipTenantId: input.tenantId,
    membershipRoleId: 'owner',
    membershipStatus: 'active',
    recentAuthenticationState: 'recent_authentication_exact_current',
    capabilityId: 'automation_channel_availability_manage',
    operation: 'manage_channel_availability',
    recordScope: 'exact_tenant_channel_availability',
    recordTenantId: input.tenantId,
    capabilityResolutionDigest: ''
  };
  value.capabilityResolutionDigest = hash(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'capabilityResolutionDigest')));
  return value;
}

function connectionResolution(input) {
  return {
    tenantId: input.tenantId,
    adapterFamilyId: input.adapterFamilyId,
    requestedEnvironment: input.requestedEnvironment,
    registryDigest: input.part13ARegistryBinding.registryDigest,
    ...copy(contract.currentTrustedResolution),
    observedAt: input.evaluatedAt
  };
}

function materialOf(input) { const value = copy(input); delete value.materialDigest; delete value.idempotencyKeyDigest; delete value.requestDigest; return value; }
function stableOf(input) { const value = materialOf(input); delete value.requestId; delete value.evaluatedAt; return value; }
function seal(input) { input.materialDigest = hash(materialOf(input)); input.idempotencyKeyDigest = hash(stableOf(input)); input.requestDigest = hash(materialOf(input)); return input; }

function fixture() {
  const input = {
    schemaVersion: contract.contractVersion,
    tenantId: uuid(1),
    requestId: uuid(2),
    adapterFamilyId: 'provider_neutral_email',
    requestedEnvironment: 'provider_disabled',
    requestedOperation: contract.requestEnvelope.requestedOperation,
    part13ARegistryBinding: registryBinding(),
    evaluatedAt: '2026-10-30T00:05:00.000000Z',
    materialDigest: '',
    idempotencyKeyDigest: '',
    requestDigest: ''
  };
  seal(input);
  return {
    input,
    trusted: {
      subjectResolution: subjectResolution(input),
      connectionResolution: connectionResolution(input),
      evaluatedAt: input.evaluatedAt
    }
  };
}

function validateEnvelope(input) {
  dataOnly(input);
  if (Buffer.byteLength(JSON.stringify(input)) > contract.bounds.maximumCanonicalRequestBytes) throw new Error('size');
  exactKeys(input, contract.requestEnvelope.exactFields);
  exactKeys(input.part13ARegistryBinding, contract.requestEnvelope.part13ARegistryBindingExactFields);
  if (input.schemaVersion !== contract.contractVersion || !UUID.test(input.tenantId) || !UUID.test(input.requestId) || micros(input.evaluatedAt) === null) throw new Error('identity');
  if (input.requestedOperation !== contract.requestEnvelope.requestedOperation || input.requestedEnvironment !== 'provider_disabled') throw new Error('operation or environment');
  if (!contract.adapterFamilyBindings.some(item => item.adapterFamilyId === input.adapterFamilyId)) throw new Error('adapter');
  if (![input.part13ARegistryBinding.registryDigest, input.part13ARegistryBinding.part13AContractDigest, input.part13ARegistryBinding.adapterFamilyDigest, input.materialDigest, input.idempotencyKeyDigest, input.requestDigest].every(value => DIGEST.test(value))) throw new Error('digest');
  if (hash(input.part13ARegistryBinding) !== hash(registryBinding())) throw new Error('registry');
  if (input.materialDigest !== hash(materialOf(input)) || input.requestDigest !== hash(materialOf(input)) || input.idempotencyKeyDigest !== hash(stableOf(input))) throw new Error('seal');
}

function validateSubject(subject, input) {
  exactKeys(subject, contract.requestEnvelope.subjectResolutionExactFields);
  for (const field of ['tenantId','actorId','actorTenantId','sessionId','sessionSubjectActorId','sessionTenantId','membershipId','membershipSubjectActorId','membershipTenantId','recordTenantId']) if (!OPAQUE.test(subject[field])) throw new Error('subject identity');
  if (subject.tenantId !== input.tenantId || subject.actorTenantId !== input.tenantId || subject.sessionTenantId !== input.tenantId || subject.membershipTenantId !== input.tenantId || subject.recordTenantId !== input.tenantId) throw new Error('subject tenant');
  if (subject.actorId !== subject.sessionSubjectActorId || subject.actorId !== subject.membershipSubjectActorId) throw new Error('subject actor');
  if (subject.membershipRoleId !== contract.subjectAuthority.requiredMembershipRoleId || subject.membershipStatus !== contract.subjectAuthority.requiredMembershipStatus || subject.recentAuthenticationState !== 'recent_authentication_exact_current' || subject.capabilityId !== contract.subjectAuthority.requiredCapabilityId || subject.operation !== contract.subjectAuthority.requiredOperation || subject.recordScope !== contract.subjectAuthority.requiredRecordScope) throw new Error('subject authority');
  if (!DIGEST.test(subject.capabilityResolutionDigest) || subject.capabilityResolutionDigest !== hash(Object.fromEntries(Object.entries(subject).filter(([key]) => key !== 'capabilityResolutionDigest')))) throw new Error('subject seal');
}

function validateConnection(resolution, input) {
  exactKeys(resolution, contract.requestEnvelope.connectionResolutionExactFields);
  if (resolution.tenantId !== input.tenantId || resolution.adapterFamilyId !== input.adapterFamilyId || resolution.requestedEnvironment !== input.requestedEnvironment || resolution.registryDigest !== input.part13ARegistryBinding.registryDigest || resolution.observedAt !== input.evaluatedAt) throw new Error('connection binding');
  const expected = connectionResolution(input);
  if (hash(resolution) !== hash(expected)) throw new Error('connection unavailable');
}

function validate(input, trusted) {
  validateEnvelope(input);
  dataOnly(trusted);
  exactKeys(trusted, contract.requestEnvelope.trustedResolutionExactFields);
  if (trusted.evaluatedAt !== input.evaluatedAt) throw new Error('trusted time');
  validateSubject(trusted.subjectResolution, input);
  validateConnection(trusted.connectionResolution, input);
  return true;
}

function project(input, trusted) {
  validate(input, trusted);
  return Object.freeze({
    tenantId: input.tenantId,
    requestId: input.requestId,
    adapterFamilyId: input.adapterFamilyId,
    requestedEnvironment: input.requestedEnvironment,
    evaluatedAt: input.evaluatedAt,
    ...copy(contract.fixedDecision)
  });
}

class History {
  constructor() { this.byRequest = new Map(); this.byStable = new Map(); }
  record(input, trusted) {
    validate(input, trusted);
    const prior = this.byRequest.get(input.requestId);
    if (prior) {
      if (prior.requestDigest !== input.requestDigest || prior.materialDigest !== input.materialDigest || prior.idempotencyKeyDigest !== input.idempotencyKeyDigest) throw new Error('identity conflict');
      return {...prior, replayed: true};
    }
    const output = project(input, trusted);
    if (this.byStable.has(input.idempotencyKeyDigest)) throw new Error('semantic clone');
    const stored = Object.freeze({...output, requestDigest: input.requestDigest, materialDigest: input.materialDigest, idempotencyKeyDigest: input.idempotencyKeyDigest, replayed: false});
    this.byRequest.set(input.requestId, stored);
    this.byStable.set(input.idempotencyKeyDigest, input.requestId);
    return stored;
  }
}

function transitionMaterial(value) { const result = copy(value); delete result.transitionDigest; return result; }
function sealTransition(value) { value.transitionDigest = hash(transitionMaterial(value)); return value; }
function transitionFixture(sequence = 1) {
  if (sequence === 1) return sealTransition({tenantId: uuid(1), transitionId: uuid(20), connectionId: uuid(21), adapterFamilyId: 'provider_neutral_email', providerAccountBindingId: uuid(22), providerAccountIdentityDigest: hash('account-22'), environment: 'testmode', fromState: 'disabled_unavailable', toState: 'disconnected', sequence: 1, predecessorTransitionId: null, predecessorTransitionDigest: null, credentialVersionId: null, credentialBindingDigest: null, providerEvidenceId: null, providerEvidenceDigest: null, leastPrivilegeReviewDigest: null, recordedAt: '2026-10-30T00:06:00.000000Z', transitionDigest: ''});
  const prior = transitionFixture(1);
  if (sequence === 2) return sealTransition({tenantId: prior.tenantId, transitionId: uuid(23), connectionId: prior.connectionId, adapterFamilyId: prior.adapterFamilyId, providerAccountBindingId: prior.providerAccountBindingId, providerAccountIdentityDigest: prior.providerAccountIdentityDigest, environment: prior.environment, fromState: prior.toState, toState: 'connect_requested', sequence: 2, predecessorTransitionId: prior.transitionId, predecessorTransitionDigest: prior.transitionDigest, credentialVersionId: null, credentialBindingDigest: null, providerEvidenceId: null, providerEvidenceDigest: null, leastPrivilegeReviewDigest: null, recordedAt: '2026-10-30T00:06:01.000000Z', transitionDigest: ''});
  const requested = transitionFixture(2);
  return sealTransition({tenantId: requested.tenantId, transitionId: uuid(24), connectionId: requested.connectionId, adapterFamilyId: requested.adapterFamilyId, providerAccountBindingId: requested.providerAccountBindingId, providerAccountIdentityDigest: requested.providerAccountIdentityDigest, environment: requested.environment, fromState: requested.toState, toState: 'connected', sequence: 3, predecessorTransitionId: requested.transitionId, predecessorTransitionDigest: requested.transitionDigest, credentialVersionId: uuid(25), credentialBindingDigest: hash('credential-25'), providerEvidenceId: uuid(26), providerEvidenceDigest: hash('provider-evidence-26'), leastPrivilegeReviewDigest: hash([]), recordedAt: '2026-10-30T00:06:02.000000Z', transitionDigest: ''});
}

function validateTransition(value, predecessor, trusted) {
  dataOnly(value); dataOnly(predecessor); dataOnly(trusted);
  exactKeys(value, contract.connectionLifecycle.transitionEnvelopeExactFields);
  if (hash(value) !== hash(trusted)) throw new Error('trusted transition');
  if (![value.tenantId, value.transitionId, value.connectionId, value.providerAccountBindingId].every(item => UUID.test(item)) || ![value.providerAccountIdentityDigest, value.transitionDigest].every(item => DIGEST.test(item)) || value.transitionDigest !== hash(transitionMaterial(value)) || micros(value.recordedAt) === null) throw new Error('transition identity');
  if (!contract.adapterFamilyBindings.some(item => item.adapterFamilyId === value.adapterFamilyId) || !['testmode','livemode'].includes(value.environment)) throw new Error('transition scope');
  if (!contract.connectionLifecycle.allowedTransitions.some(([from, to]) => from === value.fromState && to === value.toState)) throw new Error('transition pair');
  if (predecessor) {
    if (value.sequence !== predecessor.sequence + 1 || value.predecessorTransitionId !== predecessor.transitionId || value.predecessorTransitionDigest !== predecessor.transitionDigest || value.transitionId === predecessor.transitionId || value.transitionDigest === predecessor.transitionDigest) throw new Error('predecessor');
    for (const field of ['tenantId','connectionId','adapterFamilyId','providerAccountBindingId','providerAccountIdentityDigest','environment']) if (value[field] !== predecessor[field]) throw new Error('transition binding');
    if (value.fromState !== predecessor.toState || micros(value.recordedAt) < micros(predecessor.recordedAt)) throw new Error('transition ordering');
  } else if (value.sequence !== 1 || value.predecessorTransitionId !== null || value.predecessorTransitionDigest !== null) throw new Error('first transition');
  const connectedFields = ['credentialVersionId','providerEvidenceId'];
  const connectedDigests = ['credentialBindingDigest','providerEvidenceDigest','leastPrivilegeReviewDigest'];
  if (value.toState === 'connected') {
    if (!connectedFields.every(field => UUID.test(value[field])) || !connectedDigests.every(field => DIGEST.test(value[field]))) throw new Error('connected evidence');
  } else if (![...connectedFields, ...connectedDigests].every(field => value[field] === null)) throw new Error('non-connected evidence');
  return true;
}

function rotationMaterial(value) { const result = copy(value); delete result.rotationDigest; return result; }
function sealRotation(value) { value.rotationDigest = hash(rotationMaterial(value)); return value; }
function rotationFixture(sequence = 1) {
  if (sequence === 1) return sealRotation({tenantId: uuid(1), rotationId: uuid(30), connectionId: uuid(21), providerAccountBindingId: uuid(22), providerAccountIdentityDigest: hash('account-22'), adapterFamilyId: 'provider_neutral_email', environment: 'testmode', rotationSequence: 1, priorCredentialVersionId: uuid(31), priorCredentialBindingDigest: hash('credential-31'), priorCredentialState: 'active', nextCredentialVersionId: uuid(32), nextCredentialBindingDigest: hash('credential-32'), nextCredentialState: 'pending_verification', leastPrivilegeReviewDigest: hash([]), state: 'rotation_requested', predecessorRotationId: null, predecessorRotationDigest: null, recordedAt: '2026-10-30T00:07:00.000000Z', rotationDigest: ''});
  const prior = rotationFixture(1);
  return sealRotation({...copy(prior), rotationId: uuid(33), rotationSequence: 2, priorCredentialState: 'retired', nextCredentialState: 'active', state: 'rotation_verified', predecessorRotationId: prior.rotationId, predecessorRotationDigest: prior.rotationDigest, recordedAt: '2026-10-30T00:07:01.000000Z', rotationDigest: ''});
}

function validateRotation(value, predecessor, trusted) {
  dataOnly(value); dataOnly(predecessor); dataOnly(trusted);
  exactKeys(value, contract.credentialRotation.rotationEnvelopeExactFields);
  if (hash(value) !== hash(trusted)) throw new Error('trusted rotation');
  if (![value.tenantId, value.rotationId, value.connectionId, value.providerAccountBindingId, value.priorCredentialVersionId, value.nextCredentialVersionId].every(item => UUID.test(item)) || ![value.providerAccountIdentityDigest, value.priorCredentialBindingDigest, value.nextCredentialBindingDigest, value.leastPrivilegeReviewDigest, value.rotationDigest].every(item => DIGEST.test(item)) || value.rotationDigest !== hash(rotationMaterial(value)) || micros(value.recordedAt) === null) throw new Error('rotation identity');
  if (!contract.credentialRotation.acceptedProspectiveStates.includes(value.state) || !contract.credentialRotation.acceptedCredentialStates.includes(value.priorCredentialState) || !contract.credentialRotation.acceptedCredentialStates.includes(value.nextCredentialState) || value.priorCredentialVersionId === value.nextCredentialVersionId || value.priorCredentialBindingDigest === value.nextCredentialBindingDigest) throw new Error('rotation material');
  if (value.state === 'rotation_requested' && (value.priorCredentialState !== 'active' || value.nextCredentialState !== 'pending_verification')) throw new Error('rotation requested state');
  if (value.state === 'rotation_verified' && (!['retired','revoked'].includes(value.priorCredentialState) || value.nextCredentialState !== 'active')) throw new Error('rotation verified state');
  if (value.state === 'rotation_failed' && (value.nextCredentialState !== 'failed' || value.priorCredentialState !== 'suspended_no_new_work')) throw new Error('rotation failed state');
  if (predecessor) {
    if (value.rotationSequence !== predecessor.rotationSequence + 1 || value.predecessorRotationId !== predecessor.rotationId || value.predecessorRotationDigest !== predecessor.rotationDigest || value.rotationId === predecessor.rotationId || value.rotationDigest === predecessor.rotationDigest || !contract.credentialRotation.allowedRotationTransitions.some(([from, to]) => from === predecessor.state && to === value.state)) throw new Error('rotation predecessor');
    for (const field of ['tenantId','connectionId','providerAccountBindingId','providerAccountIdentityDigest','adapterFamilyId','environment','leastPrivilegeReviewDigest']) if (value[field] !== predecessor[field]) throw new Error('rotation binding');
    for (const field of ['priorCredentialVersionId','priorCredentialBindingDigest','nextCredentialVersionId','nextCredentialBindingDigest']) if (value[field] !== predecessor[field]) throw new Error('rotation credential pair');
    if (micros(value.recordedAt) < micros(predecessor.recordedAt)) throw new Error('rotation ordering');
  } else if (value.rotationSequence !== 1 || value.state !== 'rotation_requested' || value.predecessorRotationId !== null || value.predecessorRotationDigest !== null) throw new Error('first rotation');
  return true;
}

function rejectCoherent(mutateInput, mutateTrusted = null) {
  const pair = fixture();
  if (mutateInput) { mutateInput(pair.input); seal(pair.input); }
  if (mutateTrusted) mutateTrusted(pair.trusted);
  expect(() => project(pair.input, pair.trusted)).toThrow();
}

describe('Mission 28 Part 13B connection and credential boundary', () => {
  test('binds the exact released Part13A provenance and frozen authorities', () => {
    expect(contract.authority).toMatchObject({part: '13B', state: 'implementation_candidate_only', baselineCommit: '8f2ab04524747f4e92b9f1116ed7ee51ff3d0c11', baselineTree: '9311279da046ebcb4759e7f79119adf14091c047', providerAccountProvisioningMayRemainUpstream: true, contractOnlyNoMountedResolverOrProviderConnection: true});
    expect(contract.part13ARelease).toMatchObject({acceptedSourceHead: '8efea794a2345620c32f79a951613f222df38380', acceptedTree: '9311279da046ebcb4759e7f79119adf14091c047', pullRequest: 603, mergedMain: '8f2ab04524747f4e92b9f1116ed7ee51ff3d0c11', productionAccepted: true, freshAudit: {verdict: 'P0=0_P1=0_P2=0_P3=0', nodeVersion: '22.23.3', focusedTests: '12/12', cumulativeMission28: '55_suites_780_tests', migrationHistory: '2_suites_40_tests', syntax: '55/55', json: '54/54', migrations: '283_through_287_no_288', changedPaths: '59_docs_tests_only', protectedPaths: 0}, release: {deploymentId: '38ba7ba9-713b-4ad8-88c7-e86391cf65b1', deploymentStatus: 'SUCCESS', deploymentInstanceId: '776e7e8c-26d9-46b5-a5d5-91da85c18bd2', deploymentInstanceStatus: 'RUNNING', imageSha256: 'sha256:ec3db61950dd9fdb031b7bb253dbfc4a331906f7e200bea129f4cc3023163ab7', canonicalStartup: 'ready'}});
    expect(contract.frozenInputs).toHaveLength(8);
    for (const item of contract.frozenInputs) expect(digestLf(item.path)).toBe(item.normalizedLfSha256);
  });

  test('preserves the exact Part13A disabled registry and Part1B dispositions', () => {
    expect(contract.adapterFamilyBindings).toEqual(part13A.adapterFamilies);
    expect(contract.adapterFamilyBindings).toHaveLength(contract.bounds.maximumAdapterFamilies);
    expect(contract.adapterFamilyBindings.every(item => item.adapterState === 'disabled' && item.capabilityState === 'unavailable' && item.providerMode === 'provider_disabled')).toBe(true);
    const providerSurfaces = part1B.surfaces.filter(surface => surface.facets.includes('provider_adapter'));
    expect(providerSurfaces).toHaveLength(part13A.providerSurfaceRule.expectedCount);
    expect(providerSurfaces.every(surface => part13A.providerSurfaceInventory.some(item => item.surfaceId === surface.id && item.frozenDisposition === surface.disposition))).toBe(true);
  });

  test('requires the exact active owner capability subject and recent authentication', () => {
    const row = part3A.capabilities.find(item => item.id === contract.subjectAuthority.requiredCapabilityId);
    expect(row).toMatchObject({operation: 'manage_channel_availability', requiresRecentAuthentication: true, grants: [{membershipRoleId: 'owner', recordScope: 'exact_tenant_channel_availability'}]});
    expect(project(...Object.values(fixture())).resultState).toBe(contract.fixedDecision.resultState);
    for (const mutate of [
      trusted => { trusted.subjectResolution.sessionSubjectActorId = 'actor-200'; },
      trusted => { trusted.subjectResolution.membershipSubjectActorId = 'actor-200'; },
      trusted => { trusted.subjectResolution.sessionTenantId = uuid(9); },
      trusted => { trusted.subjectResolution.membershipRoleId = 'admin'; },
      trusted => { trusted.subjectResolution.membershipStatus = 'suspended'; },
      trusted => { trusted.subjectResolution.recentAuthenticationState = 'stale'; },
      trusted => { trusted.subjectResolution.capabilityId = 'automation_view'; },
      trusted => { trusted.subjectResolution.recordScope = 'exact_tenant_all_automation'; }
    ]) rejectCoherent(null, mutate);
  });

  test('keeps account identity and current connection resolution unavailable and tenant bound', () => {
    const output = project(...Object.values(fixture()));
    expect(output).toMatchObject({resultState: 'unavailable_no_tenant_bound_provider_account_or_credential', reasonCode: 'provider_connection_credential_authority_unavailable', fixedLabel: 'Provider connection and credentials are unavailable.', connectionCreated: false, credentialReadOrCreated: false, providerAccountProvisioned: false, providerModeChanged: false, providerCapabilityGranted: false});
    for (const mutate of [
      trusted => { trusted.connectionResolution.tenantId = uuid(9); },
      trusted => { trusted.connectionResolution.adapterFamilyId = 'provider_neutral_sms'; },
      trusted => { trusted.connectionResolution.providerAccountState = 'provisioned_exact_tenant_account'; trusted.connectionResolution.providerAccountBindingId = uuid(8); trusted.connectionResolution.providerAccountIdentityDigest = hash('account'); },
      trusted => { trusted.connectionResolution.connectionState = 'connected'; trusted.connectionResolution.connectionId = uuid(8); trusted.connectionResolution.connectionRevision = 1; trusted.connectionResolution.connectionDigest = hash('connected'); },
      trusted => { trusted.connectionResolution.credentialState = 'active'; trusted.connectionResolution.credentialVersionId = uuid(8); trusted.connectionResolution.credentialBindingDigest = hash('credential'); },
      trusted => { trusted.connectionResolution.grantedProviderCapabilityIds = ['send']; },
      trusted => { trusted.connectionResolution.currentnessState = 'exact_current'; }
    ]) rejectCoherent(null, mutate);
  });

  test('separates testmode and livemode and never defaults or promotes authority', () => {
    expect(contract.environmentBoundary).toMatchObject({acceptedVocabulary: ['provider_disabled','testmode','livemode'], currentMode: 'provider_disabled', testmodeState: 'unavailable', livemodeState: 'unavailable', testmodeAndLivemodeRequireDistinctProviderAccountConnectionAndCredentialBindings: true, testmodeIdentityEvidenceCredentialCallbackMessageOrOutcomeMayNotBePromotedToLivemode: true});
    for (const environment of ['testmode','livemode','TESTMODE','sandbox','']) rejectCoherent(input => { input.requestedEnvironment = environment; });
    expect(contract.denials).toContain('same_provider_account_connection_or_credential_binding_reused_across_testmode_and_livemode');
  });

  test('freezes a closed append-only connection lifecycle with intent distinct from outcome', () => {
    expect(new Set(contract.connectionStateCatalog.map(item => item.state)).size).toBe(contract.connectionStateCatalog.length);
    expect(contract.connectionStateCatalog.find(item => item.state === 'disabled_unavailable')).toMatchObject({availableNow: true, strongestClaim: 'no_verified_account_credential_or_connection'});
    expect(contract.connectionStateCatalog.filter(item => item.state !== 'disabled_unavailable').every(item => item.availableNow === false)).toBe(true);
    expect(contract.connectionLifecycle).toMatchObject({everyStateChangeAppendOnlyWithExactPredecessorAndSequencePlusOne: true, connectDisconnectAndRotationRequestAreIntentNotProviderOutcome: true, revokedIsTerminalForExactConnectionIdentity: true, reconnectRequiresNewConnectionIdentityAndNewTrustedResolution: true});
    const first = transitionFixture(1); const second = transitionFixture(2); const connected = transitionFixture(3);
    expect(validateTransition(first, null, copy(first))).toBe(true);
    expect(validateTransition(second, first, copy(second))).toBe(true);
    expect(validateTransition(connected, second, copy(connected))).toBe(true);
    expect(contract.connectionLifecycle.allowedTransitions.some(([from]) => from === 'revoked')).toBe(false);
    for (const mutate of [
      value => { value.sequence = 3; },
      value => { value.predecessorTransitionId = uuid(99); },
      value => { value.transitionId = first.transitionId; },
      value => { value.environment = 'livemode'; },
      value => { value.fromState = 'connected'; },
      value => { value.toState = 'connected'; }
    ]) { const changed = copy(second); mutate(changed); sealTransition(changed); expect(() => validateTransition(changed, first, copy(changed))).toThrow(); }
    for (const mutate of [
      value => { value.providerEvidenceId = null; },
      value => { value.providerEvidenceDigest = null; },
      value => { value.leastPrivilegeReviewDigest = null; }
    ]) { const changed = copy(connected); mutate(changed); sealTransition(changed); expect(() => validateTransition(changed, second, copy(changed))).toThrow(); }
  });

  test('freezes least privilege and denies provider scope inference', () => {
    expect(contract.leastPrivilegeBoundary).toMatchObject({currentGrantedProviderCapabilityIds: [], wildcardAdminOwnerWriteAllOrUnknownProviderScope: 'deny', futureGrantedSetMustEqualExactMinimalReviewedCapabilitySet: true, extraMissingReorderedAliasedOrUndocumentedProviderScope: 'deny', Part13ACapabilityVocabularyDoesNotCreateProviderScope: true, connectionOrCredentialPresenceDoesNotCreateSenderRecipientConsentMessageOrEffectAuthority: true});
    expect(part13A.capabilityClassOrder.length).toBeGreaterThan(0);
    expect(part7B.privacyAndEffects).toMatchObject({persistedContactValues: 0, providerAttempts: 0, recipientMessages: 0, externalEffects: 0, moneyEffects: 0});
    expect(contract.currentTrustedResolution.grantedProviderCapabilityIds).toEqual([]);
  });

  test('keeps credential material isolated from browser logs evidence and demo', () => {
    expect(contract.credentialIsolation).toMatchObject({currentCredentialState: 'unavailable', rawCredentialMaterialAcceptedAnywhere: false, rawProviderPrivatePayloadAcceptedAnywhere: false, credentialBindingDigestMustNeverHashSecretBytes: true, credentialVersionIdentityMustBeServerVaultResolved: true, browser: 'no_credential_private_account_or_provider_payload', logs: 'no_credential_private_account_or_provider_payload', evidence: 'metadata_only_no_secret_or_private_payload', demo: 'fictional_disabled_no_credential_or_provider_payload'});
    expect(contract.credentialIsolation.forbiddenFieldNames).toEqual(expect.arrayContaining(['apiKey','accessToken','refreshToken','clientSecret','password','privateKey','webhookSecret','authorizationHeader','rawCredential','rawProviderAccountId','rawProviderPayload','messageBody','documentContent']));
    for (const field of contract.credentialIsolation.forbiddenFieldNames) rejectCoherent(input => { input[field] = 'private-customer@example.test-sk_secret'; });
    expect(JSON.stringify(project(...Object.values(fixture()))).toLowerCase()).not.toContain('customer@example.test');
  });

  test('requires exact credential rotation identity lineage and least-privilege review', () => {
    const first = rotationFixture(1); const second = rotationFixture(2);
    expect(validateRotation(first, null, copy(first))).toBe(true);
    expect(validateRotation(second, first, copy(second))).toBe(true);
    expect(contract.credentialRotation).toMatchObject({currentState: 'unavailable', newCredentialVersionIdMustDiffer: true, newCredentialBindingDigestMustDiffer: true, rotationSequenceMustIncreaseByExactlyOne: true, tenantAccountAdapterAndEnvironmentMustRemainExact: true, newCredentialMustPassSameLeastPrivilegeReview: true, oldCredentialMustBecomeRetiredOrRevokedBeforeNewWork: true});
    for (const mutate of [
      value => { value.rotationSequence = 4; },
      value => { value.predecessorRotationId = uuid(99); },
      value => { value.nextCredentialVersionId = value.priorCredentialVersionId; },
      value => { value.nextCredentialBindingDigest = value.priorCredentialBindingDigest; },
      value => { value.providerAccountBindingId = uuid(99); },
      value => { value.providerAccountIdentityDigest = hash('different-account'); },
      value => { value.environment = 'livemode'; },
      value => { value.leastPrivilegeReviewDigest = hash(['admin']); },
      value => { value.priorCredentialVersionId = uuid(99); },
      value => { value.nextCredentialVersionId = uuid(99); },
      value => { value.state = 'rotation_failed'; },
      value => { value.priorCredentialState = 'active'; },
      value => { value.nextCredentialState = 'pending_verification'; }
    ]) { const changed = copy(second); mutate(changed); sealRotation(changed); expect(() => validateRotation(changed, first, copy(changed))).toThrow(); }
  });

  test('rejects malformed hostile alias and accessor material before lookup', () => {
    for (const mutation of [input => { input.extra = true; }, input => { delete input.schemaVersion; }, input => { input.part13ARegistryBinding.extra = true; }, input => { input.adapterFamilyId = 'provider.retell'; }]) rejectCoherent(mutation);
    const getter = fixture(); let reads = 0; Object.defineProperty(getter.input.part13ARegistryBinding, 'registryDigest', {enumerable: true, get() { reads += 1; return registryBinding().registryDigest; }}); expect(() => project(getter.input, getter.trusted)).toThrow(); expect(reads).toBe(0);
    for (const hostile of [new Proxy(fixture().input, {}), Object.assign(Object.create({polluted: true}), fixture().input), Object.assign(fixture().input, {toJSON() { return {}; }}), Object.assign(fixture().input, {[Symbol('secret')]: true})]) expect(() => project(hostile, fixture().trusted)).toThrow();
    const alias = fixture(); alias.input.part13ARegistryBinding = alias.input; expect(() => project(alias.input, alias.trusted)).toThrow();
    const sparse = fixture(); sparse.trusted.connectionResolution.grantedProviderCapabilityIds = Array(1); expect(() => project(sparse.input, sparse.trusted)).toThrow();
  });

  test('provides exact replay and rejects identity conflict and semantic clone reuse', () => {
    const history = new History(); const pair = fixture();
    expect(history.record(pair.input, pair.trusted).replayed).toBe(false);
    expect(history.record(copy(pair.input), copy(pair.trusted)).replayed).toBe(true);
    const conflict = copy(pair.input); conflict.evaluatedAt = '2026-10-30T00:05:01.000000Z'; seal(conflict); const conflictTrusted = {subjectResolution: subjectResolution(conflict), connectionResolution: connectionResolution(conflict), evaluatedAt: conflict.evaluatedAt}; expect(() => history.record(conflict, conflictTrusted)).toThrow('identity conflict');
    const clone = copy(pair.input); clone.requestId = uuid(99); clone.evaluatedAt = '2026-10-30T00:05:01.000000Z'; seal(clone); const trusted = {subjectResolution: subjectResolution(clone), connectionResolution: connectionResolution(clone), evaluatedAt: clone.evaluatedAt}; expect(clone.idempotencyKeyDigest).toBe(pair.input.idempotencyKeyDigest); expect(() => history.record(clone, trusted)).toThrow('semantic clone');
    const malformedReplay = copy(pair.input); malformedReplay.apiKey = 'sk_secret_customer@example.test'; expect(() => history.record(malformedReplay, pair.trusted)).toThrow();
    const malformedTrustedReplay = copy(pair.trusted); malformedTrustedReplay.connectionResolution.extra = true; expect(() => history.record(copy(pair.input), malformedTrustedReplay)).toThrow();
  });

  test('keeps runtime provider recipient message effect and money authority at zero', () => {
    const output = project(...Object.values(fixture()));
    const effectFlags = Object.entries(output).filter(([key]) => /(Created|Provisioned|Changed|Granted|Contacted)$/.test(key));
    expect(effectFlags.every(([, value]) => value === false)).toBe(true);
    expect(contract.runtimeBoundary).toMatchObject({newMigration: false, newTableFunctionRouteUiWorkerQueueSchedulerCallbackOrAdapter: false, mountedConnectionCredentialOrModeResolver: false, providerAccountProvisioningPerformed: false, providerConnectionCreated: false, providerConnectionDisconnectedOrRevoked: false, credentialReadCreatedStoredOrRotated: false, providerSandboxOrLiveCallPerformed: false, browserLogEvidenceOrDemoCredentialMaterialCreated: false, recipientsContacted: 0, messagesCreated: 0, providerAttemptsCreated: 0, externalEffectsCreated: 0, upstreamMutationsCreated: 0, financialEffectsCreated: 0, moneyEffectsCreated: 0, latestMigration: '287_canonical_automation_estimate_quote_resolution_v1.sql', nextMigrationAbsent: '288'});
  });

  test('reconciles Part13A released and Part13B as the sole candidate', () => {
    const roadmap = fs.readFileSync(path.join(ROOT, 'docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md'), 'utf8');
    const ledger = fs.readFileSync(path.join(ROOT, 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md'), 'utf8');
    for (const value of [roadmap, ledger]) {
      expect(value).toContain('Parts 1A–13A are released. Part 13B is the sole implementation candidate.');
      expect(value).toContain('Parts 13C–14G remain planned and unimplemented.');
      for (const identity of ['8efea794a2345620c32f79a951613f222df38380','9311279da046ebcb4759e7f79119adf14091c047','8f2ab04524747f4e92b9f1116ed7ee51ff3d0c11','38ba7ba9-713b-4ad8-88c7-e86391cf65b1','776e7e8c-26d9-46b5-a5d5-91da85c18bd2','sha256:ec3db61950dd9fdb031b7bb253dbfc4a331906f7e200bea129f4cc3023163ab7']) expect(value).toContain(identity);
      expect(value).toMatch(/direct applied production migration history.*unavailable.*unclaimed/i);
    }
    expect((ledger.match(/\| \*\*Released\*\* \|/g) || []).length).toBe(55);
    expect((ledger.match(/\| \*\*Implementation candidate\*\* \|/g) || []).length).toBe(1);
    expect((ledger.match(/\| Planned \/ unimplemented \|/g) || []).length).toBe(10);
    expect(ledger).toContain('| 55 | 13A | Provider-neutral adapter and capability discovery | **Released** |');
    expect(ledger).toContain('| 56 | 13B | Tenant-bound connection/credential/mode boundary | **Implementation candidate** |');
  });
});
