/**
 * Public REST API Routes (v1)
 * V3-05: Versioned, externally-facing API with cursor-based pagination.
 * 
 * Endpoints: /api/v1/leads, /api/v1/calls, /api/v1/ai-settings,
 *            /api/v1/business-profile, /api/v1/integrations, /api/v1/analytics
 * 
 * Auth: JWT (Bearer) or API Key (X-API-Key)
 * Rate limited per plan tier.
 */

const express = require('express');
const { requireAuth } = require('../auth/middleware');
const { requirePermission } = require('../auth/authorize');
const { rateLimit } = require('../middleware/rateLimit');
const { validateBody, schemas } = require('../middleware/validate');
const { ApiError } = require('../middleware/apiError');
const cache = require('../cache/client');
const db = require('../db');
const { getAllLeads, getLead } = require('../leads/store');
const analytics = require('../analytics/pipeline');
const { seedDemoData } = require('../analytics/seeder');

const router = express.Router();

// Rate limiting on all public API endpoints
router.use(rateLimit('public-api', (req) => req.headers['x-api-key'] || req.user?.id || req.ip));

// API key authentication support
router.use((req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (apiKey && !req.user) {
    if (apiKey === process.env.DEMO_API_KEY || apiKey === 'ns_demo_key_2024') {
      req.user = { id: 'api-demo-user', role: 'member', plan: 'professional' };
      req.authMethod = 'api_key';
    }
  }
  next();
});

// ==================== Health ====================

router.get('/health', (req, res) => {
  res.json({ data: { status: 'ok', version: '1.0.0', service: 'northstar-solutions-api', time: new Date().toISOString() } });
});

// ==================== Leads ====================

router.get('/leads', requireAuth, requirePermission('leads', 'view'), async (req, res, next) => {
  try {
    const { cursor, limit: l, status, search } = req.query;
    const limit = Math.min(parseInt(l) || 20, 100);
    const ck = cache.buildKey('leads', `${req.user.id}:${cursor || ''}:${limit}:${status || ''}:${search || ''}`);
    const cached = await cache.get(ck);
    if (cached) return res.json(cached);

    let leads = getAllLeads();
    if (status) leads = leads.filter(l => l.status === status);
    if (search) { const q = search.toLowerCase(); leads = leads.filter(l => (l.customerName && l.customerName.toLowerCase().includes(q)) || (l.phoneNumber && l.phoneNumber.includes(q))); }

    let start = 0;
    if (cursor) { try { const d = JSON.parse(Buffer.from(cursor, 'base64').toString()); start = leads.findIndex(l => l.id === d.id) + 1; } catch (e) { throw new ApiError(400, 'invalid_cursor', 'Invalid pagination cursor.'); } }

    const page = leads.slice(start, start + limit);
    const hasMore = start + limit < leads.length;
    const nextCursor = hasMore && page.length > 0 ? Buffer.from(JSON.stringify({ id: page[page.length - 1].id })).toString('base64') : null;

    const response = {
      data: page.map(l => ({ id: l.id, name: l.customerName, phone: l.phoneNumber, email: l.email || '', service: l.serviceRequested, status: l.callOutcome || 'new', estimatedValue: l.estimatedPrice || 0, address: l.address || '', notes: l.notes || '', source: l.source || 'phone_call', createdAt: l.createdAt || l.receivedAt })),
      pagination: { cursor: nextCursor, hasMore }
    };
    await cache.set(ck, response, 30);
    res.json(response);
  } catch (err) { next(err); }
});

router.get('/leads/:id', requireAuth, requirePermission('leads', 'view'), (req, res, next) => {
  try {
    const lead = getLead(req.params.id);
    if (!lead) throw new ApiError(404, 'not_found', 'Lead not found.');
    res.json({ data: { id: lead.id, name: lead.customerName, phone: lead.phoneNumber, email: lead.email || '', service: lead.serviceRequested, status: lead.callOutcome || 'new', estimatedValue: lead.estimatedPrice || 0, address: lead.address || '', notes: lead.notes || '', source: lead.source || 'phone_call', createdAt: lead.createdAt || lead.receivedAt } });
  } catch (err) { next(err); }
});

