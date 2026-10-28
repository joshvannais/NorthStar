'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { types } = require('node:util');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const parse = relative => JSON.parse(read(relative));
const clone = value => JSON.parse(JSON.stringify(value));

const CONTRACT_PATH = 'docs/architecture/MISSION_28_PART3B_APPROVAL_AUTHORIZATION_CONTRACT.json';
const NARRATIVE_PATH = 'docs/architecture/MISSION_28_PART3B_APPROVAL_AUTHORIZATION_CONTRACT.md';
const ROADMAP_PATH = 'docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md';
const LEDGER_PATH = 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md';
const BASE = '1e62336afe2c9e65cccbe1629a62b86855da3ff8';
const BASE_TREE = 'a88024e8140900492d7ac02bcf4e07f020d8b3de';

const INPUT_HASHES = Object.freeze({
  'docs/architecture/MISSION_28_PART1A_AUTHORITY_CONTRACT.md': '92DAD00F8A7623A87C780FC1AC965B66569616650F53FDED8454F51872458179',
  'docs/architecture/MISSION_28_PART1B_SURFACE_INVENTORY.json': '62E37CF07A26F0C2B1A50A2C2F0EB927695500DB32B44B16E5B431F594B93142',
  'docs/architecture/MISSION_28_PART1C_ACTION_RISK_CATALOG.json': '1CB5FF594AE7D1BEED313C1A94D7FE8200FB0024B36DF11B4C668F211481312B',
  'docs/architecture/MISSION_28_PART1D_FIRST_LAUNCH_MATRIX.json': '8CC5C4D62719EA6E6BCF9A340C5BE0593BE2F10CD60360D10562C4979D859B52',
  'docs/architecture/MISSION_28_PART2A_CANONICAL_AUTOMATION_POLICY.json': 'B8BC22AE758E2AD0C2D037963709A947FE0564AF4319DED571F7ABD273D6A4E8',
  'docs/architecture/MISSION_28_PART2B_IMMUTABLE_RECORD_MODEL.json': '3C64287BA287567ADD0E0962A3ED45B90657CA97686435E1D616FFF2F88293B5',
  'docs/architecture/MISSION_28_PART2C_POLICY_LIFECYCLE.json': '91008C2B04D2492F8067F0F31DAB8E4902FA06FEA6A781CB46B4C836453FFACD',
  'docs/architecture/MISSION_28_PART2D_POSTGRES_AUTHORITY.json': '03F32F3C66EF525DF9ACA541F8A7D0C08935E1DD2EDB661468F78CC2A763308A',
  'docs/architecture/MISSION_28_PART3A_FIXED_CAPABILITY_MATRIX.json': 'BFF226B90123575945B8B268E88B844AF21A5FDE03621BAC0182D270C2928A33',
  'docs/architecture/MISSION_28_PART3A_FIXED_CAPABILITY_MATRIX.md': 'F849B39A38377F5B331BE302FD2C4A6065C727F7763127FD17819C20A509C8C1',
});

const UUID = Object.freeze({
  tenant: '00000000-0000-4000-8000-000000000028',
  authorization: '00000000-0000-4000-8000-000000000301',
  policy: '00000000-0000-4000-8000-000000000201',
  preview: '00000000-0000-4000-8000-000000000501',
  recipientSet: '00000000-0000-4000-8000-000000000601',
  effectSet: '00000000-0000-4000-8000-000000000701',
  capabilityDecision: '00000000-0000-4000-8000-000000000801',
  recentAuth: '00000000-0000-4000-8000-000000000901',
  clock: '00000000-0000-4000-8000-000000000902',
  run: '00000000-0000-4000-8000-000000000401',
  proposedAction: '00000000-0000-4000-8000-000000000402',
});

const digestValue = char => `sha256:${char.repeat(64)}`;

function normalizedLfSha256(relative) {
  const normalized = read(relative).replace(/\r\n/g, '\n');
  if (normalized.includes('\r')) throw new Error(`lone CR denied: ${relative}`);
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex').toUpperCase();
}

function safeClonePlain(value, seen = new Set()) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('unsafe number');
    return value;
  }
  if (typeof value !== 'object' || types.isProxy(value) || seen.has(value)) throw new Error('non-plain value');
  seen.add(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) throw new Error('custom array prototype');
    const keys = Reflect.ownKeys(value);
    const expected = value.map((_, index) => String(index)).concat('length');
    if (JSON.stringify(keys) !== JSON.stringify(expected)) throw new Error('sparse or decorated array');
    const result = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value') ||
          !descriptor.enumerable || !descriptor.configurable || !descriptor.writable) throw new Error('array descriptor');
      result.push(safeClonePlain(descriptor.value, seen));
    }
    seen.delete(value);
    return result;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) throw new Error('custom object prototype');
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string')) throw new Error('symbol key');
  const result = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value') ||
        !descriptor.enumerable || !descriptor.configurable || !descriptor.writable) throw new Error('object descriptor');
    result[key] = safeClonePlain(descriptor.value, seen);
  }
  seen.delete(value);
  return result;
}

