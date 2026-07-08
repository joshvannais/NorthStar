/* ═══════════════════════════════════════════════════════════════
   NorthStar — Shared Application Shell
   Generates: sidebar, mobile nav, modals, toast system
   Version: 1.0
   ═══════════════════════════════════════════════════════════════ */

(function() {
  "use strict";

  // ─── Nav Items ────────────────────────────────────────────────
  // Single source of truth for ALL nav links
  var NAV_ITEMS = [
    { href: "/dashboard",          label: "Dashboard",      icon: "M3 3h7v7H3zm11 0h7v7h-7zm0 11h7v7h-7zm-11 0h7v7H3z" },
    { href: "/dashboard/leads",    label: "Leads",          icon: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m8-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm6 2a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" },
    { href: "/dashboard/calls",    label: "Call History",    icon: "M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" },
    { href: "/dashboard/my-number", label: "My Number",      icon: "M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" },
    { href: "/dashboard/calendar", label: "Calendar",        icon: "M3 4h18v18H3zm2 2v14h14V6zm2 2h2v2H7zm4 0h2v2h-2zm4 0h2v2h-2zM7 12h2v2H7zm4 0h2v2h-2zm4 0h2v2h-2zM7 16h2v2H7zm4 0h2v2h-2zm4 0h2v2h-2z" },
    { href: "/dashboard/ai-settings", label: "AI Settings",  icon: "M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1.27A7.05 7.05 0 0 1 17 21h-1.5a2 2 0 0 1-1-1.73V18h-5v1.27c0 .8-.64 1.5-1.44 1.5H7a7.05 7.05 0 0 1-2.73-1H3a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z" },
    { href: "/dashboard/business-profile", label: "Business Profile", icon: "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" },
    { href: "/dashboard/settings", label: "Settings",        icon: "M12 2a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" }
  ];

  // ─── SVG helper ─────────────────────────────────────────────
  function svg(path) {
    return "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" width=\"20\" height=\"20\"><path d=\"" + path + "\"/></svg>";
  }

  // ─── Determine current page ─────────────────────────────────
  function getCurrentPage() {
    return window.location.pathname.replace("/dashboard", "") || "/";
  }

  // ─── Render nav link HTML ───────────────────────────────────
  function navLinkHtml(item, current) {
    var isActive = current === item.href.replace("/dashboard", "") || 
                   (current === "/" && item.href === "/dashboard") ||
                   (current !== "/" && item.href === "/dashboard" + current);
    var cls = isActive ? "active\" aria-current=\"page" : "";
    return "<a href=\"" + item.href + "\" class=\"" + cls + "\">" + svg(item.icon.slice(0,999)) + "<span>" + item.label + "</span></a>";
  }

  // ─── Sidebar HTML ───────────────────────────────────────────
  function renderSidebar(current) {
    var html = "<aside class=\"sidebar\">";
    html += "<a href=\"/dashboard\" class=\"sidebar-logo\"><img src=\"/assets/logo.png\" alt=\"NorthStar\" style=\"height:28px;\"> NorthStar</a>";
    html += "<nav class=\"sidebar-nav\">";
    for (var i = 0; i < NAV_ITEMS.length; i++) {
      html += navLinkHtml(NAV_ITEMS[i], current);
    }
    html += "</nav>";
    html += "<div style=\"padding:12px 16px;border-top:1px solid var(--neutral-200);display:flex;flex-direction:column;gap:4px;\">";
    html += "<a href=\"/\" onclick=\"localStorage.removeItem(user);localStorage.removeItem(northstar_token)\" style=\"display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:var(--radius-sm);font-size:14px;color:var(--neutral-500);text-decoration:none;\">" + svg("M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m6 12l5-5-5-5m5 5H9") + "Sign Out</a>";
    html += "<button onclick=\"window.NorthStarTheme && NorthStarTheme.toggleTheme()\" style=\"background:none;border:none;cursor:pointer;display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:var(--radius-sm);font-size:14px;color:var(--neutral-500);width:100%;text-align:left;\">\uD83C\uDF19 Toggle Theme</button>";
    html += "</div></aside>";
    return html;
  }

  // ─── Mobile Menu HTML ───────────────────────────────────────
  function renderMobileMenu(current) {
    var html = "<div class=\"mobile-header\" id=\"mobileHeader\">";
    html += "<button class=\"hamburger-btn\" onclick=\"toggleMobileMenu()\">";
    html += "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><line x1=\"3\" y1=\"6\" x2=\"21\" y2=\"6\"/><line x1=\"3\" y1=\"12\" x2=\"21\" y2=\"12\"/><line x1=\"3\" y1=\"18\" x2=\"21\" y2=\"18\"/></svg>";
    html += "NorthStar</button>";
    html += "<img src=\"/assets/northstar-logo.png\" alt=\"NorthStar\" class=\"mobile-logo\">";
    html += "</div>";

    html += "<div class=\"mobile-overlay\" id=\"mobileOverlay\" onclick=\"toggleMobileMenu()\"></div>";
    html += "<div class=\"mobile-menu\" id=\"mobileMenu\">";
    html += "<div class=\"mobile-menu-header\">";
    html += "<a href=\"/dashboard\" style=\"font-size:17px;font-weight:700;color:var(--brand-600);text-decoration:none;display:flex;align-items:center;gap:8px;\"><img src=\"/assets/logo.png\" alt=\"NorthStar\" style=\"height:22px;\"> NorthStar</a>";
    html += "<button class=\"mobile-menu-close\" onclick=\"toggleMobileMenu()\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" width=\"22\" height=\"22\"><line x1=\"18\" y1=\"6\" x2=\"6\" y2=\"18\"/><line x1=\"6\" y1=\"6\" x2=\"18\" y2=\"18\"/></svg></button>";
    html += "</div>";
    html += "<nav class=\"mobile-menu-nav\">";
    for (var i = 0; i < NAV_ITEMS.length; i++) {
      html += navLinkHtml(NAV_ITEMS[i], current);
    }
    html += "</nav>";
    html += "<div class=\"mobile-menu-footer\">";
    html += "<a href=\"/\" onclick=\"localStorage.removeItem(user);localStorage.removeItem(northstar_token)\" style=\"display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:var(--radius-sm);font-size:14px;color:var(--neutral-500);text-decoration:none;\">" + svg("M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m6 12l5-5-5-5m5 5H9") + "Sign Out</a>";
    html += "<button onclick=\"window.NorthStarTheme && NorthStarTheme.toggleTheme()\" style=\"background:none;border:none;cursor:pointer;display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:var(--radius-sm);font-size:14px;color:var(--neutral-500);width:100%;text-align:left;\">\uD83C\uDF19 Toggle Theme</button>";
    html += "</div></div>";
    return html;
  }

  // ─── Modal HTML ─────────────────────────────────────────────
  function renderModals() {
    return [
      "<div class=\"modal-backdrop\" id=\"testAIModal\" style=\"display:none;\" role=\"dialog\" aria-modal=\"true\" aria-label=\"Test your AI\" onclick=\"closeTestAIModal(event)\">",
      "<div class=\"modal-panel modal-sm\" onclick=\"event.stopPropagation()\">",
      "<div class=\"modal-header\"><h3 class=\"modal-title\">Test Your AI</h3><button class=\"modal-close\" onclick=\"closeTestAIModal()\" aria-label=\"Close\">&times;</button></div>",
      "<div class=\"modal-body\">",
      "<p class=\"modal-desc\">Type a question a customer might ask.</p>",
      "<div class=\"form-group\"><input type=\"text\" id=\"testAiInput\" placeholder=\"e.g., How much is a tree removal?\"></div>",
      "<div id=\"testAiResponse\" class=\"modal-ai-response\">Your AI&#39;s response will appear here.</div>",
      "</div>",
      "<div class=\"modal-footer\"><button class=\"btn btn-secondary btn-sm\" onclick=\"closeTestAIModal()\">Close</button><button class=\"btn btn-primary btn-sm\" onclick=\"testAIResponse()\">Ask AI</button></div>",
      "</div></div>",

      "<div class=\"modal-backdrop\" id=\"callMyAIModal\" style=\"display:none;\" role=\"dialog\" aria-modal=\"true\" aria-label=\"Call your AI\" onclick=\"closeCallMyAIModal(event)\">",
      "<div class=\"modal-panel modal-sm\" onclick=\"event.stopPropagation()\">",
      "<div class=\"modal-header\"><h3 class=\"modal-title\">Call Your AI</h3><button class=\"modal-close\" onclick=\"closeCallMyAIModal()\" aria-label=\"Close\">&times;</button></div>",
      "<div class=\"modal-body\">",
      "<p class=\"modal-desc\">Call your NorthStar AI phone number.</p>",
      "<div class=\"modal-phone-number\" id=\"myPhoneNumberDisplay\">(860) 467-0739</div>",
      "<p class=\"modal-desc\">Your AI receptionist will answer.</p>",
      "</div>",
      "<div class=\"modal-footer\"><button class=\"btn btn-primary\" onclick=\"closeCallMyAIModal()\">Got it</button></div>",
      "</div></div>",

      "<div class=\"modal-backdrop\" id=\"comingSoonModal\" style=\"display:none;\" role=\"dialog\" aria-modal=\"true\" aria-label=\"Coming soon\" onclick=\"closeComingSoon(event)\">",
      "<div class=\"modal-panel modal-sm\" onclick=\"event.stopPropagation()\">",
      "<div class=\"modal-header\"><h3 class=\"modal-title\">Coming Soon</h3><button class=\"modal-close\" onclick=\"closeComingSoon()\" aria-label=\"Close\">&times;</button></div>",
      "<div class=\"modal-body\"><span class=\"modal-emoji\">\uD83D\uDEA7</span><p class=\"modal-desc\" id=\"comingSoonMessage\">Under development.</p></div>",
      "<div class=\"modal-footer\"><button class=\"btn btn-primary\" onclick=\"closeComingSoon()\">OK</button></div>",
      "</div></div>"

    ].join("\n");
  }

  // ─── Toast Container HTML ───────────────────────────────────
  function renderToastContainer() {
    return "<div class=\"toast-container\" id=\"toastContainer\"></div>";
  }

  // ─── Public API ──────────────────────────────────────────────
  window.NorthStarLayout = {
    NAV_ITEMS: NAV_ITEMS,
    getCurrentPage: getCurrentPage,
    renderSidebar: renderSidebar,
    renderMobileMenu: renderMobileMenu,
    renderModals: renderModals,
    renderToastContainer: renderToastContainer,
    svg: svg,
    navLinkHtml: navLinkHtml
  };
})();
