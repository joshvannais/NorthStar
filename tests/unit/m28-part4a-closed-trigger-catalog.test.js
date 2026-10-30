'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const parse = relative => JSON.parse(read(relative));
const clone = value => JSON.parse(JSON.stringify(value));
const CONTRACT_PATH = 'docs/architecture/MISSION_28_PART4A_CLOSED_TRIGGER_CATALOG.json';
const ROADMAP_PATH = 'docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md';
const LEDGER_PATH = 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md';
const BASE = '041971bb190998e1444087482941686c4166573d';
const BASE_TREE = 'ac4b98e48a7fd524e96ed41305f8a677350587a1';

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
  'docs/architecture/MISSION_28_PART3B_APPROVAL_AUTHORIZATION_CONTRACT.json': '6A7558C5BC61C31B627C9C0C474955B98E1D2D7BA5CC537C57F7F9D767A52575',
  'docs/architecture/MISSION_28_PART3C_OWNER_LIMITS_CONTRACT.json': '79031B6D3747FA538D151C1E2597AEE3F072D1AB66772A3E6AB58479C2A38321',
  'docs/architecture/MISSION_28_PART3D_GOVERNANCE_CONTROL_CONTRACT.json': 'D1DA31C44602127C6DDF95FE96B59FA57D1E23DA291717D64F658DD0B2E3AF81',
  'docs/architecture/MISSION_28_PART3D_GOVERNANCE_CONTROL_CONTRACT.md': '65458B8C9EF563A9FC0BD93FDAAD6B4DA44CA2E8B4EF2B1BFC32D9B6B9AB0943',
});

const SOURCE_CLASSES = Object.freeze([
  'mission20_business_contact_preferences',
  'mission21_knowledge_reference',
  'mission22_appointment_dispatch',
  'mission23_work_execution',
  'mission24_estimate_quote',
  'mission25_26_advisory',
  'mission27_financial_collection',
]);
const ACTIONS = Object.freeze([
  'internal_read_digest_task', 'owner_approval_request', 'customer_communication',
  'secure_document_delivery', 'financial_reminder', 'collection_escalation',
  'unsupported_upstream_mutation_or_money_movement',
]);
const ELIGIBLE = Object.freeze(['internal_read_digest_task', 'owner_approval_request', 'collection_escalation']);
const EVENT_TIME_SELECTOR = 'event_kind_selects_exactly_one_source_field_no_precedence';
const EVENT_TIME_AMBIGUITY = 'deny_missing_unknown_or_multiple_event_kind_candidates';
const REQUIRED_TRIGGER_IDS = Object.freeze([
  'm20.lead_contact_state', 'm20.communication_preference_state',
  'm21.reviewed_knowledge_version', 'm22.appointment_state',
  'm22.assignment_dispatch_state', 'm23.work_progress_state',
  'm23.work_completion_reopening_state', 'm24.commercial_revision_state',
  'm24.issued_quote_version', 'm24.customer_quote_response_state',
  'm25.current_reviewed_outcome_summary', 'm25.current_reviewed_recommendation',
  'm26.reviewed_advisory_handoff', 'm27.invoice_lifecycle_state',
  'm27.receivable_due_aging_state', 'm27.payment_receipt_settlement_state',
  'm27.refund_dispute_correction_state', 'm27.offline_payment_state',
  'm27.reviewed_collection_handoff',
]);
const TRIGGER_DIGESTS = Object.freeze({
  'm20.lead_contact_state': '556823EAFA6B9FFE5AEA78676905F0777216ACAB7F1FF464C9085A358EAE0B09',
  'm20.communication_preference_state': 'BA4E2FFF6855EBD3478FE559FC6960D3F2455A8ECE01FC2653AF81EBDB065512',
  'm21.reviewed_knowledge_version': '707672306CD48691DFF4E34A37FDF8C10F36CD01544C38F40ADDE745512602F8',
  'm22.appointment_state': '9AB920A3048FD0AE368407EAF78AF19DBCD0FBADD60F45FEF84F58E5F883C6AE',
  'm22.assignment_dispatch_state': '18049EEB25D1C2FAE183807D236AB14DEFE7D540C13CB74069ADF916387F0B01',
  'm23.work_progress_state': 'E9F0C550D299E95043F8DCC18B2500030FAE9B30F8FD9966E4070D11821D3FB2',
  'm23.work_completion_reopening_state': '0CCECD02153A73D70E6481CD1C234DE70B44DD77C944E2A5B673068452391249',
  'm24.commercial_revision_state': '4104A56A7D85971E2B40EB2956F9B85E23C392E90CA1C3C3A3B63AC98D14EF70',
  'm24.issued_quote_version': 'C0EADCDC8B93EF43F42C0B15C13A8ED077CE6AD695B913E106C986E0061866F7',
  'm24.customer_quote_response_state': 'A8DDE97F00DF5468A28E42C067682F11473F1E17271E6C69823F274A5E2145ED',
  'm25.current_reviewed_outcome_summary': '7122428FA172D68575C8E275FE2244602DBC56F3F5E6794B456B8D7EB1776284',
  'm25.current_reviewed_recommendation': '93BA30BCC26918E40485B53E150C802C955F346FFD7814232C5552D78D0F223C',
  'm26.reviewed_advisory_handoff': 'C2CEDBFFA6E0789F71E50A328872F67B6F8EC52D0837FFEBA826443CE968572A',
  'm27.invoice_lifecycle_state': 'E34C70E03514F27531C353BEF908CB835A9559EDECAF4F9ADB79F85169C67E6A',
  'm27.receivable_due_aging_state': '9A64F7720E57D22EA6F3EE125473BA06BAB06020F7D88C5358A69E7B3670A3A9',
  'm27.payment_receipt_settlement_state': 'B5527A223231D461CE5DD83BA38B9C8E4FDA02A7114113C88B85E63849DC6BA5',
  'm27.refund_dispute_correction_state': 'BEF863BF539987F6B47BCB8D4F99F5ADDE9AAB45A0FE972C964D664967B442D1',
  'm27.offline_payment_state': 'D61C1BB845E6C3643867571465C48143864150A158CFDF5634FE10AB5C6B5EB5',
  'm27.reviewed_collection_handoff': '243406855DD1445BAD315A1C712E090FD7C940FCBD00AB580A7989392A3AE32C',
});

