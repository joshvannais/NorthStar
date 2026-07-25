/**
 * Business Profile Service — The operational DNA of every NorthStar business.
 *
 * This is the SINGLE source of truth for how a business operates.
 * Every future intelligence engine must consume this profile instead of
 * relying on hardcoded values or assumptions.
 *
 * Architecture:
 *   Business Profile (this service)
 *        ↓
 *   Business Context
 *        ↓
 *   Business Intelligence Engine
 *        ↓
 *   Executive Decision Engine
 *        ↓
 *   Customer Intelligence Platform
 *        ↓
 *   Polaris | Dashboard | Customer Cards | Scheduling | Estimating | Routing | Retell
 *
 * READ-ONLY methods return current profile values.
 * Mutations go through updateProfile() with validation.
 */
'use strict';

const fs = require('fs');
const { dataPath } = require('./dataPaths');

const PROFILE_PATH = dataPath('business-profile.json');

// In-memory cache
let _profile = null;
let _lastLoad = 0;
const CACHE_TTL = 5000; // 5 seconds

// ====================================================================
// Internal helpers
// ====================================================================

/**
 * Validate critical fields and log warnings for missing values.
 * Uses defaults — never crashes — but warns so operators can fix.
 */
function validateAndWarn(profile, source) {
  const warnings = [];

  // Crew defaults
  if (!profile.crew || !profile.crew.defaultCrewSize) {
    warnings.push('crew.defaultCrewSize missing — using default 2');
  }
  if (!profile.crew || !profile.crew.averageHourlyRate) {
    warnings.push('crew.averageHourlyRate missing — using default $42/hr');
  }
  if (!profile.crew || !profile.crew.overtimeMultiplier) {
    warnings.push('crew.overtimeMultiplier missing — using default 1.5x');
  }

  // Financial defaults
  if (!profile.financial || !profile.financial.desiredGrossMargin) {
    warnings.push('financial.desiredGrossMargin missing — using default 40%');
  }
  if (!profile.financial || !profile.financial.markup) {
    warnings.push('financial.markup missing — using default 1.3x');
  }
  if (!profile.financial || !profile.financial.taxRate && profile.financial && profile.financial.taxRate !== 0) {
    warnings.push('financial.taxRate missing — using default 7%');
  }

  // Scheduling defaults
  if (!profile.scheduling || !profile.scheduling.maxJobsPerDay) {
    warnings.push('scheduling.maxJobsPerDay missing — using default 4');
  }
  if (!profile.scheduling || !profile.scheduling.workDayLength) {
    warnings.push('scheduling.workDayLength missing — using default 8 hours');
  }

  // Service area
  if (!profile.serviceArea || !profile.serviceArea.maxRadiusMiles) {
    warnings.push('serviceArea.maxRadiusMiles missing — using default 50 miles');
  }

  // Company info
  if (!profile.company || !profile.company.name) {
    warnings.push('company.name missing — using default "NorthStar Solutions"');
  }

  if (warnings.length > 0) {
    console.warn(`[BusinessProfile] Warnings from ${source}:`);
    warnings.forEach(w => console.warn(`  ⚠ ${w}`));
  }
}

function loadProfile() {
  const now = Date.now();
  if (_profile && now - _lastLoad < CACHE_TTL) return _profile;
  try {
    _profile = JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf8'));
    _lastLoad = now;
    validateAndWarn(_profile, 'business-profile.json');
    return _profile;
  } catch (e) {
    console.warn('[BusinessProfile] Could not load business-profile.json — using defaults:', e.message);
    _profile = getDefaultProfile();
    validateAndWarn(_profile, 'defaults (file missing/unreadable)');
    return _profile;
  }
}

function saveProfile(profile) {
  fs.writeFileSync(PROFILE_PATH, JSON.stringify(profile, null, 2), 'utf8');
  _profile = profile;
  _lastLoad = Date.now();
  return true;
}

