/**
 * ApiError — Standardized error class with HTTP status code.
 * Used by middleware and route handlers to return consistent errors.
 */

class ApiError extends Error {
  constructor(statusCode, code, message, details = {}) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.name = 'ApiError';
  }
}

module.exports = { ApiError };