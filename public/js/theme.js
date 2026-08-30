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
  var telemetryRequested = false;

  var SHARED_FOOTER_LINKS = [
    { label: 'Home', href: '/' },
    { label: 'How It Works', href: '/#how-it-works' },
    { label: 'Pricing', href: '/#pricing' },
    { label: 'FAQ', href: '/faq' },
    { label: 'Contact', href: '/contact' },
    { label: 'Privacy', href: '/privacy' },
    { label: 'Terms', href: '/terms' },
    { label: 'Refunds', href: '/refund' },
    { label: 'Legal', href: '/legal' },
  ];

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
    button.setAttribute('aria-label', 'Current theme: ' + theme + '. Switch to ' + next + ' theme');
    button.setAttribute('title', 'Current theme: ' + theme + '. Switch to ' + next + ' theme');
    button.setAttribute('data-current-theme', theme);
    var label = button.querySelector('[data-theme-label]');
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
      '<button type="button" class="theme-toggle northstar-theme-switch" data-northstar-theme-toggle aria-pressed="false">' +
        '<span class="northstar-theme-icons" aria-hidden="true" data-theme-icon>' +
          '<span class="northstar-theme-sun"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"/></svg></span>' +
          '<span class="northstar-theme-moon"><svg viewBox="0 0 24 24"><path d="M20.4 15.1A8.5 8.5 0 0 1 8.9 3.6 8.5 8.5 0 1 0 20.4 15.1Z"/></svg></span>' +
        '</span>' +
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

  function shouldInstallSharedFooter() {
    var pathname = global.location && global.location.pathname ? global.location.pathname : '/';
    return pathname.indexOf('/admin') !== 0 &&
      pathname.indexOf('/previews') !== 0 &&
      pathname.indexOf('/design-system') !== 0;
  }

  function installSharedFooter() {
    if (!shouldInstallSharedFooter() || !document.body) return;

    var footer = document.querySelector('[data-northstar-site-footer], footer.footer, footer.demo-dashboard-footer');
    var created = !footer;
    if (!footer) footer = document.createElement('footer');
    footer.classList.add('footer', 'northstar-site-footer');
    footer.setAttribute('data-northstar-site-footer', '');

    while (footer.firstChild) footer.removeChild(footer.firstChild);

    var navigation = document.createElement('nav');
    navigation.className = 'footer-links';
    navigation.setAttribute('aria-label', 'NorthStar information');
    SHARED_FOOTER_LINKS.forEach(function (item) {
      var link = document.createElement('a');
      link.href = item.href;
      link.textContent = item.label;
      navigation.appendChild(link);
    });

    var copyright = document.createElement('p');
    copyright.textContent = '© 2026 NorthStar Solutions LLC. All rights reserved.';
    footer.appendChild(navigation);
    footer.appendChild(copyright);

    if (created) {
      var dashboardMain = document.querySelector('.main-content');
      (dashboardMain || document.body).appendChild(footer);
    }
  }

  function initialize() {
    if (initialized) return;
    initialized = true;
    installSharedFooter();
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
    // Employee Today is a deliberately minimized bundle. The shared product
    // telemetry client contains broad operator route classifications that are
    // not needed to render or authorize this surface, so Today does not fetch
    // that otherwise unchanged shared script.
    var employeeMinimized = document.body && document.body.classList.contains('today-page');
    if (!telemetryRequested && !employeeMinimized) {
      telemetryRequested = true;
      var telemetry = document.createElement('script');
      telemetry.src = '/js/product-telemetry.js';
      telemetry.defer = true;
      document.head.appendChild(telemetry);
    }
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
