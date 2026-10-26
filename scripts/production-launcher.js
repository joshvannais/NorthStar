'use strict';

// This file is an executable composition root, never a capability module.
if (require.main !== module) {
  throw new Error('The NorthStar production launcher is not importable.');
}

const EXPECTED_NODE = 'v22.23.3';
const FAILURE = 'The NorthStar production launcher is unavailable.';
const runtimeAuthority = process.env.NORTHSTAR_AUTHENTICATED_NODE_AUTHORITY;
const authenticatedPath = process.env.NORTHSTAR_AUTHENTICATED_NODE_PATH;
const authenticatedSha256 = process.env.NORTHSTAR_AUTHENTICATED_NODE_SHA256;
if (process.version !== EXPECTED_NODE || process.execArgv.length !== 0 ||
    process.argv.length !== 2 ||
    typeof authenticatedPath !== 'string' || authenticatedPath.length === 0 ||
    !['official-docker-node-22.23.3-v1',
      'official-win-x64-22.23.3-v1'].includes(runtimeAuthority)) {
  throw new Error(`${FAILURE} Expected an authenticated ${EXPECTED_NODE} executable.`);
}
if (process.env.LD_PRELOAD || process.env.LD_LIBRARY_PATH) {
  throw new Error(`${FAILURE} Unsupported dynamic-loader environment.`);
}

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const PROOF_BYTES = 32;
const canonicalRoot = runtimeAuthority === 'official-docker-node-22.23.3-v1' ? '/app' :
  path.resolve(__dirname, '..');
const expectedLauncher = path.join(canonicalRoot, 'scripts', 'production-launcher.js');
const actualLauncher = fs.realpathSync.native(__filename);
const executableRealpath = fs.realpathSync.native(process.execPath);
const expectedRealpath = fs.realpathSync.native(authenticatedPath);
const executableStat = fs.statSync(executableRealpath);
const executableLstat = fs.lstatSync(authenticatedPath);
if (process.argv[1] !== expectedLauncher || actualLauncher !== expectedLauncher ||
    fs.lstatSync(expectedLauncher).isSymbolicLink() ||
    executableRealpath !== expectedRealpath || executableLstat.isSymbolicLink() ||
    !executableStat.isFile()) {
  throw new Error(`${FAILURE} Authenticated executable identity mismatch.`);
}

