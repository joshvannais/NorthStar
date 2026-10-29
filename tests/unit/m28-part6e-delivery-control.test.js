'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { types: { isProxy } } = require('node:util');
const canonical = require('../../src/automation/canonicalJson');

const ROOT = path.resolve(__dirname, '../..');
const CONTRACT = require('../../docs/architecture/MISSION_28_PART6E_DELIVERY_CONTROL_CONTRACT.json');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const copy = value => JSON.parse(JSON.stringify(value));
const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const hash = value => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;

function normalizedLfSha256(relative) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, relative), 'utf8').replace(/\r\n?/g, '\n')).digest('hex').toUpperCase();
}
function exact(value, fields, label) {
  if (!value || Object.keys(value).length !== fields.length || fields.some(field => !Object.prototype.hasOwnProperty.call(value, field))) throw new Error(`${label} shape`);
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
  seen.delete(value);
}
function reseal(value) {
  value.requestDigest = canonical.digest('mission28.delivery-control-decision.v1\n', Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'requestDigest')));
  return value;
}
function nullTarget(kind) {
  return { targetKind: kind, policyId: null, policyVersion: null, policyDigest: null, scheduleId: null, transactionId: null, runId: null, unitId: null, outboxId: null, receiptId: null, unitDigest: null, providerRequestIdentity: null, providerRequestDigest: null };
}
function fixture(operation = 'pause_scope', targetKind = 'policy_version', suffix = 1) {
  const target = nullTarget(targetKind);
  if (targetKind !== 'tenant') Object.assign(target, { policyId: uuid(100), policyVersion: 1, policyDigest: hash('policy') });
  if (targetKind === 'action_schedule') Object.assign(target, { scheduleId: uuid(200), transactionId: uuid(201), runId: uuid(202), unitId: uuid(203), outboxId: uuid(204), receiptId: uuid(200), unitDigest: hash('unit'), providerRequestIdentity: `m28:${uuid(203)}`, providerRequestDigest: hash('provider-request') });
  const review = ['dead_letter_action', 'owner_reviewed_retry'].includes(operation)
    ? { reviewId: uuid(400 + suffix), reviewDigest: hash(`review-${suffix}`), reviewOutcome: operation === 'owner_reviewed_retry' ? 'new_action_required_no_reuse' : 'no_effect_terminal', reviewedAt: '2026-10-28T12:00:00.000000Z' }
    : { reviewId: null, reviewDigest: null, reviewOutcome: null, reviewedAt: null };
  const successor = operation === 'supersede_policy'
    ? { policyId: uuid(101), policyVersion: 2, policyDigest: hash('successor') }
    : { policyId: null, policyVersion: null, policyDigest: null };
  return reseal({ schemaVersion: CONTRACT.controlEnvelope.schemaVersion, tenantId: uuid(28), controlId: uuid(300 + suffix), operation, targetBinding: target,
    actorBinding: { actorId: uuid(10), sessionId: uuid(11), membershipId: uuid(12), membershipRole: ['revoke_policy', 'supersede_policy', 'resume_scope', 'dead_letter_action', 'owner_reviewed_retry'].includes(operation) ? 'owner' : 'admin', requestedAt: '2026-10-28T12:00:01.000000Z' },
    successorBinding: successor, reviewBinding: review, requestDigest: '' });
}
function trusted(value) { const result = copy(value); delete result.schemaVersion; delete result.controlId; delete result.requestDigest; return result; }
function validate(value, resolution) {
  plain(value); plain(resolution); exact(value, CONTRACT.controlEnvelope.exactFields, 'root');
  exact(value.targetBinding, CONTRACT.controlEnvelope.targetBindingExactFields, 'target');
  exact(value.actorBinding, CONTRACT.controlEnvelope.actorBindingExactFields, 'actor');
  exact(value.successorBinding, CONTRACT.controlEnvelope.successorBindingExactFields, 'successor');
  exact(value.reviewBinding, CONTRACT.controlEnvelope.reviewBindingExactFields, 'review');
  if (!UUID.test(value.tenantId) || !UUID.test(value.controlId) || !UUID.test(value.actorBinding.actorId) || !UUID.test(value.actorBinding.sessionId) || !UUID.test(value.actorBinding.membershipId)) throw new Error('identity');
  const operation = CONTRACT.operations.find(item => item.id === value.operation);
  if (!operation || !operation.targetKinds.includes(value.targetBinding.targetKind) || !operation.roles.includes(value.actorBinding.membershipRole)) throw new Error('operation');
  const policyFields = ['policyId', 'policyVersion', 'policyDigest']; const actionFields = ['scheduleId', 'transactionId', 'runId', 'unitId', 'outboxId', 'receiptId', 'unitDigest', 'providerRequestIdentity', 'providerRequestDigest'];
  if (value.targetBinding.targetKind === 'tenant') {
    if ([...policyFields, ...actionFields].some(field => value.targetBinding[field] !== null)) throw new Error('tenant target');
  } else {
    if (!UUID.test(value.targetBinding.policyId) || !Number.isSafeInteger(value.targetBinding.policyVersion) || value.targetBinding.policyVersion < 1 || !DIGEST.test(value.targetBinding.policyDigest)) throw new Error('policy target');
    if (value.targetBinding.targetKind === 'policy_version' && actionFields.some(field => value.targetBinding[field] !== null)) throw new Error('policy target');
    if (value.targetBinding.targetKind === 'action_schedule') {
      for (const field of actionFields.slice(0, 6)) if (!UUID.test(value.targetBinding[field])) throw new Error('action identity');
      if (!DIGEST.test(value.targetBinding.unitDigest) || !DIGEST.test(value.targetBinding.providerRequestDigest) || value.targetBinding.providerRequestIdentity !== `m28:${value.targetBinding.unitId}`) throw new Error('action material');
    }
  }
  const successor = value.operation === 'supersede_policy';
  if (successor) {
    if (!UUID.test(value.successorBinding.policyId) || !Number.isSafeInteger(value.successorBinding.policyVersion) || value.successorBinding.policyVersion < 1 || !DIGEST.test(value.successorBinding.policyDigest) || (value.successorBinding.policyId === value.targetBinding.policyId && value.successorBinding.policyVersion === value.targetBinding.policyVersion)) throw new Error('successor');
  } else if (Object.values(value.successorBinding).some(item => item !== null)) throw new Error('successor');
  const reviewed = CONTRACT.reviewContract.reviewRequiredFor.includes(value.operation);
  if (reviewed) {
    if (!UUID.test(value.reviewBinding.reviewId) || !DIGEST.test(value.reviewBinding.reviewDigest) || !CONTRACT.reviewContract.reviewOutcomes.includes(value.reviewBinding.reviewOutcome) || typeof value.reviewBinding.reviewedAt !== 'string') throw new Error('review');
    if (value.operation === 'owner_reviewed_retry' && value.reviewBinding.reviewOutcome !== CONTRACT.reviewContract.ownerReviewedRetryOutcome) throw new Error('review outcome');
  } else if (Object.values(value.reviewBinding).some(item => item !== null)) throw new Error('review');
  const sealed = copy(value); reseal(sealed); if (sealed.requestDigest !== value.requestDigest) throw new Error('digest');
  if (canonical.canonicalize(resolution) !== canonical.canonicalize(trusted(value))) throw new Error('trusted'); return value;
}

