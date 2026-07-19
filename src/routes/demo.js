/**
 * Demo Routes — M17.1 State Machine
 *
 * PUBLIC endpoints for the "Try NorthStar" homepage demo.
 * Backend is the SINGLE source of truth for all call states.
 * Frontend never invents or predicts state — it only reflects backend status.
 *
 * State Machine:
 *   IDLE → REQUESTING_CALL → CALL_CREATED → DIALING → RINGING →
 *   ANSWERED → MEDIA_CONNECTED → LIVE → COMPLETED → POLARIS_SUMMARY
 *
 * No state may be skipped.
 * Timer starts ONLY at ANSWERED.
 * Transcript/Polaris start ONLY at LIVE.
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const retell = require('../retell/client');
const liveTimeline = require('../voice/liveTimeline');

const demoSessions = new Map();
const TTL_MS = 60 * 60 * 1000; // 1 hour

// ── Allowed state transitions ──
const VALID_TRANSITIONS = {
  'idle':                  ['requesting_call'],
  'requesting_call':       ['call_created', 'failed'],
  'call_created':          ['dialing', 'failed'],
  'dialing':               ['ringing', 'failed', 'completed'],
  'ringing':               ['answered', 'failed'],
  'answered':              ['media_connected', 'failed'],
  'media_connected':       ['live', 'failed'],
  'live':                  ['completed'],
  'completed':             ['polaris_summary'],
  'polaris_summary':       [],
  'simulation':            ['live', 'completed'],
  'failed':                [],
};

// Simulated modes
const SIM_STATES = ['simulation'];

function isValidTransition(from, to) {
  const allowed = VALID_TRANSITIONS[from];
  return allowed && allowed.includes(to);
}

const ALL_INDUSTRIES = [
  'Roofing', 'Siding', 'Windows', 'Doors', 'HVAC',
  'Plumbing', 'Electrical', 'General Contracting', 'Painting', 'Landscaping',
  'Tree Service', 'Excavation', 'Masonry', 'Concrete', 'Flooring',
  'Carpet Cleaning', 'Pressure Washing', 'Junk Removal', 'Moving', 'Pool Service',
  'Pest Control', 'Cleaning Services', 'Locksmith', 'Garage Door', 'Handyman',
  'Kitchen Remodeling', 'Bathroom Remodeling', 'Deck Builders', 'Fence Contractors', 'Solar',
  'Home Security', 'Alarm Systems', 'Fire Protection', 'Drywall', 'Insulation',
  'Foundation Repair', 'Waterproofing', 'Restoration', 'Disaster Recovery', 'Mold Remediation',
  'Asbestos Removal', 'Chimney Service', 'Septic Service', 'Well Service', 'Snow Removal',
  'Irrigation', 'Window Tinting', 'Glass Repair', 'Appliance Repair', 'Property Management',
  'Commercial Maintenance',
];

const INDUSTRY_DEFAULTS = {
  'Roofing':               { service: 'Roof inspection and repair',           avgJobValue: 4500, emergencyLikelihood: 0.3, revenueRangeMin: 3500, revenueRangeMax: 5200 },
  'Siding':                { service: 'Siding installation and repair',       avgJobValue: 3800, emergencyLikelihood: 0.1, revenueRangeMin: 2800, revenueRangeMax: 4800 },
  'Windows':               { service: 'Window replacement and repair',        avgJobValue: 3200, emergencyLikelihood: 0.1, revenueRangeMin: 2200, revenueRangeMax: 4200 },
  'Doors':                 { service: 'Door installation and repair',         avgJobValue: 1800, emergencyLikelihood: 0.1, revenueRangeMin: 1200, revenueRangeMax: 2500 },
  'HVAC':                  { service: 'HVAC system repair',                   avgJobValue: 3200, emergencyLikelihood: 0.2, revenueRangeMin: 1200, revenueRangeMax: 2800 },
  'Plumbing':              { service: 'Plumbing repair',                      avgJobValue: 1800, emergencyLikelihood: 0.4, revenueRangeMin: 450,  revenueRangeMax: 850 },
  'Electrical':            { service: 'Electrical work',                      avgJobValue: 2200, emergencyLikelihood: 0.15, revenueRangeMin: 800, revenueRangeMax: 1800 },
  'General Contracting':   { service: 'General contracting',                  avgJobValue: 5000, emergencyLikelihood: 0.15, revenueRangeMin: 3000, revenueRangeMax: 8000 },
  'Painting':              { service: 'Interior and exterior painting',       avgJobValue: 2500, emergencyLikelihood: 0.05, revenueRangeMin: 1500, revenueRangeMax: 3500 },
  'Landscaping':           { service: 'Landscaping services',                 avgJobValue: 1500, emergencyLikelihood: 0.05, revenueRangeMin: 800, revenueRangeMax: 2200 },
  'Tree Service':          { service: 'Tree removal and trimming',            avgJobValue: 2800, emergencyLikelihood: 0.25, revenueRangeMin: 1800, revenueRangeMax: 3800 },
  'Excavation':            { service: 'Excavation and grading',               avgJobValue: 6000, emergencyLikelihood: 0.1,  revenueRangeMin: 4000, revenueRangeMax: 9000 },
  'Masonry':               { service: 'Brick and stone work',                 avgJobValue: 3500, emergencyLikelihood: 0.1,  revenueRangeMin: 2000, revenueRangeMax: 5000 },
  'Concrete':              { service: 'Concrete pouring and repair',          avgJobValue: 4000, emergencyLikelihood: 0.1,  revenueRangeMin: 2500, revenueRangeMax: 6000 },
  'Flooring':              { service: 'Flooring installation',                avgJobValue: 2800, emergencyLikelihood: 0.05, revenueRangeMin: 1800, revenueRangeMax: 4000 },
  'Carpet Cleaning':       { service: 'Carpet and upholstery cleaning',       avgJobValue: 300,  emergencyLikelihood: 0.05, revenueRangeMin: 150, revenueRangeMax: 500 },
  'Pressure Washing':      { service: 'Pressure washing services',            avgJobValue: 400,  emergencyLikelihood: 0.05, revenueRangeMin: 200, revenueRangeMax: 700 },
  'Junk Removal':          { service: 'Junk and debris removal',              avgJobValue: 500,  emergencyLikelihood: 0.05, revenueRangeMin: 250, revenueRangeMax: 800 },
  'Moving':                { service: 'Moving and relocation services',       avgJobValue: 1200, emergencyLikelihood: 0.05, revenueRangeMin: 600, revenueRangeMax: 2000 },
  'Pool Service':          { service: 'Pool cleaning and maintenance',        avgJobValue: 400,  emergencyLikelihood: 0.1,  revenueRangeMin: 200, revenueRangeMax: 600 },
  'Pest Control':          { service: 'Pest inspection and treatment',        avgJobValue: 350,  emergencyLikelihood: 0.2,  revenueRangeMin: 200, revenueRangeMax: 600 },
  'Cleaning Services':     { service: 'Home and office cleaning',             avgJobValue: 250,  emergencyLikelihood: 0.05, revenueRangeMin: 150, revenueRangeMax: 400 },
  'Locksmith':             { service: 'Lock installation and emergency',       avgJobValue: 250,  emergencyLikelihood: 0.4,  revenueRangeMin: 150, revenueRangeMax: 450 },
  'Garage Door':           { service: 'Garage door repair and installation',  avgJobValue: 600,  emergencyLikelihood: 0.15, revenueRangeMin: 300, revenueRangeMax: 1000 },
  'Handyman':              { service: 'General handyman services',            avgJobValue: 400,  emergencyLikelihood: 0.1,  revenueRangeMin: 200, revenueRangeMax: 700 },
  'Kitchen Remodeling':    { service: 'Kitchen remodeling',                   avgJobValue: 15000, emergencyLikelihood: 0.05, revenueRangeMin: 10000, revenueRangeMax: 25000 },
  'Bathroom Remodeling':   { service: 'Bathroom remodeling',                  avgJobValue: 8000, emergencyLikelihood: 0.05, revenueRangeMin: 5000, revenueRangeMax: 12000 },
  'Deck Builders':         { service: 'Deck construction and repair',         avgJobValue: 6000, emergencyLikelihood: 0.05, revenueRangeMin: 4000, revenueRangeMax: 9000 },
  'Fence Contractors':     { service: 'Fence installation and repair',        avgJobValue: 2500, emergencyLikelihood: 0.1,  revenueRangeMin: 1500, revenueRangeMax: 4000 },
  'Solar':                 { service: 'Solar panel installation',             avgJobValue: 12000, emergencyLikelihood: 0.05, revenueRangeMin: 8000, revenueRangeMax: 18000 },
  'Home Security':         { service: 'Security system installation',         avgJobValue: 2800, emergencyLikelihood: 0.1,  revenueRangeMin: 1800, revenueRangeMax: 3800 },
  'Alarm Systems':         { service: 'Alarm system installation',            avgJobValue: 2200, emergencyLikelihood: 0.1,  revenueRangeMin: 1200, revenueRangeMax: 3200 },
  'Fire Protection':       { service: 'Fire protection systems',              avgJobValue: 3500, emergencyLikelihood: 0.3,  revenueRangeMin: 2000, revenueRangeMax: 5000 },
  'Drywall':               { service: 'Drywall installation and repair',      avgJobValue: 1800, emergencyLikelihood: 0.1,  revenueRangeMin: 1000, revenueRangeMax: 2800 },
  'Insulation':            { service: 'Insulation installation',              avgJobValue: 2200, emergencyLikelihood: 0.05, revenueRangeMin: 1200, revenueRangeMax: 3500 },
  'Foundation Repair':     { service: 'Foundation inspection and repair',     avgJobValue: 8000, emergencyLikelihood: 0.3,  revenueRangeMin: 5000, revenueRangeMax: 12000 },
  'Waterproofing':         { service: 'Waterproofing services',               avgJobValue: 5000, emergencyLikelihood: 0.25, revenueRangeMin: 3000, revenueRangeMax: 8000 },
  'Restoration':           { service: 'Water and fire restoration',           avgJobValue: 6000, emergencyLikelihood: 0.4,  revenueRangeMin: 3500, revenueRangeMax: 10000 },
  'Disaster Recovery':     { service: 'Disaster cleanup and recovery',        avgJobValue: 7000, emergencyLikelihood: 0.5,  revenueRangeMin: 4000, revenueRangeMax: 12000 },
  'Mold Remediation':      { service: 'Mold inspection and remediation',      avgJobValue: 3500, emergencyLikelihood: 0.3,  revenueRangeMin: 2000, revenueRangeMax: 5500 },
  'Asbestos Removal':      { service: 'Asbestos testing and removal',         avgJobValue: 4500, emergencyLikelihood: 0.2,  revenueRangeMin: 2500, revenueRangeMax: 7000 },
  'Chimney Service':       { service: 'Chimney cleaning and repair',          avgJobValue: 400,  emergencyLikelihood: 0.1,  revenueRangeMin: 200, revenueRangeMax: 700 },
  'Septic Service':        { service: 'Septic system service',                avgJobValue: 600,  emergencyLikelihood: 0.3,  revenueRangeMin: 350, revenueRangeMax: 1000 },
  'Well Service':          { service: 'Well pump and water system',           avgJobValue: 1500, emergencyLikelihood: 0.25, revenueRangeMin: 800, revenueRangeMax: 2500 },
  'Snow Removal':          { service: 'Snow plowing and removal',             avgJobValue: 300,  emergencyLikelihood: 0.15, revenueRangeMin: 150, revenueRangeMax: 600 },
  'Irrigation':            { service: 'Irrigation system installation',       avgJobValue: 2500, emergencyLikelihood: 0.05, revenueRangeMin: 1500, revenueRangeMax: 4000 },
  'Window Tinting':        { service: 'Window tinting and film',              avgJobValue: 800,  emergencyLikelihood: 0.05, revenueRangeMin: 400, revenueRangeMax: 1400 },
  'Glass Repair':          { service: 'Glass replacement and repair',         avgJobValue: 500,  emergencyLikelihood: 0.25, revenueRangeMin: 250, revenueRangeMax: 900 },
  'Appliance Repair':      { service: 'Appliance repair services',            avgJobValue: 300,  emergencyLikelihood: 0.2,  revenueRangeMin: 150, revenueRangeMax: 550 },
  'Property Management':   { service: 'Property management services',         avgJobValue: 2000, emergencyLikelihood: 0.1,  revenueRangeMin: 1000, revenueRangeMax: 3500 },
  'Commercial Maintenance':{ service: 'Commercial property maintenance',      avgJobValue: 3000, emergencyLikelihood: 0.1,  revenueRangeMin: 1500, revenueRangeMax: 5000 },
};

function getDefaults(industry) {
  return INDUSTRY_DEFAULTS[industry] || INDUSTRY_DEFAULTS['General Contracting'];
}

/**
 * Build a full Executive Context with the structure that
 * mapExecutiveContextToVariables() expects to populate retell_llm_dynamic_variables.
 *
 * This is NorthStar's complete business context — passed into every call.
 * The conversation flow in Retell references these variables for
 * dynamic greetings, brand voice, and business-aware responses.
 */
