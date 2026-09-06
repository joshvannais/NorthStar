'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const BASE = 'fce4000f22c08f5f74712d37439286a4c601b1a7';
const MIGRATION = 'migrations/049_canonical_completion_reopening_authority.sql';
const MIGRATION_BYTES = 79646;
const MIGRATION_SHA256 = '387188bf8aeaddef56f23eb7542a7a7c0efb05c55b9074cad045b0a0eecd2fdf';
const MIGRATION_BLOB = '038cfbc974399ec05ea2bf8ae31b5b53287adad0';
const read = name => fs.readFileSync(path.join(ROOT, name), 'utf8');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', args, { cwd: ROOT });

describe('Mission 23 Part 8 frozen completion and reopening contract', () => {
  test('preserves all 46 released migration blobs and adds only exact migration 049', () => {
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
  });

  test('the authority and evidence seals agree on exact base, migration, and writer-only status', () => {
    const authority = read('docs/operations/COMPLETION_REOPENING_AUTHORITY.md');
    const roadmap = read('docs/roadmap/MISSION_23_OPERATIONS.md');
    const identity = read('outputs/m23-part8-writer/MIGRATION_IDENTITY.md');
    for (const value of [BASE, MIGRATION_SHA256, MIGRATION_BLOB, String(MIGRATION_BYTES)]) {
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

  test('the candidate changes only the bounded backend, tests, authority docs, and writer evidence', () => {
    for (const name of ['package.json', 'package-lock.json']) {
      expect(hash(fs.readFileSync(path.join(ROOT, name)))).toBe(hash(git(['show', `${BASE}:${name}`])));
    }
    expect(git(['diff', '--name-only', BASE, '--', 'public', 'views', 'client', 'frontend', '.github'])
      .toString('utf8').trim()).toBe('');
    expect(git(['ls-files', '--others', '--exclude-standard', '--', 'public', 'views', 'client', 'frontend', '.github'])
      .toString('utf8').trim()).toBe('');
    for (const name of ['src/completion/contract.js', 'src/completion/repository.js',
      'src/completion/databaseAuthority.js', MIGRATION,
      'tests/integration/m23-part8-completion-postgres.test.js',
      'tests/integration/m23-part8-completion-migration.test.js']) {
      expect(fs.existsSync(path.join(ROOT, name))).toBe(true);
    }
  });
});
