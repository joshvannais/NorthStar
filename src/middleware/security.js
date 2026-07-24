/**
 * CORS & Security Headers Middleware
 * V3-27: Security architecture — CORS restrictions, Helmet-like security headers.
 */

/**
 * CSP directives for the application.
 */
function getCspDirectives() {
  return {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
    styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    fontSrc: ["'self'", "https://fonts.gstatic.com"],
    imgSrc: ["'self'", "data:", "https:"],
    connectSrc: ["'self'", "https://api.retellai.com", "https://api.getjobber.com"],
    frameSrc: ["'none'"],
    objectSrc: ["'none'"]
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
    .map(([key, values]) => {
      const directive = key.replace(/[A-Z]/g, function (character) {
        return '-' + character.toLowerCase();
      });
      return `${directive} ${values.join(' ')}`;
    })
    .join('; ');
  res.setHeader('Content-Security-Policy', cspString);

  // Other security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

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
