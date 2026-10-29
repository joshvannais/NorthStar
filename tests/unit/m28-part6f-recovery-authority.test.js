'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { types: { isProxy } } = require('node:util');
const canonical = require('../../src/automation/canonicalJson');

const ROOT = path.resolve(__dirname, '../..');
const CONTRACT = require('../../docs/architecture/MISSION_28_PART6F_RECOVERY_AUTHORITY_CONTRACT.json');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const TIME = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$/;
const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const hash = value => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
const copy = value => JSON.parse(JSON.stringify(value));

function normalizedLfSha256(relative) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, relative), 'utf8').replace(/\r\n?/g, '\n')).digest('hex').toUpperCase();
}
function plain(value, seen = new Set()) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return;
  if (typeof value !== 'object' || isProxy(value) || seen.has(value) || Reflect.ownKeys(value).some(key => typeof key !== 'string')) throw new Error('plain');
  seen.add(value); const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || Object.keys(value).length !== value.length) throw new Error('array');
    for (const item of value) plain(item, seen);
  } else {
    if (Object.getPrototypeOf(value) !== Object.prototype || Object.keys(descriptors).some(key => key === 'toJSON' || !descriptors[key].enumerable || !('value' in descriptors[key]))) throw new Error('object');
    for (const descriptor of Object.values(descriptors)) plain(descriptor.value, seen);
  }
}
function exact(value, fields, label) {
  if (!value || Object.keys(value).length !== fields.length || fields.some(field => !Object.prototype.hasOwnProperty.call(value, field))) throw new Error(`${label} shape`);
}
function trusted(value) {
  const result = copy(value); delete result.schemaVersion; delete result.recoveryId; delete result.requestDigest; return result;
}
function reseal(value) {
  value.requestDigest = canonical.digest(CONTRACT.recoveryEnvelope.requestDigestNamespace, Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'requestDigest')));
  return value;
}
function fixture(suffix = 1, recoveryKind = 'process_restart') {
  const incident = CONTRACT.incidentKinds.find(item => item.id === recoveryKind);
  return reseal({
    schemaVersion: CONTRACT.recoveryEnvelope.schemaVersion,
    tenantId: uuid(28), recoveryId: uuid(800000 + suffix), recoveryKind,
    incidentBinding: { incidentId: uuid(810000 + suffix), incidentDigest: hash(`incident-${suffix}`), evidenceState: incident.evidenceState },
    transactionBinding: { transactionId: uuid(10000 + suffix), runId: uuid(11000 + suffix), policyId: uuid(100), policyVersion: 1, policyDigest: hash('policy'), sourceSetDigest: hash('sources'), unitCount: 2 },
    actorBinding: { actorId: uuid(10), sessionId: uuid(11), membershipId: uuid(10), membershipRole: recoveryKind === 'disaster_restore' ? 'owner' : 'admin', requestedAt: '2026-10-28T12:00:00.000000Z' },
    requestDigest: '',
  });
}
function validate(value, resolution) {
  plain(value); plain(resolution);
  exact(value, CONTRACT.recoveryEnvelope.exactFields, 'root');
  exact(value.incidentBinding, CONTRACT.recoveryEnvelope.incidentBindingExactFields, 'incident');
  exact(value.transactionBinding, CONTRACT.recoveryEnvelope.transactionBindingExactFields, 'transaction');
  exact(value.actorBinding, CONTRACT.recoveryEnvelope.actorBindingExactFields, 'actor');
  if (value.schemaVersion !== CONTRACT.recoveryEnvelope.schemaVersion || !UUID.test(value.tenantId) || !UUID.test(value.recoveryId)) throw new Error('identity');
  const incident = CONTRACT.incidentKinds.find(item => item.id === value.recoveryKind);
  if (!incident || !UUID.test(value.incidentBinding.incidentId) || !DIGEST.test(value.incidentBinding.incidentDigest) || value.incidentBinding.evidenceState !== incident.evidenceState) throw new Error('incident');
  const binding = value.transactionBinding;
  if (![binding.transactionId, binding.runId, binding.policyId].every(item => UUID.test(item)) || !Number.isSafeInteger(binding.policyVersion) || binding.policyVersion < 1 || ![binding.policyDigest, binding.sourceSetDigest].every(item => DIGEST.test(item)) || !Number.isInteger(binding.unitCount) || binding.unitCount < 1 || binding.unitCount > CONTRACT.recoveryEnvelope.maximumRunUnits) throw new Error('transaction');
  if (![value.actorBinding.actorId, value.actorBinding.sessionId, value.actorBinding.membershipId].every(item => UUID.test(item)) || !['owner', 'admin'].includes(value.actorBinding.membershipRole) || !TIME.test(value.actorBinding.requestedAt) || (value.recoveryKind === 'disaster_restore' && value.actorBinding.membershipRole !== 'owner')) throw new Error('actor');
  if (!DIGEST.test(value.requestDigest)) throw new Error('digest');
  const sealed = copy(value); reseal(sealed); if (sealed.requestDigest !== value.requestDigest) throw new Error('digest');
  if (canonical.canonicalize(resolution) !== canonical.canonicalize(trusted(value))) throw new Error('trusted');
  return value;
}
function materialDigest(value) {
  return canonical.digest(CONTRACT.recoveryEnvelope.materialDigestNamespace, Object.fromEntries(Object.entries(value).filter(([key]) => !['recoveryId', 'requestDigest'].includes(key))));
}
class RecoveryStore {
  constructor() { this.events = new Map(); this.material = new Set(); }
  apply(input, resolution, derivedItems) {
    const value = validate(input, resolution); const existing = this.events.get(value.recoveryId);
    if (existing) { if (existing.requestDigest !== value.requestDigest || canonical.canonicalize(existing.input) !== canonical.canonicalize(value)) throw new Error('identity conflict'); return { ...existing, replayed: true }; }
    const material = materialDigest(value); if (this.material.has(material)) throw new Error('material replay');
    if (!Array.isArray(derivedItems) || derivedItems.length !== value.transactionBinding.unitCount || derivedItems.some((item, index) => item.unitIndex !== index || !CONTRACT.itemStates.includes(item.state))) throw new Error('complete history');
    let resultState = 'bounded_history_verified_no_effect';
    if (value.recoveryKind === 'disaster_restore') resultState = 'disaster_restore_evidence_gap_no_authority';
    else if (derivedItems.some(item => item.sourceState !== 'latest_exact_current')) resultState = 'blocked_source_not_latest_exact_current';
    else if (['provider_outage', 'partial_callback'].includes(value.recoveryKind) || derivedItems.some(item => ['provider_identity_reserved_reconciliation_required_no_resend', 'reconciliation_required_no_resend'].includes(item.state))) resultState = 'reconciliation_required_no_resend';
    else if (derivedItems.some(item => item.state === 'active_lease_wait_no_effect')) resultState = 'wait_for_active_lease_no_effect';
    const event = { input: copy(value), requestDigest: value.requestDigest, materialDigest: material, resultState, replayed: false };
    this.events.set(value.recoveryId, event); this.material.add(material); return event;
  }
}
const items = (...states) => states.map((state, unitIndex) => ({ unitIndex, state, sourceState: 'latest_exact_current' }));

