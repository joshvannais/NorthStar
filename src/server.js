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
const bcrypt = require('bcryptjs');
const config = require('./config');
const apiRoutes = require('./routes/api');
const dashboardRoutes = require('./routes/dashboard');
const publicApiRoutes = require('./routes/publicApi');
const polarisRoutes = require('./routes/polaris');
const db = require('./db');
const cache = require('./cache/client');
const audit = require('./audit/client');
const { addUser, getAllUsers, getUser } = require('./users/store');
const {
  generateToken, generateAdminToken, generateRefreshToken, validateRefreshToken,
  revokeAllUserTokens, generateResetToken, validateResetToken,
  checkRateLimit, recordLoginAttempt, requireAuth, requireAdmin
} = require('./auth/middleware');
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

// Static assets (CSS, JS)
app.use('/css', express.static('public/css'));
app.use('/js', express.static('public/js'));
app.use('/assets', express.static('public/assets'));

// Frontend page routes
const pages = {
  '/': 'public/index.html',
  '/login': 'public/login.html',
  '/signup': 'public/signup.html',
  '/dashboard': 'public/dashboard.html',
  '/dashboard/leads': 'public/dashboard/leads.html',
  '/dashboard/communications': 'public/dashboard/communications.html',
  '/dashboard/calendar': 'public/dashboard/calendar.html',
  '/dashboard/ai-settings': 'public/dashboard/ai-settings.html',
  '/dashboard/business-profile': 'public/dashboard/business-profile.html',
  '/dashboard/my-number': 'public/dashboard/my-number.html',
  '/dashboard/settings': 'public/dashboard/settings.html',
  '/dashboard/integrations': 'public/dashboard/integrations.html',
  '/dashboard/lead': 'public/dashboard/lead.html',
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

// --- Contractor Auth Routes ---

/**
 * POST /api/auth/signup
 * Create a new contractor account with password.
 */
app.post('/api/auth/signup', authRateLimit(), async (req, res) => {
  try {
    const { name, businessName, phone, email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Hash password (bcrypt cost 12 per spec)
    const passwordHash = await bcrypt.hash(password, 12);

    // Save user (file-based with DB fallback)
    const user = addUser({
      name,
      businessName,
      phone,
      email,
      passwordHash,
      planType: 'Trial',
    });

    // Also try PostgreSQL if available
    if (db.isAvailable()) {
      try {
        // Create organization
        const orgResult = await db.query(
          `INSERT INTO organizations (name, owner_name, email, phone)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [businessName || name, name || '', email, phone || '']
        );
        const orgId = orgResult.rows[0].id;

        // Create user with organization reference
        await db.query(
          `INSERT INTO users (id, organization_id, name, email, phone, password_hash, role, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (email) DO NOTHING`,
          [user.id, orgId, name || businessName, email, phone || '', passwordHash, 'owner', 'active']
        );

        // Create trial subscription
        await db.query(
          `INSERT INTO subscriptions (organization_id, plan_type, status)
           VALUES ($1, $2, $3)`,
          [orgId, 'Trial', 'trial']
        );

        // Create default notification preferences
        await db.query(
          `INSERT INTO notification_preferences (organization_id, notification_email, notification_phone)
           VALUES ($1, $2, $3)`,
          [orgId, email, phone || '']
        );
      } catch (dbErr) {
        console.warn('[Auth] DB insert warning:', dbErr.message);
      }
    }

    // Generate JWT
    const token = generateToken(user);

    console.log(`[Auth] New contractor: ${businessName || name} (${email})`);

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        name,
        businessName,
        email,
        phone,
      },
    });
  } catch (err) {
    console.error('[Auth] Signup error:', err.message);
    res.status(500).json({ error: 'Signup failed. Please try again.' });
  }
});

/**
 * POST /api/auth/login
 * Authenticate a contractor with email + password.
 */
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Check PostgreSQL first, then file store
    let user = null;

    if (db.isAvailable()) {
      const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
      if (result.rows.length > 0) {
        const row = result.rows[0];
        const valid = await bcrypt.compare(password, row.password_hash);
        if (valid) {
          user = { id: row.id, name: row.name, businessName: row.business_name, email: row.email, phone: row.phone };
        }
      }
    }

    // Fallback to file store
    if (!user) {
      const allUsers = getAllUsers();
      const found = allUsers.find(u => u.email === email && u.passwordHash);
      if (found) {
        const valid = await bcrypt.compare(password, found.passwordHash);
        if (valid) {
          user = found;
        }
      }
    }

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = generateToken(user);
    const refreshToken = await generateRefreshToken(user.id);

    // Record successful login
    await recordLoginAttempt(req.ip, user.id, true);

    res.json({
      success: true,
      token,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        businessName: user.businessName || user.business_name,
        email: user.email,
        phone: user.phone,
      },
    });
  } catch (err) {
    console.error('[Auth] Login error:', err.message);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

/**
 * POST /api/auth/refresh
 * Exchange a refresh token for a new access + refresh token pair.
 */
app.post('/api/auth/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token required' });
    }

    const userId = await validateRefreshToken(refreshToken);
    if (!userId) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    // Look up user
    let user = null;
    if (db.isAvailable()) {
      const result = await db.query('SELECT id, name, business_name, email, phone FROM users WHERE id = $1', [userId]);
      if (result.rows.length > 0) {
        const r = result.rows[0];
        user = { id: r.id, name: r.name, businessName: r.business_name, email: r.email, phone: r.phone };
      }
    }

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const newToken = generateToken(user);
    const newRefreshToken = await generateRefreshToken(user.id);

    res.json({
      success: true,
      token: newToken,
      refreshToken: newRefreshToken,
    });
  } catch (err) {
    console.error('[Auth] Refresh error:', err.message);
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

/**
 * POST /api/auth/forgot-password
 * Request a password reset email (always returns 200 to prevent email enumeration).
 */
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (email && db.isAvailable()) {
      const result = await db.query('SELECT id, email FROM users WHERE email = $1', [email]);
      if (result.rows.length > 0) {
        const userId = result.rows[0].id;
        const resetToken = await generateResetToken(userId);
        console.log(`[Auth] Password reset requested for ${email} — token: ${resetToken}`);
        // TODO: Send email with reset link
      }
    }
    // Always return 200 to prevent email enumeration
    res.json({ success: true, message: 'If the email exists, a reset link has been sent.' });
  } catch (err) {
    console.error('[Auth] Forgot password error:', err.message);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

/**
 * POST /api/auth/reset-password
 * Reset a password using a valid reset token.
 */
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      return res.status(400).json({ error: 'Token and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const userId = await validateResetToken(token);
    if (!userId) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    if (db.isAvailable()) {
      await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
      // Revoke all refresh tokens for security
      await revokeAllUserTokens(userId);
    }

    console.log(`[Auth] Password reset completed for user ${userId}`);
    res.json({ success: true, message: 'Password has been reset successfully.' });
  } catch (err) {
    console.error('[Auth] Reset password error:', err.message);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

/**
 * GET /api/auth/me
 * Return the currently authenticated user (requires valid token).
 */
app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    let userData = null;

    if (db.isAvailable()) {
      const result = await db.query('SELECT id, name, business_name, email, phone, plan_type, status FROM users WHERE id = $1', [req.user.id]);
      if (result.rows.length > 0) {
        const r = result.rows[0];
        userData = { id: r.id, name: r.name, businessName: r.business_name, email: r.email, phone: r.phone, plan: r.plan_type, status: r.status };
      }
    }

    if (!userData) {
      const found = getUser(req.user.id);
      if (found) {
        userData = { id: found.id, name: found.name, businessName: found.businessName, email: found.email, phone: found.phone, plan: found.planType, status: found.status };
      }
    }

    if (!userData) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: userData });
  } catch (err) {
    console.error('[Auth] Me error:', err.message);
    res.status(500).json({ error: 'Failed to load user data' });
  }
});

// Demo login — allows contractors to test the product without signing up
app.get('/demo-login', (req, res) => {
  const demoToken = generateToken({
    id: 'demo-user',
    name: 'Demo Contractor',
    businessName: 'Your Company',
    email: 'demo@northstarsolutions.app',
    phone: '(555) 000-0000',
  });

  res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Demo Access — NorthStar AI</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/style.css">
</head>
<body style="display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;overflow-x:hidden;">
  <div style="text-align:center;max-width:400px;animation:fadeIn 0.5s ease-out;">
<img src="/assets/logo.png" alt="NorthStar" style="width:96px;height:96px;object-fit:contain;margin:0 auto 16px;display:block;">
    <h1 style="font-size:22px;font-weight:700;margin-bottom:4px;">Try NorthStar AI</h1>
    <p style="color:var(--neutral-500);font-size:14px;margin-bottom:24px;">Loading your demo dashboard...</p>
    <div style="width:40px;height:40px;border:3px solid var(--neutral-200);border-top-color:var(--brand-600);border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto;"></div>
  </div>
  <style>
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes fadeIn { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
  </style>
  <script>
    localStorage.setItem('token', '${demoToken}');
    localStorage.setItem('user', JSON.stringify({
      name: 'Demo Contractor',
      businessName: 'Your Company',
      email: 'demo@northstarsolutions.app',
      phone: '(555) 000-0000',
    }));
    setTimeout(() => { window.location.href = '/dashboard'; }, 1200);
  </script>
</body>
</html>
  `);
});

// --- Admin Routes ---

/**
 * POST /api/admin/login
 * Admin authentication with username + password.
 */
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  const adminUser = process.env.ADMIN_USERNAME || 'admin';
  const adminPass = process.env.ADMIN_PASSWORD || 'northstar2024';

  if (username === adminUser && password === adminPass) {
    const token = generateAdminToken();
    res.json({ success: true, token });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

/**
 * GET /api/admin/users
 * List all contractors (admin only).
 */
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    let users = [];

    if (db.isAvailable()) {
      const result = await db.query(
        'SELECT id, name, business_name, email, phone, plan_type, status, signup_date, payment_status FROM users ORDER BY signup_date DESC'
      );
      users = result.rows.map(r => ({
        id: r.id,
        name: r.name,
        businessName: r.business_name,
        email: r.email,
        phone: r.phone,
        planType: r.plan_type,
        status: r.status,
        signupDate: r.signup_date,
        paymentStatus: r.payment_status,
      }));
    } else {
      users = getAllUsers().map(u => ({
        id: u.id,
        name: u.name,
        businessName: u.businessName,
        email: u.email,
        phone: u.phone,
        planType: u.planType,
        status: u.status,
        signupDate: u.signupDate,
        paymentStatus: u.paymentStatus,
      }));
    }

    res.json({ users, count: users.length });
  } catch (err) {
    console.error('[Admin] Users error:', err.message);
    res.status(500).json({ error: 'Failed to load users' });
  }
});

// API routes
app.use('/api', apiRoutes);
app.use('/api/v1', dashboardRoutes);
app.use('/api/v1', publicApiRoutes);
app.use('/api/v1/polaris', polarisRoutes);

// 404 + error handler (single instances)
app.use(notFound);
app.use(errorHandler);

// Start server
async function start() {
  // Initialize database, cache, and audit logging
  await db.initDatabase();
  await cache.init();
  await audit.ensureTable();

  // Initialize Polaris Intelligence Engine
  const polaris = require('./polaris/engine');
  polaris.init();
  // Initialize Polaris Customer Lifecycle Engine
  const customerEngine = require('./polaris/customer-engine');
  customerEngine.init();

  const server = app.listen(PORT, () => {
    const baseUrl = `http://localhost:${PORT}`;
    console.log(`
╔══════════════════════════════════════════════╗
║      Northstar Solutions — Platform v1.0     ║
╠══════════════════════════════════════════════╣
║  🌐  ${baseUrl.padEnd(38)}║
║  🔐  Auth:        ${'JWT + bcrypt'.padEnd(31)}║
║  🗄️  Database:    ${(db.isAvailable() ? '✓ PostgreSQL'.padEnd(31) : '○ File-based'.padEnd(31))}║
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
    console.log(`  POST ${baseUrl}/api/auth/signup          → Create account`);
    console.log(`  POST ${baseUrl}/api/auth/login           → Sign in`);
    console.log(`  POST ${baseUrl}/api/auth/refresh         → Refresh token`);
    console.log(`  POST ${baseUrl}/api/auth/forgot-password → Request reset`);
    console.log(`  POST ${baseUrl}/api/auth/reset-password  → Reset password`);
    console.log(`  GET  ${baseUrl}/api/auth/me              → Current user`);
    console.log(`  POST ${baseUrl}/api/admin/login          → Admin sign in`);
    console.log(`  GET  ${baseUrl}/api/admin/users          → All contractors`);
    console.log('');
  });
}

start().catch(err => {
  console.error('[Server] Failed to start:', err);
});