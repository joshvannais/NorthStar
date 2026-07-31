'use strict';

/**
 * Disposable-test application capability for Account Lifecycle PR A.
 * Production src/server.js never imports this module and never passes signup.
 */
function createDisposableAccountApp(options = {}) {
  const express = require('express');
  const path = require('path');
  const { AccountService } = require('../../src/accounts/service');
  const { createAuthRouter } = require('../../src/routes/auth');
  const { createCanonicalRouter, createCompatibilityRouter } = require('../../src/routes/canonicalPolaris');
  const { createJobberIntegrationRouter } = require('../../src/routes/jobberIntegration');
  const { createLegacyAuthorityRetirementRouter } = require('../../src/routes/legacyAuthorityRetirement');
  const service = new AccountService();
  const app = express();

  app.use(express.json({ limit: '1mb' }));
  const publicRoot = path.resolve(__dirname, '../../public');
  app.use('/css', express.static(path.join(publicRoot, 'css')));
  app.use('/js', express.static(path.join(publicRoot, 'js')));
  app.use('/assets', express.static(path.join(publicRoot, 'assets')));
  for (const [route, file] of Object.entries({
    '/login': 'login.html',
    '/signup': 'signup.html',
    '/dashboard': 'dashboard/command-center.html',
    '/dashboard/business-profile': 'dashboard/business-profile.html',
    '/dashboard/settings': 'dashboard/settings.html',
  })) {
    app.get(route, (_req, res) => res.sendFile(path.join(publicRoot, file)));
  }
  app.use('/api/auth', createAuthRouter({
    service,
    signup: service.signup.bind(service),
  }));
  app.use('/api/account', require('../../src/routes/account'));
  app.use('/api/v1', require('../../src/routes/simulations'));
  app.use('/api/v1/canonical', createCanonicalRouter());
  app.use('/api/v1', createCompatibilityRouter());
  app.use('/api/v1/business-profile', require('../../src/routes/businessProfile'));
  app.use('/api/v1/voice', require('../../src/routes/voice'));
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
  return app;
}

module.exports = { createDisposableAccountApp };
