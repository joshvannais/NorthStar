'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
const migration = read('migrations', '039_canonical_labor_time_evidence.sql');
const correctionMigration = read('migrations', '040_canonical_labor_time_audit_corrections.sql');
const sourceMigration = read('migrations', '041_canonical_labor_transcript_source_authority.sql');
const contract = read('src', 'operations', 'contract.js');
const boundary = read('src', 'operations', 'httpBoundary.js');
const repository = read('src', 'operations', 'repository.js');
const routes = read('src', 'routes', 'fieldExecutions.js');
const db = read('src', 'db.js');
const roadmap = read('docs', 'roadmap', 'MISSION_23_OPERATIONS.md');
const requirements = read('outputs', 'm23-part3-writer', 'REQUIREMENT_TO_EVIDENCE.md');
const unavailable = read('outputs', 'm23-part3-writer', 'UNAVAILABLE_EVIDENCE.md');
const corrections = read('outputs', 'm23-part3-writer', 'CORRECTION_CHANGELOG.md');
const productionReadiness = read(
  'outputs', 'm23-part3-writer', 'PRODUCTION_MIGRATION_READINESS_RECEIPT.md'
);
const productionApplication = read(
  'outputs', 'm23-part3-writer', 'PRODUCTION_APPLICATION_RECEIPT.md'
);

const CATEGORY_VERSION = 'm23-labor-category-v1';
const CATEGORY_DIGEST = '298ead37057f362ae32de59f23cfda8e9cae8f78dd0cd1e9c637cc525bc27738';

