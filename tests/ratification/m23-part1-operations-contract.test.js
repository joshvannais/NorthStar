'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const ROADMAP_PATH = path.join(ROOT, 'docs', 'roadmap', 'MISSION_23_OPERATIONS.md');
const roadmap = fs.readFileSync(ROADMAP_PATH, 'utf8');
const requirementLedger = fs.readFileSync(
  path.join(ROOT, 'outputs', 'm23-part1-writer', 'REQUIREMENT_TO_EVIDENCE.md'),
  'utf8'
);
const unavailableLedger = fs.readFileSync(
  path.join(ROOT, 'outputs', 'm23-part1-writer', 'UNAVAILABLE_EVIDENCE.md'),
  'utf8'
);
const part2RequirementLedger = fs.readFileSync(
  path.join(ROOT, 'outputs', 'm23-part2-writer', 'REQUIREMENT_TO_EVIDENCE.md'),
  'utf8'
);
const part2UnavailableLedger = fs.readFileSync(
  path.join(ROOT, 'outputs', 'm23-part2-writer', 'UNAVAILABLE_EVIDENCE.md'),
  'utf8'
);
const part2MigrationIdentity = fs.readFileSync(
  path.join(ROOT, 'outputs', 'm23-part2-writer', 'MIGRATION_IDENTITY.md'),
  'utf8'
);
const part2ProductionReceipt = fs.readFileSync(
  path.join(ROOT, 'outputs', 'm23-part2-writer', 'PRODUCTION_MIGRATION_READINESS_RECEIPT.md'),
  'utf8'
);

const EXPECTED_PARTS = Object.freeze([
  'Root contract and live-state reconciliation',
  'Canonical field-execution authority',
  'Labor and time evidence',
  'Materials and inventory usage',
  'Equipment, vehicle, and machinery operations',
  'Checklists, inspections, photos, notes, and field evidence',
  'Progress, blockers, exceptions, and change-order facts',
  'Completion and reopening authority',
  'Operational experiences',
  'Polaris operational intelligence',
  'Downstream handoffs',
  'Mission-wide acceptance and release',
]);

function partHeadings() {
  return [...roadmap.matchAll(/^### Part (\d+) — (.+)$/gm)].map((match) => ({
    number: Number(match[1]),
    title: match[2].trim(),
  }));
}

