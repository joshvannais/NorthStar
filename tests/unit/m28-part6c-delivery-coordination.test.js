'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const canonical = require('../../src/automation/canonicalJson');

const ROOT = path.resolve(__dirname, '../..');
const CONTRACT = require('../../docs/architecture/MISSION_28_PART6C_DELIVERY_COORDINATION_CONTRACT.json');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const copy = value => JSON.parse(JSON.stringify(value));
const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const hash = value => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
const digest = (namespace, value, excluded) => canonical.digest(`${namespace}\n`, excluded
  ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== excluded)) : value);

function normalizedLfSha256(relative) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, relative), 'utf8').replace(/\r\n?/g, '\n')).digest('hex').toUpperCase();
}
function exact(value, fields, label) {
  if (Object.keys(value).length !== fields.length || fields.some(field => !Object.prototype.hasOwnProperty.call(value, field))) throw new Error(`${label} shape`);
}
function plain(value, seen = new Set()) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return;
  if (typeof value !== 'object' || seen.has(value) || Reflect.ownKeys(value).some(key => typeof key !== 'string')) throw new Error('plain');
  seen.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
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
  value.workerBinding.workerIdentityDigest = digest('mission28.delivery-worker.v1', value.workerBinding, 'workerIdentityDigest');
  value.requestDigest = digest('mission28.delivery-lease.request.v1', value, 'requestDigest'); return value;
}
function fixture(suffix = 0, unitIndex = 0, unitCount = 2) {
  return reseal({
    schemaVersion: CONTRACT.leaseRequestEnvelope.schemaVersion, tenantId: uuid(28), leaseRequestId: uuid(20000 + suffix),
    scheduleBinding: { scheduleId: uuid(21000 + suffix), transactionId: uuid(22000), runId: uuid(23000), unitId: uuid(24000 + unitIndex), outboxId: uuid(25000 + unitIndex), unitDigest: hash(`unit-${unitIndex}`), scheduleBindingDigest: hash(`schedule-${unitIndex}`) },
    workerBinding: { workerId: uuid(26000 + suffix), processId: uuid(27000 + suffix), deploymentId: uuid(28000 + suffix), regionId: 'us-east-1', workerIdentityDigest: '' },
    leaseBinding: { leaseId: uuid(29000 + suffix), expectedPriorFenceToken: 0, durationSeconds: 30 }, requestDigest: '',
  });
}
function material(value) {
  return { tenantId: value.tenantId, scheduleBinding: value.scheduleBinding, workerBinding: value.workerBinding };
}
function validate(value, trusted) {
  plain(value); plain(trusted);
  exact(value, CONTRACT.leaseRequestEnvelope.exactFields, 'root');
  exact(value.scheduleBinding, CONTRACT.leaseRequestEnvelope.scheduleBindingExactFields, 'schedule');
  exact(value.workerBinding, CONTRACT.leaseRequestEnvelope.workerBindingExactFields, 'worker');
  exact(value.leaseBinding, CONTRACT.leaseRequestEnvelope.leaseBindingExactFields, 'lease');
  for (const item of [value.tenantId, value.leaseRequestId, value.scheduleBinding.scheduleId, value.scheduleBinding.transactionId,
    value.scheduleBinding.runId, value.scheduleBinding.unitId, value.scheduleBinding.outboxId, value.workerBinding.workerId,
    value.workerBinding.processId, value.workerBinding.deploymentId, value.leaseBinding.leaseId]) if (!UUID.test(item)) throw new Error('uuid');
  for (const item of [value.scheduleBinding.unitDigest, value.scheduleBinding.scheduleBindingDigest, value.workerBinding.workerIdentityDigest, value.requestDigest]) if (!DIGEST.test(item)) throw new Error('digest');
  if (!/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(value.workerBinding.regionId)) throw new Error('region');
  if (!Number.isSafeInteger(value.leaseBinding.expectedPriorFenceToken) || value.leaseBinding.expectedPriorFenceToken < 0 ||
      !Number.isSafeInteger(value.leaseBinding.durationSeconds) || value.leaseBinding.durationSeconds < 5 || value.leaseBinding.durationSeconds > 300) throw new Error('lease');
  const sealed = copy(value); reseal(sealed);
  if (sealed.workerBinding.workerIdentityDigest !== value.workerBinding.workerIdentityDigest || sealed.requestDigest !== value.requestDigest) throw new Error('seal');
  if (canonical.canonicalize(trusted) !== canonical.canonicalize(material(value))) throw new Error('trusted');
  return { unitIndex: Number(value.scheduleBinding.unitId.slice(-12)) - 24000, unitCount: 2 };
}

