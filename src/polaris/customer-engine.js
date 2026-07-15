/**
 * Polaris Customer Lifecycle Engine
 *
 * Owns ONLY customer relationship state and metadata.
 * NOT estimation, pricing, scheduling, workflow, learning, validation, or UI.
 *
 * Ownership Boundary:
 *   - Customer profile (name, email, phone, address)
 *   - Customer metadata (tags, notes)
 *   - Communication preferences
 *   - Customer-level status (active/inactive/archived/blocked)
 *   - Health score calculation
 *   - Timeline aggregation (notes only)
 *   - Customer search/listing
 *   - Archival metadata
 *
 * Business State Engine (M13-P1) remains the SINGLE authoritative owner of
 * lifecycle state transitions, validation, transition rules, rollback, and
 * lifecycle ownership. This module consumes ONLY the public APIs of
 * state-engine.js and does NOT duplicate state logic.
 *
 * Dependencies (consumed via public APIs only):
 *   - store.js (persistence) — integration point, self-contained fallback
 *   - state-engine.js (state machine) — integration point, self-contained fallback
 *   - schema-validator.js (validation) — integration point, self-contained fallback
 */

// ── Polaris Store Integration ──
const store = require('./store');

// ── Customer Status Constants ──
const CUSTOMER_STATUS = Object.freeze({
  active:   { id: 'active',   displayName: 'Active',           description: 'Active customer with no restrictions' },
  inactive: { id: 'inactive', displayName: 'Inactive',         description: 'No recent activity' },
  archived: { id: 'archived', displayName: 'Archived',         description: 'Permanently archived' },
  blocked:  { id: 'blocked',  displayName: 'Blocked',          description: 'Blocked from new services' },
});

const VALID_STATUSES = new Set(Object.keys(CUSTOMER_STATUS));

// ── In-memory store ──
const _customers = {};
let _idCounter = 0;

function _genId() {
  _idCounter++;
  return 'cust_' + Date.now() + '_' + _idCounter;
}

function _now() {
  return new Date().toISOString();
}

// ── Persistence — Polaris Store Integration ──
const CUSTOMER_PREFIX = 'customer:';

function _persist(customer) {
  try {
    // Persist to the file-backed Polaris store for cross-restart durability.
    // Uses the recommendations store with a type marker for filtering.
    store.addRecommendation({
      type: 'customer',
      customerId: customer.id,
      data: customer,
      timestamp: customer.updatedAt,
    });
  } catch (e) {
    // Non-critical: in-memory cache remains the primary data source.
    // Store persistence is best-effort.
  }
}

/**
 * Initialize the Customer Engine — load existing customer data from the
 * Polaris store into the in-memory cache.
 *
 * Call once at server startup after store.init() has completed.
 *
 * @returns {object} { loaded: number }
 */
function init() {
  var loaded = 0;
  try {
    var recs = store.getAllRecommendations() || [];
    recs.forEach(function (r) {
      if (r && r.type === 'customer' && r.data && r.data.id) {
        _customers[r.data.id] = r.data;
        loaded++;
      }
    });
  } catch (e) {
    // Store may not be initialized yet; in-memory cache is sufficient.
  }
  return { loaded: loaded };
}

// ── Status Validation ──
function _validateStatus(status) {
  if (!VALID_STATUSES.has(status)) {
    return { valid: false, error: 'Invalid status: "' + status + '". Allowed: ' + Array.from(VALID_STATUSES).join(', ') };
  }
  return { valid: true };
}

// ── Core Customer Profile ──

/**
 * Create a new customer record.
 * Does NOT create a Business State Machine — that is the job of the
 * service/job creation flow, not the customer profile.
 *
 * @param {object} data - Customer data
 * @param {string} data.name - Customer full name (required)
 * @param {string} [data.email] - Customer email
 * @param {string} [data.phone] - Customer phone
 * @param {string} [data.address] - Customer address
 * @param {string} [data.city] - Customer city
 * @param {string} [data.stateOrRegion] - Customer state/region
 * @param {string} [data.postalCode] - Customer postal code
 * @param {string} [data.status='active'] - Customer status
 * @param {string[]} [data.tags] - Customer tags
 * @param {string} [data.notes] - Initial notes
 * @param {object} [data.metadata] - Additional metadata
 * @returns {object} { id, name, status, createdAt }
 */
