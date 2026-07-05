/**
 * API routes for Northstar Solutions.
 */

const express = require('express');
const { getAllLeads, getLead } = require('../leads/store');
const { handleWebhook } = require('../retell/webhook');
const { scheduleEstimate } = require('../calendar/client');
const db = require('../db');

const router = express.Router();

/**
 * GET /api/health
 * Health check endpoint.
 */
router.get('/health', (req, res) => {
      res.json({ status: 'ok', service: 'northstar-solutions', version: '1.0.0' });
    });

    /**
     * GET /api/stats
     * Return aggregate stats: total calls, total revenue, served from database.
     */
    router.get('/stats', async (req, res) => {
      if (!db.isAvailable()) {
        return res.json({ totalCalls: 0, totalRevenue: 0 });
      }
      try {
        const result = await db.query('SELECT COUNT(*)::int AS calls, COALESCE(SUM(estimated_price), 0)::float AS revenue FROM call_records');
        res.json({
          totalCalls: result.rows[0].calls,
          totalRevenue: Math.round(result.rows[0].revenue),
        });
      } catch (err) {
        console.error('[API] Stats error:', err.message);
        res.json({ totalCalls: 0, totalRevenue: 0 });
      }
    });

    /**
     * POST /api/calls/record
     * Record a simulated call with pricing data from the engine.
     */
    router.post('/calls/record', async (req, res) => {
      if (!db.isAvailable()) {
        return res.json({ success: true, note: 'DB not available, call not persisted' });
      }
      try {
        const { callerName, serviceType, estimatedPrice, jobDetail, source } = req.body;
        await db.query(
          'INSERT INTO call_records (caller_name, service_type, estimated_price, job_detail, source) VALUES ($1, $2, $3, $4, $5)',
          [callerName || '', serviceType || 'Unknown', estimatedPrice || 0, jobDetail || '', source || 'simulator']
        );
        res.json({ success: true });
      } catch (err) {
        console.error('[API] Record call error:', err.message);
        res.status(500).json({ error: 'Failed to record call' });
      }
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
/**
 * POST /api/contact
 * Submit a contact form message.
 */
router.post('/contact', async (req, res) => {
  try {
    const { name, email, subject, message } = req.body;
    if (!name || !email || !subject || !message) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    
    const fs = require('fs');
    const path = require('path');
    const contactsDir = path.join(__dirname, '..', '..', 'data');
    if (!fs.existsSync(contactsDir)) fs.mkdirSync(contactsDir, { recursive: true });
    
    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name,
      email,
      subject,
      message,
      createdAt: new Date().toISOString(),
      status: 'new'
    };
    
    const filePath = path.join(contactsDir, 'contact-messages.json');
    let messages = [];
    if (fs.existsSync(filePath)) {
      messages = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
    messages.push(entry);
    fs.writeFileSync(filePath, JSON.stringify(messages, null, 2));
    
    console.log(`[Contact] New message from ${name} (${email}): ${subject}`);
    res.json({ success: true, message: 'Message received. We\'ll get back to you soon.' });
  } catch (err) {
    console.error('[Contact] Error:', err.message);
    res.status(500).json({ error: 'Failed to submit message' });
  }
});

/**
 * GET /api/contact/messages
 * List contact messages (internal use).
 */
router.get('/contact/messages', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const filePath = path.join(__dirname, '..', '..', 'data', 'contact-messages.json');
  if (fs.existsSync(filePath)) {
    const messages = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return res.json({ messages, count: messages.length });
  }
  res.json({ messages: [], count: 0 });
});
