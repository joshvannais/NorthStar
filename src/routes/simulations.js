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
 */
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

    // ── Step 2: Create communication in Polaris ──
    const commResult = e.comms.recordCommunication({
      customerId: customerId,
      type: 'call',
      direction: 'inbound',
      subject: 'Simulated call from ' + custName,
      content: description || 'Simulated customer interaction',
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
    });

  } catch (err) {
    console.error('[Simulations] Error:', err.message);
    res.status(500).json({ error: 'Simulation failed: ' + err.message, stage: 'unexpected' });
  }
});

module.exports = router;