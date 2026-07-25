'use strict';

// Windows-only test infrastructure. This module is never loaded by the
// application and install() is a no-op when NODE_ENV is production.

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULT_CAPACITY = 1;
const MAX_LOCAL_OPERATIONS = 2;
const DEFAULT_ACQUIRE_TIMEOUT_MS = 15000;
const DEFAULT_RETRY_DELAY_MS = 10;
const DEFAULT_UNPUBLISHED_GRACE_MS = 250;
const ROOT_PREFIX = 'northstar-jest-loopback-v2-';
const INSTALL_KEY = Symbol.for('northstar.loopbackConcurrencyGuard.v2');
const LOCAL_IDLE_GRACE_MS = 25;
const MAX_LOCAL_OPERATION_BURST = 32;
const MAX_PROCESS_LEASE_HOLD_MS = 1000;
const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));

function sleepSync(milliseconds) {
  Atomics.wait(sleepBuffer, 0, 0, Math.max(1, milliseconds));
}

function monotonicNowNs() {
  return process.hrtime.bigint();
}

function safeRealpath(value) {
  try {
    return fs.realpathSync.native ? fs.realpathSync.native(value) : fs.realpathSync(value);
  } catch (_error) {
    return path.resolve(value);
  }
}

function repositoryRoot() {
  return safeRealpath(path.resolve(__dirname, '../..'));
}

function namespaceIdentity(repoRoot) {
  let username = 'unknown-user';
  try { username = os.userInfo().username || username; } catch (_error) {}
  return [os.hostname(), username, safeRealpath(repoRoot)].join('\n').toLowerCase();
}

function defaultRoot(repoRoot) {
  const digest = crypto.createHash('sha256')
    .update(namespaceIdentity(repoRoot))
    .digest('hex')
    .slice(0, 24);
  return path.join(os.tmpdir(), ROOT_PREFIX + digest);
}

function randomNonce() {
  return crypto.randomBytes(16).toString('hex');
}

function powershellExecutable() {
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  return path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

function queryProcessStartIdentity(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (process.platform === 'win32') {
    const command = '(Get-Process -Id ' + pid +
      " -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')";
    const result = spawnSync(powershellExecutable(), [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      command,
    ], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3000,
    });
    return result.status === 0 && result.stdout.trim()
      ? result.stdout.trim()
      : null;
  }
  try {
    const stat = fs.readFileSync('/proc/' + pid + '/stat', 'utf8').trim().split(/\s+/);
    return stat.length > 21 ? 'proc-start-ticks:' + stat[21] : null;
  } catch (_error) {
    return null;
  }
}

let currentProcessStartIdentity = null;

