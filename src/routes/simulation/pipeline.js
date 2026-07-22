/**
 * Polaris Intelligence Pipeline — Universal simulation engine
 *
 * Service-agnostic architecture. New services are added to the
 * service catalog (service-catalog.js) without modifying this file.
 *
 * Pipeline:
 *   scenario → transcript → scope → classification → pricing → confidence → action
 */

const CATALOG = require('./service-catalog');

// ═══════════════════════════════════════════════════════
// UNIVERSAL PRIMITIVES
// ═══════════════════════════════════════════════════════

// 50-state location generator — each entry: [stateAbbr, stateName, city, zipLow, zipHigh, areaCode]
const STATES = [
  ['AL','Alabama','Birmingham',35000,36999,205],['AK','Alaska','Anchorage',99500,99999,907],
  ['AZ','Arizona','Phoenix',85000,86999,602],['AR','Arkansas','Little Rock',72000,72999,501],
  ['CA','California','Los Angeles',90000,96999,310],['CO','Colorado','Denver',80000,81999,303],
  ['CT','Connecticut','Hartford',6000,6999,860],['DE','Delaware','Wilmington',19800,19999,302],
  ['FL','Florida','Miami',33000,34999,305],['GA','Georgia','Atlanta',30000,31999,404],
  ['HI','Hawaii','Honolulu',96700,96899,808],['ID','Idaho','Boise',83700,83999,208],
  ['IL','Illinois','Chicago',60600,60999,312],['IN','Indiana','Indianapolis',46200,46999,317],
  ['IA','Iowa','Des Moines',50000,52999,515],['KS','Kansas','Wichita',67200,67999,316],
  ['KY','Kentucky','Louisville',40200,42999,502],['LA','Louisiana','New Orleans',70100,71499,504],
  ['ME','Maine','Portland',4000,4999,207],['MD','Maryland','Baltimore',21200,21999,410],
  ['MA','Massachusetts','Boston',2100,2799,617],['MI','Michigan','Detroit',48200,49999,313],
  ['MN','Minnesota','Minneapolis',55400,55999,612],['MS','Mississippi','Jackson',39200,39999,601],
  ['MO','Missouri','Kansas City',64100,64999,816],['MT','Montana','Billings',59100,59999,406],
  ['NE','Nebraska','Omaha',68100,68999,402],['NV','Nevada','Las Vegas',89100,89999,702],
  ['NH','New Hampshire','Manchester',3100,3899,603],['NJ','New Jersey','Newark',7000,8999,973],
  ['NM','New Mexico','Albuquerque',87100,87999,505],['NY','New York','New York City',10000,14999,212],
  ['NC','North Carolina','Charlotte',28200,28999,704],['ND','North Dakota','Fargo',58100,58999,701],
  ['OH','Ohio','Columbus',43200,43999,614],['OK','Oklahoma','Oklahoma City',73100,74999,405],
  ['OR','Oregon','Portland',97200,97999,503],['PA','Pennsylvania','Philadelphia',19100,19999,215],
  ['RI','Rhode Island','Providence',2900,2999,401],['SC','South Carolina','Columbia',29200,29999,803],
  ['SD','South Dakota','Sioux Falls',57100,57999,605],['TN','Tennessee','Nashville',37200,37999,615],
  ['TX','Texas','Houston',77000,77999,713],['UT','Utah','Salt Lake City',84100,84999,801],
  ['VT','Vermont','Burlington',5400,5999,802],['VA','Virginia','Richmond',23200,23999,804],
  ['WA','Washington','Seattle',98100,98999,206],['WV','West Virginia','Charleston',25300,25999,304],
  ['WI','Wisconsin','Milwaukee',53200,53999,414],['WY','Wyoming','Cheyenne',82000,82999,307],
];

function _randomLocation() {
  var s = STATES[Math.floor(Math.random() * STATES.length)];
  var zip = s[3] + Math.floor(Math.random() * (s[4] - s[3]));
  return { abbr: s[0], state: s[1], city: s[2], zip: zip, areaCode: s[5] };
}

