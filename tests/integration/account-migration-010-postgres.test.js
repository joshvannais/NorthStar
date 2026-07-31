'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork, spawnSync } = require('child_process');
const { Client, Pool } = require('pg');
const { runMigrations, stripOuterTransaction } = require('../../src/db');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');

const ROOT = path.resolve(__dirname, '../..');
const MIGRATIONS_DIRECTORY = path.join(ROOT, 'migrations');
const MIGRATION_WORKER = path.join(ROOT, 'tests', 'helpers', 'account-migration-worker.js');
const MIGRATION_010 = '010_account_session_authority.sql';
const MIGRATION_011 = '011_oauth_authorization_states.sql';
const MIGRATION_010_REPOSITORY_PATH = `migrations/${MIGRATION_010}`;
const MIGRATION_011_REPOSITORY_PATH = `migrations/${MIGRATION_011}`;
const BASE_SHA = 'dfff096241d3be4fd1580a741cfe21ee64a5dfb3';
const MIGRATION_010_INTRODUCTION_SHA = '137ad6d473fac69fd5b7ee81aea5e513f3a1e7b4';
const PRE_PROVENANCE_CORRECTION_SHA = '43752350fc9acbce57a80cc87c212cd9d9bbf53c';
const REVIEWED_MIGRATION_010_HEADS = Object.freeze([
  '9ec1812630a54be3811ec94155824abc868cecdd',
  'b794033e22874145fe7de8708b66c28b5e509b75',
  PRE_PROVENANCE_CORRECTION_SHA,
]);
const MIGRATION_010_INTRODUCTION_LENGTH = 12043;
const MIGRATION_010_INTRODUCTION_HASH = 'cac651ea70624f013377e21e74b393a5133f5f6551aed20939a12014ea040a1b';
const MIGRATION_010_GIT_BLOB_LENGTH = 14419;
const MIGRATION_010_GIT_BLOB_HASH = '0087278b1fb0062ba88a4dd7e4699e2e5c4c98d78e822193e2e7c0bff5c9ca48';
const MIGRATION_010_CRLF_LENGTH = 14763;
const MIGRATION_010_CRLF_HASH = 'fe78838214f05ea4a76325fd0881e1b8168103d2cff84d1636ad3b0baeae4fcb';
const GENUINE_BASE_LEDGER_DDL = `
  CREATE TABLE IF NOT EXISTS _migrations (
    id SERIAL PRIMARY KEY,
    filename VARCHAR(255) UNIQUE NOT NULL,
    applied_at TIMESTAMP DEFAULT NOW()
  )
`;
const BRANCH_ERA_LEDGER_DDL = `
  CREATE TABLE _migrations (
    id SERIAL PRIMARY KEY,
    filename VARCHAR(255) UNIQUE NOT NULL,
    checksum CHAR(64),
    applied_at TIMESTAMP NULL DEFAULT NOW()
  )
`;
const LEGACY_HASHES = Object.freeze({
  '001_initial_schema.sql': 'dbbcad4947474777a61a3b230aa8aca54b9a3ef4257301368e39731fa05307e9',
  '002_seed_data.sql': '4b124ac5713caaddc4f2316e8c055c6235eb17881c5b4ba5d0edef481a8a63ff',
  '003_voice_sessions.sql': 'd37d402df2792a015b6d1f9d3e0f72226298f9a4d9ec7551f629e52c677f41c2',
  '004_canonical_persistence_v2.sql': '946b1819dd4c5205637e9fae91f3b36c28c1688e401f1f2f5b67ffba7d2e1651',
  '005_canonical_organization_authority.sql': '4065d873dd204935cfbd8ea8abe45d2b0b44e80df38ef203359d2863d37c5379',
  '006_canonical_voice_sessions.sql': '236809d3b87367804bbd6c28ccaaca27408fa340020ab3d3b48e3e81da203ec2',
  '007_canonical_tax_authority.sql': 'a5f2c8c78fc339790f2993c997ea2cd50134a9ed97de93267cd470b18ea408a6',
  '008_canonical_demo_authority.sql': 'c157ac2c10f07bf933b4774ac14584ecc580f93108926b5e53acbfed28263ef2',
  '009_canonical_voice_provider_identity.sql': '6ec531dbb385607818c4a70ae69bab7f5d85ff98565d61ad8026c20ef68634fe',
});
const PROTECTED_MIGRATION_HASHES = Object.freeze({
  ...LEGACY_HASHES,
  [MIGRATION_010]: '0087278b1fb0062ba88a4dd7e4699e2e5c4c98d78e822193e2e7c0bff5c9ca48',
});

function productionMigrationFiles() {
  return fs.readdirSync(MIGRATIONS_DIRECTORY).filter(file => file.endsWith('.sql')).sort();
}

function sha256(contents) {
  return crypto.createHash('sha256').update(contents).digest('hex');
}

function runRequiredGit(args, { allowFailure = false } = {}) {
  const gitExecutable = process.env.M19_GIT_EXECUTABLE || 'git';
  const safeRoot = ROOT.replace(/\\/g, '/');
  const result = spawnSync(
    gitExecutable,
    ['-c', `safe.directory=${safeRoot}`, '-C', ROOT, ...args],
    {
      encoding: null,
      maxBuffer: 16 * 1024 * 1024,
      shell: false,
      windowsHide: true,
    }
  );
  if (result.error) {
    throw new Error(`Required Git executable failed: ${result.error.message}`);
  }
  const stdout = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout || '');
  const stderr = Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.from(result.stderr || '');
  const stderrText = stderr.toString('utf8');
  if (!allowFailure) {
    if (result.status !== 0) {
      throw new Error(
        `Required Git command failed with exit ${result.status}: ${stderrText.trim() || 'no diagnostic'}`
      );
    }
    if (/\bfatal:/i.test(stderrText)) {
      throw new Error(`Required Git command emitted a fatal diagnostic: ${stderrText.trim()}`);
    }
  }
  return { status: result.status, stderr, stdout };
}

function readRequiredGitBlob(ref, repositoryPath) {
  const result = runRequiredGit(['cat-file', 'blob', `${ref}:${repositoryPath}`]);
  if (result.stdout.length === 0) {
    throw new Error(`Required Git blob is empty: ${ref}:${repositoryPath}`);
  }
  return result.stdout;
}

function waitForMessage(child, expectedType, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error(`migration worker timed out waiting for ${expectedType}`)), timeoutMs);
    function finish(error, value) {
      clearTimeout(timeout);
      child.off('message', onMessage);
      child.off('exit', onExit);
      if (error) reject(error); else resolve(value);
    }
    function onMessage(message) {
      if (message && message.type === expectedType) finish(null, message);
      else if (message && message.type === 'error') finish(new Error(message.code));
    }
    function onExit(code) {
      finish(new Error(`migration worker exited before ${expectedType}: ${code}`));
    }
    child.on('message', onMessage);
    child.on('exit', onExit);
  });
}

function startMigrationWorker(connectionString, applicationName) {
  const child = fork(MIGRATION_WORKER, [], {
    cwd: ROOT,
    env: {
      ...process.env,
      M19_MIGRATION_DATABASE_URL: connectionString,
      M19_MIGRATION_APPLICATION_NAME: applicationName,
    },
    silent: true,
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  return child;
}

async function waitForExit(child, timeoutMs = 15000) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.off('exit', onExit);
      reject(new Error('migration worker did not exit'));
    }, timeoutMs);
    function onExit() {
      clearTimeout(timeout);
      resolve();
    }
    child.once('exit', onExit);
  });
}

async function poll(probe, description, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await probe();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function runProductionMigrations(connectionString, migrationsDirectory = MIGRATIONS_DIRECTORY, poolOptions = {}) {
  const pool = new Pool({ connectionString, max: 2, ...poolOptions });
  try {
    return await runMigrations({ pool, migrationsDirectory });
  } finally {
    await pool.end();
  }
}

async function queryWithClient(connectionString, work) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

function normalizedPath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
}

function negativeControlConfiguration(connectionString, expectedDatabase) {
  if (!['pr71_negative_fresh', 'pr71_negative_upgrade'].includes(expectedDatabase)) {
    throw new Error('Unsupported migration negative-control database identity');
  }
  const admin = new URL(process.env.M19_PG_ADMIN_URL);
  const parsed = new URL(connectionString);
  const expectedPort = Number(process.env.M19_EXPECTED_PG_PORT);
  const database = parsed.pathname.replace(/^\//, '');
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || parsed.hostname !== '127.0.0.1' ||
      Number(parsed.port || 5432) !== expectedPort || database !== expectedDatabase ||
      parsed.username !== admin.username || parsed.password !== admin.password ||
      parsed.search !== '' || parsed.hash !== '') {
    throw new Error('Migration negative-control URL is outside the disposable PostgreSQL allowlist');
  }
  return {
    connectionString,
    expectedDatabase,
    expectedDataDirectory: process.env.M19_EXPECTED_PG_DATA_DIR,
    expectedPort,
  };
}

