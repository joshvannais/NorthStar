/**
 * Request Validation Middleware
 * 
 * Validates request body, query parameters, and URL params before
 * they reach route handlers. Uses a schema-based validation pattern.
 */


/**
 * Validate request body against a schema.
 * Schema: { fieldName: { type: 'string'|'number'|'boolean'|'email'|'phone', required: true, min, max, pattern } }
 * 
 * Usage: router.post('/leads', validateBody(leadSchema), handler)
 */
function validateBody(schema) {
  return (req, res, next) => {
    const errors = [];
    const body = req.body || {};

    for (const [field, rules] of Object.entries(schema)) {
      const value = body[field];

      // Check required
      if (rules.required && (value === undefined || value === null || value === '')) {
        errors.push({ field, code: 'required' });
        continue;
      }

      if (value === undefined || value === null || value === '') continue;

      // Type checks
      if (rules.type === 'string' && typeof value !== 'string') {
        errors.push({ field, code: 'type_string' });
      } else if (rules.type === 'number') {
        const num = Number(value);
        if (isNaN(num)) errors.push({ field, code: 'type_number' });
      } else if (rules.type === 'boolean' && typeof value !== 'boolean') {
        errors.push({ field, code: 'type_boolean' });
      } else if (rules.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        errors.push({ field, code: 'format_email' });
      } else if (rules.type === 'phone' && !/^[\d\s\-().+]{7,20}$/.test(String(value))) {
        errors.push({ field, code: 'format_phone' });
      }

      // String-specific checks
      if (typeof value === 'string') {
        if (rules.min && value.length < rules.min) {
          errors.push({ field, code: 'min_length' });
        }
        if (rules.max && value.length > rules.max) {
          errors.push({ field, code: 'max_length' });
        }
        if (rules.pattern && !rules.pattern.test(value)) {
          errors.push({ field, code: 'invalid_format' });
        }
      }

      // Number-specific checks
      if (rules.type === 'number') {
        const num = Number(value);
        if (rules.min !== undefined && num < rules.min) {
          errors.push({ field, code: 'min_value' });
        }
        if (rules.max !== undefined && num > rules.max) {
          errors.push({ field, code: 'max_value' });
        }
      }
    }

    if (errors.length > 0) {
      return res.status(422).json({
        error: { code: 'validation_error', message: 'Invalid request data.', details: { errors } }
      });
    }

    next();
  };
}

/**
 * Validate query parameters.
 * Usage: router.get('/leads', validateQuery(querySchema), handler)
 */
const validateQuery = validateBody;

/**
 * Common validation schemas.
 */
const schemas = {
  leadCreate: {
    customerName: { type: 'string', required: true, min: 1, max: 200 },
    phoneNumber: { type: 'phone', required: true },
    email: { type: 'email', required: false },
    address: { type: 'string', required: false, max: 500 },
    serviceRequested: { type: 'string', required: true, max: 200 },
    preferredTime: { type: 'string', required: false, max: 100 },
    notes: { type: 'string', required: false, max: 2000 }
  },
  leadUpdate: {
    customerName: { type: 'string', required: false, min: 1, max: 200 },
    phoneNumber: { type: 'phone', required: false },
    email: { type: 'email', required: false },
    address: { type: 'string', required: false, max: 500 },
    serviceRequested: { type: 'string', required: false, max: 200 },
    status: { type: 'string', required: false, max: 50 }
  },
  signup: {
    name: { type: 'string', required: true, min: 1, max: 200 },
    email: { type: 'email', required: true },
    password: { type: 'string', required: true, min: 6, max: 128 },
    businessName: { type: 'string', required: false, max: 200 },
    phone: { type: 'phone', required: false }
  },
  login: {
    email: { type: 'email', required: true },
    password: { type: 'string', required: true, min: 1 }
  },
  pagination: {
    cursor: { type: 'string', required: false },
    limit: { type: 'number', required: false, min: 1, max: 100 }
  },
  contactForm: {
    name: { type: 'string', required: true, min: 1, max: 200 },
    email: { type: 'email', required: true },
    subject: { type: 'string', required: true, min: 1, max: 200 },
    message: { type: 'string', required: true, min: 1, max: 5000 }
  }
};

module.exports = { validateBody, validateQuery, schemas };
