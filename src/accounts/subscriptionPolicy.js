'use strict';

const STATES = Object.freeze([
  'pending_verification', 'trialing', 'expired', 'active', 'past_due', 'canceled',
]);
const PAID_STATES = new Set(['active', 'past_due', 'canceled']);
const PLAN_KEYS = new Set(['starter', 'professional', 'enterprise']);

function timestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function utcDay(value) {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

function providerId(value, prefix) {
  return typeof value === 'string' && value.length <= 255 &&
    new RegExp('^' + prefix + '[A-Za-z0-9_]+$').test(value);
}

function unavailable(serverNow) {
  return Object.freeze({
    state: 'unavailable', trialStart: null, trialEnd: null,
    serverTimestamp: serverNow ? serverNow.toISOString() : null,
    daysRemaining: null, endsToday: false, readOnly: true,
    upgradeAvailable: false, portalAvailable: false, cancelAvailable: false,
    cancelAtPeriodEnd: false, paidThrough: null, planKey: null,
    showTrialBanner: false, safe: false, billingAuthorityVerified: false,
  });
}

function projectSubscription(authority, options = {}) {
  const source = authority && typeof authority === 'object' ? authority : {};
  const storedState = source.subscription_status || source.state;
  const serverNow = timestamp(source.server_now || source.serverTimestamp);
  const trialStart = timestamp(source.trial_started_at || source.trialStart);
  const trialEnd = timestamp(source.trial_ends_at || source.trialEnd);
  if (!STATES.includes(storedState) || !serverNow) return unavailable(serverNow);

  let state = storedState;
  let daysRemaining = null;
  let endsToday = false;
  let safe = true;
  if (storedState === 'pending_verification') {
    if (trialStart || trialEnd) safe = false;
  } else if (storedState === 'trialing') {
    if (!trialStart || !trialEnd || trialEnd.getTime() - trialStart.getTime() !== 14 * 86400000) {
      safe = false;
    } else if (serverNow.getTime() >= trialEnd.getTime()) {
      state = 'expired';
      daysRemaining = 0;
    } else {
      const calendarDifference = Math.floor((utcDay(trialEnd) - utcDay(serverNow)) / 86400000);
      daysRemaining = Math.max(1, calendarDifference);
      endsToday = calendarDifference <= 0;
    }
  }

  const verified = source.billing_authority_verified === true;
  const planKey = source.billing_plan_key || source.planKey || null;
  const customerId = source.stripe_customer_id || source.customerId;
  const subscriptionId = source.stripe_subscription_id || source.subscriptionId;
  const periodStart = timestamp(source.current_period_start || source.currentPeriodStart);
  const periodEnd = timestamp(source.current_period_end || source.currentPeriodEnd || source.paidThrough);
  if (PAID_STATES.has(state)) {
    if (!verified || !PLAN_KEYS.has(planKey) || !providerId(customerId, 'cus_') ||
        !providerId(subscriptionId, 'sub_') || !periodStart || !periodEnd ||
        periodEnd.getTime() <= periodStart.getTime()) safe = false;
  } else if (verified) {
    safe = false;
  }
  if (!safe) return unavailable(serverNow);

  const billingAvailable = options.billingAvailable === true;
  const paidThroughEnded = PAID_STATES.has(state) && serverNow.getTime() >= periodEnd.getTime();
  if (state === 'active' && paidThroughEnded) state = 'expired';
  const readOnly = state === 'expired' || (PAID_STATES.has(state) && paidThroughEnded);
  const upgradeAvailable = billingAvailable && ['trialing', 'expired'].includes(state) && !subscriptionId;
  const portalAvailable = billingAvailable && !readOnly && providerId(customerId, 'cus_');
  const cancelAtPeriodEnd = source.cancel_at_period_end === true || source.cancelAtPeriodEnd === true;
  return Object.freeze({
    state,
    trialStart: trialStart ? trialStart.toISOString() : null,
    trialEnd: trialEnd ? trialEnd.toISOString() : null,
    serverTimestamp: serverNow.toISOString(),
    daysRemaining,
    endsToday,
    readOnly,
    upgradeAvailable,
    portalAvailable,
    cancelAvailable: billingAvailable && !readOnly && verified && !cancelAtPeriodEnd &&
      ['active', 'past_due'].includes(state),
    cancelAtPeriodEnd,
    paidThrough: periodEnd ? periodEnd.toISOString() : null,
    planKey: verified ? planKey : null,
    showTrialBanner: state === 'trialing',
    safe: true,
    billingAuthorityVerified: verified,
  });
}

function canMutateInternal(projection, options = {}) {
  if (!projection || projection.safe !== true || projection.readOnly === true) return false;
  if (projection.state === 'trialing' || PAID_STATES.has(projection.state)) return true;
  return options.allowPending === true && projection.state === 'pending_verification';
}

function canPerformExternal(projection) {
  return Boolean(projection && projection.safe === true && projection.readOnly !== true &&
    (projection.state === 'trialing' || PAID_STATES.has(projection.state)));
}

module.exports = {
  STATES,
  canMutateInternal,
  canPerformExternal,
  projectSubscription,
};
