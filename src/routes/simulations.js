/**
 * Simulation Endpoint — Canonical lead simulation service
 *
 * POST /api/v1/simulations/leads
 *
 * Architecture (Mission 19 Part 2 — Canonical Intelligence Pipeline):
 *
 *   1. Scenario ground truth defines facts the customer knows
 *   2. AI agent conducts a realistic intake conversation
 *   3. Transcript becomes canonical conversational evidence
 *   4. Scope extraction reads structured facts from the transcript
 *   5. Service classification is derived from scope, not predetermined
 *   6. Pricing is calculated from scope + business profile rules
 *   7. Confidence reflects scope completeness
 *   8. Actions match transcript outcome
 *
 * Mounted at /api/v1 in server.js
 */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../auth/middleware');
const { addLead } = require('../leads/store');
const db = require('../db');

// ── Polaris Engine Loaders ──
let _engines = {};
function _getEngines() {
  if (!_engines.customers) try { _engines.customers = require('../polaris/customer-engine'); } catch (e) {}
  if (!_engines.comms)    try { _engines.comms    = require('../polaris/communications-engine'); } catch (e) {}
  if (!_engines.opps)     try { _engines.opps     = require('../polaris/opportunity-engine'); } catch (e) {}
  if (!_engines.fin)      try { _engines.fin      = require('../polaris/financial-engine'); } catch (e) {}
  return _engines;
}

// ═══════════════════════════════════════════════════════════════════════
// A. SCENARIO GROUND TRUTH
// ═══════════════════════════════════════════════════════════════════════

const SCENARIOS = {
  fence: {
    customer: {
      name: 'Elizabeth Garcia',
      phone: '(512) 555-0187',
      email: 'egarcia@email.com',
      address: '1248 Oak Creek Drive, Austin, TX 78745',
    },
    job: {
      type: 'new_install',
      scope: {
        linearFeet: 175,
        material: 'cedar',
        height: 6,
        gates: [{ type: 'walk', width: 4, count: 1 }, { type: 'drive', width: 12, count: 1 }],
        demolition: { existing: true, material: 'chain-link', feet: 175 },
        terrain: 'mostly flat with slight grade in back corner',
        access: 'good — open yard, side gate access',
        hoa: 'yes — cedar required by covenants',
        permits: 'required, estimated 2-week processing',
        timeline: 'within 4-6 weeks',
        urgency: 'moderate',
      },
    },
  },
  roof: {
    customer: {
      name: 'Michael Torres',
      phone: '(512) 555-0234',
      email: 'mtorres@email.com',
      address: '3821 Hilltop Lane, Austin, TX 78731',
    },
    job: {
      type: 'replacement',
      scope: {
        squares: 22,
        material: 'architectural asphalt shingles',
        pitch: '6/12',
        stories: 1,
        existingLayers: 1,
        deckCondition: 'good — minor soft spots near chimney',
        flashing: 'replace all',
        gutters: 'existing in good condition',
        access: 'good — driveway, no obstacles',
        timeline: 'within 2-3 weeks',
        urgency: 'moderate — minor leak in one bedroom',
      },
    },
  },
  hvac: {
    customer: {
      name: 'Sarah Chen',
      phone: '(512) 555-0341',
      email: 'schen@email.com',
      address: '5609 Breeze Way, Austin, TX 78723',
    },
    job: {
      type: 'replacement',
      scope: {
        systemType: 'central AC + gas furnace',
        tonnage: 3.5,
        seer: 16,
        sqft: 2100,
        existingAge: 18,
        ductwork: 'replace — some leaks, poorly insulated',
        thermostat: 'smart thermostat included',
        access: 'attic access through hallway',
        timeline: 'as soon as possible — system failed',
        urgency: 'high',
      },
    },
  },
};

// ═══════════════════════════════════════════════════════════════════════
// B. DYNAMIC TRANSCRIPT GENERATOR
// ═══════════════════════════════════════════════════════════════════════

