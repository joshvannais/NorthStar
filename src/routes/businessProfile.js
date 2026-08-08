/**
 * Organization-scoped canonical Business Profile API.
 *
 * Reads, validation, and writes on this mounted tenant route use the persisted
 * organization profile contract. No file-backed profile singleton is loaded.
 */
'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAccountMutation, requireTenantAccess } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { getActiveBusinessProfile, putBusinessProfile } = require('../services/organizationAuthority');
const {
  migrateLegacyCanonicalAuthority,
  prepareBusinessProfileForWrite,
  synchronizeLegacyFinancial,
} = require('../services/businessProfileAdapter');

const VALID_SECTIONS = new Set([
  'company', 'headquarters', 'serviceArea', 'routing', 'hours', 'crew',
  'vehicles', 'services', 'financial', 'scheduling', 'polaris', 'retell',
  'notifications', 'integrations', 'canonicalPricing', 'canonicalCosts', 'policies',
  'workforce',
]);
const BUSINESS_PROFILE_VERSION_PATTERN = /^org-profile-v[1-9][0-9]*$/;

function isPlainObject(value) {
  return Boolean(value) && Object.prototype.toString.call(value) === '[object Object]' &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function hasOwn(value, key) {
  return Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function sendError(res, error) {
  const status = error && error.status ? error.status : 503;
  const code = error && error.code ? error.code : 'CANONICAL_PERSISTENCE_UNAVAILABLE';
  const message = status === 503 && code !== 'CANONICAL_BUSINESS_PROFILE_REQUIRED'
    ? 'Canonical PostgreSQL persistence is unavailable.' : error.message;
  return res.status(status).json({ success: false, error: { code, message } });
}

function response(profile) {
  const editable = migrateLegacyCanonicalAuthority(profile.rawProfile);
  synchronizeLegacyFinancial(editable.profile);
  return {
    ...editable.profile,
    canonicalAuthority: {
      id: profile.id,
      version: profile.versionLabel,
      hash: profile.profileHash,
      createdAt: profile.createdAt,
      legacyMigration: {
        pending: editable.migratedFields.length > 0,
        fields: editable.migratedFields,
      },
    },
  };
}

function onboardingDraft(req) {
  const integrationNames = [
    'openai', 'retell', 'googleCalendar', 'microsoftCalendar', 'googleMaps',
    'appleMaps', 'waze', 'quickbooks', 'stripe', 'square', 'twilio',
    'weather', 'fleetTracking', 'payroll', 'inventory',
  ];
  return {
    company: {
      name: req.accountAuthority.organization_name || '', dba: '',
      email: req.user.email || '', phone: req.accountAuthority.phone || '',
      website: '', taxId: '', timeZone: '', currency: 'USD',
    },
    headquarters: {
      street: '', city: '', state: '', zip: '', country: 'US', latitude: null, longitude: null,
      additionalOffices: [],
    },
    serviceArea: { maxRadiusMiles: null, maxTravelMinutes: null, primaryTerritory: '', polygon: [] },
    routing: {
      preferredProvider: '', dispatchFrom: '', trafficEnabled: false,
      useLiveTraffic: false, avoidTolls: false, avoidHighways: false, avoidFerries: false,
    },
    hours: { holidays: [] },
    crew: {
      defaultCrewSize: null, maxCrewSize: null, averageHourlyRate: null,
      overtimeMultiplier: null, travelPay: null, shopTime: null, minimumBillableHours: null,
    },
    vehicles: {
      truckCount: null, trailerCount: null, averageMpg: null, averageFuelCost: null,
      hourlyVehicleCost: null, maintenanceReserve: null, equipmentTransportCapacity: null,
    },
    services: [],
    financial: {},
    canonicalPricing: {},
    canonicalCosts: {},
    scheduling: {
      maxJobsPerDay: null, travelBuffer: null, appointmentBuffer: null,
      workDayLength: null, maxDailyTravel: null, preferredDispatchStrategy: '',
    },
    polaris: {
      responseStyle: '', detailLevel: '', recommendationStyle: '',
      showCalculations: false, showConfidence: false, showExecutiveReasoning: false,
      conciseMode: false, executiveMode: false,
    },
    retell: {
      voicePersonality: '', conversationStyle: '', maxConversationLength: null,
      questionStrategy: '', confirmationStyle: '', emergencyWorkflow: false,
    },
    notifications: {
      email: false, sms: false, push: false, dailyExecutiveBriefing: false,
      revenueAlerts: false, crewAlerts: false, criticalAlerts: false,
    },
    integrations: integrationNames.reduce(function (result, name) {
      result[name] = { enabled: false };
      return result;
    }, {}),
    policies: {},
    workforce: { policies: [] },
    canonicalAuthority: null,
    onboardingDraft: true,
  };
}

function isMissingProfile(error) {
  return error && error.code === 'CANONICAL_BUSINESS_PROFILE_REQUIRED';
}

async function active(req) {
  return getActiveBusinessProfile(db.getPool(), req.tenantContext.organizationId);
}

async function persist(req, rawProfile, options) {
  let source = rawProfile;
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    source = { ...source };
    delete source.canonicalAuthority;
    delete source.onboardingDraft;
  }
  const prepared = prepareBusinessProfileForWrite(source);
  if (prepared.errors.length) {
    const error = new Error('Business Profile validation failed.');
    error.status = 400;
    error.code = 'INVALID_BUSINESS_PROFILE';
    error.details = prepared.errors;
    throw error;
  }
  const input = {
    organizationId: req.tenantContext.organizationId,
    userId: req.tenantContext.userId,
    profile: prepared.profile,
    preserveVoiceAssistant: !(options && options.allowVoiceAssistantWrite === true),
  };
  if (options && hasOwn(options, 'expectedVersion')) input.expectedVersion = options.expectedVersion;
  const stored = await putBusinessProfile(db.getPool(), input);
  return stored;
}

function parseVoiceAssistantWrite(body) {
  if (!isPlainObject(body) || !hasOwn(body, 'expectedVersion') || !hasOwn(body, 'value') ||
      Object.keys(body).some(function (key) { return key !== 'expectedVersion' && key !== 'value'; }) ||
      (body.expectedVersion !== null &&
       (typeof body.expectedVersion !== 'string' || !BUSINESS_PROFILE_VERSION_PATTERN.test(body.expectedVersion))) ||
      !isPlainObject(body.value)) {
    const error = new Error('Voice Assistant writes require a value and the expected canonical profile version.');
    error.status = 400;
    error.code = 'INVALID_VOICE_ASSISTANT_WRITE';
    error.details = ['Body must contain exactly expectedVersion and value; expectedVersion must be a canonical version label or null, and value must be an object.'];
    throw error;
  }
  return { expectedVersion: body.expectedVersion, value: body.value };
}

router.get('/', requireTenantAccess, async function (req, res) {
  try {
    return res.json({ success: true, data: response(await active(req)) });
  } catch (error) {
    if (isMissingProfile(error)) {
      return res.json({ success: true, data: onboardingDraft(req), onboardingDraft: true });
    }
    return sendError(res, error);
  }
});

router.put('/', requireAccountMutation, requirePermission('settings', 'update'), async function (req, res) {
  try {
    return res.json({ success: true, data: response(await persist(req, req.body)) });
  } catch (error) {
    if (error.details) return res.status(400).json({
      success: false,
      error: { code: error.code, message: error.message },
      errors: error.details,
    });
    return sendError(res, error);
  }
});

router.put('/voiceAssistant', requireAccountMutation, requirePermission('settings', 'update'), async function (req, res) {
  try {
    const voiceWrite = parseVoiceAssistantWrite(req.body);
    let current;
    try {
      current = (await active(req)).rawProfile;
    } catch (error) {
      if (!isMissingProfile(error)) throw error;
      current = onboardingDraft(req);
      delete current.canonicalAuthority;
      delete current.onboardingDraft;
    }
    const updated = { ...current, voiceAssistant: voiceWrite.value };
    return res.json({
      success: true,
      data: response(await persist(req, updated, {
        expectedVersion: voiceWrite.expectedVersion,
        allowVoiceAssistantWrite: true,
      })),
    });
  } catch (error) {
    if (error.details) return res.status(400).json({
      success: false,
      error: { code: error.code, message: error.message },
      errors: error.details,
    });
    return sendError(res, error);
  }
});

router.put('/:section', requireAccountMutation, requirePermission('settings', 'update'), async function (req, res) {
  const section = req.params.section;
  if (!VALID_SECTIONS.has(section)) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_PROFILE_SECTION', message: 'Business Profile section is invalid.' } });
  }
  try {
    let current;
    try {
      current = (await active(req)).rawProfile;
    } catch (error) {
      if (!isMissingProfile(error)) throw error;
      current = onboardingDraft(req);
      delete current.canonicalAuthority;
      delete current.onboardingDraft;
    }
    const updated = { ...current, [section]: req.body };
    return res.json({ success: true, data: response(await persist(req, updated)) });
  } catch (error) {
    if (error.details) return res.status(400).json({
      success: false,
      error: { code: error.code, message: error.message },
      errors: error.details,
    });
    return sendError(res, error);
  }
});

router.get('/voiceAssistant', requireTenantAccess, async function (req, res) {
  try {
    const profile = await active(req);
    const value = profile.rawProfile.voiceAssistant;
    return res.json({ success: true, data: value === undefined ? null : value });
  } catch (error) {
    if (isMissingProfile(error)) {
      return res.json({ success: true, data: null, onboardingDraft: true });
    }
    return sendError(res, error);
  }
});

router.get('/:section', requireTenantAccess, async function (req, res) {
  const section = req.params.section;
  if (!VALID_SECTIONS.has(section)) {
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Business Profile section not found.' } });
  }
  try {
    const profile = await active(req);
    return res.json({ success: true, data: profile.rawProfile[section] });
  } catch (error) {
    if (isMissingProfile(error)) {
      return res.json({ success: true, data: onboardingDraft(req)[section], onboardingDraft: true });
    }
    return sendError(res, error);
  }
});

module.exports = router;
