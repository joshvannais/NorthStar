'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const expectedMatrices = [
  'chrome-desktop-light', 'chrome-desktop-dark', 'chrome-mobile-light', 'chrome-mobile-dark',
  'webkit-desktop-light', 'webkit-desktop-dark', 'webkit-mobile-light', 'webkit-mobile-dark',
];
const HOSTILE = '<img src=x onerror="globalThis.m22Part6Compromised=true">';

function sha256File(filename) {
  return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}

function main() {
  const directory = path.resolve(process.argv[2] || 'outputs/m22-part6-correction-writer/hostile-security-evidence');
  const testedRevision = process.argv[3];
  const testedTree = process.argv[4];
  assert.match(testedRevision || '', /^[0-9a-f]{40}$/);
  assert.match(testedTree || '', /^[0-9a-f]{40}$/);
  assert.ok(fs.statSync(directory).isDirectory());

  const manifestFiles = fs.readdirSync(directory).filter(name => name.endsWith('-manifest.json')).sort();
  const matrices = manifestFiles.map(name => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')));
  assert.deepStrictEqual(matrices.map(value => value.matrix).sort(), [...expectedMatrices].sort());
  const screenshots = [];
  for (const matrix of matrices) {
    assert.strictEqual(matrix.testedRevision, testedRevision);
    assert.strictEqual(matrix.testedTree, testedTree);
    assert.strictEqual(matrix.packagePurpose,
      'separate hostile stored-byte and DOM-sink security evidence; not employee handoff visuals');
    assert.strictEqual(matrix.screenshots.length, 1);
    const entry = matrix.screenshots[0];
    assert.strictEqual(entry.filename, `${matrix.matrix}-hostile-source-to-sink-inert.png`);
    assert.strictEqual(entry.storedProbe, HOSTILE);
    assert.strictEqual(entry.apiProjectionContainsLiteralProbe, true);
    assert.strictEqual(entry.domContainsLiteralProbeText, false);
    assert.deepStrictEqual(entry.displayProjection,
      ['Job title unavailable', 'Employee name unavailable', 'Customer name unavailable', 'Service location unavailable']);
    assert.strictEqual(entry.executableImageElementsInTodayRecords, 0);
    assert.strictEqual(entry.globalCompromiseFlag, false);
    assert.strictEqual(entry.sha256, sha256File(path.join(directory, entry.filename)));
    assert.ok(entry.purpose.includes('not the employee visual handoff package'));
    screenshots.push({ matrix: matrix.matrix, ...entry });
  }

  const aggregate = {
    package: 'NorthStar Mission 22 Part 6 hostile stored-byte security evidence',
    packagePurpose: 'adversarial source-to-sink proof kept separate from realistic employee handoff visuals',
    testedRevision,
    testedTree,
    generatedAt: new Date().toISOString(),
    authority: 'isolated disposable PostgreSQL test tenants with mounted cookie sessions and durable user/member/workforce/crew authority',
    productionDataOrAccounts: false,
    browserTruth: 'Installed Google Chrome and actual Playwright WebKit; WebKit is not physical Safari.',
    userVisualApproval: 'not applicable to this deliberately hostile security proof',
    screenshots,
  };
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(aggregate, null, 2) + '\n');
  fs.writeFileSync(path.join(directory, 'screenshots.sha256'), screenshots
    .map(entry => `${entry.sha256}  ${entry.filename}`).sort().join('\n') + '\n');
  fs.writeFileSync(path.join(directory, 'manifest.md'), [
    '# Mission 22 Part 6 hostile source-to-sink security evidence', '',
    `- Exact tested revision: \`${testedRevision}\``,
    `- Exact tested tree: \`${testedTree}\``,
    `- Browser matrices: ${matrices.length}; deliberately hostile security screenshots: ${screenshots.length}.`,
    '- This is adversarial security evidence, not the realistic employee handoff package and not a customer-facing visual reference.',
    '- The literal stored probe traversed disposable PostgreSQL and the allowlisted API unchanged, while the user-facing display used neutral placeholders, created zero image elements, and did not set the compromise flag.',
    '- Authority used real mounted cookie sessions and durable tenant/member/workforce/crew scope in isolated disposable databases.',
    '- Browser truth: installed Chrome plus actual Playwright WebKit. WebKit is not physical Safari.',
    '',
  ].join('\n'));
  process.stdout.write(JSON.stringify({ matrices: matrices.length, screenshots: screenshots.length, testedRevision, testedTree }) + '\n');
}

main();