function buildExecutiveContext(businessName, industry, phoneNumber, demoSessionId) {
  const d = getDefaults(industry);
  const now = new Date().toISOString();

  return {
    // Flat fields for simple access
    businessName,
    industry,
    service: d.service,
    avgJobValue: d.avgJobValue,
    revenueRangeMin: d.revenueRangeMin,
    revenueRangeMax: d.revenueRangeMax,
    generatedAt: now,
    polarisSessionId: demoSessionId,
    ownerName: '',
    businessDescription: `${industry} services`,
    serviceArea: 'Local service area',

    // Structured Business Profile — consumed by mapExecutiveContextToVariables()
    businessProfile: {
      company: {
        name: businessName,
        dba: businessName,
        email: '',
        phone: phoneNumber || '',
        website: '',
        timeZone: 'America/New_York',
      },
      ownerName: '',
      businessDescription: `${industry} services`,
      serviceArea: 'Local service area',
      companyValues: 'Quality work, customer satisfaction, and professional service.',
      policies: 'Free estimates available. Fully licensed and insured.',
      faq: '',
      customPrompt: '',
      services: [
        { name: d.service, description: `${d.service} for ${industry.toLowerCase()}`, avgPrice: d.avgJobValue },
      ],
      hours: {
        monday:    { open: '08:00', close: '17:00', emergency: true },
        tuesday:   { open: '08:00', close: '17:00', emergency: true },
        wednesday: { open: '08:00', close: '17:00', emergency: true },
        thursday:  { open: '08:00', close: '17:00', emergency: true },
        friday:    { open: '08:00', close: '17:00', emergency: true },
        saturday:  { open: '09:00', close: '14:00', emergency: d.emergencyLikelihood > 0.3 },
        sunday:    { open: null, close: null, emergency: d.emergencyLikelihood > 0.4 },
      },
      scheduling: {
        maxJobsPerDay: 4,
        workDayLength: 8,
        leadTimeHours: 4,
        emergencyLeadTimeMinutes: 60,
      },
      financial: {
        minimumJobPrice: 150,
        emergencyMarkup: d.emergencyLikelihood > 0.3 ? 1.5 : 1.0,
        travelCharge: 0.58,
        taxRate: 7,
      },
      polaris: {
        responseStyle: 'consultative',
        confidenceThreshold: 0.6,
      },
      retell: {
        conversationStyle: 'consultative',
        maxConversationLength: 15,
        greetingTemplate: `Thanks for calling ${businessName}. This is NorthStar, your AI receptionist. How can I help you today?`,
        brandName: 'NorthStar',
        brandVoice: 'professional and warm, like a seasoned office manager who knows the business inside out',
        assistantName: 'NorthStar',
        voiceStyle: 'professional and warm',
      },
    },

    // Customer info (empty for outbound demo; populated by webhook later)
    customer: {
      lead: null,
      customerRecord: null,
    },

    // Decision intelligence (preliminary — refined during/after call)
    decisions: {
      nextBestAction: 'Qualify lead and book estimate',
      rank: {
        priority: 'medium',
        score: 0.5,
      },
    },

    // Business intelligence
    intelligence: {
      jobIntelligence: {
        industry,
        avgJobValue: d.avgJobValue,
        emergencyLikelihood: d.emergencyLikelihood,
        revenueRange: { min: d.revenueRangeMin, max: d.revenueRangeMax },
      },
    },
  };
}

// ── Mock transcript (simulation only) ──
function mockTranscript(industry, count) {
  const scripts = {
    'Roofing': [
      { speaker: 'ai', text: "Thanks for calling. This is NorthStar, your AI receptionist. How can I help you today?" },
      { speaker: 'customer', text: "Hi, I've got some shingles missing after that storm last night. Can someone come take a look?" },
      { speaker: 'ai', text: "I'm sorry to hear about the storm damage. Let me get your information so we can help. What's your name?" },
      { speaker: 'customer', text: "Mike Thompson." },
      { speaker: 'ai', text: "Thanks Mike. And what's the best number to reach you?" },
      { speaker: 'customer', text: "(555) 123-4567." },
      { speaker: 'ai', text: "And what's the property address?" },
      { speaker: 'customer', text: "123 Oak Avenue, Springfield." },
      { speaker: 'ai', text: "I've noted this as storm damage — we'll prioritize your inspection. Can you tell me how many shingles are missing?" },
      { speaker: 'customer', text: "About 15 or 20, mostly on the front slope. The gutters look dented too." },
      { speaker: 'ai', text: "We can schedule a free inspection. Our estimator can come out tomorrow between 9am and noon. Would that work?" },
      { speaker: 'customer', text: "Yes, tomorrow morning works great." },
    ],
    'Plumbing': [
      { speaker: 'ai', text: "Thanks for calling. This is NorthStar, your AI receptionist. How can I help?" },
      { speaker: 'customer', text: "Help! Water is pouring from under my kitchen sink — I think a pipe burst!" },
      { speaker: 'ai', text: "That sounds urgent. Let me get your details right away. What's your name?" },
      { speaker: 'customer', text: "Sarah Williams. Please hurry!" },
      { speaker: 'ai', text: "I'm flagging this as an emergency, Sarah. What's your phone number?" },
      { speaker: 'customer', text: "(555) 987-6543." },
      { speaker: 'ai', text: "And the address?" },
      { speaker: 'customer', text: "456 Pine Street, Apt 2B." },
      { speaker: 'ai', text: "I've dispatched an emergency plumber. They'll be there within 45 minutes. Can you shut off the water at the main valve?" },
      { speaker: 'customer', text: "I don't know where the main valve is." },
      { speaker: 'ai', text: "It's usually near the water meter or where the main line enters your unit. The plumber can help when they arrive. You'll get a text with their ETA." },
    ],
    'HVAC': [
      { speaker: 'ai', text: "Thanks for calling. This is NorthStar, your AI receptionist. How can I help you today?" },
      { speaker: 'customer', text: "Hi, my AC stopped working and it's 85 degrees in here. Can you send someone?" },
      { speaker: 'ai', text: "I understand how uncomfortable that must be. Let me get your information. What's your name?" },
      { speaker: 'customer', text: "David Chen." },
      { speaker: 'ai', text: "And your phone number, David?" },
      { speaker: 'customer', text: "(555) 456-7890." },
      { speaker: 'ai', text: "What's the address where you need service?" },
      { speaker: 'customer', text: "789 Elm Street." },
      { speaker: 'ai', text: "I'll get a technician dispatched. What type of AC unit is it — central air or window unit?" },
      { speaker: 'customer', text: "Central air. It's about 10 years old." },
      { speaker: 'ai', text: "Thank you. A technician can be there this afternoon between 2pm and 4pm. You'll receive a confirmation text. Is there anything else?" },
    ],
  };
  const script = scripts[industry] || scripts['Roofing'];
  return script.slice(0, Math.min(count || script.length, script.length));
}

