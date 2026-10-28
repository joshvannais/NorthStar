'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const util = require('node:util');
const canonical = require('../../src/automation/canonicalJson');

const ROOT = path.resolve(__dirname, '../..');
const CONTRACT_PATH = 'docs/architecture/MISSION_28_PART5B_DETERMINISTIC_EVALUATOR_CONTRACT.json';
const CONTRACT = JSON.parse(fs.readFileSync(path.join(ROOT, CONTRACT_PATH), 'utf8'));
const RULE_CONTRACT = JSON.parse(fs.readFileSync(path.join(ROOT,
  'docs/architecture/MISSION_28_PART5A_DECLARATIVE_RULE_GRAMMAR.json'), 'utf8'));
const TRIGGER_CONTRACT = JSON.parse(fs.readFileSync(path.join(ROOT,
  'docs/architecture/MISSION_28_PART4A_CLOSED_TRIGGER_CATALOG.json'), 'utf8'));
const AUTH_CONTRACT = JSON.parse(fs.readFileSync(path.join(ROOT,
  'docs/architecture/MISSION_28_PART3B_APPROVAL_AUTHORIZATION_CONTRACT.json'), 'utf8'));
const TENANT = '00000000-0000-4000-8000-000000000028';
const OTHER_TENANT = '00000000-0000-4000-8000-000000000029';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const TOKEN = /^[a-z][a-z0-9_.:-]{0,63}$/;
const UTC = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;
const copy = value => JSON.parse(JSON.stringify(value));

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
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !descriptor.configurable || !descriptor.writable ||
          !Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) {
        throw new Error(`${label} array descriptor`);
      }
      ownPlain(descriptor.value, `${label}[${index}]`, seen);
    }
    return;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) throw new Error(`${label} plain object`);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') throw new Error(`${label} symbol`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !descriptor.configurable || !descriptor.writable ||
        !Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set || key === 'toJSON') {
      throw new Error(`${label} descriptor`);
    }
    ownPlain(descriptor.value, `${label}.${key}`, seen);
  }
}

function exact(value, keys, label) {
  if (!value || Array.isArray(value) || JSON.stringify(Object.keys(value)) !== JSON.stringify(keys)) {
    throw new Error(`${label} shape`);
  }
}

function same(left, right) {
  return canonical.canonicalize(left) === canonical.canonicalize(right);
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function digestWithout(namespace, value, field) {
  const material = copy(value);
  delete material[field];
  return canonical.digest(namespace, material);
}

function validateUuid(value, label) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error(`${label} UUID`);
}

function validateDigest(value, label) {
  if (typeof value !== 'string' || !DIGEST.test(value)) throw new Error(`${label} digest`);
}

function validateToken(value, label) {
  if (typeof value !== 'string' || !TOKEN.test(value)) throw new Error(`${label} token`);
}

function validateUtc(value, label) {
  if (typeof value !== 'string' || !UTC.test(value) || new Date(value).toISOString() !== value) {
    throw new Error(`${label} UTC`);
  }
}

function validatePrimitiveString(value, maximum, label) {
  if (typeof value !== 'string' || value.length < 1 || Buffer.byteLength(value, 'utf8') > maximum ||
      value !== value.normalize('NFC') || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`${label} string`);
  }
}

function validateScalar(type, value) {
  const bounds = RULE_CONTRACT.bounds;
  if (type === 'boolean') {
    if (typeof value !== 'boolean') throw new Error('boolean value');
  } else if (type === 'token') {
    validatePrimitiveString(value, bounds.maxTokenLength, 'token');
    if (!TOKEN.test(value)) throw new Error('token value');
  } else if (type === 'bounded_text') {
    validatePrimitiveString(value, bounds.maxTextLength, 'text');
  } else if (type === 'integer') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0) || value < bounds.safeIntegerMinimum ||
        value > bounds.safeIntegerMaximum) throw new Error('integer value');
  } else if (type === 'decimal') {
    if (typeof value !== 'string' || !/^-?(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value) || value === '-0' ||
        (value.includes('.') && value.endsWith('0'))) throw new Error('decimal value');
    const asNumber = Number(value);
    if (!Number.isFinite(asNumber) || asNumber < bounds.safeIntegerMinimum || asNumber > bounds.safeIntegerMaximum) {
      throw new Error('decimal bound');
    }
  } else if (type === 'utc_instant') {
    validateUtc(value, 'instant');
  } else if (type === 'uuid') {
    validateUuid(value, 'value');
  } else if (type === 'digest') {
    validateDigest(value, 'value');
  } else {
    throw new Error('unknown value type');
  }
}

function decimalParts(value) {
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ''] = unsigned.split('.');
  return {negative, digits: BigInt(whole + fraction), scale: fraction.length};
}

function compareDecimal(left, right) {
  const a = decimalParts(left);
  const b = decimalParts(right);
  let av = a.digits * (10n ** BigInt(b.scale));
  let bv = b.digits * (10n ** BigInt(a.scale));
  if (a.negative) av = -av;
  if (b.negative) bv = -bv;
  return av < bv ? -1 : av > bv ? 1 : 0;
}

function compareScalar(type, left, right) {
  if (type === 'decimal') return compareDecimal(left, right);
  if (type === 'integer') return left < right ? -1 : left > right ? 1 : 0;
  if (type === 'utc_instant') return left < right ? -1 : left > right ? 1 : 0;
  return left < right ? -1 : left > right ? 1 : 0;
}

function validateExpected(valueType, operator, expected) {
  const row = RULE_CONTRACT.typeCompatibilityMatrix.find(item => item.valueType === valueType);
  if (!row || !row.operators.includes(operator)) throw new Error('type/operator compatibility');
  if (['in', 'not_in'].includes(operator)) {
    if (!Array.isArray(expected) || expected.length < 1 || expected.length > RULE_CONTRACT.bounds.maxCollectionMembers) {
      throw new Error('collection literal');
    }
    expected.forEach(value => validateScalar(valueType, value));
    for (let index = 1; index < expected.length; index += 1) {
      if (compareScalar(valueType, expected[index - 1], expected[index]) >= 0) throw new Error('ordered collection');
    }
    return;
  }
  if (operator === 'between_inclusive') {
    if (!Array.isArray(expected) || expected.length !== 2) throw new Error('range literal');
    expected.forEach(value => validateScalar(valueType, value));
    if (compareScalar(valueType, expected[0], expected[1]) > 0) throw new Error('ordered range');
    return;
  }
  if (Array.isArray(expected) || expected === null) throw new Error('scalar literal');
  validateScalar(valueType, expected);
}

function collectPredicates(node, state, trusted, depth = 1, pathValue = '$') {
  if (depth > RULE_CONTRACT.bounds.maxConditionDepth) throw new Error('condition depth');
  state.nodes += 1;
  if (state.nodes > RULE_CONTRACT.bounds.maxConditionNodes) throw new Error('condition nodes');
  if (node.kind === 'group') {
    exact(node, RULE_CONTRACT.conditionGrammar.groupExactFields, 'group');
    if (!RULE_CONTRACT.conditionGrammar.groupOperators.includes(node.operator) || !Array.isArray(node.conditions) ||
        node.conditions.length < 1 || node.conditions.length > RULE_CONTRACT.bounds.maxGroupChildren) {
      throw new Error('group value');
    }
    node.conditions.forEach((child, index) => collectPredicates(child, state, trusted, depth + 1,
      `${pathValue}.conditions[${index}]`));
    return;
  }
  if (node.kind !== 'predicate') throw new Error('condition kind');
  exact(node, RULE_CONTRACT.conditionGrammar.predicateExactFields, 'predicate');
  const fact = RULE_CONTRACT.factCatalog.find(item => item.factRef === node.factRef);
  if (!fact || fact.valueType !== node.valueType) throw new Error('fact reference/type');
  if (node.unknownResult !== 'unknown' || node.unavailableResult !== 'unavailable') throw new Error('absence result');
  validateExpected(node.valueType, node.operator, node.expected);
  const values = Array.isArray(node.expected) ? node.expected : [node.expected];
  if (Array.isArray(fact.literalDomain) && values.some(value => !fact.literalDomain.includes(value))) {
    throw new Error('literal domain');
  }
  if (fact.literalDomain === 'exact_resolved_Part4A_trigger_ID_only' &&
      values.some(value => value !== trusted.trigger.triggerId)) throw new Error('trigger literal');
  if (fact.literalDomain === 'one_event_kind_from_exact_resolved_Part4A_trigger_row' &&
      values.some(value => !trusted.trigger.eventKinds.includes(value))) throw new Error('event kind literal');
  state.predicates.push({path: pathValue, factRef: node.factRef, valueType: node.valueType,
    operator: node.operator, expected: copy(node.expected)});
}

