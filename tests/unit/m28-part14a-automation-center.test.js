'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const request = require('supertest');
const centerContract = require('../../public/js/automation-center-contract');
const commandCenterContract = require('../../public/js/command-center-contract');
const permissions = require('../../src/auth/permissions');
const { CHANNEL_EVIDENCE_LABELS, buildSnapshot, readAutomationCenter } = require('../../src/automationCenter/repository');
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
function deferred() {
  let resolve; let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flushMicrotasks(count = 8) {
  for (let index = 0; index < count; index += 1) await Promise.resolve();
}
function automationPageHarness(json) {
  class FakeElement {
    constructor(tagName = 'div') {
      this.tagName = tagName.toUpperCase(); this.dataset = {}; this.hidden = false;
      this.childNodes = []; this.attributes = {}; this.listeners = {}; this.value = ''; this.disabled = false;
      this._text = '';
    }
    get textContent() { return this._text + this.childNodes.map(child => child.textContent || '').join(''); }
    set textContent(value) { this._text = String(value); this.childNodes = []; }
    appendChild(child) { this.childNodes.push(child); return child; }
    replaceChildren(...children) { this._text = ''; this.childNodes = children; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    addEventListener(name, listener) { this.listeners[name] = listener; }
    emit(name, event = {}) { return this.listeners[name] && this.listeners[name](event); }
    focus() {}
  }
  const html = read('public/dashboard/automation.html');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  const elements = Object.fromEntries(ids.map(id => [id, new FakeElement()]));
  const documentListeners = {};
  const document = {
    readyState: 'loading',
    getElementById: id => elements[id],
    createElement: tag => new FakeElement(tag),
    addEventListener: (name, listener) => { documentListeners[name] = listener; },
  };
  const window = { NorthStarAutomationCenter: centerContract, NorthStarAccountSession: { json } };
  vm.runInNewContext(read('public/js/automation-center-page.js'), { window, document, Intl, Date, Promise, Error });
  return { elements, documentListeners, FakeElement };
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
      activeRuns: 0, pausedRuns: 0, failedRuns: 0, approvals: null, ownerWork: null });
    expect(result.approvals).toBeNull();
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
        { run_id: uuid(20), policy_id: uuid(10), policy_version: '1', latest_record_type: 'scheduled_run', currentness_marker: 'captured_exact_current', latest_recorded_at: '2026-11-20T19:30:00Z', schedule_id: uuid(21), retry_state: null, control_state: null, policy_lifecycle_state: 'active', policy_lifecycle_currentness: 'exact_current_not_runtime_revalidated', policy_expires_at: '2030-01-01T00:00:00Z' },
        { run_id: uuid(22), policy_id: uuid(11), policy_version: '2', latest_record_type: 'reconciliation', currentness_marker: 'captured_unavailable_fail_closed', latest_recorded_at: '2026-11-20T19:35:00Z', schedule_id: uuid(23), retry_state: 'reconciliation_required_no_resend', control_state: null },
      ],
      records: [
        { record_id: uuid(30), run_id: uuid(20), record_type: 'internal_task', currentness_marker: 'captured_exact_current', authority_class: 'automation_decision', recorded_at: '2026-11-20T19:31:00Z', document: { messageBody: 'must never return' } },
        { record_id: uuid(31), run_id: uuid(22), record_type: 'reconciliation', currentness_marker: 'captured_unavailable_fail_closed', authority_class: 'effect_evidence', recorded_at: '2026-11-20T19:36:00Z' },
      ],
      documents: [{ estimate_quote_resolution_id: uuid(40), run_id: uuid(20), result_state: 'exact_document_bound_external_delivery_unavailable', recorded_at: '2026-11-20T19:32:00Z' }],
      channels: [{ requested_channel_id: 'email', result_state: 'unavailable_external_channel' }],
    }));
    expect(result.counts).toMatchObject({ policies: 2, activePolicies: 1, pausedPolicies: 1, activeRuns: 1,
      failedRuns: 1, approvals: null, ownerWork: null });
    expect(result.runs.map(item => item.state)).toEqual(['active', 'failed']);
    expect(result.timeline.some(item => item.kind === 'document_review')).toBe(true);
    expect(JSON.stringify(result)).not.toContain('must never return');
    expect(result.approvals).toBeNull();
    expect(result.ownerWork).toEqual([expect.objectContaining({
      state: 'historical_status_unavailable',
      label: 'Private owner work evidence',
      statusLabel: 'Current pending or resolved task status is unavailable.',
    })]);
  });

  test('stale lifecycle currentness fails closed', () => {
    const result = buildSnapshot(input(), emptyResults({ policies: [{
      policy_id: uuid(10), version: '1', source_class_id: 'mission23_work_execution', action_family: 'internal_read_digest_task',
      channel_id: 'in_app_passive', lifecycle_state: 'active', lifecycle_currentness: 'stale_fail_closed', control_state: null,
      expires_at: '2030-01-01T00:00:00Z', recorded_at: '2026-11-20T19:00:00Z'
    }] }));
    expect(result.policies[0]).toMatchObject({ state: 'unavailable', stateLabel: 'Current policy status unavailable', canPause: false });
  });

  test('resumed delivery control never masks restrictive lifecycle or policy expiry', () => {
    const basePolicy = {
      source_class_id: 'mission23_work_execution', action_family: 'internal_read_digest_task',
      channel_id: 'in_app_passive', lifecycle_currentness: 'exact_current_not_runtime_revalidated',
      control_state: 'active_resumed', recorded_at: '2026-11-20T19:00:00Z',
    };
    const result = buildSnapshot(input(), emptyResults({ policies: [
      { ...basePolicy, policy_id: uuid(10), version: '1', lifecycle_state: 'active', expires_at: '2030-01-01T00:00:00Z' },
      { ...basePolicy, policy_id: uuid(11), version: '1', lifecycle_state: 'paused', expires_at: '2030-01-01T00:00:00Z' },
      { ...basePolicy, policy_id: uuid(12), version: '1', lifecycle_state: 'expired', expires_at: '2030-01-01T00:00:00Z' },
      { ...basePolicy, policy_id: uuid(13), version: '1', lifecycle_state: 'retired', expires_at: '2030-01-01T00:00:00Z' },
      { ...basePolicy, policy_id: uuid(14), version: '1', lifecycle_state: 'active', expires_at: '2026-11-20T19:59:59Z' },
      { ...basePolicy, policy_id: uuid(15), version: '1', lifecycle_state: null, expires_at: '2030-01-01T00:00:00Z' },
      { ...basePolicy, policy_id: uuid(16), version: '1', lifecycle_state: 'active_resumed', expires_at: '2030-01-01T00:00:00Z' },
      { ...basePolicy, policy_id: uuid(17), version: '1', lifecycle_state: 'active', control_state: 'active', expires_at: '2030-01-01T00:00:00Z' },
      { ...basePolicy, policy_id: uuid(18), version: '1', lifecycle_state: 'superseded', expires_at: '2030-01-01T00:00:00Z' },
      { ...basePolicy, policy_id: uuid(19), version: '1', lifecycle_state: 'emergency_stopped', expires_at: '2030-01-01T00:00:00Z' },
    ] }));

    expect(result.policies.map(policy => [policy.id, policy.state, policy.stateLabel])).toEqual([
      [uuid(10), 'active', 'Recorded active'],
      [uuid(11), 'paused', 'Paused'],
      [uuid(12), 'expired', 'Expired'],
      [uuid(13), 'retired', 'Retired'],
      [uuid(14), 'expired', 'Expired'],
      [uuid(15), 'unavailable', 'Current policy status unavailable'],
      [uuid(16), 'unavailable', 'Current policy status unavailable'],
      [uuid(17), 'unavailable', 'Current policy status unavailable'],
      [uuid(18), 'superseded', 'Superseded'],
      [uuid(19), 'emergency_stopped', 'Stopped'],
    ]);
    expect(result.counts).toMatchObject({ activePolicies: 1, pausedPolicies: 1 });
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
    expect(result.channels.find(item => item.id === 'native_handoff').evidence).toBe('Manual device handoff is not available.');
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

  test('run state respects tenant, policy-version, and action-schedule controls exactly like the delivery guard', () => {
    const baseRun = {
      policy_id: uuid(10), policy_version: '1', latest_record_type: 'scheduled_run',
      currentness_marker: 'captured_exact_current', schedule_id: uuid(21), retry_state: null,
      policy_lifecycle_state: 'active', policy_lifecycle_currentness: 'exact_current_not_runtime_revalidated',
      policy_expires_at: '2030-01-01T00:00:00Z',
    };
    const result = buildSnapshot(input(), emptyResults({ runs: [
      { ...baseRun, run_id: uuid(20), tenant_control_state: 'paused' },
      { ...baseRun, run_id: uuid(22), policy_control_state: 'revoked_terminal' },
      { ...baseRun, run_id: uuid(23), tenant_control_state: 'active_resumed', policy_control_state: 'active_resumed' },
      { ...baseRun, run_id: uuid(24), action_control_state: 'active_resumed' },
    ] }));

    expect(result.runs.map(run => [run.id, run.state, run.stateLabel])).toEqual([
      [uuid(20), 'paused', 'Paused'],
      [uuid(22), 'failed', 'Revoked'],
      [uuid(23), 'active', 'Scheduled record'],
      [uuid(24), 'failed', 'Control needs review'],
    ]);
    expect(result.counts).toMatchObject({ activeRuns: 1, pausedRuns: 1, failedRuns: 2 });
  });

  test('active-looking runs fail closed under paused terminal expired or missing policy lifecycle', () => {
    const baseRun = {
      policy_id: uuid(10), policy_version: '7', latest_record_type: 'scheduled_run',
      currentness_marker: 'captured_exact_current', schedule_id: uuid(21), retry_state: null,
      policy_lifecycle_currentness: 'exact_current_not_runtime_revalidated',
      policy_expires_at: '2030-01-01T00:00:00Z', policy_control_state: 'active_resumed',
    };
    const result = buildSnapshot(input(), emptyResults({ runs: [
      { ...baseRun, run_id: uuid(20), policy_lifecycle_state: 'paused' },
      { ...baseRun, run_id: uuid(22), policy_lifecycle_state: 'retired' },
      { ...baseRun, run_id: uuid(23), policy_lifecycle_state: 'expired' },
      { ...baseRun, run_id: uuid(24), policy_lifecycle_state: 'active', policy_expires_at: '2026-11-20T19:59:59Z' },
      { ...baseRun, run_id: uuid(25), policy_lifecycle_state: null },
      { ...baseRun, run_id: uuid(26), policy_lifecycle_state: 'active', policy_lifecycle_currentness: null },
    ] }));

    expect(result.runs.map(run => [run.id, run.state, run.stateLabel])).toEqual([
      [uuid(20), 'paused', 'Paused'],
      [uuid(22), 'failed', 'Retired'],
      [uuid(23), 'failed', 'Expired'],
      [uuid(24), 'failed', 'Expired'],
      [uuid(25), 'failed', 'Current policy status unavailable'],
      [uuid(26), 'failed', 'Current policy status unavailable'],
    ]);
    expect(result.counts).toMatchObject({ activeRuns: 0, pausedRuns: 1, failedRuns: 5 });
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

  test('an internal task followed by terminal evidence remains history, never pending owner work', () => {
    const result = buildSnapshot(input(), emptyResults({ records: [
      {
        record_id: uuid(30), run_id: uuid(20), record_type: 'internal_task',
        currentness_marker: 'captured_exact_current', authority_class: 'automation_decision',
        recorded_at: '2026-11-20T19:30:00Z',
      },
      {
        record_id: uuid(31), run_id: uuid(20), record_type: 'terminal_outcome',
        currentness_marker: 'captured_exact_current', authority_class: 'effect_evidence',
        recorded_at: '2026-11-20T19:31:00Z',
      },
    ] }));

    expect(result.ownerWork).toEqual([expect.objectContaining({
      runId: uuid(20),
      state: 'historical_status_unavailable',
      statusLabel: 'Terminal evidence is also recorded. Current task status is unavailable.',
    })]);
    expect(result.counts).toMatchObject({ approvals: null, ownerWork: null });
    expect(result.timeline.map(item => item.kind)).toEqual(['terminal_outcome', 'internal_task']);
    expect(() => centerContract.validateSnapshot({
      ...result, counts: { ...result.counts, approvals: 0, ownerWork: 1 },
    })).toThrow(/attention status is unavailable/i);
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

  test.each([
    ['ready_internal_no_effect', 'Private owner work is available without contacting a customer.'],
    ['unavailable_manual_handoff_not_opened', 'Manual device handoff is not available.'],
    ['unavailable_external_channel', 'External delivery is not available.'],
    ['unavailable_all_external_provider_adapters_disabled', 'External delivery services are unavailable.'],
    ['unavailable_no_accepted_external_authority', 'External delivery authority is not available.'],
    ['unavailable_no_accepted_external_customer_channel', 'No approved external customer channel is available.'],
    ['unavailable_no_authenticated_callback_authority', 'Delivery confirmation is unavailable.'],
    ['unavailable_no_tenant_bound_provider_account_or_credential', 'A connected delivery service is unavailable.'],
    ['unavailable_no_provider_resilience_authority', 'Delivery service recovery is unavailable.'],
  ])('maps accepted channel evidence %s to fixed owner-readable text', (resultState, expected) => {
    expect(CHANNEL_EVIDENCE_LABELS[resultState]).toBe(expected);
    const result = buildSnapshot(input(), emptyResults({
      channels: [{ requested_channel_id: 'email', result_state: resultState }],
    }));
    const evidence = result.channels.find(item => item.id === 'email').evidence;
    expect(evidence).toBe(expected);
    expect(evidence).not.toContain(resultState);
    expect(evidence).not.toMatch(/\b[a-z]+(?:_[a-z]+)+\b/);
  });

  test.each([null, '', 'unavailable_future_internal_state'])(
    'missing or unmapped channel evidence %p fails closed without reflecting it', resultState => {
      const row = resultState === null
        ? {}
        : { requested_channel_id: 'email', result_state: resultState };
      const result = buildSnapshot(input(), emptyResults({ channels: [row] }));
      const evidence = result.channels.find(item => item.id === 'email').evidence;
      expect(evidence).toMatch(/unavailable|needs review/i);
      if (resultState) expect(evidence).not.toContain(resultState);
      expect(evidence).not.toMatch(/\b[a-z]+(?:_[a-z]+)+\b/);
    }
  );

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
    const runRead = calls.find(call => call.sql.includes('SELECT binding.run_id'));
    expect(runRead.sql).toMatch(/run_policy\.expires_at policy_expires_at/);
    expect(runRead.sql).toMatch(/run_policy\.policy_id=binding\.policy_id[\s\S]*run_policy\.version=binding\.policy_version/);
    expect(runRead.sql).toMatch(/policy_lifecycle\.to_state policy_lifecycle_state/);
    expect(runRead.sql).toMatch(/policy_id=binding\.policy_id AND policy_version=binding\.policy_version[\s\S]*ORDER BY lifecycle_sequence DESC LIMIT 1/);
    expect(runRead.sql).toMatch(/tenant_control\.control_state tenant_control_state/);
    expect(runRead.sql).toMatch(/tenant_control\.target_kind='tenant'[\s\S]*tenant_control\.target_key=\$1::text/);
    expect(runRead.sql).toMatch(/policy_control\.target_kind='policy_version'[\s\S]*binding\.policy_id::text\|\|':'\|\|binding\.policy_version::text/);
    expect(runRead.sql).toMatch(/action_control\.target_kind='action_schedule'[\s\S]*action_control\.target_key=schedule\.schedule_id::text/);
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
    expect(html).toContain('not live runtime revalidation');
    expect(html).toContain('does not imply delivery, a reply, payment, or business success');
    expect(html).toContain('No-effect preview');
    expect(html).toContain('Current pending requests may exist');
    expect(html).toContain('Historical task evidence is not a current to-do');
  });

  test('unavailable inbox and historical terminal task evidence never render as zero pending work', async () => {
    const snapshot = buildSnapshot(input(), emptyResults({ records: [
      {
        record_id: uuid(30), run_id: uuid(20), record_type: 'internal_task',
        currentness_marker: 'captured_exact_current', authority_class: 'automation_decision',
        recorded_at: '2026-11-20T19:30:00Z',
      },
      {
        record_id: uuid(31), run_id: uuid(20), record_type: 'terminal_outcome',
        currentness_marker: 'captured_exact_current', authority_class: 'effect_evidence',
        recorded_at: '2026-11-20T19:31:00Z',
      },
    ] }));
    const { elements, documentListeners } = automationPageHarness(jest.fn()
      .mockResolvedValue({ success: true, data: snapshot }));
    documentListeners.DOMContentLoaded();
    await flushMicrotasks();

    expect(elements.summaryAttention.textContent).toBe('Unavailable');
    expect(elements.approvalCount.textContent).toBe('Unavailable');
    expect(elements.automationApprovals.textContent).toMatch(/requests may exist/i);
    expect(elements.automationApprovals.textContent).not.toMatch(/no current approval|\b0\b/i);
    expect(elements.ownerWorkCount.textContent).toBe('Unavailable');
    expect(elements.automationOwnerWork.textContent).toMatch(/terminal evidence is also recorded.*current task status is unavailable/i);
    expect(elements.automationOwnerWork.textContent).not.toMatch(/current record ready|review private owner work/i);
  });

  test('failed refresh exhaustively clears prior-tenant visible and hidden DOM state', async () => {
    const priorSnapshot = buildSnapshot(input(), emptyResults({
      policies: [{
        policy_id: uuid(10), version: '1', source_class_id: 'mission23_work_execution',
        action_family: 'internal_read_digest_task', channel_id: 'in_app_passive', lifecycle_state: 'active',
        lifecycle_currentness: 'exact_current_not_runtime_revalidated', recorded_at: '2026-11-20T19:00:00Z',
      }],
      runs: [{
        run_id: uuid(20), policy_id: uuid(10), policy_version: '1', latest_record_type: 'scheduled_run',
        currentness_marker: 'captured_exact_current', schedule_id: uuid(21), recorded_at: '2026-11-20T19:01:00Z',
      }],
      records: [{
        record_id: uuid(30), run_id: uuid(20), record_type: 'internal_task',
        currentness_marker: 'captured_exact_current', authority_class: 'automation_decision',
        recorded_at: '2026-11-20T19:02:00Z',
      }],
      channels: [
        { requested_channel_id: 'native_manual_handoff', result_state: 'unavailable_manual_handoff_not_opened' },
        { requested_channel_id: 'email', result_state: 'unavailable_no_accepted_external_customer_channel' },
        { requested_channel_id: 'sms', result_state: 'unavailable_future_internal_state' },
      ],
      stopControl: [{ control_state: 'paused' }],
    }));
    const json = jest.fn()
      .mockResolvedValueOnce({ success: true, data: priorSnapshot })
      .mockRejectedValueOnce(new Error('Automation records are unavailable.'));
    const { elements, documentListeners, FakeElement } = automationPageHarness(json);
    documentListeners.DOMContentLoaded();
    await flushMicrotasks();
    expect(elements.summaryStatus.textContent).toBe('Company-wide control recorded');
    expect(elements.automationSummary.hidden).toBe(false);
    expect(elements.automationChannels.textContent).toContain('Manual device handoff is not available.');
    expect(elements.automationChannels.textContent).toContain('No approved external customer channel is available.');
    expect(elements.automationChannels.textContent).toContain('Channel evidence is unavailable and needs review.');
    expect(elements.automationChannels.textContent).not.toMatch(/unavailable_[a-z_]+|\b[a-z]+(?:_[a-z]+)+\b/);

    const sentinel = 'TENANT_A_PRIVATE_STATE_7F31';
    const fixedDynamicIds = [
      'summaryStatus', 'summaryExplanation', 'summaryPolicies', 'summaryPolicyDetail', 'summaryRuns',
      'summaryRunDetail', 'summaryAttention', 'approvalCount', 'ownerWorkCount', 'limitsState',
      'limitsConsumption', 'stopState', 'stopExplanation', 'automationEvaluatedAt', 'previewSummary', 'previewBoundary',
    ];
    const dynamicContainerIds = [
      'automationTemplates', 'automationApprovals', 'automationOwnerWork', 'activeRuns', 'pausedRuns', 'failedRuns',
      'automationPolicies', 'automationTimeline', 'automationLimits', 'automationChannels', 'automationUnavailable',
      'previewDetails', 'previewStops',
    ];
    fixedDynamicIds.forEach(id => { elements[id].textContent = `${sentinel}:${id}`; });
    dynamicContainerIds.forEach(id => elements[id].appendChild(Object.assign(new FakeElement('span'), { textContent: `${sentinel}:${id}` })));
    ['setupTemplateId', 'setupName', 'setupDailyLimit', 'setupSource', 'setupAction', 'setupRecipient', 'setupChannel', 'setupTiming']
      .forEach(id => { elements[id].value = `${sentinel}:${id}`; elements[id].selectedIndex = 4; });
    elements.automationStatus.textContent = `${sentinel}:automationStatus`;
    elements.automationSummary.hidden = false; elements.automationPreview.hidden = false;
    expect(Object.values(elements).some(node => node.textContent.includes(sentinel) || String(node.value).includes(sentinel))).toBe(true);

    await elements.automationRefresh.emit('click');
    expect(elements.automationSummary.hidden).toBe(true);
    expect(elements.automationPreview.hidden).toBe(true);
    expect(Object.entries(elements).filter(([_id, node]) =>
      node.textContent.includes(sentinel) || String(node.value).includes(sentinel)).map(([id]) => id)).toEqual([]);
    expect(dynamicContainerIds.every(id => elements[id].childNodes.length === 0)).toBe(true);
    expect(fixedDynamicIds.map(id => elements[id].textContent)).toEqual([
      'Unavailable', 'No automation data loaded.', '0', 'No policy data loaded', '0', 'No run data loaded', 'Unavailable',
      'Unavailable', 'Unavailable', 'Unavailable', 'Current consumption is unavailable.', 'Unavailable',
      'Current company-wide control is unavailable.', 'Not checked.', '', '',
    ]);
    expect(elements.setupTemplateId.value).toBe('custom');
    expect(elements.setupName.value).toBe('');
    expect(elements.setupDailyLimit.value).toBe('1');
    expect(['setupSource', 'setupAction', 'setupRecipient', 'setupChannel', 'setupTiming']
      .every(id => elements[id].selectedIndex === 0)).toBe(true);
    expect(elements.automationStatus.textContent).toBe('Automation records are unavailable.');
  });

  test('preview authorization loss clears prior tenant data and rejects stale preview success', async () => {
    const stalePreview = deferred();
    const forbidden = Object.assign(new Error('restricted'), { status: 403 });
    const priorSnapshot = buildSnapshot(input(), emptyResults({ policies: [{
      policy_id: uuid(10), version: '1', source_class_id: 'mission23_work_execution',
      action_family: 'internal_read_digest_task', channel_id: 'in_app_passive', lifecycle_state: 'active',
      lifecycle_currentness: 'exact_current_not_runtime_revalidated', recorded_at: '2026-11-20T19:00:00Z',
    }] }));
    const json = jest.fn()
      .mockResolvedValueOnce({ success: true, data: priorSnapshot })
      .mockImplementationOnce(() => stalePreview.promise)
      .mockRejectedValueOnce(forbidden);
    const { elements, documentListeners } = automationPageHarness(json);
    documentListeners.DOMContentLoaded();
    await flushMicrotasks();

    const templateButtons = elements.automationTemplates.childNodes.map(card =>
      card.childNodes.find(child => child.tagName === 'BUTTON'));
    expect(templateButtons).toHaveLength(4);
    templateButtons[0].emit('click');
    templateButtons[1].emit('click');
    await flushMicrotasks();

    expect(elements.automationSummary.hidden).toBe(true);
    expect(elements.automationPreview.hidden).toBe(true);
    expect(elements.summaryPolicies.textContent).toBe('0');
    expect(elements.automationStatus.textContent).toMatch(/owner or administrator access/i);

    const stale = centerContract.buildPreview(preview({ name: 'STALE_TENANT_PREVIEW_MUST_NOT_RENDER' }));
    stalePreview.resolve({ success: true, data: stale });
    await flushMicrotasks();
    expect(elements.previewSummary.textContent).toBe('');
    expect(elements.automationPreview.hidden).toBe(true);
    expect(Object.values(elements).some(node => node.textContent.includes('STALE_TENANT_PREVIEW_MUST_NOT_RENDER'))).toBe(false);
  });

  test('stale forbidden preview clears prior tenant data while a newer preview remains pending', async () => {
    const forbiddenPreview = deferred();
    const pendingPreview = deferred();
    const forbidden = Object.assign(new Error('role revoked'), { status: 403 });
    const priorSnapshot = buildSnapshot(input(), emptyResults({ policies: [{
      policy_id: uuid(10), version: '1', source_class_id: 'mission23_work_execution',
      action_family: 'internal_read_digest_task', channel_id: 'in_app_passive', lifecycle_state: 'active',
      lifecycle_currentness: 'exact_current_not_runtime_revalidated', recorded_at: '2026-11-20T19:00:00Z',
    }] }));
    const json = jest.fn()
      .mockResolvedValueOnce({ success: true, data: priorSnapshot })
      .mockImplementationOnce(() => forbiddenPreview.promise)
      .mockImplementationOnce(() => pendingPreview.promise);
    const { elements, documentListeners } = automationPageHarness(json);
    documentListeners.DOMContentLoaded();
    await flushMicrotasks();

    const templateButtons = elements.automationTemplates.childNodes.map(card =>
      card.childNodes.find(child => child.tagName === 'BUTTON'));
    templateButtons[0].emit('click');
    templateButtons[1].emit('click');
    await flushMicrotasks();
    expect(elements.automationSummary.hidden).toBe(false);

    forbiddenPreview.reject(forbidden);
    await flushMicrotasks();
    expect(elements.automationSummary.hidden).toBe(true);
    expect(elements.automationPreview.hidden).toBe(true);
    expect(elements.summaryPolicies.textContent).toBe('0');
    expect(elements.automationStatus.textContent).toMatch(/owner or administrator access/i);
    expect(json).toHaveBeenCalledTimes(3);
  });

  test('preview authentication loss invalidates a pending GET completion', async () => {
    const staleGet = deferred();
    const unauthorized = Object.assign(new Error('session ended'), { status: 401 });
    const json = jest.fn()
      .mockImplementationOnce(() => staleGet.promise)
      .mockRejectedValueOnce(unauthorized);
    const { elements, documentListeners } = automationPageHarness(json);
    documentListeners.DOMContentLoaded();
    elements.summaryStatus.textContent = 'PRIOR_TENANT_PRIVATE_STATE';
    elements.automationSummary.hidden = false;

    elements.automationSetupForm.emit('submit', { preventDefault() {} });
    await flushMicrotasks();
    expect(elements.summaryStatus.textContent).toBe('Unavailable');
    expect(elements.automationSummary.hidden).toBe(true);
    expect(elements.automationStatus.textContent).toMatch(/session ended/i);

    const staleSnapshot = buildSnapshot(input(), emptyResults({ policies: [{
      policy_id: uuid(10), version: '1', source_class_id: 'mission23_work_execution',
      action_family: 'internal_read_digest_task', channel_id: 'in_app_passive', lifecycle_state: 'active',
      lifecycle_currentness: 'exact_current_not_runtime_revalidated', recorded_at: '2026-11-20T19:00:00Z',
    }] }));
    staleGet.resolve({ success: true, data: staleSnapshot });
    await flushMicrotasks();
    expect(elements.summaryPolicies.textContent).toBe('0');
    expect(elements.automationSummary.hidden).toBe(true);
    expect(elements.automationStatus.textContent).toMatch(/session ended/i);
  });

  test('stale unauthorized GET clears and invalidates a newer pending GET', async () => {
    const unauthorizedGet = deferred();
    const pendingGet = deferred();
    const unauthorized = Object.assign(new Error('session ended'), { status: 401 });
    const priorSnapshot = buildSnapshot(input(), emptyResults({ policies: [{
      policy_id: uuid(10), version: '1', source_class_id: 'mission23_work_execution',
      action_family: 'internal_read_digest_task', channel_id: 'in_app_passive', lifecycle_state: 'active',
      lifecycle_currentness: 'exact_current_not_runtime_revalidated', recorded_at: '2026-11-20T19:00:00Z',
    }] }));
    const json = jest.fn()
      .mockResolvedValueOnce({ success: true, data: priorSnapshot })
      .mockImplementationOnce(() => unauthorizedGet.promise)
      .mockImplementationOnce(() => pendingGet.promise);
    const { elements, documentListeners } = automationPageHarness(json);
    documentListeners.DOMContentLoaded();
    await flushMicrotasks();
    expect(elements.automationSummary.hidden).toBe(false);

    elements.automationRefresh.emit('click');
    elements.automationRefresh.emit('click');
    await flushMicrotasks();
    unauthorizedGet.reject(unauthorized);
    await flushMicrotasks();
    expect(elements.automationSummary.hidden).toBe(true);
    expect(elements.summaryPolicies.textContent).toBe('0');
    expect(elements.automationStatus.textContent).toMatch(/session ended/i);

    pendingGet.resolve({ success: true, data: priorSnapshot });
    await flushMicrotasks();
    expect(elements.automationSummary.hidden).toBe(true);
    expect(elements.summaryPolicies.textContent).toBe('0');
    expect(elements.automationStatus.textContent).toMatch(/session ended/i);
  });
});
