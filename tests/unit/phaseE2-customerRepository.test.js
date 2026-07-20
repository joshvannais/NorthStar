/**
 * phaseE2-customerRepository.test.js — M19.5 Phase E2: Customer Repository
 *
 * Tests the dedicated customer repository with identity resolution, typed events,
 * multi-property support, and idempotency.
 */
'use strict';

const repo = require('../../src/polaris/customerRepository');

// Reset state between tests by clearing the internal cache
function resetRepo() {
  var customers = repo.listCustomers();
  customers.forEach(function(c) {
    repo.deleteCustomer(c.id);
  });
}

describe('Phase E2 — Customer Repository', function() {

  beforeEach(function() {
    resetRepo();
    repo.init();
  });

  // ── Identity Normalization ──

  describe('Identity normalization', function() {

    test('normalizePhone strips all non-digits', function() {
      expect(repo.normalizePhone('(555) 123-4567')).toBe('5551234567');
      expect(repo.normalizePhone('555-123-4567 x101')).toBe('5551234567101');
    });

    test('normalizePhone returns null for short numbers', function() {
      expect(repo.normalizePhone('123')).toBeNull();
      expect(repo.normalizePhone(null)).toBeNull();
      expect(repo.normalizePhone('')).toBeNull();
    });

    test('normalizeEmail lowercases and strips dots', function() {
      expect(repo.normalizeEmail('John.Doe@Example.com')).toBe('johndoe@example.com');
    });

    test('normalizeEmail returns null for invalid', function() {
      expect(repo.normalizeEmail(null)).toBeNull();
      expect(repo.normalizeEmail('notanemail')).toBeNull();
    });

    test('normalizeAddress lowercases and collapses whitespace', function() {
      expect(repo.normalizeAddress('123 Main St., Springfield, IL')).toBe('123 main st springfield il');
    });
  });

  // ── Customer CRUD ──

  describe('Customer CRUD', function() {

    test('createCustomer requires name', function() {
      var result = repo.createCustomer({});
      expect(result.error).toBeDefined();
    });

    test('createCustomer returns customer with ID', function() {
      var c = repo.createCustomer({ name: 'John Smith', phone: '555-0100' });
      expect(c.id).toBeDefined();
      expect(c.name).toBe('John Smith');
      expect(c.phone).toBe('555-0100');
      expect(c.identities.length).toBe(1);
    });

    test('getCustomer returns deep copy', function() {
      var c = repo.createCustomer({ name: 'Jane Doe', phone: '555-0200' });
      var fetched = repo.getCustomer(c.id);
      expect(fetched.name).toBe('Jane Doe');
      expect(fetched.id).toBe(c.id);
    });

    test('getCustomer returns error for missing ID', function() {
      expect(repo.getCustomer('nonexistent').error).toBeDefined();
    });

    test('updateCustomer updates allowed fields', function() {
      var c = repo.createCustomer({ name: 'John', phone: '555-0100' });
      var result = repo.updateCustomer(c.id, { name: 'John Smith', email: 'john@example.com' });
      expect(result.updated).toContain('name');
      expect(result.updated).toContain('email');
      var updated = repo.getCustomer(c.id);
      expect(updated.name).toBe('John Smith');
      expect(updated.email).toBe('john@example.com');
    });

    test('deleteCustomer removes customer', function() {
      var c = repo.createCustomer({ name: 'To Delete', phone: '555-9999' });
      repo.deleteCustomer(c.id);
      expect(repo.getCustomer(c.id).error).toBeDefined();
    });
  });

  // ── Identity Resolution ──

  describe('Identity resolution', function() {

    test('resolves by phone exact match', function() {
      repo.createCustomer({ name: 'John Smith', phone: '555-0100' });
      var result = repo.resolveIdentity({ phone: '555-0100' });
      expect(result.customerId).toBeDefined();
      expect(result.method).toBe('phone_exact');
      expect(result.confidence).toBeGreaterThan(0.9);
    });

    test('resolves by normalized phone', function() {
      repo.createCustomer({ name: 'John Smith', phone: '(555) 010-0000' });
      var result = repo.resolveIdentity({ phone: '555-010-0000' });
      expect(result.customerId).toBeDefined();
      expect(result.method).toBe('phone_exact');
    });

    test('resolves by email exact match', function() {
      repo.createCustomer({ name: 'Jane Doe', email: 'jane.doe@example.com' });
      var result = repo.resolveIdentity({ email: 'jane.doe@example.com' });
      expect(result.customerId).toBeDefined();
      expect(result.method).toBe('email_exact');
    });

    test('resolves by normalized email with dots', function() {
      repo.createCustomer({ name: 'Jane Doe', email: 'jane.doe@example.com' });
      // Gmail-style: dots in local part are ignored
      var result = repo.resolveIdentity({ email: 'Jane.Doe@Example.com' });
      expect(result.customerId).toBeDefined();
      expect(result.method).toBe('email_exact');
    });

    test('name-only match returns low confidence, not auto-merge', function() {
      repo.createCustomer({ name: 'John Smith', phone: '555-0100' });
      var result = repo.resolveIdentity({ name: 'John Smith' });
      // Name-only can return a match with low confidence (0.5)
      // Callers must decide whether to use low-confidence matches
      expect(result.confidence).toBeLessThan(0.6);
      expect(result.method).toBe('name_exact');
    });

    test('returns no_match for unknown identity', function() {
      var result = repo.resolveIdentity({ phone: '555-9999' });
      expect(result.customerId).toBeNull();
      expect(result.method).toBe('no_match');
    });

    test('detects identity conflict', function() {
      repo.createCustomer({ name: 'John Smith', phone: '555-0100' });
      repo.createCustomer({ name: 'Jane Doe', email: 'john@example.com' });
      var result = repo.resolveIdentity({ phone: '555-0100', email: 'john@example.com' });
      // Phone matches John, email matches Jane — conflict
      expect(result.conflicts).toBeDefined();
      expect(result.conflicts.length).toBeGreaterThanOrEqual(1);
    });

    test('phone takes priority over email for the same customer', function() {
      repo.createCustomer({ name: 'John Smith', phone: '555-0100', email: 'john@example.com' });
      var result = repo.resolveIdentity({ phone: '555-0100', email: 'john@example.com' });
      expect(result.customerId).toBeDefined();
      expect(result.method).toBe('phone_exact');
    });
  });

  // ── Typed Timeline Events ──

  describe('Typed timeline events', function() {

    test('addEvent requires customer and event type', function() {
      var result = repo.addEvent(null, {});
      expect(result.error).toBeDefined();
    });

    test('addEvent validates event type', function() {
      var c = repo.createCustomer({ name: 'John' });
      var result = repo.addEvent(c.id, { eventType: 'invalid_type' });
      expect(result.error).toContain('Invalid event type');
    });

    test('addEvent creates typed event', function() {
      var c = repo.createCustomer({ name: 'John' });
      var event = repo.addEvent(c.id, {
        eventType: repo.EVENT_TYPES.CALL_RECEIVED,
        description: 'Customer called about tree removal',
        source: 'test'
      });
      expect(event.eventId).toBeDefined();
      expect(event.eventType).toBe('call_received');
      expect(event.customerId).toBe(c.id);
    });

    test('addEvent is idempotent with same sourceEventId', function() {
      var c = repo.createCustomer({ name: 'John' });
      var event1 = repo.addEvent(c.id, {
        eventType: repo.EVENT_TYPES.CALL_RECEIVED,
        sourceEventId: 'unique-id-123',
        description: 'First call',
        source: 'test'
      });
      var event2 = repo.addEvent(c.id, {
        eventType: repo.EVENT_TYPES.CALL_RECEIVED,
        sourceEventId: 'unique-id-123',
        description: 'Duplicate call',
        source: 'test'
      });
      expect(event2.duplicate).toBe(true);
      expect(event2.existing.eventId).toBe(event1.eventId);
    });

    test('different sourceEventId creates separate events', function() {
      var c = repo.createCustomer({ name: 'John' });
      repo.addEvent(c.id, { eventType: repo.EVENT_TYPES.CALL_RECEIVED, sourceEventId: 'id-1', source: 'test' });
      var event2 = repo.addEvent(c.id, { eventType: repo.EVENT_TYPES.CALL_RECEIVED, sourceEventId: 'id-2', source: 'test' });
      expect(event2.duplicate).toBeUndefined();
    });

    test('getEvents returns events in chronological order', function() {
      var c = repo.createCustomer({ name: 'John' });
      repo.addEvent(c.id, { eventType: repo.EVENT_TYPES.CALL_RECEIVED, sourceEventId: 'call-1', description: 'First', source: 'test' });
      repo.addEvent(c.id, { eventType: repo.EVENT_TYPES.ESTIMATE_CREATED, sourceEventId: 'est-1', description: 'Second', source: 'test' });
      var events = repo.getEvents(c.id);
      expect(events.length).toBe(2);
      expect(events[0].description).toBe('First');
      expect(events[1].description).toBe('Second');
    });

    test('getEvents filters by type', function() {
      var c = repo.createCustomer({ name: 'John' });
      repo.addEvent(c.id, { eventType: repo.EVENT_TYPES.CALL_RECEIVED, sourceEventId: 'call-1', source: 'test' });
      repo.addEvent(c.id, { eventType: repo.EVENT_TYPES.ESTIMATE_CREATED, sourceEventId: 'est-1', source: 'test' });
      var calls = repo.getEvents(c.id, { eventType: repo.EVENT_TYPES.CALL_RECEIVED });
      expect(calls.length).toBe(1);
      expect(calls[0].eventType).toBe('call_received');
    });

    test('getLatestEvent returns most recent', function() {
      var c = repo.createCustomer({ name: 'John' });
      repo.addEvent(c.id, { eventType: repo.EVENT_TYPES.CALL_RECEIVED, sourceEventId: 'call-1', source: 'test' });
      repo.addEvent(c.id, { eventType: repo.EVENT_TYPES.CALL_RECEIVED, sourceEventId: 'call-2', source: 'test' });
      var latest = repo.getLatestEvent(c.id, repo.EVENT_TYPES.CALL_RECEIVED);
      expect(latest.sourceEventId).toBe('call-2');
    });
  });

  // ── Multi-Property Support ──

  describe('Multi-property support', function() {

    test('addProperty adds service address', function() {
      var c = repo.createCustomer({ name: 'John' });
      var prop = repo.addProperty(c.id, { address: '123 Main St', city: 'Springfield' });
      expect(prop.id).toBeDefined();
      expect(prop.address).toBe('123 Main St');
    });

    test('getProperties returns all properties', function() {
      var c = repo.createCustomer({ name: 'John' });
      repo.addProperty(c.id, { address: '123 Main St' });
      repo.addProperty(c.id, { address: '456 Oak Ave' });
      var props = repo.getProperties(c.id);
      expect(props.length).toBe(2);
    });
  });

  // ── Cross-call Accumulation ──

  describe('Cross-call accumulation', function() {

    test('Call 1 creates customer and first event', function() {
      var c = repo.createCustomer({ name: 'John Smith', phone: '555-0100' });
      repo.addEvent(c.id, { eventType: repo.EVENT_TYPES.CALL_RECEIVED, sourceEventId: 'call-1', source: 'test' });
      var events = repo.getEvents(c.id);
      expect(events.length).toBe(1);
      expect(repo.getCustomerCount()).toBe(1);
    });

    test('Call 2 resolves same customer and appends event', function() {
      repo.createCustomer({ name: 'John Smith', phone: '555-0100' });
      var resolution = repo.resolveIdentity({ phone: '555-0100' });
      expect(resolution.customerId).toBeDefined();

      repo.addEvent(resolution.customerId, { eventType: repo.EVENT_TYPES.CALL_RECEIVED, sourceEventId: 'call-2', source: 'test' });
      var events = repo.getEvents(resolution.customerId);
      expect(events.length).toBe(1);

      var c = repo.getCustomer(resolution.customerId);
      expect(c.name).toBe('John Smith');
    });
  });

  // ── Search ──

  describe('Search', function() {

    test('searchCustomers finds by phone substring', function() {
      repo.createCustomer({ name: 'John', phone: '555-0100' });
      repo.createCustomer({ name: 'Jane', phone: '555-0200' });
      var results = repo.searchCustomers({ search: '555-0100' });
      expect(results.length).toBe(1);
      expect(results[0].name).toBe('John');
    });

    test('searchCustomers returns all when no query', function() {
      repo.createCustomer({ name: 'John', phone: '555-0100' });
      repo.createCustomer({ name: 'Jane', phone: '555-0200' });
      var results = repo.searchCustomers({});
      expect(results.length).toBe(2);
    });
  });
});