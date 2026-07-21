/**
 * Polaris Card Regression Test — HVAC Canonical Record
 *
 * Source: Production simulation, commit 48b32cc
 * Service: HVAC — 3.5-ton SEER-18 replacement with new ductwork
 * Customer: James Wilson
 *
 * This record validates that the Polaris/Customer Detail card rebuild
 * uses canonical Polaris intelligence, not legacy fallback mappings.
 */

const REGRESSION_HVAC = {
  // ── Canonical Polaris Output (what the card MUST render) ──
  canonical: {
    classifiedService: "HVAC",
    classificationConfidence: "high",
    evidence: [
      "Transcript contains HVAC keywords: ac, system, ton, furnace, ductwork",
      "Customer described: central AC + gas furnace",
      "Customer stated 3.5 tons",
      "Customer requested SEER-18 or higher efficiency",
    ],
    extractedScope: {
      jobType: "replace",
      systemType: "central AC + gas furnace",
      tonnage: 3.5,
      seer: 18,
      sqft: 2400,
      existingAge: 18,
      ductworkReplace: true,
      thermostat: "smart",
      fuelType: "gas",
      urgency: "high — system failed",
      timeline: "as soon as possible",
      access: "attic access through hallway",
    },
    pricingRecommendation: "$24,395–$33,005",
    pricingBreakdown: [
      { label: "Equipment (3.5-ton SEER-18)", amount: 9100 },
      { label: "Ductwork replacement (2,400 sqft)", amount: 8400 },
      { label: "Smart thermostat", amount: 350 },
      { label: "Installation labor", amount: 4463 },
      { label: "Permits", amount: 200 },
    ],
    pricingTotal: 22513,
    pricingRange: { low: 24395, high: 33005 },
    confidence: { score: 80, label: "High", explanation: "Most required scope collected. Estimate is reliable." },
    recommendedAction: {
      action: "Schedule on-site estimate",
      description: "Customer requested an in-person assessment. Confirm appointment and dispatch estimator to James.",
      priority: "high",
    },
    missingInformation: [],
    assumptions: [],
  },

  // ── Legacy Output (what the card must NOT render) ──
  mustNotRender: [
    "Legacy $500 recommendation",
    "Legacy 5% confidence",
    "Legacy 'Nurture with follow-up call'",
    "Fence-specific fields: linearFeet, gates, removal",
    "$0 pricing components",
    "Contradictory pricing where total ≠ sum of breakdown",
    "Customer name appended to service (e.g., 'Fence Installation – James Wilson')",
  ],

  // ── Verification Steps ──
  verification: [
    "1. Open Customer Detail drawer for James Wilson (HVAC record)",
    "2. Service field shows: 'HVAC' (not 'Fence Installation' or other)",
    "3. Pricing shows: $24,395–$33,005 range (not $500)",
    "4. Confidence shows: 80% / High (not 5%)",
    "5. Action shows: 'Schedule on-site estimate' (not 'Nurture with follow-up call')",
    "6. Pricing breakdown has 5 HVAC-specific items summing to ~$22,513",
    "7. Scope shows HVAC dimensions: tonnage, SEER, sqft, ductwork, thermostat",
    "8. No fence-specific fields appear (linear feet, gates, removal)",
    "9. Transcript matches the scope story (15+ turns, HVAC discovery)",
    "10. Evidence section shows transcript-derived facts, not predetermined labels",
  ],

  // ── Record Identity ──
  identity: {
    commit: "48b32cc",
    customer: "James Wilson",
    service: "hvac",
    timestamp: "2026-07-21",
    pipeline: "universal (service-catalog + pipeline.js)",
  },
};

module.exports = REGRESSION_HVAC;
