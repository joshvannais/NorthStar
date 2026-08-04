(function (global) {
  'use strict';

  var root = null;
  var status = null;
  var actions = null;
  var inFlight = false;
  var PLAN_NAMES = Object.freeze({
    starter: 'Starter — $99/month',
    professional: 'Professional — $199/month',
    enterprise: 'Enterprise — $299/month',
  });

  function fixedSettingsUrl() {
    return '/dashboard/settings#subscription-billing';
  }

  function clearReturnClaim() {
    if (global.location.pathname !== '/dashboard/settings') return;
    var query = new URLSearchParams(global.location.search);
    if (!query.has('billing')) return;
    global.history.replaceState(null, '', fixedSettingsUrl());
  }

  function button(label, action, className) {
    var element = document.createElement('button');
    element.type = 'button';
    element.className = className || 'btn btn-primary btn-sm';
    element.textContent = label;
    element.addEventListener('click', action);
    actions.appendChild(element);
    return element;
  }

  function setBusy(value) {
    inFlight = value;
    Array.prototype.forEach.call(actions.querySelectorAll('button'), function (element) {
      element.disabled = value;
    });
  }

  function safeDestination(value, expectedHost) {
    try {
      var parsed = new URL(value);
      return parsed.protocol === 'https:' && parsed.hostname === expectedHost &&
        !parsed.username && !parsed.password && !parsed.hash ? parsed.href : null;
    } catch (_error) {
      return null;
    }
  }

  function failure(error) {
    status.textContent = error && error.message
      ? error.message
      : 'Billing is temporarily unavailable. No account access was changed.';
    status.setAttribute('role', 'alert');
    setBusy(false);
  }

  function checkout(planKey) {
    if (inFlight || !PLAN_NAMES[planKey]) return;
    setBusy(true);
    NorthStarAccountSession.json('/api/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planKey: planKey }),
    }).then(function (body) {
      var destination = safeDestination(body && body.checkout && body.checkout.url, 'checkout.stripe.com');
      if (!destination || body.activationPendingWebhook !== true) throw new Error('Checkout response was unavailable');
      global.location.assign(destination);
    }).catch(failure);
  }

  function portal() {
    if (inFlight) return;
    setBusy(true);
    NorthStarAccountSession.json('/api/billing/portal', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }).then(function (body) {
      var destination = safeDestination(body && body.portal && body.portal.url, 'billing.stripe.com');
      if (!destination) throw new Error('Billing portal response was unavailable');
      global.location.assign(destination);
    }).catch(failure);
  }

  function cancel() {
    if (inFlight || !global.confirm(
      'Cancel at the end of the current paid billing period? Access continues through that period and there is no partial monthly refund.'
    )) return;
    setBusy(true);
    NorthStarAccountSession.json('/api/billing/cancel', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }).then(function (body) {
      if (!body || !body.cancellation) throw new Error('Cancellation response was unavailable');
      status.textContent = body.cancellation.confirmationPendingWebhook
        ? 'Cancellation was requested. Access remains unchanged until signed billing confirmation arrives.'
        : 'Cancellation is already scheduled for the end of the paid billing period.';
      status.setAttribute('role', 'status');
      setBusy(false);
      return refresh();
    }).catch(failure);
  }

  function date(value) {
    var parsed = value ? new Date(value) : null;
    return parsed && Number.isFinite(parsed.getTime())
      ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(parsed)
      : 'the recorded paid period';
  }

  function render(subscription) {
    actions.replaceChildren();
    status.setAttribute('role', 'status');
    if (!subscription || subscription.safe !== true || subscription.state === 'unavailable') {
      status.textContent = 'Subscription authority is unavailable. Billing actions are disabled for safety.';
      status.setAttribute('role', 'alert');
      return;
    }
    if (subscription.state === 'pending_verification') {
      status.textContent = 'Verify the owner email before choosing a monthly plan.';
      return;
    }
    if (subscription.readOnly === true && subscription.billingAuthorityVerified === true) {
      status.textContent = subscription.state === 'past_due'
        ? 'Payment is past due and the paid-through period has ended. Billing actions are unavailable in read-only mode.'
        : subscription.state === 'canceled'
          ? 'The subscription is canceled and the paid-through period has ended. Billing actions are unavailable in read-only mode.'
          : 'The authoritative paid-through period has ended. Subscription access is read-only and billing actions are unavailable.';
      status.setAttribute('role', 'alert');
      return;
    }
    if (subscription.state === 'trialing' || subscription.state === 'expired') {
      status.textContent = subscription.upgradeAvailable
        ? 'Choose one monthly plan. Access changes only after a signed paid invoice is reconciled.'
        : 'Billing setup is temporarily unavailable. No payment action can be started.';
      if (subscription.upgradeAvailable) {
        Object.keys(PLAN_NAMES).forEach(function (planKey) {
          button(PLAN_NAMES[planKey], function () { checkout(planKey); });
        });
      }
      return;
    }
    var plan = PLAN_NAMES[subscription.planKey] || 'Monthly subscription';
    if (subscription.state === 'active') {
      status.textContent = subscription.cancelAtPeriodEnd
        ? plan + ' is canceled at period end. Access continues through ' + date(subscription.paidThrough) + '.'
        : plan + ' is active through ' + date(subscription.paidThrough) + '.';
    } else if (subscription.state === 'past_due') {
      status.textContent = subscription.readOnly
        ? 'Payment is past due and the paid-through period has ended. Update billing details to restore access.'
        : 'Payment is past due. Access continues only through ' + date(subscription.paidThrough) + '.';
    } else if (subscription.state === 'canceled') {
      status.textContent = subscription.readOnly
        ? 'The subscription is canceled and the paid-through period has ended.'
        : 'The subscription is canceled. Access continues through ' + date(subscription.paidThrough) + '.';
    }
    if (subscription.portalAvailable) button('Manage billing', portal, 'btn btn-secondary btn-sm');
    if (subscription.cancelAvailable) button('Cancel at period end', cancel, 'btn btn-ghost btn-sm');
  }

  function refresh() {
    return NorthStarAccountSession.json('/api/account/subscription', { method: 'GET', cache: 'no-store' })
      .then(function (body) { render(body && body.subscription); return body && body.subscription; })
      .catch(failure);
  }

  function init() {
    root = document.getElementById('subscription-billing');
    status = document.getElementById('subscription-billing-status');
    actions = document.getElementById('subscription-billing-actions');
    if (!root || !status || !actions || !global.NorthStarAccountSession) return;
    clearReturnClaim();
    refresh();
  }

  global.NorthStarBillingSettings = Object.freeze({ init: init, refresh: refresh });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})(window);
