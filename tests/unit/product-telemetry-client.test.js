'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../public/js/product-telemetry.js'), 'utf8');

function storage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

function page(sharedStorage, options = {}) {
  const listeners = new Map();
  const requests = [];
  const documentListeners = new Map();
  const document = {
    readyState: 'complete',
    addEventListener(type, listener) { documentListeners.set(type, listener); },
    getElementById() { return null; },
  };
  const window = {
    location: { pathname: options.pathname || '/demo' },
    navigator: {
      doNotTrack: options.doNotTrack || '0',
      globalPrivacyControl: options.globalPrivacyControl === true,
    },
    sessionStorage: sharedStorage,
    localStorage: storage(),
    fetch(url, request) {
      requests.push({ url, request, body: JSON.parse(request.body) });
      return Promise.resolve({ status: 202 });
    },
    addEventListener(type, listener) {
      const values = listeners.get(type) || [];
      values.push(listener);
      listeners.set(type, values);
    },
    clearTimeout() {},
    setTimeout() { return 1; },
  };
  if (options.consent !== false) window.localStorage.setItem('northstar_telemetry_consent_v1', 'granted');
  window.window = window;
  const context = vm.createContext({ window, document, Date, JSON, Object, Array, String, Boolean, RegExp });
  vm.runInContext(source, context, { filename: 'product-telemetry.js' });
  return {
    requests,
    dispatch(type, event = {}) {
      for (const listener of listeners.get(type) || []) listener(event);
    },
  };
}

describe('browser product telemetry exit delivery', () => {
  test('stays inactive until the privacy decision records explicit consent', () => {
    const sharedStorage = storage();
    const inactive = page(sharedStorage, { pathname: '/demo', consent: false });
    inactive.dispatch('pagehide');
    expect(inactive.requests).toEqual([]);
  });

  test('pagehide performs no network request and the next page flushes the bounded exit event', () => {
    const sharedStorage = storage();
    const first = page(sharedStorage, { pathname: '/demo' });
    expect(first.requests.map(item => item.body.event)).toEqual(['page_view']);

    first.dispatch('pagehide');
    expect(first.requests.map(item => item.body.event)).toEqual(['page_view']);

    const second = page(sharedStorage, { pathname: '/demo/leads' });
    expect(second.requests.map(item => item.body.event)).toEqual(['page_exit', 'page_view']);
    expect(second.requests[0].body).toEqual({
      event: 'page_exit', surface: 'demo', routeClass: 'demo_command_center',
      action: 'none', elapsedBucket: 'under_15s',
    });
    expect(second.requests.every(item => item.request.keepalive === undefined)).toBe(true);
  });

  test('privacy opt-out clears pending exit telemetry without transmitting it', () => {
    const sharedStorage = storage();
    const first = page(sharedStorage, { pathname: '/dashboard' });
    first.dispatch('pagehide');

    const optedOut = page(sharedStorage, { pathname: '/dashboard/leads', globalPrivacyControl: true });
    expect(optedOut.requests).toEqual([]);

    const later = page(sharedStorage, { pathname: '/dashboard/leads' });
    expect(later.requests.map(item => item.body.event)).toEqual(['page_view']);
  });
});
