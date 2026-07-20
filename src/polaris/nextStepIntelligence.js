/**
 * nextStepIntelligence.js — M19.5 Phase F: Next-Step Intelligence
 *
 * Consumer of the canonical Polaris record. Evaluates all available
 * intelligence (operational + contact) and produces ranked, explainable
 * business recommendations.
 *
 * Never re-parses transcripts, extracts facts, modifies operational reasoning,
 * or modifies customer intelligence. Its responsibility is reasoning only.
 *
 * Input:  Canonical Polaris Record (from buildPolarisIntelligence)
 * Output: Decision Intelligence (nextSteps array)
 */
'use strict';

const crypto = require('crypto');

// ── Helpers ──

function _generateId() {
  return 'ns_' + crypto.randomBytes(6).toString('hex');
}

function _now() {
  return new Date().toISOString();
}

// ── Category Labels ──

const CATEGORIES = {
  CUSTOMER: 'Customer',
  SALES: 'Sales',
  OPERATIONS: 'Operations',
  FINANCIAL: 'Financial',
  CUSTOMER_SUCCESS: 'Customer Success'
};

// ── Recommendation Generators ──

/**
 * Evaluate operational intelligence and generate relevant recommendations.
 */
function _evaluateOperational(record) {
  const recommendations = [];
  const estimate = record.estimate || {};
  const reasoning = record.reasoning || [];
  const workScopes = record.workScopes || [];
  const facts = record.polarisFacts || [];
  const customerFacts = record.customerFacts || {};

  // Check for missing information in reasoning
  const missingInfoItems = [];
  reasoning.forEach(function(r) {
    if (r.factor === 'Missing Estimating Info' && r.detail) {
      var items = r.detail.split(', ');
      items.forEach(function(item) { missingInfoItems.push(item); });
    }
  });

  // ── Send Estimate ──
  if (estimate.revenueRange && estimate.revenueRange !== 'Not yet estimated') {
    var estConfidence = estimate.confidence || 0;
    recommendations.push({
      title: 'Send Estimate',
      category: CATEGORIES.CUSTOMER,
      priority: estConfidence >= 70 ? 'High' : 'Medium',
      confidence: estConfidence,
      businessImpact: 'Revenue',
      urgency: estConfidence >= 70 ? 'Today' : 'This Week',
      timing: estConfidence >= 70 ? 'send within 24 hours' : 'send within 3 days',
      recommendedChannel: 'email',
      owner: 'sales_team',
      dependencies: [],
      explanation: 'Customer requested a quote. Operational intelligence determined a valid estimate exists.' + (estConfidence >= 70 ? ' High confidence in estimate accuracy.' : ''),
      supportingEvidence: [
        'estimate detected: ' + estimate.revenueRange,
        'estimate confidence: ' + estConfidence + '%'
      ]
    });
  }

  // ── Request Missing Information ──
  if (missingInfoItems.length > 0) {
    recommendations.push({
      title: 'Request Missing Information',
      category: CATEGORIES.CUSTOMER,
      priority: 'High',
      confidence: 90,
      businessImpact: 'Operational Efficiency',
      urgency: 'Today',
      timing: 'before proceeding with estimate',
      recommendedChannel: 'phone',
      owner: 'sales_team',
      dependencies: [],
      explanation: 'Operational intelligence identified missing information needed to complete the estimate.',
      supportingEvidence: missingInfoItems.slice(0, 5).map(function(item) {
        return 'missing information: ' + item;
      })
    });
  }

  // ── Schedule Site Visit ──
  if (estimate.revenueRange && estimate.revenueRange !== 'Not yet estimated') {
    var hasHazard = facts.some(function(f) {
      return f.variable && (f.variable.indexOf('hazard') !== -1 || f.variable.indexOf('risk') !== -1);
    });

    if (hasHazard || workScopes.length > 0) {
      recommendations.push({
        title: 'Schedule Site Visit',
        category: CATEGORIES.OPERATIONS,
        priority: hasHazard ? 'High' : 'Medium',
        confidence: hasHazard ? 95 : 75,
        businessImpact: hasHazard ? 'Risk Reduction' : 'Revenue',
        urgency: hasHazard ? 'Today' : 'This Week',
        timing: hasHazard ? 'schedule within 24 hours' : 'schedule within 1 week',
        recommendedChannel: 'phone',
        owner: 'operations_team',
        dependencies: ['customer_contact_made'],
        explanation: hasHazard
          ? 'Hazard identified in conversation — site visit required before work can proceed.'
          : 'Site visit needed to validate scope and provide accurate quote.',
        supportingEvidence: workScopes.map(function(s) {
          return 'work scope: ' + (s.description || s.serviceType || 'identified');
        })
      });
    }
  }

  return recommendations;
}

/**
 * Evaluate contact intelligence and generate relevant recommendations.
 */
