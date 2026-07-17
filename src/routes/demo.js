/**
 * Demo Routes — M17 Phase 3 (Remediated)
 *
 * PUBLIC endpoints for the "Try NorthStar" interactive homepage demo.
 * Creates temporary demo sessions with in-memory storage and 1hr TTL.
 *
 * Call lifecycle: idle → dialing → ringing → answered → connected → completed
 * In simulation mode, the frontend shows a warning BEFORE the user starts.
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const retell = require('../retell/client');
const liveTimeline = require('../voice/liveTimeline');

// In-memory demo session store with 1hr TTL
const demoSessions = new Map();
const TTL_MS = 60 * 60 * 1000; // 1 hour

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

/**
 * Clean expired demo sessions every 10 minutes.
 */
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of demoSessions) {
    if (now - session.createdAt > TTL_MS) {
      liveTimeline.clearSession(id);
      demoSessions.delete(id);
    }
  }
}, 10 * 60 * 1000);

/**
 * Industry-specific defaults for generating demo context + Polaris estimates.
 */
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

/**
 * Generate demo Executive Context with industry defaults.
 */
function generateDemoExecutiveContext(businessName, industry) {
  const defaults = INDUSTRY_DEFAULTS[industry] || INDUSTRY_DEFAULTS['General Contracting'];
  return {
    businessName,
    industry,
    service: defaults.service,
    avgJobValue: defaults.avgJobValue,
    emergencyLikelihood: defaults.emergencyLikelihood,
    revenueRangeMin: defaults.revenueRangeMin,
    revenueRangeMax: defaults.revenueRangeMax,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Generate mock transcript lines for simulation mode.
 */
function generateMockTranscriptLines(industry, lineCount) {
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
  return script.slice(0, Math.min(lineCount || script.length, script.length));
}

/**
 * Generate Polaris-style mock guidance with estimated opportunity.
 */
function generatePolarisEstimate(businessName, industry, transcriptLines) {
  const defs = INDUSTRY_DEFAULTS[industry] || INDUSTRY_DEFAULTS['General Contracting'];
  const lines = transcriptLines || [];
  const linesCount = lines.length;

  // Increase confidence as more conversation data arrives
  let confidence = 0.3;
  let revenueMin = defs.revenueRangeMin;
  let revenueMax = defs.revenueRangeMax;

  if (linesCount >= 3) confidence = Math.min(0.65, 0.3 + (linesCount * 0.05));
  if (linesCount >= 6) confidence = Math.min(0.88, 0.3 + (linesCount * 0.06));

  return {
    opportunityLabel: 'POLARIS™ ESTIMATED OPPORTUNITY',
    confidence: Math.round(confidence * 100),
    revenueRange: `$${revenueMin.toLocaleString()} - $${revenueMax.toLocaleString()}`,
    reasoning: [
      { factor: 'Service Requested',        detail: defs.service },
      { factor: 'Industry',                 detail: industry },
      { factor: 'Urgency Level',            detail: defs.emergencyLikelihood > 0.3 ? 'High — customer needs immediate attention' : defs.emergencyLikelihood > 0.15 ? 'Moderate — routine concern with some urgency' : 'Standard — no immediate urgency detected' },
      { factor: 'Property Characteristics',  detail: 'Typical residential property based on conversation context' },
      { factor: 'Customer Intent',          detail: linesCount > 2 ? 'Customer is actively seeking service and ready to engage' : 'Customer is in information-gathering phase' },
      { factor: 'Historical Pricing',       detail: `Industry average: $${defs.avgJobValue.toLocaleString()} for ${industry.toLowerCase()}` },
      { factor: 'Business Pricing Profile', detail: `${businessName} operates in the ${industry.toLowerCase()} industry with standard market positioning` },
      { factor: 'Confidence Level',         detail: `${Math.round(confidence * 100)}% — ${confidence > 0.7 ? 'High confidence based on sufficient conversation data' : confidence > 0.4 ? 'Moderate confidence, improving as conversation progresses' : 'Initial estimate, will refine as more information is gathered'}` },
      { factor: 'Assumptions',              detail: 'Estimate based on typical job scopes for this industry. Final pricing may vary based on on-site inspection and specific material choices.' },
    ],
    generatedAt: new Date().toISOString(),
  };
}

/**
 * GET /status
 * Returns the system status — used by the frontend to check mode before user starts.
 * PUBLIC.
 */
router.get('/status', (req, res) => {
  const retellConfigured = Boolean(config.retell && config.retell.apiKey && config.retell.agentId);
  res.json({
    mode: retellConfigured ? 'live' : 'simulation',
    retellConfigured,
    message: retellConfigured
      ? 'Retell AI is configured. Real outbound calls will be placed.'
      : '🔬 DEMO SIMULATION MODE — Calls are simulated. Configure Retell API credentials for live calls.',
  });
});

/**
 * GET /industries
 * Returns the full list of supported industries.
 * PUBLIC.
 */
router.get('/industries', (req, res) => {
  res.json({ industries: ALL_INDUSTRIES });
});

/**
 * POST /call
 * Create a demo session. If Retell is configured, place a real call.
 * If not, returns 'simulation-mode-required' — the frontend handles it.
 * PUBLIC.
 */
router.post('/call', async (req, res) => {
  try {
    const { businessName, industry, phoneNumber } = req.body;

    if (!businessName || !industry || !phoneNumber) {
      return res.status(400).json({
        error: { code: 'VALIDATION', message: 'businessName, industry, and phoneNumber are required' },
      });
    }

    const normalizedIndustry = ALL_INDUSTRIES.find(i => i.toLowerCase() === industry.toLowerCase());
    if (!normalizedIndustry) {
      return res.status(400).json({
        error: { code: 'VALIDATION', message: `Invalid industry. Please select from the list.` },
      });
    }

    const demoSessionId = uuidv4();
    const ec = generateDemoExecutiveContext(businessName, normalizedIndustry);

    // Record timeline entry
    liveTimeline.addEntry(demoSessionId, 'call_started', `Outbound demo call for ${businessName}`, 'system');

    let callResult = null;
    let callStatus = 'queued';
    let callId = null;

    const retellConfigured = Boolean(config.retell && config.retell.apiKey && config.retell.agentId);

    if (!retellConfigured) {
      // Return simulation-mode-required — frontend shows banner and handles transition
      const session = {
        id: demoSessionId,
        businessName,
        industry: normalizedIndustry,
        phoneNumber,
        executiveContext: ec,
        callId: `sim-${demoSessionId.slice(0, 8)}`,
        callStatus: 'simulation-mode-required',
        createdAt: Date.now(),
        transcriptLines: [],
        transcriptIndex: 0,
        startedAt: null,
      };
      demoSessions.set(demoSessionId, session);
      return res.json({ demoSessionId, callId: session.callId, status: 'simulation-mode-required' });
    }

    // Retell is configured — place a real call
    try {
      liveTimeline.addEntry(demoSessionId, 'dialing_started', `Dialing ${phoneNumber}`, 'system');
      callResult = await retell.createCall(phoneNumber, config.retell.agentId, {
        service: ec.service,
        caller: `Demo: ${businessName}`,
      });
      callStatus = 'dialing';
      callId = callResult?.call_id || null;

      // Simulate lifecycle transitions (in production, Retell webhook updates these)
      setTimeout(() => {
        const s = demoSessions.get(demoSessionId);
        if (s && s.callStatus === 'dialing') {
          s.callStatus = 'ringing';
          liveTimeline.addEntry(demoSessionId, 'ringing', 'Phone is ringing', 'system');
        }
      }, 3000);

      setTimeout(() => {
        const s = demoSessions.get(demoSessionId);
        if (s && (s.callStatus === 'dialing' || s.callStatus === 'ringing')) {
          s.callStatus = 'answered';
          liveTimeline.addEntry(demoSessionId, 'call_answered', 'Call was answered', 'system');
        }
      }, 8000);

      setTimeout(() => {
        const s = demoSessions.get(demoSessionId);
        if (s && s.callStatus === 'answered') {
          s.callStatus = 'connected';
          s.startedAt = new Date().toISOString();
          liveTimeline.addEntry(demoSessionId, 'call_connected', 'Conversation started', 'system');
        }
      }, 12000);
    } catch (callErr) {
      console.warn('[Demo] Retell call failed:', callErr.message);
      callStatus = 'failed';
      liveTimeline.addEntry(demoSessionId, 'call_failed', `Call failed: ${callErr.message}`, 'system');
    }

    const session = {
      id: demoSessionId,
      businessName,
      industry: normalizedIndustry,
      phoneNumber,
      executiveContext: ec,
      callId: callId || `sim-${demoSessionId.slice(0, 8)}`,
      callStatus,
      createdAt: Date.now(),
      transcriptLines: [],
      transcriptIndex: 0,
      startedAt: null,
    };
    demoSessions.set(demoSessionId, session);

    res.json({ demoSessionId, callId: session.callId, status: callStatus });
  } catch (err) {
    console.error('[Demo] Call creation error:', err.message);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Failed to create demo call' } });
  }
});

/**
 * POST /:id/simulate
 * Transition a simulation-mode-required session into simulation mode.
 * Called by the frontend when user acknowledges simulation mode.
 * PUBLIC.
 */
router.post('/:id/simulate', (req, res) => {
  try {
    const session = demoSessions.get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Demo session not found or expired' } });
    }
    session.callStatus = 'simulated';
    session.startedAt = new Date().toISOString();
    session.transcriptLines = generateMockTranscriptLines(session.industry, 1);
    liveTimeline.addEntry(session.id, 'call_simulated', 'Simulated call started', 'system');
    res.json({ demoSessionId: session.id, status: 'simulated' });
  } catch (err) {
    console.error('[Demo] Simulate error:', err.message);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Failed to start simulation' } });
  }
});

/**
 * GET /:id/transcript
 * Returns the live transcript for a demo session.
 * In live mode, returns real transcript data. In simulation, generates mock.
 * PUBLIC.
 */
router.get('/:id/transcript', (req, res) => {
  try {
    const session = demoSessions.get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Demo session not found or expired' } });
    }

    const { since } = req.query;

    // In live mode (Retell), transcript would come from transcriptStream.
    // For now, if live and connected, return what we have (Retell webhook fills this).
    if (session.callStatus === 'connected' || session.callStatus === 'in-progress') {
      // Live mode — real transcript from Retell webhook would be in transcriptLines
      const lines = since ? session.transcriptLines.filter((_, i) => i >= parseInt(since)) : session.transcriptLines;
      return res.json({
        sessionId: session.id,
        callStatus: session.callStatus,
        lines,
        count: lines.length,
      });
    }

    // Simulation mode — generate mock transcript
    if (session.callStatus === 'simulated' || session.callStatus === 'in-progress') {
      const fullScript = generateMockTranscriptLines(session.industry, 12);
      const elapsed = (Date.now() - session.createdAt) / 1000;
      const visibleCount = Math.min(Math.floor(elapsed / 4) + 1, fullScript.length);
      session.transcriptLines = fullScript.slice(0, visibleCount);
    }

    res.json({
      sessionId: session.id,
      callStatus: session.callStatus,
      lines: session.transcriptLines,
      count: session.transcriptLines.length,
      mode: session.callStatus === 'simulated' ? 'simulation' : 'live',
    });
  } catch (err) {
    console.error('[Demo] Transcript error:', err.message);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Failed to retrieve transcript' } });
  }
});

