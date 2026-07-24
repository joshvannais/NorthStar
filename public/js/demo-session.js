/**
 * One browser-session lifecycle for every dashboard page.
 * Navigation preserves the session; a real reload rotates it before data loads.
 */
(function (window) {
  'use strict';
  if (window.NorthStarDemoSession) return;

  var storageKey = 'northstarSessionId';
  var tabStorageKey = 'northstarTabId';
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

  function newTabId() {
    return 'tab_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
  }

  function readStorage(key) {
    try { return window.sessionStorage.getItem(key); } catch (err) { return null; }
  }

  function readName(key) {
    try {
      var pattern = new RegExp('(?:^|;)' + key + '=([^;]+)');
      var match = String(window.name || '').match(pattern);
      return match ? decodeURIComponent(match[1]) : null;
    } catch (err) { return null; }
  }

  function writeName(key, value) {
    try {
      var pattern = new RegExp('(?:^|;)' + key + '=[^;]*', 'g');
      var retained = String(window.name || '').replace(pattern, '').replace(/^;+|;+$/g, '');
      window.name = (retained ? retained + ';' : '') + key + '=' + encodeURIComponent(value);
    } catch (err) {}
  }

  function writeState(sessionId, tabId) {
    try {
      window.sessionStorage.setItem(storageKey, sessionId);
      window.sessionStorage.setItem(tabStorageKey, tabId);
    } catch (err) {}
    // window.name is browsing-context state. Unlike sessionStorage, it is not
    // cloned into a normal opener-created tab, so the paired tab ID detects a
    // cloned parent session without breaking same-tab or restored-tab flows.
    writeName('northstarSessionId', sessionId);
    writeName('northstarTabId', tabId);
  }

  var storedId = readStorage(storageKey);
  var namedId = readName('northstarSessionId');
  var storedTabId = readStorage(tabStorageKey);
  var namedTabId = readName('northstarTabId');
  var inheritedFromOpener = Boolean(storedTabId && storedTabId !== namedTabId);
  var tabId = inheritedFromOpener ? newTabId() : (storedTabId || namedTabId || newTabId());
  var id = inheritedFromOpener ? null : (storedId || namedId);

  if (isReload || !id) {
    id = newId();
  }
  writeState(id, tabId);

  function appendToUrl(url) {
    if (!id) return url;
    if (/[?&]sessionId=/.test(url)) return url;
    return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'sessionId=' + encodeURIComponent(id);
  }

  window.SIM_SESSION_ID = id;
  window.NorthStarDemoSession = Object.freeze({
    id: id,
    tabId: tabId,
    isReload: isReload,
    appendToUrl: appendToUrl,
  });
})(window);
