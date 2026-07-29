'use strict';

/**
 * M19 Part 4 — normalizeCommunication input contract regression
 *
 * Executes the COMPLETE real production file public/js/polaris-api.js
 * in a Node VM sandbox. Every assertion runs against the real
 * PolarisApi.normalizeCommunication — nothing is copied, mirrored,
 * or redefined.
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

// ── Frozen contracts ───────────────────────────────────────────────────

const MAX_CUSTOMER_NAME_LENGTH  = 256;
const MAX_CUSTOMER_PHONE_LENGTH = 64;

// ── Load and execute the real production script ────────────────────────

const sourcePath = path.resolve(__dirname, '../../public/js/polaris-api.js');
const source     = fs.readFileSync(sourcePath, 'utf8');

/** Stub for window.CanonicalIntelligence.requireClient().loadCompatibility */
function fakeLoadCompatibility(_surface, _filters) {
  return Promise.resolve({ items: [], metrics: {}, readModelVersion: 1 });
}

const sandbox = {
  window: {
    CanonicalIntelligence: {
      loadCompatibility: fakeLoadCompatibility,
    },
  },
  fetch: function () {
    return Promise.resolve({
      ok: true,
      json: function () { return Promise.resolve({ success: true, data: {} }); },
    });
  },
  Promise: Promise,
  Object: Object,
  Array: Array,
  String: String,
  Number: Number,
  Boolean: Boolean,
  console: console,
  setTimeout: setTimeout,
  setInterval: setInterval,
  clearTimeout: clearTimeout,
  clearInterval: clearInterval,
  location: { href: 'https://test.northstar-os.ai' },
  document: { createElement: function () { return {}; } },
};

vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'polaris-api.js' });

// ── Validate the harness loaded correctly ──────────────────────────────

const PolarisApi = sandbox.window.PolarisApi;

