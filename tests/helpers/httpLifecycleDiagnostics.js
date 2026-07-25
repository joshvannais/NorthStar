'use strict';

// Opt-in diagnostics for reproducing Windows/Jest HTTP lifecycle stalls.
// This file is not referenced by jest.config.js and has no effect unless a
// diagnostic command explicitly loads it with --setupFilesAfterEnv.

if (process.env.NORTHSTAR_HTTP_DIAGNOSTICS === '1') {
  const fs = require('fs');
  const http = require('http');
  const os = require('os');
  const path = require('path');
  const { monitorEventLoopDelay, performance } = require('perf_hooks');

  const diagnosticKey = Symbol.for('northstar.httpLifecycleDiagnostics');
  const outputDirectory = process.env.NORTHSTAR_HTTP_DIAGNOSTIC_DIR || os.tmpdir();
  const slowThresholdMs = Number(process.env.NORTHSTAR_HTTP_DIAGNOSTIC_SLOW_MS || 1000);
  const snapshotDelayMs = Number(process.env.NORTHSTAR_HTTP_DIAGNOSTIC_SNAPSHOT_MS || 2000);
  const existingController = http[diagnosticKey];

  function registerHooks(controller) {
    beforeEach(function () {
      controller.startTest(expect.getState().currentTestName);
    });
    afterEach(function () {
      controller.finishTest();
    });
  }

  if (existingController) {
    registerHooks(existingController);
  } else {
  const originalRequest = http.request;
  const originalListen = http.Server.prototype.listen;
  const originalClose = http.Server.prototype.close;
  const originalEmit = http.Server.prototype.emit;
  const serverIds = new WeakMap();
  const socketIds = new WeakMap();
  const requestIds = new WeakMap();
  const responseIds = new WeakMap();
  const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
  let activeTest = null;
  let nextId = 1;
  let outputSequence = 0;

  fs.mkdirSync(outputDirectory, { recursive: true });

  function idFor(map, value, prefix) {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) return null;
    if (!map.has(value)) map.set(value, prefix + nextId++);
    return map.get(value);
  }

  function addressOf(server) {
    try {
      return server && server.address ? server.address() : null;
    } catch (_error) {
      return null;
    }
  }

  function record(event, detail) {
    if (!activeTest) return;
    activeTest.events.push(Object.assign({
      event,
      wallTimeMs: Date.now(),
      elapsedMs: Number((performance.now() - activeTest.startedAt).toFixed(3)),
    }, detail || {}));
  }

  function describeHandle(handle) {
    const type = handle && handle.constructor ? handle.constructor.name : typeof handle;
    const detail = { type };
    if (type === 'Server') {
      detail.listening = Boolean(handle.listening);
      detail.address = addressOf(handle);
      detail.connections = handle._connections;
    } else if (type === 'Socket' || type === 'TLSSocket') {
      detail.connecting = Boolean(handle.connecting);
      detail.destroyed = Boolean(handle.destroyed);
      detail.localAddress = handle.localAddress || null;
      detail.localPort = handle.localPort || null;
      detail.remoteAddress = handle.remoteAddress || null;
      detail.remotePort = handle.remotePort || null;
      detail.readable = Boolean(handle.readable);
      detail.writable = Boolean(handle.writable);
      detail.bytesRead = handle.bytesRead;
      detail.bytesWritten = handle.bytesWritten;
    } else if (type === 'ChildProcess') {
      detail.pid = handle.pid;
      detail.killed = Boolean(handle.killed);
    } else if (type === 'Timeout') {
      detail.idleTimeout = handle._idleTimeout;
    }
    return detail;
  }

  function runtimeSnapshot(label, scheduledAt) {
    if (!activeTest) return;
    const cpu = process.cpuUsage(activeTest.cpuStart);
    const memory = process.memoryUsage();
    record('runtime.snapshot', {
      label,
      timerDriftMs: scheduledAt === undefined
        ? null
        : Number((performance.now() - scheduledAt - snapshotDelayMs).toFixed(3)),
      cpuUserMs: Number((cpu.user / 1000).toFixed(3)),
      cpuSystemMs: Number((cpu.system / 1000).toFixed(3)),
      memory,
      eventLoopDelayMs: {
        min: Number((eventLoopDelay.min / 1e6).toFixed(3)),
        mean: Number((eventLoopDelay.mean / 1e6).toFixed(3)),
        max: Number((eventLoopDelay.max / 1e6).toFixed(3)),
      },
      handles: typeof process._getActiveHandles === 'function'
        ? process._getActiveHandles().map(describeHandle)
        : [],
      requests: typeof process._getActiveRequests === 'function'
        ? process._getActiveRequests().map(function (request) {
          return request && request.constructor ? request.constructor.name : typeof request;
        })
        : [],
    });
  }

  function writeSlowRecord(durationMs) {
    const safeWorker = String(process.env.JEST_WORKER_ID || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = [
      'http-lifecycle',
      'worker-' + safeWorker,
      'pid-' + process.pid,
      String(++outputSequence).padStart(4, '0'),
      '.json',
    ].join('');
    fs.writeFileSync(path.join(outputDirectory, fileName), JSON.stringify({
      workerId: process.env.JEST_WORKER_ID || null,
      pid: process.pid,
      testName: activeTest.name,
      durationMs: Number(durationMs.toFixed(3)),
      cwd: process.cwd(),
      cwdUnderOneDrive: /[\\/]OneDrive[\\/]/i.test(process.cwd()),
      node: process.version,
      platform: process.platform,
      events: activeTest.events,
    }, null, 2));
  }

  http.Server.prototype.listen = function diagnosticListen() {
    const server = this;
    const serverId = idFor(serverIds, server, 'server-');
    record('server.listen.call', { serverId, arguments: Array.from(arguments).map(String) });
    server.once('listening', function () {
      record('server.listen.callback', { serverId, address: addressOf(server) });
    });
    return originalListen.apply(server, arguments);
  };

  http.Server.prototype.emit = function diagnosticEmit(eventName) {
    if (eventName === 'connection') {
      const socket = arguments[1];
      const serverId = idFor(serverIds, this, 'server-');
      const socketId = idFor(socketIds, socket, 'socket-');
      record('server.tcp.connection', {
        serverId,
        socketId,
        localAddress: socket.localAddress || null,
        localPort: socket.localPort || null,
        remoteAddress: socket.remoteAddress || null,
        remotePort: socket.remotePort || null,
      });
      socket.once('close', function (hadError) {
        record('server.socket.close', { serverId, socketId, hadError: Boolean(hadError) });
      });
    } else if (eventName === 'request') {
      const request = arguments[1];
      const response = arguments[2];
      const serverId = idFor(serverIds, this, 'server-');
      const serverRequestId = idFor(requestIds, request, 'server-request-');
      const serverResponseId = idFor(responseIds, response, 'server-response-');
      record('server.request.entry', {
        serverId,
        serverRequestId,
        serverResponseId,
        method: request.method,
        url: request.url,
      });
      response.once('finish', function () {
        record('server.response.finish', {
          serverId,
          serverRequestId,
          serverResponseId,
          statusCode: response.statusCode,
        });
      });
      response.once('close', function () {
        record('server.response.close', {
          serverId,
          serverRequestId,
          serverResponseId,
          statusCode: response.statusCode,
        });
      });
    }
    return originalEmit.apply(this, arguments);
  };

  http.Server.prototype.close = function diagnosticClose() {
    const server = this;
    const serverId = idFor(serverIds, server, 'server-');
    const args = Array.from(arguments);
    const callbackIndex = args.findIndex(function (argument) { return typeof argument === 'function'; });
    const callback = callbackIndex >= 0 ? args[callbackIndex] : null;
    record('server.close.start', { serverId, address: addressOf(server) });
    const wrapped = function (error) {
      record('server.close.complete', {
        serverId,
        error: error ? { code: error.code, message: error.message } : null,
      });
      if (callback) callback.apply(this, arguments);
    };
    if (callbackIndex >= 0) args[callbackIndex] = wrapped;
    else args.push(wrapped);
    return originalClose.apply(server, args);
  };

  http.request = function diagnosticRequest() {
    const request = originalRequest.apply(http, arguments);
    const requestId = idFor(requestIds, request, 'client-request-');
    const firstArgument = arguments[0];
    record('client.request.create', {
      requestId,
      target: typeof firstArgument === 'string'
        ? firstArgument
        : {
          protocol: firstArgument && firstArgument.protocol,
          hostname: firstArgument && (firstArgument.hostname || firstArgument.host),
          port: firstArgument && firstArgument.port,
          method: firstArgument && firstArgument.method,
          path: firstArgument && firstArgument.path,
        },
    });
    request.once('socket', function (socket) {
      const socketId = idFor(socketIds, socket, 'socket-');
      record('client.socket.assigned', {
        requestId,
        socketId,
        connecting: Boolean(socket.connecting),
      });
      socket.once('connect', function () {
        record('client.socket.connect', {
          requestId,
          socketId,
          localAddress: socket.localAddress || null,
          localPort: socket.localPort || null,
          remoteAddress: socket.remoteAddress || null,
          remotePort: socket.remotePort || null,
        });
      });
    });
    request.once('finish', function () {
      record('client.request.finish', { requestId });
    });
    request.once('response', function (response) {
      const responseId = idFor(responseIds, response, 'client-response-');
      record('client.response.headers', {
        requestId,
        responseId,
        statusCode: response.statusCode,
        canonicalRequestId: response.headers && response.headers['x-correlation-id'],
      });
      response.once('end', function () {
        record('client.response.end', { requestId, responseId });
      });
      response.once('close', function () {
        record('client.response.close', { requestId, responseId });
      });
    });
    request.once('error', function (error) {
      record('client.request.error', {
        requestId,
        code: error.code,
        message: error.message,
      });
    });
    request.once('close', function () {
      record('client.request.close', { requestId });
    });
    return request;
  };

  eventLoopDelay.enable();

  function startTest(testName) {
    eventLoopDelay.reset();
    activeTest = {
      name: testName,
      startedAt: performance.now(),
      cpuStart: process.cpuUsage(),
      events: [],
      snapshotTimer: null,
    };
    record('test.start', {
      workerId: process.env.JEST_WORKER_ID || null,
      pid: process.pid,
    });
    const scheduledAt = performance.now();
    activeTest.snapshotTimer = setTimeout(function () {
      runtimeSnapshot('slow-threshold', scheduledAt);
    }, snapshotDelayMs);
    if (typeof activeTest.snapshotTimer.unref === 'function') activeTest.snapshotTimer.unref();
  }

  function finishTest() {
    if (!activeTest) return;
    if (activeTest.snapshotTimer) clearTimeout(activeTest.snapshotTimer);
    const durationMs = performance.now() - activeTest.startedAt;
    runtimeSnapshot('test-complete');
    record('test.complete', { durationMs: Number(durationMs.toFixed(3)) });
    if (durationMs >= slowThresholdMs) writeSlowRecord(durationMs);
    activeTest = null;
  }

  const controller = { startTest, finishTest };
  http[diagnosticKey] = controller;
  registerHooks(controller);
  }
}
