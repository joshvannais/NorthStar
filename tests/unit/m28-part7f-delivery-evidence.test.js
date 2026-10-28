'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { types } = require('node:util');
const canonical = require('../../src/automation/canonicalJson');

const ROOT = path.resolve(__dirname, '../..');
const CONTRACT_PATH = path.join(ROOT, 'docs/architecture/MISSION_28_PART7F_DELIVERY_EVIDENCE_CONTRACT.json');
const CONTRACT_MD = path.join(ROOT, 'docs/architecture/MISSION_28_PART7F_DELIVERY_EVIDENCE_CONTRACT.md');
const MIGRATION = path.join(ROOT, 'migrations/286_canonical_automation_delivery_evidence_v1.sql');
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
    'linkAttachmentResolutionId', 'senderRecipientResolutionId', 'permissionResolutionId', 'requestedProfileId',
    'actorBinding', 'evaluatedAt'].map(key => [key, copy(value[key])]));
}
function candidate(suffix = 1) {
  const value = {
    schemaVersion: 'mission28.delivery-evidence-resolution.v1', tenantId: uuid(28),
    deliveryEvidenceResolutionId: uuid(930000 + suffix), transactionId: uuid(600001), unitId: uuid(600002),
    contentPreviewId: uuid(900001), channelResolutionId: uuid(910001), linkAttachmentResolutionId: uuid(920001),
    senderRecipientResolutionId: uuid(700001), permissionResolutionId: uuid(800001), requestedProfileId: CURRENT.profileId,
    actorBinding: { actorId: uuid(10), sessionId: uuid(11), membershipId: uuid(10), membershipRole: 'owner' },
    evaluatedAt: '2026-10-28T12:00:00.000000Z', requestDigest: ''
  };
  value.requestDigest = canonical.digest('mission28.delivery-evidence-resolution.v1\n', Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'requestDigest')));
  return value;
}
function authority(value) {
  return {
    tenantId: value.tenantId, transactionId: value.transactionId, unitId: value.unitId, runId: uuid(600003),
    contentPreviewId: value.contentPreviewId, contentPreviewDigest: 'sha256:' + '1'.repeat(64),
    channelResolutionId: value.channelResolutionId, channelResolutionDigest: 'sha256:' + '2'.repeat(64),
    linkAttachmentResolutionId: value.linkAttachmentResolutionId, linkAttachmentResolutionDigest: 'sha256:' + '3'.repeat(64),
    senderRecipientResolutionId: value.senderRecipientResolutionId, permissionResolutionId: value.permissionResolutionId,
    unitChannelId: 'in_app_passive', providerMode: 'provider_disabled', effectClass: 'internal_record_only',
    permissionResult: 'clear_internal_passive_no_effect', permissionChannelId: 'in_app_passive', latestPermission: true,
    recipientCurrent: true, linkSelectionCount: 0, attachmentSelectionCount: 0,
    channelProviderMode: 'provider_disabled', channelProviderRequestIdentityState: 'not_created', channelFallbackState: 'none',
    channelAttemptState: 'not_created', documentAuthorityState: 'unavailable_until_part8',
    linkState: 'unavailable_no_accepted_secure_document_delivery', attachmentState: 'unavailable_no_accepted_customer_safe_document',
    tokenState: 'not_generated', tokenDigestState: 'not_persisted', linkResultState: 'unavailable_no_access_grant',
    actorBinding: copy(value.actorBinding)
  };
}
function resolve(value, separatelyTrusted, serverResolved, indexes = null) {
  assertPlainData(value);
  if (separatelyTrusted === undefined) separatelyTrusted = trusted(value);
  if (serverResolved === undefined) serverResolved = authority(value);
  assertPlainData(separatelyTrusted); assertPlainData(serverResolved);
  exactKeys(value, INPUT_KEYS); exactKeys(value.actorBinding, ACTOR_KEYS);
  if (value.schemaVersion !== 'mission28.delivery-evidence-resolution.v1' ||
      ![value.tenantId, value.deliveryEvidenceResolutionId, value.transactionId, value.unitId, value.contentPreviewId,
        value.channelResolutionId, value.linkAttachmentResolutionId, value.senderRecipientResolutionId,
        value.permissionResolutionId, value.actorBinding.actorId, value.actorBinding.sessionId,
        value.actorBinding.membershipId].every(item => UUID.test(item)) || value.requestedProfileId !== CURRENT.profileId ||
      value.actorBinding.membershipRole !== 'owner' || !UTC.test(value.evaluatedAt)) throw new Error('shape');
  const expectedRequest = canonical.digest('mission28.delivery-evidence-resolution.v1\n', Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'requestDigest')));
  if (value.requestDigest !== expectedRequest || canonical.canonicalize(separatelyTrusted) !== canonical.canonicalize(trusted(value))) throw new Error('trust');
  for (const key of ['tenantId', 'transactionId', 'unitId', 'contentPreviewId', 'channelResolutionId',
    'linkAttachmentResolutionId', 'senderRecipientResolutionId', 'permissionResolutionId']) {
    if (serverResolved[key] !== value[key]) throw new Error('authority');
  }
  if (canonical.canonicalize(serverResolved.actorBinding) !== canonical.canonicalize(value.actorBinding) ||
      serverResolved.unitChannelId !== 'in_app_passive' || serverResolved.providerMode !== 'provider_disabled' ||
      serverResolved.effectClass !== 'internal_record_only' || serverResolved.permissionResult !== 'clear_internal_passive_no_effect' ||
      serverResolved.permissionChannelId !== 'in_app_passive' || !serverResolved.latestPermission || !serverResolved.recipientCurrent ||
      serverResolved.linkSelectionCount !== 0 || serverResolved.attachmentSelectionCount !== 0 ||
      serverResolved.channelProviderMode !== 'provider_disabled' || serverResolved.channelProviderRequestIdentityState !== 'not_created' ||
      serverResolved.channelFallbackState !== 'none' || serverResolved.channelAttemptState !== 'not_created' ||
      serverResolved.documentAuthorityState !== 'unavailable_until_part8' ||
      serverResolved.linkState !== 'unavailable_no_accepted_secure_document_delivery' ||
      serverResolved.attachmentState !== 'unavailable_no_accepted_customer_safe_document' ||
      serverResolved.tokenState !== 'not_generated' || serverResolved.tokenDigestState !== 'not_persisted' ||
      serverResolved.linkResultState !== 'unavailable_no_access_grant') throw new Error('currentness');
  const materialDigest = canonical.digest('mission28.delivery-evidence-resolution-material.v1\n', separatelyTrusted);
  if (indexes) {
    const byId = indexes.byId.get(value.deliveryEvidenceResolutionId); const byMaterial = indexes.byMaterial.get(materialDigest);
    if (byId && byId.requestDigest !== value.requestDigest) throw new Error('replay conflict');
    if (byMaterial && byMaterial.deliveryEvidenceResolutionId !== value.deliveryEvidenceResolutionId) throw new Error('clone');
    if (byId) return { ...copy(byId.output), replayed: true };
  }
  const evidence = {
    tenantId: value.tenantId, deliveryEvidenceResolutionId: value.deliveryEvidenceResolutionId,
    transactionId: value.transactionId, unitId: value.unitId, runId: serverResolved.runId,
    contentPreviewId: value.contentPreviewId, contentPreviewDigest: serverResolved.contentPreviewDigest,
    channelResolutionId: value.channelResolutionId, channelResolutionDigest: serverResolved.channelResolutionDigest,
    linkAttachmentResolutionId: value.linkAttachmentResolutionId,
    linkAttachmentResolutionDigest: serverResolved.linkAttachmentResolutionDigest,
    senderRecipientResolutionId: value.senderRecipientResolutionId, permissionResolutionId: value.permissionResolutionId,
    requestedProfileId: value.requestedProfileId, providerAttemptState: CURRENT.providerAttemptState,
    providerAcknowledgementState: CURRENT.providerAcknowledgementState, callbackState: CURRENT.callbackState,
    deliveryState: CURRENT.deliveryState, openState: CURRENT.openState, replyState: CURRENT.replyState,
    questionState: CURRENT.questionState, optOutState: CURRENT.optOutState, complaintState: CURRENT.complaintState,
    undeliverableState: CURRENT.undeliverableState, correctionState: CURRENT.correctionState,
    strongestClaim: CURRENT.strongestClaim, reconciliationState: CURRENT.reconciliationState,
    suppressionPropagationState: CURRENT.suppressionPropagationState, resultState: CURRENT.resultState,
    evaluatedAt: value.evaluatedAt
  };
  const output = { ...evidence, deliveryEvidenceResolutionDigest: canonical.digest('mission28.delivery-evidence-resolution-evidence.v1\n', evidence),
    providerEventIngested: false, callbackAccepted: false, receiptPersisted: false, openPersisted: false,
    replyPersisted: false, questionPersisted: false, optOutPersisted: false, complaintPersisted: false,
    correctionPersisted: false, suppressionCreated: false, messageSent: false, delivered: false,
    effectCreated: false, replayed: false };
  if (indexes) {
    const row = { deliveryEvidenceResolutionId: value.deliveryEvidenceResolutionId, requestDigest: value.requestDigest, output: copy(output) };
    indexes.byId.set(value.deliveryEvidenceResolutionId, row); indexes.byMaterial.set(materialDigest, row);
  }
  return output;
}

