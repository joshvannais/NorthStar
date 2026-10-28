'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const util = require('node:util');
const canonical = require('../../src/automation/canonicalJson');

const ROOT = path.resolve(__dirname, '../..');
const CONTRACT_PATH = 'docs/architecture/MISSION_28_PART5C_OWNER_READABLE_PREVIEW_CONTRACT.json';
const CONTRACT = JSON.parse(fs.readFileSync(path.join(ROOT, CONTRACT_PATH), 'utf8'));
const PART5B = JSON.parse(fs.readFileSync(path.join(ROOT,
  'docs/architecture/MISSION_28_PART5B_DETERMINISTIC_EVALUATOR_CONTRACT.json'), 'utf8'));
const PART5A = JSON.parse(fs.readFileSync(path.join(ROOT,
  'docs/architecture/MISSION_28_PART5A_DECLARATIVE_RULE_GRAMMAR.json'), 'utf8'));
const PART3C = JSON.parse(fs.readFileSync(path.join(ROOT,
  'docs/architecture/MISSION_28_PART3C_OWNER_LIMITS_CONTRACT.json'), 'utf8'));
const PART1D = JSON.parse(fs.readFileSync(path.join(ROOT,
  'docs/architecture/MISSION_28_PART1D_FIRST_LAUNCH_MATRIX.json'), 'utf8'));
const PART4A = JSON.parse(fs.readFileSync(path.join(ROOT,
  'docs/architecture/MISSION_28_PART4A_CLOSED_TRIGGER_CATALOG.json'), 'utf8'));
const TENANT = '00000000-0000-4000-8000-000000000028';
const OTHER = '00000000-0000-4000-8000-000000000029';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const copy = value => JSON.parse(JSON.stringify(value));
const PART5B_PRECEDENCE = CONTRACT.trustedResolutionContract.part5BResultPrecedence;
const EXPECTED_PART5B_PRECEDENCE = [
  ['trusted_policy_unavailable','unavailable',['trusted_policy_unavailable'],'unavailable'],
  ['source_not_latest_exact_current','unavailable',['source_not_latest_exact_current'],'unavailable'],
  ['suppression_resolution_unavailable','unavailable',['suppression_resolution_unavailable'],'unavailable'],
  ['authorization_resolution_unavailable','unavailable',['authorization_resolution_unavailable'],'unavailable'],
  ['fact_unavailable','unavailable',['fact_unavailable'],'unavailable'],
  ['fact_unknown','unavailable',['fact_unknown'],'partial_unknown'],
  ['policy_expired','expired',['policy_expired'],'complete_exact'],
  ['source_lineage_ineligible','ineligible',['source_lineage_ineligible'],'complete_exact'],
  ['suppression_matched','suppressed',['suppression_matched'],'complete_exact'],
  ['rule_no_match','ineligible',['rule_no_match'],'complete_exact'],
  ['authorization_required','approval_required',['rule_match','authorization_required'],'complete_exact'],
  ['authorization_expired','approval_required',['rule_match','authorization_expired'],'complete_exact'],
  ['eligible','eligible',['rule_match','all_required_contract_authority_current'],'complete_exact']
].map(([id,result,reasons,quality])=>({id,result,reasons,quality}));

function normalizedLfSha256(relative) {
  const text = fs.readFileSync(path.join(ROOT, relative), 'utf8').replace(/\r\n/g, '\n');
  if (text.includes('\r')) throw new Error('lone CR');
  return crypto.createHash('sha256').update(text).digest('hex').toUpperCase();
}

function ownPlain(value, label = 'value', seen = new Set()) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return;
  if (typeof value !== 'object' || util.types.isProxy(value) || seen.has(value)) throw new Error(`${label} plain`);
  seen.add(value);
  const keys = Reflect.ownKeys(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || keys.length !== value.length + 1) throw new Error(`${label} dense`);
    for (let i = 0; i < value.length; i += 1) validateDescriptor(value, String(i), `${label}[${i}]`, seen);
    return;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) throw new Error(`${label} prototype`);
  for (const key of keys) {
    if (typeof key !== 'string' || key === 'toJSON') throw new Error(`${label} key`);
    validateDescriptor(value, key, `${label}.${key}`, seen);
  }
}

function validateDescriptor(object, key, label, seen) {
  const d = Object.getOwnPropertyDescriptor(object, key);
  if (!d || !d.enumerable || !d.configurable || !d.writable || !Object.hasOwn(d, 'value') || d.get || d.set) {
    throw new Error(`${label} descriptor`);
  }
  ownPlain(d.value, label, seen);
}

function exact(value, keys, label) {
  if (!value || Array.isArray(value) || JSON.stringify(Object.keys(value)) !== JSON.stringify(keys)) {
    throw new Error(`${label} shape`);
  }
}

function same(a, b) { return canonical.canonicalize(a) === canonical.canonicalize(b); }
function digest(namespace, value, omit) {
  const material = copy(value);
  if (omit) delete material[omit];
  return canonical.digest(namespace, material);
}
function uuid(value, label) { if (typeof value !== 'string' || !UUID.test(value)) throw new Error(`${label} UUID`); }
function hash(value, label) { if (typeof value !== 'string' || !DIGEST.test(value)) throw new Error(`${label} digest`); }
function utc(value, label) { if (typeof value !== 'string' || !UTC.test(value) || new Date(value).toISOString() !== value) throw new Error(`${label} UTC`); }