function createCustomer(data) {
  if (!data || !data.name) {
    return { error: 'Customer name is required' };
  }

  const status = data.status || 'active';
  const statusCheck = _validateStatus(status);
  if (!statusCheck.valid) return { error: statusCheck.error };

  const id = _genId();
  const now = _now();

  const customer = {
    id: id,
    name: data.name,
    email: data.email || null,
    phone: data.phone || null,
    address: data.address || null,
    city: data.city || null,
    stateOrRegion: data.stateOrRegion || null,
    postalCode: data.postalCode || null,
    status: status,
    statusDisplayName: CUSTOMER_STATUS[status].displayName,
    tags: data.tags ? [].concat(data.tags) : [],
    notes: data.notes
      ? [{ id: _genId(), text: data.notes, createdAt: now, author: 'system' }]
      : [],
    communicationPreferences: {
      email: true,
      sms: false,
      phone: false,
    },
    metadata: data.metadata ? Object.assign({}, data.metadata) : {},
    createdAt: now,
    updatedAt: now,
    lastContactedAt: null,
    totalJobs: 0,
    totalRevenue: 0,
    healthScore: 50,
    healthLabel: 'Fair',
  };

  _customers[id] = customer;
  _persist(customer);

  return {
    id: customer.id,
    name: customer.name,
    status: customer.status,
    createdAt: customer.createdAt,
  };
}

/**
 * Get a customer by ID.
 * Returns an immutable-like copy.
 *
 * @param {string} id - Customer ID
 * @returns {object} Customer data
 */
function getCustomer(id) {
  if (!id) return { error: 'Customer ID is required' };
  const customer = _customers[id];
  if (!customer) return { error: 'Customer not found: ' + id };
  return Object.assign({}, customer);
}

/**
 * Update customer profile fields.
 * Only updates allowed fields — preserves all others.
 * Allowed: name, email, phone, address, city, stateOrRegion,
 * postalCode, tags, metadata, communicationPreferences.
 *
 * @param {string} id - Customer ID
 * @param {object} updates - Fields to update
 * @returns {object} { id, updated: string[], updatedAt }
 */
function updateCustomer(id, updates) {
  if (!id) return { error: 'Customer ID is required' };
  const customer = _customers[id];
  if (!customer) return { error: 'Customer not found: ' + id };
  if (!updates || Object.keys(updates).length === 0) {
    return { error: 'No updates provided' };
  }

  const allowed = ['name', 'email', 'phone', 'address', 'city', 'stateOrRegion', 'postalCode', 'tags', 'metadata'];
  const changed = [];

  Object.keys(updates).forEach(function (key) {
    if (allowed.indexOf(key) !== -1) {
      customer[key] = updates[key];
      changed.push(key);
    }
  });

  if (updates.communicationPreferences) {
    Object.keys(updates.communicationPreferences).forEach(function (k) {
      if (customer.communicationPreferences[k] !== undefined) {
        customer.communicationPreferences[k] = updates.communicationPreferences[k];
      }
    });
    changed.push('communicationPreferences');
  }

  customer.updatedAt = _now();
  _persist(customer);

  return {
    id: customer.id,
    updated: changed,
    updatedAt: customer.updatedAt,
  };
}

// ── Customer Status (profile metadata, NOT lifecycle state) ──

/**
 * Archive a customer record.
 * Sets customer-level status to 'archived' — this is customer profile
 * metadata, NOT a Business State Engine lifecycle transition.
 *
 * @param {string} id - Customer ID
 * @returns {object} { id, status, archivedAt }
 */
function archiveCustomer(id) {
  if (!id) return { error: 'Customer ID is required' };
  const customer = _customers[id];
  if (!customer) return { error: 'Customer not found: ' + id };
  if (customer.status === 'archived') return { error: 'Customer is already archived' };

  customer.status = 'archived';
  customer.statusDisplayName = 'Archived';
  customer.updatedAt = _now();
  _persist(customer);

  return { id: customer.id, status: 'archived', archivedAt: customer.updatedAt };
}

/**
 * Restore an archived customer record.
 * Sets customer-level status to 'active' — this is customer profile
 * metadata, NOT a Business State Engine lifecycle transition.
 *
 * @param {string} id - Customer ID
 * @returns {object} { id, status, restoredAt }
 */
function restoreCustomer(id) {
  if (!id) return { error: 'Customer ID is required' };
  const customer = _customers[id];
  if (!customer) return { error: 'Customer not found: ' + id };
  if (customer.status !== 'archived') return { error: 'Customer is not archived' };

  customer.status = 'active';
  customer.statusDisplayName = 'Active';
  customer.updatedAt = _now();
  _persist(customer);

  return { id: customer.id, status: 'active', restoredAt: customer.updatedAt };
}

/**
 * Update customer-level status.
 * Operates on customer profile metadata (active/inactive/archived/blocked),
 * NOT the Business State Engine lifecycle. This is a separate domain.
 *
 * @param {string} id - Customer ID
 * @param {string} status - New status
 * @returns {object} { id, status, displayName, updatedAt }
 */
