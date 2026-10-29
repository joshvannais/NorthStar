'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { types } = require('node:util');
const canonical = require('../../src/automation/canonicalJson');

const ROOT = path.resolve(__dirname, '../..');
const CONTRACT_PATH = path.join(ROOT, 'docs/architecture/MISSION_28_PART7D_CHANNEL_DELIVERY_HANDOFF_CONTRACT.json');
const CONTRACT_MD = path.join(ROOT, 'docs/architecture/MISSION_28_PART7D_CHANNEL_DELIVERY_HANDOFF_CONTRACT.md');
const MIGRATION = path.join(ROOT, 'migrations/284_canonical_automation_channel_delivery_handoff_v1.sql');
const ROADMAP = path.join(ROOT, 'docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md');
const LEDGER = path.join(ROOT, 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md');
const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8'));
const digestLf = relative => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, relative), 'utf8').replace(/\r\n/g, '\n')).digest('hex').toUpperCase();
const copy = value => JSON.parse(JSON.stringify(value));
const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;

function assertPlainData(value, seen = new Set()) {
  if (value === null || ['string', 'boolean', 'number'].includes(typeof value)) {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('scalar');
    return;
  }
  if (types.isProxy(value) || typeof value !== 'object' || seen.has(value)) throw new Error('plain');
  seen.add(value);
  const array = Array.isArray(value);
  if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype)) throw new Error('prototype');
  if (array && Object.keys(value).length !== value.length) throw new Error('sparse');
  for (const key of Reflect.ownKeys(value)) {
    if (array && key === 'length') continue;
    if (typeof key !== 'string') throw new Error('symbol');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor) || descriptor.get || descriptor.set) throw new Error('descriptor');
    assertPlainData(descriptor.value, seen);
  }
  seen.delete(value);
}
function exactKeys(value, expected) {
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expected.length || expected.some(key => !keys.includes(key))) throw new Error('shape');
}

const UUID = new RegExp(contract.identityGrammar.uuidPattern);
const UTC = new RegExp(contract.identityGrammar.utcInstantPattern);
const INPUT_KEYS = contract.resolutionEnvelope.exactFields;
const ACTOR_KEYS = contract.resolutionEnvelope.actorBindingExactFields;
const CHANNELS = new Map(contract.channelCatalog.map(item => [item.channelId, item]));

