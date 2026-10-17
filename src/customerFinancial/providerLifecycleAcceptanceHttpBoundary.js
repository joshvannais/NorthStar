'use strict';

const READ_METHOD = 'GET';
const CORS_METHODS = Object.freeze([READ_METHOD]);
const ABSOLUTE_PATH_PATTERN =
  /^\/api\/v1\/customer-financial\/payment-provider\/lifecycle-acceptance\/?$/i;
function isProviderLifecycleAcceptancePath(pathname) {
  return typeof pathname === 'string' && ABSOLUTE_PATH_PATTERN.test(pathname);
}
module.exports = { READ_METHOD, CORS_METHODS, ABSOLUTE_PATH_PATTERN,
  isProviderLifecycleAcceptancePath };