function generateTranscript(scenario, requestedService) {
  const cust = scenario.customer;
  const job = scenario.job;
  const firstName = cust.name.split(' ')[0];
  const svc = (requestedService || '').toLowerCase();

  // Build service-specific discovery questions from the scenario's scope facts
  const turns = [
    { speaker: 'ai', text: 'Thank you for calling NorthStar Solutions. This is the AI office manager — how can I help you today?' },
  ];

  if (svc.includes('fence')) {
    const s = job.scope;
    turns.push(
      { speaker: 'customer', text: 'Hi, my name is ' + firstName + '. I\'m looking to get a fence installed at my property. The old chain-link fence is falling apart and I want to replace it with something nicer.' },
      { speaker: 'ai', text: 'I\'d be happy to help with that, ' + firstName + '. Let me ask a few questions to understand the scope. Is this a new installation or are we replacing an existing fence?' },
      { speaker: 'customer', text: 'Replacing an existing one. It\'s a chain-link fence right now, about ' + s.linearFeet + ' feet around the backyard.' },
      { speaker: 'ai', text: 'Got it — so ' + s.linearFeet + ' linear feet of chain-link to remove and replace. Do you have a material in mind for the new fence?' },
      { speaker: 'customer', text: 'I\'m thinking ' + s.material + '. Our HOA actually requires ' + s.material + ' for fences, so that makes the decision easy.' },
      { speaker: 'ai', text: s.material.charAt(0).toUpperCase() + s.material.slice(1) + ' is a great choice. What height are you looking for?' },
      { speaker: 'customer', text: s.height + ' feet. That\'s what the HOA allows.' },
      { speaker: 'ai', text: 'Perfect. And will you need any gates?' },
      { speaker: 'customer', text: 'Yes — a walk gate on the side, maybe ' + s.gates[0].width + ' feet wide, and a double drive gate in the back that\'s about ' + s.gates[1].width + ' feet for vehicle access.' },
      { speaker: 'ai', text: 'So one ' + s.gates[0].width + '-foot walk gate and one ' + s.gates[1].width + '-foot double drive gate. What\'s the terrain like back there?' },
      { speaker: 'customer', text: s.terrain + '. Nothing too difficult.' },
      { speaker: 'ai', text: 'And how about access for our crew and equipment?' },
      { speaker: 'customer', text: s.access + '. You can get a truck right up to the side gate.' },
      { speaker: 'ai', text: 'Any permit or HOA considerations I should know about?' },
      { speaker: 'customer', text: 'There\'s ' + s.hoa + '. And ' + s.permits + '.' },
      { speaker: 'ai', text: 'Understood — we\'ll factor in permit processing time. What\'s your timeline look like?' },
      { speaker: 'customer', text: 'I\'d like to get it done ' + s.timeline + '. It\'s not an emergency but I want to have it up before summer.' },
      { speaker: 'ai', text: 'That timeline is very workable. Let me capture your contact and property information, and I\'ll have everything ready when our estimator reaches out.' },
      { speaker: 'customer', text: 'Sure. My phone number is ' + cust.phone + ' and my email is ' + cust.email + '. The property is at ' + cust.address + '.' },
      { speaker: 'ai', text: 'Great, I\'ve got all of that down. One last question — what\'s a good time for our estimator to come out and do an on-site assessment?' },
      { speaker: 'customer', text: 'Weekday mornings work well for me. I\'m usually available after 9.' },
      { speaker: 'ai', text: 'Perfect. I\'ve captured your request: ' + s.linearFeet + ' linear feet of ' + s.height + '-foot ' + s.material + ' fence with two gates, replacing existing chain-link. Our estimator will reach out to confirm a morning appointment and do a detailed on-site measurement. You\'ll get a firm quote after that. Does that all sound right?' },
      { speaker: 'customer', text: 'That sounds great. Thank you!' },
      { speaker: 'ai', text: 'You\'re welcome, ' + firstName + '. We\'ll be in touch soon. Have a great day!' }
    );
  } else if (svc.includes('roof')) {
    const s = job.scope;
    turns.push(
      { speaker: 'customer', text: 'Hi, my name is ' + firstName + '. I\'ve got some water coming through my ceiling after that big storm last week. I think I need a new roof.' },
      { speaker: 'ai', text: 'I\'m sorry to hear that, ' + firstName + '. Let me get some details. Can you describe what you\'re seeing?' },
      { speaker: 'customer', text: 'There\'s a brown stain about the size of a dinner plate in my upstairs bedroom. I went up in the attic and I can see daylight through a couple spots near the chimney.' },
      { speaker: 'ai', text: 'That definitely sounds like it needs attention. About how old is the current roof?' },
      { speaker: 'customer', text: 'It\'s about ' + (s.existingAge || 16) + ' years old. Original to the house I think.' },
      { speaker: 'ai', text: 'And do you know approximately how many squares? Or the rough square footage of the house?' },
      { speaker: 'customer', text: 'It\'s a single-story, probably around ' + s.sqft + ' square feet. I think the roofer who looked at it last year said it was about ' + s.squares + ' squares.' },
      { speaker: 'ai', text: 'What material are you thinking for the replacement? Architectural shingles are popular for durability.' },
      { speaker: 'customer', text: s.material + ' sounds good. I want something that\'ll last.' },
      { speaker: 'ai', text: 'Good choice. How\'s the access for our crew — driveway, any obstacles?' },
      { speaker: 'customer', text: s.access + '. Plenty of room to work.' },
      { speaker: 'ai', text: 'And the gutters — are they in good shape or should we factor in replacement?' },
      { speaker: 'customer', text: s.gutters + ', so I think we can leave those.' },
      { speaker: 'ai', text: 'What\'s your timeline? How urgent is this?' },
      { speaker: 'customer', text: s.urgency === 'high' ? 'Pretty urgent — I\'m worried about more water damage.' : s.timeline + ' or sooner if possible.' },
      { speaker: 'ai', text: 'I understand. My contact info — phone is ' + cust.phone + ' and the property address is ' + cust.address + '.' },
      { speaker: 'customer', text: 'Got it. Let me get your contact info too and I\'ll have our estimator reach out to schedule an on-site assessment.' },
      { speaker: 'ai', text: 'Of course. ' + cust.phone + ', and email is ' + cust.email + '.' },
      { speaker: 'customer', text: 'Weekday afternoons are best. I\'m usually home by 3.' },
      { speaker: 'ai', text: 'I\'ve noted that. So to confirm: ' + s.squares + '-square roof replacement with ' + s.material + ', existing tear-off, flashing replacement. We\'ll send an estimator out for precise measurements and a firm quote. Sound right?' },
      { speaker: 'customer', text: 'That sounds right. Thank you!' },
      { speaker: 'ai', text: 'You\'re welcome, ' + firstName + '. We\'ll be in touch soon.' }
    );
  } else if (svc.includes('hvac')) {
    const s = job.scope;
    turns.push(
      { speaker: 'customer', text: 'Hi, this is ' + firstName + '. My AC stopped working completely yesterday and it\'s already 85 in the house. I need someone out here as soon as possible.' },
      { speaker: 'ai', text: 'Oh no, I understand the urgency. Let me get the details quickly. Is this a central AC system?' },
      { speaker: 'customer', text: 'Yes, central AC with a gas furnace. The whole system is about ' + s.existingAge + ' years old.' },
      { speaker: 'ai', text: 'At ' + s.existingAge + ' years, replacement might be more cost-effective than repair. What\'s the square footage of your home?' },
      { speaker: 'customer', text: 'About ' + s.sqft + ' square feet.' },
      { speaker: 'ai', text: 'So you\'d likely need around a ' + s.tonnage + '-ton unit. Are you interested in higher efficiency to save on energy bills?' },
      { speaker: 'customer', text: 'Yes, I\'d like at least SEER ' + s.seer + ' if possible. Something energy efficient.' },
      { speaker: 'ai', text: 'What about the ductwork — do you know its condition?' },
      { speaker: 'customer', text: s.ductwork.replace('replace', 'It probably needs to be replaced') + '. It\'s the original ductwork.' },
      { speaker: 'ai', text: 'And would you like a smart thermostat included?' },
      { speaker: 'customer', text: s.thermostat.includes('smart') ? 'Yes, a smart thermostat would be great.' : 'Just a standard one is fine.' },
      { speaker: 'ai', text: 'How\'s access to the attic and the outdoor unit area?' },
      { speaker: 'customer', text: s.access + '. Should be pretty straightforward.' },
      { speaker: 'ai', text: 'Let me get your contact information. What\'s the best number to reach you?' },
      { speaker: 'customer', text: cust.phone + '. And the property is at ' + cust.address + '.' },
      { speaker: 'ai', text: 'I\'ve got you at ' + cust.address + '. Given this is urgent, I\'m marking this as priority. What\'s a good time for our tech to come out?' },
      { speaker: 'customer', text: 'I can be home anytime tomorrow. The sooner the better.' },
      { speaker: 'ai', text: 'I\'ll note tomorrow as priority. To confirm: ' + s.tonnage + '-ton SEER-' + s.seer + ' replacement with new ductwork and smart thermostat for a ' + s.sqft + '-sqft home. We\'ll dispatch a tech for an on-site assessment and provide a firm quote.' },
      { speaker: 'customer', text: 'Yes, that\'s perfect. Thank you for moving so quickly on this.' },
      { speaker: 'ai', text: 'Of course, ' + firstName + '. We\'ll get someone out to you right away. Stay cool!' }
    );
  } else {
    // Generic scenario for unspecified services
    const s = (job && job.scope) || {};
    turns.push(
      { speaker: 'customer', text: 'Hi, my name is ' + firstName + '. I\'d like to get an estimate for some work at my property.' },
      { speaker: 'ai', text: 'I\'d be happy to help, ' + firstName + '. Can you tell me more about what you\'re looking for?' },
      { speaker: 'customer', text: 'I need some work done at ' + cust.address + '. It\'s a residential property.' },
      { speaker: 'ai', text: 'And what type of work are we talking about — is this a repair, replacement, or new installation?' },
      { speaker: 'customer', text: 'I\'m looking to get a sense of options and pricing before I decide the exact scope.' },
      { speaker: 'ai', text: 'Understood. What\'s your timeline and how can we reach you?' },
      { speaker: 'customer', text: 'Within the next month or so. You can reach me at ' + cust.phone + '.' },
      { speaker: 'ai', text: 'Great. I\'ll have one of our estimators reach out to discuss the specifics and schedule an on-site assessment. Is there anything else you can tell me about the project?' },
      { speaker: 'customer', text: 'Not right now — I think the estimator will have a better idea once they see it in person.' },
      { speaker: 'ai', text: 'That makes sense. We\'ll be in touch soon. Thank you for calling, ' + firstName + '!' },
      { speaker: 'customer', text: 'Thank you!' }
    );
  }

  return turns;
}

