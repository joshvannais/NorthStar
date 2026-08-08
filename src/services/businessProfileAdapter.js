'use strict';

const crypto = require('crypto');

const RAW_PROFILE_FIELD_TYPES = Object.freeze({
  version: 'string',
  updatedAt: 'string',
  industry: 'string',
  ownerName: 'string',
  businessDescription: 'string',
  company: 'object',
  headquarters: 'object',
  serviceArea: 'object',
  routing: 'object',
  hours: 'object',
  crew: 'object',
  vehicles: 'object',
  services: 'array',
  financial: 'object',
  scheduling: 'object',
  polaris: 'object',
  retell: 'object',
  voiceAssistant: 'object',
  notifications: 'object',
  integrations: 'object',
  canonicalPricing: 'object',
  canonicalCosts: 'object',
  emergencyPolicy: 'string',
  faq: 'array',
  policies: 'object',
  workforce: 'object',
  companyValues: 'array',
  customPrompt: 'string',
});

const RAW_PROFILE_LIMITS = Object.freeze({
  maximumArrayItems: 500,
  maximumContainerKeys: 500,
  maximumKeyBytes: 256,
  maximumNestingDepth: 12,
  maximumProfileBytes: 256 * 1024,
  maximumStringBytes: 32 * 1024,
  maximumValues: 10000,
});

const UNSAFE_RAW_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const COMPANY_FIELDS = new Set([
  'name', 'dba', 'email', 'phone', 'website', 'logo', 'taxId', 'timeZone', 'currency',
]);
const LOCATION_FIELDS = new Set([
  'id', 'name', 'street', 'city', 'state', 'zip', 'country', 'latitude', 'longitude',
]);
const HEADQUARTERS_FIELDS = new Set([
  'street', 'city', 'state', 'zip', 'country', 'latitude', 'longitude', 'additionalOffices',
]);
const SERVICE_AREA_FIELDS = new Set([
  'maxRadiusMiles', 'maxTravelMinutes', 'primaryTerritory', 'polygon',
]);
const WEEKDAYS = Object.freeze([
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
]);
const HOURS_FIELDS = new Set(['open', 'close', 'lunch', 'emergency', 'afterHours', 'holiday']);
const HOLIDAY_FIELDS = new Set(['id', 'name', 'date', 'closed', 'open', 'close']);
const WORKFORCE_FIELDS = new Set(['policies']);
const WORKFORCE_POLICY_FIELDS = new Set(['id', 'name', 'description', 'enabled']);
const VOICE_ASSISTANT_FIELDS = new Set([
  'name', 'style', 'greeting', 'personality', 'conversationStyle', 'escalationRules',
]);
const VOICE_PERSONALITIES = new Set(['professional', 'friendly', 'consultative', 'efficient']);
const VOICE_CONVERSATION_STYLES = new Set(['consultative', 'direct', 'warm']);
const ESCALATION_RULES_FIELDS = new Set(['rules']);
const ESCALATION_RULE_FIELDS = new Set(['id', 'enabled', 'when', 'action', 'fallbackAction']);
const ESCALATION_ACTIONS = new Set(['take_message', 'request_callback', 'transfer_if_available']);
const ESCALATION_FALLBACK_ACTIONS = new Set(['take_message', 'request_callback']);
const OPERATIONAL_CONFIGURATION_FIELDS = Object.freeze({
  routing: new Set([
    'dispatchFrom', 'trafficEnabled', 'useLiveTraffic', 'avoidTolls', 'avoidHighways', 'avoidFerries',
  ]),
  crew: new Set(['defaultCrewSize', 'maxCrewSize', 'shopTime']),
  vehicles: new Set(['truckCount', 'trailerCount', 'averageMpg', 'equipmentTransportCapacity']),
  scheduling: new Set([
    'maxJobsPerDay', 'travelBuffer', 'appointmentBuffer', 'workDayLength',
    'maxDailyTravel', 'preferredDispatchStrategy',
  ]),
});
const FINANCIAL_CONFIGURATION_FIELDS = Object.freeze({
  canonicalPricing: new Set([
    'customerMarkupPercent', 'taxRatePercent', 'emergencyMultiplier',
    'travelCustomerChargePerMile', 'minimumJobPrice', 'desiredGrossMarginPercent',
    'desiredNetMarginPercent', 'maximumDiscountPercent', 'defaultRangePercent',
  ]),
  canonicalCosts: new Set([
    'overheadPercent', 'travelCostPerMile', 'materialCostByService',
    'equipmentCostByReference',
  ]),
  crew: new Set([
    'averageHourlyRate', 'overtimeMultiplier', 'travelPay', 'minimumBillableHours',
  ]),
  vehicles: new Set(['averageFuelCost', 'hourlyVehicleCost', 'maintenanceReserve']),
});
const OPERATIONAL_DISPATCH_ORIGINS = new Set(['', 'headquarters', 'nearest-office', 'assigned-crew']);
const OPERATIONAL_DISPATCH_STRATEGIES = new Set(['', 'efficiency', 'priority', 'balanced']);
const SERVICE_PRICING_FIELDS = new Set([
  'requiredScope', 'allowedScopeValues', 'rangePercent', 'lineItems',
]);
const SERVICE_LINE_ITEM_FIELDS = new Set([
  'code', 'label', 'category', 'type', 'amount', 'quantityField', 'unitRate',
  'selectorField', 'unitRates', 'collectionField', 'when',
]);
const SERVICE_LINE_ITEM_CATEGORIES = new Set(['labor', 'materials', 'equipment', 'serviceCharge']);
const SERVICE_LINE_ITEM_TYPES = new Set(['fixed', 'perUnit', 'perUnitByValue', 'perItemByValue']);
const SERVICE_CONDITION_FIELDS = new Set(['field', 'equals']);
const STABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isPlainObject(value) {
  if (!value || Object.prototype.toString.call(value) !== '[object Object]') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function postgresJsonStringIssue(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0) return 'NUL';
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xDC00 && next <= 0xDFFF) {
        index += 1;
        continue;
      }
      return 'unpaired-surrogate';
    }
    if (code >= 0xDC00 && code <= 0xDFFF) return 'unpaired-surrogate';
  }
  return null;
}