function validateRule(rule, trusted) {
  ownPlain(rule, 'rule');
  ownPlain(trusted, 'rule resolution');
  exact(rule, RULE_CONTRACT.ruleEnvelope.exactFields, 'rule');
  exact(rule.policyBinding, RULE_CONTRACT.ruleEnvelope.policyBindingExactFields, 'policy binding');
  exact(rule.sourceBinding, RULE_CONTRACT.ruleEnvelope.sourceBindingExactFields, 'source binding');
  exact(rule.actionTemplateBinding, RULE_CONTRACT.ruleEnvelope.actionTemplateBindingExactFields, 'template binding');
  exact(rule.bounds, RULE_CONTRACT.ruleEnvelope.boundsExactFields, 'bounds');
  exact(trusted, ['tenantId', 'policyBinding', 'sourceBinding', 'trigger', 'actionTemplateBinding'], 'rule resolution');
  exact(trusted.trigger, ['triggerId', 'sourceClassId', 'eventKinds', 'allowedActionFamilies'], 'trigger resolution');
  if (rule.schemaVersion !== RULE_CONTRACT.ruleEnvelope.schemaVersion) throw new Error('rule version');
  validateUuid(rule.tenantId, 'rule tenant');
  validateUuid(rule.ruleId, 'rule ID');
  validateDigest(rule.ruleDigest, 'rule');
  if (!same(rule.bounds, RULE_CONTRACT.bounds)) throw new Error('bounds mismatch');
  if (!same(rule.policyBinding, trusted.policyBinding) || !same(rule.sourceBinding, trusted.sourceBinding) ||
      !same(rule.actionTemplateBinding, trusted.actionTemplateBinding) || trusted.tenantId !== rule.tenantId) {
    throw new Error('rule resolution mismatch');
  }
  const trigger = TRIGGER_CONTRACT.triggers.find(item => item.id === rule.sourceBinding.triggerId);
  if (!trigger) throw new Error('trigger missing');
  const triggerProjection = {triggerId: trigger.id, sourceClassId: trigger.sourceClassId,
    eventKinds: trigger.eventTime.kinds.map(item => item.eventKind),
    allowedActionFamilies: copy(trigger.allowedActionFamilies)};
  if (!same(triggerProjection, trusted.trigger) || rule.sourceBinding.sourceClassId !== trigger.sourceClassId ||
      !trusted.trigger.eventKinds.includes(rule.sourceBinding.eventKind) ||
      !trusted.trigger.allowedActionFamilies.includes(rule.actionTemplateBinding.actionFamilyId)) {
    throw new Error('trigger compatibility');
  }
  const template = RULE_CONTRACT.approvedActionTemplates.find(item =>
    item.templateId === rule.actionTemplateBinding.templateId &&
    item.templateVersion === rule.actionTemplateBinding.templateVersion);
  if (!template) throw new Error('template missing');
  const templateProjection = {tenantId: rule.tenantId, templateId: template.templateId,
    templateVersion: template.templateVersion, templateDigest: template.templateDigest,
    actionFamilyId: template.actionFamilyId, capabilityId: template.capabilityId,
    channelId: template.channelId, providerMode: template.providerMode, effectClass: template.effectClass};
  if (!same(templateProjection, rule.actionTemplateBinding)) throw new Error('template mismatch');
  const state = {nodes: 0, predicates: []};
  collectPredicates(rule.condition, state, trusted);
  if (Buffer.byteLength(canonical.canonicalize(rule), 'utf8') > RULE_CONTRACT.bounds.maxCanonicalRuleBytes) {
    throw new Error('rule byte bound');
  }
  if (digestWithout(RULE_CONTRACT.ruleEnvelope.ruleDigestNamespace, rule, 'ruleDigest') !== rule.ruleDigest) {
    throw new Error('rule digest');
  }
  return state.predicates;
}

function evaluateComparison(type, operator, actual, expected) {
  const compared = Array.isArray(expected) ? null : compareScalar(type, actual, expected);
  if (operator === 'equals') return compared === 0;
  if (operator === 'not_equals') return compared !== 0;
  if (operator === 'less_than' || operator === 'before') return compared < 0;
  if (operator === 'less_than_or_equal' || operator === 'on_or_before') return compared <= 0;
  if (operator === 'greater_than' || operator === 'after') return compared > 0;
  if (operator === 'greater_than_or_equal' || operator === 'on_or_after') return compared >= 0;
  if (operator === 'in' || operator === 'not_in') {
    const present = expected.some(item => compareScalar(type, actual, item) === 0);
    return operator === 'in' ? present : !present;
  }
  if (operator === 'between_inclusive') {
    return compareScalar(type, actual, expected[0]) >= 0 && compareScalar(type, actual, expected[1]) <= 0;
  }
  throw new Error('unknown comparison');
}

function evaluateNode(node, facts, explanations, pathValue = '$') {
  if (node.kind === 'group') {
    const results = node.conditions.map((child, index) => evaluateNode(child, facts, explanations,
      `${pathValue}.conditions[${index}]`));
    if (results.includes('unavailable')) return 'unavailable';
    if (results.includes('unknown')) return 'unknown';
    if (node.operator === 'all') return results.every(item => item === 'match') ? 'match' : 'no_match';
    return results.includes('match') ? 'match' : 'no_match';
  }
  const fact = facts.find(item => item.factRef === node.factRef);
  let comparisonResult = fact.state;
  let reasonCode = fact.state === 'unknown' ? 'fact_unknown' : 'fact_unavailable';
  if (fact.state === 'known') {
    comparisonResult = evaluateComparison(node.valueType, node.operator, fact.value, node.expected) ? 'match' : 'no_match';
    reasonCode = comparisonResult === 'match' ? 'rule_match' : 'rule_no_match';
  }
  explanations.push({conditionPath: pathValue, factRef: node.factRef, valueType: node.valueType,
    operator: node.operator, factState: fact.state, comparisonResult, reasonCode});
  return comparisonResult;
}

function resolutionDigest(kind, value) {
  return digestWithout(CONTRACT.evaluationEnvelope.resolutionDigestNamespaces[kind], value, 'resolutionDigest');
}

function sealResolution(kind, value) {
  value.resolutionDigest = resolutionDigest(kind, value);
  return value;
}

function sourceBindingProjection(source) {
  return {tenantId: source.tenantId, triggerId: source.triggerId, sourceClassId: source.sourceClassId,
    recordIdentityDigest: source.recordIdentityDigest, eventKind: source.eventKind,
    headTransitionId: source.headTransitionId, headTransitionDigest: source.headTransitionDigest,
    headSequence: source.headSequence, effectiveSnapshotId: source.effectiveSnapshotId,
    effectiveSnapshotDigest: source.effectiveSnapshotDigest};
}

function factSourceValue(source, factRef) {
  const values = {
    'source.trigger_id': source.triggerId,
    'source.event_kind': source.eventKind,
    'source.currentness_state': source.currentnessState,
    'source.lineage_state': source.headState,
    'source.event_time': source.eventTime,
    'source.observed_at': source.observedAt,
    'source.lineage_sequence': source.headSequence,
    'source.record_identity_digest': source.recordIdentityDigest,
    'source.snapshot_digest': source.effectiveSnapshotDigest,
  };
  if (!Object.hasOwn(values, factRef)) throw new Error('unbound fact source');
  return values[factRef];
}

function sealContext(context) {
  context.policyResolution = sealResolution('policy', context.policyResolution);
  context.sourceResolution.sourceBindingDigest = canonical.digest(
    CONTRACT.evaluationEnvelope.sourceBindingDigestNamespace, sourceBindingProjection(context.sourceResolution));
  context.sourceResolution = sealResolution('source', context.sourceResolution);
  context.suppressionResolution = sealResolution('suppression', context.suppressionResolution);
  context.authorizationResolution = sealResolution('authorization', context.authorizationResolution);
  context.clockResolution = sealResolution('clock', context.clockResolution);
  context.contextDigest = digestWithout(CONTRACT.evaluationEnvelope.trustedContextDigestNamespace,
    context, 'contextDigest');
  return context;
}

function sealFact(fact) {
  fact.factDigest = digestWithout(CONTRACT.evaluationEnvelope.factDigestNamespace, fact, 'factDigest');
  return fact;
}

function sealRule(rule) {
  rule.ruleDigest = digestWithout(RULE_CONTRACT.ruleEnvelope.ruleDigestNamespace, rule, 'ruleDigest');
  return rule;
}

function sealInput(input) {
  input.inputDigest = digestWithout(CONTRACT.evaluationEnvelope.inputDigestNamespace, input, 'inputDigest');
  return input;
}

