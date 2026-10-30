'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { types } = require('util');

const ROOT = path.resolve(__dirname, '../..');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
const contract = readJson('docs/architecture/MISSION_28_PART13A_PROVIDER_ADAPTER_CAPABILITY_CONTRACT.json');
const part1B = readJson('docs/architecture/MISSION_28_PART1B_SURFACE_INVENTORY.json');
const part1D = readJson('docs/architecture/MISSION_28_PART1D_FIRST_LAUNCH_MATRIX.json');
const part7C = readJson('docs/architecture/MISSION_28_PART7C_CONTENT_TEMPLATE_PREVIEW_CONTRACT.json');
const part7D = readJson('docs/architecture/MISSION_28_PART7D_CHANNEL_DELIVERY_HANDOFF_CONTRACT.json');
const part7E = readJson('docs/architecture/MISSION_28_PART7E_SCOPED_LINK_ATTACHMENT_CONTRACT.json');
const part7F = readJson('docs/architecture/MISSION_28_PART7F_DELIVERY_EVIDENCE_CONTRACT.json');
const UUID = new RegExp(contract.identityGrammar.uuidPattern);
const DIGEST = new RegExp(contract.identityGrammar.digestPattern);
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
    registryId: uuid(10),
    registryDigest: hash({adapterFamilies: contract.adapterFamilies, outboundChannelCatalog: contract.outboundChannelCatalog, callbackCapability: contract.callbackCapability, attachmentCapability: contract.attachmentCapability, templateCapability: contract.templateCapability, limitCapability: contract.limitCapability, modeCapability: contract.modeCapability, costCapability: contract.costCapability, statusMeaningCatalog: contract.statusMeaningCatalog}),
    part1BInventoryDigest: `sha256:${contract.frozenInputs.find(item => item.part === '1B').normalizedLfSha256.toLowerCase()}`,
    providerSurfaceInventoryDigest: hash(contract.providerSurfaceInventory),
    adapterFamilyDigest: hash(contract.adapterFamilies),
    channelCatalogDigest: hash(contract.outboundChannelCatalog),
    statusMeaningCatalogDigest: hash(contract.statusMeaningCatalog),
    adapterState: 'disabled',
    providerMode: 'provider_disabled'
  };
}

function materialOf(input) { const value = copy(input); delete value.materialDigest; delete value.idempotencyKeyDigest; delete value.requestDigest; return value; }
function stableOf(input) { const value = materialOf(input); delete value.discoveryRequestId; delete value.evaluatedAt; return value; }
function seal(input) { input.materialDigest = hash(materialOf(input)); input.idempotencyKeyDigest = hash(stableOf(input)); input.requestDigest = hash(materialOf(input)); return input; }
function trustedOf(input) { return copy({tenantId: input.tenantId, registryBinding: input.registryBinding, evaluatedAt: input.evaluatedAt}); }

function fixture() {
  const input = {
    schemaVersion: contract.contractVersion,
    tenantId: uuid(1),
    discoveryRequestId: uuid(2),
    requestedCapabilityClasses: copy(contract.capabilityClassOrder),
    registryBinding: registryBinding(),
    evaluatedAt: '2026-10-29T23:05:00.000000Z',
    materialDigest: '',
    idempotencyKeyDigest: '',
    requestDigest: ''
  };
  seal(input);
  return {input, trusted: trustedOf(input)};
}

