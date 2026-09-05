'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');

const real = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

real('Mission 23 Part 6 additive migration lifecycle', () => {
  let database, pool, preceding;
  beforeAll(async () => {
    database = await createSuiteDatabase('m23p6-migration');
    pool = new Pool({ connectionString: database.connectionString });
    preceding = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-field-evidence-pre047-'));
    const migrations = path.resolve(__dirname, '../../migrations');
    for (const name of fs.readdirSync(migrations).filter(name => name.endsWith('.sql') && Number(name.slice(0, 3)) < 47)) {
      fs.copyFileSync(path.join(migrations, name), path.join(preceding, name));
    }
    await require('../../src/db').runMigrations({ pool, migrationsDirectory: preceding });
  }, 120000);

  afterAll(async () => {
    if (pool) await pool.end();
    if (database) await database.cleanup();
    if (preceding && path.dirname(preceding) === os.tmpdir() && path.basename(preceding).startsWith('northstar-field-evidence-pre047-')) {
      fs.rmSync(preceding, { recursive: true });
    }
  });

  test('real runner rolls back interrupted 047, retries exactly once, and restarts with no migration work', async () => {
    const bytes = fs.readFileSync(path.resolve(__dirname, '../../migrations/047_canonical_field_evidence_authority.sql'));
    const checksum = crypto.createHash('sha256').update(bytes).digest('hex');
    const before = (await pool.query('SELECT filename,checksum,applied_at FROM _migrations ORDER BY filename')).rows;
    let intercepted = false;
    const interruptedPool = { connect: async () => {
      const client = await pool.connect();
      return { query: async (...args) => {
        const result = await client.query(...args);
        if (!intercepted && typeof args[0] === 'string' && args[0].includes('-- Mission 23 Part 6:')) {
          intercepted = true;
          throw new Error('Deterministic interruption after 047 DDL before ledger commit');
        }
        return result;
      }, release: () => client.release() };
    } };
    await expect(require('../../src/db').runMigrations({ pool: interruptedPool })).rejects.toThrow('Deterministic interruption');
    expect(intercepted).toBe(true);
    expect((await pool.query("SELECT to_regclass('canonical_field_evidence_records') AS authority")).rows[0].authority).toBeNull();
    expect((await pool.query('SELECT filename,checksum,applied_at FROM _migrations ORDER BY filename')).rows).toEqual(before);
    await require('../../src/db').runMigrations({ pool });
    const applied = (await pool.query('SELECT filename,checksum,applied_at FROM _migrations ORDER BY filename')).rows;
    expect(applied).toHaveLength(before.length + 1);
    expect(applied.slice(0, -1)).toEqual(before);
    expect(applied.at(-1)).toMatchObject({ filename: '047_canonical_field_evidence_authority.sql', checksum });
    await require('../../src/db').runMigrations({ pool });
    expect((await pool.query('SELECT filename,checksum,applied_at FROM _migrations ORDER BY filename')).rows).toEqual(applied);
    expect((await pool.query("SELECT count(*)::int AS count FROM pg_constraint WHERE conrelid IN (SELECT oid FROM pg_class WHERE relname LIKE 'canonical_field_evidence_%') AND NOT convalidated")).rows[0].count).toBe(0);
    expect((await pool.query("SELECT count(*)::int AS count FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.pronamespace='public'::regnamespace AND (p.proname LIKE 'canonical_field_evidence_%' OR p.proname IN ('canonical_field_file_upload_authorize','canonical_field_file_upload_reconcile','canonical_field_file_cleanup_confirm','canonical_field_file_retrieve_authorize')) AND a.grantee=0 AND a.privilege_type='EXECUTE'")).rows[0].count).toBe(0);
  }, 120000);
});
