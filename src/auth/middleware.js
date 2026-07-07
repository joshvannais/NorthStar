/**
 * Auth middleware for Northstar Solutions.
 * Handles JWT token verification, refresh tokens, and protected routes.
 * Implements V3-01 Authentication System specification.
 *
 * Tokens:
 * - Access tokens: short-lived (24h contractor, 30m admin)
 * - Refresh tokens: long-lived, one-way hashed in DB, rotate on use
 * - Password reset tokens: one-way hashed, 1-hour expiry
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'northstar-dev-secret-change-in-production';
const ACCESS_TOKEN_EXPIRY = '24h';
const ADMIN_TOKEN_EXPIRY = '30m';
const REFRESH_TOKEN_EXPIRY_DAYS = 30;
const RESET_TOKEN_EXPIRY_HOURS = 1;

/**
 * Hash a token for database storage (SHA-256).
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Generate a random token string.
 */
function randomToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Generate a JWT access token for a contractor user.
 */
function generateToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      name: user.name || user.businessName || '',
      role: 'contractor',
      iat: Math.floor(Date.now() / 1000),
    },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRY }
  );
}

/**
 * Generate a JWT token for the admin.
 */
function generateAdminToken() {
  return jwt.sign(
    { sub: 'admin', role: 'admin', iat: Math.floor(Date.now() / 1000) },
    JWT_SECRET,
    { expiresIn: ADMIN_TOKEN_EXPIRY }
  );
}

/**
 * Generate a refresh token, store its hash in the database.
 * Returns the raw token (to give to the client).
 */
async function generateRefreshToken(userId) {
  const raw = randomToken();
  const hash = hashToken(raw);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  if (db.isAvailable()) {
    await db.query(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [userId, hash, expiresAt]
    );
  }

  return raw;
}

/**
 * Validate a refresh token. Returns the user_id if valid, null otherwise.
 * If valid, revokes the used token (rotation).
 */
async function validateRefreshToken(rawToken) {
  if (!db.isAvailable()) return null;

  const hash = hashToken(rawToken);
  const result = await db.query(
    `SELECT id, user_id FROM refresh_tokens
     WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
    [hash]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];

  // Revoke the used token (rotation)
  await db.query(
    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1',
    [row.id]
  );

  return row.user_id;
}

/**
 * Revoke all refresh tokens for a user (force logout all sessions).
 */
async function revokeAllUserTokens(userId) {
  if (!db.isAvailable()) return;
  await db.query(
    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
    [userId]
  );
}

/**
 * Generate a password reset token, store its hash.
 * Returns the raw token (to email to the user).
 */
async function generateResetToken(userId) {
  const raw = randomToken();
  const hash = hashToken(raw);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

  if (db.isAvailable()) {
    await db.query(
      'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [userId, hash, expiresAt]
    );
  }

  return raw;
}

/**
 * Validate a password reset token. Returns the user_id if valid, null otherwise.
 */
async function validateResetToken(rawToken) {
  if (!db.isAvailable()) return null;

  const hash = hashToken(rawToken);
  const result = await db.query(
    `SELECT id, user_id FROM password_reset_tokens
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()`,
    [hash]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];

  // Mark as used
  await db.query(
    'UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1',
    [row.id]
  );

  return row.user_id;
}

/**
 * Check login rate limit: max 5 failed attempts per IP per 15 minutes.
 */
async function checkRateLimit(ip) {
  if (!db.isAvailable()) return true; // Allow if no DB

  const result = await db.query(
    `SELECT COUNT(*) as count FROM login_attempts
     WHERE ip_address = $1 AND success = false AND attempted_at > NOW() - INTERVAL '15 minutes'`,
    [ip]
  );

  return parseInt(result.rows[0].count, 10) < 5;
}

/**
 * Record a login attempt.
 */
async function recordLoginAttempt(ip, userId, success) {
  if (!db.isAvailable()) return;

  await db.query(
    'INSERT INTO login_attempts (ip_address, user_id, success) VALUES ($1, $2, $3)',
    [ip, userId, success]
  );

  // Cleanup old records (>24h)
  await db.query(
    'DELETE FROM login_attempts WHERE attempted_at < NOW() - INTERVAL \'24 hours\''
  );
}

// ============================================================
// Express Middleware
// ============================================================

/**
 * Middleware: require a valid contractor JWT.
 * Attaches user info to req.user.
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'contractor') {
      return res.status(403).json({ error: 'Invalid user token' });
    }
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Middleware: require admin JWT.
 */
function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Admin authentication required' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = {
  generateToken,
  generateAdminToken,
  generateRefreshToken,
  validateRefreshToken,
  revokeAllUserTokens,
  generateResetToken,
  validateResetToken,
  checkRateLimit,
  recordLoginAttempt,
  requireAuth,
  requireAdmin,
  JWT_SECRET,
};