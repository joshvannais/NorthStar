'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const canonical = require('../../src/automation/canonicalJson');

const ROOT = path.resolve(__dirname, '../..');
const CONTRACT_PATH = 'docs/architecture/MISSION_28_PART6A_TRANSACTIONAL_OUTBOX_CONTRACT.json';
const CONTRACT = JSON.parse(fs.readFileSync(path.join(ROOT, CONTRACT_PATH), 'utf8'));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const TENANT = '00000000-0000-4000-8000-000000000028';
const OTHER = '00000000-0000-4000-8000-000000000029';

const copy = value => JSON.parse(JSON.stringify(value));
const hash = value => `sha256:${crypto.createHash('sha256').update(String(value)).digest('hex')}`;
const digest = (namespace, value, omit) => canonical.digest(namespace,
  omit ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== omit)) : value);
const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;

function normalizedLfSha256(relative) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, relative), 'utf8').replace(/\r\n/g, '\n')).digest('hex').toUpperCase();
}

function exact(value, fields, label) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype ||
      Reflect.ownKeys(value).length !== fields.length || fields.some(field => !Object.hasOwn(value, field))) throw new Error(label);
}

function plain(value, depth = 0) {
  if (depth > 12 || value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') throw new Error('plain data');
  if (value === null || ['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number') { if (!Number.isSafeInteger(value) || Object.is(value, -0)) throw new Error('number'); return; }
  if (typeof value !== 'object' || value instanceof String || value instanceof Number || value instanceof Boolean) throw new Error('plain data');
  if (require('node:util').types.isProxy(value)) throw new Error('proxy');
  const proto = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    if (proto !== Array.prototype || Object.keys(value).length !== value.length) throw new Error('array');
    for (const item of value) plain(item, depth + 1);
    return;
  }
  if (proto !== Object.prototype) throw new Error('prototype');
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') throw new Error('symbol');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable || key === '__proto__' || key === 'prototype' || key === 'constructor' || key === 'toJSON') throw new Error('descriptor');
    plain(descriptor.value, depth + 1);
  }
}

const templateByFamily = {
  internal_read_digest_task: 'internal_fact_digest_v1',
  owner_approval_request: 'owner_approval_request_v1',
  collection_escalation: 'reviewed_collection_work_item_v1',
};

function unit(index = 0, family = 'internal_read_digest_task') {
  const value = {
    unitId: uuid(700 + index), outboxId: uuid(800 + index), unitIndex: index, actionFamilyId: family,
    actionTemplateId: templateByFamily[family], actionTemplateDigest: hash(`template-${family}`),
    recipientSetDigest: hash(`recipients-${index}`), channelId: 'in_app_passive', providerMode: 'provider_disabled',
    effectClass: 'internal_record_only', materialDigest: hash(`material-${index}`),
    idempotencyKeyDigest: hash(`idempotency-${index}`), unitDigest: '',
  };
  value.unitDigest = digest(CONTRACT.actionUnitEnvelope.unitDigestNamespace, value, 'unitDigest');
  return value;
}

function request(units = [unit()]) {
  const sourceBinding = { tenantId: TENANT, sourceSetDigest: '', snapshotIds: [uuid(300)], snapshotDigests: [hash('snapshot')] };
  sourceBinding.sourceSetDigest = canonical.digest(CONTRACT.transactionEnvelope.sourceSetDigestNamespace,
    { tenantId: sourceBinding.tenantId, snapshotIds: sourceBinding.snapshotIds, snapshotDigests: sourceBinding.snapshotDigests });
  const value = {
    schemaVersion: CONTRACT.transactionEnvelope.schemaVersion, tenantId: TENANT, transactionId: uuid(600), runId: uuid(500),
    policyBinding: { tenantId: TENANT, policyId: uuid(100), policyVersion: 1, policyDigest: hash('policy') },
    sourceBinding,
    decisionBinding: { evaluationId: uuid(401), evaluationOutputDigest: hash('evaluation'), previewId: uuid(402), previewDigest: hash('preview'),
      analysisId: uuid(403), analysisOutputDigest: hash('analysis'), candidateId: uuid(404), collisionDecisionDigest: hash('collision'),
      collisionResult: 'selected_no_effect', actionMaterialDigest: hash('action-material'),
      actionUnitSetDigest: canonical.digest(CONTRACT.transactionEnvelope.actionUnitSetDigestNamespace, units) },
    authorizationBinding: { authorizationId: uuid(405), authorizationKind: 'per_run_approval', authorizationRecordDigest: hash('authorization'), authorizationMaterialBindingDigest: hash('authorization-material') },
    currentnessBinding: { evaluationRevalidationId: uuid(406), evaluationRevalidationDigest: hash('evaluation-revalidation'),
      preEffectRevalidationId: uuid(407), preEffectRevalidationDigest: hash('pre-effect-revalidation'), acceptedState: 'current_contract_only_no_effect_authority' },
    actionUnits: units, requestDigest: '',
  };
  value.requestDigest = digest(CONTRACT.transactionEnvelope.requestDigestNamespace, value, 'requestDigest');
  return value;
}

