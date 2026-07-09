/**
 * TooltipService — Shared NorthStar tooltip component
 * Creates a positioned tooltip near the target element and auto-dismisses.
 * Uses the shared .tooltip CSS from style.css.
 */
window.TooltipService = (function() {
  function show(e, text, duration) {
    duration = duration || 4000;
    // Remove any existing tooltip
    const existing = document.querySelector('.tooltip');
    if (existing) existing.remove();

    const tip = document.createElement('div');
    tip.className = 'tooltip visible';
    tip.textContent = text;

    const rect = e.target.getBoundingClientRect();
    tip.style.left = Math.min(rect.left + rect.width / 2 - 100, window.innerWidth - 220) + 'px';
    tip.style.top = (rect.bottom + 8) + 'px';
    document.body.appendChild(tip);

    setTimeout(function() {
      tip.classList.remove('visible');
      setTimeout(function() { tip.remove(); }, 150);
    }, duration);

    return tip;
  }

  return { show };
})();