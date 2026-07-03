/**
 * Auth middleware for Northstar Solutions.
 * Handles JWT token verification and protected routes.
 */

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'northstar-dev-secret-change-in-production';

/**
 * Generate a JWT token for a user.
 */
function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      name: user.name || user.businessName,
      role: 'contractor',
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

/**
 * Generate a JWT token for the admin.
 */
function generateAdminToken() {
  return jwt.sign(
    { id: 'admin', role: 'admin' },
    JWT_SECRET,
    { expiresIn: '2h' }
  );
}

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
  requireAuth,
  requireAdmin,
  JWT_SECRET,
};