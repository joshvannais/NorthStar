'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const ROADMAP_PATH = 'docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md';
const LEDGER_PATH = 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md';
const CONTRACT_PATH = 'docs/architecture/MISSION_28_PART1A_AUTHORITY_CONTRACT.md';
const SOURCE_SHA = 'DDBA5CA7523A1684330E136313F4416584D142A63167310EEABEC1EBFBB010B4';
const BODY_SHA = '109589DA2242EE6AA7FDD4C2DED3E3440B909B26452DEFCD39BC2502C1ADAAF5';
const BASE = '7736fe6d31ce2300cf06cfcaa461f9b9ea5184c3';
const BASE_TREE = '861215b3b6ffdcdf53f2f658e2d46098526f8b65';
const PART1A_HEAD = 'c42d1a9f72dcb6bbdd480e804988ddc3ec43cc09';
const PART1A_MAIN = '21ca719e24382443bbf3f52e460f3c16b016c4ad';
const PART1A_DEPLOYMENT = 'd3010671-da95-4247-807f-f2089b90df74';
const PART1A_AUDIT = '1C3AA77E9B1E31A4FE4A8167FC2072A5818EDC52D19B5BCB1356352FEADDBDE1';
const PART1B_HEAD = 'bc09c83d8352c4ae707e26042f9bf52750adcbc2';
const PART1B_MAIN = '1801aa90c26bab5cba6583b8a6be342763ba387a';
const PART1B_DEPLOYMENT = '21505f81-8df6-4f7a-9f4d-61ff33e6ec90';
const PART1C_HEAD = '467668a9de408adb381ac91beb61cc73b01532ec';
const PART1C_MAIN = 'eba50a7903ac0000a9eb663d52744cc760f3afd3';
const PART1C_DEPLOYMENT = 'fbca00f3-5806-46c3-981f-7120306a09ed';
const PART1D_HEAD = 'f869b0b1e0da15149e33948e1a732208d585ebd0';
const PART1D_MAIN = 'aa875c9a2ad6e03f8d41575e6b19e31aa36ed02d';
const PART1D_DEPLOYMENT = 'dc96dc7d-5fe7-4eaa-a093-e37792373f6e';
const PART2A_HEAD = '6f1c299193456afd756542da43c72c6517101661';
const PART2A_MAIN = 'cc55048e91c2b5c6dd70671d01ebe913123201ad';
const PART2A_DEPLOYMENT = '9e976ab1-733d-4d85-b1f6-6c33073dc3aa';
const PART2B_HEAD = 'be14e2467b278f00dfd55082b0f42a4497ef5c22';
const PART2B_MAIN = 'dd31bb4d36057c4c3f1774c589a0f425210bb439';
const PART2B_DEPLOYMENT = '1a04c6ac-412a-4f5f-b86b-7f506b2a3cc8';
const PART2C_HEAD = '69d4a375a4971ab98310872b9382cba92f5a67c0';
const PART2C_MAIN = '1d52b675d8d2bbe9065c220ff3719460bd530f38';
const PART2C_DEPLOYMENT = '036663b4-a364-4c3a-9842-5e1686164be0';
const PART2D_HEAD = '98c4b3562ad48787472584ca64c601d584c2427f';
const PART2D_MAIN = '529286cf2d513df93680e2c236e37f562782cb52';
const PART2D_DEPLOYMENT = 'f40e401a-649f-42b3-a1cc-71dbd0ffce4d';

const PARTS = [
  [1, 'mission authority, inventory, risk model, and acceptance contract', 4],
  [2, 'canonical automation policy, run, and evidence model', 4],
  [3, 'owner control, capabilities, limits, and approvals', 4],
  [4, 'trigger ingestion, exact source binding, and correction propagation', 4],
  [5, 'rule evaluation, collision control, preview, and dry run', 4],
  [6, 'durable scheduling, execution, idempotency, and recovery', 6],
  [7, 'sender, recipient, content, channel, and reply safety', 6],
  [8, 'approved document sending and revision-aware delivery', 4],
  [9, 'lead, estimate, and customer follow-up automation', 4],
  [10, 'appointment, dispatch, work, and completion communications', 4],
  [11, 'invoice reminders and human-controlled collections automation', 6],
  [12, 'internal action center and advisory handoffs', 4],
  [13, 'channel adapters, callbacks, observability, privacy, and lifecycle', 5],
  [14, 'Automation Center, isolated demo, complete validation, and release', 7],
];