async function verifyNegativeControlIdentity(client, configuration) {
  const result = await client.query(`
    SELECT current_database() AS database,
           current_setting('server_version_num')::int AS server_version_num,
           current_setting('data_directory') AS data_directory,
           host(inet_server_addr()) AS server_address,
           inet_server_port() AS server_port,
           current_setting('listen_addresses') AS listen_addresses
  `);
  const identity = result.rows[0];
  if (identity.database !== configuration.expectedDatabase ||
      Math.floor(identity.server_version_num / 10000) !== 18 ||
      normalizedPath(identity.data_directory) !== normalizedPath(configuration.expectedDataDirectory) ||
      identity.server_address !== '127.0.0.1' || identity.server_port !== configuration.expectedPort ||
      identity.listen_addresses !== '127.0.0.1') {
    throw new Error('Migration negative-control PostgreSQL identity mismatch');
  }
}

async function schemaSnapshot(connectionString, expectedNegativeDatabase = null) {
  const negativeControl = expectedNegativeDatabase
    ? negativeControlConfiguration(connectionString, expectedNegativeDatabase)
    : null;
  return queryWithClient(connectionString, async client => {
    if (negativeControl) await verifyNegativeControlIdentity(client, negativeControl);
    const columns = await client.query(
      `SELECT table_name, ordinal_position, column_name, data_type, udt_name,
              COALESCE(character_maximum_length, 0)::int AS character_maximum_length,
              is_nullable,
              COALESCE(column_default, '') AS column_default
         FROM information_schema.columns
        WHERE table_schema = 'public'
        ORDER BY table_name, ordinal_position`
    );
    const constraints = await client.query(
      `SELECT conrelid::regclass::text AS table_name, conname, contype,
              pg_get_constraintdef(oid) AS definition,
              condeferrable, condeferred, convalidated,
              CASE WHEN conindid = 0 THEN '' ELSE conindid::regclass::text END AS backing_index
        FROM pg_constraint
        WHERE connamespace = 'public'::regnamespace
        ORDER BY table_name, conname`
    );
    const indexes = await client.query(
      `SELECT indexes.tablename, indexes.indexname, indexes.indexdef,
              index_record.indisunique, index_record.indisprimary,
              index_record.indisvalid, index_record.indisready,
              COALESCE(owner_constraint.conname, '') AS owning_constraint
         FROM pg_indexes indexes
         JOIN pg_class index_class ON index_class.relname = indexes.indexname
         JOIN pg_namespace index_namespace
           ON index_namespace.oid = index_class.relnamespace
          AND index_namespace.nspname = indexes.schemaname
         JOIN pg_index index_record ON index_record.indexrelid = index_class.oid
         LEFT JOIN pg_constraint owner_constraint
           ON owner_constraint.conindid = index_class.oid
          AND owner_constraint.conrelid = index_record.indrelid
          AND owner_constraint.contype IN ('p', 'u')
        WHERE indexes.schemaname = 'public'
        ORDER BY indexes.tablename, indexes.indexname`
    );
    const triggers = await client.query(
      `SELECT event_object_table AS table_name, trigger_name, action_timing,
              event_manipulation, action_statement
         FROM information_schema.triggers
        WHERE trigger_schema = 'public'
        ORDER BY table_name, trigger_name, event_manipulation`
    );
    const functions = await client.query(
      `SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS arguments,
              pg_get_functiondef(p.oid) AS definition
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prokind = 'f'
        ORDER BY p.proname, arguments`
    );
    const migrationSequence = await client.query(`
      SELECT sequence_namespace.nspname AS sequence_schema,
             sequence_class.relname AS sequence_name,
             table_namespace.nspname AS owned_table_schema,
             table_class.relname AS owned_table,
             attribute.attname AS owned_column,
             dependency.deptype AS dependency_type,
             format_type(sequence.seqtypid, NULL) AS data_type,
             sequence.seqstart::text AS start_value,
             sequence.seqincrement::text AS increment_by,
             sequence.seqmin::text AS minimum_value,
             sequence.seqmax::text AS maximum_value,
             sequence.seqcache::text AS cache_size,
             sequence.seqcycle AS cycles,
             pg_sequence_last_value(sequence_class.oid)::text AS last_value
        FROM pg_class sequence_class
        JOIN pg_namespace sequence_namespace ON sequence_namespace.oid = sequence_class.relnamespace
        JOIN pg_sequence sequence ON sequence.seqrelid = sequence_class.oid
        JOIN pg_depend dependency
          ON dependency.classid = 'pg_class'::regclass
         AND dependency.objid = sequence_class.oid
         AND dependency.refclassid = 'pg_class'::regclass
         AND dependency.deptype IN ('a', 'i')
        JOIN pg_class table_class ON table_class.oid = dependency.refobjid
        JOIN pg_namespace table_namespace ON table_namespace.oid = table_class.relnamespace
        JOIN pg_attribute attribute
          ON attribute.attrelid = table_class.oid
         AND attribute.attnum = dependency.refobjsubid
       WHERE table_namespace.nspname = 'public'
         AND table_class.relname = '_migrations'
       ORDER BY sequence_schema, sequence_name
    `);
    let migrationSequenceState = [];
    if (migrationSequence.rows.length === 1) {
      migrationSequenceState = (await client.query(`
        SELECT last_value::text AS last_value,
               is_called,
               CASE WHEN is_called THEN last_value + 1 ELSE last_value END::text AS next_value
          FROM public._migrations_id_seq
      `)).rows;
    }
    return {
      columns: columns.rows,
      constraints: constraints.rows,
      functions: functions.rows,
      indexes: indexes.rows,
      migrationSequence: migrationSequence.rows,
      migrationSequenceState,
      triggers: triggers.rows,
    };
  });
}

function expectCanonicalMigrationLedger(snapshot) {
  expect(snapshot.columns.filter(row => row.table_name === '_migrations')).toEqual([
    {
      table_name: '_migrations', ordinal_position: 1, column_name: 'id', data_type: 'integer',
      udt_name: 'int4', character_maximum_length: 0, is_nullable: 'NO',
      column_default: "nextval('_migrations_id_seq'::regclass)",
    },
    {
      table_name: '_migrations', ordinal_position: 2, column_name: 'filename',
      data_type: 'character varying', udt_name: 'varchar', character_maximum_length: 255,
      is_nullable: 'NO', column_default: '',
    },
    {
      table_name: '_migrations', ordinal_position: 3, column_name: 'checksum',
      data_type: 'character', udt_name: 'bpchar', character_maximum_length: 64,
      is_nullable: 'YES', column_default: '',
    },
    {
      table_name: '_migrations', ordinal_position: 4, column_name: 'applied_at',
      data_type: 'timestamp with time zone', udt_name: 'timestamptz',
      character_maximum_length: 0, is_nullable: 'NO', column_default: 'now()',
    },
  ]);
  expect(snapshot.constraints.filter(row => row.table_name === '_migrations')).toEqual([
    {
      table_name: '_migrations', conname: '_migrations_applied_at_not_null',
      contype: 'n', definition: 'NOT NULL applied_at', condeferrable: false,
      condeferred: false, convalidated: true, backing_index: '',
    },
    {
      table_name: '_migrations', conname: '_migrations_filename_key',
      contype: 'u', definition: 'UNIQUE (filename)', condeferrable: false,
      condeferred: false, convalidated: true, backing_index: '_migrations_filename_key',
    },
    {
      table_name: '_migrations', conname: '_migrations_filename_not_null',
      contype: 'n', definition: 'NOT NULL filename', condeferrable: false,
      condeferred: false, convalidated: true, backing_index: '',
    },
    {
      table_name: '_migrations', conname: '_migrations_id_not_null',
      contype: 'n', definition: 'NOT NULL id', condeferrable: false,
      condeferred: false, convalidated: true, backing_index: '',
    },
    {
      table_name: '_migrations', conname: '_migrations_pkey',
      contype: 'p', definition: 'PRIMARY KEY (id)', condeferrable: false,
      condeferred: false, convalidated: true, backing_index: '_migrations_pkey',
    },
  ]);
  expect(snapshot.indexes.filter(row => row.tablename === '_migrations')).toEqual([
    {
      tablename: '_migrations', indexname: '_migrations_filename_key',
      indexdef: 'CREATE UNIQUE INDEX _migrations_filename_key ON public._migrations USING btree (filename)',
      indisunique: true, indisprimary: false, indisvalid: true, indisready: true,
      owning_constraint: '_migrations_filename_key',
    },
    {
      tablename: '_migrations', indexname: '_migrations_pkey',
      indexdef: 'CREATE UNIQUE INDEX _migrations_pkey ON public._migrations USING btree (id)',
      indisunique: true, indisprimary: true, indisvalid: true, indisready: true,
      owning_constraint: '_migrations_pkey',
    },
  ]);
  expect(snapshot.migrationSequence).toEqual([{
    sequence_schema: 'public',
    sequence_name: '_migrations_id_seq',
    owned_table_schema: 'public',
    owned_table: '_migrations',
    owned_column: 'id',
    dependency_type: 'a',
    data_type: 'integer',
    start_value: '1',
    increment_by: '1',
    minimum_value: '1',
    maximum_value: '2147483647',
    cache_size: '1',
    cycles: false,
    last_value: snapshot.migrationSequence[0] && snapshot.migrationSequence[0].last_value,
  }]);
  expect(snapshot.migrationSequenceState).toEqual([{
    last_value: expect.stringMatching(/^\d+$/),
    is_called: expect.any(Boolean),
    next_value: expect.stringMatching(/^\d+$/),
  }]);
}

