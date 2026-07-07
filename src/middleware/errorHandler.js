/**
 * Standard Error Handler Middleware
 * 
 * Provides consistent JSON error responses across all API endpoints.
 * Format: { "error": { "code": "...", "message": "...", "details": {} } }
 */

/**
 * Create a standardized error response object.
 */
function createError(code, message, details = {}, statusCode = 400) {
  return { statusCode, body: { error: { code, message, details } } };
}

/**
 * Express middleware: catches errors and returns consistent format.
 */
function errorHandler(err, req, res, _next) {
  console.error(`[Error] ${req.method} ${req.path}:`, err.message);

  // Handle known error types
  if (err.statusCode) {
    return res.status(err.statusCode).json({ error: { code: err.code || 'error', message: err.message, details: err.details || {} } });
  }

  // Validation errors (Joi, express-validator)
  if (err.name === 'ValidationError') {
    return res.status(422).json({
      error: { code: 'validation_error', message: 'Invalid request data.', details: { errors: err.errors || err.details } }
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({ error: { code: 'invalid_token', message: 'Invalid or expired token.' } });
  }

  // Default: 500 Internal Server Error
  res.status(500).json({
    error: { code: 'internal_error', message: 'An unexpected error occurred. Please try again.' }
  });
}

/**
 * Helper: 404 Not Found
 */
function notFound(req, res) {
  res.status(404).json({
    error: { code: 'not_found', message: `Endpoint ${req.method} ${req.path} not found.` }
  });
}

/**
 * Error class with status code for known API errors.
 */
class ApiError extends Error {
  constructor(statusCode, code, message, details = {}) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

module.exports = { errorHandler, notFound, createError, ApiError };
