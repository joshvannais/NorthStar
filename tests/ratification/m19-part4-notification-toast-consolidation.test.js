'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = Object.freeze({
  auth: path.join(ROOT, 'public', 'js', 'auth-session.js'),
  api: path.join(ROOT, 'public', 'js', 'api.js'),
  service: path.join(ROOT, 'public', 'js', 'notification-service.js'),
});

function tokens(value) {
  return String(value || '').split(/\s+/).filter(Boolean);
}

function createElement(document, tagName) {
  let className = '';
  let text = '';
  let html = '';
  const attributes = new Map();
  const listeners = new Map();
  const element = {
    tagName: String(tagName || 'div').toUpperCase(),
    children: [],
    parentElement: null,
    style: { cssText: '', animation: '', background: '' },
    hidden: false,
    id: '',
    appendChild(child) {
      child.parentElement = element;
      element.children.push(child);
      return child;
    },
    remove() {
      if (!element.parentElement) return;
      const index = element.parentElement.children.indexOf(element);
      if (index >= 0) element.parentElement.children.splice(index, 1);
      element.parentElement = null;
    },
    addEventListener(name, callback) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(callback);
    },
    click() {
      (listeners.get('click') || []).slice().forEach(callback => callback({ target: element }));
    },
    setAttribute(name, value) { attributes.set(String(name), String(value)); },
    getAttribute(name) { return attributes.has(String(name)) ? attributes.get(String(name)) : null; },
    querySelector(selector) {
      const match = candidate => selector.charAt(0) === '.'
        ? candidate.classList.contains(selector.slice(1))
        : candidate.tagName.toLowerCase() === selector.toLowerCase();
      const queue = element.children.slice();
      while (queue.length) {
        const candidate = queue.shift();
        if (match(candidate)) return candidate;
        queue.push(...candidate.children);
      }
      return null;
    },
  };
  Object.defineProperties(element, {
    className: {
      get() { return className; },
      set(value) { className = String(value || ''); },
    },
    textContent: {
      get() { return text + element.children.map(child => child.textContent).join(''); },
      set(value) {
        text = value == null ? '' : String(value);
        html = '';
        element.children.length = 0;
      },
    },
    innerHTML: {
      get() { return html; },
      set(value) {
        html = String(value == null ? '' : value);
        text = '';
        element.children.length = 0;
        document.innerHtmlAssignments.push(html);
      },
    },
  });
  element.classList = {
    add(...names) {
      const current = new Set(tokens(className));
      names.forEach(name => current.add(name));
      className = [...current].join(' ');
    },
    remove(...names) {
      const removed = new Set(names);
      className = tokens(className).filter(name => !removed.has(name)).join(' ');
    },
    contains(name) { return tokens(className).includes(name); },
  };
  return element;
}

function createDocument() {
  const document = {
    cookie: '',
    readyState: 'loading',
    innerHtmlAssignments: [],
    listeners: new Map(),
    createElement(tagName) { return createElement(document, tagName); },
    addEventListener(name, callback) {
      if (!document.listeners.has(name)) document.listeners.set(name, []);
      document.listeners.get(name).push(callback);
    },
    querySelectorAll() { return []; },
    getElementById(id) {
      const queue = [document.documentElement];
      while (queue.length) {
        const candidate = queue.shift();
        if (candidate.id === id) return candidate;
        queue.push(...candidate.children);
      }
      return null;
    },
  };
  document.documentElement = createElement(document, 'html');
  document.body = createElement(document, 'body');
  document.documentElement.appendChild(document.body);
  return document;
}

function createEventBus() {
  const listeners = new Map();
  const emissions = [];
  return {
    emissions,
    on(name, callback) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(callback);
    },
    emit(name, payload) {
      emissions.push({ name, payload });
      (listeners.get(name) || []).slice().forEach(callback => callback(payload));
    },
    listenerCount(name) { return (listeners.get(name) || []).length; },
  };
}

