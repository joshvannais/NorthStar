/**
 * API routes for Northstar Solutions.
 */

const express = require('express');
const { getAllLeads, getLead } = require('../leads/store');
const { handleWebhook } = require('../retell/webhook');
const { scheduleEstimate } = require('../calendar/client');

const router = express.Router();

/**
 * GET /api/health
 * Health check endpoint.
 */
router.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'northstar-solutions', version: '1.0.0' });
});

/**
 * GET /api/leads
 * Return all leads (for testing/demo purposes).
 */
router.get('/leads', (req, res) => {
  const leads = getAllLeads();
  res.json({ items: leads, count: leads.length });
});

/**
 * GET /api/leads/:id
 * Return a single lead by ID.
 */
router.get('/leads/:id', (req, res) => {
  const lead = getLead(req.params.id);
  if (!lead) {
    return res.status(404).json({ error: 'Lead not found' });
  }
  res.json(lead);
});

/**
 * POST /api/retell/webhook
 * Receive call events from Retell AI.
 */
router.post('/retell/webhook', async (req, res) => {
  try {
    const result = await handleWebhook(req.body);
    res.json(result);
  } catch (err) {
    console.error('[API] Webhook error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/leads/simulate
 * Simulate a lead for testing (without needing a real phone call).
 */
router.post('/leads/simulate', async (req, res) => {
  const { addLead } = require('../leads/store');
  const { appendLead } = require('../sheets/client');
  const { sendLeadNotification: sendSms } = require('../notifications/sms');
  const { sendLeadNotification: sendEmail } = require('../notifications/email');

  const lead = addLead({
    customerName: req.body.customerName || 'John Smith',
    phoneNumber: req.body.phoneNumber || '(555) 123-4567',
    address: req.body.address || '123 Oak Street',
    serviceRequested: req.body.serviceRequested || 'Tree removal',
    preferredTime: req.body.preferredTime || 'Tuesday afternoon',
    urgency: req.body.urgency || '',
    callOutcome: 'Lead captured',
    notes: req.body.notes || 'Simulated lead for testing',
  });

  await appendLead(lead);
  await Promise.allSettled([sendSms(lead), sendEmail(lead)]);

  res.json({ success: true, lead });
});

/**
 * POST /api/calendar/schedule
 * Schedule an estimate appointment from a lead.
 */
router.post('/calendar/schedule', async (req, res) => {
  const lead = getLead(req.body.leadId);
  if (!lead) {
    return res.status(404).json({ error: 'Lead not found' });
  }

  const result = await scheduleEstimate(lead, req.body.calendarId);
  res.json(result);
});

/**
 * POST /api/retell/create-agent
 * Create a new Retell AI agent for a contractor.
 */
router.post('/retell/create-agent', async (req, res) => {
  const { createAgent } = require('../retell/client');
  const result = await createAgent({
    name: req.body.name || 'Northstar Receptionist',
    companyName: req.body.companyName || 'Your Company',
    services: req.body.services || 'home services',
    scheduleUrl: req.body.scheduleUrl,
  });
  res.json(result || { error: 'Retell API not configured' });
});

module.exports = router;