/**
 * Northstar Solutions — AI Office Manager Platform
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const config = require('./config');
const apiRoutes = require('./routes/api');
const dashboardRoutes = require('./routes/dashboard');
const publicApiRoutes = require('./routes/publicApi');
const db = require('./db');
const cache = require('./cache/client');
const audit = require('./audit/client');
const { addUser, getAllUsers, getUser } = require('./users/store');
const { generateToken, generateAdminToken, requireAuth, requireAdmin } = require('./auth/middleware');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const { rateLimit, authRateLimit, trackFailedAttempt } = require('./middleware/rateLimit');
const { securityHeaders, corsOptions } = require('./middleware/security');
const { correlationId, auditLogger } = require('./middleware/auditLog');

const app = express();
const PORT = config.port || 3000;

// Middleware
app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));
app.use(securityHeaders);
app.use(correlationId);
app.use(auditLogger);

// Static assets
app.use('/css', express.static('public/css'));
app.use('/js', express.static('public/js'));
app.use('/assets', express.static('public/assets'));

// Frontend page routes
const pages = {
  '/': 'public/index.html',
  '/dashboard': 'public/dashboard.html',
  '/dashboard/leads': 'public/dashboard/leads.html',
  '/dashboard/calls': 'public/dashboard/calls.html',
  '/dashboard/my-number': 'public/dashboard/my-number.html',
  '/dashboard/settings': 'public/dashboard/settings.html',
  '/dashboard/integrations': 'public/dashboard/integrations.html',
};
Object.entries(pages).forEach(([route, file]) => {
  app.get(route, (req, res) => res.sendFile(path.join(__dirname, file)));
});

// API routes
app.use('/api', apiRoutes);
app.use('/api/v1', dashboardRoutes);
app.use('/api/v1', publicApiRoutes);

// 404 + error handler
app.use(notFound);
app.use(errorHandler);

// Start server
async function start() {
  await db.initDatabase();
  await cache.init();
  await audit.ensureTable();

  const server = app.listen(PORT, () => {
    const baseUrl = `http://localhost:${PORT}`;
    console.log(`Northstar Solutions — ${baseUrl}`);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => { server.close(); process.exit(0); });
  process.on('SIGINT', () => { server.close(); process.exit(0); });
}

start().catch(err => { console.error('[Server] Fatal:', err); process.exit(1); });