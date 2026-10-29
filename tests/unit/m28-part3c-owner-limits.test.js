'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { types } = require('node:util');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const parse = relative => JSON.parse(read(relative));
const clone = value => JSON.parse(JSON.stringify(value));

const CONTRACT_PATH = 'docs/architecture/MISSION_28_PART3C_OWNER_LIMITS_CONTRACT.json';
const NARRATIVE_PATH = 'docs/architecture/MISSION_28_PART3C_OWNER_LIMITS_CONTRACT.md';
const ROADMAP_PATH = 'docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md';
const LEDGER_PATH = 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md';
const BASE = 'd88a0fe294619fa982bc1541affc8052031cc406';
const BASE_TREE = '6ae86ee398e47fd75403bb98bcc3259522ec9461';
const MANDATORY_MANIFEST_DIGEST = 'sha256:fbef63bf558da8daf4f84af06737ff9de3b2f038f0d7eabbb174e75e13430dc3';

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
  'docs/architecture/MISSION_28_PART3B_APPROVAL_AUTHORIZATION_CONTRACT.json': '6A7558C5BC61C31B627C9C0C474955B98E1D2D7BA5CC537C57F7F9D767A52575',
  'docs/architecture/MISSION_28_PART3B_APPROVAL_AUTHORIZATION_CONTRACT.md': 'C8C0D7CA8D4FDB9F949B2B35FBAAEE91B321D0127B64A77ECFF941C3F315B2D0',
});