const CONTACT_TEMPLATES = {
  askPhone: 'What\'s the best phone number to reach you?',
  askEmail: 'And an email address for the estimate?',
  askAddress: 'And the property address where the work would be done?',
  askSchedule: 'What days and times work best for an on-site visit?',
  confirmDetails: 'Let me confirm what I have so far.',
};

// ═══════════════════════════════════════════════════════
// SCENARIO GENERATOR
// ═══════════════════════════════════════════════════════

function generateScenario(requestedService, customerName) {
  const catalogServices = Object.keys(CATALOG).filter(k => requestedService.includes(k));
  const svcKey = catalogServices.length > 0 ? catalogServices[0] : _pickRandom(Object.keys(CATALOG));
  const svc = CATALOG[svcKey];
  if (!svc) return null;

  const firstName = customerName.split(' ')[0];

  // Build plausible customer contact with nationwide diversity
  const loc = _randomLocation();
  const phone = `(${loc.areaCode}) ${_rand(200,900)}-${_rand(1000,9999)}`;
  const streets = ['Oak Creek', 'Maple', 'Hilltop', 'Breeze', 'Elm', 'Cedar', 'Pine', 'Willow'];
  const suffix = ['Drive', 'Lane', 'Way', 'Court', 'Circle', 'Avenue'];
  const address = `${_rand(100,9999)} ${_pickRandom(streets)} ${_pickRandom(suffix)}, ${loc.city}, ${loc.abbr} ${loc.zip}`;

  const scenario = {
    serviceKey: svcKey,
    customer: {
      name: customerName,
      firstName,
      phone,
      email: firstName.toLowerCase().replace(/[^a-z]/g, '') + '@email.com',
      address,
    },
    job: {
      type: _pickRandom(svc.jobTypes || ['install']),
      scope: {},
    },
  };

  // Populate scope with plausible values
  _populateScope(scenario, svc);

  return scenario;
}