function validateEnvelope(input) {
  dataOnly(input);
  if (Buffer.byteLength(JSON.stringify(input)) > contract.bounds.maximumCanonicalRequestBytes) throw new Error('size');
  exactKeys(input, contract.discoveryEnvelope.exactFields);
  exactKeys(input.registryBinding, contract.discoveryEnvelope.registryBindingExactFields);
  if (input.schemaVersion !== contract.contractVersion || !UUID.test(input.tenantId) || !UUID.test(input.discoveryRequestId) || micros(input.evaluatedAt) === null) throw new Error('identity');
  if (!Array.isArray(input.requestedCapabilityClasses) || input.requestedCapabilityClasses.length !== contract.bounds.maximumCapabilityClasses || hash(input.requestedCapabilityClasses) !== hash(contract.capabilityClassOrder) || new Set(input.requestedCapabilityClasses).size !== input.requestedCapabilityClasses.length) throw new Error('capability classes');
  if (![input.registryBinding.registryDigest, input.registryBinding.part1BInventoryDigest, input.registryBinding.providerSurfaceInventoryDigest, input.registryBinding.adapterFamilyDigest, input.registryBinding.channelCatalogDigest, input.registryBinding.statusMeaningCatalogDigest, input.materialDigest, input.idempotencyKeyDigest, input.requestDigest].every(value => DIGEST.test(value))) throw new Error('digest');
  if (input.materialDigest !== hash(materialOf(input)) || input.requestDigest !== hash(materialOf(input)) || input.idempotencyKeyDigest !== hash(stableOf(input))) throw new Error('seal');
}

function validate(input, trusted) {
  validateEnvelope(input);
  dataOnly(trusted);
  exactKeys(trusted, contract.discoveryEnvelope.trustedResolutionExactFields);
  if (trusted.tenantId !== input.tenantId || trusted.evaluatedAt !== input.evaluatedAt || hash(trusted.registryBinding) !== hash(input.registryBinding)) throw new Error('trusted resolution');
  const expected = registryBinding();
  if (hash(input.registryBinding) !== hash(expected) || input.registryBinding.adapterState !== 'disabled' || input.registryBinding.providerMode !== 'provider_disabled') throw new Error('registry');
  return true;
}

function project(input, trusted) {
  validate(input, trusted);
  return Object.freeze({
    discoveryRequestId: input.discoveryRequestId,
    tenantId: input.tenantId,
    capabilityClasses: copy(input.requestedCapabilityClasses),
    adapterFamilies: copy(contract.adapterFamilies),
    outboundChannels: copy(contract.outboundChannelCatalog),
    callbackCapability: copy(contract.callbackCapability),
    attachmentCapability: copy(contract.attachmentCapability),
    templateCapability: copy(contract.templateCapability),
    limitCapability: copy(contract.limitCapability),
    modeCapability: copy(contract.modeCapability),
    costCapability: copy(contract.costCapability),
    statusMeanings: copy(contract.statusMeaningCatalog),
    evaluatedAt: input.evaluatedAt,
    ...copy(contract.fixedDecision),
    adapterConnected: false,
    credentialReadOrCreated: false,
    callbackAuthenticated: false,
    templateCreated: false,
    attachmentCreated: false,
    providerAttemptCreated: false,
    messageCreated: false,
    recipientContacted: false,
    externalEffectCreated: false,
    upstreamMutationCreated: false,
    financialEffectCreated: false,
    moneyEffectCreated: false
  });
}

class History {
  constructor() { this.byRequest = new Map(); this.byStable = new Map(); }
  record(input, trusted) {
    validateEnvelope(input);
    dataOnly(trusted);
    exactKeys(trusted, contract.discoveryEnvelope.trustedResolutionExactFields);
    const prior = this.byRequest.get(input.discoveryRequestId);
    if (prior) {
      if (prior.requestDigest !== input.requestDigest || prior.materialDigest !== input.materialDigest || prior.idempotencyKeyDigest !== input.idempotencyKeyDigest) throw new Error('identity conflict');
      return {...prior, replayed: true};
    }
    const output = project(input, trusted);
    if (this.byStable.has(input.idempotencyKeyDigest)) throw new Error('semantic clone');
    const stored = Object.freeze({...output, requestDigest: input.requestDigest, materialDigest: input.materialDigest, idempotencyKeyDigest: input.idempotencyKeyDigest, replayed: false});
    this.byRequest.set(input.discoveryRequestId, stored);
    this.byStable.set(input.idempotencyKeyDigest, input.discoveryRequestId);
    return stored;
  }
}

function rejectCoherent(mutate) {
  const pair = fixture();
  mutate(pair.input);
  seal(pair.input);
  expect(() => project(pair.input, pair.trusted)).toThrow();
}

