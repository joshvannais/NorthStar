'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const CATALOG_PATH = 'docs/architecture/MISSION_28_PART1C_ACTION_RISK_CATALOG.json';
const CONTRACT_PATH = 'docs/architecture/MISSION_28_PART1C_ACTION_RISK_CATALOG.md';
const INVENTORY_PATH = 'docs/architecture/MISSION_28_PART1B_SURFACE_INVENTORY.json';
const ROADMAP_PATH = 'docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md';
const LEDGER_PATH = 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md';

const BASE = '1801aa90c26bab5cba6583b8a6be342763ba387a';
const BASE_TREE = 'faaead16ab89d0f75ab021db8d7cf34436f234e6';
const PART1B_HEAD = 'bc09c83d8352c4ae707e26042f9bf52750adcbc2';
const PART1B_DEPLOYMENT = '21505f81-8df6-4f7a-9f4d-61ff33e6ec90';
const PART1B_IMAGE = '97210537e4a682de1e61b7e95b9873812e167fa0e47dcfcb3fba17a401df4bfd';
const PART1A_CONTRACT_SHA = '92DAD00F8A7623A87C780FC1AC965B66569616650F53FDED8454F51872458179';
const PART1B_INVENTORY_SHA = '62E37CF07A26F0C2B1A50A2C2F0EB927695500DB32B44B16E5B431F594B93142';
const PART1C_CATALOG_SHA = '1CB5FF594AE7D1BEED313C1A94D7FE8200FB0024B36DF11B4C668F211481312B';

const ACTION_IDS = [
  'internal_read_digest_task',
  'owner_approval_request',
  'customer_communication',
  'secure_document_delivery',
  'financial_reminder',
  'collection_escalation',
  'unsupported_upstream_mutation_or_money_movement',
];

const RISK_IDS = [
  'internal_sensitive',
  'owner_attention',
  'external_communication',
  'sensitive_document_delivery',
  'financial_communication',
  'collection_communication',
  'prohibited_mutation_or_money',
];

const ACTION_OWNERS = [
  'Mission 28 tenant-private internal automation policy',
  'Mission 28 owner-control contract',
  'Mission 28 approved customer-communication policy',
  'Mission 28 approved document-delivery policy over upstream-owned documents',
  'Mission 28 approved reminder policy over Mission 27 financial facts',
  'Mission 28 human-controlled collection communication policy over Mission 27 reviewed handoff',
  'No Mission 28 owner',
];

const THREAT_IDS = [
  'abuse',
  'privacy',
  'confused_deputy',
  'spam',
  'harassment',
  'replay',
  'cross_tenant',
  'stale_source',
  'prompt_content_injection',
  'provider',
  'denial_of_service',
];

const DISPOSITIONS = [
  'mission28_owned_reusable_after_later_authority',
  'upstream_or_subscription_owned_excluded',
  'simulated_or_demo_only',
  'legacy_unsupported_or_quarantined',
  'manual_handoff',
  'ambiguous_fail_closed',
];

const HANDLING = {
  mission28_owned_reusable_after_later_authority: 'catalog_input_only',
  upstream_or_subscription_owned_excluded: 'upstream_fact_or_excluded_only',
  simulated_or_demo_only: 'demo_only',
  legacy_unsupported_or_quarantined: 'deny_reuse',
  manual_handoff: 'manual_only',
  ambiguous_fail_closed: 'deny_reuse',
};

const UNSUPPORTED_IDS = [
  'unknown_action_family',
  'catalog_as_runtime_authority',
  'source_fact_as_permission',
  'cross_tenant_or_record',
  'stale_or_mixed_source',
  'replayed_or_duplicate_authority',
  'content_or_provider_as_authority',
  'part1b_quarantine_as_authority',
  'internal_action_external_effect',
  'approval_request_executes_effect',
  'communication_without_exact_authority',
  'document_without_exact_authority',
  'financial_reminder_mutates_money',
  'collection_escalation_unreviewed_or_coercive',
  'any_upstream_mutation',
  'any_money_movement',
];

function loadJson(relative) {
  return JSON.parse(read(relative));
}

function normalizedLfSha256(relative) {
  const normalized = read(relative).replace(/\r\n/g, '\n');
  if (normalized.includes('\r')) throw new Error('lone CR is not canonical');
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex').toUpperCase();
}

