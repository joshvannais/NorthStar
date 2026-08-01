'use strict';

/**
 * Test-owned source-level signup capability. Production src/server.js never
 * imports this module and never injects signup into createAuthRouter().
 */
function createSignupRatificationApp(options = {}) {
  const crypto = require('crypto');
  const express = require('express');
  const { AccountService } = require('../../src/accounts/service');
  const { TransactionalEmail } = require('../../src/email/transactional');
  const { createAuthRouter } = require('../../src/routes/auth');
  const capture = options.emailCapture || {
    messages: [],
    async send(message) {
      this.messages.push(JSON.parse(JSON.stringify(message)));
      return { accepted: true };
    },
  };
  const service = options.service || new AccountService(undefined, {
    transactionalEmail: new TransactionalEmail({
      adapter: capture,
      publicOrigin: 'http://127.0.0.1',
      from: 'security@northstar.example.test',
      production: false,
    }),
  });
  const app = express();

  // Supertest connects over loopback. Trust only that hop so each adversarial
  // request can carry an independent test IP through the real rate limiter.
  app.set('trust proxy', address => (
    address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
  ));
  app.use(express.json({ limit: '64kb' }));
  app.use((req, _res, next) => {
    req.requestId = `signup-ratification-${crypto.randomUUID()}`;
    next();
  });
  app.use('/api/auth', createAuthRouter({
    service,
    signup: service.signup.bind(service),
  }));
  app.accountEmailCapture = capture;
  return app;
}

module.exports = { createSignupRatificationApp };
