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
    label: 'Business operating context',
    options: Object.freeze([
      option('owner_operator', 'Owner-operator', 'One owner is balancing calls, estimates, and field work.', {
        capacityLabel: 'Owner schedule', assignedTo: 'Maria Rivera', capacityRisk: 'The owner is the only estimator.'
      }),
      option('growing_residential', 'Growing residential team', 'A dispatcher and one crew are coordinating residential work.', {
        capacityLabel: 'Crew A', assignedTo: 'Alex Johnson', capacityRisk: 'Estimate and crew handoff need coordination.'
      }),
      option('mixed_service', 'Mixed residential and light commercial', 'The team is balancing different property and access requirements.', {
        capacityLabel: 'Dispatch review', assignedTo: 'Sam Lee', capacityRisk: 'Property type and site access affect assignment.'
      }),
      option('multi_crew', 'Multi-crew service company', 'Several crews are available, but dispatch ownership must be explicit.', {
        capacityLabel: 'Next qualified crew', assignedTo: null, capacityRisk: 'Skill and territory matching remain required.'
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
