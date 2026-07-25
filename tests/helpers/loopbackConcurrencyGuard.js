'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const ACQUIRE_TIMEOUT_MS = 5000;
const RETRY_DELAY_MS = 5;
const ROOT_PREFIX = 'northstar-jest-loopback-';

let installed = false;
let lease = null;

function delay(milliseconds) {
  return new Promise(function (resolve) { setTimeout(resolve, milliseconds); });
}

function lockRoot() {
  return path.join(os.tmpdir(), ROOT_PREFIX + process.ppid);
}

function ownerIsAlive(owner) {
  if (!owner || !Number.isInteger(owner.pid) || owner.pid <= 0) return true;
  try {
    process.kill(owner.pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

function removeStaleLock(lockPath) {
  try {
    const owner = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    if (ownerIsAlive(owner)) return false;
    fs.unlinkSync(lockPath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return true;
    return false;
  }
}

async function acquire(testName) {
  if (process.platform !== 'win32') return null;
  if (lease) throw new Error('Loopback concurrency lease was not released by the previous test');

  const root = lockRoot();
  const lockPath = path.join(root, 'slot.lock');
  const startedAt = Date.now();
  fs.mkdirSync(root, { recursive: true });

  while (Date.now() - startedAt < ACQUIRE_TIMEOUT_MS) {
    let descriptor;
    try {
      descriptor = fs.openSync(lockPath, 'wx');
      const owner = {
        pid: process.pid,
        parentPid: process.ppid,
        workerId: process.env.JEST_WORKER_ID || null,
        testName,
        acquiredAt: new Date().toISOString(),
      };
      fs.writeFileSync(descriptor, JSON.stringify(owner));
      lease = { descriptor, lockPath, root, owner };
      if (process.env.NORTHSTAR_TEST_LOOPBACK_DIAGNOSTICS === '1') {
        console.log('[loopback-guard]', JSON.stringify({
          event: 'acquired',
          waitMs: Date.now() - startedAt,
          owner,
        }));
      }
      return lease;
    } catch (error) {
      if (descriptor !== undefined) {
        try { fs.closeSync(descriptor); } catch (_closeError) {}
      }
      if (error.code !== 'EEXIST' && error.code !== 'EPERM' && error.code !== 'ENOENT') {
        throw error;
      }
      if (Date.now() - startedAt > 100) removeStaleLock(lockPath);
      fs.mkdirSync(root, { recursive: true });
      await delay(RETRY_DELAY_MS);
    }
  }

  let owner = null;
  try {
    owner = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch (_error) {}
  throw new Error(
    'Timed out acquiring the Windows loopback test lease after ' +
    ACQUIRE_TIMEOUT_MS + ' ms; current owner: ' + JSON.stringify(owner)
  );
}

async function release() {
  if (!lease) return;
  const current = lease;
  lease = null;

  try {
    fs.closeSync(current.descriptor);
  } finally {
    let removed = false;
    for (let attempt = 0; attempt < 100 && !removed; attempt += 1) {
      try {
        fs.unlinkSync(current.lockPath);
        removed = true;
      } catch (error) {
        if (error.code === 'ENOENT') {
          removed = true;
        } else if (error.code === 'EPERM' || error.code === 'EBUSY') {
          await delay(RETRY_DELAY_MS);
        } else {
          throw error;
        }
      }
    }
    if (!removed) throw new Error('Failed to release the Windows loopback test lease');
  }

  if (process.env.NORTHSTAR_TEST_LOOPBACK_DIAGNOSTICS === '1') {
    console.log('[loopback-guard]', JSON.stringify({
      event: 'released',
      owner: current.owner,
    }));
  }
}

function install() {
  if (installed) return;
  installed = true;
  beforeEach(async function () {
    await acquire(expect.getState().currentTestName);
  });
  afterEach(async function () {
    await release();
  });
}

module.exports = {
  install,
  acquire,
  release,
};
