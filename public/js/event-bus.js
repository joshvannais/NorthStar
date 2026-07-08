/**
 * EventBus — Simple pub/sub event system
 * Singleton shared across all pages
 */
window.EventBus = (function() {
  const listeners = {};
  return {
    on(event, callback) {
      (listeners[event] = listeners[event] || []).push(callback);
      return () => this.off(event, callback);
    },
    off(event, callback) {
      if (!listeners[event]) return;
      listeners[event] = listeners[event].filter(c => c !== callback);
    },
    emit(event, data) {
      (listeners[event] || []).forEach(cb => {
        try { cb(data); } catch(e) { console.error('[EventBus]', event, e); }
      });
    }
  };
})();