function exactKeys(value, expected) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function canonicalJson(value) {
  if (value === null || ['string', 'boolean', 'number'].includes(typeof value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function digest(namespace, value) {
  return `sha256:${crypto.createHash('sha256').update(namespace + canonicalJson(value), 'utf8').digest('hex')}`;
}

function materialOf(record, contract) {
  return Object.fromEntries(contract.materialBinding.roots.map(key => [key, clone(record[key])]));
}

function seal(record, contract, recomputeReason = true) {
  const result = clone(record);
  if (recomputeReason) {
    result.reasonBinding.reasonDigest = digest(contract.canonicalization.reasonNamespace, {
      reasonCode: result.reasonBinding.reasonCode,
      reasonText: result.reasonBinding.reasonText,
    });
  }
  result.materialBindingDigest = digest(contract.canonicalization.materialNamespace, materialOf(result, contract));
  const withoutRecordDigest = Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'recordDigest'));
  result.recordDigest = digest(contract.canonicalization.recordNamespace, withoutRecordDigest);
  return result;
}

function buildRecord(kind, standingIntent = 'activate_exact_policy_version') {
  const contract = parse(CONTRACT_PATH);
  const isPerRun = kind === 'per_run_approval';
  const capabilityId = isPerRun
    ? 'automation_run_approve'
    : standingIntent === 'activate_exact_policy_version'
      ? 'automation_standing_authority_activate'
      : 'automation_standing_authority_change';
  const operation = isPerRun
    ? 'approve_run'
    : standingIntent === 'activate_exact_policy_version'
      ? 'activate_standing_authority'
      : 'change_standing_authority';
  const recordScope = isPerRun
    ? 'one_exact_tenant_run_preview'
    : standingIntent === 'activate_exact_policy_version'
      ? 'one_exact_tenant_policy_version'
      : 'one_exact_tenant_policy_version_transition';
  const policyDigest = digestValue('2');
  return seal({
    contractVersion: contract.recordGrammar.contractVersion,
    authorizationId: UUID.authorization,
    authorizationKind: kind,
    tenantId: UUID.tenant,
    actorBinding: {
      actorId: 'actor-owner-1', actorTenantId: UUID.tenant,
      sessionId: 'session-owner-1', sessionSubjectActorId: 'actor-owner-1', sessionTenantId: UUID.tenant,
      membershipId: 'membership-owner-1', membershipSubjectActorId: 'actor-owner-1',
      membershipTenantId: UUID.tenant, membershipRoleId: 'owner', membershipStatus: 'active',
      capabilityId, operation, recordScope,
      capabilityDecisionId: UUID.capabilityDecision,
      capabilityDecisionDigest: digestValue('8'),
      capabilityDecisionState: 'eligible_contract_only_no_runtime_authority',
      recentAuthenticationState: 'valid_recent', recentAuthenticationEvidenceId: UUID.recentAuth,
      recentAuthenticationEvidenceDigest: digestValue('9'),
      recentAuthenticationExpiresAt: '2026-10-27T11:30:00.000Z',
    },
    policyBinding: { tenantId: UUID.tenant, policyId: UUID.policy, policyVersion: 3, policyDigest },
    sourceBinding: { tenantId: UUID.tenant, sourceSetDigest: digestValue('3'), currentnessMarker: 'captured_exact_current' },
    previewBinding: {
      tenantId: UUID.tenant, previewId: UUID.preview, previewDigest: digestValue('4'), previewState: 'exact_current',
      subjectRecordType: isPerRun ? 'proposed_action' : 'policy_version',
      subjectRecordId: isPerRun ? UUID.proposedAction : UUID.policy,
      subjectRecordDigest: isPerRun ? digestValue('d') : policyDigest,
      policyDigest, sourceSetDigest: digestValue('3'), recipientSetDigest: digestValue('5'),
      effectSetDigest: digestValue('6'),
    },
    recipientBinding: {
      tenantId: UUID.tenant, recipientSetId: UUID.recipientSet,
      recipientSetDigest: digestValue('5'), recipientClassIds: ['tenant_owner'],
    },
    effectBinding: {
      tenantId: UUID.tenant, effectSetId: UUID.effectSet, effectSetDigest: digestValue('6'),
      actionFamilyId: 'internal_read_digest_task', channelIds: ['in_app_passive'],
      providerModeIds: ['provider_disabled'], effectClass: 'internal_only_no_external_effect',
    },
    reasonBinding: { reasonCode: 'owner_reviewed', reasonText: 'Owner reviewed the exact bounded preview.', reasonDigest: digestValue('0') },
    temporalBinding: {
      issuedAt: '2026-10-27T10:00:00.000Z', expiresAt: '2026-10-27T12:00:00.000Z',
      trustedClockEvidenceId: UUID.clock, trustedClockEvidenceDigest: digestValue('a'),
    },
    idempotencyBinding: {
      namespace: isPerRun ? 'mission28.authorization.per-run.v1' : 'mission28.authorization.standing.v1',
      keyDigest: isPerRun ? digestValue('b') : digestValue('c'),
    },
    kindBinding: isPerRun
      ? {
        subjectRecordType: 'proposed_action', subjectRecordId: UUID.proposedAction,
        subjectRecordDigest: digestValue('d'), runId: UUID.run, standingIntent: null,
      }
      : {
        subjectRecordType: 'policy_version', subjectRecordId: UUID.policy,
        subjectRecordDigest: policyDigest, runId: null, standingIntent,
      },
    materialBindingDigest: digestValue('0'),
    recordDigest: digestValue('0'),
  }, contract);
}

function trustedFor(record, contract, decisionAt = '2026-10-27T10:30:00.000Z') {
  return {
    authorizationId: record.authorizationId,
    materialBinding: materialOf(record, contract),
    materialBindingDigest: record.materialBindingDigest,
    proposedActionSubjectEvidence: record.authorizationKind === 'per_run_approval'
      ? {
        tenantId: record.tenantId,
        subjectRecordType: 'proposed_action',
        subjectRecordId: record.kindBinding.subjectRecordId,
        subjectRecordDigest: record.kindBinding.subjectRecordDigest,
        runId: record.kindBinding.runId,
        policyId: record.policyBinding.policyId,
        policyVersion: record.policyBinding.policyVersion,
        policyDigest: record.policyBinding.policyDigest,
        sourceSetDigest: record.sourceBinding.sourceSetDigest,
        currentnessMarker: record.sourceBinding.currentnessMarker,
      }
      : null,
    decisionAt,
  };
}

function validateAuthorization(input, trustedInput) {
  const contract = parse(CONTRACT_PATH);
  let record;
  let trusted;
  try {
    record = safeClonePlain(input);
    trusted = safeClonePlain(trustedInput);
  } catch {
    return 'deny_unsupported_or_self_created_authority';
  }
  if (!exactKeys(record, contract.recordGrammar.exactKeys) ||
      !exactKeys(trusted, ['authorizationId', 'materialBinding', 'materialBindingDigest',
        'proposedActionSubjectEvidence', 'decisionAt'])) {
    return 'deny_unsupported_or_self_created_authority';
  }
  const grammar = contract.recordGrammar;
  const exactNested = [
    ['actorBinding', grammar.actorBindingExactKeys], ['policyBinding', grammar.policyBindingExactKeys],
    ['sourceBinding', grammar.sourceBindingExactKeys], ['previewBinding', grammar.previewBindingExactKeys],
    ['recipientBinding', grammar.recipientBindingExactKeys], ['effectBinding', grammar.effectBindingExactKeys],
    ['reasonBinding', grammar.reasonBindingExactKeys], ['temporalBinding', grammar.temporalBindingExactKeys],
    ['idempotencyBinding', grammar.idempotencyBindingExactKeys], ['kindBinding', grammar.kindBindingExactKeys],
  ];
  if (record.contractVersion !== grammar.contractVersion || exactNested.some(([key, keys]) => !exactKeys(record[key], keys))) {
    return 'deny_unsupported_or_self_created_authority';
  }

  const opaque = new RegExp(contract.identityGrammar.opaqueIdentifierPattern);
  const uuid = new RegExp(contract.identityGrammar.uuidPattern);
  const sha = new RegExp(contract.identityGrammar.digestPattern);
  const instant = new RegExp(contract.identityGrammar.utcInstantPattern);
  const actor = record.actorBinding;
  const identityValues = [record.tenantId, actor.actorId, actor.actorTenantId, actor.sessionId,
    actor.sessionSubjectActorId, actor.sessionTenantId, actor.membershipId,
    actor.membershipSubjectActorId, actor.membershipTenantId];
  if (identityValues.some(value => typeof value !== 'string' || !opaque.test(value)) ||
      !uuid.test(record.authorizationId) || !uuid.test(record.tenantId) ||
      actor.actorId !== actor.sessionSubjectActorId || actor.actorId !== actor.membershipSubjectActorId ||
      [actor.actorTenantId, actor.sessionTenantId, actor.membershipTenantId].some(value => value !== record.tenantId) ||
      actor.membershipRoleId !== 'owner' || actor.membershipStatus !== 'active' ||
      actor.capabilityDecisionState !== contract.identityGrammar.capabilityDecisionState ||
      actor.recentAuthenticationState !== contract.identityGrammar.recentAuthenticationState ||
      !uuid.test(actor.capabilityDecisionId) || !sha.test(actor.capabilityDecisionDigest) ||
      !uuid.test(actor.recentAuthenticationEvidenceId) || !sha.test(actor.recentAuthenticationEvidenceDigest)) {
    return 'deny_identity_or_capability_mismatch';
  }

  for (const binding of [record.policyBinding, record.sourceBinding, record.previewBinding,
    record.recipientBinding, record.effectBinding]) {
    if (binding.tenantId !== record.tenantId) return 'deny_identity_or_capability_mismatch';
  }
  if (!uuid.test(record.policyBinding.policyId) || !Number.isSafeInteger(record.policyBinding.policyVersion) ||
      record.policyBinding.policyVersion < 1 || !sha.test(record.policyBinding.policyDigest) ||
      !sha.test(record.sourceBinding.sourceSetDigest) ||
      record.sourceBinding.currentnessMarker !== grammar.sourceCurrentnessMarker ||
      !uuid.test(record.previewBinding.previewId) || !sha.test(record.previewBinding.previewDigest) ||
      record.previewBinding.previewState !== grammar.previewState ||
      !uuid.test(record.recipientBinding.recipientSetId) || !sha.test(record.recipientBinding.recipientSetDigest) ||
      !uuid.test(record.effectBinding.effectSetId) || !sha.test(record.effectBinding.effectSetDigest) ||
      !grammar.allowedActionFamilyIds.includes(record.effectBinding.actionFamilyId)) {
    return 'deny_material_binding_mismatch_or_change';
  }
  const launchRule = grammar.firstLaunchBindingRules[record.effectBinding.actionFamilyId];
  const recipients = record.recipientBinding.recipientClassIds;
  const orderedRecipients = Array.isArray(recipients) && recipients.length > 0 &&
    new Set(recipients).size === recipients.length &&
    recipients.every((value, index) => launchRule.recipientClassIds.indexOf(value) >
      (index === 0 ? -1 : launchRule.recipientClassIds.indexOf(recipients[index - 1])));
  if (!orderedRecipients || canonicalJson(record.effectBinding.channelIds) !== canonicalJson(launchRule.channelIds) ||
      canonicalJson(record.effectBinding.providerModeIds) !== canonicalJson(launchRule.providerModeIds) ||
      record.effectBinding.effectClass !== launchRule.effectClass) {
    return 'deny_material_binding_mismatch_or_change';
  }

  const reason = record.reasonBinding;
  const reasonPattern = new RegExp(contract.identityGrammar.reasonCodePattern);
  if (!reasonPattern.test(reason.reasonCode) || typeof reason.reasonText !== 'string' ||
      reason.reasonText.length < contract.identityGrammar.reasonTextMinLength ||
      reason.reasonText.length > contract.identityGrammar.reasonTextMaxLength ||
      reason.reasonText !== reason.reasonText.trim() || /[\u0000-\u001f\u007f]/.test(reason.reasonText) ||
      reason.reasonDigest !== digest(contract.canonicalization.reasonNamespace, {
        reasonCode: reason.reasonCode, reasonText: reason.reasonText,
      })) return 'deny_material_binding_mismatch_or_change';

  const time = record.temporalBinding;
  if (![time.issuedAt, time.expiresAt, time.trustedClockEvidenceId, actor.recentAuthenticationExpiresAt, trusted.decisionAt]
      .every(value => typeof value === 'string') ||
      !instant.test(time.issuedAt) || !instant.test(time.expiresAt) || !instant.test(actor.recentAuthenticationExpiresAt) ||
      !instant.test(trusted.decisionAt) || !uuid.test(time.trustedClockEvidenceId) ||
      !sha.test(time.trustedClockEvidenceDigest) ||
      !(time.issuedAt < trusted.decisionAt && trusted.decisionAt < time.expiresAt) ||
      actor.recentAuthenticationExpiresAt <= trusted.decisionAt) return 'deny_expired_or_invalid_time_binding';

  const kind = contract.authorizationKinds.find(item => item.id === record.authorizationKind);
  if (!kind) return 'deny_kind_or_scope_mismatch';
  const pair = kind.capabilityOperationPairs.find(item => item.capabilityId === actor.capabilityId &&
    item.operation === actor.operation && item.recordScope === actor.recordScope &&
    (!Object.prototype.hasOwnProperty.call(item, 'standingIntent') || item.standingIntent === record.kindBinding.standingIntent));
  if (!pair) return 'deny_kind_or_scope_mismatch';
  const kindBinding = record.kindBinding;
  if (record.authorizationKind === 'per_run_approval') {
    const evidenceContract = contract.trustedResolutionContract.perRunProposedActionSubjectEvidence;
    const evidence = trusted.proposedActionSubjectEvidence;
    if (kindBinding.subjectRecordType !== 'proposed_action' || !uuid.test(kindBinding.subjectRecordId) ||
        !sha.test(kindBinding.subjectRecordDigest) || !uuid.test(kindBinding.runId) ||
        kindBinding.standingIntent !== null ||
        !exactKeys(evidence, evidenceContract.exactKeys) ||
        evidence.subjectRecordType !== evidenceContract.subjectRecordType ||
        evidence.tenantId !== record.tenantId ||
        evidence.subjectRecordId !== kindBinding.subjectRecordId ||
        evidence.subjectRecordDigest !== kindBinding.subjectRecordDigest ||
        evidence.runId !== kindBinding.runId ||
        evidence.policyId !== record.policyBinding.policyId ||
        evidence.policyVersion !== record.policyBinding.policyVersion ||
        evidence.policyDigest !== record.policyBinding.policyDigest ||
        evidence.sourceSetDigest !== record.sourceBinding.sourceSetDigest ||
        evidence.currentnessMarker !== record.sourceBinding.currentnessMarker ||
        record.idempotencyBinding.namespace !== contract.expiryAndIdempotency.perRunNamespace) {
      return 'deny_kind_or_scope_mismatch';
    }
  } else if (kindBinding.subjectRecordType !== 'policy_version' ||
      kindBinding.subjectRecordId !== record.policyBinding.policyId ||
      kindBinding.subjectRecordDigest !== record.policyBinding.policyDigest || kindBinding.runId !== null ||
      trusted.proposedActionSubjectEvidence !== null ||
      !kind.kindBinding.standingIntent.includes(kindBinding.standingIntent) ||
      record.idempotencyBinding.namespace !== contract.expiryAndIdempotency.standingNamespace) {
    return 'deny_kind_or_scope_mismatch';
  }
  if (record.previewBinding.subjectRecordType !== kindBinding.subjectRecordType ||
      record.previewBinding.subjectRecordId !== kindBinding.subjectRecordId ||
      record.previewBinding.subjectRecordDigest !== kindBinding.subjectRecordDigest ||
      record.previewBinding.policyDigest !== record.policyBinding.policyDigest ||
      record.previewBinding.sourceSetDigest !== record.sourceBinding.sourceSetDigest ||
      record.previewBinding.recipientSetDigest !== record.recipientBinding.recipientSetDigest ||
      record.previewBinding.effectSetDigest !== record.effectBinding.effectSetDigest) {
    return 'deny_material_binding_mismatch_or_change';
  }
  if (!sha.test(record.idempotencyBinding.keyDigest) || !sha.test(record.materialBindingDigest) ||
      !sha.test(record.recordDigest)) return 'deny_digest_or_idempotency_mismatch';

  const expectedMaterial = digest(contract.canonicalization.materialNamespace, materialOf(record, contract));
  const withoutRecordDigest = Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'recordDigest'));
  const expectedRecord = digest(contract.canonicalization.recordNamespace, withoutRecordDigest);
  if (record.materialBindingDigest !== expectedMaterial || record.recordDigest !== expectedRecord) {
    return 'deny_digest_or_idempotency_mismatch';
  }
  if (trusted.authorizationId !== record.authorizationId || trusted.materialBindingDigest !== record.materialBindingDigest ||
      canonicalJson(trusted.materialBinding) !== canonicalJson(materialOf(record, contract))) {
    return 'deny_material_binding_mismatch_or_change';
  }
  return 'accepted_contract_record_only_no_runtime_authority';
}

