/**
 * contactIntelligence.js — M19.5 Phase E1: Contact Intelligence Enrichment
 *
 * Builds customer intelligence from the canonical Polaris record.
 * Consumer of Phase C + D output — never duplicates transcript parsing,
 * evidence extraction, speaker attribution, or operational reasoning.
 *
 * Answers: "Who is this customer and what should the business do next?"
 * Independent from operational intelligence ("What work needs to be done?").
 *
 * Both layers share the same canonical Polaris record.
 *
 * ——— KNOWN LIMITATIONS (Phase E1) ———
 *
 * 1. Identity resolution:
 *    - Phone is the primary identity signal. Uses substring search, not normalized exact matching.
 *    - Name fallback is provisional and must not be considered authoritative identity resolution.
 *      A name-only match may join two unrelated customers who share the same name.
 *    - Email matching and address matching are not implemented.
 *    - Conflicting identity evidence is not resolved.
 *    - Shared household and shared business numbers are not supported.
 *    - Multiple properties per contact are not modeled.
 *
 * 2. Timeline:
 *    - Normal single-pass processing appends one timeline entry per processed interaction.
 *    - Retry-safe event deduplication is not yet implemented. Without an idempotency key
 *      or unique source-event identifier, a webhook retry, repeated callback, replay, or
 *      duplicated processing request may create another timeline entry for the same event.
 *    - Timeline events are stored generically as notes. Calls, estimates, appointments,
 *      jobs, invoices, payments, complaints, and warranties are not represented as
 *      distinct event types.
 *
 * 3. Persistence:
 *    - Customer information persists through the existing JSON-backed customer-engine store
 *      and accumulates across calls, but a dedicated durable customer repository has not
 *      yet been implemented.
 *    - Customer records use the recommendations store rather than a dedicated customer database.
 *    - Persistence failure falls back to in-memory state and may lose updates after process termination.
 *    - Tenant isolation is not implemented.
 */
'use strict';

const customerEngine = require('./customer-engine');

// ── Relationship Classification ──

/**
 * Classify the customer relationship based on history and current conversation.
 * Evidence-driven — never hard-coded assumptions.
 */
