/**
 * contactIntelligence.js — M19.5 Phase E1/E2: Contact Intelligence
 *
 * Builds customer intelligence from the canonical Polaris record.
 * Consumer of Phase C + D output — never duplicates transcript parsing,
 * evidence extraction, speaker attribution, or operational reasoning.
 *
 * Phase E2 additions:
 * - Uses dedicated customerRepository (not customer-engine piggybacking)
 * - Proper identity resolution with normalization (phone, email)
 * - Typed timeline events with sourceEventId idempotency
 * - Confidence-weighted identity matching
 * - Weak-match rejection (no auto-merge on name alone)
 * - Multi-property support
 *
 * Answers: "Who is this customer and what should the business do next?"
 */
'use strict';

const repo = require('./customerRepository');

// ── Relationship Classification ──

function classifyRelationship(customer) {
  if (!customer || !customer.id) {
    return { type: 'new_lead', label: 'New Lead', evidence: ['No prior customer history'] };
  }

  var evidence = [];
  var type = 'new_lead';
  var label = 'New Lead';

  if (customer.events && customer.events.length > 0) {
    evidence.push(customer.events.length + ' recorded interaction(s)');
  }

  if (customer.totalJobs > 0) {
    evidence.push(customer.totalJobs + ' previous job(s)');
  }

  if (customer.totalRevenue > 0) {
    evidence.push('$' + customer.totalRevenue.toLocaleString() + ' lifetime revenue');
  }

  if (customer.lastContactedAt) {
    var daysSince = (Date.now() - new Date(customer.lastContactedAt).getTime()) / 86400000;
    if (daysSince < 90) {
      evidence.push('Last contacted ' + Math.round(daysSince) + ' days ago');
    } else {
      evidence.push('Inactive for ' + Math.round(daysSince) + ' days');
    }
  }

  if (customer.events && customer.events.length === 0) {
    type = 'new_lead';
    label = 'New Lead';
  } else if (customer.totalRevenue >= 10000) {
    type = 'high_lifetime_value';
    label = 'High Lifetime Value';
  } else if (customer.totalJobs >= 5) {
    type = 'frequent_shopper';
    label = 'Frequent Shopper';
  } else if (customer.totalJobs >= 2) {
    type = 'repeat_customer';
    label = 'Repeat Customer';
  } else if (customer.events.length > 0) {
    type = 'returning';
    label = 'Returning Customer';
  }

  if (customer.status === 'inactive') {
    type = 'inactive';
    label = 'Inactive Customer';
    evidence.push('Account marked inactive');
  }

  if (customer.totalRevenue >= 50000) {
    type = 'vip';
    label = 'VIP Customer';
    evidence.push('Lifetime revenue exceeds $50,000');
  }

  if (evidence.length === 0) {
    evidence.push('Customer exists in system');
  }

  return { type: type, label: label, evidence: evidence };
}

// ── Identity Extraction ──

function extractIdentity(record) {
  var identity = {
    name: null,
    phone: null,
    address: null,
    email: null,
    confidence: 0
  };

  if (record.customerFacts) {
    if (record.customerFacts.name) identity.name = record.customerFacts.name;
    if (record.customerFacts.phone) identity.phone = record.customerFacts.phone;
    if (record.customerFacts.address) identity.address = record.customerFacts.address;
    if (record.customerFacts.email) identity.email = record.customerFacts.email;
  }

  var facts = record.polarisFacts || [];
  for (var i = 0; i < facts.length; i++) {
    var f = facts[i];
    if (f.status === 'collected' && f.evidence && f.evidence.speaker === 'customer') {
      if (f.variable === 'customer_name' && !identity.name) {
        identity.name = f.normalizedValue;
      } else if (f.variable === 'customer_phone' && !identity.phone) {
        identity.phone = f.normalizedValue;
      } else if (f.variable === 'service_address' && !identity.address) {
        identity.address = f.normalizedValue;
      }
    }
  }

  // Compute confidence based on how many fields we have
  var filled = 0;
  if (identity.name) filled++;
  if (identity.phone) filled++;
  if (identity.address) filled++;
  if (identity.email) filled++;
  identity.confidence = Math.min(1.0, filled / 3);

  return identity;
}

// ── Find or Create Customer ──

function findOrCreateCustomer(identity) {
  if (!identity || (!identity.phone && !identity.email && !identity.name)) {
    return null;
  }

  // Use identity resolution from customerRepository
  var resolution = repo.resolveIdentity({
    phone: identity.phone,
    email: identity.email,
    name: identity.name
  });

  if (resolution.customerId) {
    // Found existing customer — update with latest info
    var updates = {};
    if (identity.name) updates.name = identity.name;
    if (identity.phone) updates.phone = identity.phone;
    if (identity.email) updates.email = identity.email;
    if (Object.keys(updates).length > 0) {
      repo.updateCustomer(resolution.customerId, updates);
    }
    return repo.getCustomer(resolution.customerId);
  }

  // No match — create new customer
  if (identity.name) {
    return repo.createCustomer({
      name: identity.name,
      phone: identity.phone || undefined,
      email: identity.email || undefined,
      address: identity.address || undefined
    });
  }

  return null;
}

// ── Add Timeline Event ──