function normalizedLfSha256(relative) {
  const value = read(relative).replace(/\r\n/g, '\n');
  if (value.includes('\r')) throw new Error(`lone CR denied: ${relative}`);
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex').toUpperCase();
}

function exact(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      JSON.stringify(Object.keys(value)) !== JSON.stringify(keys)) throw new Error(`${label} shape`);
}

function strings(value, label, min = 1) {
  if (!Array.isArray(value) || value.length < min || value.some(item => typeof item !== 'string' || !item)) {
    throw new Error(`${label} strings`);
  }
  if (new Set(value).size !== value.length) throw new Error(`${label} duplicates`);
}

function selectEventTime(trigger, candidate) {
  exact(candidate, ['eventKind','sourceTimes'], `event candidate ${trigger.id}`);
  if (typeof candidate.eventKind !== 'string' || !candidate.eventKind) throw new Error('event kind missing');
  exact(candidate.sourceTimes, Object.keys(candidate.sourceTimes), `source times ${trigger.id}`);
  const selected = trigger.eventTime.kinds.filter(item => item.eventKind === candidate.eventKind);
  if (selected.length !== 1) throw new Error('event kind unsupported or ambiguous');
  const fields = Object.keys(candidate.sourceTimes);
  if (fields.length !== 1 || fields[0] !== selected[0].sourceField) throw new Error('event time candidate ambiguous');
  const value = candidate.sourceTimes[fields[0]];
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) {
    throw new Error('event time invalid');
  }
  return Object.freeze({ eventKind: candidate.eventKind, eventTime: value,
    sourceField: selected[0].sourceField, sourceStateSelector: selected[0].sourceStateSelector });
}