function canonicalTimeZone(value) {
  if (typeof value !== 'string' || value.length > 64 || !/^(?:UTC|[A-Za-z]+(?:[_-][A-Za-z]+)*(?:\/[A-Za-z]+(?:[_-][A-Za-z]+)*)+)$/.test(value)) {
    throw new Error('tenant timezone');
  }
  let resolved;
  try { resolved = new Intl.DateTimeFormat('en-US', {timeZone:value}).resolvedOptions().timeZone; } catch { throw new Error('tenant timezone'); }
  if (resolved !== value) throw new Error('tenant timezone canonical');
}

function rejectPrivateStrings(value) {
  if (typeof value === 'string') {
    if (/[^\s@]+@[^\s@]+\.[^\s@]+/u.test(value) || /https?:\/\//iu.test(value) ||
        /(?:^|[^a-z0-9])(?:sk_|secret|credential|password)(?:[^a-z0-9]|$)/iu.test(value)) throw new Error('private string');
    return;
  }
  if (Array.isArray(value)) return value.forEach(rejectPrivateStrings);
  if (value && typeof value === 'object') Object.values(value).forEach(rejectPrivateStrings);
}

function evaluation(result = 'eligible') {
  const value = {
    schemaVersion: PART5B.outputEnvelope.schemaVersion,
    tenantId: TENANT,
    evaluationId: '00000000-0000-4000-8000-000000000501',
    policyBinding: {policyId: '00000000-0000-4000-8000-000000000502', policyVersion: 3, policyDigest: `sha256:${'01'.repeat(32)}`},
    ruleBinding: {ruleId: '00000000-0000-4000-8000-000000000503', ruleDigest: `sha256:${'02'.repeat(32)}`,
      actionTemplateId: 'internal_fact_digest_v1', actionTemplateDigest: 'sha256:e937f4b70e4129230e844e20b073b2fef80d0f456bd8868069ae83fde5c352c1',
      actionFamilyId: 'internal_read_digest_task'},
    sourceBindingDigest: `sha256:${'04'.repeat(32)}`,
    factSetDigest: `sha256:${'05'.repeat(32)}`,
    inputDigest: `sha256:${'06'.repeat(32)}`,
    result,
    reasonCodes: result === 'eligible' ? ['rule_match', 'all_required_contract_authority_current'] :
      result === 'ineligible' ? ['rule_no_match'] : result === 'suppressed' ? ['suppression_matched'] :
      result === 'unavailable' ? ['source_not_latest_exact_current'] : result === 'expired' ? ['policy_expired'] :
      ['rule_match', 'authorization_required'],
    evidenceQuality: result === 'unavailable' ? 'unavailable' : 'complete_exact',
    predicateExplanations: [{conditionPath: '$.condition', factRef: 'source.status', valueType: 'token', operator: 'eq',
      factState: result === 'unavailable' ? 'unavailable' : 'known', comparisonResult: result === 'ineligible' ? 'no_match' :
        result === 'unavailable' ? 'unavailable' : 'match', reasonCode: result === 'ineligible' ? 'rule_no_match' :
        result === 'unavailable' ? 'fact_unavailable' : 'rule_match'}],
    nextEvaluationAt: result === 'expired' ? null : '2026-11-02T15:00:00.000Z',
    evaluatedAt: '2026-11-01T15:00:00.000Z',
    outputDigest: ''
  };
  value.outputDigest = digest(PART5B.outputEnvelope.outputDigestNamespace, value, 'outputDigest');
  return value;
}

