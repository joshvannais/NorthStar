'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const BASE = 'fce4000f22c08f5f74712d37439286a4c601b1a7';
const AUDITED_HEAD = '13f9348312a354835b7a56eddc133d00492b7b53';
const MIGRATION = 'migrations/049_canonical_completion_reopening_authority.sql';
const MIGRATION_BYTES = 79646;
const MIGRATION_SHA256 = '387188bf8aeaddef56f23eb7542a7a7c0efb05c55b9074cad045b0a0eecd2fdf';
const MIGRATION_BLOB = '038cfbc974399ec05ea2bf8ae31b5b53287adad0';
const CORRECTION = 'migrations/050_canonical_completion_source_read_authority.sql';
const CORRECTION_BYTES = 4226;
const CORRECTION_SHA256 = '34c3765845fde3d57cb95a09f4bdd6e71f5e3e27ba09f1822438db8ac9dcb22e';
const CORRECTION_BLOB = '8775249791e51758998dc94b002970788d30d8a7';
const FINAL_CORRECTION = 'migrations/051_canonical_completion_type_and_provenance_authority.sql';
const FINAL_BYTES = 2961;
const FINAL_SHA256 = '2efc03578054a94ee0db22f2b603dd0d38df9584950e8cc94c5db315995c3f57';
const FINAL_BLOB = '88cc4e6b5674259951a6fcc6232a52e7f2653682';
const read = name => fs.readFileSync(path.join(ROOT, name), 'utf8');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', args, { cwd: ROOT });

