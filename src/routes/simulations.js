/**
 * Simulation Endpoint - Universal Polaris Intelligence Pipeline
 *
 * POST /api/v1/simulations/leads
 * scenario -> transcript -> scope -> classification -> pricing -> confidence -> action
 */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../auth/middleware');
const { addLead } = require('../leads/store');
const db = require('../db');
const pipeline = require('./simulation/pipeline');
const sessionReg = require('./simulation/session-registry');
const demoScope = require('../services/demoRecordScope');
const canonicalPolaris = require('../services/canonicalPolaris');
const businessProfile = require('../services/businessProfile');

let _engines = {};
function _getEngines() {
  if (!_engines.customers) try { _engines.customers = require('../polaris/customer-engine'); } catch (e) {}
  if (!_engines.comms) try { _engines.comms = require('../polaris/communications-engine'); } catch (e) {}
  if (!_engines.opps) try { _engines.opps = require('../polaris/opportunity-engine'); } catch (e) {}
  if (!_engines.fin) try { _engines.fin = require('../polaris/financial-engine'); } catch (e) {}
  return _engines;
}

router.post('/simulations/leads', requireAuth, async (req, res) => {
  try {
    const { name, phone, email, service } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Customer name is required', stage: 'validation' });
    }

    const sessionId = req.body.sessionId || ('sim_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9));
    const requestedService = (service || 'general').toLowerCase();
    const scenario = pipeline.generateScenario(requestedService, name.trim());
    if (!scenario) return res.status(400).json({ error: 'Could not generate scenario for service: ' + service });

    const serviceDefinition = pipeline.CATALOG[scenario.serviceKey];
    if (phone) scenario.customer.phone = phone;
    if (email) scenario.customer.email = email;

    const transcript = pipeline.generateTranscript(scenario, serviceDefinition);
    const extraction = pipeline.extractScope(transcript, scenario);
    const scopeEvidence = extraction.extracted;
    const evidence = extraction.evidence;
    const missingInfo = extraction.missing;
    const classification = pipeline.classifyService(transcript);
    const pricingResult = pipeline.calculatePricing(scopeEvidence, classification.service);
    const confidence = pipeline.calculateConfidence(scopeEvidence, missingInfo, scenario.serviceKey);
    const recommendedAction = pipeline.selectAction(transcript, scenario.customer.name, scopeEvidence);

    const polarisIntel = canonicalPolaris.build({
      serviceKey: scenario.serviceKey,
      classification: classification,
      scope: scopeEvidence,
      evidence: evidence,
      missingInformation: missingInfo,
      pricing: pricingResult,
      confidence: confidence,
      recommendedAction: recommendedAction,
      businessProfile: businessProfile.getProfile(),
    });
    const metadata = demoScope.createMetadata(sessionId, { polarisIntelligence: polarisIntel });

    const e = _getEngines();
    if (!e.customers || !e.comms || !e.opps || !e.fin) {
      return res.status(503).json({ error: 'Polaris engines not available', stage: 'engine_init' });
    }

    const customer = scenario.customer;
    const supportedTotal = typeof polarisIntel.customerFacingPrice === 'number'
      ? polarisIntel.customerFacingPrice : 0;

    const custResult = e.customers.createCustomer({
      name: customer.name,
      phone: customer.phone || '',
      email: customer.email || '',
      address: customer.address || '',
      status: 'active',
      metadata: metadata,
    });
    if (custResult.error) return res.status(400).json({ error: 'Customer creation failed: ' + custResult.error, stage: 'customer' });
    sessionReg.register(sessionId, custResult.id);

    const commResult = e.comms.recordCommunication({
      customerId: custResult.id,
      type: 'call',
      direction: 'inbound',
      subject: 'Simulated call from ' + customer.name,
      content: JSON.stringify(transcript),
      status: 'completed',
      metadata: metadata,
    });
    if (commResult && commResult.id) sessionReg.register(sessionId, commResult.id);

    const oppResult = e.opps.createOpportunity({
      customerId: custResult.id,
      title: classification.service,
      description: scopeEvidence.description || '',
      estimatedValue: supportedTotal,
      stage: 'lead',
      priority: recommendedAction.priority || 'medium',
      metadata: metadata,
    });
    if (oppResult && oppResult.id) sessionReg.register(sessionId, oppResult.id);

    const estimateItems = (polarisIntel.pricingBreakdown || []).filter(function (item) {
      return Number(item.amount) > 0;
    }).map(function (item) {
      return { description: item.label, quantity: 1, unitPrice: item.amount };
    });

    const estResult = e.fin.createEstimate({
      customerId: custResult.id,
      opportunityId: oppResult && oppResult.id,
      title: classification.service + ' Preliminary Estimate',
      items: estimateItems,
      status: 'draft',
      notes: polarisIntel.pricingRecommendation,
      metadata: metadata,
    });
    if (estResult && estResult.id) sessionReg.register(sessionId, estResult.id);

    const leadEntry = addLead({
      customerName: customer.name,
      callerName: customer.name,
      phone: customer.phone || '',
      serviceRequested: classification.service,
      estimatedPrice: supportedTotal,
      jobDetail: scopeEvidence.description || '',
      source: 'simulation',
      recordScope: 'simulation',
      simulationSessionId: sessionId,
      demoSessionId: sessionId,
      canonicalCustomerId: custResult.id,
      canonicalOpportunityId: oppResult && oppResult.id,
      canonicalEstimateId: estResult && estResult.id,
      canonicalCommunicationId: commResult && commResult.id,
      status: 'new',
      callOutcome: 'Lead captured',
    });
    if (leadEntry && leadEntry.id) sessionReg.register(sessionId, leadEntry.id);

    let callRecordId = null;
    if (db.isAvailable()) {
      try {
        const callRecord = await db.query(
          `INSERT INTO call_records (caller_name, caller_phone, service_type, estimated_price, job_detail, status, outcome, source, is_known_contact) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [
            customer.name,
            customer.phone || '(555) 000-0000',
            classification.service,
            supportedTotal,
            scopeEvidence.description || '',
            'completed',
            'lead-captured',
            'simulation',
            false,
          ]
        );
        if (callRecord.rows && callRecord.rows.length > 0) callRecordId = callRecord.rows[0].id;
      } catch (dbError) {
        console.warn('[Simulations] DB:', dbError.message);
      }
    }

    console.log('[Simulations] Complete:', JSON.stringify({
      sessionId: sessionId,
      customerId: custResult.id,
      opportunityId: oppResult && oppResult.id,
      estimateId: estResult && estResult.id,
      communicationId: commResult && commResult.id,
      service: classification.service,
      supportedTotal: supportedTotal,
      confidence: polarisIntel.confidenceScore,
    }));

    // Keep the v1 transport backward-compatible while the persisted object
    // remains the canonical Polaris schema used by every destination page.
    const responsePolaris = Object.assign(canonicalPolaris.sanitize(polarisIntel), {
      detectedIntent: polarisIntel.customerIntent,
      classifiedService: polarisIntel.service,
      classificationConfidence: polarisIntel.serviceClassification.confidence,
      alternatives: polarisIntel.serviceClassification.alternatives,
      evidence: Object.values(polarisIntel.supportingEvidence || {}),
      extractedScope: Object.keys(polarisIntel.scope || {}).map(function (key) {
        return key + ': ' + polarisIntel.scope[key];
      }),
      qualificationStatus: polarisIntel.qualification,
      confidence: confidence,
    });

    res.status(201).json({
      success: true,
      sessionId: sessionId,
      summary: { name: customer.name, service: classification.service, estimatedValue: supportedTotal },
      ids: {
        customer: custResult.id,
        communication: commResult ? commResult.id : null,
        opportunity: oppResult ? oppResult.id : null,
        estimate: estResult ? estResult.id : null,
        lead: leadEntry ? leadEntry.id : null,
        callRecord: callRecordId,
      },
      records: { customer: custResult, communication: commResult, opportunity: oppResult, estimate: estResult, lead: leadEntry },
      transcript: transcript,
      polaris: responsePolaris,
    });
  } catch (err) {
    console.error('[Simulations] Error:', err.message);
    res.status(500).json({ error: 'Simulation failed: ' + err.message, stage: 'unexpected' });
  }
});

module.exports = router;