describe('Mission 28 Part 7F delivery corrections, replies, opt-outs and minimized provider evidence', () => {
  test('binds exact released Part 7E provenance and every frozen input', () => {
    expect(contract.authority).toMatchObject({ baselineCommit: '38735710b4e0e07e9d6f0e5c0555fe75958fda2c', baselineTree: '809fe5ab7b5c2f225a5c1d28f859ca557f4a05d5' });
    expect(contract.part7ERelease).toMatchObject({ acceptedSourceHead: 'ab5b6088878ad68c5b3199d91be9ecb3c79d15e3', pullRequest: 579,
      mergedMain: '38735710b4e0e07e9d6f0e5c0555fe75958fda2c', deployment: '1959cbe5-5ef4-4b76-b3d0-52d2ac340273', deploymentState: 'SUCCESS_RUNNING' });
    for (const input of contract.frozenInputs) expect(digestLf(input.path)).toBe(input.normalizedLfSha256);
  });

  test('freezes one truthful no-evidence result and zero provider, recipient or effect evidence', () => {
    expect(CURRENT).toEqual({ profileId: 'current_launch_no_provider_or_recipient_evidence', providerAttemptState: 'not_created',
      providerAcknowledgementState: 'unavailable_no_attempt', callbackState: 'not_received_no_callback_authority',
      deliveryState: 'unavailable_no_message_or_evidence', openState: 'unavailable_not_supported',
      replyState: 'unavailable_no_authenticated_inbound', questionState: 'unavailable_no_authenticated_inbound',
      optOutState: 'unavailable_no_authenticated_inbound', complaintState: 'unavailable_no_authenticated_provider_evidence',
      undeliverableState: 'unavailable_no_provider_evidence', correctionState: 'not_created', strongestClaim: 'none',
      reconciliationState: 'no_provider_evidence_to_reconcile', suppressionPropagationState: 'no_new_suppression_evidence',
      resultState: 'unavailable_no_effect_evidence' });
    expect(Object.values(contract.privacyAndEffects).every(value => value === 0)).toBe(true);
  });

  test('freezes closed future evidence kinds and strict authentication, minimization, correction and suppression rules', () => {
    const kinds = contract.futureAcceptedEvidenceKinds.map(entry => entry.eventKind);
    expect(kinds).toEqual(['provider_accepted','sent','delivered','opened','bounced','blocked','complaint','reply_received',
      'customer_question_received','opt_out_received','undeliverable','provider_status_correction']);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(contract.futureAcceptedEvidenceContract).toMatchObject({
      metadataMinimization: expect.stringContaining('no_raw_payload'),
      deliveryTruth: expect.stringContaining('separate_evidence_states'),
      unknownOrConflicting: 'reconciliation_required_no_resend_and_no_stronger_claim_until_separately_resolved'
    });
    expect(contract.runtimeBoundary).toMatchObject({ mountedRuntimeConsumer: false, providerAdapterOrCallback: false,
      replyQuestionOrOptOutReceiver: false, part8DocumentSendingOrResponseAuthority: false });
  });

  test('projects only no-evidence truth with no provider, recipient, delivery, suppression or effect state', () => {
    expect(resolve(candidate())).toMatchObject({ resultState: 'unavailable_no_effect_evidence', strongestClaim: 'none',
      providerEventIngested: false, callbackAccepted: false, receiptPersisted: false, openPersisted: false,
      replyPersisted: false, questionPersisted: false, optOutPersisted: false, complaintPersisted: false,
      correctionPersisted: false, suppressionCreated: false, messageSent: false, delivered: false, effectCreated: false });
  });

  test('rejects missing, unknown and candidate-supplied provider, callback, response, correction or output material', () => {
    for (const mutate of [
      value => { delete value.linkAttachmentResolutionId; }, value => { value.unexpected = 'customer@example.test'; },
      value => { value.providerEvent = { status: 'delivered' }; }, value => { value.callback = { signature: 'secret' }; },
      value => { value.deliveryState = 'delivered'; }, value => { value.openedAt = value.evaluatedAt; },
      value => { value.reply = 'customer text'; }, value => { value.optOut = true; },
      value => { value.correctionOfEventId = uuid(99); }, value => { value.suppressionCreated = true; }
    ]) {
      const value = candidate(); mutate(value);
      value.requestDigest = canonical.digest('mission28.delivery-evidence-resolution.v1\n', Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'requestDigest')));
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
    const custom = candidate(); Object.setPrototypeOf(custom, { providerStatus: 'delivered' }); expect(() => resolve(custom)).toThrow();
    const alias = candidate(); alias.actorBinding = alias; expect(() => resolve(alias)).toThrow();
  });

  test('rejects separately trusted substitution and every exact server binding/currentness retarget', () => {
    const value = candidate(); const wrongTrust = trusted(value); wrongTrust.linkAttachmentResolutionId = uuid(99);
    expect(() => resolve(value, wrongTrust)).toThrow(/trust/);
    for (const mutate of [
      server => { server.tenantId = uuid(29); }, server => { server.unitId = uuid(99); },
      server => { server.linkAttachmentResolutionId = uuid(99); }, server => { server.providerMode = 'live'; },
      server => { server.channelProviderRequestIdentityState = 'created'; }, server => { server.channelAttemptState = 'created'; },
      server => { server.permissionResult = 'unavailable'; }, server => { server.latestPermission = false; },
      server => { server.recipientCurrent = false; }, server => { server.linkState = 'created'; },
      server => { server.tokenState = 'generated'; }, server => { server.linkResultState = 'available'; }
    ]) {
      const server = authority(value); mutate(server); expect(() => resolve(value, trusted(value), server)).toThrow();
    }
  });

  test('enforces exact replay and rejects changed or cloned no-evidence material', () => {
    const indexes = { byId: new Map(), byMaterial: new Map() }; const value = candidate(10);
    const first = resolve(value, trusted(value), authority(value), indexes); expect(first.replayed).toBe(false);
    expect(resolve(copy(value), trusted(value), authority(value), indexes)).toMatchObject({ deliveryEvidenceResolutionDigest: first.deliveryEvidenceResolutionDigest, replayed: true });
    const conflict = copy(value); conflict.linkAttachmentResolutionId = uuid(920099); conflict.requestDigest = canonical.digest('mission28.delivery-evidence-resolution.v1\n', Object.fromEntries(Object.entries(conflict).filter(([key]) => key !== 'requestDigest')));
    expect(() => resolve(conflict, trusted(conflict), authority(conflict), indexes)).toThrow(/replay conflict/);
    const clone = copy(value); clone.deliveryEvidenceResolutionId = uuid(930099); clone.requestDigest = canonical.digest('mission28.delivery-evidence-resolution.v1\n', Object.fromEntries(Object.entries(clone).filter(([key]) => key !== 'requestDigest')));
    expect(() => resolve(clone, trusted(clone), authority(clone), indexes)).toThrow(/clone/);
  });

  test('migration 286 is additive immutable forced-RLS owner-only and has no provider or recipient evidence payload', () => {
    const sql = fs.readFileSync(MIGRATION, 'utf8');
    for (const fragment of ['CREATE TABLE public.canonical_automation_delivery_evidence_resolutions_v1', 'FORCE ROW LEVEL SECURITY',
      'canonical_automation_delivery_evidence_resolutions_v1_immutable', 'canonical_automation_record_delivery_evidence_resolution_v1',
      'REVOKE ALL ON FUNCTION public.canonical_automation_record_delivery_evidence_resolution_v1(TEXT,JSONB) FROM PUBLIC',
      "'providerEventIngested',FALSE", "'callbackAccepted',FALSE", "'receiptPersisted',FALSE", "'replyPersisted',FALSE",
      "'optOutPersisted',FALSE", "'correctionPersisted',FALSE", "'suppressionCreated',FALSE", "'effectCreated',FALSE"])
      expect(sql).toContain(fragment);
    expect(sql).not.toMatch(/\b(raw_payload|provider_metadata|provider_status_text|callback_body|message_body|reply_body|recipient_address|contact_value|secret|token)\b\s+(?:TEXT|BYTEA|JSONB)/i);
    expect(sql).not.toMatch(/CREATE\s+(?:OR\s+REPLACE\s+)?(?:ROUTE|VIEW)|INSERT\s+INTO\s+public\.(?:messages|provider)/i);
  });

  test('roadmap and ledger preserve Part 7F release truth while Part 8A alone is candidate', () => {
    const roadmap = fs.readFileSync(ROADMAP, 'utf8'); const ledger = fs.readFileSync(LEDGER, 'utf8'); const markdown = fs.readFileSync(CONTRACT_MD, 'utf8');
    expect(roadmap).toContain('Parts 1A–8A are released. Part 8B is the sole implementation candidate.');
    expect(ledger).toContain('| 31 | 7E | Scoped links and customer-safe attachments | **Released** |');
    expect(ledger).toContain('| 32 | 7F | Delivery corrections, replies, opt-outs and minimized provider evidence | **Released** |');
    expect(ledger).toContain('| 33 | 8A | Mission 24 estimate/proposal/quote sending | **Released** |');
    expect(ledger).toContain('| 34 | 8B | Mission 27 financial-document delivery without financial mutation | **Implementation candidate** |');
    expect(ledger).toContain('Released main and production contain 283 migrations through exact `287_canonical_automation_estimate_quote_resolution_v1.sql` with no 288');
    expect(markdown).toContain('The current launch has no such evidence.');
  });
});
