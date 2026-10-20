'use strict';

const READ_METHOD = 'GET';
const CORS_METHODS = Object.freeze([READ_METHOD]);
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const UUID_PATTERN = new RegExp(`^${UUID}$`, 'i');
// Express' :estimateId segment accepts every non-empty encoded path segment.
// The early boundary intentionally mirrors that complete route shape, then
// validates the decoded identifier separately before any other middleware.
const ABSOLUTE_PATH_PATTERN =
  /^\/api\/demo\/customer-financial\/invoice-drafts\/([^/]+)\/part14b-acceptance\/?$/i;

function isFictionalDemoJourneyAcceptancePath(pathname) {
  return typeof pathname === 'string' && ABSOLUTE_PATH_PATTERN.test(pathname);
}

function estimateIdFromFictionalDemoJourneyAcceptancePath(pathname) {
  if (typeof pathname !== 'string') return null;
  const matched = ABSOLUTE_PATH_PATTERN.exec(pathname);
  if (!matched) return null;
  try {
    const decoded = decodeURIComponent(matched[1]);
    return UUID_PATTERN.test(decoded) ? decoded : null;
  } catch (_) {
    return null;
  }
}

module.exports = { READ_METHOD, CORS_METHODS, ABSOLUTE_PATH_PATTERN,
  UUID_PATTERN, isFictionalDemoJourneyAcceptancePath,
  estimateIdFromFictionalDemoJourneyAcceptancePath };
