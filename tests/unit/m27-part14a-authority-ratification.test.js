'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const authority = require('../../src/customerFinancial/mission27Part14Authority');

const ROOT = path.resolve(__dirname, '../..');
const DOCUMENT_KEYS = Object.freeze(['roadmap', 'ledger', 'architecture']);
const DOCS = Object.freeze(Object.fromEntries(DOCUMENT_KEYS.map(name => [
  name,
  fs.readFileSync(path.join(ROOT, authority.CANONICAL_DOCUMENTS[name].path), 'utf8'),
])));

function normalized(value) { return value.replace(/\r\n?/g, '\n'); }
function digest(value) {
  return crypto.createHash('sha256').update(normalized(value), 'utf8').digest('hex');
}
function expectRejected(key, changed) {
  expect(changed).not.toBe(DOCS[key]);
  expect(() => authority.validate({ ...DOCS, [key]:changed })).toThrow(
    'Mission 27 Part 14 authority ratification invalid');
}
function replaceExact(key, from, to) {
  expect(DOCS[key].split(from)).toHaveLength(2);
  expectRejected(key, DOCS[key].replace(from, to));
}
function mutateLedgerCell(rowId, cellIndex) {
  const lines = DOCS.ledger.split(/(?<=\n)/);
  const index = lines.findIndex(line => line.startsWith(`| ${rowId} |`));
  expect(index).toBeGreaterThan(-1);
  const newline = lines[index].endsWith('\r\n') ? '\r\n' :
    lines[index].endsWith('\n') ? '\n' : '';
  const line = lines[index].slice(0, lines[index].length - newline.length);
  const cells = line.slice(1, -1).split('|');
  expect(cells).toHaveLength(10);
  cells[cellIndex] = `${cells[cellIndex]} altered`;
  lines[index] = `|${cells.join('|')}|${newline}`;
  return lines.join('');
}
function swapAdjacentSections(document, firstHeading, secondHeading) {
  const first = document.indexOf(firstHeading);
  const second = document.indexOf(secondHeading);
  expect(first).toBeGreaterThan(-1);
  expect(second).toBeGreaterThan(first);
  const afterSecond = document.indexOf('\n## ', second + secondHeading.length);
  expect(afterSecond).toBeGreaterThan(second);
  return document.slice(0, first) + document.slice(second, afterSecond) + '\n' +
    document.slice(first, second) + document.slice(afterSecond + 1);
}

