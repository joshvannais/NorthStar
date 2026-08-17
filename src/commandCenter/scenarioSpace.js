'use strict';

const DIMENSION_ORDER = Object.freeze([
  'business',
  'service',
  'intent',
  'urgency',
  'context',
  'scheduling',
  'outcome',
]);

function option(id, label, description, material) {
  return Object.freeze({ id, label, description, material: Object.freeze({ ...material }) });
}

const DIMENSIONS = Object.freeze({
  business: Object.freeze({
    label: 'Select Fictional Business',
    options: Object.freeze([
      option('owner_operator', 'Rivera Home Services', 'Owner-operated roofing and exterior company serving a practical 28-mile radius with one estimator, a two-person crew, a material trailer, roof-access equipment, weekday scheduling, and owner-reviewed pricing.', {
        capacityLabel: 'Owner schedule', assignedTo: 'Maria Rivera', capacityRisk: 'The owner is the only estimator.',
        serviceRadiusMiles: 28, crewCount: 1, pricingModel: 'Owner-reviewed scope and material pricing'
      }),
      option('growing_residential', 'Pine & Peak Residential', 'Growing residential service company covering a realistic 35-mile radius with a dispatcher, two field crews, stocked service vehicles, common repair materials, estimate visits, and capacity-aware scheduling.', {
        capacityLabel: 'Crew A', assignedTo: 'Alex Johnson', capacityRisk: 'Estimate and crew handoff need coordination.',
        serviceRadiusMiles: 35, crewCount: 2, pricingModel: 'Recorded labor, material, travel, and margin inputs'
      }),
      option('mixed_service', 'Harborlight Mechanical', 'Mixed residential and light-commercial operator within a 42-mile radius, with licensed technicians, diagnostic equipment, replacement inventory, access constraints, permit review, and separate repair and replacement pricing.', {
        capacityLabel: 'Dispatch review', assignedTo: 'Sam Lee', capacityRisk: 'Property type and site access affect assignment.',
        serviceRadiusMiles: 42, crewCount: 3, pricingModel: 'Diagnostic, equipment, permit, labor, and replacement pricing'
      }),
      option('multi_crew', 'Summit Multi-Trade Services', 'Multi-crew regional contractor operating inside a 55-mile radius with skill-matched crews, fleet and equipment constraints, zone-based travel, material staging, emergency capacity, and dispatcher-controlled schedules.', {
        capacityLabel: 'Next qualified crew', assignedTo: null, capacityRisk: 'Skill and territory matching remain required.',
        serviceRadiusMiles: 55, crewCount: 6, pricingModel: 'Trade, crew, equipment, material, travel-zone, and urgency inputs'
      }),
      option('urban_exteriors', 'Copperline Exteriors', 'Urban roofing and exterior specialist serving a dense 18-mile radius with two compact crews, restricted-access equipment, municipal permit planning, parking constraints, supplier delivery windows, and documented change-order pricing.', {
        capacityLabel: 'Urban Crew 2', assignedTo: 'Jordan Bell', capacityRisk: 'Access, parking, and permit windows affect the visit.',
        serviceRadiusMiles: 18, crewCount: 2, pricingModel: 'Scope, access, permit, delivery, labor, and change-order inputs'
      }),
      option('rural_service', 'Red Oak Rural Services', 'Rural home-service company covering a practical 72-mile territory with one lead technician, two service vehicles, longer travel allowances, stocked repair parts, weather-dependent routes, and mileage-aware scheduling.', {
        capacityLabel: 'Rural route', assignedTo: 'Taylor Brooks', capacityRisk: 'Travel time and weather reduce same-day capacity.',
        serviceRadiusMiles: 72, crewCount: 2, pricingModel: 'Labor, material, mileage, equipment, and weather-window inputs'
      }),
      option('premium_remodel', 'Stonegate Home Projects', 'Premium residential project company within a 30-mile radius with an estimator, project manager, specialty subcontractors, finish-material allowances, homeowner approval gates, and milestone-based pricing.', {
        capacityLabel: 'Project intake', assignedTo: 'Morgan Chen', capacityRisk: 'Selections and subcontractor availability must be confirmed.',
        serviceRadiusMiles: 30, crewCount: 4, pricingModel: 'Design, allowance, labor, subcontractor, permit, and milestone inputs'
      }),
      option('commercial_facilities', 'Keystone Facility Response', 'Light-commercial maintenance operator serving a 48-mile radius with dispatch coverage, licensed trades, lift and diagnostic equipment, site-access requirements, purchase-order controls, and after-hours service rates.', {
        capacityLabel: 'Commercial dispatch', assignedTo: null, capacityRisk: 'Site authority and equipment access determine assignment.',
        serviceRadiusMiles: 48, crewCount: 5, pricingModel: 'Trade, equipment, access, purchase-order, labor, and after-hours inputs'
      }),
      option('coastal_service', 'Seabrook Property Care', 'Coastal property-service business covering a 33-mile radius with salt-weather material considerations, storm-response capacity, elevated-access equipment, seasonal demand, and inspection-first estimating.', {
        capacityLabel: 'Coastal Crew', assignedTo: 'Avery James', capacityRisk: 'Weather and storm-response demand can change capacity.',
        serviceRadiusMiles: 33, crewCount: 3, pricingModel: 'Inspection, coastal material, access, labor, travel, and urgency inputs'
      }),
      option('suburban_growth', 'Maple Ridge Service Group', 'Fast-growing suburban contractor within a 40-mile radius with three field crews, a call coordinator, warehouse stock, financing conversations, permit tracking, and territory-balanced scheduling.', {
        capacityLabel: 'Territory queue', assignedTo: null, capacityRisk: 'Crew territory and financing follow-up require coordination.',
        serviceRadiusMiles: 40, crewCount: 3, pricingModel: 'Labor, warehouse material, permit, travel, financing, and margin inputs'
      }),
      option('specialty_electrical', 'Bright Harbor Electric', 'Licensed electrical specialist serving a 26-mile radius with two electricians, testing equipment, panel and fixture inventory, utility coordination, permit inspections, and safety-priority dispatch.', {
        capacityLabel: 'Licensed electrician', assignedTo: 'Cameron Price', capacityRisk: 'Licensing, utility coordination, and inspection timing affect assignment.',
        serviceRadiusMiles: 26, crewCount: 2, pricingModel: 'Diagnostic, equipment, material, permit, utility, and labor inputs'
      }),
      option('seasonal_hvac', 'Four Seasons Comfort', 'Residential HVAC operator covering a 38-mile radius with four technicians, diagnostic tools, replacement equipment access, maintenance-plan customers, seasonal surge capacity, and comfort-priority scheduling.', {
        capacityLabel: 'HVAC dispatch', assignedTo: null, capacityRisk: 'Seasonal demand and equipment availability affect response time.',
        serviceRadiusMiles: 38, crewCount: 4, pricingModel: 'Diagnostic, equipment, warranty, labor, maintenance-plan, and urgency inputs'
      }),
    ]),
  }),
  service: Object.freeze({
    label: 'Service request',
    options: Object.freeze([
      option('fence', 'Fence installation', 'Installation, replacement, or repair scope.', { estimate: 6800 }),
      option('roofing', 'Roof replacement', 'Replacement, repair, inspection, and storm-damage scope.', { estimate: 14800 }),
      option('hvac', 'HVAC service', 'Repair, replacement, or maintenance scope.', { estimate: 9600 }),
      option('plumbing', 'Plumbing service', 'Fixture, leak, water-heater, or drain scope.', { estimate: 2850 }),
      option('electrical', 'Electrical service', 'Repair, upgrade, inspection, or safety scope.', { estimate: 4250 }),
      option('concrete', 'Concrete installation', 'Driveway, patio, slab, replacement, or repair scope.', { estimate: 11200 }),
    ]),
  }),
  intent: Object.freeze({
    label: 'Caller intent',
    options: Object.freeze([
      option('new_estimate', 'Request a new estimate', 'The caller wants a written estimate for new work.', {
        customerLine: 'I would like a written estimate for this project.', action: 'Confirm the complete estimating scope.'
      }),
      option('repair_request', 'Request a repair', 'The caller needs an existing issue diagnosed and repaired.', {
        customerLine: 'I need someone to diagnose the problem and explain the repair options.', action: 'Confirm symptoms and diagnostic access.'
      }),
      option('inspection', 'Schedule an inspection', 'The caller wants a professional inspection before deciding.', {
        customerLine: 'I want an inspection before I decide what work to authorize.', action: 'Schedule the inspection and document findings.'
      }),
      option('replacement_planning', 'Plan a replacement', 'The caller is comparing timing and replacement scope.', {
        customerLine: 'I am planning a replacement and need help understanding the right scope.', action: 'Clarify replacement goals and timing.'
      }),
      option('second_opinion', 'Get a second opinion', 'The caller has prior information and wants an independent review.', {
        customerLine: 'I already received one recommendation and would like a second opinion.', action: 'Capture the prior recommendation and verify it independently.'
      }),
    ]),
  }),
  urgency: Object.freeze({
    label: 'Urgency',
    options: Object.freeze([
      option('planning', 'Planning ahead', 'The caller is planning without an immediate service deadline.', {
        customerLine: 'There is no emergency; I am planning ahead.', priority: 'low', hoursUntilVisit: 120, emergency: false
      }),
      option('this_week', 'Needed this week', 'The caller wants action during the next several days.', {
        customerLine: 'I would like to handle this during the coming week.', priority: 'medium', hoursUntilVisit: 72, emergency: false
      }),
      option('within_24_hours', 'Within 24 hours', 'Active conditions make a prompt response important.', {
        customerLine: 'The condition is active, so I need help within 24 hours.', priority: 'high', hoursUntilVisit: 20, emergency: false
      }),
      option('safety_emergency', 'Safety or active-damage emergency', 'The caller reports a present safety or property-damage concern.', {
        customerLine: 'There is an active safety or property-damage concern right now.', priority: 'critical', hoursUntilVisit: 2, emergency: true
      }),
    ]),
  }),
  context: Object.freeze({
    label: 'Customer and work context',
    options: Object.freeze([
      option('new_customer', 'New customer', 'This is the customer’s first recorded interaction.', {
        customerLabel: 'New customer', missing: 'Prior service history is not available.'
      }),
      option('returning_customer', 'Returning customer', 'The caller references prior work with the company.', {
        customerLabel: 'Returning customer', missing: 'The prior-work record must be confirmed before dispatch.'
      }),
      option('property_manager', 'Property manager', 'The caller coordinates access and approval for another party.', {
        customerLabel: 'Property manager', missing: 'On-site access and approval authority need confirmation.'
      }),
      option('insurance_claim', 'Insurance-related work', 'The request may depend on claim documentation or adjuster timing.', {
        customerLabel: 'Insurance-related', missing: 'Claim status and documentation authority need confirmation.'
      }),
    ]),
  }),
  scheduling: Object.freeze({
    label: 'Scheduling constraint',
    options: Object.freeze([
      option('weekday_morning', 'Weekday morning', 'The customer is available before noon on a weekday.', {
        customerLine: 'A weekday morning is the best time for access.', hour: 9, dayOffset: 1
      }),
      option('weekday_afternoon', 'Weekday afternoon', 'The customer is available after noon on a weekday.', {
        customerLine: 'A weekday afternoon works best for me.', hour: 14, dayOffset: 1
      }),
      option('after_hours', 'After-hours coordination', 'Access requires an evening handoff or an on-call decision.', {
        customerLine: 'Access has to be coordinated after normal business hours.', hour: 18, dayOffset: 1
      }),
      option('flexible', 'Flexible timing', 'The customer can accept the next qualified opening.', {
        customerLine: 'I can take the next qualified opening.', hour: 11, dayOffset: 2
      }),
      option('weather_window', 'Weather-dependent window', 'Outdoor conditions determine the workable appointment window.', {
        customerLine: 'The visit needs a workable weather window.', hour: 10, dayOffset: 3
      }),
    ]),
  }),
  outcome: Object.freeze({
    label: 'Conversation outcome',
    options: Object.freeze([
      option('booked', 'Appointment booked', 'The caller accepts a provisional estimate or inspection visit.', {
        leadStatus: 'booked', workStatus: 'scheduled', confidence: 91,
        customerLine: 'That time works; please book the visit.', action: 'Prepare the assigned visit and confirm access.'
      }),
      option('follow_up', 'Follow-up requested', 'The caller wants a follow-up before choosing a visit.', {
        leadStatus: 'follow_up', workStatus: 'follow_up_due', confidence: 82,
        customerLine: 'Please follow up after I review the information.', action: 'Follow up with the requested information.'
      }),
      option('estimate_ready', 'Estimate preparation ready', 'Enough scope is present to prepare a written estimate.', {
        leadStatus: 'qualified', workStatus: 'estimate_ready', confidence: 88,
        customerLine: 'Please prepare the written estimate from what we covered.', action: 'Prepare the written estimate for review.'
      }),
      option('needs_information', 'More information needed', 'A material input remains missing before work can advance.', {
        leadStatus: 'needs_information', workStatus: 'triage', confidence: 68,
        customerLine: 'I need to confirm one detail before we schedule anything.', action: 'Collect the missing input before scheduling.'
      }),
    ]),
  }),
});