function validateReplay(existing, candidate, trusted) {
  if (validateAuthorization(existing, trusted) !== 'accepted_contract_record_only_no_runtime_authority' ||
      validateAuthorization(candidate, trusted) !== 'accepted_contract_record_only_no_runtime_authority') {
    return 'deny_material_binding_mismatch_or_change';
  }
  if (existing.authorizationId === candidate.authorizationId &&
      existing.materialBindingDigest === candidate.materialBindingDigest &&
      existing.recordDigest === candidate.recordDigest &&
      existing.idempotencyBinding.keyDigest === candidate.idempotencyBinding.keyDigest) {
    return 'idempotent_exact_replay_no_new_authority';
  }
  return 'deny_digest_or_idempotency_mismatch';
}

function leafPaths(value, prefix = []) {
  if (value === null || typeof value !== 'object') return [prefix];
  return Object.entries(value).flatMap(([key, child]) => leafPaths(child, prefix.concat(key)));
}

function valueAt(value, parts) {
  return parts.reduce((current, key) => current[key], value);
}

function setAt(value, parts, replacement) {
  let current = value;
  for (const key of parts.slice(0, -1)) current = current[key];
  current[parts.at(-1)] = replacement;
}

function changedValue(value) {
  if (value === null) return 'unexpected';
  if (typeof value === 'number') return value + 1;
  if (typeof value === 'boolean') return !value;
  if (/^sha256:/.test(value)) return digestValue(value.endsWith('f') ? 'e' : 'f');
  if (/^[0-9a-f]{8}-/.test(value)) return '00000000-0000-4000-8000-000000000999';
  if (/^[0-9]{4}-/.test(value)) return '2026-10-27T11:45:00.000Z';
  return value === 'changed-value' ? 'other-value' : 'changed-value';
}

