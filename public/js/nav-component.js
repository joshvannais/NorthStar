/**
 * NorthStar Canonical Navigation Component
 * Single source of truth for sidebar + mobile nav across all dashboard pages.
 * 
 * Usage: <script src="/js/nav-component.js"></script>
 *        NavComponent.init('page-name');
 * 
 * Where 'page-name' is one of: command-center, polaris, leads, communications,
 *   my-number, calendar, ai-settings, business-profile, settings
 */
(function() {
  'use strict';

  var ACTIVE_PAGE = '';

  var NAV_ITEMS = [
    { id: 'command-center',   href: '/dashboard',                  label: 'Command Center',   svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>' },
    { id: 'polaris',          href: '/dashboard/polaris',          label: 'POLARIS',           svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>' },
    { id: 'leads',            href: '/dashboard/leads',            label: 'Leads',             svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>' },
    { id: 'communications',   href: '/dashboard/communications',   label: 'Communications',    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>' },
    { id: 'my-number',        href: '/dashboard/my-number',        label: 'My Number',         svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>' },
    { id: 'calendar',         href: '/dashboard/calendar',         label: 'Calendar',          svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="4" rx="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>' },
    { id: 'ai-settings',      href: '/dashboard/ai-settings',      label: 'AI Settings',       svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1.27A7.05 7.05 0 0 1 17 21h-1.5a2 2 0 0 1-1-1.73V18h-5v1.27c0 .8-.64 1.5-1.44 1.5H7a7.05 7.05 0 0 1-2.73-1H3a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z"/></svg>' },
    { id: 'business-profile', href: '/dashboard/business-profile', label: 'Business Profile',  svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>' },
    { id: 'settings',         href: '/dashboard/settings',         label: 'Settings',          svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/></svg>' }
  ];

  function makeNavLinks(isMobile) {
    var html = '';
    for (var i = 0; i < NAV_ITEMS.length; i++) {
      var item = NAV_ITEMS[i];
      var isActive = item.id === ACTIVE_PAGE;
      var activeAttr = isActive ? ' class="active" aria-current="page"' : '';
      html += '<a href="' + item.href + '"' + activeAttr + '>' + item.svg + (isMobile ? item.label : '<span>' + item.label + '</span>') + '</a>';
    }
    return html;
  }

  function buildMobileNav() {
    return '' +
      '<!-- Mobile header + hamburger -->' +
      '<div class="mobile-header">' +
        '<button class="hamburger-btn" onclick="toggleMobileMenu()">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>' +
          'NorthStar' +
        '</button>' +
        '<img src="/assets/northstar-logo.png" alt="NorthStar" class="mobile-logo">' +
      '</div>' +
      '<div class="mobile-overlay" id="mobileOverlay" onclick="toggleMobileMenu()"></div>' +
      '<div class="mobile-menu" id="mobileMenu">' +
        '<div class="mobile-menu-header">' +
          '<a href="/dashboard" style="font-size:17px;font-weight:700;color:var(--brand-600);text-decoration:none;display:flex;align-items:center;gap:8px;"><img src="/assets/logo.png" alt="NorthStar" style="height:22px;"> NorthStar</a>' +
          '<button class="mobile-menu-close" onclick="toggleMobileMenu()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' +
        '</div>' +
        '<nav class="mobile-menu-nav">' +
          makeNavLinks(true) +
        '</nav>' +
        '<div class="mobile-menu-footer">' +
          '<a href="/" onclick="localStorage.removeItem(\'user\');localStorage.removeItem(\'northstar_token\');return true;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>Sign Out</a>' +
          '<button onclick="NorthStarTheme.toggleTheme()" style="background:none;border:none;cursor:pointer;display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:var(--radius-sm);font-size:14px;font-weight:500;color:var(--neutral-500);width:100%;text-align:left;">&#127769; Toggle Theme</button>' +
        '</div>' +
      '</div>';
  }

  function buildSidebar() {
    return '' +
      '<aside class="sidebar">' +
        '<a href="/dashboard" class="sidebar-logo">' +
          '<img src="/assets/logo.png" alt="NorthStar" class="logo-img">' +
          'NorthStar' +
        '</a>' +
        '<nav class="sidebar-nav">' +
          makeNavLinks(false) +
        '</nav>' +
        '<a href="/" onclick="localStorage.removeItem(\'user\');localStorage.removeItem(\'northstar_token\');return true;" style="display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:var(--radius-sm);text-decoration:none;font-size:14px;font-weight:500;color:var(--neutral-500);margin-top:auto;">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px;height:20px;"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>' +
          '<span>Sign Out</span>' +
        '</a>' +
        '<button class="theme-toggle" onclick="NorthStarTheme.toggleTheme()" title="Toggle theme">&#127769;</button>' +
      '</aside>';
  }

  window.toggleMobileMenu = function() {
    var overlay = document.getElementById('mobileOverlay');
    var menu = document.getElementById('mobileMenu');
    if (overlay) overlay.classList.toggle('open');
    if (menu) menu.classList.toggle('open');
  };

  window.NavComponent = {
    init: function(activePage) {
      ACTIVE_PAGE = activePage || '';

      // Insert mobile nav at the start of <body>
      var body = document.body;
      var mobileHTML = buildMobileNav();
      body.insertAdjacentHTML('afterbegin', mobileHTML);

      // Replace any existing sidebar with canonical version
      var existingSidebar = document.querySelector('.sidebar');
      if (existingSidebar) {
        existingSidebar.outerHTML = buildSidebar();
      } else {
        // If no sidebar exists, try to find .app-layout or .dashboard-layout and prepend
        var layout = document.querySelector('.app-layout') || document.querySelector('.dashboard-layout');
        if (layout) {
          layout.insertAdjacentHTML('afterbegin', buildSidebar());
        }
      }
    }
  };
})();
