(function (global) {
  'use strict';

  var account = null;
  var pendingLoad = null;
  var refreshInFlight = null;
  var logoutInFlight = null;

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

  function showVerificationStatus(next) {
    if (!document.body) return;
    var id = 'northstar-verification-status';
    var notice = document.getElementById(id);
    var pending = Boolean(next && next.user && next.user.status === 'pending_verification');
    var protectedPage = global.location.pathname === '/dashboard' || global.location.pathname.indexOf('/dashboard/') === 0;
    if (!pending || !protectedPage) {
      if (notice) notice.remove();
      return;
    }
    if (!notice) {
      notice = document.createElement('div');
      notice.id = id;
      notice.setAttribute('role', 'status');
      notice.style.cssText = 'position:relative;z-index:50;padding:10px 16px;text-align:center;background:#fff7d6;color:#5c4700;border-bottom:1px solid #ecd36a;font:600 13px/1.4 system-ui,sans-serif;';
      document.body.insertBefore(notice, document.body.firstChild);
    }
    notice.textContent = 'Email verification is pending. Your tenant dashboard and Business Profile remain available; external actions stay disabled.';
  }

  function publish(next) {
    account = next || null;
    showVerificationStatus(account);
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
    if (value.onboarding && value.onboarding.status !== 'complete') {
      return '/dashboard/business-profile';
    }
    return '/dashboard';
  }

  function guard() {
    var path = global.location.pathname;
    var protectedPage = path === '/dashboard' || path.indexOf('/dashboard/') === 0 || path === '/account/pending';
    if (!protectedPage) return Promise.resolve(null);
    return load().then(function (value) {
      // A current tenant session may load its dashboard and onboarding pages
      // regardless of email verification. Server-side action gates enforce
      // onboarding, verification, membership, role, and tenant boundaries.
      var verified = value && value.user && value.user.status === 'active';
      var incomplete = !value || !value.onboarding || value.onboarding.status !== 'complete';
      if (verified && incomplete && path !== '/dashboard/business-profile') {
        global.location.replace('/dashboard/business-profile');
      }
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

  function logoutFailureMessage(error) {
    if (error && error.code === 'csrf_invalid') {
      return 'Logout could not be confirmed. Refresh this page and try again.';
    }
    if (error && (error.status === 503 || error.code === 'account_authority_unavailable')) {
      return 'Logout could not be confirmed because the account service is temporarily unavailable. Please retry.';
    }
    return 'Logout could not be confirmed. Check your connection and try again.';
  }

  function showLogoutFailure(error) {
    if (!document.body) return;
    var status = document.getElementById('northstar-logout-status');
    if (!status) {
      status = document.createElement('div');
      status.id = 'northstar-logout-status';
      status.setAttribute('data-account-logout-error', '');
      status.setAttribute('role', 'alert');
      status.style.cssText = 'position:fixed;z-index:10000;right:16px;bottom:16px;max-width:420px;padding:12px 16px;border-radius:8px;background:#7f1d1d;color:#fff;box-shadow:0 4px 16px rgba(0,0,0,.24);font:600 14px/1.4 system-ui,sans-serif;';
      document.body.appendChild(status);
    }
    status.textContent = logoutFailureMessage(error);
    status.hidden = false;
  }

  function clearLogoutFailure() {
    var status = document.getElementById('northstar-logout-status');
    if (status) status.remove();
  }

  function logout() {
    if (logoutInFlight) return logoutInFlight;
    clearLogoutFailure();
    logoutInFlight = json('/api/auth/logout', { method: 'POST' })
      .then(function (body) {
        if (!body || body.success !== true) {
          var error = new Error('Logout was not confirmed');
          error.code = 'logout_unconfirmed';
          throw error;
        }
        publish(null);
        global.location.assign('/login');
        return true;
      })
      .catch(function (error) {
        showLogoutFailure(error);
        global.dispatchEvent(new CustomEvent('northstar:logout-failed', {
          detail: Object.freeze({
            code: error && error.code ? error.code : 'logout_unconfirmed',
            status: error && error.status ? error.status : 0,
          }),
        }));
        throw error;
      })
      .finally(function () { logoutInFlight = null; });
    return logoutInFlight;
  }

  function bindLogoutControls() {
    var root = document.documentElement;
    if (root.getAttribute('data-northstar-logout-bound') === 'true') return;
    root.setAttribute('data-northstar-logout-bound', 'true');
    document.addEventListener('click', function (event) {
      var target = event.target && event.target.closest
        ? event.target.closest('[data-account-logout]') : null;
      if (!target) return;
      event.preventDefault();
      logout().catch(function () {
        // The durable failure is already rendered and remains retryable.
      });
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      bindLogoutControls();
      guard();
    });
  } else {
    bindLogoutControls();
    guard();
  }
})(window);
