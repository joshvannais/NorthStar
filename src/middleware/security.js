/**
 * CORS & Security Headers Middleware
 * V3-27: Security architecture — CORS restrictions, Helmet-like security headers.
 */

/**
 * CSP directives for the application.
 */
function getCspDirectives() {
  return {
    'default-src': ["'self'"],
    'script-src': ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
    'style-src': ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    'font-src': ["'self'", "https://fonts.gstatic.com"],
    'img-src': ["'self'", "data:", "https:"],
    // Mounted Jobber OAuth remains source-disabled until canonical token
    // persistence exists, so browsers have no Jobber connection destination.
    'connect-src': ["'self'", "https://*.livekit.cloud", "wss://*.livekit.cloud"],
    'frame-src': ["'none'"],
    'object-src': ["'none'"]
  };
}

/**
 * Apply security headers to every response.
 */
function securityHeaders(req, res, next) {
  // Strict Transport Security
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  // Content Security Policy
  const csp = getCspDirectives();
  const cspString = Object.entries(csp)
    .map(([key, values]) => `${key} ${values.join(' ')}`)
    .join('; ');
  res.setHeader('Content-Security-Policy', cspString);

  // Other security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()');

  // Cache control for API responses
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  }

  next();
}

/**
 * CORS configuration — restricted to NorthStar dashboard origins.
 */
function corsOptions(req, callback) {
  const allowedOrigins = [
    'https://northstarsolutions.app',
    'https://www.northstarsolutions.app',
    'https://northstarsolutions.ctonew.app',
    'http://localhost:3000',
    'http://localhost:5173'
  ];

  const origin = req.header('Origin');
  let corsEnabled = false;

  if (!origin || allowedOrigins.includes(origin)) {
    corsEnabled = true;
  }

  callback(null, {
    origin: corsEnabled,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Correlation-ID'],
    exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
    maxAge: 86400
  });
}

module.exports = { securityHeaders, corsOptions };
