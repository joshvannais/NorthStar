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
const { createRetellWebhookBoundaryRouter } = require('./routes/retellWebhookBoundary');
const { createCanonicalRouter, createCompatibilityRouter } = require('./routes/canonicalPolaris');
const { createProductionOpenAIRuntime } = require('./polaris/openaiRuntime');
const { createProviderUsageLedger } = require('./polaris/providerLedger');
const { recommendationBodyBoundary } = require('./scheduling/recommendationHttpBoundary');
const { approvalBodyBoundary } = require('./scheduling/approvalHttpBoundary');
const { executionBodyBoundary } = require('./operations/httpBoundary');
const { createLegacyAuthorityRetirementRouter } = require('./routes/legacyAuthorityRetirement');
const canonicalLeadsRoutes = require('./routes/canonicalLeads');
const { createAuthRouter } = require('./routes/auth');
const { AccountService } = require('./accounts/service');
const { createProductionTransactionalEmail } = require('./email/transactional');
const { AccountEmailOutboxWorker } = require('./email/outbox');
const accountRoutes = require('./routes/account');
const { createMapPreferencesRouter } = require('./routes/mapPreferences');
const { WorkforceService } = require('./workforce/service');
const { createWorkforceRouter } = require('./routes/workforce');
const { AssetCatalogueService } = require('./assets/service');
const { createAssetCatalogueRouter } = require('./routes/assets');
const { createIntegrationStatusRouter } = require('./routes/integrationStatus');
const { createCommandCenterRouter } = require('./routes/commandCenter');
const { createTodayRouter } = require('./routes/today');
const { createKnowledgeManagementRouter } = require('./routes/knowledgeManagement');
const { createSupportRouter } = require('./routes/support');
const { createFieldExecutionsRouter } = require('./routes/fieldExecutions');
const { mountInvestorForecast } = require('./routes/investorForecast');
const { SupportCaseOutboxWorker } = require('./support/outbox');
const { DemoCommandCenterHousekeepingWorker } = require('./commandCenter/demoRepository');
const { HomepageDemoAdmissionHousekeepingWorker } = require('./services/homepageDemoAdmission');
const commandCenterContract = require('../public/js/command-center-contract');
const db = require('./db');
const cache = require('./cache/client');
const audit = require('./audit/client');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const { securityHeaders, corsOptions } = require('./middleware/security');
const { correlationId, auditLogger } = require('./middleware/auditLog');

const app = express();
const PORT = config.port || 3000;

// Trust only loopback/link-local/private proxy peers so req.ip resolves the
// nearest untrusted client address without accepting spoofed forwarding from a
// direct public peer.
app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal']);

// Middleware
app.use(cors(corsOptions));
app.use(correlationId);
// The two signed Retell entry points must receive bounded raw bytes before the
// global JSON parser. The boundary router owns only those exact paths.
app.use(createRetellWebhookBoundaryRouter());
// Mission 22 Part 3 recommendations are a read-only, non-capability POST with
// an exact 64 KiB unambiguous JSON contract. Own its received bytes before the
// broader application parser consumes the stream.
app.use(recommendationBodyBoundary);
// Mission 22 Part 4 human preview/approval endpoints own exact, bounded,
// unambiguous bytes before the broader application parser. The preview is
// evidence only and never a bearer capability.
app.use(approvalBodyBoundary);
// Mission 23 Part 2 field-execution mutations own exact, bounded,
// unambiguous bytes before the broader application parser consumes them.
app.use(executionBodyBoundary);
app.use(express.json({
  limit: '1mb',
  verify(req, _res, buffer) {
    req.rawBody = buffer.toString();
  },
}));
app.use(securityHeaders);
app.use(auditLogger);

// Deliberately unlisted, direct-link-only investor forecast. This exact route
// owns the self-contained calculator policy before ordinary page routing.
mountInvestorForecast(app);

// Static assets (CSS, JS)
app.use('/css', express.static('public/css'));
app.use('/js', express.static('public/js'));
app.use('/assets', express.static('public/assets'));
app.get('/site.webmanifest', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'site.webmanifest'));
});

// Frontend page routes
const pages = {
  '/': 'public/index.html',
  '/login': 'public/login.html',
  '/signup': 'public/signup.html',
  '/verify-email': 'public/verify-email.html',
  '/forgot-password': 'public/forgot-password.html',
  '/reset-password': 'public/reset-password.html',
  '/accept-invitation': 'public/accept-invitation.html',
  '/account/pending': 'public/account/pending.html',
  '/dashboard': 'public/demo-dashboard.html',
  '/dashboard/today': 'public/dashboard/today.html',
  '/dashboard/executive-brief': 'public/dashboard/executive-brief.html',
  '/dashboard/leads': 'public/dashboard/leads.html',
  '/dashboard/communications': 'public/dashboard/communications.html',
  '/dashboard/calendar': 'public/dashboard/calendar.html',
  '/dashboard/team': 'public/dashboard/team.html',
  '/dashboard/business-profile': 'public/dashboard/business-profile.html',
  '/dashboard/settings': 'public/dashboard/settings.html',
  '/dashboard/integrations': 'public/dashboard/integrations.html',
  '/dashboard/lead': 'public/dashboard/lead.html',
  '/dashboard/polaris': 'public/dashboard/polaris.html',
  '/dashboard/report-a-bug': 'public/dashboard/report-a-bug.html',
  '/contact': 'public/contact.html',
  '/faq': 'public/faq.html',
  '/privacy': 'public/privacy.html',
  '/terms': 'public/terms.html',
  '/refund': 'public/refund.html',
  '/legal': 'public/legal.html',
  '/admin': 'public/admin.html',
  '/preview-dark': 'public/previews/dark.html',
  '/preview-light': 'public/previews/light.html',
};

