'use strict';

const NAMESPACE = '/api/v1/customer-financial';
const CLASSIFIED_NAMESPACE = Symbol('northstar.customerFinancialNamespace');
const PATH_CLASSIFICATION_POLICY = Object.freeze({
  maxDecodeRounds:1,
  maxRawTargetLength:8192,
  maxNestedPercentDepth:8,
  maxTargetRepresentations:3,
  maxAuthorityPathInterpretations:128,
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

// Resolve every recursively percent-encoded ASCII byte in one streaming pass.
// The reduction stack also handles encodings that split the percent sign and
// hex digits into separate escapes (for example %25%361 -> %61 -> "a"). Each
// input character is pushed once and each reduction removes two stack items,
// so work remains linear even when an admitted target uses mixed encodings.
function decodeAsciiPercent(value) {
  const output = [];
  const depths = [];
  let changed = false;
  let complex = false;
  for (let index = 0; index < value.length; index += 1) {
    output.push(value[index]);
    depths.push(0);
    while (output.length >= 3 && output[output.length - 3] === '%') {
      const high = hexValue(output[output.length - 2].charCodeAt(0));
      const low = hexValue(output[output.length - 1].charCodeAt(0));
      const byte = high < 0 || low < 0 ? 256 : high * 16 + low;
      if (byte > 0x7f) break;
      const depth = Math.max(depths[depths.length - 3], depths[depths.length - 2],
        depths[depths.length - 1]) + 1;
      output.length -= 3;
      depths.length -= 3;
      output.push(String.fromCharCode(byte));
      depths.push(depth);
      changed = true;
      if (depth > PATH_CLASSIFICATION_POLICY.maxNestedPercentDepth) complex = true;
    }
  }
  return { value:output.join(''), changed, complex };
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

function firstAuthoritySeparator(value, start) {
  for (let index = start; index < value.length; index += 1) {
    if (value[index] === '/' || value[index] === '\\') return index;
  }
  return -1;
}

function isAuthoritySeparator(value, index) {
  return value[index] === '/' || value[index] === '\\';
}

function validScheme(value, colon) {
  if (colon < 1) return false;
  const first = value.charCodeAt(0);
  if (!((first >= 65 && first <= 90) || (first >= 97 && first <= 122))) return false;
  for (let index = 1; index < colon; index += 1) {
    const code = value.charCodeAt(index);
    if (!((code >= 65 && code <= 90) || (code >= 97 && code <= 122) ||
        (code >= 48 && code <= 57) || code === 43 || code === 45 || code === 46)) return false;
  }
  return true;
}

// Retain every bounded pathname interpretation from HTTP absolute-form and
// recursively authority-prefixed network-path targets. A separator pair can
// be either the next authority or a duplicate-separated pathname, so a later
// authority interpretation must never erase the earlier suffix. The cursor
// advances monotonically and the interpretation count is fixed, keeping total
// work bounded and linear in the admitted target length.
function authorityPaths(value) {
  let cursor = -1;
  let form = 'origin';
  let ambiguous = false;
  if (isAuthoritySeparator(value, 0) && isAuthoritySeparator(value, 1)) {
    cursor = 0;
    form = 'network';
    ambiguous = value[0] !== '/' || value[1] !== '/';
  } else {
    const colon = value.indexOf(':');
    if (validScheme(value, colon) && isAuthoritySeparator(value, colon + 1) &&
        isAuthoritySeparator(value, colon + 2)) {
      cursor = colon + 1;
      form = 'absolute';
      ambiguous = value[colon + 1] !== '/' || value[colon + 2] !== '/';
    }
  }
  if (cursor < 0) return { paths:[], overflow:false };
  const paths = [];
  while (isAuthoritySeparator(value, cursor) &&
      isAuthoritySeparator(value, cursor + 1)) {
    let authorityStart = cursor;
    while (isAuthoritySeparator(value, authorityStart)) authorityStart += 1;
    if (authorityStart - cursor !== 2) ambiguous = true;
    const separator = firstAuthoritySeparator(value, authorityStart);
    if (separator < 0) {
      paths.push({ path:'/', form, ambiguous });
      return { paths, overflow:false };
    }
    if (separator === authorityStart || value[separator] === '\\') ambiguous = true;
    if (paths.length === PATH_CLASSIFICATION_POLICY.maxAuthorityPathInterpretations) {
      return { paths, overflow:true };
    }
    paths.push({ path:value.slice(separator), form,
      ambiguous:ambiguous || paths.length > 0 });
    cursor = separator;
  }
  return { paths, overflow:false };
}

function candidatePaths(value) {
  const paths = [{ path:value, form:'origin', ambiguous:false }];
  const extracted = authorityPaths(value);
  paths.push(...extracted.paths);
  return { paths, authorityOverflow:extracted.overflow };
}

function classifyPath(req) {
  const raw = requestPath(req);
  const decodedTarget = decodeAsciiPercent(raw);
  const representations = raw === decodedTarget.value ? [raw] : [raw, decodedTarget.value];
  // Express exposes the pathname it resolved from origin- and absolute-form
  // targets. Treat it only as one additional bounded representation; the raw
  // target remains authoritative for network-path and ambiguity provenance.
  if (representations.length < PATH_CLASSIFICATION_POLICY.maxTargetRepresentations &&
      typeof req.path === 'string' && !representations.includes(req.path)) {
    representations.push(req.path);
  }
  const paths = [];
  let authorityOverflow = false;
  for (const representation of representations) {
    const candidates = candidatePaths(representation);
    for (const candidate of candidates.paths) paths.push(candidate);
    authorityOverflow = authorityOverflow || candidates.authorityOverflow;
  }
  let canonical = '/';
  let enteredNamespace = false;
  let alternateForm = false;
  let targetAmbiguous = false;
  let complex = raw.length > PATH_CLASSIFICATION_POLICY.maxRawTargetLength;
  let changed = decodedTarget.changed;
  for (const target of paths) {
    const decoded = decodeAsciiPercent(target.path);
    complex = complex || decoded.complex;
    changed = changed || decoded.changed;
    const inspection = inspectSegments(decoded.value);
    const namespace = /^\/api\/v1\/customer-financial(?:\/|$)/i.test(
      inspection.canonical);
    if (inspection.enteredNamespace || namespace) {
      enteredNamespace = true;
      canonical = inspection.canonical;
      alternateForm = alternateForm || target.form !== 'origin';
      targetAmbiguous = targetAmbiguous || target.ambiguous;
    }
  }
  const namespace = /^\/api\/v1\/customer-financial(?:\/|$)/i.test(canonical);
  // Protection is monotonic: once any bounded raw/decoded representation
  // begins inside this namespace, later dot-segment resolution cannot erase
  // that provenance and expose the reflective global 404.
  if (!enteredNamespace && !namespace && !authorityOverflow) return null;
  const literal = /^\/api\/v1\/customer-financial(?:\/|$)/i.test(raw);
  const ambiguous = complex || changed || alternateForm || targetAmbiguous ||
    authorityOverflow || !literal || !namespace ||
    raw.includes('\\') || /\/{2,}/.test(raw) ||
    /(?:^|\/)\.{1,2}(?:\/|$)/.test(raw);
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
