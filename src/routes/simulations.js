/**
 * Simulation Endpoint — Universal Polaris Intelligence Pipeline
 *
 * POST /api/v1/simulations/leads
 *
 * Architecture: scenario → transcript → scope → classification → pricing → confidence → action
 *
 * Service-agnostic. New services added to service-catalog.js without modifying this file.
 */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../auth/middleware');
const { addLead } = require('../leads/store');
const db = require('../db');
const pipeline = require('./simulation/pipeline');
const sessionReg = require('./simulation/session-registry');

// ── Polaris Engine Loaders ──
let _engines = {};
function _getEngines() {
  if (!_engines.customers) try { _engines.customers = require('../polaris/customer-engine'); } catch (e) {}
  if (!_engines.comms)    try { _engines.comms    = require('../polaris/communications-engine'); } catch (e) {}
  if (!_engines.opps)     try { _engines.opps     = require('../polaris/opportunity-engine'); } catch (e) {}
  if (!_engines.fin)      try { _engines.fin      = require('../polaris/financial-engine'); } catch (e) {}
  return _engines;
}

router.post('/simulations/leads', requireAuth, async (req, res) => {
  try {
    const { name, phone, email, service } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Customer name is required', stage: 'validation' });
    }

    // ── Session ID for demo lifecycle (clean on page reload) ──
    const sessionId = req.body.sessionId || ('sim_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9));

    const requestedService = (service || 'general').toLowerCase();

    // ── 1. Generate scenario ──
    const scenario = pipeline.generateScenario(requestedService, name.trim());
    if (!scenario) return res.status(400).json({ error: 'Could not generate scenario for service: ' + service });

    const svc = pipeline.CATALOG[scenario.serviceKey];
    if (phone) scenario.customer.phone = phone;
    if (email) scenario.customer.email = email;

    // ── 2. Generate adaptive transcript ──
    const transcript = pipeline.generateTranscript(scenario, svc);

    // ── 3. Extract scope from transcript ──
    const { extracted: scopeEvidence, evidence, missing: missingInfo } = pipeline.extractScope(transcript, scenario);

    // ── 4. Classify service ──
    const classification = pipeline.classifyService(transcript);

    // ── 5. Calculate pricing ──
    const pricingResult = pipeline.calculatePricing(scopeEvidence, classification.service);

    // ── 6. Score confidence ──
    const confidence = pipeline.calculateConfidence(scopeEvidence, missingInfo, scenario.serviceKey);

    // ── 7. Select action ──
    const recommendedAction = pipeline.selectAction(transcript, scenario.customer.name, scopeEvidence);

    // ── Create canonical records ──
    const e = _getEngines();
    if (!e.customers || !e.comms || !e.opps || !e.fin) {
      return res.status(503).json({ error: 'Polaris engines not available', stage: 'engine_init' });
    }

    const cust = scenario.customer;
    const total = pricingResult.total || 500;

    // Customer
    const custResult = e.customers.createCustomer({
      name: cust.name, phone: cust.phone || '', email: cust.email || '',
      address: cust.address || '', status: 'active',
    });
    if (custResult.error) return res.status(400).json({ error: 'Customer creation failed: ' + custResult.error, stage: 'customer' });
    if (custResult.id) sessionReg.register(sessionId, custResult.id);

    // Communication
    const commResult = e.comms.recordCommunication({
      customerId: custResult.id, type: 'call', direction: 'inbound',
      subject: 'Simulated call from ' + cust.name,
      content: JSON.stringify(transcript), status: 'completed',
    });
    if (commResult && commResult.id) sessionReg.register(sessionId, commResult.id);

    // Opportunity — clean service name, no customer name appended
    const oppResult = e.opps.createOpportunity({
      customerId: custResult.id,
      title: classification.service,
      description: scopeEvidence.description || '',
      estimatedValue: total,
      stage: 'lead',
      priority: recommendedAction.priority || 'medium',
    });
    if (oppResult && oppResult.id) sessionReg.register(sessionId, oppResult.id);

    // Estimate
    const estItems = (pricingResult.breakdown || []).map(b => ({
      description: b.label || b.description, quantity: 1, unitPrice: b.amount, total: b.amount,
    }));
    if (estItems.length === 0) {
      estItems.push(
        { description: 'Materials', quantity: 1, unitPrice: Math.round(total * 0.35) },
        { description: 'Labor', quantity: 1, unitPrice: Math.round(total * 0.40) },
        { description: 'Equipment', quantity: 1, unitPrice: Math.round(total * 0.15) },
        { description: 'Permits & fees', quantity: 1, unitPrice: Math.round(total * 0.10) },
      );
    }

    const estResult = e.fin.createEstimate({
      customerId: custResult.id,
      title: classification.service + ' Estimate',
      description: JSON.stringify({ scope: scopeEvidence, evidence, missing: missingInfo, confidence, recommendedAction }),
      items: estItems,
      status: 'draft',
    });
    if (estResult && estResult.id) sessionReg.register(sessionId, estResult.id);

    // Legacy lead
    const leadEntry = addLead({
      customerName: cust.name, callerName: cust.name,
      phone: cust.phone || '', serviceRequested: classification.service,
      estimatedPrice: total, jobDetail: scopeEvidence.description || '',
      source: 'simulation', status: 'new', callOutcome: 'Lead captured',
    });
    if (leadEntry && leadEntry.id) sessionReg.register(sessionId, leadEntry.id);

    // PostgreSQL
    let callRecordId = null;
    if (db.isAvailable()) {
      try {
        const cr = await db.query(
          `INSERT INTO call_records (caller_name, caller_phone, service_type, estimated_price, job_detail, status, outcome, source, is_known_contact) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [cust.name, cust.phone || '(555) 000-0000', classification.service, total, '', 'completed', 'lead-captured', 'simulation', false]
        );
        if (cr.rows && cr.rows.length > 0) callRecordId = cr.rows[0].id;
      } catch (e) { console.warn('[Sim] DB:', e.message); }
    }

    // Polaris intelligence object
    const priceDisplay = confidence.score >= 80
      ? '$' + total.toLocaleString()
      : (confidence.score >= 50
        ? '$' + (pricingResult.range ? pricingResult.range.low.toLocaleString() : '?') + '–$' + (pricingResult.range ? pricingResult.range.high.toLocaleString() : '?')
        : 'Insufficient information — schedule on-site assessment');

    const polarisIntel = {
      detectedIntent: 'Customer requests ' + classification.service.toLowerCase(),
      classifiedService: classification.service,
      classificationConfidence: classification.confidence,
      alternatives: classification.alternatives,
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
      pricingBreakdown: pricingResult.breakdown || [],
      confidence,
      operationalReasoning: confidence.score >= 80 ? 'Sufficient scope for reliable estimate.' : 'Incomplete scope — recommend on-site assessment.',
    };

    console.log('[Simulations] Complete:', JSON.stringify({
      service: classification.service, total, confidence: confidence.score, turns: transcript.length,
    }));

    res.status(201).json({
      success: true,
      sessionId: sessionId,
      summary: { name: cust.name, service: classification.service, estimatedValue: total },
      ids: {
        customer: custResult.id, communication: commResult ? commResult.id : null,
        opportunity: oppResult ? oppResult.id : null, estimate: estResult ? estResult.id : null,
        lead: leadEntry ? leadEntry.id : null, callRecord: callRecordId,
      },
      records: { customer: custResult, communication: commResult, opportunity: oppResult, estimate: estResult, lead: leadEntry },
      transcript,
      polaris: polarisIntel,
    });
  } catch (err) {
    console.error('[Simulations] Error:', err.message);
    res.status(500).json({ error: 'Simulation failed: ' + err.message, stage: 'unexpected' });
  }
});

module.exports = router;