function _populateScope(scenario, svc) {
  const scope = scenario.job.scope;

  if (svc.id === 'fence') {
    scope.linearFeet = _pickRandom([60, 100, 150, 175, 200, 250, 300]);
    scope.material = _pickRandom(Object.keys(svc.pricing.materials));
    scope.height = _pickRandom([4, 6, 8]);
    scope.gates = [{ type: 'walk', width: 4 }, { type: _pickRandom(['walk', 'drive']), width: _pickRandom([8, 10, 12]) }];
    scope.removalRequired = Math.random() > 0.3;
    scope.terrain = _pickRandom(['mostly flat', 'slight grade', 'hilly in back corner', 'flat with one tree line']);
    const matInfo = (svc.pricing && svc.pricing.materials && svc.pricing.materials[scope.material]) ? svc.pricing.materials[scope.material].label : scope.material;
    scope.hoa = Math.random() > 0.5 ? 'yes — ' + matInfo + ' required' : 'no';
    scope.permitsRequired = 'required, ~2 week processing';
    scope.timeline = _pickRandom(['within 3-4 weeks', 'within 6-8 weeks', 'before summer', 'next month', 'whenever works']);
    scope.urgency = 'moderate';
    scope.access = 'good — side gate access';
  } else if (svc.id === 'roofing') {
    scope.squares = _pickRandom([18, 22, 28, 32, 38, 45]);
    scope.material = _pickRandom(Object.keys(svc.pricing.materials));
    scope.pitch = _pickRandom(['4/12 walkable', '6/12 moderate', '8/12 steep']);
    scope.stories = _pickRandom([1, 2]);
    scope.existingLayers = _pickRandom([1, 2]);
    scope.deckCondition = 'minor soft spots near chimney';
    scope.flashingReplace = true;
    scope.gutters = 'existing in good condition';
    scope.access = 'good — driveway access';
    scope.timeline = _pickRandom(['within 2-3 weeks', 'within a month', 'before rainy season', 'as soon as possible']);
    scope.urgency = _pickRandom(['moderate', 'moderate — minor leak', 'high — active leak']);
  } else if (svc.id === 'hvac') {
    scope.systemType = 'central AC + gas furnace';
    scope.tonnage = _pickRandom([2, 2.5, 3, 3.5, 4, 5]);
    scope.seer = _pickRandom([14, 16, 18, 20]);
    scope.sqft = _pickRandom([1200, 1600, 2000, 2400, 2800, 3200]);
    scope.existingAge = _pickRandom([10, 15, 18, 22, 25]);
    scope.ductworkReplace = Math.random() > 0.4;
    scope.thermostat = Math.random() > 0.5 ? 'smart' : 'standard';
    scope.fuelType = 'gas';
    scope.access = _pickRandom(['attic access through hallway', 'basement utility closet', 'garage-mounted']);
    scope.timeline = 'as soon as possible — system failed';
    scope.urgency = 'high';
  } else if (svc.id === 'plumbing') {
    scope.fixture = _pickRandom(['kitchen sink', 'bathroom sink', 'toilet', 'water heater', 'main drain']);
    scope.leakSeverity = _pickRandom(['active drip', 'slow leak', 'not leaking now']);
    scope.waterShutoff = Math.random() > 0.5;
    scope.timeline = _pickRandom(['today', 'tomorrow', 'this week']);
    scope.urgency = _pickRandom(['high', 'moderate', 'emergency']);
  } else if (svc.id === 'electrical') {
    scope.symptoms = _pickRandom(['breaker keeps tripping', 'lights flickering', 'no power to bedroom', 'outlet sparking']);
    scope.breakerBehavior = _pickRandom(['trips immediately', 'trips after a few minutes', 'trips randomly']);
    scope.safetyConcern = Math.random() > 0.5;
    scope.urgency = scope.safetyConcern ? 'emergency' : 'high';
  } else if (svc.id === 'concrete') {
    scope.squareFeet = _pickRandom([200, 400, 600, 800, 1200]);
    scope.finish = _pickRandom(['smooth', 'broom finish', 'stamped']);
    scope.existingRemoval = Math.random() > 0.4;
    scope.access = Math.random() > 0.3 ? 'good — truck access' : 'limited — pump needed';
    scope.timeline = _pickRandom(['within 2 weeks', 'within a month', 'next month']);
  }
}

// ═══════════════════════════════════════════════════════
// TRANSCRIPT ENGINE — Adaptive conversation
// ═══════════════════════════════════════════════════════