function validateRawBusinessProfile(profile) {
  const errors = [];
  if (!isPlainObject(profile)) return ['Business Profile must be an object.'];

  for (const key of Object.keys(profile)) {
    if (!Object.prototype.hasOwnProperty.call(RAW_PROFILE_FIELD_TYPES, key)) {
      errors.push(key + ' is not a writable Business Profile field.');
      continue;
    }
    const expected = RAW_PROFILE_FIELD_TYPES[key];
    const value = profile[key];
    if (expected === 'object' && !isPlainObject(value)) errors.push(key + ' must be an object.');
    if (expected === 'array' && !Array.isArray(value)) errors.push(key + ' must be an array.');
    if (expected === 'string' && typeof value !== 'string') errors.push(key + ' must be a string.');
  }

  let serialized;
  try {
    serialized = JSON.stringify(profile);
  } catch (_error) {
    errors.push('Business Profile must contain an acyclic JSON value.');
  }
  if (serialized !== undefined && Buffer.byteLength(serialized, 'utf8') > RAW_PROFILE_LIMITS.maximumProfileBytes) {
    errors.push('Business Profile exceeds the maximum UTF-8 byte length of ' + RAW_PROFILE_LIMITS.maximumProfileBytes + '.');
  }

  const seen = new WeakSet();
  let valueCount = 0;
  let valueLimitReported = false;
  function inspect(value, path, depth) {
    valueCount += 1;
    if (valueCount > RAW_PROFILE_LIMITS.maximumValues) {
      if (!valueLimitReported) {
        errors.push('Business Profile exceeds the maximum value count of ' + RAW_PROFILE_LIMITS.maximumValues + '.');
        valueLimitReported = true;
      }
      return;
    }
    if (depth > RAW_PROFILE_LIMITS.maximumNestingDepth) {
      errors.push(path + ' exceeds the maximum nesting depth of ' + RAW_PROFILE_LIMITS.maximumNestingDepth + '.');
      return;
    }
    if (typeof value === 'string') {
      const issue = postgresJsonStringIssue(value);
      if (issue === 'NUL') {
        errors.push(path + ' contains a NUL character that PostgreSQL JSONB cannot represent.');
      } else if (issue === 'unpaired-surrogate') {
        errors.push(path + ' contains an unpaired UTF-16 surrogate that PostgreSQL JSONB cannot represent.');
      }
      if (Buffer.byteLength(value, 'utf8') > RAW_PROFILE_LIMITS.maximumStringBytes) {
        errors.push(path + ' exceeds the maximum UTF-8 byte length of ' + RAW_PROFILE_LIMITS.maximumStringBytes + '.');
      }
      return;
    }
    if (value === null || typeof value === 'boolean') return;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) errors.push(path + ' must be a finite JSON number.');
      return;
    }
    if (typeof value !== 'object') {
      errors.push(path + ' must contain only JSON values.');
      return;
    }
    if (seen.has(value)) {
      errors.push(path + ' must not contain a cyclic reference.');
      return;
    }
    seen.add(value);
    if (Array.isArray(value)) {
      if (value.length > RAW_PROFILE_LIMITS.maximumArrayItems) {
        errors.push(path + ' exceeds the maximum array length of ' + RAW_PROFILE_LIMITS.maximumArrayItems + '.');
      }
      for (let index = 0; index < value.length && !valueLimitReported; index += 1) {
        inspect(value[index], path + '[' + index + ']', depth + 1);
      }
      return;
    }
    if (!isPlainObject(value)) {
      errors.push(path + ' must contain only plain JSON objects.');
      return;
    }
    const keys = Object.keys(value);
    if (keys.length > RAW_PROFILE_LIMITS.maximumContainerKeys) {
      errors.push(path + ' exceeds the maximum object key count of ' + RAW_PROFILE_LIMITS.maximumContainerKeys + '.');
    }
    for (const key of keys) {
      if (UNSAFE_RAW_KEYS.has(key)) errors.push(path + ' contains unsafe key ' + key + '.');
      const keyIssue = postgresJsonStringIssue(key);
      if (keyIssue === 'NUL') {
        errors.push(path + ' contains a key with a NUL character that PostgreSQL JSONB cannot represent.');
      } else if (keyIssue === 'unpaired-surrogate') {
        errors.push(path + ' contains a key with an unpaired UTF-16 surrogate that PostgreSQL JSONB cannot represent.');
      }
      if (Buffer.byteLength(key, 'utf8') > RAW_PROFILE_LIMITS.maximumKeyBytes) {
        errors.push(path + ' contains a key that exceeds the maximum UTF-8 byte length of ' + RAW_PROFILE_LIMITS.maximumKeyBytes + '.');
      }
      if (!valueLimitReported) inspect(value[key], path + '.' + key, depth + 1);
    }
  }
  inspect(profile, 'profile', 0);
  return errors;
}

function addUnsupportedFieldErrors(value, allowed, path, label, errors) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(path + '.' + key + ' is not a supported ' + label + ' field.');
  }
}

function validateStringFields(value, fields, path, errors) {
  for (const field of fields) {
    if (hasOwn(value, field) && typeof value[field] !== 'string') {
      errors.push(path + '.' + field + ' must be a string.');
    }
  }
}

function validateCoordinatePair(value, path, errors) {
  const latitude = value.latitude;
  const longitude = value.longitude;
  const hasLatitude = latitude !== null && latitude !== undefined;
  const hasLongitude = longitude !== null && longitude !== undefined;
  if (hasLatitude !== hasLongitude) {
    errors.push(path + ' latitude and longitude must be configured together.');
  }
  if (hasLatitude && (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90)) {
    errors.push(path + '.latitude must be a finite number between -90 and 90.');
  }
  if (hasLongitude && (typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180)) {
    errors.push(path + '.longitude must be a finite number between -180 and 180.');
  }
}

function validateLocation(value, path, options, errors) {
  if (!isPlainObject(value)) {
    errors.push(path + ' must be an object.');
    return;
  }
  const allowed = options && options.headquarters ? HEADQUARTERS_FIELDS : LOCATION_FIELDS;
  addUnsupportedFieldErrors(value, allowed, path, options && options.headquarters ? 'headquarters' : 'location', errors);
  validateStringFields(value, ['id', 'name', 'street', 'city', 'state', 'zip', 'country'], path, errors);
  if (hasOwn(value, 'country') && typeof value.country === 'string' && value.country && !/^[A-Z]{2}$/.test(value.country)) {
    errors.push(path + '.country must be a two-letter uppercase country code.');
  }
  if (hasOwn(value, 'id') && typeof value.id === 'string' && value.id && !STABLE_ID_PATTERN.test(value.id)) {
    errors.push(path + '.id must be a stable identifier using letters, numbers, dot, underscore, colon, or hyphen.');
  }
  if (!(options && options.headquarters)) {
    if (!hasOwn(value, 'name') || typeof value.name !== 'string' || !value.name.trim()) {
      errors.push(path + '.name must not be blank.');
    }
  }
  validateCoordinatePair(value, path, errors);
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (_error) {
    return false;
  }
}

function isIanaTimeZone(value) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch (_error) {
    return false;
  }
}

function validateCompany(company, errors) {
  if (!isPlainObject(company)) return;
  addUnsupportedFieldErrors(company, COMPANY_FIELDS, 'company', 'company', errors);
  validateStringFields(company, COMPANY_FIELDS, 'company', errors);
  if (!hasOwn(company, 'name') || typeof company.name !== 'string' || !company.name.trim()) {
    errors.push('company.name must not be blank.');
  }
  if (typeof company.email === 'string' && company.email && !EMAIL_PATTERN.test(company.email.trim())) {
    errors.push('company.email must be a valid email address.');
  }
  for (const field of ['website', 'logo']) {
    if (typeof company[field] === 'string' && company[field] && !isHttpUrl(company[field])) {
      errors.push('company.' + field + ' must use http or https.');
    }
  }
  if (typeof company.timeZone === 'string' && company.timeZone && !isIanaTimeZone(company.timeZone)) {
    errors.push('company.timeZone must be an IANA time zone.');
  }
  if (typeof company.currency === 'string' && company.currency && !/^[A-Z]{3}$/.test(company.currency)) {
    errors.push('company.currency must be a three-letter uppercase currency code.');
  }
}

