'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
const migration = read('migrations', '042_canonical_material_inventory_evidence.sql');
const correctionMigration = read('migrations', '043_canonical_material_inventory_audit_corrections.sql');
const snapshotFenceMigration = read(
  'migrations', '044_canonical_material_authority_snapshot_fence.sql'
);
const upgradeFenceMigration = read(
  'migrations', '045_canonical_material_authority_upgrade_fence.sql'
);
const unicodeContractSource = read('src', 'operations', 'materialTextUnicodeContract.json');
const unicodeContract = JSON.parse(unicodeContractSource);
const contract = read('src', 'operations', 'contract.js');
const boundary = read('src', 'operations', 'httpBoundary.js');
const repository = read('src', 'operations', 'repository.js');
const routes = read('src', 'routes', 'fieldExecutions.js');
const db = read('src', 'db.js');
const roadmap = read('docs', 'roadmap', 'MISSION_23_OPERATIONS.md');
const requirements = read('outputs', 'm23-part4-writer', 'REQUIREMENT_TO_EVIDENCE.md');
const unavailable = read('outputs', 'm23-part4-writer', 'UNAVAILABLE_EVIDENCE.md');
const corrections = read('outputs', 'm23-part4-writer', 'CORRECTION_CHANGELOG.md');
const migrationIdentity = read('outputs', 'm23-part4-writer', 'MIGRATION_IDENTITY.md');
const correctionMigrationIdentity = read(
  'outputs', 'm23-part4-writer', 'MIGRATION_043_IDENTITY.md'
);
const snapshotFenceMigrationIdentity = read(
  'outputs', 'm23-part4-writer', 'MIGRATION_044_IDENTITY.md'
);
const upgradeFenceMigrationIdentity = read(
  'outputs', 'm23-part4-writer', 'MIGRATION_045_IDENTITY.md'
);
const productionReadiness = read(
  'outputs', 'm23-part4-writer', 'PRODUCTION_MIGRATION_READINESS_RECEIPT.md'
);
const laterStart = read('outputs', 'm23-part3-writer', 'LATER_START_ZERO_OP_RECEIPT.md');
const historyInspector = read('scripts', 'inspect-production-migration-history.js');
const packageManifest = JSON.parse(read('package.json'));

const UNIT_VERSION = 'm23-material-unit-v1';
const UNIT_DIGEST = '8fcbf0c5a646dbd199e6fa8a93f863d851fab24d83c7a819ed65573c22761eba';

