/**
 * Executive Context — Canonical Reusable Intelligence Context
 *
 * Loaded at session start and immutable during conversation. Reusable by:
 *   Retell, Polaris Chat, Customer Cards, Scheduling, Financial, Mobile,
 *   Executive Dashboard, and all future AI modules.
 *
 * Architecture:
 *   dataLoader.js ──→ Business Profile ──→ Business Intelligence Engine
 *        │                                        ↓
 *        │                             Executive Decision Engine
 *        │                                        ↓
 *        │                          Customer Intelligence Engine
 *        │                                        ↓
 *        └──────────→ Executive Context  ← YOU ARE HERE (canonical)
 *                            ↓
 *   Retell | Polaris Chat | Customer Cards | Scheduling | Financial | Mobile
 *
 * READ-ONLY after creation: Object.freeze() at all levels.
 * No mutations, no writes, no database updates.
 */
'use strict';

const { v4: uuidv4 } = require('uuid');
const dataLoader = require('../services/dataLoader');
const businessProfile = require('../services/businessProfile');
const intelligence = require('../services/intelligence');
const decisionEngine = require('../services/decisionEngine');
const customerIntelligence = require('../services/customerIntelligence');

// In-memory cache: sessionId → ExecutiveContext
const _contextCache = new Map();

// ====================================================================
// Part 1: buildExecutiveContext
// ====================================================================

/**
 * Build a complete, frozen Executive Context.
 *
 * Loads all intelligence layers once at session start. The returned object
 * is deeply frozen — no mutations during a conversation.
 *
 * @param {Object} [opts]
 * @param {string} [opts.customerId] — Optional customer/lead ID for per-customer intelligence
 * @param {string} [opts.sessionId] — Optional session ID for cache storage
 * @param {Object} [opts.voiceSession] — Optional voice session metadata (Retell)
 * @returns {Object} Frozen executive context
 */
