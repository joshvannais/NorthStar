'use strict';

const express = require('express');
const { AccountRepository } = require('../accounts/repository');
const { AccountService } = require('../accounts/service');
const { requireAccountMutation, requireTenantAccess } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');

const router = express.Router();
const INTERNAL_KEYS = new Set([
  'companyName', 'companyPhone', 'services', 'companyInfo', 'greeting',
  'smartRouting', 'contacts',
]);
const NOTIFICATION_KEYS = new Set([
  'emailEnabled', 'emailCallSummary', 'emailAppointment', 'smsEnabled',
  'smsUrgent', 'emailAddress', 'smsNumber',
]);
const READ_ONLY_KEYS = new Set(['securityEmailMandatory', 'securityEmailAddress']);

function requestId(req) {
  return req.requestId || req.correlationId || 'unavailable';
}

function unavailable(req, res) {
  return res.status(503).json({
    error: 'Account preferences are unavailable',
    code: 'preferences_unavailable',
    requestId: requestId(req),
  });
}

function invalid(req, res) {
  return res.status(400).json({
    error: 'Account preferences are invalid',
    code: 'invalid_preferences',
    requestId: requestId(req),
  });
}

function cleanInternalPreferences(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const result = {};
  for (const key of INTERNAL_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const item = source[key];
    if (key === 'smartRouting') {
      if (typeof item === 'boolean') result[key] = item;
      continue;
    }
    if (key === 'contacts') {
      if (!Array.isArray(item) || item.length > 100) continue;
      const contacts = [];
      let valid = true;
      for (const contact of item) {
        if (!contact || typeof contact !== 'object' || Array.isArray(contact)) {
          valid = false;
          break;
        }
        const name = typeof contact.name === 'string' ? contact.name.trim() : '';
        const phone = typeof contact.phone === 'string' ? contact.phone.trim() : '';
        if (!name || name.length > 100 || !phone || phone.length > 50) {
          valid = false;
          break;
        }
        contacts.push({ name, phone });
      }
      if (valid) result[key] = contacts;
      continue;
    }
    if (typeof item === 'string' && item.length <= 10000) result[key] = item;
  }
  return result;
}

function projectPreferences(row, securityEmail) {
  return {
    ...cleanInternalPreferences(row.internal_preferences),
    emailEnabled: Boolean(row.email_new_lead),
    emailCallSummary: Boolean(row.email_call_summary),
    emailAppointment: Boolean(row.email_appointment),
    smsEnabled: Boolean(row.sms_new_lead),
    smsUrgent: Boolean(row.sms_urgent),
    emailAddress: row.notification_email || '',
    smsNumber: row.notification_phone || '',
    securityEmailMandatory: true,
    securityEmailAddress: securityEmail || '',
  };
}

function preferenceVersion(row) {
  const value = row && row.preference_version;
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value)) return value;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function parsePreferences(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Buffer.byteLength(JSON.stringify(body), 'utf8') > 32768) return null;
  const keys = Object.keys(body);
  if (keys.some(key => READ_ONLY_KEYS.has(key) ||
      (key !== 'expectedVersion' && !NOTIFICATION_KEYS.has(key) && !INTERNAL_KEYS.has(key)))) return null;
  if ([...NOTIFICATION_KEYS].some(key => !Object.prototype.hasOwnProperty.call(body, key))) return null;
  for (const key of ['emailEnabled', 'emailCallSummary', 'emailAppointment', 'smsEnabled', 'smsUrgent']) {
    if (typeof body[key] !== 'boolean') return null;
  }
  if (typeof body.emailAddress !== 'string' || typeof body.smsNumber !== 'string') return null;
  const email = body.emailAddress.trim().toLowerCase();
  const phone = body.smsNumber.trim();
  if (email.length > 254 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return null;
  if (phone.length > 50 || (phone && !/^[+\d\s().-]+$/.test(phone))) return null;
  const expectedVersion = body.expectedVersion === undefined ? null : body.expectedVersion;
  if (expectedVersion !== null && (typeof expectedVersion !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.(?:\d{3}|\d{6})Z$/.test(expectedVersion))) return null;

  const internal = cleanInternalPreferences(body);
  for (const key of INTERNAL_KEYS) {
    if (Object.prototype.hasOwnProperty.call(body, key) &&
        !Object.prototype.hasOwnProperty.call(internal, key)) return null;
  }
  return {
    notification: {
      emailNewLead: body.emailEnabled,
      emailCallSummary: body.emailCallSummary,
      emailAppointment: body.emailAppointment,
      smsNewLead: body.smsEnabled,
      smsUrgent: body.smsUrgent,
      notificationEmail: email,
      notificationPhone: phone,
    },
    internal,
    expectedVersion,
  };
}

router.get('/preferences', requireTenantAccess, async (req, res) => {
  try {
    const stored = await new AccountRepository().accountPreferences(req.tenantContext.organizationId);
    if (!stored) return unavailable(req, res);
    return res.json({
      preferences: projectPreferences(stored, req.user.email),
      version: preferenceVersion(stored),
      requestId: requestId(req),
    });
  } catch (_error) {
    return unavailable(req, res);
  }
});

router.put('/preferences', requireAccountMutation, requirePermission('settings', 'update'), async (req, res) => {
  const parsed = parsePreferences(req.body);
  if (!parsed) return invalid(req, res);
  try {
    const stored = await new AccountRepository().updateAccountPreferences(
      req.tenantContext.organizationId,
      parsed.notification,
      parsed.internal,
      parsed.expectedVersion
    );
    if (!stored) return unavailable(req, res);
    if (stored.conflict) {
      return res.status(409).json({
        error: 'Account preferences changed. Reload before saving.',
        code: 'preferences_version_conflict',
        version: preferenceVersion(stored),
        requestId: requestId(req),
      });
    }
    return res.json({
      preferences: projectPreferences(stored, req.user.email),
      version: preferenceVersion(stored),
      requestId: requestId(req),
    });
  } catch (_error) {
    return unavailable(req, res);
  }
});

router.get('/subscription', requireTenantAccess, async (req, res) => {
  try {
    const injected = req.app && req.app.locals && req.app.locals.accountRepository;
    const repository = injected && typeof injected.expireAndReadSubscription === 'function'
      ? injected
      : new AccountRepository();
    const subscription = await new AccountService(repository)
      .subscriptionStatus(req.tenantContext.organizationId);
    return res.json({ subscription, requestId: requestId(req) });
  } catch (_error) {
    return res.status(503).json({
      error: 'Subscription authority is temporarily unavailable',
      code: 'subscription_authority_unavailable',
      requestId: requestId(req),
    });
  }
});

module.exports = router;
