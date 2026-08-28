'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const expectedMatrices = [
  'chrome-desktop-light', 'chrome-desktop-dark', 'chrome-mobile-light', 'chrome-mobile-dark',
  'webkit-desktop-light', 'webkit-desktop-dark', 'webkit-mobile-light', 'webkit-mobile-dark',
];
const requiredLabels = [
  'employee-primary', 'dispatched-route-and-instructions', 'current-active-crew', 'loading',
  'network-error', 'offline', 'stale-reload', 'crew-membership-removed', 'session-revoked', 'employee-no-work-unassigned',
  'no-work-empty', 'command-center-reference',
];

function sha256File(filename) {
  return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}

function main() {
  const directory = path.resolve(process.argv[2] || 'outputs/m22-part6-correction-writer/employee-only-screenshots');
  const testedRevision = process.argv[3];
  const testedTree = process.argv[4];
  assert.match(testedRevision || '', /^[0-9a-f]{40}$/);
  assert.match(testedTree || '', /^[0-9a-f]{40}$/);
  assert.ok(fs.statSync(directory).isDirectory());

  const manifestFiles = fs.readdirSync(directory).filter(name => name.endsWith('-manifest.json')).sort();
  const matrices = manifestFiles.map(name => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')));
  assert.deepStrictEqual(matrices.map(value => value.matrix).sort(), [...expectedMatrices].sort());
  for (const matrix of matrices) {
    assert.strictEqual(matrix.testedRevision, testedRevision);
    assert.strictEqual(matrix.testedTree, testedTree);
    assert.match(matrix.browserVersion, /^\d+\./);
    assert.strictEqual(matrix.realAuthority, 'disposable PostgreSQL cookie session');
    assert.match(matrix.fixtureTenantTimeZone || '', /^[A-Za-z]+(?:\/[A-Za-z_+-]+)+$/);
    assert.ok(matrix.fixtureReferenceInstant && !Number.isNaN(new Date(matrix.fixtureReferenceInstant).getTime()));
    const names = matrix.screenshots.map(entry => entry.filename);
    for (const label of requiredLabels) assert.ok(names.includes(`${matrix.matrix}-${label}.png`), `${matrix.matrix} lacks ${label}`);
    for (const entry of matrix.screenshots) {
      assert.strictEqual(entry.testedRevision, testedRevision);
      assert.strictEqual(entry.testedTree, testedTree);
      assert.strictEqual(entry.sha256, sha256File(path.join(directory, entry.filename)));
      assert.ok(entry.sourceRoute === '/dashboard/today' || entry.sourceRoute === '/dashboard');
      assert.ok(entry.timestamp && !Number.isNaN(new Date(entry.timestamp).getTime()));
      assert.ok(Array.isArray(entry.expectedVisible) && entry.expectedVisible.length > 0);
      assert.ok(Array.isArray(entry.expectedWithheld) && entry.expectedWithheld.length > 0);
      assert.strictEqual(entry.fixtureTenantTimeZone, matrix.fixtureTenantTimeZone);
      assert.strictEqual(entry.fixtureReferenceInstant, matrix.fixtureReferenceInstant);
      assert.ok(typeof entry.stateProvenance === 'string' && entry.stateProvenance.length > 20);
      if (['loading', 'error', 'offline', 'stale', 'restricted', 'empty'].includes(entry.state) && entry.sourceRoute === '/dashboard/today') {
        assert.ok(entry.expectedWithheld.some(value => value.includes('all private work records')),
          `${entry.filename} must state that private work is absent`);
        assert.ok(!entry.expectedVisible.includes('minimum job and customer essentials'),
          `${entry.filename} falsely claims private work is visible`);
        assert.ok(!entry.expectedVisible.includes('current assignment, schedule and dispatch truth'),
          `${entry.filename} falsely claims assignment truth is visible`);
      }
      const syntheticMarker = {
        loading: 'delays one real', error: 'route.abort', offline: 'context.setOffline', stale: 'route.fulfill',
      }[entry.state];
      if (syntheticMarker) {
        assert.ok(entry.stateProvenance.includes(syntheticMarker), `${entry.filename} lacks exact synthetic provenance`);
        assert.ok(entry.stateProvenance.includes('no durable authority claim'), `${entry.filename} overclaims durable authority`);
        assert.ok(entry.sessionProvenance.includes(syntheticMarker), `${entry.filename} session provenance omits synthetic state`);
      }
    }
  }

  const screenshots = matrices.flatMap(matrix => matrix.screenshots.map(entry => ({ matrix: matrix.matrix, ...entry })));
  const aggregate = {
    package: 'NorthStar Mission 22 Part 6 employee-only Today screenshot evidence',
    testedRevision,
    testedTree,
    generatedAt: new Date().toISOString(),
    authority: 'isolated disposable PostgreSQL test tenants with mounted cookie sessions and durable user/member/workforce/crew authority',
    productionDataOrAccounts: false,
    browserTruth: 'Installed Google Chrome and actual Playwright WebKit; WebKit is not physical Safari.',
    userVisualApproval: 'separate and unclaimed',
    finalCopyRequirement: 'After terminal Part 6 release, the Mission 22 lead copies this immutable in-repository package to the existing verified canonical OneDrive evidence/screenshots path and surfaces key views in the master chat.',
    matrices: matrices.map(matrix => ({
      matrix: matrix.matrix, engineLabel: matrix.engineLabel, browserVersion: matrix.browserVersion,
      viewport: matrix.viewport, theme: matrix.theme, screenshotCount: matrix.screenshots.length,
      fixtureTenantTimeZone: matrix.fixtureTenantTimeZone, fixtureReferenceInstant: matrix.fixtureReferenceInstant,
    })),
    screenshots,
  };
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(aggregate, null, 2) + '\n');

  const rows = screenshots.map(entry => [entry.sha256, entry.filename]).sort((left, right) => left[1].localeCompare(right[1]));
  fs.writeFileSync(path.join(directory, 'screenshots.sha256'), rows.map(row => `${row[0]}  ${row[1]}`).join('\n') + '\n');

  const byState = [...new Set(screenshots.map(entry => entry.state))].sort().join(', ');
  const human = [
    '# Mission 22 Part 6 employee-only screenshot manifest', '',
    `- Exact tested revision: \`${testedRevision}\``,
    `- Exact tested tree: \`${testedTree}\``,
    `- Browser matrices: ${matrices.length}; screenshots: ${screenshots.length}.`,
    `- UI states: ${byState}.`,
    '- Authority: isolated disposable PostgreSQL tenants; distinct mounted cookie-session identities; current durable user/member/workforce/crew authority.',
    '- Data boundary: no production data, production account, browser-only role fabrication, weakened authentication, or test endpoint.',
    '- Browser truth: installed Chrome plus actual Playwright WebKit. WebKit is not physical Safari.',
    '- Every screenshot entry in `manifest.json` records engine/version, viewport, theme, role/identity, assignment mode, UI state, exact revision/tree, selected real tenant IANA zone, fixture/session provenance, exact synthetic transport provenance where used, state-specific visible/withheld categories, route, timestamp, and SHA-256.',
    '- Non-ready rows explicitly record that private work is absent and cleared; synthetic loading/error/offline/stale states never claim durable PostgreSQL authority for the injected transport condition.',
    '- Network/DOM assertions establish zero provider calls, zero worker mutation requests, and absence of financials, billing/subscription settings, broad customer history, other-worker schedules, Polaris cost intelligence, provider credentials, and Mission 23 controls.',
    '- Command Center reference captures are paired by browser, viewport, and theme with Today captures; unrelated existing visual inconsistencies are not changed by Part 6.',
    '- User visual approval is separate and unclaimed.',
    '- After terminal Part 6 release, the Mission 22 lead must copy this package to the existing verified canonical OneDrive evidence/screenshots path and surface key views in the master chat.',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(directory, 'manifest.md'), human);
  process.stdout.write(JSON.stringify({ matrices: matrices.length, screenshots: screenshots.length, testedRevision, testedTree }) + '\n');
}

main();
