'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const roadmap = fs.readFileSync(
  path.join(ROOT, 'docs', 'roadmap', 'MISSION_23_OPERATIONS.md'),
  'utf8'
);
const receipt = fs.readFileSync(
  path.join(ROOT, 'outputs', 'm23-part2-writer', 'PRODUCTION_APPLICATION_RECEIPT.md'),
  'utf8'
);
const requirementLedger = fs.readFileSync(
  path.join(ROOT, 'outputs', 'm23-part2-writer', 'REQUIREMENT_TO_EVIDENCE.md'),
  'utf8'
);
const unavailableLedger = fs.readFileSync(
  path.join(ROOT, 'outputs', 'm23-part2-writer', 'UNAVAILABLE_EVIDENCE.md'),
  'utf8'
);

describe('Mission 23 Part 2 production application receipt', () => {
  test('pins the exact normal merge and automatic deployment identity', () => {
    expect(receipt).toContain('PR #161 merged normally at `2026-09-04T06:42:11Z`');
    expect(receipt).toContain('`403576639ea0223a2a18340d87882a6cdfa47ca4`');
    expect(receipt).toContain('GitHub deployment `6259306993`');
    expect(receipt).toContain('`2026-09-04T06:43:03Z`');
    expect(receipt).toContain('`7392c2b3-0f49-4b3f-9e15-c3ed40fa5270`');
    expect(receipt).toContain('`2026-09-04T06:42:12.865Z`');
    expect(receipt).toContain('`SUCCESS` / `RUNNING`');
    expect(receipt).toContain('No manual redeploy, restart, DDL, provider configuration');
  });

  test('records first-start runner, exact production row, and health evidence', () => {
    expect(receipt).toContain('`2026-09-04T06:42:55.500946964Z`');
    expect(receipt).toContain('[DB] Migration applied: 038_canonical_field_execution_authority.sql');
    expect(receipt).toContain('`2026-09-04T06:42:59.204382383Z`');
    expect(receipt).toContain('`2026-09-04T06:44:38.598Z`');
    expect(receipt).toContain('PostgreSQL `18.6`');
    expect(receipt).toContain('36 total authoritative `_migrations` rows');
    expect(receipt).toContain('exactly one row named `038_canonical_field_execution_authority.sql`');
    expect(receipt).toContain('`84a0b65ec8cd01ff97043b66a543e30540e9a0bbb68a48c4b49415db3b766724`');
    expect(receipt).toContain('`applied_at = 2026-09-04 06:42:56.965851+00`');
    expect(receipt).toContain('Production `/api/health` returned `ok`');
    expect(receipt).toContain('Production `/` returned HTTP 200');
    expect(receipt).toContain('No customer/private row\nwas accessed.');
    expect(receipt).toContain('verification made no production mutation');
  });

  test('keeps later-start zero-op and recovery evidence unavailable', () => {
    expect(roadmap).toContain('A later\n  production start has not yet proved the required restart zero-op');
    expect(roadmap).toMatch(/and\s+blocks Part 3\s+until the later-start zero-op receipt passes/);
    expect(receipt).toContain('does **not** claim second-start zero-op');
    expect(receipt).toContain('Part 3 remains\nblocked');
    expect(receipt).toContain('No dated production backup receipt or isolated restore rehearsal is available.');
    expect(receipt).toContain('perform no destructive database rollback');
    expect(requirementLedger).toContain('| Later-start migration zero-op |');
    expect(requirementLedger).toContain('| Pending; Part 3 blocked |');
    expect(unavailableLedger).toContain('second-start runner zero-op');
    expect(unavailableLedger).toContain('Backup/restore rehearsal remains unavailable');
  });

  test('keeps the follow-up documentation-only and later missions unimplemented', () => {
    expect(roadmap).toContain('**Parts 3–12: not implemented.**');
    expect(requirementLedger).toContain('| Receipt-follow-up scope |');
    expect(requirementLedger).toContain('No runtime, migration, route, provider, credential, configuration, or production mutation');
    expect(unavailableLedger).toContain('Time, material, inventory, equipment, file, note, checklist, progress, blocker,');
  });
});
