'use strict';

const fs = require('node:fs');
const path = require('node:path');
const util = require('node:util');
const canonical = require('../../src/automation/canonicalJson');

const ROOT = path.resolve(__dirname, '../..');
const CONTRACT_PATH = 'docs/architecture/MISSION_28_PART4C_CURRENTNESS_REVALIDATION_CONTRACT.json';
const CONTRACT = JSON.parse(fs.readFileSync(path.join(ROOT, CONTRACT_PATH), 'utf8'));
const TENANT = '00000000-0000-4000-8000-000000000028';
const OTHER_TENANT = '00000000-0000-4000-8000-000000000029';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const UTC = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;
const copy = value => JSON.parse(JSON.stringify(value));
const seal = (namespace, value) => canonical.digest(namespace, value);

function ownPlain(value, label = 'value') {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return;
  if (typeof value !== 'object' || util.types.isProxy(value)) throw new Error(`${label} plain data`);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1) {
      throw new Error(`${label} dense array`);
    }
    value.forEach((member, index) => ownPlain(member, `${label}[${index}]`));
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
    ownPlain(descriptor.value, `${label}.${key}`);
  }
}

function exact(value, keys, label) {
  ownPlain(value, label);
  if (!value || Array.isArray(value) || JSON.stringify(Object.keys(value)) !== JSON.stringify(keys)) {
    throw new Error(`${label} shape`);
  }
}

function binding(namespaceKey, value, digestField = 'bindingDigest') {
  const result = copy(value);
  delete result[digestField];
  result[digestField] = seal(CONTRACT.revalidationEnvelope.bindingDigestNamespaces[namespaceKey], result);
  return result;
}

function materialOf(value) {
  const semantic = (bindingValue, digestField = 'bindingDigest') => {
    const result = copy(bindingValue);
    delete result.resolutionEpochId;
    delete result[digestField];
    return result;
  };
  const authorizationBinding = semantic(value.authorizationBinding, 'materialBindingDigest');
  return {
    tenantId: value.tenantId,
    decisionId: value.decisionId,
    actionFamily: value.actionFamily,
    actionSubjectBinding: value.actionSubjectBinding,
    policyBinding: semantic(value.policyBinding),
    sourceBindings: value.sourceBindings.map(source => semantic(source)),
    recipientBinding: semantic(value.recipientBinding),
    consentBinding: semantic(value.consentBinding),
    channelBinding: semantic(value.channelBinding),
    limitBinding: semantic(value.limitBinding),
    priorEffectsBinding: semantic(value.priorEffectsBinding),
    suppressionBinding: semantic(value.suppressionBinding),
    authorizationBinding,
    governanceBinding: semantic(value.governanceBinding, 'unusedDerivedDigest'),
  };
}

function finish(value) {
  value.materialBindingDigest = seal(CONTRACT.revalidationEnvelope.materialDigestNamespace, materialOf(value));
  value.authorizationBinding.materialBindingDigest = value.materialBindingDigest;
  const base = copy(value);
  delete base.revalidationDigest;
  value.revalidationDigest = seal(CONTRACT.revalidationEnvelope.revalidationDigestNamespace, base);
  return value;
}

function resealBindings(value) {
  value.actionSubjectBinding = binding('actionSubjectBinding', value.actionSubjectBinding, 'actionSubjectDigest');
  value.resolutionEpoch = binding('resolutionEpoch', value.resolutionEpoch, 'resolutionDigest');
  value.policyBinding = binding('policyBinding', value.policyBinding);
  value.sourceBindings = value.sourceBindings.map(source => binding('sourceBinding', source));
  value.recipientBinding = binding('recipientBinding', value.recipientBinding);
  value.consentBinding = binding('consentBinding', value.consentBinding);
  value.channelBinding = binding('channelBinding', value.channelBinding);
  value.limitBinding = binding('limitBinding', value.limitBinding);
  value.priorEffectsBinding = binding('priorEffectsBinding', value.priorEffectsBinding);
  value.suppressionBinding = binding('suppressionBinding', value.suppressionBinding);
  return value;
}