function buildExecutiveContext(opts) {
  const options = opts || {};
  const customerId = options.customerId || null;
  const voiceSession = options.voiceSession || null;
  const now = new Date().toISOString();

  // ── 1. Business Profile ──
  const profile = businessProfile.getProfile();

  // ── 2. Raw Data ──
  const data = dataLoader.loadData();

  // ── 3. Aggregate Intelligence ──
  const aggregateIntelligence = intelligence.calculateAggregateIntelligence(data.leads);

  // ── 4. Per-Job Intelligence Map ──
  const allJobIntel = intelligence.calculateAllJobIntelligence(data.leads);
  const jobIntelMap = {};
  allJobIntel.forEach(j => { jobIntelMap[j.leadId] = j; });

  // ── 5. Executive Decisions ──
  const briefing = decisionEngine.generateExecutiveBriefing(data.leads);
  const rankedResult = decisionEngine.rankAllOpportunities(data.leads);

  // ── 6. Dashboard Intelligence ──
  const dashIntel = customerIntelligence.generateDashboardCustomerIntelligence(data.leads);

  // ── 7. Customer-specific intelligence (if customerId provided) ──
  let customerRecord = null;
  let lead = null;
  let recentEstimate = null;
  let jobIntelligence = null;
  let rank = null;
  let nextBestAction = null;
  let snapshot = null;
  let risk = null;
  let opportunity = null;

  if (customerId) {
    lead = data.leads.find(l => l.id === customerId) || null;

    if (lead) {
      try {
        jobIntelligence = intelligence.calculateJobIntelligence(lead, { leadCount: data.leads.length });
      } catch (e) {
        jobIntelligence = null;
      }

      try {
        rank = decisionEngine.rankOpportunity(lead, jobIntelligence, { totalLeads: data.leads.length });
      } catch (e) {
        rank = null;
      }

      try {
        nextBestAction = decisionEngine.getNextBestAction(lead, rank);
      } catch (e) {
        nextBestAction = null;
      }

      try {
        snapshot = customerIntelligence.generateCustomerSnapshot(lead, { totalLeads: data.leads.length });
      } catch (e) {
        snapshot = null;
      }

      // Extract risk and opportunity from snapshot
      if (snapshot) {
        risk = snapshot.risk || null;
        opportunity = snapshot.opportunity || null;
      }

      // Look up customer record
      customerRecord = data.customers.find(c => c.id === customerId || c.leadId === customerId) || null;

      // Look up most recent estimate
      if (data.estimates && data.estimates.length > 0) {
        const leadEstimates = data.estimates.filter(e => e.leadId === customerId);
        if (leadEstimates.length > 0) {
          leadEstimates.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
          recentEstimate = leadEstimates[0];
        }
      }
    }
  }

  // ── 8. Recent Activity (placeholder — future real data) ──
  const recentActivity = {
    recentCalls: [],
    recentNotes: [],
  };

  // ── 9. Permissions (default permissive for all channels) ──
  const permissions = {
    canPrice: true,
    canSchedule: true,
    canTransfer: true,
  };

  // ── 10. Build context object ──
  const context = {
    businessProfile: {
      company: profile.company || {},
      headquarters: profile.headquarters || {},
      serviceArea: profile.serviceArea || {},
      routing: profile.routing || {},
      hours: profile.hours || {},
      crew: profile.crew || {},
      vehicles: profile.vehicles || {},
      services: profile.services || [],
      financial: profile.financial || {},
      scheduling: profile.scheduling || {},
      polaris: profile.polaris || {},
      retell: profile.retell || {},
      notifications: profile.notifications || {},
    },

    customer: {
      customerRecord,
      lead,
      recentEstimate,
    },

    intelligence: {
      jobIntelligence,
      aggregateIntelligence,
    },

    decisions: {
      executiveBriefing: briefing,
      rank,
      nextBestAction,
    },

    customerIntelligence: {
      snapshot,
      risk,
      opportunity,
    },

    recentActivity,

    conversationMemory: null,
    calendar: null,
    weather: null,

    currentTime: now,

    permissions,

    voiceSession,
    loadedAt: now,

    // Metadata
    _meta: {
      contextId: uuidv4(),
      generatedAt: now,
      customerId,
      leadCount: data.leads ? data.leads.length : 0,
      topRanked: rankedResult && rankedResult.ranked ? rankedResult.ranked.slice(0, 10) : [],
      dashboardIntel: dashIntel,
    },
  };

  // ── 11. Deep freeze all levels ──
  const frozen = deepFreeze(context);

  // ── 12. Store in cache if sessionId provided ──
  if (options.sessionId) {
    _contextCache.set(options.sessionId, frozen);
  }

  return frozen;
}

// ====================================================================
// Part 2: Cache Management
// ====================================================================

/**
 * Retrieve a cached executive context by session ID.
 * @param {string} sessionId
 * @returns {Object|null} Frozen context or null if not found
 */
function getCachedContext(sessionId) {
  return _contextCache.get(sessionId) || null;
}

/**
 * Invalidate (remove) a cached executive context.
 * Call on business events that change the underlying data.
 * @param {string} sessionId
 * @returns {boolean} true if context was removed, false if not found
 */
function invalidateContext(sessionId) {
  return _contextCache.delete(sessionId);
}

/**
 * Clear all cached contexts. Used for testing/teardown.
 */
function clearAllContexts() {
  _contextCache.clear();
}

/**
 * Get the number of cached contexts. Used for testing/monitoring.
 * @returns {number}
 */
function getCacheSize() {
  return _contextCache.size;
}

// ====================================================================
// Internal: deepFreeze
// ====================================================================

/**
 * Recursively Object.freeze() an object and all nested objects/arrays.
 * @param {*} obj
 * @returns {*} Frozen input
 */
function deepFreeze(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;

  // Freeze children first, then self
  const keys = Object.keys(obj);
  for (const key of keys) {
    const val = obj[key];
    if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  }

  return Object.freeze(obj);
}

// ====================================================================
// Exports
// ====================================================================

module.exports = {
  buildExecutiveContext,
  getCachedContext,
  invalidateContext,
  clearAllContexts,
  getCacheSize,
};