function generateTranscript(scenario, svc) {
  const firstName = scenario.customer.firstName;
  const turns = [];

  // Opening
  turns.push({ speaker: 'ai', text: 'Thank you for calling NorthStar Solutions. This is the AI office manager — how can I help you today?' });

  // Discovery — customer describes the problem
  const opening = _buildOpening(scenario, svc);
  turns.push({ speaker: 'customer', text: opening });
  turns.push({ speaker: 'ai', text: _buildFollowUp(scenario, svc) });

  // Ask discovery questions (the required scope dimensions)
  const discoveryQs = (svc.questions.discovery || []).slice(0, 3);
  for (const q of discoveryQs) {
    const answer = _buildAnswer(scenario, q);
    if (!answer || answer === 'skip') continue;
    turns.push({ speaker: 'ai', text: q.ask });
    turns.push({ speaker: 'customer', text: answer });
  }

  // Ask scope questions (recommended dimensions)
  const scopeQs = (svc.questions.scope || []).slice(0, 5);
  for (const q of scopeQs) {
    const answer = _buildAnswer(scenario, q);
    if (!answer || answer === 'skip') continue;
    turns.push({ speaker: 'ai', text: q.ask });
    turns.push({ speaker: 'customer', text: answer });
  }

  // Contact collection
  const cust = scenario.customer;
  turns.push({ speaker: 'ai', text: 'Let me capture your contact information. ' + CONTACT_TEMPLATES.askPhone });
  turns.push({ speaker: 'customer', text: cust.phone + '.' });
  turns.push({ speaker: 'ai', text: CONTACT_TEMPLATES.askEmail });
  turns.push({ speaker: 'customer', text: cust.email + '.' });
  turns.push({ speaker: 'ai', text: CONTACT_TEMPLATES.askAddress });
  turns.push({ speaker: 'customer', text: cust.address + '.' });

  // Scheduling
  const schedQs = (svc.questions.scheduling || []).slice(0, 2);
  for (const q of schedQs) {
    const answer = _buildAnswer(scenario, q);
    if (!answer) continue;
    turns.push({ speaker: 'ai', text: q.ask });
    turns.push({ speaker: 'customer', text: answer });
  }

  if (!schedQs.length) {
    turns.push({ speaker: 'ai', text: CONTACT_TEMPLATES.askSchedule });
    turns.push({ speaker: 'customer', text: _pickRandom(['Weekday mornings work best.', 'Afternoons are better for me.', 'Any weekday is fine.', 'I\'m flexible — whatever works for your team.']) });
  }

  // Pricing discussion
  const pricing = _estimatePrice(scenario, svc);
  if (pricing && pricing.strategy !== 'insufficient') {
    turns.push({ speaker: 'customer', text: 'Can you give me a rough idea of what something like this might cost?' });
    turns.push({ speaker: 'ai', text: pricing.responseText });
    turns.push({ speaker: 'customer', text: 'Okay, that gives me a good starting point. Can we schedule someone to come out and take a look?' });
  } else {
    turns.push({ speaker: 'customer', text: 'Can you give me a ballpark price?' });
    turns.push({ speaker: 'ai', text: 'I\'d need a few more details to give you even a rough range. Let me have one of our estimators do an on-site assessment — they\'ll be able to give you an accurate quote.' });
    turns.push({ speaker: 'customer', text: 'That makes sense. Let\'s set that up.' });
  }

  // Confirmation
  turns.push({ speaker: 'ai', text: 'Perfect. Let me summarize: ' + _buildSummary(scenario, svc) + ' Our estimator will reach out to confirm the appointment. Does that all sound right?' });
  turns.push({ speaker: 'customer', text: _pickRandom(['That sounds great, thank you!', 'Yes, that\'s exactly right. Thanks!', 'Perfect, looking forward to it.', 'Sounds good — I\'ll watch for the confirmation.']) });
  turns.push({ speaker: 'ai', text: 'You\'re welcome, ' + firstName + '. We\'ll be in touch soon. Have a great day!' });

  return turns;
}

