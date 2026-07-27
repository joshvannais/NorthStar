'use strict';

/**
 * Nonfinancial simulation metadata only.
 *
 * These definitions generate structured customer facts and conversation
 * prompts. They intentionally contain no rates, charges, markup, overhead,
 * margins, tax, estimate ranges, or calculation functions. Financial authority
 * belongs exclusively to the pinned persisted Business Profile.
 */

function question(id, ask) {
  return Object.freeze({ id, ask });
}

module.exports = Object.freeze({
  fence: Object.freeze({
    id: 'fence',
    displayName: 'Fence installation',
    jobTypes: ['install', 'replace', 'repair'],
    materials: ['cedar', 'pine', 'vinyl', 'chain-link'],
    classificationKeywords: ['fence', 'gate', 'cedar', 'vinyl', 'linear feet'],
    scopeSchema: {
      required: ['jobType', 'linearFeet', 'material'],
      recommended: ['height', 'gates', 'removalRequired', 'permitsRequired'],
      optional: ['terrain', 'hoa', 'timeline', 'urgency', 'access'],
    },
    questions: {
      discovery: [question('jobType', 'Is this a new installation, replacement, or repair?'), question('linearFeet', 'About how many linear feet are involved?'), question('material', 'Which material are you requesting?')],
      scope: [question('height', 'What fence height do you need?'), question('gates', 'How many gates and what types?'), question('removalRequired', 'Does an existing fence need removal?'), question('permitsRequired', 'Are permits required?'), question('terrain', 'How would you describe the terrain and access?')],
      scheduling: [question('timeline', 'What timeline works for you?')],
    },
  }),
  roofing: Object.freeze({
    id: 'roofing',
    displayName: 'Roof replacement',
    jobTypes: ['replace', 'repair', 'inspect'],
    materials: ['architectural', 'metal', 'tile'],
    classificationKeywords: ['roof', 'shingle', 'hail', 'leak', 'flashing'],
    scopeSchema: {
      required: ['jobType', 'squares', 'material'],
      recommended: ['pitch', 'stories', 'existingLayers', 'flashingReplace'],
      optional: ['deckCondition', 'gutters', 'access', 'timeline', 'urgency'],
    },
    questions: {
      discovery: [question('jobType', 'Is this a replacement, repair, or inspection?'), question('squares', 'About how many roofing squares are involved?'), question('material', 'Which roofing material are you considering?')],
      scope: [question('pitch', 'What is the roof pitch?'), question('stories', 'How many stories is the property?'), question('existingLayers', 'How many existing layers are present?'), question('flashingReplace', 'Does the flashing need replacement?')],
      scheduling: [question('timeline', 'What timeline works for you?')],
    },
  }),
  hvac: Object.freeze({
    id: 'hvac',
    displayName: 'HVAC service',
    jobTypes: ['replace', 'repair', 'maintain'],
    materials: [],
    classificationKeywords: ['hvac', 'air conditioner', 'furnace', 'thermostat', 'ductwork'],
    scopeSchema: {
      required: ['jobType', 'systemType', 'tonnage'],
      recommended: ['seer', 'sqft', 'existingAge', 'ductworkReplace'],
      optional: ['thermostat', 'fuelType', 'access', 'timeline', 'urgency'],
    },
    questions: {
      discovery: [question('jobType', 'Is this a replacement, repair, or maintenance request?'), question('systemType', 'What type of HVAC system is involved?'), question('tonnage', 'What is the system tonnage?')],
      scope: [question('seer', 'What efficiency level are you considering?'), question('sqft', 'What is the approximate property square footage?'), question('existingAge', 'How old is the existing system?'), question('ductworkReplace', 'Does the ductwork need replacement?')],
      scheduling: [question('timeline', 'How urgent is the service?')],
    },
  }),
  plumbing: Object.freeze({
    id: 'plumbing',
    displayName: 'Plumbing service',
    jobTypes: ['repair', 'replace', 'inspect'],
    materials: [],
    classificationKeywords: ['plumbing', 'pipe', 'leak', 'drain', 'water heater'],
    scopeSchema: {
      required: ['jobType', 'fixture'],
      recommended: ['leakSeverity', 'waterShutoff'],
      optional: ['timeline', 'urgency'],
    },
    questions: {
      discovery: [question('jobType', 'Is this a repair, replacement, or inspection?'), question('fixture', 'Which fixture or plumbing system is involved?')],
      scope: [question('leakSeverity', 'What is the current leak condition?'), question('waterShutoff', 'Can the water be shut off safely?')],
      scheduling: [question('timeline', 'How soon is service needed?')],
    },
  }),
  electrical: Object.freeze({
    id: 'electrical',
    displayName: 'Electrical service',
    jobTypes: ['repair', 'upgrade', 'inspect'],
    materials: [],
    classificationKeywords: ['electrical', 'breaker', 'panel', 'outlet', 'power'],
    scopeSchema: {
      required: ['jobType', 'symptoms'],
      recommended: ['breakerBehavior', 'safetyConcern'],
      optional: ['urgency'],
    },
    questions: {
      discovery: [question('jobType', 'Is this a repair, upgrade, or inspection?'), question('symptoms', 'What electrical symptoms are you seeing?')],
      scope: [question('breakerBehavior', 'How is the breaker behaving?'), question('safetyConcern', 'Is there a current safety concern?')],
      scheduling: [question('urgency', 'How urgent is the issue?')],
    },
  }),
  concrete: Object.freeze({
    id: 'concrete',
    displayName: 'Concrete installation',
    jobTypes: ['install', 'replace', 'repair'],
    materials: [],
    classificationKeywords: ['concrete', 'driveway', 'patio', 'slab', 'finish'],
    scopeSchema: {
      required: ['jobType', 'squareFeet'],
      recommended: ['finish', 'existingRemoval', 'access'],
      optional: ['timeline'],
    },
    questions: {
      discovery: [question('jobType', 'Is this a new installation, replacement, or repair?'), question('squareFeet', 'What is the approximate square footage?')],
      scope: [question('finish', 'Which finish are you considering?'), question('existingRemoval', 'Does existing concrete need removal?'), question('access', 'How is site access?')],
      scheduling: [question('timeline', 'What timeline works for you?')],
    },
  }),
});
