'use strict';

const { normalizeScheduleMutation } = require('../../src/scheduling/contract');

const BASE = Object.freeze({
  organizationId: '10000000-0000-4000-8000-000000000001',
  actorUserId: '20000000-0000-4000-8000-000000000001',
  actorAccessRole: 'owner',
  authSessionId: '30000000-0000-4000-8000-000000000001',
  appointmentId: '40000000-0000-4000-8000-000000000001',
  explicitSession: null,
  idempotencyKey: 'm22-unit-calendar-edit-0001',
  body: Object.freeze({
    scheduledStart: '2027-11-07T01:30:00-04:00',
    scheduledEnd: '2027-11-07T01:30:00-05:00',
    status: 'scheduled',
    expectedRevision: 7,
    expectedDigest: 'a'.repeat(64),
    expectedTimeZone: 'America/New_York',
    action: 'calendar_edit',
  }),
});

describe('Mission 22 Part 1 schedule mutation contract', () => {
  test('normalizes exact offset timestamps and pins every authority input', () => {
    expect(normalizeScheduleMutation(BASE)).toMatchObject({
      organizationId: BASE.organizationId,
      actorUserId: BASE.actorUserId,
      authSessionId: BASE.authSessionId,
      expectedRevision: 7,
      expectedDigest: 'a'.repeat(64),
      expectedTimeZone: 'America/New_York',
      scheduledStart: '2027-11-07T05:30:00.000Z',
      scheduledEnd: '2027-11-07T06:30:00.000Z',
      rawScheduledStart: '2027-11-07T01:30:00-04:00',
      rawScheduledEnd: '2027-11-07T01:30:00-05:00',
      action: 'calendar_edit',
      reason: 'Human-approved calendar edit.',
    });
    expect(normalizeScheduleMutation(BASE).requestDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(normalizeScheduleMutation(BASE).idempotencyKeyHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test.each([
    ['revision', { body: Object.fromEntries(Object.entries(BASE.body).filter(([key]) => key !== 'expectedRevision')) }],
    ['digest', { body: Object.fromEntries(Object.entries(BASE.body).filter(([key]) => key !== 'expectedDigest')) }],
    ['time zone', { body: Object.fromEntries(Object.entries(BASE.body).filter(([key]) => key !== 'expectedTimeZone')) }],
    ['action', { body: Object.fromEntries(Object.entries(BASE.body).filter(([key]) => key !== 'action')) }],
    ['idempotency', { idempotencyKey: '' }],
    ['session', { authSessionId: null }],
  ])('missing %s fails with 428 approval required', (_label, override) => {
    expect(() => normalizeScheduleMutation({ ...BASE, ...override })).toThrow(expect.objectContaining({
      status: 428,
      code: 'M22_APPROVAL_REQUIRED',
    }));
  });

  test.each([
    [{ ...BASE.body, scheduledStart: '2027-03-14T02:30:00', scheduledEnd: '2027-03-14T03:30:00' }, 'INVALID_APPOINTMENT_SCHEDULE'],
    [{ ...BASE.body, scheduledStart: '2027-03-14T08:00:00Z', scheduledEnd: '2027-03-14T08:00:00Z' }, 'INVALID_APPOINTMENT_SCHEDULE'],
    [{ ...BASE.body, status: 'executing' }, 'INVALID_APPOINTMENT_STATUS'],
    [{ ...BASE.body, action: 'dispatch' }, 'INVALID_APPROVAL_ACTION'],
    [{ ...BASE.body, reason: ' '.repeat(4) }, 'INVALID_APPROVAL_REASON'],
  ])('rejects malformed, non-positive, future-mission or empty input', (body, code) => {
    expect(() => normalizeScheduleMutation({ ...BASE, body })).toThrow(expect.objectContaining({ code }));
  });

  test('request digest distinguishes omitted fields from explicit unassignment', () => {
    const omitted = normalizeScheduleMutation({
      ...BASE,
      idempotencyKey: 'm22-unit-calendar-edit-omitted',
      body: {
        expectedRevision: 7,
        expectedDigest: 'a'.repeat(64),
        expectedTimeZone: 'America/New_York',
        action: 'calendar_edit',
      },
    });
    const explicit = normalizeScheduleMutation({
      ...BASE,
      idempotencyKey: 'm22-unit-calendar-edit-explicit',
      body: {
        scheduledStart: null,
        scheduledEnd: null,
        expectedRevision: 7,
        expectedDigest: 'a'.repeat(64),
        expectedTimeZone: 'America/New_York',
        action: 'calendar_edit',
      },
    });
    expect(omitted.requestDigest).not.toBe(explicit.requestDigest);
  });

  test('request digest pins current authorization and record-scope sessions', () => {
    const normalized = normalizeScheduleMutation(BASE);
    expect(normalizeScheduleMutation({
      ...BASE,
      authSessionId: '30000000-0000-4000-8000-000000000002',
    }).requestDigest).not.toBe(normalized.requestDigest);
    expect(normalizeScheduleMutation({
      ...BASE,
      explicitSession: 'different-demo-session',
    }).requestDigest).not.toBe(normalized.requestDigest);
    expect(normalizeScheduleMutation({
      ...BASE,
      actorAccessRole: 'admin',
    }).requestDigest).not.toBe(normalized.requestDigest);
  });

  test('request digest preserves raw fold selection and tenant time-zone pin', () => {
    const first = normalizeScheduleMutation({
      ...BASE,
      body: {
        ...BASE.body,
        scheduledStart: '2027-11-07T01:30:00-04:00',
        scheduledEnd: '2027-11-07T02:30:00-05:00',
      },
    });
    const second = normalizeScheduleMutation({
      ...BASE,
      body: {
        ...BASE.body,
        scheduledStart: '2027-11-07T01:30:00-05:00',
        scheduledEnd: '2027-11-07T02:30:00-05:00',
      },
    });
    expect(first.requestDigest).not.toBe(second.requestDigest);
    expect(normalizeScheduleMutation({
      ...BASE,
      body: { ...BASE.body, expectedTimeZone: 'America/Chicago' },
    }).requestDigest).not.toBe(normalizeScheduleMutation(BASE).requestDigest);
  });

  test.each([
    ['characters', 'x'.repeat(1001)],
    ['Unicode units', '\u{1f642}'.repeat(501)],
  ])('rejects approval reasons beyond the bounded %s limit', (_label, reason) => {
    expect(() => normalizeScheduleMutation({
      ...BASE,
      body: { ...BASE.body, reason },
    })).toThrow(expect.objectContaining({ code: 'INVALID_APPROVAL_REASON' }));
  });
});
