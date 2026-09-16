'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const migration = read('migrations/084_canonical_external_labor_import_authority.sql');

describe('Mission 25 Part 3 external labor import authority', () => {
  test('keeps tenant source consent, runs and record histories immutable and attributable', () => {
    for (const fragment of [
      'CREATE TABLE public.canonical_external_labor_import_consents',
      'CREATE TABLE public.canonical_external_labor_import_runs',
      'CREATE TABLE public.canonical_external_labor_import_records',
      'canonical_external_labor_import_consents_immutable', 'canonical_external_labor_import_runs_immutable',
      'canonical_external_labor_import_records_immutable',
      'FOREIGN KEY(organization_id,actor_user_id,auth_session_id)',
      'FOREIGN KEY(organization_id,source_key,consent_id)',
      'FOREIGN KEY(organization_id,source_key,import_run_id)',
    ]) expect(migration).toContain(fragment);
  });

  test('pins a bounded provider-neutral cursor and record-version contract', () => {
    for (const fragment of [
      "schema_version TEXT NOT NULL CHECK(schema_version='m25-external-labor-time-v1')",
      "mode TEXT NOT NULL CHECK(mode IN ('historical_backfill','continuous_update'))",
      'record_count INTEGER NOT NULL CHECK(record_count BETWEEN 1 AND 100)',
      "external_version BIGINT NOT NULL", 'cursor_before TEXT', 'cursor_after TEXT',
      'learning_import_cursor_stale', 'learning_import_record_conflict',
      'duplicate_count', 'corrected_count', 'tombstoned_count',
    ]) expect(migration).toContain(fragment);
  });

  test('requires current source consent and explicit confirmation at the database boundary', () => {
    for (const fragment of [
      "consent_version TEXT NOT NULL CHECK(consent_version='m25-external-labor-import-consent-v1')",
      "confirmation_version TEXT NOT NULL CHECK(confirmation_version='m25-external-labor-import-batch-v1')",
      'confirmed BOOLEAN NOT NULL CHECK(confirmed)', "body->'confirmed' IS DISTINCT FROM 'true'::jsonb",
      "consent_row.action<>'grant'", 'expectedConsentRevision', 'expectedConsentDigest',
    ]) expect(migration).toContain(fragment);
  });

  test('keeps imported evidence staged and withholds runtime tables and helpers', () => {
    const authority = read('src/learning/importDatabaseAuthority.js');
    const operations = read('docs/operations/MISSION_25_EXTERNAL_LABOR_IMPORTS.md');
    for (const entry of ['canonical_external_labor_import_consent_read',
      'canonical_external_labor_import_consent_mutate', 'canonical_external_labor_import_batch',
      'canonical_external_labor_import_read']) expect(authority).toContain(entry);
    expect(authority).toContain('tables_withheld'); expect(authority).toContain('helpers_withheld');
    expect(operations).toContain('Imported records do not write `canonical_labor_intervals`');
    expect(migration).not.toMatch(/(?:INSERT INTO|UPDATE) public\.canonical_labor_intervals/);
    expect(migration).not.toMatch(/UPDATE public\.(?:canonical_estimates|canonical_schedule_assignments|canonical_business_profiles)/);
  });

  test('documents revocation, tombstone and unfinished connector and reconciliation boundaries', () => {
    const roadmap = read('docs/roadmap/MISSION_25_OUTCOME_LEARNING.md');
    const inventory = read('docs/architecture/MISSION_25_LEARNING_SOURCE_INVENTORY.md');
    for (const fragment of ['Revocation blocks imports and hides the source projection',
      'not a completed vendor connector or owner import experience', 'reviewed entity matches']) expect(roadmap).toContain(fragment);
    for (const fragment of ['detail-free current record', 'No current record becomes a Mission 23 labor interval',
      'other source classes remain unimplemented']) expect(inventory).toContain(fragment);
  });
});
