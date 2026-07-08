/**
 * NorthStar Solutions — Event Bus
 * Tiny singleton pub/sub for cross-module communication.
 * Exposed on window.EventBus.
 */
(function () {
  const listeners = Object.create(null);

  const EventBus = {
    on(event, callback) {
      if (!event || typeof callback !== 'function') return () => {};
      (listeners[event] = listeners[event] || []).push(callback);
      return () => this.off(event, callback);
    },
    off(event, callback) {
      const arr = listeners[event];
      if (!arr) return;
      const i = arr.indexOf(callback);
      if (i !== -1) arr.splice(i, 1);
    },
    emit(event, data) {
      const arr = listeners[event];
      if (!arr || arr.length === 0) return;
      // Snapshot in case listeners mutate the array
      arr.slice().forEach((cb) => {
        try { cb(data); } catch (err) { console.error('[EventBus] listener error for', event, err); }
      });
    }
  };

  window.EventBus = EventBus;
})();