class ControlStore {
  constructor() { this.events = new Map(); this.heads = new Map(); }
  apply(input, resolution, derived) {
    const value = validate(input, resolution); const replay = this.events.get(value.controlId);
    if (replay) { if (replay.requestDigest !== value.requestDigest || canonical.canonicalize(replay.input) !== canonical.canonicalize(value)) throw new Error('conflict'); return { ...replay, replayed: true }; }
    const key = `${value.targetBinding.targetKind}:${value.targetBinding.scheduleId || value.targetBinding.policyId || value.tenantId}:${value.targetBinding.policyVersion || 0}`;
    const prior = this.heads.get(key) || { state: 'normal', sequence: 0, phase: derived.phase };
    let state;
    if (value.operation === 'cancel_action') { if (prior.state !== 'normal' || derived.phase !== 'queued') throw new Error('cancel'); state = 'cancelled_terminal'; }
    else if (value.operation === 'dead_letter_action') { if (prior.state !== 'normal' || !['uncertain', 'permanent_stop_no_effect', 'permanent_stop_effect_or_unknown'].includes(derived.phase)) throw new Error('dead letter'); state = 'dead_lettered_terminal'; }
    else if (value.operation === 'owner_reviewed_retry') { if (prior.state !== 'dead_lettered_terminal' || prior.phase !== 'permanent_stop_no_effect') throw new Error('reviewed retry'); state = 'reviewed_retry_new_action_required'; }
    else if (value.operation === 'resume_scope') { if (!['paused', 'drained'].includes(prior.state) || derived.leased || derived.uncertain || derived.permanentStop || !derived.current) throw new Error('resume'); state = 'active_resumed'; }
    else if (value.operation === 'drain_scope') state = derived.leased || derived.uncertain ? 'draining' : 'drained';
    else state = CONTRACT.operations.find(item => item.id === value.operation).result.replace('draining_or_drained', 'drained');
    const event = { input: copy(value), requestDigest: value.requestDigest, state, phase: derived.phase, sequence: prior.sequence + 1, replayed: false };
    this.events.set(value.controlId, event); this.heads.set(key, { state, phase: derived.phase, sequence: event.sequence }); return event;
  }
}

