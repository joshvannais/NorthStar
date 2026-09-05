'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Pool } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const real = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
real('Mission 23 Part 5 additive migration lifecycle', () => {
  let database, pool, preceding;
  beforeAll(async () => {
    database = await createSuiteDatabase('m23p5-migration'); pool = new Pool({ connectionString: database.connectionString });
    preceding = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-equipment-pre046-'));
    const migrations = path.resolve(__dirname, '../../migrations');
    for (const name of fs.readdirSync(migrations).filter(name => name.endsWith('.sql') && Number(name.slice(0, 3)) < 46)) fs.copyFileSync(path.join(migrations, name), path.join(preceding, name));
    await require('../../src/db').runMigrations({ pool, migrationsDirectory: preceding });
  }, 120000);
  afterAll(async () => {
    if (pool) await pool.end(); if (database) await database.cleanup();
    if (preceding && path.dirname(preceding) === os.tmpdir() && path.basename(preceding).startsWith('northstar-equipment-pre046-')) fs.rmSync(preceding, { recursive: true });
  });
  test('real runner rolls back interrupted 046, applies exact once on retry, and restarts as zero-op', async () => {
    const before = (await pool.query('SELECT filename,checksum,applied_at FROM _migrations ORDER BY filename')).rows;
    let intercepted = false;
    const interruptedPool = { connect: async () => {
      const client = await pool.connect();
      return { query: async (...args) => {
        const result = await client.query(...args);
        if (!intercepted && typeof args[0] === 'string' && args[0].includes('-- Mission 23 Part 5. Additive only;')) { intercepted = true; throw new Error('Deterministic interruption after 046 DDL before ledger commit'); }
        return result;
      }, release: () => client.release() };
    } };
    await expect(require('../../src/db').runMigrations({ pool: interruptedPool })).rejects.toThrow('Deterministic interruption');
    expect(intercepted).toBe(true);
    expect((await pool.query("SELECT to_regclass('canonical_equipment_drafts') AS authority")).rows[0].authority).toBeNull();
    expect((await pool.query('SELECT filename,checksum,applied_at FROM _migrations ORDER BY filename')).rows).toEqual(before);
    await require('../../src/db').runMigrations({ pool });
    const applied = (await pool.query('SELECT filename,checksum,applied_at FROM _migrations ORDER BY filename')).rows;
    expect(applied).toHaveLength(before.length + 1); expect(applied.slice(0, -1)).toEqual(before);
    await require('../../src/db').runMigrations({ pool });
    expect((await pool.query('SELECT filename,checksum,applied_at FROM _migrations ORDER BY filename')).rows).toEqual(applied);
    expect((await pool.query("SELECT count(*)::int AS count FROM pg_constraint WHERE conrelid IN (SELECT oid FROM pg_class WHERE relname LIKE 'canonical_equipment_%') AND NOT convalidated")).rows[0].count).toBe(0);
    expect((await pool.query("SELECT count(*)::int AS count FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE 'equipment_%' AND a.grantee=0 AND a.privilege_type='EXECUTE'")).rows[0].count).toBe(0);
  }, 120000);
});
