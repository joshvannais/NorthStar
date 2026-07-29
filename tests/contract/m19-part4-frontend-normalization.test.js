'use strict';

/**
 * M19 Part 4 — normalizeCommunication input contract regression
 *
 * Mirrors the exact normalization logic from public/js/polaris-api.js
 * normalizeCommunication(). Tests the frozen contract: primitive strings only,
 * bounded lengths, null-or-valid UUID for customerId.
 */

// ── Mirrored normalization (must stay in sync with polaris-api.js) ──────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Shared bounds — define here as the contract, apply in production fix
const MAX_CUSTOMER_NAME_LENGTH  = 256;
const MAX_CUSTOMER_PHONE_LENGTH = 64;

function normalizeCommunication(record) {
  if (!record || !record.canonical || !record.canonical.ids) return null;

  const rawId = record.canonical.ids.customer;
  const customer = record.customer || {};

  // ── customerId: only a canonical UUID string, no coercion ──────────
  const customerId = (typeof rawId === 'string' && UUID_RE.test(rawId)) ? rawId : null;

  // ── customerName: primitive string, trim, bounded ──────────────────
  let name = null;
  if (typeof customer.name === 'string') {
    const trimmed = customer.name.trim();
    if (trimmed.length > 0 && trimmed.length <= MAX_CUSTOMER_NAME_LENGTH) {
      name = trimmed;
    }
  }

  // ── customerPhone: primitive string, trim, bounded ─────────────────
  let phone = null;
  if (typeof customer.phone === 'string') {
    const trimmed = customer.phone.trim();
    if (trimmed.length > 0 && trimmed.length <= MAX_CUSTOMER_PHONE_LENGTH) {
      phone = trimmed;
    }
  }

  return {
    id: record.canonical.ids.communication,
    customerId,
    customerName: name,
    customerPhone: phone,
    type: record.channel,
    direction: record.direction,
    subject: record.subject,
    content: record.transcript && record.transcript.text,
    duration: record.transcript && record.transcript.durationSeconds,
    canonical: record.canonical,
    readOnly: true,
  };
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

describe('M19 Part 4 — normalizeCommunication input contract', () => {

  describe('canonical / ids safety', () => {
    test('canonical absent → null', () => {
      expect(normalizeCommunication({})).toBeNull();
    });
    test('canonical.ids absent → null', () => {
      expect(normalizeCommunication({ canonical: {} })).toBeNull();
    });
    test('canonical present with ids → not null', () => {
      expect(normalizeCommunication(record())).not.toBeNull();
    });
  });

  describe('customerId', () => {
    test('valid lowercase UUID → preserved', () => {
      const n = normalizeCommunication(record());
      expect(n.customerId).toBe(VALID_UUID_LOWER);
    });
    test('valid uppercase UUID → preserved', () => {
      const n = normalizeCommunication(record({ canonical: { ids: { communication: 'c1', customer: VALID_UUID_UPPER } } }));
      expect(n.customerId).toBe(VALID_UUID_UPPER);
    });
    test('malformed UUID → null', () => {
      const n = normalizeCommunication(record({ canonical: { ids: { communication: 'c1', customer: 'not-a-uuid' } } }));
      expect(n.customerId).toBeNull();
    });
    test('empty string → null', () => {
      const n = normalizeCommunication(record({ canonical: { ids: { communication: 'c1', customer: '' } } }));
      expect(n.customerId).toBeNull();
    });
    test('whitespace-only → null', () => {
      const n = normalizeCommunication(record({ canonical: { ids: { communication: 'c1', customer: '   ' } } }));
      expect(n.customerId).toBeNull();
    });
    test('missing ids.customer → null', () => {
      const r = record();
      delete r.canonical.ids.customer;
      const n = normalizeCommunication(r);
      expect(n.customerId).toBeNull();
    });
  });

  describe('customerName', () => {
    test('valid name preserved', () => {
      const n = normalizeCommunication(record());
      expect(n.customerName).toBe('Alice Johnson');
    });
    test('trims surrounding whitespace', () => {
      const n = normalizeCommunication(record({ customer: { name: '  Bob  ' } }));
      expect(n.customerName).toBe('Bob');
    });
    test('empty string → null', () => {
      const n = normalizeCommunication(record({ customer: { name: '' } }));
      expect(n.customerName).toBeNull();
    });
    test('whitespace-only → null', () => {
      const n = normalizeCommunication(record({ customer: { name: '   ' } }));
      expect(n.customerName).toBeNull();
    });
    test('object name → null (no crash)', () => {
      const n = normalizeCommunication(record({ customer: { name: { first: 'Bob' } } }));
      expect(n.customerName).toBeNull();
    });
    test('array name → null (no crash)', () => {
      const n = normalizeCommunication(record({ customer: { name: ['Bob'] } }));
      expect(n.customerName).toBeNull();
    });
    test('number name → null (no crash)', () => {
      const n = normalizeCommunication(record({ customer: { name: 42 } }));
      expect(n.customerName).toBeNull();
    });
    test('boolean name → null (no crash)', () => {
      const n = normalizeCommunication(record({ customer: { name: true } }));
      expect(n.customerName).toBeNull();
    });
    test('name at max length (256) accepted', () => {
      const long = 'A'.repeat(MAX_CUSTOMER_NAME_LENGTH);
      const n = normalizeCommunication(record({ customer: { name: long } }));
      expect(n.customerName).toBe(long);
    });
    test('name at max+1 → null', () => {
      const tooLong = 'A'.repeat(MAX_CUSTOMER_NAME_LENGTH + 1);
      const n = normalizeCommunication(record({ customer: { name: tooLong } }));
      expect(n.customerName).toBeNull();
    });
    test('100K name → null, no crash', () => {
      const huge = 'A'.repeat(100000);
      const n = normalizeCommunication(record({ customer: { name: huge } }));
      expect(n.customerName).toBeNull();
    });
  });

  describe('customerPhone', () => {
    test('valid phone preserved', () => {
      const n = normalizeCommunication(record());
      expect(n.customerPhone).toBe('512-555-0100');
    });
    test('trims surrounding whitespace', () => {
      const n = normalizeCommunication(record({ customer: { phone: '  555-0100  ' } }));
      expect(n.customerPhone).toBe('555-0100');
    });
    test('empty string → null', () => {
      const n = normalizeCommunication(record({ customer: { phone: '' } }));
      expect(n.customerPhone).toBeNull();
    });
    test('whitespace-only → null', () => {
      const n = normalizeCommunication(record({ customer: { phone: '   ' } }));
      expect(n.customerPhone).toBeNull();
    });
    test('object phone → null (no crash)', () => {
      const n = normalizeCommunication(record({ customer: { phone: {} } }));
      expect(n.customerPhone).toBeNull();
    });
    test('array phone → null (no crash)', () => {
      const n = normalizeCommunication(record({ customer: { phone: ['555'] } }));
      expect(n.customerPhone).toBeNull();
    });
    test('number phone → null (no crash)', () => {
      const n = normalizeCommunication(record({ customer: { phone: 5550100 } }));
      expect(n.customerPhone).toBeNull();
    });
    test('phone at max length (64) accepted', () => {
      const long = '5'.repeat(MAX_CUSTOMER_PHONE_LENGTH);
      const n = normalizeCommunication(record({ customer: { phone: long } }));
      expect(n.customerPhone).toBe(long);
    });
    test('phone at max+1 → null', () => {
      const tooLong = '5'.repeat(MAX_CUSTOMER_PHONE_LENGTH + 1);
      const n = normalizeCommunication(record({ customer: { phone: tooLong } }));
      expect(n.customerPhone).toBeNull();
    });
  });

  describe('no-exception safety', () => {
    test('null record does not throw', () => {
      expect(() => normalizeCommunication(null)).not.toThrow();
    });
    test('undefined record does not throw', () => {
      expect(() => normalizeCommunication(undefined)).not.toThrow();
    });
    test('customer absent does not throw', () => {
      const r = record();
      delete r.customer;
      expect(() => normalizeCommunication(r)).not.toThrow();
      expect(normalizeCommunication(r).customerName).toBeNull();
      expect(normalizeCommunication(r).customerPhone).toBeNull();
    });
    test('valid data round-trips', () => {
      const n = normalizeCommunication(record());
      expect(n.customerId).toBe(VALID_UUID_LOWER);
      expect(n.customerName).toBe('Alice Johnson');
      expect(n.customerPhone).toBe('512-555-0100');
      expect(n.id).toBe('comm-001');
    });
  });
});
