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
  'dialing':               ['ringing', 'failed'],
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

function polarisEstimate(businessName, industry, transcriptLines) {
  const d = getDefaults(industry);
  const lines = transcriptLines || [];
  const n = lines.length;
  let confidence = 0;
  if (n === 0) confidence = 0;
  else if (n < 3) confidence = 30;
  else if (n < 6) confidence = 55;
  else confidence = Math.min(85, 55 + (n - 5) * 5);

  return {
    opportunityLabel: 'POLARIS™ ESTIMATED OPPORTUNITY',
    confidence,
    revenueRange: `$${d.revenueRangeMin.toLocaleString()} - $${d.revenueRangeMax.toLocaleString()}`,
    reasoning: n === 0 ? [] : [
      { factor: 'Service Requested',        detail: d.service },
      { factor: 'Industry',                 detail: industry },
      { factor: 'Urgency Level',            detail: d.emergencyLikelihood > 0.3 ? 'High' : d.emergencyLikelihood > 0.15 ? 'Moderate' : 'Standard' },
      { factor: 'Property Characteristics',  detail: 'Typical residential property' },
      { factor: 'Customer Intent',          detail: n > 2 ? 'Actively seeking service' : 'Information gathering' },
      { factor: 'Historical Pricing',       detail: `$${d.avgJobValue.toLocaleString()} avg for ${industry.toLowerCase()}` },
      { factor: 'Business Pricing Profile', detail: `${businessName} — standard market positioning` },
      { factor: 'Confidence Level',         detail: `${confidence}%` },
      { factor: 'Assumptions',              detail: 'Based on typical scope. Final may vary.' },
    ],
    generatedAt: new Date().toISOString(),
  };
}

// ── Helpers to advance simulation state from backend ──
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
        }
      }

      if (callStatus === 'ringing') {
        if (['call_created', 'dialing'].includes(session.callStatus)) {
          advanceCallState(sessionId, 'ringing');
        }
      }

      if (callStatus === 'in_progress' || callStatus === 'ongoing') {
        if (session.callStatus === 'ringing') {
          advanceCallState(sessionId, 'answered');
          advanceCallState(sessionId, 'media_connected');
          advanceCallState(sessionId, 'live');
        }
      }

      // Store transcript from transcript_object (structured) or transcript (string)
      if (transcriptObject.length > 0) {
        const newLines = transcriptObject.map((entry, i) => ({
          speaker: entry.role === 'agent' ? 'Agent' : 'Customer',
          text: entry.content || '',
          timestamp: new Date().toISOString(),
        }));
        if (newLines.length > (session.transcriptLines?.length || 0)) {
          session.transcriptLines = newLines;
          console.log('poller.transcript', 'OK', `${newLines.length} lines (structured)`);
        }
      } else if (transcript && transcript.length > 0) {
        const rawLines = transcript.split('\n').filter(Boolean);
        if (rawLines.length > (session.transcriptLines?.length || 0)) {
          session.transcriptLines = rawLines.map(line => ({
            speaker: line.startsWith('Agent:') ? 'Agent' : (line.startsWith('User:') ? 'Customer' : 'Unknown'),
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
        // Pass the webhook URL matching this server instance.
        // This ensures Retell sends events back to THIS server, not just the agent default.
        webhookUrl: `${req.protocol}://${req.get('host')}/api/retell/webhook`,
        executiveContext: ec,  // Full NorthStar Executive Context → retell_llm_dynamic_variables
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
 */
router.get('/:id/transcript', (req, res) => {
  try {
    const session = demoSessions.get(req.params.id);
    if (!session) return res.status(404).json(customerError('NOT_FOUND', 'Session not found'));

    const preLive = ['idle', 'requesting_call', 'call_created', 'dialing', 'ringing', 'answered', 'media_connected', 'simulation'];
    if (preLive.includes(session.callStatus)) {
      return res.json({
        sessionId: session.id, callStatus: session.callStatus,
        lines: [], count: 0,
        conversationState: 'waiting',
        message: 'Waiting for call to connect...',
      });
    }

    if (session.callStatus === 'live' || session.callStatus === 'completed') {
      const elapsed = session.startedAt ? Math.floor((Date.now() - new Date(session.startedAt).getTime()) / 1000) : 0;
      const full = mockTranscript(session.industry, 12);
      const visible = Math.min(Math.floor(elapsed / 4) + 1, full.length);
      session.transcriptLines = full.slice(0, visible);
    }

    res.json({
      sessionId: session.id, callStatus: session.callStatus,
      lines: session.transcriptLines, count: session.transcriptLines.length,
      conversationState: 'live',
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

    const estimate = polarisEstimate(session.businessName, session.industry, session.transcriptLines);
    res.json({ ...estimate, polairsState: 'analyzing' });
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

    const estimate = polarisEstimate(session.businessName, session.industry, session.transcriptLines);

    const preLive = ['idle', 'requesting_call', 'call_created', 'dialing', 'ringing', 'answered', 'media_connected', 'simulation'];
    const isPreLive = preLive.includes(session.callStatus);
    const isAnswered = ['answered', 'media_connected', 'live', 'completed', 'polaris_summary'].includes(session.callStatus);

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