describe('Mission 27 Part 14A complete canonical authority allowlist', () => {
  test('independently derives the locked normalized whole-document manifest', () => {
    for (const name of DOCUMENT_KEYS) {
      const document = normalized(DOCS[name]);
      const manifest = authority.CANONICAL_DOCUMENTS[name];
      expect(digest(DOCS[name])).toBe(manifest.normalizedSha256);
      expect(Buffer.byteLength(document, 'utf8')).toBe(manifest.normalizedUtf8Bytes);
      expect(document.split('\n')).toHaveLength(manifest.normalizedLineCount);
      expect(Object.isFrozen(manifest)).toBe(true);
    }
    expect(Object.isFrozen(authority.CANONICAL_DOCUMENTS)).toBe(true);
    expect(authority.validate({ ...DOCS })).toEqual(expect.objectContaining({
      contractVersion:'m27-part14a-authority-ratification-v2',
      currentSlice:'14A', currentStatus:'candidate', migrationLatest:272,
      migration273Present:false, laterSlices:['14B','14C','14D','14E','14F','14G'],
    }));
  });

  test.each([
    ['self-audited accepted production complete','Part 14A is independently audited, accepted, and production-complete.'],
    ['self accepted case and punctuation','PART 14A: ACCEPTED; PRODUCTION COMPLETE!'],
    ['merged deployed','Part 14A was merged and deployed to production.'],
    ['merged deployed variant','Deployment succeeded; merge complete for 14A.'],
    ['later slices shipped','Parts 14B through 14G are shipped and completed.'],
    ['later slice variant','14C, 14D, and 14E now have status: COMPLETE.'],
    ['automatic sms and charge','Automatic SMS and charging may proceed without human review.'],
    ['automatic notification variant','Send texts and collect customer funds automatically; review is optional.'],
    ['automatic refunds accounting','Refunds and accounting exports are automatically authorized.'],
    ['refund export variant','Issue reimbursements and transmit ledger entries without review.'],
    ['external provider live money','Provider and external calls with live money are allowed.'],
    ['live effect variant','Real payment transport may execute against external systems.'],
    ['received check cleared','A received check is treated as cleared cash.'],
    ['check variant','check_received implies bank clearance and settlement.'],
  ])('rejects contradictory normative appendix: %s', (_name, claim) => {
    expectRejected('architecture', `${DOCS.architecture}\n## Additional authority\n\n${claim}\n`);
  });

  test('rejects every material ledger cell and every later-row status/order mutation', () => {
    for (const rowId of ['13D','14A','14B','14C','14D','14E','14F','14G']) {
      for (let cell = 1; cell < 10; cell += 1) {
        expectRejected('ledger', mutateLedgerCell(rowId, cell));
      }
    }
    const rows = [...DOCS.ledger.matchAll(/^\| 14[A-G] \|.*$/gm)].map(match => match[0]);
    expect(rows).toHaveLength(7);
    const reordered = DOCS.ledger.split(/(?<=\n)/);
    const first = reordered.findIndex(line => line.startsWith('| 14A |'));
    const second = reordered.findIndex(line => line.startsWith('| 14B |'));
    [reordered[first], reordered[second]] = [reordered[second], reordered[first]];
    expectRejected('ledger', reordered.join(''));
    expectRejected('ledger', DOCS.ledger.replace(rows[3], `${rows[3]}\n${rows[3]}`));
  });

  test('rejects status, provenance, scope, evidence, unavailable and Part13D limitation drift', () => {
    replaceExact('roadmap',
      'Status: frozen plan through released complete Part 13; original Part 14A is the current implementation candidate.',
      'Status: frozen plan through released complete Part 14; original Part 14A is released.');
    replaceExact('roadmap', authority.PART13_RELEASE.head, 'f'.repeat(40));
    replaceExact('roadmap',
      'arbitrary earlier same-process runtime replacement remains outside this application validator',
      'arbitrary earlier same-process runtime replacement is accepted');
    replaceExact('roadmap', 'secure customer delivery, ', '');
    replaceExact('architecture',
      'Every provider, receiver, accounting, downstream, database, external, replay, and money-effect counter remains zero.',
      'External and money effects may execute.');
    replaceExact('architecture',
      'Unavailable and unclaimed: immutable issued invoice/document, real customer delivery,',
      'Accepted and complete: immutable issued invoice/document, real customer delivery,');
    replaceExact('ledger', 'Independent whole exact-head re-audit pending',
      'Independent whole exact-head audit accepted');
  });

  test('rejects reordered, removed, duplicated, renamed, appended and evasively rewritten authority', () => {
    const first = '## Frozen launch choices';
    const second = '## Mounted boundary';
    expectRejected('architecture', swapAdjacentSections(DOCS.architecture, first, second));
    replaceExact('architecture', `${first}`, '## FROZEN LAUNCH CHOICES');
    replaceExact('architecture', 'No automatic issue, delivery, charge, refund, receipt, accounting, or downstream action is authorized.',
      'No automatic issue delivery charge refund receipt accounting or downstream action is authorized');
    replaceExact('architecture', '## Exact ordered execution', '## Exact ordered execution\n\n## Exact ordered execution');
    replaceExact('architecture', '12. `offline_check_received`', '');
    replaceExact('architecture', `${first}`, `${second}`);
    expectRejected('roadmap', `${DOCS.roadmap}\n## Unreviewed normative appendix\n\nPart 14A is complete.\n`);
    expectRejected('ledger', `${DOCS.ledger}\n| 14H | Unexpected normative row | No | No | No | — | No | No | No | Planned |\n`);
    expectRejected('roadmap', DOCS.roadmap.replace('Part 14A', 'Part  14A'));
    expectRejected('ledger', DOCS.ledger.replace('Current implementation candidate', 'current implementation candidate'));
  });

  test('allows platform line-ending normalization only and rejects non-string or widened inputs', () => {
    const crlf = Object.fromEntries(DOCUMENT_KEYS.map(name => [
      name, normalized(DOCS[name]).replace(/\n/g, '\r\n'),
    ]));
    expect(authority.validate(crlf).currentStatus).toBe('candidate');
    for (const name of DOCUMENT_KEYS) {
      expect(() => authority.validate({ ...DOCS, [name]:new String(DOCS[name]) })).toThrow();
      expect(() => authority.validate({ ...DOCS, [name]:`${DOCS[name]} ` })).toThrow();
    }
    expect(() => authority.validate({ ...DOCS, extra:'authority' })).toThrow();
    expect(() => authority.validate(Object.assign(Object.create(null), DOCS))).toThrow();
  });
});
