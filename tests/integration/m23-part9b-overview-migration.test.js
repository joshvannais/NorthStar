'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client, Pool } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');

const real = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const MIGRATION = '054_owner_operational_overview_read.sql';
const quote = value => '"' + String(value).replace(/"/g, '""') + '"';

real('Mission 23 Part 9B additive owner operational overview migration', () => {
  let database;
  let ownerPool;
  let runtimePool;
  let roles;
  let preceding;

  beforeAll(async () => {
    database = await createSuiteDatabase('m23p9b-projection-migration');
    const suffix = `${process.pid}_${crypto.randomBytes(3).toString('hex')}`;
    roles = { owner: `m23p9b_owner_${suffix}`, runtime: `m23p9b_runtime_${suffix}` };
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
      const url = new URL(database.connectionString);
      url.username = role;
      url.password = '';
      return url.toString();
    };
    ownerPool = new Pool({ connectionString: roleUrl(roles.owner), max: 3 });
    runtimePool = new Pool({ connectionString: roleUrl(roles.runtime), max: 3 });
    preceding = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-part9b-pre054-'));
    const migrations = path.resolve(__dirname, '../../migrations');
    for (const name of fs.readdirSync(migrations)
      .filter(name => name.endsWith('.sql') && Number(name.slice(0, 3)) < 54)) {
      fs.copyFileSync(path.join(migrations, name), path.join(preceding, name));
    }
    await require('../../src/db').runMigrations({
      pool: ownerPool,
      runtimePool,
      migrationsDirectory: preceding,
    });
    await ownerPool.query(
      "INSERT INTO public.organizations(id,name,email) VALUES('f9100000-0000-4000-8000-000000000001','Part 9B upgrade sentinel','part9b-upgrade@example.test')"
    );
    fs.copyFileSync(path.join(migrations, MIGRATION), path.join(preceding, MIGRATION));
  }, 180000);

  afterAll(async () => {
    if (runtimePool) await runtimePool.end();
    if (ownerPool) await ownerPool.end();
    if (database) await database.cleanup();
    if (roles) {
      const admin = new Client({ connectionString: process.env.M19_PG_ADMIN_URL });
      await admin.connect();
      try {
        for (const role of Object.values(roles)) await admin.query(`DROP ROLE IF EXISTS ${quote(role)}`);
      } finally {
        await admin.end();
      }
    }
    if (preceding && path.dirname(preceding) === os.tmpdir() &&
        path.basename(preceding).startsWith('northstar-part9b-pre054-')) {
      fs.rmSync(preceding, { recursive: true });
    }
  }, 180000);

  test('rolls back interruption, preserves 001-053 and existing data, applies 054 once, and grants only the entry read', async () => {
    const db = require('../../src/db');
    const migrationPath = path.resolve(__dirname, '../../migrations', MIGRATION);
    const checksum = crypto.createHash('sha256').update(fs.readFileSync(migrationPath)).digest('hex');
    const before = (await ownerPool.query(
      'SELECT filename,checksum,applied_at FROM public._migrations ORDER BY filename'
    )).rows;
    expect(before).toHaveLength(db.loadMigrations(preceding).length - 1);
    expect(before.at(-1).filename).toBe('053_current_worker_execution_projection.sql');

    let intercepted = false;
    const interruptedPool = {
      connect: async () => {
        const client = await ownerPool.connect();
        return {
          query: async (...args) => {
            const result = await client.query(...args);
            if (!intercepted && typeof args[0] === 'string' &&
                args[0].includes('-- Mission 23 Part 9B:')) {
              intercepted = true;
              throw new Error('Deterministic interruption after 054 DDL before ledger commit');
            }
            return result;
          },
          release: () => client.release(),
        };
      },
    };
    await expect(db.runMigrations({
      pool: interruptedPool,
      runtimePool,
      migrationsDirectory: preceding,
    })).rejects.toThrow('Deterministic interruption');
    expect(intercepted).toBe(true);
    expect((await ownerPool.query(
      "SELECT to_regprocedure('public.canonical_operational_overview_read(uuid,uuid,text,uuid,text,integer,jsonb)') AS authority"
    )).rows[0].authority).toBeNull();
    expect((await ownerPool.query(
      'SELECT filename,checksum,applied_at FROM public._migrations ORDER BY filename'
    )).rows).toEqual(before);
    expect((await ownerPool.query(
      "SELECT name,email FROM public.organizations WHERE id='f9100000-0000-4000-8000-000000000001'"
    )).rows).toEqual([{ name: 'Part 9B upgrade sentinel', email: 'part9b-upgrade@example.test' }]);

    await db.runMigrations({ pool: ownerPool, runtimePool, migrationsDirectory: preceding });
    const applied = (await ownerPool.query(
      'SELECT filename,checksum,applied_at FROM public._migrations ORDER BY filename'
    )).rows;
    expect(applied).toHaveLength(before.length + 1);
    expect(applied.slice(0, -1)).toEqual(before);
    expect(applied.at(-1)).toMatchObject({ filename: MIGRATION, checksum });
    await db.runMigrations({ pool: ownerPool, runtimePool, migrationsDirectory: preceding });
    expect((await ownerPool.query(
      'SELECT filename,checksum,applied_at FROM public._migrations ORDER BY filename'
    )).rows).toEqual(applied);

    const metadata = (await ownerPool.query(
      `SELECT procedure.prosecdef,procedure.provolatile,procedure.proparallel,procedure.proconfig,
              pg_get_userbyid(procedure.proowner) AS owner
         FROM pg_proc procedure
        WHERE procedure.oid='public.canonical_operational_overview_read(uuid,uuid,text,uuid,text,integer,jsonb)'::regprocedure`
    )).rows[0];
    expect(metadata).toMatchObject({ prosecdef: true, provolatile: 's', proparallel: 'u', owner: roles.owner });
    expect(metadata.proconfig).toEqual(['search_path=pg_catalog, public, pg_temp']);
    expect((await ownerPool.query(
      `SELECT has_function_privilege($1,
                'public.canonical_operational_overview_read(uuid,uuid,text,uuid,text,integer,jsonb)','EXECUTE') AS entry,
              has_function_privilege('public',
                'public.canonical_operational_overview_read(uuid,uuid,text,uuid,text,integer,jsonb)','EXECUTE') AS public_entry,
              has_function_privilege($1,
                'public.canonical_field_execution_projection(public.canonical_field_executions)','EXECUTE') AS helper,
              has_table_privilege($1,'public.canonical_field_executions','SELECT') AS table_read`,
      [roles.runtime]
    )).rows[0]).toEqual({ entry: true, public_entry: false, helper: false, table_read: false });
    expect((await ownerPool.query(
      "SELECT count(*)::int AS count FROM pg_constraint WHERE NOT convalidated"
    )).rows[0].count).toBe(0);
  }, 180000);
});