describe('Mission 28 Part 6F recovery authority', () => {
  test('binds released Part 6E and every frozen storage/source dependency', () => {
    expect(CONTRACT.authority).toEqual(expect.objectContaining({ part: '6F', baselineCommit: 'c78e2c1c47168949f07d1f760e841f96c2192c5b', state: 'implementation_candidate_only' }));
    expect(CONTRACT.part6ERelease).toEqual(expect.objectContaining({ acceptedSource: '51d40179122a8958a17c8b20ab4ecf2f5394121f', pullRequest: 573, deployment: 'eb089985-741b-4147-8af5-7bde9742e8dc' }));
    for (const item of CONTRACT.frozenInputs) expect(normalizedLfSha256(item.path)).toBe(item.normalizedLfSha256);
    expect(CONTRACT.storageContract.runtimeExecuteGranted).toBe(false);
    expect(CONTRACT.completeRunHistoryContract.unscheduledControlRule).toContain('including_committed_unscheduled_units');
    expect(CONTRACT.completeRunHistoryContract.orphanRule).toContain('all_shared_identity_sequence_state_count_time_and_digest_fields');
  });

  test('closes every incident/evidence pair and never converts assessment into operational authority', () => {
    expect(CONTRACT.incidentKinds.map(item => item.id)).toEqual(['process_restart', 'migration_restart', 'worker_crash', 'database_outage', 'provider_outage', 'partial_callback', 'deployment_restore', 'disaster_restore']);
    for (const incident of CONTRACT.incidentKinds) { const value = fixture(incident.id.length, incident.id); expect(validate(value, trusted(value))).toEqual(value); }
    expect(CONTRACT.idempotencyAndConcurrency.recoveryAuthorityRule).toContain('never_reclaims_resends_requeues_reopens');
  });

  test('derives exact no-effect, wait, uncertainty, source-blocked and disaster-gap outcomes', () => {
    expect(new RecoveryStore().apply(fixture(1), trusted(fixture(1)), items('committed_unpublished_unscheduled', 'queued_unpublished_preserved')).resultState).toBe('bounded_history_verified_no_effect');
    const active = fixture(2); expect(new RecoveryStore().apply(active, trusted(active), items('active_lease_wait_no_effect', 'queued_unpublished_preserved')).resultState).toBe('wait_for_active_lease_no_effect');
    const uncertain = fixture(3, 'partial_callback'); expect(new RecoveryStore().apply(uncertain, trusted(uncertain), items('provider_identity_reserved_reconciliation_required_no_resend', 'reconciliation_required_no_resend')).resultState).toBe('reconciliation_required_no_resend');
    for (const kind of ['provider_outage', 'partial_callback']) { const incident = fixture(300 + kind.length, kind); expect(new RecoveryStore().apply(incident, trusted(incident), items('queued_unpublished_preserved', 'committed_unpublished_unscheduled')).resultState).toBe('reconciliation_required_no_resend'); }
    const staleItems = items('queued_unpublished_preserved', 'permanent_stop_preserved'); staleItems[1].sourceState = 'stale_or_unavailable'; const stale = fixture(4); expect(new RecoveryStore().apply(stale, trusted(stale), staleItems).resultState).toBe('blocked_source_not_latest_exact_current');
    const restore = fixture(5, 'disaster_restore'); expect(new RecoveryStore().apply(restore, trusted(restore), items('queued_unpublished_preserved', 'control_preserved_no_new_work')).resultState).toBe('disaster_restore_evidence_gap_no_authority');
  });

  test('validates all material before replay and denies shape, primitive, evidence, digest and trusted substitutions without hooks', () => {
    const canonicalValue = fixture(20); const attacks = [
      value => { value.extra = true; }, value => { delete value.requestDigest; }, value => { value.recoveryKind = 'unknown'; },
      value => { value.incidentBinding.evidenceState = 'provider_unavailable'; }, value => { value.transactionBinding.runId = uuid(999); },
      value => { value.transactionBinding.unitCount = 33; }, value => { value.actorBinding.actorId = ''; }, value => { value.actorBinding.requestedAt = 'later'; },
    ];
    for (const mutate of attacks) { const attack = copy(canonicalValue); mutate(attack); if (Object.prototype.hasOwnProperty.call(attack, 'requestDigest')) reseal(attack); expect(() => validate(attack, trusted(canonicalValue))).toThrow(); }
    let getterCalls = 0; const accessor = copy(canonicalValue); Object.defineProperty(accessor.transactionBinding, 'unitCount', { enumerable: true, get() { getterCalls += 1; return 2; } }); expect(() => validate(accessor, trusted(canonicalValue))).toThrow('object'); expect(getterCalls).toBe(0);
    let proxyTraps = 0; const proxy = new Proxy(copy(canonicalValue), { ownKeys(target) { proxyTraps += 1; return Reflect.ownKeys(target); }, get(target, key, receiver) { proxyTraps += 1; return Reflect.get(target, key, receiver); } }); expect(() => validate(proxy, trusted(canonicalValue))).toThrow('plain'); expect(proxyTraps).toBe(0);
    const symbol = copy(canonicalValue); symbol[Symbol('hidden')] = true; expect(() => validate(symbol, trusted(canonicalValue))).toThrow('plain');
    const toJSON = copy(canonicalValue); Object.defineProperty(toJSON.incidentBinding, 'toJSON', { value() { throw new Error('must not run'); }, enumerable: false }); expect(() => validate(toJSON, trusted(canonicalValue))).toThrow('object');
  });

  test('replays one exact historical assessment and rejects malformed replay or cloned incident material under a new identity', () => {
    const store = new RecoveryStore(); const value = fixture(30); const derived = items('queued_unpublished_preserved', 'expired_lease_reclaim_requires_new_fence');
    expect(store.apply(value, trusted(value), derived).replayed).toBe(false); expect(store.apply(copy(value), trusted(value), [{ bad: true }]).replayed).toBe(true);
    const malformed = copy(value); malformed.extra = true; expect(() => store.apply(malformed, trusted(value), derived)).toThrow('root shape');
    const clone = copy(value); clone.recoveryId = uuid(899999); reseal(clone); expect(() => store.apply(clone, trusted(clone), derived)).toThrow('material replay');
  });

  test('requires exact complete ordered run history and never accepts candidate-derived state', () => {
    const value = fixture(40); const store = new RecoveryStore();
    expect(() => store.apply(value, trusted(value), items('queued_unpublished_preserved'))).toThrow('complete history');
    expect(() => store.apply(value, trusted(value), [{ unitIndex: 1, state: 'queued_unpublished_preserved', sourceState: 'latest_exact_current' }, { unitIndex: 0, state: 'queued_unpublished_preserved', sourceState: 'latest_exact_current' }])).toThrow('complete history');
    expect(() => store.apply(value, trusted(value), items('safe_to_resend', 'queued_unpublished_preserved'))).toThrow('complete history');
    const injected = copy(value); injected.resultState = 'bounded_history_verified_no_effect'; reseal(injected); expect(() => validate(injected, trusted(injected))).toThrow('root shape');
  });

  test('migration is additive, forced-RLS, append-only, owner-only and contains no provider/effect mutation path', () => {
    const sql = fs.readFileSync(path.join(ROOT, 'migrations/280_canonical_automation_recovery_authority_v1.sql'), 'utf8');
    for (const token of ['canonical_automation_recovery_assessments_v1', 'canonical_automation_recovery_items_v1', 'canonical_automation_record_recovery_assessment_v1', 'ENABLE ROW LEVEL SECURITY', 'FORCE ROW LEVEL SECURITY', 'orphan lease authority', 'disaster_restore_evidence_gap_no_authority']) expect(sql).toContain(token);
    for (const forbidden of ['GRANT EXECUTE', 'fetch(', 'axios', 'twilio', 'retell', "state='delivered'", 'UPDATE public.canonical_automation_action_', 'UPDATE public.canonical_automation_delivery_', 'DELETE FROM public.canonical_automation_']) expect(sql).not.toContain(forbidden);
    expect((sql.match(/CREATE TABLE public\.canonical_automation_recovery_/g) || [])).toHaveLength(2);
  });

  test('records Parts 7A-7C released, Part 7D candidate, migration284/no285 and Part 7E+ planned', () => {
    for (const relative of ['docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md', 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md']) {
      const document = fs.readFileSync(path.join(ROOT, relative), 'utf8'); expect(document).toContain('Parts 1A–9C are released. Part 9D is the sole implementation candidate.'); expect(document).toContain('Parts 10A–14G remain planned and unimplemented.'); expect(document).toContain('eb089985-741b-4147-8af5-7bde9742e8dc');
    }
    const ledger = fs.readFileSync(path.join(ROOT, 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md'), 'utf8');
    expect(ledger).toContain('| 25 | 6E | Cancel/pause/revoke/drain/dead-letter and reviewed retry | **Released** |');
    expect(ledger).toContain('| 26 | 6F | Restart/migration/outage/restore and orphan-authority recovery | **Released** |');
    expect(ledger).toContain('| 27 | 7A | Exact sender and recipient authority | **Released** |');
    expect(ledger).toContain('Released migration source is byte-identical to the previously verified Part 9B deployment at 283 migrations through exact `287_canonical_automation_estimate_quote_resolution_v1.sql` with no 288');
  });
});
