/**
 * Test fixtures — shared test data for integration, API, regression, and determinism tests.
 * 
 * Provides deterministic test leads that exercise all edge cases from M16.5 remediation:
 * - Data drift (all 20 fields preserved)
 * - NaN guards (edge-case inputs produce finite outputs)
 * - Empty lead arrays
 * - Mixed outcomes
 * - High-value leads
 * - Missing/partial data
 */
'use strict';

/**
 * A minimal valid lead with all essential fields.
 */
const sampleLead = {
  id: 'test-lead-001',
  caller: 'Test Customer',
  phone: '(555) 123-4567',
  address: '123 Test St, Springfield, IL',
  service: 'HVAC Repair',
  icon: '🔧',
  avgPrice: 2500,
  jobDetail: 'Replace AC compressor, 3-ton unit',
  duration: '2:30',
  status: 'answered',
  outcome: 'follow-up',
  time: 'Today, 10:00 AM',
  receivedAt: '2026-07-16T15:00:00.000Z',
  summary: 'HVAC: AC compressor replacement, 3-ton',
  priceBreakdown: 'Compressor $1200 + Labor $800 + Refrigerant $500',
  transcript: 'AI: Hello, how can I help?\nCustomer: My AC is broken.',
  pricingBreakdown: [
    { item: 'Compressor', cost: 1200 },
    { item: 'Labor', cost: 800 },
    { item: 'Refrigerant', cost: 500 },
  ],
};

/**
 * Lead with NaN-triggering edge-case values.
 * All 4 M16.5 NaN test cases:
 * - Zero price
 * - Missing service
 * - Negative price
 * - Empty strings
 */
const nanEdgeLead = {
  id: 'test-nan-001',
  caller: 'NaN Edge Customer',
  phone: '',
  address: '',
  service: '',
  icon: '',
  avgPrice: 0,
  jobDetail: '',
  duration: '',
  status: 'answered',
  outcome: 'lead-captured',
  time: '',
  receivedAt: '2026-07-16T12:00:00.000Z',
  summary: '',
  priceBreakdown: '',
  transcript: '',
  pricingBreakdown: [],
};

/**
 * Lead with negative price (another NaN trigger).
 */
const negativePriceLead = {
  id: 'test-neg-001',
  caller: 'Negative Price Lead',
  phone: '(555) 000-0000',
  address: '456 Negative Ave',
  service: 'Window Replacement',
  icon: '🪟',
  avgPrice: -500,
  jobDetail: 'Broken window',
  duration: '1:30',
  status: 'answered',
  outcome: 'follow-up',
  time: 'Yesterday',
  receivedAt: '2026-07-15T10:00:00.000Z',
  summary: 'Window: broken pane',
  priceBreakdown: '',
  transcript: '',
  pricingBreakdown: [],
};

/**
 * High-value lead for testing profit calculations.
 */
const highValueLead = {
  id: 'test-hv-001',
  caller: 'Big Money Client',
  phone: '(555) 999-8888',
  address: '1 Wealthy Lane, Beverly Hills, CA',
  service: 'Roof Repair',
  icon: '🏠',
  avgPrice: 15000,
  jobDetail: 'Full roof replacement, 3000sqft, architectural shingles',
  duration: '8:00',
  status: 'answered',
  outcome: 'appointment-set',
  time: 'Today, 8:00 AM',
  receivedAt: '2026-07-10T08:00:00.000Z',
  summary: 'Roof: full replacement, 3000sqft',
  priceBreakdown: 'Materials $8000 + Labor $5000 + Disposal $2000',
  transcript: 'Big roof job.',
  pricingBreakdown: [
    { item: 'Materials', cost: 8000 },
    { item: 'Labor', cost: 5000 },
    { item: 'Disposal', cost: 2000 },
  ],
};

/**
 * Lead with no-interest outcome (should be excluded from rankings).
 */
const noInterestLead = {
  id: 'test-ni-001',
  caller: 'Not Interested',
  phone: '(555) 111-2222',
  address: '789 No Way',
  service: 'Tree Removal',
  icon: '🌳',
  avgPrice: 3000,
  jobDetail: 'Remove dead oak tree',
  duration: '4:00',
  status: 'answered',
  outcome: 'no-interest',
  time: 'Yesterday',
  receivedAt: '2026-07-15T14:00:00.000Z',
  summary: 'Tree: dead oak removal',
  priceBreakdown: '',
  transcript: '',
  pricingBreakdown: [],
};

/**
 * Full 4-lead test set exercising all scenarios.
 */
const fullTestSet = [
  sampleLead,
  nanEdgeLead,
  negativePriceLead,
  highValueLead,
  noInterestLead,
];

/**
 * All 20 fields that must be preserved through compactContext (data drift check).
 */
const REQUIRED_LEAD_FIELDS = [
  'id', 'caller', 'phone', 'address', 'service', 'icon',
  'avgPrice', 'jobDetail', 'duration', 'status', 'outcome',
  'time', 'receivedAt', 'summary', 'priceBreakdown',
  'transcript', 'pricingBreakdown',
];

module.exports = {
  sampleLead,
  nanEdgeLead,
  negativePriceLead,
  highValueLead,
  noInterestLead,
  fullTestSet,
  REQUIRED_LEAD_FIELDS,
};