function addCallEvent(customer, record, sourceEventId, identity) {
  if (!customer || !customer.id) return null;

  var serviceDesc = (record.requestedService && record.requestedService.primary)
    ? record.requestedService.primary
    : 'General inquiry';

  var revenueRange = (record.estimate && record.estimate.revenueRange)
    ? record.estimate.revenueRange
    : 'Not yet estimated';

  return repo.addEvent(customer.id, {
    eventType: repo.EVENT_TYPES.CALL_RECEIVED,
    sourceEventId: sourceEventId,
    occurredAt: record.generatedAt || new Date().toISOString(),
    description: 'Phone call — ' + serviceDesc + '. Estimated range: ' + revenueRange,
    source: 'polaris_contact_intelligence',
    evidence: { service: serviceDesc, revenueRange: revenueRange },
    data: {
      industry: record.industry || null,
      estimateConfidence: (record.estimate && record.estimate.confidence) || null,
      serviceAddress: identity.address || null
    }
  });
}

// ── Opportunity Detection ──

function detectOpportunities(customer, record) {
  var opportunities = [];

  if (record.estimate && record.estimate.revenueRange && record.estimate.revenueRange !== 'Not yet estimated') {
    opportunities.push({
      type: 'outstanding_estimate',
      label: 'Outstanding Estimate',
      priority: 'medium',
      reason: 'Estimate of ' + record.estimate.revenueRange + ' has been generated'
    });
  }

  if (record.estimate && record.estimate.confidence !== undefined) {
    opportunities.push({
      type: 'no_follow_up',
      label: 'Review Estimate',
      priority: record.estimate.confidence < 50 ? 'high' : 'medium',
      reason: 'Estimate confidence is ' + record.estimate.confidence + '%'
    });
  }

  if (customer && customer.totalJobs > 0) {
    opportunities.push({
      type: 'repeat_work',
      label: 'Repeat Work Opportunity',
      priority: 'medium',
      reason: 'Customer has ' + customer.totalJobs + ' previous job(s)'
    });
  }

  if (customer && customer.totalJobs > 0 && customer.lastContactedAt) {
    var daysSince = (Date.now() - new Date(customer.lastContactedAt).getTime()) / 86400000;
    if (daysSince > 180) {
      opportunities.push({
        type: 'seasonal',
        label: 'Seasonal Service Opportunity',
        priority: 'low',
        reason: 'Customer inactive for ' + Math.round(daysSince) + ' days'
      });
    }
  }

  if (customer && customer.status === 'inactive') {
    opportunities.push({
      type: 'reactivation',
      label: 'Inactive Customer Reactivation',
      priority: 'low',
      reason: 'Customer is marked inactive'
    });
  }

  if (customer && customer.totalRevenue >= 5000) {
    opportunities.push({
      type: 'upsell',
      label: 'Upsell Opportunity',
      priority: 'low',
      reason: 'Customer has $' + customer.totalRevenue.toLocaleString() + ' lifetime value'
    });
  }

  return opportunities;
}

// ── Executive Summary ──

function buildExecutiveSummary(customer, record, opportunities) {
  var parts = [];

  var name = (record.customerFacts && record.customerFacts.name) || (customer && customer.name) || 'Unknown customer';
  parts.push(name + ' contacted NorthStar regarding ' +
    ((record.requestedService && record.requestedService.primary) || 'a service request') + '.');

  if (customer) {
    if (customer.totalJobs > 0) {
      parts.push('Returning customer with ' + customer.totalJobs + ' previous job(s) totaling $' +
        customer.totalRevenue.toLocaleString() + ' in lifetime revenue.');
    } else if (customer.events && customer.events.length > 0) {
      parts.push('Previous contact recorded — ' + customer.events.length + ' prior interaction(s).');
    } else {
      parts.push('New lead — no prior history.');
    }
  }

  var highPriority = opportunities.filter(function(o) { return o.priority === 'high'; });
  if (highPriority.length > 0) {
    parts.push('Action needed: ' + highPriority.map(function(o) { return o.label; }).join(', ') + '.');
  }

  return parts.join(' ');
}

// ── Recommended Actions ──

function buildRecommendedActions(opportunities) {
  return opportunities.map(function(o) {
    return {
      action: o.label,
      priority: o.priority,
      reason: o.reason
    };
  });
}

// ── Main Entry Point ──

/**
 * Enrich the canonical Polaris record with contact intelligence.
 *
 * @param {object} record - The full canonical Polaris record
 * @param {string} [sourceEventId] - Optional idempotency key for this interaction
 * @returns {object} Additive contact intelligence fields
 */
function enrichCanonicalRecord(record, sourceEventId) {
  var identity = extractIdentity(record);

  var customer = findOrCreateCustomer(identity);

  var relationship = classifyRelationship(customer);

  var eventResult = addCallEvent(customer, record, sourceEventId || record.generatedAt, identity);

  // Update customer metrics
  if (customer && customer.id) {
    // Update last contacted time
    repo.updateCustomer(customer.id, {});
  }

  // Build timeline from repository events, mapped to canonical format
  var timeline = [];
  if (customer && customer.id) {
    var rawEvents = repo.getEvents(customer.id);
    timeline = rawEvents.map(function(e) {
      return {
        timestamp: e.occurredAt,
        type: e.eventType,
        description: e.description,
        source: e.source,
        data: {
          eventId: e.eventId,
          sourceEventId: e.sourceEventId,
          recordedAt: e.recordedAt
        }
      };
    });
  }

  var opportunities = detectOpportunities(customer, record);

  var summary = buildExecutiveSummary(customer, record, opportunities);

  var actions = buildRecommendedActions(opportunities);

  return {
    contactProfile: identity,
    relationshipProfile: relationship,
    customerTimeline: timeline,
    opportunities: opportunities,
    healthScore: null,
    executiveSummary: summary,
    recommendedActions: actions
  };
}

module.exports = {
  enrichCanonicalRecord: enrichCanonicalRecord
};