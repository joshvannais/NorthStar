/**
 * Data Loader Module — Shared Data Loading with Caching
 *
 * Extracted from src/context/business.js (M16.5 remediation).
 * Provides a single, cached data-loading function consumed by all modules.
 *
 * READ-ONLY: No edits, no mutations, no writes, no database updates.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '../../data');

// Cache loaded data to avoid re-reading on every request
let _cache = null;
let _cacheTime = 0;
const CACHE_TTL_MS = 30000; // 30 seconds

function loadData() {
  const now = Date.now();
  if (_cache && now - _cacheTime < CACHE_TTL_MS) return _cache;

  const data = {};

  // Leads
  try {
    data.leads = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'leads.json'), 'utf8'));
  } catch (e) {
    data.leads = [];
  }

  // Customers
  try {
    data.customers = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'customers.json'), 'utf8'));
  } catch (e) {
    data.customers = [];
  }

  // Events
  try {
    data.events = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'events.json'), 'utf8'));
  } catch (e) {
    data.events = [];
  }

  // Estimates
  try {
    data.estimates = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'polaris-estimates.json'), 'utf8'));
  } catch (e) {
    data.estimates = [];
  }

  // Jobs
  try {
    data.jobs = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'polaris-jobs.json'), 'utf8'));
  } catch (e) {
    data.jobs = [];
  }

  // Metrics
  try {
    data.metrics = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'polaris-metrics.json'), 'utf8'));
  } catch (e) {
    data.metrics = {};
  }

  // Recommendations
  try {
    data.recommendations = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'polaris-recommendations.json'), 'utf8'));
  } catch (e) {
    data.recommendations = [];
  }

  // Crews
  try {
    data.crews = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'polaris-crews.json'), 'utf8'));
  } catch (e) {
    data.crews = [];
  }

  _cache = data;
  _cacheTime = now;
  return data;
}

function filterSessionRecords(records, sessionId) {
  const demoScope = require('./demoRecordScope');
  return (Array.isArray(records) ? records : []).filter(function (record) {
    // Recommendation/activity stores wrap their domain record in `data`.
    // Apply session ownership to that inner record without hiding durable
    // tenant records that have no simulation metadata.
    return demoScope.canAccess(record && record.data ? record.data : record, sessionId);
  });
}

function mergeById(primary, secondary) {
  const seen = {};
  return [].concat(primary || [], secondary || []).filter(function (record) {
    const key = record && record.id;
    if (!key) return true;
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

/**
 * Load the canonical customer/opportunity/estimate/communication graph used by
 * dashboard pages. This adapter gives the existing intelligence calculators a
 * lead-shaped view without creating a second persistent lead source.
 */
function loadCanonicalData(sessionId) {
  const demoScope = require('./demoRecordScope');
  const customersEngine = require('../polaris/customer-engine');
  const opportunitiesEngine = require('../polaris/opportunity-engine');
  const communicationsEngine = require('../polaris/communications-engine');
  const financialEngine = require('../polaris/financial-engine');
  const persisted = loadData();

  const customerSummaries = customersEngine.listCustomers({}).customers || [];
  const engineCustomers = demoScope.filterRecords(customerSummaries.map(function (summary) {
    return customersEngine.getCustomer(summary.id) || summary;
  }), sessionId);
  const customers = mergeById(
    engineCustomers,
    filterSessionRecords(persisted.customers, sessionId)
  );
  const opportunities = demoScope.filterRecords((opportunitiesEngine.listOpportunities({ includeArchived: false }).opportunities || []), sessionId);
  const communications = demoScope.filterRecords((communicationsEngine.getAllCommunications({}).communications || []), sessionId);
  const engineEstimates = demoScope.filterRecords((financialEngine.listEstimates({}).estimates || []), sessionId);
  const estimates = mergeById(
    engineEstimates,
    filterSessionRecords(persisted.estimates, sessionId)
  );

  const customersById = {};
  customers.forEach(function (customer) { customersById[customer.id] = customer; });

  const canonicalLeads = opportunities.map(function (opportunity) {
    const customer = customersById[opportunity.customerId] || {};
    const communication = communications.find(function (item) {
      return item.customerId === opportunity.customerId && item.type === 'call';
    });
    const estimate = estimates.find(function (item) {
      return item.opportunityId === opportunity.id || item.customerId === opportunity.customerId;
    });
    const canonical = (opportunity.metadata && opportunity.metadata.polarisIntelligence) ||
      (estimate && estimate.metadata && estimate.metadata.polarisIntelligence) || null;
    let transcript = '';
    if (communication && communication.content) {
      try {
        const turns = JSON.parse(communication.content);
        transcript = Array.isArray(turns) ? turns.map(function (turn) {
          return (turn.speaker || turn.role || 'Speaker') + ': ' + (turn.text || turn.content || '');
        }).join('\n') : String(communication.content);
      } catch (err) { transcript = String(communication.content); }
    }
    return {
      id: opportunity.id,
      customerId: opportunity.customerId,
      caller: customer.name || 'Unknown customer',
      phone: customer.phone || '',
      service: opportunity.title || 'Unclassified service',
      avgPrice: Number(opportunity.estimatedValue) || 0,
      jobDetail: opportunity.description || '',
      status: opportunity.status || 'open',
      outcome: opportunity.stage || 'lead',
      receivedAt: opportunity.createdAt,
      transcript: transcript,
      pricingBreakdown: canonical ? canonical.pricingBreakdown : (estimate ? estimate.items : []),
      canonicalPolaris: canonical,
      simulationSessionId: demoScope.getSessionId(opportunity),
    };
  });

  // Preserve pre-existing tenant leads while avoiding a duplicate for a
  // simulation that is already represented by its canonical opportunity.
  const legacyLeads = filterSessionRecords(persisted.leads, sessionId).filter(function (lead) {
    return !(demoScope.isSimulation(lead) && lead.canonicalOpportunityId);
  });
  const leads = legacyLeads.concat(canonicalLeads);

  const metrics = Array.isArray(persisted.metrics)
    ? filterSessionRecords(persisted.metrics, sessionId)
    : Object.assign({}, persisted.metrics || {});

  return {
    leads: leads,
    customers: customers,
    communications: communications,
    estimates: estimates,
    opportunities: opportunities,
    events: filterSessionRecords(persisted.events, sessionId),
    jobs: filterSessionRecords(persisted.jobs, sessionId),
    metrics: metrics,
    recommendations: filterSessionRecords(persisted.recommendations, sessionId),
    crews: filterSessionRecords(persisted.crews, sessionId),
  };
}

module.exports = { loadData, loadCanonicalData, filterSessionRecords, CACHE_TTL_MS };