function validateResolutionPrimitives(context, evaluatedAt) {
  const envelope = CONTRACT.evaluationEnvelope;
  exact(context, envelope.trustedContextExactFields, 'context');
  exact(context.policyResolution, envelope.policyResolutionExactFields, 'policy resolution');
  exact(context.sourceResolution, envelope.sourceResolutionExactFields, 'source resolution');
  exact(context.suppressionResolution, envelope.suppressionResolutionExactFields, 'suppression resolution');
  exact(context.authorizationResolution, envelope.authorizationResolutionExactFields, 'authorization resolution');
  exact(context.clockResolution, envelope.clockResolutionExactFields, 'clock resolution');
  validateUuid(context.tenantId, 'context tenant');
  for (const resolution of [context.policyResolution, context.sourceResolution, context.suppressionResolution,
    context.authorizationResolution, context.clockResolution]) {
    if (resolution.tenantId !== context.tenantId) throw new Error('resolution tenant');
  }
  const policy = context.policyResolution;
  validateUuid(policy.policyId, 'policy ID');
  if (!Number.isSafeInteger(policy.policyVersion) || policy.policyVersion < 1) throw new Error('policy version');
  validateDigest(policy.policyDigest, 'policy');
  validateUuid(policy.lifecycleEventId, 'lifecycle event');
  validateDigest(policy.lifecycleEventDigest, 'lifecycle event');
  if (!CONTRACT.resolutionStates.policy.includes(policy.state)) throw new Error('policy state');
  if (policy.expiresAt !== null) validateUtc(policy.expiresAt, 'policy expiry');
  if (policy.state === 'active_exact_current' && policy.expiresAt !== null && policy.expiresAt <= evaluatedAt) {
    throw new Error('active expired policy');
  }
  if (policy.state === 'expired' && (policy.expiresAt === null || policy.expiresAt > evaluatedAt)) {
    throw new Error('expiry coherence');
  }
  const source = context.sourceResolution;
  validateToken(source.triggerId, 'trigger');
  validateToken(source.sourceClassId, 'source class');
  validateDigest(source.recordIdentityDigest, 'record identity');
  validateToken(source.eventKind, 'event kind');
  validateUuid(source.headTransitionId, 'head transition');
  validateDigest(source.headTransitionDigest, 'head transition');
  if (!Number.isSafeInteger(source.headSequence) || source.headSequence < 1) throw new Error('head sequence');
  if (!CONTRACT.resolutionStates.sourceHead.includes(source.headState)) throw new Error('source head state');
  validateUuid(source.effectiveSnapshotId, 'snapshot');
  validateDigest(source.effectiveSnapshotDigest, 'snapshot');
  validateUtc(source.eventTime, 'source event time');
  validateUtc(source.observedAt, 'source observed at');
  if (source.observedAt > evaluatedAt) throw new Error('source observed after evaluation');
  validateDigest(source.sourceBindingDigest, 'source binding');
  validateDigest(source.sourceSetDigest, 'source set');
  if (!CONTRACT.resolutionStates.source.includes(source.currentnessState)) throw new Error('source currentness');
  if (source.currentnessState === 'latest_exact_current') {
    validateUuid(source.Part4CResolutionEpochId, 'Part4C epoch');
    validateDigest(source.Part4CResolutionDigest, 'Part4C resolution');
  } else if (source.Part4CResolutionEpochId !== null || source.Part4CResolutionDigest !== null) {
    throw new Error('noncurrent Part4C receipt');
  }
  const suppression = context.suppressionResolution;
  if (!CONTRACT.resolutionStates.suppression.includes(suppression.state)) throw new Error('suppression state');
  validateUuid(suppression.snapshotId, 'suppression snapshot');
  validateDigest(suppression.snapshotDigest, 'suppression snapshot');
  if (suppression.state === 'exact_current_matched') {
    validateUuid(suppression.matchedSuppressionId, 'matched suppression');
    validateDigest(suppression.matchedSuppressionDigest, 'matched suppression');
    if (suppression.endsAt !== null) {
      validateUtc(suppression.endsAt, 'suppression end');
      if (suppression.endsAt <= evaluatedAt) throw new Error('matched suppression expired');
    }
  } else if (suppression.matchedSuppressionId !== null || suppression.matchedSuppressionDigest !== null ||
      suppression.endsAt !== null) throw new Error('suppression coherence');
  const authorization = context.authorizationResolution;
  if (!CONTRACT.resolutionStates.authorization.includes(authorization.state)) throw new Error('authorization state');
  if (authorization.state === 'required' || authorization.state === 'unavailable') {
    for (const key of ['authorizationId', 'authorizationKind', 'authorizationRecordDigest',
      'authorizationMaterialBindingDigest', 'policyId', 'policyVersion', 'policyDigest', 'sourceSetDigest',
      'previewId', 'previewDigest', 'recipientSetId', 'recipientSetDigest', 'recipientClassIds',
      'effectSetId', 'effectSetDigest', 'actionFamilyId', 'channelIds', 'providerModeIds', 'effectClass',
      'kindSubjectRecordType', 'kindSubjectRecordId', 'kindSubjectRecordDigest', 'kindRunId', 'expiresAt']) {
      if (authorization[key] !== null) throw new Error('empty authorization coherence');
    }
  } else {
    validateUuid(authorization.authorizationId, 'authorization');
    if (!CONTRACT.trustedResolutionContract.authorizationKinds.includes(authorization.authorizationKind)) {
      throw new Error('authorization kind');
    }
    validateDigest(authorization.authorizationRecordDigest, 'authorization record');
    validateDigest(authorization.authorizationMaterialBindingDigest, 'authorization material');
    validateUuid(authorization.policyId, 'authorization policy');
    if (!Number.isSafeInteger(authorization.policyVersion) || authorization.policyVersion < 1) {
      throw new Error('authorization policy version');
    }
    validateDigest(authorization.policyDigest, 'authorization policy');
    validateDigest(authorization.sourceSetDigest, 'authorization source set');
    validateUuid(authorization.previewId, 'authorization preview');
    validateDigest(authorization.previewDigest, 'authorization preview');
    validateUuid(authorization.recipientSetId, 'recipient set');
    validateToken(authorization.actionFamilyId, 'authorization family');
    validateDigest(authorization.recipientSetDigest, 'recipient set');
    validateUuid(authorization.effectSetId, 'effect set');
    validateDigest(authorization.effectSetDigest, 'effect set');
    const launchRule = AUTH_CONTRACT.recordGrammar.firstLaunchBindingRules[authorization.actionFamilyId];
    const recipients = authorization.recipientClassIds;
    const orderedRecipients = launchRule && Array.isArray(recipients) && recipients.length > 0 &&
      new Set(recipients).size === recipients.length &&
      recipients.every((item, index) => launchRule.recipientClassIds.indexOf(item) >
        (index === 0 ? -1 : launchRule.recipientClassIds.indexOf(recipients[index - 1])));
    if (!orderedRecipients ||
        !same(authorization.channelIds, launchRule.channelIds) ||
        !same(authorization.providerModeIds, launchRule.providerModeIds) ||
        authorization.effectClass !== launchRule.effectClass) throw new Error('authorization effect');
    validateToken(authorization.kindSubjectRecordType, 'kind subject type');
    validateUuid(authorization.kindSubjectRecordId, 'kind subject');
    validateDigest(authorization.kindSubjectRecordDigest, 'kind subject');
    if (authorization.authorizationKind === 'per_run_approval') {
      if (authorization.kindSubjectRecordType !== 'proposed_action') throw new Error('per-run subject');
      validateUuid(authorization.kindRunId, 'kind run');
    } else if (authorization.kindSubjectRecordType !== 'policy_version' ||
        authorization.kindSubjectRecordId !== authorization.policyId ||
        authorization.kindSubjectRecordDigest !== authorization.policyDigest || authorization.kindRunId !== null) {
      throw new Error('standing subject');
    }
    validateUtc(authorization.expiresAt, 'authorization expiry');
    if (authorization.state === 'exact_current_satisfied' && authorization.expiresAt <= evaluatedAt) {
      throw new Error('satisfied authorization expired');
    }
    if (authorization.state === 'expired' && authorization.expiresAt > evaluatedAt) {
      throw new Error('authorization expiry coherence');
    }
  }
  const clock = context.clockResolution;
  validateUuid(clock.clockEvidenceId, 'clock evidence');
  validateDigest(clock.clockEvidenceDigest, 'clock evidence');
  validateUtc(clock.evaluatedAt, 'clock time');
  if (clock.evaluatedAt !== evaluatedAt) throw new Error('clock mismatch');
  let previous = null;
  const order = CONTRACT.nextEvaluationContract.candidateKinds;
  for (const candidate of context.nextEvaluationCandidates) {
    exact(candidate, envelope.nextEvaluationCandidateExactFields, 'next evaluation candidate');
    if (!order.includes(candidate.kind)) throw new Error('next candidate kind');
    validateUtc(candidate.instant, 'next candidate');
    validateDigest(candidate.basisDigest, 'next candidate basis');
    if (candidate.instant <= evaluatedAt) throw new Error('next candidate not future');
    if (candidate.kind === 'source_recheck' && candidate.basisDigest !== source.resolutionDigest) {
      throw new Error('source recheck basis');
    }
    if (candidate.kind === 'policy_expiry' &&
        (candidate.instant !== policy.expiresAt || candidate.basisDigest !== policy.resolutionDigest)) {
      throw new Error('policy expiry candidate');
    }
    if (candidate.kind === 'suppression_expiry' &&
        (suppression.state !== 'exact_current_matched' || candidate.instant !== suppression.endsAt ||
         candidate.basisDigest !== suppression.resolutionDigest)) throw new Error('suppression expiry candidate');
    const key = `${candidate.instant}|${String(order.indexOf(candidate.kind)).padStart(2, '0')}`;
    if (previous !== null && key <= previous) throw new Error('next candidates order');
    previous = key;
  }
  for (const [kind, resolution] of [['policy', policy], ['source', source], ['suppression', suppression],
    ['authorization', authorization], ['clock', clock]]) {
    if (resolutionDigest(kind, resolution) !== resolution.resolutionDigest) throw new Error(`${kind} resolution digest`);
  }
  if (canonical.digest(envelope.sourceBindingDigestNamespace, sourceBindingProjection(source)) !==
      source.sourceBindingDigest) throw new Error('source binding digest');
  if (digestWithout(envelope.trustedContextDigestNamespace, context, 'contextDigest') !== context.contextDigest) {
    throw new Error('context digest');
  }
}

