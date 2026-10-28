'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const util = require('node:util');
const canonical = require('../../src/automation/canonicalJson');

const ROOT = path.resolve(__dirname, '../..');
const CONTRACT_PATH = 'docs/architecture/MISSION_28_PART5A_DECLARATIVE_RULE_GRAMMAR.json';
const CONTRACT = JSON.parse(fs.readFileSync(path.join(ROOT, CONTRACT_PATH), 'utf8'));
const PART4A = JSON.parse(fs.readFileSync(path.join(ROOT,
  'docs/architecture/MISSION_28_PART4A_CLOSED_TRIGGER_CATALOG.json'), 'utf8'));
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
  if (typeof value !== 'object' || util.types.isProxy(value) || seen.has(value)) {
    throw new Error(`${label} plain data`);
  }
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

function ruleDigestBase(value) {
  const base = copy(value);
  delete base.ruleDigest;
  return base;
}

function seal(value) {
  value.ruleDigest = canonical.digest(CONTRACT.ruleEnvelope.ruleDigestNamespace, ruleDigestBase(value));
  return value;
}

function validatePrimitiveString(value, maximum, label) {
  if (typeof value !== 'string' || value.length < 1 || Buffer.byteLength(value, 'utf8') > maximum ||
      value !== value.normalize('NFC') || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`${label} string`);
  }
}

function validateScalar(type, value) {
  const bounds = CONTRACT.bounds;
  if (type === 'boolean') {
    if (typeof value !== 'boolean') throw new Error('boolean literal');
  } else if (type === 'token') {
    validatePrimitiveString(value, bounds.maxTokenLength, 'token');
    if (!TOKEN.test(value)) throw new Error('token literal');
  } else if (type === 'bounded_text') {
    validatePrimitiveString(value, bounds.maxTextLength, 'text');
  } else if (type === 'integer') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0) ||
        value < bounds.safeIntegerMinimum || value > bounds.safeIntegerMaximum) throw new Error('integer literal');
  } else if (type === 'decimal') {
    if (typeof value !== 'string' || !/^-?(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value) ||
        value === '-0' || (value.includes('.') && value.endsWith('0')) || !Number.isFinite(Number(value)) ||
        Number(value) < bounds.safeIntegerMinimum || Number(value) > bounds.safeIntegerMaximum) {
      throw new Error('decimal literal');
    }
  } else if (type === 'utc_instant') {
    if (typeof value !== 'string' || !UTC.test(value) || new Date(value).toISOString() !== value) {
      throw new Error('UTC literal');
    }
  } else if (type === 'uuid') {
    if (typeof value !== 'string' || !UUID.test(value)) throw new Error('UUID literal');
  } else if (type === 'digest') {
    if (typeof value !== 'string' || !DIGEST.test(value)) throw new Error('digest literal');
  } else {
    throw new Error('unknown value type');
  }
}

function scalarSortKey(type, value) {
  if (type === 'integer' || type === 'decimal') return Number(value);
  if (type === 'utc_instant') return Date.parse(value);
  return value;
}

function validateExpected(valueType, operator, expected) {
  const row = CONTRACT.typeCompatibilityMatrix.find(item => item.valueType === valueType);
  if (!row || !row.operators.includes(operator)) throw new Error('type/operator compatibility');
  if (['in', 'not_in'].includes(operator)) {
    if (!Array.isArray(expected) || expected.length < 1 || expected.length > CONTRACT.bounds.maxCollectionMembers) {
      throw new Error('collection literal');
    }
    expected.forEach(value => validateScalar(valueType, value));
    const keys = expected.map(value => scalarSortKey(valueType, value));
    for (let index = 1; index < keys.length; index += 1) {
      if (!(keys[index - 1] < keys[index])) throw new Error('ordered unique collection');
    }
    return;
  }
  if (operator === 'between_inclusive') {
    if (!Array.isArray(expected) || expected.length !== 2) throw new Error('range literal');
    expected.forEach(value => validateScalar(valueType, value));
    if (!(scalarSortKey(valueType, expected[0]) <= scalarSortKey(valueType, expected[1]))) {
      throw new Error('ordered range');
    }
    return;
  }
  if (Array.isArray(expected) || expected === null) throw new Error('scalar literal');
  validateScalar(valueType, expected);
}

