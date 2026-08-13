/**
 * Audit Logging Middleware
 * 
 * Emits structured request telemetry with correlation IDs. Security-relevant
 * writes and authenticated errors retain the existing audit detail; anonymous
 * API 404s use a fixed-cardinality aggregate with no request identifiers.
 */

const { v4: uuidv4 } = require('uuid');
const audit = require('../audit/client');
const safeLogger = require('../observability/safeLogger');

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

function isAnonymousNotFound(req, status) {
  return status === 404 && !req.admin && !req.user && !req.tenantContext?.userId;
}

/**
 * Middleware: log API requests for audit trail.
 */
function auditLogger(req, res, next) {
  // Skip logging for non-API routes
  const lowerPath = req.path.toLowerCase();
  if (!(lowerPath === '/api' || lowerPath.startsWith('/api/'))) return next();

  const start = Date.now();

  // Log on response finish
  res.on('finish', () => {
    const duration = Date.now() - start;
    safeLogger.info('http', 'request_completed', {
      requestId: req.requestId,
      methodClass: req.method,
      statusCode: res.statusCode,
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
    const anonymousNotFound = !signedWebhookPost && isAnonymousNotFound(req, res.statusCode);

    if (anonymousNotFound) {
      audit.recordAnonymousNotFound({ method: req.method }).catch(() => {
        safeLogger.warn('audit', 'anonymous_not_found_aggregation_failed', {
          requestId: 'unavailable',
        });
      });
      return;
    }

    // Both exact signed webhook POSTs own their accepted audit row inside the
    // canonical/replay transaction. Generic finish-time logging would be a
    // second, non-atomic write; rejected deliveries remain zero-write.
    if ((isModifying || isError) && !sourceDisabledSignup && !signedWebhookPost) {
      audit.record(requestAuditEntry(req, res.statusCode, duration)).catch(() => {
        safeLogger.warn('audit', 'audit_persistence_failed', {
          requestId: req.requestId,
        });
      });
    }
  });

  next();
}

module.exports = { auditLogger, correlationId, isAnonymousNotFound, isSignedWebhookPost, requestAuditEntry };
