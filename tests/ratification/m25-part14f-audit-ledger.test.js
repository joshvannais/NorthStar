'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { assertCoverage } = require('../../scripts/mission25-part14f-ledger');

const root = path.resolve(__dirname, '../..');
const ledger = JSON.parse(fs.readFileSync(path.join(root, 'docs/evidence/MISSION_25_PART14F_IMMUTABLE_LEDGER.json'), 'utf8'));
const handoff = fs.readFileSync(path.join(root, 'docs/evidence/MISSION_25_PART14F_AUDIT_HANDOFF.md'), 'utf8');
const requiredNonpassing = [
  'm23-part9b-overview',
  'm25-part11f-heading',
  'm25-part9f-route-literal',
  'm20-phase6a-timing',
];

function acceptanceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return acceptanceFiles(full);
    return /^MISSION_25_.*_ACCEPTANCE\.md$/.test(entry.name)
      ? [path.relative(root, full).replaceAll('\\', '/')]
      : [];
  }).sort();
}

describe('Mission 25 Part 14F independent audit ledger', () => {
  test('covers every acceptance record in the whole docs tree, including Part 13H outside evidence', () => {
    const all = acceptanceFiles(path.join(root, 'docs'));
    expect(all).toHaveLength(29);
    expect(all).toContain('docs/roadmap/MISSION_25_PART13H_ACCEPTANCE.md');
    expect(ledger.evidence.map(item => item.file)).toEqual(all);
    expect(ledger.evidence.find(item => item.file === 'docs/roadmap/MISSION_25_PART13H_ACCEPTANCE.md')).toEqual({
      file: 'docs/roadmap/MISSION_25_PART13H_ACCEPTANCE.md',
      gitBlob: '91fc0f4e811ac847b532a890c4494b22cc59ffd7',
      sha256: 'bca26cbf33732e9b5b3c7f195fe4a1d0510539e316d190609a9dec37f7732d99',
    });
    const missing = { ...ledger, evidence: ledger.evidence.filter(item => !item.file.includes('PART13H')) };
    expect(() => assertCoverage(missing, all, requiredNonpassing)).toThrow(/Acceptance-document inventory/);
    expect(() => assertCoverage(ledger, all.slice(1), requiredNonpassing)).toThrow(/Acceptance-document inventory/);
  });

  test('discloses every inherited nonpassing check and the exact red broad-run result', () => {
    const all = acceptanceFiles(path.join(root, 'docs'));
    expect(ledger.knownNonpassing.map(item => item.id)).toEqual(requiredNonpassing);
    for (const entry of ledger.knownNonpassing) {
      expect(fs.existsSync(path.join(root, entry.test))).toBe(true);
      expect(handoff).toContain(entry.test);
      expect(entry.observation).toMatch(/fail|SQLSTATE/i);
    }
    expect(ledger.broadRegression).toEqual({ suitesPassed: 38, suitesFailed: 1, testsPassed: 168, testsFailed: 1 });
    expect(handoff).toContain('38 passed / 1 failed suites and 168 passed / 1 failed tests');
    expect(handoff).toContain('not rerun');
    expect(handoff).toContain('excluded from passing totals');
    const understated = { ...ledger, knownNonpassing: ledger.knownNonpassing.filter(item => item.id !== 'm25-part9f-route-literal') };
    expect(() => assertCoverage(understated, all, requiredNonpassing)).toThrow(/Known nonpassing regression inventory/);
  });
});
