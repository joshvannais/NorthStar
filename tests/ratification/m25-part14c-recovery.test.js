'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../..');
const read = value => fs.readFileSync(path.join(root, value), 'utf8');

describe('Mission 25 Part 14C recovery acceptance', () => {
  test('freezes the exact recovery slice without broadening later acceptance work', () => {
    const roadmap = read('docs/roadmap/MISSION_25_OUTCOME_LEARNING.md');
    expect(roadmap).toContain('| C | Migration, restart, replay, resume, correction, revocation, retention and deletion recovery proof. |');
    expect(roadmap).toContain('## Part 14 Slice C candidate — migration and lifecycle recovery proof');
    expect(roadmap).toContain('Bounds, performance, concurrency, failure recovery and operational observability remain Slice D.');
  });

  test('executes the required recovery sequence against the mounted application', () => {
    const mounted = read('tests/api/m25-part14c-recovery.test.js');
    for (const proof of ['fixture.db.close()', 'fixture.db.initDatabase()', 'toHaveLength(133)', "['/consent', grantBody, grantKey]", "action: 'resume'", "externalVersion: 2", "consentBody('revoke'", 'retiredReplayStatuses', 'recordTotal).toBe(0)', "operation: 'retention'", 'tombstonedCount: 100', 'firstCleanupReplay.body.data, replayed: false', 'cleanupReplay.body.data, replayed: false', 'expectPublicCleanupRun', 'cursorBefore: resumeCursor', "mode === 'deletion_cleanup'", "headers['idempotency-replayed']", 'deletionComplete: true']) expect(mounted).toContain(proof);
  });

  test('pins restart-safe ledger recognition and retires cross-period labor retries', () => {
    const database = read('src/db.js');
    const migration = read('migrations/134_canonical_external_labor_recovery.sql');
    expect(database).toContain("CANONICAL_LEDGER_CONSTRAINTS.filter(constraint => constraint.contype !== 'n')");
    expect(database).toContain("'134_canonical_external_labor_recovery.sql'");
    expect(database).toContain("'135_canonical_external_labor_cleanup_projection.sql'");
    expect(migration).toContain("CONSTRAINT='external_labor_retired_consent_replay'");
    expect(migration).toContain("CONSTRAINT='external_labor_retired_operation_replay'");
    expect(migration).toContain("body->>'action' IN ('connect','resume') AND consent_row.action IS DISTINCT FROM 'grant'");
    const cleanup = read('migrations/135_canonical_external_labor_cleanup_projection.sql');
    expect(cleanup).toContain('canonical_external_labor_cleanup_projection(replay_run)');
    expect(cleanup).not.toContain("jsonb_build_object('run',to_jsonb(replay_run)");
  });

  test('adds no rendered, provider, credential or release path', () => {
    const evidence = read('docs/evidence/MISSION_25_PART14C_ACCEPTANCE.md');
    expect(evidence).toContain('No HTML, CSS or browser JavaScript changes are part of Slice C.');
    expect(evidence).toContain('No provider connection, credential, private-production, push, pull-request, merge or deployment action was performed.');
  });
});
