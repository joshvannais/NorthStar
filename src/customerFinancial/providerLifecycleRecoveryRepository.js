'use strict';

const contract = require('./providerLifecycleRecovery');
const lifecycleRetention = require('./providerLifecycleRetention');
const lifecycleRetentionRepository = require('./providerLifecycleRetentionRepository');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function restricted() {
  return Object.assign(new Error('Provider lifecycle recovery access is restricted.'), {
    code: 'CUSTOMER_FINANCIAL_PROVIDER_RECOVERY_RESTRICTED', status: 403,
  });
}

function stale() {
  return Object.assign(new Error('Refresh the current provider lifecycle recovery evidence.'), {
    code: 'CUSTOMER_FINANCIAL_PROVIDER_RECOVERY_STALE', status: 409,
  });
}

function sourceCurrent(source) {
  return source && typeof source === 'object' && !Array.isArray(source) &&
    Object.keys(source).sort().join(',') ===
      'actorAccessRole,actorUserId,authSessionId,organizationId' &&
    UUID.test(source.organizationId || '') && UUID.test(source.actorUserId || '') &&
    UUID.test(source.authSessionId || '') && source.actorAccessRole === 'owner';
}

function createRepository(options = {}) {
  const readRetention = options.readRetention || lifecycleRetentionRepository.read;
  async function snapshot(source) {
    return lifecycleRetention.project(await readRetention(source));
  }
  async function read(source) {
    if (!sourceCurrent(source)) throw restricted();
    const before = await snapshot(source);
    const value = contract.unavailable(before);
    const after = await snapshot(source);
    if (JSON.stringify(before) !== JSON.stringify(after)) throw stale();
    return contract.project(value, after);
  }
  return Object.freeze({ read });
}

const production = createRepository();
module.exports = { sourceCurrent, createRepository, read: production.read };