function createRuntime(options = {}) {
  const document = createDocument();
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    document,
    location: { pathname: '/contact', port: '', replace() {}, assign() {} },
    setTimeout,
    clearTimeout,
    Promise,
    Map,
    WeakMap,
    Set,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Date,
    Math,
    JSON,
    Reflect,
    Uint8Array,
    decodeURIComponent,
    encodeURIComponent,
    fetch: jest.fn(),
    addEventListener() {},
    dispatchEvent() {},
  };
  sandbox.window = sandbox;
  if (options.eventBus) sandbox.EventBus = options.eventBus;
  vm.createContext(sandbox);
  return { document, sandbox };
}

function addToastTarget(runtime, className = 'toast') {
  const target = runtime.document.createElement('div');
  target.id = 'toast';
  target.className = className;
  runtime.document.body.appendChild(target);
  return target;
}

function load(runtime, script) {
  vm.runInContext(fs.readFileSync(SCRIPT[script], 'utf8'), runtime.sandbox, {
    filename: path.basename(SCRIPT[script]),
  });
}

function scriptsIn(html) {
  return [...html.matchAll(/<script\b([^>]*)>/gi)].map(match => {
    const source = /\bsrc=["']([^"']+)["']/i.exec(match[1]);
    return source ? source[1] : '<inline>';
  });
}

