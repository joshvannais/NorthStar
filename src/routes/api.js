/**
 * API routes for Northstar Solutions.
 */

const express = require('express');
const { getAllLeads, getLead } = require('../leads/store');
const demoRouter = require('./demo');
const { scheduleEstimate } = require('../calendar/client');
const db = require('../db');
const config = require('../config');
const { AccountRepository } = require('../accounts/repository');
const { createJobberIntegrationRouter } = require('./jobberIntegration');
const {
  requireOnboardedInternal,
  requireTenantAccess,
  requireVerifiedExternalAction,
} = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { createCanonicalVoiceCall } = require('../services/canonicalVoiceSessionCreation');
const { getDataRoot, dataPath } = require('../services/dataRoot');
const safeLogger = require('../observability/safeLogger');

const router = express.Router();

// ══════════════════════════════════════════════
// PUBLIC ROUTES — no authentication required
// ══════════════════════════════════════════════

/**
 * GET /api/health
 * Health check endpoint with actual component status.
 */
router.get('/health', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const dataDir = getDataRoot();
  const now = new Date().toISOString();

  // Check data directory
  const dataDirOk = fs.existsSync(dataDir);
  const leadsOk = dataDirOk && fs.existsSync(path.join(dataDir, 'leads.json'));

  // Check database
  const dbOk = db.isAvailable();

  // Check config
  const retellOk = !!(process.env.RETELL_API_KEY || config.retell.apiKey);
  const twilioOk = !!(process.env.TWILIO_ACCOUNT_SID || config.twilio.accountSid);

  // Overall status
  const components = {
    dataDirectory: dataDirOk ? 'healthy' : 'degraded',
    leadsFile: leadsOk ? 'healthy' : 'degraded',
    database: dbOk ? 'healthy' : 'unavailable',
    retellAI: retellOk ? 'healthy' : 'unconfigured',
    twilio: twilioOk ? 'healthy' : 'unconfigured',
  };

  const allHealthy = Object.values(components).every(s => s === 'healthy' || s === 'unconfigured');
  const status = allHealthy ? 'ok' : 'degraded';

  res.status(dbOk ? 200 : 503).json({
    status,
    service: 'northstar-solutions',
    version: '1.0.0',
    timestamp: now,
    uptime: process.uptime(),
    components,
  });
});

/**
 * POST /api/contact
 * Submit a contact form message. PUBLIC — contact form.
 */
