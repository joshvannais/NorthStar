'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const contract = require('../../public/js/automation-center-contract');
const { buildSnapshot } = require('../../src/automationCenter/repository');

const ROOT = path.resolve(__dirname, '../..');
const uuid = value => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const input = () => ({ organizationId: uuid(28), actorUserId: uuid(1), actorAccessRole: 'owner', authSessionId: uuid(2) });
const results = overrides => ({
  evaluatedAt: new Date('2026-11-23T20:00:00.000Z'),
  policies: [], runs: [], records: [], documents: [], channels: [], stopControl: [],
  ...(overrides || {}),
});
const baseRun = (id, overrides) => {
  const inputOverrides = overrides || {};
  const row = {
    run_id: uuid(id), policy_id: uuid(900 + id), policy_version: '1',
    latest_record_type: 'proposed_action', currentness_marker: 'captured_not_runtime_revalidated',
    latest_recorded_at: '2026-11-23T19:00:00.000Z',
    policy_lifecycle_state: 'active', policy_lifecycle_currentness: 'exact_current_not_runtime_revalidated',
    policy_expires_at: '2030-01-01T00:00:00.000Z',
    ...inputOverrides,
  };
  if (row.retry_state && !Object.prototype.hasOwnProperty.call(inputOverrides, 'retry_updated_at')) {
    row.retry_updated_at = '2026-11-23T19:40:00.000Z';
  }
  if (row.recovery_state) {
    if (!Object.prototype.hasOwnProperty.call(inputOverrides, 'recovery_recorded_at')) {
      row.recovery_recorded_at = '2026-11-23T19:45:00.000Z';
    }
    if (!Object.prototype.hasOwnProperty.call(inputOverrides, 'recovery_transaction_id')) {
      row.recovery_transaction_id = uuid(800 + id);
    }
    if (!Object.prototype.hasOwnProperty.call(inputOverrides, 'recovery_policy_id')) {
      row.recovery_policy_id = row.policy_id;
    }
    if (!Object.prototype.hasOwnProperty.call(inputOverrides, 'recovery_policy_version')) {
      row.recovery_policy_version = row.policy_version;
    }
  }
  return row;
};
function deferred() {
  let resolve; let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush(count = 8) { for (let index = 0; index < count; index += 1) await Promise.resolve(); }
function pageHarness(json) {
  class FakeElement {
    constructor(tagName = 'div') {
      this.tagName = tagName.toUpperCase(); this.dataset = {}; this.hidden = false;
      this.childNodes = []; this.attributes = {}; this.listeners = {}; this.value = ''; this.disabled = false;
      this.selectedIndex = 0; this._text = '';
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
  const html = fs.readFileSync(path.join(ROOT, 'public/dashboard/automation.html'), 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  const elements = Object.fromEntries(ids.map(id => [id, new FakeElement()]));
  const listeners = {};
  const document = {
    readyState: 'loading', getElementById: id => elements[id], createElement: tag => new FakeElement(tag),
    addEventListener: (name, listener) => { listeners[name] = listener; },
  };
  const window = { NorthStarAutomationCenter: contract, NorthStarAccountSession: { json } };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'public/js/automation-center-page.js'), 'utf8'),
    { window, document, Intl, Date, Promise, Error });
  return { elements, listeners };
}

describe('Mission 28 Part 14B exact state projection', () => {
  test('source-linked executable contract freezes the candidate and no-effect boundary', () => {
    const artifact = JSON.parse(fs.readFileSync(path.join(ROOT,
      'docs/architecture/MISSION_28_PART14B_COMPLETE_STATE_BEHAVIOR.json'), 'utf8'));
    expect(artifact).toMatchObject({
      contractVersion: 'mission28.part14b.complete-state-behavior.v1',
      status: 'released',
      base: {
        acceptedSourceHead: '4217ea78e200d1016bd54e3ce4bb72cee2d82d30',
        acceptedTree: 'e5c7c17b0df08ba5e43d801a8c57c1e8dcff872f',
        pullRequest: 608,
        mergedMain: 'e72c04bc6990c03b8d0b8719f0bd05779cdba505',
      },
      scope: { part: '14B', demoRoute: null, migrationAdded: false, latestMigration: 287, nextMigrationAbsent: 288 },
      release: {
        acceptedSourceHead: 'c0775903ed4e42d1ade8c9936ced2d141d8ff942',
        acceptedTree: '83869d378c2583c350ee4b899c4276e6db091035',
        pullRequest: 609,
        mergedMain: 'd43f0c588fb1785bb0afb6568997a329b485cc8d',
        deploymentId: 'b52e88e6-5339-4261-a25f-5256eca9897b',
      },
      projectionRules: {
        recoverySnapshotBinding: 'exact_policy_version_transaction_and_trusted_recorded_time_required',
        nonblockingRecoverySnapshot: 'only_newer_exact_same_transaction_processing_retry_or_control_evidence_may_supersede',
        olderOrEqualExecutionVersusRecovery: 'recovery_snapshot_remains_controlling',
        restrictiveRecoverySnapshot: 'stale_unavailable_or_uncertain_fail_closed_regardless_of_newer_positive_execution_evidence',
      },
      effectBoundary: {
        policySaved: false, policyActivated: false, actionQueued: false, providerCalled: false,
        recipientContacted: false, externalEffectCreated: false, financialEffectCreated: false,
        moneyEffectCreated: false, upstreamFactMutated: false,
      },
    });
    expect(artifact.runStateOrder).toEqual(contract.RUN_STATE_ORDER);
    expect(artifact.precedence).toContain('exact_binding_and_strict_time_order_for_nonblocking_recovery_versus_execution');
    expect(Object.values(artifact.effectBoundary).every(value => value === false)).toBe(true);
  });

  test('publishes one closed complete run-state vocabulary', () => {
    expect(contract.VERSION).toBe('mission28.automation-center.v2');
    expect(contract.RUN_STATE_ORDER).toEqual([
      'validation', 'approval', 'queued', 'in_flight', 'uncertain', 'suppressed', 'failed', 'paused',
      'stopped', 'expired', 'completed', 'corrected', 'recovery', 'stale', 'unavailable',
    ]);
  });

  test('projects every accepted state only from its exact supporting evidence', () => {
    const runs = [
      baseRun(1),
      baseRun(2, { latest_record_type: 'eligibility_evaluation', eligibility_state: 'approval_required' }),
      baseRun(3, { schedule_id: uuid(4003), retry_state: 'retry_scheduled_no_effect', retry_updated_at: '2026-11-23T19:20:00.000Z', retry_next_attempt_at: '2026-11-23T20:10:00.000Z' }),
      baseRun(4, { schedule_id: uuid(4004), lease_id: uuid(5004), lease_acquired_at: '2026-11-23T19:30:00.000Z', lease_expires_at: '2026-11-23T20:30:00.000Z' }),
      baseRun(5, { schedule_id: uuid(4005), retry_state: 'reconciliation_required_no_resend' }),
      baseRun(6, { latest_record_type: 'suppression', suppression_blocks_effect: 'true' }),
      baseRun(7, { schedule_id: uuid(4007), retry_state: 'permanent_stop_terminal' }),
      baseRun(8, { tenant_control_state: 'paused' }),
      baseRun(9, { latest_record_type: 'cancellation', cancellation_state: 'accepted' }),
      baseRun(10, { schedule_id: uuid(4010), schedule_expires_at: '2026-11-23T19:59:59.000Z' }),
      baseRun(11, { latest_record_type: 'terminal_outcome', terminal_state: 'completed_internal' }),
      baseRun(12, { latest_record_type: 'reconciliation', reconciliation_state: 'corrected' }),
      baseRun(13, { recovery_state: 'bounded_history_verified_no_effect' }),
      baseRun(14, { currentness_marker: 'captured_stale_fail_closed' }),
      baseRun(15, { latest_record_type: 'scheduled_run', schedule_id: uuid(4015) }),
    ];
    const snapshot = buildSnapshot(input(), results({ runs }));
    expect(snapshot.runs.map(run => run.state)).toEqual(contract.RUN_STATE_ORDER);
    expect(snapshot.counts.runs).toBe(contract.RUN_STATE_ORDER.length);
    expect(Object.values(snapshot.counts.runStates)).toEqual(contract.RUN_STATE_ORDER.map(() => 1));
    expect(snapshot.runs.every(run => run.stateLabel === contract.RUN_STATE_LABELS[run.state])).toBe(true);
    expect(snapshot.runs.every(run =>
      typeof run.stateExplanation === 'string' && run.stateExplanation.length > 0 &&
      run.stateExplanation === contract.RUN_STATE_EXPLANATIONS[run.state])).toBe(true);
    expect(snapshot.runs.map(run => run.stateExplanation).join(' '))
      .not.toMatch(/\b(?:lease|fence|action-control|delivery-control|authority-class|vocabulary)\b/i);
  });

  test.each([
    ['completed_internal', 'completed'], ['suppressed', 'suppressed'], ['cancelled', 'stopped'],
    ['failed', 'failed'], ['unavailable', 'unavailable'], ['uncertain', 'uncertain'],
    [null, 'unavailable'], ['future_terminal_value', 'unavailable'],
  ])('terminal class %p projects as %s, never implied success', (terminalState, expected) => {
    const snapshot = buildSnapshot(input(), results({ runs: [baseRun(20, {
      latest_record_type: 'terminal_outcome', terminal_state: terminalState,
    })] }));
    expect(snapshot.runs[0].state).toBe(expected);
    if (terminalState !== 'completed_internal') expect(snapshot.runs[0].state).not.toBe('completed');
  });

  test('schedule presence and absent dependencies never become queued or in flight', () => {
    const snapshot = buildSnapshot(input(), results({ runs: [
      baseRun(21, { latest_record_type: 'scheduled_run', schedule_id: uuid(4021), schedule_record_state: 'scheduled' }),
      baseRun(22, { latest_record_type: 'action_unit', unit_state: 'ready', schedule_id: uuid(4022) }),
      baseRun(23, { currentness_marker: null, schedule_id: uuid(4023) }),
      baseRun(24, { action_control_state: 'active_resumed', action_execution_phase: null }),
    ] }));
    expect(snapshot.runs.map(run => run.state)).toEqual(['unavailable', 'unavailable', 'unavailable', 'unavailable']);
    expect(snapshot.counts.runStates.queued).toBe(0);
    expect(snapshot.counts.runStates.in_flight).toBe(0);
  });

  test('execution conflicts apply restrictive and newest exact evidence precedence', () => {
    const snapshot = buildSnapshot(input(), results({ runs: [
      baseRun(31, {
        schedule_id: uuid(4031), retry_next_attempt_at: '2026-11-23T20:10:00.000Z',
        retry_state: 'retry_scheduled_no_effect', retry_updated_at: '2026-11-23T19:10:00.000Z',
        lease_id: uuid(5031), lease_acquired_at: '2026-11-23T19:20:00.000Z', lease_expires_at: '2026-11-23T20:30:00.000Z',
      }),
      baseRun(32, {
        schedule_id: uuid(4032), retry_next_attempt_at: '2026-11-23T20:10:00.000Z',
        retry_state: 'retry_scheduled_no_effect', retry_updated_at: '2026-11-23T19:30:00.000Z',
        lease_id: uuid(5032), lease_acquired_at: '2026-11-23T19:20:00.000Z', lease_expires_at: '2026-11-23T20:30:00.000Z',
      }),
      baseRun(33, {
        schedule_id: uuid(4033),
        schedule_expires_at: '2026-11-23T19:59:00.000Z',
        lease_id: uuid(5033), lease_acquired_at: '2026-11-23T19:20:00.000Z', lease_expires_at: '2026-11-23T20:30:00.000Z',
      }),
      baseRun(34, {
        schedule_id: uuid(4034),
        recovery_state: 'blocked_source_not_latest_exact_current',
        lease_id: uuid(5034), lease_acquired_at: '2026-11-23T19:20:00.000Z', lease_expires_at: '2026-11-23T20:30:00.000Z',
      }),
      baseRun(35, { recovery_state: 'future_recovery_state' }),
      baseRun(36, { retry_state: 'reconciliation_required_no_resend', tenant_control_state: 'paused' }),
    ] }));
    expect(snapshot.runs.map(run => run.state)).toEqual([
      'in_flight', 'uncertain', 'uncertain', 'stale', 'unavailable', 'paused',
    ]);
  });

  test('newer exact bound processing supersedes only an older nonblocking recovery snapshot', () => {
    const recoveryRun = (id, overrides) => {
      const transactionId = uuid(6000 + id);
      return baseRun(id, {
        schedule_id: uuid(5000 + id), schedule_transaction_id: transactionId,
        recovery_state: 'bounded_history_verified_no_effect',
        recovery_transaction_id: transactionId,
        recovery_recorded_at: '2026-11-23T19:40:00.000Z',
        ...overrides,
      });
    };
    const snapshot = buildSnapshot(input(), results({ runs: [
      recoveryRun(130, {
        lease_id: uuid(7130), lease_acquired_at: '2026-11-23T19:50:00.000Z', lease_expires_at: '2026-11-23T20:30:00.000Z',
      }),
      recoveryRun(131, {
        lease_id: uuid(7131), lease_acquired_at: '2026-11-23T19:30:00.000Z', lease_expires_at: '2026-11-23T20:30:00.000Z',
      }),
      recoveryRun(132, {
        lease_id: uuid(7132), lease_acquired_at: '2026-11-23T19:40:00.000Z', lease_expires_at: '2026-11-23T20:30:00.000Z',
      }),
      recoveryRun(133, {
        action_control_state: 'active_resumed', action_execution_phase: 'queued',
        action_control_updated_at: '2026-11-23T19:50:00.000Z',
      }),
      recoveryRun(134, {
        action_control_state: 'active_resumed', action_execution_phase: 'queued',
        action_control_updated_at: '2026-11-23T19:30:00.000Z',
      }),
    ] }));
    expect(snapshot.runs.map(run => run.state)).toEqual([
      'in_flight', 'recovery', 'recovery', 'queued', 'recovery',
    ]);
  });

  test('recovery versus retry ordering uses exact trusted times and preserves conflicts', () => {
    const recoveryRun = (id, overrides) => {
      const transactionId = uuid(6200 + id);
      return baseRun(id, {
        schedule_id: uuid(5200 + id), schedule_transaction_id: transactionId,
        recovery_state: 'bounded_history_verified_no_effect',
        recovery_transaction_id: transactionId,
        recovery_recorded_at: '2026-11-23T19:40:00.000Z',
        retry_state: 'retry_scheduled_no_effect', retry_next_attempt_at: '2026-11-23T20:10:00.000Z',
        ...overrides,
      });
    };
    const snapshot = buildSnapshot(input(), results({ runs: [
      recoveryRun(140, { retry_updated_at: '2026-11-23T19:50:00.000Z' }),
      recoveryRun(141, { retry_updated_at: '2026-11-23T19:30:00.000Z' }),
      recoveryRun(142, { retry_updated_at: '2026-11-23T19:40:00.000Z' }),
      recoveryRun(143, {
        recovery_recorded_at: '2026-11-23T19:20:00.000Z', retry_updated_at: '2026-11-23T19:50:00.000Z',
        lease_id: uuid(7143), lease_acquired_at: '2026-11-23T19:40:00.000Z', lease_expires_at: '2026-11-23T20:30:00.000Z',
      }),
      recoveryRun(144, {
        recovery_state: 'wait_for_active_lease_no_effect', recovery_recorded_at: '2026-11-23T19:20:00.000Z',
        retry_state: null, retry_next_attempt_at: null,
        lease_id: uuid(7144), lease_acquired_at: '2026-11-23T19:50:00.000Z', lease_expires_at: '2026-11-23T20:30:00.000Z',
      }),
    ] }));
    expect(snapshot.runs.map(run => run.state)).toEqual([
      'queued', 'recovery', 'recovery', 'uncertain', 'in_flight',
    ]);
  });

  test('missing or mismatched temporal bindings fail closed and restrictive evidence still wins', () => {
    const recoveryRun = (id, overrides) => {
      const transactionId = uuid(6400 + id);
      return baseRun(id, {
        schedule_id: uuid(5400 + id), schedule_transaction_id: transactionId,
        recovery_state: 'bounded_history_verified_no_effect', recovery_transaction_id: transactionId,
        recovery_recorded_at: '2026-11-23T19:30:00.000Z',
        lease_id: uuid(7200 + id), lease_acquired_at: '2026-11-23T19:50:00.000Z', lease_expires_at: '2026-11-23T20:30:00.000Z',
        ...overrides,
      });
    };
    const snapshot = buildSnapshot(input(), results({ runs: [
      recoveryRun(150, { recovery_recorded_at: null }),
      recoveryRun(151, { recovery_transaction_id: uuid(9991) }),
      recoveryRun(152, {
        lease_id: null, lease_acquired_at: null, lease_expires_at: null,
        retry_state: 'retry_scheduled_no_effect', retry_next_attempt_at: '2026-11-23T20:10:00.000Z', retry_updated_at: null,
      }),
      recoveryRun(153, {
        lease_id: null, lease_acquired_at: null, lease_expires_at: null,
        action_control_state: 'active_resumed', action_execution_phase: 'queued', action_control_updated_at: null,
      }),
      recoveryRun(154, { currentness_marker: 'captured_stale_fail_closed' }),
      recoveryRun(155, { policy_lifecycle_state: 'paused' }),
      recoveryRun(156, { tenant_control_state: 'paused' }),
      recoveryRun(157, { recovery_state: 'blocked_source_not_latest_exact_current' }),
      recoveryRun(158, { recovery_state: 'disaster_restore_evidence_gap_no_authority' }),
      recoveryRun(159, { recovery_state: 'reconciliation_required_no_resend' }),
    ] }));
    expect(snapshot.runs.map(run => run.state)).toEqual([
      'unavailable', 'unavailable', 'unavailable', 'unavailable', 'stale',
      'paused', 'paused', 'stale', 'unavailable', 'uncertain',
    ]);
  });

  test('suppression and cancellation require exact payload semantics', () => {
    const snapshot = buildSnapshot(input(), results({ runs: [
      baseRun(41, { latest_record_type: 'suppression', suppression_blocks_effect: 'false' }),
      baseRun(42, { latest_record_type: 'suppression', suppression_blocks_effect: null }),
      baseRun(43, { latest_record_type: 'cancellation', cancellation_state: 'requested' }),
      baseRun(44, { latest_record_type: 'cancellation', cancellation_state: 'too_late' }),
      baseRun(45, { latest_record_type: 'cancellation', cancellation_state: 'unavailable' }),
    ] }));
    expect(snapshot.runs.map(run => run.state)).toEqual([
      'unavailable', 'unavailable', 'validation', 'uncertain', 'unavailable',
    ]);
  });

  test('secondary surfaces keep record classes neutral when exact outcomes are unavailable', () => {
    const record = (id, runId, recordType, recordedAt) => ({
      record_id: uuid(id), run_id: uuid(runId), record_type: recordType,
      currentness_marker: 'captured_not_runtime_revalidated', authority_class: 'automation_decision',
      recorded_at: recordedAt,
    });
    const snapshot = buildSnapshot(input(), results({
      runs: [
        baseRun(41, { latest_record_type: 'suppression', suppression_blocks_effect: 'false' }),
        baseRun(42, { latest_record_type: 'suppression', suppression_blocks_effect: null }),
        baseRun(43, { latest_record_type: 'cancellation', cancellation_state: 'requested' }),
        baseRun(44, { latest_record_type: 'cancellation', cancellation_state: 'too_late' }),
        baseRun(45, { latest_record_type: 'cancellation', cancellation_state: 'unavailable' }),
        baseRun(46, { latest_record_type: 'reconciliation', reconciliation_state: 'uncertain' }),
        baseRun(47, { latest_record_type: 'scheduled_run', schedule_id: uuid(4047) }),
      ],
      records: [
        record(641, 41, 'suppression', '2026-11-23T19:41:00.000Z'),
        record(642, 42, 'suppression', '2026-11-23T19:42:00.000Z'),
        record(643, 43, 'cancellation', '2026-11-23T19:43:00.000Z'),
        record(644, 44, 'cancellation', '2026-11-23T19:44:00.000Z'),
        record(645, 45, 'cancellation', '2026-11-23T19:45:00.000Z'),
        record(646, 46, 'reconciliation', '2026-11-23T19:46:00.000Z'),
        record(647, 47, 'scheduled_run', '2026-11-23T19:47:00.000Z'),
        record(648, 43, 'internal_task', '2026-11-23T19:42:30.000Z'),
      ],
    }));

    expect(snapshot.runs.map(run => run.state)).toEqual([
      'unavailable', 'unavailable', 'validation', 'uncertain', 'unavailable', 'uncertain', 'unavailable',
    ]);
    expect(snapshot.runs.map(run => run.latestEvent)).toEqual([
      'Safeguard evidence recorded', 'Safeguard evidence recorded',
      'Cancellation evidence recorded', 'Cancellation evidence recorded', 'Cancellation evidence recorded',
      'Review evidence recorded', 'Schedule evidence recorded',
    ]);
    expect(Object.fromEntries(snapshot.timeline.map(item => [item.kind, item.label]))).toMatchObject({
      suppression: 'Safeguard evidence recorded',
      cancellation: 'Cancellation evidence recorded',
      reconciliation: 'Review evidence recorded',
      scheduled_run: 'Schedule evidence recorded',
      internal_task: 'Owner work evidence recorded',
    });
    expect(snapshot.ownerWork).toEqual([expect.objectContaining({
      runId: uuid(43),
      state: 'historical_status_unavailable',
      statusLabel: 'Current pending or resolved task status is unavailable.',
    })]);
    const secondaryCopy = snapshot.runs.map(run => run.latestEvent)
      .concat(snapshot.timeline.map(item => item.label), snapshot.ownerWork.map(item => item.statusLabel)).join(' ');
    expect(secondaryCopy).not.toMatch(/action cancelled|stopped (?:the )?effect|outcome reconciled|run scheduled|terminal evidence/i);
  });

  test('every record-class label describes evidence without inventing an outcome', () => {
    const labels = {
      eligibility_evaluation: 'Eligibility evidence recorded',
      proposed_action: 'Proposed action evidence recorded',
      approval: 'Approval evidence recorded',
      scheduled_run: 'Schedule evidence recorded',
      action_unit: 'Work evidence recorded',
      provider_attempt: 'Delivery attempt evidence recorded',
      provider_acknowledgement: 'Delivery response evidence recorded',
      delivery_state: 'Delivery status evidence recorded',
      reply_opt_out: 'Reply or opt-out evidence recorded',
      internal_task: 'Owner work evidence recorded',
      suppression: 'Safeguard evidence recorded',
      cancellation: 'Cancellation evidence recorded',
      reconciliation: 'Review evidence recorded',
      terminal_outcome: 'Outcome evidence recorded',
    };
    const recordTypes = Object.keys(labels);
    const snapshot = buildSnapshot(input(), results({
      runs: recordTypes.map((recordType, index) => baseRun(100 + index, {
        latest_record_type: recordType,
        ...(recordType === 'scheduled_run' ? { schedule_id: uuid(4100 + index) } : {}),
      })),
      records: recordTypes.map((recordType, index) => ({
        record_id: uuid(700 + index), run_id: uuid(100 + index), record_type: recordType,
        currentness_marker: 'captured_not_runtime_revalidated', authority_class: 'automation_decision',
        recorded_at: `2026-11-23T19:${String(index).padStart(2, '0')}:00.000Z`,
      })),
    }));
    expect(new Set(snapshot.runs.map(run => run.latestEvent))).toEqual(new Set(Object.values(labels)));
    expect(Object.fromEntries(snapshot.timeline.map(item => [item.kind, item.label]))).toMatchObject(labels);
    const copy = snapshot.runs.map(run => run.latestEvent).concat(snapshot.timeline.map(item => item.label)).join(' ');
    expect(copy).not.toMatch(/eligibility checked|prepared for review|run scheduled|action prepared|provider acknowledgement|delivery evidence updated|action stopped|action cancelled|outcome reconciled|terminal state/i);
  });

  test('rendered latest-event, timeline, and owner-work copy preserves neutral evidence labels', async () => {
    const snapshot = buildSnapshot(input(), results({
      runs: [
        baseRun(120, { latest_record_type: 'cancellation', cancellation_state: 'unavailable' }),
        baseRun(121, { latest_record_type: 'suppression', suppression_blocks_effect: 'false' }),
        baseRun(122, { latest_record_type: 'reconciliation', reconciliation_state: 'uncertain' }),
        baseRun(123, { latest_record_type: 'scheduled_run', schedule_id: uuid(4123) }),
      ],
      records: [
        { record_id: uuid(720), run_id: uuid(120), record_type: 'cancellation', currentness_marker: 'captured_not_runtime_revalidated', authority_class: 'automation_decision', recorded_at: '2026-11-23T19:20:00.000Z' },
        { record_id: uuid(721), run_id: uuid(121), record_type: 'suppression', currentness_marker: 'captured_not_runtime_revalidated', authority_class: 'automation_decision', recorded_at: '2026-11-23T19:21:00.000Z' },
        { record_id: uuid(722), run_id: uuid(122), record_type: 'reconciliation', currentness_marker: 'captured_not_runtime_revalidated', authority_class: 'effect_evidence', recorded_at: '2026-11-23T19:22:00.000Z' },
        { record_id: uuid(723), run_id: uuid(123), record_type: 'scheduled_run', currentness_marker: 'captured_not_runtime_revalidated', authority_class: 'automation_decision', recorded_at: '2026-11-23T19:23:00.000Z' },
        { record_id: uuid(724), run_id: uuid(120), record_type: 'internal_task', currentness_marker: 'captured_not_runtime_revalidated', authority_class: 'automation_decision', recorded_at: '2026-11-23T19:19:00.000Z' },
      ],
    }));
    const { elements, listeners } = pageHarness(jest.fn().mockResolvedValue({ success: true, data: snapshot }));
    listeners.DOMContentLoaded(); await flush();
    const rendered = [elements.attentionRuns, elements.automationTimeline, elements.automationOwnerWork]
      .map(element => element.textContent).join(' ');
    expect(rendered).toMatch(/Cancellation evidence recorded/);
    expect(rendered).toMatch(/Safeguard evidence recorded/);
    expect(rendered).toMatch(/Review evidence recorded/);
    expect(rendered).toMatch(/Schedule evidence recorded/);
    expect(rendered).toMatch(/Current pending or resolved task status is unavailable/);
    expect(rendered).not.toMatch(/action cancelled|stopped (?:the )?effect|outcome reconciled|run scheduled|terminal evidence/i);
  });

  test('approval evidence never invents a current pending owner request', () => {
    const snapshot = buildSnapshot(input(), results({ runs: [
      baseRun(451, { latest_record_type: 'eligibility_evaluation', eligibility_state: 'approval_required' }),
      baseRun(452, { latest_record_type: 'approval', approval_state: 'unavailable_pending_part3' }),
      baseRun(453, { latest_record_type: 'approval', approval_state: 'approved' }),
    ] }));
    expect(snapshot.runs.map(run => run.state)).toEqual(['approval', 'approval', 'validation']);
    expect(snapshot.runs.slice(0, 2).every(run =>
      run.stateLabel === 'Approval status recorded' &&
      run.stateExplanation === 'A requirement or prior decision is recorded. Current pending status is unavailable.')).toBe(true);
    expect(snapshot.runs[2].stateLabel).toBe('Preparing for review');
    expect(snapshot.runs.map(run => `${run.stateLabel} ${run.stateExplanation}`).join(' '))
      .not.toMatch(/awaiting approval|waiting for (?:an )?owner|pending approval request/i);
  });

  test('unknown or incomplete retry, lease, and reply evidence fails closed', () => {
    const snapshot = buildSnapshot(input(), results({ runs: [
      baseRun(46, { schedule_id: uuid(4046), retry_state: 'future_retry_state' }),
      baseRun(47, { schedule_id: uuid(4047), retry_state: 'retry_scheduled_no_effect', retry_next_attempt_at: null }),
      baseRun(48, { schedule_id: uuid(4048), lease_id: uuid(5048), lease_expires_at: '2026-11-23T20:30:00.000Z' }),
      baseRun(49, { latest_record_type: 'reply_opt_out', reply_authenticated: 'false', suppression_required: 'true' }),
      baseRun(50, { latest_record_type: 'reply_opt_out', reply_authenticated: 'true', suppression_required: 'true' }),
    ] }));
    expect(snapshot.runs.map(run => run.state)).toEqual([
      'unavailable', 'unavailable', 'unavailable', 'uncertain', 'suppressed',
    ]);
  });

  test('multi-schedule or multi-unit runs never strengthen one selected schedule into whole-run status', () => {
    const snapshot = buildSnapshot(input(), results({ runs: [
      baseRun(51, {
        schedule_count: '2', action_unit_count: '2', schedule_id: uuid(4051),
        lease_id: uuid(5051), lease_acquired_at: '2026-11-23T19:30:00.000Z', lease_expires_at: '2026-11-23T20:30:00.000Z',
      }),
      baseRun(52, {
        schedule_count: '1', action_unit_count: '2', schedule_id: uuid(4052),
        retry_state: 'permanent_stop_terminal',
      }),
    ] }));
    expect(snapshot.runs.map(run => run.state)).toEqual(['unavailable', 'unavailable']);
    expect(snapshot.runs.every(run => run.stateExplanation === contract.RUN_STATE_EXPLANATIONS.unavailable)).toBe(true);
  });

  test('contract rejects unknown states and inconsistent counts', () => {
    const snapshot = buildSnapshot(input(), results({ runs: [baseRun(50)] }));
    expect(() => contract.validateSnapshot({
      ...snapshot, runs: [{ ...snapshot.runs[0], state: 'active', stateLabel: 'Active' }],
    })).toThrow(/attention status is unavailable/i);
    expect(() => contract.validateSnapshot({
      ...snapshot, counts: { ...snapshot.counts, runs: 0 },
    })).toThrow(/attention status is unavailable/i);
  });
});

describe('Mission 28 Part 14B fail-closed page states and races', () => {
  test('empty success is explicit and does not invent zero approval authority', async () => {
    const snapshot = buildSnapshot(input(), results());
    const { elements, listeners } = pageHarness(jest.fn().mockResolvedValue({ success: true, data: snapshot }));
    listeners.DOMContentLoaded(); await flush();
    expect(elements.automationStatus.dataset.state).toBe('empty');
    expect(elements.approvalCount.textContent).toBe('Unavailable');
    expect(elements.automationApprovals.textContent).toMatch(/may exist/i);
  });

  test('primary run cards describe approval evidence without inventing pending work', async () => {
    const snapshot = buildSnapshot(input(), results({ runs: [
      baseRun(226, { latest_record_type: 'eligibility_evaluation', eligibility_state: 'approval_required' }),
      baseRun(227, { latest_record_type: 'approval', approval_state: 'approved' }),
    ] }));
    const { elements, listeners } = pageHarness(jest.fn().mockResolvedValue({ success: true, data: snapshot }));
    listeners.DOMContentLoaded(); await flush();
    expect(elements.waitingRuns.textContent).toContain('Approval status recorded');
    expect(elements.waitingRuns.textContent).toContain('Current pending status is unavailable');
    expect(elements.waitingRuns.textContent).not.toMatch(/awaiting approval|waiting for (?:an )?owner|pending approval request|approved/i);
  });

  test('conflict clears prior data and exposes fixed owner-readable recovery copy', async () => {
    const prior = buildSnapshot(input(), results({ runs: [baseRun(60)] }));
    const conflict = Object.assign(new Error('SERIALIZATION_FAILURE_INTERNAL'), { status: 409 });
    const json = jest.fn().mockResolvedValueOnce({ success: true, data: prior }).mockRejectedValueOnce(conflict);
    const { elements, listeners } = pageHarness(json);
    listeners.DOMContentLoaded(); await flush();
    expect(elements.automationSummary.hidden).toBe(false);
    await elements.automationRefresh.emit('click'); await flush();
    expect(elements.automationSummary.hidden).toBe(true);
    expect(elements.summaryRuns.textContent).toBe('0');
    expect(elements.automationStatus.dataset.state).toBe('conflict');
    expect(elements.automationStatus.textContent).toMatch(/records changed.*no saved data is shown/i);
    expect(elements.automationStatus.textContent).not.toContain('SERIALIZATION_FAILURE_INTERNAL');
  });

  test('validation failure clears every prior preview field without clearing valid tenant snapshot', async () => {
    const snapshot = buildSnapshot(input(), results({ runs: [baseRun(61)] }));
    const preview = contract.buildPreview({
      templateId: 'owner-work-review', name: 'Owner work review', sourceClassId: 'mission23_work_execution',
      actionFamily: 'internal_read_digest_task', recipientClass: 'tenant_owner', channelId: 'in_app_passive',
      timing: 'review_now', dailyLimit: 1,
    });
    const validation = Object.assign(new Error('INTERNAL_VALIDATOR_CODE'), { status: 422 });
    const json = jest.fn()
      .mockResolvedValueOnce({ success: true, data: snapshot })
      .mockResolvedValueOnce({ success: true, data: preview })
      .mockRejectedValueOnce(validation);
    const { elements, listeners } = pageHarness(json);
    listeners.DOMContentLoaded(); await flush();
    const buttons = elements.automationTemplates.childNodes.map(card => card.childNodes.find(node => node.tagName === 'BUTTON'));
    await buttons[0].emit('click'); await flush();
    expect(elements.automationPreview.hidden).toBe(false);
    expect(elements.previewSummary.textContent).not.toBe('');
    await buttons[0].emit('click'); await flush();
    expect(elements.automationPreview.hidden).toBe(true);
    expect(elements.previewSummary.textContent).toBe('');
    expect(elements.previewBoundary.textContent).toBe('');
    expect(elements.previewDetails.childNodes).toHaveLength(0);
    expect(elements.previewStops.childNodes).toHaveLength(0);
    expect(elements.automationSummary.hidden).toBe(false);
    expect(elements.automationStatus.dataset.state).toBe('validation');
    expect(elements.automationStatus.textContent).not.toContain('INTERNAL_VALIDATOR_CODE');
  });

  test('an older preview conflict clears snapshot authority and suppresses a newer pending preview success', async () => {
    const snapshot = buildSnapshot(input(), results({ runs: [baseRun(62)] }));
    const preview = contract.buildPreview({
      templateId: 'owner-work-review', name: 'Owner work review', sourceClassId: 'mission23_work_execution',
      actionFamily: 'internal_read_digest_task', recipientClass: 'tenant_owner', channelId: 'in_app_passive',
      timing: 'review_now', dailyLimit: 1,
    });
    const first = deferred(); const newer = deferred();
    const json = jest.fn()
      .mockResolvedValueOnce({ success: true, data: snapshot })
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => newer.promise);
    const { elements, listeners } = pageHarness(json);
    listeners.DOMContentLoaded(); await flush();
    const button = elements.automationTemplates.childNodes[0].childNodes.find(node => node.tagName === 'BUTTON');
    button.emit('click'); button.emit('click'); await flush();
    first.reject(Object.assign(new Error('OLD_SOURCE_CONFLICT'), { status: 409 })); await flush();
    expect(elements.automationStatus.dataset.state).toBe('conflict');
    expect(elements.automationSummary.hidden).toBe(true);
    expect(elements.summaryRuns.textContent).toBe('0');
    expect(elements.automationPreview.hidden).toBe(true);
    expect(elements.automationStatus.textContent).toMatch(/no saved data is shown/i);
    newer.resolve({ success: true, data: preview }); await flush();
    expect(elements.automationStatus.dataset.state).toBe('conflict');
    expect(elements.automationSummary.hidden).toBe(true);
    expect(elements.automationPreview.hidden).toBe(true);
    expect(elements.previewSummary.textContent).toBe('');
  });

  test('preview conflict invalidates an older pending GET success', async () => {
    const snapshot = buildSnapshot(input(), results({ runs: [baseRun(63)] }));
    const oldGet = deferred(); const conflict = deferred();
    const json = jest.fn()
      .mockResolvedValueOnce({ success: true, data: snapshot })
      .mockImplementationOnce(() => oldGet.promise)
      .mockImplementationOnce(() => conflict.promise);
    const { elements, listeners } = pageHarness(json);
    listeners.DOMContentLoaded(); await flush();
    const button = elements.automationTemplates.childNodes[0].childNodes.find(node => node.tagName === 'BUTTON');
    elements.automationRefresh.emit('click'); button.emit('click'); await flush();
    conflict.reject(Object.assign(new Error('SOURCE_CHANGED'), { status: 409 })); await flush();
    oldGet.resolve({ success: true, data: snapshot }); await flush();
    expect(elements.automationStatus.dataset.state).toBe('conflict');
    expect(elements.automationSummary.hidden).toBe(true);
    expect(elements.summaryRuns.textContent).toBe('0');
  });

  test('older GET success never replaces a newer recovered snapshot', async () => {
    const older = deferred();
    const oldSnapshot = buildSnapshot(input(), results({ runs: [baseRun(70)] }));
    const recovered = buildSnapshot(input(), results());
    const json = jest.fn().mockImplementationOnce(() => older.promise)
      .mockResolvedValueOnce({ success: true, data: recovered });
    const { elements, listeners } = pageHarness(json);
    listeners.DOMContentLoaded();
    await elements.automationRefresh.emit('click'); await flush();
    expect(elements.summaryRuns.textContent).toBe('0');
    expect(elements.automationStatus.dataset.state).toBe('empty');
    older.resolve({ success: true, data: oldSnapshot }); await flush();
    expect(elements.summaryRuns.textContent).toBe('0');
    expect(elements.automationStatus.dataset.state).toBe('empty');
  });

  test('primary run groups use fixed readable labels and never raw evidence codes', async () => {
    const snapshot = buildSnapshot(input(), results({ runs: [
      baseRun(80, { schedule_id: uuid(4080), retry_state: 'retry_scheduled_no_effect', retry_next_attempt_at: '2026-11-23T20:10:00.000Z' }),
      baseRun(81, { recovery_state: 'reconciliation_required_no_resend' }),
      baseRun(82, { latest_record_type: 'terminal_outcome', terminal_state: 'completed_internal' }),
    ] }));
    const { elements, listeners } = pageHarness(jest.fn().mockResolvedValue({ success: true, data: snapshot }));
    listeners.DOMContentLoaded(); await flush();
    const primary = ['waitingRuns', 'inFlightRuns', 'attentionRuns', 'stoppedRuns', 'finishedRuns']
      .map(id => elements[id].textContent).join(' ');
    expect(primary).toMatch(/Queued/);
    expect(primary).toMatch(/Outcome needs review/);
    expect(primary).toMatch(/Internal work completed/);
    expect(primary).not.toMatch(/retry_scheduled_no_effect|reconciliation_required_no_resend|completed_internal/);
    expect(primary).not.toMatch(/lease|fence|action-control|authority class|state catalog/i);
    const page = fs.readFileSync(path.join(ROOT, 'public/dashboard/automation.html'), 'utf8');
    expect(page).not.toMatch(/\b(?:lease|fence|action-control|authority-class|vocabulary)\b/i);
    expect(page).toMatch(/in progress appear only when exact recorded processing evidence supports them/i);
  });
});