function validateCatalog(value) {
  exact(value, ['contractVersion','authority','part3DRelease','closedCatalogRules','actionFamilyOrder',
    'currentlyCatalogEligibleActionFamilies','sourceClassOrder','triggerOrder','triggers',
    'unsupportedOrDeferred','part4BPlusBoundary','unavailableEvidence'], 'catalog');
  if (value.contractVersion !== 'mission28.part4a.closed-trigger-catalog.v1') throw new Error('version');
  exact(value.authority, ['mission','part','state','baselineCommit','baselineTree',
    'runtimeTriggerIngestionOrResolverImplemented','routeUiSchedulerWorkerQueueOrProviderAuthorityGranted',
    'recipientExternalEffectUpstreamMutationOrMoneyAuthorityGranted'], 'authority');
  if (value.authority.mission !== 28 || value.authority.part !== '4A' ||
      value.authority.state !== 'implementation_candidate_only' ||
      value.authority.baselineCommit !== BASE || value.authority.baselineTree !== BASE_TREE ||
      value.authority.runtimeTriggerIngestionOrResolverImplemented !== false ||
      value.authority.routeUiSchedulerWorkerQueueOrProviderAuthorityGranted !== false ||
      value.authority.recipientExternalEffectUpstreamMutationOrMoneyAuthorityGranted !== false) throw new Error('authority values');
  if (value.closedCatalogRules.closedWorld !== true ||
      value.closedCatalogRules.sourceFactGrantsActionAuthority !== false ||
      value.closedCatalogRules.catalogMembershipGrantsActionAuthority !== false ||
      !value.closedCatalogRules.eventTimeRule.includes('closed_event_kind_selects_one_exact_source_owned') ||
      !value.closedCatalogRules.eventTimeRule.includes('unknown_missing_or_multiple_candidates_deny') ||
      !value.closedCatalogRules.eventTimeRule.includes('no_precedence_fallback') ||
      !value.closedCatalogRules.observationTimeRule.includes('distinct') ||
      !value.closedCatalogRules.currentnessRule.includes('fails_closed') ||
      !value.closedCatalogRules.unsupportedFamilyRule.includes('remain_unavailable')) throw new Error('catalog rules');
  if (JSON.stringify(value.actionFamilyOrder) !== JSON.stringify(ACTIONS) ||
      JSON.stringify(value.currentlyCatalogEligibleActionFamilies) !== JSON.stringify(ELIGIBLE) ||
      JSON.stringify(value.sourceClassOrder) !== JSON.stringify(SOURCE_CLASSES) ||
      JSON.stringify(value.triggerOrder) !== JSON.stringify(REQUIRED_TRIGGER_IDS) ||
      !Array.isArray(value.triggers) || value.triggers.length !== REQUIRED_TRIGGER_IDS.length) throw new Error('closed orders');

  const launch = parse('docs/architecture/MISSION_28_PART1D_FIRST_LAUNCH_MATRIX.json');
  if (JSON.stringify(launch.sourceClasses.map(item => item.id)) !== JSON.stringify(SOURCE_CLASSES)) throw new Error('source class drift');
  if (JSON.stringify(launch.launchCells.map(item => item.actionFamily)) !== JSON.stringify(ACTIONS)) throw new Error('action family drift');

  for (const [index, trigger] of value.triggers.entries()) {
    exact(trigger, ['id','ownerMission','sourceClassId','factKind','grain','sourceAuthority',
      'eventTime','observationTime','currentness','allowedActionFamilies','boundary'], `trigger ${index}`);
    if (trigger.id !== value.triggerOrder[index] || !Number.isInteger(trigger.ownerMission) ||
        trigger.ownerMission < 20 || trigger.ownerMission > 27 || !SOURCE_CLASSES.includes(trigger.sourceClassId) ||
        typeof trigger.factKind !== 'string' || !trigger.factKind || typeof trigger.boundary !== 'string' || !trigger.boundary) {
      throw new Error(`trigger identity ${index}`);
    }
    const triggerDigest = crypto.createHash('sha256').update(JSON.stringify(trigger), 'utf8').digest('hex').toUpperCase();
    if (triggerDigest !== TRIGGER_DIGESTS[trigger.id]) throw new Error(`trigger definition ${trigger.id}`);
    strings(trigger.grain, `grain ${trigger.id}`);
    if (trigger.grain[0] !== 'tenantId') throw new Error(`tenant grain ${trigger.id}`);
    exact(trigger.sourceAuthority, ['sourceRefs','binding'], `source authority ${trigger.id}`);
    if (!Array.isArray(trigger.sourceAuthority.sourceRefs) || !trigger.sourceAuthority.sourceRefs.length) throw new Error(`source refs ${trigger.id}`);
    strings(trigger.sourceAuthority.binding, `source binding ${trigger.id}`);
    if (!trigger.sourceAuthority.binding.includes('eventKind') || !trigger.sourceAuthority.binding.includes('eventTime')) {
      throw new Error(`event binding ${trigger.id}`);
    }
    for (const ref of trigger.sourceAuthority.sourceRefs) {
      exact(ref, ['path','anchors'], `source ref ${trigger.id}`);
      if (typeof ref.path !== 'string' || !/^(?:src|migrations|docs\/architecture)\//.test(ref.path)) throw new Error(`source path ${trigger.id}`);
      strings(ref.anchors, `anchors ${trigger.id}`);
    }
    exact(trigger.eventTime, ['eventKindField','selector','ambiguityRule','kinds','semantics'], `event time ${trigger.id}`);
    exact(trigger.observationTime, ['field','semantics'], `observation time ${trigger.id}`);
    if (trigger.eventTime.eventKindField !== 'eventKind' ||
        trigger.eventTime.selector !== EVENT_TIME_SELECTOR ||
        trigger.eventTime.ambiguityRule !== EVENT_TIME_AMBIGUITY ||
        typeof trigger.eventTime.semantics !== 'string' || !trigger.eventTime.semantics ||
        !Array.isArray(trigger.eventTime.kinds) || !trigger.eventTime.kinds.length ||
        trigger.observationTime.field !== 'observedAt' || !trigger.observationTime.semantics.includes('trusted capture time')) {
      throw new Error(`time separation ${trigger.id}`);
    }
    const sourceAnchors = trigger.sourceAuthority.sourceRefs.flatMap(ref => ref.anchors);
    const eventKinds = [];
    for (const event of trigger.eventTime.kinds) {
      exact(event, ['eventKind','sourceField','sourceStateSelector'], `event kind ${trigger.id}`);
      if (typeof event.eventKind !== 'string' || !/^[a-z][a-z0-9_]*$/.test(event.eventKind) ||
          typeof event.sourceField !== 'string' || !/^[A-Za-z][A-Za-z0-9_.]*$/.test(event.sourceField) ||
          event.sourceField.includes('_or_') || event.sourceField === trigger.observationTime.field ||
          typeof event.sourceStateSelector !== 'string' || !event.sourceStateSelector ||
          /(?:fallback|precedence)/i.test(event.sourceStateSelector)) {
        throw new Error(`event kind values ${trigger.id}`);
      }
      const sourceLeaf = event.sourceField.split('.').at(-1);
      if (!sourceAnchors.some(anchor => anchor.includes(sourceLeaf))) {
        throw new Error(`event source anchor ${trigger.id}:${event.eventKind}`);
      }
      eventKinds.push(event.eventKind);
    }
    if (new Set(eventKinds).size !== eventKinds.length) throw new Error(`event kind duplicates ${trigger.id}`);
    exact(trigger.currentness, ['requiredState','pins','deny'], `currentness ${trigger.id}`);
    if (trigger.currentness.requiredState !== 'exact_current') throw new Error(`currentness state ${trigger.id}`);
    strings(trigger.currentness.pins, `pins ${trigger.id}`, 2);
    if (!trigger.currentness.pins.includes('eventKind') || !trigger.currentness.pins.includes('eventTime')) {
      throw new Error(`event currentness ${trigger.id}`);
    }
    strings(trigger.currentness.deny, `deny ${trigger.id}`, 4);
    if (!trigger.currentness.deny.includes('missing') || !trigger.currentness.deny.includes('stale') ||
        !trigger.currentness.deny.includes('mixed') || !trigger.currentness.deny.includes('unavailable')) {
      throw new Error(`fail closed currentness ${trigger.id}`);
    }
    strings(trigger.allowedActionFamilies, `actions ${trigger.id}`);
    if (trigger.allowedActionFamilies.some(action => !ELIGIBLE.includes(action))) throw new Error(`unavailable action ${trigger.id}`);
    if (!trigger.allowedActionFamilies.includes('internal_read_digest_task') ||
        !trigger.allowedActionFamilies.includes('owner_approval_request')) throw new Error(`base action families ${trigger.id}`);
    const collection = trigger.id === 'm27.reviewed_collection_handoff';
    if (trigger.allowedActionFamilies.includes('collection_escalation') !== collection) throw new Error(`collection family ${trigger.id}`);
  }
  if (!value.unsupportedOrDeferred.includes('customer_communication') ||
      !value.unsupportedOrDeferred.includes('secure_document_delivery') ||
      !value.unsupportedOrDeferred.includes('financial_reminder') ||
      !value.unsupportedOrDeferred.includes('upstream_mutation_or_money_movement') ||
      !value.unsupportedOrDeferred.includes('runtime_trigger_ingestion_resolution_or_observation')) throw new Error('deferred boundaries');
  return true;
}

function ledgerRows(document) {
  return document.split(/\r?\n/).filter(line => /^\| \d{2} \|/.test(line)).map(line => {
    const values = line.split('|').slice(1, -1).map(value => value.trim());
    return { number: values[0], id: values[1], state: values[3], evidence: values[4] };
  });
}

describe('Mission 28 Part 4A closed trigger catalog', () => {
  test('binds exact released inputs and Part 3D release provenance', () => {
    for (const [relative, expected] of Object.entries(INPUT_HASHES)) expect(normalizedLfSha256(relative)).toBe(expected);
    const contract = parse(CONTRACT_PATH);
    expect(contract.part3DRelease).toEqual(expect.objectContaining({
      acceptedSourceHead: '797be4a33bb2128ae2efd79b5347ef43f94da0f6', acceptedTree: BASE_TREE,
      pullRequest: 560, mergedMain: BASE, deployment: '7e0ef15f-1275-4578-aade-70b8c8277bef',
      deploymentState: 'SUCCESS_RUNNING', runningInstance: 'd229cffd-2e7b-4341-b1da-2ff728d1d581',
      imageSha256: 'b631fefb559f09cdb3073a80bdd8051487a6e0478bd07606705903af41174595',
      auditVerdict: 'P0=P1=P2=P3=0', auditReportSha256: null,
    }));
  });

  test('accepts exactly the closed 19-trigger catalog and all required source classes', () => {
    const contract = parse(CONTRACT_PATH);
    expect(validateCatalog(contract)).toBe(true);
    expect(new Set(contract.triggers.map(item => item.ownerMission))).toEqual(new Set([20,21,22,23,24,25,26,27]));
    expect(new Set(contract.triggers.map(item => item.sourceClassId))).toEqual(new Set(SOURCE_CLASSES));
  });

  test('source-links every trigger to existing exact anchors', () => {
    const contract = parse(CONTRACT_PATH);
    let refs = 0;
    let anchors = 0;
    for (const trigger of contract.triggers) for (const ref of trigger.sourceAuthority.sourceRefs) {
      const source = read(ref.path);
      refs += 1;
      for (const anchor of ref.anchors) {
        anchors += 1;
        expect(source).toContain(anchor);
      }
    }
    expect(refs).toBeGreaterThanOrEqual(38);
    expect(anchors).toBeGreaterThanOrEqual(75);
  });

  test('binds 36 closed subevent kinds to exact source-owned fields with no fallback precedence', () => {
    const canonical = parse(CONTRACT_PATH);
    expect(canonical.triggers.flatMap(trigger => trigger.eventTime.kinds)).toHaveLength(36);
    expect(canonical.triggers.every(trigger =>
      trigger.eventTime.selector === EVENT_TIME_SELECTOR &&
      trigger.eventTime.ambiguityRule === EVENT_TIME_AMBIGUITY &&
      trigger.sourceAuthority.binding.includes('eventKind') &&
      trigger.sourceAuthority.binding.includes('eventTime'))).toBe(true);
    const attacks = [
      value => { value.triggers[0].eventTime.kinds.pop(); },
      value => { value.triggers[0].eventTime.kinds[0].eventKind = 'unknown_event'; },
      value => { value.triggers[0].eventTime.kinds[0].sourceField = 'timestamps.transcriptOccurredAt_or_opportunityUpdatedAt'; },
      value => { value.triggers[0].eventTime.kinds[1].eventKind = value.triggers[0].eventTime.kinds[0].eventKind; },
      value => { value.triggers[0].eventTime.selector = 'first_present_source_field_wins'; },
      value => { value.triggers[0].eventTime.ambiguityRule = 'prefer_first_candidate'; },
      value => { value.triggers[0].eventTime.kinds[0].sourceStateSelector = 'fallback_to_latest'; },
    ];
    for (const mutate of attacks) {
      const candidate = clone(canonical);
      mutate(candidate);
      expect(() => validateCatalog(candidate)).toThrow();
    }
  });

  test('selects one exact event-kind field and rejects missing unknown substituted or simultaneous candidates', () => {
    const trigger = parse(CONTRACT_PATH).triggers.find(item => item.id === 'm20.lead_contact_state');
    const at = '2026-10-27T21:30:00.000Z';
    expect(selectEventTime(trigger, {
      eventKind: 'transcript_occurred', sourceTimes: { 'timestamps.transcriptOccurredAt': at },
    })).toEqual({ eventKind: 'transcript_occurred', eventTime: at,
      sourceField: 'timestamps.transcriptOccurredAt', sourceStateSelector: 'ids.transcript=present' });
    const attacks = [
      { eventKind: '', sourceTimes: { 'timestamps.transcriptOccurredAt': at } },
      { eventKind: 'unknown_event', sourceTimes: { 'timestamps.transcriptOccurredAt': at } },
      { eventKind: 'transcript_occurred', sourceTimes: { 'timestamps.opportunityUpdatedAt': at } },
      { eventKind: 'transcript_occurred', sourceTimes: {
        'timestamps.transcriptOccurredAt': at, 'timestamps.opportunityUpdatedAt': at,
      } },
      { eventKind: 'transcript_occurred', sourceTimes: {} },
    ];
    for (const candidate of attacks) expect(() => selectEventTime(trigger, candidate)).toThrow();
  });

  test('denies semantic, authority, timing, currentness, source, order and action-family drift', () => {
    const canonical = parse(CONTRACT_PATH);
    const attacks = [
      value => { value.closedCatalogRules.closedWorld = false; },
      value => { value.closedCatalogRules.sourceFactGrantsActionAuthority = true; },
      value => { value.closedCatalogRules.catalogMembershipGrantsActionAuthority = true; },
      value => { value.triggerOrder.push('m28.unknown'); },
      value => { value.triggers.reverse(); },
      value => { value.triggers[0].id = 'm20.renamed'; },
      value => { value.triggers[0].ownerMission = 21; },
      value => { value.triggers[0].sourceClassId = 'mission21_knowledge_reference'; },
      value => { value.triggers[0].grain = ['canonicalGraphId']; },
      value => { value.triggers[0].sourceAuthority.sourceRefs = []; },
      value => { value.triggers[0].sourceAuthority.sourceRefs[0].path = 'src/unknown.js'; },
      value => { value.triggers[0].eventTime.kinds.pop(); },
      value => { value.triggers[0].eventTime.kinds[0].eventKind = 'unknown_event'; },
      value => { value.triggers[0].eventTime.kinds[0].sourceField = 'observedAt'; },
      value => { value.triggers[0].eventTime.kinds[1].eventKind = value.triggers[0].eventTime.kinds[0].eventKind; },
      value => { value.triggers[0].eventTime.selector = 'first_present_source_field_wins'; },
      value => { value.triggers[0].eventTime.ambiguityRule = 'prefer_first_candidate'; },
      value => { value.triggers[0].eventTime.kinds[0].sourceStateSelector = 'fallback_to_latest'; },
      value => { value.triggers[0].sourceAuthority.binding = value.triggers[0].sourceAuthority.binding.filter(item => item !== 'eventTime'); },
      value => { value.triggers[0].currentness.pins = value.triggers[0].currentness.pins.filter(item => item !== 'eventKind'); },
      value => { value.triggers[0].observationTime.field = 'eventTime'; },
      value => { value.triggers[0].currentness.requiredState = 'stale'; },
      value => { value.triggers[0].currentness.deny = ['missing','mixed','unavailable','corrected']; },
      value => { value.triggers[0].allowedActionFamilies.push('customer_communication'); },
      value => { value.triggers[0].allowedActionFamilies.push('collection_escalation'); },
      value => { value.triggers.at(-1).allowedActionFamilies.pop(); },
      value => { value.currentlyCatalogEligibleActionFamilies.push('financial_reminder'); },
      value => { value.authority.runtimeTriggerIngestionOrResolverImplemented = true; },
      value => { value.authority.recipientExternalEffectUpstreamMutationOrMoneyAuthorityGranted = true; },
    ];
    for (const mutate of attacks) {
      const candidate = clone(canonical);
      mutate(candidate);
      expect(() => validateCatalog(candidate)).toThrow();
    }
  });

  test('records Parts 1A-5A released, Part 5B candidate only and later slices planned', () => {
    const roadmap = read(ROADMAP_PATH);
    const ledger = read(LEDGER_PATH);
    for (const document of [roadmap, ledger]) {
      expect(document).toContain('Parts 1A–13C are released. Part 13D is the sole implementation candidate.');
      expect(document).toContain('797be4a33bb2128ae2efd79b5347ef43f94da0f6');
      expect(document).toContain('041971bb190998e1444087482941686c4166573d');
      expect(document).toContain('7e0ef15f-1275-4578-aade-70b8c8277bef');
      expect(document).toContain('b631fefb559f09cdb3073a80bdd8051487a6e0478bd07606705903af41174595');
    }
    const rows = ledgerRows(ledger);
    expect(rows).toHaveLength(66);
    expect(rows[11]).toMatchObject({ id: '3D', state: '**Released**' });
    expect(rows[12]).toMatchObject({ id: '4A', state: '**Released**' });
    expect(rows[12].evidence).toContain('PR #561');
    expect(rows[13]).toMatchObject({ id: '4B', state: '**Released**' });
    expect(rows[13].evidence).toContain('PR #562');
    expect(rows[14]).toMatchObject({ id: '4C', state: '**Released**' });
    expect(rows[14].evidence).toContain('PR #563');
    expect(rows[15]).toMatchObject({ id: '4D', state: '**Released**' });
    expect(rows[15].evidence).toContain('PR #564');
    expect(rows[16]).toMatchObject({ id: '5A', state: '**Released**' });
    expect(rows[17]).toMatchObject({ id: '5B', state: '**Released**' });
    expect(rows[18]).toMatchObject({ id: '5C', state: '**Released**' });
    expect(rows[19]).toMatchObject({ id: '5D', state: '**Released**' });
    expect(rows[20]).toMatchObject({ id: '6A', state: '**Released**' });
    expect(rows[21]).toMatchObject({ id: '6B', state: '**Released**' });
    expect(rows[22]).toMatchObject({ id: '6C', state: '**Released**' });
    expect(rows[23]).toMatchObject({ id: '6D', state: '**Released**' });
    expect(rows[24]).toMatchObject({ id: '6E', state: '**Released**' });
    expect(rows[25]).toMatchObject({ id: '6F', state: '**Released**' });
    expect(rows[26]).toMatchObject({ id: '7A', state: '**Released**' });
    expect(rows[27]).toMatchObject({ id: '7B', state: '**Released**' });
    expect(rows[28]).toMatchObject({ id: '7C', state: '**Released**' });
    expect(rows[29]).toMatchObject({ id: '7D', state: '**Released**' }); expect(rows[30]).toMatchObject({ id: '7E', state: '**Released**' }); expect(rows[31]).toMatchObject({ id: '7F', state: '**Released**' });
    expect(rows[32]).toMatchObject({ id: '8A', state: '**Released**' });
    expect(rows[33]).toMatchObject({ id: '8B', state: '**Released**' });
    expect(rows[36]).toMatchObject({ id: '9A', state: '**Released**' });
    expect(rows[37]).toMatchObject({ id: '9B', state: '**Released**' });
    expect(rows[38]).toMatchObject({ id: '9C', state: '**Released**' });
    expect(rows[39]).toMatchObject({ id: '9D', state: '**Released**' });
    expect(rows[40]).toMatchObject({ id: '10A', state: '**Released**' });
    expect(rows[41]).toMatchObject({ id: '10B', state: '**Released**' });
  expect(rows[42]).toMatchObject({ id: '10C', state: '**Released**' }); expect(rows[43]).toMatchObject({ id: '10D', state: '**Released**' }); expect(rows[44]).toMatchObject({ id: '11A', state: '**Released**' }); expect(rows[45]).toMatchObject({ id: '11B', state: '**Released**' }); expect(rows[46]).toMatchObject({ id: '11C', state: '**Released**' }); expect(rows[47]).toMatchObject({ id: '11D', state: '**Released**' }); expect(rows[48]).toMatchObject({ id: '11E', state: '**Released**' }); expect(rows[49]).toMatchObject({ id: '11F', state: '**Released**' }); expect(rows[50]).toMatchObject({ id: '12A', state: '**Released**' }); expect(rows[51]).toMatchObject({ id: '12B', state: '**Released**' }); expect(rows[52]).toMatchObject({ id: '12C', state: '**Released**' }); expect(rows[53]).toMatchObject({ id: '12D', state: '**Released**' }); expect(rows[54]).toMatchObject({ id: '13A', state: '**Released**' }); expect(rows[55]).toMatchObject({ id: '13B', state: '**Released**' }); expect(rows[56]).toMatchObject({ id: '13C', state: '**Released**' }); expect(rows[57]).toMatchObject({ id: '13D', state: '**Implementation candidate**' });
    expect(rows.slice(58).every(row => row.state === 'Planned / unimplemented' && row.evidence === 'None')).toBe(true);
    expect((ledger.match(/Planned \/ unimplemented/g) || [])).toHaveLength(8);
  });

  test('keeps runtime, migrations and later Part 4 authority outside the slice', () => {
    const contract = parse(CONTRACT_PATH);
    expect(contract.part4BPlusBoundary).toEqual({
      part4B: 'durable tenant-scoped source snapshot and correction lineage is planned and unimplemented',
      part4C: 'evaluation-time and pre-effect currentness revalidation is planned and unimplemented',
      part4D: 'duplicate replay reorder correction tombstone and concurrency handling is planned and unimplemented',
      part5Plus: 'rule evaluation scheduling execution providers recipients and effects remain planned and unimplemented',
    });
    const migrations = fs.readdirSync(path.join(ROOT, 'migrations')).filter(name => /^\d+_/.test(name));
    expect(migrations).toHaveLength(283);
    expect(migrations.some(name => name.startsWith('273_'))).toBe(true);
    expect(migrations.filter(name => name.startsWith('274_'))).toEqual(['274_canonical_automation_trigger_snapshots_v1.sql']);
    expect(migrations.filter(name => name.startsWith('278_'))).toEqual(['278_canonical_automation_retry_reconciliation_v1.sql']);
    expect(migrations.filter(name => name.startsWith('279_'))).toEqual(['279_canonical_automation_delivery_controls_v1.sql']);
    expect(migrations.filter(name => name.startsWith('280_'))).toEqual(['280_canonical_automation_recovery_authority_v1.sql']);
    expect(migrations.filter(name => name.startsWith('281_'))).toEqual(['281_canonical_automation_sender_recipient_authority_v1.sql']);
    expect(migrations.filter(name => name.startsWith('282_'))).toEqual(['282_canonical_automation_communication_permission_v1.sql']);
    expect(migrations.some(name => name.startsWith('288_'))).toBe(false);
  });
});
