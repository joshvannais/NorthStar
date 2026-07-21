/**
 * Polaris Communications Intelligence Engine
 *
 * Centralized communications layer that records, indexes, analyzes, and
 * retrieves every customer interaction across the Polaris platform.
 *
 * Ownership Boundary:
 *   - Communication timeline (chronological, per-customer)
 *   - Multi-channel support (call, SMS, email, meeting, note, visit, internal)
 *   - Communication search (by customer, date, type, keyword, status)
 *   - Communication intelligence (last contact, frequency, engagement)
 *   - Follow-up recommendations
 *   - Outstanding conversation tracking
 *
 * NOT estimation, pricing, scheduling, workflow, learning, validation,
 * customer management, or UI.
 *
 * Dependencies (consumed via public APIs only):
 *   - store.js (persistence) — file-backed storage
 *   - customer-engine.js (customer context) — lastContact, metrics
 *   - engine.js (recommendations + learning) — follow-up suggestions
 */

const store = require('./store');
const CUSTOMER_PREFIX = 'comm:';

// ── Communication Type Constants ──
const COMM_TYPES = Object.freeze({
  call:     { id: 'call',     displayName: 'Phone Call',     icon: 'phone' },
  sms:      { id: 'sms',      displayName: 'SMS',            icon: 'message' },
  email:    { id: 'email',    displayName: 'Email',          icon: 'mail' },
  meeting:  { id: 'meeting',  displayName: 'In-Person',      icon: 'users' },
  note:     { id: 'note',     displayName: 'Note',           icon: 'file-text' },
  visit:    { id: 'visit',    displayName: 'Job-Site Visit', icon: 'tool' },
  internal: { id: 'internal', displayName: 'Internal Staff', icon: 'briefcase' },
});

const COMM_DIRECTIONS = Object.freeze({
  inbound:  { id: 'inbound',  displayName: 'Inbound' },
  outbound: { id: 'outbound', displayName: 'Outbound' },
});

const COMM_STATUSES = Object.freeze({
  completed: { id: 'completed', displayName: 'Completed' },
  pending:   { id: 'pending',   displayName: 'Pending' },
  missed:    { id: 'missed',    displayName: 'Missed' },
  scheduled: { id: 'scheduled', displayName: 'Scheduled' },
  resolved:  { id: 'resolved',  displayName: 'Resolved' },
});

const VALID_TYPES = new Set(Object.keys(COMM_TYPES));
const VALID_DIRECTIONS = new Set(Object.keys(COMM_DIRECTIONS));
const VALID_STATUSES = new Set(Object.keys(COMM_STATUSES));

// ── In-memory store ──
const _communications = {};
let _idCounter = 0;

function _genId() {
  _idCounter++;
  return 'comm_' + Date.now() + '_' + _idCounter;
}

function _now() {
  return new Date().toISOString();
}

// ── Persistence — Polaris Store Integration ──

function _persist(comm) {
  try {
    store.addRecommendation({
      type: 'communication',
      commId: comm.id,
      customerId: comm.customerId,
      data: comm,
      timestamp: comm.createdAt,
    });
  } catch (e) {
    // Non-critical: in-memory cache is primary.
  }
}

/**
 * Initialize the Communications Engine — load existing communication
 * records from the Polaris store into the in-memory cache.
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
      if (r && r.type === 'communication' && r.data && r.data.id) {
        _communications[r.data.id] = r.data;
        loaded++;
      }
    });
  } catch (e) {
    // Store may not be initialized yet; in-memory cache is sufficient.
  }
  return { loaded: loaded };
}

// ── Validation ──

function _validateType(type) {
  if (!VALID_TYPES.has(type)) {
    return { valid: false, error: 'Invalid communication type: "' + type + '". Allowed: ' + Array.from(VALID_TYPES).join(', ') };
  }
  return { valid: true };
}

function _validateDirection(direction) {
  if (!VALID_DIRECTIONS.has(direction)) {
    return { valid: false, error: 'Invalid direction: "' + direction + '". Allowed: ' + Array.from(VALID_DIRECTIONS).join(', ') };
  }
  return { valid: true };
}

function _validateStatus(status) {
  if (!VALID_STATUSES.has(status)) {
    return { valid: false, error: 'Invalid status: "' + status + '". Allowed: ' + Array.from(VALID_STATUSES).join(', ') };
  }
  return { valid: true };
}

// ── Core Communication Recording ──

/**
 * Record a communication event.
 *
 * @param {object} data - Communication data
 * @param {string} data.customerId - Customer ID (required)
 * @param {string} data.type - Communication type (required)
 * @param {string} data.direction - Direction: 'inbound' | 'outbound' (required)
 * @param {string} [data.channel] - Communication channel
 * @param {string} [data.subject] - Subject line
 * @param {string} [data.content] - Message content or summary
 * @param {string} [data.status='completed'] - Communication status
 * @param {string} [data.author] - Author or agent name
 * @param {number} [data.duration] - Duration in seconds (for calls)
 * @param {object} [data.metadata] - Additional metadata
 * @returns {object} Created communication record
 */
