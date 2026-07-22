const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = '/home/agent-frontend-engineer-2/NorthStar';

// 1. Get polaris.html from previous commit
const oldPolaris = execSync('git show HEAD~1:public/dashboard/polaris.html', { cwd: REPO, encoding: 'utf8', maxBuffer: 50*1024*1024 });
const currentPolaris = fs.readFileSync(path.join(REPO, 'public/dashboard/polaris.html'), 'utf8');

// Extract the app-layout block from old polaris
const layoutMatch = oldPolaris.match(/<div class="app-layout">[\s\S]*?<\/div>\s*\n\s*<script/);
if (!layoutMatch) {
  console.log("ERROR: Could not find app-layout in old polaris.html");
  process.exit(1);
}
let layoutHTML = layoutMatch[0].replace(/\s*\n\s*<script$/, '');

// Remove old sidebar since nav-component handles it
layoutHTML = layoutHTML.replace(/[ \t]*<aside class="sidebar">[\s\S]*?<\/aside>\s*\n/g, '');

// In current polaris, find the body and insert layout HTML after event-bus script
let fixed = currentPolaris.replace(
  /(<body>\s*<script src="\/js\/event-bus\.js"><\/script>)/,
  '$1\n' + layoutHTML
);

fs.writeFileSync(path.join(REPO, 'public/dashboard/polaris.html'), fixed);
console.log("polaris.html restored");

// 2. Update nav-component.js for true off-canvas drawer
const navPath = path.join(REPO, 'public/js/nav-component.js');
let nav = fs.readFileSync(navPath, 'utf8');

// Replace buildMobileNav to include inline critical CSS for off-canvas drawer
const newBuildMobileNav = `  function buildMobileNav() {
    return '' +
      '<style id="nav-critical-css">' +
        '.mobile-overlay{display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);z-index:1000;}' +
        '.mobile-overlay.open{display:block;}' +
        '.mobile-menu{position:fixed;top:0;left:0;height:100vh;width:280px;z-index:1001;transform:translateX(-100%);transition:transform 0.25s ease;background:var(--neutral-50);overflow-y:auto;box-shadow:2px 0 12px rgba(0,0,0,0.15);}' +
        '.mobile-menu.open{transform:translateX(0);}' +
        '[data-theme="dark"] .mobile-menu{background:var(--neutral-50);}' +
      '</style>' +
      '<div class="mobile-header">' +
        '<button class="hamburger-btn" id="navHamburgerBtn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>NorthStar</button>' +
        '<img src="/assets/northstar-logo.png" alt="NorthStar" class="mobile-logo">' +
      '</div>' +
      '<div class="mobile-overlay" id="mobileOverlay"></div>' +
      '<div class="mobile-menu" id="mobileMenu">' +
        '<div class="mobile-menu-header">' +
          '<a href="/dashboard" style="font-size:17px;font-weight:700;color:var(--brand-600);text-decoration:none;display:flex;align-items:center;gap:8px;"><img src="/assets/logo.png" alt="NorthStar" style="height:22px;"> NorthStar</a>' +
          '<button class="mobile-menu-close" id="navCloseBtn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' +
        '</div>' +
        '<nav class="mobile-menu-nav">' +
          makeNavLinks(true) +
        '</nav>' +
        '<div class="mobile-menu-footer">' +
          '<a href="/" id="navSignOut"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>Sign Out</a>' +
          '<button id="navThemeToggle" style="background:none;border:none;cursor:pointer;display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:var(--radius-sm);font-size:14px;font-weight:500;color:var(--neutral-500);width:100%;text-align:left;">&#127769; Toggle Theme</button>' +
        '</div>' +
      '</div>';
  }`;

nav = nav.replace(/  function buildMobileNav\(\) \{[\s\S]*?  \}/, newBuildMobileNav);

// Replace toggleMobileMenu with proper off-canvas behavior
const newToggle = `  window.toggleMobileMenu = function() {
    var overlay = document.getElementById('mobileOverlay');
    var menu = document.getElementById('mobileMenu');
    var isOpen = menu && menu.classList.contains('open');
    if (isOpen) {
      closeMenu();
    } else {
      if (overlay) overlay.classList.add('open');
      if (menu) menu.classList.add('open');
      document.body.style.overflow = 'hidden';
    }
  };

  function closeMenu() {
    var overlay = document.getElementById('mobileOverlay');
    var menu = document.getElementById('mobileMenu');
    if (overlay) overlay.classList.remove('open');
    if (menu) menu.classList.remove('open');
    document.body.style.overflow = '';
  }`;

nav = nav.replace(/  window\.toggleMobileMenu = function[\s\S]*?  \};/, newToggle);

// Replace NavComponent.init to wire up close handlers
const newInit = `  window.NavComponent = {
    init: function(activePage) {
      ACTIVE_PAGE = activePage || '';

      var body = document.body;
      var mobileHTML = buildMobileNav();
      body.insertAdjacentHTML('afterbegin', mobileHTML);

      var existingSidebar = document.querySelector('.sidebar');
      if (existingSidebar) {
        existingSidebar.outerHTML = buildSidebar();
      } else {
        var layout = document.querySelector('.app-layout') || document.querySelector('.dashboard-layout');
        if (layout) {
          layout.insertAdjacentHTML('afterbegin', buildSidebar());
        }
      }

      // Wire up close handlers
      var hamburger = document.getElementById('navHamburgerBtn');
      var closeBtn = document.getElementById('navCloseBtn');
      var overlay = document.getElementById('mobileOverlay');
      var signOut = document.getElementById('navSignOut');
      var themeBtn = document.getElementById('navThemeToggle');

      if (hamburger) hamburger.onclick = toggleMobileMenu;
      if (closeBtn) closeBtn.onclick = toggleMobileMenu;
      if (overlay) overlay.onclick = toggleMobileMenu;
      if (signOut) signOut.onclick = function() {
        localStorage.removeItem('user');
        localStorage.removeItem('northstar_token');
        closeMenu();
        return true;
      };
      if (themeBtn) themeBtn.onclick = function() {
        if (window.NorthStarTheme && window.NorthStarTheme.toggleTheme) {
          window.NorthStarTheme.toggleTheme();
        }
      };

      // Close on Escape
      document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
          var menu = document.getElementById('mobileMenu');
          if (menu && menu.classList.contains('open')) {
            closeMenu();
          }
        }
      });

      // Close on nav link click
      var navLinks = document.querySelectorAll('.mobile-menu-nav a');
      for (var i = 0; i < navLinks.length; i++) {
        navLinks[i].addEventListener('click', function() {
          setTimeout(closeMenu, 150);
        });
      }
    }
  };`;

nav = nav.replace(/  window\.NavComponent = \{[\s\S]*?  \};/, newInit);

fs.writeFileSync(navPath, nav);
console.log("nav-component.js updated for off-canvas drawer");

// 3. Show what changed
const status = execSync('git status --short', { cwd: REPO, encoding: 'utf8' });
console.log("Git status:\n" + status);