const DEFAULT_SELECTION = Object.freeze({
  business: 'growing_residential',
  service: 'fence',
  intent: 'new_estimate',
  urgency: 'this_week',
  context: 'new_customer',
  scheduling: 'weekday_morning',
  outcome: 'booked',
});

function findOption(dimension, id) {
  const definition = DIMENSIONS[dimension];
  if (!definition || typeof id !== 'string') return null;
  return definition.options.find(candidate => candidate.id === id) || null;
}

function normalizeSelection(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(value).sort();
  const expected = DIMENSION_ORDER.slice().sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) return null;
  const normalized = {};
  for (const dimension of DIMENSION_ORDER) {
    const selected = findOption(dimension, value[dimension]);
    if (!selected) return null;
    normalized[dimension] = selected.id;
  }
  return Object.freeze(normalized);
}

function selectionProfile(value) {
  const selection = normalizeSelection(value);
  if (!selection) return null;
  const profile = { selection };
  for (const dimension of DIMENSION_ORDER) profile[dimension] = findOption(dimension, selection[dimension]);
  profile.signature = DIMENSION_ORDER.map(dimension => selection[dimension]).join(':');
  return Object.freeze(profile);
}

const COMBINATION_COUNT = DIMENSION_ORDER.reduce(
  (count, dimension) => count * DIMENSIONS[dimension].options.length,
  1
);

function publicScenarioSpace() {
  return Object.freeze({
    contract: 'northstar_demo_scenario_space_v1',
    combinationCount: COMBINATION_COUNT,
    defaultSelection: { ...DEFAULT_SELECTION },
    dimensions: DIMENSION_ORDER.map(id => ({
      id,
      label: DIMENSIONS[id].label,
      options: DIMENSIONS[id].options.map(candidate => ({
        id: candidate.id,
        label: candidate.label,
        description: candidate.description,
      })),
    })),
  });
}

module.exports = {
  COMBINATION_COUNT,
  DEFAULT_SELECTION,
  DIMENSIONS,
  DIMENSION_ORDER,
  findOption,
  normalizeSelection,
  publicScenarioSpace,
  selectionProfile,
};
