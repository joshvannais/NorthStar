'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const {
  createLeaseManager,
  _internals,
} = require('./loopbackConcurrencyGuard');

const roots = [];
let nonceCounter = 1;

function nonce() {
  return (nonceCounter++).toString(16).padStart(32, '0');
}

function rootFor(label) {
  const root = path.join(
    os.tmpdir(),
    'northstar-loopback-guard-test-' + process.pid + '-' + label + '-' + nonce()
  );
  roots.push(root);
  return root;
}

function processOptions(pid, livePids) {
  const live = livePids || new Set([pid]);
  return {
    pid,
    parentPid: pid + 10000,
    processStartIdentity: 'start-' + pid,
    processExists: function (candidate) { return live.has(candidate); },
    processStartForPid: function (candidate) { return 'start-' + candidate; },
  };
}

function manager(root, pid, overrides) {
  return createLeaseManager(Object.assign({
    root,
    repoRoot: path.resolve(__dirname, '../..'),
    capacity: 1,
    acquireTimeoutMs: 60,
    retryDelayMs: 1,
    unpublishedGraceMs: 5,
    nonceFactory: nonce,
  }, processOptions(pid), overrides || {}));
}

function oldMonotonicNs() {
  return String(process.hrtime.bigint() - 1000000000n);
}

function owner(overrides) {
  return Object.assign({
    schemaVersion: 2,
    nonce: nonce(),
    pid: 9001,
    parentPid: 19001,
    processStartIdentity: 'start-9001',
    workerId: null,
    testName: 'fixture-owner',
    repositoryRoot: path.resolve(__dirname, '../..'),
    namespace: 'fixture',
    sequence: 1,
    publishedAt: new Date().toISOString(),
    monotonicNs: oldMonotonicNs(),
  }, overrides || {});
}

function writeTicket(root, fixtureOwner, raw) {
  fs.mkdirSync(root, { recursive: true });
  const filePath = path.join(root, _internals.ticketName(fixtureOwner));
  fs.writeFileSync(filePath, raw === undefined ? JSON.stringify(fixtureOwner) : raw);
  return filePath;
}

function expectRootClean(root) {
  expect(!fs.existsSync(root) || fs.readdirSync(root).length === 0).toBe(true);
}

afterEach(function () {
  roots.forEach(function (root) {
    if (!fs.existsSync(root)) return;
    const resolved = path.resolve(root);
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) ||
        !path.basename(resolved).startsWith('northstar-loopback-guard-test-')) {
      throw new Error('Unsafe test cleanup target: ' + resolved);
    }
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  roots.length = 0;
});

