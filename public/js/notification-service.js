/**
 * NotificationService — Shared notification center
 * Creates toast notifications and emits events
 */
window.NotificationService = (function() {
  const bus = window.EventBus;

  function ensureContainer() {
    let container = document.getElementById('toastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toastContainer';
      container.style.cssText = 'position:fixed;top:28px;left:50%;transform:translateX(-50%);z-index:99999;display:flex;flex-direction:column;gap:8px;align-items:center;';
      document.body.appendChild(container);
    }
    return container;
  }

  function show(message, type) {
    type = type || 'info';
    const container = ensureContainer();
    const toast = document.createElement('div');
    toast.className = 'toast-notification ' + type;
    toast.innerHTML = '<span class="toast-body">' + message + '</span>' +
      '<button class="toast-close" onclick="this.parentElement.remove()">&times;</button>';
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.animation = 'toastOut 0.3s ease-out forwards';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
    bus.emit('notification:created', { message, type });
    return toast;
  }

  return { show };
})();

// ── Business Event Subscriptions ──
try {
  if (typeof EventBus !== 'undefined') {
    EventBus.on('simulation:completed', function(data) {
      if (data && data.summary) {
        window.NotificationService.show(
          'Lead generated: ' + data.summary.name + ' ($' + (data.summary.estimatedValue || 0).toLocaleString() + ')',
          'success'
        );
      }
    });
    EventBus.on('lead:created', function(data) {
      window.NotificationService.show(
        'New lead: ' + (data.callerName || data.name || 'Unknown'),
        'info'
      );
    });
    EventBus.on('estimate:created', function(data) {
      window.NotificationService.show(
        'Estimate created: ' + (data.title || 'New estimate') + ' ($' + (data.total || data.estimatedValue || 0).toLocaleString() + ')',
        'info'
      );
    });
  }
} catch(e) { console.warn('[NotificationService] EventBus setup:', e.message); }