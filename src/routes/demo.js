/**
 * Demo Routes — Part 8: M17 Phase 3
 *
 * PUBLIC endpoints for the "Try NorthStar" interactive homepage demo.
 * Creates temporary demo sessions with in-memory storage and 1hr TTL.
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

/**
 * Clean expired demo sessions every 10 minutes.
 */
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of demoSessions) {
    if (now - session.createdAt > TTL_MS) {
      liveTimeline.clearSession(id);
      demoSessions.delete(id);
      console.log(`[Demo] Cleaned expired session: ${id}`);
    }
  }
}, 10 * 60 * 1000);

/**
 * Generate mock Executive Context for demo purposes.
 * Uses submitted business info + industry-specific defaults.
 */
function generateDemoExecutiveContext(businessName, industry) {
  const industryDefaults = {
    'Roofing': { service: 'Roof inspection and repair', avgJobValue: 4500, emergencyLikelihood: 0.3 },
    'HVAC': { service: 'HVAC system repair', avgJobValue: 3200, emergencyLikelihood: 0.2 },
    'Plumbing': { service: 'Plumbing repair', avgJobValue: 1800, emergencyLikelihood: 0.4 },
    'Electrical': { service: 'Electrical work', avgJobValue: 2200, emergencyLikelihood: 0.15 },
    'Landscaping': { service: 'Landscaping services', avgJobValue: 1500, emergencyLikelihood: 0.05 },
    'Home Security': { service: 'Security system installation', avgJobValue: 2800, emergencyLikelihood: 0.1 },
    'General Contracting': { service: 'General contracting', avgJobValue: 5000, emergencyLikelihood: 0.15 },
  };

  const defaults = industryDefaults[industry] || industryDefaults['General Contracting'];

  return {
    businessName,
    industry,
    service: defaults.service,
    avgJobValue: defaults.avgJobValue,
    emergencyLikelihood: defaults.emergencyLikelihood,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Generate mock transcript lines for demo sessions.
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
 * Generate mock guidance for demo sessions.
 */
function generateMockGuidance(industry, transcriptLines) {
  const guidanceByIndustry = {
    'Roofing': {
      customerIntent: 'Storm damage inspection',
      estimatedJobValue: '$3,500 - $5,200',
      leadQualification: 'Hot',
      bookingProbability: 0.85,
      recommendedActions: [
        'Prioritize this lead — storm damage with visible damage',
        'Send estimator with insurance documentation',
        'Follow up within 24 hours with written estimate',
      ],
      executiveSummary: 'Customer has storm-related roof damage with 15-20 missing shingles and dented gutters. High urgency due to weather exposure risk. Customer is motivated and ready to book immediately.',
    },
    'Plumbing': {
      customerIntent: 'Emergency pipe repair',
      estimatedJobValue: '$450 - $850',
      leadQualification: 'Hot',
      bookingProbability: 0.95,
      recommendedActions: [
        'EMERGENCY — dispatch immediately',
        'Send plumber with pipe repair equipment',
        'Quote on-site, emergency surcharge applies',
      ],
      executiveSummary: 'Active water leak from burst kitchen pipe. Customer unable to locate main shutoff. Emergency dispatch required within 45 minutes. High conversion probability due to urgency.',
    },
    'HVAC': {
      customerIntent: 'HVAC repair — no cooling',
      estimatedJobValue: '$1,200 - $2,800',
      leadQualification: 'Warm',
      bookingProbability: 0.65,
      recommendedActions: [
        'Dispatch AC technician same-day',
        'Prepare for potential system replacement quote (unit is 10 years old)',
        'Offer maintenance plan during visit',
      ],
      executiveSummary: 'Customer has non-functional central AC in summer heat. Unit is 10 years old — may need repair or replacement. Customer is uncomfortable and motivated but may shop around.',
    },
  };

  const guidance = guidanceByIndustry[industry] || guidanceByIndustry['Roofing'];

  // Simulate increasing intelligence as more transcript lines arrive
  const lines = transcriptLines || [];
  if (lines.length < 3) {
    return {
      customerIntent: 'Analyzing...',
      estimatedJobValue: 'Analyzing...',
      leadQualification: 'Analyzing...',
      bookingProbability: 0.3,
      recommendedActions: ['Waiting for more conversation data...'],
      executiveSummary: 'Call in progress. Gathering data for analysis.',
    };
  }

  if (lines.length < 6) {
    return {
      customerIntent: guidance.customerIntent,
      estimatedJobValue: 'Analyzing...',
      leadQualification: 'Warm',
      bookingProbability: 0.5,
      recommendedActions: guidance.recommendedActions.slice(0, 1),
      executiveSummary: 'Early analysis in progress. Customer intent detected.',
    };
  }

  return guidance;
}

/**
 * POST /call
 * Create a demo session and place an outbound call.
 * PUBLIC — no auth required.
 */
router.post('/call', async (req, res) => {
  try {
    const { businessName, industry, phoneNumber } = req.body;

    if (!businessName || !industry || !phoneNumber) {
      return res.status(400).json({
        error: { code: 'VALIDATION', message: 'businessName, industry, and phoneNumber are required' },
      });
    }

    const validIndustries = ['Roofing', 'HVAC', 'Plumbing', 'Electrical', 'Landscaping', 'Home Security', 'General Contracting'];
    if (!validIndustries.includes(industry)) {
      return res.status(400).json({
        error: { code: 'VALIDATION', message: `Invalid industry. Must be one of: ${validIndustries.join(', ')}` },
      });
    }

    const demoSessionId = uuidv4();
    const ec = generateDemoExecutiveContext(businessName, industry);

    // Record timeline entry
    liveTimeline.addEntry(demoSessionId, 'call_started', `Outbound demo call for ${businessName}`, 'system');

    let callResult = null;
    let callStatus = 'queued';

    // Try to place a real outbound call via Retell
    try {
      if (config.retell.apiKey && config.retell.agentId) {
        callResult = await retell.createCall(phoneNumber, config.retell.agentId, {
          service: ec.service,
          caller: `Demo: ${businessName}`,
        });
        callStatus = callResult?.call_status || 'in-progress';
      } else {
        console.log('[Demo] Retell not configured — using simulated call mode');
        callStatus = 'simulated';
      }
    } catch (callErr) {
      console.warn('[Demo] Call placement warning:', callErr.message);
      callStatus = 'simulated';
    }

    // Store demo session
    const session = {
      id: demoSessionId,
      businessName,
      industry,
      phoneNumber,
      executiveContext: ec,
      callId: callResult?.call_id || `sim-${demoSessionId.slice(0, 8)}`,
      callStatus,
      createdAt: Date.now(),
      transcriptLines: generateMockTranscriptLines(industry, 1),
      transcriptIndex: 0,
      startedAt: new Date().toISOString(),
    };

    demoSessions.set(demoSessionId, session);

    console.log(`[Demo] Session created: ${demoSessionId} for ${businessName} (${industry}) — status: ${callStatus}`);

    res.json({
      demoSessionId,
      callId: session.callId,
      status: callStatus,
    });
  } catch (err) {
    console.error('[Demo] Call creation error:', err.message);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Failed to create demo call' } });
  }
});

/**
 * GET /:id/transcript
 * Returns the live transcript for a demo session.
 * PUBLIC — no auth required.
 */
router.get('/:id/transcript', (req, res) => {
  try {
    const session = demoSessions.get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Demo session not found or expired' } });
    }

    // Progress through transcript lines to simulate real conversation
    if (session.callStatus === 'simulated' || session.callStatus === 'in-progress') {
      const fullScript = generateMockTranscriptLines(session.industry, 12);
      const elapsed = (Date.now() - session.createdAt) / 1000;
      // One new line every ~4 seconds
      const visibleCount = Math.min(Math.floor(elapsed / 4) + 1, fullScript.length);
      session.transcriptLines = fullScript.slice(0, visibleCount);
    }

    res.json({
      sessionId: session.id,
      callStatus: session.callStatus,
      lines: session.transcriptLines,
      count: session.transcriptLines.length,
    });
  } catch (err) {
    console.error('[Demo] Transcript error:', err.message);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Failed to retrieve transcript' } });
  }
});

/**
 * GET /:id/guidance
 * Returns live guidance for a demo session.
 * PUBLIC — no auth required.
 */
router.get('/:id/guidance', (req, res) => {
  try {
    const session = demoSessions.get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Demo session not found or expired' } });
    }

    const guidance = generateMockGuidance(session.industry, session.transcriptLines);

    res.json({
      sessionId: session.id,
      ...guidance,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Demo] Guidance error:', err.message);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Failed to retrieve guidance' } });
  }
});

