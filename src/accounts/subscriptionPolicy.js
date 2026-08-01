'use strict';

const STATES = Object.freeze([
  'pending_verification', 'trialing', 'expired', 'active', 'past_due', 'canceled',
]);

function timestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function utcDay(value) {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

function projectSubscription(authority) {
  const source = authority && typeof authority === 'object' ? authority : {};
  const storedState = source.subscription_status || source.state;
  const serverNow = timestamp(source.server_now || source.serverTimestamp);
  const trialStart = timestamp(source.trial_started_at || source.trialStart);
  const trialEnd = timestamp(source.trial_ends_at || source.trialEnd);
  if (!STATES.includes(storedState) || !serverNow) {
    return Object.freeze({
      state: 'unavailable', trialStart: null, trialEnd: null,
      serverTimestamp: serverNow ? serverNow.toISOString() : null,
      daysRemaining: null, endsToday: false, readOnly: true,
      upgradeAvailable: false, showTrialBanner: false, safe: false,
    });
  }

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

  if (!safe) {
    return Object.freeze({
      state: 'unavailable', trialStart: null, trialEnd: null,
      serverTimestamp: serverNow.toISOString(), daysRemaining: null,
      endsToday: false, readOnly: true, upgradeAvailable: false,
      showTrialBanner: false, safe: false,
    });
  }

  const readOnly = ['expired', 'past_due', 'canceled'].includes(state);
  return Object.freeze({
    state,
    trialStart: trialStart ? trialStart.toISOString() : null,
    trialEnd: trialEnd ? trialEnd.toISOString() : null,
    serverTimestamp: serverNow.toISOString(),
    daysRemaining,
    endsToday,
    readOnly,
    upgradeAvailable: false,
    showTrialBanner: state === 'trialing',
    safe: true,
  });
}

function canMutateInternal(projection, options = {}) {
  if (!projection || projection.safe !== true) return false;
  if (projection.state === 'active' || projection.state === 'trialing') return true;
  return options.allowPending === true && projection.state === 'pending_verification';
}

function canPerformExternal(projection) {
  return Boolean(projection && projection.safe === true &&
    (projection.state === 'active' || projection.state === 'trialing'));
}

module.exports = {
  STATES,
  canMutateInternal,
  canPerformExternal,
  projectSubscription,
};