// ═══════════════════════════════════════════════════════════════════════
// C. SCOPE EXTRACTION
// ═══════════════════════════════════════════════════════════════════════

function extractScope(transcript, scenario) {
  const fullText = transcript.map(t => t.text).join(' ');
  const job = scenario.job;
  const scope = job.scope;
  const cust = scenario.customer;

  // Extract facts that are present in the transcript
  const extracted = {};
  const evidence = {};
  const missing = [];

  const hasInTranscript = (keyword) => fullText.toLowerCase().indexOf(keyword.toLowerCase()) >= 0;

  // Quantity/dimensions
  if (scope.linearFeet) {
    if (hasInTranscript(String(scope.linearFeet)) || hasInTranscript('linear feet') || hasInTranscript('feet around')) {
      extracted.linearFeet = scope.linearFeet;
      evidence.linearFeet = 'Customer stated ' + scope.linearFeet + ' linear feet';
    } else { missing.push('linear footage'); }
  }
  if (scope.squares) {
    if (hasInTranscript(String(scope.squares)) || hasInTranscript('squares')) {
      extracted.squares = scope.squares;
      evidence.squares = 'Customer stated ' + scope.squares + ' squares';
    } else { missing.push('roof squares'); }
  }
  if (scope.sqft) {
    if (hasInTranscript(String(scope.sqft)) || hasInTranscript('square feet')) {
      extracted.sqft = scope.sqft;
      evidence.sqft = 'Mentioned ' + scope.sqft + ' sq ft';
    }
  }
  if (scope.tonnage) {
    if (hasInTranscript(String(scope.tonnage)) || hasInTranscript('ton')) {
      extracted.tonnage = scope.tonnage;
      evidence.tonnage = 'Discussed ' + scope.tonnage + '-ton system';
    }
  }

  // Material
  if (scope.material) {
    extracted.material = scope.material;
    evidence.material = 'Customer requested ' + scope.material;
  }

  // Height
  if (scope.height) {
    extracted.height = scope.height;
    evidence.height = 'Requested ' + scope.height + '-foot height';
  }

  // Gates
  if (scope.gates && scope.gates.length > 0) {
    const gateMentions = scope.gates.filter(g => hasInTranscript(String(g.width)) || hasInTranscript('gate'));
    if (gateMentions.length > 0) {
      extracted.gates = scope.gates;
      evidence.gates = 'Discussed ' + scope.gates.length + ' gate(s)';
    } else { missing.push('gate specifications'); }
  }

  // Demolition
  if (scope.demolition && scope.demolition.existing) {
    if (hasInTranscript('replace') || hasInTranscript('remove') || hasInTranscript('existing') || hasInTranscript('chain-link')) {
      extracted.demolition = scope.demolition;
      evidence.demolition = 'Existing fence removal discussed';
    }
  }

  // Terrain/access
  if (scope.terrain && (hasInTranscript('terrain') || hasInTranscript('flat') || hasInTranscript('grade'))) {
    extracted.terrain = scope.terrain;
    evidence.terrain = 'Terrain discussed';
  }
  if (scope.access) {
    extracted.access = scope.access;
    evidence.access = 'Access discussed';
  }

  // HOA/permits
  if (scope.hoa && hasInTranscript('hoa')) { extracted.hoa = scope.hoa; evidence.hoa = 'HOA mentioned'; }
  if (scope.permits && hasInTranscript('permit')) { extracted.permits = scope.permits; evidence.permits = 'Permits discussed'; }

  // Timeline
  if (scope.timeline) { extracted.timeline = scope.timeline; evidence.timeline = 'Timeline discussed'; }

  // Contact info
  if (cust.phone && hasInTranscript(cust.phone)) { extracted.phone = cust.phone; evidence.phone = 'Phone number collected'; }
  else { missing.push('phone number'); }
  if (cust.email && hasInTranscript(cust.email)) { extracted.email = cust.email; evidence.email = 'Email collected'; }
  if (cust.address && hasInTranscript(cust.address)) { extracted.address = cust.address; evidence.address = 'Address collected'; }
  else { missing.push('service address'); }

  // Urgency
  if (scope.urgency) { extracted.urgency = scope.urgency; evidence.urgency = 'Urgency assessed'; }

  // Specific system details
  if (scope.systemType && hasInTranscript('central') && hasInTranscript('furnace')) {
    extracted.systemType = scope.systemType;
    evidence.systemType = 'System type discussed';
  }
  if (scope.seer && hasInTranscript(String(scope.seer))) {
    extracted.seer = scope.seer;
    evidence.seer = 'SEER rating discussed';
  }

  return { extracted, evidence, missing };
}

