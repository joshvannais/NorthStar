/**
 * NorthStar Canonical Navigation Component
 * Single source of truth for sidebar + mobile nav across all dashboard pages.
 * 
 * Usage: <script src="/js/nav-component.js"></script>
 *        NavComponent.init('page-name');
 * 
 * Where 'page-name' is one of: command-center, today, polaris, leads, communications,
 *   calendar, team, business-profile, settings, integrations
 */
(function() {
  'use strict';

  var ACTIVE_PAGE = '';
  var AUXILIARY_PAGES = { 'report-a-bug': true };
  var bodyOverflowBeforeMenu = '';

  var NAV_ITEMS = [
    { id: 'command-center',   href: '/dashboard',                  label: 'Command Center',   svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>' },
    { id: 'today',            href: '/dashboard/today',            label: 'Today',            svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 2v4"/><path d="M16 2v4"/><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="m9 16 2 2 4-5"/></svg>' },
    { id: 'polaris',          href: '/dashboard/polaris',          label: 'POLARIS',           svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>' },
    { id: 'leads',            href: '/dashboard/leads',            label: 'Leads',             svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>' },
    { id: 'communications',   href: '/dashboard/communications',   label: 'Communications',    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>' },
    { id: 'calendar',         href: '/dashboard/calendar',         label: 'Calendar',          svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="4" rx="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>' },
    { id: 'team',             href: '/dashboard/team',             label: 'Team',              svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M20 8v6"/><path d="M23 11h-6"/></svg>' },
    { id: 'business-profile', href: '/dashboard/business-profile', label: 'Business Profile',  svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>' },
    { id: 'settings',         href: '/dashboard/settings',         label: 'Settings',          svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/></svg>' },
    { id: 'integrations',     href: '/dashboard/integrations',      label: 'Integrations',       svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>' }
  ];

  // Labels/icons remain presentation-only. The paid paths and ordering come
  // from the same UMD contract consumed by server permissions and demo routes.
  var routeContract = window.NorthStarCommandCenterContract;
  var paidRoutes = routeContract && routeContract.PAID_ROUTES;
  if (!routeContract || !Array.isArray(paidRoutes) || paidRoutes.length !== NAV_ITEMS.length) {
    NAV_ITEMS = [];
  } else {
    NAV_ITEMS = paidRoutes.map(function(route, index) {
      var presentation = NAV_ITEMS[index];
      if (!presentation || presentation.id !== route.id || route.paidPath !== presentation.href) return null;
      return {
        id: route.id,
        href: route.paidPath,
        label: route.label === 'Polaris' ? 'POLARIS' : route.label,
        svg: presentation.svg,
      };
    }).filter(Boolean);
    if (NAV_ITEMS.length !== paidRoutes.length) NAV_ITEMS = [];
  }

  function makeNavLinks(isMobile, items) {
    var html = '';
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var isActive = item.id === ACTIVE_PAGE;
      var activeAttr = isActive ? ' class="active" aria-current="page"' : '';
      html += '<a href="' + item.href + '" data-nav-id="' + item.id + '"' + activeAttr + '>' + item.svg + (isMobile ? item.label : '<span>' + item.label + '</span>') + '</a>';
    }
    return html;
  }

  function supportAction() {
    return '<a class="northstar-nav-action" href="/dashboard/report-a-bug" data-support-action>' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
      '<path d="M8 2h8l1 4 3 2v8l-3 2-1 4H8l-1-4-3-2V8l3-2 1-4Z"/>' +
      '<path d="M9 9h6M9 13h6M12 17h.01"/></svg><span>Report a Bug</span></a>';
  }

  function buildMobileNav(items, mode) {
    var homePath = mode === 'demo' ? '/demo' : '/dashboard';
    var footerLink = mode === 'demo'
      ? '<a class="northstar-nav-action" href="/" id="navExitDemo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 18l6-6-6-6"/><path d="M15 12H3"/><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/></svg><span>Exit Demo</span></a>'
      : supportAction() + '<button type="button" class="northstar-nav-action" id="navSignOut" data-account-logout aria-label="Sign Out"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg><span>Sign Out</span></button>';
    return '' +
      '<style id="nav-critical-css">' +
        '#mobileOverlay.mobile-overlay{display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);z-index:1000;}' +
        '#mobileOverlay.mobile-overlay.open{display:block;}' +
        '#mobileMenu.mobile-menu{position:fixed;top:0;left:0;height:100vh;width:280px;z-index:1001;transform:translate3d(-100%,0,0);transition:transform 0.25s ease,visibility 0s linear 0.25s;background:var(--neutral-50);overflow-y:auto;overscroll-behavior:contain;box-shadow:2px 0 12px rgba(0,0,0,0.15);visibility:hidden;pointer-events:none;}' +
        '#mobileMenu.mobile-menu.open,#mobileMenu.mobile-menu[data-state="open"]{transform:translate3d(0,0,0);transition-delay:0s;visibility:visible;pointer-events:auto;}' +
        '[data-theme="dark"] .mobile-menu{background:var(--neutral-50);}' +
      '</style>' +
      '<div class="mobile-header" data-northstar-fixed-header>' +
        '<button type="button" class="hamburger-btn" id="navHamburgerBtn" aria-controls="mobileMenu" aria-expanded="false" aria-label="Open navigation menu"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>NorthStar</button>' +
        '<div class="mobile-header-actions">' +
          '<img src="/assets/logo.png" alt="NorthStar" class="mobile-logo">' +
          '<span class="northstar-theme-slot" data-northstar-theme-slot data-northstar-theme-location="mobile" aria-label="Theme controls"></span>' +
        '</div>' +
      '</div>' +
      '<div class="mobile-overlay" id="mobileOverlay" aria-hidden="true"></div>' +
      '<div class="mobile-menu" id="mobileMenu" data-state="closed" aria-hidden="true" inert>' +
        '<div class="mobile-menu-header">' +
          '<a href="' + homePath + '" class="northstar-lockup"><img src="/assets/logo.png" alt=""> NorthStar</a>' +
          '<button type="button" class="mobile-menu-close" id="navCloseBtn" aria-label="Close navigation menu"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' +
        '</div>' +
        '<nav class="mobile-menu-nav" aria-label="Mobile primary navigation">' +
          makeNavLinks(true, items) +
        '</nav>' +
        '<div class="mobile-menu-footer">' +
          footerLink +
        '</div>' +
      '</div>';
  }

  function buildSidebar(items, mode) {
    var homePath = mode === 'demo' ? '/demo' : '/dashboard';
    var footerLink = mode === 'demo'
      ? '<a class="northstar-nav-action" href="/"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 18l6-6-6-6"/><path d="M15 12H3"/><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/></svg><span>Exit Demo</span></a>'
      : supportAction() + '<button type="button" class="northstar-nav-action" data-account-logout aria-label="Sign Out"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg><span>Sign Out</span></button>';
    return '' +
      '<aside class="sidebar">' +
        '<a href="' + homePath + '" class="sidebar-logo northstar-lockup">' +
          '<img src="/assets/logo.png" alt="" class="logo-img">' +
          'NorthStar' +
        '</a>' +
        '<nav class="sidebar-nav">' +
          makeNavLinks(false, items) +
        '</nav>' +
        '<div class="sidebar-footer">' +
          footerLink +
          '<span class="northstar-theme-slot" data-northstar-theme-slot data-northstar-theme-location="desktop" aria-label="Theme controls"></span>' +
        '</div>' +
      '</aside>';
  }

  function projectedItems(account) {
    if (!account || !Array.isArray(account.navigation) || account.navigation.length === 0 ||
        account.navigation.length > NAV_ITEMS.length) return null;
    var allowed = Object.create(null);
    var mode = account.mode === 'demo' ? 'demo' : 'paid';
    for (var index = 0; index < account.navigation.length; index++) {
      var projected = account.navigation[index];
      if (!projected || typeof projected.id !== 'string' || typeof projected.href !== 'string' || allowed[projected.id]) {
        return null;
      }
      var canonical = null;
      for (var itemIndex = 0; itemIndex < NAV_ITEMS.length; itemIndex++) {
        if (NAV_ITEMS[itemIndex].id === projected.id) {
          canonical = NAV_ITEMS[itemIndex];
          break;
        }
      }
      var contractRoute = routeContract && routeContract.PAID_ROUTES && routeContract.PAID_ROUTES.find(function(route) {
        return route.id === projected.id;
      });
      var expectedHref = contractRoute && mode === 'demo' ? contractRoute.demoPath : canonical && canonical.href;
      if (!canonical || !contractRoute || expectedHref !== projected.href) return null;
      allowed[projected.id] = true;
    }
    var projectedItems = NAV_ITEMS.filter(function(item) { return allowed[item.id] === true; }).map(function(item) {
      if (mode !== 'demo') return item;
      var contractRoute = routeContract.PAID_ROUTES.find(function(route) { return route.id === item.id; });
      return { id: item.id, href: contractRoute.demoPath, label: item.label, svg: item.svg };
    });
    // Today is an employee-minimized surface even when the signed-in person also
    // has broad owner or dispatcher authority elsewhere. Its navigation must not
    // enumerate those broader surfaces or imply that Today grants access to them.
    if (ACTIVE_PAGE === 'today') {
      projectedItems = projectedItems.filter(function(item) { return item.id === 'today'; });
    }
    return projectedItems;
  }

  function removeGeneratedMobileNav() {
    var selectors = ['.mobile-header', '.mobile-overlay', '.mobile-menu', '#nav-critical-css'];
    for (var selectorIndex = 0; selectorIndex < selectors.length; selectorIndex++) {
      var nodes = document.querySelectorAll(selectors[selectorIndex]);
      for (var nodeIndex = 0; nodeIndex < nodes.length; nodeIndex++) nodes[nodeIndex].remove();
    }
  }

  function installSidebar(items, mode) {
    var sidebars = document.querySelectorAll('.sidebar');
    var existingSidebar = sidebars.length ? sidebars[0] : null;
    for (var index = 1; index < sidebars.length; index++) sidebars[index].remove();
    if (existingSidebar) {
      existingSidebar.outerHTML = buildSidebar(items, mode);
      return true;
    }
    var layout = document.querySelector('.app-layout') || document.querySelector('.dashboard-layout');
    if (!layout) return false;
    layout.insertAdjacentHTML('afterbegin', buildSidebar(items, mode));
    return true;
  }

  window.toggleMobileMenu = function() {
    var overlay = document.getElementById('mobileOverlay');
    var menu = document.getElementById('mobileMenu');
    var hamburger = document.getElementById('navHamburgerBtn');
    var isOpen = menu && menu.classList.contains('open');
    if (isOpen) {
      closeMenu();
    } else {
      bodyOverflowBeforeMenu = document.body.style.overflow;
      if (overlay) {
        overlay.classList.add('open');
        overlay.setAttribute('aria-hidden', 'false');
      }
      if (menu) {
        menu.removeAttribute('inert');
        menu.setAttribute('aria-hidden', 'false');
        menu.setAttribute('data-state', 'open');
        menu.classList.add('open');
      }
      if (hamburger) {
        hamburger.setAttribute('aria-expanded', 'true');
        hamburger.setAttribute('aria-label', 'Close navigation menu');
      }
      document.body.style.overflow = 'hidden';
      var closeButton = document.getElementById('navCloseBtn');
      if (closeButton) closeButton.focus({ preventScroll: true });
    }
  };

  function closeMenu(restoreFocus) {
    var overlay = document.getElementById('mobileOverlay');
    var menu = document.getElementById('mobileMenu');
    var hamburger = document.getElementById('navHamburgerBtn');
    var wasOpen = Boolean(menu && menu.classList.contains('open'));
    if (overlay) {
      overlay.classList.remove('open');
      overlay.setAttribute('aria-hidden', 'true');
    }
    if (menu) {
      menu.classList.remove('open');
      menu.setAttribute('data-state', 'closed');
      menu.setAttribute('aria-hidden', 'true');
      menu.setAttribute('inert', '');
    }
    if (hamburger) {
      hamburger.setAttribute('aria-expanded', 'false');
      hamburger.setAttribute('aria-label', 'Open navigation menu');
    }
    document.body.style.overflow = bodyOverflowBeforeMenu;
    if (restoreFocus !== false && wasOpen && hamburger) hamburger.focus({ preventScroll: true });
  }

  window.NavComponent = {
    init: function(activePage) {
      ACTIVE_PAGE = activePage || '';
      var root = document.documentElement;
      root.setAttribute('data-northstar-navigation', 'pending');
      removeGeneratedMobileNav();

      if (!window.NorthStarAccountSession || typeof window.NorthStarAccountSession.load !== 'function') {
        root.setAttribute('data-northstar-navigation', 'denied');
        window.location.replace('/login');
        return Promise.resolve(null);
      }

      return window.NorthStarAccountSession.load().then(function(account) {
        var items = projectedItems(account);
        var mode = account && account.mode === 'demo' ? 'demo' : 'paid';
        if (!items) {
          root.setAttribute('data-northstar-navigation', 'denied');
          window.location.replace('/login');
          return null;
        }

        var activeAllowed = AUXILIARY_PAGES[ACTIVE_PAGE] === true ||
          items.some(function(item) { return item.id === ACTIVE_PAGE; });
        if (!activeAllowed) {
          root.setAttribute('data-northstar-navigation', 'denied');
          if (items.some(function(item) { return item.id === 'command-center'; })) {
            window.location.replace(mode === 'demo' ? '/demo' : '/dashboard');
          } else {
            window.location.replace('/login');
          }
          return null;
        }

        removeGeneratedMobileNav();
        document.body.insertAdjacentHTML('afterbegin', buildMobileNav(items, mode));
        if (!installSidebar(items, mode)) {
          root.setAttribute('data-northstar-navigation', 'denied');
          window.location.replace(mode === 'demo' ? '/demo' : '/dashboard');
          return null;
        }

        if (window.NorthStarTheme && typeof window.NorthStarTheme.refreshControlPosition === 'function') {
          window.NorthStarTheme.refreshControlPosition();
        }

        var hamburger = document.getElementById('navHamburgerBtn');
        var closeBtn = document.getElementById('navCloseBtn');
        var overlay = document.getElementById('mobileOverlay');
        if (hamburger) hamburger.onclick = window.toggleMobileMenu;
        if (closeBtn) closeBtn.onclick = window.toggleMobileMenu;
        if (overlay) overlay.onclick = window.toggleMobileMenu;

        // The shared account client owns one delegated logout listener so every
        // surface receives the same durable success/failure behavior.
        if (root.getAttribute('data-northstar-navigation-keyboard-bound') !== 'true') {
          root.setAttribute('data-northstar-navigation-keyboard-bound', 'true');
          document.addEventListener('keydown', function(e) {
            var menu = document.getElementById('mobileMenu');
            var isOpen = menu && menu.classList.contains('open');
            if (!isOpen) return;
            if (e.key === 'Escape') {
              e.preventDefault();
              closeMenu();
              return;
            }
            if (e.key !== 'Tab') return;
            var focusable = Array.prototype.slice.call(menu.querySelectorAll('a[href],button:not([disabled])'));
            if (!focusable.length) return;
            var currentIndex = focusable.indexOf(document.activeElement);
            var nextIndex = e.shiftKey
              ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
              : (currentIndex < 0 || currentIndex === focusable.length - 1 ? 0 : currentIndex + 1);
            e.preventDefault();
            focusable[nextIndex].focus();
          });
        }

        var navLinks = document.querySelectorAll('.mobile-menu-nav a');
        for (var i = 0; i < navLinks.length; i++) {
          navLinks[i].addEventListener('click', function() {
            closeMenu(false);
          });
        }

        root.setAttribute('data-northstar-navigation', 'ready');
        // The existing paid Quick Start enumerates Command Center, Business
        // Profile, Settings, and Integrations. That setup authority is useful on
        // broad operator pages but is intentionally not applicable to the
        // minimized employee Today surface.
        if (ACTIVE_PAGE !== 'today' && AUXILIARY_PAGES[ACTIVE_PAGE] !== true) {
          if (!document.querySelector('link[data-northstar-workspace-guidance]')) {
            var guidanceStyles = document.createElement('link');
            guidanceStyles.rel = 'stylesheet';
            guidanceStyles.href = '/css/workspace-guidance.css';
            guidanceStyles.dataset.northstarWorkspaceGuidance = 'true';
            document.head.appendChild(guidanceStyles);
          }
          var startGuidance = function () {
            if (window.NorthStarWorkspaceGuidance) {
              window.NorthStarWorkspaceGuidance.init({ mode: mode, activePage: ACTIVE_PAGE });
            }
          };
          if (window.NorthStarWorkspaceGuidance) startGuidance();
          else if (!document.querySelector('script[data-northstar-workspace-guidance]')) {
            var guidanceScript = document.createElement('script');
            guidanceScript.src = '/js/workspace-guidance.js';
            guidanceScript.dataset.northstarWorkspaceGuidance = 'true';
            guidanceScript.addEventListener('load', startGuidance, { once: true });
            document.head.appendChild(guidanceScript);
          }
        }
        window.dispatchEvent(new CustomEvent('northstar:navigation-ready', {
          detail: Object.freeze({ activePage: ACTIVE_PAGE })
        }));
        return items;
      }).catch(function() {
        root.setAttribute('data-northstar-navigation', 'denied');
        window.location.replace('/login');
        return null;
      });
    }
  };
})();