function trusted(result = 'eligible', suppressionOverride = null) {
  const e = evaluation(result);
  const suppressionState = suppressionOverride || (result === 'suppressed' ? 'exact_current_matched' : 'exact_current_clear');
  const material = {
    schemaVersion: CONTRACT.previewEnvelope.schemaVersion,
    tenantId: TENANT,
    previewId: '00000000-0000-4000-8000-000000000510',
    viewer: {actorId: '00000000-0000-4000-8000-000000000511', sessionId: '00000000-0000-4000-8000-000000000512',
      membershipId: '00000000-0000-4000-8000-000000000513', actorTenantId: TENANT, sessionTenantId: TENANT,
      membershipTenantId: TENANT, sessionSubjectActorId: '00000000-0000-4000-8000-000000000511',
      membershipSubjectActorId: '00000000-0000-4000-8000-000000000511', actorState: 'active', sessionState: 'active',
      membershipState: 'active', roleId: 'tenant_owner', capabilityId: 'automation_view',
      recordScope: 'tenant_all_automation'},
    evaluationBinding: {evaluationId: e.evaluationId, inputDigest: e.inputDigest, outputDigest: e.outputDigest, result: e.result,
      policyId: e.policyBinding.policyId, policyVersion: e.policyBinding.policyVersion, policyDigest: e.policyBinding.policyDigest,
      ruleId: e.ruleBinding.ruleId, ruleDigest: e.ruleBinding.ruleDigest, actionTemplateId: e.ruleBinding.actionTemplateId,
      actionTemplateDigest: e.ruleBinding.actionTemplateDigest, actionFamilyId: e.ruleBinding.actionFamilyId,
      sourceBindingDigest: e.sourceBindingDigest, evaluatedAt: e.evaluatedAt},
    source: {triggerId: 'm20.lead_contact_state', sourceClassId: 'mission20_business_contact_preferences', recordIdentityDigest: `sha256:${'07'.repeat(32)}`,
      eventKind: 'opportunity_state_changed', headTransitionId: '00000000-0000-4000-8000-000000000514',
      headTransitionDigest: `sha256:${'08'.repeat(32)}`, headSequence: 9, headState: 'active',
      snapshotId: '00000000-0000-4000-8000-000000000515', snapshotDigest: `sha256:${'09'.repeat(32)}`,
      eventTime: '2026-11-01T14:00:00.000Z', observedAt: '2026-11-01T14:01:00.000Z',
      currentnessState: result === 'unavailable' ? 'unavailable' : 'latest_exact_current',
      sourceBindingDigest: e.sourceBindingDigest, sourceSetDigest: `sha256:${'0a'.repeat(32)}`},
    recipient: {recipientSetId: '00000000-0000-4000-8000-000000000516', recipientSetDigest: `sha256:${'0b'.repeat(32)}`,
      recipientClassIds: ['tenant_owner'], recipientScope: 'one_internal_recipient_maximum'},
    channel: {channelId: 'in_app_passive', providerModeId: 'provider_disabled', availabilityState: 'contract_only_runtime_unavailable'},
    contentVersion: {contentKind: 'not_applicable_no_external_document_or_message', documentOrMessageId: null,
      documentOrMessageVersion: null, documentOrMessageDigest: null},
    timing: {tenantTimeZoneId: 'America/New_York', executionTimeState: 'not_scheduled_part6_unavailable',
      scheduledUtc: null, scheduledLocal: null, nextEvaluationAt: e.nextEvaluationAt},
    limits: {mandatoryManifestDigest: PART3C.mandatoryConstraints.manifestDigest, ownerLimitProfileId: '00000000-0000-4000-8000-000000000517',
      ownerLimitProfileDigest: `sha256:${'0d'.repeat(32)}`, effectiveLimitDigest: `sha256:${'0e'.repeat(32)}`,
      dimensionIds: copy(PART3C.dimensionOrder),
      resolutionState: 'contract_only_runtime_enforcement_unavailable'},
    suppression: {state: suppressionState,
      snapshotId: '00000000-0000-4000-8000-000000000518', snapshotDigest: `sha256:${'0f'.repeat(32)}`,
      matchedSuppressionId: suppressionState === 'exact_current_matched' ? '00000000-0000-4000-8000-000000000519' : null,
      matchedSuppressionDigest: suppressionState === 'exact_current_matched' ? `sha256:${'10'.repeat(32)}` : null,
      endsAt: suppressionState === 'exact_current_matched' ? '2026-11-03T15:00:00.000Z' : null, resolutionDigest: `sha256:${'11'.repeat(32)}`},
    governance: {resolutionState: 'contract_only_runtime_unavailable', tenantStopState: 'unknown_runtime_unavailable',
      policyControlState: 'unknown_runtime_unavailable', governanceDigest: `sha256:${'12'.repeat(32)}`,
      stopConditionCodes: ['tenant_wide_stop','policy_pause_or_revoke','source_or_authorization_material_change','suppression_match','limit_or_channel_unavailable']},
    expectedEffects: {projectionState: 'hypothetical_no_effect', effectClass: 'internal_record_only', internalRecordCount: 1,
      externalEffectCount: 0, providerAttemptCount: 0, recipientMessageCount: 0, moneyEffectCount: 0, upstreamMutationCount: 0},
    inputDigest: ''
  };
  material.inputDigest = digest(CONTRACT.previewEnvelope.inputDigestNamespace, material, 'inputDigest');
  return {evaluation: e, material};
}

function branchFor(value) {
  return PART5B_PRECEDENCE.find(item => item.result === value.result && same(item.reasons, value.reasonCodes));
}

function exactPart5BFixture(branchId, overrides = {}) {
  const branch = PART5B_PRECEDENCE.find(item => item.id === branchId);
  if (!branch) throw new Error('unknown Part5B branch fixture');
  const suppressionState = overrides.suppressionState ||
    (branchId === 'suppression_resolution_unavailable' ? 'unavailable' :
      branchId === 'suppression_matched' ? 'exact_current_matched' : 'exact_current_clear');
  const fixture = trusted(branch.result, suppressionState);
  fixture.evaluation.reasonCodes = copy(branch.reasons);
  fixture.evaluation.evidenceQuality = branch.quality;
  const explanation = fixture.evaluation.predicateExplanations[0];
  if (branchId === 'fact_unavailable') Object.assign(explanation,
    {factState:'unavailable',comparisonResult:'unavailable',reasonCode:'fact_unavailable'});
  else if (branchId === 'fact_unknown') Object.assign(explanation,
    {factState:'unknown',comparisonResult:'unknown',reasonCode:'fact_unknown'});
  else if (branchId === 'rule_no_match') Object.assign(explanation,
    {factState:'known',comparisonResult:'no_match',reasonCode:'rule_no_match'});
  else Object.assign(explanation,{factState:'known',comparisonResult:'match',reasonCode:'rule_match'});
  fixture.evaluation.outputDigest = digest(PART5B.outputEnvelope.outputDigestNamespace,
    fixture.evaluation, 'outputDigest');
  fixture.material.evaluationBinding.outputDigest = fixture.evaluation.outputDigest;
  fixture.material.evaluationBinding.result = branch.result;
  fixture.material.source.currentnessState = overrides.sourceCurrentness ||
    (branchId === 'source_not_latest_exact_current' ? 'unavailable' : 'latest_exact_current');
  fixture.material.source.headState = overrides.headState ||
    (branchId === 'source_lineage_ineligible' ? 'tombstoned' : 'active');
  fixture.material.inputDigest = digest(CONTRACT.previewEnvelope.inputDigestNamespace,
    fixture.material, 'inputDigest');
  return fixture;
}