class CoordinationStore {
  constructor() { this.events = new Map(); this.heads = new Map(); this.claimedUnits = new Set(); this.receipts = new Map(); }
  claim(input, trusted, now = 1000) {
    const model = validate(input, trusted); const value = copy(input);
    const old = this.events.get(value.leaseRequestId);
    if (old) { if (old.requestDigest !== value.requestDigest || canonical.canonicalize(old.request) !== canonical.canonicalize(value)) throw new Error('conflict'); return { ...old, replayed: true }; }
    for (let index = 0; index < model.unitIndex; index += 1) if (!this.claimedUnits.has(`${value.scheduleBinding.transactionId}:${index}`)) throw new Error('order');
    const head = this.heads.get(value.scheduleBinding.scheduleId); const expected = head ? head.fenceToken : 0;
    if (value.leaseBinding.expectedPriorFenceToken !== expected || (head && head.expiresAt > now)) throw new Error('fence');
    const event = { request: value, requestDigest: value.requestDigest, leaseId: value.leaseBinding.leaseId, fenceToken: expected + 1, expiresAt: now + value.leaseBinding.durationSeconds, replayed: false };
    this.events.set(value.leaseRequestId, event); this.heads.set(value.scheduleBinding.scheduleId, event); this.claimedUnits.add(`${value.scheduleBinding.transactionId}:${model.unitIndex}`); return event;
  }
  reserve(input, leaseId, fenceToken, now = 1001) {
    const scheduleId = input.scheduleBinding.scheduleId;
    const head = this.heads.get(scheduleId); if (!head || head.leaseId !== leaseId || head.fenceToken !== fenceToken || head.expiresAt <= now) throw new Error('fence');
    const old = this.receipts.get(scheduleId); if (old) return { ...old, replayed: true };
    const providerRequestIdentity = `m28:${input.scheduleBinding.unitId}`;
    const providerRequestDigest = digest('mission28.provider-request-identity.v1', { tenantId: input.tenantId, scheduleId, transactionId: input.scheduleBinding.transactionId, runId: input.scheduleBinding.runId, unitId: input.scheduleBinding.unitId, outboxId: input.scheduleBinding.outboxId, unitDigest: input.scheduleBinding.unitDigest, materialDigest: hash('material'), idempotencyKeyDigest: hash('idempotency'), providerMode: 'provider_disabled', providerRequestIdentity });
    const receipt = { providerRequestIdentity, providerRequestDigest, leaseId, fenceToken, state: CONTRACT.providerRequestIdentityContract.storedState, replayed: false };
    this.receipts.set(scheduleId, receipt); return receipt;
  }
}