function validateFactDomain(fact, expected, trusted) {
  const values = Array.isArray(expected) ? expected : [expected];
  if (Array.isArray(fact.literalDomain)) {
    if (values.some(value => !fact.literalDomain.includes(value))) throw new Error('fact literal domain');
  } else if (fact.literalDomain === 'exact_resolved_Part4A_trigger_ID_only') {
    if (values.some(value => value !== trusted.trigger.triggerId)) throw new Error('trigger literal domain');
  } else if (fact.literalDomain === 'one_event_kind_from_exact_resolved_Part4A_trigger_row') {
    if (values.some(value => !trusted.trigger.eventKinds.includes(value))) throw new Error('event kind literal domain');
  } else if (fact.literalDomain !== 'exact_typed_literal') {
    throw new Error('unknown literal domain');
  }
}

function validateCondition(node, state, trusted, depth = 1) {
  if (depth > CONTRACT.bounds.maxConditionDepth) throw new Error('condition depth');
  state.nodes += 1;
  if (state.nodes > CONTRACT.bounds.maxConditionNodes) throw new Error('condition nodes');
  if (node.kind === 'group') {
    exact(node, CONTRACT.conditionGrammar.groupExactFields, 'group');
    if (!CONTRACT.conditionGrammar.groupOperators.includes(node.operator) || !Array.isArray(node.conditions) ||
        node.conditions.length < 1 || node.conditions.length > CONTRACT.bounds.maxGroupChildren) {
      throw new Error('group value');
    }
    node.conditions.forEach(child => validateCondition(child, state, trusted, depth + 1));
    return;
  }
  if (node.kind !== 'predicate') throw new Error('condition kind');
  exact(node, CONTRACT.conditionGrammar.predicateExactFields, 'predicate');
  const fact = CONTRACT.factCatalog.find(item => item.factRef === node.factRef);
  if (!fact || fact.valueType !== node.valueType) throw new Error('fact reference/type');
  if (node.unknownResult !== CONTRACT.conditionGrammar.unknownResult ||
      node.unavailableResult !== CONTRACT.conditionGrammar.unavailableResult) throw new Error('absence result');
  validateExpected(node.valueType, node.operator, node.expected);
  validateFactDomain(fact, node.expected, trusted);
}

function validateFactValue(envelope, valueType) {
  ownPlain(envelope, 'fact envelope');
  exact(envelope, CONTRACT.factValueEnvelope.exactFields, 'fact envelope');
  if (!CONTRACT.factValueEnvelope.states.includes(envelope.state)) throw new Error('fact state');
  if (envelope.state === 'known') validateScalar(valueType, envelope.value);
  else if (envelope.value !== null) throw new Error('absent fact value');
  return envelope.state;
}

function combineResults(operator, states) {
  if (!CONTRACT.conditionGrammar.groupOperators.includes(operator) || !Array.isArray(states) || states.length < 1 ||
      states.some(state => !CONTRACT.resultSemantics.states.includes(state))) throw new Error('result grammar');
  if (states.includes('unavailable')) return 'unavailable';
  if (states.includes('unknown')) return 'unknown';
  if (operator === 'all') return states.every(state => state === 'match') ? 'match' : 'no_match';
  return states.includes('match') ? 'match' : 'no_match';
}

function validateTemplateCatalog() {
  expect(CONTRACT.factCatalog.map(item => item.factRef).length).toBe(new Set(CONTRACT.factCatalog.map(item => item.factRef)).size);
  expect(CONTRACT.typeCompatibilityMatrix.map(item => item.valueType).length)
    .toBe(new Set(CONTRACT.typeCompatibilityMatrix.map(item => item.valueType)).size);
  for (const fact of CONTRACT.factCatalog) exact(fact, CONTRACT.catalogShapes.factEntryExactFields, 'fact catalog entry');
  for (const row of CONTRACT.typeCompatibilityMatrix) {
    exact(row, CONTRACT.catalogShapes.typeCompatibilityExactFields, 'type compatibility entry');
    if (!Array.isArray(row.operators) || row.operators.length < 1 || new Set(row.operators).size !== row.operators.length) {
      throw new Error('type operator catalog');
    }
  }
  for (const template of CONTRACT.approvedActionTemplates) {
    exact(template, CONTRACT.catalogShapes.actionTemplateDefinitionExactFields, 'template definition');
    const material = copy(template);
    const stated = material.templateDigest;
    delete material.templateDigest;
    if (canonical.digest(CONTRACT.actionTemplateDigestNamespace, material) !== stated) {
      throw new Error('template digest');
    }
  }
}