function validateHeadquarters(headquarters, errors) {
  if (!isPlainObject(headquarters)) return;
  validateLocation(headquarters, 'headquarters', { headquarters: true }, errors);
  if (!hasOwn(headquarters, 'additionalOffices')) return;
  if (!Array.isArray(headquarters.additionalOffices)) {
    errors.push('headquarters.additionalOffices must be an array.');
    return;
  }
  const ids = new Set();
  headquarters.additionalOffices.forEach(function (office, index) {
    const path = 'headquarters.additionalOffices[' + index + ']';
    validateLocation(office, path, null, errors);
    if (!isPlainObject(office) || typeof office.id !== 'string' || !office.id) return;
    if (ids.has(office.id)) errors.push('headquarters.additionalOffices contains duplicate id ' + office.id + '.');
    ids.add(office.id);
  });
}

function validateBoundedNumber(value, path, minimum, maximum, errors) {
  if (value === null || value === undefined) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    errors.push(path + ' must be a finite number between ' + minimum + ' and ' + maximum + '.');
  }
}

function validateServiceArea(serviceArea, errors) {
  if (!isPlainObject(serviceArea)) return;
  addUnsupportedFieldErrors(serviceArea, SERVICE_AREA_FIELDS, 'serviceArea', 'service area', errors);
  if (hasOwn(serviceArea, 'primaryTerritory') && typeof serviceArea.primaryTerritory !== 'string') {
    errors.push('serviceArea.primaryTerritory must be a string.');
  }
  validateBoundedNumber(serviceArea.maxRadiusMiles, 'serviceArea.maxRadiusMiles', 1, 500, errors);
  validateBoundedNumber(serviceArea.maxTravelMinutes, 'serviceArea.maxTravelMinutes', 1, 240, errors);
  if (!hasOwn(serviceArea, 'polygon')) return;
  if (!Array.isArray(serviceArea.polygon)) {
    errors.push('serviceArea.polygon must be an array.');
    return;
  }
  if (serviceArea.polygon.length > 0 && serviceArea.polygon.length < 3) {
    errors.push('serviceArea.polygon must be empty or contain at least three coordinate points.');
  }
  serviceArea.polygon.forEach(function (point, index) {
    const path = 'serviceArea.polygon[' + index + ']';
    let latitude;
    let longitude;
    if (Array.isArray(point) && point.length === 2) {
      [latitude, longitude] = point;
    } else if (isPlainObject(point) && Object.keys(point).every(function (key) { return key === 'latitude' || key === 'longitude'; })) {
      latitude = point.latitude;
      longitude = point.longitude;
    } else {
      errors.push(path + ' must be a [latitude, longitude] pair or coordinate object.');
      return;
    }
    if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      errors.push(path + ' latitude must be between -90 and 90.');
    }
    if (typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      errors.push(path + ' longitude must be between -180 and 180.');
    }
  });
}

function isTime(value) {
  return typeof value === 'string' && TIME_PATTERN.test(value);
}

function validateTimePair(value, path, errors, required) {
  const open = typeof value.open === 'string' ? value.open : null;
  const close = typeof value.close === 'string' ? value.close : null;
  const hasOpen = Boolean(open);
  const hasClose = Boolean(close);
  if (hasOpen !== hasClose) errors.push(path + ' open and close must be configured together.');
  if (required && !hasOpen && !hasClose) errors.push(path + ' open and close are required when the date is not closed.');
  if (hasOpen && !isTime(open)) errors.push(path + '.open must be empty or use HH:mm.');
  if (hasClose && !isTime(close)) errors.push(path + '.close must be empty or use HH:mm.');
}

function isRealDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validateHours(hours, errors) {
  if (!isPlainObject(hours)) return;
  const allowed = new Set([...WEEKDAYS, 'holidays']);
  addUnsupportedFieldErrors(hours, allowed, 'hours', 'hours', errors);
  for (const day of WEEKDAYS) {
    if (!hasOwn(hours, day)) continue;
    const value = hours[day];
    const path = 'hours.' + day;
    if (!isPlainObject(value)) {
      errors.push(path + ' must be an object.');
      continue;
    }
    addUnsupportedFieldErrors(value, HOURS_FIELDS, path, 'hours', errors);
    validateStringFields(value, ['open', 'close', 'lunch'], path, errors);
    for (const field of ['emergency', 'afterHours', 'holiday']) {
      if (hasOwn(value, field) && typeof value[field] !== 'boolean') errors.push(path + '.' + field + ' must be a boolean.');
    }
    validateTimePair(value, path, errors, false);
    if (typeof value.lunch === 'string' && value.lunch && !/^((?:[01]\d|2[0-3]):[0-5]\d)-((?:[01]\d|2[0-3]):[0-5]\d)$/.test(value.lunch)) {
      errors.push(path + '.lunch must be empty or use HH:mm-HH:mm.');
    }
  }
  if (!hasOwn(hours, 'holidays')) return;
  if (!Array.isArray(hours.holidays)) {
    errors.push('hours.holidays must be an array.');
    return;
  }
  const ids = new Set();
  hours.holidays.forEach(function (holiday, index) {
    const path = 'hours.holidays[' + index + ']';
    if (!isPlainObject(holiday)) {
      errors.push(path + ' must be an object.');
      return;
    }
    addUnsupportedFieldErrors(holiday, HOLIDAY_FIELDS, path, 'holiday', errors);
    validateStringFields(holiday, ['id', 'name', 'date', 'open', 'close'], path, errors);
    if (!hasOwn(holiday, 'id') || typeof holiday.id !== 'string' || !STABLE_ID_PATTERN.test(holiday.id)) {
      errors.push(path + '.id must be a stable identifier using letters, numbers, dot, underscore, colon, or hyphen.');
    } else {
      if (ids.has(holiday.id)) errors.push('hours.holidays contains duplicate id ' + holiday.id + '.');
      ids.add(holiday.id);
    }
    if (!hasOwn(holiday, 'name') || typeof holiday.name !== 'string' || !holiday.name.trim()) {
      errors.push(path + '.name must not be blank.');
    }
    if (!isRealDate(holiday.date)) errors.push(path + '.date must be a real YYYY-MM-DD date.');
    if (typeof holiday.closed !== 'boolean') errors.push(path + '.closed must be a boolean.');
    validateTimePair(holiday, path, errors, holiday.closed === false);
    if (holiday.closed === true && (holiday.open || holiday.close)) {
      errors.push(path + ' must not configure hours when closed.');
    }
  });
}

function validatePolicies(policies, errors) {
  if (!isPlainObject(policies)) return;
  for (const key of Object.keys(policies)) {
    if (!key.trim()) errors.push('policies contains a blank key.');
    if (typeof policies[key] !== 'string') errors.push('policies.' + key + ' must be a string.');
  }
}

