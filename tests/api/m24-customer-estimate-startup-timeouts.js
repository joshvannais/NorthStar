'use strict';

// Benign local-only migration contention against the exact released Slice 1 base.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, fork } = require('node:child_process');
const { Pool } = require('pg');

process.env.NODE_ENV = 'test';

const option = name => (process.argv.find(value => value.startsWith(`--${name}=`)) || '')
  .split('=').slice(1).join('=');
const base = path.resolve(option('base'));
const output = path.resolve(option('output'));
const releasedBase = '65b3a1b66c1c2b2300cc23e695f3d3e64429f478';
const settingsQuery = "SELECT name,setting FROM pg_settings WHERE name IN ('lock_timeout','statement_timeout') ORDER BY name";

assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: base, encoding: 'utf8' }).trim(), releasedBase);
assert.ok(!fs.existsSync(output));

(async () => {
  let child;
  let owner;
  let runtime;
  let holder;
  const pools = [];
  const ledger = { cases: [], attempts: [] };

  try {
    child = fork(path.join(__dirname, '../helpers/m24-decision-rehearsal-child.js'), [base, 'seed'], {
      env: { ...process.env, NODE_PATH: path.join(__dirname, '../../node_modules') },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc']
    });
    const fixture = await new Promise((resolve, reject) => {
      child.once('message', message => message.error ? reject(new Error(message.error)) : resolve(message));
      child.once('exit', code => reject(new Error(`fixture exited ${code}`)));
    });

    owner = new Pool({ connectionString: fixture.migrationUrl });
    runtime = new Pool({ connectionString: fixture.databaseUrl });
    const before = await owner.query('SELECT filename,checksum FROM _migrations ORDER BY filename');
    const beforeConstraint = (await owner.query(
      "SELECT pg_get_constraintdef(oid) value FROM pg_constraint WHERE conrelid='demo_command_center_mutations'::regclass AND conname='demo_command_center_mutations_operation_check'"
    )).rows[0].value;
    assert.equal(before.rows.at(-1).filename, '077_provider_canary_accounting.sql');

    const db = require('../../src/db');

    async function attempt(label, options = '') {
      const rawPool = new Pool({ connectionString: fixture.migrationUrl, options, max: 1 });
      pools.push(rawPool);
      const record = { label };
      const observedPool = {
        connect: async () => {
          const connection = await rawPool.connect();
          record.before = (await connection.query(settingsQuery)).rows;
          return {
            release: () => connection.release(),
            query: async (...args) => {
              const sql = args[0];
              try {
                if (typeof sql === 'string' && sql.includes('SELECT pg_advisory_xact_lock($1::bigint)')) {
                  record.beforeAdvisory = (await connection.query(settingsQuery)).rows;
                }
                if (typeof sql === 'string' && sql.includes('ALTER TABLE public.demo_command_center_mutations DROP')) {
                  record.before078 = (await connection.query(settingsQuery)).rows;
                }
                const result = await connection.query(...args);
                if (sql === 'COMMIT' || sql === 'ROLLBACK') {
                  record.terminal = sql;
                  record.after = (await connection.query(settingsQuery)).rows;
                }
                return result;
              } catch (error) {
                record.databaseError = error.code;
                throw error;
              }
            }
          };
        }
      };

      const started = Date.now();
      try {
        await db.runMigrations({ pool: observedPool, runtimePool: runtime });
        record.succeeded = true;
      } catch (_error) {
        record.succeeded = false;
      }
      record.elapsedMs = Date.now() - started;
      assert.deepEqual(record.after, record.before, `${label} restores session settings`);
      ledger.attempts.push(record);
      return record;
    }

    async function unchanged() {
      assert.deepEqual((await owner.query('SELECT filename,checksum FROM _migrations ORDER BY filename')).rows, before.rows);
      assert.equal((await owner.query("SELECT to_regclass('canonical_customer_estimate_versions')::text value")).rows[0].value, null);
      assert.equal((await owner.query("SELECT to_regprocedure('canonical_customer_estimate_version_issue(uuid,uuid,text,uuid,uuid,text,text,jsonb)')::text value")).rows[0].value, null);
      assert.equal((await owner.query(
        "SELECT pg_get_constraintdef(oid) value FROM pg_constraint WHERE conrelid='demo_command_center_mutations'::regclass AND conname='demo_command_center_mutations_operation_check'"
      )).rows[0].value, beforeConstraint);
    }

    function expectCaps(record, lockTimeout, statementTimeout) {
      assert.deepEqual(Object.fromEntries(record.beforeAdvisory.map(row => [row.name, row.setting])), {
        lock_timeout: String(lockTimeout),
        statement_timeout: String(statementTimeout)
      });
    }

    holder = await owner.connect();
    await holder.query('BEGIN');
    await holder.query('SELECT session_id FROM demo_command_center_mutations LIMIT 0');
    let result = await attempt('ordinary table read blocks migration 078 constraint replacement');
    assert.equal(result.succeeded, false);
    assert.equal(result.databaseError, '55P03');
    expectCaps(result, 5000, 20000);
    assert.ok(result.elapsedMs >= 4500 && result.elapsedMs < 12000);
    assert.equal(result.terminal, 'ROLLBACK');
    await unchanged();
    await holder.query('ROLLBACK');
    ledger.cases.push('actual 078 constraint lock is bounded and the full migration rolls back');

    await holder.query('BEGIN');
    await holder.query('SELECT pg_advisory_xact_lock($1::bigint)', ['5643944089238424905']);
    result = await attempt('startup advisory contention before migration 078');
    assert.equal(result.succeeded, false);
    assert.equal(result.databaseError, '55P03');
    expectCaps(result, 5000, 20000);
    assert.ok(result.elapsedMs >= 4500 && result.elapsedMs < 12000);
    await unchanged();
    await holder.query('ROLLBACK');
    ledger.cases.push('startup advisory wait is bounded before any 078 DDL');

    await holder.query('BEGIN');
    await holder.query('SELECT session_id FROM demo_command_center_mutations LIMIT 0');
    result = await attempt('tighter inherited startup caps', '-c lock_timeout=200 -c statement_timeout=1000');
    assert.equal(result.succeeded, false);
    assert.equal(result.databaseError, '55P03');
    expectCaps(result, 200, 1000);
    assert.ok(result.elapsedMs < 3000);
    await unchanged();
    await holder.query('ROLLBACK');
    ledger.cases.push('tighter inherited caps remain tighter and restore after rollback');

    result = await attempt('released holders apply migration 078 once', '-c lock_timeout=200 -c statement_timeout=1000');
    assert.equal(result.succeeded, true);
    assert.equal(result.terminal, 'COMMIT');
    expectCaps(result, 200, 1000);
    assert.deepEqual(result.before078, result.beforeAdvisory);
    assert.equal((await owner.query('SELECT count(*)::int count FROM _migrations')).rows[0].count, before.rows.length + 1);
    assert.equal((await owner.query("SELECT to_regclass('canonical_customer_estimate_versions')::text value")).rows[0].value, 'canonical_customer_estimate_versions');
    ledger.cases.push('after contention releases migration 078 applies once with bounded settings');

    const applied = (await owner.query('SELECT filename,checksum,applied_at FROM _migrations ORDER BY filename')).rows;
    result = await attempt('same candidate startup zero-op');
    assert.equal(result.succeeded, true);
    expectCaps(result, 5000, 20000);
    assert.deepEqual((await owner.query('SELECT filename,checksum,applied_at FROM _migrations ORDER BY filename')).rows, applied);
    ledger.cases.push('subsequent startup is a bounded zero-op with unchanged migration identity');
    ledger.pass = true;
  } finally {
    if (holder) {
      await holder.query('ROLLBACK').catch(() => {});
      holder.release();
    }
    for (const pool of pools) await pool.end();
    if (runtime) await runtime.end();
    if (owner) await owner.end();
    if (child?.connected && child.exitCode === null && !child.killed) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.send('stop', () => {});
      await exited;
    }
    fs.writeFileSync(output, JSON.stringify(ledger, null, 2));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