describe('Mission 23 Part 1 Operations root contract', () => {
  test('retains the exact undiluted twelve-part sequence', () => {
    const parts = partHeadings();
    expect(parts).toHaveLength(12);
    expect(parts.map((part) => part.number)).toEqual(
      Array.from({ length: 12 }, (_value, index) => index + 1)
    );
    expect(parts.map((part) => part.title)).toEqual(EXPECTED_PARTS);
    expect(roadmap).toContain(
      'It must not be\nrenumbered, compressed, reordered, or silently widened.'
    );
  });

  test('preserves historical Part 1 truth and states truthful Part 2/Part 3 boundaries', () => {
    expect(roadmap).toContain('**Part 1: independently accepted, merged, deployed, and production-accepted at');
    expect(roadmap).toContain('**Part 2: independently accepted, normally merged, automatically deployed,');
    expect(roadmap).toContain('`403576639ea0223a2a18340d87882a6cdfa47ca4`; the');
    expect(roadmap).toContain('`e8c30f96d9c0bc0c4287c1f181a400e3cedd4748`');
    expect(roadmap).toContain('later-start zero-op verified');
    expect(roadmap).toContain('**Part 3: independently accepted, normally merged, automatically deployed,');
    expect(roadmap).toContain('later-start zero-op is\n  pending');
    expect(roadmap).toContain('**Parts 4–12: not implemented.**');
    expect(roadmap).toContain(
      'There is no accepted Mission 23 migration, table, route, repository, or browser'
    );

    const migrations = fs.readdirSync(path.join(ROOT, 'migrations'));
    expect(migrations.filter((name) => /mission[_-]?23|field[_-]?execution|^0(?:3[89]|40)_/i.test(name)).sort())
      .toEqual([
        '038_canonical_field_execution_authority.sql',
        '039_canonical_labor_time_evidence.sql',
        '040_canonical_labor_time_audit_corrections.sql',
      ]);
    expect(fs.readdirSync(path.join(ROOT, 'src', 'operations')).sort()).toEqual([
      'contract.js', 'httpBoundary.js', 'repository.js',
    ]);
    expect(fs.existsSync(path.join(ROOT, 'src', 'routes', 'fieldExecutions.js'))).toBe(true);
    const server = fs.readFileSync(path.join(ROOT, 'src', 'server.js'), 'utf8');
    expect(server).toContain('executionBodyBoundary');
    expect(server).toContain("app.use('/api/v1/field-executions'");
    expect(server).not.toMatch(/time-entries|material-usage|equipment-usage|execution-completion/);
    expect(roadmap).toContain('No Part 2 route writes schedule/dispatch state, time, labor, materials,');
    expect(roadmap).toContain(
      'Before either mutation entry point returns an exact cached response, PostgreSQL'
    );
    expect(roadmap).toContain(
      'without inserting or changing any current, history, audit, or replay evidence.'
    );
  });

  test('preserves accepted authorities instead of reviving or relabeling legacy state', () => {
    const mission21 = fs.readFileSync(
      path.join(ROOT, 'docs', 'roadmap', 'MISSION_21_KNOWLEDGE_ARCHITECTURE.md'),
      'utf8'
    );
    const mission22 = fs.readFileSync(
      path.join(ROOT, 'docs', 'roadmap', 'MISSION_22_SCHEDULING_AND_DISPATCH.md'),
      'utf8'
    );
    const assetsMigration = fs.readFileSync(
      path.join(ROOT, 'migrations', '016_tenant_asset_catalogue.sql'),
      'utf8'
    );
    const legacyJobEngine = fs.readFileSync(path.join(ROOT, 'src', 'polaris', 'job-engine.js'), 'utf8');
    const retiredRoutes = fs.readFileSync(
      path.join(ROOT, 'src', 'routes', 'legacyAuthorityRetirement.js'),
      'utf8'
    );

    expect(mission21).toContain('Mission 20 Business Profile and normalized authorities remain authoritative inputs.');
    expect(mission22).toContain('is not Mission 23 progress, time, material, inspection, photo, or completion');
    expect(assetsMigration).toContain('availability, meters, condition, maintenance, faults, downtime, telematics,');
    expect(legacyJobEngine).toContain('const _jobs = {};');
    expect(retiredRoutes).toMatch(/\|jobs\|/);

    expect(roadmap).toContain(
      'The word `operations` does not make it a field-job authority.'
    );
    expect(roadmap).toContain(
      'Never backfill Mission 23 completion from the compatibility status alone.'
    );
    expect(roadmap).toContain(
      'Do not mount, migrate, copy, or treat legacy engine state as canonical.'
    );
    expect(roadmap).toContain(
      'No Mission 23 row may become a second authority for a field that an earlier'
    );
  });

  test('pins tenant, revision, digest, idempotency, attribution, audit, and authorization rules', () => {
    for (const required of [
      'all relationships use\n  tenant-composite foreign keys',
      'gap-free monotonically increasing revision',
      'SHA-256 digest over one recursively canonical, NFC-normalized, bounded UTF-8',
      'An idempotency key is required for every mutation.',
      'Current state, immutable event/revision evidence, individual attribution,',
      '`recordedBy` and `performedBy` are separate',
      'Request claims cannot grant any of them.',
      'Writes use serializable transactions, database-owned locks and time',
      'No route acknowledges success before the authoritative transaction commits.',
    ]) {
      expect(roadmap).toContain(required);
    }
  });

  test('keeps operational axes and every evidence domain explicit', () => {
    for (const state of [
      '`not_started`', '`in_progress`', '`paused`', '`blocked`',
      '`completion_pending`', '`completed`', '`reopened`', '`cancelled`',
    ]) {
      expect(roadmap).toContain(state);
    }
    for (const heading of [
      '### Labor and time',
      '### Materials and inventory usage',
      '### Equipment, vehicle, and machinery operations',
      '### Checklists, inspections, photos, notes, and field evidence',
      '### Progress, blockers, exceptions, and change-order facts',
      '### Completion and reopening',
    ]) {
      expect(roadmap).toContain(heading);
    }
    expect(roadmap).toContain(
      'Target, schedule, dispatch, execution lifecycle, progress, blockers, quality,'
    );
    expect(roadmap).toContain(
      'A Mission 23 change fact is not an approved commercial change order'
    );
    expect(roadmap).toContain(
      'Completion is an explicit two-stage proposal and approval'
    );
  });

  test('keeps owner and worker experiences mounted while browser state remains non-authoritative', () => {
    expect(roadmap).toContain('The worker experience extends the current scoped Today model');
    expect(roadmap).toContain('The owner/administrator experience shows tenant-wide work state');
    expect(roadmap).toContain(
      'Offline\n  device data is a local draft until a server acknowledgement returns the exact'
    );
    expect(roadmap).toContain('Desktop, tablet, 390/320 CSS px mobile, 200/400 percent zoom/reflow');
    expect(roadmap).toContain(
      'Any resulting receipt is labelled **agent visual acceptance**, never founder'
    );
  });

  test('keeps Polaris advisory-only and downstream mission ownership intact', () => {
    expect(roadmap).toContain('AI/provider output is advisory and non-authoritative.');
    expect(roadmap).toContain(
      'It cannot start, pause,\n  complete, reopen, assign, dispatch, approve a change'
    );
    expect(roadmap).toContain('Mission 28 owns any future automation.');

    const ownershipRows = [
      ['Mission 20', 'Business Profile, workforce structure'],
      ['Mission 21', 'Knowledge registry'],
      ['Mission 22', 'Assignment, schedule, dispatch'],
      ['**Mission 23**', 'Actual field execution'],
      ['Mission 24', 'Human-approved price, estimate, quote'],
      ['Mission 25', 'Tenant-private outcome learning'],
      ['Mission 26', 'Predictive business intelligence'],
      ['Mission 27', 'Customer financial lifecycle'],
      ['Mission 28', 'Owner-controlled automation'],
      ['Mission 29', 'Enterprise governance'],
      ['Mission 30', 'Integrated operating-system composition'],
      ['Mission 31', 'Isolated simulation'],
      ['Mission 32', 'Manual Scenario Calculator'],
    ];
    for (const [mission, authority] of ownershipRows) {
      expect(roadmap).toContain(`| ${mission} | ${authority}`);
    }
  });

  test('retains database, security, file, privacy, accessibility, and release gates', () => {
    for (const required of [
      'migrations 001–037 remain byte-for-byte',
      'Cross-tenant IDs, stale sessions, inactive workers, changed crews, revoked',
      'extension/MIME/magic-byte agreement',
      'quarantine/malware disposition',
      'Employee monitoring, timekeeping, wage/overtime, worker classification,',
      'No live provider, credential, storage bucket, map, telematics feed, email/SMS,',
      'Semantic headings/landmarks, labels/instructions, programmatic names and',
      'Installed Chrome and actual Playwright WebKit are browser evidence; WebKit is',
      'one draft PR, ordinary additive commits, and then a different fresh read-only',
      'Unavailable evidence is not a pass.',
    ]) {
      expect(roadmap).toContain(required);
    }
  });

  test('requires complete migration release evidence for every applicable Part 2–12 release', () => {
    for (const required of [
      'Every Part 2–12 candidate release records whether its exact diff adds a\n  migration.',
      'Git blob object ID, byte\n  count, and SHA-256 over the bytes returned by `git cat-file blob`',
      'authoritative migration history and reconciles its\n  sequence and recorded checksums',
      '`TimeZone = UTC`, locale, and\n  timestamp/default-expression compatibility',
      'same automatic migration runner and invocation used by the sole production',
      'new migration applies exactly once, creates one matching ledger entry',
      'second runner\n  invocation and an application restart must both be zero-op',
      'dated,\n  relevant backup receipt plus a restore rehearsal into an isolated database',
      'explicitly choose a forward fix or\n  an application rollback',
      'Without that disposition, ready,\n  merge, and deployment are blocked.',
      'requires separate founder authorization and remains an unavailable',
    ]) {
      expect(roadmap).toContain(required);
    }

    expect(requirementLedger).toContain('| Parts 2–12 migration release proof |');
    expect(requirementLedger).toContain('production automatic runner, exact-once application');
    expect(unavailableLedger).toContain('Exact new-migration Git-blob/SHA-256 identity');
    expect(unavailableLedger).toContain(
      'missing exact\nidentity, authoritative production history/UTC compatibility'
    );
    expect(unavailableLedger).toContain('separate founder-authorized\nrisk disposition');
    expect(unavailableLedger).toContain('No destructive database rollback is assumed.');

    expect(part2MigrationIdentity).toContain('`migrations/038_canonical_field_execution_authority.sql`');
    expect(part2MigrationIdentity).toContain('`9601ae8219f29da02440282dd9a5a3b13076ed34`');
    expect(part2MigrationIdentity).toContain('`65393` bytes');
    expect(part2MigrationIdentity).toContain('`84a0b65ec8cd01ff97043b66a543e30540e9a0bbb68a48c4b49415db3b766724`');
    expect(part2RequirementLedger).toContain('Fresh automatic application');
    expect(part2RequirementLedger).toContain('Interrupted upgrade transaction, retry, exact-once ledger, and zero-op');
    expect(part2RequirementLedger).toContain(
      'Exact replay returns the stored response only after current authority revalidation'
    );
    expect(part2RequirementLedger).toContain(
      'PostgreSQL account, security, and role-authority regression'
    );
    expect(part2ProductionReceipt).toContain('`2026-09-04T06:02:10.065Z`');
    expect(part2ProductionReceipt).toContain('`71cd80bd17bd28870ce71316543036fe0934d8f2`');
    expect(part2ProductionReceipt).toContain('`9601ae8219f29da02440282dd9a5a3b13076ed34`');
    expect(part2ProductionReceipt).toContain('65,393 bytes');
    expect(part2ProductionReceipt).toContain('`84a0b65ec8cd01ff97043b66a543e30540e9a0bbb68a48c4b49415db3b766724`');
    expect(part2ProductionReceipt).toContain('PostgreSQL `18.6`');
    expect(part2ProductionReceipt).toContain('35 authoritative `_migrations` ledger rows');
    expect(part2ProductionReceipt).toMatch(/zero checksum\s+mismatches/);
    expect(part2ProductionReceipt).toContain('No customer/private business row was accessed.');
    expect(part2ProductionReceipt).toContain('No destructive down migration or data deletion is authorized.');
    expect(part2UnavailableLedger).toContain('second-start runner zero-\n  op');
    expect(part2UnavailableLedger).toContain('they are no longer unavailable');
    expect(part2UnavailableLedger).toContain('Backup/restore rehearsal remains unavailable');
    expect(part2UnavailableLedger).toContain('authorized conservative release disposition');
  });
});
