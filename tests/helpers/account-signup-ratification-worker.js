'use strict';

const request = require('supertest');

function signupBody(email, index) {
  return {
    name: `Concurrent Owner ${index}`,
    businessName: `Concurrent Business ${index}`,
    phone: `860555${String(1000 + index).slice(-4)}`,
    email,
    password: 'concurrent signup password',
  };
}

async function main(message) {
  if (!message || message.type !== 'run' || !Number.isInteger(message.count) ||
      message.count < 1 || message.count > 32 || typeof message.email !== 'string') {
    throw new Error('invalid_worker_request');
  }
  if (!process.env.DATABASE_URL || !process.env.AUTH_ACCESS_SECRET) {
    throw new Error('worker_database_identity_missing');
  }

  const db = require('../../src/db');
  try {
    if (!await db.initDatabase()) throw new Error('worker_database_unavailable');
    const app = require('./account-signup-ratification-app').createSignupRatificationApp();
    const responses = await Promise.all(Array.from({ length: message.count }, (_, offset) => {
      const index = message.indexOffset + offset;
      return request(app)
        .post('/api/auth/signup')
        .set('X-Forwarded-For', `198.51.100.${index + 1}`)
        .send(signupBody(message.email, index));
    }));
    return responses.map(response => ({
      status: response.status,
      code: response.body && response.body.code || null,
      cookieCount: (response.headers['set-cookie'] || []).length,
    }));
  } finally {
    await db.close();
  }
}

process.once('message', message => {
  main(message).then(results => {
    if (process.send) process.send({ type: 'result', processId: process.pid, results });
  }).catch(error => {
    process.exitCode = 1;
    if (process.send) process.send({ type: 'error', code: error.message || 'signup_worker_failed' });
  }).finally(() => {
    if (process.connected) process.disconnect();
  });
});
