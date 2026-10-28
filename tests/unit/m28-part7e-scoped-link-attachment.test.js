'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { types } = require('node:util');
const canonical = require('../../src/automation/canonicalJson');

const ROOT = path.resolve(__dirname, '../..');
const CONTRACT_PATH = path.join(ROOT, 'docs/architecture/MISSION_28_PART7E_SCOPED_LINK_ATTACHMENT_CONTRACT.json');
const CONTRACT_MD = path.join(ROOT, 'docs/architecture/MISSION_28_PART7E_SCOPED_LINK_ATTACHMENT_CONTRACT.md');
const MIGRATION = path.join(ROOT, 'migrations/285_canonical_automation_scoped_link_attachment_v1.sql');
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
const CURRENT = contract.currentLaunchProfile;

function trusted(value) {
  return Object.fromEntries(['tenantId', 'transactionId', 'unitId', 'contentPreviewId', 'channelResolutionId',
    'senderRecipientResolutionId', 'permissionResolutionId', 'requestedProfileId', 'actorBinding', 'evaluatedAt'].map(key => [key, copy(value[key])]));
}
function candidate(suffix = 1) {
  const value = {
    schemaVersion: 'mission28.link-attachment-resolution.v1', tenantId: uuid(28), linkAttachmentResolutionId: uuid(920000 + suffix),
    transactionId: uuid(600001), unitId: uuid(600002), contentPreviewId: uuid(900001), channelResolutionId: uuid(910001),
    senderRecipientResolutionId: uuid(700001), permissionResolutionId: uuid(800001), requestedProfileId: CURRENT.profileId,
    actorBinding: { actorId: uuid(10), sessionId: uuid(11), membershipId: uuid(10), membershipRole: 'owner' },
    evaluatedAt: '2026-10-28T12:00:00.000000Z', requestDigest: ''
  };
  value.requestDigest = canonical.digest('mission28.link-attachment-resolution.v1\n', Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'requestDigest')));
  return value;
}
function authority(value) {
  return {
    tenantId: value.tenantId, transactionId: value.transactionId, unitId: value.unitId, runId: uuid(600003),
    contentPreviewId: value.contentPreviewId, contentPreviewDigest: 'sha256:' + '1'.repeat(64),
    channelResolutionId: value.channelResolutionId, channelResolutionDigest: 'sha256:' + '2'.repeat(64),
    senderRecipientResolutionId: value.senderRecipientResolutionId, permissionResolutionId: value.permissionResolutionId,
    unitChannelId: 'in_app_passive', providerMode: 'provider_disabled', effectClass: 'internal_record_only',
    permissionResult: 'clear_internal_passive_no_effect', permissionChannelId: 'in_app_passive', latestPermission: true,
    recipientCurrent: true, linkSelectionCount: 0, attachmentSelectionCount: 0, channelProviderMode: 'provider_disabled',
    channelProviderRequestIdentityState: 'not_created', channelFallbackState: 'none', channelAttemptState: 'not_created',
    actorBinding: copy(value.actorBinding)
  };
}
function resolve(value, separatelyTrusted, serverResolved, indexes = null) {
  assertPlainData(value);
  if (separatelyTrusted === undefined) separatelyTrusted = trusted(value);
  if (serverResolved === undefined) serverResolved = authority(value);
  assertPlainData(separatelyTrusted); assertPlainData(serverResolved);
  exactKeys(value, INPUT_KEYS); exactKeys(value.actorBinding, ACTOR_KEYS);
  if (value.schemaVersion !== 'mission28.link-attachment-resolution.v1' ||
      ![value.tenantId, value.linkAttachmentResolutionId, value.transactionId, value.unitId, value.contentPreviewId,
        value.channelResolutionId, value.senderRecipientResolutionId, value.permissionResolutionId,
        value.actorBinding.actorId, value.actorBinding.sessionId, value.actorBinding.membershipId].every(item => UUID.test(item)) ||
      value.requestedProfileId !== CURRENT.profileId || value.actorBinding.membershipRole !== 'owner' || !UTC.test(value.evaluatedAt)) throw new Error('shape');
  const expectedRequest = canonical.digest('mission28.link-attachment-resolution.v1\n', Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'requestDigest')));
  if (value.requestDigest !== expectedRequest || canonical.canonicalize(separatelyTrusted) !== canonical.canonicalize(trusted(value))) throw new Error('trust');
  for (const key of ['tenantId', 'transactionId', 'unitId', 'contentPreviewId', 'channelResolutionId', 'senderRecipientResolutionId', 'permissionResolutionId']) {
    if (serverResolved[key] !== value[key]) throw new Error('authority');
  }
  if (canonical.canonicalize(serverResolved.actorBinding) !== canonical.canonicalize(value.actorBinding) ||
      serverResolved.unitChannelId !== 'in_app_passive' || serverResolved.providerMode !== 'provider_disabled' ||
      serverResolved.effectClass !== 'internal_record_only' || serverResolved.permissionResult !== 'clear_internal_passive_no_effect' ||
      serverResolved.permissionChannelId !== 'in_app_passive' || !serverResolved.latestPermission || !serverResolved.recipientCurrent ||
      serverResolved.linkSelectionCount !== 0 || serverResolved.attachmentSelectionCount !== 0 ||
      serverResolved.channelProviderMode !== 'provider_disabled' || serverResolved.channelProviderRequestIdentityState !== 'not_created' ||
      serverResolved.channelFallbackState !== 'none' || serverResolved.channelAttemptState !== 'not_created') throw new Error('currentness');
  const materialDigest = canonical.digest('mission28.link-attachment-resolution-material.v1\n', separatelyTrusted);
  if (indexes) {
    const byId = indexes.byId.get(value.linkAttachmentResolutionId); const byMaterial = indexes.byMaterial.get(materialDigest);
    if (byId && byId.requestDigest !== value.requestDigest) throw new Error('replay conflict');
    if (byMaterial && byMaterial.linkAttachmentResolutionId !== value.linkAttachmentResolutionId) throw new Error('clone');
    if (byId) return { ...copy(byId.output), replayed: true };
  }
  const evidence = {
    tenantId: value.tenantId, linkAttachmentResolutionId: value.linkAttachmentResolutionId, transactionId: value.transactionId,
    unitId: value.unitId, runId: serverResolved.runId, contentPreviewId: value.contentPreviewId,
    contentPreviewDigest: serverResolved.contentPreviewDigest, channelResolutionId: value.channelResolutionId,
    channelResolutionDigest: serverResolved.channelResolutionDigest, senderRecipientResolutionId: value.senderRecipientResolutionId,
    permissionResolutionId: value.permissionResolutionId, requestedProfileId: value.requestedProfileId,
    documentAuthorityState: CURRENT.documentAuthorityState, linkState: CURRENT.linkState, attachmentState: CURRENT.attachmentState,
    tokenState: CURRENT.tokenState, tokenDigestState: CURRENT.tokenDigestState, expiryState: CURRENT.expiryState,
    revocationState: CURRENT.revocationState, rateLimitState: CURRENT.rateLimitState,
    responseCachePolicy: CURRENT.responseCachePolicy, referrerPolicy: CURRENT.referrerPolicy,
    thirdPartyContentState: CURRENT.thirdPartyContentState, resultState: CURRENT.resultState, evaluatedAt: value.evaluatedAt
  };
  const output = { ...evidence, linkAttachmentResolutionDigest: canonical.digest('mission28.link-attachment-resolution-evidence.v1\n', evidence),
    rawTokenGenerated: false, tokenDigestPersisted: false, linkCreated: false, attachmentCreated: false,
    publicResponseCreated: false, messageSent: false, delivered: false, effectCreated: false, replayed: false };
  if (indexes) {
    const row = { linkAttachmentResolutionId: value.linkAttachmentResolutionId, requestDigest: value.requestDigest, output: copy(output) };
    indexes.byId.set(value.linkAttachmentResolutionId, row); indexes.byMaterial.set(materialDigest, row);
  }
  return output;
}