function validateWorkforce(workforce, errors) {
  if (!isPlainObject(workforce)) return;
  addUnsupportedFieldErrors(workforce, WORKFORCE_FIELDS, 'workforce', 'workforce', errors);
  if (!hasOwn(workforce, 'policies')) return;
  if (!Array.isArray(workforce.policies)) {
    errors.push('workforce.policies must be an array.');
    return;
  }
  if (workforce.policies.length > 100) errors.push('workforce.policies must contain at most 100 entries.');
  const ids = new Set();
  workforce.policies.forEach(function (policy, index) {
    const path = 'workforce.policies[' + index + ']';
    if (!isPlainObject(policy)) {
      errors.push(path + ' must be an object.');
      return;
    }
    addUnsupportedFieldErrors(policy, WORKFORCE_POLICY_FIELDS, path, 'workforce policy', errors);
    if (!hasOwn(policy, 'id') || typeof policy.id !== 'string' || !STABLE_ID_PATTERN.test(policy.id)) {
      errors.push(path + '.id must be a stable identifier.');
    } else {
      const normalized = policy.id.toLowerCase();
      if (ids.has(normalized)) errors.push('workforce.policies contains duplicate id ' + policy.id + '.');
      ids.add(normalized);
    }
    if (!hasOwn(policy, 'name') || typeof policy.name !== 'string' || !policy.name.trim() ||
        Buffer.byteLength(policy.name, 'utf8') > 480 || Array.from(policy.name).length > 120) {
      errors.push(path + '.name must be non-blank text of at most 120 characters and 480 UTF-8 bytes.');
    }
    if (!hasOwn(policy, 'description') || typeof policy.description !== 'string' ||
        Buffer.byteLength(typeof policy.description === 'string' ? policy.description : '', 'utf8') > 4096) {
      errors.push(path + '.description must be text of at most 4096 UTF-8 bytes.');
    }
    if (typeof policy.enabled !== 'boolean') errors.push(path + '.enabled must be a boolean.');
  });
}

function validateStringList(value, path, errors) {
  if (!Array.isArray(value)) return;
  if (value.length > 100) errors.push(path + ' must contain at most 100 entries.');
  value.forEach(function (entry, index) {
    if (typeof entry !== 'string') errors.push(path + '[' + index + '] must be a string.');
  });
}

function validateEscalationRules(escalationRules, errors) {
  if (!isPlainObject(escalationRules)) {
    errors.push('voiceAssistant.escalationRules must be an object.');
    return;
  }
  addUnsupportedFieldErrors(
    escalationRules,
    ESCALATION_RULES_FIELDS,
    'voiceAssistant.escalationRules',
    'escalation rules',
    errors
  );
  if (!Array.isArray(escalationRules.rules)) {
    errors.push('voiceAssistant.escalationRules.rules must be an array.');
    return;
  }
  if (escalationRules.rules.length > 20) {
    errors.push('voiceAssistant.escalationRules.rules must contain at most 20 entries.');
  }
  const ids = new Set();
  escalationRules.rules.forEach(function (rule, index) {
    const path = 'voiceAssistant.escalationRules.rules[' + index + ']';
    if (!isPlainObject(rule)) {
      errors.push(path + ' must be an object.');
      return;
    }
    addUnsupportedFieldErrors(rule, ESCALATION_RULE_FIELDS, path, 'escalation rule', errors);
    if (!hasOwn(rule, 'id') || typeof rule.id !== 'string' || !STABLE_ID_PATTERN.test(rule.id)) {
      errors.push(path + '.id must be a stable identifier.');
    } else {
      const normalized = rule.id.toLowerCase();
      if (ids.has(normalized)) errors.push('voiceAssistant.escalationRules.rules contains duplicate id ' + rule.id + '.');
      ids.add(normalized);
    }
    if (typeof rule.enabled !== 'boolean') errors.push(path + '.enabled must be a boolean.');
    if (typeof rule.when !== 'string' || !rule.when.trim() || Array.from(rule.when).length > 512 ||
        Buffer.byteLength(typeof rule.when === 'string' ? rule.when : '', 'utf8') > 2048) {
      errors.push(path + '.when must be non-blank text of at most 512 characters and 2048 UTF-8 bytes.');
    }
    if (typeof rule.action !== 'string' || !ESCALATION_ACTIONS.has(rule.action)) {
      errors.push(path + '.action must be take_message, request_callback, or transfer_if_available.');
    }
    if (typeof rule.fallbackAction !== 'string' || !ESCALATION_FALLBACK_ACTIONS.has(rule.fallbackAction)) {
      errors.push(path + '.fallbackAction must be take_message or request_callback.');
    }
  });
}

function validateVoiceAssistant(voiceAssistant, errors) {
  if (!isPlainObject(voiceAssistant)) {
    errors.push('voiceAssistant must be an object.');
    return;
  }
  addUnsupportedFieldErrors(voiceAssistant, VOICE_ASSISTANT_FIELDS, 'voiceAssistant', 'voice assistant', errors);
  for (const field of ['name', 'style', 'greeting']) {
    if (!hasOwn(voiceAssistant, field)) continue;
    const value = voiceAssistant[field];
    if (typeof value !== 'string') {
      errors.push('voiceAssistant.' + field + ' must be a string.');
      continue;
    }
    if (field === 'name' && (Array.from(value).length > 120 || Buffer.byteLength(value, 'utf8') > 480)) {
      errors.push('voiceAssistant.name must be text of at most 120 characters and 480 UTF-8 bytes.');
    }
    if (field === 'style' && Buffer.byteLength(value, 'utf8') > 4096) {
      errors.push('voiceAssistant.style must be text of at most 4096 UTF-8 bytes.');
    }
    if (field === 'greeting' && Buffer.byteLength(value, 'utf8') > 8192) {
      errors.push('voiceAssistant.greeting must be text of at most 8192 UTF-8 bytes.');
    }
  }
  if (hasOwn(voiceAssistant, 'personality') &&
      (typeof voiceAssistant.personality !== 'string' || !VOICE_PERSONALITIES.has(voiceAssistant.personality))) {
    errors.push('voiceAssistant.personality must be professional, friendly, consultative, or efficient.');
  }
  if (hasOwn(voiceAssistant, 'conversationStyle') &&
      (typeof voiceAssistant.conversationStyle !== 'string' ||
       !VOICE_CONVERSATION_STYLES.has(voiceAssistant.conversationStyle))) {
    errors.push('voiceAssistant.conversationStyle must be consultative, direct, or warm.');
  }
  if (hasOwn(voiceAssistant, 'escalationRules')) {
    validateEscalationRules(voiceAssistant.escalationRules, errors);
  }
}

function validateOptionalOperationalNumber(value, path, options, errors) {
  if (value === null || value === undefined) return;
  const minimum = options && options.minimum;
  const maximum = options && options.maximum;
  if (typeof value !== 'number' || !Number.isFinite(value) ||
      (options && options.integer && !Number.isInteger(value)) ||
      (minimum !== undefined && value < minimum) ||
      (maximum !== undefined && value > maximum)) {
    let expectation = options && options.integer ? 'an integer' : 'a finite number';
    if (minimum !== undefined && maximum !== undefined) expectation += ' between ' + minimum + ' and ' + maximum;
    else if (minimum !== undefined) expectation += ' greater than or equal to ' + minimum;
    else if (maximum !== undefined) expectation += ' less than or equal to ' + maximum;
    errors.push(path + ' must be null or ' + expectation + '.');
  }
}