function validateAndEvaluate(input, trusted) {
  ownPlain(input, 'input');
  ownPlain(trusted, 'trusted');
  exact(input, CONTRACT.evaluationEnvelope.exactFields, 'input');
  exact(trusted, ['tenantId', 'evaluationId', 'ruleResolution', 'facts', 'context'], 'trusted');
  if (input.schemaVersion !== CONTRACT.evaluationEnvelope.schemaVersion) throw new Error('input version');
  validateUuid(input.tenantId, 'input tenant');
  validateUuid(input.evaluationId, 'evaluation');
  validateUtc(input.evaluatedAt, 'evaluated at');
  validateDigest(input.inputDigest, 'input');
  if (trusted.tenantId !== input.tenantId || trusted.evaluationId !== input.evaluationId ||
      !same(input.facts, trusted.facts) ||
      !same(input.trustedContext, trusted.context)) throw new Error('trusted input mismatch');
  const predicates = validateRule(input.rule, trusted.ruleResolution);
  if (input.rule.tenantId !== input.tenantId) throw new Error('rule tenant mismatch');
  const uniqueFactRefs = [];
  for (const predicate of predicates) if (!uniqueFactRefs.includes(predicate.factRef)) uniqueFactRefs.push(predicate.factRef);
  if (!Array.isArray(input.facts) || input.facts.length !== uniqueFactRefs.length) throw new Error('fact set cardinality');
  input.facts.forEach((fact, index) => {
    exact(fact, CONTRACT.evaluationEnvelope.factExactFields, 'fact');
    if (fact.factRef !== uniqueFactRefs[index]) throw new Error('fact order');
    const catalog = RULE_CONTRACT.factCatalog.find(item => item.factRef === fact.factRef);
    if (!catalog || catalog.valueType !== fact.valueType) throw new Error('fact type');
    if (!CONTRACT.resolutionStates.fact.includes(fact.state)) throw new Error('fact state');
    if (fact.sourceBindingDigest !== input.trustedContext.sourceResolution.sourceBindingDigest) {
      throw new Error('fact source binding');
    }
    if (fact.state === 'known') validateScalar(fact.valueType, fact.value);
    else if (fact.value !== null) throw new Error('absent fact value');
    if (fact.state === 'known' && !same(fact.value,
      factSourceValue(input.trustedContext.sourceResolution, fact.factRef))) {
      throw new Error('fact source value');
    }
    if (digestWithout(CONTRACT.evaluationEnvelope.factDigestNamespace, fact, 'factDigest') !== fact.factDigest) {
      throw new Error('fact digest');
    }
  });
  validateResolutionPrimitives(input.trustedContext, input.evaluatedAt);
  const context = input.trustedContext;
  if (context.tenantId !== input.tenantId || context.policyResolution.tenantId !== input.tenantId ||
      !same(input.rule.policyBinding, {tenantId: input.tenantId, policyId: context.policyResolution.policyId,
        policyVersion: context.policyResolution.policyVersion, policyDigest: context.policyResolution.policyDigest}) ||
      !same(input.rule.sourceBinding, sourceBindingProjection(context.sourceResolution))) {
    throw new Error('policy/source context binding');
  }
  const authorization = context.authorizationResolution;
  if (authorization.state === 'exact_current_satisfied' || authorization.state === 'expired') {
    if (authorization.policyId !== context.policyResolution.policyId ||
        authorization.policyVersion !== context.policyResolution.policyVersion ||
        authorization.policyDigest !== context.policyResolution.policyDigest ||
        authorization.sourceSetDigest !== context.sourceResolution.sourceSetDigest ||
        authorization.actionFamilyId !== input.rule.actionTemplateBinding.actionFamilyId ||
        !same(authorization.channelIds, [input.rule.actionTemplateBinding.channelId]) ||
        !same(authorization.providerModeIds, [input.rule.actionTemplateBinding.providerMode]) ||
        CONTRACT.trustedResolutionContract.templateToAuthorizationEffectClassMapping[
          input.rule.actionTemplateBinding.effectClass] !== authorization.effectClass) {
      throw new Error('authorization material mismatch');
    }
  }
  if (digestWithout(CONTRACT.evaluationEnvelope.inputDigestNamespace, input, 'inputDigest') !== input.inputDigest) {
    throw new Error('input digest');
  }
  const explanations = [];
  const ruleResult = evaluateNode(input.rule.condition, input.facts, explanations);
  let result;
  let reasonCodes;
  if (context.policyResolution.state === 'unavailable') {
    result = 'unavailable'; reasonCodes = ['trusted_policy_unavailable'];
  } else if (context.sourceResolution.currentnessState !== 'latest_exact_current') {
    result = 'unavailable'; reasonCodes = ['source_not_latest_exact_current'];
  } else if (context.suppressionResolution.state === 'unavailable') {
    result = 'unavailable'; reasonCodes = ['suppression_resolution_unavailable'];
  } else if (context.authorizationResolution.state === 'unavailable') {
    result = 'unavailable'; reasonCodes = ['authorization_resolution_unavailable'];
  } else if (ruleResult === 'unavailable') {
    result = 'unavailable'; reasonCodes = ['fact_unavailable'];
  } else if (ruleResult === 'unknown') {
    result = 'unavailable'; reasonCodes = ['fact_unknown'];
  } else if (context.policyResolution.state === 'expired') {
    result = 'expired'; reasonCodes = ['policy_expired'];
  } else if (context.sourceResolution.headState !== 'active') {
    result = 'ineligible'; reasonCodes = ['source_lineage_ineligible'];
  } else if (context.suppressionResolution.state === 'exact_current_matched') {
    result = 'suppressed'; reasonCodes = ['suppression_matched'];
  } else if (ruleResult === 'no_match') {
    result = 'ineligible'; reasonCodes = ['rule_no_match'];
  } else if (context.authorizationResolution.state === 'required') {
    result = 'approval_required'; reasonCodes = ['rule_match', 'authorization_required'];
  } else if (context.authorizationResolution.state === 'expired') {
    result = 'approval_required'; reasonCodes = ['rule_match', 'authorization_expired'];
  } else {
    result = 'eligible'; reasonCodes = ['rule_match', 'all_required_contract_authority_current'];
  }
  let evidenceQuality = 'complete_exact';
  if (context.policyResolution.state === 'unavailable' ||
      context.sourceResolution.currentnessState !== 'latest_exact_current' ||
      context.suppressionResolution.state === 'unavailable' ||
      context.authorizationResolution.state === 'unavailable' ||
      input.facts.some(fact => fact.state === 'unavailable')) evidenceQuality = 'unavailable';
  else if (input.facts.some(fact => fact.state === 'unknown')) evidenceQuality = 'partial_unknown';
  const relevant = CONTRACT.nextEvaluationContract.relevantKindsByResult[result];
  const candidate = context.nextEvaluationCandidates.find(item => relevant.includes(item.kind));
  const nextEvaluationAt = candidate ? candidate.instant : null;
  const factSetDigest = canonical.digest(CONTRACT.evaluationEnvelope.factSetDigestNamespace, input.facts);
  const output = {
    schemaVersion: CONTRACT.outputEnvelope.schemaVersion,
    tenantId: input.tenantId,
    evaluationId: input.evaluationId,
    policyBinding: {policyId: input.rule.policyBinding.policyId,
      policyVersion: input.rule.policyBinding.policyVersion, policyDigest: input.rule.policyBinding.policyDigest},
    ruleBinding: {ruleId: input.rule.ruleId, ruleDigest: input.rule.ruleDigest,
      actionTemplateId: input.rule.actionTemplateBinding.templateId,
      actionTemplateDigest: input.rule.actionTemplateBinding.templateDigest,
      actionFamilyId: input.rule.actionTemplateBinding.actionFamilyId},
    sourceBindingDigest: context.sourceResolution.sourceBindingDigest,
    factSetDigest,
    inputDigest: input.inputDigest,
    result,
    reasonCodes,
    evidenceQuality,
    predicateExplanations: explanations,
    nextEvaluationAt,
    evaluatedAt: input.evaluatedAt,
    outputDigest: '',
  };
  output.outputDigest = digestWithout(CONTRACT.outputEnvelope.outputDigestNamespace, output, 'outputDigest');
  return deepFreeze(output);
}