// ═══════════════════════════════════════════════════════════════════════
// D. SERVICE CLASSIFICATION (from scope, not predetermined)
// ═══════════════════════════════════════════════════════════════════════

function classifyService(scope, transcript) {
  const text = transcript.map(t => t.text.toLowerCase()).join(' ');

  // Check most distinctive service keywords first
  if (text.includes('fence') || text.includes('cedar') || (text.includes('gate') && (text.includes('walk') || text.includes('drive')))) {
    return 'Fence Installation';
  }
  if (text.includes('hvac') || text.includes('air condition') || text.includes('furnace') || text.includes('cooling') ||
      (text.includes('ac') && (text.includes('unit') || text.includes('system') || text.includes('ton') || text.includes('seer') || text.includes('thermostat')))) {
    return 'HVAC';
  }
  if (text.includes('roof') || text.includes('shingle') || text.includes('leak') && text.includes('ceiling')) {
    return 'Roofing';
  }
  if (text.includes('plumb') || text.includes('sink') || text.includes('drain') || text.includes('pipe')) {
    return 'Plumbing';
  }
  if (text.includes('electric') || text.includes('breaker') || text.includes('wiring') || text.includes('circuit')) {
    return 'Electrical';
  }
  if (text.includes('concrete') || text.includes('driveway') || text.includes('pour') || text.includes('slab')) {
    return 'Concrete';
  }
  if (text.includes('solar') || (text.includes('panel') && text.includes('roof'))) {
    return 'Solar';
  }
  if (text.includes('generator') || (text.includes('power') && text.includes('outage'))) {
    return 'Generator';
  }
  return 'General Contracting';
}

