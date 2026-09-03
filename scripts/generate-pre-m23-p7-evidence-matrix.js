'use strict';

const fs = require('fs');
const path = require('path');

const EXPECTED_AUTHORITY_SHA256 = '48d3fce6f03a026185bceb4e0c87165c3192597fef30fab7c86ff9a1e97d6175';

const EVIDENCE_BY_PREFIX = Object.freeze({
  DS: 'Route-complete geometry, theme, heading, control-name, padding, reflow, and cross-browser evidence.',
  PUB: 'Public-route crawl plus retained public-clarity and claim-contract regression suites.',
  DEM: 'Demo-route crawl, Command Center interaction regression, session isolation, and browser state evidence.',
  OPS: 'Paid-route crawl, cross-page operational regression, customer-context drawer evidence, and role/state checks.',
  AI: 'Polaris P6 regression suites, intentional state presentation, intercepted transport, and safe-render checks.',
  ADM: 'Admin-route crawl, Business Profile and Settings regression, authority, role, conflict, and keyboard evidence.',
  EMP: 'Employee Today regression, minimal navigation, responsive/reflow, and role-authority evidence.',
  ACC: 'P7 route-complete, keyboard/focus, theme contrast, disabled-reason, contextual interaction, and browser evidence.',
  OBS: 'Telemetry regression with loopback-only capture, page-exit checks, and privacy-boundary review.',
});

function parseRow(line) {
  const columns = line.split('|').slice(1, -1).map(value => value.trim());
  if (columns.length !== 6 || !/^[A-Z0-9]+-\d{2}$/.test(columns[0])) return null;
  return {
    id: columns[0],
    requirement: columns[1],
    surface: columns[2],
    sourceStatus: columns[3],
    package: columns[4],
    acceptance: columns[5],
  };
}

function disposition(record) {
  if (record.id === 'ACC-07') {
    return 'UNAVAILABLE — physical iPhone, iPad, and Android interaction plus founder visual approval require genuine external evidence.';
  }
  if (record.id.startsWith('ACC-')) return 'P7 DIRECT — implemented or verified by the P7 writer; independent exact-head audit still required.';
  return 'INHERITED — accepted prior-package authority is preserved and regression-checked; P7 does not re-authorize its external gates.';
}

function escapeCell(value) {
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function main() {
  const [sourcePath, outputPath] = process.argv.slice(2);
  if (!sourcePath || !outputPath) {
    throw new Error('usage: node scripts/generate-pre-m23-p7-evidence-matrix.js <backlog-matrix.md> <output.md>');
  }
  const source = fs.readFileSync(sourcePath, 'utf8');
  const allRecords = source.split(/\r?\n/).map(parseRow).filter(Boolean);
  const preMissionRecords = allRecords.filter(record => record.id !== 'M23-01');
  if (allRecords.length !== 120 || preMissionRecords.length !== 119) {
    throw new Error(`expected 120 canonical records and 119 pre-Mission-23 records; got ${allRecords.length}/${preMissionRecords.length}`);
  }
  const ids = new Set(preMissionRecords.map(record => record.id));
  if (ids.size !== 119) throw new Error('pre-Mission-23 record IDs must be unique');

  const lines = [
    '# Pre-Mission 23 Package 7 requirement-to-evidence matrix',
    '',
    'Writer attestation: this matrix maps each of the 119 pre-Mission-23 canonical records exactly once. It is writer evidence, not an independent audit verdict, physical-device result, legal conclusion, or founder visual approval. The attestation becomes immutable only when its file digest and the frozen Git head/tree are recorded together in the final evidence manifest and draft PR body.',
    '',
    `Canonical backlog authority SHA-256: \`${EXPECTED_AUTHORITY_SHA256}\`.`,
    '',
    '| ID | Requirement | Surface | Canonical source status | Package | P7 disposition | Requirement evidence | Canonical acceptance |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const record of preMissionRecords) {
    const prefix = record.id.split('-')[0];
    const evidence = EVIDENCE_BY_PREFIX[prefix];
    if (!evidence) throw new Error(`missing evidence family for ${record.id}`);
    lines.push(`| ${record.id} | ${escapeCell(record.requirement)} | ${escapeCell(record.surface)} | ${escapeCell(record.sourceStatus)} | ${record.package} | ${escapeCell(disposition(record))} | ${escapeCell(evidence)} | ${escapeCell(record.acceptance)} |`);
  }
  lines.push('', 'Record count: **119 / 119**. Future placement `M23-01` is deliberately excluded from Package 7 implementation.', '');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');
}

main();
