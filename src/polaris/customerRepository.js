/**
 * customerRepository.js — M19.5 Phase E2: Dedicated Customer Repository
 *
 * File-backed persistent repository for customer profiles, typed timeline events,
 * multi-property support, and identity resolution.
 *
 * Replaces the customer-engine's piggybacking on the recommendations store with
 * a dedicated storage layer.
 *
 * Architecture:
 * - Each customer has a UUID, stable ID, optional business/tenant ID
 * - Multiple properties per customer (service history, billing separation)
 * - Typed timeline events with sourceEventId for idempotency
 * - Identity index: phone → customerId, email → customerId
 * - Normalized identity matching (exact phone, exact email)
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('../services/dataPaths');

const DATA_DIR = getDataDir();
const FILE_PATH = path.join(DATA_DIR, 'polaris-customers.json');

// ── In-memory cache ──
let _customers = {};
let _initDone = false;

// ── Event Types ──
const EVENT_TYPES = {
  CALL_RECEIVED: 'call_received',
  ESTIMATE_REQUESTED: 'estimate_requested',
  ESTIMATE_CREATED: 'estimate_created',
  ESTIMATE_SENT: 'estimate_sent',
  ESTIMATE_ACCEPTED: 'estimate_accepted',
  ESTIMATE_DECLINED: 'estimate_declined',
  APPOINTMENT_SCHEDULED: 'appointment_scheduled',
  JOB_COMPLETED: 'job_completed',
  INVOICE_CREATED: 'invoice_created',
  INVOICE_PAID: 'invoice_paid',
  COMPLAINT_RECEIVED: 'complaint_received',
  WARRANTY_REQUESTED: 'warranty_requested',
  FOLLOW_UP_COMPLETED: 'follow_up_completed',
  MANUAL_NOTE: 'manual_note'
};

// ── Helpers ──

function _generateId() {
  return crypto.randomUUID();
}

function _now() {
  return new Date().toISOString();
}

// ── Persistence ──

function _load() {
  if (_initDone) return;
  try {
    if (fs.existsSync(FILE_PATH)) {
      const raw = fs.readFileSync(FILE_PATH, 'utf8');
      const data = JSON.parse(raw);
      _customers = {};
      (data.customers || []).forEach(function(c) {
        if (c && c.id) {
          _customers[c.id] = c;
        }
      });
      console.log('[CustomerRepo] Loaded ' + Object.keys(_customers).length + ' customers');
    } else {
      _customers = {};
      _save();
      console.log('[CustomerRepo] Initialized (empty)');
    }
  } catch (err) {
    console.warn('[CustomerRepo] Error loading:', err.message);
    _customers = {};
  }
  _initDone = true;
}

function _save() {
  try {
    const dir = path.dirname(FILE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data = {
      version: 2,
      updatedAt: _now(),
      customers: Object.keys(_customers).map(function(k) { return _customers[k]; })
    };
    fs.writeFileSync(FILE_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.warn('[CustomerRepo] Error saving:', err.message);
  }
}

// ── Identity Normalization ──

/**
 * Normalize a phone number for exact matching.
 * Strips all non-digit characters.
 */
function normalizePhone(phone) {
  if (!phone || typeof phone !== 'string') return null;
  var digits = phone.replace(/\D/g, '');
  return digits.length >= 7 ? digits : null; // Require at least 7 digits
}

/**
 * Normalize an email address for exact matching.
 * Lowercases and strips dots before @ (Gmail-style normalization).
 */
function normalizeEmail(email) {
  if (!email || typeof email !== 'string') return null;
  var lower = email.toLowerCase().trim();
  var parts = lower.split('@');
  if (parts.length !== 2) return null;
  // Strip dots in the local part for Gmail-style normalization
  // This is safe because dots in the local part of email addresses
  // are ignored by most major providers
  var local = parts[0].replace(/\./g, '');
  return local + '@' + parts[1];
}

/**
 * Normalize an address string for fuzzy matching.
 * Lowercases, collapses whitespace, removes punctuation.
 */
function normalizeAddress(address) {
  if (!address || typeof address !== 'string') return null;
  return address.toLowerCase().replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, ' ').replace(/\s+/g, ' ').trim();
}

// ── Identity Index ──

