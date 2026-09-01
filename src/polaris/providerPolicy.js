'use strict';

const { contractError } = require('./assistantContract');

const PLAN_BILLING_HREF = '/dashboard/settings#subscription-billing';
const PROVIDER_PLANS = new Set(['Growth', 'Complete']);
const PLAN_MANAGERS = new Set(['owner', 'admin']);

function evaluateProviderEntitlement(input = {}) {
  const role = typeof input.role === 'string' ? input.role : '';
  const plan = typeof input.plan === 'string' ? input.plan : '';
  const canManagePlan = PLAN_MANAGERS.has(role);
  const canUseProvider = PROVIDER_PLANS.has(plan) &&
    ['owner', 'admin', 'member', 'viewer'].includes(role);
  const showUpgrade = !canUseProvider && plan === 'Starter' && canManagePlan;
  return Object.freeze({
    mode: canUseProvider ? 'provider' : 'preview',
    canUseProvider,
    canManagePlan,
    showUpgrade,
    upgradeHref: showUpgrade ? PLAN_BILLING_HREF : null,
  });
}

function requireProviderEntitlement(input = {}) {
  const result = evaluateProviderEntitlement(input);
  if (result.canUseProvider) return result;
  if (result.showUpgrade) {
    throw contractError(
      'POLARIS_PLAN_LOCKED',
      'Polaris conversation is available on an eligible plan. Your saved customer intelligence remains read-only.',
      403
    );
  }
  throw contractError(
    'POLARIS_CONVERSATION_UNAVAILABLE',
    'Conversation is unavailable for this account. Saved customer intelligence remains read-only.',
    403
  );
}

module.exports = {
  PLAN_BILLING_HREF,
  evaluateProviderEntitlement,
  requireProviderEntitlement,
};
