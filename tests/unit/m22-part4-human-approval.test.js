'use strict';

const {
  ApprovalContractError,
  MAXIMUM_BODY_BYTES,
  normalizeMutationApproval,
  normalizeMutationPreview,
} = require('../../src/scheduling/approvalContract');
const { isApprovalRequest } = require('../../src/scheduling/approvalHttpBoundary');

const IDS = Object.freeze({
  organization: 'e1000000-0000-4000-8000-000000000001',
  actor: 'e2000000-0000-4000-8000-000000000001',
  session: 'e3000000-0000-4000-8000-000000000001',
  appointment: 'e4000000-0000-4000-8000-000000000001',
  preview: 'e5000000-0000-4000-8000-000000000001',
  target: 'e6000000-0000-4000-8000-000000000001',
});
const DIGEST = 'a'.repeat(64);

function preview(overrides = {}) {
  return normalizeMutationPreview({
    organizationId: IDS.organization,
    actorUserId: IDS.actor,
    authSessionId: IDS.session,
    appointmentId: IDS.appointment,
    body: {
      expectedRevision: 1,
      expectedDigest: DIGEST,
      expectedTimeZone: 'America/New_York',
      action: 'schedule',
      target: { kind: 'unassigned', id: null },
      scheduledStart: '2027-03-15T09:00:00-04:00',
      scheduledEnd: '2027-03-15T10:00:00-04:00',
      appointmentStatus: 'scheduled',
      reason: 'Owner reviewed the exact scheduling proposal.',
      ...overrides,
    },
  });
}

function approval(overrides = {}, key = 'part4-idempotency-key-0001') {
  return normalizeMutationApproval({
    organizationId: IDS.organization,
    actorUserId: IDS.actor,
    authSessionId: IDS.session,
    appointmentId: IDS.appointment,
    idempotencyKey: key,
    body: {
      previewId: IDS.preview,
      previewDigest: DIGEST,
      acknowledgedWarningDigests: [],
      acknowledgedReviewReasonDigests: [DIGEST],
      reason: 'Owner reviewed the exact scheduling proposal.',
      ...overrides,
    },
  });
}

function expectContractError(fn, code, status) {
  expect(fn).toThrow(ApprovalContractError);
  try { fn(); } catch (error) {
    expect(error.code).toBe(code);
    expect(error.status).toBe(status);
  }
}

