'use strict';

const READ_METHOD = 'GET';
const CORS_METHODS = Object.freeze([READ_METHOD]);
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const ABSOLUTE_PATH_PATTERN = new RegExp(
  `^/api/v1/customer-financial/editable-estimates/${UUID}/paid-tenant-journey-acceptance/?$`,
  'i');

function isPaidTenantJourneyAcceptancePath(pathname) {
  return typeof pathname === 'string' && ABSOLUTE_PATH_PATTERN.test(pathname);
}

module.exports = { READ_METHOD, CORS_METHODS, ABSOLUTE_PATH_PATTERN,
  isPaidTenantJourneyAcceptancePath };
