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

function exactRequestPath(req) {
  return String(req.originalUrl || req.url || '').split('?')[0];
}

function isSignedWebhookPost(req) {
  const requestPath = exactRequestPath(req);
  return req.method === 'POST' && (
    requestPath === '/api/retell/webhook' || requestPath === '/api/v1/voice/webhook'
  );
}

function requestAuditEntry(req, status, duration) {
  const path = String(req.path || exactRequestPath(req));
  const entityType = path.split('/').filter(Boolean)[1] || 'unknown';
  return {
    organizationId: req.tenantContext?.organizationId || null,
    userId: req.tenantContext?.userId || null,
    actorLabel: req.admin ? 'admin' : (req.user ? 'authenticated' : 'anonymous'),
    actorRole: req.admin ? 'admin' : (req.userRole || 'anonymous'),
    action: `${req.method} ${status}`,
    entityType,
    entityId: req.params?.id || null,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'] || null,
    correlationId: req.requestId,
    afterState: { method: req.method, path, status, duration }
  };
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
    const signedWebhookPost = isSignedWebhookPost(req);

    // Both exact signed webhook POSTs own their accepted audit row inside the
    // canonical/replay transaction. Generic finish-time logging would be a
    // second, non-atomic write; rejected deliveries remain zero-write.
    if ((isModifying || isError) && !sourceDisabledSignup && !signedWebhookPost) {
      audit.record(requestAuditEntry(req, res.statusCode, duration)).catch(() => console.warn('[Audit] Persistence warning:', {
        requestId: req.requestId,
        event: 'audit_persistence_failed',
      }));
    }
  });

  next();
}

module.exports = { auditLogger, correlationId, isSignedWebhookPost, requestAuditEntry };
