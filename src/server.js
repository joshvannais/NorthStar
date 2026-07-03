/**
 * Northstar Solutions — AI Receptionist Platform
 * 
 * Full-stack application with:
 * - Marketing site & contractor dashboard
 * - Real contractor auth (passwords + JWT)
 * - AI receptionist pipeline (Retell AI webhooks)
 * - Lead capture, notifications, sheets sync
 * - Calendar scheduling
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const config = require('./config');
const apiRoutes = require('./routes/api');
const db = require('./db');
const { addUser, getAllUsers, getUser } = require('./users/store');
const { generateToken, generateAdminToken, requireAuth, requireAdmin } = require('./auth/middleware');

const app = express();
const PORT = config.port || 3000;

// Middleware
app.use(cors());
app.use(express.json());

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
  '/dashboard/calls': 'public/dashboard/calls.html',
  '/dashboard/my-number': 'public/dashboard/my-number.html',
  '/dashboard/settings': 'public/dashboard/settings.html',
  '/contact': 'public/contact.html',
  '/admin': 'public/admin.html',
};

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
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { name, businessName, phone, email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Save user (file-based with DB fallback)
    const user = addUser({
      name,
      businessName,
      phone,
      email,
      passwordHash, // Store hash in our JSON user model
      planType: 'Trial',
    });

    // Also try PostgreSQL if available
    if (db.isAvailable()) {
      try {
        await db.query(
          `INSERT INTO users (id, name, business_name, email, phone, password_hash, plan_type, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (email) DO NOTHING`,
          [user.id, name || businessName, businessName || '', email, phone || '', passwordHash, 'Trial', 'trial']
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

    res.json({
      success: true,
      token,
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

// Demo login — quick access for testing (kept for convenience)
app.get('/demo-login', (req, res) => {
  res.redirect('/login');
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

// Error handler
app.use((err, req, res, next) => {
  console.error('[Server] Error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
async function start() {
  // Try to initialize database
  await db.initDatabase();

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
    console.log(`  ${baseUrl}/admin           → Admin panel`);
    console.log('');
    console.log('📍 Auth API:');
    console.log(`  POST ${baseUrl}/api/auth/signup   → Create account`);
    console.log(`  POST ${baseUrl}/api/auth/login    → Sign in`);
    console.log(`  GET  ${baseUrl}/api/auth/me       → Current user`);
    console.log(`  POST ${baseUrl}/api/admin/login   → Admin sign in`);
    console.log(`  GET  ${baseUrl}/api/admin/users   → All contractors`);
    console.log('');
  });
}

start().catch(err => {
  console.error('[Server] Failed to start:', err);
});