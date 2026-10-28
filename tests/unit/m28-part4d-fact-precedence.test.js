'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const util = require('node:util');
const canonical = require('../../src/automation/canonicalJson');

const ROOT = path.resolve(__dirname, '../..');
const CONTRACT_PATH = 'docs/architecture/MISSION_28_PART4D_FACT_PRECEDENCE_CONTRACT.json';
const CONTRACT = JSON.parse(fs.readFileSync(path.join(ROOT, CONTRACT_PATH), 'utf8'));
const PART4A = JSON.parse(fs.readFileSync(path.join(ROOT,
  'docs/architecture/MISSION_28_PART4A_CLOSED_TRIGGER_CATALOG.json'), 'utf8'));
const TENANT = '00000000-0000-4000-8000-000000000028';
const OTHER_TENANT = '00000000-0000-4000-8000-000000000029';
const TRIGGER = 'm20.lead_contact_state';
const SOURCE_CLASS = 'mission20_business_contact_preferences';
const RECORD = `sha256:${'1'.repeat(64)}`;
const EVENT_KIND = 'transcript_occurred';
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UTC = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;
const copy = value => JSON.parse(JSON.stringify(value));
const digest = (namespace, value) => canonical.digest(namespace, value);

function normalizedLfSha256(relative) {
  const normalized = fs.readFileSync(path.join(ROOT, relative), 'utf8').replace(/\r\n/g, '\n');
  if (normalized.includes('\r')) throw new Error('lone CR denied');
  return crypto.createHash('sha256').update(normalized).digest('hex').toUpperCase();
}

function ownPlain(value, label = 'value', seen = new Set()) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return;
  if (typeof value !== 'object' || util.types.isProxy(value) || seen.has(value)) throw new Error(`${label} plain data`);
  seen.add(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1) {
      throw new Error(`${label} dense array`);
    }
    value.forEach((member, index) => ownPlain(member, `${label}[${index}]`, seen));
    return;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) throw new Error(`${label} plain object`);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') throw new Error(`${label} symbol`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor) || descriptor.get || descriptor.set) {
      throw new Error(`${label} descriptor`);
    }
    if (key === 'toJSON') throw new Error(`${label} toJSON`);
    ownPlain(descriptor.value, `${label}.${key}`, seen);
  }
}

function exact(value, keys, label) {
  ownPlain(value, label);
  if (!value || Array.isArray(value) || JSON.stringify(Object.keys(value)) !== JSON.stringify(keys)) {
    throw new Error(`${label} shape`);
  }
}

function same(left, right) {
  return canonical.canonicalize(left) === canonical.canonicalize(right);
}

