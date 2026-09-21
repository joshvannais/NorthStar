'use strict';

// Internal Mission 26 Part 2B projection. The caller must first authorize and
// pin the canonical Business Profile; this module grants no source access.
const schedulingTime = require('../../public/js/scheduling-time-contract');
const { hoursForDate } = require('../scheduling/conflictEvaluator');
const { sha256 } = require('../services/businessProfileAdapter');

const VERSION = 'm26-time-series-window-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TOKEN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const GRAINS = new Set(['day', 'week', 'month', 'quarter', 'year']);

function invalid() {
  const error = new Error('Forecast reporting window details are invalid.');
  error.code = 'M26_REPORTING_WINDOW_INVALID';
  throw error;
}

function unavailable(reason) {
  const error = new Error('Forecast reporting window is unavailable.');
  error.code = 'M26_REPORTING_WINDOW_UNAVAILABLE';
  error.reason = reason;
  throw error;
}

function localDate(value) {
  if (typeof value !== 'string' || !DATE.test(value)) invalid();
  const [year, month, day] = value.split('-').map(Number);
  if (year < 2000 || year > 2100) invalid();
  const parsed = new Date(0);
  parsed.setUTCFullYear(year, month - 1, day);
  parsed.setUTCHours(0, 0, 0, 0);
  if (parsed.toISOString().slice(0, 10) !== value) invalid();
  return parsed;
}

