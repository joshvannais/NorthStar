'use strict';

if (require.main !== module) {
  throw new Error('The NorthStar production child is not importable.');
}

const crypto = require('node:crypto');
const fs = require('node:fs');

const EXPECTED_NODE = 'v22.23.3';
const FAILURE = 'The NorthStar production child is unavailable.';
const expectedDigest = process.env.NORTHSTAR_CANONICAL_LAUNCH_DIGEST;
const expectedParent = process.env.NORTHSTAR_CANONICAL_LAUNCH_PARENT;
if (process.version !== EXPECTED_NODE || process.execArgv.length !== 0 ||
    process.argv.length !== 2 ||
    process.argv[1] !== __filename || process.env.NODE_ENV !== 'production' ||
    process.env.NORTHSTAR_CANONICAL_LAUNCH !== 'os-pipe-v1' ||
    !/^[0-9a-f]{64}$/.test(expectedDigest || '') ||
    expectedParent !== String(process.ppid) || process.send || process.channel) {
  throw new Error(FAILURE);
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
  process.env.NORTHSTAR_CANONICAL_CHILD = 'verified-os-pipe-v1';
  const server = require('./server');
  console.log('[Bootstrap] Canonical production composition ready.');
  await server.start();
})().catch(error => {
  console.error(`[Server] Failed to start: ${error && error.message || FAILURE}`);
  process.exitCode = 1;
});

Object.freeze(module.exports);
