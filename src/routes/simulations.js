/**
 * Simulation Endpoint — Canonical lead simulation service
 *
 * POST /api/v1/simulations/leads
 *
 * Creates a complete simulated lead across ALL data stores:
 *   - Polaris engines (customer, communication, opportunity, estimate)
 *     → feeds Command Center, analytics KPIs, pipeline
 *   - Legacy leads store (data/leads.json)
 *     → feeds Leads page
 *   - PostgreSQL call_records (if available)
 *     → feeds Communications page
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

/**
 * POST /api/v1/simulations/leads
 *
 * Request body:
 *   name           (required) — Customer name
 *   phone          (optional) — Phone number
 *   email          (optional) — Email address
 *   service        (optional) — Service type (default: 'General')
 *   description    (optional) — Job description
 *   estimatedValue (optional) — Estimated price (default: 500)
 *
 * Response (201):
 *   success: true
 *   summary: { name, service, estimatedValue }
 *   ids:     { customer, communication, opportunity, estimate, lead, callRecord }
 *   records: { customer: {...}, communication: {...}, opportunity: {...}, estimate: {...}, lead: {...} }
 *   transcript: [...]  — simulated call transcript (speaker-attributed turns)
 */

/**
 * Generate a simulated call transcript — 8–12 turn realistic conversation.
 * Varies the dialogue based on service type.
 */
