'use strict';
const { projectSubscription, canPerformExternal } = require('../accounts/subscriptionPolicy');
const { contractError } = require('./assistantContract');
// Reuse external-action authority; bind stable policy inputs, never assessment clock.
function requireCurrentSubscription(row, now = row.server_now) {
  const subscription = projectSubscription({ ...row, server_now: now });
  if (!canPerformExternal(subscription)) throw contractError('POLARIS_SUBSCRIPTION_READ_ONLY',
    'Conversation is unavailable with the current subscription. Your saved records remain available. Ask an owner or administrator to review subscription settings.', 403);
  return { state: subscription.state, trialStart: subscription.trialStart, trialEnd: subscription.trialEnd };
}
module.exports = { requireCurrentSubscription };
