'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {types} = require('util');

const ROOT = path.resolve(__dirname, '../..');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
const contract = readJson('docs/architecture/MISSION_28_PART13C_AUTHENTICATED_CALLBACK_RECONCILIATION_CONTRACT.json');
const part6C = readJson('docs/architecture/MISSION_28_PART6C_DELIVERY_COORDINATION_CONTRACT.json');
const part6D = readJson('docs/architecture/MISSION_28_PART6D_RETRY_RECONCILIATION_CONTRACT.json');
const part7F = readJson('docs/architecture/MISSION_28_PART7F_DELIVERY_EVIDENCE_CONTRACT.json');
const part13A = readJson('docs/architecture/MISSION_28_PART13A_PROVIDER_ADAPTER_CAPABILITY_CONTRACT.json');
const part13B = readJson('docs/architecture/MISSION_28_PART13B_CONNECTION_CREDENTIAL_BOUNDARY_CONTRACT.json');
const UUID = new RegExp(contract.identityGrammar.uuidPattern);
const DIGEST = new RegExp(contract.identityGrammar.digestPattern);
const OPAQUE = new RegExp(contract.identityGrammar.opaqueIdentifierPattern);
const UTC = new RegExp(contract.identityGrammar.utcInstantPattern);
const uuid = value => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const copy = value => JSON.parse(JSON.stringify(value));
const canonicalize = value => Array.isArray(value) ? value.map(canonicalize) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])])) : value;
const hash = value => `sha256:${crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(canonicalize(value))).digest('hex')}`;
const digestLf = relative => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, relative), 'utf8').replace(/\r\n/g, '\n')).digest('hex').toUpperCase();

function dataOnly(value, seen = new WeakSet()) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number') { if (!Number.isSafeInteger(value)) throw new Error('number'); return; }
  if (typeof value !== 'object' || types.isProxy(value) || seen.has(value)) throw new Error('plain data');
  seen.add(value);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== Array.prototype) throw new Error('prototype');
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

const seconds = value => BigInt(value) * 1000000n;

function inspectionMaterial(value) { const result = copy(value); delete result.materialDigest; delete result.idempotencyKeyDigest; delete result.requestDigest; return result; }
function stableInspectionMaterial(value) { const result = inspectionMaterial(value); delete result.requestId; delete result.evaluatedAt; return result; }
function sealInspection(value) { value.materialDigest = hash(inspectionMaterial(value)); value.idempotencyKeyDigest = hash({domain: 'mission28.part13c.inspection.v1', material: stableInspectionMaterial(value)}); value.requestDigest = hash(inspectionMaterial(value)); return value; }

function inspectionFixture() {
  const input = sealInspection({schemaVersion: contract.contractVersion, tenantId: uuid(1), requestId: uuid(2), adapterFamilyId: 'provider_neutral_callback', requestedOperation: contract.inspectionRequest.requestedOperation, evaluatedAt: '2026-10-30T12:00:00.000000Z', materialDigest: '', idempotencyKeyDigest: '', requestDigest: ''});
  const resolution = {tenantId: input.tenantId, adapterFamilyId: input.adapterFamilyId, providerMode: contract.currentAuthority.providerMode, providerAccountState: contract.currentAuthority.providerAccountState, connectionState: contract.currentAuthority.connectionState, credentialState: contract.currentAuthority.credentialState, callbackEndpointState: contract.currentAuthority.callbackEndpointState, signatureVerificationState: contract.currentAuthority.signatureVerificationState, versionCatalogState: contract.currentAuthority.versionCatalogState, replayAuthorityState: contract.currentAuthority.replayAuthorityState, normalizedEvidenceCreation: contract.currentAuthority.normalizedEvidenceCreation, observedAt: input.evaluatedAt};
  return {input, trusted: copy(resolution)};
}

