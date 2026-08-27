'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const {
  allowedActions,
  classifyRecord,
} = require('../../src/scheduling/overviewRepository');
const {
  encodeOperatorTargetCursor,
  parseOperatorTargetRequest,
} = require('../../src/scheduling/operatorDirectory');
const { createCanonicalRouter } = require('../../src/routes/canonicalPolaris');

const ROOT = path.resolve(__dirname, '..', '..');
const DIGEST = 'a'.repeat(64);

function item(overrides = {}) {
  return {
    appointment: {
      scheduleAuthority: {
        revision: 2,
        digest: DIGEST,
        targetState: 'unassigned',
        workforceProfileId: null,
        workforceCrewId: null,
        scheduleState: 'unscheduled',
        scheduledStart: null,
        scheduledEnd: null,
        dispatchState: 'not_dispatched',
        appointmentStatus: 'preferred',
        needsReview: false,
        ...overrides,
      },
    },
  };
}

describe('Mission 22 Part 5 owner and dispatcher UX contracts', () => {
  test('server action availability truthfully covers the six serialized actions', () => {
    expect(allowedActions(item().appointment.scheduleAuthority)).toEqual(['assign', 'schedule']);
    expect(allowedActions(item({
      targetState: 'profile', workforceProfileId: '00000000-0000-4000-8000-000000000001',
      scheduleState: 'scheduled', scheduledStart: '2027-01-01T14:00:00.000Z',
      scheduledEnd: '2027-01-01T15:00:00.000Z',
    }).appointment.scheduleAuthority)).toEqual(['reassign', 'unassign', 'reschedule', 'dispatch']);
    expect(allowedActions(item({
      targetState: 'profile', workforceProfileId: '00000000-0000-4000-8000-000000000001',
      scheduleState: 'scheduled', scheduledStart: '2027-01-01T14:00:00.000Z',
      scheduledEnd: '2027-01-01T15:00:00.000Z', dispatchState: 'dispatched',
    }).appointment.scheduleAuthority)).toEqual(['reassign', 'unassign', 'reschedule']);
  });

  test('server classification uses controlled time and keeps completed as compatibility metadata', () => {
    const now = '2027-01-01T12:00:00.000Z';
    const conflict = { hardConflicts: [], warnings: [], needsReview: false };
    expect(classifyRecord(item({
      scheduleState: 'scheduled', scheduledStart: '2027-01-01T13:00:00.000Z',
      scheduledEnd: '2027-01-01T14:00:00.000Z',
    }), conflict, now)).toMatchObject({ unassigned: true, due: true, overdue: false, atRisk: true });
    expect(classifyRecord(item({
      appointmentStatus: 'completed', targetState: 'profile',
      workforceProfileId: '00000000-0000-4000-8000-000000000001',
      scheduleState: 'scheduled', scheduledStart: '2026-12-31T10:00:00.000Z',
      scheduledEnd: '2026-12-31T11:00:00.000Z', dispatchState: 'dispatched',
    }), conflict, now).overdue).toBe(true);
    expect(classifyRecord(item({
      targetState: 'crew', workforceCrewId: '00000000-0000-4000-8000-000000000002',
      scheduleState: 'scheduled', scheduledStart: '2027-01-04T13:00:00.000Z',
      scheduledEnd: '2027-01-04T14:00:00.000Z', dispatchState: 'dispatched',
    }), { hardConflicts: [{ code: 'overlap' }], warnings: [], needsReview: false }, now))
      .toMatchObject({ conflicting: true, atRisk: true });
  });

  test('Calendar has no direct appointment PATCH and all UI writes use Part 4 preview then approval', () => {
    const calendar = fs.readFileSync(path.join(ROOT, 'public/js/calendar-engine.js'), 'utf8');
    const approval = fs.readFileSync(path.join(ROOT, 'public/js/scheduling-approval-ui.js'), 'utf8');
    expect(calendar).not.toMatch(/appointments\/'\s*\+\s*encodeURIComponent\(id\)[\s\S]{0,300}method\s*:\s*['"]PATCH/);
    expect(approval).toContain('/mutation-previews');
    expect(approval).toContain('/mutation-approvals');
    expect(approval.indexOf('/mutation-previews')).toBeLessThan(approval.indexOf('/mutation-approvals'));
    expect(approval).not.toContain('innerHTML');
    expect(approval).toContain('Idempotency-Key');
  });

  test('Command Center consumes server categories and demo remains explicitly non-authoritative', () => {
    const page = fs.readFileSync(path.join(ROOT, 'public/js/command-center-page.js'), 'utf8');
    const html = fs.readFileSync(path.join(ROOT, 'public/demo-dashboard.html'), 'utf8');
    expect(page).toContain('overview.categories[schedulingCategory]');
    expect(page).toContain('server-defined category');
    expect(page).toContain('non-authoritative and read-only');
    expect(page).not.toMatch(/fetch\([^)]*canonical\/compat\/calendar/);
    expect(html).toContain('scheduling-approval-ui.js');
  });

  test('operator target cursors are canonical, tenant/search bound, and malformed input fails before persistence', async () => {
    const organizationId = '11111111-1111-4111-8111-111111111111';
    const cursor = encodeOperatorTargetCursor({
      organizationId, query: 'Worker', datasetDigest: 'b'.repeat(64), kindRank: 1,
      id: '22222222-2222-4222-8222-222222222222',
    });
    expect(parseOperatorTargetRequest({ query: ' Worker ', cursor }, organizationId)).toMatchObject({
      query: 'Worker', rawCursor: cursor,
      cursor: { organizationId, query: 'Worker', datasetDigest: 'b'.repeat(64), kindRank: 1 },
    });
    expect(parseOperatorTargetRequest({ query: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' }, organizationId).query)
      .toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    const malformed = [
      '!!!', cursor + '!', cursor + '=', 'A'.repeat(4097),
      Buffer.from('{}').toString('base64url'),
      Buffer.from(JSON.stringify({ version: 1, operation: 'm22_operator_target_directory' })).toString('base64url'),
    ];
    for (const value of malformed) {
      expect(() => parseOperatorTargetRequest({ query: 'Worker', cursor: value }, organizationId))
        .toThrow('target directory cursor is invalid');
    }
    expect(() => parseOperatorTargetRequest({ query: 'x'.repeat(101) }, organizationId)).toThrow('search query is invalid');
    expect(() => parseOperatorTargetRequest({ query: ['Worker'] }, organizationId)).toThrow('search query is invalid');
    expect(() => parseOperatorTargetRequest({ query: 'Worker', extra: 'scan' }, organizationId)).toThrow('request is invalid');
    expect(() => parseOperatorTargetRequest({ query: 'Different', cursor }, organizationId)).toThrow('cursor is invalid');
    expect(() => parseOperatorTargetRequest({ query: 'Worker', cursor }, '33333333-3333-4333-8333-333333333333'))
      .toThrow('cursor is invalid');

    var poolCalls = 0;
    var directoryCalls = 0;
    const app = express();
    app.use('/api/v1/canonical', createCanonicalRouter({
      auth: function (req, _res, next) {
        req.tenantContext = { organizationId, userId: '44444444-4444-4444-8444-444444444444' };
        req.accountAuthority = { membership_id: '44444444-4444-4444-8444-444444444444' };
        req.userRole = 'owner'; req.user = { onboardingStatus: 'complete' };
        next();
      },
      poolProvider: function () { poolCalls += 1; return { query: jest.fn() }; },
      operatorTargetDirectory: async function () { directoryCalls += 1; return null; },
    }));
    const response = await request(app).get('/api/v1/canonical/operator-targets?cursor=!!!');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_OPERATOR_TARGET_CURSOR');
    expect({ poolCalls, directoryCalls }).toEqual({ poolCalls: 0, directoryCalls: 0 });
  });

  test('the shared visible dialog exposes truthful bounded target discovery without client mutation authority', () => {
    const approval = fs.readFileSync(path.join(ROOT, 'public/js/scheduling-approval-ui.js'), 'utf8');
    const commandContract = fs.readFileSync(path.join(ROOT, 'public/js/command-center-contract.js'), 'utf8');
    expect(approval).toContain('/api/v1/canonical/operator-targets');
    expect(approval).toContain('Search active workers and crews');
    expect(approval).toContain('Next target page');
    expect(approval).toContain('The initial selector is incomplete');
    expect(approval).toContain('The current target directory changed during paging');
    expect(approval).toContain('textContent');
    expect(approval).not.toContain('innerHTML');
    expect(commandContract).toContain('m22-part5-target-directory-v1');
  });
});