if (!PolarisApi || typeof PolarisApi.normalizeCommunication !== 'function') {
  throw new Error(
    'FAIL: real PolarisApi.normalizeCommunication not found after executing ' +
    'public/js/polaris-api.js — test harness is not authentic'
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

const VALID_UUID_LOWER = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const VALID_UUID_UPPER = VALID_UUID_LOWER.toUpperCase();

function record(overrides) {
  return Object.assign({
    canonical: {
      ids: {
        communication: 'comm-001',
        customer: VALID_UUID_LOWER,
      },
      values: {},
    },
    customer: { name: 'Alice Johnson', phone: '512-555-0100' },
    channel: 'voice',
    direction: 'inbound',
    subject: 'Test call',
    transcript: { text: 'Hello', durationSeconds: 30 },
  }, overrides);
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('M19 Part 4 — normalizeCommunication production contract', () => {

  test('harness loads the real production PolarisApi', () => {
    expect(typeof PolarisApi).toBe('object');
    expect(typeof PolarisApi.normalizeCommunication).toBe('function');
  });

  describe('canonical / ids safety', () => {

    test('canonical absent → null, no throw', () => {
      expect(() => PolarisApi.normalizeCommunication({})).not.toThrow();
      expect(PolarisApi.normalizeCommunication({})).toBeNull();
    });

    test('canonical.ids absent → null, no throw', () => {
      expect(() => PolarisApi.normalizeCommunication({ canonical: {} })).not.toThrow();
      expect(PolarisApi.normalizeCommunication({ canonical: {} })).toBeNull();
    });

    test('canonical.values absent → safe', () => {
      const r = record();
      delete r.canonical.values;
      expect(() => PolarisApi.normalizeCommunication(r)).not.toThrow();
      expect(PolarisApi.normalizeCommunication(r)).not.toBeNull();
    });

    test('canonical present with ids → not null', () => {
      expect(PolarisApi.normalizeCommunication(record())).not.toBeNull();
    });
  });

  describe('customerId', () => {

    test('valid lowercase UUID → preserved', () => {
      const n = PolarisApi.normalizeCommunication(record());
      expect(n.customerId).toBe(VALID_UUID_LOWER);
    });

    test('valid uppercase UUID → preserved', () => {
      const r = record({ canonical: { ids: { communication: 'c1', customer: VALID_UUID_UPPER } } });
      const n = PolarisApi.normalizeCommunication(r);
      expect(n.customerId).toBe(VALID_UUID_UPPER);
    });

    test('malformed UUID → null', () => {
      const r = record({ canonical: { ids: { communication: 'c1', customer: 'not-a-uuid' } } });
      expect(PolarisApi.normalizeCommunication(r).customerId).toBeNull();
    });

    test('empty string → null', () => {
      const r = record({ canonical: { ids: { communication: 'c1', customer: '' } } });
      expect(PolarisApi.normalizeCommunication(r).customerId).toBeNull();
    });

    test('whitespace-only → null', () => {
      const r = record({ canonical: { ids: { communication: 'c1', customer: '   ' } } });
      expect(PolarisApi.normalizeCommunication(r).customerId).toBeNull();
    });

    test('missing ids.customer → null', () => {
      const r = record();
      delete r.canonical.ids.customer;
      expect(PolarisApi.normalizeCommunication(r).customerId).toBeNull();
    });
  });

  describe('customerName — bounded, type-safe', () => {

    test('valid name preserved', () => {
      expect(PolarisApi.normalizeCommunication(record()).customerName).toBe('Alice Johnson');
    });

    test('trims surrounding whitespace', () => {
      const n = PolarisApi.normalizeCommunication(record({ customer: { name: '  Bob  ' } }));
      expect(n.customerName).toBe('Bob');
    });

    test('empty string → null', () => {
      const n = PolarisApi.normalizeCommunication(record({ customer: { name: '' } }));
      expect(n.customerName).toBeNull();
    });

    test('whitespace-only → null', () => {
      const n = PolarisApi.normalizeCommunication(record({ customer: { name: '   ' } }));
      expect(n.customerName).toBeNull();
    });

    test('object name → null, no throw', () => {
      expect(() => PolarisApi.normalizeCommunication(record({ customer: { name: { first: 'Bob' } } }))).not.toThrow();
      expect(PolarisApi.normalizeCommunication(record({ customer: { name: { first: 'Bob' } } })).customerName).toBeNull();
    });

    test('array name → null, no throw', () => {
      expect(() => PolarisApi.normalizeCommunication(record({ customer: { name: ['Bob'] } }))).not.toThrow();
      expect(PolarisApi.normalizeCommunication(record({ customer: { name: ['Bob'] } })).customerName).toBeNull();
    });

    test('number name → null, no throw', () => {
      expect(() => PolarisApi.normalizeCommunication(record({ customer: { name: 42 } }))).not.toThrow();
      expect(PolarisApi.normalizeCommunication(record({ customer: { name: 42 } })).customerName).toBeNull();
    });

    test('boolean name → null, no throw', () => {
      expect(() => PolarisApi.normalizeCommunication(record({ customer: { name: true } }))).not.toThrow();
      expect(PolarisApi.normalizeCommunication(record({ customer: { name: true } })).customerName).toBeNull();
    });

    test('name at max length (256) accepted', () => {
      const long = 'A'.repeat(MAX_CUSTOMER_NAME_LENGTH);
      expect(PolarisApi.normalizeCommunication(record({ customer: { name: long } })).customerName).toBe(long);
    });

    test('name at max+1 → null', () => {
      const tooLong = 'A'.repeat(MAX_CUSTOMER_NAME_LENGTH + 1);
      expect(PolarisApi.normalizeCommunication(record({ customer: { name: tooLong } })).customerName).toBeNull();
    });

    test('100K name → null, no crash', () => {
      const huge = 'A'.repeat(100000);
      expect(() => PolarisApi.normalizeCommunication(record({ customer: { name: huge } }))).not.toThrow();
      expect(PolarisApi.normalizeCommunication(record({ customer: { name: huge } })).customerName).toBeNull();
    });
  });

  describe('customerPhone — bounded, type-safe', () => {

    test('valid phone preserved', () => {
      expect(PolarisApi.normalizeCommunication(record()).customerPhone).toBe('512-555-0100');
    });

    test('trims surrounding whitespace', () => {
      const n = PolarisApi.normalizeCommunication(record({ customer: { phone: '  555-0100  ' } }));
      expect(n.customerPhone).toBe('555-0100');
    });

    test('empty string → null', () => {
      expect(PolarisApi.normalizeCommunication(record({ customer: { phone: '' } })).customerPhone).toBeNull();
    });

    test('whitespace-only → null', () => {
      expect(PolarisApi.normalizeCommunication(record({ customer: { phone: '   ' } })).customerPhone).toBeNull();
    });

    test('object phone → null, no throw', () => {
      expect(() => PolarisApi.normalizeCommunication(record({ customer: { phone: {} } }))).not.toThrow();
      expect(PolarisApi.normalizeCommunication(record({ customer: { phone: {} } })).customerPhone).toBeNull();
    });

    test('array phone → null, no throw', () => {
      expect(() => PolarisApi.normalizeCommunication(record({ customer: { phone: ['555'] } }))).not.toThrow();
      expect(PolarisApi.normalizeCommunication(record({ customer: { phone: ['555'] } })).customerPhone).toBeNull();
    });

    test('number phone → null, no throw', () => {
      expect(() => PolarisApi.normalizeCommunication(record({ customer: { phone: 5550100 } }))).not.toThrow();
      expect(PolarisApi.normalizeCommunication(record({ customer: { phone: 5550100 } })).customerPhone).toBeNull();
    });

    test('phone at max length (64) accepted', () => {
      const long = '5'.repeat(MAX_CUSTOMER_PHONE_LENGTH);
      expect(PolarisApi.normalizeCommunication(record({ customer: { phone: long } })).customerPhone).toBe(long);
    });

    test('phone at max+1 → null', () => {
      const tooLong = '5'.repeat(MAX_CUSTOMER_PHONE_LENGTH + 1);
      expect(PolarisApi.normalizeCommunication(record({ customer: { phone: tooLong } })).customerPhone).toBeNull();
    });
  });

  describe('no-exception safety', () => {

    test('null record does not throw', () => {
      expect(() => PolarisApi.normalizeCommunication(null)).not.toThrow();
    });

    test('undefined record does not throw', () => {
      expect(() => PolarisApi.normalizeCommunication(undefined)).not.toThrow();
    });

    test('customer absent does not throw', () => {
      const r = record();
      delete r.customer;
      expect(() => PolarisApi.normalizeCommunication(r)).not.toThrow();
      const n = PolarisApi.normalizeCommunication(r);
      expect(n.customerName).toBeNull();
      expect(n.customerPhone).toBeNull();
    });

    test('valid data round-trips', () => {
      const n = PolarisApi.normalizeCommunication(record());
      expect(n.customerId).toBe(VALID_UUID_LOWER);
      expect(n.customerName).toBe('Alice Johnson');
      expect(n.customerPhone).toBe('512-555-0100');
      expect(n.id).toBe('comm-001');
    });
  });
});
