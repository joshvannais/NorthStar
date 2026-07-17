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

function generateDemoEC(businessName, industry) {
  const d = getDefaults(industry);
  return { businessName, industry, service: d.service, avgJobValue: d.avgJobValue, emergencyLikelihood: d.emergencyLikelihood, revenueRangeMin: d.revenueRangeMin, revenueRangeMax: d.revenueRangeMax, generatedAt: new Date().toISOString() };
}

// ── Mock transcript (simulation only) ──
function mockTranscript(industry, count) {
  const scripts = {
    'Roofing': [
      { speaker: 'ai', text: "Thank you for calling. This is NorthStar's virtual receptionist. How can I help you today?" },
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
      { speaker: 'ai', text: "Thank you for calling. This is NorthStar's virtual receptionist. How can I help?" },
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
      { speaker: 'ai', text: "Thank you for calling. This is NorthStar's virtual receptionist. How can I help you today?" },
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
 * POST /call
 *
 * Validates: businessName, industry, phoneNumber
 * In live mode: calls Retell API. Only returns CALL_CREATED on success.
 * In sim mode: returns simulation — frontend calls /:id/simulate to start.
 */
router.post('/call', async (req, res) => {
  try {
    const { businessName, industry, phoneNumber } = req.body;

    if (!businessName || !industry || !phoneNumber) {
      return res.status(400).json({ error: { code: 'VALIDATION', message: 'businessName, industry, and phoneNumber are required' } });
    }

    const normalizedIndustry = ALL_INDUSTRIES.find(i => i.toLowerCase() === industry.toLowerCase());
    if (!normalizedIndustry) {
      return res.status(400).json({ error: { code: 'VALIDATION', message: 'Invalid industry.' } });
    }

    // Basic phone validation
    const digits = phoneNumber.replace(/\D/g, '');
    if (digits.length < 10) {
      return res.status(400).json({ error: { code: 'INVALID_PHONE', message: 'Please enter a valid phone number with area code.' } });
    }

    const demoSessionId = uuidv4();
    const ec = generateDemoEC(businessName, normalizedIndustry);
    const configured = Boolean(config.retell && config.retell.apiKey && config.retell.agentId);

    if (!configured) {
      // Simulation path — create session at IDLE, frontend calls /simulate
      const session = {
        id: demoSessionId, businessName, industry: normalizedIndustry, phoneNumber,
        executiveContext: ec, callId: `sim-${demoSessionId.slice(0, 8)}`,
        callStatus: 'idle', createdAt: Date.now(), transcriptLines: [],
        transcriptIndex: 0, startedAt: null, stateSeq: 1,
        error: null,
      };
      demoSessions.set(demoSessionId, session);
      return res.json({
        demoSessionId, callId: session.callId,
        status: 'idle', mode: 'simulation',
        message: 'Demo simulation ready. Call /simulate to start.',
      });
    }

    // Live path — call Retell
    try {
      liveTimeline.addEntry(demoSessionId, 'call_creating', 'Requesting call via Retell', 'system');

      const callResult = await retell.createCall(phoneNumber, config.retell.agentId, {
        service: ec.service, caller: `Demo: ${businessName}`,
      });

      const retellCallId = callResult?.call_id;
      if (!retellCallId) {
        throw new Error('Retell did not return a call_id');
      }

      // Success — advance to call_created
      const session = {
        id: demoSessionId, businessName, industry: normalizedIndustry, phoneNumber,
        executiveContext: ec, callId: retellCallId,
        callStatus: 'call_created', createdAt: Date.now(), transcriptLines: [],
        transcriptIndex: 0, startedAt: null, stateSeq: 1,
        error: null,
      };
      demoSessions.set(demoSessionId, session);
      liveTimeline.addEntry(demoSessionId, 'call_created', `Retell call ${retellCallId} created`, 'system');

      return res.json({
        demoSessionId, callId: retellCallId,
        status: 'call_created', mode: 'live',
      });
    } catch (callErr) {
      console.error('[Demo] Retell call failed:', callErr.message);
      return res.status(502).json({
        error: { code: 'RETELL_UNAVAILABLE', message: 'Unable to reach voice service. Please try again.' },
      });
    }
  } catch (err) {
    console.error('[Demo] Call creation error:', err.message);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Failed to create demo call.' } });
  }
});

/**
 * POST /:id/simulate
 * Start simulation for a session. Only valid from 'idle' state.
 */
router.post('/:id/simulate', (req, res) => {
  try {
    const session = demoSessions.get(req.params.id);
    if (!session) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session not found.' } });
    if (session.callStatus !== 'idle') return res.status(400).json({ error: { code: 'INVALID_STATE', message: `Cannot simulate from state: ${session.callStatus}` } });

    session.callStatus = 'simulation';
    session.transcriptLines = [];
    liveTimeline.addEntry(session.id, 'simulation_started', 'Simulation mode activated', 'system');
    scheduleSimAdvance(session.id);

    res.json({ demoSessionId: session.id, status: 'simulation' });
  } catch (err) {
    console.error('[Demo] Simulate error:', err.message);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Failed to start simulation.' } });
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
    if (!to) return res.status(400).json({ error: { code: 'VALIDATION', message: 'Target state (to) is required.' } });

    const session = demoSessions.get(req.params.id);
    if (!session) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session not found.' } });

    if (!isValidTransition(session.callStatus, to)) {
      return res.status(400).json({
        error: { code: 'INVALID_TRANSITION', message: `Cannot transition from ${session.callStatus} to ${to}.` },
      });
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
    console.error('[Demo] Advance error:', err.message);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Failed to advance state.' } });
  }
});

/**
 * GET /:id/transcript
 * Returns transcript. Only returns data in 'live' or later states.
 * Before 'live', returns empty array with appropriate message.
 */
router.get('/:id/transcript', (req, res) => {
  try {
    const session = demoSessions.get(req.params.id);
    if (!session) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session not found.' } });

    const preLive = ['idle', 'requesting_call', 'call_created', 'dialing', 'ringing', 'answered', 'media_connected', 'simulation'];
    if (preLive.includes(session.callStatus)) {
      return res.json({
        sessionId: session.id, callStatus: session.callStatus,
        lines: [], count: 0,
        conversationState: 'waiting',
        message: 'Waiting for call to connect...',
      });
    }

    // Simulation mode — generate mock transcript progressively
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
    console.error('[Demo] Transcript error:', err.message);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Failed to retrieve transcript.' } });
  }
});

/**
 * GET /:id/polaris-estimate
 * Only returns data after 'live' state. Before that, returns empty.
 */
router.get('/:id/polaris-estimate', (req, res) => {
  try {
    const session = demoSessions.get(req.params.id);
    if (!session) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session not found.' } });

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
    console.error('[Demo] Polaris estimate error:', err.message);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Failed to generate estimate.' } });
  }
});

/**
 * GET /:id/status
 * Returns current state. Timer only counts after 'answered' or 'media_connected'.
 */
router.get('/:id/status', (req, res) => {
  try {
    const session = demoSessions.get(req.params.id);
    if (!session) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session not found.' } });

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
      timestamp: now,
    });
  } catch (err) {
    console.error('[Demo] Status error:', err.message);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Failed to retrieve status.' } });
  }
});

module.exports = router;