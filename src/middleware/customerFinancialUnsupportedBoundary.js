'use strict';

const NAMESPACE = '/api/v1/customer-financial';
const CLASSIFIED_NAMESPACE = Symbol('northstar.customerFinancialNamespace');
const PATH_CLASSIFICATION_POLICY = Object.freeze({
  maxDecodeRounds:1,
  maxRawTargetLength:8192,
  maxNestedPercentDepth:8,
  maxTargetRepresentations:3,
  maxAuthorityPathExtractions:2,
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

// Extract the pathname from HTTP absolute-form and network-path targets without
// using URL parsing that can apply a second, disagreeing normalization policy.
// The caller invokes this at most twice so malformed forms such as http:////host
// remain bounded while their protected pathname provenance cannot disappear.
function authorityPath(value) {
  let authorityStart = -1;
  let form = 'origin';
  if (value[0] === '/' && value[1] === '/') {
    authorityStart = 2;
    form = 'network';
  } else {
    const colon = value.indexOf(':');
    if (validScheme(value, colon) && value[colon + 1] === '/' &&
        value[colon + 2] === '/') {
      authorityStart = colon + 3;
      form = 'absolute';
    }
  }
  if (authorityStart < 0) return { path:value, form, ambiguous:false };
  const separator = firstAuthoritySeparator(value, authorityStart);
  const authority = separator < 0 ? value.slice(authorityStart) :
    value.slice(authorityStart, separator);
  return { path:separator < 0 ? '/' : value.slice(separator), form,
    ambiguous:authority.length === 0 || authority.includes('\\') };
}

function candidatePaths(value) {
  const paths = [{ path:value, form:'origin', ambiguous:false }];
  let remainder = value;
  for (let extraction = 0;
    extraction < PATH_CLASSIFICATION_POLICY.maxAuthorityPathExtractions;
    extraction += 1) {
    const extracted = authorityPath(remainder);
    if (extracted.form === 'origin') break;
    paths.push({ path:extracted.path, form:extracted.form,
      ambiguous:extracted.ambiguous || extraction > 0 });
    remainder = extracted.path;
  }
  return paths;
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
  for (const representation of representations) {
    for (const candidate of candidatePaths(representation)) paths.push(candidate);
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
  if (!enteredNamespace && !namespace) return null;
  const literal = /^\/api\/v1\/customer-financial(?:\/|$)/i.test(raw);
  const ambiguous = complex || changed || alternateForm || targetAmbiguous || !literal || !namespace ||
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
