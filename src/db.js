/**
 * PostgreSQL lifecycle and migration authority.
 *
 * A configured database is either fully migrated and ready or unavailable.
 * Authenticated/account traffic never falls back to files or process memory.
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DEFAULT_MIGRATIONS_DIRECTORY = path.join(__dirname, '..', 'migrations');
const MIGRATION_LOCK_KEY = '5643944089238424905';
const MIGRATION_FILENAME = /^(\d{3})_[a-z0-9_]+\.sql$/;
const PROTECTED_LEGACY_MIGRATION_CHECKSUMS = Object.freeze({
  '001_initial_schema.sql': '74ee47a852a376c3f5f8b2a5bf24579d24eb6a20dc8284e8b233a0159e858c14',
  '002_seed_data.sql': '370b2b2cd466817724f4788e104adef3f93d3d8a02bd877f252d1e3d6f588cd5',
  '003_voice_sessions.sql': '535a47115df60e96a7d18d8b7c557b378aa18391a19eb658750f86faa18d1e1f',
  '004_canonical_persistence_v2.sql': '097f398d0bf37982947d35b04890c396dee2d84ce8acdb34fa5434e13ba1263a',
  '005_canonical_organization_authority.sql': 'b45c61d2da94d6aba753d3d2bbd1ebf657af4626ff1bcbabd2e45434e0e529f6',
  '006_canonical_voice_sessions.sql': 'acde20fd0cfa4ef8e8899f036cac4dd82d9052c12c50cec28014c2ac3cc0daf7',
  '007_canonical_tax_authority.sql': 'c1838c6ea7cd83d12d2b9c3f9bf7740f0c5344d21f06873968527ad1318ac5a0',
  '008_canonical_demo_authority.sql': 'a71a0c49be60943ee52e041139c9db3b64c64cbeaf4449dec46571c721fbd1e0',
  '009_canonical_voice_provider_identity.sql': 'a521efdcf96cd90d11e505018f034fd2b93a4998da97823491b5195aa78aef98',
});

let pool = null;
let dbAvailable = false;
let readinessFailure = null;

function getPool() {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;

  pool = new Pool({
    connectionString,
    ssl: connectionString.includes('railway') ? { rejectUnauthorized: false } : false,
    max: parseInt(process.env.DB_POOL_MAX || '20', 10),
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
  });
  pool.on('error', (error) => {
    dbAvailable = false;
    readinessFailure = 'postgres_pool_error';
    console.error('[DB] Pool error:', error.message);
  });
  return pool;
}

function checksum(contents) {
  return crypto.createHash('sha256').update(contents).digest('hex');
}

function canonicalizeMigrationChecksumBytes(contents) {
  if (!Buffer.isBuffer(contents)) throw new TypeError('Migration checksum input must be a Buffer');

  let crlfCount = 0;
  let lfCount = 0;
  for (let index = 0; index < contents.length; index += 1) {
    if (contents[index] === 0x0d) {
      if (contents[index + 1] !== 0x0a) {
        throw new Error('Migration contains a lone carriage return');
      }
      crlfCount += 1;
      index += 1;
    } else if (contents[index] === 0x0a) {
      lfCount += 1;
    }
  }

  if (crlfCount > 0 && lfCount > 0) {
    throw new Error('Migration contains mixed line endings');
  }
  if (crlfCount === 0) return contents;

  const canonical = Buffer.allocUnsafe(contents.length - crlfCount);
  let target = 0;
  for (let source = 0; source < contents.length; source += 1) {
    if (contents[source] === 0x0d) {
      canonical[target] = 0x0a;
      target += 1;
      source += 1;
    } else {
      canonical[target] = contents[source];
      target += 1;
    }
  }
  return canonical;
}

function dollarQuoteAt(sql, offset) {
  if (sql[offset] !== '$') return null;
  const match = sql.slice(offset).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);
  return match ? match[0] : null;
}

function scanTopLevelStatements(sql) {
  const statements = [];
  let tokens = [];
  let index = 0;

  function addToken(value, start, end) {
    tokens.push({ value, start, end });
  }

  while (index < sql.length) {
    const character = sql[index];

    if ((index === 0 && character === '\uFEFF') || /\s/.test(character)) {
      index += 1;
      continue;
    }

    if (character === '-' && sql[index + 1] === '-') {
      const newline = sql.indexOf('\n', index + 2);
      index = newline === -1 ? sql.length : newline + 1;
      continue;
    }

    if (character === '/' && sql[index + 1] === '*') {
      let depth = 1;
      const start = index;
      index += 2;
      while (index < sql.length && depth > 0) {
        if (sql[index] === '/' && sql[index + 1] === '*') {
          depth += 1;
          index += 2;
        } else if (sql[index] === '*' && sql[index + 1] === '/') {
          depth -= 1;
          index += 2;
        } else {
          index += 1;
        }
      }
      if (depth !== 0) throw new Error(`Unterminated SQL block comment at offset ${start}`);
      continue;
    }

    if (character === "'") {
      const start = index;
      index += 1;
      let closed = false;
      while (index < sql.length) {
        if (sql[index] === "'" && sql[index + 1] === "'") {
          index += 2;
        } else if (sql[index] === '\\') {
          index += Math.min(2, sql.length - index);
        } else if (sql[index] === "'") {
          index += 1;
          closed = true;
          break;
        } else {
          index += 1;
        }
      }
      if (!closed) throw new Error(`Unterminated SQL string at offset ${start}`);
      addToken('<string>', start, index);
      continue;
    }

    if (character === '"') {
      const start = index;
      index += 1;
      let closed = false;
      while (index < sql.length) {
        if (sql[index] === '"' && sql[index + 1] === '"') {
          index += 2;
        } else if (sql[index] === '"') {
          index += 1;
          closed = true;
          break;
        } else {
          index += 1;
        }
      }
      if (!closed) throw new Error(`Unterminated SQL identifier at offset ${start}`);
      addToken('<identifier>', start, index);
      continue;
    }

    const dollarQuote = dollarQuoteAt(sql, index);
    if (dollarQuote) {
      const start = index;
      const closing = sql.indexOf(dollarQuote, index + dollarQuote.length);
      if (closing === -1) throw new Error(`Unterminated SQL dollar quote at offset ${start}`);
      index = closing + dollarQuote.length;
      addToken('<dollar-quote>', start, index);
      continue;
    }

    if (character === ';') {
      if (tokens.length > 0) {
        statements.push({
          start: tokens[0].start,
          end: index + 1,
          terminated: true,
          tokens: tokens.map(token => token.value),
        });
        tokens = [];
      }
      index += 1;
      continue;
    }

    if (/[A-Za-z_]/.test(character)) {
      const start = index;
      index += 1;
      while (index < sql.length && /[A-Za-z0-9_$]/.test(sql[index])) index += 1;
      addToken(sql.slice(start, index).toUpperCase(), start, index);
      continue;
    }

    addToken(character, index, index + 1);
    index += 1;
  }

  if (tokens.length > 0) {
    statements.push({
      start: tokens[0].start,
      end: sql.length,
      terminated: false,
      tokens: tokens.map(token => token.value),
    });
  }
  return statements;
}

function isExactStatement(statement, keyword) {
  return Boolean(statement && statement.terminated &&
    statement.tokens.length === 1 && statement.tokens[0] === keyword);
}

function isTransactionControl(statement) {
  const first = statement && statement.tokens[0];
  if (['BEGIN', 'START', 'COMMIT', 'END', 'ROLLBACK', 'ABORT', 'SAVEPOINT', 'RELEASE'].includes(first)) {
    return true;
  }
  return first === 'PREPARE' && statement.tokens[1] === 'TRANSACTION' ||
    first === 'SET' && statement.tokens[1] === 'TRANSACTION';
}

function stripOuterTransaction(sql) {
  const source = String(sql);
  const statements = scanTopLevelStatements(source);
  const first = statements[0];
  const last = statements[statements.length - 1];
  const beginsTransaction = isExactStatement(first, 'BEGIN');
  const commitsTransaction = isExactStatement(last, 'COMMIT');

  if (beginsTransaction !== commitsTransaction) {
    throw new Error('Migration has an incomplete outer transaction envelope');
  }

  let body = source;
  let bodyStatements = statements;
  if (beginsTransaction) {
    if (statements.length < 2) throw new Error('Migration transaction envelope has no body');
    body = source.slice(0, first.start) + source.slice(first.end, last.start) + source.slice(last.end);
    bodyStatements = statements.slice(1, -1);
  }

  if (bodyStatements.some(isTransactionControl)) {
    throw new Error('Migration body contains top-level transaction control');
  }

  return {
    hadOuterTransaction: beginsTransaction,
    sql: body.replace(/^\uFEFF/, ''),
  };
}

function loadMigrations(migrationsDirectory) {
  if (!fs.existsSync(migrationsDirectory)) throw new Error('migrations directory is required');
  const files = fs.readdirSync(migrationsDirectory).filter(file => file.endsWith('.sql')).sort();
  const identities = new Set();

  return files.map(file => {
    const match = file.match(MIGRATION_FILENAME);
    if (!match) throw new Error(`Invalid migration filename: ${file}`);
    if (identities.has(match[1])) throw new Error(`Duplicate migration identity: ${match[1]}`);
    identities.add(match[1]);

    const runtimeContents = fs.readFileSync(path.join(migrationsDirectory, file));
    let contents;
    try {
      contents = canonicalizeMigrationChecksumBytes(runtimeContents);
    } catch (_) {
      throw new Error(`Migration has unsupported line endings: ${file}`);
    }
    const digest = checksum(contents);
    const legacyDigest = PROTECTED_LEGACY_MIGRATION_CHECKSUMS[file];
    if (legacyDigest && digest !== legacyDigest) {
      throw new Error(`Protected legacy migration checksum mismatch: ${file}`);
    }

    const prepared = stripOuterTransaction(contents.toString('utf8'));
    if (legacyDigest && !prepared.hadOuterTransaction) {
      throw new Error(`Protected legacy migration envelope missing: ${file}`);
    }
    if (!legacyDigest && prepared.hadOuterTransaction) {
      throw new Error(`Migration must rely on the production transaction owner: ${file}`);
    }
    return { digest, file, sql: prepared.sql };
  });
}

const CANONICAL_LEDGER_COLUMNS = Object.freeze([
  {
    ordinal_position: 1,
    column_name: 'id',
    data_type: 'integer',
    is_nullable: 'NO',
    column_default: "nextval('_migrations_id_seq'::regclass)",
  },
  {
    ordinal_position: 2,
    column_name: 'filename',
    data_type: 'character varying(255)',
    is_nullable: 'NO',
    column_default: '',
  },
  {
    ordinal_position: 3,
    column_name: 'checksum',
    data_type: 'character(64)',
    is_nullable: 'YES',
    column_default: '',
  },
  {
    ordinal_position: 4,
    column_name: 'applied_at',
    data_type: 'timestamp with time zone',
    is_nullable: 'NO',
    column_default: 'now()',
  },
]);

const CANONICAL_LEDGER_CONSTRAINTS = Object.freeze([
  { conname: '_migrations_applied_at_not_null', contype: 'n', definition: 'NOT NULL applied_at', condeferrable: false, condeferred: false, convalidated: true, backing_index: '' },
  { conname: '_migrations_filename_key', contype: 'u', definition: 'UNIQUE (filename)', condeferrable: false, condeferred: false, convalidated: true, backing_index: '_migrations_filename_key' },
  { conname: '_migrations_filename_not_null', contype: 'n', definition: 'NOT NULL filename', condeferrable: false, condeferred: false, convalidated: true, backing_index: '' },
  { conname: '_migrations_id_not_null', contype: 'n', definition: 'NOT NULL id', condeferrable: false, condeferred: false, convalidated: true, backing_index: '' },
  { conname: '_migrations_pkey', contype: 'p', definition: 'PRIMARY KEY (id)', condeferrable: false, condeferred: false, convalidated: true, backing_index: '_migrations_pkey' },
]);

const CANONICAL_LEDGER_INDEXES = Object.freeze([
  {
    indexname: '_migrations_filename_key',
    indexdef: 'CREATE UNIQUE INDEX _migrations_filename_key ON public._migrations USING btree (filename)',
    indisunique: true,
    indisprimary: false,
    indisvalid: true,
    indisready: true,
    owning_constraint: '_migrations_filename_key',
  },
  {
    indexname: '_migrations_pkey',
    indexdef: 'CREATE UNIQUE INDEX _migrations_pkey ON public._migrations USING btree (id)',
    indisunique: true,
    indisprimary: true,
    indisvalid: true,
    indisready: true,
    owning_constraint: '_migrations_pkey',
  },
]);

function rowsEqual(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

async function inspectMigrationLedger(client) {
  const relation = await client.query(`
    SELECT class.relkind, class.relpersistence, class.relispartition,
           class.relrowsecurity, class.relforcerowsecurity
      FROM pg_class class
      JOIN pg_namespace namespace ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'public' AND class.relname = '_migrations'
  `);
  if (relation.rows.length === 0) return null;
  if (relation.rows.length !== 1) throw new Error('Unsupported _migrations relation identity');

  const columns = await client.query(`
    SELECT attribute.attnum::int AS ordinal_position,
           attribute.attname AS column_name,
           format_type(attribute.atttypid, attribute.atttypmod) AS data_type,
           CASE WHEN attribute.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable,
           COALESCE(pg_get_expr(default_value.adbin, default_value.adrelid), '') AS column_default
      FROM pg_attribute attribute
      LEFT JOIN pg_attrdef default_value
        ON default_value.adrelid = attribute.attrelid
       AND default_value.adnum = attribute.attnum
     WHERE attribute.attrelid = 'public._migrations'::regclass
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
     ORDER BY attribute.attnum
  `);
  const constraints = await client.query(`
    SELECT constraint_record.conname,
           constraint_record.contype,
           pg_get_constraintdef(constraint_record.oid) AS definition,
           constraint_record.condeferrable,
           constraint_record.condeferred,
           constraint_record.convalidated,
           CASE WHEN constraint_record.conindid = 0 THEN ''
                ELSE constraint_record.conindid::regclass::text END AS backing_index
      FROM pg_constraint constraint_record
     WHERE constraint_record.conrelid = 'public._migrations'::regclass
     ORDER BY constraint_record.conname
  `);
  const indexes = await client.query(`
    SELECT indexes.indexname, indexes.indexdef,
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
     WHERE indexes.schemaname = 'public' AND indexes.tablename = '_migrations'
     ORDER BY indexes.indexname
  `);
  const sequence = await client.query(`
    SELECT sequence_namespace.nspname AS sequence_schema,
           sequence_class.relname AS sequence_name,
           attribute.attname AS owned_column,
           dependency.deptype AS dependency_type,
           format_type(sequence.seqtypid, NULL) AS data_type,
           sequence.seqstart::text AS start_value,
           sequence.seqincrement::text AS increment_by,
           sequence.seqmin::text AS minimum_value,
           sequence.seqmax::text AS maximum_value,
           sequence.seqcache::text AS cache_size,
           sequence.seqcycle AS cycles
      FROM pg_class sequence_class
      JOIN pg_namespace sequence_namespace ON sequence_namespace.oid = sequence_class.relnamespace
      JOIN pg_sequence sequence ON sequence.seqrelid = sequence_class.oid
      JOIN pg_depend dependency
        ON dependency.classid = 'pg_class'::regclass
       AND dependency.objid = sequence_class.oid
       AND dependency.refclassid = 'pg_class'::regclass
       AND dependency.refobjid = 'public._migrations'::regclass
       AND dependency.deptype IN ('a', 'i')
      JOIN pg_attribute attribute
        ON attribute.attrelid = dependency.refobjid
       AND attribute.attnum = dependency.refobjsubid
     ORDER BY sequence_schema, sequence_name
  `);
  return {
    relation: relation.rows[0],
    columns: columns.rows,
    constraints: constraints.rows,
    indexes: indexes.rows,
    sequence: sequence.rows,
  };
}

function isCanonicalMigrationLedger(ledger) {
  return ledger &&
    rowsEqual(ledger.relation, {
      relkind: 'r',
      relpersistence: 'p',
      relispartition: false,
      relrowsecurity: false,
      relforcerowsecurity: false,
    }) &&
    rowsEqual(ledger.columns, CANONICAL_LEDGER_COLUMNS) &&
    rowsEqual(ledger.constraints, CANONICAL_LEDGER_CONSTRAINTS) &&
    rowsEqual(ledger.indexes, CANONICAL_LEDGER_INDEXES) &&
    rowsEqual(ledger.sequence, [{
      sequence_schema: 'public',
      sequence_name: '_migrations_id_seq',
      owned_column: 'id',
      dependency_type: 'a',
      data_type: 'integer',
      start_value: '1',
      increment_by: '1',
      minimum_value: '1',
      maximum_value: '2147483647',
      cache_size: '1',
      cycles: false,
    }]);
}

function validateSupportedLegacyLedger(ledger) {
  if (!ledger || !rowsEqual(ledger.relation, {
    relkind: 'r',
    relpersistence: 'p',
    relispartition: false,
    relrowsecurity: false,
    relforcerowsecurity: false,
  })) {
    throw new Error('Unsupported _migrations relation shape');
  }

  const columns = new Map(ledger.columns.map(column => [column.column_name, column]));
  const allowedNames = new Set(['id', 'filename', 'checksum', 'applied_at']);
  if (columns.size !== ledger.columns.length || ledger.columns.some(column => !allowedNames.has(column.column_name)) ||
      !columns.has('id') || !columns.has('filename') || !columns.has('applied_at')) {
    throw new Error('Unsupported _migrations column shape');
  }
  const id = columns.get('id');
  const filename = columns.get('filename');
  const checksumColumn = columns.get('checksum');
  const appliedAt = columns.get('applied_at');
  if (id.data_type !== 'integer' || id.is_nullable !== 'NO' ||
      id.column_default !== "nextval('_migrations_id_seq'::regclass)" ||
      filename.data_type !== 'character varying(255)' || filename.is_nullable !== 'NO' || filename.column_default !== '' ||
      (checksumColumn && (checksumColumn.data_type !== 'character(64)' ||
        checksumColumn.is_nullable !== 'YES' || checksumColumn.column_default !== '')) ||
      !['timestamp without time zone', 'timestamp with time zone'].includes(appliedAt.data_type) ||
      !['YES', 'NO'].includes(appliedAt.is_nullable) ||
      !['', 'now()'].includes(appliedAt.column_default)) {
    throw new Error('Unsupported _migrations column definition');
  }

  const keyedConstraints = ledger.constraints.filter(constraint => constraint.contype !== 'n');
  if (!rowsEqual(keyedConstraints, [
    { conname: '_migrations_filename_key', contype: 'u', definition: 'UNIQUE (filename)', condeferrable: false, condeferred: false, convalidated: true, backing_index: '_migrations_filename_key' },
    { conname: '_migrations_pkey', contype: 'p', definition: 'PRIMARY KEY (id)', condeferrable: false, condeferred: false, convalidated: true, backing_index: '_migrations_pkey' },
  ]) || ledger.constraints.some(constraint => !['n', 'p', 'u'].includes(constraint.contype))) {
    throw new Error('Unsupported _migrations constraint shape');
  }
  if (!rowsEqual(ledger.indexes, CANONICAL_LEDGER_INDEXES) || !rowsEqual(ledger.sequence, [{
    sequence_schema: 'public',
    sequence_name: '_migrations_id_seq',
    owned_column: 'id',
    dependency_type: 'a',
    data_type: 'integer',
    start_value: '1',
    increment_by: '1',
    minimum_value: '1',
    maximum_value: '2147483647',
    cache_size: '1',
    cycles: false,
  }])) {
    throw new Error('Unsupported _migrations index or sequence ownership');
  }
}

async function assertLedgerRebuildHasNoUnsupportedDependencies(client) {
  const metadata = await client.query(`
    SELECT
      (table_class.relowner = (current_user::regrole)::oid) AS table_owner_is_current,
      (table_class.relacl IS NULL) AS table_acl_is_default,
      (obj_description(table_class.oid, 'pg_class') IS NULL) AS table_comment_is_empty,
      (table_class.reloptions IS NULL) AS table_options_are_default,
      (table_class.reltablespace = 0) AS table_tablespace_is_default,
      (table_class.relreplident = 'd') AS table_replica_identity_is_default,
      (table_access_method.amname = 'heap') AS table_access_method_is_default,
      (sequence_class.relowner = (current_user::regrole)::oid) AS sequence_owner_is_current,
      (sequence_class.relacl IS NULL) AS sequence_acl_is_default,
      (obj_description(sequence_class.oid, 'pg_class') IS NULL) AS sequence_comment_is_empty,
      (sequence_class.reloptions IS NULL) AS sequence_options_are_default,
      (sequence_class.reltablespace = 0) AS sequence_tablespace_is_default,
      (SELECT count(*)::int
         FROM pg_attribute attribute
         JOIN pg_type attribute_type ON attribute_type.oid = attribute.atttypid
        WHERE attribute.attrelid = table_class.oid
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
          AND (attribute.attacl IS NOT NULL
            OR attribute.attoptions IS NOT NULL
            OR attribute.attfdwoptions IS NOT NULL
            OR attribute.attstattarget <> -1
            OR attribute.attidentity <> ''
            OR attribute.attgenerated <> ''
            OR attribute.attstorage <> attribute_type.typstorage
            OR COALESCE(attribute.attcompression::text, '') <> ''
            OR attribute.attcollation <> attribute_type.typcollation
            OR col_description(table_class.oid, attribute.attnum) IS NOT NULL)) AS noncanonical_column_metadata,
      (SELECT count(*)::int FROM pg_seclabel security_label
        WHERE (security_label.classoid = 'pg_class'::regclass
          AND security_label.objoid IN (table_class.oid, sequence_class.oid))) AS security_labels,
      (SELECT count(*)::int FROM pg_statistic_ext
        WHERE stxrelid = table_class.oid) AS extended_statistics,
      (SELECT count(*)::int FROM pg_inherits
        WHERE inhrelid = table_class.oid OR inhparent = table_class.oid) AS inheritance_links,
      (SELECT count(*)::int FROM pg_rewrite
        WHERE ev_class = table_class.oid) AS rules,
      (SELECT count(*)::int FROM pg_publication_rel
        WHERE prrelid = table_class.oid) AS publication_memberships
      FROM pg_class table_class
      JOIN pg_namespace table_namespace ON table_namespace.oid = table_class.relnamespace
      JOIN pg_am table_access_method ON table_access_method.oid = table_class.relam
      JOIN pg_class sequence_class ON sequence_class.oid = 'public._migrations_id_seq'::regclass
     WHERE table_namespace.nspname = 'public' AND table_class.relname = '_migrations'
  `);
  const expectedMetadata = {
    table_owner_is_current: true,
    table_acl_is_default: true,
    table_comment_is_empty: true,
    table_options_are_default: true,
    table_tablespace_is_default: true,
    table_replica_identity_is_default: true,
    table_access_method_is_default: true,
    sequence_owner_is_current: true,
    sequence_acl_is_default: true,
    sequence_comment_is_empty: true,
    sequence_options_are_default: true,
    sequence_tablespace_is_default: true,
    noncanonical_column_metadata: 0,
    security_labels: 0,
    extended_statistics: 0,
    inheritance_links: 0,
    rules: 0,
    publication_memberships: 0,
  };
  if (!rowsEqual(metadata.rows[0], expectedMetadata)) {
    throw new Error('Unsupported _migrations rebuild metadata');
  }

  const dependencies = await client.query(`
    SELECT
      (SELECT count(*)::int FROM pg_trigger
        WHERE tgrelid = 'public._migrations'::regclass AND NOT tgisinternal) AS triggers,
      (SELECT count(*)::int FROM pg_constraint
        WHERE confrelid = 'public._migrations'::regclass) AS referencing_constraints,
      (SELECT count(DISTINCT dependent_class.oid)::int
         FROM pg_depend dependency
         JOIN pg_rewrite rewrite_rule
           ON rewrite_rule.oid = dependency.objid
          AND dependency.classid = 'pg_rewrite'::regclass
         JOIN pg_class dependent_class ON dependent_class.oid = rewrite_rule.ev_class
        WHERE dependency.refobjid = 'public._migrations'::regclass
          AND dependent_class.oid <> 'public._migrations'::regclass) AS dependent_views,
      (SELECT count(*)::int FROM pg_policy
        WHERE polrelid = 'public._migrations'::regclass) AS policies
  `);
  if (Object.values(dependencies.rows[0]).some(count => count !== 0)) {
    throw new Error('Unsupported _migrations rebuild dependency');
  }
  const temporaryName = await client.query(
    "SELECT to_regclass('public._migrations__canonical_rebuild') AS relation"
  );
  if (temporaryName.rows[0].relation !== null) {
    throw new Error('Reserved migration-ledger rebuild relation already exists');
  }
}

async function createCanonicalMigrationLedger(client) {
  await client.query(`
    CREATE TABLE public._migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) UNIQUE NOT NULL,
      checksum CHAR(64),
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function assertMigrationLedgerCatalogCommentsAbsent(client) {
  const comments = await client.query(`
    SELECT
      (SELECT count(*)::int
         FROM pg_constraint constraint_record
        WHERE constraint_record.conrelid = 'public._migrations'::regclass
          AND obj_description(constraint_record.oid, 'pg_constraint') IS NOT NULL) AS constraint_comments,
      (SELECT count(*)::int
         FROM pg_index index_record
        WHERE index_record.indrelid = 'public._migrations'::regclass
          AND obj_description(index_record.indexrelid, 'pg_class') IS NOT NULL) AS index_comments
  `);
  if (comments.rows[0].constraint_comments !== 0 || comments.rows[0].index_comments !== 0) {
    throw new Error('Unsupported _migrations catalog comments');
  }
}

async function readMigrationLedgerSequencePosition(client) {
  const state = (await client.query(`
    SELECT last_value::text AS last_value, is_called
      FROM public._migrations_id_seq
  `)).rows[0];
  const maximumId = (await client.query(
    'SELECT COALESCE(MAX(id), 0)::text AS maximum_id FROM public._migrations'
  )).rows[0].maximum_id;
  const lastValue = BigInt(state.last_value);
  const maximum = BigInt(maximumId);
  const nextValue = state.is_called ? lastValue + 1n : lastValue;
  return { isCalled: state.is_called, lastValue, maximum, nextValue };
}

async function normalizeMigrationLedger(client) {
  let ledger = await inspectMigrationLedger(client);
  if (!ledger) {
    await createCanonicalMigrationLedger(client);
    await assertMigrationLedgerCatalogCommentsAbsent(client);
    return;
  }

  await client.query('LOCK TABLE public._migrations IN ACCESS EXCLUSIVE MODE');
  ledger = await inspectMigrationLedger(client);
  await assertMigrationLedgerCatalogCommentsAbsent(client);
  const canonicalShape = isCanonicalMigrationLedger(ledger);
  if (!canonicalShape) validateSupportedLegacyLedger(ledger);
  const sequencePosition = await readMigrationLedgerSequencePosition(client);
  if (sequencePosition.maximum >= 2147483647n || sequencePosition.nextValue > 2147483647n) {
    throw new Error('Unsupported _migrations sequence state');
  }
  if (canonicalShape && sequencePosition.nextValue > sequencePosition.maximum) return;

  await assertLedgerRebuildHasNoUnsupportedDependencies(client);
  let preservedLastValue = sequencePosition.lastValue;
  let preservedIsCalled = sequencePosition.isCalled;
  const priorNextValue = preservedIsCalled ? preservedLastValue + 1n : preservedLastValue;
  if (priorNextValue <= sequencePosition.maximum) {
    preservedLastValue = sequencePosition.maximum + 1n;
    preservedIsCalled = false;
  }
  if (preservedLastValue < 1n || preservedLastValue > 2147483647n) {
    throw new Error('Unsupported _migrations sequence state');
  }

  const checksumExpression = ledger.columns.some(column => column.column_name === 'checksum')
    ? 'checksum'
    : 'NULL::CHAR(64)';
  const appliedAtType = ledger.columns.find(column => column.column_name === 'applied_at').data_type;
  const appliedAtExpression = appliedAtType === 'timestamp without time zone'
    ? "applied_at AT TIME ZONE current_setting('TimeZone')"
    : 'applied_at';

  await client.query(`
    CREATE TABLE public._migrations__canonical_rebuild (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) UNIQUE NOT NULL,
      checksum CHAR(64),
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(`
    INSERT INTO public._migrations__canonical_rebuild (id, filename, checksum, applied_at)
    SELECT id, filename, ${checksumExpression},
           COALESCE(${appliedAtExpression}, '-infinity'::timestamptz)
      FROM public._migrations
     ORDER BY id
  `);
  await client.query('DROP TABLE public._migrations');
  await client.query('ALTER TABLE public._migrations__canonical_rebuild RENAME TO _migrations');
  await client.query(`
    ALTER TABLE public._migrations
      RENAME CONSTRAINT _migrations__canonical_rebuild_pkey TO _migrations_pkey
  `);
  await client.query(`
    ALTER TABLE public._migrations
      RENAME CONSTRAINT _migrations__canonical_rebuild_filename_key TO _migrations_filename_key
  `);
  await client.query(`
    ALTER TABLE public._migrations
      RENAME CONSTRAINT _migrations__canonical_rebuild_id_not_null TO _migrations_id_not_null
  `);
  await client.query(`
    ALTER TABLE public._migrations
      RENAME CONSTRAINT _migrations__canonical_rebuild_filename_not_null TO _migrations_filename_not_null
  `);
  await client.query(`
    ALTER TABLE public._migrations
      RENAME CONSTRAINT _migrations__canonical_rebuild_applied_at_not_null TO _migrations_applied_at_not_null
  `);
  await client.query(`
    ALTER SEQUENCE public._migrations__canonical_rebuild_id_seq RENAME TO _migrations_id_seq
  `);
  await client.query(
    "SELECT setval('public._migrations_id_seq'::regclass, $1::bigint, $2::boolean)",
    [preservedLastValue.toString(), preservedIsCalled]
  );

  ledger = await inspectMigrationLedger(client);
  if (!isCanonicalMigrationLedger(ledger)) {
    throw new Error('Canonical _migrations rebuild verification failed');
  }
}

async function runMigrations(options = {}) {
  const targetPool = options.pool || getPool();
  if (!targetPool) throw new Error('DATABASE_URL is required for PostgreSQL authority');
  const migrationsDirectory = options.migrationsDirectory || DEFAULT_MIGRATIONS_DIRECTORY;
  const migrations = loadMigrations(migrationsDirectory);
  const migrationNames = new Set(migrations.map(migration => migration.file));
  const appliedNow = [];
  const client = await targetPool.connect();
  let transactionOpen = false;

  try {
    await client.query('BEGIN');
    transactionOpen = true;
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [MIGRATION_LOCK_KEY]);
    await normalizeMigrationLedger(client);

    const appliedResult = await client.query('SELECT filename, checksum FROM public._migrations ORDER BY filename');
    const applied = new Map();
    for (const row of appliedResult.rows) {
      if (!migrationNames.has(row.filename)) {
        throw new Error(`Applied migration source is missing: ${row.filename}`);
      }
      if (applied.has(row.filename)) throw new Error(`Duplicate applied migration: ${row.filename}`);
      applied.set(row.filename, row.checksum === null ? null : String(row.checksum).trim());
    }

    for (const migration of migrations) {
      if (applied.has(migration.file)) {
        const recorded = applied.get(migration.file);
        if (recorded === null) {
          if (!PROTECTED_LEGACY_MIGRATION_CHECKSUMS[migration.file] ||
              PROTECTED_LEGACY_MIGRATION_CHECKSUMS[migration.file] !== migration.digest) {
            throw new Error(`Applied migration checksum is missing: ${migration.file}`);
          }
          const updated = await client.query(
            'UPDATE public._migrations SET checksum = $2 WHERE filename = $1 AND checksum IS NULL',
            [migration.file, migration.digest]
          );
          if (updated.rowCount !== 1) throw new Error(`Migration checksum backfill failed: ${migration.file}`);
        } else if (!/^[0-9a-f]{64}$/.test(recorded) || recorded !== migration.digest) {
          throw new Error(`Applied migration checksum mismatch: ${migration.file}`);
        }
        continue;
      }

      await client.query(migration.sql);
      await client.query(
        'INSERT INTO public._migrations (filename, checksum) VALUES ($1, $2)',
        [migration.file, migration.digest]
      );
      appliedNow.push(migration.file);
    }

    await client.query('COMMIT');
    transactionOpen = false;
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {
        // The original migration failure remains authoritative if the connection died.
      }
    }
    throw new Error(`Migration run failed: ${error.message}`);
  } finally {
    client.release();
  }

  for (const file of appliedNow) console.log(`[DB] Migration applied: ${file}`);
  return true;
}

async function initDatabase() {
  dbAvailable = false;
  readinessFailure = null;
  const targetPool = getPool();
  if (!targetPool) {
    readinessFailure = 'database_url_missing';
    return false;
  }

  try {
    await targetPool.query('SELECT 1');
    await runMigrations();
    dbAvailable = true;
    return true;
  } catch (error) {
    readinessFailure = 'postgres_initialization_failed';
    console.error('[DB] PostgreSQL initialization failed:', error.message);
    dbAvailable = false;
    return false;
  }
}

function isAvailable() {
  return dbAvailable;
}

function readiness() {
  return Object.freeze({ ready: dbAvailable, failure: readinessFailure });
}

async function query(text, params) {
  const targetPool = getPool();
  if (!targetPool || !dbAvailable) return null;
  return targetPool.query(text, params);
}

async function close() {
  const targetPool = pool;
  pool = null;
  dbAvailable = false;
  readinessFailure = null;
  if (targetPool) await targetPool.end();
}

function resetForTests() {
  if (process.env.NODE_ENV !== 'test') throw new Error('resetForTests is test-only');
  pool = null;
  dbAvailable = false;
  readinessFailure = null;
}

module.exports = {
  PROTECTED_LEGACY_MIGRATION_CHECKSUMS,
  canonicalizeMigrationChecksumBytes,
  close,
  getPool,
  initDatabase,
  isAvailable,
  query,
  readiness,
  resetForTests,
  loadMigrations,
  runMigrations,
  stripOuterTransaction,
};