describe('Mission 28 Part 7E scoped-link and customer-safe attachment authority', () => {
  test('binds exact released Part 7D provenance and all frozen inputs', () => {
    expect(contract.authority).toMatchObject({ baselineCommit: '67d3d8c604bfc698b70a6256360015b1bd2c70f5', baselineTree: 'f13862b312e2f71a8d0ca8fb34d0679e6b26f2c1' });
    expect(contract.part7DRelease).toMatchObject({ acceptedSourceHead: '1418f8a0592f6f79a32a1cc856e7691702568f92', pullRequest: 578,
      mergedMain: '67d3d8c604bfc698b70a6256360015b1bd2c70f5', deployment: '1b815228-c288-4c2e-a87f-e6adc82c74f0', deploymentState: 'SUCCESS_RUNNING' });
    for (const input of contract.frozenInputs) expect(digestLf(input.path)).toBe(input.normalizedLfSha256);
  });

  test('freezes one exact current no-access disposition with zero secret, attachment or effect', () => {
    expect(CURRENT).toEqual({ profileId: 'current_launch_no_external_access', documentAuthorityState: 'unavailable_until_part8',
      linkState: 'unavailable_no_accepted_secure_document_delivery', attachmentState: 'unavailable_no_accepted_customer_safe_document',
      tokenState: 'not_generated', tokenDigestState: 'not_persisted', expiryState: 'not_created', revocationState: 'not_created',
      rateLimitState: 'not_mounted', responseCachePolicy: 'private_no_store_required_before_mount',
      referrerPolicy: 'no_referrer_required_before_mount', thirdPartyContentState: 'forbidden', resultState: 'unavailable_no_access_grant' });
    expect(contract.privacyAndEffects).toEqual(expect.objectContaining({ generatedRawTokens: 0, persistedTokenDigests: 0, persistedUrls: 0,
      persistedAttachments: 0, publicResponses: 0, recipientMessages: 0, providerAttempts: 0, externalEffects: 0, moneyEffects: 0 }));
  });

  test('freezes bounded future link and attachment safety without granting current access', () => {
    expect(contract.bounds).toMatchObject({ futureRawTokenEntropyBitsMinimum: 256, futureBase64UrlTokenCharacters: 43,
      futureExpirySecondsMinimum: 300, futureExpirySecondsMaximum: 604800, futureRequestsPerMinuteMaximum: 5,
      futureRequestsPerHourMaximum: 20, futureAttachmentsPerAccessMaximum: 1, futureAttachmentBytesMaximum: 10485760 });
    expect(contract.futureAcceptedLinkContract.exactScopeFields).toEqual(expect.arrayContaining(['tenantId', 'recipientAuthorityId', 'documentVersionId', 'documentDigest', 'expiresAt', 'revokedAt', 'tokenDigest']));
    expect(contract.futureAcceptedLinkContract.responseHeaders).toEqual(expect.arrayContaining(['Cache-Control: private, no-store, max-age=0', 'Referrer-Policy: no-referrer', 'X-Content-Type-Options: nosniff']));
    expect(contract.futureAcceptedAttachmentContract).toMatchObject({ allowedMediaTypes: ['application/pdf'], contentDisposition: 'attachment', embeddedOrThirdPartyContent: 'forbidden' });
    expect(contract.runtimeBoundary).toMatchObject({ mountedRuntimeConsumer: false, publicTokenResolver: false, attachmentStreamingRoute: false, part8DocumentSelectionSendingOrResponseAuthority: false });
  });

  test('projects only the exact no-access evidence and never creates access or delivery', () => {
    expect(resolve(candidate())).toMatchObject({ resultState: 'unavailable_no_access_grant', documentAuthorityState: 'unavailable_until_part8',
      tokenState: 'not_generated', tokenDigestState: 'not_persisted', rawTokenGenerated: false, tokenDigestPersisted: false,
      linkCreated: false, attachmentCreated: false, publicResponseCreated: false, messageSent: false, delivered: false, effectCreated: false });
  });

  test('rejects unknown, missing and candidate-supplied token, document, attachment or response material', () => {
    for (const mutate of [
      value => { value.requestedProfileId = 'issue_secure_link'; }, value => { delete value.channelResolutionId; },
      value => { value.rawToken = 'secret'; }, value => { value.tokenDigest = 'sha256:' + '1'.repeat(64); },
      value => { value.documentVersionId = uuid(99); }, value => { value.attachment = { mediaType: 'text/html' }; },
      value => { value.expiresAt = '2026-10-29T12:00:00.000000Z'; }, value => { value.linkCreated = true; }
    ]) {
      const value = candidate(); mutate(value); value.requestDigest = canonical.digest('mission28.link-attachment-resolution.v1\n', Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'requestDigest')));
      expect(() => resolve(value, trusted(value))).toThrow();
    }
  });

  test('rejects accessors, symbols, toJSON, proxies, aliases and custom prototypes before authority use', () => {
    let getterCalls = 0;
    const accessor = candidate(); Object.defineProperty(accessor, 'requestedProfileId', { enumerable: true, get() { getterCalls += 1; return CURRENT.profileId; } });
    expect(() => resolve(accessor)).toThrow(); expect(getterCalls).toBe(0);
    const symbol = candidate(); symbol[Symbol('secret')] = true; expect(() => resolve(symbol)).toThrow();
    const toJson = candidate(); Object.defineProperty(toJson, 'toJSON', { enumerable: false, value() { throw new Error('hook'); } }); expect(() => resolve(toJson)).toThrow();
    expect(() => resolve(new Proxy(candidate(), {}))).toThrow();
    const custom = candidate(); Object.setPrototypeOf(custom, { token: 'secret' }); expect(() => resolve(custom)).toThrow();
    const alias = candidate(); alias.actorBinding = alias; expect(() => resolve(alias)).toThrow();
  });

  test('rejects trusted substitution and every server authority/currentness retarget', () => {
    const value = candidate(); const wrongTrust = trusted(value); wrongTrust.channelResolutionId = uuid(99);
    expect(() => resolve(value, wrongTrust)).toThrow(/trust/);
    for (const mutate of [
      server => { server.tenantId = uuid(29); }, server => { server.contentPreviewId = uuid(99); },
      server => { server.channelResolutionId = uuid(99); }, server => { server.channelProviderMode = 'live'; },
      server => { server.channelProviderRequestIdentityState = 'created'; }, server => { server.channelFallbackState = 'email'; },
      server => { server.channelAttemptState = 'created'; }, server => { server.permissionResult = 'unavailable'; },
      server => { server.latestPermission = false; }, server => { server.recipientCurrent = false; },
      server => { server.linkSelectionCount = 1; }, server => { server.attachmentSelectionCount = 1; }
    ]) {
      const server = authority(value); mutate(server); expect(() => resolve(value, trusted(value), server)).toThrow();
    }
  });

  test('enforces exact replay and prevents cloned material under another identity', () => {
    const indexes = { byId: new Map(), byMaterial: new Map() }; const value = candidate(10);
    const first = resolve(value, trusted(value), authority(value), indexes); expect(first.replayed).toBe(false);
    expect(resolve(copy(value), trusted(value), authority(value), indexes)).toMatchObject({ linkAttachmentResolutionDigest: first.linkAttachmentResolutionDigest, replayed: true });
    const conflict = copy(value); conflict.channelResolutionId = uuid(910099); conflict.requestDigest = canonical.digest('mission28.link-attachment-resolution.v1\n', Object.fromEntries(Object.entries(conflict).filter(([key]) => key !== 'requestDigest')));
    expect(() => resolve(conflict, trusted(conflict), authority(conflict), indexes)).toThrow(/replay conflict/);
    const clone = copy(value); clone.linkAttachmentResolutionId = uuid(920099); clone.requestDigest = canonical.digest('mission28.link-attachment-resolution.v1\n', Object.fromEntries(Object.entries(clone).filter(([key]) => key !== 'requestDigest')));
    expect(() => resolve(clone, trusted(clone), authority(clone), indexes)).toThrow(/clone/);
  });

  test('migration 285 is additive immutable forced-RLS owner-only and stores no access secret', () => {
    const sql = fs.readFileSync(MIGRATION, 'utf8');
    for (const fragment of ['CREATE TABLE public.canonical_automation_link_attachment_resolutions_v1', 'FORCE ROW LEVEL SECURITY',
      'canonical_automation_link_attachment_resolutions_v1_immutable', 'canonical_automation_record_link_attachment_resolution_v1',
      'REVOKE ALL ON FUNCTION public.canonical_automation_record_link_attachment_resolution_v1(TEXT,JSONB) FROM PUBLIC',
      "'rawTokenGenerated',FALSE", "'tokenDigestPersisted',FALSE", "'linkCreated',FALSE", "'attachmentCreated',FALSE",
      "'publicResponseCreated',FALSE", "'messageSent',FALSE", "'effectCreated',FALSE"])
      expect(sql).toContain(fragment);
    expect(sql).not.toMatch(/\b(raw_token|token_hash|token_digest|document_bytes|attachment_bytes|public_url)\b\s+(?:TEXT|BYTEA|JSONB)/i);
    expect(sql).not.toMatch(/CREATE\s+(?:OR\s+REPLACE\s+)?(?:ROUTE|VIEW)|INSERT\s+INTO\s+public\.(?:messages|provider)/i);
  });

  test('roadmap and ledger record Part 7D released, Part 7E candidate-only and later slices planned', () => {
    const roadmap = fs.readFileSync(ROADMAP, 'utf8'); const ledger = fs.readFileSync(LEDGER, 'utf8'); const markdown = fs.readFileSync(CONTRACT_MD, 'utf8');
    expect(roadmap).toContain('Parts 1A–7D are released. Part 7E is the sole implementation candidate.');
    expect(ledger).toContain('| 30 | 7D | Provider-neutral email/SMS and truthful native handoff | **Released** |');
    expect(ledger).toContain('| 31 | 7E | Scoped links and customer-safe attachments | **Implementation candidate** |');
    expect(ledger).toContain('| 32 | 7F | Delivery corrections, replies, opt-outs and minimized provider evidence | Planned / unimplemented |');
    expect(ledger).toContain('281 migrations through additive `285_canonical_automation_scoped_link_attachment_v1.sql` with no 286');
    expect(markdown).toContain('does not issue a link in the current launch');
  });
});