function epoch(stage) {
  const result = {
    tenantId: TENANT,
    epochId: stage === 'evaluation_time'
      ? '00000000-0000-4000-8000-000000000901'
      : '00000000-0000-4000-8000-000000000902',
    resolvedAt: stage === 'evaluation_time' ? '2026-10-27T23:00:00.000Z' : '2026-10-27T23:00:01.000Z',
    trustedClockContract: 'postgresql_statement_timestamp_v1',
    resolutionDigest: '',
  };
  return binding('resolutionEpoch', result, 'resolutionDigest');
}

function evaluation() {
  const value = {
    schemaVersion: 'mission28.currentness-revalidation.v1',
    tenantId: TENANT,
    revalidationId: '00000000-0000-4000-8000-000000000501',
    stage: 'evaluation_time',
    decisionId: '00000000-0000-4000-8000-000000000601',
    actionFamily: 'internal_read_digest_task',
    actionSubjectBinding: binding('actionSubjectBinding', {
      tenantId: TENANT, runId: '00000000-0000-4000-8000-000000000701',
      proposedActionRecordId: '00000000-0000-4000-8000-000000000801',
      proposedActionRecordDigest: `sha256:${'1'.repeat(64)}`, idempotencyKey: 'm28-p4c-idem-1', actionSubjectDigest: '',
    }, 'actionSubjectDigest'),
    resolutionEpoch: epoch('evaluation_time'),
    policyBinding: binding('policyBinding', {
      tenantId: TENANT, resolutionEpochId: '00000000-0000-4000-8000-000000000901',
      policyId: '00000000-0000-4000-8000-000000000101', policyVersion: 1,
      policyDigest: `sha256:${'2'.repeat(64)}`, lifecycleEventId: '00000000-0000-4000-8000-000000000201',
      lifecycleEventDigest: `sha256:${'3'.repeat(64)}`, lifecycleState: 'active',
      currentnessState: 'active_exact_current', bindingDigest: '',
    }),
    sourceBindings: [binding('sourceBinding', {
      tenantId: TENANT, resolutionEpochId: '00000000-0000-4000-8000-000000000901',
      snapshotId: '00000000-0000-4000-8000-000000000301',
      snapshotDigest: `sha256:${'4'.repeat(64)}`, triggerId: 'm20.lead_contact_state',
      recordIdentityDigest: `sha256:${'5'.repeat(64)}`, eventKind: 'transcript_occurred',
      currentnessPinsDigest: `sha256:${'6'.repeat(64)}`, lineageSequence: 1,
      currentnessState: 'latest_exact_current', bindingDigest: '',
    })],
    recipientBinding: binding('recipientBinding', {
      tenantId: TENANT, resolutionEpochId: '00000000-0000-4000-8000-000000000901',
      recipientClass: 'tenant_owner', recipientId: '00000000-0000-4000-8000-000000000128',
      membershipSubjectId: '00000000-0000-4000-8000-000000000128', state: 'internal_exact_current', bindingDigest: '',
    }),
    consentBinding: binding('consentBinding', {
      tenantId: TENANT, resolutionEpochId: '00000000-0000-4000-8000-000000000901',
      basis: 'authenticated_tenant_membership_and_exact_capability',
      evidenceId: '00000000-0000-4000-8000-000000000128', state: 'internal_membership_only', bindingDigest: '',
    }),
    channelBinding: binding('channelBinding', {
      tenantId: TENANT, resolutionEpochId: '00000000-0000-4000-8000-000000000901',
      channel: 'in_app_passive', providerMode: 'none_internal',
      availability: 'in_app_passive_available', revision: 1, bindingDigest: '',
    }),
    limitBinding: binding('limitBinding', {
      tenantId: TENANT, resolutionEpochId: '00000000-0000-4000-8000-000000000901',
      limitProfileDigest: `sha256:${'7'.repeat(64)}`,
      usageSnapshotId: '00000000-0000-4000-8000-000000000401', usageDigest: `sha256:${'8'.repeat(64)}`,
      state: 'exact_current_within_limits', bindingDigest: '',
    }),
    priorEffectsBinding: binding('priorEffectsBinding', {
      tenantId: TENANT, resolutionEpochId: '00000000-0000-4000-8000-000000000901',
      ledgerHighWatermark: 0, idempotencyKeyAvailable: true, effectCount: 0,
      uncertainCount: 0, state: 'exact_current_no_collision_or_uncertainty', bindingDigest: '',
    }),
    suppressionBinding: binding('suppressionBinding', {
      tenantId: TENANT, resolutionEpochId: '00000000-0000-4000-8000-000000000901',
      snapshotId: '00000000-0000-4000-8000-000000000402',
      snapshotDigest: `sha256:${'9'.repeat(64)}`, state: 'exact_current_clear', bindingDigest: '',
    }),
    authorizationBinding: {
      tenantId: TENANT, resolutionEpochId: '00000000-0000-4000-8000-000000000901',
      authorizationId: '00000000-0000-4000-8000-000000000403',
      authorizationKind: 'fixed_internal_capability', authorizationDigest: `sha256:${'a'.repeat(64)}`,
      materialBindingDigest: '', expiresAt: '2026-10-27T23:05:00.000Z', state: 'exact_current_unexpired',
    },
    governanceBinding: {
      tenantId: TENANT, resolutionEpochId: '00000000-0000-4000-8000-000000000901',
      tenantStopState: 'normal', policyControlState: 'active',
      governanceDigest: `sha256:${'b'.repeat(64)}`, state: 'exact_current_allowing_internal_decision',
    },
    evaluationBinding: { evaluationRevalidationId: null, evaluationRevalidationDigest: null,
      evaluationMaterialBindingDigest: null },
    materialBindingDigest: '', decisionState: 'current_contract_only_no_effect_authority', revalidationDigest: '',
  };
  return finish(value);
}

