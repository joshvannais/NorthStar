/**
 * Standard Error Handler Middleware
 * 
 * V3-06: Consistent error response format across all API endpoints.
 * Format: { "error": { "code": "ERROR_CODE", "message": "Human readable" } }
 */

const { ApiError } = require('./apiError');

/**
 * Express error handling middleware.
 */
function errorHandler(err, req, res, _next) {
  console.error(`[Error] ${req.method} ${req.path}:`, err.message);

  // Known ApiError with status code
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, details: err.details || {} }
    });
  }

  // Validation errors
  if (err.name === 'ValidationError' || err.type === 'validation') {
    return res.status(422).json({
      error: { code: 'validation_error', message: 'Invalid request data.', details: { errors: err.errors || err.details } }
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({ error: { code: 'invalid_token', message: 'Invalid or expired token.' } });
  }

  // Syntax errors (invalid JSON body)
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'invalid_json', message: 'Invalid JSON in request body.' } });
  }

  // Default 500
  res.status(500).json({
    error: { code: 'internal_error', message: 'An unexpected error occurred. Please try again.' }
  });
}

/**
 * 404 handler for unmatched routes.
 */
function notFound(req, res) {
  res.status(404).json({
    error: { code: 'not_found', message: `Route ${req.method} ${req.path} not found.` }
  });
}

module.exports = { errorHandler, notFound };