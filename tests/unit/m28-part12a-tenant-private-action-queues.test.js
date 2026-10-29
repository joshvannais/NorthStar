const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { types } = require('util');

const ROOT = path.resolve(__dirname, '../..');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
const contract = readJson('docs/architecture/MISSION_28_PART12A_TENANT_PRIVATE_ACTION_QUEUE_CONTRACT.json');
const launch = readJson('docs/architecture/MISSION_28_PART1D_FIRST_LAUNCH_MATRIX.json');
const capabilities = readJson('docs/architecture/MISSION_28_PART3A_FIXED_CAPABILITY_MATRIX.json');
const triggers = readJson('docs/architecture/MISSION_28_PART4A_CLOSED_TRIGGER_CATALOG.json');
const UUID = new RegExp(contract.identityGrammar.uuidPattern);
const DIGEST = new RegExp(contract.identityGrammar.digestPattern);
const UTC = new RegExp(contract.identityGrammar.utcInstantPattern);
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const digest = n => `sha256:${Number(n).toString(16).padStart(64, '0')}`;
const copy = value => JSON.parse(JSON.stringify(value));
const canonicalize = value => Array.isArray(value) ? value.map(canonicalize) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])])) : value;
const hash = value => `sha256:${crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(canonicalize(value))).digest('hex')}`;
const digestLf = relative => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, relative), 'utf8').replace(/\r\n/g, '\n')).digest('hex').toUpperCase();

function dataOnly(value, seen = new WeakSet()) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number') { if (!Number.isSafeInteger(value)) throw new Error('number'); return; }
  if (typeof value !== 'object' || types.isProxy(value) || seen.has(value)) throw new Error('plain data');
  seen.add(value);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== Array.prototype) throw new Error('prototype');
  if (Object.getOwnPropertySymbols(value).length) throw new Error('symbol');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.prototype.hasOwnProperty.call(descriptors, 'toJSON')) throw new Error('toJSON');
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) throw new Error('sparse');
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[index];
      if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) throw new Error('descriptor');
      dataOnly(descriptor.value, seen);
    }
    return;
  }
  for (const descriptor of Object.values(descriptors)) {
    if (!descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) throw new Error('descriptor');
    dataOnly(descriptor.value, seen);
  }
}

function exactKeys(value, keys) {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) throw new Error('keys');
}

function micros(value) {
  if (typeof value !== 'string' || !UTC.test(value)) return null;
  const milliseconds = Date.parse(`${value.slice(0, 19)}Z`);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString().slice(0, 19) !== value.slice(0, 19)) return null;
  return BigInt(milliseconds) * 1000n + BigInt(value.slice(20, 26));
}

function materialOf(input) { const value = copy(input); delete value.materialDigest; delete value.idempotencyKeyDigest; delete value.requestDigest; return value; }
function stableOf(input) { const value = materialOf(input); delete value.queueProjectionId; delete value.evaluatedAt; return value; }
function requestOf(input) { const value = copy(input); delete value.materialDigest; delete value.idempotencyKeyDigest; delete value.requestDigest; return value; }
function seal(input) { input.materialDigest = hash(materialOf(input)); input.idempotencyKeyDigest = hash(stableOf(input)); input.requestDigest = hash(requestOf(input)); return input; }

