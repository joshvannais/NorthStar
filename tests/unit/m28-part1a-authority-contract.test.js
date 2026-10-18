'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
  .replace(/\r\n/g, '\n');

const roadmap = read('docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md');
const ledger = read('docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md');
const authority = read('docs/architecture/MISSION_28_PART1A_AUTHORITY_CONTRACT.md');

const expectedParts = [
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

const expectedSliceIds = expectedParts.flatMap(([part, _title, count]) =>
  Array.from({ length: count }, (_unused, index) =>
    `${part}${String.fromCharCode('A'.charCodeAt(0) + index)}`));

function parseRoadmap() {
  const parts = [];
  const slices = [];
  let currentPart = null;
  for (const line of roadmap.split('\n')) {
    const heading = line.match(/^## Part (\d+) — (.+)$/);
    if (heading) {
      currentPart = Number(heading[1]);
      parts.push([currentPart, heading[2]]);
      continue;
    }
    const row = line.match(/^\| ([A-G]) \| (.+) \|$/);
    if (row && currentPart !== null) {
      slices.push({ id: `${currentPart}${row[1]}`, scope: row[2] });
    }
  }
  return { parts, slices };
}

function section(markdown, heading, nextHeading) {
  const start = markdown.indexOf(heading);
  const end = nextHeading ? markdown.indexOf(nextHeading, start + heading.length) : markdown.length;
  if (start < 0 || end < 0) throw new Error(`Missing section ${heading}`);
  return markdown.slice(start, end);
}

describe('Mission 28 Part 1A authority ratification', () => {
  test('preserves the founder-approved mission body exactly', () => {
    const marker = '\n## Mission objective\n';
    const start = roadmap.lastIndexOf(marker);
    expect(start).toBeGreaterThan(0);
    const body = `${roadmap.slice(start + 1).trimEnd()}\n`;
    expect(crypto.createHash('sha256').update(body).digest('hex').toUpperCase())
      .toBe('109589DA2242EE6AA7FDD4C2DED3E3440B909B26452DEFCD39BC2502C1ADAAF5');
    expect(roadmap).toContain(
      'DDBA5CA7523A1684330E136313F4416584D142A63167310EEABEC1EBFBB010B4');
  });

  test('freezes the exact fourteen-part and sixty-six-slice order', () => {
    const parsed = parseRoadmap();
    expect(parsed.parts).toEqual(expectedParts.map(([part, title]) => [part, title]));
    expect(parsed.slices.map(slice => slice.id)).toEqual(expectedSliceIds);
    expect(new Set(parsed.slices.map(slice => slice.id)).size).toBe(66);
    expect(parsed.slices).toHaveLength(66);
    expect(expectedParts.reduce((total, part) => total + part[2], 0)).toBe(66);
  });

  test('retains all twelve mission invariants in their approved order', () => {
    const invariantSection = section(roadmap,
      '## Non-negotiable mission invariants',
      '## Part 1 — mission authority, inventory, risk model, and acceptance contract');
    const titles = [...invariantSection.matchAll(/^\d+\. \*\*(.+?)\*\*/gm)]
      .map(match => match[1]);
    expect(titles).toEqual([
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
    ]);
  });

  test('keeps the acceptance ledger aligned and marks only Part 1A as candidate', () => {
    const rows = ledger.split('\n')
      .filter(line => /^\| \d{1,2}[A-G] \|/.test(line))
      .map(line => line.split('|').slice(1, -1).map(cell => cell.trim()));
    expect(rows.map(row => row[0])).toEqual(expectedSliceIds);
    expect(rows).toHaveLength(66);
    expect(rows[0][9]).toBe('Candidate');
    expect(rows[0][2]).toContain('zero runtime, schema, permission, provider, receiver');
    expect(rows.slice(1).every(row => row[9] === 'Planned')).toBe(true);
    expect(rows.slice(1).every(row => row[2] === 'No')).toBe(true);
    expect(ledger).not.toMatch(/\| (?:1[B-D]|[2-9][A-G]|1[0-4][A-G]) \|[^\n]*\| (?:Candidate|Released|Accepted) \|/);
  });

  test('ratifies every dependency without taking over its source authority', () => {
    const dependencySection = section(authority,
      '## Dependency and ownership map', '## Ratified four-stage boundary');
    const authorities = dependencySection.split('\n')
      .map(line => line.match(/^\| (Mission(?:s)? [^|]+?) \|/))
      .filter(Boolean)
      .map(match => match[1].trim());
    expect(authorities).toEqual([
      'Mission 20', 'Mission 21', 'Mission 22', 'Mission 23', 'Mission 24',
      'Mission 25', 'Mission 26', 'Mission 27', 'Mission 29', 'Missions 30–33',
    ]);
    expect(dependencySection).toContain('turning a prediction into a fact or action');
    expect(dependencySection).toContain('charging, refunds, fees, write-offs, accounting');
    expect(authority).toContain('Mission 28 owns tenant-private automation policy');
    expect(authority).toContain('It may not copy a source into a new record and then treat the copy as');
  });

  test('separates fact, decision, effect, and evidence without promotion', () => {
    const boundary = section(authority,
      '## Ratified four-stage boundary', '## Ratified terminology');
    const stages = [...boundary.matchAll(/^\| \*\*(.+?)\*\* \|/gm)]
      .map(match => match[1]);
    expect(stages).toEqual([
      'Upstream fact', 'Automation decision', 'External effect', 'Evidence of the effect',
    ]);
    expect(boundary).toContain('never activates, widens, approves or executes an automation');
    expect(boundary).toContain('It is intent, not execution');
    expect(boundary).toContain('after immediate pre-effect revalidation');
    expect(boundary).toContain('An attempt is not provider acceptance; provider acceptance is not delivery');
    expect(boundary).toContain(
      '`upstream fact → automation decision → external effect → evidence of effect`');
    expect(boundary).toContain('They do not mean automatic promotion');
  });

  test('grants no Part 1B or runtime authority', () => {
    expect(authority).toContain('Part 1A adds no route, worker, queue, event listener');
    expect(authority).toContain('Part 1A authorizes none');
    expect(authority).toContain('Part 1B inventories and');
    expect(authority).toContain('Ratification by name is not adoption');
    expect(authority).toContain('Part 1D owns the first-supported');
    expect(authority).toContain('first-paying-customer live-money validation');
    expect(authority).toContain('founder visual approval remain');
  });
});
