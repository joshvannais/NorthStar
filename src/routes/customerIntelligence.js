/**
 * Customer Intelligence API Route
 * Serves per-customer intelligence data to the frontend.
 * READ-ONLY: No edits, no mutations, no writes.
 */
'use strict';

const express = require('express');
const router = express.Router();
const customerIntelligence = require('../services/customerIntelligence');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '../../data');

/**
 * GET /api/v1/leads/:id/intelligence
 * Returns the full customer intelligence object for a lead.
 */
router.get('/:id/intelligence', (req, res) => {
  try {
    const leadId = req.params.id;
    if (!leadId) {
      return res.status(400).json({ success: false, error: 'Lead ID is required' });
    }

    // Load leads data
    let leads = [];
    try {
      leads = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'leads.json'), 'utf8'));
    } catch (e) {
      return res.status(500).json({ success: false, error: 'Failed to load leads data' });
    }

    const lead = leads.find(l => l.id === leadId);
    if (!lead) {
      return res.status(404).json({ success: false, error: 'Lead not found' });
    }

    // Generate customer intelligence
    const intelligence = customerIntelligence.generateCustomerSnapshot(lead, {
      totalLeads: leads.length,
    });

    return res.json({ success: true, data: intelligence });
  } catch (err) {
    console.error('Customer Intelligence API error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to generate customer intelligence' });
  }
});

/**
 * GET /api/v1/leads/intelligence/dashboard
 * Returns dashboard-level customer intelligence summaries.
 */
router.get('/intelligence/dashboard', (req, res) => {
  try {
    let leads = [];
    try {
      leads = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'leads.json'), 'utf8'));
    } catch (e) {
      return res.status(500).json({ success: false, error: 'Failed to load leads data' });
    }

    const dashboard = customerIntelligence.generateDashboardCustomerIntelligence(leads);
    return res.json({ success: true, data: dashboard });
  } catch (err) {
    console.error('Dashboard Customer Intelligence API error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to generate dashboard customer intelligence' });
  }
});

module.exports = router;