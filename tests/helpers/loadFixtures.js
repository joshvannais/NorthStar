'use strict';

const fs = require('fs');
const path = require('path');

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures');

/**
 * Load a JSON fixture file from tests/fixtures/.
 * @param {string} name - Fixture filename without path (e.g., 'leads.json')
 * @returns {*} Parsed JSON content
 */
function loadFixture(name) {
  const filePath = path.join(FIXTURE_DIR, name);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Get a test lead with all required fields populated.
 * @param {Object} [overrides] - Fields to override
 * @returns {Object} Lead object
 */
function makeLead(overrides = {}) {
  return {
    id: 'test-lead-001',
    caller: 'Test Customer',
    phone: '(555) 555-0100',
    address: '123 Test St',
    service: 'Window replacement',
    icon: '🪟',
    avgPrice: 5000,
    jobDetail: '5 windows, double-pane',
    duration: '0:45',
    status: 'answered',
    outcome: 'appointment-set',
    time: 'Today, 9:00 AM',
    receivedAt: new Date().toISOString(),
    summary: 'Window replacement test job',
    priceBreakdown: '5 windows x $1000',
    transcript: 'Test transcript',
    pricingBreakdown: [{ l: 'Window x5', a: 5000 }],
    ...overrides,
  };
}

/**
 * Create multiple test leads.
 * @param {number} count - Number of leads to create
 * @param {Object} [base] - Base properties shared across leads
 * @returns {Array<Object>}
 */
function makeLeads(count, base = {}) {
  const leads = [];
  for (let i = 0; i < count; i++) {
    leads.push(makeLead({
      id: `test-lead-${String(i + 1).padStart(3, '0')}`,
      caller: `Test Customer ${i + 1}`,
      avgPrice: (base.avgPrice || 5000) + i * 500,
      ...base,
    }));
  }
  return leads;
}

module.exports = { loadFixture, makeLead, makeLeads };