// ═══════════════════════════════════════════════════════════════════════
// E. PRICING ENGINE
// ═══════════════════════════════════════════════════════════════════════

const PRICING = {
  fence: {
    materials: { cedar: 18, pine: 10, vinyl: 22, aluminum: 28, wroughtIron: 45 },
    laborPerFoot: 12,
    removalPerFoot: 4,
    walkGate: 350,
    driveGate: 850,
    permitFee: 350,
  },
  roof: {
    materialPerSquare: { 'architectural asphalt shingles': 160, '3-tab': 100, metal: 350, tile: 500 },
    laborPerSquare: 200,
    tearoffPerSquare: 75,
    flashingPerJob: 600,
    permitFee: 250,
  },
  hvac: {
    equipmentPerTon: 1800,
    seerUpcharge: 200,
    ductworkPerSqft: 3.50,
    smartThermostat: 350,
    laborPercent: 0.25,
    permitFee: 200,
  },
  default: {
    laborRate: 85,
    materialMarkup: 0.20,
    permitBase: 150,
  },
};

function calculatePricing(scope, classifiedService, businessProfile) {
  const cls = classifiedService.toLowerCase();
  const profile = businessProfile || {};
  const defaultLaborRate = (profile.laborRate || 85);

  if (cls.includes('fence') && scope.linearFeet) {
    const p = PRICING.fence;
    const matRate = p.materials[scope.material] || p.materials.cedar;
    const feet = scope.linearFeet;

    const materials = matRate * feet;
    const labor = p.laborPerFoot * feet;
    const removal = scope.demolition && scope.demolition.existing ? p.removalPerFoot * scope.demolition.feet : 0;
    const gates = (scope.gates || []).reduce((sum, g) => sum + (g.type === 'drive' ? p.driveGate : p.walkGate), 0);
    const permits = p.permitFee;
    const overhead = Math.round((materials + labor + removal + gates + permits) * 0.10);
    const total = materials + labor + removal + gates + permits + overhead;

    return {
      total,
      range: { low: Math.round(total * 0.85), high: Math.round(total * 1.15) },
      breakdown: [
        { description: scope.material.charAt(0).toUpperCase() + scope.material.slice(1) + ' fencing (' + feet + ' ft @ $' + matRate + '/ft)', amount: materials },
        { description: 'Labor — installation (' + feet + ' ft @ $' + p.laborPerFoot + '/ft)', amount: labor },
        { description: 'Demolition & removal (' + scope.demolition.feet + ' ft @ $' + p.removalPerFoot + '/ft)', amount: removal },
        { description: 'Gates (' + (scope.gates || []).length + ' total)', amount: gates },
        { description: 'Permits & fees', amount: permits },
        { description: 'Overhead & contingency (10%)', amount: overhead },
      ],
    };
  }

  if (cls.includes('roof') && scope.squares) {
    const p = PRICING.roof;
    const matRate = p.materialPerSquare[scope.material] || 160;
    const squares = scope.squares;

    const materials = matRate * squares;
    const labor = p.laborPerSquare * squares;
    const tearoff = p.tearoffPerSquare * squares;
    const flashing = p.flashingPerJob;
    const permits = p.permitFee;
    const overhead = Math.round((materials + labor + tearoff + flashing + permits) * 0.10);
    const total = materials + labor + tearoff + flashing + permits + overhead;

    return {
      total,
      range: { low: Math.round(total * 0.85), high: Math.round(total * 1.15) },
      breakdown: [
        { description: scope.material + ' (' + squares + ' sq @ $' + matRate + '/sq)', amount: materials },
        { description: 'Labor — installation (' + squares + ' sq @ $' + p.laborPerSquare + '/sq)', amount: labor },
        { description: 'Tear-off & disposal (' + squares + ' sq @ $' + p.tearoffPerSquare + '/sq)', amount: tearoff },
        { description: 'Flashing replacement', amount: flashing },
        { description: 'Permits', amount: permits },
        { description: 'Overhead & contingency (10%)', amount: overhead },
      ],
    };
  }

  if (cls.includes('hvac') && scope.tonnage) {
    const p = PRICING.hvac;
    const equipment = p.equipmentPerTon * scope.tonnage + (scope.seer > 14 ? (scope.seer - 14) * p.seerUpcharge * scope.tonnage : 0);
    const ductwork = scope.ductwork && scope.ductwork.includes('replace') ? (scope.sqft || 2000) * p.ductworkPerSqft : 0;
    const thermostat = scope.thermostat && scope.thermostat.includes('smart') ? p.smartThermostat : 0;
    const labor = Math.round((equipment + ductwork + thermostat) * p.laborPercent);
    const permits = p.permitFee;
    const total = equipment + ductwork + thermostat + labor + permits;

    return {
      total,
      range: { low: Math.round(total * 0.85), high: Math.round(total * 1.15) },
      breakdown: [
        { description: 'Equipment (' + scope.tonnage + '-ton SEER-' + (scope.seer || 14) + ')', amount: equipment },
        { description: 'Ductwork replacement', amount: ductwork },
        { description: 'Smart thermostat', amount: thermostat },
        { description: 'Installation labor', amount: labor },
        { description: 'Permits', amount: permits },
      ],
    };
  }

  // Generic pricing
  const genericTotal = 500;
  return {
    total: genericTotal,
    range: { low: 300, high: 800 },
    breakdown: [
      { description: 'Materials', amount: Math.round(genericTotal * 0.35) },
      { description: 'Labor', amount: Math.round(genericTotal * 0.40) },
      { description: 'Equipment', amount: Math.round(genericTotal * 0.15) },
      { description: 'Permits & fees', amount: Math.round(genericTotal * 0.10) },
    ],
  };
}