function validateRule(rule, trusted) {
  ownPlain(rule, 'rule');
  ownPlain(trusted, 'trusted');
  exact(rule, CONTRACT.ruleEnvelope.exactFields, 'rule');
  exact(rule.policyBinding, CONTRACT.ruleEnvelope.policyBindingExactFields, 'policy binding');
  exact(rule.sourceBinding, CONTRACT.ruleEnvelope.sourceBindingExactFields, 'source binding');
  exact(rule.actionTemplateBinding, CONTRACT.ruleEnvelope.actionTemplateBindingExactFields, 'template binding');
  exact(rule.bounds, CONTRACT.ruleEnvelope.boundsExactFields, 'bounds');
  exact(trusted, ['tenantId', 'policyBinding', 'sourceBinding', 'trigger', 'actionTemplateBinding'], 'trusted');
  exact(trusted.trigger, ['triggerId', 'sourceClassId', 'eventKinds', 'allowedActionFamilies'], 'trusted trigger');
  if (rule.schemaVersion !== CONTRACT.ruleEnvelope.schemaVersion || !UUID.test(rule.tenantId) ||
      !UUID.test(rule.ruleId) || !DIGEST.test(rule.ruleDigest)) throw new Error('rule primitive');
  if (rule.policyBinding.tenantId !== rule.tenantId || !UUID.test(rule.policyBinding.policyId) ||
      !Number.isSafeInteger(rule.policyBinding.policyVersion) || rule.policyBinding.policyVersion < 1 ||
      !DIGEST.test(rule.policyBinding.policyDigest)) throw new Error('policy primitive');
  if (rule.sourceBinding.tenantId !== rule.tenantId || !TOKEN.test(rule.sourceBinding.triggerId) ||
      !TOKEN.test(rule.sourceBinding.sourceClassId) || !DIGEST.test(rule.sourceBinding.recordIdentityDigest) ||
      !TOKEN.test(rule.sourceBinding.eventKind) || !UUID.test(rule.sourceBinding.headTransitionId) ||
      !DIGEST.test(rule.sourceBinding.headTransitionDigest) || !Number.isSafeInteger(rule.sourceBinding.headSequence) ||
      rule.sourceBinding.headSequence < 1 || !UUID.test(rule.sourceBinding.effectiveSnapshotId) ||
      !DIGEST.test(rule.sourceBinding.effectiveSnapshotDigest)) throw new Error('source primitive');
  if (rule.actionTemplateBinding.tenantId !== rule.tenantId ||
      !TOKEN.test(rule.actionTemplateBinding.templateId) ||
      !Number.isSafeInteger(rule.actionTemplateBinding.templateVersion) ||
      rule.actionTemplateBinding.templateVersion < 1 || !DIGEST.test(rule.actionTemplateBinding.templateDigest)) {
    throw new Error('template primitive');
  }
  if (!same(rule.bounds, CONTRACT.bounds)) throw new Error('bounds mismatch');
  const catalogTrigger = PART4A.triggers.find(item => item.id === rule.sourceBinding.triggerId);
  if (!catalogTrigger) throw new Error('unknown catalog trigger');
  const triggerProjection = {
    triggerId: catalogTrigger.id,
    sourceClassId: catalogTrigger.sourceClassId,
    eventKinds: catalogTrigger.eventTime.kinds.map(item => item.eventKind),
    allowedActionFamilies: copy(catalogTrigger.allowedActionFamilies),
  };
  if (!same(trusted.trigger, triggerProjection)) throw new Error('trusted trigger catalog mismatch');
  const catalogTemplate = CONTRACT.approvedActionTemplates.find(item =>
    item.templateId === rule.actionTemplateBinding.templateId &&
    item.templateVersion === rule.actionTemplateBinding.templateVersion);
  if (!catalogTemplate) throw new Error('unknown template');
  const templateProjection = {
    tenantId: rule.tenantId,
    templateId: catalogTemplate.templateId,
    templateVersion: catalogTemplate.templateVersion,
    templateDigest: catalogTemplate.templateDigest,
    actionFamilyId: catalogTemplate.actionFamilyId,
    capabilityId: catalogTemplate.capabilityId,
    channelId: catalogTemplate.channelId,
    providerMode: catalogTemplate.providerMode,
    effectClass: catalogTemplate.effectClass,
  };
  if (!same(rule.actionTemplateBinding, templateProjection)) throw new Error('template catalog mismatch');
  validateCondition(rule.condition, { nodes: 0 }, trusted);
  if (Buffer.byteLength(canonical.canonicalize(rule), 'utf8') > CONTRACT.bounds.maxCanonicalRuleBytes) {
    throw new Error('rule byte bound');
  }
  if (trusted.tenantId !== rule.tenantId || !same(rule.policyBinding, trusted.policyBinding) ||
      !same(rule.sourceBinding, trusted.sourceBinding) || !same(rule.actionTemplateBinding, trusted.actionTemplateBinding)) {
    throw new Error('trusted binding mismatch');
  }
  if (trusted.trigger.triggerId !== rule.sourceBinding.triggerId ||
      trusted.trigger.sourceClassId !== rule.sourceBinding.sourceClassId ||
      !trusted.trigger.eventKinds.includes(rule.sourceBinding.eventKind) ||
      !trusted.trigger.allowedActionFamilies.includes(rule.actionTemplateBinding.actionFamilyId)) {
    throw new Error('trigger compatibility');
  }
  if (canonical.digest(CONTRACT.ruleEnvelope.ruleDigestNamespace, ruleDigestBase(rule)) !== rule.ruleDigest) {
    throw new Error('rule digest');
  }
  return true;
}