function _evaluateContact(record) {
  const recommendations = [];
  const contactProfile = record.contactProfile || {};
  const relationshipProfile = record.relationshipProfile || {};
  const opportunities = record.opportunities || [];
  const healthScore = record.healthScore || {};
  const timeline = record.customerTimeline || [];

  // ── Follow Up ──
  if (relationshipProfile.type === 'new_lead' || relationshipProfile.type === 'returning') {
    var isReturning = relationshipProfile.type === 'returning';
    var hasRecentContact = false;
    if (timeline.length > 0) {
      var lastEvent = timeline[timeline.length - 1];
      var daysSince = (Date.now() - new Date(lastEvent.timestamp).getTime()) / 86400000;
      hasRecentContact = daysSince < 1;
    }

    if (!hasRecentContact) {
      recommendations.push({
        title: 'Follow Up',
        category: CATEGORIES.CUSTOMER,
        priority: isReturning ? 'High' : 'Medium',
        confidence: isReturning ? 85 : 65,
        businessImpact: 'Revenue',
        urgency: isReturning ? 'Today' : 'This Week',
        timing: isReturning ? 'follow up within 24 hours' : 'follow up within 3 days',
        recommendedChannel: isReturning ? 'phone' : 'email',
        owner: 'sales_team',
        dependencies: [],
        explanation: isReturning
          ? 'Returning customer — prompt follow-up increases conversion likelihood.'
          : 'New lead — follow up to maintain engagement and move toward commitment.',
        supportingEvidence: [
          'relationship: ' + relationshipProfile.label
        ]
      });
    }
  }

  // ── Upsell ──
  var upsellOpp = opportunities.filter(function(o) { return o.type === 'upsell'; });
  if (upsellOpp.length > 0) {
    recommendations.push({
      title: 'Upsell Opportunity',
      category: CATEGORIES.SALES,
      priority: 'Medium',
      confidence: 70,
      businessImpact: 'Revenue',
      urgency: 'This Week',
      timing: 'discuss during next customer contact',
      recommendedChannel: 'phone',
      owner: 'sales_team',
      dependencies: ['customer_contact_made'],
      explanation: 'Customer has demonstrated sufficient lifetime value to warrant upsell discussion.',
      supportingEvidence: upsellOpp.map(function(o) { return o.reason; })
    });
  }

  // ── Re-engagement ──
  var reactivationOpp = opportunities.filter(function(o) { return o.type === 'reactivation'; });
  if (reactivationOpp.length > 0) {
    recommendations.push({
      title: 'Re-engagement Campaign',
      category: CATEGORIES.CUSTOMER_SUCCESS,
      priority: 'Low',
      confidence: 50,
      businessImpact: 'Revenue',
      urgency: 'Future',
      timing: 'consider for next seasonal outreach',
      recommendedChannel: 'email',
      owner: 'marketing_team',
      dependencies: [],
      explanation: 'Inactive customer identified — re-engagement may reactivate relationship.',
      supportingEvidence: reactivationOpp.map(function(o) { return o.reason; })
    });
  }

  // ── Satisfaction Check ──
  if (relationshipProfile.type === 'repeat_customer' || relationshipProfile.type === 'frequent_shopper') {
    recommendations.push({
      title: 'Satisfaction Check',
      category: CATEGORIES.CUSTOMER_SUCCESS,
      priority: 'Medium',
      confidence: 75,
      businessImpact: 'Customer Satisfaction',
      urgency: 'This Week',
      timing: 'follow up after recent interaction',
      recommendedChannel: 'email',
      owner: 'customer_success_team',
      dependencies: [],
      explanation: 'Repeat customer — satisfaction check supports retention and long-term loyalty.',
      supportingEvidence: [
        'customer type: ' + relationshipProfile.label,
        'total jobs: ' + (healthScore.factors ? healthScore.factors.totalJobs : 'unknown')
      ]
    });
  }

  // ── Membership Offer ──
  if (relationshipProfile.type === 'returning' || relationshipProfile.type === 'repeat_customer') {
    recommendations.push({
      title: 'Membership Offer',
      category: CATEGORIES.SALES,
      priority: 'Low',
      confidence: 55,
      businessImpact: 'Revenue',
      urgency: 'Future',
      timing: 'present during next scheduled interaction',
      recommendedChannel: 'phone',
      owner: 'sales_team',
      dependencies: ['customer_contact_made'],
      explanation: 'Returning customer may benefit from membership or loyalty program.',
      supportingEvidence: [
        'customer has shown repeat business behavior'
      ]
    });
  }

  return recommendations;
}

/**
 * Evaluate financial signals and generate recommendations.
 */