function fixture(kindId = 'owner_task') {
  const tenantId = uuid(1); const snapshotId = uuid(20); const snapshotDigest = digest(20); const kind = contract.queueKinds.find(item => item.id === kindId);
  const collection = kind.actionFamily === 'collection_escalation';
  const trigger = triggers.triggers.find(item => item.id === (collection ? 'm27.reviewed_collection_handoff' : 'm23.work_progress_state'));
  const assigneeRoleId = kind.assigneeRoles[0];
  const assigned = kind.recipientClass === 'assigned_staff';
  const input = {
    schemaVersion: contract.contractVersion,
    tenantId,
    queueProjectionId: uuid(2),
    queueKind: kind.id,
    sourceBinding: {tenantId, triggerId: trigger.id, sourceClassId: trigger.sourceClassId, actionFamily: kind.actionFamily, snapshotId, snapshotDigest, lineageId: uuid(21), lineageKind: 'active', snapshotLineageSequence: 3, predecessorSnapshotId: uuid(19), predecessorSnapshotDigest: digest(19), headTransitionId: uuid(22), headTransitionDigest: digest(22), headSequence: 5, effectiveSnapshotId: snapshotId, effectiveSnapshotDigest: snapshotDigest, eventKind: trigger.eventTime.kinds[0].eventKind, eventTime: '2026-10-29T12:00:00.000000Z', observedAt: '2026-10-29T12:04:00.000000Z', currentnessState: 'latest_exact_current'},
    creatorAuthorityBinding: {actorId: uuid(30), sessionId: uuid(31), membershipId: uuid(32), sessionSubjectActorId: uuid(30), membershipSubjectActorId: uuid(30), actorTenantId: tenantId, sessionTenantId: tenantId, membershipTenantId: tenantId, actorState: 'active', sessionState: 'active', membershipState: 'active', membershipRoleId: 'owner', part1DCapabilityId: kind.creatorCapability, part3AVisibilityCapabilityId: 'automation_view', capabilityDecisionId: uuid(33), capabilityDecisionDigest: digest(33), recordScope: 'exact_tenant_all_automation'},
    assigneeBinding: {assigneeActorId: uuid(40), assigneeMembershipId: uuid(41), assigneeMembershipSubjectActorId: uuid(40), assigneeTenantId: tenantId, assigneeMembershipState: 'active', assigneeRoleId, recipientClassId: kind.recipientClass},
    visibilityBinding: {viewerActorId: uuid(40), viewerSessionId: uuid(42), viewerMembershipId: uuid(41), viewerSessionSubjectActorId: uuid(40), viewerMembershipSubjectActorId: uuid(40), viewerTenantId: tenantId, viewerSessionTenantId: tenantId, viewerMembershipTenantId: tenantId, viewerActorState: 'active', viewerSessionState: 'active', viewerMembershipState: 'active', viewerMembershipRoleId: assigneeRoleId, visibilityCapabilityId: 'automation_view', capabilityDecisionId: uuid(44), capabilityDecisionDigest: digest(44), visibilityRecordScope: assigned ? 'exact_assigned_internal_records_only' : 'exact_tenant_all_automation', assignedRecordId: assigned ? snapshotId : null, tenantWideVisibleToOwnerAdmin: !assigned, assignedVisibleToMemberOnly: assigned},
    dueWindow: {notBefore: '2026-10-29T12:05:00.000000Z', dueBy: '2026-10-30T12:05:00.000000Z'},
    reasonCode: kind.reasonCodes[0],
    priority: kind.priorities[0],
    sourceLink: {linkKind: 'opaque_internal_source_record', tenantId, sourceRecordId: snapshotId, sourceRecordDigest: snapshotDigest, snapshotId, snapshotDigest},
    completionEvidence: {state: 'unavailable_no_accepted_completion_authority', completionRecordId: null, completionRecordDigest: null, completedByActorId: null, completedAt: null},
    evaluatedAt: '2026-10-29T12:05:00.000000Z', materialDigest: '', idempotencyKeyDigest: '', requestDigest: ''
  };
  return seal(input);
}