function makeFixture(triggerId = 'm20.lead_contact_state', templateId = 'internal_fact_digest_v1') {
  const trigger = PART4A.triggers.find(item => item.id === triggerId);
  const template = CONTRACT.approvedActionTemplates.find(item => item.templateId === templateId);
  const actionTemplateBinding = {
    tenantId: TENANT,
    templateId: template.templateId,
    templateVersion: template.templateVersion,
    templateDigest: template.templateDigest,
    actionFamilyId: template.actionFamilyId,
    capabilityId: template.capabilityId,
    channelId: template.channelId,
    providerMode: template.providerMode,
    effectClass: template.effectClass,
  };
  const policyBinding = {
    tenantId: TENANT,
    policyId: '00000000-0000-4000-8000-000000000501',
    policyVersion: 3,
    policyDigest: `sha256:${'5'.repeat(64)}`,
  };
  const sourceBinding = {
    tenantId: TENANT,
    triggerId: trigger.id,
    sourceClassId: trigger.sourceClassId,
    recordIdentityDigest: `sha256:${'6'.repeat(64)}`,
    eventKind: trigger.eventTime.kinds[0].eventKind,
    headTransitionId: '00000000-0000-4000-8000-000000000502',
    headTransitionDigest: `sha256:${'7'.repeat(64)}`,
    headSequence: 4,
    effectiveSnapshotId: '00000000-0000-4000-8000-000000000503',
    effectiveSnapshotDigest: `sha256:${'8'.repeat(64)}`,
  };
  const rule = seal({
    schemaVersion: CONTRACT.ruleEnvelope.schemaVersion,
    tenantId: TENANT,
    ruleId: '00000000-0000-4000-8000-000000000504',
    policyBinding,
    sourceBinding,
    condition: {
      kind: 'group',
      operator: 'all',
      conditions: [
        {kind: 'predicate', factRef: 'source.currentness_state', valueType: 'token', operator: 'equals', expected: 'latest_exact_current', unknownResult: 'unknown', unavailableResult: 'unavailable'},
        {kind: 'predicate', factRef: 'source.lineage_sequence', valueType: 'integer', operator: 'greater_than_or_equal', expected: 1, unknownResult: 'unknown', unavailableResult: 'unavailable'},
      ],
    },
    actionTemplateBinding,
    bounds: copy(CONTRACT.bounds),
    ruleDigest: '',
  });
  const trusted = {
    tenantId: TENANT,
    policyBinding: copy(policyBinding),
    sourceBinding: copy(sourceBinding),
    trigger: {
      triggerId: trigger.id,
      sourceClassId: trigger.sourceClassId,
      eventKinds: trigger.eventTime.kinds.map(item => item.eventKind),
      allowedActionFamilies: copy(trigger.allowedActionFamilies),
    },
    actionTemplateBinding: copy(actionTemplateBinding),
  };
  return { rule, trusted };
}