describe('Mission 28 Part 6E delivery controls', () => {
  test('binds released Part 6D provenance and all frozen dependencies', () => {
    expect(CONTRACT.authority).toEqual(expect.objectContaining({ part: '6E', baselineCommit: '68ec10f0bdfd8b289c6305f1a14a6f247dd5d78d', state: 'implementation_candidate_only' }));
    expect(CONTRACT.part6DRelease).toEqual(expect.objectContaining({ acceptedSource: '9e426488cf5027210c6947af3d3b2d95aa49030b', pullRequest: 572, deployment: '823c8bc1-f895-4e1c-91a6-0ceaf211fe85' }));
    for (const item of CONTRACT.frozenInputs) expect(normalizedLfSha256(item.path)).toBe(item.normalizedLfSha256);
    expect(CONTRACT.storageContract.runtimeExecuteGranted).toBe(false);
  });

  test('closes every operation, role, target and action-phase treatment', () => {
    expect(CONTRACT.operations.map(item => item.id)).toEqual(['pause_scope', 'revoke_policy', 'supersede_policy', 'drain_scope', 'resume_scope', 'cancel_action', 'expire_action', 'dead_letter_action', 'owner_reviewed_retry', 'bulk_stop']);
    expect(Object.keys(CONTRACT.phaseTreatment)).toEqual(['queued', 'leased', 'in_flight', 'uncertain', 'completed', 'permanent_stop_no_effect', 'permanent_stop_effect_or_unknown']);
    for (const operation of CONTRACT.operations) { const value = fixture(operation.id, operation.targetKinds[0], operation.id.length); expect(validate(value, trusted(value))).toEqual(value); }
  });

  test('cancel is queued-only while reducing scope records preserve leased and uncertain truth', () => {
    const cancel = fixture('cancel_action', 'action_schedule', 1); expect(new ControlStore().apply(cancel, trusted(cancel), { phase: 'queued' }).state).toBe('cancelled_terminal');
    for (const phase of ['leased', 'uncertain', 'permanent_stop_no_effect', 'permanent_stop_effect_or_unknown']) expect(() => new ControlStore().apply(cancel, trusted(cancel), { phase })).toThrow('cancel');
    for (const [phase, key] of [['leased', 'leased'], ['uncertain', 'uncertain']]) {
      const pause = fixture('pause_scope', 'policy_version', phase.length); const result = new ControlStore().apply(pause, trusted(pause), { phase: 'scope', [key]: 1 }); expect(result.state).toBe('paused');
    }
  });

  test('drain, terminal controls and resume follow exact safe-state precedence', () => {
    const store = new ControlStore(); const drain = fixture('drain_scope', 'policy_version', 10);
    expect(store.apply(drain, trusted(drain), { phase: 'scope', leased: 1 }).state).toBe('draining');
    const drainAgain = fixture('drain_scope', 'policy_version', 11); expect(store.apply(drainAgain, trusted(drainAgain), { phase: 'scope' }).state).toBe('drained');
    const resume = fixture('resume_scope', 'policy_version', 12); expect(store.apply(resume, trusted(resume), { phase: 'scope', current: true }).state).toBe('active_resumed');
    const terminal = fixture('bulk_stop', 'policy_version', 13); expect(store.apply(terminal, trusted(terminal), { phase: 'scope' }).state).toBe('bulk_stopped_terminal');
    const resumeAfterTerminal = fixture('resume_scope', 'policy_version', 14); expect(() => store.apply(resumeAfterTerminal, trusted(resumeAfterTerminal), { phase: 'scope', current: true })).toThrow('resume');
  });

  test('dead letter preserves uncertainty and reviewed retry never reopens the same action', () => {
    const unresolved = fixture('dead_letter_action', 'action_schedule', 20); unresolved.reviewBinding.reviewOutcome = 'effect_or_unknown_unresolved'; reseal(unresolved);
    expect(new ControlStore().apply(unresolved, trusted(unresolved), { phase: 'uncertain' }).state).toBe('dead_lettered_terminal');
    const store = new ControlStore(); const dead = fixture('dead_letter_action', 'action_schedule', 21); store.apply(dead, trusted(dead), { phase: 'permanent_stop_no_effect' });
    const reviewed = fixture('owner_reviewed_retry', 'action_schedule', 22); const result = store.apply(reviewed, trusted(reviewed), { phase: 'permanent_stop_no_effect', current: true });
    expect(result.state).toBe('reviewed_retry_new_action_required'); expect(CONTRACT.transitionContract.ownerReviewedRetry).toContain('new run/action/receipt identity');
  });

  test('validates before replay and rejects structural, identity, role, digest and trusted-resolution substitution without hooks', () => {
    const canonicalValue = fixture('cancel_action', 'action_schedule', 30); const attacks = [
      value => { value.extra = true; }, value => { delete value.requestDigest; }, value => { value.targetBinding.targetKind = 'unknown'; },
      value => { value.targetBinding.scheduleId = 'not-a-uuid'; }, value => { value.targetBinding.providerRequestIdentity = `m28:${uuid(999)}`; },
      value => { value.actorBinding.membershipRole = 'viewer'; }, value => { value.successorBinding.policyId = uuid(101); }, value => { value.reviewBinding.reviewId = uuid(1); },
    ];
    for (const mutate of attacks) { const attack = copy(canonicalValue); mutate(attack); if (Object.prototype.hasOwnProperty.call(attack, 'requestDigest')) reseal(attack); expect(() => validate(attack, trusted(canonicalValue))).toThrow(); }
    const symbol = copy(canonicalValue); symbol[Symbol('hidden')] = true; expect(() => validate(symbol, trusted(canonicalValue))).toThrow('plain');
    const custom = copy(canonicalValue); Object.setPrototypeOf(custom.targetBinding, { polluted: true }); expect(() => validate(custom, trusted(canonicalValue))).toThrow('object');
    let getterCalls = 0; const accessor = copy(canonicalValue); Object.defineProperty(accessor, 'extra', { enumerable: true, get() { getterCalls += 1; return true; } }); expect(() => validate(accessor, trusted(canonicalValue))).toThrow('object'); expect(getterCalls).toBe(0);
    let proxyTraps = 0; const proxy = new Proxy(copy(canonicalValue), { ownKeys(target) { proxyTraps += 1; return Reflect.ownKeys(target); }, get(target, key, receiver) { proxyTraps += 1; return Reflect.get(target, key, receiver); } }); expect(() => validate(proxy, trusted(canonicalValue))).toThrow('plain'); expect(proxyTraps).toBe(0);
    const toJSON = copy(canonicalValue); Object.defineProperty(toJSON.targetBinding, 'toJSON', { value() { throw new Error('must not run'); }, enumerable: false }); expect(() => validate(toJSON, trusted(canonicalValue))).toThrow('object');
    const store = new ControlStore(); store.apply(canonicalValue, trusted(canonicalValue), { phase: 'queued' }); const malformedReplay = copy(canonicalValue); malformedReplay.extra = true; expect(() => store.apply(malformedReplay, trusted(canonicalValue), { phase: 'queued' })).toThrow('root shape');
  });

  test('migration is forced-RLS, append-only, guarded and contains no provider or effect path', () => {
    const sql = fs.readFileSync(path.join(ROOT, 'migrations/279_canonical_automation_delivery_controls_v1.sql'), 'utf8');
    for (const token of ['canonical_automation_delivery_control_heads_v1', 'canonical_automation_delivery_control_events_v1', 'canonical_automation_record_delivery_control_v1', 'canonical_automation_part6e_schedule_guard', 'canonical_automation_part6e_lease_guard', 'canonical_automation_part6e_retry_guard', 'ENABLE ROW LEVEL SECURITY', 'FORCE ROW LEVEL SECURITY', 'record_reconciliation', 'reviewed_retry_new_action_required']) expect(sql).toContain(token);
    for (const forbidden of ['GRANT EXECUTE', 'fetch(', 'axios', 'twilio', 'retell', "state='delivered'", 'INSERT INTO public.canonical_automation_provider_request_receipts_v1', 'UPDATE public.canonical_automation_delivery_retry_heads_v1']) expect(sql).not.toContain(forbidden);
    const controlStart = sql.indexOf('CREATE FUNCTION public.canonical_automation_record_delivery_control_v1');
    const lifecycleLock = sql.indexOf(":m28-lifecycle-policy:", controlStart);
    const tenantControlLock = sql.indexOf(":m28-control:tenant", lifecycleLock);
    expect(lifecycleLock).toBeGreaterThan(controlStart); expect(tenantControlLock).toBeGreaterThan(lifecycleLock);
    expect((sql.match(/:m28-source-lineage:/g) || [])).toHaveLength(2);
    expect(CONTRACT.currentnessAndConcurrencyContract).toEqual(expect.objectContaining({
      legacyAndControlLockOrder: 'exact_policy_lifecycle_then_tenant_control_then_policy_control_then_action_schedule_control; exact_source_lineage_is_locked_before_latest_head_resolution_while_lifecycle_remains_held',
      resumeAndReviewedRetrySourceLock: 'migration274_exact_lineage_lock_is_held_through_latest_head_validation_and_control_commit',
      concurrentScheduleClaimOrRetryPrecedence: 'first_exact_lifecycle_lock_holder_completes_first_then_reducing_control_commits_and_blocks_later_work',
    }));
  });

  test('records Part 6D released, only Part 6E candidate, migration279/no280 and later slices planned', () => {
    for (const relative of ['docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md', 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md']) {
      const document = fs.readFileSync(path.join(ROOT, relative), 'utf8'); expect(document).toContain('Parts 1A–9D are released. Part 10A is the sole implementation candidate.'); expect(document).toContain('Parts 10B–14G remain planned and unimplemented.'); expect(document).toContain('823c8bc1-f895-4e1c-91a6-0ceaf211fe85');
    }
    const ledger = fs.readFileSync(path.join(ROOT, 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md'), 'utf8'); expect(ledger).toContain('| 24 | 6D | Bounded retry/backoff and uncertain-outcome reconciliation | **Released** |'); expect(ledger).toContain('| 25 | 6E | Cancel/pause/revoke/drain/dead-letter and reviewed retry | **Released** |'); expect(ledger).toContain('| 26 | 6F | Restart/migration/outage/restore and orphan-authority recovery | **Released** |'); expect(ledger).toContain('| 27 | 7A | Exact sender and recipient authority | **Released** |'); expect(ledger).toContain('Released migration source is byte-identical to the previously verified Part 9B deployment at 283 migrations through exact `287_canonical_automation_estimate_quote_resolution_v1.sql` with no 288');
  });
});
