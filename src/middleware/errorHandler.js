'use strict';

const PUBLIC_ERRORS = Object.freeze({
  invalid_cursor: { status: 400, message: 'Invalid pagination cursor.' },
  bad_request: { status: 400, message: 'Invalid request.' },
  payload_too_large: { status: 413, message: 'The request body is too large.' },
  unsupported_media_type: { status: 415, message: 'The request encoding is not supported.' },
  validation_error: { status: 422, message: 'Invalid request data.' },
  unauthorized: { status: 401, message: 'Authentication required.' },
  invalid_token: { status: 401, message: 'Invalid or expired token.' },
  organization_membership_required: { status: 403, message: 'Active organization membership is required.' },
  authorization_unavailable: { status: 503, message: 'Authorization is temporarily unavailable.' },
  forbidden: { status: 403, message: 'You do not have permission to perform this action.' },
  not_found: { status: 404, message: 'Record not found.' },
  rate_limited: { status: 429, message: 'Too many requests. Please try again later.' },
  idempotency_conflict: { status: 409, message: 'The idempotency key was already used with a different request.' },
  conflict: { status: 409, message: 'The request conflicts with the current resource state.' },
  persistence_unavailable: { status: 503, message: 'Required persistence is temporarily unavailable.' },
  service_unavailable: { status: 503, message: 'The requested service is temporarily unavailable.' },
  provider_error: { status: 502, message: 'The upstream provider is temporarily unavailable.' },
  configuration_error: { status: 503, message: 'The requested service is temporarily unavailable.' },
  ai_service_error: { status: 502, message: 'The requested service could not complete the request.' },
  timeout: { status: 504, message: 'The request timed out. Please try again.' },
  simulation_failed: { status: 500, message: 'The simulation could not be persisted.' },
  internal_error: { status: 500, message: 'An unexpected error occurred. Please try again.' }
});

