(function (global) {
  'use strict';

  var initialized = false;
  var listenerAttached = false;
  var refreshTimer = null;
  var requestInFlight = null;
  var BANNER_ID = 'northstar-trial-status';
  var STYLE_ID = 'northstar-trial-status-style';

  function removeBanner() {
    var existing = document.getElementById(BANNER_ID);
    if (existing) existing.remove();
  }

  function style() {
    if (document.getElementById(STYLE_ID)) return;
    var element = document.createElement('style');
    element.id = STYLE_ID;
    element.textContent = '' +
      '#' + BANNER_ID + '{position:relative;z-index:900;box-sizing:border-box;margin-left:240px;width:calc(100% - 240px);padding:10px 18px;display:flex;align-items:center;justify-content:center;gap:10px;text-align:center;font:600 14px/1.4 system-ui,sans-serif;border-bottom:1px solid transparent;box-shadow:0 1px 0 rgba(15,23,42,.04);}' +
      '#' + BANNER_ID + '[data-state="trialing"]{background:linear-gradient(90deg,#fff8e7,#fffbf2);color:#5c4506;border-color:#d4af37;}' +
      '#' + BANNER_ID + '[data-state="pending_verification"]{background:#fff7d6;color:#5c4700;border-color:#ecd36a;}' +
      '#' + BANNER_ID + '[data-state="restricted"],#' + BANNER_ID + '[data-state="unavailable"]{background:#fff7ed;color:#7c2d12;border-color:#fdba74;}' +
      '#' + BANNER_ID + ' .northstar-trial-support{font-weight:500;color:inherit;opacity:.82;}' +
      '#' + BANNER_ID + ' button{border:1px solid currentColor;border-radius:6px;background:transparent;color:inherit;padding:5px 10px;font:inherit;cursor:pointer;}' +
      '#' + BANNER_ID + ' button:focus-visible{outline:3px solid #2563eb;outline-offset:2px;}' +
      '@media(max-width:768px){#' + BANNER_ID + '{margin-left:0;width:100%;padding:9px 12px;flex-direction:column;gap:3px;font-size:13px;}}';
    document.head.appendChild(element);
  }

  function banner(state, message, role) {
    style();
    var element = document.getElementById(BANNER_ID);
    if (!element) {
      element = document.createElement('section');
      element.id = BANNER_ID;
      document.body.insertBefore(element, document.body.firstChild);
    }
    element.setAttribute('data-state', state);
    element.setAttribute('role', role || 'status');
    element.setAttribute('aria-live', role === 'alert' ? 'assertive' : 'polite');
    element.setAttribute('aria-atomic', 'true');
    element.replaceChildren(document.createTextNode(message));
    return element;
  }

  function scheduleRefresh(subscription) {
    if (refreshTimer) global.clearTimeout(refreshTimer);
    refreshTimer = null;
    if (!subscription || !subscription.serverTimestamp) return;
    var serverNow = new Date(subscription.serverTimestamp).getTime();
    if (!Number.isFinite(serverNow)) return;
    var nextDay = new Date(subscription.serverTimestamp);
    nextDay.setUTCHours(24, 0, 0, 0);
    var delay = nextDay.getTime() - serverNow;
    if (subscription.state === 'trialing' && subscription.trialEnd) {
      var trialEnd = new Date(subscription.trialEnd).getTime();
      if (Number.isFinite(trialEnd)) delay = Math.min(delay, Math.max(1, trialEnd - serverNow));
    }
    if (subscription.paidThrough) {
      var paidThrough = new Date(subscription.paidThrough).getTime();
      if (Number.isFinite(paidThrough) && paidThrough > serverNow) {
        delay = Math.min(delay, Math.max(1, paidThrough - serverNow));
      }
    }
    refreshTimer = global.setTimeout(refresh, Math.max(1000, Math.min(delay + 250, 86400250)));
  }

  function billingLink(element, label) {
    var link = document.createElement('a');
    link.href = '/dashboard/settings#subscription-billing';
    link.textContent = label;
    link.style.color = 'inherit';
    link.style.fontWeight = '700';
    link.addEventListener('click', function (event) {
      if (global.location.pathname === '/dashboard/settings') {
        event.preventDefault();
        var target = document.getElementById('subscription-billing');
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
    element.appendChild(link);
  }

  function resend(button) {
    button.disabled = true;
    global.NorthStarAccountSession.fetch('/api/auth/resend-verification', { method: 'POST' })
      .then(function (response) {
        if (!response.ok) throw new Error('resend failed');
        button.textContent = 'Verification sent';
      })
      .catch(function () {
        button.disabled = false;
        button.textContent = 'Try resend again';
      });
  }

  function render(subscription) {
    if (!subscription || subscription.safe !== true || subscription.state === 'unavailable') {
      banner('unavailable', 'Subscription status is unavailable. Access is restricted for safety.', 'alert');
      scheduleRefresh(subscription);
      return;
    }
    if (subscription.state === 'active') {
      removeBanner();
      scheduleRefresh(null);
      return;
    }
    if (subscription.state === 'pending_verification') {
      var pending = banner(
        'pending_verification',
        'Verify your email to begin the organization\'s 14-day trial. Trial time has not started.',
        'status'
      );
      var resendButton = document.createElement('button');
      resendButton.type = 'button';
      resendButton.textContent = 'Resend verification';
      resendButton.addEventListener('click', function () { resend(resendButton); });
      pending.appendChild(resendButton);
      scheduleRefresh(subscription);
      return;
    }
    if (subscription.state === 'trialing') {
      var message = subscription.endsToday
        ? 'Trial ends today.'
        : subscription.daysRemaining + ' days remaining in your trial.';
      var trial = banner('trialing', message, 'status');
      var support = document.createElement('span');
      support.className = 'northstar-trial-support';
      support.textContent = 'Enjoy full access during your trial.';
      trial.appendChild(support);
      if (subscription.upgradeAvailable) billingLink(trial, 'Choose a monthly plan');
      scheduleRefresh(subscription);
      return;
    }
    var restricted = banner(
      'restricted',
      subscription.state === 'past_due'
        ? 'Payment is past due. Access follows the authoritative paid-through period.'
        : subscription.state === 'canceled'
          ? 'The subscription is canceled. Access follows the authoritative paid-through period.'
          : 'Your trial has ended. Your organization remains available in restricted read-only mode.',
      'alert'
    );
    if (subscription.upgradeAvailable) billingLink(restricted, 'Choose a monthly plan');
    else if (subscription.portalAvailable) billingLink(restricted, 'Manage billing');
    scheduleRefresh(subscription);
  }

  function refresh() {
    if (requestInFlight) return requestInFlight;
    if (!global.NorthStarAccountSession) return Promise.resolve(null);
    requestInFlight = global.NorthStarAccountSession.fetch('/api/account/subscription', {
      method: 'GET', cache: 'no-store'
    }).then(function (response) {
      if (!response.ok) throw new Error('subscription unavailable');
      return response.json();
    }).then(function (body) {
      render(body && body.subscription);
      return body && body.subscription;
    }).catch(function () {
      render(null);
      return null;
    }).finally(function () { requestInFlight = null; });
    return requestInFlight;
  }

  function init() {
    if (initialized) return refresh();
    initialized = true;
    if (!listenerAttached) {
      global.addEventListener('northstar:account', refresh);
      listenerAttached = true;
    }
    return refresh();
  }

  global.NorthStarTrialStatus = Object.freeze({ init: init, refresh: refresh });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})(window);
