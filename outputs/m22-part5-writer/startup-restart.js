'use strict';

const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { Client } = require('pg');

const ROOT = path.resolve(__dirname, '..', '..');
const ADMIN_URL = process.env.M19_PG_ADMIN_URL;
const MIGRATION = '035_schedule_human_preview_approval.sql';
const suffix = `${process.pid}_${crypto.randomBytes(4).toString('hex')}`;
const database = `northstar_m22_p5_start_${suffix}`;
const migrationRole = `ns_m22p5_migration_${suffix}`;
const runtimeRole = `ns_m22p5_runtime_${suffix}`;
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m22-p5-start-'));

if (!ADMIN_URL) throw new Error('M19_PG_ADMIN_URL is required');

const quote = value => `"${String(value).replace(/"/g, '""')}"`;

function roleUrl(name) {
  const parsed = new URL(ADMIN_URL);
  parsed.pathname = `/${database}`;
  parsed.username = name;
  parsed.password = '';
  return parsed.toString();
}

async function freePort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', resolve);
  });
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}

async function launch(environment) {
  const port = await freePort();
  const stdout = [];
  const stderr = [];
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: ROOT,
    env: { ...environment, PORT: String(port) },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => stdout.push(chunk.toString('utf8')));
  child.stderr.on('data', chunk => stderr.push(chunk.toString('utf8')));
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited before health: ${stdout.join('')}\n${stderr.join('')}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, { cache: 'no-store' });
      if (response.status === 200) {
        return { child, health: { status: response.status, body: await response.json() }, stdout, stderr, port };
      }
    } catch (_error) {
      // Startup and migrations remain within the bounded deadline.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Server health timed out: ${stdout.join('')}\n${stderr.join('')}`);
}

async function stop(run) {
  if (!run || run.child.exitCode !== null) return;
  const exited = new Promise(resolve => run.child.once('exit', resolve));
  run.child.kill();
  await Promise.race([
    exited,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Server stop timed out')), 15000)),
  ]);
}

async function main() {
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`CREATE ROLE ${quote(migrationRole)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  await admin.query(`CREATE ROLE ${quote(runtimeRole)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  await admin.query(`CREATE DATABASE ${quote(database)} OWNER ${quote(migrationRole)}`);
  await admin.end();

  const migrationUrl = roleUrl(migrationRole);
  const runtimeUrl = roleUrl(runtimeRole);
  const environment = {
    ...process.env,
    NODE_ENV: 'production',
    TZ: 'UTC',
    DATABASE_URL: runtimeUrl,
    MIGRATION_DATABASE_URL: migrationUrl,
    AUTH_ACCESS_SECRET: crypto.randomBytes(48).toString('hex'),
    NORTHSTAR_DATA_DIR: dataRoot,
    OPENAI_API_KEY: '', RETELL_API_KEY: '', RETELL_AGENT_ID: '', RETELL_PHONE_NUMBER: '', RETELL_WEBHOOK_SECRET: '',
    STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '', TWILIO_ACCOUNT_SID: '', TWILIO_AUTH_TOKEN: '', TWILIO_PHONE_NUMBER: '',
    RESEND_API_KEY: '', SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '', GOOGLE_CALENDAR_CREDENTIALS: '',
    GOOGLE_SHEETS_CLIENT_EMAIL: '', GOOGLE_SHEETS_PRIVATE_KEY: '', GOOGLE_SHEETS_SPREADSHEET_ID: '',
  };

  let first;
  let second;
  let observer;
  try {
    first = await launch(environment);
    await stop(first);
    second = await launch(environment);
    await stop(second);

    observer = new Client({ connectionString: migrationUrl });
    await observer.connect();
    const identity = (await observer.query(
      `SELECT current_setting('server_version') AS version,
              current_setting('TimeZone') AS timezone,
              (SELECT count(*)::int FROM public._migrations) AS migration_count,
              (SELECT count(*)::int FROM public._migrations WHERE filename=$1) AS migration035_count,
              (SELECT checksum FROM public._migrations WHERE filename=$1) AS migration035_checksum,
              to_regclass('public.canonical_schedule_mutation_previews')::text AS preview_table,
              to_regclass('public.canonical_schedule_human_approvals')::text AS approval_table`,
      [MIGRATION]
    )).rows[0];
    const runtime = new Client({ connectionString: runtimeUrl });
    await runtime.connect();
    const runtimeIdentity = (await runtime.query(
      `SELECT current_user AS role,
              has_database_privilege(current_user,current_database(),'CREATE') AS can_create_database,
              has_schema_privilege(current_user,'public','CREATE') AS can_create_public`
    )).rows[0];
    await runtime.end();

    const sourceChecksum = crypto.createHash('sha256')
      .update(fs.readFileSync(path.join(ROOT, 'migrations', MIGRATION)))
      .digest('hex');
    const firstApplied = (first.stdout.join('').match(/\[DB\] Migration applied:/g) || []).length;
    const secondApplied = (second.stdout.join('').match(/\[DB\] Migration applied:/g) || []).length;
    const result = {
      postgres: identity,
      runtime: runtimeIdentity,
      firstHealth: first.health,
      secondHealth: second.health,
      firstAppliedMigrations: firstApplied,
      secondAppliedMigrations: secondApplied,
      firstStartupApplied035: first.stdout.join('').includes(MIGRATION),
      secondStartupApplied035: second.stdout.join('').includes(MIGRATION),
      firstStderrBytes: Buffer.byteLength(first.stderr.join('')),
      secondStderrBytes: Buffer.byteLength(second.stderr.join('')),
      sourceChecksum,
      providerConfiguration: 'all provider credentials omitted',
    };
    result.pass = first.health.status === 200 && second.health.status === 200
      && firstApplied === identity.migration_count && secondApplied === 0
      && result.firstStartupApplied035 && !result.secondStartupApplied035
      && identity.version.split('.')[0] === '18' && identity.timezone === 'UTC'
      && identity.migration035_count === 1 && identity.migration035_checksum === sourceChecksum
      && identity.preview_table === 'canonical_schedule_mutation_previews'
      && identity.approval_table === 'canonical_schedule_human_approvals'
      && runtimeIdentity.role === runtimeRole
      && runtimeIdentity.can_create_database === false && runtimeIdentity.can_create_public === false
      && result.firstStderrBytes === 0 && result.secondStderrBytes === 0;
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.pass) process.exitCode = 1;
  } finally {
    await stop(second).catch(() => {});
    await stop(first).catch(() => {});
    if (observer) await observer.end();
    const cleanup = new Client({ connectionString: ADMIN_URL });
    await cleanup.connect();
    await cleanup.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1', [database]);
    await cleanup.query(`DROP DATABASE IF EXISTS ${quote(database)}`);
    await cleanup.query(`DROP ROLE IF EXISTS ${quote(runtimeRole)}`);
    await cleanup.query(`DROP ROLE IF EXISTS ${quote(migrationRole)}`);
    await cleanup.end();
    const resolved = path.resolve(dataRoot);
    const safePrefix = path.resolve(os.tmpdir()) + path.sep;
    if (!resolved.startsWith(safePrefix) || !path.basename(resolved).startsWith('northstar-m22-p5-start-')) {
      throw new Error('Refusing unsafe startup data cleanup');
    }
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

main().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