describe('Mission 28 Part 6C delivery coordination', () => {
  test('binds released Part 6B and exact frozen inputs', () => {
    expect(CONTRACT.authority).toEqual(expect.objectContaining({ part: '6C', baselineCommit: 'c16af605a675870272ee9135dbcba6234ff357e7', state: 'implementation_candidate_only' }));
    expect(CONTRACT.part6BRelease).toEqual(expect.objectContaining({ pullRequest: 570, deployment: '061e8ae7-eb47-49ff-b015-3adbe3c352f1', deploymentState: 'SUCCESS_RUNNING' }));
    for (const item of CONTRACT.frozenInputs) expect(normalizedLfSha256(item.path)).toBe(item.normalizedLfSha256);
    expect(CONTRACT.storageContract.runtimeExecuteGranted).toBe(false);
  });

  test('accepts exact ordered claims and historical replay, then derives one no-effect provider identity receipt', () => {
    const store = new CoordinationStore(); const first = fixture(1, 0); const second = fixture(2, 1);
    expect(store.claim(first, material(first))).toEqual(expect.objectContaining({ fenceToken: 1, replayed: false }));
    expect(store.claim(copy(first), material(first), 9999)).toEqual(expect.objectContaining({ fenceToken: 1, replayed: true }));
    expect(store.claim(second, material(second))).toEqual(expect.objectContaining({ fenceToken: 1 }));
    const receipt = store.reserve(first, first.leaseBinding.leaseId, 1);
    expect(receipt).toEqual(expect.objectContaining({ providerRequestIdentity: `m28:${first.scheduleBinding.unitId}`, state: 'identity_reserved_no_provider_attempt_or_ack', replayed: false }));
    expect(store.reserve(first, first.leaseBinding.leaseId, 1)).toEqual(expect.objectContaining({ replayed: true, providerRequestDigest: receipt.providerRequestDigest }));
    expect(() => store.reserve(first, uuid(999), 99)).toThrow('fence');
  });

  test('rejects out-of-order, active takeover and stale fence while allowing monotonic post-expiry takeover', () => {
    const store = new CoordinationStore(); const second = fixture(10, 1);
    expect(() => store.claim(second, material(second))).toThrow('order');
    const first = fixture(11, 0); store.claim(first, material(first)); const receipt = store.reserve(first, first.leaseBinding.leaseId, 1);
    const active = fixture(12, 0); active.scheduleBinding = copy(first.scheduleBinding); reseal(active); expect(() => store.claim(active, material(active), 1001)).toThrow('fence');
    const stale = fixture(13, 0); stale.scheduleBinding = copy(first.scheduleBinding); stale.leaseBinding.expectedPriorFenceToken = 0; reseal(stale); expect(() => store.claim(stale, material(stale), 1031)).toThrow('fence');
    const next = fixture(14, 0); next.scheduleBinding = copy(first.scheduleBinding); next.leaseBinding.expectedPriorFenceToken = 1; reseal(next); expect(store.claim(next, material(next), 1031).fenceToken).toBe(2);
    expect(() => store.reserve(first, first.leaseBinding.leaseId, 1, 1032)).toThrow('fence');
    expect(store.reserve(next, next.leaseBinding.leaseId, 2, 1032)).toEqual(expect.objectContaining({ replayed: true, providerRequestDigest: receipt.providerRequestDigest }));
  });

  test('rejects cross-tenant, worker, process, deployment, region, schedule and trusted-resolution substitution', () => {
    const fields = [
      value => { value.tenantId = uuid(29); }, value => { value.workerBinding.workerId = uuid(1); },
      value => { value.workerBinding.processId = uuid(2); }, value => { value.workerBinding.deploymentId = uuid(3); },
      value => { value.workerBinding.regionId = 'other-region'; }, value => { value.scheduleBinding.unitId = uuid(4); },
    ];
    for (const mutate of fields) { const original = fixture(30); const attack = copy(original); mutate(attack); reseal(attack); expect(() => validate(attack, material(original))).toThrow('trusted'); }
  });

  test('validates malformed replay and coalescing material before lookup without invoking hostile hooks', () => {
    const store = new CoordinationStore(); const value = fixture(40); store.claim(value, material(value));
    const attacks = [];
    const extra = copy(value); extra.unexpected = true; attacks.push(extra);
    const missing = copy(value); delete missing.requestDigest; attacks.push(missing);
    const symbol = copy(value); symbol[Symbol('hidden')] = true; attacks.push(symbol);
    const custom = copy(value); Object.setPrototypeOf(custom.workerBinding, { polluted: true }); attacks.push(custom);
    const json = copy(value); Object.defineProperty(json, 'toJSON', { value() { throw new Error('hook'); } }); attacks.push(json);
    let getterCalls = 0; const accessor = copy(value); Object.defineProperty(accessor.workerBinding, 'unexpected', { enumerable: true, get() { getterCalls += 1; return 'x'; } }); attacks.push(accessor);
    for (const attack of attacks) expect(() => store.claim(attack, material(value))).toThrow();
    expect(getterCalls).toBe(0); expect(store.events.size).toBe(1);
  });

  test('rejects lease duration, identity and digest ambiguity with zero residue', () => {
    for (const mutate of [
      value => { value.leaseBinding.durationSeconds = 0; }, value => { value.leaseBinding.durationSeconds = 301; },
      value => { value.leaseBinding.expectedPriorFenceToken = -1; }, value => { value.workerBinding.regionId = 'US EAST'; },
      value => { value.scheduleBinding.unitDigest = 'bad'; }, value => { value.requestDigest = hash('forged'); },
    ]) { const value = fixture(50); mutate(value); const store = new CoordinationStore(); expect(() => store.claim(value, material(value))).toThrow(); expect(store.events.size).toBe(0); }
  });

  test('migration is forced-RLS, owner-only, bounded and contains no provider/effect path', () => {
    const sql = fs.readFileSync(path.join(ROOT, 'migrations/277_canonical_automation_delivery_coordination_v1.sql'), 'utf8');
    for (const token of ['canonical_automation_delivery_lease_heads_v1', 'canonical_automation_delivery_lease_events_v1', 'canonical_automation_provider_request_receipts_v1', 'canonical_automation_claim_scheduled_action_v1', 'canonical_automation_reserve_provider_request_identity_v1', 'ENABLE ROW LEVEL SECURITY', 'FORCE ROW LEVEL SECURITY', 'expectedPriorFenceToken', 'identity_reserved_no_provider_attempt_or_ack']) expect(sql).toContain(token);
    for (const forbidden of ['GRANT EXECUTE', 'fetch(', 'axios', 'twilio', 'retell', 'queue_published_at=', "state='delivered'", 'provider_attempt_id']) expect(sql).not.toContain(forbidden);
  });

  test('records Part 6D released, only Part 6E candidate, and migration279/no280', () => {
    for (const relative of ['docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md', 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md']) {
      const document = fs.readFileSync(path.join(ROOT, relative), 'utf8');
      expect(document).toContain('Parts 1A–6D released; Part 6E implementation candidate only.');
      expect(document).toContain('Parts 6F–14G remain planned and unimplemented.');
      expect(document).toContain('061e8ae7-eb47-49ff-b015-3adbe3c352f1');
    }
    const ledger = fs.readFileSync(path.join(ROOT, 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md'), 'utf8');
    expect(ledger).toContain('| 22 | 6B | Durable time-zone-aware scheduler | **Released** |');
    expect(ledger).toContain('| 23 | 6C | Leases, fencing, ordering, idempotency and provider request identity | **Released** |');
    expect(ledger).toContain('| 24 | 6D | Bounded retry/backoff and uncertain-outcome reconciliation | **Released** |');
    expect(ledger).toContain('| 25 | 6E | Cancel/pause/revoke/drain/dead-letter and reviewed retry | **Implementation candidate** |');
    expect(ledger).toContain('through additive `279_canonical_automation_delivery_controls_v1.sql` with no 280');
  });
});