function recordCommunication(data) {
  if (!data || !data.customerId) {
    return { error: 'Customer ID is required' };
  }
  if (!data.type) {
    return { error: 'Communication type is required' };
  }

  var typeCheck = _validateType(data.type);
  if (!typeCheck.valid) return { error: typeCheck.error };

  var dirCheck = _validateDirection(data.direction || 'inbound');
  if (!dirCheck.valid) return { error: dirCheck.error };

  var status = data.status || 'completed';
  var statusCheck = _validateStatus(status);
  if (!statusCheck.valid) return { error: statusCheck.error };

  var id = _genId();
  var now = _now();

  var comm = {
    id: id,
    customerId: data.customerId,
    type: data.type,
    typeDisplayName: COMM_TYPES[data.type].displayName,
    direction: data.direction || 'inbound',
    directionDisplayName: COMM_DIRECTIONS[data.direction || 'inbound'].displayName,
    channel: data.channel || null,
    subject: data.subject || null,
    content: data.content || null,
    status: status,
    statusDisplayName: COMM_STATUSES[status].displayName,
    author: data.author || null,
    duration: data.duration || null,
    metadata: data.metadata ? Object.assign({}, data.metadata) : {},
    createdAt: now,
    updatedAt: now,
  };

  _communications[id] = comm;
  _persist(comm);

  // Update customer last contacted timestamp
  try {
    var customerEngine = require('./customer-engine');
    customerEngine.updateCustomerMetrics(data.customerId, {});
  } catch (e) {
    // Customer engine may not be available; non-critical.
  }

  return {
    id: comm.id,
    customerId: comm.customerId,
    type: comm.type,
    direction: comm.direction,
    status: comm.status,
    createdAt: comm.createdAt,
  };
}

/**
 * Get a single communication by ID.
 *
 * @param {string} id - Communication ID
 * @returns {object} Communication record
 */
function getCommunication(id) {
  if (!id) return { error: 'Communication ID is required' };
  var comm = _communications[id];
  if (!comm) return { error: 'Communication not found: ' + id };
  return Object.assign({}, comm);
}

/**
 * List communications for a customer, with optional filters.
 *
 * @param {string} customerId - Customer ID
 * @param {object} [filters] - Optional filters
 * @param {string} [filters.type] - Filter by communication type
 * @param {string} [filters.direction] - Filter by direction
 * @param {string} [filters.status] - Filter by status
 * @param {string} [filters.dateFrom] - ISO date string (inclusive)
 * @param {string} [filters.dateTo] - ISO date string (inclusive)
 * @param {number} [filters.limit] - Max results to return
 * @returns {object} { communications, total }
 */