function trusted(value) {
  return Object.fromEntries(['tenantId', 'transactionId', 'unitId', 'contentPreviewId', 'senderRecipientResolutionId', 'permissionResolutionId', 'requestedChannelId', 'actorBinding', 'evaluatedAt'].map(key => [key, copy(value[key])]));
}
function candidate(channelId = 'in_app_passive', suffix = 1) {
  const value = {
    schemaVersion: 'mission28.channel-resolution.v1', tenantId: uuid(28), channelResolutionId: uuid(910000 + suffix),
    transactionId: uuid(600001), unitId: uuid(600002), contentPreviewId: uuid(900001),
    senderRecipientResolutionId: uuid(700001), permissionResolutionId: uuid(800001), requestedChannelId: channelId,
    actorBinding: { actorId: uuid(10), sessionId: uuid(11), membershipId: uuid(10), membershipRole: 'owner' },
    evaluatedAt: '2026-10-28T12:00:00.000000Z', requestDigest: ''
  };
  value.requestDigest = canonical.digest('mission28.channel-resolution.v1\n', Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'requestDigest')));
  return value;
}
function authority(value) {
  return {
    tenantId: value.tenantId, transactionId: value.transactionId, unitId: value.unitId, contentPreviewId: value.contentPreviewId,
    contentPreviewDigest: 'sha256:' + '1'.repeat(64), senderRecipientResolutionId: value.senderRecipientResolutionId,
    permissionResolutionId: value.permissionResolutionId, unitChannelId: 'in_app_passive', providerMode: 'provider_disabled',
    effectClass: 'internal_record_only', permissionResult: 'clear_internal_passive_no_effect', permissionChannelId: 'in_app_passive',
    latestPermission: true, recipientCurrent: true, linkSelectionCount: 0, attachmentSelectionCount: 0,
    actorBinding: copy(value.actorBinding)
  };
}
function resolve(value, separatelyTrusted, serverResolved, indexes = null) {
  assertPlainData(value);
  if (separatelyTrusted === undefined) separatelyTrusted = trusted(value);
  if (serverResolved === undefined) serverResolved = authority(value);
  assertPlainData(separatelyTrusted); assertPlainData(serverResolved);
  exactKeys(value, INPUT_KEYS); exactKeys(value.actorBinding, ACTOR_KEYS);
  if (value.schemaVersion !== 'mission28.channel-resolution.v1' ||
      ![value.tenantId, value.channelResolutionId, value.transactionId, value.unitId, value.contentPreviewId, value.senderRecipientResolutionId, value.permissionResolutionId, value.actorBinding.actorId, value.actorBinding.sessionId, value.actorBinding.membershipId].every(item => UUID.test(item)) ||
      value.actorBinding.membershipRole !== 'owner' || !UTC.test(value.evaluatedAt) || !CHANNELS.has(value.requestedChannelId)) throw new Error('shape');
  const expectedRequest = canonical.digest('mission28.channel-resolution.v1\n', Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'requestDigest')));
  if (value.requestDigest !== expectedRequest || canonical.canonicalize(separatelyTrusted) !== canonical.canonicalize(trusted(value))) throw new Error('trust');
  for (const key of ['tenantId', 'transactionId', 'unitId', 'contentPreviewId', 'senderRecipientResolutionId', 'permissionResolutionId']) {
    if (serverResolved[key] !== value[key]) throw new Error('authority');
  }
  if (canonical.canonicalize(serverResolved.actorBinding) !== canonical.canonicalize(value.actorBinding) ||
      serverResolved.unitChannelId !== 'in_app_passive' || serverResolved.providerMode !== 'provider_disabled' ||
      serverResolved.effectClass !== 'internal_record_only' || serverResolved.permissionResult !== 'clear_internal_passive_no_effect' ||
      serverResolved.permissionChannelId !== 'in_app_passive' || !serverResolved.latestPermission || !serverResolved.recipientCurrent ||
      serverResolved.linkSelectionCount !== 0 || serverResolved.attachmentSelectionCount !== 0) throw new Error('currentness');
  const entry = CHANNELS.get(value.requestedChannelId);
  const materialDigest = canonical.digest('mission28.channel-resolution-material.v1\n', separatelyTrusted);
  if (indexes) {
    const byId = indexes.byId.get(value.channelResolutionId); const byMaterial = indexes.byMaterial.get(materialDigest);
    if (byId && byId.requestDigest !== value.requestDigest) throw new Error('replay conflict');
    if (byMaterial && byMaterial.channelResolutionId !== value.channelResolutionId) throw new Error('clone');
    if (byId) return { ...copy(byId.output), replayed: true };
  }
  const evidence = {
    tenantId: value.tenantId, channelResolutionId: value.channelResolutionId, transactionId: value.transactionId, unitId: value.unitId,
    contentPreviewId: value.contentPreviewId, contentPreviewDigest: serverResolved.contentPreviewDigest,
    senderRecipientResolutionId: value.senderRecipientResolutionId, permissionResolutionId: value.permissionResolutionId,
    requestedChannelId: entry.channelId, transportClass: entry.transportClass, capabilityState: entry.capabilityState,
    resultState: entry.resultState, providerMode: entry.providerMode, providerRequestIdentityState: entry.providerRequestIdentityState,
    fallbackState: entry.fallbackState, costState: entry.costState, recipientPrefillState: entry.recipientPrefillState,
    attachmentState: entry.attachmentState, handoffState: entry.handoffState, attemptState: entry.attemptState,
    evaluatedAt: value.evaluatedAt
  };
  const output = { ...evidence, channelResolutionDigest: canonical.digest('mission28.channel-resolution-evidence.v1\n', evidence),
    handoffOpened: false, providerRequestCreated: false, attemptCreated: false, messageSent: false, delivered: false, effectCreated: false, replayed: false };
  if (indexes) {
    const row = { channelResolutionId: value.channelResolutionId, requestDigest: value.requestDigest, output: copy(output) };
    indexes.byId.set(value.channelResolutionId, row); indexes.byMaterial.set(materialDigest, row);
  }
  return output;
}

