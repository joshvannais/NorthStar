'use strict';

let server = null;
let db = null;

async function close() {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = null;
  }
  if (db) await db.close();
}

async function start() {
  global.fetch = async function providerBoundaryMustRemainUnused() {
    throw new Error('Provider/network boundary must remain unused');
  };
  db = require('../../src/db');
  if (!await db.initDatabase()) throw new Error('worker_database_unavailable');
  const { app } = require('../../src/server');
  server = app.listen(0, '127.0.0.1', () => {
    if (process.send) process.send({ type: 'ready', port: server.address().port });
  });
}

process.on('message', async message => {
  if (!message || message.type !== 'stop') return;
  try {
    await close();
    process.exit(0);
  } catch (error) {
    if (process.send) process.send({ type: 'error', code: error.message });
    process.exit(1);
  }
});

start().catch(error => {
  if (process.send) process.send({ type: 'error', code: error.message });
  process.exit(1);
});
