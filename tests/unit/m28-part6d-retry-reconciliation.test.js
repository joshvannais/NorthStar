'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { types: { isProxy } } = require('node:util');
const canonical = require('../../src/automation/canonicalJson');

const ROOT = path.resolve(__dirname, '../..');
const CONTRACT = require('../../docs/architecture/MISSION_28_PART6D_RETRY_RECONCILIATION_CONTRACT.json');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const copy = value => JSON.parse(JSON.stringify(value));
const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const hash = value => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;

function normalizedLfSha256(relative) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, relative), 'utf8').replace(/\r\n?/g, '\n')).digest('hex').toUpperCase();
}
function exact(value, fields, label) {
  if (Object.keys(value).length !== fields.length || fields.some(field => !Object.prototype.hasOwnProperty.call(value, field))) throw new Error(`${label} shape`);
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
  value.attemptObservation.observationDigest = canonical.digest('mission28.delivery-attempt-observation.v1\n', Object.fromEntries(Object.entries(value.attemptObservation).filter(([key]) => key !== 'observationDigest')));
  value.retryPolicy.retryPolicyDigest = canonical.digest('mission28.delivery-retry-policy.v1\n', Object.fromEntries(Object.entries(value.retryPolicy).filter(([key]) => key !== 'retryPolicyDigest')));
  value.requestDigest = canonical.digest('mission28.delivery-retry-decision.v1\n', Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'requestDigest')));
  return value;
}
function fixture(suffix = 1, kind = 'provider_retryable_definite_no_acceptance', attemptOrdinal = 1) {
  return reseal({
    schemaVersion: CONTRACT.decisionEnvelope.schemaVersion, tenantId: uuid(28), decisionId: uuid(60000 + suffix), decisionKind: 'classify_attempt',
    actionBinding: { scheduleId: uuid(61000), transactionId: uuid(62000), runId: uuid(63000), unitId: uuid(64000), outboxId: uuid(65000), receiptId: uuid(61000), unitDigest: hash('unit'), providerRequestIdentity: `m28:${uuid(64000)}`, providerRequestDigest: hash('provider-request'), idempotencyReceiptDigest: hash('receipt') },
    leaseBinding: { leaseId: uuid(66000 + suffix), fenceToken: suffix },
    retryPolicy: { attemptCeiling: 3, baseDelaySeconds: 10, maximumDelaySeconds: 300, maximumRetryAfterSeconds: 300, maximumJitterSeconds: 20, retryPolicyDigest: '' },
    attemptObservation: { observationId: uuid(67000 + suffix), observationKind: kind, observationDigest: hash(`observation-${suffix}`), attemptOrdinal, attemptLeaseId: uuid(66000 + suffix), attemptFenceToken: suffix, occurredAt: `2026-10-28T12:00:${String(suffix).padStart(2, '0')}.000000Z`, retryAfterSeconds: kind === 'provider_rate_limited_definite_no_acceptance' ? 40 : null, providerTimeoutSeconds: kind === 'provider_timeout_uncertain' ? 30 : null },
    reconciliation: { state: 'not_performed', evidenceId: null, evidenceDigest: null, observedAt: null }, requestDigest: '',
  });
}
function trusted(value) {
  const result = copy(value); delete result.schemaVersion; delete result.decisionId; delete result.requestDigest; return result;
}
function validate(value, resolution) {
  plain(value); plain(resolution); exact(value, CONTRACT.decisionEnvelope.exactFields, 'root');
  exact(value.actionBinding, CONTRACT.decisionEnvelope.actionBindingExactFields, 'action');
  exact(value.leaseBinding, CONTRACT.decisionEnvelope.leaseBindingExactFields, 'lease');
  exact(value.retryPolicy, CONTRACT.decisionEnvelope.retryPolicyExactFields, 'policy');
  exact(value.attemptObservation, CONTRACT.decisionEnvelope.attemptObservationExactFields, 'observation');
  exact(value.reconciliation, CONTRACT.decisionEnvelope.reconciliationExactFields, 'reconciliation');
  for (const id of [value.tenantId, value.decisionId, value.actionBinding.scheduleId, value.actionBinding.transactionId, value.actionBinding.runId, value.actionBinding.unitId, value.actionBinding.outboxId, value.actionBinding.receiptId, value.leaseBinding.leaseId, value.attemptObservation.observationId, value.attemptObservation.attemptLeaseId]) if (!UUID.test(id)) throw new Error('uuid');
  for (const digest of [value.actionBinding.unitDigest, value.actionBinding.providerRequestDigest, value.actionBinding.idempotencyReceiptDigest, value.retryPolicy.retryPolicyDigest, value.attemptObservation.observationDigest, value.requestDigest]) if (!DIGEST.test(digest)) throw new Error('digest');
  if (value.actionBinding.providerRequestIdentity !== `m28:${value.actionBinding.unitId}`) throw new Error('provider identity');
  if (!CONTRACT.decisionEnvelope.decisionKinds.includes(value.decisionKind)) throw new Error('decision kind');
  if (!Object.prototype.hasOwnProperty.call(CONTRACT.classificationContract.observationKinds, value.attemptObservation.observationKind)) throw new Error('observation kind');
  const p = value.retryPolicy; if (![p.attemptCeiling, p.baseDelaySeconds, p.maximumDelaySeconds, p.maximumRetryAfterSeconds, p.maximumJitterSeconds].every(Number.isSafeInteger) || p.attemptCeiling < 1 || p.attemptCeiling > 8 || p.baseDelaySeconds < 1 || p.baseDelaySeconds > 900 || p.maximumDelaySeconds < p.baseDelaySeconds || p.maximumDelaySeconds > 3600 || p.maximumRetryAfterSeconds < 1 || p.maximumRetryAfterSeconds > p.maximumDelaySeconds || p.maximumJitterSeconds < 0 || p.maximumJitterSeconds > 60) throw new Error('policy bounds');
  const o = value.attemptObservation; if (!Number.isSafeInteger(o.attemptOrdinal) || o.attemptOrdinal < 1 || o.attemptOrdinal > 8 || !Number.isSafeInteger(o.attemptFenceToken) || o.attemptFenceToken < 1 || !Number.isSafeInteger(value.leaseBinding.fenceToken) || value.leaseBinding.fenceToken < 1) throw new Error('attempt');
  if ((o.retryAfterSeconds !== null && (!Number.isSafeInteger(o.retryAfterSeconds) || o.retryAfterSeconds < 1 || o.retryAfterSeconds > p.maximumRetryAfterSeconds || !['provider_retryable_definite_no_acceptance', 'provider_rate_limited_definite_no_acceptance'].includes(o.observationKind))) || (o.observationKind === 'provider_rate_limited_definite_no_acceptance' && o.retryAfterSeconds === null)) throw new Error('retry after');
  if ((o.observationKind === 'provider_timeout_uncertain' && (!Number.isSafeInteger(o.providerTimeoutSeconds) || o.providerTimeoutSeconds < 1 || o.providerTimeoutSeconds > 120)) || (o.observationKind !== 'provider_timeout_uncertain' && o.providerTimeoutSeconds !== null)) throw new Error('timeout');
  const performed = value.reconciliation.state !== 'not_performed';
  if ((value.decisionKind === 'classify_attempt') !== !performed) throw new Error('composition');
  if (performed) { if (!['no_effect_confirmed', 'effect_confirmed', 'unknown_or_unsafe'].includes(value.reconciliation.state) || !UUID.test(value.reconciliation.evidenceId) || !DIGEST.test(value.reconciliation.evidenceDigest) || typeof value.reconciliation.observedAt !== 'string') throw new Error('reconciliation'); }
  else if ([value.reconciliation.evidenceId, value.reconciliation.evidenceDigest, value.reconciliation.observedAt].some(item => item !== null)) throw new Error('reconciliation');
  const sealed = copy(value); reseal(sealed); if (sealed.attemptObservation.observationDigest !== value.attemptObservation.observationDigest || sealed.retryPolicy.retryPolicyDigest !== value.retryPolicy.retryPolicyDigest || sealed.requestDigest !== value.requestDigest) throw new Error('seal');
  if (canonical.canonicalize(resolution) !== canonical.canonicalize(trusted(value))) throw new Error('trusted'); return value;
}
function retryTiming(value) {
  const p = value.retryPolicy; const ordinal = value.attemptObservation.attemptOrdinal;
  const backoffSeconds = Math.max(Math.min(p.maximumDelaySeconds, p.baseDelaySeconds * (2 ** (ordinal - 1))), value.attemptObservation.retryAfterSeconds || 0);
  const room = Math.min(p.maximumJitterSeconds, p.maximumDelaySeconds - backoffSeconds);
  const seed = Number.parseInt(value.actionBinding.providerRequestDigest.slice(7, 15), 16) + ordinal;
  const jitterSeconds = room > 0 ? seed % (room + 1) : 0; return { backoffSeconds, jitterSeconds, total: backoffSeconds + jitterSeconds };
}