function exactKeys(value, expected, label) {
  expect(value).not.toBeNull();
  expect(Array.isArray(value)).toBe(false);
  expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  expect(Reflect.ownKeys(value)).toEqual(expected);
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    expect(descriptor).toMatchObject({
      enumerable: true,
      configurable: true,
      writable: true,
    });
    expect(Object.hasOwn(descriptor, 'value')).toBe(true);
    expect(Object.hasOwn(descriptor, 'get')).toBe(false);
    expect(Object.hasOwn(descriptor, 'set')).toBe(false);
  }
}

function assertJsonData(value, seen = new Set()) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return;
  expect(typeof value).toBe('object');
  expect(seen.has(value)).toBe(false);
  seen.add(value);
  if (Array.isArray(value)) {
    expect(Object.getPrototypeOf(value)).toBe(Array.prototype);
    expect(Object.keys(value)).toHaveLength(value.length);
    for (let index = 0; index < value.length; index += 1) {
      expect(Object.hasOwn(value, index)).toBe(true);
      assertJsonData(value[index], seen);
    }
  } else {
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    for (const key of Reflect.ownKeys(value)) {
      expect(typeof key).toBe('string');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      expect(Object.hasOwn(descriptor, 'value')).toBe(true);
      expect(descriptor.enumerable).toBe(true);
      assertJsonData(descriptor.value, seen);
    }
  }
  seen.delete(value);
}

