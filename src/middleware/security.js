/**
 * CORS & Security Headers Middleware
 * V3-27: Security architecture — CORS restrictions, Helmet-like security headers.
 */

const { CORS_METHODS: PAYMENT_CASH_CORS_METHODS,
  isPaymentCashReadPath } =
  require('../customerFinancial/paymentCashReportingHttpBoundary');
const { CORS_METHODS: DOWNSTREAM_READERS_CORS_METHODS,
  isDownstreamReadersPath } =
  require('../customerFinancial/downstreamReportingReadersHttpBoundary');
const { CORS_METHODS: PART12_ACCEPTANCE_CORS_METHODS,
  isReportingPart12AcceptancePath } =
  require('../customerFinancial/reportingPart12AcceptanceHttpBoundary');

/**
 * CSP directives for the application.
 */
function getCspDirectives() {
  return {
    'default-src': ["'self'"],
    'script-src': ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
    'style-src': ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    'font-src': ["'self'", 'data:', "https://fonts.gstatic.com"],
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

  const paymentCashRead = isPaymentCashReadPath(req.path);
  const downstreamReadersRead = isDownstreamReadersPath(req.path);
  const part12AcceptanceRead = isReportingPart12AcceptancePath(req.path);
  const exactCustomerFinancialRead = [
    '/api/v1/customer-financial/receivables',
    '/api/v1/customer-financial/receivables/',
    '/api/v1/customer-financial/collection-review',
    '/api/v1/customer-financial/collection-review/',
    '/api/v1/customer-financial/collection-handoff',
    '/api/v1/customer-financial/collection-handoff/',
    '/api/v1/customer-financial/reporting/invoice-receivables',
    '/api/v1/customer-financial/reporting/invoice-receivables/',
  ].includes(req.path) || paymentCashRead || downstreamReadersRead || part12AcceptanceRead ||
    /^\/api\/v1\/customer-financial\/editable-estimates\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/accounting-(?:(?:export|reconciliation)-readiness|part11-acceptance)\/?$/i
      .test(req.path);

  callback(null, {
    origin: corsEnabled,
    credentials: true,
    methods: paymentCashRead ? [...PAYMENT_CASH_CORS_METHODS] :
      downstreamReadersRead ? [...DOWNSTREAM_READERS_CORS_METHODS] :
      part12AcceptanceRead ? [...PART12_ACCEPTANCE_CORS_METHODS] :
      exactCustomerFinancialRead ? ['GET'] :
      ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    preflightContinue: exactCustomerFinancialRead,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Correlation-ID'],
    exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
    maxAge: 86400
  });
}

module.exports = { securityHeaders, corsOptions };