function _buildOpening(scenario, svc) {
  const firstName = scenario.customer.firstName;
  const job = scenario.job;
  const scope = job.scope;

  if (svc.id === 'fence') {
    const variants = [
      `Hi, my name is ${firstName}. I'm looking to get a fence replaced at my property.`,
      `Hello, this is ${firstName}. I need a new fence installed — the old one is falling apart.`,
      `Hi there, ${firstName} here. I want to get an estimate for a fence around my backyard.`,
    ];
    return _pickRandom(variants);
  }
  if (svc.id === 'roofing') {
    const variants = [
      `Hi, my name is ${firstName}. I've got some water coming through my ceiling after that storm last week. I think I need a new roof.`,
      `Hello, this is ${firstName}. My roof is about ${scope.existingLayers === 2 ? '25' : '15'} years old and I'm seeing signs it needs replacement.`,
      `Hi, ${firstName} here. I had a roofer look at my roof and they said I've got hail damage. I'd like to get a second opinion and an estimate.`,
    ];
    return _pickRandom(variants);
  }
  if (svc.id === 'hvac') {
    const variants = [
      `Hi, this is ${firstName}. My AC stopped working completely yesterday and it's already 85 in the house. I need someone out here.`,
      `Hello, ${firstName} here. My system is about ${scope.existingAge} years old and it's been struggling. I think I need a replacement.`,
      `Hi, my name is ${firstName}. My furnace has been making a rattling noise and I'm worried it won't make it through the winter.`,
    ];
    return _pickRandom(variants);
  }
  if (svc.id === 'plumbing') {
    return `Hi, this is ${firstName}. My ${scope.fixture} is ${scope.leakSeverity.includes('active') ? 'leaking and I can\'t get it to stop' : 'having issues and I need someone to look at it'}.`;
  }
  if (svc.id === 'electrical') {
    return `Hello, my name is ${firstName}. ${scope.symptoms.charAt(0).toUpperCase() + scope.symptoms.slice(1)}${scope.safetyConcern ? ' and I\'m worried it could be dangerous' : ''}.`;
  }
  if (svc.id === 'concrete') {
    return `Hi, ${firstName} here. I need a ${scope.jobType === 'replace' ? 'new' : ''} ${_pickRandom(['driveway', 'patio', 'slab'])} poured — the old one is all cracked.`;
  }
  return `Hi, my name is ${firstName}. I need some work done and I'd like to get an estimate.`;
}

function _buildFollowUp(scenario, svc) {
  const firstName = scenario.customer.firstName;
  if (svc.id === 'fence') return `I'd be happy to help with that, ${firstName}. Let me ask a few questions to understand what you're looking for.`;
  if (svc.id === 'hvac') return `I understand the urgency, ${firstName}. Let me get the details quickly so we can get someone out to you.`;
  if (svc.id === 'electrical' && scenario.job.scope.safetyConcern) return `That does sound concerning, ${firstName}. Let me get some information and we'll prioritize this.`;
  return `I can help with that, ${firstName}. Let me ask a few questions to understand the scope.`;
}

function _buildAnswer(scenario, question) {
  const scope = scenario.job.scope;
  const id = question.id;

  const answers = {
    // Fence
    jobType: { install: 'New installation.', replace: 'Replacing an existing fence.', repair: 'Repairing some damaged sections.' }[scope.jobType],
    linearFeet: `About ${scope.linearFeet} feet.`,
    material: scope.material ? `${scope.material.charAt(0).toUpperCase() + scope.material.slice(1)}${scope.hoa && scope.hoa.includes('yes') ? ' — our HOA requires it' : ''}.` : 'Not sure yet.',
    height: scope.height ? `${scope.height} feet.` : '6 feet.',
    gates: `Yes — a walk gate on the side and a double drive gate in the back.`,
    removalRequired: scope.removalRequired ? 'Yes, there\'s an old fence that needs to come down first.' : 'No, it\'s bare ground right now.',
    terrain: scope.terrain ? scope.terrain + '. Nothing too difficult.' : 'Mostly flat.',
    hoa: scope.hoa,
    permitsRequired: scope.permitsRequired,

    // Roof
    squares: `I think it's about ${scope.squares} squares.`,
    pitch: scope.pitch + '.',
    stories: `${scope.stories}-story.`,
    existingLayers: scope.existingLayers === 1 ? 'Just one layer.' : 'Two layers — the second was put on about 10 years ago.',
    flashingReplace: 'They\'re showing rust so probably need replacement.',
    insurance: Math.random() > 0.5 ? 'Yes, I think my insurance will cover it.' : 'No, I\'ll be paying out of pocket.',
    deckCondition: scope.deckCondition,

    // HVAC
    systemType: 'Central AC with a gas furnace.',
    tonnage: `${scope.tonnage} tons, I believe.`,
    sqft: scope.sqft ? `About ${scope.sqft.toLocaleString()} square feet.` : 'About 2,000 square feet.',
    seer: `SEER ${scope.seer} or higher if possible.`,
    fuelType: 'Gas.',
    existingAge: `About ${scope.existingAge} years old.`,
    ductworkReplace: scope.ductworkReplace ? 'Yes, it probably needs to be replaced — it\'s original.' : 'I think the ductwork is okay.',
    thermostat: scope.thermostat === 'smart' ? 'Yes, a smart thermostat would be great.' : 'Just a standard one is fine.',

    // Plumbing
    fixture: scope.fixture + '.',
    leakSeverity: scope.leakSeverity + '.',
    waterShutoff: scope.waterShutoff ? 'Yes, I was able to shut off the valve.' : 'No, I don\'t know where the shutoff is.',
    activeDamage: 'Some water on the floor but nothing structural.',

    // Electrical
    symptoms: scope.symptoms + '.',
    breakerBehavior: scope.breakerBehavior + '.',
    safetyConcern: scope.safetyConcern ? 'Yes, I smell something burning when it happens.' : 'No burning smell or anything, just the tripping.',
    propertyType: 'Single-family home.',

    // Concrete
    squareFeet: `About ${scope.squareFeet} square feet.`,
    finish: scope.finish + '.',
    existingRemoval: scope.existingRemoval ? 'Yes, the old concrete needs to come out first.' : 'No, it\'s bare ground.',
    access: scope.access + '.',

    // Universal
    timeline: scope.timeline + '.',
    schedulingPreference: _pickRandom(['Weekday mornings work best.', 'Afternoons are better.', 'Any weekday is fine.', 'I\'m flexible.']),
    urgency: scope.urgency === 'high' || scope.urgency === 'emergency' ? 'As soon as possible — it\'s urgent.' : 'Not an emergency but I\'d like it done soon.',
    budget: scope.budget ? `Around $${scope.budget.min.toLocaleString()} to $${scope.budget.max.toLocaleString()}.` : 'I\'m flexible on budget.',
  };

  return answers[id] || null;
}