class RetryStore {
  constructor() { this.events = new Map(); this.head = null; }
  apply(input, resolution, now = Date.parse('2026-10-28T12:10:00Z') / 1000) {
    const value = validate(input, resolution); const old = this.events.get(value.decisionId);
    if (old) { if (old.requestDigest !== value.requestDigest || canonical.canonicalize(old.input) !== canonical.canonicalize(value)) throw new Error('conflict'); return { ...old, replayed: true }; }
    let state; let classification; let timing = { backoffSeconds: null, jitterSeconds: null, total: null };
    const ordinal = value.attemptObservation.attemptOrdinal;
    if (value.decisionKind === 'classify_attempt') {
      if (value.attemptObservation.attemptLeaseId !== value.leaseBinding.leaseId || value.attemptObservation.attemptFenceToken !== value.leaseBinding.fenceToken) throw new Error('current lease');
      if ((!this.head && ordinal !== 1) || (this.head && (this.head.state !== 'retry_scheduled_no_effect' || this.head.nextAt > now || ordinal !== this.head.ordinal + 1))) throw new Error('sequence');
      classification = CONTRACT.classificationContract.observationKinds[value.attemptObservation.observationKind];
      if (classification === 'retryable') state = ordinal >= value.retryPolicy.attemptCeiling ? 'permanent_stop_attempt_ceiling' : 'retry_scheduled_no_effect';
      else if (classification === 'terminal') state = 'permanent_stop_terminal';
      else if (classification === 'uncertain') state = 'reconciliation_required_no_resend';
      else state = 'permanent_stop_unknown_or_unsafe';
    } else {
      if (!this.head || this.head.state !== 'reconciliation_required_no_resend' || ordinal !== this.head.ordinal || value.attemptObservation.observationId !== this.head.observationId || value.attemptObservation.observationDigest !== this.head.observationDigest || value.attemptObservation.attemptLeaseId !== this.head.attemptLeaseId || value.attemptObservation.attemptFenceToken !== this.head.attemptFence) throw new Error('pending reconciliation');
      if (value.reconciliation.state === 'no_effect_confirmed') { classification = 'reconciled_no_effect'; state = ordinal >= value.retryPolicy.attemptCeiling ? 'permanent_stop_attempt_ceiling' : 'retry_scheduled_no_effect'; }
      else if (value.reconciliation.state === 'effect_confirmed') { classification = 'reconciled_effect'; state = 'permanent_stop_effect_confirmed'; }
      else { classification = 'reconciled_unknown_or_unsafe'; state = 'permanent_stop_unknown_or_unsafe'; }
    }
    if (state === 'retry_scheduled_no_effect') timing = retryTiming(value);
    const event = { input: copy(value), requestDigest: value.requestDigest, state, classification, ordinal, sequence: this.head ? this.head.sequence + 1 : 1, nextAt: timing.total === null ? null : now + timing.total, ...timing, replayed: false };
    this.events.set(value.decisionId, event); this.head = { ...event, observationId: state === 'reconciliation_required_no_resend' ? value.attemptObservation.observationId : null, observationDigest: state === 'reconciliation_required_no_resend' ? value.attemptObservation.observationDigest : null, attemptLeaseId: state === 'reconciliation_required_no_resend' ? value.attemptObservation.attemptLeaseId : null, attemptFence: state === 'reconciliation_required_no_resend' ? value.attemptObservation.attemptFenceToken : null }; return event;
  }
}