/**
 * Build an identity index for fast lookups.
 * Maps normalized phone/email → customer ID.
 */
function _buildIdentityIndex() {
  var index = {
    phones: {},
    emails: {}
  };
  Object.keys(_customers).forEach(function(id) {
    var c = _customers[id];
    if (c.phone) {
      var np = normalizePhone(c.phone);
      if (np) index.phones[np] = id;
    }
    if (c.email) {
      var ne = normalizeEmail(c.email);
      if (ne) index.emails[ne] = id;
    }
    // Also index from identities array
    (c.identities || []).forEach(function(ident) {
      if (ident.type === 'phone' && ident.value) {
        var np = normalizePhone(ident.value);
        if (np) index.phones[np] = id;
      }
      if (ident.type === 'email' && ident.value) {
        var ne = normalizeEmail(ident.value);
        if (ne) index.emails[ne] = id;
      }
    });
  });
  return index;
}

// ── Identity Resolution ──

/**
 * Resolve a set of identity signals to an existing customer ID.
 * Uses confidence-weighted matching:
 * - Phone exact match: high confidence
 * - Email exact match: high confidence
 * - Phone + name match: very high confidence
 * - Name-only match: low confidence (not used for auto-merge)
 *
 * Returns: { customerId, confidence, method, evidence }
 */
function resolveIdentity(signals) {
  var index = _buildIdentityIndex();
  var results = [];

  // Normalize input signals
  var phone = signals.phone ? normalizePhone(signals.phone) : null;
  var email = signals.email ? normalizeEmail(signals.email) : null;
  var name = signals.name ? signals.name.trim() : null;

  // 1. Phone exact match (highest confidence)
  if (phone && index.phones[phone]) {
    results.push({
      customerId: index.phones[phone],
      confidence: 0.95,
      method: 'phone_exact',
      evidence: 'Phone number matches customer ' + index.phones[phone]
    });
  }

  // 2. Email exact match
  if (email && index.emails[email]) {
    // Check if it's the same customer as phone match
    if (results.length > 0 && results[0].customerId !== index.emails[email]) {
      // Conflict: phone and email match different customers
      results.push({
        customerId: index.emails[email],
        confidence: 0.9,
        method: 'email_exact',
        evidence: 'Email matches different customer ' + index.emails[email],
        conflict: true
      });
    } else {
      results.push({
        customerId: index.emails[email],
        confidence: 0.9,
        method: 'email_exact',
        evidence: 'Email matches customer ' + index.emails[email]
      });
    }
  }

  // 3. Name-only search (low confidence, not used for auto-merge)
  if (name && results.length === 0) {
    var nameMatches = Object.keys(_customers).filter(function(id) {
      var c = _customers[id];
      return c.name && c.name.toLowerCase() === name.toLowerCase();
    });
    if (nameMatches.length === 1) {
      results.push({
        customerId: nameMatches[0],
        confidence: 0.5,
        method: 'name_exact',
        evidence: 'Exact name match with single customer'
      });
    } else if (nameMatches.length > 1) {
      results.push({
        customerId: nameMatches[0],
        confidence: 0.3,
        method: 'name_ambiguous',
        evidence: nameMatches.length + ' customers share this name',
        ambiguous: true
      });
    }
  }

  // Sort by confidence descending
  results.sort(function(a, b) { return b.confidence - a.confidence; });

  if (results.length === 0) {
    return { customerId: null, confidence: 0, method: 'no_match', evidence: 'No matching identity found' };
  }

  // Check for conflicts
  var conflict = results.filter(function(r) { return r.conflict; });
  if (conflict.length > 0) {
    return {
      customerId: results[0].customerId,
      confidence: results[0].confidence,
      method: results[0].method + '_conflict',
      evidence: 'Identity conflict: ' + conflict.map(function(r) { return r.evidence; }).join('; '),
      conflicts: conflict.map(function(r) { return r.customerId; })
    };
  }

  return results[0];
}

// ── Customer CRUD ──

/**
 * Create a new customer record.
 *
 * @param {object} data - { name, phone, email, address, businessId }
 * @returns {object} The created customer
 */
