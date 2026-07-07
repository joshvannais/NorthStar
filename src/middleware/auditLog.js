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
  req.correlationId = req.headers['x-correlation-id'] || uuidv4();
  res.setHeader('X-Correlation-ID', req.correlationId);
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

    // Only log data-modifying operations and errors
    const isModifying = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
    const isError = res.statusCode >= 400;

    if (isModifying || isError) {
      const entityType = req.path.split('/').filter(Boolean)[1] || 'unknown';

      audit.record({
        actorId: req.user?.id || req.admin?.id || 'anonymous',
        actorRole: req.admin ? 'admin' : (req.user?.role || 'anonymous'),
        action: `${req.method} ${res.statusCode}`,
        entityType,
        entityId: req.params?.id || null,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'] || null,
        correlationId: req.correlationId,
        afterState: { method: req.method, path: req.path, status: res.statusCode, duration }
      }).catch(err => console.warn('[Audit] Log error:', err.message));
    }
  });

  next();
}

module.exports = { correlationId, auditLogger };