function generateTranscript(customerName, service, description, estimatedValue) {
  const firstName = customerName ? customerName.split(' ')[0] : 'there';
  const svc = (service || 'General').toLowerCase();
  const est = estimatedValue || 500;
  const desc = description || '';

  let issueDesc, issueDetail, scopeQuestion, scopeAnswer, materialMention, scheduleWindow;
  if (svc.includes('roof')) {
    issueDesc = 'I\'ve got some water coming through my ceiling after that big storm last week';
    issueDetail = 'It\'s a brown stain about the size of a dinner plate in my upstairs bedroom. I went up in the attic and I can see daylight through a couple spots.';
    scopeQuestion = 'Do you know approximately how old the roof is, and have you noticed any missing shingles from the ground?';
    scopeAnswer = 'It\'s probably 15, 16 years old. I did see a few shingles in the yard after the storm, yeah.';
    materialMention = 'architectural shingles';
    scheduleWindow = 'Thursday morning or Friday afternoon';
  } else if (svc.includes('hvac')) {
    issueDesc = 'My air conditioner is blowing warm air and it\'s getting really uncomfortable in here';
    issueDetail = 'It started yesterday. The thermostat says 78 but it\'s set to 72. I can hear the unit running outside but it doesn\'t seem to be cooling at all.';
    scopeQuestion = 'When was the last time you had the system serviced, and have you noticed any strange noises or ice buildup on the unit?';
    scopeAnswer = 'Honestly, I don\'t think it\'s been serviced in a couple years. No ice that I can see, but it does make a kind of rattling sound when it kicks on.';
    materialMention = 'high-efficiency unit';
    scheduleWindow = 'as soon as possible \u2014 tomorrow if you can';
  } else if (svc.includes('plumb')) {
    issueDesc = 'My kitchen sink is backed up and water is not draining at all';
    issueDetail = 'It happened this morning. I tried plunging it and used some drain cleaner but nothing helped. Now there\'s standing water and it\'s starting to smell.';
    scopeQuestion = 'Is it just the kitchen sink, or are other drains in the house slow too? And do you know if you\'re on a septic system or city sewer?';
    scopeAnswer = 'Just the kitchen, bathrooms are fine. We\'re on city sewer. The disposal was acting up last week too.';
    materialMention = 'PVC piping';
    scheduleWindow = 'anytime Wednesday';
  } else if (svc.includes('electric')) {
    issueDesc = 'Half the lights in my living room stopped working and the breaker keeps tripping';
    issueDetail = 'It started about three days ago. Every time I reset the breaker, it trips again after a few minutes. I\'m worried it might be a fire hazard.';
    scopeQuestion = 'Have you added any new appliances recently, and does it happen when you turn on anything specific?';
    scopeAnswer = 'We did get a new space heater for that room. I think it might be related \u2014 it trips when the heater is running and the TV is on.';
    materialMention = 'dedicated circuit';
    scheduleWindow = 'this week \u2014 sooner is better';
  } else if (svc.includes('concrete')) {
    issueDesc = 'I need a new driveway poured \u2014 the old one is all cracked and sinking';
    issueDetail = 'It\'s about a two-car driveway, maybe 40 feet long. There are big cracks running across it and one section has sunk a couple inches.';
    scopeQuestion = 'Do you know the approximate square footage, and is the ground underneath stable or have you noticed any drainage issues in that area?';
    scopeAnswer = 'I\'d guess around 800 square feet. There is a low spot near the garage where water pools when it rains.';
    materialMention = 'reinforced concrete';
    scheduleWindow = 'in the next couple weeks';
  } else if (svc.includes('solar')) {
    issueDesc = 'I\'m interested in getting solar panels installed to lower my electric bills';
    issueDetail = 'My electric bill has been running about $250 a month and I\'ve got a south-facing roof that gets full sun all day. I\'ve been thinking about solar for a while.';
    scopeQuestion = 'Do you know the approximate age and condition of your roof, and have you checked with your HOA about any solar restrictions?';
    scopeAnswer = 'Roof is about 8 years old, in good shape. No HOA, so that shouldn\'t be an issue.';
    materialMention = 'tier-1 panels with microinverters';
    scheduleWindow = 'sometime next week for a site assessment';
  } else if (svc.includes('generator')) {
    issueDesc = 'We lost power three times this winter and I\'m tired of it \u2014 I want a whole-house generator';
    issueDetail = 'We have a 2,400 square foot house. I need it to run the essentials \u2014 furnace, fridge, well pump, a few lights. The outages usually last 4\u20138 hours.';
    scopeQuestion = 'Do you have natural gas service at the property, and is there a suitable flat area within about 3 feet of the meter?';
    scopeAnswer = 'Yes, we have natural gas. There\'s a flat spot on the side of the house right near the meter.';
    materialMention = 'standby generator with automatic transfer switch';
    scheduleWindow = 'this month if possible';
  } else {
    issueDesc = 'I need some work done around the house and wanted to get an estimate';
    issueDetail = desc || 'I\'ve been meaning to get this taken care of for a while and finally have some time to get it done right.';
    scopeQuestion = 'Can you tell me a bit more about the scope \u2014 how large the area is and what your timeline looks like?';
    scopeAnswer = 'It\'s a standard-size job, nothing too complicated. I\'m flexible on timing but would like to get it done in the next month or so.';
    materialMention = 'quality materials';
    scheduleWindow = 'sometime in the next few weeks';
  }

  var priceStr = '$' + Math.round(est).toLocaleString();

  return [
    { speaker: 'ai',    text: 'Thank you for calling NorthStar Solutions. This is the AI office manager \u2014 how can I help you today?' },
    { speaker: 'customer', text: 'Hi, my name is ' + firstName + '. ' + issueDesc + '.' },
    { speaker: 'ai',    text: 'I\'m sorry to hear that, ' + firstName + '. Let me get some details so I can connect you with the right person. Can you tell me a little more about what you\'re seeing?' },
    { speaker: 'customer', text: issueDetail },
    { speaker: 'ai',    text: scopeQuestion },
    { speaker: 'customer', text: scopeAnswer },
    { speaker: 'ai',    text: 'That helps a lot. Based on what you\'ve described, this sounds like a job we can handle. We typically use ' + materialMention + ' for this kind of work, and our team is fully licensed and insured.' },
    { speaker: 'customer', text: 'Great. What kind of price range are we looking at?' },
    { speaker: 'ai',    text: 'For something like this, based on what you\'ve told me, you\'re typically looking in the range of ' + priceStr + '. That\'s an estimate \u2014 our team would do a full assessment on-site and give you a firm quote before any work begins. No obligation.' },
    { speaker: 'customer', text: 'Okay, that\'s reasonable. Can we set up a time for someone to come take a look?' },
    { speaker: 'ai',    text: 'Absolutely. Let me pull up the schedule. What days work best for you \u2014 mornings or afternoons?' },
    { speaker: 'customer', text: scheduleWindow.charAt(0).toUpperCase() + scheduleWindow.slice(1) + ' works for me.' },
    { speaker: 'ai',    text: 'Perfect, I\'ve noted that preference. I\'ll have one of our team members reach out to confirm the exact time. In the meantime, I\'ve captured all your information \u2014 your name, the issue you\'re having, and your availability. You\'ll get a confirmation shortly.' },
    { speaker: 'customer', text: 'Sounds good, thank you!' },
    { speaker: 'ai',    text: 'You\'re welcome, ' + firstName + '. We\'ll be in touch soon. Have a great day!' },
  ];
}