function validateCatalog(catalog) {
  assertJsonData(catalog);
  exactKeys(catalog, [
    'contractVersion', 'authority', 'decisionStates', 'riskClasses', 'threats',
    'actionFamilies', 'part1BDispositionPolicy', 'unsupportedCombinations', 'unavailableEvidence',
  ], 'catalog');
  expect(catalog.contractVersion).toBe('mission28.part1c.action-risk-catalog.v1');

  exactKeys(catalog.authority, [
    'mission', 'part', 'state', 'baselineCommit', 'baselineTree', 'part1B',
    'frozenInputs', 'runtimeAuthorityGranted', 'launchSupportGranted', 'externalEffectAuthorityGranted',
  ], 'authority');
  expect(catalog.authority).toMatchObject({
    mission: 28,
    part: '1C',
    state: 'implementation_candidate',
    baselineCommit: BASE,
    baselineTree: BASE_TREE,
    runtimeAuthorityGranted: false,
    launchSupportGranted: false,
    externalEffectAuthorityGranted: false,
  });
  expect(catalog.authority.frozenInputs).toEqual([
    {
      path: 'docs/architecture/MISSION_28_PART1A_AUTHORITY_CONTRACT.md',
      normalizedLfSha256: PART1A_CONTRACT_SHA,
    },
    {
      path: 'docs/architecture/MISSION_28_PART1B_SURFACE_INVENTORY.json',
      normalizedLfSha256: PART1B_INVENTORY_SHA,
    },
  ]);
  exactKeys(catalog.authority.part1B, [
    'sourceHead', 'pullRequest', 'mergedMain', 'deployment', 'deploymentState',
    'imageSha256', 'auditVerdict', 'auditReportSha256',
  ], 'authority.part1B');
  expect(catalog.authority.part1B).toEqual({
    sourceHead: PART1B_HEAD,
    pullRequest: 550,
    mergedMain: BASE,
    deployment: PART1B_DEPLOYMENT,
    deploymentState: 'SUCCESS_RUNNING',
    imageSha256: PART1B_IMAGE,
    auditVerdict: 'P0=P1=P2=P3=0',
    auditReportSha256: null,
  });

  expect(catalog.decisionStates).toEqual([
    'catalogued_not_authorized', 'deny_invalid', 'deny_unsupported',
  ]);
  expect(catalog.riskClasses.map(entry => entry.id)).toEqual(RISK_IDS);
  expect(catalog.riskClasses.map(entry => entry.ordinal)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  for (const entry of catalog.riskClasses) {
    exactKeys(entry, ['id', 'ordinal', 'meaning'], `risk.${entry.id}`);
    expect(entry.meaning.length).toBeGreaterThan(50);
  }

  expect(catalog.threats.map(entry => entry.id)).toEqual(THREAT_IDS);
  for (const entry of catalog.threats) {
    exactKeys(entry, ['id', 'definition', 'failClosedBoundary'], `threat.${entry.id}`);
    expect(entry.definition.length).toBeGreaterThan(50);
    expect(entry.failClosedBoundary.length).toBeGreaterThan(50);
  }

  expect(catalog.actionFamilies.map(entry => entry.id)).toEqual(ACTION_IDS);
  expect(catalog.actionFamilies.map(entry => entry.order)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  expect(catalog.actionFamilies.map(entry => entry.riskClass)).toEqual(RISK_IDS);
  expect(catalog.actionFamilies.map(entry => entry.owner)).toEqual(ACTION_OWNERS);
  for (const entry of catalog.actionFamilies) {
    exactKeys(entry, [
      'id', 'order', 'label', 'owner', 'riskClass', 'authorityState',
      'effectBoundary', 'requiredControls', 'threatIds',
    ], `action.${entry.id}`);
    expect(new Set(entry.requiredControls).size).toBe(entry.requiredControls.length);
    expect(entry.requiredControls.length).toBeGreaterThanOrEqual(5);
    expect(new Set(entry.threatIds).size).toBe(entry.threatIds.length);
    expect(entry.threatIds.every(id => THREAT_IDS.includes(id))).toBe(true);
    expect(entry.effectBoundary.length).toBeGreaterThan(100);
  }
  expect(catalog.actionFamilies.slice(0, 6).every(entry =>
    entry.authorityState === 'catalogued_not_authorized')).toBe(true);
  expect(catalog.actionFamilies[6].authorityState).toBe('deny_unsupported');
  expect(catalog.actionFamilies[6].owner).toBe('No Mission 28 owner');

  expect(catalog.part1BDispositionPolicy.map(entry => entry.disposition)).toEqual(DISPOSITIONS);
  for (const entry of catalog.part1BDispositionPolicy) {
    exactKeys(entry, ['disposition', 'part1CHandling', 'boundary'], `disposition.${entry.disposition}`);
    expect(entry.part1CHandling).toBe(HANDLING[entry.disposition]);
    expect(entry.boundary.length).toBeGreaterThan(50);
  }

  expect(catalog.unsupportedCombinations.map(entry => entry.id)).toEqual(UNSUPPORTED_IDS);
  for (const entry of catalog.unsupportedCombinations) {
    exactKeys(entry, ['id', 'appliesTo', 'condition', 'outcome'], `unsupported.${entry.id}`);
    expect(entry.appliesTo.length).toBeGreaterThan(0);
    expect(entry.appliesTo.every(id => id === '*' || ACTION_IDS.includes(id))).toBe(true);
    expect(['deny_invalid', 'deny_unsupported']).toContain(entry.outcome);
    expect(entry.condition.length).toBeGreaterThan(50);
  }
  expect(catalog.unavailableEvidence.length).toBe(6);
  expect(catalog.unavailableEvidence.every(entry => typeof entry === 'string' && entry.length > 40)).toBe(true);
}

function evaluate(catalog, input) {
  const inputKeys = [
    'actionFamily', 'part1BDisposition', 'tenantMatch', 'sourceCurrent', 'replaySafe',
    'contentIsDataOnly', 'runtimeAuthorityRequested', 'externalEffectRequested',
    'upstreamMutationRequested', 'moneyMovementRequested',
  ];
  if (input === null || typeof input !== 'object' || Array.isArray(input) ||
      Object.getPrototypeOf(input) !== Object.prototype ||
      !inputKeys.every(key => Object.hasOwn(input, key)) ||
      Reflect.ownKeys(input).length !== inputKeys.length) return 'deny_invalid';
  const family = catalog.actionFamilies.find(entry => entry.id === input.actionFamily);
  const disposition = catalog.part1BDispositionPolicy.find(entry =>
    entry.disposition === input.part1BDisposition);
  if (!family || !disposition) return 'deny_invalid';
  if (input.runtimeAuthorityRequested || input.upstreamMutationRequested || input.moneyMovementRequested) {
    return 'deny_unsupported';
  }
  if (!input.tenantMatch || !input.sourceCurrent || !input.replaySafe || !input.contentIsDataOnly) {
    return 'deny_invalid';
  }
  if (family.authorityState === 'deny_unsupported' ||
      ['deny_reuse', 'demo_only', 'manual_only'].includes(disposition.part1CHandling) ||
      input.externalEffectRequested) return 'deny_unsupported';
  return 'catalogued_not_authorized';
}

function canonicalInput(overrides = {}) {
  return {
    actionFamily: 'internal_read_digest_task',
    part1BDisposition: 'mission28_owned_reusable_after_later_authority',
    tenantMatch: true,
    sourceCurrent: true,
    replaySafe: true,
    contentIsDataOnly: true,
    runtimeAuthorityRequested: false,
    externalEffectRequested: false,
    upstreamMutationRequested: false,
    moneyMovementRequested: false,
    ...overrides,
  };
}

describe('Mission 28 Part 1C action and risk catalog', () => {
  test('freezes exact released inputs without claiming an unavailable audit hash or runtime authority', () => {
    const catalog = loadJson(CATALOG_PATH);
    validateCatalog(catalog);
    expect(normalizedLfSha256(CATALOG_PATH)).toBe(PART1C_CATALOG_SHA);
    expect(catalog.authority.part1B.auditReportSha256).toBeNull();
    expect(catalog.authority.runtimeAuthorityGranted).toBe(false);
    expect(catalog.authority.launchSupportGranted).toBe(false);
    expect(catalog.authority.externalEffectAuthorityGranted).toBe(false);
    for (const input of catalog.authority.frozenInputs) {
      expect(normalizedLfSha256(input.path)).toBe(input.normalizedLfSha256);
    }
  });

  test('freezes the exact seven action families, risk order, ownership and eleven-threat vocabulary', () => {
    const catalog = loadJson(CATALOG_PATH);
    const roadmap = read(ROADMAP_PATH);
    expect(roadmap).toContain('| C | Freeze the action and risk catalog: internal read/digest/task, owner approval request, customer communication, secure document delivery, financial reminder, collection escalation, and explicitly unsupported upstream mutation or money movement. Define abuse, privacy, confused-deputy, spam, harassment, replay, cross-tenant, stale-source, prompt/content injection, provider, and denial-of-service threats. |');
    expect(catalog.actionFamilies.map(entry => [entry.order, entry.id, entry.riskClass, entry.owner]))
      .toEqual(ACTION_IDS.map((id, index) => [index + 1, id, RISK_IDS[index], ACTION_OWNERS[index]]));
    expect(catalog.threats.map(entry => entry.id)).toEqual(THREAT_IDS);
    expect(new Set(catalog.actionFamilies.flatMap(entry => entry.threatIds))).toEqual(new Set(THREAT_IDS));
    expect(catalog.actionFamilies.slice(1).every(entry =>
      THREAT_IDS.every(id => entry.threatIds.includes(id)))).toBe(true);
  });

  test('maps every accepted Part 1B disposition and all 49 surfaces without converting inventory into authority', () => {
    const catalog = loadJson(CATALOG_PATH);
    const inventory = loadJson(INVENTORY_PATH);
    expect(inventory.surfaces).toHaveLength(49);
    expect(inventory.surfaces.flatMap(surface => surface.sourceRefs)).toHaveLength(181);
    const policy = Object.fromEntries(catalog.part1BDispositionPolicy
      .map(entry => [entry.disposition, entry.part1CHandling]));
    expect(policy).toEqual(HANDLING);
    for (const surface of inventory.surfaces) {
      expect(DISPOSITIONS).toContain(surface.disposition);
      const result = evaluate(catalog, canonicalInput({ part1BDisposition: surface.disposition }));
      expect(['catalogued_not_authorized', 'deny_unsupported']).toContain(result);
      expect(result).not.toBe('allow');
    }
  });

  test('fails every unsupported authority, identity, currentness, replay, content and effect combination closed', () => {
    const catalog = loadJson(CATALOG_PATH);
    expect(evaluate(catalog, canonicalInput())).toBe('catalogued_not_authorized');
    const cases = [
      [{ actionFamily: 'invented_action' }, 'deny_invalid'],
      [{ part1BDisposition: 'invented_disposition' }, 'deny_invalid'],
      [{ tenantMatch: false }, 'deny_invalid'],
      [{ sourceCurrent: false }, 'deny_invalid'],
      [{ replaySafe: false }, 'deny_invalid'],
      [{ contentIsDataOnly: false }, 'deny_invalid'],
      [{ runtimeAuthorityRequested: true }, 'deny_unsupported'],
      [{ externalEffectRequested: true }, 'deny_unsupported'],
      [{ upstreamMutationRequested: true }, 'deny_unsupported'],
      [{ moneyMovementRequested: true }, 'deny_unsupported'],
      [{ actionFamily: 'unsupported_upstream_mutation_or_money_movement' }, 'deny_unsupported'],
      [{ part1BDisposition: 'legacy_unsupported_or_quarantined' }, 'deny_unsupported'],
      [{ part1BDisposition: 'ambiguous_fail_closed' }, 'deny_unsupported'],
      [{ part1BDisposition: 'simulated_or_demo_only' }, 'deny_unsupported'],
      [{ part1BDisposition: 'manual_handoff' }, 'deny_unsupported'],
    ];
    for (const [mutation, expected] of cases) {
      expect(evaluate(catalog, canonicalInput(mutation))).toBe(expected);
    }
    expect(evaluate(catalog, { ...canonicalInput(), extra: true })).toBe('deny_invalid');
    expect(evaluate(catalog, null)).toBe('deny_invalid');
  });

  test('keeps external and financial families non-authorized even with otherwise canonical inputs', () => {
    const catalog = loadJson(CATALOG_PATH);
    for (const actionFamily of ACTION_IDS) {
      const result = evaluate(catalog, canonicalInput({ actionFamily }));
      const expected = actionFamily === 'unsupported_upstream_mutation_or_money_movement'
        ? 'deny_unsupported' : 'catalogued_not_authorized';
      expect(result).toBe(expected);
    }
    for (const actionFamily of ACTION_IDS.slice(1, 6)) {
      expect(evaluate(catalog, canonicalInput({ actionFamily, externalEffectRequested: true })))
        .toBe('deny_unsupported');
    }
  });

  test('rejects structural, semantic, status and optimistic authority drift', () => {
    const original = loadJson(CATALOG_PATH);
    const mutations = [];
    const mutate = callback => {
      const value = structuredClone(original);
      callback(value);
      mutations.push(value);
    };
    mutate(value => value.actionFamilies.shift());
    mutate(value => value.actionFamilies.reverse());
    mutate(value => { value.actionFamilies[0].id = 'renamed'; });
    mutate(value => { value.actionFamilies[0].authorityState = 'allow'; });
    mutate(value => { value.actionFamilies[6].authorityState = 'catalogued_not_authorized'; });
    mutate(value => value.riskClasses.pop());
    mutate(value => { value.threats[0].id = 'harmless'; });
    mutate(value => value.part1BDispositionPolicy.pop());
    mutate(value => { value.part1BDispositionPolicy[3].part1CHandling = 'catalog_input_only'; });
    mutate(value => { value.unsupportedCombinations[0].outcome = 'allow'; });
    mutate(value => { value.unsupportedCombinations.pop(); });
    mutate(value => { value.authority.runtimeAuthorityGranted = true; });
    mutate(value => { value.authority.launchSupportGranted = true; });
    mutate(value => { value.authority.externalEffectAuthorityGranted = true; });
    mutate(value => { value.authority.part1B.auditReportSha256 = 'A'.repeat(64); });
    mutate(value => { value.extra = true; });
    for (const mutation of mutations) expect(() => validateCatalog(mutation)).toThrow();
  });

  test('binds the narrative contract to every action, threat and unavailable boundary', () => {
    const contract = read(CONTRACT_PATH);
    for (const id of [...ACTION_IDS, ...RISK_IDS, ...THREAT_IDS, ...UNSUPPORTED_IDS]) {
      expect(contract).toContain(`\`${id}\``);
    }
    expect(contract).toContain('There is deliberately no `allow`, `execute`, `send`, `deliver`, `charge`, `refund`, `collect`, or `mutate` outcome.');
    expect(contract).toContain('Part 1D and all later slices remain planned and unimplemented.');
    expect(contract).toContain('professional legal or security opinions');
    expect(contract).toContain('founder visual approval remain unavailable and unclaimed');
  });

  test('records released Parts 1A–4D, exactly Part 5A current and all later slices planned', () => {
    const roadmap = read(ROADMAP_PATH);
    const ledger = read(LEDGER_PATH);
    expect(roadmap).toContain('Parts 1A–7D are released. Part 7E is the sole implementation candidate.');
    expect(roadmap).toContain('Parts 7F–14G remain planned and unimplemented.');
    for (const identity of [PART1B_HEAD, BASE, PART1B_DEPLOYMENT, PART1B_IMAGE]) {
      expect(roadmap).toContain(identity);
      expect(ledger).toContain(identity);
    }
    const rows = [...ledger.matchAll(/^\| (\d{2}) \| (\d{1,2}[A-G]) \| (.+) \| (.+) \| (.+) \|$/gm)];
    expect(rows).toHaveLength(66);
    expect(rows[0][4]).toBe('**Released**');
    expect(rows[1][4]).toBe('**Released**');
    expect(rows[2][4]).toBe('**Released**');
    expect(rows[2][5]).toContain('PR #551');
    expect(rows[3][4]).toBe('**Released**');
    expect(rows[3][5]).toContain('PR #552');
    expect(rows[4][4]).toBe('**Released**');
    expect(rows[4][5]).toContain('PR #553');
    expect(rows[5][4]).toBe('**Released**');
    expect(rows[5][5]).toContain('PR #554');
    expect(rows[6][4]).toBe('**Released**');
    expect(rows[6][5]).toContain('PR #555');
    expect(rows[7][4]).toBe('**Released**');
    expect(rows[7][5]).toContain('production migration 273');
    expect(rows[8][4]).toBe('**Released**');
    expect(rows[8][5]).toContain('PR #557');
    expect(rows[9][4]).toBe('**Released**');
    expect(rows[9][5]).toContain('PR #558');
    expect(rows[10][4]).toBe('**Released**');
    expect(rows[10][5]).toContain('PR #559');
    expect(rows[11][4]).toBe('**Released**');
    expect(rows[11][5]).toContain('PR #560');
    expect(rows[12][4]).toBe('**Released**');
    expect(rows[12][5]).toContain('PR #561');
    expect(rows[13][4]).toBe('**Released**');
    expect(rows[13][5]).toContain('PR #562');
    expect(rows[14][4]).toBe('**Released**');
    expect(rows[14][5]).toContain('PR #563');
    expect(rows[15][4]).toBe('**Released**');
    expect(rows[15][5]).toContain('PR #564');
    expect(rows[16][4]).toBe('**Released**');
    expect(rows[18][4]).toBe('**Released**');
    expect(rows[19][4]).toBe('**Released**');
    expect(rows[20][4]).toBe('**Released**');
    expect(rows[21][4]).toBe('**Released**');
    expect(rows[22][4]).toBe('**Released**');
    expect(rows[23][4]).toBe('**Released**');
    expect(rows[24][4]).toBe('**Released**');
    expect(rows[25][4]).toBe('**Released**');
    expect(rows[26][4]).toBe('**Released**');
    expect(rows[27][4]).toBe('**Released**');
    expect(rows[28][4]).toBe('**Released**');
    expect(rows[29][4]).toBe('**Released**'); expect(rows[30][4]).toBe('**Implementation candidate**');
    expect(rows.slice(31).every(row => row[4] === 'Planned / unimplemented' && row[5] === 'None')).toBe(true);
    expect((ledger.match(/\*\*Implementation candidate\*\*/g) || [])).toHaveLength(1);
    expect((ledger.match(/Planned \/ unimplemented/g) || [])).toHaveLength(35);
    expect(ledger).toContain('independent audit/PR/merge/deployment unavailable');
  });

  test('does not activate the static catalog from production source or add a migration', () => {
    const productionFiles = [];
    const walk = directory => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(absolute);
        else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) productionFiles.push(absolute);
      }
    };
    walk(path.join(ROOT, 'src'));
    const productionSource = productionFiles.map(file => fs.readFileSync(file, 'utf8')).join('\n');
    expect(productionSource).not.toContain('MISSION_28_PART1C_ACTION_RISK_CATALOG');
    expect(productionSource).not.toContain('mission28.part1c.action-risk-catalog.v1');
    const migrations = fs.readdirSync(path.join(ROOT, 'migrations')).filter(name => name.endsWith('.sql'))
      .sort((left, right) => Number(left.split('_')[0]) - Number(right.split('_')[0]));
    expect(migrations).toHaveLength(281);
    expect(migrations.at(-1)).toBe('285_canonical_automation_scoped_link_attachment_v1.sql');
    expect(migrations.some(name => name.startsWith('286_'))).toBe(false);
    expect(migrations.filter(name => /^273_/.test(name))).toEqual(['273_canonical_automation_authority_v1.sql']);
    expect(migrations.filter(name => /^278_/.test(name))).toEqual(['278_canonical_automation_retry_reconciliation_v1.sql']);
    expect(migrations.filter(name => /^279_/.test(name))).toEqual(['279_canonical_automation_delivery_controls_v1.sql']);
    expect(migrations.filter(name => /^274_/.test(name))).toEqual(['274_canonical_automation_trigger_snapshots_v1.sql']);
  });
});
