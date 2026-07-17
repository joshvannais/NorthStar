/**
 * Business Profile API Routes
 * Manages the operational DNA of a NorthStar business.
 */
'use strict';

const express = require('express');
const router = express.Router();
const bp = require('../services/businessProfile');
const { requireAuth } = require('../auth/middleware');

// All business profile routes require authentication
router.use(requireAuth);

// GET /api/v1/business-profile — full profile
router.get('/', (req, res) => {
  try {
    const profile = bp.getProfile();
    res.json({ success: true, data: profile });
  } catch (err) {
    console.error('[BusinessProfile] GET error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load profile' });
  }
});

// PUT /api/v1/business-profile — update full profile
router.put('/', (req, res) => {
  try {
    const result = bp.updateProfile(req.body);
    if (result.success) {
      res.json({ success: true, data: result.profile });
    } else {
      res.status(400).json({ success: false, errors: result.errors });
    }
  } catch (err) {
    console.error('[BusinessProfile] PUT error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to update profile' });
  }
});

// PUT /api/v1/business-profile/:section — update a single section
router.put('/:section', (req, res) => {
  try {
    const section = req.params.section;
    const validSections = ['company', 'headquarters', 'serviceArea', 'routing', 'hours', 'crew', 'vehicles', 'services', 'financial', 'scheduling', 'polaris', 'retell', 'notifications', 'integrations'];
    if (!validSections.includes(section)) {
      return res.status(400).json({ success: false, error: `Invalid section: ${section}` });
    }
    const result = bp.updateSection(section, req.body);
    if (result.success) {
      res.json({ success: true, data: result.profile });
    } else {
      res.status(400).json({ success: false, errors: result.errors });
    }
  } catch (err) {
    console.error('[BusinessProfile] PUT section error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to update section' });
  }
});

// Sectional GET endpoints
router.get('/company', (req, res) => res.json({ success: true, data: bp.getCompany() }));
router.get('/headquarters', (req, res) => res.json({ success: true, data: bp.getHeadquarters() }));
router.get('/routing', (req, res) => res.json({ success: true, data: bp.getRoutingPreferences() }));
router.get('/crew', (req, res) => res.json({ success: true, data: bp.getCrewDefaults() }));
router.get('/services', (req, res) => res.json({ success: true, data: bp.getServiceCatalog() }));
router.get('/financial', (req, res) => res.json({ success: true, data: bp.getFinancialDefaults() }));
router.get('/scheduling', (req, res) => res.json({ success: true, data: bp.getSchedulingDefaults() }));
router.get('/polaris', (req, res) => res.json({ success: true, data: bp.getPolarisPreferences() }));
router.get('/retell', (req, res) => res.json({ success: true, data: bp.getRetellPreferences() }));
router.get('/notifications', (req, res) => res.json({ success: true, data: bp.getNotificationPreferences() }));

module.exports = router;