/**
 * NotificationService - shared notification presentation.
 * Dynamic message content is always rendered as text.
 */
(function (global) {
  'use strict';

  var existing = global.NotificationService;
  if (existing && existing.__northStarNotificationService === true) {
    existing.bindEventBus();
    return;
  }

  var inlineTimers = new WeakMap();
  var premiumTimers = new WeakMap();
  var subscribedBus = null;

  function severity(type) {
    return type === 'error' || type === 'warning'
      ? { role: 'alert', live: 'assertive' }
      : { role: 'status', live: 'polite' };
  }

  function makeLiveRegion(element, type) {
    var announcement = severity(type);
    element.setAttribute('role', announcement.role);
    element.setAttribute('aria-live', announcement.live);
    element.setAttribute('aria-atomic', 'true');
  }

  function ensureContainer() {
    var container = document.getElementById('toastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toastContainer';
      container.style.cssText = 'position:fixed;top:28px;left:50%;transform:translateX(-50%);z-index:99999;display:flex;flex-direction:column;gap:8px;align-items:center;';
      document.body.appendChild(container);
    }
    return container;
  }

  function removePremium(toast) {
    var state = premiumTimers.get(toast);
    if (!state || state.removed) return;
    state.removed = true;
    if (state.exitTimer) global.clearTimeout(state.exitTimer);
    if (state.removalTimer) global.clearTimeout(state.removalTimer);
    premiumTimers.delete(toast);
    toast.remove();
  }

  function emitCreated(message, type) {
    var bus = global.EventBus;
    if (bus && typeof bus.emit === 'function') {
      bus.emit('notification:created', { message: message, type: type });
    }
  }

  function show(message, type) {
    type = type || 'info';
    bindEventBus();
    var container = ensureContainer();
    var toast = document.createElement('div');
    var body = document.createElement('span');
    var close = document.createElement('button');
    var state = { exitTimer: null, removalTimer: null, removed: false };

    toast.className = 'toast-notification ' + type;
    makeLiveRegion(toast, type);
    body.className = 'toast-body';
    body.textContent = message == null ? '' : String(message);
    close.className = 'toast-close';
    close.setAttribute('type', 'button');
    close.setAttribute('aria-label', 'Close notification');
    close.textContent = '×';
    close.addEventListener('click', function () { removePremium(toast); });
    toast.appendChild(body);
    toast.appendChild(close);
    container.appendChild(toast);

    premiumTimers.set(toast, state);
    state.exitTimer = global.setTimeout(function () {
      if (state.removed) return;
      toast.style.animation = 'toastOut 0.3s ease-out forwards';
      state.removalTimer = global.setTimeout(function () { removePremium(toast); }, 300);
    }, 4000);
    emitCreated(message, type);
    return toast;
  }

  function showInline(message, type, options) {
    options = options || {};
    type = type || 'success';
    var target = options.target || document.getElementById(options.targetId || 'toast');
    if (!target) return;

    var priorTimer = inlineTimers.get(target);
    if (priorTimer) global.clearTimeout(priorTimer);
    target.textContent = message == null ? '' : String(message);
    if (options.className) {
      target.className = options.className + (options.includeTypeClass ? ' ' + type : '');
    }
    if (options.legacyBackground) {
      target.style.background = type === 'error' ? 'var(--danger)' : 'var(--neutral-900)';
    }
    makeLiveRegion(target, type);
    target.classList.add('show');

    var duration = typeof options.duration === 'number' ? options.duration : 3000;
    var timer = global.setTimeout(function () {
      if (inlineTimers.get(target) !== timer) return;
      inlineTimers.delete(target);
      target.classList.remove('show');
    }, duration);
    inlineTimers.set(target, timer);
    return target;
  }

  function bindEventBus() {
    var bus = global.EventBus;
    if (!bus || typeof bus.on !== 'function' || bus === subscribedBus) return;
    try {
      bus.on('simulation:completed', function (data) {
        if (data && data.summary) {
          service.show(
            'Lead generated: ' + data.summary.name + ' ($' + (data.summary.estimatedValue || 0).toLocaleString() + ')',
            'success'
          );
        }
      });
      subscribedBus = bus;
      // lead:created and estimate:created remain intentionally silent.
    } catch (error) {
      if (global.console && typeof global.console.warn === 'function') {
        global.console.warn('[NotificationService] EventBus setup:', error.message);
      }
    }
  }

  var service = {
    __northStarNotificationService: true,
    bindEventBus: bindEventBus,
    show: show,
    showInline: showInline,
  };
  global.NotificationService = service;
  bindEventBus();
})(window);
