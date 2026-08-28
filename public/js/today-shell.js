(function(global) {
  'use strict';

  var TODAY_PATH = '/dashboard/today';
  var LOGIN_PATH = '/login';
  var LOGOUT_PATH = '/api/auth/logout';
  var logoutInFlight = null;
  var overflowBeforeMenu = '';

  function node(tag, className, text) {
    var value = document.createElement(tag);
    if (className) value.className = className;
    if (text !== undefined) value.textContent = text;
    return value;
  }

  function image() {
    var value = node('img');
    value.src = '/assets/logo.png';
    value.alt = '';
    return value;
  }

  function calendarIcon() {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('aria-hidden', 'true');
    var paths = [
      ['path', { d: 'M8 2v4' }], ['path', { d: 'M16 2v4' }],
      ['rect', { x: '3', y: '5', width: '18', height: '16', rx: '2' }],
      ['path', { d: 'M3 10h18' }], ['path', { d: 'm9 16 2 2 4-5' }],
    ];
    paths.forEach(function(specification) {
      var child = document.createElementNS('http://www.w3.org/2000/svg', specification[0]);
      Object.keys(specification[1]).forEach(function(key) { child.setAttribute(key, specification[1][key]); });
      svg.appendChild(child);
    });
    return svg;
  }

  function todayLink() {
    var link = node('a');
    link.href = TODAY_PATH;
    link.dataset.navId = 'today';
    link.className = 'active';
    link.setAttribute('aria-current', 'page');
    link.appendChild(calendarIcon());
    link.appendChild(node('span', '', 'Today'));
    return link;
  }

  function logoutIcon() {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('aria-hidden', 'true');
    var paths = [
      ['path', { d: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4' }],
      ['path', { d: 'm16 17 5-5-5-5' }],
      ['path', { d: 'M21 12H9' }],
    ];
    paths.forEach(function(specification) {
      var child = document.createElementNS('http://www.w3.org/2000/svg', specification[0]);
      Object.keys(specification[1]).forEach(function(key) { child.setAttribute(key, specification[1][key]); });
      svg.appendChild(child);
    });
    return svg;
  }

  function signOutButton() {
    var button = node('button', 'today-sign-out');
    button.type = 'button';
    button.dataset.todayLogout = '';
    button.setAttribute('aria-label', 'Sign Out');
    button.appendChild(logoutIcon());
    button.appendChild(node('span', '', 'Sign Out'));
    return button;
  }

  function brand() {
    var link = node('a', 'northstar-lockup');
    link.href = TODAY_PATH;
    link.appendChild(image());
    link.appendChild(node('span', '', 'NorthStar'));
    return link;
  }

  function buildSidebar() {
    var sidebar = node('aside', 'sidebar');
    var logo = brand();
    logo.classList.add('sidebar-logo');
    logo.querySelector('img').classList.add('logo-img');
    var navigation = node('nav', 'sidebar-nav');
    navigation.setAttribute('aria-label', 'Today navigation');
    navigation.appendChild(todayLink());
    var footer = node('div', 'sidebar-footer');
    footer.appendChild(signOutButton());
    var theme = node('span', 'northstar-theme-slot');
    theme.dataset.northstarThemeSlot = '';
    theme.dataset.northstarThemeLocation = 'desktop';
    theme.setAttribute('aria-label', 'Theme controls');
    footer.appendChild(theme);
    sidebar.append(logo, navigation, footer);
    return sidebar;
  }

  function buildMobile() {
    var fragment = document.createDocumentFragment();
    var header = node('div', 'mobile-header');
    header.dataset.northstarFixedHeader = '';
    var toggle = node('button', 'hamburger-btn', 'NorthStar');
    toggle.type = 'button';
    toggle.id = 'todayMenuToggle';
    toggle.setAttribute('aria-controls', 'todayMobileMenu');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open navigation menu');
    var headerActions = node('div', 'mobile-header-actions');
    var logo = image();
    logo.alt = 'NorthStar';
    logo.className = 'mobile-logo';
    headerActions.appendChild(logo);
    var theme = node('span', 'northstar-theme-slot');
    theme.dataset.northstarThemeSlot = '';
    theme.dataset.northstarThemeLocation = 'mobile';
    theme.setAttribute('aria-label', 'Theme controls');
    headerActions.appendChild(theme);
    header.append(toggle, headerActions);

    var overlay = node('div', 'mobile-overlay');
    overlay.id = 'todayMobileOverlay';
    overlay.setAttribute('aria-hidden', 'true');
    var menu = node('div', 'mobile-menu');
    menu.id = 'todayMobileMenu';
    menu.setAttribute('aria-hidden', 'true');
    menu.setAttribute('inert', '');
    var menuHeader = node('div', 'mobile-menu-header');
    menuHeader.appendChild(brand());
    var close = node('button', 'mobile-menu-close', '×');
    close.type = 'button';
    close.id = 'todayMenuClose';
    close.setAttribute('aria-label', 'Close navigation menu');
    menuHeader.appendChild(close);
    var navigation = node('nav', 'mobile-menu-nav');
    navigation.setAttribute('aria-label', 'Today navigation');
    navigation.appendChild(todayLink());
    var footer = node('div', 'mobile-menu-footer');
    footer.appendChild(signOutButton());
    menu.append(menuHeader, navigation, footer);
    fragment.append(header, overlay, menu);
    return fragment;
  }

  function closeMenu(restoreFocus) {
    var menu = document.getElementById('todayMobileMenu');
    var overlay = document.getElementById('todayMobileOverlay');
    var toggle = document.getElementById('todayMenuToggle');
    var wasOpen = Boolean(menu && menu.classList.contains('open'));
    if (menu) {
      menu.classList.remove('open');
      menu.setAttribute('aria-hidden', 'true');
      menu.setAttribute('inert', '');
    }
    if (overlay) {
      overlay.classList.remove('open');
      overlay.setAttribute('aria-hidden', 'true');
    }
    if (toggle) {
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Open navigation menu');
    }
    document.body.style.overflow = overflowBeforeMenu;
    if (restoreFocus !== false && wasOpen && toggle) toggle.focus({ preventScroll: true });
  }

  function openMenu() {
    var menu = document.getElementById('todayMobileMenu');
    var overlay = document.getElementById('todayMobileOverlay');
    var toggle = document.getElementById('todayMenuToggle');
    if (!menu || !overlay || !toggle) return;
    overflowBeforeMenu = document.body.style.overflow;
    menu.removeAttribute('inert');
    menu.classList.add('open');
    menu.setAttribute('aria-hidden', 'false');
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    toggle.setAttribute('aria-expanded', 'true');
    toggle.setAttribute('aria-label', 'Close navigation menu');
    document.body.style.overflow = 'hidden';
    document.getElementById('todayMenuClose').focus({ preventScroll: true });
  }

  function cookie(name) {
    var prefix = name + '=';
    var parts = String(document.cookie || '').split(';');
    for (var index = 0; index < parts.length; index += 1) {
      var part = parts[index].trim();
      if (part.indexOf(prefix) !== 0) continue;
      try { return decodeURIComponent(part.slice(prefix.length)); } catch (_error) { return part.slice(prefix.length); }
    }
    return '';
  }

  function showLogoutFailure() {
    var status = document.getElementById('todayLogoutStatus');
    if (!status) {
      status = node('div', 'today-logout-status', 'Sign out could not be confirmed. Check your connection and try again.');
      status.id = 'todayLogoutStatus';
      status.setAttribute('role', 'alert');
      document.body.appendChild(status);
    }
    status.hidden = false;
  }

  function logout() {
    if (logoutInFlight) return logoutInFlight;
    var controls = Array.prototype.slice.call(document.querySelectorAll('[data-today-logout]'));
    controls.forEach(function(control) {
      control.disabled = true;
      control.setAttribute('aria-disabled', 'true');
      control.classList.add('is-loading');
    });
    var headers = { Accept: 'application/json' };
    var csrf = cookie('northstar_csrf');
    if (csrf) headers['X-CSRF-Token'] = csrf;
    logoutInFlight = global.fetch(LOGOUT_PATH, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: headers,
    }).then(function(response) {
      return response.json().catch(function() { return {}; }).then(function(body) {
        if (!response.ok || body.success !== true) throw new Error('TODAY_LOGOUT_UNCONFIRMED');
        global.location.assign(LOGIN_PATH);
        return true;
      });
    }).catch(function(error) {
      showLogoutFailure();
      throw error;
    }).finally(function() {
      controls.forEach(function(control) {
        control.disabled = false;
        control.removeAttribute('aria-disabled');
        control.classList.remove('is-loading');
      });
      logoutInFlight = null;
    });
    return logoutInFlight;
  }

  function init() {
    var layout = document.querySelector('.app-layout');
    if (!layout || layout.querySelector('.sidebar')) return;
    document.body.insertBefore(buildMobile(), document.body.firstChild);
    layout.insertBefore(buildSidebar(), layout.firstChild);
    document.documentElement.setAttribute('data-northstar-navigation', 'ready');
    var toggle = document.getElementById('todayMenuToggle');
    var close = document.getElementById('todayMenuClose');
    var overlay = document.getElementById('todayMobileOverlay');
    toggle.addEventListener('click', function() {
      if (document.getElementById('todayMobileMenu').classList.contains('open')) closeMenu(); else openMenu();
    });
    close.addEventListener('click', function() { closeMenu(); });
    overlay.addEventListener('click', function() { closeMenu(); });
    document.addEventListener('click', function(event) {
      var control = event.target && event.target.closest ? event.target.closest('[data-today-logout]') : null;
      if (!control) return;
      event.preventDefault();
      logout().catch(function() {});
    });
    document.addEventListener('keydown', function(event) {
      var menu = document.getElementById('todayMobileMenu');
      if (!menu || !menu.classList.contains('open')) return;
      if (event.key === 'Escape') { event.preventDefault(); closeMenu(); }
    });
    if (global.NorthStarTheme && typeof global.NorthStarTheme.refreshControlPosition === 'function') {
      global.NorthStarTheme.refreshControlPosition();
    }
  }

  global.NorthStarTodayShell = Object.freeze({ init: init, logout: logout });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})(window);
