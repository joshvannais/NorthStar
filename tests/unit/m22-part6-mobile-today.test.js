'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

function source(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

describe('Mission 22 Part 6 mobile crew Today contract', () => {
  const validInput = Object.freeze({
    organizationId: 'a1600000-0000-4000-8000-000000000001',
    actorUserId: 'b1600000-0000-4000-8000-000000000002',
    membershipId: 'b1600000-0000-4000-8000-000000000002',
    authSessionId: 'c1600000-0000-4000-8000-000000000002',
    actorAccessRole: 'member',
  });

  test('has a paid-only Today destination without creating a demo authority', () => {
    const contract = require('../../public/js/command-center-contract');
    const permissions = require('../../src/auth/permissions');

    expect(contract.ROUTES.map(route => route.id)).not.toContain('today');
    expect(contract.PAID_ROUTES.map(route => route.id)).toContain('today');
    expect(contract.routesForMode('demo').map(route => route.id)).not.toContain('today');
    expect(contract.routesForMode('paid').map(route => route.id)).toContain('today');
    expect(contract.destinationPath('today', 'demo')).toBeNull();
    expect(contract.destinationPath('today', 'paid')).toBe('/dashboard/today');
    expect(permissions.NAVIGATION_DESTINATIONS.map(route => route.id)).toContain('today');
  });

  test('mounts one authenticated read-only endpoint and genuine signed-in page', () => {
    const server = source('src/server.js');
    const route = source('src/routes/today.js');
    const html = source('public/dashboard/today.html');

    expect(server).toContain("'/dashboard/today': 'public/dashboard/today.html'");
    expect(server).toContain("app.use('/api/v1/today'");
    expect(route).toContain("router.get('/', auth");
    expect(route).not.toMatch(/router\.(post|put|patch|delete)\(/);
    expect(html).toContain('/js/today-shell.js');
    expect(html).not.toContain('/js/auth-session.js');
    expect(html).not.toContain('/js/nav-component.js');
    expect(html).not.toContain('/js/command-center-contract.js');
    expect(html).toContain('/js/today-page.js');
    expect(html).toContain('aria-labelledby="todayTitle"');
  });

  test('uses a Today-only bootstrap with no broad account or navigation projection', () => {
    const shell = source('public/js/today-shell.js');
    const html = source('public/dashboard/today.html');
    const employeeBundle = `${html}\n${shell}\n${source('public/js/today-page.js')}`;
    const bootstrapBundle = `${html}\n${shell}`;

    expect(shell).toContain("'/dashboard/today'");
    expect(shell).toContain("'/api/auth/logout'");
    expect(shell).not.toContain('/api/auth/me');
    expect(source('public/js/theme.js')).toContain("document.body.classList.contains('today-page')");
    for (const forbidden of [
      '/dashboard/polaris', '/dashboard/leads', '/dashboard/communications', '/dashboard/calendar',
      '/dashboard/team', '/dashboard/business-profile', '/dashboard/settings', '/dashboard/integrations',
      'subscription', 'onboarding', 'organization',
    ]) expect(employeeBundle.toLowerCase()).not.toContain(forbidden.toLowerCase());
    for (const privateIdentityField of ['email', 'phone']) {
      expect(bootstrapBundle.toLowerCase()).not.toContain(privateIdentityField);
    }
  });

  test('constructs a real tenant-zone browser fixture at every representative UTC hour and DST boundary', () => {
    const { chooseFixturePlan } = require('../helpers/m22-part6-browser-fixture-time');
    const samples = [];
    for (let hour = 0; hour < 24; hour += 1) samples.push(new Date(Date.UTC(2026, 7, 27, hour, 58)));
    samples.push(
      new Date('2026-03-08T06:55:00.000Z'), new Date('2026-03-08T07:05:00.000Z'),
      new Date('2026-11-01T05:55:00.000Z'), new Date('2026-11-01T06:05:00.000Z')
    );
    for (const instant of samples) {
      const plan = chooseFixturePlan(instant);
      expect(plan.timeZone).toMatch(/^[A-Za-z]+(?:\/[A-Za-z_+-]+)+$/);
      expect(plan.instants).toHaveLength(10);
      expect(new Set(plan.instants).size).toBe(10);
      expect(plan.instants.every(value => /(?:Z|[+-]\d{2}:\d{2})$/.test(value))).toBe(true);
    }
  });

  test('keeps authorization and returned bytes in one bounded repeatable-read snapshot', () => {
    const repository = source('src/scheduling/todayRepository.js');

    expect(repository).toContain('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(repository).toContain("SET LOCAL search_path=pg_catalog,public");
    expect(repository).toContain("SET LOCAL statement_timeout='15000ms'");
    expect(repository).toContain("SET LOCAL lock_timeout='2000ms'");
    expect(repository).toContain("SET LOCAL idle_in_transaction_session_timeout='15000ms'");
    expect(repository).toContain('public.auth_sessions');
    expect(repository).toContain('public.organization_memberships');
    expect(repository).toContain('public.workforce_profiles');
    expect(repository).toContain('public.workforce_crew_members');
    expect(repository).toContain('public.canonical_schedule_assignments');
    expect(repository).toContain('public.canonical_business_profiles');
    expect(repository).toContain('M22_TODAY_APPROVAL_UNAVAILABLE');
    expect(repository).toContain('COMMIT');
    expect(repository).toContain('ROLLBACK');
    expect(repository).toContain('client.release()');
    expect(repository).not.toMatch(/pool\.query\(/);
  });

  test('derives Today from tenant IANA time and current direct-or-crew scope', () => {
    const repository = source('src/scheduling/todayRepository.js');

    expect(repository).toContain("transaction_timestamp() AT TIME ZONE authority.time_zone");
    expect(repository).toContain("AT TIME ZONE authority.time_zone");
    expect(repository).toContain('assignment.workforce_profile_id=authority.profile_id');
    expect(repository).toContain('public.workforce_crew_members current_crew');
    expect(repository).toContain('current_crew.profile_id=authority.profile_id');
    expect(repository).toContain("assignment.target_state='assigned'");
    expect(repository).toContain('assignment.scheduled_start < bounds.day_end');
    expect(repository).toContain('assignment.scheduled_end > bounds.day_start');
    expect(repository).toContain('LIMIT 101');
  });

  test('allowlists minimized source-to-sink fields and exposes no execution controls', () => {
    const repository = source('src/scheduling/todayRepository.js');
    const page = source('public/js/today-page.js');
    const html = source('public/dashboard/today.html');
    const combined = `${repository}\n${page}\n${html}`;

    for (const forbidden of [
      'estimate_total', 'final_price', 'invoice', 'payment', 'payroll', 'subscription_id',
      'transcript_text', 'customer_history', 'recommendation_payload',
    ]) expect(repository).not.toContain(forbidden);
    for (const action of ['Start job', 'Arrive', 'En route', 'Complete job', 'Clock in', 'Upload photo']) {
      expect(combined).not.toContain(action);
    }
    expect(page).toContain('textContent');
    expect(page).not.toContain('innerHTML');
    expect(source('public/js/today-shell.js')).not.toContain('/api/auth/me');
    expect(repository).toContain('providerNeutral: true');
    expect(repository).toContain('providerCalls: 0');
    expect(repository).toContain('mutationCapabilities: []');
  });

  test('provides truthful accessible UI states and Command Center visual parity hooks', () => {
    const html = source('public/dashboard/today.html');
    const css = source('public/css/today.css');
    const page = source('public/js/today-page.js');

    for (const state of ['loading', 'ready', 'empty', 'error', 'offline', 'restricted', 'stale']) {
      expect(`${html}\n${page}`).toContain(state);
    }
    expect(html).toContain('/css/style.css');
    expect(html).toContain('/css/demo-dashboard.css');
    expect(html).toContain('aria-live="polite"');
    expect(css).toContain('@media (max-width: 390px)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('min-height: 44px');
    expect(css).toContain('overflow-wrap: anywhere');
  });

  test('fails closed above the record bound and always rolls back and releases', async () => {
    const { loadToday, MAXIMUM_TODAY_RECORDS } = require('../../src/scheduling/todayRepository');
    const calls = [];
    const client = {
      release: jest.fn(),
      query: jest.fn(async sql => {
        calls.push(sql);
        if (String(sql).includes('FROM public.organization_memberships membership')) return {
          rowCount: 1,
          rows: [{
            membership_id: validInput.membershipId, access_role: 'member', membership_status: 'active',
            user_id: validInput.actorUserId, actor_name: 'Worker', user_status: 'active',
            profile_id: validInput.membershipId, operational_role: 'technician',
            session_id: validInput.authSessionId, session_user_id: validInput.actorUserId,
            session_organization_id: validInput.organizationId, session_membership_id: validInput.membershipId,
            session_status: 'active', access_expires_at: '2035-01-01T00:00:00.000Z',
            time_zone: 'America/New_York', evaluated_at: '2030-01-01T00:00:00.000Z',
          }],
        };
        if (String(sql).includes('JOIN public.canonical_schedule_assignments assignment')) {
          return { rows: Array.from({ length: MAXIMUM_TODAY_RECORDS + 1 }, () => ({})) };
        }
        return { rows: [], rowCount: 0 };
      }),
    };
    await expect(loadToday({ connect: async () => client }, validInput)).rejects.toMatchObject({
      code: 'M22_TODAY_RESOURCE_BOUND', status: 503,
    });
    expect(calls).toContain('ROLLBACK');
    expect(calls).not.toContain('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('maps repeatable-read serialization races to a typed reload state', async () => {
    const { loadToday } = require('../../src/scheduling/todayRepository');
    const client = {
      release: jest.fn(),
      query: jest.fn(async sql => {
        if (String(sql).includes('FROM public.organization_memberships membership')) return {
          rowCount: 1,
          rows: [{
            membership_id: validInput.membershipId, access_role: 'member', membership_status: 'active',
            user_id: validInput.actorUserId, actor_name: 'Worker', user_status: 'active',
            profile_id: validInput.membershipId, operational_role: 'technician',
            session_id: validInput.authSessionId, session_user_id: validInput.actorUserId,
            session_organization_id: validInput.organizationId, session_membership_id: validInput.membershipId,
            session_status: 'active', access_expires_at: '2035-01-01T00:00:00.000Z',
            time_zone: 'America/New_York', evaluated_at: '2030-01-01T00:00:00.000Z',
          }],
        };
        if (String(sql).includes('JOIN public.canonical_schedule_assignments assignment')) {
          const error = new Error('serialization failure'); error.code = '40001'; throw error;
        }
        return { rows: [], rowCount: 0 };
      }),
    };
    await expect(loadToday({ connect: async () => client }, validInput)).rejects.toMatchObject({
      code: 'M22_TODAY_STALE_RETRY', status: 409,
    });
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