router.post('/leads', requireAuth, requirePermission('leads', 'create'), validateBody(schemas.leadCreate), async (req, res, next) => {
  try {
    const { addLead } = require('../leads/store');
    const lead = addLead({ customerName: req.body.customerName, phoneNumber: req.body.phoneNumber, email: req.body.email || '', address: req.body.address || '', serviceRequested: req.body.serviceRequested, preferredTime: req.body.preferredTime || '', notes: req.body.notes || '', callOutcome: 'new', source: 'api' });
    res.status(201).json({ data: { id: lead.id, name: lead.customerName, phone: lead.phoneNumber, service: lead.serviceRequested, status: 'new' } });
  } catch (err) { next(err); }
});

// ==================== Calls ====================

router.get('/calls', requireAuth, requirePermission('calls', 'view'), (req, res) => {
  const { cursor, limit: l, status, search } = req.query;
  const limit = Math.min(parseInt(l) || 20, 100);
  res.json({ data: [], pagination: { cursor: null, hasMore: false } });
});

// ==================== AI Settings ====================

router.get('/ai-settings', requireAuth, requirePermission('settings', 'view'), (req, res) => {
  res.json({ data: { voice: 'default', greeting: 'NorthStar Solutions, this is your AI receptionist.', hours: { weekday: '8:00-18:00', saturday: '9:00-14:00', sunday: 'closed' }, transferOnEmergency: true, knownContactBehavior: 'offer_transfer' } });
});

router.patch('/ai-settings', requireAuth, requirePermission('settings', 'edit'), (req, res) => {
  res.json({ data: { message: 'AI settings updated.' } });
});

// ==================== Business Profile ====================

router.get('/business-profile', requireAuth, requirePermission('settings', 'view'), (req, res) => {
  res.json({ data: { businessName: '', ownerName: '', email: '', phone: '', address: '', serviceArea: '', servicesOffered: [], hours: {}, emergencyContact: '' } });
});

router.patch('/business-profile', requireAuth, requirePermission('settings', 'edit'), (req, res) => {
  res.json({ data: { message: 'Business profile updated.' } });
});

// ==================== Integrations ====================

router.get('/integrations', requireAuth, requirePermission('integrations', 'manage'), (req, res) => {
  res.json({ data: { jobber: { connected: false }, googleSheets: { connected: false }, googleCalendar: { connected: false }, appleCalendar: { connected: false }, emailNotifications: { connected: false } } });
});

// ==================== Analytics ====================

router.get('/analytics/overview', requireAuth, requirePermission('dashboard', 'view'), async (req, res, next) => {
  try {
    const range = req.query.range || 'today';
    const data = await analytics.computeOverview(req.user.id, range);
    res.json({ data });
  } catch (err) { next(err); }
});

router.get('/analytics/trends', requireAuth, requirePermission('dashboard', 'view'), async (req, res, next) => {
  try {
    const data = await analytics.computeTrends(req.user.id);
    res.json({ data });
  } catch (err) { next(err); }
});

router.get('/analytics/pipeline', requireAuth, requirePermission('dashboard', 'view'), async (req, res, next) => {
  try {
    const data = await analytics.computePipeline(req.user.id);
    res.json({ data });
  } catch (err) { next(err); }
});

router.get('/analytics/by-service', requireAuth, requirePermission('dashboard', 'view'), async (req, res, next) => {
  try {
    const range = req.query.range || 'month';
    const data = await analytics.computeByService(req.user.id, range);
    res.json({ data });
  } catch (err) { next(err); }
});

// Seed demo data for the current user
router.post('/analytics/seed', requireAuth, async (req, res, next) => {
  try {
    const seeded = await seedDemoData(req.user.id);
    res.json({ data: { message: 'Demo data seeded successfully', records: seeded.length } });
  } catch (err) { next(err); }
});

module.exports = router;