function trusted(value) {
  return { tenantId: value.tenantId, runId: value.runId, policyBinding: copy(value.policyBinding), sourceBinding: copy(value.sourceBinding),
    decisionBinding: copy(value.decisionBinding), authorizationBinding: copy(value.authorizationBinding), currentnessBinding: copy(value.currentnessBinding) };
}

function validate(value, resolution) {
  plain(value); plain(resolution);
  exact(value, CONTRACT.transactionEnvelope.exactFields, 'transaction shape');
  exact(value.policyBinding, CONTRACT.transactionEnvelope.policyBindingExactFields, 'policy shape');
  exact(value.sourceBinding, CONTRACT.transactionEnvelope.sourceBindingExactFields, 'source shape');
  exact(value.decisionBinding, CONTRACT.transactionEnvelope.decisionBindingExactFields, 'decision shape');
  exact(value.authorizationBinding, CONTRACT.transactionEnvelope.authorizationBindingExactFields, 'authorization shape');
  exact(value.currentnessBinding, CONTRACT.transactionEnvelope.currentnessBindingExactFields, 'currentness shape');
  for (const id of [value.tenantId, value.transactionId, value.runId, value.policyBinding.tenantId, value.policyBinding.policyId,
    value.sourceBinding.tenantId, value.decisionBinding.evaluationId, value.decisionBinding.previewId, value.decisionBinding.analysisId,
    value.decisionBinding.candidateId, value.authorizationBinding.authorizationId, value.currentnessBinding.evaluationRevalidationId,
    value.currentnessBinding.preEffectRevalidationId]) if (!UUID.test(id)) throw new Error('identity');
  if (value.policyBinding.tenantId !== value.tenantId || value.sourceBinding.tenantId !== value.tenantId ||
      !Number.isSafeInteger(value.policyBinding.policyVersion) || value.policyBinding.policyVersion < 1) throw new Error('binding');
  for (const candidate of [value.policyBinding.policyDigest, value.sourceBinding.sourceSetDigest,
    ...value.sourceBinding.snapshotDigests, value.decisionBinding.evaluationOutputDigest, value.decisionBinding.previewDigest,
    value.decisionBinding.analysisOutputDigest, value.decisionBinding.collisionDecisionDigest, value.decisionBinding.actionMaterialDigest,
    value.decisionBinding.actionUnitSetDigest,
    value.authorizationBinding.authorizationRecordDigest, value.authorizationBinding.authorizationMaterialBindingDigest,
    value.currentnessBinding.evaluationRevalidationDigest, value.currentnessBinding.preEffectRevalidationDigest, value.requestDigest])
    if (!DIGEST.test(candidate)) throw new Error('digest');
  if (!Array.isArray(value.sourceBinding.snapshotIds) || value.sourceBinding.snapshotIds.length < 1 || value.sourceBinding.snapshotIds.length > 8 ||
      value.sourceBinding.snapshotIds.length !== value.sourceBinding.snapshotDigests.length || value.sourceBinding.snapshotIds.some(id => !UUID.test(id)) ||
      new Set(value.sourceBinding.snapshotIds).size !== value.sourceBinding.snapshotIds.length ||
      new Set(value.sourceBinding.snapshotDigests).size !== value.sourceBinding.snapshotDigests.length) throw new Error('source snapshots');
  if (canonical.digest(CONTRACT.transactionEnvelope.sourceSetDigestNamespace,
    { tenantId: value.sourceBinding.tenantId, snapshotIds: value.sourceBinding.snapshotIds,
      snapshotDigests: value.sourceBinding.snapshotDigests }) !== value.sourceBinding.sourceSetDigest) throw new Error('source set digest');
  if (canonical.digest(CONTRACT.transactionEnvelope.actionUnitSetDigestNamespace, value.actionUnits) !==
      value.decisionBinding.actionUnitSetDigest) throw new Error('action unit set digest');
  if (value.decisionBinding.collisionResult !== 'selected_no_effect' ||
      value.currentnessBinding.acceptedState !== 'current_contract_only_no_effect_authority' ||
      !['per_run_approval', 'standing_authorization'].includes(value.authorizationBinding.authorizationKind)) throw new Error('accepted decision');
  if (canonical.canonicalize(resolution) !== canonical.canonicalize(trusted(value))) throw new Error('trusted resolution');
  if (!Array.isArray(value.actionUnits) || value.actionUnits.length < CONTRACT.bounds.minimumActionUnits || value.actionUnits.length > CONTRACT.bounds.maximumActionUnits) throw new Error('unit bounds');
  const identities = new Set(); const outboxIds = new Set(); const materials = new Set(); const idempotency = new Set();
  value.actionUnits.forEach((item, index) => {
    exact(item, CONTRACT.actionUnitEnvelope.exactFields, 'unit shape');
    if (!UUID.test(item.unitId) || !UUID.test(item.outboxId) || item.unitId === item.outboxId || item.unitIndex !== index ||
        !Object.hasOwn(templateByFamily, item.actionFamilyId) || item.actionTemplateId !== templateByFamily[item.actionFamilyId] ||
        item.channelId !== 'in_app_passive' || item.providerMode !== 'provider_disabled' || item.effectClass !== 'internal_record_only') throw new Error('unit binding');
    for (const candidate of [item.actionTemplateDigest, item.recipientSetDigest, item.materialDigest, item.idempotencyKeyDigest, item.unitDigest]) if (!DIGEST.test(candidate)) throw new Error('unit digest shape');
    if (digest(CONTRACT.actionUnitEnvelope.unitDigestNamespace, item, 'unitDigest') !== item.unitDigest) throw new Error('unit digest');
    if (identities.has(item.unitId) || outboxIds.has(item.outboxId) || materials.has(item.materialDigest) || idempotency.has(item.idempotencyKeyDigest)) throw new Error('unit duplicate');
    identities.add(item.unitId); outboxIds.add(item.outboxId); materials.add(item.materialDigest); idempotency.add(item.idempotencyKeyDigest);
  });
  if (digest(CONTRACT.transactionEnvelope.requestDigestNamespace, value, 'requestDigest') !== value.requestDigest) throw new Error('request digest');
}

