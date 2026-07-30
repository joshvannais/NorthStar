(function (global) {
  'use strict';

  var account = null;
  var pendingLoad = null;
  var refreshInFlight = null;

  function cookie(name) {
    var prefix = name + '=';
    var parts = String(document.cookie || '').split(';');
    for (var index = 0; index < parts.length; index += 1) {
      var item = parts[index].trim();
      if (item.indexOf(prefix) === 0) {
        try { return decodeURIComponent(item.slice(prefix.length)); } catch (_error) { return item.slice(prefix.length); }
      }
    }
    return '';
  }

  function isUnsafe(method) {
    return ['GET', 'HEAD', 'OPTIONS'].indexOf(String(method || 'GET').toUpperCase()) < 0;
  }

  function optionsWithSession(options) {
    var next = Object.assign({}, options || {});
    next.method = String(next.method || 'GET').toUpperCase();
    next.credentials = 'same-origin';
    next.headers = Object.assign({}, next.headers || {});
    if (isUnsafe(next.method)) {
      var csrf = cookie('northstar_csrf');
      if (csrf) next.headers['X-CSRF-Token'] = csrf;
    }
    return next;
  }

  function responseCode(response) {
    return response.clone().json().then(function (body) { return body && body.code; }).catch(function () { return null; });
  }

  function refresh() {
    if (refreshInFlight) return refreshInFlight;
    var csrf = cookie('northstar_csrf');
    if (!csrf) return Promise.reject(new Error('No refreshable browser session'));
    refreshInFlight = global.fetch('/api/auth/refresh', optionsWithSession({ method: 'POST' }))
      .then(function (response) {
        if (!response.ok) throw new Error('Browser session refresh failed');
        return true;
      })
      .finally(function () { refreshInFlight = null; });
    return refreshInFlight;
  }

  function request(url, options) {
    var prepared = optionsWithSession(options);
    return global.fetch(url, prepared).then(function (response) {
      if (response.status !== 401 || String(url).indexOf('/api/auth/refresh') === 0 || prepared.__retried) {
        return response;
      }
      return responseCode(response).then(function (code) {
        if (code !== 'access_expired' && code !== 'invalid_token' && code !== 'session_inactive') return response;
        return refresh().then(function () {
          var retry = optionsWithSession(options);
          retry.__retried = true;
          delete retry.__retried;
          return global.fetch(url, retry);
        }).catch(function () { return response; });
      });
    });
  }

  function json(url, options) {
    return request(url, options).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        if (!response.ok) {
          var error = new Error(body.error || 'Request failed');
          error.code = body.code || 'request_failed';
          error.status = response.status;
          error.requestId = body.requestId || response.headers.get('X-Request-ID');
          throw error;
        }
        return body;
      });
    });
  }

  function publish(next) {
    account = next || null;
    global.dispatchEvent(new CustomEvent('northstar:account', { detail: account }));
    return account;
  }

  function load(force) {
    if (account && !force) return Promise.resolve(account);
    if (pendingLoad && !force) return pendingLoad;
    pendingLoad = json('/api/auth/me', { method: 'GET', cache: 'no-store' })
      .then(function (body) { return publish(body.account); })
      .catch(function (error) { publish(null); throw error; })
      .finally(function () { pendingLoad = null; });
    return pendingLoad;
  }

  function destination(value) {
    if (!value || !value.user) return '/login';
    if (value.user.status === 'pending_verification') return '/account/pending';
    if (value.onboarding && value.onboarding.status === 'business_profile_required') {
      return '/dashboard/business-profile';
    }
    return '/dashboard';
  }

  function guard() {
    var path = global.location.pathname;
    var protectedPage = path === '/dashboard' || path.indexOf('/dashboard/') === 0 || path === '/account/pending';
    if (!protectedPage) return Promise.resolve(null);
    return load().then(function (value) {
      var target = destination(value);
      var allowedBusinessProfile = path === '/dashboard/business-profile' && target === '/dashboard/business-profile';
      var allowedPending = path === '/account/pending' && target === '/account/pending';
      var completeDashboard = target === '/dashboard' && (path === '/dashboard' || path.indexOf('/dashboard/') === 0);
      if (!allowedBusinessProfile && !allowedPending && !completeDashboard) global.location.replace(target);
      return value;
    }).catch(function () {
      if (path !== '/login') global.location.replace('/login');
      return null;
    });
  }

  function login(email, password) {
    return json('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: password }),
    }).then(function () { return load(true); });
  }

  function signup(input) {
    return json('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }).then(function () { return load(true); });
  }

  function logout() {
    return json('/api/auth/logout', { method: 'POST' })
      .catch(function () { return null; })
      .then(function () {
        publish(null);
        global.location.assign('/login');
      });
  }

  global.NorthStarAccountSession = Object.freeze({
    destination: destination,
    fetch: request,
    getAccount: function () { return account; },
    guard: guard,
    json: json,
    load: load,
    login: login,
    logout: logout,
    prepareXhr: function (xhr, method) {
      xhr.withCredentials = true;
      if (isUnsafe(method)) {
        var csrf = cookie('northstar_csrf');
        if (csrf) xhr.setRequestHeader('X-CSRF-Token', csrf);
      }
      return xhr;
    },
    signup: signup,
  });

  if (typeof global.showToast !== 'function') {
    global.showToast = function (message) {
      var element = document.getElementById('toast');
      if (!element) return;
      element.textContent = message;
      element.className = 'toast show';
      global.setTimeout(function () { element.classList.remove('show'); }, 3500);
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', guard);
  else guard();
})(window);