function validateOperationalConfiguration(profile, targetErrors) {
  const errors = targetErrors || [];
  const routing = isPlainObject(profile.routing) ? profile.routing : null;
  if (routing) {
    if (hasOwn(routing, 'dispatchFrom') &&
        (typeof routing.dispatchFrom !== 'string' || !OPERATIONAL_DISPATCH_ORIGINS.has(routing.dispatchFrom))) {
      errors.push('routing.dispatchFrom must be empty, headquarters, nearest-office, or assigned-crew.');
    }
    for (const field of ['trafficEnabled', 'useLiveTraffic', 'avoidTolls', 'avoidHighways', 'avoidFerries']) {
      if (hasOwn(routing, field) && typeof routing[field] !== 'boolean') {
        errors.push('routing.' + field + ' must be a boolean.');
      }
    }
  }

  const crew = isPlainObject(profile.crew) ? profile.crew : null;
  if (crew) {
    validateOptionalOperationalNumber(crew.defaultCrewSize, 'crew.defaultCrewSize', { integer: true, minimum: 1, maximum: 10 }, errors);
    validateOptionalOperationalNumber(crew.maxCrewSize, 'crew.maxCrewSize', { integer: true, minimum: 1, maximum: 20 }, errors);
    validateOptionalOperationalNumber(crew.shopTime, 'crew.shopTime', { minimum: 0 }, errors);
    if (typeof crew.defaultCrewSize === 'number' && Number.isFinite(crew.defaultCrewSize) &&
        typeof crew.maxCrewSize === 'number' && Number.isFinite(crew.maxCrewSize) &&
        crew.defaultCrewSize > crew.maxCrewSize) {
      errors.push('crew.defaultCrewSize must not exceed crew.maxCrewSize.');
    }
  }

  const vehicles = isPlainObject(profile.vehicles) ? profile.vehicles : null;
  if (vehicles) {
    validateOptionalOperationalNumber(vehicles.truckCount, 'vehicles.truckCount', { integer: true, minimum: 0 }, errors);
    validateOptionalOperationalNumber(vehicles.trailerCount, 'vehicles.trailerCount', { integer: true, minimum: 0 }, errors);
    validateOptionalOperationalNumber(vehicles.averageMpg, 'vehicles.averageMpg', { minimum: 5 }, errors);
    validateOptionalOperationalNumber(
      vehicles.equipmentTransportCapacity,
      'vehicles.equipmentTransportCapacity',
      { integer: true, minimum: 0 },
      errors
    );
  }

  const scheduling = isPlainObject(profile.scheduling) ? profile.scheduling : null;
  if (scheduling) {
    validateOptionalOperationalNumber(scheduling.maxJobsPerDay, 'scheduling.maxJobsPerDay', { integer: true, minimum: 1 }, errors);
    validateOptionalOperationalNumber(scheduling.travelBuffer, 'scheduling.travelBuffer', { integer: true, minimum: 0 }, errors);
    validateOptionalOperationalNumber(scheduling.appointmentBuffer, 'scheduling.appointmentBuffer', { integer: true, minimum: 0 }, errors);
    validateOptionalOperationalNumber(scheduling.workDayLength, 'scheduling.workDayLength', { minimum: 1 }, errors);
    validateOptionalOperationalNumber(scheduling.maxDailyTravel, 'scheduling.maxDailyTravel', { integer: true, minimum: 0 }, errors);
    if (hasOwn(scheduling, 'preferredDispatchStrategy') &&
        (typeof scheduling.preferredDispatchStrategy !== 'string' ||
         !OPERATIONAL_DISPATCH_STRATEGIES.has(scheduling.preferredDispatchStrategy))) {
      errors.push('scheduling.preferredDispatchStrategy must be empty, efficiency, priority, or balanced.');
    }
  }
  return errors;
}

function projectOperationalConfiguration(profile) {
  const source = isPlainObject(profile) ? profile : {};
  return Object.keys(OPERATIONAL_CONFIGURATION_FIELDS).reduce(function (projection, section) {
    const sectionSource = isPlainObject(source[section]) ? source[section] : {};
    projection[section] = {};
    for (const field of OPERATIONAL_CONFIGURATION_FIELDS[section]) {
      if (hasOwn(sectionSource, field)) projection[section][field] = stableValue(sectionSource[field]);
    }
    return projection;
  }, {});
}

function projectFinancialConfiguration(profile) {
  const source = isPlainObject(profile) ? profile : {};
  return Object.keys(FINANCIAL_CONFIGURATION_FIELDS).reduce(function (projection, section) {
    const sectionSource = isPlainObject(source[section]) ? source[section] : {};
    projection[section] = {};
    for (const field of FINANCIAL_CONFIGURATION_FIELDS[section]) {
      if (hasOwn(sectionSource, field)) projection[section][field] = stableValue(sectionSource[field]);
    }
    return projection;
  }, {});
}

function validateNonNegativeNumber(value, path, errors) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    errors.push(path + ' must be a non-negative finite number.');
  }
}

function validateScopeField(value, path, errors) {
  if (typeof value !== 'string' || !STABLE_ID_PATTERN.test(value)) {
    errors.push(path + ' must be a stable scope field identifier.');
  }
}

function validateUnitRates(value, path, errors) {
  if (!isPlainObject(value) || Object.keys(value).length === 0) {
    errors.push(path + ' must be a non-empty object of non-negative finite numbers.');
    return;
  }
  for (const key of Object.keys(value)) {
    if (!key.trim()) errors.push(path + ' keys must not be blank.');
    if (key !== key.toLowerCase()) errors.push(path + ' keys must be lowercase because pricing selectors are normalized to lowercase.');
    validateNonNegativeNumber(value[key], path + '.' + key, errors);
  }
}

function validatePricingCondition(value, path, errors) {
  if (!isPlainObject(value)) {
    errors.push(path + ' must be an object.');
    return;
  }
  addUnsupportedFieldErrors(value, SERVICE_CONDITION_FIELDS, path, 'pricing condition', errors);
  if (!hasOwn(value, 'field')) {
    errors.push(path + '.field is required.');
  } else {
    validateScopeField(value.field, path + '.field', errors);
  }
  if (!hasOwn(value, 'equals')) errors.push(path + '.equals is required.');
}

function validateServiceLineItem(value, path, errors) {
  if (!isPlainObject(value)) {
    errors.push(path + ' must be an object.');
    return;
  }
  addUnsupportedFieldErrors(value, SERVICE_LINE_ITEM_FIELDS, path, 'pricing line item', errors);
  if (!hasOwn(value, 'code') || typeof value.code !== 'string' || !STABLE_ID_PATTERN.test(value.code)) {
    errors.push(path + '.code must be a stable identifier.');
  }
  if (!hasOwn(value, 'label') || typeof value.label !== 'string' || !value.label.trim()) {
    errors.push(path + '.label must not be blank.');
  }
  if (!SERVICE_LINE_ITEM_CATEGORIES.has(value.category)) {
    errors.push(path + '.category must be one of labor, materials, equipment, or serviceCharge.');
  }
  if (!SERVICE_LINE_ITEM_TYPES.has(value.type)) {
    errors.push(path + '.type must be one of fixed, perUnit, perUnitByValue, or perItemByValue.');
  }
  if (hasOwn(value, 'when')) validatePricingCondition(value.when, path + '.when', errors);

  if (value.type === 'fixed') {
    if (!hasOwn(value, 'amount')) errors.push(path + '.amount is required for fixed.');
    else validateNonNegativeNumber(value.amount, path + '.amount', errors);
  }
  if (value.type === 'perUnit' || value.type === 'perUnitByValue') {
    if (!hasOwn(value, 'quantityField')) errors.push(path + '.quantityField is required for ' + value.type + '.');
    else validateScopeField(value.quantityField, path + '.quantityField', errors);
  }
  if (value.type === 'perUnit') {
    if (!hasOwn(value, 'unitRate')) errors.push(path + '.unitRate is required for perUnit.');
    else validateNonNegativeNumber(value.unitRate, path + '.unitRate', errors);
  }
  if (value.type === 'perUnitByValue' || value.type === 'perItemByValue') {
    if (!hasOwn(value, 'selectorField')) errors.push(path + '.selectorField is required for ' + value.type + '.');
    else validateScopeField(value.selectorField, path + '.selectorField', errors);
    if (!hasOwn(value, 'unitRates')) errors.push(path + '.unitRates is required for ' + value.type + '.');
    else validateUnitRates(value.unitRates, path + '.unitRates', errors);
  }
  if (value.type === 'perItemByValue') {
    if (!hasOwn(value, 'collectionField')) errors.push(path + '.collectionField is required for perItemByValue.');
    else validateScopeField(value.collectionField, path + '.collectionField', errors);
  }
}

