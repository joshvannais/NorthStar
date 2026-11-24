'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

describe('Mission 28 Part 14E PostgreSQL, worker and measurement contract', () => {
  test('publishes a bounded candidate without strengthening local evidence', () => {
    const artifact = JSON.parse(read(
      'docs/architecture/MISSION_28_PART14E_POSTGRES_WORKER_MEASUREMENTS.json'
    ));
    expect(artifact).toMatchObject({
      contractVersion: 'mission28.part14e.postgres-worker-measurements.v1',
      status: 'implementation_candidate_not_independently_accepted_not_released',
      base: {
        acceptedSourceHead: 'fd917d5459033e0af78fb65e1f368c31d33ef68c',
        acceptedTree: '7210b21b9aa42fbe67d01846ca87cc6d64aad656',
        mergedMain: 'cb2c68aac404bc055352c78853e8b3ce0d90982c',
        backupId: 'f42b41cb-596c-45a9-ad51-f83eb793e3ac',
      },
      scope: { part: '14E', sourceMigrationCount: 285, latestMigration: 289,
        migrationSha256: '65B5F20F73CDC88A18E73F8077FDAD50FC99CFBAFD9EE80ED1B82B558A86DCFB',
        nextMigrationAbsent: 290, genuineBrowserAcceptanceIncluded: false,
        releaseIncluded: false },
      runtimeReadAuthority: { directCanonicalTableAccessForRuntimeRole: false,
        publicExecute: false, createsAutomationOrExternalEffect: false },
      functionalMeasurement: { environment:
        'local_disposable_postgresql_functional_measurement_not_sla',
      absoluteDurationAssertions: false, productionPerformanceClaim: false,
      capacityPromise: false, slaClaim: false },
      effectBoundary: { realRecipients: 0, realProviderCalls: 0,
        paidAutomationTransactionsCreatedByDemo: 0, externalEffects: 0,
        financialEffects: 0, moneyEffects: 0, productionDataMutated: false },
    });
    expect(artifact.postgresEvidence.productionEvidence)
      .toBe('unavailable_pending_normal_release_and_migration');
    for (const key of ['highVolumeMountedMilliseconds', 'databasePoolRestartMilliseconds',
      'degradedFailureMilliseconds', 'degradedRecoveryMilliseconds',
      'housekeepingWorkerMilliseconds']) {
      expect(Number.isFinite(artifact.functionalMeasurement[key])).toBe(true);
      expect(artifact.functionalMeasurement[key]).toBeGreaterThanOrEqual(0);
    }
    expect(artifact.evidenceBoundary.writerEvidenceIndependent).toBe(false);
  });

  test('adds one private capability-checked read entry while storage remains withheld', () => {
    const migration = read('migrations/289_automation_center_runtime_read_authority_v1.sql');
    expect(crypto.createHash('sha256').update(migration).digest('hex').toUpperCase())
      .toBe('65B5F20F73CDC88A18E73F8077FDAD50FC99CFBAFD9EE80ED1B82B558A86DCFB');
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.canonical_automation_center_v1_read/);
    expect(migration).toMatch(/SECURITY DEFINER[\s\S]*canonical_field_execution_actor_authority/);
    expect(migration).toMatch(/actor_access_role_value NOT IN \('owner','admin'\)/);
    expect(migration).toMatch(/WHERE organization_id=organization_id_value/g);
    expect(migration).toMatch(/LIMIT 101/g);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.canonical_automation_center_v1_read\(UUID,UUID,TEXT,UUID\) FROM PUBLIC/);

    const db = read('src/db.js');
    expect(db).toContain("'GRANT EXECUTE ON FUNCTION ' ||");
    expect(db).toContain("'public.canonical_automation_center_v1_read(uuid,uuid,text,uuid) TO %I'");
    expect(db).toMatch(/automation_center_entry_execute/);
    expect(db).toMatch(/automation_authority_private/);
    const repository = read('src/automationCenter/repository.js');
    expect(repository).toMatch(/canonical_automation_center_v1_read\(\$1,\$2,\$3,\$4\)/);
    expect(repository).not.toMatch(/SELECT binding\.run_id/);
  });

  test('keeps mounted integration evidence executable and local-only', () => {
    const integration = read('tests/integration/m28-part14e-postgres-worker-measurements.test.js');
    for (const evidence of [
      'createDatabaseFixture', 'canonical_automation_center_v1_read',
      'HIGH_VOLUME_SESSIONS = 24', 'providerFixtureActions', 'db.close()',
      'DemoCommandCenterHousekeepingWorker', 'degradedFailureMilliseconds',
      'degradedRecoveryMilliseconds', 'paidAfterRestart',
    ]) expect(integration).toContain(evidence);
    expect(integration).toMatch(/expect\(unavailable\.body\).*success: false/s);
    expect(integration).toMatch(/canonical_automation_action_transactions_v1/);
    expect(integration).not.toMatch(/toBeLessThan\([^)]*Milliseconds/);
    expect(integration).not.toMatch(/https?:\/\/(?!northstar\.test)/);
  });
});
