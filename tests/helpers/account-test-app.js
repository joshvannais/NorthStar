'use strict';

/**
 * Disposable-test application capability for Account Lifecycle PR A.
 * Production src/server.js never imports this module and never passes signup.
 */
function createDisposableAccountApp(options = {}) {
  const express = require('express');
  const path = require('path');
  const { AccountService } = require('../../src/accounts/service');
  const { TransactionalEmail } = require('../../src/email/transactional');
  const { createAuthRouter } = require('../../src/routes/auth');
  const { createCanonicalRouter, createCompatibilityRouter } = require('../../src/routes/canonicalPolaris');
  const { createJobberIntegrationRouter } = require('../../src/routes/jobberIntegration');
  const { createIntegrationStatusRouter } = require('../../src/routes/integrationStatus');
  const { createMapPreferencesRouter } = require('../../src/routes/mapPreferences');
  const { createLegacyAuthorityRetirementRouter } = require('../../src/routes/legacyAuthorityRetirement');
  const capture = options.emailCapture || {
    messages: [],
    async send(message) {
      this.messages.push(JSON.parse(JSON.stringify(message)));
      return { accepted: true };
    },
  };
  const transactionalEmail = options.transactionalEmail || new TransactionalEmail({
    adapter: capture,
    publicOrigin: options.publicOrigin || 'http://127.0.0.1',
    from: 'security@northstar.example.test',
    production: false,
  });
  const { AccountRepository } = require('../../src/accounts/repository');
  const { AccountEmailOutboxWorker } = require('../../src/email/outbox');
  const repository = options.repository || new AccountRepository(undefined, {
    testClock: options.testClock,
  });
  const service = new AccountService(repository, {
    transactionalEmail,
    sleep: options.sleep || (async () => {}),
  });
  const emailOutboxWorker = new AccountEmailOutboxWorker({ repository, transactionalEmail });
  const app = express();
  app.locals.accountRepository = repository;

  app.use(express.json({ limit: '1mb' }));
  const publicRoot = path.resolve(__dirname, '../../public');
  app.use('/css', express.static(path.join(publicRoot, 'css')));
  app.use('/js', express.static(path.join(publicRoot, 'js')));
  app.use('/assets', express.static(path.join(publicRoot, 'assets')));
  for (const [route, file] of Object.entries({
    '/login': 'login.html',
    '/signup': 'signup.html',
    '/verify-email': 'verify-email.html',
    '/forgot-password': 'forgot-password.html',
    '/reset-password': 'reset-password.html',
    '/account/pending': 'account/pending.html',
    '/dashboard': 'dashboard/command-center.html',
    '/dashboard/business-profile': 'dashboard/business-profile.html',
    '/dashboard/settings': 'dashboard/settings.html',
    '/dashboard/integrations': 'dashboard/integrations.html',
  })) {
    app.get(route, (_req, res) => res.sendFile(path.join(publicRoot, file)));
  }
  app.use('/api/auth', createAuthRouter({
    service,
    signup: service.signup.bind(service),
  }));
  app.use('/api/account/map-preferences', createMapPreferencesRouter());
  app.use('/api/account', require('../../src/routes/account'));
  app.use('/api/v1', require('../../src/routes/simulations'));
  app.use('/api/v1/canonical', createCanonicalRouter());
  app.use('/api/v1', createCompatibilityRouter());
  app.use('/api/v1/business-profile', require('../../src/routes/businessProfile'));
  app.use('/api/v1/voice', require('../../src/routes/voice'));
  app.use('/api/v1/integrations', createIntegrationStatusRouter());
  app.use('/api/v1', createLegacyAuthorityRetirementRouter());
  app.use('/api', require('../../src/routes/canonicalLeads'));
  app.use('/api', createCompatibilityRouter());
  app.use('/api', createLegacyAuthorityRetirementRouter());
  if (options.jobberConnectionCapability) {
    app.use('/api/integrations/jobber', createJobberIntegrationRouter({
      connectionCapability: options.jobberConnectionCapability,
    }));
  }
  app.use('/api', require('../../src/routes/api'));
  app.accountEmailCapture = capture;
  app.drainAccountEmailOutbox = () => emailOutboxWorker.drainOnce();
  return app;
}

module.exports = { createDisposableAccountApp };