function validateInspection(input, trusted) {
  dataOnly(input); dataOnly(trusted);
  if (Buffer.byteLength(JSON.stringify(input)) > contract.bounds.maximumCanonicalInspectionBytes) throw new Error('size');
  exactKeys(input, contract.inspectionRequest.exactFields);
  exactKeys(trusted, contract.inspectionRequest.trustedResolutionExactFields);
  if (input.schemaVersion !== contract.contractVersion || !UUID.test(input.tenantId) || !UUID.test(input.requestId) || !OPAQUE.test(input.adapterFamilyId) || micros(input.evaluatedAt) === null) throw new Error('identity');
  if (input.requestedOperation !== contract.inspectionRequest.requestedOperation) throw new Error('operation');
  if (![input.materialDigest, input.idempotencyKeyDigest, input.requestDigest].every(item => DIGEST.test(item))) throw new Error('digest');
  if (input.materialDigest !== hash(inspectionMaterial(input)) || input.requestDigest !== hash(inspectionMaterial(input)) || input.idempotencyKeyDigest !== hash({domain: 'mission28.part13c.inspection.v1', material: stableInspectionMaterial(input)})) throw new Error('seal');
  if (trusted.tenantId !== input.tenantId || trusted.adapterFamilyId !== input.adapterFamilyId || trusted.observedAt !== input.evaluatedAt) throw new Error('trusted binding');
  const expected = inspectionFixture().trusted; expected.tenantId = input.tenantId; expected.adapterFamilyId = input.adapterFamilyId; expected.observedAt = input.evaluatedAt;
  if (hash(trusted) !== hash(expected)) throw new Error('trusted unavailable resolution');
  return true;
}

function inspect(input, trusted) {
  validateInspection(input, trusted);
  return Object.freeze({tenantId: input.tenantId, requestId: input.requestId, adapterFamilyId: input.adapterFamilyId, evaluatedAt: input.evaluatedAt, ...copy(contract.fixedDecision)});
}

function evidenceMaterial(value) { const result = copy(value); delete result.evidenceDigest; return result; }
function normalizedMaterial(value) { const result = copy(value); for (const field of contract.digestProjectionContract.normalizedEvidenceMaterialExcludesOnly) delete result[field]; return result; }
function sealEvidence(value) {
  value.normalizedEvidenceDigest = hash(normalizedMaterial(value));
  value.idempotencyKeyDigest = hash({domain: 'mission28.part13c.normalized-evidence.v1', material: normalizedMaterial(value)});
  value.evidenceDigest = hash(evidenceMaterial(value));
  return value;
}

function evidenceFixture() {
  const value = {
    schemaVersion: contract.contractVersion, tenantId: uuid(1), evidenceId: uuid(100), adapterFamilyId: 'provider_neutral_email', environment: 'testmode', providerAccountBindingId: uuid(101), providerAccountIdentityDigest: hash('account-101'), connectionId: uuid(102), connectionDigest: hash('connection-102'), callbackEndpointBindingId: uuid(103), callbackEndpointBindingDigest: hash('endpoint-103'), callbackSchemaVersion: contract.authenticationContract.acceptedCallbackVersion, providerCallbackEventIdentityDigest: hash('provider-event-100'), providerRequestIdentity: `m28:${uuid(110)}`, providerRequestIdentityDigest: hash(`m28:${uuid(110)}`), transactionId: uuid(106), runId: uuid(107), unitId: uuid(110), outboxId: uuid(108), attemptId: uuid(109), attemptSequence: 1, senderRecipientResolutionId: uuid(111), senderRecipientResolutionDigest: hash('sender-recipient-111'), permissionResolutionId: uuid(112), permissionResolutionDigest: hash('permission-112'), channelResolutionId: uuid(113), channelResolutionDigest: hash('channel-113'), statusCapabilityBindingDigest: hash('status-capability-114'), eventKind: 'provider_accepted', statusState: 'accepted', statusReasonCode: 'provider_accepted', providerEventTime: '2026-10-30T11:58:00.000000Z', signatureTimestamp: '2026-10-30T11:59:55.000000Z', receivedAt: '2026-10-30T12:00:00.000000Z', authenticatedAt: '2026-10-30T12:00:01.000000Z', observedAt: '2026-10-30T12:00:02.000000Z', signatureVerificationId: uuid(115), signatureKeyVersionId: uuid(116), signatureSchemeId: 'hmac_sha256_v1', signatureVerificationDigest: hash('signature-verification-115'), rawEvidenceDigest: hash('trusted-raw-evidence-100'), normalizedEvidenceDigest: '', evidenceSequence: 1, predecessorEvidenceId: null, predecessorEvidenceDigest: null, correctionOfEvidenceId: null, correctionOfEvidenceDigest: null, correctionReasonCode: null, idempotencyKeyDigest: '', evidenceDigest: ''
  };
  return sealEvidence(value);
}