function dateOffset(value, days) {
  const date = localDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function periodEnd(start, grain) {
  const date = localDate(start);
  const month = date.getUTCMonth();
  if (grain === 'day') return dateOffset(start, 1);
  if (grain === 'week') {
    if (date.getUTCDay() !== 1) invalid();
    return dateOffset(start, 7);
  }
  if (date.getUTCDate() !== 1) invalid();
  if (grain === 'month') date.setUTCMonth(month + 1);
  else if (grain === 'quarter') {
    if (month % 3 !== 0) invalid();
    date.setUTCMonth(month + 3);
  } else if (grain === 'year') {
    if (month !== 0) invalid();
    date.setUTCFullYear(date.getUTCFullYear() + 1);
  } else invalid();
  return date.toISOString().slice(0, 10);
}

function midnight(date, timeZone) {
  let resolved;
  try { resolved = schedulingTime.resolveWallTime(date, '00:00:00', timeZone); }
  catch (_error) { unavailable('invalid_time_zone'); }
  if (resolved.status !== 'unique') unavailable('non_unique_period_boundary');
  return resolved.candidates[0].epochMilliseconds;
}

function calendarMinutes(rawProfile, start, end, timeZone) {
  if (!rawProfile.hours || typeof rawProfile.hours !== 'object' ||
      Array.isArray(rawProfile.hours)) return { state: 'unknown', minutes: null };
  let date = start;
  let total = 0;
  for (let count = 0; date < end && count < 367; count += 1) {
    const daily = hoursForDate(rawProfile, date, timeZone);
    if (!['known', 'closed'].includes(daily.status)) return { state: 'unknown', minutes: null };
    for (const window of daily.windows) total += (window.end - window.start) / 60000;
    date = dateOffset(date, 1);
  }
  if (date !== end || !Number.isSafeInteger(total)) unavailable('calendar_outside_bound');
  return { state: 'known', minutes: total };
}

function tokenOrNull(value) {
  return value === null || (typeof value === 'string' && value.length <= 80 && TOKEN.test(value));
}

function deriveReportingWindow(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      typeof input.organizationId !== 'string' || !UUID.test(input.organizationId) ||
      typeof input.businessProfileId !== 'string' || !UUID.test(input.businessProfileId) ||
      !Number.isSafeInteger(input.businessProfileVersion) || input.businessProfileVersion < 1 ||
      typeof input.businessProfileHash !== 'string' || !DIGEST.test(input.businessProfileHash) ||
      !GRAINS.has(input.grain) || !tokenOrNull(input.serviceKey) ||
      !['tenant_all', 'profile_area'].includes(input.areaScope) ||
      !input.rawProfile || typeof input.rawProfile !== 'object' || Array.isArray(input.rawProfile)) invalid();
  const timeZone = input.rawProfile.company?.timeZone;
  if (!schedulingTime.isValidTimeZone(timeZone)) unavailable('business_time_zone_unknown');
  const startDate = input.localStartDate;
  const endDate = periodEnd(startDate, input.grain);
  const start = midnight(startDate, timeZone);
  const end = midnight(endDate, timeZone);
  if (end <= start) unavailable('invalid_period_bounds');
  const calendar = calendarMinutes(input.rawProfile, startDate, endDate, timeZone);
  const area = input.rawProfile.serviceArea;
  const headquarters = input.rawProfile.headquarters;
  const originKnown = headquarters && Number.isFinite(headquarters.latitude) &&
    headquarters.latitude >= -90 && headquarters.latitude <= 90 &&
    Number.isFinite(headquarters.longitude) &&
    headquarters.longitude >= -180 && headquarters.longitude <= 180;
  const areaConfigured = area && typeof area === 'object' && !Array.isArray(area) &&
    ((typeof area.primaryTerritory === 'string' && area.primaryTerritory.trim() !== '') ||
      (originKnown && ((typeof area.maxRadiusMiles === 'number' && area.maxRadiusMiles > 0) ||
        (typeof area.maxTravelMinutes === 'number' && area.maxTravelMinutes > 0))) ||
      (Array.isArray(area.polygon) && area.polygon.length >= 3));
  if (input.areaScope === 'profile_area' && !areaConfigured) unavailable('service_area_unknown');
  const areaDigest = input.areaScope === 'profile_area' ? sha256({
    serviceArea: area,
    origin: originKnown ? { latitude: headquarters.latitude, longitude: headquarters.longitude } : null,
  }) : null;
  const calendarDigest = calendar.state === 'known' ? sha256(input.rawProfile.hours) : null;
  return Object.freeze({
    version: VERSION,
    organizationId: input.organizationId.toLowerCase(),
    businessProfileId: input.businessProfileId.toLowerCase(),
    businessProfileVersion: input.businessProfileVersion,
    businessProfileHash: input.businessProfileHash,
    timeZone, grain: input.grain, serviceKey: input.serviceKey,
    areaScope: input.areaScope, areaDigest,
    calendarState: calendar.state, calendarDigest,
    localStartDate: startDate, localEndDate: endDate,
    startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString(),
    elapsedMinutes: (end - start) / 60000,
    openMinutes: calendar.minutes,
    // Opening-date attribution keeps overnight shifts in their business day.
    openMinutesBasis: 'opening_local_date',
  });
}

function compareReportingWindows(left, right) {
  if (!left || !right || left.version !== VERSION || right.version !== VERSION) invalid();
  const reasons = [];
  if (left.organizationId !== right.organizationId) reasons.push('different_tenant');
  if (left.grain !== right.grain) reasons.push('different_grain');
  if (left.timeZone !== right.timeZone) reasons.push('different_time_zone');
  if (left.serviceKey !== right.serviceKey) reasons.push('different_service');
  if (left.areaScope !== right.areaScope) reasons.push('different_area_scope');
  else if (left.areaDigest !== right.areaDigest) reasons.push('area_changed');
  if (left.calendarState !== 'known' || right.calendarState !== 'known') reasons.push('calendar_unknown');
  return Object.freeze({
    comparableContext: reasons.length === 0,
    reasons: Object.freeze(reasons),
    normalizationRequired: reasons.length === 0 &&
      (left.openMinutes !== right.openMinutes || left.calendarDigest !== right.calendarDigest),
  });
}

module.exports = { VERSION, deriveReportingWindow, compareReportingWindows };
