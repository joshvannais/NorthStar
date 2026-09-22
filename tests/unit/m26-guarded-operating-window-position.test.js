'use strict';

jest.mock('../../src/forecasting/declaredAvailabilitySnapshot', () => ({
  readDeclaredAvailabilitySnapshot: jest.fn(),
}));

const { sha256 } = require('../../src/services/businessProfileAdapter');
const { readDeclaredAvailabilitySnapshot } = require('../../src/forecasting/declaredAvailabilitySnapshot');
const { readGuardedOperatingWindowPosition } = require('../../src/forecasting/guardedOperatingWindowPosition');

const organizationId = '11111111-1111-4111-8111-111111111111';
const horizon = { startsAt: '2026-10-05T00:00:00.000Z', endsAt: '2026-10-06T00:00:00.000Z' };
const input = { organizationId, expectedTimeZone: 'UTC', horizon };
const closed = () => ({ open: '', close: '' });
const hours = { sunday: closed(), monday: { open: '08:00', close: '17:00', lunch: '12:00-13:00' },
  tuesday: closed(), wednesday: closed(), thursday: closed(), friday: closed(),
  saturday: closed() };

function snapshot(overrides = {}) {
  const basis = { organizationId, horizon, businessProfile: { timeZone: 'UTC', hours },
    observedAt: '2026-10-01T00:00:00.000000Z', ...overrides };
  return { state: 'source_snapshot', sourceAuthenticated: true,
    sourceSnapshotDigest: sha256(basis), basis };
}

beforeEach(() => readDeclaredAvailabilitySnapshot.mockReset());

test('uses the guarded source for company minutes without issuing capacity', async () => {
  readDeclaredAvailabilitySnapshot.mockResolvedValue(snapshot());
  const pool = {};
  const position = await readGuardedOperatingWindowPosition(pool, input);
  expect(readDeclaredAvailabilitySnapshot).toHaveBeenCalledWith(pool, input);
  expect(position.state).toBe('descriptive_only');
  expect(position.companyOperatingMinutes).toBe(480);
  expect(position.sourceAuthenticated).toBe(true);
  expect(position.temporalCutoffVerified).toBe(false);
  expect(position.workerAvailabilityVerified).toBe(false);
  expect(position.resourceConstraintsChecked).toBe(false);
  expect(position.forecastIssued).toBe(false);
  expect(position.sourceSnapshotDigest).toBe(snapshot().sourceSnapshotDigest);
  expect(Object.isFrozen(position)).toBe(true);
});

test('unavailable workforce source cannot produce a known zero company position', async () => {
  readDeclaredAvailabilitySnapshot.mockResolvedValue({ state: 'unavailable',
    reason: 'declared_availability_incomplete', forecastIssued: false });
  const position = await readGuardedOperatingWindowPosition({}, input);
  expect(position).toMatchObject({ state: 'unavailable',
    reason: 'declared_availability_incomplete', companyOperatingMinutes: null,
    organizationId, sourceAuthenticated: false, forecastIssued: false });
});

test('a complete closed calendar is a known zero company position only', async () => {
  readDeclaredAvailabilitySnapshot.mockResolvedValue(snapshot({
    businessProfile: { timeZone: 'UTC', hours: { ...hours, monday: closed() } },
  }));
  const position = await readGuardedOperatingWindowPosition({}, input);
  expect(position).toMatchObject({ state: 'descriptive_only',
    companyOperatingMinutes: 0, sourceAuthenticated: true,
    workerAvailabilityVerified: false, forecastIssued: false });
});

test('a mismatched or modified source snapshot cannot authenticate hours', async () => {
  const altered = snapshot({ organizationId: '22222222-2222-4222-8222-222222222222' });
  readDeclaredAvailabilitySnapshot.mockResolvedValue(altered);
  expect(await readGuardedOperatingWindowPosition({}, input)).toMatchObject({
    state: 'unavailable', reason: 'source_snapshot_unresolved',
    companyOperatingMinutes: null, sourceAuthenticated: false });
  readDeclaredAvailabilitySnapshot.mockResolvedValue({ ...snapshot(),
    sourceSnapshotDigest: 'a'.repeat(64) });
  expect((await readGuardedOperatingWindowPosition({}, input)).state).toBe('unavailable');
});

test('an authenticated but ambiguous calendar remains unavailable', async () => {
  readDeclaredAvailabilitySnapshot.mockResolvedValue(snapshot({
    businessProfile: { timeZone: 'UTC', hours: { sunday: closed() } },
  }));
  const position = await readGuardedOperatingWindowPosition({}, input);
  expect(position).toMatchObject({ state: 'unavailable',
    reason: 'operating_hours_unresolved', companyOperatingMinutes: null,
    sourceAuthenticated: true, forecastIssued: false });
});

test('owning reader errors propagate without creating a position', async () => {
  readDeclaredAvailabilitySnapshot.mockRejectedValue(new Error('access denied'));
  await expect(readGuardedOperatingWindowPosition({}, input)).rejects.toThrow('access denied');
});
