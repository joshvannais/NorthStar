'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const centerContract = require('../../public/js/automation-center-contract');
const commandCenterContract = require('../../public/js/command-center-contract');
const permissions = require('../../src/auth/permissions');
const { buildSnapshot, readAutomationCenter } = require('../../src/automationCenter/repository');
const { createAutomationCenterRouter } = require('../../src/routes/automationCenter');

const ROOT = path.resolve(__dirname, '../..');
const uuid = value => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const digest = value => `sha256:${String(value).padEnd(64, '0').slice(0, 64)}`;
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

function preview(overrides = {}) {
  return {
    templateId: 'custom',
    name: 'Private owner review',
    sourceClassId: 'mission23_work_execution',
    actionFamily: 'internal_read_digest_task',
    recipientClass: 'tenant_owner',
    channelId: 'in_app_passive',
    timing: 'review_now',
    dailyLimit: 2,
    ...overrides,
  };
}
function emptyResults(overrides = {}) {
  return {
    evaluatedAt: new Date('2026-11-20T20:00:00.000Z'),
    policies: [], runs: [], records: [], documents: [], channels: [], stopControl: [],
    ...overrides,
  };
}
function input(role = 'owner') {
  return { organizationId: uuid(28), actorUserId: uuid(1), actorAccessRole: role, authSessionId: uuid(2) };
}

describe('Mission 28 Part 14A bounded setup contract', () => {
  test('publishes four owner-readable templates and no executable authority', () => {
    expect(centerContract.TEMPLATES.map(item => item.id)).toEqual([
      'owner-work-review', 'estimate-follow-up-review', 'appointment-update-review', 'invoice-reminder-review'
    ]);
    for (const template of centerContract.TEMPLATES) {
      expect(template.description).not.toMatch(/idempotency|canonical|provider adapter|queue|digest/i);
    }
  });

  test('custom preview remains an exact no-effect result', () => {
    const result = centerContract.buildPreview(preview());
    expect(result).toMatchObject({
      version: 'mission28.automation-center.v1', previewOnly: true, saved: false, activated: false,
      queued: false, recipientContacted: false, providerAttemptCreated: false,
      externalEffectCreated: false, financialEffectCreated: false, moneyEffectCreated: false,
    });
    expect(result.stopConditions).toHaveLength(3);
    expect(result.channel).toBe('NorthStar inbox');
  });

  test('external template preview reports external channel authority unavailable', () => {
    const template = centerContract.TEMPLATES[1];
    const result = centerContract.buildPreview({
      templateId: template.id, name: template.name, sourceClassId: template.sourceClassId,
      actionFamily: template.actionFamily, recipientClass: template.recipientClass,
      channelId: template.channelId, timing: template.timing, dailyLimit: 1,
    });
    expect(result.availability).toBe('preview_only_external_channel_unavailable');
    expect(result.recipientContacted).toBe(false);
  });

  test.each([
    ['extra field', { extra: true }],
    ['fractional limit', { dailyLimit: 1.5 }],
    ['above-ceiling limit', { dailyLimit: 26 }],
    ['customer through internal inbox', { recipientClass: 'exact_customer_record' }],
    ['team through external email', { channelId: 'email' }],
    ['markup in name', { name: '<script>alert(1)</script>' }],
  ])('denies %s', (_label, change) => {
    expect(() => centerContract.buildPreview(preview(change))).toThrow();
  });

  test('template fields cannot be widened by the caller', () => {
    const template = centerContract.TEMPLATES[0];
    expect(() => centerContract.buildPreview({
      templateId: template.id, name: template.name, sourceClassId: template.sourceClassId,
      actionFamily: template.actionFamily, recipientClass: template.recipientClass,
      channelId: 'email', timing: template.timing, dailyLimit: 1,
    })).toThrow(/template changed/i);
  });
});