function makeFixture() {
  const trigger = TRIGGER_CONTRACT.triggers.find(item => item.id === 'm20.lead_contact_state');
  const template = RULE_CONTRACT.approvedActionTemplates.find(item => item.templateId === 'internal_fact_digest_v1');
  const policyBinding = {tenantId: TENANT, policyId: '00000000-0000-4000-8000-000000000501',
    policyVersion: 3, policyDigest: `sha256:${'5'.repeat(64)}`};
  const sourceBinding = {tenantId: TENANT, triggerId: trigger.id, sourceClassId: trigger.sourceClassId,
    recordIdentityDigest: `sha256:${'6'.repeat(64)}`, eventKind: trigger.eventTime.kinds[0].eventKind,
    headTransitionId: '00000000-0000-4000-8000-000000000502',
    headTransitionDigest: `sha256:${'7'.repeat(64)}`, headSequence: 4,
    effectiveSnapshotId: '00000000-0000-4000-8000-000000000503',
    effectiveSnapshotDigest: `sha256:${'8'.repeat(64)}`};
  const actionTemplateBinding = {tenantId: TENANT, templateId: template.templateId,
    templateVersion: template.templateVersion, templateDigest: template.templateDigest,
    actionFamilyId: template.actionFamilyId, capabilityId: template.capabilityId,
    channelId: template.channelId, providerMode: template.providerMode, effectClass: template.effectClass};
  const rule = sealRule({schemaVersion: RULE_CONTRACT.ruleEnvelope.schemaVersion, tenantId: TENANT,
    ruleId: '00000000-0000-4000-8000-000000000504', policyBinding, sourceBinding,
    condition: {kind: 'group', operator: 'all', conditions: [
      {kind: 'predicate', factRef: 'source.currentness_state', valueType: 'token', operator: 'equals',
        expected: 'latest_exact_current', unknownResult: 'unknown', unavailableResult: 'unavailable'},
      {kind: 'predicate', factRef: 'source.lineage_sequence', valueType: 'integer',
        operator: 'greater_than_or_equal', expected: 1, unknownResult: 'unknown', unavailableResult: 'unavailable'},
    ]}, actionTemplateBinding, bounds: copy(RULE_CONTRACT.bounds), ruleDigest: ''});
  const evaluatedAt = '2026-10-28T12:00:00.000Z';
  const context = sealContext({tenantId: TENANT,
    policyResolution: {tenantId: TENANT, policyId: policyBinding.policyId,
      policyVersion: policyBinding.policyVersion, policyDigest: policyBinding.policyDigest,
      lifecycleEventId: '00000000-0000-4000-8000-000000000505',
      lifecycleEventDigest: `sha256:${'a'.repeat(64)}`, state: 'active_exact_current',
      expiresAt: '2026-12-01T00:00:00.000Z', resolutionDigest: ''},
    sourceResolution: {tenantId: sourceBinding.tenantId, triggerId: sourceBinding.triggerId,
      sourceClassId: sourceBinding.sourceClassId, recordIdentityDigest: sourceBinding.recordIdentityDigest,
      eventKind: sourceBinding.eventKind, headTransitionId: sourceBinding.headTransitionId,
      headTransitionDigest: sourceBinding.headTransitionDigest, headSequence: sourceBinding.headSequence,
      headState: 'active', effectiveSnapshotId: sourceBinding.effectiveSnapshotId,
      effectiveSnapshotDigest: sourceBinding.effectiveSnapshotDigest,
      eventTime: '2026-10-28T11:45:00.000Z', observedAt: '2026-10-28T11:30:00.000Z',
      sourceBindingDigest: '', sourceSetDigest: `sha256:${'9'.repeat(64)}`,
      currentnessState: 'latest_exact_current',
      Part4CResolutionEpochId: '00000000-0000-4000-8000-000000000506',
      Part4CResolutionDigest: `sha256:${'b'.repeat(64)}`, resolutionDigest: ''},
    suppressionResolution: {tenantId: TENANT, state: 'exact_current_clear',
      snapshotId: '00000000-0000-4000-8000-000000000507', snapshotDigest: `sha256:${'c'.repeat(64)}`,
      matchedSuppressionId: null, matchedSuppressionDigest: null, endsAt: null, resolutionDigest: ''},
    authorizationResolution: {tenantId: TENANT, state: 'exact_current_satisfied',
      authorizationId: '00000000-0000-4000-8000-000000000508', authorizationKind: 'per_run_approval',
      authorizationRecordDigest: `sha256:${'d'.repeat(64)}`,
      authorizationMaterialBindingDigest: `sha256:${'e'.repeat(64)}`,
      policyId: policyBinding.policyId, policyVersion: policyBinding.policyVersion,
      policyDigest: policyBinding.policyDigest, sourceSetDigest: `sha256:${'9'.repeat(64)}`,
      previewId: '00000000-0000-4000-8000-000000000512', previewDigest: `sha256:${'0'.repeat(64)}`,
      recipientSetId: '00000000-0000-4000-8000-000000000513',
      recipientSetDigest: `sha256:${'1'.repeat(64)}`, recipientClassIds: ['tenant_owner'],
      effectSetId: '00000000-0000-4000-8000-000000000514', effectSetDigest: `sha256:${'2'.repeat(64)}`,
      actionFamilyId: template.actionFamilyId, channelIds: ['in_app_passive'],
      providerModeIds: ['provider_disabled'], effectClass: 'internal_only_no_external_effect',
      kindSubjectRecordType: 'proposed_action',
      kindSubjectRecordId: '00000000-0000-4000-8000-000000000515',
      kindSubjectRecordDigest: `sha256:${'f'.repeat(64)}`,
      kindRunId: '00000000-0000-4000-8000-000000000516',
      expiresAt: '2026-11-01T00:00:00.000Z', resolutionDigest: ''},
    clockResolution: {tenantId: TENANT, clockEvidenceId: '00000000-0000-4000-8000-000000000509',
      clockEvidenceDigest: `sha256:${'3'.repeat(64)}`, evaluatedAt, resolutionDigest: ''},
    nextEvaluationCandidates: [], contextDigest: ''});
  context.nextEvaluationCandidates = [
    {kind: 'source_recheck', instant: '2026-10-28T13:00:00.000Z',
      basisDigest: context.sourceResolution.resolutionDigest},
    {kind: 'policy_expiry', instant: context.policyResolution.expiresAt,
      basisDigest: context.policyResolution.resolutionDigest},
  ];
  context.contextDigest = digestWithout(CONTRACT.evaluationEnvelope.trustedContextDigestNamespace,
    context, 'contextDigest');
  const facts = [
    sealFact({factRef: 'source.currentness_state', valueType: 'token', state: 'known',
      value: 'latest_exact_current', sourceBindingDigest: context.sourceResolution.sourceBindingDigest, factDigest: ''}),
    sealFact({factRef: 'source.lineage_sequence', valueType: 'integer', state: 'known', value: 4,
      sourceBindingDigest: context.sourceResolution.sourceBindingDigest, factDigest: ''}),
  ];
  const ruleResolution = {tenantId: TENANT, policyBinding: copy(policyBinding), sourceBinding: copy(sourceBinding),
    trigger: {triggerId: trigger.id, sourceClassId: trigger.sourceClassId,
      eventKinds: trigger.eventTime.kinds.map(item => item.eventKind),
      allowedActionFamilies: copy(trigger.allowedActionFamilies)}, actionTemplateBinding: copy(actionTemplateBinding)};
  const input = sealInput({schemaVersion: CONTRACT.evaluationEnvelope.schemaVersion, tenantId: TENANT,
    evaluationId: '00000000-0000-4000-8000-000000000510', rule, facts, trustedContext: context,
    evaluatedAt, inputDigest: ''});
  const trusted = {tenantId: TENANT, evaluationId: input.evaluationId,
    ruleResolution, facts: copy(facts), context: copy(context)};
  return {input, trusted};
}