/**
 * GET /:id/guidance
 * Returns live Polaris guidance for a demo session.
 * PUBLIC.
 */
router.get('/:id/guidance', (req, res) => {
  try {
    const session = demoSessions.get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Demo session not found or expired' } });
    }

    const estimate = generatePolarisEstimate(session.businessName, session.industry, session.transcriptLines);

    res.json({
      sessionId: session.id,
      polairsEstimate: estimate,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Demo] Guidance error:', err.message);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Failed to retrieve guidance' } });
  }
});

/**
 * GET /:id/polaris-estimate
 * Dedicated endpoint for the Polaris Estimated Opportunity card.
 * PUBLIC.
 */
router.get('/:id/polaris-estimate', (req, res) => {
  try {
    const session = demoSessions.get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Demo session not found or expired' } });
    }
    const estimate = generatePolarisEstimate(session.businessName, session.industry, session.transcriptLines);
    res.json(estimate);
  } catch (err) {
    console.error('[Demo] Polaris estimate error:', err.message);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Failed to generate estimate' } });
  }
});

/**
 * GET /:id/status
 * Returns full demo session status with KPIs.
 * PUBLIC.
 */
router.get('/:id/status', (req, res) => {
  try {
    const session = demoSessions.get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Demo session not found or expired' } });
    }

    const now = Date.now();
    const durationSec = session.startedAt ? Math.floor((now - new Date(session.startedAt).getTime()) / 1000) : 0;

    // Auto-complete simulated calls after 45 seconds
    if (session.callStatus === 'simulated' && durationSec > 45) {
      session.callStatus = 'completed';
      liveTimeline.addEntry(session.id, 'call_completed', `Duration: ${durationSec}s`, 'system');
    }

    const estimate = generatePolarisEstimate(session.businessName, session.industry, session.transcriptLines);

    res.json({
      sessionId: session.id,
      callId: session.callId,
      callStatus: session.callStatus,
      callState: session.callStatus, // lifecycle state for frontend
      duration: durationSec,
      businessName: session.businessName,
      industry: session.industry,
      polairsEstimate: estimate,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Demo] Status error:', err.message);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Failed to retrieve status' } });
  }
});

module.exports = router;
