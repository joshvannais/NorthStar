'use strict';

const { READ_METHOD, isFictionalDemoJourneyAcceptancePath,
  estimateIdFromFictionalDemoJourneyAcceptancePath } =
  require('../customerFinancial/fictionalDemoJourneyAcceptanceHttpBoundary');
const { hasFramedBody, setPrivate } = require('./reportingPart12AcceptanceBoundary');

const FORBIDDEN_CONTENT_HEADERS = new Set([
  'content-type', 'content-encoding', 'content-language', 'content-range',
]);

function hasRawQuery(req) {
  const value = typeof req.originalUrl === 'string' ? req.originalUrl : '';
  return value.includes('?');
}

function hasForbiddenContentHeaders(req) {
  const raw = Array.isArray(req.rawHeaders) ? req.rawHeaders : [];
  for (let index = 0; index < raw.length; index += 2) {
    if (FORBIDDEN_CONTENT_HEADERS.has(String(raw[index]).toLowerCase())) return true;
  }
  return false;
}

function invalid(res) {
  setPrivate(res);
  res.removeHeader('X-Request-Id');
  return res.status(400).json({ success:false, error:{
    category:'DEMO_FINANCIAL_JOURNEY_INVALID',
    message:'Review the exact current fictional financial journey.',
  } });
}

function methodNotAllowed(res) {
  setPrivate(res); res.set('Allow', READ_METHOD);
  res.removeHeader('X-Request-Id');
  return res.status(405).json({ success:false, error:{
    category:'DEMO_FINANCIAL_JOURNEY_METHOD_NOT_ALLOWED',
    message:'Use the exact fictional financial journey read boundary.',
  } });
}

function fictionalDemoJourneyAcceptanceBoundary(req, res, next) {
  if (!isFictionalDemoJourneyAcceptancePath(req.path)) return next();
  if (req.method !== READ_METHOD) return methodNotAllowed(res);
  if (!estimateIdFromFictionalDemoJourneyAcceptancePath(req.path) || hasRawQuery(req) ||
      hasForbiddenContentHeaders(req) || hasFramedBody(req)) return invalid(res);
  return next();
}

module.exports = { fictionalDemoJourneyAcceptanceBoundary, hasRawQuery,
  hasForbiddenContentHeaders, invalid, methodNotAllowed };
