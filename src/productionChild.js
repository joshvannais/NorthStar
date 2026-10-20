'use strict';

if (require.main !== module) {
  throw new Error('The NorthStar production child is not importable.');
}

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const EXPECTED_NODE = 'v22.23.3';
const FAILURE = 'The NorthStar production child is unavailable.';
const expectedDigest = process.env.NORTHSTAR_CANONICAL_LAUNCH_DIGEST;
const expectedParent = process.env.NORTHSTAR_CANONICAL_LAUNCH_PARENT;
const runtimeAuthority = process.env.NORTHSTAR_AUTHENTICATED_NODE_AUTHORITY;
const authenticatedPath = process.env.NORTHSTAR_AUTHENTICATED_NODE_PATH;
const authenticatedSha256 = process.env.NORTHSTAR_AUTHENTICATED_NODE_SHA256;
const canonicalRoot = process.env.NORTHSTAR_CANONICAL_ROOT;
const expectedRoot = runtimeAuthority === 'official-docker-node-22.23.3-v1' ? '/app' :
  path.resolve(__dirname, '..');
const expectedChild = path.join(expectedRoot, 'src', 'productionChild.js');
const expectedServer = path.join(expectedRoot, 'src', 'server.js');
const executableRealpath = fs.realpathSync.native(process.execPath);
const executableStat = fs.statSync(executableRealpath);
if (process.env.LD_PRELOAD || process.env.LD_LIBRARY_PATH) throw new Error(FAILURE);
if (process.version !== EXPECTED_NODE || process.execArgv.length !== 0 ||
    process.argv.length !== 2 ||
    process.argv[1] !== expectedChild || __filename !== expectedChild ||
    fs.realpathSync.native(__filename) !== expectedChild ||
    fs.lstatSync(expectedChild).isSymbolicLink() ||
    canonicalRoot !== expectedRoot ||
    fs.realpathSync.native(expectedServer) !== expectedServer ||
    fs.lstatSync(expectedServer).isSymbolicLink() ||
    process.env.NODE_ENV !== 'production' ||
    process.env.NORTHSTAR_CANONICAL_LAUNCH !== 'os-pipe-v1' ||
    !/^[0-9a-f]{64}$/.test(expectedDigest || '') ||
    expectedParent !== String(process.ppid) || process.send || process.channel ||
    !['official-docker-node-22.23.3-v1',
      'official-win-x64-22.23.3-v1'].includes(runtimeAuthority) ||
    typeof authenticatedPath !== 'string' ||
    fs.realpathSync.native(authenticatedPath) !== executableRealpath ||
    fs.lstatSync(authenticatedPath).isSymbolicLink() ||
    process.env.NORTHSTAR_AUTHENTICATED_NODE_DEVICE !== String(executableStat.dev) ||
    process.env.NORTHSTAR_AUTHENTICATED_NODE_INODE !== String(executableStat.ino) ||
    process.env.NORTHSTAR_AUTHENTICATED_NODE_SIZE !== String(executableStat.size)) {
  throw new Error(FAILURE);
}
if (runtimeAuthority === 'official-docker-node-22.23.3-v1') {
  const expectedDigests = Object.freeze({
    x64: 'fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48',
    arm64: 'd09e299258c24f7cdf6f5d5ec185e3a56512b27a697113735dac909f1cac7b8d',
  });
  const runtimeGroups = process.getgroups();
  const status = fs.readFileSync('/proc/self/status', 'utf8');
  if (process.platform !== 'linux' || !['x64', 'arm64'].includes(process.arch) ||
      process.getuid() !== 1000 || process.geteuid() !== 1000 ||
      process.getgid() !== 1000 || process.getegid() !== 1000 ||
      runtimeGroups.length !== 1 || runtimeGroups[0] !== 1000 ||
      executableRealpath !== '/usr/local/bin/node' ||
      executableStat.uid !== 0 || executableStat.gid !== 0 ||
      (executableStat.mode & 0o222) !== 0 ||
      authenticatedSha256 !== expectedDigests[process.arch] ||
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
      process.env.TEMP !== '/var/lib/northstar/tmp') throw new Error(FAILURE);
  const actualSha256 = crypto.createHash('sha256')
    .update(fs.readFileSync(executableRealpath)).digest('hex');
  if (actualSha256 !== authenticatedSha256) throw new Error(FAILURE);
  for (const entry of ['/app', '/app/scripts', '/app/src', '/app/node_modules',
    '/app/.northstar-runtime', '/usr/local', '/usr/local/bin', '/usr/local/lib',
    '/usr/local/lib/node_modules', '/app/scripts/start-production.sh',
    '/app/scripts/production-launcher.js', expectedChild, expectedServer,
    '/app/package.json', '/app/package-lock.json', '/app/Dockerfile',
    '/app/railway.toml', '/app/scripts/node-v22.23.3-runtime-manifest.txt',
    '/app/.northstar-runtime/node-path', '/app/.northstar-runtime/node-sha256',
    '/app/.northstar-runtime/node-arch',
    '/app/.northstar-runtime/privilege-inventory',
    '/app/.northstar-runtime/privilege-inventory.sha256',
    '/app/.northstar-runtime/executable-inventory',
    '/app/.northstar-runtime/executable-inventory.sha256',
    '/app/.northstar-runtime/setpriv.identity',
    '/app/.northstar-runtime/getcap.identity', '/usr/bin/setpriv', '/usr/sbin/getcap']) {
    const info = fs.statSync(entry);
    if (info.uid !== 0 || info.gid !== 0 || (info.mode & 0o022) !== 0 ||
        fs.lstatSync(entry).isSymbolicLink()) throw new Error(FAILURE);
    try {
      fs.accessSync(entry, fs.constants.W_OK);
      throw new Error(FAILURE);
    } catch (error) {
      if (error && error.message === FAILURE) throw error;
      if (!error || !['EACCES', 'EPERM'].includes(error.code)) throw error;
    }
  }
  const setprivStat = fs.statSync('/usr/bin/setpriv');
  const setprivAnchorStat = fs.statSync('/app/.northstar-runtime/setpriv.identity');
  const getcapStat = fs.statSync('/usr/sbin/getcap');
  const getcapAnchorStat = fs.statSync('/app/.northstar-runtime/getcap.identity');
  if ((setprivStat.mode & 0o777) !== 0o555 || setprivStat.nlink !== 2 ||
      (setprivAnchorStat.mode & 0o777) !== 0o555 || setprivAnchorStat.nlink !== 2 ||
      setprivStat.dev !== setprivAnchorStat.dev || setprivStat.ino !== setprivAnchorStat.ino ||
      (getcapStat.mode & 0o777) !== 0o555 || getcapStat.nlink !== 2 ||
      (getcapAnchorStat.mode & 0o777) !== 0o555 || getcapAnchorStat.nlink !== 2 ||
      getcapStat.dev !== getcapAnchorStat.dev || getcapStat.ino !== getcapAnchorStat.ino ||
      ['/usr/sbin/capsh', '/usr/sbin/getpcaps', '/usr/sbin/setcap'].some(fs.existsSync)) {
    throw new Error(FAILURE);
  }
} else {
  if (process.platform !== 'win32' || process.arch !== 'x64' ||
      !/^[0-9a-f]{64}$/.test(authenticatedSha256 || '')) throw new Error(FAILURE);
  const actualSha256 = crypto.createHash('sha256')
    .update(fs.readFileSync(executableRealpath)).digest('hex');
  if (actualSha256 !== authenticatedSha256) throw new Error(FAILURE);
}
for (const key of ['NODE_OPTIONS', 'NODE_PATH', 'NPM_CONFIG_NODE_OPTIONS',
  'npm_config_node_options', 'NODE_V8_COVERAGE', 'LD_PRELOAD', 'LD_LIBRARY_PATH']) {
  if (typeof process.env[key] === 'string' && process.env[key].length > 0) {
    throw new Error(FAILURE);
  }
}