function resealFixture(fixture) {
  fixture.input.rule = sealRule(fixture.input.rule);
  fixture.input.trustedContext = sealContext(fixture.input.trustedContext);
  fixture.input.trustedContext.nextEvaluationCandidates = fixture.input.trustedContext.nextEvaluationCandidates
    .filter(candidate => {
      if (candidate.kind === 'policy_expiry') {
        return fixture.input.trustedContext.policyResolution.expiresAt > fixture.input.evaluatedAt;
      }
      if (candidate.kind === 'suppression_expiry') {
        return fixture.input.trustedContext.suppressionResolution.state === 'exact_current_matched' &&
          fixture.input.trustedContext.suppressionResolution.endsAt > fixture.input.evaluatedAt;
      }
      return true;
    })
    .map(candidate => {
      if (candidate.kind === 'source_recheck') return {...candidate,
        basisDigest: fixture.input.trustedContext.sourceResolution.resolutionDigest};
      if (candidate.kind === 'policy_expiry') return {...candidate,
        instant: fixture.input.trustedContext.policyResolution.expiresAt,
        basisDigest: fixture.input.trustedContext.policyResolution.resolutionDigest};
      return {...candidate, instant: fixture.input.trustedContext.suppressionResolution.endsAt,
        basisDigest: fixture.input.trustedContext.suppressionResolution.resolutionDigest};
    });
  fixture.input.trustedContext.contextDigest = digestWithout(
    CONTRACT.evaluationEnvelope.trustedContextDigestNamespace, fixture.input.trustedContext, 'contextDigest');
  fixture.input.facts.forEach(fact => {
    fact.sourceBindingDigest = fixture.input.trustedContext.sourceResolution.sourceBindingDigest;
    sealFact(fact);
  });
  fixture.input = sealInput(fixture.input);
  fixture.trusted.facts = copy(fixture.input.facts);
  fixture.trusted.context = copy(fixture.input.trustedContext);
  fixture.trusted.ruleResolution.policyBinding = copy(fixture.input.rule.policyBinding);
  fixture.trusted.ruleResolution.sourceBinding = copy(fixture.input.rule.sourceBinding);
  fixture.trusted.ruleResolution.actionTemplateBinding = copy(fixture.input.rule.actionTemplateBinding);
  return fixture;
}