describe('Mission 28 Part 14A tenant-private projection', () => {
  test('empty authority is presented as ready to set up without inventing activity', () => {
    const result = buildSnapshot(input(), emptyResults());
    expect(result.status.id).toBe('ready_to_set_up');
    expect(result.counts).toEqual({ policies: 0, activePolicies: 0, pausedPolicies: 0,
      activeRuns: 0, pausedRuns: 0, failedRuns: 0, approvals: 0, ownerWork: 0 });
    expect(result.stopControl).toMatchObject({ state: 'normal_no_control_record', canEngage: false, canRelease: false });
    expect(result.channels.find(item => item.id === 'email').state).toBe('unavailable');
    expect(result.limits.currentConsumption).toBeNull();
  });

  test('projects active paused failed work and minimized evidence without document bodies', () => {
    const result = buildSnapshot(input(), emptyResults({
      policies: [
        { policy_id: uuid(10), version: '1', source_class_id: 'mission23_work_execution', action_family: 'internal_read_digest_task', channel_id: 'in_app_passive', lifecycle_state: 'active', lifecycle_currentness: 'exact_current_not_runtime_revalidated', control_state: null, expires_at: '2030-01-01T00:00:00Z', recorded_at: '2026-11-20T19:00:00Z' },
        { policy_id: uuid(11), version: '2', source_class_id: 'mission27_financial_collection', action_family: 'collection_escalation', channel_id: 'in_app_passive', lifecycle_state: 'active', lifecycle_currentness: 'exact_current_not_runtime_revalidated', control_state: 'paused', expires_at: '2030-01-01T00:00:00Z', recorded_at: '2026-11-20T18:00:00Z' },
      ],
      runs: [
        { run_id: uuid(20), policy_id: uuid(10), policy_version: '1', latest_record_type: 'scheduled_run', currentness_marker: 'captured_exact_current', latest_recorded_at: '2026-11-20T19:30:00Z', schedule_id: uuid(21), retry_state: null, control_state: null },
        { run_id: uuid(22), policy_id: uuid(11), policy_version: '2', latest_record_type: 'reconciliation', currentness_marker: 'captured_unavailable_fail_closed', latest_recorded_at: '2026-11-20T19:35:00Z', schedule_id: uuid(23), retry_state: 'reconciliation_required_no_resend', control_state: null },
      ],
      records: [
        { record_id: uuid(30), run_id: uuid(20), record_type: 'internal_task', currentness_marker: 'captured_exact_current', authority_class: 'automation_decision', recorded_at: '2026-11-20T19:31:00Z', document: { messageBody: 'must never return' } },
        { record_id: uuid(31), run_id: uuid(22), record_type: 'reconciliation', currentness_marker: 'captured_unavailable_fail_closed', authority_class: 'effect_evidence', recorded_at: '2026-11-20T19:36:00Z' },
      ],
      documents: [{ estimate_quote_resolution_id: uuid(40), run_id: uuid(20), result_state: 'exact_document_bound_external_delivery_unavailable', recorded_at: '2026-11-20T19:32:00Z' }],
      channels: [{ requested_channel_id: 'email', result_state: 'unavailable_external_channel' }],
    }));
    expect(result.counts).toMatchObject({ policies: 2, activePolicies: 1, pausedPolicies: 1, activeRuns: 1, failedRuns: 1, ownerWork: 1 });
    expect(result.runs.map(item => item.state)).toEqual(['active', 'failed']);
    expect(result.timeline.some(item => item.kind === 'document_review')).toBe(true);
    expect(JSON.stringify(result)).not.toContain('must never return');
    expect(result.approvals).toEqual([]);
  });

  test('stale lifecycle currentness fails closed', () => {
    const result = buildSnapshot(input(), emptyResults({ policies: [{
      policy_id: uuid(10), version: '1', source_class_id: 'mission23_work_execution', action_family: 'internal_read_digest_task',
      channel_id: 'in_app_passive', lifecycle_state: 'active', lifecycle_currentness: 'stale_fail_closed', control_state: null,
      expires_at: '2030-01-01T00:00:00Z', recorded_at: '2026-11-20T19:00:00Z'
    }] }));
    expect(result.policies[0]).toMatchObject({ state: 'unavailable', stateLabel: 'Currentness unavailable', canPause: false });
  });

  test('missing currentness, malformed identifiers, and stale run evidence fail closed', () => {
    const result = buildSnapshot(input(), emptyResults({
      policies: [{
        policy_id: '00000000-0000-0000-0000-000000000010', version: '1',
        source_class_id: 'mission23_work_execution', action_family: 'internal_read_digest_task',
        channel_id: 'in_app_passive', lifecycle_state: 'active', lifecycle_currentness: null,
      }],
      runs: [{
        run_id: uuid(20), policy_id: uuid(10), policy_version: '1', latest_record_type: 'scheduled_run',
        currentness_marker: 'captured_stale_fail_closed', schedule_id: uuid(21),
      }],
      channels: [{ requested_channel_id: 'native_manual_handoff', result_state: 'unavailable_manual_handoff_not_opened' }],
      stopControl: [{ control_state: 'paused' }],
    }));
    expect(result.policies[0]).toMatchObject({ id: null, state: 'unavailable' });
    expect(result.runs[0]).toMatchObject({ state: 'failed', stateLabel: 'Currentness needs review' });
    expect(result.channels.find(item => item.id === 'native_handoff').evidence).toBe('unavailable_manual_handoff_not_opened');
    expect(result.status).toMatchObject({ id: 'stopped_or_restricted', explanation: expect.stringMatching(/remains authoritative/i) });
  });

  test('missing run currentness never becomes active merely because a schedule exists', () => {
    const result = buildSnapshot(input(), emptyResults({ runs: [{
      run_id: uuid(20), policy_id: uuid(10), policy_version: '1', latest_record_type: 'scheduled_run',
      currentness_marker: null, schedule_id: uuid(21), retry_state: null, control_state: null,
    }] }));
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0]).toMatchObject({ state: 'failed', stateLabel: 'Currentness needs review' });
    expect(result.counts).toMatchObject({ activeRuns: 0, failedRuns: 1 });
  });

  test('exact terminal runs stay out of active paused failed lists while terminal evidence remains', () => {
    const result = buildSnapshot(input(), emptyResults({
      runs: [{
        run_id: uuid(20), policy_id: uuid(10), policy_version: '1', latest_record_type: 'terminal_outcome',
        currentness_marker: 'captured_exact_current', schedule_id: uuid(21),
        retry_state: 'reconciliation_required_no_resend', control_state: 'paused',
      }],
      records: [{
        record_id: uuid(30), run_id: uuid(20), record_type: 'terminal_outcome',
        currentness_marker: 'captured_exact_current', authority_class: 'effect_evidence',
        recorded_at: '2026-11-20T19:31:00Z',
      }],
    }));
    expect(result.runs).toEqual([]);
    expect(result.counts).toMatchObject({ activeRuns: 0, pausedRuns: 0, failedRuns: 0 });
    expect(result.timeline).toEqual([expect.objectContaining({ kind: 'terminal_outcome', label: 'Run reached a terminal state' })]);
  });

  test('bounded reads reject silent truncation', () => {
    const policies = Array.from({ length: 101 }, (_, index) => ({ policy_id: uuid(100 + index) }));
    expect(() => buildSnapshot(input(), emptyResults({ policies }))).toThrow(/could not be shown safely/i);
  });

  test('combined record and document timeline fails closed instead of silently truncating', () => {
    const records = Array.from({ length: 51 }, (_, index) => ({
      record_id: uuid(100 + index), run_id: uuid(20), record_type: 'eligibility_evaluation',
      currentness_marker: 'captured_exact_current', authority_class: 'automation_decision',
      recorded_at: '2026-11-20T19:31:00Z',
    }));
    const documents = Array.from({ length: 50 }, (_, index) => ({
      estimate_quote_resolution_id: uuid(300 + index), run_id: uuid(20),
      result_state: 'exact_document_bound_external_delivery_unavailable', recorded_at: '2026-11-20T19:32:00Z',
    }));
    expect(() => buildSnapshot(input(), emptyResults({ records, documents }))).toThrow(/Timeline could not be shown safely/i);
  });

  test('ambiguous company-wide stop controls fail closed', () => {
    expect(() => buildSnapshot(input(), emptyResults({
      stopControl: [{ control_state: 'paused' }, { control_state: 'active_resumed' }],
    }))).toThrow(/could not be resolved safely/i);
  });

  test('repository enters exact tenant RLS context in a read-only transaction', async () => {
    const calls = [];
    const rows = [
      [{ evaluated_at: new Date('2026-11-20T20:00:00Z') }], [], [], [], [], [], [],
    ];
    const client = {
      query: jest.fn(async (sql, params) => {
        calls.push({ sql: String(sql), params });
        if (/^SELECT statement_timestamp/.test(String(sql))) return { rows: rows.shift() };
        if (/^\s*WITH latest_policy/.test(String(sql))) return { rows: rows.shift() };
        if (/^\s*SELECT binding\.run_id/.test(String(sql))) return { rows: rows.shift() };
        if (/^\s*SELECT record_id/.test(String(sql))) return { rows: rows.shift() };
        if (/^\s*SELECT estimate_quote_resolution_id/.test(String(sql))) return { rows: rows.shift() };
        if (/^\s*SELECT DISTINCT ON/.test(String(sql))) return { rows: rows.shift() };
        if (/^\s*SELECT control_state/.test(String(sql))) return { rows: rows.shift() };
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    const result = await readAutomationCenter({ connect: async () => client }, input());
    expect(result.status.id).toBe('ready_to_set_up');
    expect(calls[0].sql).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const tenant = calls.find(call => call.sql.includes("set_config('northstar.automation_tenant_id'"));
    expect(tenant.params).toEqual([uuid(28)]);
    expect(calls.some(call => call.sql === 'COMMIT')).toBe(true);
    expect(client.release).toHaveBeenCalledWith(false);
  });

  test.each(['member', 'viewer'])('repository denies %s tenant-wide projection', async role => {
    await expect(readAutomationCenter({ connect: jest.fn() }, input(role))).rejects.toMatchObject({ status: 403, code: 'AUTOMATION_CENTER_RESTRICTED' });
  });
});

describe('Mission 28 Part 14A mounted paid routes', () => {
  function appFor(readCenter = async () => buildSnapshot(input(), emptyResults())) {
    const app = express(); app.use(express.json());
    const tenantAuth = (req, _res, next) => {
      const role = req.get('x-test-role') || 'owner';
      req.user = { id: uuid(1) }; req.userRole = role;
      req.tenantContext = { organizationId: uuid(28), userId: uuid(1), role };
      req.orgId = uuid(28); req.authSession = { id: uuid(2) }; req.requestId = 'part14a-test'; next();
    };
    app.use('/api/v1/automation-center', createAutomationCenterRouter({
      tenantAuth, mutationAuth: (_req, _res, next) => next(), throttle: (_req, _res, next) => next(),
      poolProvider: () => ({ name: 'test-pool' }), readCenter,
    }));
    app.use((error, _req, res, _next) => res.status(error.status || 500).json({ code: error.code, error: error.message }));
    return app;
  }

  test('GET exposes only owner or admin tenant-private data', async () => {
    await request(appFor()).get('/api/v1/automation-center').expect(200).expect(response => {
      expect(response.body.success).toBe(true); expect(response.body.data.version).toBe(centerContract.VERSION);
    });
    await request(appFor()).get('/api/v1/automation-center').set('x-test-role', 'admin').expect(200);
    await request(appFor()).get('/api/v1/automation-center').set('x-test-role', 'member').expect(403);
    await request(appFor()).get('/api/v1/automation-center').set('x-test-role', 'viewer').expect(403);
  });

  test('GET is no-store and passes exact server-derived actor context', async () => {
    const readCenter = jest.fn(async (_pool, actor) => buildSnapshot(actor, emptyResults()));
    const response = await request(appFor(readCenter)).get('/api/v1/automation-center').expect(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers.vary).toMatch(/Cookie/);
    expect(readCenter.mock.calls[0][1]).toEqual(input());
  });

  test('POST preview is pure, CSRF-ready, bounded, and does not call persistence', async () => {
    const readCenter = jest.fn();
    const response = await request(appFor(readCenter)).post('/api/v1/automation-center/preview').send(preview()).expect(200);
    expect(response.body.data).toMatchObject({ previewOnly: true, saved: false, activated: false, externalEffectCreated: false });
    expect(readCenter).not.toHaveBeenCalled();
    await request(appFor()).post('/api/v1/automation-center/preview').send({ ...preview(), extra: true }).expect(400);
    await request(appFor()).post('/api/v1/automation-center/preview').set('x-test-role', 'member').send(preview()).expect(403);
  });

  test('paid navigation adds Automation Center without demo or member visibility', () => {
    expect(commandCenterContract.ROUTES.map(item => item.id)).not.toContain('automation-center');
    expect(commandCenterContract.PAID_ROUTES.map(item => item.id)).toContain('automation-center');
    expect(commandCenterContract.AUTOMATION_ROUTE).toMatchObject({ paidPath: '/dashboard/automation', demoPath: null });
    expect(permissions.navigationForRole('owner').map(item => item.id)).toContain('automation-center');
    expect(permissions.navigationForRole('admin').map(item => item.id)).toContain('automation-center');
    expect(permissions.navigationForRole('member').map(item => item.id)).not.toContain('automation-center');
    expect(permissions.navigationForRole('viewer').map(item => item.id)).not.toContain('automation-center');
  });

  test('source mounts one accessible paid page with progressive details and no demo route', () => {
    const html = read('public/dashboard/automation.html');
    const server = read('src/server.js');
    const navigation = read('public/js/nav-component.js');
    const css = read('public/css/automation-center.css');
    expect(html).toContain('<a class="automation-skip" href="#automationMain">');
    expect(html).toContain('role="status" aria-live="polite" aria-atomic="true"');
    expect(html).toContain('<details class="automation-disclosure"');
    expect(html).toContain('NavComponent.init(\'automation-center\')');
    expect(server).toContain("'/dashboard/automation': 'public/dashboard/automation.html'");
    expect(server).toContain("app.use('/api/v1/automation-center', createAutomationCenterRouter())");
    expect(server).not.toContain("'/demo/automation'");
    expect(navigation).toContain("id: 'automation-center'");
    expect(css).toMatch(/@media \(max-width: 760px\)/);
    expect(css).toMatch(/@media \(forced-colors: active\)/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  test('source-linked executable contract freezes paid-only no-effect boundaries', () => {
    const artifact = JSON.parse(read('docs/architecture/MISSION_28_PART14A_PAID_AUTOMATION_CENTER.json'));
    expect(artifact).toMatchObject({
      contractVersion: 'mission28.part14a.paid-automation-center.v1',
      status: 'implementation_candidate_not_independently_accepted_not_released',
      routes: { page: '/dashboard/automation', demoRoute: null, paidOnly: true },
      preview: { saved: false, activated: false, queued: false, recipientContacted: false,
        providerAttemptCreated: false, externalEffectCreated: false, financialEffectCreated: false,
        moneyEffectCreated: false },
      runtimeBoundary: { migrationAdded: false, latestMigration: 287, nextMigrationAbsent: 288,
        providerAdapterMounted: false, isolatedDemoMounted: false },
    });
  });

  test('primary paid copy has no hidden implementation or false outcome language', () => {
    const html = read('public/dashboard/automation.html');
    expect(html).not.toMatch(/idempotency|canonical digest|provider request identity|fencing token|row level security/i);
    expect(html).toContain('Scheduled is not delivered');
    expect(html).toContain('does not imply delivery, a reply, payment, or business success');
    expect(html).toContain('No-effect preview');
  });
});