function ownProcessStartIdentity() {
  if (!currentProcessStartIdentity) {
    currentProcessStartIdentity = queryProcessStartIdentity(process.pid) ||
      'epoch-ms:' + Math.round(Date.now() - process.uptime() * 1000);
  }
  return currentProcessStartIdentity;
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

function validOwner(owner) {
  return Boolean(owner &&
    owner.schemaVersion === 2 &&
    typeof owner.nonce === 'string' &&
    /^[a-f0-9]{32}$/i.test(owner.nonce) &&
    Number.isInteger(owner.pid) &&
    owner.pid > 0 &&
    typeof owner.processStartIdentity === 'string' &&
    owner.processStartIdentity &&
    Number.isInteger(owner.sequence) &&
    owner.sequence > 0 &&
    typeof owner.monotonicNs === 'string' &&
    /^\d+$/.test(owner.monotonicNs));
}

function ownerLiveness(owner, options) {
  if (!validOwner(owner)) return { alive: false, reason: 'malformed-owner' };
  const exists = (options.processExists || processExists)(owner.pid);
  if (!exists) return { alive: false, reason: 'dead-pid' };
  if (owner.pid === options.pid) {
    const ownStart = options.processStartIdentity ||
      (options.pid === process.pid ? ownProcessStartIdentity() : owner.processStartIdentity);
    return ownStart === owner.processStartIdentity
      ? { alive: true, reason: 'live-owner' }
      : { alive: false, reason: 'pid-reused', observedStart: ownStart };
  }
  const observedStart = (options.processStartForPid || queryProcessStartIdentity)(owner.pid);
  if (observedStart && observedStart !== owner.processStartIdentity) {
    return { alive: false, reason: 'pid-reused', observedStart };
  }
  return { alive: true, reason: observedStart ? 'live-owner' : 'live-owner-start-unavailable' };
}

function ticketName(owner) {
  return [
    'ticket',
    String(owner.sequence).padStart(12, '0'),
    owner.monotonicNs,
    owner.nonce,
  ].join('-') + '.json';
}

function candidateName(owner) {
  return [
    '.candidate',
    String(owner.sequence).padStart(12, '0'),
    owner.monotonicNs,
    owner.nonce,
  ].join('-') + '.json';
}

function parseName(fileName) {
  const match = fileName.match(
    /^(?:ticket|\.candidate)-(\d+)-(\d+)-([a-f0-9]{32})\.json$/i
  );
  return match ? {
    sequence: Number(match[1]),
    monotonicNs: match[2],
    nonce: match[3],
  } : null;
}

function monotonicAgeMs(observation, nowNs) {
  const parsed = observation.owner && validOwner(observation.owner)
    ? { monotonicNs: observation.owner.monotonicNs }
    : parseName(observation.name);
  if (!parsed || !parsed.monotonicNs) return Infinity;
  try {
    const published = BigInt(parsed.monotonicNs);
    const difference = nowNs >= published ? nowNs - published : 0n;
    return Number(difference / 1000000n);
  } catch (_error) {
    return Infinity;
  }
}

function readObservation(root, name, fsImpl) {
  const filePath = path.join(root, name);
  const parsed = parseName(name) || {};
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const raw = fsImpl.readFileSync(filePath, 'utf8');
      const stat = fsImpl.statSync(filePath, { bigint: true });
      let owner = null;
      try { owner = JSON.parse(raw); } catch (_error) {}
      return {
        path: filePath,
        name,
        raw,
        owner,
        nonce: validOwner(owner) ? owner.nonce : parsed.nonce || null,
        sequence: validOwner(owner) ? owner.sequence : parsed.sequence || Number.MAX_SAFE_INTEGER,
        monotonicNs: validOwner(owner) ? owner.monotonicNs : parsed.monotonicNs || '0',
        fileIdentity: [stat.dev, stat.ino, stat.birthtimeNs].map(String).join(':'),
        unreadable: false,
      };
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
      if (attempt < 4) sleepSync(1);
    }
  }
  // A peer can unlink a just-enumerated file while Windows still reports a
  // sharing violation on its path. An observation that remains unreadable is
  // counted against capacity and is never reclaimed without full metadata.
  return {
    path: filePath,
    name,
    raw: '',
    owner: null,
    nonce: parsed.nonce || null,
    sequence: parsed.sequence || Number.MAX_SAFE_INTEGER,
    monotonicNs: parsed.monotonicNs || '0',
    fileIdentity: null,
    unreadable: true,
  };
}

function sameObservation(left, right) {
  return Boolean(left && right &&
    !left.unreadable && !right.unreadable &&
    left.name === right.name &&
    left.raw === right.raw &&
    left.nonce === right.nonce &&
    left.fileIdentity === right.fileIdentity);
}

function sortTickets(left, right) {
  if (left.sequence !== right.sequence) return left.sequence - right.sequence;
  try {
    const leftNs = BigInt(left.monotonicNs);
    const rightNs = BigInt(right.monotonicNs);
    if (leftNs < rightNs) return -1;
    if (leftNs > rightNs) return 1;
  } catch (_error) {}
  return String(left.nonce || left.name).localeCompare(String(right.nonce || right.name));
}

