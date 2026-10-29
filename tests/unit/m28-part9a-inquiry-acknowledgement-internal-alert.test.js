'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { types: { isProxy } } = require('util');

const ROOT = path.resolve(__dirname, '../..');
const CONTRACT_PATH = path.join(ROOT, 'docs/architecture/MISSION_28_PART9A_INQUIRY_ACKNOWLEDGEMENT_INTERNAL_ALERT_CONTRACT.json');
const CONTRACT_MD = path.join(ROOT, 'docs/architecture/MISSION_28_PART9A_INQUIRY_ACKNOWLEDGEMENT_INTERNAL_ALERT_CONTRACT.md');
const ROADMAP = path.join(ROOT, 'docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md');
const LEDGER = path.join(ROOT, 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md');
const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8'));
const launch = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/architecture/MISSION_28_PART1D_FIRST_LAUNCH_MATRIX.json'), 'utf8'));
const triggerCatalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/architecture/MISSION_28_PART4A_CLOSED_TRIGGER_CATALOG.json'), 'utf8'));
const part3B = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/architecture/MISSION_28_PART3B_APPROVAL_AUTHORIZATION_CONTRACT.json'), 'utf8'));
const part7B = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/architecture/MISSION_28_PART7B_COMMUNICATION_PERMISSION_CONTRACT.json'), 'utf8'));
const part7C = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/architecture/MISSION_28_PART7C_CONTENT_TEMPLATE_PREVIEW_CONTRACT.json'), 'utf8'));
const part7D = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/architecture/MISSION_28_PART7D_CHANNEL_DELIVERY_HANDOFF_CONTRACT.json'), 'utf8'));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const UTC = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$/;
const copy = value => JSON.parse(JSON.stringify(value));
const hash = value => `sha256:${crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
const namespaceHash = (namespace, value) => `sha256:${crypto.createHash('sha256').update(`${namespace}\n${JSON.stringify(value)}`).digest('hex')}`;
const digestLf = relative => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, relative), 'utf8').replace(/\r\n/g, '\n')).digest('hex').toUpperCase();

function dataGate(value, seen = new WeakSet()) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return;
  if (typeof value !== 'object' || isProxy(value) || seen.has(value)) throw new Error('plain data');
  seen.add(value);
  const proto = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    const keys = Reflect.ownKeys(value);
    if (proto !== Array.prototype || keys.some(key => key !== 'length' && !/^(0|[1-9][0-9]*)$/.test(key)) ||
        keys.filter(key => key !== 'length').length !== value.length) throw new Error('dense array');
  } else if (proto !== Object.prototype) throw new Error('ordinary object');
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'symbol') throw new Error('symbol');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable || key === 'toJSON') throw new Error('descriptor');
    if (key !== 'length') dataGate(descriptor.value, seen);
  }
}

function exactKeys(value, keys) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || JSON.stringify(Reflect.ownKeys(value)) !== JSON.stringify(keys)) throw new Error('keys');
}

function materialOf(input) {
  const material = copy(input);
  delete material.resolutionId;
  delete material.materialDigest;
  delete material.idempotencyKeyDigest;
  delete material.requestDigest;
  return material;
}

function idempotencyMaterialOf(input) {
  const material = materialOf(input);
  delete material.evaluatedAt;
  return material;
}

function requestOf(input) {
  const request = copy(input);
  delete request.materialDigest;
  delete request.idempotencyKeyDigest;
  delete request.requestDigest;
  return request;
}

function seal(input) {
  input.materialDigest = hash(materialOf(input));
  input.idempotencyKeyDigest = hash({namespace: 'mission28.part9a.inquiry-resolution-idempotency.v1', material: idempotencyMaterialOf(input)});
  input.requestDigest = hash(requestOf(input));
  return input;
}

function actor(capabilityId) {
  return {
    actorId: '00000000-0000-4000-8000-000000000010',
    sessionId: '00000000-0000-4000-8000-000000000011',
    membershipId: '00000000-0000-4000-8000-000000000012',
    sessionSubjectActorId: '00000000-0000-4000-8000-000000000010',
    membershipSubjectActorId: '00000000-0000-4000-8000-000000000010',
    actorTenantId: '00000000-0000-4000-8000-000000000001',
    sessionTenantId: '00000000-0000-4000-8000-000000000001',
    membershipTenantId: '00000000-0000-4000-8000-000000000001',
    actorState: 'active', sessionState: 'active', membershipState: 'active', membershipRoleId: 'owner', capabilityId,
    capabilityDecisionId: '00000000-0000-4000-8000-000000000013', capabilityDecisionDigest: `sha256:${'13'.repeat(32)}`
  };
}

function source() {
  const recordIdentity = {
    tenantId: '00000000-0000-4000-8000-000000000001', canonicalGraphId: '00000000-0000-4000-8000-000000000025',
    customerId: '00000000-0000-4000-8000-000000000026', opportunityId: '00000000-0000-4000-8000-000000000027'
  };
  return {
    triggerId: 'm20.lead_contact_state', sourceClassId: 'mission20_business_contact_preferences', recordIdentity,
    recordIdentityDigest: namespaceHash('mission28.source-record-identity.v1', recordIdentity),
    snapshotId: '00000000-0000-4000-8000-000000000020', snapshotDigest: `sha256:${'21'.repeat(32)}`, sourceSetDigest: `sha256:${'22'.repeat(32)}`,
    eventKind: 'communication_occurred', eventTime: '2026-10-28T12:00:00.000000Z', observedAt: '2026-10-28T12:01:00.000000Z',
    currentnessResolutionId: '00000000-0000-4000-8000-000000000023', currentnessResolutionDigest: `sha256:${'23'.repeat(32)}`, currentnessState: 'latest_exact_current',
    evaluationId: '00000000-0000-4000-8000-000000000024', evaluationOutputDigest: `sha256:${'24'.repeat(32)}`, evaluationResult: 'eligible'
  };
}

function internalAuthority() {
  return {
    tenantId: '00000000-0000-4000-8000-000000000001', transactionId: '00000000-0000-4000-8000-000000000030',
    actionUnitId: '00000000-0000-4000-8000-000000000031', actionUnitDigest: `sha256:${'31'.repeat(32)}`,
    actionFamilyId: 'internal_read_digest_task', sourceSetDigest: `sha256:${'22'.repeat(32)}`,
    authorizationId: '00000000-0000-4000-8000-000000000032', authorizationKind: 'per_run_approval',
    authorizationRecordDigest: `sha256:${'32'.repeat(32)}`, authorizationMaterialBindingDigest: `sha256:${'33'.repeat(32)}`,
    authorizationBoundSourceSetDigest: `sha256:${'22'.repeat(32)}`, authorizationBoundContentPreviewDigest: `sha256:${'36'.repeat(32)}`,
    authorizationBoundRecipientResolutionDigest: `sha256:${'34'.repeat(32)}`, authorizationBoundActionFamilyId: 'internal_read_digest_task',
    authorizationBoundChannelId: 'in_app_passive', authorizationBoundProviderMode: 'provider_disabled',
    recipientResolutionId: '00000000-0000-4000-8000-000000000034', recipientResolutionDigest: `sha256:${'34'.repeat(32)}`, recipientClassId: 'tenant_owner',
    permissionResolutionId: '00000000-0000-4000-8000-000000000035', permissionResolutionDigest: `sha256:${'35'.repeat(32)}`,
    permissionRecipientResolutionDigest: `sha256:${'34'.repeat(32)}`, permissionResultState: 'clear_internal_passive_no_effect',
    contentPreviewId: '00000000-0000-4000-8000-000000000036', contentPreviewDigest: `sha256:${'36'.repeat(32)}`, contentTemplateId: 'internal_fact_digest_content_v1',
    channelResolutionId: '00000000-0000-4000-8000-000000000037', channelResolutionDigest: `sha256:${'37'.repeat(32)}`,
    channelContentPreviewDigest: `sha256:${'36'.repeat(32)}`, channelId: 'in_app_passive',
    channelResultState: 'ready_internal_no_effect', providerMode: 'provider_disabled'
  };
}

function fixture(operation = 'internal_alert_resolution') {
  const definition = contract.operations.find(item => item.operation === operation);
  return seal({
    schemaVersion: 'mission28.part9a.inquiry-acknowledgement-internal-alert.v1', tenantId: '00000000-0000-4000-8000-000000000001',
    resolutionId: '00000000-0000-4000-8000-000000000002', operation, inquirySourceBinding: source(), businessAvailabilityBinding: null,
    actorAuthorityBinding: actor(definition.requiredActorCapabilityId), internalAuthorityBinding: definition.internalAuthorityRequired ? internalAuthority() : null,
    evaluatedAt: '2026-10-28T12:05:00.000000Z', materialDigest: '', idempotencyKeyDigest: '', requestDigest: ''
  });
}

function validateCommon(input, trusted) {
  dataGate(input); dataGate(trusted);
  exactKeys(input, contract.resolutionEnvelope.exactFields);
  exactKeys(input.inquirySourceBinding, contract.resolutionEnvelope.inquirySourceBindingExactFields);
  exactKeys(input.inquirySourceBinding.recordIdentity, contract.resolutionEnvelope.recordIdentityExactFields);
  exactKeys(input.actorAuthorityBinding, contract.resolutionEnvelope.actorAuthorityBindingExactFields);
  if (JSON.stringify(input) !== JSON.stringify(trusted)) throw new Error('trusted resolution');
  if (input.schemaVersion !== 'mission28.part9a.inquiry-acknowledgement-internal-alert.v1') throw new Error('schema');
  for (const value of [input.tenantId, input.resolutionId, ...Object.values(input.inquirySourceBinding.recordIdentity), input.inquirySourceBinding.snapshotId, input.inquirySourceBinding.currentnessResolutionId,
    input.inquirySourceBinding.evaluationId, input.actorAuthorityBinding.actorId, input.actorAuthorityBinding.sessionId, input.actorAuthorityBinding.membershipId,
    input.actorAuthorityBinding.capabilityDecisionId]) if (!UUID.test(value)) throw new Error('uuid');
  for (const value of [input.inquirySourceBinding.recordIdentityDigest, input.inquirySourceBinding.snapshotDigest, input.inquirySourceBinding.sourceSetDigest,
    input.inquirySourceBinding.currentnessResolutionDigest, input.inquirySourceBinding.evaluationOutputDigest, input.actorAuthorityBinding.capabilityDecisionDigest,
    input.materialDigest, input.idempotencyKeyDigest, input.requestDigest]) if (!DIGEST.test(value)) throw new Error('digest');
  for (const value of [input.inquirySourceBinding.eventTime, input.inquirySourceBinding.observedAt, input.evaluatedAt]) if (!UTC.test(value)) throw new Error('time');
  if (input.inquirySourceBinding.observedAt > input.evaluatedAt) throw new Error('future observation');
  const expectedSource = contract.supportedInquirySource;
  const trigger = triggerCatalog.triggers.find(item => item.id === expectedSource.triggerId);
  const eventKind = trigger && trigger.eventTime.kinds.find(item => item.eventKind === input.inquirySourceBinding.eventKind);
  if (!trigger || !eventKind || input.inquirySourceBinding.triggerId !== trigger.id || input.inquirySourceBinding.sourceClassId !== trigger.sourceClassId ||
      input.inquirySourceBinding.recordIdentity.tenantId !== input.tenantId ||
      input.inquirySourceBinding.recordIdentityDigest !== namespaceHash('mission28.source-record-identity.v1', input.inquirySourceBinding.recordIdentity) ||
      !expectedSource.exactEventKinds.includes(input.inquirySourceBinding.eventKind) || input.inquirySourceBinding.currentnessState !== expectedSource.requiredCurrentness ||
      input.inquirySourceBinding.evaluationResult !== expectedSource.requiredEvaluationResult) throw new Error('source');
  const actorBinding = input.actorAuthorityBinding;
  if (actorBinding.actorId !== actorBinding.sessionSubjectActorId || actorBinding.actorId !== actorBinding.membershipSubjectActorId ||
      [actorBinding.actorTenantId, actorBinding.sessionTenantId, actorBinding.membershipTenantId].some(value => value !== input.tenantId) ||
      [actorBinding.actorState, actorBinding.sessionState, actorBinding.membershipState].some(value => value !== 'active') || actorBinding.membershipRoleId !== 'owner') throw new Error('actor');
  if (input.businessAvailabilityBinding !== null) throw new Error('availability unavailable');
  if (input.materialDigest !== hash(materialOf(input)) || input.idempotencyKeyDigest !== hash({namespace: 'mission28.part9a.inquiry-resolution-idempotency.v1', material: idempotencyMaterialOf(input)}) ||
      input.requestDigest !== hash(requestOf(input))) throw new Error('canonical digest');
  return {trigger};
}

function validateInternal(binding, trigger, inquirySource, tenantId) {
  exactKeys(binding, contract.resolutionEnvelope.internalAuthorityBindingExactFields);
  for (const key of ['tenantId', 'transactionId', 'actionUnitId', 'authorizationId', 'recipientResolutionId', 'permissionResolutionId', 'contentPreviewId', 'channelResolutionId']) if (!UUID.test(binding[key])) throw new Error('internal uuid');
  for (const key of ['actionUnitDigest', 'sourceSetDigest', 'authorizationRecordDigest', 'authorizationMaterialBindingDigest', 'authorizationBoundSourceSetDigest',
    'authorizationBoundContentPreviewDigest', 'authorizationBoundRecipientResolutionDigest', 'recipientResolutionDigest', 'permissionResolutionDigest',
    'permissionRecipientResolutionDigest', 'contentPreviewDigest', 'channelResolutionDigest', 'channelContentPreviewDigest']) if (!DIGEST.test(binding[key])) throw new Error('internal digest');
  const expected = contract.internalAlertAuthority;
  if (!trigger.allowedActionFamilies.includes(binding.actionFamilyId) || binding.actionFamilyId !== expected.actionFamilyId || binding.recipientClassId !== expected.recipientClassId ||
      binding.permissionResultState !== expected.permissionResultState || binding.contentTemplateId !== expected.contentTemplateId || binding.channelId !== expected.channelId ||
      binding.channelResultState !== expected.channelResultState || binding.providerMode !== expected.providerMode || !expected.authorizationKinds.includes(binding.authorizationKind)) throw new Error('internal authority');
  if (binding.tenantId !== tenantId || binding.sourceSetDigest !== binding.authorizationBoundSourceSetDigest || binding.sourceSetDigest !== inquirySource.sourceSetDigest ||
      binding.authorizationBoundContentPreviewDigest !== binding.contentPreviewDigest || binding.channelContentPreviewDigest !== binding.contentPreviewDigest ||
      binding.authorizationBoundRecipientResolutionDigest !== binding.recipientResolutionDigest || binding.permissionRecipientResolutionDigest !== binding.recipientResolutionDigest ||
      binding.authorizationBoundActionFamilyId !== binding.actionFamilyId || binding.authorizationBoundChannelId !== binding.channelId ||
      binding.authorizationBoundProviderMode !== binding.providerMode) throw new Error('relational binding');
  if (!part3B.authorizationKinds.some(item => item.id === binding.authorizationKind) ||
      !part7B.resolution.resultStates.includes(binding.permissionResultState) ||
      !part7C.approvedTemplateCatalog.some(item => item.contentTemplateId === binding.contentTemplateId && item.actionFamilyId === binding.actionFamilyId) ||
      !part7D.channelCatalog.some(item => item.channelId === binding.channelId && item.resultState === binding.channelResultState && item.providerMode === binding.providerMode)) throw new Error('frozen authority');
}

function project(input, trusted) {
  const {trigger} = validateCommon(input, trusted);
  const operation = contract.operations.find(item => item.operation === input.operation);
  if (!operation || input.actorAuthorityBinding.capabilityId !== operation.requiredActorCapabilityId) throw new Error('operation');
  if (operation.internalAuthorityRequired) validateInternal(input.internalAuthorityBinding, trigger, input.inquirySourceBinding, input.tenantId);
  else if (input.internalAuthorityBinding !== null) throw new Error('unavailable customer authority');
  return Object.freeze({
    resolutionId: input.resolutionId, resultState: operation.resultState, labelId: operation.labelId, fixedLabel: operation.fixedLabel,
    inquiryState: 'exact_current_supported_source', requestDigest: input.requestDigest, acknowledgementCreated: false, internalAlertCreated: false,
    messageCreated: false, taskCreated: false, providerAttemptCreated: false, externalEffectCreated: false
  });
}

class History {
  constructor() { this.byId = new Map(); this.byStable = new Map(); }
  record(input, trusted) {
    const result = project(input, trusted);
    const previous = this.byId.get(input.resolutionId);
    if (previous) {
      if (previous.requestDigest !== input.requestDigest) throw new Error('identity conflict');
      return Object.freeze({...previous, replayed: true});
    }
    if (this.byStable.has(input.idempotencyKeyDigest)) throw new Error('clone');
    const stored = Object.freeze({...result, materialDigest: input.materialDigest, idempotencyKeyDigest: input.idempotencyKeyDigest, replayed: false});
    this.byId.set(input.resolutionId, stored); this.byStable.set(input.idempotencyKeyDigest, input.resolutionId); return stored;
  }
}

describe('Mission 28 Part 9A supported inquiry acknowledgement and internal alert', () => {
  test('binds the released Part8D baseline and every frozen authority hash', () => {
    expect(contract.authority).toMatchObject({baselineCommit: 'e5e84e3aa7189e1d8523812899877bc59f2a6c56', baselineTree: 'ba01f65ce6195d157645812474dec3fdb7fcb272', state: 'implementation_candidate_only'});
    expect(contract.part8DRelease).toMatchObject({acceptedSourceHead: 'c649e358ed9d5b8539774727b371254f173b08a9', pullRequest: 584, mergedMain: 'e5e84e3aa7189e1d8523812899877bc59f2a6c56', deployment: 'f148d5f1-6874-4c2c-afb3-ef423e4e1abb', runningInstance: '617a19ca-5e21-47c6-8db8-db25418f4b83', imageSha256: 'c242868064ed096fed47d23939e424d242932994d8c2c2933e4d17581c0f5b85', productionMigration: '283_of_283_through_287_no_288'});
    for (const input of contract.frozenInputs) expect(digestLf(input.path)).toBe(input.normalizedLfSha256);
  });

  test('uses exactly the frozen current Mission20 lead/contact trigger without creating customer communication authority', () => {
    const trigger = triggerCatalog.triggers.find(item => item.id === contract.supportedInquirySource.triggerId);
    expect(trigger.sourceClassId).toBe(contract.supportedInquirySource.sourceClassId);
    expect(trigger.eventTime.kinds.map(item => item.eventKind)).toEqual(contract.supportedInquirySource.exactEventKinds);
    expect(trigger.allowedActionFamilies).toEqual(expect.arrayContaining(contract.supportedInquirySource.allowedActionFamilies));
    expect(trigger.allowedActionFamilies).not.toContain('customer_communication');
    expect(contract.supportedInquirySource).toMatchObject({requiredCurrentness: 'latest_exact_current', requiredEvaluationResult: 'eligible', customerCommunicationAllowed: false, rawContactOrInquiryTextRetained: false});
  });

  test('projects one exact internal no-effect alert without creating a record, task, notification, message or effect', () => {
    const input = fixture('internal_alert_resolution');
    expect(project(input, copy(input))).toEqual(expect.objectContaining({resultState: 'ready_internal_alert_no_effect', labelId: 'internal_alert_ready_no_effect', fixedLabel: 'Internal alert ready — no message sent', acknowledgementCreated: false, internalAlertCreated: false, messageCreated: false, taskCreated: false, providerAttemptCreated: false, externalEffectCreated: false}));
    expect(contract.fixedTruthContract.internalReadyNeverMeans).toMatch(/record_created_notification_sent_staff_alerted_task_created_seen_acknowledged_or_acted/);
  });

  test('keeps customer acknowledgement fixed, unavailable and free of invented availability or downstream material', () => {
    const input = fixture('customer_acknowledgement_resolution');
    expect(project(input, copy(input))).toEqual(expect.objectContaining({resultState: 'unavailable_customer_acknowledgement_no_external_authority', labelId: 'customer_acknowledgement_unavailable', fixedLabel: 'Customer acknowledgement unavailable — no message sent', acknowledgementCreated: false, messageCreated: false}));
    expect(input.businessAvailabilityBinding).toBeNull(); expect(input.internalAuthorityBinding).toBeNull();
    expect(contract.businessAvailabilityBoundary).toMatchObject({currentAcceptedExactAvailabilityBinding: 'unavailable', currentEnvelopeValue: null, candidateHoursCalendarPromiseEtaPriceScopeEstimateOrBookingNeverCreatesAvailability: true});
    const customerCell = launch.launchCells.find(item => item.actionFamily === 'customer_communication');
    expect(customerCell).toMatchObject({firstLaunchState: 'unavailable', allowedBindings: []});
  });

  test('binds the internal resolution to exact approved action recipient permission content channel provider and authorization material', () => {
    const input = fixture(); const binding = input.internalAuthorityBinding;
    expect(binding).toMatchObject({actionFamilyId: 'internal_read_digest_task', recipientClassId: 'tenant_owner', permissionResultState: 'clear_internal_passive_no_effect', contentTemplateId: 'internal_fact_digest_content_v1', channelId: 'in_app_passive', channelResultState: 'ready_internal_no_effect', providerMode: 'provider_disabled'});
    expect(project(input, copy(input)).resultState).toBe('ready_internal_alert_no_effect');
    for (const mutation of [
      value => { value.internalAuthorityBinding.actionFamilyId = 'owner_approval_request'; },
      value => { value.internalAuthorityBinding.recipientClassId = 'customer'; },
      value => { value.internalAuthorityBinding.permissionResultState = 'unavailable'; },
      value => { value.internalAuthorityBinding.contentTemplateId = 'owner_approval_request_content_v1'; },
      value => { value.internalAuthorityBinding.channelId = 'email'; },
      value => { value.internalAuthorityBinding.channelResultState = 'unavailable_external_channel'; },
      value => { value.internalAuthorityBinding.providerMode = 'live'; },
      value => { value.internalAuthorityBinding.authorizationKind = 'fixed_internal_capability'; },
      value => { value.internalAuthorityBinding.tenantId = '00000000-0000-4000-8000-000000000099'; },
      value => {
        value.internalAuthorityBinding.sourceSetDigest = `sha256:${'99'.repeat(32)}`;
        value.internalAuthorityBinding.authorizationBoundSourceSetDigest = `sha256:${'99'.repeat(32)}`;
      },
      value => { value.internalAuthorityBinding.authorizationBoundRecipientResolutionDigest = `sha256:${'99'.repeat(32)}`; },
      value => { value.internalAuthorityBinding.permissionRecipientResolutionDigest = `sha256:${'99'.repeat(32)}`; },
      value => { value.internalAuthorityBinding.channelContentPreviewDigest = `sha256:${'99'.repeat(32)}`; }
    ]) { const candidate=fixture(); mutation(candidate); seal(candidate); expect(()=>project(candidate, copy(candidate))).toThrow(); }
  });

  test('denies stale, unavailable, substituted or temporally impossible inquiry-source material', () => {
    for (const mutation of [
      value => { value.inquirySourceBinding.triggerId = 'm20.communication_preference_state'; },
      value => { value.inquirySourceBinding.sourceClassId = 'mission21_knowledge_reference'; },
      value => { value.inquirySourceBinding.eventKind = 'preferences_updated'; },
      value => { value.inquirySourceBinding.currentnessState = 'unavailable'; },
      value => { value.inquirySourceBinding.evaluationResult = 'ineligible'; },
      value => { value.inquirySourceBinding.observedAt = '2026-10-28T12:06:00.000000Z'; }
    ]) { const candidate=fixture(); mutation(candidate); seal(candidate); expect(()=>project(candidate, copy(candidate))).toThrow(); }
  });

  test('denies cross-tenant, cross-actor, inactive and operation-capability substitution', () => {
    for (const mutation of [
      value => { value.tenantId = '00000000-0000-4000-8000-000000000099'; },
      value => { value.actorAuthorityBinding.sessionSubjectActorId = '00000000-0000-4000-8000-000000000099'; },
      value => { value.actorAuthorityBinding.membershipSubjectActorId = '00000000-0000-4000-8000-000000000099'; },
      value => { value.actorAuthorityBinding.membershipTenantId = '00000000-0000-4000-8000-000000000099'; },
      value => { value.actorAuthorityBinding.actorState = 'suspended'; },
      value => { value.actorAuthorityBinding.sessionState = 'expired'; },
      value => { value.actorAuthorityBinding.membershipState = 'inactive'; },
      value => { value.actorAuthorityBinding.membershipRoleId = 'admin'; },
      value => { value.actorAuthorityBinding.capabilityId = 'automation_internal_action_view'; }
    ]) { const candidate=fixture(); mutation(candidate); seal(candidate); expect(()=>project(candidate, copy(candidate))).toThrow(); }
  });

  test('does not accept invented availability, customer content, contact values, labels or downstream acknowledgement authority', () => {
    for (const mutation of [
      value => { value.businessAvailabilityBinding = {hours: '9-5', responseTime: '15 minutes'}; },
      value => { value.customerEmail = 'customer@example.test'; },
      value => { value.messageBody = 'We will call in 15 minutes'; },
      value => { value.label = 'Customer acknowledgement sent'; },
      value => { value.internalAuthorityBinding = {...internalAuthority(), channelId: 'email'}; },
      value => { value.operation = 'customer_message_send'; }
    ]) { const candidate=fixture('customer_acknowledgement_resolution'); mutation(candidate); seal(candidate); expect(()=>project(candidate, copy(candidate))).toThrow(); }
    for (const operation of contract.operations) expect(operation.fixedLabel).not.toMatch(/@|phone|price|estimate|booking|minutes|customerId|providerId|sk_/i);
  });

  test('keeps stable idempotency across request identity and evaluation time and immutable replay history', () => {
    const history = new History(); const first = fixture(); expect(history.record(first, copy(first)).replayed).toBe(false); expect(history.record(copy(first), copy(first)).replayed).toBe(true);
    const clone=copy(first); clone.resolutionId='00000000-0000-4000-8000-000000000099'; clone.evaluatedAt='2026-10-28T12:10:00.000000Z'; seal(clone);
    expect(clone.materialDigest).not.toBe(first.materialDigest); expect(clone.requestDigest).not.toBe(first.requestDigest); expect(clone.idempotencyKeyDigest).toBe(first.idempotencyKeyDigest); expect(()=>history.record(clone, copy(clone))).toThrow('clone');
    const conflict=copy(first); conflict.evaluatedAt='2026-10-28T12:10:00.000000Z'; seal(conflict); expect(conflict.idempotencyKeyDigest).toBe(first.idempotencyKeyDigest); expect(()=>history.record(conflict, copy(conflict))).toThrow('identity conflict');
    expect(contract.digestAndReplayContract).toMatchObject({sameIdentitySameCanonicalRequest: 'idempotent_no_effect_projection_replay', sameSemanticMaterialDifferentIdentityOrTime: 'deny_alias_clone_or_replay_reuse', immutableHistory: true});
  });

  test('rejects malformed identifiers, digests, times, operation and independently trusted material mismatch', () => {
    for (const mutation of [
      value => { value.tenantId = 'not-a-uuid'; }, value => { value.resolutionId = ''; },
      value => { value.inquirySourceBinding.snapshotDigest = 'not-a-digest'; }, value => { value.internalAuthorityBinding.actionUnitDigest = `sha256:${'99'.repeat(32)}`; },
      value => { value.evaluatedAt = 'tomorrow'; }, value => { value.operation = 'internal_message_send'; }, value => { value.requestDigest = `sha256:${'99'.repeat(32)}`; }
    ]) { const candidate=fixture(); mutation(candidate); expect(()=>project(candidate, copy(candidate))).toThrow(); }
    const candidate=fixture(); candidate.inquirySourceBinding.snapshotId='00000000-0000-4000-8000-000000000099'; seal(candidate); expect(()=>project(candidate, fixture())).toThrow('trusted resolution');
  });

  test('rejects unknown, missing, accessor, symbol, proxy, toJSON, custom-prototype, sparse and alias data before hooks', () => {
    for (const mutation of [
      value => { value.extra = 'customer@example.test'; }, value => { delete value.requestDigest; },
      value => { value.inquirySourceBinding.toJSON = () => ({currentnessState:'latest_exact_current'}); },
      value => { Object.setPrototypeOf(value.actorAuthorityBinding, {}); }, value => { value.internalAuthorityBinding = value.inquirySourceBinding; }
    ]) { const candidate=fixture(); mutation(candidate); expect(()=>project(candidate, fixture())).toThrow(); }
    let getters=0; const accessor=fixture(); Object.defineProperty(accessor.inquirySourceBinding,'snapshotDigest',{enumerable:true,get(){getters+=1;return `sha256:${'21'.repeat(32)}`;}}); expect(()=>project(accessor,fixture())).toThrow(); expect(getters).toBe(0);
    const symbol=fixture(); symbol[Symbol('secret')]='sk_secret'; expect(()=>project(symbol,fixture())).toThrow();
    let traps=0; const proxy=new Proxy(fixture(),{get(){traps+=1;throw new Error('trap');},ownKeys(){traps+=1;throw new Error('trap');}}); expect(()=>project(proxy,fixture())).toThrow(); expect(traps).toBe(0);
    const sparse=fixture(); sparse.extraArray=[]; sparse.extraArray[1]='value'; expect(()=>project(sparse,fixture())).toThrow();
  });

  test('freezes zero-effect runtime boundaries with migration287 latest and no288', () => {
    expect(Object.values(contract.privacyAndEffects).every(value => value === 0)).toBe(true);
    expect(contract.runtimeBoundary).toMatchObject({newMigration:false,newTableFunctionRouteOrUi:false,mountedSchedulerWorkerQueueOrPolicyExecutor:false,providerAdapterCallbackOrInboundReceiver:false,customerOrInternalMessageNotificationOrTask:false,externalEffectOrUpstreamMutation:false,nextMigrationAbsent:'288'});
    const migrations=fs.readdirSync(path.join(ROOT,'migrations')).filter(name=>/^\d+_/.test(name)).sort(); expect(migrations.at(-1)).toBe('287_canonical_automation_estimate_quote_resolution_v1.sql'); expect(migrations.some(name=>name.startsWith('288_'))).toBe(false);
  });

  test('roadmap and ledger record Part9A released, Part9B candidate only and Part9C+ planned', () => {
    const roadmap=fs.readFileSync(ROADMAP,'utf8'); const ledger=fs.readFileSync(LEDGER,'utf8'); const markdown=fs.readFileSync(CONTRACT_MD,'utf8');
    for(const document of [roadmap,ledger]) { expect(document).toContain('Parts 1A–9D are released. Part 10A is the sole implementation candidate.'); expect(document).toContain('Parts 10B–14G remain planned and unimplemented.'); expect(document).toContain('f148d5f1-6874-4c2c-afb3-ef423e4e1abb'); expect(document).toContain('sha256:c242868064ed096fed47d23939e424d242932994d8c2c2933e4d17581c0f5b85'); }
    expect(ledger).toContain('| 37 | 9A | Supported inquiry acknowledgement and internal alert | **Released** |'); expect(ledger).toContain('| 38 | 9B | Bounded contact-attempt and response-follow-up cadence | **Released** |'); expect(ledger).toContain('| 39 | 9C | Exact-current estimate/quote follow-up | **Released** |'); expect(ledger).toContain('| 40 | 9D | Explicitly reviewed customer re-engagement boundary | **Released** |');
    expect((ledger.match(/\*\*Implementation candidate\*\*/g)||[])).toHaveLength(1); expect((ledger.match(/Planned \/ unimplemented/g)||[])).toHaveLength(25); expect(markdown).toContain('No migration 288');
  });
});