function nextEvidence(predecessor, eventKind = 'delivered') {
  const catalog = contract.statusCatalog.find(item => item.eventKind === eventKind);
  const value = copy(predecessor);
  value.evidenceId = uuid(200 + predecessor.evidenceSequence);
  value.providerCallbackEventIdentityDigest = hash(`provider-event-${200 + predecessor.evidenceSequence}`);
  value.eventKind = eventKind;
  value.statusState = catalog.statusState;
  value.statusReasonCode = catalog.reasonCode;
  value.providerEventTime = '2026-10-30T12:01:00.000000Z';
  value.signatureTimestamp = '2026-10-30T12:01:05.000000Z';
  value.receivedAt = '2026-10-30T12:01:06.000000Z';
  value.authenticatedAt = '2026-10-30T12:01:07.000000Z';
  value.observedAt = '2026-10-30T12:01:08.000000Z';
  value.signatureVerificationId = uuid(215 + predecessor.evidenceSequence);
  value.signatureVerificationDigest = hash(`signature-verification-${215 + predecessor.evidenceSequence}`);
  value.rawEvidenceDigest = hash(`trusted-raw-evidence-${200 + predecessor.evidenceSequence}`);
  value.evidenceSequence = predecessor.evidenceSequence + 1;
  value.predecessorEvidenceId = predecessor.evidenceId;
  value.predecessorEvidenceDigest = predecessor.evidenceDigest;
  value.correctionOfEvidenceId = null;
  value.correctionOfEvidenceDigest = null;
  value.correctionReasonCode = null;
  return sealEvidence(value);
}

function correctionEvidence(predecessor, replacementState = 'failed') {
  const value = nextEvidence(predecessor, 'provider_status_correction');
  value.statusState = replacementState;
  value.statusReasonCode = 'authenticated_provider_correction';
  value.correctionOfEvidenceId = predecessor.evidenceId;
  value.correctionOfEvidenceDigest = predecessor.evidenceDigest;
  value.correctionReasonCode = contract.lineageAndCorrectionContract.correctionReasonCode;
  return sealEvidence(value);
}

const uuidFields = ['tenantId','evidenceId','providerAccountBindingId','connectionId','callbackEndpointBindingId','transactionId','runId','unitId','outboxId','attemptId','senderRecipientResolutionId','permissionResolutionId','channelResolutionId','signatureVerificationId','signatureKeyVersionId'];
const digestFields = ['providerAccountIdentityDigest','connectionDigest','callbackEndpointBindingDigest','providerCallbackEventIdentityDigest','providerRequestIdentityDigest','senderRecipientResolutionDigest','permissionResolutionDigest','channelResolutionDigest','statusCapabilityBindingDigest','signatureVerificationDigest','rawEvidenceDigest','normalizedEvidenceDigest','idempotencyKeyDigest','evidenceDigest'];
const timeFields = ['providerEventTime','signatureTimestamp','receivedAt','authenticatedAt','observedAt'];
const invariantBindings = ['tenantId','adapterFamilyId','environment','providerAccountBindingId','providerAccountIdentityDigest','connectionId','connectionDigest','callbackEndpointBindingId','callbackEndpointBindingDigest','callbackSchemaVersion','providerRequestIdentity','providerRequestIdentityDigest','transactionId','runId','unitId','outboxId','attemptId','attemptSequence','senderRecipientResolutionId','senderRecipientResolutionDigest','permissionResolutionId','permissionResolutionDigest','channelResolutionId','channelResolutionDigest','statusCapabilityBindingDigest'];
const lineageKey = value => invariantBindings.map(field => value[field]).join('\u001f');

