'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Pool, Client } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');

const real = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

real('Mission 23 Part 7 additive migration lifecycle', () => {
  let database, pool, runtimePool, roles, preceding;
  beforeAll(async () => {
    database = await createSuiteDatabase('m23p7-migration');
    roles={owner:'p7upgrade_owner_'+process.pid,runtime:'p7upgrade_runtime_'+process.pid};
    const admin=new Client({connectionString:process.env.M19_PG_ADMIN_URL});await admin.connect();
    try{
      for(const role of Object.values(roles))await admin.query('CREATE ROLE '+role+' LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS');
      await admin.query('ALTER DATABASE "'+database.databaseName+'" OWNER TO '+roles.owner);
    }finally{await admin.end();}
    const roleUrl=role=>{const url=new URL(database.connectionString);url.username=role;url.password='';return url.toString();};
    pool = new Pool({ connectionString: roleUrl(roles.owner) });
    runtimePool = new Pool({ connectionString: roleUrl(roles.runtime) });
    preceding = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-field-evidence-pre048-'));
    const migrations = path.resolve(__dirname, '../../migrations');
    for (const name of fs.readdirSync(migrations).filter(name => name.endsWith('.sql') && Number(name.slice(0, 3)) < 48)) {
      fs.copyFileSync(path.join(migrations, name), path.join(preceding, name));
    }
    await require('../../src/db').runMigrations({ pool, runtimePool, migrationsDirectory: preceding });
  }, 120000);

  afterAll(async () => {
    if (runtimePool) await runtimePool.end();
    if (pool) await pool.end();
    if (database) await database.cleanup();
    if(roles){const admin=new Client({connectionString:process.env.M19_PG_ADMIN_URL});await admin.connect();try{for(const role of Object.values(roles))await admin.query('DROP ROLE IF EXISTS '+role);}finally{await admin.end();}}
    if (preceding && path.dirname(preceding) === os.tmpdir() && path.basename(preceding).startsWith('northstar-field-evidence-pre048-')) {
      fs.rmSync(preceding, { recursive: true });
    }
  });

  test('real runner rolls back interrupted 048, applies 048 and the current tail once, and restarts with no migration work', async () => {
    const bytes = fs.readFileSync(path.resolve(__dirname, '../../migrations/048_canonical_progress_issue_change_facts.sql'));
    const checksum = crypto.createHash('sha256').update(bytes).digest('hex');
    const tailBytes = fs.readFileSync(path.resolve(__dirname, '../../migrations/049_canonical_completion_reopening_authority.sql'));
    const tailChecksum = crypto.createHash('sha256').update(tailBytes).digest('hex');
    const correctionBytes = fs.readFileSync(path.resolve(__dirname, '../../migrations/050_canonical_completion_source_read_authority.sql'));
    const correctionChecksum = crypto.createHash('sha256').update(correctionBytes).digest('hex');
    const before = (await pool.query('SELECT filename,checksum,applied_at FROM _migrations ORDER BY filename')).rows;
    let intercepted = false;
    const interruptedPool = { connect: async () => {
      const client = await pool.connect();
      return { query: async (...args) => {
        const result = await client.query(...args);
        if (!intercepted && typeof args[0] === 'string' && args[0].includes('-- Mission 23 Part 7:')) {
          intercepted = true;
          throw new Error('Deterministic interruption after 048 DDL before ledger commit');
        }
        return result;
      }, release: () => client.release() };
    } };
    await expect(require('../../src/db').runMigrations({ pool: interruptedPool, runtimePool })).rejects.toThrow('Deterministic interruption');
    expect(intercepted).toBe(true);
    expect((await pool.query("SELECT to_regclass('canonical_progress_records') AS authority")).rows[0].authority).toBeNull();
    expect((await pool.query('SELECT filename,checksum,applied_at FROM _migrations ORDER BY filename')).rows).toEqual(before);
    await require('../../src/db').runMigrations({ pool, runtimePool });
    const applied = (await pool.query('SELECT filename,checksum,applied_at FROM _migrations ORDER BY filename')).rows;
    expect(applied).toHaveLength(before.length + 3);
    expect(applied.slice(0, -3)).toEqual(before);
    expect(applied.at(-3)).toMatchObject({ filename: '048_canonical_progress_issue_change_facts.sql', checksum });
    expect(applied.at(-2)).toMatchObject({ filename: '049_canonical_completion_reopening_authority.sql', checksum: tailChecksum });
    expect(applied.at(-1)).toMatchObject({ filename: '050_canonical_completion_source_read_authority.sql', checksum: correctionChecksum });
    await require('../../src/db').runMigrations({ pool, runtimePool });
    expect((await pool.query('SELECT filename,checksum,applied_at FROM _migrations ORDER BY filename')).rows).toEqual(applied);
    const inspected=await require('../../scripts/inspect-production-migration-history').inspect(database.connectionString);
    expect(inspected).toMatchObject({sourceMigrationCount:48,appliedMigrationCount:48,timezone:'UTC',encoding:'UTF8',
      appliedWithoutSource:[],duplicateApplied:[],mismatches:[],pendingMigrations:[]});
    expect((await pool.query("SELECT count(*)::int AS count FROM pg_constraint WHERE conrelid IN (SELECT oid FROM pg_class WHERE relname LIKE 'canonical_progress_%') AND NOT convalidated")).rows[0].count).toBe(0);
    expect((await pool.query("SELECT count(*)::int AS count FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.pronamespace='public'::regnamespace AND (p.proname LIKE 'canonical_progress_%' ) AND a.grantee=0 AND a.privilege_type='EXECUTE'")).rows[0].count).toBe(0);
  }, 120000);
});
