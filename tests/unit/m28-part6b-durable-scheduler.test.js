'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { types } = require('node:util');
const canonical = require('../../src/automation/canonicalJson');
const CONTRACT = require('../../docs/architecture/MISSION_28_PART6B_DURABLE_SCHEDULER_CONTRACT.json');

const ROOT = path.resolve(__dirname, '../..');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const TIME = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/;
const UTC = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$/;
const ZONE = /^(?:UTC|[A-Za-z]+(?:[_-][A-Za-z]+)*(?:\/[A-Za-z]+(?:[_-][A-Za-z]+)*)+)$/;
const copy = value => JSON.parse(JSON.stringify(value));
const hash = value => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const digest = (namespace, value, excluded) => canonical.digest(`${namespace}\n`,
  excluded ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== excluded)) : value);

function normalizedLfSha256(relative) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, relative), 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n')).digest('hex').toUpperCase();
}

function exact(value, keys, label) {
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) throw new Error(`${label} keys`);
}

function plain(value, seen = new Set()) {
  if (value === null || ['string', 'boolean', 'number'].includes(typeof value)) {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('number');
    return;
  }
  if (typeof value !== 'object' || types.isProxy(value) || seen.has(value)) throw new Error('plain');
  seen.add(value);
  const proto = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    if (proto !== Array.prototype || Reflect.ownKeys(value).some(key => key !== 'length' && (!/^\d+$/.test(key) || Number(key) >= value.length))) throw new Error('array');
    for (let index = 0; index < value.length; index += 1) if (!Object.hasOwn(value, index)) throw new Error('sparse');
  } else if (proto !== Object.prototype) throw new Error('prototype');
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || key === 'toJSON') throw new Error('key');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (Array.isArray(value) && key === 'length') {
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable || descriptor.value !== value.length) throw new Error('length');
      continue;
    }
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) throw new Error('descriptor');
    plain(descriptor.value, seen);
  }
}