router.post('/contact', async (req, res) => {
  try {
    const { name, email, subject, message } = req.body;
    if (!name || !email || !subject || !message) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    
    const fs = require('fs');
    const path = require('path');
    const contactsDir = getDataRoot();
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

// Demo routes — public interactive demo
router.use('/demo', demoRouter);
// ══════════════════════════════════════════════
// PROTECTED ROUTES — authentication required
// ══════════════════════════════════════════════
    /**
     * GET /api/stats
     * Return aggregate stats: total calls, total revenue, served from database.
     */
    router.get('/stats', requireTenantAccess, async (req, res) => {
      if (!db.isAvailable()) {
        return res.json({ totalCalls: 0, totalRevenue: 0, appointmentsBooked: 0 });
      }
      try {
        const result = await db.query("SELECT COUNT(*)::int AS calls, COALESCE(SUM(estimated_price), 0)::float AS revenue, COUNT(*) FILTER (WHERE outcome = 'appointment-set')::int AS appointments FROM call_records WHERE source = 'real'");
        res.json({
          totalCalls: result.rows[0].calls,
          totalRevenue: Math.round(result.rows[0].revenue),
          appointmentsBooked: result.rows[0].appointments,
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
    router.post('/calls/record', requireOnboardedInternal, async (req, res) => {
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
router.get('/leads', requireTenantAccess, (req, res) => {
  const leads = getAllLeads();
  res.json({ items: leads, count: leads.length });
});

/**
 * GET /api/leads/export
 * Export all leads as CSV.
 */
router.get('/leads/export', requireVerifiedExternalAction, requirePermission('leads', 'read'), (req, res) => {
  const { getAllLeads } = require('../leads/store');
  const leads = getAllLeads();
  const fields = ['id','caller','customerName','phone','phoneNumber','service','serviceRequested','status','avgPrice','address','jobAddress','receivedAt','updatedAt','duration','outcome','summary','transcript'];
  const header = fields.join(',');
  const rows = leads.map(function(l) {
    return fields.map(function(f) {
      var val = l[f] !== undefined && l[f] !== null ? String(l[f]) : '';
      if (val.includes(',') || val.includes('"') || val.includes('\n')) {
        val = '"' + val.replace(/"/g, '""') + '"';
      }
      return val;
    }).join(',');
  });
  var csv = '\ufeff' + header + '\n' + rows.join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=leads-export-' + new Date().toISOString().slice(0,10) + '.csv');
  res.send(csv);
});

/**
 * GET /api/leads/:id
 * Return a single lead by ID.
 */
router.get('/leads/:id', requireTenantAccess, (req, res) => {
  const lead = getLead(req.params.id);
  if (!lead) {
    return res.status(404).json({ error: 'Lead not found' });
  }
  res.json(lead);
});

/**
 * POST /api/leads
 * Create a new lead.
 */
router.post('/leads', requireOnboardedInternal, requirePermission('leads', 'create'), (req, res) => {
  const { addLead } = require('../leads/store');
  const lead = addLead(req.body);
  res.json({ success: true, lead });
});

/**
 * PUT /api/leads/:id
 * Update an existing lead.
 */
router.put('/leads/:id', requireOnboardedInternal, requirePermission('leads', 'update'), (req, res) => {
  const { updateLead } = require('../leads/store');
  const updated = updateLead(req.params.id, req.body);
  if (!updated) {
    return res.status(404).json({ error: 'Lead not found' });
  }
  res.json({ success: true, lead: updated });
});

/**
 * DELETE /api/leads/:id
 * Delete a lead.
 */
router.delete('/leads/:id', requireOnboardedInternal, requirePermission('leads', 'delete'), (req, res) => {
  const { removeLead } = require('../leads/store');
  const removed = removeLead(req.params.id);
  if (!removed) {
    return res.status(404).json({ error: 'Lead not found' });
  }
  res.json({ success: true });
});

/**
 * POST /api/leads/import
 * Import leads from CSV file upload.
 */
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
router.post('/leads/import', requireOnboardedInternal, requirePermission('leads', 'create'), upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { addLead } = require('../leads/store');
    var csv = req.file.buffer.toString('utf8');
    if (csv.charCodeAt(0) === 0xFEFF) csv = csv.slice(1);
    var lines = csv.split('\n').filter(function(l) { return l.trim(); });
    if (lines.length < 2) return res.status(400).json({ error: 'CSV must have a header row and at least one data row' });
    var headers = lines[0].split(',').map(function(h) { return h.trim().replace(/^"(.*)"$/, '$1'); });
    var imported = 0, errors = [], skipped = 0;
    for (var i = 1; i < lines.length; i++) {
      try {
        var vals = [], current = '', inQuotes = false;
        for (var c = 0; c < lines[i].length; c++) {
          var ch = lines[i][c];
          if (ch === '"') {
            if (inQuotes && c + 1 < lines[i].length && lines[i][c+1] === '"') {
              current += '"'; c++;
            } else {
              inQuotes = !inQuotes;
            }
          } else if (ch === ',' && !inQuotes) {
            vals.push(current.trim()); current = '';
          } else {
            current += ch;
          }
        }
        vals.push(current.trim());
        var lead = {};
        for (var j = 0; j < headers.length && j < vals.length; j++) {
          if (vals[j]) lead[headers[j]] = vals[j];
        }
        if (lead.caller || lead.customerName || lead.phone || lead.phoneNumber) {
          addLead(lead);
          imported++;
        } else {
          skipped++;
        }
      } catch(e) {
        errors.push({ row: i + 1, error: e.message });
      }
    }
    res.json({ success: true, imported: imported, skipped: skipped, errors: errors.length > 0 ? errors : undefined });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/leads/simulate
 * Simulate a lead for testing (without needing a real phone call).
 */
router.post('/leads/simulate', requireVerifiedExternalAction, requirePermission('leads', 'create'), async (req, res) => {
  const { addLead } = require('../leads/store');
  const { appendLead } = require('../sheets/client');
  const { sendLeadNotification: sendSms } = require('../notifications/sms');
  const { sendLeadNotification: sendEmail } = require('../notifications/email');

  let preferences;
  try {
    preferences = await new AccountRepository().accountPreferences(req.tenantContext.organizationId);
  } catch (_error) {
    return res.status(503).json({
      error: 'Notification preferences are unavailable',
      code: 'notification_preferences_unavailable',
      requestId: req.requestId || req.correlationId || 'unavailable',
    });
  }
  if (!preferences) {
    return res.status(503).json({
      error: 'Notification preferences are unavailable',
      code: 'notification_preferences_unavailable',
      requestId: req.requestId || req.correlationId || 'unavailable',
    });
  }

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
  const notifications = [];
  if (preferences.sms_new_lead === true && preferences.notification_phone) {
    notifications.push(sendSms(lead, preferences.notification_phone));
  }
  if (preferences.email_new_lead === true && preferences.notification_email) {
    notifications.push(sendEmail(lead, preferences.notification_email));
  }
  await Promise.allSettled(notifications);

  res.json({ success: true, lead });
});

/**
 * POST /api/calendar/schedule
 * Schedule an estimate appointment from a lead.
 */
router.post('/calendar/schedule', requireVerifiedExternalAction, requirePermission('calendar', 'create'), async (req, res) => {
  const lead = getLead(req.body.leadId);
  if (!lead) {
    return res.status(404).json({ error: 'Lead not found' });
  }

  const result = await scheduleEstimate(lead, req.body.calendarId);
  res.json(result);
});

/**
 * POST /api/retell/create-agent
 * Retained compatibility boundary for the retired request-body provider mutation.
 */
router.post('/retell/create-agent', requireVerifiedExternalAction, requirePermission('integrations', 'create'), async (req, res) => {
  return res.status(410).json({
    success: false,
    error: {
      code: 'LEGACY_PROVIDER_MUTATION_DISABLED',
      message: 'Request-body provider agent creation is disabled. Configure canonical Voice & Knowledge settings instead.',
    },
  });
});

/**
 * POST /api/retell/create-call
 * Initiate an outbound call via the active Retell AI agent.
 */
router.post('/retell/create-call', requireVerifiedExternalAction, requirePermission('calls', 'create'), async (req, res) => {
  try {
    const created = await createCanonicalVoiceCall({
      pool: db.getPool(),
      organizationId: req.tenantContext.organizationId,
      phoneNumber: req.body && req.body.phoneNumber,
      service: req.body && req.body.service,
      caller: req.body && req.body.caller,
      fromNumber: config.retell && config.retell.phoneNumber,
      source: 'api-retell-create-call',
    });
    res.json({
      success: true,
      callId: created.result.call_id,
      status: created.result.call_status,
      profile: created.session.profile,
      session: created.session,
      canonicalGraphPendingWebhook: true,
    });
  } catch (err) {
    safeLogger.error('retell', 'create_call_failed', {
      requestId: req.requestId || req.correlationId || 'unavailable',
      statusCode: err && Number.isInteger(err.status) ? err.status : 503,
    });
    const status = err && err.status ? err.status : 503;
    res.status(status).json({
      success: false,
      error: {
        code: err && err.code ? err.code : 'CANONICAL_PERSISTENCE_UNAVAILABLE',
        message: status === 503 ? 'Canonical PostgreSQL persistence is unavailable.' : err.message,
      },
    });
  }
});

/**
 * POST /api/retell/verify
 * Verify the Retell API key and agent configuration.
 */
router.post('/retell/verify', requireVerifiedExternalAction, requirePermission('integrations', 'read'), async (req, res) => {
  try {
    const { verifyApiKey } = require('../retell/client');
    const result = await verifyApiKey();
    res.json(result);
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

/**
 * POST /api/retell/send-sms
 * Send an SMS via the configured provider.
 */
router.post('/retell/send-sms', requireVerifiedExternalAction, requirePermission('calls', 'create'), async (req, res) => {
  try {
    const { sendSMS } = require('../retell/client');
    const result = await sendSMS(req.body.phoneNumber, req.body.message);
    res.json(result);
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// A reviewed source change is required before production can enable Jobber
// OAuth. Process environment and request values cannot create this capability.
router.use('/integrations/jobber', createJobberIntegrationRouter());

/**
 * GET /api/contact/messages
 * List contact messages (internal use).
 */
router.get('/contact/messages', requireTenantAccess, (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const filePath = dataPath('contact-messages.json');
  if (fs.existsSync(filePath)) {
    const messages = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return res.json({ messages, count: messages.length });
  }
  res.json({ messages: [], count: 0 });
});

module.exports = router;