function validateEvaluation(value) {
  exact(value, PART5B.outputEnvelope.exactFields, 'evaluation');
  if (value.schemaVersion !== PART5B.outputEnvelope.schemaVersion || !PART5B.resultContract.states.includes(value.result)) throw new Error('evaluation state');
  uuid(value.tenantId, 'evaluation tenant'); uuid(value.evaluationId, 'evaluation');
  exact(value.policyBinding, PART5B.outputEnvelope.policyBindingExactFields, 'policy');
  exact(value.ruleBinding, PART5B.outputEnvelope.ruleBindingExactFields, 'rule');
  uuid(value.policyBinding.policyId, 'policy'); uuid(value.ruleBinding.ruleId, 'rule');
  if (!Number.isSafeInteger(value.policyBinding.policyVersion) || value.policyBinding.policyVersion < 1) throw new Error('policy version');
  for (const [item,label] of [[value.policyBinding.policyDigest,'policy'],[value.ruleBinding.ruleDigest,'rule'],
    [value.ruleBinding.actionTemplateDigest,'template'],[value.sourceBindingDigest,'source'],[value.factSetDigest,'facts'],
    [value.inputDigest,'input'],[value.outputDigest,'output']]) hash(item,label);
  if (typeof value.ruleBinding.actionTemplateId !== 'string' || typeof value.ruleBinding.actionFamilyId !== 'string') throw new Error('rule binding');
  utc(value.evaluatedAt,'evaluatedAt'); if (value.nextEvaluationAt !== null) utc(value.nextEvaluationAt,'nextEvaluationAt');
  if (value.nextEvaluationAt !== null && value.nextEvaluationAt <= value.evaluatedAt) throw new Error('next evaluation order');
  if (!PART5B.evidenceQualityContract.states.includes(value.evidenceQuality)) throw new Error('evidence quality');
  if (!Array.isArray(value.predicateExplanations) || value.predicateExplanations.length < 1) throw new Error('explanations');
  for (const item of value.predicateExplanations) {
    exact(item, PART5B.outputEnvelope.predicateExplanationExactFields, 'explanation');
    if (!PART5B.reasonContract.closedCodes.includes(item.reasonCode)) throw new Error('explanation reason');
  }
  if (digest(PART5B.outputEnvelope.outputDigestNamespace, value, 'outputDigest') !== value.outputDigest) throw new Error('output digest');
  if (!Array.isArray(value.reasonCodes) || value.reasonCodes.some(code => !PART5B.reasonContract.closedCodes.includes(code))) throw new Error('reason');
  const branch = branchFor(value);
  if (!branch || value.evidenceQuality !== branch.quality) throw new Error('Part5B result reason precedence');
}