describe('Mission 23 Part 3 labor and time evidence boundary', () => {
  test('pins the exact deployed base and truthful candidate/release boundary', () => {
    expect(requirements).toContain('`e8c30f96d9c0bc0c4287c1f181a400e3cedd4748`');
    expect(roadmap).toContain('**Part 3: independently accepted, normally merged, automatically deployed,');
    expect(roadmap).toContain('later-start zero-op is\n  pending');
    expect(roadmap).toContain('**Parts 4–12: not implemented.**');
    expect(unavailable).toContain('Writer tests do not\n  substitute for them.');
    expect(productionApplication).toContain('Part 4 must not begin');
  });

  test('keeps categories explicit and versioned in JavaScript and PostgreSQL', () => {
    for (const value of ['break', 'cleanup', 'other', 'production', 'setup', 'travel']) {
      expect(contract).toContain(`'${value}'`);
      expect(migration).toContain(`'${value}'`);
    }
    expect(contract).toContain(`'${CATEGORY_VERSION}'`);
    expect(contract).toContain(`'${CATEGORY_DIGEST}'`);
    expect(migration).toContain(`category_contract_version='${CATEGORY_VERSION}'`);
    expect(migration).toContain(`rtrim(category_contract_digest)='${CATEGORY_DIGEST}'`);
    expect(migration).toContain("CONSTRAINT='canonical_labor_category_stale'");
  });

  test('creates tenant-composite exact-pinned immutable complete evidence', () => {
    for (const table of [
      'canonical_labor_intervals', 'canonical_labor_events',
      'canonical_labor_revisions', 'canonical_labor_audit_events',
      'canonical_labor_idempotency',
    ]) expect(migration).toContain(`CREATE TABLE public.${table}`);
    for (const source of [
      'canonical_field_executions(organization_id,id)',
      'canonical_schedule_assignments(organization_id,id)',
      'workforce_profiles(organization_id,id)',
      'canonical_business_profiles(organization_id,id)',
      'auth_sessions(organization_id,user_id,id)',
    ]) expect(migration).toContain(`REFERENCES public.${source} ON DELETE RESTRICT`);
    expect(migration).toContain('CREATE CONSTRAINT TRIGGER canonical_labor_complete_after_current');
    expect(migration).toContain("CONSTRAINT='canonical_labor_evidence_incomplete'");
    expect(migration.match(/BEFORE UPDATE OR DELETE OR TRUNCATE/g)).toHaveLength(4);
  });

  test('enforces timer/manual, tenant-zone, review, overlap, and current authority rules', () => {
    for (const action of ['start_timer', 'stop_timer', 'record_manual', 'correct', 'review']) {
      expect(contract).toContain(`'${action}'`);
      expect(migration).toContain(`'${action}'`);
    }
    for (const required of [
      "observed_start_value:=transaction_timestamp()",
      "observed_end_value:=transaction_timestamp()",
      "observed_end_value-observed_start_value>INTERVAL '16 hours'",
      "observed_end_value-observed_start_value>INTERVAL '31 days'",
      'FROM pg_catalog.pg_timezone_names',
      "CONSTRAINT='canonical_labor_overlap'",
      "CONSTRAINT='canonical_labor_timer_open'",
      'FROM public.workforce_crew_members',
    ]) expect(migration).toContain(required);
    for (const required of [
      "OR observed_end_value>transaction_timestamp()+INTERVAL '5 minutes'",
      "review_state_value<>'rejected' AND action_value IN " +
        "('start_timer','record_manual','correct','review')",
    ]) expect(correctionMigration).toContain(required);
    expect(sourceMigration).toContain(
      "canonical_labor_transcript_source_normalized(transcript.source) IN ('lead','retell','voice')"
    );
    expect(sourceMigration).toContain(
      "normalized_value NOT IN ('demo','lead','retell','simulation','voice')"
    );
    expect((sourceMigration.match(/canonical_labor_transcript_source_normalized\(transcript\.source\)/g) || []))
      .toHaveLength(2);
    expect(sourceMigration).not.toContain("lower(btrim(transcript.source))");
    expect(repository).toContain("'M23_LABOR_SOURCE_STALE'");
    expect(repository).toContain("'M23_LABOR_TIMER_ALREADY_OPEN'");
  });

  test('owns strict raw HTTP bytes and exposes only bounded labor endpoints', () => {
    expect(boundary).toContain('LABOR_ACTION_PATH');
    expect(boundary).toContain('/labor-actions');
    expect(routes).toContain("router.post('/:executionId/labor-actions'");
    expect(routes).toContain("router.get('/:executionId/labor'");
    expect(routes).toContain("res.set('Cache-Control', 'no-store, private')");
    expect(routes).toContain("code: 'M23_LABOR_UNAVAILABLE'");
    expect(contract).toContain("fail(400, 'INVALID_LABOR_ACTION', 'Labor action contains fields that do not apply.')");
    expect(contract).toContain("fail(428, 'M23_LABOR_PRECONDITION_REQUIRED'");
  });

  test('withholds tables/helpers and grants only the two entry points', () => {
    for (const table of [
      'canonical_labor_intervals', 'canonical_labor_events',
      'canonical_labor_revisions', 'canonical_labor_audit_events',
      'canonical_labor_idempotency',
    ]) expect(db).toContain(`public.${table}`);
    expect(db).toContain('GRANT EXECUTE ON FUNCTION public.canonical_labor_time_mutate');
    expect(db).toContain('GRANT EXECUTE ON FUNCTION public.canonical_labor_time_read');
    expect(db).toContain('labor_tables_withheld');
    expect(db).toContain('labor_helpers_withheld');
    expect(db).toContain('labor_entry_execute');
    expect(db).toContain('canonical_labor_transcript_source_normalized(text)');
  });

  test('distinguishes operational observations from financial and legal conclusions', () => {
    expect(migration).toContain('Operational evidence only: no payroll, wage, overtime, break-law, billing,');
    expect(roadmap).toContain('They are not payroll timecards, wages, billable hours, customer pricing,');
    expect(unavailable).toContain('`break` is only a versioned operational evidence');
    for (const forbiddenColumn of [
      /\bwage_(amount|rate)\b/i, /\bpayroll_(amount|rate)\b/i,
      /\bbillable_(amount|rate)\b/i, /\bcustomer_price\b/i,
    ]) expect(migration).not.toMatch(forbiddenColumn);
  });

  test('preserves the no-UI boundary and raises the Part 9 design minimum', () => {
    expect(roadmap).toContain('Part 3 changes no rendered surface.');
    expect(roadmap).toContain('Match\nor exceed the current deployed NorthStar design system');
    for (const quality of [
      'typography', 'spacing', 'radii', 'borders', 'cards/drawers',
      'responsive widths', 'controls', 'dark/light', 'mobile/desktop',
      'accessibility', 'Chrome', 'WebKit', 'visual inspection',
    ]) expect(roadmap).toContain(quality);
    expect(requirements).toContain('The candidate changes no `public`, `views`, browser, CSS, or UI files.');
    expect(corrections).toContain('No terminal correction changes protected migrations 001–040.');
    expect(correctionMigration).not.toContain('CREATE TABLE');
    expect(correctionMigration).not.toContain('CREATE VIEW');
    expect(sourceMigration).not.toContain('CREATE TABLE');
    expect(sourceMigration).not.toContain('CREATE VIEW');
  });

  test('migration identity receipt matches exact mutable bytes once frozen', () => {
    const identityPath = path.join(ROOT, 'outputs', 'm23-part3-writer', 'MIGRATION_IDENTITY.md');
    expect(fs.existsSync(identityPath)).toBe(true);
    const identity = fs.readFileSync(identityPath, 'utf8');
    const bytes = fs.readFileSync(path.join(ROOT, 'migrations', '039_canonical_labor_time_evidence.sql'));
    expect(identity).toContain(`Blob byte count: \`${bytes.length}\` bytes`);
    expect(identity).toContain(`\`${crypto.createHash('sha256').update(bytes).digest('hex')}\``);
    expect(identity).toContain('This identity was frozen from the committed Git object');
  });

  test('preserves the frozen 039 identity while adding a separately frozen 040', () => {
    const identity = read('outputs', 'm23-part3-writer', 'MIGRATION_040_IDENTITY.md');
    const bytes039 = fs.readFileSync(path.join(
      ROOT, 'migrations', '039_canonical_labor_time_evidence.sql'
    ));
    expect(crypto.createHash('sha256').update(bytes039).digest('hex'))
      .toBe('2204695c9be757a66094897f6bb9e86bee9c84f1582a3bc27812d7bbdebdf13a');
    const bytes040 = fs.readFileSync(path.join(
      ROOT, 'migrations', '040_canonical_labor_time_audit_corrections.sql'
    ));
    expect(identity).toContain(`Blob byte count: \`${bytes040.length}\` bytes`);
    expect(identity).toContain(
      `\`${crypto.createHash('sha256').update(bytes040).digest('hex')}\``
    );
    expect(identity).toContain('This identity was frozen from the committed Git object');
  });

  test('preserves frozen 039/040 while adding separately frozen 041 authority', () => {
    const identity = read('outputs', 'm23-part3-writer', 'MIGRATION_041_IDENTITY.md');
    const bytes040 = fs.readFileSync(path.join(
      ROOT, 'migrations', '040_canonical_labor_time_audit_corrections.sql'
    ));
    expect(crypto.createHash('sha256').update(bytes040).digest('hex'))
      .toBe('229b022a8fa70ac2daae05f2ffaf48016ecd77a50df29350cc9cd72221b6258b');
    const bytes041 = fs.readFileSync(path.join(
      ROOT, 'migrations', '041_canonical_labor_transcript_source_authority.sql'
    ));
    expect(identity).toContain(`Blob byte count: \`${bytes041.length}\` bytes`);
    expect(identity).toContain(
      `\`${crypto.createHash('sha256').update(bytes041).digest('hex')}\``
    );
    expect(identity).toContain('This identity was frozen from the committed Git object');
  });

  test('records exact read-only production history compatibility without claiming application', () => {
    expect(productionReadiness).toContain('`2026-09-04T10:35:08.764Z`');
    expect(productionReadiness).toContain('`716ecb5d52f021d644930ffacd0407037274b2ae`');
    expect(productionReadiness).toContain('`db96ba632aecea501fd9c1bda3c3dfebf139cad0`');
    expect(productionReadiness).toContain('PostgreSQL `18.6`');
    expect(productionReadiness).toContain('`TimeZone = Etc/UTC`');
    expect(productionReadiness).toContain('36 applied authoritative migration rows');
    expect(productionReadiness).toContain('37 candidate migration source files through 039');
    expect(productionReadiness).toContain('zero applied checksum/source checksum mismatches');
    expect(productionReadiness).toContain('exactly one unapplied source file');
    expect(productionReadiness).toContain('No private/customer row or credential was accessed.');
    expect(productionReadiness).toContain('performed no\nDDL, data, provider, configuration, or other production mutation');
    expect(productionReadiness).toContain('does not prove application');
    expect(productionReadiness).toContain('`b92036215618ef2b26804fc7fce300ea3d34f331`');
    expect(productionReadiness).toContain('36 applied migration rows versus 38 exact source');
    expect(productionReadiness).toContain('`appliedWithoutSource=[]`, `mismatches=[]`');
    expect(productionReadiness).toContain('It predates forward-only migration 041');
  });
});