function validateServicePricing(value, path, errors) {
  if (!isPlainObject(value)) {
    errors.push(path + ' must be an object.');
    return;
  }
  addUnsupportedFieldErrors(value, SERVICE_PRICING_FIELDS, path, 'pricing', errors);
  if (hasOwn(value, 'requiredScope')) {
    if (!Array.isArray(value.requiredScope)) {
      errors.push(path + '.requiredScope must be an array.');
    } else {
      const fields = new Set();
      value.requiredScope.forEach(function (field, index) {
        validateScopeField(field, path + '.requiredScope[' + index + ']', errors);
        if (typeof field === 'string') {
          if (fields.has(field)) errors.push(path + ' contains duplicate required scope field ' + field + '.');
          fields.add(field);
        }
      });
    }
  }
  if (hasOwn(value, 'allowedScopeValues')) {
    if (!isPlainObject(value.allowedScopeValues)) {
      errors.push(path + '.allowedScopeValues must be an object.');
    } else {
      for (const field of Object.keys(value.allowedScopeValues)) {
        validateScopeField(field, path + '.allowedScopeValues field ' + field, errors);
        const allowed = value.allowedScopeValues[field];
        if (!Array.isArray(allowed) || allowed.length === 0) {
          errors.push(path + '.allowedScopeValues.' + field + ' must be a non-empty array.');
          continue;
        }
        allowed.forEach(function (candidate, index) {
          if (candidate === null || !['string', 'number', 'boolean'].includes(typeof candidate) ||
              (typeof candidate === 'number' && !Number.isFinite(candidate))) {
            errors.push(path + '.allowedScopeValues.' + field + '[' + index + '] must be a finite JSON scalar.');
          }
        });
      }
    }
  }
  if (hasOwn(value, 'rangePercent')) {
    if (typeof value.rangePercent !== 'number' || !Number.isFinite(value.rangePercent) ||
        value.rangePercent < 0 || value.rangePercent > 100) {
      errors.push(path + '.rangePercent must be between 0 and 100.');
    }
  }
  if (Object.keys(value).length === 0) return;
  if (!Array.isArray(value.lineItems) || value.lineItems.length === 0) {
    errors.push(path + '.lineItems must be a non-empty array when pricing is configured.');
    return;
  }
  const codes = new Set();
  value.lineItems.forEach(function (lineItem, index) {
    const itemPath = path + '.lineItems[' + index + ']';
    validateServiceLineItem(lineItem, itemPath, errors);
    if (!isPlainObject(lineItem) || typeof lineItem.code !== 'string') return;
    if (codes.has(lineItem.code)) errors.push(path + ' contains duplicate line item code ' + lineItem.code + '.');
    codes.add(lineItem.code);
  });
}

function validateServiceCatalogue(services, errors) {
  if (!Array.isArray(services)) return;
  const ids = new Set();
  services.forEach(function (service, index) {
    const path = 'services[' + index + ']';
    if (!isPlainObject(service)) {
      errors.push(path + ' must be an object.');
      return;
    }
    if (!hasOwn(service, 'id') || typeof service.id !== 'string' || !STABLE_ID_PATTERN.test(service.id)) {
      errors.push(path + '.id must be a stable identifier using letters, numbers, dot, underscore, colon, or hyphen.');
    } else {
      const normalizedId = service.id.toLowerCase();
      if (ids.has(normalizedId)) errors.push('services contains duplicate stable id ' + service.id + '.');
      ids.add(normalizedId);
    }
    if (!hasOwn(service, 'name') || typeof service.name !== 'string' || !service.name.trim()) {
      errors.push(path + '.name must not be blank.');
    }
    for (const field of ['description', 'equipment']) {
      if (hasOwn(service, field) && typeof service[field] !== 'string') errors.push(path + '.' + field + ' must be a string.');
    }
    if (hasOwn(service, 'active') && typeof service.active !== 'boolean') errors.push(path + '.active must be a boolean.');
    if (hasOwn(service, 'crewSize') && (!Number.isInteger(service.crewSize) || service.crewSize <= 0)) {
      errors.push(path + '.crewSize must be a positive integer.');
    }
    for (const field of ['avgHours', 'difficulty']) {
      if (hasOwn(service, field) && (typeof service[field] !== 'number' || !Number.isFinite(service[field]) || service[field] <= 0)) {
        errors.push(path + '.' + field + ' must be a positive finite number.');
      }
    }
    if (hasOwn(service, 'confidence') && (typeof service.confidence !== 'number' || !Number.isFinite(service.confidence) ||
        service.confidence < 0 || service.confidence > 100)) {
      errors.push(path + '.confidence must be between 0 and 100.');
    }
    if (hasOwn(service, 'canonicalPricing')) validateServicePricing(service.canonicalPricing, path + '.canonicalPricing', errors);
  });
}