function normalizeCode(code) {
  const normalized = String(code || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(PUBLIC_ERRORS, normalized) ? normalized : 'internal_error';
}

function codeForStatus(statusCode) {
  return statusCode === 400 ? 'bad_request'
    : statusCode === 401 ? 'unauthorized'
    : statusCode === 403 ? 'forbidden'
    : statusCode === 404 ? 'not_found'
    : statusCode === 409 ? 'conflict'
    : statusCode === 413 ? 'payload_too_large'
    : statusCode === 415 ? 'unsupported_media_type'
    : statusCode === 422 ? 'validation_error'
    : statusCode === 429 ? 'rate_limited'
    : statusCode === 502 ? 'provider_error'
    : statusCode === 503 ? 'service_unavailable'
    : statusCode === 504 ? 'timeout'
    : statusCode >= 500 ? 'internal_error'
    : 'bad_request';
}

function normalizeValidationDetails(details) {
  const source = Array.isArray(details)
    ? details
    : details && Array.isArray(details.errors) ? details.errors : [];
  const errors = source.slice(0, 50).map(function (item) {
    const rawField = item && (item.field || item.path || item.param);
    const rawCode = item && (item.code || item.type || item.rule);
    const field = Array.isArray(rawField) ? rawField.join('.') : String(rawField || 'request');
    const code = String(rawCode || 'invalid').toLowerCase().replace(/[^a-z0-9_.-]/g, '_').slice(0, 64);
    return {
      field: /^[a-zA-Z0-9_.-]{1,100}$/.test(field) ? field : 'request',
      code: code || 'invalid'
    };
  });
  return errors.length ? { errors } : {};
}

function publicError(req, statusCode, code, details) {
  let safeCode = normalizeCode(code);
  let descriptor = PUBLIC_ERRORS[safeCode];
  const requestedStatus = Number(statusCode);

  // A caller cannot turn an allowlisted client error into a status-bearing
  // server failure (or vice versa) to bypass the public normalization policy.
  if (!Number.isInteger(requestedStatus) || requestedStatus !== descriptor.status) {
    safeCode = codeForStatus(requestedStatus);
    descriptor = PUBLIC_ERRORS[safeCode];
  }

  const correlationId = req && req.correlationId ? String(req.correlationId) : 'unavailable';
  const body = {
    error: descriptor.message,
    code: safeCode,
    requestId: correlationId
  };
  if (safeCode === 'validation_error') {
    const safeDetails = normalizeValidationDetails(details);
    if (Object.keys(safeDetails).length) body.details = safeDetails;
  }
  return { statusCode: descriptor.status, body };
}

function createError(code, _message, details = {}, statusCode = 400) {
  const normalized = publicError(null, statusCode, code, details);
  return { statusCode: normalized.statusCode, body: normalized.body };
}

function normalizeErrorResponses(req, res, next) {
  const sendJson = res.json.bind(res);
  const sendBody = res.send.bind(res);
  let sendingNormalizedJson = false;

  function normalizedBody(body) {
    const raw = body && body.error;
    const code = typeof raw === 'object' && raw
      ? raw.code
      : body && typeof body.code === 'string' ? body.code : null;
    const details = typeof raw === 'object' && raw ? raw.details : body && body.details;
    const normalized = publicError(req, res.statusCode, code, details);
    if (body && body.success === false) normalized.body.success = false;
    return normalized;
  }

  res.json = function (body) {
    if (res.statusCode < 400) return sendJson(body);
    console.error('[Error] Direct error response:', {
      correlationId: req.correlationId || 'unavailable',
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      code: typeof body === 'object' && body
        ? (typeof body.code === 'string' ? body.code
          : body.error && typeof body.error === 'object' ? body.error.code : null)
        : null
    });
    const normalized = normalizedBody(body);
    res.status(normalized.statusCode);
    res.setHeader('X-Correlation-ID', normalized.body.requestId);
    sendingNormalizedJson = true;
    try {
      return sendJson(normalized.body);
    } finally {
      sendingNormalizedJson = false;
    }
  };
  res.send = function (body) {
    if (sendingNormalizedJson || res.statusCode < 400) return sendBody(body);
    return res.json({ error: body });
  };
  next();
}

function errorHandler(err, req, res, _next) {
  const correlationId = req.correlationId || 'unavailable';
  const parserFailure = err && (
    err.type === 'entity.parse.failed' ||
    err.type === 'entity.too.large' ||
    err.type === 'charset.unsupported' ||
    err.type === 'encoding.unsupported' ||
    (err instanceof SyntaxError && Number(err.status || err.statusCode) === 400)
  );
  console.error('[Error] Request failed:', parserFailure ? {
    correlationId,
    event: err.type === 'entity.too.large' ? 'request_body_too_large'
      : err.type === 'charset.unsupported' || err.type === 'encoding.unsupported'
        ? 'request_encoding_unsupported'
        : 'request_body_malformed',
    statusCode: Number(err.status || err.statusCode) || 400,
  } : {
    correlationId,
    method: req.method,
    path: req.path,
    code: err.code || null,
    statusCode: err.statusCode || null,
    name: err.name || null,
    message: err.message,
    details: err.details || err.errors || null,
    stack: err.stack
  });

  let statusCode = Number(err.statusCode || err.status);
  let code = err.code;
  let details = err.details;
  if (parserFailure) {
    statusCode = err.type === 'entity.too.large' ? 413
      : err.type === 'charset.unsupported' || err.type === 'encoding.unsupported' ? 415
        : 400;
    code = err.type === 'entity.too.large' ? 'payload_too_large'
      : err.type === 'charset.unsupported' || err.type === 'encoding.unsupported'
        ? 'unsupported_media_type'
        : 'bad_request';
    details = null;
  } else if (err.name === 'ValidationError') {
    statusCode = 422;
    code = 'validation_error';
    details = err.errors || err.details;
  } else if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    statusCode = 401;
    code = 'invalid_token';
  } else if (!Number.isInteger(statusCode)) {
    statusCode = 500;
    code = 'internal_error';
  }

  const normalized = publicError(req, statusCode, code, details);
  res.setHeader('X-Correlation-ID', normalized.body.requestId);
  return res.status(normalized.statusCode).json(normalized.body);
}

function notFound(req, res) {
  const normalized = publicError(req, 404, 'not_found');
  res.setHeader('X-Correlation-ID', normalized.body.requestId);
  res.status(normalized.statusCode).json(normalized.body);
}

class ApiError extends Error {
  constructor(statusCode, code, message, details = {}) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.name = 'ApiError';
  }
}

module.exports = {
  errorHandler,
  notFound,
  createError,
  ApiError,
  normalizeErrorResponses,
  normalizeValidationDetails,
  publicError,
  PUBLIC_ERRORS
};