const EXPECTED_SLICES = PARTS.flatMap(([part, , count]) =>
  Array.from({ length: count }, (_, index) => `${part}${String.fromCharCode(65 + index)}`));

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex').toUpperCase();
}

function canonicalBody(document) {
  const normalized = document.replace(/\r\n/g, '\n');
  if (normalized.includes('\r')) throw new Error('lone CR is not canonical');
  const marker = '\n## Mission objective\n';
  const index = normalized.indexOf(marker);
  if (index < 0 || normalized.indexOf(marker, index + marker.length) >= 0) {
    throw new Error('canonical mission body marker must occur exactly once');
  }
  return `${normalized.slice(index + 1).trim()}\n`;
}

function parseParts(document) {
  const headings = [...document.matchAll(/^## Part (\d+) — (.+)$/gm)]
    .map(match => ({ number: Number(match[1]), title: match[2], index: match.index }));
  return headings.map((heading, index) => {
    const end = headings[index + 1]?.index ?? document.indexOf('\n## Complete acceptance standard');
    const section = document.slice(heading.index, end);
    const slices = [...section.matchAll(/^\| ([A-G]) \| (.+) \|$/gm)]
      .map(match => ({ id: `${heading.number}${match[1]}`, scope: match[2] }));
    return { ...heading, slices };
  });
}

function parseLedger(document) {
  return [...document.matchAll(/^\| (\d{2}) \| (\d{1,2}[A-G]) \| (.+) \| (.+) \| (.+) \|$/gm)]
    .map(match => ({ order: Number(match[1]), id: match[2], scope: match[3], state: match[4], evidence: match[5] }));
}

function validatePartOrder(document) {
  const actual = parseParts(document);
  expect(actual.map(part => [part.number, part.title, part.slices.length])).toEqual(PARTS);
  expect(actual.flatMap(part => part.slices.map(slice => slice.id))).toEqual(EXPECTED_SLICES);
  expect(actual.flatMap(part => part.slices)).toHaveLength(66);
}

function validateLedger(document) {
  const rows = parseLedger(document);
  expect(rows).toHaveLength(66);
  expect(rows.map(row => row.order)).toEqual(Array.from({ length: 66 }, (_, index) => index + 1));
  expect(rows.map(row => row.id)).toEqual(EXPECTED_SLICES);
  expect(rows[0]).toMatchObject({
    id: '1A',
    state: '**Released**',
  });
  expect(rows[0].evidence).toContain(`Accepted source \`${PART1A_HEAD}\``);
  expect(rows[0].evidence).toContain(`report \`${PART1A_AUDIT}\``);
  expect(rows[0].evidence).toContain(`main \`${PART1A_MAIN}\``);
  expect(rows[0].evidence).toContain(`deployment \`${PART1A_DEPLOYMENT}\``);
  expect(rows[1]).toMatchObject({ id: '1B', state: '**Released**' });
  expect(rows[1].evidence).toContain(`Accepted source \`${PART1B_HEAD}\``);
  expect(rows[1].evidence).toContain(`main \`${PART1B_MAIN}\``);
  expect(rows[1].evidence).toContain(`deployment \`${PART1B_DEPLOYMENT}\``);
  expect(rows[2]).toMatchObject({ id: '1C', state: '**Released**' });
  expect(rows[2].evidence).toContain(`Accepted source \`${PART1C_HEAD}\``);
  expect(rows[2].evidence).toContain(`main \`${PART1C_MAIN}\``);
  expect(rows[2].evidence).toContain(`deployment \`${PART1C_DEPLOYMENT}\``);
  expect(rows[3]).toMatchObject({ id: '1D', state: '**Released**' });
  expect(rows[3].evidence).toContain(`Accepted source \`${PART1D_HEAD}\``);
  expect(rows[3].evidence).toContain(`main \`${PART1D_MAIN}\``);
  expect(rows[3].evidence).toContain(`deployment \`${PART1D_DEPLOYMENT}\``);
  expect(rows[4]).toMatchObject({ id: '2A', state: '**Released**' });
  expect(rows[4].evidence).toContain(`Accepted source \`${PART2A_HEAD}\``);
  expect(rows[4].evidence).toContain(`main \`${PART2A_MAIN}\``);
  expect(rows[4].evidence).toContain(`deployment \`${PART2A_DEPLOYMENT}\``);
  expect(rows[5]).toMatchObject({ id: '2B', state: '**Released**' });
  expect(rows[5].evidence).toContain(`Accepted source \`${PART2B_HEAD}\``);
  expect(rows[5].evidence).toContain(`main \`${PART2B_MAIN}\``);
  expect(rows[5].evidence).toContain(`deployment \`${PART2B_DEPLOYMENT}\``);
  expect(rows[6]).toMatchObject({ id: '2C', state: '**Released**' });
  expect(rows[6].evidence).toContain(`Accepted source \`${PART2C_HEAD}\``);
  expect(rows[6].evidence).toContain(`main \`${PART2C_MAIN}\``);
  expect(rows[6].evidence).toContain(`deployment \`${PART2C_DEPLOYMENT}\``);
  expect(rows[7]).toMatchObject({ id: '2D', state: '**Released**' });
  expect(rows[7].evidence).toContain(`Accepted source \`${PART2D_HEAD}\``);
  expect(rows[7].evidence).toContain(`main \`${PART2D_MAIN}\``);
  expect(rows[7].evidence).toContain(`deployment \`${PART2D_DEPLOYMENT}\``);
  expect(rows[8]).toMatchObject({ id: '3A', state: '**Released**' });
  expect(rows[8].evidence).toContain('PR #557');
  expect(rows[9]).toMatchObject({ id: '3B', state: '**Released**' });
  expect(rows[9].evidence).toContain('PR #558');
  expect(rows[10]).toMatchObject({ id: '3C', state: '**Released**' });
  expect(rows[10].evidence).toContain('PR #559');
  expect(rows[11]).toMatchObject({ id: '3D', state: '**Released**' });
  expect(rows[11].evidence).toContain('PR #560');
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
  expect(rows[29]).toMatchObject({ id: '7D', state: '**Implementation candidate**' });
  expect(rows.slice(30).every(row => row.state === 'Planned / unimplemented' && row.evidence === 'None')).toBe(true);
}

describe('Mission 28 Part 1A authority ratification', () => {
  test('binds the exact frozen source, canonical body and deployed Mission 27 baseline', () => {
    const roadmap = read(ROADMAP_PATH);
    const ledger = read(LEDGER_PATH);
    const contract = read(CONTRACT_PATH);

    expect(sha256(canonicalBody(roadmap))).toBe(BODY_SHA);
    for (const document of [roadmap, ledger, contract]) {
      expect(document).toContain(SOURCE_SHA);
      expect(document).toContain(BODY_SHA);
      expect(document).toContain(BASE);
      expect(document).toContain(BASE_TREE);
    }
    expect(roadmap).toContain('Parts 1A–7C are released. Part 7D is the sole implementation candidate.');
    expect(roadmap).toContain('Parts 7E–14G remain planned and unimplemented.');
    for (const identity of [PART1A_HEAD, PART1A_MAIN, PART1A_DEPLOYMENT, PART1A_AUDIT]) {
      expect(roadmap).toContain(identity);
      expect(ledger).toContain(identity);
    }
  });

  test('freezes fourteen parts and all sixty-six slices in exact order', () => {
    const roadmap = read(ROADMAP_PATH);
    validatePartOrder(roadmap);
    expect(roadmap).toContain('The complete proposed structure is **14 serialized parts and 66 slices**.');
    expect(roadmap).toContain('Any later change requires a written authority or acceptance reason, affected gates, and a revised total before implementation continues.');
  });

  test('preserves all twelve non-negotiable invariants and complete acceptance boundaries', () => {
    const roadmap = read(ROADMAP_PATH);
    const invariantTitles = [
      'Owner control is durable authority.',
      'No source fact grants action authority.',
      'Currentness is checked twice.',
      'Intent, execution, and evidence stay separate.',
      'Uncertainty fails closed.',
      'Retries do not duplicate effects.',
      'Human activity wins.',
      'AI may prepare; it may not self-authorize.',
      'Demo cannot escape.',
      'Provider-neutral design is mandatory.',
      'Privacy is minimized throughout.',
      'Mission completion requires product proof.',
    ];
    const found = [...roadmap.matchAll(/^\d+\. \*\*(.+?)\*\*/gm)].map(match => match[1]);
    expect(found).toEqual(invariantTitles);
    expect(roadmap).toContain('Mission 28 is complete only when all 66 slices are accepted in order');
    expect(roadmap).toContain('queued or provider-accepted work is never called delivered, answered, paid, collected, successful, or reconciled');
    expect(roadmap).toContain('No implementation claims unsupported legal compliance, provider availability, physical-device coverage, disaster restoration, production performance/SLA, private-production evidence, or live-money validation.');
  });

  test('keeps every upstream and later-mission ownership boundary explicit', () => {
    const roadmap = read(ROADMAP_PATH);
    for (const authority of [
      'Mission 20', 'Mission 21', 'Mission 22', 'Mission 23', 'Mission 24',
      'Mission 25', 'Mission 26', 'Mission 27', 'Mission 29', 'Missions 30–33',
    ]) expect(roadmap).toContain(`| ${authority} |`);
    expect(roadmap).toContain('It may not mutate an upstream business fact merely because it communicated about that fact.');
    expect(roadmap).toContain("Pulling forward Mission 29's enterprise administration");
    expect(roadmap).toContain('OS-wide integration, public guided simulation, calculator ownership, or platform administration');
  });

  test('defines upstream fact, automation decision, external effect and effect evidence as disjoint authority classes', () => {
    const contract = read(CONTRACT_PATH);
    for (const authorityClass of ['`upstream_fact`', '`automation_decision`', '`external_effect`', '`effect_evidence`']) {
      expect(contract).toContain(`| ${authorityClass} |`);
    }
    for (const prohibition of [
      'event, elapsed clock, prediction, recommendation, callback or provider label = permission',
      'eligible, previewed, approved, scheduled or queued = attempted',
      'attempted or provider-accepted = sent or delivered',
      'composer opened or native handoff created = sent',
      'sent or delivered = viewed, acknowledged, replied, paid, collected, successful, reconciled or causally effective',
      'communication evidence = schedule, work, estimate, invoice, balance, payment, settlement, accounting or legal truth',
    ]) expect(contract).toContain(prohibition);
    expect(contract).toContain('The boundary is monotonic but not automatically progressive.');
    expect(contract).toContain('it never retroactively authorizes the attempt and never rewrites its upstream source');
  });

  test('ratifies dependencies, currentness, owner control and fail-closed terminology without granting runtime behavior', () => {
    const contract = read(CONTRACT_PATH);
    for (const term of [
      'Policy', 'Per-run approval', 'Standing authorization', 'Eligibility', 'Preview',
      'Scheduled run', 'Action unit', 'Provider attempt', 'Native handoff',
      'Delivery evidence', 'Suppression', 'Currentness', 'Unavailable', 'Demo',
    ]) expect(contract).toContain(`| ${term} |`);

    expect(contract).toContain('A role name alone does not.');
    expect(contract).toContain('Immediately before any effect, every relevant authority is reread and revalidated coherently.');
    expect(contract).toContain('Unknown outcome blocks another attempt until reconciled.');
    expect(contract).toContain('Part 1A itself implements none of those runtime steps.');
    expect(contract).toContain('It grants no route, worker, queue, scheduler, provider adapter, callback, credential, recipient, message, document delivery, internal task, payment, refund, fee, write-off, accounting action, database authority, migration, UI control, production flag or demo effect.');
  });

  test('records released Parts 1A–4D, keeps exactly Part 5A current, and leaves every later slice planned', () => {
    const ledger = read(LEDGER_PATH);
    validateLedger(ledger);
    expect((ledger.match(/\*\*Implementation candidate\*\*/g) || [])).toHaveLength(1);
    expect((ledger.match(/Planned \/ unimplemented/g) || [])).toHaveLength(36);
    expect(ledger).toContain('independent audit/PR/merge/deployment unavailable');
    expect(ledger).toContain(`Part 1A audit | Accepted P0=P1=P2=P3=0; report SHA-256 \`${PART1A_AUDIT}\``);
  });

  test('fails executable order/count/status drift mutations rather than accepting positive substrings', () => {
    const roadmap = read(ROADMAP_PATH);
    const ledger = read(LEDGER_PATH);
    const mutations = [
      roadmap.replace('## Part 2 —', '## Part 15 —'),
      roadmap.replace('| D | Freeze the first-supported launch matrix', '| E | Freeze the first-supported launch matrix'),
      roadmap.replace(/^\| A \| Canonical tenant-private policy definition.*\r?\n/m, ''),
      roadmap.replace('## Part 8 — approved', '## Part 9 — approved'),
    ];
    for (const mutation of mutations) expect(() => validatePartOrder(mutation)).toThrow();

    const ledgerMutations = [
      ledger.replace('| 02 | 1B |', '| 02 | 1C |'),
      ledger.replace('| 66 | 14G |', '| 67 | 14G |'),
      ledger.replace(/^\| 25 \| 6E .*\r?\n/m, ''),
      ledger.replace('| 15 | 4C | Evaluation-time and pre-effect currentness revalidation | **Released** |',
        '| 15 | 4C | Evaluation-time and pre-effect currentness revalidation | **Accepted** |'),
    ];
    for (const mutation of ledgerMutations) expect(() => validateLedger(mutation)).toThrow();
  });

  test('keeps all unavailable external, legal, provider and founder evidence unclaimed', () => {
    const documents = [read(ROADMAP_PATH), read(LEDGER_PATH), read(CONTRACT_PATH)].join('\n');
    for (const boundary of [
      'Production provider accounts', 'Professional legal', 'External collection agencies',
      'Private-production', 'real recipients', 'first-paying-customer live-money validation',
      'Hosted CI/load', 'exercised disaster restore', 'production performance/SLA',
      'physical Safari/devices', 'manual assistive-technology review', 'founder visual approval',
    ]) expect(documents.toLowerCase()).toContain(boundary.toLowerCase());
  });

  test('preserves the single additive Part 2D migration after the released through-272 baseline', () => {
    const names = fs.readdirSync(path.join(ROOT, 'migrations'))
      .filter(name => name.endsWith('.sql'))
      .sort((left, right) => Number(left.split('_')[0]) - Number(right.split('_')[0]));
    expect(names).toHaveLength(280);
    expect(names.at(-1)).toBe('284_canonical_automation_channel_delivery_handoff_v1.sql');
    expect(names.some(name => name.startsWith('285_'))).toBe(false);
    expect(names.filter(name => /^273_/.test(name))).toEqual(['273_canonical_automation_authority_v1.sql']);
    expect(names.filter(name => /^274_/.test(name))).toEqual(['274_canonical_automation_trigger_snapshots_v1.sql']);
    expect(names.filter(name => /^278_/.test(name))).toEqual(['278_canonical_automation_retry_reconciliation_v1.sql']);
    expect(names.filter(name => /^279_/.test(name))).toEqual(['279_canonical_automation_delivery_controls_v1.sql']);
  });
});