function createCustomer(data) {
  _load();
  if (!data || !data.name) {
    return { error: 'Customer name is required' };
  }
  var now = _now();
  var id = _generateId();

  var customer = {
    id: id,
    name: data.name,
    phone: data.phone || null,
    email: data.email || null,
    businessId: data.businessId || null,
    status: 'active',
    tags: [],
    properties: [],   // Multi-property support
    identities: [],    // Known identity signals (phone, email)
    events: [],        // Typed timeline events
    metadata: {},
    createdAt: now,
    updatedAt: now,
    lastContactedAt: null,
    totalJobs: 0,
    totalRevenue: 0
  };

  // Index known identities
  if (data.phone) {
    customer.identities.push({ type: 'phone', value: data.phone, verified: true, addedAt: now });
  }
  if (data.email) {
    customer.identities.push({ type: 'email', value: data.email, verified: true, addedAt: now });
  }

  _customers[id] = customer;
  _save();
  return customer;
}

/**
 * Get a customer by ID.
 */
function getCustomer(id) {
  _load();
  if (!id) return { error: 'Customer ID is required' };
  if (!_customers[id]) return { error: 'Customer not found: ' + id };
  return JSON.parse(JSON.stringify(_customers[id])); // Deep clone
}

/**
 * Update customer fields.
 */
function updateCustomer(id, updates) {
  _load();
  if (!id) return { error: 'Customer ID is required' };
  var customer = _customers[id];
  if (!customer) return { error: 'Customer not found: ' + id };

  var allowed = ['name', 'phone', 'email', 'address', 'status', 'tags', 'metadata'];
  var changed = [];

  allowed.forEach(function(key) {
    if (updates[key] !== undefined) {
      customer[key] = updates[key];
      changed.push(key);
    }
  });

  // Update identities index when phone/email changes
  if (updates.phone && updates.phone !== customer.phone) {
    var exists = customer.identities.some(function(i) { return i.type === 'phone' && i.value === updates.phone; });
    if (!exists) {
      customer.identities.push({ type: 'phone', value: updates.phone, verified: true, addedAt: _now() });
    }
  }
  if (updates.email && updates.email !== customer.email) {
    var exists = customer.identities.some(function(i) { return i.type === 'email' && i.value === updates.email; });
    if (!exists) {
      customer.identities.push({ type: 'email', value: updates.email, verified: true, addedAt: _now() });
    }
  }

  if (changed.length > 0) {
    customer.updatedAt = _now();
    _save();
  }

  return { id: id, updated: changed, updatedAt: customer.updatedAt };
}

// ── Properties (Multi-Property Support) ──

/**
 * Add a property (service address) to a customer.
 */
function addProperty(customerId, propertyData) {
  _load();
  if (!customerId) return { error: 'Customer ID is required' };
  var customer = _customers[customerId];
  if (!customer) return { error: 'Customer not found: ' + customerId };
  if (!propertyData || !propertyData.address) return { error: 'Property address is required' };

  var prop = {
    id: _generateId(),
    address: propertyData.address,
    city: propertyData.city || null,
    stateOrRegion: propertyData.stateOrRegion || null,
    postalCode: propertyData.postalCode || null,
    label: propertyData.label || null,
    type: propertyData.type || 'service',
    addedAt: _now(),
    updatedAt: _now()
  };

  customer.properties.push(prop);
  customer.updatedAt = _now();
  _save();
  return prop;
}

/**
 * Get all properties for a customer.
 */
function getProperties(customerId) {
  if (!customerId) return { error: 'Customer ID is required' };
  var customer = _customers[customerId];
  if (!customer) return { error: 'Customer not found: ' + customerId };
  return JSON.parse(JSON.stringify(customer.properties));
}

// ── Typed Timeline Events ──

/**
 * Add a typed timeline event to a customer.
 * Idempotent: same sourceEventId will not create a duplicate.
 *
 * @param {string} customerId
 * @param {object} event - { eventType, sourceEventId, occurredAt, description, source, evidence, data }
 * @returns {object} The created event, or { duplicate: true, existing } if already exists
 */