describe('Mission 28 Part 6D bounded retry and reconciliation', () => {
  test('binds released Part 6C provenance and every exact frozen input', () => {
    expect(CONTRACT.authority).toEqual(expect.objectContaining({ part: '6D', baselineCommit: 'd6e53b52d205e7d8e7a624eb0f951337a3c0fb4f', state: 'implementation_candidate_only' }));
    expect(CONTRACT.part6CRelease).toEqual(expect.objectContaining({ acceptedSource: '943011665fd52cd18fe4105f26fbd0b59891ab56', pullRequest: 571, deployment: '3d7689ff-79cc-457a-95f7-542acbc20409' }));
    for (const item of CONTRACT.frozenInputs) expect(normalizedLfSha256(item.path)).toBe(item.normalizedLfSha256);
    expect(CONTRACT.storageContract.runtimeExecuteGranted).toBe(false);
  });

  test('computes deterministic bounded backoff, bounded Retry-After and exact historical replay', () => {
    const store = new RetryStore(); const first = fixture(1);
    const result = store.apply(first, trusted(first)); expect(result).toEqual(expect.objectContaining({ state: 'retry_scheduled_no_effect', classification: 'retryable', ordinal: 1, replayed: false }));
    expect(result.backoffSeconds).toBe(10); expect(result.jitterSeconds).toBeGreaterThanOrEqual(0); expect(result.jitterSeconds).toBeLessThanOrEqual(20); expect(result.total).toBeLessThanOrEqual(300);
    expect(store.apply(copy(first), trusted(first), Number.MAX_SAFE_INTEGER)).toEqual(expect.objectContaining({ replayed: true, state: result.state, nextAt: result.nextAt }));
    const limited = fixture(2, 'provider_rate_limited_definite_no_acceptance', 2); limited.leaseBinding = { leaseId: limited.attemptObservation.attemptLeaseId, fenceToken: limited.attemptObservation.attemptFenceToken }; reseal(limited);
    const limitedResult = store.apply(limited, trusted(limited), result.nextAt); expect(limitedResult.backoffSeconds).toBe(40); expect(limitedResult.total).toBeLessThanOrEqual(300);
  });

  test('enforces ceiling and permanently stops terminal or unsafe outcomes', () => {
    const ceiling = new RetryStore(); ceiling.head = { state: 'retry_scheduled_no_effect', ordinal: 2, sequence: 2, nextAt: 0 };
    expect(ceiling.apply(fixture(3, 'provider_retryable_definite_no_acceptance', 3), trusted(fixture(3, 'provider_retryable_definite_no_acceptance', 3))).state).toBe('permanent_stop_attempt_ceiling');
    for (const [kind, state] of [['provider_terminal_rejection', 'permanent_stop_terminal'], ['unknown_or_unsafe_outcome', 'permanent_stop_unknown_or_unsafe']]) {
      const value = fixture(kind.length, kind); expect(new RetryStore().apply(value, trusted(value)).state).toBe(state);
    }
  });

  test('requires exact reconciliation before resend and reuses the one Part 6C provider identity', () => {
    const store = new RetryStore(); const uncertain = fixture(10, 'provider_timeout_uncertain');
    const blocked = store.apply(uncertain, trusted(uncertain)); expect(blocked.state).toBe('reconciliation_required_no_resend');
    const nextAttempt = fixture(11, 'provider_retryable_definite_no_acceptance', 2); expect(() => store.apply(nextAttempt, trusted(nextAttempt))).toThrow('sequence');
    const reconciliation = copy(uncertain); reconciliation.decisionId = uuid(60012); reconciliation.decisionKind = 'record_reconciliation'; reconciliation.leaseBinding = { leaseId: uuid(66012), fenceToken: 2 }; reconciliation.reconciliation = { state: 'no_effect_confirmed', evidenceId: uuid(68012), evidenceDigest: hash('reconciliation'), observedAt: '2026-10-28T12:01:00.000000Z' }; reseal(reconciliation);
    const allowed = store.apply(reconciliation, trusted(reconciliation)); expect(allowed.state).toBe('retry_scheduled_no_effect'); expect(reconciliation.actionBinding.providerRequestIdentity).toBe(uncertain.actionBinding.providerRequestIdentity);
    const changed = copy(reconciliation); changed.decisionId = uuid(60013); changed.actionBinding.providerRequestIdentity = `m28:${uuid(999)}`; reseal(changed); expect(() => validate(changed, trusted(changed))).toThrow('provider identity');
  });

  test.each([
    ['effect confirmed', 'effect_confirmed', 'permanent_stop_effect_confirmed'],
    ['reconciliation remains unknown', 'unknown_or_unsafe', 'permanent_stop_unknown_or_unsafe'],
  ])('%s is a permanent stop', (_name, reconciliationState, expected) => {
    const store = new RetryStore(); const uncertain = fixture(20, 'provider_acknowledgement_uncertain'); store.apply(uncertain, trusted(uncertain));
    const resolution = copy(uncertain); resolution.decisionId = uuid(60021); resolution.decisionKind = 'record_reconciliation'; resolution.leaseBinding = { leaseId: uuid(66021), fenceToken: 2 }; resolution.reconciliation = { state: reconciliationState, evidenceId: uuid(68021), evidenceDigest: hash(reconciliationState), observedAt: '2026-10-28T12:01:00.000000Z' }; reseal(resolution);
    expect(store.apply(resolution, trusted(resolution)).state).toBe(expected);
  });

  test('front-loads every structural, bound and trusted-material rejection before replay lookup', () => {
    const canonicalValue = fixture(30); const attacks = [
      ['extra', value => { value.extra = true; }], ['missing digest', value => { delete value.requestDigest; }], ['tenant', value => { value.tenantId = uuid(29); }],
      ['schedule', value => { value.actionBinding.scheduleId = uuid(1); }], ['provider identity', value => { value.actionBinding.providerRequestIdentity = `m28:${uuid(2)}`; }],
      ['ceiling', value => { value.retryPolicy.attemptCeiling = 0; }], ['maximum delay', value => { value.retryPolicy.maximumDelaySeconds = 3601; }],
      ['retry-after maximum', value => { value.retryPolicy.maximumRetryAfterSeconds = 301; }], ['jitter', value => { value.retryPolicy.maximumJitterSeconds = 61; }],
      ['retry-after', value => { value.attemptObservation.retryAfterSeconds = 0; }], ['timeout', value => { value.attemptObservation.providerTimeoutSeconds = 1; }],
      ['observation kind', value => { value.attemptObservation.observationKind = 'unknown_kind'; }], ['reconciliation', value => { value.reconciliation.state = 'effect_confirmed'; }],
    ];
    for (const [name, mutate] of attacks) { const attack = copy(canonicalValue); mutate(attack); if (name !== 'missing digest') reseal(attack); let rejected = false; try { validate(attack, trusted(canonicalValue)); } catch { rejected = true; } if (!rejected) throw new Error(`accepted ${name}`); }
    const symbol = copy(canonicalValue); symbol[Symbol('hidden')] = true; expect(() => validate(symbol, trusted(canonicalValue))).toThrow('plain');
    const custom = copy(canonicalValue); Object.setPrototypeOf(custom.actionBinding, { polluted: true }); expect(() => validate(custom, trusted(canonicalValue))).toThrow('object');
    let getterCalls = 0; const accessor = copy(canonicalValue); Object.defineProperty(accessor, 'extra', { enumerable: true, get() { getterCalls += 1; return true; } }); expect(() => validate(accessor, trusted(canonicalValue))).toThrow('object'); expect(getterCalls).toBe(0);
    let proxyTraps = 0; const proxy = new Proxy(copy(canonicalValue), { ownKeys(target) { proxyTraps += 1; return Reflect.ownKeys(target); }, get(target, key, receiver) { proxyTraps += 1; return Reflect.get(target, key, receiver); } });
    expect(() => validate(proxy, trusted(canonicalValue))).toThrow('plain'); expect(proxyTraps).toBe(0);
    const toJSON = copy(canonicalValue); Object.defineProperty(toJSON.actionBinding, 'toJSON', { value() { throw new Error('must not run'); }, enumerable: false }); expect(() => validate(toJSON, trusted(canonicalValue))).toThrow('object');
  });

  test('migration is forced-RLS, owner-only, stable-identity and explicitly no-effect', () => {
    const sql = fs.readFileSync(path.join(ROOT, 'migrations/278_canonical_automation_retry_reconciliation_v1.sql'), 'utf8');
    for (const token of ['canonical_automation_delivery_retry_heads_v1', 'canonical_automation_delivery_retry_events_v1', 'canonical_automation_record_retry_decision_v1', 'ENABLE ROW LEVEL SECURITY', 'FORCE ROW LEVEL SECURITY', 'reconciliation_required_no_resend', 'permanent_stop_unknown_or_unsafe', 'provider_request_identity', 'maximum_retry_after_seconds']) expect(sql).toContain(token);
    for (const forbidden of ['GRANT EXECUTE', 'fetch(', 'axios', 'twilio', 'retell', 'queue_published_at=', "state='delivered'", 'INSERT INTO public.canonical_automation_provider_request_receipts_v1']) expect(sql).not.toContain(forbidden);
  });

  test('records Part 6D released, only Part 6E candidate, migration279/no280 and later slices planned', () => {
    for (const relative of ['docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md', 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md']) {
      const document = fs.readFileSync(path.join(ROOT, relative), 'utf8');
      expect(document).toContain('Parts 1A–6F released; Part 7A implementation candidate only.');
      expect(document).toContain('Parts 7B–14G remain planned and unimplemented.');
      expect(document).toContain('3d7689ff-79cc-457a-95f7-542acbc20409');
    }
    const ledger = fs.readFileSync(path.join(ROOT, 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md'), 'utf8');
    expect(ledger).toContain('| 23 | 6C | Leases, fencing, ordering, idempotency and provider request identity | **Released** |');
    expect(ledger).toContain('| 24 | 6D | Bounded retry/backoff and uncertain-outcome reconciliation | **Released** |');
    expect(ledger).toContain('| 25 | 6E | Cancel/pause/revoke/drain/dead-letter and reviewed retry | **Released** |');
    expect(ledger).toContain('| 26 | 6F | Restart/migration/outage/restore and orphan-authority recovery | **Released** |');
    expect(ledger).toContain('| 27 | 7A | Exact sender and recipient authority | **Implementation candidate** |');
    expect(ledger).toContain('through additive `281_canonical_automation_sender_recipient_authority_v1.sql` with no 282');
  });
});