describe('Mission 19 Part 4 Slice 4 notification consolidation', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  test('premium service renders dynamic content as text with one accessible deterministic lifecycle', () => {
    const bus = createEventBus();
    const runtime = createRuntime({ eventBus: bus });
    load(runtime, 'service');
    const payload = '<img src=x onerror="window.pwned=1"><script>window.pwned=2</script>';

    const toast = runtime.sandbox.NotificationService.show(payload, 'error');
    const body = toast.querySelector('.toast-body');
    const close = toast.querySelector('.toast-close');

    expect(runtime.document.innerHtmlAssignments).toEqual([]);
    expect(body.textContent).toBe(payload);
    expect(toast.querySelector('img')).toBeNull();
    expect(toast.querySelector('script')).toBeNull();
    expect(runtime.sandbox.pwned).toBeUndefined();
    expect(toast.className).toBe('toast-notification error');
    expect(toast.getAttribute('role')).toBe('alert');
    expect(toast.getAttribute('aria-live')).toBe('assertive');
    expect(toast.getAttribute('aria-atomic')).toBe('true');
    expect(close.getAttribute('type')).toBe('button');
    expect(close.getAttribute('aria-label')).toBe('Close notification');
    expect(close.textContent).toBe('×');
    expect(bus.emissions).toEqual([{ name: 'notification:created', payload: { message: payload, type: 'error' } }]);

    jest.advanceTimersByTime(3999);
    expect(toast.parentElement).not.toBeNull();
    jest.advanceTimersByTime(1);
    expect(toast.style.animation).toBe('toastOut 0.3s ease-out forwards');
    jest.advanceTimersByTime(299);
    expect(toast.parentElement).not.toBeNull();
    jest.advanceTimersByTime(1);
    expect(toast.parentElement).toBeNull();
    close.click();
    expect(toast.parentElement).toBeNull();
  });

  test('EventBus is optional and repeated evaluation binds only one simulation listener', () => {
    const withoutBus = createRuntime();
    load(withoutBus, 'service');
    expect(() => withoutBus.sandbox.NotificationService.show('No bus', 'info')).not.toThrow();

    const bus = createEventBus();
    const runtime = createRuntime({ eventBus: bus });
    load(runtime, 'service');
    load(runtime, 'service');
    expect(bus.listenerCount('simulation:completed')).toBe(1);
    expect(bus.listenerCount('lead:created')).toBe(0);
    expect(bus.listenerCount('estimate:created')).toBe(0);

    bus.emit('simulation:completed', { summary: { name: 'Avery <Cedar>', estimatedValue: 1200 } });
    expect(runtime.document.body.children.filter(child => child.id === 'toastContainer')).toHaveLength(1);
    const container = runtime.document.getElementById('toastContainer');
    expect(container.children).toHaveLength(1);
    expect(container.children[0].querySelector('.toast-body').textContent)
      .toBe('Lead generated: Avery <Cedar> ($1,200)');
    expect(bus.emissions.filter(entry => entry.name === 'notification:created')).toHaveLength(1);
  });

  test('shared inline presentation preserves Business Profile classes and cancels stale timers', () => {
    const runtime = createRuntime();
    const target = addToastTarget(runtime, 'bp-toast');
    load(runtime, 'service');

    runtime.sandbox.NotificationService.showInline('<img onerror=1>', 'error', {
      targetId: 'toast',
      className: 'bp-toast',
      includeTypeClass: true,
      duration: 3000,
    });
    expect(target.textContent).toBe('<img onerror=1>');
    expect(target.className).toBe('bp-toast error show');
    expect(target.getAttribute('role')).toBe('alert');
    expect(target.getAttribute('aria-live')).toBe('assertive');
    expect(target.getAttribute('aria-atomic')).toBe('true');

    jest.advanceTimersByTime(2000);
    runtime.sandbox.NotificationService.showInline('newer', 'success', {
      targetId: 'toast',
      className: 'bp-toast',
      includeTypeClass: true,
      duration: 3000,
    });
    jest.advanceTimersByTime(1000);
    expect(target.classList.contains('show')).toBe(true);
    expect(target.textContent).toBe('newer');
    jest.advanceTimersByTime(1999);
    expect(target.classList.contains('show')).toBe(true);
    jest.advanceTimersByTime(1);
    expect(target.classList.contains('show')).toBe(false);
    expect(runtime.sandbox.NotificationService.showInline('missing', 'info', { targetId: 'absent' }))
      .toBeUndefined();
  });

  test('API dynamically delegates in every mounted load order while preserving the service-absent fallback', () => {
    const orders = [
      ['service', 'api'],
      ['api', 'service'],
      ['auth', 'service', 'api'],
      ['auth', 'api', 'service'],
    ];
    orders.forEach(order => {
      const runtime = createRuntime();
      addToastTarget(runtime);
      order.forEach(script => load(runtime, script));
      const original = runtime.sandbox.NotificationService.showInline;
      const calls = [];
      runtime.sandbox.NotificationService.showInline = function (...args) {
        calls.push(args);
        return original.apply(runtime.sandbox.NotificationService, args);
      };
      expect(runtime.sandbox.showToast('Exact mounted message', 'error')).toBeUndefined();
      expect(calls).toHaveLength(1);
      expect(calls[0][0]).toBe('Exact mounted message');
      expect(calls[0][1]).toBe('error');
      expect(runtime.document.getElementById('toast').textContent).toBe('Exact mounted message');
      jest.clearAllTimers();
    });

    const fallback = createRuntime();
    const target = addToastTarget(fallback);
    load(fallback, 'api');
    const payload = '<svg onload="window.pwned=1">';
    expect(fallback.sandbox.showToast(payload, 'error')).toBeUndefined();
    expect(target.textContent).toBe(payload);
    expect(target.style.background).toBe('var(--danger)');
    expect(target.classList.contains('show')).toBe(true);
    expect(fallback.document.innerHtmlAssignments).toEqual([]);
    jest.advanceTimersByTime(2000);
    fallback.sandbox.showToast('newer');
    jest.advanceTimersByTime(1000);
    expect(target.classList.contains('show')).toBe(true);
    expect(target.textContent).toBe('newer');
    jest.advanceTimersByTime(1999);
    expect(target.classList.contains('show')).toBe(true);
    jest.advanceTimersByTime(1);
    expect(target.classList.contains('show')).toBe(false);
  });

  test('auth bootstrap owns the early 3500ms fallback before API and service become available', () => {
    const runtime = createRuntime();
    const target = addToastTarget(runtime);
    target.setAttribute('role', 'status');
    target.setAttribute('aria-live', 'polite');
    target.setAttribute('aria-atomic', 'true');
    load(runtime, 'auth');
    const bootstrap = runtime.sandbox.showToast;
    const payload = '<svg onload="window.pwned=1">Bootstrap literal';
    const hostileType = Object.freeze({
      toString() { throw new Error('notification type must not execute object coercion'); },
    });
    const cases = [
      { label: 'error', type: 'error', role: 'alert', live: 'assertive' },
      { label: 'warning', type: 'warning', role: 'alert', live: 'assertive' },
      { label: 'normalized error', type: ' ERROR ', role: 'alert', live: 'assertive' },
      { label: 'normalized warning', type: 'WaRnInG', role: 'alert', live: 'assertive' },
      { label: 'info', type: 'info', role: 'status', live: 'polite' },
      { label: 'success', type: 'success', role: 'status', live: 'polite' },
      { label: 'unknown', type: '<img src=x onerror=window.pwned=2>', role: 'status', live: 'polite' },
      { label: 'hostile object', type: hostileType, role: 'status', live: 'polite' },
      { label: 'omitted', omitted: true, role: 'status', live: 'polite' },
    ];

    cases.forEach(entry => {
      target.setAttribute('role', 'status');
      target.setAttribute('aria-live', 'polite');
      target.setAttribute('aria-atomic', 'true');
      if (entry.omitted) {
        expect(() => bootstrap(payload)).not.toThrow();
      } else {
        expect(() => bootstrap(payload, entry.type)).not.toThrow();
      }
      expect(target.textContent).toBe(payload);
      expect(runtime.document.innerHtmlAssignments).toEqual([]);
      expect(runtime.sandbox.pwned).toBeUndefined();
      expect(target.getAttribute('role')).toBe(entry.role);
      expect(target.getAttribute('aria-live')).toBe(entry.live);
      expect(target.getAttribute('aria-atomic')).toBe('true');
      expect(target.className).toBe('toast show');
      expect(target.style.background).toBe('');
      expect(runtime.document.body.children.filter(child => child.id === 'toast')).toHaveLength(1);
      expect(jest.getTimerCount()).toBe(1);
      jest.advanceTimersByTime(3499);
      expect(target.classList.contains('show')).toBe(true);
      jest.advanceTimersByTime(1);
      expect(target.classList.contains('show')).toBe(false);
      expect(jest.getTimerCount()).toBe(0);
    });

    load(runtime, 'api');
    load(runtime, 'service');
    expect(runtime.sandbox.showToast).not.toBe(bootstrap);
    const original = runtime.sandbox.NotificationService.showInline;
    let delegated = 0;
    runtime.sandbox.NotificationService.showInline = function (...args) {
      delegated += 1;
      return original.apply(runtime.sandbox.NotificationService, args);
    };
    runtime.sandbox.showToast('Final ownership', 'error');
    expect(delegated).toBe(1);
    expect(target.getAttribute('role')).toBe('alert');
    expect(target.getAttribute('aria-live')).toBe('assertive');
    expect(runtime.document.body.children.filter(child => child.id === 'toast')).toHaveLength(1);
    expect(jest.getTimerCount()).toBe(1);
  });

  test('the four affected mounted pages load the shared facade without changing established page ownership', () => {
    const pages = ['business-profile', 'my-number', 'settings', 'integrations'];
    const inventory = Object.fromEntries(pages.map(name => {
      const html = fs.readFileSync(path.join(ROOT, 'public', 'dashboard', name + '.html'), 'utf8');
      return [name, { html, scripts: scriptsIn(html) }];
    }));

    pages.forEach(name => {
      expect(inventory[name].scripts).toContain('/js/notification-service.js');
      expect(inventory[name].scripts.indexOf('/js/auth-session.js'))
        .toBeLessThan(inventory[name].scripts.indexOf('/js/notification-service.js'));
    });
    ['my-number', 'settings', 'integrations'].forEach(name => {
      expect(inventory[name].scripts.indexOf('/js/notification-service.js'))
        .toBeLessThan(inventory[name].scripts.indexOf('/js/api.js'));
    });
    expect(inventory['business-profile'].html).toMatch(/NotificationService\.showInline\s*\(/);
    expect(inventory['my-number'].html).not.toMatch(/function\s+showToast\s*\(/);
  });
});