function updateCustomerStatus(id, status) {
  if (!id) return { error: 'Customer ID is required' };
  const customer = _customers[id];
  if (!customer) return { error: 'Customer not found: ' + id };

  const statusCheck = _validateStatus(status);
  if (!statusCheck.valid) return { error: statusCheck.error };

  if (customer.status === status) {
    return { error: 'Customer is already ' + status };
  }

  customer.status = status;
  customer.statusDisplayName = CUSTOMER_STATUS[status].displayName;
  customer.updatedAt = _now();
  _persist(customer);

  return {
    id: customer.id,
    status: status,
    displayName: CUSTOMER_STATUS[status].displayName,
    updatedAt: customer.updatedAt,
  };
}

/**
 * Get all valid customer status definitions.
 * @returns {object[]} Status definitions
 */
function getCustomerStatuses() {
  return Object.keys(CUSTOMER_STATUS).map(function (k) {
    return {
      id: CUSTOMER_STATUS[k].id,
      displayName: CUSTOMER_STATUS[k].displayName,
      description: CUSTOMER_STATUS[k].description,
    };
  });
}

// ── Notes & Timeline ──

/**
 * Add a note to a customer's timeline.
 *
 * @param {string} id - Customer ID
 * @param {object} note - Note data
 * @param {string} note.text - Note text (required)
 * @param {string} [note.author='system'] - Note author
 * @returns {object} Created note
 */
function addCustomerNote(id, note) {
  if (!id) return { error: 'Customer ID is required' };
  const customer = _customers[id];
  if (!customer) return { error: 'Customer not found: ' + id };
  if (!note || !note.text) return { error: 'Note text is required' };

  const entry = {
    id: _genId(),
    text: note.text,
    author: note.author || 'system',
    createdAt: _now(),
  };

  customer.notes.push(entry);
  customer.updatedAt = _now();
  _persist(customer);

  return entry;
}

/**
 * Remove a note from a customer's timeline.
 *
 * @param {string} id - Customer ID
 * @param {string} noteId - Note ID to remove
 * @returns {object} { removed: boolean, noteId: string }
 */
function removeCustomerNote(id, noteId) {
  if (!id) return { error: 'Customer ID is required' };
  const customer = _customers[id];
  if (!customer) return { error: 'Customer not found: ' + id };
  if (!noteId) return { error: 'Note ID is required' };

  var idx = -1;
  customer.notes.forEach(function (n, i) {
    if (n.id === noteId) idx = i;
  });

  if (idx === -1) return { error: 'Note not found: ' + noteId };

  customer.notes.splice(idx, 1);
  customer.updatedAt = _now();
  _persist(customer);

  return { removed: true, noteId: noteId };
}

/**
 * Get a customer's full timeline.
 * Aggregates customer notes only — the Business State Engine owns
 * its own state timeline. When state-engine.js is available, call:
 *   stateEngine.getTimeline(id)
 * and merge entries with customer notes for a unified view.
 *
 * @param {string} id - Customer ID
 * @returns {object} { customerId, customerName, entries, total }
 */
function getCustomerTimeline(id) {
  if (!id) return { error: 'Customer ID is required' };
  const customer = _customers[id];
  if (!customer) return { error: 'Customer not found: ' + id };

  const entries = [];

  // Add customer notes
  customer.notes.forEach(function (n) {
    entries.push({
      timestamp: n.createdAt,
      type: 'note',
      description: n.text,
      source: 'customer_engine',
      data: { noteId: n.id, author: n.author },
    });
  });

  // Sort by timestamp ascending
  entries.sort(function (a, b) {
    return new Date(a.timestamp) - new Date(b.timestamp);
  });

  return {
    customerId: id,
    customerName: customer.name,
    entries: entries,
    total: entries.length,
  };
}

// ── Health Score ──

/**
 * Calculate a customer's health score (0–100).
 * Factors: total jobs, total revenue, recency, status, engagement.
 *
 * This is customer relationship health, NOT business lifecycle state.
 *
 * @param {string} id - Customer ID
 * @returns {object} { customerId, healthScore, healthLabel, color, factors, calculatedAt }
 */