function timezone(value) {
  if (typeof value !== 'string' || value.length > 64 || !ZONE.test(value) || /^(?:US|Etc|posix|right)\//.test(value) || ['GMT', 'GMT0', 'Greenwich', 'Universal', 'Zulu'].includes(value)) throw new Error('zone');
  let resolved;
  try { resolved = new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone; } catch { throw new Error('zone'); }
  if (resolved !== value) throw new Error('zone alias');
}

function localParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(date).filter(part => part.type !== 'literal').reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

function candidates(request) {
  const wanted = `${request.localSchedule.localDate}T${request.localSchedule.localTime}`;
  const center = new Date(request.localSchedule.utcInstant).getTime();
  const matches = [];
  for (let delta = -1440; delta <= 1440; delta += 1) {
    const value = new Date(center + delta * 60000);
    if (localParts(value, request.localSchedule.tenantTimeZone) === wanted) matches.push(value.toISOString().replace('.000Z', '.000000Z'));
  }
  return matches;
}

function validateWindows(windows, maximum, allowEmpty, label) {
  if (!Array.isArray(windows) || windows.length > maximum || (!allowEmpty && windows.length === 0)) throw new Error(`${label} bounds`);
  let previous = null;
  for (const item of windows) {
    exact(item, CONTRACT.scheduleEnvelope.windowExactFields, label);
    if (![item.dayId, item.startMinuteInclusive, item.endMinuteExclusive].every(Number.isSafeInteger) || item.dayId < 1 || item.dayId > 7 || item.startMinuteInclusive < 0 || item.startMinuteInclusive >= item.endMinuteExclusive || item.endMinuteExclusive > 1440) throw new Error(`${label} value`);
    if (previous && (item.dayId < previous.dayId || (item.dayId === previous.dayId && item.startMinuteInclusive < previous.endMinuteExclusive))) throw new Error(`${label} order`);
    previous = item;
  }
}

function reseal(value) {
  const c = value.calendarBinding;
  c.calendarDigest = digest('mission28.business-calendar.v1', { tenantId: value.tenantId, calendarId: c.calendarId, calendarVersion: c.calendarVersion, calendarState: c.calendarState, tenantTimeZone: c.tenantTimeZone, allowedWeeklyWindows: c.allowedWeeklyWindows, quietWeeklyWindows: c.quietWeeklyWindows, holidayDates: c.holidayDates });
  value.scheduleBindingDigest = digest('mission28.action-schedule-binding.v1', { tenantId: value.tenantId, transactionId: value.transactionId, runId: value.runId, unitBinding: value.unitBinding, policyBinding: value.policyBinding, sourceBinding: value.sourceBinding, localSchedule: value.localSchedule, calendarBinding: value.calendarBinding, expirationBinding: value.expirationBinding, trustedClockBinding: value.trustedClockBinding });
  value.requestDigest = digest('mission28.action-schedule.request.v1', value, 'requestDigest');
  return value;
}

function fixture(suffix = 0) {
  return reseal({
    schemaVersion: CONTRACT.scheduleEnvelope.schemaVersion, tenantId: uuid(28), scheduleId: uuid(900 + suffix), transactionId: uuid(600 + suffix), runId: uuid(500 + suffix),
    unitBinding: { unitId: uuid(700 + suffix), outboxId: uuid(800 + suffix), unitDigest: hash(`unit-${suffix}`) },
    policyBinding: { policyId: uuid(100), policyVersion: 1, policyDigest: hash('policy') },
    sourceBinding: { sourceSetDigest: hash('source-set') },
    localSchedule: { tenantTimeZone: 'America/New_York', localDate: '2026-10-29', localTime: '10:00:00', utcInstant: '2026-10-29T14:00:00.000000Z', foldResolution: 'not_ambiguous' },
    calendarBinding: { calendarId: uuid(950), calendarVersion: 1, calendarDigest: '', calendarState: 'exact_current', tenantTimeZone: 'America/New_York', allowedWeeklyWindows: [{ dayId: 4, startMinuteInclusive: 540, endMinuteExclusive: 1020 }], quietWeeklyWindows: [{ dayId: 4, startMinuteInclusive: 720, endMinuteExclusive: 780 }], holidayDates: [] },
    expirationBinding: { expiresAt: '2026-10-30T14:00:00.000000Z' },
    trustedClockBinding: { contract: CONTRACT.scheduleEnvelope.trustedClockContract }, scheduleBindingDigest: '', requestDigest: '',
  });
}

function trusted(value) {
  return { tenantId: value.tenantId, transactionId: value.transactionId, runId: value.runId, unitBinding: value.unitBinding, policyBinding: value.policyBinding, sourceBinding: value.sourceBinding, localSchedule: value.localSchedule, calendarBinding: value.calendarBinding, expirationBinding: value.expirationBinding, trustedClockBinding: value.trustedClockBinding, scheduleBindingDigest: value.scheduleBindingDigest };
}

function validate(value, resolution, now = '2026-10-28T12:00:00.000Z') {
  plain(value); plain(resolution);
  exact(value, CONTRACT.scheduleEnvelope.exactFields, 'root');
  for (const [field, keys] of [['unitBinding', CONTRACT.scheduleEnvelope.unitBindingExactFields], ['policyBinding', CONTRACT.scheduleEnvelope.policyBindingExactFields], ['sourceBinding', CONTRACT.scheduleEnvelope.sourceBindingExactFields], ['localSchedule', CONTRACT.scheduleEnvelope.localScheduleExactFields], ['calendarBinding', CONTRACT.scheduleEnvelope.calendarBindingExactFields], ['expirationBinding', CONTRACT.scheduleEnvelope.expirationBindingExactFields], ['trustedClockBinding', CONTRACT.scheduleEnvelope.trustedClockBindingExactFields]]) exact(value[field], keys, field);
  for (const item of [value.tenantId, value.scheduleId, value.transactionId, value.runId, value.unitBinding.unitId, value.unitBinding.outboxId, value.policyBinding.policyId, value.calendarBinding.calendarId]) if (!UUID.test(item)) throw new Error('uuid');
  for (const item of [value.unitBinding.unitDigest, value.policyBinding.policyDigest, value.sourceBinding.sourceSetDigest, value.calendarBinding.calendarDigest, value.scheduleBindingDigest, value.requestDigest]) if (!DIGEST.test(item)) throw new Error('digest');
  if (!Number.isSafeInteger(value.policyBinding.policyVersion) || value.policyBinding.policyVersion < 1 || !Number.isSafeInteger(value.calendarBinding.calendarVersion) || value.calendarBinding.calendarVersion < 1) throw new Error('version');
  timezone(value.localSchedule.tenantTimeZone);
  if (value.calendarBinding.tenantTimeZone !== value.localSchedule.tenantTimeZone || value.calendarBinding.calendarState !== CONTRACT.scheduleEnvelope.calendarState) throw new Error('calendar binding');
  if (!DATE.test(value.localSchedule.localDate) || !TIME.test(value.localSchedule.localTime) || !UTC.test(value.localSchedule.utcInstant) || !UTC.test(value.expirationBinding.expiresAt) || !['not_ambiguous', 'earlier', 'later'].includes(value.localSchedule.foldResolution)) throw new Error('time');
  if (value.trustedClockBinding.contract !== CONTRACT.scheduleEnvelope.trustedClockContract) throw new Error('clock');
  validateWindows(value.calendarBinding.allowedWeeklyWindows, CONTRACT.bounds.maximumAllowedWeeklyWindows, false, 'allowed');
  validateWindows(value.calendarBinding.quietWeeklyWindows, CONTRACT.bounds.maximumQuietWeeklyWindows, true, 'quiet');
  if (!Array.isArray(value.calendarBinding.holidayDates) || value.calendarBinding.holidayDates.length > CONTRACT.bounds.maximumHolidayDates || value.calendarBinding.holidayDates.some((item, index, all) => !DATE.test(item) || (index && item <= all[index - 1]))) throw new Error('holidays');
  const matches = candidates(value);
  if (matches.length < 1 || matches.length > 2 || (matches.length === 1 && (value.localSchedule.foldResolution !== 'not_ambiguous' || matches[0] !== value.localSchedule.utcInstant)) || (matches.length === 2 && ((value.localSchedule.foldResolution === 'earlier' ? matches[0] : value.localSchedule.foldResolution === 'later' ? matches[1] : null) !== value.localSchedule.utcInstant))) throw new Error('dst');
  const local = new Date(`${value.localSchedule.localDate}T${value.localSchedule.localTime}Z`); const dayId = local.getUTCDay() || 7; const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  if (!value.calendarBinding.allowedWeeklyWindows.some(item => item.dayId === dayId && minute >= item.startMinuteInclusive && minute < item.endMinuteExclusive) || value.calendarBinding.quietWeeklyWindows.some(item => item.dayId === dayId && minute >= item.startMinuteInclusive && minute < item.endMinuteExclusive) || value.calendarBinding.holidayDates.includes(value.localSchedule.localDate)) throw new Error('calendar');
  const scheduled = Date.parse(value.localSchedule.utcInstant); const expiry = Date.parse(value.expirationBinding.expiresAt); const clock = Date.parse(now);
  if (!(scheduled > clock && scheduled <= clock + 366 * 86400000 && expiry > scheduled && expiry <= clock + 367 * 86400000)) throw new Error('expiration');
  const expected = fixtureProjection(value);
  if (canonical.canonicalize(resolution) !== canonical.canonicalize(expected)) throw new Error('trusted');
  const c = copy(value); reseal(c);
  if (c.calendarBinding.calendarDigest !== value.calendarBinding.calendarDigest || c.scheduleBindingDigest !== value.scheduleBindingDigest || c.requestDigest !== value.requestDigest) throw new Error('seal');
}

function fixtureProjection(value) { return trusted(value); }

class ScheduleStore {
  constructor() { this.rows = new Map(); this.units = new Set(); }
  store(value, resolution, now) {
    plain(value);
    const prior = this.rows.get(value.scheduleId);
    if (prior) {
      if (prior.requestDigest !== value.requestDigest || canonical.canonicalize(prior) !== canonical.canonicalize(value)) throw new Error('schedule conflict');
      return { replayed: true, row: copy(prior) };
    }
    validate(value, resolution, now);
    if (this.units.has(value.unitBinding.unitId)) throw new Error('unit scheduled');
    this.rows.set(value.scheduleId, copy(value)); this.units.add(value.unitBinding.unitId);
    return { replayed: false, row: copy(value) };
  }
}

describe('Mission 28 Part 6B durable scheduler', () => {
  test('binds the exact released Part 6A authority and frozen inputs', () => {
    expect(CONTRACT.authority).toEqual(expect.objectContaining({ part: '6B', state: 'implementation_candidate_only', baselineCommit: '41b509e493cf6489aeed32c3c729b1493264df5c' }));
    expect(CONTRACT.part6ARelease).toEqual(expect.objectContaining({ acceptedSourceHead: 'af2b777a3d146f24e95052add626784186d4b0df', pullRequest: 569, deployment: '62521b53-9b1b-44c8-af98-97b91f256138', deploymentState: 'SUCCESS_RUNNING' }));
    for (const item of CONTRACT.frozenInputs) expect(normalizedLfSha256(item.path)).toBe(item.normalizedLfSha256);
    expect(CONTRACT.storageContract.runtimeExecuteGranted).toBe(false);
    expect(CONTRACT.timeZoneAndDstContract.candidateSearch).toContain('2881');
  });

  test('accepts one exact ordinary schedule and exact replay without a second row', () => {
    const value = fixture(); const store = new ScheduleStore();
    expect(store.store(value, trusted(value)).replayed).toBe(false);
    expect(store.store(copy(value), trusted(value), '2027-01-01T00:00:00.000Z').replayed).toBe(true);
    expect(store.rows.size).toBe(1);
  });

  test('resolves DST folds explicitly and rejects gaps, ambiguity and UTC substitution', () => {
    for (const [foldResolution, utcInstant] of [['earlier', '2026-11-01T05:30:00.000000Z'], ['later', '2026-11-01T06:30:00.000000Z']]) {
      const value = fixture(foldResolution === 'earlier' ? 1 : 2); value.localSchedule.localDate = '2026-11-01'; value.localSchedule.localTime = '01:30:00'; value.localSchedule.utcInstant = utcInstant; value.localSchedule.foldResolution = foldResolution; value.calendarBinding.allowedWeeklyWindows = [{ dayId: 7, startMinuteInclusive: 0, endMinuteExclusive: 1440 }]; value.calendarBinding.quietWeeklyWindows = []; value.expirationBinding.expiresAt = '2026-11-02T12:00:00.000000Z'; reseal(value);
      expect(() => validate(value, trusted(value))).not.toThrow();
    }
    const attacks = [];
    const ambiguous = fixture(3); ambiguous.localSchedule.localDate = '2026-11-01'; ambiguous.localSchedule.localTime = '01:30:00'; ambiguous.localSchedule.utcInstant = '2026-11-01T05:30:00.000000Z'; ambiguous.localSchedule.foldResolution = 'not_ambiguous'; ambiguous.calendarBinding.allowedWeeklyWindows = [{ dayId: 7, startMinuteInclusive: 0, endMinuteExclusive: 1440 }]; ambiguous.calendarBinding.quietWeeklyWindows = []; ambiguous.expirationBinding.expiresAt = '2026-11-02T12:00:00.000000Z'; attacks.push(reseal(ambiguous));
    const gap = fixture(4); gap.localSchedule.localDate = '2027-03-14'; gap.localSchedule.localTime = '02:30:00'; gap.localSchedule.utcInstant = '2027-03-14T07:30:00.000000Z'; gap.calendarBinding.allowedWeeklyWindows = [{ dayId: 7, startMinuteInclusive: 0, endMinuteExclusive: 1440 }]; gap.calendarBinding.quietWeeklyWindows = []; gap.expirationBinding.expiresAt = '2027-03-15T12:00:00.000000Z'; attacks.push(reseal(gap));
    const wrongUtc = fixture(5); wrongUtc.localSchedule.utcInstant = '2026-10-29T15:00:00.000000Z'; attacks.push(reseal(wrongUtc));
    for (const attack of attacks) expect(() => validate(attack, trusted(attack))).toThrow('dst');
  });

  test('rejects closed time, quiet time, holidays, window ambiguity and calendar retargeting', () => {
    const attacks = [];
    const closed = fixture(10); closed.localSchedule.localTime = '08:00:00'; closed.localSchedule.utcInstant = '2026-10-29T12:00:00.000000Z'; attacks.push(reseal(closed));
    const quiet = fixture(11); quiet.localSchedule.localTime = '12:30:00'; quiet.localSchedule.utcInstant = '2026-10-29T16:30:00.000000Z'; attacks.push(reseal(quiet));
    const holiday = fixture(12); holiday.calendarBinding.holidayDates = ['2026-10-29']; attacks.push(reseal(holiday));
    const overlap = fixture(13); overlap.calendarBinding.allowedWeeklyWindows = [{ dayId: 4, startMinuteInclusive: 500, endMinuteExclusive: 700 }, { dayId: 4, startMinuteInclusive: 600, endMinuteExclusive: 800 }]; attacks.push(reseal(overlap));
    const retarget = fixture(14); retarget.calendarBinding.tenantTimeZone = 'America/Chicago'; attacks.push(reseal(retarget));
    for (const attack of attacks) expect(() => validate(attack, trusted(attack))).toThrow();
  });

  test('rejects unknown, alias, fixed-offset, conflicting or candidate-only time-zone material', () => {
    for (const zone of ['US/Eastern', 'Canada/Eastern', 'America/Shiprock', 'Etc/GMT+5', 'EST', 'america/New_York', 'Not/AZone']) {
      const value = fixture(20); value.localSchedule.tenantTimeZone = zone; value.calendarBinding.tenantTimeZone = zone; reseal(value);
      expect(() => validate(value, trusted(value))).toThrow('zone');
    }
    const value = fixture(21); const resolution = copy(trusted(value)); resolution.localSchedule.tenantTimeZone = 'America/Chicago';
    expect(() => validate(value, resolution)).toThrow('trusted');
  });

  test('rejects past, horizon and expiration contradictions while retaining historical replay', () => {
    for (const mutate of [
      value => { value.localSchedule.utcInstant = '2026-10-27T14:00:00.000000Z'; value.expirationBinding.expiresAt = '2026-10-30T14:00:00.000000Z'; },
      value => { value.expirationBinding.expiresAt = value.localSchedule.utcInstant; },
      value => { value.localSchedule.localDate = '2028-10-29'; value.localSchedule.utcInstant = '2028-10-29T14:00:00.000000Z'; value.expirationBinding.expiresAt = '2028-10-30T14:00:00.000000Z'; },
    ]) { const value = fixture(30); mutate(value); reseal(value); expect(() => validate(value, trusted(value))).toThrow(); }
    const store = new ScheduleStore(); const valid = fixture(31); store.store(valid, trusted(valid));
    expect(store.store(copy(valid), trusted(valid), '2030-01-01T00:00:00.000Z').replayed).toBe(true);
  });

  test('rejects cross-request identity/digest reuse and separately trusted substitution with zero residue', () => {
    const store = new ScheduleStore(); const value = fixture(40); store.store(value, trusted(value));
    const conflict = copy(value); conflict.localSchedule.localTime = '11:00:00'; conflict.localSchedule.utcInstant = '2026-10-29T15:00:00.000000Z'; reseal(conflict);
    expect(() => store.store(conflict, trusted(conflict))).toThrow('schedule conflict');
    const second = fixture(41); second.unitBinding = copy(value.unitBinding); reseal(second);
    expect(() => store.store(second, trusted(second))).toThrow('unit scheduled');
    expect(store.rows.size).toBe(1);
  });

  test('rejects nonplain, accessor, symbol, toJSON, sparse, alias and extra-field material before projection', () => {
    const attacks = [];
    const extra = fixture(50); extra.unexpected = true; attacks.push(extra);
    const accessor = fixture(51); let getterCalls = 0; Object.defineProperty(accessor.calendarBinding, 'unexpected', { enumerable: true, get() { getterCalls += 1; return 'x'; } }); attacks.push(accessor);
    const symbol = fixture(52); symbol[Symbol('hidden')] = true; attacks.push(symbol);
    const json = fixture(53); Object.defineProperty(json, 'toJSON', { enumerable: false, value() { throw new Error('called'); } }); attacks.push(json);
    const sparse = fixture(54); sparse.calendarBinding.holidayDates = new Array(1); attacks.push(sparse);
    const aliased = fixture(55); aliased.calendarBinding.quietWeeklyWindows = aliased.calendarBinding.allowedWeeklyWindows; attacks.push(aliased);
    const custom = fixture(56); Object.setPrototypeOf(custom.calendarBinding, { polluted: true }); attacks.push(custom);
    for (const attack of attacks) expect(() => validate(attack, trusted(fixture(99)))).toThrow();
    expect(getterCalls).toBe(0);
  });

  test('migration is tenant-private, immutable, owner-only and contains no publication or effect path', () => {
    const sql = fs.readFileSync(path.join(ROOT, 'migrations/276_canonical_automation_durable_scheduler_v1.sql'), 'utf8');
    for (const token of ['canonical_automation_canonical_time_zones_v1', 'canonical_automation_action_schedules_v1', 'canonical_automation_store_action_schedule_v1', 'ENABLE ROW LEVEL SECURITY', 'FORCE ROW LEVEL SECURITY', 'scheduled_unpublished', "SET TimeZone='UTC'", "INTERVAL '24 hours'", 'statement_timestamp']) expect(sql).toContain(token);
    const sqlZones = [...sql.matchAll(/\('([^']+)','node22\.23\.3_intl_supported_values_v1'\)/g)].map(match => match[1]).sort();
    const nodeZones = ['UTC', ...Intl.supportedValuesOf('timeZone')].sort();
    expect(sqlZones).toHaveLength(CONTRACT.bounds.canonicalTimeZoneIdentifierCount);
    expect(sqlZones).toEqual(nodeZones);
    expect(sqlZones).not.toEqual(expect.arrayContaining(['Canada/Eastern', 'America/Shiprock', 'US/Eastern']));
    for (const forbidden of ['GRANT EXECUTE', 'CREATE FUNCTION public.canonical_automation_claim', 'queue_published_at=', 'provider_attempt', 'twilio', 'retell', 'fetch(', 'axios']) expect(sql).not.toContain(forbidden);
  });

  test('records Part 6A released, only Part 6B candidate, later slices planned and migration276/no277', () => {
    const roadmap = fs.readFileSync(path.join(ROOT, 'docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md'), 'utf8');
    const ledger = fs.readFileSync(path.join(ROOT, 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md'), 'utf8');
    for (const document of [roadmap, ledger]) {
      expect(document).toContain('Parts 1A–11F are released. Part 12A is the sole implementation candidate.');
      expect(document).toContain('Parts 12B–14G remain planned and unimplemented.');
      expect(document).toContain('af2b777a3d146f24e95052add626784186d4b0df');
      expect(document).toContain('62521b53-9b1b-44c8-af98-97b91f256138');
    }
    expect(ledger).toContain('| 21 | 6A | Transactional outbox and action units | **Released** |');
    expect(ledger).toContain('| 22 | 6B | Durable time-zone-aware scheduler | **Released** |');
    expect((ledger.match(/\*\*Implementation candidate\*\*/g) || [])).toHaveLength(1);
    expect((ledger.match(/Planned \/ unimplemented/g) || [])).toHaveLength(15);
    const migrations = fs.readdirSync(path.join(ROOT, 'migrations')).filter(name => /^\d+.*\.sql$/.test(name)).sort();
    expect(migrations.at(-1)).toBe('287_canonical_automation_estimate_quote_resolution_v1.sql');
    expect(migrations.some(name => name.startsWith('288_'))).toBe(false);
    expect(migrations.filter(name => name.startsWith('281_'))).toEqual(['281_canonical_automation_sender_recipient_authority_v1.sql']);
  });
});