describe('Windows loopback lease queue safety', function () {
  test.each([
    ['empty lease', ''],
    ['malformed JSON', '{"pid":'],
    ['partially written owner', JSON.stringify({ schemaVersion: 2, pid: 9001 })],
  ])('recovers a %s after the short unpublished grace', function (_label, raw) {
    const root = rootFor('malformed');
    const malformedOwner = owner();
    writeTicket(root, malformedOwner, raw);
    const leaseManager = manager(root, 1001);
    const lease = leaseManager.acquireSync('recovery');
    expect(lease.owner.pid).toBe(1001);
    expect(leaseManager.observeTickets()).toHaveLength(1);
    leaseManager.releaseSync(lease);
    expectRootClean(root);
  });

  test('recovers a complete dead owner', function () {
    const root = rootFor('dead-owner');
    writeTicket(root, owner({ pid: 9002, processStartIdentity: 'start-9002' }));
    const leaseManager = manager(root, 1002);
    const lease = leaseManager.acquireSync('dead owner recovery');
    expect(lease.owner.pid).toBe(1002);
    leaseManager.releaseSync(lease);
    expectRootClean(root);
  });

  test('a live owner survives and the waiter times out with diagnostics', function () {
    const root = rootFor('live-owner');
    const livePids = new Set([1101, 1102]);
    const first = manager(root, 1101, processOptions(1101, livePids));
    const second = manager(root, 1102, Object.assign(
      processOptions(1102, livePids),
      { acquireTimeoutMs: 25 }
    ));
    const firstLease = first.acquireSync('live owner');
    expect(function () {
      second.acquireSync('waiter');
    }).toThrow(/live capacity owners/);
    expect(first.observeTickets().map(function (ticket) {
      return ticket.owner.pid;
    })).toEqual([1101]);
    first.releaseSync(firstLease);
  });

  test('recovers an owner crash before metadata publication', function () {
    const root = rootFor('pre-publication-crash');
    const fixtureOwner = owner();
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, _internals.candidateName(fixtureOwner)), '');
    const leaseManager = manager(root, 1201);
    const lease = leaseManager.acquireSync('candidate recovery');
    expect(fs.readdirSync(root).some(function (name) {
      return name.startsWith('.candidate-');
    })).toBe(false);
    leaseManager.releaseSync(lease);
  });

  test('recovers an owner crash after acquisition', function () {
    const root = rootFor('post-acquisition-crash');
    const crashed = manager(root, 1301);
    crashed.acquireSync('crashed owner');
    const survivor = manager(root, 1302, {
      processExists: function (pid) { return pid === 1302; },
      processStartForPid: function (pid) { return 'start-' + pid; },
    });
    const survivorLease = survivor.acquireSync('survivor');
    expect(survivor.observeTickets().map(function (ticket) {
      return ticket.owner.pid;
    })).toEqual([1302]);
    survivor.releaseSync(survivorLease);
  });

  test('PID reuse is detected by process-start identity', function () {
    const root = rootFor('pid-reuse');
    writeTicket(root, owner({
      pid: 1401,
      processStartIdentity: 'old-start-1401',
    }));
    const leaseManager = manager(root, 1402, {
      processExists: function () { return true; },
      processStartForPid: function (pid) {
        return pid === 1401 ? 'replacement-start-1401' : 'start-' + pid;
      },
    });
    const lease = leaseManager.acquireSync('pid reuse');
    expect(lease.owner.pid).toBe(1402);
    leaseManager.releaseSync(lease);
  });

  test('wall-clock rollback does not prevent monotonic stale recovery', function () {
    const root = rootFor('clock-change');
    const malformedOwner = owner();
    writeTicket(root, malformedOwner, '');
    const wallTimes = [Date.now(), Date.now() - 86400000];
    const leaseManager = manager(root, 1501, {
      nowMs: function () { return wallTimes.shift() || Date.now() - 86400000; },
    });
    const lease = leaseManager.acquireSync('clock rollback');
    expect(lease.owner.pid).toBe(1501);
    leaseManager.releaseSync(lease);
  });

  test('a replacement-lock deletion race never deletes the replacement owner', function () {
    const root = rootFor('replacement-race');
    const staleOwner = owner({ pid: 1601, processStartIdentity: 'start-1601' });
    const ticketPath = writeTicket(root, staleOwner);
    const replacement = owner({
      nonce: staleOwner.nonce,
      pid: 1602,
      processStartIdentity: 'start-1602',
      monotonicNs: staleOwner.monotonicNs,
    });
    let replaced = false;
    const leaseManager = manager(root, 1603, {
      acquireTimeoutMs: 20,
      processExists: function (pid) { return pid === 1602 || pid === 1603; },
      processStartForPid: function (pid) { return 'start-' + pid; },
      beforeQuarantine: function () {
        if (replaced) return;
        replaced = true;
        fs.writeFileSync(ticketPath, JSON.stringify(replacement));
      },
    });
    expect(function () {
      leaseManager.acquireSync('replacement race');
    }).toThrow(/live capacity owners/);
    expect(JSON.parse(fs.readFileSync(ticketPath, 'utf8')).pid).toBe(1602);
  });

  test('release failure keeps the lease active and published until a real release', function () {
    const root = rootFor('release-failure');
    let failRelease = true;
    const fsImpl = Object.create(fs);
    fsImpl.unlinkSync = function (target) {
      if (failRelease && path.basename(target).startsWith('ticket-')) {
        const error = new Error('synthetic release failure');
        error.code = 'EPERM';
        throw error;
      }
      return fs.unlinkSync(target);
    };
    const leaseManager = manager(root, 1701, { fs: fsImpl });
    const lease = leaseManager.acquireSync('release failure');
    expect(function () { leaseManager.releaseSync(lease); })
      .toThrow('synthetic release failure');
    expect(lease.released).toBe(false);
    expect(leaseManager.activeCount()).toBe(1);
    expect(fs.existsSync(lease.path)).toBe(true);
    failRelease = false;
    leaseManager.releaseSync(lease);
    expect(lease.released).toBe(true);
    expect(leaseManager.activeCount()).toBe(0);
  });

  test('an enumerated peer that disappears with a transient Windows sharing error is retried', function () {
    const root = rootFor('transient-read-race');
    const peerPath = writeTicket(root, owner({ pid: 1751 }));
    const fsImpl = Object.create(fs);
    let raced = false;
    fsImpl.readFileSync = function (target) {
      if (!raced && target === peerPath) {
        raced = true;
        fs.unlinkSync(peerPath);
        const error = new Error('synthetic Windows sharing race');
        error.code = 'EPERM';
        throw error;
      }
      return fs.readFileSync.apply(fs, arguments);
    };
    const leaseManager = manager(root, 1752, { fs: fsImpl });
    const lease = leaseManager.acquireSync('transient sharing race');
    expect(raced).toBe(true);
    leaseManager.releaseSync(lease);
    expectRootClean(root);
  });

  test('candidate publication recovers when the empty namespace root disappears before open', function () {
    const root = rootFor('root-open-race');
    const fsImpl = Object.create(fs);
    let raced = false;
    fsImpl.openSync = function (target) {
      if (!raced && path.basename(target).startsWith('.candidate-')) {
        raced = true;
        fs.rmdirSync(root);
        const error = new Error('synthetic namespace removal race');
        error.code = 'ENOENT';
        throw error;
      }
      return fs.openSync.apply(fs, arguments);
    };
    const leaseManager = manager(root, 1753, { fs: fsImpl });
    const lease = leaseManager.acquireSync('root open race');
    expect(raced).toBe(true);
    leaseManager.releaseSync(lease);
    expectRootClean(root);
  });

  test('a persistently unreadable peer defaults closed and still consumes capacity', function () {
    const root = rootFor('persistent-unreadable');
    const livePids = new Set([1761, 1762]);
    const peerPath = writeTicket(root, owner({
      pid: 1761,
      processStartIdentity: 'start-1761',
    }));
    const fsImpl = Object.create(fs);
    fsImpl.readFileSync = function (target) {
      if (target === peerPath) {
        const error = new Error('synthetic persistent sharing violation');
        error.code = 'EPERM';
        throw error;
      }
      return fs.readFileSync.apply(fs, arguments);
    };
    const leaseManager = manager(root, 1762, Object.assign(
      processOptions(1762, livePids),
      { fs: fsImpl, acquireTimeoutMs: 20 }
    ));
    expect(function () {
      leaseManager.acquireSync('persistent unreadable peer');
    }).toThrow(/live capacity owners/);
    expect(fs.existsSync(peerPath)).toBe(true);
  });

  test('ticket order is bounded-fair and a late waiter cannot starve earlier waiters', function () {
    const root = rootFor('fairness');
    const livePids = new Set([1801, 1802, 1803, 1804]);
    const managers = [1801, 1802, 1803, 1804].map(function (pid) {
      return manager(root, pid, processOptions(pid, livePids));
    });
    const first = managers[0].publish('first');
    const second = managers[1].publish('second');
    const third = managers[2].publish('third');
    const late = managers[3].publish('late');
    expect(managers[0].tryAcquirePublished(first)).toBe(true);
    expect(managers[1].tryAcquirePublished(second)).toBe(false);
    expect(managers[2].tryAcquirePublished(third)).toBe(false);
    expect(managers[3].tryAcquirePublished(late)).toBe(false);
    managers[0].releaseSync(first);
    expect(managers[1].tryAcquirePublished(second)).toBe(true);
    managers[1].releaseSync(second);
    expect(managers[2].tryAcquirePublished(third)).toBe(true);
    managers[2].releaseSync(third);
    expect(managers[3].tryAcquirePublished(late)).toBe(true);
    managers[3].releaseSync(late);
    expectRootClean(root);
  });

  test('abort and assertion-failure paths clean their own task files', function () {
    const abortRoot = rootFor('abort-cleanup');
    const abortManager = manager(abortRoot, 1901);
    const controller = new AbortController();
    controller.abort();
    expect(function () {
      abortManager.acquireSync('aborted waiter', { signal: controller.signal });
    }).toThrow(/aborted/);
    expectRootClean(abortRoot);

    const assertionRoot = rootFor('assertion-cleanup');
    const assertionManager = manager(assertionRoot, 1902);
    expect(function () {
      assertionManager.withLeaseSync('assertion failure', function () {
        throw new Error('synthetic assertion failure');
      });
    }).toThrow('synthetic assertion failure');
    expectRootClean(assertionRoot);
  });

  test('two separately spawned Node parents share one repository namespace', async function () {
    const root = rootFor('independent-processes');
    const modulePath = path.join(__dirname, 'loopbackConcurrencyGuard.js');
    const childCode = [
      "const guard=require(process.argv[1]);",
      "const root=process.argv[2];",
      "const hold=Number(process.argv[3]);",
      "const manager=guard.createLeaseManager({root,capacity:1,acquireTimeoutMs:5000,retryDelayMs:5});",
      "const lease=manager.acquireSync('independent-parent');",
      "process.stdout.write('ACQUIRED '+lease.waitMs+'\\n');",
      "setTimeout(()=>{manager.releaseSync(lease);process.stdout.write('RELEASED\\n');},hold);",
    ].join('');

    function startChild(hold) {
      const child = spawn(process.execPath, ['-e', childCode, modulePath, root, String(hold)], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', function (data) { stdout += data.toString(); });
      child.stderr.on('data', function (data) { stderr += data.toString(); });
      const closed = new Promise(function (resolve, reject) {
        child.once('error', reject);
        child.once('close', function (code) { resolve({ code, stdout, stderr }); });
      });
      const acquired = new Promise(function (resolve, reject) {
        const timer = setTimeout(function () {
          reject(new Error('child did not acquire: ' + stderr));
        }, 5000);
        child.stdout.on('data', function () {
          if (stdout.includes('ACQUIRED')) {
            clearTimeout(timer);
            resolve();
          }
        });
      });
      return { child, closed, acquired };
    }

    const first = startChild(300);
    await first.acquired;
    const second = startChild(0);
    const firstResult = await first.closed;
    const secondResult = await second.closed;
    expect(firstResult).toMatchObject({ code: 0 });
    expect(secondResult).toMatchObject({ code: 0 });
    const secondWait = Number(secondResult.stdout.match(/ACQUIRED (\d+)/)[1]);
    expect(secondWait).toBeGreaterThanOrEqual(100);
    expectRootClean(root);
  }, 10000);

  test('installed guard preserves two local servers and rejects a third without deadlock', async function () {
    const modulePath = path.join(__dirname, 'loopbackConcurrencyGuard.js');
    const installedRoot = rootFor('installed-guard');
    const childCode = [
      "const http=require('http');",
      "const guard=require(process.argv[1]);",
      "guard.install();",
      "const first=http.createServer((q,s)=>s.end('first'));",
      "const second=http.createServer((q,s)=>s.end('second'));",
      "const third=http.createServer((q,s)=>s.end('third'));",
      "first.listen(0,'127.0.0.1');",
      "second.listen(0,'127.0.0.1');",
      "let rejected=false;",
      "try{third.listen(0,'127.0.0.1')}catch(e){rejected=/verified Windows loopback threshold/.test(e.message)}",
      "Promise.all([new Promise(r=>first.once('listening',r)),new Promise(r=>second.once('listening',r))])",
      ".then(()=>Promise.all([new Promise((r,j)=>first.close(e=>e?j(e):r())),new Promise((r,j)=>second.close(e=>e?j(e):r()))]))",
      ".then(()=>{if(!rejected)throw new Error('third server was not rejected');console.log('TWO_LOCAL_PASS')})",
      ".catch(e=>{console.error(e);process.exitCode=1});",
    ].join('');
    const child = spawn(process.execPath, ['-e', childCode, modulePath], {
      env: Object.assign({}, process.env, {
        NORTHSTAR_LOOPBACK_GUARD_SELF_TEST_ROOT: installedRoot,
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', function (data) { stdout += data.toString(); });
    child.stderr.on('data', function (data) { stderr += data.toString(); });
    const result = await new Promise(function (resolve, reject) {
      child.once('error', reject);
      child.once('close', function (code) { resolve({ code, stdout, stderr }); });
    });
    expect(result).toMatchObject({ code: 0 });
    expect(result.stdout).toContain('TWO_LOCAL_PASS');
    expect(result.stderr).toBe('');
    expectRootClean(installedRoot);
  }, 10000);
});