class TransactionalStore {
  constructor() { this.transactions = new Map(); this.units = new Map(); this.outbox = new Map(); }
  stage(value, resolution) {
    validate(value, resolution);
    const prior = this.transactions.get(value.transactionId);
    if (prior) { if (prior.requestDigest !== value.requestDigest) throw new Error('transaction conflict'); return { replayed: true, commit() {} }; }
    for (const proposed of value.actionUnits) {
      for (const existing of this.units.values()) {
        if (existing.materialDigest === proposed.materialDigest ||
            existing.idempotencyKeyDigest === proposed.idempotencyKeyDigest) throw new Error('tenant-global unit replay');
      }
    }
    const staged = { receipt: copy(value), units: value.actionUnits.map(copy), outbox: value.actionUnits.map(item => ({ outboxId: item.outboxId, unitId: item.unitId, state: 'committed_unpublished', queuePublicationId: null })) };
    return { replayed: false, commit: () => {
      if (this.transactions.has(value.transactionId)) throw new Error('transaction conflict');
      this.transactions.set(value.transactionId, staged.receipt);
      for (const item of staged.units) this.units.set(item.unitId, item);
      for (const item of staged.outbox) this.outbox.set(item.outboxId, item);
    } };
  }
}

describe('Mission 28 Part 6A transactional outbox and action units', () => {
  test('freezes released Part5D, exact inputs, bounded units and later-slice denials', () => {
    expect(CONTRACT.authority).toEqual(expect.objectContaining({ part: '6A', state: 'implementation_candidate_only', baselineCommit: '8e83cf96a8f8102dd04d88e1458389ce21219dbf' }));
    expect(CONTRACT.part5DRelease).toEqual(expect.objectContaining({ acceptedSourceHead: '244a3cddb4e67a375aeab507294b87426dbfcfda', pullRequest: 568, deployment: '9ddb846c-bcbc-4024-aebe-83ca2a9c8cbf', deploymentState: 'SUCCESS_RUNNING' }));
    for (const item of CONTRACT.frozenInputs) expect(normalizedLfSha256(item.path)).toBe(item.normalizedLfSha256);
    expect(CONTRACT.atomicityContract).toEqual(expect.objectContaining({ singleAuthoritativeTransaction: true, queuePublicationBeforeCommit: 'impossible_and_denied', outboxStateAtCommit: 'committed_unpublished' }));
    expect(CONTRACT.bounds.duplicateUnitIdOutboxIdMaterialOrIdempotencyDigest)
      .toBe('deny_tenant_global_across_runs_and_transactions');
    expect(CONTRACT.trustedResolutionContract).toEqual(expect.objectContaining({ requestMayNotCreateReplaceRetargetOrSelfAttestAcceptedDecision: true, currentRuntimeResolverAvailable: false }));
    expect(CONTRACT.laterSliceBoundary.part6B).toContain('not_implemented');
  });

  test('commits one receipt, bounded units and one unpublished row per unit atomically', () => {
    const value = request([unit(0), unit(1, 'owner_approval_request'), unit(2, 'collection_escalation')]);
    const store = new TransactionalStore(); const transaction = store.stage(value, trusted(value));
    expect(store.transactions.size + store.units.size + store.outbox.size).toBe(0);
    transaction.commit();
    expect(store.transactions.size).toBe(1); expect(store.units.size).toBe(3); expect(store.outbox.size).toBe(3);
    expect([...store.outbox.values()].every(row => row.state === 'committed_unpublished' && row.queuePublicationId === null)).toBe(true);
  });

  test('rollback and validation failure expose no transaction, unit or outbox residue', () => {
    const value = request(); const store = new TransactionalStore(); store.stage(value, trusted(value));
    expect(store.transactions.size + store.units.size + store.outbox.size).toBe(0);
    const invalid = copy(value); invalid.actionUnits[0].providerMode = 'live'; invalid.actionUnits[0].unitDigest = digest(CONTRACT.actionUnitEnvelope.unitDigestNamespace, invalid.actionUnits[0], 'unitDigest'); invalid.requestDigest = digest(CONTRACT.transactionEnvelope.requestDigestNamespace, invalid, 'requestDigest');
    expect(() => store.stage(invalid, trusted(invalid))).toThrow();
    expect(store.transactions.size + store.units.size + store.outbox.size).toBe(0);
  });

  test('exact replay adds no rows and conflicting transaction reuse fails closed', () => {
    const value = request(); const store = new TransactionalStore(); store.stage(value, trusted(value)).commit();
    expect(store.stage(copy(value), trusted(value)).replayed).toBe(true);
    const conflict = request([unit(0, 'owner_approval_request')]);
    expect(() => store.stage(conflict, trusted(conflict))).toThrow('transaction conflict');
    expect(store.transactions.size).toBe(1); expect(store.units.size).toBe(1); expect(store.outbox.size).toBe(1);
  });

  test('rejects material or idempotency replay under a different run and transaction', () => {
    for (const field of ['materialDigest', 'idempotencyKeyDigest']) {
      const store = new TransactionalStore(); const original = request(); store.stage(original, trusted(original)).commit();
      const nextUnit = unit(0); nextUnit.unitId = uuid(701); nextUnit.outboxId = uuid(801);
      nextUnit.materialDigest = hash('material-next'); nextUnit.idempotencyKeyDigest = hash('idempotency-next');
      nextUnit[field] = original.actionUnits[0][field];
      nextUnit.unitDigest = digest(CONTRACT.actionUnitEnvelope.unitDigestNamespace, nextUnit, 'unitDigest');
      const replay = request([nextUnit]); replay.transactionId = uuid(601); replay.runId = uuid(501);
      replay.decisionBinding.actionUnitSetDigest = canonical.digest(CONTRACT.transactionEnvelope.actionUnitSetDigestNamespace,
        replay.actionUnits);
      replay.requestDigest = digest(CONTRACT.transactionEnvelope.requestDigestNamespace, replay, 'requestDigest');
      expect(() => store.stage(replay, trusted(replay))).toThrow('tenant-global unit replay');
      expect(store.transactions.size).toBe(1); expect(store.units.size).toBe(1); expect(store.outbox.size).toBe(1);
    }
  });

  test('rejects retargeted tenant, policy, source, run, decision, authorization and currentness even after redigest', () => {
    const base = request(); const attacks = [];
    for (const mutate of [
      value => { value.tenantId = OTHER; value.policyBinding.tenantId = OTHER; value.sourceBinding.tenantId = OTHER; },
      value => { value.policyBinding.policyId = uuid(999); }, value => { value.sourceBinding.sourceSetDigest = hash('other-source'); },
      value => { value.runId = uuid(999); }, value => { value.decisionBinding.candidateId = uuid(999); },
      value => { value.authorizationBinding.authorizationRecordDigest = hash('other-authorization'); },
      value => { value.currentnessBinding.preEffectRevalidationDigest = hash('other-currentness'); },
    ]) { const attacked = copy(base); mutate(attacked); attacked.requestDigest = digest(CONTRACT.transactionEnvelope.requestDigestNamespace, attacked, 'requestDigest'); attacks.push(attacked); }
    for (const attacked of attacks) expect(() => validate(attacked, trusted(base))).toThrow();
  });

  test('rejects duplicate source identities or digests after complete digest recomputation', () => {
    for (const duplicate of ['id', 'digest']) {
      const attacked = request();
      attacked.sourceBinding.snapshotIds.push(duplicate === 'id' ? attacked.sourceBinding.snapshotIds[0] : uuid(301));
      attacked.sourceBinding.snapshotDigests.push(attacked.sourceBinding.snapshotDigests[0]);
      attacked.sourceBinding.sourceSetDigest = canonical.digest(CONTRACT.transactionEnvelope.sourceSetDigestNamespace,
        { tenantId: attacked.sourceBinding.tenantId, snapshotIds: attacked.sourceBinding.snapshotIds,
          snapshotDigests: attacked.sourceBinding.snapshotDigests });
      attacked.requestDigest = digest(CONTRACT.transactionEnvelope.requestDigestNamespace, attacked, 'requestDigest');
      expect(() => validate(attacked, trusted(attacked))).toThrow('source snapshots');
    }
  });

  test('rejects non-selected, stale, suppressed, superseded or unavailable decisions', () => {
    for (const collisionResult of ['suppressed', 'superseded', 'unavailable', 'selected']) {
      const attacked = request(); attacked.decisionBinding.collisionResult = collisionResult; attacked.requestDigest = digest(CONTRACT.transactionEnvelope.requestDigestNamespace, attacked, 'requestDigest');
      expect(() => validate(attacked, trusted(attacked))).toThrow('accepted decision');
    }
    const stale = request(); stale.currentnessBinding.acceptedState = 'stale_fail_closed'; stale.requestDigest = digest(CONTRACT.transactionEnvelope.requestDigestNamespace, stale, 'requestDigest');
    expect(() => validate(stale, trusted(stale))).toThrow('accepted decision');
  });

  test('rejects gaps, overflow, duplicates, cross-template substitutions and external/provider units', () => {
    const attacks = [];
    const gap = request([unit(0), unit(2)]); gap.requestDigest = digest(CONTRACT.transactionEnvelope.requestDigestNamespace, gap, 'requestDigest'); attacks.push(gap);
    const duplicate = request([unit(0), unit(1)]); duplicate.actionUnits[1].materialDigest = duplicate.actionUnits[0].materialDigest; duplicate.actionUnits[1].unitDigest = digest(CONTRACT.actionUnitEnvelope.unitDigestNamespace, duplicate.actionUnits[1], 'unitDigest'); duplicate.requestDigest = digest(CONTRACT.transactionEnvelope.requestDigestNamespace, duplicate, 'requestDigest'); attacks.push(duplicate);
    const template = request(); template.actionUnits[0].actionTemplateId = 'owner_approval_request_v1'; template.actionUnits[0].unitDigest = digest(CONTRACT.actionUnitEnvelope.unitDigestNamespace, template.actionUnits[0], 'unitDigest'); template.requestDigest = digest(CONTRACT.transactionEnvelope.requestDigestNamespace, template, 'requestDigest'); attacks.push(template);
    const external = request(); external.actionUnits[0].effectClass = 'external_provider'; external.actionUnits[0].unitDigest = digest(CONTRACT.actionUnitEnvelope.unitDigestNamespace, external.actionUnits[0], 'unitDigest'); external.requestDigest = digest(CONTRACT.transactionEnvelope.requestDigestNamespace, external, 'requestDigest'); attacks.push(external);
    const overflow = request(Array.from({ length: 33 }, (_, index) => unit(index))); attacks.push(overflow);
    for (const attacked of attacks) expect(() => validate(attacked, trusted(attacked))).toThrow();
  });

  test('rejects malformed replay/coalescing inputs before identity lookup without invoking hooks', () => {
    const base = request(); const store = new TransactionalStore(); store.stage(base, trusted(base)).commit(); let calls = 0;
    const accessor = copy(base); Object.defineProperty(accessor.actionUnits[0], 'materialDigest', { enumerable: true, get() { calls += 1; return hash('hook'); } });
    expect(() => store.stage(accessor, trusted(base))).toThrow(); expect(calls).toBe(0);
    const attacks = [copy(base), copy(base), copy(base), copy(base)]; attacks[0].unexpected = true; delete attacks[1].schemaVersion;
    Object.setPrototypeOf(attacks[2].decisionBinding, { polluted: true }); Object.defineProperty(attacks[3], Symbol('hidden'), { enumerable: true, value: true });
    for (const attacked of attacks) expect(() => store.stage(attacked, trusted(base))).toThrow();
    expect(() => store.stage(new Proxy(copy(base), {}), trusted(base))).toThrow();
    expect(store.transactions.size).toBe(1); expect(store.units.size).toBe(1); expect(store.outbox.size).toBe(1);
  });

  test('migration is closed, tenant-private, immutable and contains no publication path', () => {
    const sql = fs.readFileSync(path.join(ROOT, 'migrations/275_canonical_automation_transactional_outbox_v1.sql'), 'utf8');
    for (const token of ['canonical_automation_action_transactions_v1', 'canonical_automation_action_units_v1', 'canonical_automation_action_outbox_v1',
      'canonical_automation_store_action_transaction_v1', 'ENABLE ROW LEVEL SECURITY', 'FORCE ROW LEVEL SECURITY',
      'canonical_automation_action_outbox_v1_immutable', "state='committed_unpublished'", 'queue_publication_id IS NULL',
      'UNIQUE(organization_id,idempotency_key_digest)', 'UNIQUE(organization_id,material_digest)',
      'REVOKE ALL ON FUNCTION public.canonical_automation_store_action_transaction_v1']) expect(sql).toContain(token);
    expect(sql).not.toContain('UNIQUE(organization_id,run_id,idempotency_key_digest)');
    expect(sql).not.toContain('UNIQUE(organization_id,run_id,material_digest)');
    for (const forbidden of ['CREATE FUNCTION public.canonical_automation_claim', 'CREATE FUNCTION public.canonical_automation_publish',
      'provider_attempt', 'delivery_state', 'fetch(', 'axios', 'twilio', 'retell']) expect(sql).not.toContain(forbidden);
  });

  test('records Part5D released, only Part6A candidate, later slices planned and migration275/no276', () => {
    const roadmap = fs.readFileSync(path.join(ROOT, 'docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md'), 'utf8');
    const ledger = fs.readFileSync(path.join(ROOT, 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md'), 'utf8');
    for (const document of [roadmap, ledger]) {
      expect(document).toContain('Parts 1A–13A are released. Part 13B is the sole implementation candidate.');
      expect(document).toContain('Parts 13C–14G remain planned and unimplemented.');
      expect(document).toContain('244a3cddb4e67a375aeab507294b87426dbfcfda');
      expect(document).toContain('9ddb846c-bcbc-4024-aebe-83ca2a9c8cbf');
    }
    expect(ledger).toContain('| 20 | 5D | Collision/suppression engine and no-effect dry run | **Released** |');
    expect(ledger).toContain('| 21 | 6A | Transactional outbox and action units | **Released** |');
    expect(ledger).toContain('| 22 | 6B | Durable time-zone-aware scheduler | **Released** |');
    expect((ledger.match(/\*\*Implementation candidate\*\*/g) || [])).toHaveLength(1);
    expect((ledger.match(/Planned \/ unimplemented/g) || [])).toHaveLength(10);
    const migrations = fs.readdirSync(path.join(ROOT, 'migrations')).filter(name => /^\d+.*\.sql$/.test(name)).sort();
    expect(migrations.at(-1)).toBe('287_canonical_automation_estimate_quote_resolution_v1.sql');
    expect(migrations.some(name => name.startsWith('288_'))).toBe(false);
    expect(migrations.filter(name => name.startsWith('281_'))).toEqual(['281_canonical_automation_sender_recipient_authority_v1.sql']);
  });
});
