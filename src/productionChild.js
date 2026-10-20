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
const expectedRoot = runtimeAuthority === 'nix-store-22.23.3-v1' ? '/app' :
  path.resolve(__dirname, '..');
const expectedChild = path.join(expectedRoot, 'src', 'productionChild.js');
const expectedServer = path.join(expectedRoot, 'src', 'server.js');
const executableRealpath = fs.realpathSync.native(process.execPath);
const executableStat = fs.statSync(executableRealpath);
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
    !['nix-store-22.23.3-v1', 'official-win-x64-22.23.3-v1'].includes(runtimeAuthority) ||
    typeof authenticatedPath !== 'string' ||
    fs.realpathSync.native(authenticatedPath) !== executableRealpath ||
    fs.lstatSync(authenticatedPath).isSymbolicLink() ||
    process.env.NORTHSTAR_AUTHENTICATED_NODE_DEVICE !== String(executableStat.dev) ||
    process.env.NORTHSTAR_AUTHENTICATED_NODE_INODE !== String(executableStat.ino) ||
    process.env.NORTHSTAR_AUTHENTICATED_NODE_SIZE !== String(executableStat.size)) {
  throw new Error(FAILURE);
}
if (runtimeAuthority === 'nix-store-22.23.3-v1') {
  if (process.platform !== 'linux' || process.arch !== 'x64' ||
      !/^\/nix\/store\/[a-z0-9]{32}-nodejs-22\.23\.3\/bin\/node$/.test(executableRealpath) ||
      executableStat.uid !== 0 || (executableStat.mode & 0o222) !== 0 ||
      authenticatedSha256) throw new Error(FAILURE);
} else {
  if (process.platform !== 'win32' || process.arch !== 'x64' ||
      !/^[0-9a-f]{64}$/.test(authenticatedSha256 || '')) throw new Error(FAILURE);
  const actualSha256 = crypto.createHash('sha256')
    .update(fs.readFileSync(executableRealpath)).digest('hex');
  if (actualSha256 !== authenticatedSha256) throw new Error(FAILURE);
}
for (const key of ['NODE_OPTIONS', 'NODE_PATH', 'NPM_CONFIG_NODE_OPTIONS',
  'npm_config_node_options', 'NODE_V8_COVERAGE']) {
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