function _estimatePrice(scenario, svc) {
  const scope = scenario.job.scope;
  const pricing = svc.pricing;

  if (!pricing || !pricing.calculate) return { strategy: 'insufficient', responseText: 'I\'d need a few more details to give you even a rough range. Let me have one of our estimators come out for an on-site assessment.' };

  try {
    const result = pricing.calculate(scope);
    const low = result.range.low.toLocaleString();
    const high = result.range.high.toLocaleString();

    return {
      strategy: pricing.strategy,
      total: result.total,
      range: result.range,
      breakdown: result.breakdown,
      responseText: `Based on what you've described, you're typically looking in the range of $${low} to $${high}. That's a preliminary estimate — our team will do a full assessment on-site and give you a firm quote before any work begins. No obligation.`,
    };
  } catch (e) {
    return { strategy: 'insufficient', responseText: 'I\'d need a few more details to give you a meaningful range. Our estimator can provide an accurate quote during the on-site visit.' };
  }
}

function _buildSummary(scenario, svc) {
  const scope = scenario.job.scope;
  const name = svc.displayName;

  if (svc.id === 'fence') {
    return `${scope.linearFeet} linear feet of ${scope.height}-foot ${scope.material} fence, ${scope.gates ? scope.gates.length + ' gates' : 'no gates'}, ${scope.removalRequired ? 'with removal of existing fence' : 'new installation'}.`;
  }
  if (svc.id === 'roofing') {
    return `${scope.squares}-square roof replacement with ${scope.material}, tear-off of ${scope.existingLayers} layer(s), flashing replacement, for a ${scope.stories}-story home.`;
  }
  if (svc.id === 'hvac') {
    return `${scope.tonnage}-ton SEER-${scope.seer} ${scope.systemType} replacement${scope.ductworkReplace ? ' with new ductwork' : ''}${scope.thermostat === 'smart' ? ' and smart thermostat' : ''} for ${(scope.sqft || 2000).toLocaleString()}-sqft home.`;
  }
  return `${name} — ${scenario.job.type} at ${scenario.customer.address}.`;
}

