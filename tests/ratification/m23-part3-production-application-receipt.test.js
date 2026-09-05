'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
const roadmap = read('docs', 'roadmap', 'MISSION_23_OPERATIONS.md');
const receipt = read(
  'outputs', 'm23-part3-writer', 'PRODUCTION_APPLICATION_RECEIPT.md'
);
const requirements = read(
  'outputs', 'm23-part3-writer', 'REQUIREMENT_TO_EVIDENCE.md'
);
const unavailable = read(
  'outputs', 'm23-part3-writer', 'UNAVAILABLE_EVIDENCE.md'
);
const laterStartReceipt = read(
  'outputs', 'm23-part3-writer', 'LATER_START_ZERO_OP_RECEIPT.md'
);

describe('Mission 23 Part 3 production application receipt', () => {
  test('pins the accepted candidate, normal merge, and automatic deployment', () => {
    expect(receipt).toContain('`8de66512d1baa335e4e7151b6a7232c94de9dc0a`');
    expect(receipt).toContain('`2abaf5251a16e52afac0bf1a4f2b1da7783ea460`');
    expect(receipt).toContain('PR #163 merged normally at `2026-09-04T14:29:12Z`');
    expect(receipt).toContain('`ee6cac8b729f73a5af22c7d5747fd52c1d1d4035`');
    expect(receipt).toContain('`e1d88caa-339e-49b6-a08a-60cd20eddcf9`');
    expect(receipt).toContain('reached `SUCCESS` for the exact merge');
    expect(receipt).toContain(
      '`sha256:35bc3cf838052c911a93ca01bd2892a3f6db054da67b7742fc462aac4970082a`'
    );
    expect(receipt).toContain('No manual redeploy, restart, DDL, provider action');
  });

  test('records exactly one automatic first-start application for 039 through 041', () => {
    for (const name of [
      '039_canonical_labor_time_evidence.sql',
      '040_canonical_labor_time_audit_corrections.sql',
      '041_canonical_labor_transcript_source_authority.sql',
    ]) {
      expect(receipt).toContain(`[DB] Migration applied: ${name}`);
      expect(receipt).toContain(`exactly one row named \`${name}\``);
    }
    expect(receipt).toContain(
      'No second application entry for migrations 039, 040, or 041 appeared'
    );
    expect(receipt).toContain('individual log-entry timestamps, so\nnone are invented here');
  });

  test('pins PostgreSQL identity, exact checksums, common timestamp, and safe inspection', () => {
    for (const expected of [
      'PostgreSQL `18.6`',
      '`TimeZone = Etc/UTC`',
      'server encoding `UTF8`',
      'collation and ctype `en_US.utf8`',
      '`migrationCount = 39`',
      '`2204695c9be757a66094897f6bb9e86bee9c84f1582a3bc27812d7bbdebdf13a`',
      '`229b022a8fa70ac2daae05f2ffaf48016ecd77a50df29350cc9cd72221b6258b`',
      '`55dcb1bd4a5ddd65645915127b7964081498e1e3321fe215aaafe5707ae9cc5c`',
      '`applied_at = 2026-09-04T14:30:01.345Z`',
    ]) expect(receipt).toContain(expected);
    expect(receipt).toContain('accessed no private/customer row, displayed no credential');
    expect(receipt).toContain('made\nno production mutation or provider action');
  });

  test('records three healthy credential-free checks without inventing timestamps', () => {
    expect(receipt).toContain(
      'Three credential-free `GET https://northstar-os.ai/api/health` requests each'
    );
    expect(receipt).toContain('returned HTTP `200`');
    expect(receipt).toContain('reported `status = ok`, PostgreSQL');
    expect(receipt).toContain('both `database` and `canonicalPersistence` as `healthy`');
    expect(receipt).toContain('Observation timestamps were not supplied, so none are invented.');
  });

  test('records later-start zero-op while keeping historical recovery gaps explicit', () => {
    expect(roadmap).toContain('Part 3\'s later-start gate is therefore achieved rather than pending.');
    expect(receipt).toContain('## Required later-start zero-op follow-up');
    expect(receipt).toContain('contains no `[DB] Migration applied` entry');
    expect(receipt).toContain('every `applied_at` remains exactly `2026-09-04T14:30:01.345Z`');
    expect(receipt).toContain('No manual restart or redeploy may manufacture that evidence.');
    expect(receipt).toContain('Part 4 must not begin');
    expect(receipt).toContain('No terminal pre-application 039+040+041 production-history receipt');
    expect(receipt).toContain('No dated production backup receipt or isolated restore rehearsal');
    expect(receipt).toContain('no destructive database rollback or data deletion');
    expect(laterStartReceipt).toContain('`2abef4be3e31c2c468762598edc0e79859f67c2f`');
    expect(laterStartReceipt).toContain('`15c61f89e4dd52ae768f1d30d1d6a3808c2d7ec5`');
    expect(laterStartReceipt).toContain('`2b498fe1-d025-4be7-bd90-cef6154f9bb8`');
    expect(laterStartReceipt).toContain('contained no `[DB] Migration applied` entry');
    expect(laterStartReceipt).toContain('This closes Part 3\'s separate later-start zero-op gate.');
    expect(unavailable).toContain('Backup/restore remains unavailable');
  });

  test('keeps the released follow-up documentation-only and Part 4 independently gated', () => {
    expect(requirements).toContain('## Production application receipt follow-up boundary');
    expect(requirements).toContain('Scope: documentation, evidence, and ratification assertions only.');
    expect(requirements).toContain('| Receipt-follow-up scope |');
    expect(requirements).toContain('| Achieved; Part 4 progression gate passed |');
    expect(unavailable).toContain('independent audit or release decision for Part 4');
    expect(roadmap).toContain('Part 3 changes no rendered surface.');
    expect(roadmap).toContain('**Part 4: independently approved, normally merged, deployed, and health');
    expect(roadmap).toContain('**Part 5: implementation writer candidate; independent audit and release');
    expect(roadmap).toContain('**Parts 6–12: not implemented.**');
  });
});