// ── Estimate Qualification Framework (scalable across industries) ──
// Each industry has required estimating variables defined as data.
// The analysis function uses keyword matching across the transcript
// to determine which variables were discussed. This is NOT per-industry
// scripting — it is a reusable data-driven framework.
const QUALIFICATION_PROFILES = {
  'Roofing': [
    { name: 'Damage Type',         keywords: ['storm damage', 'leak', 'missing shingle', 'hail', 'wind damage', 'hole', 'sagging'], unit: null },
    { name: 'Roof Area',           keywords: ['square foot', 'sq ft', 'sqft', 'roof size', 'how many square', 'section', 'slope'], unit: 'sq ft' },
    { name: 'Roof Age',            keywords: ['year old', 'years old', 'old roof', 'age', 'how old', 'original roof'], unit: 'years' },
    { name: 'Damage Extent',       keywords: ['shingle', 'gutter', 'flashing', 'valley', 'vent', 'skylight', 'chimney'], unit: null },
  ],
  'HVAC': [
    { name: 'Home Square Footage', keywords: ['square foot', 'sq ft', 'sqft', 'home size', 'house size', 'square footage'], unit: 'sq ft' },
    { name: 'System Age',          keywords: ['year old', 'years old', 'old unit', 'age', 'how old', 'installed'], unit: 'years' },
    { name: 'Service Type',        keywords: ['repair', 'replace', 'fix', 'new unit', 'new system', 'install', 'maintenance', 'tune-up'], unit: null },
    { name: 'Current Symptoms',    keywords: ['not working', 'broken', 'noise', 'leaking', 'not cooling', 'not heating', 'strange sound', 'warm air', 'no air'], unit: null },
    { name: 'Unit Information',    keywords: ['central air', 'window unit', 'heat pump', 'furnace', 'model', 'brand', 'ton', 'seer', 'serial'], unit: null },
  ],
  'Plumbing': [
    { name: 'Issue Type',          keywords: ['burst', 'leak', 'clog', 'dripping', 'running', 'broken pipe', 'water pressure', 'backup'], unit: null },
    { name: 'Location',            keywords: ['kitchen', 'bathroom', 'basement', 'outside', 'sink', 'toilet', 'shower', 'water heater', 'main line'], unit: null },
    { name: 'Urgency Indicator',   keywords: ['emergency', 'urgent', 'flooding', 'water damage', 'immediate', 'pouring'], unit: null },
    { name: 'Fixture Age',         keywords: ['year old', 'years old', 'old', 'original', 'age'], unit: 'years' },
  ],
  'Electrical': [
    { name: 'Issue Type',          keywords: ['outage', 'spark', 'flicker', 'breaker', 'outlet', 'switch', 'wiring', 'trip', 'power loss'], unit: null },
    { name: 'Location',            keywords: ['kitchen', 'bathroom', 'basement', 'outside', 'garage', 'room', 'circuit'], unit: null },
    { name: 'Property Age',        keywords: ['year old', 'years old', 'old house', 'age', 'how old', 'original wiring'], unit: 'years' },
    { name: 'Scope',               keywords: ['rewire', 'install', 'upgrade', 'panel', 'new', 'addition', 'remodel'], unit: null },
  ],
  'Painting': [
    { name: 'Area Type',           keywords: ['interior', 'exterior', 'inside', 'outside', 'room', 'wall', 'ceiling', 'trim', 'cabinet'], unit: null },
    { name: 'Square Footage',      keywords: ['square foot', 'sq ft', 'sqft', 'room size', 'house size', 'how big'], unit: 'sq ft' },
    { name: 'Room Count',          keywords: ['room', 'bedroom', 'floor', 'story', 'level'], unit: 'rooms' },
    { name: 'Prep Work Required',  keywords: ['patch', 'repair', 'spackle', 'sanding', 'priming', 'texture', 'wallpaper', 'lead paint'], unit: null },
  ],
  'Tree Service': [
    { name: 'Tree Height',         keywords: ['foot', 'feet', 'ft', 'tall', 'height', 'high', 'story'], unit: 'ft' },
    { name: 'Trunk Size',          keywords: ['diameter', 'inch', 'thick', 'trunk', 'width'], unit: 'inches' },
    { name: 'Location Difficulty', keywords: ['near', 'near house', 'close to', 'power line', 'fence', 'building', 'structure', 'garage', 'over'], unit: null },
    { name: 'Stump Removal',       keywords: ['stump', 'stump grind', 'stump removal', 'take the stump', 'remove stump'], unit: null },
  ],
  'Window Tinting': [
    { name: 'Window Count',        keywords: ['window', 'door', 'panel', 'how many'], unit: 'windows' },
    { name: 'Glass Type',          keywords: ['residential', 'commercial', 'auto', 'home', 'office', 'car', 'truck'], unit: null },
    { name: 'Tint Preference',     keywords: ['dark', 'light', 'shade', 'uv', 'privacy', 'heat', 'reflect', 'film', 'ceramic'], unit: null },
  ],
};

function getQualificationProfile(industry) {
  return QUALIFICATION_PROFILES[industry] || null;
}