if (runtimeAuthority === 'official-docker-node-22.23.3-v1') {
  const expectedDigests = Object.freeze({
    x64: 'fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48',
    arm64: 'd09e299258c24f7cdf6f5d5ec185e3a56512b27a697113735dac909f1cac7b8d',
  });
  const nodeRoot = path.dirname(path.dirname(expectedRealpath));
  const binDirectory = path.dirname(expectedRealpath);
  const rootStat = fs.statSync(nodeRoot);
  const binStat = fs.statSync(binDirectory);
  const runtimeGroups = process.getgroups();
  const status = fs.readFileSync('/proc/self/status', 'utf8');
  const actualSha256 = crypto.createHash('sha256')
    .update(fs.readFileSync(executableRealpath)).digest('hex');
  if (process.platform !== 'linux' || !['x64', 'arm64'].includes(process.arch) ||
      process.getuid() !== 1000 || process.geteuid() !== 1000 ||
      process.getgid() !== 1000 || process.getegid() !== 1000 ||
      runtimeGroups.length !== 1 || runtimeGroups[0] !== 1000 ||
      expectedRealpath !== '/usr/local/bin/node' || executableStat.uid !== 0 ||
      executableStat.gid !== 0 || rootStat.uid !== 0 || rootStat.gid !== 0 ||
      binStat.uid !== 0 || binStat.gid !== 0 ||
      authenticatedSha256 !== expectedDigests[process.arch] ||
      actualSha256 !== authenticatedSha256 ||
      (executableStat.mode & 0o222) !== 0 || (rootStat.mode & 0o022) !== 0 ||
      (binStat.mode & 0o022) !== 0 || fs.lstatSync(nodeRoot).isSymbolicLink() ||
      fs.lstatSync(binDirectory).isSymbolicLink() ||
      !/^Uid:\s+1000\s+1000\s+1000\s+1000$/m.test(status) ||
      !/^Gid:\s+1000\s+1000\s+1000\s+1000$/m.test(status) ||
      !/^Groups:\s+1000\s*$/m.test(status) ||
      !/^CapInh:\s+0{16}$/m.test(status) || !/^CapPrm:\s+0{16}$/m.test(status) ||
      !/^CapEff:\s+0{16}$/m.test(status) || !/^CapAmb:\s+0{16}$/m.test(status) ||
      !/^NoNewPrivs:\s+1$/m.test(status) ||
      process.cwd() !== '/app' || process.env.PATH !== '/usr/local/bin' ||
      process.env.HOME !== '/var/lib/northstar/home' ||
      process.env.NORTHSTAR_DATA_DIR !== '/var/lib/northstar/data' ||
      process.env.TMPDIR !== '/var/lib/northstar/tmp' ||
      process.env.TMP !== '/var/lib/northstar/tmp' ||
      process.env.TEMP !== '/var/lib/northstar/tmp') {
    throw new Error(`${FAILURE} Invalid immutable Docker executable.`);
  }
  const protectedDirectories = ['/app', '/app/scripts', '/app/src', '/app/node_modules',
    '/app/.northstar-runtime', '/usr/local', '/usr/local/bin', '/usr/local/lib',
    '/usr/local/lib/node_modules'];
  const protectedFiles = ['/app/scripts/start-production.sh', expectedLauncher,
    '/app/src/productionChild.js', '/app/src/server.js', '/app/package.json',
    '/app/package-lock.json', '/app/Dockerfile', '/app/railway.toml',
    '/app/scripts/node-v22.23.3-runtime-manifest.txt',
    '/app/.northstar-runtime/node-path', '/app/.northstar-runtime/node-sha256',
    '/app/.northstar-runtime/node-arch',
    '/app/.northstar-runtime/privilege-inventory',
    '/app/.northstar-runtime/privilege-inventory.sha256',
    '/app/.northstar-runtime/executable-inventory',
    '/app/.northstar-runtime/executable-inventory.sha256',
    '/usr/bin/setpriv', '/usr/sbin/getcap'];
  for (const entry of [...protectedDirectories, ...protectedFiles]) {
    const info = fs.statSync(entry);
    if (info.uid !== 0 || info.gid !== 0 || (info.mode & 0o022) !== 0 ||
        fs.lstatSync(entry).isSymbolicLink()) {
      throw new Error(`${FAILURE} Mutable Docker authority resource.`);
    }
    try {
      fs.accessSync(entry, fs.constants.W_OK);
      throw new Error(`${FAILURE} Writable Docker authority resource.`);
    } catch (error) {
      if (error && error.message === `${FAILURE} Writable Docker authority resource.`) throw error;
      if (!error || !['EACCES', 'EPERM'].includes(error.code)) throw error;
    }
  }
  const setprivStat = fs.statSync('/usr/bin/setpriv');
  const getcapStat = fs.statSync('/usr/sbin/getcap');
  const setprivMode = setprivStat.mode & 0o777;
  const getcapMode = getcapStat.mode & 0o777;
  if ((setprivMode !== 0o555 && setprivMode !== 0o755) ||
      (getcapMode !== 0o555 && getcapMode !== 0o755) ||
      ['/usr/sbin/capsh', '/usr/sbin/getpcaps', '/usr/sbin/setcap'].some(fs.existsSync)) {
    throw new Error(`${FAILURE} Invalid executable privilege inventory.`);
  }
  for (const entry of ['/var/lib/northstar/home', '/var/lib/northstar/data',
    '/var/lib/northstar/tmp']) {
    const info = fs.statSync(entry);
    if (info.uid !== 1000 || info.gid !== 1000 || (info.mode & 0o777) !== 0o700 ||
        fs.lstatSync(entry).isSymbolicLink()) {
      throw new Error(`${FAILURE} Invalid writable runtime directory.`);
    }
  }
} else {
  if (process.platform !== 'win32' || process.arch !== 'x64' ||
      !/^[0-9a-f]{64}$/.test(authenticatedSha256 || '')) {
    throw new Error(`${FAILURE} Invalid verified local executable.`);
  }
  const actualSha256 = crypto.createHash('sha256')
    .update(fs.readFileSync(executableRealpath)).digest('hex');
  if (actualSha256 !== authenticatedSha256) {
    throw new Error(`${FAILURE} Verified local executable digest mismatch.`);
  }
}

for (const key of ['NODE_OPTIONS', 'NODE_PATH', 'NPM_CONFIG_NODE_OPTIONS',
  'npm_config_node_options', 'NODE_V8_COVERAGE', 'LD_PRELOAD', 'LD_LIBRARY_PATH']) {
  if (typeof process.env[key] === 'string' && process.env[key].length > 0) {
    throw new Error(`${FAILURE} Unsupported Node startup environment.`);
  }
}