function id(number) {
  return `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
}

function transitionDigestBase(value) {
  const base = copy(value);
  delete base.transitionDigest;
  return base;
}

function requestDigestBase(value) {
  const base = transitionDigestBase(value);
  delete base.requestDigest;
  return base;
}

function seal(value) {
  value.requestDigest = digest(CONTRACT.transitionEnvelope.requestDigestNamespace, requestDigestBase(value));
  value.transitionDigest = digest(CONTRACT.transitionEnvelope.transitionDigestNamespace, transitionDigestBase(value));
  return value;
}

function headBinding(head) {
  if (!head) return null;
  return {
    transitionId: head.transitionId,
    transitionDigest: head.transitionDigest,
    sequence: head.sequence,
    state: head.state,
    effectiveSnapshotId: head.effectiveSnapshotId,
    effectiveSnapshotDigest: head.effectiveSnapshotDigest,
  };
}

function targetBinding(head, operation) {
  if (!head) return null;
  if (!['tombstone', 'reopen', 'reverse', 'replace'].includes(operation)) return null;
  return {
    transitionId: head.transitionId,
    transitionDigest: head.transitionDigest,
    snapshotId: head.effectiveSnapshotId,
    snapshotDigest: head.effectiveSnapshotDigest,
  };
}

function nextTransition(operation, sequence, head = null, overrides = {}) {
  const snapshotId = overrides.snapshotId || id(400 + sequence);
  const snapshotDigest = overrides.snapshotDigest || `sha256:${String(sequence % 10).repeat(64)}`;
  const eventSecond = String(sequence).padStart(2, '0');
  const value = {
    schemaVersion: CONTRACT.transitionEnvelope.schemaVersion,
    tenantId: TENANT,
    transitionId: overrides.transitionId || id(500 + sequence),
    triggerId: TRIGGER,
    sourceClassId: SOURCE_CLASS,
    recordIdentityDigest: RECORD,
    eventKind: EVENT_KIND,
    operation,
    sequence,
    snapshotBinding: {
      snapshotId,
      snapshotDigest,
      lineageKind: sequence === 1 ? 'original' : 'correction',
      lineageSequence: sequence,
      predecessorSnapshotId: head ? head.effectiveSnapshotId : null,
      predecessorSnapshotDigest: head ? head.effectiveSnapshotDigest : null,
      eventTime: overrides.eventTime || `2026-10-28T00:00:${eventSecond}.000Z`,
      observedAt: overrides.observedAt || `2026-10-28T00:01:${eventSecond}.000Z`,
    },
    predecessorBinding: headBinding(head),
    targetBinding: targetBinding(head, operation),
    trustedDispositionBinding: {
      resolverId: `mission28.part4d.${operation}.v1`,
      resolverDigest: overrides.resolverDigest || `sha256:${String((sequence + 3) % 10).repeat(64)}`,
      operation,
      sourceStateDigest: overrides.sourceStateDigest || `sha256:${String((sequence + 6) % 10).repeat(64)}`,
    },
    requestDigest: '',
    transitionDigest: '',
  };
  if (overrides.snapshotBinding) value.snapshotBinding = overrides.snapshotBinding;
  if (Object.hasOwn(overrides, 'predecessorBinding')) value.predecessorBinding = overrides.predecessorBinding;
  if (Object.hasOwn(overrides, 'targetBinding')) value.targetBinding = overrides.targetBinding;
  if (overrides.trustedDispositionBinding) value.trustedDispositionBinding = overrides.trustedDispositionBinding;
  return seal(value);
}

function trustedFor(candidate, currentHead) {
  return {
    lineageIdentity: {
      tenantId: candidate.tenantId,
      triggerId: candidate.triggerId,
      sourceClassId: candidate.sourceClassId,
      recordIdentityDigest: candidate.recordIdentityDigest,
      eventKind: candidate.eventKind,
    },
    snapshotBinding: copy(candidate.snapshotBinding),
    dispositionBinding: copy(candidate.trustedDispositionBinding),
    currentHead: headBinding(currentHead),
  };
}

function resultState(operation) {
  if (operation === 'tombstone') return 'tombstoned';
  if (operation === 'reverse') return 'reversed';
  return 'active';
}

function validateEnvelope(candidate, trusted, authorityLineage, currentHead) {
  ownPlain(candidate, 'candidate');
  ownPlain(trusted, 'trusted');
  exact(candidate, CONTRACT.transitionEnvelope.exactFields, 'transition');
  exact(candidate.snapshotBinding, CONTRACT.transitionEnvelope.snapshotBindingExactFields, 'snapshot binding');
  if (candidate.predecessorBinding !== null) {
    exact(candidate.predecessorBinding, CONTRACT.transitionEnvelope.predecessorBindingExactFields, 'predecessor binding');
  }
  if (candidate.targetBinding !== null) {
    exact(candidate.targetBinding, CONTRACT.transitionEnvelope.targetBindingExactFields, 'target binding');
  }
  exact(candidate.trustedDispositionBinding,
    CONTRACT.transitionEnvelope.trustedDispositionBindingExactFields, 'disposition binding');
  exact(trusted, ['lineageIdentity', 'snapshotBinding', 'dispositionBinding', 'currentHead'], 'trusted resolution');
  exact(trusted.lineageIdentity, CONTRACT.lineageIdentity.exactFields, 'trusted lineage');

  if (candidate.schemaVersion !== CONTRACT.transitionEnvelope.schemaVersion ||
      !UUID.test(candidate.tenantId) || !UUID.test(candidate.transitionId) ||
      !DIGEST.test(candidate.recordIdentityDigest) || !Number.isSafeInteger(candidate.sequence) || candidate.sequence < 1 ||
      !CONTRACT.transitionEnvelope.operations.includes(candidate.operation) ||
      !UUID.test(candidate.snapshotBinding.snapshotId) || !DIGEST.test(candidate.snapshotBinding.snapshotDigest) ||
      !Number.isSafeInteger(candidate.snapshotBinding.lineageSequence) ||
      !UTC.test(candidate.snapshotBinding.eventTime) || !UTC.test(candidate.snapshotBinding.observedAt) ||
      !DIGEST.test(candidate.trustedDispositionBinding.resolverDigest) ||
      !DIGEST.test(candidate.trustedDispositionBinding.sourceStateDigest) ||
      candidate.trustedDispositionBinding.operation !== candidate.operation ||
      !DIGEST.test(candidate.requestDigest) || !DIGEST.test(candidate.transitionDigest)) {
    throw new Error('transition primitive');
  }
  const catalog = PART4A.triggers.find(trigger => trigger.id === candidate.triggerId);
  if (!catalog || catalog.sourceClassId !== candidate.sourceClassId ||
      !catalog.eventTime.kinds.some(kind => kind.eventKind === candidate.eventKind)) {
    throw new Error('Part4A catalog identity');
  }
  const candidateLineage = {
    tenantId: candidate.tenantId, triggerId: candidate.triggerId, sourceClassId: candidate.sourceClassId,
    recordIdentityDigest: candidate.recordIdentityDigest, eventKind: candidate.eventKind,
  };
  if (!same(candidateLineage, authorityLineage) ||
      !same(candidateLineage, trusted.lineageIdentity) ||
      !same(candidate.snapshotBinding, trusted.snapshotBinding) ||
      !same(candidate.trustedDispositionBinding, trusted.dispositionBinding) ||
      !same(headBinding(currentHead), trusted.currentHead)) {
    throw new Error('trusted resolution mismatch');
  }
  if (candidate.requestDigest !== digest(CONTRACT.transitionEnvelope.requestDigestNamespace, requestDigestBase(candidate)) ||
      candidate.transitionDigest !== digest(CONTRACT.transitionEnvelope.transitionDigestNamespace,
        transitionDigestBase(candidate))) throw new Error('transition digest');
  return true;
}

function validateNew(candidate, currentHead, snapshotIdentities) {
  const rule = CONTRACT.transitionRules[candidate.operation];
  const priorState = currentHead ? currentHead.state : null;
  if (!rule.allowedPriorStates.includes(priorState) || candidate.sequence !== (currentHead ? currentHead.sequence + 1 : 1) ||
      candidate.snapshotBinding.lineageSequence !== candidate.sequence) throw new Error('state or sequence precedence');
  if (currentHead === null) {
    if (candidate.operation !== 'original' || candidate.predecessorBinding !== null || candidate.targetBinding !== null ||
        candidate.snapshotBinding.lineageKind !== 'original' ||
        candidate.snapshotBinding.predecessorSnapshotId !== null ||
        candidate.snapshotBinding.predecessorSnapshotDigest !== null) throw new Error('original precedence');
  } else {
    if (!same(candidate.predecessorBinding, headBinding(currentHead)) ||
        candidate.snapshotBinding.lineageKind !== 'correction' ||
        candidate.snapshotBinding.predecessorSnapshotId !== currentHead.effectiveSnapshotId ||
        candidate.snapshotBinding.predecessorSnapshotDigest !== currentHead.effectiveSnapshotDigest) {
      throw new Error('predecessor precedence');
    }
    const expectedTarget = targetBinding(currentHead, candidate.operation);
    if (!same(candidate.targetBinding, expectedTarget)) throw new Error('target precedence');
  }
  if (snapshotIdentities.ids.has(candidate.snapshotBinding.snapshotId) ||
      snapshotIdentities.digests.has(candidate.snapshotBinding.snapshotDigest)) {
    throw new Error('snapshot alias reuse');
  }
  return true;
}

class FactStore {
  constructor() {
    this.authorityLineage = {
      tenantId: TENANT,
      triggerId: TRIGGER,
      sourceClassId: SOURCE_CLASS,
      recordIdentityDigest: RECORD,
      eventKind: EVENT_KIND,
    };
    this.head = null;
    this.byId = new Map();
    this.byFingerprint = new Map();
    this.snapshotIds = new Set();
    this.snapshotDigests = new Set();
  }

  fingerprint(candidate) {
    return canonical.canonicalize({
      tenantId: candidate.tenantId, triggerId: candidate.triggerId,
      sourceClassId: candidate.sourceClassId, recordIdentityDigest: candidate.recordIdentityDigest,
      eventKind: candidate.eventKind, operation: candidate.operation, sequence: candidate.sequence,
      snapshotBinding: candidate.snapshotBinding,
      predecessorBinding: candidate.predecessorBinding,
      targetBinding: candidate.targetBinding,
      trustedDispositionBinding: candidate.trustedDispositionBinding,
    });
  }

  apply(candidate, trusted) {
    validateEnvelope(candidate, trusted, this.authorityLineage, this.head);
    const stored = this.byId.get(candidate.transitionId);
    if (stored) {
      if (stored.requestDigest === candidate.requestDigest && stored.transitionDigest === candidate.transitionDigest &&
          same(stored.document, candidate)) return { ...stored.result, replayed: true,
        currentHead: copy(this.head), eligibilityState: 'replay_or_duplicate_not_currentness_authority' };
      throw new Error('transition identity conflict');
    }
    const duplicate = this.byFingerprint.get(this.fingerprint(candidate));
    if (duplicate) return { ...duplicate.result, coalesced: true,
      currentHead: copy(this.head), eligibilityState: 'replay_or_duplicate_not_currentness_authority' };

    validateNew(candidate, this.head, { ids: this.snapshotIds, digests: this.snapshotDigests });
    const head = {
      transitionId: candidate.transitionId,
      transitionDigest: candidate.transitionDigest,
      sequence: candidate.sequence,
      state: resultState(candidate.operation),
      effectiveSnapshotId: candidate.snapshotBinding.snapshotId,
      effectiveSnapshotDigest: candidate.snapshotBinding.snapshotDigest,
    };
    const result = { stored: true, replayed: false, coalesced: false, head: copy(head),
      eligibilityState: head.state === 'active' ? 'fact_current_not_action_authority' : 'ineligible' };
    const row = { document: copy(candidate), requestDigest: candidate.requestDigest,
      transitionDigest: candidate.transitionDigest, result };
    this.byId.set(candidate.transitionId, row);
    this.byFingerprint.set(this.fingerprint(candidate), row);
    this.snapshotIds.add(candidate.snapshotBinding.snapshotId);
    this.snapshotDigests.add(candidate.snapshotBinding.snapshotDigest);
    this.head = head;
    return copy(result);
  }
}

function append(store, candidate) {
  return store.apply(candidate, trustedFor(candidate, store.head));
}

describe('Mission 28 Part 4D deterministic fact precedence', () => {
  test('binds the exact released inputs and keeps precedence contract-only', () => {
    expect(CONTRACT.authority).toEqual({ mission: 28, part: '4D', state: 'implementation_candidate_only',
      baselineCommit: 'e66a03a89b8fe8102627d896e70ea73bef8d6fed',
      baselineTree: '5b24886c445df8ee314a82569949d40af88c6217',
      contractOnlyNoRuntimeResolverMounted: true, newDatabaseObjectOrMigrationAdded: false,
      routeUiSchedulerWorkerQueueProviderRecipientOrMoneyAuthorityGranted: false,
      sourceFactOrPrecedenceResultGrantsActionAuthority: false });
    expect(CONTRACT.part4CRelease).toMatchObject({ acceptedSourceHead: 'cd18dc20cb7882b01ebca260220a7c5dc1427df7',
      pullRequest: 563, mergedMain: 'e66a03a89b8fe8102627d896e70ea73bef8d6fed',
      deployment: 'f8877912-3064-4ad7-a80b-93fe232d551e', deploymentState: 'SUCCESS_RUNNING',
      auditVerdict: 'P0=P1=P2=P3=0' });
    for (const input of CONTRACT.frozenInputs) expect(normalizedLfSha256(input.path)).toBe(input.normalizedLfSha256);
    expect(CONTRACT.transitionEnvelope.operations)
      .toEqual(['original', 'correction', 'tombstone', 'reopen', 'reverse', 'replace']);
    expect(CONTRACT.concurrencyContract).toMatchObject({
      currentRuntimeImplementationAvailable: false,
      crossRequestCache: 'never_authoritative_reread_current_head_inside_lock',
      rollback: 'no_partial_head_or_transition',
    });
  });

  test('applies the complete deterministic original/correction/tombstone/reopen/reverse/replace chain', () => {
    const store = new FactStore();
    for (const [operation, expectedState] of [
      ['original', 'active'], ['correction', 'active'], ['tombstone', 'tombstoned'],
      ['reopen', 'active'], ['reverse', 'reversed'], ['replace', 'active'],
    ]) {
      const candidate = nextTransition(operation, (store.head?.sequence || 0) + 1, store.head);
      const result = append(store, candidate);
      expect(result).toMatchObject({ stored: true, replayed: false, coalesced: false,
        head: { state: expectedState, transitionId: candidate.transitionId,
          effectiveSnapshotId: candidate.snapshotBinding.snapshotId } });
      expect(result.eligibilityState).toBe(expectedState === 'active'
        ? 'fact_current_not_action_authority' : 'ineligible');
    }
    expect(store.head.sequence).toBe(6);
  });

  test('coalesces exact duplicates, replays exact identity and rejects conflicting replay material', () => {
    const store = new FactStore();
    const original = nextTransition('original', 1);
    const first = append(store, original);
    expect(append(store, original)).toEqual({ ...first, replayed: true, currentHead: first.head,
      eligibilityState: 'replay_or_duplicate_not_currentness_authority' });
    const alias = nextTransition('original', 1, null, { transitionId: id(599),
      snapshotBinding: copy(original.snapshotBinding),
      trustedDispositionBinding: copy(original.trustedDispositionBinding) });
    expect(append(store, alias)).toEqual({ ...first, coalesced: true, currentHead: first.head,
      eligibilityState: 'replay_or_duplicate_not_currentness_authority' });
    expect(store.byId.size).toBe(1);
    const conflict = copy(original);
    conflict.snapshotBinding.observedAt = '2026-10-28T00:02:01.000Z';
    seal(conflict);
    expect(() => append(store, conflict)).toThrow(/identity conflict/);
    const falseDuplicate = nextTransition('original', 1, null, { transitionId: id(598),
      snapshotBinding: { ...copy(original.snapshotBinding), eventTime: '2026-10-27T23:59:59.000Z' },
      trustedDispositionBinding: copy(original.trustedDispositionBinding) });
    expect(() => append(store, falseDuplicate)).toThrow(/state or sequence|snapshot alias/);
  });

  test('validates the complete envelope before same-ID replay or new-ID coalescing lookup', () => {
    const store = new FactStore();
    const original = nextTransition('original', 1);
    append(store, original);

    const malformedReplay = copy(original);
    malformedReplay.unexpected = 'must_be_rejected';
    expect(() => store.apply(malformedReplay, trustedFor(malformedReplay, store.head))).toThrow(/transition shape/);

    const missingSchemaReplay = copy(original);
    delete missingSchemaReplay.schemaVersion;
    expect(() => store.apply(missingSchemaReplay, trustedFor(missingSchemaReplay, store.head)))
      .toThrow(/transition shape/);

    const malformedAlias = nextTransition('original', 1, null, { transitionId: id(597),
      snapshotBinding: copy(original.snapshotBinding),
      trustedDispositionBinding: copy(original.trustedDispositionBinding) });
    delete malformedAlias.requestDigest;
    delete malformedAlias.transitionDigest;
    expect(() => store.apply(malformedAlias, trustedFor(malformedAlias, store.head))).toThrow(/transition shape/);

    expect(store.byId.size).toBe(1);
    expect(store.head.transitionId).toBe(original.transitionId);
  });

  test('rejects every skipped, reordered, stale or illegal state transition', () => {
    for (const operation of ['correction', 'tombstone', 'reopen', 'reverse', 'replace']) {
      const empty = new FactStore();
      expect(() => append(empty, nextTransition(operation, 1))).toThrow(/state|original/);
    }
    const store = new FactStore();
    const original = nextTransition('original', 1); append(store, original);
    const staleHead = copy(store.head);
    expect(() => append(store, nextTransition('original', 2, store.head))).toThrow(/state|predecessor/);
    expect(() => append(store, nextTransition('reopen', 2, store.head))).toThrow(/state/);
    const correction = nextTransition('correction', 2, store.head); append(store, correction);
    const tombstone = nextTransition('tombstone', 3, store.head); append(store, tombstone);
    expect(() => append(store, nextTransition('correction', 4, store.head))).toThrow(/state/);
    expect(() => append(store, nextTransition('reverse', 4, store.head))).toThrow(/state/);
    const stale = nextTransition('correction', 2, staleHead, { transitionId: id(777), snapshotId: id(778),
      snapshotDigest: `sha256:${'7'.repeat(64)}` });
    expect(() => store.apply(stale, trustedFor(stale, staleHead))).toThrow(/trusted resolution mismatch/);
    const gap = nextTransition('reopen', 5, store.head);
    expect(() => append(store, gap)).toThrow(/state or sequence/);
  });

  test('uses exact lineage rather than event or observation time for late facts and equal-time candidates', () => {
    const store = new FactStore();
    const first = nextTransition('original', 1, null, {
      eventTime: '2026-10-28T02:00:00.000Z', observedAt: '2026-10-28T03:00:00.000Z',
    });
    append(store, first);
    const lateCorrection = nextTransition('correction', 2, store.head, {
      eventTime: '2026-10-27T02:00:00.000Z', observedAt: '2026-10-28T03:00:00.000Z',
    });
    expect(append(store, lateCorrection).head.transitionId).toBe(lateCorrection.transitionId);
    const stale = nextTransition('correction', 2, headBinding({ ...store.head,
      transitionId: first.transitionId, transitionDigest: first.transitionDigest, sequence: 1,
      state: 'active', effectiveSnapshotId: first.snapshotBinding.snapshotId,
      effectiveSnapshotDigest: first.snapshotBinding.snapshotDigest }), {
      transitionId: id(779), snapshotId: id(780), snapshotDigest: `sha256:${'8'.repeat(64)}`,
    });
    expect(() => store.apply(stale, trustedFor(stale, {
      transitionId: first.transitionId, transitionDigest: first.transitionDigest, sequence: 1,
      state: 'active', effectiveSnapshotId: first.snapshotBinding.snapshotId,
      effectiveSnapshotDigest: first.snapshotBinding.snapshotDigest,
    }))).toThrow(/trusted resolution mismatch/);
    expect(store.head.transitionId).toBe(lateCorrection.transitionId);
  });

  test('rejects target, predecessor, snapshot alias and trusted disposition tampering after redigest', () => {
    const store = new FactStore();
    const original = nextTransition('original', 1); append(store, original);
    const canonicalCandidate = nextTransition('tombstone', 2, store.head);
    const trusted = trustedFor(canonicalCandidate, store.head);
    const attacks = [
      value => { value.predecessorBinding.transitionDigest = `sha256:${'8'.repeat(64)}`; },
      value => { value.targetBinding.snapshotId = id(999); },
      value => { value.snapshotBinding.predecessorSnapshotDigest = `sha256:${'7'.repeat(64)}`; },
      value => { value.trustedDispositionBinding.operation = 'reverse'; },
      value => { value.operation = 'reverse'; },
      value => { value.sourceClassId = 'mission27_financial_collection'; },
      value => { value.eventKind = 'opportunity_state_changed'; },
      value => { value.tenantId = OTHER_TENANT; },
    ];
    for (const mutate of attacks) {
      const candidate = copy(canonicalCandidate); mutate(candidate); seal(candidate);
      expect(() => store.apply(candidate, trusted)).toThrow();
    }
    const reused = nextTransition('tombstone', 2, store.head, {
      snapshotBinding: { ...copy(canonicalCandidate.snapshotBinding),
        snapshotId: original.snapshotBinding.snapshotId, snapshotDigest: `sha256:${'9'.repeat(64)}` },
    });
    expect(() => append(store, reused)).toThrow(/snapshot alias/);
    const retargeted = copy(canonicalCandidate);
    retargeted.tenantId = OTHER_TENANT;
    seal(retargeted);
    expect(() => store.apply(retargeted, trustedFor(retargeted, store.head)))
      .toThrow(/trusted resolution mismatch/);
  });

  test('serializes concurrent different candidates and coalesces concurrent exact duplicates', () => {
    const store = new FactStore();
    append(store, nextTransition('original', 1));
    const sharedHead = copy(store.head);
    const winner = nextTransition('correction', 2, sharedHead, {
      transitionId: id(601), snapshotId: id(602), snapshotDigest: `sha256:${'2'.repeat(64)}` });
    const loser = nextTransition('correction', 2, sharedHead, {
      transitionId: id(603), snapshotId: id(604), snapshotDigest: `sha256:${'3'.repeat(64)}` });
    const winnerTrust = trustedFor(winner, sharedHead);
    const loserTrust = trustedFor(loser, sharedHead);
    expect(store.apply(winner, winnerTrust).head.transitionId).toBe(winner.transitionId);
    expect(() => store.apply(loser, loserTrust)).toThrow(/trusted resolution mismatch/);
    expect(store.head.transitionId).toBe(winner.transitionId);

    const duplicateAlias = nextTransition('correction', 2, sharedHead, {
      transitionId: id(605), snapshotBinding: copy(winner.snapshotBinding),
      trustedDispositionBinding: copy(winner.trustedDispositionBinding) });
    expect(store.apply(duplicateAlias, trustedFor(duplicateAlias, store.head))).toMatchObject({
      coalesced: true, currentHead: { transitionId: winner.transitionId },
      eligibilityState: 'replay_or_duplicate_not_currentness_authority',
    });
    expect(store.head.transitionId).toBe(winner.transitionId);
  });

  test('replay after a later correction returns historical evidence plus the current head and no eligibility', () => {
    const store = new FactStore();
    const original = nextTransition('original', 1); append(store, original);
    const correction = nextTransition('correction', 2, store.head); append(store, correction);
    const replay = store.apply(original, trustedFor(original, store.head));
    expect(replay).toMatchObject({ replayed: true,
      head: { transitionId: original.transitionId },
      currentHead: { transitionId: correction.transitionId },
      eligibilityState: 'replay_or_duplicate_not_currentness_authority' });
    expect(store.head.transitionId).toBe(correction.transitionId);
  });

  test('invalidates an earlier Part4C head binding after any authoritative advance', () => {
    const store = new FactStore();
    append(store, nextTransition('original', 1));
    const evaluationHead = headBinding(store.head);
    append(store, nextTransition('correction', 2, store.head));
    expect(same(evaluationHead, headBinding(store.head))).toBe(false);
    expect(CONTRACT.currentnessHandoff.preEffectRule)
      .toBe('Part4C_pre_effect_must_reread_the_head_and_any_change_invalidates_the_prior_decision');
    append(store, nextTransition('tombstone', 3, store.head));
    expect(store.head.state).toBe('tombstoned');
  });

  test('rejects non-data aliases, accessors, symbols, sparse arrays, prototypes and proxies before authority', () => {
    const canonicalCandidate = nextTransition('original', 1);
    const trusted = trustedFor(canonicalCandidate, null);
    const getter = copy(canonicalCandidate); let getterCalls = 0;
    Object.defineProperty(getter.snapshotBinding, 'snapshotDigest', { enumerable: true,
      get() { getterCalls += 1; return canonicalCandidate.snapshotBinding.snapshotDigest; } });
    expect(() => new FactStore().apply(getter, trusted)).toThrow(/descriptor/);
    expect(getterCalls).toBe(0);
    const symbol = copy(canonicalCandidate); symbol[Symbol('hidden')] = true;
    expect(() => new FactStore().apply(symbol, trusted)).toThrow(/symbol/);
    const custom = copy(canonicalCandidate); Object.setPrototypeOf(custom.snapshotBinding, { inherited: true });
    expect(() => new FactStore().apply(custom, trusted)).toThrow(/plain object/);
    const proxy = new Proxy(copy(canonicalCandidate), { ownKeys() { throw new Error('trap ran'); } });
    expect(() => new FactStore().apply(proxy, trusted)).toThrow(/plain data/);
    const aliased = copy(canonicalCandidate); aliased.targetBinding = aliased.snapshotBinding;
    expect(() => new FactStore().apply(aliased, trusted)).toThrow(/plain data|shape/);
  });

  test('roadmap and ledger release Part4C, name only Part4D candidate and retain migration274/no275', () => {
    const roadmap = fs.readFileSync(path.join(ROOT, 'docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md'), 'utf8');
    const ledger = fs.readFileSync(path.join(ROOT, 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md'), 'utf8');
    expect(roadmap).toContain('Parts 1A–8A are released. Part 8B is the sole implementation candidate.');
    expect(ledger).toContain('| 15 | 4C | Evaluation-time and pre-effect currentness revalidation | **Released** |');
    expect(ledger).toContain('| 16 | 4D | Duplicate/replay/reorder/correction/tombstone/concurrency handling | **Released** |');
    const migrations = fs.readdirSync(path.join(ROOT, 'migrations')).filter(name => /^\d+.*\.sql$/.test(name)).sort();
    expect(migrations).toHaveLength(283);
    expect(migrations.at(-1)).toBe('287_canonical_automation_estimate_quote_resolution_v1.sql');
    expect(migrations.some(name => name.startsWith('288_'))).toBe(false);
    expect(migrations.filter(name => name.startsWith('281_'))).toEqual(['281_canonical_automation_sender_recipient_authority_v1.sql']);
  });

  test('retains every unavailable runtime effect and independent-evidence boundary', () => {
    expect(CONTRACT.laterSliceBoundary).toEqual({
      part5: 'rule_grammar_evaluation_preview_collision_suppression_and_dry_run_remain_planned_unimplemented',
      part6Plus: 'outbox_scheduling_execution_provider_recipient_message_and_effect_authority_remain_planned_unimplemented',
      runtimeMount: 'a_future_slice_must_implement_the_locked_store_and_resolver_before_any_runtime_consumer_exists',
    });
    for (const value of ['mounted_fact_precedence_resolver_or_transactional_head_store',
      'provider_sandbox_private_production_or_live_provider', 'real_recipient_message_document_or_external_effect',
      'upstream_mutation_accounting_or_live_money',
      'hosted_load_SLA_physical_devices_manual_assistive_technology_or_founder_visual_approval']) {
      expect(CONTRACT.unavailableEvidence).toContain(value);
    }
  });
});