function validateEvidence(value, predecessor, trusted) {
  dataOnly(value); dataOnly(predecessor); dataOnly(trusted);
  if (Buffer.byteLength(JSON.stringify(value)) > contract.bounds.maximumNormalizedEvidenceBytes) throw new Error('size');
  exactKeys(value, contract.normalizedEvidenceEnvelope.exactFields);
  if (hash(value) !== hash(trusted)) throw new Error('trusted evidence');
  if (value.schemaVersion !== contract.contractVersion || !uuidFields.every(field => UUID.test(value[field])) || !digestFields.every(field => DIGEST.test(value[field])) || !timeFields.every(field => micros(value[field]) !== null)) throw new Error('identity');
  if (![value.adapterFamilyId,value.environment,value.callbackSchemaVersion,value.providerRequestIdentity,value.signatureSchemeId,value.eventKind,value.statusState,value.statusReasonCode].every(item => OPAQUE.test(item))) throw new Error('opaque');
  if (value.callbackSchemaVersion !== contract.authenticationContract.acceptedCallbackVersion || value.environment !== 'testmode') throw new Error('version or environment');
  if (value.providerRequestIdentity !== `m28:${value.unitId}` || value.providerRequestIdentityDigest !== hash(value.providerRequestIdentity)) throw new Error('provider request identity');
  if (!Number.isSafeInteger(value.attemptSequence) || value.attemptSequence < 1 || value.attemptSequence > contract.bounds.maximumAttemptSequence || !Number.isSafeInteger(value.evidenceSequence) || value.evidenceSequence < 1 || value.evidenceSequence > contract.bounds.maximumEvidenceSequence) throw new Error('sequence');
  const received = micros(value.receivedAt); const authenticated = micros(value.authenticatedAt); const observed = micros(value.observedAt); const signature = micros(value.signatureTimestamp); const event = micros(value.providerEventTime);
  if (received > authenticated || authenticated > observed || authenticated - received > seconds(contract.bounds.maximumAuthenticationLatencySeconds) || signature > received + seconds(contract.bounds.maximumFutureSignatureClockSkewSeconds) || received - signature > seconds(contract.bounds.maximumAuthenticationLatencySeconds) || event > received + seconds(contract.bounds.maximumFutureSignatureClockSkewSeconds) || received - event > seconds(contract.bounds.maximumProviderEventAgeSeconds)) throw new Error('clock');
  if (value.normalizedEvidenceDigest !== hash(normalizedMaterial(value)) || value.idempotencyKeyDigest !== hash({domain: 'mission28.part13c.normalized-evidence.v1', material: normalizedMaterial(value)}) || value.evidenceDigest !== hash(evidenceMaterial(value))) throw new Error('seal');
  const catalog = contract.statusCatalog.find(item => item.eventKind === value.eventKind);
  if (!catalog) throw new Error('event');
  if (value.eventKind === 'provider_status_correction') {
    if (!predecessor || !contract.statusStateVocabulary.includes(value.statusState) || value.statusState === 'unknown' || value.statusState === predecessor.statusState || value.statusReasonCode !== catalog.reasonCode || value.correctionOfEvidenceId !== predecessor.evidenceId || value.correctionOfEvidenceDigest !== predecessor.evidenceDigest || value.correctionReasonCode !== contract.lineageAndCorrectionContract.correctionReasonCode) throw new Error('correction');
  } else if (value.statusState !== catalog.statusState || value.statusReasonCode !== catalog.reasonCode || value.correctionOfEvidenceId !== null || value.correctionOfEvidenceDigest !== null || value.correctionReasonCode !== null) throw new Error('status');
  if (predecessor) {
    if (value.evidenceSequence !== predecessor.evidenceSequence + 1 || value.predecessorEvidenceId !== predecessor.evidenceId || value.predecessorEvidenceDigest !== predecessor.evidenceDigest || value.evidenceId === predecessor.evidenceId || value.evidenceDigest === predecessor.evidenceDigest) throw new Error('predecessor');
    for (const field of invariantBindings) if (value[field] !== predecessor[field]) throw new Error('binding');
  } else if (value.evidenceSequence !== 1 || value.predecessorEvidenceId !== null || value.predecessorEvidenceDigest !== null || value.correctionOfEvidenceId !== null || value.correctionOfEvidenceDigest !== null || value.correctionReasonCode !== null) throw new Error('first evidence');
  return true;
}

class EvidenceHistory {
  constructor() { this.byId = new Map(); this.byProviderEvent = new Map(); this.byStable = new Map(); this.headByLineage = new Map(); }
  record(value, predecessor, trusted) {
    validateEvidence(value, predecessor, trusted);
    const prior = this.byId.get(value.evidenceId);
    if (prior) {
      if (prior.evidenceDigest !== value.evidenceDigest || prior.providerCallbackEventIdentityDigest !== value.providerCallbackEventIdentityDigest || prior.idempotencyKeyDigest !== value.idempotencyKeyDigest) throw new Error('identity conflict');
      return {...prior, replayed: true};
    }
    if (this.byProviderEvent.has(value.providerCallbackEventIdentityDigest)) throw new Error('provider event conflict');
    if (this.byStable.has(value.idempotencyKeyDigest)) throw new Error('semantic clone');
    const key = lineageKey(value); const headId = this.headByLineage.get(key);
    if (predecessor) {
      const storedPredecessor = this.byId.get(predecessor.evidenceId);
      if (!storedPredecessor || storedPredecessor.evidenceDigest !== predecessor.evidenceDigest || headId !== predecessor.evidenceId) throw new Error('authoritative fork');
    } else if (headId) throw new Error('authoritative root conflict');
    const stored = Object.freeze({...copy(value), replayed: false});
    this.byId.set(value.evidenceId, stored); this.byProviderEvent.set(value.providerCallbackEventIdentityDigest, value.evidenceId); this.byStable.set(value.idempotencyKeyDigest, value.evidenceId);
    this.headByLineage.set(key, value.evidenceId);
    return stored;
  }
  authoritativeHead(value) { const id = this.headByLineage.get(lineageKey(value)); return id ? this.byId.get(id) : null; }
}

