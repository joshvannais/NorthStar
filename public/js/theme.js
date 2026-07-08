/* NorthStar Theme Manager -- Global controller */
(function() {
  "use strict";
  var STORAGE_KEY = "northstar-theme";
  var loaded = false;
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
  }
  function updateToggleButtons(theme) {
    var btns = document.querySelectorAll(".theme-toggle-btn");
    for (var i = 0; i < btns.length; i++) {
      btns[i].textContent = theme === "dark" ? "\u2600\uFE0F" : "\uD83C\uDF19";
      btns[i].setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
    }
  }
  function toggleTheme() {
    var current = document.documentElement.getAttribute("data-theme") || "light";
    var next = current === "dark" ? "light" : "dark";
    applyTheme(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch(e) {}
    updateToggleButtons(next);
  }
  function loadTheme() {
    if (loaded) return;
    loaded = true;
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "dark") { applyTheme("dark"); updateToggleButtons("dark"); }
      else { applyTheme("light"); updateToggleButtons("light"); }
    } catch(e) { applyTheme("light"); }
  }
  window.NorthStarTheme = {
    toggleTheme: toggleTheme,
    loadTheme: loadTheme,
    getTheme: function() { return document.documentElement.getAttribute("data-theme") || "light"; }
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadTheme);
  } else { loadTheme(); }
})();