// Every account-free destination mounts the same established page shell and
// browser modules as its paid counterpart. DemoRuntime changes only authority,
// routes, and transport; it never replaces these pages with a generic renderer.
const demoPageFiles = Object.freeze({
  'command-center': 'public/demo-dashboard.html',
  polaris: 'public/dashboard/polaris.html',
  leads: 'public/dashboard/leads.html',
  communications: 'public/dashboard/communications.html',
  calendar: 'public/dashboard/calendar.html',
  team: 'public/dashboard/team.html',
  'business-profile': 'public/dashboard/business-profile.html',
  settings: 'public/dashboard/settings.html',
  integrations: 'public/dashboard/integrations.html',
});
for (const destination of commandCenterContract.ROUTES) {
  pages[destination.demoPath] = demoPageFiles[destination.id];
}

// Redirect old /dashboard/calls to /dashboard/communications
app.get('/dashboard/calls', (req, res) => {
  res.redirect(301, '/dashboard/communications');
});

// The standalone Contractor Command Center is the only paid dashboard shell.
app.get('/dashboard/legacy', (_req, res) => {
  res.redirect(301, '/dashboard');
});

// Preserve old bookmarks while keeping one canonical account-free Command Center URL.
app.get('/demo-dashboard', (_req, res) => {
  res.redirect(301, '/demo');
});

// Preserve old bookmarks while keeping AI and phone configuration in their
// single canonical editors.
app.get('/dashboard/ai-settings', (_req, res) => {
  res.redirect(301, '/dashboard/settings#ai-settings');
});
app.get('/demo/ai-settings', (_req, res) => {
  res.redirect(301, '/demo/settings#ai-settings');
});
app.get('/dashboard/my-number', (_req, res) => {
  res.redirect(301, '/dashboard/business-profile?section=company#business-number');
});
app.get('/demo/my-number', (_req, res) => {
  res.redirect(301, '/demo/business-profile?section=company#business-number');
});

Object.entries(pages).forEach(([route, file]) => {
  app.get(route, (req, res) => {
    res.sendFile(path.join(__dirname, '..', file));
  });
});

// --- PostgreSQL Account and Session Authority ---
// Public signup and recovery commit their bounded email work to PostgreSQL.
// Provider configuration controls only the independent outbox worker.
const productionTransactionalEmail = createProductionTransactionalEmail(process.env);
const productionAccountService = new AccountService(undefined, {
  transactionalEmail: productionTransactionalEmail,
});
const productionWorkforceService = new WorkforceService(undefined, {
  transactionalEmail: productionTransactionalEmail,
});
const productionEmailOutboxWorker = new AccountEmailOutboxWorker({
  transactionalEmail: productionTransactionalEmail,
});
const productionSupportCaseOutboxWorker = new SupportCaseOutboxWorker({
  transactionalEmail: productionTransactionalEmail,
  supportRecipient: config.support.recipient,
});
const productionDemoHousekeepingWorker = new DemoCommandCenterHousekeepingWorker();
const productionHomepageDemoAdmissionHousekeepingWorker = new HomepageDemoAdmissionHousekeepingWorker();
const productionPolarisRuntime = createProductionOpenAIRuntime(process.env);
const productionPolarisUsageLedger = createProviderUsageLedger({
  poolProvider: function () { return db.getPool(); },
});
app.locals.workforceService = productionWorkforceService;
app.locals.assetCatalogueService = new AssetCatalogueService();
app.use('/api/auth', createAuthRouter({
  service: productionAccountService,
}));
app.use('/api/account/map-preferences', createMapPreferencesRouter());
app.use('/api/account', accountRoutes);
app.use('/api/workforce', createWorkforceRouter());
// The normalized catalogue owns only /api/assets. It must precede the broad
// legacy retirement router; /api/v1/assets remains retired.
app.use('/api/assets', createAssetCatalogueRouter());

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
app.use('/api/v1/command-center', createCommandCenterRouter());
app.use('/api/v1/today', createTodayRouter());
app.use('/api/v1', simulationsRoutes);
app.use('/api/v1/canonical', createCanonicalRouter({
  assistantRuntime: productionPolarisRuntime,
  assistantUsageLedger: productionPolarisUsageLedger,
}));
// Canonical compatibility routes precede legacy dashboard/public routers so
// supported reads cannot be shadowed by unscoped file-era handlers.
app.use('/api/v1', createCompatibilityRouter());
// Specific downstream routers precede the broad dashboard router. This keeps
// its router-wide authentication from touching paths it does not own.
app.use('/api/v1/business-profile', businessProfileRoutes);
app.use('/api/v1/knowledge-management', createKnowledgeManagementRouter());
app.use('/api/v1/voice', voiceRoutes);
app.use('/api/v1/integrations', createIntegrationStatusRouter());
app.use('/api/v1/support', createSupportRouter());
app.use('/api/v1/field-executions', createFieldExecutionsRouter());
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
  productionEmailOutboxWorker.start();
  productionSupportCaseOutboxWorker.start();
  productionDemoHousekeepingWorker.start();
  productionHomepageDemoAdmissionHousekeepingWorker.start();


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
    console.log(`  POST ${baseUrl}/api/auth/signup          → Queues durable verification delivery`);
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
    productionEmailOutboxWorker.stop();
    productionSupportCaseOutboxWorker.stop();
    productionDemoHousekeepingWorker.stop();
    productionHomepageDemoAdmissionHousekeepingWorker.stop();
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