function validate(input, trusted) {
  dataOnly(input); dataOnly(trusted);
  if (hash(input) !== hash(trusted)) throw new Error('trusted resolution');
  const fields = contract.envelope;
  exactKeys(input, fields.exactFields); exactKeys(input.sourceBinding, fields.sourceBindingExactFields); exactKeys(input.creatorAuthorityBinding, fields.creatorAuthorityBindingExactFields); exactKeys(input.assigneeBinding, fields.assigneeBindingExactFields); exactKeys(input.visibilityBinding, fields.visibilityBindingExactFields); exactKeys(input.dueWindow, fields.dueWindowExactFields); exactKeys(input.sourceLink, fields.sourceLinkExactFields); exactKeys(input.completionEvidence, fields.completionEvidenceExactFields);
  if (input.schemaVersion !== contract.contractVersion || !UUID.test(input.tenantId) || !UUID.test(input.queueProjectionId)) throw new Error('envelope');
  const kind = contract.queueKinds.find(item => item.id === input.queueKind); if (!kind) throw new Error('kind');
  const source = input.sourceBinding; const creator = input.creatorAuthorityBinding; const assignee = input.assigneeBinding; const visibility = input.visibilityBinding;
  for (const tenant of [source.tenantId, creator.actorTenantId, creator.sessionTenantId, creator.membershipTenantId, assignee.assigneeTenantId, visibility.viewerTenantId, visibility.viewerSessionTenantId, visibility.viewerMembershipTenantId, input.sourceLink.tenantId]) if (tenant !== input.tenantId) throw new Error('tenant');
  for (const value of [source.snapshotId, source.lineageId, source.predecessorSnapshotId, source.headTransitionId, creator.actorId, creator.sessionId, creator.membershipId, creator.capabilityDecisionId, assignee.assigneeActorId, assignee.assigneeMembershipId, visibility.viewerActorId, visibility.viewerSessionId, visibility.viewerMembershipId, visibility.capabilityDecisionId, input.sourceLink.sourceRecordId, input.sourceLink.snapshotId]) if (!UUID.test(value)) throw new Error('identity');
  for (const value of [source.snapshotDigest, source.predecessorSnapshotDigest, source.headTransitionDigest, source.effectiveSnapshotDigest, creator.capabilityDecisionDigest, visibility.capabilityDecisionDigest, input.sourceLink.sourceRecordDigest, input.sourceLink.snapshotDigest, input.materialDigest, input.idempotencyKeyDigest, input.requestDigest]) if (!DIGEST.test(value)) throw new Error('digest');
  const trigger = triggers.triggers.find(item => item.id === source.triggerId);
  if (!trigger || source.sourceClassId !== trigger.sourceClassId || source.actionFamily !== kind.actionFamily || !trigger.allowedActionFamilies.includes(source.actionFamily) || !contract.sourceAuthorityContract.allowedSourceClassIds.includes(source.sourceClassId)) throw new Error('trigger action');
  if (source.lineageKind !== 'active' || source.currentnessState !== 'latest_exact_current' || !Number.isSafeInteger(source.snapshotLineageSequence) || source.snapshotLineageSequence < 2 || !Number.isSafeInteger(source.headSequence) || source.headSequence < 1 || source.headSequence > contract.bounds.maximumLineageSequence || source.effectiveSnapshotId !== source.snapshotId || source.effectiveSnapshotDigest !== source.snapshotDigest || !trigger.eventTime.kinds.some(item => item.eventKind === source.eventKind)) throw new Error('source head');
  const evaluated = micros(input.evaluatedAt); const event = micros(source.eventTime); const observed = micros(source.observedAt);
  if (evaluated === null || event === null || observed === null || observed > evaluated || evaluated - observed > BigInt(contract.bounds.maximumSourceObservationAgeSeconds) * 1000000n) throw new Error('currentness');
  if (creator.actorId !== creator.sessionSubjectActorId || creator.actorId !== creator.membershipSubjectActorId || creator.actorState !== 'active' || creator.sessionState !== 'active' || creator.membershipState !== 'active' || creator.part1DCapabilityId !== kind.creatorCapability || creator.part3AVisibilityCapabilityId !== 'automation_view') throw new Error('creator');
  const launchCell = launch.launchCells.find(item => item.actionFamily === kind.actionFamily); const launchBinding = launchCell && launchCell.allowedBindings.find(item => item.roleId === creator.membershipRoleId && item.capabilityId === creator.part1DCapabilityId && item.recipientClassId === kind.recipientClass);
  if (!launchCell || launchCell.firstLaunchState !== 'conditional_first_launch_not_implemented' || !launchCell.sourceClassIds.includes(source.sourceClassId) || !launchBinding) throw new Error('launch binding');
  const creatorProfile = capabilities.membershipProfiles.find(item => item.membershipRoleId === creator.membershipRoleId);
  if (!creatorProfile || !creatorProfile.capabilityIds.includes('automation_view') || creator.recordScope !== 'exact_tenant_all_automation') throw new Error('creator scope');
  if (assignee.assigneeActorId !== assignee.assigneeMembershipSubjectActorId || assignee.assigneeMembershipState !== 'active' || !kind.assigneeRoles.includes(assignee.assigneeRoleId) || assignee.recipientClassId !== kind.recipientClass) throw new Error('assignee');
  const assigned = kind.recipientClass === 'assigned_staff';
  const viewerProfile = capabilities.membershipProfiles.find(item => item.membershipRoleId === visibility.viewerMembershipRoleId);
  if (visibility.viewerActorId !== visibility.viewerSessionSubjectActorId || visibility.viewerActorId !== visibility.viewerMembershipSubjectActorId || visibility.viewerActorState !== 'active' || visibility.viewerSessionState !== 'active' || visibility.viewerMembershipState !== 'active' || visibility.visibilityCapabilityId !== 'automation_view' || !viewerProfile || !viewerProfile.capabilityIds.includes('automation_view') || visibility.visibilityRecordScope !== (assigned ? 'exact_assigned_internal_records_only' : 'exact_tenant_all_automation') || visibility.assignedRecordId !== (assigned ? source.snapshotId : null) || visibility.tenantWideVisibleToOwnerAdmin !== !assigned || visibility.assignedVisibleToMemberOnly !== assigned) throw new Error('visibility');
  if (assigned && (visibility.viewerActorId !== assignee.assigneeActorId || visibility.viewerMembershipId !== assignee.assigneeMembershipId || visibility.viewerMembershipRoleId !== assignee.assigneeRoleId)) throw new Error('assigned viewer');
  const notBefore = micros(input.dueWindow.notBefore); const dueBy = micros(input.dueWindow.dueBy);
  if (notBefore === null || dueBy === null || notBefore < evaluated || dueBy < notBefore || dueBy - evaluated > BigInt(contract.bounds.maximumDueWindowSeconds) * 1000000n) throw new Error('due window');
  if (!kind.reasonCodes.includes(input.reasonCode) || Buffer.byteLength(input.reasonCode) > contract.bounds.maximumReasonCodeLength || !kind.priorities.includes(input.priority)) throw new Error('reason priority');
  if (input.sourceLink.linkKind !== 'opaque_internal_source_record' || input.sourceLink.sourceRecordId !== source.snapshotId || input.sourceLink.sourceRecordDigest !== source.snapshotDigest || input.sourceLink.snapshotId !== source.snapshotId || input.sourceLink.snapshotDigest !== source.snapshotDigest) throw new Error('source link');
  if (input.completionEvidence.state !== contract.recordContract.completionEvidenceState || ['completionRecordId','completionRecordDigest','completedByActorId','completedAt'].some(key => input.completionEvidence[key] !== null)) throw new Error('completion');
  if (Buffer.byteLength(JSON.stringify(input)) > contract.bounds.maximumCanonicalRequestBytes || input.materialDigest !== hash(materialOf(input)) || input.idempotencyKeyDigest !== hash(stableOf(input)) || input.requestDigest !== hash(requestOf(input))) throw new Error('sealed material');
}

