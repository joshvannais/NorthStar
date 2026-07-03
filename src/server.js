/**
 * Northstar Solutions — AI Receptionist Platform
 * 
 * Full-stack application with:
 * - Marketing site & contractor dashboard
 * - AI receptionist pipeline (Retell AI webhooks)
 * - Lead capture, notifications, sheets sync
 * - Calendar scheduling
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const apiRoutes = require('./routes/api');

const app = express();

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

// Demo login — auto-authenticates as admin/owner
app.get('/demo-login', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Demo Login — NorthStar AI</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/style.css">
</head>
<body style="display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;overflow-x:hidden;">
  <div style="text-align:center;max-width:400px;animation:fadeIn 0.5s ease-out;">
    <svg viewBox="0 0 24 24" fill="none" stroke="var(--brand-600)" stroke-width="2" style="width:48px;height:48px;margin:0 auto 16px;">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
    </svg>
    <h1 style="font-size:22px;font-weight:700;margin-bottom:4px;">Owner Demo Access</h1>
    <p style="color:var(--neutral-500);font-size:14px;margin-bottom:24px;">Logging you in as platform admin...</p>
    <div style="width:40px;height:40px;border:3px solid var(--neutral-200);border-top-color:var(--brand-600);border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto;"></div>
  </div>
  <style>
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes fadeIn { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
  </style>
  <script>
    const user = {
      name: 'Platform Owner',
      businessName: 'NorthStar Solutions (Demo)',
      email: 'owner@northstar-ai.com',
      phone: '(555) 000-0000',
      role: 'admin'
    };
    localStorage.setItem('token', 'demo-token-' + Date.now());
    localStorage.setItem('user', JSON.stringify(user));
    setTimeout(() => { window.location.href = '/dashboard'; }, 1200);
  </script>
</body>
</html>
  `);
});

// User storage
const { addUser, getAllUsers } = require('./users/store');

// Auth routes
app.post('/api/auth/signup', (req, res) => {
  const { name, businessName, phone, email } = req.body;
  const user = addUser({ name, businessName, phone, email });
  console.log(`[Auth] New signup: ${businessName || name} (${email})`);
  res.json({
    success: true,
    token: 'demo-token-' + Date.now(),
    user: { name, businessName, phone, email, id: user.id },
  });
});

app.post('/api/auth/login', (req, res) => {
  const { email } = req.body;
  res.json({
    success: true,
    token: 'demo-token-' + Date.now(),
    user: { name: 'Demo Contractor', businessName: 'Your Company', email },
  });
});

// --- Admin Routes ---

// Admin login
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  const adminUser = process.env.ADMIN_USERNAME || 'admin';
  const adminPass = process.env.ADMIN_PASSWORD || 'northstar2024';

  if (username === adminUser && password === adminPass) {
    const token = 'admin-token-' + Date.now();
    res.json({ success: true, token });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

// Admin: get all users
app.get('/api/admin/users', (req, res) => {
  const authHeader = req.headers.authorization;
  const adminPass = process.env.ADMIN_PASSWORD || 'northstar2024';

  if (!authHeader || !authHeader.startsWith('Bearer admin-token-')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const users = getAllUsers();
  res.json({ users, count: users.length });
});

// API routes
app.use('/api', apiRoutes);

// Error handler
app.use((err, req, res, next) => {
  console.error('[Server] Error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// Start
const server = app.listen(config.port, () => {
  const baseUrl = `http://localhost:${config.port}`;
  console.log(`
╔══════════════════════════════════════════════╗
║      Northstar Solutions — Platform v1.0     ║
╠══════════════════════════════════════════════╣
║  🌐  ${baseUrl.padEnd(38)}║
║  📞  Retell AI:   ${config.retell.apiKey ? '✓ Ready'.padEnd(31) : '○ Needs API Key'.padEnd(31)}║
║  📱  Twilio SMS:  ${config.twilio.accountSid ? '✓ Ready'.padEnd(31) : '○ Needs API Key'.padEnd(31)}║
║  📊  Google Sheets: ${config.sheets.clientEmail ? '✓ Ready'.padEnd(31) : '○ Needs API Key'.padEnd(31)}║
║  📧  SMTP Email:  ${config.smtp.user ? '✓ Ready'.padEnd(31) : '○ Needs API Key'.padEnd(31)}║
╚══════════════════════════════════════════════╝
  `);

  console.log('📍 Pages:');
  console.log(`  ${baseUrl}/               → Landing page`);
  console.log(`  ${baseUrl}/login           → Sign in`);
  console.log(`  ${baseUrl}/signup          → Sign up (14-day free trial)`);
  console.log(`  ${baseUrl}/dashboard       → Contractor dashboard`);
  console.log(`  ${baseUrl}/dashboard/leads → All leads`);
  console.log(`  ${baseUrl}/dashboard/settings → Settings`);
  console.log('');
  console.log('📍 API:');
  console.log(`  GET  ${baseUrl}/api/health`);
  console.log(`  GET  ${baseUrl}/api/leads`);
  console.log(`  POST ${baseUrl}/api/leads/simulate`);
  console.log(`  POST ${baseUrl}/api/auth/signup`);
  console.log(`  POST ${baseUrl}/api/auth/login`);
  console.log(`  POST ${baseUrl}/api/retell/webhook`);
  console.log('');
});