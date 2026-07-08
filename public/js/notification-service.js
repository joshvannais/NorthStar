/**
 * NorthStar Solutions — Notification Service
 * Wraps the existing inline showNotification (if present on the page) and
 * also emits a notification:created event on the EventBus so other modules
 * can react. Exposed on window.Notify.
 */
(function () {
  const DEFAULT_ICONS = { success: '✅', info: 'ℹ️', warning: '⚠️', error: '❌' };

  function findContainer() {
    return document.getElementById('toastContainer')
        || document.getElementById('toast')
        || null;
  }

  function fallbackToast(message, type) {
    // Minimal last-resort toast — should rarely fire because every page
    // already ships its own showNotification inline.
    const icons = DEFAULT_ICONS;
    let container = findContainer();
    if (!container) {
      container = document.createElement('div');
      container.id = 'toastContainer';
      container.className = 'toast-container';
      container.style.cssText = 'position:fixed;top:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px;';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = 'toast-notification ' + (type || 'info');
    toast.style.cssText = 'background:#1f2937;color:#fff;padding:10px 14px;border-radius:8px;font-family:Inter,system-ui,sans-serif;font-size:13px;max-width:320px;box-shadow:0 4px 16px rgba(0,0,0,0.2);';
    toast.innerHTML = '<span style="margin-right:6px;">' + (icons[type] || icons.info) + '</span><span>' + message + '</span>';
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; }, 4000);
    setTimeout(() => toast.remove(), 4400);
  }

  const Notify = {
    show(message, type) {
      const note = { message: String(message || ''), type: type || 'info', createdAt: new Date().toISOString() };
      // Prefer the page-defined showNotification (every NorthStar page has one)
      if (typeof window.showNotification === 'function') {
        try { window.showNotification(note.message, note.type); }
        catch (e) { fallbackToast(note.message, note.type); }
      } else if (typeof window.showToast === 'function') {
        try { window.showToast(note.message, note.type); }
        catch (e) { fallbackToast(note.message, note.type); }
      } else {
        fallbackToast(note.message, note.type);
      }
      if (window.AppStore && typeof window.AppStore.pushNotification === 'function') {
        try { window.AppStore.pushNotification(note); } catch (e) { /* non-fatal */ }
      }
      if (window.EventBus) window.EventBus.emit('notification:created', note);
      return note;
    },
    success(message) { return this.show(message, 'success'); },
    info(message)    { return this.show(message, 'info'); },
    warn(message)    { return this.show(message, 'warning'); },
    error(message)   { return this.show(message, 'error'); }
  };

  window.Notify = Notify;
})();