function validateMaterial(candidate, separate, evaluationValue) {
  ownPlain(candidate); ownPlain(separate); ownPlain(evaluationValue);
  rejectPrivateStrings(candidate);
  exact(candidate, CONTRACT.previewEnvelope.exactFields, 'preview input');
  if (!same(candidate, separate)) throw new Error('candidate cannot establish trusted material');
  if (candidate.schemaVersion !== CONTRACT.previewEnvelope.schemaVersion || candidate.tenantId !== TENANT) throw new Error('preview authority');
  uuid(candidate.previewId, 'preview');
  for (const [key, fields] of Object.entries({viewer: 'viewerExactFields', evaluationBinding: 'evaluationBindingExactFields', source: 'sourceExactFields',
    recipient: 'recipientExactFields', channel: 'channelExactFields', contentVersion: 'contentVersionExactFields', timing: 'timingExactFields',
    limits: 'limitsExactFields', suppression: 'suppressionExactFields', governance: 'governanceExactFields', expectedEffects: 'expectedEffectsExactFields'})) {
    exact(candidate[key], CONTRACT.previewEnvelope[fields], key);
  }
  const v = candidate.viewer;
  [v.actorId,v.sessionId,v.membershipId,v.actorTenantId,v.sessionTenantId,v.membershipTenantId,v.sessionSubjectActorId,v.membershipSubjectActorId].forEach((x,i) => uuid(x, `viewer${i}`));
  if ([v.actorTenantId,v.sessionTenantId,v.membershipTenantId].some(x => x !== candidate.tenantId) ||
      v.actorId !== v.sessionSubjectActorId || v.actorId !== v.membershipSubjectActorId || v.capabilityId !== 'automation_view' ||
      v.actorState !== 'active' || v.sessionState !== 'active' || v.membershipState !== 'active' ||
      !CONTRACT.trustedResolutionContract.ownerReadableRoles.includes(v.roleId) || v.recordScope !== 'tenant_all_automation') throw new Error('viewer binding');
  const b = candidate.evaluationBinding;
  if (candidate.tenantId !== evaluationValue.tenantId || b.evaluationId !== evaluationValue.evaluationId ||
      b.inputDigest !== evaluationValue.inputDigest || b.outputDigest !== evaluationValue.outputDigest ||
      b.result !== evaluationValue.result || !same({policyId:b.policyId,policyVersion:b.policyVersion,policyDigest:b.policyDigest}, evaluationValue.policyBinding) ||
      b.ruleId !== evaluationValue.ruleBinding.ruleId || b.ruleDigest !== evaluationValue.ruleBinding.ruleDigest ||
      b.actionTemplateId !== evaluationValue.ruleBinding.actionTemplateId || b.actionTemplateDigest !== evaluationValue.ruleBinding.actionTemplateDigest ||
      b.actionFamilyId !== evaluationValue.ruleBinding.actionFamilyId || b.sourceBindingDigest !== evaluationValue.sourceBindingDigest || b.evaluatedAt !== evaluationValue.evaluatedAt) throw new Error('evaluation binding');
  const s=candidate.source;
  if (![s.triggerId,s.sourceClassId,s.eventKind].every(x=>typeof x==='string' && x.length>0)) throw new Error('source tokens');
  [s.recordIdentityDigest,s.headTransitionDigest,s.snapshotDigest,s.sourceBindingDigest,s.sourceSetDigest].forEach((x,i)=>hash(x,`source${i}`));
  uuid(s.headTransitionId,'head'); uuid(s.snapshotId,'snapshot'); utc(s.eventTime,'eventTime'); utc(s.observedAt,'observedAt');
  if (!Number.isSafeInteger(s.headSequence) || s.headSequence < 1 || s.sourceBindingDigest !== b.sourceBindingDigest ||
      !['active','tombstoned','reversed'].includes(s.headState) || !['latest_exact_current','unavailable'].includes(s.currentnessState)) throw new Error('source shape');
  if (s.observedAt > b.evaluatedAt) throw new Error('source observed after evaluation');
  const branchIndex=PART5B_PRECEDENCE.indexOf(branchFor(evaluationValue));
  if ((s.currentnessState === 'unavailable' && branchIndex > 1) ||
      (s.currentnessState === 'latest_exact_current' && branchIndex === 1) ||
      (s.headState !== 'active' && branchIndex > 7) || (s.headState === 'active' && branchIndex === 7)) {
    throw new Error('source result precedence');
  }
  uuid(candidate.recipient.recipientSetId,'recipient set'); hash(candidate.recipient.recipientSetDigest,'recipient set');
  if (candidate.recipient.recipientScope !== 'one_internal_recipient_maximum' ||
      !Array.isArray(candidate.recipient.recipientClassIds) || candidate.recipient.recipientClassIds.length !== 1 ||
      !['tenant_owner','tenant_admin','assigned_staff'].includes(candidate.recipient.recipientClassIds[0])) throw new Error('recipient');
  if (candidate.channel.channelId !== 'in_app_passive' || candidate.channel.providerModeId !== 'provider_disabled' ||
      candidate.channel.availabilityState !== 'contract_only_runtime_unavailable') throw new Error('channel');
  const template=PART5A.approvedActionTemplates.find(item=>item.templateId===b.actionTemplateId);
  const launchCell=PART1D.launchCells.find(item=>item.actionFamily===b.actionFamilyId);
  const trigger=PART4A.triggers.find(item=>item.id===s.triggerId);
  if (!template || template.templateDigest!==b.actionTemplateDigest || template.actionFamilyId!==b.actionFamilyId ||
      template.channelId!==candidate.channel.channelId || template.providerMode!==candidate.channel.providerModeId ||
      template.effectClass!==candidate.expectedEffects.effectClass || !launchCell ||
      !launchCell.channelIds.includes(candidate.channel.channelId) || !launchCell.providerModeIds.includes(candidate.channel.providerModeId) ||
      candidate.recipient.recipientClassIds.some(id=>!launchCell.recipientClassIds.includes(id)) || !trigger ||
      trigger.sourceClassId!==s.sourceClassId || !trigger.allowedActionFamilies.includes(b.actionFamilyId) ||
      !trigger.eventTime.kinds.some(item=>item.eventKind===s.eventKind) || !launchCell.sourceClassIds.includes(s.sourceClassId)) throw new Error('template material');
  if (candidate.contentVersion.contentKind !== 'not_applicable_no_external_document_or_message' ||
      [candidate.contentVersion.documentOrMessageId,candidate.contentVersion.documentOrMessageVersion,candidate.contentVersion.documentOrMessageDigest].some(x => x !== null)) throw new Error('content');
  canonicalTimeZone(candidate.timing.tenantTimeZoneId);
  if (candidate.timing.executionTimeState !== 'not_scheduled_part6_unavailable' || candidate.timing.scheduledUtc !== null || candidate.timing.scheduledLocal !== null ||
      candidate.timing.nextEvaluationAt !== evaluationValue.nextEvaluationAt) throw new Error('timing');
  [candidate.limits.mandatoryManifestDigest,candidate.limits.ownerLimitProfileDigest,candidate.limits.effectiveLimitDigest].forEach((x,i)=>hash(x,`limit${i}`));
  uuid(candidate.limits.ownerLimitProfileId,'limit profile');
  if (candidate.limits.resolutionState !== 'contract_only_runtime_enforcement_unavailable') throw new Error('limit state');
  if (candidate.limits.mandatoryManifestDigest!==PART3C.mandatoryConstraints.manifestDigest ||
      JSON.stringify(candidate.limits.dimensionIds) !== JSON.stringify(PART3C.dimensionOrder)) throw new Error('limits');
  if (!['exact_current_clear','exact_current_matched','unavailable'].includes(candidate.suppression.state)) throw new Error('suppression');
  if ((candidate.suppression.state==='unavailable' && branchIndex > 2) ||
      (candidate.suppression.state!=='unavailable' && branchIndex === 2) ||
      (candidate.suppression.state==='exact_current_matched' && branchIndex > 8) ||
      (candidate.suppression.state!=='exact_current_matched' && branchIndex === 8)) throw new Error('suppression precedence');
  uuid(candidate.suppression.snapshotId,'suppression snapshot'); hash(candidate.suppression.snapshotDigest,'suppression snapshot');
  hash(candidate.suppression.resolutionDigest,'suppression resolution');
  if (candidate.suppression.state === 'exact_current_matched') {
    uuid(candidate.suppression.matchedSuppressionId,'suppression'); hash(candidate.suppression.matchedSuppressionDigest,'suppression'); utc(candidate.suppression.endsAt,'suppression end');
    if (candidate.suppression.endsAt <= b.evaluatedAt) throw new Error('suppression expired');
  } else if ([candidate.suppression.matchedSuppressionId,candidate.suppression.matchedSuppressionDigest,candidate.suppression.endsAt].some(x=>x!==null)) throw new Error('suppression nulls');
  const stop=['tenant_wide_stop','policy_pause_or_revoke','source_or_authorization_material_change','suppression_match','limit_or_channel_unavailable'];
  if (candidate.governance.resolutionState !== 'contract_only_runtime_unavailable' || candidate.governance.tenantStopState !== 'unknown_runtime_unavailable' ||
      candidate.governance.policyControlState !== 'unknown_runtime_unavailable' || !same(candidate.governance.stopConditionCodes,stop)) throw new Error('governance');
  hash(candidate.governance.governanceDigest,'governance');
  if (candidate.expectedEffects.projectionState !== 'hypothetical_no_effect' || candidate.expectedEffects.effectClass !== 'internal_record_only' ||
      candidate.expectedEffects.internalRecordCount !== 1 ||
      !['internalRecordCount','externalEffectCount','providerAttemptCount','recipientMessageCount','moneyEffectCount','upstreamMutationCount'].every(k => Number.isSafeInteger(candidate.expectedEffects[k]) && candidate.expectedEffects[k] >= 0) ||
      ['externalEffectCount','providerAttemptCount','recipientMessageCount','moneyEffectCount','upstreamMutationCount'].some(k => candidate.expectedEffects[k] !== 0)) throw new Error('effects');
  if (digest(CONTRACT.previewEnvelope.inputDigestNamespace, candidate, 'inputDigest') !== candidate.inputDigest) throw new Error('input digest');
  JSON.stringify(candidate).toLowerCase().split(/[^a-z_]+/).forEach(token => {
    if (CONTRACT.privacyContract.forbiddenAtEveryDepth.includes(token)) throw new Error('private material');
  });
}

