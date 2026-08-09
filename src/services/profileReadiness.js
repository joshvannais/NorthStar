'use strict';

const crypto = require('crypto');
const {
  FINANCIAL_CONFIGURATION_FIELDS,
  stableStringify,
  stableValue,
} = require('./businessProfileAdapter');

const PROFILE_READINESS_SCHEMA_VERSION = 'm20-profile-readiness-v1';
const PROFILE_VERSION_PATTERN = /^org-profile-v[1-9][0-9]*$/;
const STABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const REVIEWED_HASH_PATTERN = /^[0-9a-f]{64}$/;
const ACTIONS = new Set(['review', 'mark_applicable', 'mark_not_applicable']);
const APPLICABILITY = new Set(['applicable', 'not_applicable']);
const WEEKDAYS = Object.freeze([
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
]);
const VOICE_FIELDS = Object.freeze([
  'name', 'style', 'greeting', 'personality', 'conversationStyle', 'escalationRules',
]);

function isPlainObject(value) {
  if (!value || Object.prototype.toString.call(value) !== '[object Object]') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOwn(value, key) {
  return Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function nonblank(value) {
  return typeof value === 'string' && Boolean(value.trim());
}

function compareText(left, right) {
  const first = String(left);
  const second = String(right);
  if (first < second) return -1;
  if (first > second) return 1;
  return 0;
}

function finiteBetween(value, minimum, maximum) {
  return typeof value === 'number' && Number.isFinite(value) &&
    (minimum === undefined || value >= minimum) &&
    (maximum === undefined || value <= maximum);
}

function validCoordinatePair(value) {
  return isPlainObject(value) && finiteBetween(value.latitude, -90, 90) &&
    finiteBetween(value.longitude, -180, 180);
}

function completeAddress(value) {
  return isPlainObject(value) && ['street', 'city', 'state', 'zip', 'country'].every(function (field) {
    return nonblank(value[field]);
  }) && /^[A-Z]{2}$/.test(value.country.trim());
}

function recognizedLocation(value, includeIdentity) {
  if (!isPlainObject(value)) return null;
  const projection = {};
  const stringFields = includeIdentity
    ? ['id', 'name', 'street', 'city', 'state', 'zip', 'country']
    : ['street', 'city', 'state', 'zip', 'country'];
  for (const field of stringFields) {
    if (typeof value[field] === 'string') projection[field] = value[field];
  }
  if (finiteBetween(value.latitude, -90, 90)) projection.latitude = value.latitude;
  if (finiteBetween(value.longitude, -180, 180)) projection.longitude = value.longitude;
  return projection;
}

function qualifyingAdditionalOffice(value) {
  if (!isPlainObject(value) || typeof value.id !== 'string' || !STABLE_ID_PATTERN.test(value.id) ||
      !nonblank(value.name) || (!validCoordinatePair(value) && !completeAddress(value))) {
    return null;
  }
  const projection = { id: value.id, name: value.name };
  if (completeAddress(value)) {
    for (const field of ['street', 'city', 'state', 'zip', 'country']) projection[field] = value[field];
  }
  if (validCoordinatePair(value)) {
    projection.latitude = value.latitude;
    projection.longitude = value.longitude;
  }
  return projection;
}

function validPolygon(value) {
  if (!Array.isArray(value) || value.length < 3) return false;
  return value.every(function (point) {
    if (Array.isArray(point) && point.length === 2) {
      return finiteBetween(point[0], -90, 90) && finiteBetween(point[1], -180, 180);
    }
    return validCoordinatePair(point);
  });
}

function projectPolygon(value) {
  if (!validPolygon(value)) return undefined;
  return value.map(function (point) {
    return Array.isArray(point)
      ? [point[0], point[1]]
      : { latitude: point.latitude, longitude: point.longitude };
  });
}

function isIanaTimeZone(value) {
  if (!nonblank(value)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch (_error) {
    return false;
  }
}

function stableHash(itemId, source) {
  return crypto.createHash('sha256')
    .update(stableStringify({ itemId, source }))
    .digest('hex');
}

function sourceResult(itemId, present, source, options) {
  const unavailable = Boolean(options && options.authorityUnavailable);
  const notApplicableAllowed = options && hasOwn(options, 'notApplicableAllowed')
    ? Boolean(options.notApplicableAllowed)
    : !present && !unavailable;
  return Object.freeze({
    authorityUnavailable: unavailable,
    hash: stableHash(itemId, source),
    notApplicableAllowed,
    present: Boolean(present),
    source: stableValue(source),
    sourceState: unavailable ? 'authority_unavailable' : present ? 'configured' : 'missing',
  });
}

function companyIdentitySource(profile) {
  const company = isPlainObject(profile.company) ? profile.company : {};
  const name = typeof company.name === 'string' ? company.name.trim() : '';
  return sourceResult('company_identity', nonblank(name), { name });
}

function businessLocaleSource(profile) {
  const company = isPlainObject(profile.company) ? profile.company : {};
  const timeZone = typeof company.timeZone === 'string' ? company.timeZone : '';
  const currency = typeof company.currency === 'string' ? company.currency : '';
  const present = isIanaTimeZone(timeZone) && /^[A-Z]{3}$/.test(currency);
  return sourceResult('business_locale', present, { currency, timeZone });
}

function activeServicesSource(profile) {
  const services = Array.isArray(profile.services) ? profile.services : [];
  const active = services.filter(function (service) {
    return isPlainObject(service) && service.active !== false &&
      typeof service.id === 'string' && STABLE_ID_PATTERN.test(service.id) && nonblank(service.name);
  }).map(function (service) {
    return { active: true, id: service.id, name: service.name };
  }).sort(function (left, right) {
    return compareText(left.id.toLowerCase(), right.id.toLowerCase()) ||
      compareText(left.id, right.id) || compareText(left.name, right.name);
  });
  return sourceResult('active_services', active.length > 0, { services: active });
}

function businessContactSource(profile) {
  const company = isPlainObject(profile.company) ? profile.company : {};
  const email = typeof company.email === 'string' ? company.email.trim() : '';
  const phone = typeof company.phone === 'string' ? company.phone.trim() : '';
  const source = {};
  if (EMAIL_PATTERN.test(email)) source.email = email;
  if (nonblank(phone)) source.phone = phone;
  return sourceResult('business_contact', Object.keys(source).length > 0, source);
}

function businessContextSource(profile) {
  const industry = typeof profile.industry === 'string' ? profile.industry.trim() : '';
  const businessDescription = typeof profile.businessDescription === 'string'
    ? profile.businessDescription.trim() : '';
  const source = {};
  if (nonblank(businessDescription)) source.businessDescription = businessDescription;
  if (nonblank(industry)) source.industry = industry;
  return sourceResult(
    'business_context',
    Object.keys(source).length > 0,
    source
  );
}

function operatingOriginSource(profile) {
  const routing = isPlainObject(profile.routing) ? profile.routing : {};
  const dispatchFrom = typeof routing.dispatchFrom === 'string' ? routing.dispatchFrom : '';
  const headquarters = isPlainObject(profile.headquarters) ? profile.headquarters : {};
  if (dispatchFrom === 'headquarters') {
    const present = validCoordinatePair(headquarters) || completeAddress(headquarters);
    return sourceResult('operating_origin', present, {
      dispatchFrom,
      headquarters: recognizedLocation(headquarters, false),
    }, { notApplicableAllowed: false });
  }
  if (dispatchFrom === 'nearest-office') {
    const offices = Array.isArray(headquarters.additionalOffices)
      ? headquarters.additionalOffices.map(qualifyingAdditionalOffice).filter(Boolean).sort(function (left, right) {
        return compareText(String(left.id || '').toLowerCase(), String(right.id || '').toLowerCase()) ||
          compareText(left.id || '', right.id || '') || compareText(left.name || '', right.name || '') ||
          compareText(stableStringify(left), stableStringify(right));
      }) : [];
    return sourceResult(
      'operating_origin',
      offices.length > 0,
      { dispatchFrom, offices },
      { notApplicableAllowed: false }
    );
  }
  if (dispatchFrom === 'assigned-crew') {
    return sourceResult(
      'operating_origin',
      false,
      { dispatchFrom, requiredAuthority: 'assigned_crew_coordinates' },
      { authorityUnavailable: true, notApplicableAllowed: false }
    );
  }
  return sourceResult(
    'operating_origin',
    false,
    { dispatchFrom },
    { notApplicableAllowed: dispatchFrom === '' }
  );
}

function serviceAreaSource(profile) {
  const area = isPlainObject(profile.serviceArea) ? profile.serviceArea : {};
  const source = {};
  if (finiteBetween(area.maxRadiusMiles, 1, 500)) source.maxRadiusMiles = area.maxRadiusMiles;
  if (finiteBetween(area.maxTravelMinutes, 1, 240)) source.maxTravelMinutes = area.maxTravelMinutes;
  if (nonblank(area.primaryTerritory)) source.primaryTerritory = area.primaryTerritory;
  const polygon = projectPolygon(area.polygon);
  if (polygon) source.polygon = polygon;
  return sourceResult('service_area', Object.keys(source).length > 0, source);
}

function weeklyHoursSource(profile) {
  const hours = isPlainObject(profile.hours) ? profile.hours : {};
  const schedule = {};
  for (const day of WEEKDAYS) {
    const value = isPlainObject(hours[day]) ? hours[day] : {};
    if (typeof value.open === 'string' && TIME_PATTERN.test(value.open) &&
        typeof value.close === 'string' && TIME_PATTERN.test(value.close)) {
      schedule[day] = { close: value.close, open: value.open };
    }
  }
  return sourceResult('weekly_hours', Object.keys(schedule).length > 0, { schedule });
}

function customerGuidanceSource(profile) {
  const source = {};
  for (const field of ['emergencyPolicy', 'customPrompt']) {
    if (nonblank(profile[field])) source[field] = profile[field];
  }
  for (const field of ['faq', 'companyValues']) {
    if (!Array.isArray(profile[field])) continue;
    const values = profile[field].filter(nonblank);
    if (values.length) source[field] = values;
  }
  if (isPlainObject(profile.policies)) {
    const policies = Object.keys(profile.policies).sort().reduce(function (result, key) {
      if (nonblank(key) && nonblank(profile.policies[key])) result[key] = profile.policies[key];
      return result;
    }, {});
    if (Object.keys(policies).length) source.policies = policies;
  }
  return sourceResult('customer_guidance', Object.keys(source).length > 0, source);
}

function validFinancialValue(section, field, value) {
  if (section === 'canonicalCosts' &&
      (field === 'materialCostByService' || field === 'equipmentCostByReference')) {
    return isPlainObject(value) && Object.keys(value).some(function (key) {
      return nonblank(key) && finiteBetween(value[key], 0);
    });
  }
  if (!finiteBetween(value, 0)) return false;
  if (section === 'crew' && field === 'overtimeMultiplier') return value >= 1;
  if ((section === 'canonicalPricing' && [
    'taxRatePercent', 'desiredGrossMarginPercent', 'desiredNetMarginPercent',
    'maximumDiscountPercent', 'defaultRangePercent',
  ].includes(field)) || (section === 'vehicles' && field === 'maintenanceReserve')) {
    return value <= 100;
  }
  return true;
}

function financialConfigurationSource(profile) {
  const source = {};
  for (const [section, fields] of Object.entries(FINANCIAL_CONFIGURATION_FIELDS)) {
    const current = isPlainObject(profile[section]) ? profile[section] : {};
    const projection = {};
    for (const field of fields) {
      const value = current[field];
      if (!validFinancialValue(section, field, value)) continue;
      if (isPlainObject(value)) {
        const map = Object.keys(value).sort().reduce(function (result, key) {
          if (nonblank(key) && finiteBetween(value[key], 0)) result[key] = value[key];
          return result;
        }, {});
        if (Object.keys(map).length) projection[field] = map;
      } else {
        projection[field] = value;
      }
    }
    if (Object.keys(projection).length) source[section] = projection;
  }
  return sourceResult('financial_configuration', Object.keys(source).length > 0, source);
}

function voiceConfigurationSource(profile) {
  const voice = isPlainObject(profile.voiceAssistant) ? profile.voiceAssistant : {};
  const source = {};
  for (const field of VOICE_FIELDS) {
    if (!hasOwn(voice, field)) continue;
    if (['name', 'style', 'greeting'].includes(field)) {
      if (nonblank(voice[field])) source[field] = voice[field];
      continue;
    }
    if (field === 'personality' || field === 'conversationStyle') {
      if (nonblank(voice[field])) source[field] = voice[field];
      continue;
    }
    if (field === 'escalationRules' && isPlainObject(voice[field]) && Array.isArray(voice[field].rules)) {
      const rules = voice[field].rules.filter(isPlainObject).map(function (rule) {
        return ['id', 'enabled', 'when', 'action', 'fallbackAction'].reduce(function (result, key) {
          if (hasOwn(rule, key)) result[key] = rule[key];
          return result;
        }, {});
      }).sort(function (left, right) {
        return compareText(String(left.id || '').toLowerCase(), String(right.id || '').toLowerCase()) ||
          compareText(left.id || '', right.id || '');
      });
      if (rules.length) source.escalationRules = { rules };
    }
  }
  return sourceResult('voice_configuration', Object.keys(source).length > 0, source);
}

const REGISTRY = Object.freeze([
  Object.freeze({
    id: 'company_identity', label: 'Company identity',
    help: 'Confirm the company name NorthStar and Polaris should use.',
    missingReason: 'Add a company name.', required: true, source: companyIdentitySource,
  }),
  Object.freeze({
    id: 'business_locale', label: 'Business locale',
    help: 'Set the time zone and currency used for business operations.',
    missingReason: 'Add a valid time zone and three-letter currency.', required: true,
    source: businessLocaleSource,
  }),
  Object.freeze({
    id: 'active_services', label: 'Active services',
    help: 'Identify at least one active service with a stable ID and name.',
    missingReason: 'Add at least one valid active service.', required: true,
    source: activeServicesSource,
  }),
  Object.freeze({
    id: 'business_contact', label: 'Business contact',
    help: 'Provide a valid business email or a business phone number.',
    recommendedReason: 'A business email or phone number is recommended.', recommended: true,
    source: businessContactSource,
  }),
  Object.freeze({
    id: 'business_context', label: 'Business context',
    help: 'Describe the industry or the work your business performs.',
    recommendedReason: 'An industry or business description is recommended.', recommended: true,
    source: businessContextSource,
  }),
  Object.freeze({
    id: 'operating_origin', label: 'Operating origin',
    help: 'Review the recognized origin used for dispatch and travel planning.',
    missingReason: 'Choose an origin with recognized location details. Not applicable is available only when dispatch origin is blank.',
    allowNotApplicable: true, source: operatingOriginSource,
  }),
  Object.freeze({
    id: 'service_area', label: 'Service area',
    help: 'Review the bounded area where the business provides service.',
    missingReason: 'Add a bounded radius, travel limit, territory, or polygon, or mark this item Not applicable.',
    allowNotApplicable: true, source: serviceAreaSource,
  }),
  Object.freeze({
    id: 'weekly_hours', label: 'Weekly hours',
    help: 'Review the current weekly operating schedule.',
    missingReason: 'Add at least one valid open and close pair, or mark this item Not applicable.',
    allowNotApplicable: true, source: weeklyHoursSource,
  }),
  Object.freeze({
    id: 'customer_guidance', label: 'Customer guidance',
    help: 'Review recognized emergency guidance, FAQs, values, prompts, or policies.',
    missingReason: 'Add recognized customer guidance, or mark this item Not applicable.',
    allowNotApplicable: true, source: customerGuidanceSource,
  }),
  Object.freeze({
    id: 'financial_configuration', label: 'Financial configuration',
    help: 'Review the dedicated financial fields used for configured business calculations.',
    missingReason: 'Add dedicated financial configuration, or mark this item Not applicable.',
    allowNotApplicable: true, source: financialConfigurationSource,
  }),
  Object.freeze({
    id: 'voice_configuration', label: 'Voice configuration',
    help: 'Review provider-neutral voice settings without using connection status.',
    missingReason: 'Add provider-neutral voice configuration, or mark this item Not applicable.',
    allowNotApplicable: true, source: voiceConfigurationSource,
  }),
]);

const REGISTRY_BY_ID = new Map(REGISTRY.map(function (item) { return [item.id, item]; }));

function validIsoDate(value) {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function validStoredItem(value) {
  if (!isPlainObject(value) || Object.keys(value).length !== 3 ||
      !Object.keys(value).every(function (key) {
        return ['applicability', 'lastReviewedAt', 'reviewedValueHash'].includes(key);
      }) || !APPLICABILITY.has(value.applicability)) {
    return false;
  }
  const neverReviewed = value.lastReviewedAt === null && value.reviewedValueHash === null;
  const reviewed = validIsoDate(value.lastReviewedAt) &&
    typeof value.reviewedValueHash === 'string' && REVIEWED_HASH_PATTERN.test(value.reviewedValueHash);
  return neverReviewed || reviewed;
}

function storedReadiness(profile) {
  const value = isPlainObject(profile.profileReadiness) ? profile.profileReadiness : null;
  if (!value || value.schemaVersion !== PROFILE_READINESS_SCHEMA_VERSION ||
      !isPlainObject(value.items) || Object.keys(value).some(function (key) {
        return key !== 'schemaVersion' && key !== 'items';
      })) {
    return { hasAuthority: false, items: {} };
  }
  const items = {};
  for (const item of REGISTRY) {
    if (validStoredItem(value.items[item.id])) items[item.id] = stableValue(value.items[item.id]);
  }
  return { hasAuthority: true, items };
}

function itemProjection(definition, source, stored) {
  const storedNotApplicable = Boolean(stored && stored.applicability === 'not_applicable');
  const notApplicable = Boolean(
    definition.allowNotApplicable && source.notApplicableAllowed && storedNotApplicable &&
    !source.present && !source.authorityUnavailable
  );
  const applicability = notApplicable ? 'not_applicable' : 'applicable';
  let state;
  if (source.authorityUnavailable) state = 'authority_unavailable';
  else if (notApplicable) state = 'not_applicable';
  else if (!source.present) state = definition.recommended ? 'recommended' : 'missing';
  else if (stored && stored.applicability === 'applicable' && stored.reviewedValueHash === source.hash) state = 'reviewed';
  else state = 'needs_review';

  return Object.freeze({
    id: definition.id,
    label: definition.label,
    help: definition.help,
    applicability,
    state,
    sourceState: source.sourceState,
    missingReason: state === 'missing' || state === 'authority_unavailable'
      ? definition.missingReason || 'Required source authority is unavailable.' : null,
    recommendedReason: state === 'recommended' ? definition.recommendedReason : null,
    lastReviewedAt: stored ? stored.lastReviewedAt : null,
    canReview: source.present && !source.authorityUnavailable && state !== 'reviewed',
    canMarkApplicable: state === 'not_applicable',
    canMarkNotApplicable: Boolean(
      definition.allowNotApplicable && source.notApplicableAllowed &&
      !source.present && !source.authorityUnavailable && state !== 'not_applicable'
    ),
  });
}

function projectProfileReadiness(profile, authority) {
  const sourceProfile = isPlainObject(profile) ? profile : {};
  const stored = storedReadiness(sourceProfile);
  const items = {};
  for (const definition of REGISTRY) {
    items[definition.id] = itemProjection(
      definition,
      definition.source(sourceProfile),
      stored.items[definition.id]
    );
  }
  const states = Object.values(items).map(function (item) { return item.state; });
  const actionNeeded = states.some(function (state) {
    return state === 'missing' || state === 'recommended' || state === 'authority_unavailable';
  });
  const overallState = actionNeeded ? 'action_needed'
    : states.includes('needs_review') ? 'review_needed' : 'ready_for_configured_uses';
  const version = authority && typeof authority.version === 'string' ? authority.version
    : authority && typeof authority.versionLabel === 'string' ? authority.versionLabel : null;
  return Object.freeze({
    schemaVersion: PROFILE_READINESS_SCHEMA_VERSION,
    canonicalAuthority: Object.freeze({ version }),
    overallState,
    hasStoredReadiness: stored.hasAuthority,
    itemOrder: Object.freeze(REGISTRY.map(function (item) { return item.id; })),
    items: Object.freeze(items),
  });
}

function readinessError(code, message, details, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status || 400;
  if (details) error.details = details;
  return error;
}

function parseProfileReadinessWrite(body) {
  const errors = [];
  if (!isPlainObject(body) || Object.keys(body).length !== 2 ||
      !hasOwn(body, 'expectedVersion') || !hasOwn(body, 'changes')) {
    throw readinessError(
      'INVALID_PROFILE_READINESS_WRITE',
      'Profile Readiness writes require an exact concurrency envelope.',
      ['Body must contain exactly expectedVersion and changes.']
    );
  }
  if (body.expectedVersion !== null &&
      (typeof body.expectedVersion !== 'string' || !PROFILE_VERSION_PATTERN.test(body.expectedVersion))) {
    errors.push('expectedVersion must be a canonical Business Profile version label or null.');
  }
  if (!Array.isArray(body.changes) || body.changes.length === 0 || body.changes.length > REGISTRY.length) {
    errors.push('changes must be a non-empty array with at most ' + REGISTRY.length + ' entries.');
  }
  const seen = new Set();
  if (Array.isArray(body.changes)) {
    body.changes.forEach(function (change, index) {
      const path = 'changes[' + index + ']';
      if (!isPlainObject(change) || Object.keys(change).length !== 2 ||
          !hasOwn(change, 'itemId') || !hasOwn(change, 'action')) {
        errors.push(path + ' must contain exactly itemId and action.');
        return;
      }
      if (typeof change.itemId !== 'string' || !REGISTRY_BY_ID.has(change.itemId)) {
        errors.push(path + '.itemId is not a recognized Profile Readiness item.');
      } else if (seen.has(change.itemId)) {
        errors.push(path + '.itemId duplicates ' + change.itemId + '.');
      } else {
        seen.add(change.itemId);
      }
      if (typeof change.action !== 'string' || !ACTIONS.has(change.action)) {
        errors.push(path + '.action must be review, mark_applicable, or mark_not_applicable.');
      }
    });
  }
  if (errors.length) {
    throw readinessError(
      'INVALID_PROFILE_READINESS_WRITE',
      'Profile Readiness validation failed.',
      errors
    );
  }
  return {
    expectedVersion: body.expectedVersion,
    changes: body.changes.map(function (change) {
      return { itemId: change.itemId, action: change.action };
    }),
  };
}

function applyProfileReadinessChanges(profile, changes, now) {
  const sourceProfile = isPlainObject(profile) ? stableValue(profile) : {};
  const stored = storedReadiness(sourceProfile);
  const items = stableValue(stored.items);
  let stamp = null;
  if (changes.some(function (change) { return change.action === 'review'; })) {
    const reviewedAt = now instanceof Date ? now : new Date();
    if (Number.isNaN(reviewedAt.getTime())) {
      throw readinessError('PROFILE_READINESS_TIME_UNAVAILABLE', 'Profile Readiness review time is unavailable.', null, 503);
    }
    stamp = reviewedAt.toISOString();
  }
  for (const change of changes) {
    const definition = REGISTRY_BY_ID.get(change.itemId);
    const source = definition.source(sourceProfile);
    const current = itemProjection(definition, source, items[change.itemId]);
    if (change.action === 'mark_not_applicable') {
      if (!definition.allowNotApplicable) {
        throw readinessError(
          'PROFILE_READINESS_NOT_APPLICABLE_FORBIDDEN',
          definition.label + ' cannot be marked Not applicable.'
        );
      }
      if (!source.notApplicableAllowed || source.present || source.authorityUnavailable) {
        throw readinessError(
          'PROFILE_READINESS_NOT_APPLICABLE_CONFLICT',
          definition.label + ' cannot be marked Not applicable for the current configuration.'
        );
      }
      const previous = validStoredItem(items[change.itemId]) ? items[change.itemId] : null;
      items[change.itemId] = {
        applicability: 'not_applicable',
        lastReviewedAt: previous ? previous.lastReviewedAt : null,
        reviewedValueHash: previous ? previous.reviewedValueHash : null,
      };
      continue;
    }
    if (change.action === 'mark_applicable') {
      if (!current.canMarkApplicable) {
        throw readinessError(
          'PROFILE_READINESS_MARK_APPLICABLE_UNAVAILABLE',
          definition.label + ' can be marked applicable only while its current state is Not applicable.'
        );
      }
      items[change.itemId] = {
        applicability: 'applicable',
        lastReviewedAt: null,
        reviewedValueHash: null,
      };
      continue;
    }
    if (change.action === 'review' && (!source.present || source.authorityUnavailable)) {
      throw readinessError(
        'PROFILE_READINESS_REVIEW_UNAVAILABLE',
        definition.label + ' does not have recognized details available to review.'
      );
    }
    items[change.itemId] = {
      applicability: 'applicable',
      lastReviewedAt: stamp,
      reviewedValueHash: source.hash,
    };
  }
  const next = stableValue(sourceProfile);
  next.profileReadiness = stableValue({
    schemaVersion: PROFILE_READINESS_SCHEMA_VERSION,
    items,
  });
  return next;
}

module.exports = {
  ACTIONS,
  applyProfileReadinessChanges,
  PROFILE_READINESS_SCHEMA_VERSION,
  REGISTRY,
  parseProfileReadinessWrite,
  projectProfileReadiness,
  stableHash,
};
