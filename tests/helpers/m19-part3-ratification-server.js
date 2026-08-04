'use strict';

const db = require('../../src/db');
const { start } = require('../../src/server');

let server = null;
let shuttingDown = null;

function send(message) {
  if (typeof process.send === 'function' && process.connected) process.send(message);
}

async function shutdown(reason) {
  if (shuttingDown) return shuttingDown;
  shuttingDown = (async function () {
    if (server) {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      await new Promise(function (resolve, reject) {
        server.close(function (error) {
          if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
          else resolve();
        });
      });
      server = null;
    }
    await db.close();
    send({ type: 'stopped', reason: reason || 'requested' });
  })();
  return shuttingDown;
}

process.on('message', function (message) {
  if (!message || message.type !== 'shutdown') return;
  shutdown('ipc').then(function () {
    process.exit(0);
  }).catch(function (error) {
    send({ type: 'error', message: error.message });
    process.exit(1);
  });
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, function () {
    shutdown(signal).finally(function () { process.exit(0); });
  });
}

(async function main() {
  server = await start({ host: '127.0.0.1' });
  if (!server.listening) {
    await new Promise(function (resolve, reject) {
      server.once('listening', resolve);
      server.once('error', reject);
    });
  }
  const address = server.address();
  send({ type: 'ready', address: address.address, port: address.port });
})().catch(function (error) {
  send({ type: 'error', message: error.message });
  process.exit(1);
});