describe('Mission 28 Part 5B deterministic explainable evaluator', () => {
  test('binds the exact Part5A release, frozen contracts and contract-only authority', () => {
    expect(CONTRACT.authority).toEqual(expect.objectContaining({mission: 28, part: '5B',
      state: 'implementation_candidate_only', baselineCommit: '0b86beab6d0ac3f81a079d47f8569e8e24c34de7',
      baselineTree: '12f4e02e10c4b507a8e9b76e81dcff078318059b',
      sourceContractAndExecutableAcceptanceOnly: true,
      mountedRuntimeEvaluatorResolverRouteSchedulerWorkerOrEffectExecutorAvailable: false,
      eligibilityResultCreatesApprovalSchedulingRecipientProviderEffectUpstreamMutationAccountingOrMoneyAuthority: false}));
    expect(CONTRACT.part5ARelease).toEqual(expect.objectContaining({
      acceptedSourceHead: '973175776028b563bd5f4a8b1d1282c1ddd9aa05',
      acceptedTree: '12f4e02e10c4b507a8e9b76e81dcff078318059b', pullRequest: 565,
      mergedMain: '0b86beab6d0ac3f81a079d47f8569e8e24c34de7',
      deployment: '9973fa71-fbfc-4079-b345-cdf2c5f3ab1b', deploymentState: 'SUCCESS_RUNNING',
      auditVerdict: 'P0=P1=P2=P3=0'}));
    expect(CONTRACT.frozenInputs.map(item => normalizedLfSha256(item.path)))
      .toEqual(CONTRACT.frozenInputs.map(item => item.normalizedLfSha256));
  });

  test('produces one deterministic eligible output with exact policy source fact input and output digests', () => {
    const fixture = makeFixture();
    const first = validateAndEvaluate(fixture.input, fixture.trusted);
    const second = validateAndEvaluate(copy(fixture.input), copy(fixture.trusted));
    expect(second).toEqual(first);
    expect(first).toEqual(expect.objectContaining({result: 'eligible',
      reasonCodes: ['rule_match', 'all_required_contract_authority_current'], evidenceQuality: 'complete_exact',
      nextEvaluationAt: '2026-10-28T13:00:00.000Z', evaluatedAt: fixture.input.evaluatedAt}));
    expect(first.predicateExplanations).toHaveLength(2);
    expect(Object.keys(first)).toEqual(CONTRACT.outputEnvelope.exactFields);
    for (const explanation of first.predicateExplanations) {
      expect(Object.keys(explanation)).toEqual(CONTRACT.outputEnvelope.predicateExplanationExactFields);
      expect(CONTRACT.reasonContract.closedCodes).toContain(explanation.reasonCode);
    }
    expect(first.outputDigest).toMatch(DIGEST);
    expect(digestWithout(CONTRACT.outputEnvelope.outputDigestNamespace, first, 'outputDigest')).toBe(first.outputDigest);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.reasonCodes)).toBe(true);
    expect(Object.isFrozen(first.predicateExplanations[0])).toBe(true);
    expect(fixture.input.trustedContext.sourceResolution.eventTime >
      fixture.input.trustedContext.sourceResolution.observedAt).toBe(true);
    expect(fixture.input.trustedContext.sourceResolution.observedAt <= fixture.input.evaluatedAt).toBe(true);
  });

  test('allows future-effective source time but rejects observation after the trusted evaluation clock', () => {
    const accepted = makeFixture();
    expect(() => validateAndEvaluate(accepted.input, accepted.trusted)).not.toThrow();
    const futureObservation = makeFixture();
    futureObservation.input.trustedContext.sourceResolution.observedAt = '2026-10-28T12:30:00.000Z';
    futureObservation.input.trustedContext = sealContext(futureObservation.input.trustedContext);
    futureObservation.input = sealInput(futureObservation.input);
    futureObservation.trusted.context = copy(futureObservation.input.trustedContext);
    expect(() => validateAndEvaluate(futureObservation.input, futureObservation.trusted))
      .toThrow('source observed after evaluation');
  });

  test('evaluates every released Part5A type/operator pair without coercion or floating decimal aliases', () => {
    const values = {
      boolean: {low: false, actual: true, high: true},
      token: {low: 'alpha', actual: 'middle', high: 'zulu'},
      bounded_text: {low: 'Alpha', actual: 'Middle', high: 'Zulu'},
      integer: {low: 1, actual: 2, high: 3},
      decimal: {low: '1.1', actual: '2', high: '10'},
      utc_instant: {low: '2026-10-28T11:00:00.000Z', actual: '2026-10-28T12:00:00.000Z',
        high: '2026-10-28T13:00:00.000Z'},
      uuid: {low: '00000000-0000-4000-8000-000000000501',
        actual: '00000000-0000-4000-8000-000000000502',
        high: '00000000-0000-4000-8000-000000000503'},
      digest: {low: `sha256:${'1'.repeat(64)}`, actual: `sha256:${'2'.repeat(64)}`,
        high: `sha256:${'3'.repeat(64)}`},
    };
    for (const row of RULE_CONTRACT.typeCompatibilityMatrix) {
      const value = values[row.valueType];
      for (const operator of row.operators) {
        let expected = value.actual;
        if (operator === 'not_equals') expected = value.low;
        if (operator === 'in') expected = [value.actual];
        if (operator === 'not_in') expected = [value.low];
        if (['less_than', 'before'].includes(operator)) expected = value.high;
        if (['less_than_or_equal', 'on_or_before'].includes(operator)) expected = value.actual;
        if (['greater_than', 'after'].includes(operator)) expected = value.low;
        if (['greater_than_or_equal', 'on_or_after'].includes(operator)) expected = value.actual;
        if (operator === 'between_inclusive') expected = [value.low, value.high];
        validateExpected(row.valueType, operator, expected);
        expect(evaluateComparison(row.valueType, operator, value.actual, expected)).toBe(true);
      }
    }
    expect(compareDecimal('10', '2')).toBe(1);
    expect(compareDecimal('0', '0')).toBe(0);
    expect(() => validateScalar('decimal', 1.2)).toThrow();
    expect(() => validateScalar('integer', '2')).toThrow();
    expect(() => validateScalar('utc_instant', new Date('2026-10-28T12:00:00.000Z'))).toThrow();
  });

  test('preserves conservative unavailable then unknown precedence for both all and any groups', () => {
    const conditions = [
      {kind: 'predicate', factRef: 'source.currentness_state', valueType: 'token', operator: 'equals',
        expected: 'latest_exact_current'},
      {kind: 'predicate', factRef: 'source.lineage_sequence', valueType: 'integer',
        operator: 'greater_than_or_equal', expected: 1},
    ];
    const group = operator => ({kind: 'group', operator, conditions});
    const facts = (firstState, firstValue, secondState, secondValue) => [
      {factRef: 'source.currentness_state', state: firstState, value: firstValue},
      {factRef: 'source.lineage_sequence', state: secondState, value: secondValue},
    ];
    expect(evaluateNode(group('all'), facts('known', 'latest_exact_current', 'known', 4), [])).toBe('match');
    expect(evaluateNode(group('all'), facts('known', 'latest_exact_current', 'known', 0), [])).toBe('no_match');
    expect(evaluateNode(group('any'), facts('known', 'latest_exact_current', 'known', 0), [])).toBe('match');
    expect(evaluateNode(group('any'), facts('known', 'stale', 'known', 0), [])).toBe('no_match');
    expect(evaluateNode(group('all'), facts('unknown', null, 'known', 0), [])).toBe('unknown');
    expect(evaluateNode(group('any'), facts('unknown', null, 'known', 4), [])).toBe('unknown');
    expect(evaluateNode(group('all'), facts('unavailable', null, 'unknown', null), [])).toBe('unavailable');
    expect(evaluateNode(group('any'), facts('unavailable', null, 'known', 4), [])).toBe('unavailable');
  });

  test.each([
    ['ineligible', fixture => { fixture.input.rule.condition.conditions[1].expected = 5; },
      ['rule_no_match'], 'complete_exact'],
    ['unavailable', fixture => { fixture.input.facts[1].state = 'unknown'; fixture.input.facts[1].value = null; },
      ['fact_unknown'], 'partial_unknown'],
    ['unavailable', fixture => { fixture.input.facts[1].state = 'unavailable'; fixture.input.facts[1].value = null; },
      ['fact_unavailable'], 'unavailable'],
    ['unavailable', fixture => { fixture.input.trustedContext.sourceResolution.currentnessState = 'stale';
      fixture.input.trustedContext.sourceResolution.Part4CResolutionEpochId = null;
      fixture.input.trustedContext.sourceResolution.Part4CResolutionDigest = null;
      fixture.input.facts[0].value = 'stale'; },
      ['source_not_latest_exact_current'], 'unavailable'],
    ['ineligible', fixture => { fixture.input.trustedContext.sourceResolution.headState = 'tombstoned'; },
      ['source_lineage_ineligible'], 'complete_exact'],
    ['approval_required', fixture => { const auth = fixture.input.trustedContext.authorizationResolution;
      for (const key of ['authorizationId', 'authorizationKind', 'authorizationRecordDigest',
        'authorizationMaterialBindingDigest', 'policyId', 'policyVersion', 'policyDigest', 'sourceSetDigest',
        'previewId', 'previewDigest', 'recipientSetId', 'recipientSetDigest', 'recipientClassIds',
        'effectSetId', 'effectSetDigest', 'actionFamilyId', 'channelIds', 'providerModeIds', 'effectClass',
        'kindSubjectRecordType', 'kindSubjectRecordId', 'kindSubjectRecordDigest', 'kindRunId', 'expiresAt']) auth[key] = null;
      auth.state = 'required'; }, ['rule_match', 'authorization_required'], 'complete_exact'],
    ['approval_required', fixture => { const auth = fixture.input.trustedContext.authorizationResolution;
      auth.state = 'expired'; auth.expiresAt = '2026-10-28T11:00:00.000Z'; },
      ['rule_match', 'authorization_expired'], 'complete_exact'],
    ['expired', fixture => { fixture.input.trustedContext.policyResolution.state = 'expired';
      fixture.input.trustedContext.policyResolution.expiresAt = '2026-10-28T11:00:00.000Z'; },
      ['policy_expired'], 'complete_exact'],
  ])('derives %s with exact reasons and evidence quality', (result, mutate, reasons, quality) => {
    const fixture = makeFixture();
    mutate(fixture);
    resealFixture(fixture);
    const output = validateAndEvaluate(fixture.input, fixture.trusted);
    expect(output.result).toBe(result);
    expect(output.reasonCodes).toEqual(reasons);
    expect(output.evidenceQuality).toBe(quality);
  });

  test('derives exact suppression and deterministic result-specific next evaluation hints only', () => {
    const fixture = makeFixture();
    const suppression = fixture.input.trustedContext.suppressionResolution;
    suppression.state = 'exact_current_matched';
    suppression.matchedSuppressionId = '00000000-0000-4000-8000-000000000511';
    suppression.matchedSuppressionDigest = `sha256:${'7'.repeat(64)}`;
    suppression.endsAt = '2026-10-28T12:30:00.000Z';
    fixture.input.trustedContext.nextEvaluationCandidates.unshift({kind: 'suppression_expiry',
      instant: suppression.endsAt, basisDigest: ''});
    resealFixture(fixture);
    const output = validateAndEvaluate(fixture.input, fixture.trusted);
    expect(output).toEqual(expect.objectContaining({result: 'suppressed', reasonCodes: ['suppression_matched'],
      nextEvaluationAt: suppression.endsAt}));
    expect(CONTRACT.nextEvaluationContract.meaning).toContain('never_a_schedule');
  });

  test('requires every predicate fact once in first-occurrence order with exact type state value and digest', () => {
    const attacks = [
      fixture => fixture.input.facts.reverse(),
      fixture => fixture.input.facts.pop(),
      fixture => fixture.input.facts.push(copy(fixture.input.facts[0])),
      fixture => { fixture.input.facts[0].valueType = 'bounded_text'; },
      fixture => { fixture.input.facts[0].state = 'unknown'; fixture.input.facts[0].value = ''; },
      fixture => { fixture.input.facts[0].factRef = 'source.event_kind'; },
      fixture => { fixture.input.facts[0].factDigest = `sha256:${'9'.repeat(64)}`; },
    ];
    for (const attack of attacks) {
      const fixture = makeFixture();
      attack(fixture);
      fixture.input = sealInput(fixture.input);
      fixture.trusted.facts = copy(fixture.input.facts);
      expect(() => validateAndEvaluate(fixture.input, fixture.trusted)).toThrow();
    }
    const exactDigestWrongSourceValue = makeFixture();
    exactDigestWrongSourceValue.input.facts[1].value = 5;
    exactDigestWrongSourceValue.input.facts[1] = sealFact(exactDigestWrongSourceValue.input.facts[1]);
    exactDigestWrongSourceValue.input = sealInput(exactDigestWrongSourceValue.input);
    exactDigestWrongSourceValue.trusted.facts = copy(exactDigestWrongSourceValue.input.facts);
    expect(() => validateAndEvaluate(exactDigestWrongSourceValue.input,
      exactDigestWrongSourceValue.trusted)).toThrow('fact source value');
  });

  test('rejects candidate-retargeted policy source suppression authorization clock and context even after redigest', () => {
    const attacks = [
      fixture => { fixture.input.rule.policyBinding.policyId = '00000000-0000-4000-8000-000000000599'; },
      fixture => { fixture.input.trustedContext.sourceResolution.effectiveSnapshotDigest = `sha256:${'9'.repeat(64)}`; },
      fixture => { fixture.input.trustedContext.suppressionResolution.snapshotDigest = `sha256:${'9'.repeat(64)}`; },
      fixture => { fixture.input.trustedContext.authorizationResolution.authorizationMaterialBindingDigest =
        `sha256:${'9'.repeat(64)}`; },
      fixture => { fixture.input.trustedContext.clockResolution.clockEvidenceDigest = `sha256:${'9'.repeat(64)}`; },
      fixture => { fixture.input.tenantId = OTHER_TENANT; },
      fixture => { fixture.input.evaluationId = '00000000-0000-4000-8000-000000000599'; },
    ];
    for (const attack of attacks) {
      const fixture = makeFixture();
      attack(fixture);
      fixture.input.rule = sealRule(fixture.input.rule);
      fixture.input.trustedContext = sealContext(fixture.input.trustedContext);
      fixture.input = sealInput(fixture.input);
      expect(() => validateAndEvaluate(fixture.input, fixture.trusted)).toThrow();
    }
  });

  test('never invents a third authorization kind or accepts widened channel provider effect or action material', () => {
    const attacks = [
      fixture => { fixture.input.trustedContext.authorizationResolution.authorizationKind =
        'fixed_internal_capability'; },
      fixture => { fixture.input.trustedContext.authorizationResolution.channelIds = ['sms']; },
      fixture => { fixture.input.trustedContext.authorizationResolution.providerModeIds = ['provider_live']; },
      fixture => { fixture.input.trustedContext.authorizationResolution.effectClass = 'external_message'; },
      fixture => { fixture.input.trustedContext.authorizationResolution.actionFamilyId = 'customer_communication'; },
      fixture => { fixture.input.trustedContext.authorizationResolution.recipientClassIds =
        ['assigned_staff', 'tenant_owner']; },
    ];
    for (const attack of attacks) {
      const fixture = makeFixture();
      attack(fixture);
      fixture.input.trustedContext = sealContext(fixture.input.trustedContext);
      fixture.input = sealInput(fixture.input);
      fixture.trusted.context = copy(fixture.input.trustedContext);
      expect(() => validateAndEvaluate(fixture.input, fixture.trusted)).toThrow();
    }
    const orderedSubset = makeFixture();
    orderedSubset.input.trustedContext.authorizationResolution.recipientClassIds =
      ['tenant_owner', 'assigned_staff'];
    orderedSubset.input.trustedContext = sealContext(orderedSubset.input.trustedContext);
    orderedSubset.input = sealInput(orderedSubset.input);
    orderedSubset.trusted.context = copy(orderedSubset.input.trustedContext);
    expect(validateAndEvaluate(orderedSubset.input, orderedSubset.trusted).result).toBe('eligible');
  });

  test('validates the entire Part5A rule before lookup and rejects digest, operator, template and bound attacks', () => {
    const attacks = [
      fixture => { fixture.input.rule.unexpected = true; },
      fixture => { fixture.input.rule.condition.conditions[0].operator = 'regex'; },
      fixture => { fixture.input.rule.condition.conditions[0].factRef = 'customer.email'; },
      fixture => { fixture.input.rule.bounds.maxConditionNodes = 999; },
      fixture => { fixture.input.rule.actionTemplateBinding.providerMode = 'provider_live'; },
      fixture => { fixture.input.rule.ruleDigest = `sha256:${'0'.repeat(64)}`; },
    ];
    for (const attack of attacks) {
      const fixture = makeFixture();
      attack(fixture);
      fixture.input = sealInput(fixture.input);
      expect(() => validateAndEvaluate(fixture.input, fixture.trusted)).toThrow();
    }
  });

  test('rejects malformed next-evaluation candidates and never treats a hint as schedule authority', () => {
    const attacks = [
      fixture => fixture.input.trustedContext.nextEvaluationCandidates.reverse(),
      fixture => { fixture.input.trustedContext.nextEvaluationCandidates[0].kind = 'provider_retry'; },
      fixture => { fixture.input.trustedContext.nextEvaluationCandidates[0].instant = fixture.input.evaluatedAt; },
      fixture => { fixture.input.trustedContext.nextEvaluationCandidates[0].basisDigest = 'candidate'; },
      fixture => fixture.input.trustedContext.nextEvaluationCandidates.push(
        copy(fixture.input.trustedContext.nextEvaluationCandidates[0])),
    ];
    for (const attack of attacks) {
      const fixture = makeFixture();
      attack(fixture);
      fixture.input.trustedContext = sealContext(fixture.input.trustedContext);
      fixture.input = sealInput(fixture.input);
      fixture.trusted.context = copy(fixture.input.trustedContext);
      expect(() => validateAndEvaluate(fixture.input, fixture.trusted)).toThrow();
    }
    expect(CONTRACT.nextEvaluationContract.meaning).toBe(
      'explainable_reevaluation_hint_only_never_a_schedule_timer_queue_job_or_execution_authority');
  });

  test('rejects nonplain accessor symbol toJSON prototype proxy cycle alias and coercion before evaluation', () => {
    let getterCalls = 0;
    let proxyCalls = 0;
    const cases = [];
    const accessor = makeFixture();
    Object.defineProperty(accessor.input.facts[0], 'value', {enumerable: true, configurable: true,
      get() { getterCalls += 1; return 'latest_exact_current'; }});
    cases.push(accessor);
    const symbol = makeFixture(); symbol.input[Symbol('poison')] = true; cases.push(symbol);
    const toJSON = makeFixture(); toJSON.input.trustedContext.toJSON = () => ({}); cases.push(toJSON);
    const custom = makeFixture(); Object.setPrototypeOf(custom.input.facts[0], {poison: true}); cases.push(custom);
    const proxied = makeFixture(); proxied.input.trustedContext = new Proxy(proxied.input.trustedContext,
      {get(target, key, receiver) { proxyCalls += 1; return Reflect.get(target, key, receiver); }}); cases.push(proxied);
    const cyclic = makeFixture(); cyclic.input.loop = cyclic.input; cases.push(cyclic);
    const alias = makeFixture(); alias.input.facts.push(alias.input.facts[0]); cases.push(alias);
    const boxed = makeFixture(); boxed.input.tenantId = new String(TENANT); cases.push(boxed); // eslint-disable-line no-new-wrappers
    for (const fixture of cases) expect(() => validateAndEvaluate(fixture.input, fixture.trusted)).toThrow();
    expect(getterCalls).toBe(0);
    expect(proxyCalls).toBe(0);
  });

  test('does not accept caller-selected result reason evidence next-time or output digest fields', () => {
    const fixture = makeFixture();
    for (const field of ['result', 'reasonCodes', 'evidenceQuality', 'nextEvaluationAt', 'outputDigest']) {
      const attacked = copy(fixture.input);
      attacked[field] = field === 'reasonCodes' ? ['eligible'] : 'candidate';
      expect(() => validateAndEvaluate(attacked, fixture.trusted)).toThrow();
    }
  });

  test('keeps output replays historical and rejects changed material under an old input or output digest', () => {
    const fixture = makeFixture();
    const first = validateAndEvaluate(fixture.input, fixture.trusted);
    const changed = copy(fixture.input);
    changed.facts[1].value = 9;
    expect(() => validateAndEvaluate(changed, fixture.trusted)).toThrow();
    const outputClone = copy(first);
    outputClone.result = 'eligible';
    outputClone.nextEvaluationAt = null;
    expect(digestWithout(CONTRACT.outputEnvelope.outputDigestNamespace, outputClone, 'outputDigest'))
      .not.toBe(first.outputDigest);
    expect(CONTRACT.outputEnvelope.sameDigestReplayMeaning).toContain('never_current_authority');
  });

  test('freezes the six states closed reasons evidence rules and deferred boundaries without effect authority', () => {
    expect(CONTRACT.resultContract.states).toEqual(
      ['eligible', 'ineligible', 'suppressed', 'unavailable', 'expired', 'approval_required']);
    expect(new Set(CONTRACT.reasonContract.closedCodes).size).toBe(CONTRACT.reasonContract.closedCodes.length);
    expect(CONTRACT.evidenceQualityContract.states).toEqual(['complete_exact', 'partial_unknown', 'unavailable']);
    expect(CONTRACT.resultContract.eligibleMeaning).toContain('never_approval_schedule_claim_recipient_provider_effect');
    expect(CONTRACT.laterSliceBoundary).toEqual(expect.objectContaining({part5C: expect.stringContaining('planned_unimplemented'),
      part5D: expect.stringContaining('planned_unimplemented'),
      part6Plus: expect.stringContaining('planned_unimplemented')}));
    expect(CONTRACT.unavailableEvidence).toEqual(expect.arrayContaining([
      'mounted_runtime_rule_fact_or_context_resolver',
      'scheduler_queue_worker_or_effect_executor',
      'provider_sandbox_live_provider_real_recipient_or_live_money',
      'physical_Safari_or_devices_manual_assistive_technology_or_founder_visual_verdict',
    ]));
  });

  test('records Part5A released, Part5B as the sole candidate, later slices planned and migration274/no275', () => {
    const roadmap = fs.readFileSync(path.join(ROOT, 'docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md'), 'utf8');
    const ledger = fs.readFileSync(path.join(ROOT, 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md'), 'utf8');
    for (const document of [roadmap, ledger]) {
      expect(document).toContain('Parts 1A–7A released; Part 7B implementation candidate only.');
      expect(document).toContain('Parts 7C–14G remain planned and unimplemented.');
      expect(document).toContain('973175776028b563bd5f4a8b1d1282c1ddd9aa05');
      expect(document).toContain('9973fa71-fbfc-4079-b345-cdf2c5f3ab1b');
      expect(document).toContain('3066db7c0cbcb190753545db4ba3df4d8e3db8cc475135dbcf940df4b1cc1e9d');
    }
    expect(ledger).toContain('| 17 | 5A | Bounded declarative rule grammar | **Released** |');
    expect(ledger).toContain('| 19 | 5C | Owner-readable no-effect preview | **Released** |');
    expect(ledger).toContain('| 20 | 5D | Collision/suppression engine and no-effect dry run | **Released** |');
    expect((ledger.match(/\*\*Implementation candidate\*\*/g) || [])).toHaveLength(1);
    expect((ledger.match(/Planned \/ unimplemented/g) || [])).toHaveLength(38);
    const migrations = fs.readdirSync(path.join(ROOT, 'migrations')).filter(name => /^\d+.*\.sql$/.test(name)).sort();
    expect(migrations.at(-1)).toBe('282_canonical_automation_communication_permission_v1.sql');
    expect(migrations.some(name => name.startsWith('283_'))).toBe(false);
    expect(migrations.filter(name => name.startsWith('281_'))).toEqual(['281_canonical_automation_sender_recipient_authority_v1.sql']);
  });
});
