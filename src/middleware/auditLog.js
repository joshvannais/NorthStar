/**
 * Audit Logging Middleware
 * 
 * Logs all API requests with correlation IDs. Captures actor, action, entity,
 * IP, user agent for every request. Generates correlation IDs for tracing.
 */

const { v4: uuidv4 } = require('uuid');
const audit = require('../audit/client');

/**
 * Middleware: attach a correlation ID to every request.
 */
function correlationId(req, res, next) {
  const generated = uuidv4();
  Object.defineProperties(req, {
    requestId: { value: generated, enumerable: true, configurable: false, writable: false },
    correlationId: { value: generated, enumerable: true, configurable: false, writable: false },
  });
  res.setHeader('X-Correlation-ID', generated);
  res.setHeader('X-Request-ID', generated);
  next();
}

/**
 * Middleware: log API requests for audit trail.
 */
function auditLogger(req, res, next) {
  // Skip logging for non-API routes
  if (!req.path.startsWith('/api/')) return next();

  const start = Date.now();

  // Log on response finish
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.info('[Request]', {
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: duration,
    });

    // Only log data-modifying operations and errors
    const isModifying = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
    const isError = res.statusCode >= 400;
    // PR A's source-disabled public signup endpoint is a strict zero-write
    // capability boundary. Its stable denial is logged above, but must not
    // create even an anonymous audit row that could overstate signup activity.
    const sourceDisabledSignup = req.method === 'POST' &&
      String(req.originalUrl || req.url || '').split('?')[0] === '/api/auth/signup' &&
      res.statusCode === 503;
    const requestPath = String(req.originalUrl || req.url || '').split('?')[0];
    const rejectedSignedWebhook = req.method === 'POST' && res.statusCode >= 400 && (
      requestPath === '/api/retell/webhook' || requestPath === '/api/v1/voice/webhook'
    );

    // Rejected signed webhooks are a zero-database-write boundary. Valid,
    // accepted deliveries retain the normal durable audit record.
    if ((isModifying || isError) && !sourceDisabledSignup && !rejectedSignedWebhook) {
      const entityType = req.path.split('/').filter(Boolean)[1] || 'unknown';

      audit.record({
        organizationId: req.tenantContext?.organizationId || null,
        userId: req.tenantContext?.userId || null,
        actorLabel: req.admin ? 'admin' : (req.user ? 'authenticated' : 'anonymous'),
        actorRole: req.admin ? 'admin' : (req.userRole || 'anonymous'),
        action: `${req.method} ${res.statusCode}`,
        entityType,
        entityId: req.params?.id || null,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'] || null,
        correlationId: req.requestId,
        afterState: { method: req.method, path: req.path, status: res.statusCode, duration }
      }).catch(() => console.warn('[Audit] Persistence warning:', {
        requestId: req.requestId,
        event: 'audit_persistence_failed',
      }));
    }
  });

  next();
}

module.exports = { correlationId, auditLogger };
