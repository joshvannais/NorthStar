/* Theme Toggle — shared across all pages */
(function() {
  const STORAGE_KEY = 'northstar-theme';

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch(e) {}
    document.querySelectorAll('.theme-toggle').forEach(btn => {
      btn.textContent = next === 'dark' ? '\u2600\uFE0F' : '\uD83C\uDF19';
    });
  }

  function loadTheme() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'dark') {
        applyTheme('dark');
        document.querySelectorAll('.theme-toggle').forEach(btn => {
          btn.textContent = '\u2600\uFE0F';
        });
      } else {
        applyTheme('light');
        document.querySelectorAll('.theme-toggle').forEach(btn => {
          btn.textContent = '\uD83C\uDF19';
        });
      }
    } catch(e) {}
  }

  window.NorthStarTheme = { toggleTheme, loadTheme, applyTheme };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadTheme);
  } else {
    loadTheme();
  }
})();