function preEffect(prior = evaluation()) {
  const value = copy(prior);
  value.revalidationId = '00000000-0000-4000-8000-000000000502';
  value.stage = 'immediately_pre_effect';
  value.resolutionEpoch = epoch('immediately_pre_effect');
  for (const dimension of [value.policyBinding, ...value.sourceBindings, value.recipientBinding,
    value.consentBinding, value.channelBinding, value.limitBinding, value.priorEffectsBinding,
    value.suppressionBinding, value.authorizationBinding, value.governanceBinding]) {
    dimension.resolutionEpochId = value.resolutionEpoch.epochId;
  }
  resealBindings(value);
  value.evaluationBinding = { evaluationRevalidationId: prior.revalidationId,
    evaluationRevalidationDigest: prior.revalidationDigest, evaluationMaterialBindingDigest: prior.materialBindingDigest };
  return finish(value);
}

function trustedFrom(value) {
  const trusted = copy(value);
  delete trusted.schemaVersion;
  delete trusted.decisionState;
  delete trusted.revalidationDigest;
  return { ...trusted, expectedRevalidationDigest: value.revalidationDigest };
}

function validateBinding(value, keys, namespaceKey, digestField = 'bindingDigest') {
  exact(value, keys, namespaceKey);
  const base = copy(value);
  const supplied = base[digestField];
  delete base[digestField];
  if (!DIGEST.test(supplied) || supplied !== seal(CONTRACT.revalidationEnvelope.bindingDigestNamespaces[namespaceKey], base)) {
    throw new Error(`${namespaceKey} digest`);
  }
}

