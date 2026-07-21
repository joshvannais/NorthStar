/**
 * Service Catalog — Universal service definitions
 *
 * New services are added here as data. The intelligence pipeline
 * reads these definitions and adapts its behavior automatically.
 * No core engine code changes are needed for new services.
 *
 * PRICING NOTE: All pricing data (materials, rates, calculate()) lives
 * inside the `pricing` object. The calculate() method uses `this` to
 * access rates/materials — `this` is the pricing object.
 */

const SERVICE_CATALOG = {

  fence: {
    id: 'fence',
    displayName: 'Fence Installation',
    industries: ['construction', 'home-services'],
    classificationKeywords: [
      'fence', 'fencing', 'cedar', 'chain-link', 'vinyl fence',
      'aluminum fence', 'wrought iron', 'gate', 'privacy fence',
      'pool fence', 'picket fence', 'split rail',
    ],

    scopeSchema: {
      required: ['jobType', 'linearFeet', 'material'],
      recommended: ['height', 'gates', 'removalRequired', 'permitsRequired', 'timeline', 'schedulingPreference'],
      optional: ['terrain', 'hoa', 'propertyLine', 'budget'],
    },

    jobTypes: ['install', 'replace', 'repair', 'inspect'],

    // ── Pricing (all materials + rates + strategy live here) ──
    pricing: {
      strategy: 'perLinearFoot',
      laborPerLinearFoot: 12,
      removalPerLinearFoot: 4,
      gateWalk: 350,
      gateDrive: 850,
      permitBase: 350,
      overheadPercent: 0.10,
      materials: {
        cedar: { label: 'Cedar', perLinearFoot: 18 },
        pine: { label: 'Pressure-Treated Pine', perLinearFoot: 10 },
        vinyl: { label: 'Vinyl', perLinearFoot: 22 },
        aluminum: { label: 'Aluminum', perLinearFoot: 28 },
        'wrought-iron': { label: 'Wrought Iron', perLinearFoot: 45 },
        'chain-link': { label: 'Chain Link', perLinearFoot: 8 },
      },
      calculate(items) {
        const { linearFeet, material, removalRequired, gates } = items;
        const mats = this.materials;
        const matRate = mats[material] ? mats[material].perLinearFoot : 15;
        const materials = matRate * linearFeet;
        const labor = this.laborPerLinearFoot * linearFeet;
        const removal = removalRequired ? this.removalPerLinearFoot * linearFeet : 0;
        const gateTotal = (gates || []).reduce((s, g) => s + (g.type === 'drive' ? this.gateDrive : this.gateWalk), 0);
        const permits = this.permitBase;
        const subtotal = materials + labor + removal + gateTotal + permits;
        const overhead = Math.round(subtotal * this.overheadPercent);
        const total = subtotal + overhead;

        return {
          total,
          range: { low: Math.round(total * 0.85), high: Math.round(total * 1.15) },
          breakdown: [
            { label: `${mats[material] ? mats[material].label : 'Material'} (${linearFeet} ft)`, amount: materials },
            { label: `Labor (${linearFeet} ft @ $${this.laborPerLinearFoot}/ft)`, amount: labor },
            { label: 'Removal & disposal', amount: removal },
            { label: `Gates (${(gates||[]).length})`, amount: gateTotal },
            { label: 'Permits & fees', amount: permits },
            { label: 'Overhead (10%)', amount: overhead },
          ],
        };
      },
    },

    questions: {
      discovery: [
        { id: 'jobType', ask: 'Is this a new fence installation, a replacement, or a repair?', extract: /(install|new|replace|repair|fix)/i },
        { id: 'linearFeet', ask: 'Approximately how many linear feet is the fence?', extract: /(\d+)\s*(?:feet|ft|linear)/i },
        { id: 'material', ask: 'Do you have a material preference — cedar, vinyl, chain-link, aluminum, or wrought iron?', extract: /(cedar|vinyl|chain.link|aluminum|wrought.iron|pine|wood)/i },
      ],
      scope: [
        { id: 'height', ask: 'What height fence are you looking for?', extract: /(\d+)\s*(?:foot|ft|feet)/i },
        { id: 'gates', ask: 'Will you need any gates — walk gates or drive gates?', extract: /(gate|walk|drive|double)/i },
        { id: 'removalRequired', ask: 'Is there an existing fence that needs to be removed?', extract: /(yes|yeah|existing|remove|tear|old|current)/i },
        { id: 'terrain', ask: 'What\'s the terrain like where the fence will go?', extract: /(flat|hill|slope|grade|rocky|uneven)/i },
        { id: 'hoa', ask: 'Do you have an HOA with fence requirements?', extract: /(hoa|association|covenant|restriction)/i },
        { id: 'permitsRequired', ask: 'Are permits required in your area?', extract: /(permit|yes|no|not sure)/i },
      ],
      scheduling: [
        { id: 'timeline', ask: 'What\'s your timeline for this project?', extract: /(week|month|soon|asap|urgent|flexible)/i },
        { id: 'schedulingPreference', ask: 'What days and times work best for an on-site estimate?', extract: /(morning|afternoon|weekday|weekend|anytime)/i },
      ],
    },
  },

  roofing: {
    id: 'roofing',
    displayName: 'Roofing',
    industries: ['construction', 'home-services'],
    classificationKeywords: [
      'roof', 'roofing', 'shingle', 'leak', 'ceiling stain',
      'water damage', 'flashing', 'gutter', 'ice dam',
      'hail damage', 'missing shingle', 'roof repair',
    ],

    scopeSchema: {
      required: ['jobType', 'squares', 'material'],
      recommended: ['pitch', 'stories', 'existingLayers', 'flashingReplace', 'permitsRequired', 'timeline'],
      optional: ['deckCondition', 'gutters', 'insurance', 'budget'],
    },

    jobTypes: ['replace', 'repair', 'inspect', 'install'],

    pricing: {
      strategy: 'perSquare',
      laborPerSquare: 200,
      tearoffPerSquare: 75,
      flashingBase: 600,
      permitBase: 250,
      overheadPercent: 0.10,
      materials: {
        'architectural': { label: 'Architectural Asphalt Shingles', perSquare: 160 },
        '3-tab': { label: '3-Tab Shingles', perSquare: 100 },
        'metal': { label: 'Metal Roofing', perSquare: 350 },
        'tile': { label: 'Tile Roofing', perSquare: 500 },
        'slate': { label: 'Slate', perSquare: 700 },
      },
      calculate(items) {
        const { squares, material, existingLayers } = items;
        const mats = this.materials;
        const matRate = mats[material] ? mats[material].perSquare : 160;
        const materials = matRate * squares;
        const labor = this.laborPerSquare * squares;
        const tearoff = (existingLayers || 1) * this.tearoffPerSquare * squares;
        const flashing = this.flashingBase;
        const permits = this.permitBase;
        const subtotal = materials + labor + tearoff + flashing + permits;
        const overhead = Math.round(subtotal * this.overheadPercent);
        const total = subtotal + overhead;

        return {
          total,
          range: { low: Math.round(total * 0.85), high: Math.round(total * 1.15) },
          breakdown: [
            { label: `${mats[material] ? mats[material].label : 'Material'} (${squares} sq)`, amount: materials },
            { label: `Labor (${squares} sq)`, amount: labor },
            { label: 'Tear-off & disposal', amount: tearoff },
            { label: 'Flashing replacement', amount: flashing },
            { label: 'Permits', amount: permits },
            { label: 'Overhead (10%)', amount: overhead },
          ],
        };
      },
    },

    questions: {
      discovery: [
        { id: 'jobType', ask: 'Is this a full roof replacement, a repair, or an inspection?', extract: /(replace|repair|inspect|new|fix|leak)/i },
        { id: 'squares', ask: 'Do you know approximately how many squares your roof is? Or the square footage?', extract: /(\d+)\s*(?:squares|sq|square|feet|ft)/i },
        { id: 'material', ask: 'Do you have a material preference — architectural shingles, metal, or tile?', extract: /(architectural|metal|tile|shingle|slate|asphalt)/i },
      ],
      scope: [
        { id: 'pitch', ask: 'Is your roof steep or fairly walkable?', extract: /(steep|walkable|flat|pitch|slope)/i },
        { id: 'stories', ask: 'How many stories is your home?', extract: /(\d+)\s*(?:story|stories|floor)/i },
        { id: 'existingLayers', ask: 'How many layers of shingles are currently on the roof?', extract: /(\d+)\s*(?:layer)/i },
        { id: 'flashingReplace', ask: 'Do you know the condition of the flashing around chimneys and vents?', extract: /(good|bad|replace|rust|leak)/i },
        { id: 'insurance', ask: 'Will this be an insurance claim?', extract: /(insurance|claim|yes|no)/i },
      ],
      scheduling: [
        { id: 'timeline', ask: 'How soon do you need this done?', extract: /(week|month|soon|asap|urgent)/i },
        { id: 'schedulingPreference', ask: 'What days work best for our estimator to come out?', extract: /(morning|afternoon|weekday|weekend)/i },
      ],
    },
  },

  hvac: {
    id: 'hvac',
    displayName: 'HVAC',
    industries: ['hvac', 'home-services'],
    classificationKeywords: [
      'hvac', 'air condition', 'air conditioner', 'ac unit',
      'furnace', 'heat pump', 'cooling', 'heating',
      'thermostat', 'duct', 'ductwork', 'seer', 'ton',
      'not cooling', 'not heating', 'warm air', 'no heat',
    ],

    scopeSchema: {
      required: ['jobType', 'tonnage', 'systemType'],
      recommended: ['seer', 'sqft', 'ductworkReplace', 'fuelType', 'urgency', 'timeline'],
      optional: ['existingAge', 'thermostat', 'budget'],
    },

    jobTypes: ['replace', 'repair', 'maintain', 'install'],

    pricing: {
      strategy: 'perTon',
      equipmentPerTon: 1800,
      seerUpchargePerPoint: 200,
      ductworkPerSqft: 3.50,
      smartThermostat: 350,
      laborPercent: 0.25,
      permitBase: 200,
      calculate(items) {
        const { tonnage, seer, sqft, ductworkReplace, thermostat } = items;
        const baseSEER = 14;
        const equipment = this.equipmentPerTon * tonnage + (seer > baseSEER ? (seer - baseSEER) * this.seerUpchargePerPoint * tonnage : 0);
        const ductwork = ductworkReplace ? (sqft || 2000) * this.ductworkPerSqft : 0;
        const thermo = thermostat === 'smart' ? this.smartThermostat : 0;
        const labor = Math.round((equipment + ductwork + thermo) * this.laborPercent);
        const permits = this.permitBase;
        const total = equipment + ductwork + thermo + labor + permits;

        return {
          total,
          range: { low: Math.round(total * 0.85), high: Math.round(total * 1.15) },
          breakdown: [
            { label: `Equipment (${tonnage}-ton SEER-${seer || baseSEER})`, amount: equipment },
            { label: 'Ductwork replacement', amount: ductwork },
            { label: 'Smart thermostat', amount: thermo },
            { label: 'Installation labor', amount: labor },
            { label: 'Permits', amount: permits },
          ],
        };
      },
    },

    questions: {
      discovery: [
        { id: 'jobType', ask: 'Is this a full system replacement, a repair, or regular maintenance?', extract: /(replace|repair|maintain|service|new|fix|broke)/i },
        { id: 'systemType', ask: 'Is this a central AC with a furnace, a heat pump, or something else?', extract: /(central|furnace|heat.pump|mini.split|boiler)/i },
        { id: 'tonnage', ask: 'Do you know the tonnage of your current system?', extract: /(\d+\.?\d*)\s*(?:ton)/i },
      ],
      scope: [
        { id: 'sqft', ask: 'What\'s the approximate square footage of your home?', extract: /(\d+)\s*(?:sq|square|feet|ft)/i },
        { id: 'seer', ask: 'Are you interested in a higher efficiency unit — SEER 16 or above?', extract: /(seer\s*\d+|\d+\s*seer|efficien)/i },
        { id: 'fuelType', ask: 'Is your furnace gas or electric?', extract: /(gas|electric|propane|oil)/i },
        { id: 'existingAge', ask: 'How old is your current system?', extract: /(\d+)\s*(?:year|yr|old)/i },
        { id: 'ductworkReplace', ask: 'Do you think the ductwork needs to be replaced as well?', extract: /(yes|replace|new|no|good|fine)/i },
        { id: 'thermostat', ask: 'Would you like a smart thermostat included?', extract: /(yes|smart|no|standard)/i },
      ],
      scheduling: [
        { id: 'urgency', ask: 'How urgent is this — is the system completely down?', extract: /(urgent|emergency|down|broke|soon|flexible)/i },
        { id: 'schedulingPreference', ask: 'When would be the best time for our technician to come out?', extract: /(morning|afternoon|tomorrow|asap|weekend)/i },
      ],
    },
  },

  plumbing: {
    id: 'plumbing',
    displayName: 'Plumbing',
    industries: ['plumbing', 'home-services'],
    classificationKeywords: [
      'plumb', 'sink', 'drain', 'pipe', 'leak', 'water heater',
      'toilet', 'faucet', 'clog', 'backed up', 'sewer',
      'not draining', 'dripping', 'burst pipe', 'water damage',
    ],

    scopeSchema: {
      required: ['jobType', 'fixture'],
      recommended: ['leakSeverity', 'waterShutoff', 'emergency', 'timeline'],
      optional: ['activeDamage', 'accessibility', 'budget'],
    },

    jobTypes: ['repair', 'replace', 'install', 'emergency', 'inspect'],
    emergencyKeywords: ['burst', 'flooding', 'gushing', 'emergency', 'shut off', 'cannot stop'],

    pricing: {
      strategy: 'diagnosticFee',
      diagnosticFee: 129,
      hourlyRate: 95,
      calculate(items) {
        // Plumbing pricing is discovery-based; on-site assessment needed
        return {
          total: this.diagnosticFee,
          range: { low: 129, high: 2000 },
          breakdown: [
            { label: 'Diagnostic service call', amount: this.diagnosticFee },
            { label: 'Repair estimate (on-site)', amount: 0 },
          ],
        };
      },
    },

    questions: {
      discovery: [
        { id: 'jobType', ask: 'Is this a repair, a replacement, or an emergency?', extract: /(repair|replace|emergency|install|fix|broke)/i },
        { id: 'fixture', ask: 'What fixture or system is affected — sink, toilet, water heater, or something else?', extract: /(sink|toilet|water.heater|faucet|shower|tub|pipe|sewer)/i },
      ],
      scope: [
        { id: 'leakSeverity', ask: 'Is water actively leaking right now? How severe is it?', extract: /(active|drip|stream|flood|gush|leaking|no)/i },
        { id: 'waterShutoff', ask: 'Have you been able to shut off the water to the affected area?', extract: /(yes|no|shut|valve|can't|cannot)/i },
        { id: 'activeDamage', ask: 'Is there any water damage to floors, walls, or ceilings?', extract: /(damage|floor|wall|ceiling|wet|stain)/i },
      ],
      scheduling: [
        { id: 'urgency', ask: 'How soon do you need someone out?', extract: /(now|today|tomorrow|week|asap|emergency)/i },
      ],
    },
  },

  electrical: {
    id: 'electrical',
    displayName: 'Electrical',
    industries: ['electrical', 'home-services'],
    classificationKeywords: [
      'electric', 'breaker', 'circuit', 'wiring', 'outlet',
      'switch', 'panel', 'tripping', 'flickering', 'spark',
      'no power', 'burning smell', 'shock',
    ],

    scopeSchema: {
      required: ['jobType', 'symptoms'],
      recommended: ['breakerBehavior', 'safetyConcern', 'urgency', 'timeline'],
      optional: ['propertyType', 'budget'],
    },

    jobTypes: ['repair', 'install', 'upgrade', 'emergency', 'inspect'],
    emergencyKeywords: ['spark', 'burning', 'smell', 'smoke', 'shock', 'fire', 'hot to touch'],

    pricing: {
      strategy: 'diagnosticFee',
      diagnosticFee: 149,
      hourlyRate: 110,
      calculate(items) {
        return {
          total: this.diagnosticFee,
          range: { low: 149, high: 3000 },
          breakdown: [
            { label: 'Diagnostic service call', amount: this.diagnosticFee },
            { label: 'Repair estimate (on-site)', amount: 0 },
          ],
        };
      },
    },

    questions: {
      discovery: [
        { id: 'jobType', ask: 'Is this a repair, an upgrade, or are you experiencing an emergency?', extract: /(repair|upgrade|emergency|install|fix)/i },
        { id: 'symptoms', ask: 'What are you experiencing — flickering lights, tripping breaker, or no power to an area?', extract: /(flicker|trip|breaker|no.power|spark|warm|buzz)/i },
      ],
      scope: [
        { id: 'breakerBehavior', ask: 'Is the breaker tripping immediately when reset, or after some time?', extract: /(immediate|after|time|right away|trips)/i },
        { id: 'safetyConcern', ask: 'Are you noticing any burning smells, heat, or sparking?', extract: /(yes|burn|smell|spark|heat|warm|no)/i },
      ],
      scheduling: [
        { id: 'urgency', ask: 'Given the symptoms, how urgent would you say this is?', extract: /(urgent|emergency|today|tomorrow|week|can wait)/i },
      ],
    },
  },

  concrete: {
    id: 'concrete',
    displayName: 'Concrete',
    industries: ['construction', 'home-services'],
    classificationKeywords: [
      'concrete', 'driveway', 'patio', 'slab', 'pour',
      'sidewalk', 'foundation', 'crack', 'sinking', 'stamped',
    ],

    scopeSchema: {
      required: ['jobType', 'squareFeet'],
      recommended: ['finish', 'reinforcement', 'access', 'timeline'],
      optional: ['existingRemoval', 'drainage', 'budget'],
    },

    jobTypes: ['install', 'replace', 'repair', 'resurface'],

    pricing: {
      strategy: 'perSquareFoot',
      concretePerSqft: 8,
      laborPerSqft: 4,
      removalPerSqft: 3,
      reinforcementPerSqft: 2,
      overheadPercent: 0.10,
      calculate(items) {
        const { squareFeet, finish, existingRemoval, reinforcement } = items;
        const sqft = squareFeet || 400;
        const finishMul = finish === 'stamped' ? 1.5 : finish === 'exposed aggregate' ? 1.3 : 1.0;
        const matCost = this.concretePerSqft * sqft * finishMul;
        const labor = this.laborPerSqft * sqft;
        const removal = existingRemoval ? this.removalPerSqft * sqft : 0;
        const rebar = reinforcement ? this.reinforcementPerSqft * sqft : 0;
        const subtotal = matCost + labor + removal + rebar;
        const overhead = Math.round(subtotal * this.overheadPercent);
        const total = subtotal + overhead;

        return {
          total,
          range: { low: Math.round(total * 0.88), high: Math.round(total * 1.12) },
          breakdown: [
            { label: `Concrete (${sqft} sqft, ${finish || 'standard'})`, amount: matCost },
            { label: `Labor (${sqft} sqft)`, amount: labor },
            { label: 'Removal & disposal', amount: removal },
            { label: 'Reinforcement', amount: rebar },
            { label: 'Overhead (10%)', amount: overhead },
          ],
        };
      },
    },

    questions: {
      discovery: [
        { id: 'jobType', ask: 'Is this a new concrete installation, a replacement, or a repair?', extract: /(new|install|replace|repair|resurface|crack)/i },
        { id: 'squareFeet', ask: 'Approximately how many square feet is the area?', extract: /(\d+)\s*(?:sq|square|feet|ft)/i },
      ],
      scope: [
        { id: 'finish', ask: 'What type of finish — smooth, stamped, or exposed aggregate?', extract: /(smooth|stamp|aggregate|broom|finish)/i },
        { id: 'existingRemoval', ask: 'Is there existing concrete that needs to be removed first?', extract: /(yes|existing|remove|tear|old)/i },
        { id: 'access', ask: 'Can a concrete truck access the pour site?', extract: /(yes|no|truck|access|pump)/i },
        { id: 'reinforcement', ask: 'Do you need rebar or wire mesh reinforcement?', extract: /(yes|rebar|wire|mesh|reinforce|no)/i },
      ],
      scheduling: [
        { id: 'timeline', ask: 'What\'s your timeline for this project?', extract: /(week|month|soon|spring|summer)/i },
      ],
    },
  },
};

module.exports = SERVICE_CATALOG;
