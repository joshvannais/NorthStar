/* NorthStar presentation theme authority shared by every mounted page. */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'northstar-theme';
  var DARK_QUERY = '(prefers-color-scheme: dark)';
  var media = null;
  var explicitChoice = null;
  var initialized = false;

  function validTheme(value) {
    return value === 'light' || value === 'dark';
  }

  function safeStoredTheme() {
    try {
      var value = global.localStorage.getItem(STORAGE_KEY);
      return validTheme(value) ? value : null;
    } catch (_error) {
      return null;
    }
  }

  function systemTheme() {
    try {
      if (!media && typeof global.matchMedia === 'function') media = global.matchMedia(DARK_QUERY);
      return media && media.matches ? 'dark' : 'light';
    } catch (_error) {
      return 'light';
    }
  }

  function currentTheme() {
    var value = document.documentElement.getAttribute('data-theme');
    return validTheme(value) ? value : 'light';
  }

  function updateToggle(theme) {
    var button = document.querySelector('[data-northstar-theme-toggle]');
    if (!button) return;
    var dark = theme === 'dark';
    var next = dark ? 'light' : 'dark';
    button.setAttribute('aria-pressed', dark ? 'true' : 'false');
    button.setAttribute('aria-label', 'Switch to ' + next + ' theme');
    button.setAttribute('title', 'Switch to ' + next + ' theme');
    var icon = button.querySelector('[data-theme-icon]');
    var label = button.querySelector('[data-theme-label]');
    if (icon) icon.textContent = dark ? '\u2600\uFE0F' : '\uD83C\uDF19';
    if (label) label.textContent = dark ? 'Use light theme' : 'Use dark theme';
  }

  function applyTheme(theme, source) {
    var safeTheme = validTheme(theme) ? theme : 'light';
    document.documentElement.setAttribute('data-theme', safeTheme);
    document.documentElement.style.colorScheme = safeTheme;
    updateToggle(safeTheme);
    if (initialized && typeof global.CustomEvent === 'function') {
      global.dispatchEvent(new global.CustomEvent('northstar:themechange', {
        detail: { theme: safeTheme, source: source || 'presentation' },
      }));
    }
    return safeTheme;
  }

  function loadTheme() {
    explicitChoice = safeStoredTheme();
    return applyTheme(explicitChoice || systemTheme(), explicitChoice ? 'saved' : 'system');
  }

  function setTheme(theme) {
    if (!validTheme(theme)) return currentTheme();
    explicitChoice = theme;
    try { global.localStorage.setItem(STORAGE_KEY, theme); } catch (_error) {}
    return applyTheme(theme, 'explicit');
  }

  function toggleTheme() {
    return setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
  }

  function createToggle() {
    var existing = Array.prototype.slice.call(document.querySelectorAll('[data-northstar-theme-toggle], .theme-toggle'));
    for (var index = 0; index < existing.length; index += 1) existing[index].remove();
    var wrappers = Array.prototype.slice.call(document.querySelectorAll('[data-northstar-theme-control], .footer-theme-btn'));
    for (var wrapperIndex = 0; wrapperIndex < wrappers.length; wrapperIndex += 1) wrappers[wrapperIndex].remove();

    var control = document.createElement('div');
    control.className = 'northstar-theme-control';
    control.setAttribute('data-northstar-theme-control', '');
    control.innerHTML = '' +
      '<button type="button" class="theme-toggle" data-northstar-theme-toggle aria-pressed="false">' +
        '<span aria-hidden="true" data-theme-icon></span>' +
        '<span class="sr-only" data-theme-label></span>' +
      '</button>';
    document.body.appendChild(control);
    control.querySelector('button').addEventListener('click', toggleTheme);
    updateToggle(currentTheme());
  }

  function onSystemChange(event) {
    if (explicitChoice !== null) return;
    applyTheme(event && event.matches ? 'dark' : 'light', 'system');
  }

  function onStorage(event) {
    if (!event || event.key !== STORAGE_KEY) return;
    explicitChoice = validTheme(event.newValue) ? event.newValue : null;
    applyTheme(explicitChoice || systemTheme(), explicitChoice ? 'saved' : 'system');
  }

  function initialize() {
    if (initialized) return;
    initialized = true;
    createToggle();
    try {
      if (!media && typeof global.matchMedia === 'function') media = global.matchMedia(DARK_QUERY);
      if (media && typeof media.addEventListener === 'function') media.addEventListener('change', onSystemChange);
      else if (media && typeof media.addListener === 'function') media.addListener(onSystemChange);
    } catch (_error) {}
    global.addEventListener('storage', onStorage);
    updateToggle(currentTheme());
  }

  global.NorthStarTheme = Object.freeze({
    storageKey: STORAGE_KEY,
    applyTheme: applyTheme,
    getTheme: currentTheme,
    loadTheme: loadTheme,
    setTheme: setTheme,
    toggleTheme: toggleTheme,
    init: initialize,
  });

  // This file is loaded synchronously before CSS on every mounted document.
  loadTheme();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})(window);