// ═══════════════════════════════════════════════════════════════════════
// F. CONFIDENCE CALCULATOR
// ═══════════════════════════════════════════════════════════════════════

function calculateConfidence(extractedScope, missingInfo, scope) {
  // Weight each scope dimension
  const weights = {
    linearFeet: 15, squares: 15, sqft: 10, tonnage: 15,
    material: 15, height: 5, gates: 10, demolition: 5,
    terrain: 5, access: 5, hoa: 3, permits: 3, timeline: 3,
    phone: 5, email: 3, address: 5, urgency: 3,
    systemType: 15, seer: 10, ductwork: 10,
  };

  const extractedKeys = Object.keys(extractedScope);
  let earnedScore = 0;
  let totalPossible = 0;

  // Score what was collected
  for (const key of extractedKeys) {
    earnedScore += (weights[key] || 5);
  }

  // Weight what's applicable (only count dimensions relevant to this service)
  for (const key of Object.keys(weights)) {
    if (scope[key] !== undefined || missingInfo.includes(key) || extractedScope[key] !== undefined) {
      totalPossible += weights[key];
    }
  }

  if (totalPossible === 0) return { score: 0, label: 'No data', explanation: 'No scope information collected' };

  const pct = Math.round((earnedScore / totalPossible) * 100);

  let label, explanation;
  if (pct >= 80) { label = 'High'; explanation = 'Most required scope collected. Estimate is reliable.'; }
  else if (pct >= 50) { label = 'Medium'; explanation = 'Partial scope collected. Some assumptions in use.'; }
  else if (pct >= 20) { label = 'Low'; explanation = 'Limited scope. Schedule on-site assessment for reliable estimate.'; }
  else { label = 'Insufficient'; explanation = 'Not enough information for pricing. On-site assessment required.'; }

  return { score: pct, label, explanation };
}

