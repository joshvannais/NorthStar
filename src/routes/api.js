/**
 * API routes for Northstar Solutions.
 */

const express = require('express');
const { getAllLeads, getLead } = require('../leads/store');
const { getDiagnostics } = require('../retell/webhook');
const { handleCanonicalRetellWebhook } = require('../services/canonicalRetellIngestion');
const demoRouter = require('./demo');
const { scheduleEstimate } = require('../calendar/client');
const db = require('../db');
const jobber = require('../integrations/jobber');
const config = require('../config');
const { requireAuth } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { getOrganizationIntegration } = require('../services/organizationAuthority');
const { getDataRoot, dataPath } = require('../services/dataRoot');

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

  res.json({
    status,
    service: 'northstar-solutions',
    version: '1.0.0',
    timestamp: now,
    uptime: process.uptime(),
    components,
  });
});

/**
 * POST /api/retell/webhook
 * Receive call events from Retell AI. PUBLIC — external webhook.
 */
router.post('/retell/webhook', handleCanonicalRetellWebhook);

/**
 * GET /api/retell/webhook/diagnostics
 * Returns webhook pipeline diagnostics: event count, recent events,
 * active demo sessions, and Retell configuration status.
 * PUBLIC — used for debugging the webhook pipeline.
 */
router.get('/retell/webhook/diagnostics', (req, res) => {
  try {
    const diagnostics = getDiagnostics();
    res.json(diagnostics);
  } catch (err) {
    console.error('[API] Webhook diagnostics error:', err.message);
    res.status(500).json({ error: 'Failed to gather diagnostics' });
  }
});

/**
 * GET /api/retell/webhook/config
 * Returns the configured webhook URL and Retell setup info.
 * PUBLIC — used to verify webhook registration.
 */