function validate(candidate, trusted, trustedEvaluation = null) {
  ownPlain(candidate, 'candidate');
  ownPlain(trusted, 'trusted');
  exact(candidate, CONTRACT.revalidationEnvelope.exactTopLevelFields, 'candidate');
  if (candidate.schemaVersion !== CONTRACT.revalidationEnvelope.schemaVersion ||
      !UUID.test(candidate.tenantId) || !UUID.test(candidate.revalidationId) || !UUID.test(candidate.decisionId) ||
      !CONTRACT.stageOrder.includes(candidate.stage) ||
      !CONTRACT.actionFamilyAdmission.contractEligibleInternalFamilies.includes(candidate.actionFamily) ||
      candidate.decisionState !== 'current_contract_only_no_effect_authority') throw new Error('top-level authority');

  validateBinding(candidate.actionSubjectBinding, CONTRACT.revalidationEnvelope.actionSubjectBindingExactFields,
    'actionSubjectBinding', 'actionSubjectDigest');
  validateBinding(candidate.resolutionEpoch, CONTRACT.revalidationEnvelope.resolutionEpochExactFields,
    'resolutionEpoch', 'resolutionDigest');
  validateBinding(candidate.policyBinding, CONTRACT.revalidationEnvelope.policyBindingExactFields, 'policyBinding');
  if (!Array.isArray(candidate.sourceBindings) || candidate.sourceBindings.length !== 1) throw new Error('source count');
  validateBinding(candidate.sourceBindings[0], CONTRACT.revalidationEnvelope.sourceBindingExactFields, 'sourceBinding');
  validateBinding(candidate.recipientBinding, CONTRACT.revalidationEnvelope.recipientBindingExactFields, 'recipientBinding');
  validateBinding(candidate.consentBinding, CONTRACT.revalidationEnvelope.consentBindingExactFields, 'consentBinding');
  validateBinding(candidate.channelBinding, CONTRACT.revalidationEnvelope.channelBindingExactFields, 'channelBinding');
  validateBinding(candidate.limitBinding, CONTRACT.revalidationEnvelope.limitBindingExactFields, 'limitBinding');
  validateBinding(candidate.priorEffectsBinding, CONTRACT.revalidationEnvelope.priorEffectsBindingExactFields, 'priorEffectsBinding');
  validateBinding(candidate.suppressionBinding, CONTRACT.revalidationEnvelope.suppressionBindingExactFields, 'suppressionBinding');
  exact(candidate.authorizationBinding, CONTRACT.revalidationEnvelope.authorizationBindingExactFields, 'authorizationBinding');
  exact(candidate.governanceBinding, CONTRACT.revalidationEnvelope.governanceBindingExactFields, 'governanceBinding');
  exact(candidate.evaluationBinding, CONTRACT.revalidationEnvelope.evaluationBindingExactFields, 'evaluationBinding');

  const tenantBindings = [candidate.actionSubjectBinding, candidate.resolutionEpoch, candidate.policyBinding,
    ...candidate.sourceBindings, candidate.recipientBinding, candidate.consentBinding, candidate.channelBinding,
    candidate.limitBinding, candidate.priorEffectsBinding, candidate.suppressionBinding, candidate.authorizationBinding,
    candidate.governanceBinding];
  if (tenantBindings.some(bindingValue => bindingValue.tenantId !== candidate.tenantId)) throw new Error('tenant coherence');
  const epochBindings = [candidate.policyBinding, ...candidate.sourceBindings, candidate.recipientBinding,
    candidate.consentBinding, candidate.channelBinding, candidate.limitBinding, candidate.priorEffectsBinding,
    candidate.suppressionBinding, candidate.authorizationBinding, candidate.governanceBinding];
  if (epochBindings.some(bindingValue => bindingValue.resolutionEpochId !== candidate.resolutionEpoch.epochId)) {
    throw new Error('resolution epoch coherence');
  }
  if (!UUID.test(candidate.actionSubjectBinding.runId) || !UUID.test(candidate.actionSubjectBinding.proposedActionRecordId) ||
      !DIGEST.test(candidate.actionSubjectBinding.proposedActionRecordDigest) ||
      typeof candidate.actionSubjectBinding.idempotencyKey !== 'string' || candidate.actionSubjectBinding.idempotencyKey.trim() === '' ||
      !UUID.test(candidate.resolutionEpoch.epochId) || !UTC.test(candidate.resolutionEpoch.resolvedAt) ||
      candidate.resolutionEpoch.trustedClockContract !== 'postgresql_statement_timestamp_v1' ||
      !UUID.test(candidate.policyBinding.policyId) || !Number.isInteger(candidate.policyBinding.policyVersion) || candidate.policyBinding.policyVersion < 1 ||
      !DIGEST.test(candidate.policyBinding.policyDigest) || !UUID.test(candidate.policyBinding.lifecycleEventId) ||
      !DIGEST.test(candidate.policyBinding.lifecycleEventDigest) ||
      candidate.policyBinding.lifecycleState !== 'active' || candidate.policyBinding.currentnessState !== 'active_exact_current' ||
      !UUID.test(candidate.sourceBindings[0].snapshotId) || !DIGEST.test(candidate.sourceBindings[0].snapshotDigest) ||
      typeof candidate.sourceBindings[0].triggerId !== 'string' || candidate.sourceBindings[0].triggerId.trim() === '' ||
      typeof candidate.sourceBindings[0].eventKind !== 'string' || candidate.sourceBindings[0].eventKind.trim() === '' ||
      !DIGEST.test(candidate.sourceBindings[0].recordIdentityDigest) || !DIGEST.test(candidate.sourceBindings[0].currentnessPinsDigest) ||
      candidate.sourceBindings[0].currentnessState !== 'latest_exact_current' ||
      !Number.isInteger(candidate.sourceBindings[0].lineageSequence) || candidate.sourceBindings[0].lineageSequence < 1 ||
      !UUID.test(candidate.recipientBinding.recipientId) || !UUID.test(candidate.recipientBinding.membershipSubjectId) ||
      candidate.recipientBinding.recipientId !== candidate.recipientBinding.membershipSubjectId ||
      !CONTRACT.actionFamilyAdmission.recipientClassesByActionFamily[candidate.actionFamily].includes(candidate.recipientBinding.recipientClass) ||
      candidate.recipientBinding.state !== 'internal_exact_current' ||
      candidate.consentBinding.basis !== 'authenticated_tenant_membership_and_exact_capability' ||
      !UUID.test(candidate.consentBinding.evidenceId) || candidate.consentBinding.evidenceId !== candidate.recipientBinding.membershipSubjectId ||
      candidate.consentBinding.state !== 'internal_membership_only' || candidate.channelBinding.channel !== 'in_app_passive' ||
      candidate.channelBinding.providerMode !== 'none_internal' || candidate.channelBinding.availability !== 'in_app_passive_available' ||
      !Number.isInteger(candidate.channelBinding.revision) || candidate.channelBinding.revision < 1 ||
      !DIGEST.test(candidate.limitBinding.limitProfileDigest) || !UUID.test(candidate.limitBinding.usageSnapshotId) ||
      !DIGEST.test(candidate.limitBinding.usageDigest) ||
      candidate.limitBinding.state !== 'exact_current_within_limits' ||
      !Number.isSafeInteger(candidate.priorEffectsBinding.ledgerHighWatermark) || candidate.priorEffectsBinding.ledgerHighWatermark < 0 ||
      candidate.priorEffectsBinding.state !== 'exact_current_no_collision_or_uncertainty' ||
      candidate.priorEffectsBinding.idempotencyKeyAvailable !== true ||
      !Number.isSafeInteger(candidate.priorEffectsBinding.effectCount) || candidate.priorEffectsBinding.effectCount !== 0 ||
      !Number.isSafeInteger(candidate.priorEffectsBinding.uncertainCount) || candidate.priorEffectsBinding.uncertainCount !== 0 ||
      !UUID.test(candidate.suppressionBinding.snapshotId) ||
      !DIGEST.test(candidate.suppressionBinding.snapshotDigest) || candidate.suppressionBinding.state !== 'exact_current_clear' ||
      !UUID.test(candidate.authorizationBinding.authorizationId) || !DIGEST.test(candidate.authorizationBinding.authorizationDigest) ||
      candidate.authorizationBinding.authorizationKind !== 'fixed_internal_capability' ||
      !UTC.test(candidate.authorizationBinding.expiresAt) ||
      candidate.authorizationBinding.state !== 'exact_current_unexpired' ||
      candidate.authorizationBinding.materialBindingDigest !== candidate.materialBindingDigest ||
      candidate.governanceBinding.tenantStopState !== 'normal' || candidate.governanceBinding.policyControlState !== 'active' ||
      !DIGEST.test(candidate.governanceBinding.governanceDigest) ||
      candidate.governanceBinding.state !== 'exact_current_allowing_internal_decision') throw new Error('coherent current state');

  if (Date.parse(candidate.authorizationBinding.expiresAt) <= Date.parse(candidate.resolutionEpoch.resolvedAt)) {
    throw new Error('authorization time');
  }

  const expectedMaterial = seal(CONTRACT.revalidationEnvelope.materialDigestNamespace, materialOf(candidate));
  if (candidate.materialBindingDigest !== expectedMaterial) throw new Error('material digest');
  const digestBase = copy(candidate); delete digestBase.revalidationDigest;
  if (candidate.revalidationDigest !== seal(CONTRACT.revalidationEnvelope.revalidationDigestNamespace, digestBase)) {
    throw new Error('revalidation digest');
  }
  const resolved = copy(candidate); delete resolved.schemaVersion; delete resolved.decisionState; delete resolved.revalidationDigest;
  const trustedBase = copy(trusted); const expectedDigest = trustedBase.expectedRevalidationDigest; delete trustedBase.expectedRevalidationDigest;
  if (canonical.canonicalize(resolved) !== canonical.canonicalize(trustedBase) || expectedDigest !== candidate.revalidationDigest) {
    throw new Error('trusted resolution mismatch');
  }

  if (candidate.stage === 'evaluation_time') {
    if (Object.values(candidate.evaluationBinding).some(value => value !== null) || trustedEvaluation !== null) {
      throw new Error('evaluation binding');
    }
  } else {
    if (!trustedEvaluation) throw new Error('pre-effect binding');
    if (candidate.evaluationBinding.evaluationRevalidationId !== trustedEvaluation.revalidationId ||
        candidate.evaluationBinding.evaluationRevalidationDigest !== trustedEvaluation.revalidationDigest ||
        candidate.evaluationBinding.evaluationMaterialBindingDigest !== trustedEvaluation.materialBindingDigest ||
        candidate.materialBindingDigest !== trustedEvaluation.materialBindingDigest ||
        candidate.resolutionEpoch.epochId === trustedEvaluation.resolutionEpoch.epochId ||
        Date.parse(candidate.resolutionEpoch.resolvedAt) <= Date.parse(trustedEvaluation.resolutionEpoch.resolvedAt)) {
      throw new Error('pre-effect binding');
    }
  }
  return true;
}