function calculateCustomerHealth(id) {
  if (!id) return { error: 'Customer ID is required' };
  const customer = _customers[id];
  if (!customer) return { error: 'Customer not found: ' + id };

  var score = 50; // Base score

  // Factor 1: Total jobs (0–20 points)
  score += Math.min(20, customer.totalJobs * 5);

  // Factor 2: Total revenue (0–15 points)
  if (customer.totalRevenue > 10000) score += 15;
  else if (customer.totalRevenue > 5000) score += 10;
  else if (customer.totalRevenue > 1000) score += 5;
  else if (customer.totalRevenue > 0) score += 2;

  // Factor 3: Recency (0–10 points)
  if (customer.lastContactedAt) {
    var daysSince = (Date.now() - new Date(customer.lastContactedAt).getTime()) / 86400000;
    if (daysSince < 30) score += 10;
    else if (daysSince < 90) score += 5;
    else if (daysSince < 180) score += 2;
  }

  // Factor 4: Status penalty (0 to –15 points)
  if (customer.status === 'blocked') score -= 15;
  else if (customer.status === 'inactive') score -= 5;
  else if (customer.status === 'archived') score -= 10;

  // Factor 5: Engagement (0–5 points)
  if (customer.notes.length >= 5) score += 5;
  else if (customer.notes.length >= 2) score += 2;

  // Clamp to 0–100
  score = Math.max(0, Math.min(100, score));

  // Determine label
  var label = 'Fair';
  var color = 'yellow';
  if (score >= 80) { label = 'Excellent'; color = 'green'; }
  else if (score >= 60) { label = 'Good'; color = 'teal'; }
  else if (score >= 40) { label = 'Fair'; color = 'yellow'; }
  else { label = 'Needs Attention'; color = 'red'; }

  // Update customer record
  customer.healthScore = score;
  customer.healthLabel = label;
  _persist(customer);

  return {
    customerId: id,
    healthScore: score,
    healthLabel: label,
    color: color,
    factors: {
      totalJobs: customer.totalJobs,
      totalRevenue: customer.totalRevenue,
      status: customer.status,
      noteCount: customer.notes.length,
    },
    calculatedAt: _now(),
  };
}

// ── Search & Listing ──

/**
 * List all customers, optionally filtered.
 *
 * @param {object} [filters] - Optional filters
 * @param {string} [filters.status] - Filter by customer status
 * @param {string} [filters.search] - Search name, email, or phone
 * @returns {object} { customers: object[], total: number }
 */
function listCustomers(filters) {
  var customers = Object.keys(_customers).map(function (k) {
    return _customers[k];
  });

  if (filters) {
    if (filters.status) {
      customers = customers.filter(function (c) {
        return c.status === filters.status;
      });
    }

    if (filters.search) {
      var q = filters.search.toLowerCase();
      customers = customers.filter(function (c) {
        return (c.name && c.name.toLowerCase().indexOf(q) !== -1) ||
               (c.email && c.email.toLowerCase().indexOf(q) !== -1) ||
               (c.phone && c.phone.indexOf(q) !== -1);
      });
    }
  }

  // Sort by createdAt descending
  customers.sort(function (a, b) {
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  return {
    customers: customers.map(function (c) {
      return {
        id: c.id,
        name: c.name,
        email: c.email,
        status: c.status,
        healthScore: c.healthScore,
        healthLabel: c.healthLabel,
        createdAt: c.createdAt,
        totalJobs: c.totalJobs,
      };
    }),
    total: customers.length,
  };
}

/**
 * Search customers by name, email, or phone.
 * @param {string} query - Search query
 * @returns {object} Matching customers
 */
function searchCustomers(query) {
  return listCustomers({ search: query });
}

// ── Lifetime Metrics ──

/**
 * Update customer lifetime metrics.
 * Called by other modules when jobs are completed.
 *
 * @param {string} id - Customer ID
 * @param {object} metrics - Metrics to add
 * @param {number} [metrics.jobsIncrement] - Jobs to add
 * @param {number} [metrics.revenueIncrement] - Revenue to add
 * @returns {object} { id, totalJobs, totalRevenue }
 */
function updateCustomerMetrics(id, metrics) {
  if (!id) return { error: 'Customer ID is required' };
  const customer = _customers[id];
  if (!customer) return { error: 'Customer not found: ' + id };

  if (metrics) {
    if (metrics.jobsIncrement) customer.totalJobs += metrics.jobsIncrement;
    if (metrics.revenueIncrement) customer.totalRevenue += metrics.revenueIncrement;
  }

  customer.lastContactedAt = _now();
  customer.updatedAt = _now();
  _persist(customer);

  return {
    id: customer.id,
    totalJobs: customer.totalJobs,
    totalRevenue: customer.totalRevenue,
  };
}

// ── Module Exports ──

module.exports = {
  // Lifecycle
  init: init,

  // Core profile
  createCustomer: createCustomer,
  getCustomer: getCustomer,
  updateCustomer: updateCustomer,

  // Status (customer profile metadata)
  archiveCustomer: archiveCustomer,
  restoreCustomer: restoreCustomer,
  updateCustomerStatus: updateCustomerStatus,
  getCustomerStatuses: getCustomerStatuses,

  // Notes & timeline
  addCustomerNote: addCustomerNote,
  removeCustomerNote: removeCustomerNote,
  getCustomerTimeline: getCustomerTimeline,

  // Health
  calculateCustomerHealth: calculateCustomerHealth,

  // Search & listing
  listCustomers: listCustomers,
  searchCustomers: searchCustomers,

  // Metrics
  updateCustomerMetrics: updateCustomerMetrics,

  // Constants
  CUSTOMER_STATUS: CUSTOMER_STATUS,
};