function project(input, trusted) {
  validate(input, trusted);
  return Object.freeze({queueProjectionId: input.queueProjectionId, tenantId: input.tenantId, queueKind: input.queueKind, sourceSnapshotId: input.sourceBinding.snapshotId, sourceSnapshotDigest: input.sourceBinding.snapshotDigest, assigneeActorId: input.assigneeBinding.assigneeActorId, reasonCode: input.reasonCode, priority: input.priority, evaluatedAt: input.evaluatedAt, resultState: contract.fixedDecision.resultState, reasonState: contract.fixedDecision.reasonState, labelId: contract.fixedDecision.labelId, fixedLabel: contract.fixedDecision.fixedLabel, ownerReadableNoEffectOnly: true, queueRecordCreated: false, taskCreated: false, alertCreated: false, approvalRequestCreated: false, failureWorkCreated: false, followUpCreated: false, completionEvidenceCreated: false, messageCreated: false, providerAttemptCreated: false, externalEffectCreated: false, upstreamMutationCreated: false, moneyEffectCreated: false});
}

class History {
  constructor() { this.byId = new Map(); this.byStable = new Map(); }
  record(input, trusted) {
    const output = project(input, trusted); const prior = this.byId.get(input.queueProjectionId);
    if (prior) { if (prior.requestDigest !== input.requestDigest || prior.materialDigest !== input.materialDigest || prior.idempotencyKeyDigest !== input.idempotencyKeyDigest) throw new Error('identity conflict'); return {...prior, replayed: true}; }
    if (this.byStable.has(input.idempotencyKeyDigest)) throw new Error('semantic clone');
    const stored = Object.freeze({...output, requestDigest: input.requestDigest, materialDigest: input.materialDigest, idempotencyKeyDigest: input.idempotencyKeyDigest, replayed: false}); this.byId.set(input.queueProjectionId, stored); this.byStable.set(input.idempotencyKeyDigest, input.queueProjectionId); return stored;
  }
}