function addEvent(customerId, event) {
  _load();
  if (!customerId) return { error: 'Customer ID is required' };
  var customer = _customers[customerId];
  if (!customer) return { error: 'Customer not found: ' + customerId };

  if (!event || !event.eventType) return { error: 'Event type is required' };

  // Validate event type
  var validTypes = Object.keys(EVENT_TYPES).map(function(k) { return EVENT_TYPES[k]; });
  if (validTypes.indexOf(event.eventType) === -1) {
    return { error: 'Invalid event type: ' + event.eventType + '. Valid: ' + validTypes.join(', ') };
  }

  // Idempotency check
  if (event.sourceEventId) {
    var existing = customer.events.filter(function(e) {
      return e.sourceEventId === event.sourceEventId && e.eventType === event.eventType;
    });
    if (existing.length > 0) {
      return { duplicate: true, existing: existing[0] };
    }
  }

  var now = _now();
  var entry = {
    eventId: _generateId(),
    sourceEventId: event.sourceEventId || null,
    customerId: customerId,
    eventType: event.eventType,
    description: event.description || '',
    occurredAt: event.occurredAt || now,
    recordedAt: now,
    source: event.source || 'system',
    evidence: event.evidence || null,
    data: event.data || {}
  };

  customer.events.push(entry);
  customer.lastContactedAt = now;
  customer.updatedAt = now;
  _save();
  return entry;
}

/**
 * Get all timeline events for a customer, chronological order.
 */
function getEvents(customerId, options) {
  if (!customerId) return { error: 'Customer ID is required' };
  var customer = _customers[customerId];
  if (!customer) return { error: 'Customer not found: ' + customerId };

  var events = customer.events.slice();

  // Filter by type if specified
  if (options && options.eventType) {
    events = events.filter(function(e) { return e.eventType === options.eventType; });
  }

  // Sort by occurredAt ascending
  events.sort(function(a, b) {
    return new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime();
  });

  return events;
}

/**
 * Get the most recent event of a given type.
 */
function getLatestEvent(customerId, eventType) {
  var events = getEvents(customerId, { eventType: eventType });
  if (events.length === 0) return null;
  return events[events.length - 1];
}

// ── Search ──

/**
 * Search customers by various criteria.
 */
function searchCustomers(query) {
  _load();
  if (!query) return [];

  var results = Object.keys(_customers).map(function(id) { return _customers[id]; });

  if (query.search) {
    var q = query.search.toLowerCase();
    results = results.filter(function(c) {
      return (c.name && c.name.toLowerCase().indexOf(q) !== -1) ||
             (c.phone && c.phone.indexOf(q) !== -1) ||
             (c.email && c.email.toLowerCase().indexOf(q) !== -1);
    });
  }

  if (query.status) {
    results = results.filter(function(c) { return c.status === query.status; });
  }

  // Deep clone results
  return JSON.parse(JSON.stringify(results));
}

/**
 * List all customers.
 */
function listCustomers() {
  _load();
  return Object.keys(_customers).map(function(id) {
    var c = _customers[id];
    return {
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      status: c.status,
      propertyCount: c.properties.length,
      eventCount: c.events.length,
      totalJobs: c.totalJobs,
      totalRevenue: c.totalRevenue,
      createdAt: c.createdAt,
      lastContactedAt: c.lastContactedAt
    };
  });
}

/**
 * Get customer count.
 */
function getCustomerCount() {
  _load();
  return Object.keys(_customers).length;
}

/**
 * Delete a customer.
 */
function deleteCustomer(id) {
  _load();
  if (!id) return { error: 'Customer ID is required' };
  if (!_customers[id]) return { error: 'Customer not found: ' + id };
  delete _customers[id];
  _save();
  return { deleted: true, id: id };
}

// ── Init ──

function init() {
  _load();
  return { customerCount: Object.keys(_customers).length };
}

// ── Exports ──

module.exports = {
  // Lifecycle
  init: init,

  // Identity
  normalizePhone: normalizePhone,
  normalizeEmail: normalizeEmail,
  normalizeAddress: normalizeAddress,
  resolveIdentity: resolveIdentity,

  // CRUD
  createCustomer: createCustomer,
  getCustomer: getCustomer,
  updateCustomer: updateCustomer,
  deleteCustomer: deleteCustomer,

  // Properties
  addProperty: addProperty,
  getProperties: getProperties,

  // Events
  addEvent: addEvent,
  getEvents: getEvents,
  getLatestEvent: getLatestEvent,
  EVENT_TYPES: EVENT_TYPES,

  // Search
  searchCustomers: searchCustomers,
  listCustomers: listCustomers,
  getCustomerCount: getCustomerCount
};