function createLeaseManager(customOptions) {
  const options = Object.assign({
    capacity: DEFAULT_CAPACITY,
    acquireTimeoutMs: DEFAULT_ACQUIRE_TIMEOUT_MS,
    retryDelayMs: DEFAULT_RETRY_DELAY_MS,
    unpublishedGraceMs: DEFAULT_UNPUBLISHED_GRACE_MS,
    livenessCacheMs: 1000,
    pid: process.pid,
    parentPid: process.ppid,
    workerId: process.env.JEST_WORKER_ID || null,
    repoRoot: repositoryRoot(),
    monotonicNowNs,
    nowMs: Date.now,
    nonceFactory: randomNonce,
    sleepSync,
    fs,
  }, customOptions || {});
  options.root = options.root || defaultRoot(options.repoRoot);
  const fsImpl = options.fs;
  const active = new Map();
  const livenessCache = new Map();

  function checkedOwnerLiveness(owner) {
    const key = owner.pid + '\n' + owner.processStartIdentity;
    const nowNs = options.monotonicNowNs();
    const cached = livenessCache.get(key);
    if (cached) {
      const ageMs = Number((nowNs - cached.checkedAtNs) / 1000000n);
      if (ageMs >= 0 && ageMs < options.livenessCacheMs) return cached.result;
    }
    const result = ownerLiveness(owner, options);
    livenessCache.set(key, { checkedAtNs: nowNs, result });
    return result;
  }

  function ensureRoot() {
    fsImpl.mkdirSync(options.root, { recursive: true });
  }

  function names() {
    ensureRoot();
    return fsImpl.readdirSync(options.root);
  }

  function observeTickets() {
    return names()
      .filter(function (name) { return name.indexOf('ticket-') === 0; })
      .map(function (name) { return readObservation(options.root, name, fsImpl); })
      .filter(Boolean)
      .sort(sortTickets);
  }

  function observeCandidates() {
    return names()
      .filter(function (name) { return name.indexOf('.candidate-') === 0; })
      .map(function (name) { return readObservation(options.root, name, fsImpl); })
      .filter(Boolean);
  }

  function quarantineObserved(observation, reason) {
    if (!observation) return false;
    if (typeof options.beforeQuarantine === 'function') {
      options.beforeQuarantine(observation, reason);
    }
    const current = readObservation(options.root, observation.name, fsImpl);
    if (!sameObservation(observation, current)) return false;
    const quarantineName = [
      '.quarantine',
      observation.nonce || 'unknown',
      options.nonceFactory(),
      String(reason || 'stale').replace(/[^a-z0-9_-]/gi, '_'),
    ].join('-') + '.json';
    const quarantinePath = path.join(options.root, quarantineName);
    try {
      fsImpl.renameSync(observation.path, quarantinePath);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'EEXIST' || error.code === 'EPERM') {
        return false;
      }
      throw error;
    }
    const quarantined = readObservation(options.root, quarantineName, fsImpl);
    if (!quarantined || quarantined.raw !== observation.raw ||
        quarantined.fileIdentity !== observation.fileIdentity) {
      if (quarantined) {
        try {
          if (!fsImpl.existsSync(observation.path)) {
            fsImpl.renameSync(quarantinePath, observation.path);
          }
        } catch (_restoreError) {}
      }
      return false;
    }
    fsImpl.unlinkSync(quarantinePath);
    return true;
  }

  function cleanupAbandonedCandidates() {
    const nowNs = options.monotonicNowNs();
    observeCandidates().forEach(function (candidate) {
      if (monotonicAgeMs(candidate, nowNs) >= options.unpublishedGraceMs) {
        quarantineObserved(candidate, 'unpublished');
      }
    });
  }

  function cleanupStaleTickets() {
    const nowNs = options.monotonicNowNs();
    observeTickets().forEach(function (ticket) {
      if (ticket.unreadable) return;
      if (!validOwner(ticket.owner)) {
        if (monotonicAgeMs(ticket, nowNs) >= options.unpublishedGraceMs) {
          quarantineObserved(ticket, 'malformed');
        }
        return;
      }
      const liveness = checkedOwnerLiveness(ticket.owner);
      if (!liveness.alive) quarantineObserved(ticket, liveness.reason);
    });
  }

  function nextSequence() {
    const all = observeTickets().concat(observeCandidates());
    return all.reduce(function (maximum, item) {
      return Math.max(maximum, Number(item.sequence) || 0);
    }, 0) + 1;
  }

  function publish(testName) {
    ensureRoot();
    cleanupAbandonedCandidates();
    cleanupStaleTickets();
    const nonce = options.nonceFactory();
    const owner = {
      schemaVersion: 2,
      nonce,
      pid: options.pid,
      parentPid: options.parentPid,
      processStartIdentity: options.processStartIdentity ||
        (options.pid === process.pid ? ownProcessStartIdentity() : 'test-process-' + options.pid),
      workerId: options.workerId,
      testName: testName || null,
      repositoryRoot: safeRealpath(options.repoRoot),
      namespace: namespaceIdentity(options.repoRoot),
      sequence: nextSequence(),
      publishedAt: new Date(options.nowMs()).toISOString(),
      monotonicNs: String(options.monotonicNowNs()),
    };
    const candidatePath = path.join(options.root, candidateName(owner));
    const ticketPath = path.join(options.root, ticketName(owner));
    let descriptor;
    try {
      let openError = null;
      for (let attempt = 0; attempt < 5 && descriptor === undefined; attempt += 1) {
        ensureRoot();
        try {
          descriptor = fsImpl.openSync(candidatePath, 'wx');
        } catch (error) {
          openError = error;
          if (error.code !== 'ENOENT' || attempt === 4) throw error;
        }
      }
      if (descriptor === undefined) throw openError;
      fsImpl.writeFileSync(descriptor, JSON.stringify(owner));
      if (typeof fsImpl.fsyncSync === 'function') fsImpl.fsyncSync(descriptor);
      fsImpl.closeSync(descriptor);
      descriptor = undefined;
      fsImpl.renameSync(candidatePath, ticketPath);
    } catch (error) {
      if (descriptor !== undefined) {
        try { fsImpl.closeSync(descriptor); } catch (_closeError) {}
      }
      throw error;
    }
    const lease = {
      owner,
      path: ticketPath,
      name: path.basename(ticketPath),
      released: false,
    };
    active.set(owner.nonce, lease);
    return lease;
  }

  function tryAcquirePublished(lease) {
    cleanupAbandonedCandidates();
    cleanupStaleTickets();
    const tickets = observeTickets();
    const index = tickets.findIndex(function (ticket) {
      return ticket.owner && ticket.owner.nonce === lease.owner.nonce;
    });
    if (index === -1) {
      throw new Error('Published loopback ticket disappeared before acquisition: ' +
        lease.owner.nonce);
    }
    return index < options.capacity;
  }

  function releaseSync(lease) {
    const current = lease || (active.size === 1 ? Array.from(active.values())[0] : null);
    if (!current) return;
    if (current.released) return;
    const observation = readObservation(options.root, current.name, fsImpl);
    if (!observation) {
      throw new Error('Loopback lease ticket disappeared before release: ' +
        current.owner.nonce);
    }
    if (!observation.owner || observation.owner.nonce !== current.owner.nonce) {
      throw new Error('Refusing to release a replacement loopback lease owner');
    }
    // Ticket paths contain a 128-bit nonce and are never reused. Keep the
    // ticket published if unlink fails so peers do not observe a false release.
    fsImpl.unlinkSync(current.path);
    current.released = true;
    active.delete(current.owner.nonce);
  }

  function acquireSync(testName, acquireOptions) {
    if (process.env.NODE_ENV === 'production' && !options.allowProductionForTests) return null;
    const requestOptions = acquireOptions || {};
    const started = options.nowMs();
    const startedMonotonic = options.monotonicNowNs();
    const lease = publish(testName);
    try {
      for (;;) {
        if (requestOptions.signal && requestOptions.signal.aborted) {
          const abortError = new Error('Windows loopback lease acquisition aborted');
          abortError.name = 'AbortError';
          throw abortError;
        }
        if (tryAcquirePublished(lease)) {
          lease.waitMs = Number((options.monotonicNowNs() - startedMonotonic) / 1000000n);
          if (process.env.NORTHSTAR_TEST_LOOPBACK_DIAGNOSTICS === '1') {
            console.log('[loopback-guard]', JSON.stringify({
              event: 'acquired',
              waitMs: lease.waitMs,
              capacity: options.capacity,
              owner: lease.owner,
            }));
          }
          return lease;
        }
        const elapsed = Number((options.monotonicNowNs() - startedMonotonic) / 1000000n);
        if (elapsed >= options.acquireTimeoutMs) {
          const owners = observeTickets().slice(0, options.capacity).map(function (ticket) {
            return ticket.owner || {
              malformed: true,
              name: ticket.name,
              rawLength: ticket.raw.length,
            };
          });
          const timeout = new Error(
            'Timed out acquiring the Windows loopback test lease after ' +
            elapsed + ' ms; live capacity owners: ' + JSON.stringify(owners)
          );
          timeout.name = 'LoopbackLeaseTimeoutError';
          timeout.startedAt = new Date(started).toISOString();
          throw timeout;
        }
        options.sleepSync(options.retryDelayMs);
      }
    } catch (error) {
      try { releaseSync(lease); } catch (releaseError) {
        error.releaseError = releaseError;
      }
      throw error;
    }
  }

  function withLeaseSync(testName, operation) {
    const lease = acquireSync(testName);
    try {
      return operation(lease);
    } finally {
      releaseSync(lease);
    }
  }

  function releaseAllSync(bestEffort) {
    const failures = [];
    Array.from(active.values()).forEach(function (lease) {
      try { releaseSync(lease); } catch (error) { failures.push(error); }
    });
    if (failures.length && !bestEffort) throw failures[0];
    return failures;
  }

  return {
    root: options.root,
    capacity: options.capacity,
    publish,
    tryAcquirePublished,
    acquireSync,
    releaseSync,
    withLeaseSync,
    releaseAllSync,
    cleanupAbandonedCandidates,
    cleanupStaleTickets,
    observeTickets,
    activeCount: function () { return active.size; },
  };
}

