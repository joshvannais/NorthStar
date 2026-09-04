'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
const migration = read('migrations', '042_canonical_material_inventory_evidence.sql');
const contract = read('src', 'operations', 'contract.js');
const boundary = read('src', 'operations', 'httpBoundary.js');
const repository = read('src', 'operations', 'repository.js');
const routes = read('src', 'routes', 'fieldExecutions.js');
const db = read('src', 'db.js');
const roadmap = read('docs', 'roadmap', 'MISSION_23_OPERATIONS.md');
const requirements = read('outputs', 'm23-part4-writer', 'REQUIREMENT_TO_EVIDENCE.md');
const unavailable = read('outputs', 'm23-part4-writer', 'UNAVAILABLE_EVIDENCE.md');
const corrections = read('outputs', 'm23-part4-writer', 'CORRECTION_CHANGELOG.md');
const laterStart = read('outputs', 'm23-part3-writer', 'LATER_START_ZERO_OP_RECEIPT.md');

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
    expect(roadmap).toContain('**Part 4: writer implementation candidate in progress; not independently');
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

  test('uses serializable/idempotent writes and bounded read-only snapshots', () => {
    expect(repository).toContain('return serializable(pool, async client =>');
    expect(repository).toContain('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
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
    expect(routes).toContain('M23_MATERIAL_QUERY_FORBIDDEN');
    expect(routes).toContain('requestCorrelationId: requestId(req)');
    expect(contract).toContain('normalizeMaterialAction');
    expect(contract).toContain('INVALID_MATERIAL_QUANTITY');
    expect(contract).toContain('INVALID_MATERIAL_TEXT');
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
      'canonical_material_idempotency',
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
    expect(corrections).toContain('No correction changes migrations 001–041.');
  });
});