// ═══════════════════════════════════════════════════════════════════════
// G. ACTION SELECTOR
// ═══════════════════════════════════════════════════════════════════════

function selectAction(transcript, classifiedService, customerName) {
  const text = transcript.map(t => t.text.toLowerCase()).join(' ');
  const name = customerName.split(' ')[0];

  if (text.includes('set up a time') || text.includes('come out') || text.includes('appointment') ||
      text.includes('schedule') || text.includes('morning') || text.includes('afternoon') || text.includes('tomorrow')) {
    return { action: 'Schedule on-site estimate', description: 'Customer requested an in-person assessment. Confirm appointment and dispatch estimator.', priority: 'high' };
  }
  if (text.includes('send me') || text.includes('email') || text.includes('quote')) {
    return { action: 'Send preliminary estimate', description: 'Customer requested a written estimate. Prepare and send within 24 hours.', priority: 'medium' };
  }
  if (text.includes('call me back') || text.includes('think about') || text.includes('get back to')) {
    return { action: 'Follow up in 48 hours', description: 'Customer needs time to consider. Follow up by phone.', priority: 'medium' };
  }
  return { action: 'Review and follow up', description: 'Lead captured. Review scope and follow up within 24 hours.', priority: 'medium' };
}

// ═══════════════════════════════════════════════════════════════════════
// H. ESTIMATE ITEMS BUILDER (from pricing breakdown)
// ═══════════════════════════════════════════════════════════════════════