describe('Mission 22 Part 4 human preview and approval contract', () => {
  test.each(['assign', 'reassign', 'unassign', 'schedule', 'reschedule', 'dispatch'])(
    'accepts the exact %s action vocabulary', action => {
      const normalized = preview({
        action,
        target: action === 'assign' || action === 'reassign'
          ? { kind: 'profile', id: IDS.target }
          : { kind: 'unassigned', id: null },
      });
      expect(normalized.action).toBe(action);
      expect(normalized.requestDigest).toMatch(/^[0-9a-f]{64}$/);
    }
  );

  test('normalizes explicit-offset instants to UTC while retaining raw evidence', () => {
    const normalized = preview();
    expect(normalized.scheduledStart).toBe('2027-03-15T13:00:00.000Z');
    expect(normalized.rawScheduledStart).toBe('2027-03-15T09:00:00-04:00');
    expect(normalized.proposal.timeZone).toBe('America/New_York');
  });

  test('rejects DST gaps, implicit offsets, and mismatched tenant offsets', () => {
    expectContractError(() => preview({ scheduledStart: '2027-03-14T02:15:00-05:00' }),
      'INVALID_APPROVAL_SCHEDULE', 400);
    expectContractError(() => preview({ scheduledStart: '2027-03-15T09:00:00' }),
      'INVALID_APPROVAL_SCHEDULE', 400);
    expectContractError(() => preview({ scheduledStart: '2027-03-15T09:00:00-05:00' }),
      'INVALID_APPROVAL_SCHEDULE', 400);
  });

  test('accepts both explicit fold instants as distinct authority', () => {
    const first = preview({
      scheduledStart: '2027-11-07T01:15:00-04:00', scheduledEnd: '2027-11-07T01:45:00-04:00',
    });
    const second = preview({
      scheduledStart: '2027-11-07T01:15:00-05:00', scheduledEnd: '2027-11-07T01:45:00-05:00',
    });
    expect(first.scheduledStart).not.toBe(second.scheduledStart);
    expect(first.requestDigest).not.toBe(second.requestDigest);
  });

  test('rejects partial, reversed, overlong, or unknown-field proposals', () => {
    expectContractError(() => preview({ scheduledEnd: null }), 'INVALID_APPROVAL_SCHEDULE', 400);
    expectContractError(() => preview({ scheduledEnd: '2027-03-15T08:00:00-04:00' }),
      'INVALID_APPROVAL_SCHEDULE', 400);
    expectContractError(() => preview({ scheduledEnd: '2027-04-20T10:00:00-04:00' }),
      'INVALID_APPROVAL_SCHEDULE', 400);
    expectContractError(() => preview({ overrideHardConflict: true }), 'INVALID_MUTATION_PREVIEW', 400);
  });

  test('requires exact target shape and one target identity', () => {
    expectContractError(() => preview({ target: { kind: 'unassigned' } }),
      'INVALID_APPROVAL_TARGET', 400);
    expectContractError(() => preview({ target: { kind: 'profile', id: null } }),
      'INVALID_APPROVAL_TARGET', 400);
    expectContractError(() => preview({ target: { kind: 'crew', id: IDS.target, role: 'owner' } }),
      'INVALID_APPROVAL_TARGET', 400);
  });

  test('pins actor, session, tenant, appointment, and exact reason in request digests', () => {
    const first = preview();
    const changed = normalizeMutationPreview({
      organizationId: IDS.organization,
      actorUserId: IDS.actor,
      authSessionId: 'e3000000-0000-4000-8000-000000000002',
      appointmentId: IDS.appointment,
      body: {
        expectedRevision: first.expectedRevision,
        expectedDigest: first.expectedDigest,
        expectedTimeZone: first.expectedTimeZone,
        action: first.action,
        target: first.target,
        scheduledStart: first.rawScheduledStart,
        scheduledEnd: first.rawScheduledEnd,
        appointmentStatus: first.appointmentStatus,
        reason: first.reason,
      },
    });
    expect(first.requestDigest).not.toBe(changed.requestDigest);
  });

  test('sorts exact warning acknowledgements and rejects duplicates', () => {
    const second = 'b'.repeat(64);
    expect(approval({ acknowledgedWarningDigests: [second, DIGEST] }).acknowledgedWarningDigests)
      .toEqual([DIGEST, second]);
    expectContractError(() => approval({ acknowledgedWarningDigests: [DIGEST, DIGEST] }),
      'INVALID_WARNING_ACKNOWLEDGEMENT', 400);
  });

  test('requires a bounded printable idempotency key and exact approval envelope', () => {
    expectContractError(() => approval({}, 'short'), 'INVALID_IDEMPOTENCY_KEY', 400);
    expectContractError(() => approval({ capability: DIGEST }), 'INVALID_MUTATION_APPROVAL', 400);
    expect(approval().idempotencyKeyHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('rejects hostile control bytes but preserves bounded stored markup as inert bytes', () => {
    expectContractError(() => preview({ reason: 'reviewed\u0000' }), 'INVALID_APPROVAL_REASON', 400);
    expect(preview({ reason: '<img src=x onerror=alert(1)> reviewed by owner.' }).reason)
      .toContain('<img');
  });

  test('recognizes only exact bounded raw Part 4 endpoints', () => {
    const base = `/api/v1/canonical/appointments/${IDS.appointment}`;
    expect(isApprovalRequest({ method: 'POST', originalUrl: `${base}/mutation-previews` })).toBe(true);
    expect(isApprovalRequest({ method: 'POST', originalUrl: `${base}/mutation-approvals` })).toBe(true);
    expect(isApprovalRequest({ method: 'POST', originalUrl: `${base}/mutation-previews/extra` })).toBe(false);
    expect(isApprovalRequest({ method: 'PATCH', originalUrl: `${base}/mutation-previews` })).toBe(false);
    expect(isApprovalRequest({ method: 'POST', originalUrl: `${base}/mutation-previews%ZZ` })).toBe(false);
  });

  test('publishes the exact raw request byte ceiling', () => {
    expect(MAXIMUM_BODY_BYTES).toBe(65536);
  });
});