function getCommunications(customerId, filters) {
  if (!customerId) return { error: 'Customer ID is required' };

  var results = [];
  Object.keys(_communications).forEach(function (k) {
    var c = _communications[k];
    if (c.customerId !== customerId) return;

    if (filters) {
      if (filters.type && c.type !== filters.type) return;
      if (filters.direction && c.direction !== filters.direction) return;
      if (filters.status && c.status !== filters.status) return;
      if (filters.dateFrom && c.createdAt < filters.dateFrom) return;
      if (filters.dateTo && c.createdAt > filters.dateTo) return;
    }

    results.push(c);
  });

  // Sort by createdAt descending (most recent first)
  results.sort(function (a, b) {
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  var total = results.length;
  if (filters && filters.limit && filters.limit > 0) {
    results = results.slice(0, filters.limit);
  }

  return {
    communications: results.map(function (c) { return Object.assign({}, c); }),
    total: total,
  };
}

/**
 * List all communications across all customers, with optional filters.
 * Canonical collection endpoint — the single source of truth for
 * communication records across the Polaris platform.
 *
 * @param {object} [filters] - Optional filters
 * @param {string} [filters.type] - Filter by communication type
 * @param {string} [filters.direction] - Filter by direction
 * @param {string} [filters.status] - Filter by status
 * @param {string} [filters.dateFrom] - ISO date string (inclusive)
 * @param {string} [filters.dateTo] - ISO date string (inclusive)
 * @param {number} [filters.limit] - Max results to return
 * @param {number} [filters.offset] - Offset for pagination
 * @returns {object} { communications, total }
 */
function getAllCommunications(filters) {
  var results = [];

  Object.keys(_communications).forEach(function (k) {
    var c = _communications[k];

    if (filters) {
      if (filters.type && c.type !== filters.type) return;
      if (filters.direction && c.direction !== filters.direction) return;
      if (filters.status && c.status !== filters.status) return;
      if (filters.customerId && c.customerId !== filters.customerId) return;
      if (filters.dateFrom && c.createdAt < filters.dateFrom) return;
      if (filters.dateTo && c.createdAt > filters.dateTo) return;
    }

    results.push(c);
  });

  // Sort by createdAt descending (most recent first)
  results.sort(function (a, b) {
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  var total = results.length;
  if (filters && filters.offset && filters.offset > 0) {
    results = results.slice(filters.offset);
  }
  if (filters && filters.limit && filters.limit > 0) {
    results = results.slice(0, filters.limit);
  }

  return {
    communications: results.map(function (c) { return Object.assign({}, c); }),
    total: total,
  };
}

/**
 * Search communications across all customers by keyword.
 * Searches subject, content, and author fields.
 *
 * @param {string} query - Search keyword
 * @param {object} [filters] - Optional filters
 * @returns {object} { communications, total }
 */
function searchCommunications(query, filters) {
  if (!query) return { error: 'Search query is required' };

  var q = query.toLowerCase();
  var results = [];

  Object.keys(_communications).forEach(function (k) {
    var c = _communications[k];

    var matches = (c.subject && c.subject.toLowerCase().indexOf(q) !== -1) ||
                  (c.content && c.content.toLowerCase().indexOf(q) !== -1) ||
                  (c.author && c.author.toLowerCase().indexOf(q) !== -1) ||
                  (c.customerId && c.customerId.toLowerCase().indexOf(q) !== -1);

    if (!matches) return;

    if (filters) {
      if (filters.type && c.type !== filters.type) return;
      if (filters.direction && c.direction !== filters.direction) return;
      if (filters.status && c.status !== filters.status) return;
    }

    results.push(c);
  });

  results.sort(function (a, b) {
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  return {
    communications: results.map(function (c) { return Object.assign({}, c); }),
    total: results.length,
  };
}

/**
 * Get the full communication timeline for a customer.
 *
 * @param {string} customerId - Customer ID
 * @param {object} [filters] - Optional filters
 * @returns {object} { customerId, entries, total }
 */
function getTimeline(customerId, filters) {
  var result = getCommunications(customerId, filters);
  return {
    customerId: customerId,
    entries: result.communications,
    total: result.total,
  };
}

// ── Communication Intelligence ──

/**
 * Get the last contact timestamp for a customer.
 *
 * @param {string} customerId - Customer ID
 * @returns {object} { customerId, lastContactAt, daysSince }
 */
function getLastContact(customerId) {
  if (!customerId) return { error: 'Customer ID is required' };

  var comms = getCommunications(customerId, { limit: 1 });
  if (comms.total === 0) {
    return { customerId: customerId, lastContactAt: null, daysSince: null };
  }

  var last = comms.communications[0];
  var daysSince = Math.round((Date.now() - new Date(last.createdAt).getTime()) / 86400000);

  return {
    customerId: customerId,
    lastContactAt: last.createdAt,
    daysSince: daysSince,
    type: last.type,
    direction: last.direction,
  };
}

/**
 * Get communication frequency for a customer over a period.
 *
 * @param {string} customerId - Customer ID
 * @param {number} [days=30] - Number of days to analyze
 * @returns {object} Frequency analysis
 */
function getCommunicationFrequency(customerId, days) {
  if (!customerId) return { error: 'Customer ID is required' };
  days = days || 30;

  var dateFrom = new Date(Date.now() - days * 86400000).toISOString();
  var comms = getCommunications(customerId, { dateFrom: dateFrom });

  var byType = {};
  var byDirection = {};

  comms.communications.forEach(function (c) {
    byType[c.type] = (byType[c.type] || 0) + 1;
    byDirection[c.direction] = (byDirection[c.direction] || 0) + 1;
  });

  return {
    customerId: customerId,
    periodDays: days,
    totalCommunications: comms.total,
    averagePerDay: Math.round((comms.total / days) * 100) / 100,
    byType: byType,
    byDirection: byDirection,
  };
}

/**
 * Calculate a customer engagement score (0–100) based on
 * communication frequency, recency, and responsiveness.
 *
 * @param {string} customerId - Customer ID
 * @returns {object} Engagement score
 */
function getEngagementScore(customerId) {
  if (!customerId) return { error: 'Customer ID is required' };

  var score = 50; // Base score
  var factors = {};

  // Factor 1: Recency (0–25 points)
  var lastContact = getLastContact(customerId);
  if (lastContact.daysSince !== null) {
    var recencyScore = 0;
    if (lastContact.daysSince < 3) recencyScore = 25;
    else if (lastContact.daysSince < 7) recencyScore = 20;
    else if (lastContact.daysSince < 14) recencyScore = 15;
    else if (lastContact.daysSince < 30) recencyScore = 10;
    else if (lastContact.daysSince < 90) recencyScore = 5;
    score += recencyScore;
    factors.recency = { daysSince: lastContact.daysSince, score: recencyScore };
  } else {
    factors.recency = { daysSince: null, score: 0 };
  }

  // Factor 2: Volume (0–15 points)
  var freq = getCommunicationFrequency(customerId, 90);
  var volumeScore = 0;
  if (freq.totalCommunications >= 20) volumeScore = 15;
  else if (freq.totalCommunications >= 10) volumeScore = 10;
  else if (freq.totalCommunications >= 5) volumeScore = 5;
  else if (freq.totalCommunications >= 1) volumeScore = 2;
  score += volumeScore;
  factors.volume = { total: freq.totalCommunications, score: volumeScore };

  // Factor 3: Bidirectional (0–10 points)
  var inbound = freq.byDirection.inbound || 0;
  var outbound = freq.byDirection.outbound || 0;
  var bidirectionalScore = 0;
  if (inbound > 0 && outbound > 0) {
    var ratio = Math.min(inbound, outbound) / Math.max(inbound, outbound);
    bidirectionalScore = Math.round(ratio * 10);
  }
  score += bidirectionalScore;
  factors.bidirectional = { inbound: inbound, outbound: outbound, score: bidirectionalScore };

  // Clamp
  score = Math.max(0, Math.min(100, score));

  var label = 'Fair';
  var color = 'yellow';
  if (score >= 80) { label = 'Excellent'; color = 'green'; }
  else if (score >= 60) { label = 'Good'; color = 'teal'; }
  else if (score >= 40) { label = 'Fair'; color = 'yellow'; }
  else { label = 'Low'; color = 'red'; }

  return {
    customerId: customerId,
    engagementScore: score,
    engagementLabel: label,
    color: color,
    factors: factors,
    calculatedAt: _now(),
  };
}

/**
 * Get follow-up recommendations for a customer based on
 * communication history analysis.
 *
 * @param {string} customerId - Customer ID
 * @returns {object} Follow-up recommendations
 */
function getFollowUpRecommendations(customerId) {
  if (!customerId) return { error: 'Customer ID is required' };

  var recommendations = [];
  var reasons = [];

  var lastContact = getLastContact(customerId);

  // Check for long gap since last contact
  if (lastContact.daysSince !== null) {
    if (lastContact.daysSince > 30) {
      recommendations.push('Re-engage customer — no contact in ' + lastContact.daysSince + ' days');
      reasons.push('long_gap');
    } else if (lastContact.daysSince > 14) {
      recommendations.push('Check in with customer — last contact was ' + lastContact.daysSince + ' days ago');
      reasons.push('moderate_gap');
    }
  } else {
    recommendations.push('Initiate first contact with this customer');
    reasons.push('no_contact');
  }

  // Check for missed communications
  var missed = getCommunications(customerId, { status: 'missed' });
  if (missed.total > 0) {
    recommendations.push('Return ' + missed.total + ' missed communication(s)');
    reasons.push('missed');
  }

  // Check for pending communications
  var pending = getCommunications(customerId, { status: 'pending' });
  if (pending.total > 0) {
    recommendations.push('Resolve ' + pending.total + ' pending communication(s)');
    reasons.push('pending');
  }

  // Check for last outbound direction
  if (lastContact.direction === 'inbound') {
    recommendations.push('Respond to customer — last contact was inbound');
    reasons.push('inbound_pending');
  }

  return {
    customerId: customerId,
    recommendations: recommendations,
    reasons: reasons,
    total: recommendations.length,
  };
}

/**
 * Get all outstanding (unresolved) conversations across all customers.
 *
 * @returns {object} { communications, total }
 */
function getOutstandingConversations() {
  var results = [];

  Object.keys(_communications).forEach(function (k) {
    var c = _communications[k];
    if (c.status === 'pending' || c.status === 'missed') {
      results.push(c);
    }
  });

  results.sort(function (a, b) {
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  return {
    communications: results.map(function (c) { return Object.assign({}, c); }),
    total: results.length,
  };
}

/**
 * Update the status of a communication.
 *
 * @param {string} id - Communication ID
 * @param {string} status - New status
 * @returns {object} Updated communication
 */
function updateCommunicationStatus(id, status) {
  if (!id) return { error: 'Communication ID is required' };
  var comm = _communications[id];
  if (!comm) return { error: 'Communication not found: ' + id };

  var statusCheck = _validateStatus(status);
  if (!statusCheck.valid) return { error: statusCheck.error };

  comm.status = status;
  comm.statusDisplayName = COMM_STATUSES[status].displayName;
  comm.updatedAt = _now();
  _persist(comm);

  return {
    id: comm.id,
    status: comm.status,
    displayName: comm.statusDisplayName,
    updatedAt: comm.updatedAt,
  };
}

// ── Type Definitions ──

/**
 * Get all communication type definitions.
 * @returns {object[]}
 */
function getCommunicationTypes() {
  return Object.keys(COMM_TYPES).map(function (k) {
    return { id: COMM_TYPES[k].id, displayName: COMM_TYPES[k].displayName, icon: COMM_TYPES[k].icon };
  });
}

/**
 * Get all communication status definitions.
 * @returns {object[]}
 */
function getCommunicationStatuses() {
  return Object.keys(COMM_STATUSES).map(function (k) {
    return { id: COMM_STATUSES[k].id, displayName: COMM_STATUSES[k].displayName };
  });
}

// ── Module Exports ──

module.exports = {
  // Lifecycle
  init: init,

  // Core recording & retrieval
        recordCommunication: recordCommunication,
        getCommunication: getCommunication,
        getCommunications: getCommunications,
        getAllCommunications: getAllCommunications,
        searchCommunications: searchCommunications,
        getTimeline: getTimeline,

  // Status management
  updateCommunicationStatus: updateCommunicationStatus,

  // Intelligence
  getLastContact: getLastContact,
  getCommunicationFrequency: getCommunicationFrequency,
  getEngagementScore: getEngagementScore,
  getFollowUpRecommendations: getFollowUpRecommendations,
  getOutstandingConversations: getOutstandingConversations,

  // Type definitions
  getCommunicationTypes: getCommunicationTypes,
  getCommunicationStatuses: getCommunicationStatuses,

  // Constants
  COMM_TYPES: COMM_TYPES,
  COMM_DIRECTIONS: COMM_DIRECTIONS,
  COMM_STATUSES: COMM_STATUSES,
};