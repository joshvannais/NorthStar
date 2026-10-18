'use strict';

const {
  assertCanonicalAmbientPrototypes,
  exactPlainRecord,
} = require('./providerLifecycleAcceptancePlainData');

// Reject pre-load pollution before importing any sealed upstream builder.
assertCanonicalAmbientPrototypes();

const contract = require('./providerLifecycleAcceptance');
const lifecycleRecovery = require('./providerLifecycleRecovery');
const lifecycleRecoveryRepository = require('./providerLifecycleRecoveryRepository');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function restricted() {
  return Object.assign(new Error('Provider lifecycle acceptance access is restricted.'), {
    code: 'CUSTOMER_FINANCIAL_PROVIDER_ACCEPTANCE_RESTRICTED', status: 403,
  });
}
function stale() {
  return Object.assign(new Error('Refresh the current provider lifecycle acceptance evidence.'), {
    code: 'CUSTOMER_FINANCIAL_PROVIDER_ACCEPTANCE_STALE', status: 409,
  });
}
function sourceCurrent(source) {
  let exact;
  try {
    assertCanonicalAmbientPrototypes(restricted);
    exact = exactPlainRecord(source,
      ['organizationId', 'actorUserId', 'actorAccessRole', 'authSessionId'], restricted);
  } catch (_error) { return false; }
  return typeof exact.organizationId === 'string' &&
    typeof exact.actorUserId === 'string' &&
    typeof exact.authSessionId === 'string' &&
    typeof exact.actorAccessRole === 'string' &&
    UUID.test(exact.organizationId) && UUID.test(exact.actorUserId) &&
    UUID.test(exact.authSessionId) && exact.actorAccessRole === 'owner';
}
function createRepository(options) {
  assertCanonicalAmbientPrototypes();
  if (options === undefined) options = {};
  const readRecovery = options.readRecovery || lifecycleRecoveryRepository.read;
  async function snapshot(source) {
    assertCanonicalAmbientPrototypes();
    const raw = await readRecovery(source);
    contract.unavailable(raw);
    return lifecycleRecovery.project(raw);
  }
  async function read(source) {
    assertCanonicalAmbientPrototypes();
    if (!sourceCurrent(source)) throw restricted();
    const before = await snapshot(source);
    const value = contract.unavailable(before);
    const after = await snapshot(source);
    contract.unavailable(after);
    if (JSON.stringify(before) !== JSON.stringify(after)) throw stale();
    return contract.project(value, after);
  }
  return Object.freeze({ read });
}
const production = createRepository();
module.exports = { sourceCurrent, createRepository, read: production.read };