const defaultManager = createLeaseManager(process.env.NORTHSTAR_LOOPBACK_GUARD_SELF_TEST_ROOT
  ? { root: process.env.NORTHSTAR_LOOPBACK_GUARD_SELF_TEST_ROOT }
  : undefined);

function currentTestName() {
  try {
    return typeof expect !== 'undefined' && expect.getState
      ? expect.getState().currentTestName
      : null;
  } catch (_error) {
    return null;
  }
}

function install() {
  if (process.platform !== 'win32' || process.env.NODE_ENV === 'production') return;
  if (http[INSTALL_KEY]) return;

  const originalListen = http.Server.prototype.listen;
  const originalClose = http.Server.prototype.close;
  const originalEmit = http.Server.prototype.emit;
  const guardedServers = new WeakSet();
  let processLease = null;
  let localOperationCount = 0;
  let processLeaseStartedNs = 0n;
  let localOperationBurst = 0;
  let delayedRelease = null;

  function releaseProcessLease() {
    if (delayedRelease) {
      clearTimeout(delayedRelease);
      delayedRelease = null;
    }
    if (!processLease) return null;
    try {
      defaultManager.releaseSync(processLease);
      processLease = null;
      processLeaseStartedNs = 0n;
      localOperationBurst = 0;
      return null;
    } catch (error) {
      // Keep the process lease published and associated with the manager when
      // release fails; peers must not observe a false release.
      return error;
    }
  }

  function finishOperation(operation) {
    if (!operation || operation.finished) return null;
    operation.finished = true;
    localOperationCount -= 1;
    if (localOperationCount > 0) return null;
    const heldMs = Number((monotonicNowNs() - processLeaseStartedNs) / 1000000n);
    if (localOperationBurst >= MAX_LOCAL_OPERATION_BURST ||
        heldMs >= MAX_PROCESS_LEASE_HOLD_MS) {
      return releaseProcessLease();
    }
    delayedRelease = setTimeout(function () {
      delayedRelease = null;
      const releaseError = releaseProcessLease();
      if (releaseError) process.nextTick(function () { throw releaseError; });
    }, LOCAL_IDLE_GRACE_MS);
    if (typeof delayedRelease.unref === 'function') delayedRelease.unref();
    return null;
  }

  function beginOperation(label) {
    if (localOperationCount >= MAX_LOCAL_OPERATIONS) {
      throw new Error(
        'Refusing to exceed the verified Windows loopback threshold of ' +
        MAX_LOCAL_OPERATIONS + ' concurrent local operations'
      );
    }
    if (delayedRelease) {
      clearTimeout(delayedRelease);
      delayedRelease = null;
    }
    if (processLease && localOperationCount === 0) {
      const heldMs = Number((monotonicNowNs() - processLeaseStartedNs) / 1000000n);
      if (localOperationBurst >= MAX_LOCAL_OPERATION_BURST ||
          heldMs >= MAX_PROCESS_LEASE_HOLD_MS) {
        const releaseError = releaseProcessLease();
        if (releaseError) throw releaseError;
      }
    }
    const acquiredHere = !processLease;
    const lease = processLease || defaultManager.acquireSync(label || currentTestName());
    processLease = lease;
    if (acquiredHere) {
      processLeaseStartedNs = monotonicNowNs();
      localOperationBurst = 0;
    }
    localOperationCount += 1;
    localOperationBurst += 1;
    return { lease, finished: false };
  }

  function finishOperationOrThrow(operation) {
    const releaseError = finishOperation(operation);
    if (releaseError) process.nextTick(function () { throw releaseError; });
  }

  function isLoopbackListen(args) {
    const first = args[0];
    if (typeof first === 'string' && !/^\d+$/.test(first)) return false;
    const options = first && typeof first === 'object' ? first : null;
    const host = String((options && options.host) ||
      (typeof args[1] === 'string' ? args[1] : '')).toLowerCase();
    return !host || ['127.0.0.1', 'localhost', '::1'].includes(host);
  }

  http.Server.prototype.listen = function guardedLoopbackListen() {
    const server = this;
    const args = Array.from(arguments);
    if (!isLoopbackListen(args)) return originalListen.apply(server, args);
    const operation = beginOperation(currentTestName());
    const finishListen = function () {
      server.removeListener('listening', finishListen);
      server.removeListener('error', finishListen);
      finishOperationOrThrow(operation);
    };
    server.once('listening', finishListen);
    server.once('error', finishListen);
    try {
      const result = originalListen.apply(server, args);
      guardedServers.add(server);
      return result;
    } catch (error) {
      server.removeListener('listening', finishListen);
      server.removeListener('error', finishListen);
      const releaseError = finishOperation(operation);
      if (releaseError) error.releaseError = releaseError;
      throw error;
    }
  };

  http.Server.prototype.emit = function guardedLoopbackEmit(eventName) {
    if (eventName !== 'request' || !guardedServers.has(this)) {
      return originalEmit.apply(this, arguments);
    }
    const response = arguments[2];
    const operation = beginOperation(currentTestName());
    const finishRequest = function () { finishOperationOrThrow(operation); };
    response.once('finish', finishRequest);
    response.once('close', finishRequest);
    try {
      return originalEmit.apply(this, arguments);
    } catch (error) {
      response.removeListener('finish', finishRequest);
      response.removeListener('close', finishRequest);
      const releaseError = finishOperation(operation);
      if (releaseError) error.releaseError = releaseError;
      throw error;
    }
  };

  http.Server.prototype.close = function guardedLoopbackClose() {
    const server = this;
    if (!guardedServers.has(server)) return originalClose.apply(server, arguments);
    const operation = beginOperation(currentTestName());
    const args = Array.from(arguments);
    const callbackIndex = args.findIndex(function (value) {
      return typeof value === 'function';
    });
    const callback = callbackIndex >= 0 ? args[callbackIndex] : null;
    const finishClose = function () {
      guardedServers.delete(server);
      return finishOperation(operation);
    };
    const closeEvent = function () { finishOperationOrThrow(operation); };
    server.once('close', closeEvent);
    const wrapped = function (closeError) {
      const releaseError = finishClose();
      if (process.env.NORTHSTAR_TEST_LOOPBACK_DIAGNOSTICS === '1') {
        console.log('[loopback-guard]', JSON.stringify({
          event: releaseError ? 'release-failed' : 'released',
          owner: operation.lease.owner,
          error: releaseError && releaseError.message,
        }));
      }
      if (callback) return callback.call(this, closeError || releaseError);
      if (closeError || releaseError) {
        process.nextTick(function () { throw closeError || releaseError; });
      }
    };
    if (callbackIndex >= 0) args[callbackIndex] = wrapped;
    else args.push(wrapped);
    try {
      return originalClose.apply(server, args);
    } catch (error) {
      server.removeListener('close', closeEvent);
      const releaseError = finishClose();
      if (releaseError) error.releaseError = releaseError;
      throw error;
    }
  };

  http[INSTALL_KEY] = {
    manager: defaultManager,
    maxLocalOperations: MAX_LOCAL_OPERATIONS,
    originalListen,
    originalClose,
    originalEmit,
  };

  process.once('exit', function () {
    defaultManager.releaseAllSync(true);
  });
}

async function acquire(testName, options) {
  return defaultManager.acquireSync(testName, options);
}

async function release(lease) {
  return defaultManager.releaseSync(lease);
}

module.exports = {
  install,
  acquire,
  release,
  createLeaseManager,
  constants: {
    DEFAULT_CAPACITY,
    DEFAULT_ACQUIRE_TIMEOUT_MS,
    DEFAULT_RETRY_DELAY_MS,
    DEFAULT_UNPUBLISHED_GRACE_MS,
    LOCAL_IDLE_GRACE_MS,
    MAX_LOCAL_OPERATIONS,
    MAX_LOCAL_OPERATION_BURST,
    MAX_PROCESS_LEASE_HOLD_MS,
    ROOT_PREFIX,
  },
  _internals: {
    defaultRoot,
    namespaceIdentity,
    ownerLiveness,
    parseName,
    queryProcessStartIdentity,
    readObservation,
    ticketName,
    candidateName,
  },
};