function validateOperationalBusinessProfile(profile) {
  const errors = [];
  if (hasOwn(profile, 'company')) validateCompany(profile.company, errors);
  if (hasOwn(profile, 'headquarters')) validateHeadquarters(profile.headquarters, errors);
  if (hasOwn(profile, 'serviceArea')) validateServiceArea(profile.serviceArea, errors);
  if (hasOwn(profile, 'hours')) validateHours(profile.hours, errors);
  if (hasOwn(profile, 'policies')) validatePolicies(profile.policies, errors);
  if (hasOwn(profile, 'workforce')) validateWorkforce(profile.workforce, errors);
  if (hasOwn(profile, 'services')) validateServiceCatalogue(profile.services, errors);
  if (hasOwn(profile, 'faq')) validateStringList(profile.faq, 'faq', errors);
  if (hasOwn(profile, 'companyValues')) validateStringList(profile.companyValues, 'companyValues', errors);
  if (hasOwn(profile, 'voiceAssistant')) validateVoiceAssistant(profile.voiceAssistant, errors);
  validateOperationalConfiguration(profile, errors);
  return errors;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce(function (result, key) {
      if (value[key] !== undefined) result[key] = stableValue(value[key]);
      return result;
    }, {});
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function finiteOrNull(value, options) {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return null;
  if (options && options.nonNegative && number < 0) return null;
  if (options && options.positive && number <= 0) return null;
  return number;
}

function integerOrNull(value, options) {
  const number = finiteOrNull(value, options);
  return number === null || !Number.isInteger(number) ? null : number;
}

function configured(source, key, options) {
  if (!source || !Object.prototype.hasOwnProperty.call(source, key)) return null;
  return finiteOrNull(source[key], options);
}

function hasOwn(source, key) {
  return Boolean(source) && Object.prototype.hasOwnProperty.call(source, key);
}

function migrateLegacyFinancialFields(source, migratedFields) {
  const financial = isPlainObject(source.financial) ? source.financial : {};
  const mappings = [
    ['desiredGrossMarginPercent', 'desiredGrossMargin'],
    ['desiredNetMarginPercent', 'desiredNetMargin'],
    ['maximumDiscountPercent', 'maximumDiscount'],
  ];
  const existingPricing = isPlainObject(source.canonicalPricing) ? source.canonicalPricing : null;
  const candidates = mappings.filter(function (mapping) {
    const canonicalKey = mapping[0];
    const legacyKey = mapping[1];
    if (existingPricing && hasOwn(existingPricing, canonicalKey)) return false;
    if (!hasOwn(financial, legacyKey)) return false;
    const value = financial[legacyKey];
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
  });
  if (candidates.length === 0) return;
  if (!hasOwn(source, 'canonicalPricing')) source.canonicalPricing = {};
  if (!isPlainObject(source.canonicalPricing)) return;
  candidates.forEach(function (mapping) {
    const canonicalKey = mapping[0];
    const legacyKey = mapping[1];
    const value = financial[legacyKey];
    source.canonicalPricing[canonicalKey] = value;
    migratedFields.push('canonicalPricing.' + canonicalKey);
  });
}

function migrateLegacyFinancialConfiguration(profile) {
  const source = stableValue(isPlainObject(profile) ? profile : {});
  const migratedFields = [];
  migrateLegacyFinancialFields(source, migratedFields);
  return { profile: source, migratedFields };
}

function migrateLegacyCanonicalAuthority(profile) {
  const source = stableValue(profile && typeof profile === 'object' ? profile : {});
  const migratedFields = [];
  const financial = source.financial && typeof source.financial === 'object' && !Array.isArray(source.financial)
    ? source.financial : {};

  if (!hasOwn(source, 'canonicalPricing')) {
    const canonicalPricing = {};
    const markup = finiteOrNull(financial.markup, { positive: true });
    const travelCharge = finiteOrNull(financial.travelCharge, { nonNegative: true });
    const emergencyMarkup = finiteOrNull(financial.emergencyMarkup, { nonNegative: true });
    const taxRate = finiteOrNull(financial.taxRate, { nonNegative: true });
    const minimumJobPrice = finiteOrNull(financial.minimumJobPrice, { nonNegative: true });
    if (markup !== null && markup >= 1) canonicalPricing.customerMarkupPercent = (markup - 1) * 100;
    if (travelCharge !== null) canonicalPricing.travelCustomerChargePerMile = travelCharge;
    if (emergencyMarkup !== null) canonicalPricing.emergencyMultiplier = emergencyMarkup;
    if (taxRate !== null && taxRate <= 100) canonicalPricing.taxRatePercent = taxRate;
    if (minimumJobPrice !== null) canonicalPricing.minimumJobPrice = minimumJobPrice;
    source.canonicalPricing = canonicalPricing;
    migratedFields.push('canonicalPricing');
  }
  migrateLegacyFinancialFields(source, migratedFields);
  if (!hasOwn(source, 'canonicalCosts')) {
    const canonicalCosts = {};
    const overhead = finiteOrNull(financial.overheadPercent, { nonNegative: true });
    if (overhead !== null) canonicalCosts.overheadPercent = overhead;
    source.canonicalCosts = canonicalCosts;
    migratedFields.push('canonicalCosts');
  }
  if (Array.isArray(source.services)) {
    source.services.forEach(function (service, index) {
      if (!isPlainObject(service) || hasOwn(service, 'id')) return;
      if (hasOwn(service, 'key')) service.id = service.key;
      else if (hasOwn(service, 'serviceId')) service.id = service.serviceId;
      else service.id = 'service-' + sha256({ index, service }).slice(0, 16);
      migratedFields.push('services[' + index + '].id');
    });
  }
  return { profile: source, migratedFields };
}

function validateFinancialConfiguration(profile, targetErrors) {
  const errors = targetErrors || [];
  const source = isPlainObject(profile) ? profile : {};

  function validateNumberFields(sectionName, fields) {
    if (!hasOwn(source, sectionName)) return;
    const section = source[sectionName];
    if (!isPlainObject(section)) {
      errors.push(sectionName + ' must be an object.');
      return;
    }
    for (const field of fields) {
      if (!hasOwn(section, field.key)) continue;
      const value = section[field.key];
      if (field.nullable && value === null) continue;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < field.minimum ||
          (field.maximum !== undefined && value > field.maximum)) {
        let expectation = 'a finite number greater than or equal to ' + field.minimum;
        if (field.maximum !== undefined) expectation = 'a finite number between ' + field.minimum + ' and ' + field.maximum;
        if (field.nullable) expectation = 'null or ' + expectation;
        errors.push(sectionName + '.' + field.key + ' must be ' + expectation + '.');
      }
    }
  }

  validateNumberFields('canonicalPricing', [
    { key: 'customerMarkupPercent', minimum: 0 },
    { key: 'taxRatePercent', minimum: 0, maximum: 100 },
    { key: 'emergencyMultiplier', minimum: 0 },
    { key: 'travelCustomerChargePerMile', minimum: 0 },
    { key: 'minimumJobPrice', minimum: 0 },
    { key: 'desiredGrossMarginPercent', minimum: 0, maximum: 100 },
    { key: 'desiredNetMarginPercent', minimum: 0, maximum: 100 },
    { key: 'maximumDiscountPercent', minimum: 0, maximum: 100 },
    { key: 'defaultRangePercent', minimum: 0, maximum: 100 },
  ]);
  validateNumberFields('canonicalCosts', [
    { key: 'overheadPercent', minimum: 0 },
    { key: 'travelCostPerMile', minimum: 0 },
  ]);
  validateNumberFields('crew', [
    { key: 'averageHourlyRate', minimum: 0, nullable: true },
    { key: 'overtimeMultiplier', minimum: 1, nullable: true },
    { key: 'travelPay', minimum: 0, nullable: true },
    { key: 'minimumBillableHours', minimum: 0, nullable: true },
  ]);
  validateNumberFields('vehicles', [
    { key: 'averageFuelCost', minimum: 0, nullable: true },
    { key: 'hourlyVehicleCost', minimum: 0, nullable: true },
    { key: 'maintenanceReserve', minimum: 0, maximum: 100, nullable: true },
  ]);

  const pricing = isPlainObject(source.canonicalPricing) ? source.canonicalPricing : null;
  if (pricing && typeof pricing.desiredGrossMarginPercent === 'number' &&
      Number.isFinite(pricing.desiredGrossMarginPercent) &&
      typeof pricing.desiredNetMarginPercent === 'number' &&
      Number.isFinite(pricing.desiredNetMarginPercent) &&
      pricing.desiredNetMarginPercent > pricing.desiredGrossMarginPercent) {
    errors.push('canonicalPricing.desiredNetMarginPercent must not exceed canonicalPricing.desiredGrossMarginPercent.');
  }

  const costs = isPlainObject(source.canonicalCosts) ? source.canonicalCosts : null;
  for (const mapName of ['materialCostByService', 'equipmentCostByReference']) {
    if (!costs || !hasOwn(costs, mapName)) continue;
    const map = costs[mapName];
    if (!isPlainObject(map)) {
      errors.push('canonicalCosts.' + mapName + ' must be an object of non-negative finite numbers.');
      continue;
    }
    for (const key of Object.keys(map)) {
      if (!key.trim() || typeof map[key] !== 'number' || !Number.isFinite(map[key]) || map[key] < 0) {
        errors.push('canonicalCosts.' + mapName + '.' + key + ' must be a non-negative finite number.');
      }
    }
  }
  return errors;
}