describe('Mission 23 Part 4 material and inventory-usage evidence boundary', () => {
  test('pins the exact base, closes Part 3 truthfully, and keeps Part 4 at writer gate', () => {
    expect(requirements).toContain('`961245ebd12a28d2c7aa1c0b3e003530e4428f09`');
    expect(requirements).toContain('`666a1a385a93a5baad31e77e2e5ed89d5ebd18ef`');
    expect(laterStart).toContain('`2abef4be3e31c2c468762598edc0e79859f67c2f`');
    expect(laterStart).toContain('`15c61f89e4dd52ae768f1d30d1d6a3808c2d7ec5`');
    expect(laterStart).toContain('`2b498fe1-d025-4be7-bd90-cef6154f9bb8`');
    expect(roadmap).toContain('Part 3\'s later-start gate is therefore achieved rather than pending.');
    expect(roadmap).toContain('**Part 4: audit-correction writer candidate in progress after the first');
    expect(roadmap).toContain('Daybreak exact-head re-audit');
    expect(roadmap).toContain('**Parts 5–12: not implemented.**');
    expect(unavailable).toContain('This is a writer candidate.');
  });

  test('creates tenant-composite current, immutable history, audit, and replay evidence', () => {
    for (const table of [
      'canonical_material_movements', 'canonical_material_events',
      'canonical_material_revisions', 'canonical_material_audit_events',
      'canonical_material_idempotency',
    ]) expect(migration).toContain(`CREATE TABLE public.${table}`);
    for (const source of [
      'canonical_field_executions(organization_id,execution_id)',
      'canonical_schedule_assignments(organization_id,assignment_id)',
      'workforce_profiles(organization_id,performer_profile_id)',
    ]) {
      const [table, keys] = source.split('(');
      expect(migration).toContain(`REFERENCES public.${table}(organization_id,`);
      expect(keys).toBeTruthy();
    }
    expect(migration).toContain('CREATE CONSTRAINT TRIGGER canonical_material_complete_after_current');
    expect(migration).toContain("CONSTRAINT='canonical_material_evidence_incomplete'");
    expect(migration.match(/BEFORE UPDATE OR DELETE OR TRUNCATE/g)).toHaveLength(4);
    expect(migration).toContain('CREATE UNIQUE INDEX canonical_material_one_reversal');
  });

  test('pins versioned unit grammar, bounded decimal quantities, and no conversion', () => {
    for (const source of [contract, migration, roadmap, requirements]) {
      expect(source).toContain(UNIT_VERSION);
      expect(source).toContain(UNIT_DIGEST);
    }
    expect(contract).toContain('M23_MATERIAL_UNIT_CONTRACT_STALE');
    expect(migration).toContain("value !~ '^(0|[1-9][0-9]{0,11})([.][0-9]{1,6})?$'");
    expect(migration).toContain('999999999999.999999::NUMERIC');
    expect(migration).toContain("'conversionPolicy','none'");
    expect(migration).toContain("'conversionApplied',FALSE");
  });

  test('freezes migration 042 by exact commit, tree, blob, bytes, and SHA-256', () => {
    for (const value of [
      '5e91449f3655dcfe9eec7cd0086a5a9c440c0f64',
      '23f626170471804c551e51d4bd6c1822f91fbea8',
      '8adb615f30626fe940ab7e444727184fed5bfe9b',
      '70623',
      '5efac96a5c275f58e56b117cdae135d4f16ce4847cccdbab8de580b5a3c1d6c4',
    ]) expect(migrationIdentity).toContain(value);
    expect(migrationIdentity).toContain('Migration\n042 must remain byte-for-byte unchanged');
  });

  test('freezes forward-only migration 043 without rewriting migration 042', () => {
    for (const value of [
      'd6fc5fa5aaa66906e40413e912b0881a7e50f2c4',
      'c9cb884eb5dd4980a08fa9e5e714ac925137c046',
      '90379f78425cbe476ab8406e2bed33c6c575d16a',
      '16,936',
      '9f9d43d1d631953203a0d45accdfc757f3ce005a81cd4915c06bf2c3fd6ec228',
      '8adb615f30626fe940ab7e444727184fed5bfe9b',
      '5efac96a5c275f58e56b117cdae135d4f16ce4847cccdbab8de580b5a3c1d6c4',
    ]) expect(correctionMigrationIdentity).toContain(value);
    expect(correctionMigrationIdentity).toContain('A new SELECT-only\nproduction-history check');
  });

  test('freezes forward-only migration 044 without rewriting migrations 042 or 043', () => {
    for (const value of [
      'f8bbf55080af2a3e617124f12ee658fd544a46f0',
      '01e9e3edc00053e496c8379d05afde2be831154c',
      '1cf68d95f77e717ebb34c1d50c05cceb658bd135',
      '3,995',
      '8d4c895fb06d5b0dc49ee968ad64d777efa9d1b861094f00571170e4d6e6b32d',
      '90379f78425cbe476ab8406e2bed33c6c575d16a',
      '9f9d43d1d631953203a0d45accdfc757f3ce005a81cd4915c06bf2c3fd6ec228',
    ]) expect(snapshotFenceMigrationIdentity).toContain(value);
    expect(snapshotFenceMigrationIdentity).toContain('Migrations 001–043 remain byte-for-byte unchanged.');
  });

  test('freezes forward-only migration 045 without rewriting migrations 042 through 044', () => {
    for (const value of [
      'e3912055f48d263acd2f43c572f05431fefdf80e',
      '865820d32fca9364ce4ec2fc350bdf6a5b1c23b6',
      'e54f935d6a6648479226005ff7a45e7278527d52',
      '2,050',
      '24b8249c0b686b497e5251516f9a7663947ee6ac491fe9d132fb3b8bc020e9ee',
      '1cf68d95f77e717ebb34c1d50c05cceb658bd135',
      '8d4c895fb06d5b0dc49ee968ad64d777efa9d1b861094f00571170e4d6e6b32d',
    ]) expect(upgradeFenceMigrationIdentity).toContain(value);
    expect(upgradeFenceMigrationIdentity).toContain('Migrations 001–044 remain byte-for-byte unchanged.');
  });

  test('provides a bounded credential-silent read-only production-history inspector', () => {
    expect(packageManifest.scripts['inspect:production-migrations'])
      .toBe('node scripts/inspect-production-migration-history.js');
    expect(historyInspector).toContain("await client.query('BEGIN READ ONLY')");
    expect(historyInspector).toContain("SET LOCAL statement_timeout = '5000ms'");
    expect(historyInspector).toContain('FROM pg_catalog.pg_database database');
    expect(historyInspector).toContain('FROM public._migrations');
    expect(historyInspector).toContain('LIMIT ${MAX_MIGRATIONS + 1}');
    expect(historyInspector).toContain("process.stderr.write('Production migration-history inspection failed.\\n')");
    expect(historyInspector).not.toMatch(/console\.log|process\.stdout\.write\([^)]*(?:DATABASE_URL|connectionString)|password|credential/i);
  });

  test('records exact production-history compatibility without claiming application', () => {
    for (const value of [
      'a568b08c9ffc7dd353864fffe2f2d07f2c5cb1ee',
      '18.6 (Debian 18.6-1.pgdg13+2)',
      'TimeZone = Etc/UTC',
      'sourceMigrationCount = 40',
      'appliedMigrationCount = 39',
      'appliedWithoutSource = []',
      'duplicateApplied = []',
      'mismatches = []',
      '042_canonical_material_inventory_evidence.sql',
      '8adb615f30626fe940ab7e444727184fed5bfe9b',
      '5efac96a5c275f58e56b117cdae135d4f16ce4847cccdbab8de580b5a3c1d6c4',
      'DATABASE_PUBLIC_URL',
    ]) expect(productionReadiness).toContain(value);
    expect(productionReadiness).toContain('failed closed with\nits generic error');
    expect(productionReadiness).toContain('printed or mutated');
    expect(productionReadiness).toContain('does not\nprove application');
    expect(requirements).toContain('exact-final-source production preflight and recovery remain unavailable');
    expect(unavailable).toContain('production-history compatibility preflight passed');
    expect(unavailable).toContain('does not prove production');
    expect(unavailable).toContain('predates forward-only migrations 043 through 045');
  });

  test('limits actions and movement facts to Part 4 vocabulary', () => {
    for (const value of ['record', 'correct', 'review', 'reverse']) {
      expect(contract).toContain(`'${value}'`);
      expect(migration).toContain(`'${value}'`);
    }
    for (const value of ['adjustment', 'consumed', 'returned', 'transferred', 'waste']) {
      expect(contract).toContain(`'${value}'`);
      expect(migration).toContain(`'${value}'`);
    }
    expect(migration).toContain("effective_entry:='reversal'");
    expect(migration).toContain("effective_review:='needs_review'");
    expect(migration).toContain("movement_kind_value='transferred'");
  });

  test('reauthorizes current appointment, assignment, dispatch, actor, performer, crew, and source', () => {
    expect(migration).toContain('public.canonical_field_execution_actor_authority(');
    expect(migration).toContain('public.canonical_field_execution_actor_in_scope(');
    expect(migration).toContain('public.canonical_field_execution_replay_authorized(');
    expect(migration).toContain("assignment_record.target_state<>'assigned'");
    expect(migration).toContain("assignment_record.dispatch_state<>'dispatched'");
    expect(migration).toContain("lower(btrim(appointment.status)) NOT IN ('cancelled','completed')");
    expect(migration).toContain('public.canonical_labor_transcript_source_normalized(transcript.source)');
    expect(migration).toContain("IN ('lead','retell','voice')");
    expect(migration).toContain('FROM public.workforce_crew_members cm');
    expect(migration).toContain("om.status='active' AND u.status='active'");
  });

  test('uses serializable/idempotent writes and bounded semantically read-only snapshots', () => {
    expect(repository).toContain('return serializable(pool, async client =>');
    const materialReadSource = repository.slice(
      repository.indexOf('async function readMaterialInventory'),
      repository.indexOf('module.exports')
    );
    expect(materialReadSource).toContain('BEGIN ISOLATION LEVEL REPEATABLE READ');
    expect(materialReadSource).not.toContain('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(materialReadSource).toContain('This transaction remains semantically read-only');
    expect(repository).toContain("SET LOCAL statement_timeout='5000ms'");
    expect(migration).toContain("current_setting('transaction_isolation')<>'serializable'");
    expect(migration).toContain('pg_advisory_xact_lock');
    expect(migration).toContain('canonical_material_idempotency_conflict');
    expect(migration).toContain('canonical_material_balance_overflow');
    expect(migration).toContain('LIMIT 200');
  });

  test('mounts only strict bounded material mutation/read routes', () => {
    expect(boundary).toContain('MATERIAL_ACTION_PATH');
    expect(boundary).toContain('MATERIAL_ACTION_PATH.exec(target)');
    expect(routes).toContain("router.post('/:executionId/material-actions'");
    expect(routes).toContain("router.get('/:executionId/materials'");
    expect(routes).toContain("res.set('Cache-Control', 'no-store, private')");
    expect(routes).toContain('normalizeMaterialReadQuery(req.query)');
    expect(contract).toContain('M23_MATERIAL_QUERY_INVALID');
    expect(routes).toContain('requestCorrelationId: requestId(req)');
    expect(contract).toContain('normalizeMaterialAction');
    expect(contract).toContain('INVALID_MATERIAL_QUANTITY');
    expect(contract).toContain('INVALID_MATERIAL_TEXT');
  });

  test('closes all five audit findings in forward-only migration 043', () => {
    expect(correctionMigration).toContain('Migration 042 remains byte-for-byte frozen');
    expect(correctionMigration).toContain('expected_execution_revision_value IS NULL');
    expect(correctionMigration).toContain('expected_execution_digest_value IS NULL');
    expect(correctionMigration).toContain('expected_assignment_revision_value IS NULL');
    expect(correctionMigration).toContain('expected_assignment_digest_value IS NULL');
    expect(correctionMigration).toContain('expected_movement_revision_value IS NULL');
    expect(correctionMigration).toContain('expected_movement_digest_value IS NULL');
    expect(correctionMigration).toContain("held.locktype='advisory'");
    expect(correctionMigration).toContain('held.pid=pg_catalog.pg_backend_pid()');
    expect(correctionMigration).toContain('canonical_material_authority_changed');
    expect(correctionMigration).toContain('pg_advisory_xact_lock(230004,4)');
    expect(correctionMigration).toContain('FOR EACH STATEMENT EXECUTE FUNCTION');
    for (const relation of [
      'auth_sessions','subscriptions','organization_onboarding','users',
      'organization_memberships','workforce_profiles','workforce_crew_members',
      'canonical_transcripts','canonical_appointments','canonical_schedule_assignments',
      'canonical_field_executions',
    ]) expect(correctionMigration).toContain(`'${relation}'`);
    expect(repository).toContain('SELECT pg_advisory_lock_shared(230004,4)');
    expect(repository).toContain('SELECT pg_advisory_unlock_shared(230004,4)');
    const materialReadSource = repository.slice(
      repository.indexOf('async function readMaterialInventory'),
      repository.indexOf('module.exports')
    );
    expect(materialReadSource).toContain('BEGIN ISOLATION LEVEL REPEATABLE READ');
    expect(materialReadSource).not.toContain('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const materialSerializableSource = repository.slice(
      repository.indexOf('async function materialSerializable'),
      repository.indexOf('async function initializeFieldExecution'));
    expect(materialSerializableSource.indexOf('SELECT pg_advisory_lock_shared(230004,4)'))
      .toBeLessThan(materialSerializableSource.indexOf('BEGIN ISOLATION LEVEL SERIALIZABLE'));
    expect(correctionMigration).toContain("'{data,totalBalanceCount}'");
    expect(correctionMigration).toContain("'{data,balancePage}'");
    expect(correctionMigration).toContain('OFFSET balance_offset_value LIMIT balance_limit_value');
  });

  test('closes the stale-MVCC-snapshot finding in forward-only migration 044', () => {
    expect(snapshotFenceMigration).toContain('Migrations 042 and 043 remain');
    expect(snapshotFenceMigration).toContain('CREATE TABLE public.canonical_material_authority_fence');
    expect(snapshotFenceMigration).toContain('UPDATE public.canonical_material_authority_fence');
    expect(snapshotFenceMigration).toContain('FOR SHARE');
    expect(snapshotFenceMigration).toContain('WHEN serialization_failure THEN');
    expect(snapshotFenceMigration).toContain("CONSTRAINT='canonical_material_authority_changed'");
    expect(snapshotFenceMigration).toContain("held.mode='ExclusiveLock'");
    expect(snapshotFenceMigration).toContain("held.mode='ShareLock'");
    expect(snapshotFenceMigration).toContain('held.objsubid=2');
    expect(snapshotFenceMigration).toContain('REVOKE ALL ON TABLE public.canonical_material_authority_fence FROM PUBLIC');
    expect(db).toContain("'canonical_material_authority_fence'");
    expect(db).toContain("NOT has_table_privilege($1,'public.canonical_material_authority_fence','SELECT')");
  });

  test('closes the rolling-upgrade writer gap in forward-only migration 045', () => {
    expect(upgradeFenceMigration).toContain('Migrations 042-044 remain');
    expect(upgradeFenceMigration).toContain('IN SHARE ROW EXCLUSIVE MODE NOWAIT');
    expect(upgradeFenceMigration).toContain('attempt>=200');
    expect(upgradeFenceMigration).toContain('pg_catalog.pg_sleep(0.05)');
    expect(upgradeFenceMigration).toContain("CONSTRAINT='canonical_material_authority_upgrade_busy'");
    expect(upgradeFenceMigration).toContain('pg_catalog.pg_advisory_xact_lock(230004,4)');
    expect(upgradeFenceMigration).toContain('UPDATE public.canonical_material_authority_fence');
    expect(db).toContain("migration.file === '045_canonical_material_authority_upgrade_fence.sql'");
    expect(db).toContain('Number(upgradeTimeouts.lock_timeout) || 5000');
    expect(db).toContain('Number(upgradeTimeouts.statement_timeout) || 20000');
    for (const relation of [
      'auth_sessions','subscriptions','organization_onboarding','users',
      'organization_memberships','workforce_profiles','workforce_crew_members',
      'canonical_transcripts','canonical_appointments','canonical_schedule_assignments',
      'canonical_field_executions',
    ]) expect(upgradeFenceMigration).toContain(`public.${relation}`);
  });

  test('shares one versioned code-point Unicode contract across JS and PostgreSQL', () => {
    expect(unicodeContract).toMatchObject({
      version: 'm23-material-text-unicode-v1', maximumCodePoints: 500, maximumUtf8Bytes: 2000,
    });
    expect(contract).toContain("require('./materialTextUnicodeContract.json')");
    expect(contract).toContain('codePointAt(0)');
    expect(correctionMigration).toContain(unicodeContract.version);
    expect(correctionMigration).toContain('ascii(substr(value,position_value,1))');
    expect(correctionMigration).toContain('0280502fc832fce9ff2daccb962f3a8a9de36e202441406257d910dce535b74b');
    expect(crypto.createHash('sha256').update(Buffer.from(unicodeContractSource, 'utf8')).digest('hex'))
      .toBe('0280502fc832fce9ff2daccb962f3a8a9de36e202441406257d910dce535b74b');
    for (const label of ['currency','Han','ordinary emoji','soft hyphen',
      'unpaired surrogate','interlinear annotation','object replacement',
      'replacement character','tag character']) {
      expect(unicodeContract.corpus.map(row => row.label)).toContain(label);
    }
  });

  test('enforces runtime EXECUTE-only entry authority', () => {
    expect(db).toContain('material_tables_withheld');
    expect(db).toContain('material_entry_execute');
    expect(db).toContain('material_helpers_withheld');
    expect(db).toContain('canonical_material_inventory_mutate');
    expect(db).toContain('canonical_material_inventory_read');
    for (const table of [
      'canonical_material_movements', 'canonical_material_events',
      'canonical_material_revisions', 'canonical_material_audit_events',
      'canonical_material_idempotency', 'canonical_material_authority_fence',
    ]) expect(db).toContain(table);
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.canonical_material_inventory_mutate');
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.canonical_material_inventory_read');
  });

  test('makes stock/commercial/later-part exclusions explicit without adding such columns', () => {
    const movementTable = migration.match(
      /CREATE TABLE public\.canonical_material_movements \([\s\S]+?\n\);\n\nALTER TABLE/
    )[0];
    expect(movementTable).not.toMatch(/^\s+(?:stock|cost|value|supplier|price|quote|invoice|payment|profit)\w*\s+/m);
    for (const phrase of [
      'not physical stock existence', 'stock value', 'cost', 'procurement', 'pricing',
      'invoice', 'payment', 'profitability',
    ]) expect(migration).toContain(phrase);
    expect(roadmap).toContain('It adds no equipment/assets,');
    expect(roadmap).toContain('completion/reopening, UI, or later-part behavior.');
    expect(unavailable).toContain('No equipment/vehicle/machinery');
  });

  test('preserves backend-only visual boundary and records real writer corrections', () => {
    expect(roadmap).toContain('Part 4 changes no rendered\nfile');
    expect(unavailable).toContain('Part 9 must match or exceed');
    expect(unavailable).toContain('dark/light themes');
    expect(unavailable).toContain('Chrome, WebKit');
    expect(corrections).toContain('Current row lineage guard');
    expect(corrections).toContain('Read-current authority');
    expect(corrections).toContain('Daybreak exact-head re-audit — stale MVCC snapshot');
    expect(corrections).toContain('Independent bypass review — rolling-upgrade writer');
    expect(corrections).toContain('No correction changes migrations 001–044.');
  });

  test('records the future Part 5 exact-asset and universal-knowledge boundary without implementing it', () => {
    for (const phrase of [
      'generic truck, trailer, machine, or equipment placeholder is not accepted',
      'make, model, year, series, and relevant engine, configuration, and attachment',
      'pins a cited, versioned Mission 21 universal-knowledge',
      'provenance, confidence, and freshness evidence',
      'Serial/VIN, ownership, financing, condition, hours or mileage',
      'Unknown specifications/capabilities remain unknown or',
      'Profile **Vehicles & Equipment** `Add equipment` workflow',
      'Both call one\n  server-authoritative reviewed draft/research pipeline',
      'requires explicit confirmation\n  from an authorized tenant actor',
      '`POLARIS_OPENAI_ENABLED` and the server-only',
      'Model memory is never factual authority',
      'accessible expand/collapse, counts, and search/filter',
      'Assets saved through either entry path',
      'Part 9 still owns the full worker and',
    ]) expect(roadmap).toContain(phrase);
    expect(requirements).toContain('| Future Part 5 exact-asset boundary |');
    expect(requirements).toContain('adds no Part 5 runtime, UI, or live research authority');
    expect(unavailable).toContain('No equipment/vehicle/machinery');
    expect(routes).not.toMatch(/equipment|vehicle|machinery|maintenance/);
  });
});
