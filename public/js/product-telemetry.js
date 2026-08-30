(function (global) {
  'use strict';

  if (global.NorthStarProductTelemetry) return;
  var startedAt = Date.now();
  var signupDirty = false;
  var signupSubmitted = false;
  var pendingDeadClicks = Object.create(null);
  var pendingExitKey = 'northstar:product-telemetry:pending-exit:v1';
  var CONSENT_KEY = 'northstar_telemetry_consent_v1';

  function consentGranted() {
    try { return global.localStorage.getItem(CONSENT_KEY) === 'granted'; }
    catch (_error) { return false; }
  }

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

  function envelope(event, action) {
    var context = routeContext();
    return {
      event: event,
      surface: context.surface,
      routeClass: context.routeClass,
      action: action || 'none',
      elapsedBucket: elapsedBucket(),
    };
  }

  function postEnvelope(value) {
    try {
      global.fetch('/api/telemetry', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value),
      }).catch(function () {});
      return true;
    } catch (_) {
      return false;
    }
  }

  function send(event, action) {
    if (!consentGranted() || privacyOptOut()) return false;
    postEnvelope(envelope(event, action));
    return true;
  }

  function validPendingExit(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    var keys = Object.keys(value).sort().join('|');
    if (keys !== 'action|elapsedBucket|event|routeClass|surface') return false;
    if (value.event !== 'page_exit' && value.event !== 'signup_abandonment') return false;
    if (value.action !== 'none') return false;
    if (value.surface !== 'public' && value.surface !== 'demo' && value.surface !== 'paid') return false;
    if (!/^(?:home|faq|contact|login|signup|forgot_password|privacy|terms|refunds|legal|other_public|(?:demo|paid)_(?:command_center|polaris|leads|communications|calendar|business_profile|settings|integrations))$/.test(value.routeClass)) return false;
    return /^(?:under_15s|15s_to_60s|1m_to_5m|over_5m)$/.test(value.elapsedBucket);
  }

  function clearPendingExit() {
    try { global.sessionStorage.removeItem(pendingExitKey); } catch (_) {}
  }

  function queuePendingExit(values) {
    if (!consentGranted() || privacyOptOut()) {
      clearPendingExit();
      return;
    }
    try {
      global.sessionStorage.setItem(pendingExitKey, JSON.stringify(values.slice(0, 2)));
    } catch (_) {}
  }

  function flushPendingExit() {
    var raw = '';
    try {
      raw = global.sessionStorage.getItem(pendingExitKey) || '';
      global.sessionStorage.removeItem(pendingExitKey);
    } catch (_) {
      return;
    }
    if (!raw || raw.length > 4096 || !consentGranted() || privacyOptOut()) return;
    try {
      var values = JSON.parse(raw);
      if (!Array.isArray(values) || values.length > 2) return;
      values.filter(validPendingExit).forEach(postEnvelope);
    } catch (_) {}
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
    if (!consentGranted() || privacyOptOut()) {
      clearPendingExit();
      return;
    }
    document.addEventListener('click', onClick);
    global.addEventListener('northstar:interaction-complete', completeInteraction);
    global.addEventListener('northstar:demo-simulated', function () { send('demo_completion', 'demo_simulate_lead'); });
    global.addEventListener('pagehide', function () {
      var pending = [];
      if (signupDirty && !signupSubmitted) pending.push(envelope('signup_abandonment', 'none'));
      pending.push(envelope('page_exit', 'none'));
      queuePendingExit(pending);
    });
    global.addEventListener('pageshow', flushPendingExit);
    initializeSignupAbandonment();
    flushPendingExit();
    send('page_view', 'none');
  }

  global.NorthStarProductTelemetry = Object.freeze({ send: send, consentGranted: consentGranted });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})(window);