function coherentReject(mutate, base = evidenceFixture(), predecessor = null) {
  const value = copy(base); mutate(value); sealEvidence(value);
  expect(() => validateEvidence(value, predecessor, copy(value))).toThrow();
}

describe('Mission 28 Part 13C authenticated callbacks and status reconciliation', () => {
  test('binds exact Part13B release provenance and every frozen authority input', () => {
    expect(contract.authority).toMatchObject({part: '13C', state: 'implementation_candidate_only', baselineCommit: '398b0ba45e3e2c150df29c2cf96d1780f76285c7', baselineTree: '5230d7113d5d023b0144142d13f5cc5d1eddffe3', contractOnlyNoMountedIngressResolverOrProviderConnection: true});
    expect(contract.part13BRelease).toMatchObject({acceptedSourceHead: '3ded5a7292e69332d37dfd61017303fe1a41e49c', acceptedTree: '5230d7113d5d023b0144142d13f5cc5d1eddffe3', pullRequest: 604, mergedMain: '398b0ba45e3e2c150df29c2cf96d1780f76285c7', productionAccepted: true, freshAudit: {verdict: 'P0=0_P1=0_P2=0_P3=0', nodeVersion: '22.23.3', focusedTests: '13/13', cumulativeMission28: '56_suites_793_tests', migrationHistory: '2_suites_40_tests', syntax: '56/56', json: '55/55', migrations: '283_through_287_no_288', changedPaths: '60_docs_tests_only', protectedPaths: 0}, release: {deploymentId: 'ba23ce8f-b4ec-4ef3-a087-4b71a669276f', deploymentStatus: 'SUCCESS', deploymentInstanceId: 'bf795dc7-7c73-4cf7-8c76-db26b3fb2e45', deploymentInstanceStatus: 'RUNNING', imageSha256: 'sha256:bd921d008b6afa6e3a11dac88b9750d696b8628f249a5cba2f4ae47f3b2012dc', canonicalStartup: 'ready'}});
    expect(contract.frozenInputs).toHaveLength(11);
    for (const item of contract.frozenInputs) expect(digestLf(item.path)).toBe(item.normalizedLfSha256);
  });

  test('keeps current callback authority fixed unavailable and no effect', () => {
    const pair = inspectionFixture(); const output = inspect(pair.input, pair.trusted);
    expect(output).toMatchObject({resultState: 'unavailable_no_authenticated_callback_authority', reasonCode: 'callback_signature_version_endpoint_and_connection_authority_unavailable', fixedLabel: 'Authenticated provider callbacks are unavailable.', callbackAccepted: false, statusEvidenceCreated: false, statusChanged: false, correctionApplied: false, retryOrResendAuthorized: false, recipientContacted: false, messageCreated: false, externalEffectCreated: false});
    expect(contract.currentAuthority).toMatchObject({adapterState: 'disabled', providerMode: 'provider_disabled', callbackEndpointState: 'unavailable', signatureVerificationState: 'unavailable', versionCatalogState: 'unavailable', replayAuthorityState: 'unavailable', normalizedEvidenceCreation: 'not_authorized', providerCallbacksAccepted: 0, statusEvidenceRecordsCreated: 0});
    const forged = copy(pair.trusted); forged.signatureVerificationState = 'verified'; expect(() => inspect(pair.input, forged)).toThrow();
  });

  test('freezes explicit nonconflated status meanings without business-outcome inference', () => {
    expect(contract.statusStateVocabulary).toEqual(['accepted','sent','delivered','opened','replied','failed','complained','unknown']);
    expect(new Set(contract.statusStateVocabulary).size).toBe(8);
    expect(contract.statusMeaningContract).toMatchObject({accepted: expect.stringContaining('not_sent_or_delivered'), sent: expect.stringContaining('not_delivered_opened_or_replied'), delivered: expect.stringContaining('not_opened_replied_or_business_outcome'), complained: expect.stringContaining('separate_suppression'), unknown: expect.stringContaining('reconciliation_required_no_resend')});
    expect(contract.statusMeaningContract.unknownDerivation).toBe('reconciliation_resolution_only_never_a_provider_supplied_or_directly_mapped_callback_status');
    expect(contract.statusCatalog.find(item => item.eventKind === 'complaint')).toMatchObject({statusState: 'complained', reasonCode: 'authenticated_complaint_received'});
    expect(part13A.statusMeaningCatalog.every(item => item.availableNow === false)).toBe(true);
    expect(part7F.futureAcceptedEvidenceKinds.map(item => item.eventKind)).toEqual(expect.arrayContaining(contract.statusCatalog.filter(item => item.eventKind !== 'provider_status_correction').map(item => item.eventKind)));
  });

  test('requires exact signature version clock and separately trusted normalized evidence', () => {
    const value = evidenceFixture();
    expect(validateEvidence(value, null, copy(value))).toBe(true);
    for (const mutate of [
      item => { item.callbackSchemaVersion = 'provider_neutral.callback.v2'; }, item => { item.signatureTimestamp = '2026-10-30T12:10:00.000000Z'; }, item => { item.authenticatedAt = '2026-10-30T11:59:59.000000Z'; }, item => { item.observedAt = '2026-10-30T12:00:00.000000Z'; }, item => { item.providerEventTime = '2026-08-01T00:00:00.000000Z'; }, item => { item.providerEventTime = '2026-10-30T12:10:00.000000Z'; }
    ]) coherentReject(mutate);
    const untrusted = copy(value); untrusted.statusState = 'delivered'; sealEvidence(untrusted); expect(() => validateEvidence(untrusted, null, copy(value))).toThrow('trusted evidence');
  });

  test('binds the callback to one exact tenant action attempt recipient permission and channel', () => {
    expect(part6C.providerRequestIdentityContract.providerRequestIdentity).toBe('m28_colon_exact_Part6A_unitId');
    expect(part6D.contractVersion).toMatch(/^mission28\.part6d\./);
    for (const mutate of [
      item => { item.tenantId = uuid(900); }, item => { item.environment = 'livemode'; }, item => { item.providerAccountBindingId = uuid(900); }, item => { item.connectionId = uuid(900); }, item => { item.callbackEndpointBindingId = uuid(900); }, item => { item.transactionId = uuid(900); }, item => { item.runId = uuid(900); }, item => { item.unitId = uuid(900); }, item => { item.outboxId = uuid(900); }, item => { item.attemptId = uuid(900); }, item => { item.attemptSequence = 2; }, item => { item.senderRecipientResolutionId = uuid(900); }, item => { item.permissionResolutionId = uuid(900); }, item => { item.channelResolutionId = uuid(900); }, item => { item.statusCapabilityBindingDigest = hash('different-capability'); }, item => { item.providerRequestIdentity = `m28:${uuid(999)}`; }
    ]) coherentReject(mutate, nextEvidence(evidenceFixture()), evidenceFixture());
  });

  test('accepts the closed ordinary status catalog and rejects strengthening or conflation', () => {
    for (const row of contract.statusCatalog.filter(item => item.eventKind !== 'provider_status_correction')) {
      const predecessor = evidenceFixture(); const value = nextEvidence(predecessor, row.eventKind);
      expect(validateEvidence(value, predecessor, copy(value))).toBe(true);
      const wrong = copy(value); wrong.statusState = row.statusState === 'failed' ? 'delivered' : 'failed'; sealEvidence(wrong); expect(() => validateEvidence(wrong, predecessor, copy(wrong))).toThrow();
    }
    coherentReject(item => { item.eventKind = 'Delivered'; });
    coherentReject(item => { item.eventKind = 'unknown_provider_label'; });
    coherentReject(item => { item.statusState = 'unknown'; item.statusReasonCode = 'unmapped'; });
  });

  test('requires exact append-only correction lineage and material change', () => {
    const first = evidenceFixture(); const delivered = nextEvidence(first); const corrected = correctionEvidence(delivered, 'failed');
    expect(validateEvidence(delivered, first, copy(delivered))).toBe(true);
    expect(validateEvidence(corrected, delivered, copy(corrected))).toBe(true);
    for (const mutate of [
      item => { item.evidenceSequence += 1; }, item => { item.predecessorEvidenceId = uuid(999); }, item => { item.predecessorEvidenceDigest = hash('wrong'); }, item => { item.evidenceId = delivered.evidenceId; }, item => { item.correctionOfEvidenceId = uuid(999); }, item => { item.correctionOfEvidenceDigest = hash('wrong'); }, item => { item.correctionReasonCode = 'provider_says_changed'; }, item => { item.statusState = delivered.statusState; }
    ]) coherentReject(mutate, corrected, delivered);
    const late = copy(corrected); late.providerEventTime = '2026-10-29T12:00:00.000000Z'; sealEvidence(late); expect(validateEvidence(late, delivered, copy(late))).toBe(true);
    expect(contract.lineageAndCorrectionContract.authoritativeHeadSelection).toContain('never_event_received_authenticated_or_observed_time');
  });

  test('permits exactly one authoritative successor and rejects a valid distinct fork from a consumed predecessor', () => {
    const history = new EvidenceHistory(); const first = evidenceFixture();
    const sent = nextEvidence(first, 'sent'); const fork = nextEvidence(first, 'delivered');
    fork.evidenceId = uuid(997); fork.providerCallbackEventIdentityDigest = hash('fork-provider-event-997'); fork.signatureVerificationId = uuid(996); fork.signatureVerificationDigest = hash('fork-signature-996'); fork.rawEvidenceDigest = hash('fork-raw-997'); sealEvidence(fork);
    expect(sent.predecessorEvidenceId).toBe(fork.predecessorEvidenceId);
    expect(sent.evidenceSequence).toBe(fork.evidenceSequence);
    expect(sent.evidenceId).not.toBe(fork.evidenceId);
    expect(sent.evidenceDigest).not.toBe(fork.evidenceDigest);
    history.record(first, null, copy(first));
    history.record(sent, first, copy(sent));
    expect(() => history.record(fork, first, copy(fork))).toThrow('authoritative fork');
    expect(history.byId.size).toBe(2);
    expect(history.authoritativeHead(first)).toMatchObject({evidenceId: sent.evidenceId, evidenceDigest: sent.evidenceDigest, statusState: 'sent'});
    expect(contract.lineageAndCorrectionContract).toMatchObject({singleAuthoritativeSuccessorPerPredecessorAndSequence: true, newAuthoritativeEvidenceMustExtendExactCurrentHead: true, consumedOrNonheadPredecessor: 'deny_authoritative_fork'});
    expect(contract.lineageAndCorrectionContract.lateReorderedDuplicateOrConflictingEvidence).toContain('non_authoritative_unknown');
  });

  test('freezes normalized idempotency and full record digest projections', () => {
    const value = evidenceFixture(); const clone = copy(value);
    clone.evidenceId = uuid(999); clone.providerCallbackEventIdentityDigest = hash('different-callback-event'); sealEvidence(clone);
    expect(clone.normalizedEvidenceDigest).toBe(value.normalizedEvidenceDigest);
    expect(clone.idempotencyKeyDigest).toBe(value.idempotencyKeyDigest);
    expect(clone.evidenceDigest).not.toBe(value.evidenceDigest);
    expect(contract.digestProjectionContract.normalizedEvidenceMaterialExcludesOnly).toEqual(['evidenceId','providerCallbackEventIdentityDigest','normalizedEvidenceDigest','evidenceSequence','predecessorEvidenceId','predecessorEvidenceDigest','correctionOfEvidenceId','correctionOfEvidenceDigest','idempotencyKeyDigest','evidenceDigest']);
    const changed = copy(value); changed.statusState = 'sent'; changed.statusReasonCode = 'provider_sent'; sealEvidence(changed); expect(changed.idempotencyKeyDigest).not.toBe(value.idempotencyKeyDigest);
  });

  test('validates before replay lookup and rejects conflicts and semantic clones', () => {
    const history = new EvidenceHistory(); const value = evidenceFixture();
    expect(history.record(value, null, copy(value)).replayed).toBe(false);
    expect(history.record(copy(value), null, copy(value)).replayed).toBe(true);
    const conflict = copy(value); conflict.statusState = 'sent'; conflict.statusReasonCode = 'provider_sent'; conflict.eventKind = 'sent'; sealEvidence(conflict); expect(() => history.record(conflict, null, copy(conflict))).toThrow('identity conflict');
    const providerConflict = copy(value); providerConflict.evidenceId = uuid(999); providerConflict.rawEvidenceDigest = hash('changed'); sealEvidence(providerConflict); expect(() => history.record(providerConflict, null, copy(providerConflict))).toThrow('provider event conflict');
    const clone = copy(value); clone.evidenceId = uuid(998); clone.providerCallbackEventIdentityDigest = hash('different-callback'); sealEvidence(clone); expect(() => history.record(clone, null, copy(clone))).toThrow('semantic clone');
    const malformed = copy(value); malformed.rawPayload = 'customer@example.test sk_secret'; expect(() => history.record(malformed, null, copy(malformed))).toThrow();
    const malformedReplay = copy(value); delete malformedReplay.schemaVersion; expect(() => history.record(malformedReplay, null, copy(malformedReplay))).toThrow();
  });

  test('rejects hostile data without invoking getters serialization or lookup hooks', () => {
    const base = evidenceFixture(); let reads = 0;
    Object.defineProperty(base, 'statusState', {enumerable: true, get() { reads += 1; return 'accepted'; }});
    expect(() => validateEvidence(base, null, evidenceFixture())).toThrow(); expect(reads).toBe(0);
    for (const hostile of [new Proxy(evidenceFixture(), {}), Object.assign(Object.create({polluted: true}), evidenceFixture()), Object.assign(evidenceFixture(), {toJSON() { return {}; }}), Object.assign(evidenceFixture(), {[Symbol('secret')]: true})]) expect(() => validateEvidence(hostile, null, evidenceFixture())).toThrow();
    const alias = evidenceFixture(); alias.nested = alias; expect(() => validateEvidence(alias, null, evidenceFixture())).toThrow();
    const sparse = [evidenceFixture()]; sparse.length = 2; expect(() => dataOnly(sparse)).toThrow();
  });

  test('retains zero raw provider private recipient message and outcome evidence', () => {
    expect(contract.rawEvidenceMinimization).toMatchObject({rawPayloadRetention: 'zero_discard_after_authenticated_bounded_normalization', rawHeadersRetention: 'zero', rawSignatureRetention: 'zero', rawProviderIdentifierRetention: 'zero_store_internal_digests_only', freeTextStatusReasonMessageBodyDocumentContactValueIpAddressUserAgentRetention: 'zero'});
    expect(contract.bounds).toMatchObject({maximumRawPayloadBytesRetained: 0, maximumRawHeadersRetained: 0, maximumRawSignatureBytesRetained: 0, maximumFreeTextStatusBytesRetained: 0});
    for (const field of ['rawPayload','rawHeaders','signature','authorizationHeader','webhookSecret','providerMessageId','providerAccountId','messageBody','documentContent','recipientEmail','recipientPhone','ipAddress','userAgent','freeTextStatus']) coherentReject(item => { item[field] = 'customer@example.test sk_secret'; });
    expect(JSON.stringify(inspect(...Object.values(inspectionFixture())))).not.toMatch(/customer@example\.test|sk_secret/i);
  });

  test('keeps runtime callback provider recipient effect accounting and money authority at zero', () => {
    expect(contract.runtimeBoundary).toEqual({newMigration: false, newTableFunctionRouteUiWorkerQueueSchedulerCallbackOrAdapter: false, mountedCallbackIngressAuthenticationVersionReplayOrStatusResolver: false, providerSandboxOrLiveCallPerformed: false, realCallbackAccepted: false, credentialOrSignatureSecretRead: false, rawProviderEvidenceStored: false, normalizedStatusEvidenceStored: false, recipientsContacted: 0, messagesCreated: 0, providerAttemptsCreated: 0, externalEffectsCreated: 0, upstreamMutationsCreated: 0, financialEffectsCreated: 0, moneyEffectsCreated: 0, latestMigration: '287_canonical_automation_estimate_quote_resolution_v1.sql', nextMigrationAbsent: '288'});
    expect(contract.laterSliceBoundary).toContain('Part13D');
    expect(contract.laterSliceBoundary).toContain('Part14');
  });

  test('reconciles Part13B released and Part13C as the sole candidate', () => {
    const roadmap = fs.readFileSync(path.join(ROOT, 'docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md'), 'utf8');
    const ledger = fs.readFileSync(path.join(ROOT, 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md'), 'utf8');
    for (const value of [roadmap, ledger]) {
      expect(value).toContain('Parts 1A–13D are released. Part 13E is the sole implementation candidate.');
      expect(value).toContain('Parts 14A–14G remain planned and unimplemented.');
      for (const identity of ['3ded5a7292e69332d37dfd61017303fe1a41e49c','5230d7113d5d023b0144142d13f5cc5d1eddffe3','398b0ba45e3e2c150df29c2cf96d1780f76285c7','ba23ce8f-b4ec-4ef3-a087-4b71a669276f','bf795dc7-7c73-4cf7-8c76-db26b3fb2e45','sha256:bd921d008b6afa6e3a11dac88b9750d696b8628f249a5cba2f4ae47f3b2012dc']) expect(value).toContain(identity);
      expect(value).toMatch(/direct applied production migration history.*unavailable.*unclaimed/i);
    }
    expect((ledger.match(/\| \*\*Released\*\* \|/g) || []).length).toBe(58);
    expect((ledger.match(/\| \*\*Implementation candidate\*\* \|/g) || []).length).toBe(1);
    expect((ledger.match(/\| Planned \/ unimplemented \|/g) || []).length).toBe(7);
    expect(ledger).toContain('| 56 | 13B | Tenant-bound connection/credential/mode boundary | **Released** |');
    expect(ledger).toContain('| 57 | 13C | Authenticated callbacks and exact status reconciliation | **Released** |');
    expect(ledger).toContain('| 58 | 13D | Provider outage/quota/degradation/circuit-breaker/fallback | **Released** |');
  });
});