/**
 * Build detailed estimate line items with realistic labor/materials breakdowns.
 */
function buildEstimateItems(serviceName, totalValue) {
  const v = totalValue || 500;
  const svc = (serviceName || '').toLowerCase();
  if (svc.includes('solar') || svc.includes('panel')) {
    return [
      { description: 'Solar Panels', quantity: Math.max(1, Math.round(v / 2500)), unitPrice: 2500 },
      { description: 'Inverter & Electrical', quantity: 1, unitPrice: Math.round(v * 0.12) },
      { description: 'Mounting Hardware', quantity: 1, unitPrice: Math.round(v * 0.08) },
      { description: 'Installation Labor', quantity: 1, unitPrice: Math.round(v * 0.15) },
      { description: 'Permits & Inspection', quantity: 1, unitPrice: Math.round(v * 0.05) }
    ];
  }
  if (svc.includes('generator')) {
    return [
      { description: 'Generator Unit', quantity: 1, unitPrice: Math.round(v * 0.55) },
      { description: 'Transfer Switch', quantity: 1, unitPrice: Math.round(v * 0.15) },
      { description: 'Electrical & Conduit', quantity: 1, unitPrice: Math.round(v * 0.08) },
      { description: 'Concrete Pad', quantity: 1, unitPrice: Math.round(v * 0.07) },
      { description: 'Installation Labor', quantity: 1, unitPrice: Math.round(v * 0.15) }
    ];
  }
  if (svc.includes('roof')) {
    return [
      { description: 'Roofing Materials', quantity: 1, unitPrice: Math.round(v * 0.40) },
      { description: 'Flashing & Accessories', quantity: 1, unitPrice: Math.round(v * 0.10) },
      { description: 'Tear-off & Disposal', quantity: 1, unitPrice: Math.round(v * 0.12) },
      { description: 'Installation Labor', quantity: 1, unitPrice: Math.round(v * 0.30) },
      { description: 'Permits', quantity: 1, unitPrice: Math.round(v * 0.08) }
    ];
  }
  if (svc.includes('concrete')) {
    return [
      { description: 'Concrete Material', quantity: 1, unitPrice: Math.round(v * 0.30) },
      { description: 'Grading & Base Prep', quantity: 1, unitPrice: Math.round(v * 0.15) },
      { description: 'Forms & Reinforcement', quantity: 1, unitPrice: Math.round(v * 0.10) },
      { description: 'Installation Labor', quantity: 1, unitPrice: Math.round(v * 0.35) },
      { description: 'Finishing & Sealing', quantity: 1, unitPrice: Math.round(v * 0.10) }
    ];
  }
  if (svc.includes('hvac')) {
    return [
      { description: 'HVAC Unit', quantity: 1, unitPrice: Math.round(v * 0.45) },
      { description: 'Ductwork', quantity: 1, unitPrice: Math.round(v * 0.15) },
      { description: 'Thermostat & Controls', quantity: 1, unitPrice: Math.round(v * 0.05) },
      { description: 'Installation Labor', quantity: 1, unitPrice: Math.round(v * 0.25) },
      { description: 'Permits', quantity: 1, unitPrice: Math.round(v * 0.10) }
    ];
  }
  return [
    { description: 'Materials', quantity: 1, unitPrice: Math.round(v * 0.35) },
    { description: 'Equipment', quantity: 1, unitPrice: Math.round(v * 0.15) },
    { description: 'Labor', quantity: 1, unitPrice: Math.round(v * 0.40) },
    { description: 'Permits & Fees', quantity: 1, unitPrice: Math.round(v * 0.10) }
  ];
}

