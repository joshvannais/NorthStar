/* NorthStar presentation theme authority shared by every mounted page. */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'northstar-theme';
  var DARK_QUERY = '(prefers-color-scheme: dark)';
  var media = null;
  var explicitChoice = null;
  var initialized = false;
  var dockingObserver = null;
  var themeSwitchToken = 0;

  var INTERACTIVE_SELECTOR = 'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])';

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

  function releaseThemeTransitionGuard(root, token) {
    function release() {
      if (token === themeSwitchToken) root.removeAttribute('data-theme-switching');
    }
    if (typeof global.requestAnimationFrame === 'function') {
      global.requestAnimationFrame(function () { global.requestAnimationFrame(release); });
    } else {
      global.setTimeout(release, 0);
    }
  }

  function applyTheme(theme, source) {
    var safeTheme = validTheme(theme) ? theme : 'light';
    var root = document.documentElement;
    var token = ++themeSwitchToken;
    root.setAttribute('data-theme-switching', '');
    root.setAttribute('data-theme', safeTheme);
    root.style.colorScheme = safeTheme;
    updateToggle(safeTheme);
    releaseThemeTransitionGuard(root, token);
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

  function isVisibleInteractive(element) {
    if (!element || element.closest('[data-northstar-theme-control]')) return false;
    var rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || rect.right <= 0 || rect.left >= global.innerWidth ||
        rect.bottom <= 0 || rect.top >= global.innerHeight) return false;
    for (var current = element; current; current = current.parentElement) {
      var style = global.getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    }
    return true;
  }

  function rectanglesIntersect(first, second, gap) {
    var clearance = typeof gap === 'number' ? gap : 0;
    return Math.min(first.right, second.right) - Math.max(first.left, second.left) > -clearance &&
      Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top) > -clearance;
  }

  function availableThemeSlot() {
    var slots = Array.prototype.slice.call(document.querySelectorAll('[data-northstar-theme-slot]'));
    return slots.find(function (slot) {
      for (var current = slot; current; current = current.parentElement) {
        var style = global.getComputedStyle(current);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
      }
      return true;
    }) || null;
  }

  function mountToggle(control) {
    var slot = availableThemeSlot();
    if (slot && control.parentElement !== slot) slot.appendChild(control);
    else if (!slot && control.parentElement !== document.body) document.body.appendChild(control);
    return slot;
  }

  function dockToggle() {
    var control = document.querySelector('[data-northstar-theme-control]');
    if (!control || !document.body) return;

    if (mountToggle(control)) {
      control.style.removeProperty('--northstar-theme-control-bottom');
      return;
    }

    control.style.removeProperty('--northstar-theme-control-bottom');
    var baseRect = control.getBoundingClientRect();
    if (baseRect.width <= 0 || baseRect.height <= 0) return;

    var baseBottom = Math.max(0, global.innerHeight - baseRect.bottom);
    var controls = Array.prototype.slice.call(document.querySelectorAll(INTERACTIVE_SELECTOR))
      .filter(isVisibleInteractive)
      .map(function (element) { return element.getBoundingClientRect(); });
    var step = baseRect.height + 12;
    var maximumBottom = Math.max(baseBottom, global.innerHeight - baseRect.height - 4);
    var selectedBottom = baseBottom;

    for (var candidate = baseBottom; candidate <= maximumBottom; candidate += step) {
      var candidateBottom = global.innerHeight - candidate;
      var candidateRect = {
        left: baseRect.left,
        right: baseRect.right,
        top: candidateBottom - baseRect.height,
        bottom: candidateBottom,
      };
      var blocked = controls.some(function (rect) { return rectanglesIntersect(candidateRect, rect, 4); });
      if (!blocked) {
        selectedBottom = candidate;
        break;
      }
    }

    control.style.setProperty('--northstar-theme-control-bottom', Math.round(selectedBottom) + 'px');
  }

  function scheduleDocking() {
    if (typeof global.requestAnimationFrame !== 'function') {
      dockToggle();
      return;
    }
    global.requestAnimationFrame(dockToggle);
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
    var slot = availableThemeSlot();
    (slot || document.body).appendChild(control);
    control.querySelector('button').addEventListener('click', toggleTheme);
    updateToggle(currentTheme());
    dockToggle();
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
    global.addEventListener('scroll', dockToggle, { passive: true });
    global.addEventListener('resize', scheduleDocking);
    global.addEventListener('load', scheduleDocking, { once: true });
    if (typeof global.MutationObserver === 'function' && document.body) {
      dockingObserver = new global.MutationObserver(scheduleDocking);
      dockingObserver.observe(document.body, { childList: true, subtree: true });
    }
    updateToggle(currentTheme());
    scheduleDocking();
  }

  global.NorthStarTheme = Object.freeze({
    storageKey: STORAGE_KEY,
    applyTheme: applyTheme,
    getTheme: currentTheme,
    loadTheme: loadTheme,
    setTheme: setTheme,
    toggleTheme: toggleTheme,
    refreshControlPosition: dockToggle,
    init: initialize,
  });

  // This file is loaded synchronously before CSS on every mounted document.
  loadTheme();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})(window);