function readProof() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    const stream = fs.createReadStream(null, { fd: 3, autoClose: true });
    stream.on('data', chunk => {
      length += chunk.length;
      if (length > 40) stream.destroy(new Error(FAILURE));
      else chunks.push(chunk);
    });
    stream.once('error', reject);
    stream.once('end', () => resolve(Buffer.concat(chunks, length)));
  });
}

(async () => {
  const proof = await readProof();
  if (proof.length !== 40 || proof.readBigUInt64BE(32) !== BigInt(process.pid)) {
    throw new Error(FAILURE);
  }
  const actualDigest = crypto.createHash('sha256').update(proof.subarray(0, 32)).digest();
  const expected = Buffer.from(expectedDigest, 'hex');
  if (expected.length !== actualDigest.length ||
      !crypto.timingSafeEqual(actualDigest, expected)) throw new Error(FAILURE);

  delete process.env.NORTHSTAR_CANONICAL_LAUNCH;
  delete process.env.NORTHSTAR_CANONICAL_LAUNCH_DIGEST;
  delete process.env.NORTHSTAR_CANONICAL_LAUNCH_PARENT;
  delete process.env.NORTHSTAR_AUTHENTICATED_NODE_PATH;
  delete process.env.NORTHSTAR_AUTHENTICATED_NODE_AUTHORITY;
  delete process.env.NORTHSTAR_AUTHENTICATED_NODE_SHA256;
  delete process.env.NORTHSTAR_AUTHENTICATED_NODE_DEVICE;
  delete process.env.NORTHSTAR_AUTHENTICATED_NODE_INODE;
  delete process.env.NORTHSTAR_AUTHENTICATED_NODE_SIZE;
  delete process.env.NORTHSTAR_CANONICAL_ROOT;
  process.env.NORTHSTAR_CANONICAL_CHILD = 'verified-os-pipe-v1';
  const server = require(expectedServer);
  console.log('[Bootstrap] Canonical production composition ready.');
  await server.start();
})().catch(error => {
  console.error(`[Server] Failed to start: ${error && error.message || FAILURE}`);
  process.exitCode = 1;
});

Object.freeze(module.exports);
