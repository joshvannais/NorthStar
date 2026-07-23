/**
 * One browser-session lifecycle for every dashboard page.
 * Navigation preserves the session; a real reload rotates it before data loads.
 */
(function (window) {
  'use strict';
  if (window.NorthStarDemoSession) return;

  var storageKey = 'northstarSessionId';
  var isReload = false;
  try {
    var navigationEntries = window.performance && window.performance.getEntriesByType
      ? window.performance.getEntriesByType('navigation') : [];
    isReload = navigationEntries.length > 0 && navigationEntries[0].type === 'reload';
  } catch (err) {}
  try {
    if (!isReload && window.performance && window.performance.navigation) {
      isReload = window.performance.navigation.type === 1;
    }
  } catch (err) {}

  function newId() {
    return 'sim_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
  }

  function readId() {
    try { return window.sessionStorage.getItem(storageKey); } catch (err) {}
    try {
      var match = String(window.name || '').match(/(?:^|;)northstarSessionId=([^;]+)/);
      return match ? decodeURIComponent(match[1]) : null;
    } catch (err) { return null; }
  }

  function writeId(value) {
    try {
      window.sessionStorage.setItem(storageKey, value);
      return;
    } catch (err) {}
    try {
      var retained = String(window.name || '').replace(/(?:^|;)northstarSessionId=[^;]*/g, '');
      window.name = (retained ? retained + ';' : '') + 'northstarSessionId=' + encodeURIComponent(value);
    } catch (err) {}
  }

  var id = readId();
  if (isReload || !id) {
    id = newId();
    writeId(id);
  }

  function appendToUrl(url) {
    if (!id) return url;
    if (/[?&]sessionId=/.test(url)) return url;
    return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'sessionId=' + encodeURIComponent(id);
  }

  window.SIM_SESSION_ID = id;
  window.NorthStarDemoSession = Object.freeze({
    id: id,
    isReload: isReload,
    appendToUrl: appendToUrl,
  });
})(window);
