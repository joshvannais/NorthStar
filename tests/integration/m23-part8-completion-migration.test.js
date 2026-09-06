'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client, Pool } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');

const real = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const MIGRATION = '049_canonical_completion_reopening_authority.sql';
const quote = value => '"' + String(value).replace(/"/g, '""') + '"';

real('Mission 23 Part 8 additive migration lifecycle', () => {
  let database;
  let ownerPool;
  let runtimePool;
  let roles;
  let preceding;

  beforeAll(async () => {
    database = await createSuiteDatabase('m23p8-migration');
    const suffix = `${process.pid}_${crypto.randomBytes(3).toString('hex')}`;
    roles = { owner: `m23p8_owner_${suffix}`, runtime: `m23p8_runtime_${suffix}` };
    const admin = new Client({ connectionString: process.env.M19_PG_ADMIN_URL });
    await admin.connect();
    try {
      for (const role of Object.values(roles)) {
        await admin.query(`CREATE ROLE ${quote(role)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
      }
      await admin.query(`ALTER DATABASE ${quote(database.databaseName)} OWNER TO ${quote(roles.owner)}`);
    } finally {
      await admin.end();
    }
    const roleUrl = role => {
      const url = new URL(database.connectionString); url.username = role; url.password = ''; return url.toString();
    };
    ownerPool = new Pool({ connectionString: roleUrl(roles.owner) });
    runtimePool = new Pool({ connectionString: roleUrl(roles.runtime) });
    preceding = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-completion-pre049-'));
    const migrations = path.resolve(__dirname, '../../migrations');
    for (const name of fs.readdirSync(migrations)
      .filter(name => name.endsWith('.sql') && Number(name.slice(0, 3)) < 49)) {
      fs.copyFileSync(path.join(migrations, name), path.join(preceding, name));
    }
    await require('../../src/db').runMigrations({ pool: ownerPool, migrationsDirectory: preceding });
    fs.copyFileSync(path.join(migrations, MIGRATION), path.join(preceding, MIGRATION));
  }, 120000);

  afterAll(async () => {
    if (runtimePool) await runtimePool.end();
    if (ownerPool) await ownerPool.end();
    if (database) await database.cleanup();
    if (roles) {
      const admin = new Client({ connectionString: process.env.M19_PG_ADMIN_URL });
      await admin.connect();
      try {
        for (const role of Object.values(roles)) await admin.query(`DROP ROLE IF EXISTS ${quote(role)}`);
      } finally { await admin.end(); }
    }
    if (preceding && path.dirname(preceding) === os.tmpdir() &&
        path.basename(preceding).startsWith('northstar-completion-pre049-')) {
      fs.rmSync(preceding, { recursive: true });
    }
  });

  test('rolls back interrupted 049, applies once on retry, and restarts as a zero-op', async () => {
    const bytes = fs.readFileSync(path.resolve(__dirname, '../../migrations', MIGRATION));
    const checksum = crypto.createHash('sha256').update(bytes).digest('hex');
    const before = (await ownerPool.query(
      'SELECT filename,checksum,applied_at FROM _migrations ORDER BY filename'
    )).rows;
    let intercepted = false;
    const interruptedPool = {
      connect: async () => {
        const client = await ownerPool.connect();
        return {
          query: async (...args) => {
            const result = await client.query(...args);
            if (!intercepted && typeof args[0] === 'string' &&
                args[0].includes('-- Mission 23 Part 8:')) {
              intercepted = true;
              throw new Error('Deterministic interruption after 049 DDL before ledger commit');
            }
            return result;
          },
          release: () => client.release(),
        };
      },
    };
    await expect(require('../../src/db').runMigrations({
      pool: interruptedPool, migrationsDirectory: preceding,
    })).rejects.toThrow('Deterministic interruption');
    expect(intercepted).toBe(true);
    expect((await ownerPool.query(
      "SELECT to_regclass('canonical_completion_records') AS authority"
    )).rows[0].authority).toBeNull();
    expect((await ownerPool.query(
      'SELECT filename,checksum,applied_at FROM _migrations ORDER BY filename'
    )).rows).toEqual(before);

    await require('../../src/db').runMigrations({
      pool: ownerPool, migrationsDirectory: preceding,
    });
    const applied = (await ownerPool.query(
      'SELECT filename,checksum,applied_at FROM _migrations ORDER BY filename'
    )).rows;
    expect(applied).toHaveLength(before.length + 1);
    expect(applied.slice(0, -1)).toEqual(before);
    expect(applied.at(-1)).toMatchObject({ filename: MIGRATION, checksum });
    await require('../../src/db').runMigrations({
      pool: ownerPool, migrationsDirectory: preceding,
    });
    expect((await ownerPool.query(
      'SELECT filename,checksum,applied_at FROM _migrations ORDER BY filename'
    )).rows).toEqual(applied);

    const authorityClient = await ownerPool.connect();
    try {
      await require('../../src/completion/databaseAuthority').grantAndVerify(
        authorityClient, roles.runtime
      );
    } finally { authorityClient.release(); }
    const constraints = await ownerPool.query(
      "SELECT count(*)::int AS count FROM pg_constraint WHERE conrelid IN (SELECT oid FROM pg_class WHERE relname LIKE 'canonical_completion_%') AND NOT convalidated"
    );
    expect(constraints.rows[0].count).toBe(0);
    const tablePrivileges = await ownerPool.query(
      "SELECT count(*)::int AS count FROM pg_class relation WHERE relation.relnamespace='public'::regnamespace AND relation.relname LIKE 'canonical_completion_%' AND has_table_privilege($1,relation.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')",
      [roles.runtime]
    );
    expect(tablePrivileges.rows[0].count).toBe(0);
    const functionPrivileges = await ownerPool.query(
      "SELECT proname,has_function_privilege($1,oid,'EXECUTE') AS executable FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'canonical_completion_%' ORDER BY proname",
      [roles.runtime]
    );
    expect(functionPrivileges.rows.filter(row => row.executable).map(row => row.proname)).toEqual([
      'canonical_completion_mutate', 'canonical_completion_read',
    ]);
    expect((await ownerPool.query(
      "SELECT count(*)::int AS count FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE 'canonical_completion_%' AND a.grantee=0 AND a.privilege_type='EXECUTE'"
    )).rows[0].count).toBe(0);
  }, 120000);
});
