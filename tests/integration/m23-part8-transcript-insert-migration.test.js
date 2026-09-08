'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client, Pool } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');

const real = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const MIGRATION = '052_canonical_transcript_insert_only_authority.sql';
const quote = value => '"' + String(value).replace(/"/g, '""') + '"';

real('Mission 23 Part 8 completion insert-only transcript correction migration lifecycle', () => {
  let database;
  let ownerPool;
  let runtimePool;
  let roles;
  let preceding;

  beforeAll(async () => {
    database = await createSuiteDatabase('m23p8-insert-migration');
    const suffix = `${process.pid}_${crypto.randomBytes(3).toString('hex')}`;
    roles = { owner: `m23p8i_owner_${suffix}`, runtime: `m23p8i_runtime_${suffix}` };
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
    ownerPool = new Pool({ connectionString: roleUrl(roles.owner) });
    runtimePool = new Pool({ connectionString: roleUrl(roles.runtime) });
    preceding = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-completion-pre052-'));
    const migrations = path.resolve(__dirname, '../../migrations');
    for (const name of fs.readdirSync(migrations)
      .filter(name => name.endsWith('.sql') && Number(name.slice(0, 3)) < 52)) {
      fs.copyFileSync(path.join(migrations, name), path.join(preceding, name));
    }
    await require('../../src/db').runMigrations({
      pool: ownerPool, runtimePool, migrationsDirectory: preceding,
    });
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
        for (const role of Object.values(roles)) {
          await admin.query(`DROP ROLE IF EXISTS ${quote(role)}`);
        }
      } finally {
        await admin.end();
      }
    }
    if (preceding && path.dirname(preceding) === os.tmpdir() &&
        path.basename(preceding).startsWith('northstar-completion-pre052-')) {
      fs.rmSync(preceding, { recursive: true });
    }
  });

  test('052 revokes content writes before broad grants, rolls back atomically, retries and preserves zero-op ACLs', async () => {
    const bytes = fs.readFileSync(path.resolve(__dirname, '../../migrations', MIGRATION));
    const checksum = crypto.createHash('sha256').update(bytes).digest('hex');
    const ledger = async () => (await ownerPool.query(
      'SELECT filename,checksum,applied_at FROM _migrations ORDER BY filename'
    )).rows;
    const privileges = async client => (await client.query(
      "SELECT has_any_column_privilege($1,'canonical_transcripts','UPDATE') AS updatable, has_table_privilege($1,'canonical_transcripts','DELETE') AS deletable",
      [roles.runtime]
    )).rows[0];
    const before = await ledger();
    // Synthetic stale ACL setup only, never a transcript content mutation.
    await ownerPool.query(`GRANT UPDATE (transcript_text) ON canonical_transcripts TO PUBLIC, ${quote(roles.runtime)}`);
    expect(await privileges(ownerPool)).toMatchObject({ updatable: true });
    let intercepted = false;
    const interruptedPool = { connect: async () => {
      const client = await ownerPool.connect();
      return { query: async (...args) => {
        const result = await client.query(...args);
        if (!intercepted && typeof args[0] === 'string' &&
            args[0].includes('-- Mission 23 Part 8 third correction:')) {
          intercepted = true;
          // Inspect migration effects BEFORE the later startup reconciler.
          expect(await privileges(client)).toEqual({ updatable: false, deletable: false });
          throw new Error('Deterministic interruption after 052 ACL DDL');
        }
        return result;
      }, release: () => client.release() };
    } };
    await expect(require('../../src/db').runMigrations({
      pool: interruptedPool, runtimePool, migrationsDirectory: preceding,
    })).rejects.toThrow('Deterministic interruption after 052');
    expect(intercepted).toBe(true);
    expect(await ledger()).toEqual(before);
    expect(await privileges(ownerPool)).toMatchObject({ updatable: true });
    await require('../../src/db').runMigrations({
      pool: ownerPool, runtimePool, migrationsDirectory: preceding,
    });
    const applied = await ledger();
    expect(applied.slice(0, -1)).toEqual(before);
    expect(applied).toHaveLength(before.length + 1);
    expect(applied.at(-1)).toMatchObject({ filename: MIGRATION, checksum });
    expect(await privileges(ownerPool)).toEqual({ updatable: false, deletable: false });
    await ownerPool.query(`GRANT UPDATE (transcript_text,source) ON canonical_transcripts TO PUBLIC, ${quote(roles.runtime)}`);
    await require('../../src/db').runMigrations({
      pool: ownerPool, runtimePool, migrationsDirectory: preceding,
    });
    expect(await ledger()).toEqual(applied);
    expect(await privileges(ownerPool)).toEqual({ updatable: false, deletable: false });
    expect((await ownerPool.query(
      "SELECT count(*)::int AS count FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) acl WHERE a.attrelid='canonical_transcripts'::regclass AND acl.grantee=0 AND acl.privilege_type='UPDATE'"
    )).rows[0].count).toBe(0);
    const inspected = await require('../../scripts/inspect-production-migration-history').inspect(database.connectionString);
    expect(inspected).toMatchObject({
      sourceMigrationCount: 51, appliedMigrationCount: 50, timezone: 'UTC', encoding: 'UTF8',
      appliedWithoutSource: [], duplicateApplied: [], mismatches: [],
      pendingMigrations: [{ filename: '053_current_worker_execution_projection.sql' }],
    });
  }, 120000);
});