router.get('/retell/webhook/config', (req, res) => {
  try {
    const config = require('../config');
    res.json({
      webhookUrl: `https://northstar-os.ai/api/retell/webhook`,
      retellConfigured: !!(config.retell && config.retell.apiKey),
      canonicalOwnershipRequired: true,
      note: 'Configure this URL in your Retell dashboard → Agent settings → Webhook URL',
    });
  } catch (err) {
    console.error('[API] Webhook config error:', err.message);
    res.status(500).json({ error: 'Failed to load config' });
  }
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
    router.get('/stats', requireAuth, async (req, res) => {
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
    router.post('/calls/record', requireAuth, async (req, res) => {
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
router.get('/leads', requireAuth, (req, res) => {
  const leads = getAllLeads();
  res.json({ items: leads, count: leads.length });
});

/**
 * GET /api/leads/export
 * Export all leads as CSV.
 */
router.get('/leads/export', requireAuth, (req, res) => {
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
router.get('/leads/:id', requireAuth, (req, res) => {
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
router.post('/leads', requireAuth, (req, res) => {
  const { addLead } = require('../leads/store');
  const lead = addLead(req.body);
  res.json({ success: true, lead });
});

/**
 * PUT /api/leads/:id
 * Update an existing lead.
 */
router.put('/leads/:id', requireAuth, (req, res) => {
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
router.delete('/leads/:id', requireAuth, (req, res) => {
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
router.post('/leads/import', requireAuth, upload.single('file'), (req, res) => {
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
router.post('/leads/simulate', requireAuth, async (req, res) => {
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
router.post('/calendar/schedule', requireAuth, async (req, res) => {
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
router.post('/retell/create-agent', requireAuth, requirePermission('integrations', 'create'), async (req, res) => {
  const { createAgent } = require('../retell/client');
  const result = await createAgent({
    name: req.body.name || 'Northstar Receptionist',
    companyName: req.body.companyName || 'Your Company',
    services: req.body.services || 'home services',
    scheduleUrl: req.body.scheduleUrl,
  });
  if (!result) return res.status(503).json({ success: false, error: { code: 'RETELL_UNCONFIGURED', message: 'Retell API is not configured.' } });
  const agentId = result.agent_id || result.agentId || result.id;
  if (!agentId) return res.status(502).json({ success: false, error: { code: 'RETELL_AGENT_ID_MISSING', message: 'Retell did not return an agent identifier.' } });
  try {
    await require('../services/organizationAuthority').bindIntegrationOwner(db.getPool(), {
      organizationId: req.tenantContext.organizationId,
      userId: req.tenantContext.userId,
      provider: 'retell',
      externalIntegrationId: agentId,
      metadata: { provisionedBy: 'api' },
    });
    return res.json({ ...result, canonicalOwnershipPersisted: true });
  } catch (error) {
    return res.status(error.status || 503).json({ success: false, error: { code: error.code || 'CANONICAL_PERSISTENCE_UNAVAILABLE', message: error.status === 409 ? error.message : 'Canonical PostgreSQL persistence is unavailable.' } });
  }
});

/**
 * POST /api/retell/create-call
 * Initiate an outbound call via the active Retell AI agent.
 */
router.post('/retell/create-call', requireAuth, requirePermission('leads', 'create'), async (req, res) => {
  try {
    const { createCall } = require('../retell/client');
    const integration = await getOrganizationIntegration(db.getPool(), req.tenantContext.organizationId, 'retell');
    const result = await createCall(req.body.phoneNumber, integration.external_integration_id, {
      service: req.body.service,
      caller: req.body.caller,
      fromNumber: config.twilio ? config.twilio.phoneNumber : undefined,
    });
    if (!result) {
      return res.json({ success: false, error: 'Retell API not configured', status: 'unconfigured' });
    }
    res.json({
      success: true,
      callId: result.call_id,
      status: result.call_status,
      canonicalGraphPendingWebhook: true,
    });
  } catch (err) {
    console.error('[API] Retell create-call error:', err.message);
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
router.post('/retell/verify', requireAuth, async (req, res) => {
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
router.post('/retell/send-sms', requireAuth, async (req, res) => {
  try {
    const { sendSMS } = require('../retell/client');
    const result = await sendSMS(req.body.phoneNumber, req.body.message);
    res.json(result);
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

/**
 * Jobber Integration Routes
 */

/**
 * GET /api/integrations/jobber/status
 * Check if Jobber is connected for the current user.
 */
router.get('/integrations/jobber/status', requireAuth, async (req, res) => {
  const userId = req.query.userId;
  const debug = {
    hasClientId: !!process.env.JOBBER_CLIENT_ID,
    hasClientSecret: !!process.env.JOBBER_CLIENT_SECRET,
    clientIdLength: process.env.JOBBER_CLIENT_ID ? process.env.JOBBER_CLIENT_ID.length : 0,
    configured: jobber.isConfigured()
  };
  if (!userId) return res.json({ connected: false, ...debug });
  const status = await jobber.getStatus(userId);
  res.json({ ...status, ...debug });
});

/**
 * GET /api/integrations/jobber/auth
 * Start the OAuth flow to connect Jobber.
 */
router.get('/integrations/jobber/auth', requireAuth, (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });
  const authUrl = jobber.getAuthUrl(userId, `${req.protocol}://${req.get('host')}`);
  if (!authUrl) return res.status(503).json({ error: 'Jobber integration not configured. Set JOBBER_CLIENT_ID and JOBBER_CLIENT_SECRET.' });
  res.redirect(authUrl);
});

/**
 * GET /api/integrations/jobber/callback
 * Handle the OAuth callback from Jobber.
 */
router.get('/integrations/jobber/callback', requireAuth, async (req, res) => {
  const { code, state } = req.query;
  if (!code) return res.status(400).send('Missing authorization code');
  
  try {
    let userId = null;
    if (state) {
      try { userId = JSON.parse(Buffer.from(state, 'base64').toString()).userId; } catch(e) {}
    }
    
    const tokens = await jobber.exchangeCode(code, `${req.protocol}://${req.get('host')}`);
    if (tokens.access_token && userId) {
      await jobber.saveTokens(userId, tokens.access_token, tokens.refresh_token, tokens.expires_in);
    }
    
    res.redirect('/dashboard/integrations?jobber=connected');
  } catch (err) {
    console.error('[Jobber] OAuth callback error:', err.message);
    res.status(500).send('Failed to connect Jobber. Please try again.');
  }
});

/**
 * POST /api/integrations/jobber/disconnect
 * Disconnect Jobber for a user.
 */
router.post('/integrations/jobber/disconnect', requireAuth, async (req, res) => {
  const userId = req.body.userId;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });
  await jobber.disconnect(userId);
  res.json({ success: true });
});

/**
 * GET /api/contact/messages
 * List contact messages (internal use).
 */
router.get('/contact/messages', requireAuth, (req, res) => {
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