describe('Mission 23 Part 8 frozen completion and reopening contract', () => {
  test('preserves all 48 audited migration blobs through 050 and adds exact migration 051', () => {
    const names = git(['ls-tree', '-r', '--name-only', BASE, 'migrations']).toString('utf8')
      .trim().split('\n').filter(name => name.endsWith('.sql'));
    expect(names).toHaveLength(46);
    for (const name of names) {
      expect(hash(fs.readFileSync(path.join(ROOT, name)))).toBe(hash(git(['show', `${BASE}:${name}`])));
    }
    const bytes = fs.readFileSync(path.join(ROOT, MIGRATION));
    expect(bytes.length).toBe(MIGRATION_BYTES);
    expect(hash(bytes)).toBe(MIGRATION_SHA256);
    expect(git(['hash-object', MIGRATION]).toString('utf8').trim()).toBe(MIGRATION_BLOB);

    const auditedNames = git(['ls-tree', '-r', '--name-only', AUDITED_HEAD, 'migrations'])
      .toString('utf8').trim().split('\n').filter(name => name.endsWith('.sql'));
    expect(auditedNames).toHaveLength(48);
    for (const name of auditedNames) {
      expect(hash(fs.readFileSync(path.join(ROOT, name)))).toBe(
        hash(git(['show', `${AUDITED_HEAD}:${name}`]))
      );
    }
    const correctionBytes = fs.readFileSync(path.join(ROOT, CORRECTION));
    expect(correctionBytes.length).toBe(CORRECTION_BYTES);
    expect(hash(correctionBytes)).toBe(CORRECTION_SHA256);
    expect(git(['hash-object', CORRECTION]).toString('utf8').trim()).toBe(CORRECTION_BLOB);
    const finalBytes = fs.readFileSync(path.join(ROOT, FINAL_CORRECTION));
    expect(finalBytes.length).toBe(FINAL_BYTES);
    expect(hash(finalBytes)).toBe(FINAL_SHA256);
    expect(git(['hash-object', FINAL_CORRECTION]).toString('utf8').trim()).toBe(FINAL_BLOB);
  });

  test('the authority and evidence seals agree on exact base, migration, and writer-only status', () => {
    const authority = read('docs/operations/COMPLETION_REOPENING_AUTHORITY.md');
    const roadmap = read('docs/roadmap/MISSION_23_OPERATIONS.md');
    const identity = read('outputs/m23-part8-writer/MIGRATION_IDENTITY.md');
    for (const value of [BASE, AUDITED_HEAD, MIGRATION_SHA256, MIGRATION_BLOB, String(MIGRATION_BYTES),
      CORRECTION_SHA256, CORRECTION_BLOB, String(CORRECTION_BYTES),
      FINAL_SHA256, FINAL_BLOB, String(FINAL_BYTES)]) {
      expect(identity).toContain(value);
    }
    expect(authority).toContain('Completion is a separately authorized operational decision.');
    expect(authority).toContain('`completionInferred: false`');
    expect(authority).toContain('Parts 9–12');
    expect(roadmap).toContain('**Part 7: independently accepted and normally merged through PR #171');
    expect(roadmap).toContain('**Part 8: implementation writer candidate; independent audit and release');
    expect(roadmap).toContain('**Parts 9–12: not implemented.**');
  });

  test('the database authority enumerates every explicit action and no inferred consequence', () => {
    const sql = read(MIGRATION);
    for (const action of ['propose_completion', 'approve_completion', 'withdraw_completion',
      'cancel_execution', 'reopen_execution', 'resume_reopened', 'correct_completion']) {
      expect(sql).toContain(`'${action}'`);
    }
    for (const state of ['completion_pending', 'completed', 'reopened', 'cancelled']) {
      expect(sql).toContain(`'${state}'`);
    }
    expect(sql).toContain("'completionInferred',FALSE");
    expect(sql).toContain("'hardGatesPassed',hard_passed");
    expect(sql).toContain("proposal_record.expires_at<=transaction_timestamp()");
    expect(sql).toContain('CREATE CONSTRAINT TRIGGER canonical_completion_complete');
    expect(sql).not.toMatch(/UPDATE\s+public\.canonical_(appointments|schedule_assignments)/i);
    expect(sql).not.toMatch(/(?:INSERT INTO|UPDATE|DELETE FROM)\s+public\.(?:canonical_)?(?:invoices|payments|customer_acceptances)/i);
  });

  test('the mounted source owns strict JSON bytes and grants only two database entry points', () => {
    const route = read('src/routes/fieldExecutions.js');
    const boundary = read('src/operations/httpBoundary.js');
    const grants = read('src/completion/databaseAuthority.js');
    const db = read('src/db.js');
    expect(route).toContain("router.post('/:executionId/completion-actions'");
    expect(route).toContain("router.get('/:executionId/completion'");
    expect(route).toContain("res.set('Cache-Control', 'no-store, private')");
    expect(boundary).toContain('COMPLETION_ACTION_PATH');
    expect(grants).toContain("new Set(['canonical_completion_mutate', 'canonical_completion_read'])");
    expect(grants).toContain('REVOKE ALL ON TABLE');
    expect(db).toContain("require('./completion/databaseAuthority').grantAndVerify");
  });

  test('the forward-only correction narrows only completion reads with the canonical source classifier', () => {
    const sql = read(CORRECTION);
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.canonical_completion_read(');
    expect(sql.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(1);
    expect(sql).toContain('public.canonical_labor_transcript_source_normalized(transcript.source)');
    expect(sql).toContain("IN ('lead','retell','voice')");
    expect(sql).toContain('canonical_field_execution_replay_authorized');
    expect(sql).toContain('canonical_completion_not_found');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.canonical_completion_read');
    expect(sql).not.toContain('lower(btrim(transcript.source))');
    expect(sql).not.toMatch(/(?:INSERT INTO|UPDATE|DELETE FROM|TRUNCATE)\s+public\./i);
  });

  test('the type wrapper precedes the private implementation and startup narrows transcript provenance privileges', () => {
    const sql = read(FINAL_CORRECTION);
    expect(sql).toContain('RENAME TO canonical_completion_mutate_v049');
    expect(sql).toContain("jsonb_typeof(input_value->'nextAction') IS DISTINCT FROM 'string'");
    expect(sql).toContain("jsonb_typeof(input_value->'annotation'->'note') IS DISTINCT FROM 'string'");
    expect(sql).toContain("jsonb_typeof(input_value->'annotation'->'nextAction') IS DISTINCT FROM 'null'");
    expect(sql.indexOf('RAISE EXCEPTION')).toBeLessThan(sql.indexOf('RETURN public.canonical_completion_mutate_v049'));
    expect(sql).toContain('canonical_completion_input_invalid');
    const grants = read('src/completion/transcriptDatabaseAuthority.js');
    expect(grants).toContain('REVOKE UPDATE, DELETE ON TABLE');
    expect(grants).toContain('has_column_privilege');
    expect(grants).toContain('GRANT UPDATE (transcript_text)');
    expect(read('src/db.js')).toContain("require('./completion/transcriptDatabaseAuthority').grantAndVerify");
  });

  test('the candidate changes only the bounded backend, tests, authority docs, and writer evidence', () => {
    for (const name of ['package.json', 'package-lock.json']) {
      expect(git(['hash-object', name]).toString('utf8').trim())
        .toBe(git(['rev-parse', `${BASE}:${name}`]).toString('utf8').trim());
    }
    expect(git(['diff', '--name-only', BASE, '--', 'public', 'views', 'client', 'frontend', '.github'])
      .toString('utf8').trim()).toBe('');
    expect(git(['ls-files', '--others', '--exclude-standard', '--', 'public', 'views', 'client', 'frontend', '.github'])
      .toString('utf8').trim()).toBe('');
    for (const name of ['src/completion/contract.js', 'src/completion/repository.js',
      'src/completion/databaseAuthority.js', 'src/completion/transcriptDatabaseAuthority.js',
      MIGRATION, CORRECTION, FINAL_CORRECTION,
      'tests/integration/m23-part8-completion-postgres.test.js',
      'tests/integration/m23-part8-completion-migration.test.js',
      'tests/integration/m23-part8-completion-source-migration.test.js',
      'tests/integration/m23-part8-completion-type-migration.test.js']) {
      expect(fs.existsSync(path.join(ROOT, name))).toBe(true);
    }
  });
});