router.post('/simulations/leads', requireAuth, async (req, res) => {
  try {
    const { name, phone, email, service, description, estimatedValue } = req.body;

    // ── Validate ──
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Customer name is required', stage: 'validation' });
    }

    const custName = name.trim();
    const svc = service || 'General';
    const estVal = typeof estimatedValue === 'number' && estimatedValue > 0 ? estimatedValue : 500;

    const e = _getEngines();
    if (!e.customers || !e.comms || !e.opps || !e.fin) {
      return res.status(503).json({ error: 'Polaris engines not available', stage: 'engine_init' });
    }

    // ── Step 1: Create customer in Polaris ──
    const custResult = e.customers.createCustomer({
      name: custName,
      phone: phone || '',
      email: email || '',
      address: req.body.address || '',
      status: 'active'
    });
    if (custResult.error) {
      return res.status(400).json({ error: 'Customer creation failed: ' + custResult.error, stage: 'customer' });
    }
    const customerId = custResult.id;

    // ── Step 2: Generate transcript and create communication in Polaris ──
    const transcript = generateTranscript(custName, svc, description, estVal);
    const commResult = e.comms.recordCommunication({
      customerId: customerId,
      type: 'call',
      direction: 'inbound',
      subject: 'Simulated call from ' + custName,
      content: JSON.stringify(transcript),
      status: 'completed'
    });
    if (commResult && commResult.error) {
      return res.status(400).json({ error: 'Communication creation failed: ' + commResult.error, stage: 'communication' });
    }

    // ── Step 3: Create opportunity in Polaris ──
    const oppResult = e.opps.createOpportunity({
      customerId: customerId,
      title: svc + ' - ' + custName,
      description: description || null,
      estimatedValue: estVal,
      stage: 'lead',
      priority: 'medium'
    });
    if (oppResult && oppResult.error) {
      return res.status(400).json({ error: 'Opportunity creation failed: ' + oppResult.error, stage: 'opportunity' });
    }

    // ── Step 4: Create estimate in Polaris ──
    const estResult = e.fin.createEstimate({
      customerId: customerId,
      title: svc + ' - ' + custName,
      description: description || null,
      items: buildEstimateItems(svc, estVal),
      status: 'draft'
    });
    if (estResult && estResult.error) {
      return res.status(400).json({ error: 'Estimate creation failed: ' + estResult.error, stage: 'estimate' });
    }

    // ── Step 5: Create lead in legacy leads store (feeds Leads page) ──
    const leadEntry = addLead({
      customerName: custName,
      callerName: custName,
      phone: phone || '',
      serviceRequested: svc,
      estimatedPrice: estVal,
      jobDetail: description || '',
      source: 'simulation',
      status: 'new',
      callOutcome: 'Lead captured',
    });

    // ── Step 6: Create call record in PostgreSQL if available (feeds Communications page) ──
    let callRecordId = null;
    if (db.isAvailable()) {
      try {
        const crResult = await db.query(`
          INSERT INTO call_records (caller_name, caller_phone, service_type, estimated_price, job_detail, status, outcome, source, is_known_contact)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING id
        `, [
          custName,
          phone || '(555) 000-0000',
          svc,
          estVal,
          description || '',
          'completed',
          'lead-captured',
          'simulation',
          false,
        ]);
        if (crResult.rows && crResult.rows.length > 0) {
          callRecordId = crResult.rows[0].id;
        }
      } catch (dbErr) {
        console.warn('[Simulations] DB call record insert warning:', dbErr.message);
        // Non-fatal — the lead record is the primary data source
      }
    }

    // ── Build response ──
    const summary = {
      name: custName,
      service: svc,
      estimatedValue: estVal,
    };

    const ids = {
      customer: custResult.id,
      communication: commResult ? commResult.id : null,
      opportunity: oppResult ? oppResult.id : null,
      estimate: estResult ? estResult.id : null,
      lead: leadEntry ? leadEntry.id : null,
      callRecord: callRecordId,
    };

    console.log('[Simulations] Lead simulation complete:', JSON.stringify({ summary, ids }));

    res.status(201).json({
      success: true,
      summary,
      ids,
      records: {
        customer: custResult,
        communication: commResult,
        opportunity: oppResult,
        estimate: estResult,
        lead: leadEntry,
      },
      transcript: transcript,
    });

  } catch (err) {
    console.error('[Simulations] Error:', err.message);
    res.status(500).json({ error: 'Simulation failed: ' + err.message, stage: 'unexpected' });
  }
});

module.exports = router;