describe('Mission 28 Part 7D provider-neutral channel and handoff truth', () => {
  test('binds exact released Part 7C provenance and frozen inputs', () => {
    expect(contract.authority).toMatchObject({ baselineCommit: '9dfa3da1beb738dd781ffac736d8f033f86ccd7c', baselineTree: '8c65f6b558851981e5acb6f88efb41192676eb38' });
    expect(contract.part7CRelease).toMatchObject({ acceptedSourceHead: '12c01d6aacd1a96d7425f65a62e0be4f5effef22', pullRequest: 577, mergedMain: '9dfa3da1beb738dd781ffac736d8f033f86ccd7c', deployment: '12131ce9-796c-4bf1-ac62-6166611319db', deploymentState: 'SUCCESS_RUNNING' });
    for (const input of contract.frozenInputs) expect(digestLf(input.path)).toBe(input.normalizedLfSha256);
  });

  test('freezes four exact provider-neutral channel dispositions without effect authority', () => {
    expect([...CHANNELS]).toHaveLength(4);
    expect(contract.channelCatalog.map(item => item.channelId)).toEqual(['in_app_passive', 'native_manual_handoff', 'email', 'sms']);
    expect(contract.channelCatalog.every(item => item.providerMode === 'provider_disabled' && item.providerRequestIdentityState === 'not_created' && item.fallbackState === 'none' && item.attemptState === 'not_created')).toBe(true);
    expect(contract.privacyAndEffects).toEqual(expect.objectContaining({ providerAttempts: 0, nativeHandoffsOpened: 0, recipientMessages: 0, externalEffects: 0, moneyEffects: 0 }));
  });

  test.each(contract.channelCatalog)('projects exact $channelId truth without attempt, send or delivery', entry => {
    const output = resolve(candidate(entry.channelId));
    expect(output).toMatchObject({ requestedChannelId: entry.channelId, transportClass: entry.transportClass, capabilityState: entry.capabilityState,
      resultState: entry.resultState, providerMode: 'provider_disabled', providerRequestIdentityState: 'not_created', fallbackState: 'none',
      costState: entry.costState, recipientPrefillState: entry.recipientPrefillState, attachmentState: entry.attachmentState,
      handoffState: entry.handoffState, attemptState: 'not_created', handoffOpened: false, providerRequestCreated: false,
      attemptCreated: false, messageSent: false, delivered: false, effectCreated: false });
  });

  test('rejects unknown, extra, missing and candidate-supplied output fields', () => {
    for (const mutate of [
      value => { value.requestedChannelId = 'whatsapp'; }, value => { value.providerId = 'attacker-provider'; },
      value => { delete value.contentPreviewId; }, value => { value.handoffOpened = true; }, value => { value.messageSent = true; }
    ]) {
      const value = candidate(); mutate(value); value.requestDigest = canonical.digest('mission28.channel-resolution.v1\n', Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'requestDigest')));
      expect(() => resolve(value, trusted(value))).toThrow();
    }
  });

  test('rejects accessors, symbols, toJSON, proxies and custom prototypes before authority use', () => {
    let getterCalls = 0;
    const accessor = candidate(); Object.defineProperty(accessor, 'requestedChannelId', { enumerable: true, get() { getterCalls += 1; return 'in_app_passive'; } });
    expect(() => resolve(accessor)).toThrow(); expect(getterCalls).toBe(0);
    const symbol = candidate(); symbol[Symbol('secret')] = true; expect(() => resolve(symbol)).toThrow();
    const toJson = candidate(); Object.defineProperty(toJson, 'toJSON', { enumerable: false, value() { throw new Error('hook'); } }); expect(() => resolve(toJson)).toThrow();
    expect(() => resolve(new Proxy(candidate(), {}))).toThrow();
    const custom = candidate(); Object.setPrototypeOf(custom, { requestedChannelId: 'email' }); expect(() => resolve(custom)).toThrow();
  });

  test('rejects separately trusted substitution and server authority retargeting', () => {
    const value = candidate(); const wrongTrust = trusted(value); wrongTrust.requestedChannelId = 'email';
    expect(() => resolve(value, wrongTrust)).toThrow(/trust/);
    for (const mutate of [
      server => { server.tenantId = uuid(29); }, server => { server.contentPreviewId = uuid(99); },
      server => { server.permissionResolutionId = uuid(99); }, server => { server.permissionResult = 'unavailable'; },
      server => { server.latestPermission = false; }, server => { server.recipientCurrent = false; },
      server => { server.linkSelectionCount = 1; }
    ]) {
      const server = authority(value); mutate(server); expect(() => resolve(value, trusted(value), server)).toThrow();
    }
  });

  test('enforces exact replay and prevents cross-request clone reuse', () => {
    const indexes = { byId: new Map(), byMaterial: new Map() }; const value = candidate('email', 10);
    const first = resolve(value, trusted(value), authority(value), indexes); expect(first.replayed).toBe(false);
    expect(resolve(copy(value), trusted(value), authority(value), indexes)).toMatchObject({ channelResolutionDigest: first.channelResolutionDigest, replayed: true });
    const conflict = copy(value); conflict.requestedChannelId = 'sms'; conflict.requestDigest = canonical.digest('mission28.channel-resolution.v1\n', Object.fromEntries(Object.entries(conflict).filter(([key]) => key !== 'requestDigest')));
    expect(() => resolve(conflict, trusted(conflict), authority(conflict), indexes)).toThrow(/replay conflict/);
    const clone = copy(value); clone.channelResolutionId = uuid(910099); clone.requestDigest = canonical.digest('mission28.channel-resolution.v1\n', Object.fromEntries(Object.entries(clone).filter(([key]) => key !== 'requestDigest')));
    expect(() => resolve(clone, trusted(clone), authority(clone), indexes)).toThrow(/clone/);
  });

  test('keeps native handoff and external channels unavailable without fabricating outcomes', () => {
    for (const channelId of ['native_manual_handoff', 'email', 'sms']) {
      const output = resolve(candidate(channelId));
      expect(output.resultState).toMatch(/^unavailable_/); expect(output.handoffOpened).toBe(false);
      expect(output.providerRequestCreated).toBe(false); expect(output.messageSent).toBe(false); expect(output.delivered).toBe(false);
    }
    expect(contract.handoffEvidenceContract).toMatchObject({ currentMountedOperatingSystemIntegration: 'unavailable', candidateClaimCanEstablishOpened: false, composerOpenedMeansSent: false, composerOpenedMeansDelivered: false });
  });

  test('migration 284 is additive, immutable, forced-RLS, owner-only and no-effect', () => {
    const sql = fs.readFileSync(MIGRATION, 'utf8');
    for (const fragment of ['CREATE TABLE public.canonical_automation_channel_resolutions_v1', 'FORCE ROW LEVEL SECURITY',
      'canonical_automation_channel_resolutions_v1_immutable', 'canonical_automation_record_channel_resolution_v1',
      'REVOKE ALL ON FUNCTION public.canonical_automation_record_channel_resolution_v1(TEXT,JSONB) FROM PUBLIC',
      "'handoffOpened',FALSE", "'providerRequestCreated',FALSE", "'messageSent',FALSE", "'delivered',FALSE", "'effectCreated',FALSE"])
      expect(sql).toContain(fragment);
    expect(sql).not.toMatch(/CREATE\s+(?:OR\s+REPLACE\s+)?(?:ROUTE|VIEW)|INSERT\s+INTO\s+public\.(?:messages|provider)/i);
  });

  test('roadmap and ledger keep Part 7D candidate-only and later slices planned', () => {
    const roadmap = fs.readFileSync(ROADMAP, 'utf8'); const ledger = fs.readFileSync(LEDGER, 'utf8'); const markdown = fs.readFileSync(CONTRACT_MD, 'utf8');
    expect(roadmap).toContain('Parts 1A–12C are released. Part 12D is the sole implementation candidate.');
    expect(ledger).toContain('| 29 | 7C | Approved templates, bounded variables and AI-draft boundary | **Released** |');
    expect(ledger).toContain('| 30 | 7D | Provider-neutral email/SMS and truthful native handoff | **Released** |');
    expect(ledger).toContain('| 31 | 7E | Scoped links and customer-safe attachments | **Released** |');
    expect(ledger).toContain('Released migration source is byte-identical to the previously verified Part 9B deployment at 283 migrations through exact `287_canonical_automation_estimate_quote_resolution_v1.sql` with no 288');
    expect(markdown).toContain('composer-open event would remain a handoff only');
  });
});