const UUID = Object.freeze({
  tenant: '00000000-0000-4000-8000-000000000028',
  profile: '00000000-0000-4000-8000-0000000003c1',
  policy: '00000000-0000-4000-8000-000000000201',
  authorization: '00000000-0000-4000-8000-000000000301',
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

function mandatoryManifestDigest(contract) {
  const material = clone(contract.mandatoryConstraints);
  delete material.manifestDigest;
  return digest(contract.profileGrammar.mandatoryManifestDigestNamespace, material);
}

function validUtcInstant(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function validIanaTimeZone(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function seal(profile, contract) {
  const result = clone(profile);
  const material = Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'profileDigest'));
  result.profileDigest = digest(contract.profileGrammar.digestNamespace, material);
  return result;
}

function buildProfile(actionFamilyId = 'internal_read_digest_task') {
  const contract = parse(CONTRACT_PATH);
  const collection = actionFamilyId === 'collection_escalation';
  return seal({
    contractVersion: contract.profileGrammar.contractVersion,
    profileId: UUID.profile,
    tenantId: UUID.tenant,
    policyBinding: {
      tenantId: UUID.tenant,
      policyId: UUID.policy,
      policyVersion: 4,
      policyDigest: digestValue('2'),
      sourceSetDigest: digestValue('3'),
      currentnessMarker: contract.profileGrammar.policyCurrentnessMarker,
    },
    actionFamilyId,
    standingAuthorizationBinding: {
      authorizationId: UUID.authorization,
      authorizationKind: 'standing_authorization',
      standingIntent: 'change_to_exact_policy_version',
      materialBindingDigest: digestValue('4'),
      recordDigest: digestValue('5'),
      expiresAt: '2026-10-28T12:00:00.000Z',
    },
    mandatoryConstraintManifestDigest: contract.mandatoryConstraints.manifestDigest,
    dimensionOrder: clone(contract.dimensionOrder),
    constraints: {
      frequency: {
        minimumIntervalSeconds: 60,
        maxPerRecipientRollingHour: 1,
        maxPerRecipientRollingDay: 3,
        maxPerRecipientRollingWeek: 10,
      },
      recipient: {
        allowedRecipientClassIds: ['tenant_owner'],
        maxRecipientsPerAction: 1,
        exactRecipientResolutionRequired: true,
      },
      channel: {
        allowedChannelIds: ['in_app_passive'],
        allowedProviderModeIds: ['provider_disabled'],
        exactChannelAvailabilityRequired: true,
        fallbackChannelAllowed: false,
      },
      timeWindow: {
        tenantTimeZone: 'America/New_York',
        allowedWindows: [
          { dayId: 1, startMinuteInclusive: 480, endMinuteExclusive: 1020 },
          { dayId: 2, startMinuteInclusive: 480, endMinuteExclusive: 1020 },
        ],
      },
      quietHour: {
        tenantTimeZone: 'America/New_York',
        quietWindows: [
          { dayId: 1, startMinuteInclusive: 0, endMinuteExclusive: 420 },
          { dayId: 1, startMinuteInclusive: 1260, endMinuteExclusive: 1440 },
        ],
        quietTimeMayRerouteOrAuthorize: false,
      },
      actionCount: { maxActionsPerEvaluation: 1, maxPendingActions: 20 },
      invoiceValue: collection
        ? { mode: 'exact_current_invoice_ceiling_internal_only', currency: 'USD', maxMinorUnits: 100000 }
        : { mode: 'not_applicable_no_financial_authority', currency: null, maxMinorUnits: null },
      agingStage: collection
        ? { mode: 'exact_current_reviewed_handoff_subset_internal_only', allowedStageIds: ['overdue_1_30', 'overdue_31_60'] }
        : { mode: 'not_applicable_no_collection_authority', allowedStageIds: [] },
      campaign: { mode: 'disabled_unavailable', campaignId: null, maxActions: 0 },
      dailyWeeklyVolume: { maxDailyActions: 5, maxWeeklyActions: 20 },
      providerSpend: { mode: 'provider_disabled_zero', currency: null, maxDailyMinorUnits: 0, maxWeeklyMinorUnits: 0 },
    },
    profileState: contract.profileGrammar.profileState,
    profileDigest: digestValue('0'),
  }, contract);
}

function trustedFor(profile, contract, decisionAt = '2026-10-28T10:00:00.000Z') {
  return {
    tenantId: profile.tenantId,
    tenantTimeZone: profile.constraints.timeWindow.tenantTimeZone,
    policyBinding: {
      ...clone(profile.policyBinding),
      actionFamilyId: profile.actionFamilyId,
      limitProfileDigest: profile.profileDigest,
    },
    standingAuthorizationResolution: {
      ...clone(profile.standingAuthorizationBinding),
      tenantId: profile.tenantId,
      policyId: profile.policyBinding.policyId,
      policyVersion: profile.policyBinding.policyVersion,
      policyDigest: profile.policyBinding.policyDigest,
      sourceSetDigest: profile.policyBinding.sourceSetDigest,
    },
    mandatoryConstraintManifestDigest: contract.mandatoryConstraints.manifestDigest,
    expectedProfileDigest: profile.profileDigest,
    decisionAt,
  };
}

function orderedSubset(values, allowed) {
  if (!Array.isArray(values) || new Set(values).size !== values.length) return false;
  let previous = -1;
  for (const value of values) {
    const index = allowed.indexOf(value);
    if (index <= previous) return false;
    previous = index;
  }
  return true;
}

function validWindows(windows, contract) {
  if (!Array.isArray(windows)) return false;
  const time = contract.mandatoryConstraints.timeBasis;
  let previousDay = 0;
  let previousEnd = -1;
  for (const window of windows) {
    if (!exactKeys(window, contract.profileGrammar.windowExactKeys) ||
        !Number.isSafeInteger(window.dayId) || !time.dayIds.includes(window.dayId) ||
        !Number.isSafeInteger(window.startMinuteInclusive) || !Number.isSafeInteger(window.endMinuteExclusive) ||
        window.startMinuteInclusive < time.minimumMinuteInclusive ||
        window.endMinuteExclusive > time.maximumMinuteExclusive ||
        window.startMinuteInclusive >= window.endMinuteExclusive ||
        window.dayId < previousDay || (window.dayId === previousDay && window.startMinuteInclusive < previousEnd)) {
      return false;
    }
    previousEnd = window.dayId === previousDay ? window.endMinuteExclusive : window.endMinuteExclusive;
    previousDay = window.dayId;
  }
  return true;
}

function validateProfile(input, trustedInput) {
  const contract = parse(CONTRACT_PATH);
  let profile;
  let trusted;
  try {
    profile = safeClonePlain(input);
    trusted = safeClonePlain(trustedInput);
  } catch {
    return 'deny_missing_or_self_created_trusted_resolution';
  }
  const grammar = contract.profileGrammar;
  const resolution = contract.trustedResolutionContract;
  if (!exactKeys(profile, grammar.exactKeys) || !exactKeys(trusted, resolution.requiredExactKeys) ||
      !exactKeys(profile.policyBinding, grammar.policyBindingExactKeys) ||
      !exactKeys(profile.standingAuthorizationBinding, grammar.standingAuthorizationBindingExactKeys) ||
      !exactKeys(profile.constraints, grammar.constraintsExactKeys) ||
      !exactKeys(trusted.policyBinding, resolution.trustedPolicyBindingExactKeys) ||
      !exactKeys(trusted.standingAuthorizationResolution, resolution.standingAuthorizationResolutionExactKeys)) {
    return 'deny_missing_or_self_created_trusted_resolution';
  }
  for (const [key, keys] of Object.entries(grammar.constraintExactKeys)) {
    if (!exactKeys(profile.constraints[key], keys)) return 'deny_unknown_missing_duplicate_reordered_or_malformed_dimension';
  }
  if (profile.contractVersion !== grammar.contractVersion || profile.profileState !== grammar.profileState ||
      canonicalJson(profile.dimensionOrder) !== canonicalJson(contract.dimensionOrder)) {
    return 'deny_unknown_missing_duplicate_reordered_or_malformed_dimension';
  }

  const uuid = new RegExp(contract.identityGrammar.uuidPattern);
  const sha = new RegExp(contract.identityGrammar.digestPattern);
  const instant = new RegExp(contract.identityGrammar.utcInstantPattern);
  const zone = new RegExp(contract.identityGrammar.ianaTimeZonePattern);
  const currency = new RegExp(contract.identityGrammar.currencyPattern);
  const policy = profile.policyBinding;
  const trustedPolicy = trusted.policyBinding;
  if (!uuid.test(profile.profileId) || !uuid.test(profile.tenantId) || !uuid.test(policy.policyId) ||
      policy.tenantId !== profile.tenantId || !Number.isSafeInteger(policy.policyVersion) || policy.policyVersion < 1 ||
      !sha.test(policy.policyDigest) || !sha.test(policy.sourceSetDigest) ||
      policy.currentnessMarker !== grammar.policyCurrentnessMarker ||
      trusted.tenantId !== profile.tenantId || trusted.tenantTimeZone !== profile.constraints.timeWindow.tenantTimeZone ||
       !validIanaTimeZone(trusted.tenantTimeZone, zone) ||
      Object.keys(policy).some(key => policy[key] !== trustedPolicy[key]) ||
      trustedPolicy.actionFamilyId !== profile.actionFamilyId ||
      trustedPolicy.limitProfileDigest !== profile.profileDigest) {
    return 'deny_identity_policy_source_or_authorization_mismatch';
  }

  const manifestDigest = mandatoryManifestDigest(contract);
  if (manifestDigest !== contract.mandatoryConstraints.manifestDigest ||
      profile.mandatoryConstraintManifestDigest !== manifestDigest ||
      trusted.mandatoryConstraintManifestDigest !== manifestDigest) {
    return 'deny_owner_limit_weakens_mandatory_constraint';
  }

  const binding = profile.standingAuthorizationBinding;
  const auth = trusted.standingAuthorizationResolution;
  if (!uuid.test(binding.authorizationId) || binding.authorizationKind !== 'standing_authorization' ||
      !resolution.allowedStandingIntents.includes(binding.standingIntent) ||
      !sha.test(binding.materialBindingDigest) || !sha.test(binding.recordDigest) ||
      !validUtcInstant(binding.expiresAt, instant) ||
      Object.keys(binding).some(key => binding[key] !== auth[key]) ||
      auth.tenantId !== profile.tenantId || auth.policyId !== policy.policyId ||
      auth.policyVersion !== policy.policyVersion || auth.policyDigest !== policy.policyDigest ||
      auth.sourceSetDigest !== policy.sourceSetDigest || !validUtcInstant(trusted.decisionAt, instant) ||
      trusted.decisionAt >= auth.expiresAt) {
    return 'deny_identity_policy_source_or_authorization_mismatch';
  }

  const withoutDigest = Object.fromEntries(Object.entries(profile).filter(([key]) => key !== 'profileDigest'));
  if (Buffer.byteLength(canonicalJson(profile), 'utf8') > contract.mandatoryConstraints.numericRules.maximumCanonicalInputBytes) {
    return 'deny_unknown_missing_duplicate_reordered_or_malformed_dimension';
  }
  const expectedDigest = digest(grammar.digestNamespace, withoutDigest);
  if (!sha.test(profile.profileDigest) || profile.profileDigest !== expectedDigest ||
      trusted.expectedProfileDigest !== profile.profileDigest) return 'deny_digest_or_replay_conflict';

  const launchRule = contract.mandatoryConstraints.firstLaunchActionFamilies[profile.actionFamilyId];
  if (!launchRule) return 'deny_unavailable_action_channel_recipient_provider_or_effect';
  const constraints = profile.constraints;
  const maximum = contract.mandatoryConstraints.numericRules.safeIntegerMaximum;
  const safeBound = value => Number.isSafeInteger(value) && value >= 0 && value <= maximum;
  const frequency = constraints.frequency;
  if (![frequency.minimumIntervalSeconds, frequency.maxPerRecipientRollingHour,
    frequency.maxPerRecipientRollingDay, frequency.maxPerRecipientRollingWeek].every(safeBound) ||
      frequency.minimumIntervalSeconds < contract.mandatoryConstraints.numericRules.minimumFrequencyIntervalSeconds ||
      frequency.maxPerRecipientRollingHour > frequency.maxPerRecipientRollingDay ||
      frequency.maxPerRecipientRollingDay > frequency.maxPerRecipientRollingWeek) {
    return 'deny_owner_limit_weakens_mandatory_constraint';
  }

  const recipient = constraints.recipient;
  if (!orderedSubset(recipient.allowedRecipientClassIds, launchRule.recipientClassIds) ||
      !safeBound(recipient.maxRecipientsPerAction) ||
      recipient.maxRecipientsPerAction > contract.mandatoryConstraints.numericRules.maximumInternalRecipientsPerAction ||
      recipient.exactRecipientResolutionRequired !== true ||
      (recipient.maxRecipientsPerAction === 0) !== (recipient.allowedRecipientClassIds.length === 0)) {
    return 'deny_owner_limit_weakens_mandatory_constraint';
  }
  const channel = constraints.channel;
  if (!orderedSubset(channel.allowedChannelIds, launchRule.channelIds) ||
      !orderedSubset(channel.allowedProviderModeIds, launchRule.providerModeIds) ||
      channel.exactChannelAvailabilityRequired !== true || channel.fallbackChannelAllowed !== false ||
      (channel.allowedChannelIds.length === 0) !== (channel.allowedProviderModeIds.length === 0)) {
    return 'deny_owner_limit_weakens_mandatory_constraint';
  }

  if (constraints.timeWindow.tenantTimeZone !== trusted.tenantTimeZone ||
      constraints.quietHour.tenantTimeZone !== trusted.tenantTimeZone ||
      !validWindows(constraints.timeWindow.allowedWindows, contract) ||
      !validWindows(constraints.quietHour.quietWindows, contract) ||
      constraints.quietHour.quietTimeMayRerouteOrAuthorize !== false) {
    return 'deny_owner_limit_weakens_mandatory_constraint';
  }

  const actionCount = constraints.actionCount;
  const volume = constraints.dailyWeeklyVolume;
  if (!safeBound(actionCount.maxActionsPerEvaluation) || !safeBound(actionCount.maxPendingActions) ||
      actionCount.maxActionsPerEvaluation > contract.mandatoryConstraints.numericRules.maximumActionsPerEvaluation ||
      !safeBound(volume.maxDailyActions) || !safeBound(volume.maxWeeklyActions) ||
      volume.maxDailyActions > volume.maxWeeklyActions) return 'deny_owner_limit_weakens_mandatory_constraint';

  const invoice = constraints.invoiceValue;
  const aging = constraints.agingStage;
  if (profile.actionFamilyId === 'collection_escalation') {
    if (invoice.mode !== launchRule.invoiceValueMode || typeof invoice.currency !== 'string' ||
        !currency.test(invoice.currency) || !safeBound(invoice.maxMinorUnits) ||
        aging.mode !== launchRule.agingStageMode ||
        !orderedSubset(aging.allowedStageIds, contract.mandatoryConstraints.agingStageOrder)) {
      return 'deny_owner_limit_weakens_mandatory_constraint';
    }
  } else if (invoice.mode !== launchRule.invoiceValueMode || invoice.currency !== null || invoice.maxMinorUnits !== null ||
      aging.mode !== launchRule.agingStageMode || !Array.isArray(aging.allowedStageIds) || aging.allowedStageIds.length !== 0) {
    return 'deny_owner_limit_weakens_mandatory_constraint';
  }

  if (constraints.campaign.mode !== 'disabled_unavailable' || constraints.campaign.campaignId !== null ||
      constraints.campaign.maxActions !== 0 || constraints.providerSpend.mode !== 'provider_disabled_zero' ||
      constraints.providerSpend.currency !== null || constraints.providerSpend.maxDailyMinorUnits !== 0 ||
      constraints.providerSpend.maxWeeklyMinorUnits !== 0) {
    return 'deny_unavailable_action_channel_recipient_provider_or_effect';
  }
  return 'accepted_contract_profile_only_no_runtime_or_effect_authority';
}

function validateReplay(existing, candidate, trusted) {
  if (validateProfile(existing, trusted) !== 'accepted_contract_profile_only_no_runtime_or_effect_authority' ||
      validateProfile(candidate, trusted) !== 'accepted_contract_profile_only_no_runtime_or_effect_authority') {
    return 'deny_digest_or_replay_conflict';
  }
  return existing.profileId === candidate.profileId && existing.profileDigest === candidate.profileDigest
    ? 'idempotent_exact_replay_no_new_authority'
    : 'deny_digest_or_replay_conflict';
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
  if (typeof value === 'boolean') return !value;
  if (typeof value === 'number') return value + 1;
  if (typeof value === 'string') {
    if (value.startsWith('sha256:')) return digestValue(value.endsWith('f') ? 'e' : 'f');
    if (/^[0-9a-f]{8}-/.test(value)) return '00000000-0000-4000-8000-000000000499';
    return `${value}_changed`;
  }
  throw new Error('unsupported leaf');
}

describe('Mission 28 Part 3C owner limits and mandatory constraints', () => {
  test('binds exact released inputs and Part 3B release provenance', () => {
    const contract = parse(CONTRACT_PATH);
    expect(Object.keys(contract)).toEqual([
      'contractVersion', 'authority', 'part3BRelease', 'frozenInputs', 'decisionStates',
      'identityGrammar', 'dimensionOrder', 'dimensionContracts', 'mandatoryConstraints',
      'profileGrammar', 'trustedResolutionContract', 'effectiveLimitRules',
      'materialChangeAndReplay', 'deniedCombinations', 'runtimeBoundary', 'unavailableEvidence',
    ]);
    expect(contract.contractVersion).toBe('mission28.part3c.owner-limits.v1');
    expect(contract.authority).toEqual({
      mission: 28, part: '3C', state: 'implementation_candidate_only', baselineCommit: BASE,
      baselineTree: BASE_TREE, runtimeLimitResolverImplemented: false, databaseOrMigrationAdded: false,
      routeUiSchedulerWorkerQueueOrProviderAuthorityGranted: false,
      externalRecipientOrEffectAuthorityGranted: false, upstreamMutationOrMoneyAuthorityGranted: false,
    });
    expect(contract.part3BRelease).toMatchObject({
      acceptedSourceHead: '56a39854325826982283d78dffed4e039c61335b', acceptedTree: BASE_TREE,
      pullRequest: 558, mergedMain: BASE, mergedAt: '2026-10-27T19:49:29.000Z',
      deployment: '81bc25de-eb77-413e-8745-97882bdd7c09', deploymentState: 'SUCCESS_RUNNING',
      runningInstance: 'ae88752d-2f49-46bc-9692-adafbd1ba5cc',
      imageSha256: '96720a1fc1c5379d53992081046540f28ddf1c42307cb34f0b824fe737ef8974',
      auditVerdict: 'P0=P1=P2=P3=0', auditReportSha256: null,
    });
    expect(contract.frozenInputs.map(item => item.path)).toEqual(Object.keys(INPUT_HASHES));
    for (const item of contract.frozenInputs) {
      expect(item.normalizedLfSha256).toBe(INPUT_HASHES[item.path]);
      expect(normalizedLfSha256(item.path)).toBe(item.normalizedLfSha256);
    }
  });

  test('defines exactly eleven owner-narrowing dimensions and one immutable manifest', () => {
    const contract = parse(CONTRACT_PATH);
    expect(contract.dimensionOrder).toEqual([
      'frequency', 'recipient', 'channel', 'time_window', 'quiet_hour', 'action_count',
      'invoice_value', 'aging_stage', 'campaign', 'daily_weekly_volume', 'provider_spend',
    ]);
    expect(contract.dimensionContracts.map(item => item.id)).toEqual(contract.dimensionOrder);
    expect(contract.dimensionContracts.every(item => item.ownerMay && item.effectiveMerge && item.mandatoryRule)).toBe(true);
    expect(contract.mandatoryConstraints.manifestDigest).toBe(MANDATORY_MANIFEST_DIGEST);
    expect(mandatoryManifestDigest(contract)).toBe(MANDATORY_MANIFEST_DIGEST);
    expect(contract.mandatoryConstraints.profilesMayOnlyNarrow).toBe(true);
    expect(contract.mandatoryConstraints.numericRules).toMatchObject({
      maximumActionsPerEvaluation: 1, maximumInternalRecipientsPerAction: 1,
      maximumExternalRecipientsPerAction: 0, maximumExternalMessagesPerAction: 0,
      maximumProviderAttemptsPerAction: 0, maximumUpstreamMutationsPerAction: 0,
      maximumMoneyEffectsPerAction: 0, maximumCanonicalInputBytes: 65536,
    });
  });

  test.each(['internal_read_digest_task', 'owner_approval_request', 'collection_escalation'])
  ('accepts one exact %s profile as contract-only evidence', actionFamilyId => {
    const contract = parse(CONTRACT_PATH);
    const profile = buildProfile(actionFamilyId);
    expect(validateProfile(profile, trustedFor(profile, contract)))
      .toBe('accepted_contract_profile_only_no_runtime_or_effect_authority');
  });

  test('denies malformed frequency action-count and daily-weekly limits', () => {
    const contract = parse(CONTRACT_PATH);
    const profile = buildProfile();
    const attacks = [
      value => { value.constraints.frequency.minimumIntervalSeconds = 0; },
      value => { value.constraints.frequency.maxPerRecipientRollingHour = -1; },
      value => { value.constraints.frequency.maxPerRecipientRollingHour = 4; },
      value => { value.constraints.frequency.maxPerRecipientRollingDay = 11; },
      value => { value.constraints.frequency.maxPerRecipientRollingWeek = 1.5; },
      value => { value.constraints.actionCount.maxActionsPerEvaluation = 2; },
      value => { value.constraints.actionCount.maxPendingActions = null; },
      value => { value.constraints.dailyWeeklyVolume.maxDailyActions = 21; },
      value => { value.constraints.dailyWeeklyVolume.maxWeeklyActions = Number.MAX_SAFE_INTEGER; },
    ];
    for (const [attackIndex, mutate] of attacks.entries()) {
      const attack = clone(profile); mutate(attack);
      const sealed = seal(attack, contract);
      const expected = attackIndex === 4
        ? 'deny_missing_or_self_created_trusted_resolution'
        : 'deny_owner_limit_weakens_mandatory_constraint';
      expect({ attackIndex, verdict: validateProfile(sealed, trustedFor(sealed, contract)) })
        .toEqual({ attackIndex, verdict: expected });
    }
  });

  test('denies recipient channel provider and fallback widening while permitting deny-all narrowing', () => {
    const contract = parse(CONTRACT_PATH);
    const profile = buildProfile('owner_approval_request');
    for (const mutate of [
      value => { value.constraints.recipient.allowedRecipientClassIds = ['tenant_admin']; },
      value => { value.constraints.recipient.allowedRecipientClassIds = ['tenant_owner', 'tenant_owner']; },
      value => { value.constraints.recipient.maxRecipientsPerAction = 2; },
      value => { value.constraints.recipient.exactRecipientResolutionRequired = false; },
      value => { value.constraints.channel.allowedChannelIds = ['sms']; },
      value => { value.constraints.channel.allowedProviderModeIds = ['live']; },
      value => { value.constraints.channel.fallbackChannelAllowed = true; },
      value => { value.constraints.channel.exactChannelAvailabilityRequired = false; },
    ]) {
      const attack = clone(profile); mutate(attack);
      const sealed = seal(attack, contract);
      expect(validateProfile(sealed, trustedFor(sealed, contract)))
        .toBe('deny_owner_limit_weakens_mandatory_constraint');
    }
    const denyAll = clone(profile);
    denyAll.constraints.recipient.allowedRecipientClassIds = [];
    denyAll.constraints.recipient.maxRecipientsPerAction = 0;
    denyAll.constraints.channel.allowedChannelIds = [];
    denyAll.constraints.channel.allowedProviderModeIds = [];
    const sealed = seal(denyAll, contract);
    expect(validateProfile(sealed, trustedFor(sealed, contract)))
      .toBe('accepted_contract_profile_only_no_runtime_or_effect_authority');
  });

  test('denies wrong timezone malformed overlapping reordered and rerouting windows', () => {
    const contract = parse(CONTRACT_PATH);
    const profile = buildProfile();
    const trusted = trustedFor(profile, contract);
    for (const mutate of [
      value => { value.constraints.timeWindow.tenantTimeZone = 'UTC'; },
      value => { value.constraints.quietHour.tenantTimeZone = 'UTC'; },
    ]) {
      const attack = clone(profile); mutate(attack);
      expect(validateProfile(seal(attack, contract), trusted))
        .toBe('deny_identity_policy_source_or_authorization_mismatch');
    }
    for (const mutate of [
      value => { value.constraints.timeWindow.allowedWindows[0].startMinuteInclusive = -1; },
      value => { value.constraints.timeWindow.allowedWindows[0].endMinuteExclusive = 1441; },
      value => { value.constraints.timeWindow.allowedWindows[0].endMinuteExclusive = 480; },
      value => { value.constraints.timeWindow.allowedWindows = [
        { dayId: 1, startMinuteInclusive: 600, endMinuteExclusive: 800 },
        { dayId: 1, startMinuteInclusive: 700, endMinuteExclusive: 900 },
      ]; },
      value => { value.constraints.quietHour.quietWindows.reverse(); },
      value => { value.constraints.quietHour.quietTimeMayRerouteOrAuthorize = true; },
    ]) {
      const attack = clone(profile); mutate(attack);
      const sealed = seal(attack, contract);
      expect(validateProfile(sealed, trustedFor(sealed, contract)))
        .toBe('deny_owner_limit_weakens_mandatory_constraint');
    }
  });

  test('binds invoice value and aging stages only to internal reviewed collection', () => {
    const contract = parse(CONTRACT_PATH);
    const collection = buildProfile('collection_escalation');
    const attacks = [
      value => { value.constraints.invoiceValue.mode = 'not_applicable_no_financial_authority'; },
      value => { value.constraints.invoiceValue.currency = 'usd'; },
      value => { value.constraints.invoiceValue.maxMinorUnits = 10.5; },
      value => { value.constraints.invoiceValue.maxMinorUnits = -1; },
      value => { value.constraints.agingStage.allowedStageIds = ['unknown']; },
      value => { value.constraints.agingStage.allowedStageIds = ['overdue_31_60', 'overdue_1_30']; },
      value => { value.constraints.agingStage.allowedStageIds = ['overdue_1_30', 'overdue_1_30']; },
    ];
    for (const [attackIndex, mutate] of attacks.entries()) {
      const attack = clone(collection); mutate(attack);
      const sealed = seal(attack, contract);
      const expected = attackIndex === 2
        ? 'deny_missing_or_self_created_trusted_resolution'
        : 'deny_owner_limit_weakens_mandatory_constraint';
      expect({ attackIndex, verdict: validateProfile(sealed, trustedFor(sealed, contract)) })
        .toEqual({ attackIndex, verdict: expected });
    }
    const internal = buildProfile('internal_read_digest_task');
    internal.constraints.invoiceValue = {
      mode: 'exact_current_invoice_ceiling_internal_only', currency: 'USD', maxMinorUnits: 100,
    };
    const sealedInternal = seal(internal, contract);
    expect(validateProfile(sealedInternal, trustedFor(sealedInternal, contract)))
      .toBe('deny_owner_limit_weakens_mandatory_constraint');
  });

  test('denies campaign provider spend unavailable families and external effects absolutely', () => {
    const contract = parse(CONTRACT_PATH);
    const profile = buildProfile();
    for (const mutate of [
      value => { value.constraints.campaign.mode = 'enabled'; },
      value => { value.constraints.campaign.campaignId = 'campaign-1'; },
      value => { value.constraints.campaign.maxActions = 1; },
      value => { value.constraints.providerSpend.mode = 'provider_enabled'; },
      value => { value.constraints.providerSpend.currency = 'USD'; },
      value => { value.constraints.providerSpend.maxDailyMinorUnits = 1; },
      value => { value.constraints.providerSpend.maxWeeklyMinorUnits = 1; },
    ]) {
      const attack = clone(profile); mutate(attack);
      const sealed = seal(attack, contract);
      expect(validateProfile(sealed, trustedFor(sealed, contract)))
        .toBe('deny_unavailable_action_channel_recipient_provider_or_effect');
    }
    for (const actionFamilyId of [
      'customer_communication', 'secure_document_delivery', 'financial_reminder',
      'external_collection_escalation', 'unsupported_upstream_mutation_or_money_movement',
    ]) {
      const attack = clone(profile);
      attack.actionFamilyId = actionFamilyId;
      const sealed = seal(attack, contract);
      expect(validateProfile(sealed, trustedFor(sealed, contract)))
        .toBe('deny_unavailable_action_channel_recipient_provider_or_effect');
    }
  });

  test('denies cross-tenant policy source manifest timezone and standing-authorization substitution', () => {
    const contract = parse(CONTRACT_PATH);
    const profile = buildProfile();
    const trusted = trustedFor(profile, contract);
    for (const mutate of [
      value => { value.tenantId = '00000000-0000-4000-8000-000000000029'; value.policyBinding.tenantId = value.tenantId; },
      value => { value.policyBinding.policyId = '00000000-0000-4000-8000-000000000299'; },
      value => { value.policyBinding.policyVersion = 99; },
      value => { value.policyBinding.policyDigest = digestValue('f'); },
      value => { value.policyBinding.sourceSetDigest = digestValue('e'); },
      value => { value.policyBinding.currentnessMarker = 'captured_stale'; },
      value => { value.mandatoryConstraintManifestDigest = digestValue('f'); },
      value => { value.standingAuthorizationBinding.authorizationKind = 'per_run_approval'; },
      value => { value.standingAuthorizationBinding.standingIntent = 'approve_run'; },
      value => { value.standingAuthorizationBinding.authorizationId = '00000000-0000-4000-8000-000000000399'; },
      value => { value.standingAuthorizationBinding.expiresAt = '2026-10-28T09:00:00.000Z'; },
    ]) {
      const attack = clone(profile); mutate(attack);
      expect(validateProfile(seal(attack, contract), trusted))
        .not.toBe('accepted_contract_profile_only_no_runtime_or_effect_authority');
    }
    expect(validateProfile(profile, trustedFor(profile, contract, '2026-10-28T12:00:00.000Z')))
      .toBe('deny_identity_policy_source_or_authorization_mismatch');
    expect(validateProfile(profile, null)).toBe('deny_missing_or_self_created_trusted_resolution');
  });

  test('cross-binds the profile launch cell to the separately trusted policy action family', () => {
    const contract = parse(CONTRACT_PATH);
    const profile = buildProfile('internal_read_digest_task');
    const trusted = trustedFor(profile, contract);
    expect(contract.trustedResolutionContract.trustedPolicyBindingExactKeys)
      .toContain('actionFamilyId');
    expect(contract.trustedResolutionContract.policyActionFamilyMustEqualCandidateProfileActionFamily).toBe(true);
    const attack = clone(profile);
    attack.actionFamilyId = 'owner_approval_request';
    const sealed = seal(attack, contract);
    expect(validateProfile(sealed, trusted)).toBe('deny_identity_policy_source_or_authorization_mismatch');
    expect(validateProfile(sealed, trustedFor(sealed, contract)))
      .toBe('accepted_contract_profile_only_no_runtime_or_effect_authority');
  });

  test('requires real UTC instants and a real server-resolved IANA timezone', () => {
    const contract = parse(CONTRACT_PATH);
    const profile = buildProfile();
    const impossibleExpiry = clone(profile);
    impossibleExpiry.standingAuthorizationBinding.expiresAt = '2026-99-99T99:99:99.999Z';
    const sealedExpiry = seal(impossibleExpiry, contract);
    expect(validateProfile(sealedExpiry, trustedFor(sealedExpiry, contract)))
      .toBe('deny_identity_policy_source_or_authorization_mismatch');
    const invalidZone = clone(profile);
    invalidZone.constraints.timeWindow.tenantTimeZone = 'Not/A_Real_Zone';
    invalidZone.constraints.quietHour.tenantTimeZone = 'Not/A_Real_Zone';
    const sealedZone = seal(invalidZone, contract);
    expect(validateProfile(sealedZone, trustedFor(sealedZone, contract)))
      .toBe('deny_identity_policy_source_or_authorization_mismatch');
    const trusted = trustedFor(profile, contract);
    trusted.decisionAt = '2026-02-30T10:00:00.000Z';
    expect(validateProfile(profile, trusted)).toBe('deny_identity_policy_source_or_authorization_mismatch');
  });

  test('rejects an oversized otherwise bounded window profile before digest acceptance', () => {
    const contract = parse(CONTRACT_PATH);
    const profile = buildProfile();
    profile.constraints.timeWindow.allowedWindows = [];
    for (let dayId = 1; dayId <= 7; dayId += 1) {
      for (let minute = 0; minute < 1440; minute += 1) {
        profile.constraints.timeWindow.allowedWindows.push({
          dayId, startMinuteInclusive: minute, endMinuteExclusive: minute + 1,
        });
      }
    }
    const sealed = seal(profile, contract);
    expect(Buffer.byteLength(canonicalJson(sealed), 'utf8'))
      .toBeGreaterThan(contract.mandatoryConstraints.numericRules.maximumCanonicalInputBytes);
    expect(validateProfile(sealed, trustedFor(sealed, contract)))
      .toBe('deny_unknown_missing_duplicate_reordered_or_malformed_dimension');
  });

  test('denies every material leaf change after full candidate redigest against prior trusted policy', () => {
    const contract = parse(CONTRACT_PATH);
    const profile = buildProfile('collection_escalation');
    const trusted = trustedFor(profile, contract);
    const paths = leafPaths(Object.fromEntries(Object.entries(profile).filter(([key]) => key !== 'profileDigest')));
    expect(paths.length).toBeGreaterThan(70);
    for (const parts of paths) {
      const attack = clone(profile);
      setAt(attack, parts, changedValue(valueAt(attack, parts)));
      expect(validateProfile(seal(attack, contract), trusted))
        .not.toBe('accepted_contract_profile_only_no_runtime_or_effect_authority');
    }
  });

  test('rejects non-plain accessors symbols toJSON proxies sparse arrays and extra keys before trust', () => {
    const contract = parse(CONTRACT_PATH);
    const profile = buildProfile();
    const trusted = trustedFor(profile, contract);
    let getterCalls = 0;
    const accessor = clone(profile);
    Object.defineProperty(accessor.constraints.frequency, 'minimumIntervalSeconds', {
      enumerable: true, configurable: true, get() { getterCalls += 1; return 60; },
    });
    expect(validateProfile(accessor, trusted)).toBe('deny_missing_or_self_created_trusted_resolution');
    expect(getterCalls).toBe(0);
    const symbol = clone(profile);
    symbol.constraints[Symbol('secret')] = 'provider-token';
    expect(validateProfile(symbol, trusted)).toBe('deny_missing_or_self_created_trusted_resolution');
    const toJSON = clone(profile);
    toJSON.constraints.toJSON = () => profile.constraints;
    expect(validateProfile(toJSON, trusted)).toBe('deny_missing_or_self_created_trusted_resolution');
    let traps = 0;
    const proxy = new Proxy(clone(profile), { get(target, key, receiver) { traps += 1; return Reflect.get(target, key, receiver); } });
    expect(validateProfile(proxy, trusted)).toBe('deny_missing_or_self_created_trusted_resolution');
    expect(traps).toBe(0);
    const sparse = clone(profile);
    sparse.dimensionOrder = new Array(contract.dimensionOrder.length);
    expect(validateProfile(sparse, trusted)).toBe('deny_missing_or_self_created_trusted_resolution');
    const extra = clone(profile);
    extra.constraints.providerSpend.secret = 'provider-token';
    expect(validateProfile(extra, trusted)).toBe('deny_unknown_missing_duplicate_reordered_or_malformed_dimension');
  });

  test('accepts only exact idempotent replay and denies conflicting replay', () => {
    const contract = parse(CONTRACT_PATH);
    const profile = buildProfile();
    const trusted = trustedFor(profile, contract);
    expect(validateReplay(profile, clone(profile), trusted)).toBe('idempotent_exact_replay_no_new_authority');
    const changed = clone(profile);
    changed.constraints.frequency.maxPerRecipientRollingDay = 2;
    expect(validateReplay(profile, seal(changed, contract), trusted)).toBe('deny_digest_or_replay_conflict');
  });

  test('roadmap and ledger record Part 3C released and only Part 3D current', () => {
    const roadmap = read(ROADMAP_PATH);
    const ledger = read(LEDGER_PATH);
    for (const document of [roadmap, ledger]) {
      expect(document).toContain('Parts 1A–9C are released. Part 9D is the sole implementation candidate.');
      expect(document).toContain('56a39854325826982283d78dffed4e039c61335b');
      expect(document).toContain('d88a0fe294619fa982bc1541affc8052031cc406');
      expect(document).toContain('81bc25de-eb77-413e-8745-97882bdd7c09');
      expect(document).toContain('96720a1fc1c5379d53992081046540f28ddf1c42307cb34f0b824fe737ef8974');
      expect(document).toContain('3cd41fe5379d92fe629c62e0ebc3a51d8886c3cc');
      expect(document).toContain('d227c50f73e3fb9fc89ee48332a9eda57d1c8713');
      expect(document).toContain('b745a483-1031-4020-9ab2-38c0044e599d');
      expect(document).toContain('27c84d6cd34be043aa2f6388080c90b5500a8ea1d87ab018c9d58f34277e5590');
      expect(document).toContain('Part 3C');
    }
    expect(ledger).toContain('| 10 | 3B | Per-run approval versus standing authorization | **Released** |');
    expect(ledger).toContain('| 11 | 3C | Owner limits and mandatory minimum constraints | **Released** |');
    expect(ledger).toContain('| 12 | 3D | Pause/revoke/kill/drain/cancel/resume and governance boundary | **Released** |');
    expect(ledger).toContain('| 13 | 4A | Closed trigger catalog over accepted Missions 20–27 facts | **Released** |');
    expect(ledger).toContain('| 14 | 4B | Durable tenant-scoped source snapshot and correction lineage | **Released** |');
    expect(ledger).toContain('| 15 | 4C | Evaluation-time and pre-effect currentness revalidation | **Released** |');
    expect(roadmap).toContain('Released Part 3C artifacts');
    expect(roadmap).toContain('Released Part 3D artifacts');
    expect(roadmap).toContain('Released Part 4C artifacts');
    expect(roadmap).toContain('Released Part 4D artifacts');
    expect(roadmap).toContain('Released Part 5A artifacts');
    expect(roadmap).toContain('Released Part 5D artifacts');
    expect(ledger).toContain('independent audit/PR/merge/deployment unavailable');
  });

  test('keeps runtime database provider effect and migration boundaries unavailable', () => {
    const contract = parse(CONTRACT_PATH);
    expect(contract.runtimeBoundary).toEqual({
      contractIsExecutableRuntime: false, limitResolverOrPersistenceAvailable: false,
      routeUiOrDatabaseAvailable: false, schedulerWorkerQueueOrProviderAvailable: false,
      recipientMessageOrExternalEffectAvailable: false, migrationAdded: false,
      laterSlicesMayConsumeOnlyAfterIndependentAcceptance: true,
      acceptedDecisionMeaning: 'accepted_contract_profile_only_no_runtime_or_effect_authority',
    });
    expect(contract.unavailableEvidence).toHaveLength(7);
    const migrationNames = fs.readdirSync(path.join(ROOT, 'migrations'));
    expect(migrationNames).toHaveLength(283);
    expect(Math.max(...migrationNames.map(name => Number(name.match(/^(\d+)/)?.[1] || 0)))).toBe(287);
    expect(migrationNames.filter(name => /^282/.test(name))).toEqual(['282_canonical_automation_communication_permission_v1.sql']);
    expect(migrationNames.some(name => name.startsWith('288_'))).toBe(false);
    expect(migrationNames.filter(name => /^274/.test(name))).toEqual(['274_canonical_automation_trigger_snapshots_v1.sql']);
    expect(migrationNames.filter(name => /^275/.test(name))).toEqual(['275_canonical_automation_transactional_outbox_v1.sql']);
    expect(migrationNames.filter(name => /^276/.test(name))).toEqual(['276_canonical_automation_durable_scheduler_v1.sql']);
    expect(migrationNames.filter(name => /^277/.test(name))).toEqual(['277_canonical_automation_delivery_coordination_v1.sql']);
    expect(migrationNames.filter(name => /^278/.test(name))).toEqual(['278_canonical_automation_retry_reconciliation_v1.sql']);
    expect(migrationNames.filter(name => /^279/.test(name))).toEqual(['279_canonical_automation_delivery_controls_v1.sql']);
    expect(read(NARRATIVE_PATH)).toContain('This is a source contract, not a runtime limit resolver or authority grant.');
  });
});