describe('Mission 28 Part 12A tenant-private action queue contract', () => {
  test('binds Part11F release and exact frozen authorities', () => {
    expect(contract.authority).toMatchObject({part: '12A', state: 'implementation_candidate_only', baselineCommit: 'aea7f65174923b9328dae9454ad2f9a351fe09a4', baselineTree: '48c9944659282a5aea106c2cbbc625759552cb5e'});
    expect(contract.part11FRelease).toMatchObject({acceptedSourceHead: '83399ffce66b32497221554c0dd839e27403d454', acceptedTree: '48c9944659282a5aea106c2cbbc625759552cb5e', pullRequest: 598, mergedMain: 'aea7f65174923b9328dae9454ad2f9a351fe09a4', mergedAt: '2026-10-29T19:40:39Z', productionAccepted: true, freshAudit: {verdict: 'P0=0_P1=0_P2=0_P3=0', nodeVersion: '22.23.3', focusedTests: '16/16', parts11ATo11F: '6_suites_90_tests', cumulativeMission28: '50_suites_692_tests', migrationHistory: '2_suites_40_tests', syntax: '50/50', json: '49/49', migrations: '283_through_287_no_288', changedPaths: '54_docs_tests_only', protectedPaths: 0, diffCheck: 'clean', remoteAndWorktree: 'clean_and_exact'}, release: {deploymentId: 'fdfcea4e-b515-4551-91e8-ce9b160adea3', deploymentStatus: 'SUCCESS', serviceInstanceId: '7ee4f747-38c2-4baa-a024-1d7db6e7c218', deploymentInstanceId: 'e16b9ccd-34fb-4f27-88fc-cb114ef42bcc', deploymentInstanceStatus: 'RUNNING', imageSha256: 'sha256:fa4a1641a43db1959172002d4146ec580db6d8ccb9edcbf4d27ff7040a41567f', canonicalStartup: 'ready'}, directAppliedProductionMigrationHistory: 'unavailable_and_unclaimed'});
    for (const item of contract.frozenInputs) expect(digestLf(item.path)).toBe(item.normalizedLfSha256);
  });

  test('freezes every Part12A queue kind with exact launch capability and assignee material', () => {
    expect(contract.queueKinds.map(item => item.id)).toEqual(['owner_task','staff_task','alert','approval_request','failure_work','follow_up_queue_item','collection_owner_work_item']);
    for (const kind of contract.queueKinds) expect(project(fixture(kind.id), fixture(kind.id))).toMatchObject({queueKind: kind.id, resultState: contract.fixedDecision.resultState, queueRecordCreated: false, externalEffectCreated: false});
  });

  test('binds exact Part4 trigger source class snapshot lineage and authoritative head', () => {
    for (const mutation of [value => { value.sourceBinding.triggerId = 'm20.lead_contact_state'; }, value => { value.sourceBinding.sourceClassId = 'mission20_business_contact_preferences'; }, value => { value.sourceBinding.actionFamily = 'collection_escalation'; }, value => { value.sourceBinding.effectiveSnapshotId = uuid(99); }, value => { value.sourceBinding.effectiveSnapshotDigest = digest(99); }, value => { value.sourceBinding.lineageKind = 'tombstoned'; }, value => { value.sourceBinding.currentnessState = 'stale'; }, value => { value.sourceBinding.eventKind = 'unknown'; }]) { const input = fixture(); mutation(input); seal(input); expect(() => project(input, fixture())).toThrow(); }
  });

  test('fails closed on stale observations while event time never establishes precedence', () => {
    const futureEffective = fixture(); futureEffective.sourceBinding.eventTime = '2026-10-30T12:00:00.000000Z'; seal(futureEffective); expect(project(futureEffective, copy(futureEffective)).resultState).toBe(contract.fixedDecision.resultState);
    for (const mutation of [value => { value.sourceBinding.observedAt = '2026-10-29T12:05:00.000001Z'; }, value => { value.sourceBinding.observedAt = '2026-10-29T11:59:59.999999Z'; }, value => { value.evaluatedAt = 'invalid'; }]) { const input = fixture(); mutation(input); seal(input); expect(() => project(input, copy(input))).toThrow('currentness'); }
  });

  test('requires exact active creator subject capability launch binding and record scope', () => {
    for (const mutation of [value => { value.creatorAuthorityBinding.sessionSubjectActorId = uuid(99); }, value => { value.creatorAuthorityBinding.membershipSubjectActorId = uuid(99); }, value => { value.creatorAuthorityBinding.membershipState = 'suspended'; }, value => { value.creatorAuthorityBinding.membershipRoleId = 'member'; }, value => { value.creatorAuthorityBinding.part1DCapabilityId = 'automation_external_effect_execute'; }, value => { value.creatorAuthorityBinding.recordScope = 'wildcard'; }]) { const input = fixture(); mutation(input); seal(input); expect(() => project(input, copy(input))).toThrow(); }
  });

  test('requires exact active same-tenant assignee and member assigned-record visibility', () => {
    const valid = fixture('staff_task'); expect(project(valid, copy(valid)).queueKind).toBe('staff_task');
    for (const mutation of [value => { value.assigneeBinding.assigneeTenantId = uuid(99); }, value => { value.assigneeBinding.assigneeMembershipSubjectActorId = uuid(99); }, value => { value.assigneeBinding.assigneeMembershipState = 'disabled'; }, value => { value.assigneeBinding.assigneeRoleId = 'owner'; }, value => { value.visibilityBinding.viewerActorId = uuid(99); }, value => { value.visibilityBinding.viewerSessionSubjectActorId = uuid(99); }, value => { value.visibilityBinding.viewerMembershipState = 'disabled'; }, value => { value.visibilityBinding.visibilityCapabilityId = 'automation_internal_action_prepare'; }, value => { value.visibilityBinding.visibilityRecordScope = 'exact_tenant_all_automation'; }, value => { value.visibilityBinding.assignedRecordId = uuid(99); }]) { const input = fixture('staff_task'); mutation(input); seal(input); expect(() => project(input, copy(input))).toThrow(); }
  });

  test('keeps collection work owner-only and bound to the reviewed Mission27 handoff', () => {
    const input = fixture('collection_owner_work_item'); expect(project(input, copy(input))).toMatchObject({queueKind: 'collection_owner_work_item', queueRecordCreated: false});
    for (const mutation of [value => { value.sourceBinding.triggerId = 'm27.receivable_due_aging_state'; }, value => { value.creatorAuthorityBinding.membershipRoleId = 'admin'; }, value => { value.creatorAuthorityBinding.part1DCapabilityId = 'automation_internal_action_prepare'; }, value => { value.assigneeBinding.assigneeRoleId = 'member'; }]) { const bad = fixture('collection_owner_work_item'); mutation(bad); seal(bad); expect(() => project(bad, copy(bad))).toThrow(); }
  });

  test('enforces bounded due window fixed reason priority and opaque source link', () => {
    for (const mutation of [value => { value.dueWindow.notBefore = '2026-10-29T12:04:59.999999Z'; }, value => { value.dueWindow.dueBy = '2026-12-01T12:05:00.000000Z'; }, value => { value.reasonCode = 'customer@example.test'; }, value => { value.priority = 'critical'; }, value => { value.sourceLink.linkKind = 'https://customer.example.test'; }, value => { value.sourceLink.sourceRecordDigest = digest(99); }]) { const input = fixture(); mutation(input); seal(input); expect(() => project(input, copy(input))).toThrow(); }
  });

  test('does not fabricate completion evidence or convert visibility into completion authority', () => {
    expect(contract.recordContract.completionEvidenceState).toBe('unavailable_no_accepted_completion_authority');
    for (const mutation of [value => { value.completionEvidence.state = 'completed'; }, value => { value.completionEvidence.completionRecordId = uuid(99); }, value => { value.completionEvidence.completedByActorId = value.creatorAuthorityBinding.actorId; }, value => { value.completionEvidence.completedAt = value.evaluatedAt; }]) { const input = fixture(); mutation(input); seal(input); expect(() => project(input, copy(input))).toThrow('completion'); }
  });

  test('uses stable semantic idempotency and denies clone and conflict reuse', () => {
    const history = new History(); const first = fixture(); expect(history.record(first, copy(first)).replayed).toBe(false); expect(history.record(copy(first), copy(first)).replayed).toBe(true);
    const clone = copy(first); clone.queueProjectionId = uuid(90); clone.evaluatedAt = '2026-10-29T12:04:30.000000Z'; seal(clone); expect(clone.idempotencyKeyDigest).toBe(first.idempotencyKeyDigest); expect(() => history.record(clone, copy(clone))).toThrow('semantic clone');
    const assigned = fixture('staff_task'); const assignedClone = copy(assigned); assignedClone.queueProjectionId = uuid(91); assignedClone.evaluatedAt = '2026-10-29T12:04:30.000000Z'; seal(assignedClone); expect(assignedClone.visibilityBinding.assignedRecordId).toBe(assigned.sourceBinding.snapshotId); expect(assignedClone.idempotencyKeyDigest).toBe(assigned.idempotencyKeyDigest);
    const conflict = copy(first); conflict.evaluatedAt = '2026-10-29T12:04:30.000000Z'; seal(conflict); expect(() => history.record(conflict, copy(conflict))).toThrow('identity conflict');
  });

  test('rejects cross-tenant source actor assignee and source-link grafts', () => {
    for (const mutation of [value => { value.sourceBinding.tenantId = uuid(99); }, value => { value.creatorAuthorityBinding.sessionTenantId = uuid(99); }, value => { value.assigneeBinding.assigneeTenantId = uuid(99); }, value => { value.visibilityBinding.viewerSessionTenantId = uuid(99); }, value => { value.sourceLink.tenantId = uuid(99); }, value => { value.sourceLink.snapshotId = uuid(99); }]) { const input = fixture(); mutation(input); seal(input); expect(() => project(input, copy(input))).toThrow(); }
  });

  test('rejects malformed descriptor proxy symbol alias and extra-field data before projection', () => {
    for (const mutation of [value => { value.extra = 'x'; }, value => { delete value.requestDigest; }, value => { value.sourceBinding.customerEmail = 'customer@example.test'; }, value => { value.sourceBinding.toJSON = () => ({}); }, value => { Object.setPrototypeOf(value.assigneeBinding, {}); }, value => { value.assigneeBinding = value.creatorAuthorityBinding; }]) { const input = fixture(); mutation(input); expect(() => project(input, fixture())).toThrow(); }
    let getters = 0; const accessor = fixture(); Object.defineProperty(accessor.sourceBinding, 'currentnessState', {enumerable: true, get() { getters += 1; return 'latest_exact_current'; }}); expect(() => project(accessor, fixture())).toThrow(); expect(getters).toBe(0);
    const symbol = fixture(); symbol[Symbol('secret')] = 'sk_secret'; expect(() => project(symbol, fixture())).toThrow();
    let traps = 0; const proxy = new Proxy(fixture(), {get() { traps += 1; throw new Error('trap'); }, ownKeys() { traps += 1; throw new Error('trap'); }}); expect(() => project(proxy, fixture())).toThrow(); expect(traps).toBe(0);
    const sparse = fixture(); sparse.sourceBinding = [sparse.sourceBinding]; sparse.sourceBinding[2] = {}; expect(() => project(sparse, fixture())).toThrow();
  });

  test('projects only one fixed privacy-safe no-effect result', () => {
    const output = project(fixture(), fixture()); expect(Object.keys(output).sort()).toEqual([...contract.envelope.outputFields].sort()); expect(output).toMatchObject({resultState: 'tenant_private_action_queue_unavailable_no_mounted_authority', ownerReadableNoEffectOnly: true, queueRecordCreated: false, taskCreated: false, alertCreated: false, approvalRequestCreated: false, failureWorkCreated: false, followUpCreated: false, completionEvidenceCreated: false, messageCreated: false, providerAttemptCreated: false, externalEffectCreated: false, upstreamMutationCreated: false, moneyEffectCreated: false}); expect(output.fixedLabel).not.toMatch(/@|phone|token|sk_|customer|amount|https?:|legal threat/i);
  });

  test('freezes docs-tests-only scope with migration287 latest and no288', () => {
    expect(contract.runtimeBoundary).toMatchObject({newMigration: false, newTableFunctionRouteWorkerQueueSchedulerOrUi: false, mountedTaskAlertApprovalFailureOrFollowUpPersistence: false, queueRecordsCreated: 0, messagesCreated: 0, latestMigration: '287_canonical_automation_estimate_quote_resolution_v1.sql', nextMigrationAbsent: '288'});
    const migrations = fs.readdirSync(path.join(ROOT, 'migrations')).filter(name => /^\d+_/.test(name)).sort(); expect(migrations).toHaveLength(283); expect(migrations.at(-1)).toBe('287_canonical_automation_estimate_quote_resolution_v1.sql'); expect(migrations.some(name => name.startsWith('288_'))).toBe(false);
  });

  test('roadmap and ledger record Part11F released Part12A candidate and later slices planned', () => {
    const roadmap = fs.readFileSync(path.join(ROOT, 'docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md'), 'utf8'); const ledger = fs.readFileSync(path.join(ROOT, 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md'), 'utf8');
    for (const value of [roadmap, ledger]) { expect(value).toContain('Parts 1A–12B are released. Part 12C is the sole implementation candidate.'); expect(value).toContain('Parts 12D–14G remain planned and unimplemented.'); for (const identity of ['83399ffce66b32497221554c0dd839e27403d454','48c9944659282a5aea106c2cbbc625759552cb5e','aea7f65174923b9328dae9454ad2f9a351fe09a4','fdfcea4e-b515-4551-91e8-ce9b160adea3','7ee4f747-38c2-4baa-a024-1d7db6e7c218','e16b9ccd-34fb-4f27-88fc-cb114ef42bcc','sha256:fa4a1641a43db1959172002d4146ec580db6d8ccb9edcbf4d27ff7040a41567f','b42145ddc95e9bc2a383f9dac6ad1f5a884a90d5a3e999a0c126b2b6e3bae369']) expect(value).toContain(identity); expect(value).toMatch(/direct applied production migration history.*unavailable.*unclaimed/i); }
    expect((ledger.match(/\| \*\*Released\*\* \|/g) || []).length).toBe(52); expect((ledger.match(/\| \*\*Implementation candidate\*\* \|/g) || []).length).toBe(1); expect((ledger.match(/\| Planned \/ unimplemented \|/g) || []).length).toBe(13);
  });
});
