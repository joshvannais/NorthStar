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
    '/app/.northstar-runtime', '/usr/bin', '/usr/sbin', '/usr/local', '/usr/local/bin', '/usr/local/lib',
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
    '/usr/bin/setpriv', '/usr/sbin/getcap', '/usr/sbin/capsh',
    '/usr/sbin/getpcaps', '/usr/sbin/setcap', '/usr/bin/chage', '/usr/bin/chfn',
    '/usr/bin/chsh', '/usr/bin/expiry', '/usr/bin/gpasswd', '/usr/bin/mount',
    '/usr/bin/newgrp', '/usr/bin/passwd', '/usr/bin/su', '/usr/bin/umount',
    '/usr/sbin/unix_chkpwd'];
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
  const expectedPrivilegeTools = Object.freeze({
    x64: Object.freeze({
      '/usr/bin/setpriv': Object.freeze([80192,
        'd5839b20edb0d77222b1e11be7d155c7122d381dbfad40876b0def7dd710f5bd']),
      '/usr/sbin/getcap': Object.freeze([14576,
        '815e0a9db190b9f50e83a9443daa368c705bf466142521b12b4770bf7f69f579']),
      '/usr/sbin/capsh': Object.freeze([54568,
        '16246b635b9a566874e1374bb2c686379cb1ff7e57497d9bb71869d77d3bc35c']),
      '/usr/sbin/getpcaps': Object.freeze([14576,
        'e7d7113447a52f62eae75aebb44e6f14b4706ac840a668260090e5b818af629d']),
      '/usr/sbin/setcap': Object.freeze([14576,
        '58b227dc41893b9b29e40e68a1c2af081e3a84630371980071056a80fed8fbe0']),
      '/usr/bin/chage': Object.freeze([80376,
        'f1aced4c56099e77221aa8a408a073a41d971520fd82108bd8e737cad6e7fcd1']),
      '/usr/bin/chfn': Object.freeze([62672,
        '0d91ea5e4961f4b09526e7eba8f1aa7fea53b56290019c656dba29256c860bb4']),
      '/usr/bin/chsh': Object.freeze([52880,
        'e9ea120b0d271feb49f02ad923e8789f51128beb0f41be11f1a0e7e46484bdf0']),
      '/usr/bin/expiry': Object.freeze([31184,
        '76ca5abc17ecc1ec50f9716f91b7ec9044bce69431b4fc3f172489b56d41e308']),
      '/usr/bin/gpasswd': Object.freeze([88496,
        'f5ddf4ff327b07c2e1109645d35b0f75011d20877c9a0c2c1b0678dd1b8c3879']),
      '/usr/bin/mount': Object.freeze([59704,
        '18ca60a1e1c93f58fca00607ad32bf192fea00157eac73a5341f8bd1c2201403']),
      '/usr/bin/newgrp': Object.freeze([48896,
        'ced400910c4fe7ab0676ae07ee6489d677baa18e1425750a21b9688ab2e02fb6']),
      '/usr/bin/passwd': Object.freeze([68248,
        'd30cd42625b51cb54c49edc5b0b3348d6a438539446af3752a6af10393c4f2d2']),
      '/usr/bin/su': Object.freeze([72000,
        '4b8bb44ac13b8f8f8c08708faff91a9b63b3fa369b8cbfe1abb5ef09e8029993']),
      '/usr/bin/umount': Object.freeze([35128,
        '54bf7fbc1db029188f5d7e1397f4ad7b2cd1e2d7a57869002d390063cbbb3268']),
      '/usr/sbin/unix_chkpwd': Object.freeze([39160,
        '0ef065c7d555e7dc66789956ae2a67547a98a38fc5f846373975c85e95009345']),
    }),
    arm64: Object.freeze({
      '/usr/bin/setpriv': Object.freeze([133288,
        '24410fedc29286402ae3b366bd3a78c3d177f7a1190797f1ea564f190097356c']),
      '/usr/sbin/getcap': Object.freeze([67672,
        'dfd4546e0dbf6213e920622249d10e4469a4e41cfbdc62fd0da2472acffdd836']),
      '/usr/sbin/capsh': Object.freeze([70464,
        'ce65733af73e8357b3b61ed9495254147f70a9783af257d2dad5ab5445f44dc7']),
      '/usr/sbin/getpcaps': Object.freeze([67672,
        '2979481886c0ebd48a0ffbe5dcd2d2d63cb6cc8d9e23174558e774cc0dc03246']),
      '/usr/sbin/setcap': Object.freeze([67672,
        '17caa8b013d9c946534dd9973d69040066778e92ac5e756e06572cc6f6c492c7']),
      '/usr/bin/chage': Object.freeze([137424,
        'be8de5f4f97c24251b9265acfc814e8565f3045c69cab72f1dd8c31002fe64f0']),
      '/usr/bin/chfn': Object.freeze([70616,
        '41732ba55e81bdd78c784fbe80ca85e76c7e076a4dbd1a23ef0a6607a9042540']),
      '/usr/bin/chsh': Object.freeze([69064,
        'ac7c3f9f29f423b9edb8b6bf449ec65fec4b2aa047011908d6e42e9f2f603d25']),
      '/usr/bin/expiry': Object.freeze([67880,
        'e8f60724dd66050667a72c415e116c13aec2dc9d320a3dc711959a63a99d8d49']),
      '/usr/bin/gpasswd': Object.freeze([137352,
        '91280540427c40502aad93ea821f848061f49eadb36994ce5c8e2de6fdb3a42b']),
      '/usr/bin/mount': Object.freeze([67744,
        '4e3aa9cd2b207144bc3206a95019fcdeeac9114cb58d9b19850b948b2003c2ef']),
      '/usr/bin/newgrp': Object.freeze([69176,
        '0466e757f261cc50fa879f50c0663372e399fa6653a659053037faaa334da104']),
      '/usr/bin/passwd': Object.freeze([72048,
        'bc0b502346f44eff9bf08cfd121b280684652a7e8eb4e78cba6404d32892ebf0']),
      '/usr/bin/su': Object.freeze([133312,
        'c673b670821b019213950a266be48d235cd2faf6692ea7f50c399dc4a59c0396']),
      '/usr/bin/umount': Object.freeze([67744,
        '60ac2e037660e390520585a8d6afd4ee09949eead31dbb18c21b07245d082816']),
      '/usr/sbin/unix_chkpwd': Object.freeze([67680,
        '18b7c15bf7267ad65341e19e682e136c3f60d2de88944dcd66ededfab7442ac1']),
    }),
  });
  for (const [entry, [size, digest]] of Object.entries(expectedPrivilegeTools[process.arch])) {
    const info = fs.statSync(entry);
    const mode = info.mode & 0o777;
    const actualDigest = crypto.createHash('sha256').update(fs.readFileSync(entry)).digest('hex');
    if (!info.isFile() || (mode !== 0o555 && mode !== 0o755) ||
        info.size !== size || actualDigest !== digest) {
      throw new Error(`${FAILURE} Invalid executable privilege inventory.`);
    }
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