function validateCanonicalBusinessProfile(profile) {
  return validateFinancialConfiguration(profile, []);
}

function synchronizeLegacyFinancial(profile) {
  const pricing = profile.canonicalPricing;
  const financial = profile.financial && typeof profile.financial === 'object' && !Array.isArray(profile.financial)
    ? profile.financial : {};
  function mirror(canonicalKey, legacyKey, transform, maximum) {
    const value = hasOwn(pricing, canonicalKey) ? pricing[canonicalKey] : null;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0 &&
        (maximum === undefined || value <= maximum)) {
      financial[legacyKey] = transform ? transform(value) : value;
    } else {
      delete financial[legacyKey];
    }
  }
  mirror('customerMarkupPercent', 'markup', function (value) { return 1 + value / 100; });
  mirror('taxRatePercent', 'taxRate', null, 100);
  mirror('emergencyMultiplier', 'emergencyMarkup');
  mirror('travelCustomerChargePerMile', 'travelCharge');
  mirror('minimumJobPrice', 'minimumJobPrice');
  profile.financial = financial;
  return profile;
}

function prepareBusinessProfileForWrite(profile) {
  const rawErrors = validateRawBusinessProfile(profile);
  if (rawErrors.length) {
    return { profile: null, migratedFields: [], errors: rawErrors };
  }
  const migrated = migrateLegacyCanonicalAuthority(profile);
  const operationalErrors = validateOperationalBusinessProfile(migrated.profile);
  if (operationalErrors.length) {
    return { profile: null, migratedFields: [], errors: operationalErrors };
  }
  const errors = validateCanonicalBusinessProfile(migrated.profile);
  if (!errors.length) synchronizeLegacyFinancial(migrated.profile);
  return {
    profile: stableValue(migrated.profile),
    migratedFields: migrated.migratedFields,
    errors,
  };
}

/**
 * Normalize current and future Business Profile shapes into the only profile
 * contract consumed by the canonical Part 3 calculator. Legacy financial
 * fields remain visible for provenance but never become canonical authority.
 * Service calculation rules are retained only from explicit, versioned
 * Business Profile configuration.
 */
function adaptBusinessProfile(profile, version) {
  const source = profile && typeof profile === 'object' ? profile : {};
  const crew = source.crew || {};
  const financial = source.financial || {};
  const canonicalPricing = source.canonicalPricing || {};
  const canonicalCosts = source.canonicalCosts || {};
  const services = Array.isArray(source.services) ? source.services : [];
  const configuredTaxRate = configured(canonicalPricing, 'taxRatePercent', { nonNegative: true });

  const normalized = {
    version: String(version || source.version || source.updatedAt || 'business-profile-v1'),
    currency: source.company && source.company.currency ? String(source.company.currency) : 'USD',
    crew: {
      defaultCrewSize: integerOrNull(crew.defaultCrewSize, { positive: true }),
      averageHourlyCost: finiteOrNull(crew.averageHourlyRate, { nonNegative: true }),
      overtimeMultiplier: finiteOrNull(crew.overtimeMultiplier, { positive: true }),
    },
    operationalConfiguration: projectOperationalConfiguration(source),
    pricing: {
      customerMarkupPercent: configured(canonicalPricing, 'customerMarkupPercent', { nonNegative: true }),
      travelCustomerChargePerMile: configured(canonicalPricing, 'travelCustomerChargePerMile', { nonNegative: true }),
      emergencyMultiplier: configured(canonicalPricing, 'emergencyMultiplier', { nonNegative: true }),
      taxRatePercent: configuredTaxRate !== null && configuredTaxRate <= 100 ? configuredTaxRate : null,
      minimumJobPrice: configured(canonicalPricing, 'minimumJobPrice', { nonNegative: true }),
      defaultRangePercent: (function () {
        const value = configured(canonicalPricing, 'defaultRangePercent', { nonNegative: true });
        return value !== null && value <= 100 ? value : null;
      }()),
      legacyCatalogMarkupMultiplier: finiteOrNull(financial.markup, { positive: true }),
      legacyTravelChargePerMile: finiteOrNull(financial.travelCharge, { nonNegative: true }),
      legacyEmergencyMultiplier: finiteOrNull(financial.emergencyMarkup, { positive: true }),
    },
    costs: {
      overheadPercent: configured(canonicalCosts, 'overheadPercent', { nonNegative: true }),
      travelCostPerMile: configured(canonicalCosts, 'travelCostPerMile', { nonNegative: true }),
      materialCostByService: canonicalCosts.materialCostByService && typeof canonicalCosts.materialCostByService === 'object'
        ? stableValue(canonicalCosts.materialCostByService) : {},
      equipmentCostByReference: canonicalCosts.equipmentCostByReference && typeof canonicalCosts.equipmentCostByReference === 'object'
        ? stableValue(canonicalCosts.equipmentCostByReference) : {},
    },
    services: services.map(function (service) {
      const identifier = service && (service.id || service.key || service.serviceId);
      const servicePricing = service && service.canonicalPricing && typeof service.canonicalPricing === 'object'
        ? stableValue(service.canonicalPricing) : null;
      return {
        id: identifier ? String(identifier).trim().toLowerCase() : null,
        name: service && service.name ? String(service.name) : null,
        crewSize: service ? integerOrNull(service.crewSize, { positive: true }) : null,
        averageHours: service ? finiteOrNull(service.avgHours, { positive: true }) : null,
        equipmentReference: service && service.equipment ? String(service.equipment) : null,
        canonicalPricing: servicePricing,
      };
    }).filter(function (service) { return service.id || service.name; }),
  };

  return Object.freeze({
    ...normalized,
    hash: sha256(normalized),
  });
}

module.exports = {
  adaptBusinessProfile,
  FINANCIAL_CONFIGURATION_FIELDS,
  finiteOrNull,
  migrateLegacyCanonicalAuthority,
  migrateLegacyFinancialConfiguration,
  OPERATIONAL_CONFIGURATION_FIELDS,
  prepareBusinessProfileForWrite,
  projectFinancialConfiguration,
  projectOperationalConfiguration,
  sha256,
  stableStringify,
  stableValue,
  synchronizeLegacyFinancial,
  validateCanonicalBusinessProfile,
  validateFinancialConfiguration,
  validateOperationalConfiguration,
  validateOperationalBusinessProfile,
  validateRawBusinessProfile,
};
