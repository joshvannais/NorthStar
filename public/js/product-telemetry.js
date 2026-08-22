(function (global) {
  'use strict';

  if (global.NorthStarProductTelemetry) return;
  var startedAt = Date.now();
  var signupDirty = false;
  var signupSubmitted = false;
  var pendingDeadClicks = Object.create(null);

  function privacyOptOut() {
    var dnt = String(global.navigator.doNotTrack || global.doNotTrack || '').toLowerCase();
    return global.navigator.globalPrivacyControl === true || dnt === '1' || dnt === 'yes';
  }

  function routeContext() {
    var path = global.location.pathname.replace(/\/$/, '') || '/';
    var publicRoutes = {
      '/': 'home', '/faq': 'faq', '/contact': 'contact', '/login': 'login',
      '/signup': 'signup', '/forgot-password': 'forgot_password', '/privacy': 'privacy',
      '/terms': 'terms', '/refund': 'refunds', '/legal': 'legal',
    };
    if (publicRoutes[path]) return { surface: 'public', routeClass: publicRoutes[path] };
    var prefix = path.indexOf('/demo') === 0 ? '/demo' : path.indexOf('/dashboard') === 0 ? '/dashboard' : '';
    if (!prefix) return { surface: 'public', routeClass: 'other_public' };
    var suffix = path.slice(prefix.length).replace(/^\//, '') || 'command-center';
    if (suffix === 'demo-dashboard') suffix = 'command-center';
    var known = {
      'command-center': 'command_center', 'polaris': 'polaris', 'leads': 'leads',
      'communications': 'communications', 'calendar': 'calendar',
      'business-profile': 'business_profile', 'settings': 'settings', 'integrations': 'integrations',
    };
    return {
      surface: prefix === '/demo' ? 'demo' : 'paid',
      routeClass: (prefix === '/demo' ? 'demo_' : 'paid_') + (known[suffix] || 'command_center'),
    };
  }

  function elapsedBucket() {
    var elapsed = Date.now() - startedAt;
    if (elapsed < 15000) return 'under_15s';
    if (elapsed < 60000) return '15s_to_60s';
    if (elapsed < 300000) return '1m_to_5m';
    return 'over_5m';
  }

  function send(event, action, keepalive) {
    if (privacyOptOut()) return false;
    var context = routeContext();
    var payload = JSON.stringify({
      event: event,
      surface: context.surface,
      routeClass: context.routeClass,
      action: action || 'none',
      elapsedBucket: elapsedBucket(),
    });
    if (keepalive && typeof global.navigator.sendBeacon === 'function') {
      return global.navigator.sendBeacon('/api/telemetry', new Blob([payload], { type: 'application/json' }));
    }
    global.fetch('/api/telemetry', {
      method: 'POST', credentials: 'same-origin', keepalive: Boolean(keepalive),
      headers: { 'Content-Type': 'application/json' }, body: payload,
    }).catch(function () {});
    return true;
  }

  function actionFor(element) {
    return element && element.dataset && element.dataset.telemetryAction || '';
  }

  function onClick(event) {
    var element = event.target && event.target.closest && event.target.closest('[data-telemetry-action]');
    var action = actionFor(element);
    if (!action) return;
    send('cta_click', action, false);
    if (!element.hasAttribute('data-telemetry-dead-click')) return;
    global.clearTimeout(pendingDeadClicks[action]);
    pendingDeadClicks[action] = global.setTimeout(function () {
      send('dead_click', action, false);
      delete pendingDeadClicks[action];
    }, 8000);
  }

  function completeInteraction(event) {
    var action = event && event.detail && event.detail.action;
    if (!action || !pendingDeadClicks[action]) return;
    global.clearTimeout(pendingDeadClicks[action]);
    delete pendingDeadClicks[action];
  }

  function initializeSignupAbandonment() {
    var form = document.getElementById('signupForm');
    if (!form) return;
    form.addEventListener('input', function () { signupDirty = true; });
    global.addEventListener('northstar:signup-complete', function () { signupSubmitted = true; });
  }

  function initialize() {
    if (privacyOptOut()) return;
    document.addEventListener('click', onClick);
    global.addEventListener('northstar:interaction-complete', completeInteraction);
    global.addEventListener('northstar:demo-simulated', function () { send('demo_completion', 'demo_simulate_lead', true); });
    global.addEventListener('pagehide', function () {
      if (signupDirty && !signupSubmitted) send('signup_abandonment', 'none', true);
      send('page_exit', 'none', true);
    });
    initializeSignupAbandonment();
    send('page_view', 'none', false);
  }

  global.NorthStarProductTelemetry = Object.freeze({ send: send });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})(window);