function project(candidate, separate, evaluationValue) {
  validateEvaluation(evaluationValue);
  validateMaterial(candidate, separate, evaluationValue);
  const output = {
    schemaVersion: CONTRACT.previewEnvelope.schemaVersion, tenantId: candidate.tenantId, previewId: candidate.previewId,
    viewerScope: {capabilityId: candidate.viewer.capabilityId, recordScope: candidate.viewer.recordScope},
    evaluationBinding: copy(candidate.evaluationBinding), displayState: evaluationValue.result,
    whatWillHappenCode: CONTRACT.displayContract.whatWillHappenCodes[evaluationValue.result],
    reasonCodes: copy(evaluationValue.reasonCodes), predicateExplanations: copy(evaluationValue.predicateExplanations),
    source: copy(candidate.source), recipient: copy(candidate.recipient), channel: copy(candidate.channel), contentVersion: copy(candidate.contentVersion),
    timing: copy(candidate.timing), limits: copy(candidate.limits), suppression: copy(candidate.suppression),
    expectedEffects: copy(candidate.expectedEffects), stopConditionCodes: copy(candidate.governance.stopConditionCodes),
    assumptionCodes: copy(CONTRACT.displayContract.assumptionCodes), effectAuthorityState: CONTRACT.outputContract.effectAuthorityState,
    previewDigest: ''
  };
  output.previewDigest = digest(CONTRACT.previewEnvelope.previewDigestNamespace, output, 'previewDigest');
  return output;
}

