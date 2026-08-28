'use strict';

const schedulingTime = require('../../public/js/scheduling-time-contract');

const FIXTURE_OFFSETS = Object.freeze([0, 20, 30, 50, 60, 65, 80, 85, 90, 110]);
const FIXTURE_ZONES = Object.freeze([
  'Pacific/Honolulu', 'America/Anchorage', 'America/Los_Angeles', 'America/Denver',
  'America/Chicago', 'America/New_York', 'America/Halifax', 'Atlantic/Azores',
  'Europe/London', 'Europe/Berlin', 'Asia/Kolkata', 'Asia/Tokyo',
  'Australia/Sydney', 'Pacific/Auckland',
]);

function wall(minute) {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

function chooseFixturePlan(referenceInstant = new Date()) {
  const reference = new Date(referenceInstant);
  if (!Number.isFinite(reference.getTime())) throw new TypeError('A valid reference instant is required');
  const horizonReference = new Date(reference.getTime() + 15 * 60 * 1000);
  for (const timeZone of FIXTURE_ZONES) {
    const local = schedulingTime.formatInstant(horizonReference, timeZone);
    const parts = local.time.split(':').map(Number);
    const baseMinute = Math.ceil((parts[0] * 60 + parts[1]) / 5) * 5;
    if (baseMinute + FIXTURE_OFFSETS[FIXTURE_OFFSETS.length - 1] >= 24 * 60) continue;
    const resolved = [];
    let valid = true;
    for (const offset of FIXTURE_OFFSETS) {
      const result = schedulingTime.resolveWallTime(local.date, wall(baseMinute + offset), timeZone);
      if (!result || !Array.isArray(result.candidates) || result.candidates.length !== 1) { valid = false; break; }
      resolved.push(result.candidates[0].rfc3339);
    }
    if (!valid || new Set(resolved).size !== FIXTURE_OFFSETS.length) continue;
    return Object.freeze({
      referenceInstant: reference.toISOString(), timeZone, day: local.date, baseMinute,
      offsets: FIXTURE_OFFSETS, instants: Object.freeze(resolved),
    });
  }
  throw new Error('No production-authentic tenant timezone can hold the bounded Part 6 browser fixture');
}

function instantAt(plan, offset) {
  const index = plan && Array.isArray(plan.offsets) ? plan.offsets.indexOf(offset) : -1;
  if (index < 0 || !Array.isArray(plan.instants)) throw new RangeError('Fixture offset is not authorized');
  return plan.instants[index];
}

module.exports = { FIXTURE_OFFSETS, FIXTURE_ZONES, chooseFixturePlan, instantAt };
