'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
function exists(relative) { return fs.existsSync(path.join(ROOT, relative)); }
function source(relative) { return fs.readFileSync(path.join(ROOT, relative), 'utf8'); }

describe('Mission 23 Part 9 Slice A worker operational experience', () => {
  test('mounts exactly one worker work-detail page without widening other dashboard surfaces', () => {
    expect(exists('public/dashboard/work.html')).toBe(true);
    expect(exists('public/js/work-page.js')).toBe(true);
    expect(exists('public/js/field-execution-client.js')).toBe(true);
    expect(exists('public/css/work.css')).toBe(true);
    if (!exists('public/dashboard/work.html')) return;

    const server = source('src/server.js');
    const html = source('public/dashboard/work.html');
    expect(server).toContain("'/dashboard/work': 'public/dashboard/work.html'");
    expect(html).toContain('/js/theme.js');
    expect(html).toContain('/js/display-projection.js');
    expect(html).toContain('/js/today-shell.js');
    expect(html).toContain('/js/field-execution-client.js');
    expect(html).toContain('/js/work-page.js');
    expect(html).not.toContain('/js/auth-session.js');
    expect(html).not.toContain('/js/nav-component.js');
    expect(server).not.toContain("'/dashboard/operations'");
  });

  test('keeps Today read-only while adding a server-scoped execution pointer and one inert Open work control', () => {
    const repository = source('src/scheduling/todayRepository.js');
    const database = source('src/db.js');
    const page = source('public/js/today-page.js');
    expect(exists('migrations/053_current_worker_execution_projection.sql')).toBe(true);
    expect(repository).toContain('canonical_field_execution_read_by_appointment');
    expect(repository).not.toContain('LEFT JOIN public.canonical_field_executions execution');
    expect(database).toContain(
      'GRANT EXECUTE ON FUNCTION public.canonical_field_execution_read_by_appointment(uuid,uuid,text,uuid,uuid)'
    );
    expect(repository).toContain('executionId');
    expect(repository).toContain('scopeDigest');
    expect(repository).toContain('businessProfile');
    expect(repository).toContain('mutationCapabilities: []');
    expect(page).toContain('Open work');
    expect(page).toContain('/dashboard/work?appointmentId=');
    expect(page).not.toContain('innerHTML');
  });

  test('provides strict selector, pin, route and idempotency helpers without browser authority', () => {
    expect(exists('public/js/field-execution-client.js')).toBe(true);
    if (!exists('public/js/field-execution-client.js')) return;
    const client = require('../../public/js/field-execution-client');
    const appointmentId = 'd1600000-0000-4000-8000-000000000001';
    const executionId = 'e1600000-0000-4000-8000-000000000001';
    expect(client.parseSelector(`?appointmentId=${appointmentId}&executionId=${executionId}`))
      .toEqual({ appointmentId, executionId });
    for (const invalid of [
      '', '?appointmentId=wrong', `?appointmentId=${appointmentId}&tenantId=a1600000-0000-4000-8000-000000000001`,
      `?appointmentId=${appointmentId}&appointmentId=${appointmentId}`,
    ]) expect(() => client.parseSelector(invalid)).toThrow('WORK_SELECTOR_INVALID');

    const record = { appointmentId, authority: { revision: 7, digest: 'a'.repeat(64) },
      execution: { id: executionId, revision: 3, digest: 'b'.repeat(64),
        sourceAssignmentRevision: 7, sourceAssignmentDigest: 'a'.repeat(64) } };
    expect(client.pins(record.execution, record)).toEqual({
      expectedExecutionRevision: 3, expectedExecutionDigest: 'b'.repeat(64),
      expectedAssignmentRevision: 7, expectedAssignmentDigest: 'a'.repeat(64),
    });
    expect(() => client.pins({ ...record.execution, sourceAssignmentRevision: 6 }, record))
      .toThrow('WORK_AUTHORITY_STALE');
    expect(client.paths({ appointmentId, executionId })).toMatchObject({
      initialize: `/api/v1/field-executions/appointments/${appointmentId}`,
      execution: `/api/v1/field-executions/${executionId}`,
      labor: `/api/v1/field-executions/${executionId}/labor`,
      materials: `/api/v1/field-executions/${executionId}/materials`,
      evidence: `/api/v1/field-executions/${executionId}/field-evidence`,
      progress: `/api/v1/field-executions/${executionId}/progress`,
      completion: `/api/v1/field-executions/${executionId}/completion`,
      equipment: `/api/equipment/executions/${executionId}`,
    });
    const key = client.idempotencyKey('start', '01234567-89ab-4cde-8fab-0123456789ab');
    expect(key).toMatch(/^m23-part9a-start-01234567-89ab-4cde-8fab-0123456789ab$/);
    expect(key.length).toBeLessThanOrEqual(128);
  });

  test('defines the complete worker flow and every required truthful state with accessible confirmation', () => {
    expect(exists('public/dashboard/work.html')).toBe(true);
    if (!exists('public/dashboard/work.html')) return;
    const html = source('public/dashboard/work.html');
    const page = source('public/js/work-page.js');
    const css = source('public/css/work.css');
    const aggregate = `${html}\n${page}`;
    for (const section of ['workOverview', 'workLifecycle', 'workLabor', 'workMaterials',
      'workEquipment', 'workEvidence', 'workProgress', 'workCompletion']) {
      expect(html).toContain(`id="${section}"`);
    }
    for (const state of ['loading', 'empty', 'offline', 'restricted', 'read-only', 'stale',
      'conflict', 'partial-file', 'retry', 'applied-but-refresh-failed', 'success']) {
      expect(aggregate).toContain(state);
    }
    for (const action of ['start', 'pause', 'resume', 'start_timer', 'stop_timer', 'record_manual',
      'record_observation', 'record_note', 'record_progress', 'record_blocker', 'record_exception',
      'record_change', 'propose_completion', 'withdraw_completion']) {
      expect(page).toContain(action);
    }
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('<dialog');
    expect(page).toContain('textContent');
    expect(page).not.toContain('innerHTML');
    expect(page).not.toMatch(/localStorage/);
    expect(css).toContain('@media (max-width: 390px)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('min-height: 44px');
    expect(css).toContain('overflow-wrap: anywhere');
  });

  test('keeps migrations, dependencies, providers and later Part 9 surfaces outside the implementation', () => {
    const work = exists('public/js/work-page.js') ? source('public/js/work-page.js') : '';
    for (const forbidden of ['OPENAI_API_KEY', 'RETELL_', 'STRIPE_', '/api/auth/me',
      '/dashboard/calendar', '/dashboard/lead', '/api/v1/canonical/polaris']) {
      expect(work).not.toContain(forbidden);
    }
    expect(source('docs/roadmap/MISSION_23_OPERATIONS.md')).toContain('Part 9');
  });
});