async function installGenuineBaseFixture(connectionString, options = {}) {
  const files = Object.keys(LEGACY_HASHES);
  await queryWithClient(connectionString, async client => {
    await client.query(options.ledgerDdl || GENUINE_BASE_LEDGER_DDL);
    for (const file of files) {
      const contents = fs.readFileSync(path.join(MIGRATIONS_DIRECTORY, file), 'utf8');
      const migration = stripOuterTransaction(contents);
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO _migrations (filename, applied_at) VALUES ($1, $2)',
          [file, options.appliedAt === undefined ? new Date('2020-01-01T00:00:00.000Z') : options.appliedAt]
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  });
}

async function assertMigration010Absent(connectionString) {
  await queryWithClient(connectionString, async client => {
    const state = await client.query(
      `SELECT
         to_regclass('public.organization_memberships') AS memberships,
         to_regclass('public.auth_sessions') AS sessions,
         (SELECT count(*)::int FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'email_normalized') AS normalized_column,
         (SELECT count(*)::int FROM _migrations WHERE filename = $1) AS ledger_rows`,
      [MIGRATION_010]
    );
    expect(state.rows[0]).toEqual({
      ledger_rows: 0,
      memberships: null,
      normalized_column: 0,
      sessions: null,
    });
  });
}

async function migrationLedgerPreservationSnapshot(connectionString) {
  return queryWithClient(connectionString, async client => {
    const rows = await client.query(
      `SELECT to_jsonb(migration_row) AS row
         FROM _migrations migration_row
        ORDER BY id`
    );
    const columns = await client.query(
      `SELECT ordinal_position, column_name, data_type, is_nullable, COALESCE(column_default, '') AS column_default
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = '_migrations'
        ORDER BY ordinal_position`
    );
    const metadata = await client.query(`
      SELECT table_class.oid::text AS table_oid,
             table_class.relacl::text AS table_acl,
             obj_description(table_class.oid, 'pg_class') AS table_comment,
             table_class.reloptions AS table_options,
             pg_get_userbyid(table_class.relowner) AS table_owner,
             sequence_class.oid::text AS sequence_oid,
             sequence_class.relacl::text AS sequence_acl,
             obj_description(sequence_class.oid, 'pg_class') AS sequence_comment,
             sequence_class.reloptions AS sequence_options,
             pg_get_userbyid(sequence_class.relowner) AS sequence_owner
        FROM pg_class table_class
        JOIN pg_namespace namespace ON namespace.oid = table_class.relnamespace
        JOIN pg_class sequence_class ON sequence_class.oid = 'public._migrations_id_seq'::regclass
       WHERE namespace.nspname = 'public' AND table_class.relname = '_migrations'
    `);
    const constraintComments = await client.query(`
      SELECT constraint_record.oid::text AS oid,
             constraint_record.conname,
             obj_description(constraint_record.oid, 'pg_constraint') AS comment
        FROM pg_constraint constraint_record
       WHERE constraint_record.conrelid = 'public._migrations'::regclass
       ORDER BY constraint_record.conname
    `);
    const indexComments = await client.query(`
      SELECT index_class.oid::text AS oid,
             index_class.relname AS index_name,
             obj_description(index_class.oid, 'pg_class') AS comment
        FROM pg_index index_record
        JOIN pg_class index_class ON index_class.oid = index_record.indexrelid
       WHERE index_record.indrelid = 'public._migrations'::regclass
       ORDER BY index_class.relname
    `);
    const sequenceState = await client.query(`
      SELECT last_value::text AS last_value,
             is_called,
             CASE WHEN is_called THEN last_value + 1 ELSE last_value END::text AS next_value
        FROM public._migrations_id_seq
    `);
    const containment = await client.query(
      `SELECT to_regclass('public._migrations__canonical_rebuild')::text AS rebuild_relation,
              (SELECT count(*)::int FROM _migrations WHERE filename = $1) AS migration_010_rows,
              (SELECT count(*)::int FROM _migrations WHERE filename = $2) AS migration_011_rows`,
      [MIGRATION_010, MIGRATION_011]
    );
    const applicationTables = await client.query(`
      SELECT table_record.relname AS table_name
        FROM pg_class table_record
        JOIN pg_namespace namespace ON namespace.oid = table_record.relnamespace
       WHERE namespace.nspname = 'public'
         AND table_record.relkind IN ('r', 'p')
         AND table_record.relname NOT IN ('_migrations', '_migrations__canonical_rebuild')
       ORDER BY table_record.relname
    `);
    const applicationData = [];
    let applicationRowCount = 0;
    for (const { table_name: tableName } of applicationTables.rows) {
      const quotedTable = '"' + tableName.replace(/"/g, '""') + '"';
      const tableRows = await client.query(
        `SELECT to_jsonb(application_row) AS row
           FROM public.${quotedTable} application_row
          ORDER BY to_jsonb(application_row)::text`
      );
      applicationData.push({ tableName, rows: tableRows.rows });
      applicationRowCount += tableRows.rowCount;
    }
    return {
      rows: rows.rows,
      columns: columns.rows,
      metadata: metadata.rows,
      constraintComments: constraintComments.rows,
      indexComments: indexComments.rows,
      sequenceState: sequenceState.rows,
      containment: containment.rows,
      applicationData,
      applicationRowCount,
    };
  });
}

const LEDGER_COMMENT_TARGETS = Object.freeze({
  primaryConstraint: 'COMMENT ON CONSTRAINT _migrations_pkey ON _migrations IS ',
  primaryIndex: 'COMMENT ON INDEX _migrations_pkey IS ',
  filenameConstraint: 'COMMENT ON CONSTRAINT _migrations_filename_key ON _migrations IS ',
  filenameIndex: 'COMMENT ON INDEX _migrations_filename_key IS ',
});

function sqlCommentLiteral(value) {
  return value === null ? 'NULL' : "'" + String(value).replace(/'/g, "''") + "'";
}

async function setLedgerCatalogComments(client, targetNames, value) {
  for (const targetName of targetNames) {
    const statement = LEDGER_COMMENT_TARGETS[targetName];
    if (!statement) throw new Error('Unknown test-only migration ledger comment target');
    const targetValue = value && typeof value === 'object' ? value[targetName] : value;
    await client.query(statement + sqlCommentLiteral(targetValue));
  }
}

async function expectCatalogCommentRejection(connectionString, commentValue) {
  let failure;
  try {
    await runProductionMigrations(connectionString);
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(Error);
  expect(failure.message).toBe('Migration run failed: Unsupported _migrations catalog comments');
  const forbiddenValues = commentValue && typeof commentValue === 'object'
    ? Object.values(commentValue)
    : [commentValue];
  for (const forbiddenValue of forbiddenValues) {
    expect(failure.message).not.toContain(String(forbiddenValue));
  }
}

const ALL_LEDGER_COMMENT_TARGETS = Object.freeze(Object.keys(LEDGER_COMMENT_TARGETS));
const LEDGER_CATALOG_COMMENT_CASES = Object.freeze([
  {
    name: 'primary-key constraint',
    targets: ['primaryConstraint'],
    value: 'primary key constraint comment',
    canonicalFixture: true,
  },
  { name: 'primary-key index', targets: ['primaryIndex'], value: 'primary key index comment' },
  { name: 'filename unique constraint', targets: ['filenameConstraint'], value: 'filename constraint comment' },
  { name: 'filename unique index', targets: ['filenameIndex'], value: 'filename index comment' },
  {
    name: 'all four catalog objects',
    targets: ALL_LEDGER_COMMENT_TARGETS,
    value: Object.freeze({
      primaryConstraint: 'primary constraint sentinel',
      primaryIndex: 'primary index sentinel',
      filenameConstraint: 'filename constraint sentinel',
      filenameIndex: 'filename index sentinel',
    }),
  },
  { name: 'Unicode content', targets: ['primaryConstraint'], value: 'Ledger Ω 中 🚀 café — проверка' },
  { name: 'whitespace content', targets: ['primaryIndex'], value: ' \t\n  \r\n ' },
  { name: 'punctuation content', targets: ['filenameConstraint'], value: "!@#$%^&*()[]{};:'\"<>,.?/\\|`~" },
  { name: 'long content', targets: ['filenameIndex'], value: '0123456789abcdef'.repeat(1024) },
]);

describe('production account migration authority on required PostgreSQL 18', () => {
  const allocations = [];
  const children = new Set();
  let legacyDirectory;
  let preOauthStateDirectory;

  beforeAll(() => {
    if (!process.env.M19_PG_ADMIN_URL || !process.env.M19_EXPECTED_PG_DATA_DIR ||
        !process.env.M19_EXPECTED_PG_PORT || !process.env.M19_TEST_RUN_ID ||
        !process.env.ACCOUNT_MIGRATION_NEGATIVE_FRESH_URL ||
        !process.env.ACCOUNT_MIGRATION_NEGATIVE_UPGRADE_URL) {
      throw new Error('Required disposable PostgreSQL 18 identity is missing');
    }
    negativeControlConfiguration(
      process.env.ACCOUNT_MIGRATION_NEGATIVE_FRESH_URL,
      'pr71_negative_fresh'
    );
    negativeControlConfiguration(
      process.env.ACCOUNT_MIGRATION_NEGATIVE_UPGRADE_URL,
      'pr71_negative_upgrade'
    );
    legacyDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-migrations-001-009-'));
    for (const file of Object.keys(LEGACY_HASHES)) {
      fs.copyFileSync(path.join(MIGRATIONS_DIRECTORY, file), path.join(legacyDirectory, file));
    }
    preOauthStateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-migrations-001-010-'));
    for (const file of Object.keys(PROTECTED_MIGRATION_HASHES)) {
      fs.copyFileSync(path.join(MIGRATIONS_DIRECTORY, file), path.join(preOauthStateDirectory, file));
    }
  });

  afterAll(async () => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await waitForExit(child).catch(() => {});
    }
    for (const allocation of allocations) await allocation.cleanup();
    if (legacyDirectory) fs.rmSync(legacyDirectory, { recursive: true, force: true });
    if (preOauthStateDirectory) fs.rmSync(preOauthStateDirectory, { recursive: true, force: true });
  }, 120000);

  async function database(name) {
    const allocation = await createSuiteDatabase(name);
    allocations.push(allocation);
    return allocation;
  }

  async function applyLegacyMigrations(connectionString) {
    await runProductionMigrations(connectionString, legacyDirectory);
  }

  async function applyPreOauthStateMigrations(connectionString) {
    await runProductionMigrations(connectionString, preOauthStateDirectory);
  }

  test('real lexer handles exact legacy envelopes and protected provenance uses raw Git blobs', () => {
    const verifiedBase = runRequiredGit(['rev-parse', '--verify', `${BASE_SHA}^{commit}`]);
    expect(verifiedBase.stdout.length).toBeGreaterThan(0);

    const absentFromBase = runRequiredGit(
      ['cat-file', '-e', `${BASE_SHA}:${MIGRATION_010_REPOSITORY_PATH}`],
      { allowFailure: true }
    );
    expect(absentFromBase.status).toBe(128);
    expect(absentFromBase.stdout).toHaveLength(0);

    const introductionBlob = readRequiredGitBlob(
      MIGRATION_010_INTRODUCTION_SHA,
      MIGRATION_010_REPOSITORY_PATH
    );
    expect(introductionBlob).toHaveLength(MIGRATION_010_INTRODUCTION_LENGTH);
    expect(sha256(introductionBlob)).toBe(MIGRATION_010_INTRODUCTION_HASH);
    const absentFromIntroductionParent = runRequiredGit(
      ['cat-file', '-e', `${MIGRATION_010_INTRODUCTION_SHA}^:${MIGRATION_010_REPOSITORY_PATH}`],
      { allowFailure: true }
    );
    expect(absentFromIntroductionParent.status).toBe(128);
    expect(absentFromIntroductionParent.stdout).toHaveLength(0);

    const currentBlob = readRequiredGitBlob('HEAD', MIGRATION_010_REPOSITORY_PATH);
    expect(currentBlob).toHaveLength(MIGRATION_010_GIT_BLOB_LENGTH);
    expect(sha256(currentBlob)).toBe(MIGRATION_010_GIT_BLOB_HASH);
    for (const ref of REVIEWED_MIGRATION_010_HEADS) {
      const reviewedBlob = readRequiredGitBlob(ref, MIGRATION_010_REPOSITORY_PATH);
      expect(reviewedBlob).toHaveLength(MIGRATION_010_GIT_BLOB_LENGTH);
      expect(sha256(reviewedBlob)).toBe(MIGRATION_010_GIT_BLOB_HASH);
      expect(reviewedBlob.equals(currentBlob)).toBe(true);
    }

    for (const file of Object.keys(LEGACY_HASHES)) {
      const repositoryPath = `migrations/${file}`;
      const baseBlob = readRequiredGitBlob(BASE_SHA, repositoryPath);
      const currentLegacyBlob = readRequiredGitBlob('HEAD', repositoryPath);
      expect(currentLegacyBlob.equals(baseBlob)).toBe(true);
    }
    const migration011BeforeCorrection = readRequiredGitBlob(
      PRE_PROVENANCE_CORRECTION_SHA,
      MIGRATION_011_REPOSITORY_PATH
    );
    const migration011Current = readRequiredGitBlob('HEAD', MIGRATION_011_REPOSITORY_PATH);
    expect(migration011Current.equals(migration011BeforeCorrection)).toBe(true);

    const tampered = Buffer.from(currentBlob);
    const byteOffset = Math.floor(tampered.length / 2);
    tampered[byteOffset] ^= 0x01;
    expect(tampered.reduce(
      (differences, byte, index) => differences + (byte === currentBlob[index] ? 0 : 1),
      0
    )).toBe(1);
    expect(sha256(tampered)).not.toBe(MIGRATION_010_GIT_BLOB_HASH);

    const checkoutBytes = fs.readFileSync(path.join(MIGRATIONS_DIRECTORY, MIGRATION_010));
    const checkoutMatchesGitBlob = checkoutBytes.equals(currentBlob);
    if (process.platform === 'win32' && !checkoutMatchesGitBlob) {
      expect(checkoutBytes).toHaveLength(MIGRATION_010_CRLF_LENGTH);
      expect(sha256(checkoutBytes)).toBe(MIGRATION_010_CRLF_HASH);
    }
    console.info('[Migration Provenance]', {
      checkoutLength: checkoutBytes.length,
      checkoutMatchesGitBlob,
      checkoutSha256: sha256(checkoutBytes),
      gitBlobLength: currentBlob.length,
      gitBlobSha256: sha256(currentBlob),
    });

    for (const file of Object.keys(PROTECTED_MIGRATION_HASHES)) {
      const contents = fs.readFileSync(path.join(MIGRATIONS_DIRECTORY, file));
      const prepared = stripOuterTransaction(contents.toString('utf8'));
      if (LEGACY_HASHES[file]) {
        expect(prepared.hadOuterTransaction).toBe(true);
        expect(prepared.sql).not.toMatch(/^\s*BEGIN\s*;/i);
        expect(prepared.sql).not.toMatch(/COMMIT\s*;\s*$/i);
      } else {
        expect(prepared.hadOuterTransaction).toBe(false);
      }
    }

    const variant = '\uFEFF\n-- leading line comment\n/* leading /* nested */ block */\nBEGIN -- owner\n;\n' +
      'DO $body$ BEGIN PERFORM 1; END; $body$;\nSELECT \'COMMIT; -- data\';\n' +
      'COMMIT /* trailing block */;\n-- trailing line comment\n';
    const parsed = stripOuterTransaction(variant);
    expect(parsed.hadOuterTransaction).toBe(true);
    expect(parsed.sql).toContain('DO $body$ BEGIN PERFORM 1; END; $body$;');
    expect(parsed.sql).toContain('-- trailing line comment');
    expect(() => stripOuterTransaction('BEGIN; SELECT 1;')).toThrow('incomplete outer transaction envelope');
    expect(() => stripOuterTransaction('SELECT 1; COMMIT;')).toThrow('incomplete outer transaction envelope');
    expect(() => stripOuterTransaction('SELECT 1; BEGIN; SELECT 2;')).toThrow('top-level transaction control');
  });

  test('fresh and legacy-ledger upgrade paths use the real runner, preserve data, and converge', async () => {
    const fresh = await database('migration-fresh');
    const upgrade = await database('migration-upgrade');
    await runProductionMigrations(fresh.connectionString);
    await installGenuineBaseFixture(upgrade.connectionString);

    const organizationId = '72000000-0000-0000-0000-000000000001';
    const userId = '72000000-0000-0000-0000-000000000002';
    const leadId = '72000000-0000-0000-0000-000000000003';
    await queryWithClient(upgrade.connectionString, async client => {
      await client.query(
        `INSERT INTO organizations (id, name, owner_name, email, phone)
         VALUES ($1, 'Preserved Company', 'Preserved Owner', 'preserved-company@example.test', '+18605550111')`,
        [organizationId]
      );
      await client.query(
        `INSERT INTO users (id, organization_id, name, email, password_hash, phone, role, status)
         VALUES ($1, $2, 'Preserved Owner', 'preserved-owner@example.test', 'unchanged-hash', '+18605550112', 'owner', 'active')`,
        [userId, organizationId]
      );
      await client.query(
        `INSERT INTO leads (id, organization_id, caller_name, phone, service_type, notes)
         VALUES ($1, $2, 'Preserved Lead', '+18605550113', 'roofing', 'unchanged note')`,
        [leadId, organizationId]
      );
      await client.query(
        `INSERT INTO notification_preferences (
           organization_id, email_new_lead, email_call_summary,
           email_appointment, sms_new_lead, sms_urgent,
           notification_email, notification_phone
         ) VALUES ($1, TRUE, NULL, TRUE, TRUE, NULL, $2, $3)`,
        [organizationId, 'legacy-alerts@example.test', '+18605550114']
      );
      await client.query(`
        CREATE TABLE organization_account_preferences (
          organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE RESTRICT,
          preferences JSONB NOT NULL DEFAULT '{}',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT organization_account_preferences_object_check
            CHECK (jsonb_typeof(preferences) = 'object')
        )
      `);
      await client.query(
        `INSERT INTO organization_account_preferences (organization_id, preferences)
         VALUES ($1, $2::jsonb)`,
        [organizationId, JSON.stringify({
          theme: 'dark',
          density: 'compact',
          emailEnabled: true,
          notifications: { smsUrgent: true },
        })]
      );
    });

    await runProductionMigrations(upgrade.connectionString);
    const freshSchema = await schemaSnapshot(fresh.connectionString);
    const upgradeSchema = await schemaSnapshot(upgrade.connectionString);
    expect(upgradeSchema).toEqual(freshSchema);
    expectCanonicalMigrationLedger(freshSchema);
    expectCanonicalMigrationLedger(upgradeSchema);
    await queryWithClient(upgrade.connectionString, async client => {
      const preserved = await client.query(
        `SELECT u.name, u.email, u.password_hash, u.phone, l.caller_name, l.service_type, l.notes
           FROM users u JOIN leads l ON l.organization_id = u.organization_id
          WHERE u.id = $1 AND l.id = $2`,
        [userId, leadId]
      );
      expect(preserved.rows).toEqual([{
        caller_name: 'Preserved Lead',
        email: 'preserved-owner@example.test',
        name: 'Preserved Owner',
        notes: 'unchanged note',
        password_hash: 'unchanged-hash',
        phone: '+18605550112',
        service_type: 'roofing',
      }]);
      const notification = await client.query(
        `SELECT email_new_lead, email_call_summary, email_appointment,
                sms_new_lead, sms_urgent, notification_email, notification_phone
           FROM notification_preferences
          WHERE organization_id = $1`,
        [organizationId]
      );
      expect(notification.rows).toEqual([{
        email_new_lead: false,
        email_call_summary: false,
        email_appointment: false,
        sms_new_lead: false,
        sms_urgent: false,
        notification_email: 'legacy-alerts@example.test',
        notification_phone: '+18605550114',
      }]);
      const generic = await client.query(
        'SELECT preferences FROM organization_account_preferences WHERE organization_id = $1',
        [organizationId]
      );
      expect(generic.rows).toEqual([{ preferences: { theme: 'dark', density: 'compact' } }]);
      await expect(client.query(
        `UPDATE organization_account_preferences
            SET preferences = preferences || '{"smsEnabled":true}'::jsonb
          WHERE organization_id = $1`,
        [organizationId]
      )).rejects.toMatchObject({ code: '23514' });

      const defaultOrganizationId = '72000000-0000-0000-0000-000000000004';
      await client.query(
        `INSERT INTO organizations (id, name, owner_name, email, phone)
         VALUES ($1, 'Default Preference Company', 'Default Owner',
                 'default-preference@example.test', '+18605550115')`,
        [defaultOrganizationId]
      );
      await client.query(
        'INSERT INTO notification_preferences (organization_id) VALUES ($1)',
        [defaultOrganizationId]
      );
      const defaults = await client.query(
        `SELECT email_new_lead, email_call_summary, email_appointment,
                sms_new_lead, sms_urgent, notification_email, notification_phone
           FROM notification_preferences
          WHERE organization_id = $1`,
        [defaultOrganizationId]
      );
      expect(defaults.rows).toEqual([{
        email_new_lead: false,
        email_call_summary: false,
        email_appointment: false,
        sms_new_lead: false,
        sms_urgent: false,
        notification_email: '',
        notification_phone: '',
      }]);
      const ledger = await client.query('SELECT filename, checksum FROM _migrations ORDER BY filename');
      expect(ledger.rows).toHaveLength(productionMigrationFiles().length);
      expect(ledger.rows.every(row => /^[0-9a-f]{64}$/.test(String(row.checksum).trim()))).toBe(true);
    });
  }, 120000);

  test('branch-era TIMESTAMP NULL ledger is physically rebuilt, preserves a known moment, and marks unknown time', async () => {
    const allocation = await database('migration-branch-ledger-repair');
    const fresh = await database('migration-branch-ledger-fresh');
    await runProductionMigrations(fresh.connectionString);
    await installGenuineBaseFixture(allocation.connectionString, { ledgerDdl: BRANCH_ERA_LEDGER_DDL });
    const timeZone = 'America/New_York';
    let momentBeforeRepair;
    await queryWithClient(allocation.connectionString, async client => {
      await client.query(`SET TIME ZONE '${timeZone}'`);
      await client.query(`
        ALTER TABLE _migrations
          ALTER COLUMN applied_at SET DEFAULT NOW()
      `);
      await client.query(
        "UPDATE _migrations SET applied_at = TIMESTAMP '2024-01-02 03:04:05.123456' WHERE filename = '001_initial_schema.sql'"
      );
      await client.query(
        "UPDATE _migrations SET applied_at = NULL WHERE filename = '009_canonical_voice_provider_identity.sql'"
      );
      const branchDefinition = await client.query(
        `SELECT data_type, udt_name, is_nullable, column_default
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = '_migrations' AND column_name = 'applied_at'`
      );
      expect(branchDefinition.rows).toEqual([{
        data_type: 'timestamp without time zone',
        udt_name: 'timestamp',
        is_nullable: 'YES',
        column_default: 'now()',
      }]);
      const before = await client.query(`
        SELECT to_char(
                 (applied_at AT TIME ZONE current_setting('TimeZone')) AT TIME ZONE 'UTC',
                 'YYYY-MM-DD HH24:MI:SS.US'
               ) AS applied_moment
          FROM _migrations
         WHERE filename = '001_initial_schema.sql'
      `);
      momentBeforeRepair = before.rows[0].applied_moment;
      expect(momentBeforeRepair).toBe('2024-01-02 08:04:05.123456');
    });

    await runProductionMigrations(
      allocation.connectionString,
      MIGRATIONS_DIRECTORY,
      { options: `-c TimeZone=${timeZone}` }
    );

    const repairedSchema = await schemaSnapshot(allocation.connectionString);
    const freshSchema = await schemaSnapshot(fresh.connectionString);
    expect(repairedSchema).toEqual(freshSchema);
    expectCanonicalMigrationLedger(repairedSchema);
    expectCanonicalMigrationLedger(freshSchema);
    await queryWithClient(allocation.connectionString, async client => {
      const repaired = await client.query(`
        SELECT filename,
               applied_at IS NULL AS is_null,
               to_char(applied_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') AS applied_moment
          FROM _migrations
         WHERE filename IN ('001_initial_schema.sql', '009_canonical_voice_provider_identity.sql')
         ORDER BY filename
      `);
      expect(repaired.rows[0]).toEqual({
        filename: '001_initial_schema.sql',
        is_null: false,
        applied_moment: momentBeforeRepair,
      });
      expect(repaired.rows[1]).toEqual({
        filename: '009_canonical_voice_provider_identity.sql',
        is_null: false,
        applied_moment: null,
      });
      const unknownTime = await client.query(
        "SELECT applied_at::text AS applied_at FROM _migrations WHERE filename = '009_canonical_voice_provider_identity.sql'"
      );
      expect(unknownTime.rows).toEqual([{ applied_at: '-infinity' }]);
      const newlyExecuted = await client.query(
        `SELECT filename, isfinite(applied_at) AS is_finite
           FROM _migrations
          WHERE filename = ANY($1::text[])
          ORDER BY filename`,
        [[MIGRATION_010, MIGRATION_011]]
      );
      expect(newlyExecuted.rows).toEqual([
        { filename: MIGRATION_010, is_finite: true },
        { filename: MIGRATION_011, is_finite: true },
      ]);
    });
  }, 120000);

  test('genuine prior ledger rows, known timestamps, sequence state, checksums, and uniqueness are durable', async () => {
    const allocation = await database('migration-ledger');
    await installGenuineBaseFixture(allocation.connectionString);
    await queryWithClient(allocation.connectionString, async client => {
      await client.query(`
        ALTER TABLE _migrations
          ALTER COLUMN applied_at TYPE TIMESTAMPTZ
            USING applied_at AT TIME ZONE 'UTC',
          ALTER COLUMN applied_at SET NOT NULL,
          ALTER COLUMN applied_at SET DEFAULT NOW()
      `);
      await client.query('ALTER TABLE _migrations ADD COLUMN checksum CHAR(64)');
      await client.query(
        "UPDATE _migrations SET applied_at = TIMESTAMPTZ '2021-06-07 08:09:10.123456+00' WHERE filename = '001_initial_schema.sql'"
      );
      await client.query("SELECT setval('public._migrations_id_seq', 750, true)");
    });
    const genuinePrior = await queryWithClient(allocation.connectionString, client =>
      client.query('SELECT id, filename, checksum, applied_at FROM _migrations ORDER BY filename').then(result => result.rows)
    );
    expect(genuinePrior).toHaveLength(9);

    await runProductionMigrations(allocation.connectionString);
    const preservedPrior = await queryWithClient(allocation.connectionString, client =>
      client.query(
        `SELECT id, filename, applied_at
           FROM _migrations
          WHERE filename = ANY($1::text[])
          ORDER BY filename`,
        [Object.keys(LEGACY_HASHES)]
      ).then(result => result.rows)
    );
    expect(preservedPrior).toEqual(genuinePrior.map(({ id, filename, applied_at }) => ({ id, filename, applied_at })));
    expectCanonicalMigrationLedger(await schemaSnapshot(allocation.connectionString));
    const before = await queryWithClient(allocation.connectionString, client =>
      client.query('SELECT id, filename, checksum, applied_at FROM _migrations ORDER BY filename').then(result => result.rows)
    );
    expect(before).toHaveLength(productionMigrationFiles().length);
    for (const row of before) {
      expect(String(row.checksum).trim()).toBe(sha256(fs.readFileSync(path.join(MIGRATIONS_DIRECTORY, row.filename))));
    }

    await runProductionMigrations(allocation.connectionString);
    const after = await queryWithClient(allocation.connectionString, client =>
      client.query('SELECT id, filename, checksum, applied_at FROM _migrations ORDER BY filename').then(result => result.rows)
    );
    expect(after).toEqual(before);

    await queryWithClient(allocation.connectionString, async client => {
      const nextId = (await client.query(
        "INSERT INTO _migrations (filename, checksum) VALUES ('999_sequence_probe.sql', repeat('f', 64)) RETURNING id"
      )).rows[0].id;
      expect(nextId).toBe(751 + (productionMigrationFiles().length - Object.keys(LEGACY_HASHES).length));
      await client.query("DELETE FROM _migrations WHERE filename = '999_sequence_probe.sql'");
      await expect(client.query(
        'INSERT INTO _migrations (filename, checksum) VALUES ($1, $2)',
        [MIGRATION_010, '0'.repeat(64)]
      )).rejects.toMatchObject({ code: '23505' });
      await client.query('UPDATE _migrations SET checksum = $2 WHERE filename = $1', [MIGRATION_010, '0'.repeat(64)]);
    });
    await expect(runProductionMigrations(allocation.connectionString)).rejects.toThrow('checksum mismatch');
  }, 60000);

  test('catalog comparator detects the exact archived 9ec fresh/upgrade physical ordinal mismatch', async () => {
    const fresh = await schemaSnapshot(
      process.env.ACCOUNT_MIGRATION_NEGATIVE_FRESH_URL,
      'pr71_negative_fresh'
    );
    const upgrade = await schemaSnapshot(
      process.env.ACCOUNT_MIGRATION_NEGATIVE_UPGRADE_URL,
      'pr71_negative_upgrade'
    );
    expect(fresh.columns.filter(row => row.table_name === '_migrations').map(row => row.column_name)).toEqual([
      'id', 'filename', 'checksum', 'applied_at',
    ]);
    expect(upgrade.columns.filter(row => row.table_name === '_migrations').map(row => row.column_name)).toEqual([
      'id', 'filename', 'applied_at', 'checksum',
    ]);
    expect(upgrade).not.toEqual(fresh);
    expectCanonicalMigrationLedger(fresh);
    expect(() => expectCanonicalMigrationLedger(upgrade)).toThrow();
  }, 60000);

  test('canonical physical shape with stale sequence state is transactionally repaired beyond the greatest ID', async () => {
    const allocation = await database('migration-canonical-stale-sequence');
    await runProductionMigrations(allocation.connectionString);
    await queryWithClient(allocation.connectionString, async client => {
      await client.query(
        "UPDATE _migrations SET id = 250 WHERE filename = '001_initial_schema.sql'"
      );
      await client.query("SELECT setval('public._migrations_id_seq', 1, false)");
    });

    await runProductionMigrations(allocation.connectionString);
    expectCanonicalMigrationLedger(await schemaSnapshot(allocation.connectionString));
    await queryWithClient(allocation.connectionString, async client => {
      const inserted = await client.query(
        "INSERT INTO _migrations (filename, checksum) VALUES ('999_stale_sequence_probe.sql', repeat('e', 64)) RETURNING id"
      );
      expect(inserted.rows).toEqual([{ id: 251 }]);
      await client.query("DELETE FROM _migrations WHERE filename = '999_stale_sequence_probe.sql'");
    });
  }, 60000);

  test('supported legacy shape with swap-sensitive metadata fails closed without changing rows or metadata', async () => {
    const allocation = await database('migration-ledger-metadata');
    await installGenuineBaseFixture(allocation.connectionString);
    await queryWithClient(allocation.connectionString, async client => {
      await client.query("COMMENT ON TABLE _migrations IS 'historical migration ledger comment'");
      await client.query("COMMENT ON SEQUENCE _migrations_id_seq IS 'historical sequence comment'");
      await client.query('GRANT SELECT ON _migrations TO PUBLIC');
      await client.query('GRANT USAGE ON SEQUENCE _migrations_id_seq TO PUBLIC');
      await client.query('ALTER TABLE _migrations SET (fillfactor = 80)');
    });
    const before = await migrationLedgerPreservationSnapshot(allocation.connectionString);

    await expect(runProductionMigrations(allocation.connectionString)).rejects.toThrow(
      'Unsupported _migrations rebuild metadata'
    );

    const after = await migrationLedgerPreservationSnapshot(allocation.connectionString);
    expect(after).toEqual(before);
    await assertMigration010Absent(allocation.connectionString);
  }, 60000);

  test.each(LEDGER_CATALOG_COMMENT_CASES)(
    '$name comment fails closed with exact catalog, data, sequence, and containment preservation',
    async ({ name, targets, value, canonicalFixture }) => {
      const allocation = await database(`migration-ledger-comment-${name}`);
      if (canonicalFixture) await applyLegacyMigrations(allocation.connectionString);
      else await installGenuineBaseFixture(allocation.connectionString);
      await queryWithClient(allocation.connectionString, client =>
        setLedgerCatalogComments(client, targets, value)
      );
      const before = await migrationLedgerPreservationSnapshot(allocation.connectionString);
      expect(before.applicationRowCount).toBeGreaterThan(0);
      expect(before.constraintComments.filter(row => row.comment !== null)).toHaveLength(
        targets.filter(target => target.endsWith('Constraint')).length
      );
      expect(before.indexComments.filter(row => row.comment !== null)).toHaveLength(
        targets.filter(target => target.endsWith('Index')).length
      );
      if (value && typeof value === 'object') {
        const expectedComments = targets.map(target => value[target]);
        expect(new Set(expectedComments).size).toBe(targets.length);
        expect([
          ...before.constraintComments.map(row => row.comment),
          ...before.indexComments.map(row => row.comment),
        ].filter(comment => comment !== null).sort()).toEqual(expectedComments.sort());
      }

      await expectCatalogCommentRejection(allocation.connectionString, value);

      const after = await migrationLedgerPreservationSnapshot(allocation.connectionString);
      expect(after).toEqual(before);
      await assertMigration010Absent(allocation.connectionString);
    },
    120000
  );

  test('NULL catalog comments are supported and comment removal retries migrations exactly once', async () => {
    const allocation = await database('migration-ledger-comment-retry');
    await installGenuineBaseFixture(allocation.connectionString);
    const value = 'temporary comment before bounded retry';
    await queryWithClient(allocation.connectionString, client =>
      setLedgerCatalogComments(client, ALL_LEDGER_COMMENT_TARGETS, value)
    );
    const rejectedBefore = await migrationLedgerPreservationSnapshot(allocation.connectionString);
    await expectCatalogCommentRejection(allocation.connectionString, value);
    expect(await migrationLedgerPreservationSnapshot(allocation.connectionString)).toEqual(rejectedBefore);

    await queryWithClient(allocation.connectionString, client =>
      setLedgerCatalogComments(client, ALL_LEDGER_COMMENT_TARGETS, null)
    );
    await runProductionMigrations(allocation.connectionString);
    await runProductionMigrations(allocation.connectionString);
    await queryWithClient(allocation.connectionString, async client => {
      const state = await client.query(
        `SELECT
           (SELECT count(*)::int FROM _migrations WHERE filename = $1) AS migration_010_rows,
           (SELECT count(*)::int FROM _migrations WHERE filename = $2) AS migration_011_rows,
           to_regclass('public._migrations__canonical_rebuild')::text AS rebuild_relation,
           (SELECT count(*)::int
              FROM pg_constraint constraint_record
             WHERE constraint_record.conrelid = 'public._migrations'::regclass
               AND obj_description(constraint_record.oid, 'pg_constraint') IS NOT NULL) AS constraint_comments,
           (SELECT count(*)::int
              FROM pg_index index_record
             WHERE index_record.indrelid = 'public._migrations'::regclass
               AND obj_description(index_record.indexrelid, 'pg_class') IS NOT NULL) AS index_comments`,
        [MIGRATION_010, MIGRATION_011]
      );
      expect(state.rows).toEqual([{
        migration_010_rows: 1,
        migration_011_rows: 1,
        rebuild_relation: null,
        constraint_comments: 0,
        index_comments: 0,
      }]);
    });
  }, 120000);

  test('two concurrent production runners both reject catalog comments without mutation', async () => {
    const allocation = await database('migration-ledger-comment-concurrency');
    await installGenuineBaseFixture(allocation.connectionString);
    const value = 'concurrent catalog comment rejection';
    await queryWithClient(allocation.connectionString, client =>
      setLedgerCatalogComments(client, ALL_LEDGER_COMMENT_TARGETS, value)
    );
    const before = await migrationLedgerPreservationSnapshot(allocation.connectionString);
    const blocker = new Client({ connectionString: allocation.connectionString });
    await blocker.connect();
    await blocker.query('BEGIN');
    await blocker.query('LOCK TABLE _migrations IN ACCESS EXCLUSIVE MODE');

    const names = [`migration-comment-a-${process.pid}`, `migration-comment-b-${process.pid}`];
    const workers = names.map(name => startMigrationWorker(allocation.connectionString, name));
    workers.forEach(child => children.add(child));
    try {
      await Promise.all(workers.map(child => waitForMessage(child, 'ready')));
      const results = workers.map(child =>
        waitForMessage(child, 'result', 30000).then(() => 'unexpected_success', error => error.message)
      );
      workers.forEach(child => child.send({ type: 'run' }));
      const locks = await queryWithClient(allocation.connectionString, client => poll(async () => {
        const result = await client.query(
          `SELECT application.application_name, lock_record.granted
             FROM pg_locks lock_record
             JOIN pg_stat_activity application ON application.pid = lock_record.pid
            WHERE lock_record.locktype = 'advisory'
              AND application.application_name = ANY($1::text[])
            ORDER BY application.application_name, lock_record.granted`,
          [names]
        );
        return result.rows.some(row => row.granted === true) && result.rows.some(row => row.granted === false)
          ? result.rows : null;
      }, 'serialized catalog-comment rejection'));
      expect(locks.filter(row => row.granted)).toHaveLength(1);
      expect(locks.filter(row => !row.granted)).toHaveLength(1);
      await blocker.query('COMMIT');
      expect(await Promise.all(results)).toEqual(['migration_failed', 'migration_failed']);
      await Promise.all(workers.map(child => waitForExit(child)));
    } finally {
      await blocker.query('ROLLBACK').catch(() => {});
      await blocker.end();
    }
    expect(await migrationLedgerPreservationSnapshot(allocation.connectionString)).toEqual(before);
    await assertMigration010Absent(allocation.connectionString);
  }, 120000);

  test('ledger insertion failure rolls migration 010 schema back and a fault-free retry commits exactly once', async () => {
    const allocation = await database('migration-ledger-fault');
    await applyLegacyMigrations(allocation.connectionString);
    await queryWithClient(allocation.connectionString, client => client.query(`
      CREATE FUNCTION reject_account_migration_ledger() RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.filename = '${MIGRATION_010}' THEN
          RAISE EXCEPTION 'injected migration ledger rejection';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER reject_account_migration_ledger_trigger
        BEFORE INSERT ON _migrations
        FOR EACH ROW EXECUTE FUNCTION reject_account_migration_ledger();
    `));

    await expect(runProductionMigrations(allocation.connectionString)).rejects.toThrow('injected migration ledger rejection');
    await assertMigration010Absent(allocation.connectionString);
    await queryWithClient(allocation.connectionString, async client => {
      expect((await client.query('SELECT count(*)::int AS count FROM _migrations')).rows[0].count).toBe(9);
      await client.query('DROP TRIGGER reject_account_migration_ledger_trigger ON _migrations');
      await client.query('DROP FUNCTION reject_account_migration_ledger()');
    });

    await runProductionMigrations(allocation.connectionString);
    await runProductionMigrations(allocation.connectionString);
    await queryWithClient(allocation.connectionString, async client => {
      expect((await client.query('SELECT count(*)::int AS count FROM _migrations WHERE filename = $1', [MIGRATION_010])).rows[0].count).toBe(1);
      expect((await client.query("SELECT to_regclass('public.auth_sessions') AS table_name")).rows[0].table_name).toBe('auth_sessions');
    });
  }, 120000);

  test('migration 011 schema and ledger insertion roll back together and retry exactly once', async () => {
    const allocation = await database('migration-oauth-state-ledger-fault');
    await applyPreOauthStateMigrations(allocation.connectionString);
    await queryWithClient(allocation.connectionString, client => client.query(`
      CREATE FUNCTION reject_oauth_state_migration_ledger() RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.filename = '${MIGRATION_011}' THEN
          RAISE EXCEPTION 'injected oauth-state migration ledger rejection';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER reject_oauth_state_migration_ledger_trigger
        BEFORE INSERT ON _migrations
        FOR EACH ROW EXECUTE FUNCTION reject_oauth_state_migration_ledger();
    `));

    await expect(runProductionMigrations(allocation.connectionString)).rejects.toThrow(
      'injected oauth-state migration ledger rejection'
    );
    await queryWithClient(allocation.connectionString, async client => {
      const rolledBack = await client.query(
        `SELECT to_regclass('public.oauth_authorization_states') AS oauth_states,
                (SELECT count(*)::int
                   FROM pg_constraint
                  WHERE conrelid = 'public.auth_sessions'::regclass
                    AND conname = 'auth_sessions_organization_user_identity') AS session_identity_constraints,
                (SELECT count(*)::int FROM _migrations WHERE filename = $1) AS ledger_rows`,
        [MIGRATION_011]
      );
      expect(rolledBack.rows).toEqual([{
        oauth_states: null,
        session_identity_constraints: 0,
        ledger_rows: 0,
      }]);
      await client.query('DROP TRIGGER reject_oauth_state_migration_ledger_trigger ON _migrations');
      await client.query('DROP FUNCTION reject_oauth_state_migration_ledger()');
    });

    await runProductionMigrations(allocation.connectionString);
    await runProductionMigrations(allocation.connectionString);
    await queryWithClient(allocation.connectionString, async client => {
      const committed = await client.query(
        `SELECT to_regclass('public.oauth_authorization_states')::text AS oauth_states,
                (SELECT count(*)::int
                   FROM pg_constraint
                  WHERE conrelid = 'public.auth_sessions'::regclass
                    AND conname = 'auth_sessions_organization_user_identity') AS session_identity_constraints,
                (SELECT count(*)::int FROM _migrations WHERE filename = $1) AS ledger_rows`,
        [MIGRATION_011]
      );
      expect(committed.rows).toEqual([{
        oauth_states: 'oauth_authorization_states',
        session_identity_constraints: 1,
        ledger_rows: 1,
      }]);
    });
  }, 120000);

  test('two independent migration processes serialize on the advisory transaction lock', async () => {
    const allocation = await database('migration-concurrency');
    await applyLegacyMigrations(allocation.connectionString);
    await queryWithClient(allocation.connectionString, client => client.query(`
      CREATE FUNCTION delay_account_migration_ledger() RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.filename = '${MIGRATION_010}' THEN PERFORM pg_sleep(5); END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER delay_account_migration_ledger_trigger
        BEFORE INSERT ON _migrations
        FOR EACH ROW EXECUTE FUNCTION delay_account_migration_ledger();
    `));

    const names = [`migration-concurrent-a-${process.pid}`, `migration-concurrent-b-${process.pid}`];
    const workers = names.map(name => startMigrationWorker(allocation.connectionString, name));
    workers.forEach(child => children.add(child));
    await Promise.all(workers.map(child => waitForMessage(child, 'ready')));
    const results = workers.map(child => waitForMessage(child, 'result', 30000));
    workers.forEach(child => child.send({ type: 'run' }));

    const locks = await queryWithClient(allocation.connectionString, client => poll(async () => {
      const result = await client.query(
        `SELECT a.application_name, l.granted
           FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
          WHERE l.locktype = 'advisory' AND a.application_name = ANY($1::text[])
          ORDER BY a.application_name, l.granted`,
        [names]
      );
      return result.rows.some(row => row.granted === true) && result.rows.some(row => row.granted === false)
        ? result.rows : null;
    }, 'one granted and one waiting migration advisory lock'));
    expect(locks.filter(row => row.granted)).toHaveLength(1);
    expect(locks.filter(row => !row.granted)).toHaveLength(1);
    expect((await Promise.all(results)).map(result => result.outcome)).toEqual(['migrated', 'migrated']);
    await Promise.all(workers.map(child => waitForExit(child)));
    await queryWithClient(allocation.connectionString, async client => {
      expect((await client.query('SELECT count(*)::int AS count FROM _migrations WHERE filename = $1', [MIGRATION_010])).rows[0].count).toBe(1);
      await client.query('DROP TRIGGER delay_account_migration_ledger_trigger ON _migrations');
      await client.query('DROP FUNCTION delay_account_migration_ledger()');
    });
  }, 120000);

  test('terminating the owned migration backend before commit leaves neither schema nor ledger success', async () => {
    const allocation = await database('migration-process-death');
    await applyLegacyMigrations(allocation.connectionString);
    await queryWithClient(allocation.connectionString, client => client.query(`
      CREATE FUNCTION stall_account_migration_ledger() RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.filename = '${MIGRATION_010}' THEN PERFORM pg_sleep(30); END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER stall_account_migration_ledger_trigger
        BEFORE INSERT ON _migrations
        FOR EACH ROW EXECUTE FUNCTION stall_account_migration_ledger();
    `));

    const applicationName = `migration-terminated-${process.pid}`;
    const child = startMigrationWorker(allocation.connectionString, applicationName);
    children.add(child);
    await waitForMessage(child, 'ready');
    child.send({ type: 'run' });
    const activeBackend = await queryWithClient(allocation.connectionString, client => poll(async () => {
      const active = await client.query(
        `SELECT pid, application_name FROM pg_stat_activity
          WHERE application_name = $1 AND state = 'active'
            AND query LIKE 'INSERT INTO public._migrations%' AND wait_event = 'PgSleep'`,
        [applicationName]
      );
      return active.rows[0] || null;
    }, 'migration ledger insert before backend termination'));
    expect(activeBackend.application_name).toBe(applicationName);
    await queryWithClient(allocation.connectionString, async client => {
      const ownership = await client.query(
        'SELECT application_name FROM pg_stat_activity WHERE pid = $1',
        [activeBackend.pid]
      );
      expect(ownership.rows).toEqual([{ application_name: applicationName }]);
      const terminated = await client.query('SELECT pg_terminate_backend($1) AS terminated', [activeBackend.pid]);
      expect(terminated.rows[0].terminated).toBe(true);
    });
    await waitForExit(child);
    await queryWithClient(allocation.connectionString, client => poll(async () => {
      const active = await client.query('SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name = $1', [applicationName]);
      return active.rows[0].count === 0;
    }, 'terminated migration backend rollback'));
    await assertMigration010Absent(allocation.connectionString);

    await queryWithClient(allocation.connectionString, async client => {
      await client.query('DROP TRIGGER stall_account_migration_ledger_trigger ON _migrations');
      await client.query('DROP FUNCTION stall_account_migration_ledger()');
    });
    await runProductionMigrations(allocation.connectionString);
    await queryWithClient(allocation.connectionString, async client => {
      expect((await client.query('SELECT count(*)::int AS count FROM _migrations WHERE filename = $1', [MIGRATION_010])).rows[0].count).toBe(1);
    });
  }, 120000);

  test.each([
    ['blank identity', async (client, organizationId) => {
      await client.query(
        "INSERT INTO users (organization_id, name, email, password_hash, role, status) VALUES ($1, 'Blank', '', 'unused', 'owner', 'active')",
        [organizationId]
      );
    }, 'invalid normalized length'],
    ['duplicate normalized identity', async (client, organizationId) => {
      await client.query(
        `INSERT INTO users (organization_id, name, email, password_hash, role, status) VALUES
         ($1, 'First', 'Duplicate@Example.Test', 'unused', 'owner', 'active'),
         ($1, 'Second', 'duplicate@example.test', 'unused', 'member', 'active')`,
        [organizationId]
      );
    }, 'email normalization collision'],
  ])('%s aborts through the real runner without partial migration state', async (_name, arrange, diagnostic) => {
    const allocation = await database(`migration-${_name}`);
    await installGenuineBaseFixture(allocation.connectionString);
    await queryWithClient(allocation.connectionString, async client => {
      const organizationId = crypto.randomUUID();
      await client.query(
        "INSERT INTO organizations (id, name, email) VALUES ($1, 'Invalid Identity Org', $2)",
        [organizationId, `${organizationId}@example.test`]
      );
      await arrange(client, organizationId);
    });
    await expect(runProductionMigrations(allocation.connectionString)).rejects.toThrow(diagnostic);
    await assertMigration010Absent(allocation.connectionString);
    const rolledBackLedger = await schemaSnapshot(allocation.connectionString);
    expect(rolledBackLedger.columns.filter(row => row.table_name === '_migrations').map(row => row.column_name)).toEqual([
      'id', 'filename', 'applied_at',
    ]);
  }, 120000);
});