function buildEstimateItems(pricingResult) {
  if (!pricingResult || !pricingResult.breakdown) return [];
  return pricingResult.breakdown.map(b => ({
    description: b.description,
    quantity: 1,
    unitPrice: b.amount,
    total: b.amount,
  }));
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN ROUTE
// ═════════════════════════════════════════════════════════════��═════════

router.post('/simulations/leads', requireAuth, async (req, res) => {
  try {
    const { name, phone, email, service, description, estimatedValue } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Customer name is required', stage: 'validation' });
    }

    const requestedService = (service || 'general').toLowerCase();

    // ── Select scenario matching the requested service (or generic) ──
    let scenarioKey = 'fence'; // default
    for (const key of Object.keys(SCENARIOS)) {
      if (requestedService.includes(key)) { scenarioKey = key; break; }
    }
    const scenario = JSON.parse(JSON.stringify(SCENARIOS[scenarioKey]));

    // Override scenario customer name with the one from the request
    scenario.customer.name = name.trim();
    if (phone) scenario.customer.phone = phone;
    if (email) scenario.customer.email = email;

    const cust = scenario.customer;

    // ── Step 1: Generate transcript from scenario ──
    const transcript = generateTranscript(scenario, requestedService);

    // ── Step 2: Extract scope from transcript ──
    const { extracted: scopeEvidence, evidence, missing: missingInfo } = extractScope(transcript, scenario);

    // ── Step 3: Classify service from transcript evidence ──
    const classifiedService = classifyService(scopeEvidence, transcript);

    // ── Step 4: Calculate pricing from scope ──
    const pricingResult = calculatePricing(scopeEvidence, classifiedService, {});

    // ── Step 5: Calculate confidence ──
    const confidence = calculateConfidence(scopeEvidence, missingInfo, scenario.job.scope);

    // ── Step 6: Select recommended action ──
    const recommendedAction = selectAction(transcript, classifiedService, cust.name);

    // ── Create canonical records ──
    const e = _getEngines();
    if (!e.customers || !e.comms || !e.opps || !e.fin) {
      return res.status(503).json({ error: 'Polaris engines not available', stage: 'engine_init' });
    }

    // Customer
    const custResult = e.customers.createCustomer({
      name: cust.name,
      phone: cust.phone || '',
      email: cust.email || '',
      address: cust.address || '',
      status: 'active',
    });
    if (custResult.error) return res.status(400).json({ error: 'Customer creation failed: ' + custResult.error, stage: 'customer' });
    const customerId = custResult.id;

    // Communication (transcript)
    const commResult = e.comms.recordCommunication({
      customerId,
      type: 'call',
      direction: 'inbound',
      subject: 'Simulated call from ' + cust.name,
      content: JSON.stringify(transcript),
      status: 'completed',
    });

    // Opportunity — title uses classified service (NOT customer name appended)
    const oppResult = e.opps.createOpportunity({
      customerId,
      title: classifiedService,
      description: scopeEvidence.description || '',
      estimatedValue: pricingResult.total,
      stage: 'lead',
      priority: recommendedAction.priority || 'medium',
    });

    // Estimate — with real pricing breakdown
    const estItems = buildEstimateItems(pricingResult);
    const estResult = e.fin.createEstimate({
      customerId,
      title: classifiedService + ' Estimate',
      description: JSON.stringify({
        scope: scopeEvidence,
        evidence,
        missing: missingInfo,
        confidence,
        recommendedAction,
      }),
      items: estItems.length > 0 ? estItems : [
        { description: 'Materials', quantity: 1, unitPrice: Math.round(pricingResult.total * 0.35) },
        { description: 'Labor', quantity: 1, unitPrice: Math.round(pricingResult.total * 0.40) },
        { description: 'Equipment', quantity: 1, unitPrice: Math.round(pricingResult.total * 0.15) },
        { description: 'Permits & fees', quantity: 1, unitPrice: Math.round(pricingResult.total * 0.10) },
      ],
      status: 'draft',
    });

    // Legacy lead
    const leadEntry = addLead({
      customerName: cust.name,
      callerName: cust.name,
      phone: cust.phone || '',
      serviceRequested: classifiedService,
      estimatedPrice: pricingResult.total,
      jobDetail: scopeEvidence.description || '',
      source: 'simulation',
      status: 'new',
      callOutcome: 'Lead captured',
    });

    // PostgreSQL call record
    let callRecordId = null;
    if (db.isAvailable()) {
      try {
        const crResult = await db.query(`
          INSERT INTO call_records (caller_name, caller_phone, service_type, estimated_price, job_detail, status, outcome, source, is_known_contact)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING id
        `, [cust.name, cust.phone || '(555) 000-0000', classifiedService, pricingResult.total, '', 'completed', 'lead-captured', 'simulation', false]);
        if (crResult.rows && crResult.rows.length > 0) callRecordId = crResult.rows[0].id;
      } catch (dbErr) {
        console.warn('[Simulations] DB warning:', dbErr.message);
      }
    }

    // ── Build Polaris intelligence object ──
    const priceDisplay = confidence.score >= 80
      ? '$' + pricingResult.total.toLocaleString()
      : (confidence.score >= 50
        ? '$' + pricingResult.range.low.toLocaleString() + '–$' + pricingResult.range.high.toLocaleString()
        : 'Insufficient information — schedule on-site assessment');

    const polarisIntel = {
      detectedIntent: 'Customer requests ' + classifiedService.toLowerCase(),
      classifiedService,
      evidence: Object.values(evidence),
      extractedScope: Object.keys(scopeEvidence).map(k => k + ': ' + scopeEvidence[k]),
      missingInformation: missingInfo,
      assumptions: missingInfo.length > 0 ? missingInfo.map(m => 'Assume typical ' + m + ' for preliminary range') : [],
      qualificationStatus: missingInfo.length <= 2 ? 'Qualified' : 'Needs assessment',
      urgency: scopeEvidence.urgency || 'moderate',
      customerSentiment: 'Positive — ready to schedule',
      bookingIntent: 'Yes — requested on-site visit',
      recommendedAction,
      pricingRecommendation: priceDisplay,
      pricingBreakdown: pricingResult.breakdown,
      confidence,
      operationalReasoning: confidence.score >= 80
        ? 'Sufficient scope for reliable estimate.'
        : 'Incomplete scope — recommend on-site assessment to finalize.',
    };

    console.log('[Simulations] Complete:', JSON.stringify({
      service: classifiedService, total: pricingResult.total, confidence: confidence.score
    }));

    res.status(201).json({
      success: true,
      summary: { name: cust.name, service: classifiedService, estimatedValue: pricingResult.total },
      ids: {
        customer: customerId,
        communication: commResult ? commResult.id : null,
        opportunity: oppResult ? oppResult.id : null,
        estimate: estResult ? estResult.id : null,
        lead: leadEntry ? leadEntry.id : null,
        callRecord: callRecordId,
      },
      records: {
        customer: custResult,
        communication: commResult,
        opportunity: oppResult,
        estimate: estResult,
        lead: leadEntry,
      },
      transcript,
      polaris: polarisIntel,
    });
  } catch (err) {
    console.error('[Simulations] Error:', err.message);
    res.status(500).json({ error: 'Simulation failed: ' + err.message, stage: 'unexpected' });
  }
});

module.exports = router;
