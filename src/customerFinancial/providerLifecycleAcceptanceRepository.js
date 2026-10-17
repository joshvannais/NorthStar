'use strict';

const contract = require('./providerLifecycleAcceptance');
const lifecycleRecovery = require('./providerLifecycleRecovery');
const lifecycleRecoveryRepository = require('./providerLifecycleRecoveryRepository');
const { types: utilTypes } = require('node:util');

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
  if (!source || typeof source !== 'object' || Array.isArray(source) ||
      utilTypes.isProxy(source) || Object.getPrototypeOf(source) !== Object.prototype ||
      Reflect.ownKeys(source).some(key => typeof key !== 'string')) return false;
  const keys = Object.keys(source);
  if (keys.sort().join(',') !== 'actorAccessRole,actorUserId,authSessionId,organizationId' ||
      Reflect.ownKeys(source).length !== keys.length || keys.some(key => {
        const descriptor = Object.getOwnPropertyDescriptor(source, key);
        return !descriptor || !descriptor.enumerable ||
          !Object.prototype.hasOwnProperty.call(descriptor, 'value');
      })) return false;
  return UUID.test(source.organizationId || '') && UUID.test(source.actorUserId || '') &&
    UUID.test(source.authSessionId || '') && source.actorAccessRole === 'owner';
}
function createRepository(options = {}) {
  const readRecovery = options.readRecovery || lifecycleRecoveryRepository.read;
  async function snapshot(source) {
    const raw = await readRecovery(source);
    contract.unavailable(raw);
    return lifecycleRecovery.project(raw);
  }
  async function read(source) {
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