describe('Mission 28 Part 5A bounded declarative rule grammar', () => {
  test('binds the exact released inputs, Part4D release and derived template digests', () => {
    expect(CONTRACT.authority).toMatchObject({
      mission: 28,
      part: '5A',
      state: 'implementation_candidate_only',
      baselineCommit: '7308a529f7f6e295d786fd2c52073705eebaa2f2',
      baselineTree: 'df150a26d03642cb4930de8914b85bf5d8b73510',
      contractOnlyNoRuntimeEvaluatorMounted: true,
      newDatabaseObjectOrMigrationAdded: false,
      eligibilityApprovalSchedulingRecipientProviderEffectUpstreamMutationAccountingOrMoneyAuthorityGranted: false,
    });
    expect(CONTRACT.part4DRelease).toMatchObject({
      acceptedSourceHead: '41be176abfddae512f34da25a9d3564b1fea6e1b',
      acceptedTree: 'df150a26d03642cb4930de8914b85bf5d8b73510',
      pullRequest: 564,
      mergedMain: '7308a529f7f6e295d786fd2c52073705eebaa2f2',
      deployment: '82b50c73-5414-4e7f-bb07-72d71f65dc92',
      deploymentState: 'SUCCESS_RUNNING',
      runningInstance: '99c20fdd-cf03-4b8b-98cf-20f05d8bd72f',
      imageSha256: '2ac7426c032f38de4b1715e59ed382cb92b0af9486baf8be43150a8c5cc9371b',
      auditVerdict: 'P0=P1=P2=P3=0',
    });
    expect(CONTRACT.frozenInputs.map(input => normalizedLfSha256(input.path))).toEqual(
      CONTRACT.frozenInputs.map(input => input.normalizedLfSha256));
    expect(() => validateTemplateCatalog()).not.toThrow();
  });

  test('accepts one exact canonical tenant policy, source lineage and approved template binding', () => {
    const { rule, trusted } = makeFixture();
    expect(validateRule(rule, trusted)).toBe(true);
    expect(validateRule(copy(rule), copy(trusted))).toBe(true);
  });

  test('freezes a closed comparison and type matrix with canonical literals', () => {
    const examples = {
      boolean: true,
      token: 'exact_current',
      bounded_text: 'Owner review required',
      integer: 42,
      decimal: '42.25',
      utc_instant: '2026-10-28T12:00:00.000Z',
      uuid: '00000000-0000-4000-8000-000000000700',
      digest: `sha256:${'a'.repeat(64)}`,
    };
    for (const row of CONTRACT.typeCompatibilityMatrix) {
      for (const operator of row.operators) {
        const base = examples[row.valueType];
        const expected = ['in', 'not_in'].includes(operator) ? [base] :
          operator === 'between_inclusive' ? [base, base] : base;
        expect(() => validateExpected(row.valueType, operator, expected)).not.toThrow();
      }
    }
    expect(() => validateExpected('token', 'greater_than', 'exact_current')).toThrow();
    expect(() => validateExpected('integer', 'regex', 1)).toThrow();
    expect(() => validateExpected('decimal', 'equals', '0')).not.toThrow();
    expect(() => validateExpected('decimal', 'equals', '10')).not.toThrow();
    expect(() => validateExpected('decimal', 'equals', '01.20')).toThrow();
    expect(() => validateExpected('decimal', 'equals', '1.20')).toThrow();
    expect(() => validateExpected('decimal', 'equals', '-0')).toThrow();
    expect(() => validateExpected('decimal', 'equals', '1e3')).toThrow();
    expect(() => validateExpected('integer', 'equals', '1')).toThrow();
    expect(() => validateExpected('integer', 'equals', CONTRACT.bounds.safeIntegerMaximum + 1)).toThrow();
    expect(() => validateExpected('token', 'equals', 'a'.repeat(CONTRACT.bounds.maxTokenLength + 1))).toThrow();
    expect(() => validateExpected('bounded_text', 'equals', 'unsafe\ntext')).toThrow();
    expect(() => validateExpected('token', 'in', ['b', 'a'])).toThrow();
    expect(() => validateExpected('token', 'in', ['a', 'a'])).toThrow();
    expect(() => validateExpected('token', 'in', Array.from({length: 17}, (_, index) => `a${String(index).padStart(2, '0')}`))).toThrow();
  });

  test('keeps known, unknown, unavailable and malformed/missing fact values distinct', () => {
    expect(validateFactValue({state: 'known', value: 3}, 'integer')).toBe('known');
    expect(validateFactValue({state: 'unknown', value: null}, 'integer')).toBe('unknown');
    expect(validateFactValue({state: 'unavailable', value: null}, 'integer')).toBe('unavailable');
    for (const value of [
      {state: 'unknown', value: 0},
      {state: 'unavailable', value: false},
      {state: 'known', value: null},
      {state: 'known'},
      {state: 'missing', value: null},
      null,
    ]) expect(() => validateFactValue(value, 'integer')).toThrow();
    expect(CONTRACT.conditionGrammar.missingFactResult).toBe('deny_malformed_not_false_zero_empty_or_unknown');
    expect(combineResults('all', ['match', 'unavailable', 'no_match'])).toBe('unavailable');
    expect(combineResults('any', ['match', 'unknown', 'no_match'])).toBe('unknown');
    expect(combineResults('all', ['match', 'match'])).toBe('match');
    expect(combineResults('all', ['match', 'no_match'])).toBe('no_match');
    expect(combineResults('any', ['no_match', 'match'])).toBe('match');
    expect(combineResults('any', ['no_match', 'no_match'])).toBe('no_match');
  });

  test('rejects malformed, missing, extra, reordered, unbounded and injection-bearing grammar', () => {
    const mutate = callback => {
      const { rule, trusted } = makeFixture();
      callback(rule);
      if (rule && typeof rule === 'object' && Object.hasOwn(rule, 'ruleDigest')) seal(rule);
      expect(() => validateRule(rule, trusted)).toThrow();
    };
    mutate(rule => { rule.script = 'return true'; });
    mutate(rule => { delete rule.schemaVersion; });
    mutate(rule => { rule.condition.conditions[0].regex = '.*'; });
    mutate(rule => { rule.condition.conditions[0].operator = 'regex'; });
    mutate(rule => { rule.condition.conditions[0].factRef = 'source.customer.secret'; });
    mutate(rule => { rule.condition.conditions[0].valueType = 'bounded_text'; });
    mutate(rule => { rule.condition.conditions[0].expected = 'stale'; });
    mutate(rule => { rule.condition.conditions[0].expected = '${provider.send()}'; });
    mutate(rule => { rule.condition.conditions = Array.from({length: 9}, () => copy(rule.condition.conditions[0])); });
    mutate(rule => { rule.condition = {kind: 'group', operator: 'all', conditions: Array.from({length: 8}, () => ({kind: 'group', operator: 'all', conditions: Array.from({length: 8}, () => ({kind: 'predicate', factRef: 'source.lineage_sequence', valueType: 'integer', operator: 'equals', expected: 1, unknownResult: 'unknown', unavailableResult: 'unavailable'}))}))}; });
    mutate(rule => { rule.condition = {kind: 'group', operator: 'all', conditions: [{kind: 'group', operator: 'all', conditions: [{kind: 'group', operator: 'all', conditions: [{kind: 'group', operator: 'all', conditions: [{kind: 'predicate', factRef: 'source.lineage_sequence', valueType: 'integer', operator: 'equals', expected: 1, unknownResult: 'unknown', unavailableResult: 'unavailable'}]}]}]}]}; });
    mutate(rule => { rule.bounds.maxConditionNodes += 1; });
    mutate(rule => { rule.condition.conditions[0] = {expected: 'exact_current', operator: 'equals', valueType: 'token', factRef: 'source.currentness_state', kind: 'predicate', unknownResult: 'unknown', unavailableResult: 'unavailable'}; });
  });

  test('rejects accessors, symbols, toJSON, prototypes, sparse arrays, aliases and proxies before hooks', () => {
    let hooks = 0;
    const cases = [];
    {
      const { rule, trusted } = makeFixture();
      Object.defineProperty(rule.condition.conditions[0], 'expected', {enumerable: true, configurable: true, get() { hooks += 1; return 'latest_exact_current'; }});
      cases.push([rule, trusted]);
    }
    {
      const { rule, trusted } = makeFixture();
      rule.condition.conditions[0][Symbol('hidden')] = 'secret';
      cases.push([rule, trusted]);
    }
    {
      const { rule, trusted } = makeFixture();
      Object.defineProperty(rule.condition.conditions[0], 'toJSON', {enumerable: true, configurable: true, writable: true, value() { hooks += 1; return {}; }});
      cases.push([rule, trusted]);
    }
    {
      const { rule, trusted } = makeFixture();
      Object.setPrototypeOf(rule.condition.conditions[0], {expected: 'exact_current'});
      cases.push([rule, trusted]);
    }
    {
      const { rule, trusted } = makeFixture();
      rule.condition.conditions.length = 3;
      cases.push([rule, trusted]);
    }
    {
      const { rule, trusted } = makeFixture();
      rule.condition.conditions.push(rule.condition.conditions[0]);
      cases.push([rule, trusted]);
    }
    {
      const { rule, trusted } = makeFixture();
      rule.condition = new Proxy(rule.condition, {get(target, key) { hooks += 1; return target[key]; }});
      cases.push([rule, trusted]);
    }
    {
      const { rule, trusted } = makeFixture();
      rule.condition.conditions[0].expected = new String('latest_exact_current');
      cases.push([rule, trusted]);
    }
    {
      const { rule, trusted } = makeFixture();
      rule.condition.conditions.push(rule.condition);
      cases.push([rule, trusted]);
    }
    {
      const { rule, trusted } = makeFixture();
      const proxiedTrusted = new Proxy(trusted, {get(target, key) { hooks += 1; return target[key]; }});
      cases.push([rule, proxiedTrusted]);
    }
    for (const [rule, trusted] of cases) expect(() => validateRule(rule, trusted)).toThrow();
    expect(hooks).toBe(0);
  });

  test('rejects cross-tenant, policy, trigger, snapshot and template clone or replay retargeting', () => {
    const attacks = [
      (rule, trusted) => { rule.tenantId = OTHER_TENANT; rule.policyBinding.tenantId = OTHER_TENANT; rule.sourceBinding.tenantId = OTHER_TENANT; rule.actionTemplateBinding.tenantId = OTHER_TENANT; },
      rule => { rule.policyBinding.policyId = '00000000-0000-4000-8000-000000000599'; },
      rule => { rule.policyBinding.policyDigest = `sha256:${'9'.repeat(64)}`; },
      rule => { rule.sourceBinding.triggerId = 'm21.reviewed_knowledge_version'; },
      rule => { rule.sourceBinding.eventKind = 'knowledge_version_published'; },
      rule => { rule.sourceBinding.recordIdentityDigest = `sha256:${'9'.repeat(64)}`; },
      rule => { rule.sourceBinding.headTransitionId = '00000000-0000-4000-8000-000000000599'; },
      rule => { rule.sourceBinding.effectiveSnapshotId = '00000000-0000-4000-8000-000000000599'; },
      rule => { rule.sourceBinding.effectiveSnapshotDigest = `sha256:${'9'.repeat(64)}`; },
      rule => { rule.actionTemplateBinding.templateId = 'owner_approval_request_v1'; },
      rule => { rule.actionTemplateBinding.templateDigest = `sha256:${'9'.repeat(64)}`; },
      rule => { rule.actionTemplateBinding.actionFamilyId = 'customer_communication'; },
      (rule, trusted) => { trusted.tenantId = OTHER_TENANT; },
      (rule, trusted) => { trusted.trigger.allowedActionFamilies.push('collection_escalation'); },
    ];
    for (const attack of attacks) {
      const { rule, trusted } = makeFixture();
      attack(rule, trusted);
      seal(rule);
      expect(() => validateRule(rule, trusted)).toThrow();
    }
    const collection = makeFixture('m20.lead_contact_state', 'reviewed_collection_work_item_v1');
    expect(() => validateRule(collection.rule, collection.trusted)).toThrow('trigger compatibility');
    expect(validateRule(...Object.values(makeFixture('m27.reviewed_collection_handoff', 'reviewed_collection_work_item_v1')))).toBe(true);
  });

  test('rejects digest omission, corruption and full-redigest material substitution against trusted authority', () => {
    const { rule, trusted } = makeFixture();
    const missing = copy(rule);
    delete missing.ruleDigest;
    expect(() => validateRule(missing, trusted)).toThrow();
    const corrupt = copy(rule);
    corrupt.ruleDigest = `sha256:${'0'.repeat(64)}`;
    expect(() => validateRule(corrupt, trusted)).toThrow('rule digest');
    const retarget = copy(rule);
    retarget.policyBinding.policyVersion = 99;
    retarget.policyBinding.policyDigest = `sha256:${'9'.repeat(64)}`;
    seal(retarget);
    expect(() => validateRule(retarget, trusted)).toThrow('trusted binding mismatch');
  });

  test('keeps grammar membership separate from every later authority and unavailable evidence', () => {
    expect(CONTRACT.trustedResolutionContract.currentRuntimeResolverAvailable).toBe(false);
    expect(CONTRACT.authority.eligibilityApprovalSchedulingRecipientProviderEffectUpstreamMutationAccountingOrMoneyAuthorityGranted).toBe(false);
    expect(CONTRACT.approvedActionTemplates.every(template =>
      template.channelId === 'in_app_passive' && template.providerMode === 'provider_disabled' &&
      template.effectClass === 'internal_record_only')).toBe(true);
    expect(CONTRACT.denials).toContain('grammar_membership_used_as_eligibility_approval_schedule_recipient_provider_effect_upstream_accounting_or_money_authority');
    expect(CONTRACT.laterSliceBoundary).toEqual({
      part5B: 'deterministic_evaluation_reasons_evidence_quality_next_evaluation_and_result_states_remain_planned_unimplemented',
      part5C: 'owner_readable_preview_remains_planned_unimplemented',
      part5D: 'collision_suppression_dry_run_and_historical_backtest_remain_planned_unimplemented',
      part6Plus: 'scheduling_execution_queue_worker_provider_recipient_message_effect_accounting_and_money_remain_planned_unimplemented',
    });
    expect(CONTRACT.unavailableEvidence).toEqual(expect.arrayContaining([
      'mounted_rule_resolver_or_evaluator',
      'provider_sandbox_live_provider_real_recipient_or_live_money',
      'professional_legal_privacy_provider_or_regulatory_review',
      'physical_Safari_or_devices_manual_assistive_technology_or_founder_visual_verdict',
    ]));
  });

  test('records Part5A released, only Part5B candidate and every later slice planned', () => {
    const roadmap = fs.readFileSync(path.join(ROOT, 'docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md'), 'utf8');
    const ledger = fs.readFileSync(path.join(ROOT, 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md'), 'utf8');
    for (const document of [roadmap, ledger]) {
      expect(document).toContain('Parts 1A–5C released; Part 5D implementation candidate only.');
      expect(document).toContain('Parts 6A–14G remain planned and unimplemented.');
      expect(document).toContain('`41be176abfddae512f34da25a9d3564b1fea6e1b`');
      expect(document).toContain('`82b50c73-5414-4e7f-bb07-72d71f65dc92`');
    }
    expect(ledger).toContain('| 16 | 4D | Duplicate/replay/reorder/correction/tombstone/concurrency handling | **Released** |');
    expect(ledger).toContain('| 17 | 5A | Bounded declarative rule grammar | **Released** |');
    expect(ledger).toContain('| 19 | 5C | Owner-readable no-effect preview | **Released** |');
    expect(ledger).toContain('| 20 | 5D | Collision/suppression engine and no-effect dry run | **Implementation candidate** |');
    expect(roadmap).toContain('Released Part 5A artifacts:');
    expect(roadmap).toContain('Current Part 5D artifacts:');
  });
});