// ═══════════════════════════════════════════════════════
// SCOPE EXTRACTION
// ═══════════════════════════════════════════════════════

function extractScope(transcript, scenario) {
  const fullText = transcript.map(t => (t && t.text ? t.text : '')).join(' ');
  const svc = CATALOG[scenario.serviceKey];
  if (!svc) return { extracted: {}, evidence: {}, missing: [] };

  const scope = scenario.job.scope;
  const extracted = {};
  const evidence = {};
  const missing = [];

  const has = (keyword) => fullText.toLowerCase().includes(keyword.toLowerCase());

  // Try to extract every dimension from the scope schema
  const allDims = [...(svc.scopeSchema.required || []), ...(svc.scopeSchema.recommended || []), ...(svc.scopeSchema.optional || [])];

  for (const dim of allDims) {
    if (scope[dim] !== undefined) {
      // Check if the value appears in the transcript or if related keywords appear
      const val = String(scope[dim]);
      const relatedKeywords = _getRelatedKeywords(dim, scope[dim]);
      const found = has(val) || relatedKeywords.some(k => has(k));

      if (found) {
        extracted[dim] = scope[dim];
        evidence[dim] = `Transcript mentions ${dim}: ${val.substring(0, 60)}`;
      } else if (svc.scopeSchema.required.includes(dim)) {
        missing.push(dim);
      }
    } else if (svc.scopeSchema.required.includes(dim)) {
      missing.push(dim);
    }
  }

  // Contact info
  if (scenario.customer.phone && has(scenario.customer.phone)) { extracted.phone = scenario.customer.phone; evidence.phone = 'Phone collected'; }
  if (scenario.customer.email && has(scenario.customer.email)) { extracted.email = scenario.customer.email; evidence.email = 'Email collected'; }
  if (scenario.customer.address && has(scenario.customer.address)) { extracted.address = scenario.customer.address; evidence.address = 'Address collected'; }

  return { extracted, evidence, missing };
}

function _getRelatedKeywords(dim, value) {
  const maps = {
    linearFeet: ['feet', 'ft', 'linear'],
    squares: ['squares', 'sq'],
    squareFeet: ['square feet', 'sq ft', 'sqft'],
    tonnage: ['ton', 'tons'],
    height: ['foot', 'ft', 'feet'],
    material: [String(value).toLowerCase()],
    jobType: [String(value).toLowerCase()],
  };
  return maps[dim] || [];
}

// ═══════════════════════════════════════════════════════
// CLASSIFICATION
// ═══════════════════════════════════════════════════════

function classifyService(transcript) {
  const text = transcript.map(t => (t && t.text ? t.text : '')).join(' ').toLowerCase();
  const scores = {};

  for (const [key, svc] of Object.entries(CATALOG)) {
    let score = 0;
    for (const kw of svc.classificationKeywords) {
      if (text.includes(kw.toLowerCase())) score += 1;
    }
    if (score > 0) scores[key] = { score, service: svc.displayName };
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1].score - a[1].score);

  if (ranked.length === 0) return { service: 'General Contracting', confidence: 'low', alternatives: [] };

  const top = ranked[0];
  const alternatives = ranked.slice(1, 3).map(([k, v]) => v.service);

  return {
    service: top[1].service,
    confidence: top[1].score >= 3 ? 'high' : top[1].score >= 1 ? 'medium' : 'low',
    alternatives,
    score: top[1].score,
  };
}

// ═══════════════════════════════════════════════════════
// PRICING
// ═══════════════════════════════════════════════════════

function calculatePricing(scope, classifiedService) {
  // Find matching service in catalog
  const svcKey = _findServiceKey(classifiedService);
  if (!svcKey || !CATALOG[svcKey].pricing) {
    return { strategy: 'insufficient', total: null, range: { low: 300, high: 800 }, breakdown: [] };
  }

  const svc = CATALOG[svcKey];
  try {
    const result = svc.pricing.calculate(scope);
    return { strategy: svc.pricing.strategy, ...result };
  } catch (e) {
    return { strategy: 'insufficient', total: null, range: null, breakdown: [], reason: e.message };
  }
}