describe('Mission 28 Part 4C coherent currentness revalidation', () => {
  test('binds exact released inputs and keeps the slice contract-only with no effect authority', () => {
    expect(CONTRACT.authority).toMatchObject({ mission: 28, part: '4C', state: 'implementation_candidate_only',
      baselineCommit: '3a906372cc41f9167eb6bf40c0e8cfe111be5dd2',
      baselineTree: '621787f4d2d2e19b4f8b76b2c2b352133a108fac',
      contractOnlyNoRuntimeResolverMounted: true, preEffectReceiptGrantsEffectAuthority: false });
    expect(CONTRACT.part4BRelease).toMatchObject({ acceptedSourceHead: '032377507ca73e9c7f332d257751679e1295c944',
      pullRequest: 562, mergedMain: '3a906372cc41f9167eb6bf40c0e8cfe111be5dd2',
      deployment: '379268a5-0ab4-4bab-8e5d-df50b24f5f9e', deploymentState: 'SUCCESS_RUNNING' });
    for (const input of CONTRACT.frozenInputs) {
      const content = fs.readFileSync(path.join(ROOT, input.path), 'utf8').replace(/\r\n/g, '\n');
      expect(require('node:crypto').createHash('sha256').update(content).digest('hex').toUpperCase()).toBe(input.normalizedLfSha256);
    }
    expect(CONTRACT.raceClosureContract).toMatchObject({ effectExecutorMustRevalidateAndClaimWithinSameDatabaseTransaction: true,
      requiredLocksRemainHeldUntilFutureEffectClaimCommitsOrRollsBack: true,
      preEffectReceiptMayNotBeCachedReplayedOrUsedAsBearerAuthority: true,
      currentRuntimeEffectExecutorAvailable: false, currentFailClosedOutcome: 'no_effect_can_be_claimed_or_executed' });
    expect(CONTRACT.revalidationEnvelope.materialDigestProjection)
      .toBe('semantic_material_fields_with_resolutionEpochId_and_derived_binding_digests_omitted_and_authorizationBinding.materialBindingDigest_omitted_to_avoid_self_reference');
    expect(CONTRACT.trustedResolutionContract).toMatchObject({
      candidateMayNotSupplyReplaceOrRetargetTrustedResolution: true,
      candidateDigestsNeverCreateAuthority: true,
      evaluationReceiptMustResolveToExactStoredMaterialDigest: true,
      currentRuntimeResolverAvailable: false,
    });
  });

  test('accepts one exact evaluation and one fresh unchanged pre-effect resolution as evidence only', () => {
    const first = evaluation();
    expect(validate(first, trustedFrom(first))).toBe(true);
    const second = preEffect(first);
    expect(validate(second, trustedFrom(second), first)).toBe(true);
    expect(second.decisionState).toBe('current_contract_only_no_effect_authority');
  });

  test.each([
    ['policy stale', value => { value.policyBinding.currentnessState = 'stale'; }],
    ['policy paused', value => { value.policyBinding.lifecycleState = 'paused'; }],
    ['source corrected', value => { value.sourceBindings[0].currentnessState = 'superseded_by_correction'; }],
    ['recipient unavailable', value => { value.recipientBinding.state = 'unavailable'; }],
    ['external consent claim', value => { value.consentBinding.basis = 'customer_consent_inferred'; }],
    ['email fallback', value => { value.channelBinding.channel = 'email'; value.channelBinding.providerMode = 'live'; }],
    ['limit exceeded', value => { value.limitBinding.state = 'over_limit'; }],
    ['prior collision', value => { value.priorEffectsBinding.effectCount = 1; }],
    ['uncertain prior effect', value => { value.priorEffectsBinding.uncertainCount = 1; }],
    ['suppressed', value => { value.suppressionBinding.state = 'opted_out'; }],
    ['expired authorization', value => { value.authorizationBinding.state = 'expired'; }],
    ['tenant killed', value => { value.governanceBinding.tenantStopState = 'killed'; }],
  ])('rejects a freshly redigested but non-current %s dimension', (_name, mutate) => {
    const candidate = evaluation();
    mutate(candidate);
    resealBindings(candidate);
    finish(candidate);
    expect(() => validate(candidate, trustedFrom(candidate))).toThrow();
  });

  test('rejects coherent candidate retargeting against a separately trusted resolution', () => {
    const canonicalEvaluation = evaluation();
    const trusted = trustedFrom(canonicalEvaluation);
    const attacks = [
      value => { value.tenantId = OTHER_TENANT; },
      value => { value.actionSubjectBinding.runId = '00000000-0000-4000-8000-000000000702'; },
      value => { value.policyBinding.policyDigest = `sha256:${'c'.repeat(64)}`; },
      value => { value.sourceBindings[0].snapshotDigest = `sha256:${'d'.repeat(64)}`; },
      value => { value.recipientBinding.recipientId = '00000000-0000-4000-8000-000000000129'; },
      value => { value.authorizationBinding.authorizationDigest = `sha256:${'e'.repeat(64)}`; },
      value => {
        value.tenantId = OTHER_TENANT;
        for (const bound of [value.actionSubjectBinding, value.resolutionEpoch, value.policyBinding,
          ...value.sourceBindings, value.recipientBinding, value.consentBinding, value.channelBinding,
          value.limitBinding, value.priorEffectsBinding, value.suppressionBinding,
          value.authorizationBinding, value.governanceBinding]) bound.tenantId = OTHER_TENANT;
      },
    ];
    for (const mutate of attacks) {
      const candidate = copy(canonicalEvaluation);
      mutate(candidate);
      resealBindings(candidate);
      expect(() => validate(finish(candidate), trusted)).toThrow(/trusted|tenant|digest|coherent/);
    }
  });

  test('rejects mixed evaluation/pre-effect epochs, material changes and receipt replay', () => {
    const first = evaluation();
    const canonicalPreEffect = preEffect(first);
    const attacks = [
      value => { value.resolutionEpoch = copy(first.resolutionEpoch); },
      value => { value.sourceBindings[0].resolutionEpochId = first.resolutionEpoch.epochId; },
      value => { value.evaluationBinding.evaluationRevalidationDigest = `sha256:${'f'.repeat(64)}`; },
      value => { value.sourceBindings[0].snapshotId = '00000000-0000-4000-8000-000000000302'; },
      value => { value.suppressionBinding.snapshotDigest = `sha256:${'0'.repeat(64)}`; },
      value => { value.stage = 'evaluation_time'; },
    ];
    for (const mutate of attacks) {
      const candidate = copy(canonicalPreEffect);
      mutate(candidate);
      resealBindings(candidate);
      finish(candidate);
      expect(() => validate(candidate, trustedFrom(candidate), first)).toThrow();
    }
    expect(() => validate(canonicalPreEffect, trustedFrom(canonicalPreEffect), preEffect(first))).toThrow();
  });

  test('rejects unknown external or money families and malformed structural input before authority', () => {
    for (const actionFamily of ['customer_communication', 'secure_document_delivery', 'financial_reminder',
      'unsupported_upstream_mutation_or_money_movement', 'invented']) {
      const candidate = evaluation(); candidate.actionFamily = actionFamily; finish(candidate);
      expect(() => validate(candidate, trustedFrom(candidate))).toThrow(/top-level authority/);
    }
    const extra = evaluation(); extra.providerAttempt = { success: true };
    expect(() => validate(extra, trustedFrom(extra))).toThrow(/shape/);
    const sparse = evaluation(); sparse.sourceBindings.length = 2;
    expect(() => validate(sparse, trustedFrom(sparse))).toThrow(/dense array/);
    const getter = evaluation(); let calls = 0;
    Object.defineProperty(getter.policyBinding, 'policyDigest', { enumerable: true, get() { calls += 1; return `sha256:${'2'.repeat(64)}`; } });
    expect(() => validate(getter, trustedFrom(evaluation()))).toThrow(/descriptor/);
    expect(calls).toBe(0);
  });

  test('enforces exact first-launch internal recipient classes and subject binding', () => {
    for (const actionFamily of ['owner_approval_request', 'collection_escalation']) {
      const valid = evaluation(); valid.actionFamily = actionFamily; resealBindings(valid); finish(valid);
      expect(validate(valid, trustedFrom(valid))).toBe(true);
      const wrongClass = copy(valid); wrongClass.recipientBinding.recipientClass = 'assigned_staff';
      resealBindings(wrongClass); finish(wrongClass);
      expect(() => validate(wrongClass, trustedFrom(wrongClass))).toThrow(/coherent/);
    }
    const wrongSubject = evaluation();
    wrongSubject.recipientBinding.membershipSubjectId = '00000000-0000-4000-8000-000000000129';
    resealBindings(wrongSubject); finish(wrongSubject);
    expect(() => validate(wrongSubject, trustedFrom(wrongSubject))).toThrow(/coherent/);
  });

  test('roadmap and ledger release Part 4B, name only Part 4C candidate, and retain migration 274/no275', () => {
    const roadmap = fs.readFileSync(path.join(ROOT, 'docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md'), 'utf8');
    const ledger = fs.readFileSync(path.join(ROOT, 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md'), 'utf8');
    expect(roadmap).toContain('Parts 1A–4B released; Part 4C implementation candidate only.');
    expect(ledger).toContain('| 14 | 4B | Durable tenant-scoped source snapshot and correction lineage | **Released** |');
    expect(ledger).toContain('| 15 | 4C | Evaluation-time and pre-effect currentness revalidation | **Implementation candidate** |');
    expect(ledger).toContain('| 16 | 4D | Duplicate/replay/reorder/correction/tombstone/concurrency handling | Planned / unimplemented |');
    const migrations = fs.readdirSync(path.join(ROOT, 'migrations')).filter(name => /^\d+.*\.sql$/.test(name)).sort();
    expect(migrations.at(-1)).toBe('274_canonical_automation_trigger_snapshots_v1.sql');
    expect(migrations.some(name => name.startsWith('275_'))).toBe(false);
  });
});