function classifyRelationship(customer, record) {
  const evidence = [];
  let type = 'new_lead';
  let label = 'New Lead';

  if (!customer || customer.totalJobs === undefined) {
    return { type: 'new_lead', label: 'New Lead', evidence: ['No prior customer history'] };
  }

  // Evidence: total jobs
  if (customer.totalJobs > 0) {
    evidence.push(customer.totalJobs + ' previous job(s)');
  }

  // Evidence: total revenue
  if (customer.totalRevenue > 0) {
    evidence.push('$' + customer.totalRevenue.toLocaleString() + ' lifetime revenue');
  }

  // Evidence: recency
  if (customer.lastContactedAt) {
    const daysSince = (Date.now() - new Date(customer.lastContactedAt).getTime()) / 86400000;
    if (daysSince < 90) {
      evidence.push('Last contacted ' + Math.round(daysSince) + ' days ago');
    } else {
      evidence.push('Inactive for ' + Math.round(daysSince) + ' days');
    }
  }

  // Classification logic
  if (customer.totalJobs === 0) {
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
  }

  // Status-based overrides
  if (customer.status === 'inactive') {
    type = 'inactive';
    label = 'Inactive Customer';
    evidence.push('Account marked inactive');
  }

  // Check for VIP indicators
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

/**
 * Extract customer identity from the canonical record.
 * Reads from customerFacts and polarisFacts — never re-parses transcripts.
 */
function extractIdentity(record) {
  const identity = {
    name: null,
    phone: null,
    address: null,
    email: null,
    confidence: 0
  };

  // Primary source: customerFacts (from executiveSummary / Retell data)
  if (record.customerFacts) {
    if (record.customerFacts.name) identity.name = record.customerFacts.name;
    if (record.customerFacts.phone) identity.phone = record.customerFacts.phone;
    if (record.customerFacts.address) identity.address = record.customerFacts.address;
    if (record.customerFacts.email) identity.email = record.customerFacts.email;
  }

  // Secondary source: polarisFacts (typed facts from conversation)
  const facts = record.polarisFacts || [];
  for (let i = 0; i < facts.length; i++) {
    const f = facts[i];
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
  let filled = 0;
  if (identity.name) filled++;
  if (identity.phone) filled++;
  if (identity.address) filled++;
  if (identity.email) filled++;
  identity.confidence = Math.min(1.0, filled / 3); // 3+ fields = 1.0

  return identity;
}

// ── Find or Create Customer ──

/**
 * Find existing customer by phone, or create a new one.
 */
function findOrCreateCustomer(identity) {
  if (!identity || !identity.phone && !identity.name) {
    return null;
  }

  // Try to find by phone (most reliable identifier)
  if (identity.phone) {
    const searchResult = customerEngine.searchCustomers(identity.phone);
    if (searchResult && searchResult.customers && searchResult.customers.length > 0) {
      const existing = searchResult.customers[0];
      // Update with latest info
      const updates = {};
      if (identity.name && identity.name !== existing.name) updates.name = identity.name;
      if (identity.address && identity.address !== existing.address) updates.address = identity.address;
      if (identity.email && identity.email !== existing.email) updates.email = identity.email;
      if (Object.keys(updates).length > 0) {
        customerEngine.updateCustomer(existing.id, updates);
      }
      return customerEngine.getCustomer(existing.id);
    }
  }

  // Try to find by name (fallback)
  if (identity.name) {
    const searchResult = customerEngine.searchCustomers(identity.name);
    if (searchResult && searchResult.customers && searchResult.customers.length > 0) {
      const existing = searchResult.customers[0];
      if (identity.phone && existing.phone === identity.phone) {
        return customerEngine.getCustomer(existing.id);
      }
    }
  }

  // No existing customer — create new
  if (identity.name) {
    const result = customerEngine.createCustomer({
      name: identity.name,
      phone: identity.phone || undefined,
      email: identity.email || undefined,
      address: identity.address || undefined
    });
    if (result && result.id) {
      return customerEngine.getCustomer(result.id);
    }
  }

  return null;
}

// ── Timeline Entry ──

/**
 * Add a timeline entry for this conversation.
 */
function addTimelineEntry(customer, record) {
  if (!customer || !customer.id) return null;

  // Build a structured note from the conversation
  const serviceDesc = record.requestedService && record.requestedService.primary
    ? record.requestedService.primary
    : 'General inquiry';
  const revenueRange = record.estimate && record.estimate.revenueRange
    ? record.estimate.revenueRange
    : 'Not yet estimated';

  const noteText = 'Phone call — ' + serviceDesc +
    '. Estimated range: ' + revenueRange +
    '. Industry: ' + (record.industry || 'unknown') + '.';

  return customerEngine.addCustomerNote(customer.id, {
    text: noteText,
    author: 'polaris_contact_intelligence'
  });
}

// ── Opportunity Detection ──

/**
 * Detect business opportunities from the canonical record.
 */
function detectOpportunities(customer, record) {
  const opportunities = [];
  const estimate = record.estimate || {};
  const reasoning = record.reasoning || [];

  // Opportunity: outstanding estimate
  if (estimate.revenueRange && estimate.revenueRange !== 'Not yet estimated') {
    opportunities.push({
      type: 'outstanding_estimate',
      label: 'Outstanding Estimate',
      priority: 'medium',
      reason: 'Estimate of ' + estimate.revenueRange + ' has been generated'
    });
  }

  // Opportunity: no follow-up needed (estimate exists)
  if (estimate.confidence !== undefined) {
    opportunities.push({
      type: 'no_follow_up',
      label: 'Review Estimate',
      priority: estimate.confidence < 50 ? 'high' : 'medium',
      reason: 'Estimate confidence is ' + estimate.confidence + '% — may need clarification'
    });
  }

  // Opportunity: repeat work (returning customer)
  if (customer && customer.totalJobs > 0) {
    opportunities.push({
      type: 'repeat_work',
      label: 'Repeat Work Opportunity',
      priority: 'medium',
      reason: 'Customer has ' + customer.totalJobs + ' previous job(s)'
    });
  }

  // Opportunity: maintenance (if work was done)
  if (customer && customer.totalJobs > 0 && customer.lastContactedAt) {
    const daysSince = (Date.now() - new Date(customer.lastContactedAt).getTime()) / 86400000;
    if (daysSince > 180) {
      opportunities.push({
        type: 'seasonal',
        label: 'Seasonal Service Opportunity',
        priority: 'low',
        reason: 'Customer inactive for ' + Math.round(daysSince) + ' days — consider seasonal outreach'
      });
    }
  }

  // Opportunity: reactivation (inactive customer)
  if (customer && customer.status === 'inactive') {
    opportunities.push({
      type: 'reactivation',
      label: 'Inactive Customer Reactivation',
      priority: 'low',
      reason: 'Customer is marked inactive — consider re-engagement campaign'
    });
  }

  // Opportunity: high-value upsell
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

/**
 * Generate a concise executive briefing for the customer.
 */
function buildExecutiveSummary(customer, record, opportunities) {
  const parts = [];

  // Customer identity
  const name = (record.customerFacts && record.customerFacts.name) || (customer && customer.name) || 'Unknown customer';
  parts.push(name + ' contacted NorthStar regarding ' +
    ((record.requestedService && record.requestedService.primary) || 'a service request') + '.');

  // Relationship
  if (customer) {
    if (customer.totalJobs > 0) {
      parts.push('Returning customer with ' + customer.totalJobs + ' previous job(s) totaling $' +
        customer.totalRevenue.toLocaleString() + ' in lifetime revenue.');
    } else {
      parts.push('New lead — no prior history.');
    }
  }

  // Opportunity summary
  const highPriority = opportunities.filter(function(o) { return o.priority === 'high'; });
  if (highPriority.length > 0) {
    parts.push('Action needed: ' + highPriority.map(function(o) { return o.label; }).join(', ') + '.');
  }

  return parts.join(' ');
}

// ── Recommended Actions ──

/**
 * Convert opportunities into recommended actions.
 */
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
 * This is the ONLY public API. It consumes the canonical record produced by
 * buildPolarisIntelligence() and returns additive contact fields only.
 * It never modifies the input record.
 *
 * @param {object} record - The full canonical Polaris record
 * @returns {object} Additive contact intelligence fields
 */
function enrichCanonicalRecord(record) {
  // 1. Extract identity from canonical record data
  const identity = extractIdentity(record);

  // 2. Look up or create customer profile
  const customer = findOrCreateCustomer(identity);

  // 3. Classify relationship
  const relationship = classifyRelationship(customer, record);

  // 4. Add timeline entry
  const timelineEntry = addTimelineEntry(customer, record);

  // 5. Update customer metrics
  if (customer && customer.id) {
    customerEngine.updateCustomerMetrics(customer.id, {});
  }

  // 6. Compute health score
  const health = customer && customer.id
    ? customerEngine.calculateCustomerHealth(customer.id)
    : null;

  // 7. Detect opportunities
  const opportunities = detectOpportunities(customer, record);

  // 8. Build executive summary
  const summary = buildExecutiveSummary(customer, record, opportunities);

  // 9. Build recommended actions
  const actions = buildRecommendedActions(opportunities);

  // 10. Get timeline
  const timeline = customer && customer.id
    ? customerEngine.getCustomerTimeline(customer.id)
    : { entries: [] };

  // Return additive fields only — never modify the original record
  return {
    contactProfile: identity,
    relationshipProfile: relationship,
    customerTimeline: timeline.entries || [],
    opportunities: opportunities,
    healthScore: health,
    executiveSummary: summary,
    recommendedActions: actions
  };
}

module.exports = {
  enrichCanonicalRecord: enrichCanonicalRecord
};