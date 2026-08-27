'use strict';

const fs = require('fs');
const path = require('path');
const {
  allowedActions,
  classifyRecord,
} = require('../../src/scheduling/overviewRepository');

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
});