function getDefaultProfile() {
  return {
    company: { name: 'NorthStar Solutions', dba: '', email: '', phone: '', website: '', logo: '', timeZone: 'America/New_York', currency: 'USD', taxId: '' },
    headquarters: { street: '', city: '', state: '', zip: '', country: 'US', latitude: null, longitude: null, additionalOffices: [] },
    serviceArea: { maxRadiusMiles: 50, maxTravelMinutes: 60, primaryTerritory: '', polygon: [] },
    routing: { preferredProvider: 'google-maps', trafficEnabled: true, avoidTolls: false, avoidHighways: false, avoidFerries: false, useLiveTraffic: true, dispatchFrom: 'headquarters' },
    hours: {},
    crew: { defaultCrewSize: 2, maxCrewSize: 6, averageHourlyRate: 42, overtimeMultiplier: 1.5, travelPay: 25, shopTime: 0.5, minimumBillableHours: 1 },
    vehicles: { truckCount: 3, averageMpg: 14, averageFuelCost: 3.5, hourlyVehicleCost: 15, maintenanceReserve: 0.05, trailerCount: 2, equipmentTransportCapacity: 1 },
    services: [],
    financial: { desiredGrossMargin: 40, desiredNetMargin: 20, markup: 1.3, taxRate: 7, emergencyMarkup: 1.5, travelCharge: 0.58, minimumJobPrice: 150, maximumDiscount: 15 },
    scheduling: { maxJobsPerDay: 4, travelBuffer: 15, appointmentBuffer: 10, workDayLength: 8, preferredDispatchStrategy: 'efficiency', maxDailyTravel: 120 },
    polaris: { responseStyle: 'executive', detailLevel: 'standard', showCalculations: true, showConfidence: true, showExecutiveReasoning: true, recommendationStyle: 'prioritized', conciseMode: false, executiveMode: true },
    retell: { voicePersonality: 'professional', conversationStyle: 'consultative', maxConversationLength: 15, escalationRules: {}, transferRules: {}, appointmentRules: {}, questionStrategy: 'discovery', confirmationStyle: 'explicit', emergencyWorkflow: false },
    notifications: { email: true, sms: false, push: true, dailyExecutiveBriefing: true, revenueAlerts: true, crewAlerts: false, criticalAlerts: true },
    integrations: {},
    updatedAt: new Date().toISOString(),
  };
}

// ====================================================================
// Validation
// ====================================================================

function validateProfile(profile) {
  const errors = [];
  if (!profile.company) errors.push('Company section is required');
  if (!profile.headquarters) errors.push('Headquarters section is required');
  if (!profile.crew) errors.push('Crew defaults are required');
  if (!profile.financial) errors.push('Financial settings are required');
  if (!profile.scheduling) errors.push('Scheduling defaults are required');
  if (profile.crew && profile.crew.defaultCrewSize < 1) errors.push('Default crew size must be at least 1');
  if (profile.crew && profile.crew.maxCrewSize < profile.crew.defaultCrewSize) errors.push('Max crew size must be >= default crew size');
  if (profile.financial && (profile.financial.desiredGrossMargin < 0 || profile.financial.desiredGrossMargin > 100)) errors.push('Gross margin must be 0-100');
  if (profile.routing && !['google-maps', 'apple-maps', 'waze'].includes(profile.routing.preferredProvider)) errors.push('Invalid routing provider');
  return { valid: errors.length === 0, errors };
}

// ====================================================================
// Public API
// ====================================================================

/** Get the full business profile */
function getProfile() {
  return JSON.parse(JSON.stringify(loadProfile())); // deep clone
}

/** Replace the full profile (after validation) */
function updateProfile(profile) {
  const validation = validateProfile(profile);
  if (!validation.valid) return { success: false, errors: validation.errors };
  profile.updatedAt = new Date().toISOString();
  saveProfile(profile);
  return { success: true, profile: getProfile() };
}

/** Validate a profile without saving */
function validateProfileInput(profile) {
  return validateProfile(profile);
}

// ====================================================================
// Sectional getters — used by future intelligence engines
// ====================================================================

function getCompany() { return loadProfile().company; }
function getHeadquarters() { return loadProfile().headquarters; }
function getServiceArea() { return loadProfile().serviceArea; }
function getRoutingPreferences() { return loadProfile().routing; }
function getBusinessHours() { return loadProfile().hours; }
function getCrewDefaults() { return loadProfile().crew; }
function getVehicles() { return loadProfile().vehicles; }
function getServiceCatalog() { return loadProfile().services; }
function getFinancialDefaults() { return loadProfile().financial; }
function getSchedulingDefaults() { return loadProfile().scheduling; }
function getPolarisPreferences() { return loadProfile().polaris; }
function getRetellPreferences() { return loadProfile().retell; }
function getNotificationPreferences() { return loadProfile().notifications; }
function getIntegrations() { return loadProfile().integrations; }

// ====================================================================
// Sectional updaters
// ====================================================================

function updateSection(sectionName, data) {
  const profile = loadProfile();
  if (!profile[sectionName]) return { success: false, errors: [`Section '${sectionName}' does not exist`] };
  profile[sectionName] = data;
  profile.updatedAt = new Date().toISOString();
  saveProfile(profile);
  return { success: true, profile: getProfile() };
}

module.exports = {
  getProfile,
  updateProfile,
  validateProfile: validateProfileInput,
  getCompany,
  getHeadquarters,
  getServiceArea,
  getRoutingPreferences,
  getBusinessHours,
  getCrewDefaults,
  getVehicles,
  getServiceCatalog,
  getFinancialDefaults,
  getSchedulingDefaults,
  getPolarisPreferences,
  getRetellPreferences,
  getNotificationPreferences,
  getIntegrations,
  updateSection,
};