describe('Mission 28 Part 3B per-run approval and standing authorization', () => {
  test('binds exact released inputs and Part 3A release provenance', () => {
    const contract = parse(CONTRACT_PATH);
    expect(Object.keys(contract)).toEqual([
      'contractVersion', 'authority', 'part3ARelease', 'frozenInputs', 'decisionStates',
      'identityGrammar', 'authorizationKinds', 'recordGrammar', 'canonicalization',
      'materialBinding', 'trustedResolutionContract', 'expiryAndIdempotency',
      'materialChangeInvalidation', 'selfAuthorityDenials', 'deniedCombinations',
      'runtimeBoundary', 'unavailableEvidence',
    ]);
    expect(contract.contractVersion).toBe('mission28.part3b.approval-authorization.v1');
    expect(contract.authority).toEqual({
      mission: 28, part: '3B', state: 'implementation_candidate_only', baselineCommit: BASE,
      baselineTree: BASE_TREE, runtimeResolverImplemented: false, approvalRouteOrUiGranted: false,
      databaseOrMigrationAdded: false, schedulerWorkerQueueOrProviderAuthorityGranted: false,
      externalRecipientOrEffectAuthorityGranted: false, upstreamMutationAuthorityGranted: false,
      moneyAuthorityGranted: false,
    });
    expect(contract.part3ARelease).toEqual({
      acceptedSourceHead: '05a541792adac121f8c51b2cf200c0d18fcfbbf1', acceptedTree: BASE_TREE,
      pullRequest: 557, mergedMain: BASE, deployment: '7ca335a1-7bf6-4f8d-ae98-a188b891f85d',
      deploymentState: 'SUCCESS_RUNNING',
      imageSha256: '201627b8ee00cf950c267bbd522d5538a7c42461c8771de8701463fe790ac40e',
      auditVerdict: 'P0=P1=P2=P3=0', auditReportSha256: null,
      health: ['one_running_instance', 'startup_ready', 'migrations_269_of_269_latest_273_no_274',
        'health_200', 'root_200', 'demo_200'],
    });
    expect(contract.frozenInputs.map(item => item.path)).toEqual(Object.keys(INPUT_HASHES));
    for (const item of contract.frozenInputs) {
      expect(item.normalizedLfSha256).toBe(INPUT_HASHES[item.path]);
      expect(normalizedLfSha256(item.path)).toBe(item.normalizedLfSha256);
    }
  });

  test('defines exactly two mutually exclusive authorization kinds', () => {
    const contract = parse(CONTRACT_PATH);
    expect(contract.authorizationKinds.map(item => item.id)).toEqual(['per_run_approval', 'standing_authorization']);
    expect(contract.authorizationKinds[0].capabilityOperationPairs).toEqual([{
      capabilityId: 'automation_run_approve', operation: 'approve_run',
      recordScope: 'one_exact_tenant_run_preview',
    }]);
    expect(contract.authorizationKinds[1].capabilityOperationPairs).toEqual([
      { capabilityId: 'automation_standing_authority_activate', operation: 'activate_standing_authority', recordScope: 'one_exact_tenant_policy_version', standingIntent: 'activate_exact_policy_version' },
      { capabilityId: 'automation_standing_authority_change', operation: 'change_standing_authority', recordScope: 'one_exact_tenant_policy_version_transition', standingIntent: 'change_to_exact_policy_version' },
    ]);
    expect(contract.authorizationKinds.every(item => item.boundary.length > 80)).toBe(true);
  });

  test.each([
    ['per_run_approval', 'activate_exact_policy_version'],
    ['standing_authorization', 'activate_exact_policy_version'],
    ['standing_authorization', 'change_to_exact_policy_version'],
  ])('accepts one exact %s fixture as contract-only authority', (kind, intent) => {
    const contract = parse(CONTRACT_PATH);
    const record = buildRecord(kind, intent);
    expect(validateAuthorization(record, trustedFor(record, contract)))
      .toBe('accepted_contract_record_only_no_runtime_authority');
  });

  test('denies kind confusion and kind-specific subject substitution', () => {
    const contract = parse(CONTRACT_PATH);
    const perRun = buildRecord('per_run_approval');
    const trusted = trustedFor(perRun, contract);
    const attacks = [
      record => { record.authorizationKind = 'standing_authorization'; },
      record => { record.actorBinding.capabilityId = 'automation_standing_authority_activate'; },
      record => { record.actorBinding.operation = 'activate_standing_authority'; },
      record => { record.actorBinding.recordScope = 'one_exact_tenant_policy_version'; },
      record => { record.kindBinding.subjectRecordType = 'policy_version'; },
      record => { record.kindBinding.runId = null; },
      record => { record.kindBinding.standingIntent = 'activate_exact_policy_version'; },
    ];
    for (const mutate of attacks) {
      const attack = clone(perRun); mutate(attack);
      expect(validateAuthorization(seal(attack, contract), trusted)).not.toBe('accepted_contract_record_only_no_runtime_authority');
    }
    const standing = buildRecord('standing_authorization');
    const standingTrusted = trustedFor(standing, contract);
    for (const mutate of [
      record => { record.kindBinding.runId = UUID.run; },
      record => { record.kindBinding.subjectRecordId = UUID.proposedAction; },
      record => { record.kindBinding.subjectRecordDigest = digestValue('d'); },
      record => { record.kindBinding.standingIntent = 'approve_run'; },
      record => { record.kindBinding.standingIntent = 'change_to_exact_policy_version'; },
      record => { record.actorBinding.capabilityId = 'automation_run_approve'; },
    ]) {
      const attack = clone(standing); mutate(attack);
      expect(validateAuthorization(seal(attack, contract), standingTrusted)).not.toBe('accepted_contract_record_only_no_runtime_authority');
    }
  });

  test('denies same-tenant per-run transfer against separately trusted proposed-action evidence', () => {
    const contract = parse(CONTRACT_PATH);
    const record = buildRecord('per_run_approval');
    const independentlyResolved = trustedFor(record, contract).proposedActionSubjectEvidence;
    const attacks = [
      value => { value.kindBinding.runId = '00000000-0000-4000-8000-000000000499'; },
      value => {
        value.kindBinding.subjectRecordId = '00000000-0000-4000-8000-000000000499';
        value.previewBinding.subjectRecordId = value.kindBinding.subjectRecordId;
      },
      value => {
        value.kindBinding.subjectRecordDigest = digestValue('f');
        value.previewBinding.subjectRecordDigest = value.kindBinding.subjectRecordDigest;
      },
    ];
    for (const mutate of attacks) {
      const attack = clone(record);
      mutate(attack);
      const redigested = seal(attack, contract);
      const attackerMaterial = trustedFor(redigested, contract);
      attackerMaterial.proposedActionSubjectEvidence = clone(independentlyResolved);
      expect(validateAuthorization(redigested, attackerMaterial)).toBe('deny_kind_or_scope_mismatch');
    }
    const selfSuppliedWrongRun = trustedFor(record, contract);
    selfSuppliedWrongRun.proposedActionSubjectEvidence.runId =
      '00000000-0000-4000-8000-000000000499';
    expect(validateAuthorization(record, selfSuppliedWrongRun)).toBe('deny_kind_or_scope_mismatch');
  });

  test('denies same-tenant cross-actor subject substitution and malformed opaque identities', () => {
    const contract = parse(CONTRACT_PATH);
    const record = buildRecord('per_run_approval');
    const trusted = trustedFor(record, contract);
    const paths = [
      ['actorBinding', 'actorId'], ['actorBinding', 'sessionSubjectActorId'],
      ['actorBinding', 'membershipSubjectActorId'], ['actorBinding', 'sessionId'],
      ['actorBinding', 'membershipId'],
    ];
    for (const parts of paths) {
      for (const invalid of ['', ' ', '\t', ' actor-owner-1', 'actor owner', 'actor\nowner', '-leading', 'a'.repeat(257)]) {
        const attack = clone(record); setAt(attack, parts, invalid);
        expect(validateAuthorization(seal(attack, contract), trusted)).toBe('deny_identity_or_capability_mismatch');
      }
    }
    for (const mutate of [
      value => { value.actorBinding.sessionSubjectActorId = 'actor-owner-2'; },
      value => { value.actorBinding.membershipSubjectActorId = 'actor-owner-2'; },
      value => {
        value.actorBinding.actorId = 'actor-owner-2';
        value.actorBinding.sessionSubjectActorId = 'actor-owner-2';
      },
      value => {
        value.actorBinding.actorId = 'actor-owner-2';
        value.actorBinding.membershipSubjectActorId = 'actor-owner-2';
      },
    ]) {
      const attack = clone(record); mutate(attack);
      expect(validateAuthorization(seal(attack, contract), trusted)).toBe('deny_identity_or_capability_mismatch');
    }
  });

  test('denies missing, stale, expired or mismatched recent authentication and expiry', () => {
    const contract = parse(CONTRACT_PATH);
    const record = buildRecord('standing_authorization');
    const trusted = trustedFor(record, contract);
    for (const mutate of [
      value => { value.actorBinding.recentAuthenticationState = 'stale'; },
      value => { value.actorBinding.recentAuthenticationEvidenceId = '00000000-0000-4000-8000-000000000999'; },
      value => { value.actorBinding.recentAuthenticationEvidenceDigest = digestValue('f'); },
      value => { value.actorBinding.recentAuthenticationExpiresAt = '2026-10-27T10:15:00.000Z'; },
      value => { value.temporalBinding.expiresAt = '2026-10-27T10:15:00.000Z'; },
      value => { value.temporalBinding.issuedAt = '2026-10-27T12:30:00.000Z'; },
    ]) {
      const attack = clone(record); mutate(attack);
      expect(validateAuthorization(seal(attack, contract), trusted)).not.toBe('accepted_contract_record_only_no_runtime_authority');
    }
    expect(validateAuthorization(record, trustedFor(record, contract, '2026-10-27T12:30:00.000Z')))
      .toBe('deny_expired_or_invalid_time_binding');
  });

  test('denies every material leaf change even after candidate digests are recomputed', () => {
    const contract = parse(CONTRACT_PATH);
    for (const kind of ['per_run_approval', 'standing_authorization']) {
      const record = buildRecord(kind);
      const trusted = trustedFor(record, contract);
      const material = materialOf(record, contract);
      const paths = leafPaths(material);
      expect(paths.length).toBeGreaterThan(50);
      for (const parts of paths) {
        const attack = clone(record);
        const original = valueAt(attack, parts);
        setAt(attack, parts, changedValue(original));
        const recomputeReason = parts.join('.') !== 'reasonBinding.reasonDigest';
        const redigested = seal(attack, contract, recomputeReason);
        expect(validateAuthorization(redigested, trusted)).not.toBe('accepted_contract_record_only_no_runtime_authority');
      }
    }
  });

  test('denies coherent wholesale tenant actor policy source preview recipient and effect retarget', () => {
    const contract = parse(CONTRACT_PATH);
    const record = buildRecord('standing_authorization');
    const trusted = trustedFor(record, contract);
    const attack = clone(record);
    const tenant = '00000000-0000-4000-8000-000000000029';
    attack.tenantId = tenant;
    for (const key of ['actorTenantId', 'sessionTenantId', 'membershipTenantId']) attack.actorBinding[key] = tenant;
    for (const key of ['policyBinding', 'sourceBinding', 'previewBinding', 'recipientBinding', 'effectBinding']) attack[key].tenantId = tenant;
    attack.actorBinding.actorId = 'actor-owner-2';
    attack.actorBinding.sessionSubjectActorId = 'actor-owner-2';
    attack.actorBinding.membershipSubjectActorId = 'actor-owner-2';
    attack.actorBinding.sessionId = 'session-owner-2';
    attack.actorBinding.membershipId = 'membership-owner-2';
    attack.policyBinding.policyId = '00000000-0000-4000-8000-000000000299';
    attack.policyBinding.policyVersion = 99;
    attack.policyBinding.policyDigest = digestValue('f');
    attack.sourceBinding.sourceSetDigest = digestValue('e');
    attack.previewBinding.previewId = '00000000-0000-4000-8000-000000000599';
    attack.previewBinding.previewDigest = digestValue('d');
    attack.recipientBinding.recipientSetId = '00000000-0000-4000-8000-000000000699';
    attack.recipientBinding.recipientSetDigest = digestValue('c');
    attack.effectBinding.effectSetId = '00000000-0000-4000-8000-000000000799';
    attack.effectBinding.effectSetDigest = digestValue('b');
    attack.kindBinding.subjectRecordId = attack.policyBinding.policyId;
    attack.kindBinding.subjectRecordDigest = attack.policyBinding.policyDigest;
    expect(validateAuthorization(seal(attack, contract), trusted)).toBe('deny_material_binding_mismatch_or_change');
  });

  test('accepts only exact idempotent replay and denies changed or self-created authority', () => {
    const contract = parse(CONTRACT_PATH);
    const record = buildRecord('per_run_approval');
    const trusted = trustedFor(record, contract);
    expect(validateReplay(record, clone(record), trusted)).toBe('idempotent_exact_replay_no_new_authority');
    const changedKey = clone(record);
    changedKey.idempotencyBinding.keyDigest = digestValue('f');
    expect(validateReplay(record, seal(changedKey, contract), trusted)).toBe('deny_material_binding_mismatch_or_change');
    expect(validateAuthorization(record, null)).toBe('deny_unsupported_or_self_created_authority');
    expect(validateAuthorization(record, trustedFor(record, contract, 'not-a-time')))
      .toBe('deny_expired_or_invalid_time_binding');
  });

  test('denies stale sources, unavailable launch cells, unsupported effects and digest attacks', () => {
    const contract = parse(CONTRACT_PATH);
    const record = buildRecord('per_run_approval');
    const trusted = trustedFor(record, contract);
    for (const mutate of [
      value => { value.sourceBinding.currentnessMarker = 'captured_stale'; },
      value => { value.previewBinding.previewState = 'stale'; },
      value => { value.effectBinding.actionFamilyId = 'unsupported_upstream_mutation_or_money_movement'; },
    ]) {
      const attack = clone(record); mutate(attack);
      expect(validateAuthorization(seal(attack, contract), trusted))
        .not.toBe('accepted_contract_record_only_no_runtime_authority');
    }
    for (const unavailable of contract.recordGrammar.unavailableFirstLaunchActionFamilyIds) {
      const attack = clone(record);
      attack.effectBinding.actionFamilyId = unavailable;
      expect(validateAuthorization(seal(attack, contract), trusted)).toBe('deny_material_binding_mismatch_or_change');
    }
    for (const mutate of [
      value => { value.recipientBinding.recipientClassIds = ['assigned_staff', 'tenant_owner']; },
      value => { value.recipientBinding.recipientClassIds = ['customer']; },
      value => { value.effectBinding.channelIds = ['sms']; },
      value => { value.effectBinding.providerModeIds = ['live']; },
      value => { value.effectBinding.effectClass = 'external_effect'; },
      value => { value.previewBinding.policyDigest = digestValue('f'); },
      value => { value.previewBinding.sourceSetDigest = digestValue('f'); },
      value => { value.previewBinding.recipientSetDigest = digestValue('f'); },
      value => { value.previewBinding.effectSetDigest = digestValue('f'); },
      value => { value.previewBinding.subjectRecordId = '00000000-0000-4000-8000-000000000999'; },
    ]) {
      const attack = clone(record); mutate(attack);
      expect(validateAuthorization(seal(attack, contract), trusted)).toBe('deny_material_binding_mismatch_or_change');
    }
    for (const mutate of [
      value => { value.materialBindingDigest = digestValue('f'); },
      value => { value.recordDigest = digestValue('f'); },
      value => { value.reasonBinding.reasonDigest = digestValue('f'); },
    ]) {
      const attack = clone(record); mutate(attack);
      expect(validateAuthorization(attack, trusted)).not.toBe('accepted_contract_record_only_no_runtime_authority');
    }
  });

  test('preserves exactly the three conditional provider-disabled internal first-launch cells', () => {
    const contract = parse(CONTRACT_PATH);
    for (const [actionFamilyId, recipientClassIds] of [
      ['internal_read_digest_task', ['tenant_owner', 'tenant_admin', 'assigned_staff']],
      ['owner_approval_request', ['tenant_owner']],
      ['collection_escalation', ['tenant_owner']],
    ]) {
      const record = buildRecord('per_run_approval');
      record.effectBinding.actionFamilyId = actionFamilyId;
      record.recipientBinding.recipientClassIds = recipientClassIds;
      const sealed = seal(record, contract);
      expect(validateAuthorization(sealed, trustedFor(sealed, contract)))
        .toBe('accepted_contract_record_only_no_runtime_authority');
    }
    expect(contract.recordGrammar.unavailableFirstLaunchActionFamilyIds)
      .toEqual(['customer_communication', 'secure_document_delivery', 'financial_reminder']);
  });

  test('rejects unknown keys and hostile non-plain values before getter execution', () => {
    const contract = parse(CONTRACT_PATH);
    const record = buildRecord('per_run_approval');
    const trusted = trustedFor(record, contract);
    expect(validateAuthorization({ ...record, authorityGranted: true }, trusted))
      .toBe('deny_unsupported_or_self_created_authority');
    const custom = clone(record);
    Object.setPrototypeOf(custom.policyBinding, { policyDigest: digestValue('f') });
    expect(validateAuthorization(custom, trusted)).toBe('deny_unsupported_or_self_created_authority');
    const symbol = clone(record);
    symbol.previewBinding[Symbol('secret')] = 'provider-token';
    expect(validateAuthorization(symbol, trusted)).toBe('deny_unsupported_or_self_created_authority');
    let getterCalls = 0;
    const accessor = clone(record);
    Object.defineProperty(accessor.effectBinding, 'effectSetDigest', {
      enumerable: true, configurable: true, get() { getterCalls += 1; return digestValue('6'); },
    });
    expect(validateAuthorization(accessor, trusted)).toBe('deny_unsupported_or_self_created_authority');
    expect(getterCalls).toBe(0);
    const proxied = new Proxy(record, { get(target, key, receiver) { getterCalls += 1; return Reflect.get(target, key, receiver); } });
    expect(validateAuthorization(proxied, trusted)).toBe('deny_unsupported_or_self_created_authority');
    expect(getterCalls).toBe(0);
  });

  test('preserves explicit self-authority and runtime denials', () => {
    const contract = parse(CONTRACT_PATH);
    expect(contract.selfAuthorityDenials).toHaveLength(10);
    expect(contract.deniedCombinations).toHaveLength(15);
    expect(contract.selfAuthorityDenials).toEqual(expect.arrayContaining([
      'capability_eligibility_record_alone_creates_approval_or_standing_authority',
      'per_run_approval_becomes_standing_authorization_or_transfers_to_another_run',
      'standing_authorization_approves_arbitrary_run_new_policy_source_preview_recipient_or_effect',
      'authorization_record_proves_schedule_provider_attempt_delivery_outcome_upstream_mutation_or_money_effect',
    ]));
    expect(Object.values(contract.runtimeBoundary)).toEqual([
      false, false, false, false, false, false, true,
      'valid_source_contract_record_only_no_runtime_or_effect_authority',
    ]);
    expect(contract.unavailableEvidence).toHaveLength(8);
  });

  test('roadmap and ledger record Parts 1A-5A released and only Part 5B current', () => {
    const roadmap = read(ROADMAP_PATH);
    const ledger = read(LEDGER_PATH);
    for (const document of [roadmap, ledger]) {
      expect(document).toContain('Parts 1A–8A are released. Part 8B is the sole implementation candidate.');
      expect(document).toContain('Parts 8C–14G');
      expect(document).toContain('05a541792adac121f8c51b2cf200c0d18fcfbbf1');
      expect(document).toContain('1e62336afe2c9e65cccbe1629a62b86855da3ff8');
      expect(document).toContain('7ca335a1-7bf6-4f8d-ae98-a188b891f85d');
      expect(document).toContain('201627b8ee00cf950c267bbd522d5538a7c42461c8771de8701463fe790ac40e');
    }
    expect(ledger).toContain('| 09 | 3A | Fixed action capability matrix | **Released** |');
    expect(ledger).toContain('| 10 | 3B | Per-run approval versus standing authorization | **Released** |');
    expect(ledger).toContain('| 11 | 3C | Owner limits and mandatory minimum constraints | **Released** |');
    expect(ledger).toContain('| 12 | 3D | Pause/revoke/kill/drain/cancel/resume and governance boundary | **Released** |');
    expect(ledger).toContain('| 13 | 4A | Closed trigger catalog over accepted Missions 20–27 facts | **Released** |');
    expect(ledger).toContain('| 14 | 4B | Durable tenant-scoped source snapshot and correction lineage | **Released** |');
    expect(ledger).toContain('| 15 | 4C | Evaluation-time and pre-effect currentness revalidation | **Released** |');
    expect(roadmap).toContain('Released Part 3B artifacts');
    expect(roadmap).toContain('Released Part 3C artifacts');
    expect(roadmap).toContain('Released Part 3D artifacts');
    expect(roadmap).toContain('Released Part 4C artifacts');
    expect(roadmap).toContain('Released Part 4D artifacts');
    expect(roadmap).toContain('Released Part 5A artifacts');
    expect(roadmap).toContain('Released Part 5D artifacts');
    expect(ledger).toContain('independent audit/PR/merge/deployment unavailable');
  });

  test('keeps released migration lineage and recognizes candidate migration 287', () => {
    const migrations = fs.readdirSync(path.join(ROOT, 'migrations')).filter(name => /^\d+_/.test(name));
    const numbers = migrations.map(name => Number(name.match(/^(\d+)_/)[1]));
    expect(Math.max(...numbers)).toBe(287);
    expect(numbers.filter(number => number === 287)).toHaveLength(1);
    expect(numbers).not.toContain(288);
    expect(numbers.filter(number => number === 274)).toHaveLength(1);
    expect(numbers.filter(number => number === 275)).toHaveLength(1);
    expect(numbers.filter(number => number === 276)).toHaveLength(1);
    expect(numbers.filter(number => number === 277)).toHaveLength(1);
    expect(numbers.filter(number => number === 278)).toHaveLength(1);
    expect(numbers.filter(number => number === 279)).toHaveLength(1);
    expect(read(NARRATIVE_PATH)).toContain('source contract, not a runtime resolver or authorization grant');
  });
});
