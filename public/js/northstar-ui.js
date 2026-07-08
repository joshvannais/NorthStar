/* ═══════════════════════════════════════════════════════════════
   NorthStar — Shared UI Components
   Toast manager, modal helpers, common utilities
   Version: 1.0
   ═══════════════════════════════════════════════════════════════ */
(function() {
  "use strict";

  var NS = {};

  // ─── Toast Manager ──────────────────────────────────────────
  NS.Toast = function(message, type) {
    type = type || "info";
    var icons = { success: "\u2705", info: "\u2139\uFE0F", warning: "\u26A0\uFE0F" };
    var container = document.getElementById("toastContainer");
    if (!container) {
      container = document.createElement("div");
      container.className = "toast-container";
      container.id = "toastContainer";
      document.body.appendChild(container);
    }
    var toast = document.createElement("div");
    toast.className = "toast-notification " + type;
    toast.innerHTML = "<span class=\"toast-icon\">" + (icons[type] || "\u2139\uFE0F") + "</span>" +
      "<span>" + message + "</span>" +
      "<button class=\"toast-close\" onclick=\"this.parentElement.remove()\">\u00D7</button>";
    container.appendChild(toast);
    setTimeout(function() {
      toast.style.animation = "toastOut 0.3s ease-out forwards";
      setTimeout(function() { if (toast.parentElement) toast.remove(); }, 300);
    }, 4000);
  };

  // ─── Modal Helpers ──────────────────────────────────────────
  NS.openModal = function(id) {
    var el = document.getElementById(id);
    if (el) el.style.display = "flex";
  };
  NS.closeModal = function(id) {
    var el = document.getElementById(id);
    if (el) el.style.display = "none";
  };

  // ─── Page Title Setter ──────────────────────────────────────
  NS.setPageTitle = function(title) {
    document.title = title + " \u2014 NorthStar AI";
  };

  // ─── Active Nav Highlighter ─────────────────────────────────
  NS.setActiveNav = function(selector, currentPath) {
    var links = document.querySelectorAll(selector);
    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute("href");
      var isActive = href === currentPath;
      if (isActive) {
        links[i].classList.add("active");
        links[i].setAttribute("aria-current", "page");
      } else {
        links[i].classList.remove("active");
        links[i].removeAttribute("aria-current");
      }
    }
  };

  // ─── SPA Routing ────────────────────────────────────────────
  var REAL_PAGES = [
    "/dashboard/leads", "/dashboard/calls", "/dashboard/my-number",
    "/dashboard/settings", "/dashboard/integrations"
  ];
  NS.setupRouting = function() {
    document.addEventListener("click", function(e) {
      var link = e.target.closest("a");
      if (!link) return;
      var href = link.getAttribute("href");
      if (!href || !href.startsWith("/dashboard") || href.startsWith("http") || link.hasAttribute("download")) return;
      if (REAL_PAGES.indexOf(href) !== -1) return;
      e.preventDefault();
      history.pushState(null, "", href);
      window.location.reload();
    });
  };

  // ─── Coming Soon (fallback) ─────────────────────────────────
  NS.showComingSoon = function(feature) {
    var msg = document.getElementById("comingSoonMessage");
    if (msg) msg.textContent = feature + " is under development and will be available in an upcoming release.";
    NS.openModal("comingSoonModal");
  };
  NS.closeComingSoon = function(e) {
    if (e && e.target !== e.currentTarget) return;
    NS.closeModal("comingSoonModal");
  };

  // ─── Format helpers ─────────────────────────────────────────
  NS.fmtCurrency = function(n) {
    return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  };
  NS.fmtDate = function(t) {
    if (!t) return "-";
    try {
      var d = new Date(t);
      if (!isNaN(d.getTime())) return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    } catch(e) {}
    return t;
  };
  NS.fmtTimeAgo = function(t) {
    if (!t) return "";
    var diff = Math.floor((Date.now() - new Date(t).getTime()) / 60000);
    if (diff < 1) return "just now";
    if (diff < 60) return diff + "m ago";
    var hours = Math.floor(diff / 60);
    if (hours < 24) return hours + "h ago";
    var days = Math.floor(hours / 24);
    return days + "d ago";
  };

  // ─── Expose globally ────────────────────────────────────────
  window.NorthStarUI = NS;
  window.showToast = NS.Toast;
  window.showComingSoon = NS.showComingSoon;
  window.closeComingSoon = NS.closeComingSoon;
})();
