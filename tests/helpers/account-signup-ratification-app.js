'use strict';

/**
 * Test-owned source-level signup capability. Production src/server.js never
 * imports this module and never injects signup into createAuthRouter().
 */
function createSignupRatificationApp(options = {}) {
  const crypto = require('crypto');
  const express = require('express');
  const { AccountService } = require('../../src/accounts/service');
  const { createAuthRouter } = require('../../src/routes/auth');
  const service = options.service || new AccountService();
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
  return app;
}

module.exports = { createSignupRatificationApp };
