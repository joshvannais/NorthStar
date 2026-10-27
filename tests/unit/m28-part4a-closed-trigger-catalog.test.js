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
  'm20.lead_contact_state': 'A73DF5E8A5CF87514F618EC6B670624E9E087605F3A57B4ACA70D43C39E08A50',
  'm20.communication_preference_state': 'D8F051A95C3BF501D6A3E291CDDFD9D0E085AA7979665C9BAA60AB7C31FDECF7',
  'm21.reviewed_knowledge_version': 'CA9AAF051D0ED8246E1A72BED171EEA9A1E9311CC6D6ACD4D415476C38147B7D',
  'm22.appointment_state': '9B97B7B2EF4A8FD6E62416E08950CAE1B6CDFB108A6E3D6D00EABF3A967DA806',
  'm22.assignment_dispatch_state': '770257B9600C904604F04E4E3B0A47B730BFB63F87C7FCD7F664E10D9A147A93',
  'm23.work_progress_state': 'FD3D40FE4312C1E8AA506D1BE59D2C5ADEEDB5AC7880C58753FEDD9CC57054CE',
  'm23.work_completion_reopening_state': '1F762B0A1FF947DD1B023AD5ACA35B15F7A7855F06F54548B56D20D8083D0084',
  'm24.commercial_revision_state': '41D069B7C3BCD55D98E3B535A749CFED65F42B8753E0A26BB103BE5EC961A8A4',
  'm24.issued_quote_version': '6EC2E60F2E49198BF2DF94F2A9B1615A88037A32E2A076AEA54AA6E0538E25F4',
  'm24.customer_quote_response_state': '826AC98243212F9AE602F26F9B6A9E7DE54D74000EBD15453BAE2433FE21FE76',
  'm25.current_reviewed_outcome_summary': '93ECCE6CD697CB28E7DA8B9B5B13EE3E341C19A0FA7E7E2D410A4F61E385B191',
  'm25.current_reviewed_recommendation': 'E962CB87DC0CEA53DF9EE606FE66D7BE53D9F288CB08189E876EB335DC8547E4',
  'm26.reviewed_advisory_handoff': 'A229BD4A8915CE60CDC68088A15C538E9755E5C897B879A648500F3C89CD4307',
  'm27.invoice_lifecycle_state': '712453DAA7066226C64B78DFCEAEE80DD265F0F86C6F6C1CE5A6A5F13B234595',
  'm27.receivable_due_aging_state': 'CA9829F93E09D9F614D23D1D0EA49CBB43BF95FE54BA479F781CD639B18B6902',
  'm27.payment_receipt_settlement_state': '37B2420F19C6EADEA1CA570BC5A3AF8D6B563CE98730E134406E138973DFE5DD',
  'm27.refund_dispute_correction_state': 'BA05275DD0271D201A148C28F18D2FB64AD6CA68E7766C95213449F36342BBCF',
  'm27.offline_payment_state': '3570E10C6AB7B963796A3F4AF99F97EF6F2F8645FB22F366496379E3928D59E5',
  'm27.reviewed_collection_handoff': 'CB636144346919F4637C413C8E116E9B028005F848FAFFBE06C43C022C50B17D',
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
      !value.closedCatalogRules.eventTimeRule.includes('source_owned') ||
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
    for (const ref of trigger.sourceAuthority.sourceRefs) {
      exact(ref, ['path','anchors'], `source ref ${trigger.id}`);
      if (typeof ref.path !== 'string' || !/^(?:src|migrations|docs\/architecture)\//.test(ref.path)) throw new Error(`source path ${trigger.id}`);
      strings(ref.anchors, `anchors ${trigger.id}`);
    }
    exact(trigger.eventTime, ['field','semantics'], `event time ${trigger.id}`);
    exact(trigger.observationTime, ['field','semantics'], `observation time ${trigger.id}`);
    if (!trigger.eventTime.field || trigger.eventTime.field === trigger.observationTime.field ||
        trigger.observationTime.field !== 'observedAt' || !trigger.observationTime.semantics.includes('trusted capture time')) {
      throw new Error(`time separation ${trigger.id}`);
    }
    exact(trigger.currentness, ['requiredState','pins','deny'], `currentness ${trigger.id}`);
    if (trigger.currentness.requiredState !== 'exact_current') throw new Error(`currentness state ${trigger.id}`);
    strings(trigger.currentness.pins, `pins ${trigger.id}`, 2);
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
      value => { value.triggers[0].eventTime.field = 'observedAt'; },
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

  test('records Part 3D released, Part 4A candidate only and later slices planned', () => {
    const roadmap = read(ROADMAP_PATH);
    const ledger = read(LEDGER_PATH);
    for (const document of [roadmap, ledger]) {
      expect(document).toContain('Parts 1A–3D released; Part 4A implementation candidate only.');
      expect(document).toContain('797be4a33bb2128ae2efd79b5347ef43f94da0f6');
      expect(document).toContain('041971bb190998e1444087482941686c4166573d');
      expect(document).toContain('7e0ef15f-1275-4578-aade-70b8c8277bef');
      expect(document).toContain('b631fefb559f09cdb3073a80bdd8051487a6e0478bd07606705903af41174595');
    }
    const rows = ledgerRows(ledger);
    expect(rows).toHaveLength(66);
    expect(rows[11]).toMatchObject({ id: '3D', state: '**Released**' });
    expect(rows[12]).toMatchObject({ id: '4A', state: '**Implementation candidate**' });
    expect(rows[12].evidence).toContain('no runtime ingestion/resolver');
    expect(rows.slice(13).every(row => row.state === 'Planned / unimplemented' && row.evidence === 'None')).toBe(true);
    expect((ledger.match(/Planned \/ unimplemented/g) || [])).toHaveLength(53);
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
    expect(migrations).toHaveLength(269);
    expect(migrations.some(name => name.startsWith('273_'))).toBe(true);
    expect(migrations.some(name => name.startsWith('274_'))).toBe(false);
  });
});
