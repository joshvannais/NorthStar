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

    if (isModifying || isError) {
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