function _findServiceKey(classifiedService) {
  const lower = classifiedService.toLowerCase();
  for (const [key, svc] of Object.entries(CATALOG)) {
    if (lower.includes(key) || svc.displayName.toLowerCase().includes(key)) return key;
    if (key.includes(lower)) return key;
  }
  return null;
}

// ═══════════════════════════════════════════════════════
// CONFIDENCE
// ═══════════════════════════════════════════════════════

function calculateConfidence(extractedScope, missingInfo, serviceKey) {
  const svc = CATALOG[serviceKey];
  if (!svc) return { score: 0, label: 'Insufficient', explanation: 'Unknown service type.' };

  const required = svc.scopeSchema.required || [];
  const recommended = svc.scopeSchema.recommended || [];
  const allRelevant = [...required, ...recommended].filter(d => extractedScope[d] !== undefined || missingInfo.includes(d));

  if (allRelevant.length === 0) return { score: 0, label: 'Insufficient', explanation: 'No scope dimensions collected.' };

  // Required dimensions weigh 3x
  let earned = 0;
  let possible = 0;
  for (const d of required) {
    possible += 3;
    if (extractedScope[d] !== undefined) earned += 3;
  }
  for (const d of recommended) {
    if (allRelevant.includes(d)) {
      possible += 1;
      if (extractedScope[d] !== undefined) earned += 1;
    }
  }

  const pct = possible > 0 ? Math.round((earned / possible) * 100) : 0;

  let label, explanation;
  if (pct >= 80) { label = 'High'; explanation = 'Most required scope collected. Estimate is reliable.'; }
  else if (pct >= 50) { label = 'Medium'; explanation = 'Partial scope. Some assumptions in use.'; }
  else if (pct >= 20) { label = 'Low'; explanation = 'Limited scope. On-site assessment recommended.'; }
  else { label = 'Insufficient'; explanation = 'Not enough information. On-site assessment required.'; }

  return { score: pct, label, explanation };
}

// ═══════════════════════════════════════════════════════
// ACTION SELECTION
// ═══════════════════════════════════════════════════════

function selectAction(transcript, customerName, scope) {
  const text = transcript.map(t => (t && t.text ? t.text : '')).join(' ').toLowerCase();
  const name = customerName.split(' ')[0];

  if (text.includes('emergency') || (scope && scope.urgency === 'emergency')) {
    return { action: 'Dispatch immediately', description: 'Emergency situation reported. Dispatch technician and notify on-call team.', priority: 'critical' };
  }
  if (text.includes('schedule') || text.includes('set up') || text.includes('come out') || text.includes('appointment') || text.includes('morning') || text.includes('afternoon') || text.includes('tomorrow')) {
    return { action: 'Schedule on-site estimate', description: `Customer requested an in-person assessment. Confirm appointment and dispatch estimator to ${name}.`, priority: 'high' };
  }
  if (text.includes('send') && (text.includes('quote') || text.includes('estimate') || text.includes('email'))) {
    return { action: 'Send written estimate', description: 'Customer requested a written estimate. Prepare and send within 24 hours.', priority: 'medium' };
  }
  if (text.includes('think about') || text.includes('call me back') || text.includes('get back')) {
    return { action: 'Follow up in 48 hours', description: 'Customer needs time. Follow up by phone in 48 hours.', priority: 'medium' };
  }
  return { action: 'Review and follow up', description: 'Lead captured. Review scope details and follow up within 24 hours.', priority: 'medium' };
}

// ═══════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════

function _rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function _pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ═══════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════

module.exports = {
  CATALOG,
  generateScenario,
  generateTranscript,
  extractScope,
  classifyService,
  calculatePricing,
  calculateConfidence,
  selectAction,
};