const allowedEnvironment = Object.freeze([
  'AUTH_ACCESS_MINUTES', 'AUTH_ACCESS_SECRET', 'AUTH_REFRESH_DAYS',
  'CALENDAR_TYPE', 'CANONICAL_CACHE_DISABLED', 'CUSTOMER_ESTIMATE_ISSUANCE_PAUSED',
  'CUSTOMER_ESTIMATE_LINK_SECRET', 'DATABASE_URL', 'DB_POOL_MAX', 'DEMO_API_KEY',
  'GOOGLE_CALENDAR_CREDENTIALS', 'GOOGLE_SHEETS_CLIENT_EMAIL',
  'GOOGLE_SHEETS_PRIVATE_KEY', 'GOOGLE_SHEETS_SPREADSHEET_ID',
  'HOMEPAGE_RETELL_AGENT_ID', 'HOMEPAGE_RETELL_AGENT_VERSION',
  'HOMEPAGE_RETELL_LEGAL_APPROVED', 'HOMEPAGE_RETELL_PROVIDER_APPROVED',
  'HOMEPAGE_RETELL_WEB_CALL_ENABLED', 'HOMEPAGE_RETELL_WEBHOOK_ISOLATION_APPROVED',
  'JOBBER_CLIENT_ID', 'JOBBER_CLIENT_SECRET', 'JWT_SECRET', 'KNOWLEDGE_PROVIDER_BINDINGS',
  'LANG', 'LC_ALL', 'MIGRATION_DATABASE_URL', 'NORTHSTAR_DATA_DIR',
  'NORTHSTAR_DEMO_ORGANIZATION_ID', 'NORTHSTAR_SUPPORT_EMAIL', 'OPENAI_API_KEY',
  'POLARIS_CALL_CANARY_BINDING', 'POLARIS_CALL_GUIDANCE_ENABLED',
  'POLARIS_DEMO_GENERATION_ENABLED', 'POLARIS_GROUNDED_V2_ENABLED',
  'POLARIS_INPUT_COUNT_ACCOUNTING_VERSION', 'POLARIS_INPUT_COUNT_MAX_COST_NANO_USD',
  'POLARIS_INPUT_COUNT_TARIFF_EVIDENCE_DIGEST',
  'POLARIS_INPUT_COUNT_TARIFF_REVIEWED_ON', 'POLARIS_OPENAI_ENABLED', 'PORT',
  'PUBLIC_ORIGIN', 'RESEND_API_KEY', 'RETELL_AGENT_ID', 'RETELL_API_KEY',
  'RETELL_PHONE_NUMBER', 'SMTP_HOST', 'SMTP_PASS', 'SMTP_PORT', 'SMTP_USER',
  'HOME', 'SYSTEMROOT', 'TEMP', 'TMP', 'TMPDIR', 'TRANSACTIONAL_EMAIL_FROM', 'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER', 'TZ', 'WINDIR',
]);

const childEnvironment = Object.create(null);
for (const key of allowedEnvironment) {
  if (typeof process.env[key] === 'string') childEnvironment[key] = process.env[key];
}
childEnvironment.NODE_ENV = 'production';
childEnvironment.PATH = path.dirname(executableRealpath);
childEnvironment.NORTHSTAR_AUTHENTICATED_NODE_PATH = executableRealpath;
childEnvironment.NORTHSTAR_AUTHENTICATED_NODE_AUTHORITY = runtimeAuthority;
if (authenticatedSha256) {
  childEnvironment.NORTHSTAR_AUTHENTICATED_NODE_SHA256 = authenticatedSha256;
}
childEnvironment.NORTHSTAR_AUTHENTICATED_NODE_DEVICE = String(executableStat.dev);
childEnvironment.NORTHSTAR_AUTHENTICATED_NODE_INODE = String(executableStat.ino);
childEnvironment.NORTHSTAR_AUTHENTICATED_NODE_SIZE = String(executableStat.size);
childEnvironment.NORTHSTAR_CANONICAL_ROOT = canonicalRoot;

const proof = crypto.randomBytes(PROOF_BYTES);
const proofDigest = crypto.createHash('sha256').update(proof).digest('hex');
childEnvironment.NORTHSTAR_CANONICAL_LAUNCH = 'os-pipe-v1';
childEnvironment.NORTHSTAR_CANONICAL_LAUNCH_DIGEST = proofDigest;
childEnvironment.NORTHSTAR_CANONICAL_LAUNCH_PARENT = String(process.pid);

const childEntry = path.join(canonicalRoot, 'src', 'productionChild.js');
if (fs.realpathSync.native(childEntry) !== childEntry ||
    fs.lstatSync(childEntry).isSymbolicLink()) {
  throw new Error(`${FAILURE} Invalid production child path.`);
}
const child = spawn(executableRealpath, [childEntry], {
  cwd: canonicalRoot,
  env: childEnvironment,
  stdio: ['inherit', 'inherit', 'inherit', 'pipe'],
  windowsHide: true,
});

let settled = false;
function terminate(signal) {
  if (!settled && child.pid) child.kill(signal);
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => terminate(signal));
}

child.once('error', error => {
  settled = true;
  console.error(`${FAILURE} ${error.message}`);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  settled = true;
  if (signal) {
    console.error(`${FAILURE} Child exited from ${signal}.`);
    process.exitCode = 1;
  } else process.exitCode = Number.isInteger(code) ? code : 1;
});
const childBoundProof = Buffer.alloc(PROOF_BYTES + 8);
proof.copy(childBoundProof, 0);
childBoundProof.writeBigUInt64BE(BigInt(child.pid), PROOF_BYTES);
child.stdio[3].end(childBoundProof);

// No reusable launcher capability is exported.
Object.freeze(module.exports);