describe('Mission 28 Part 5C owner-readable no-effect preview', () => {
  test('freezes exact Part5B release, inputs and no-effect authority', () => {
    expect(CONTRACT.authority).toEqual(expect.objectContaining({part:'5C', state:'implementation_candidate_only', baselineCommit:'0f942b0758297b4514847783b49c6812fa50e71d', mountedPreviewResolverStoreRouteOrUiAvailable:false}));
    expect(CONTRACT.part5BRelease).toEqual(expect.objectContaining({acceptedSourceHead:'1ed57934cd127b083a3accacc9735ae6b3b9f5cd', pullRequest:566, mergedMain:'0f942b0758297b4514847783b49c6812fa50e71d', deployment:'cb9fcc37-473e-43c9-b243-37ce1860b17d', deploymentState:'SUCCESS_RUNNING'}));
    for (const item of CONTRACT.frozenInputs) expect(normalizedLfSha256(item.path)).toBe(item.normalizedLfSha256);
    expect(CONTRACT.frozenInputs).toHaveLength(11);
    expect(CONTRACT.outputContract.previewNeverCreatesOrProvesAnEffect).toBe(true);
    expect(PART5B_PRECEDENCE).toEqual(EXPECTED_PART5B_PRECEDENCE);
    expect(PART5B.resultContract.precedence).toHaveLength(8);
    expect(CONTRACT.authorizationCycleContract).toEqual({
      approvalRequiredEvaluationMayProduceOneNoEffectPreview:true,
      Part3BPerRunApprovalMayBindThatExactPreviewIdAndDigest:true,
      approvalRequiresACompleteNewPart5BEvaluation:true,
      previewNeverUpgradesApprovalRequiredToEligible:true,
      postAuthorizationEligiblePreviewIsDisplayEvidenceOnlyAndNeverReplacesThePreviewBoundByAuthorization:true
    });
  });

  test.each(PART5B.resultContract.states)('projects deterministic no-effect owner view for %s', result => {
    const fixture = trusted(result);
    const output = project(copy(fixture.material), fixture.material, fixture.evaluation);
    expect(output.displayState).toBe(result);
    expect(output.whatWillHappenCode).toBe(CONTRACT.displayContract.whatWillHappenCodes[result]);
    expect(output.effectAuthorityState).toBe('no_effect_authority');
    expect(output.expectedEffects).toEqual(expect.objectContaining({externalEffectCount:0,providerAttemptCount:0,recipientMessageCount:0,moneyEffectCount:0,upstreamMutationCount:0}));
    expect(output.previewDigest).toMatch(DIGEST);
  });

  test('rejects retargeted viewer evaluation source recipient channel time limits suppression governance and effect material after redigest', () => {
    const cases = [
      x => { x.viewer.sessionSubjectActorId = '00000000-0000-4000-8000-000000000599'; },
      x => { x.viewer.actorTenantId = OTHER; }, x => { x.evaluationBinding.outputDigest = `sha256:${'99'.repeat(32)}`; },
      x => { x.source.snapshotDigest = `sha256:${'99'.repeat(32)}`; }, x => { x.recipient.recipientClassIds = ['tenant_admin','tenant_owner']; },
      x => { x.channel.channelId = 'sms'; }, x => { x.contentVersion.documentOrMessageId = '00000000-0000-4000-8000-000000000599'; },
      x => { x.timing.scheduledUtc = '2026-11-01T16:00:00.000Z'; }, x => { x.limits.dimensionIds.reverse(); },
      x => { x.suppression.state = 'exact_current_matched'; }, x => { x.governance.stopConditionCodes.reverse(); },
      x => { x.expectedEffects.providerAttemptCount = 1; }
    ];
    for (const mutate of cases) {
      const fixture = trusted(); const candidate = copy(fixture.material); mutate(candidate);
      candidate.inputDigest = digest(CONTRACT.previewEnvelope.inputDigestNamespace, candidate, 'inputDigest');
      expect(() => project(candidate, fixture.material, fixture.evaluation)).toThrow();
    }
  });

  test('rejects malformed recipient identities, open scope, arbitrary availability, negative counts and value-level private text', () => {
    const mutations=[
      x=>{x.recipient.recipientSetId='not-a-uuid';}, x=>{x.recipient.recipientSetDigest='not-a-digest';},
      x=>{x.recipient.recipientScope='unbounded';}, x=>{x.channel.availabilityState='customer@example.test';},
      x=>{x.expectedEffects.internalRecordCount=-7;}, x=>{x.channel.availabilityState='secret provider credential';}
    ];
    for(const mutate of mutations){const fixture=trusted();const attacked=copy(fixture.material);mutate(attacked);
      attacked.inputDigest=digest(CONTRACT.previewEnvelope.inputDigestNamespace,attacked,'inputDigest');
      expect(()=>project(attacked,attacked,fixture.evaluation)).toThrow();}
  });

  test.each(PART5B_PRECEDENCE)('accepts the exact Part5B-produced $id branch', branch => {
    const fixture=exactPart5BFixture(branch.id);
    const output=project(fixture.material,fixture.material,fixture.evaluation);
    expect(output).toEqual(expect.objectContaining({displayState:branch.result,reasonCodes:branch.reasons}));
  });

  test('preserves masked lower source and suppression states under the exact winning Part5B branch', () => {
    const cases=[
      exactPart5BFixture('trusted_policy_unavailable',{sourceCurrentness:'unavailable'}),
      exactPart5BFixture('source_not_latest_exact_current',{suppressionState:'unavailable'}),
      exactPart5BFixture('source_not_latest_exact_current',{suppressionState:'exact_current_matched'}),
      exactPart5BFixture('policy_expired',{suppressionState:'exact_current_matched'}),
      exactPart5BFixture('source_lineage_ineligible',{headState:'reversed'}),
      exactPart5BFixture('authorization_expired')
    ];
    for(const fixture of cases){
      const output=project(fixture.material,fixture.material,fixture.evaluation);
      expect(output.reasonCodes).toEqual(fixture.evaluation.reasonCodes);
      expect(output.suppression).toEqual(fixture.material.suppression);
    }
    expect(cases[0].evaluation.reasonCodes).toEqual(['trusted_policy_unavailable']);
    expect(cases[2].evaluation.reasonCodes).toEqual(['source_not_latest_exact_current']);
    expect(cases[3].evaluation.reasonCodes).toEqual(['policy_expired']);
    expect(cases[4].evaluation.reasonCodes).toEqual(['source_lineage_ineligible']);
    expect(cases[5].evaluation.reasonCodes).toEqual(['rule_match','authorization_expired']);
  });

  test('rejects lower winning branches that contradict independently trusted source or suppression state', () => {
    const attacks=[
      exactPart5BFixture('eligible',{sourceCurrentness:'unavailable'}),
      exactPart5BFixture('source_not_latest_exact_current',{sourceCurrentness:'latest_exact_current'}),
      exactPart5BFixture('rule_no_match',{headState:'tombstoned'}),
      exactPart5BFixture('source_lineage_ineligible',{headState:'active'}),
      exactPart5BFixture('authorization_resolution_unavailable',{suppressionState:'unavailable'}),
      exactPart5BFixture('suppression_resolution_unavailable',{suppressionState:'exact_current_clear'}),
      exactPart5BFixture('eligible',{suppressionState:'exact_current_matched'}),
      exactPart5BFixture('suppression_matched',{suppressionState:'exact_current_clear'})
    ];
    for(const fixture of attacks) expect(()=>project(fixture.material,fixture.material,fixture.evaluation)).toThrow(/precedence/);

    const fabricated=exactPart5BFixture('trusted_policy_unavailable');
    fabricated.evaluation.reasonCodes=['trusted_policy_unavailable','suppression_matched'];
    fabricated.evaluation.outputDigest=digest(PART5B.outputEnvelope.outputDigestNamespace,fabricated.evaluation,'outputDigest');
    fabricated.material.evaluationBinding.outputDigest=fabricated.evaluation.outputDigest;
    fabricated.material.inputDigest=digest(CONTRACT.previewEnvelope.inputDigestNamespace,fabricated.material,'inputDigest');
    expect(()=>project(fabricated.material,fabricated.material,fabricated.evaluation)).toThrow('Part5B result reason precedence');
  });

  test('accepts an exact canonical non-Eastern tenant timezone and rejects invalid or alias zones', () => {
    const fixture=trusted(); fixture.material.timing.tenantTimeZoneId='America/Chicago';
    fixture.material.inputDigest=digest(CONTRACT.previewEnvelope.inputDigestNamespace,fixture.material,'inputDigest');
    expect(project(fixture.material,fixture.material,fixture.evaluation).timing.tenantTimeZoneId).toBe('America/Chicago');
    for(const zone of ['Not/AZone','US/Central',' customer@example.test ']){const next=trusted();next.material.timing.tenantTimeZoneId=zone;
      next.material.inputDigest=digest(CONTRACT.previewEnvelope.inputDigestNamespace,next.material,'inputDigest');
      expect(()=>project(next.material,next.material,next.evaluation)).toThrow();}
  });

  test('rejects Part5B reason result explanation and next-evaluation substitution even after full redigest', () => {
    for (const mutate of [x => { x.result='approval_required'; }, x => { x.reasonCodes=['rule_no_match']; },
      x => { x.predicateExplanations[0].factRef='other.fact'; }, x => { x.nextEvaluationAt='2026-11-04T15:00:00.000Z'; }]) {
      const fixture=trusted(); const attacked=copy(fixture.evaluation); mutate(attacked);
      attacked.outputDigest=digest(PART5B.outputEnvelope.outputDigestNamespace, attacked, 'outputDigest');
      expect(() => project(fixture.material, fixture.material, attacked)).toThrow();
    }
  });

  test('rejects malformed and hostile data before getters or serialization hooks', () => {
    let calls=0; const fixture=trusted(); const accessor=copy(fixture.material);
    Object.defineProperty(accessor.source,'snapshotDigest',{enumerable:true,configurable:true,get(){calls+=1;return `sha256:${'09'.repeat(32)}`;}});
    expect(() => project(accessor, fixture.material, fixture.evaluation)).toThrow(); expect(calls).toBe(0);
    const attacks=[copy(fixture.material),copy(fixture.material),copy(fixture.material),copy(fixture.material)];
    attacks[0].unexpected=true; delete attacks[1].schemaVersion; Object.setPrototypeOf(attacks[2].source,{polluted:true});
    Object.defineProperty(attacks[3].recipient,Symbol('hidden'),{enumerable:true,value:'secret'});
    for(const attacked of attacks) expect(()=>project(attacked,fixture.material,fixture.evaluation)).toThrow();
    expect(()=>project(new Proxy(copy(fixture.material),{}),fixture.material,fixture.evaluation)).toThrow();
  });

  test('forbids private contact content, fabricated schedules and external effect authority', () => {
    const fixture=trusted();
    for(const mutate of [x=>{x.recipient.email='customer@example.test';},x=>{x.contentVersion.message_body='hello';},
      x=>{x.channel.providerModeId='live_provider';},x=>{x.expectedEffects.moneyEffectCount=1;}]){
      const attacked=copy(fixture.material); mutate(attacked);
      expect(()=>project(attacked,fixture.material,fixture.evaluation)).toThrow();
    }
    expect(CONTRACT.privacyContract.candidateFreeTextAllowed).toBe(false);
    expect(CONTRACT.laterSliceBoundary.part5D).toContain('planned_unimplemented');
  });

  test('records Part5B released, only Part5C candidate, later slices planned and migration274/no275', () => {
    const roadmap=fs.readFileSync(path.join(ROOT,'docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md'),'utf8');
    const ledger=fs.readFileSync(path.join(ROOT,'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md'),'utf8');
    for(const document of [roadmap,ledger]){
      expect(document).toContain('Parts 1A–5B released; Part 5C implementation candidate only.');
      expect(document).toContain('Parts 5D–14G remain planned and unimplemented.');
      expect(document).toContain('1ed57934cd127b083a3accacc9735ae6b3b9f5cd');
      expect(document).toContain('cb9fcc37-473e-43c9-b243-37ce1860b17d');
      expect(document).toContain('99d66b682bcd53d9b6822a6ced0a663b6591b7aa4156f7bbe8c084c3833b4ce2');
    }
    expect(ledger).toContain('| 18 | 5B | Deterministic explainable evaluator | **Released** |');
    expect(ledger).toContain('| 19 | 5C | Owner-readable no-effect preview | **Implementation candidate** |');
    expect((ledger.match(/\*\*Implementation candidate\*\*/g)||[])).toHaveLength(1);
    expect((ledger.match(/Planned \/ unimplemented/g)||[])).toHaveLength(47);
    const migrations=fs.readdirSync(path.join(ROOT,'migrations')).filter(n=>/^\d+.*\.sql$/.test(n)).sort();
    expect(migrations.at(-1)).toBe('274_canonical_automation_trigger_snapshots_v1.sql');
    expect(migrations.some(n=>n.startsWith('275_'))).toBe(false);
  });
});
