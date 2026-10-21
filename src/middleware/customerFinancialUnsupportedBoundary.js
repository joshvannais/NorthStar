'use strict';

const NAMESPACE = '/api/v1/customer-financial';
const CLASSIFIED_NAMESPACE = Symbol('northstar.customerFinancialNamespace');
const PATH_CLASSIFICATION_POLICY = Object.freeze({
  maxDecodeRounds:4,
  maxRawTargetLength:8192,
  maxNestedPercentDepth:8,
});
const UNSUPPORTED_PART14_PATTERN = new RegExp(
  '^/api/v1/customer-financial/(?:public(?:/|$)|payment-provider/(?:webhook|charge)(?:/|$)|offline-receipts(?:/|$))',
  'i');

function requestPath(req) {
  const value = typeof req.originalUrl === 'string' ? req.originalUrl :
    (typeof req.url === 'string' ? req.url : '');
  const query = value.indexOf('?');
  return query < 0 ? value : value.slice(0, query);
}

function hexValue(code) {
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 65 && code <= 70) return code - 55;
  if (code >= 97 && code <= 102) return code - 87;
  return -1;
}

// Collapse a conventional repeatedly encoded ASCII byte (%252561 -> "a")
// in one left-to-right pass. This keeps arbitrary %25 nesting linear instead
// of requiring one full-string decoding pass per layer.
function decodeAsciiPercent(value) {
  let output = '';
  let changed = false;
  let complex = false;
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 37) {
      let cursor = index + 1;
      let nestedDepth = 0;
      while (cursor + 1 < value.length && value.charCodeAt(cursor) === 50 &&
          value.charCodeAt(cursor + 1) === 53) {
        nestedDepth += 1;
        cursor += 2;
      }
      if (nestedDepth > PATH_CLASSIFICATION_POLICY.maxNestedPercentDepth) complex = true;
      const high = cursor < value.length ? hexValue(value.charCodeAt(cursor)) : -1;
      const low = cursor + 1 < value.length ? hexValue(value.charCodeAt(cursor + 1)) : -1;
      const byte = high < 0 || low < 0 ? 256 : high * 16 + low;
      if (byte <= 0x7f) {
        output += String.fromCharCode(byte);
        index = cursor + 1;
        changed = true;
        continue;
      }
    }
    output += value[index];
  }
  return { value:output, changed, complex };
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
  let complex = raw.length > PATH_CLASSIFICATION_POLICY.maxRawTargetLength;
  let decodeLimitExceeded = false;
  // The number of full-string passes is a small constant independent of input
  // length. Each pass also collapses an arbitrary conventional %25 nesting
  // chain in one scan. Inputs that still transform at the limit are ambiguous
  // and, once the protected namespace has been observed, fail closed.
  for (let round = 0; round < PATH_CLASSIFICATION_POLICY.maxDecodeRounds; round += 1) {
    const decoded = decodeAsciiPercent(candidate);
    candidate = decoded.value;
    complex = complex || decoded.complex;
    inspection = inspectSegments(candidate);
    enteredNamespace = enteredNamespace || inspection.enteredNamespace;
    if (!decoded.changed) break;
    if (round === PATH_CLASSIFICATION_POLICY.maxDecodeRounds - 1) {
      decodeLimitExceeded = true;
    }
  }
  const canonical = inspection.canonical;
  const namespace = /^\/api\/v1\/customer-financial(?:\/|$)/i.test(canonical);
  // Protection is monotonic: once any bounded raw/decoded representation
  // begins inside this namespace, later dot-segment resolution cannot erase
  // that provenance and expose the reflective global 404.
  if (!enteredNamespace && !namespace) return null;
  const literal = /^\/api\/v1\/customer-financial(?:\/|$)/i.test(raw);
  const ambiguous = complex || decodeLimitExceeded || !literal || !namespace ||
    raw.includes('\\') || /\/{2,}/.test(raw) ||
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

module.exports = Object.freeze({ NAMESPACE, PATH_CLASSIFICATION_POLICY,
  UNSUPPORTED_PART14_PATTERN,
  unsupportedPart14Path, customerFinancialUnsupportedBoundary,
  customerFinancialParserError, customerFinancialNotFound });