function _evaluateFinancial(record) {
  const recommendations = [];
  const estimate = record.estimate || {};

  // ── Financing Discussion ──
  if (estimate.revenueRange) {
    var minVal = estimate.rangeMin || 0;
    if (minVal > 2000) {
      recommendations.push({
        title: 'Financing Discussion',
        category: CATEGORIES.SALES,
        priority: 'Low',
        confidence: 60,
        businessImpact: 'Revenue',
        urgency: 'Future',
        timing: 'discuss when presenting estimate',
        recommendedChannel: 'phone',
        owner: 'sales_team',
        dependencies: ['estimate_sent'],
        explanation: 'Estimated value exceeds $2,000 — customer may benefit from financing options.',
        supportingEvidence: [
          'estimated range: ' + estimate.revenueRange
        ]
      });
    }
  }

  return recommendations;
}

// ── Ranking Engine ──

const PRIORITY_ORDER = { 'Critical': 0, 'High': 1, 'Medium': 2, 'Low': 3 };
const URGENCY_ORDER = { 'Immediate': 0, 'Today': 1, 'This Week': 2, 'Future': 3 };

function _rankRecommendations(recommendations) {
  var sorted = recommendations.slice().sort(function(a, b) {
    // Sort by priority first
    var pDiff = (PRIORITY_ORDER[a.priority] || 99) - (PRIORITY_ORDER[b.priority] || 99);
    if (pDiff !== 0) return pDiff;
    // Then by urgency
    var uDiff = (URGENCY_ORDER[a.urgency] || 99) - (URGENCY_ORDER[b.urgency] || 99);
    if (uDiff !== 0) return uDiff;
    // Then by confidence descending
    return (b.confidence || 0) - (a.confidence || 0);
  });

  // Assign rank
  sorted.forEach(function(r, i) {
    r.rank = i + 1;
  });

  return sorted;
}

// ── Dependency Engine ──

const DEPENDENCY_MAP = {
  'Send Estimate': [],
  'Request Missing Information': [],
  'Follow Up': [],
  'Schedule Site Visit': ['customer_contact_made'],
  'Upsell Opportunity': ['customer_contact_made'],
  'Membership Offer': ['customer_contact_made'],
  'Financing Discussion': ['estimate_sent'],
  'Re-engagement Campaign': [],
  'Satisfaction Check': [],
  'Call Back': [],
  'Schedule Job': ['estimate_sent', 'estimate_accepted'],
  'Dispatch Crew': ['job_scheduled'],
  'Invoice Customer': ['job_completed'],
  'Collect Payment': ['invoice_sent'],
  'Review Request': ['job_completed']
};

function _applyDependencies(recommendations) {
  // Dependency validation: flag recommendations whose dependencies are unmet
  var existingTitles = recommendations.map(function(r) { return r.title; });

  recommendations.forEach(function(r) {
    var deps = DEPENDENCY_MAP[r.title] || [];
    var met = deps.filter(function(d) {
      // Check if any recommendation satisfies this dependency
      var depTitle = d.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
      return existingTitles.indexOf(depTitle) !== -1;
    });
    var unmet = deps.filter(function(d) { return met.indexOf(d) === -1; });
    r.dependencies = deps;
    r.dependencyStatus = unmet.length === 0 ? 'met' : 'unmet';
    r.unmetDependencies = unmet;
  });

  return recommendations;
}

// ── Deduplication ──

function _deduplicate(recommendations) {
  var seen = {};
  return recommendations.filter(function(r) {
    var key = r.title;
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

// ── Main Entry Point ──

/**
 * Build next-step recommendations from the canonical Polaris record.
 *
 * @param {object} record - The full canonical Polaris record from buildPolarisIntelligence
 * @returns {object} { nextSteps: array, generatedAt, recordId }
 */
function buildNextSteps(record) {
  if (!record) {
    return {
      nextSteps: [],
      generatedAt: _now(),
      recordId: null,
      noRecommendationReason: 'No record provided'
    };
  }

  // Collect recommendations from all intelligence layers
  var operational = _evaluateOperational(record);
  var contact = _evaluateContact(record);
  var financial = _evaluateFinancial(record);

  // Combine and deduplicate
  var all = operational.concat(contact).concat(financial);
  var unique = _deduplicate(all);

  // Apply dependencies
  var withDeps = _applyDependencies(unique);

  // Rank
  var ranked = _rankRecommendations(withDeps);

  // Assign IDs
  ranked.forEach(function(r) {
    r.id = _generateId();
  });

  // Handle empty case
  if (ranked.length === 0) {
    return {
      nextSteps: [],
      generatedAt: _now(),
      recordId: record.generatedAt || null,
      noRecommendationReason: 'Insufficient evidence to generate recommendations'
    };
  }

  return {
    nextSteps: ranked,
    generatedAt: _now(),
    recordId: record.generatedAt || null,
    totalRecommendations: ranked.length
  };
}

module.exports = {
  buildNextSteps: buildNextSteps,
  CATEGORIES: CATEGORIES
};