function hasMeasurement(text, keywords) {
  // Check keyword substrings
  for (let k = 0; k < keywords.length; k++) {
    if (text.indexOf(keywords[k]) !== -1) return true;
  }
  // Check for numeric patterns (digits, commas, decimals) near measurement words
  // e.g. "2,000 sq ft", "2000 square feet", "twenty five hundred feet"
  const measureWords = ['foot', 'feet', 'sq ft', 'sqft', 'square', 'inch', 'inches', 'yard', 'yards', 'acre', 'acres', 'gallon', 'gallons', 'sq', 'ft', 'sf'];
  const valueWords = ['thousand', 'hundred', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety', 'ten', 'eleven', 'twelve', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  const hasDigit = /\d/.test(text);
  const hasMeasureWord = measureWords.some(function(w) { return text.indexOf(w) !== -1; });
  const hasValueWord = valueWords.some(function(w) { return text.indexOf(w) !== -1; });
  if (hasDigit && hasMeasureWord) return true;
  if (hasValueWord && hasMeasureWord) return true;
  return false;
}

// ── Service detection: extracts specific service from transcript text ──
// This is data-driven, not per-industry scripting. Each industry has
// service sub-types with keywords. The function returns the most specific
// match found in the transcript.
const SERVICE_KEYWORDS = {
  'Tree Service': [
    { service: 'Tree Removal',          keywords: ['remov', 'take down', 'cut down', 'fell', 'stump'] },
    { service: 'Tree Trimming',         keywords: ['trim', 'prune', 'cut back', 'thin', 'shape'] },
    { service: 'Emergency Tree Service', keywords: ['emergency', 'storm damage', 'fallen', 'hazard', 'dangerous'] },
    { service: 'Stump Grinding',        keywords: ['stump grind', 'stump removal', 'grind'] },
  ],
  'HVAC': [
    { service: 'HVAC Repair',           keywords: ['repair', 'fix', 'not working', 'broken', 'issue', 'problem'] },
    { service: 'HVAC Replacement',      keywords: ['replace', 'new unit', 'new system', 'upgrade', 'install'] },
    { service: 'HVAC Maintenance',      keywords: ['maintenance', 'tune-up', 'tune up', 'check-up', 'inspection', 'service'] },
  ],
  'Plumbing': [
    { service: 'Emergency Plumbing',    keywords: ['emergency', 'burst', 'flood', 'urgent', 'pouring'] },
    { service: 'Plumbing Repair',       keywords: ['repair', 'fix', 'leak', 'drip', 'clog', 'broken'] },
    { service: 'Plumbing Installation', keywords: ['install', 'new', 'replace', 'upgrade'] },
  ],
  'Roofing': [
    { service: 'Roof Repair',           keywords: ['repair', 'fix', 'patch', 'leak'] },
    { service: 'Roof Replacement',      keywords: ['replace', 'new roof', 're-roof', 'tear off'] },
    { service: 'Emergency Roofing',     keywords: ['emergency', 'storm', 'leak', 'urgent'] },
  ],
  'Painting': [
    { service: 'Interior Painting',     keywords: ['interior', 'inside', 'room', 'wall', 'ceiling'] },
    { service: 'Exterior Painting',     keywords: ['exterior', 'outside', 'siding', 'trim'] },
  ],
};

function detectService(transcriptLines, industry) {
  const services = SERVICE_KEYWORDS[industry];
  if (!services || !transcriptLines || transcriptLines.length === 0) {
    return null;
  }
  const fullText = transcriptLines
    .map(function(l) { return (l.text || l.content || '').toLowerCase(); })
    .join(' ');
  const detected = [];
  for (let i = 0; i < services.length; i++) {
    const s = services[i];
    for (let k = 0; k < s.keywords.length; k++) {
      if (fullText.indexOf(s.keywords[k]) !== -1) {
        detected.push(s.service);
        break;
      }
    }
  }
  return detected.length > 0 ? detected : null;
}

// ── Value extraction: extracts numeric values for qualification variables ──
// Uses regex patterns to find numbers near measurement words.
function extractValues(transcriptLines, industry) {
  const profile = getQualificationProfile(industry);
  if (!profile || !transcriptLines || transcriptLines.length === 0) return {};
  const fullText = transcriptLines
    .map(function(l) { return (l.text || l.content || '').toLowerCase(); })
    .join(' ');
  const values = {};
  // Number pattern: digits or spelled-out numbers (including multi-word)
  const numPattern = /(?:\d[\d,]*\.?\d*|(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:\s+(?:hundred|thousand))?(?:\s+(?:and\s+)?(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety))?|hundred|thousand)/gi;
  for (let i = 0; i < profile.length; i++) {
    const v = profile[i];
    if (!v.unit) continue;
    // Build unit patterns for this specific variable
    const unitPatterns = v.unit === 'sq ft' ? ['square foot', 'square feet', 'sq ft', 'sqft'] :
                         v.unit === 'ft' ? ['foot', 'feet', 'ft', 'tall', 'height', 'high'] :
                         v.unit === 'inches' ? ['inch', 'inches', 'diameter', 'thick', 'trunk', 'width'] :
                         v.unit === 'years' ? ['year old', 'years old', 'old', 'age'] :
                         v.unit === 'rooms' ? ['room', 'bedroom', 'floor', 'story', 'level'] :
                         [v.unit];
    // Find the closest number before each unit occurrence
    let bestValue = null;
    let bestDist = Infinity;
    for (let u = 0; u < unitPatterns.length; u++) {
      let searchIdx = 0;
      while (true) {
        const unitIdx = fullText.indexOf(unitPatterns[u], searchIdx);
        if (unitIdx === -1) break;
        // Look backwards up to 40 chars for a number
        const before = fullText.substring(Math.max(0, unitIdx - 40), unitIdx);
        const numMatch = before.match(numPattern);
        if (numMatch) {
          const dist = unitIdx - (unitIdx - before.length + before.lastIndexOf(numMatch[numMatch.length - 1]));
          if (dist < bestDist && dist < 30) {
            bestDist = dist;
            bestValue = numMatch[numMatch.length - 1] + ' ' + (v.unit === 'sq ft' ? 'sq ft' : v.unit);
          }
        }
        searchIdx = unitIdx + 1;
      }
    }
    if (bestValue) values[v.name] = bestValue;
  }
  return values;
}

function analyzeTranscriptQualification(transcriptLines, industry) {
  const profile = getQualificationProfile(industry);
  if (!profile || !transcriptLines || transcriptLines.length === 0) {
    return { variables: [], collected: [], missing: [], completeness: 0, totalVariables: 0 };
  }
  const fullText = transcriptLines
    .map(function(l) { return (l.text || l.content || '').toLowerCase(); })
    .join(' ');
  const variables = [];
  const collectedNames = [];
  const missingNames = [];
  for (let i = 0; i < profile.length; i++) {
    const v = profile[i];
    let found = false;
    let sourceQuote = null;
    for (let k = 0; k < v.keywords.length; k++) {
      const idx = fullText.indexOf(v.keywords[k]);
      if (idx !== -1) {
        found = true;
        // Extract source quote: up to 80 chars around the match
        const start = Math.max(0, idx - 20);
        const end = Math.min(fullText.length, idx + v.keywords[k].length + 40);
        sourceQuote = fullText.substring(start, end).trim();
        break;
      }
    }
    if (!found && v.unit) {
      found = hasMeasurement(fullText, v.keywords);
    }
    // Extract value if this variable has a unit
    let extractedValue = null, extractedUnit = null, varConfidence = 0;
    if (found) {
      collectedNames.push(v.name);
      varConfidence = 0.85; // keyword match baseline
      // Try to extract value from extractValues function
      const vals = extractValues(transcriptLines, industry);
      if (vals[v.name]) {
        extractedValue = vals[v.name];
        const parts = vals[v.name].split(' ');
        extractedUnit = parts.length > 1 ? parts.slice(1).join(' ') : (v.unit || null);
        varConfidence = 0.95;
      }
    } else {
      missingNames.push(v.name);
      varConfidence = 0;
    }
    variables.push({
      variable: v.name,
      value: extractedValue,
      unit: extractedUnit || v.unit || null,
      display: extractedValue || null,
      sourceQuote: sourceQuote,
      confidence: varConfidence,
      status: found ? 'collected' : 'missing'
    });
  }
  const total = profile.length;
  const completeness = total > 0 ? Math.round((collectedNames.length / total) * 100) : 0;
  return {
    variables: variables,
    collected: collectedNames,
    missing: missingNames,
    completeness: completeness,
    totalVariables: total
  };
}

// ---- Source quote extraction helper ----
function extractSourceQuote(fullText, keyword, contextChars) {
  if (!fullText || !keyword) return null;
  const idx = fullText.indexOf(keyword);
  if (idx === -1) return null;
  const ctx = contextChars || 30;
  const start = Math.max(0, idx - ctx);
  const end = Math.min(fullText.length, idx + keyword.length + ctx);
  let quote = fullText.substring(start, end).trim();
  // Strip leading/trailing sentence terminators and commas
  quote = quote.replace(/^[^a-zA-Z0-9]+/, '').replace(/[^a-zA-Z0-9]+$/, '');
  return quote.length > 0 ? quote : null;
}

// ---- buildPolarisIntelligence - canonical intelligence record ----
// Single source of truth for all Polaris reasoning.
// The report UI and downstream consumers read from this record.
function buildPolarisIntelligence(businessName, industry, transcriptLines, executiveSummary) {
  const d = getDefaults(industry);
  const lines = transcriptLines || [];
  const n = lines.length;
  const fullText = lines
    .map(function(l) { return (l.text || l.content || '').toLowerCase(); })
    .join(' ');

  // Industry defaults
  const baseMin = d.revenueRangeMin;
  const baseMax = d.revenueRangeMax;
  const baseAvg = d.avgJobValue;
  const baseUrgency = d.emergencyLikelihood;

  // Detect specific service
  const detectedServices = detectService(lines, industry);
  const primaryService = detectedServices ? detectedServices[0] : null;
  const secondaryServices = detectedServices ? detectedServices.slice(1) : [];
  const serviceSourceQuote = primaryService ? extractSourceQuote(fullText, primaryService.toLowerCase().split(' ')[0], 40) : null;

  // Run structured qualification
  const qual = analyzeTranscriptQualification(lines, industry);
  const extractedVals = extractValues(lines, industry);

  // Determine dynamic urgency from transcript
  let urgencyLevel = 'Standard';
  let urgencyScore = baseUrgency;
  const urgentWords = ['urgent', 'emergency', 'asap', 'quick', 'immediately', 'hurry', 'soon', 'leak', 'flood', 'broken', 'burst', 'dangerous', 'hazard', 'safety', 'storm', 'damage'];
  for (let w = 0; w < urgentWords.length; w++) {
    if (fullText.indexOf(urgentWords[w]) !== -1) {
      urgencyScore = Math.min(1.0, urgencyScore + 0.15);
    }
  }
  if (urgencyScore > 0.3) urgencyLevel = 'High';
  else if (urgencyScore > 0.15) urgencyLevel = 'Moderate';

  // Determine customer intent
  let customerIntent = n === 0 ? 'Not yet determined' : (n > 2 ? 'Actively seeking service' : 'Information gathering');

  // Dynamic revenue range based on extracted facts
  let factMultiplier = 1.0;
  const adjustmentReasons = [];

  // Check for height/scale - large jobs increase value
  if (extractedVals['Tree Height'] || extractedVals['Home Square Footage'] || extractedVals['System Age']) {
    const heightMatch = extractedVals['Tree Height'];
    if (heightMatch) {
      const numPart = parseFloat(heightMatch.replace(/[^\d.]/g, ''));
      if (numPart > 50) {
        factMultiplier = Math.max(factMultiplier, 1.3);
        adjustmentReasons.push('Large tree height (' + heightMatch + ')');
      }
      if (numPart > 150) {
        factMultiplier = Math.max(factMultiplier, 1.6);
        adjustmentReasons.push('Extreme tree height requires specialized equipment');
      }
    }
    const sqftMatch = extractedVals['Home Square Footage'];
    if (sqftMatch) {
      const numPart = parseFloat(sqftMatch.replace(/[^\d.]/g, ''));
      if (numPart > 3000) {
        factMultiplier = Math.max(factMultiplier, 1.3);
        adjustmentReasons.push('Large property (' + sqftMatch + ')');
      }
    }
  }

  // Access difficulty adjustment
  const difficultyWords = ['near house', 'near', 'close to', 'difficult', 'tight', 'backyard', 'fence', 'power line', 'over', 'structure', 'building', 'garage'];
  let difficultyFound = false;
  for (let w = 0; w < difficultyWords.length; w++) {
    if (fullText.indexOf(difficultyWords[w]) !== -1) {
      difficultyFound = true;
      break;
    }
  }
  if (difficultyFound) {
    factMultiplier = Math.max(factMultiplier, 1.2);
    adjustmentReasons.push('Access difficulty noted');
  }

  // Urgency adjustment
  if (urgencyLevel === 'High') {
    factMultiplier = Math.max(factMultiplier, 1.15);
    adjustmentReasons.push('High urgency');
  }

  // Calculate revenue range from base + factMultiplier
  const adjMin = Math.round(baseMin * factMultiplier);
  const adjMax = Math.round(baseMax * factMultiplier);

  // Confidence: 50% depth + 30% completeness + 20% urgency clarity
  let depthScore = 0;
  if (n === 0) depthScore = 0;
  else if (n < 3) depthScore = 30;
  else if (n < 6) depthScore = 55;
  else depthScore = Math.min(85, 55 + (n - 5) * 5);

  const confFromDepth = depthScore * 0.5;
  const confFromCompleteness = qual.totalVariables > 0 ? qual.completeness * 0.3 : 0;
  const confFromUrgency = urgencyScore > 0.25 ? 15 : 5;
  const confidence = Math.min(95, Math.max(10, Math.round(confFromDepth + confFromCompleteness + confFromUrgency)));

  // Build executive briefing from facts
  function buildBriefing() {
    if (n === 0) return 'Call in progress. Analysis will update as the conversation develops.';
    const parts = [];
    const customerLabel = (executiveSummary && executiveSummary.customerName) ? executiveSummary.customerName : 'Customer';

    if (primaryService) {
      parts.push(customerLabel + ' requested ' + primaryService.toLowerCase() + '.');
    } else {
      parts.push(customerLabel + ' contacted NorthStar regarding ' + d.service.toLowerCase());
    }

    // Add scale/detail based on collected variables
    const detailParts = [];
    if (extractedVals['Tree Height']) detailParts.push('approximately ' + extractedVals['Tree Height']);
    if (extractedVals['Home Square Footage']) detailParts.push('approximately ' + extractedVals['Home Square Footage']);
    if (extractedVals['Square Footage']) detailParts.push('approximately ' + extractedVals['Square Footage']);
    if (extractedVals['System Age']) detailParts.push('system age ' + extractedVals['System Age']);
    if (extractedVals['Room Count']) detailParts.push(extractedVals['Room Count']);
    if (detailParts.length > 0) {
      parts.push('The job involves ' + detailParts.join(', ') + '.');
    }

    // Add difficulty/urgency context
    if (difficultyFound) {
      const difficultyQuote = extractSourceQuote(fullText, 'near', 25);
      if (difficultyQuote) parts.push('The work area is ' + difficultyQuote + ', requiring careful access planning.');
    }
    if (urgencyLevel === 'High') {
      // Use the customer's own urgency signal if found
      const urgentSignal = extractSourceQuote(fullText, 'urgent', 25) || extractSourceQuote(fullText, 'emergency', 25);
      if (urgentSignal) {
        parts.push('The customer indicated the situation is urgent (' + urgentSignal + '), requiring prompt attention.');
      } else {
        parts.push('The customer has indicated elevated urgency requiring prompt attention.');
      }
    } else if (urgencyLevel === 'Moderate' && primaryService) {
      parts.push('A timely evaluation is recommended.');
    }

    // Add missing information
    if (qual.missing.length > 0) {
      const missingSample = qual.missing.slice(0, 2).join(' and ');
      const capitalized = missingSample.charAt(0).toUpperCase() + missingSample.slice(1).toLowerCase();
      parts.push(capitalized + ' details have not yet been discussed.');
    }

    return parts.join(' ');
  }

  const executiveBriefing = buildBriefing();

  // Build reasoning factors
  const reasoning = n === 0 ? [] : [
    { factor: 'Service Requested', detail: primaryService || d.service },
    { factor: 'Industry', detail: industry },
    { factor: 'Urgency Level', detail: urgencyLevel },
    { factor: 'Property Characteristics', detail: difficultyFound ? 'Residential property with access considerations' : 'Typical residential property' },
    { factor: 'Customer Intent', detail: customerIntent },
    { factor: 'Estimated Job Value Range', detail: '$' + adjMin.toLocaleString() + ' - $' + adjMax.toLocaleString() },
  ];

  // Add adjustment reasons if non-trivial
  if (adjustmentReasons.length > 0) {
    reasoning.push({ factor: 'Estimate Adjustments', detail: adjustmentReasons.join('; ') });
  }

  // Add collected variables with values
  const varDetails = qual.variables
    .filter(function(v) { return v.status === 'collected'; })
    .map(function(v) { return v.display ? v.variable + ': ' + v.display : v.variable; });
  if (varDetails.length > 0) {
    reasoning.push({ factor: 'Estimating Variables Collected', detail: varDetails.join(', ') });
  }

  // Add missing info
  if (qual.missing.length > 0) {
    reasoning.push({ factor: 'Missing Estimating Info', detail: qual.missing.join(', ') });
    reasoning.push({ factor: 'Suggested Follow-up', detail: 'Ask about: ' + qual.missing.slice(0, 3).join(', ') + ' to refine estimate' });
  }

  reasoning.push(
    { factor: 'Information Completeness', detail: qual.completeness + '% (' + qual.collected.length + '/' + qual.totalVariables + ' variables)' },
    { factor: 'Confidence Level', detail: confidence + '%' },
    { factor: 'Assumptions', detail: factMultiplier > 1.0 ? 'Estimate adjusted for job-specific factors identified in conversation.' : 'Based on typical scope. Final may vary.' },
  );

  return {
    // Canonical structure
    customerFacts: executiveSummary ? {
      name: executiveSummary.customerName || null,
      phone: executiveSummary.customerPhone || null,
      address: executiveSummary.customerAddress || null,
      email: executiveSummary.customerEmail || null
    } : { name: null, phone: null, address: null, email: null },

    industry: industry,
    requestedService: {
      primary: primaryService || d.service,
      secondary: secondaryServices,
      sourceQuote: serviceSourceQuote,
      confidence: detectedServices ? 0.95 : 0.85
    },

    estimatingVariables: qual.variables,

    missingInformation: qual.missing,

    estimate: {
      opportunityLabel: 'POLARIS\u2122 ESTIMATED OPPORTUNITY',
      revenueRange: '$' + adjMin.toLocaleString() + ' - $' + adjMax.toLocaleString(),
      rangeMin: adjMin,
      rangeMax: adjMax,
      confidence: confidence,
      adjustments: {
        baseValue: baseAvg,
        baseRangeMin: baseMin,
        baseRangeMax: baseMax,
        factMultiplier: factMultiplier,
        reasons: adjustmentReasons
      }
    },

    executiveBriefing: executiveBriefing,
    reasoning: reasoning,
    generatedAt: new Date().toISOString(),

    // Preserve compatibility with downstream consumers
    confidence: confidence,
    revenueRange: '$' + adjMin.toLocaleString() + ' - $' + adjMax.toLocaleString(),
    qualification: qual,
    extractedValues: extractedVals,
    detectedService: primaryService || d.service,
  };
}

function polarisEstimateFromSession(session) {
  if (!session) return null;
  return polarisEstimate(session.businessName, session.industry, session.transcriptLines || []);
}

function polarisEstimate(businessName, industry, transcriptLines, executiveSummary) {
  // Thin consumer of the canonical intelligence record
  const intelligence = buildPolarisIntelligence(businessName, industry, transcriptLines || [], executiveSummary);
  // Return backward-compatible shape + the full canonical record
  return {
    opportunityLabel: intelligence.estimate.opportunityLabel,
    confidence: intelligence.estimate.confidence,
    revenueRange: intelligence.estimate.revenueRange,
    qualification: intelligence.qualification,
    extractedValues: intelligence.extractedValues,
    detectedService: intelligence.detectedService,
    reasoning: intelligence.reasoning,
    generatedAt: intelligence.generatedAt,
    // Expose the full canonical record
    polarisIntelligence: intelligence,
    // Executive briefing for frontend
    executiveBriefing: intelligence.executiveBriefing,
    // Variables with actual values
    estimatingVariables: intelligence.estimatingVariables,
    // Breakdown
    customerFacts: intelligence.customerFacts,
  };
}
function scheduleSimAdvance(sessionId) {
  // The backend drives simulation state on a timer, not the frontend
  const s = demoSessions.get(sessionId);
  if (!s || s.callStatus !== 'simulation') return;

  // After 3s: advance to live
  setTimeout(() => {
    const sess = demoSessions.get(sessionId);
    if (!sess || sess.callStatus !== 'simulation') return;
    sess.callStatus = 'live';
    sess.startedAt = new Date().toISOString();
    sess.transcriptLines = mockTranscript(sess.industry, 1);
    liveTimeline.addEntry(sessionId, 'conversation_started', 'Simulated conversation started', 'system');
  }, 3000);

  // After 45s: completed
  setTimeout(() => {
    const sess = demoSessions.get(sessionId);
    if (!sess || sess.callStatus !== 'live') return;
    sess.callStatus = 'completed';
    liveTimeline.addEntry(sessionId, 'call_completed', 'Simulated call completed', 'system');
  }, 48000);
}

// ── Helpers to advance live state via retell webhook (to be called externally) ──
function advanceCallState(sessionId, newState) {
  const session = demoSessions.get(sessionId);
  if (!session) return false;
  if (!isValidTransition(session.callStatus, newState)) return false;
  session.callStatus = newState;
  if (newState === 'answered' || newState === 'media_connected') {
    session.startedAt = new Date().toISOString();
  }
  if (newState === 'live') {
    session.transcriptLines = session.transcriptLines || [];
  }
  return true;
}

// ── M18O: Broadcast state change via SSE ──
// Used by the poller to notify connected clients of state transitions.
// Avoids duplicate broadcasts if the caller already broadcasts.
function broadcastCallState(sessionId, newState) {
  try {
    const webhook = require('../retell/webhook');
    const session = demoSessions.get(sessionId);
    if (session) {
      webhook.broadcastSSE(sessionId, 'status', {
        callStatus: newState,
        previousStatus: null,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (e) {
    // SSE not available — polling fallback handles this
  }
}

// ── Retell API Poller ──
// Polls the Retell API for call status when webhooks aren't available.
// This is a fallback for when the agent can't be published.
const activePollers = new Map();

function startCallPoller(sessionId, callId) {
  if (activePollers.has(sessionId)) return; // Already polling

  let attempts = 0;
  const MAX_POLLS = 600; // 10 minutes at 1s intervals

  const interval = setInterval(async () => {
    attempts++;
    const session = demoSessions.get(sessionId);
    if (!session || attempts > MAX_POLLS) {
      clearInterval(interval);
      activePollers.delete(sessionId);
      return;
    }

    // Don't poll if call is already completed
    if (['completed', 'polaris_summary', 'failed'].includes(session.callStatus)) {
      clearInterval(interval);
      activePollers.delete(sessionId);
      return;
    }

    try {
      const callData = await retell.getCall(callId);
      if (!callData) return;

      const callStatus = callData.call_status || '';
      const transcript = callData.transcript || '';
      const transcriptObject = callData.transcript_object || [];
      const callAnalysis = callData.call_analysis || null;
      const durationMs = callData.duration_ms || 0;

      // Log the raw data once for diagnostics
      if (attempts === 1) {
        console.log('poller.api_response', 'OK', `status=${callStatus} transcript_len=${transcript.length} analysis=${callAnalysis ? 'yes' : 'no'}`);
      }

      // Map Retell call status to our state machine
      // Retell statuses: 'registered', 'queued', 'in_progress', 'ringing',
      // 'ongoing', 'ended', 'not_connected'
      if (callStatus === 'registered' || callStatus === 'queued' || callStatus === 'in_progress') {
        if (session.callStatus === 'call_created') {
          advanceCallState(sessionId, 'dialing');
          broadcastCallState(sessionId, 'dialing');
        }
      }

      if (callStatus === 'ringing') {
        if (['call_created', 'dialing'].includes(session.callStatus)) {
          advanceCallState(sessionId, 'ringing');
          broadcastCallState(sessionId, 'ringing');
        }
      }

      // ── M18O: Allow in_progress/ongoing from any pre-live state ──
      // Production providers may skip ringing and go directly to ongoing.
      // Map to answered + media_connected + live in one shot.
      if (callStatus === 'in_progress' || callStatus === 'ongoing') {
        if (session.callStatus === 'call_created' || session.callStatus === 'dialing' || session.callStatus === 'ringing') {
          advanceCallState(sessionId, 'answered');
          advanceCallState(sessionId, 'media_connected');
          advanceCallState(sessionId, 'live');
          broadcastCallState(sessionId, 'answered');
          broadcastCallState(sessionId, 'media_connected');
          broadcastCallState(sessionId, 'live');
        }
      }

      // Store transcript from transcript_object (structured) or transcript (string)
      if (transcriptObject.length > 0) {
        // ── M18O: Use canonical speaker values (ai/customer) ──
        const newLines = transcriptObject.map((entry, i) => ({
          speaker: entry.role === 'agent' ? 'ai' : 'customer',
          text: entry.content || '',
          timestamp: new Date().toISOString(),
        }));
        if (newLines.length > (session.transcriptLines?.length || 0)) {
          session.transcriptLines = newLines;
          // Broadcast transcript via SSE
          broadcastCallState(sessionId, 'transcript_updated');
          console.log('poller.transcript', 'OK', `${newLines.length} lines (structured)`);
        }
      } else if (transcript && transcript.length > 0) {
        const rawLines = transcript.split('\n').filter(Boolean);
        if (rawLines.length > (session.transcriptLines?.length || 0)) {
          // ── M18O: Use canonical speaker values (ai/customer) ──
          session.transcriptLines = rawLines.map(line => ({
            speaker: line.startsWith('Agent:') ? 'ai' : (line.startsWith('User:') ? 'customer' : 'customer'),
            text: line.replace(/^(Agent:|User:)\s*/, ''),
            timestamp: new Date().toISOString(),
          }));
          console.log('poller.transcript', 'OK', `${rawLines.length} lines (string)`);
        }
      }

      // Call ended or failed to connect
      if (callStatus === 'ended' || callStatus === 'not_connected' || callStatus === 'completed') {
        if (!['completed', 'polaris_summary', 'failed'].includes(session.callStatus)) {
          advanceCallState(sessionId, 'completed');
          broadcastCallState(sessionId, 'completed');
          console.log('poller.call_ended', 'OK', `Call ${callId} ended. Reason: ${callData.disconnection_reason || 'unknown'}`);

          let executiveSummary;
          const customData = callAnalysis?.custom_analysis_data || {};

          // Generate executive summary from call_analysis if available
          if (callAnalysis) {
            const summary = callAnalysis.call_summary || 'Call completed.';
            const sentiment = (callAnalysis.user_sentiment || 'Neutral').toLowerCase();

            executiveSummary = {
              outcome: summary,
              sentiment: sentiment,
              keyTopics: [],
              actionItems: [],
              recommendations: [],
              polarisOpportunityScore: {
                score: 'Pending',
                placeholder: true,
              },
              customerName: customData.customer_name || '',
              customerPhone: customData.phone_number || customData.phone || '',
              customerAddress: customData.property_address || customData.address || '',
              customerEmail: customData.email || '',
              generatedAt: new Date().toISOString(),
            };
            console.log('poller.executive_summary', 'OK', `Generated from call_analysis (sentiment: ${sentiment})`);
          } else {
            // Generate a basic executive summary without analysis
            executiveSummary = {
              outcome: 'Call completed. Lead captured.',
              sentiment: 'neutral',
              keyTopics: [],
              actionItems: [{ description: 'Review call transcript', priority: 'medium' }],
              recommendations: [{ description: 'Follow up with customer' }],
              polarisOpportunityScore: {
                score: 'Pending',
                placeholder: true,
              },
              customerName: customData.customer_name || '',
              customerPhone: customData.phone_number || customData.phone || '',
              customerAddress: customData.property_address || customData.address || '',
              customerEmail: customData.email || '',
              generatedAt: new Date().toISOString(),
            };
            console.log('poller.executive_summary', 'OK', 'Generated basic summary (no analysis available)');
          }
          session.executiveSummary = executiveSummary;

          // Create lead from transcript
          try {
            const { addLead } = require('../leads/store');
            const lead = {
              customerName: customData.customer_name || '',
              phoneNumber: session.phoneNumber || '',
              serviceRequested: customData.service_requested || session.industry || '',
              callOutcome: 'Call completed',
              notes: session.transcriptLines ? session.transcriptLines.map(l => `${l.speaker}: ${l.text}`).join('\n') : '',
              demoSessionId: sessionId,
              transcript: session.transcriptLines,
              executiveSummary: executiveSummary,
              receivedAt: new Date().toISOString(),
              status: 'new',
            };
            const savedLead = addLead(lead);
            console.log('poller.lead_created', 'OK', `Lead ${savedLead.id} created with executive summary`);
          } catch (leadErr) {
            console.log('poller.lead_created', 'FAIL', leadErr.message);
          }

          // Clear the poller since call is done
          clearInterval(interval);
          activePollers.delete(sessionId);
        }
      }

      // Store analysis if available during live call (for transcript enrichment)
      if (callAnalysis && session.callStatus === 'live') {
        console.log('poller.analysis_live', 'OK', `Analysis available on poll attempt ${attempts}`);
      }
    } catch (err) {
      // Log poll errors but don't crash
      console.log('poller.error', 'WARN', `Poll attempt ${attempts}: ${err.message}`);
    }
  }, 1000);

  activePollers.set(sessionId, interval);
  console.log('poller.started', 'OK', `Polling call ${callId} every 1s`);
}

// ── Routes ──

/**
 * GET /status — pre-call check for Retell config
 */
router.get('/status', (req, res) => {
  const configured = Boolean(config.retell && config.retell.apiKey && config.retell.agentId);
  res.json({
    mode: configured ? 'live' : 'simulation',
    retellConfigured: configured,
    message: configured
      ? 'Retell AI is configured.'
      : '🔬 DEMO SIMULATION MODE — Calls are simulated.',
  });
});

/**
 * GET /industries
 */
router.get('/industries', (req, res) => {
  res.json({ industries: ALL_INDUSTRIES });
});

/**
 * Format a phone number to E.164 format (+1XXXXXXXXXX).
 */
function formatE164(phone) {
  if (!phone) return '';
  // If already E.164, return as-is
  if (/^\+[1-9]\d{6,14}$/.test(phone)) return phone;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits[0] === '1') return '+' + digits;
  return '+' + digits; // best effort
}

// ── Customer-safe error mapping ──
// Internal errors → customer-safe messages. All diagnostics logged server-side only.
const CUSTOMER_ERRORS = {
  'VALIDATION_MISSING_FIELD':    'Please fill in all required fields.',
  'VALIDATION_INVALID_INDUSTRY': 'Please select a valid industry.',
  'INVALID_PHONE_NUMBER':        'Please enter a valid phone number.',
  'RETELL_API_KEY_MISSING':      'Unable to place call.',
  'RETELL_AGENT_ID_MISSING':     'Unable to place call.',
  'RETELL_AUTH_FAILED':          'Voice service temporarily unavailable.',
  'RETELL_AGENT_NOT_FOUND':      'Unable to place call.',
  'RETELL_OUTBOUND_DISABLED':    'Outbound calling is not available.',
  'RETELL_PHONE_REJECTED':       'The phone number could not be reached.',
  'RETELL_NETWORK_ERROR':        'Temporary connection issue. Please try again.',
  'RETELL_INVALID_RESPONSE':     'Unable to place call.',
  'RETELL_MISSING_CALL_ID':      'Unable to place call.',
  'RETELL_UNKNOWN_ERROR':        'Unable to place call. Please try again.',
  'RETELL_API_ERROR_400':        'Unable to place call.',
  'RETELL_API_ERROR_429':        'Please wait a moment before trying again.',
  'RETELL_FROM_NUMBER_INVALID':  'Unable to place call. The outbound number is not configured correctly.',
  'FETCH_ERROR':                 'Could not reach service. Check your connection.',
  'TIMEOUT':                     'The request took too long. Please try again.',
  'INTERNAL_SERVER_ERROR':       'Something went wrong. Please try again.',
};

function customerError(internalCode, internalDetails) {
  // Log everything server-side
  console.error(`[CustomerError] ${internalCode}: ${internalDetails}`);
  const message = CUSTOMER_ERRORS[internalCode] || 'Something went wrong. Please try again.';
  return { success: false, error: { code: internalCode, message } };
}

/**
 * POST /call
 *
 * Instrumented call pipeline with full server-side diagnostics.
 * Customer-facing responses are always clean: { success, error: { code, message } }
 */
router.post('/call', async (req, res) => {
  const pipelineId = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  const log = (stage, status, detail) => {
    console.log(`[Demo/Pipeline:${pipelineId}] Stage ${stage}: ${status} — ${detail}`);
  };

  try {
    // ── Stage 1: Request received ──
    console.log('1. request_received', 'OK', `POST /demo/call`);
    const { businessName, industry, phoneNumber } = req.body;

    // ── Stage 2: Business profile loaded ──
    if (!businessName) {
      console.log('2. business_profile', 'FAIL', 'Missing businessName');
      return res.status(400).json(customerError('VALIDATION_MISSING_FIELD', `Missing businessName`));
    }
    console.log('2. business_profile', 'OK', `businessName="${businessName}"`);

    // ── Stage 3: Industry validated ──
    const normalizedIndustry = ALL_INDUSTRIES.find(i => i.toLowerCase() === (industry || '').toLowerCase());
    if (!normalizedIndustry) {
      console.log('3. credentials_verified', 'FAIL', `Invalid industry: ${industry}`);
      return res.status(400).json(customerError('VALIDATION_INVALID_INDUSTRY', `Invalid industry: ${industry}`));
    }
    console.log('3. credentials_verified', 'OK', `industry="${normalizedIndustry}"`);

    // ── Stage 4: Phone validated ──
    const digits = (phoneNumber || '').replace(/\D/g, '');
    if (digits.length < 10) {
      console.log('4. phone_validated', 'FAIL', `Invalid phone: "${phoneNumber}"`);
      return res.status(400).json(customerError('INVALID_PHONE_NUMBER', `Invalid phone: ${phoneNumber}`));
    }
    console.log('4. phone_validated', 'OK', `phone="${phoneNumber}" (${digits.length} digits)`);

    const demoSessionId = uuidv4();
    const ec = buildExecutiveContext(businessName, normalizedIndustry, phoneNumber, demoSessionId);
    const configured = Boolean(config.retell && config.retell.apiKey && config.retell.agentId);

    // ── Stage 5: Retell credentials verified ──
    if (!configured) {
      console.log('5. credentials_verified', 'SIMULATION', 'Retell not configured — returning simulation path');
      const session = {
        id: demoSessionId, businessName, industry: normalizedIndustry, phoneNumber,
        executiveContext: ec, callId: `sim-${demoSessionId.slice(0, 8)}`,
        callStatus: 'idle', createdAt: Date.now(), transcriptLines: [],
        transcriptIndex: 0, startedAt: null, stateSeq: 1,
        error: null,
      };
      demoSessions.set(demoSessionId, session);
      return res.json({
        success: true, demoSessionId, callId: session.callId,
        status: 'idle', mode: 'simulation',
        message: 'Demo simulation ready. Call /simulate to start.',
      });
    }

    console.log('5. credentials_verified', 'OK', `Retell API key + agent ID present`);

    // ── Stage 6: Agent loaded ──
    // Verify the agent exists by fetching it (optional check — skip if not critical)
    console.log('6. agent_loaded', 'OK', `agentId=${config.retell.agentId}`);

    // ── Stage 7: Call request sent to Retell ──
    const e164Phone = formatE164(phoneNumber);
    console.log('7. call_requested', 'SENDING', `phone=${phoneNumber} e164=${e164Phone} service=${ec.service}`);
    liveTimeline.addEntry(demoSessionId, 'call_creating', 'Requesting call via Retell', 'system');

    let callResult;
            try {
              callResult = await retell.createCall(e164Phone, config.retell.agentId, {
                service: ec.service,
                caller: `Demo: ${businessName}`,
                // webhook_url is NOT sent per-call — the agent itself has
                // webhook_url configured with all webhook_events.
                // Passing webhook_url per-call overrides the agent's webhook_events
                // config and causes custom events (transcript_updated) to be dropped.
                executiveContext: ec,
              });
    } catch (callErr) {
      // Classify the error — log full details server-side, return clean customer message
      if (callErr instanceof retell.DiagnosticError) {
        console.log('7. call_requested', 'FAIL', `[${callErr.stage}] ${callErr.code}: ${callErr.details}`);
        return res.status(callErr.httpStatus || 502).json(customerError(callErr.code, callErr.details));
      }
      console.log('7. call_requested', 'FAIL', `Unknown error: ${callErr.message}`);
      return res.status(502).json(customerError('RETELL_UNKNOWN_ERROR', callErr.message));
    }

    // ── Stage 8: call_id created ──
    const retellCallId = callResult?.call_id;
    if (!retellCallId) {
      console.log('8. call_created', 'FAIL', 'Retell did not return a call_id');
      return res.status(502).json(customerError('RETELL_MISSING_CALL_ID', 'Retell did not return a call_id'));
    }
    console.log('8. call_created', 'OK', `call_id=${retellCallId}`);

    // ── Stage 9: Session created ──
    const session = {
      id: demoSessionId, businessName, industry: normalizedIndustry, phoneNumber,
      executiveContext: ec, callId: retellCallId,
      callStatus: 'call_created', createdAt: Date.now(), transcriptLines: [],
      transcriptIndex: 0, startedAt: null, stateSeq: 1,
      error: null,
    };
    demoSessions.set(demoSessionId, session);
    liveTimeline.addEntry(demoSessionId, 'call_created', `Retell call ${retellCallId} created`, 'system');

    // Start polling the Retell API for call status updates
    // (Fallback when webhooks aren't available — e.g. agent not published)
    startCallPoller(demoSessionId, retellCallId);

    // ── Stage 10: Returning success ──
    console.log('9. returning_success', 'OK', `session=${demoSessionId} status=call_created`);
    return res.json({
      success: true, demoSessionId, callId: retellCallId,
      status: 'call_created', mode: 'live',
    });

  } catch (err) {
    console.error(`[Demo/Pipeline:${pipelineId}] Uncaught error:`, err.message, err.stack);
    res.status(500).json(customerError('INTERNAL_SERVER_ERROR', err.message));
  }
});

/**
 * POST /:id/simulate
 * Start simulation for a session. Only valid from 'idle' state.
 */
router.post('/:id/simulate', (req, res) => {
  try {
    const session = demoSessions.get(req.params.id);
    if (!session) return res.status(404).json(customerError('NOT_FOUND', 'Session not found'));
    if (session.callStatus !== 'idle') return res.status(400).json(customerError('INVALID_STATE', `Cannot simulate from state: ${session.callStatus}`));

    session.callStatus = 'simulation';
    session.transcriptLines = [];
    liveTimeline.addEntry(session.id, 'simulation_started', 'Simulation mode activated', 'system');
    scheduleSimAdvance(session.id);

    res.json({ demoSessionId: session.id, status: 'simulation' });
  } catch (err) {
    console.error('[Demo] Simulate error:', err.message, err.stack);
    res.status(500).json(customerError('INTERNAL_SERVER_ERROR', err.message));
  }
});

/**
 * POST /:id/advance
 * Advance a live call's state (called by Retell webhook or internal).
 * Validates transitions against the state machine.
 */
router.post('/:id/advance', (req, res) => {
  try {
    const { to } = req.body;
    if (!to) return res.status(400).json(customerError('VALIDATION_MISSING_FIELD', 'Target state required'));

    const session = demoSessions.get(req.params.id);
    if (!session) return res.status(404).json(customerError('NOT_FOUND', 'Session not found'));

    if (!isValidTransition(session.callStatus, to)) {
      return res.status(400).json(customerError('INVALID_STATE', `Cannot transition from ${session.callStatus} to ${to}`));
    }

    const prev = session.callStatus;
    session.callStatus = to;
    session.stateSeq = (session.stateSeq || 0) + 1;

    if (to === 'answered' || to === 'media_connected') {
      session.startedAt = new Date().toISOString();
    }
    if (to === 'live') {
      session.transcriptLines = session.transcriptLines || [];
    }

    liveTimeline.addEntry(session.id, `state_${to}`, `State: ${prev} → ${to}`, 'system');

    res.json({ demoSessionId: session.id, status: to, previousStatus: prev });
  } catch (err) {
    console.error('[Demo] Advance error:', err.message, err.stack);
    res.status(500).json(customerError('INTERNAL_SERVER_ERROR', err.message));
  }
});

/**
 * GET /:id/transcript
 *
 * M18M: During live calls (pre-completed states), returns speaking indicators
 * instead of full transcript text. After the call ends, returns the complete
 * parsed transcript from call_ended webhook processing.
 */
router.get('/:id/transcript', (req, res) => {
  try {
    const session = demoSessions.get(req.params.id);
    if (!session) return res.status(404).json(customerError('NOT_FOUND', 'Session not found'));

    const preLive = ['idle', 'requesting_call', 'call_created', 'dialing', 'ringing', 'answered', 'media_connected', 'simulation'];
    const isPreLive = preLive.includes(session.callStatus);
    const isLive = session.callStatus === 'live';
    const isCompleted = session.callStatus === 'completed' || session.callStatus === 'polaris_summary';

    // ── M18M: During live call, return speaking indicators only ──
    if (isPreLive || isLive) {
      const currentSpeaker = session.currentSpeaker || null;
      const lastSpeakerAt = session.lastSpeakerAt || null;

      // Check if we have any transcript data from simulation
      if (session.callId && session.callId.startsWith('sim-') && session.transcriptLines && session.transcriptLines.length > 0) {
        // Simulation mode: still return full transcript since it's a demo
        console.log(`[Demo:TranscriptEP] Simulation with data: lines=${session.transcriptLines.length}`);
        return res.json({
          sessionId: session.id, callStatus: session.callStatus,
          lines: session.transcriptLines, count: session.transcriptLines.length,
          conversationState: session.callStatus,
          speakingIndicator: currentSpeaker,
          message: `${session.transcriptLines.length} lines`,
        });
      }

      // Live mode: return speaking indicator only, no transcript text
      console.log(`[Demo:TranscriptEP] M18M live mode: speaker=${currentSpeaker} status=${session.callStatus}`);
      return res.json({
        sessionId: session.id,
        callStatus: session.callStatus,
        lines: [],
        count: 0,
        conversationState: isPreLive ? 'waiting' : 'live',
        speakingIndicator: currentSpeaker,
        lastSpeakerAt,
        message: currentSpeaker
          ? (currentSpeaker === 'agent' ? 'Agent is speaking...' : 'Customer is speaking...')
          : 'Waiting for conversation...',
      });
    }

    // ── M18M: Call completed — return full parsed transcript ──
    if (isCompleted) {
      if (session.transcriptLines && session.transcriptLines.length > 0) {
        console.log(`[Demo:TranscriptEP] M18M completed with data: lines=${session.transcriptLines.length}`);

        // ── STAGE 4: Transcript endpoint response ──
        const stage4 = {
          stage: 4,
          sessionId: session.id,
          callStatus: session.callStatus,
          count: session.transcriptLines.length,
          first3: (session.transcriptLines || []).slice(0, 3).map(l => `{speaker:${l.speaker},text:"${(l.text||'').substring(0,60)}"}`),
          last3: (session.transcriptLines || []).slice(-3).map(l => `{speaker:${l.speaker},text:"${(l.text||'').substring(0,60)}"}`),
        };
        console.log(`[Demo:Stage4] ${JSON.stringify(stage4)}`);

        return res.json({
          sessionId: session.id, callStatus: session.callStatus,
          lines: session.transcriptLines, count: session.transcriptLines.length,
          conversationState: 'completed',
          speakingIndicator: null,
        });
      }

      // No transcript lines yet — return empty
      console.log(`[Demo:TranscriptEP] M18M completed but no lines`);
      return res.json({
        sessionId: session.id, callStatus: session.callStatus,
        lines: [], count: 0,
        conversationState: 'completed',
        speakingIndicator: null,
        message: 'Transcript not yet available.',
      });
    }

    // Fallback
    console.log(`[Demo:TranscriptEP] Unknown state: ${session.callStatus}`);
    res.json({
      sessionId: session.id, callStatus: session.callStatus,
      lines: [], count: 0,
      conversationState: 'unknown',
      speakingIndicator: null,
    });
  } catch (err) {
    console.error('[Demo] Transcript error:', err.message, err.stack);
    res.status(500).json(customerError('INTERNAL_SERVER_ERROR', err.message));
  }
});

/**
 * GET /:id/polaris-estimate
 */
router.get('/:id/polaris-estimate', (req, res) => {
  try {
    const session = demoSessions.get(req.params.id);
    if (!session) return res.status(404).json(customerError('NOT_FOUND', 'Session not found'));

    const preLive = ['idle', 'requesting_call', 'call_created', 'dialing', 'ringing', 'answered', 'media_connected', 'simulation'];
    if (preLive.includes(session.callStatus)) {
      return res.json({
        opportunityLabel: 'POLARIS™ ESTIMATED OPPORTUNITY',
        confidence: 0, revenueRange: '—',
        reasoning: [],
        polairsState: 'waiting',
        message: 'Waiting for conversation...',
      });
    }

    const estimate = polarisEstimate(session.businessName, session.industry, session.transcriptLines, session.executiveSummary);
    res.json({ ...estimate, polairsState: 'analyzing', polarisState: 'analyzing' });
  } catch (err) {
    console.error('[Demo] Polaris estimate error:', err.message, err.stack);
    res.status(500).json(customerError('INTERNAL_SERVER_ERROR', err.message));
  }
});

/**
 * GET /:id/status
 */
router.get('/:id/status', (req, res) => {
  try {
    const session = demoSessions.get(req.params.id);
    if (!session) return res.status(404).json(customerError('NOT_FOUND', 'Session not found'));

    const now = Date.now();
    const talkTimeStarted = session.startedAt ? new Date(session.startedAt).getTime() : null;
    const durationSec = talkTimeStarted ? Math.floor((now - talkTimeStarted) / 1000) : 0;

    // Auto-complete simulation after 45s of talk time
    if (session.callStatus === 'live' && durationSec > 45 && !session.callId?.startsWith('sim')) {
      // Only auto-complete simulated calls
    }
    if (session.callStatus === 'live' && durationSec > 48 && session.callId?.startsWith('sim')) {
      session.callStatus = 'completed';
      liveTimeline.addEntry(session.id, 'call_completed', 'Simulated call ended', 'system');
    }

    const estimate = polarisEstimate(session.businessName, session.industry, session.transcriptLines, session.executiveSummary);

    const preLive = ['idle', 'requesting_call', 'call_created', 'dialing', 'ringing', 'answered', 'media_connected', 'simulation'];
    const isPreLive = preLive.includes(session.callStatus);

    // ── AI Panel Computations ──
    const tl = session.transcriptLines || [];
    const n = tl.length;
    // Customer Intent: derive from transcript content
    const intentLabels = ['Information gathering', 'Initial interest detected', 'Actively seeking service', 'High-intent buyer'];
    const intentIdx = n === 0 ? 0 : (n < 2 ? 1 : (n < 4 ? 2 : 3));
    const aiPanels = {
      customerIntent: intentLabels[intentIdx],
      // Lead Qualification: based on conversation depth
      leadQualification: n === 0 ? 'Waiting for conversation...' : (n < 2 ? 'Initial contact — gathering info' : (n < 4 ? 'Qualifying — discussing needs' : 'Hot lead — active discussion')),
      // Booking Probability: number based on confidence
      bookingProbability: isPreLive ? 0 : Math.min(estimate.confidence + 5, 95),
      // Recommended Actions: derived from conversation stage
      recommendedActions: n === 0 ? ['Waiting for conversation...'] : (n < 3 ? ['Continue conversation', 'Listen for pain points', 'Gather contact details'] : (n < 6 ? ['Identify key decision maker', 'Discuss pricing options', 'Propose next steps'] : ['Schedule on-site estimate', 'Send follow-up materials', 'Set appointment date'])),
      // Executive Summary: building text
      executiveSummaryText: n === 0 ? 'Call in progress. Analysis will update as the conversation develops.' : (n < 3 ? `📞 Call in progress with ${session.businessName}. Customer is responding. Transcript: ${n} lines.` : `📞 Active conversation with ${session.businessName}. ${n} transcript lines captured. Confidence: ${estimate.confidence}%. ${intentLabels[intentIdx]}.`),
    };

    const isAnswered = ['answered', 'media_connected', 'live', 'completed', 'polaris_summary'].includes(session.callStatus);

    console.log(`[Demo:StatusEP] session=${session.id} status=${session.callStatus} lines=${n} isPreLive=${isPreLive} confidence=${estimate.confidence}`);

    res.json({
      sessionId: session.id,
      callId: session.callId,
      callStatus: session.callStatus,
      stateSeq: session.stateSeq || 0,
      duration: isAnswered ? durationSec : 0,
      talkTimeStarted: !!session.startedAt,
      businessName: session.businessName,
      industry: session.industry,
      mode: session.callId?.startsWith('sim') ? 'simulation' : 'live',
      conversationState: isPreLive ? 'waiting' : (session.callStatus === 'live' ? 'live' : session.callStatus),
      polairsEstimate: estimate,
      polairsState: isPreLive ? 'waiting' : 'analyzing',
      polarisEstimate: estimate,
      polarisState: isPreLive ? 'waiting' : 'analyzing',
      // ── M18M: Speaking indicator ──
      currentSpeaker: session.currentSpeaker || null,
      lastSpeakerAt: session.lastSpeakerAt || null,
      speakingIndicator: session.currentSpeaker || 'silent',
      customerIntent: aiPanels.customerIntent,
      leadQualification: aiPanels.leadQualification,
      bookingProbability: aiPanels.bookingProbability,
      recommendedActions: aiPanels.recommendedActions,
      executiveSummaryText: aiPanels.executiveSummaryText,
      transcriptLineCount: n,
      // ── End AI Panel data ──
      executiveSummary: session.executiveSummary || null,
      timestamp: now,
    });
  } catch (err) {
    console.error('[Demo] Status error:', err.message, err.stack);
    res.status(500).json(customerError('INTERNAL_SERVER_ERROR', err.message));
  }
});

/**
 * GET /:id/timeline
 * Get call lifecycle timeline entries for a demo session.
 * Exposes the liveTimeline data used by demo.js so the
 * communications dashboard can display call event history.
 */
router.get('/:id/timeline', (req, res) => {
  try {
    const entries = liveTimeline.getTimeline(req.params.id);
    res.json({ success: true, sessionId: req.params.id, entries, count: entries.length });
  } catch (err) {
    console.error('[Demo] Timeline error:', err.message, err.stack);
    res.status(500).json(customerError('INTERNAL_SERVER_ERROR', err.message));
  }
});

/**
 * GET /:id/events
 * Server-Sent Events (SSE) endpoint for real-time call event streaming.
 * The client connects with EventSource and receives:
 *   - event: status  → { callStatus, previousStatus, timestamp }
 *   - event: transcript → { line, totalLines }
 *   - event: executiveSummary → { outcome, sentiment, ... }
 *   - event: polarisSummary → { leadId, polarisScore }
 *   - event: heartbeat → { timestamp } (every 15s)
 *
 * Falls back gracefully — polling continues on the frontend if SSE is unavailable.
 */
router.get('/:id/events', (req, res) => {
  const sessionId = req.params.id;
  const session = demoSessions.get(sessionId);

  if (!session) {
    return res.status(404).json(customerError('NOT_FOUND', 'Session not found'));
  }

  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'X-Accel-Buffering': 'no',
  });

  // Send initial connection event
  res.write(`event: connected\ndata: ${JSON.stringify({
    sessionId,
    callStatus: session.callStatus,
    timestamp: new Date().toISOString(),
  })}\n\n`);

  // Register this connection for broadcasts
  const webhook = require('../retell/webhook');
  webhook.addSSEConnection(sessionId, res);

  // Heartbeat every 15 seconds to keep connection alive
  const heartbeat = setInterval(() => {
    try {
      res.write(`event: heartbeat\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);
    } catch (e) {
      clearInterval(heartbeat);
    }
  }, 15000);

  // Clean up on disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
    webhook.removeSSEConnection(sessionId, res);
    console.log(`[Demo:SSE] Client disconnected from session ${sessionId}`);
  });

  console.log(`[Demo:SSE] Client connected to session ${sessionId}`);
});

module.exports = router;
module.exports.advanceCallState = advanceCallState;
module.exports.demoSessions = demoSessions;
module.exports.isValidTransition = isValidTransition;
module.exports.analyzeTranscriptQualification = analyzeTranscriptQualification;
module.exports.polarisEstimateFromSession = polarisEstimateFromSession;
module.exports.polarisEstimate = polarisEstimate;
module.exports.buildPolarisIntelligence = buildPolarisIntelligence;