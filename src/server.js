/**
 * Northstar Solutions — AI Office Manager Platform
 * 
 * Full-stack application with:
 * - Marketing site & contractor dashboard
 * - Real contractor auth (passwords + JWT)
 * - AI Office Manager pipeline (Retell AI webhooks)
 * - Lead capture, notifications, sheets sync
 * - Calendar scheduling
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const apiRoutes = require('./routes/api');
const businessProfileRoutes = require('./routes/businessProfile');
const voiceRoutes = require('./routes/voice');
const voiceWebhook = require('./voice/webhook');
const { createCanonicalRouter, createCompatibilityRouter } = require('./routes/canonicalPolaris');
const { createLegacyAuthorityRetirementRouter } = require('./routes/legacyAuthorityRetirement');
const canonicalLeadsRoutes = require('./routes/canonicalLeads');
const { createAuthRouter } = require('./routes/auth');
const { AccountService } = require('./accounts/service');
const { createProductionTransactionalEmail } = require('./email/transactional');
const accountRoutes = require('./routes/account');
const { WorkforceService } = require('./workforce/service');
const { createWorkforceRouter } = require('./routes/workforce');
const db = require('./db');
const cache = require('./cache/client');
const audit = require('./audit/client');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const { securityHeaders, corsOptions } = require('./middleware/security');
const { correlationId, auditLogger } = require('./middleware/auditLog');

const app = express();
const PORT = config.port || 3000;

// Middleware
app.use(cors(corsOptions));
app.use(correlationId);
app.use(express.json({
  limit: '1mb',
  verify(req, _res, buffer) {
    req.rawBody = buffer.toString();
  },
}));
app.use(securityHeaders);
app.use(auditLogger);

// Static assets (CSS, JS)
app.use('/css', express.static('public/css'));
app.use('/js', express.static('public/js'));
app.use('/assets', express.static('public/assets'));

// Frontend page routes
const pages = {
  '/': 'public/index.html',
  '/demo-dashboard': 'public/demo-dashboard.html',
  '/login': 'public/login.html',
  '/signup': 'public/signup.html',
  '/verify-email': 'public/verify-email.html',
  '/forgot-password': 'public/forgot-password.html',
  '/reset-password': 'public/reset-password.html',
  '/accept-invitation': 'public/accept-invitation.html',
  '/account/pending': 'public/account/pending.html',
  '/dashboard': 'public/dashboard/command-center.html',
  '/dashboard/executive-brief': 'public/dashboard/executive-brief.html',
  '/dashboard/legacy': 'public/dashboard.html',
  '/dashboard/leads': 'public/dashboard/leads.html',
  '/dashboard/communications': 'public/dashboard/communications.html',
  '/dashboard/calendar': 'public/dashboard/calendar.html',
  '/dashboard/team': 'public/dashboard/team.html',
  '/dashboard/ai-settings': 'public/dashboard/ai-settings.html',
  '/dashboard/business-profile': 'public/dashboard/business-profile.html',
  '/dashboard/my-number': 'public/dashboard/my-number.html',
  '/dashboard/settings': 'public/dashboard/settings.html',
  '/dashboard/integrations': 'public/dashboard/integrations.html',
  '/dashboard/lead': 'public/dashboard/lead.html',
  '/dashboard/polaris': 'public/dashboard/polaris.html',
  '/contact': 'public/contact.html',
  '/privacy': 'public/privacy.html',
  '/terms': 'public/terms.html',
  '/refund': 'public/refund.html',
  '/legal': 'public/legal.html',
  '/admin': 'public/admin.html',
  '/preview-dark': 'public/previews/dark.html',
  '/preview-light': 'public/previews/light.html',
};

// Redirect old /dashboard/calls to /dashboard/communications
app.get('/dashboard/calls', (req, res) => {
  res.redirect(301, '/dashboard/communications');
});

Object.entries(pages).forEach(([route, file]) => {
  app.get(route, (req, res) => {
    res.sendFile(path.join(__dirname, '..', file));
  });
});

// --- PostgreSQL Account and Session Authority ---
// Signup capability exists only when the source-owned production constructor
// validates complete Resend delivery configuration and the canonical HTTPS origin.
// No boolean or request field can enable this boundary.
const productionTransactionalEmail = createProductionTransactionalEmail(process.env);
const productionAccountService = new AccountService(undefined, {
  transactionalEmail: productionTransactionalEmail,
});
const productionWorkforceService = new WorkforceService(undefined, {
  transactionalEmail: productionTransactionalEmail,
});
app.locals.workforceService = productionWorkforceService;
app.use('/api/auth', createAuthRouter({
  service: productionAccountService,
  signup: productionTransactionalEmail
    ? productionAccountService.signup.bind(productionAccountService)
    : null,
}));
app.use('/api/account', accountRoutes);
app.use('/api/workforce', createWorkforceRouter());

// Legacy demo credential minting is retired. Canonical demo access requires a
// separately provisioned account attached to canonical_demo_authority.
app.get('/demo-login', (_req, res) => res.redirect(302, '/login?demo=retired'));

function legacyAdminDisabled(req, res) {
  return res.status(410).json({
    error: 'Legacy administrative authentication is disabled',
    code: 'legacy_admin_disabled',
    requestId: req.requestId || 'unavailable',
  });
}
app.all('/api/admin/login', legacyAdminDisabled);
app.all('/api/admin/users', legacyAdminDisabled);

// ── /api/v1/* routes — registered BEFORE /api to avoid interception by apiRoutes' global requireAuth
const simulationsRoutes = require('./routes/simulations');
app.use('/api/v1', simulationsRoutes);
app.use('/api/v1/canonical', createCanonicalRouter());
// Canonical compatibility routes precede legacy dashboard/public routers so
// supported reads cannot be shadowed by unscoped file-era handlers.
app.use('/api/v1', createCompatibilityRouter());
// Specific downstream routers precede the broad dashboard router. This keeps
// its router-wide authentication from touching paths it does not own.
app.use('/api/v1/business-profile', businessProfileRoutes);
app.use('/api/v1/voice', voiceRoutes);
app.use('/api/v1', createLegacyAuthorityRetirementRouter());

// Canonical /api lead adapters precede the file-era router. The compatibility
// router authenticates only paths it owns, so public webhooks still fall through.
app.use('/api', canonicalLeadsRoutes);
app.use('/api', createCompatibilityRouter());
app.use('/api', createLegacyAuthorityRetirementRouter());
// API routes (global requireAuth applies to all remaining /api/* routes)
app.use('/api', apiRoutes);

// 404 + error handler (single instances)
app.use(notFound);
app.use(errorHandler);

// Start server
async function start(options) {
  config.validateRuntime();
  const listenHost = options && options.host ? String(options.host) : null;
  if (listenHost && listenHost !== '127.0.0.1' && listenHost !== '::1') {
    throw new Error('Explicit server host must be loopback');
  }
  const databaseReady = await db.initDatabase();
  if (!databaseReady) {
    throw new Error('PostgreSQL startup authority is unavailable');
  }

  voiceWebhook.start();
  await cache.init();
  await audit.ensureTable();


  const onListening = () => {
    const baseUrl = `http://${listenHost || 'localhost'}:${PORT}`;
    console.log(`
╔══════════════════════════════════════════════╗
║      Northstar Solutions — Platform v1.0     ║
╠══════════════════════════════════════════════╣
║  🌐  ${baseUrl.padEnd(38)}║
║  🔐  Auth:        ${'HttpOnly session cookies'.padEnd(31)}║
║  🗄️  Database:    ${(db.isAvailable() ? '✓ PostgreSQL'.padEnd(31) : '✗ Unavailable'.padEnd(31))}║
║  📞  Retell AI:   ${config.retell.apiKey ? '✓ Ready'.padEnd(31) : '○ Needs API Key'.padEnd(31)}║
║  📱  Twilio SMS:  ${config.twilio.accountSid ? '✓ Ready'.padEnd(31) : '○ Needs API Key'.padEnd(31)}║
╚══════════════════════════════════════════════╝
    `);

    console.log('📍 Pages:');
    console.log(`  ${baseUrl}/               → Landing page`);
    console.log(`  ${baseUrl}/login           → Sign in`);
    console.log(`  ${baseUrl}/signup          → Sign up (14-day free trial)`);
    console.log(`  ${baseUrl}/dashboard       → Contractor dashboard`);
    console.log(`  ${baseUrl}/dashboard/integrations → Integrations`);
    console.log(`  ${baseUrl}/admin           → Admin panel`);
    console.log('');
    console.log('📍 Auth API:');
    console.log(`  POST ${baseUrl}/api/auth/signup          → Requires validated transactional email delivery`);
    console.log(`  POST ${baseUrl}/api/auth/login           → Sign in`);
    console.log(`  POST ${baseUrl}/api/auth/refresh         → Refresh token`);
    console.log(`  POST ${baseUrl}/api/auth/logout          → Revoke session`);
    console.log(`  GET  ${baseUrl}/api/auth/me              → Current user`);
    console.log('');
  };
  const server = listenHost
    ? app.listen(PORT, listenHost, onListening)
    : app.listen(PORT, onListening);

  server.once('close', () => {
    voiceWebhook.shutdown();
  });

  return server;
}

// Only auto-start when run directly (not when required via require() for testing)
if (require.main === module) {
  start().catch(err => {
    console.error('[Server] Failed to start:', err);
  });
}

module.exports = { app, start };
