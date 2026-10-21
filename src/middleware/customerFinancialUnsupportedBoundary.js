'use strict';

const NAMESPACE = '/api/v1/customer-financial';
const UNSUPPORTED_PART14_PATTERN = new RegExp(
  '^/api/v1/customer-financial/(?:public(?:/|$)|payment-provider/(?:webhook|charge)(?:/|$)|offline-receipts(?:/|$))',
  'i');

function requestPath(req) {
  const value = typeof req.originalUrl === 'string' ? req.originalUrl :
    (typeof req.url === 'string' ? req.url : '');
  const query = value.indexOf('?');
  return query < 0 ? value : value.slice(0, query);
}

function unsupportedPart14Path(req) {
  const raw = requestPath(req).replace(/\\/g, '/');
  if (UNSUPPORTED_PART14_PATTERN.test(raw)) return true;
  try {
    return UNSUPPORTED_PART14_PATTERN.test(decodeURIComponent(raw));
  } catch (_error) {
    // A malformed escape under a literal protected prefix remains unsupported.
    return UNSUPPORTED_PART14_PATTERN.test(raw);
  }
}

function customerFinancialPath(req) {
  const raw = requestPath(req).replace(/\\/g, '/');
  if (/^\/api\/v1\/customer-financial(?:\/|$)/i.test(raw)) return true;
  try {
    return /^\/api\/v1\/customer-financial(?:\/|$)/i.test(decodeURIComponent(raw));
  } catch (_error) {
    return false;
  }
}

function setPrivate(res) {
  res.set('Cache-Control', 'private, no-store');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-Content-Type-Options', 'nosniff');
  res.vary('Cookie');
  res.removeHeader('X-Request-Id');
  res.removeHeader('X-Correlation-Id');
}

function deny(res) {
  setPrivate(res);
  return res.status(404).json({ success:false, error:{
    category:'CUSTOMER_FINANCIAL_RESOURCE_UNAVAILABLE',
    message:'The requested customer financial resource is unavailable.',
  } });
}

// These never-mounted Part 14 financial action namespaces are denied before
// CORS, correlation IDs and body parsing. Malformed or scalar request bodies
// therefore cannot fall through to a reflective parser/not-found response.
function customerFinancialUnsupportedBoundary(req, res, next) {
  return unsupportedPart14Path(req) ? deny(res) : next();
}

// Seal parser failures for the whole private namespace. Without this scoped
// error boundary, malformed JSON on a later unmatched route could reach the
// global parser error formatter before the fixed namespace fallthrough.
function customerFinancialParserError(error, req, res, next) {
  return error && customerFinancialPath(req) ? deny(res) : next(error);
}

// Any other unmatched customer-financial route receives the same fixed private
// response after all canonical routers have had an opportunity to handle it.
function customerFinancialNotFound(_req, res) { return deny(res); }

module.exports = Object.freeze({ NAMESPACE, UNSUPPORTED_PART14_PATTERN,
  unsupportedPart14Path, customerFinancialUnsupportedBoundary,
  customerFinancialParserError, customerFinancialNotFound });
