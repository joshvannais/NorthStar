'use strict';

const NAMESPACE = '/api/v1/customer-financial';
const CLASSIFIED_NAMESPACE = Symbol('northstar.customerFinancialNamespace');
const UNSUPPORTED_PART14_PATTERN = new RegExp(
  '^/api/v1/customer-financial/(?:public(?:/|$)|payment-provider/(?:webhook|charge)(?:/|$)|offline-receipts(?:/|$))',
  'i');

function requestPath(req) {
  const value = typeof req.originalUrl === 'string' ? req.originalUrl :
    (typeof req.url === 'string' ? req.url : '');
  const query = value.indexOf('?');
  return query < 0 ? value : value.slice(0, query);
}

function decodeAsciiPercent(value) {
  let output = '';
  let changed = false;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '%' && index + 2 < value.length &&
        /^[0-9a-f]{2}$/i.test(value.slice(index + 1, index + 3))) {
      const byte = Number.parseInt(value.slice(index + 1, index + 3), 16);
      if (byte <= 0x7f) {
        output += String.fromCharCode(byte);
        index += 2;
        changed = true;
        continue;
      }
    }
    output += value[index];
  }
  return { value:output, changed };
}

function inspectSegments(value) {
  const segments = value.replace(/\\/g, '/').split('/');
  const resolved = [];
  let enteredNamespace = false;
  for (const segment of segments) {
    if (!segment || segment === '.') continue;
    if (segment === '..') { if (resolved.length) resolved.pop(); continue; }
    resolved.push(segment);
    if (resolved.length >= 3 && resolved[0].toLowerCase() === 'api' &&
        resolved[1].toLowerCase() === 'v1' &&
        resolved[2].toLowerCase() === 'customer-financial') enteredNamespace = true;
  }
  return { canonical:'/' + resolved.join('/'), enteredNamespace };
}

function classifyPath(req) {
  const raw = requestPath(req);
  let candidate = raw;
  let inspection = inspectSegments(raw);
  let enteredNamespace = inspection.enteredNamespace;
  // Every ASCII percent-decoding round shortens the bounded request target.
  // Iterate to a fixed point so double and repeated encodings cannot create a
  // second routing interpretation after this boundary.
  for (let round = 0; round <= raw.length; round += 1) {
    const decoded = decodeAsciiPercent(candidate);
    candidate = decoded.value;
    inspection = inspectSegments(candidate);
    enteredNamespace = enteredNamespace || inspection.enteredNamespace;
    if (!decoded.changed) break;
  }
  const canonical = inspection.canonical;
  const namespace = /^\/api\/v1\/customer-financial(?:\/|$)/i.test(canonical);
  // Protection is monotonic: once any bounded raw/decoded representation
  // begins inside this namespace, later dot-segment resolution cannot erase
  // that provenance and expose the reflective global 404.
  if (!enteredNamespace && !namespace) return null;
  const literal = /^\/api\/v1\/customer-financial(?:\/|$)/i.test(raw);
  const ambiguous = !literal || !namespace || raw.includes('\\') || /\/{2,}/.test(raw) ||
    /(?:^|\/)\.{1,2}(?:\/|$)/.test(raw) || candidate.includes('\\') ||
    /\/{2,}/.test(candidate) || /(?:^|\/)\.{1,2}(?:\/|$)/.test(candidate);
  return { canonical, ambiguous };
}

function unsupportedPart14Path(req) {
  const classification = classifyPath(req);
  return !!classification && UNSUPPORTED_PART14_PATTERN.test(classification.canonical);
}

function customerFinancialPath(req) {
  return req[CLASSIFIED_NAMESPACE] === true || !!classifyPath(req);
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
  const classification = classifyPath(req);
  if (!classification) return next();
  Object.defineProperty(req, CLASSIFIED_NAMESPACE, { value:true, enumerable:false,
    writable:false, configurable:false });
  return classification.ambiguous ||
    UNSUPPORTED_PART14_PATTERN.test(classification.canonical) ? deny(res) : next();
}

// Seal parser failures for the whole private namespace. Without this scoped
// error boundary, malformed JSON on a later unmatched route could reach the
// global parser error formatter before the fixed namespace fallthrough.
function customerFinancialParserError(error, req, res, next) {
  return error && customerFinancialPath(req) ? deny(res) : next(error);
}

// Any other unmatched customer-financial route receives the same fixed private
// response after all canonical routers have had an opportunity to handle it.
function customerFinancialNotFound(req, res, next) {
  return customerFinancialPath(req) ? deny(res) : next();
}

module.exports = Object.freeze({ NAMESPACE, UNSUPPORTED_PART14_PATTERN,
  unsupportedPart14Path, customerFinancialUnsupportedBoundary,
  customerFinancialParserError, customerFinancialNotFound });
