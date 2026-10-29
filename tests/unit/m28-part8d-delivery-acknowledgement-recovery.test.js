'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { types: { isProxy } } = require('util');

const ROOT = path.resolve(__dirname, '../..');
const CONTRACT_PATH = path.join(ROOT, 'docs/architecture/MISSION_28_PART8D_DELIVERY_ACKNOWLEDGEMENT_RECOVERY_CONTRACT.json');
const CONTRACT_MD = path.join(ROOT, 'docs/architecture/MISSION_28_PART8D_DELIVERY_ACKNOWLEDGEMENT_RECOVERY_CONTRACT.md');
const PART7F_PATH = path.join(ROOT, 'docs/architecture/MISSION_28_PART7F_DELIVERY_EVIDENCE_CONTRACT.json');
const PART8C_PATH = path.join(ROOT, 'docs/architecture/MISSION_28_PART8C_SHARED_DELIVERY_VERSION_IDEMPOTENCY_CONTRACT.json');
const ROADMAP = path.join(ROOT, 'docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md');
const LEDGER = path.join(ROOT, 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md');
const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8'));
const part7F = JSON.parse(fs.readFileSync(PART7F_PATH, 'utf8'));
const part8C = JSON.parse(fs.readFileSync(PART8C_PATH, 'utf8'));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const UTC = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$/;
const copy = value => JSON.parse(JSON.stringify(value));
const hash = value => `sha256:${crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
const digestLf = relative => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, relative), 'utf8').replace(/\r\n/g, '\n')).digest('hex').toUpperCase();

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

function requestOf(input) {
  const request = copy(input);
  delete request.requestDigest;
  return request;
}

function semanticProjectionOf(input) {
  const material = copy(input);
  delete material.statusProjectionId;
  delete material.evaluatedAt;
  delete material.requestDigest;
  return material;
}

function seal(input) {
  input.requestDigest = hash(requestOf(input));
  return input;
}

function fixture(operation = 'status_read', deliveryMode = 'manual_quick_send') {
  const mode = part8C.deliveryModes.find(item => item.deliveryMode === deliveryMode);
  return seal({
    schemaVersion: 'mission28.part8d.delivery-status-projection.v1',
    tenantId: '00000000-0000-4000-8000-000000000001',
    statusProjectionId: '00000000-0000-4000-8000-000000000002',
    operation,
    deliveryMaterialBinding: {
      deliveryRequestId: '00000000-0000-4000-8000-000000000003',
      deliveryMode,
      documentVersionId: '00000000-0000-4000-8000-000000000004',
      materialDigest: `sha256:${'05'.repeat(32)}`,
      idempotencyKeyDigest: `sha256:${'06'.repeat(32)}`,
      modeResultState: mode.currentResult
    },
    deliveryEvidenceBinding: null,
    recoveryBinding: null,
    evaluatedAt: '2026-10-28T15:00:00.000000Z',
    requestDigest: ''
  });
}

function project(input, trusted) {
  dataGate(input); dataGate(trusted);
  exactKeys(input, contract.projectionEnvelope.exactFields);
  exactKeys(input.deliveryMaterialBinding, contract.projectionEnvelope.deliveryMaterialBindingExactFields);
  if (JSON.stringify(input) !== JSON.stringify(trusted)) throw new Error('trusted resolution');
  for (const value of [input.tenantId, input.statusProjectionId, input.deliveryMaterialBinding.deliveryRequestId, input.deliveryMaterialBinding.documentVersionId]) {
    if (typeof value !== 'string' || !UUID.test(value)) throw new Error('uuid');
  }
  for (const value of [input.deliveryMaterialBinding.materialDigest, input.deliveryMaterialBinding.idempotencyKeyDigest, input.requestDigest]) {
    if (typeof value !== 'string' || !DIGEST.test(value)) throw new Error('digest');
  }
  if (typeof input.schemaVersion !== 'string' || input.schemaVersion !== 'mission28.part8d.delivery-status-projection.v1' ||
      typeof input.evaluatedAt !== 'string' || !UTC.test(input.evaluatedAt)) throw new Error('primitive');
  const operation = contract.operations.find(item => item.operation === input.operation);
  if (!operation) throw new Error('operation');
  const mode = part8C.deliveryModes.find(item => item.deliveryMode === input.deliveryMaterialBinding.deliveryMode);
  if (!mode || input.deliveryMaterialBinding.modeResultState !== mode.currentResult) throw new Error('Part8C binding');
  if (input.deliveryEvidenceBinding !== null || input.recoveryBinding !== null) throw new Error('unavailable evidence');
  if (input.requestDigest !== hash(requestOf(input))) throw new Error('canonical digest');
  const status = contract.exactStatusLabels.find(item => item.labelId === operation.currentStatusLabelId);
  const outcome = contract.exactOperationLabels.find(item => item.labelId === operation.operationLabelId);
  if (!status || !status.currentLaunchAvailable || !outcome) throw new Error('label contract');
  return Object.freeze({
    statusProjectionId: input.statusProjectionId,
    currentStatusLabelId: status.labelId,
    currentStatusLabel: status.fixedLabel,
    operationLabelId: outcome.labelId,
    operationLabel: outcome.fixedLabel,
    resultState: operation.currentResult,
    requestDigest: input.requestDigest,
    messageCreated: false,
    providerAttemptCreated: false,
    revokeEffectCreated: false,
    resendEffectCreated: false,
    recoveryEffectCreated: false,
    externalEffectCreated: false
  });
}

class ProjectionHistory {
  constructor() { this.byId = new Map(); this.bySemantic = new Map(); }
  record(input, trusted) {
    const result = project(input, trusted);
    const previous = this.byId.get(input.statusProjectionId);
    if (previous) {
      if (previous.requestDigest !== input.requestDigest) throw new Error('identity conflict');
      return Object.freeze({...previous, replayed: true});
    }
    const semanticDigest = hash(semanticProjectionOf(input));
    if (this.bySemantic.has(semanticDigest)) throw new Error('clone');
    const stored = Object.freeze({...result, semanticDigest, replayed: false});
    this.byId.set(input.statusProjectionId, stored);
    this.bySemantic.set(semanticDigest, input.statusProjectionId);
    return stored;
  }
}

describe('Mission 28 Part 8D delivery acknowledgement, recovery and exact labels', () => {
  test('binds the corrected Part8C release and every frozen prerequisite hash', () => {
    expect(contract.authority).toMatchObject({baselineCommit: '33b5ad3d58a8604f0236808b4fda253a3208b677', baselineTree: '086d6bf6cc822f9e57a4e31c17aa7fcc51311340', state: 'implementation_candidate_only'});
    expect(contract.part8CRelease).toMatchObject({acceptedSourceHead: 'bf768e431956a172c9010a00f94497bfe4b68d75', pullRequest: 583, mergedMain: '33b5ad3d58a8604f0236808b4fda253a3208b677', deployment: '927313ac-0e60-4552-8130-023fe266d327', runningInstance: 'b296e2f1-5aad-4b58-851c-645ddb573431', imageSha256: '95251721696f9cd2afb33c6d07d7fbaf52f1e51600ef9c4e3d35e1da66fb2b6c', productionMigration: '283_of_283_through_287_no_288'});
    for (const input of contract.frozenInputs) expect(digestLf(input.path)).toBe(input.normalizedLfSha256);
  });

  test.each(contract.operations)('projects $operation to exact fixed no-effect labels', operation => {
    const input = fixture(operation.operation);
    expect(project(input, copy(input))).toEqual(expect.objectContaining({
      currentStatusLabelId: operation.currentStatusLabelId,
      operationLabelId: operation.operationLabelId,
      resultState: operation.currentResult,
      messageCreated: false,
      providerAttemptCreated: false,
      revokeEffectCreated: false,
      resendEffectCreated: false,
      recoveryEffectCreated: false,
      externalEffectCreated: false
    }));
  });

  test('keeps fixed labels closed, nonreflective and weaker than their exact evidence', () => {
    const statusIds = contract.exactStatusLabels.map(item => item.labelId);
    const operationIds = contract.exactOperationLabels.map(item => item.labelId);
    expect(new Set(statusIds).size).toBe(statusIds.length);
    expect(new Set(operationIds).size).toBe(operationIds.length);
    expect(contract.exactStatusLabels.filter(item => item.currentLaunchAvailable).map(item => item.labelId)).toEqual(['delivery_not_created']);
    for (const item of [...contract.exactStatusLabels, ...contract.exactOperationLabels]) {
      expect(item.fixedLabel).toEqual(expect.any(String));
      expect(item.fixedLabel.length).toBeGreaterThan(5);
      expect(item.fixedLabel).not.toMatch(/@|sk_|token|999999|customerId|providerId/i);
    }
    expect(contract.truthAndPrecedenceContract).toMatchObject({
      queuePreviewResolutionOrComposer: expect.stringMatching(/^never_/),
      providerAccepted: expect.stringMatching(/^never_/),
      sent: expect.stringMatching(/^never_/),
      delivered: expect.stringMatching(/^never_/),
      viewed: 'strongest_claim_is_opened_only',
      ambiguousSimultaneousEvidence: 'fail_closed_to_delivery_status_unknown_reconciliation_required_no_resend'
    });
  });

  test('maps every reserved evidence label to the exact Part7F vocabulary without making it current authority', () => {
    const evidenceKinds = new Set(part7F.futureAcceptedEvidenceKinds.map(item => item.eventKind));
    const requirements = contract.exactStatusLabels.filter(item => !item.currentLaunchAvailable).map(item => item.requiredEvidence).join(' ');
    for (const kind of ['provider_accepted', 'sent', 'delivered', 'opened', 'bounced', 'blocked', 'complaint', 'undeliverable', 'provider_status_correction']) expect(evidenceKinds.has(kind)).toBe(true);
    expect(requirements).toMatch(/provider_accepted/);
    expect(requirements).toMatch(/sent_event/);
    expect(requirements).toMatch(/delivered_event/);
    expect(requirements).toMatch(/opened_event/);
    expect(contract.currentAvailability.deliveryAcknowledgement).toMatch(/^unavailable_/);
  });

  test('separates provider acknowledgement, sent, delivered and viewed evidence', () => {
    expect(contract.acknowledgementContract).toMatchObject({
      providerAcknowledgement: expect.stringMatching(/provider_accepted_only_and_never_delivery/),
      sendAcknowledgement: expect.stringMatching(/sent_only_and_never_delivery/),
      deliveryAcknowledgement: expect.stringMatching(/exact_Part7F_delivered_event/),
      viewAcknowledgement: expect.stringMatching(/strongest_claim_is_opened_only/),
      currentLaunch: expect.stringMatching(/^no_provider_attempt_message_delivery_or_view_exists/),
      candidateQueuePreviewResolutionComposerProviderStatusOrLabelNeverCreatesAcknowledgement: true
    });
  });

  test('preserves the corrected Part8C stable idempotency identity and immutable projection history', () => {
    expect(part8C.sharedVersionCurrentnessAndIdempotencyContract.idempotencyKeyDigest).toMatch(/excluding_deliveryRequestId_evaluatedAt_materialDigest_idempotencyKeyDigest_and_requestDigest/);
    const history = new ProjectionHistory();
    const first = fixture();
    expect(history.record(first, copy(first)).replayed).toBe(false);
    expect(history.record(copy(first), copy(first)).replayed).toBe(true);
    const sameIdentityLater = copy(first); sameIdentityLater.evaluatedAt = '2026-10-28T15:05:00.000000Z'; seal(sameIdentityLater);
    expect(()=>history.record(sameIdentityLater, copy(sameIdentityLater))).toThrow('identity conflict');
    const clone = copy(first); clone.statusProjectionId = '00000000-0000-4000-8000-000000000099'; clone.evaluatedAt = '2026-10-28T15:05:00.000000Z'; seal(clone);
    expect(()=>history.record(clone, copy(clone))).toThrow('clone');
    expect(contract.duplicatePreventionContract).toMatchObject({sameSemanticMaterialNewRequestOrTime: 'deny_clone_or_replay_reuse', sameRequestChangedTimeMaterialEvidenceOrOperation: 'deny_identity_conflict', sameProjectionSameRequestDigest: 'idempotent_no_effect_projection_replay'});
  });

  test('denies candidate-created acknowledgement, revoke, resend, recovery and status evidence', () => {
    for (const mutation of [
      value => { value.deliveryEvidenceBinding = {eventKind: 'delivered'}; },
      value => { value.recoveryBinding = {resultState: 'bounded_history_verified_no_effect'}; },
      value => { value.operation = 'provider_revoke'; },
      value => { value.operation = 'send_again'; },
      value => { value.statusLabel = 'Delivered to customer@example.test'; },
      value => { value.deliveryMaterialBinding.modeResultState = 'delivered'; }
    ]) {
      const input = fixture(); mutation(input); seal(input);
      expect(()=>project(input, copy(input))).toThrow();
    }
    expect(contract.revokeResendRecoveryContract).toMatchObject({
      currentRevoke: expect.stringMatching(/^unavailable_/),
      currentResend: expect.stringMatching(/^unavailable_/),
      currentRecovery: expect.stringMatching(/^unavailable_/)
    });
    expect(contract.laterSliceBoundary).toMatchObject({
      part9A: expect.stringMatching(/not_implemented$/),
      laterRecipientResponseAndCorrection: expect.stringMatching(/unimplemented$/)
    });
  });

  test('fails closed on cross-tenant, cross-request, mode-state and separately trusted resolution mismatch', () => {
    for (const mutation of [
      value => { value.tenantId = '00000000-0000-4000-8000-000000000099'; },
      value => { value.deliveryMaterialBinding.deliveryRequestId = '00000000-0000-4000-8000-000000000099'; },
      value => { value.deliveryMaterialBinding.documentVersionId = '00000000-0000-4000-8000-000000000099'; },
      value => { value.deliveryMaterialBinding.materialDigest = `sha256:${'99'.repeat(32)}`; },
      value => { value.deliveryMaterialBinding.idempotencyKeyDigest = `sha256:${'98'.repeat(32)}`; },
      value => { value.deliveryMaterialBinding.deliveryMode = 'native_handoff'; },
      value => { value.deliveryMaterialBinding.modeResultState = 'unavailable_no_effect_policy_delivery_not_mounted'; }
    ]) {
      const candidate = fixture(); mutation(candidate); seal(candidate);
      expect(()=>project(candidate, fixture())).toThrow();
    }
  });

  test('rejects malformed identifiers, digests, times and digest recomputation attacks', () => {
    for (const mutation of [
      value => { value.tenantId = 'not-a-uuid'; },
      value => { value.statusProjectionId = ''; },
      value => { value.deliveryMaterialBinding.materialDigest = 'not-a-digest'; },
      value => { value.deliveryMaterialBinding.idempotencyKeyDigest = new String(`sha256:${'06'.repeat(32)}`); },
      value => { value.evaluatedAt = 'tomorrow'; },
      value => { value.requestDigest = `sha256:${'99'.repeat(32)}`; }
    ]) {
      const input = fixture(); mutation(input);
      expect(()=>project(input, copy(input))).toThrow();
    }
  });

  test('rejects unknown, missing, accessor, symbol, proxy, toJSON, custom-prototype and alias data before hooks', () => {
    for (const mutation of [
      value => { value.extra = 'customer@example.test'; },
      value => { delete value.requestDigest; },
      value => { value.deliveryMaterialBinding.toJSON = () => ({delivered: true}); },
      value => { Object.setPrototypeOf(value.deliveryMaterialBinding, {}); },
      value => { value.deliveryMaterialBinding = value; }
    ]) {
      const input = fixture(); mutation(input);
      expect(()=>project(input, fixture())).toThrow();
    }
    let getters = 0;
    const accessor = fixture();
    Object.defineProperty(accessor.deliveryMaterialBinding, 'materialDigest', {enumerable: true, get() { getters += 1; return `sha256:${'05'.repeat(32)}`; }});
    expect(()=>project(accessor, fixture())).toThrow(); expect(getters).toBe(0);
    const symbol = fixture(); symbol[Symbol('provider-secret')] = 'sk_secret'; expect(()=>project(symbol, fixture())).toThrow();
    let traps = 0;
    const proxy = new Proxy(fixture(), {get() { traps += 1; throw new Error('trap'); }, ownKeys() { traps += 1; throw new Error('trap'); }});
    expect(()=>project(proxy, fixture())).toThrow(); expect(traps).toBe(0);
  });

  test('keeps recovery evidence no-effect and blocks resend on uncertain or unreconciled history', () => {
    expect(contract.revokeResendRecoveryContract.recovery).toMatch(/never_restarts_reclaims_resends_or_creates_provider_authority/);
    expect(contract.revokeResendRecoveryContract.resend).toMatch(/never_reuse_or_relabel_the_Part8C_request_material_or_stable_idempotency_identity/);
    expect(contract.truthAndPrecedenceContract.uncertainConflictOrPartialCallback).toBe('delivery_status_unknown_reconciliation_required_and_resend_blocked');
    expect(contract.exactOperationLabels).toEqual(expect.arrayContaining([
      expect.objectContaining({labelId: 'resend_blocked_reconciliation_required'}),
      expect.objectContaining({labelId: 'recovery_assessed_no_resend_authority'}),
      expect.objectContaining({labelId: 'revoke_requested_not_revocation_proof'})
    ]));
  });

  test('freezes zero-effect runtime and privacy boundaries with migration287 latest and no288', () => {
    expect(Object.values(contract.privacyAndEffects).every(value => value === 0)).toBe(true);
    expect(contract.runtimeBoundary).toMatchObject({newMigration: false, newTableFunctionRouteOrUi: false, mountedSchedulerWorkerQueueOrPolicyExecutor: false, providerAdapterCallbackOrInboundReceiver: false, recipientMessageDeliveryViewRevokeResendOrRecovery: false, nextMigrationAbsent: '288'});
    const migrations = fs.readdirSync(path.join(ROOT, 'migrations')).filter(name => /^\d+_/.test(name)).sort();
    expect(migrations.at(-1)).toBe('287_canonical_automation_estimate_quote_resolution_v1.sql');
    expect(migrations.some(name => name.startsWith('288_'))).toBe(false);
  });

  test('roadmap and ledger record Part8C released, Part8D candidate only and Part9A+ planned', () => {
    const roadmap = fs.readFileSync(ROADMAP, 'utf8');
    const ledger = fs.readFileSync(LEDGER, 'utf8');
    const markdown = fs.readFileSync(CONTRACT_MD, 'utf8');
    for (const document of [roadmap, ledger]) {
      expect(document).toContain('Parts 1A–8C are released. Part 8D is the sole implementation candidate.');
      expect(document).toContain('Parts 9A–14G remain planned and unimplemented.');
      expect(document).toContain('927313ac-0e60-4552-8130-023fe266d327');
      expect(document).toContain('sha256:95251721696f9cd2afb33c6d07d7fbaf52f1e51600ef9c4e3d35e1da66fb2b6c');
    }
    expect(ledger).toContain('| 35 | 8C | Shared quick-send/native/policy version and idempotency contract | **Released** |');
    expect(ledger).toContain('| 36 | 8D | Delivery acknowledgement, revoke/resend/recovery and exact labels | **Implementation candidate** |');
    expect(markdown).toContain('No migration 288');
  });
});