/**
 * GET /:id/status
 * Returns full demo session status with KPIs.
 * PUBLIC — no auth required.
 */
router.get('/:id/status', (req, res) => {
  try {
    const session = demoSessions.get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Demo session not found or expired' } });
    }

    const now = Date.now();
    const durationSec = Math.floor((now - session.createdAt) / 1000);

    // Auto-complete simulated calls after 45 seconds
    if ((session.callStatus === 'simulated' || session.callStatus === 'in-progress') && durationSec > 45) {
      session.callStatus = 'completed';
      liveTimeline.addEntry(session.id, 'call_completed', `Duration: ${durationSec}s`, 'system');
    }

    const guidance = generateMockGuidance(session.industry, session.transcriptLines);

    res.json({
      sessionId: session.id,
      callId: session.callId,
      callStatus: session.callStatus,
      duration: durationSec,
      businessName: session.businessName,
      industry: session.industry,
      customerIntent: guidance.customerIntent,
      estimatedJobValue: guidance.estimatedJobValue,
      leadQualification: guidance.leadQualification,
      bookingProbability: guidance.bookingProbability,
      recommendedActions: guidance.recommendedActions,
      executiveSummary: guidance.executiveSummary,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Demo] Status error:', err.message);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Failed to retrieve status' } });
  }
});

module.exports = router;
