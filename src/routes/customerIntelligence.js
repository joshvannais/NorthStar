/**
 * Customer Intelligence API Route
 * Serves legacy per-lead intelligence without changing the public v1 contract.
 * READ-ONLY: No edits, mutations, or writes.
 */
'use strict';

const express = require('express');
const router = express.Router();
const customerIntelligence = require('../services/customerIntelligence');
const dataLoader = require('../services/dataLoader');
const demoScope = require('../services/demoRecordScope');
const { requireAuth } = require('../auth/middleware');

router.use(requireAuth);

function _visibleLeads(req) {
  const loaded = dataLoader.loadData();
  return demoScope.filterTenantRecords(loaded.leads || [], demoScope.createAccessContext(req));
}

/**
 * GET /api/v1/leads/intelligence/dashboard
 * Returns the existing dashboard-level customer intelligence envelope.
 */
router.get('/intelligence/dashboard', (req, res) => {
  try {
    const leads = _visibleLeads(req);
    const dashboard = customerIntelligence.generateDashboardCustomerIntelligence(leads);
    return res.json({ success: true, data: dashboard });
  } catch (err) {
    console.error('Dashboard Customer Intelligence API error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to generate dashboard customer intelligence' });
  }
});

/**
 * GET /api/v1/leads/:id/intelligence
 * Preserves lead-ID semantics for the legacy lead-detail page.
 */
router.get('/:id/intelligence', (req, res) => {
  try {
    const leadId = req.params.id;
    if (!leadId) return res.status(400).json({ success: false, error: 'Lead ID is required' });

    const leads = _visibleLeads(req);
    const lead = leads.find(function (item) { return item.id === leadId; });
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });

    const intelligence = customerIntelligence.generateCustomerSnapshot(lead, { totalLeads: leads.length });
    return res.json({ success: true, data: intelligence });
  } catch (err) {
    console.error('Customer Intelligence API error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to generate customer intelligence' });
  }
});

module.exports = router;