describe('Mission 28 Part 13A provider-neutral adapter capability contract', () => {
  test('binds the exact released Part12D provenance and frozen inputs', () => {
    expect(contract.authority).toMatchObject({part: '13A', state: 'implementation_candidate_only', baselineCommit: 'c391746060348df9f358feba49a8ee0679c2b465', baselineTree: '523a7b059dbc3edda9926224233627a639536bd1', everyAdapterStartsDisabled: true, unsupportedCapabilitiesRemainUnavailable: true});
    expect(contract.part12DRelease).toMatchObject({acceptedSourceHead: 'e0a4739e4b34110e2ef20a59e472a6c383fb96ac', acceptedTree: '523a7b059dbc3edda9926224233627a639536bd1', pullRequest: 602, mergedMain: 'c391746060348df9f358feba49a8ee0679c2b465', productionAccepted: true, freshAudit: {verdict: 'P0=0_P1=0_P2=0_P3=0', nodeVersion: '22.23.3', focusedTests: '18/18', parts11ATo12D: '10_suites_166_tests', cumulativeMission28: '54_suites_768_tests', migrationHistory: '2_suites_40_tests', syntax: '54/54', json: '53/53', migrations: '283_through_287_no_288', changedPaths: '58_docs_tests_only', protectedPaths: 0}, release: {deploymentId: 'eb46e43c-f153-4c02-82dd-53a5c1206f8a', deploymentStatus: 'SUCCESS', deploymentInstanceId: 'b288d2b8-0c27-4ca9-8d89-d809abdf9d6c', deploymentInstanceStatus: 'RUNNING', imageSha256: 'sha256:66debb28f92855258835fc11fca1e80137547b85c26116172dfe08dce2ca3e48', canonicalStartup: 'ready'}, directAppliedProductionMigrationHistory: 'unavailable_and_unclaimed'});
    expect(contract.frozenInputs).toHaveLength(10);
    for (const item of contract.frozenInputs) expect(digestLf(item.path)).toBe(item.normalizedLfSha256);
  });

  test('binds every Part1B provider-adapter surface and preserves its frozen disposition', () => {
    const discovered = part1B.surfaces.filter(surface => surface.facets.includes('provider_adapter')).map(surface => ({surfaceId: surface.id, frozenDisposition: surface.disposition}));
    expect(discovered).toEqual(contract.providerSurfaceInventory);
    expect(discovered).toHaveLength(contract.providerSurfaceRule.expectedCount);
    for (const surface of part1B.surfaces.filter(item => item.facets.includes('provider_adapter'))) {
      expect(surface.sourceRefs.length).toBeGreaterThan(0);
      for (const ref of surface.sourceRefs) {
        const source = fs.readFileSync(path.join(ROOT, ref.path), 'utf8');
        for (const anchor of ref.anchors) expect(source).toContain(anchor);
      }
    }
    expect(new Set(contract.providerSurfaceInventory.map(item => item.surfaceId)).size).toBe(20);
    expect(contract.providerSurfaceInventory.every(item => ['ambiguous_fail_closed','upstream_or_subscription_owned_excluded','legacy_unsupported_or_quarantined','simulated_or_demo_only'].includes(item.frozenDisposition))).toBe(true);
  });

  test('keeps every adapter disabled and channels aligned with Parts1D and 7D', () => {
    expect(contract.adapterFamilies.every(item => item.adapterState === 'disabled' && item.capabilityState === 'unavailable' && item.providerMode === 'provider_disabled')).toBe(true);
    expect(contract.outboundChannelCatalog.map(item => item.channelId)).toEqual(part1D.channels.map(item => item.id));
    for (const prior of part7D.channelCatalog) {
      expect(contract.outboundChannelCatalog.find(item => item.channelId === prior.channelId)).toMatchObject({adapterState: prior.channelId === 'in_app_passive' ? 'not_applicable_internal_only' : prior.channelId === 'native_manual_handoff' ? 'not_mounted_manual_excluded' : 'disabled', capabilityState: prior.capabilityState, providerMode: prior.providerMode, resultState: prior.resultState});
    }
    expect(contract.outboundChannelCatalog.find(item => item.channelId === 'secure_link_delivery')).toMatchObject({adapterState: 'disabled', capabilityState: 'external_unavailable', providerMode: 'provider_disabled'});
    expect(contract.outboundChannelCatalog.find(item => item.channelId === 'provider_callback')).toMatchObject({adapterState: 'disabled', capabilityState: 'evidence_only_unavailable_not_a_channel'});
  });

  test('keeps callbacks attachments templates limits modes and costs fail-closed', () => {
    expect(contract.callbackCapability).toMatchObject({adapterState: 'disabled', capabilityState: 'unavailable', signatureVerification: 'unavailable', replayProtection: 'unavailable', rawPayloadRetention: 'forbidden', normalizedEvidenceCreation: 'not_authorized'});
    expect(contract.attachmentCapability).toMatchObject({adapterState: 'disabled', capabilityState: 'unavailable', maximumAttachments: 0, supportedMediaTypes: [], maximumBytes: null, futurePart7EApplicationPdfVocabularyIsNotCurrentProviderSupport: true});
    expect(part7E.futureAcceptedAttachmentContract.allowedMediaTypes).toContain('application/pdf');
    expect(contract.templateCapability).toMatchObject({adapterState: 'disabled', capabilityState: 'unavailable', providerTemplateIds: [], providerTemplateVersions: [], part7CInternalPreviewTemplatesAreNotProviderTemplates: true});
    expect(part7C.approvedTemplateCatalog.length).toBeGreaterThan(0);
    expect(contract.limitCapability).toMatchObject({capabilityState: 'unavailable', providerRecipientLimit: null, providerPayloadByteLimit: null, providerAttachmentCountLimit: null, providerRateLimit: null, providerRetryLimit: null, acceptedCurrentExternalRecipients: 0, acceptedCurrentExternalMessages: 0, acceptedCurrentProviderAttempts: 0, acceptedCurrentRetries: 0});
    expect(contract.modeCapability).toMatchObject({acceptedCurrentMode: 'provider_disabled', sandbox: 'unavailable', live: 'unavailable', modeSwitchingAuthority: 'unavailable'});
    expect(contract.costCapability).toMatchObject({capabilityState: 'unavailable', currency: null, unitAmount: null, pricingUnit: null, estimateDigest: null, zeroFreeOrIncludedMayNotBeInferred: true});
  });

  test('uses Part7F status meanings as unavailable vocabulary and never as evidence', () => {
    expect(contract.statusMeaningCatalog).toEqual(part7F.futureAcceptedEvidenceKinds.map(({eventKind, evidenceClass, strongestClaim}) => ({eventKind, evidenceClass, strongestClaim, availableNow: false})));
    expect(contract.statusMeaningCatalog).toHaveLength(contract.bounds.maximumStatusMeaningEntries);
    expect(contract.statusMeaningRule).toMatchObject({catalogMembershipDoesNotCreateCallbackOrEvidenceAuthority: true, acceptedSentDeliveredOpenedReplyFailedComplaintAndUnknownRemainDistinct: true, noStatusImpliesPaymentCollectionAccountingCustomerSatisfactionOrBusinessOutcome: true});
    expect(part7F.currentLaunchProfile).toMatchObject({providerAttemptState: 'not_created', callbackState: 'not_received_no_callback_authority', resultState: 'unavailable_no_effect_evidence'});
  });

  test('projects only one fixed disabled and unavailable discovery result', () => {
    const output = project(...Object.values(fixture()));
    expect(output).toMatchObject({capabilityClasses: contract.capabilityClassOrder, resultState: 'unavailable_all_external_provider_adapters_disabled', reasonCode: 'provider_adapter_capability_discovery_unavailable', labelId: 'provider_channels_unavailable', fixedLabel: 'External provider channels are unavailable.', adapterRegistryState: 'disabled', providerMode: 'provider_disabled', capabilityEvidenceCreated: false, connectionAuthorityGranted: false, credentialAuthorityGranted: false, callbackAuthorityGranted: false, messageAuthorityGranted: false, effectAuthorityGranted: false});
    expect(output.adapterFamilies.every(item => item.adapterState === 'disabled')).toBe(true);
  });

  test('requires complete ordered capability discovery and exact trusted registry material', () => {
    for (const mutation of [
      value => { value.requestedCapabilityClasses.pop(); },
      value => { value.requestedCapabilityClasses.reverse(); },
      value => { value.requestedCapabilityClasses[0] = 'provider_credentials'; },
      value => { value.registryBinding.registryId = uuid(99); },
      value => { value.registryBinding.registryDigest = hash('candidate'); },
      value => { value.registryBinding.providerSurfaceInventoryDigest = hash('reclassified'); },
      value => { value.registryBinding.adapterFamilyDigest = hash('enabled'); },
      value => { value.registryBinding.channelCatalogDigest = hash('email_available'); },
      value => { value.registryBinding.statusMeaningCatalogDigest = hash('delivered'); },
      value => { value.registryBinding.adapterState = 'enabled'; },
      value => { value.registryBinding.providerMode = 'sandbox'; }
    ]) rejectCoherent(mutation);
    const pair = fixture(); pair.trusted.registryBinding.registryDigest = hash('candidate'); expect(() => project(pair.input, pair.trusted)).toThrow('trusted resolution');
  });

  test('denies enabled support cost limit template attachment callback and status substitutions', () => {
    const candidateMutations = [
      value => { value.adapterFamilies[0].adapterState = 'enabled'; },
      value => { value.outboundChannelCatalog.find(item => item.channelId === 'email').capabilityState = 'available'; },
      value => { value.callbackCapability.signatureVerification = 'supported'; },
      value => { value.attachmentCapability.supportedMediaTypes = ['application/pdf']; },
      value => { value.templateCapability.providerTemplateIds = ['welcome']; },
      value => { value.limitCapability.providerRecipientLimit = 100; },
      value => { value.modeCapability.sandbox = 'available'; },
      value => { value.costCapability.unitAmount = 0; },
      value => { value.statusMeaningCatalog.find(item => item.eventKind === 'provider_accepted').strongestClaim = 'delivered'; }
    ];
    for (const mutate of candidateMutations) { const changed = copy(contract); mutate(changed); expect(hash(changed)).not.toBe(hash(contract)); }
    expect(contract.denials).toContain('candidate_or_untrusted_registry_capability_connection_credential_mode_limit_cost_template_attachment_callback_or_status_claim');
    expect(contract.denials).toContain('Part7F_status_vocabulary_treated_as_callback_delivery_reply_opt_out_or_outcome_evidence');
  });

  test('rejects malformed hostile aliased and pre-lookup replay material without invoking accessors', () => {
    for (const mutation of [value => { value.extra = true; }, value => { delete value.schemaVersion; }, value => { value.registryBinding.extra = true; }, value => { value.requestedCapabilityClasses = null; }]) rejectCoherent(mutation);
    const getter = fixture(); let reads = 0; Object.defineProperty(getter.input.registryBinding, 'registryDigest', {enumerable: true, get() { reads += 1; return registryBinding().registryDigest; }}); expect(() => project(getter.input, getter.trusted)).toThrow(); expect(reads).toBe(0);
    for (const hostile of [new Proxy(fixture().input, {}), Object.assign(Object.create({polluted: true}), fixture().input), Object.assign(fixture().input, {toJSON() { return {}; }}), Object.assign(fixture().input, {[Symbol('secret')]: true})]) expect(() => project(hostile, fixture().trusted)).toThrow();
    const sparse = fixture(); sparse.input.requestedCapabilityClasses = Object.assign(Array(8), ['outbound_channels']); expect(() => project(sparse.input, sparse.trusted)).toThrow();
    const alias = fixture(); alias.input.registryBinding = alias.input; expect(() => project(alias.input, alias.trusted)).toThrow();
  });

  test('provides exact replay and rejects conflicting identity and semantic clone reuse', () => {
    const history = new History(); const pair = fixture();
    expect(history.record(pair.input, pair.trusted).replayed).toBe(false);
    expect(history.record(copy(pair.input), copy(pair.trusted)).replayed).toBe(true);
    const conflict = copy(pair.input); conflict.evaluatedAt = '2026-10-29T23:05:01.000000Z'; seal(conflict); expect(() => history.record(conflict, trustedOf(conflict))).toThrow('identity conflict');
    const clone = copy(pair.input); clone.discoveryRequestId = uuid(99); clone.evaluatedAt = '2026-10-29T23:05:01.000000Z'; seal(clone); expect(clone.idempotencyKeyDigest).toBe(pair.input.idempotencyKeyDigest); expect(() => history.record(clone, trustedOf(clone))).toThrow('semantic clone');
    const malformedReplay = copy(pair.input); malformedReplay.extra = 'provider-secret'; expect(() => history.record(malformedReplay, pair.trusted)).toThrow();
  });

  test('keeps runtime provider recipient effect financial and money authority at zero', () => {
    const output = project(...Object.values(fixture()));
    const effectFlags = Object.entries(output).filter(([key]) => /(Connected|Created|Authenticated|Contacted|Granted)$/.test(key));
    expect(effectFlags.every(([, value]) => value === false)).toBe(true);
    expect(contract.runtimeBoundary).toMatchObject({newMigration: false, newTableFunctionRouteWorkerQueueSchedulerCallbackOrUi: false, mountedCapabilityDiscoveryResolver: false, mountedProviderAdapter: false, connectionsCreated: 0, credentialsReadOrCreated: 0, callbacksAuthenticated: 0, providerAttemptsCreated: 0, messagesCreated: 0, recipientsContacted: 0, externalEffectsCreated: 0, upstreamMutationsCreated: 0, financialEffectsCreated: 0, moneyEffectsCreated: 0, latestMigration: '287_canonical_automation_estimate_quote_resolution_v1.sql', nextMigrationAbsent: '288'});
  });

  test('reconciles Part12D released and Part13A as the sole candidate', () => {
    const roadmap = fs.readFileSync(path.join(ROOT, 'docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md'), 'utf8');
    const ledger = fs.readFileSync(path.join(ROOT, 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md'), 'utf8');
    for (const value of [roadmap, ledger]) {
      expect(value).toContain('Parts 1A–13D are released. Part 13E is the sole implementation candidate.');
      expect(value).toContain('Parts 14A–14G remain planned and unimplemented.');
      for (const identity of ['e0a4739e4b34110e2ef20a59e472a6c383fb96ac','523a7b059dbc3edda9926224233627a639536bd1','c391746060348df9f358feba49a8ee0679c2b465','eb46e43c-f153-4c02-82dd-53a5c1206f8a','b288d2b8-0c27-4ca9-8d89-d809abdf9d6c','sha256:66debb28f92855258835fc11fca1e80137547b85c26116172dfe08dce2ca3e48','0a1f73636ca4fe873330301107a9c3ed92edea9a4a2a285467b0aeede581fd38','b42145ddc95e9bc2a383f9dac6ad1f5a884a90d5a3e999a0c126b2b6e3bae369']) expect(value).toContain(identity);
      expect(value).toMatch(/direct applied production migration history.*unavailable.*unclaimed/i);
    }
    expect(roadmap).toContain('Released Parts 12A–12D artifacts:');
    expect(roadmap).toContain('../architecture/MISSION_28_PART12D_ACTION_EXPLANATION_DRILLDOWN_CONTRACT.md');
    expect(roadmap).toContain('../architecture/MISSION_28_PART12D_ACTION_EXPLANATION_DRILLDOWN_CONTRACT.json');
    expect((ledger.match(/\| \*\*Released\*\* \|/g) || []).length).toBe(58);
    expect((ledger.match(/\| \*\*Implementation candidate\*\* \|/g) || []).length).toBe(1);
    expect((ledger.match(/\| Planned \/ unimplemented \|/g) || []).length).toBe(7);
    expect(ledger).toContain('| 54 | 12D | Owner explanation and cross-authority drilldown | **Released** |');
    expect(ledger).toContain('| 55 | 13A | Provider-neutral adapter and capability discovery | **Released** |');
  });
});
