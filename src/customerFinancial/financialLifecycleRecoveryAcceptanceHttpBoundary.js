'use strict';

const READ_METHOD = 'GET';
const CORS_METHODS = Object.freeze([READ_METHOD]);
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const ABSOLUTE_PATH_PATTERN = new RegExp(
  `^/api/v1/customer-financial/editable-estimates/${UUID}/financial-lifecycle-recovery-acceptance/?$`,
  'i');
const CANDIDATE_PATH_PATTERN =
  /^\/api\/v1\/customer-financial\/editable-estimates\/[^/]+\/financial-lifecycle-recovery-acceptance\/?$/i;

function isFinancialLifecycleRecoveryAcceptancePath(pathname) {
  return typeof pathname === 'string' && ABSOLUTE_PATH_PATTERN.test(pathname);
}

function isFinancialLifecycleRecoveryAcceptanceCandidatePath(pathname) {
  return typeof pathname === 'string' && CANDIDATE_PATH_PATTERN.test(pathname);
}

module.exports = { READ_METHOD, CORS_METHODS, ABSOLUTE_PATH_PATTERN, CANDIDATE_PATH_PATTERN,
  isFinancialLifecycleRecoveryAcceptancePath,
  isFinancialLifecycleRecoveryAcceptanceCandidatePath };
